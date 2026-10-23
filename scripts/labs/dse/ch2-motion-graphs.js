/**
 * ch2-motion-graphs.js — 運動圖像：s–t 與 v–t (DSE 物理 · II.a · 實驗 01)
 *
 * 為什麼兩張圖上下相疊、共用一條游標: 「斜率是速度、面積是位移」分開講只是兩句
 * 口訣; 疊在同一條時間軸上、同一條游標同時落在兩張圖上, 那個對應關係就變成
 * 看得見的同一個時刻 —— 游標一動, 斜率、面積、車的位置一起動。
 *
 * u 與 a 只決定曲線; t 只由使用者決定, 不自己跑。畫面上唯一會動的是掃過 0..t
 * 的淡游標, 它只負責提醒「這兩點是同一個時刻」, 不影響任何數值。
 */
(function () {
	'use strict';

	var T_MAX = 10;            /* 兩張圖共用的時間軸 (s) */

	window.DSELab.define('motion-graphs', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */

		var u = 0;             /* 初速 m/s */
		var a = 2;             /* 加速度 m/s² */
		var tC = 5;            /* 游標時間 s */
		var phase = 0;         /* 只驅動淡游標 */
		var dragging = false;

		var view = null;
		var canvas = null;

		/* draw() 算出來的時間軸像素範圍; 拖曳時反查時間用 */
		var lay = { x0: 1, x1: 2 };

		/* 重用樣式物件: draw() 每幀跑, 不要每幀配新的 */
		var oLine = { color: '', width: 1, dash: null };
		var oArrow = { color: '', width: 1.4, head: 7, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };
		var oDot = { color: '', fill: '', stroke: false, width: 1 };
		var oTag = { color: '', fill: '', size: 10 };

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		/* 固定小數位: 讀數與畫布上的字同一個寫法, 而且 0.0 不會變成 -0.0 */
		function num(v, d) {
			if (typeof v !== 'number' || !isFinite(v)) return '—';
			if (Math.abs(v) < 5e-4) v = 0;
			return v.toFixed(d);
		}

		function ln(g, x1, y1, x2, y2, color, width, dash) {
			oLine.color = color;
			oLine.width = width;
			oLine.dash = dash || null;
			D.line(g, x1, y1, x2, y2, oLine);
		}

		function arw(g, x1, y1, x2, y2, color, width, head) {
			oArrow.color = color;
			oArrow.width = width;
			oArrow.head = head;
			oArrow.dash = null;
			D.arrow(g, x1, y1, x2, y2, oArrow);
		}

		function lbl(g, text, x, y, color, size, align, baseline, bg) {
			oLabel.color = color;
			oLabel.size = size;
			oLabel.align = align || 'left';
			oLabel.baseline = baseline || 'middle';
			oLabel.mono = true;
			oLabel.bg = bg || null;
			D.label(g, text, x, y, oLabel);
		}

		function dot(g, x, y, r, color) {
			oDot.color = color;
			oDot.fill = color;
			oDot.stroke = false;
			oDot.width = 1;
			D.dot(g, x, y, r, oDot);
		}

		/* ---------------- 物理 ---------------- */

		function sOf(t) { return u * t + 0.5 * a * t * t; }
		function vOf(t) { return u + a * t; }

		/* 兩張圖的縱軸範圍: 由同一組樣本決定, 曲線才不會被裁掉 */
		var env = { s0: 0, s1: 1, v0: 0, v1: 1 };

		function measure() {
			var s0 = 0, s1 = 0, v0 = 0, v1 = 0, i, t, s, v;
			for (i = 0; i <= 200; i++) {
				t = T_MAX * i / 200;
				s = sOf(t);
				v = vOf(t);
				if (s < s0) s0 = s;
				if (s > s1) s1 = s;
				if (v < v0) v0 = v;
				if (v > v1) v1 = v;
			}
			var ps = Math.max(1, (s1 - s0) * 0.12);
			var pv = Math.max(1, (v1 - v0) * 0.14);
			env.s0 = s0 - ps;
			env.s1 = s1 + ps;
			env.v0 = v0 - pv;
			env.v1 = v1 + pv;
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		var hint = el('p', 'dl-hint', '拖動畫布任何位置設定時間游標');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel');

		function field(labelTxt, ariaTxt, min, max, step, val) {
			var f = el('div', 'dl-field');
			f.appendChild(el('span', 'dl-field__label', labelTxt));
			var inp = el('input', 'dl-range');
			inp.type = 'range';
			inp.min = String(min);
			inp.max = String(max);
			inp.step = String(step);
			inp.value = String(val);
			inp.setAttribute('aria-label', ariaTxt);
			var out = el('output', 'dl-field__val', '');
			f.appendChild(inp);
			f.appendChild(out);
			return { root: f, inp: inp, out: out };
		}

		var gInit = el('div', 'dl-panel__group');
		gInit.appendChild(el('span', 'dl-panel__label', '初始條件'));
		var fU = field('初速 u', '初速 u（米每秒）', -8, 20, 0.5, u);
		var fA = field('加速度 a', '加速度 a（米每二次方秒）', -6, 6, 0.1, a);
		gInit.appendChild(fU.root);
		gInit.appendChild(fA.root);

		var gT = el('div', 'dl-panel__group');
		gT.appendChild(el('span', 'dl-panel__label', '時間游標'));
		var fT = field('時間 t', '時間 t（秒）', 0, T_MAX, 0.05, tC);
		gT.appendChild(fT.root);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}

		var rds = el('div', 'dl-readouts kn-rd');
		var rdV = cell('v(t)');
		var rdS = cell('s(t)');
		var rdK = cell('斜率 ds/dt');
		var rdA = cell('面積');
		var rdD = cell('方向');
		rdD.root.classList.add('kn-wide');
		rds.appendChild(rdV.root);
		rds.appendChild(rdS.root);
		rds.appendChild(rdK.root);
		rds.appendChild(rdA.root);
		rds.appendChild(rdD.root);

		var texBox = el('div', 'kn-formula');
		var texA = el('div', 'kn-formula__tex', '');
		var texB = el('p', 'kn-formula__sub', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gInit);
		panel.appendChild(gT);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 ---------------- */

		var NOTE = '滑桿定 u 與 a，游標定 t：同一個 t 在第一張圖給斜率、在第二張圖給面積，兩個數就是 v(t) 與 s(t)。';
		var REDUCED = ' 已依系統設定暫停動態。';

		var lastA = '';

		function syncUI() {
			var v = vOf(tC);
			var s = sOf(tC);
			var still = Math.abs(v) < 0.05;

			fU.out.textContent = num(u, 1) + ' m/s';
			fA.out.textContent = num(a, 1) + ' m/s²';
			fT.out.textContent = num(tC, 2) + ' s';

			rdV.v.textContent = num(v, 1) + ' m/s';
			rdS.v.textContent = num(s, 1) + ' m';
			rdK.v.textContent = num(v, 1) + ' m/s';
			rdA.v.textContent = num(s, 1) + ' m';
			rdD.v.textContent = still ? '瞬時靜止' : (v > 0 ? '向右 · 前進' : '向左 · 反向');
			rdV.v.classList.toggle('kn-acc', !still);
			rdA.v.classList.toggle('kn-acc', true);
			rdD.v.classList.toggle('kn-mute', still);

			var tex = '\\( v = u + at = ' + num(v, 1) + '\\ \\mathrm{m\\,s^{-1}} \\)　' +
				'\\( s = ut + \\tfrac{1}{2}at^{2} = ' + num(s, 1) + '\\ \\mathrm{m} \\)';
			if (tex !== lastA) {
				texA.textContent = tex;
				ctx.tex(texA);
				lastA = tex;
			}
			texB.textContent = 't = ' + num(tC, 2) + ' s ·' +
				' 斜率 ' + num(vOf(tC), 1) + ' m/s ·' +
				' 面積 ' + num(sOf(tC), 1) + ' m';
			note.textContent = NOTE + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖 ---------------- */

		function roundRectPath(g, x, y, w, h, r) {
			g.beginPath();
			g.moveTo(x + r, y);
			g.lineTo(x + w - r, y);
			g.quadraticCurveTo(x + w, y, x + w, y + r);
			g.lineTo(x + w, y + h - r);
			g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
			g.lineTo(x + r, y + h);
			g.quadraticCurveTo(x, y + h, x, y + h - r);
			g.lineTo(x, y + r);
			g.quadraticCurveTo(x, y, x + r, y);
			g.closePath();
		}

		/* 側面汽車: 原點在車身中心的「地面接觸點」, 車頭朝 +x。
		   mirror = true 時整台車左右翻, 倒車才不會看起來還在往前開。 */
		function car(g, cx, gy, w, mirror) {
			var h = w * 0.44;
			var r = Math.max(1.6, w * 0.098);
			var i;
			g.save();
			g.translate(cx, gy);
			if (mirror) g.scale(-1, 1);

			/* 車身 */
			g.beginPath();
			g.moveTo(-w * 0.47, -h * 0.24);
			g.lineTo(-w * 0.50, -h * 0.50);
			g.lineTo(-w * 0.36, -h * 0.56);
			g.lineTo(-w * 0.21, -h * 0.94);
			g.lineTo(w * 0.10, -h * 0.96);
			g.lineTo(w * 0.26, -h * 0.58);
			g.lineTo(w * 0.47, -h * 0.53);
			g.lineTo(w * 0.50, -h * 0.24);
			g.closePath();
			g.fillStyle = '#3d6076';
			g.fill();
			g.strokeStyle = 'rgba(20, 17, 13, 0.6)';
			g.lineWidth = 1;
			g.stroke();

			/* 車窗 */
			g.beginPath();
			g.moveTo(-w * 0.18, -h * 0.88);
			g.lineTo(w * 0.08, -h * 0.90);
			g.lineTo(w * 0.21, -h * 0.62);
			g.lineTo(-w * 0.25, -h * 0.60);
			g.closePath();
			g.fillStyle = '#c8d4d9';
			g.fill();

			/* 前燈: 只有車頭那一端有, 倒車時會跟著翻到左邊 */
			g.fillStyle = '#e8d9a8';
			g.fillRect(w * 0.42, -h * 0.47, w * 0.07, Math.max(1.4, h * 0.12));

			/* 輪子 */
			for (i = -1; i <= 1; i += 2) {
				g.beginPath();
				g.arc(i * w * 0.30, -r, r, 0, Math.PI * 2);
				g.fillStyle = '#26231f';
				g.fill();
				g.beginPath();
				g.arc(i * w * 0.30, -r, Math.max(0.7, r * 0.38), 0, Math.PI * 2);
				g.fillStyle = '#a9a396';
				g.fill();
			}
			g.restore();
		}

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 40 || H < 40) return;

			measure();

			var m = ctx.clamp(Math.min(W, H) * 0.045, 7, 16);
			var mBot = m + 24;      /* 底部留給 .dl-hint 疊字, 時間軸刻度才不會被蓋掉 */
			var innerH = H - m - mBot;
			var bandR = innerH * 0.26;
			var bandS = innerH * 0.37;
			var bandV = innerH - bandR - bandS;
			var yR0 = m;
			var yS0 = yR0 + bandR;
			var yV0 = yS0 + bandS;
			var bot = H - mBot;
			var gut = W < 420 ? 27 : 33;
			var x0 = m + gut;
			var x1 = W - m;
			var span = Math.max(20, x1 - x0);

			lay.x0 = x0;
			lay.x1 = x1;

			var padT = bandS > 92 ? 20 : 15;   /* 矮畫布上這 5 px 就是整張圖的高度 */
			var topS = yS0 + padT;
			var botS = yS0 + bandS - 3;
			var topV = yV0 + padT;
			var botV = yV0 + bandV - 12;

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			function yS(v) { return botS - (v - env.s0) / (env.s1 - env.s0) * (botS - topS); }
			function yV(v) { return botV - (v - env.v0) / (env.v1 - env.v0) * (botV - topV); }
			function xT(t) { return x0 + ctx.clamp(t / T_MAX, 0, 1) * span; }

			/* --- (a) 路面與車 --- */
			var roadY = yR0 + bandR * 0.60;
			var surfY = Math.round(roadY) + 0.5;
			var asph = ctx.clamp(bandR * 0.10, 3, 6);
			var vRowY = Math.round(yR0 + bandR * 0.11) + 0.5;
			var aRowY = Math.round(yR0 + bandR * 0.30) + 0.5;

			g.fillStyle = '#4b4842';
			g.fillRect(m, surfY, W - 2 * m, asph);
			ln(g, m, surfY + 0.5, W - m, surfY + 0.5, 'rgba(250, 248, 244, 0.35)', 1, null);

			/* 距離刻度: 主刻度帶數字, 5 m 的次刻度只在畫得下時出現 */
			function xS(s) { return m + (s - env.s0) / (env.s1 - env.s0) * (W - 2 * m); }
			var dSpan = env.s1 - env.s0;
			var minor = 5;
			var minorPx = minor / dSpan * (W - 2 * m);
			var labelStep = 5;
			var steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
			for (var si = 0; si < steps.length; si++) {
				labelStep = steps[si];
				if (dSpan / labelStep <= 5) break;
			}
			var tickTop = surfY + asph;
			var tickLab = Math.min(yR0 + bandR - 2, tickTop + 17);   /* 留在路面帶內, 不要壓到下一格的字 */

			var firstD = Math.ceil(env.s0 / minor) * minor;
			for (var d = firstD; d <= env.s1 + 1e-9; d += minor) {
				var xd = xS(d);
				if (xd < m + 1 || xd > W - m - 1) continue;
				var major = Math.abs(d / labelStep - Math.round(d / labelStep)) < 1e-6;
				if (!major && minorPx < 3) continue;
				ln(g, xd, tickTop, xd, tickTop + (major ? 5 : 3), major ? C.inkDim : C.inkFaint, 1, null);
				if (major && labelStep <= 1000) {
					lbl(g, num(d, 0), xd, tickLab + 4, C.inkFaint, 10, 'center', 'bottom');
				}
			}
			lbl(g, '距離 / m', W - m - 1, yR0 + 7, C.inkFaint, 10, 'right', 'middle');

			/* 車: 由游標時間決定位置 */
			var sNow = sOf(tC);
			var vNow = vOf(tC);
			var carW = ctx.clamp(roadY - aRowY - 8, 7, 22) / 0.44;
			carW = ctx.clamp(carW, 18, 58);
			var carH = carW * 0.44;
			var cx = ctx.clamp(xS(sNow), m + carW * 0.5, W - m - carW * 0.5);
			car(g, cx, surfY, carW, vNow < 0);

			/* 速度箭頭: 長度 ∝ |v|, 方向看正負 */
			var vMaxAbs = Math.max(Math.abs(env.v0), Math.abs(env.v1), 1);
			var vLen = ctx.clamp(Math.abs(vNow) / vMaxAbs * (W - 2 * m) * 0.30, 10, (W - 2 * m) * 0.34);
			if (Math.abs(vNow) > 0.05) {
				var dir = vNow > 0 ? 1 : -1;
				var vx = cx + dir * (carW * 0.5 + 3);
				var vx2 = ctx.clamp(vx + dir * vLen, m + 4, W - m - 4);
				arw(g, vx, vRowY, vx2, vRowY, C.accent, 1.6, 7);
				lbl(g, 'v = ' + num(Math.abs(vNow), 1) + ' m/s', vx2 + dir * 4, vRowY,
					C.accent, 10, dir > 0 ? 'left' : 'right', 'middle');
			} else {
				lbl(g, 'v = 0', cx, vRowY, C.accent, 10, 'center', 'middle');
			}

			/* 加速度箭頭: 只在 a ≠ 0 時出現, 比較短、用墨色 */
			if (Math.abs(a) > 1e-9) {
				var ad = a > 0 ? 1 : -1;
				var ax = cx + ad * (carW * 0.5 + 3);
				var aLen = ctx.clamp(Math.abs(a) / 6 * (W - 2 * m) * 0.17, 8, (W - 2 * m) * 0.20);
				var ax2 = ctx.clamp(ax + ad * aLen, m + 4, W - m - 4);
				arw(g, ax, aRowY, ax2, aRowY, C.inkDim, 1.2, 6);
				lbl(g, 'a = ' + num(a, 1) + ' m/s²', ax2 + ad * 4, aRowY,
					C.inkDim, 10, ad > 0 ? 'left' : 'right', 'middle');
			}

			/* --- (b) s–t --- */
			ln(g, x0, yS(0), x1, yS(0), C.line, 1, null);
			ln(g, x0, topS, x0, botS, C.lineFaint || C.line, 1, null);
			lbl(g, 's / m', x1, yS0 + 7, C.inkFaint, 10, 'right', 'middle');
			lbl(g, num(env.s1, 0), x0 - 5, topS, C.inkFaint, 10, 'right', 'middle');
			lbl(g, num(env.s0, 0), x0 - 5, botS, C.inkFaint, 10, 'right', 'middle');

			/* 曲線每 3 px 取一點; xa..xb 決定這一段是「已發生」還是「還沒到」 */
			function curvePath(map, val, xa, xb) {
				g.beginPath();
				var x = xa, started = false;
				for (; x < xb; x += 3) {
					var t = (x - x0) / span * T_MAX;
					var y = map(val(t));
					if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
				}
				g.lineTo(xb, map(val((xb - x0) / span * T_MAX)));
			}

			function strokeSeg(xa, xb, color, width, dash) {
				if (xb - xa < 0.5) return;
				g.strokeStyle = color;
				g.lineWidth = width;
				g.lineJoin = 'round';
				g.setLineDash(dash || []);
				g.stroke();
				g.setLineDash([]);
			}

			g.save();
			g.beginPath();
			g.rect(x0, topS - 1, span, botS - topS + 2);
			g.clip();

			var xs = xT(tC);
			curvePath(yS, sOf, x0, xs);
			strokeSeg(x0, xs, C.ink, 1.7, null);
			curvePath(yS, sOf, xs, x1);
			strokeSeg(xs, x1, C.inkFaint, 1.2, [4, 4]);

			/* 切線: 斜率 = 此刻的 v, 超出圖框就縮短, 不留斷頭線 */
			var slope = vNow * (botS - topS) / (env.s1 - env.s0) / (span / T_MAX);
			var ysC = yS(sNow);
			var half = Math.min(46, span * 0.22);
			var p1x = xs - half, p1y = ysC - slope * half;
			var p2x = xs + half, p2y = ysC + slope * half;
			for (var guard = 0; guard < 6; guard++) {
				if (p1y > topS && p1y < botS && p2y > topS && p2y < botS) break;
				half *= 0.62;
				p1x = xs - half; p1y = ysC - slope * half;
				p2x = xs + half; p2y = ysC + slope * half;
				if (half < 5) break;
			}
			ln(g, p1x, ctx.clamp(p1y, topS, botS), p2x, ctx.clamp(p2y, topS, botS), C.accent, 1.3, [5, 3]);
			dot(g, xs, ysC, 3, C.accent);

			g.restore();

			/* 斜率的字: 放在切線那一端沒有曲線的一側 */
			var slopeTxt = '斜率 = v = ' + num(vNow, 1) + ' m/s';
			var sLeft = xs > x0 + span * 0.55;
			lbl(g, slopeTxt, sLeft ? xs - 6 : xs + 6, ctx.clamp(ysC - 14, topS + 6, botS - 6),
				C.accent, 10, sLeft ? 'right' : 'left', 'middle', C.paper0);

			/* 折返點 v = 0 */
			if (Math.abs(a) > 1e-9) {
				var tz = -u / a;
				if (tz > 0.1 && tz < T_MAX - 0.1) {
					var tzx = xT(tz);
					var tzy = yS(sOf(tz));
					oTag.color = C.inkDim;
					oTag.fill = C.paper0;
					oTag.size = 10;
					D.tag(g, 'v = 0', ctx.clamp(tzx, x0 + 20, x1 - 20), ctx.clamp(tzy + 13, topS + 8, botS - 8), oTag);
				}
			}

			/* --- (c) v–t --- */
			var yZero = yV(0);
			ln(g, x0, yZero, x1, yZero, C.line, 1, null);
			ln(g, x0, topV, x0, botV, C.line, 1, null);
			lbl(g, 'v / m s⁻¹', x1, yV0 + 7, C.inkFaint, 10, 'right', 'middle');
			lbl(g, num(env.v1, 0), x0 - 5, topV, C.inkFaint, 10, 'right', 'middle');
			lbl(g, num(env.v0, 0), x0 - 5, botV, C.inkFaint, 10, 'right', 'middle');

			/* 面積: 0..t 之間, 依 v 的正負分段 —— 反向位移要看得出來 */
			var tCross = Math.abs(a) > 1e-9 ? -u / a : NaN;
			var cut = (isFinite(tCross) && tCross > 0.001 && tCross < tC - 0.001) ? tCross : -1;
			var segs = cut > 0 ? [[0, cut], [cut, tC]] : [[0, tC]];
			for (var k = 0; k < segs.length; k++) {
				var ta = segs[k][0], tb = segs[k][1];
				if (tb - ta < 1e-6) continue;
				var vMid = vOf((ta + tb) / 2);
				g.save();
				g.beginPath();
				g.moveTo(xT(ta), yZero);
				g.lineTo(xT(ta), yV(vOf(ta)));
				var n = Math.max(2, Math.ceil((xT(tb) - xT(ta)) / 3));
				for (var q = 1; q <= n; q++) {
					var tq = ta + (tb - ta) * q / n;
					g.lineTo(xT(tq), yV(vOf(tq)));
				}
				g.lineTo(xT(tb), yZero);
				g.closePath();
				if (vMid >= 0) {
					g.fillStyle = 'rgba(' + C.accentRgb + ', 0.15)';
					g.fill();
				} else {
					g.clip();
					g.strokeStyle = 'rgba(' + C.accentRgb + ', 0.30)';
					g.lineWidth = 1;
					var bb = { y: Math.min(yZero, yV(vOf(ta)), yV(vOf(tb))) - 2, h: Math.abs(yV(vOf(ta)) - yZero) + 4 };
					for (var hx = xT(ta) - bb.h; hx < xT(tb) + bb.h; hx += 5) {
						g.beginPath();
						g.moveTo(hx, bb.y + bb.h);
						g.lineTo(hx + bb.h, bb.y);
						g.stroke();
					}
				}
				g.restore();
				g.save();
				g.beginPath();
				g.moveTo(xT(ta), yZero);
				g.lineTo(xT(ta), yV(vOf(ta)));
				g.lineTo(xT(tb), yV(vOf(tb)));
				g.lineTo(xT(tb), yZero);
				g.strokeStyle = C.accent;
				g.lineWidth = 1;
				g.stroke();
				g.restore();
			}

			g.save();
			g.beginPath();
			g.rect(x0, topV - 1, span, botV - topV + 2);
			g.clip();
			curvePath(yV, vOf, x0, xs);
			strokeSeg(x0, xs, C.ink, 1.7, null);
			curvePath(yV, vOf, xs, x1);
			strokeSeg(xs, x1, C.inkFaint, 1.2, [4, 4]);
			dot(g, xs, yV(vNow), 3, C.accent);
			g.restore();

			var areaTxt = '面積 = s = ' + num(sNow, 1) + ' m';
			var aRight = xs > x0 + span * 0.55;
			lbl(g, areaTxt, aRight ? xs - 6 : xs + 6, ctx.clamp(yZero < (topV + botV) / 2 ? botV - 6 : topV + 6, topV + 6, botV - 6),
				C.accent, 10, aRight ? 'right' : 'left', 'middle', C.paper0);

			/* 共用的時間軸 */
			var tStep = W < 420 ? 2 : 1;
			for (var tk = 0; tk <= T_MAX + 1e-9; tk += tStep) {
				var tkx = xT(tk);
				ln(g, tkx, botV, tkx, botV + 3, C.inkFaint, 1, null);
				if (tk > 0 && (tk % (tStep * 2) === 0 || Math.abs(tk - T_MAX) < 1e-9)) {
					lbl(g, num(tk, 0), tkx, botV + 12, C.inkFaint, 10, 'center', 'middle');
				}
			}
			/* 原點那一格留給軸名: 兩者疊在同一個位置就會糊成一團 */
			lbl(g, 't / s', x0 - 6, botV + 12, C.inkFaint, 10, 'right', 'middle');

			/* 貫穿三段的时间游標 */
			ln(g, xs, yR0 + 2, xs, botV, C.accent, 1.2, [3, 3]);
			dot(g, xs, botS + 0.5, 2.4, C.accent);

			/* 淡游標: 只示範「同一時刻」, 不影響任何數值 */
			if (!ctx.reduced && tC > 0.2) {
				var cyc = phase % 1.3;
				var kk = cyc > 1 ? 1 : cyc;
				var tgx = xT(tC * kk);
				g.save();
				g.strokeStyle = 'rgba(' + C.accentRgb + ', 0.42)';
				g.lineWidth = 1;
				g.setLineDash([2, 4]);
				g.beginPath();
				g.moveTo(tgx, yS0 + 2);
				g.lineTo(tgx, botV);
				g.stroke();
				g.restore();
				dot(g, tgx, yS(sOf(tC * kk)), 2.4, 'rgba(' + C.accentRgb + ', 0.55)');
				dot(g, tgx, yV(vOf(tC * kk)), 2.4, 'rgba(' + C.accentRgb + ', 0.55)');
			}
		}

		/* ---------------- 互動 ---------------- */

		function setU(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, -8, 20) * 2) / 2;
			if (n === u) return;
			u = n;
			fU.inp.value = String(n);
			syncUI();
			draw();
		}

		function setA(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, -6, 6) * 10) / 10;
			if (n === a) return;
			a = n;
			fA.inp.value = String(n);
			syncUI();
			draw();
		}

		function setT(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 0, T_MAX) * 20) / 20;
			if (n === tC) return;
			tC = n;
			fT.inp.value = String(n);
			syncUI();
			draw();
		}

		function tFromPointer(e) {
			var r = canvas.getBoundingClientRect();
			var px = e.clientX - r.left;
			var k = (px - lay.x0) / Math.max(1, lay.x1 - lay.x0);
			return ctx.clamp(k, 0, 1) * T_MAX;
		}

		var listeners = [];

		function on(target, type, fn) {
			target.addEventListener(type, fn);
			listeners.push([target, type, fn]);
		}

		on(canvas, 'pointerdown', function (e) {
			dragging = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件沒有可捕捉的指標 */ }
			e.preventDefault();
			setT(tFromPointer(e));
		});

		on(canvas, 'pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			setT(tFromPointer(e));
		});

		function endDrag(e) {
			if (!dragging) return;
			dragging = false;
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
				canvas.releasePointerCapture(e.pointerId);
			}
		}
		on(canvas, 'pointerup', endDrag);
		on(canvas, 'pointercancel', endDrag);

		on(fU.inp, 'input', function () { setU(parseFloat(fU.inp.value)); });
		on(fA.inp, 'input', function () { setA(parseFloat(fA.inp.value)); });
		on(fT.inp, 'input', function () { setT(parseFloat(fT.inp.value)); });

		var offResize = ctx.onResize(draw);

		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				phase = (phase + dt) % 1.3;
				draw();
			});
		}

		return {
			destroy: function () {
				var i;
				for (i = 0; i < listeners.length; i++) {
					listeners[i][0].removeEventListener(listeners[i][1], listeners[i][2]);
				}
				listeners.length = 0;
				if (typeof offResize === 'function') offResize();
			}
		};
	});
})();
