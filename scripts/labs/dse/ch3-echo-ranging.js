/**
 * ch3-echo-ranging.js — 回聲測距 d = vt/2（lab id: echo-ranging）
 *
 * 為什麼同一條走廊畫兩段脈衝：這個實驗的失分點只有兩個 —— 忘記 t 是往返，
 * 以及用了錯的聲速。前者用去程（墨色）與回程（accent）兩段方向相反的波前、
 * 加上一塊從 0 數到 2d/v 的儀表講清楚；後者用一個獨立的「假設聲速 v′」與
 * 量得距離 d′ 對照真實距離，讓系統誤差變成可以自己調出來的東西。
 *
 * 畫面時間固定壓縮 1.8 倍（RATE），讀數一律是真實秒數；兩者的差距寫在
 * .dl-note 第一句，免得把動畫速度當成量度。色值全部來自 ctx.colors。
 */
(function () {
	'use strict';

	var DMIN = 20;
	var DMAX = 340;
	var VMIN = 300;
	var VMAX = 360;
	var SRC_F = 0.10;      /* 聲源固定在 10% 畫布寬 */
	var NEAR_F = 0.45;     /* 峭壁最近 45%，對應 d = DMIN */
	var FAR_F = 0.92;      /* 最遠 92%：留 8% 給峭壁右側的排線 */
	var RATE = 1.8;        /* 畫面時間 ÷ 真實時間，與 .dl-note 的 1.8 倍速同一個數 */
	var HOLD = 0.7;        /* 自動重複：收到回聲後停留多少畫面秒 */
	var DASH = [4, 4];
	var DASH_F = [3, 4];

	function node(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	window.DSELab.define('echo-ranging', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;

		/* 每幀都會呼叫 DSEDraw：選項物件先建好、每幀只改欄位，避免每 frame 產生垃圾 */
		var oLine = { color: '', width: 1 };
		var oDash = { color: '', width: 1, dash: DASH };
		var oDashF = { color: '', width: 1, dash: DASH_F };
		var oArrow = { color: '', width: 1, head: 5 };
		var oArc = { color: '', width: 1 };
		var oFrame = { color: '', width: 1 };
		var oLabel = { color: '', size: 11, align: 'left', baseline: 'middle', bg: null, pad: 3, mono: false };

		var st = {
			d: 340,
			v: 340,
			va: 340,
			phase: 'idle',     /* idle | flight | done */
			elapsed: 0,        /* 已飛行的真實秒數 */
			flash: 0,          /* 收到回聲後的一次性高亮，衰減到 0 為止 */
			auto: false,
			wait: 0
		};
		var view = null;
		var seq = 0;

		/* v ≥ 300、d ≥ 20，分母不會是 0 */
		function secs() { return 2 * st.d / st.v; }

		function sign(n, digits) {
			if (!isFinite(n)) return '—';
			var mag = Math.abs(n).toFixed(digits);
			if (Number(mag) === 0) return '0';
			return (n < 0 ? '-' : '+') + mag;
		}

		/* 減少動態時沒有衰減動畫，改成讓「已量到」的儀表維持 accent 邊框 */
		function hot() { return st.flash > 0.02 || (ctx.reduced && st.phase === 'done'); }

		/* ---------------------------------------------------------------- DOM */

		mount.textContent = '';

		var grid = node('div', 'dl-lab__grid');
		var stage = node('div', 'dl-lab__stage');
		var wrap = node('div', 'dl-lab__canvaswrap');
		var canvas = document.createElement('canvas');
		canvas.className = 'dl-canvas dl-canvas--drag';
		canvas.setAttribute('aria-label', '回聲測距示意：左邊是聲源，右邊是可左右拖動的峭壁');
		var hint = node('p', 'dl-hint', '左右拖動：拉近或推遠峭壁');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);
		grid.appendChild(stage);

		var panel = node('div', 'dl-lab__panel');

		function field(labelText, min, max, step, val) {
			var row = node('div', 'dl-field');
			var id = 'sd-echo-' + (seq++);
			var lab = node('label', 'dl-field__label', labelText);
			lab.htmlFor = id;
			var input = document.createElement('input');
			input.type = 'range';
			input.className = 'dl-range';
			input.id = id;
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(val);
			var out = document.createElement('output');
			out.className = 'dl-field__val';
			out.htmlFor = id;
			out.textContent = String(val);
			row.appendChild(lab);
			row.appendChild(input);
			row.appendChild(out);
			return { row: row, input: input, out: out };
		}

		var gMeasure = node('div', 'dl-panel__group');
		gMeasure.appendChild(node('span', 'dl-panel__label', '量度設定'));
		var fV = field('聲速 v', VMIN, VMAX, 1, st.v);
		var fD = field('距離 d', DMIN, DMAX, 1, st.d);
		var fA = field('假設聲速 v′', VMIN, VMAX, 1, st.va);
		gMeasure.appendChild(fV.row);
		gMeasure.appendChild(fD.row);
		gMeasure.appendChild(fA.row);

		var gPulse = node('div', 'dl-panel__group');
		gPulse.appendChild(node('span', 'dl-panel__label', '脈衝'));
		var seg = node('div', 'dl-seg');
		var bFire = document.createElement('button');
		bFire.type = 'button';
		bFire.className = 'dl-btn';
		bFire.textContent = '發射脈衝';
		var bAuto = document.createElement('button');
		bAuto.type = 'button';
		bAuto.className = 'dl-btn';
		bAuto.textContent = '自動重複';
		bAuto.setAttribute('aria-pressed', 'false');
		seg.appendChild(bFire);
		seg.appendChild(bAuto);
		gPulse.appendChild(seg);

		function readout(kText) {
			var cell = node('span', 'dl-readout');
			cell.appendChild(node('span', 'dl-readout__k', kText));
			var v = node('span', 'dl-readout__v');
			var main = node('span', null, '—');
			v.appendChild(main);
			cell.appendChild(v);
			return { cell: cell, main: main, v: v };
		}

		var rD = readout('真實 d');
		var rT = readout('往返 t');
		var rM = readout('量得 d′');
		var rE = readout('誤差');
		var readouts = node('div', 'dl-readouts');
		readouts.appendChild(rD.cell);
		readouts.appendChild(rT.cell);
		readouts.appendChild(rM.cell);
		readouts.appendChild(rE.cell);

		var series = node('div', 'sd-series');
		series.appendChild(node('span', 'sd-series__k', '誤差百分比'));
		var serV = node('span', 'sd-series__v');
		var serMain = node('span', null, '—');
		serV.appendChild(serMain);
		series.appendChild(serV);

		var rel = node('div', 'sd-rel');
		var relRow = node('div', 'sd-rel__row');
		var relEq = node('span', null, '');
		/* 量得的誤差只取決於兩個聲速的比值 —— 這條關係比重抄公式有用 */
		relEq.textContent = "\\( \\dfrac{d'}{d} = \\dfrac{v'}{v} \\)";
		ctx.tex(relEq);
		var relNum = node('span', 'sd-rel__num', '= —');
		relRow.appendChild(relEq);
		relRow.appendChild(relNum);
		rel.appendChild(relRow);

		var note = node('p', 'dl-note');
		var noteText = '動畫以 1.8 倍速播放，時間讀數為真實值。t 是往返總時間，所以 d = vt/2；聲速隨溫度改變（0 °C 331、20 °C 343 m/s），假設錯就有系統誤差。';
		if (ctx.reduced) noteText += ' 已依系統設定暫停動態。';
		note.textContent = noteText;

		panel.appendChild(gMeasure);
		panel.appendChild(gPulse);
		panel.appendChild(readouts);
		panel.appendChild(series);
		panel.appendChild(rel);
		panel.appendChild(note);
		grid.appendChild(panel);
		mount.appendChild(grid);

		/* ------------------------------------------------------------- 讀數 */

		function updateReadouts() {
			var T = secs();
			var dMeas = st.va * T / 2;
			var err = dMeas - st.d;
			var pct = err / st.d * 100;      /* d ≥ 20 m，不會除以 0 */
			var off = Math.abs(pct) >= 0.05;
			rD.main.textContent = st.d.toFixed(0) + ' m';
			rT.main.textContent = T.toFixed(3) + ' s';
			rM.main.textContent = dMeas.toFixed(1) + ' m';
			rE.main.textContent = sign(err, 1) + ' m';
			var verdict = !off ? '與真實一致' : pct < 0 ? '量得比真實近' : '量得比真實遠';
			serMain.textContent = sign(pct, 1) + ' %（' + verdict + '）';
			serMain.classList.toggle('sd-hot', off);
			rE.main.classList.toggle('sd-hot', off);
			relNum.textContent = '= ' + (st.va / st.v).toFixed(3);
			relNum.classList.toggle('sd-hot', Math.abs(st.va - st.v) > 0.5);
		}

		/* ------------------------------------------------------------- 繪圖 */

		function draw() {
			if (!view || !view.ctx2d) return;
			var g = view.ctx2d;
			var w = view.w;
			var h = view.h;
			if (!(w > 2) || !(h > 2)) return;
			g.clearRect(0, 0, w, h);

			var fs = Math.max(10, Math.min(12, h * 0.052));
			var srcX = w * SRC_F;
			var cliffX = w * (NEAR_F + (st.d - DMIN) / (DMAX - DMIN) * (FAR_F - NEAR_F));
			var axisY = h * 0.42;
			var dimY = h * 0.64;
			var blkH = Math.max(34, Math.min(52, h * 0.16));
			var blkY = h - 22 - blkH;
			var beamCap = Math.max(8, Math.min(h * 0.17, dimY - axisY - h * 0.07));
			var wallH = Math.max(12, Math.min(h * 0.26, axisY - h * 0.10, dimY - axisY - 8));
			var wallTop = axisY - wallH;
			var wallBot = axisY + wallH;
			var mid = (srcX + cliffX) / 2;

			/* 狀態：三個詞就把脈衝的整個生命週期講完 */
			oLabel.size = fs;
			oLabel.align = 'left';
			oLabel.baseline = 'top';
			oLabel.bg = null;
			oLabel.mono = true;
			oLabel.color = hot() ? C.accent : C.inkDim;
			D.label(g, st.phase === 'idle' ? '待發射' : st.phase === 'flight' ? '脈衝飛行中' : '已收到回聲', 10, Math.max(6, h * 0.035), oLabel);

			/* 峭壁：一條立面 + 右側排線（排線畫在實體那一邊） */
			oLine.color = C.lineStrong;
			oLine.width = 1.6;
			D.line(g, cliffX, wallTop, cliffX, wallBot, oLine);
			oLine.color = C.line;
			oLine.width = 1;
			var k;
			for (k = 0; k < 4; k++) {
				var hy = wallTop + (wallBot - wallTop) * (k + 0.5) / 4;
				D.line(g, cliffX + 1, hy, cliffX + 7, hy - 6, oLine);
			}

			/* 走廊：虛線是構造線，不是實物 */
			oDash.color = C.line;
			oDash.width = 1;
			D.line(g, srcX, axisY, cliffX, axisY, oDash);

			/* 尺寸線：引出虛線 + 兩頭向外的箭頭 */
			oDashF.color = C.line;
			D.line(g, srcX, axisY + 8, srcX, dimY + 2, oDashF);
			D.line(g, cliffX, wallBot + 2, cliffX, dimY + 2, oDashF);
			oArrow.color = C.ink;
			oArrow.width = 1;
			oArrow.head = 5;
			D.arrow(g, mid, dimY, srcX, dimY, oArrow);
			D.arrow(g, mid, dimY, cliffX, dimY, oArrow);

			/* 聲源：喇叭用線畫，不用 emoji */
			var s = Math.max(7, Math.min(11, h * 0.045));
			g.save();
			g.strokeStyle = C.ink;
			g.lineWidth = 1.2;
			g.lineJoin = 'miter';
			g.setLineDash([]);
			g.strokeRect(Math.round(srcX - s * 1.45) + 0.5, Math.round(axisY - s * 0.42) + 0.5, Math.round(s * 0.9), Math.round(s * 0.84));
			g.beginPath();
			g.moveTo(srcX - s * 0.55, axisY - s * 0.42);
			g.lineTo(srcX + s * 0.62, axisY - s * 1.15);
			g.lineTo(srcX + s * 0.62, axisY + s * 1.15);
			g.lineTo(srcX - s * 0.55, axisY + s * 0.42);
			g.closePath();
			g.stroke();
			g.restore();

			/* 標籤：紙色底把底下的線開一個口，數字才不會被線穿過 */
			oLabel.mono = false;
			oLabel.bg = C.paper0;
			oLabel.pad = 3;
			oLabel.color = C.inkDim;
			oLabel.align = 'center';
			oLabel.baseline = 'bottom';
			D.label(g, '聲源', ctx.clamp(srcX + 2, 22, w - 22), axisY - s * 1.15 - 3, oLabel);
			oLabel.align = 'right';
			oLabel.baseline = 'top';
			D.label(g, '峭壁', cliffX - 6, wallTop + 2, oLabel);
			oLabel.align = 'center';
			oLabel.baseline = 'middle';
			oLabel.mono = true;
			oLabel.color = C.ink;
			D.label(g, 'd = ' + st.d.toFixed(0) + ' m', mid, dimY, oLabel);

			/* 脈衝：去程墨色、回程 accent；波前是圓弧，越遠越平（點聲源的自然結果）。
			   收到之後波前已經回到聲源、疊在揚聲器上，只會擋住標籤，所以不再畫。 */
			if (st.phase === 'flight') {
				var T = secs();
				var uu = T > 0 ? Math.min(1, st.elapsed / T) : 1;
				var span = cliffX - srcX;
				var fwd = uu < 0.5;
				var r = span * (fwd ? 2 * uu : 2 * (uu - 0.5));
				var cx = fwd ? srcX : cliffX;
				var dir = fwd ? 1 : -1;
				var col = fwd ? C.ink : C.accent;
				var frontX = cx + dir * r;
				var gap = Math.max(5, h * 0.024);
				var j;
				for (j = 0; j < 3; j++) {
					var rr = r - j * gap;
					if (rr < 1.5) continue;
					var ha = Math.min(Math.PI / 2, Math.asin(Math.min(1, beamCap / rr)));
					oArc.color = col;
					oArc.width = j === 0 ? 1.6 : 1;
					var a0 = dir > 0 ? -ha : Math.PI - ha;
					D.arc(g, cx, axisY, rr, a0, a0 + ha * 2, oArc);
				}
				oArrow.color = col;
				oArrow.width = 1.5;
				oArrow.head = 6;
				D.arrow(g, frontX - dir * Math.max(9, h * 0.045), axisY, frontX, axisY, oArrow);
				oLabel.align = 'center';
				oLabel.baseline = 'middle';
				oLabel.mono = true;
				oLabel.color = col;
				oLabel.bg = C.paper0;
				D.label(g, fwd ? '脈衝 →' : '← 回聲', ctx.clamp(frontX, 30, w - 30), axisY - beamCap - fs * 0.75, oLabel);
			}

			/* 儀表塊：t 從 0 數到 2d/v，回聲回來那一刻才把 d′ 填上去 */
			var uuB = st.phase === 'idle' ? 0 : Math.min(1, st.elapsed / secs());
			oFrame.color = hot() ? C.accent : C.line;
			oFrame.width = 1 + (st.flash > 0.02 ? st.flash * 1.2 : 0);
			D.frame(g, srcX, blkY, cliffX - srcX, blkH, oFrame);
			var pad = ctx.clamp((cliffX - srcX) * 0.06, 6, 10);
			oLabel.align = 'left';
			oLabel.baseline = 'middle';
			oLabel.mono = true;
			oLabel.bg = null;
			oLabel.size = fs;
			oLabel.color = C.ink;
			D.label(g, 't = ' + Math.round(uuB * secs() * 1000) + ' ms', srcX + pad, blkY + blkH * 0.34, oLabel);
			oLabel.color = hot() ? C.accent : C.inkDim;
			D.label(g, st.phase === 'done' ? 'd′ = ' + (st.va * secs() / 2).toFixed(1) + ' m' : 'd′ = —', srcX + pad, blkY + blkH * 0.64, oLabel);
			var trackY = blkY + blkH - Math.max(5, blkH * 0.15);
			oLine.color = C.line;
			oLine.width = 1;
			D.line(g, srcX + pad, trackY, cliffX - pad, trackY, oLine);
			if (uuB > 0.002) {
				oLine.color = C.accent;
				oLine.width = 2;
				D.line(g, srcX + pad, trackY, srcX + pad + (cliffX - srcX - pad * 2) * uuB, trackY, oLine);
			}
		}

		/* ------------------------------------------------------------- 狀態 */

		function sync() {
			updateReadouts();
			draw();
		}

		function launch() {
			st.elapsed = 0;
			st.flash = 0;
			st.wait = 0;
			st.phase = 'flight';
			/* 減少動態：不跑動畫，直接畫「已經量到」的那一格 */
			if (ctx.reduced) {
				st.phase = 'done';
				st.elapsed = secs();
			}
			draw();
		}

		/* 改參數就作廢飛行中的脈衝：否則 t 與距離會對不上，讀數就開始說謊 */
		function abort() {
			if (st.phase === 'flight') {
				st.phase = 'idle';
				st.elapsed = 0;
			}
		}

		function setDistance(d) {
			var next = Math.round(ctx.clamp(d, DMIN, DMAX));
			if (next === st.d) return;
			st.d = next;
			fD.input.value = String(next);
			fD.out.textContent = String(next);
			abort();
			sync();
		}

		fV.input.addEventListener('input', function () {
			st.v = +fV.input.value;
			fV.out.textContent = String(st.v);
			abort();
			sync();
		});
		fD.input.addEventListener('input', function () {
			setDistance(+fD.input.value);
		});
		fA.input.addEventListener('input', function () {
			st.va = +fA.input.value;
			fA.out.textContent = String(st.va);
			sync();
		});

		bFire.addEventListener('click', function () { launch(); });

		bAuto.addEventListener('click', function () {
			st.auto = !st.auto;
			bAuto.setAttribute('aria-pressed', String(st.auto));
			bAuto.classList.toggle('is-on', st.auto);
			if (st.auto && st.phase !== 'flight') launch();
		});

		/* ------------------------------------------------------------- 拖曳 */

		function fromClientX(clientX) {
			var r = canvas.getBoundingClientRect();
			if (!r.width) return;
			var frac = ctx.clamp((clientX - r.left) / r.width, NEAR_F, FAR_F);
			setDistance(DMIN + (frac - NEAR_F) / (FAR_F - NEAR_F) * (DMAX - DMIN));
		}

		var dragging = false;
		function onDown(e) {
			dragging = true;
			e.preventDefault();
			if (canvas.setPointerCapture) {
				try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 舊瀏覽器沒有捕獲 */ }
			}
			fromClientX(e.clientX);
		}
		function onMove(e) {
			if (!dragging) return;
			e.preventDefault();
			fromClientX(e.clientX);
		}
		function onUp(e) {
			if (!dragging) return;
			dragging = false;
			if (canvas.releasePointerCapture) {
				try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 同上 */ }
			}
		}
		canvas.addEventListener('pointerdown', onDown);
		canvas.addEventListener('pointermove', onMove);
		canvas.addEventListener('pointerup', onUp);
		canvas.addEventListener('pointercancel', onUp);

		/* ------------------------------------------------------------- 啟動 */

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });
		ctx.onResize(draw);
		sync();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				if (st.phase === 'flight') {
					st.elapsed += dt * RATE;
					if (st.elapsed >= secs()) {
						st.elapsed = secs();
						st.phase = 'done';
						st.flash = 1;
						st.wait = 0;
					}
				} else if (st.phase === 'done') {
					if (st.flash > 0) st.flash = Math.max(0, st.flash - dt * 2.4);
					if (st.auto) {
						st.wait += dt;
						if (st.wait >= HOLD) { launch(); return; }
					}
				}
				draw();
			});
		}

		return {
			destroy: function () {
				canvas.removeEventListener('pointerdown', onDown);
				canvas.removeEventListener('pointermove', onMove);
				canvas.removeEventListener('pointerup', onUp);
				canvas.removeEventListener('pointercancel', onUp);
			}
		};
	});
})();
