/**
 * ch2-fbd-newton.js — 受力圖與 F = ma (DSE 物理 · II.b · 實驗 03)
 *
 * 為什麼一定要先畫隔離體圖: 「合力」不是某一個推力, 而是把所有力搬到同一個原點
 * 之後的向量和。畫面上四支箭頭共用同一個起點、外面再框一個虛線框, 學生才會看到
 * N 和 W 會互相抵掉一部分、F 的垂直分量會把 N 壓小, 而 f 是由 N 決定的。
 *
 * 兩個模式共用 m 與 μ: 上斜面的時候沒有施力 F, a 只剩 g(sinφ − μcosφ),
 * 這正是同一條 F = ma 的另一個投影。
 */
(function () {
	'use strict';

	var G = 9.81;

	window.DSELab.define('fbd-newton', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */

		var mode = 'flat';       /* flat | incline */
		var m = 2;               /* kg */
		var F = 10;              /* N */
		var th = 0;              /* 施力角 度 */
		var mu = 0.3;            /* 摩擦係數 */
		var phi = 30;            /* 斜面角 度 */
		var phase = 0;
		var dragging = false;

		var view = null;
		var canvas = null;

		/* 每幀重算, 拖曳時要把指標位置換回 (F, θ) */
		var geo = { cx: 0, cy: 0, k: 1, mode: 'flat', bx: 0, by: 0 };

		var oLine = { color: '', width: 1, dash: null };
		var oArrow = { color: '', width: 1.4, head: 7, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };
		var oHandle = { color: '', fill: '', size: 9, width: 1.2 };
		var oDot = { color: '', fill: '', stroke: false, width: 1 };

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		function num(v, d) {
			if (typeof v !== 'number' || !isFinite(v)) return '—';
			if (Math.abs(v) < 5e-4) v = 0;
			return v.toFixed(d);
		}

		function ln(g, x1, y1, x2, y2, color, width, dash) {
			oLine.color = color;
			oLine.width = width;
			oLine.dash = dash || null;
			D.line(g, x1, y1, x2, y2, oLine);
		}

		function arw(g, x1, y1, x2, y2, color, width, head, dash) {
			oArrow.color = color;
			oArrow.width = width;
			oArrow.head = head;
			oArrow.dash = dash || null;
			D.arrow(g, x1, y1, x2, y2, oArrow);
		}

		function lbl(g, text, x, y, color, size, align, baseline, bg) {
			oLabel.color = color;
			oLabel.size = size;
			oLabel.align = align || 'left';
			oLabel.baseline = baseline || 'middle';
			oLabel.bg = bg || null;
			D.label(g, text, x, y, oLabel);
		}

		function dot(g, x, y, r, color) {
			oDot.color = color;
			oDot.fill = color;
			oDot.stroke = false;
			oDot.width = 1;
			D.dot(g, x, y, r, oDot);
		}

		var RAD = Math.PI / 180;

		/* ---------------- 物理 ---------------- */

		var st = {
			W: 0, N: 0, f: 0, fmax: 0, Fx: 0, Fnet: 0, a: 0,
			lift: false, still: false, moving: false, Fsin: 0, Fcos: 0, drive: 0
		};

		/* 靜摩擦不是 μN: μN 只是上限。推不動的時候, 摩擦力剛好等於推力,
		   合力是 0、a 是 0 —— 否則 F = ma 這一頁自己就先矛盾了。 */
		function compute() {
			var W = m * G;
			st.W = W;
			if (mode === 'flat') {
				var sn = Math.sin(th * RAD);
				var cs = Math.cos(th * RAD);
				st.Fsin = F * sn;
				st.Fcos = F * cs;
				st.lift = st.Fsin >= W - 1e-9;
				st.N = st.lift ? 0 : Math.max(0, W - st.Fsin);
				st.fmax = st.lift ? 0 : mu * st.N;
				st.drive = 0;
				st.Fx = st.Fcos;
			} else {
				var p = phi * RAD;
				st.Fsin = 0;
				st.Fcos = 0;
				st.lift = false;
				st.N = W * Math.cos(p);
				st.fmax = mu * st.N;
				st.drive = W * Math.sin(p);
				st.Fx = st.drive;
			}
			st.moving = st.Fx > st.fmax + 1e-9;
			st.still = !st.moving;
			st.f = st.moving ? st.fmax : st.Fx;
			st.Fnet = st.moving ? st.Fx - st.fmax : 0;
			st.a = st.moving ? st.Fnet / m : 0;
			return st;
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		var hint = el('p', 'dl-hint', '拖動 F 箭頭的尖端：同時改大小與角度');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel');

		var gMode = el('div', 'dl-panel__group');
		gMode.appendChild(el('span', 'dl-panel__label', '模式'));
		var seg = el('div', 'dl-seg');
		var btnFlat = el('button', 'dl-btn is-on', '水平面');
		var btnInc = el('button', 'dl-btn', '斜面');
		btnFlat.type = 'button';
		btnInc.type = 'button';
		btnFlat.setAttribute('aria-pressed', 'true');
		btnInc.setAttribute('aria-pressed', 'false');
		seg.appendChild(btnFlat);
		seg.appendChild(btnInc);
		gMode.appendChild(seg);

		function field(labelTxt, ariaTxt, min, max, step, val) {
			var f = el('div', 'dl-field');
			f.appendChild(el('span', 'dl-field__label', labelTxt));
			var inp = el('input', 'dl-range');
			inp.type = 'range';
			inp.min = String(min);
			inp.max = String(max);
			inp.step = String(step);
			inp.value = String(val);
			inp.setAttribute('aria-label', ariaTxt);
			var out = el('output', 'dl-field__val', '');
			f.appendChild(inp);
			f.appendChild(out);
			return { root: f, inp: inp, out: out };
		}

		var gObj = el('div', 'dl-panel__group');
		gObj.appendChild(el('span', 'dl-panel__label', '物體與摩擦'));
		var fM = field('質量 m', '質量（公斤）', 1, 10, 0.1, m);
		var fMu = field('摩擦係數 μ', '摩擦係數', 0, 0.8, 0.01, mu);
		gObj.appendChild(fM.root);
		gObj.appendChild(fMu.root);

		var gPush = el('div', 'dl-panel__group');
		gPush.appendChild(el('span', 'dl-panel__label', '施力'));
		var fF = field('施力 F', '施力（牛頓）', 0, 60, 0.5, F);
		var fTh = field('角度 θ', '施力與水平面的夾角（度）', 0, 80, 5, th);
		gPush.appendChild(fF.root);
		gPush.appendChild(fTh.root);

		var gInc = el('div', 'dl-panel__group kn-off');
		gInc.appendChild(el('span', 'dl-panel__label', '斜面'));
		var fPhi = field('傾角 φ', '斜面傾角（度）', 0, 35, 1, phi);
		gInc.appendChild(fPhi.root);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}

		var rds = el('div', 'dl-readouts kn-rd');
		var rdW = cell('W');
		var rdN = cell('N');
		var rdF = cell('f');
		var rdNet = cell('F_net');
		var rdA = cell('a');
		rdA.root.classList.add('kn-wide');
		rds.appendChild(rdW.root);
		rds.appendChild(rdN.root);
		rds.appendChild(rdF.root);
		rds.appendChild(rdNet.root);
		rds.appendChild(rdA.root);

		var texBox = el('div', 'kn-formula');
		var texA = el('div', 'kn-formula__tex', '\\( F_{net} = ma \\)　\\( W = mg \\)');
		var texB = el('p', 'kn-formula__sub', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);
		ctx.tex(texA);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gObj);
		panel.appendChild(gPush);
		panel.appendChild(gInc);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 ---------------- */

		var REDUCED = ' 已依系統設定暫停動態。';
		var lastSub = '';

		function syncUI() {
			var s = compute();
			fM.out.textContent = num(m, 1) + ' kg';
			fMu.out.textContent = num(mu, 2);
			fF.out.textContent = num(F, 1) + ' N';
			fTh.out.textContent = num(th, 0) + '°';
			fPhi.out.textContent = num(phi, 0) + '°';

			rdW.v.textContent = num(s.W, 2) + ' N';
			rdN.v.textContent = num(s.N, 2) + ' N';
			rdF.v.textContent = num(s.f, 2) + ' N';
			rdNet.v.textContent = num(s.Fnet, 2) + ' N';
			rdA.v.textContent = (s.still ? '0' : num(s.a, 2)) + ' m/s²';
			rdA.v.classList.toggle('kn-acc', !s.still);
			rdNet.v.classList.toggle('kn-acc', !s.still);
			rdN.v.classList.toggle('kn-mute', s.lift);

			var sub;
			if (mode === 'flat') {
				if (s.lift) {
					sub = 'F sinθ = ' + num(s.Fsin, 2) + ' N ≥ mg = ' + num(s.W, 2) +
						' N：離地, N = 0, f = 0, a = F cosθ/m = ' + num(s.a, 2) + ' m/s²';
				} else if (s.still) {
					sub = 'F cosθ = ' + num(s.Fx, 2) + ' N < μN = ' + num(s.fmax, 2) +
						' N：摩擦力只出到 ' + num(s.f, 2) + ' N，F_net = 0';
				} else {
					sub = 'N = mg − F sinθ = ' + num(s.W, 2) + ' − ' + num(s.Fsin, 2) + ' = ' + num(s.N, 2) +
						' N · f = μN = ' + num(s.f, 2) + ' N · a = (F cosθ − f)/m = ' + num(s.a, 2) + ' m/s²';
				}
			} else if (s.still) {
				sub = 'μN = ' + num(s.fmax, 2) + ' N ≥ mg sinφ = ' + num(s.drive, 2) +
					' N：靜摩擦夠，f 只出到 ' + num(s.f, 2) + ' N，a = 0';
			} else {
				sub = 'a = g(sinφ − μcosφ) = 9.81 × (' + num(Math.sin(phi * RAD), 3) + ' − ' +
					num(mu * Math.cos(phi * RAD), 3) + ') = ' + num(s.a, 2) + ' m/s²';
			}
			if (sub !== lastSub) {
				texB.textContent = sub;
				lastSub = sub;
			}

			var msg;
			if (mode === 'flat') {
				msg = s.lift
					? 'F sinθ ≥ mg：物體離地，N = 0，摩擦力也跟著消失；讀數 a 是水平分量 F cosθ/m。'
					: (s.still ? '靜摩擦足以抵消（未起動）：F cosθ 沒有超過 μN，摩擦力只出到這麼多。'
						: '合力 = F cosθ − f，方向向右。');
				msg += ' 正向力不一定等於 mg：F 的垂直分量會把它壓小。';
			} else {
				msg = s.still ? 'μ 夠大，物體靜止在斜面上（a = 0）。' : '下滑的驅動力是 mg sinφ，不是 mg。';
				msg += ' 斜面沒有施力 F。';
			}
			note.textContent = msg + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖 ---------------- */

		function hatch(g, x1, x2, y, color) {
			var x;
			for (x = x1; x < x2; x += 9) {
				ln(g, x, y, x - 6, y + 6, color, 1, null);
			}
		}

		/* 木箱: 以 (cx, cy) 為中心, 邊長 b */
		function crate(g, cx, cy, b) {
			var half = b / 2;
			g.fillStyle = '#c8a271';
			g.fillRect(cx - half, cy - half, b, b);
			g.strokeStyle = 'rgba(60, 40, 20, 0.75)';
			g.lineWidth = 1;
			g.strokeRect(Math.round(cx - half) + 0.5, Math.round(cy - half) + 0.5, Math.round(b), Math.round(b));
			ln(g, cx - half, cy - half + b * 0.30, cx + half, cy - half + b * 0.30, 'rgba(60, 40, 20, 0.35)', 1, null);
			ln(g, cx - half, cy - half + b * 0.70, cx + half, cy - half + b * 0.70, 'rgba(60, 40, 20, 0.35)', 1, null);
			ln(g, cx + half * 0.18, cy - half, cx + half * 0.18, cy + half, 'rgba(60, 40, 20, 0.22)', 1, null);
		}

		function drawFlat(g, W, H, m0) {
			var s = st;
			var b = ctx.clamp(Math.min(W, H) * 0.17, 22, 56);
			var yF = H * 0.72;
			var cx = W * 0.50;
			var cy = yF - b / 2;

			/* 四支箭頭都從質心出發(FBD 的慣例), 長度用同一比例 k, 所以長短可直接比較。
			   k 先被「四邊都要留得下標籤」壓一次, 再被整體上限壓一次。 */
			var kCap = (H * 0.20) / Math.max(s.W, F, 1);
			var kDown = (H - m0 - 26 - cy) / Math.max(s.W, 0.6);
			var kUp = (cy - m0 - 30) / Math.max(s.N, 0.6);
			var kLeft = (cx - m0 - 78) / Math.max(s.f, 0.6);
			var kRight = (W - m0 - 26 - cx) / Math.max(F * Math.cos(th * RAD), 0.6);
			var k = Math.max(0.35, Math.min(kCap, kDown, kUp, kLeft, kRight));

			geo.mode = 'flat';
			geo.cx = cx;
			geo.cy = cy;
			geo.k = k;
			geo.bx = b;

			/* 地面 */
			ln(g, m0, yF + 0.5, W - m0, yF + 0.5, C.inkDim, 1.2, null);
			hatch(g, m0 + 2, W - m0, yF + 1, 'rgba(20, 17, 13, 0.28)');

			crate(g, cx, cy, b);
			dot(g, cx, cy, 1.6, C.ink);

			var tipW = { x: cx, y: cy + s.W * k };
			var tipN = { x: cx, y: cy - s.N * k };
			var tipF = { x: cx - s.f * k, y: cy };
			var dirx = Math.cos(th * RAD);
			var diry = -Math.sin(th * RAD);
			var tipP = { x: cx + F * k * dirx, y: cy + F * k * diry };

			/* W */
			arw(g, cx, cy, tipW.x, tipW.y, C.ink, 1.5, 7, null);
			lbl(g, 'W = ' + num(s.W, 2) + ' N', tipW.x + 6, tipW.y, C.ink, 10, 'left', 'middle', C.paper0);

			/* N */
			if (s.N > 0.005) {
				arw(g, cx, cy, tipN.x, tipN.y, C.ink, 1.5, 7, null);
				lbl(g, 'N = ' + num(s.N, 2) + ' N', tipN.x + 6, tipN.y, C.ink, 10, 'left', 'middle', C.paper0);
			} else {
				lbl(g, 'N = 0（離地）', cx + b / 2 + 8, cy - b / 2 - 4, C.accent, 10, 'left', 'middle', C.paper0);
			}

			/* f: 與即將發生的運動反向 */
			if (s.f > 0.005) {
				arw(g, cx, cy, tipF.x, tipF.y, C.ink, 1.5, 7, null);
				lbl(g, 'f = ' + num(s.f, 2) + ' N',
					Math.max(m0 + 74, Math.min(tipF.x - 6, cx - b / 2 - 8)), tipF.y,
					C.ink, 10, 'right', 'middle', C.paper0);
			}

			/* F 與它的兩個分量 */
			if (F > 0.01) {
				if (s.Fsin > 0.15) {
					ln(g, cx, cy, tipP.x, cy, C.inkFaint, 1, [4, 3]);
					ln(g, tipP.x, cy, tipP.x, tipP.y, C.inkFaint, 1, [4, 3]);
					lbl(g, 'F sinθ = ' + num(s.Fsin, 1) + ' N', tipP.x + 6, (cy + tipP.y) / 2,
						C.inkFaint, 10, 'left', 'middle', C.paper0);
				}
				if (s.Fcos > 0.15) {
					ln(g, cx, cy, tipP.x, cy, C.inkFaint, 1, [4, 3]);
					lbl(g, 'F cosθ = ' + num(s.Fcos, 1) + ' N',
						cx + Math.max(b / 2 + 8, (tipP.x - cx) / 2), cy + 16,
						C.inkFaint, 10, 'center', 'middle', C.paper0);
				}
				arw(g, cx, cy, tipP.x, tipP.y, C.accent, 1.8, 8, null);
				lbl(g, 'F = ' + num(F, 1) + ' N', tipP.x + 6, tipP.y, C.accent, 10, 'left', 'middle', C.paper0);

				oHandle.color = C.accent;
				oHandle.fill = C.paper0;
				oHandle.size = 9;
				oHandle.width = 1.3;
				D.handle(g, tipP.x, tipP.y, oHandle);
			}

			/* 隔離體圖的虛線框: 只框住木箱與箭頭 */
			var x1 = Math.max(m0 + 2, Math.min(tipF.x - 6, cx - b / 2 - 8));
			var x2 = Math.min(W - m0 - 2, Math.max(tipP.x + 8, cx + b / 2 + 8));
			var y1 = Math.max(m0 + 16, Math.min(tipN.y - 8, cy - b / 2 - 8));
			var y2 = Math.min(H - m0 - 2, Math.max(tipW.y + 8, cy + b / 2 + 8));
			lnRect(g, x1, y1, x2, y2, 'rgba(20, 17, 13, 0.35)', [5, 4]);
			lbl(g, '隔離體圖', x1 + 2, y1 - 7, C.inkFaint, 10, 'left', 'middle');
		}


		function lnRect(g, x1, y1, x2, y2, color, dash) {
			ln(g, x1, y1, x2, y1, color, 1, dash);
			ln(g, x2, y1, x2, y2, color, 1, dash);
			ln(g, x2, y2, x1, y2, color, 1, dash);
			ln(g, x1, y2, x1, y1, color, 1, dash);
		}

		/* 斜面: 整張圖先在「沿斜面」的座標系裡畫, 再旋轉 −φ 貼回螢幕 ——
		   N / f / mg sinφ / mg cosφ 的角度由座標系決定, 不是一筆一筆調出來的。
		   local +x = 沿斜面向上, local +y = 垂直斜面往內。 */
		function drawIncline(g, W, H, m0) {
			var s = st;
			var b = ctx.clamp(Math.min(W, H) * 0.16, 20, 54);
			var yBase = H * 0.80;
			var p = phi * RAD;
			var tanp = Math.tan(p);
			var maxL = Math.min(W - 2 * m0 - 24, (H * 0.46) / Math.max(tanp, 1e-6));
			var L = Math.max(70, maxL);
			/* 斜面在畫布裡居中: 三角形的高度被 φ 限制住, 靠左會讓右半邊整片空白 */
			var xA = m0 + 10 + Math.max(0, (W - 2 * m0 - 30 - L) * 0.5);
			var xB = Math.min(W - m0 - 6, xA + L);
			var topY = yBase - (xB - xA) * tanp;

			var cs = Math.cos(p), sn = Math.sin(p);
			/* local (lx, ly) → 螢幕 */
			var toX = function (ox, oy, lx, ly) { return ox + lx * cs + ly * sn; };
			var toY = function (ox, oy, lx, ly) { return oy - lx * sn + ly * cs; };

			/* 地面 + 楔形 */
			ln(g, m0, yBase + 0.5, W - m0, yBase + 0.5, C.inkDim, 1.2, null);
			hatch(g, m0 + 2, W - m0, yBase + 1, 'rgba(20, 17, 13, 0.28)');
			g.save();
			g.beginPath();
			g.moveTo(xA, yBase);
			g.lineTo(xB, yBase);
			g.lineTo(xB, topY);
			g.closePath();
			g.fillStyle = '#cfc7b7';
			g.fill();
			g.strokeStyle = 'rgba(20, 17, 13, 0.5)';
			g.lineWidth = 1;
			g.stroke();
			g.fillStyle = 'rgba(20, 17, 13, 0.10)';
			g.fill();
			g.restore();
			ln(g, xA, yBase, xB, topY, C.inkDim, 1.4, null);   /* 斜面本身 */
			lbl(g, 'φ = ' + num(phi, 0) + '°', xA + 4, yBase - 9, C.inkFaint, 10, 'left', 'middle');

			/* 木箱底面中點貼在斜面上: 圓心在 local (0, −b/2) */
			var fx = xA + (xB - xA) * 0.52;
			var fy = yBase - (fx - xA) * tanp;
			var cx = toX(fx, fy, 0, -b / 2);
			var cy = toY(fx, fy, 0, -b / 2);

			/* 一支箭頭多長由四邊的空間決定, 但比例 k 只有一個 */
			var kCap = (H * 0.17) / Math.max(s.W, 1);
			var kDown = (H - m0 - 26 - cy) / Math.max(s.W, 1);
			var kUp = (cy - m0 - 30) / Math.max(s.N * Math.max(cs, 0.35), 0.6);
			var kRight = (W - m0 - 12 - cx) / Math.max(s.f * cs + 0.6, 0.6);
			var kLeft = (cx - m0 - 12) / Math.max(s.drive * cs + 0.6, 0.6);
			var k = Math.max(0.3, Math.min(kCap, kDown, kUp, kRight, kLeft));

			geo.mode = 'incline';
			geo.cx = cx;
			geo.cy = cy;
			geo.k = k;
			geo.bx = b;

			/* --- 斜面座標系: 先畫箱子與四支箭 --- */
			g.save();
			g.translate(cx, cy);
			g.rotate(-p);

			crate(g, 0, 0, b);
			dot(g, 0, 0, 1.6, C.ink);

			var nTip = [0, -s.N * k];                 /* 法線: 離開斜面 */
			var fTip = [s.f * k, 0];                  /* 摩擦: 沿斜面向上 */
			var gsTip = [-s.drive * k, 0];            /* mg sinφ: 沿斜面向下 */
			var gcTip = [0, s.W * cs * k];            /* mg cosφ: 壓進斜面 */
			var wTip = [gsTip[0], gcTip[1]];          /* W = 兩者之和, 螢幕上正好是豎直向下 */

			arw(g, 0, 0, wTip[0], wTip[1], C.ink, 1.5, 7, null);
			if (s.N > 0.005) arw(g, 0, 0, nTip[0], nTip[1], C.ink, 1.5, 7, null);
			if (s.f > 0.005) arw(g, 0, 0, fTip[0], fTip[1], C.ink, 1.5, 7, null);
			arw(g, 0, 0, gsTip[0], gsTip[1], C.accent, 1.5, 7, [4, 3]);
			arw(g, 0, 0, gcTip[0], gcTip[1], C.inkFaint, 1.2, 6, [4, 3]);
			ln(g, gcTip[0], gcTip[1], wTip[0], wTip[1], C.inkFaint, 1, [3, 3]);
			g.restore();

			/* --- 標籤一律水平, 位置由 local 端點換算回螢幕 --- */
			var sx = function (v) { return toX(cx, cy, v[0], v[1]); };
			var sy = function (v) { return toY(cx, cy, v[0], v[1]); };

			lbl(g, 'W = ' + num(s.W, 2) + ' N', sx(wTip) + 7, sy(wTip) - 2, C.ink, 10, 'left', 'middle', C.paper0);
			var narrow = W < 460;
			if (s.N > 0.005) {
				var nLeft = sx(nTip) - 8 - 74 > m0;
				lbl(g, 'N = ' + num(s.N, 2) + ' N', nLeft ? sx(nTip) - 6 : sx(nTip) + 6, sy(nTip) - 6,
					C.ink, 10, nLeft ? 'right' : 'left', 'middle', C.paper0);
			}
			if (s.f > 0.005) {
				lbl(g, 'f = ' + num(s.f, 2) + ' N', ctx.clamp(sx(fTip) + 4, m0 + 2, W - m0 - 74), sy(fTip) - 9,
					C.ink, 10, 'left', 'middle', C.paper0);
			}
			/* 窄畫布上這兩個分量名會比畫布還寬, 只留符號, 數值在讀數與關係式裡 */
			var gsTxt = narrow ? 'mg sinφ' : 'mg sinφ = ' + num(s.drive, 2) + ' N';
			var gcTxt = narrow ? 'mg cosφ' : 'mg cosφ = ' + num(s.W * cs, 2) + ' N';
			var gsRight = sx(gsTip) - 4;
			if (gsRight - 66 < m0) {
				lbl(g, gsTxt, ctx.clamp(sx(gsTip) - 2, m0 + 2, W - m0 - 66), sy(gsTip) + 13,
					C.accent, 10, 'left', 'middle', C.paper0);
			} else {
				lbl(g, gsTxt, gsRight, sy(gsTip) + 12, C.accent, 10, 'right', 'middle', C.paper0);
			}
			/* 窄畫布上 mg cosφ 那支箭正好擠在 W 旁邊, 再掛標籤就會疊字: 留箭不留字 */
			if (!narrow) {
				lbl(g, gcTxt, ctx.clamp(sx(gcTip) + 5, m0 + 2, W - m0 - 110), sy(gcTip) + 3,
					C.inkFaint, 10, 'left', 'middle', C.paper0);
			}

			/* --- 隔離體圖: 木箱四角 + 四支箭頭端點的軸對齊外框 --- */
			var xs = [sx(nTip), sx(fTip), sx(gsTip), sx(gcTip), sx(wTip)];
			var ys = [sy(nTip), sy(fTip), sy(gsTip), sy(gcTip), sy(wTip)];
			var corners = [[-b / 2, -b / 2], [b / 2, -b / 2], [b / 2, b / 2], [-b / 2, b / 2]];
			for (var q = 0; q < 4; q++) {
				xs.push(toX(cx, cy, corners[q][0], corners[q][1]));
				ys.push(toY(cx, cy, corners[q][0], corners[q][1]));
			}
			var x1 = Math.max(m0 + 2, Math.min.apply(null, xs) - 8);
			var x2 = Math.min(W - m0 - 2, Math.max.apply(null, xs) + 8);
			var y1 = Math.max(m0 + 16, Math.min.apply(null, ys) - 10);
			var y2 = Math.min(H - m0 - 2, Math.max.apply(null, ys) + 8);
			lnRect(g, x1, y1, x2, y2, 'rgba(20, 17, 13, 0.35)', [5, 4]);
			lbl(g, '隔離體圖', x1 + 2, y2 + 9, C.inkFaint, 10, 'left', 'middle');
		}


		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 40 || H < 40) return;

			var m0 = ctx.clamp(Math.min(W, H) * 0.045, 8, 16);
			compute();

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			if (mode === 'flat') drawFlat(g, W, H, m0);
			else drawIncline(g, W, H, m0);

			/* 起動之後, 地面/斜面上畫幾道流線, 只為了「它在動」 */
			if (!ctx.reduced && !st.still && st.a > 0) {
				var n, t;
				for (n = 0; n < 3; n++) {
					t = (phase + n * 0.33) % 1;
					var ox = geo.mode === 'flat'
						? geo.cx - 30 - t * 46
						: geo.cx - 26 - t * 34;
					var oy = geo.mode === 'flat' ? geo.cy + geo.bx * 0.30 : geo.cy + geo.bx * 0.55;
					g.save();
					g.globalAlpha = 0.55 * (1 - t);
					ln(g, ox, oy, ox - 9, oy, C.inkFaint, 1.2, null);
					g.restore();
				}
			}
		}

		/* ---------------- 互動 ---------------- */

		function setF(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 0, 60) * 2) / 2;
			if (n === F) return;
			F = n;
			fF.inp.value = String(n);
			syncUI();
			draw();
		}

		function setTh(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 0, 80) / 5) * 5;
			if (n === th) return;
			th = n;
			fTh.inp.value = String(n);
			syncUI();
			draw();
		}

		function applyPointer(e) {
			var r = canvas.getBoundingClientRect();
			var px = e.clientX - r.left;
			var py = e.clientY - r.top;
			var dx = px - geo.cx;
			var dy = geo.cy - py;
			var ang = Math.atan2(dy, Math.max(dx, 0.001)) / RAD;
			if (dx <= 0.001) ang = 80;
			var len = Math.sqrt(dx * dx + dy * dy) / Math.max(geo.k, 1e-6);
			setTh(ang);
			setF(len);
		}

		var listeners = [];

		function on(target, type, fn) {
			target.addEventListener(type, fn);
			listeners.push([target, type, fn]);
		}

		on(canvas, 'pointerdown', function (e) {
			if (mode !== 'flat') return;
			dragging = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件沒有可捕捉的指標 */ }
			e.preventDefault();
			applyPointer(e);
		});

		on(canvas, 'pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			applyPointer(e);
		});

		function endDrag(e) {
			if (!dragging) return;
			dragging = false;
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
				canvas.releasePointerCapture(e.pointerId);
			}
		}
		on(canvas, 'pointerup', endDrag);
		on(canvas, 'pointercancel', endDrag);

		on(fM.inp, 'input', function () {
			var v = parseFloat(fM.inp.value);
			if (!isFinite(v)) return;
			m = Math.round(ctx.clamp(v, 1, 10) * 10) / 10;
			fM.inp.value = String(m);
			syncUI();
			draw();
		});

		on(fMu.inp, 'input', function () {
			var v = parseFloat(fMu.inp.value);
			if (!isFinite(v)) return;
			mu = Math.round(ctx.clamp(v, 0, 0.8) * 100) / 100;
			fMu.inp.value = String(mu);
			syncUI();
			draw();
		});

		on(fF.inp, 'input', function () { setF(parseFloat(fF.inp.value)); });
		on(fTh.inp, 'input', function () {
			var v = parseFloat(fTh.inp.value);
			if (!isFinite(v)) return;
			th = Math.round(ctx.clamp(v, 0, 80) / 5) * 5;
			fTh.inp.value = String(th);
			syncUI();
			draw();
		});

		on(fPhi.inp, 'input', function () {
			var v = parseFloat(fPhi.inp.value);
			if (!isFinite(v)) return;
			phi = Math.round(ctx.clamp(v, 0, 35));
			fPhi.inp.value = String(phi);
			syncUI();
			draw();
		});

		function applyMode(next) {
			mode = next;
			btnFlat.classList.toggle('is-on', mode === 'flat');
			btnInc.classList.toggle('is-on', mode === 'incline');
			btnFlat.setAttribute('aria-pressed', mode === 'flat' ? 'true' : 'false');
			btnInc.setAttribute('aria-pressed', mode === 'incline' ? 'true' : 'false');
			gPush.classList.toggle('kn-off', mode !== 'flat');
			gInc.classList.toggle('kn-off', mode !== 'incline');
			hint.textContent = mode === 'flat'
				? '拖動 F 箭頭的尖端：同時改大小與角度'
				: '斜面沒有施力 F：只剩 W、N 與 f';
			syncUI();
			draw();
		}

		on(btnFlat, 'click', function () { if (mode !== 'flat') applyMode('flat'); });
		on(btnInc, 'click', function () { if (mode !== 'incline') applyMode('incline'); });

		var offResize = ctx.onResize(draw);

		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				phase = (phase + dt / 1.6) % 1;
				draw();
			});
		}

		return {
			destroy: function () {
				var i;
				for (i = 0; i < listeners.length; i++) {
					listeners[i][0].removeEventListener(listeners[i][1], listeners[i][2]);
				}
				listeners.length = 0;
				if (typeof offResize === 'function') offResize();
			}
		};
	});
})();