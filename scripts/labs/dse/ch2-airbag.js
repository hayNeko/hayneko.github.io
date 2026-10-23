/**
 * ch2-airbag.js — 氣囊：延長 Δt 減小 F (DSE 物理 · II.e · 實驗 13)
 *
 * 為什麼一定要把 F–t 圖畫在同一組固定坐標軸上: 「面積就是 Δp」只有在軸不動的
 * 時候看得見。時間軸固定 0–0.45 s、力軸固定到硬擋板的峰值, 於是拉長 Δt 時
 * 曲線變矮變寬而面積不變 —— 這就是氣囊的全部物理, 不必加任何說明文字。
 *
 * 脈衝畫成對稱梯形 (升 ⅓Δt、平 ⅓Δt、降 ⅓Δt): 純三角形要在 Δt 內裝下 Δp
 * 就必須讓峰值等於 2F̄, 而本實驗的峰值約定是 1.5F̄, 兩者只有梯形能同時成立。
 *
 * 顏色: 車身 / 玻璃 / 混凝土 / 氣囊布用實色, UI 走 tokens; 加色的是氣囊那條
 * 力脈衝 —— 它才是被比較的量。
 */
(function () {
	'use strict';

	/* 畫面上的真實色彩 */
	var CAR_BODY = '#3b5563';
	var CAR_DARK = '#2c414d';
	var GLASS = '#1c2b32';
	var TYRE = '#141517';
	var WHEEL_RIM = '#8d949a';
	var WALL = '#8a857b';
	var WALL_D = '#6e6a62';
	var WALL_FACE = '#a8a29a';
	var BAG = '#ddd7c8';
	var BAG_LINE = '#a9a294';
	var BOARD = '#4b5155';
	var SKIN = '#c9a184';

	var T_RIGID = 0.02;
	var T_MAX = 0.46;          /* 時間軸固定 0–0.46 s */
	var T0 = 0.01;             /* 脈衝起點 */
	var PEAK = 1.5;

	window.DSELab.define('airbag', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */
		var scenario = 'bag';      /* bag | rigid */
		var v = 15;
		var m = 70;
		var dt = 0.20;
		var clock = 1.4;
		var view = null;
		var canvas = null;

		var oLine = { color: '', width: 1, dash: null };
		var oArrow = { color: '', width: 1.4, head: 5, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		function num(x, d) {
			if (typeof x !== 'number' || !isFinite(x)) return '—';
			return x.toFixed(d);
		}

		function kn(f) {
			if (!isFinite(f)) return '—';
			var k = f / 1000;
			return (Math.abs(k) >= 10 ? k.toFixed(1) : k.toFixed(2)) + ' kN';
		}

		function ln(g, x1, y1, x2, y2, color, width, dash) {
			oLine.color = color;
			oLine.width = width;
			oLine.dash = dash || null;
			D.line(g, x1, y1, x2, y2, oLine);
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

		var st = { dp: 0, favg: 0, peak: 0, peakRigid: 0, ratio: 1 };

		function compute() {
			st.dp = m * v;                          /* m ≥ 60, v ≥ 10 → 不會是 0 */
			st.favg = st.dp / Math.max(dt, 1e-4);
			st.peak = PEAK * st.favg;
			st.peakRigid = PEAK * st.dp / T_RIGID;
			st.ratio = dt / T_RIGID;      /* 比硬擋板「小幾倍」= Δt / 0.02 */
			return st;
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
		gMode.appendChild(el('span', 'dl-panel__label', '場景'));
		var seg = el('div', 'dl-seg');
		var btnBag = el('button', 'dl-btn', '氣囊');
		var btnRigid = el('button', 'dl-btn', '硬擋板');
		btnBag.type = 'button';
		btnRigid.type = 'button';
		btnBag.setAttribute('aria-pressed', 'true');
		btnRigid.setAttribute('aria-pressed', 'false');
		btnBag.classList.add('is-on');
		seg.appendChild(btnBag);
		seg.appendChild(btnRigid);
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

		function setRange(f, min, max, step, val, txt) {
			f.inp.min = String(min);
			f.inp.max = String(max);
			f.inp.step = String(step);
			f.inp.value = String(val);
			f.out.textContent = txt;
		}

		var gCar = el('div', 'dl-panel__group');
		gCar.appendChild(el('span', 'dl-panel__label', '碰撞前'));
		var fV = field('車速 v (m/s)');
		var fM = field('質量 m');
		gCar.appendChild(fV.root);
		gCar.appendChild(fM.root);

		var gTime = el('div', 'dl-panel__group');
		gTime.appendChild(el('span', 'dl-panel__label', '接觸時間'));
		var fDt = field('時間 Δt');
		gTime.appendChild(fDt.root);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, v: vv };
		}

		var rds = el('div', 'dl-readouts');
		var rdDp = cell('Δp');
		var rdF = cell('F_avg');
		var rdPk = cell('峰值力');
		var rdRatio = cell('比硬擋板小');
		rds.appendChild(rdDp.root);
		rds.appendChild(rdF.root);
		rds.appendChild(rdPk.root);
		rds.appendChild(rdRatio.root);

		var texBox = el('div', 'pm-tex');
		var texA = el('div', 'pm-tex__row', '');
		var texB = el('div', 'pm-tex__row', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gCar);
		panel.appendChild(gTime);
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
		var NOTE = '脈衝以對稱梯形近似（升 ⅓Δt、平 ⅓Δt、降 ⅓Δt），峰值 = 1.5 F̄，' +
			'所以曲線下面積恰為 Δp。硬擋板的 Δt 固定 0.02 s，同一張圖上比較。';
		var REDUCED = ' 已依系統設定暫停動態。';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var s = compute();
			rdDp.v.textContent = num(s.dp, 0) + ' N·s';
			rdF.v.textContent = kn(s.favg);
			rdPk.v.textContent = kn(s.peak);
			rdRatio.v.textContent = num(s.ratio, 1) + '×';
			rdRatio.v.classList.toggle('pm-mute', s.ratio <= 1.001);

			lastA = setTeX(texA, '\\( F = \\dfrac{\\Delta p}{\\Delta t} \\)', lastA);
			lastB = setTeX(texB,
				'\\( \\bar F = \\dfrac{' + num(s.dp, 0) + '}{' + num(dt, 2) + '} = ' + kn(s.favg) + '\\)', lastB);
			note.textContent = NOTE + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖 ---------------- */

		/* 對稱梯形脈衝: 面積 = (r + r)·peak = ⅔Δt · 1.5F̄ = Δp */
		function pulse(g, x0, dtS, peak, yB, mx, my, color, fillAlpha, dash, width, reveal) {
			var r = dtS / 3;
			var xa = mx(x0);
			var xb = mx(x0 + r);
			var xc = mx(x0 + 2 * r);
			var xd = mx(x0 + dtS);
			var yTop = my(peak);
			var pts = [[xa, yB], [xb, yTop], [xc, yTop], [xd, yB]];
			if (reveal != null) {
				var xr = mx(reveal);
				if (xr <= xa) return;
			}
			g.save();
			if (reveal != null) {
				g.beginPath();
				g.rect(0, 0, mx(reveal), g.canvas.height);
				g.clip();
			}
			if (fillAlpha > 0) {
				g.beginPath();
				g.moveTo(pts[0][0], pts[0][1]);
				g.lineTo(pts[1][0], pts[1][1]);
				g.lineTo(pts[2][0], pts[2][1]);
				g.lineTo(pts[3][0], pts[3][1]);
				g.closePath();
				g.globalAlpha = fillAlpha;
				g.fillStyle = color;
				g.fill();
				g.globalAlpha = 1;
			}
			g.beginPath();
			g.moveTo(pts[0][0], pts[0][1]);
			g.lineTo(pts[1][0], pts[1][1]);
			g.lineTo(pts[2][0], pts[2][1]);
			g.lineTo(pts[3][0], pts[3][1]);
			g.strokeStyle = color;
			g.lineWidth = width || 1.4;
			g.setLineDash(dash || []);
			g.stroke();
			g.setLineDash([]);
			g.restore();
		}

		/* 側面轎車: 長度先定, 其餘比例跟著長度走 (4.4 m 車長 : 1.4 m 車高) */
		function drawCar(g, noseX, len, crush, bagT, rigid, lean) {
			var Hc = len * 0.30;
			var rear = noseX - len;
			var wr = Hc * 0.21;
			var belt = Hc * 0.60;
			var roof = Hc * 0.99;

			g.save();
			/* 車身 */
			g.fillStyle = CAR_BODY;
			g.beginPath();
			g.moveTo(rear, -Hc * 0.22);
			g.lineTo(rear, -belt * 0.94);
			g.lineTo(rear + len * 0.22, -belt * 1.02);
			g.lineTo(rear + len * 0.33, -roof);
			g.lineTo(rear + len * 0.68, -roof);
			g.lineTo(rear + len * 0.82, -belt * 0.96);
			g.lineTo(noseX, -belt * (0.74 - 0.16 * crush));
			g.lineTo(noseX, -Hc * 0.18);
			g.closePath();
			g.fill();

			/* 車窗 */
			g.fillStyle = GLASS;
			g.beginPath();
			g.moveTo(rear + len * 0.36, -roof * 0.97);
			g.lineTo(rear + len * 0.66, -roof * 0.97);
			g.lineTo(rear + len * 0.76, -belt * 1.02);
			g.lineTo(rear + len * 0.36, -belt * 1.02);
			g.closePath();
			g.fill();
			/* 車頂線 */
			g.fillStyle = CAR_DARK;
			g.fillRect(rear + len * 0.33, -roof - 2, len * 0.35, 2);

			/* 車頭燈 / 尾燈 */
			g.fillStyle = '#e8e2c8';
			g.fillRect(noseX - 3, -belt * 0.72, 3, 2.5);
			g.fillStyle = '#a83a30';
			g.fillRect(rear, -belt * 0.86, 2, 3.5);

			/* 假人: 肩 + 頭 (上身前傾 = lean) */
			var dx = rear + len * 0.50 + lean * len * 0.6;
			var dy = -roof * 0.76 - lean * Hc * 0.30;
			g.fillStyle = CAR_DARK;
			g.fillRect(dx - Hc * 0.10, dy + Hc * 0.10, Hc * 0.20, Hc * 0.30);
			g.fillStyle = SKIN;
			g.beginPath();
			g.arc(dx + lean * Hc * 0.18, dy, Math.max(2.4, Hc * 0.115), 0, Math.PI * 2);
			g.fill();

			/* 氣囊: 方向盤與胸口之間 (只在氣囊情境, 由小長大) */
			if (!rigid && bagT > 0.02) {
				var bagR = Math.max(2.5, Hc * 0.26 * bagT);
				var bx = rear + len * 0.585;
				var by = -belt * 1.00;
				g.fillStyle = BAG;
				g.beginPath();
				if (g.ellipse) g.ellipse(bx, by, bagR * 1.15, bagR, 0, 0, Math.PI * 2);
				else g.arc(bx, by, bagR, 0, Math.PI * 2);
				g.fill();
				g.strokeStyle = BAG_LINE;
				g.lineWidth = 1;
				g.stroke();
			}
			g.restore();

			/* 車輪 */
			g.fillStyle = TYRE;
			g.beginPath();
			g.arc(rear + len * 0.21, -wr, wr, 0, Math.PI * 2);
			g.arc(rear + len * 0.78, -wr, wr, 0, Math.PI * 2);
			g.fill();
			g.fillStyle = WHEEL_RIM;
			g.beginPath();
			g.arc(rear + len * 0.21, -wr, wr * 0.40, 0, Math.PI * 2);
			g.arc(rear + len * 0.78, -wr, wr * 0.40, 0, Math.PI * 2);
			g.fill();
		}

		function draw(g, W, H) {
			if (!g || W < 60 || H < 60) return;
			var s = compute();

			var pad = ctx.clamp(W * 0.028, 6, 16);
			var sceneBot = H * 0.55;
			var yG = sceneBot - 6;                 /* 地面 */

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			/* ---- 時間軸 (先算, 場景與圖共用同一個 c) ---- */
			var approachWall = 0.85;
			var contactWall = 0.36 + dt * 1.5;
			var cycle = approachWall + contactWall + 0.85;
			var tw = ctx.reduced ? approachWall + contactWall * 0.72 : clock % cycle;
			var c = tw < approachWall ? 0
				: ctx.clamp((tw - approachWall) / contactWall, 0, 1);
			var approachF = tw < approachWall ? tw / approachWall : 1;

			/* ---- 場景 ---- */
			var wallW = ctx.clamp(W * 0.09, 10, 40);
			var wallX = W - pad - wallW;
			var len = ctx.clamp(W * 0.32, 96, 250);
			var hc = len * 0.30;
			var travel = Math.min(ctx.clamp(W * 0.30, 40, 190), Math.max(20, wallX - len - pad - 8));
			var rigid = scenario === 'rigid';
			var crushMax = rigid ? 0.35 : 0.85;
			var noseX = wallX - (1 - approachF) * travel;
			var crushNow = approachF >= 1 ? c * crushMax : 0;
			var bagT = rigid ? 0 : ctx.clamp(c / 0.3, 0, 1);

			/* 牆: 混凝土 + 斜線剖面 */
			g.fillStyle = WALL;
			g.fillRect(wallX, yG - hc * 1.5, wallW, hc * 1.5);
			g.fillStyle = WALL_FACE;
			g.fillRect(wallX, yG - hc * 1.5, Math.max(2, wallW * 0.18), hc * 1.5);
			g.save();
			g.beginPath();
			g.rect(wallX, yG - hc * 1.5, wallW, hc * 1.5);
			g.clip();
			g.strokeStyle = WALL_D;
			g.lineWidth = 1;
			g.beginPath();
			for (var hx = wallX - hc * 1.5; hx < wallX + wallW + hc * 1.5; hx += 9) {
				g.moveTo(hx, yG);
				g.lineTo(hx + hc * 1.5, yG - hc * 1.5);
			}
			g.stroke();
			g.restore();

			/* 硬擋板: 牆前多一塊鋼板, 讓兩情境一眼分得出來 */
			if (rigid) {
				g.fillStyle = BOARD;
				g.fillRect(wallX - 4, yG - hc * 0.9, 4, hc * 0.9);
			}

			/* 地面 */
			g.fillStyle = C.lineStrong;
			g.fillRect(pad, yG, wallX - pad, 1);

			/* 車: 先把原點搬到地面, drawCar 內部就以 y = 0 當地面前緣 */
			g.save();
			g.translate(0, yG);
			drawCar(g, noseX, len, crushNow, bagT, rigid, c * (rigid ? 0.05 : 0.03));
			g.restore();

			/* 車速標記 */
			if (approachF < 1) {
				lbl(g, 'v = ' + num(v, 1) + ' m/s', Math.max(pad + 2, noseX - len), yG - hc * 1.65,
					C.inkDim, 9.5, 'left', true);
			}

			/* ---- F–t 圖 ---- */
			var gy0 = H * 0.575;
			var gy1 = H - pad - 8;
			/* 左邊要放得下「79 kN」這種軸標, 320px 才不會被切掉 */
			var gx0 = pad + ctx.clamp(W * 0.13, 34, 58);
			var gx1 = W - pad - 4;
			if (gy1 - gy0 < 26 || gx1 - gx0 < 60) return;

			var mx = function (t) { return gx0 + (gx1 - gx0) * ctx.clamp(t / T_MAX, 0, 1); };
			var my = function (f) { return gy1 - (gy1 - gy0) * ctx.clamp(f / s.peakRigid, 0, 1); };

			/* 軸 */
			ln(g, gx0, gy0 - 6, gx0, gy1, C.lineStrong, 1, null);
			ln(g, gx0, gy1, gx1, gy1, C.lineStrong, 1, null);
			lbl(g, 'F / kN', gx0 - 4, gy0 - 9, C.inkFaint, 10, 'right', false);
			lbl(g, num(s.peakRigid / 1000, 0) + ' kN', gx0 - 4, gy0 + 5, C.inkFaint, 10, 'right', true);
			lbl(g, '0', gx0 - 3, gy1 - 5, C.inkFaint, 10, 'right', true);
			lbl(g, '0.2', mx(0.2), gy1 + 7, C.inkFaint, 10, 'center', true);
			lbl(g, '0.4 s', gx1, gy1 + 7, C.inkFaint, 10, 'right', true);
			/* 0.2 s 刻線 */
			ln(g, mx(0.2), gy1, mx(0.2), gy1 - 3, C.line, 1, null);

			/* 硬擋板: 細高、面積同樣是 Δp */
			pulse(g, T0, T_RIGID, s.peakRigid, gy1, mx, my, C.inkFaint, 0.22, [3, 3], 1.2, null);
			/* 氣囊: 矮寬; 動畫中由左往右長出來 */
			var reveal = ctx.reduced ? null : (c > 0 ? T0 + dt * c : null);
			pulse(g, T0, dt, s.peak, gy1, mx, my, C.accent, 0.16, null, 1.6, reveal);

			/* 兩條曲線的峰值: 水平虛線 + 數值 */
			D.dashed(g, gx0, my(s.peak), mx(T0 + dt) + 2, my(s.peak),
				{ color: C.accent, width: 1, dash: [3, 3] });
			lbl(g, kn(s.peak), gx0 + 2, my(s.peak) - 6, C.accent, 10, 'left', true, C.paper0);
			if (ctx.clamp(s.peak / s.peakRigid, 0, 1) < 0.22) {
				lbl(g, '同一面積 Δp', gx1, gy0 + 14, C.inkFaint, 10, 'right', false);
			}
		}

		/* ---------------- 互動 ---------------- */

		function rerun() {
			syncUI();
			draw(view.ctx2d, view.w, view.h);
		}

		function setScenario(next) {
			if (scenario === next) return;
			scenario = next;
			var isBag = scenario === 'bag';
			btnBag.classList.toggle('is-on', isBag);
			btnRigid.classList.toggle('is-on', !isBag);
			btnBag.setAttribute('aria-pressed', isBag ? 'true' : 'false');
			btnRigid.setAttribute('aria-pressed', isBag ? 'false' : 'true');
			rerun();
		}

		btnBag.addEventListener('click', function () { setScenario('bag'); });
		btnRigid.addEventListener('click', function () { setScenario('rigid'); });

		fV.inp.addEventListener('input', function () {
			var x = parseFloat(fV.inp.value);
			if (!isFinite(x)) return;
			v = ctx.clamp(x, 10, 25);
			fV.out.textContent = num(v, 1);
			rerun();
		});

		fM.inp.addEventListener('input', function () {
			var x = parseFloat(fM.inp.value);
			if (!isFinite(x)) return;
			m = ctx.clamp(x, 60, 100);
			fM.out.textContent = num(m, 0) + ' kg';
			rerun();
		});

		fDt.inp.addEventListener('input', function () {
			var x = parseFloat(fDt.inp.value);
			if (!isFinite(x)) return;
			dt = ctx.clamp(x, 0.02, 0.4);
			fDt.out.textContent = num(dt, 2) + ' s';
			rerun();
		});

		ctx.onResize(function () {
			draw(view.ctx2d, view.w, view.h);
		});

		setRange(fV, 10, 25, 0.5, v, num(v, 1));
		setRange(fM, 60, 100, 1, m, num(m, 0) + ' kg');
		setRange(fDt, 0.02, 0.4, 0.01, dt, num(dt, 2) + ' s');

		syncUI();
		draw(view.ctx2d, view.w, view.h);

		if (!ctx.reduced) {
			ctx.raf(function (d) {
				clock += d;
				draw(view.ctx2d, view.w, view.h);
			});
		}

		return { destroy: function () {} };
	});
})();
