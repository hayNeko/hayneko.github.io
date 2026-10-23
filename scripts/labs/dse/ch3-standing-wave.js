/**
 * ch3-standing-wave.js — 弦上駐波 (lab id: standing-wave)
 *
 * 時基: 真實 f = nv/2L 可以到 1000 Hz, 60 fps 取樣只會看到亂跳的波形。真實 f 進讀數,
 * 畫面另外把 f 單調壓到 0.25–1.1 Hz —— 拖波速看得出「快慢變了」, 又不會走樣。
 * 符號約定: x 自左夾具量起 (m), 位移向上為正; canvas 的 y 向下, 所以取負號。
 */
(function () {
	'use strict';

	var L_MIN = 0.4, L_MAX = 1.6, L_STEP = 0.05;
	var V_MIN = 40, V_MAX = 160, V_STEP = 5;
	var N_MAX = 5;
	var F_REF = 12.5;        /* v=40, n=1, L=1.6 的 f, 當顯示頻率的壓縮基準 */
	var F_DISP_MAX = 1.1;
	var TWO_PI = Math.PI * 2;

	window.DSELab.define('standing-wave', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		var st = { L: 1, v: 100, n: 2 };
		var phase = 0;
		var dispHz = 0.5;
		var lastTex = '';

		function mk(tag, cls, text) {
			var el = doc.createElement(tag);
			if (cls) el.className = cls;
			if (text != null) el.textContent = text;
			return el;
		}

		/* ---------------------------------------------------------------- DOM */

		var grid = mk('div', 'dl-lab__grid');
		var stage = mk('div', 'dl-lab__stage');
		var wrap = mk('div', 'dl-lab__canvaswrap');
		var canvas = mk('canvas', 'dl-canvas dl-canvas--drag');
		canvas.setAttribute('role', 'img');
		canvas.setAttribute('aria-label', '兩端固定的弦上的駐波：波節、波腹與 λ/2');
		wrap.appendChild(canvas);
		wrap.appendChild(mk('p', 'dl-hint md-hint md-hint--r', '拖動右端夾具改弦長'));
		stage.appendChild(wrap);
		grid.appendChild(stage);

		var panel = mk('div', 'dl-lab__panel');
		grid.appendChild(panel);

		var gString = mk('div', 'dl-panel__group');
		gString.appendChild(mk('span', 'dl-panel__label', '弦'));
		var fL = makeField('弦長 L', L_MIN, L_MAX, L_STEP, st.L, 'm', 2, onLen);
		var fV = makeField('弦波速 v', V_MIN, V_MAX, V_STEP, st.v, 'm/s', 0, onSpeed);
		gString.appendChild(fL.row);
		gString.appendChild(fV.row);
		panel.appendChild(gString);

		var gMode = mk('div', 'dl-panel__group');
		gMode.appendChild(mk('span', 'dl-panel__label', '諧波 n'));
		var seg = mk('div', 'dl-seg');
		var modeBtns = [];
		for (var mi = 1; mi <= N_MAX; mi++) {
			var b = mk('button', 'dl-btn', '第 ' + mi);
			b.type = 'button';
			b.setAttribute('aria-pressed', 'false');
			b.setAttribute('data-n', String(mi));
			b.addEventListener('click', onModeClick);
			seg.appendChild(b);
			modeBtns.push(b);
		}
		gMode.appendChild(seg);
		panel.appendChild(gMode);

		var roLam = readout('波長 λ');
		var roF = readout('頻率 f');
		var roNodes = readout('波節數 n+1');
		var roHalf = readout('相鄰波節 λ/2');
		var roBox = mk('div', 'dl-readouts');
		roBox.appendChild(roLam.row);
		roBox.appendChild(roF.row);
		roBox.appendChild(roNodes.row);
		roBox.appendChild(roHalf.row);
		panel.appendChild(roBox);

		var texEl = mk('p', 'md-formula');
		panel.appendChild(texEl);

		var note = mk('p', 'dl-note', '');
		panel.appendChild(note);

		mount.appendChild(grid);

		/* ------------------------------------------------------------ 控件 */

		function makeField(labelText, min, max, step, value, unit, digits, onInput) {
			var row = mk('div', 'dl-field');
			row.appendChild(mk('span', 'dl-field__label', labelText));
			var input = doc.createElement('input');
			input.type = 'range';
			input.className = 'dl-range';
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(value);
			input.setAttribute('aria-label', labelText);
			var out = mk('output', 'dl-field__val', value.toFixed(digits) + ' ' + unit);
			input.addEventListener('input', function () {
				var val = parseFloat(input.value);
				if (!isFinite(val)) return;
				onInput(val);
			});
			row.appendChild(input);
			row.appendChild(out);
			return { row: row, input: input, out: out, digits: digits, unit: unit };
		}

		function syncField(f, value) {
			var txt = String(value);
			if (f.input.value !== txt) f.input.value = txt;
			f.out.textContent = value.toFixed(f.digits) + ' ' + f.unit;
		}

		function readout(k) {
			var row = mk('span', 'dl-readout');
			row.appendChild(mk('span', 'dl-readout__k md-key', k));
			var val = mk('span', 'dl-readout__v', '—');
			row.appendChild(val);
			return { row: row, val: val };
		}

		function onLen(val) {
			st.L = clampNum(val, L_MIN, L_MAX);
			syncField(fL, st.L);
			refresh();
		}

		function onSpeed(val) {
			st.v = clampNum(val, V_MIN, V_MAX);
			syncField(fV, st.v);
			refresh();
		}

		function onModeClick(e) {
			var n = parseInt(e.currentTarget.getAttribute('data-n'), 10);
			if (!isFinite(n)) return;
			st.n = n;
			refresh();
		}

		function clampNum(v, a, b) {
			return v < a ? a : v > b ? b : v;
		}

		/* ------------------------------------------------------------ 幾何 */

		var view = ctx.setupCanvas(canvas, { aspect: '16 / 9' });

		function tailFrac(L) {
			/* 右夾具在 62%–92% 之間移動: 夾具真的會動, 而且弦長最短時 n=5 還畫得下 */
			return 0.62 + 0.30 * (L - L_MIN) / (L_MAX - L_MIN);
		}

		function geom() {
			var w = view.w, h = view.h;
			var x0 = Math.round(w * 0.08);
			var x1 = Math.round(w * tailFrac(st.L));
			var y0 = Math.round(h * 0.46);
			var A = Math.max(9, Math.min(h * 0.24, h * 0.54 - 44));
			return { x0: x0, x1: x1, y0: y0, A: A, span: x1 - x0, w: w, h: h };
		}

		/* ------------------------------------------------------------ 繪圖 */

		function draw(ph) {
			var g = view.ctx2d;
			if (!g) return;
			var w = view.w, h = view.h;
			if (w < 4 || h < 4) return;
			g.clearRect(0, 0, w, h);

			var n = st.n;
			var L = st.L;
			var lam = 2 * L / n;
			var f = st.v / lam;
			var k = n * Math.PI / L;
			var G = geom();
			var x0 = G.x0, x1 = G.x1, y0 = G.y0, A = G.A, span = G.span;
			var pxPerM = span / L;
			var cosP = Math.cos(ph);
			var sinP = Math.sin(ph);

			/* 平衡位置 */
			D.line(g, x0 - 8, y0, Math.min(w - 4, x1 + 14), y0, { color: C.line, width: 1 });

			/* 波腹包絡線: 兩條鏡射細線 */
			D.line(g, x0, y0 - A, x1, y0 - A, { color: C.inkFaint, width: 1 });
			D.line(g, x0, y0 + A, x1, y0 + A, { color: C.inkFaint, width: 1 });

			/* 弦 */
			g.save();
			g.strokeStyle = C.accent;
			g.lineWidth = 1.6;
			g.lineJoin = 'round';
			g.setLineDash([]);
			g.beginPath();
			g.moveTo(x0, y0);
			for (var px = x0 + 2; px < x1; px += 2) {
				var xm = (px - x0) / pxPerM;
				g.lineTo(px, y0 - A * Math.sin(k * xm) * cosP);
			}
			g.lineTo(x1, y0 - A * Math.sin(k * L) * cosP);
			g.stroke();
			g.restore();

			/* 波腹振幅 A: 在波腹上畫一段長度正好是 A 的雙向箭頭 */
			var ax = x0 + span / (2 * n) + Math.min(16, span / (4 * n));
			ax = Math.min(ax, x1 - 10);
			D.arrow(g, ax, y0, ax, y0 - A, { color: C.accent, width: 1, head: 4 });
			D.arrow(g, ax, y0 - A, ax, y0, { color: C.accent, width: 1, head: 4 });
			D.label(g, 'A', ax + 4, y0 - A * 0.5, {
				color: C.accent, size: 10.5, mono: true, align: 'left', bg: C.paper0, pad: 2
			});

			/* 質點速度: 波腹處上下動, 波節不動 */
			var vv = -sinP;
			if (Math.abs(vv) > 0.16) {
				var vy = y0 - A * cosP;          /* 波腹此刻就在弦上這一點, 速度方向由 -sin 決定 */
				var vx = Math.min(x0 + span / (2 * n) - Math.min(15, span / (4 * n)), x1 - 24);
				var vlen = 8 + 10 * Math.abs(vv);
				var dir = vv > 0 ? -1 : 1;
				D.arrow(g, vx, vy, vx, vy + dir * vlen, { color: C.inkDim, width: 1, head: 4 });
				D.label(g, 'v', vx - 3, vy + dir * (vlen + 7), {
					color: C.inkDim, size: 10, mono: true, align: 'right', bg: C.paper0, pad: 2
				});
			}

			/* 波節: 小方框 + 中心實點 */
			g.save();
			g.strokeStyle = C.ink;
			g.fillStyle = C.ink;
			g.lineWidth = 1;
			g.setLineDash([]);
			for (var j = 0; j <= n; j++) {
				var nx = x0 + span * j / n;
				g.beginPath();
				g.rect(Math.round(nx) - 3, Math.round(y0) - 3, 6, 6);
				g.stroke();
				g.beginPath();
				g.arc(nx, y0, 1.4, 0, TWO_PI);
				g.fill();
			}
			g.restore();

			/* 夾具 */
			clampBar(g, x0, y0, A, -1);
			clampBar(g, x1, y0, A, 1);
			D.handle(g, x1 + 11, y0, { color: C.accent, fill: C.paper0, size: 10, width: 1.2 });

			/* 相鄰波節 λ/2 */
			var m = Math.floor((n - 1) / 2);
			var na = x0 + span * m / n;
			var nb = x0 + span * (m + 1) / n;
			var gap = nb - na;
			var yd = Math.min(h - 26, y0 + A + 20);
			D.line(g, na, y0 + 5, na, yd + 4, { color: C.line, width: 1, dash: [2, 3] });
			D.line(g, nb, y0 + 5, nb, yd + 4, { color: C.line, width: 1, dash: [2, 3] });
			D.line(g, na, yd - 4, na, yd + 4, { color: C.lineStrong, width: 1 });
			D.line(g, nb, yd - 4, nb, yd + 4, { color: C.lineStrong, width: 1 });
			D.arrow(g, na, yd, nb, yd, { color: C.inkDim, width: 1, head: 4 });
			D.arrow(g, nb, yd, na, yd, { color: C.inkDim, width: 1, head: 4 });
			if (gap >= 40) {
				D.label(g, 'λ/2', (na + nb) / 2, yd - 8, {
					color: C.ink, size: 10.5, mono: true, align: 'center', bg: C.paper0, pad: 2
				});
			}
			if (gap >= 62) {
				D.label(g, ctx.fmt(lam / 2, 3) + ' m', (na + nb) / 2, yd + 11, {
					color: C.inkDim, size: 10, mono: true, align: 'center', bg: C.paper0, pad: 2
				});
			}

			/* 角落的兩個小字 */
			D.label(g, 'n = ' + n + '（' + n + ' 個波腹）', x0, Math.max(12, h * 0.10), {
				color: C.inkFaint, size: 10, mono: true, align: 'left'
			});
			D.label(g, 'L = ' + L.toFixed(2) + ' m', w - 4, Math.max(12, h * 0.10), {
				color: C.inkFaint, size: 10, mono: true, align: 'right'
			});
			/* f 只用來定相位, 讀數在面板; 畫面上留一個極小的真值供截圖對照 */
			D.label(g, 'f = ' + ctx.fmt(f, 0) + ' Hz', x0, h - 11, {
				color: C.inkFaint, size: 10, mono: true, align: 'left'
			});
		}

		function clampBar(g, x, y0, A, side) {
			var top = y0 - A - 10;
			var bot = y0 + A + 10;
			g.save();
			g.strokeStyle = C.ink;
			g.lineWidth = 2;
			g.lineCap = 'butt';
			g.setLineDash([]);
			g.beginPath();
			g.moveTo(Math.round(x) + 0.5, top);
			g.lineTo(Math.round(x) + 0.5, bot);
			g.stroke();
			g.lineWidth = 1;
			g.beginPath();
			for (var yy = top + 2; yy < bot; yy += 7) {
				g.moveTo(x, yy);
				g.lineTo(x + side * 7, yy + 5);
			}
			g.stroke();
			g.restore();
		}

		/* ------------------------------------------------------------ 更新 */

		function refresh() {
			var lam = 2 * st.L / st.n;
			var f = st.v / lam;
			roLam.val.textContent = ctx.fmt(lam, 3) + ' m';
			roF.val.textContent = ctx.fmt(f, 1) + ' Hz';
			roNodes.val.textContent = String(st.n + 1);
			roHalf.val.textContent = ctx.fmt(lam / 2, 3) + ' m';

			for (var i = 0; i < modeBtns.length; i++) {
				var on = (i + 1) === st.n;
				modeBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
				if (on) modeBtns[i].classList.add('is-on');
				else modeBtns[i].classList.remove('is-on');
			}
			syncField(fL, st.L);
			syncField(fV, st.v);

			dispHz = Math.min(F_DISP_MAX, 0.25 * Math.pow(Math.max(f, 1) / F_REF, 0.3));

			var tex = '\\( \\lambda = \\dfrac{2L}{n} = \\dfrac{2 \\times ' + st.L.toFixed(2) + '}{' + st.n +
				'} = ' + lam.toFixed(3) + '\\ \\text{m} \\qquad f = \\dfrac{v}{\\lambda} = ' + f.toFixed(1) +
				'\\ \\text{Hz} \\)';
			if (tex !== lastTex) {
				lastTex = tex;
				texEl.textContent = tex;
				ctx.tex(texEl);
			}

			var nt = '駐波由兩列反向行波疊加而成；波節不動、波腹振幅最大。';
			nt += '真實 f 可達 kHz，畫面以慢動作顯示。';
			if (ctx.reduced) nt += ' 已依系統設定暫停動態。';
			note.textContent = nt;

			draw(phase);
		}

		/* ------------------------------------------------------------ 拖曳 */

		var dragging = false;

		function toLocal(e) {
			var r = canvas.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };
		}

		function hitHandle(p) {
			var G = geom();
			return Math.abs(p.x - (G.x1 + 11)) < 26 && Math.abs(p.y - G.y0) < G.A + 26;
		}

		function applyDrag(p) {
			var w = view.w;
			var frac = p.x / w;
			var t = (frac - 0.62) / 0.30;
			var L = L_MIN + t * (L_MAX - L_MIN);
			L = Math.round(L / L_STEP) * L_STEP;
			L = clampNum(L, L_MIN, L_MAX);
			L = Math.round(L * 100) / 100;      /* 0.05 的格點用浮點乘回小數兩位才乾淨 */
			st.L = L;
			refresh();
		}

		canvas.addEventListener('pointerdown', function (e) {
			var p = toLocal(e);
			if (!hitHandle(p)) return;
			e.preventDefault();
			dragging = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 舊瀏覽器沒有捕獲 */ }
			applyDrag(p);
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			applyDrag(toLocal(e));
		});

		function endDrag(e) {
			if (!dragging) return;
			dragging = false;
			try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 已釋放 */ }
		}

		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);

		ctx.onResize(function () { draw(phase); });

		/* ------------------------------------------------------------ 起跑 */

		refresh();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				phase += TWO_PI * dispHz * dt;
				if (phase > TWO_PI * 1000) phase -= TWO_PI * 1000;
				draw(phase);
			});
		}

		return {
			destroy: function () {
				dragging = false;
			}
		};
	});
})();
