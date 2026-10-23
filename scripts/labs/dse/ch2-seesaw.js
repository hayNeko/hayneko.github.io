/**
 * ch2-seesaw.js — 蹺蹺板與力矩 (DSE 物理 · II.b · 實驗 05)
 *
 * 為什麼兩個砝碼要能拖: 「平衡不是重量相等」這句話用講的沒人信, 把 2 kg 拖到 1.00 m
 * 而 4 kg 停在 0.50 m, 板子自己就停平了 —— 學生看到的是 19.62 對 19.62, 不是口訣。
 *
 * 角度只是不平衡的示意, 不是真的靜平衡位置: 課本的 d⊥ 取水平位時的垂直距離,
 * 板子一旦傾斜, 真正的力臂會是 d·cosθ 而愈傾愈平。所以讀數一律用 d 本身,
 * 板子的 ±18° 只負責把「哪邊沉」畫出來 (tanh 軟飽和, 永遠不會翻過去)。
 */
(function () {
	'use strict';

	var G = 9.81;
	var D_MIN = -1.2;
	var D_MAX = 1.2;
	var SNAP = 0.05;
	var CRATE_W = 0.34;        /* m, 木箱寬 */
	var BLOCK_W = 0.30;        /* m, 鐵塊寬 */
	var MIN_GAP_PX = 2;        /* 兩個實體之間至少要留的像素 */
	var MAX_TILT = 18 * Math.PI / 180;
	var SKEW_K = 12;            /* tanh 的尺度: Στ = 12 N·m 時傾到 76% 滿度 */
	var BAL_TOL = 0.15;         /* N·m, 這個以內算平衡 */
	var HALF_PLANK = 1.32;      /* m, 板子比 ±1.2 的行程再長一點 */

	window.DSELab.define('seesaw', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* 畫布裡是實景: 木頭 / 金屬 / 草地 / 天空 */
		var K = {
			skyTop: '#b9d4e4',
			skyLow: '#e8efec',
			hedge: '#7f9a63',
			grass: '#7c9a56',
			grassDark: '#5d7940',
			tuft: '#6b8a48',
			wood: '#c08a54',
			woodDark: '#9a6a3c',
			woodLit: '#d3a271',
			crate: '#b07a44',
			crateDark: '#8a5c2f',
			crateLit: '#c89458',
			metal: '#7e858b',
			metalLit: '#9ba2a7',
			metalDark: '#5c6368',
			pivot: '#7b8185',
			pivotDark: '#565b5f'
		};

		/* ---------------- 狀態 ---------------- */
		var m1 = 2;
		var m2 = 4;
		var x1 = -1.0;      /* 以支點為原點, 向右為正 */
		var x2 = 0.5;
		var angle = 0;
		var vel = 0;
		var dragging = 0;   /* 0 = 沒拖, 1 / 2 = 拖哪一個 */
		var view = null;
		var canvas = null;
		var last = { px: 0, s: 1, ang: 0, th: 3 };

		/* ---------------- 小工具 ---------------- */
		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		function cl(v, a, b) { return v < a ? a : v > b ? b : v; }

		function snap(v) { return Math.round(v / SNAP) * SNAP; }

		/* 往 sgn 那一側取到下一個格點: 夾開之後不會被四捨五入又推回重疊 */
		function snapAway(v, sgn) {
			var q = v / SNAP;
			return (sgn > 0 ? Math.ceil(q - 1e-9) : Math.floor(q + 1e-9)) * SNAP;
		}

		/* 量度一律兩位小數: 0.05 的吸附要看得出來, 所以不削尾零 */
		function fix2(v) {
			if (typeof v !== 'number' || !isFinite(v)) return '—';
			return v.toFixed(2);
		}

		var oLine = { color: '', width: 1, dash: null };
		var oArrow = { color: '', width: 1.4, head: 7, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };

		function ln(g, x1_, y1, x2_, y2, color, width, dash) {
			oLine.color = color;
			oLine.width = width;
			oLine.dash = dash || null;
			D.line(g, x1_, y1, x2_, y2, oLine);
		}

		function arw(g, x1_, y1, x2_, y2, color, width, head, dash) {
			oArrow.color = color;
			oArrow.width = width;
			oArrow.head = head;
			oArrow.dash = dash || null;
			D.arrow(g, x1_, y1, x2_, y2, oArrow);
		}

		function lbl(g, text, x, y, color, size, align, baseline, mono, bg) {
			oLabel.color = color;
			oLabel.size = size;
			oLabel.align = align || 'left';
			oLabel.baseline = baseline || 'middle';
			oLabel.mono = mono !== false;
			oLabel.bg = bg || null;
			D.label(g, text, x, y, oLabel);
		}

		/* ---------------- 物理 ---------------- */
		var st = { tl: 0, tr: 0, net: 0, state: '', target: 0 };

		function compute() {
			var tl = 0;
			var tr = 0;
			if (x1 < 0) tl += m1 * G * -x1; else if (x1 > 0) tr += m1 * G * x1;
			if (x2 < 0) tl += m2 * G * -x2; else if (x2 > 0) tr += m2 * G * x2;
			st.tl = tl;
			st.tr = tr;
			st.net = tl - tr;                       /* 正 = 左邊力矩大 → 左沉 */
			if (Math.abs(st.net) < BAL_TOL) st.state = '平衡';
			else if (st.net > 0) st.state = '左沉';
			else st.state = '右沉';
			/* 板子傾角: 右邊力矩大就右端下沉 (canvas 的 +θ = 順時針) */
			st.target = MAX_TILT * Math.tanh((tr - tl) / SKEW_K);
			return st;
		}

		/* ---------------- DOM ---------------- */
		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		var hint = el('p', 'dl-hint', '拖動砝碼');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel');

		function field(group, label, min, max, step, val, aria) {
			var f = el('div', 'dl-field');
			f.appendChild(el('span', 'dl-field__label', label));
			var input = el('input', 'dl-range');
			input.type = 'range';
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(val);
			input.setAttribute('aria-label', aria);
			var out = el('output', 'dl-field__val', '—');
			f.appendChild(input);
			f.appendChild(out);
			group.appendChild(f);
			return { input: input, out: out };
		}

		var gM = el('div', 'dl-panel__group');
		gM.appendChild(el('span', 'dl-panel__label', '質量'));
		var fM1 = field(gM, '木箱 m₁', 0.5, 10, 0.1, m1, '木箱質量（公斤）');
		var fM2 = field(gM, '鐵塊 m₂', 0.5, 10, 0.1, m2, '鐵塊質量（公斤）');

		var gD = el('div', 'dl-panel__group');
		gD.appendChild(el('span', 'dl-panel__label', '位置（支點為 0，向右為正）'));
		var fD1 = field(gD, '木箱位置', D_MIN, D_MAX, SNAP, x1, '木箱到支點的距離（公尺），向右為正');
		var fD2 = field(gD, '鐵塊位置', D_MIN, D_MAX, SNAP, x2, '鐵塊到支點的距離（公尺），向右為正');

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}
		var rds = el('div', 'dl-readouts');
		var rdL = cell('τ_left');
		var rdR = cell('τ_right');
		var rdN = cell('Στ');
		var rdS = cell('狀態');
		rdL.v.classList.add('fc-accent');
		rdN.v.classList.add('fc-accent');
		rds.appendChild(rdL.root);
		rds.appendChild(rdR.root);
		rds.appendChild(rdN.root);
		rds.appendChild(rdS.root);

		var texBox = el('div', 'fc-tex');
		var texA = el('span', 'fc-tex__row', '');
		var texB = el('span', 'fc-tex__sub', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gM);
		panel.appendChild(gD);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 ---------------- */
		var NOTE = '平衡看的是力矩 τ = F·d⊥，不是重量：2 kg 在 1.00 m 與 4 kg 在 0.50 m 力矩相同。' +
			'板子傾角只表示哪邊沉（最大 18°），讀數一律按水平位時的量度計算。';
		var REDUCED = ' 已依系統設定暫停動態。';
		var lastA = '';
		var lastB = '';

		function setTeX(node, text, lastText) {
			if (text === lastText) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function posText(d) {
			if (Math.abs(d) < 0.001) return '0.00 m';
			return fix2(d) + ' m';
		}

		function syncUI() {
			var s = compute();
			fM1.out.textContent = ctx.fmt(m1, 1) + ' kg';
			fM2.out.textContent = ctx.fmt(m2, 1) + ' kg';
			fD1.out.textContent = posText(x1);
			fD2.out.textContent = posText(x2);

			rdL.v.textContent = ctx.fmt(s.tl, 2) + ' N·m';
			rdR.v.textContent = ctx.fmt(s.tr, 2) + ' N·m';
			rdN.v.textContent = (s.net > 0.005 ? '+' : '') + ctx.fmt(s.net, 2) + ' N·m';
			rdS.v.textContent = s.state;
			rdS.v.classList.toggle('fc-accent', s.state !== '平衡');

			lastA = setTeX(texA, '\\( \\tau = F d_\\perp \\), \\( \\Sigma\\tau = 0 \\)', lastA);
			lastB = setTeX(texB,
				'\\( \\tau_1 = ' + ctx.fmt(m1, 1) + '\\times 9.81\\times ' + ctx.fmt(Math.abs(x1), 2) +
				' = ' + ctx.fmt(m1 * G * Math.abs(x1), 2) + ' \\)',
				lastB);

			note.textContent = NOTE + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖 ---------------- */

		function drawSky(g, W, H, groundY) {
			var sky = g.createLinearGradient(0, 0, 0, groundY);
			sky.addColorStop(0, K.skyTop);
			sky.addColorStop(1, K.skyLow);
			g.fillStyle = sky;
			g.fillRect(0, 0, W, groundY);
			/* 遠處樹籬: 一條帶起伏的窄帶, 讓地平線不是一把尺 */
			g.fillStyle = K.hedge;
			g.beginPath();
			g.moveTo(0, groundY);
			var step = Math.max(10, W / 26);
			for (var x = 0; x <= W + step; x += step) {
				g.lineTo(x, groundY - Math.max(4, H * 0.022) - Math.sin(x * 0.09) * H * 0.008 - H * 0.006);
			}
			g.lineTo(W, groundY);
			g.closePath();
			g.fill();
			/* 草地 */
			g.fillStyle = K.grass;
			g.fillRect(0, groundY, W, H - groundY);
			g.fillStyle = K.grassDark;
			g.fillRect(0, groundY, W, Math.max(1.5, H * 0.008));
			/* 草叢 */
			g.strokeStyle = K.tuft;
			g.lineWidth = 1;
			g.beginPath();
			var tuft = Math.max(14, W / 18);
			for (var tx = tuft * 0.5; tx < W; tx += tuft) {
				var h = Math.max(2, H * 0.022);
				g.moveTo(tx, groundY + h + 3);
				g.lineTo(tx + h * 0.4, groundY + 3);
				g.moveTo(tx + h * 0.8, groundY + h + 3);
				g.lineTo(tx + h * 0.4, groundY + 3);
			}
			g.stroke();
		}

		function drawPivot(g, px, plankY, groundY, W) {
			var half = Math.max(12, W * 0.055);
			var h = groundY - plankY;
			g.fillStyle = K.pivot;
			g.beginPath();
			g.moveTo(px, plankY);
			g.lineTo(px + half, groundY);
			g.lineTo(px - half, groundY);
			g.closePath();
			g.fill();
			/* 受光面: 左半再畫一次, 三角形才有厚度 */
			g.fillStyle = K.pivotDark;
			g.beginPath();
			g.moveTo(px, plankY);
			g.lineTo(px + half, groundY);
			g.lineTo(px + half * 0.24, groundY);
			g.closePath();
			g.fill();
			/* 支點銷 */
			D.dot(g, px, plankY, Math.max(2.4, h * 0.06), { color: K.pivotDark, fill: C.paper0, stroke: true, width: 1.2 });
		}

		function drawBox(g, dx, w, h, kind, label, massText, th) {
			/* 已經在板子的旋轉座標系裡: 直上直下畫就好 */
			var x0 = dx - w * 0.5;
			var y0 = -th * 0.5 - h;
			if (kind === 'crate') {
				g.fillStyle = K.crate;
				g.fillRect(x0, y0, w, h);
				g.fillStyle = K.crateDark;
				g.fillRect(x0, y0, w, Math.max(1, h * 0.10));
				g.fillRect(x0, y0 + h * 0.48, w, Math.max(1, h * 0.07));
				g.fillStyle = K.crateLit;
				g.fillRect(x0 + w * 0.08, y0 + h * 0.14, w * 0.10, h * 0.30);
			} else {
				g.fillStyle = K.metal;
				g.fillRect(x0, y0, w, h);
				g.fillStyle = K.metalLit;
				g.fillRect(x0, y0, w, Math.max(1.5, h * 0.17));
				g.fillStyle = K.metalDark;
				g.fillRect(x0, y0 + h - Math.max(1, h * 0.10), w, Math.max(1, h * 0.10));
			}
			g.strokeStyle = 'rgba(20,17,13,0.35)';
			g.lineWidth = 1;
			g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
			if (h > 14) {
				g.fillStyle = kind === 'crate' ? '#2c1f12' : '#1d2226';
				g.font = '400 10px ' + mono();
				g.textAlign = 'center';
				g.textBaseline = 'middle';
				g.fillText(label, dx, y0 + h * 0.33);
				g.fillText(massText, dx, y0 + h * 0.68);
			}
		}

		var fontCache = '';
		function mono() {
			if (!fontCache) {
				var cs = window.getComputedStyle(doc.documentElement);
				fontCache = (cs.getPropertyValue('--font-mono') || 'monospace').trim();
			}
			return fontCache;
		}

		/* 力矩的弧形箭頭: 繞支點, 箭頭指向「這一邊往下掉」的方向 */
		function arcArrow(g, cx, cy, r, a0, a1, color) {
			D.arc(g, cx, cy, r, a0, a1, { color: color, width: 1.6, ccw: a1 < a0 });
			var sgn = a1 < a0 ? -1 : 1;
			var tx = -Math.sin(a1) * sgn;
			var ty = Math.cos(a1) * sgn;
			var ex = cx + Math.cos(a1) * r;
			var ey = cy + Math.sin(a1) * r;
			var head = Math.max(5, r * 0.22);
			g.strokeStyle = color;
			g.lineWidth = 1.6;
			g.beginPath();
			g.moveTo(ex, ey);
			g.lineTo(ex - tx * head + Math.cos(a1) * head * 0.55, ey - ty * head + Math.sin(a1) * head * 0.55);
			g.moveTo(ex, ey);
			g.lineTo(ex - tx * head - Math.cos(a1) * head * 0.55, ey - ty * head - Math.sin(a1) * head * 0.55);
			g.stroke();
		}

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 60 || H < 44) return;

			var s = compute();
			/* 暫停動態時不跑彈簧: 直接停在這一組數值的靜平衡角, 控制項仍然看得出差別 */
			if (ctx.reduced) { angle = s.target; vel = 0; }
			var m = cl(Math.min(W, H) * 0.03, 5, 14);
			var groundY = H * 0.80;
			var plankY = H * 0.575;
			var px = W * 0.5;
			var scale = (W * 0.5 - m - 4) / HALF_PLANK;     /* px / m */
			var th = cl(H * 0.022, 2.5, 9);                  /* 板厚 */

			last.px = px;
			last.s = scale;
			last.ang = angle;
			last.th = th;

			drawSky(g, W, H, groundY);

			var halfPx = HALF_PLANK * scale;
			var w1 = CRATE_W * scale;
			var h1 = 0.30 * scale;
			var w2 = BLOCK_W * scale;
			var h2 = 0.25 * scale;

			/* 兩個砝碼在板子座標系裡的方框: 量度標籤要不要讓位就看這個 */
			var bx1 = x1 * scale - w1 * 0.5;
			var by1 = -th * 0.5 - h1;
			var bx2 = x2 * scale - w2 * 0.5;
			var by2 = -th * 0.5 - h2;
			var belowBottom = 0;      /* 落到板下的量度標籤, 最低的那一條 (世界座標) */
			var belowLabels = [];     /* 讓到板下的量度標籤: 支點畫完才畫, 免得被三角形蓋住 */
			function hitsBody(bx, by, bw, bh) {
				return (bx < bx1 + w1 && bx + bw > bx1 && by < by1 + h1 && by + bh > by1) ||
					(bx < bx2 + w2 && bx + bw > bx2 && by < by2 + h2 && by + bh > by2);
			}

			/* 板子與砝碼: 一次座標變換, 世界座標的傾角就自動帶進來 */
			g.save();
			g.translate(px, plankY);
			g.rotate(angle);

			g.fillStyle = K.wood;
			g.fillRect(-halfPx, -th * 0.5, halfPx * 2, th);
			g.fillStyle = K.woodDark;
			g.fillRect(-halfPx, th * 0.5 - Math.max(1, th * 0.30), halfPx * 2, Math.max(1, th * 0.30));
			g.fillStyle = K.woodLit;
			g.fillRect(-halfPx, -th * 0.5, halfPx * 2, Math.max(1, th * 0.18));
			/* 木紋 */
			g.strokeStyle = 'rgba(90,58,28,0.30)';
			g.lineWidth = 1;
			g.beginPath();
			for (var gi = 1; gi < 5; gi++) {
				var gy = -th * 0.5 + th * (gi / 5);
				g.moveTo(-halfPx + 3, gy);
				g.lineTo(halfPx - 3, gy);
			}
			g.stroke();

			/* 量度線: 從支點拉到砝碼中心, 畫在板子下方 */
			var sameSide = (x1 < 0) === (x2 < 0) && Math.abs(x1) > 0.001 && Math.abs(x2) > 0.001;
			function dim(d, ratio, text, color) {
				var dx = d * scale;
				if (Math.abs(dx) < 6) return;
				var y = -(th * 0.5 + 7);   /* 量度畫在板上方: 下方那一列留給力矩 */
				g.strokeStyle = color;
				g.lineWidth = 1;
				g.setLineDash([]);
				g.beginPath();
				g.moveTo(0, y);
				g.lineTo(dx, y);
				g.stroke();
				g.beginPath();
				g.moveTo(0, y - 3.5); g.lineTo(0, y + 3.5);
				g.moveTo(dx, y - 3.5); g.lineTo(dx, y + 3.5);
				g.stroke();
				g.beginPath();
				g.moveTo(dx, y);
				g.lineTo(dx - Math.sign(dx) * 5, y - 2.6);
				g.moveTo(dx, y);
				g.lineTo(dx - Math.sign(dx) * 5, y + 2.6);
				g.moveTo(0, y);
				g.lineTo(Math.sign(dx) * 5, y - 2.6);
				g.moveTo(0, y);
				g.lineTo(Math.sign(dx) * 5, y + 2.6);
				g.stroke();
				/* 標籤放哪: 慣例在量度線上方; 但量度比標籤本身還短、或標籤會被任何
				   一個砝碼蓋住時, 改落到板子下方那一列 (量度線與端點刻度都不動) */
				g.fillStyle = color;
				g.font = '400 10px ' + mono();
				g.textAlign = 'center';
				var tw = g.measureText(text).width;
				var lx = dx * ratio;
				var below = Math.abs(dx) < tw + 8 || hitsBody(lx - tw * 0.5, -(th * 0.5 + 19), tw, 10);
				if (below) {
					/* 記下來, 等支點畫完再畫: 否則三角形的灰面會蓋掉字 */
					belowLabels.push({ text: text, x: dx, color: color });
					var ca = Math.cos(angle);
					var sa = Math.sin(angle);
					var wBottom = plankY + dx * sa + (th * 0.5 + 14) * ca;
					if (wBottom > belowBottom) belowBottom = wBottom;
				} else {
					g.textBaseline = 'bottom';
					g.fillText(text, lx, y - 2);
				}
			}
			/* 同側時兩個標籤沿自己的量度線錯開, 不疊在同一點 */
			/* 0.40: 標籤靠支點這一側, 才不會壓到量度線另一端的那個砝碼。
			   270px 的畫布上兩個 60px 的標籤擠不進同一列, 那裡就不帶單位 (滑桿與讀數都有 m) */
			var narrow = W < 380;
			dim(x1, 0.40, narrow ? fix2(Math.abs(x1)) : 'd₁ ' + fix2(Math.abs(x1)) + ' m', C.inkDim);
			dim(x2, sameSide ? 0.66 : 0.40,
				narrow ? fix2(Math.abs(x2)) : 'd₂ ' + fix2(Math.abs(x2)) + ' m', C.inkDim);

			drawBox(g, x1 * scale, w1, h1, 'crate', 'm₁', ctx.fmt(m1, 1) + ' kg', th);
			drawBox(g, x2 * scale, w2, h2, 'metal', 'm₂', ctx.fmt(m2, 1) + ' kg', th);

			g.restore();

			drawPivot(g, px, plankY, groundY, W);

			/* 板下的量度標籤: 貼在量度線末端那一側, 帶紙色底板 (底下的支點是灰的) */
			if (belowLabels.length) {
				g.save();
				g.translate(px, plankY);
				g.rotate(angle);
				for (var bl = 0; bl < belowLabels.length; bl++) {
					lbl(g, belowLabels[bl].text, belowLabels[bl].x, th * 0.5 + 4 + 5,
						belowLabels[bl].color, 10, 'center', 'middle', true, C.paper0);
				}
				g.restore();
			}

			/* 兩側力矩: 弧形箭頭繞支點, 一左一右 */
			var r = cl((groundY - plankY) * 0.60, 13, 40);
			var a0L = Math.PI * (212 / 180);
			var a1L = Math.PI * (140 / 180);
			var a0R = Math.PI * (328 / 180);
			var a1R = Math.PI * (400 / 180);
			arcArrow(g, px, plankY, r, a0L, a1L, s.tl > 0.005 ? C.accent : C.inkFaint);
			arcArrow(g, px, plankY, r, a0R, a1R, s.tr > 0.005 ? C.accent : C.inkFaint);

			/* 力矩數值緊貼自己的弧 (板下)。若量度標籤剛好也落到板下, 這一列再往下讓,
			   但最多讓到貼近草地為止 (320px 上真的沒有第三列) */
			var ly = plankY + th * 0.5 + 26;
			if (belowBottom > 0) ly = Math.max(ly, belowBottom + 6);
			ly = Math.min(ly, groundY - 2);
			/* 被推到貼近草地時給它一塊紙色底板, 否則紅色字壓在綠草上看不清 */
			var tauPlate = belowBottom > 0 && ly + 10 > groundY - 4 ? C.paper0 : null;
			lbl(g, 'τ₁ ' + ctx.fmt(s.tl, 2), px - r - Math.max(6, W * 0.012), ly,
				s.tl > 0.005 ? C.accent : C.inkFaint, 10, 'right', 'top', true, tauPlate);
			lbl(g, 'τ₂ ' + ctx.fmt(s.tr, 2), px + r + Math.max(6, W * 0.012), ly,
				s.tr > 0.005 ? C.accent : C.inkFaint, 10, 'left', 'top', true, tauPlate);

			/* 支點高度: 草地上的一行註記, 不在板子與弧形箭頭爭空間 */
			lbl(g, '支點高 0.42 m', px, groundY + (H - groundY) * 0.62, C.paper1, 10, 'center', 'middle', true, null);

			/* 拖曳提示: 抓得到的地方給一個小方塊 */
			if (dragging) {
				D.handle(g, px + Math.cos(angle) * x1 * scale,
					plankY + Math.sin(angle) * x1 * scale, { color: C.accent, fill: C.paper0, size: 9, width: 1.2 });
			}
		}

		/* ---------------- 互動 ---------------- */

		function setMass(which, v) {
			if (!isFinite(v)) return;
			var n = cl(Math.round(v * 10) / 10, 0.5, 10);
			if (which === 1) m1 = n; else m2 = n;
			(which === 1 ? fM1 : fM2).input.value = String(n);
			syncUI();
			draw();
		}

		/* 兩個都是實體: 中心距不得小於半寬和 + 2px。被拖/被推的那一個讓開 (推回去,
		   不是穿過去); 只有「讓開的那一側剛好頂到行程盡頭」才退到另一側, 兩邊都滿
		   就原地不動。跨過支點仍然允許 —— 換邊只是力矩變號, 重疊才是不可能狀態。 */
		function gapM() {
			var sc = last.s > 1 ? last.s : 1;
			return (CRATE_W + BLOCK_W) * 0.5 + MIN_GAP_PX / sc;
		}

		function keepApart(which, n, noPass) {
			var other = which === 1 ? x2 : x1;
			var prev = which === 1 ? x1 : x2;
			var gap = gapM();
			var fromPrev = prev - other;
			var diff = n - other;
			/* 這一格是從哪一邊靠近的: 有歷史就看歷史, 沒有才看目標那一邊 */
			var side = Math.abs(fromPrev) > 1e-9 ? (fromPrev > 0 ? 1 : -1)
				: Math.abs(diff) > 1e-9 ? (diff > 0 ? 1 : -1)
					: (which === 1 ? -1 : 1);
			var nSide = diff > 0 ? 1 : diff < 0 ? -1 : side;
			/* 拖曳是連續位移: 實體不能從另一個實體身上走過去 (取樣跳得太大時才擋得住)。
			   滑桿是一次「拿起來放到那裡」, 允許換邊, 只要落地不重疊。 */
			var crossed = noPass && Math.abs(fromPrev) > 1e-9 && nSide !== side;
			if (Math.abs(diff) >= gap && !crossed) return n;
			var cand = snapAway(other + side * gap, side);
			if (cand > D_MAX + 1e-9 || cand < D_MIN - 1e-9) {
				/* 這一側正好頂到行程盡頭: 才退到另一側, 否則拖到端點就卡死 */
				cand = snapAway(other - side * gap, -side);
				if (cand > D_MAX + 1e-9 || cand < D_MIN - 1e-9) return prev;
			}
			return cand;
		}

		function setPos(which, v, isDrag) {
			if (!isFinite(v)) return;
			var n = cl(snap(v), D_MIN, D_MAX);
			if (Math.abs(n) < SNAP * 0.4) n = 0;
			n = keepApart(which, n, !!isDrag);
			if (which === 1) x1 = n; else x2 = n;
			/* 夾開之後滑桿要跟著回寫, 否則拇指停在一個不存在的值上 */
			(which === 1 ? fD1 : fD2).input.value = String(n);
			syncUI();
			draw();
		}

		fM1.input.addEventListener('input', function () { setMass(1, parseFloat(fM1.input.value)); });
		fM2.input.addEventListener('input', function () { setMass(2, parseFloat(fM2.input.value)); });
		fD1.input.addEventListener('input', function () { setPos(1, parseFloat(fD1.input.value)); });
		fD2.input.addEventListener('input', function () { setPos(2, parseFloat(fD2.input.value)); });

		function localOf(e) {
			var rect = canvas.getBoundingClientRect();
			var mx = e.clientX - rect.left;
			var my = e.clientY - rect.top;
			var dx = mx - last.px;
			var dy = my - plankYof();
			var ca = Math.cos(last.ang);
			var sa = Math.sin(last.ang);
			return { x: dx * ca + dy * sa, y: -dx * sa + dy * ca, mx: mx, my: my };
		}

		function plankYof() { return view.h * 0.575; }

		function hit(e) {
			var p = localOf(e);
			var scale = last.s;
			var th = last.th;
			var w1 = CRATE_W * scale;
			var h1 = 0.30 * scale;
			var w2 = BLOCK_W * scale;
			var h2 = 0.25 * scale;
			var c1x = x1 * scale;
			var c1y = -th * 0.5 - h1 * 0.5;
			var c2x = x2 * scale;
			var c2y = -th * 0.5 - h2 * 0.5;
			var gap = 12;
			var d1 = Math.abs(p.x - c1x) < w1 * 0.5 + gap && Math.abs(p.y - c1y) < h1 * 0.5 + gap;
			var d2 = Math.abs(p.x - c2x) < w2 * 0.5 + gap && Math.abs(p.y - c2y) < h2 * 0.5 + gap;
			if (d1 && d2) return Math.abs(p.x - c1x) < Math.abs(p.x - c2x) ? 1 : 2;
			if (d1) return 1;
			if (d2) return 2;
			return 0;
		}

		function pointerPos(e) {
			var p = localOf(e);
			return p.x / last.s;
		}

		canvas.addEventListener('pointerdown', function (e) {
			var which = hit(e);
			if (!which) return;
			dragging = which;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件沒有可捕捉的指標 */ }
			e.preventDefault();
			setPos(which, pointerPos(e), true);
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			setPos(dragging, pointerPos(e), true);
		});

		function endDrag(e) {
			if (!dragging) return;
			dragging = 0;
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
				canvas.releasePointerCapture(e.pointerId);
			}
			draw();
		}
		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);

		ctx.onResize(draw);
		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				var t = st.target;
				var k = 45;
				var c = 2 * Math.sqrt(k);
				var acc = k * (t - angle) - c * vel;
				vel += acc * dt;
				angle += vel * dt;
				if (Math.abs(t - angle) < 1e-4 && Math.abs(vel) < 1e-4) { angle = t; vel = 0; }
				draw();
			});
		}

		return {
			destroy: function () { view = null; }
		};
	});
})();
