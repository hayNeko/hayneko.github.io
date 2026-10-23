/**
 * ch2-collision.js — 碰撞與反衝 (DSE 物理 · II.e · 實驗 12)
 *
 * 為什麼一定要同時畫動量條與動能條: 「動量守恆、動能不一定」講成一句話很容易,
 * 但兩根條一上一下擺著, 讀者自己就會看見 —— 上面兩條永遠等長 (完全非彈性、
 * 彈性、爆炸都一樣), 下面那條在完全非彈性碰撞之後硬生生短掉一截。
 *
 * 碰撞點固定畫在軌道中間, 兩車各自由自己的速率走到它: 速率比就是距離比,
 * 所以不是「看起來像相撞」, 而是真的同一時間抵達。
 *
 * 時間軸: 接近段 1.05 s, 碰撞瞬間放慢到 1/4 速 0.55 s, 之後恢復常速 0.85 s。
 * 慢動作是為了看得見接觸, 不是為了改物理 —— 位置仍然用 v·t 算。
 */
(function () {
	'use strict';

	/* 畫面上的真實色彩 */
	var RAIL = '#5c6165';
	var RAIL_HL = '#8d949a';
	var SLEEPER = '#6b5b4a';
	var CART_BODY = '#7a5f45';
	var CART_TOP = '#9a7c5d';
	var CART_METAL = '#9aa3a8';
	var WHEEL = '#1b1d1f';
	var WOOD = '#8a6a4a';

	window.DSELab.define('collision', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */
		var mode = 'inelastic';
		var m1 = 2;
		var m2 = 4;
		var u1 = 3;
		var u2 = 0;
		var energy = 12;          /* 爆炸釋放的動能 (J) */
		var clock = 1.62;         /* 牆上時間, 靜態影格停在剛撞完 */
		var view = null;
		var canvas = null;

		/* 拖曳: 抓住車廂左右拖 = 改初速 (和滑桿是同一個量, 只是換一隻手) */
		var hit = { ax: 0, bx: 0, cy: 0, hw: 18, hh: 14 };
		var dragWho = 0;
		var dragLast = 0;
		var dragK = 0.05;
		var dragging = false;

		var T1 = 1.05;
		var T2 = 0.8;          /* 物理 0.2 s 以 1/4 速播放 = 0.8 s 牆上時間 (與說明一致) */
		var T3 = 0.85;
		var CYCLE = T1 + T2 + T3 + 0.75;

		var oLine = { color: '', width: 1, dash: null };
		var oArrow = { color: '', width: 1.4, head: 6, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		function num(v, d) {
			if (typeof v !== 'number' || !isFinite(v)) return '—';
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

		function lbl(g, text, x, y, color, size, align, mono, bg) {
			oLabel.color = color;
			oLabel.size = size == null ? 10 : size;
			oLabel.align = align || 'left';
			oLabel.baseline = 'middle';
			oLabel.mono = mono !== false;
			oLabel.bg = bg || null;
			D.label(g, text, x, y, oLabel);
		}

		/* ---------------- 物理 ---------------- */

		var st = { v1: 0, v2: 0, pB: 0, pA: 0, kB: 0, kA: 0, loss: 0, closing: 0, approaching: true };

		function compute() {
			var pb, kb;
			if (mode === 'explode') {
				/* 由靜止分裂: p = 0, 釋放能量 E → |v1|/|v2| = m2/m1 */
				var v1sq = 2 * energy * m2 / (m1 * (m1 + m2));
				st.v1 = -Math.sqrt(Math.max(v1sq, 0));
				st.v2 = -m1 * st.v1 / m2;
				st.pB = 0;
				st.kB = 0;
				u1 = 0;
				u2 = 0;
				st.closing = 0;
				st.approaching = true;           /* 爆炸本身就是一次事件 */
			} else {
				st.pB = m1 * u1 + m2 * u2;
				st.kB = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
				st.closing = u1 - u2;            /* > 0 表示 A 才追得上 B */
				st.approaching = st.closing > 1e-9;
				if (!st.approaching) {
					/* 追不上就沒有碰撞: 兩車保持原速, 前後完全一樣 */
					st.v1 = u1;
					st.v2 = u2;
				} else if (mode === 'inelastic') {
					st.v1 = st.pB / (m1 + m2);       /* m1 + m2 ≥ 1, 不會除零 */
					st.v2 = st.v1;
				} else {
					st.v1 = ((m1 - m2) * u1 + 2 * m2 * u2) / (m1 + m2);
					st.v2 = ((m2 - m1) * u2 + 2 * m1 * u1) / (m1 + m2);
				}
			}
			st.pA = m1 * st.v1 + m2 * st.v2;
			st.kA = 0.5 * m1 * st.v1 * st.v1 + 0.5 * m2 * st.v2 * st.v2;
			if (!st.approaching) {
				/* 沒有碰撞: 前後狀態逐位相同, 不留任何「損失」給讀者誤讀 */
				st.pA = st.pB;
				st.kA = st.kB;
			}
			st.loss = st.kB - st.kA;
			pb = st.pB; kb = st.kB;
			st.pB = Math.abs(pb) < 1e-9 ? 0 : pb;
			st.kB = Math.abs(kb) < 1e-9 ? 0 : kb;
			return st;
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		wrap.appendChild(canvas);
		var hint = el('p', 'dl-hint', '拖動車廂左右，設定初速 u');
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel');

		var gMode = el('div', 'dl-panel__group');
		gMode.appendChild(el('span', 'dl-panel__label', '碰撞類型'));
		var seg = el('div', 'dl-seg');
		var btnIn = el('button', 'dl-btn', '完全非彈性');
		var btnEl = el('button', 'dl-btn', '彈性');
		var btnEx = el('button', 'dl-btn', '爆炸');
		var segBtns = [btnIn, btnEl, btnEx];
		var segKeys = ['inelastic', 'elastic', 'explode'];
		for (var b = 0; b < segBtns.length; b++) {
			segBtns[b].type = 'button';
			segBtns[b].setAttribute('aria-pressed', b === 0 ? 'true' : 'false');
			if (b === 0) segBtns[b].classList.add('is-on');
			seg.appendChild(segBtns[b]);
		}
		gMode.appendChild(seg);

		function field(label) {
			var f = el('div', 'dl-field');
			var lab = el('span', 'dl-field__label', label);
			var inp = el('input', 'dl-range');
			inp.type = 'range';
			var o = el('output', 'dl-field__val', '');
			inp.setAttribute('aria-label', label);
			f.appendChild(lab);
			f.appendChild(inp);
			f.appendChild(o);
			return { root: f, lbl: lab, inp: inp, out: o };
		}

		function setRange(f, min, max, step, val, txt) {
			f.inp.min = String(min);
			f.inp.max = String(max);
			f.inp.step = String(step);
			f.inp.value = String(val);
			f.out.textContent = txt;
		}

		var gMass = el('div', 'dl-panel__group');
		gMass.appendChild(el('span', 'dl-panel__label', '質量'));
		var fM1 = field('m₁');
		var fM2 = field('m₂');
		gMass.appendChild(fM1.root);
		gMass.appendChild(fM2.root);

		var gVel = el('div', 'dl-panel__group');
		gVel.appendChild(el('span', 'dl-panel__label', '初速（右為正）'));
		var fU1 = field('u₁ (m/s)');
		var fU2 = field('u₂ (m/s)');
		var fE = field('釋放能量 E');
		gVel.appendChild(fU1.root);
		gVel.appendChild(fU2.root);
		gVel.appendChild(fE.root);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}

		var rds = el('div', 'dl-readouts');
		var rdPB = cell('p 前');
		var rdPA = cell('p 後');
		var rdKB = cell('E_k 前');
		var rdKA = cell('E_k 後');
		var rdLoss = cell('動能損失');
		rds.appendChild(rdPB.root);
		rds.appendChild(rdPA.root);
		rds.appendChild(rdKB.root);
		rds.appendChild(rdKA.root);
		rds.appendChild(rdLoss.root);

		var texBox = el('div', 'pm-tex');
		var texA = el('div', 'pm-tex__row', '');
		var texB = el('div', 'pm-tex__row', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gMass);
		panel.appendChild(gVel);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 控件 ---------------- */

		function applyMode() {
			fU1.root.style.display = mode === 'explode' ? 'none' : '';
			fU2.root.style.display = mode === 'explode' ? 'none' : '';
			fE.root.style.display = mode === 'explode' ? '' : 'none';
			setRange(fM1, 0.5, 10, 0.1, m1, num(m1, 1) + ' kg');
			setRange(fM2, 0.5, 10, 0.1, m2, num(m2, 1) + ' kg');
			setRange(fU1, -5, 8, 0.1, u1, num(u1, 1));
			setRange(fU2, -5, 8, 0.1, u2, num(u2, 1));
			setRange(fE, 1, 40, 0.5, energy, num(energy, 1) + ' J');
		}

		/* ---------------- 讀數 ---------------- */

		var lastA = '';
		var lastB = '';
		var REDUCED = ' 已依系統設定暫停動態。';

		function noteText() {
			var base;
			if (mode !== 'explode' && !st.approaching) {
				/* 追不上就沒有碰撞: 面板與畫布必須說同一句話 */
				return 'u₁ ≤ u₂: 後車追不上前車, 兩車不會相遇 —— 前後狀態相同, 也沒有動能損失。' +
					(ctx.reduced ? REDUCED : '');
			}
			if (mode === 'explode') {
				base = '爆炸由靜止開始: 動量守恆要求 m₁v₁ = −m₂v₂, 所以速率比是質量比的倒數, ' +
					'釋放的 E 全部變成兩車的動能。';
			} else if (mode === 'inelastic') {
				base = '完全非彈性: 兩車碰後同速, 動能損失最大; 慢動作只放慢時間, 不改變 v·t。';
			} else {
				base = '彈性: 動能守恆, 碰後分開; 動量條前後等長, 動能條也等長。';
			}
			return base + ' 碰撞前後 0.2 s 以 1/4 慢速播放。' + (ctx.reduced ? REDUCED : '');
		}

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var s = compute();

			rdPB.v.textContent = num(s.pB, 2) + ' kg·m/s';
			rdPA.v.textContent = num(s.pA, 2) + ' kg·m/s';
			rdKB.v.textContent = num(s.kB, 2) + ' J';
			rdKA.v.textContent = num(s.kA, 2) + ' J';
			if (!s.approaching) {
				/* 沒有碰撞: 不在「動能損失」這一格編故事, 直接寫狀態 */
				rdLoss.k.textContent = '狀態';
				rdLoss.v.textContent = '不會相撞';
				rdLoss.v.classList.remove('pm-mute');
				rdLoss.v.classList.add('pm-acc');
			} else {
				/* 爆炸是「動能增加」, 不是負的損失 —— 別讓一個負號去解釋物理 */
				var isBoom = mode === 'explode';
				rdLoss.k.textContent = isBoom ? '動能增加' : '動能損失';
				rdLoss.v.textContent = num(isBoom ? Math.abs(s.loss) : s.loss, 2) + ' J';
				rdLoss.v.classList.remove('pm-acc');
				rdLoss.v.classList.toggle('pm-mute', Math.abs(s.loss) < 0.005);
			}

			lastA = setTeX(texA, '\\( m_Au_A + m_Bu_B = m_Av_A + m_Bv_B \\)', lastA);
			if (mode === 'explode') {
				lastB = setTeX(texB,
					'\\( 0 = ' + num(m1, 1) + 'v_A + ' + num(m2, 1) + 'v_B \\Rightarrow v_A = ' +
					num(s.v1, 2) + ',\\ v_B = ' + num(s.v2, 2) + '\\)', lastB);
			} else {
				lastB = setTeX(texB,
					'\\( ' + num(m1, 1) + '(' + num(u1, 1) + ')+' + num(m2, 1) + '(' + num(u2, 1) +
					')=' + num(s.pB, 2) + '\\rightarrow v_A=' + num(s.v1, 2) + ',\\ v_B=' + num(s.v2, 2) + '\\)',
					lastB);
			}
			note.textContent = noteText();
		}

		/* ---------------- 繪圖 ---------------- */

		function drawCart(g, cx, cy, wid, hei, label, alpha) {
			g.save();
			g.globalAlpha = alpha == null ? 1 : alpha;
			/* 車輪 */
			var wr = Math.max(2, hei * 0.26);
			g.fillStyle = WHEEL;
			g.beginPath();
			g.arc(cx - wid * 0.28, cy + hei * 0.5, wr, 0, Math.PI * 2);
			g.arc(cx + wid * 0.28, cy + hei * 0.5, wr, 0, Math.PI * 2);
			g.fill();
			/* 車身: 木箱 + 金屬邊 */
			g.fillStyle = CART_BODY;
			g.fillRect(cx - wid / 2, cy - hei * 0.5, wid, hei);
			g.fillStyle = CART_TOP;
			g.fillRect(cx - wid / 2, cy - hei * 0.5, wid, Math.max(1.5, hei * 0.18));
			g.fillStyle = CART_METAL;
			g.fillRect(cx - wid / 2, cy - hei * 0.5, Math.max(1.2, wid * 0.05), hei);
			g.fillRect(cx + wid / 2 - Math.max(1.2, wid * 0.05), cy - hei * 0.5, Math.max(1.2, wid * 0.05), hei);
			/* 木紋: 兩條淡線 */
			g.fillStyle = 'rgba(255,255,255,0.10)';
			g.fillRect(cx - wid * 0.36, cy - hei * 0.14, wid * 0.72, 1);
			g.fillRect(cx - wid * 0.36, cy + hei * 0.14, wid * 0.72, 1);
			g.restore();
			if (label) lbl(g, label, cx, cy - hei * 0.5 - 9, C.ink, 10, 'center', true, C.paper0);
		}

		function barRow(g, x0, x1, y, value, maxV, label, color, alpha) {
			lbl(g, label, x0, y, C.inkFaint, 10, 'left', false);
			var bx = x0 + 17;
			var bw = Math.max(4, x1 - bx - 34);
			var w = maxV > 1e-9 ? bw * ctx.clamp(value / maxV, 0, 1) : 0;
			g.save();
			g.globalAlpha = alpha == null ? 1 : alpha;
			g.fillStyle = color;
			g.fillRect(bx, y - 3, Math.max(w, value > 1e-9 ? 1.2 : 0), 6);
			g.restore();
			lbl(g, num(value, 2), x1, y, C.ink, 10, 'right', true);
			/* 零點刻度 */
			ln(g, bx, y - 4, bx, y + 4, C.lineStrong, 1, null);
		}

		function draw(g, W, H) {
			if (!g || W < 60 || H < 60) return;
			var s = compute();

			var pad = ctx.clamp(W * 0.028, 6, 16);
			var trackL = pad;
			var trackR = W - pad;
			var trackW = trackR - trackL;
			var xC = trackL + trackW * 0.5;
			var hy = H * 0.42;                       /* 軌道面 */
			var wid = ctx.clamp(trackW * 0.16, 30, 66);
			var hei = ctx.clamp(H * 0.15, 14, 34);

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			/* 每公尺 = 多少 px: 由接近段與碰撞後的位移一起決定 */
			var sc;
			if (mode === 'explode') {
				sc = 0.34 * trackW / Math.max(Math.max(Math.abs(s.v1), Math.abs(s.v2)) * 1.0, 0.5);
			} else {
				var approach = Math.max(Math.abs(u1), Math.abs(u2)) * 1.2;
				var post = Math.max(Math.abs(s.v1), Math.abs(s.v2)) * 1.0;
				sc = 0.40 * trackW / Math.max(approach, post, 0.5);
			}

			/* ---- 軌道 ---- */
			g.fillStyle = SLEEPER;
			g.fillRect(trackL, hy + 1, trackW, 2);
			g.fillStyle = RAIL;
			g.fillRect(trackL, hy - 1.5, trackW, 3);
			g.fillStyle = RAIL_HL;
			g.fillRect(trackL, hy - 1.5, trackW, 1);

			/* ---- 位置 ---- */
			var hw = wid * 0.5;
			/* 兩車車身之間永遠留 3px: 接觸時看起來就是「碰上」, 但任何情況下都不重疊 */
			var edge = hw + 1.5;
			var gap0 = Math.max(8, hw * 0.5);     /* 不會相撞時兩車之間的空隙 */
			var xA;
			var xB;
			var phaseSlow = false;
			if (mode === 'explode') {
				if (clock < T1) {
					xA = xC - edge;
					xB = xC + edge;
				} else {
					var pe = clock - T1;
					var te = pe < T2 ? pe * 0.25 : T2 * 0.25 + (pe - T2);
					xA = xC - edge + s.v1 * te * sc;
					xB = xC + edge + s.v2 * te * sc;
				}
			} else if (!s.approaching) {
				/* 不會相撞: 兩車各守自己那一半, 只依自己的速度移動 —— 拖曳再用力也不會穿過去 */
				xA = xC - hw - gap0 + s.v1 * clock * sc;
				xB = xC + hw + gap0 + s.v2 * clock * sc;
			} else {
				var xA0 = xC - edge - u1 * 1.2 * sc;
				var xB0 = xC + edge - u2 * 1.2 * sc;
				if (clock < T1) {
					var f = clock / T1;
					xA = xA0 + (xC - edge - xA0) * f;
					xB = xB0 + (xC + edge - xB0) * f;
				} else {
					var p2 = clock - T1;
					var tau = p2 < T2 ? p2 * 0.25 : T2 * 0.25 + (p2 - T2);
					phaseSlow = p2 < T2;
					xA = xC - edge + s.v1 * tau * sc;
					xB = xC + edge + s.v2 * tau * sc;
				}
			}
			xA = ctx.clamp(xA, trackL + hw + 1, trackR - hw - 1);
			xB = ctx.clamp(xB, trackL + hw + 1, trackR - hw - 1);
			/* 硬保險: 車 1 的右緣永遠在車 2 的左緣左邊, 至少留 2px (任何寬度、任何 u 都成立) */
			var minGap = 2;
			if (xB - hw < xA + hw + minGap) {
				var mid = (xA + xB) * 0.5;
				var half = hw + minGap * 0.5;
				xA = mid - half;
				xB = mid + half;
			}
			hit.ax = xA;
			hit.bx = xB;
			hit.cy = hy - hei * 0.5;
			hit.hw = hw;
			hit.hh = hei * 0.6;
			dragK = 13 / Math.max(180, W);

			/* 碰撞點 */
			ln(g, xC, hy - hei * 2.2, xC, hy - 4, C.lineFaint, 1, [3, 3]);

			/* ---- 兩台車 ---- */
			drawCart(g, xA, hy - hei * 0.5 - 3, wid, hei, num(m1, 1) + ' kg', 1);
			drawCart(g, xB, hy - hei * 0.5 - 3, wid, hei, num(m2, 1) + ' kg', 1);

			/* 速度箭頭: 長度 ∝ |v|, 方向由正負決定 */
			var arrowY = hy - hei - 27;
			var uA = mode === 'explode' ? (clock < T1 ? 0 : s.v1) : (clock < T1 ? u1 : s.v1);
			var uB = mode === 'explode' ? (clock < T1 ? 0 : s.v2) : (clock < T1 ? u2 : s.v2);
			var scaleV = ctx.clamp(W * 0.028, 6, 22);

			function velArrow(cx, v) {
				var L = Math.min(Math.abs(v) * scaleV, trackW * 0.22);
				if (L < 1.5) {
					D.dot(g, cx, arrowY, 1.6, { color: C.inkDim, fill: C.inkDim, stroke: false });
					return;
				}
				arw(g, cx, arrowY, cx + (v > 0 ? L : -L), arrowY, C.inkDim, 1.5, 5, null);
			}
			if (xA > trackL + 6) velArrow(xA, uA);
			if (xB < trackR - 6) velArrow(xB, uB);

			/* ---- 動量條 / 動能條 ---- */
			var yTop = H * 0.56;
			var yBot = H - pad - 2;
			var rowH = (yBot - yTop) / 3;
			var colW = (trackW - 16) / 2;
			var pX0 = trackL;
			var pX1 = trackL + colW;
			var kX0 = trackL + colW + 16;
			var kX1 = trackR;

			lbl(g, 'p (kg·m/s)', pX0, yTop, C.inkFaint, 10, 'left', false);
			lbl(g, 'E_k (J)', kX0, yTop, C.inkFaint, 10, 'left', false);

			var maxP = Math.max(Math.abs(s.pB), Math.abs(s.pA), 1e-9);
			var maxK = Math.max(s.kB, s.kA, 1e-9);

			barRow(g, pX0, pX1, yTop + rowH * 0.78, Math.abs(s.pB), maxP, '前', C.inkFaint, 0.75);
			barRow(g, pX0, pX1, yTop + rowH * 1.78, Math.abs(s.pA), maxP, '後', C.inkFaint, 0.75);
			barRow(g, kX0, kX1, yTop + rowH * 0.78, s.kB, maxK, '前', C.inkFaint, 0.75);
			var hitNow = mode === 'inelastic' && s.approaching;   /* 沒有碰撞就沒有「變短的動能」可強調 */
			barRow(g, kX0, kX1, yTop + rowH * 1.78, s.kA, maxK, '後', hitNow ? C.accent : C.inkFaint,
				hitNow ? 0.95 : 0.75);

			/* 動能掉多少: 在「後」那一列右側補一句, 只有真的掉了才寫 */
			if (s.loss > 0.005) {
				lbl(g, '−' + num(s.loss, 1) + ' J', kX1, yTop + rowH * 2.62, C.accent, 10, 'right', true);
			}
			if (Math.abs(s.pB) < 1e-9) {
				lbl(g, mode === 'explode' ? 'p 前後都是 0（等大反向）' : 'p = 0',
					pX0, yTop + rowH * 2.62, C.inkFaint, 9.5, 'left', false);
			}
			if (!ctx.reduced && phaseSlow) {
				lbl(g, '慢動作', trackR, hy - hei * 2.2, C.accent, 10, 'right', false);
			}
			if (mode !== 'explode' && !s.approaching) {
				lbl(g, 'u₁ ≤ u₂：兩車不會相撞', trackL + 4, hy - hei * 2.6, C.accent, 10, 'left', false);
			}
		}

		/* ---------------- 互動 ---------------- */

		function rerun() {
			syncUI();
			draw(view.ctx2d, view.w, view.h);
		}

		function setMode(next) {
			if (mode === next) return;
			mode = next;
			for (var i = 0; i < segKeys.length; i++) {
				var on = segKeys[i] === mode;
				segBtns[i].classList.toggle('is-on', on);
				segBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
			}
			applyMode();
			rerun();
		}

		for (var bi = 0; bi < segBtns.length; bi++) {
			(function (i) {
				segBtns[i].addEventListener('click', function () { setMode(segKeys[i]); });
			})(bi);
		}

		fM1.inp.addEventListener('input', function () {
			var v = parseFloat(fM1.inp.value);
			if (!isFinite(v)) return;
			m1 = ctx.clamp(v, 0.5, 10);
			fM1.out.textContent = num(m1, 1) + ' kg';
			rerun();
		});

		fM2.inp.addEventListener('input', function () {
			var v = parseFloat(fM2.inp.value);
			if (!isFinite(v)) return;
			m2 = ctx.clamp(v, 0.5, 10);
			fM2.out.textContent = num(m2, 1) + ' kg';
			rerun();
		});

		fU1.inp.addEventListener('input', function () {
			var v = parseFloat(fU1.inp.value);
			if (!isFinite(v)) return;
			u1 = ctx.clamp(v, -5, 8);
			fU1.out.textContent = num(u1, 1);
			rerun();
		});

		fU2.inp.addEventListener('input', function () {
			var v = parseFloat(fU2.inp.value);
			if (!isFinite(v)) return;
			u2 = ctx.clamp(v, -5, 8);
			fU2.out.textContent = num(u2, 1);
			rerun();
		});

		fE.inp.addEventListener('input', function () {
			var v = parseFloat(fE.inp.value);
			if (!isFinite(v)) return;
			energy = ctx.clamp(v, 1, 40);
			fE.out.textContent = num(energy, 1) + ' J';
			rerun();
		});

		/* ---------------- 拖曳 ---------------- */

		function setSpeed(which, value) {
			var x = ctx.clamp(value, -5, 8);
			if (which === 1) {
				u1 = x;
				fU1.inp.value = String(x);
				fU1.out.textContent = num(u1, 1);
			} else {
				u2 = x;
				fU2.inp.value = String(x);
				fU2.out.textContent = num(u2, 1);
			}
			rerun();
		}

		canvas.addEventListener('pointerdown', function (e) {
			if (mode === 'explode') return;
			var r = canvas.getBoundingClientRect();
			var x = e.clientX - r.left;
			var y = e.clientY - r.top;
			var nearA = Math.abs(x - hit.ax) < hit.hw + 8 && Math.abs(y - hit.cy) < hit.hh + 8;
			var nearB = Math.abs(x - hit.bx) < hit.hw + 8 && Math.abs(y - hit.cy) < hit.hh + 8;
			if (!nearA && !nearB) return;
			dragWho = nearA ? 1 : 2;
			dragging = true;
			dragLast = x;
			/* 凍在接近段: 拖的時候車不會自己跑掉, 看得到箭頭在變 */
			clock = T1 * 0.45;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒有可捕捉的指標 */ }
			e.preventDefault();
			draw(view.ctx2d, view.w, view.h);
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			var r = canvas.getBoundingClientRect();
			var x = e.clientX - r.left;
			var dx = x - dragLast;
			dragLast = x;
			if (!dx) return;
			e.preventDefault();
			setSpeed(dragWho, (dragWho === 1 ? u1 : u2) + dx * dragK);
		});

		function endDrag(e) {
			if (!dragging) return;
			dragging = false;
			dragWho = 0;
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
				canvas.releasePointerCapture(e.pointerId);
			}
		}
		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);

		ctx.onResize(function () {
			draw(view.ctx2d, view.w, view.h);
		});

		applyMode();
		syncUI();
		draw(view.ctx2d, view.w, view.h);

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				if (dragging) return;
				clock = (clock + dt) % CYCLE;
				draw(view.ctx2d, view.w, view.h);
			});
		}

		return { destroy: function () {} };
	});
})();
