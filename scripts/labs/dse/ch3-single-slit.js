/**
 * ch3-single-slit.js — 單縫繞射 (lab id: single-slit)
 *
 * 為什麼不每幀重算場: 168×105 格 × 9 個惠更斯點源, 每幀重算在手機上直接掉幀。
 * 只有 a、λ 或格線尺寸變了才預計算振幅與相位 (約 10 萬次點源求值), 每幀只剩
 * 一次 1024 項餘弦查表 —— 這樣才撐得住 60 fps。
 * 亮度用墨的兩級濃度 (波峰較淡、波谷較深), 不用彩虹: 這頁是紙。
 * 座標一律用「格線 px」算場, 再換算成 CSS px 畫向量覆蓋層, 兩者不混用。
 */
(function () {
	'use strict';

	var GW = 168;                  /* 格線寬: 放大到畫布時剛好糊成一片光場 */
	var LUT_N = 1024;
	var NSRC = 9;                  /* 7–13 個點源; 9 個讓預計算停在 10 萬次以內 */
	var HZ = 1.1;                  /* 畫面時基 (內部單位), 只決定條紋移動的快慢 */
	var PX_PER_UNIT = 8;           /* 1 個波長單位 = 8 格線 px */
	var LAM_MIN = 0.6, LAM_MAX = 2.0, LAM_STEP = 0.05;
	var R_MIN = 0.4, R_MAX = 6.0, R_STEP = 0.05;
	var RATIO_CLEAR = 1.5;         /* a/λ < 1.5 -> 明顯繞射 */
	var RATIO_DIRECT = 3.0;        /* a/λ > 3   -> 近似直進 */
	var WALL_FRAC = 0.38;
	var TWO_PI = Math.PI * 2;

	window.DSELab.define('single-slit', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		var st = { ratio: 2, lam: 1 };
		var gridH = 0;
		var buf = null, bufc = null, imgData = null;
		var amps = null, phases = null;
		var wallGX = 0, aG = 0;
		var dirty = true;
		var lastTex = '';
		var dragging = false;

		var lut = new Float32Array(LUT_N);
		for (var li = 0; li < LUT_N; li++) lut[li] = Math.cos(li / LUT_N * TWO_PI);

		/* 顏色的 RGB 用 1×1 畫布讀回來: 程式裡不寫死任何色值, 換紙換墨自動跟上 */
		function rgbOf(colorStr) {
			var cv = doc.createElement('canvas');
			cv.width = 1;
			cv.height = 1;
			var c2 = cv.getContext('2d');
			c2.fillStyle = colorStr;
			c2.fillRect(0, 0, 1, 1);
			var d = c2.getImageData(0, 0, 1, 1).data;
			return [d[0], d[1], d[2]];
		}
		function mix(a, b, t) {
			return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
		}
		var PAPER = rgbOf(C.paper0);
		var INK = rgbOf(C.ink);
		var CREST = mix(PAPER, INK, 0.3);      /* 波峰: 淡墨 */
		var TROUGH = mix(PAPER, INK, 0.92);    /* 波谷: 濃墨 */

		function mk(tag, cls, text) {
			var el = doc.createElement(tag);
			if (cls) el.className = cls;
			if (text != null) el.textContent = text;
			return el;
		}
		function clampNum(v, a, b) { return v < a ? a : v > b ? b : v; }

		/* ---------------------------------------------------------------- DOM */

		var grid = mk('div', 'dl-lab__grid');
		var stage = mk('div', 'dl-lab__stage');
		var wrap = mk('div', 'dl-lab__canvaswrap');
		var canvas = mk('canvas', 'dl-canvas dl-canvas--drag');
		canvas.setAttribute('role', 'img');
		canvas.setAttribute('aria-label', '單縫繞射: 縫寬接近波長時波繞到縫後整個區域');
		wrap.appendChild(canvas);
		wrap.appendChild(mk('p', 'dl-hint md-hint', '拖動縫的任一邊改縫寬'));
		stage.appendChild(wrap);
		grid.appendChild(stage);

		var panel = mk('div', 'dl-lab__panel');
		grid.appendChild(panel);

		var gGap = mk('div', 'dl-panel__group');
		gGap.appendChild(mk('span', 'dl-panel__label', '孔徑'));
		var fR = makeField('縫寬 a / λ', R_MIN, R_MAX, R_STEP, st.ratio, '', 2, onRatio);
		gGap.appendChild(fR.row);
		panel.appendChild(gGap);

		var gWave = mk('div', 'dl-panel__group');
		gWave.appendChild(mk('span', 'dl-panel__label', '波'));
		var fLam = makeField('波長 λ', LAM_MIN, LAM_MAX, LAM_STEP, st.lam, '', 2, onLam);
		gWave.appendChild(fLam.row);
		panel.appendChild(gWave);

		var roA = readout('a / λ');
		var roV = readout('級別');
		var roT = readout('第一極小 θ₁');
		roV.val.className = 'dl-readout__v md-verdict';
		var roBox = mk('div', 'dl-readouts');
		roBox.appendChild(roA.row);
		roBox.appendChild(roV.row);
		/* 只有 3 個讀數: 2 欄格線會在右下留一格空位 (畫成淺色塊), 讓這格橫跨整列 */
		roT.row.classList.add('md-readout--wide');
		roBox.appendChild(roT.row);
		panel.appendChild(roBox);

		var texEl = mk('p', 'md-formula');
		panel.appendChild(texEl);
		var note = mk('p', 'dl-note', '');
		panel.appendChild(note);

		mount.appendChild(grid);

		/* ------------------------------------------------------------ 控件 */

		function makeField(labelText, min, max, step, value, unit, digits, onInput) {
			var row = mk('div', 'dl-field');
			row.appendChild(mk('span', 'dl-field__label', labelText));
			var input = doc.createElement('input');
			input.type = 'range';
			input.className = 'dl-range';
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(value);
			input.setAttribute('aria-label', labelText);
			var out = mk('output', 'dl-field__val', value.toFixed(digits) + unit);
			input.addEventListener('input', function () {
				var val = parseFloat(input.value);
				if (!isFinite(val)) return;
				onInput(val);
			});
			row.appendChild(input);
			row.appendChild(out);
			return { row: row, input: input, out: out, digits: digits, unit: unit };
		}

		function syncField(f, value) {
			var txt = String(value);
			if (f.input.value !== txt) f.input.value = txt;
			f.out.textContent = value.toFixed(f.digits) + f.unit;
		}

		function readout(k) {
			var row = mk('span', 'dl-readout');
			row.appendChild(mk('span', 'dl-readout__k md-key', k));
			var val = mk('span', 'dl-readout__v', '—');
			row.appendChild(val);
			return { row: row, val: val };
		}

		function onRatio(val) {
			st.ratio = clampNum(val, R_MIN, R_MAX);
			dirty = true;
			refresh();
		}

		function onLam(val) {
			st.lam = clampNum(val, LAM_MIN, LAM_MAX);
			dirty = true;
			refresh();
		}

		/* ------------------------------------------------------------ 場 */

		var view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		function ensureGrid(w, h) {
			var gh = Math.round(GW * h / w);
			gh = clampNum(gh, 56, 140);
			if (gh === gridH && buf) return false;
			gridH = gh;
			buf = doc.createElement('canvas');
			buf.width = GW;
			buf.height = gridH;
			bufc = buf.getContext('2d');
			imgData = bufc.createImageData(GW, gridH);
			amps = new Float32Array(GW * gridH);
			phases = new Uint16Array(GW * gridH);
			var d = imgData.data;
			for (var i = 0; i < d.length; i += 4) {
				d[i] = PAPER[0];
				d[i + 1] = PAPER[1];
				d[i + 2] = PAPER[2];
				d[i + 3] = 255;
			}
			return true;
		}

		function precompute() {
			var lamPx = st.lam * PX_PER_UNIT;
			var kk = TWO_PI / lamPx;
			/* 縫口的 1/√r 奇異點要削掉, 否則那一格把整張場的歸一化吃掉 */
			var soft = lamPx * 0.6;
			var yc = gridH * 0.5;
			aG = clampNum(st.ratio * lamPx, 1.2, gridH * 0.86);
			var srcY = [];
			for (var s = 0; s < NSRC; s++) srcY.push(yc + (s / (NSRC - 1) - 0.5) * aG);
			wallGX = Math.round(GW * WALL_FRAC);
			amps.fill(0);
			phases.fill(0);
			var maxA = 0;
			for (var gx = wallGX + 1; gx < GW; gx++) {
				var dx = gx - wallGX;
				for (var gy = 0; gy < gridH; gy++) {
					var re = 0, im = 0;
					for (var s2 = 0; s2 < NSRC; s2++) {
						var dy = gy - srcY[s2];
						var r = Math.sqrt(dx * dx + dy * dy);
						if (r < soft) r = soft;
						var inv = 1 / Math.sqrt(r);
						var a = kk * r;
						re += Math.cos(a) * inv;
						im += Math.sin(a) * inv;
					}
					var ci = gy * GW + gx;
					var m = Math.sqrt(re * re + im * im);
					amps[ci] = m;
					if (m > maxA) maxA = m;
					phases[ci] = Math.round(Math.atan2(im, re) / TWO_PI * LUT_N) & (LUT_N - 1);
				}
			}
			var inv2 = maxA > 1e-9 ? 1 / maxA : 0;
			for (var gx2 = wallGX + 1; gx2 < GW; gx2++) {
				for (var gy2 = 0; gy2 < gridH; gy2++) {
					var ci2 = gy2 * GW + gx2;
					/* γ 壓縮: 縫口比遠處亮一個數量級, 不壓的話遠處條紋整片消失 */
					amps[ci2] = Math.pow(Math.min(1, amps[ci2] * inv2), 0.55);
				}
			}
		}

		function paintField(t) {
			var shift = (-(t * HZ) * LUT_N) | 0;
			var d = imgData.data;
			var pr = PAPER[0], pg = PAPER[1], pb = PAPER[2];
			var dcR = CREST[0] - pr, dcG = CREST[1] - pg, dcB = CREST[2] - pb;
			var dtR = TROUGH[0] - pr, dtG = TROUGH[1] - pg, dtB = TROUGH[2] - pb;
			for (var gx = wallGX + 1; gx < GW; gx++) {
				for (var gy = 0; gy < gridH; gy++) {
					var ci = gy * GW + gx;
					var v = lut[(phases[ci] + shift) & (LUT_N - 1)] * amps[ci];
					var p = ci * 4;
					if (v > 0) {
						d[p] = pr + dcR * v;
						d[p + 1] = pg + dcG * v;
						d[p + 2] = pb + dcB * v;
					} else {
						d[p] = pr - dtR * v;
						d[p + 1] = pg - dtG * v;
						d[p + 2] = pb - dtB * v;
					}
				}
			}
			bufc.putImageData(imgData, 0, 0);
		}

		/* ------------------------------------------------------------ 繪圖 */

		function draw(t) {
			var g = view.ctx2d;
			if (!g) return;
			var w = view.w, h = view.h;
			if (w < 4 || h < 4) return;
			if (ensureGrid(w, h)) dirty = true;
			if (dirty) {
				precompute();
				dirty = false;
			}
			paintField(t);

			g.save();
			g.imageSmoothingEnabled = true;
			g.drawImage(buf, 0, 0, w, h);
			g.restore();

			var wallX = wallGX * (w / GW);
			var yc = h * 0.5;
			var sy = h / gridH;
			var aCss = Math.max(2, aG * sy);
			var topY = yc - aCss / 2;
			var botY = yc + aCss / 2;

			/* 入射面波: 垂直細線, 向牆推進 */
			var lamCss = st.lam * PX_PER_UNIT * (w / GW);
			if (lamCss > 2.5) {
				var p0 = (t * HZ) % 1;
				if (!(p0 >= 0)) p0 = 0;
				g.save();
				g.strokeStyle = C.line;
				g.lineWidth = 1;
				g.setLineDash([]);
				g.beginPath();
				for (var m = 0; m < 80; m++) {
					var fx = wallX - (m + (1 - p0)) * lamCss;
					if (fx < -2) break;
					var xx = Math.round(fx) + 0.5;
					g.moveTo(xx, 0);
					g.lineTo(xx, h);
				}
				g.stroke();
				g.restore();
			}
			D.arrow(g, w * 0.045, h * 0.13, w * 0.045 + Math.min(46, w * 0.13), h * 0.13,
				{ color: C.inkDim, width: 1, head: 5 });
			D.label(g, '入射波', Math.min(w * 0.045 + Math.min(46, w * 0.13) + 7, w - 30), h * 0.13, {
				color: C.inkFaint, size: 10, mono: true, align: 'left', bg: C.paper0, pad: 2
			});

			/* 牆與縫: 幾何一定是清楚向量, 壓在光場上面 */
			var wx = Math.round(wallX) + 0.5;
			g.save();
			g.strokeStyle = C.ink;
			g.lineWidth = 2;
			g.lineCap = 'butt';
			g.setLineDash([]);
			g.beginPath();
			g.moveTo(wx, 0);
			g.lineTo(wx, Math.max(0, topY - 1));
			g.moveTo(wx, Math.min(h, botY + 1));
			g.lineTo(wx, h);
			g.stroke();
			g.strokeStyle = C.accent;
			g.lineWidth = 2;
			g.beginPath();
			g.moveTo(wallX - 8, topY);
			g.lineTo(wallX + 2, topY);
			g.moveTo(wallX - 8, botY);
			g.lineTo(wallX + 2, botY);
			g.stroke();
			g.restore();

			/* 幾何直進的兩條虛線: 沒有繞射時波只會走這一條 */
			D.dashed(g, wallX + 3, topY, w - 6, topY, { color: C.line, width: 1, dash: [4, 4] });
			D.dashed(g, wallX + 3, botY, w - 6, botY, { color: C.line, width: 1, dash: [4, 4] });

			/* a/λ > 3: 加一個 90° 的「影子」楔形, 說明能量幾乎不擴散 */
			if (st.ratio > RATIO_DIRECT) {
				var tw = Math.min(w - 10 - wallX, h * 0.5 - 10);
				if (tw > 18) {
					D.dashed(g, wallX, yc, wallX + tw, yc - tw, { color: C.lineStrong, width: 1, dash: [5, 4] });
					D.dashed(g, wallX, yc, wallX + tw, yc + tw, { color: C.lineStrong, width: 1, dash: [5, 4] });
					D.label(g, '幾乎沒有繞射',
						clampNum(wallX + tw * 0.55, 46, w - 46), clampNum(yc + tw * 0.52, 14, h - 14), {
							color: C.inkFaint, size: 10, mono: true, align: 'center', bg: C.paper0, pad: 2
						});
				}
			}

			D.handle(g, wallX, topY, { color: C.accent, fill: C.paper0, size: 9, width: 1.2 });
			D.handle(g, wallX, botY, { color: C.accent, fill: C.paper0, size: 9, width: 1.2 });

			D.label(g, 'a = ' + st.ratio.toFixed(2) + ' λ',
				clampNum(wallX + 9, 10, w - 40), clampNum(topY - 13, 12, h - 12), {
					color: C.ink, size: 10.5, mono: true, align: 'left', bg: C.paper0, pad: 2
				});
		}

		/* ------------------------------------------------------------ 更新 */

		function verdictOf(r) {
			if (r < RATIO_CLEAR) return '明顯繞射';
			if (r <= RATIO_DIRECT) return '過渡';
			return '近似直進';
		}

		function refresh() {
			/* 先畫: 格線尺寸與縫寬上限要等 ensureGrid/precompute 之後才知道 */
			draw(lastT);
			var vr = verdictOf(st.ratio);
			var th = st.ratio > 1.0 ? Math.asin(clampNum(1 / st.ratio, -1, 1)) * 180 / Math.PI : NaN;
			roA.val.textContent = st.ratio.toFixed(2);
			roV.val.textContent = vr;
			roT.val.textContent = isFinite(th) ? ctx.fmt(th, 1) + '°' : '—';

			syncField(fR, st.ratio);
			syncField(fLam, st.lam);

			var tex;
			if (st.ratio < 1.2) {
				tex = '\\( a \\approx \\lambda \\;\\Rightarrow\\; \\text{繞射最明顯} \\)';
			} else {
				tex = '\\( \\dfrac{a}{\\lambda} = ' + st.ratio.toFixed(2) + '\\qquad \\sin\\theta_1 = \\dfrac{\\lambda}{a} = ' +
					(1 / st.ratio).toFixed(2) + ' \\)';
			}
			if (tex !== lastTex) {
				lastTex = tex;
				texEl.textContent = tex;
				ctx.tex(texEl);
			}

			var nt = '繞射是波繞過障礙物邊緣；孔徑越小（相對波長）越明顯。';
			if (st.ratio * st.lam * PX_PER_UNIT > gridH * 0.86) nt += ' 縫已頂到畫布上限，a 停在這裡。';
			if (ctx.reduced) nt += ' 已依系統設定暫停動態。';
			note.textContent = nt;
		}

		/* ------------------------------------------------------------ 拖曳 */

		var lastT = 0;

		function toLocal(e) {
			var r = canvas.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };
		}

		function applyDrag(p) {
			var w = view.w, h = view.h;
			var wallX = Math.round(GW * WALL_FRAC) * (w / GW);
			var yc = h * 0.5;
			var lamCss = st.lam * PX_PER_UNIT * (w / GW);
			if (!(lamCss > 0.5)) return;
			var ratio = 2 * Math.abs(p.y - yc) / lamCss;
			ratio = Math.round(ratio / R_STEP) * R_STEP;
			st.ratio = clampNum(ratio, R_MIN, R_MAX);
			dirty = true;
			refresh();
		}

		canvas.addEventListener('pointerdown', function (e) {
			var p = toLocal(e);
			var w = view.w, h = view.h;
			var wallX = Math.round(GW * WALL_FRAC) * (w / GW);
			var yc = h * 0.5;
			var aCss = Math.max(2, aG * (h / gridH));
			if (Math.abs(p.x - wallX) > 22) return;
			if (Math.abs(p.y - yc) > aCss / 2 + 26) return;
			e.preventDefault();
			dragging = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 舊瀏覽器沒有捕獲 */ }
			applyDrag(p);
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			applyDrag(toLocal(e));
		});

		function endDrag(e) {
			if (!dragging) return;
			dragging = false;
			try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 已釋放 */ }
		}

		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);

		ctx.onResize(function () { draw(lastT); });

		/* ------------------------------------------------------------ 起跑 */

		refresh();

		if (!ctx.reduced) {
			ctx.raf(function (dt, t) {
				lastT = t;
				draw(t);
			});
		}

		return {
			destroy: function () { dragging = false; }
		};
	});
})();
