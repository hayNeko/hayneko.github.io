/**
 * geometry-bg.js — ASCII 字符背景(终端屏幕)
 *
 * 这是一块**字符网格**: 每个字符占一个整数行列, 没有浮点坐标。
 * 绘制前一律取整到格(gx = round(x / cell) * cell), 装配进度也量化成整数步,
 * 所以位移是"上一帧在某格消失、下一帧在邻格出现", 不是平滑滑动。
 *
 * 画面构成:
 *   · 上方: 一颗 **3D ASCII 星球 + 行星环**(自转, 并且**正面朝向鼠标**)
 *   · 中间: 一行 "MIKU ICHINOSE"(离屏栅格化的等宽字形)
 *   · 下方: 当前路由路径(如 ~/home)
 *   · 四周: 散字
 * 切路由时**文字与路径整体打乱再重排**(scramble), 星球不受影响。
 *
 * 对外接口(Router / app.js 在用): pulse / start / stop / refresh / setTheme / readAccent / state
 */
(function (global) {
	'use strict';

	var canvas = document.getElementById('bg-canvas');
	if (!canvas) return;
	var ctx = canvas.getContext('2d', { alpha: true });
	if (!ctx) return;

	var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
	var reduceMotion = global.MotionPref
		? !!global.MotionPref.reduced
		: !!(mq && mq.matches);

	/* 一律用浏览器自带的等宽字体 */
	var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "Courier New", monospace';
	var TAU = Math.PI * 2;

	var TEXT = 'MIKU ICHINOSE';
	var pathText = '/home';                 /* 由路由决定, 见 currentPathText() */

	var RAMP_FACE = ['@', '#', '%', '&', '$', '*', '+'];
	var RAMP_SOFT = ['#', '%', '*', '+', '=', '~', '-', ':', '.', ',', "'"];
	var RAMP_PLANET = ['@', '#', '%', '&', '$', '*', '+', '=', '~', '-', ':'];

	var AMBIENT = ('01<>[]{}+-=*/\\|#@$%&!?;:.,\'~^' +
		'ABCDEFGHIKLMNOQRSTUVWXZ').split('');

	/* 正面朝向鼠标 */
	var POINTER_FOLLOW = true;
	/*
	 * 文字部分的静止朝向 = 0。
	 * 只要带一点 yaw, 整个字面就会 cos(yaw) 横向压缩(0.24 时约 3%), 86 列里就会有
	 * 若干相邻列被压到同一格 —— 字上出现一排"缺口", 看起来就是凹凸不平。
	 * 立体感改由暗影层的整数格偏移提供(见 LAYER_DX / LAYER_DY), 字面保持严格轴对齐。
	 */
	var REST_YAW = 0;

	var DEPTH = 3;             /* 文字: 字面 + 2 层暗影 */
	var DEPTH_STEP = 4.2;      /* 只在打开鼠标跟随时才起作用(给 z 一点厚度) */
	var LAYER_DX = 1;          /* 每层往右错 1 格 */
	var LAYER_DY = 1;          /* 每层往下错 1 格 → 右下方向的立体影 */

	var MARGIN_LEFT = 22;
	var MARGIN_TOP = 96;

	/* ------------------------------------------------------------ 状态 */

	var state = {
		w: 0, h: 0, dpr: 1,
		time: 0, last: 0, raf: 0,
		running: false, started: false,
		assembled: false,
		dark: true,
		particles: [],
		pulses: [],
		cols: 0, rows: 0,
		cell: 8, fontPx: 8,
		originX: 0, originY: 0,
		planetCY: 0, planetR: 9, planetPts: [],
		textTop: 0,
		t0: 0,
		yaw: REST_YAW, tilt: 0,
		planetYaw: 0, planetTilt: 0,
		sweepY: -1,
		pointer: { x: 0, y: 0, tx: 0, ty: 0, has: false },
		lockedCount: 0,
		particleTotal: 0,
		narrow: false,
		quiet: 0,
		accent: [60, 224, 123]
	};

	function rand(a, b) { return a + Math.random() * (b - a); }

	/** 当前在时间轴上的位置(ms) —— 粒子的 delay 都以它为基准 */
	function relNow() {
		var now = state.time || (global.performance && global.performance.now ? global.performance.now() : 0);
		return Math.max(0, now - (state.t0 || 0));
	}
	function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
	function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
	function smoothstep(x) { return x * x * (3 - 2 * x); }

	/* ------------------------------------------------------------ 颜色 */

	function parseColor(raw) {
		if (!raw) return null;
		raw = String(raw).trim();
		var m = raw.match(/^#([0-9a-f]{3})$/i);
		if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
		m = raw.match(/^#([0-9a-f]{6})$/i);
		if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
		m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
		if (m) return [+m[1], +m[2], +m[3]];
		return null;
	}

	function readAccent() {
		var raw = '';
		try { raw = global.getComputedStyle(document.documentElement).getPropertyValue('--accent'); } catch (e) { raw = ''; }
		var c = parseColor(raw);
		if (c) state.accent = c;
	}

	function accentInk(alpha, lift) {
		var c = state.accent;
		var r = c[0], g = c[1], b = c[2];
		if (lift) {
			/* 越亮的地方越接近白, 星球受光面才有"高光" */
			r = Math.round(r + (255 - r) * lift);
			g = Math.round(g + (255 - g) * lift);
			b = Math.round(b + (255 - b) * lift);
		}
		if (!state.dark) { r = Math.round(r * 0.52); g = Math.round(g * 0.52); b = Math.round(b * 0.52); }
		return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(3) + ')';
	}

	function ambientInk(alpha) { return 'rgba(' + (state.dark ? '150,180,205' : '90,105,120') + ',' + alpha.toFixed(3) + ')'; }

	/* ------------------------------------------------------------ 当前路径 */

	function currentPathText() {
		var r = global.Router;
		try {
			if (r && typeof r.path === 'function') return String(r.path()).replace('~', '');
		} catch (e) { /* 忽略 */ }
		return '/home';
	}

	/* ------------------------------------------------------------ 字形掩码 */

	/**
	 * 把 "MIKU ICHINOSE" + 路径栅格化成掩码: 每个像素 = 一个字符格。
	 * 两行都**居中**; 路径那行小一号, 太长时再缩到主行宽度的 66% 以内。
	 */
	function rasterizeMask(cols) {
		var probe = document.createElement('canvas').getContext('2d');
		if (!probe) return null;
		probe.font = '900 100px ' + MONO;
		var u = probe.measureText(TEXT).width / 100;
		if (!u) return null;

		var fontPx = cols / u;
		var subPx = fontPx * 0.66;
		probe.font = '900 ' + subPx.toFixed(2) + 'px ' + MONO;
		var pathW = probe.measureText(pathText).width || 1;
		if (pathW > cols * 0.6) subPx *= (cols * 0.6) / pathW;

		/* 两行按"大写字高"排, 中间只留一点点缝 —— 早先按 1.28/1.5 倍的行高排,
		   两行之间白白空出十几格, 整块字型被撑得老高 */
		var capH1 = Math.ceil(fontPx * 0.82);
		var capH2 = Math.ceil(subPx * 0.86);
		var gap = Math.ceil(subPx * 0.62);
		var lh1 = capH1;
		var height = capH1 + gap + capH2;

		var cv = document.createElement('canvas');
		cv.width = cols;
		cv.height = height;
		var g = cv.getContext('2d');
		if (!g) return null;
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		g.fillStyle = '#fff';
		g.font = '900 ' + fontPx.toFixed(2) + 'px ' + MONO;
		g.fillText(TEXT, cols / 2, capH1 / 2);
		g.font = '900 ' + subPx.toFixed(2) + 'px ' + MONO;
		g.fillText(pathText, cols / 2, capH1 + gap + capH2 / 2);

		var data;
		try { data = g.getImageData(0, 0, cols, height).data; } catch (e) { return null; }

		var pts = [], minX = cols, maxX = -1, minY = height, maxY = -1;
		for (var y = 0; y < height; y++) {
			for (var x = 0; x < cols; x++) {
				if (data[(y * cols + x) * 4 + 3] < 128) continue;
				pts.push([x, y]);
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
		if (!pts.length) return null;

		var w = maxX - minX + 1;
		var h = maxY - minY + 1;
		var pathRowAt = capH1 + gap * 0.5 - minY;    /* 掩码内, 这行往下就是路径 */
		var cells = [];
		for (var i = 0; i < pts.length; i++) {
			var cx = pts[i][0] - minX, cy = pts[i][1] - minY;
			cells.push({ x: cx, y: cy, sub: cy >= pathRowAt });
		}
		return { cols: w, rows: h, cells: cells };
	}

	/* ------------------------------------------------------------ 文字目标点 */

	function buildLayers(mask) {
		var cols = mask.cols, rows = mask.rows;
		/*
		 * ⚠️ 取整中心: 必须用 Math.floor, 不能用 cols / 2、rows / 2。
		 * 掩码是 86×21 —— 行数是**奇数**, rows/2 = 10.5, 于是每一行都精确落在
		 * round(x / cell) 的半格边界上: 透视让 y 缩放 ±1% 就足够让同一行的左端
		 * 落到第 n 行、右端落到第 n+1 行, 字看起来就"这儿凸一块那儿凹一块"。
		 * 换成 Math.floor 之后模型坐标全是整数, 半格以内的小扰动都不会翻行。
		 */
		var halfCols = Math.floor(cols / 2);
		var halfRows = Math.floor(rows / 2);
		var layers = [];
		for (var j = 0; j < DEPTH; j++) layers.push([]);

		for (var i = 0; i < mask.cells.length; i++) {
			var cellx = mask.cells[i].x, celly = mask.cells[i].y;
			var shade = 1 - (celly / Math.max(1, rows - 1)) * 0.42 - (cellx / Math.max(1, cols - 1)) * 0.16;
			shade = clamp(shade, 0.1, 1);

			/* 路径那行: 只有字面, 更暗更小, 不参与挤出 */
			if (mask.cells[i].sub) {
				layers[0].push({
					mx: cellx - halfCols,
					my: celly - halfRows,
					mz: 0, layer: 0,
					ch: RAMP_FACE[clamp(Math.round((1 - shade) * 4), 0, RAMP_FACE.length - 1)],
					tAlpha: 0.6
				});
				continue;
			}

			for (var j = 0; j < DEPTH; j++) {
				if (j === 1 && ((cellx + celly) & 1)) continue;
				if (j >= 2 && ((cellx & 1) || (celly & 1))) continue;
				var deep = j / (DEPTH - 1);
				var light = clamp(shade * (1 - deep * 0.35), 0.05, 1);
				var ramp = j === 0 ? RAMP_FACE : RAMP_SOFT;
				var ch = j === 0
					? ramp[clamp(Math.round((1 - light) * (ramp.length - 1)), 0, ramp.length - 1)]
					: ramp[clamp(Math.floor((1 - light) * ramp.length), 0, ramp.length - 1)];
				layers[j].push({
					mx: cellx - halfCols + j * LAYER_DX,
					my: celly - halfRows + j * LAYER_DY,
					mz: j * DEPTH_STEP,
					layer: j,
					ch: ch,
					tAlpha: j === 0
						? clamp(0.4 + light * 0.42, 0.05, 0.84)
						: clamp((0.12 + light * 0.22) * Math.pow(0.6, j - 1), 0.03, 0.36)
				});
			}
		}
		return layers;
	}

	/* ------------------------------------------------------------ 星球 */

	/** 球面 + 两圈行星环; 每个点存模型坐标与法线(单位向量) */
	function buildPlanet(R) {
		var pts = [];
		var spacing = 1.5;                       /* 单位: 格 */
		var bands = Math.max(9, Math.round(Math.PI * R / spacing * 1.7));
		var b, k, lat, ringR, count, lon, a;

		for (b = 0; b < bands; b++) {
			lat = -Math.PI / 2 + Math.PI * (b + 0.5) / bands;
			ringR = Math.cos(lat) * R;
			count = Math.max(1, Math.round(TAU * ringR / spacing));
			for (k = 0; k < count; k++) {
				lon = TAU * k / count;
				var x = ringR * Math.cos(lon), yy = R * Math.sin(lat), z = ringR * Math.sin(lon);
				pts.push({ x: x, y: yy, z: z, n: [x / R, yy / R, z / R], kind: 0, band: 0 });
			}
		}

		var rings = [1.72, 2.08];      /* 环再铺开一点, 远看更像土星 */
		for (var ri = 0; ri < rings.length; ri++) {
			var rr = R * rings[ri];
			count = Math.round(TAU * rr / (spacing * 1.05));
			for (k = 0; k < count; k++) {
				a = TAU * k / count;
				pts.push({
					x: rr * Math.cos(a), y: 0, z: rr * Math.sin(a),
					n: [0, 1, 0], kind: 1, band: ri
				});
			}
		}
		return pts;
	}

	/* ------------------------------------------------------------ 投影 */

	var proj = { x: 0, y: 0 };

	function project(mx, my, mz) {
		var cell = state.cell;
		var x = mx * cell, y = my * cell, z = mz * cell;
		var ca = Math.cos(state.yaw), sa = Math.sin(state.yaw);
		var x1 = x * ca + z * sa;
		var z1 = -x * sa + z * ca;
		var cb = Math.cos(state.tilt), sb = Math.sin(state.tilt);
		var y1 = y * cb - z1 * sb;
		var z2 = y * sb + z1 * cb;
		var focal = cell * 900;
		var k = focal / (focal + z2);
		proj.x = state.originX + x1 * k;
		proj.y = state.originY + y1 * k;
		return proj;
	}

	/* ------------------------------------------------------------ 粒子(文字 + 散字) */

	var fillCursor = 0;
	var fillCells = [];

	function buildFillCells() {
		var cell = Math.max(7, state.cell);
		fillCells = [];
		for (var gy = cell * 0.5; gy < state.h; gy += cell) {
			for (var gx = cell * 0.5; gx < state.w; gx += cell) {
				if (Math.random() < 0.5) continue;
				fillCells.push([gx + rand(-cell * 0.3, cell * 0.3), gy + rand(-cell * 0.3, cell * 0.3)]);
			}
		}
		for (var i = fillCells.length - 1; i > 0; i--) {
			var j = (Math.random() * (i + 1)) | 0;
			var tmp = fillCells[i]; fillCells[i] = fillCells[j]; fillCells[j] = tmp;
		}
		fillCursor = 0;
	}

	function nextFillPos() {
		if (!fillCells.length) return [Math.random() * state.w, Math.random() * state.h];
		var p = fillCells[fillCursor % fillCells.length];
		fillCursor++;
		return [p[0], p[1]];
	}

	function makeDrifter() {
		var fall = Math.random() < 0.28 ? rand(0.02, 0.07) : 0;
		var pt = nextFillPos();
		return {
			x: pt[0], y: pt[1],
			head: Math.random() * TAU,
			speed: rand(0.012, 0.055),
			turn: rand(-0.001, 0.001),
			fall: fall,
			ch: pick(AMBIENT),
			seed: Math.random() * 1000,
			base: rand(0.1, 0.26),
			lock: 0,
			target: null,
			started: false,
			ax: 0, ay: 0, mx: 0, my: 0,
			delay: 0, dur: 1, steps: 8,
			flash: 0
		};
	}

	function wrap(p) {
		var m = state.cell * 2;
		if (p.x < -m) p.x = state.w + m;
		else if (p.x > state.w + m) p.x = -m;
		if (p.y < -m) p.y = state.h + m;
		else if (p.y > state.h + m) p.y = -m;
	}

	function drift(p, dt, t) {
		if (p.fall > 0) {
			p.y += p.fall * dt;
			p.x += Math.sin(t * 0.0006 + p.seed) * 0.03 * dt;
		} else {
			p.head += p.turn * dt;
			p.x += Math.cos(p.head) * p.speed * dt;
			p.y += Math.sin(p.head) * p.speed * dt * 0.7;
		}
		wrap(p);
		if (Math.random() < 0.003) p.ch = pick(AMBIENT);
	}

	function makeCurve(p, tx, ty) {
		var dx = tx - p.ax, dy = ty - p.ay;
		var len = Math.sqrt(dx * dx + dy * dy) || 1;
		var bow = rand(-1, 1) * Math.min(state.w, state.h) * rand(0.16, 0.4);
		p.mx = (p.ax + tx) / 2 + (-dy / len) * bow;
		p.my = (p.ay + ty) / 2 + (dx / len) * bow;
		p.steps = Math.max(6, Math.round(len / Math.max(4, state.cell)));
	}

	/** 只重建文字粒子(散字保持不动), 用于 resize / 换路由 */
	function assignTargets(mask, scrambleAll) {
		var layers = buildLayers(mask);
		var i, j;
		var layerTotal = 0;
		for (i = 0; i < layers.length; i++) layerTotal += layers[i].length;
		var face = layers[0] ? layers[0].length : 0;
		var need = Math.min(layerTotal, Math.max(face, 2400));

		var picked = [];
		for (j = 0; j < layers.length && picked.length < need; j++) {
			var band = layers[j];
			for (i = 0; i < band.length && picked.length < need; i++) picked.push(band[i]);
		}

		/* 散字: 只在第一次(或彻底重建时)生成 */
		var keep = [];
		if (!scrambleAll && state.particles.length) {
			for (i = 0; i < state.particles.length; i++) {
				if (!state.particles[i].target) keep.push(state.particles[i]);
			}
		}
		if (!keep.length) {
			var cellsTotal = (state.w * state.h) / (state.cell * state.cell);
			var fillers = clamp(Math.round(cellsTotal * 0.2), 200, 900);
			for (i = 0; i < fillers; i++) keep.push(makeDrifter());
		}

		var parts = [];
		for (i = 0; i < picked.length; i++) {
			var p = makeDrifter();
			var tg = picked[i];
			p.target = tg;
			p.ch = pick(AMBIENT);
			var d = Math.sqrt(tg.mx * tg.mx + tg.my * tg.my);
			p.delay = relNow() + clamp(d * 14 + rand(0, 480), 0, 1600);
			p.dur = rand(900, 1700);
			parts.push(p);
		}
		for (i = 0; i < keep.length; i++) parts.push(keep[i]);

		for (i = parts.length - 1; i > 0; i--) {
			var k = (Math.random() * (i + 1)) | 0;
			var tmp = parts[i]; parts[i] = parts[k]; parts[k] = tmp;
		}
		state.particles = parts;
		state.particleTotal = picked.length;
	}

	/**
	 * 切路由时把**文字与路径**彻底打乱再重排: 目标全部作废, 字符散回满屏,
	 * 然后重新吸附。星球不在这套粒子系统里, 所以它不受影响。
	 */
	function scrambleText() {
		var list = state.particles;
		var i;
		for (i = 0; i < list.length; i++) {
			var p = list[i];
			if (!p.target) continue;
			var pt = nextFillPos();
			p.x = pt[0]; p.y = pt[1];
			p.ch = pick(AMBIENT);
			p.started = false;
			p.lock = 0;
			p.delay = relNow() + rand(120, 1500);
			p.dur = rand(900, 1700);
			p.flash = 0;
		}
		state.quiet = 0;
		state.lockedCount = 0;
	}

	/* ------------------------------------------------------------ 尺寸 */

	function metrics() {
		state.narrow = state.w < 700;
		var wantCell = state.narrow ? 7 : 12.5;
		var artW = Math.min(state.w - (state.narrow ? 26 : 150), state.narrow ? 380 : 1080);
		var cols = clamp(Math.round(artW / wantCell), 36, 92);

		var mask = rasterizeMask(cols);
		if (!mask) {
			mask = { cols: 10, rows: 2, cells: [] };
			for (var yy = 0; yy < 2; yy++) for (var xx = 0; xx < 10; xx++) mask.cells.push({ x: xx, y: yy, sub: false });
		}
		state.cols = mask.cols;
		state.rows = mask.rows;

		/* 字格: 稍微放大, 同时留出横向空隙(advance ≈ 0.55 格, 所以左右不会黏在一起) */
		var cell = clamp(Math.min(artW / mask.cols, (state.h * 0.38) / mask.rows), 5, 14.5);
		state.cell = cell;
		state.fontPx = clamp(cell * 0.92, 4.6, 14);

		/* 星球半径(格) —— 跟着字格走, 换视口时比例不变 */
		var R = clamp((state.narrow ? 92 : 118) / cell, 6, 16);
		state.planetR = R;
		state.planetPts = buildPlanet(R);

		/* 版面: 星球在上, 文字在中, 整组垂直居中 */
		/* 环几乎侧对着看(竖直方向被 tilt 压扁), 所以竖直占位按 1.18R 留就够了 */
		var planetHalf = R * 1.18;
		var gapCells = state.narrow ? 1.2 : 2.2;
		var totalCells = planetHalf * 2 + gapCells + mask.rows;
		var top = state.h * 0.47 - (totalCells * cell) / 2;

		state.originX = Math.round((state.w / 2) / cell) * cell;
		state.planetCY = Math.round((top + planetHalf * cell) / cell) * cell;
		state.originY = Math.round((top + planetHalf * 2 * cell + gapCells * cell + (mask.rows * cell) / 2) / cell) * cell;
		state.mask = mask;
	}

	function resize() {
		var w = global.innerWidth;
		var h = global.innerHeight;
		var dpr = Math.min(global.devicePixelRatio || 1, 1.5);
		if (w === state.w && h === state.h && dpr === state.dpr) return;

		var first = state.w === 0;
		state.w = w; state.h = h; state.dpr = dpr;

		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		canvas.style.width = w + 'px';
		canvas.style.height = h + 'px';
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		pathText = currentPathText();
		metrics();
		buildFillCells();
		assignTargets(state.mask, true);
		if (first) return;

		if (state.assembled) {
			for (var i = 0; i < state.particles.length; i++) {
				var p = state.particles[i];
				if (!p.target) continue;
				p.started = true; p.lock = 1; p.ch = p.target.ch;
				var pt = project(p.target.mx, p.target.my, p.target.mz);
				p.x = pt.x; p.y = pt.y;
			}
		}
	}

	/* ------------------------------------------------------------ 画星球 */

	var LIGHT = (function () {
		var v = [-0.42, -0.58, -0.7], n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
		return [v[0] / n, v[1] / n, v[2] / n];
	})();

	/**
	 * 3D ASCII 星球 + 行星环。
	 * 朝向: **正面朝向鼠标** —— 鼠标往右, 球面右转; 鼠标往上, 球面低头朝向指针。
	 * (旋转矩阵按 x' = x·cos + z·sin, z' = −x·sin + z·cos, 法线用同一套,
	 *  于是"朝向鼠标"的符号是: yaw = −pointer.x, tilt = +pointer.y。)
	 */
	function drawPlanet(t) {
		var cell = state.cell;
		var Rpx = state.planetR * cell;
		var cx = state.originX, cy = state.planetCY;
		var spin = reduceMotion ? 0.6 : (t - state.t0) * 0.00042;

		var yaw = state.planetYaw, tilt = state.planetTilt;
		var ca = Math.cos(yaw), sa = Math.sin(yaw);
		var cb = Math.cos(tilt), sb = Math.sin(tilt);
		var cs = Math.cos(spin), ss = Math.sin(spin);
		var focal = cell * 900;

		var pts = state.planetPts;
		var list = [];
		for (var i = 0; i < pts.length; i++) {
			var p = pts[i];
			/* 自转 */
			var x0 = p.x * cs + p.z * ss;
			var z0 = -p.x * ss + p.z * cs;
			var y0 = p.y;
			/* 场景朝向 */
			var x1 = x0 * ca + z0 * sa;
			var z1 = -x0 * sa + z0 * ca;
			var y1 = y0 * cb - z1 * sb;
			var z2 = y0 * sb + z1 * cb;
			/* 法线跟着转, 用来算受光 */
			var nx0 = p.n[0] * cs + p.n[2] * ss;
			var nz0 = -p.n[0] * ss + p.n[2] * cs;
			var ny0 = p.n[1];
			var nx1 = nx0 * ca + nz0 * sa;
			var nz1 = -nx0 * sa + nz0 * ca;
			var ny1 = ny0 * cb - nz1 * sb;
			var nz2 = ny0 * sb + nz1 * cb;

			/* ⚠️ x1 / y1 / z2 的单位是**格**, 要乘回 cell 才是像素 */
			var kk = focal / (focal + z2 * cell);
			var px = cx + x1 * cell * kk;
			var py = cy + y1 * cell * kk;
			var ch, a;

			if (p.kind === 1) {
				/* 行星环: 藏在星球后面的那半圈要挖掉 */
				if (z2 > 0 && Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) < Rpx * 0.97) continue;
				ch = p.band === 0 ? '=' : '-';
				a = 0.22 + (p.band === 0 ? 0.12 : 0) - clamp(z2 / state.planetR, -1, 1) * 0.06;
			} else {
				if (nz2 > 0.22) continue;                       /* 背面剔除 */
				var shade = nx1 * LIGHT[0] + ny1 * LIGHT[1] + nz2 * LIGHT[2];
				if (shade <= 0.04) continue;                    /* 夜面不画 */
				ch = RAMP_PLANET[clamp(Math.round((1 - shade) * (RAMP_PLANET.length - 1)), 0, RAMP_PLANET.length - 1)];
				a = 0.1 + shade * 0.62;
			}

			list.push({ gx: Math.round(px / cell) * cell, gy: Math.round(py / cell) * cell, z: z2, ch: ch, a: a });
		}

		/* 画家算法: 远的先画 */
		list.sort(function (p, q) { return q.z - p.z; });
		for (i = 0; i < list.length; i++) {
			var it = list[i];
			if (it.gx < -cell || it.gx > state.w + cell || it.gy < -cell || it.gy > state.h + cell) continue;
			if (it.a < 0.03) continue;
			ctx.fillStyle = accentInk(Math.min(0.85, it.a), Math.min(0.5, Math.max(0, it.a - 0.4)));
			ctx.fillText(it.ch, it.gx, it.gy);
		}
	}

	/* ------------------------------------------------------------ 画文字 */

	function drawParticles(t, dt) {
		var cell = state.cell;
		var i, p, gx, gy, tx, ty, k, e, a;

		ctx.font = 'bold ' + state.fontPx.toFixed(2) + 'px ' + MONO;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		var sweep = -1;
		if (!reduceMotion) {
			var cyc = (t % 9000) / 9000;
			sweep = (-0.1 + cyc * 1.25) * state.h;
		}
		state.sweepY = sweep;

		var locked = 0;
		var quiet = state.quiet;

		for (i = 0; i < state.particles.length; i++) {
			p = state.particles[i];

			if (p.target && state.assembled) {
				if (!p.started) {
					if (t >= p.delay) {
						p.started = true;
						p.ax = p.x; p.ay = p.y;
						project(p.target.mx, p.target.my, p.target.mz);
						makeCurve(p, proj.x, proj.y);
					} else {
						drift(p, dt, t);
					}
				}
				if (p.started) {
					k = clamp((t - p.delay) / p.dur, 0, 1);
					var stepped = Math.floor(k * p.steps) / p.steps;   /* 一格一步 */
					e = smoothstep(stepped);
					var pt = project(p.target.mx, p.target.my, p.target.mz);
					tx = pt.x; ty = pt.y;
					if (k < 1) {
						var u = 1 - e;
						p.x = u * u * p.ax + 2 * u * e * p.mx + e * e * tx;
						p.y = u * u * p.ay + 2 * u * e * p.my + e * e * ty;
						p.lock = e;
					} else {
						p.x = tx; p.y = ty;
						p.lock = 1;
						locked++;
					}
					if (k > 0.4 && p.ch !== p.target.ch) {
						p.ch = p.target.ch;
						p.flash = 1;
					}
				}
			} else {
				drift(p, dt, t);
			}

			if (state.pulses.length) {
				for (var w = 0; w < state.pulses.length; w++) {
					var pv = state.pulses[w];
					var dx = p.x - pv.x, dy = p.y - pv.y;
					var dist = Math.sqrt(dx * dx + dy * dy) || 1;
					var ring = Math.abs(dist - pv.r);
					if (ring < cell * 3.5) {
						var f = (1 - ring / (cell * 3.5)) * pv.life;
						p.x += (dx / dist) * f * cell * 2;
						p.y += (dy / dist) * f * cell * 2;
						p.flash = Math.max(p.flash, f);
					}
				}
			}

			/* 字符网格: 取整到格 */
			gx = Math.round(p.x / cell) * cell;
			gy = Math.round(p.y / cell) * cell;
			if (gx < -cell || gx > state.w + cell || gy < -cell || gy > state.h + cell) continue;

			if (p.target) a = p.base + (p.target.tAlpha - p.base) * p.lock;
			else a = p.base * (1 - quiet * 0.55);
			if (p.flash > 0.001) a += p.flash * 0.3;
			if (sweep >= 0) {
				var sd = Math.abs(gy - sweep);
				if (sd < cell * 3) a += (1 - sd / (cell * 3)) * 0.25;
			}
			if (a > 0.9) a = 0.9;
			if (a < 0.02) { if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 0.0035); continue; }

			ctx.fillStyle = p.target ? accentInk(a, 0) : ambientInk(a);
			ctx.fillText(p.ch, gx, gy);

			if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 0.0035);
		}

		state.lockedCount = locked;

		for (i = state.pulses.length - 1; i >= 0; i--) {
			var q = state.pulses[i];
			q.r += q.speed * dt;
			q.life -= dt * 0.0011;
			if (q.life <= 0) state.pulses.splice(i, 1);
		}
	}

	/* ------------------------------------------------------------ 终端字幕 */

	var CMD = '$ ./render --glyph "' + TEXT + '" --planet --3d';

	function drawCaption(t) {
		if (!state.started) return;
		var fs = 11.5;
		var x = state.narrow ? 14 : MARGIN_LEFT;
		var y0 = 62;
		var y1 = y0 + fs * 1.7;

		ctx.font = 'bold ' + fs + 'px ' + MONO;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';

		var shown = CMD.length > 62 ? CMD.slice(0, 62) : CMD;
		var typed = Math.floor(clamp((t - 260) / 15, 0, shown.length));
		var prompt = '$ ';
		var cmdText = shown.slice(2, typed);
		ctx.fillStyle = ambientInk(0.2);
		ctx.fillText(prompt, x, y0);
		ctx.fillStyle = ambientInk(0.42);
		ctx.fillText(cmdText, x + ctx.measureText(prompt).width, y0);
		if ((t % 1060) < 620) {
			var cw = ctx.measureText(prompt + cmdText).width;
			ctx.fillStyle = ambientInk(typed < shown.length ? 0.36 : 0.2);
			ctx.fillRect(x + cw + 2, y0 - fs * 0.44, fs * 0.5, fs * 0.9);
		}

		var total = state.particleTotal;
		var pct = total ? Math.round((state.lockedCount / total) * 100) : 0;
		var status;
		if (pct >= 100) status = '[  ok  ] lock ......... ' + total + ' glyphs · ' + pathText;
		else if (pct > 0) status = '[ .. ] assemble ...... ' + pct + '%  (' + total + ' cells)';
		else status = '[ .. ] fill ......... ' + state.particles.length + ' chars';
		ctx.fillStyle = ambientInk(0.28);
		ctx.fillText(status, x, y1);
	}

	/* ------------------------------------------------------------ 主循环 */

	function render(t, dt) {
		ctx.clearRect(0, 0, state.w, state.h);

		state.pointer.x += (state.pointer.tx - state.pointer.x) * 0.08;
		state.pointer.y += (state.pointer.ty - state.pointer.y) * 0.08;

		if (POINTER_FOLLOW) {
			/* 正面朝向鼠标: 鼠标往右 → 球面右转; 鼠标往上 → 球面朝上看 */
			state.planetYaw = -state.pointer.x * 0.62;
			state.planetTilt = state.pointer.y * 0.34;
		} else {
			state.planetYaw = 0.2;
			state.planetTilt = -0.12;
		}
		state.yaw = REST_YAW;     /* 文字保持固定朝向(tilt = 0, 免得撕行) */
		state.tilt = 0;

		var rel = t - state.t0;
		var quietTarget = (state.assembled && state.particleTotal && state.lockedCount >= state.particleTotal) ? 1 : 0;
		state.quiet += (quietTarget - state.quiet) * Math.min(1, dt / 1200);

		drawPlanet(rel);
		drawParticles(rel, dt);
		drawCaption(rel);
	}

	function frame(now) {
		if (!state.running) return;
		if (!state.last) state.last = now;
		var dt = clamp(now - state.last, 0, 48);
		state.last = now;
		state.time = now;
		render(now, dt);
		state.raf = global.requestAnimationFrame(frame);
	}

	function start() {
		if (state.running) return;
		if (reduceMotion) {
			state.started = true;
			state.assembled = true;
			state.quiet = 1;
			state.yaw = REST_YAW; state.tilt = 0;
			state.planetYaw = 0.2; state.planetTilt = -0.12;
			for (var i = 0; i < state.particles.length; i++) {
				var p = state.particles[i];
				if (!p.target) continue;
				p.started = true; p.lock = 1; p.ch = p.target.ch;
				var pt = project(p.target.mx, p.target.my, p.target.mz);
				p.x = pt.x; p.y = pt.y;
			}
			ctx.clearRect(0, 0, state.w, state.h);
			drawPlanet(9000);
			drawParticles(9000, 16);
			drawCaption(9000);
			return;
		}
		state.running = true;
		state.last = 0;
		state.raf = global.requestAnimationFrame(frame);
	}

	function stop() {
		state.running = false;
		if (state.raf) global.cancelAnimationFrame(state.raf);
		state.raf = 0;
	}

	/* ------------------------------------------------------------ 对外 */

	function pulse(px, py) {
		if (reduceMotion) return;
		var r0 = Math.min(state.w, state.h) * 0.18;
		state.pulses.push({
			x: px == null ? rand(0.2, 0.8) * state.w : px,
			y: py == null ? rand(0.2, 0.8) * state.h : py,
			r: r0,
			speed: rand(0.35, 0.65),
			life: 1
		});
		if (state.pulses.length > 4) state.pulses.shift();
	}

	function setTheme(isDark) {
		state.dark = !!isDark;
		readAccent();
	}

	var timelineStarted = false;

	function beginTimeline() {
		if (timelineStarted) return;
		timelineStarted = true;
		state.started = true;
		state.assembled = true;
		state.t0 = global.performance && global.performance.now ? global.performance.now() : Date.now();
		start();
		pulse(state.w / 2, state.originY);
	}

	/** 切路由: 路径变了 → 重新栅格化掩码 + 把文字整体打乱重排(星球不动) */
	function onRouteChanged() {
		var next = currentPathText();
		if (next === pathText) return;
		pathText = next;
		metrics();                        /* 路径变了, 掩码要重画 */
		assignTargets(state.mask, false); /* 重建文字目标, 保留散字 */
		scrambleText();
		if (state.running) return;
		start();
	}

	function init() {
		state.dark = (document.documentElement.getAttribute('data-theme') || 'dark') !== 'light';
		readAccent();
		pathText = currentPathText();
		resize();
		start();

		document.addEventListener('accent:changed', function () { readAccent(); });
		document.addEventListener('route:changed', onRouteChanged);

		var resizeTimer = 0;
		global.addEventListener('resize', function () {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(function () { resize(); }, 200);
		});

		document.addEventListener('visibilitychange', function () {
			if (document.hidden) stop();
			else if (state.started && !reduceMotion) start();
		});

		global.addEventListener('pointermove', function (e) {
			state.pointer.tx = (e.clientX / state.w - 0.5) * 2;
			state.pointer.ty = (e.clientY / state.h - 0.5) * 2;
			state.pointer.has = true;
		}, { passive: true });

		var boot = document.getElementById('boot-screen');
		if (!boot) { beginTimeline(); return; }
		var tries = 0;
		var timer = setInterval(function () {
			tries++;
			var done = !document.body.contains(boot) || boot.classList.contains('is-done');
			if (done || tries > 40) {
				clearInterval(timer);
				beginTimeline();
			}
		}, 120);
	}

	global.GeometryBG = {
		pulse: pulse,
		start: start,
		stop: stop,
		refresh: resize,
		setTheme: setTheme,
		readAccent: readAccent,
		scramble: scrambleText,
		state: state
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, { once: true });
	} else {
		init();
	}
})(window);
