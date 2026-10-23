/**
 * ch2-projectile-split.js — 拋體：兩個方向分開看（DSE 物理 · II.c · 實驗 07）
 *
 * 為什麼要留一顆「無重力設想」的鬼影球：學生算得出 R，卻常說不出「球明明在掉，
 * 為什麼還一直往前走」。鬼影球與真球共用同一個 t、同一個 x，只是 y 不動——
 * 兩顆球的垂直連線就是時間游標本身，一眼看出水平方向完全沒被重力碰過。
 *
 * 座標換算一律等比例（sx = sy）：45° 在畫面上就是 45°，不會因為射程長短被拉歪。
 * y 從炮口量起，而炮口就落在地面線上——所以 T = 2u sinθ / g 與規格一致。
 */
(function () {
	'use strict';

	var G = 9.81;
	var DT_MARK = 0.4;      /* 每 0.4 s 標一個位置 */
	var SPEED = 1.25;       /* 動畫比實時快 1.25 倍 */
	var REDUCED_TXT = ' 已依系統設定暫停動態。';

	window.DSELab.define('projectile-split', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;
		var fmt = ctx.fmt;

		/* ---------------- 狀態 ---------------- */

		var u = 20;              /* m/s */
		var thDeg = 45;          /* 度，1 度一格 */
		var tNow = 0;            /* 目前時刻，游標與球共用同一個 t */
		var playing = !ctx.reduced;
		var dragMode = '';       /* '' | 'time' | 'aim' */

		var view = null;
		var canvas = null;

		/* 上一幀的螢幕映射與炮管端點: 拖曳要靠它把指標換算回世界座標 */
		var map = { ox: 0, oy: 0, s: 1, bx: 0, by: 0, mx: 0, my: 0, bl: 0 };

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		function num(v, d) { return fmt(v, d); }

		/* 中文用襯線、數字用等寬: 同一句話裡兩種字族，靠這個估寬度決定要不要換邊放 */
		function estW(text, size) {
			var w = 0;
			for (var i = 0; i < text.length; i++) w += text.charCodeAt(i) > 0x2e80 ? size : size * 0.6;
			return w;
		}

		function distSeg(px, py, x1, y1, x2, y2) {
			var dx = x2 - x1;
			var dy = y2 - y1;
			var len2 = dx * dx + dy * dy;
			if (len2 < 1e-6) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
			var k = ctx.clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
			var qx = x1 + dx * k;
			var qy = y1 + dy * k;
			return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
		}

		/* ---------------- 物理 ---------------- */

		function phys() {
			var rad = thDeg * Math.PI / 180;
			var ux = u * Math.cos(rad);
			var uy = u * Math.sin(rad);
			var T = 2 * uy / G;
			return { ux: ux, uy: uy, T: T, R: ux * T, H: uy * uy / (2 * G), tA: uy / G };
		}

		function yAt(p, t) { return p.uy * t - 0.5 * G * t * t; }
		function vyAt(p, t) { return p.uy - G * t; }

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		var hint = el('p', 'dl-hint', '拖炮管改發射角 · 拖畫面改時刻');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel pe-panel');

		/* 拋體 */
		var gShot = el('div', 'dl-panel__group');
		gShot.appendChild(el('span', 'dl-panel__label', '拋體'));

		var fU = el('div', 'dl-field');
		fU.appendChild(el('span', 'dl-field__label', '初速 u'));
		var inU = el('input', 'dl-range');
		inU.type = 'range';
		inU.min = '5';
		inU.max = '40';
		inU.step = '0.5';
		inU.value = '20';
		inU.setAttribute('aria-label', '初速 u（米每秒）');
		var outU = el('output', 'dl-field__val', '20 m/s');
		fU.appendChild(inU);
		fU.appendChild(outU);
		gShot.appendChild(fU);

		var fT = el('div', 'dl-field');
		fT.appendChild(el('span', 'dl-field__label', '發射角 θ'));
		var inT = el('input', 'dl-range');
		inT.type = 'range';
		inT.min = '0';
		inT.max = '85';
		inT.step = '1';
		inT.value = '45';
		inT.setAttribute('aria-label', '發射角 θ（度）');
		var outT = el('output', 'dl-field__val', '45°');
		fT.appendChild(inT);
		fT.appendChild(outT);
		gShot.appendChild(fT);

		/* 時間 */
		var gTime = el('div', 'dl-panel__group');
		gTime.appendChild(el('span', 'dl-panel__label', '時間游標'));

		var fC = el('div', 'dl-field');
		fC.appendChild(el('span', 'dl-field__label', '時刻 t'));
		var inC = el('input', 'dl-range');
		inC.type = 'range';
		inC.min = '0';
		inC.max = '2.883';
		inC.step = '0.005';
		inC.value = '0';
		inC.setAttribute('aria-label', '時間游標 t（秒）');
		var outC = el('output', 'dl-field__val', '0 s');
		fC.appendChild(inC);
		fC.appendChild(outC);
		gTime.appendChild(fC);

		var btnPlay = null;
		if (!ctx.reduced) {
			var seg = el('div', 'dl-seg');
			btnPlay = el('button', 'dl-btn is-on', '動態');
			var btnHold = el('button', 'dl-btn', '定格');
			btnPlay.type = 'button';
			btnHold.type = 'button';
			btnPlay.setAttribute('aria-pressed', 'true');
			btnHold.setAttribute('aria-pressed', 'false');
			seg.appendChild(btnPlay);
			seg.appendChild(btnHold);
			gTime.appendChild(seg);

			btnPlay.addEventListener('click', function () { setPlaying(true); });
			btnHold.addEventListener('click', function () { setPlaying(false); });
		}

		/* 讀數 */
		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}
		var rds = el('div', 'dl-readouts pe-rd');
		var rdVx = cell('v_x');
		var rdVy = cell('v_y');
		var rdTa = cell('t 頂點');
		var rdH = cell('H');
		var rdR = cell('R');
		var rdT = cell('飛行時間');
		rds.appendChild(rdVx.root);
		rds.appendChild(rdVy.root);
		rds.appendChild(rdTa.root);
		rds.appendChild(rdH.root);
		rds.appendChild(rdR.root);
		rds.appendChild(rdT.root);

		var texBox = el('div', 'pe-tex');
		var texA = el('span', 'pe-tex__row', '');
		var texB = el('span', 'pe-tex__row', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gShot);
		panel.appendChild(gTime);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 文字 ---------------- */

		var NOTE = '水平方向等速、垂直方向等加速，兩者只靠 t 連結。鬼影球是「假設沒有重力」的同行者：' +
			'它與真球永遠同一個 x。最高點 v_y = 0，但 v_x 不變、加速度仍是 g 向下。';
		var lastA = '';
		var lastB = '';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function clampT() {
			var p = phys();
			inC.max = String(Math.round(p.T * 1000) / 1000 || 0);
			/* 步長固定 1 ms: 游標才停得到 t_頂點(1.442 s), v_y 讀得到 0 */
			inC.step = '0.001';
			if (!(tNow >= 0)) tNow = 0;
			if (tNow > p.T) tNow = p.T;
		}

		/* 每一幀只改時刻相關的三處; KaTeX、滑桿 max 這些留給 syncUI */
		function syncTime() {
			var p = phys();
			var vy = vyAt(p, tNow);
			outC.textContent = num(tNow, 2) + ' s';
			inC.value = String(Math.round(tNow * 1000) / 1000);
			rdVy.v.textContent = num(Math.abs(vy), 2) + (Math.abs(vy) < 0.005 ? '' : (vy > 0 ? ' ↑' : ' ↓'));
			rdVy.v.classList.toggle('pe-acc', Math.abs(vy) < 0.005);
		}

		function syncUI() {
			var p = phys();
			clampT();
			outU.textContent = num(u, 1) + ' m/s';
			outT.textContent = num(thDeg, 0) + '°';
			rdVx.v.textContent = num(p.ux, 2) + ' m/s';
			rdTa.v.textContent = p.T > 0 ? num(p.tA, 3) + ' s' : '—';
			rdH.v.textContent = num(p.H, 2) + ' m';
			rdR.v.textContent = num(p.R, 2) + ' m';
			rdT.v.textContent = num(p.T, 3) + ' s';
			syncTime();

			var a = '\\( x = (u\\cos\\theta)\\,t \\)　\\( y = (u\\sin\\theta)\\,t - \\tfrac{1}{2}gt^2 \\)';
			var b;
			if (p.T > 0) {
				b = '頂點 \\( t = \\dfrac{u\\sin\\theta}{g} = \\dfrac{' + num(p.uy, 2) + '}{9.81} = ' +
					num(p.tA, 3) + '\\;\\text{s} \\)，此時 \\( v_y = 0 \\) 而 \\( v_x = ' + num(p.ux, 2) + ' \\)';
			} else {
				b = '\\( \\theta = 0 \\)：水平發射，離地即落地，\\( T = 0 \\)；\\( v_x = u \\) 仍不為零';
			}
			lastA = setTeX(texA, a, lastA);
			lastB = setTeX(texB, b, lastB);
			note.textContent = NOTE + (ctx.reduced ? REDUCED_TXT : '');
		}

		/* ---------------- 繪圖 ---------------- */

		function sky(g, W, groundY) {
			var grd = g.createLinearGradient(0, 0, 0, Math.max(1, groundY));
			grd.addColorStop(0, '#b9d5e8');
			grd.addColorStop(0.58, '#dbeaf2');
			grd.addColorStop(1, '#eef1e9');
			g.fillStyle = grd;
			g.fillRect(0, 0, W, Math.max(1, groundY));
			/* 兩三朵雲: 只是讓上方不是一片死板的漸層 */
			g.fillStyle = 'rgba(255,255,255,0.55)';
			var cw = W * 0.11;
			var spots = [[0.22, 0.20], [0.62, 0.13], [0.82, 0.26]];
			for (var i = 0; i < spots.length; i++) {
				var cx = W * spots[i][0];
				var cy = groundY * spots[i][1];
				g.beginPath();
				g.ellipse(cx, cy, cw, cw * 0.42, 0, 0, Math.PI * 2);
				g.ellipse(cx + cw * 0.75, cy + cw * 0.1, cw * 0.62, cw * 0.3, 0, 0, Math.PI * 2);
				g.fill();
			}
		}

		function groundBand(g, W, H, groundY) {
			var soil = g.createLinearGradient(0, groundY, 0, H);
			soil.addColorStop(0, '#c3b79c');
			soil.addColorStop(1, '#a89c82');
			g.fillStyle = soil;
			g.fillRect(0, groundY, W, H - groundY);
			g.fillStyle = '#8aa566';
			g.fillRect(0, groundY, W, Math.min(7, Math.max(4, H - groundY - 2)));
			g.strokeStyle = '#5d7444';
			g.lineWidth = 1;
			g.beginPath();
			g.moveTo(0, groundY + 0.5);
			g.lineTo(W, groundY + 0.5);
			g.stroke();
			g.strokeStyle = '#6b8749';
			g.beginPath();
			for (var x = 4; x < W; x += 11) {
				g.moveTo(x, groundY + 8);
				g.lineTo(x + 1.5, groundY + 11);
			}
			g.stroke();
		}

		/* 炮: 炮口固定在發射點(世界原點)，炮管往後下方延伸；長度收在土層內，
		   所以任何角度看都像「架在草裡的炮」，不會整根插進地底。
		   陰影 -> 輪 -> 炮架 -> 炮管的順序不可換: 炮管要壓在最上面才讀得出角度。 */
		function cannon(g, mx, my, rad, soilH) {
			var sin = Math.sin(rad);
			var cos = Math.cos(rad);
			var bl = Math.min(soilH * 0.9 / Math.max(sin, 0.22), ctx.clamp(Math.min(view.w, view.h) * 0.17, 36, 66));
			var bx = mx - cos * bl;
			var by = my + sin * bl;
			map.bx = bx;
			map.by = by;
			map.bl = bl;

			var r = Math.max(6, bl * 0.19);
			var wx = bx + bl * 0.12;
			var wy = my + r * 0.45;

			g.save();
			/* 地面陰影 */
			g.beginPath();
			g.ellipse((wx + mx) * 0.5, my + 2, bl * 0.52, Math.max(2, bl * 0.07), 0, 0, Math.PI * 2);
			g.fillStyle = 'rgba(40,34,24,0.13)';
			g.fill();

			/* 炮架: 從輪心撐到炮管中段的楔形 */
			var mx0 = mx - cos * bl * 0.55;
			var my0 = my + sin * bl * 0.55;
			g.beginPath();
			g.moveTo(wx - r * 0.55, my + 1);
			g.lineTo(wx + r * 0.8, my + 1);
			g.lineTo(mx0, my0);
			g.closePath();
			g.fillStyle = '#6a5236';
			g.fill();
			g.strokeStyle = '#463320';
			g.lineWidth = 1;
			g.stroke();

			/* 輪子 */
			g.beginPath();
			g.arc(wx, wy, r, 0, Math.PI * 2);
			g.fillStyle = '#3a332a';
			g.fill();
			g.strokeStyle = '#211c16';
			g.lineWidth = 1.6;
			g.stroke();
			g.strokeStyle = '#a48f66';
			g.lineWidth = 1;
			for (var i = 0; i < 5; i++) {
				var a = i * Math.PI * 2 / 5;
				g.beginPath();
				g.moveTo(wx, wy);
				g.lineTo(wx + Math.cos(a) * r * 0.84, wy + Math.sin(a) * r * 0.84);
				g.stroke();
			}
			g.beginPath();
			g.arc(wx, wy, Math.max(1.6, r * 0.26), 0, Math.PI * 2);
			g.fillStyle = '#211c16';
			g.fill();

			/* 炮管: 先粗黑、再細高光，最後一圈炮口環 */
			var thick = Math.max(5, bl * 0.17);
			g.lineCap = 'round';
			g.strokeStyle = '#39352c';
			g.lineWidth = thick;
			g.beginPath();
			g.moveTo(bx, by);
			g.lineTo(mx - cos * thick * 0.3, my + sin * thick * 0.3);
			g.stroke();
			g.strokeStyle = '#8b8577';
			g.lineWidth = Math.max(1.2, thick * 0.3);
			g.beginPath();
			g.moveTo(bx + cos * thick * 0.28, by - sin * thick * 0.28);
			g.lineTo(mx - cos * thick * 0.75, my + sin * thick * 0.75);
			g.stroke();
			g.save();
			g.translate(mx - cos * thick * 0.42, my + sin * thick * 0.42);
			g.rotate(-rad);
			g.fillStyle = '#1c1a16';
			g.fillRect(-thick * 0.3, -thick * 0.66, thick * 0.5, thick * 1.32);
			g.restore();
			g.restore();
		}

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 40 || H < 40) return;

			var p = phys();
			var m = Math.max(8, Math.min(W, H) * 0.035);
			var soilH = ctx.clamp(H * 0.19, 26, 54);
			var groundY = Math.round(H - soilH);
			var top = Math.round(m + 4);
			var cannonW = ctx.clamp(Math.min(W, H) * 0.19, 28, 58);
			var ox = Math.round(m + cannonW * 1.02);
			var rightPad = m + 10;

			/* 水平軸釘在「這個 u 在 45° 時的射程」(= u²/g), 只隨 u 改變。
			   軸若跟著弧一起縮放, 學生看到的就是「角度變小, 終點還是最遠」——
			   那正是使用者回報的問題。固定的軸才讓 R 的長短真的看得出來。 */
			var rMax = u * u / G;                      /* 45° 射程 = 軸右端的參考刻度 */
			var xAxis = Math.max(rMax, 2) * 1.06;
			var yspan = Math.max(p.H, 2.4) * 1.24;     /* θ 大時整體縮小, 高弧線才不會被切 */
			var s = Math.min((W - rightPad - ox) / xAxis, (groundY - top) / yspan);
			if (!isFinite(s) || s <= 0.0001) s = 1;
			map.ox = ox;
			map.oy = groundY;
			map.s = s;

			var rad = thDeg * Math.PI / 180;

			function px(x) { return ox + x * s; }
			function py(y) { return groundY - y * s; }

			sky(g, W, groundY);
			groundBand(g, W, H, groundY);

			/* 無重力鬼影的水平線: 就畫在發射高度(= 地面線)上 */
			if (p.T > 0) {
				D.dashed(g, ox, groundY, px(p.R), groundY, { color: 'rgba(125,37,50,0.45)', width: 1, dash: [2, 5] });
			}

			/* 軌跡: 點狀 */
			if (p.T > 0) {
				var steps = Math.max(16, Math.round((p.R * s) / 9));
				g.save();
				g.fillStyle = C.inkDim;
				for (var i = 0; i <= steps; i++) {
					var t = p.T * i / steps;
					var dx = px(p.ux * t);
					var dy = py(yAt(p, t));
					g.beginPath();
					g.arc(dx, dy, 1.15, 0, Math.PI * 2);
					g.fill();
				}
				g.restore();
			}

			/* 每 0.4 s 的位置 + v_x / v_y */
			var arLen = ctx.clamp(Math.min(W, H) * 0.085, 13, 26);
			var kv = arLen / u;
			var marks = [];
			if (p.T > 0 && DT_MARK > 0) {
				for (var tm = DT_MARK; tm < p.T - 0.02 && marks.length < 40; tm += DT_MARK) marks.push(tm);
			}
			var spacingOk = marks.length > 1 && (px(p.ux * DT_MARK) - ox) > 22;
			var j;
			for (j = 0; j < marks.length; j++) {
				var t1 = marks[j];
				var sx = px(p.ux * t1);
				var sy = py(yAt(p, t1));
				var vy1 = vyAt(p, t1);
				g.save();
				g.fillStyle = C.inkFaint;
				g.beginPath();
				g.arc(sx, sy, 1.6, 0, Math.PI * 2);
				g.fill();
				g.restore();
				if (spacingOk) {
					D.arrow(g, sx, sy, sx + p.ux * kv, sy, { color: C.inkDim, width: 1.1, head: 4.5 });
					if (Math.abs(vy1) * kv > 1.2) {
						D.arrow(g, sx, sy, sx, sy - vy1 * kv,
							{ color: C.accent, width: 1.3, head: 5 });
					}
				}
			}

			/* 最高點: 垂直虛線 + 兩行註記 */
			if (p.T > 0) {
				var ax = px(p.ux * p.tA);
				var ay = py(p.H);
				D.dashed(g, ax, ay, ax, groundY, { color: C.accent, width: 1, dash: [3, 4] });
				D.dot(g, ax, ay, 2.6, { color: C.accent, fill: C.accent, stroke: false });
				var l1 = '最高點：v_y = 0、v_x ≠ 0';
				var l2 = 'a = g ↓';
				var wMax = Math.max(estW(l1, 10.5), estW(l2, 10.5));
				var flip = ax + wMax + 12 > W - 4;
				var tx = flip ? ax - 8 : ax + 8;
				var align = flip ? 'right' : 'left';
				/* 註記預設放在頂點上方(那塊永遠是空的); 頂點貼到上緣才改放進拋物線裡面 */
				var y1 = ay - 28;
				var y2 = ay - 14;
				if (y1 < top + 7) { y1 = ay + 15; y2 = ay + 29; }
				D.label(g, l1, tx, y1, { color: C.accent, size: 10.5, align: align, bg: 'rgba(248,246,241,0.9)', pad: 2.5 });
				D.label(g, l2, tx, y2, { color: C.accent, size: 10.5, align: align, bg: 'rgba(248,246,241,0.9)', pad: 2.5 });
			} else {
				D.label(g, 'θ = 0：水平發射，離地即落地', px(4) + 6, groundY - 18,
					{ color: C.inkDim, size: 10.5, align: 'left', bg: 'rgba(248,246,241,0.88)', pad: 2.5 });
			}

			/* H 量度 */
			if (p.H * s > 40 && p.T > 0) {
				D.label(g, 'H = ' + num(p.H, 2) + ' m', px(p.ux * p.tA) + 5, py(p.H * 0.5),
					{ color: C.inkDim, size: 10.5, align: 'left', mono: true, bg: 'rgba(248,246,241,0.88)', pad: 2.5 });
			}

			/* 炮 */
			cannon(g, ox, groundY, rad, soilH);

			/* R 量度: 貼在地面線下緣，避免壓到軌跡 */
			if (p.R * s > 46 && p.T > 0) {
				var lx = px(0);
				var rx = px(p.R);
				/* 量度線貼在地面線上緣: 拋物線中段下方的空白是畫面上最安全的一條帶 */
				var ly = groundY - 9;
				D.line(g, lx, ly, rx, ly, { color: C.inkFaint, width: 1 });
				D.line(g, lx, ly - 3, lx, ly + 3, { color: C.inkFaint, width: 1 });
				D.line(g, rx, ly - 3, rx, ly + 3, { color: C.inkFaint, width: 1 });
				D.label(g, 'R = ' + num(p.R, 2) + ' m', (lx + rx) * 0.5, ly,
					{ color: C.inkDim, size: 10.5, align: 'center', mono: true, bg: 'rgba(248,246,241,0.92)', pad: 2.5 });
			}

			/* 45° 的射程刻度: 軸右緣的參考線, 讓『還沒用到的射程』看得出來 */
			if (rMax * s > 34) {
				var mx45 = px(rMax);
				D.dashed(g, mx45, groundY - 28, mx45, groundY - 14, { color: C.inkFaint, width: 1, dash: [2, 3] });
				if (p.R < rMax * 0.94 && groundY - 34 > py(p.H) - 10) {
					D.label(g, '45° 最大射程 ' + num(rMax, 2) + ' m', mx45 - 3, groundY - 34,
						{ color: C.inkFaint, size: 10, align: 'right', bg: 'rgba(248,246,241,0.86)', pad: 2 });
				}
			}

			/* 時間游標 + 真球 + 鬼影球 */
			var cx = p.T > 0 ? px(p.ux * tNow) : ox;
			var cy = p.T > 0 ? py(yAt(p, tNow)) : groundY;
			D.dashed(g, cx, cy, cx, groundY - 1, { color: C.lineStrong, width: 1, dash: [4, 4] });

			if (p.T > 0) {
				/* 鬼影球: 與真球同 x、y 停在地面線 */
				D.arc(g, cx, groundY, 4, 0, Math.PI * 2, { color: 'rgba(125,37,50,0.55)', width: 1.2, dash: null });
				D.dot(g, cx, groundY, 1.4, { color: 'rgba(125,37,50,0.6)', fill: 'rgba(125,37,50,0.6)', stroke: false });
			}

			/* 真球: 等比例圓，畫在軌跡上 */
			g.save();
			g.beginPath();
			g.arc(cx, cy, 3.6, 0, Math.PI * 2);
			g.fillStyle = '#2a2723';
			g.fill();
			g.restore();

			/* 拖曳把手: 炮管中段一格 + 游標底部一格 */
			D.handle(g, map.bx + (ox - map.bx) * 0.42, map.by + (groundY - map.by) * 0.42,
				{ color: C.ink, fill: C.paper0, size: 9, width: 1.1 });
			if (p.T > 0) {
				D.handle(g, cx, groundY + 1, { color: C.ink, fill: C.paper0, size: 8, width: 1.1 });
				/* 時刻標籤放在游標頂端: 土層的左下角是 .dl-hint 的地盤, 地面線上又有 R 量度線 */
				var tRight = cx > W * 0.55;
				D.label(g, 't = ' + num(tNow, 2) + ' s', cx + (tRight ? -7 : 7), top + 9,
					{ color: C.ink, size: 10, align: tRight ? 'right' : 'left', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
			}
		}

		/* ---------------- 互動 ---------------- */

		function setU(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 5, 40) * 2) / 2;
			if (n === u) return;
			var frac = 0;
			var before = phys();
			if (before.T > 0) frac = tNow / before.T;
			u = n;
			inU.value = String(n);
			tNow = phys().T * frac;
			clampT();
			syncUI();
			draw();
		}

		function setTh(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 0, 85));
			if (n === thDeg) return;
			var before = phys();
			var frac = before.T > 0 ? tNow / before.T : 0;
			thDeg = n;
			inT.value = String(n);
			tNow = phys().T * frac;
			clampT();
			syncUI();
			draw();
		}

		/* 拖炮管: 以炮口為圓心轉，指標指到哪、炮管就指向哪 */
		function aimFromPointer(clientX, clientY) {
			var r = canvas.getBoundingClientRect();
			var dx = clientX - r.left - map.ox;
			var dy = map.oy - (clientY - r.top);
			if (dx <= 0.5) return;
			var deg = Math.atan2(dy, dx) * 180 / Math.PI;
			if (!isFinite(deg)) return;
			setTh(deg);
		}

		function timeFromPointer(clientX) {
			var p = phys();
			if (!(p.T > 0) || !(p.ux > 0.001)) return;
			var r = canvas.getBoundingClientRect();
			var xm = (clientX - r.left - map.ox) / map.s;
			var t = xm / p.ux;
			if (!isFinite(t)) return;
			tNow = ctx.clamp(t, 0, p.T);
			syncTime();
			draw();
		}

		function inCannonZone(clientX, clientY) {
			var r = canvas.getBoundingClientRect();
			var x = clientX - r.left;
			var y = clientY - r.top;
			var near = distSeg(x, y, map.bx, map.by, map.ox, map.oy) < 20;
			var nearBreech = Math.sqrt((x - map.bx) * (x - map.bx) + (y - map.by) * (y - map.by)) < 24;
			return near || nearBreech;
		}

		canvas.addEventListener('pointerdown', function (e) {
			var aim = inCannonZone(e.clientX, e.clientY);
			dragMode = aim ? 'aim' : 'time';
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒有可捕捉的指標 */ }
			e.preventDefault();
			if (aim) {
				setPlaying(false);
				aimFromPointer(e.clientX, e.clientY);
			} else {
				setPlaying(false);
				timeFromPointer(e.clientX);
			}
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragMode) return;
			e.preventDefault();
			if (dragMode === 'aim') aimFromPointer(e.clientX, e.clientY);
			else timeFromPointer(e.clientX);
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

		function setPlaying(next) {
			if (!!next === playing) return;
			playing = !!next;
			if (btnPlay) {
				var segEl = btnPlay.parentNode;
				var kids = segEl ? segEl.querySelectorAll('.dl-btn') : [];
				for (var i = 0; i < kids.length; i++) {
					var on = (kids[i] === btnPlay) === playing;
					kids[i].classList.toggle('is-on', on);
					kids[i].setAttribute('aria-pressed', on ? 'true' : 'false');
				}
			}
		}

		inU.addEventListener('input', function () { setU(parseFloat(inU.value)); });
		inT.addEventListener('input', function () { setTh(parseFloat(inT.value)); });
		inC.addEventListener('input', function () {
			var v = parseFloat(inC.value);
			if (!isFinite(v)) return;
			var p = phys();
			tNow = ctx.clamp(v, 0, p.T);
			syncTime();
			draw();
		});

		ctx.onResize(draw);

		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				var p = phys();
				if (p.T <= 0) {
					draw();
					return;
				}
				if (playing) {
					tNow += dt * SPEED;
					if (tNow >= p.T) tNow = 0;      /* 落地就從頭再飛 */
				}
				syncTime();
				draw();
			});
		}

		return { destroy: function () { canvas = null; } };
	});
})();
