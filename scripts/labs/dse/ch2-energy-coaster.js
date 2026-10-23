/**
 * ch2-energy-coaster.js — 過山車與滑梯的能量（DSE 物理 · II.d · 實驗 09）
 *
 * 為什麼速率要沿著弧長積分才對: 學生會把「高度差」算得很準, 卻把摩擦項寫成
 * μg·(水平距離) —— 摩擦力沿著路徑做功, 走的是弧長。所以這裡每一點都先取樣、
 * 累加弧長, 再由能量守恆反推 v:  v² = 2g(h₀ − h) − 2μg·s。
 *
 * 三條能量條永遠加起來等於起點的 mgh₀: 摩擦不是「消失」, 是搬去熱能那一格。
 * 車速為零就停住並標「停在此處」(不會倒退), 因為這一格教的是能量收支, 不是回滾。
 *
 * 繪圖等比例 (水平 1 m 與垂直 1 m 同長), 所以高度剖面不會被視覺誇大。
 */
(function () {
	'use strict';

	var G = 9.81;
	var LEN = 40;            /* m，軌道水平總長 */
	var HMAX = 20;           /* m，畫布對應的最高點 */
	var N = 240;             /* 取樣點數 */
	var SPEED = 1.5;         /* 動畫 1.5× 實時 */
	var HOLD = 0.8;          /* 跑到終點後停留的秒數(淡出 → 從 h₀ 再放一次) */
	var REDUCED_TXT = ' 已依系統設定暫停動態。';

	/* 高度剖面: [水平位置 m, 佔 h₀ 的比例]。第一個山丘最高, 第二個較低,
	   谷底落在 h = 0(所以「谷底速率」與 h₀ = 10 m 的課本數字可直接對照)。 */
	var NODES = [
		[0, 1.00], [2.2, 0.93], [8.0, 0.50], [12.0, 0.00], [18.0, 0.46],
		[23.0, 0.14], [29.0, 0.32], [34.0, 0.12], [40.0, 0.20]
	];

	window.DSELab.define('energy-coaster', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;
		var fmt = ctx.fmt;

		var h0 = 10;             /* m */
		var mu = 0;              /* 摩擦係數 */
		var mass = 500;          /* kg */
		var sTrain = 0;          /* 沿軌道的弧長位置 */
		var stopKind = '';       /* '' | 'energy'(v = 0) | 'end'(還有速度, 但沒有軌道了) */
		var startS = 0;          /* 從山頂釋放的起點: 略過峰頂那一點, 否則 v = 0 開不動 */
		var fade = 1;            /* 車廂淡出 / 淡入 */
		var canStart = true;     /* 釋放點本身有沒有速度: μ 太大時車根本滑不動 */
		var hold = 0;
		var playing = !ctx.reduced;
		var dragMode = '';       /* '' | 'h0' | 'train' */

		var view = null;
		var canvas = null;

		/* 取樣結果（每幀重算一次很便宜: 240 點） */
		var XS = [];
		var HS = [];
		var SS = [];
		var VS = [];
		var stopAt = -1;         /* 停住的取樣索引, -1 = 全程都走得完 */

		/* 螢幕映射與繪圖快取（拖曳命中測試要用上一幀的結果） */
		var map = { ox: 0, oy: 0, s: 1, hx: 0, hy: 0, pts: null };

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}
		function num(v, d) { return fmt(v, d); }
		/* 能量固定一位小數: 三條橫條的數字要對齊, 不能一下 '49' 一下 '49.1' */
		function kJ(v) {
			if (typeof v !== 'number' || !isFinite(v)) return '—';
			return (v / 1000).toFixed(1) + ' kJ';
		}

		/* 節點之間用 cos 內插: 每個節點的斜率為零, 軌道就是一段段平滑的坡,
		   不會像 Catmull-Rom 那樣在谷底衝過頭(衝過頭會讓 v² 出現假負值) */
		function frac(x) {
			if (x <= NODES[0][0]) return NODES[0][1];
			for (var i = 1; i < NODES.length; i++) {
				if (x <= NODES[i][0]) {
					var a = NODES[i - 1];
					var b = NODES[i];
					var u = (x - a[0]) / Math.max(1e-6, b[0] - a[0]);
					return a[1] + (b[1] - a[1]) * (1 - Math.cos(Math.PI * u)) / 2;
				}
			}
			return NODES[NODES.length - 1][1];
		}

		/* ---------------- 物理 ---------------- */

		function build() {
			XS.length = 0; HS.length = 0; SS.length = 0; VS.length = 0;
			stopAt = -1;
			var prevX = 0;
			var prevH = h0 * frac(0);
			var arc = 0;
			for (var i = 0; i <= N; i++) {
				var x = LEN * i / N;
				var h = h0 * frac(x);
				if (i > 0) arc += Math.sqrt((x - prevX) * (x - prevX) + (h - prevH) * (h - prevH));
				var raw = 2 * G * (h0 - h) - 2 * mu * G * arc;
				XS.push(x);
				HS.push(h);
				SS.push(arc);
				VS.push(raw > 0 ? Math.sqrt(raw) : 0);
				if (stopAt < 0 && i > 2 && raw <= 0) stopAt = i;
				prevX = x;
				prevH = h;
			}
			/* 峰頂那一段斜率為零, v(0) = 0 就永遠開不動; 釋放點往後挪到 v ≥ 0.3 m/s
			   的第一個取樣(真實樂園是靠鏈條把車拉到峰頂再放開的) */
			startS = SS[1] || 0;
			for (var k = 1; k < VS.length && k < 40; k++) {
				if (VS[k] >= 0.3) { startS = SS[k]; break; }
			}
			canStart = (VS[idxAt(startS)] || 0) > 0.001;
		}

		/* 由弧長找最近的取樣 (N = 240, 線性掃描足夠) */
		function idxAt(sq) {
			var best = 0;
			var bd = Infinity;
			for (var i = 0; i < SS.length; i++) {
				var d = Math.abs(SS[i] - sq);
				if (d < bd) { bd = d; best = i; }
			}
			return best;
		}

		function state() {
			var i = idxAt(sTrain);
			var h = HS[i];
			var v = VS[i];
			var ep = mass * G * h;
			var ek = 0.5 * mass * v * v;
			var e0 = mass * G * h0;
			var loss = ctx.clamp(mu * mass * G * SS[i], 0, Math.max(0, e0 - ep));
			return { i: i, x: XS[i], h: h, v: v, s: SS[i], ep: ep, ek: ek, loss: loss, e0: e0 };
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		var hint = el('p', 'dl-hint', '拖車廂看任一點；拖 h₀ 標記改高度');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel pe-panel');

		var gTrack = el('div', 'dl-panel__group');
		gTrack.appendChild(el('span', 'dl-panel__label', '軌道'));

		var fH = el('div', 'dl-field');
		fH.appendChild(el('span', 'dl-field__label', '釋放高度 h₀'));
		var inH = el('input', 'dl-range');
		inH.type = 'range';
		inH.min = '2';
		inH.max = '20';
		inH.step = '0.1';
		inH.value = '10';
		inH.setAttribute('aria-label', '釋放高度 h₀（米）');
		var outH = el('output', 'dl-field__val', '10.0 m');
		fH.appendChild(inH);
		fH.appendChild(outH);
		gTrack.appendChild(fH);

		var fM = el('div', 'dl-field');
		fM.appendChild(el('span', 'dl-field__label', '摩擦 μ'));
		var inM = el('input', 'dl-range');
		inM.type = 'range';
		inM.min = '0';
		inM.max = '0.15';
		inM.step = '0.002';
		inM.value = '0';
		inM.setAttribute('aria-label', '摩擦係數 μ');
		var outM = el('output', 'dl-field__val', '無摩擦');
		fM.appendChild(inM);
		fM.appendChild(outM);
		gTrack.appendChild(fM);

		var gTrain = el('div', 'dl-panel__group');
		gTrain.appendChild(el('span', 'dl-panel__label', '列車'));

		var fMass = el('div', 'dl-field');
		fMass.appendChild(el('span', 'dl-field__label', '質量 m'));
		var inMass = el('input', 'dl-range');
		inMass.type = 'range';
		inMass.min = '200';
		inMass.max = '1000';
		inMass.step = '50';
		inMass.value = '500';
		inMass.setAttribute('aria-label', '列車質量（公斤）');
		var outMass = el('output', 'dl-field__val', '500 kg');
		fMass.appendChild(inMass);
		fMass.appendChild(outMass);
		gTrain.appendChild(fMass);

		var btnPlay = null;
		var btnHold = null;
		if (!ctx.reduced) {
			var seg = el('div', 'dl-seg');
			btnPlay = el('button', 'dl-btn is-on', '動態');
			btnHold = el('button', 'dl-btn', '定格');
			btnPlay.type = 'button';
			btnHold.type = 'button';
			btnPlay.setAttribute('aria-pressed', 'true');
			btnHold.setAttribute('aria-pressed', 'false');
			var btnReplay = el('button', 'dl-btn', '重播');
			btnReplay.type = 'button';
			btnReplay.setAttribute('aria-label', '回到釋放高度 h₀ 重新開始');
			seg.appendChild(btnPlay);
			seg.appendChild(btnHold);
			seg.appendChild(btnReplay);
			gTrain.appendChild(seg);
			btnPlay.addEventListener('click', function () { setPlaying(true); });
			btnHold.addEventListener('click', function () { setPlaying(false); });
			btnReplay.addEventListener('click', function () { replay(); });
		}

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}
		var rds = el('div', 'dl-readouts pe-rd');
		var rdH = cell('h');
		var rdV = cell('v');
		var rdEp = cell('Ep');
		var rdEk = cell('Ek');
		var rdTot = cell('E 總');
		var rdLoss = cell('損失');
		rds.appendChild(rdH.root);
		rds.appendChild(rdV.root);
		rds.appendChild(rdEp.root);
		rds.appendChild(rdEk.root);
		rds.appendChild(rdTot.root);
		rds.appendChild(rdLoss.root);

		var texBox = el('div', 'pe-tex');
		var texA = el('span', 'pe-tex__row', '');
		var texB = el('span', 'pe-tex__row', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gTrack);
		panel.appendChild(gTrain);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);
		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 ---------------- */

		var NOTE = '能量條的長度加起來永遠等於起點的 mgh₀：摩擦不是讓能量消失，是把一部分搬到「損失」那一格。' +
			'動畫以 1.5× 實時播放（時間已壓縮），跑完一圈停 0.8 s 就從 h₀ 再放一次；重播鈕隨時可重來。' +
			'兩種停法分開標：能量耗盡（v = 0，打叉）與軌道終點（雙豎線，仍以某個速率前進）——' +
			'後者不是能量用完，車子只是沒有軌道可走了。μ 大到連起步都滑不動時，放開就停在山頂。';
		var lastA = '';
		var lastB = '';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var st = state();
			outH.textContent = num(h0, 1) + ' m';
			outM.textContent = mu < 0.0005 ? '無摩擦' : num(mu, 3);
			outMass.textContent = num(mass, 0) + ' kg';
			rdH.v.textContent = num(st.h, 2) + ' m';
			rdV.v.textContent = num(st.v, 2) + ' m/s';
			rdEp.v.textContent = kJ(st.ep);
			rdEk.v.textContent = kJ(st.ek);
			rdTot.v.textContent = kJ(st.ep + st.ek + st.loss);
			rdLoss.v.textContent = kJ(st.loss);
			rdV.v.classList.toggle('pe-acc', st.v < 0.005);
			rdLoss.v.classList.toggle('pe-acc', st.loss > 0.0001 && st.loss / Math.max(1, st.e0) > 0.001);

			var a = '\\( mgh = \\tfrac{1}{2}mv^2 \\)　\\( W_{net} = \\Delta E_k \\)';
			var b = '\\( v^2 = 2g(h_0 - h) - 2\\mu g s = 2(9.81)(' + num(h0, 1) + ' - ' + num(st.h, 2) +
				') - 2(' + num(mu, 3) + ')(9.81)(' + num(st.s, 1) + ') \\)';
			lastA = setTeX(texA, a, lastA);
			lastB = setTeX(texB, b, lastB);
			note.textContent = NOTE + (ctx.reduced ? REDUCED_TXT : '');
		}

		/* 只在時間推進時更新（每幀）: 不動 KaTeX, 只改數字 */
		function syncFast() {
			var st = state();
			rdH.v.textContent = num(st.h, 2) + ' m';
			rdV.v.textContent = num(st.v, 2) + ' m/s';
			rdEp.v.textContent = kJ(st.ep);
			rdEk.v.textContent = kJ(st.ek);
			rdTot.v.textContent = kJ(st.ep + st.ek + st.loss);
			rdLoss.v.textContent = kJ(st.loss);
			rdV.v.classList.toggle('pe-acc', st.v < 0.005);
		}

		/* ---------------- 繪圖 ---------------- */

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 40 || H < 40) return;

			var m = Math.max(8, Math.min(W, H) * 0.032);
			var band = ctx.clamp(H * 0.15, 20, 42);
			var groundY = Math.round(H - band);
			var s = Math.min((W - m * 2) / LEN, (groundY - m - 12) / HMAX);
			if (!isFinite(s) || s <= 0.0001) s = 1;
			map.ox = Math.round(m);
			map.oy = groundY;
			map.s = s;

			function PX(x) { return map.ox + x * s; }
			function PY(y) { return map.oy - y * s; }

			/* 天空 */
			var sky = g.createLinearGradient(0, 0, 0, Math.max(1, groundY));
			sky.addColorStop(0, '#b6d2e6');
			sky.addColorStop(0.6, '#d9e8f0');
			sky.addColorStop(1, '#edf1e6');
			g.fillStyle = sky;
			g.fillRect(0, 0, W, Math.max(1, groundY));
			/* 遠山: 只是讓地面線不是憑空出現 */
			g.fillStyle = 'rgba(126,146,120,0.35)';
			g.beginPath();
			g.moveTo(0, groundY);
			g.lineTo(W * 0.18, groundY - Math.max(10, groundY * 0.16));
			g.lineTo(W * 0.34, groundY);
			g.moveTo(W * 0.55, groundY);
			g.lineTo(W * 0.72, groundY - Math.max(8, groundY * 0.12));
			g.lineTo(W * 0.9, groundY);
			g.closePath();
			g.fill();

			/* 地面 */
			var soil = g.createLinearGradient(0, groundY, 0, H);
			soil.addColorStop(0, '#8aa566');
			soil.addColorStop(1, '#6f8a50');
			g.fillStyle = soil;
			g.fillRect(0, groundY, W, H - groundY);
			g.strokeStyle = '#5d7444';
			g.lineWidth = 1;
			g.beginPath();
			g.moveTo(0, groundY + 0.5);
			g.lineTo(W, groundY + 0.5);
			g.stroke();

			/* 軌道底線（枕木）+ 軌道 */
			var pts = [];
			for (var i = 0; i < XS.length; i++) pts.push([PX(XS[i]), PY(HS[i])]);
			map.pts = pts;

			g.save();
			g.strokeStyle = 'rgba(70,64,54,0.32)';
			g.lineWidth = Math.max(1, s * 0.09);
			g.beginPath();
			for (var q = 0; q < pts.length; q += 4) {
				var p0 = pts[Math.max(0, q - 1)];
				var p1 = pts[Math.min(pts.length - 1, q + 1)];
				var dx = p1[0] - p0[0];
				var dy = p1[1] - p0[1];
				var dd = Math.sqrt(dx * dx + dy * dy) || 1;
				var nx = -dy / dd;
				var ny = dx / dd;
				var hw = Math.max(2, s * 0.22);
				g.moveTo(pts[q][0] - nx * hw, pts[q][1] - ny * hw);
				g.lineTo(pts[q][0] + nx * hw, pts[q][1] + ny * hw);
			}
			g.stroke();
			/* 鋼軌 */
			g.strokeStyle = '#4b4740';
			g.lineWidth = Math.max(2, s * 0.16);
			g.lineJoin = 'round';
			g.beginPath();
			g.moveTo(pts[0][0], pts[0][1]);
			for (var r = 1; r < pts.length; r++) g.lineTo(pts[r][0], pts[r][1]);
			g.stroke();
			g.strokeStyle = '#9aa1a6';
			g.lineWidth = Math.max(1, s * 0.05);
			g.beginPath();
			g.moveTo(pts[0][0], pts[0][1] - Math.max(1, s * 0.04));
			for (var r2 = 1; r2 < pts.length; r2++) g.lineTo(pts[r2][0], pts[r2][1] - Math.max(1, s * 0.04));
			g.stroke();
			g.restore();

			/* h₀ 量度 */
			var hx = PX(1.2);
			var hy = PY(h0);
			D.dashed(g, hx, hy, hx, groundY, { color: C.inkFaint, width: 1, dash: [3, 3] });
			D.label(g, 'h₀ = ' + num(h0, 1) + ' m', hx + 5, Math.max(m + 6, hy - 9),
				{ color: C.inkDim, size: 10, align: 'left', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
			map.hx = hx;
			map.hy = hy;

			/* 兩種停法要分得開, 否則「沒有軌道了」會被讀成「能量用完」:
			   ① 能量耗盡: 打叉, v = 0   ② 軌道終點: 雙豎線, 車子仍以某速率前進 */
			if (stopAt > 0) {
				var sp = pts[stopAt];
				D.line(g, sp[0] - 5, sp[1] - 5, sp[0] + 5, sp[1] + 5, { color: C.accent, width: 1.4 });
				D.line(g, sp[0] - 5, sp[1] + 5, sp[0] + 5, sp[1] - 5, { color: C.accent, width: 1.4 });
				if (stopKind === 'energy') {
					D.label(g, '能量耗盡 · v = 0，停在此處',
						ctx.clamp(sp[0] + 10, 6, Math.max(6, W - 152)),
						ctx.clamp(sp[1] - 24, m + 8, groundY - 10),
						{ color: C.accent, size: 10, align: 'left', bg: 'rgba(248,246,241,0.92)', pad: 2 });
				}
			}
			/* 軌道終點: 雙豎線常駐; 車子走到最後 0.8 m 就補上速率標籤 */
			var eIdx = pts.length - 1;
			var ex = pts[eIdx][0];
			var ey = pts[eIdx][1];
			D.line(g, ex - 2, ey - 7, ex - 2, ey + 3, { color: C.inkDim, width: 1.2 });
			D.line(g, ex + 3, ey - 7, ex + 3, ey + 3, { color: C.inkDim, width: 1.2 });
			if (SS[eIdx] - sTrain < 0.8) {
				D.label(g, '軌道終點 · 仍以 ' + num(VS[eIdx], 2) + ' m/s 前進', W - m - 2,
					ctx.clamp(ey - 30, m + 8, groundY - 12),
					{ color: C.inkDim, size: 10, align: 'right', bg: 'rgba(248,246,241,0.92)', pad: 2 });
			}

			/* 車廂: 兩節, 沿切線擺正。只有車廂與兩支箭頭跟著淡入淡出 */
			var st = state();
			var alpha = playing ? ctx.clamp(fade, 0, 1) : 1;
			g.save();
			g.globalAlpha = alpha;
			var lenRef = ctx.clamp(Math.min(W, H) * 0.15, 16, 40);
			var vMax = Math.sqrt(2 * G * h0);
			var carLen = Math.max(7, s * 2.1);
			var carH = Math.max(4, s * 0.95);
			for (var c = 1; c >= 0; c--) {
				var idx = idxAt(Math.max(0, st.s - c * carLen / Math.max(1, s) * 1.15));
				var cp = pts[idx];
				var pa = pts[Math.max(0, idx - 2)];
				var pb = pts[Math.min(pts.length - 1, idx + 2)];
				var ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
				g.save();
				g.translate(cp[0], cp[1] - carH * 0.62);
				g.rotate(ang);
				g.fillStyle = c === 0 ? '#b8442a' : '#8f3520';
				g.strokeStyle = '#5d2314';
				g.lineWidth = 1;
				g.beginPath();
				g.rect(-carLen * 0.5, -carH * 0.5, carLen, carH);
				g.fill();
				g.stroke();
				g.fillStyle = 'rgba(240,238,230,0.85)';
				g.fillRect(-carLen * 0.34, -carH * 0.34, carLen * 0.26, carH * 0.4);
				g.fillRect(carLen * 0.06, -carH * 0.34, carLen * 0.26, carH * 0.4);
				g.restore();
			}

			/* 速度箭頭（切線）與重力箭頭 */
			var head = pts[st.i];
			var ha = pts[Math.max(0, st.i - 2)];
			var hb = pts[Math.min(pts.length - 1, st.i + 2)];
			var tan = Math.atan2(hb[1] - ha[1], hb[0] - ha[0]);
			var vLen = vMax > 0.01 ? lenRef * (st.v / vMax) : 0;
			if (vLen > 2) {
				D.arrow(g, head[0], head[1] - carH * 1.1,
					head[0] + Math.cos(tan) * vLen, head[1] - carH * 1.1 + Math.sin(tan) * vLen,
					{ color: C.accent, width: 1.5, head: 5.5 });
				D.label(g, 'v', head[0] + Math.cos(tan) * vLen * 1.06, head[1] - carH * 1.1 + Math.sin(tan) * vLen * 1.06,
					{ color: C.accent, size: 10, align: 'left', baseline: 'middle', mono: true });
			}
			var wLen = Math.max(12, lenRef * 0.55);
			D.arrow(g, head[0], head[1] + 1, head[0], head[1] + wLen,
				{ color: C.inkDim, width: 1.3, head: 5 });
			D.label(g, 'mg', head[0] + 3, head[1] + wLen * 0.55,
				{ color: C.inkDim, size: 10, align: 'left', baseline: 'middle', mono: true });

			g.restore();

			/* 能量條: 三條加起來 = mgh₀。整塊用固定比例排版(標籤 / 橫條 / 數值三欄),
			   小畫布上只是橫條變短, 字不會疊 */
			var e0 = Math.max(1e-6, st.e0);
			var blockW = ctx.clamp(W * 0.34, 116, 188);
			var labW = 24;
			var valW = 44;
			var bw = Math.max(20, blockW - labW - valW - 12);
			var bh = 6;
			var pitch = 11;
			var blockH = 16 + 3 * pitch + 4;
			var blockX = W - m - blockW;
			var blockY = m + 2;
			var rowY0 = blockY + 16;
			var barX2 = blockX + labW + 4;
			g.save();
			g.fillStyle = 'rgba(248,246,241,0.93)';
			g.strokeStyle = C.line;
			g.lineWidth = 1;
			g.beginPath();
			g.rect(blockX + 0.5, blockY + 0.5, blockW, blockH);
			g.fill();
			g.stroke();
			g.restore();
			D.label(g, '能量', blockX + 5, blockY + 8, { color: C.inkFaint, size: 10, align: 'left' });
			D.label(g, 'Σ ' + kJ(st.ep + st.ek + st.loss), blockX + blockW - 5, blockY + 8,
				{ color: C.inkFaint, size: 10, align: 'right', mono: true });
			var rows = [
				['Ep', st.ep, C.inkDim],
				['Ek', st.ek, C.accent],
				['損失', st.loss, 'rgba(122,114,98,0.9)']
			];
			for (var ri = 0; ri < rows.length; ri++) {
				var ry = rowY0 + ri * pitch;
				D.label(g, rows[ri][0], barX2 - 4, ry + bh * 0.5,
					{ color: C.inkDim, size: 10, align: 'right', baseline: 'middle' });
				g.save();
				g.strokeStyle = C.lineStrong;
				g.lineWidth = 1;
				g.strokeRect(Math.round(barX2) + 0.5, Math.round(ry) + 0.5, Math.round(bw), bh);
				var fw = bw * ctx.clamp(rows[ri][1] / e0, 0, 1);
				if (fw > 0.5) {
					g.fillStyle = rows[ri][2];
					g.fillRect(barX2 + 0.5, ry + 1, fw, bh - 1);
				}
				g.restore();
				D.label(g, kJ(rows[ri][1]), barX2 + bw + 4, ry + bh * 0.5,
					{ color: C.inkDim, size: 10, align: 'left', baseline: 'middle', mono: true });
			}

			/* 拖曳把手: h₀ 標記（車廂本身也可拖, 不上把手避免擋住車） */
			D.handle(g, hx, hy, { color: C.ink, fill: C.paper0, size: 10, width: 1.2 });
		}

		/* ---------------- 互動 ---------------- */

		/* 第一個谷底: 靜態(無動畫)時最有資訊的一格 —— 最大速率 */
		function valleyS() {
			var vI = 0;
			var bestH = Infinity;
			for (var i = 0; i <= 12 * N / LEN && i < HS.length; i++) {
				if (HS[i] < bestH) { bestH = HS[i]; vI = i; }
			}
			return stopAt > 0 && stopAt < vI ? SS[stopAt] : SS[vI];
		}

		function place(sq) {
			sTrain = isFinite(sq) ? sq : 0;
			stopKind = (VS[idxAt(sTrain)] || 0) > 0.001 ? '' : 'energy';
			hold = 0;
			fade = playing ? 0 : 1;
		}

		/* 參數變了: 重建取樣, 但不要讓車子跳回山上 —— 改 μ 要能當場看到同一點的速率變化 */
		function rebuildKeeping() {
			var keep = sTrain;
			build();
			if (stopAt > 0 && keep > SS[stopAt]) keep = SS[stopAt];
			sTrain = ctx.clamp(keep, 0, SS[SS.length - 1] || 0);
			stopKind = (VS[idxAt(sTrain)] || 0) > 0.001 ? '' : 'energy';
			hold = 0;
			fade = 1;
		}

		/* 重播: 任何時候都能回到 h₀ 再放一次(能量耗盡或定格時都有用) */
		function replay() {
			build();
			setPlaying(true);      /* 重播 = 回到山頂再跑一次, 不是只把車搬回去 */
			place(startS);
			syncUI();
			draw();
		}

		function resetTrain() {
			build();
			sTrain = ctx.reduced ? valleyS() : startS;
			stopKind = (VS[idxAt(sTrain)] || 0) > 0.001 ? '' : 'energy';
			hold = 0;
			fade = ctx.reduced ? 1 : 0;
		}

		function setH0(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 2, 20) * 10) / 10;
			if (n === h0) return;
			h0 = n;
			inH.value = String(n);
			rebuildKeeping();
			syncUI();
			draw();
		}

		function setMu(v) {
			if (!isFinite(v)) return;
			var n = ctx.clamp(v, 0, 0.15);
			mu = Math.round(n * 500) / 500;
			inM.value = String(mu);
			rebuildKeeping();
			syncUI();
			draw();
		}

		function setPlaying(next) {
			if (!!next === playing) return;
			playing = !!next;
			if (btnPlay && btnHold) {
				btnPlay.classList.toggle('is-on', playing);
				btnHold.classList.toggle('is-on', !playing);
				btnPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
				btnHold.setAttribute('aria-pressed', playing ? 'false' : 'true');
			}
			hold = 0;
			fade = 1;
		}

		function nearHandle(px, py) {
			var dx = px - map.hx;
			var dy = py - map.hy;
			return Math.sqrt(dx * dx + dy * dy) < 17;
		}

		/* 指標落在軌道附近就把車停到那裡; 落不到就什麼都不做 */
		function scrubTo(px) {
			if (!map.pts) return false;
			var best = 0;
			var bd = Infinity;
			for (var i = 0; i < map.pts.length; i++) {
				var d = Math.abs(map.pts[i][0] - px);
				if (d < bd) { bd = d; best = i; }
			}
			sTrain = SS[best];
			stopKind = '';
			hold = 0;
			fade = 1;
			return true;
		}

		function localPoint(e) {
			var r = canvas.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };
		}

		canvas.addEventListener('pointerdown', function (e) {
			var p = localPoint(e);
			if (nearHandle(p.x, p.y)) dragMode = 'h0';
			else if (map.pts) {
				var best = Infinity;
				for (var i = 0; i < map.pts.length; i++) {
					var dx = map.pts[i][0] - p.x;
					var dy = map.pts[i][1] - p.y;
					var d = dx * dx + dy * dy;
					if (d < best) best = d;
				}
				dragMode = best < 22 * 22 ? 'train' : '';
			}
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒有可捕捉的指標 */ }
			if (!dragMode) return;
			e.preventDefault();
			setPlaying(false);
			if (dragMode === 'h0') setH0((map.oy - p.y) / map.s);
			else { scrubTo(p.x); syncFast(); draw(); }
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragMode) return;
			e.preventDefault();
			var p = localPoint(e);
			if (dragMode === 'h0') setH0((map.oy - p.y) / map.s);
			else { scrubTo(p.x); syncFast(); draw(); }
		});

		function endDrag(e) {
			if (!dragMode) return;
			dragMode = '';
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
				canvas.releasePointerCapture(e.pointerId);
			}
		}
		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);

		inH.addEventListener('input', function () { setH0(parseFloat(inH.value)); });
		inM.addEventListener('input', function () { setMu(parseFloat(inM.value)); });
		inMass.addEventListener('input', function () {
			var v = parseFloat(inMass.value);
			if (!isFinite(v)) return;
			mass = ctx.clamp(v, 200, 1000);
			inMass.value = String(mass);
			syncUI();
			draw();
		});

		ctx.onResize(draw);

		resetTrain();
		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				if (playing) {
					if (stopKind) {
						/* 停 HOLD 秒: 車廂先淡出, 再從山頂淡入, 一圈接一圈。
						   若釋放點本身就滑不動(μ 太大), 就停在原處並把標籤留著 */
						hold += dt;
						fade = canStart ? ctx.clamp(1 - (hold - 0.3) / 0.42, 0, 1) : 1;
						if (canStart && hold >= HOLD) {
							sTrain = startS;
							stopKind = '';
							hold = 0;
							fade = 0;
						}
					} else {
						fade = Math.min(1, fade + dt / 0.18);
						var i = idxAt(sTrain);
						if (!(VS[i] > 0.001)) {
							/* 速率為零(連起步都不行): 標籤要說得出來, 不能只是定格 */
							stopKind = 'energy';
							hold = 0;
							fade = 1;
						} else {
						sTrain += VS[i] * dt * SPEED;
						if (stopAt > 0 && sTrain >= SS[stopAt]) {
							sTrain = SS[stopAt];
							stopKind = 'energy';
							hold = 0;
						} else if (sTrain >= SS[SS.length - 1]) {
							sTrain = SS[SS.length - 1];
							stopKind = 'end';
							hold = 0;
						}
						}
					}
				}
				syncFast();
				draw();
			});
		}

		return { destroy: function () { canvas = null; map.pts = null; } };
	});
})();
