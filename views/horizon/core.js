/**
 * views/horizon/core.js — shared utilities for HAYNEKO HORIZON
 *
 * Math, deterministic noise, procedural canvas textures and the tiny save
 * layer. Everything below runs before the world or the game and never touches
 * the DOM, so other files can rely on it being present.
 */
(function (global) {
	'use strict';

	var HZ = global.HZ = global.HZ || {};
	HZ.VERSION = '1.0.0';
	HZ.ROUTE = 'horizon';

	/* ------------------------------------------------------------ math */
	var TAU = Math.PI * 2;
	HZ.TAU = TAU;
	HZ.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
	HZ.lerp = function (a, b, t) { return a + (b - a) * t; };
	HZ.mix = HZ.lerp;
	HZ.sstep = function (a, b, x) {
		if (a === b) return x < a ? 0 : 1;
		var t = HZ.clamp((x - a) / (b - a), 0, 1);
		return t * t * (3 - 2 * t);
	};
	HZ.damp = function (current, target, lambda, dt) {
		return HZ.lerp(current, target, 1 - Math.exp(-lambda * dt));
	};
	HZ.wrap = function (v, min, max) {
		var span = max - min;
		return min + ((v - min) % span + span) % span;
	};
	HZ.lerpAngle = function (a, b, t) {
		var d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
		return a + d * t;
	};
	HZ.dampAngle = function (a, b, lambda, dt) {
		return HZ.lerpAngle(a, b, 1 - Math.exp(-lambda * dt));
	};
	HZ.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
	HZ.smooth = function (t) { return t * t * (3 - 2 * t); };

	HZ.rng = function (seed) {
		var s = seed >>> 0 || 0x9e3779b9;
		return function () {
			s += 0x6D2B79F5;
			var t = s;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	};
	HZ.randRange = function (rng, a, b) { return a + (b - a) * rng(); };
	HZ.pick = function (rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; };

	/* ------------------------------------------------------------ noise */
	function hash2(x, y) {
		var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
		return n - Math.floor(n);
	}
	HZ.hash2 = hash2;

	HZ.noise2 = function (x, y) {
		var xi = Math.floor(x), yi = Math.floor(y);
		var xf = x - xi, yf = y - yi;
		var u = xf * xf * (3 - 2 * xf);
		var v = yf * yf * (3 - 2 * yf);
		var a = hash2(xi, yi), b = hash2(xi + 1, yi);
		var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
		return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
	};

	HZ.fbm = function (x, y, octaves, lacunarity, gain) {
		octaves = octaves || 4;
		lacunarity = lacunarity || 2;
		gain = gain == null ? 0.5 : gain;
		var amp = 0.5, freq = 1, sum = 0, norm = 0;
		for (var i = 0; i < octaves; i++) {
			sum += HZ.noise2(x * freq, y * freq) * amp;
			norm += amp;
			amp *= gain;
			freq *= lacunarity;
		}
		return sum / (norm || 1);
	};

	/* signed fbm, centred around 0 */
	HZ.sfbm = function (x, y, octaves) {
		return HZ.fbm(x, y, octaves || 4) * 2 - 1;
	};

	/* ------------------------------------------------------------ canvas textures */
	var SRGB = global.THREE ? global.THREE.SRGBColorSpace : 'srgb';

	HZ.canvas = function (w, h) {
		var c = global.document.createElement('canvas');
		c.width = w; c.height = h;
		return { canvas: c, ctx: c.getContext('2d') };
	};

	HZ.canvasTexture = function (canvas, repeatX, repeatY) {
		var THREE = global.THREE;
		var tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = SRGB;
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(repeatX || 1, repeatY || 1);
		tex.anisotropy = 8;
		return tex;
	};

	HZ.noiseFill = function (ctx, w, h, count, alpha, size) {
		for (var i = 0; i < count; i++) {
			var g = Math.floor(Math.random() * 70) + 155;
			ctx.fillStyle = 'rgba(' + g + ',' + g + ',' + (g - 4) + ',' + (Math.random() * alpha) + ')';
			var s = 1 + Math.random() * (size || 2);
			ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
		}
	};

	HZ.textures = {};

	HZ.textures.asphalt = function () {
		if (HZ.textures.__asphalt) return HZ.textures.__asphalt;
		var o = HZ.canvas(256, 512), ctx = o.ctx, w = 256, h = 512;
		var g = ctx.createLinearGradient(0, 0, 0, h);
		g.addColorStop(0, '#2b2c31');
		g.addColorStop(0.5, '#26272c');
		g.addColorStop(1, '#2b2c31');
		ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
		HZ.noiseFill(ctx, w, h, 7600, 0.16, 2.5);
		/* coarse aggregate */
		for (var i = 0; i < 1400; i++) {
			ctx.fillStyle = 'rgba(150,150,150,' + (0.02 + Math.random() * 0.08) + ')';
			ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
		}
		/* tyre polish strips */
		ctx.fillStyle = 'rgba(0,0,0,0.09)';
		ctx.fillRect(w * 0.27, 0, w * 0.1, h);
		ctx.fillRect(w * 0.63, 0, w * 0.1, h);
		/* hairline cracks */
		ctx.strokeStyle = 'rgba(10,10,12,0.35)';
		ctx.lineWidth = 1;
		for (var c = 0; c < 7; c++) {
			var x = Math.random() * w, y = Math.random() * h;
			ctx.beginPath(); ctx.moveTo(x, y);
			for (var k = 0; k < 5; k++) {
				x += (Math.random() - 0.5) * 26; y += Math.random() * 20;
				ctx.lineTo(x, y);
			}
			ctx.stroke();
		}
		/* edge lines (0.12 m at ~27 px per metre) */
		ctx.fillStyle = 'rgba(238,236,228,0.82)';
		ctx.fillRect(9, 0, 3, h);
		ctx.fillRect(w - 12, 0, 3, h);
		/* dashed centre line: 3 m dash / 3 m gap on a 12 m repeat */
		ctx.fillStyle = 'rgba(240,238,230,0.9)';
		for (var d = 18; d < h; d += 256) ctx.fillRect(w / 2 - 2, d, 4, 128);
		var tex = HZ.canvasTexture(o.canvas, 1, 1);
		HZ.textures.__asphalt = tex;
		return tex;
	};

	HZ.textures.gravel = function () {
		if (HZ.textures.__gravel) return HZ.textures.__gravel;
		var o = HZ.canvas(128, 128), ctx = o.ctx;
		ctx.fillStyle = '#8a8272'; ctx.fillRect(0, 0, 128, 128);
		HZ.noiseFill(ctx, 128, 128, 2600, 0.3, 2);
		var tex = HZ.canvasTexture(o.canvas, 4, 24);
		HZ.textures.__gravel = tex;
		return tex;
	};

	HZ.textures.grass = function () {
		if (HZ.textures.__grass) return HZ.textures.__grass;
		var o = HZ.canvas(256, 256), ctx = o.ctx;
		ctx.fillStyle = '#d9d9d2'; ctx.fillRect(0, 0, 256, 256);
		for (var i = 0; i < 12000; i++) {
			var g = 165 + Math.random() * 65;
			ctx.strokeStyle = 'rgba(' + g + ',' + g + ',' + (g - 12) + ',' + (0.1 + Math.random() * 0.22) + ')';
			ctx.lineWidth = 1;
			var x = Math.random() * 256, y = Math.random() * 256;
			ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 2.5, y - 2 - Math.random() * 3); ctx.stroke();
		}
		var tex = HZ.canvasTexture(o.canvas, 1, 1);
		HZ.textures.__grass = tex;
		return tex;
	};

	HZ.textures.windows = function (variant) {
		var key = '__win' + variant;
		if (HZ.textures[key]) return HZ.textures[key];
		var o = HZ.canvas(160, 256), ctx = o.ctx;
		var walls = variant === 1 ? ['#d9d4c8', '#c9c2b3'] : ['#c5c7c4', '#b0b4b1'];
		ctx.fillStyle = walls[0]; ctx.fillRect(0, 0, 160, 256);
		HZ.noiseFill(ctx, 160, 256, 1200, 0.08, 2);
		var cols = variant === 1 ? 4 : 5, rows = 8;
		var mw = 160 / cols, mh = 256 / rows;
		for (var r = 0; r < rows; r++) {
			for (var c = 0; c < cols; c++) {
				var x = c * mw + mw * 0.22, y = r * mh + mh * 0.2;
				var ww = mw * 0.56, wh = mh * 0.52;
				ctx.fillStyle = Math.random() < 0.24 ? '#ffd9a0' : (Math.random() < 0.12 ? '#9bb7c4' : '#3d4a52');
				ctx.fillRect(x, y, ww, wh);
				ctx.fillStyle = 'rgba(255,255,255,0.18)';
				ctx.fillRect(x, y, ww, 2);
				ctx.fillStyle = 'rgba(0,0,0,0.18)';
				ctx.fillRect(x, y + wh - 2, ww, 2);
			}
		}
		/* floor bands */
		ctx.fillStyle = 'rgba(80,70,60,0.14)';
		for (var rr = 0; rr < rows; rr++) ctx.fillRect(0, rr * mh + mh * 0.86, 160, 3);
		var tex = HZ.canvasTexture(o.canvas, 1, 1);
		HZ.textures[key] = tex;
		return tex;
	};

	HZ.textures.smoke = function () {
		if (HZ.textures.__smoke) return HZ.textures.__smoke;
		var o = HZ.canvas(64, 64), ctx = o.ctx;
		var g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
		g.addColorStop(0, 'rgba(255,255,255,0.85)');
		g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		HZ.textures.__smoke = tex;
		return tex;
	};

	HZ.textures.cloud = function () {
		if (HZ.textures.__cloud) return HZ.textures.__cloud;
		var o = HZ.canvas(256, 128), ctx = o.ctx;
		ctx.clearRect(0, 0, 256, 128);
		for (var i = 0; i < 22; i++) {
			var x = 20 + Math.random() * 216, y = 40 + Math.random() * 48, r = 18 + Math.random() * 32;
			var g = ctx.createRadialGradient(x, y, 0, x, y, r);
			g.addColorStop(0, 'rgba(255,245,232,0.5)');
			g.addColorStop(0.6, 'rgba(255,235,214,0.18)');
			g.addColorStop(1, 'rgba(255,235,214,0)');
			ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
		}
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		HZ.textures.__cloud = tex;
		return tex;
	};

	HZ.textures.banner = function (title, sub, theme) {
		var o = HZ.canvas(1024, 512), ctx = o.ctx;
		var colors = theme || ['#ff5b3c', '#ffb43c', '#1c2940'];
		var g = ctx.createLinearGradient(0, 0, 1024, 512);
		g.addColorStop(0, colors[0]); g.addColorStop(0.55, colors[1]); g.addColorStop(1, colors[2]);
		ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
		/* sun disc */
		var sg = ctx.createRadialGradient(800, 150, 10, 800, 150, 240);
		sg.addColorStop(0, 'rgba(255,246,220,0.9)'); sg.addColorStop(1, 'rgba(255,220,160,0)');
		ctx.fillStyle = sg; ctx.fillRect(0, 0, 1024, 512);
		/* horizon lines */
		ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
		for (var i = 0; i < 6; i++) {
			ctx.beginPath(); ctx.moveTo(0, 300 + i * 34); ctx.lineTo(1024, 300 + i * 34); ctx.stroke();
		}
		/* diagonal speed stripes */
		ctx.save(); ctx.translate(0, 0); ctx.rotate(-0.32);
		for (var s = -4; s < 18; s++) {
			ctx.fillStyle = 'rgba(255,255,255,' + (s % 3 === 0 ? 0.14 : 0.06) + ')';
			ctx.fillRect(s * 84 - 300, -200, 26, 900);
		}
		ctx.restore();
		ctx.fillStyle = '#fff8ea';
		ctx.font = '900 132px "Bahnschrift", "Arial Narrow", sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(title, 512, 248);
		ctx.fillStyle = 'rgba(255,248,234,0.88)';
		ctx.font = '600 38px "Bahnschrift", "Arial Narrow", sans-serif';
		ctx.letterSpacing = '8px';
		ctx.fillText(sub || 'NAGISA COAST', 512, 316);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		tex.anisotropy = 8;
		return tex;
	};

	HZ.textures.pad = function () {
		if (HZ.textures.__pad) return HZ.textures.__pad;
		var o = HZ.canvas(1024, 1024), ctx = o.ctx;
		ctx.clearRect(0, 0, 1024, 1024);
		ctx.fillStyle = '#303137'; ctx.fillRect(0, 0, 1024, 1024);
		HZ.noiseFill(ctx, 1024, 1024, 18000, 0.14, 3);
		ctx.strokeStyle = 'rgba(255,178,72,0.75)';
		ctx.lineWidth = 10;
		ctx.beginPath(); ctx.arc(512, 512, 430, 0, Math.PI * 2); ctx.stroke();
		ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 4;
		ctx.beginPath(); ctx.arc(512, 512, 330, 0, Math.PI * 2); ctx.stroke();
		/* chevrons */
		ctx.fillStyle = 'rgba(255,255,255,0.22)';
		for (var i = 0; i < 16; i++) {
			var a = i / 16 * Math.PI * 2;
			ctx.save(); ctx.translate(512 + Math.cos(a) * 380, 512 + Math.sin(a) * 380); ctx.rotate(a);
			ctx.fillRect(-20, -8, 40, 16); ctx.restore();
		}
		ctx.fillStyle = 'rgba(255,248,234,0.16)';
		ctx.font = '900 112px "Bahnschrift", "Arial Narrow", sans-serif';
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText('HH', 512, 494);
		ctx.font = '600 24px "Bahnschrift", sans-serif';
		ctx.fillStyle = 'rgba(255,255,255,0.28)';
		ctx.fillText('HORIZON FESTIVAL / NAGISA', 512, 590);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		HZ.textures.__pad = tex;
		return tex;
	};

	HZ.textures.sign = function (title, sub, accent) {
		var o = HZ.canvas(512, 256), ctx = o.ctx;
		ctx.fillStyle = '#131a22'; ctx.fillRect(0, 0, 512, 256);
		ctx.fillStyle = accent || '#ffb340'; ctx.fillRect(0, 0, 512, 16);
		ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 2; ctx.strokeRect(10, 26, 492, 218);
		ctx.fillStyle = '#fff8ea';
		ctx.font = '900 60px "Bahnschrift", "Arial Narrow", sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(title, 256, 118);
		ctx.fillStyle = accent || '#ffb340';
		ctx.font = '600 26px "Bahnschrift", "Arial Narrow", sans-serif';
		ctx.fillText(sub || '', 256, 170);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		tex.anisotropy = 8;
		return tex;
	};

	HZ.textures.plate = function (text) {
		var o = HZ.canvas(256, 64), ctx = o.ctx;
		ctx.fillStyle = '#f4f0e4'; ctx.fillRect(0, 0, 256, 64);
		ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 58);
		ctx.fillStyle = '#1d1d1d'; ctx.font = '900 36px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText(text || 'HAYNEKO', 128, 34);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		return tex;
	};

	HZ.textures.ramp = function () {
		if (HZ.textures.__ramp) return HZ.textures.__ramp;
		var o = HZ.canvas(256, 512), ctx = o.ctx;
		ctx.fillStyle = '#2c2c2f'; ctx.fillRect(0, 0, 256, 512);
		HZ.noiseFill(ctx, 256, 512, 5000, 0.16, 2.5);
		/* orange side rails */
		ctx.fillStyle = '#e47c2c'; ctx.fillRect(0, 0, 16, 512); ctx.fillRect(240, 0, 16, 512);
		/* white chevrons pointing up the ramp */
		ctx.strokeStyle = 'rgba(255,244,220,0.82)';
		ctx.lineWidth = 18;
		for (var c = 0; c < 5; c++) {
			var y = 470 - c * 76;
			ctx.beginPath();
			ctx.moveTo(48, y);
			ctx.lineTo(128, y - 36);
			ctx.lineTo(208, y);
			ctx.stroke();
		}
		ctx.fillStyle = 'rgba(255,198,90,0.55)';
		ctx.fillRect(16, 0, 10, 512);
		ctx.fillRect(230, 0, 10, 512);
		var tex = HZ.canvasTexture(o.canvas, 1, 1);
		HZ.textures.__ramp = tex;
		return tex;
	};

	HZ.textures.field = function () {
		if (HZ.textures.__field) return HZ.textures.__field;
		var o = HZ.canvas(256, 256), ctx = o.ctx;
		ctx.fillStyle = '#6f7d48'; ctx.fillRect(0, 0, 256, 256);
		for (var y = 0; y < 256; y += 16) {
			ctx.fillStyle = y % 32 === 0 ? 'rgba(51,63,35,0.55)' : 'rgba(155,147,87,0.32)';
			ctx.fillRect(0, y, 256, 7);
		}
		HZ.noiseFill(ctx, 256, 256, 5000, 0.15, 2);
		var tex = HZ.canvasTexture(o.canvas, 1, 1);
		HZ.textures.__field = tex;
		return tex;
	};

	HZ.textures.glow = function () {
		if (HZ.textures.__glow) return HZ.textures.__glow;
		var o = HZ.canvas(256, 256), ctx = o.ctx;
		var g = ctx.createRadialGradient(128, 128, 2, 128, 128, 126);
		g.addColorStop(0, 'rgba(255,250,230,1)');
		g.addColorStop(0.08, 'rgba(255,240,200,0.95)');
		g.addColorStop(0.28, 'rgba(255,200,120,0.34)');
		g.addColorStop(0.62, 'rgba(255,160,80,0.09)');
		g.addColorStop(1, 'rgba(255,140,70,0)');
		ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		HZ.textures.__glow = tex;
		return tex;
	};

	HZ.textures.mote = function () {
		if (HZ.textures.__mote) return HZ.textures.__mote;
		var o = HZ.canvas(64, 64), ctx = o.ctx;
		var g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
		g.addColorStop(0, 'rgba(255,246,220,0.9)');
		g.addColorStop(0.35, 'rgba(255,220,160,0.4)');
		g.addColorStop(1, 'rgba(255,200,120,0)');
		ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		HZ.textures.__mote = tex;
		return tex;
	};

	HZ.textures.blob = function () {
		if (HZ.textures.__blob) return HZ.textures.__blob;
		var o = HZ.canvas(128, 128), ctx = o.ctx;
		ctx.clearRect(0, 0, 128, 128);
		var g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
		g.addColorStop(0, 'rgba(0,0,0,0.72)');
		g.addColorStop(0.45, 'rgba(0,0,0,0.36)');
		g.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 128, 128);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		HZ.textures.__blob = tex;
		return tex;
	};

	HZ.textures.windowsEmissive = function (variant) {
		var key = '__winEm' + variant;
		if (HZ.textures[key]) return HZ.textures[key];
		var o = HZ.canvas(160, 256), ctx = o.ctx;
		ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 160, 256);
		var cols = variant === 1 ? 4 : 5, rows = 8;
		var mw = 160 / cols, mh = 256 / rows;
		for (var r = 0; r < rows; r++) {
			for (var c = 0; c < cols; c++) {
				if ((r * 7 + c * 3 + variant * 5) % 5 > 1) continue;
				var x = c * mw + mw * 0.22, y = r * mh + mh * 0.2;
				ctx.fillStyle = (r + c) % 4 === 0 ? '#ffc76a' : '#ffdf9e';
				ctx.fillRect(x, y, mw * 0.56, mh * 0.52);
			}
		}
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.colorSpace = SRGB;
		HZ.textures[key] = tex;
		return tex;
	};

	HZ.textures.waterNormal = function () {
		if (HZ.textures.__waterNormal) return HZ.textures.__waterNormal;
		var size = 256;
		var heights = new Float32Array(size * size);
		for (var y = 0; y < size; y++) {
			for (var x = 0; x < size; x++) {
				heights[y * size + x] = HZ.fbm(x * 0.035, y * 0.035, 4, 2.07, 0.5) * 0.68 +
					HZ.fbm(x * 0.09 + 11, y * 0.09 - 4, 2, 2, 0.5) * 0.32;
			}
		}
		var o = HZ.canvas(size, size);
		var img = o.ctx.createImageData(size, size);
		for (var yy = 0; yy < size; yy++) {
			for (var xx = 0; xx < size; xx++) {
				var x0 = (xx - 1 + size) % size, x1 = (xx + 1) % size;
				var y0 = (yy - 1 + size) % size, y1 = (yy + 1) % size;
				var dx = (heights[yy * size + x1] - heights[yy * size + x0]) * 9;
				var dy = (heights[y1 * size + xx] - heights[y0 * size + xx]) * 9;
				var nx = -dx, ny = 1, nz = -dy;
				var len = Math.hypot(nx, ny, nz) || 1;
				var idx = (yy * size + xx) * 4;
				img.data[idx] = (nx / len * 0.5 + 0.5) * 255;
				img.data[idx + 1] = (nz / len * 0.5 + 0.5) * 255;
				img.data[idx + 2] = (ny / len * 0.5 + 0.5) * 255;
				img.data[idx + 3] = 255;
			}
		}
		o.ctx.putImageData(img, 0, 0);
		var tex = new global.THREE.CanvasTexture(o.canvas);
		tex.wrapS = tex.wrapT = global.THREE.RepeatWrapping;
		tex.repeat.set(90, 90);
		tex.anisotropy = 8;
		tex.colorSpace = global.THREE.NoColorSpace;
		HZ.textures.__waterNormal = tex;
		return tex;
	};

	HZ.textures.smokePuff = HZ.textures.smoke;

	/* ------------------------------------------------------------ save */
	var SAVE_KEY = 'hayneko.horizon.save.v1';
	HZ.defaultSave = function () {
		return {
			settings: { quality: 'balanced', volume: 0.7, music: true, camera: 0, units: 'metric', lang: '', motion: 1 },
			paint: 0,
			skill: 0,
			best: { traps: {}, drifts: {}, events: {}, topSpeed: 0 },
			lastEvent: 'coast'
		};
	};
	HZ.loadSave = function () {
		var base = HZ.defaultSave();
		try {
			var raw = global.localStorage.getItem(SAVE_KEY);
			if (!raw) return base;
			var data = JSON.parse(raw);
			if (!data || typeof data !== 'object') return base;
			if (data.settings) Object.assign(base.settings, data.settings);
			if (typeof data.paint === 'number') base.paint = data.paint;
			if (typeof data.skill === 'number') base.skill = data.skill;
			if (data.best && typeof data.best === 'object') {
				base.best = Object.assign(base.best, data.best);
				base.best.traps = data.best.traps || {};
				base.best.drifts = data.best.drifts || {};
				base.best.events = data.best.events || {};
			}
			if (typeof data.lastEvent === 'string') base.lastEvent = data.lastEvent;
		} catch (e) { /* private mode / bad json */ }
		return base;
	};
	HZ.storeSave = function (save) {
		try { global.localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
		catch (e) { /* ignore quota / private mode */ }
	};

	HZ.formatTime = function (seconds) {
		if (!isFinite(seconds) || seconds < 0) return '--:--.---';
		var m = Math.floor(seconds / 60);
		var s = Math.floor(seconds % 60);
		var ms = Math.floor((seconds % 1) * 1000);
		return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + ('00' + ms).slice(-3);
	};

	HZ.formatInt = function (n) {
		return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	};

	HZ.deviceTier = function () {
		var mem = global.navigator && global.navigator.deviceMemory;
		var cores = global.navigator && global.navigator.hardwareConcurrency;
		if (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) return 'mobile';
		if ((mem && mem <= 4) || (cores && cores <= 4)) return 'low';
		return 'desktop';
	};
})(window);
