/**
 * ch3-refraction-tir.js — 折射與全內反射 (DSE 物理 · III.b · 實驗 06)
 *
 * 為什麼畫面只留一個自由度: 學生真正會錯的不是 Snell 的公式本身, 而是
 * 「i 從法線量起」與「全反射只發生在光密→光疏」。所以入射線的遠端是唯一
 * 可拖的東西, 折射線隨之消失, 而 C 一直畫在入射側當標尺 —— 拖過去就能看到
 * 「越過 C 之後折射線整條不見」這一刻。
 *
 * 顏色分工: 入射＝墨(最重), 折射＝勃艮第紅(這一格要看的量), 反射＝淡墨,
 * 法線與介面＝細線。介面以上 air 用 paper0, 以下玻璃用 paper2 染色。
 */
(function () {
	'use strict';

	var DEG = Math.PI / 180;
	var DASH_N = [3, 4];
	var DASH_C = [5, 4];
	var TIR_FADE = 6;          /* 度: 臨界角前 6° 開始淡出折射線 */

	window.DSELab.define('refraction-tir', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */
		var iDeg = 30;
		var nG = 1.5;
		var toAir = false;        /* false: 空氣→玻璃; true: 玻璃→空氣 */
		var phase = 0;
		var PULSE = 2.8;          /* 秒 / 一輪光脈衝 */

		/* 每幀都要重算的純量放這裡, 迴圈裡不配動物件 */
		var st = { si: 0, sinR: 0, rDeg: 0, cDeg: 0, tir: false, fade: 1 };

		/* 繪圖選項一律重用同一批物件 (DSEDraw 是同步讀取的) */
		var oLine = { color: '', width: 1, dash: null };
		var oArrow = { color: '', width: 1.4, head: 7, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };
		var oTag = { color: '', fill: '', size: 10 };
		var oArc = { color: '', width: 1, dash: null, ccw: false };
		var oDot = { color: '', fill: '', stroke: false, width: 1 };
		var oHandle = { color: '', fill: '', size: 10, width: 1.2 };

		var view = null;
		var canvas = null;
		var glassLbl = '玻璃 n = 1.50';
		var dragging = false;

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		/* 固定小數位: 拖動時數字不會忽長忽短 (NaN/Infinity 一律給破折號) */
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

		/* 箭頭畫在線段中段: 三條射線都從 O 出發, 箭頭擠在 O 會糊成一團 */
		function midArrow(g, x1, y1, x2, y2, color, width, head) {
			var ax = x1 + (x2 - x1) * 0.42;
			var ay = y1 + (y2 - y1) * 0.42;
			oArrow.color = color;
			oArrow.width = width;
			oArrow.head = head;
			oArrow.dash = null;
			D.arrow(g, ax, ay, x1 + (x2 - x1) * 0.58, y1 + (y2 - y1) * 0.58, oArrow);
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

		function tag(g, text, x, y, color, fill, size) {
			oTag.color = color;
			oTag.fill = fill;
			oTag.size = size;
			D.tag(g, text, x, y, oTag);
		}

		/* 由 O 沿 (dx,dy) 走到框邊的距離; 用來讓射線剛好停在畫布內 */
		function reach(ox, oy, dx, dy, x0, y0, x1, y1) {
			var t = Infinity;
			var k;
			if (dx > 1e-9) { k = (x1 - ox) / dx; if (k < t) t = k; }
			else if (dx < -1e-9) { k = (x0 - ox) / dx; if (k < t) t = k; }
			if (dy > 1e-9) { k = (y1 - oy) / dy; if (k < t) t = k; }
			else if (dy < -1e-9) { k = (y0 - oy) / dy; if (k < t) t = k; }
			return t > 0 && isFinite(t) ? t : 0;
		}

		/* 取兩角之間較短的那一段 (避免畫出 350° 的大迴圈) */
		function shortSweep(a0, a1) {
			var d = a1 - a0;
			while (d > Math.PI) d -= Math.PI * 2;
			while (d < -Math.PI) d += Math.PI * 2;
			return d;
		}

		function arcAt(g, cx, cy, r, a0, a1, color, width, dash) {
			var d = shortSweep(a0, a1);
			oArc.color = color;
			oArc.width = width;
			oArc.dash = dash || null;
			oArc.ccw = d < 0;
			D.arc(g, cx, cy, r, a0, a0 + d, oArc);
		}

		/* ---------------- 物理 ---------------- */

		/* 只寫一次: draw() 與 syncUI() 都靠這份結果, 免得兩處各算一次而走樣 */
		function compute() {
			var s = Math.sin(iDeg * DEG);
			st.si = s;
			st.sinR = toAir ? nG * s : s / nG;
			st.tir = st.sinR > 1;
			st.rDeg = st.tir ? NaN : Math.asin(st.sinR) / DEG;
			st.cDeg = toAir ? Math.asin(1 / nG) / DEG : NaN;
			st.fade = 1;
			if (toAir && isFinite(st.cDeg)) {
				var left = st.cDeg - iDeg;
				st.fade = left <= 0 ? 0 : left >= TIR_FADE ? 1 : left / TIR_FADE;
			}
			return st;
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		var hint = el('p', 'dl-hint', '拖動入射線的端點，改入射角 i');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel ry-panel');

		/* 模式 */
		var gMode = el('div', 'dl-panel__group');
		gMode.appendChild(el('span', 'dl-panel__label', '光的方向'));
		var seg = el('div', 'dl-seg');
		var btnA = el('button', 'dl-btn', '空氣→玻璃');
		var btnB = el('button', 'dl-btn', '玻璃→空氣');
		btnA.type = 'button';
		btnB.type = 'button';
		btnA.setAttribute('aria-pressed', 'true');
		btnB.setAttribute('aria-pressed', 'false');
		btnA.classList.add('is-on');
		seg.appendChild(btnA);
		seg.appendChild(btnB);
		gMode.appendChild(seg);

		/* 入射角 */
		var fI = el('div', 'dl-field');
		fI.appendChild(el('span', 'dl-field__label', '入射角 i'));
		var inI = el('input', 'dl-range');
		inI.type = 'range';
		inI.min = '0';
		inI.max = '89';
		inI.step = '1';
		inI.value = String(iDeg);
		inI.setAttribute('aria-label', '入射角 i（度）');
		var outI = el('output', 'dl-field__val', '30°');
		fI.appendChild(inI);
		fI.appendChild(outI);
		gMode.appendChild(fI);

		/* 折射率 */
		var gN = el('div', 'dl-panel__group');
		gN.appendChild(el('span', 'dl-panel__label', '介質'));
		var fN = el('div', 'dl-field');
		fN.appendChild(el('span', 'dl-field__label', '折射率 n'));
		var inN = el('input', 'dl-range');
		inN.type = 'range';
		inN.min = '1.15';
		inN.max = '1.95';
		inN.step = '0.01';
		inN.value = '1.50';
		inN.setAttribute('aria-label', '玻璃折射率 n');
		var outN = el('output', 'dl-field__val', '1.50');
		fN.appendChild(inN);
		fN.appendChild(outN);
		gN.appendChild(fN);

		/* 讀數 */
		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}
		var rds = el('div', 'dl-readouts ry-rd');
		var rdN = cell('n 玻璃');
		var rdI = cell('i');
		var rdR = cell('r');
		var rdC = cell('臨界角 C');
		var rdQ = cell('sin i / sin r');
		rdQ.root.classList.add('ry-wide');
		rds.appendChild(rdN.root);
		rds.appendChild(rdI.root);
		rds.appendChild(rdR.root);
		rds.appendChild(rdC.root);
		rds.appendChild(rdQ.root);

		/* 公式列: 兩行都隨參數即時重繪 (KaTeX 由 ctx.tex 負責) */
		var texBox = el('div', 'ry-tex');
		var texA = el('span', 'ry-tex__row', '');
		var texB = el('span', 'ry-tex__row', '');
		texA.setAttribute('aria-live', 'off');
		texB.setAttribute('aria-live', 'off');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var alertEl = el('p', 'ry-alert', '全反射：折射線消失，光全部反射回玻璃，只剩反射線。');
		alertEl.hidden = true;
		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gN);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(alertEl);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數與公式 ---------------- */

		var lastA = '';
		var lastB = '';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		var NOTE_A = '光疏→光密：折射線永遠比入射線更貼近法線，入射角再大也不會全反射。';
		var NOTE_B = '全反射只發生在「由光密射向光疏」且入射角大於臨界角時；光纖與內窺鏡靠的就是它。';
		var REDUCED = ' 已依系統設定暫停動態。';

		function syncUI() {
			var s = compute();

			outI.textContent = num(iDeg, 0) + '°';
			outN.textContent = num(nG, 2);
			glassLbl = '玻璃 n = ' + num(nG, 2);

			rdN.v.textContent = num(nG, 2);
			rdI.v.textContent = num(iDeg, 0) + '°';
			rdR.v.textContent = s.tir ? '—' : num(s.rDeg, 2) + '°';
			rdR.v.classList.toggle('ry-acc', !s.tir);
			rdR.v.classList.toggle('ry-mute', s.tir);

			if (toAir) {
				rdC.v.textContent = num(s.cDeg, 2) + '°';
				rdC.v.classList.remove('ry-mute');
				rdC.root.title = '';
			} else {
				rdC.v.textContent = '不適用';
				rdC.v.classList.add('ry-mute');
				rdC.root.title = '不適用：由光疏射向光密';
			}

			/* DSE 寫 n = sin i / sin r 是「光疏→光密」的方向; 反過來量就要倒著寫,
			   否則同一個 n 會在兩邊顯示成不同的數 */
			rdQ.k.textContent = toAir ? 'sin r / sin i' : 'sin i / sin r';
			if (s.tir || iDeg < 0.5) {
				rdQ.v.textContent = '—';
				rdQ.v.classList.add('ry-mute');
			} else {
				var ratio = toAir
					? Math.sin(s.rDeg * DEG) / s.si
					: s.si / Math.sin(s.rDeg * DEG);
				rdQ.v.textContent = num(ratio, 3);
				rdQ.v.classList.remove('ry-mute');
			}

			/* 比值列 */
			var a;
			if (s.tir) {
				a = '\\( \\sin i = ' + num(s.si, 3) + ' > \\sin C = ' + num(Math.sin(s.cDeg * DEG), 3) +
					' \\)　折射線消失';
			} else if (iDeg < 0.5) {
				a = '\\( \\dfrac{\\sin i}{\\sin r} = n = ' + num(nG, 2) + ' \\)';
			} else if (toAir) {
				a = '\\( \\dfrac{\\sin r}{\\sin i} = \\dfrac{' + num(Math.sin(s.rDeg * DEG), 3) + '}{' +
					num(s.si, 3) + '} = ' + num(nG, 2) + ' \\)';
			} else {
				a = '\\( \\dfrac{\\sin i}{\\sin r} = \\dfrac{' + num(s.si, 3) + '}{' +
					num(Math.sin(s.rDeg * DEG), 3) + '} = ' + num(nG, 2) + ' \\)';
			}
			/* 臨界角列 */
			var b;
			if (toAir) {
				b = '\\( \\sin C = \\dfrac{1}{n} = \\dfrac{1}{' + num(nG, 2) + '} = ' +
					num(1 / nG, 3) + ' \\)　\\( C = ' + num(s.cDeg, 2) + '^{\\circ} \\)';
			} else {
				b = '\\( \\sin C = \\dfrac{1}{n} = ' + num(1 / nG, 3) + ' \\)　由光疏射向光密：不適用';
			}

			lastA = setTeX(texA, a, lastA);
			lastB = setTeX(texB, b, lastB);

			alertEl.hidden = !s.tir;
			note.textContent = (toAir ? NOTE_B : NOTE_A) + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖 ---------------- */

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 40 || H < 40) return;

			var s = compute();
			var m = Math.max(9, Math.min(W, H) * 0.045);
			var cx = Math.round(W * 0.5);
			var cy = Math.round(H * 0.5);
			var top = m;
			var bot = H - m;
			var left = m;
			var right = W - m;
			var head = Math.max(5, Math.min(8, W * 0.011));
			var rArc = Math.max(20, Math.min(48, Math.min(W, H) * 0.14));

			/* 介質染色: 上半 air(paper0), 下半玻璃(paper2) */
			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, cy);
			g.fillStyle = C.paper2;
			g.fillRect(0, cy, W, H - cy);

			/* 法線 (虛線): 用 inkFaint 而不是 line —— 角度是從它量起的, 不能淡到看不見 */
			ln(g, cx, top, cx, bot, C.inkFaint, 1, DASH_N);

			/* 方向: i 一律自法線量起 */
			var ci = Math.cos(iDeg * DEG);
			var diX = toAir ? -s.si : s.si;
			var diY = toAir ? -ci : ci;
			var cr = s.tir ? 0 : Math.sqrt(Math.max(0, 1 - s.sinR * s.sinR));
			var sr2 = s.tir ? 0 : s.sinR;
			var drX = toAir ? -sr2 : sr2;
			var drY = toAir ? -cr : cr;
			var rfX = diX;
			var rfY = -diY;

			var inTop = toAir ? cy + 2 : top;
			var inBot = toAir ? bot : cy - 2;
			var outTop = toAir ? top : cy + 2;
			var outBot = toAir ? cy - 2 : bot;

			var tIn = reach(cx, cy, -diX, -diY, left, inTop, right, inBot);
			var ex = cx - diX * tIn;
			var ey = cy - diY * tIn;
			var tOut = reach(cx, cy, drX, drY, left, outTop, right, outBot);
			var tx = cx + drX * tOut;
			var ty = cy + drY * tOut;
			var tRf = reach(cx, cy, rfX, rfY, left, inTop, right, inBot);
			var rx = cx + rfX * tRf;
			var ry = cy + rfY * tRf;

			/* 反射線先畫, 壓在入射線下面 */
			ln(g, cx, cy, rx, ry, C.inkDim, 1.2, null);
			midArrow(g, cx, cy, rx, ry, C.inkDim, 1.2, head);

			/* 入射線 */
			ln(g, ex, ey, cx, cy, C.ink, 1.7, null);
			midArrow(g, ex, ey, cx, cy, C.ink, 1.7, head);

			/* 折射線: 最後 6° 線性淡出, 到 C 整條消失 */
			if (!s.tir && s.fade > 0.02) {
				g.save();
				g.globalAlpha = s.fade;
				ln(g, cx, cy, tx, ty, C.accent, 1.7, null);
				midArrow(g, cx, cy, tx, ty, C.accent, 1.7, head);
				g.restore();
			}

			/* 介面壓在射線之上, 讓兩側的線乾淨收在同一條細線上 */
			ln(g, 0, cy + 0.5, W, cy + 0.5, C.inkDim, 1, null);

			/* 入射角弧 */
			var aNormIn = toAir ? Math.PI / 2 : -Math.PI / 2;
			var aFar = Math.atan2(-diY, -diX);
			arcAt(g, cx, cy, rArc, aNormIn, aFar, C.inkDim, 1, null);
			var midIn = aNormIn + shortSweep(aNormIn, aFar) * 0.5;
			tag(g, 'i', cx + Math.cos(midIn) * (rArc + 13), cy + Math.sin(midIn) * (rArc + 13),
				C.ink, toAir ? C.paper2 : C.paper0, 10);

			/* 折射角弧 (含淡出) */
			if (!s.tir && s.fade > 0.02) {
				var aNormOut = toAir ? -Math.PI / 2 : Math.PI / 2;
				var aR = Math.atan2(drY, drX);
				g.save();
				g.globalAlpha = s.fade;
				arcAt(g, cx, cy, rArc, aNormOut, aR, C.accent, 1, null);
				var midR = aNormOut + shortSweep(aNormOut, aR) * 0.5;
				tag(g, 'r', cx + Math.cos(midR) * (rArc + 13), cy + Math.sin(midR) * (rArc + 13),
					C.accent, toAir ? C.paper0 : C.paper2, 10);
				g.restore();
			}

			/* 臨界角弧: 只在玻璃→空氣成立, 畫在入射側當標尺 */
			if (toAir) {
				var cRad = s.cDeg * DEG;
				var rC = rArc * 1.62;
				arcAt(g, cx, cy, rC, Math.PI / 2, Math.PI / 2 - cRad, C.accent, 1, DASH_C);
				tag(g, 'C', cx + Math.sin(cRad) * (rC + 12), cy + Math.cos(cRad) * (rC + 12),
					C.accent, C.paper2, 10);
			}

			/* 拖曳點: 入射線的遠端 */
			oHandle.color = C.ink;
			oHandle.fill = toAir ? C.paper2 : C.paper0;
			oHandle.size = 10;
			oHandle.width = 1.2;
			D.handle(g, ex, ey, oHandle);

			/* 介質標籤: 右上(空氣)與左下(玻璃)是兩條射線都不經過的角落 */
			lbl(g, '空氣 n = 1.00', right - 3, cy - 12, C.inkFaint, 10, 'right', 'middle', true, C.paper0);
			lbl(g, glassLbl, left + 3, cy + 12, C.inkFaint, 10, 'left', 'middle', true, C.paper2);

			/* 圖例 */
			var lx0 = right - 46;
			var ly0 = top + 6;
			ln(g, lx0, ly0, lx0 + 15, ly0, C.ink, 2, null);
			lbl(g, '入射', lx0 + 20, ly0, C.inkFaint, 10, 'left', 'middle', false, null);
			ln(g, lx0, ly0 + 15, lx0 + 15, ly0 + 15, C.accent, 2, null);
			lbl(g, '折射', lx0 + 20, ly0 + 15, C.inkFaint, 10, 'left', 'middle', false, null);
			ln(g, lx0, ly0 + 30, lx0 + 15, ly0 + 30, C.inkDim, 2, null);
			lbl(g, '反射', lx0 + 20, ly0 + 30, C.inkFaint, 10, 'left', 'middle', false, null);

			/* 光脈衝: 沿入射線走, 過了 O 分成折射與反射兩支 */
			if (!ctx.reduced) {
				oDot.color = C.accent;
				oDot.fill = C.accent;
				oDot.stroke = false;
				if (phase < 0.46) {
					var f0 = phase / 0.46;
					D.dot(g, ex + (cx - ex) * f0, ey + (cy - ey) * f0, 2.6, oDot);
				} else {
					var f1 = (phase - 0.46) / 0.54;
					if (!s.tir && s.fade > 0.02) {
						g.save();
						g.globalAlpha = s.fade;
						D.dot(g, cx + (tx - cx) * f1, cy + (ty - cy) * f1, 2.6, oDot);
						g.restore();
					}
					oDot.color = C.inkDim;
					oDot.fill = C.inkDim;
					D.dot(g, cx + (rx - cx) * f1, cy + (ry - cy) * f1, 2.4, oDot);
				}
			}
		}

		/* ---------------- 互動 ---------------- */

		function setI(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 0, 89));
			if (n === iDeg) return;
			iDeg = n;
			inI.value = String(n);
			syncUI();
			draw();
		}

		/* 由指標位置反推 i: 只取「離法線多遠」, 指標落在哪一側都不影響 */
		function iFromPointer(e) {
			var r = canvas.getBoundingClientRect();
			var W = view.w || r.width;
			var H = view.h || r.height;
			var dx = e.clientX - r.left - W * 0.5;
			var dy = e.clientY - r.top - H * 0.5;
			var a = toAir ? Math.atan2(Math.abs(dx), dy) : Math.atan2(Math.abs(dx), -dy);
			return a / DEG;
		}

		canvas.addEventListener('pointerdown', function (e) {
			dragging = true;
			/* 合成事件與少數舊指標沒有 active pointer, 捕捉失敗不該把整格畫布打斷 */
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒有可捕捉的指標 */ }
			e.preventDefault();
			setI(iFromPointer(e));
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			setI(iFromPointer(e));
		});

		function endDrag(e) {
			if (!dragging) return;
			dragging = false;
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
				canvas.releasePointerCapture(e.pointerId);
			}
		}
		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);

		inI.addEventListener('input', function () {
			setI(parseFloat(inI.value));
		});

		inN.addEventListener('input', function () {
			var v = parseFloat(inN.value);
			if (!isFinite(v)) return;
			nG = ctx.clamp(v, 1.15, 1.95);
			inN.value = String(nG);
			syncUI();
			draw();
		});

		function setMode(toAirNext) {
			toAir = toAirNext;
			btnA.classList.toggle('is-on', !toAir);
			btnB.classList.toggle('is-on', toAir);
			btnA.setAttribute('aria-pressed', toAir ? 'false' : 'true');
			btnB.setAttribute('aria-pressed', toAir ? 'true' : 'false');
			hint.textContent = toAir
				? '拖動玻璃裡那條入射線的端點'
				: '拖動入射線的端點，改入射角 i';
			syncUI();
			draw();
		}

		btnA.addEventListener('click', function () { setMode(false); });
		btnB.addEventListener('click', function () { setMode(true); });

		ctx.onResize(draw);

		syncUI();
		draw();

		if (ctx.reduced) {
			/* 靜態: 參數一改就重畫, 不需要 raf */
			draw();
		} else {
			ctx.raf(function (dt) {
				phase = (phase + dt / PULSE) % 1;
				draw();
			});
		}
	});
})();
