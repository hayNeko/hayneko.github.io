/**
 * ch2-planets-3d.js — 行星與月球重力 (DSE 物理 · II.g · 實驗 18)
 *
 * 兩個模式各自回答一條式子, 共用一個行星表:
 *   太陽系   T²/r³ = 4π²/GM☉ —— 五顆行星都印出同一個數, 這才是「同一條定律」。
 *   月球重力 g = GM/R²      —— 同一個 1 kg, 換一顆天體就換一個重量。
 *
 * 兩個刻意的取捨:
 * ① 軌道半徑壓縮成 AU^0.42。真實比例下水星(0.387 AU)會在木星(5.203 AU)旁邊
 *    擠成一個點, 而這支實驗要比較的是「週期」不是「距離感」。真實 AU 在讀數裡。
 * ② 月球重力那邊三顆天體都畫成同樣半徑的球。若照真實半徑畫, 月球會小到看不見
 *    秤, 學生也會把「比較輕」誤讀成「比較小」—— 這裡要突顯的是 g 與箭長。
 */
(function () {
	'use strict';

	var TAU = Math.PI * 2;
	var G = 6.674e-11;
	var YEARS_PER_SEC = 20;          /* 1× 時每秒走 1/20 年: 水星 4.8 s 一圈 */
	var SUN_R = 0.62;
	var BR = 3;                      /* 月球重力那顆球的世界半徑(固定, 理由見檔頭) */
	var W_GAIN = 2.4;                /* 世界單位 / (N/kg), 地球 9.82 → 2.4 */
	var SPEED_MIN = 0;
	var SPEED_MAX = 5;
	var SPEED_DEF = 1;
	var LABEL_PX = 21;                /* 標籤貼圖的總高(CSS px): 字身約 54%, 所以 21px 貼圖 ≈ 11px 字 */
	var LABEL_REF = 446;              /* 標籤基準的畫布高: 小畫布上標籤要等比縮, 否則會互相壓 */

	var PLANETS = [
		{ t: '水星', au: 0.387, yr: 0.241, r: 0.10, c: '#9a8f85' },
		{ t: '金星', au: 0.723, yr: 0.615, r: 0.18, c: '#d8c48c' },
		{ t: '地球', au: 1.000, yr: 1.000, r: 0.19, c: '#ffffff', tex: 'earth' },
		{ t: '火星', au: 1.524, yr: 1.881, r: 0.14, c: '#b4552e' },
		{ t: '木星', au: 5.203, yr: 11.86, r: 0.36, c: '#c9a273' }
	];

	var BODIES = [
		{ t: '地球', M: 5.972e24, R: 6.371e6, c: '#ffffff', tex: 'earth' },
		{ t: '月球', M: 7.348e22, R: 1.737e6, c: '#ffffff', tex: 'moon' },
		{ t: '火星', M: 6.417e23, R: 3.3895e6, c: '#b0542e', tex: null }
	];

	/* 世界半徑: 2.55·AU^0.42 → 水星 1.71, 木星 5.10 */
	function orbitUnit(au) {
		return 2.55 * Math.pow(Math.max(0, au), 0.42);
	}

	window.DSELab.define('planets-3d', function (mount, ctx) {
		var D = window.DSEThree;
		var THREE = window.THREE;
		var doc = document;
		var dead = false;
		var mode = 0;                       /* 0 太陽系 / 1 月球重力 */
		var sel = 2;                        /* 預設地球 */
		var body = 0;                       /* 預設地球 */
		var speed = SPEED_DEF;
		var camDist = 12.2;

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

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}

		function btn(label, seg) {
			var b = el('button', 'dl-btn', label);
			b.type = 'button';
			b.setAttribute('aria-pressed', 'false');
			seg.appendChild(b);
			return b;
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stageCol = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		var canvas = el('canvas', 'dl-canvas');
		wrap.appendChild(canvas);
		wrap.appendChild(el('p', 'dl-hint g3-hint', '拖動畫布可旋轉視角'));
		stageCol.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel g3-panel');

		var gMode = el('div', 'dl-panel__group');
		gMode.appendChild(el('span', 'dl-panel__label', '模式'));
		var segMode = el('div', 'dl-seg');
		var btSolar = btn('太陽系', segMode);
		var btMoon = btn('月球重力', segMode);
		gMode.appendChild(segMode);

		var gPlanet = el('div', 'dl-panel__group');
		gPlanet.appendChild(el('span', 'dl-panel__label', '行星'));
		var segPlanet = el('div', 'dl-seg');
		var planetBtns = [];
		var i;
		for (i = 0; i < PLANETS.length; i++) planetBtns.push(btn(PLANETS[i].t, segPlanet));
		gPlanet.appendChild(segPlanet);

		var fieldSpeed = el('div', 'dl-field');
		fieldSpeed.appendChild(el('span', 'dl-field__label', '模擬速度'));
		var inSpeed = el('input', 'dl-range');
		inSpeed.type = 'range';
		inSpeed.min = String(SPEED_MIN);
		inSpeed.max = String(SPEED_MAX);
		inSpeed.step = '0.1';
		inSpeed.value = String(SPEED_DEF);
		inSpeed.setAttribute('aria-label', '模擬速度（倍）');
		var outSpeed = el('output', 'dl-field__val', '1.0×');
		fieldSpeed.appendChild(inSpeed);
		fieldSpeed.appendChild(outSpeed);
		gPlanet.appendChild(fieldSpeed);
		gPlanet.appendChild(el('span', 'dl-badge', 'T² ∝ r³'));

		var gBody = el('div', 'dl-panel__group g3-hide');
		gBody.appendChild(el('span', 'dl-panel__label', '天體'));
		var segBody = el('div', 'dl-seg');
		var bodyBtns = [];
		for (i = 0; i < BODIES.length; i++) bodyBtns.push(btn(BODIES[i].t, segBody));
		gBody.appendChild(segBody);

		var rdsSolar = el('div', 'dl-readouts g3-rd');
		var rdP = cell('行星');
		var rdAu = cell('r（AU）');
		var rdYr = cell('T（年）');
		var rdK = cell('T² / r³');
		rdsSolar.appendChild(rdP.root);
		rdsSolar.appendChild(rdAu.root);
		rdsSolar.appendChild(rdYr.root);
		rdsSolar.appendChild(rdK.root);

		var rdsMoon = el('div', 'dl-readouts g3-rd g3-hide');
		/* 月球重力: 鍵短到 1280 那一欄 (約 159px) 內放得下, 單位改放值裡 ——
		   原本 '1 kg 的重量（N）' / '與地球比（%）' 會折成兩行, 格子比全站其他格子高 */
		var rdG = cell('g');
		var rdW = cell('1 kg 重量');
		var rdPct = cell('佔地球重量');
		var rdR = cell('R（km）');
		rdsMoon.appendChild(rdG.root);
		rdsMoon.appendChild(rdW.root);
		rdsMoon.appendChild(rdPct.root);
		rdsMoon.appendChild(rdR.root);

		var texBox = el('div', 'g3-tex');
		var rowA = el('span', 'g3-tex__row', '');
		var rowB = el('span', 'g3-tex__row', '');
		texBox.appendChild(rowA);
		texBox.appendChild(rowB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gPlanet);
		panel.appendChild(gBody);
		panel.appendChild(rdsSolar);
		panel.appendChild(rdsMoon);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stageCol);
		grid.appendChild(panel);
		mount.appendChild(grid);

		/* ---------------- 3D ---------------- */

		var stage = D.createStage(canvas, ctx, {
			aspect: '16 / 10',
			background: '#04070e',
			camera: { yaw: -0.9, pitch: 0.52, dist: 12.2, target: [0, 0, 0] }
		});
		if (!stage) return null;
		stage.orbit({ minPitch: 0.02, maxPitch: 1.35, minDist: 8, maxDist: 40 });

		var sunLight = new THREE.DirectionalLight(0xffffff, 1.15);
		sunLight.position.set(9, 6, 5);
		stage.scene.add(sunLight);
		stage.scene.add(new THREE.AmbientLight(0x8fa6c2, 0.38));

		stage.add(D.sky('#03060c', '#0a1526'));

		var solar = new THREE.Group();
		var moon = new THREE.Group();
		moon.visible = false;
		stage.add(solar);
		stage.add(moon);

		/* --- 太陽系 --- */
		var sun = D.sphere(SUN_R, '#ffe9a8', {
			segments: 48, roughness: 0.5, metalness: 0,
			emissive: '#ffc94a', emissiveIntensity: 1
		});
		solar.add(sun);
		var sunGlow = D.sphere(SUN_R * 1.35, '#ffb020', { segments: 32, opacity: 0.16, roughness: 1 });
		/* 不受光的暖光暈: 用 standard 材質會被外側光打成一圈暗環 */
		sunGlow.material = new THREE.MeshBasicMaterial({
			color: 0xffc23a, transparent: true, opacity: 0.2, depthWrite: false
		});
		solar.add(sunGlow);

		var pivots = [];
		var planetMeshes = [];
		/* 起始相位: 五顆都落在鏡頭這一側, 開場畫面才不會有小行星躲在太陽後面 */
		var startPhase = [5.13, 3.93, 2.73, 4.53, 3.23];

		for (i = 0; i < PLANETS.length; i++) {
			var P = PLANETS[i];
			P.rw = orbitUnit(P.au);
			var pivot = new THREE.Group();
			pivot.rotation.y = startPhase[i];
			solar.add(pivot);
			pivots.push(pivot);

			solar.add(D.ring(P.rw - 0.006, P.rw + 0.006, '#41618a', { opacity: 0.34, axis: 'y', segments: 128 }));

			var pm = D.sphere(P.r, P.c, { segments: Math.max(20, Math.round(P.r * 90)), roughness: 0.72, metalness: 0 });
			if (P.tex) {
				pm.material.map = D.earthTexture();
				pm.material.needsUpdate = true;
			}
			pm.position.x = P.rw;
			pivot.add(pm);
			planetMeshes.push(pm);
		}

		/* --- 月球重力 --- */
		var bodySphere = D.sphere(BR, '#ffffff', { segments: 56, roughness: 0.9, metalness: 0 });
		bodySphere.material.map = D.earthTexture();
		bodySphere.material.needsUpdate = true;
		moon.add(bodySphere);

		var plate = D.box(1.5, 0.14, 1.5, '#9aa0a6', { roughness: 0.35, metalness: 0.55 });
		plate.position.y = BR + 0.07;
		moon.add(plate);

		var dial = D.box(0.62, 0.2, 0.06, '#e6e2d8', { roughness: 0.5, metalness: 0.1 });
		dial.position.set(0, BR + 0.07, 0.78);
		moon.add(dial);

		var block = D.box(0.85, 0.85, 0.85, '#b08a52', { roughness: 0.6, metalness: 0.05 });
		var blockBottom = BR + 0.14;
		block.position.y = blockBottom + 0.425;
		moon.add(block);

		/* 重量箭頭: 不參與深度測試, 否則它會埋進球體裡(力圖本來就畫在物體之外) */
		var wArrow = D.arrow3([0, 0, 0], [0, 1, 0], '#e2603f', { width: 0.075 });
		wArrow.traverse(function (o) {
			if (o.isMesh && o.material) { o.material.depthTest = false; o.renderOrder = 10; }
		});
		moon.add(wArrow);

		var UPV = new THREE.Vector3(0, 1, 0);
		var DOWNV = new THREE.Vector3(0, -1, 0);

		/* ---------------- 標籤 ---------------- */

		var labels = [];      /* 置中: 只調字級 */
		var anchored = [];    /* 左緣對齊: 依字寬重算 x, 三行資料才排得成一欄 */

		function addEntry(list, sp, base) {
			var en = { sp: sp, ratio: sp.scale.x / sp.scale.y, base: base };
			list.push(en);
			return en;
		}

		function mkLabel(text, color, parent) {
			var sp = D.label(text, color, { size: 1, pad: 6 });
			addEntry(labels, sp, null);
			(parent || stage.scene).add(sp);
			return sp;
		}

		/* 行星名字與讀數都掛在 pivot 的局部座標上: 往「離太陽的方向」排,
		   半徑不同的行星才不會把字疊在一起 */
		function mkLeft(text, color, parent, x, y, z, row) {
			var sp = D.label(text, color, { size: 1, pad: 6 });
			addEntry(anchored, sp, { x: x, y: y, z: z, row: row || 0, align: 'left' });
			parent.add(sp);
			return sp;
		}

		/* 居中的多行讀數: 小畫布時整塊只有 90px 寬, 貼左對齊會有一半跑到畫布外 */
		function mkCenter(text, color, parent, x, y, z, row) {
			var sp = D.label(text, color, { size: 1, pad: 6 });
			addEntry(anchored, sp, { x: x, y: y, z: z, row: row || 0, align: 'center' });
			parent.add(sp);
			return sp;
		}

		function dropLabel(sp, parent) {
			var j;
			for (j = 0; j < labels.length; j++) {
				if (labels[j].sp === sp) { labels.splice(j, 1); break; }
			}
			for (j = 0; j < anchored.length; j++) {
				if (anchored[j].sp === sp) { anchored.splice(j, 1); break; }
			}
			if (parent) parent.remove(sp);
			if (sp.material) {
				if (sp.material.map) sp.material.map.dispose();
				sp.material.dispose();
			}
		}

		function fitLabels() {
			if (dead) return;
			var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
			var hPx = rect && rect.height ? rect.height : (rect && rect.width ? rect.width * 0.625 : 226);
			var worldPerPx = (2 * camDist * Math.tan(45 * Math.PI / 360)) / Math.max(1, hPx);
			/* 小畫布給大一點的貼圖: 見 orbit-3d 同一段說明 */
			var px = LABEL_PX + (1 - Math.min(1, hPx / LABEL_REF)) * 7;
			var s = worldPerPx * px;
			var j;
			for (j = 0; j < labels.length; j++) labels[j].sp.scale.set(labels[j].ratio * s, s, 1);
			for (j = 0; j < anchored.length; j++) {
				var en = anchored[j];
				en.sp.scale.set(en.ratio * s, s, 1);
				/* 同一欄的多行按字高重新排: 換畫布尺寸時行距才不會鬆掉或疊起來 */
				var left = en.base.align === 'center' ? 0 : en.ratio * s / 2;
				en.sp.position.set(en.base.x + left, en.base.y + en.base.row * s * 1.2, en.base.z);
			}
		}

		var sunLabel = mkLabel('太陽', '#ffe6a0', solar);
		sunLabel.position.set(0, SUN_R + 0.85, 0);

		for (i = 0; i < PLANETS.length; i++) {
			mkLeft(PLANETS[i].t, '#cfd6de', pivots[i], PLANETS[i].rw + PLANETS[i].r + 0.22, 0, 0);
		}

		/* 選中行星的即時資料: 掛在該行星的 pivot 上, 行星走它就跟著走 */
		var infoSprites = [];
		var infoParent = null;

		function clearInfo() {
			var j;
			for (j = 0; j < infoSprites.length; j++) dropLabel(infoSprites[j], infoParent);
			infoSprites = [];
			infoParent = null;
		}

		function buildInfo(idx) {
			clearInfo();
			var P = PLANETS[idx];
			var k = P.yr * P.yr / (P.au * P.au * P.au);
			var lines = ['r = ' + num(P.au, 3) + ' AU', 'T = ' + num(P.yr, 2) + ' 年',
				'T²/r³ = ' + num(k, 3)];
			infoParent = pivots[idx];
			for (var j = 0; j < lines.length; j++) {
				infoSprites.push(mkCenter(lines[j], '#9fc0e0', infoParent,
					P.rw + P.r + 1.05, P.r + 0.55, 0, lines.length - 1 - j));
			}
		}

		var bodyLabel = null;
		var massLabel = null;
		var readLabel = null;
		var wLabel = mkLabel('W', '#ff9a80', moon);

		wLabel.material.depthTest = false;
		wLabel.renderOrder = 12;
		wLabel.position.set(0.72, 2, 0);

		/* ---------------- 物理 ---------------- */

		var gEarth = G * BODIES[0].M / (BODIES[0].R * BODIES[0].R);

		function bodyOf(idx) {
			var b = BODIES[idx];
			var g = G * b.M / (b.R * b.R);
			return { t: b.t, M: b.M, R: b.R, g: g, W: g, pct: g / gEarth * 100 };
		}

		/* ---------------- 讀數 / 公式 ---------------- */

		var lastA = '';
		var lastB = '';
		var REDUCED = ' 已依系統設定暫停動態。';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function sci(x, d) {
			if (typeof x !== 'number' || !isFinite(x) || x === 0) return '0';
			var e = Math.floor(Math.log(Math.abs(x)) / Math.LN10);
			var m = x / Math.pow(10, e);
			var ms = m.toFixed(d);
			if (Math.abs(parseFloat(ms)) >= 10) { m = m / 10; e += 1; ms = m.toFixed(d); }
			return ms + '\\times10^{' + e + '}';
		}

		/* 貼圖裡不會跑 KaTeX: 標籤用上標字元寫科學記號 */
		var SUP = { '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074',
			'5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079', '-': '\u207b' };

		function sup(n) {
			var s = String(n), out = '', i;
			for (i = 0; i < s.length; i++) out += SUP[s.charAt(i)] || s.charAt(i);
			return out;
		}

		function sciText(x, d) {
			if (typeof x !== 'number' || !isFinite(x) || x === 0) return '0';
			var e = Math.floor(Math.log(Math.abs(x)) / Math.LN10);
			var m = x / Math.pow(10, e);
			var ms = m.toFixed(d);
			if (Math.abs(parseFloat(ms)) >= 10) { m = m / 10; e += 1; ms = m.toFixed(d); }
			return ms + '×10' + sup(e);
		}

		function syncUI() {
			var j;
			for (j = 0; j < PLANETS.length; j++) {
				var on = j === sel;
				planetBtns[j].classList.toggle('is-on', on && mode === 0);
				planetBtns[j].setAttribute('aria-pressed', on && mode === 0 ? 'true' : 'false');
			}
			for (j = 0; j < BODIES.length; j++) {
				var onB = j === body;
				bodyBtns[j].classList.toggle('is-on', onB);
				bodyBtns[j].setAttribute('aria-pressed', onB ? 'true' : 'false');
			}
			btSolar.classList.toggle('is-on', mode === 0);
			btMoon.classList.toggle('is-on', mode === 1);
			btSolar.setAttribute('aria-pressed', mode === 0 ? 'true' : 'false');
			btMoon.setAttribute('aria-pressed', mode === 1 ? 'true' : 'false');

			outSpeed.textContent = num(speed, 1) + '×';

			if (mode === 0) {
				var P = PLANETS[sel];
				var k = P.yr * P.yr / (P.au * P.au * P.au);
				rdP.v.textContent = P.t;
				rdAu.v.textContent = num(P.au, 3);
				rdYr.v.textContent = num(P.yr, 2);
				rdK.v.textContent = num(k, 3);
				rdK.v.classList.toggle('g3-acc', Math.abs(k - 1) < 0.01);
				lastA = setTeX(rowA, '\\( \\dfrac{T^{2}}{r^{3}}=\\dfrac{' + num(P.yr, 2) + '^{2}}{'
					+ num(P.au, 3) + '^{3}}=' + num(k, 3) + '\\ \\mathrm{yr^{2}/AU^{3}} \\)', lastA);
				lastB = setTeX(rowB, '\\( \\dfrac{T^{2}}{r^{3}}=\\dfrac{4\\pi^{2}}{GM_{\\odot}} \\)'
					+ ' = 常數（五顆行星同一個值）', lastB);
			} else {
				var b = bodyOf(body);
				rdG.v.textContent = num(b.g, 3) + ' m/s²';
				rdW.v.textContent = num(b.W, 3) + ' N';
				rdPct.v.textContent = num(b.pct, 1) + ' %';
				rdR.v.textContent = num(b.R / 1000, 0);
				lastA = setTeX(rowA, '\\( g=\\dfrac{GM}{R^{2}}=\\dfrac{(6.674\\times10^{-11})('
					+ sci(b.M, 3) + ')}{(' + sci(b.R, 3) + ')^{2}}=' + num(b.g, 3) + '\\ \\mathrm{m/s^{2}} \\)', lastA);
				lastB = setTeX(rowB, '\\( W=mg=1\\times' + num(b.g, 3) + '=' + num(b.W, 3)
					+ '\\ \\mathrm{N} \\)（地球 ' + num(gEarth, 2) + ' m/s² 的 ' + num(b.pct, 1) + '%）', lastB);
			}
		}

		/* ---------------- 月球重力場景 ---------------- */

		function applyBody() {
			var b = BODIES[body];
			var info = bodyOf(body);
			bodySphere.material.map = b.tex === 'earth' ? D.earthTexture()
				: b.tex === 'moon' ? D.moonTexture() : null;
			bodySphere.material.color.set(b.tex ? '#ffffff' : b.c);
			bodySphere.material.needsUpdate = true;

			/* 讀數與球面上的 R / M 由同一組數字生出來, 不會各印各的 */
			if (bodyLabel) dropLabel(bodyLabel, moon);
			if (massLabel) dropLabel(massLabel, moon);
			if (readLabel) dropLabel(readLabel, moon);
			bodyLabel = mkLeft(b.t + '　R = ' + num(b.R / 1000, 0) + ' km', '#cfd6de', moon, -7.4, 3.6, 0, 1);
			massLabel = mkLeft('M = ' + sciText(b.M, 3) + ' kg', '#cfd6de', moon, -7.4, 3.6, 0, 0);

			readLabel = mkLabel('1 kg → ' + num(info.W, 3) + ' N', '#ffb9a2', moon);
			readLabel.position.set(0, BR + 1.62, 0);

			var len = W_GAIN * (info.g / gEarth);
			wArrow.position.set(0, blockBottom, 0);
			wArrow.quaternion.setFromUnitVectors(UPV, DOWNV);
			wArrow.scale.set(1, Math.max(0.05, len), 1);
			wLabel.position.set(0.62, blockBottom - Math.max(0.2, len), 0);
		}

		/* ---------------- 模式 ---------------- */

		function setMode(m) {
			mode = m;
			solar.visible = m === 0;
			moon.visible = m === 1;
			gPlanet.classList.toggle('g3-hide', m !== 0);
			gBody.classList.toggle('g3-hide', m !== 1);
			rdsSolar.classList.toggle('g3-hide', m !== 0);
			rdsMoon.classList.toggle('g3-hide', m !== 1);
			if (m === 0) {
				camDist = 12.2;
				stage.look({ yaw: -0.9, pitch: 0.52, dist: camDist, target: [0, 0, 0] });
			} else {
				camDist = 13.5;
				stage.look({ yaw: -0.72, pitch: 0.34, dist: camDist, target: [0, 2.2, 0] });
			}
			note.textContent = m === 0 ? NOTE_SOLAR : NOTE_MOON;
			fitLabels();
			syncUI();
			stage.render();
		}

		/* ---------------- 互動 ---------------- */

		btSolar.addEventListener('click', function () { setMode(0); });
		btMoon.addEventListener('click', function () { setMode(1); });

		function bindPlanet(idx) {
			planetBtns[idx].addEventListener('click', function () {
				sel = idx;
				buildInfo(idx);
				fitLabels();
				syncUI();
				stage.render();
			});
		}
		for (i = 0; i < PLANETS.length; i++) bindPlanet(i);

		function bindBody(idx) {
			bodyBtns[idx].addEventListener('click', function () {
				body = idx;
				applyBody();
				fitLabels();
				syncUI();
				stage.render();
			});
		}
		for (i = 0; i < BODIES.length; i++) bindBody(i);

		inSpeed.addEventListener('input', function () {
			var v = parseFloat(inSpeed.value);
			if (!isFinite(v)) return;
			speed = ctx.clamp(v, SPEED_MIN, SPEED_MAX);
			outSpeed.textContent = num(speed, 1) + '×';
			stage.render();
		});

		/* ---------------- 起跑 ---------------- */

		var NOTE_SOLAR = '五顆行星的 T²/r³ 都印成同一個數，這條常數就是太陽的質量；軌道半徑以 AU^0.42 壓縮，'
			+ '週期按真實比例走（水星 4.8 s 一圈，木星 1× 下要近四分鐘）。';
		var NOTE_MOON = '同一塊 1 kg，換一顆天體就換一個重量：g = GM/R²，箭長與 g 成正比。'
			+ '三顆球刻意畫成同樣大小，免得把「比較輕」誤讀成「比較小」。';
		if (ctx.reduced) {
			NOTE_SOLAR += REDUCED;
			NOTE_MOON += REDUCED;
		}

		buildInfo(sel);
		applyBody();
		/* 尺寸變了要重畫: ctx.reduced 時沒有動畫迴圈, 只重算緩衝區會留下一片空白 */
		ctx.onResize(function () {
			fitLabels();
			stage.render();
		});
		fitLabels();
		setMode(0);

		if (!ctx.reduced) {
			stage.animate(function (dt) {
				if (dead) return;
				var years = dt * speed / YEARS_PER_SEC;
				if (!(years > 0)) return;
				for (var j = 0; j < PLANETS.length; j++) {
					var T = PLANETS[j].yr;
					if (!(T > 0)) continue;
					pivots[j].rotation.y += TAU * years / T;
				}
			});
		}

		return {
			destroy: function () {
				dead = true;
				labels.length = 0;
				infoSprites = [];
			}
		};
	});
})();
