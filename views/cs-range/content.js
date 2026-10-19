/**
 * views/cs-range/content.js — DUST RANGE content layer
 *
 * Everything that can exist without knowing about the match: the weapon table,
 * the robot catalogue, procedural textures, the Dust 2 map, navmesh
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
			sound: 'knife', scope: false, icon: 'knife', armorPen: 1, killReward: 1500, teams: ['CT', 'T']
		},

		/* ---- expanded CS2 armoury (pistols, SMGs, rifles, snipers, shotguns, MGs) ---- */
		glock: {
			id: 'glock', name: 'GLOCK-18', slot: 'secondary', price: 200, buyKey: 0,
			category: 'SIDEARM', damage: 30, head: 4, rpm: 400, mag: 20, reserve: 60,
			reload: 2.2, spread: 0.0062, moveSpread: 0.02, airSpread: 0.075,
			recoil: { pitch: 0.013, yaw: 0.0045 }, auto: false, range: 110,
			sound: 'pistol', scope: false, icon: 'pistol', armorPen: 0.47,
			killReward: 300, teams: ['T']
		},
		p2000: {
			id: 'p2000', name: 'P2000', slot: 'secondary', price: 200, buyKey: 0,
			category: 'SIDEARM', damage: 35, head: 4, rpm: 352, mag: 13, reserve: 52,
			reload: 2.2, spread: 0.0058, moveSpread: 0.018, airSpread: 0.07,
			recoil: { pitch: 0.013, yaw: 0.0045 }, auto: false, range: 120,
			sound: 'pistol', scope: false, icon: 'pistol', armorPen: 0.5,
			killReward: 300, teams: ['CT']
		},
		r8: {
			id: 'r8', name: 'R8 REVOLVER', slot: 'secondary', price: 600, buyKey: 0,
			category: 'SIDEARM', damage: 86, head: 4, rpm: 120, mag: 8, reserve: 24,
			reload: 2.9, spread: 0.004, moveSpread: 0.032, airSpread: 0.12,
			recoil: { pitch: 0.04, yaw: 0.01 }, auto: false, range: 110,
			sound: 'deagle', scope: false, icon: 'pistol', armorPen: 0.932,
			killReward: 300, teams: ['CT', 'T']
		},
		fiveseven: {
			id: 'fiveseven', name: 'FIVE-SEVEN', slot: 'secondary', price: 500, buyKey: 0,
			category: 'SIDEARM', damage: 32, head: 4, rpm: 400, mag: 20, reserve: 60,
			reload: 2.3, spread: 0.0052, moveSpread: 0.017, airSpread: 0.065,
			recoil: { pitch: 0.011, yaw: 0.004 }, auto: false, range: 120,
			sound: 'pistol', scope: false, icon: 'pistol', armorPen: 0.9115,
			killReward: 300, teams: ['CT']
		},
		tec9: {
			id: 'tec9', name: 'TEC-9', slot: 'secondary', price: 500, buyKey: 0,
			category: 'SIDEARM', damage: 33, head: 4, rpm: 500, mag: 18, reserve: 54,
			reload: 2.15, spread: 0.008, moveSpread: 0.022, airSpread: 0.085,
			recoil: { pitch: 0.017, yaw: 0.006 }, auto: false, range: 110,
			sound: 'pistol', scope: false, icon: 'pistol', armorPen: 0.9,
			killReward: 300, teams: ['T']
		},
		cz75: {
			id: 'cz75', name: 'CZ75-AUTO', slot: 'secondary', price: 500, buyKey: 0,
			category: 'SIDEARM', damage: 31, head: 4, rpm: 600, mag: 12, reserve: 48,
			reload: 2.3, spread: 0.0075, moveSpread: 0.021, airSpread: 0.08,
			recoil: { pitch: 0.012, yaw: 0.005 }, auto: true, range: 110,
			sound: 'pistol', scope: false, icon: 'pistol', armorPen: 0.776,
			killReward: 300, teams: ['CT', 'T']
		},
		dualies: {
			id: 'dualies', name: 'DUAL BERETTAS', slot: 'secondary', price: 300, buyKey: 0,
			category: 'SIDEARM', damage: 38, head: 4, rpm: 480, mag: 30, reserve: 60,
			reload: 2.7, spread: 0.009, moveSpread: 0.024, airSpread: 0.09,
			recoil: { pitch: 0.014, yaw: 0.007 }, auto: false, range: 100,
			sound: 'pistol', scope: false, icon: 'pistol', armorPen: 0.575,
			killReward: 300, teams: ['CT', 'T']
		},
		mac10: {
			id: 'mac10', name: 'MAC-10', slot: 'primary', price: 1050, buyKey: 0,
			category: 'SMG', damage: 29, head: 3.6, rpm: 800, mag: 30, reserve: 90,
			reload: 2.05, spread: 0.0075, moveSpread: 0.014, airSpread: 0.075,
			recoil: { pitch: 0.012, yaw: 0.005 }, auto: true, range: 100,
			sound: 'smg', scope: false, icon: 'smg', armorPen: 0.575,
			killReward: 600, teams: ['T'], moveSpeed: 240
		},
		mp7: {
			id: 'mp7', name: 'MP7', slot: 'primary', price: 1500, buyKey: 0,
			category: 'SMG', damage: 29, head: 3.6, rpm: 800, mag: 30, reserve: 90,
			reload: 2.15, spread: 0.0062, moveSpread: 0.017, airSpread: 0.08,
			recoil: { pitch: 0.012, yaw: 0.0045 }, auto: true, range: 110,
			sound: 'smg', scope: false, icon: 'smg', armorPen: 0.625,
			killReward: 600, teams: ['CT', 'T'], moveSpeed: 220
		},
		mp5sd: {
			id: 'mp5sd', name: 'MP5-SD', slot: 'primary', price: 1500, buyKey: 0,
			category: 'SMG', damage: 27, head: 3.6, rpm: 750, mag: 30, reserve: 120,
			reload: 2.15, spread: 0.0058, moveSpread: 0.016, airSpread: 0.078,
			recoil: { pitch: 0.011, yaw: 0.004 }, auto: true, range: 115,
			sound: 'smg', scope: false, icon: 'smg', armorPen: 0.625,
			killReward: 600, teams: ['CT', 'T'], moveSpeed: 235
		},
		p90: {
			id: 'p90', name: 'P90', slot: 'primary', price: 2350, buyKey: 0,
			category: 'SMG', damage: 26, head: 3.6, rpm: 850, mag: 50, reserve: 100,
			reload: 3.3, spread: 0.0068, moveSpread: 0.018, airSpread: 0.082,
			recoil: { pitch: 0.01, yaw: 0.0045 }, auto: true, range: 110,
			sound: 'smg', scope: false, icon: 'smg', armorPen: 0.69,
			killReward: 600, teams: ['CT', 'T'], moveSpeed: 230
		},
		bizon: {
			id: 'bizon', name: 'PP-BIZON', slot: 'primary', price: 1400, buyKey: 0,
			category: 'SMG', damage: 27, head: 3.6, rpm: 750, mag: 64, reserve: 128,
			reload: 2.4, spread: 0.0082, moveSpread: 0.02, airSpread: 0.09,
			recoil: { pitch: 0.009, yaw: 0.004 }, auto: true, range: 100,
			sound: 'smg', scope: false, icon: 'smg', armorPen: 0.63,
			killReward: 600, teams: ['CT', 'T'], moveSpeed: 240
		},
		m4a1s: {
			id: 'm4a1s', name: 'M4A1-S', slot: 'primary', price: 2900, buyKey: 0,
			category: 'RIFLE', damage: 38, head: 3.475, rpm: 600, mag: 20, reserve: 80,
			reload: 3.1, spread: 0.0028, moveSpread: 0.021, airSpread: 0.105,
			recoil: { pitch: 0.013, yaw: 0.005 }, auto: true, range: 170,
			sound: 'silenced', scope: false, icon: 'rifle', armorPen: 0.7,
			killReward: 300, teams: ['CT'], moveSpeed: 225, suppressed: true
		},
		famas: {
			id: 'famas', name: 'FAMAS', slot: 'primary', price: 2050, buyKey: 0,
			category: 'RIFLE', damage: 30, head: 4, rpm: 666, mag: 25, reserve: 90,
			reload: 3.1, spread: 0.0048, moveSpread: 0.025, airSpread: 0.115,
			recoil: { pitch: 0.016, yaw: 0.006 }, auto: true, range: 150,
			sound: 'rifle2', scope: true, scopeFov: 40, icon: 'rifle', armorPen: 0.7,
			killReward: 300, teams: ['CT'], moveSpeed: 220
		},
		aug: {
			id: 'aug', name: 'AUG', slot: 'primary', price: 3300, buyKey: 0,
			category: 'RIFLE', damage: 28, head: 4, rpm: 600, mag: 30, reserve: 90,
			reload: 3.15, spread: 0.0034, moveSpread: 0.021, airSpread: 0.105,
			scopedSpread: 0.0011, recoil: { pitch: 0.014, yaw: 0.005 }, auto: true, range: 180,
			sound: 'rifle2', scope: true, scopeFov: 40, icon: 'rifle', armorPen: 0.9,
			killReward: 300, teams: ['CT'], moveSpeed: 220
		},
		scar20: {
			id: 'scar20', name: 'SCAR-20', slot: 'primary', price: 5000, buyKey: 0,
			category: 'SNIPER', damage: 80, head: 4, rpm: 240, mag: 20, reserve: 90,
			reload: 3.4, spread: 0.007, moveSpread: 0.055, airSpread: 0.15,
			scopedSpread: 0.0012, recoil: { pitch: 0.04, yaw: 0.009 }, auto: false, range: 240,
			sound: 'sniper', scope: true, scopeFov: 40, icon: 'sniper', armorPen: 0.825,
			killReward: 300, teams: ['CT'], moveSpeed: 205
		},
		g3sg1: {
			id: 'g3sg1', name: 'G3SG1', slot: 'primary', price: 5000, buyKey: 0,
			category: 'SNIPER', damage: 80, head: 4, rpm: 240, mag: 20, reserve: 90,
			reload: 3.4, spread: 0.0072, moveSpread: 0.056, airSpread: 0.15,
			scopedSpread: 0.0012, recoil: { pitch: 0.04, yaw: 0.009 }, auto: false, range: 240,
			sound: 'sniper', scope: true, scopeFov: 40, icon: 'sniper', armorPen: 0.825,
			killReward: 300, teams: ['T'], moveSpeed: 205
		},
		xm1014: {
			id: 'xm1014', name: 'XM1014', slot: 'primary', price: 2000, buyKey: 0,
			category: 'SHOTGUN', damage: 13, head: 4, rpm: 171, mag: 7, reserve: 32,
			reload: 3.4, spread: 0.017, moveSpread: 0.042, airSpread: 0.145,
			recoil: { pitch: 0.038, yaw: 0.012 }, auto: false, range: 55,
			sound: 'shotgun', scope: false, pellets: 8, icon: 'shotgun', armorPen: 0.8,
			killReward: 600, teams: ['CT', 'T']
		},
		mag7: {
			id: 'mag7', name: 'MAG-7', slot: 'primary', price: 1300, buyKey: 0,
			category: 'SHOTGUN', damage: 18, head: 4, rpm: 85, mag: 5, reserve: 32,
			reload: 3.2, spread: 0.016, moveSpread: 0.038, airSpread: 0.13,
			recoil: { pitch: 0.042, yaw: 0.011 }, auto: false, range: 52,
			sound: 'shotgun', scope: false, pellets: 8, icon: 'shotgun', armorPen: 0.75,
			killReward: 900, teams: ['CT'], moveSpeed: 225
		},
		sawedoff: {
			id: 'sawedoff', name: 'SAWED-OFF', slot: 'primary', price: 1100, buyKey: 0,
			category: 'SHOTGUN', damage: 20, head: 4, rpm: 85, mag: 7, reserve: 32,
			reload: 3.4, spread: 0.019, moveSpread: 0.044, airSpread: 0.15,
			recoil: { pitch: 0.045, yaw: 0.012 }, auto: false, range: 48,
			sound: 'shotgun', scope: false, pellets: 8, icon: 'shotgun', armorPen: 0.75,
			killReward: 900, teams: ['T'], moveSpeed: 210
		},
		m249: {
			id: 'm249', name: 'M249', slot: 'primary', price: 5200, buyKey: 0,
			category: 'MG', damage: 32, head: 4, rpm: 750, mag: 100, reserve: 200,
			reload: 5.7, spread: 0.0045, moveSpread: 0.035, airSpread: 0.16,
			recoil: { pitch: 0.02, yaw: 0.008 }, auto: true, range: 150,
			sound: 'rifle', scope: false, icon: 'mg', armorPen: 0.8,
			killReward: 300, teams: ['CT', 'T'], moveSpeed: 195
		},
		negev: {
			id: 'negev', name: 'NEGEV', slot: 'primary', price: 1700, buyKey: 0,
			category: 'MG', damage: 35, head: 4, rpm: 800, mag: 150, reserve: 300,
			reload: 5.7, spread: 0.006, moveSpread: 0.036, airSpread: 0.17,
			recoil: { pitch: 0.018, yaw: 0.009 }, auto: true, range: 140,
			sound: 'rifle', scope: false, icon: 'mg', armorPen: 0.71,
			killReward: 300, teams: ['CT', 'T'], moveSpeed: 195
		},
		zeus: {
			id: 'zeus', name: 'ZEUS X27', slot: 'equipment', price: 200, buyKey: 0,
			category: 'EQUIPMENT', damage: 500, head: 1, rpm: 60, mag: 1, reserve: 0,
			reload: 0, spread: 0.04, moveSpread: 0.04, airSpread: 0.04,
			recoil: { pitch: 0.008, yaw: 0.003 }, auto: false, range: 3.4,
			sound: 'zeus', scope: false, icon: 'zeus', armorPen: 1,
			killReward: 300, teams: ['CT', 'T'], oneShot: true
		}
	};

	/* Fill the fields the expanded catalogue does not repeat on every entry. */
	var WEAPON_TEAM_LOCK = {
		ak47: ['T'], galil: ['T'], sg553: ['T'], g3sg1: ['T'], mac10: ['T'], tec9: ['T'], glock: ['T'], sawedoff: ['T'],
		m4a4: ['CT'], m4a1s: ['CT'], famas: ['CT'], aug: ['CT'], scar20: ['CT'], mp9: ['CT'], p2000: ['CT'], fiveseven: ['CT'], mag7: ['CT']
	};
	Object.keys(WEAPONS).forEach(function (id) {
		var def = WEAPONS[id];
		if (!def.killReward) {
			def.killReward = def.category === 'SMG' ? 600
				: def.category === 'SHOTGUN' ? 900
				: def.category === 'MELEE' ? 1500
				: def.category === 'SNIPER' ? 300 : 300;
		}
		if (def.armorPen == null) def.armorPen = def.category === 'SNIPER' ? 0.9 : def.category === 'RIFLE' ? 0.775 : 0.6;
		if (!def.teams) def.teams = WEAPON_TEAM_LOCK[id] || ['CT', 'T'];
		if (def.reserve == null && def.slot !== 'melee') def.reserve = def.mag * 3;
		if (def.moveSpeed == null) def.moveSpeed = 250 - (def.category === 'SNIPER' ? 45 : def.category === 'MG' ? 55 : def.category === 'RIFLE' ? 30 : 20);
	});
	if (WEAPONS.awp) WEAPONS.awp.killReward = 100;

	var UTILITIES = {
		he: {
			id: 'he', name: 'HE GRENADE', slot: 'grenade', price: 300,
			category: 'GRENADE', max: 1, fuse: 1.6, radius: 8.2, damage: 98,
			icon: 'grenade', desc: 'Area damage with distance falloff.'
		},
		flash: {
			id: 'flash', name: 'FLASHBANG', slot: 'grenade', price: 200,
			category: 'GRENADE', max: 2, fuse: 1.5, radius: 12, damage: 0, blind: 3,
			icon: 'grenade', desc: 'Blinds anyone looking at the burst. Two can be carried.'
		},
		smoke: {
			id: 'smoke', name: 'SMOKE GRENADE', slot: 'grenade', price: 300,
			category: 'GRENADE', max: 1, fuse: 1.8, radius: 3.6, duration: 18,
			icon: 'grenade', desc: 'Deploys an 18-second sight-blocking cloud.'
		},
		molotov: {
			id: 'molotov', name: 'INCENDIARY', slot: 'grenade', price: 400, priceCT: 500,
			category: 'GRENADE', max: 1, fuse: 2.0, radius: 4.2, duration: 7, dps: 40,
			icon: 'grenade', desc: 'Burns a patch of ground for seven seconds.'
		},
		decoy: {
			id: 'decoy', name: 'DECOY GRENADE', slot: 'grenade', price: 50,
			category: 'GRENADE', max: 1, fuse: 1.5, duration: 15, radius: 2.2, damage: 5,
			icon: 'grenade', desc: 'Fake gunshots, then a small pop.'
		}
	};

	var UTIL_ORDER = ['he', 'flash', 'smoke', 'molotov', 'decoy'];


	var BUY_ITEMS = [
		/* rifles */
		{ id: 'ak47', kind: 'weapon', price: 2700, category: 'RIFLE', section: 'RIFLES', key: 1 },
		{ id: 'm4a4', kind: 'weapon', price: 3100, category: 'RIFLE', section: 'RIFLES', key: 2 },
		{ id: 'm4a1s', kind: 'weapon', price: 2900, category: 'RIFLE', section: 'RIFLES' },
		{ id: 'galil', kind: 'weapon', price: 1800, category: 'RIFLE', section: 'RIFLES', key: 3 },
		{ id: 'famas', kind: 'weapon', price: 2050, category: 'RIFLE', section: 'RIFLES' },
		{ id: 'sg553', kind: 'weapon', price: 3000, category: 'RIFLE', section: 'RIFLES', key: 4 },
		{ id: 'aug', kind: 'weapon', price: 3300, category: 'RIFLE', section: 'RIFLES' },
		/* snipers */
		{ id: 'awp', kind: 'weapon', price: 4750, category: 'SNIPER', section: 'SNIPERS', key: 5 },
		{ id: 'ssg08', kind: 'weapon', price: 1700, category: 'SNIPER', section: 'SNIPERS', key: 6 },
		{ id: 'scar20', kind: 'weapon', price: 5000, category: 'SNIPER', section: 'SNIPERS' },
		{ id: 'g3sg1', kind: 'weapon', price: 5000, category: 'SNIPER', section: 'SNIPERS' },
		/* smgs */
		{ id: 'mp9', kind: 'weapon', price: 1250, category: 'SMG', section: 'SMGS', key: 7 },
		{ id: 'mac10', kind: 'weapon', price: 1050, category: 'SMG', section: 'SMGS' },
		{ id: 'mp7', kind: 'weapon', price: 1500, category: 'SMG', section: 'SMGS' },
		{ id: 'mp5sd', kind: 'weapon', price: 1500, category: 'SMG', section: 'SMGS' },
		{ id: 'ump45', kind: 'weapon', price: 1200, category: 'SMG', section: 'SMGS', key: 8 },
		{ id: 'p90', kind: 'weapon', price: 2350, category: 'SMG', section: 'SMGS' },
		{ id: 'bizon', kind: 'weapon', price: 1400, category: 'SMG', section: 'SMGS' },
		/* shotguns */
		{ id: 'nova', kind: 'weapon', price: 1050, category: 'SHOTGUN', section: 'SHOTGUNS', key: 9 },
		{ id: 'xm1014', kind: 'weapon', price: 2000, category: 'SHOTGUN', section: 'SHOTGUNS' },
		{ id: 'mag7', kind: 'weapon', price: 1300, category: 'SHOTGUN', section: 'SHOTGUNS' },
		{ id: 'sawedoff', kind: 'weapon', price: 1100, category: 'SHOTGUN', section: 'SHOTGUNS' },
		/* machine guns */
		{ id: 'm249', kind: 'weapon', price: 5200, category: 'MG', section: 'MACHINE GUNS' },
		{ id: 'negev', kind: 'weapon', price: 1700, category: 'MG', section: 'MACHINE GUNS' },
		/* pistols */
		{ id: 'glock', kind: 'weapon', price: 200, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'p2000', kind: 'weapon', price: 200, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'usp', kind: 'weapon', price: 200, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'p250', kind: 'weapon', price: 300, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'deagle', kind: 'weapon', price: 700, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'r8', kind: 'weapon', price: 600, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'fiveseven', kind: 'weapon', price: 500, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'tec9', kind: 'weapon', price: 500, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'cz75', kind: 'weapon', price: 500, category: 'SIDEARM', section: 'PISTOLS' },
		{ id: 'dualies', kind: 'weapon', price: 300, category: 'SIDEARM', section: 'PISTOLS' },
		/* utility + equipment */
		{ id: 'he', kind: 'grenade', price: 300, category: 'GRENADE', section: 'UTILITY', util: 'he' },
		{ id: 'flash', kind: 'grenade', price: 200, category: 'GRENADE', section: 'UTILITY', util: 'flash' },
		{ id: 'smoke', kind: 'grenade', price: 300, category: 'GRENADE', section: 'UTILITY', util: 'smoke' },
		{ id: 'molotov', kind: 'grenade', price: 400, category: 'GRENADE', section: 'UTILITY', util: 'molotov' },
		{ id: 'decoy', kind: 'grenade', price: 50, category: 'GRENADE', section: 'UTILITY', util: 'decoy' },
		{ id: 'zeus', kind: 'weapon', price: 200, category: 'EQUIPMENT', section: 'EQUIPMENT' },
		{ id: 'armor', kind: 'armor', price: 1000, category: 'PROTECTION', section: 'EQUIPMENT',
			name: 'KEVLAR + HELMET', desc: 'Armour absorbs half of incoming body damage.' },
		{ id: 'kit', kind: 'kit', price: 400, category: 'PROTECTION', section: 'EQUIPMENT',
			name: 'DEFUSE KIT', desc: 'Halves the time needed to defuse the bomb.' }
	];

	var BUY_SECTION_ORDER = ['RIFLES', 'SNIPERS', 'SMGS', 'SHOTGUNS', 'MACHINE GUNS', 'PISTOLS', 'UTILITY', 'EQUIPMENT'];

	var BOMB = { plantTime: 3.2, fuse: 40, defuse: 10, defuseKit: 5, siteRadius: 8.4 };

	var TEAM_LOADOUTS = {
		CT: {
			primary: ['m4a4', 'm4a1s', 'aug', 'famas', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon', 'xm1014', 'mag7', 'nova', 'm249', 'negev', 'scar20'],
			sniper: ['awp', 'ssg08', 'scar20'],
			secondary: ['usp', 'p2000', 'p250', 'fiveseven', 'deagle', 'r8', 'cz75', 'dualies']
		},
		T: {
			primary: ['ak47', 'galil', 'sg553', 'mac10', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon', 'xm1014', 'sawedoff', 'nova', 'm249', 'negev', 'g3sg1'],
			sniper: ['awp', 'ssg08', 'g3sg1'],
			secondary: ['glock', 'p250', 'tec9', 'deagle', 'r8', 'cz75', 'dualies']
		}
	};

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
		/* The old presets were all on the easy side; these values make the top
		   tier genuinely punishing. accuracy/fire/damage/speed all scale up,
		   reaction (seconds multiplier) shrinks, sight/hearing/thinking scale
		   perception. planning controls how strongly a robot trusts its own
		   accumulated route/death memory. */
		recruit: {
			label: 'RECRUIT', accuracy: 0.85, reaction: 0.85, damage: 1.0,
			fire: 0.95, speed: 0.98, missChance: 0.18,
			sight: 0.95, think: 1.0, hearing: 7, planning: 0.4
		},
		regular: {
			label: 'REGULAR', accuracy: 1.08, reaction: 0.52, damage: 1.35,
			fire: 0.72, speed: 1.1, missChance: 0.065,
			sight: 1.15, think: 0.65, hearing: 12, planning: 0.65
		},
		veteran: {
			label: 'VETERAN', accuracy: 1.28, reaction: 0.32, damage: 1.7,
			fire: 0.54, speed: 1.2, missChance: 0.025,
			sight: 1.35, think: 0.48, hearing: 19, planning: 0.85
		},
		elite: {
			label: 'ELITE', accuracy: 1.5, reaction: 0.18, damage: 2.05,
			fire: 0.4, speed: 1.32, missChance: 0.005,
			sight: 1.6, think: 0.34, hearing: 27, planning: 1.1
		},
		ace: {
			label: 'ACE', accuracy: 1.8, reaction: 0.1, damage: 2.6,
			fire: 0.3, speed: 1.42, missChance: 0.001,
			sight: 1.85, think: 0.25, hearing: 34, planning: 1.3
		}
	};

	var BOT_NAMES = [
		'VEX', 'MUTT', 'SABLE', 'NOVA', 'BRUTE', 'HEX', 'RUST', 'ECHO', 'PYRO',
		'WIDOW', 'BOLT', 'TALON', 'CIPHER', 'GRIT', 'VANTA', 'KILO', 'SPARK',
		'ONYX', 'HAVOC', 'JACKAL', 'MAGNET', 'ORBIT', 'PIXEL', 'RIVET', 'SLAKE'
	];

	var BOT_SPAWNS = [
		{ x: -10, z: 36 }, { x: -16, z: 36 }, { x: -4, z: 36 },
		{ x: -21, z: 35 }, { x: 4, z: 36 }
	];

	var PLAYER_SPAWN = { x: 12, z: -24 };
	var PRACTICE_SPAWN = { x: 23, z: -24 };

	/* Practice boards stand across the open A site. */
	var PRACTICE_TARGETS = [
		{ x: 16.0, z: -32.0, type: 'paper', scale: 1.10, move: 0 },
		{ x: 20.0, z: -32.0, type: 'steel', scale: 1.00, move: 0 },
		{ x: 24.0, z: -32.0, type: 'paper', scale: 0.98, move: 0 },
		{ x: 28.0, z: -36.0, type: 'steel', scale: 0.94, move: 0 },
		{ x: 30.0, z: -36.0, type: 'paper', scale: 0.92, move: 0 },
		{ x: 32.0, z: -34.0, type: 'steel', scale: 0.90, move: 0 },
		{ x: 34.0, z: -22.0, type: 'paper', scale: 0.96, move: 0 },
		{ x: 24.0, z: -28.0, type: 'steel', scale: 0.96, move: 0 },
		{ x: 28.0, z: -28.0, type: 'paper', scale: 0.94, move: 0 },
		{ x: 32.0, z: -26.0, type: 'steel', scale: 0.90, move: 0 },
		{ x: 26.0, z: -22.0, type: 'paper', scale: 0.84, move: 1.5 },
		{ x: 22.0, z: -20.0, type: 'steel', scale: 0.80, move: 1.1 }
	];

	var CHICKEN_SPAWNS = [
		{ x: -10.0, z: 36.0 }, { x: -2.0, z: 24.0 }, { x: 18.0, z: 24.0 },
		{ x: 32.0, z: 2.0 }, { x: -30.0, z: 14.0 }, { x: -28.0, z: 0.0 },
		{ x: -25.0, z: -31.0 }, { x: 24.0, z: -28.0 }, { x: 12.0, z: -24.0 },
		{ x: 5.0, z: -10.0 }
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

	function makeSmokeTexture() {
		var c = makeCanvas(128, 128);
		var ctx = c.getContext('2d');
		var g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
		g.addColorStop(0, 'rgba(245,248,246,0.92)');
		g.addColorStop(0.35, 'rgba(225,231,228,0.66)');
		g.addColorStop(0.7, 'rgba(200,208,204,0.28)');
		g.addColorStop(1, 'rgba(190,198,194,0)');
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
			smoke: makeSmokeTexture(),
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
	   the map — de_dust2 bomb-defusal layout
	   ----------------------------------------------------------------------
	   The walkable footprint is traced at 1 m resolution from the real
	   de_dust2 radar (75 x 80 m), so every corridor, elbow, doorway and
	   courtyard corner matches the retail map instead of a hand-waved box.
	   Perimeter walls are generated around that footprint.
	   ====================================================================== */
	function createMap(scene, tex, renderer) {
		var BOUNDS = 40;
		var world = {
			bounds: BOUNDS,
			colliders: [],
			meshes: [],
			deco: [],
			ground: null,
			areas: [],
			callouts: [],
			sites: [],
			spawns: { ct: [], t: [] },
			routes: { A: {}, B: {}, ct: {} },
			holds: { ctA: [], ctB: [], tA: [], tB: [] },
			plantSpots: { A: [], B: [] },
			spawn: null,
			grid: null
		};

		/* ----------------------------------------------------------------
		   footprint rows, south (T spawn) at the bottom. Each string is a
		   comma-separated list of [x0,x1) 1 m runs measured from -37.5 m;
		   row 0 is z = -40 m, row 79 is z = 39..40 m.
		   ---------------------------------------------------------------- */
		var MAP_ROWS = [
			'2-5',
			'2-6,61-70',
			'2-6,61-71',
			'2-6,61-71',
			'2-6,61-71',
			'2-14,61-71',
			'2-16,60-71',
			'2-16,49-71',
			'2-16,18-21,47-71',
			'2-16,18-22,47-71',
			'2-16,18-22,47-71',
			'2-16,18-30,43-71',
			'2-16,18-30,43-71',
			'1-16,18-35,43-71',
			'1-16,18-35,42-71',
			'1-16,18-36,41-71',
			'1-75',
			'1-75',
			'1-75',
			'1-16,18-75',
			'1-16,31-43,47-51,58-75',
			'1-16,31-36,47-50,65-75',
			'1-16,30-35,47-51,65-75',
			'1-15,30-35,46-51,65-75',
			'1-14,30-35,46-51,65-75',
			'3-6,9-13,30-35,46-50,64-72',
			'3-6,9-12,31-35,46-51,64-72',
			'3-6,9-12,32-35,46-51,64-71',
			'3-6,32-35,46-51,64-71',
			'3-6,32-35,39-43,46-51,64-71',
			'3-6,19-51,65-71',
			'3-6,19-51,65-71',
			'1-10,19-51,65-71',
			'1-11,19-31,32-40,43-45,64-71',
			'1-16,18-22,32-39,64-71',
			'1-22,32-39,60-62,64-71',
			'1-22,32-39,51-71',
			'1-22,32-39,51-71',
			'1-21,31-39,51-71',
			'7-13,31-39,51-74',
			'9-12,31-39,51-75',
			'9-12,32-39,51-75',
			'9-12,32-39,51-75',
			'9-12,32-39,52-55,57-75',
			'9-12,32-39,52-55,59-75',
			'6-15,30-39,51-55,59-74',
			'6-15,30-39,51-55,59-74',
			'3-16,29-39,51-55,59-74',
			'3-16,29-39,51-55,59-74',
			'3-17,28-45,46-50,51-55,59-74',
			'3-17,28-50,51-55,59-74',
			'3-17,28-50,51-55,59-74',
			'3-18,28-50,52-55,59-71,72-74',
			'3-18,29-35,44-50,52-55,59-64,65-71',
			'3-18,32-34,44-55,65-70',
			'3-18,32-34,44-55',
			'3-18,32-34,44-55',
			'3-16,32-34,44-55',
			'3-15,32-34,44-55',
			'3-15,32-34,44-55',
			'3-15,32-34,44-55',
			'3-15,21-23,32-34,44-56',
			'3-16,20-23,32-34,44-56',
			'3-23,32-34,43-56',
			'3-23,32-34,43-56',
			'3-23,32-35,43-48,52-54',
			'3-23,32-36,43-49',
			'3-23,32-49',
			'2-23,32-48',
			'1-23,32-48',
			'0-23,25-50',
			'0-50',
			'0-50',
			'0-50',
			'0-50',
			'0-50',
			'0-50',
			'8-45',
			'35-45',
			'36-45'
		];
		var MAP_X0 = -37.5, MAP_Z0 = -40;
		var GRID = { min: -BOUNDS, size: BOUNDS * 2, cells: new Uint8Array(BOUNDS * BOUNDS * 4) };
		function gridAt(x, z) {
			var gx = Math.floor(x + BOUNDS), gz = Math.floor(z + BOUNDS);
			if (gx < 0 || gz < 0 || gx >= BOUNDS * 2 || gz >= BOUNDS * 2) return 0;
			return GRID.cells[gz * GRID.size + gx];
		}
		var AREAS = [];
		MAP_ROWS.forEach(function (row, z) {
			if (!row) return;
			var z0 = MAP_Z0 + z, z1 = z0 + 1;
			row.split(',').forEach(function (run, i) {
				var ab = run.split('-');
				var x0 = parseInt(ab[0], 10), x1 = parseInt(ab[1], 10);
				if (!(x1 > x0)) return;
				AREAS.push({
					id: 'f' + z + '_' + i, name: '',
					x0: MAP_X0 + x0, x1: MAP_X0 + x1, z0: z0, z1: z1
				});
				/* fill the collider/nav sampling grid (cell centres at -39.5..) */
				for (var gx = x0 + 3; gx < x1 + 3; gx++) {
					var cell = z * GRID.size + gx;
					if (cell >= 0 && cell < GRID.cells.length) GRID.cells[cell] = 1;
				}
			});
		});
		world.areas = AREAS;
		world.grid = GRID;
		function walkableAt(x, z) { return !!gridAt(x, z); }
		world.walkableAt = walkableAt;

		/* bomb sites — red bombsite tints on the radar put them here */
		var SITE_A = { id: 'A', x: 24.5, z: -28.5, r: 5.9 };
		var SITE_B = { id: 'B', x: -25.5, z: -31.0, r: 5.9 };
		SITE_A.plantSpots = [
			{ x: 23.5, z: -28.5, name: 'DEFAULT' },
			{ x: 26.5, z: -31.0, name: 'NINJA' },
			{ x: 20.5, z: -26.0, name: 'SHORT' },
			{ x: 28.5, z: -24.5, name: 'LONG' }
		];
		SITE_B.plantSpots = [
			{ x: -25.0, z: -31.0, name: 'DEFAULT' },
			{ x: -33.0, z: -36.0, name: 'BACK PLAT' },
			{ x: -19.5, z: -27.5, name: 'B DOORS' },
			{ x: -31.5, z: -29.0, name: 'BOX' }
		];
		world.sites = [SITE_A, SITE_B];
		world.plantSpots.A = SITE_A.plantSpots;
		world.plantSpots.B = SITE_B.plantSpots;

		/* Spawns. Bot yaw faces +z at 0; the player yaw is offset by PI. */
		world.spawns.ct = [
			{ x: 12, z: -24, yaw: Math.PI / 2 },
			{ x: 6,  z: -23, yaw: 0 },
			{ x: 18, z: -22, yaw: 0 },
			{ x: 4,  z: -23, yaw: 0 },
			{ x: 20, z: -26, yaw: 0 }
		];
		world.spawns.t = [
			{ x: -4, z: 36, yaw: Math.PI },
			{ x: -10, z: 36, yaw: Math.PI },
			{ x: -16, z: 36, yaw: Math.PI },
			{ x: -21, z: 35, yaw: Math.PI },
			{ x: 4,   z: 36, yaw: Math.PI }
		];
		world.spawn = world.spawns.ct[0];

		/* Attack routes: real lanes, sampled from the footprint's A* mesh. */
		world.routes.A = {
			main: [
				{ x: -4, z: 34 }, { x: 5, z: 35 }, { x: 10, z: 35 }, { x: 10, z: 30 },
				{ x: 13, z: 25 }, { x: 17, z: 23 }, { x: 17, z: 18 }, { x: 17, z: 13 },
				{ x: 17, z: 8 }, { x: 17, z: 3 }, { x: 21, z: 2 }, { x: 26, z: 2 },
				{ x: 26, z: 8 }, { x: 29, z: 5 }, { x: 29, z: 0 }, { x: 29, z: -6 },
				{ x: 28, z: -12 }, { x: 26, z: -19 }, { x: 24, z: -23 }, { x: 24, z: -27 }
			],
			flank: [
				{ x: -4, z: 34 }, { x: -4, z: 27 }, { x: -4, z: 21 }, { x: -4, z: 15 },
				{ x: -1, z: 12 }, { x: 1, z: 8 }, { x: 1, z: 2 }, { x: 1, z: -4 },
				{ x: 4, z: -7 }, { x: 9, z: -7 }, { x: 12, z: -10 }, { x: 12, z: -15 },
				{ x: 13, z: -19 }, { x: 18, z: -20 }, { x: 22, z: -20 }, { x: 24, z: -23 },
				{ x: 24, z: -27 }
			]
		};
		world.routes.B = {
			main: [
				{ x: -15, z: 35 }, { x: -20, z: 35 }, { x: -25, z: 35 }, { x: -28, z: 32 },
				{ x: -28, z: 27 }, { x: -28, z: 22 }, { x: -28, z: 17 }, { x: -28, z: 12 },
				{ x: -28, z: 7 }, { x: -28, z: 2 }, { x: -29, z: -1 }, { x: -32, z: -4 },
				{ x: -32, z: -9 }, { x: -32, z: -13 }, { x: -30, z: -15 }, { x: -25, z: -16 },
				{ x: -25, z: -21 }, { x: -25, z: -26 }, { x: -25, z: -30 }
			],
			flank: [
				{ x: -4, z: 34 }, { x: -5, z: 28 }, { x: -5, z: 22 }, { x: -5, z: 16 },
				{ x: -5, z: 10 }, { x: -5, z: 4 }, { x: -5, z: -2 }, { x: -5, z: -8 },
				{ x: -5, z: -13 }, { x: -6, z: -17 }, { x: -9, z: -20 }, { x: -15, z: -21 },
				{ x: -20, z: -21 }, { x: -25, z: -22 }, { x: -25, z: -27 }, { x: -25, z: -30 }
			]
		};
		world.routes.ct = {
			A: [
				{ x: 12, z: -24 }, { x: 16, z: -24 }, { x: 20, z: -24 },
				{ x: 24, z: -24 }, { x: 24, z: -27 }
			],
			B: [
				{ x: 12, z: -24 }, { x: 8, z: -24 }, { x: 4, z: -24 }, { x: 0, z: -23 },
				{ x: -4, z: -23 }, { x: -8, z: -23 }, { x: -12, z: -23 }, { x: -16, z: -23 },
				{ x: -20, z: -23 }, { x: -23, z: -24 }, { x: -25, z: -27 }
			],
			mid: [
				{ x: 12, z: -23 }, { x: 10, z: -20 }, { x: 9, z: -16 }, { x: 9, z: -11 },
				{ x: 6, z: -9 }, { x: 1, z: -9 }, { x: 1, z: -4 }, { x: 1, z: 0 },
				{ x: 2, z: 9 }
			]
		};

		/* Defensive spots; lx/lz is what the bot watches while holding. */
		world.holds.ctA = [
			{ x: 24.0, z: -28.0, lx: 24.0, lz: -22.0 },
			{ x: 29.0, z: -24.0, lx: 33.0, lz: -18.0 },
			{ x: 20.0, z: -31.0, lx: 14.0, lz: -26.0 },
			{ x: 31.0, z: -31.0, lx: 36.0, lz: -26.0 }
		];
		world.holds.ctB = [
			{ x: -25.0, z: -28.0, lx: -25.0, lz: -22.0 },
			{ x: -32.0, z: -27.0, lx: -35.0, lz: -22.0 },
			{ x: -29.0, z: -35.0, lx: -22.0, lz: -32.0 },
			{ x: -20.0, z: -25.0, lx: -18.0, lz: -20.0 }
		];
		world.holds.tA = [
			{ x: 24.0, z: -26.0, lx: 18.0, lz: -24.0 },
			{ x: 29.0, z: -25.0, lx: 35.0, lz: -20.0 },
			{ x: 27.0, z: -31.0, lx: 20.0, lz: -29.0 },
			{ x: 21.0, z: -30.0, lx: 14.0, lz: -25.0 }
		];
		world.holds.tB = [
			{ x: -25.0, z: -28.0, lx: -19.0, lz: -24.0 },
			{ x: -31.0, z: -26.0, lx: -35.0, lz: -21.0 },
			{ x: -28.0, z: -35.0, lx: -22.0, lz: -31.0 },
			{ x: -21.0, z: -31.0, lx: -15.0, lz: -28.0 }
		];

		world.callouts = [
			{ name: 'T SPAWN', x: -10, z: 36, big: true },
			{ name: 'CT SPAWN', x: 12, z: -24, big: true },
			{ name: 'A SITE', x: 24.5, z: -28.5, big: true },
			{ name: 'B SITE', x: -25.5, z: -31, big: true },
			{ name: 'MID', x: 1, z: 8 },
			{ name: 'TOP MID', x: -2, z: 25 },
			{ name: 'MID DOORS', x: 1, z: -16 },
			{ name: 'XBOX', x: 0, z: -7 },
			{ name: 'CATWALK', x: 8, z: -6 },
			{ name: 'SHORT', x: 12, z: -14 },
			{ name: 'LONG A', x: 33, z: 1 },
			{ name: 'LONG DOORS', x: 26, z: 8 },
			{ name: 'OUTSIDE LONG', x: 18, z: 24 },
			{ name: 'PIT', x: 35, z: 9 },
			{ name: 'LONG CORNER', x: 29, z: -7 },
			{ name: 'B DOORS', x: -21, z: -19 },
			{ name: 'UPPER TUNNELS', x: -30, z: -2 },
			{ name: 'OUTSIDE TUNNELS', x: -29, z: 15 },
			{ name: 'B TUNNELS', x: -27, z: 3 },
			{ name: 'A RAMP', x: 17, z: -25 },
			{ name: 'GOOSE', x: 31, z: -32 },
			{ name: 'CT MID', x: 6, z: -21 }
		];

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
			niche: new THREE.MeshStandardMaterial({ color: 0x33434e, roughness: 0.82, metalness: 0.08 }),
			barrel: new THREE.MeshStandardMaterial({ map: tex.barrel, color: 0xffffff, roughness: 0.64, metalness: 0.3 }),
			sandbag: new THREE.MeshStandardMaterial({ color: 0xa8916b, roughness: 1, metalness: 0 }),
			wood: new THREE.MeshStandardMaterial({ color: 0x7f5b36, roughness: 0.9, metalness: 0 }),
			woodDark: new THREE.MeshStandardMaterial({ color: 0x5c3f25, roughness: 0.94, metalness: 0 }),
			concrete: new THREE.MeshStandardMaterial({ color: 0x9a907d, roughness: 0.95, metalness: 0 }),
			roof: new THREE.MeshStandardMaterial({ color: 0x8c7c64, roughness: 0.98, metalness: 0 }),
			dark: new THREE.MeshStandardMaterial({ color: 0x262421, roughness: 0.9, metalness: 0.1 })
		};

		/* ---- ground ---- */
		var gTex = tex.sand.clone();
		gTex.needsUpdate = true;
		gTex.repeat.set(18, 18);
		var ground = new THREE.Mesh(
			new THREE.PlaneGeometry(96, 96, 1, 1),
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

		/* Static boxes are collected here and merged into one mesh per
		   material at the end of map construction. This keeps the detailed
		   Dust 2 geometry at ~40 draw calls instead of thousands. */
		var boxBatch = {};
		function addBox(w, h, d, x, z, mat, opts) {
			opts = opts || {};
			var collide = opts.collide !== false;
			var key = mat.uuid + (collide ? '_c' : '_d');
			var batch = boxBatch[key];
			if (!batch) {
				batch = boxBatch[key] = { mat: mat, collide: collide, items: [] };
			}
			batch.items.push({
				w: w, h: h, d: d, x: x, z: z,
				y: opts.y || 0, rotY: opts.rotY || 0, unit: opts.unit || 2
			});
			if (collide) addCollider(x, z, w, d, opts.y || 0, (opts.y || 0) + h, opts.rotY || 0);
			return null;
		}

		function mergeBoxBatches() {
			Object.keys(boxBatch).forEach(function (key) {
				var batch = boxBatch[key];
				if (!batch.items.length) return;
				var positions = [], normals = [], uvs = [], indices = [];
				var vertOffset = 0;
				for (var i = 0; i < batch.items.length; i++) {
					var it = batch.items[i];
					var geo = boxGeo(it.w, it.h, it.d, it.unit);
					var mtx = new THREE.Matrix4().makeRotationY(it.rotY || 0);
					mtx.setPosition(it.x, it.y + it.h / 2, it.z);
					geo.applyMatrix4(mtx);
					var pa = geo.attributes.position.array;
					var na = geo.attributes.normal.array;
					var ua = geo.attributes.uv.array;
					var ia = geo.index.array;
					for (var p = 0; p < pa.length; p++) positions.push(pa[p]);
					for (var n = 0; n < na.length; n++) normals.push(na[n]);
					for (var u = 0; u < ua.length; u++) uvs.push(ua[u]);
					for (var k = 0; k < ia.length; k++) indices.push(ia[k] + vertOffset);
					vertOffset += pa.length / 3;
					geo.dispose();
				}
				var merged = new THREE.BufferGeometry();
				merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
				merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
				merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
				merged.setIndex(indices);
				merged.computeBoundingSphere();
				var mesh = new THREE.Mesh(merged, batch.mat);
				mesh.castShadow = batch.collide;
				mesh.receiveShadow = true;
				scene.add(mesh);
				if (batch.collide) world.meshes.push(mesh);
				else world.deco.push(mesh);
			});
			boxBatch = {};
		}

		function addCylinder(rt, rb, h, x, z, mat, opts) {
			opts = opts || {};
			var geo = new THREE.CylinderGeometry(rt, rb, h, opts.segments || 14);
			var mesh = new THREE.Mesh(geo, mat);
			mesh.position.set(x, (opts.y || 0) + h / 2, z);
			mesh.castShadow = opts.cast !== false && opts.collide !== false;
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
			var group = new THREE.Group();
			var mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide });
			var m = new THREE.Mesh(new THREE.PlaneGeometry(size || 3, size || 3), mat);
			m.position.y = y;
			group.add(m);
			var frame = new THREE.Mesh(new THREE.BoxGeometry((size || 3) + 0.35, (size || 3) + 0.35, 0.16), mats.woodDark);
			frame.position.set(0, y, -0.1);
			group.add(frame);
			for (var s = -1; s <= 1; s += 2) {
				var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, y + 0.4, 6), mats.metal);
				pole.position.set(s * (size || 3) * 0.38, (y + 0.4) / 2 - 0.2, -0.12);
				group.add(pole);
			}
			group.position.set(x, 0, z);
			group.rotation.y = rotY;
			scene.add(group);
			world.deco.push(group);
			return group;
		}

		/* thin plywood boards: bullets pass, bodies do not */
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

		/* ----------------------------------------------------------------
		   perimeter walls. The wall box is offset *outward* so the
		   playable side of the footprint keeps its full width: this is
		   what lets the narrow 1–2 m Dust 2 elbows stay walkable.
		   ---------------------------------------------------------------- */
		function wallRunX(x0, x1, z, outward, dark) {
			var len = x1 - x0;
			if (len < 0.05) return;
			var h = (len > 14 ? 5.5 : 4.5) + ((Math.abs(Math.round(x0 * 5 + z * 7)) % 3) * 0.28);
			var cx = (x0 + x1) / 2;
			var cz = z + outward * 0.37;
			addBox(len + 0.02, h, 0.74, cx, cz, dark ? mats.brickDark : mats.brick, { unit: 2.35 });
			addBox(len + 0.06, 0.28, 1.04, cx, cz, mats.concrete, { y: h - 0.14, collide: false, unit: 2.6 });
			addBox(len, 0.55, 0.94, cx, cz, mats.brickDark, { y: 0, collide: false, unit: 2.4 });
			addBox(len, 0.12, 0.9, cx, cz, mats.concrete, { y: 2.2, collide: false, unit: 2.4 });
			if (len > 4) {
				for (var nx = x0 + 2.2; nx < x1 - 1.6; nx += 9.2) {
					addBox(1.15, 1.7, 0.05, nx, z - outward * 0.06, mats.niche, { y: 1.4, collide: false, unit: 1.4 });
					addBox(1.5, 0.1, 0.16, nx, z - outward * 0.08, mats.concrete, { y: 1.3, collide: false, unit: 1.4 });
					addBox(1.45, 0.14, 0.14, nx, z - outward * 0.08, mats.concrete, { y: 3.12, collide: false, unit: 1.4 });
					addBox(0.1, 2.35, 0.08, nx - 0.75, z - outward * 0.1, mats.wood, { y: 1.05, collide: false, unit: 1.2 });
					addBox(0.1, 2.35, 0.08, nx + 0.75, z - outward * 0.1, mats.wood, { y: 1.05, collide: false, unit: 1.2 });
				}
			}
			if (len > 7) {
				for (var px = x0 + 3.2; px < x1 - 1.6; px += 6.5) {
					addBox(0.85, h + 0.34, 1.08, px, cz, mats.brickDark, { unit: 2.4 });
					addBox(1.1, 0.2, 1.3, px, cz, mats.concrete, { y: h + 0.14, collide: false, unit: 2.4 });
				}
			}
		}
		function wallRunZ(x, z0, z1, outward, dark) {
			var len = z1 - z0;
			if (len < 0.05) return;
			var h = (len > 14 ? 5.5 : 4.5) + ((Math.abs(Math.round(z0 * 5 + x * 7)) % 3) * 0.28);
			var cz = (z0 + z1) / 2;
			var cx = x + outward * 0.37;
			addBox(0.74, h, len + 0.02, cx, cz, dark ? mats.brickDark : mats.brick, { unit: 2.35 });
			addBox(1.04, 0.28, len + 0.06, cx, cz, mats.concrete, { y: h - 0.14, collide: false, unit: 2.6 });
			addBox(0.94, 0.55, len, cx, cz, mats.brickDark, { y: 0, collide: false, unit: 2.4 });
			addBox(0.9, 0.12, len, cx, cz, mats.concrete, { y: 2.2, collide: false, unit: 2.4 });
			if (len > 4) {
				for (var nz = z0 + 2.2; nz < z1 - 1.6; nz += 9.2) {
					addBox(0.05, 1.7, 1.15, x - outward * 0.06, nz, mats.niche, { y: 1.4, collide: false, unit: 1.4 });
					addBox(0.16, 0.1, 1.5, x - outward * 0.08, nz, mats.concrete, { y: 1.3, collide: false, unit: 1.4 });
					addBox(0.14, 0.14, 1.45, x - outward * 0.08, nz, mats.concrete, { y: 3.12, collide: false, unit: 1.4 });
					addBox(0.08, 2.35, 0.1, x - outward * 0.1, nz - 0.75, mats.wood, { y: 1.05, collide: false, unit: 1.2 });
					addBox(0.08, 2.35, 0.1, x - outward * 0.1, nz + 0.75, mats.wood, { y: 1.05, collide: false, unit: 1.2 });
				}
			}
			if (len > 7) {
				for (var pz = z0 + 3.2; pz < z1 - 1.6; pz += 6.5) {
					addBox(1.08, h + 0.34, 0.85, cx, pz, mats.brickDark, { unit: 2.4 });
					addBox(1.3, 0.2, 1.1, cx, pz, mats.concrete, { y: h + 0.14, collide: false, unit: 2.4 });
				}
			}
		}

		function buildBoundaryWalls() {
			var z, x, run;
			for (z = -BOUNDS; z < BOUNDS; z++) {
				/* north face */
				run = null;
				for (x = -BOUNDS; x < BOUNDS; x++) {
					var w = walkableAt(x + 0.5, z + 0.5);
					var n = walkableAt(x + 0.5, z - 0.5);
					if (w && !n) { if (run === null) run = x; }
					else if (run !== null) { wallRunX(run, x, z, -1, (run + z) % 3 === 0); run = null; }
				}
				if (run !== null) wallRunX(run, BOUNDS, z, -1, (run + z) % 3 === 0);
				/* south face */
				run = null;
				for (x = -BOUNDS; x < BOUNDS; x++) {
					var w2 = walkableAt(x + 0.5, z + 0.5);
					var s2 = walkableAt(x + 0.5, z + 1.5);
					if (w2 && !s2) { if (run === null) run = x; }
					else if (run !== null) { wallRunX(run, x, z + 1, 1, (run + z) % 4 === 0); run = null; }
				}
				if (run !== null) wallRunX(run, BOUNDS, z + 1, 1, (run + z) % 4 === 0);
			}
			for (x = -BOUNDS; x < BOUNDS; x++) {
				/* west face */
				run = null;
				for (z = -BOUNDS; z < BOUNDS; z++) {
					var w3 = walkableAt(x + 0.5, z + 0.5);
					var ww = walkableAt(x - 0.5, z + 0.5);
					if (w3 && !ww) { if (run === null) run = z; }
					else if (run !== null) { wallRunZ(x, run, z, -1, (x + run) % 3 === 0); run = null; }
				}
				if (run !== null) wallRunZ(x, run, BOUNDS, -1, (x + BOUNDS) % 3 === 0);
				/* east face */
				run = null;
				for (z = -BOUNDS; z < BOUNDS; z++) {
					var w4 = walkableAt(x + 0.5, z + 0.5);
					var ee = walkableAt(x + 1.5, z + 0.5);
					if (w4 && !ee) { if (run === null) run = z; }
					else if (run !== null) { wallRunZ(x + 1, run, z, 1, (x + z) % 4 === 0); run = null; }
				}
				if (run !== null) wallRunZ(x + 1, run, BOUNDS, 1, (x + BOUNDS) % 4 === 0);
			}
		}
		buildBoundaryWalls();

		/* Large enclosed non-walkable blocks are building volumes, not thin
		   walls. Fill them with real solid boxes so a round that passes a thin
		   board cannot cross the whole block and emerge in the courtyard.
		   Small wall corners keep their thin collider and remain wallbangable. */
		function buildSolidBlocks() {
			world.solidBlocks = [];
			var W = BOUNDS * 2, H = BOUNDS * 2;
			var outside = new Uint8Array(W * H);
			var stack = [];
			for (var x = 0; x < W; x++) {
				for (var z = 0; z < H; z++) {
					var edge = (x === 0 || z === 0 || x === W - 1 || z === H - 1);
					if (!edge) continue;
					var ix = z * W + x;
					if (!walkableAt(x - BOUNDS + 0.5, z - BOUNDS + 0.5)) { outside[ix] = 1; stack.push(ix); }
				}
			}
			while (stack.length) {
				var ci = stack.pop();
				var cx = ci % W, cz = (ci / W) | 0;
				var nb = [ci - 1, ci + 1, ci - W, ci + W];
				for (var n = 0; n < 4; n++) {
					var ni = nb[n];
					if (ni < 0 || ni >= W * H) continue;
					var nx = ni % W, nz = (ni / W) | 0;
					if (Math.abs(nx - cx) + Math.abs(nz - cz) !== 1) continue;
					if (outside[ni]) continue;
					if (walkableAt(nx - BOUNDS + 0.5, nz - BOUNDS + 0.5)) continue;
					outside[ni] = 1; stack.push(ni);
				}
			}
			var seen = new Uint8Array(W * H);
			for (var sx = 0; sx < W; sx++) {
				for (var sz = 0; sz < H; sz++) {
					var si = sz * W + sx;
					if (seen[si] || outside[si] || walkableAt(sx - BOUNDS + 0.5, sz - BOUNDS + 0.5)) continue;
					var comp = [si], head = 0;
					seen[si] = 1;
					while (head < comp.length) {
						var pi = comp[head++];
						var px = pi % W, pz = (pi / W) | 0;
						var pnb = [pi - 1, pi + 1, pi - W, pi + W];
						for (var pn = 0; pn < 4; pn++) {
							var qi = pnb[pn];
							if (qi < 0 || qi >= W * H) continue;
							var qx = qi % W, qz = (qi / W) | 0;
							if (Math.abs(qx - px) + Math.abs(qz - pz) !== 1) continue;
							if (seen[qi] || outside[qi] || walkableAt(qx - BOUNDS + 0.5, qz - BOUNDS + 0.5)) continue;
							seen[qi] = 1; comp.push(qi);
						}
					}
					if (comp.length < 12) continue;
					var bminX = 1e9, bmaxX = -1e9, bminZ = 1e9, bmaxZ = -1e9;
					for (var bi = 0; bi < comp.length; bi++) {
						var bcx = comp[bi] % W, bcz = (comp[bi] / W) | 0;
						if (bcx < bminX) bminX = bcx; if (bcx > bmaxX) bmaxX = bcx;
						if (bcz < bminZ) bminZ = bcz; if (bcz > bmaxZ) bmaxZ = bcz;
					}
					world.solidBlocks.push({
						area: comp.length,
						x0: bminX - BOUNDS, x1: bmaxX - BOUNDS + 1,
						z0: bminZ - BOUNDS, z1: bmaxZ - BOUNDS + 1,
						cx: (bminX + bmaxX) / 2 - BOUNDS + 0.5,
						cz: (bminZ + bmaxZ) / 2 - BOUNDS + 0.5
					});
					/* one solid box per horizontal run; this preserves doors and
					   keeps the collider count low enough for ray tests */
					var rows = {};
					for (var k = 0; k < comp.length; k++) {
						var cell = comp[k];
						var cxx = cell % W, czz = (cell / W) | 0;
						if (!rows[czz]) rows[czz] = [];
						rows[czz].push(cxx);
					}
					Object.keys(rows).forEach(function (rz) {
						var xs = rows[rz].sort(function (a, b) { return a - b; });
						var run = 1;
						for (var q = 0; q <= xs.length; q++) {
							if (q < xs.length && q > 0 && xs[q] === xs[q - 1] + 1) { run++; continue; }
							if (q > 0) {
								var end = xs[q - 1], start = end - run + 1;
								var runLen = run;
								addBox(runLen, 5.2, 1.0,
									start - BOUNDS + runLen / 2,
									+rz - BOUNDS + 0.5,
									mats.brickDark, { collide: true, unit: 2.6 });
							}
							run = 1;
						}
					});
				}
			}
		}
		/* ---- door frames, arches and windows at the real chokepoints ---- */
		function addDoorFrame(x, z, width, alongX, wood) {
			var post = 0.62, h = 3.6;
			if (alongX) {
				addBox(post, h, 0.92, x - width / 2 - post / 2, z, mats.brickDark, { unit: 2 });
				addBox(post, h, 0.92, x + width / 2 + post / 2, z, mats.brickDark, { unit: 2 });
				addBox(width + post * 2, 0.58, 1.02, x, z, mats.brickDark, { y: h, unit: 2 });
				addBox(width + post * 2, 0.16, 1.14, x, z, mats.concrete, { y: h + 0.58, unit: 2, collide: false });
				if (wood) {
					addBox(0.16, 2.55, width / 2 - 0.33, x - width / 2 + 0.38, z + 0.66, mats.wood, { y: 0, rotY: 0.42, collide: false });
					addBox(0.16, 2.55, width / 2 - 0.33, x + width / 2 - 0.38, z + 0.66, mats.wood, { y: 0, rotY: -0.42, collide: false });
					addBox(0.1, 2.55, 0.1, x - width / 2 + 0.22, z + 0.98, mats.gold, { y: 0.1, collide: false });
					addBox(0.1, 2.55, 0.1, x + width / 2 - 0.22, z + 0.98, mats.gold, { y: 0.1, collide: false });
				}
			} else {
				addBox(0.92, h, post, x, z - width / 2 - post / 2, mats.brickDark, { unit: 2 });
				addBox(0.92, h, post, x, z + width / 2 + post / 2, mats.brickDark, { unit: 2 });
				addBox(1.02, 0.58, width + post * 2, x, z, mats.brickDark, { y: h, unit: 2 });
				addBox(1.14, 0.16, width + post * 2, x, z, mats.concrete, { y: h + 0.58, unit: 2, collide: false });
				if (wood) {
					addBox(width / 2 - 0.33, 2.55, 0.16, x + 0.66, z - width / 2 + 0.38, mats.wood, { y: 0, rotY: 0.42, collide: false });
					addBox(width / 2 - 0.33, 2.55, 0.16, x + 0.66, z + width / 2 - 0.38, mats.wood, { y: 0, rotY: -0.42, collide: false });
				}
			}
		}
		function addArch(x, z, width, alongX) {
			var post = 0.72, h = 4.15;
			if (alongX) {
				addBox(post, h, 0.86, x - width / 2 - post / 2, z, mats.brickDark, { unit: 2 });
				addBox(post, h, 0.86, x + width / 2 + post / 2, z, mats.brickDark, { unit: 2 });
				addBox(width + post * 2, 0.56, 0.96, x, z, mats.brickDark, { y: h, unit: 2 });
				addBox(width + post * 2, 0.2, 1.1, x, z, mats.concrete, { y: h + 0.56, collide: false, unit: 2 });
			} else {
				addBox(0.86, h, post, x, z - width / 2 - post / 2, mats.brickDark, { unit: 2 });
				addBox(0.86, h, post, x, z + width / 2 + post / 2, mats.brickDark, { unit: 2 });
				addBox(0.96, 0.56, width + post * 2, x, z, mats.brickDark, { y: h, unit: 2 });
				addBox(1.1, 0.2, width + post * 2, x, z, mats.concrete, { y: h + 0.56, collide: false, unit: 2 });
			}
		}
		function addWindow(x, z, rotY, width, height) {
			var group = new THREE.Group();
			var frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, height + 0.3, 0.22), mats.woodDark);
			group.add(frame);
			var pane = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.1), mats.dark);
			pane.position.z = 0.08;
			group.add(pane);
			var bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, height, 0.14), mats.wood);
			group.add(bar1);
			var bar2 = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, 0.14), mats.wood);
			group.add(bar2);
			group.position.set(x, height / 2 + 1.2, z);
			group.rotation.y = rotY || 0;
			scene.add(group);
			world.deco.push(group);
			return group;
		}

		/* mid doors, long doors, B doors, tunnel arches */
		addDoorFrame(1.0, -16.0, 5.6, true, true);
		addDoorFrame(26.0, 8.0, 5.2, true, true);
		addDoorFrame(-22.0, -19.0, 6.0, true, true);
		addDoorFrame(-21.0, -31.0, 3.8, false, false);
		addArch(-28.0, 16.0, 5.2, true);
		addArch(-28.0, 6.0, 4.6, true);
		addArch(-29.0, -3.0, 4.4, true);
		addArch(-2.0, 27.0, 5.2, true);
		addArch(12.0, -33.0, 4.4, true);
		/* tunnel roof ribs: the left-hand tunnels read as covered passages */
		addBox(7.0, 0.42, 1.4, -28.0, 16.0, mats.brickDark, { y: 4.25, collide: false, unit: 2.4 });
		addBox(6.4, 0.42, 1.4, -28.0, 6.0, mats.brickDark, { y: 4.25, collide: false, unit: 2.4 });
		addBox(6.2, 0.42, 1.4, -29.0, -3.0, mats.brickDark, { y: 4.25, collide: false, unit: 2.4 });
		addBox(7.0, 0.42, 1.4, -2.0, 27.0, mats.brickDark, { y: 4.25, collide: false, unit: 2.4 });
		addBox(6.0, 0.42, 1.4, 12.0, -33.0, mats.brickDark, { y: 4.25, collide: false, unit: 2.4 });
		wallLamp(-31.0, 10.0, Math.PI / 2);
		wallLamp(-30.0, -5.0, Math.PI / 2);
		pipeRun(-25.8, 12.0, 18.0, false, 3.6);

		/* ---- cover helpers ---- */
		function crate(x, z, s, stack, rot) {
			s = s || 1.7;
			stack = stack || 1;
			for (var i = 0; i < stack; i++) {
				addBox(s, s, s, x + (i ? rand(-0.18, 0.18) : 0), z + (i ? rand(-0.18, 0.18) : 0), mats.crate, {
					y: i * s, rotY: rot || 0, unit: 1.7
				});
			}
		}
		function barrel(x, z) {
			addCylinder(0.48, 0.48, 1.15, x, z, mats.barrel, { unit: 1.2 });
		}
	function container(x, z, w, h, d, mat, rot) {
			addBox(w, h, d, x, z, mat, { unit: 2.7, rotY: rot || 0 });
			var along = w >= d;
			var len = along ? w : d;
			for (var i = 0; i < Math.floor(len / 1.4); i++) {
				var off = -len / 2 + 0.7 + i * 1.4;
				addBox(along ? 0.12 : w + 0.08, h - 0.15, along ? d + 0.08 : 0.12,
					along ? x + off : x, along ? z : z + off, mats.metal,
					{ y: 0.05, collide: false, unit: 2.2, rotY: rot || 0 });
			}
		}
		function car(x, z, rot) {
			addBox(4.2, 0.85, 1.9, x, z, mats.container, { unit: 2.2, rotY: rot || 0 });
			addBox(2.3, 0.72, 1.7, x - 0.2, z, mats.containerRust, { unit: 2.2, rotY: rot || 0, y: 0.85 });
			var sx = Math.cos(rot || 0), sz = -Math.sin(rot || 0);
			[[-1.35, -0.95], [1.35, -0.95], [-1.35, 0.95], [1.35, 0.95]].forEach(function (o) {
				var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), mats.dark);
				wheel.rotation.z = Math.PI / 2;
				wheel.position.set(x + o[0] * sx + o[1] * sz, 0.44, z + o[0] * sz - o[1] * sx);
				wheel.castShadow = true;
				scene.add(wheel);
				world.deco.push(wheel);
			});
		}
		function planter(x, z) {
			addBox(1.7, 0.4, 0.9, x, z, mats.concrete, { unit: 1.6 });
			addBox(1.45, 0.18, 0.7, x, z, mats.sandbag, { y: 0.4, collide: false, unit: 1.6 });
			for (var i = 0; i < 3; i++) {
				var bush = new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 5), new THREE.MeshStandardMaterial({ color: 0x526b39, roughness: 1 }));
				bush.position.set(x + (i - 1) * 0.45, 0.72, z + rand(-0.1, 0.1));
				bush.scale.y = 0.72;
				bush.castShadow = true;
				scene.add(bush);
				world.deco.push(bush);
			}
		}
		function lampPost(x, z) {
			addCylinder(0.07, 0.09, 4.2, x, z, mats.metal, { unit: 1.2 });
			addBox(0.85, 0.12, 0.12, x + 0.4, z, mats.metal, { y: 4.0, collide: false });
			addBox(0.34, 0.24, 0.34, x + 0.8, z, mats.gold, { y: 3.78, collide: false });
		}
		function pallet(x, z, rot) {
			addBox(1.5, 0.18, 1.1, x, z, mats.wood, { unit: 1.2, rotY: rot || 0 });
			addBox(1.3, 0.5, 0.9, x, z, mats.crate, { y: 0.18, rotY: rot || 0 });
		}
		function acUnit(x, z, y) {
			addBox(1.15, 0.82, 0.95, x, z, mats.metal, { y: y || 0, unit: 1.6 });
			addBox(0.9, 0.1, 0.7, x, z, mats.dark, { y: (y || 0) + 0.84, collide: false, unit: 1.6 });
		}

		function awning(x, z, w, d, color, rot) {
			var cloth = new THREE.MeshStandardMaterial({ color: color || 0x9b6b4a, roughness: 0.92, side: THREE.DoubleSide });
			var roof = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), cloth);
			roof.position.set(x, 3.15, z);
			roof.rotation.y = rot || 0;
			roof.rotation.x = 0.1;
			roof.castShadow = true;
			scene.add(roof);
			world.deco.push(roof);
			for (var sx = -1; sx <= 1; sx += 2) {
				for (var sz = -1; sz <= 1; sz += 2) {
					var post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.1, 5), mats.metal);
					post.position.set(x + sx * (w / 2 - 0.25), 1.55, z + sz * (d / 2 - 0.2));
					post.castShadow = true;
					scene.add(post);
					world.deco.push(post);
				}
			}
		}

		function pipeRun(x, z, len, alongX, h) {
			var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, len, 6), mats.metal);
			pipe.rotation.z = alongX ? Math.PI / 2 : 0;
			if (!alongX) pipe.rotation.x = Math.PI / 2;
			pipe.position.set(x, h || 2.9, z);
			pipe.castShadow = true;
			scene.add(pipe);
			world.deco.push(pipe);
			for (var i = -1; i <= 1; i++) {
				var band = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 5, 8), mats.dark);
				band.rotation.y = alongX ? Math.PI / 2 : 0;
				if (!alongX) band.rotation.x = Math.PI / 2;
				band.position.set(alongX ? x + i * len * 0.3 : x, h || 2.9, alongX ? z : z + i * len * 0.3);
				scene.add(band);
				world.deco.push(band);
			}
		}

		function hangingCloth(x, z, w, h, color, rot) {
			var cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
				color: color || 0x8f3f30, roughness: 0.96, side: THREE.DoubleSide
			}));
			cloth.position.set(x, 2.6, z);
			cloth.rotation.y = rot || 0;
			cloth.castShadow = true;
			scene.add(cloth);
			world.deco.push(cloth);
		}

		function roofTank(x, z, y) {
			addCylinder(0.65, 0.65, 1.25, x, z, mats.metal, { y: y || 0, collide: false, unit: 1.4 });
			addBox(1.5, 0.18, 1.5, x, z, mats.dark, { y: (y || 0) + 1.25, collide: false, unit: 1.4 });
		}

		function wallLamp(x, z, rot) {
			var arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.08), mats.metal);
			arm.position.set(x, 3.1, z);
			arm.rotation.y = rot || 0;
			scene.add(arm);
			world.deco.push(arm);
			var lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), mats.gold);
			lamp.position.set(x + Math.cos(rot || 0) * 0.32, 3.0, z - Math.sin(rot || 0) * 0.32);
			scene.add(lamp);
			world.deco.push(lamp);
		}

		/* ---- buildings over the non-walkable blocks (visual skyline) ---- */
		/* A rejected skyline footprint (its corners clip a playable lane) still
		   gets a solid inner core. Only non-walkable cells are filled, so the
		   lane stays open while the building body stops bullets. */
		function solidFillRect(x, z, w, d) {
			var gx0 = Math.floor(x - w / 2 + BOUNDS);
			var gx1 = Math.floor(x + w / 2 - 0.001 + BOUNDS);
			var gz0 = Math.floor(z - d / 2 + BOUNDS);
			var gz1 = Math.floor(z + d / 2 - 0.001 + BOUNDS);
			var cells = 0;
			for (var gz = gz0; gz <= gz1; gz++) {
				var run = 0;
				for (var gx = gx0; gx <= gx1 + 1; gx++) {
					var solid = false;
					if (gx <= gx1) {
						var wx = gx - BOUNDS + 0.5, wz = gz - BOUNDS + 0.5;
						solid = !walkableAt(wx, wz);
					}
					if (solid) { run++; cells++; }
					else if (run > 0) {
						var end = gx - 1;
						addBox(run, 5.2, 1.0,
							end - run + 1 - BOUNDS + run / 2,
							gz - BOUNDS + 0.5,
							mats.brickDark, { collide: true, unit: 2.6 });
						run = 0;
					}
				}
			}
			if (cells >= 6) return true;
			return cells > 0;
		}

		function building(x, z, w, d, h, roofM) {
			var clipsLane = walkableAt(x - w / 2 + 0.6, z - d / 2 + 0.6) || walkableAt(x + w / 2 - 0.6, z - d / 2 + 0.6) ||
				walkableAt(x - w / 2 + 0.6, z + d / 2 - 0.6) || walkableAt(x + w / 2 - 0.6, z + d / 2 - 0.6) ||
				walkableAt(x, z);
			if (clipsLane) {
				solidFillRect(x, z, w, d);
				return null;
			}
			/* The skyline block is not a thin wall: make the whole volume a
			   bullet collider so rounds cannot cross the building and emerge in
			   the courtyard behind it. Thin wall corners stay penetrable. */
			addBox(w, h, d, x, z, mats.brick, { collide: true, unit: 3.8 });
			addBox(w + 0.35, 0.5, d + 0.35, x, z, mats.concrete, { y: h, collide: false, unit: 3.8 });
			addBox(w - 0.9, 0.34, d - 0.9, x, z, roofM || mats.roof, { y: h + 0.5, collide: false, unit: 3.8 });
			/* windows on the south face */
			for (var i = -1; i <= 1; i++) {
				addBox(0.82, 1.0, 0.12, x + i * (w / 3.2), z + d / 2 + 0.03, mats.dark, { y: h * 0.55, collide: false, unit: 1.6 });
				addBox(0.94, 1.12, 0.06, x + i * (w / 3.2), z + d / 2 + 0.09, mats.woodDark, { y: h * 0.55 - 0.06, collide: false, unit: 1.6 });
			}
			acUnit(x + w / 4, z - d / 4, h + 0.84);
			if (Math.abs(Math.round(x + z)) % 3 === 0) roofTank(x - w / 4, z + d / 4, h + 0.5);
			return true;
		}
		building(-15, -6, 9, 7, 7.2);
		building(-6, 0, 6, 7, 6.0);
		building(12, -1, 8, 8, 7.6);
		building(24, -15, 10, 7, 8.0);
		building(-6, -31, 9, 8, 7.0);
		building(3, 15, 9, 8, 6.4);
		building(-16, 18, 9, 8, 7.4);
		building(22, 12, 8, 7, 6.8);
		building(-34, -21, 5, 6, 5.4);
		building(33, -39, 8, 6, 6.2);
		building(-33, 41, 9, 5, 5.2);
		building(14, 41, 10, 5, 5.6);

		/* ---- thin penetrable boards: wallbang lanes ---- */
		addThinPanel(3.6, 2.3, 0.24, 30.5, -3.2);
		addThinPanel(0.24, 2.3, 3.8, -19.6, -27.0);
		addThinPanel(3.8, 2.3, 0.24, -8.0, -12.0);

		/* ---- T spawn ---- */
		crate(-20.0, 37.2, 1.7, 1, 0.1);
		crate(2.5, 37.0, 1.6, 1, -0.12);
		barrel(-22.5, 34.0);
		barrel(5.0, 34.5);
		planter(-6.0, 32.0);
		planter(8.0, 33.5);
		lampPost(-24.0, 31.0);
		lampPost(10.0, 31.0);
		addDecal(tex.spawnT, -10, 37.5, 9, Math.PI);
		awning(-18.0, 33.0, 6.5, 3.0, 0x9b6b4a, 0);
		awning(7.0, 32.5, 6.0, 2.8, 0x50606b, 0);
		wallLamp(-27.0, 31.5, 0);
		wallLamp(9.0, 34.0, Math.PI);
		pipeRun(-26.0, 30.0, 9.0, false, 3.4);
		pipeRun(8.0, 33.0, 7.0, true, 3.3);

		/* ---- T ramp / outside long ---- */
		crate(13.0, 31.0, 1.6, 1, 0.08);
		crate(17.0, 28.0, 1.5, 1);
		crate(20.0, 24.0, 1.7, 1, -0.06);
		container(23.0, 27.5, 2.6, 2.2, 2.0, mats.containerRust, 0.04);
		barrel(18.0, 19.5);
		barrel(19.1, 19.0);
		pallet(26.0, 22.0, 0.15);
		lampPost(28.0, 26.0);
		awning(20.0, 27.5, 5.5, 2.6, 0x7d5f45, 0.2);
		pipeRun(15.0, 19.0, 10.0, false, 3.5);
		wallLamp(31.0, 21.0, Math.PI);

		/* ---- vertical mid / suicide ---- */
		crate(-2.0, 24.0, 1.4, 1, 0.06);
		crate(-2.2, 18.0, 1.3, 1);
		crate(0.0, 12.0, 1.35, 1, -0.05);
		barrel(2.6, 15.0);
		crate(2.6, 5.0, 1.4, 1, 0.04);
		crate(-1.8, 1.5, 1.45, 1);
		/* xbox */
		crate(0.0, -7.0, 1.75, 1, 0.03);
		crate(0.2, -5.2, 1.2, 1, -0.1);
		crate(4.0, -16.0, 1.4, 1);
		addThinPanel(0.24, 2.2, 3.0, -2.2, 3.0);
		awning(-4.5, 12.5, 2.0, 4.2, 0x51616d, Math.PI / 2);
		wallLamp(-4.0, 20.0, -Math.PI / 2);
		pipeRun(-4.0, 6.0, 12.0, false, 3.6);

		/* ---- catwalk / short ---- */
		crate(7.0, -7.0, 1.45, 1, 0.1);
		crate(9.5, -9.0, 1.3, 1);
		crate(12.0, -15.0, 1.5, 1, -0.04);
		container(14.0, -10.0, 2.2, 2.0, 1.8, mats.containerRust, 0.02);
		barrel(10.0, -4.5);
		crate(13.0, -20.0, 1.4, 1);

		/* ---- CT spawn ---- */
		container(18.0, -27.0, 4.2, 2.3, 2.2, mats.containerRust, 0.02);
		crate(6.0, -22.0, 1.5, 1);
		crate(18.0, -22.0, 1.4, 1, 0.03);
		addDecal(tex.spawnCT, 12, -23.0, 9, 0);
		lampPost(20.0, -27.0);
		planter(4.0, -27.0);
		pipeRun(2.0, -22.0, 12.0, true, 3.6);
		wallLamp(21.0, -22.0, Math.PI);

		/* ---- A site ---- */
		crate(22.0, -30.0, 1.7, 1, 0.06);
		crate(27.0, -32.0, 1.6, 1);
		crate(29.0, -26.0, 1.5, 2, -0.05);
		barrel(31.5, -24.5);
		barrel(30.2, -24.0);
		crate(20.5, -26.5, 1.35, 1, 0.1);
		car(34.0, -18.0, 0.04);                     /* A car */
		addDecal(tex.siteA, 24.5, -28.5, 11, 0.06);
		addSign('A', 18.0, 2.9, -33.0, Math.PI / 2, 3.2);
		addSign('A', 32.0, 2.7, -25.0, -Math.PI / 2, 3.2);
		addSign('A', 24.0, 2.4, -22.4, Math.PI, 2.8);
		pallet(26.0, -24.0, 0.2);
		planter(21.0, -35.0);

		/* ---- long A / pit ---- */
		container(29.4, -4.0, 2.2, 2.4, 4.4, mats.container, 0.02);  /* blue */
		crate(33.0, 3.0, 1.55, 1, 0.06);
		crate(29.0, 5.0, 1.45, 1);
		crate(35.0, -1.5, 1.4, 2, -0.04);
		crate(28.5, 12.0, 1.35, 1);
		barrel(36.8, 11.2);
		barrel(35.9, 12.0);
		crate(24.0, 16.0, 1.55, 1);
		crate(21.0, 13.0, 1.5, 2);
		pallet(33.0, -8.0, -0.1);
		lampPost(27.0, 10.0);

		/* ---- tunnels ---- */
		crate(-30.0, 22.0, 1.55, 1);
		crate(-32.0, 18.0, 1.5, 2, 0.04);
		crate(-26.0, 12.0, 1.35, 1);
		crate(-31.0, 8.0, 1.35, 1);
		barrel(-31.6, 20.5);
		barrel(-26.0, 6.0);
		crate(-26.5, -6.0, 1.4, 1);
		crate(-32.0, -9.0, 1.45, 2);
		container(-29.0, -16.0, 3.4, 2.2, 2.2, mats.container, 0.03);  /* B car */
		crate(-18.5, -4.0, 1.4, 1);
		crate(-20.0, -11.0, 1.4, 1);
		pallet(-29.0, 24.0, 0.2);

		/* ---- B site ---- */
		crate(-24.0, -33.0, 1.7, 2, 0.04);
		crate(-28.0, -36.0, 1.6, 1);
		crate(-34.0, -32.0, 1.5, 2);
		barrel(-31.0, -33.5);
		barrel(-32.0, -32.8);
		crate(-31.5, -28.5, 1.5, 1);
		crate(-18.5, -35.0, 1.4, 1);
		crate(-19.0, -24.0, 1.3, 1);
		addDecal(tex.siteB, -25.5, -31, 11, -0.05);
		addSign('B', -18.0, 2.8, -33.0, -Math.PI / 2, 3.2);
		addSign('B', -35.0, 2.6, -27.0, Math.PI / 2, 3.2);
		addSign('B', -22.0, 2.3, -19.6, Math.PI, 2.8);
		planter(-20.0, -36.0);

		/* ---- lower mid / CT rotation ---- */
		container(-9.6, -10.4, 3.4, 2.2, 2.2, mats.container, 0.03);  /* truck */
		crate(-16.4, -8.4, 1.4, 1);
		crate(-3.4, -17.4, 1.35, 1);
		crate(-12.0, -23.0, 1.4, 1);
		container(2.0, -21.5, 2.6, 2.0, 1.9, mats.containerRust, -0.02);

		/* ---- distant city / skyline (visual only) ---- */
		var distantMat = new THREE.MeshStandardMaterial({ color: 0xb9a181, roughness: 1, metalness: 0 });
		var distantDark = new THREE.MeshStandardMaterial({ color: 0x9a8164, roughness: 1, metalness: 0 });
		for (var i = 0; i < 30; i++) {
			var ang = (i / 30) * Math.PI * 2 + rand(-0.08, 0.08);
			var dist = rand(58, 100);
			var bw = rand(4, 13), bh = rand(5, 20), bd = rand(4, 12);
			var bmesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), i % 3 ? distantMat : distantDark);
			bmesh.position.set(Math.cos(ang) * dist, bh / 2 - 1, Math.sin(ang) * dist);
			bmesh.rotation.y = ang + rand(-0.5, 0.5);
			scene.add(bmesh);
			world.deco.push(bmesh);
		}
		for (var dI = 0; dI < 4; dI++) {
			var angle = rand(0, Math.PI * 2), dist2 = rand(62, 92);
			var dome = new THREE.Mesh(new THREE.SphereGeometry(rand(3, 6), 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), distantMat);
			dome.position.set(Math.cos(angle) * dist2, rand(8, 14), Math.sin(angle) * dist2);
			scene.add(dome);
			world.deco.push(dome);
		}
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
		palm(-42, 34, 1.1);
		palm(42, -35, 1.0);
		palm(-43, -37, 0.9);
		palm(43, 36, 1.0);
		palm(-28, 43, 0.8);
		palm(31, 43, 0.85);

		/* ---- lighting ---- */
		var hemi = new THREE.HemisphereLight(0xdce7f2, 0x7d6547, 0.85);
		scene.add(hemi);
		var sun = new THREE.DirectionalLight(0xffe6c0, 2.4);
		sun.position.set(-42, 60, 30);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		sun.shadow.camera.left = -56;
		sun.shadow.camera.right = 56;
		sun.shadow.camera.top = 56;
		sun.shadow.camera.bottom = -56;
		sun.shadow.camera.near = 1;
		sun.shadow.camera.far = 200;
		sun.shadow.bias = -0.0006;
		sun.shadow.normalBias = 0.025;
		scene.add(sun);
		scene.add(sun.target);
		sun.target.position.set(0, 0, 0);
		var fill = new THREE.DirectionalLight(0x9fc0e0, 0.35);
		fill.position.set(32, 22, -38);
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

		scene.fog = new THREE.Fog(0xd8c5a4, 62, 200);
		scene.background = new THREE.Color(0xd8c5a4);

		/* ---- ambient dust motes ---- */
		var dustCount = 260;
		var dustPos = new Float32Array(dustCount * 3);
		for (var d2 = 0; d2 < dustCount; d2++) {
			dustPos[d2 * 3] = rand(-46, 46);
			dustPos[d2 * 3 + 1] = rand(0.3, 5.5);
			dustPos[d2 * 3 + 2] = rand(-46, 46);
		}
		var dustGeo = new THREE.BufferGeometry();
		dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
		var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
			color: 0xffe8c0, size: 0.028, transparent: true, opacity: 0.2,
			depthWrite: false, sizeAttenuation: true
		}));
		scene.add(dust);
		world.dust = dust;

		mergeBoxBatches();
		world.materials = mats;
		return world;
	}

	/* ======================================================================
	   the bomb
	   ====================================================================== */
	function buildBomb() {
		var root = new THREE.Group();
		var caseMat = new THREE.MeshStandardMaterial({ color: 0x3b4034, roughness: 0.62, metalness: 0.25 });
		var lidMat = new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 0.58, metalness: 0.35 });
		var wireMat = new THREE.MeshStandardMaterial({ color: 0xd2b04a, roughness: 0.4, metalness: 0.3 });
		var redMat = new THREE.MeshBasicMaterial({ color: 0xff3b22 });
		var greenMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
		var body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.42), caseMat);
		body.position.y = 0.13;
		body.castShadow = true;
		root.add(body);
		var lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.46), lidMat);
		lid.position.y = 0.27;
		lid.castShadow = true;
		root.add(lid);
		var keypad = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.012), lidMat);
		keypad.position.set(-0.12, 0.15, 0.216);
		root.add(keypad);
		var led = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), redMat);
		led.position.set(0.17, 0.2, 0.216);
		root.add(led);
		var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), lidMat);
		antenna.position.set(0.24, 0.46, -0.12);
		root.add(antenna);
		var strap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.06), wireMat);
		strap.position.set(0, 0.13, -0.24);
		root.add(strap);
		for (var i = 0; i < 3; i++) {
			var wire = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025 + i * 0.012, 0.025), i === 1 ? redMat : wireMat);
			wire.position.set(-0.19, 0.29 + i * 0.02, -0.02 + i * 0.12);
			root.add(wire);
		}
		var beacon = new THREE.Group();
		var beaconRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 24), new THREE.MeshBasicMaterial({
			color: 0xff5a3a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false
		}));
		beaconRing.rotation.x = -Math.PI / 2;
		beaconRing.position.y = 0.012;
		beacon.add(beaconRing);
		root.add(beacon);
		root.userData = { led: led, ledMat: redMat, greenMat: greenMat, beacon: beacon, beaconRing: beaconRing };
		return { group: root, led: led, ledMat: redMat, greenMat: greenMat, beacon: beacon, beaconRing: beaconRing };
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
					var nx = wx < c.minX ? c.minX : (wx > c.maxX ? c.maxX : wx);
					var nz = wz < c.minZ ? c.minZ : (wz > c.maxZ ? c.maxZ : wz);
					var ddx = wx - nx, ddz = wz - nz;
					if (ddx * ddx + ddz * ddz < radius * radius) {
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
		if (startKey === goalKey) {
			var sameCell = cellCenter(nav, goal);
			if (cellFree(nav, toCell(nav, tx, tz).x, toCell(nav, tx, tz).z)) return [{ x: tx, z: tz }];
			return [sameCell];
		}

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
		while (!open.empty() && guard++ < 20000) {
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
		if (out.length) {
			var last = out[out.length - 1];
			var tcell = toCell(nav, tx, tz);
			/* Only finish on the exact target when it is free and line-of-sight
			   from the last path cell; otherwise stop on the free cell centre. */
			if (cellFree(nav, tcell.x, tcell.z) && navLineFree(nav, last.x, last.z, tx, tz)) {
				out[out.length - 1] = { x: tx, z: tz };
			}
		}
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
		ctx.fillStyle = robot.healthColor || (robot.healthFriendly ? '#4f9edb' : '#d94a35');
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

		/* held weapon: silhouette follows the robot's actual purchase */
		var weaponDef = opts.weaponDef || null;
		var wcat = weaponDef ? weaponDef.category : 'RIFLE';
		var pocket = wcat === 'SIDEARM';
		var barrelLen = pocket ? 0.16
			: wcat === 'SNIPER' ? 0.78
			: wcat === 'SHOTGUN' ? 0.52
			: wcat === 'SMG' ? 0.33
			: wcat === 'MG' ? 0.58
			: 0.46;
		var bodyLen = pocket ? 0.2 : wcat === 'SNIPER' ? 0.46 : wcat === 'SMG' ? 0.32 : wcat === 'SHOTGUN' ? 0.38 : 0.46;
		var gun = new THREE.Group();
		gun.position.set(pocket ? 0.24 : 0.18, pocket ? 1.34 : 1.32, pocket ? 0.22 : 0.28);
		gun.rotation.x = -0.04;
		var receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, pocket ? 0.1 : 0.13, bodyLen), gunMat);
		receiver.position.z = 0.02;
		gun.add(receiver);
		var barrel = new THREE.Mesh(new THREE.CylinderGeometry(pocket ? 0.018 : 0.024, pocket ? 0.018 : 0.024, barrelLen, 8), gunMat);
		barrel.rotation.x = Math.PI / 2;
		barrel.position.z = bodyLen / 2 + barrelLen / 2 - 0.02;
		gun.add(barrel);
		var handguard = new THREE.Mesh(new THREE.BoxGeometry(0.11, pocket ? 0.08 : 0.12, pocket ? 0.12 : 0.32), plateMat);
		handguard.position.z = bodyLen / 2 + 0.08;
		gun.add(handguard);
		if (!pocket) {
			var mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, wcat === 'MG' ? 0.24 : 0.2, 0.12), jointMat);
			mag.position.set(0, -0.14, 0.02);
			gun.add(mag);
			var stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.24), gunMat);
			stock.position.z = -bodyLen / 2 - 0.09;
			gun.add(stock);
		} else {
			var pocketGrip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.08), jointMat);
			pocketGrip.position.set(0, -0.11, 0.02);
			pocketGrip.rotation.x = -0.2;
			gun.add(pocketGrip);
		}
		if (wcat === 'SHOTGUN') {
			var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, barrelLen * 0.78, 8), gunMat);
			tube.rotation.x = Math.PI / 2;
			tube.position.set(0, -0.05, bodyLen / 2 + barrelLen * 0.35);
			gun.add(tube);
		}
		if (wcat === 'MG') {
			var boxMag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.14), jointMat);
			boxMag.position.set(0, -0.17, 0.02);
			gun.add(boxMag);
		}
		if ((weaponDef && weaponDef.scope) || type.id === 'sniper') {
			var scope = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 10), gunMat);
			scope.rotation.x = Math.PI / 2;
			scope.position.set(0, 0.12, 0.02);
			gun.add(scope);
			var lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 10), accentMat);
			lens.position.set(0, 0.12, 0.165);
			lens.rotation.y = Math.PI;
			gun.add(lens);
		} else if (wcat === 'SMG' || wcat === 'MG') {
			var dot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.07), gunMat);
			dot.position.set(0, 0.115, 0.0);
			gun.add(dot);
			var dotLens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 8), accentMat);
			dotLens.position.set(0, 0.115, -0.038);
			dotLens.rotation.y = Math.PI;
			gun.add(dotLens);
		}
		var muzzle = new THREE.Object3D();
		muzzle.position.z = bodyLen / 2 + barrelLen + 0.02;
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
		/* A small procedural gun-foundry: shared materials, rails, sights,
		   trigger guards and hands. Every weapon gets a silhouette built from
		   the same vocabulary so the armoury reads as one coherent set. */
		var metal = new THREE.MeshStandardMaterial({ color: 0x7c848b, roughness: 0.4, metalness: 0.65 });
		var steel = new THREE.MeshStandardMaterial({ color: 0x3b4248, roughness: 0.36, metalness: 0.72 });
		var metalDark = new THREE.MeshStandardMaterial({ color: 0x252a2e, roughness: 0.46, metalness: 0.56 });
		var polymer = new THREE.MeshStandardMaterial({ color: 0x30353a, roughness: 0.74, metalness: 0.06 });
		var polymerTan = new THREE.MeshStandardMaterial({ color: 0x9a835b, roughness: 0.76, metalness: 0.05 });
		var polymerGreen = new THREE.MeshStandardMaterial({ color: 0x4d5847, roughness: 0.72, metalness: 0.06 });
		var wood = new THREE.MeshStandardMaterial({ color: 0x8a5427, roughness: 0.6, metalness: 0.03 });
		var woodDark = new THREE.MeshStandardMaterial({ color: 0x5e381b, roughness: 0.68, metalness: 0.02 });
		var green = new THREE.MeshStandardMaterial({ color: 0x5a624f, roughness: 0.68, metalness: 0.08 });
		var silver = new THREE.MeshStandardMaterial({ color: 0xb9bec3, roughness: 0.26, metalness: 0.82 });
		var glove = new THREE.MeshStandardMaterial({ color: 0x3a342b, roughness: 0.9, metalness: 0.02 });
		var sleeve = new THREE.MeshStandardMaterial({ color: 0x6d6c54, roughness: 0.95 });
		var sleeveTan = new THREE.MeshStandardMaterial({ color: 0x857858, roughness: 0.95 });
		var lens = new THREE.MeshBasicMaterial({ color: 0x8fd8f2 });
		var lensDark = new THREE.MeshStandardMaterial({ color: 0x0c161b, roughness: 0.08, metalness: 0.9 });
		var brass = new THREE.MeshStandardMaterial({ color: 0xc9a45a, roughness: 0.32, metalness: 0.75 });
		var accentBlue = new THREE.MeshBasicMaterial({ color: 0x6ec8ff });
		var accentRed = new THREE.MeshBasicMaterial({ color: 0xff6047 });

		function box(mat, w, h, d, x, y, z) {
			var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
			m.position.set(x || 0, y || 0, z || 0);
			return m;
		}
		function add(g, mesh) { g.add(mesh); return mesh; }
		function cylZ(mat, r, len, x, y, z, seg) {
			var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 12), mat);
			m.rotation.x = Math.PI / 2;
			m.position.set(x || 0, y || 0, z || 0);
			return m;
		}
		function cylY(mat, r, len, x, y, z, seg) {
			var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 10), mat);
			m.position.set(x || 0, y || 0, z || 0);
			return m;
		}
		function hand(mat, x, y, z, sx, sy, sz, rz) {
			var g = new THREE.Group();
			sx *= 0.8; sy *= 0.8; sz *= 0.8;
			g.position.set(x, y, z);
			if (rz) g.rotation.z = rz;
			var palm = box(mat, sx, sy, sz);
			g.add(palm);
			for (var f = 0; f < 3; f++) {
				var finger = box(mat, sx * 0.22, sy * 0.62, sz * 0.94);
				finger.position.set((f - 1) * sx * 0.27, sy * 0.3, -sz * 0.42);
				g.add(finger);
			}
			return g;
		}
		function addSleeve(g, mat, x, y, z, rx) {
			var s = box(mat, 0.082, 0.082, 0.25);
			s.position.set(x, y, z);
			s.rotation.x = rx || 0;
			g.add(s);
			var cuff = box(mat, 0.09, 0.09, 0.03);
			cuff.position.set(x, y, z + 0.14);
			cuff.rotation.x = rx || 0;
			g.add(cuff);
		}
		function rail(g, mat, len, y, z, teeth) {
			add(g, box(mat, 0.052, 0.016, len, 0, y, z));
			var n = teeth || Math.max(3, Math.round(len / 0.035));
			for (var i = 0; i < n; i++) {
				add(g, box(mat, 0.058, 0.012, 0.014, 0, y + 0.013, z - len / 2 + 0.02 + i * (len - 0.04) / Math.max(1, n - 1)));
			}
		}
		function sights(g, frontZ, rearZ, y, mat) {
			mat = mat || metalDark;
			add(g, box(mat, 0.012, 0.025, 0.014, 0, y + 0.018, frontZ));
			add(g, box(mat, 0.016, 0.03, 0.016, 0, y + 0.018, frontZ - 0.004));
			var rear = box(mat, 0.045, 0.022, 0.016, 0, y + 0.017, rearZ);
			add(g, rear);
			add(g, box(mat, 0.012, 0.014, 0.02, -0.017, y + 0.02, rearZ));
			add(g, box(mat, 0.012, 0.014, 0.02, 0.017, y + 0.02, rearZ));
		}
		function guard(g, mat, y, z, width) {
			width = width || 0.07;
			add(g, box(mat, width, 0.012, 0.15, 0, y - 0.065, z));
			add(g, box(mat, 0.012, 0.07, 0.014, -width / 2, y - 0.03, z + 0.065));
			add(g, box(mat, 0.012, 0.07, 0.014, width / 2, y - 0.03, z + 0.065));
			add(g, box(mat, 0.012, 0.09, 0.014, -width / 2, y - 0.025, z - 0.065));
			add(g, box(mat, 0.012, 0.09, 0.014, width / 2, y - 0.025, z - 0.065));
			add(g, box(mat, 0.014, 0.012, 0.05, 0, y - 0.02, z - 0.01));
		}
		function grip(g, mat, x, y, z, rot) {
			var gr = box(mat, 0.062, 0.17, 0.105, x, y, z);
			gr.rotation.x = rot || -0.22;
			add(g, gr);
			for (var i = 0; i < 3; i++) {
				var ridge = box(mat, 0.066, 0.012, 0.09, x, y - 0.045 + i * 0.035, z + 0.015);
				ridge.rotation.x = gr.rotation.x;
				add(g, ridge);
			}
			add(g, hand(glove, x, y - 0.06, z, 0.1, 0.09, 0.14, 0.04));
			addSleeve(g, sleeve, x + 0.012, y - 0.18, z + 0.18, -0.4);
			return gr;
		}
		function magStraight(g, mat, x, y, z, h, w, d, rot) {
			var m = box(mat, w || 0.062, h || 0.2, d || 0.1, x || 0, y || -0.15, z || -0.04);
			m.rotation.x = rot || 0.05;
			add(g, m);
			var floor = box(metalDark, (w || 0.062) + 0.008, 0.018, (d || 0.1) + 0.008, x || 0, (y || -0.15) - (h || 0.2) / 2 + 0.006, z || -0.04);
			floor.rotation.x = m.rotation.x;
			add(g, floor);
			return m;
		}
		function magCurved(g, mat, x, y, z, n, h, w, d, stepX) {
			var parts = [];
			for (var i = 0; i < n; i++) {
				var seg = box(mat, w, h, d, x, y - i * h * 0.74, z + i * (stepX == null ? 0.022 : stepX));
				seg.rotation.x = 0.12 + i * 0.07;
				add(g, seg);
				parts.push(seg);
			}
			return parts;
		}
		function scope(g, y, z, len, radius, baseMat) {
			var tube = cylZ(baseMat || metalDark, radius || 0.045, len || 0.32, 0, y, z, 14);
			add(g, tube);
			add(g, cylZ(metal, (radius || 0.045) + 0.014, 0.04, 0, y, z + (len || 0.32) / 2 - 0.02, 14));
			add(g, cylZ(metal, (radius || 0.045) + 0.02, 0.045, 0, y, z - (len || 0.32) / 2 + 0.02, 14));
			add(g, cylZ(lensDark, radius || 0.045, 0.012, 0, y, z - (len || 0.32) / 2 - 0.001, 14));
			add(g, cylZ(metalDark, 0.026, 0.05, 0, y + (radius || 0.045) + 0.022, z + 0.03, 10));
			add(g, cylZ(metalDark, 0.024, 0.04, 0.05, y, z - 0.02, 10));
			add(g, box(metalDark, 0.05, 0.03, 0.06, 0, y - (radius || 0.045) - 0.012, z + (len || 0.32) * 0.28));
			add(g, box(metalDark, 0.05, 0.03, 0.06, 0, y - (radius || 0.045) - 0.012, z - (len || 0.32) * 0.28));
			return tube;
		}
		function redDot(g, y, z) {
			add(g, box(metalDark, 0.05, 0.03, 0.08, 0, y, z));
			add(g, cylZ(metal, 0.026, 0.07, 0, y + 0.03, z, 12));
			add(g, cylZ(lensDark, 0.021, 0.008, 0, y + 0.03, z - 0.036, 12));
			add(g, box(accentRed, 0.006, 0.006, 0.004, 0, y + 0.03, z - 0.041));
		}
		function muzzleDevice(g, mat, z, r, len) {
			add(g, cylZ(mat || metalDark, (r || 0.018) + 0.006, 0.055, 0, 0.045, z, 10));
			add(g, cylZ(mat || metalDark, r || 0.018, len || 0.09, 0, 0.045, z - 0.04, 10));
			for (var i = 0; i < 3; i++) add(g, box(mat || metalDark, (r || 0.018) * 2.2, 0.012, 0.014, 0, 0.058, z - 0.01 - i * 0.018));
		}
		function stockFixed(g, mat, z, y) {
			add(g, box(mat, 0.075, 0.1, 0.22, 0, y || -0.035, z, 0));
			add(g, box(mat, 0.085, 0.13, 0.045, 0, (y || -0.035) - 0.01, z + 0.115));
			add(g, box(mat, 0.085, 0.035, 0.16, 0, (y || -0.035) + 0.06, z - 0.01));
		}
		function boltHandle(g, x, y, z) {
			add(g, cylZ(metal, 0.014, 0.11, x, y, z, 8));
			add(g, box(metal, 0.02, 0.02, 0.08, x + 0.05, y, z + 0.01));
			add(g, cylY(metalDark, 0.02, 0.035, x + 0.085, y, z + 0.02, 8));
		}
		function finish(group, muzzleZ, extra) {
			var muzzle = new THREE.Object3D();
			muzzle.position.set(0, 0, muzzleZ);
			group.add(muzzle);
			group.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
			return Object.assign({ group: group, muzzle: muzzle }, extra || {});
		}

		/* ---------------------------------------------------------- pistols */
		function makePistol(o) {
			o = o || {};
			var g = new THREE.Group();
			var frameMat = o.frameMat || polymer;
			var slideMat = o.slideMat || metalDark;
			var len = o.len || 0.3, muzzleZ = o.muzzle || -0.52;
			/* frame + beavertail + dust cover */
			add(g, box(frameMat, 0.072, 0.072, len, 0, 0, -len * 0.5 + 0.02));
			add(g, box(frameMat, 0.06, 0.04, 0.09, 0, 0.039, 0.02));
			add(g, box(frameMat, 0.064, 0.026, 0.08, 0, -0.046, -0.19));
			/* slide */
			var slide = box(slideMat, 0.078, 0.08, len + 0.02, 0, 0.058, -len * 0.5);
			add(g, slide);
			add(g, box(slideMat, 0.084, 0.028, 0.075, 0, 0.065, 0.02));
			for (var i = 0; i < 5; i++) {
				add(g, box(metal, 0.006, 0.04, 0.012, -0.038, 0.058, 0.01 + i * 0.016));
				add(g, box(metal, 0.006, 0.04, 0.012, 0.038, 0.058, 0.01 + i * 0.016));
			}
			add(g, box(lensDark, 0.05, 0.012, 0.012, 0, 0.021, -len - 0.005));
			/* barrel + recoil spring */
			add(g, cylZ(o.barrelMat || metalDark, 0.021, 0.11, 0, 0.045, -len - 0.02, 12));
			if (o.suppressor) add(g, cylZ(metalDark, 0.032, 0.14, 0, 0.045, -len - 0.11, 14));
			/* sights */
			add(g, box(metalDark, 0.012, 0.022, 0.015, 0, 0.108, -len + 0.028));
			add(g, box(metalDark, 0.045, 0.018, 0.016, 0, 0.108, 0.005));
			add(g, box(metalDark, 0.012, 0.012, 0.02, -0.019, 0.112, 0.005));
			add(g, box(metalDark, 0.012, 0.012, 0.02, 0.019, 0.112, 0.005));
			/* trigger guard + trigger */
			guard(g, frameMat, 0.005, -0.01, 0.065);
			/* grip */
			grip(g, o.gripMat || frameMat, 0, -0.115, 0.055, -0.2);
			/* magazine base */
			var mag = box(o.magMat || metalDark, 0.058, 0.09, 0.1, 0, -0.19, 0.06);
			mag.rotation.x = -0.2;
			add(g, mag);
			/* hammer / striker */
			add(g, box(metal, 0.022, 0.05, 0.025, 0, 0.088, 0.045));
			if (o.revolver) {
				add(g, cylZ(silver, 0.045, 0.095, 0, 0.045, -0.09, 12));
				for (var c = 0; c < 6; c++) {
					var ang = c / 6 * Math.PI * 2;
					add(g, cylZ(metalDark, 0.009, 0.098, Math.cos(ang) * 0.028, Math.sin(ang) * 0.028 + 0.045, -0.09, 8));
				}
				add(g, box(metal, 0.02, 0.04, 0.07, 0, 0.085, 0.015));
			}
			if (o.dual) {
				var second = g.clone();
				second.position.x = -0.16;
				second.rotation.y = 0.08;
				g.add(second);
				add(g, hand(glove, -0.19, -0.12, 0.08, 0.1, 0.09, 0.14, -0.25));
				addSleeve(g, sleeve, -0.2, -0.23, 0.27, -0.4);
			}
			g.position.set(o.px || 0.19, o.py || -0.17, o.pz || -0.42);
			g.rotation.set(o.rx || 0.03, o.ry || -0.04, o.rz || 0);
			return finish(g, muzzleZ, { mag: [mag] });
		}

		/* -------------------------------------------------------------- SMGs */
		function makeSMG(o) {
			o = o || {};
			var g = new THREE.Group();
			var body = o.bodyMat || metalDark;
			var len = o.len || 0.34;
			add(g, box(body, 0.082, 0.1, len, 0, 0, -0.14));
			add(g, box(o.upperMat || steel, 0.07, 0.045, len * 0.85, 0, 0.068, -0.15));
			rail(g, metalDark, len * 0.8, 0.098, -0.16, 7);
			add(g, box(metal, 0.03, 0.04, 0.12, 0, 0.02, -0.03));
			add(g, cylZ(metal, 0.014, 0.2, 0, 0.03, -len - 0.06, 10));
			muzzleDevice(g, metalDark, -len - 0.14, 0.013, 0.06);
			if (o.suppressor) add(g, cylZ(metalDark, 0.04, 0.2, 0, 0.045, -len - 0.14, 14));
			add(g, box(o.handguardMat || polymer, 0.075, 0.07, o.handguard || 0.18, 0, -0.005, -len * 0.72));
			for (var v = 0; v < 3; v++) add(g, box(metalDark, 0.08, 0.014, 0.018, 0, 0.005, -len * 0.72 - 0.045 + v * 0.045));
			/* magazine */
			var mags;
			if (o.magType === 'drum') {
				mags = [add(g, cylZ(metalDark, 0.09, 0.08, 0, -0.14, -0.02, 16))];
			} else if (o.magType === 'top') {
				mags = [add(g, box(metalDark, 0.07, 0.035, 0.22, 0, 0.105, -0.08))];
			} else {
				mags = [magStraight(g, o.magMat || metalDark, 0, -0.14, -0.04, o.magH || 0.2, 0.058, 0.1, 0.06)];
			}
			/* grip */
			grip(g, o.gripMat || polymer, 0, -0.12, 0.1, -0.24);
			/* stock */
			if (o.stock === 'folding') {
				add(g, box(metal, 0.02, 0.075, 0.22, 0.035, -0.01, 0.2));
				add(g, box(metal, 0.02, 0.075, 0.22, -0.035, -0.01, 0.2));
				add(g, box(o.stockMat || polymer, 0.08, 0.1, 0.04, 0, -0.01, 0.32));
			} else if (o.stock === 'skeleton') {
				add(g, box(metal, 0.02, 0.02, 0.24, -0.045, 0.05, 0.2));
				add(g, box(metal, 0.02, 0.02, 0.24, 0.045, 0.05, 0.2));
				add(g, box(metal, 0.02, 0.02, 0.24, -0.045, -0.06, 0.2));
				add(g, box(metal, 0.02, 0.02, 0.24, 0.045, -0.06, 0.2));
				add(g, box(o.stockMat || polymer, 0.09, 0.15, 0.035, 0, -0.005, 0.33));
			} else if (o.stock !== 'none') {
				stockFixed(g, o.stockMat || polymer, 0.27, -0.02);
			}
			/* optic */
			if (o.optic === 'scope') scope(g, 0.14, -0.08, 0.2, 0.036);
			else if (o.optic === 'reddot') redDot(g, 0.1, -0.12);
			else sights(g, -len - 0.02, 0.03, 0.1);
			/* charging handle / ejection port */
			add(g, box(metal, 0.02, 0.015, 0.05, 0.05, 0.075, 0.02));
			add(g, box(lensDark, 0.008, 0.03, 0.07, 0.041, 0.035, -0.16));
			/* support hand */
			add(g, hand(glove, -0.03, -0.09, -len * 0.64, 0.1, 0.085, 0.14, 0.12));
			addSleeve(g, sleeveTan, -0.02, -0.16, -len * 0.44, -0.15);
			g.position.set(o.px || 0.2, o.py || -0.18, o.pz || -0.4);
			g.rotation.set(o.rx || 0.02, o.ry || -0.03, o.rz || 0);
			return finish(g, o.muzzleZ || (-len - 0.2), { mag: mags });
		}

		/* ------------------------------------------------------------- rifles */
		function makeRifle(o) {
			o = o || {};
			var g = new THREE.Group();
			var body = o.bodyMat || metalDark;
			var len = o.len || 0.44;
			/* receiver, upper, dust cover */
			add(g, box(body, 0.078, 0.11, len, 0, 0, -0.18));
			add(g, box(o.upperMat || steel, 0.068, 0.04, len * 0.9, 0, 0.073, -0.18));
			add(g, box(metal, 0.082, 0.012, len * 0.85, 0, -0.058, -0.18));
			rail(g, metalDark, len * 0.92, 0.096, -0.2, 9);
			/* handguard with vents */
			var hgLen = o.handguard || 0.3;
			add(g, box(o.wood ? wood : (o.handguardMat || polymer), 0.083, 0.09, hgLen, 0, 0.005, -len - hgLen * 0.35));
			for (var v = 0; v < 4; v++) {
				add(g, box(metalDark, 0.087, 0.014, 0.024, 0, 0.008, -len - 0.06 - v * 0.055));
			}
			add(g, box(metalDark, 0.088, 0.026, hgLen * 0.8, 0, 0.045, -len - hgLen * 0.35));
			/* barrel + gas block + brake */
			var barrelLen = o.barrel || 0.4;
			add(g, cylZ(steel, o.barrelR || 0.014, barrelLen, 0, 0.038, -len - barrelLen * 0.35, 12));
			add(g, box(metalDark, 0.045, 0.055, 0.07, 0, 0.05, -len - barrelLen * 0.2));
			add(g, box(metalDark, 0.018, 0.06, 0.02, 0, 0.095, -len - barrelLen * 0.2));
			if (o.suppressor) add(g, cylZ(metalDark, 0.032, 0.22, 0, 0.038, -len - barrelLen * 0.78, 14));
			else muzzleDevice(g, metalDark, -len - barrelLen * 0.78, o.barrelR || 0.014, 0.08);
			/* magazine */
			var mags;
			if (o.magType === 'drum') {
				mags = [add(g, cylZ(metalDark, 0.11, 0.09, 0, -0.15, -0.02, 16))];
			} else if (o.magType === 'box') {
				mags = [magStraight(g, metalDark, 0, -0.16, -0.04, 0.22, 0.07, 0.12, 0.03)];
			} else {
				mags = magCurved(g, o.magMat || metalDark, 0, -0.15, -0.05, o.magSegs || 3, o.magH || 0.12, 0.062, 0.1, o.magStep == null ? 0.024 : o.magStep);
			}
			/* grip + trigger */
			grip(g, o.gripMat || polymer, 0, -0.12, 0.1, -0.22);
			guard(g, metal, 0.0, -0.02, 0.07);
			/* stock */
			if (o.stock === 'skeleton') {
				add(g, box(metal, 0.02, 0.025, 0.24, -0.045, 0.045, 0.2));
				add(g, box(metal, 0.02, 0.025, 0.24, 0.045, 0.045, 0.2));
				add(g, box(metal, 0.02, 0.025, 0.24, -0.045, -0.06, 0.2));
				add(g, box(metal, 0.02, 0.025, 0.24, 0.045, -0.06, 0.2));
				add(g, box(polymer, 0.09, 0.16, 0.035, 0, -0.01, 0.32));
			} else if (o.stock === 'wood') {
				add(g, box(wood, 0.085, 0.12, 0.25, 0, -0.035, 0.25));
				add(g, box(woodDark, 0.075, 0.07, 0.17, 0, -0.09, 0.23));
				add(g, box(wood, 0.11, 0.055, 0.07, 0, -0.03, 0.37));
			} else if (o.stock === 'folding') {
				add(g, box(metal, 0.02, 0.08, 0.2, 0.04, -0.01, 0.18));
				add(g, box(metal, 0.02, 0.08, 0.2, -0.04, -0.01, 0.18));
				add(g, box(polymer, 0.08, 0.12, 0.035, 0, -0.01, 0.28));
			} else {
				add(g, box(o.stockMat || polymer, 0.075, 0.11, 0.23, 0, -0.025, 0.24));
				add(g, box(o.stockMat || polymer, 0.085, 0.14, 0.035, 0, -0.02, 0.36));
				add(g, box(o.stockMat || polymer, 0.085, 0.04, 0.18, 0, 0.06, 0.24));
			}
			/* optic */
			if (o.optic === 'scope') scope(g, 0.14, -0.16, o.scopeLen || 0.3, 0.045);
			else if (o.optic === 'reddot') redDot(g, 0.1, -0.18);
			else if (o.optic !== 'none') sights(g, -len - barrelLen * 0.7, 0.06, 0.1);
			/* bolt / charging handle + ejection port */
			if (o.bolt) boltHandle(g, 0.05, 0.04, -0.08);
			else add(g, box(metal, 0.02, 0.016, 0.06, 0.05, 0.073, 0.03));
			add(g, box(lensDark, 0.01, 0.032, 0.09, 0.041, 0.028, -0.22));
			/* support hand */
			add(g, hand(glove, -0.035, -0.08, -len - hgLen * 0.32, 0.1, 0.085, 0.14, 0.12));
			addSleeve(g, o.tan ? sleeveTan : sleeve, -0.025, -0.15, -len - hgLen * 0.12, -0.15);
			g.position.set(o.px || 0.2, o.py || -0.18, o.pz || -0.4);
			g.rotation.set(o.rx || 0.02, o.ry || -0.03, o.rz || 0);
			return finish(g, o.muzzleZ || (-len - barrelLen * 0.9), { mag: mags });
		}

		/* ------------------------------------------------------------ snipers */
		function makeSniper(o) {
			o = o || {};
			var g = new THREE.Group();
			var body = o.bodyMat || green;
			var len = o.len || 0.52;
			add(g, box(body, 0.085, 0.11, len, 0, -0.005, -0.17));
			add(g, box(o.upperMat || metalDark, 0.07, 0.05, len * 0.9, 0, 0.08, -0.18));
			add(g, box(body, 0.07, 0.08, 0.23, 0, 0.005, 0.24));
			add(g, box(body, 0.1, 0.14, 0.14, 0, -0.05, 0.31));
			add(g, box(body, 0.09, 0.045, 0.17, 0, 0.11, 0.2));
			add(g, box(metalDark, 0.06, 0.07, 0.13, 0, -0.055, 0.2));
			/* barrel */
			var bl = o.barrel || 0.6;
			add(g, cylZ(steel, 0.017, bl, 0, 0.035, -len - bl * 0.3, 12));
			add(g, cylZ(metalDark, 0.024, 0.08, 0, 0.035, -len - bl * 0.72, 12));
			add(g, cylZ(metalDark, 0.02, 0.06, 0, 0.035, -len - bl * 0.78, 12));
			/* scope */
			scope(g, 0.17, -0.18, o.scopeLen || 0.36, 0.048);
			/* bolt */
			boltHandle(g, 0.085, 0.04, -0.06);
			/* magazine */
			var mag = magStraight(g, metalDark, 0, -0.19, -0.06, 0.13, 0.065, 0.11, 0.03);
			/* grip */
			grip(g, o.gripMat || body, 0, -0.12, 0.1, -0.22);
			/* bipod */
			if (o.bipod) {
				add(g, box(metal, 0.015, 0.13, 0.015, -0.06, -0.08, -len - bl * 0.5));
				add(g, box(metal, 0.015, 0.13, 0.015, 0.06, -0.08, -len - bl * 0.5));
				add(g, box(metal, 0.15, 0.012, 0.02, 0, -0.14, -len - bl * 0.5));
			}
			/* hands */
			add(g, hand(glove, -0.04, -0.08, -len - bl * 0.28, 0.1, 0.085, 0.14, 0.12));
			addSleeve(g, sleeveTan, -0.03, -0.15, -len - bl * 0.08, -0.15);
			g.position.set(o.px || 0.2, o.py || -0.18, o.pz || -0.4);
			g.rotation.set(o.rx || 0.02, o.ry || -0.03, o.rz || 0);
			return finish(g, o.muzzleZ || (-len - bl * 0.82), { mag: [mag] });
		}

		/* ----------------------------------------------------------- shotguns */
		function makeShotgun(o) {
			o = o || {};
			var g = new THREE.Group();
			var body = o.bodyMat || metalDark;
			var len = o.len || 0.4;
			add(g, box(body, 0.085, 0.105, len, 0, 0, -0.16));
			add(g, box(o.wood ? wood : (o.handguardMat || polymer), 0.09, 0.1, 0.26, 0, 0.005, -0.38));
			var barrel = o.barrel || 0.44;
			add(g, cylZ(steel, o.barrelR || 0.026, barrel, 0, 0.035, -0.16 - barrel * 0.55, 12));
			add(g, cylZ(metalDark, 0.03, 0.06, 0, 0.035, -0.16 - barrel * 0.83, 12));
			/* tube magazine */
			add(g, cylZ(metalDark, 0.02, barrel * 0.8, 0, -0.015, -0.16 - barrel * 0.48, 10));
			/* pump with ribs */
			if (o.pump !== false) {
				var pump = box(o.pumpMat || woodDark, 0.095, 0.095, 0.19, 0, -0.025, -0.16 - barrel * 0.42);
				add(g, pump);
				for (var i = 0; i < 5; i++) add(g, box(metalDark, 0.1, 0.012, 0.018, 0, -0.025, -0.16 - barrel * 0.42 - 0.07 + i * 0.035));
			}
			/* shell carrier */
			for (var s = 0; s < 3; s++) add(g, cylZ(brass, 0.012, 0.055, 0.055, -0.01, -0.05 + s * 0.04, 8));
			/* grip + stock */
			grip(g, o.gripMat || polymer, 0, -0.13, 0.09, -0.22);
			if (o.stock === 'wood') {
				add(g, box(wood, 0.08, 0.12, 0.24, 0, -0.04, 0.24));
				add(g, box(woodDark, 0.07, 0.07, 0.16, 0, -0.09, 0.23));
			} else {
				add(g, box(o.stockMat || polymer, 0.08, 0.12, 0.24, 0, -0.03, 0.24));
				add(g, box(o.stockMat || polymer, 0.09, 0.14, 0.03, 0, -0.025, 0.36));
			}
			/* bead sight */
			add(g, box(brass, 0.012, 0.012, 0.012, 0, 0.078, -0.16 - barrel * 0.8));
			/* support hand on pump */
			add(g, hand(glove, -0.02, -0.09, -0.16 - barrel * 0.42, 0.1, 0.085, 0.14, 0.12));
			addSleeve(g, sleeveTan, -0.01, -0.16, -0.16 - barrel * 0.25, -0.15);
			g.position.set(o.px || 0.2, o.py || -0.18, o.pz || -0.4);
			g.rotation.set(o.rx || 0.02, o.ry || -0.03, o.rz || 0);
			return finish(g, o.muzzleZ || (-0.16 - barrel * 0.86), { mag: [] });
		}

		/* ------------------------------------------------------ machine guns */
		function makeMG(o) {
			o = o || {};
			var g = new THREE.Group();
			var body = o.bodyMat || green;
			var len = o.len || 0.46;
			add(g, box(body, 0.1, 0.14, len, 0, -0.005, -0.16));
			add(g, box(metalDark, 0.09, 0.05, len * 0.9, 0, 0.085, -0.18));
			add(g, box(metal, 0.06, 0.08, 0.14, 0, 0.13, -0.1));
			add(g, box(metal, 0.05, 0.1, 0.18, 0, 0.0, -len * 0.9));
			/* heat shield + barrel */
			var bl = o.barrel || 0.48;
			add(g, cylZ(steel, 0.022, bl, 0, 0.04, -len - bl * 0.3, 12));
			for (var i = 0; i < 4; i++) add(g, box(metalDark, 0.048, 0.012, 0.05, 0, 0.04, -len - 0.03 - i * 0.06));
			muzzleDevice(g, metalDark, -len - bl * 0.72, 0.02, 0.08);
			/* box magazine */
			var mag = box(metalDark, 0.12, 0.23, 0.15, 0, -0.2, -0.03);
			mag.rotation.x = 0.05;
			add(g, mag);
			add(g, box(metal, 0.13, 0.02, 0.16, 0, -0.32, -0.02));
			/* grip + stock */
			grip(g, o.gripMat || polymer, 0, -0.13, 0.1, -0.24);
			stockFixed(g, polymer, 0.3, -0.02);
			/* bipod + carry handle */
			add(g, box(metal, 0.02, 0.15, 0.02, -0.09, -0.14, -len - 0.06));
			add(g, box(metal, 0.02, 0.15, 0.02, 0.09, -0.14, -len - 0.06));
			add(g, box(metal, 0.2, 0.015, 0.02, 0, -0.21, -len - 0.06));
			add(g, box(metal, 0.02, 0.06, 0.14, 0, 0.18, -0.02));
			add(g, box(metal, 0.12, 0.02, 0.02, 0, 0.21, -0.02));
			/* hand */
			add(g, hand(glove, -0.04, -0.09, -len - 0.12, 0.1, 0.09, 0.14, 0.12));
			addSleeve(g, sleeveTan, -0.03, -0.17, -len + 0.06, -0.15);
			g.position.set(o.px || 0.2, o.py || -0.18, o.pz || -0.4);
			g.rotation.set(o.rx || 0.02, o.ry || -0.03, o.rz || 0);
			return finish(g, o.muzzleZ || (-len - bl * 0.78), { mag: [mag] });
		}

		/* ---------------------------------------------------------------- zeus */
		function makeZeus() {
			var g = new THREE.Group();
			add(g, box(metalDark, 0.085, 0.1, 0.34, 0, 0, -0.1));
			add(g, box(accentBlue, 0.055, 0.018, 0.24, 0, 0.055, -0.12));
			add(g, box(metal, 0.06, 0.05, 0.15, 0, 0.075, -0.04));
			add(g, cylZ(metal, 0.018, 0.22, 0, 0.045, -0.34, 10));
			add(g, cylZ(accentBlue, 0.026, 0.06, 0, 0.045, -0.46, 12));
			add(g, cylZ(metal, 0.01, 0.16, -0.035, 0.045, -0.44, 8));
			add(g, cylZ(metal, 0.01, 0.16, 0.035, 0.045, -0.44, 8));
			add(g, box(metal, 0.11, 0.014, 0.02, 0, 0.045, -0.53));
			add(g, box(accentBlue, 0.002, 0.12, 0.12, 0.043, 0.0, -0.16));
			grip(g, polymer, 0, -0.12, 0.06, -0.22);
			add(g, box(metalDark, 0.06, 0.15, 0.1, 0, -0.13, 0.07));
			g.position.set(0.2, -0.18, -0.42);
			g.rotation.set(0.02, -0.03, 0);
			return finish(g, -0.56, { mag: [] });
		}

		/* --------------------------------------------------------------- knife */
		function makeKnife() {
			var g = new THREE.Group();
			add(g, box(metalDark, 0.035, 0.055, 0.14, 0, 0, 0.11));
			add(g, box(polymer, 0.045, 0.07, 0.05, 0, 0, 0.19));
			add(g, box(metal, 0.055, 0.012, 0.03, 0, 0.03, 0.03));
			var bladeShape = new THREE.Shape();
			bladeShape.moveTo(0, 0.03);
			bladeShape.lineTo(0, -0.025);
			bladeShape.lineTo(-0.26, -0.055);
			bladeShape.lineTo(-0.36, -0.012);
			bladeShape.lineTo(-0.27, 0.035);
			bladeShape.lineTo(0, 0.03);
			var blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.009, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 }), silver);
			blade.rotation.y = Math.PI / 2;
			blade.position.set(0, 0.03, -0.02);
			add(g, blade);
			var edge = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.006, 0.42), steel);
			edge.position.set(0.005, 0.012, -0.16);
			add(g, edge);
			add(g, hand(glove, 0, -0.03, 0.16, 0.1, 0.09, 0.14));
			addSleeve(g, sleeve, 0.01, -0.14, 0.28, -0.3);
			g.position.set(0.22, -0.2, -0.4);
			g.rotation.set(0.05, -0.1, 0.1);
			return finish(g, -0.4, { mag: [] });
		}

		/* ----------------------------------------------------------- grenades */
		function makeGrenade(kind, color) {
			var g = new THREE.Group();
			var bodyMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.62, metalness: 0.3 });
			var capMat = new THREE.MeshStandardMaterial({ color: 0x8e969c, roughness: 0.4, metalness: 0.65 });
			if (kind === 'molotov') {
				add(g, cylZ(bodyMat, 0.065, 0.2, 0, 0.0, -0.05, 14));
				add(g, cylZ(metalDark, 0.025, 0.08, 0, 0.0, 0.12, 10));
				add(g, box(accentRed, 0.02, 0.1, 0.02, 0.055, 0.08, 0.1));
				add(g, hand(glove, 0, -0.07, 0.1, 0.1, 0.09, 0.14));
				addSleeve(g, sleeve, 0.01, -0.18, 0.24, -0.4);
				g.position.set(0.2, -0.2, -0.42);
				return finish(g, -0.2, { mag: [] });
			}
			add(g, cylZ(bodyMat, 0.05, 0.11, 0, 0, -0.03, 12));
			add(g, cylZ(capMat, 0.028, 0.04, 0, 0.03, 0.03, 10));
			add(g, box(metalDark, 0.06, 0.018, 0.02, 0, 0.05, 0.03));
			add(g, box(metalDark, 0.018, 0.05, 0.018, 0.035, 0.02, 0.03));
			add(g, hand(glove, 0, -0.06, 0.1, 0.1, 0.09, 0.14));
			addSleeve(g, sleeve, 0.01, -0.17, 0.24, -0.4);
			g.position.set(0.2, -0.2, -0.42);
			g.rotation.set(0.02, -0.04, 0);
			return finish(g, -0.22, { mag: [] });
		}

		/* ---------------------------------------------------- weapon catalogue */
		var specs = {
			usp: { kind: 'pistol', slideMat: metalDark, suppressor: true, len: 0.31, muzzle: -0.63 },
			glock: { kind: 'pistol', frameMat: polymer, slideMat: metalDark, len: 0.3, muzzle: -0.52 },
			p2000: { kind: 'pistol', slideMat: silver, len: 0.31, muzzle: -0.56 },
			p250: { kind: 'pistol', frameMat: polymerTan, slideMat: steel, len: 0.3, muzzle: -0.53 },
			deagle: { kind: 'pistol', slideMat: silver, frameMat: steel, len: 0.36, muzzle: -0.62, barrelMat: silver, px: 0.2, py: -0.18, pz: -0.44 },
			r8: { kind: 'pistol', slideMat: steel, revolver: true, len: 0.34, muzzle: -0.6, barrelMat: silver },
			fiveseven: { kind: 'pistol', frameMat: polymerTan, slideMat: metalDark, len: 0.31, muzzle: -0.55 },
			tec9: { kind: 'pistol', frameMat: polymer, slideMat: steel, len: 0.36, muzzle: -0.6, magMat: metalDark },
			cz75: { kind: 'pistol', frameMat: steel, slideMat: metalDark, len: 0.32, muzzle: -0.56 },
			dualies: { kind: 'pistol', dual: true, slideMat: silver, len: 0.32, muzzle: -0.56 },
			mac10: { kind: 'smg', len: 0.3, stock: 'folding', magH: 0.2, optic: 'none', handguard: 0.13 },
			mp9: { kind: 'smg', len: 0.32, stock: 'folding', optic: 'none', handguard: 0.15, magH: 0.19 },
			mp7: { kind: 'smg', len: 0.33, stock: 'skeleton', optic: 'reddot', handguard: 0.16, magH: 0.2 },
			mp5sd: { kind: 'smg', len: 0.35, stock: 'fixed', suppressor: true, optic: 'none', handguard: 0.17, magH: 0.21 },
			ump45: { kind: 'smg', len: 0.36, stock: 'folding', optic: 'none', handguard: 0.17, magH: 0.21, bodyMat: polymerGreen },
			p90: { kind: 'smg', len: 0.3, stock: 'none', optic: 'reddot', magType: 'top', handguard: 0.12 },
			bizon: { kind: 'smg', len: 0.33, stock: 'folding', optic: 'none', magType: 'drum', handguard: 0.12 },
			ak47: { kind: 'rifle', len: 0.44, wood: true, stock: 'wood', bodyMat: metalDark, magSegs: 3, optic: 'iron' },
			m4a4: { kind: 'rifle', len: 0.44, stock: 'adjustable', stockMat: polymerTan, gripMat: polymerTan, handguardMat: polymerTan, tan: true, optic: 'iron', magSegs: 2 },
			m4a1s: { kind: 'rifle', len: 0.44, stock: 'adjustable', suppressor: true, stockMat: polymerTan, gripMat: polymerTan, handguardMat: polymerTan, tan: true, optic: 'reddot', magSegs: 2, magH: 0.13, barrel: 0.34 },
			galil: { kind: 'rifle', len: 0.42, stock: 'folding', bodyMat: steel, gripMat: polymer, optic: 'iron', magSegs: 3 },
			famas: { kind: 'rifle', len: 0.44, stock: 'fixed', bodyMat: polymer, optic: 'scope', scopeLen: 0.24, magSegs: 2, barrel: 0.36 },
			sg553: { kind: 'rifle', len: 0.44, stock: 'folding', bodyMat: polymer, optic: 'scope', scopeLen: 0.28, magSegs: 2, barrel: 0.36 },
			aug: { kind: 'rifle', len: 0.46, stock: 'fixed', bodyMat: polymerGreen, optic: 'scope', scopeLen: 0.3, magSegs: 2, barrel: 0.38 },
			awp: { kind: 'sniper', len: 0.55, barrel: 0.62, bodyMat: green, scopeLen: 0.38, bipod: true },
			ssg08: { kind: 'sniper', len: 0.5, barrel: 0.55, bodyMat: polymerGreen, scopeLen: 0.34, bipod: true },
			scar20: { kind: 'sniper', len: 0.53, barrel: 0.5, bodyMat: polymerTan, scopeLen: 0.32 },
			g3sg1: { kind: 'sniper', len: 0.54, barrel: 0.52, bodyMat: metalDark, scopeLen: 0.34 },
			nova: { kind: 'shotgun', len: 0.4, barrel: 0.44, wood: true, stock: 'wood', pumpMat: woodDark },
			xm1014: { kind: 'shotgun', len: 0.42, barrel: 0.46, stockMat: polymer, pumpMat: polymer },
			mag7: { kind: 'shotgun', len: 0.34, barrel: 0.38, stockMat: polymer, pumpMat: metalDark },
			sawedoff: { kind: 'shotgun', len: 0.32, barrel: 0.26, wood: true, stock: 'wood', pump: false },
			m249: { kind: 'mg', len: 0.48, barrel: 0.5, bodyMat: green, gripMat: polymer },
			negev: { kind: 'mg', len: 0.46, barrel: 0.46, bodyMat: metalDark, gripMat: polymerGreen },
			zeus: { kind: 'zeus' },
			knife: { kind: 'knife' }
		};
		var defs = {};
		Object.keys(specs).forEach(function (id) {
			var s = specs[id];
			var model;
			if (s.kind === 'pistol') model = makePistol(s);
			else if (s.kind === 'smg') model = makeSMG(s);
			else if (s.kind === 'rifle') model = makeRifle(s);
			else if (s.kind === 'sniper') model = makeSniper(s);
			else if (s.kind === 'shotgun') model = makeShotgun(s);
			else if (s.kind === 'mg') model = makeMG(s);
			else if (s.kind === 'zeus') model = makeZeus();
			else model = makeKnife();
			defs[id] = model;
		});
		/* utility viewmodels share the grenade rig */
		defs.he = makeGrenade('he', 0x4b5d3c);
		defs.flash = makeGrenade('flash', 0x8b8f93);
		defs.smoke = makeGrenade('smoke', 0x5c6a66);
		defs.molotov = makeGrenade('molotov', 0x8a4a25);
		defs.decoy = makeGrenade('decoy', 0x655f4e);
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


	function buildGrenadeProjectile(kind) {
		var util = UTILITIES[kind] || UTILITIES.he;
		var group = new THREE.Group();
		var colors = { he: 0x49563a, flash: 0x9a9d9f, smoke: 0x60716c, molotov: 0x8a4a25, decoy: 0x6b6452 };
		var bodyMat = new THREE.MeshStandardMaterial({ color: colors[kind] || 0x49563a, roughness: 0.55, metalness: 0.35 });
		var capMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.35, metalness: 0.75 });
		var body;
		if (kind === 'molotov') {
			body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.22, 12), bodyMat);
			body.rotation.z = Math.PI / 2;
			var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.09, 10), capMat);
			neck.rotation.z = Math.PI / 2;
			neck.position.x = 0.15;
			group.add(neck);
			var rag = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.03), new THREE.MeshBasicMaterial({ color: 0xff7a3c }));
			rag.position.x = 0.22;
			group.add(rag);
		} else {
			body = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.14, 12), bodyMat);
			body.rotation.z = Math.PI / 2;
			var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 10), capMat);
			cap.rotation.z = Math.PI / 2;
			cap.position.x = -0.09;
			group.add(cap);
			var pin = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 5, 10), capMat);
			pin.position.set(-0.05, 0.07, 0);
			group.add(pin);
		}
		group.add(body);
		group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
		return { group: group, body: body, util: util, materials: [bodyMat, capMat] };
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
		if (kind === 'mg') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M10 24h18l6-7h38l4 5h18l3-2h7v7h-8l-2 3H66l-7 5H49l-4 14H34l5-14H25l-6 4H10z"/>' +
				'<path d="M49 36h22v9H49z" opacity=".6"/><path d="M83 23h31v3H83z"/>' +
				'<circle cx="38" cy="31" r="4" fill="#0a0e12"/><circle cx="75" cy="31" r="3" fill="#0a0e12"/>' +
				'</svg>';
		}
		if (kind === 'zeus') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M18 22h46v10H18z"/><path d="M64 25h22v4H64z"/><path d="M86 21h6v12h-6z"/>' +
				'<path d="M96 25l10 2-10 2z"/><path d="M22 32h20v12H22z" opacity=".7"/>' +
				'<path d="M24 20h34v3H24z" opacity=".5"/></svg>';
		}
		if (kind === 'grenade') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<rect x="34" y="18" width="26" height="26" rx="7"/><rect x="46" y="10" width="14" height="9" rx="2"/>' +
				'<path d="M58 12h16v4H58z"/><circle cx="76" cy="14" r="4" opacity=".65"/>' +
				'<path d="M28 43h38v4H28z" opacity=".5"/></svg>';
		}
		if (kind === 'gear') {
			return '<svg viewBox="0 0 120 54" fill="currentColor" aria-hidden="true">' +
				'<path d="M60 8l24 10v10c0 11-10 18-24 20-14-2-24-9-24-20V18z"/>' +
				'<path d="M52 27l6 7 13-14" fill="none" stroke="#0a0e12" stroke-width="4"/></svg>';
		}
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
		} else if (id === 'silenced') {
			this.burst({ dur: 0.06, type: 'bandpass', freq: 2100, q: 0.9, gain: 0.16 * att, pan: pan, wet: 0.05 });
			this.tone({ freq: 220, to: 90, dur: 0.06, gain: 0.08 * att, type: 'triangle' });
		} else if (id === 'zeus') {
			this.burst({ dur: 0.22, type: 'highpass', freq: 3200, q: 0.4, gain: 0.22 * att, pan: pan, wet: 0.2 });
			this.tone({ freq: 1800, to: 220, dur: 0.2, gain: 0.18 * att, type: 'sawtooth' });
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
		WEAPONS: WEAPONS, UTILITIES: UTILITIES, UTIL_ORDER: UTIL_ORDER,
		BUY_ITEMS: BUY_ITEMS, BUY_SECTION_ORDER: BUY_SECTION_ORDER,
		WEAPON_TEAM_LOCK: WEAPON_TEAM_LOCK, BOT_TYPES: BOT_TYPES,
		DIFFICULTY: DIFFICULTY, BOT_LOADOUTS: BOT_LOADOUTS, BOT_NAMES: BOT_NAMES, BOT_SPAWNS: BOT_SPAWNS,
		BOMB: BOMB, TEAM_LOADOUTS: TEAM_LOADOUTS,
		buildBomb: buildBomb,
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
		buildGrenadeProjectile: buildGrenadeProjectile,
		buildPracticeTarget: buildPracticeTarget,
		buildChicken: buildChicken,
		buildPlayerBody: buildPlayerBody,
		weaponIcon: weaponIcon,
		SoundEngine: SoundEngine
	};
})(window);
