/**
 * ch3-pipe-standing.js — 管中駐波與音調（lab id: pipe-standing）
 *
 * 為什麼用「左端恆開、右端可閉」這一種構型：開管與閉管的差別只在右端是波腹
 * 還是波節，把兩種管子畫在同一條軸上，奇次諧波那一排按鈕才有東西可對照。
 * 位移包絡畫成兩條鏡像曲線（課本的畫法），空氣質點則沿管軸真的左右動 ——
 * 前者是振幅圖，後者是物理位移，兩個一起看才不會把駐波誤認成橫波。
 *
 * 質點動畫固定每秒 0.9 次，只是示意；讀數裡的 f 才是這條管子的真實頻率。
 * 色值全部來自 ctx.colors：本檔沒有任何色字面值。
 */
(function () {
	'use strict';

	var LMIN = 0.30;
	var LMAX = 1.20;
	var VMIN = 331;
	var VMAX = 343;
	var X0 = 0.10;          /* 左端（恆為開口） */
	var X1 = 0.90;          /* 右端（開或閉） */
	var MOTION_HZ = 0.9;    /* 質點示意的振動頻率，不是真實頻率 */
	var DASH = [4, 4];
	var DOTS = 14;

	function node(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	window.DSELab.define('pipe-standing', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;

		/* 每幀都會呼叫 DSEDraw：選項物件先建好、每幀只改欄位 */
		var oLine = { color: '', width: 1 };
		var oDash = { color: '', width: 1, dash: DASH };
		var oArrow = { color: '', width: 1, head: 4 };
		var oLabel = { color: '', size: 11, align: 'left', baseline: 'middle', bg: null, pad: 3, mono: false };
		var oNode = { color: '', fill: '', size: 5, width: 1 };
		var oDot = { color: '', fill: true, stroke: false, width: 1 };

		var st = { L: 0.50, v: 340, closed: false, n: 1 };
		var view = null;
		var phaseT = 0;
		var seq = 0;

		/* m = 管裡有幾個「半波長」= L /(λ/2)。開管 m = n，閉管 m = (2n-1)/2。
		   這個寫法讓兩種管子共用同一條包絡 y = A·cos(mπx/L)，也保證 m > 0。 */
		function mOf() { return st.closed ? (2 * st.n - 1) / 2 : st.n; }
		function lambda() { return 2 * st.L / mOf(); }
		function freq() { return st.v / lambda(); }
		function base() { return st.closed ? st.v / (4 * st.L) : st.v / (2 * st.L); }

		/* ---------------------------------------------------------------- DOM */

		mount.textContent = '';

		var grid = node('div', 'dl-lab__grid');
		var stage = node('div', 'dl-lab__stage');
		var wrap = node('div', 'dl-lab__canvaswrap');
		var canvas = document.createElement('canvas');
		canvas.className = 'dl-canvas';
		canvas.setAttribute('aria-label', '管中駐波示意：水平管子，內部畫出位移包絡、波節方塊與沿管軸來回振動的空氣質點');
		wrap.appendChild(canvas);
		stage.appendChild(wrap);
		grid.appendChild(stage);

		var panel = node('div', 'dl-lab__panel');

		function field(labelText, min, max, step, val) {
			var row = node('div', 'dl-field');
			var id = 'sd-pipe-' + (seq++);
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

		function seg(labels, onPick) {
			var box = node('div', 'dl-seg');
			var btns = [];
			for (var i = 0; i < labels.length; i++) {
				(function (idx) {
					var b = document.createElement('button');
					b.type = 'button';
					b.className = 'dl-btn';
					b.textContent = labels[idx];
					b.setAttribute('aria-pressed', 'false');
					b.addEventListener('click', function () { onPick(idx); });
					box.appendChild(b);
					btns.push(b);
				})(i);
			}
			return { box: box, btns: btns };
		}

		var gPipe = node('div', 'dl-panel__group');
		gPipe.appendChild(node('span', 'dl-panel__label', '管子'));
		var fL = field('管長 L', LMIN, LMAX, 0.01, st.L);
		fL.out.textContent = st.L.toFixed(2);   /* 起始值也給兩位小數，拖過之後才不會換寫法 */
		var modeSeg = seg(['開管', '閉管'], function (idx) { setMode(idx === 1); });
		gPipe.appendChild(fL.row);
		gPipe.appendChild(modeSeg.box);

		var gWave = node('div', 'dl-panel__group');
		gWave.appendChild(node('span', 'dl-panel__label', '介質與諧波'));
		var fV = field('聲速 v', VMIN, VMAX, 1, st.v);
		var nSeg = seg(['第1諧波', '第2諧波', '第3諧波'], function (idx) { setN(idx + 1); });
		gWave.appendChild(fV.row);
		gWave.appendChild(nSeg.box);

		function readout(kText) {
			var cell = node('span', 'dl-readout');
			cell.appendChild(node('span', 'dl-readout__k', kText));
			var v = node('span', 'dl-readout__v');
			var main = node('span', null, '—');
			v.appendChild(main);
			cell.appendChild(v);
			return { cell: cell, main: main };
		}

		var rLam = readout('λ');
		var rF = readout('f');
		var rF1 = readout('基頻 f₁');
		var rRatio = readout('λ / L');
		var readouts = node('div', 'dl-readouts');
		readouts.appendChild(rLam.cell);
		readouts.appendChild(rF.cell);
		readouts.appendChild(rF1.cell);
		readouts.appendChild(rRatio.cell);

		var series = node('div', 'sd-series');
		series.appendChild(node('span', 'sd-series__k', '此管能發出的頻率'));
		var serV = node('span', 'sd-series__v');
		var serSym = node('span', null, '');
		var serNum = node('span', null, '—');
		serV.appendChild(serSym);
		serV.appendChild(serNum);
		series.appendChild(serV);

		var rel = node('div', 'sd-rel');
		var rowOpen = node('div', 'sd-rel__row');
		rowOpen.textContent = '開管 \\( L = \\dfrac{n\\lambda}{2} \\)';
		var rowClosed = node('div', 'sd-rel__row');
		rowClosed.textContent = '閉管 \\( L = \\dfrac{(2n-1)\\lambda}{4} \\)';
		var rowF = node('div', 'sd-rel__row');
		rowF.textContent = '\\( f = \\dfrac{v}{\\lambda} \\)';
		var rowFnum = node('span', 'sd-rel__num', '= —');
		rowF.appendChild(rowFnum);
		rel.appendChild(rowOpen);
		rel.appendChild(rowClosed);
		rel.appendChild(rowF);

		var note = node('p', 'dl-note');
		var noteText = '閉管基頻是開管的一半；閉管只出現奇次諧波，所以聽起來更「空」。本主題屬延伸。質點動畫每秒 0.9 次示意，讀數為真實頻率。';
		if (ctx.reduced) noteText += ' 已依系統設定暫停動態。';
		note.textContent = noteText;

		panel.appendChild(gPipe);
		panel.appendChild(gWave);
		panel.appendChild(readouts);
		panel.appendChild(series);
		panel.appendChild(rel);
		panel.appendChild(note);
		grid.appendChild(panel);
		mount.appendChild(grid);

		/* 三條關係式只渲染一次；之後只改 .is-off 的明暗 */
		ctx.tex(rel);

		/* ------------------------------------------------------------- 讀數 */

		function updateReadouts() {
			var lam = lambda();
			var f = freq();
			var f1 = base();
			var math = st.closed ? 'f_1,\\;3f_1,\\;5f_1' : 'f_1,\\;2f_1,\\;3f_1';
			rLam.main.textContent = lam.toFixed(3) + ' m';
			rF.main.textContent = f.toFixed(1) + ' Hz';
			rF.main.className = 'sd-hot';   /* 這條管子出什麼聲音，就是這一個數 */
			rF1.main.textContent = f1.toFixed(1) + ' Hz';
			rRatio.main.textContent = (lam / st.L).toFixed(2);
			var nums = [];
			for (var k = 1; k <= 3; k++) {
				nums.push((f1 * (st.closed ? 2 * k - 1 : k)).toFixed(1));
			}
			serNum.textContent = nums[0] + ' / ' + nums[1] + ' / ' + nums[2] + ' Hz';
			/* 下標交給 KaTeX 排：f₁ 的 U+2081 在各家單寬字型裡不一定有位形 */
			serSym.textContent = '\\( ' + math + ' \\)';
			ctx.tex(serSym);
			rowOpen.classList.toggle('is-off', st.closed);
			rowClosed.classList.toggle('is-off', !st.closed);
			rowFnum.textContent = '= ' + f.toFixed(1) + ' Hz';
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
			var x0 = w * X0;
			var x1 = w * X1;
			var len = x1 - x0;
			var axisY = h * 0.47;   /* 下方還有端標籤、尺寸線與圖例，軸線略高於中線 */
			var half = Math.max(18, Math.min(60, h * 0.16));
			var top = axisY - half;
			var bot = axisY + half;
			var m = mOf();
			var i;
			var pos;

			/* 軸線：構造線，用虛線；質點沿它振動 */
			oDash.color = C.line;
			oDash.width = 1;
			D.line(g, x0, axisY, x1, axisY, oDash);

			/* 管壁：兩條細線；開口端用虛線封邊（表示「這裡沒有壁」），閉口端畫擋板 */
			oLine.color = C.line;
			oLine.width = 1;
			D.line(g, x0, top, x1, top, oLine);
			D.line(g, x0, bot, x1, bot, oLine);
			D.line(g, x0, top, x0, bot, oDash);
			if (st.closed) {
				oLine.color = C.lineStrong;
				oLine.width = 2.4;
				D.line(g, x1, top, x1, bot, oLine);
			} else {
				D.line(g, x1, top, x1, bot, oDash);
			}

			/* 位移包絡：兩條鏡像曲線 y = ±A·cos(mπx/L)，頂到管壁就是波腹 */
			g.save();
			g.strokeStyle = C.ink;
			g.lineWidth = 1.3;
			g.lineJoin = 'round';
			g.setLineDash([]);
			for (var side = -1; side <= 1; side += 2) {
				g.beginPath();
				for (i = 0; i <= 56; i++) {
					pos = x0 + len * i / 56;
					var env = axisY + side * half * Math.cos(m * Math.PI * (pos - x0) / len);
					if (i === 0) g.moveTo(pos, env);
					else g.lineTo(pos, env);
				}
				g.stroke();
			}
			g.restore();

			/* 質點：位移沿管軸（縱波），相位 cos(ωt) 全體一致 */
			var spacing = len / DOTS;
			var ampX = Math.min(half * 0.34, spacing * 0.42);
			var ct = Math.cos(2 * Math.PI * MOTION_HZ * phaseT);
			oDot.color = C.inkDim;
			/* 由 ampX 內縮取樣：位移最大時質點剛好碰到管口，不會跑到管子外面 */
			for (i = 0; i <= DOTS; i++) {
				pos = x0 + ampX + (len - 2 * ampX) * i / DOTS;
				D.dot(g, pos + ampX * Math.cos(m * Math.PI * (pos - x0) / len) * ct, axisY, 1.8, oDot);
			}

			/* 波節：軸上的小方塊。x/L = (2j+1)/(2m)，由左往右數到牆為止 */
			oNode.color = C.ink;   /* 波節是結論之一；5px 的 inkDim 在 320px 寬會被兩條曲線的交點吃掉 */
			oNode.fill = C.paper0;
			oNode.size = 6;
			oNode.width = 1;
			for (i = 0; i < 24; i++) {
				var fn = (2 * i + 1) / (2 * m);
				if (fn > 1 + 1e-9) break;
				D.handle(g, x0 + len * Math.min(1, fn), axisY, oNode);
			}

			/* 波腹：accent 雙向箭頭（跨滿管徑）＋ A；位置 x/L = j/m */
			for (i = 0; i < 24; i++) {
				var fa = i / m;
				if (fa > 1 + 1e-9) break;
				pos = x0 + len * Math.min(1, fa);
				pos = ctx.clamp(pos, x0 + 2, x1 - 2);
				oArrow.color = C.accent;
				oArrow.width = 1.2;
				oArrow.head = 4;
				D.arrow(g, pos, top, pos, bot, oArrow);
				D.arrow(g, pos, bot, pos, top, oArrow);
				oLabel.size = fs;
				oLabel.align = 'center';
				oLabel.baseline = 'bottom';
				oLabel.mono = true;
				oLabel.bg = C.paper0;
				oLabel.pad = 2;
				oLabel.color = C.accent;
				D.label(g, 'A', pos, top - 4, oLabel);
			}

			/* 端標籤：開端是波腹、閉端是波節 —— 這一行就是整個實驗的結論 */
			oLabel.size = fs;
			oLabel.mono = false;
			oLabel.bg = null;
			oLabel.pad = 0;
			oLabel.color = C.inkDim;
			oLabel.align = 'left';
			oLabel.baseline = 'top';
			D.label(g, '開端（波腹）', x0, bot + 6, oLabel);
			oLabel.align = 'right';
			D.label(g, st.closed ? '閉端（波節）' : '開端（波腹）', x1, bot + 6, oLabel);

			/* 管長尺寸線 */
			var dimY = bot + 26;
			oArrow.color = C.ink;
			oArrow.width = 1;
			oArrow.head = 5;
			var midx = (x0 + x1) / 2;
			D.arrow(g, midx, dimY, x0, dimY, oArrow);
			D.arrow(g, midx, dimY, x1, dimY, oArrow);
			oLabel.align = 'center';
			oLabel.baseline = 'middle';
			oLabel.mono = true;
			oLabel.bg = C.paper0;
			oLabel.pad = 3;
			oLabel.color = C.ink;
			D.label(g, 'L = ' + st.L.toFixed(2) + ' m', midx, dimY, oLabel);

			/* 左下角：說明那些點在動、往哪個方向動 */
			var legY = h - Math.max(12, h * 0.055);
			oArrow.color = C.inkFaint;
			oArrow.width = 1;
			oArrow.head = 3.5;
			D.arrow(g, 10, legY, 20, legY, oArrow);
			D.arrow(g, 20, legY, 10, legY, oArrow);
			oLabel.align = 'left';
			oLabel.baseline = 'middle';
			oLabel.mono = true;
			oLabel.bg = null;
			oLabel.color = C.inkFaint;
			D.label(g, '質點沿管軸振動', 25, legY, oLabel);
		}

		/* ------------------------------------------------------------- 狀態 */

		function sync() {
			updateReadouts();
			draw();
		}

		function applyMode() {
			modeSeg.btns[0].setAttribute('aria-pressed', String(!st.closed));
			modeSeg.btns[1].setAttribute('aria-pressed', String(st.closed));
			modeSeg.btns[0].classList.toggle('is-on', !st.closed);
			modeSeg.btns[1].classList.toggle('is-on', st.closed);
			/* 閉管只出現奇次諧波：按鈕文字寫成第1/3/5，但選項編號仍是 1..3 */
			nSeg.btns[0].textContent = '第1諧波';
			nSeg.btns[1].textContent = st.closed ? '第3諧波' : '第2諧波';
			nSeg.btns[2].textContent = st.closed ? '第5諧波' : '第3諧波';
		}

		function applyN() {
			for (var i = 0; i < nSeg.btns.length; i++) {
				var on = i === st.n - 1;
				nSeg.btns[i].setAttribute('aria-pressed', String(on));
				nSeg.btns[i].classList.toggle('is-on', on);
			}
		}

		function setMode(closed) {
			if (closed === st.closed) return;
			st.closed = closed;
			applyMode();
			sync();
		}

		function setN(n) {
			if (n === st.n) return;
			st.n = n;
			applyN();
			sync();
		}

		fL.input.addEventListener('input', function () {
			st.L = +fL.input.value;
			fL.out.textContent = st.L.toFixed(2);
			sync();
		});
		fV.input.addEventListener('input', function () {
			st.v = +fV.input.value;
			fV.out.textContent = String(st.v);
			sync();
		});

		/* ------------------------------------------------------------- 啟動 */

		applyMode();
		applyN();
		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });
		ctx.onResize(draw);
		sync();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				phaseT += dt;
				/* 數值不讓它長到失去精度；0.9 Hz 的相位每 1000 s 正好整數圈 */
				if (phaseT > 1000) phaseT -= 1000;
				draw();
			});
		}

		return {
			destroy: function () {}
		};
	});
})();
