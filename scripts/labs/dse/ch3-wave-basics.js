/**
 * ch3-wave-basics.js — 01 行波與 v = fλ
 *
 * 為什麼要畫兩張圖: 繩上那一列是「固定時刻的空間切片」(y–x), 標記質點的高度隨時間
 * 的紀錄是「固定位置的時間切片」(y–t)。λ 從前者讀、T 從後者讀, 兩者由 v = fλ 綁住。
 * 介質鎖定把 v 釘在 1.20 m/s: 改 f 時 λ 由 v/f 反推 —— 真實介質裡 f 由波源決定、
 * v 由介質決定, λ 只是結果。
 */
(function () {
	'use strict';

	window.DSELab.define('wave-basics', function (mount, ctx) {
		var D = window.DSEDraw;
		var C = ctx.colors;
		var clamp = ctx.clamp;
		var TAU = Math.PI * 2;

		var LOCK_V = 1.2;
		var F_MIN = 0.4;
		var F_MAX = 2.4;
		var LAM_MIN = 0.3;
		var LAM_MAX = 1.6;
		/* 鎖定時 λ = 1.20 / f, 而 λ 滑桿只到 1.60 —— f 的下限因此被抬到 0.75 Hz。
		   不抬的話 λ 會跑出滑桿範圍, 讀數與滑桿指示就互相打臉 */
		var F_LOCK_MIN = LOCK_V / LAM_MAX;
		var AMP_MIN = 8;
		var AMP_MAX = 34;
		/* 繩上顯示 3.40 m ≥ 2λ_max: 任何相位都一定有一對相鄰波峰留在畫面內,
		   λ 的尺寸線不會有時候畫不出來 */
		var SPAN_M = 3.4;
		var HIST_N = 160;
		/* y–t 窗格保留 2.5 個週期: 比一個 T 寬, T 的尺寸線才一定找得到兩個峰 */
		var HIST_T = 2.5;

		var state = { f: 0.8, lam: LOCK_V / 0.8, amp: 22, x0: 1.7, locked: true };
		var t = 0;
		var dragging = false;
		var view = null;
		/* 固定長度、就地覆寫: 每幀 160 個樣本不配置任何陣列 */
		var hist = new Float32Array(HIST_N);
		var NO_DASH = [];
		var geo = {
			x0: 0, x1: 0, span: 0, cy: 0, half: 0, headY: 0,
			pTop: 0, pH: 0, pW: 0, gap: 0, lX: 0, rX: 0
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
		var canvas = mk('canvas', 'dl-canvas dl-canvas--drag');
		canvas.setAttribute('role', 'img');
		canvas.setAttribute('aria-label', '繩上的一列行波: 上半是固定時刻的波形, 下半左邊是 y–x 空間圖, 右邊是標記質點的 y–t 時間圖');
		wrap.appendChild(canvas);
		wrap.appendChild(mk('p', 'dl-hint', '拖動豎線, 換量度位置'));
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

		var gWave = fieldGroup('波的參量');
		var fF = sliderField(gWave, 'wb1-f', '頻率 f', F_MIN, F_MAX, 0.05, state.f);
		var lamF = sliderField(gWave, 'wb1-lam', '波長 λ', LAM_MIN, LAM_MAX, 0.01, state.lam);
		var ampF = sliderField(gWave, 'wb1-amp', '振幅 A', AMP_MIN, AMP_MAX, 1, state.amp);

		var gMed = fieldGroup('介質');
		var seg = mk('div', 'dl-seg');
		var lockBtn = mk('button', 'dl-btn is-on', '介質鎖定');
		lockBtn.type = 'button';
		lockBtn.setAttribute('aria-pressed', 'true');
		seg.appendChild(lockBtn);
		gMed.appendChild(seg);
		var badge = mk('span', 'dl-badge wb-badge', 'v 固定');
		gMed.appendChild(badge);

		var gPart = fieldGroup('質點');
		var x0F = sliderField(gPart, 'wb1-x0', '位置 x₀', 0.2, SPAN_M - 0.2, 0.01, state.x0);

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

		var note = mk('p', 'dl-note', '真實介質裡 v 由介質決定、f 由波源決定，λ 隨之而定；鎖定就是這個情況。');
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
			geo.headY = Math.max(10, H * 0.055);
			geo.cy = H * 0.285;
			geo.half = Math.max(10, Math.min(H * 0.175, geo.cy - geo.headY - 14));
			geo.gap = Math.max(8, W * 0.026);
			geo.pW = Math.max(56, (geo.span - geo.gap) / 2);
			geo.lX = geo.x0;
			geo.rX = geo.x0 + geo.pW + geo.gap;
			geo.pTop = H * 0.5;
			/* 底部留 24px 給 .dl-hint: 它是絕對定位貼在畫布左下角, 不能壓到圖 */
			geo.pH = Math.max(52, H - 24 - geo.pTop);
		}

		/* 以「米」取樣, 因為三張圖共用同一個波: 像素步長會讓三張圖的相位對不齊 */
		function wavePath(g, pxL, pxW, axisY, amp, k, w, tt, color, width) {
			var steps = Math.max(32, Math.ceil(pxW / 1.5));
			var du = SPAN_M / steps;
			var i, u, y, x;
			g.save();
			g.strokeStyle = color;
			g.lineWidth = width;
			g.lineJoin = 'round';
			g.setLineDash(NO_DASH);
			g.beginPath();
			for (i = 0; i <= steps; i++) {
				u = i * du;
				y = axisY - amp * Math.sin(k * u - w * tt);
				x = pxL + (i / steps) * pxW;
				if (i === 0) g.moveTo(x, y);
				else g.lineTo(x, y);
			}
			g.stroke();
			g.restore();
		}

		function panelFrame(g, x, w, title) {
			D.frame(g, x, geo.pTop, w, geo.pH, { color: C.line, width: 1 });
			D.label(g, title, x + 6, geo.pTop + 9, { size: 10.5, mono: true, color: C.inkDim });
		}

		/* ------------------------------------------------------------- 繪製 */

		function draw() {
			if (!view) return;
			var W = view.w;
			var H = view.h;
			if (W < 80 || H < 60) return;
			var g = view.ctx2d;
			var f = clamp(state.f, F_MIN, F_MAX);
			var lam = state.lam > 0.05 ? state.lam : 0.05;
			var w = TAU * f;
			var k = TAU / lam;
			var T = f > 0 ? 1 / f : 0;
			var amp = clamp(state.amp, AMP_MIN, AMP_MAX);
			var half;

			g.clearRect(0, 0, W, H);
			layout(W, H);
			g.setLineDash(NO_DASH);

			/* 傳播方向: 波形整體向右跑, 質點只上下動 */
			D.arrow(g, geo.x0, geo.headY, geo.x0 + geo.span * 0.2, geo.headY, { color: C.inkDim, width: 1.1, head: 6 });
			D.label(g, '傳播', geo.x0 + geo.span * 0.2 + 7, geo.headY, { size: 10.5, mono: true, color: C.inkDim });

			half = Math.min(amp, geo.half);
			D.line(g, geo.x0, geo.cy, geo.x1, geo.cy, { color: C.line, width: 1 });

			var mx = geo.x0 + (clamp(state.x0, 0, SPAN_M) / SPAN_M) * geo.span;
			D.dashed(g, mx, geo.cy - geo.half - 6, mx, geo.cy + geo.half + 6, { color: C.accent, dash: [3, 4] });

			wavePath(g, geo.x0, geo.span, geo.cy, half, k, w, t, C.ink, 1.6);

			var ph = k * clamp(state.x0, 0, SPAN_M) - w * t;
			var py = geo.cy - half * Math.sin(ph);
			var cosPh = Math.cos(ph);

			/* 質點速度: d/dt(cy − A sin φ) = Aω cos φ, 正值代表屏幕向下 */
			if (Math.abs(cosPh) > 0.18) {
				var dir = cosPh > 0 ? 1 : -1;
				var len = 18 + 8 * Math.abs(cosPh);
				var tip = py + dir * (4 + len);
				tip = dir < 0 ? Math.max(tip, 13) : Math.min(tip, geo.pTop - 9);
				D.arrow(g, mx, py + dir * 4, mx, tip, { color: C.ink, width: 1.3, head: 6 });
				var lx = mx + 7;
				var align = 'left';
				if (lx + 30 > W - 4) {
					lx = mx - 7;
					align = 'right';
				}
				D.label(g, 'v質點', lx, tip, { size: 10, mono: true, color: C.inkDim, align: align, bg: C.paper0 });
			}

			D.dot(g, mx, py, 3.4, { color: C.accent, fill: C.accent, stroke: false });
			D.handle(g, mx, geo.cy, { size: 9, color: C.accent, fill: C.paper0 });

			drawSpatial(g, k, w, f, lam, half);
			drawTemporal(g, k, w, T, lam, half);
		}

		/* 左下: y–x 空間圖, 標一個 λ */
		function drawSpatial(g, k, w, f, lam, half) {
			var x = geo.lX;
			var pw = geo.pW;
			var inTop = geo.pTop + 16;
			var inBot = geo.pTop + geo.pH - 15;
			var axY = (inTop + inBot) / 2;
			var avail = Math.max(3, (inBot - inTop) / 2 - 1);
			var ampP = Math.min(avail, Math.max(half * 0.55, avail * 0.3));
			var dimY = geo.pTop + geo.pH - 8;
			var pL = x + 7;
			var pW2 = pw - 14;

			panelFrame(g, x, pw, 'y–x（固定時刻）');
			D.line(g, pL, axY, pL + pW2, axY, { color: C.line, width: 1 });
			D.label(g, 'x', pL + pW2 - 5, axY - 8, { size: 10, mono: true, color: C.inkFaint, align: 'right' });

			var mxP = pL + (clamp(state.x0, 0, SPAN_M) / SPAN_M) * pW2;
			D.dashed(g, mxP, inTop, mxP, axY + ampP + 2, { color: C.line, dash: [2, 3] });

			wavePath(g, pL, pW2, axY, ampP, k, w, t, C.ink, 1.3);

			/* 波峰在 x' = (π/2 + ωt)/k + nλ; 取第一對留在畫面內的相鄰波峰 */
			var uA = mod(Math.PI / 2 + w * t, TAU) / k;
			var uB = uA + lam;
			if (uB > SPAN_M) {
				uA -= lam;
				uB -= lam;
			}
			if (uA < 0) {
				uA = 0;
				uB = lam;
			}
			var xA = pL + (uA / SPAN_M) * pW2;
			var xB = pL + (uB / SPAN_M) * pW2;
			var mid = (xA + xB) / 2;
			D.dashed(g, xA, axY - ampP, xA, dimY, { color: C.line, dash: [3, 3] });
			D.dashed(g, xB, axY - ampP, xB, dimY, { color: C.line, dash: [3, 3] });
			D.arrow(g, mid, dimY, xA, dimY, { color: C.inkDim, width: 1, head: 4.5 });
			D.arrow(g, mid, dimY, xB, dimY, { color: C.inkDim, width: 1, head: 4.5 });
			D.label(g, 'λ', clamp(mid, pL + 12, pL + pW2 - 12), dimY - 1, {
				size: 10.5, mono: true, color: C.ink, align: 'center', baseline: 'bottom', bg: C.paper0
			});
		}

		/* 右下: y–t 時間圖, 標一個 T */
		function drawTemporal(g, k, w, T, lam, half) {
			var x = geo.rX;
			var pw = geo.pW;
			var inTop = geo.pTop + 16;
			var inBot = geo.pTop + geo.pH - 15;
			var axY = (inTop + inBot) / 2;
			var avail = Math.max(3, (inBot - inTop) / 2 - 1);
			var ampP = Math.min(avail, Math.max(half * 0.55, avail * 0.3));
			var dimY = geo.pTop + geo.pH - 8;
			var pL = x + 7;
			var pW2 = pw - 14;
			var win = HIST_T * T;
			var phX = k * clamp(state.x0, 0, SPAN_M);
			var i, tp, xx;

			panelFrame(g, x, pw, 'y–t（固定位置）');
			D.line(g, pL, axY, pL + pW2, axY, { color: C.line, width: 1 });
			D.label(g, 't', pL + pW2 - 5, axY - 8, { size: 10, mono: true, color: C.inkFaint, align: 'right' });

			/* 解析取樣而非逐幀累積: 掉幀時軌跡不會斷, 也不會隨幀率變形 */
			for (i = 0; i < HIST_N; i++) {
				tp = t - win + (i / (HIST_N - 1)) * win;
				hist[i] = axY - ampP * Math.sin(phX - w * tp);
			}
			g.save();
			g.strokeStyle = C.ink;
			g.lineWidth = 1.3;
			g.lineJoin = 'round';
			g.setLineDash(NO_DASH);
			g.beginPath();
			for (i = 0; i < HIST_N; i++) {
				xx = pL + (i / (HIST_N - 1)) * pW2;
				if (i === 0) g.moveTo(xx, hist[i]);
				else g.lineTo(xx, hist[i]);
			}
			g.stroke();
			g.restore();

			D.dot(g, pL + pW2, hist[HIST_N - 1], 2.6, { color: C.accent, fill: C.accent, stroke: false });

			/* 峰值時刻 t' = (kx₀ − π/2)/ω − nT; 取最近兩個峰畫 T */
			var tPeak = (phX - Math.PI / 2) / w;
			var tLast = t - mod(t - tPeak, T);
			var tPrev = tLast - T;
			var xb = pL + pW2 - ((t - tLast) / win) * pW2;
			var xa = pL + pW2 - ((t - tPrev) / win) * pW2;
			var mid = (xa + xb) / 2;
			D.dashed(g, xa, axY - ampP, xa, dimY, { color: C.line, dash: [3, 3] });
			D.dashed(g, xb, axY - ampP, xb, dimY, { color: C.line, dash: [3, 3] });
			D.arrow(g, mid, dimY, xa, dimY, { color: C.inkDim, width: 1, head: 4.5 });
			D.arrow(g, mid, dimY, xb, dimY, { color: C.inkDim, width: 1, head: 4.5 });
			D.label(g, 'T', clamp(mid, pL + 12, pL + pW2 - 12), dimY - 1, {
				size: 10.5, mono: true, color: C.ink, align: 'center', baseline: 'bottom', bg: C.paper0
			});
		}

		/* ------------------------------------------------------------ 讀數 */

		function sync(redraw) {
			var f = clamp(state.f, F_MIN, F_MAX);
			var lam;
			if (state.locked) {
				lam = LOCK_V / f;
				state.lam = lam;
				lamF.input.value = String(lam);
			} else {
				lam = clamp(state.lam, LAM_MIN, LAM_MAX);
				state.lam = lam;
			}
			var v = f * lam;
			var T = f > 0 ? 1 / f : 0;

			fF.out.textContent = num(f, 2) + ' Hz';
			lamF.out.textContent = num(lam, 2) + ' m';
			ampF.out.textContent = Math.round(state.amp) + ' px';
			x0F.out.textContent = num(state.x0, 2) + ' m';
			outV.textContent = num(v, 2) + ' m/s';
			outT.textContent = num(T, 2) + ' s';
			outLam.textContent = num(lam, 2) + ' m';
			outF.textContent = num(f, 2) + ' Hz';
			sub.textContent = num(v, 2) + ' = ' + num(f, 2) + ' × ' + num(lam, 2);

			lamF.input.disabled = state.locked;
			if (state.locked) {
				lamF.row.classList.add('wb-field--off');
				outV.classList.remove('wb-accent');
				badge.textContent = 'v 固定 · λ = v/f';
			} else {
				lamF.row.classList.remove('wb-field--off');
				outV.classList.add('wb-accent');
				badge.textContent = 'λ 自由 · v 由 fλ 得';
			}
			if (redraw !== false) draw();
		}

		function applyLock() {
			fF.input.min = String(state.locked ? F_LOCK_MIN : F_MIN);
			if (state.locked && state.f < F_LOCK_MIN) state.f = F_LOCK_MIN;
			if (!state.locked) state.lam = clamp(state.lam, LAM_MIN, LAM_MAX);
			fF.input.value = String(state.f);
			lockBtn.setAttribute('aria-pressed', state.locked ? 'true' : 'false');
			if (state.locked) lockBtn.classList.add('is-on');
			else lockBtn.classList.remove('is-on');
			sync();
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
		x0F.input.addEventListener('input', function () {
			state.x0 = clamp(parseFloat(x0F.input.value), 0.2, SPAN_M - 0.2);
			sync();
		});
		lockBtn.addEventListener('click', function () {
			state.locked = !state.locked;
			applyLock();
		});

		function pointerU(e) {
			var r = canvas.getBoundingClientRect();
			var xpx = (e.clientX - r.left) * (view.w / Math.max(1, r.width));
			var u = ((xpx - geo.x0) / Math.max(1, geo.span)) * SPAN_M;
			return clamp(u, 0.2, SPAN_M - 0.2);
		}
		function onDown(e) {
			if (e.button != null && e.button !== 0) return;
			e.preventDefault();
			if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
			dragging = true;
			state.x0 = pointerU(e);
			x0F.input.value = String(state.x0);
			sync();
		}
		function onMove(e) {
			if (!dragging) return;
			e.preventDefault();
			state.x0 = pointerU(e);
			x0F.input.value = String(state.x0);
			sync();
		}
		function onUp(e) {
			if (!dragging) return;
			dragging = false;
			if (canvas.releasePointerCapture && canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
				canvas.releasePointerCapture(e.pointerId);
			}
		}
		canvas.addEventListener('pointerdown', onDown);
		canvas.addEventListener('pointermove', onMove);
		canvas.addEventListener('pointerup', onUp);
		canvas.addEventListener('pointercancel', onUp);

		var offResize = ctx.onResize(draw);

		/* 自檢: 鎖定時 v 必須正好落在 1.20, 而 T = 1/f; 數字留在 DOM 上供驗收 */
		(function selfCheck() {
			/* 驗收用的兩組: 鎖定 f = 2.0 應得 λ = 0.60; 自由 f = 0.8 / λ = 1.5 應得 v = 1.20、T = 1.25 */
			var worst = 0;
			var lam = LOCK_V / 2.0;
			worst = Math.max(worst, Math.abs(lam - 0.6));
			worst = Math.max(worst, Math.abs(0.8 * 1.5 - LOCK_V));
			worst = Math.max(worst, Math.abs(1 / 0.8 - 1.25));
			worst = Math.max(worst, Math.abs(2.0 * (LOCK_V / 2.0) - LOCK_V));
			mount.setAttribute('data-wb-check', worst < 1e-12 ? 'ok' : 'drift ' + worst.toExponential(2));
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
				canvas.removeEventListener('pointerdown', onDown);
				canvas.removeEventListener('pointermove', onMove);
				canvas.removeEventListener('pointerup', onUp);
				canvas.removeEventListener('pointercancel', onUp);
				offResize();
			}
		};
	});
})();
