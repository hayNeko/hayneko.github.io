/**
 * views/cs-range/content.js — DUST RANGE content layer
 *
 * Everything that can exist without knowing about the match: the weapon table,
 * the robot catalogue, procedural textures, the de_dust-inspired map, navmesh
 * grid, robot + first-person weapon models and the Web Audio synthesiser.
 * game.js owns the state machine, AI, combat and HUD.
 *
 * No external asset is fetched: textures, models and sounds are all generated
 * here, which keeps the page self-contained and offline-safe.
 */
(function (global) {
	'use strict';

	var THREE = global.THREE;
	if (!THREE) return;

	/* ======================================================================
	   small maths helpers
	   ====================================================================== */
	function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
	function lerp(a, b, t) { return a + (b - a) * t; }
	function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
	function rand(a, b) { return a + Math.random() * (b - a); }
	function randi(a, b) { return Math.floor(rand(a, b + 1)); }
	function choice(list) { return list[Math.floor(Math.random() * list.length)]; }
	function shuffle(list) {
		for (var i = list.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var t = list[i]; list[i] = list[j]; list[j] = t;
		}
		return list;
	}
	function angleDelta(a, b) {
		var d = b - a;
		while (d > Math.PI) d -= Math.PI * 2;
		while (d < -Math.PI) d += Math.PI * 2;
		return d;
	}

	/* ======================================================================
	   weapon catalogue
	   ====================================================================== */
	var WEAPONS = {
		usp: {
			id: 'usp', name: 'USP-S', slot: 'secondary', price: 0, buyKey: 0,
			category: 'SIDEARM', damage: 24, head: 4, rpm: 352, mag: 12, reserve: 36,
			reload: 2.2, spread: 0.0055, moveSpread: 0.018, airSpread: 0.07,
			recoil: { pitch: 0.012, yaw: 0.004 }, auto: false, range: 120,
			sound: 'pistol', scope: false, icon: 'pistol'
		},
		p250: {
			id: 'p250', name: 'P250', slot: 'secondary', price: 300, buyKey: 3,
			category: 'SIDEARM', damage: 31, head: 4, rpm: 400, mag: 13, reserve: 52,
			reload: 2.2, spread: 0.006, moveSpread: 0.019, airSpread: 0.075,
			recoil: { pitch: 0.014, yaw: 0.005 }, auto: false, range: 120,
			sound: 'pistol', scope: false, icon: 'pistol'
		},
		deagle: {
			id: 'deagle', name: 'DESERT EAGLE', slot: 'secondary', price: 700, buyKey: 4,
			category: 'SIDEARM', damage: 63, head: 4, rpm: 267, mag: 7, reserve: 35,
			reload: 2.25, spread: 0.004, moveSpread: 0.03, airSpread: 0.1,
			recoil: { pitch: 0.032, yaw: 0.009 }, auto: false, range: 100,
			sound: 'deagle', scope: false, icon: 'pistol'
		},
		ak47: {
			id: 'ak47', name: 'AK-47', slot: 'primary', price: 2700, buyKey: 1,
			category: 'RIFLE', damage: 36, head: 4, rpm: 600, mag: 30, reserve: 90,
			reload: 2.5, spread: 0.0032, moveSpread: 0.024, airSpread: 0.12,
			recoil: { pitch: 0.019, yaw: 0.007 }, auto: true, range: 160,
			sound: 'rifle', scope: false, icon: 'rifle'
		},
		m4a4: {
			id: 'm4a4', name: 'M4A4', slot: 'primary', price: 3100, buyKey: 5,
			category: 'RIFLE', damage: 33, head: 4, rpm: 666, mag: 30, reserve: 90,
			reload: 2.55, spread: 0.0031, moveSpread: 0.022, airSpread: 0.11,
			recoil: { pitch: 0.016, yaw: 0.006 }, auto: true, range: 160,
			sound: 'rifle2', scope: false, icon: 'rifle'
		},
		awp: {
			id: 'awp', name: 'AWP', slot: 'primary', price: 4750, buyKey: 6,
			category: 'SNIPER', damage: 115, head: 4, rpm: 41, mag: 10, reserve: 30,
			reload: 3.65, spread: 0.0055, moveSpread: 0.07, airSpread: 0.18,
			scopedSpread: 0.0004, recoil: { pitch: 0.07, yaw: 0.014 }, auto: false, range: 260,
			sound: 'sniper', scope: true, icon: 'sniper'
		},
		mp9: {
			id: 'mp9', name: 'MP9', slot: 'primary', price: 1250, buyKey: 7,
			category: 'SMG', damage: 24, head: 3.6, rpm: 857, mag: 30, reserve: 120,
			reload: 2.1, spread: 0.0065, moveSpread: 0.016, airSpread: 0.08,
			recoil: { pitch: 0.011, yaw: 0.004 }, auto: true, range: 110,
			sound: 'smg', scope: false, icon: 'smg'
		},
		ump45: {
			id: 'ump45', name: 'UMP-45', slot: 'primary', price: 1200, buyKey: 8,
			category: 'SMG', damage: 31, head: 3.8, rpm: 600, mag: 25, reserve: 100,
			reload: 2.2, spread: 0.006, moveSpread: 0.019, airSpread: 0.09,
			recoil: { pitch: 0.015, yaw: 0.005 }, auto: true, range: 120,
			sound: 'smg', scope: false, icon: 'smg'
		},
		galil: {
			id: 'galil', name: 'GALIL AR', slot: 'primary', price: 1800, buyKey: 3,
			category: 'RIFLE', damage: 30, head: 4, rpm: 666, mag: 35, reserve: 90,
			reload: 2.55, spread: 0.005, moveSpread: 0.026, airSpread: 0.12,
			recoil: { pitch: 0.018, yaw: 0.007 }, auto: true, range: 150,
			sound: 'rifle2', scope: false, icon: 'rifle'
		},
		sg553: {
			id: 'sg553', name: 'SG 553', slot: 'primary', price: 3000, buyKey: 4,
			category: 'RIFLE', damage: 32, head: 4, rpm: 545, mag: 30, reserve: 90,
			reload: 2.6, spread: 0.0038, moveSpread: 0.022, airSpread: 0.11,
			scopedSpread: 0.0012, recoil: { pitch: 0.016, yaw: 0.006 }, auto: true, range: 180,
			sound: 'rifle2', scope: true, scopeFov: 45, icon: 'rifle'
		},
		ssg08: {
			id: 'ssg08', name: 'SSG 08', slot: 'primary', price: 1700, buyKey: 6,
			category: 'SNIPER', damage: 88, head: 4, rpm: 48, mag: 10, reserve: 90,
			reload: 3.1, spread: 0.006, moveSpread: 0.06, airSpread: 0.16,
			scopedSpread: 0.0007, recoil: { pitch: 0.055, yaw: 0.012 }, auto: false, range: 240,
			sound: 'sniper', scope: true, scopeFov: 35, icon: 'sniper'
		},
		nova: {
			id: 'nova', name: 'NOVA', slot: 'primary', price: 1050, buyKey: 9,
			category: 'SHOTGUN', damage: 15, head: 4, rpm: 85, mag: 8, reserve: 32,
			reload: 3.3, spread: 0.015, moveSpread: 0.04, airSpread: 0.14,
			recoil: { pitch: 0.04, yaw: 0.01 }, auto: false, range: 55,
			sound: 'shotgun', scope: false, pellets: 8, icon: 'shotgun'
		},
		knife: {
			id: 'knife', name: 'KNIFE', slot: 'melee', price: 0, buyKey: 0,
			category: 'MELEE', damage: 55, head: 2.2, rpm: 100, mag: 1, reserve: 0,
			reload: 0, spread: 0, moveSpread: 0, airSpread: 0,
			recoil: { pitch: 0.005, yaw: 0.003 }, auto: false, range: 2.2,
			sound: 'knife', scope: false, icon: 'knife'
		}
	};

		var BUY_ITEMS = [
		{ id: 'ak47', kind: 'weapon', price: 2700, category: 'RIFLE', key: 1 },
		{ id: 'm4a4', kind: 'weapon', price: 3100, category: 'RIFLE', key: 2 },
		{ id: 'galil', kind: 'weapon', price: 1800, category: 'RIFLE', key: 3 },
		{ id: 'sg553', kind: 'weapon', price: 3000, category: 'RIFLE', key: 4 },
		{ id: 'awp', kind: 'weapon', price: 4750, category: 'SNIPER', key: 5 },
		{ id: 'ssg08', kind: 'weapon', price: 1700, category: 'SNIPER', key: 6 },
		{ id: 'mp9', kind: 'weapon', price: 1250, category: 'SMG', key: 7 },
		{ id: 'ump45', kind: 'weapon', price: 1200, category: 'SMG', key: 8 },
		{ id: 'nova', kind: 'weapon', price: 1050, category: 'SHOTGUN', key: 9 },
		{ id: 'p250', kind: 'weapon', price: 300, category: 'SIDEARM', key: 0 },
		{ id: 'deagle', kind: 'weapon', price: 700, category: 'SIDEARM', key: 0 },
		{ id: 'armor', kind: 'armor', price: 1000, category: 'PROTECTION', key: 0,
			name: 'KEVLAR + HELMET', desc: 'Armour absorbs half of incoming body damage.' }
	];

	var BOT_TYPES = {
		scout: {
			id: 'scout', label: 'SCOUT', hp: 65, speed: 4.35, scale: 0.92,
			accuracy: 0.5, damage: 8, fireRate: 0.55, reaction: 0.42,
			preferMin: 4, preferMax: 15, torso: '#8b9690', accent: '#f2a23c',
			plates: 1, barrel: 0.34,
			weaponPool: ['mp9', 'ump45', 'galil', 'p250', 'deagle']
		},
		trooper: {
			id: 'trooper', label: 'TROOPER', hp: 100, speed: 3.55, scale: 1.0,
			accuracy: 0.64, damage: 12, fireRate: 0.82, reaction: 0.55,
			preferMin: 6, preferMax: 22, torso: '#b9b0a0', accent: '#e2603b',
			plates: 2, barrel: 0.45,
			weaponPool: ['ak47', 'm4a4', 'galil', 'sg553', 'mp9', 'ump45']
		},
		heavy: {
			id: 'heavy', label: 'HEAVY', hp: 175, speed: 2.65, scale: 1.16,
			accuracy: 0.48, damage: 16, fireRate: 1.08, reaction: 0.72,
			preferMin: 7, preferMax: 25, torso: '#6d746d', accent: '#d84b36',
			plates: 3, barrel: 0.46,
			weaponPool: ['ak47', 'm4a4', 'galil', 'nova', 'sg553']
		},
		sniper: {
			id: 'sniper', label: 'SENTINEL', hp: 80, speed: 2.95, scale: 1.02,
			accuracy: 0.82, damage: 34, fireRate: 2.5, reaction: 1.05,
			preferMin: 16, preferMax: 40, torso: '#a69783', accent: '#ff5f45',
			plates: 2, barrel: 0.72,
			weaponPool: ['ssg08', 'awp']
		}
	};

		var BOT_LOADOUTS = {
		scout: [
			['mp9', 'p250'], ['ump45', 'p250'], ['galil', 'deagle'], ['mp9', 'deagle']
		],
		trooper: [
			['ak47', 'mp9'], ['m4a4', 'ump45'], ['galil', 'p250'], ['sg553', 'deagle']
		],
		heavy: [
			['ak47', 'nova'], ['m4a4', 'ump45'], ['galil', 'nova'], ['sg553', 'p250']
		],
		sniper: [
			['awp', 'p250'], ['ssg08', 'deagle'], ['awp', 'p250'], ['ssg08', 'mp9']
		]
	};

	var DIFFICULTY = {
		recruit: { label: 'RECRUIT', accuracy: 0.55, reaction: 1.25, damage: 0.65, fire: 1.25, speed: 0.9, missChance: 0.34 },
		regular: { label: 'REGULAR', accuracy: 0.78, reaction: 1.0, damage: 1.0, fire: 1.0, speed: 1.0, missChance: 0.22 },
		veteran: { label: 'VETERAN', accuracy: 0.92, reaction: 0.76, damage: 1.2, fire: 0.85, speed: 1.08, missChance: 0.12 },
		elite: { label: 'ELITE', accuracy: 1.06, reaction: 0.56, damage: 1.45, fire: 0.7, speed: 1.16, missChance: 0.05 }
	};

	var BOT_NAMES = [
		'VEX', 'MUTT', 'SABLE', 'NOVA', 'BRUTE', 'HEX', 'RUST', 'ECHO', 'PYRO',
		'WIDOW', 'BOLT', 'TALON', 'CIPHER', 'GRIT', 'VANTA', 'KILO', 'SPARK',
		'ONYX', 'HAVOC', 'JACKAL', 'MAGNET', 'ORBIT', 'PIXEL', 'RIVET', 'SLAKE'
	];

	var BOT_SPAWNS = [
		{ x: 0, z: -31 }, { x: -30, z: -30 }, { x: 30, z: -30 },
		{ x: -33, z: -7 }, { x: 33, z: -6 }, { x: -13, z: -28 },
		{ x: 13, z: -28 }, { x: 0, z: -19 }, { x: -27, z: -20 },
		{ x: 27, z: -18 }, { x: -33, z: 14 }, { x: 33, z: 14 },
		{ x: -8, z: -12 }, { x: 9, z: 18 }
	];

	var PLAYER_SPAWN = { x: 0, z: 31 };
	var PRACTICE_SPAWN = { x: 0, z: 34.5 };

	/* Practice boards face the shooting line at the CT end of the map. */
	var PRACTICE_TARGETS = [
		{ x: 0, z: 24.0, type: 'paper', scale: 1.10, move: 0 },
		{ x: -5.4, z: 23.5, type: 'paper', scale: 1.00, move: 0 },
		{ x: 4.8, z: 22.0, type: 'steel', scale: 0.98, move: 0 },
		{ x: -8.5, z: 25.0, type: 'paper', scale: 0.94, move: 0 },
		{ x: 9.2, z: 24.4, type: 'steel', scale: 0.92, move: 0 },
		{ x: 0, z: 18.4, type: 'steel', scale: 0.90, move: 0 },
		{ x: -12.8, z: 15.5, type: 'paper', scale: 0.96, move: 0 },
		{ x: 12.8, z: 14.5, type: 'paper', scale: 0.96, move: 0 },
		{ x: -16.8, z: 7.5, type: 'steel', scale: 0.90, move: 0 },
		{ x: 18.0, z: 8.0, type: 'steel', scale: 0.90, move: 0 },
		{ x: -3.2, z: 27.5, type: 'paper', scale: 0.84, move: 1.5 },
		{ x: 4.1, z: 27.0, type: 'steel', scale: 0.80, move: 1.1 }
	];

	var CHICKEN_SPAWNS = [
		{ x: -4.0, z: 30.0 }, { x: 5.2, z: 26.0 }, { x: -9.0, z: 21.0 },
		{ x: 10.5, z: 19.0 }, { x: -14.0, z: 5.0 }, { x: 14.5, z: 2.5 },
		{ x: -6.0, z: -2.0 }, { x: 7.5, z: -11.0 }, { x: -20.0, z: 19.0 },
		{ x: 20.0, z: -4.0 }
	];

	/* ======================================================================
	   procedural textures
	   ====================================================================== */
	function makeCanvas(w, h) {
		var c = document.createElement('canvas');
		c.width = w; c.height = h;
		return c;
	}

	function canvasTexture(canvas, opts) {
		var t = new THREE.CanvasTexture(canvas);
		t.colorSpace = THREE.SRGBColorSpace;
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.anisotropy = (opts && opts.anisotropy) || 4;
		if (opts && opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
		return t;
	}

	function noise(ctx, w, h, amount, alpha, dark) {
		for (var i = 0; i < amount; i++) {
			var x = Math.random() * w;
			var y = Math.random() * h;
			var s = Math.random() * 2.2 + 0.4;
			var v = Math.random();
			ctx.fillStyle = 'rgba(' + (dark ? '30,22,14' : '255,246,225') + ',' + (alpha * v) + ')';
			ctx.fillRect(x, y, s, s);
		}
	}

	function makeSandTexture() {
		var c = makeCanvas(512, 512);
		var ctx = c.getContext('2d');
		ctx.fillStyle = '#c2a982';
		ctx.fillRect(0, 0, 512, 512);
		/* broad tonal drift */
		for (var i = 0; i < 36; i++) {
			var x = Math.random() * 512, y = Math.random() * 512;
			var r = 40 + Math.random() * 120;
			var g = ctx.createRadialGradient(x, y, 0, x, y, r);
			g.addColorStop(0, 'rgba(' + (Math.random() < 0.5 ? '226,207,170' : '169,142,106') + ',0.17)');
			g.addColorStop(1, 'rgba(0,0,0,0)');
			ctx.fillStyle = g;
			ctx.fillRect(x - r, y - r, r * 2, r * 2);
		}
		/* wind ripples */
		ctx.globalAlpha = 0.07;
		for (var r2 = 0; r2 < 60; r2++) {
			ctx.strokeStyle = r2 % 2 ? '#ede0c8' : '#8d7353';
			ctx.lineWidth = 1 + Math.random() * 2;
			ctx.beginPath();
			var yy = Math.random() * 512;
			ctx.moveTo(-20, yy);
			for (var xx = 0; xx < 540; xx += 26) {
				ctx.lineTo(xx, yy + Math.sin(xx * 0.014 + r2) * 5 + (Math.random() - 0.5) * 2);
			}
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
		/* pebbles */
		for (var p = 0; p < 2400; p++) {
			var px = Math.random() * 512, py = Math.random() * 512;
			var pr = 0.4 + Math.random() * 1.5;
			ctx.fillStyle = Math.random() < 0.55 ? 'rgba(122,98,68,0.42)' : 'rgba(239,223,190,0.4)';
			ctx.beginPath();
			ctx.arc(px, py, pr, 0, Math.PI * 2);
			ctx.fill();
		}
		/* occasional stones */
		for (var s = 0; s < 40; s++) {
			var sx = Math.random() * 512, sy = Math.random() * 512;
			ctx.fillStyle = 'rgba(' + randi(92, 132) + ',' + randi(80, 112) + ',' + randi(62, 88) + ',0.5)';
			ctx.beginPath();
			ctx.ellipse(sx, sy, rand(1.5, 4.5), rand(1, 3), Math.random() * 3, 0, Math.PI * 2);
			ctx.fill();
		}
		noise(ctx, 512, 512, 3000, 0.11, false);
		noise(ctx, 512, 512, 2200, 0.15, true);
		return canvasTexture(c, { anisotropy: 8 });
	}

	function makeBrickTexture(base, mortar, brick) {
		var c = makeCanvas(512, 512);
		var ctx = c.getContext('2d');
		ctx.fillStyle = mortar;
		ctx.fillRect(0, 0, 512, 512);
		var bh = 42, bw = 88, gap = 5;
		for (var row = 0; row < 13; row++) {
			var offset = (row % 2) * (bw / 2);
			for (var col = -1; col < 7; col++) {
				var x = col * bw + offset + gap / 2;
				var y = row * bh + gap / 2;
				var shade = rand(-18, 18);
				ctx.fillStyle = shadeColor(brick, shade);
				ctx.fillRect(x, y, bw - gap, bh - gap);
				/* bevel */
				ctx.fillStyle = 'rgba(255,246,220,0.1)';
				ctx.fillRect(x, y, bw - gap, 2);
				ctx.fillStyle = 'rgba(40,28,16,0.15)';
				ctx.fillRect(x, y + bh - gap - 2, bw - gap, 2);
			}
		}
		/* weathering */
		ctx.globalAlpha = 0.2;
		for (var w = 0; w < 50; w++) {
			var wx = Math.random() * 512, wy = Math.random() * 512;
			var r = rand(8, 50);
			var g = ctx.createRadialGradient(wx, wy, 0, wx, wy, r);
			g.addColorStop(0, Math.random() < 0.5 ? 'rgba(255,240,210,0.35)' : 'rgba(62,45,28,0.45)');
			g.addColorStop(1, 'rgba(0,0,0,0)');
			ctx.fillStyle = g;
			ctx.fillRect(wx - r, wy - r, r * 2, r * 2);
		}
		ctx.globalAlpha = 1;
		/* cracks */
		ctx.strokeStyle = 'rgba(48,34,20,0.28)';
		for (var k = 0; k < 8; k++) {
			ctx.lineWidth = rand(0.5, 1.4);
			ctx.beginPath();
			var cx = Math.random() * 512, cy = Math.random() * 512;
			ctx.moveTo(cx, cy);
			for (var j = 0; j < 6; j++) {
				cx += rand(-18, 18); cy += rand(6, 30);
				ctx.lineTo(cx, cy);
			}
			ctx.stroke();
		}
		noise(ctx, 512, 512, 3200, 0.12, false);
		noise(ctx, 512, 512, 2600, 0.14, true);
		return canvasTexture(c, { anisotropy: 8 });
	}

	function shadeColor(hex, amount) {
		var n = parseInt(hex.slice(1), 16);
		var r = clamp((n >> 16) + amount, 0, 255);
		var g = clamp(((n >> 8) & 255) + amount, 0, 255);
		var b = clamp((n & 255) + amount, 0, 255);
		return 'rgb(' + r + ',' + g + ',' + b + ')';
	}

	function makePlywoodTexture() {
		var c = makeCanvas(512, 512);
		var ctx = c.getContext('2d');
		ctx.fillStyle = '#8e6a44';
		ctx.fillRect(0, 0, 512, 512);
		/* vertical plywood panels with dark seams */
		for (var x = 0; x < 512; x += 128) {
			ctx.fillStyle = shadeColor('#8e6a44', rand(-14, 12));
			ctx.fillRect(x + 3, 0, 122, 512);
			ctx.fillStyle = 'rgba(42,28,16,0.62)';
			ctx.fillRect(x, 0, 5, 512);
			ctx.fillStyle = 'rgba(226,190,142,0.13)';
			ctx.fillRect(x + 7, 0, 2, 512);
			for (var g = 0; g < 16; g++) {
				ctx.strokeStyle = g % 2 ? 'rgba(54,36,20,0.38)' : 'rgba(218,178,126,0.22)';
				ctx.lineWidth = rand(0.5, 1.4);
				ctx.beginPath();
				var gx = x + rand(8, 118);
				ctx.moveTo(gx, 0);
				for (var y = 0; y <= 512; y += 32) ctx.lineTo(gx + Math.sin(y * 0.025 + g) * 2.5, y);
				ctx.stroke();
			}
			/* knots */
			for (var k = 0; k < 2; k++) {
				var kx = x + rand(18, 108), ky = rand(40, 470);
				ctx.strokeStyle = 'rgba(50,32,17,0.36)';
				ctx.lineWidth = 1.4;
				ctx.beginPath();
				ctx.ellipse(kx, ky, rand(5, 12), rand(2, 5), rand(-0.4, 0.4), 0, Math.PI * 2);
				ctx.stroke();
			}
		}
		/* top/bottom metal edge + scuffs */
		ctx.fillStyle = 'rgba(56,54,49,0.6)';
		ctx.fillRect(0, 0, 512, 10);
		ctx.fillRect(0, 502, 512, 10);
		for (var s = 0; s < 30; s++) {
			ctx.fillStyle = 'rgba(42,28,16,' + rand(0.06, 0.18).toFixed(2) + ')';
			ctx.fillRect(rand(0, 500), rand(20, 490), rand(4, 30), rand(1, 2));
		}
		noise(ctx, 512, 512, 2400, 0.12, true);
		return canvasTexture(c, { anisotropy: 8 });
	}

	function makeCrateTexture() {
		var c = makeCanvas(512, 512);
		var ctx = c.getContext('2d');
		ctx.fillStyle = '#8a623b';
		ctx.fillRect(0, 0, 512, 512);
		/* planks */
		for (var i = 0; i < 5; i++) {
			var y = i * 102 + 3;
			ctx.fillStyle = shadeColor('#8a623b', rand(-12, 16));
			ctx.fillRect(0, y, 512, 96);
			ctx.fillStyle = 'rgba(44,28,14,0.5)';
			ctx.fillRect(0, y + 96, 512, 5);
			/* grain */
			ctx.globalAlpha = 0.2;
			for (var g = 0; g < 18; g++) {
				ctx.strokeStyle = g % 2 ? '#d4b183' : '#4d341e';
				ctx.lineWidth = rand(0.5, 1.5);
				ctx.beginPath();
				var gy = y + rand(8, 88);
				ctx.moveTo(0, gy);
				for (var x = 0; x <= 512; x += 32) ctx.lineTo(x, gy + Math.sin(x * 0.02 + g) * 2);
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
			/* nail heads */
			ctx.fillStyle = 'rgba(45,42,38,0.75)';
			for (var n = 0; n < 4; n++) {
				ctx.beginPath();
				ctx.arc(40 + n * 130, y + 46, 3, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		/* corner metal bands */
		ctx.fillStyle = 'rgba(52,52,50,0.55)';
		ctx.fillRect(0, 0, 512, 12);
		ctx.fillRect(0, 500, 512, 12);
		ctx.fillRect(0, 0, 12, 512);
		ctx.fillRect(500, 0, 12, 512);
		ctx.fillStyle = 'rgba(30,30,29,0.55)';
		ctx.fillRect(16, 128, 480, 9);
		ctx.fillRect(16, 366, 480, 9);
		/* stencilled supply code */
		ctx.save();
		ctx.translate(256, 275);
		ctx.rotate(-0.035);
		ctx.fillStyle = 'rgba(34,31,25,0.58)';
		ctx.font = '700 44px Bahnschrift, Arial Narrow, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('SUPPLY 07', 0, 0);
		ctx.font = '400 17px Consolas, monospace';
		ctx.fillText('DUST RANGE / CT-04', 0, 28);
		ctx.restore();
		noise(ctx, 512, 512, 2600, 0.14, true);
		noise(ctx, 512, 512, 1000, 0.08, false);
		return canvasTexture(c, { anisotropy: 8 });
	}

	function makeContainerTexture(base, accent) {
		var c = makeCanvas(512, 512);
		var ctx = c.getContext('2d');
		ctx.fillStyle = base;
		ctx.fillRect(0, 0, 512, 512);
		/* corrugation */
		for (var x = 0; x < 512; x += 22) {
			ctx.fillStyle = 'rgba(255,255,255,0.06)';
			ctx.fillRect(x, 0, 8, 512);
			ctx.fillStyle = 'rgba(0,0,0,0.13)';
			ctx.fillRect(x + 13, 0, 7, 512);
		}
		/* top / bottom rails */
		ctx.fillStyle = 'rgba(17,19,21,0.5)';
		ctx.fillRect(0, 0, 512, 26);
		ctx.fillRect(0, 486, 512, 26);
		ctx.fillRect(0, 0, 26, 512);
		ctx.fillRect(486, 0, 26, 512);
		/* rust drips */
		for (var i = 0; i < 40; i++) {
			var rx = Math.random() * 512;
			var ry = Math.random() * 512;
			var rr = rand(3, 26);
			var g = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
			g.addColorStop(0, 'rgba(112,61,31,0.38)');
			g.addColorStop(1, 'rgba(112,61,31,0)');
			ctx.fillStyle = g;
			ctx.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
		}
		/* stencil */
		ctx.save();
		ctx.translate(256, 256);
		ctx.fillStyle = accent;
		ctx.font = '700 76px Bahnschrift, Arial Narrow, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('HAYNEKO', 0, 6);
		ctx.font = '400 20px Consolas, monospace';
		ctx.fillText('FREIGHT UNIT / 22', 0, 40);
		ctx.restore();
		noise(ctx, 512, 512, 3000, 0.1, true);
		return canvasTexture(c, { anisotropy: 8 });
	}

	function makeMetalTexture(base) {
		var c = makeCanvas(256, 256);
		var ctx = c.getContext('2d');
		ctx.fillStyle = base || '#4b4f51';
		ctx.fillRect(0, 0, 256, 256);
		for (var i = 0; i < 500; i++) {
			ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)';
			ctx.lineWidth = rand(0.4, 1.2);
			ctx.beginPath();
			var x = Math.random() * 256, y = Math.random() * 256;
			ctx.moveTo(x, y);
			ctx.lineTo(x + rand(-18, 18), y + rand(-4, 4));
			ctx.stroke();
		}
		for (var r = 0; r < 12; r++) {
			var rx = Math.random() * 256, ry = Math.random() * 256, rr = rand(4, 22);
			var g = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
			g.addColorStop(0, 'rgba(120,62,30,0.3)');
			g.addColorStop(1, 'rgba(120,62,30,0)');
			ctx.fillStyle = g;
			ctx.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
		}
		noise(ctx, 256, 256, 800, 0.12, true);
		return canvasTexture(c, { anisotropy: 4 });
	}

	function makeBarrelTexture() {
		var c = makeCanvas(256, 256);
		var ctx = c.getContext('2d');
		ctx.fillStyle = '#6f4b2f';
		ctx.fillRect(0, 0, 256, 256);
		for (var i = 0; i < 18; i++) {
			ctx.fillStyle = 'rgba(' + randi(120, 180) + ',' + randi(76, 110) + ',' + randi(42, 62) + ',0.28)';
			var x = Math.random() * 256, y = Math.random() * 256;
			ctx.beginPath();
			ctx.ellipse(x, y, rand(6, 28), rand(4, 14), Math.random() * 3, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.fillStyle = 'rgba(31,29,27,0.5)';
		ctx.fillRect(0, 28, 256, 8);
		ctx.fillRect(0, 222, 256, 8);
		ctx.fillStyle = 'rgba(230,206,146,0.45)';
		ctx.font = '700 26px Consolas, monospace';
		ctx.fillText('FUEL', 18, 145);
		noise(ctx, 256, 256, 1400, 0.16, true);
		return canvasTexture(c, { anisotropy: 4 });
	}

	function makeDecalTexture(kind) {
		var c = makeCanvas(512, 512);
		var ctx = c.getContext('2d');
		ctx.clearRect(0, 0, 512, 512);
		if (kind === 'hole') {
			var g = ctx.createRadialGradient(256, 256, 2, 256, 256, 120);
			g.addColorStop(0, 'rgba(10,9,8,0.98)');
			g.addColorStop(0.18, 'rgba(34,29,24,0.9)');
			g.addColorStop(0.55, 'rgba(80,68,54,0.34)');
			g.addColorStop(1, 'rgba(80,68,54,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(256, 256, 128, 0, Math.PI * 2);
			ctx.fill();
			/* cracks */
			ctx.strokeStyle = 'rgba(20,18,14,0.6)';
			for (var i = 0; i < 7; i++) {
				var a = Math.random() * Math.PI * 2;
				ctx.lineWidth = rand(1, 5);
				ctx.beginPath();
				ctx.moveTo(256 + Math.cos(a) * 12, 256 + Math.sin(a) * 12);
				ctx.lineTo(256 + Math.cos(a) * rand(40, 128), 256 + Math.sin(a) * rand(40, 128));
				ctx.stroke();
			}
		} else {
			var letter = kind === 'B' ? 'B' : 'A';
			ctx.translate(256, 256);
			ctx.rotate(-0.12);
			ctx.strokeStyle = 'rgba(188,54,34,0.78)';
			ctx.lineWidth = 18;
			ctx.beginPath();
			ctx.arc(0, 0, 176, 0, Math.PI * 2);
			ctx.stroke();
			ctx.lineWidth = 8;
			ctx.beginPath();
			ctx.arc(0, 0, 144, 0, Math.PI * 2);
			ctx.stroke();
			ctx.fillStyle = 'rgba(188,54,34,0.82)';
			ctx.font = '700 230px Bahnschrift, Arial Narrow, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(letter, 0, 12);
			ctx.fillStyle = 'rgba(188,54,34,0.5)';
			ctx.font = '700 32px Consolas, monospace';
			ctx.fillText('BOMB SITE', 0, 168);
			/* wear */
			ctx.globalCompositeOperation = 'destination-out';
			for (var w = 0; w < 60; w++) {
				ctx.beginPath();
				ctx.arc(rand(-230, 230), rand(-230, 230), rand(2, 14), 0, Math.PI * 2);
				ctx.fill();
			}
		}
		return canvasTexture(c, { anisotropy: 4 });
	}

	function makeSpawnTexture(label) {
		var c = makeCanvas(512, 256);
		var ctx = c.getContext('2d');
		ctx.clearRect(0, 0, 512, 256);
		ctx.strokeStyle = 'rgba(233,218,184,0.44)';
		ctx.lineWidth = 7;
		ctx.strokeRect(22, 22, 468, 212);
		ctx.fillStyle = 'rgba(215,162,74,0.75)';
		ctx.font = '700 64px Bahnschrift, Arial Narrow, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(label, 256, 130);
		ctx.font = '400 24px Consolas, monospace';
		ctx.fillText('DUST RANGE', 256, 176);
		/* arrows */
		ctx.fillStyle = 'rgba(215,162,74,0.5)';
		ctx.beginPath();
		ctx.moveTo(256, 42); ctx.lineTo(280, 70); ctx.lineTo(232, 70);
		ctx.closePath(); ctx.fill();
		return canvasTexture(c, { anisotropy: 4 });
	}

	function makeGlowTexture() {
		var c = makeCanvas(128, 128);
		var ctx = c.getContext('2d');
		var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
		g.addColorStop(0, 'rgba(255,248,210,1)');
		g.addColorStop(0.18, 'rgba(255,206,110,0.95)');
		g.addColorStop(0.5, 'rgba(255,140,40,0.34)');
		g.addColorStop(1, 'rgba(255,120,30,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 128, 128);
		return canvasTexture(c, { anisotropy: 2 });
	}

	function makeSignTexture(letter) {
		var c = makeCanvas(512, 512);
		var ctx = c.getContext('2d');
		ctx.fillStyle = '#2f2c27';
		ctx.fillRect(0, 0, 512, 512);
		ctx.fillStyle = '#c8b38a';
		ctx.fillRect(28, 28, 456, 456);
		ctx.fillStyle = '#8b2e23';
		ctx.font = '700 320px Bahnschrift, Arial Narrow, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(letter, 256, 250);
		ctx.fillStyle = '#2f2c27';
		ctx.font = '700 34px Consolas, monospace';
		ctx.fillText('SITE ' + letter, 256, 430);
		for (var i = 0; i < 240; i++) {
			ctx.fillStyle = 'rgba(70,55,39,' + Math.random() * 0.25 + ')';
			ctx.fillRect(Math.random() * 512, Math.random() * 512, rand(1, 9), rand(1, 4));
		}
		return canvasTexture(c, { anisotropy: 4 });
	}

	function makeTextures(renderer) {
		var aniso = renderer && renderer.capabilities ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
		var out = {
			sand: makeSandTexture(),
			brick: makeBrickTexture('#c2aa84', '#9c8662', '#c5ae87'),
			brickDark: makeBrickTexture('#9e8a6a', '#78664d', '#a59070'),
			crate: makeCrateTexture(),
			plywood: makePlywoodTexture(),
			container: makeContainerTexture('#36586a', 'rgba(230,206,146,0.7)'),
			containerRust: makeContainerTexture('#6d4432', 'rgba(236,192,112,0.65)'),
			metal: makeMetalTexture('#4e5254'),
			barrel: makeBarrelTexture(),
			hole: makeDecalTexture('hole'),
			siteA: makeDecalTexture('A'),
			siteB: makeDecalTexture('B'),
			spawnCT: makeSpawnTexture('CT SPAWN'),
			spawnT: makeSpawnTexture('T SPAWN'),
			glow: makeGlowTexture(),
			signA: makeSignTexture('A'),
			signB: makeSignTexture('B')
		};
		Object.keys(out).forEach(function (k) { if (out[k]) out[k].anisotropy = aniso; });
		return out;
	}

	/* ======================================================================
	   geometry helpers
	   ====================================================================== */
	function scaleBoxUV(geo, w, h, d, unit) {
		unit = unit || 2;
		var uv = geo.attributes.uv;
		var reps = [
			[d / unit, h / unit], [d / unit, h / unit],
			[w / unit, d / unit], [w / unit, d / unit],
			[w / unit, h / unit], [w / unit, h / unit]
		];
		for (var f = 0; f < 6; f++) {
			for (var i = 0; i < 4; i++) {
				var idx = f * 4 + i;
				if (idx >= uv.count) continue;
				uv.setXY(idx, uv.getX(idx) * reps[f][0], uv.getY(idx) * reps[f][1]);
			}
		}
		uv.needsUpdate = true;
		return geo;
	}

	function boxGeo(w, h, d, unit) {
		var g = new THREE.BoxGeometry(w, h, d);
		return scaleBoxUV(g, w, h, d, unit);
	}

	/* ======================================================================
	   the map — de_dust-ish sandstone training range
	   ====================================================================== */
	function createMap(scene, tex, renderer) {
		var world = {
			bounds: 38,
			colliders: [],
			meshes: [],
			deco: [],
			ground: null,
			sites: [
				{ id: 'A', x: -24, z: -21, r: 9 },
				{ id: 'B', x: 24, z: -19, r: 8 }
			],
			spawn: PLAYER_SPAWN
		};

		var mats = {
			sand: new THREE.MeshStandardMaterial({ map: tex.sand, color: 0xffffff, roughness: 0.98, metalness: 0 }),
			brick: new THREE.MeshStandardMaterial({ map: tex.brick, color: 0xffffff, roughness: 0.94, metalness: 0 }),
			brickDark: new THREE.MeshStandardMaterial({ map: tex.brickDark, color: 0xffffff, roughness: 0.95, metalness: 0 }),
			crate: new THREE.MeshStandardMaterial({ map: tex.crate, color: 0xffffff, roughness: 0.82, metalness: 0.02 }),
			plywood: new THREE.MeshStandardMaterial({ map: tex.plywood, color: 0xffffff, roughness: 0.9, metalness: 0.01 }),
			gold: new THREE.MeshStandardMaterial({ color: 0xd7a24a, roughness: 0.56, metalness: 0.28 }),
			container: new THREE.MeshStandardMaterial({ map: tex.container, color: 0xffffff, roughness: 0.56, metalness: 0.34 }),
			containerRust: new THREE.MeshStandardMaterial({ map: tex.containerRust, color: 0xffffff, roughness: 0.62, metalness: 0.3 }),
			metal: new THREE.MeshStandardMaterial({ map: tex.metal, color: 0xffffff, roughness: 0.52, metalness: 0.55 }),
			barrel: new THREE.MeshStandardMaterial({ map: tex.barrel, color: 0xffffff, roughness: 0.64, metalness: 0.3 }),
			sandbag: new THREE.MeshStandardMaterial({ color: 0xa8916b, roughness: 1, metalness: 0 }),
			wood: new THREE.MeshStandardMaterial({ color: 0x7f5b36, roughness: 0.9, metalness: 0 }),
			concrete: new THREE.MeshStandardMaterial({ color: 0x9a907d, roughness: 0.95, metalness: 0 }),
			dark: new THREE.MeshStandardMaterial({ color: 0x262421, roughness: 0.9, metalness: 0.1 })
		};

		/* ---- ground ---- */
		var gTex = tex.sand.clone();
		gTex.needsUpdate = true;
		gTex.repeat.set(16, 16);
		var ground = new THREE.Mesh(
			new THREE.PlaneGeometry(82, 82, 1, 1),
			new THREE.MeshStandardMaterial({ map: gTex, color: 0xffffff, roughness: 1, metalness: 0 })
		);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);
		world.ground = ground;
		world.meshes.push(ground);

		/* ---- helpers ---- */
		function addCollider(x, z, w, d, y0, y1, rotY) {
			var hw = w / 2, hd = d / 2;
			if (rotY) {
				var c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
				hw = (w * c + d * s) / 2;
				hd = (w * s + d * c) / 2;
			}
			world.colliders.push({
				minX: x - hw, maxX: x + hw,
				minZ: z - hd, maxZ: z + hd,
				minY: y0, maxY: y1
			});
		}

		function addBox(w, h, d, x, z, mat, opts) {
			opts = opts || {};
			var geo = boxGeo(w, h, d, opts.unit || 2);
			var mesh = new THREE.Mesh(geo, mat);
			mesh.position.set(x, (opts.y || 0) + h / 2, z);
			if (opts.rotY) mesh.rotation.y = opts.rotY;
			mesh.castShadow = opts.cast !== false;
			mesh.receiveShadow = true;
			scene.add(mesh);
			if (opts.collide !== false) {
				world.meshes.push(mesh);
				addCollider(x, z, w, d, opts.y || 0, (opts.y || 0) + h, opts.rotY || 0);
			} else {
				world.deco.push(mesh);
			}
			return mesh;
		}

		function addCylinder(rt, rb, h, x, z, mat, opts) {
			opts = opts || {};
			var geo = new THREE.CylinderGeometry(rt, rb, h, opts.segments || 14);
			var mesh = new THREE.Mesh(geo, mat);
			mesh.position.set(x, (opts.y || 0) + h / 2, z);
			mesh.castShadow = opts.cast !== false;
			mesh.receiveShadow = true;
			scene.add(mesh);
			if (opts.collide !== false) {
				world.meshes.push(mesh);
				addCollider(x, z, Math.max(rt, rb) * 2, Math.max(rt, rb) * 2, opts.y || 0, (opts.y || 0) + h, 0);
			} else {
				world.deco.push(mesh);
			}
			return mesh;
		}

		function addDecal(tex2, x, z, size, rot) {
			var mat = new THREE.MeshBasicMaterial({
				map: tex2, transparent: true, opacity: 0.9, depthWrite: false,
				polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
			});
			var m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
			m.rotation.x = -Math.PI / 2;
			m.rotation.z = rot || 0;
			m.position.set(x, 0.021, z);
			scene.add(m);
			world.deco.push(m);
			return m;
		}

		function addSign(letter, x, y, z, rotY, size) {
			var t = letter === 'A' ? tex.signA : tex.signB;
			var mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0.02 });
			var m = new THREE.Mesh(new THREE.PlaneGeometry(size || 3, size || 3), mat);
			m.position.set(x, y, z);
			m.rotation.y = rotY;
			scene.add(m);
			world.deco.push(m);
			return m;
		}

		function addThinPanel(w, h, d, x, z) {
			addBox(w, h, d, x, z, mats.plywood, { unit: 2.4 });
			addBox(w + 0.12, 0.08, d + 0.08, x, z, mats.metal, { y: h - 0.02, collide: false });
			var alongX = w >= d;
			if (alongX) {
				addBox(0.1, h, d + 0.08, x - w / 2, z, mats.metal, { collide: false });
				addBox(0.1, h, d + 0.08, x + w / 2, z, mats.metal, { collide: false });
				addBox(w - 0.12, 0.07, 0.02, x, z + d / 2 + 0.011, mats.gold, { y: h * 0.53, collide: false });
			} else {
				addBox(w + 0.08, h, 0.1, x, z - d / 2, mats.metal, { collide: false });
				addBox(w + 0.08, h, 0.1, x, z + d / 2, mats.metal, { collide: false });
				addBox(0.02, 0.07, d - 0.12, x + w / 2 + 0.011, z, mats.gold, { y: h * 0.53, collide: false });
			}
		}

		var B = world.bounds;
		/* ---- outer walls ---- */
		addBox(B * 2 + 3, 6.2, 1.6, 0, -B - 0.2, mats.brick);
		addBox(B * 2 + 3, 6.2, 1.6, 0, B + 0.2, mats.brick);
		addBox(1.6, 6.2, B * 2 + 3, -B - 0.2, 0, mats.brick);
		addBox(1.6, 6.2, B * 2 + 3, B + 0.2, 0, mats.brick);

		/* ---- mid arch / doors ---- */
		addBox(9, 3.9, 1.5, -8, 0, mats.brickDark);
		addBox(9, 3.9, 1.5, 8, 0, mats.brickDark);
		addBox(25, 1.5, 1.7, 0, 0, mats.brickDark, { y: 3.9 });
		addBox(1.1, 0.35, 1.9, -8, 0, mats.dark, { y: 3.55, collide: false });
		addBox(1.1, 0.35, 1.9, 8, 0, mats.dark, { y: 3.55, collide: false });

		/* ---- long A wall (west) with a doorway ---- */
		addBox(1.5, 4.6, 17, -22, 10.5, mats.brick);
		addBox(1.5, 4.6, 15, -22, -21.5, mats.brick);
		addBox(1.5, 4.6, 5, -22, -3.5, mats.brick);
		addBox(1.5, 4.6, 4.5, -22, 22.3, mats.brick);
		addBox(1.4, 1.0, 3.0, -22, -14, mats.brick, { collide: false, y: 3.6 });

		/* ---- B tunnels wall (east) with a doorway ---- */
		addBox(1.5, 4.6, 18, 22, 11, mats.brick);
		addBox(1.5, 4.6, 14, 22, -22, mats.brick);
		addBox(1.5, 4.6, 4, 22, -5, mats.brick);
		addBox(1.5, 4.6, 5, 22, 25, mats.brick);

		/* ---- A site compound ---- */
		addBox(1.4, 5.2, 15, -32, -18, mats.brickDark);
		addBox(12, 5.2, 1.4, -27, -30, mats.brickDark);
		addBox(7, 5.2, 1.4, -25, -11.5, mats.brickDark);
		addBox(1.4, 5.2, 7, -33, -9, mats.brickDark);
		/* ---- B site compound ---- */
		addBox(1.4, 5.0, 14, 32, -17, mats.brickDark);
		addBox(11, 5.0, 1.4, 27.5, -29, mats.brickDark);
		addBox(6, 5.0, 1.4, 26, -10, mats.brickDark);
		addBox(1.4, 5.0, 8, 34.5, -22, mats.brickDark);

		/* ---- CT spawn shelter: side walls only, so the opening shot has a clear lane ---- */
		addBox(1.2, 2.4, 5, -6.2, 28.5, mats.concrete);
		addBox(1.2, 2.4, 5, 6.2, 28.5, mats.concrete);
		addBox(2.2, 1.05, 1.1, -8.6, 34, mats.concrete);
		addBox(2.2, 1.05, 1.1, 8.6, 34, mats.concrete);

		/* ---- T spawn cover ---- */
		addBox(1.4, 3.2, 6, -7, -30, mats.crate);
		addBox(1.4, 3.2, 6, 7, -30, mats.crate);
		addBox(10, 1.1, 1.2, 0, -24.5, mats.concrete);

		/* ---- crates / cover in mid ---- */
		function crate(x, z, s, stack, rot) {
			s = s || 1.7;
			stack = stack || 1;
			for (var i = 0; i < stack; i++) {
				addBox(s, s, s, x + (i ? rand(-0.18, 0.18) : 0), z + (i ? rand(-0.18, 0.18) : 0), mats.crate, {
					y: i * s, rotY: rot || 0, unit: 1.7
				});
			}
		}
		crate(0, 16, 2.1, 1);
		crate(5.2, 12.5, 1.8, 2, 0.12);
		crate(-6.2, 9.2, 1.7, 1, -0.08);
		crate(7.5, 3.5, 1.6, 1);
		crate(-7.2, -6.5, 1.8, 2, 0.06);
		crate(3.2, -8.5, 1.7, 1);
		crate(-3.5, -13.5, 2.0, 1, -0.1);
		crate(7.8, -18, 1.6, 1);
		crate(-10.5, 18, 1.5, 1);
		crate(10.8, 19.5, 1.7, 2);

		/* long A cover */
		crate(-28.5, 17, 1.8, 1, 0.1);
		crate(-30, 7, 1.6, 2);
		crate(-27.5, -1, 1.7, 1, -0.12);
		crate(-29.5, -12.5, 1.8, 1);
		crate(-27.2, -24.5, 2.0, 2);
		/* B tunnel cover */
		crate(28.5, 18, 1.7, 1, -0.06);
		crate(29.5, 6, 1.6, 1);
		crate(27.2, -2.5, 1.8, 2, 0.1);
		crate(29, -14, 1.7, 1);
		crate(26.8, -24, 1.9, 1);
		/* site A crates */
		crate(-26.5, -19.5, 2.0, 2, 0.08);
		crate(-21.5, -24, 1.7, 1);
		crate(-28.5, -26.5, 1.6, 1, -0.1);
		crate(-19.8, -18.2, 1.4, 1);
		/* site B crates */
		crate(26.5, -19, 2.0, 2, -0.05);
		crate(21.5, -23.5, 1.6, 1);
		crate(29.5, -25, 1.7, 1);
		crate(19.8, -17.5, 1.4, 1);

		/* ---- barrels ---- */
		function barrel(x, z) {
			addCylinder(0.48, 0.48, 1.15, x, z, mats.barrel, { unit: 1.2 });
		}
		barrel(2.2, 7.4);
		barrel(-2.8, 4.6);
		barrel(6.5, -3.8);
		barrel(-8.5, -18.5);
		barrel(-18.5, 14.5);
		barrel(19.5, 12.5);
		barrel(-29.5, -22);
		barrel(28.5, -11);
		barrel(12.5, -13.5);

		/* ---- low sandbag cover ---- */
		function sandbags(x, z, w, d, rot) {
			addBox(w, 1.05, d, x, z, mats.sandbag, { unit: 1.2, rotY: rot || 0 });
			for (var i = 0; i < Math.floor(w / 0.9); i++) {
				var bx = x - w / 2 + 0.45 + i * 0.9;
				var m = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 6), mats.sandbag);
				m.scale.set(1, 0.52, 0.7);
				m.position.set(bx, 1.0, z + (i % 2 ? 0.1 : -0.1));
				m.castShadow = true;
				m.receiveShadow = true;
				scene.add(m);
				world.deco.push(m);
			}
		}
		sandbags(0, 7.5, 5.8, 1.1);
		sandbags(-12, 1.5, 1.2, 5.5, Math.PI / 2);
		sandbags(13, -6, 1.2, 5.5, Math.PI / 2);
		sandbags(-15, -11, 5.5, 1.1);
		sandbags(17, 6, 5, 1.1);
		sandbags(-25.5, -6.5, 5, 1.1);

		/* ---- containers ---- */
		addBox(6.2, 2.65, 2.7, 13.5, 24, mats.container, { unit: 2.7, rotY: 0.04 });
		addBox(6.2, 2.65, 2.7, -14, -2, mats.containerRust, { unit: 2.7 });
		addBox(6.2, 2.65, 2.7, 27.5, 3, mats.container, { unit: 2.7, rotY: -0.03 });
		addBox(4.3, 2.3, 2.4, -18.5, 25.5, mats.containerRust, { unit: 2.4 });

		/* ---- extra high cover: stacked containers and tall concrete walls ---- */
		addBox(6.2, 3.35, 2.7, -17.5, 12.5, mats.containerRust, { unit: 2.7, rotY: -0.04 });
		addBox(6.2, 3.35, 2.7, 17.5, 15.5, mats.container, { unit: 2.7, rotY: 0.04 });
		addBox(5.4, 3.15, 1.15, 0, -5.6, mats.concrete, { rotY: 0.02 });
		addBox(1.2, 3.8, 6.4, 16.5, -15.5, mats.brickDark);
		addBox(1.2, 3.8, 6.4, -16.5, -15.5, mats.brickDark);
		addBox(3.8, 3.0, 1.1, -11.5, 26.5, mats.concrete, { rotY: -0.06 });
		addBox(3.8, 3.0, 1.1, 11.5, 26.5, mats.concrete, { rotY: 0.06 });

		/* ---- thin penetrable partitions (pass through; thicker walls stop bullets) ---- */
		addThinPanel(4.2, 2.2, 0.24, 8.5, 6.5);
		addThinPanel(0.24, 2.2, 4.0, -11.5, 18.5);
		addThinPanel(3.6, 2.2, 0.24, 24.0, -8.0);

		/* ---- jumpable low blocks / pallets ---- */
		addBox(2.2, 0.55, 1.4, 19.0, 24.5, mats.crate, { unit: 1.4 });
		addBox(2.2, 0.55, 1.4, -19.0, 9.5, mats.crate, { unit: 1.4 });
		addBox(2.0, 0.55, 1.4, 8.0, 1.5, mats.wood, { unit: 1.4 });

		/* ---- high overlooks with walkable staircases ---- */
		function addOverlook(cx, cz, w, d, top, stairSide) {
			var slab = 0.25;
			addBox(w, slab, d, cx, cz, mats.metal, { y: top - slab, unit: 2.7 });
			/* support posts (visual + collision under the slab) */
			var px = w / 2 - 0.35, pz = d / 2 - 0.35;
			[[-px, -pz], [px, -pz], [-px, pz], [px, pz]].forEach(function (o) {
				addBox(0.35, top - slab, 0.35, cx + o[0], cz + o[1], mats.metal, { unit: 1.2 });
			});
			/* airy post-and-rail edges; decorative only */
			var railMat = mats.metal;
			function railAlongX(rx, rz, len) {
				addBox(len, 0.06, 0.06, rx, rz, railMat, { y: top + 0.7, collide: false });
				for (var rp = 0; rp < 4; rp++) {
					addBox(0.075, 0.72, 0.075, rx - len / 2 + 0.18 + rp * (len - 0.36) / 3, rz, railMat, { y: top, collide: false });
				}
			}
			function railAlongZ(rx, rz, len) {
				addBox(0.06, 0.06, len, rx, rz, railMat, { y: top + 0.7, collide: false });
				for (var rp2 = 0; rp2 < 4; rp2++) {
					addBox(0.075, 0.72, 0.075, rx, rz - len / 2 + 0.18 + rp2 * (len - 0.36) / 3, railMat, { y: top, collide: false });
				}
			}
			if (stairSide === 'south') {
				railAlongX(cx, cz - d / 2 + 0.08, w);
				railAlongZ(cx - w / 2 + 0.08, cz, d);
				railAlongZ(cx + w / 2 - 0.08, cz, d);
			} else {
				railAlongZ(cx - w / 2 + 0.08, cz, d);
				railAlongX(cx, cz + d / 2 - 0.08, w);
				railAlongX(cx, cz - d / 2 + 0.08, w);
			}
			var stepCount = 6;
			var stepDepth = 0.5;
			var stepHeight = top / stepCount;
			for (var s = 0; s < stepCount; s++) {
				if (stairSide === 'south') {
					addBox(2.4, stepHeight * (s + 1), stepDepth, cx, 36.0 - s * stepDepth, mats.concrete, { unit: 1.2 });
				} else {
					addBox(stepDepth, stepHeight * (s + 1), 2.4, 22.5 - s * stepDepth, cz, mats.concrete, { unit: 1.2 });
				}
			}
			/* low side rails on the staircase, visual only */
			for (var r = 0; r < stepCount; r += 2) {
				if (stairSide === 'south') {
					addBox(0.08, 0.65, stepDepth, cx - 1.22, 36.0 - r * stepDepth, railMat, { y: stepHeight * (r + 1), collide: false });
					addBox(0.08, 0.65, stepDepth, cx + 1.22, 36.0 - r * stepDepth, railMat, { y: stepHeight * (r + 1), collide: false });
				} else {
					addBox(stepDepth, 0.65, 0.08, 22.5 - r * stepDepth, cz - 1.22, railMat, { y: stepHeight * (r + 1), collide: false });
					addBox(stepDepth, 0.65, 0.08, 22.5 - r * stepDepth, cz + 1.22, railMat, { y: stepHeight * (r + 1), collide: false });
				}
			}
		}
		addOverlook(-16, 31, 6, 5, 2.4, 'south');
		addOverlook(17, 31, 6, 5, 2.25, 'east');

		/* ---- low concrete barriers ---- */
		addBox(3.2, 1.15, 0.65, 9, -7, mats.concrete, { rotY: 0.2 });
		addBox(3.2, 1.15, 0.65, -11.5, 12, mats.concrete, { rotY: -0.3 });
		addBox(3.2, 1.15, 0.65, -3, 21.5, mats.concrete, { rotY: 0.15 });
		addBox(3.2, 1.15, 0.65, 3.4, -21.5, mats.concrete, { rotY: -0.1 });

		/* ---- site markers and signs ---- */
		addDecal(tex.siteA, -24, -21, 13, 0.08);
		addDecal(tex.siteB, 24, -19, 12, -0.04);
		addSign('A', -32.1, 2.7, -18, Math.PI / 2, 3.4);
		addSign('B', 32.1, 2.6, -17, -Math.PI / 2, 3.4);
		addSign('A', -27, 2.3, -29.1, 0, 2.6);
		addSign('B', 27.5, 2.2, -28.1, 0, 2.6);

		/* spawn markings */
		addDecal(tex.spawnCT, 0, 31, 8.5, 0);
		addDecal(tex.spawnT, 0, -31, 8.5, Math.PI);

		/* ---- distant city / skyline (visual only) ---- */
		var distantMat = new THREE.MeshStandardMaterial({ color: 0xb9a181, roughness: 1, metalness: 0 });
		var distantDark = new THREE.MeshStandardMaterial({ color: 0x9a8164, roughness: 1, metalness: 0 });
		for (var i = 0; i < 26; i++) {
			var ang = (i / 26) * Math.PI * 2 + rand(-0.08, 0.08);
			var dist = rand(55, 95);
			var bw = rand(4, 13), bh = rand(5, 20), bd = rand(4, 12);
			var bmesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), i % 3 ? distantMat : distantDark);
			bmesh.position.set(Math.cos(ang) * dist, bh / 2 - 1, Math.sin(ang) * dist);
			bmesh.rotation.y = ang + rand(-0.5, 0.5);
			scene.add(bmesh);
			world.deco.push(bmesh);
		}
		/* domes and a minaret-ish tower */
		for (var dI = 0; dI < 4; dI++) {
			var angle = rand(0, Math.PI * 2), dist2 = rand(60, 88);
			var dome = new THREE.Mesh(new THREE.SphereGeometry(rand(3, 6), 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), distantMat);
			dome.position.set(Math.cos(angle) * dist2, rand(8, 14), Math.sin(angle) * dist2);
			scene.add(dome);
			world.deco.push(dome);
		}
		/* palms at the edges of the range */
		function palm(x, z, scale) {
			scale = scale || 1;
			var trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4c2e, roughness: 1 });
			var leafMat = new THREE.MeshStandardMaterial({ color: 0x526b39, roughness: 1, side: THREE.DoubleSide });
			var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * scale, 0.23 * scale, 5.4 * scale, 6), trunkMat);
			trunk.position.set(x, 2.7 * scale, z);
			trunk.rotation.z = rand(-0.08, 0.08);
			trunk.castShadow = true;
			scene.add(trunk);
			world.deco.push(trunk);
			for (var l = 0; l < 7; l++) {
				var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.32 * scale, 2.4 * scale, 4), leafMat);
				var a = (l / 7) * Math.PI * 2;
				leaf.position.set(x + Math.cos(a) * 0.8 * scale, 5.25 * scale, z + Math.sin(a) * 0.8 * scale);
				leaf.rotation.set(rand(0.9, 1.25), a, 0);
				leaf.castShadow = true;
				scene.add(leaf);
				world.deco.push(leaf);
			}
		}
		palm(-34, 31, 1.1);
		palm(34, -32, 1.0);
		palm(-35, -34, 0.9);
		palm(35, 33, 1.0);
		palm(-15, 35.5, 0.8);

		/* ---- lighting ---- */
		var hemi = new THREE.HemisphereLight(0xdce7f2, 0x7d6547, 0.85);
		scene.add(hemi);
		var sun = new THREE.DirectionalLight(0xffe6c0, 2.4);
		sun.position.set(-38, 56, 26);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		sun.shadow.camera.left = -48;
		sun.shadow.camera.right = 48;
		sun.shadow.camera.top = 48;
		sun.shadow.camera.bottom = -48;
		sun.shadow.camera.near = 1;
		sun.shadow.camera.far = 180;
		sun.shadow.bias = -0.0006;
		sun.shadow.normalBias = 0.025;
		scene.add(sun);
		scene.add(sun.target);
		sun.target.position.set(0, 0, 0);
		var fill = new THREE.DirectionalLight(0x9fc0e0, 0.35);
		fill.position.set(30, 22, -36);
		scene.add(fill);
		world.lights = { hemi: hemi, sun: sun, fill: fill };

		/* sky */
		var skyMat = new THREE.ShaderMaterial({
			uniforms: {
				top: { value: new THREE.Color(0x5f87ac) },
				mid: { value: new THREE.Color(0xb9c6ca) },
				horizon: { value: new THREE.Color(0xe8d8b8) },
				sunDir: { value: new THREE.Vector3(-0.55, 0.58, 0.42).normalize() }
			},
			vertexShader: [
				'varying vec3 vDir;',
				'void main() {',
				'  vDir = normalize(position);',
				'  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
				'}'
			].join('\n'),
			fragmentShader: [
				'varying vec3 vDir;',
				'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir;',
				'void main() {',
				'  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);',
				'  vec3 col = mix(horizon, mid, smoothstep(0.46, 0.56, h));',
				'  col = mix(col, top, smoothstep(0.56, 0.92, h));',
				'  float sd = max(dot(normalize(vDir), sunDir), 0.0);',
				'  col += vec3(1.0, 0.82, 0.55) * pow(sd, 90.0) * 1.4;',
				'  col += vec3(1.0, 0.78, 0.5) * pow(sd, 8.0) * 0.14;',
				'  gl_FragColor = vec4(col, 1.0);',
				'}'
			].join('\n'),
			side: THREE.BackSide,
			depthWrite: false,
			fog: false
		});
		var sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 18), skyMat);
		scene.add(sky);
		world.sky = sky;

		scene.fog = new THREE.Fog(0xd8c5a4, 55, 190);
		scene.background = new THREE.Color(0xd8c5a4);

		/* ---- ambient dust motes ---- */
		var dustCount = 220;
		var dustPos = new Float32Array(dustCount * 3);
		for (var d2 = 0; d2 < dustCount; d2++) {
			dustPos[d2 * 3] = rand(-45, 45);
			dustPos[d2 * 3 + 1] = rand(0.3, 5.5);
			dustPos[d2 * 3 + 2] = rand(-45, 45);
		}
		var dustGeo = new THREE.BufferGeometry();
		dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
		var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
			color: 0xffe8c0, size: 0.028, transparent: true, opacity: 0.2,
			depthWrite: false, sizeAttenuation: true
		}));
		scene.add(dust);
		world.dust = dust;

		world.materials = mats;
		return world;
	}

	/* ======================================================================
	   navigation grid + A*
	   ====================================================================== */

	function buildNav(colliders, bounds, radius) {
		var min = -(bounds - 1);
		var size = Math.floor((bounds - 1) * 2);
		var cell = 1;
		var blocked = new Uint8Array(size * size);
		for (var z = 0; z < size; z++) {
			for (var x = 0; x < size; x++) {
				var wx = min + x * cell + cell / 2;
				var wz = min + z * cell + cell / 2;
				var hit = false;
				for (var i = 0; i < colliders.length; i++) {
					var c = colliders[i];
					if (c.maxY < 0.25 || c.minY > 1.7) continue;
					if (wx > c.minX - radius && wx < c.maxX + radius &&
						wz > c.minZ - radius && wz < c.maxZ + radius) {
						hit = true;
						break;
					}
				}
				blocked[z * size + x] = hit ? 1 : 0;
			}
		}
		return { min: min, size: size, cell: cell, blocked: blocked, radius: radius };
	}

	function toCell(nav, x, z) {
		var ix = Math.floor((x - nav.min) / nav.cell);
		var iz = Math.floor((z - nav.min) / nav.cell);
		return { x: clamp(ix, 0, nav.size - 1), z: clamp(iz, 0, nav.size - 1) };
	}
	function cellFree(nav, x, z) {
		if (x < 0 || z < 0 || x >= nav.size || z >= nav.size) return false;
		return nav.blocked[z * nav.size + x] === 0;
	}
	function nearestFree(nav, x, z) {
		var c = toCell(nav, x, z);
		if (cellFree(nav, c.x, c.z)) return c;
		for (var r = 1; r < 12; r++) {
			for (var dz = -r; dz <= r; dz++) {
				for (var dx = -r; dx <= r; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
					if (cellFree(nav, c.x + dx, c.z + dz)) return { x: c.x + dx, z: c.z + dz };
				}
			}
		}
		return c;
	}
	function cellCenter(nav, c) {
		return { x: nav.min + c.x * nav.cell + nav.cell / 2, z: nav.min + c.z * nav.cell + nav.cell / 2 };
	}
	function navLineFree(nav, ax, az, bx, bz) {
		var dist = Math.hypot(bx - ax, bz - az);
		var steps = Math.ceil(dist / 0.32);
		for (var i = 0; i <= steps; i++) {
			var t = i / steps;
			var p = toCell(nav, lerp(ax, bx, t), lerp(az, bz, t));
			if (!cellFree(nav, p.x, p.z)) return false;
		}
		return true;
	}

	/* binary heap for A* */
	function Heap() { this.a = []; }
	Heap.prototype.push = function (node) {
		var a = this.a;
		a.push(node);
		var i = a.length - 1;
		while (i > 0) {
			var p = (i - 1) >> 1;
			if (a[p].f <= a[i].f) break;
			var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
		}
	};
	Heap.prototype.pop = function () {
		var a = this.a;
		var top = a[0];
		var last = a.pop();
		if (a.length) {
			a[0] = last;
			var i = 0;
			while (true) {
				var l = i * 2 + 1, r = l + 1, s = i;
				if (l < a.length && a[l].f < a[s].f) s = l;
				if (r < a.length && a[r].f < a[s].f) s = r;
				if (s === i) break;
				var t = a[s]; a[s] = a[i]; a[i] = t; i = s;
			}
		}
		return top;
	};
	Heap.prototype.empty = function () { return this.a.length === 0; };

	function findPath(nav, sx, sz, tx, tz) {
		var start = nearestFree(nav, sx, sz);
		var goal = nearestFree(nav, tx, tz);
		var size = nav.size;
		var startKey = start.z * size + start.x;
		var goalKey = goal.z * size + goal.x;
		if (startKey === goalKey) return [{ x: tx, z: tz }];

		var g = new Float32Array(size * size);
		var came = new Int32Array(size * size);
		var seen = new Uint8Array(size * size);
		for (var i = 0; i < g.length; i++) { g[i] = Infinity; came[i] = -1; }
		var open = new Heap();
		g[startKey] = 0;
		open.push({ x: start.x, z: start.z, f: 0 });
		var closed = new Uint8Array(size * size);
		var found = false;
		var guard = 0;
		var dirs = [
			[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
			[1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]
		];
		while (!open.empty() && guard++ < 6000) {
			var node = open.pop();
			var nk = node.z * size + node.x;
			if (closed[nk]) continue;
			closed[nk] = 1;
			if (nk === goalKey) { found = true; break; }
			for (var d = 0; d < 8; d++) {
				var nx = node.x + dirs[d][0], nz = node.z + dirs[d][1];
				if (!cellFree(nav, nx, nz)) continue;
				/* no diagonal corner cutting */
				if (dirs[d][0] && dirs[d][1]) {
					if (!cellFree(nav, node.x + dirs[d][0], node.z) || !cellFree(nav, node.x, node.z + dirs[d][1])) continue;
				}
				var nk2 = nz * size + nx;
				if (closed[nk2]) continue;
				var ng = g[nk] + dirs[d][2];
				if (ng < g[nk2]) {
					g[nk2] = ng;
					came[nk2] = nk;
					var h = Math.hypot(goal.x - nx, goal.z - nz);
					open.push({ x: nx, z: nz, f: ng + h });
				}
			}
		}
		if (!found) return null;
		var cells = [];
		var cur = goalKey;
		while (cur !== startKey) {
			cells.push({ x: cur % size, z: Math.floor(cur / size) });
			cur = came[cur];
			if (cur < 0) return null;
		}
		cells.reverse();
		var pts = cells.map(function (c) { return cellCenter(nav, c); });
		/* string pulling */
		var out = [];
		var idx = 0;
		while (idx < pts.length) {
			out.push(pts[idx]);
			var next = idx + 1;
			var furthest = idx + 1;
			while (next < pts.length && next - idx <= 18 && navLineFree(nav, pts[idx].x, pts[idx].z, pts[next].x, pts[next].z)) {
				furthest = next;
				next++;
			}
			idx = furthest;
		}
		if (out.length) out[out.length - 1] = { x: tx, z: tz };
		return out;
	}

	/* ======================================================================
	   robot model
	   ====================================================================== */
	function robotName() {
		var base = choice(BOT_NAMES);
		return Math.random() < 0.4 ? base + '-' + randi(2, 9) : base;
	}

	function drawHealthSprite(robot) {
		var c = robot.healthCanvas;
		var ctx = c.getContext('2d');
		ctx.clearRect(0, 0, 256, 72);
		/* name */
		ctx.font = '600 24px Bahnschrift, Arial Narrow, sans-serif';
		ctx.textAlign = 'left';
		ctx.fillStyle = robot.dead ? 'rgba(180,180,180,0.35)' : '#e8e2d4';
		ctx.fillText(robot.name, 6, 25);
		/* type */
		ctx.font = '400 13px Consolas, monospace';
		ctx.fillStyle = 'rgba(232,226,212,0.5)';
		ctx.textAlign = 'right';
		ctx.fillText(robot.type.label, 250, 24);
		/* hp bar */
		var pct = clamp(robot.hp / robot.maxHp, 0, 1);
		ctx.fillStyle = 'rgba(8,10,12,0.8)';
		ctx.fillRect(6, 36, 244, 11);
		ctx.fillStyle = pct > 0.55 ? robot.accent : pct > 0.25 ? '#e2a23c' : '#d6442f';
		ctx.fillRect(6, 36, 244 * pct, 11);
		ctx.strokeStyle = 'rgba(232,226,212,0.28)';
		ctx.lineWidth = 1;
		ctx.strokeRect(5.5, 35.5, 245, 12);
		robot.healthTex.needsUpdate = true;
	}

	function buildRobot(opts) {
		opts = opts || {};
		var type = opts.type || BOT_TYPES.trooper;
		var scale = type.scale || 1;
		var accent = opts.accent || type.accent;
		var torsoColor = opts.torso || type.torso;
		var name = opts.name || robotName();

		var root = new THREE.Group();
		root.scale.setScalar(scale);

		var bodyMat = new THREE.MeshStandardMaterial({ color: torsoColor, roughness: 0.62, metalness: 0.34 });
		var plateMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(torsoColor).multiplyScalar(0.72), roughness: 0.54, metalness: 0.46 });
		var jointMat = new THREE.MeshStandardMaterial({ color: 0x2c3033, roughness: 0.58, metalness: 0.55 });
		var accentMat = new THREE.MeshBasicMaterial({ color: accent });
		var accentGlow = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.72 });
		var gunMat = new THREE.MeshStandardMaterial({ color: 0x242729, roughness: 0.5, metalness: 0.56 });

		/* pelvis + legs */
		var pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.3), jointMat);
		pelvis.position.y = 0.9;
		root.add(pelvis);

		function makeLeg(side) {
			var g = new THREE.Group();
			g.position.set(side * 0.16, 0.86, 0);
			var thigh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.48, 0.23), jointMat);
			thigh.position.y = -0.22;
			g.add(thigh);
			var shin = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.44, 0.2), bodyMat);
			shin.position.y = -0.62;
			g.add(shin);
			var boot = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.16, 0.34), jointMat);
			boot.position.set(0, -0.83, 0.07);
			g.add(boot);
			var knee = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.12), plateMat);
			knee.position.set(0, -0.48, 0.1);
			g.add(knee);
			root.add(g);
			return g;
		}
		var legL = makeLeg(-1), legR = makeLeg(1);

		/* torso */
		var torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), bodyMat);
		torso.position.y = 1.28;
		torso.castShadow = true;
		root.add(torso);
		var chest = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.08), plateMat);
		chest.position.set(0, 1.32, 0.2);
		root.add(chest);
		var light = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), accentGlow);
		light.position.set(0, 1.43, 0.25);
		root.add(light);
		/* backpack */
		var pack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.46, 0.22), plateMat);
		pack.position.set(0, 1.3, -0.25);
		root.add(pack);
		if (type.plates >= 2) {
			var padL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.34), plateMat);
			padL.position.set(-0.4, 1.55, 0);
			root.add(padL);
			var padR = padL.clone();
			padR.position.x = 0.4;
			root.add(padR);
		}
		if (type.plates >= 3) {
			for (var p = 0; p < 3; p++) {
				var rib = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.07, 0.4), jointMat);
				rib.position.set(0, 1.09 + p * 0.09, 0.01);
				root.add(rib);
			}
		}

		/* head */
		var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.14, 8), jointMat);
		neck.position.y = 1.68;
		root.add(neck);
		var head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.3), bodyMat);
		head.position.y = 1.87;
		head.castShadow = true;
		root.add(head);
		var visor = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.07, 0.035), accentMat);
		visor.position.set(0, 1.89, 0.157);
		root.add(visor);
		var jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.05), jointMat);
		jaw.position.set(0, 1.78, 0.16);
		root.add(jaw);
		/* antenna */
		var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, type.id === 'sniper' ? 0.55 : 0.3, 6), jointMat);
		ant.position.set(0.11, 2.12, -0.05);
		ant.rotation.z = -0.22;
		root.add(ant);
		var antTip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), accentMat);
		antTip.position.set(0.18, 2.3, -0.05);
		root.add(antTip);
		/* ear pods */
		var earL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 8), plateMat);
		earL.rotation.z = Math.PI / 2;
		earL.position.set(-0.18, 1.88, 0);
		root.add(earL);
		var earR = earL.clone();
		earR.position.x = 0.18;
		root.add(earR);

		/* arms + rifle */
		var armL = new THREE.Group();
		armL.position.set(-0.36, 1.54, 0);
		var armLmesh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.5, 0.18), bodyMat);
		armLmesh.position.y = -0.24;
		armL.add(armLmesh);
		var handL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.18), jointMat);
		handL.position.set(0, -0.5, 0.08);
		armL.add(handL);
		root.add(armL);

		var armR = new THREE.Group();
		armR.position.set(0.36, 1.54, 0);
		var armRmesh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.5, 0.18), bodyMat);
		armRmesh.position.y = -0.24;
		armR.add(armRmesh);
		var handR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.18), jointMat);
		handR.position.set(0, -0.5, 0.08);
		armR.add(handR);
		root.add(armR);

		/* rifle */
		var gun = new THREE.Group();
		gun.position.set(0.18, 1.32, 0.28);
		gun.rotation.x = -0.04;
		var receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.5), gunMat);
		receiver.position.z = 0.02;
		gun.add(receiver);
		var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, type.barrel || 0.45, 8), gunMat);
		barrel.rotation.x = Math.PI / 2;
		barrel.position.z = (type.barrel || 0.45) / 2 + 0.24;
		gun.add(barrel);
		var handguard = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.32), plateMat);
		handguard.position.z = (type.barrel || 0.45) / 2 + 0.08;
		gun.add(handguard);
		var mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.12), jointMat);
		mag.position.set(0, -0.14, 0.02);
		gun.add(mag);
		var stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.24), gunMat);
		stock.position.z = -0.31;
		gun.add(stock);
		if (type.id === 'sniper') {
			var scope = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 10), gunMat);
			scope.rotation.x = Math.PI / 2;
			scope.position.set(0, 0.12, 0.02);
			gun.add(scope);
			var lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 10), accentMat);
			lens.position.set(0, 0.12, 0.165);
			lens.rotation.y = Math.PI;
			gun.add(lens);
		}
		var muzzle = new THREE.Object3D();
		muzzle.position.z = (type.barrel || 0.45) + 0.28;
		gun.add(muzzle);
		root.add(gun);
		armR.rotation.x = -0.55;
		armL.rotation.x = -0.8;
		armL.rotation.y = 0.2;

		/* health sprite */
		var hc = makeCanvas(256, 72);
		var htex = new THREE.CanvasTexture(hc);
		htex.colorSpace = THREE.SRGBColorSpace;
		var spriteMat = new THREE.SpriteMaterial({ map: htex, transparent: true, depthTest: true, depthWrite: false });
		var sprite = new THREE.Sprite(spriteMat);
		sprite.scale.set(1.9, 0.53, 1);
		sprite.position.y = 2.38;
		sprite.renderOrder = 20;
		root.add(sprite);

		var robot = {
			root: root,
			torso: torso,
			head: head,
			headBox: head,
			torsoBox: torso,
			legL: legL,
			legR: legR,
			armL: armL,
			armR: armR,
			gun: gun,
			muzzle: muzzle,
			healthSprite: sprite,
			healthCanvas: hc,
			healthTex: htex,
			name: name,
			type: type,
			accent: accent,
			torsoColor: torsoColor,
			hp: type.hp,
			maxHp: type.hp,
			dead: false,
			materials: [bodyMat, plateMat, jointMat, accentMat, accentGlow, gunMat],
			accentMat: accentMat,
			accentGlow: accentGlow
		};
		head.userData = { bot: robot, part: 'head', hit: true };
		torso.userData = { bot: robot, part: 'body', hit: true };
		/* full-body proxy: legs and arms should not swallow bullets without damage */
		var bodyHit = new THREE.Mesh(
			new THREE.BoxGeometry(0.78, 1.38, 0.52),
			new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
		);
		bodyHit.position.y = 0.86;
		bodyHit.visible = true;
		root.add(bodyHit);
		robot.bodyHit = bodyHit;
		robot.materials.push(bodyHit.material);
		drawHealthSprite(robot);
		return robot;
	}

	/* ======================================================================
	   first-person weapon models
	   ====================================================================== */
	function buildViewWeapons() {
		var metal = new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.5, metalness: 0.24 });
		var metalDark = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.55, metalness: 0.22 });
		var wood = new THREE.MeshStandardMaterial({ color: 0xb5723a, roughness: 0.58, metalness: 0.02 });
		var woodDark = new THREE.MeshStandardMaterial({ color: 0x84502a, roughness: 0.66, metalness: 0.02 });
		var polymer = new THREE.MeshStandardMaterial({ color: 0x41474d, roughness: 0.72, metalness: 0.08 });
		var tan = new THREE.MeshStandardMaterial({ color: 0xb59a6b, roughness: 0.7, metalness: 0.12 });
		var green = new THREE.MeshStandardMaterial({ color: 0x5b6a4e, roughness: 0.66, metalness: 0.08 });
		var glove = new THREE.MeshStandardMaterial({ color: 0x4a443a, roughness: 0.88, metalness: 0.02 });
		var sleeve = new THREE.MeshStandardMaterial({ color: 0x7b7a60, roughness: 0.95, metalness: 0 });
		var brass = new THREE.MeshStandardMaterial({ color: 0xd0aa5c, roughness: 0.36, metalness: 0.6 });
		var lens = new THREE.MeshBasicMaterial({ color: 0x7fc7e8 });
		var silver = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.38, metalness: 0.38 });

		function box(mat, w, h, d, x, y, z) {
			var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
			m.position.set(x || 0, y || 0, z || 0);
			return m;
		}
		function cyl(mat, rt, rb, h, x, y, z, seg) {
			var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 10), mat);
			m.position.set(x || 0, y || 0, z || 0);
			return m;
		}
		function hand(mat, x, y, z, sx, sy, sz) {
			var g = new THREE.Group();
			g.position.set(x, y, z);
			var palm = box(glove, sx, sy, sz);
			g.add(palm);
			for (var f = 0; f < 3; f++) {
				var finger = box(glove, sx * 0.24, sy * 0.5, sz * 1.1);
				finger.position.set((f - 1) * sx * 0.28, sy * 0.28, -sz * 0.45);
				g.add(finger);
			}
			return g;
		}
		function addSleeve(g, mat, x, y, z, rx) {
			var s = box(mat, 0.11, 0.11, 0.28);
			s.position.set(x, y, z);
			s.rotation.x = rx || 0;
			g.add(s);
		}
		function finish(group, muzzleZ, extra) {
			var muzzle = new THREE.Object3D();
			muzzle.position.set(0, 0, muzzleZ);
			group.add(muzzle);
			group.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
			return Object.assign({ group: group, muzzle: muzzle }, extra || {});
		}

		/* ---- USP-S ---- */
		function makeUSP() {
			var g = new THREE.Group();
			g.add(box(metalDark, 0.075, 0.085, 0.33, 0, 0.01, -0.16));
			g.add(box(metal, 0.06, 0.05, 0.3, 0, 0.07, -0.17));
			g.add(cyl(metalDark, 0.026, 0.026, 0.24, 0, 0.05, -0.43));
			g.add(cyl(metal, 0.034, 0.034, 0.15, 0, 0.05, -0.55));
			var grip1 = box(polymer, 0.06, 0.18, 0.16, 0, -0.1, 0.0); grip1.rotation.x = -0.18; g.add(grip1);
			g.add(box(polymer, 0.05, 0.06, 0.14, 0, -0.06, -0.08));
			g.add(box(metal, 0.02, 0.035, 0.03, 0, 0.11, -0.31));
			g.add(box(metal, 0.04, 0.025, 0.035, 0, 0.1, 0.02));
			var h = hand(glove, 0, -0.12, 0.0, 0.1, 0.09, 0.14);
			g.add(h);
			addSleeve(g, sleeve, 0.01, -0.22, 0.18, -0.4);
			var h2 = hand(glove, -0.02, -0.15, -0.03, 0.1, 0.085, 0.13);
			h2.rotation.z = 0.3;
			g.add(h2);
			g.position.set(0.19, -0.17, -0.42);
			g.rotation.set(0.03, -0.04, 0);
			return finish(g, -0.63);
		}

		/* ---- P250 ---- */
		function makeP250() {
			var g = new THREE.Group();
			g.add(box(polymer, 0.078, 0.09, 0.32, 0, 0.01, -0.15));
			g.add(box(metal, 0.066, 0.052, 0.29, 0, 0.08, -0.16));
			g.add(cyl(metalDark, 0.02, 0.02, 0.1, 0, 0.07, -0.34));
			var grip2 = box(polymer, 0.06, 0.19, 0.16, 0, -0.11, 0.01); grip2.rotation.x = -0.2; g.add(grip2);
			g.add(box(metal, 0.02, 0.04, 0.03, 0, 0.115, -0.28));
			g.add(hand(glove, 0, -0.12, 0.0, 0.1, 0.09, 0.14));
			addSleeve(g, sleeve, 0.01, -0.22, 0.18, -0.4);
			g.position.set(0.19, -0.17, -0.42);
			return finish(g, -0.46);
		}

		/* ---- Desert Eagle ---- */
		function makeDeagle() {
			var g = new THREE.Group();
			g.add(box(silver, 0.09, 0.11, 0.38, 0, 0.02, -0.17));
			g.add(box(metalDark, 0.075, 0.055, 0.33, 0, -0.06, -0.16));
			g.add(cyl(metalDark, 0.028, 0.028, 0.08, 0, 0.05, -0.4));
			var grip3 = box(polymer, 0.065, 0.2, 0.16, 0, -0.14, 0.01); grip3.rotation.x = -0.18; g.add(grip3);
			g.add(box(metal, 0.02, 0.045, 0.035, 0, 0.13, -0.32));
			g.add(box(metalDark, 0.055, 0.02, 0.16, 0, 0.09, -0.2));
			g.add(hand(glove, 0, -0.14, 0.0, 0.105, 0.09, 0.15));
			addSleeve(g, sleeve, 0.01, -0.24, 0.19, -0.4);
			g.position.set(0.2, -0.18, -0.44);
			g.rotation.set(0.03, -0.05, 0);
			return finish(g, -0.48);
		}

		/* ---- AK-47 ---- */
		function makeAK() {
			var g = new THREE.Group();
			g.add(box(metal, 0.085, 0.1, 0.42, 0, 0.0, -0.18));
			g.add(box(metalDark, 0.09, 0.06, 0.34, 0, 0.065, -0.19));
			g.add(cyl(metalDark, 0.015, 0.015, 0.4, 0, 0.04, -0.56));
			g.add(box(wood, 0.09, 0.1, 0.3, 0, 0.01, -0.42));
			g.add(box(woodDark, 0.08, 0.055, 0.26, 0, 0.075, -0.43));
			g.add(cyl(metalDark, 0.018, 0.018, 0.11, 0, 0.07, -0.32));
			/* magazine: three tilted blocks */
			var mag1 = box(metalDark, 0.07, 0.16, 0.11, 0, -0.15, -0.05); mag1.rotation.x = 0.18; g.add(mag1);
			var mag2 = box(metalDark, 0.065, 0.15, 0.1, 0, -0.26, -0.02); mag2.rotation.x = 0.44; g.add(mag2);
			var mag3 = box(metalDark, 0.06, 0.12, 0.09, 0, -0.34, 0.04); mag3.rotation.x = 0.7; g.add(mag3);
			var akGrip = box(polymer, 0.065, 0.17, 0.13, 0, -0.12, 0.09); akGrip.rotation.x = -0.22; g.add(akGrip);
			var akStock = box(wood, 0.08, 0.11, 0.3, 0, -0.04, 0.24); akStock.rotation.x = 0.06; g.add(akStock);
			g.add(box(woodDark, 0.07, 0.08, 0.2, 0, -0.1, 0.24));
			/* sights */
			g.add(box(metalDark, 0.02, 0.05, 0.025, 0, 0.12, -0.66));
			g.add(box(metalDark, 0.05, 0.03, 0.04, 0, 0.1, 0.0));
			/* hands */
			g.add(hand(glove, 0, -0.15, 0.08, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.27, 0.26, -0.4);
			g.add(hand(glove, 0, -0.08, -0.37, 0.1, 0.085, 0.15));
			addSleeve(g, woodDark, -0.01, -0.1, -0.54, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			/* keep references to the mag pieces for reload */
			return finish(g, -0.78, { mag: [mag1, mag2, mag3] });
		}

		/* ---- M4A4 ---- */
		function makeM4() {
			var g = new THREE.Group();
			g.add(box(metalDark, 0.075, 0.11, 0.44, 0, 0, -0.18));
			g.add(box(polymer, 0.07, 0.075, 0.4, 0, 0.085, -0.16));
			g.add(cyl(metalDark, 0.014, 0.014, 0.34, 0, 0.045, -0.54));
			g.add(box(polymer, 0.085, 0.095, 0.3, 0, 0.02, -0.4));
			g.add(cyl(metalDark, 0.02, 0.02, 0.08, 0, 0.045, -0.32));
			/* carry handle / optic */
			g.add(box(polymer, 0.04, 0.05, 0.24, 0, 0.14, -0.18));
			g.add(box(metal, 0.06, 0.06, 0.08, 0, 0.16, -0.26));
			g.add(box(metalDark, 0.05, 0.07, 0.05, 0, 0.16, -0.11));
			var mag = box(metalDark, 0.065, 0.22, 0.1, 0, -0.15, -0.04); mag.rotation.x = 0.05; g.add(mag);
			var m4Grip = box(polymer, 0.06, 0.16, 0.12, 0, -0.12, 0.1); m4Grip.rotation.x = -0.22; g.add(m4Grip);
			g.add(box(polymer, 0.075, 0.1, 0.28, 0, -0.03, 0.25));
			g.add(hand(glove, 0, -0.15, 0.1, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.27, 0.28, -0.4);
			g.add(hand(glove, 0, -0.08, -0.35, 0.1, 0.085, 0.15));
			addSleeve(g, tan, -0.01, -0.1, -0.52, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -0.73, { mag: [mag] });
		}

		/* ---- MP9 ---- */
		function makeMP9() {
			var g = new THREE.Group();
			g.add(box(metalDark, 0.08, 0.095, 0.34, 0, 0, -0.14));
			g.add(box(metal, 0.07, 0.05, 0.28, 0, 0.075, -0.16));
			g.add(cyl(metalDark, 0.013, 0.013, 0.2, 0, 0.04, -0.39));
			var mp9Mag = box(metalDark, 0.055, 0.18, 0.1, 0, -0.14, -0.04); mp9Mag.rotation.x = 0.06; g.add(mp9Mag);
			var mp9Grip = box(polymer, 0.06, 0.16, 0.12, 0, -0.12, 0.09); mp9Grip.rotation.x = -0.24; g.add(mp9Grip);
			g.add(box(polymer, 0.07, 0.09, 0.22, 0, -0.02, 0.22));
			g.add(box(metalDark, 0.02, 0.04, 0.025, 0, 0.12, -0.44));
			g.add(hand(glove, 0, -0.15, 0.08, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.27, 0.26, -0.4);
			g.add(hand(glove, 0, -0.08, -0.3, 0.1, 0.085, 0.15));
			addSleeve(g, tan, -0.01, -0.1, -0.46, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -0.52, { mag: [mp9Mag] });
		}

		/* ---- UMP-45 ---- */
		function makeUMP() {
			var g = new THREE.Group();
			g.add(box(metalDark, 0.09, 0.11, 0.4, 0, 0, -0.16));
			g.add(box(polymer, 0.08, 0.06, 0.3, 0, 0.085, -0.18));
			g.add(cyl(metalDark, 0.015, 0.015, 0.24, 0, 0.045, -0.46));
			var umpMag = box(metalDark, 0.06, 0.2, 0.11, 0, -0.16, -0.05); umpMag.rotation.x = 0.04; g.add(umpMag);
			var umpGrip = box(polymer, 0.065, 0.17, 0.13, 0, -0.12, 0.11); umpGrip.rotation.x = -0.22; g.add(umpGrip);
			g.add(box(polymer, 0.08, 0.1, 0.26, 0, -0.02, 0.27));
			g.add(box(metal, 0.03, 0.05, 0.11, 0, 0.14, -0.18));
			g.add(box(metalDark, 0.02, 0.04, 0.025, 0, 0.11, -0.52));
			g.add(hand(glove, 0, -0.15, 0.09, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.27, 0.28, -0.4);
			g.add(hand(glove, 0, -0.08, -0.35, 0.1, 0.085, 0.15));
			addSleeve(g, tan, -0.01, -0.1, -0.52, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -0.62, { mag: [umpMag] });
		}

		/* ---- Galil AR ---- */
		function makeGalil() {
			var g = new THREE.Group();
			g.add(box(metalDark, 0.085, 0.1, 0.42, 0, 0, -0.18));
			g.add(box(metal, 0.075, 0.06, 0.3, 0, 0.07, -0.2));
			g.add(cyl(metalDark, 0.015, 0.015, 0.42, 0, 0.04, -0.57));
			g.add(box(polymer, 0.09, 0.1, 0.3, 0, 0.01, -0.43));
			var galilMag = box(metalDark, 0.07, 0.2, 0.11, 0, -0.16, -0.04); galilMag.rotation.x = 0.1; g.add(galilMag);
			var galilGrip = box(polymer, 0.065, 0.17, 0.13, 0, -0.12, 0.1); galilGrip.rotation.x = -0.22; g.add(galilGrip);
			g.add(box(polymer, 0.08, 0.11, 0.28, 0, -0.03, 0.25));
			g.add(box(metalDark, 0.02, 0.05, 0.025, 0, 0.12, -0.72));
			g.add(box(metalDark, 0.05, 0.03, 0.04, 0, 0.1, 0.0));
			g.add(hand(glove, 0, -0.15, 0.08, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.27, 0.26, -0.4);
			g.add(hand(glove, 0, -0.08, -0.37, 0.1, 0.085, 0.15));
			addSleeve(g, tan, -0.01, -0.1, -0.54, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -0.8, { mag: [galilMag] });
		}

		/* ---- SG 553 ---- */
		function makeSG553() {
			var g = new THREE.Group();
			g.add(box(metalDark, 0.08, 0.1, 0.44, 0, 0, -0.18));
			g.add(box(polymer, 0.075, 0.065, 0.34, 0, 0.085, -0.2));
			g.add(cyl(metalDark, 0.014, 0.014, 0.34, 0, 0.045, -0.55));
			g.add(box(polymer, 0.09, 0.1, 0.3, 0, 0.01, -0.42));
			var sgMag = box(metalDark, 0.065, 0.2, 0.1, 0, -0.15, -0.04); sgMag.rotation.x = 0.06; g.add(sgMag);
			var sgGrip = box(polymer, 0.06, 0.16, 0.12, 0, -0.12, 0.1); sgGrip.rotation.x = -0.22; g.add(sgGrip);
			g.add(box(polymer, 0.075, 0.1, 0.28, 0, -0.02, 0.25));
			g.add(cyl(metalDark, 0.04, 0.04, 0.26, 0, 0.17, -0.18, 12));
			g.add(cyl(metal, 0.05, 0.04, 0.06, 0, 0.17, 0.0, 12));
			var sgLens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 12), lens);
			sgLens.position.set(0, 0.17, -0.315);
			sgLens.rotation.y = Math.PI;
			g.add(sgLens);
			g.add(hand(glove, 0, -0.15, 0.08, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.27, 0.26, -0.4);
			g.add(hand(glove, 0, -0.08, -0.36, 0.1, 0.085, 0.15));
			addSleeve(g, tan, -0.01, -0.1, -0.53, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -0.74, { mag: [sgMag] });
		}

		/* ---- SSG 08 ---- */
		function makeSSG08() {
			var g = new THREE.Group();
			g.add(box(green, 0.09, 0.11, 0.52, 0, -0.01, -0.16));
			g.add(box(metalDark, 0.08, 0.065, 0.4, 0, 0.075, -0.2));
			g.add(cyl(metalDark, 0.017, 0.017, 0.55, 0, 0.04, -0.73));
			g.add(cyl(metalDark, 0.023, 0.023, 0.09, 0, 0.04, -0.96));
			g.add(box(green, 0.1, 0.15, 0.22, 0, -0.05, 0.27));
			g.add(box(green, 0.09, 0.1, 0.2, 0, 0.04, 0.25));
			g.add(box(green, 0.1, 0.07, 0.28, 0, 0.12, -0.16));
			g.add(cyl(metalDark, 0.045, 0.045, 0.32, 0, 0.17, -0.18, 12));
			g.add(cyl(metal, 0.052, 0.045, 0.06, 0, 0.17, 0.0, 12));
			var ssgLens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 12), lens);
			ssgLens.position.set(0, 0.17, -0.325);
			ssgLens.rotation.y = Math.PI;
			g.add(ssgLens);
			var ssgBolt = cyl(metal, 0.016, 0.016, 0.13, 0.08, 0.055, -0.06, 8);
			ssgBolt.rotation.z = Math.PI / 2;
			g.add(ssgBolt);
			g.add(box(metalDark, 0.085, 0.07, 0.12, 0, -0.01, 0.14));
			g.add(hand(glove, 0, -0.12, 0.1, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.23, 0.28, -0.4);
			g.add(hand(glove, 0, -0.07, -0.46, 0.1, 0.085, 0.15));
			addSleeve(g, tan, -0.01, -0.09, -0.63, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -1.02);
		}

		/* ---- Nova ---- */
		function makeNova() {
			var g = new THREE.Group();
			g.add(box(metalDark, 0.085, 0.105, 0.4, 0, 0, -0.16));
			g.add(box(wood, 0.09, 0.1, 0.26, 0, 0.01, -0.38));
			g.add(cyl(metalDark, 0.025, 0.025, 0.44, 0, 0.04, -0.62));
			g.add(cyl(metalDark, 0.028, 0.028, 0.55, 0, 0.04, -0.6));
			var novaPump = box(woodDark, 0.095, 0.11, 0.2, 0, -0.02, -0.52); novaPump.rotation.x = 0.02; g.add(novaPump);
			var novaGrip = box(polymer, 0.06, 0.17, 0.12, 0, -0.13, 0.09); novaGrip.rotation.x = -0.22; g.add(novaGrip);
			g.add(box(wood, 0.08, 0.12, 0.3, 0, -0.04, 0.26));
			g.add(box(metal, 0.02, 0.045, 0.03, 0, 0.12, -0.78));
			g.add(hand(glove, 0, -0.15, 0.09, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.27, 0.28, -0.4);
			g.add(hand(glove, 0, -0.08, -0.48, 0.1, 0.085, 0.15));
			addSleeve(g, tan, -0.01, -0.1, -0.64, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -0.87);
		}

		/* ---- AWP ---- */
		function makeAWP() {
			var g = new THREE.Group();
			g.add(box(green, 0.09, 0.12, 0.55, 0, -0.01, -0.18));
			g.add(box(metalDark, 0.08, 0.07, 0.42, 0, 0.075, -0.2));
			g.add(cyl(metalDark, 0.019, 0.019, 0.62, 0, 0.04, -0.78));
			g.add(cyl(metalDark, 0.027, 0.027, 0.1, 0, 0.04, -1.06));
			g.add(box(green, 0.1, 0.16, 0.22, 0, -0.06, 0.25));
			g.add(box(green, 0.09, 0.11, 0.2, 0, 0.04, 0.24));
			g.add(box(green, 0.11, 0.07, 0.3, 0, 0.12, -0.18));
			/* scope */
			g.add(cyl(metalDark, 0.05, 0.05, 0.38, 0, 0.17, -0.18, 12));
			g.add(cyl(metal, 0.06, 0.05, 0.08, 0, 0.17, 0.02, 12));
			g.add(cyl(metal, 0.058, 0.058, 0.02, 0, 0.17, -0.38, 12));
			/* lens orientation: put a small disk at the front; easier as a box */
			var lensFront = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), lens);
			lensFront.position.set(0, 0.17, -0.385);
			lensFront.rotation.y = Math.PI;
			g.add(lensFront);
			/* bolt */
			var bolt = cyl(metal, 0.018, 0.018, 0.14, 0.08, 0.06, -0.08, 8);
			bolt.rotation.z = Math.PI / 2;
			g.add(bolt);
			g.add(box(metalDark, 0.09, 0.07, 0.12, 0, -0.01, 0.15));
			g.add(hand(glove, 0, -0.12, 0.1, 0.1, 0.09, 0.15));
			addSleeve(g, sleeve, 0.02, -0.23, 0.28, -0.4);
			g.add(hand(glove, 0, -0.07, -0.48, 0.1, 0.085, 0.15));
			addSleeve(g, tan, -0.01, -0.09, -0.65, -0.15);
			g.position.set(0.2, -0.18, -0.4);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -1.12);
		}

		/* ---- knife ---- */
		function makeKnife() {
			var g = new THREE.Group();
			g.add(box(metalDark, 0.035, 0.06, 0.16, 0, 0, 0.1));
			g.add(box(polymer, 0.04, 0.07, 0.05, 0, 0, 0.19));
			var bladeShape = new THREE.Shape();
			bladeShape.moveTo(0, 0.02);
			bladeShape.lineTo(0, -0.02);
			bladeShape.lineTo(-0.28, -0.045);
			bladeShape.lineTo(-0.34, 0.0);
			bladeShape.lineTo(-0.28, 0.032);
			bladeShape.lineTo(0, 0.02);
			var blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.008, bevelEnabled: false }), silver);
			blade.rotation.y = Math.PI / 2;
			blade.position.set(0, 0.03, -0.02);
			g.add(blade);
			g.add(hand(glove, 0, -0.03, 0.16, 0.1, 0.09, 0.14));
			addSleeve(g, sleeve, 0.01, -0.14, 0.28, -0.3);
			g.position.set(0.22, -0.2, -0.4);
			g.rotation.set(0.05, -0.1, 0.1);
			return finish(g, -0.4);
		}

		var defs = {
			usp: makeUSP(),
			p250: makeP250(),
			deagle: makeDeagle(),
			ak47: makeAK(),
			m4a4: makeM4(),
			mp9: makeMP9(),
			ump45: makeUMP(),
			galil: makeGalil(),
			sg553: makeSG553(),
			ssg08: makeSSG08(),
			nova: makeNova(),
			awp: makeAWP(),
			knife: makeKnife()
		};
		/* muzzle flash sprites + lights are created by the game */
		return defs;
	}

	/* ======================================================================
	   world-space weapon pickup
	   ====================================================================== */
	function buildWeaponPickup(weaponId, def, ammo) {
		ammo = ammo || {};
		var group = new THREE.Group();
		var metal = new THREE.MeshStandardMaterial({ color: 0x3c4247, roughness: 0.52, metalness: 0.34 });
		var dark = new THREE.MeshStandardMaterial({ color: 0x1f2327, roughness: 0.6, metalness: 0.26 });
		var accentColor = def.category === 'SNIPER' ? 0x6f7b62 : def.category === 'SHOTGUN' ? 0x9a6134 : def.category === 'SMG' ? 0x48545e : 0x5f5a4f;
		var accent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.62, metalness: 0.12 });
		var body = new THREE.Group();
		var icon = def.icon || 'rifle';
		function box(mat, w, h, d, x, y, z) {
			var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
			m.position.set(x, y, z);
			body.add(m);
			return m;
		}
		if (icon === 'pistol') {
			box(dark, 0.32, 0.13, 0.14, 0, 0, 0);
			box(metal, 0.26, 0.06, 0.08, -0.08, 0.085, 0);
			box(metal, 0.16, 0.03, 0.03, 0.23, 0.02, 0);
			var pg = box(accent, 0.12, 0.2, 0.12, -0.1, -0.13, 0); pg.rotation.z = -0.2;
			box(dark, 0.09, 0.18, 0.1, 0, -0.12, 0);
		} else if (icon === 'sniper') {
			box(accent, 0.62, 0.13, 0.14, -0.04, 0, 0);
			box(metal, 0.7, 0.05, 0.05, 0.34, 0.02, 0);
			box(metal, 0.14, 0.09, 0.09, 0.74, 0.02, 0);
			box(dark, 0.26, 0.1, 0.16, -0.22, -0.03, 0);
			box(dark, 0.06, 0.14, 0.2, -0.12, 0.13, 0);
			var scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12), dark);
			scope.rotation.z = Math.PI / 2;
			scope.position.set(0.02, 0.16, 0);
			body.add(scope);
		} else if (icon === 'shotgun') {
			box(accent, 0.52, 0.14, 0.16, -0.04, 0, 0);
			box(metal, 0.6, 0.06, 0.06, 0.37, 0.02, 0);
			box(metal, 0.5, 0.045, 0.045, 0.3, -0.08, 0);
			box(dark, 0.26, 0.16, 0.12, -0.23, -0.04, 0);
			box(dark, 0.15, 0.2, 0.12, -0.06, -0.14, 0);
		} else if (icon === 'smg') {
			box(accent, 0.4, 0.14, 0.14, 0, 0, 0);
			box(metal, 0.28, 0.045, 0.045, 0.3, 0.02, 0);
			box(dark, 0.08, 0.2, 0.09, 0.04, -0.16, 0);
			box(dark, 0.1, 0.16, 0.1, -0.12, -0.13, 0);
			box(dark, 0.2, 0.1, 0.1, -0.3, 0, 0);
		} else {
			box(accent, 0.5, 0.14, 0.14, 0, 0, 0);
			box(metal, 0.4, 0.05, 0.05, 0.38, 0.02, 0);
			box(dark, 0.08, 0.23, 0.1, 0.06, -0.18, 0);
			box(dark, 0.1, 0.17, 0.1, -0.13, -0.14, 0);
			box(dark, 0.22, 0.11, 0.1, -0.31, 0, 0);
			box(dark, 0.05, 0.07, 0.1, -0.02, 0.12, 0);
		}
		body.position.y = 0.62;
		body.rotation.z = 0.06;
		group.add(body);

		/* ground ring + subtle light shaft */
		var ringMat = new THREE.MeshBasicMaterial({
			color: 0xffc266, transparent: true, opacity: 0.56, side: THREE.DoubleSide,
			depthWrite: false, blending: THREE.AdditiveBlending
		});
		var ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 28), ringMat);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.025;
		group.add(ring);
		var beamMat = new THREE.MeshBasicMaterial({
			color: 0xffb85a, transparent: true, opacity: 0.07, depthWrite: false,
			blending: THREE.AdditiveBlending, side: THREE.DoubleSide
		});
		var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.24, 1.6, 10, 1, true), beamMat);
		beam.position.y = 0.8;
		group.add(beam);

		/* floating name / ammo label */
		var canvas = makeCanvas(512, 128);
		var ctx = canvas.getContext('2d');
		ctx.fillStyle = 'rgba(5,8,10,0.82)';
		ctx.fillRect(0, 0, 512, 128);
		ctx.strokeStyle = 'rgba(215,162,74,0.9)';
		ctx.lineWidth = 4;
		ctx.strokeRect(2, 2, 508, 124);
		ctx.fillStyle = '#e8e2d4';
		ctx.font = '700 54px Bahnschrift, Arial Narrow, sans-serif';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillText(def.name, 24, 66);
		ctx.fillStyle = 'rgba(215,162,74,0.9)';
		ctx.font = '400 26px Consolas, monospace';
		ctx.textAlign = 'right';
		ctx.fillText((ammo.mag || 0) + ' / ' + (ammo.reserve || 0), 490, 66);
		var labelTex = new THREE.CanvasTexture(canvas);
		labelTex.colorSpace = THREE.SRGBColorSpace;
		var labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: true, depthWrite: false });
		var label = new THREE.Sprite(labelMat);
		label.scale.set(1.1, 0.275, 1);
		label.position.y = 1.45;
		group.add(label);

		return {
			group: group,
			body: body,
			ring: ring,
			beam: beam,
			label: label,
			labelTex: labelTex,
			materials: [metal, dark, accent, ringMat, beamMat, labelMat]
		};
	}

	/* ======================================================================
	   practice target / chicken / player body
	   ====================================================================== */
	function makeTargetTexture(kind) {
		var w = 512, h = 640;
		var canvas = makeCanvas(w, h);
		var ctx = canvas.getContext('2d');
		var steel = kind === 'steel';
		ctx.fillStyle = steel ? '#33393a' : '#e7dcc2';
		ctx.fillRect(0, 0, w, h);
		ctx.strokeStyle = steel ? '#171c1d' : '#3a3025';
		ctx.lineWidth = 18;
		ctx.strokeRect(9, 9, w - 18, h - 18);
		ctx.fillStyle = steel ? '#242a2b' : '#f4ecda';
		ctx.fillRect(26, 26, w - 52, h - 52);
		var cx = w / 2, cy = 312, rings = [
			[168, steel ? '#ddd6c2' : '#c84534'],
			[128, steel ? '#c84534' : '#f2e7ce'],
			[92, steel ? '#ddd6c2' : '#c84534'],
			[56, steel ? '#c84534' : '#f2e7ce'],
			[24, '#d7a24a']
		];
		for (var i = 0; i < rings.length; i++) {
			ctx.fillStyle = rings[i][1];
			ctx.beginPath();
			ctx.arc(cx, cy, rings[i][0], 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.strokeStyle = steel ? 'rgba(0,0,0,.4)' : 'rgba(45,35,24,.35)';
		ctx.lineWidth = 3;
		for (var t = -1; t <= 1; t += 2) {
			ctx.beginPath();
			ctx.moveTo(cx + t * 220, cy - 210);
			ctx.lineTo(cx + t * 220, cy + 210);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(cx - 210, cy + t * 220);
			ctx.lineTo(cx + 210, cy + t * 220);
			ctx.stroke();
		}
		ctx.fillStyle = steel ? '#e8dfc9' : '#4a3b2c';
		ctx.font = '700 30px Bahnschrift, Arial Narrow, sans-serif';
		ctx.textAlign = 'center';
		ctx.letterSpacing = '8px';
		ctx.fillText('PRACTICE', cx, 66);
		ctx.font = '400 19px Consolas, monospace';
		ctx.fillStyle = steel ? 'rgba(232,223,201,.6)' : 'rgba(74,59,44,.65)';
		ctx.fillText('DUST RANGE // TARGET', cx, 592);
		var tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = 4;
		return tex;
	}

	function buildPracticeTarget(kind, scale) {
		scale = scale || 1;
		var root = new THREE.Group();
		var pivot = new THREE.Group();
		pivot.position.y = 0.62;
		root.add(pivot);
		var frameMat = new THREE.MeshStandardMaterial({ color: 0x252b2c, roughness: 0.66, metalness: 0.35 });
		var postMat = new THREE.MeshStandardMaterial({ color: 0x555d5d, roughness: 0.5, metalness: 0.55 });
		var standMat = new THREE.MeshStandardMaterial({ color: 0x2d3334, roughness: 0.75, metalness: 0.3 });
		var boardMat = new THREE.MeshStandardMaterial({ map: makeTargetTexture(kind), roughness: kind === 'steel' ? 0.5 : 0.9, metalness: kind === 'steel' ? 0.35 : 0.02 });
		function box(mat, w, h, d, x, y, z, parent) {
			var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
			m.position.set(x, y, z);
			m.castShadow = true;
			m.receiveShadow = true;
			(parent || root).add(m);
			return m;
		}
		/* A-frame feet and post */
		box(standMat, 1.12, 0.1, 0.52, 0, 0.05, 0.09);
		box(standMat, 0.14, 0.08, 0.7, -0.38, 0.03, 0.13);
		box(standMat, 0.14, 0.08, 0.7, 0.38, 0.03, 0.13);
		var post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.62, 8), postMat);
		post.position.set(0, 0.31, 0.04);
		post.castShadow = true;
		root.add(post);
		/* board frame and face */
		box(frameMat, 1.2, 1.5, 0.1, 0, 0.73, 0, pivot);
		var face = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.38), boardMat);
		face.position.set(0, 0.73, 0.056);
		face.castShadow = false;
		pivot.add(face);
		var brace = box(postMat, 0.08, 0.62, 0.06, 0, 0.29, 0.12, pivot);
		brace.rotation.x = -0.18;
		/* little service lamp */
		var lampMat = new THREE.MeshBasicMaterial({ color: 0xffb54a });
		var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), lampMat);
		lamp.position.set(0.48, 1.56, 0.07);
		pivot.add(lamp);
		root.scale.setScalar(scale);
		root.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
		return {
			root: root,
			pivot: pivot,
			face: face,
			board: face,
			materials: [frameMat, postMat, standMat, boardMat, lampMat],
			kind: kind || 'paper',
			scale: scale
		};
	}

	function buildChicken(opts) {
		opts = opts || {};
		var root = new THREE.Group();
		var feather = new THREE.MeshStandardMaterial({ color: opts.color || 0xe8dfca, roughness: 0.92, metalness: 0 });
		var featherDark = new THREE.MeshStandardMaterial({ color: opts.dark || 0xb9a886, roughness: 0.95, metalness: 0 });
		var beakMat = new THREE.MeshStandardMaterial({ color: 0xd99532, roughness: 0.7, metalness: 0.05 });
		var combMat = new THREE.MeshStandardMaterial({ color: 0xb23c30, roughness: 0.8, metalness: 0.03 });
		var legMat = new THREE.MeshStandardMaterial({ color: 0xb68b48, roughness: 0.8, metalness: 0 });
		var eyeMat = new THREE.MeshBasicMaterial({ color: 0x141311 });
		function add(mesh, parent) { (parent || root).add(mesh); return mesh; }
		function sphere(mat, r, x, y, z, sx, sy, sz, parent) {
			var m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
			m.position.set(x, y, z);
			m.scale.set(sx || 1, sy || 1, sz || 1);
			m.castShadow = true;
			m.receiveShadow = true;
			add(m, parent);
			return m;
		}
		function box(mat, w, h, d, x, y, z, parent) {
			var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
			m.position.set(x, y, z);
			m.castShadow = true;
			m.receiveShadow = true;
			add(m, parent);
			return m;
		}
		var body = sphere(feather, 0.29, 0, 0.34, 0, 1.05, 0.9, 1.3);
		sphere(featherDark, 0.16, 0, 0.29, 0.19, 1.0, 1.0, 0.9);
		var neck = sphere(feather, 0.12, 0, 0.5, -0.19, 0.85, 1.1, 0.85);
		var head = sphere(feather, 0.145, 0, 0.59, -0.24, 1.0, 1.0, 1.0);
		var beak = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.17, 5), beakMat);
		beak.rotation.x = Math.PI / 2;
		beak.position.set(0, 0.57, -0.39);
		beak.castShadow = true;
		root.add(beak);
		box(combMat, 0.055, 0.12, 0.13, 0, 0.745, -0.24);
		box(combMat, 0.12, 0.04, 0.06, 0, 0.805, -0.23);
		box(combMat, 0.045, 0.09, 0.045, 0, 0.52, -0.35);
		sphere(eyeMat, 0.018, -0.065, 0.615, -0.36);
		sphere(eyeMat, 0.018, 0.065, 0.615, -0.36);
		/* wings */
		var wingL = new THREE.Group();
		wingL.position.set(-0.27, 0.42, 0.0);
		root.add(wingL);
		box(featherDark, 0.05, 0.22, 0.32, -0.02, -0.06, 0.02, wingL);
		var wingR = new THREE.Group();
		wingR.position.set(0.27, 0.42, 0.0);
		root.add(wingR);
		box(featherDark, 0.05, 0.22, 0.32, 0.02, -0.06, 0.02, wingR);
		/* tail feathers */
		for (var i = 0; i < 3; i++) {
			var tf = box(featherDark, 0.045, 0.1, 0.25, (i - 1) * 0.08, 0.43 + Math.abs(i - 1) * 0.02, 0.32);
			tf.rotation.x = -0.45 + (i - 1) * 0.05;
			tf.rotation.y = (i - 1) * 0.12;
		}
		/* legs */
		function leg(side) {
			var g = new THREE.Group();
			g.position.set(side * 0.1, 0.2, 0.02);
			root.add(g);
			box(legMat, 0.035, 0.22, 0.035, 0, -0.1, 0, g);
			box(legMat, 0.13, 0.03, 0.08, side * 0.02, -0.21, -0.025, g);
			return g;
		}
		var legL = leg(-1), legR = leg(1);
		root.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
		return {
			root: root, body: body, head: head, neck: neck,
			wingL: wingL, wingR: wingR, legL: legL, legR: legR,
			materials: [feather, featherDark, beakMat, combMat, legMat, eyeMat]
		};
	}

	function buildPlayerBody() {
		var root = new THREE.Group();
		var uniform = new THREE.MeshStandardMaterial({ color: 0x34434f, roughness: 0.82, metalness: 0.05 });
		var uniformDark = new THREE.MeshStandardMaterial({ color: 0x232d35, roughness: 0.88, metalness: 0.04 });
		var vest = new THREE.MeshStandardMaterial({ color: 0x5c6c58, roughness: 0.86, metalness: 0.05 });
		var helmet = new THREE.MeshStandardMaterial({ color: 0x3b4c45, roughness: 0.7, metalness: 0.16 });
		var skin = new THREE.MeshStandardMaterial({ color: 0xb98d6d, roughness: 0.92, metalness: 0 });
		var visor = new THREE.MeshStandardMaterial({ color: 0x1e2a2f, roughness: 0.26, metalness: 0.42 });
		var boot = new THREE.MeshStandardMaterial({ color: 0x1c2224, roughness: 0.92, metalness: 0.04 });
		var gunMat = new THREE.MeshStandardMaterial({ color: 0x2d3334, roughness: 0.5, metalness: 0.4 });
		var patchMat = new THREE.MeshBasicMaterial({ color: 0xd7a24a });
		function box(mat, w, h, d, x, y, z, parent) {
			var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
			m.position.set(x, y, z);
			m.castShadow = true;
			m.receiveShadow = true;
			(parent || root).add(m);
			return m;
		}
		/* legs */
		box(uniform, 0.19, 0.6, 0.21, -0.16, 0.68, 0);
		box(uniform, 0.19, 0.6, 0.21, 0.16, 0.68, 0);
		box(uniformDark, 0.2, 0.22, 0.23, -0.16, 0.27, 0);
		box(uniformDark, 0.2, 0.22, 0.23, 0.16, 0.27, 0);
		box(boot, 0.21, 0.16, 0.34, -0.16, 0.09, -0.06);
		box(boot, 0.21, 0.16, 0.34, 0.16, 0.09, -0.06);
		/* hips and torso */
		box(uniformDark, 0.5, 0.22, 0.28, 0, 0.99, 0);
		box(uniform, 0.54, 0.56, 0.31, 0, 1.33, 0);
		box(vest, 0.58, 0.45, 0.36, 0, 1.36, 0.01);
		box(uniformDark, 0.56, 0.1, 0.34, 0, 1.09, 0);
		box(patchMat, 0.15, 0.08, 0.015, -0.18, 1.33, -0.19);
		/* arms */
		box(uniform, 0.15, 0.5, 0.17, -0.36, 1.34, -0.01);
		box(uniform, 0.15, 0.5, 0.17, 0.36, 1.34, -0.01);
		box(skin, 0.12, 0.14, 0.14, -0.37, 1.02, -0.11);
		box(skin, 0.12, 0.14, 0.14, 0.37, 1.02, -0.11);
		/* head / helmet / visor */
		box(skin, 0.24, 0.26, 0.23, 0, 1.77, -0.01);
		box(helmet, 0.32, 0.15, 0.31, 0, 1.92, 0);
		box(helmet, 0.3, 0.1, 0.08, 0, 1.83, -0.16);
		box(visor, 0.26, 0.09, 0.03, 0, 1.81, -0.19);
		box(uniformDark, 0.17, 0.18, 0.15, 0, 1.55, -0.02);
		/* rifle across the chest */
		var rifle = box(gunMat, 0.09, 0.12, 0.78, 0.05, 1.32, -0.26);
		rifle.rotation.x = -0.08;
		box(gunMat, 0.06, 0.22, 0.1, 0.05, 1.18, -0.06);
		box(patchMat, 0.02, 0.03, 0.14, 0.05, 1.39, -0.42);
		root.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
		root.visible = false;
		return root;
	}

	/* ======================================================================
	   weapon silhouette icons for the buy menu
	   ====================================================================== */
	function weaponIcon(kind) {
		if (kind === 'rifle') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M6 26h13l6-7h38l3 5h19l2-3h8v7h-9l-2 3H63l-9 5H43l-4 13H28l6-13H20l-6 4H6z"/>' +
				'<path d="M67 19h15v9H67z" opacity=".65"/>' +
				'<path d="M83 23h28v3H83z"/><path d="M104 26h12v3h-12z"/>' +
				'</svg>';
		}
		if (kind === 'smg') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M22 24h20l5-6h34l3 6h13v8H76l-4 4H58v9H44v-9H36l-8 5H22z"/>' +
				'<path d="M74 18h18v7H74z" opacity=".55"/>' +
				'<path d="M86 23h26v3H86z"/><path d="M102 26h13v3h-13z"/>' +
				'</svg>';
		}
		if (kind === 'shotgun') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M6 29h12l6-5h34l4 4h12v5H62l-8 5H43l-4 11H30l4-11H17l-5 4H6z"/>' +
				'<path d="M58 21h14v9H58z" opacity=".55"/>' +
				'<path d="M68 24h44v4H68z"/><path d="M100 28h16v3h-16z"/>' +
				'<circle cx="47" cy="26" r="3" fill="#0a0e12"/>' +
				'</svg>';
		}
		if (kind === 'sniper') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M4 28h12l8-7h30l4 4h18l3-3h8l-1 6h14v6h-13l-2 2H64l-9 5H44l-3 11H30l4-11H16l-7 4H4z"/>' +
				'<rect x="52" y="10" width="32" height="7" rx="2"/><rect x="48" y="12" width="5" height="3"/><rect x="83" y="12" width="5" height="3"/>' +
				'<path d="M70 27h42v3H70z"/><path d="M100 30h16v3h-16z"/>' +
				'</svg>';
		}
		if (kind === 'pistol') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M28 17h50v13H60l-4 4-7 14H36l8-16H28z"/>' +
				'<path d="M78 20h25v4H78z"/><path d="M96 24h18v3H96z"/>' +
				'<path d="M47 22h13v4H47z" opacity=".5"/>' +
				'</svg>';
		}
		if (kind === 'knife') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M18 30l55-18c11-3 23-1 29 3-7 4-18 7-28 10L26 41z"/>' +
				'<path d="M14 33h16v7H14z"/><path d="M8 35h8v4H8z" opacity=".6"/>' +
				'</svg>';
		}
		return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
			'<path d="M60 8l26 10v12c0 12-11 20-26 24-15-4-26-12-26-24V18z"/>' +
			'<path d="M60 16l16 6v8c0 7-6 13-16 17-10-4-16-10-16-17v-8z" fill="#0a0e12"/>' +
			'</svg>';
	}

	/* ======================================================================
	   audio synthesiser
	   ====================================================================== */
	function SoundEngine() {
		this.ctx = null;
		this.master = null;
		this.wet = null;
		this.noise = null;
		this.muted = false;
		this.volume = 0.7;
		this.ambience = null;
	}
	SoundEngine.prototype.ensure = function () {
		if (this.ctx) {
			if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
			return true;
		}
		var AC = global.AudioContext || global.webkitAudioContext;
		if (!AC) return false;
		try {
			var ctx = new AC();
			this.ctx = ctx;
			this.master = ctx.createGain();
			this.master.gain.value = this.muted ? 0 : this.volume;
			this.master.connect(ctx.destination);

			var conv = ctx.createConvolver();
			var len = Math.floor(ctx.sampleRate * 0.45);
			var impulse = ctx.createBuffer(2, len, ctx.sampleRate);
			for (var ch = 0; ch < 2; ch++) {
				var d = impulse.getChannelData(ch);
				for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
			}
			conv.buffer = impulse;
			this.wet = ctx.createGain();
			this.wet.gain.value = 0.16;
			this.wet.connect(conv);
			conv.connect(this.master);

			/* 2s noise buffer */
			var nlen = Math.floor(ctx.sampleRate * 2);
			var nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
			var data = nb.getChannelData(0);
			for (var j = 0; j < nlen; j++) data[j] = Math.random() * 2 - 1;
			this.noise = nb;

			/* ambience */
			try {
				var amb = ctx.createBufferSource();
				amb.buffer = nb; amb.loop = true;
				var ambFilter = ctx.createBiquadFilter();
				ambFilter.type = 'lowpass'; ambFilter.frequency.value = 420;
				var ambGain = ctx.createGain();
				ambGain.gain.value = 0.012;
				amb.connect(ambFilter); ambFilter.connect(ambGain); ambGain.connect(this.master);
				amb.start();
				this.ambience = amb;
			} catch (e2) {}
			return true;
		} catch (e) {
			this.ctx = null;
			return false;
		}
	};
	SoundEngine.prototype.setVolume = function (v) {
		this.volume = clamp(v, 0, 1);
		if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
	};
	SoundEngine.prototype.toggleMute = function () {
		this.muted = !this.muted;
		if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
		return this.muted;
	};
	SoundEngine.prototype.burst = function (o) {
		if (!this.ctx || this.muted) return;
		var ctx = this.ctx, t = ctx.currentTime;
		var dur = o.dur || 0.1;
		var src = ctx.createBufferSource();
		src.buffer = this.noise;
		src.playbackRate.value = o.rate || 1;
		var filter = ctx.createBiquadFilter();
		filter.type = o.type || 'bandpass';
		filter.frequency.value = o.freq || 1000;
		filter.Q.value = o.q != null ? o.q : 0.8;
		var gain = ctx.createGain();
		var peak = o.gain != null ? o.gain : 0.3;
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.linearRampToValueAtTime(peak, t + 0.005);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		var panner = null;
		if (o.pan != null && ctx.createStereoPanner) {
			panner = ctx.createStereoPanner();
			panner.pan.value = clamp(o.pan, -1, 1);
			src.connect(filter); filter.connect(gain); gain.connect(panner); panner.connect(this.master);
			if (this.wet) { var wg = ctx.createGain(); wg.gain.value = (o.wet || 0.12); panner.connect(wg); wg.connect(this.wet); }
		} else {
			src.connect(filter); filter.connect(gain); gain.connect(this.master);
			if (this.wet) { var wg2 = ctx.createGain(); wg2.gain.value = (o.wet || 0.12); gain.connect(wg2); wg2.connect(this.wet); }
		}
		src.start(t);
		src.stop(t + dur + 0.05);
	};
	SoundEngine.prototype.tone = function (o) {
		if (!this.ctx || this.muted) return;
		var ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
		var osc = ctx.createOscillator();
		osc.type = o.type || 'sine';
		osc.frequency.setValueAtTime(o.freq || 220, t);
		if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.dur || 0.1));
		var g = ctx.createGain();
		var peak = o.gain != null ? o.gain : 0.2;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.linearRampToValueAtTime(peak, t + 0.006);
		g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || 0.1));
		var panner = null;
		if (o.pan != null && ctx.createStereoPanner) {
			panner = ctx.createStereoPanner();
			panner.pan.value = clamp(o.pan, -1, 1);
			osc.connect(g); g.connect(panner); panner.connect(this.master);
			if (this.wet) { var w = ctx.createGain(); w.gain.value = 0.1; panner.connect(w); w.connect(this.wet); }
		} else {
			osc.connect(g); g.connect(this.master);
		}
		osc.start(t);
		osc.stop(t + (o.dur || 0.1) + 0.05);
	};
	SoundEngine.prototype.shot = function (id, pan, dist) {
		var att = dist == null ? 1 : clamp(1 - dist / 85, 0.12, 1);
		att *= att;
		if (id === 'sniper') {
			this.burst({ dur: 0.34, type: 'lowpass', freq: 1400, q: 0.6, gain: 0.62 * att, pan: pan, wet: 0.3 });
			this.tone({ freq: 90, to: 38, dur: 0.28, gain: 0.4 * att, type: 'triangle' });
		} else if (id === 'rifle' || id === 'rifle2') {
			this.burst({ dur: 0.13, type: 'bandpass', freq: id === 'rifle' ? 1150 : 1550, q: 0.7, gain: 0.42 * att, pan: pan, wet: 0.2 });
			this.burst({ dur: 0.2, type: 'lowpass', freq: 700, q: 0.4, gain: 0.24 * att, pan: pan });
			this.tone({ freq: id === 'rifle' ? 105 : 125, to: 45, dur: 0.14, gain: 0.25 * att, type: 'triangle' });
		} else if (id === 'deagle') {
			this.burst({ dur: 0.18, type: 'bandpass', freq: 900, q: 0.8, gain: 0.5 * att, pan: pan, wet: 0.22 });
			this.tone({ freq: 120, to: 42, dur: 0.18, gain: 0.32 * att, type: 'triangle' });
		} else if (id === 'smg') {
			this.burst({ dur: 0.085, type: 'bandpass', freq: 1850, q: 0.65, gain: 0.32 * att, pan: pan, wet: 0.14 });
			this.burst({ dur: 0.12, type: 'lowpass', freq: 850, q: 0.5, gain: 0.16 * att, pan: pan });
			this.tone({ freq: 180, to: 90, dur: 0.08, gain: 0.12 * att, type: 'triangle' });
		} else if (id === 'shotgun') {
			this.burst({ dur: 0.24, type: 'lowpass', freq: 900, q: 0.55, gain: 0.56 * att, pan: pan, wet: 0.26 });
			this.burst({ dur: 0.12, type: 'bandpass', freq: 1500, q: 0.7, gain: 0.24 * att, pan: pan });
			this.tone({ freq: 95, to: 38, dur: 0.24, gain: 0.34 * att, type: 'triangle' });
		} else if (id === 'knife') {
			this.burst({ dur: 0.08, type: 'highpass', freq: 2600, q: 0.5, gain: 0.16 * att, pan: pan, wet: 0.1 });
			this.tone({ freq: 900, to: 1600, dur: 0.08, gain: 0.06, type: 'sawtooth' });
		} else {
			this.burst({ dur: 0.1, type: 'bandpass', freq: 1600, q: 0.8, gain: 0.34 * att, pan: pan, wet: 0.16 });
			this.tone({ freq: 150, to: 70, dur: 0.1, gain: 0.18 * att, type: 'triangle' });
		}
	};
	SoundEngine.prototype.dry = function () {
		this.burst({ dur: 0.035, type: 'highpass', freq: 1800, gain: 0.13, pan: 0 });
		this.tone({ freq: 620, to: 480, dur: 0.03, gain: 0.05, type: 'square' });
	};
	SoundEngine.prototype.reload = function () {
		var self = this;
		[[0, 1500, 0.12], [0.18, 900, 0.09], [0.42, 1200, 0.1], [0.62, 700, 0.08]].forEach(function (c) {
			setTimeout(function () {
				self.burst({ dur: 0.04, type: 'bandpass', freq: c[1], q: 1.3, gain: c[2], pan: 0 });
			}, c[0] * 1000);
		});
	};
	SoundEngine.prototype.switchWeapon = function () {
		this.burst({ dur: 0.07, type: 'bandpass', freq: 1400, q: 1.1, gain: 0.12 });
	};
	SoundEngine.prototype.hit = function (head) {
		if (head) {
			this.tone({ freq: 1900, to: 2400, dur: 0.05, gain: 0.18, type: 'square' });
			this.tone({ freq: 2600, to: 3100, dur: 0.05, gain: 0.1, type: 'sine', delay: 0.02 });
			this.tone({ freq: 160, to: 90, dur: 0.08, gain: 0.12, type: 'triangle' });
		} else {
			this.tone({ freq: 1350, to: 1000, dur: 0.035, gain: 0.14, type: 'square' });
		}
	};
	SoundEngine.prototype.target = function (center) {
		if (center) {
			this.tone({ freq: 1500, to: 2100, dur: 0.1, gain: 0.18, type: 'sine' });
			this.tone({ freq: 2300, dur: 0.08, gain: 0.08, type: 'triangle', delay: 0.06 });
		} else {
			this.tone({ freq: 420, to: 260, dur: 0.07, gain: 0.1, type: 'square' });
		}
	};
	SoundEngine.prototype.cluck = function (pan) {
		this.tone({ freq: 620, to: 760, dur: 0.055, gain: 0.045, type: 'square', pan: pan || 0 });
		this.tone({ freq: 820, to: 640, dur: 0.05, gain: 0.035, type: 'triangle', pan: pan || 0, delay: 0.07 });
	};
	SoundEngine.prototype.squawk = function (pan) {
		this.burst({ dur: 0.08, type: 'bandpass', freq: 1200, q: 1.8, gain: 0.12, pan: pan || 0 });
		this.tone({ freq: 900, to: 340, dur: 0.22, gain: 0.13, type: 'sawtooth', pan: pan || 0 });
	};
	SoundEngine.prototype.hurt = function () {
		this.burst({ dur: 0.18, type: 'lowpass', freq: 500, gain: 0.3, wet: 0.18 });
		this.tone({ freq: 74, to: 48, dur: 0.2, gain: 0.24, type: 'triangle' });
	};
	SoundEngine.prototype.footstep = function (running) {
		this.burst({ dur: 0.06, type: 'bandpass', freq: running ? 420 : 330, q: 0.9, gain: running ? 0.08 : 0.04 });
	};
	SoundEngine.prototype.jump = function () {
		this.burst({ dur: 0.08, type: 'lowpass', freq: 380, gain: 0.08 });
	};
	SoundEngine.prototype.land = function (hard) {
		this.burst({ dur: 0.11, type: 'lowpass', freq: 260, gain: hard ? 0.2 : 0.1 });
		this.tone({ freq: 80, to: 55, dur: 0.12, gain: hard ? 0.18 : 0.08, type: 'triangle' });
	};
	SoundEngine.prototype.explode = function () {
		this.burst({ dur: 0.32, type: 'lowpass', freq: 500, gain: 0.5, wet: 0.25 });
		this.tone({ freq: 70, to: 28, dur: 0.35, gain: 0.38, type: 'sawtooth' });
		this.burst({ dur: 0.16, type: 'highpass', freq: 1300, gain: 0.16 });
	};
	SoundEngine.prototype.spark = function () {
		this.burst({ dur: 0.04, type: 'highpass', freq: 2200, gain: 0.05 });
	};
	SoundEngine.prototype.roundStart = function () {
		var self = this;
		[0, 0.18, 0.36].forEach(function (d, i) {
			setTimeout(function () {
				self.tone({ freq: i === 2 ? 880 : 660, dur: 0.11, gain: 0.13, type: 'triangle' });
			}, d * 1000);
		});
	};
	SoundEngine.prototype.win = function () {
		var self = this;
		[523, 659, 784, 1046].forEach(function (f, i) {
			setTimeout(function () { self.tone({ freq: f, dur: 0.24, gain: 0.1, type: 'triangle' }); }, i * 110);
		});
	};
	SoundEngine.prototype.lose = function () {
		var self = this;
		[330, 262, 196].forEach(function (f, i) {
			setTimeout(function () { self.tone({ freq: f, dur: 0.3, gain: 0.1, type: 'triangle' }); }, i * 150);
		});
	};
	SoundEngine.prototype.buy = function () {
		this.tone({ freq: 720, to: 980, dur: 0.08, gain: 0.1, type: 'triangle' });
		this.tone({ freq: 1180, dur: 0.07, gain: 0.06, type: 'sine', delay: 0.06 });
	};
	SoundEngine.prototype.scope = function () {
		this.burst({ dur: 0.035, type: 'highpass', freq: 1800, gain: 0.08 });
		this.tone({ freq: 300, to: 500, dur: 0.05, gain: 0.04, type: 'sine' });
	};
	SoundEngine.prototype.dispose = function () {
		if (this.ambience) { try { this.ambience.stop(); } catch (e) {} }
		if (this.ctx) { try { this.ctx.close(); } catch (e2) {} }
		this.ctx = null;
	};

	/* ======================================================================
	   exports
	   ====================================================================== */
	global.CSRangeContent = {
		THREE: THREE,
		clamp: clamp, lerp: lerp, damp: damp, rand: rand, randi: randi,
		choice: choice, shuffle: shuffle, angleDelta: angleDelta,
		WEAPONS: WEAPONS, BUY_ITEMS: BUY_ITEMS, BOT_TYPES: BOT_TYPES,
		DIFFICULTY: DIFFICULTY, BOT_LOADOUTS: BOT_LOADOUTS, BOT_NAMES: BOT_NAMES, BOT_SPAWNS: BOT_SPAWNS,
		PLAYER_SPAWN: PLAYER_SPAWN, PRACTICE_SPAWN: PRACTICE_SPAWN,
		PRACTICE_TARGETS: PRACTICE_TARGETS, CHICKEN_SPAWNS: CHICKEN_SPAWNS,
		makeTextures: makeTextures,
		createMap: createMap,
		buildNav: buildNav,
		findPath: findPath,
		navLineFree: navLineFree,
		cellFree: cellFree,
		toCell: toCell,
		nearestFree: nearestFree,
		buildRobot: buildRobot,
		drawHealthSprite: drawHealthSprite,
		robotName: robotName,
		buildViewWeapons: buildViewWeapons,
		buildWeaponPickup: buildWeaponPickup,
		buildPracticeTarget: buildPracticeTarget,
		buildChicken: buildChicken,
		buildPlayerBody: buildPlayerBody,
		weaponIcon: weaponIcon,
		SoundEngine: SoundEngine
	};
})(window);
