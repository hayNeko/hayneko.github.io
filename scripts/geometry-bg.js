/**
 * geometry-bg.js — Canvas 动态几何背景
 *
 * 画面构成(全部由 canvas 实时绘制):
 *   1. 缓慢游走的 RGB 辉光团       —— 提供底色层次, 极低透明度
 *   2. 透视网格 + 地平线            —— "科技感" 的空间纵深
 *   3. 漂浮的线框多边形             —— 主体几何图形, 缓慢自转 + 漂移
 *   4. 邻近图形之间的连线           —— 星座式结构
 *   5. 偶发的扫描脉冲               —— 页面切换时由 Router 触发
 *
 * 性能策略: 图形数量按视口面积自适应; DPR 上限 2; 页面不可见时暂停。
 */
(function (global) {
	'use strict';

	var canvas = document.getElementById('bg-canvas');
	if (!canvas) return;
	var ctx = canvas.getContext('2d', { alpha: true });
	if (!ctx) return;

	var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
	/* 统一走 MotionPref, 这样 ?motion=full 也能把背景动画打开 */
	var reduceMotion = global.MotionPref
		? !!global.MotionPref.reduced
		: !!(mq && mq.matches);

	var PALETTE = [
		[255, 77, 90],    // red
		[60, 224, 123],   // green
		[77, 157, 255],   // blue
		[230, 237, 243]   // white (深色主题)
	];

	var WHITE_ON_DARK = [230, 237, 243];
	var WHITE_ON_LIGHT = [12, 18, 26];

	var state = {
		w: 0,
		h: 0,
		dpr: 1,
		time: 0,
		last: 0,
		raf: 0,
		running: false,
		shapes: [],
		glows: [],
		pulses: [],
		/* 浅色主题下网格/连线/白色图形都改画深色墨点 */
		dark: true
	};

	/** 网格与连线的基色(随主题切换) */
	function ink(alpha) {
		return state.dark
			? 'rgba(230,237,243,' + alpha + ')'
			: 'rgba(12,18,26,' + alpha + ')';
	}

	/** 图形的 RGB(白色随主题取反) */
	function shapeRGB(s) {
		var c = s.isWhite ? (state.dark ? WHITE_ON_DARK : WHITE_ON_LIGHT) : PALETTE[s.colorIdx];
		return c[0] + ',' + c[1] + ',' + c[2];
	}

	var TAU = Math.PI * 2;

	function rand(min, max) { return min + Math.random() * (max - min); }

	/* ------------------------------------------------------------ 初始化 */

	function makeShape(seedY) {
		var sides = [3, 3, 4, 4, 5, 6, 6, 8][Math.floor(Math.random() * 8)];
		var area = Math.max(1, state.w * state.h);
		var r = rand(0.04, 0.12) * Math.sqrt(area);
		r = Math.min(r, Math.min(state.w, state.h) * 0.16);
		// 白色图形占多数, RGB 作为点缀
		var roll = Math.random();
		var colorIdx = roll < 0.46 ? 3 : Math.floor(Math.random() * 3);
		var isWhite = colorIdx === 3;
		return {
			x: rand(-0.1, 1.1) * state.w,
			y: seedY == null ? rand(-0.05, 1.05) * state.h : seedY,
			r: Math.max(18, r),
			sides: sides,
			rot: rand(0, TAU),
			rotSpeed: rand(-0.12, 0.12) * (reduceMotion ? 0 : 1),
			vx: rand(-0.16, 0.16) * (reduceMotion ? 0 : 1),
			vy: rand(-0.12, 0.12) * (reduceMotion ? 0 : 1),
			colorIdx: colorIdx,
			isWhite: isWhite,
			color: PALETTE[colorIdx],
			alpha: isWhite ? rand(0.06, 0.12) : rand(0.14, 0.3),
			lineWidth: isWhite ? 1 : rand(0.9, 1.6),
			inner: Math.random() < 0.55,
			pulse: 0
		};
	}

	function makeGlow() {
		return {
			x: Math.random(),
			y: Math.random(),
			r: rand(0.28, 0.62),
			color: PALETTE[Math.floor(Math.random() * 3)],
			alpha: rand(0.05, 0.11),
			vx: rand(-0.02, 0.02),
			vy: rand(-0.02, 0.02)
		};
	}

	function build() {
		var area = state.w * state.h;
		var count = Math.round(area / 105000);
		count = Math.max(5, Math.min(13, count));

		state.shapes = [];
		for (var i = 0; i < count; i++) state.shapes.push(makeShape());

		state.glows = [];
		for (var j = 0; j < 3; j++) state.glows.push(makeGlow());
	}

	function resize() {
		var w = global.innerWidth;
		var h = global.innerHeight;
		var dpr = Math.min(global.devicePixelRatio || 1, 2);

		if (w === state.w && h === state.h && dpr === state.dpr) return;

		state.w = w;
		state.h = h;
		state.dpr = dpr;

		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		canvas.style.width = w + 'px';
		canvas.style.height = h + 'px';
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		build();
	}

	/* ------------------------------------------------------------ 绘制 */

	function drawGlows(t) {
		for (var i = 0; i < state.glows.length; i++) {
			var g = state.glows[i];
			var cx = (g.x + Math.sin(t * 0.00007 + i * 2.1) * 0.06) * state.w;
			var cy = (g.y + Math.cos(t * 0.00009 + i * 1.7) * 0.06) * state.h;
			var radius = g.r * Math.max(state.w, state.h) * 0.6;
			var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
			var rgb = g.color[0] + ',' + g.color[1] + ',' + g.color[2];
			grad.addColorStop(0, 'rgba(' + rgb + ',' + g.alpha + ')');
			grad.addColorStop(0.55, 'rgba(' + rgb + ',' + (g.alpha * 0.35) + ')');
			grad.addColorStop(1, 'rgba(' + rgb + ',0)');
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(cx, cy, radius, 0, TAU);
			ctx.fill();
		}
	}

	function drawGrid(t) {
		var horizon = state.h * 0.62;
		var vpX = state.w * 0.5;
		var depth = state.h - horizon;
		if (depth <= 0) return;

		var scroll = reduceMotion ? 0 : (t * 0.00006) % 1;
		var rows = 18;
		var i, p, y, a;

		ctx.lineWidth = 1;

		// 水平线: 越靠近视点越密, 且向下滚动
		for (i = 0; i < rows; i++) {
			p = (i + scroll) / rows;
			y = horizon + depth * Math.pow(p, 2.3);
			if (y > state.h + 4) continue;
			a = 0.012 + 0.1 * Math.pow(p, 1.7);
			ctx.strokeStyle = ink(a.toFixed(4));
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(state.w, y);
			ctx.stroke();
		}

		// 垂直线: 全部汇聚到消失点
		var cols = Math.max(10, Math.round(state.w / 76));
		for (i = -cols; i <= cols; i++) {
			var xBottom = vpX + i * (state.w / cols) * 1.4;
			a = 0.09 - 0.055 * Math.min(1, Math.abs(i) / cols);
			ctx.strokeStyle = ink(a.toFixed(4));
			ctx.beginPath();
			ctx.moveTo(vpX, horizon);
			ctx.lineTo(xBottom, state.h);
			ctx.stroke();
		}

		// 地平线: RGB 渐变
		var lg = ctx.createLinearGradient(0, 0, state.w, 0);
		lg.addColorStop(0, 'rgba(255,77,90,0)');
		lg.addColorStop(0.22, 'rgba(255,77,90,0.28)');
		lg.addColorStop(0.5, 'rgba(60,224,123,0.3)');
		lg.addColorStop(0.78, 'rgba(77,157,255,0.28)');
		lg.addColorStop(1, 'rgba(77,157,255,0)');
		ctx.strokeStyle = lg;
		ctx.lineWidth = 1.4;
		ctx.beginPath();
		ctx.moveTo(0, horizon);
		ctx.lineTo(state.w, horizon);
		ctx.stroke();

		// 消失点微光
		var vg = ctx.createRadialGradient(vpX, horizon, 0, vpX, horizon, 190);
		vg.addColorStop(0, 'rgba(77,157,255,0.16)');
		vg.addColorStop(1, 'rgba(77,157,255,0)');
		ctx.fillStyle = vg;
		ctx.beginPath();
		ctx.arc(vpX, horizon, 190, 0, TAU);
		ctx.fill();
	}

	function polygonPath(x, y, r, sides, rot) {
		ctx.beginPath();
		for (var i = 0; i < sides; i++) {
			var a = rot + (i / sides) * TAU;
			var px = x + Math.cos(a) * r;
			var py = y + Math.sin(a) * r;
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
		ctx.closePath();
	}

	function updateShapes(dt) {
		var pad = 140;
		for (var i = 0; i < state.shapes.length; i++) {
			var s = state.shapes[i];
			s.x += s.vx * dt;
			s.y += s.vy * dt;
			s.rot += s.rotSpeed * dt * 0.001;
			if (s.pulse > 0) s.pulse = Math.max(0, s.pulse - dt * 0.0016);

			var margin = s.r + pad;
			if (s.x < -margin) s.x = state.w + margin;
			if (s.x > state.w + margin) s.x = -margin;
			if (s.y < -margin) s.y = state.h + margin;
			if (s.y > state.h + margin) s.y = -margin;
		}
	}

	function drawLinks() {
		var maxDist = Math.min(state.w, state.h) * 0.42;
		for (var i = 0; i < state.shapes.length; i++) {
			for (var j = i + 1; j < state.shapes.length; j++) {
				var a = state.shapes[i];
				var b = state.shapes[j];
				var dx = a.x - b.x;
				var dy = a.y - b.y;
				var d = Math.sqrt(dx * dx + dy * dy);
				if (d > maxDist) continue;
				var alpha = (1 - d / maxDist) * 0.1;
				ctx.strokeStyle = ink(alpha.toFixed(4));
				ctx.lineWidth = 0.7;
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.stroke();
			}
		}
	}

	function drawShapes() {
		for (var i = 0; i < state.shapes.length; i++) {
			var s = state.shapes[i];
			var rgb = shapeRGB(s);
			ctx.strokeStyle = 'rgba(' + rgb + ',' + s.alpha + ')';
			ctx.lineWidth = s.lineWidth;
			polygonPath(s.x, s.y, s.r, s.sides, s.rot);
			ctx.stroke();

			if (s.inner) {
				ctx.strokeStyle = 'rgba(' + rgb + ',' + (s.alpha * 0.45) + ')';
				ctx.lineWidth = 0.8;
				polygonPath(s.x, s.y, s.r * 0.58, s.sides, -s.rot * 1.4 + 0.4);
				ctx.stroke();
			}

			// 顶点小方块
			ctx.fillStyle = 'rgba(' + rgb + ',' + Math.min(0.6, s.alpha * 2.4) + ')';
			for (var k = 0; k < s.sides; k++) {
				var a = s.rot + (k / s.sides) * TAU;
				ctx.fillRect(s.x + Math.cos(a) * s.r - 1.4, s.y + Math.sin(a) * s.r - 1.4, 2.8, 2.8);
			}

			if (s.pulse > 0.001) {
				var pr = s.r * (1 + (1 - s.pulse) * 1.1);
				ctx.strokeStyle = 'rgba(' + rgb + ',' + (s.pulse * 0.5) + ')';
				ctx.lineWidth = 1.2;
				polygonPath(s.x, s.y, pr, s.sides, s.rot);
				ctx.stroke();
			}
		}
	}

	function drawPulses(dt) {
		for (var i = state.pulses.length - 1; i >= 0; i--) {
			var p = state.pulses[i];
			p.r += p.speed * dt;
			p.alpha -= dt * 0.00055;
			if (p.alpha <= 0) { state.pulses.splice(i, 1); continue; }
			var lg = ctx.createRadialGradient(p.x, p.y, Math.max(0, p.r - 40), p.x, p.y, p.r);
			lg.addColorStop(0, 'rgba(' + p.color + ',0)');
			lg.addColorStop(0.75, 'rgba(' + p.color + ',' + (p.alpha * 0.7) + ')');
			lg.addColorStop(1, 'rgba(' + p.color + ',0)');
			ctx.strokeStyle = lg;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, TAU);
			ctx.stroke();
		}
	}

	/* ------------------------------------------------------------ 主循环 */

	function frame(now) {
		if (!state.running) return;
		if (!state.last) state.last = now;
		var dt = Math.min(48, now - state.last);
		state.last = now;
		state.time = now;

		ctx.clearRect(0, 0, state.w, state.h);
		drawGlows(now);
		drawGrid(now);
		updateShapes(dt);
		drawLinks();
		drawShapes();
		drawPulses(dt);

		state.raf = global.requestAnimationFrame(frame);
	}

	function start() {
		if (state.running) return;
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

	function pulse(color) {
		var rgb = color === 'red' ? '255,77,90'
			: color === 'green' ? '60,224,123'
			: color === 'white' ? '230,237,243'
			: '77,157,255';
		state.pulses.push({
			x: rand(0.15, 0.85) * state.w,
			y: rand(0.2, 0.8) * state.h,
			r: 10,
			speed: rand(0.35, 0.6),
			alpha: rand(0.35, 0.6),
			color: rgb
		});
		if (state.pulses.length > 6) state.pulses.shift();
	}

	/** 主题切换: 网格/连线/白色图形在浅色下改用深色墨点 */
	function setTheme(isDark) {
		var next = !!isDark;
		if (next !== state.dark) {
			state.dark = next;
			build();
		}
	}

	function init() {
		state.dark = (document.documentElement.getAttribute('data-theme') || 'dark') !== 'light';
		resize();
		start();

		var resizeTimer = 0;
		global.addEventListener('resize', function () {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(resize, 160);
		});

		document.addEventListener('visibilitychange', function () {
			if (document.hidden) stop();
			else start();
		});
	}

	global.GeometryBG = {
		pulse: pulse,
		start: start,
		stop: stop,
		refresh: resize,
		setTheme: setTheme,
		state: state
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, { once: true });
	} else {
		init();
	}
})(window);
