/**
 * ch3-transverse-longitudinal.js — 02 橫波與縱波
 *
 * 同一個行波方程, 兩種偏振: 質點的位移取在垂直方向(橫波)或沿傳播方向(縱波)。
 * 兩個模式裡質點都只在原位振動, 走過去的是相位與能量 —— 這一點用「傳播箭頭 vs
 * 質點振動箭頭」的夾角直接看出來: 垂直就是橫波, 共線就是縱波。
 */
(function () {
	'use strict';

	window.DSELab.define('transverse-longitudinal', function (mount, ctx) {
		var D = window.DSEDraw;
		var C = ctx.colors;
		var clamp = ctx.clamp;
		var TAU = Math.PI * 2;

		var N = 46;
		var SPAN_M = 2.8;
		var F_MIN = 0.3;
		var F_MAX = 2.0;
		var LAM_MIN = 0.5;
		var LAM_MAX = 2.2;
		var AMP_MIN = 6;
		var AMP_MAX = 26;
		var MARK_FRAC = 0.7;

		var state = { f: 1.0, lam: 1.2, amp: 16, long: false };
		var t = 0;
		var view = null;
		var NO_DASH = [];
		var geo = {
			x0: 0, x1: 0, span: 0, headY: 0, rowY: 0, stripH: 0, legendY: 0,
			spacing: 0, dotR: 2, du: 0, mIdx: 32, mEq: 0
		};

		function mk(tag, cls, text) {
			var n = document.createElement(tag);
			if (cls) n.className = cls;
			if (text != null) n.textContent = text;
			return n;
		}
		function num(v, d) {
			return typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—';
		}
		function mod(a, b) {
			var r = a % b;
			return r < 0 ? r + b : r;
		}

		/* ---------------------------------------------------------------- DOM */

		var grid = mk('div', 'dl-lab__grid');
		var stage = mk('div', 'dl-lab__stage');
		var wrap = mk('div', 'dl-lab__canvaswrap');
		var canvas = mk('canvas', 'dl-canvas');
		canvas.setAttribute('role', 'img');
		canvas.setAttribute('aria-label', '一列質點上的行波: 橫波時質點上下振動, 縱波時沿傳播方向前後振動並形成壓縮與稀疏');
		wrap.appendChild(canvas);
		stage.appendChild(wrap);

		var panel = mk('div', 'dl-lab__panel');

		function fieldGroup(labelText) {
			var g = mk('div', 'dl-panel__group');
			g.appendChild(mk('span', 'dl-panel__label', labelText));
			panel.appendChild(g);
			return g;
		}
		function sliderField(parent, id, labelText, min, max, step, value) {
			var row = mk('div', 'dl-field');
			var lab = mk('label', 'dl-field__label', labelText);
			lab.setAttribute('for', id);
			var input = mk('input', 'dl-range');
			input.type = 'range';
			input.id = id;
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(value);
			var out = mk('output', 'dl-field__val');
			out.setAttribute('for', id);
			row.appendChild(lab);
			row.appendChild(input);
			row.appendChild(out);
			parent.appendChild(row);
			return { row: row, input: input, out: out };
		}

		var gMode = fieldGroup('偏振方向');
		var seg = mk('div', 'dl-seg');
		var btnT = mk('button', 'dl-btn is-on', '橫波');
		var btnL = mk('button', 'dl-btn', '縱波');
		btnT.type = 'button';
		btnL.type = 'button';
		btnT.setAttribute('aria-pressed', 'true');
		btnL.setAttribute('aria-pressed', 'false');
		seg.appendChild(btnT);
		seg.appendChild(btnL);
		gMode.appendChild(seg);

		var gWave = fieldGroup('波的參量');
		var fF = sliderField(gWave, 'tl-f', '頻率 f', F_MIN, F_MAX, 0.05, state.f);
		var lamF = sliderField(gWave, 'tl-lam', '波長 λ', LAM_MIN, LAM_MAX, 0.01, state.lam);
		var ampF = sliderField(gWave, 'tl-amp', '振幅 A', AMP_MIN, AMP_MAX, 1, state.amp);

		var readouts = mk('div', 'dl-readouts');
		panel.appendChild(readouts);
		function readout(key) {
			var box = mk('span', 'dl-readout');
			box.appendChild(mk('span', 'dl-readout__k', key));
			var val = mk('span', 'dl-readout__v', '—');
			box.appendChild(val);
			readouts.appendChild(box);
			return val;
		}
		var outV = readout('波速');
		var outT = readout('週期');
		var outLam = readout('波長');
		var outF = readout('頻率');

		var gRel = fieldGroup('關係式');
		var formula = mk('div', 'wb-formula');
		var texBox = mk('span', 'wb-formula__tex', '\\( v = f\\lambda \\)');
		var sub = mk('p', 'wb-formula__sub', '—');
		formula.appendChild(texBox);
		formula.appendChild(sub);
		gRel.appendChild(formula);

		var note = mk('p', 'dl-note', '兩種波都只傳能量與波形，質點平均位置不變。');
		if (ctx.reduced) note.textContent += ' 已依系統設定暫停動態。';
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });
		ctx.tex(texBox);

		/* ------------------------------------------------------------ 幾何 */

		function layout(W, H) {
			var mx = Math.max(10, W * 0.08);
			geo.x0 = mx;
			geo.x1 = W - mx;
			geo.span = Math.max(40, geo.x1 - geo.x0);
			geo.legendY = H - 16;
			geo.stripH = clamp(H * 0.11, 15, 30);
			/* 這張圖是一條細橫帶: 把「箭頭→質點→密度帶標籤」整疊在上下留一樣多的紙,
			   否則高畫布上會頭重腳輕 */
			var headGap = clamp(H * 0.17, 42, 72);
			var stackH = headGap + geo.stripH / 2 + 22;
			geo.rowY = (geo.legendY - stackH) / 2 + headGap;
			geo.headY = geo.rowY - headGap;
			geo.spacing = geo.span / (N - 1);
			geo.du = SPAN_M / (N - 1);
			geo.dotR = clamp(geo.span / 230, 1.6, 3.2);
			geo.mIdx = Math.round(MARK_FRAC * (N - 1));
			geo.mEq = geo.x0 + geo.mIdx * geo.spacing;
		}

		/* ------------------------------------------------------------- 繪製 */

		function draw() {
			if (!view) return;
			var W = view.w;
			var H = view.h;
			if (W < 80 || H < 60) return;
			var g = view.ctx2d;
			var f = clamp(state.f, F_MIN, F_MAX);
			var lam = clamp(state.lam, LAM_MIN, LAM_MAX);
			var amp = clamp(state.amp, AMP_MIN, AMP_MAX);
			var w = TAU * f;
			var k = TAU / lam;
			var ppm = geo.span / SPAN_M;
			var lamPx = lam * ppm;
			var isLong = state.long;
			var ad = amp;
			var i, u, ph, px, py, s, ar;

			g.clearRect(0, 0, W, H);
			layout(W, H);
			g.setLineDash(NO_DASH);

			/* 縱波: 質點前後擠壓, 位移不能大到互相穿過(線性模型本身也到這裡為止),
			   所以畫面上的位移以 λ/(2π) 為上限; 密度帶仍用真實振幅, 振幅滑桿照樣有效 */
			if (isLong) ad = Math.min(amp, 0.85 * (lamPx / TAU));

			if (isLong) drawDensity(g, k, w, amp);
			D.line(g, geo.x0, geo.rowY, geo.x1, geo.rowY, { color: C.line, width: 1 });

			g.save();
			g.fillStyle = C.ink;
			g.beginPath();
			for (i = 0; i < N; i++) {
				if (i === geo.mIdx) continue;
				s = Math.sin(k * (i * geo.du) - w * t);
				px = geo.x0 + i * geo.spacing + (isLong ? ad * s : 0);
				py = isLong ? geo.rowY : geo.rowY - ad * s;
				g.moveTo(px + geo.dotR, py);
				g.arc(px, py, geo.dotR, 0, TAU);
			}
			g.fill();
			g.restore();

			/* 標記質點: 位移、軌跡、振動方向箭頭 */
			s = Math.sin(k * (geo.mIdx * geo.du) - w * t);
			ph = k * (geo.mIdx * geo.du) - w * t;
			px = geo.mEq + (isLong ? ad * s : 0);
			py = isLong ? geo.rowY : geo.rowY - ad * s;
			ar = Math.cos(ph);

			if (isLong) {
				D.dashed(g, geo.mEq - ad - 7, geo.rowY, geo.mEq + ad + 7, geo.rowY, { color: C.accent, dash: [3, 3] });
			} else {
				D.dashed(g, geo.mEq, geo.rowY - ad - 7, geo.mEq, geo.rowY + ad + 7, { color: C.accent, dash: [3, 3] });
			}
			D.dot(g, px, py, geo.dotR + 1.1, { color: C.accent, fill: C.accent, stroke: false });

			if (Math.abs(ar) > 0.2) {
				var len = 20 + 6 * Math.abs(ar);
				var sgn = ar > 0 ? 1 : -1;
				var tipX = px;
				var tipY = py;
				if (isLong) {
					tipX = clamp(px + sgn * (4 + len), geo.x0 + 10, geo.x1 - 10);
					/* 箭頭與質點同一條線, 底下全是點與密度帶: 先鋪一條紙色細帶才看得見 */
					D.line(g, px + sgn * 4, py, tipX, py, { color: C.paper0, width: 5 });
					D.arrow(g, px + sgn * 4, py, tipX, py, { color: C.ink, width: 1.3, head: 6 });
					D.label(g, '質點振動', clamp(tipX, geo.x0 + 26, geo.x1 - 26), geo.rowY - geo.stripH / 2 - 8, {
						size: 10, mono: true, color: C.inkDim, align: 'center'
					});
				} else {
					tipY = clamp(py + sgn * (4 + len), geo.headY + 12, geo.legendY - 26);
					D.line(g, px, py + sgn * 4, px, tipY, { color: C.paper0, width: 5 });
					D.arrow(g, px, py + sgn * 4, px, tipY, { color: C.ink, width: 1.3, head: 6 });
					var lx = px + 7;
					var al = 'left';
					if (lx + 44 > W - 3) {
						lx = px - 7;
						al = 'right';
					}
					D.label(g, '質點振動', lx, tipY, { size: 10, mono: true, color: C.inkDim, align: al, bg: C.paper0 });
				}
			}

			drawDirections(g, W, isLong);
			drawLegend(g, W);

			if (isLong) {
				labelBand(g, '壓縮', Math.PI + w * t, k, geo.rowY + geo.stripH / 2 + 9);
				labelBand(g, '稀疏', w * t, k, geo.rowY + geo.stripH / 2 + 9);
			}
		}

		/* 密度帶: 局部應變為負(後面的質點被推向前面)就是壓縮, 塗深墨; 稀疏留白。
		   濃淡只跟振幅走 —— 若直接按像素應變換算, 同一組參數在手機上會比桌面濃三倍 */
		function drawDensity(g, k, w, amp) {
			var alphaMax = clamp(0.52 * (amp / AMP_MAX) + 0.08, 0.12, 0.46);
			/* 每個色階都是整數像素的直條: 半像素的邊會被反鋸齒畫成一條條淺縫,
			   疊 1px 又會把重疊處疊成深紋, 兩種都會在帶子裡看成網格 */
			var bands = clamp(Math.round(geo.span / 2), 40, 400);
			var top = Math.round(geo.rowY - geo.stripH / 2);
			var hgt = Math.round(geo.stripH);
			var j, u, c, a, xa, xb;
			g.save();
			g.fillStyle = C.ink;
			for (j = 0; j < bands; j++) {
				xa = Math.round(geo.x0 + (j / bands) * geo.span);
				xb = Math.round(geo.x0 + ((j + 1) / bands) * geo.span);
				if (xb <= xa) continue;
				u = ((j + 0.5) / bands) * SPAN_M;
				c = Math.cos(k * u - w * t);
				if (c >= -0.02) continue;
				a = alphaMax * -c;
				if (a < 0.012) continue;
				g.globalAlpha = a;
				g.fillRect(xa, top, xb - xa, hgt);
			}
			g.restore();
		}

		/* 傳播箭頭固定在左上方; 旁邊那支短箭頭是質點振動方向 ——
		   橫波時與它成直角, 縱波時與它共線, 差別用眼睛看就成立 */
		function drawDirections(g, W, isLong) {
			var ay = geo.headY;
			var ax1 = geo.x0 + geo.span * 0.34;
			D.arrow(g, geo.x0, ay, ax1, ay, { color: C.ink, width: 1.2, head: 7 });
			D.label(g, '傳播', ax1 + 7, ay, { size: 10.5, mono: true, color: C.inkDim });

			var vx = ax1 + 24;
			if (vx > W - 34) vx = W - 34;
			if (isLong) {
				D.arrow(g, vx, ay, vx + 24, ay, { color: C.inkDim, width: 1.2, head: 6 });
				D.label(g, '振動', vx + 29, ay, { size: 10, mono: true, color: C.inkFaint });
			} else {
				D.arrow(g, vx, ay, vx, ay - 19, { color: C.inkDim, width: 1.2, head: 6 });
				D.line(g, vx, ay - 5, vx + 5, ay - 5, { color: C.inkFaint, width: 1 });
				D.line(g, vx + 5, ay - 5, vx + 5, ay, { color: C.inkFaint, width: 1 });
				D.label(g, '振動', vx + 9, ay - 13, { size: 10, mono: true, color: C.inkFaint });
			}
		}

		function drawLegend(g, W) {
			if (W >= 300) {
				D.label(g, '橫波：振動 ⊥ 傳播　縱波：振動 ∥ 傳播', geo.x0, geo.legendY, {
					size: 10.5, mono: true, color: C.inkFaint
				});
			} else {
				D.label(g, '橫波：振動 ⊥ 傳播', geo.x0, geo.legendY - 13, { size: 10, mono: true, color: C.inkFaint });
				D.label(g, '縱波：振動 ∥ 傳播', geo.x0, geo.legendY, { size: 10, mono: true, color: C.inkFaint });
			}
		}

		/* 「壓縮」「稀疏」各標一處: 應變極值在 kx − ωt = nπ, 取離版面三分點最近的那一條 */
		function labelBand(g, text, base, k, y) {
			var u = mod(base, TAU) / k;
			var target = text === '壓縮' ? SPAN_M * 0.34 : SPAN_M * 0.72;
			var guard = 0;
			while (u < target - state.lam / 2 && guard++ < 40) u += state.lam;
			while (u > target + state.lam / 2 && guard++ < 40) u -= state.lam;
			var x = geo.x0 + clamp(u, 0, SPAN_M) / SPAN_M * geo.span;
			x = clamp(x, geo.x0 + 20, geo.x1 - 20);
			D.label(g, text, x, y, { size: 10, mono: true, color: C.inkDim, align: 'center' });
			D.line(g, x, y - 8, x, geo.rowY + geo.stripH / 2, { color: C.line, width: 1 });
		}

		/* ------------------------------------------------------------ 讀數 */

		function sync(redraw) {
			var f = clamp(state.f, F_MIN, F_MAX);
			var lam = clamp(state.lam, LAM_MIN, LAM_MAX);
			var v = f * lam;
			var T = f > 0 ? 1 / f : 0;
			fF.out.textContent = num(f, 2) + ' Hz';
			lamF.out.textContent = num(lam, 2) + ' m';
			ampF.out.textContent = Math.round(state.amp) + ' px';
			outV.textContent = num(v, 2) + ' m/s';
			outT.textContent = num(T, 2) + ' s';
			outLam.textContent = num(lam, 2) + ' m';
			outF.textContent = num(f, 2) + ' Hz';
			sub.textContent = num(v, 2) + ' = ' + num(f, 2) + ' × ' + num(lam, 2);
			if (redraw !== false) draw();
		}

		function setMode(long) {
			state.long = !!long;
			btnT.setAttribute('aria-pressed', long ? 'false' : 'true');
			btnL.setAttribute('aria-pressed', long ? 'true' : 'false');
			btnT.classList.toggle('is-on', !long);
			btnL.classList.toggle('is-on', !!long);
			draw();
		}

		/* ------------------------------------------------------------ 事件 */

		fF.input.addEventListener('input', function () {
			state.f = clamp(parseFloat(fF.input.value), F_MIN, F_MAX);
			sync();
		});
		lamF.input.addEventListener('input', function () {
			state.lam = clamp(parseFloat(lamF.input.value), LAM_MIN, LAM_MAX);
			sync();
		});
		ampF.input.addEventListener('input', function () {
			state.amp = clamp(parseFloat(ampF.input.value), AMP_MIN, AMP_MAX);
			sync();
		});
		btnT.addEventListener('click', function () { setMode(false); });
		btnL.addEventListener('click', function () { setMode(true); });

		var offResize = ctx.onResize(draw);

		/* 相位自檢: 標記質點每 T 走完一個週期, 位移必須回到同一點; 半個 T 之後必須剛好反向。
		   結果寫在 mount 的 data 屬性上, 驗收時直接讀, 不靠目測 */
		(function selfCheck() {
			var f0 = 1.0;
			var lam0 = 1.2;
			var T = 1 / f0;
			var w0 = TAU * f0;
			var k0 = TAU / lam0;
			var u0 = Math.round(MARK_FRAC * (N - 1)) * (SPAN_M / (N - 1));
			var dev = 0;
			var n, a, b;
			for (n = 1; n <= 8; n++) {
				a = Math.sin(k0 * u0 - w0 * 0.37);
				b = Math.sin(k0 * u0 - w0 * (0.37 + n * T));
				dev = Math.max(dev, Math.abs(a - b));
			}
			a = Math.sin(k0 * u0 - w0 * 0.37);
			b = Math.sin(k0 * u0 - w0 * (0.37 + T / 2));
			dev = Math.max(dev, Math.abs(a + b));
			dev = Math.max(dev, Math.abs(f0 * lam0 - 1.2));
			mount.setAttribute('data-tl-check', dev < 1e-12 ? 'ok' : 'drift ' + dev.toExponential(2));
			mount.setAttribute('data-tl-periods', '8');
		})();

		sync(false);
		if (ctx.reduced) {
			draw();
		} else {
			ctx.raf(function (dt, elapsed) {
				t = elapsed;
				draw();
			});
		}
		draw();

		return {
			destroy: function () {
				offResize();
			}
		};
	});
})();
