/**
 * ch3-young-double-slit.js — 楊氏雙縫（lab id: young-double-slit）
 *
 * 為什麼這一格「不按實距比例」：真實的 Δy 是 mm 級、D 是 m 級，同一個比例下
 * 條紋會細到看不見。所以屏的實體高度固定代表 30 mm（屏頂有尺標可核對），水平
 * 方向只是示意；兩條路徑與 P 點照畫，但 Δx 一律由 a·y/D 算，與畫面像素比例無關，
 * 所以拖到哪一點、判相長還是相消，跟讀數永遠一致。
 */
(function () {
	'use strict';

	var DD = window.DSEDraw;
	var SCREEN_MM = 30;            /* 屏的實體高度：固定的尺標，條紋間距才有物理意義 */
	var HALF_MM = SCREEN_MM / 2;
	var A_MAX = 0.60e-3;
	var TOL = 0.05;                /* 判相長的容差（以 λ 為單位）：屏上一個像素約 0.07λ，再緊就判不出來 */

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	function fx(n, d) {
		return isFinite(n) ? n.toFixed(d) : '—';
	}

	/* 光譜色由 λ 算出：波長→顏色正是這實驗要示範的物理量，不可能取自紙墨調色盤。
	   只輸出 hsl 字串，沒有任何寫死的色值。 */
	function spectral(nm) {
		var t = (nm - 380) / 320;
		if (!(t >= 0)) t = 0;
		if (t > 1) t = 1;
		return 'hsl(' + Math.round(270 - 270 * Math.pow(t, 0.92)) + ', 68%, 46%)';
	}

	var seq = 0;

	function field(labelText, min, max, step, value, shown) {
		var id = 'wo-yds-' + (++seq);
		var wrap = el('div', 'dl-field');
		var lab = el('label', 'dl-field__label', labelText);
		lab.htmlFor = id;
		var inp = document.createElement('input');
		inp.type = 'range';
		inp.className = 'dl-range';
		inp.id = id;
		inp.min = String(min);
		inp.max = String(max);
		inp.step = String(step);
		inp.value = String(value);
		inp.setAttribute('aria-valuetext', shown);
		var out = el('output', 'dl-field__val', shown);
		out.htmlFor = id;
		wrap.appendChild(lab);
		wrap.appendChild(inp);
		wrap.appendChild(out);
		return { wrap: wrap, input: inp, out: out, label: lab };
	}

	function readoutRow(key) {
		var row = el('span', 'dl-readout');
		row.appendChild(el('span', 'dl-readout__k', key));
		var v = el('span', 'dl-readout__v', '—');
		row.appendChild(v);
		return { row: row, v: v };
	}

	window.DSELab.define('young-double-slit', function (mount, ctx) {
		var C = ctx.colors;
		var st = { lambda: 600e-9, a: 0.30e-3, Dm: 1.50, pf: 0.6 };
		/* 版面暫存：pointer 事件要換算 P 的高度，不能等下一次 draw 才算 */
		var L = { midY: 100, halfPx: 80, sx: 60, bandW: 10, bx: 40, topY: 12, botY: 188 };
		var phys = { dy: 0, perCm: 0, dx: 0, q: 0, verdict: '相長' };
		var lastT = 0;

		var noteText = 'a 是雙縫間距，不是縫寬；遠屏小角度近似才用這條式子。' +
			'屏高固定代表 30 mm，水平方向不按實距比例。聚焦畫布後按 ↑ ↓ 可微調 P。' +
			(ctx.reduced ? '已依系統設定暫停動態。' : '');

		/* ---------------------------------------------------------------- 版面 */
		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrapEl = el('div', 'dl-lab__canvaswrap');
		var canvas = document.createElement('canvas');
		canvas.className = 'dl-canvas dl-canvas--drag';
		canvas.tabIndex = 0;
		canvas.setAttribute('aria-label', '楊氏雙縫干涉：拖動屏上的方塊決定 P 點位置');
		wrapEl.appendChild(canvas);
		wrapEl.appendChild(el('p', 'dl-hint', '拖動屏上的方塊 P'));
		stage.appendChild(wrapEl);

		var panel = el('div', 'dl-lab__panel');

		var gLight = el('div', 'dl-panel__group');
		gLight.appendChild(el('span', 'dl-panel__label', '光源'));
		var fLam = field('波長 λ', 380, 700, 5, 600, '600 nm');
		var swatch = el('span', 'wo-swatch');
		swatch.style.background = spectral(600);
		fLam.label.appendChild(swatch);
		gLight.appendChild(fLam.wrap);

		var gGeo = el('div', 'dl-panel__group');
		gGeo.appendChild(el('span', 'dl-panel__label', '裝置幾何'));
		var fA = field('縫間距 a', 0.1, 0.6, 0.01, 0.3, '0.30 mm');
		var fD = field('縫屏距 D', 0.5, 3, 0.01, 1.5, '1.50 m');
		gGeo.appendChild(fA.wrap);
		gGeo.appendChild(fD.wrap);

		var roEl = el('div', 'dl-readouts');
		/* 讀數標籤只用中文：.dl-readout__k 是 text-transform: uppercase，
		   寫成「級數 m」會被印成「級數 M」—— M 是放大率，不能混。 */
		var rDy = readoutRow('條紋間距');
		var rPer = readoutRow('每公分條數');
		var rDx = readoutRow('程差');
		var rM = readoutRow('級數');
		var rY = readoutRow('P 點高度');
		var rV = readoutRow('判別');
		roEl.appendChild(rDy.row);
		roEl.appendChild(rPer.row);
		roEl.appendChild(rDx.row);
		roEl.appendChild(rM.row);
		roEl.appendChild(rY.row);
		roEl.appendChild(rV.row);

		/* 頁面外殼自己也會在 mount 下面印一次 Δy = λD/a，所以這裡多帶一條判別條件，
		   讓這塊補上外殼沒有說的「為什麼亮」 */
		var formula = el('p', 'wo-formula',
			'\\( \\Delta y = \\dfrac{\\lambda D}{a} \\)　\\( \\Delta x = m\\lambda \\)');
		var live = el('p', 'wo-live', '');
		var note = el('p', 'dl-note', noteText);

		panel.appendChild(gLight);
		panel.appendChild(gGeo);
		panel.appendChild(roEl);
		panel.appendChild(formula);
		panel.appendChild(live);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);
		ctx.tex(formula);

		var view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------------------------------------------------------- 物理 */
		function compute() {
			phys.dy = st.lambda * st.Dm / st.a * 1000;             /* mm */
			phys.perCm = 10 / phys.dy;                             /* 每 cm 幾條 */
			var ymm = st.pf * HALF_MM;                             /* 屏上高度，向上為正 */
			phys.dx = st.a * (ymm / 1000) / st.Dm;                 /* 程差（m，帶正負） */
			phys.q = phys.dx / st.lambda;                          /* 以 λ 為單位 */
			var aq = Math.abs(phys.q);
			var frac = aq - Math.round(aq);
			phys.verdict = Math.abs(frac) <= TOL ? '相長' : Math.abs(frac) >= 0.5 - TOL ? '相消' : '中間';
			/* 1 mm 內不到一條時，每 cm 的數字會被四捨五入成 0，寧可說 — */
			if (!isFinite(phys.perCm)) phys.perCm = NaN;
		}

		function set(node, text) {
			if (node.textContent !== text) node.textContent = text;
		}

		function syncDom() {
			set(rDy.v, fx(phys.dy, 2) + ' mm');
			set(rPer.v, fx(phys.perCm, 1));
			set(rDx.v, fx(Math.abs(phys.dx) * 1e9, 0) + ' nm');
			set(rM.v, (phys.q >= 0 ? '+' : '\u2212') + fx(Math.abs(phys.q), 2));
			set(rY.v, fx(Math.abs(st.pf) * HALF_MM, 1) + ' mm');
			set(rV.v, phys.verdict);
			set(fLam.out, Math.round(st.lambda * 1e9) + ' nm');
			set(fA.out, fx(st.a * 1000, 2) + ' mm');
			set(fD.out, fx(st.Dm, 2) + ' m');
			set(live, 'Δy = (' + Math.round(st.lambda * 1e9) + ' nm × ' + fx(st.Dm, 2) +
				' m) ÷ ' + fx(st.a * 1000, 2) + ' mm = ' + fx(phys.dy, 2) + ' mm，' +
				'屏上每 cm 約 ' + fx(phys.perCm, 1) + ' 條');
		}

		/* ---------------------------------------------------------------- 繪圖 */
		function draw(t) {
			var g = view.ctx2d;
			var w = view.w, h = view.h;
			if (!g || w < 8 || h < 8) return;
			g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
			g.clearRect(0, 0, w, h);

			var padY = Math.max(12, Math.round(h * 0.10));
			var labelRoom = ctx.clamp(w * 0.075, 24, 40);
			var bandW = ctx.clamp(w * 0.030, 7, 18);
			var sx = w - labelRoom - bandW;
			var bx = Math.max(40, w * 0.19);
			var topY = padY, botY = h - padY;
			var midY = (topY + botY) / 2;
			var halfPx = (botY - topY) / 2;
			var mmPerPx = SCREEN_MM / (botY - topY);

			L.midY = midY; L.halfPx = halfPx; L.sx = sx; L.bandW = bandW; L.bx = bx;
			L.topY = topY; L.botY = botY;

			var sepPx = Math.max(3, (st.a / A_MAX) * (halfPx * 1.04));
			var s1y = midY - sepPx / 2;
			var s2y = midY + sepPx / 2;
			var lamPx = 9 + (st.lambda - 380e-9) / 320e-9 * 9;      /* 380→700 nm ＝ 9→18 px */
			var py = midY - (st.pf * HALF_MM) / mmPerPx;

			/* 1. 兩個縫發出、只往右傳的波前 */
			var farX = Math.max(sx - bx, 1);
			var farY = Math.max(midY, h - midY);
			var maxR = Math.sqrt(farX * farX + farY * farY) + 24;
			var count = Math.max(3, Math.min(12, Math.floor(maxR / lamPx)));
			var phase = (t * 0.5) % 1;

			g.save();
			g.beginPath();
			g.rect(bx, 0, w - bx, h);
			g.clip();
			g.strokeStyle = C.inkFaint;
			g.lineWidth = 1;
			for (var k = 0; k < count; k++) {
				var r = (k + phase) * lamPx;
				if (r < 3) continue;
				/* 外圈淡出，最外面那一圈換位時才不會忽然消失 */
				g.globalAlpha = 0.5 * (1 - k / count);
				g.beginPath();
				g.arc(bx, s1y, r, 0, Math.PI * 2);
				g.stroke();
				g.beginPath();
				g.arc(bx, s2y, r, 0, Math.PI * 2);
				g.stroke();
			}
			g.globalAlpha = 1;
			g.restore();

			/* 2. 擋板與兩道縫 */
			var gap = Math.max(4, sepPx * 0.16);
			var segs = [
				[topY, s1y - gap / 2],
				[s1y + gap / 2, s2y - gap / 2],
				[s2y + gap / 2, botY]
			];
			g.strokeStyle = C.lineStrong;
			g.lineWidth = 1.2;
			g.beginPath();
			for (var s = 0; s < 3; s++) {
				g.moveTo(bx, segs[s][0]);
				g.lineTo(bx, segs[s][1]);
			}
			g.stroke();
			DD.dot(g, bx, s1y, 1.6, { color: C.ink, width: 1 });
			DD.dot(g, bx, s2y, 1.6, { color: C.ink, width: 1 });

			/* 縫間距 a：貼著擋板左邊的雙箭頭，才是被拖的那個量 */
			if (sepPx > 11) {
				var ax = bx - 9;
				DD.arrow(g, ax, s1y, ax, s2y, { color: C.inkFaint, width: 1, head: 4 });
				DD.arrow(g, ax, s2y, ax, s1y, { color: C.inkFaint, width: 1, head: 4 });
				DD.label(g, 'a', ax - 5, midY, { mono: true, size: 10, color: C.inkDim, align: 'right' });
			}

			/* 3. 屏：強度 I = cos²(πΔx/λ) 逐列畫成短橫線（2px 一列，夠細又便宜） */
			g.fillStyle = C.paper2;
			g.fillRect(sx, topY, bandW, botY - topY);
			g.fillStyle = C.accent;
			for (var yy = topY; yy < botY; yy += 2) {
				var ymm = ((midY - yy) / halfPx) * HALF_MM;
				var c = Math.cos(Math.PI * (st.a * (ymm / 1000) / st.Dm) / st.lambda);
				g.globalAlpha = 0.06 + 0.94 * c * c;
				g.fillRect(sx, yy, bandW, 2);
			}
			g.globalAlpha = 1;
			DD.frame(g, sx, topY, bandW, botY - topY, { color: C.line });

			/* 屏頂的尺標：沒有它，條紋間距只是畫面上的像素 */
			DD.label(g, SCREEN_MM + ' mm', sx + bandW / 2, topY - 7,
				{ mono: true, size: 10, color: C.inkFaint, align: 'center' });

			/* 4. 級數刻度：只標屏上真的看得到的級數 */
			var dyMm = phys.dy;
			for (var m = -3; m <= 3; m++) {
				var ym = m * dyMm;
				var yp = midY - ym / mmPerPx;
				if (yp < topY + 5 || yp > botY - 5) continue;
				DD.line(g, sx + bandW, yp, sx + bandW + 4, yp, { color: C.line });
				DD.label(g, (m > 0 ? '+' + m : m < 0 ? '\u2212' + (-m) : '0'), sx + bandW + 6, yp,
					{ mono: true, size: 10, color: C.inkDim });
			}

			/* 5. 中央軸與光的傳播方向 */
			DD.dashed(g, bx, midY, sx - 2, midY, { color: C.line, dash: [3, 4] });
			var ax0 = bx + (sx - bx) * 0.30;
			DD.arrow(g, ax0, midY, ax0 + Math.min(26, (sx - bx) * 0.22), midY,
				{ color: C.ink, width: 1, head: 5 });
			DD.label(g, '光', ax0 + Math.min(26, (sx - bx) * 0.22) + 4, midY - 8,
				{ mono: true, size: 10, color: C.inkDim });

			/* 6. 兩條光程與 P 點。r₁ / r₂ 是 Δx 的兩個來源，不標就看不出「差在哪」；
			   縫太近時兩條線幾乎重合，寧可不標也不要疊字。 */
			DD.line(g, bx, s1y, sx, py, { color: C.inkDim, width: 1 });
			DD.line(g, bx, s2y, sx, py, { color: C.inkDim, width: 1 });
			if (sepPx > 18) {
				var fr = 0.46;
				DD.label(g, 'r₁', bx + (sx - bx) * fr, s1y + (py - s1y) * fr - 9,
					{ mono: true, size: 10, color: C.inkDim, align: 'center', bg: C.paper0, pad: 2 });
				DD.label(g, 'r₂', bx + (sx - bx) * fr, s2y + (py - s2y) * fr + 9,
					{ mono: true, size: 10, color: C.inkDim, align: 'center', bg: C.paper0, pad: 2 });
			}
			DD.handle(g, sx + bandW / 2, py, { size: 9, color: C.accent, fill: C.paper0 });

			/* 7. P 點旁邊的關鍵量：程差的 λ 倍數與判別。
			   兩行預設上下各一；P 貼到頂或底時整對翻到另一側，最後才夾進安全區，
			   因為 .dl-hint 固定壓在畫布左下，標籤掉進去就讀不了。 */
			var tagX = sx - 8;
			var y1 = py - 14, y2 = py + 15;
			if (y1 < 13) { y1 = py + 15; y2 = py + 31; }
			if (y2 > h - 26) { y1 = py - 30; y2 = py - 14; }
			y1 = ctx.clamp(y1, 13, h - 26);
			y2 = ctx.clamp(y2, 13, h - 26);
			DD.label(g, 'Δx ' + fx(Math.abs(phys.q), 2) + 'λ', tagX, y1,
				{ mono: true, size: 10, color: C.accent, align: 'right', bg: C.paper0, pad: 2 });
			DD.label(g, phys.verdict, tagX, y2,
				{ mono: true, size: 10, color: phys.verdict === '中間' ? C.inkDim : C.accent,
					align: 'right', bg: C.paper0, pad: 2 });
		}

		/* ---------------------------------------------------------------- 互動 */
		var dragging = false;

		function pfAt(e) {
			var rect = canvas.getBoundingClientRect();
			var y = e.clientY - rect.top;
			return ctx.clamp((L.midY - y) / (L.halfPx || 1), -1, 1);
		}

		function render() {
			compute();
			syncDom();
			draw(lastT);
		}

		canvas.addEventListener('pointerdown', function (e) {
			e.preventDefault();
			dragging = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 舊瀏覽器沒有捕獲也能拖 */ }
			st.pf = pfAt(e);
			render();
		});
		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			st.pf = pfAt(e);
			render();
		});
		function stopDrag() { dragging = false; }
		canvas.addEventListener('pointerup', stopDrag);
		canvas.addEventListener('pointercancel', stopDrag);

		/* 鍵盤走同一條路：Canvas 可聚焦，方向鍵就是那顆「配對的滑桿」 */
		canvas.addEventListener('keydown', function (e) {
			var step = e.shiftKey ? 0.1 : 0.02;
			var d = 0;
			if (e.key === 'ArrowUp') d = step;
			else if (e.key === 'ArrowDown') d = -step;
			else return;
			e.preventDefault();
			st.pf = ctx.clamp(st.pf + d, -1, 1);
			render();
		});

		fLam.input.addEventListener('input', function () {
			st.lambda = Number(fLam.input.value) * 1e-9;
			swatch.style.background = spectral(Number(fLam.input.value));
			render();
		});
		fA.input.addEventListener('input', function () {
			st.a = Number(fA.input.value) * 1e-3;
			render();
		});
		fD.input.addEventListener('input', function () {
			st.Dm = Number(fD.input.value);
			render();
		});

		ctx.onResize(render);
		render();

		if (!ctx.reduced) {
			ctx.raf(function (dt, t) {
				lastT = t;
				draw(t);
			});
		}

		return {
			destroy: function () {
				dragging = false;
			}
		};
	});
})();
