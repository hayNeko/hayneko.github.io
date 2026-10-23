/**
 * ch2-elevator-scale.js — 電梯裡的視重 (DSE 物理 · II.b · 實驗 04)
 *
 * 為什麼要畫一整個電梯井: 「磅秤讀的是正向力, 不是重量」只有在電梯真的在動的時候
 * 才看得出來。所以艙體緩慢上下滑, 旁邊一支速度箭頭, 艙內的人身上直接畫隔離體圖
 * (N 向上、W 向下、合力 N − W), 三支箭頭共用同一個 N/px 比例 —— 誰長誰短就是
 * 超重與失重的全部內容。
 *
 * 數值一律 g = 9.81 m s⁻², 向上為正: N = m(g + a)。a < 0 只是「加速度向下」,
 * 人仍然站在磅秤上, 所以 N 不會是負的(下限夾在 0)。
 */
(function () {
	'use strict';

	var G = 9.81;
	var A_MIN = -8;
	var A_MAX = 8;
	var M_MIN = 40;
	var M_MAX = 100;
	var GAUGE_MAX = 1800;      /* 磅秤指針的滿刻度: m(g+a) 的最大值 1781 N */

	window.DSELab.define('elevator-scale', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* 畫布裡是實景(這一章允許真實材質色); UI 一律走 tokens。
		   這一格刻意「淺底」: 深色只留在畫布的四周邊緣當井壁框 —— 整片近黑會讓
		   這張卡在紙頁上破一個洞, 變成整頁最重的一塊。 */
		var K = {
			shaft: '#e7e9ea',         /* 井內(淺) */
			shaftEdge: '#2f2d29',     /* 井壁: 只落在畫布邊緣 */
			rail: '#7a756b',
			cable: '#3f3b35',
			steel: '#c8ccd2',         /* 艙壁 */
			steelLit: '#d5d9de',      /* 內壁 */
			steelDark: '#a8aeb4',     /* 角柱 */
			roof: '#8a9096',
			ceiling: '#f2e2b8',       /* 天花板燈帶 */
			floor: '#9aa0a6',
			railBar: '#b3ad9c',
			skin: '#dcae8b',
			hair: '#3a2f27',
			shirt: '#41636b',
			trouser: '#39404a',
			shoe: '#241f1b',
			scaleBody: '#e4e2db',
			scaleDark: '#b9b6ac',
			plate: '#e9e6df',         /* 讀數板: 跟紙頁同一個調子 */
			plateEdge: '#b7b3a8',
			plateInk: '#2a251d',
			plateDim: '#6b6557'
		};

		/* ---------------- 狀態 ---------------- */
		var aMs2 = 0;
		var massKg = 60;
		var phase = 0;
		var view = null;

		/* ---------------- 小工具 ---------------- */
		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		function cl(v, a, b) { return v < a ? a : v > b ? b : v; }

		/* 共用選項物件: 每幀重建物件會在拖滑桿時留下垃圾 */
		var oLine = { color: '', width: 1, dash: null };
		var oArrow = { color: '', width: 1.4, head: 7, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };

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

		/* ---------------- 物理 ---------------- */
		var st = { W: 0, N: 0, pct: 0, sign: 0, state: '' };

		function compute() {
			var W = massKg * G;
			var raw = massKg * (G + aMs2);
			st.W = W;
			st.N = raw > 0 ? raw : 0;        /* 接觸力不會是負的 */
			st.pct = W > 0 ? (st.N / W) * 100 : NaN;
			st.sign = st.N - st.W;
			if (Math.abs(st.N - st.W) < 0.05) st.state = '正常';
			else if (st.N < 1) st.state = '完全失重';
			else if (st.N > st.W) st.state = '超重';
			else st.state = '失重';
			return st;
		}

		/* ---------------- DOM ---------------- */
		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		var canvas = el('canvas', 'dl-canvas');
		wrap.appendChild(canvas);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel');

		var gA = el('div', 'dl-panel__group');
		gA.appendChild(el('span', 'dl-panel__label', '加速度'));

		var seg = el('div', 'dl-seg');
		var PRESETS = [
			{ t: '等速', a: 0 },
			{ t: '加速上升', a: 2 },
			{ t: '加速下降', a: -2 },
			{ t: '自由落體', a: -G }
		];
		var btns = [];
		var i;
		for (i = 0; i < PRESETS.length; i++) {
			(function (p) {
				var b = el('button', 'dl-btn', p.t);
				b.type = 'button';
				b.setAttribute('aria-pressed', 'false');
				b.addEventListener('click', function () { setA(p.a); });
				seg.appendChild(b);
				btns.push({ node: b, a: p.a });
			})(PRESETS[i]);
		}
		gA.appendChild(seg);

		var fA = el('div', 'dl-field');
		fA.appendChild(el('span', 'dl-field__label', '加速度 a'));
		var inA = el('input', 'dl-range');
		inA.type = 'range';
		inA.min = String(A_MIN);
		inA.max = String(A_MAX);
		inA.step = '0.1';
		inA.value = '0';
		inA.setAttribute('aria-label', '電梯加速度（米每秒平方），向上為正');
		var outA = el('output', 'dl-field__val', '0.0 m/s²');
		fA.appendChild(inA);
		fA.appendChild(outA);
		gA.appendChild(fA);

		var gM = el('div', 'dl-panel__group');
		gM.appendChild(el('span', 'dl-panel__label', '質量'));
		var fM = el('div', 'dl-field');
		fM.appendChild(el('span', 'dl-field__label', '質量 m'));
		var inM = el('input', 'dl-range');
		inM.type = 'range';
		inM.min = String(M_MIN);
		inM.max = String(M_MAX);
		inM.step = '1';
		inM.value = '60';
		inM.setAttribute('aria-label', '人的質量（公斤）');
		var outM = el('output', 'dl-field__val', '60 kg');
		fM.appendChild(inM);
		fM.appendChild(outM);
		gM.appendChild(fM);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}
		var rds = el('div', 'dl-readouts');
		var rdW = cell('W');
		var rdN = cell('N');
		var rdP = cell('N/W');
		var rdS = cell('狀態');
		rdN.v.classList.add('fc-accent');
		rds.appendChild(rdW.root);
		rds.appendChild(rdN.root);
		rds.appendChild(rdP.root);
		rds.appendChild(rdS.root);

		var texBox = el('div', 'fc-tex');
		var texA = el('span', 'fc-tex__row', '');
		var texB = el('span', 'fc-tex__sub', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gA);
		panel.appendChild(gM);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 ---------------- */
		var NOTE = '磅秤量到的是正向力 N，不是重量 W。電梯向上加速時 N = m(g+a) 變大，人覺得「變重」；' +
			'a = −g 時 N = 0，人與磅秤之間沒有壓力。井壁的上下滑動只是示意的動態。';
		var REDUCED = ' 已依系統設定暫停動態。';
		var lastA = '';
		var lastB = '';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var s = compute();

			outA.textContent = (aMs2 > 0 ? '+' : '') + ctx.fmt(aMs2, 1) + ' m/s²';
			outM.textContent = ctx.fmt(massKg, 0) + ' kg';

			rdW.v.textContent = ctx.fmt(s.W, 1) + ' N';
			rdN.v.textContent = ctx.fmt(s.N, 1) + ' N';
			rdP.v.textContent = ctx.fmt(s.pct, 1) + ' %';
			rdS.v.textContent = s.state;
			rdS.v.classList.toggle('fc-accent', s.state === '超重' || s.state === '完全失重');

			for (var k = 0; k < btns.length; k++) {
				var on = Math.abs(btns[k].a - aMs2) < 0.005;
				btns[k].node.classList.toggle('is-on', on);
				btns[k].node.setAttribute('aria-pressed', on ? 'true' : 'false');
			}

			lastA = setTeX(texA, '\\( N = m(g+a) \\)', lastA);
			lastB = setTeX(texB,
				'\\( N = ' + ctx.fmt(massKg, 0) + '\\,(9.81 ' + (aMs2 < 0 ? '-' : '+') + ' ' +
				ctx.fmt(Math.abs(aMs2), 1) + ') = ' + ctx.fmt(s.N, 1) + '\\ \\mathrm{N} \\)', lastB);

			note.textContent = NOTE + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖 ---------------- */

		function drawScaleBox(g, x, y, w, h) {
			g.fillStyle = K.scaleBody;
			g.fillRect(x, y, w, h);
			g.fillStyle = K.scaleDark;
			g.fillRect(x, y, w, Math.max(1, h * 0.28));
			g.strokeStyle = 'rgba(20,17,13,0.32)';
			g.lineWidth = 1;
			g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
			/* 面板上的小顯示窗: 大字的那一片在畫布下方 */
			var lw = w * 0.42;
			var lh = Math.max(2, h * 0.32);
			var ly = y + Math.max(1.5, h * 0.44);
			g.fillStyle = K.plate;
			g.fillRect(x + w * 0.5 - lw * 0.5, ly, lw, lh);
			g.strokeStyle = K.plateEdge;
			g.strokeRect(Math.round(x + w * 0.5 - lw * 0.5) + 0.5, Math.round(ly) + 0.5,
				Math.round(lw) - 1, Math.round(lh) - 1);
		}

		function drawPerson(g, px, feetY, ph, bodyHalf) {
			var hipY = feetY - ph * 0.44;
			var shoulderY = feetY - ph * 0.79;
			var headR = ph * 0.085;
			var headY = feetY - ph + headR;
			var tw = bodyHalf * 1.55;

			/* 腿 */
			g.fillStyle = K.trouser;
			g.fillRect(px - ph * 0.075, hipY, ph * 0.055, feetY - hipY);
			g.fillRect(px + ph * 0.020, hipY, ph * 0.055, feetY - hipY);
			/* 鞋 */
			g.fillStyle = K.shoe;
			g.fillRect(px - ph * 0.085, feetY - ph * 0.028, ph * 0.085, ph * 0.030);
			g.fillRect(px + ph * 0.012, feetY - ph * 0.028, ph * 0.085, ph * 0.030);
			/* 軀幹 */
			g.fillStyle = K.shirt;
			g.fillRect(px - tw * 0.5, shoulderY, tw, hipY - shoulderY + ph * 0.02);
			/* 手臂 */
			g.fillStyle = K.shirt;
			g.fillRect(px - tw * 0.5 - ph * 0.045, shoulderY + ph * 0.02, ph * 0.045, ph * 0.30);
			g.fillRect(px + tw * 0.5, shoulderY + ph * 0.02, ph * 0.045, ph * 0.30);
			g.fillStyle = K.skin;
			g.fillRect(px - tw * 0.5 - ph * 0.045, shoulderY + ph * 0.32, ph * 0.045, ph * 0.055);
			g.fillRect(px + tw * 0.5, shoulderY + ph * 0.32, ph * 0.045, ph * 0.055);
			/* 頸 + 頭 */
			g.fillStyle = K.skin;
			g.fillRect(px - headR * 0.34, headY + headR * 0.7, headR * 0.7, ph * 0.05);
			g.beginPath();
			g.arc(px, headY, headR, 0, Math.PI * 2);
			g.fill();
			/* 頭髮: 上半圓, 讓頭不是一顆球 */
			g.fillStyle = K.hair;
			g.beginPath();
			g.arc(px, headY - headR * 0.12, headR * 0.96, Math.PI * 0.98, Math.PI * 2.02);
			g.fill();
		}

		function drawGauge(g, cx, cy, r, val) {
			/* 上開的 140° 錶面: 200° → 340°(canvas 角度, y 向下) */
			var a0 = Math.PI * (200 / 180);
			var a1 = Math.PI * (340 / 180);
			D.arc(g, cx, cy, r, a0, a1, { color: K.plateDim, width: 1.2 });
			var k;
			for (k = 0; k <= 4; k++) {
				var ang = a0 + (a1 - a0) * (k / 4);
				var r0 = r - (k === 0 || k === 4 ? 5 : 3.5);
				ln(g, cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0,
					cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, K.plateDim, 1);
			}
			var t = cl(val / GAUGE_MAX, 0, 1);
			var na = a0 + (a1 - a0) * t;
			arw(g, cx, cy, cx + Math.cos(na) * (r - 2), cy + Math.sin(na) * (r - 2), C.accent, 1.6, 5, null);
			D.dot(g, cx, cy, 1.8, { color: K.plateInk, fill: K.plateInk, stroke: false });
		}

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 60 || H < 44) return;

			var s = compute();
			var m = cl(Math.min(W, H) * 0.032, 7, 18);

			var cabH = H * 0.52;
			var cabW = Math.min(W * 0.62, cabH * 1.5);
			var cabX = (W - cabW) * 0.5;
			var cabR = cabX + cabW;
			var bob = ctx.reduced ? 0 : Math.sin(phase) * H * 0.014;
			var cabTop = H * 0.13 + bob;
			var cabBot = cabTop + cabH;
			var stripTop = H * 0.70;

			/* 井: 淺色井內; 深色只留在畫布四周當框 */
			var edgeW = Math.max(5, W * 0.038);
			var edgeT = Math.max(7, H * 0.075);
			g.fillStyle = K.shaft;
			g.fillRect(0, 0, W, H);
			g.fillStyle = K.shaftEdge;
			g.fillRect(0, 0, edgeW, H);
			g.fillRect(W - edgeW, 0, edgeW, H);
			g.fillRect(edgeW, 0, W - edgeW * 2, edgeT);

			/* 樓層接縫: 幾條淡線說明這是一口井, 不是一張紙 */
			var seam = Math.max(13, H * 0.085);
			g.strokeStyle = 'rgba(20,17,13,0.055)';
			g.lineWidth = 1;
			g.beginPath();
			for (var sy = edgeT + seam; sy < stripTop; sy += seam) {
				g.moveTo(edgeW, Math.round(sy) + 0.5);
				g.lineTo(W - edgeW, Math.round(sy) + 0.5);
			}
			g.stroke();

			/* 導軌 */
			ln(g, cabX - 8, edgeT, cabX - 8, stripTop, K.rail, 1.5);
			ln(g, cabR + 8, edgeT, cabR + 8, stripTop, K.rail, 1.5);

			/* 兩條鋼纜 + 纜夾 */
			var roofH = Math.max(4, cabH * 0.05);
			var clampH = Math.max(2, roofH * 0.9);
			var xc1 = cabX + cabW * 0.30;
			var xc2 = cabX + cabW * 0.70;
			ln(g, xc1, edgeT, xc1, cabTop, K.cable, 2);
			ln(g, xc2, edgeT, xc2, cabTop, K.cable, 2);
			g.fillStyle = K.cable;
			g.fillRect(xc1 - 3, cabTop - clampH, 6, clampH);
			g.fillRect(xc2 - 3, cabTop - clampH, 6, clampH);

			/* 艙 */
			g.fillStyle = K.roof;
			g.fillRect(cabX - 4, cabTop, cabW + 8, roofH);
			var wallTop = cabTop + roofH;
			g.fillStyle = K.steel;
			g.fillRect(cabX, wallTop, cabW, cabBot - wallTop);
			var pad = Math.max(3, cabW * 0.035);
			var inX = cabX + pad;
			var inY = wallTop + pad;
			var inW = Math.max(4, cabW - pad * 2);
			var inH = Math.max(4, cabBot - wallTop - pad * 1.5);

			g.fillStyle = K.steelLit;
			g.fillRect(inX, inY, inW, inH);

			/* 壁板的直縫 */
			g.strokeStyle = 'rgba(20,17,13,0.07)';
			g.lineWidth = 1;
			g.beginPath();
			for (var pi = 1; pi < 5; pi++) {
				var pxl = Math.round(inX + inW * (pi / 5)) + 0.5;
				g.moveTo(pxl, inY);
				g.lineTo(pxl, inY + inH);
			}
			g.stroke();

			/* 角柱 */
			g.fillStyle = K.steelDark;
			g.fillRect(cabX, wallTop, pad, cabBot - wallTop);
			g.fillRect(cabR - pad, wallTop, pad, cabBot - wallTop);

			/* 天花板燈帶: 一整條暖色橫過艙頂 */
			var ceilH = Math.max(3, cabH * 0.035);
			g.fillStyle = K.ceiling;
			g.fillRect(inX, inY, inW, ceilH);

			/* 側扶手: 只放在兩側, 不橫過人 */
			var railY = wallTop + (cabBot - wallTop) * 0.45;
			var railT = Math.max(2, cabH * 0.024);
			g.fillStyle = K.railBar;
			g.fillRect(cabX + pad + 1, railY, cabW * 0.22, railT);
			g.fillRect(cabR - pad - 1 - cabW * 0.22, railY, cabW * 0.22, railT);
			g.fillStyle = K.rail;
			g.fillRect(cabX + pad + 1, railY + railT, cabW * 0.22, 1);
			g.fillRect(cabR - pad - 1 - cabW * 0.22, railY + railT, cabW * 0.22, 1);

			/* 地板 */
			var floorH = Math.max(4, cabH * 0.055);
			g.fillStyle = K.floor;
			g.fillRect(cabX, cabBot - floorH, cabW, floorH);
			g.fillStyle = K.roof;
			g.fillRect(cabX, cabBot - floorH, cabW, 1);

			/* 磅秤 + 人 */
			var floorTop = cabBot - floorH;
			var scH = cl(cabH * 0.075, 5, 15);
			var scW = Math.max(24, cabW * 0.28);
			var px = cabX + cabW * 0.46;
			var scTop = floorTop - scH;
			var ph = cabH * 0.60;
			var bodyHalf = ph * 0.13;

			drawScaleBox(g, px - scW * 0.5, scTop, scW, scH);
			drawPerson(g, px, scTop, ph, bodyHalf);

			/* 人的力圖: N 向上、W 向下、合力 F_net = N − W */
			var cmY = scTop - ph * 0.55;
			var gapX = Math.max(7, ph * 0.16);
			var xW = px - bodyHalf - gapX;
			var xN = px + bodyHalf + gapX;
			var xF = cabR - Math.max(26, cabW * 0.10);
			var pxPerN = (ph * 0.52) / 700;
			var capLen = ph * 0.86;
			var wLen = cl(s.W * pxPerN, 8, capLen);
			var nLen = cl(s.N * pxPerN, s.N < 1 ? 0 : 8, capLen);
			var dNet = s.N - s.W;
			var fLen = Math.abs(dNet) * pxPerN;
			if (Math.abs(dNet) > 0.5) fLen = cl(fLen, 10, capLen); else fLen = 0;
			var roomy = W >= 420;

			ln(g, xN, scTop, xN, scTop - 2, C.accent, 1.2);      /* 接觸點 */

			arw(g, xN, scTop, xN, scTop - nLen, C.accent, 1.8, 7, null);
			lbl(g, roomy ? 'N = ' + ctx.fmt(s.N, 1) : 'N', xN, scTop - nLen - 9,
				C.accent, 10, 'center', 'middle', true, C.paper0);

			arw(g, xW, cmY - wLen * 0.5, xW, cmY + wLen * 0.5 + 1, C.ink, 1.8, 7, null);
			lbl(g, roomy ? 'W = ' + ctx.fmt(s.W, 1) : 'W', xW, cmY + wLen * 0.5 + 10,
				C.ink, 10, 'center', 'middle', true, C.paper0);

			/* 合力畫在艙內最右一欄: 用一條虛線索引把人與那一欄連起來,
			   否則三支箭頭擠在身上會分不清誰是合力 */
			ln(g, px + bodyHalf + 1, cmY, xF, cmY, C.inkFaint, 1, [3, 3]);
			if (fLen > 0) {
				if (dNet > 0) arw(g, xF, cmY + fLen * 0.5, xF, cmY - fLen * 0.5, C.ink, 1.8, 7, [4, 3]);
				else arw(g, xF, cmY - fLen * 0.5, xF, cmY + fLen * 0.5, C.ink, 1.8, 7, [4, 3]);
			} else {
				D.dot(g, xF, cmY, 2.2, { color: C.inkDim, fill: C.inkDim, stroke: false });
			}
			lbl(g, roomy ? 'F_net = ' + ctx.fmt(dNet, 1) : 'F_net', cabR - 8,
				fLen > 0 && dNet < 0 ? cmY + fLen * 0.5 + 10 : cmY - fLen * 0.5 - 10,
				C.inkDim, 10, 'right', 'middle', true, C.paper0);

			/* 速度箭頭: 方向跟隨加速度的正負 */
			var vx = (cabR + 8 + W) * 0.5;
			var vy = (cabTop + cabBot) * 0.5;
			var vLen = cl(cabH * 0.3, 13, 44);
			var up = aMs2 >= 0;
			if (up) arw(g, vx, vy + vLen * 0.5, vx, vy - vLen * 0.5, C.ink, 1.6, 6, null);
			else arw(g, vx, vy - vLen * 0.5, vx, vy + vLen * 0.5, C.ink, 1.6, 6, null);
			lbl(g, 'v', vx, up ? vy - vLen * 0.5 - 8 : vy + vLen * 0.5 + 8,
				C.ink, 10, 'center', 'middle', true, K.shaft);
			if (Math.abs(aMs2) < 0.05) {
				lbl(g, '等速', vx, vy + vLen * 0.5 + 20, C.ink, 10, 'center', 'middle', false, K.shaft);
			}

			/* 磅秤讀數: 一整塊紙色儀表板, 左邊數字、右邊指針 —— 跟紙頁同一個調子,
			   不會在實驗卡下面亮一塊綠色的液晶 */
			var stripH = H - stripTop;
			/* 儀表板要落在深色井壁框的內側, 否則會咬掉左/右那兩條框 */
			var inset = Math.max(edgeW + 2, m);
			var pX = inset;
			var pY = stripTop + stripH * 0.08;
			var pW = Math.max(40, W - inset * 2);
			var pH = Math.max(20, Math.min(stripH * 0.84, H - pY - 4));

			g.fillStyle = K.plate;
			g.fillRect(pX, pY, pW, pH);
			g.strokeStyle = K.plateEdge;
			g.lineWidth = 1;
			g.strokeRect(Math.round(pX) + 0.5, Math.round(pY) + 0.5, Math.round(pW) - 1, Math.round(pH) - 1);

			var digW = pW * 0.56;
			var big = Math.max(12, Math.min(pH * 0.46, 24));
			var small = Math.max(10, Math.min(pH * 0.26, 13));
			var light = s.N < 1;
			lbl(g, (light ? '0' : ctx.fmt(s.N, 1)) + ' N',
				pX + digW * 0.5, pY + pH * 0.38, K.plateInk,
				big, 'center', 'middle', true, null);
			lbl(g, light ? '失重' : '= ' + ctx.fmt(s.N / G, 1) + ' kg',
				pX + digW * 0.5, pY + pH * 0.76, K.plateDim, small,
				'center', 'middle', true, null);

			var gaugeW = Math.max(30, pW - digW);
			var gx = pX + digW + gaugeW * 0.5;
			var r = Math.max(12, Math.min(pH * 0.72, gaugeW * 0.42));
			var gy = pY + pH * 0.94;
			drawGauge(g, gx, gy, r, s.N);
			lbl(g, '0', gx - r * 0.94, gy - r * 0.30, K.plateDim, 10, 'center', 'middle', true, K.plate);
			lbl(g, '1800 N', gx + r * 0.94, gy - r * 0.30, K.plateDim, 10, 'center', 'middle', true, K.plate);
		}

		/* ---------------- 互動 ---------------- */

		function setA(v) {
			if (!isFinite(v)) return;
			/* 自由落體要 a = −g = −9.81, 剛好在滑桿下限 −8 之外: 按下預設時把下限
			   擴到 −9.81 並改用 0.01 一級, 否則拇指位置會和讀數差 0.01 */
			var lo = A_MIN;
			if (v < A_MIN) { lo = -G; inA.min = String(-G); inA.step = '0.01'; }
			aMs2 = Math.round(cl(v, lo, A_MAX) * 100) / 100;
			inA.value = String(aMs2);
			syncUI();
			draw();
		}

		inA.addEventListener('input', function () {
			var v = parseFloat(inA.value);
			if (!isFinite(v)) return;
			aMs2 = clampRound(v);
			syncUI();
			draw();
		});

		inM.addEventListener('input', function () {
			var v = parseFloat(inM.value);
			if (!isFinite(v)) return;
			massKg = cl(v, M_MIN, M_MAX);
			syncUI();
			draw();
		});

		function clampRound(v) {
			return Math.round(cl(v, -G, A_MAX) * 100) / 100;
		}

		ctx.onResize(draw);
		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				phase += dt * 1.1;
				draw();
			});
		}

		return {
			destroy: function () {
				view = null;
			}
		};
	});
})();
