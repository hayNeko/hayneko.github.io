/**
 * ch3-thin-lens.js — 薄透鏡成像 (DSE 物理 · III.b · 實驗 07)
 *
 * 為什麼要三條作圖光線: 「實像/虛像」不是記號規則, 而是三條線交在哪一側的
 * 必然結果。所以物件一被拖過焦點, 射線的交點就自己跑到左邊、像箭頭轉正,
 * 學生看到的是幾何, 不是口訣。
 *
 * 符號慣例(全檔一致): 實像 v > 0, 虛像 v < 0, 凹透鏡 f < 0。
 * 有了這條, F 與 F′ 的位置 lx ∓ f·s 自己就會換邊, 不必為凹透鏡另寫一套。
 *
 * 水平尺度固定 (整條水平軸 = 64 cm), 拖動時物件才不會跟著自己跑;
 * 因此 u 很大時物件會擠到左緣, 這是刻意換取「拖起來是線性的」。
 */
(function () {
	'use strict';

	var DASH_EXT = [4, 4];
	var AXIS_CM = 64;          /* 左側要放得下 u 的上限 60 cm 再留一點 */

	window.DSELab.define('thin-lens', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */
		var uCm = 30;
		var fMag = 10;
		var concave = false;
		var phase = 0;
		var PULSE = 3.2;
		var dragging = false;
		var sPx = 4;               /* px / cm, 每幀依畫布寬重算 */
		var lxPx = 0;

		/* draw() 會把三條作圖光線寫進這三個物件 (欄位固定, 不重新配置) */
		var R = [
			{ on: false, ax: 0, ay: 0, bx: 0, by: 0, ex: 0, ey: 0, gx: 0, gy: 0, hasExt: false },
			{ on: false, ax: 0, ay: 0, bx: 0, by: 0, ex: 0, ey: 0, gx: 0, gy: 0, hasExt: false },
			{ on: false, ax: 0, ay: 0, bx: 0, by: 0, ex: 0, ey: 0, gx: 0, gy: 0, hasExt: false }
		];

		var oLine = { color: '', width: 1, dash: null };
		var oArrow = { color: '', width: 1.4, head: 7, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };
		var oDot = { color: '', fill: '', stroke: false, width: 1 };
		var oHandle = { color: '', fill: '', size: 10, width: 1.2 };

		var view = null;
		var canvas = null;

		/* 畫在畫布上的字在 syncUI 就先組好: draw() 每幀都跑, 不該在裡面做字串串接 */
		var uTxt = 'u = 30.0 cm';
		var vTxt = 'v = 15.0 cm';
		var mTxt = 'M = 0.50';

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

		function lbl(g, text, x, y, color, size, align, baseline, mono, bg) {
			oLabel.color = color;
			oLabel.size = size;
			oLabel.align = align || 'left';
			oLabel.baseline = baseline || 'middle';
			oLabel.mono = mono !== false;
			oLabel.bg = bg || null;
			D.label(g, text, x, y, oLabel);
		}

		/* 沿 (dx,dy) 走到框邊的距離, 讓射線停在畫布內而不被切掉 */
		function reach(ox, oy, dx, dy, x0, y0, x1, y1) {
			var t = Infinity;
			var k;
			if (dx > 1e-9) { k = (x1 - ox) / dx; if (k < t) t = k; }
			else if (dx < -1e-9) { k = (x0 - ox) / dx; if (k < t) t = k; }
			if (dy > 1e-9) { k = (y1 - oy) / dy; if (k < t) t = k; }
			else if (dy < -1e-9) { k = (y0 - oy) / dy; if (k < t) t = k; }
			return t > 0 && isFinite(t) ? t : 0;
		}

		/* ---------------- 物理 ---------------- */

		var st = { u: 0, f: 0, v: NaN, M: NaN, real: false, inf: false };

		function compute() {
			var f = concave ? -fMag : fMag;
			st.u = uCm;
			st.f = f;
			if (Math.abs(uCm - f) < 0.02) {
				/* 物件正好落在焦點: v 趨近無限大, 直接標記, 不要讓數字爆掉 */
				st.v = NaN;
				st.M = NaN;
				st.real = false;
				st.inf = true;
			} else {
				st.v = (f * uCm) / (uCm - f);
				st.M = Math.abs(st.v / uCm);
				st.real = st.v > 0;
				st.inf = false;
			}
			return st;
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		var hint = el('p', 'dl-hint', '拖動左側物件的底部，改物距 u');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel ry-panel');

		var gType = el('div', 'dl-panel__group');
		gType.appendChild(el('span', 'dl-panel__label', '透鏡'));
		var seg = el('div', 'dl-seg');
		var btnConvex = el('button', 'dl-btn', '凸透鏡');
		var btnConcave = el('button', 'dl-btn', '凹透鏡');
		btnConvex.type = 'button';
		btnConcave.type = 'button';
		btnConvex.setAttribute('aria-pressed', 'true');
		btnConcave.setAttribute('aria-pressed', 'false');
		btnConvex.classList.add('is-on');
		seg.appendChild(btnConvex);
		seg.appendChild(btnConcave);
		gType.appendChild(seg);

		var fU = el('div', 'dl-field');
		fU.appendChild(el('span', 'dl-field__label', '物距 u'));
		var inU = el('input', 'dl-range');
		inU.type = 'range';
		inU.min = '2';
		inU.max = '60';
		inU.step = '0.1';
		inU.value = '30';
		inU.setAttribute('aria-label', '物距 u（厘米）');
		var outU = el('output', 'dl-field__val', '30.0 cm');
		fU.appendChild(inU);
		fU.appendChild(outU);
		gType.appendChild(fU);

		var gF = el('div', 'dl-panel__group');
		gF.appendChild(el('span', 'dl-panel__label', '焦距'));
		var fF = el('div', 'dl-field');
		fF.appendChild(el('span', 'dl-field__label', '焦距 |f|'));
		var inF = el('input', 'dl-range');
		inF.type = 'range';
		inF.min = '4';
		inF.max = '20';
		inF.step = '0.5';
		inF.value = '10';
		inF.setAttribute('aria-label', '焦距大小（厘米）');
		var outF = el('output', 'dl-field__val', '10.0 cm');
		fF.appendChild(inF);
		fF.appendChild(outF);
		gF.appendChild(fF);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}
		var rds = el('div', 'dl-readouts ry-rd');
		var rdU = cell('u');
		var rdV = cell('v');
		var rdF = cell('f');
		var rdM = cell('|M|');
		var rdK = cell('性質');
		rdK.root.classList.add('ry-wide');
		rds.appendChild(rdU.root);
		rds.appendChild(rdV.root);
		rds.appendChild(rdF.root);
		rds.appendChild(rdM.root);
		rds.appendChild(rdK.root);

		var texBox = el('div', 'ry-tex');
		var texA = el('span', 'ry-tex__row', '');
		var texB = el('span', 'ry-tex__row', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gType);
		panel.appendChild(gF);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 ---------------- */

		var lastA = '';
		var lastB = '';
		var NOTE = '貼近焦點時像跑到無限遠；凹透鏡永遠成正立縮小虛像。DSE 慣例：實像 v 取正、虛像 v 取負、凹透鏡 f 取負。';
		var REDUCED = ' 已依系統設定暫停動態。';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var s = compute();
			var fTxt = (s.f < 0 ? '-' : '') + num(Math.abs(s.f), 1);

			outU.textContent = num(uCm, 1) + ' cm';
			outF.textContent = (concave ? '-' : '') + num(fMag, 1) + ' cm';
			uTxt = 'u = ' + num(uCm, 1) + ' cm';
			vTxt = 'v = ' + num(s.v, 1) + ' cm';
			mTxt = 'M = ' + num(s.M, 2);

			rdU.v.textContent = num(uCm, 1) + ' cm';
			rdF.v.textContent = fTxt + ' cm';
			rdM.v.textContent = s.inf ? '—' : num(s.M, 2);
			rdM.v.classList.toggle('ry-mute', s.inf);

			if (s.inf) {
				rdV.v.textContent = '—';
				rdV.v.classList.add('ry-mute');
				rdK.v.textContent = '像在無限遠';
				rdK.v.classList.add('ry-acc');
			} else {
				rdV.v.textContent = num(s.v, 1) + ' cm';
				rdV.v.classList.toggle('ry-mute', false);
				rdV.v.classList.toggle('ry-acc', s.v < 0);
				var kind = s.v > 0 ? '實像 · 倒立' : '虛像 · 正立';
				if (s.M > 1.001) kind += ' · 放大';
				else if (s.M < 0.999) kind += ' · 縮小';
				else kind += ' · 等大';
				rdK.v.textContent = kind;
				rdK.v.classList.remove('ry-acc');
			}

			var a;
			if (s.inf) {
				a = '\\( \\dfrac{1}{u} + \\dfrac{1}{v} = \\dfrac{1}{f} \\)　\\( v \\to \\infty \\)';
			} else {
				a = '\\( \\dfrac{1}{' + num(uCm, 1) + '} + \\dfrac{1}{' + num(s.v, 1) + '} = \\dfrac{1}{' +
					(s.f < 0 ? '-' : '') + num(Math.abs(s.f), 1) + '} \\)';
			}
			var b;
			if (s.inf) {
				b = '\\( M = \\left|\\dfrac{v}{u}\\right| \\)　物在焦點上，像不成在有限位置';
			} else {
				b = '\\( M = \\left|\\dfrac{v}{u}\\right| = \\dfrac{' + num(Math.abs(s.v), 1) + '}{' +
					num(uCm, 1) + '} = ' + num(s.M, 2) + ' \\)';
			}
			lastA = setTeX(texA, a, lastA);
			lastB = setTeX(texB, b, lastB);

			note.textContent = NOTE + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖 ---------------- */

		/* 焦距刻度 (F / F′ / 2F): 先畫軸上短刻度, 標籤落在軸下一律同高 */
		function tick(g, cy, left, right, x, text, strong) {
			if (x < left + 2 || x > right - 2) return;
			ln(g, x, cy - 5, x, cy + 5, strong ? C.inkDim : C.inkFaint, 1, null);
			if (text) lbl(g, text, x, cy + 15, C.inkFaint, 10, 'center', 'middle', true, C.paper0);
		}

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 40 || H < 40) return;

			var s = compute();
			var m = Math.max(9, Math.min(W, H) * 0.045);
			var cy = Math.round(H * 0.5);
			var left = m;
			var right = W - m;
			var top = m;
			var bot = H - m;
			var lx = Math.round(W * 0.52);
			var head = Math.max(5, Math.min(8, W * 0.011));

			/* 水平尺度整條軸固定 64cm: 拖動物件才是線性的 */
			sPx = Math.max(1.2, (lx - left - 4) / AXIS_CM);
			lxPx = lx;

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			var objH = ctx.clamp(H * 0.13, 24, 46);
			var f = s.f;
			var ox = lx - uCm * sPx;
			var oy = cy - objH;
			var xF = lx - f * sPx;
			var xFp = lx + f * sPx;

			/* 主軸 */
			ln(g, left, cy + 0.5, right, cy + 0.5, C.lineStrong, 1, null);

			/* 焦距刻度: 先畫刻度再畫透鏡, 透鏡線壓在最上面 */
			tick(g, cy, left, right, xF, 'F', true);
			tick(g, cy, left, right, xFp, 'F\u2032', true);
			if (Math.abs(f) * sPx > 30) {
				tick(g, cy, left, right, xF - Math.abs(f) * sPx * (f > 0 ? 1 : -1), '2F', false);
				tick(g, cy, left, right, xFp + Math.abs(f) * sPx * (f > 0 ? 1 : -1), '2F\u2032', false);
			}

			/* 三條作圖光線 */
			var i;
			for (i = 0; i < 3; i++) { R[i].on = false; R[i].hasExt = false; }

			/* (1) 平行主軸 → 過 F′ */
			var d1x = Math.abs(f) * sPx;
			var d1y = f > 0 ? objH : -objH;
			var n1 = Math.sqrt(d1x * d1x + d1y * d1y) || 1;
			d1x /= n1; d1y /= n1;
			var t1 = reach(lx, oy, d1x, d1y, left, top, right, bot);
			R[0].on = true;
			R[0].ax = ox; R[0].ay = oy;
			R[0].bx = lx; R[0].by = oy;
			R[0].ex = lx + d1x * t1; R[0].ey = oy + d1y * t1;
			if (s.v < 0) {
				var te1 = reach(lx, oy, -d1x, -d1y, left, top, lx, bot);
				R[0].gx = lx - d1x * te1; R[0].gy = oy - d1y * te1;
				R[0].hasExt = true;
			}

			/* (2) 過透鏡中心, 不偏折 */
			var d2x = lx - ox;
			var d2y = cy - oy;
			var n2 = Math.sqrt(d2x * d2x + d2y * d2y) || 1;
			d2x /= n2; d2y /= n2;
			var t2 = reach(lx, cy, d2x, d2y, left, top, right, bot);
			R[1].on = true;
			R[1].ax = ox; R[1].ay = oy;
			R[1].bx = lx; R[1].by = cy;
			R[1].ex = lx + d2x * t2; R[1].ey = cy + d2y * t2;

			/* (3) 過 F → 出射平行主軸; u = f 時這條退化成物件自身, 直接跳過 */
			var den = ox - xF;
			if (Math.abs(den) > 1.2) {
				var y3 = cy + ((oy - cy) / den) * (lx - xF);
				if (y3 > top && y3 < bot) {
					R[2].on = true;
					R[2].ax = ox; R[2].ay = oy;
					R[2].bx = lx; R[2].by = y3;
					R[2].ex = right; R[2].ey = y3;
					if (s.v < 0) {
						R[2].gx = left; R[2].gy = y3;
						R[2].hasExt = true;
					}
				}
			}

			/* 虛像的延長線先畫 (在最底層), 實線才壓得住 */
			if (s.v < 0) {
				for (i = 0; i < 3; i++) {
					if (R[i].on && R[i].hasExt) {
						ln(g, R[i].bx, R[i].by, R[i].gx, R[i].gy, C.inkFaint, 1, DASH_EXT);
					}
				}
			}

			for (i = 0; i < 3; i++) {
				if (!R[i].on) continue;
				ln(g, R[i].ax, R[i].ay, R[i].bx, R[i].by, C.inkDim, 1.1, null);
				ln(g, R[i].bx, R[i].by, R[i].ex, R[i].ey, C.inkDim, 1.1, null);
				var ax0 = R[i].bx + (R[i].ex - R[i].bx) * 0.45;
				var ay0 = R[i].by + (R[i].ey - R[i].by) * 0.45;
				arw(g, ax0, ay0,
					R[i].bx + (R[i].ex - R[i].bx) * 0.62,
					R[i].by + (R[i].ey - R[i].by) * 0.62,
					C.inkDim, 1.1, head, null);
			}

			/* 透鏡: 一條細線 + 兩端的箭頭帽 (凸向外, 凹向內) */
			var lh = ctx.clamp(H * 0.46, 78, 190);
			var y0 = cy - lh;
			var y1 = cy + lh;
			ln(g, lx, y0, lx, y1, C.ink, 1.4, null);
			if (f > 0) {
				arw(g, lx, y0 + 9, lx, y0, C.ink, 1.4, 6, null);
				arw(g, lx, y1 - 9, lx, y1, C.ink, 1.4, 6, null);
			} else {
				arw(g, lx, y0, lx, y0 + 9, C.ink, 1.4, 6, null);
				arw(g, lx, y1, lx, y1 - 9, C.ink, 1.4, 6, null);
			}

			/* 物件: 只有一支在軸上的箭頭 + 腳下的拖曳點, 不再加文字 (u 由底部量度線說明) */
			arw(g, ox, cy, ox, oy, C.ink, 1.8, Math.max(6, head), null);

			/* 像: 實像實線(在軸下, 倒立), 虛像虛線(在軸上, 正立) */
			var ix = lx + s.v * sPx;
			var onCanvas = isFinite(s.v) && ix > left + 3 && ix < right - 3;
			/* 實像留在量度帶之上, 否則箭頭會壓到 u/v 的數字 */
			var maxLen = s.v > 0 ? bot - 26 - cy : cy - top - 4;
			var len = isFinite(s.v) ? objH * s.M : 0;
			var clamped = false;
			if (onCanvas) {
				if (len > maxLen) { len = maxLen; clamped = true; }
				var tipY = cy + (s.v > 0 ? len : -len);
				arw(g, ix, cy, ix, tipY, C.accent, 1.8, Math.max(6, head), s.v < 0 ? DASH_EXT : null);
				/* 標籤放在箭尖「外側」: 放在軸那一側會撞上 F′ / 2F′ 的刻度字 */
				lbl(g, '像', ix + 8, tipY + (s.v > 0 ? 8 : -8), C.accent, 10, 'left', 'middle', false, C.paper0);
				if (clamped) {
					lbl(g, mTxt, ix + 7, cy + (s.v > 0 ? -8 : 8), C.accent, 10,
						'left', 'middle', true, C.paper0);
				}
			}

			/* 無像/畫布外: 畫布右上角給一句狀態, 不留下空白的猜測 */
			var status = '';
			if (s.inf) status = '像在無限遠';
			else if (!onCanvas) status = '像在畫布外';

			if (status) {
				lbl(g, status, right - 3, top + 5, C.accent, 10.5, 'right', 'middle', false, C.paper0);
			}

			/* u / v 量度線: 實像時 v 在透鏡右邊, 兩者天然分開; 虛像時 v 也落在透鏡左邊,
			   會壓在 u 上, 所以整個 v 量度帶錯開一列 —— 階梯式標註在工程圖上是常態 */
			/* 兩段量度線平常同一列; 窄畫布上 u 與 v 的數字會撞在一起 (虛像時尤其,
			   此時 v 也落在透鏡左邊), 撞到就把 v 整條往上錯一列。
			   字寬用 10px 等寬字約 6px/字元估, 不必為了排版去 measureText。 */
			var cxU = (ox + lx) * 0.5;
			var cxV = (lx + ix) * 0.5;
			var clash = onCanvas && lx - ox > 14 && Math.abs(ix - lx) > 14 &&
				Math.abs(cxU - cxV) < (uTxt.length + vTxt.length) * 3 + 8;
			var dyU = bot - 20;
			var dyV = clash ? dyU - 18 : dyU;
			if (lx - ox > 14) {
				ln(g, ox, dyU, lx, dyU, C.inkFaint, 1, null);
				ln(g, ox, dyU - 4, ox, dyU + 4, C.inkFaint, 1, null);
				ln(g, lx, dyU - 4, lx, dyU + 4, C.inkFaint, 1, null);
				lbl(g, uTxt, cxU, dyU - 9, C.inkFaint, 10, 'center', 'middle', true, C.paper0);
			}
			if (onCanvas && Math.abs(ix - lx) > 14) {
				ln(g, lx, dyV, ix, dyV, C.inkFaint, 1, null);
				ln(g, ix, dyV - 4, ix, dyV + 4, C.inkFaint, 1, null);
				lbl(g, vTxt, cxV, dyV - 9, C.inkFaint, 10, 'center', 'middle', true, C.paper0);
			}

			/* 拖曳點: 物件的腳, 明確告訴手指可以抓哪裡 */
			oHandle.color = C.ink;
			oHandle.fill = C.paper0;
			oHandle.size = 11;
			oHandle.width = 1.2;
			D.handle(g, ox, cy, oHandle);

			/* 光脈衝: 三條線各走一遍, 錯開相位免得三顆一起動 */
			if (!ctx.reduced) {
				oDot.color = C.accent;
				oDot.fill = C.accent;
				oDot.stroke = false;
				for (i = 0; i < 3; i++) {
					if (!R[i].on) continue;
					var t = (phase + i * 0.17) % 1;
					var px;
					var py;
					if (t < 0.45) {
						var k0 = t / 0.45;
						px = R[i].ax + (R[i].bx - R[i].ax) * k0;
						py = R[i].ay + (R[i].by - R[i].ay) * k0;
					} else {
						var k1 = (t - 0.45) / 0.55;
						px = R[i].bx + (R[i].ex - R[i].bx) * k1;
						py = R[i].by + (R[i].ey - R[i].by) * k1;
					}
					D.dot(g, px, py, 2.4, oDot);
				}
			}
		}

		/* ---------------- 互動 ---------------- */

		function setU(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 2, 60) * 10) / 10;
			if (n === uCm) return;
			uCm = n;
			inU.value = String(n);
			syncUI();
			draw();
		}

		function uFromPointer(e) {
			var r = canvas.getBoundingClientRect();
			var lx = lxPx || (view.w || r.width) * 0.52;
			return (lx - (e.clientX - r.left)) / sPx;
		}

		canvas.addEventListener('pointerdown', function (e) {
			dragging = true;
			/* 合成事件與少數舊指標沒有 active pointer, 捕捉失敗不該把整格畫布打斷 */
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒有可捕捉的指標 */ }
			e.preventDefault();
			setU(uFromPointer(e));
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			setU(uFromPointer(e));
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

		inU.addEventListener('input', function () {
			setU(parseFloat(inU.value));
		});

		inF.addEventListener('input', function () {
			var v = parseFloat(inF.value);
			if (!isFinite(v)) return;
			fMag = ctx.clamp(v, 4, 20);
			inF.value = String(fMag);
			syncUI();
			draw();
		});

		function setType(nextConcave) {
			concave = nextConcave;
			btnConvex.classList.toggle('is-on', !concave);
			btnConcave.classList.toggle('is-on', concave);
			btnConvex.setAttribute('aria-pressed', concave ? 'false' : 'true');
			btnConcave.setAttribute('aria-pressed', concave ? 'true' : 'false');
			hint.textContent = concave
				? '凹透鏡：拖動物件，看虛像怎麼跟著跑'
				: '拖動左側物件的底部，改物距 u';
			syncUI();
			draw();
		}

		btnConvex.addEventListener('click', function () { setType(false); });
		btnConcave.addEventListener('click', function () { setType(true); });

		ctx.onResize(draw);

		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				phase = (phase + dt / PULSE) % 1;
				draw();
			});
		}
	});
})();
