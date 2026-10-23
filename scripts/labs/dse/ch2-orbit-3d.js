/**
 * ch2-orbit-3d.js — 衛星軌道 (DSE 物理 · II.g · 實驗 17)
 *
 * 為什麼世界尺度要「軌道環固定、地球按 R_E/r 縮」:
 * h 從 200 km 到 35786 km, r 只差 6 倍, 但兩個圓如果用同一比例畫, ISS 的軌道
 * 會貼在地球表面上縮成一條線。把軌道環釘在世界半徑 R_VIEW 上, 地球半徑就自己
 * 變成 R_VIEW·R_E/r —— 學生看到的是「同步軌道離地面多遠」這個比例, 不是兩個
 * 各畫各的圓。所以畫面上永遠是同一條環, 變的是地球。
 *
 * 箭長不是同一個比例尺, 理由寫在 A_SQRT 那行: v 只差 2.7 倍, 線性畫沒問題;
 * a 差 47 倍, 線性畫會讓同步軌道那支短到看不見, 所以 g 箭長取 √a, 並在
 * .dl-note 明講。兩個量的真實數字一律在讀數裡, 不靠箭頭長度量。
 */
(function () {
	'use strict';

	var TAU = Math.PI * 2;
	var R_E = 6371;                 /* km */
	var GM = 3.986e14;              /* m³/s² */
	var H_MIN = 200;
	var H_MAX = 40000;
	var H_DEF = 400;
	var R_VIEW = 5.4;               /* 軌道環固定的世界半徑 */
	var CAM_DIST = 20;
	var FOV = 45;
	var V_UNIT = 0.30;              /* 世界單位 / (km/s) */
	var A_SQRT = 0.55;              /* 世界單位 / √(m/s²) */
	/* 地球自轉週期取「恆星日」86164 s, 不是太陽日 86400 s:
	   同步軌道要追的是地球相對慣性空間的轉動, 用太陽日會讓 35 786 km 那一格自己漂 ~1°/日,
	   畫面就看不出「定點」。兩者的差別在於地球同時繞太陽公轉。 */
	var SIDEREAL = 86164;           /* s */
	var SPEED_K = 1200;             /* 播放加速倍率: 地球自轉一圈 71.8 s, ISS 一圈 4.6 s */
	var TRAIL_N = 56;
	var TRAIL_SPAN = 1.15;          /* rad */
	var LABEL_PX = 21;              /* 標籤貼圖的總高(CSS px): 字身約 54%, 所以 21px 貼圖 ≈ 11px 字 */
	var LABEL_REF = 446;            /* 標籤基準的畫布高: 小畫布上標籤要等比縮, 否則會互相壓 */
	var PRESETS = [{ t: 'ISS', h: 400 }, { t: 'GPS', h: 20200 }, { t: '地球同步', h: 35786 }];
	var VIEWS = [{ t: '斜視', yaw: -0.9, pitch: 0.42 }, { t: '赤道', yaw: 0, pitch: 0.05 }, { t: '極區', yaw: 0, pitch: 1.2 }];

	/* 自己畫地球貼圖(不碰 three-kit 的共用貼圖): kit 那張只有九塊平塗的綠色,
	   在 400 km 的低軌道把地球放到畫面一半時就看得出來是色塊。這裡一張 1024x512:
	   海洋緯向漸層 + 十二塊鋸齒大陸(每塊三層) + 山脈細線 + 雲帶 + 有鋸齒邊的極冠。
	   種子固定, 所以每次載入都一樣; 只畫一次, 成本與 kit 那張同級。 */
	function makeEarthTexture(THREE) {
		var W = 1024;
		var H = 512;
		var cv = document.createElement('canvas');
		cv.width = W;
		cv.height = H;
		var g = cv.getContext('2d');
		var seed = 20240917;
		function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

		var sea = g.createLinearGradient(0, 0, 0, H);
		sea.addColorStop(0, '#0c2740');
		sea.addColorStop(0.22, '#123f61');
		sea.addColorStop(0.5, '#1a5c88');
		sea.addColorStop(0.78, '#123f61');
		sea.addColorStop(1, '#0c2740');
		g.fillStyle = sea;
		g.fillRect(0, 0, W, H);

		/* 一圈不大於 3 級的緯度帶: 讓海面不是單一色塊 */
		var y;
		for (y = 0; y < H; y += 6) {
			g.fillStyle = 'rgba(255,255,255,' + (0.006 + rnd() * 0.014).toFixed(4) + ')';
			g.fillRect(0, y, W, 3);
		}

		function blob(cx, cy, r, jag, fill) {
			g.beginPath();
			var steps = 22;
			var i;
			for (i = 0; i <= steps; i++) {
				var a = (i / steps) * Math.PI * 2;
				var rr = r * (1 - jag + rnd() * jag * 2);
				var x = cx + Math.cos(a) * rr * 1.28;
				var yy = cy + Math.sin(a) * rr * 0.8;
				if (i === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
			}
			g.closePath();
			g.fillStyle = fill;
			g.fill();
		}

		/* 十二塊陸地: 中心固定, 邊緣用種子亂數長, 所以每次載入都一模一樣 */
		var land = [[150, 168, 74], [232, 236, 46], [318, 148, 52], [430, 198, 96],
			[512, 296, 62], [556, 392, 40], [686, 206, 104], [782, 292, 58],
			[862, 128, 50], [918, 318, 66], [104, 322, 50], [640, 86, 56]];
		var k;
		for (k = 0; k < land.length; k++) {
			var L = land[k];
			/* 淺灘 → 主體 → 乾燥內陸, 三層疊出海岸的深淺 */
			blob(L[0], L[1], L[2] * 1.1, 0.2, 'rgba(70,120,140,.55)');
			blob(L[0], L[1], L[2], 0.34, '#3c6741');
			blob(L[0] + 10, L[1] - 6, L[2] * 0.66, 0.3, '#5a7c49');
			blob(L[0] - 8, L[1] + 9, L[2] * 0.4, 0.34, '#86824f');
		}

		/* 山脈: 幾筆深綠細線, 讓大陸裡面有結構 */
		g.strokeStyle = 'rgba(36,58,40,.55)';
		g.lineWidth = 2.2;
		for (k = 0; k < 46; k++) {
			var L2 = land[Math.floor(rnd() * land.length)];
			var a0 = rnd() * Math.PI * 2;
			var rr0 = rnd() * L2[2] * 0.8;
			var sx = L2[0] + Math.cos(a0) * rr0 * 1.28;
			var sy = L2[1] + Math.sin(a0) * rr0 * 0.8;
			g.beginPath();
			g.moveTo(sx, sy);
			g.lineTo(sx + (rnd() - 0.5) * 34, sy + (rnd() - 0.5) * 18);
			g.stroke();
		}

		/* 雲帶: 低透明度的橢圓, 不蓋掉大陸輪廓 */
		g.fillStyle = 'rgba(255,255,255,.10)';
		for (k = 0; k < 60; k++) {
			var cx = rnd() * W;
			var cy = 40 + rnd() * (H - 80);
			var rw = 18 + rnd() * 54;
			g.beginPath();
			g.ellipse(cx, cy, rw, rw * (0.24 + rnd() * 0.2), 0, 0, Math.PI * 2);
			g.fill();
		}

		/* 極冠: 白底 + 鋸齒邊 */
		g.fillStyle = '#e9eff4';
		g.fillRect(0, 0, W, 22);
		g.fillRect(0, H - 26, W, 26);
		for (k = 0; k < 96; k++) {
			var px = rnd() * W;
			g.beginPath();
			g.arc(px, 22 + rnd() * 18, 3 + rnd() * 12, 0, Math.PI * 2);
			g.fill();
			g.beginPath();
			g.arc(px, H - 26 - rnd() * 18, 3 + rnd() * 11, 0, Math.PI * 2);
			g.fill();
		}

		var tex = new THREE.CanvasTexture(cv);
		tex.wrapS = THREE.RepeatWrapping;
		return tex;
	}

	window.DSELab.define('orbit-3d', function (mount, ctx) {
		var D = window.DSEThree;
		var THREE = window.THREE;
		var doc = document;
		var dead = false;

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

		/* 3.986×10^14: 公式列要跟讀數用同一組數字, 所以自己從數值生科學記號 */
		function sci(x, d) {
			if (typeof x !== 'number' || !isFinite(x) || x === 0) return '0';
			var e = Math.floor(Math.log(Math.abs(x)) / Math.LN10);
			var m = x / Math.pow(10, e);
			var ms = m.toFixed(d);
			if (Math.abs(parseFloat(ms)) >= 10) { m = m / 10; e += 1; ms = m.toFixed(d); }
			return ms + '\\times10^{' + e + '}';
		}

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
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

		var gOrbit = el('div', 'dl-panel__group');
		gOrbit.appendChild(el('span', 'dl-panel__label', '軌道 r = R_E + h'));

		var fieldH = el('div', 'dl-field');
		fieldH.appendChild(el('span', 'dl-field__label', '高度 h'));
		var inH = el('input', 'dl-range');
		inH.type = 'range';
		inH.min = String(H_MIN);
		inH.max = String(H_MAX);
		inH.step = '1';
		inH.value = String(H_DEF);
		inH.setAttribute('aria-label', '軌道高度 h（公里）');
		var outH = el('output', 'dl-field__val', H_DEF + ' km');
		fieldH.appendChild(inH);
		fieldH.appendChild(outH);
		gOrbit.appendChild(fieldH);

		var segP = el('div', 'dl-seg');
		var preBtns = [];
		var i;
		for (i = 0; i < PRESETS.length; i++) {
			var pb = el('button', 'dl-btn', PRESETS[i].t);
			pb.type = 'button';
			pb.setAttribute('aria-pressed', 'false');
			segP.appendChild(pb);
			preBtns.push(pb);
		}
		gOrbit.appendChild(segP);

		var badge = el('span', 'dl-badge g3-badge', '同步軌道 · T ≈ 24 h');
		gOrbit.appendChild(badge);

		var gView = el('div', 'dl-panel__group');
		gView.appendChild(el('span', 'dl-panel__label', '視角'));
		var segV = el('div', 'dl-seg');
		var viewBtns = [];
		for (i = 0; i < VIEWS.length; i++) {
			var vb = el('button', 'dl-btn', VIEWS[i].t);
			vb.type = 'button';
			vb.setAttribute('aria-pressed', 'false');
			segV.appendChild(vb);
			viewBtns.push(vb);
		}
		gView.appendChild(segV);

		var rds = el('div', 'dl-readouts g3-rd');
		var rdR = cell('r（km）');
		var rdV = cell('v（km/s）');
		var rdT = cell('T（min）');
		var rdTh = cell('T（h）');
		var rdA = cell('a（m/s²）');
		var rdK = cell('週期 / ISS');
		rds.appendChild(rdR.root);
		rds.appendChild(rdV.root);
		rds.appendChild(rdT.root);
		rds.appendChild(rdTh.root);
		rds.appendChild(rdA.root);
		rds.appendChild(rdK.root);

		var texBox = el('div', 'g3-tex');
		var rowA = el('span', 'g3-tex__row', '');
		var rowB = el('span', 'g3-tex__row', '');
		texBox.appendChild(rowA);
		texBox.appendChild(rowB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gOrbit);
		panel.appendChild(gView);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		grid.appendChild(stageCol);
		grid.appendChild(panel);
		mount.appendChild(grid);

		/* ---------------- 3D ---------------- */

		var stage = D.createStage(canvas, ctx, {
			aspect: '16 / 10',
			background: '#04070e',
			camera: { yaw: VIEWS[0].yaw, pitch: VIEWS[0].pitch, dist: CAM_DIST, target: [0, 0, 0] }
		});
		if (!stage) return null;
		stage.orbit({ minPitch: 0.02, maxPitch: 1.35, minDist: 12, maxDist: 44 });

		/* 太空沒有大氣散射, 只留一盞平行光(太陽)與一點環境光, 免得背光面全黑 */
		var sun = new THREE.DirectionalLight(0xffffff, 1.2);
		sun.position.set(8, 5, 7);
		stage.scene.add(sun);
		stage.scene.add(new THREE.AmbientLight(0x8fa6c2, 0.33));

		stage.add(D.sky('#03060c', '#0a1526'));
		stage.add(D.stars(900));

		/* 地球: 貼圖自己畫(見 makeEarthTexture), 尺度由 R_E/r 決定 */
		var earthTex = makeEarthTexture(THREE);
		var earth = D.sphere(1, '#ffffff', { segments: 64, roughness: 0.92, metalness: 0 });
		earth.material.map = earthTex;
		earth.material.needsUpdate = true;
		stage.add(earth);

		/* 地表標記: 赤道、經度 0 的小紅點 + 白桿, 掛在地球上所以跟著地表轉。
		   父層會乘上地球半徑 k, 所以這裡反向縮放, 讓標記的世界尺寸與軌道高度無關
		   (高軌道地球只剩 0.8 單位, 不反向縮放的話記號會小到看不見)。 */
		var MARKER_W = 2.2;             /* 標記的世界尺寸係數 */
		var markerAnchor = new THREE.Group();
		markerAnchor.position.set(1, 0, 0);
		var markerScale = new THREE.Group();
		markerAnchor.add(markerScale);
		var pole = D.cylinder(0.011, 0.011, 0.16, '#f2ede2', { segments: 8 });
		pole.geometry.translate(0, 0.08, 0);       /* 底端在原點, 往 +y 長 */
		pole.rotation.z = -Math.PI / 2;            /* +y → +x, 也就是往球外 */
		pole.material = new THREE.MeshBasicMaterial({ color: 0xf2ede2 });
		pole.userData.noShadow = true;
		var poleTip = D.sphere(0.045, '#e0301e', { segments: 12 });
		poleTip.position.set(0.16, 0, 0);
		poleTip.material = new THREE.MeshBasicMaterial({ color: 0xe0301e });
		markerScale.add(pole);
		markerScale.add(poleTip);
		earth.add(markerAnchor);

		/* 大氣層: 稍大一點的背面 + 加法混色球, 只在輪廓外緣留下一圈淡藍 */
		var glow = D.sphere(1, '#9fd0ff', { segments: 48, roughness: 1 });
		glow.material = new THREE.MeshBasicMaterial({
			color: 0x8ec6ff, transparent: true, opacity: 0.42,
			side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
		});
		stage.add(glow);

		/* 軌道環: 半徑固定, 變的是地球 */
		/* 軌道環: 低軌道時 400 km 只有 1.06 R_E, 一般灰線會整個消失在球體邊緣,
		   所以用不受光的亮青線 (MeshBasicMaterial) 拉出來 */
		stage.add(D.ring(R_VIEW - 0.02, R_VIEW + 0.02, '#8fe6ff', { opacity: 0.85, axis: 'y', segments: 160 }));

		/* 尾跡: kit 沒有折線, 這一段用 three 的 Line 自己拉 */
		var trailPos = new Float32Array(TRAIL_N * 3);
		var trailGeo = new THREE.BufferGeometry();
		var trailAttr = new THREE.BufferAttribute(trailPos, 3);
		trailGeo.setAttribute('position', trailAttr);
		var trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
			color: 0x8ec6f0, transparent: true, opacity: 0.7
		}));
		trail.frustumCulled = false;
		stage.add(trail);

		/* 衛星: 一個方盒 + 兩片太陽板; 尺寸固定在世界單位, 因為環的半徑固定 */
		var sat = new THREE.Group();
		var satBody = D.box(0.48, 0.48, 0.48, '#d8d1bf', { roughness: 0.45, metalness: 0.3 });
		/* 兩片太陽板各自帶一圈淺色外框, 362px 寬時才看得出是太陽板而不是一根白棒 */
		var frameL = D.box(0.9, 0.03, 0.56, '#c3ccd8', { roughness: 0.5, metalness: 0.3 });
		var frameR = D.box(0.9, 0.03, 0.56, '#c3ccd8', { roughness: 0.5, metalness: 0.3 });
		var wingL = D.box(0.83, 0.036, 0.48, '#2c4a7a', { roughness: 0.3, metalness: 0.55 });
		var wingR = D.box(0.83, 0.036, 0.48, '#2c4a7a', { roughness: 0.3, metalness: 0.55 });
		frameL.position.set(-0.69, 0, 0);
		frameR.position.set(0.69, 0, 0);
		wingL.position.set(-0.69, 0.008, 0);
		wingR.position.set(0.69, 0.008, 0);
		sat.add(satBody);
		sat.add(frameL);
		sat.add(frameR);
		sat.add(wingL);
		sat.add(wingR);
		stage.add(sat);

		/* 兩支箭: 都以 +Y 建一次, 之後只改 quaternion 與 scale.y */
		var vArrow = D.arrow3([0, 0, 0], [0, 1, 0], '#54c07a', { width: 0.09 });
		var aArrow = D.arrow3([0, 0, 0], [0, 1, 0], '#e2603f', { width: 0.09 });
		stage.add(vArrow);
		/* 重力箭頭指向地心, 低軌道時整支都在地球裡面: 力圖本來就畫在物體之上,
		   所以關掉深度測試, 否則 h 小的時候它會整支消失 */
		aArrow.traverse(function (o) {
			if (o.isMesh && o.material) { o.material.depthTest = false; o.renderOrder = 10; }
		});
		stage.add(aArrow);

		/* 量度尺: 由地表拉到軌道環, 讓 h 與 R_E 的長度可以直接比 */
		var ruler = D.cylinder(0.035, 0.035, 1, '#d7dbe4', { segments: 8 });
		ruler.rotation.z = -Math.PI / 2;      /* 圓柱的軸由 +Y 轉到 +X */
		ruler.userData.noShadow = true;
		stage.add(ruler);
		var capA = D.box(0.055, 0.44, 0.055, '#d7dbe4', { roughness: 0.6 });
		var capB = D.box(0.055, 0.44, 0.055, '#d7dbe4', { roughness: 0.6 });
		stage.add(capA);
		stage.add(capB);

		/* ---------------- 標籤 ---------------- */

		var labels = [];      /* { sp, ratio } */
		var lblH = null;
		var lblHText = '';
		var camDist = CAM_DIST;

		function mkLabel(text, color) {
			var sp = D.label(text, color, { size: 1, pad: 6 });
			labels.push({ sp: sp, ratio: sp.scale.x / sp.scale.y });
			stage.add(sp);
			return sp;
		}

		function dropLabel(sp) {
			for (var j = 0; j < labels.length; j++) {
				if (labels[j].sp === sp) { labels.splice(j, 1); break; }
			}
			stage.remove(sp);
			if (sp.material) {
				if (sp.material.map) sp.material.map.dispose();
				sp.material.dispose();
			}
		}

		/* 標籤的世界字高跟著畫布高度換算, 1280 與 320 上看到的字級才一樣 */
		function fitLabels() {
			if (dead) return;
			var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
			var hPx = rect && rect.height ? rect.height : (rect && rect.width ? rect.width * 0.625 : 226);
			var worldPerPx = (2 * camDist * Math.tan(FOV * Math.PI / 360)) / Math.max(1, hPx);
			/* 小畫布上標籤不跟著縮: 362px 寬時 21px 的字只剩 8px 高, 直接讀不出來。
			   改成小畫布反而給大一點的貼圖(24.6px ≈ 9px 字身), 1280 仍是 21px。 */
			var px = LABEL_PX + (1 - Math.min(1, hPx / LABEL_REF)) * 7;
			var s = worldPerPx * px;
			for (var i2 = 0; i2 < labels.length; i2++) {
				labels[i2].sp.scale.set(labels[i2].ratio * s, s, 1);
			}
		}

		var lblEarth = mkLabel('地球', '#e8e2d2');
		lblH = mkLabel('h = 400 km', '#c9c3b4');
		var lblV = mkLabel('v', '#7fdf9e');
		var lblA = mkLabel('g', '#ff9a80');
		lblA.material.depthTest = false;
		lblA.renderOrder = 11;

		lblEarth.position.set(0, -1.6, 0);

		/* ---------------- 物理 ---------------- */

		var def = { h: H_DEF, rKm: R_E + H_DEF, v: 0, T: 0, a: 0, ratio: 1 };
		var st = { h: H_DEF, rKm: R_E + H_DEF, v: 0, T: 0, a: 0, ratio: 1 };

		function physics(h) {
			var r = (R_E + h) * 1000;                       /* m */
			st.h = h;
			st.rKm = R_E + h;
			if (!(r > 0) || !(GM > 0)) {
				st.v = NaN; st.T = NaN; st.a = NaN; st.ratio = NaN;
				return st;
			}
			st.v = Math.sqrt(GM / r) / 1000;                /* km/s */
			st.T = TAU * Math.sqrt(r * r * r / GM);         /* s */
			st.a = GM / (r * r);                            /* m/s² */
			st.ratio = def.T > 0 ? st.T / def.T : NaN;
			return st;
		}

		physics(H_DEF);
		def.v = st.v; def.T = st.T; def.a = st.a;

		/* ---------------- 場景更新 ---------------- */

		/* 衛星角與地表標記角從同一個值出發: 一開場衛星就壓在標記上方,
		   之後漂不漂完全由 ω_sat 與 ω_earth 決定 */
		var phase = 2.5;
		var earthSpin = 2.5;
		var UPV = new THREE.Vector3(0, 1, 0);
		var dirTmp = new THREE.Vector3();

		function orient(g, px, pz, dx, dz, len) {
			dirTmp.set(dx, 0, dz);
			if (dirTmp.lengthSq() < 1e-9) dirTmp.set(0, 0, 1);
			dirTmp.normalize();
			g.position.set(px, 0, pz);
			g.quaternion.setFromUnitVectors(UPV, dirTmp);
			g.scale.set(1, Math.max(0.02, len), 1);
		}

		function place() {
			var cs = Math.cos(phase);
			var sn = Math.sin(phase);
			var px = cs * R_VIEW;
			var pz = sn * R_VIEW;
			sat.position.set(px, 0, pz);

			var vLen = st.v * V_UNIT;
			var aLen = A_SQRT * Math.sqrt(Math.max(0, st.a));
			orient(vArrow, px, pz, -sn, cs, vLen);          /* 切線 */
			orient(aArrow, px, pz, -cs, -sn, aLen);         /* 指向地心 */

			lblV.position.set(px - sn * (vLen + 0.85), 0.55, pz + cs * (vLen + 0.85));
			lblA.position.set(px - cs * (aLen + 0.85), 0.55, pz - sn * (aLen + 0.85));

			/* 標記與地球同向: rotation.y 用 -earthSpin, 地表點的世界角才會跟衛星一樣往 +φ 增 */
			earth.rotation.y = -earthSpin;

			for (var i2 = 0; i2 < TRAIL_N; i2++) {
				var a2 = phase - (i2 / (TRAIL_N - 1)) * TRAIL_SPAN;
				trailPos[i2 * 3] = Math.cos(a2) * R_VIEW;
				trailPos[i2 * 3 + 1] = 0;
				trailPos[i2 * 3 + 2] = Math.sin(a2) * R_VIEW;
			}
			trailAttr.needsUpdate = true;
		}

		/* 取景: 需要裝得下「環 + 地表以下的標籤」, 所以距離由 R_VIEW 與地球半徑算出來,
		   而不是寫死一個值 —— 低軌道地球大、高軌道地球小, 兩者都要有邊距 */
		function fitCamera() {
			var k = R_VIEW * R_E / st.rKm;
			var needH = Math.max(R_VIEW * 1.06, k + 2.9);
			var needW = R_VIEW + 2.4;
			var dist = Math.max(needH / 0.4142, needW / 0.6628) * 1.04;
			dist = ctx.clamp(dist, 12, 44);
			if (Math.abs(dist - camDist) > 0.15) {
				camDist = dist;
				stage.look({ dist: dist });
			}
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

		function refresh(drawNow) {
			physics(curH);

			outH.textContent = num(curH, 0) + ' km';
			rdR.v.textContent = num(st.rKm, 0);
			rdV.v.textContent = num(st.v, 3);
			rdT.v.textContent = num(st.T / 60, 1);
			rdTh.v.textContent = num(st.T / 3600, 2);
			rdA.v.textContent = num(st.a, 3);
			rdK.v.textContent = num(st.ratio, 2);

			/* 同步軌道: 只有一個半徑能讓 T = 24 h, 這是這支實驗的結論 */
			var sync = isFinite(st.T) && st.T > 86000 && st.T < 86400;
			badge.classList.toggle('g3-hide', !sync);
			rdTh.v.classList.toggle('g3-acc', sync);

			for (var i2 = 0; i2 < PRESETS.length; i2++) {
				var on = Math.abs(curH - PRESETS[i2].h) < 1;
				preBtns[i2].classList.toggle('is-on', on);
				preBtns[i2].setAttribute('aria-pressed', on ? 'true' : 'false');
			}

			var rM = st.rKm * 1000;
			lastA = setTeX(rowA, '\\( v=\\sqrt{\\dfrac{GM}{r}}=\\sqrt{\\dfrac{' + sci(GM, 3) + '}{'
				+ sci(rM, 3) + '}}=' + num(st.v, 2) + '\\ \\mathrm{km/s} \\)', lastA);
			lastB = setTeX(rowB, '\\( T=2\\pi\\sqrt{\\dfrac{r^{3}}{GM}}=' + num(st.T / 60, 1)
				+ '\\ \\mathrm{min}=' + num(st.T / 3600, 2) + '\\ \\mathrm{h} \\)', lastB);

			/* 3D: 地球半徑 = R_VIEW · R_E / r, 量度尺補滿到環 */
			var k = R_VIEW * R_E / st.rKm;
			earth.scale.setScalar(k);
			glow.scale.setScalar(k * 1.028);
			markerScale.scale.setScalar(MARKER_W / Math.max(0.001, k));
			var gap = Math.max(0.001, R_VIEW - k);
			ruler.scale.y = gap;
			ruler.position.x = -(k + gap / 2);
			lblEarth.position.set(0, -k - 1.7, 0);
			/* 高度標籤: 文字隨 h 變, 換字才重建貼圖(拖滑桿時有界, 舊的立刻釋放) */
			var hTxt = 'h = ' + num(curH, 0) + ' km';
			if (hTxt !== lblHText) {
				lblHText = hTxt;
				if (lblH) dropLabel(lblH);
				lblH = mkLabel(hTxt, '#c9c3b4');
			}

			/* 量度尺兩端的端標: h 小的時候兩端只差 0.3 單位, 沒有端標看不出那是一段長度 */
			capA.position.set(-k, 0, 0);
			capB.position.set(-R_VIEW, 0, 0);
			lblH.position.set(-R_VIEW - 1.05, 1.15, 0);
			fitCamera();

			place();
			fitLabels();
			if (drawNow) stage.render();
		}

		/* ---------------- 互動 ---------------- */

		var curH = H_DEF;

		function setH(v) {
			if (typeof v !== 'number' || !isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, H_MIN, H_MAX));
			if (n === curH) { refresh(false); return; }
			curH = n;
			inH.value = String(n);
			/* 改軌道就讓衛星回到「地表標記正上方」再出發: 這只是重設初始條件,
			   之後漂不漂完全由兩個角速度決定(同步軌道因此一定鎖得住) */
			phase = earthSpin;
			refresh(true);
		}

		inH.addEventListener('input', function () { setH(parseFloat(inH.value)); });

		function bindPreset(idx) {
			preBtns[idx].addEventListener('click', function () { setH(PRESETS[idx].h); });
		}
		for (i = 0; i < PRESETS.length; i++) bindPreset(i);

		function markView(idx) {
			for (var j = 0; j < viewBtns.length; j++) {
				var on = j === idx;
				viewBtns[j].classList.toggle('is-on', on);
				viewBtns[j].setAttribute('aria-pressed', on ? 'true' : 'false');
			}
		}

		function bindView(idx) {
			viewBtns[idx].addEventListener('click', function () {
				stage.look({ yaw: VIEWS[idx].yaw, pitch: VIEWS[idx].pitch });
				markView(idx);
				stage.render();
			});
		}
		for (i = 0; i < VIEWS.length; i++) bindView(i);
		markView(0);

		/* 手動拖過視角, 「目前是哪個視角」就不再成立: 把標記收回 */
		canvas.addEventListener('pointerdown', function () {
			for (var j = 0; j < viewBtns.length; j++) {
				viewBtns[j].classList.remove('is-on');
				viewBtns[j].setAttribute('aria-pressed', 'false');
			}
		});

		/* ---------------- 起跑 ---------------- */

		var noteText = '地球按 86164 s（恆星日）自轉、衛星按 √(GM/r³) 公轉，兩者同向，畫面以 '
			+ SPEED_K + '× 加速：赤道上的紅點會告訴你同步軌道是不是真的「定點」。'
			+ '改變高度會把衛星重新放回地表標記的正上方，之後的漂移才是真實的。'
			+ '箭長 v ∝ v、g 按 √a 壓縮（a 隨 r 掉 47 倍，線性畫會消失）。';
		if (ctx.reduced) noteText += REDUCED;
		note.textContent = noteText;

		/* 尺寸變了要重畫: ctx.reduced 時沒有動畫迴圈, 只重算緩衝區會留下一片空白 */
		ctx.onResize(function () {
			fitLabels();
			refresh(false);
			/* 只有 renderer 已經存在才重畫: 否則這個 handler 會在 build 期就把
			   three 的 renderer 建起來, 破壞 kit 的 lazy 建立(一頁 6 個 stage 會撞 GPU 上限) */
			if (stage.renderer) stage.render();
		});
		fitLabels();
		refresh(false);
		markView(0);

		if (!ctx.reduced) {
			stage.animate(function (dt) {
				if (dead) return;
				var sec = dt * SPEED_K;                       /* 加速倍率只乘這一次 */
				var r = st.rKm * 1000;
				var wSat = r > 0 ? Math.sqrt(GM / (r * r * r)) : 0;   /* √(GM/r³) */
				phase += wSat * sec;
				if (phase > TAU) phase -= TAU; else if (phase < 0) phase += TAU;
				earthSpin += (TAU / SIDEREAL) * sec;
				if (earthSpin > TAU) earthSpin -= TAU;
				place();
			});
		}

		return {
			destroy: function () {
				dead = true;
				labels.length = 0;
				if (earthTex && earthTex.dispose) earthTex.dispose();
			}
		};
	});
})();
