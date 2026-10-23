/**
 * ch2-ticker-tape.js — 打點計時器與汽車 0–100 (DSE 物理 · II.a · 實驗 02)
 *
 * 為什麼要兩個模式共用一組公式: 紙帶上「點距變大」就是加速度, 汽車「幾秒破百」
 * 是同一條 v = u + at 的另一次求解。兩個畫面用同一個 a 滑桿, 學生才會發現自己
 * 算的是同一件事。
 *
 * 紙帶照真實比例畫 (1 cm = 10 px): 第一格只有 0.4 mm, 在紙帶上不到一個像素 ——
 * 這不是畫不出來, 而是「一開始真的看不出來」。所以上方另外給一格放大圖,
 * 把起頭三個間距拉開來看; 主紙帶則捲到最新那一點, 那裡一格已經好幾公分。
 */
(function () {
	'use strict';

	var T_TICK = 0.02;               /* 50 Hz */
	var PX_PER_M = 1000;             /* 1 cm = 10 px */
	var V100 = 100 / 3.6;            /* 100 km/h = 27.777… m/s */
	var TAPE_RUN = 0.7;              /* 紙帶跑 0.7 s = 35 點: 再長就只剩最尾幾格, 再短就看不到捲動 */

	window.DSELab.define('ticker-tape', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		/* ---------------- 狀態 ---------------- */

		var mode = 'tape';       /* tape | car */
		var u = 0;               /* 紙帶初速 m/s */
		var aT = 2;              /* 紙帶加速度 m/s² */
		var aC = 6;              /* 汽車加速度 m/s² */
		var prog = ctx.reduced ? 1 : 0;   /* 0..1, 動畫進度; 靜止時直接停在 1 */
		var frame = 0;

		var view = null;
		var canvas = null;

		var oLine = { color: '', width: 1, dash: null };
		var oLabel = { color: '', size: 10, align: 'left', baseline: 'middle', mono: true, bg: null, pad: 3 };
		var oDot = { color: '', fill: '', stroke: false, width: 1 };
		var oHandle = { color: '', fill: '', size: 8, width: 1.2 };

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

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

		/* 一個間距的夾具: 兩端短豎線 + 底線 */
		function bracket(g, x1, x2, y, h, color) {
			var lo = Math.min(x1, x2);
			var hi = Math.max(x1, x2);
			ln(g, lo, y - h, lo, y, color, 1, null);
			ln(g, lo, y, hi, y, color, 1, null);
			ln(g, hi, y - h, hi, y, color, 1, null);
		}

		/* ---------------- 物理 ---------------- */

		var aNow = function () { return mode === 'tape' ? aT : aC; };

		/* 第 n 點 (n·T 秒) 的位置, 公尺 */
		function dotAt(n, uu, aa) {
			var t = n * T_TICK;
			return uu * t + 0.5 * aa * t * t;
		}

		/* 第 n 個間距, 公釐 */
		function gapMm(n) {
			var uu = mode === 'tape' ? u : 0;
			return (dotAt(n, uu, aNow()) - dotAt(n - 1, uu, aNow())) * 1000;
		}

		function t100() {
			var a = aNow();
			return a > 0 ? V100 / a : NaN;
		}

		function s100() {
			var a = aNow();
			return a > 0 ? V100 * V100 / (2 * a) : NaN;
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
		var btnTape = el('button', 'dl-btn is-on', '紙帶');
		var btnCar = el('button', 'dl-btn', '汽車');
		btnTape.type = 'button';
		btnCar.type = 'button';
		btnTape.setAttribute('aria-pressed', 'true');
		btnCar.setAttribute('aria-pressed', 'false');
		seg.appendChild(btnTape);
		seg.appendChild(btnCar);
		gMode.appendChild(seg);

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

		var gIn = el('div', 'dl-panel__group');
		gIn.appendChild(el('span', 'dl-panel__label', '初始條件'));
		var fU = field('初速 u', '紙帶初速（米每秒）', 0, 3, 0.1, u);
		var fA = field('加速度 a', '加速度（米每二次方秒）', 0, 6, 0.1, aT);
		gIn.appendChild(fU.root);
		gIn.appendChild(fA.root);

		var gPlay = el('div', 'dl-panel__group');
		gPlay.appendChild(el('span', 'dl-panel__label', '重播'));
		var btnReplay = el('button', 'dl-btn', '由 t = 0 重新播放');
		btnReplay.type = 'button';
		gPlay.appendChild(btnReplay);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}

		var rds = el('div', 'dl-readouts kn-rd');
		var rdGap = cell('每點間距');
		var rdAvg = cell('平均速度 v̄');
		var rdT = cell('到 100 km/h');
		var rdS = cell('所需距離');
		rds.appendChild(rdGap.root);
		rds.appendChild(rdAvg.root);
		rds.appendChild(rdT.root);
		rds.appendChild(rdS.root);

		var texBox = el('div', 'kn-formula');
		var texA = el('div', 'kn-formula__tex', '\\( v = u + at \\)　\\( s = ut + \\tfrac{1}{2}at^{2} \\)');
		var texB = el('p', 'kn-formula__sub', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);
		ctx.tex(texA);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gIn);
		panel.appendChild(gPlay);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 ---------------- */

		var REDUCED = ' 已依系統設定暫停動態。';
		var NOTE_TAPE = '兩點之間固定 0.02 s，所以「點距變大」就是速度變大；a > 0 時每個間距比前一個多 aT² = 0.0004a m（a = 2 時多 0.8 mm）。';
		var NOTE_CAR = '汽車由靜止起步，v–t 圖是一條過原點的斜直線，線下面積就是它跑過的距離。';
		var NOTE_STILL = ' a = 0：等速，間距不再變大。';

		var lastSub = '';

		function syncUI() {
			var aa = aNow();
			var g1 = gapMm(1);
			var nNow = Math.floor(prog * TAPE_RUN / T_TICK);
			var avgTape = nNow >= 1
				? (dotAt(nNow, u, aT) - dotAt(nNow - 1, u, aT)) / T_TICK
				: u;
			var tStr = t100();
			var sStr = s100();
			var carT = isFinite(tStr) ? tStr * prog : NaN;
			var avgCar = carT > 0.15 ? 0.5 * aa * carT : NaN;

			fU.out.textContent = num(u, 1) + ' m/s';
			fA.out.textContent = num(aa, 1) + ' m/s²';

			rdGap.v.textContent = num(g1, 1) + ' mm';
			rdGap.v.classList.toggle('kn-mute', g1 < 0.05);
			rdAvg.v.textContent = num(mode === 'tape' ? avgTape : avgCar, 2) + ' m/s';
			rdT.v.textContent = isFinite(tStr) ? num(tStr, 2) + ' s' : '—';
			rdS.v.textContent = isFinite(sStr) ? num(sStr, 1) + ' m' : '—';
			rdT.v.classList.toggle('kn-mute', !isFinite(tStr));
			rdS.v.classList.toggle('kn-mute', !isFinite(sStr));
			rdS.v.classList.toggle('kn-acc', isFinite(sStr));

			var sub;
			if (mode === 'tape') {
				sub = 'T = 0.02 s · 起頭三間距 ' + num(gapMm(1), 1) + ' / ' + num(gapMm(2), 1) + ' / ' +
					num(gapMm(3), 1) + ' mm（每格 +' + num(gapMm(2) - gapMm(1), 1) + ' mm）';
			} else {
				sub = '0–100：t = 27.78 / ' + num(aa, 1) + ' = ' + (isFinite(tStr) ? num(tStr, 2) : '—') +
					' s · s = 27.78² / (2a) = ' + (isFinite(sStr) ? num(sStr, 1) : '—') + ' m';
			}
			if (sub !== lastSub) {
				texB.textContent = sub;
				lastSub = sub;
			}

			var base = mode === 'tape' ? NOTE_TAPE : NOTE_CAR;
			if (aa <= 0) base += NOTE_STILL;
			note.textContent = base + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖: 紙帶 ---------------- */

		function drawTape(g, W, H, m, innerH, mBot) {
			var innerW = W - 2 * m;
			var small = W < 520;
			var bandA = innerH * 0.30;
			var yA0 = m;
			var yB0 = yA0 + bandA;
			var yB1 = H - mBot;
			var bandB = yB1 - yB0;

			/* --- (a) 起頭三間距的放大圖: 紙帶上 0.4 mm 不到一個像素, 這裡拉開才看得到 --- */
			lbl(g, small ? '起頭三間距 · mm（放大）' : '起頭三間距 · mm（紙帶上不到 1 px，這裡拉開看）',
				m, yA0 + 6, C.inkFaint, 10, 'left', 'middle');

			var g1 = gapMm(1), g2 = gapMm(2), g3 = gapMm(3);
			var tot = g1 + g2 + g3;
			var detY = yA0 + bandA * 0.48;
			if (tot > 1e-6) {
				var xStart = m + 4;
				var availW = Math.max(40, innerW - (small ? 54 : 96));
				var zoom = availW / tot;
				var zx1 = xStart + g1 * zoom;
				var zx2 = zx1 + g2 * zoom;
				var zx3 = zx2 + g3 * zoom;

				ln(g, xStart, detY, zx3, detY, C.line, 1, null);
				var tk = Math.max(6, bandA * 0.11);
				ln(g, xStart, detY - tk, xStart, detY + tk, C.inkDim, 1, null);
				ln(g, zx1, detY - tk, zx1, detY + tk, C.inkDim, 1, null);
				ln(g, zx2, detY - tk, zx2, detY + tk, C.inkDim, 1, null);
				ln(g, zx3, detY - tk, zx3, detY + tk, C.inkDim, 1, null);

				var brY = detY + tk + 3;
				bracket(g, xStart, zx1, brY, 4, C.accent);
				bracket(g, zx1, zx2, brY, 4, C.accent);
				bracket(g, zx2, zx3, brY, 4, C.accent);
				var ly = brY + 9;
				lbl(g, num(g1, 1), Math.max(m + 11, (xStart + zx1) / 2), ly, C.accent, 10, 'center', 'middle');
				lbl(g, num(g2, 1), (zx1 + zx2) / 2, ly, C.accent, 10, 'center', 'middle');
				lbl(g, num(g3, 1), Math.min(W - m - 11, (zx2 + zx3) / 2), ly, C.accent, 10, 'center', 'middle');
				lbl(g, '縮放 ×' + num(zoom, 0), W - m - 1, yA0 + 6, C.inkFaint, 10, 'right', 'middle');
			} else {
				lbl(g, 'a = 0：間距不變，每格都是 ' + num(gapMm(1), 1) + ' mm',
					m + 4, detY + 12, C.inkFaint, 10, 'left', 'middle');
			}

			/* --- (b) 主紙帶: 最新一點貼右緣, 其餘往左捲 --- */
			var stripTop = yB0 + bandB * 0.14;
			var stripH = ctx.clamp(bandB * 0.30, 26, 76);
			var stripBot = stripTop + stripH;
			var baseY = Math.round((stripTop + stripBot) / 2) + 0.5;

			g.fillStyle = '#e7dfcd';
			g.fillRect(m, stripTop, innerW, stripH);
			ln(g, m, stripTop + 0.5, W - m, stripTop + 0.5, 'rgba(20, 17, 13, 0.35)', 1, null);
			ln(g, m, stripBot - 0.5, W - m, stripBot - 0.5, 'rgba(20, 17, 13, 0.22)', 1, null);

			var xR = W - m - 8;
			var xL = m + 3;
			var nMax = Math.max(0, Math.floor(prog * TAPE_RUN / T_TICK + 1e-9));
			var sNow = dotAt(nMax, u, aT);
			var n, x, sN;

			for (n = nMax; n >= 0; n--) {
				sN = dotAt(n, u, aT);
				x = xR - (sNow - sN) * PX_PER_M;
				if (x < xL) break;
				dot(g, x, baseY, n === nMax ? 3 : 2.2, C.ink);
			}

			/* 目前最新的那一格: 夾具 + 平均速度 */
			if (nMax >= 1) {
				var xPrev = xR - (sNow - dotAt(nMax - 1, u, aT)) * PX_PER_M;
				if (xPrev > xL + 4) {
					var brY2 = stripBot + 9;
					bracket(g, xPrev, xR, brY2, 5, C.accent);
					var vAvg = (sNow - dotAt(nMax - 1, u, aT)) / T_TICK;
					var halfTxt = small ? 52 : 62;
					var midX = ctx.clamp((xPrev + xR) / 2, m + halfTxt, W - m - halfTxt);
					lbl(g, 'v̄ = Δs/T = ' + num(vAvg, 2) + ' m/s', midX, brY2 + 11, C.accent, 10, 'center', 'middle');
				}
			}

			/* 說明列: 補掉紙帶下方那一段空白, 順便把「怎麼讀」講完 */
			lbl(g, small ? '每格 0.02 s，越往右越寬' : '每一格都是 0.02 s：往右越寬 = 速度越大',
				m + 3, stripBot + 40, C.inkFaint, 10, 'left', 'middle');
			/* 窄畫布上這一行會壓到上面那格的 mm 標籤, 而它只是補充資訊, 直接省掉 */
			if (!small) {
				lbl(g, 'T = 0.02 s · 已跑 ' + num(nMax * T_TICK, 2) + ' s · ' + nMax + ' 點',
					W - m - 1, stripTop - 8, C.inkFaint, 10, 'right', 'middle');
			}

			/* 比例尺: 貼右下角, 字放在尺的上方 —— 左下角要留給上面那句說明 */
			var sbLen = Math.min(100, innerW * 0.36);
			var sbX = W - m - 3 - sbLen;
			var sbY = Math.min(yB1 - 8, stripBot + 66);   /* 桌面版這一段很高, 比例尺跟著紙帶走, 不要沉到底 */
			ln(g, sbX, sbY, sbX + sbLen, sbY, C.inkDim, 1.4, null);
			ln(g, sbX, sbY - 4, sbX, sbY + 4, C.inkDim, 1.4, null);
			ln(g, sbX + sbLen, sbY - 4, sbX + sbLen, sbY + 4, C.inkDim, 1.4, null);
			lbl(g, small ? '10 cm' : '10 cm（1 cm = 10 px）', W - m - 1, sbY - 9, C.inkFaint, 10, 'right', 'middle');
		}


		/* ---------------- 繪圖: 汽車 ---------------- */

		function drawDial(g, cx, cy, r, vNow) {
			var a0 = Math.PI * 0.75;
			var a1 = Math.PI * 2.25;
			var k, ang;
			g.save();
			g.beginPath();
			g.arc(cx, cy, r, 0, Math.PI * 2);
			g.fillStyle = C.paper0;
			g.fill();
			g.strokeStyle = C.line;
			g.lineWidth = 1;
			g.stroke();
			for (k = 0; k <= 6; k++) {
				ang = a0 + (a1 - a0) * k / 6;
				ln(g, cx + Math.cos(ang) * (r - 4), cy + Math.sin(ang) * (r - 4),
					cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, C.inkFaint, 1, null);
			}
			var frac = ctx.clamp(vNow / 120, 0, 1);
			var na = a0 + (a1 - a0) * frac;
			ln(g, cx, cy, cx + Math.cos(na) * (r - 6), cy + Math.sin(na) * (r - 6), C.accent, 1.6, null);
			dot(g, cx, cy, 1.8, C.accent);
			lbl(g, num(vNow, 0), cx, cy + r * 0.30, C.ink, 10, 'center', 'middle');
			if (r >= 20) {
				lbl(g, 'km/h', cx, cy + r * 0.30 + 10, C.inkFaint, 10, 'center', 'middle');
			} else {
				/* 錶太小時單位塞不進圓裡: 挪到錶的右邊, 數字才不會壓到指針 */
				lbl(g, 'km/h', cx + r + 4, cy + r * 0.30, C.inkFaint, 10, 'left', 'middle');
			}
			g.restore();
		}

		function drawCar(g, W, H, m, innerH, mBot) {
			var innerW = W - 2 * m;
			var tEnd = t100();
			var sEnd = s100();
			var inH = Math.max(30, H * 0.20);
			var carBand = Math.max(60, innerH - inH - 10);
			var yC0 = m;
			var dialR = ctx.clamp(innerH * 0.11, 17, 24);   /* 半徑 < 17 時數字會壓到指針 */
			var carH = ctx.clamp(carBand * 0.24, 12, 44);
			var carW = carH / 0.44;
			var roadY = yC0 + carBand * 0.82;
			var x0 = m + 6;
			var x1 = W - m - 6;

			var tNow = prog * (isFinite(tEnd) ? tEnd : 0);
			var vNow = aC * tNow;
			var sNow = 0.5 * aC * tNow * tNow;

			/* 路面 */
			var asph = ctx.clamp(innerH * 0.030, 4, 9);
			g.fillStyle = '#4b4842';
			g.fillRect(m, roadY, innerW, asph);
			ln(g, m, roadY + 0.5, W - m, roadY + 0.5, 'rgba(250, 248, 244, 0.30)', 1, null);

			/* 車身中心走 cx0 → cx1, 兩端都留半個車身, 車才不會被畫布切掉 */
			var cx0 = x0 + carW / 2;
			var cx1 = x1 - carW / 2;
			var xOf = function (s) {
				if (!isFinite(sEnd) || sEnd <= 0) return cx0;
				return cx0 + ctx.clamp(s / sEnd, 0, 1) * (cx1 - cx0);
			};

			/* 終點線: 車頭到 100 km/h 那一刻的位置 */
			ln(g, cx1, roadY - carH - 14, cx1, roadY + asph, C.inkDim, 1, [4, 3]);
			lbl(g, '100 km/h', Math.min(cx1, W - m - 4), roadY - carH - 18,
				C.inkDim, 10, 'right', 'middle');

			/* 車 */
			drawCarSprite(g, xOf(sNow), roadY, carW);

			/* 時速錶放左上角: 右上角要留給 100 km/h 那條終點線的標籤, 兩個「100 km/h」
			   疊在一起會看不出哪個是目標、哪個是現在 */
			drawDial(g, m + dialR + 2, yC0 + dialR + 5, dialR, vNow * 3.6);

			/* 尺寸線: 由起點量到 100 km/h 的位置 */
			var dimY = roadY + asph + 11;
			ln(g, cx0, dimY, cx1, dimY, C.inkFaint, 1, null);
			ln(g, cx0, dimY - 4, cx0, dimY + 4, C.inkFaint, 1, null);
			ln(g, cx1, dimY - 4, cx1, dimY + 4, C.inkFaint, 1, null);
			lbl(g, 's = ' + num(sEnd, 1) + ' m', ctx.clamp((cx0 + cx1) / 2, m + 34, W - m - 34),
				dimY + 9, C.accent, 10, 'center', 'middle');

			/* --- v–t 小圖: 三角形面積 = s --- */
			var inW = Math.min(innerW * (W < 420 ? 0.40 : 0.46), 210);
			var inX = m + 2;
			var inY = H - mBot - inH;
			var inB = inY + inH - 12;

			ln(g, inX, inB, inX + inW, inB, C.line, 1, null);
			ln(g, inX, inB, inX, inY + 4, C.line, 1, null);

			var tx = function (t) {
				if (!isFinite(tEnd) || tEnd <= 0) return inX;
				return inX + ctx.clamp(t / tEnd, 0, 1) * (inW - 6);
			};
			var vy = function (v) {
				return inB - ctx.clamp(v / V100, 0, 1) * (inB - inY - 6);
			};

			g.beginPath();
			g.moveTo(tx(0), vy(0));
			g.lineTo(tx(tEnd), vy(V100));
			g.lineTo(tx(tEnd), vy(0));
			g.closePath();
			g.fillStyle = 'rgba(' + C.accentRgb + ', 0.15)';
			g.fill();
			g.strokeStyle = C.accent;
			g.lineWidth = 1;
			g.stroke();

			ln(g, tx(0), vy(0), tx(tEnd), vy(V100), C.ink, 1.6, null);
			dot(g, tx(tNow), vy(vNow), 2.6, C.accent);
			lbl(g, 'v–t', inX + 2, inY + 4, C.inkFaint, 10, 'left', 'middle');

			var room = W - m - (inX + inW + 12);
			var areaTxt = '面積 = s = ' + num(0.5 * V100 * (isFinite(tEnd) ? tEnd : 0), 1) + ' m';
			var baseTxt = room > 176
				? '底 = t = ' + num(tEnd, 2) + ' s、高 = ' + num(V100, 1) + ' m/s'
				: '底 ' + num(tEnd, 2) + ' s · 高 ' + num(V100, 1) + ' m/s';
			lbl(g, areaTxt, inX + inW + 12, inY + inH * 0.40, C.accent, 10, 'left', 'middle');
			lbl(g, baseTxt, inX + inW + 12, inY + inH * 0.40 + 13, C.inkFaint, 10, 'left', 'middle');
		}


		/* 側面汽車: 原點在輪子接觸地面處, 車頭朝 +x */
		function drawCarSprite(g, cx, gy, w) {
			var h = w * 0.44;
			var r = Math.max(1.6, w * 0.10);
			var i;
			g.save();
			g.translate(cx, gy);
			g.beginPath();
			g.moveTo(-w * 0.47, -h * 0.26);
			g.lineTo(-w * 0.50, -h * 0.52);
			g.lineTo(-w * 0.36, -h * 0.58);
			g.lineTo(-w * 0.21, -h * 0.96);
			g.lineTo(w * 0.10, -h * 0.98);
			g.lineTo(w * 0.26, -h * 0.60);
			g.lineTo(w * 0.47, -h * 0.55);
			g.lineTo(w * 0.50, -h * 0.26);
			g.closePath();
			g.fillStyle = '#8a3b34';
			g.fill();
			g.strokeStyle = 'rgba(20, 17, 13, 0.6)';
			g.lineWidth = 1;
			g.stroke();

			g.beginPath();
			g.moveTo(-w * 0.18, -h * 0.90);
			g.lineTo(w * 0.08, -h * 0.92);
			g.lineTo(w * 0.21, -h * 0.64);
			g.lineTo(-w * 0.25, -h * 0.62);
			g.closePath();
			g.fillStyle = '#c8d4d9';
			g.fill();

			g.fillStyle = '#e8d9a8';
			g.fillRect(w * 0.42, -h * 0.49, w * 0.07, Math.max(1.4, h * 0.14));

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

			var m = ctx.clamp(Math.min(W, H) * 0.045, 7, 16);
			var mBot = m + 24;
			var innerH = H - m - mBot;

			g.fillStyle = C.paper0;
			g.fillRect(0, 0, W, H);

			if (mode === 'tape') drawTape(g, W, H, m, innerH, mBot);
			else drawCar(g, W, H, m, innerH, mBot);
		}

		/* ---------------- 互動 ---------------- */

		function applyMode(next) {
			mode = next;
			btnTape.classList.toggle('is-on', mode === 'tape');
			btnCar.classList.toggle('is-on', mode === 'car');
			btnTape.setAttribute('aria-pressed', mode === 'tape' ? 'true' : 'false');
			btnCar.setAttribute('aria-pressed', mode === 'car' ? 'true' : 'false');

			if (mode === 'tape') {
				fU.root.classList.remove('kn-off');
				fA.inp.min = '0';
				fA.inp.max = '6';
				fA.inp.step = '0.1';
				fA.inp.value = String(aT);
				fA.inp.setAttribute('aria-label', '紙帶加速度（米每二次方秒）');
			} else {
				fU.root.classList.add('kn-off');
				fA.inp.min = '2';
				fA.inp.max = '10';
				fA.inp.step = '0.2';
				fA.inp.value = String(aC);
				fA.inp.setAttribute('aria-label', '汽車加速度（米每二次方秒）');
			}
			syncUI();
			draw();
		}

		var listeners = [];

		function on(target, type, fn) {
			target.addEventListener(type, fn);
			listeners.push([target, type, fn]);
		}

		on(fU.inp, 'input', function () {
			var v = parseFloat(fU.inp.value);
			if (!isFinite(v)) return;
			u = ctx.clamp(v, 0, 3);
			u = Math.round(u * 10) / 10;
			fU.inp.value = String(u);
			syncUI();
			draw();
		});

		on(fA.inp, 'input', function () {
			var v = parseFloat(fA.inp.value);
			if (!isFinite(v)) return;
			if (mode === 'tape') {
				aT = Math.round(ctx.clamp(v, 0, 6) * 10) / 10;
				fA.inp.value = String(aT);
			} else {
				aC = Math.round(ctx.clamp(v, 2, 10) * 5) / 5;
				fA.inp.value = String(aC);
			}
			syncUI();
			draw();
		});

		on(btnTape, 'click', function () { if (mode !== 'tape') applyMode('tape'); });
		on(btnCar, 'click', function () { if (mode !== 'car') applyMode('car'); });

		/* 動態被系統關掉時, 「重播」改成在起點與終點之間切換 ——
		   靜止畫面下這是它唯一還能示範的事, 按了不能毫無反應。 */
		on(btnReplay, 'click', function () {
			prog = ctx.reduced ? (prog > 0.5 ? 0 : 1) : 0;
			syncUI();
			draw();
		});

		var offResize = ctx.onResize(draw);

		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				frame++;
				if (prog < 1) prog = Math.min(1, prog + dt / 4.5);
				draw();
				if (frame % 8 === 0) syncUI();
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