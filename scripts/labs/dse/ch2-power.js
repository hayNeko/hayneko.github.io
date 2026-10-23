/**
 * ch2-power.js — 功率：升降機與短跑 (DSE 物理 · II.d · 實驗 11)
 *
 * 為什麼兩個模式共用一組控件與一根功率尺: 「同樣的功, 時間越短功率越大」只有在
 * 同一把尺上才看得出來。升降機看的是「輸入 → 輸出, 中間被效率吃掉多少」,
 * 短跑看的是「同一個人對比整台升降機」—— 兩張圖共用同一根長條, 讀者不必換算。
 *
 * 升降機畫的是真的曳引機: 車廂與配重掛在同一條纜索上, 越過頂部的曳引輪。
 * 車廂上升時配重下降, 所以圖上那條斜線不是裝飾, 是配重真的在動。
 *
 * 顏色: 鋼構 / 混凝土 / 跑道人都用實色 (這是畫), UI 走 tokens; 加色的只有
 * 功率長條 —— 功率才是本實驗的主角。
 */
(function () {
	'use strict';

	var G = 9.81;

	/* 畫面上的真實色彩: 淺色井道 + 只在畫布邊緣留一條深墨窄框 */
	var FRAME = '#2f2d29';
	var SHAFT = '#e7e9ea';
	var SHAFT_LINE = '#c9cccd';
	var STAIR_LIGHT = '#8a857b';   /* 樓梯短跑維持原樣, 不受升降機改色影響 */
	var STAIR_DARK = '#6e6a62';
	var STEEL = '#9aa3a8';
	var STEEL_D = '#7f868c';
	var CAB_WALL = '#c8ccd2';
	var CAB_DOOR = '#b4bac0';
	var CAB_LAMP = '#f2e2b8';
	var CABLE = '#6b6557';
	var CW = '#8a9096';
	var PLATE = '#f8f6f1';
	var PLATE_INK = '#2f2d29';
	var SKIN = '#c9a184';
	var KIT = '#2f4a5c';
	var SHOE = '#e8e4d8';

	window.DSELab.define('power', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */
		var mode = 'lift';
		var lift = { m: 500, h: 20, t: 10, eta: 80 };
		var sprint = { m: 70, h: 4, t: 6 };
		var prog = 0;                /* 0..CYCLE 的牆上時間 */
		var ride = 0.62;             /* 0..1 的行程進度 (靜態影格停在中途) */
		var view = null;
		var canvas = null;

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

		function watt(v) {
			if (typeof v !== 'number' || !isFinite(v)) return '—';
			if (v >= 1000) return (v / 1000).toFixed(2) + ' kW';
			if (v >= 100) return v.toFixed(1) + ' W';
			return v.toFixed(1) + ' W';
		}

		function joule(v) {
			if (typeof v !== 'number' || !isFinite(v)) return '—';
			if (Math.abs(v) >= 1000) {
				var k = v / 1000;
				return (Math.abs(k) >= 10 ? k.toFixed(1) : k.toFixed(3)) + ' kJ';
			}
			return v.toFixed(1) + ' J';
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

		var out = { W: 0, P: 0, Pin: NaN, perKg: 0, v: 0, liftP: 0 };

		function compute() {
			if (mode === 'lift') {
				out.W = lift.m * G * lift.h;
				out.P = out.W / lift.t;                 /* t ≥ 2, 不會除零 */
				out.Pin = out.P / (lift.eta / 100);     /* η ≥ 60% */
				out.perKg = out.P / lift.m;
				out.v = lift.h / lift.t;
				out.liftP = out.P;
			} else {
				out.W = sprint.m * G * sprint.h;
				out.P = out.W / sprint.t;               /* t ≥ 2 */
				out.Pin = NaN;
				out.perKg = out.P / sprint.m;
				out.v = sprint.h / sprint.t;
				out.liftP = lift.m * G * lift.h / lift.t;
			}
			return out;
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas');
		wrap.appendChild(canvas);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel');

		var gMode = el('div', 'dl-panel__group');
		gMode.appendChild(el('span', 'dl-panel__label', '模式'));
		var seg = el('div', 'dl-seg');
		var btnLift = el('button', 'dl-btn', '升降機');
		var btnSprint = el('button', 'dl-btn', '樓梯短跑');
		btnLift.type = 'button';
		btnSprint.type = 'button';
		btnLift.setAttribute('aria-pressed', 'true');
		btnSprint.setAttribute('aria-pressed', 'false');
		btnLift.classList.add('is-on');
		seg.appendChild(btnLift);
		seg.appendChild(btnSprint);
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

		var gMag = el('div', 'dl-panel__group');
		gMag.appendChild(el('span', 'dl-panel__label', '量'));
		var fM = field('質量 m');
		var fH = field('高度 h');
		var fT = field('時間 t');
		var fEta = field('效率 η');
		gMag.appendChild(fM.root);
		gMag.appendChild(fH.root);
		gMag.appendChild(fT.root);
		gMag.appendChild(fEta.root);

		/* 功率尺: 兩根等尺度的長條, 一眼看出「輸入 → 輸出」或「選手 vs 升降機」 */
		var gGauge = el('div', 'dl-panel__group');
		gGauge.appendChild(el('span', 'dl-panel__label', '功率'));
		var gauge = el('div', 'pm-gauge');

		function gaugeRow() {
			var row = el('div', 'pm-gauge__row');
			var k = el('span', 'pm-gauge__k', '');
			var track = el('span', 'pm-gauge__bar');
			var fill = el('i', 'pm-gauge__fill', '');
			var v = el('span', 'pm-gauge__v', '—');
			track.appendChild(fill);
			row.appendChild(k);
			row.appendChild(track);
			row.appendChild(v);
			return { root: row, k: k, fill: fill, v: v };
		}

		var grOut = gaugeRow();
		var grIn = gaugeRow();
		gauge.appendChild(grOut.root);
		gauge.appendChild(grIn.root);
		var gaugeFoot = el('p', 'pm-gauge__foot', '');
		gGauge.appendChild(gauge);
		gGauge.appendChild(gaugeFoot);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, v: vv };
		}

		var rds = el('div', 'dl-readouts');
		var rdW = cell('W = mgh');
		var rdP = cell('P_out');
		var rdPin = cell('P_in');
		var rdKg = cell('每公斤');
		rds.appendChild(rdW.root);
		rds.appendChild(rdP.root);
		rds.appendChild(rdPin.root);
		rds.appendChild(rdKg.root);

		var texBox = el('div', 'pm-tex');
		var texA = el('div', 'pm-tex__row', '');
		var texB = el('div', 'pm-tex__row', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gMag);
		panel.appendChild(gGauge);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 控件切換 ---------------- */

		function setRange(f, min, max, step, val, txt) {
			f.inp.min = String(min);
			f.inp.max = String(max);
			f.inp.step = String(step);
			f.inp.value = String(val);
			f.out.textContent = txt;
		}

		function applyMode() {
			if (mode === 'lift') {
				fM.lbl.textContent = '質量 m';
				setRange(fM, 200, 2000, 10, lift.m, lift.m.toFixed(0) + ' kg');
				fH.lbl.textContent = '高度 h';
				setRange(fH, 5, 50, 0.5, lift.h, num(lift.h, 1) + ' m');
				fT.lbl.textContent = '時間 t';
				setRange(fT, 2, 20, 0.5, lift.t, num(lift.t, 1) + ' s');
				fEta.lbl.textContent = '效率 η';
				setRange(fEta, 60, 100, 1, lift.eta, lift.eta.toFixed(0) + ' %');
				fEta.root.style.display = '';
			} else {
				fM.lbl.textContent = '體重 m';
				setRange(fM, 50, 90, 1, sprint.m, sprint.m.toFixed(0) + ' kg');
				fH.lbl.textContent = '樓梯高 h';
				setRange(fH, 3, 8, 0.1, sprint.h, num(sprint.h, 1) + ' m');
				fT.lbl.textContent = '時間 t';
				setRange(fT, 2, 10, 0.1, sprint.t, num(sprint.t, 1) + ' s');
				fEta.root.style.display = 'none';
			}
			fM.inp.setAttribute('aria-label', mode === 'lift' ? '升降機質量（公斤）' : '體重（公斤）');
			fH.inp.setAttribute('aria-label', mode === 'lift' ? '提升高度（米）' : '樓梯高度（米）');
			fT.inp.setAttribute('aria-label', mode === 'lift' ? '時間（秒）' : '跑上樓梯的時間（秒）');
		}

		/* ---------------- 讀數 ---------------- */

		var lastA = '';
		var lastB = '';
		var NOTE_LIFT = '纜索張力 T = mg（等速），所以 P = T·v = mgh/t；效率 η 把馬達的輸入功率放大到 P/η。';
		var NOTE_SPRINT = '短跑選手只計輸出功率；人體代謝的輸入功率不在 DSE 範圍，所以 P_in 顯示「—」。切回升降機可看同一根功率尺上的對照。';
		var REDUCED = ' 已依系統設定暫停動態。';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var o = compute();

			if (mode === 'lift') {
				grOut.k.textContent = '輸出';
				grIn.k.textContent = '輸入';
				grOut.fill.style.width = lift.eta.toFixed(1) + '%';
				grIn.fill.style.width = '100%';
				grIn.fill.classList.add('pm-gauge__fill--loss');
				grOut.v.textContent = watt(o.P);
				grIn.v.textContent = watt(o.Pin);
				gaugeFoot.textContent = 'η = ' + lift.eta.toFixed(0) + '% · 損耗 ' + watt(o.Pin - o.P);
			} else {
				grOut.k.textContent = '選手';
				grIn.k.textContent = '升降機';
				grOut.fill.style.width = ctx.clamp(o.P / Math.max(o.liftP, 1e-6) * 100, 1.5, 100).toFixed(1) + '%';
				grIn.fill.style.width = '100%';
				grIn.fill.classList.add('pm-gauge__fill--loss');
				grOut.v.textContent = watt(o.P);
				grIn.v.textContent = watt(o.liftP);
				gaugeFoot.textContent = '選手 = 升降機的 ' + num(o.P / Math.max(o.liftP, 1e-6) * 100, 1) + '%';
			}

			rdW.v.textContent = joule(o.W);
			rdP.v.textContent = watt(o.P);
			if (isFinite(o.Pin)) {
				rdPin.v.textContent = watt(o.Pin);
				rdPin.v.classList.remove('pm-mute');
			} else {
				rdPin.v.textContent = '—';
				rdPin.v.classList.add('pm-mute');
			}
			rdKg.v.textContent = num(o.perKg, 2) + ' W/kg';

			lastA = setTeX(texA, '\\( P = \\dfrac{W}{t} = Fv \\)', lastA);
			if (mode === 'lift') {
				lastB = setTeX(texB,
					'\\( P = \\dfrac{' + joule(o.W) + '}{' + num(lift.t, 1) + '\\ \\mathrm{s}} = ' +
					watt(o.P) + '\\)', lastB);
			} else {
				lastB = setTeX(texB,
					'\\( P = \\dfrac{' + joule(o.W) + '}{' + num(sprint.t, 1) + '\\ \\mathrm{s}} = ' +
					watt(o.P) + '\\)', lastB);
			}
			note.textContent = (mode === 'lift' ? NOTE_LIFT : NOTE_SPRINT) + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖: 升降機 ---------------- */

		function drawLift(g, W, H) {
			var frame = ctx.clamp(Math.min(W, H) * 0.026, 4, 9);
			var rulerX = frame + 8;
			var yTop = frame + 12;
			var yBot = H - frame - 10;
			var shaftL = frame + ctx.clamp(W * 0.13, 30, 84);
			var shaftR = W - frame - ctx.clamp(W * 0.06, 12, 40);
			var shaftW = shaftR - shaftL;
			if (shaftW < 80 || yBot - yTop < 60) return;

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			/* 深墨只留一條貼著畫布邊緣的窄框 */
			g.fillStyle = FRAME;
			g.fillRect(0, 0, W, frame);
			g.fillRect(0, H - frame, W, frame);
			g.fillRect(0, 0, frame, H);
			g.fillRect(W - frame, 0, frame, H);

			/* 井道: 淺色內壁, 樓層線與導軌掛在兩側墨框上 */
			g.fillStyle = SHAFT;
			g.fillRect(shaftL, yTop, shaftW, yBot - yTop);
			var floors = Math.max(2, Math.round((yBot - yTop) / ctx.clamp(H * 0.17, 28, 70)));
			g.fillStyle = SHAFT_LINE;
			for (var f = 1; f < floors; f++) {
				g.fillRect(shaftL, Math.round(yTop + (yBot - yTop) * f / floors), shaftW, 1);
			}
			g.fillStyle = STEEL_D;
			g.fillRect(shaftL + 5, yTop, 2, yBot - yTop);
			g.fillRect(shaftR - 7, yTop, 2, yBot - yTop);
			g.fillStyle = FRAME;
			g.fillRect(shaftL - 3, yTop - 3, shaftW + 6, 3);
			g.fillRect(shaftL - 3, yBot, shaftW + 6, 3);
			g.fillRect(shaftL - 1, yTop, 1, yBot - yTop);
			g.fillRect(shaftR, yTop, 1, yBot - yTop);

			/* 曳引輪掛在配重側的機房裡 */
			var sheaveR = ctx.clamp(shaftW * 0.05, 4, 8);
			var sheaveY = yTop + 2 + sheaveR;
			var cabW = ctx.clamp(shaftW * 0.5, 46, 118);
			var cabH = ctx.clamp(Math.min(cabW * 0.74, H * 0.26), 22, 86);
			var cabX = shaftL + shaftW * 0.32;
			var cabCx = cabX + cabW / 2;
			var yA = yBot - 8 - cabH;
			var yB = yTop + ctx.clamp(H * 0.12, 46, 84);
			var travel = Math.max(10, yA - yB);
			var p = ride;
			var cabTop = yA - p * travel;
			var cwX = shaftR - ctx.clamp(shaftW * 0.05, 7, 14);
			var cwH = Math.max(12, cabH * 0.62);
			var cwTop = yB + p * (yA + cabH - cwH - yB);

			/* 配重: 車廂上升時下降 */
			g.fillStyle = CW;
			g.fillRect(cwX - 4, cwTop, 8, cwH);
			g.strokeStyle = FRAME;
			g.lineWidth = 1;
			g.strokeRect(cwX - 4.5, cwTop + 0.5, 8, cwH);
			g.fillStyle = 'rgba(47,45,41,0.18)';
			g.fillRect(cwX - 4, cwTop, 8, 2);

			/* 纜索: 車廂頂 → 曳引輪 → 配重頂 */
			g.strokeStyle = CABLE;
			g.lineWidth = 1.4;
			g.beginPath();
			g.moveTo(cabCx, cabTop);
			g.lineTo(cabCx, sheaveY);
			g.lineTo(cwX, sheaveY);
			g.lineTo(cwX, cwTop);
			g.stroke();
			g.beginPath();
			g.arc(cwX, sheaveY, sheaveR, 0, Math.PI * 2);
			g.fillStyle = CW;
			g.fill();
			g.strokeStyle = FRAME;
			g.lineWidth = 1;
			g.stroke();
			D.dot(g, cwX, sheaveY, 1.2, { color: FRAME, fill: FRAME, stroke: false });

			/* 車廂: 淺色牆板 + 兩扇門 (中縫) + 暖色燈條 */
			g.fillStyle = CAB_WALL;
			g.fillRect(cabX, cabTop, cabW, cabH);
			g.fillStyle = CAB_DOOR;
			g.fillRect(cabX + 3, cabTop + 6, cabW - 6, cabH - 9);
			g.fillStyle = CAB_LAMP;
			g.fillRect(cabX + 3, cabTop + 2, cabW - 6, 3);
			g.fillStyle = FRAME;
			g.fillRect(cabX + cabW * 0.47, cabTop + 6, 1.5, cabH - 9);
			g.strokeStyle = FRAME;
			g.lineWidth = 1;
			g.strokeRect(cabX + 0.5, cabTop + 0.5, cabW - 1, cabH - 1);

			/* 張力 T 向上、mg 向下: 長度 ∝ m, 標籤一律紙色墊底 */
			var fMag = ctx.clamp((lift.m - 200) / 1800, 0, 1);
			var tLen = Math.max(8, Math.min(cabTop - yTop - 6, 9 + fMag * 15));
			arw(g, cabX + 6, cabTop - 2, cabX + 6, cabTop - 2 - tLen, FRAME, 1.5, 5, null);
			lbl(g, 'T', cabX + 13, cabTop - 4 - tLen * 0.55, PLATE_INK, 10, 'left', true, PLATE);

			var mLen = Math.max(8, Math.min(yBot - (cabTop + cabH) - 6, 9 + fMag * 15));
			arw(g, cabX + 6, cabTop + cabH + 2, cabX + 6, cabTop + cabH + 2 + mLen, FRAME, 1.5, 5, null);
			lbl(g, 'mg', cabX + 13, cabTop + cabH + 3 + mLen * 0.55, PLATE_INK, 10, 'left', true, PLATE);

			/* 速度: 車廂左邊的短箭頭 + 數值 */
			var vy = cabTop + cabH * 0.5;
			arw(g, cabX - 10, vy + 7, cabX - 10, vy - 7, PLATE_INK, 1.2, 4, null);
			lbl(g, num(out.v, 2) + ' m/s', cabX - 15, vy, PLATE_INK, 10, 'right', true, PLATE);

			/* 機房功率錶: 紙色標籤 + 淺軌道, 只有「輸出」那一段用強調色 */
			var mw = ctx.clamp(shaftW * 0.42, 56, 140);
			lbl(g, 'P_in ' + watt(out.Pin), shaftL + 12, yTop + 24, PLATE_INK, 10, 'left', true, PLATE);
			var barY = yTop + 37;
			g.fillStyle = 'rgba(47,45,41,0.14)';
			g.fillRect(shaftL + 12, barY, mw, 4);
			g.fillStyle = C.accent;
			g.fillRect(shaftL + 12, barY, mw * (lift.eta / 100), 4);
			if (shaftW > 190) {
				lbl(g, 'η ' + lift.eta.toFixed(0) + '%', shaftL + 12 + mw + 6, barY + 2, PLATE_INK, 10, 'left', true);
			}

			/* 高度尺: 兩端刻度; 數值在面板的欄位裡, 這裡只留 h */
			var ry0 = yB;
			var ry1 = yA;
			ln(g, rulerX, ry0, rulerX, ry1, C.lineStrong, 1, null);
			ln(g, rulerX - 4, ry0, rulerX + 4, ry0, C.lineStrong, 1, null);
			ln(g, rulerX - 4, ry1, rulerX + 4, ry1, C.lineStrong, 1, null);
			lbl(g, 'h', rulerX + 7, (ry0 + ry1) / 2, C.inkFaint, 10, 'left', false);
		}

		/* ---------------- 繪圖: 樓梯短跑 ---------------- */

		function drawRunner(g, x, y, h, ph) {
			var headR = Math.max(1.8, h * 0.085);
			var hipY = y - h * 0.46;
			var shoY = y - h * 0.76;
			var sw = Math.sin(ph) * h * 0.17;
			g.save();
			/* 腿 */
			g.strokeStyle = KIT;
			g.lineWidth = Math.max(1.6, h * 0.09);
			g.lineCap = 'round';
			g.beginPath();
			g.moveTo(x, hipY);
			g.lineTo(x + sw, hipY + (y - hipY) * 0.5);
			g.lineTo(x + sw * 1.5, y);
			g.moveTo(x, hipY);
			g.lineTo(x - sw, hipY + (y - hipY) * 0.55);
			g.lineTo(x - sw * 1.4, y);
			g.stroke();
			/* 軀幹 */
			g.beginPath();
			g.moveTo(x, hipY);
			g.lineTo(x + sw * 0.22, shoY);
			g.stroke();
			/* 手臂 */
			g.beginPath();
			g.moveTo(x + sw * 0.22, shoY + h * 0.02);
			g.lineTo(x - sw * 1.1, shoY + h * 0.16);
			g.moveTo(x + sw * 0.22, shoY + h * 0.02);
			g.lineTo(x + sw * 1.2, shoY + h * 0.14);
			g.stroke();
			/* 頭 */
			g.fillStyle = SKIN;
			g.beginPath();
			g.arc(x + sw * 0.26, shoY - headR * 0.9, headR, 0, Math.PI * 2);
			g.fill();
			/* 鞋 */
			g.fillStyle = SHOE;
			g.fillRect(x + sw * 1.5 - 2, y - 1.4, 4, 2.2);
			g.fillRect(x - sw * 1.4 - 2, y - 1.4, 4, 2.2);
			g.restore();
		}

		function drawSprint(g, W, H) {
			var pad = ctx.clamp(W * 0.028, 8, 20);
			var x0 = pad + ctx.clamp(W * 0.14, 30, 76);
			var x1 = W - pad - 6;
			var yBot = H - pad - 6;
			var yTop = pad + 16;
			/* 一級 18 cm、人高 1.70 m: 樓梯與人共用同一個尺度 (人 = 9.44 級)，
			   所以頂端一定要留 9.44 級的淨空, 跑到最後一級時頭才不會被切掉 */
			var n = ctx.clamp(Math.round(sprint.h / 0.18), 12, 30);
			var rise = Math.max(2.2, (yBot - yTop) / (n + 9.44));
			var flight = rise * n;
			yTop = yBot - flight;
			var run = (x1 - x0) / n;
			var p = ride;
			var k = ctx.clamp(Math.round(p * (n - 1)), 0, n - 1);

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			/* 樓梯: 立面深、踏面淺, 才不會變成一塊塊方格 */
			var i;
			for (i = 0; i < n; i++) {
				var sx = x0 + i * run;
				var sy = yBot - (i + 1) * rise;
				g.fillStyle = STAIR_DARK;
				g.fillRect(sx, sy, run + 0.5, rise + 0.5);
				g.fillStyle = STAIR_LIGHT;
				g.fillRect(sx, sy, run + 0.5, Math.max(1.4, rise * 0.26));
			}
			/* 地面 */
			g.fillStyle = STAIR_DARK;
			g.fillRect(x0, yBot, x1 - x0 + 2, 2);

			/* 高度尺 */
			var rulerX = pad + 4;
			ln(g, rulerX, yBot, rulerX, yTop, C.lineStrong, 1, null);
			ln(g, rulerX - 3, yBot, rulerX + 4, yBot, C.lineStrong, 1, null);
			ln(g, rulerX - 3, yTop, rulerX + 4, yTop, C.lineStrong, 1, null);
			lbl(g, 'h', rulerX + 6, (yTop + yBot) / 2 - 7, C.inkFaint, 10, 'left', false);
			lbl(g, num(sprint.h, 1) + ' m', rulerX + 6, (yTop + yBot) / 2 + 6, C.inkFaint, 10, 'left', true);

			/* 選手: 站在第 k 級踏面, 不會浮在梯級之間 */
			var px = x0 + run * (k + 0.5);
			var py = yBot - (k + 1) * rise;
			var ph = rise * 9.44;
			drawRunner(g, px, py, ph, p * Math.PI * 6);
			lbl(g, num(sprint.m, 0) + ' kg', px, Math.max(pad + 5, py - ph - 7), C.ink, 10, 'center', true, C.paper0);
		}

		/* ---------------- 主繪圖 ---------------- */

		function draw(g, W, H) {
			if (!g || W < 60 || H < 60) return;
			compute();
			if (mode === 'lift') drawLift(g, W, H);
			else drawSprint(g, W, H);
		}

		/* ---------------- 互動 ---------------- */

		function rerun() {
			syncUI();
			draw(view.ctx2d, view.w, view.h);
		}

		btnLift.addEventListener('click', function () {
			if (mode === 'lift') return;
			mode = 'lift';
			btnLift.classList.add('is-on');
			btnSprint.classList.remove('is-on');
			btnLift.setAttribute('aria-pressed', 'true');
			btnSprint.setAttribute('aria-pressed', 'false');
			applyMode();
			rerun();
		});

		btnSprint.addEventListener('click', function () {
			if (mode === 'sprint') return;
			mode = 'sprint';
			btnSprint.classList.add('is-on');
			btnLift.classList.remove('is-on');
			btnSprint.setAttribute('aria-pressed', 'true');
			btnLift.setAttribute('aria-pressed', 'false');
			applyMode();
			rerun();
		});

		fM.inp.addEventListener('input', function () {
			var v = parseFloat(fM.inp.value);
			if (!isFinite(v)) return;
			if (mode === 'lift') lift.m = ctx.clamp(v, 200, 2000);
			else sprint.m = ctx.clamp(v, 50, 90);
			fM.out.textContent = v.toFixed(0) + ' kg';
			rerun();
		});

		fH.inp.addEventListener('input', function () {
			var v = parseFloat(fH.inp.value);
			if (!isFinite(v)) return;
			if (mode === 'lift') {
				lift.h = ctx.clamp(v, 5, 50);
				fH.out.textContent = num(lift.h, 1) + ' m';
			} else {
				sprint.h = ctx.clamp(v, 3, 8);
				fH.out.textContent = num(sprint.h, 1) + ' m';
			}
			rerun();
		});

		fT.inp.addEventListener('input', function () {
			var v = parseFloat(fT.inp.value);
			if (!isFinite(v)) return;
			if (mode === 'lift') {
				lift.t = ctx.clamp(v, 2, 20);
				fT.out.textContent = num(lift.t, 1) + ' s';
			} else {
				sprint.t = ctx.clamp(v, 2, 10);
				fT.out.textContent = num(sprint.t, 1) + ' s';
			}
			rerun();
		});

		fEta.inp.addEventListener('input', function () {
			var v = parseFloat(fEta.inp.value);
			if (!isFinite(v)) return;
			lift.eta = ctx.clamp(v, 60, 100);
			fEta.out.textContent = lift.eta.toFixed(0) + ' %';
			rerun();
		});

		ctx.onResize(function () {
			draw(view.ctx2d, view.w, view.h);
		});

		applyMode();
		syncUI();
		draw(view.ctx2d, view.w, view.h);

		if (!ctx.reduced) {
			var CYCLE = 3.3;
			var TRIP = 2.5;
			ctx.raf(function (dt) {
				prog = (prog + dt) % CYCLE;
				ride = ctx.clamp(prog / TRIP, 0, 1);
				draw(view.ctx2d, view.w, view.h);
			});
		}

		return { destroy: function () {} };
	});
})();
