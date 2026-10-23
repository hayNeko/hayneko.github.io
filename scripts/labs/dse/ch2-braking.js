/**
 * ch2-braking.js — 煞車距離為何與 v² 成正比 (DSE 物理 · II.d · 實驗 10)
 *
 * 為什麼要兩條車道: 「車速加倍, 煞車距離變四倍」用文字講是口訣; 用同一個 px/m
 * 畫成上下兩條車道, 長度差就是平方律本身 —— 上面那條是 2v 的完整煞停 (含反應
 * 距離), 固定不動; 下面那條是現在的 v, 會自己跑一遍。兩條共用同一個尺度,
 * 所以不必另外標倍數, 眼睛量得出來。
 *
 * 畫面上刻意沒有任何質量控件: 質量在 s = v²/(2μg) 裡被約掉了, 這正是本實驗
 * 要學生看見的「制動距離與質量無關」。
 *
 * 顏色: 濕柏油 / 車身 / 玻璃 / 胎痕用實色 (這是畫), UI 一律走 tokens;
 * 加色的只有「制動」這一項 —— 它才是本實驗的主角。
 */
(function () {
	'use strict';

	var G = 9.81;
	var KMH = 3.6;

	/* 畫面上的真實色彩 */
	var ASPHALT = '#3d4145';
	var ASPHALT_D = '#32363a';
	var CAR_BODY = '#3b5563';
	var CAR_HL = '#587785';
	var GLASS = '#1c2b32';
	var TYRE = '#141517';
	var LANE_MARK = 'rgba(235,232,220,0.62)';
	var SKID = 'rgba(14,15,17,0.46)';
	var SHEEN = 'rgba(226,232,236,0.05)';
	var ROAD_INK = 'rgba(242,240,233,0.92)';
	var ROAD_CHIP = 'rgba(20,22,24,0.62)';

	window.DSELab.define('braking', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */
		var vKmh = 72;
		var mu = 0.70;
		var tReact = 0.80;
		var clock = 1.78;          /* 動畫牆上時間 (s), 靜態影格停在煞停之後 */
		var view = null;
		var canvas = null;

		/* 重用物件: draw() 每幀都跑, 不該每幀配置 */
		var oLine = { color: '', width: 1, dash: null };
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

		function rrect(g, x, y, w, h, r) {
			if (r > w / 2) r = w / 2;
			if (r > h / 2) r = h / 2;
			g.beginPath();
			g.moveTo(x + r, y);
			g.arcTo(x + w, y, x + w, y + h, r);
			g.arcTo(x + w, y + h, x, y + h, r);
			g.arcTo(x, y + h, x, y, r);
			g.arcTo(x, y, x + w, y, r);
			g.closePath();
		}

		/* ---------------- 物理 ---------------- */

		var st = { v: 0, sReact: 0, sBrake: 0, total: 0, sReact2: 0, sBrake2: 0, total2: 0, tStop: 0 };

		function compute() {
			var v = vKmh / KMH;
			var denom = 2 * mu * G;            /* μ ≥ 0.3, 不會是 0 */
			st.v = v;
			st.sReact = v * tReact;
			st.sBrake = (v * v) / denom;
			st.total = st.sReact + st.sBrake;
			st.sReact2 = 2 * v * tReact;
			st.sBrake2 = 4 * st.sBrake;        /* (2v)² = 4v² */
			st.total2 = st.sReact2 + st.sBrake2;
			st.tStop = v / (mu * G);           /* 制動段本身的時間 */
			return st;
		}

		/* 煞停過程: 反應段等速 (0..0.62s), 制動段等減速 (2x − x², 0.62..1.57s) */
		function distAt(t, s) {
			var t1 = 0.62;
			var t2 = 0.95;
			if (!(t > 0)) return 0;
			if (t < t1) return s.sReact * (t / t1);
			if (t < t1 + t2) {
				var x = (t - t1) / t2;
				return s.sReact + s.sBrake * (2 * x - x * x);
			}
			return s.total;
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas');
		wrap.appendChild(canvas);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel');

		function field(label, min, max, step, val, aria) {
			var f = el('div', 'dl-field');
			f.appendChild(el('span', 'dl-field__label', label));
			var inp = el('input', 'dl-range');
			inp.type = 'range';
			inp.min = String(min);
			inp.max = String(max);
			inp.step = String(step);
			inp.value = String(val);
			inp.setAttribute('aria-label', aria || label);
			var out = el('output', 'dl-field__val', '');
			f.appendChild(inp);
			f.appendChild(out);
			return { root: f, inp: inp, out: out };
		}

		var gSpeed = el('div', 'dl-panel__group');
		gSpeed.appendChild(el('span', 'dl-panel__label', '車速'));
		var fV = field('車速 v', 20, 120, 1, vKmh, '車速（公里每小時）');
		gSpeed.appendChild(fV.root);

		var gRoad = el('div', 'dl-panel__group');
		gRoad.appendChild(el('span', 'dl-panel__label', '路面與反應'));
		var fMu = field('摩擦係數 μ', 0.3, 0.9, 0.05, mu, '輪胎與濕路面的摩擦係數');
		var fTr = field('反應時間 t_r', 0, 1.5, 0.1, tReact, '反應時間（秒）');
		gRoad.appendChild(fMu.root);
		gRoad.appendChild(fTr.root);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, v: vv };
		}

		var rds = el('div', 'dl-readouts');
		var rdV = cell('v');
		var rdBrake = cell('制動距離');
		var rdReact = cell('反應距離');
		var rdTotal = cell('總距離');
		var rdBrake2 = cell('2v 制動');
		var rdT = cell('煞停時間');
		rds.appendChild(rdV.root);
		rds.appendChild(rdBrake.root);
		rds.appendChild(rdReact.root);
		rds.appendChild(rdTotal.root);
		rds.appendChild(rdBrake2.root);
		rds.appendChild(rdT.root);

		var texBox = el('div', 'pm-tex');
		var texA = el('div', 'pm-tex__row', '');
		var texB = el('div', 'pm-tex__row', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gSpeed);
		panel.appendChild(gRoad);
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
		var NOTE = '兩條車道共用同一個比例（同一 px/m，尺上刻度就是公尺），右側四條長條也共用同一個最大值（2v 的總距離）——' +
			'長度可以直接比。斜線網底＝反應距離（駕駛者，不是煞車），實心＝制動距離。上方 2v 車道是同一 μ、t_r 下的對照: ' +
			'制動距離恰為 4 倍, 反應距離只有 2 倍, 所以總距離不是 4 倍。';
		var REDUCED = ' 已依系統設定暫停動態。';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var s = compute();

			fV.out.textContent = num(vKmh, 0) + ' km/h';
			fMu.out.textContent = num(mu, 2);
			fTr.out.textContent = num(tReact, 1) + ' s';

			rdV.v.textContent = num(s.v, 1) + ' m/s';
			rdBrake.v.textContent = num(s.sBrake, 2) + ' m';
			rdReact.v.textContent = num(s.sReact, 2) + ' m';
			rdTotal.v.textContent = num(s.total, 2) + ' m';
			rdBrake2.v.textContent = num(s.sBrake2, 1) + ' m';
			rdT.v.textContent = num(s.tStop, 2) + ' s';

			lastA = setTeX(texA, '\\( s = \\dfrac{v^2}{2\\mu g} \\)', lastA);
			lastB = setTeX(texB,
				'\\( s = \\dfrac{' + num(s.v, 1) + '^2}{2(' + num(mu, 2) + ')(' + G + ')} = ' +
				num(s.sBrake, 2) + '\\ \\mathrm{m} \\)', lastB);

			note.textContent = NOTE + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖 ---------------- */

		function drawCar(g, noseX, cy, len, wid, alpha, braking) {
			var x0 = noseX - len;
			var half = wid / 2;
			var side = Math.max(2.2, wid * 0.16);
			g.save();
			g.globalAlpha = alpha;

			/* 輪胎: 四個角伸出來的小黑塊 */
			g.fillStyle = TYRE;
			var tw = Math.max(2, len * 0.11);
			g.fillRect(x0 + len * 0.10, cy - half - side * 0.5, tw, side);
			g.fillRect(x0 + len * 0.10, cy + half - side * 0.5, tw, side);
			g.fillRect(x0 + len * 0.74, cy - half - side * 0.5, tw, side);
			g.fillRect(x0 + len * 0.74, cy + half - side * 0.5, tw, side);

			/* 車身 */
			g.fillStyle = CAR_BODY;
			rrect(g, x0, cy - half, len, wid, Math.min(6, wid * 0.3));
			g.fill();

			/* 車頂板 + 前後擋風玻璃 */
			g.fillStyle = CAR_HL;
			rrect(g, x0 + len * 0.28, cy - half * 0.62, len * 0.38, wid * 0.62, 2);
			g.fill();
			g.fillStyle = GLASS;
			rrect(g, x0 + len * 0.70, cy - half * 0.70, len * 0.13, wid * 0.70, 2);
			g.fill();
			rrect(g, x0 + len * 0.13, cy - half * 0.66, len * 0.11, wid * 0.66, 2);
			g.fill();

			if (braking) {
				g.fillStyle = 'rgba(186,58,48,0.92)';
				g.fillRect(x0 + 1, cy - half * 0.7, 2, half * 0.46);
				g.fillRect(x0 + 1, cy + half * 0.24, 2, half * 0.46);
			}
			g.restore();
		}

		function draw(g, W, H) {
			if (!g || W < 60 || H < 60) return;
			var s = compute();

			var pad = ctx.clamp(W * 0.022, 6, 14);
			var chartW = ctx.clamp(W * 0.36, 98, 220);
			var chartX = W - pad - chartW;
			var roadL = pad;
			var roadR = Math.max(roadL + 70, chartX - 12);

			var top = pad;
			var bot = H - pad;
			var gap = Math.max(5, H * 0.03);
			var laneH = Math.max(30, (bot - top - gap) / 2);

			var roadLen = roadR - roadL;
			var carLen = ctx.clamp(roadLen * 0.17, 36, 76);
			var carWid = ctx.clamp(carLen / 2.55, 12, laneH * 0.52);
			var pxPerM = (roadLen - carLen - 8) / Math.max(s.total2, 1e-6);
			var noseX0 = roadL + carLen;
			var laneY = [top, top + laneH + gap];
			var cyGhost = laneY[0] + laneH * 0.56;
			var cyNow = laneY[1] + laneH * 0.56;

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			/* ---- 車道路面 ---- */
			function laneBand(y0, y1) {
				var grad = g.createLinearGradient(0, y0, 0, y1);
				grad.addColorStop(0, ASPHALT_D);
				grad.addColorStop(0.5, ASPHALT);
				grad.addColorStop(1, ASPHALT_D);
				g.fillStyle = grad;
				g.fillRect(roadL, y0, roadLen, y1 - y0);
				/* 濕路面的反光: 幾條低透明度的橫向亮帶 */
				g.fillStyle = SHEEN;
				for (var k = 1; k <= 3; k++) {
					g.fillRect(roadL, y0 + (y1 - y0) * (k / 4) - 1.5, roadLen, 3);
				}
				g.fillStyle = LANE_MARK;
				g.fillRect(roadL, y0 + 1, roadLen, 1);
				g.fillRect(roadL, y1 - 2, roadLen, 1);
			}

			/* 胎痕: 從後輪開始煞車處拉到現在車尾的後軸 */
			function skid(yc, xa, xb, alpha) {
				if (!(xb - xa > 0.6)) return;
				var dy = carWid * 0.30;
				var th = Math.max(2.4, carWid * 0.20);
				g.save();
				g.globalAlpha = alpha;
				g.fillStyle = SKID;
				g.fillRect(xa, yc - dy - th * 0.5, xb - xa, th);
				g.fillRect(xa, yc + dy - th * 0.5, xb - xa, th);
				g.globalAlpha = alpha * 0.45;
				g.fillRect(xa, yc - dy - th * 0.5 - 1, xb - xa, th + 2);
				g.fillRect(xa, yc + dy - th * 0.5 - 1, xb - xa, th + 2);
				g.restore();
			}

			/* 反應段: 腳還沒踩下去, 所以畫斜線網底 (不是胎痕) —— 兩段貢獻在路面上就分得開 */
			function reactZone(y0, y1, reactM) {
				var xa = noseX0;
				var xb = Math.min(noseX0 + reactM * pxPerM, roadR);
				var hh = y1 - y0;
				if (xb - xa < 3 || hh < 8) return;
				g.save();
				g.beginPath();
				g.rect(xa, y0, xb - xa, hh);
				g.clip();
				g.strokeStyle = 'rgba(242,240,233,0.22)';
				g.lineWidth = 1;
				g.beginPath();
				for (var x = xa - hh; x < xb; x += 6) {
					g.moveTo(x, y1);
					g.lineTo(x + hh, y0);
				}
				g.stroke();
				g.restore();
			}

			/* 距離尺: 兩條車道共用同一個 px/m, 所以刻度位置完全相同 ——
			   讀者不必相信文字, 量刻度就知道兩條路是同一把尺 */
			function ruler(yBase) {
				var d;
				for (d = 0; d <= 250; d += 25) {
					var x = noseX0 + d * pxPerM;
					if (x > roadR - 3) break;
					var major = d % 50 === 0;
					var xr = Math.round(x) + 0.5;
					ln(g, xr, yBase, xr, yBase - (major ? 5 : 3), 'rgba(242,240,233,0.55)', 1, null);
					if (major) {
						lbl(g, d === 0 ? '0 m' : String(d), x + 3, yBase - 9,
							'rgba(242,240,233,0.78)', 10, 'left', true);
					}
				}
			}

			/* 圖例: 一小塊網底 + 文字, 讓「反應」在兩條車道上都有名字 */
			function legend(x, y, text) {
				g.save();
				g.fillStyle = 'rgba(242,240,233,0.10)';
				g.fillRect(x, y - 4.5, 9, 9);
				g.strokeStyle = 'rgba(242,240,233,0.38)';
				g.lineWidth = 1;
				g.beginPath();
				g.moveTo(x, y + 4.5);
				g.lineTo(x + 9, y - 4.5);
				g.moveTo(x + 4.5, y + 4.5);
				g.lineTo(x + 9, y + 0.5);
				g.stroke();
				g.restore();
				lbl(g, text, x + 13, y, ROAD_INK, 10, 'left', false);
			}

			/* 上方: 2v 對照 (固定不動, 半透明) */
			laneBand(laneY[0], laneY[0] + laneH);
			reactZone(laneY[0] + 7, laneY[0] + laneH - 8, s.sReact2);
			g.save();
			g.globalAlpha = 0.6;
			skid(cyGhost,
				noseX0 + s.sReact2 * pxPerM - carLen * 0.82,
				noseX0 + s.total2 * pxPerM - carLen * 0.82, 1);
			g.restore();
			drawCar(g, noseX0 + s.total2 * pxPerM, cyGhost, carLen, carWid, 0.6, false);
			ruler(laneY[0] + laneH - 6);

			/* 下方: 現在的 v, 會自己跑一遍 */
			laneBand(laneY[1], laneY[1] + laneH);
			reactZone(laneY[1] + 7, laneY[1] + laneH - 8, s.sReact);
			var dNow = distAt(clock, s);
			var noseNow = noseX0 + dNow * pxPerM;
			skid(cyNow,
				noseX0 + s.sReact * pxPerM - carLen * 0.82,
				noseNow - carLen * 0.82, 1);
			drawCar(g, noseNow, cyNow, carLen, carWid, 1, dNow > s.sReact + 1e-6);
			ruler(laneY[1] + laneH - 6);

			/* 起點刻線 + 車道說明 (速度晶片在上、圖例在下, 都不壓刻度尺) */
			ln(g, roadL + 1.5, laneY[1] + 3, roadL + 1.5, laneY[1] + laneH - 12, 'rgba(235,232,220,0.5)', 1, null);
			lbl(g, '2v = ' + num(vKmh * 2, 0) + ' km/h', roadL + 5, laneY[0] + 10, ROAD_INK, 10, 'left', true, ROAD_CHIP);
			legend(roadL + 5, laneY[0] + 24, '反應 ' + num(tReact, 1) + ' s');
			lbl(g, 'v = ' + num(vKmh, 0) + ' km/h', roadL + 5, laneY[1] + 10, ROAD_INK, 10, 'left', true, ROAD_CHIP);
			legend(roadL + 5, laneY[1] + 24, '反應 ' + num(tReact, 1) + ' s');

			/* ---- 右側長條 ---- */
			var y0 = pad + 2;
			var y1 = H - pad - 2;
			var rh = (y1 - y0) / 4;
			var bx0 = chartX;
			var bx1 = W - pad;
			var barW = Math.max(12, bx1 - bx0);
			var maxV = Math.max(s.total2, 1e-6);
			var bh = ctx.clamp(rh * 0.20, 3.5, 9);

			function rowLabel(i, label, value, strong) {
				var yy = y0 + i * rh + rh * 0.30;
				lbl(g, label, bx0, yy, strong ? C.ink : C.inkFaint, 10, 'left', false);
				lbl(g, value, bx1, yy, strong ? C.ink : C.inkFaint, 10, 'right', true);
				return yy + 6;
			}

			function seg(x, yy, w, color, alpha) {
				if (!(w > 0.4)) return;
				g.save();
				g.globalAlpha = alpha == null ? 1 : alpha;
				g.fillStyle = color;
				g.fillRect(x, yy, w, bh);
				g.restore();
			}

			/* 反應是駕駛者, 不是煞車: 長條也用斜線, 和路面的網底對得上 */
			function hatch(x, yy, w) {
				if (!(w > 0.4)) return;
				g.save();
				g.beginPath();
				g.rect(x, yy, w, bh);
				g.clip();
				g.strokeStyle = C.inkFaint;
				g.globalAlpha = 0.8;
				g.lineWidth = 1;
				g.beginPath();
				for (var xx = x - bh; xx < x + w; xx += 4) {
					g.moveTo(xx, yy + bh);
					g.lineTo(xx + bh, yy);
				}
				g.stroke();
				g.restore();
				/* 一道底線, 短條才不會讀成「沒有東西」 */
				ln(g, x, yy + bh - 0.5, x + w, yy + bh - 0.5, C.inkFaint, 1, null);
			}

			var yb;
			yb = rowLabel(0, '反應', num(s.sReact, 1) + ' m', false);
			hatch(bx0, yb, barW * ctx.clamp(s.sReact / maxV, 0, 1));

			yb = rowLabel(1, '制動', num(s.sBrake, 1) + ' m', true);
			seg(bx0, yb, barW * ctx.clamp(s.sBrake / maxV, 0, 1), C.accent, 1);

			yb = rowLabel(2, '總距離', num(s.total, 1) + ' m', true);
			var wR = barW * ctx.clamp(s.sReact / maxV, 0, 1);
			var wT = barW * ctx.clamp(s.total / maxV, 0, 1);
			hatch(bx0, yb, wR);
			seg(bx0 + wR, yb, wT - wR, C.accent, 1);

			yb = rowLabel(3, '2v 制動', num(s.sBrake2, 1) + ' m', false);
			seg(bx0, yb, barW * ctx.clamp(s.sBrake2 / maxV, 0, 1), C.accent, 0.42);
		}

		/* ---------------- 互動 ---------------- */

		function rerun() {
			syncUI();
			draw(view.ctx2d, view.w, view.h);
		}

		fV.inp.addEventListener('input', function () {
			var v = parseFloat(fV.inp.value);
			if (!isFinite(v)) return;
			vKmh = ctx.clamp(v, 20, 120);
			rerun();
		});

		fMu.inp.addEventListener('input', function () {
			var v = parseFloat(fMu.inp.value);
			if (!isFinite(v)) return;
			mu = ctx.clamp(v, 0.3, 0.9);
			rerun();
		});

		fTr.inp.addEventListener('input', function () {
			var v = parseFloat(fTr.inp.value);
			if (!isFinite(v)) return;
			tReact = ctx.clamp(v, 0, 1.5);
			rerun();
		});

		ctx.onResize(function () {
			draw(view.ctx2d, view.w, view.h);
		});

		syncUI();
		draw(view.ctx2d, view.w, view.h);

		if (!ctx.reduced) {
			var CYCLE = 2.2;
			ctx.raf(function (dt) {
				clock = (clock + dt) % CYCLE;
				draw(view.ctx2d, view.w, view.h);
			});
		}

		return { destroy: function () {} };
	});
})();
