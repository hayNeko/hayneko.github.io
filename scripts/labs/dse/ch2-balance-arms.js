/**
 * ch2-balance-arms.js — 天平與骨骼槓桿 (DSE 物理 · II.b · 實驗 06)
 *
 * 為什麼兩個模式放在同一格: 等臂天平與前臂是同一條 F₁d₁ = F₂d₂ 的兩端 ——
 * 天平把 d₁ = d₂ 鎖死, 於是「比質量」變成可能; 前臂把 d_muscle 壓到幾公分,
 * 於是同一條式子的結論翻過來: 力臂短的這邊要出很大的力。
 * 切一個模式, 學生看到的是同一條公式換一組數字, 不是兩個互不相干的實驗。
 */
(function () {
	'use strict';

	var G = 9.81;
	var ARM = 0.12;            /* m, 天平兩臂等長 */
	var MAX_TILT = 12 * Math.PI / 180;
	var PULSE = 2.6;

	window.DSELab.define('balance-arms', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		var K = {
			bench: '#a9805b',
			benchDark: '#8a6544',
			benchLit: '#c39a72',
			brass: '#b08d57',
			brassDark: '#8a6b3c',
			brassLit: '#d0b184',
			steel: '#8b9095',
			steelDark: '#63686c',
			plate: '#efe9dc',
			skin: '#e0b494',
			skinDark: '#c3926d',
			muscle: '#c07f63',
			bone: '#efe7d8',
			load: '#4a4f55',
			haze: '#dfe7e8'
		};

		/* ---------------- 狀態 ---------------- */
		var mode = 0;                 /* 0 = 天平, 1 = 前臂 */
		var m1 = 3;
		var m2 = 3;
		var dMuscle = 4;              /* cm */
		var dLoad = 30;               /* cm */
		var mLoad = 5;                /* kg */
		var angBeam = 0;
		var velBeam = 0;
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
		function fix(v, d) {
			if (typeof v !== 'number' || !isFinite(v)) return '—';
			return v.toFixed(d);
		}

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
		var st = { t1: 0, t2: 0, net: 0, state: '', target: 0, mg: 0, F: 0, ratio: 0, ma: 0 };

		function compute() {
			if (mode === 0) {
				st.t1 = m1 * G * ARM;
				st.t2 = m2 * G * ARM;
				st.net = st.t1 - st.t2;
				if (Math.abs(m1 - m2) < 0.005) st.state = '平衡';
				else if (m1 > m2) st.state = '左重';
				else st.state = '右重';
				/* 左邊重 = 左端下沉 = canvas 的負角度 (逆時針) */
				st.target = -MAX_TILT * Math.tanh((m1 - m2) * 1.4);
			} else {
				var dm = dMuscle / 100;
				var dl = dLoad / 100;
				st.mg = mLoad * G;
				st.F = dl > 0 && dm > 0 ? (st.mg * dl) / dm : NaN;
				st.ratio = st.mg > 0 && isFinite(st.F) ? st.F / st.mg : NaN;
				st.ma = dl > 0 ? dm / dl : NaN;
				st.state = '';
			}
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

		var gMode = el('div', 'dl-panel__group');
		gMode.appendChild(el('span', 'dl-panel__label', '模式'));
		var seg = el('div', 'dl-seg');
		var btnBal = el('button', 'dl-btn', '天平');
		var btnArm = el('button', 'dl-btn', '前臂');
		btnBal.type = 'button';
		btnArm.type = 'button';
		btnBal.className = 'dl-btn is-on';
		btnBal.setAttribute('aria-pressed', 'true');
		btnArm.setAttribute('aria-pressed', 'false');
		seg.appendChild(btnBal);
		seg.appendChild(btnArm);
		gMode.appendChild(seg);

		function field(group, label, min, max, step, val, aria) {
			var f = el('div', 'dl-field');
			f.appendChild(el('span', 'dl-field__label', label));
			var input = el('input', 'dl-range');
			input.type = 'range';
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(val);
			input.setAttribute('aria-label', aria);
			var out = el('output', 'dl-field__val', '—');
			f.appendChild(input);
			f.appendChild(out);
			group.appendChild(f);
			return { input: input, out: out };
		}

		/* 天平: 兩個質量 + 一個 100 g 砝碼 */
		var gBal = el('div', 'dl-panel__group fc-group');
		gBal.appendChild(el('span', 'dl-panel__label', '盤上質量'));
		var fM1 = field(gBal, '左盤 m₁', 0.2, 5, 0.1, m1, '左盤質量（公斤）');
		var fM2 = field(gBal, '右盤 m₂', 0.2, 5, 0.1, m2, '右盤質量（公斤）');
		var addRow = el('div', 'dl-seg');
		var btnAdd = el('button', 'dl-btn', '右盤加 100 g');
		btnAdd.type = 'button';
		btnAdd.setAttribute('aria-pressed', 'false');
		addRow.appendChild(btnAdd);
		gBal.appendChild(addRow);

		/* 前臂: 兩個力臂 + 負載 */
		var gArm = el('div', 'dl-panel__group fc-group');
		gArm.hidden = true;
		gArm.appendChild(el('span', 'dl-panel__label', '力臂與負載'));
		var fDm = field(gArm, '肌肉力臂', 3, 6, 0.1, dMuscle, '二頭肌附著點到肘的距離（公分）');
		var fDl = field(gArm, '負載力臂', 20, 40, 0.5, dLoad, '手掌到肘的距離（公分）');
		var fMl = field(gArm, '負載質量', 1, 20, 0.5, mLoad, '手上負載的質量（公斤）');

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}
		var rds = el('div', 'dl-readouts');
		var rd1 = cell('—');
		var rd2 = cell('—');
		var rd3 = cell('—');
		var rd4 = cell('—');
		rd2.v.classList.add('fc-accent');
		rds.appendChild(rd1.root);
		rds.appendChild(rd2.root);
		rds.appendChild(rd3.root);
		rds.appendChild(rd4.root);

		var texBox = el('div', 'fc-tex');
		var texA = el('span', 'fc-tex__row', '');
		var texB = el('span', 'fc-tex__sub', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gBal);
		panel.appendChild(gArm);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 ---------------- */
		var NOTE_BAL = '等臂天平兩邊力臂相同，所以力矩相等就等於質量相等：這就是天平可以「比較質量」的原因。' +
			'指針的擺動只是阻尼振動，最後會停在質量差對應的位置。';
		var NOTE_ARM = '前臂是第三類槓桿：支點（肘）與負載之間夾著施力點，肌肉力臂只有幾公分。' +
			'力臂比 d_muscle : d_load 決定機械優勢，人體槓桿幾乎都小於 1 —— 費力，但換來速度與行程。';
		var REDUCED = ' 已依系統設定暫停動態。';
		var lastA = '';
		var lastB = '';

		function setTeX(node, text, lastText) {
			if (text === lastText) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var s = compute();
			fM1.out.textContent = fix(m1, 1) + ' kg';
			fM2.out.textContent = fix(m2, 1) + ' kg';
			fDm.out.textContent = fix(dMuscle, 1) + ' cm';
			fDl.out.textContent = fix(dLoad, 1) + ' cm';
			fMl.out.textContent = fix(mLoad, 1) + ' kg';

			if (mode === 0) {
				rd1.k.textContent = 'τ_left';
				rd2.k.textContent = 'τ_right';
				rd3.k.textContent = 'Δτ';
				rd4.k.textContent = '狀態';
				rd1.v.textContent = fix(s.t1, 2) + ' N·m';
				rd2.v.textContent = fix(s.t2, 2) + ' N·m';
				rd3.v.textContent = (s.net > 0.005 ? '+' : '') + fix(s.net, 2) + ' N·m';
				rd4.v.textContent = s.state;
				rd4.v.classList.toggle('fc-accent', s.state !== '平衡');
				rd2.v.classList.remove('fc-accent');
				lastA = setTeX(texA, '\\( F_1 d_1 = F_2 d_2 \\)，\\( d_1 = d_2 = 0.12\\ \\mathrm{m} \\)', lastA);
				lastB = setTeX(texB,
					'\\( \\tau_1 = ' + fix(m1, 1) + '\\times 9.81\\times 0.12 = ' + fix(s.t1, 2) +
					' \\)，\\( \\tau_2 = ' + fix(s.t2, 2) + ' \\)', lastB);
			} else {
				rd1.k.textContent = '負載重量 mg';
				rd2.k.textContent = '肌肉所需力 F';
				rd3.k.textContent = '力臂比';
				rd4.k.textContent = '機械優勢';
				rd1.v.textContent = fix(s.mg, 2) + ' N';
				rd2.v.textContent = fix(s.F, 1) + ' N';
				rd3.v.textContent = fix(dMuscle, 1) + ' : ' + fix(dLoad, 1) + ' cm';
				rd4.v.textContent = fix(s.ma, 2);
				rd2.v.classList.add('fc-accent');
				rd4.v.classList.remove('fc-accent');
				lastA = setTeX(texA,
					'\\( F = \\dfrac{mg\\,d_{load}}{d_{muscle}} \\)，\\( \\dfrac{F}{mg} = \\dfrac{d_{load}}{d_{muscle}} \\)', lastA);
				lastB = setTeX(texB,
					'\\( F = \\dfrac{' + fix(s.mg, 2) + '\\times ' + fix(dLoad / 100, 2) + '}{' +
					fix(dMuscle / 100, 2) + '} = ' + fix(s.F, 1) + '\\ \\mathrm{N} \\)', lastB);
			}

			note.textContent = (mode === 0 ? NOTE_BAL : NOTE_ARM) + (ctx.reduced ? REDUCED : '');
		}

		/* ---------------- 繪圖: 天平 ---------------- */

		function drawBench(g, W, H, tableY) {
			g.fillStyle = K.haze;
			g.fillRect(0, 0, W, tableY);
			g.fillStyle = K.bench;
			g.fillRect(0, tableY, W, H - tableY);
			g.fillStyle = K.benchLit;
			g.fillRect(0, tableY, W, Math.max(2, H * 0.012));
			g.fillStyle = K.benchDark;
			g.fillRect(0, tableY + Math.max(2, H * 0.012), W, Math.max(1, H * 0.006));
		}

		function panShape(g, cx, y, pw) {
			/* 秤盤: 一個淺碟 + 兩條線, 不做 3D */
			g.strokeStyle = K.brassDark;
			g.lineWidth = Math.max(1.2, pw * 0.05);
			g.beginPath();
			g.moveTo(cx - pw * 0.5, y);
			g.quadraticCurveTo(cx, y + pw * 0.30, cx + pw * 0.5, y);
			g.stroke();
			g.strokeStyle = K.brass;
			g.lineWidth = 1;
			g.beginPath();
			g.moveTo(cx - pw * 0.5, y);
			g.lineTo(cx + pw * 0.5, y);
			g.stroke();
		}

		function drawBalance(g, W, H) {
			var s = compute();
			var tableY = H * 0.86;
			var beamY = H * 0.34;
			var px = W * 0.5;
			var L = W * 0.32;
			var panY = beamY + (tableY - beamY) * 0.46;
			var pw = Math.min(L * 0.62, W * 0.20);
			var baseH = Math.max(5, H * 0.05);
			var colW = Math.max(3, W * 0.012);

			drawBench(g, W, H, tableY);

			/* 底座 + 立柱 */
			g.fillStyle = K.brassDark;
			g.fillRect(px - W * 0.13, tableY - baseH, W * 0.26, baseH);
			g.fillStyle = K.brass;
			g.fillRect(px - colW * 0.5, beamY, colW, tableY - baseH - beamY);

			/* 指針刻度盤: 固定在柱上, 指針在它前面擺 */
			var plateY = beamY + (tableY - beamY) * 0.30;
			var plateW = Math.max(26, W * 0.12);
			var plateH = Math.max(12, H * 0.085);
			g.fillStyle = K.plate;
			g.fillRect(px - plateW * 0.5, plateY, plateW, plateH);
			g.strokeStyle = K.brassDark;
			g.lineWidth = 1;
			g.strokeRect(Math.round(px - plateW * 0.5) + 0.5, Math.round(plateY) + 0.5, Math.round(plateW) - 1, Math.round(plateH) - 1);
			for (var t = 0; t < 5; t++) {
				var tx = px - plateW * 0.40 + plateW * 0.80 * (t / 4);
				var strong = t === 2;
				ln(g, tx, plateY + plateH, tx, plateY + plateH - (strong ? plateH * 0.72 : plateH * 0.42),
					strong ? K.brassDark : K.steel, 1);
			}

			/* 橫樑 */
			g.save();
			g.translate(px, beamY);
			g.rotate(angBeam);
			g.fillStyle = K.brass;
			g.fillRect(-L, -Math.max(2, H * 0.012), L * 2, Math.max(4, H * 0.024));
			g.fillStyle = K.brassLit;
			g.fillRect(-L, -Math.max(2, H * 0.012), L * 2, Math.max(1, H * 0.006));
			/* 兩臂的量度: 沿著樑, 等長看得出來 */
			/* 量度畫在樑的上方: 下方是吊盤的兩條吊線, 標籤會被它們劃過 */
			var dy = -Math.max(10, H * 0.055);
			ln(g, -L, dy, 0, dy, C.inkFaint, 1);
			ln(g, 0, dy, L, dy, C.inkFaint, 1);
			ln(g, -L, dy - 3, -L, dy + 3, C.inkFaint, 1);
			ln(g, L, dy - 3, L, dy + 3, C.inkFaint, 1);
			ln(g, 0, dy - 3, 0, dy + 3, C.inkFaint, 1);
			lbl(g, 'd₁ ' + ARM.toFixed(2) + ' m', -L * 0.5, dy - 9, C.inkDim, 10, 'center', 'middle', true, null);
			lbl(g, 'd₂ ' + ARM.toFixed(2) + ' m', L * 0.5, dy - 9, C.inkDim, 10, 'center', 'middle', true, null);
			g.restore();

			/* 吊盤: 吊點在樑端, 盤面保持水平 */
			var ends = [
				{ x: px - L * Math.cos(angBeam), y: beamY - L * Math.sin(angBeam), m: m1, tag: 'm₁' },
				{ x: px + L * Math.cos(angBeam), y: beamY + L * Math.sin(angBeam), m: m2, tag: 'm₂' }
			];
			for (var i = 0; i < 2; i++) {
				var e = ends[i];
				g.strokeStyle = K.steelDark;
				g.lineWidth = 1;
				g.beginPath();
				g.moveTo(e.x - pw * 0.42, panY);
				g.lineTo(e.x, e.y);
				g.lineTo(e.x + pw * 0.42, panY);
				g.stroke();
				/* 盤上的砝碼: 寬度跟著質量走 */
				var bw = pw * (0.30 + 0.40 * cl(e.m / 5, 0, 1));
				var bh = Math.max(7, H * 0.042);
				g.fillStyle = K.steel;
				g.fillRect(e.x - bw * 0.5, panY - bh, bw, bh);
				g.fillStyle = K.steelDark;
				g.fillRect(e.x - bw * 0.5, panY - bh, bw, Math.max(1, bh * 0.28));
				panShape(g, e.x, panY, pw);
				/* 標籤要落在碟子的弧線下面, 否則會被秤盤的曲線劃過 */
				lbl(g, e.tag + ' ' + fix(e.m, 1) + ' kg', e.x, panY + pw * 0.30 + Math.max(9, H * 0.035),
					C.ink, 10, 'center', 'middle', true, null);
			}

			/* 指針: 從支點往下, 擺過刻度盤 */
			var plen = (plateY + plateH * 0.5) - beamY;
			var pax = px + Math.sin(angBeam) * plen;
			var pay = beamY + Math.cos(angBeam) * plen;
			ln(g, px, beamY, pax, pay, C.ink, 1.6);
			D.dot(g, px, beamY, Math.max(2, W * 0.006), { color: C.ink, fill: C.paper0, stroke: true, width: 1.2 });

			/* 頂上的結論: 等臂 → 力矩相等 → 質量相等 */
			var top = Math.max(10, H * 0.10);
			if (W >= 380) {
				lbl(g, '等臂 d₁ = d₂ → 力矩相等 → 平衡時 m₁ = m₂', px, top, C.ink, 10, 'center', 'middle', false, null);
			} else {
				lbl(g, '等臂 → 力矩相等 → m₁ = m₂', px, top, C.ink, 10, 'center', 'middle', false, null);
			}
		}

		/* ---------------- 繪圖: 前臂 ---------------- */

		function drawArm(g, W, H) {
			var s = compute();
			var m = cl(Math.min(W, H) * 0.03, 6, 16);
			var ex = W * 0.11;
			var ey = H * 0.60;
			var handX = ex + dLoad / 100 * ((W * 0.90 - ex) / 0.42);
			var insX = ex + dMuscle / 100 * ((W * 0.90 - ex) / 0.42);
			var shX = ex - W * 0.005;
			var shY = ey - H * 0.30;
			var armT = Math.max(7, H * 0.055);

			/* 背景: 一面淡色的診間牆 */
			g.fillStyle = K.haze;
			g.fillRect(0, 0, W, H);
			g.fillStyle = '#eef2f1';
			g.fillRect(0, H * 0.78, W, H * 0.22);

			/* 上臂 + 二頭肌 + 前臂 + 手 */
			g.fillStyle = K.skin;
			g.beginPath();
			g.moveTo(shX - armT * 0.55, shY);
			g.lineTo(shX + armT * 0.55, shY);
			g.lineTo(ex + armT * 0.55, ey);
			g.lineTo(ex - armT * 0.55, ey);
			g.closePath();
			g.fill();

			/* 二頭肌: 由附著點斜上到肩的一條梭形, 比上臂紅一階 */
			var bx0 = insX;
			var by0 = ey - armT * 0.30;
			var bx1 = shX + armT * 0.30;
			var by1 = shY + H * 0.06;
			var ctlX = (bx0 + bx1) * 0.5 + armT * 0.9;
			var ctlY = (by0 + by1) * 0.5;
			g.fillStyle = K.muscle;
			g.beginPath();
			g.moveTo(bx0, by0);
			g.quadraticCurveTo(ctlX, ctlY, bx1, by1);
			g.lineTo(bx1 - armT * 0.15, by1 - armT * 0.28);
			g.quadraticCurveTo(ctlX - armT * 0.75, ctlY - armT * 0.30, bx0, by0 - armT * 0.42);
			g.closePath();
			g.fill();

			/* 前臂: 一條粗桿, 兩端圓頭 */
			g.strokeStyle = K.skin;
			g.lineWidth = armT;
			g.lineCap = 'round';
			g.beginPath();
			g.moveTo(ex, ey);
			g.lineTo(handX, ey);
			g.stroke();
			/* 前臂下緣的陰影: 讓桿件有厚度 */
			g.strokeStyle = K.skinDark;
			g.lineWidth = Math.max(1.4, armT * 0.18);
			g.beginPath();
			g.moveTo(ex + armT * 0.4, ey + armT * 0.40);
			g.lineTo(handX - armT * 0.2, ey + armT * 0.40);
			g.stroke();
			g.lineCap = 'butt';

			/* 拳頭 + 負載 */
			var fistR = armT * 0.62;
			g.fillStyle = K.skin;
			g.beginPath();
			g.arc(handX, ey, fistR, 0, Math.PI * 2);
			g.fill();
			var lw = Math.max(10, armT * 1.1);
			var lh = Math.max(9, armT * 0.9);
			g.fillStyle = K.load;
			g.fillRect(handX - lw * 0.5, ey + fistR, lw, lh);
			g.fillStyle = K.steel;
			g.fillRect(handX - lw * 0.5, ey + fistR, lw, Math.max(1, lh * 0.2));

			/* 支點 */
			D.dot(g, ex, ey, Math.max(3, armT * 0.30), { color: C.accent, fill: C.paper0, stroke: true, width: 1.6 });
			lbl(g, '支點（肘）', ex, ey + armT * 0.50 + Math.max(11, H * 0.055), C.inkDim, 10, 'left', 'middle', false, null);

			/* 肌肉力: 同一比例尺, 所以永遠比負載長得多 */
			var maxLen = H * 0.36;
			var fLen = maxLen;
			var mgLen = isFinite(s.F) && s.F > 0 ? maxLen * (s.mg / s.F) : maxLen;
			mgLen = cl(mgLen, 8, maxLen);
			var ty = ey - armT * 0.5;
			arw(g, insX, ty, insX, ty - fLen, C.accent, 2, 8, null);
			lbl(g, 'F ' + fix(s.F, 1) + ' N', insX + 7, ty - fLen + 10, C.accent, 10, 'left', 'middle', true, null);
			lbl(g, '×' + fix(s.ratio, 1) + ' mg', insX + 7, ty - fLen + 24, C.accent, 10, 'left', 'middle', true, null);

			/* 負載重量: 從拳頭往下 */
			arw(g, handX, ey + fistR + lh, handX, ey + fistR + lh + mgLen, C.ink, 1.8, 7, null);
			lbl(g, 'mg ' + fix(s.mg, 2) + ' N', handX, ey + fistR + lh + mgLen + 9, C.ink, 10, 'center', 'middle', true, null);

			/* 兩個力臂: 樓梯式錯開, 否則同一列會疊在一起 */
			var y1 = ey + armT * 0.5 + Math.max(22, H * 0.12);
			var y2 = y1 + Math.max(16, H * 0.085);
			function dim(x1, x2, y, text) {
				ln(g, x1, y, x2, y, C.inkDim, 1);
				ln(g, x1, y - 4, x1, y + 4, C.inkDim, 1);
				ln(g, x2, y - 4, x2, y + 4, C.inkDim, 1);
				lbl(g, text, (x1 + x2) * 0.5, y + 9, C.inkDim, 10, 'center', 'middle', true, null);
			}
			dim(ex, insX, y1, 'd_m ' + fix(dMuscle, 1) + ' cm');
			dim(ex, handX, y2, 'd_l ' + fix(dLoad, 1) + ' cm');

			/* 肌肉張力的脈衝: 由附著點沿二頭肌跑到肩 */
			if (!ctx.reduced) {
				var t = (phase % 1);
				var bx = insX + (shX + armT * 0.3 - insX) * t;
				var by = (ey - armT * 0.35) + (shY + H * 0.06 - (ey - armT * 0.35)) * t;
				D.dot(g, bx, by, Math.max(1.8, armT * 0.12), { color: C.inkDim, fill: C.inkDim, stroke: false });
			}

			/* 左上角一句話: 力臂比才是槓桿的性質 */
			lbl(g, '力臂比 ' + fix(dMuscle, 1) + ' : ' + fix(dLoad, 1) + ' cm', m, m + 4, C.ink, 10, 'left', 'middle', true, null);
		}

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 60 || H < 44) return;
			var s = compute();
			if (ctx.reduced) { angBeam = s.target; velBeam = 0; }
			if (mode === 0) drawBalance(g, W, H);
			else drawArm(g, W, H);
		}

		/* ---------------- 互動 ---------------- */

		function setMode(next) {
			mode = next;
			btnBal.classList.toggle('is-on', mode === 0);
			btnArm.classList.toggle('is-on', mode === 1);
			btnBal.setAttribute('aria-pressed', mode === 0 ? 'true' : 'false');
			btnArm.setAttribute('aria-pressed', mode === 1 ? 'true' : 'false');
			gBal.hidden = mode !== 0;
			gArm.hidden = mode !== 1;
			angBeam = compute().target;
			velBeam = 0;
			syncUI();
			draw();
		}

		btnBal.addEventListener('click', function () { setMode(0); });
		btnArm.addEventListener('click', function () { setMode(1); });

		btnAdd.addEventListener('click', function () {
			m2 = cl(Math.round((m2 + 0.1) * 10) / 10, 0.2, 5);
			fM2.input.value = String(m2);
			btnAdd.setAttribute('aria-pressed', 'true');
			window.setTimeout(function () { btnAdd.setAttribute('aria-pressed', 'false'); }, 180);
			syncUI();
			draw();
		});

		fM1.input.addEventListener('input', function () {
			var v = parseFloat(fM1.input.value);
			if (!isFinite(v)) return;
			m1 = cl(Math.round(v * 10) / 10, 0.2, 5);
			syncUI();
			draw();
		});

		fM2.input.addEventListener('input', function () {
			var v = parseFloat(fM2.input.value);
			if (!isFinite(v)) return;
			m2 = cl(Math.round(v * 10) / 10, 0.2, 5);
			syncUI();
			draw();
		});

		fDm.input.addEventListener('input', function () {
			var v = parseFloat(fDm.input.value);
			if (!isFinite(v)) return;
			dMuscle = cl(Math.round(v * 10) / 10, 3, 6);
			syncUI();
			draw();
		});

		fDl.input.addEventListener('input', function () {
			var v = parseFloat(fDl.input.value);
			if (!isFinite(v)) return;
			dLoad = cl(Math.round(v * 2) / 2, 20, 40);
			syncUI();
			draw();
		});

		fMl.input.addEventListener('input', function () {
			var v = parseFloat(fMl.input.value);
			if (!isFinite(v)) return;
			mLoad = cl(Math.round(v * 2) / 2, 1, 20);
			syncUI();
			draw();
		});

		ctx.onResize(draw);
		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				var k = 60;
				var c = 2 * Math.sqrt(k);
				var t = compute().target;
				var acc = k * (t - angBeam) - c * velBeam;
				velBeam += acc * dt;
				angBeam += velBeam * dt;
				if (Math.abs(t - angBeam) < 2e-4 && Math.abs(velBeam) < 2e-4) { angBeam = t; velBeam = 0; }
				phase += dt / PULSE;
				draw();
			});
		}

		return {
			destroy: function () { view = null; }
		};
	});
})();
