/**
 * views/cs-range/game.js — DUST RANGE
 *
 * The match layer: pointer-lock FPS controller, hitscan weapons, round economy,
 * five-vs-five team AI with A* navigation and C4 duty, kill feed, radar and HUD.
 * Content (map, textures, models, audio) lives in content.js; this file is the
 * state machine that turns them into a game.
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var THREE = global.THREE;
	var C = global.CSRangeContent;
	var ROUTE = 'range';
	var SETTINGS_KEY = 'hayneko.range.settings.v1';
	var RECORDS_KEY = 'hayneko.range.records.v1';
	var AI_KEY = 'hayneko.range.ai.v1';
	var MATCH_TARGET = 13;

	var current = null;

	/* ======================================================================
	   tiny utilities
	   ====================================================================== */
	function $(host, name) { return host.querySelector('[data-csr-' + name + ']'); }
	function $$(host, name) {
		return Array.prototype.slice.call(host.querySelectorAll('[data-csr-' + name + ']'));
	}
	function text(node, value) {
		if (!node) return;
		var source = String(value);
		if (global.CSRangeI18n) {
			global.CSRangeI18n.remember(node, source);
			value = global.CSRangeI18n.t(source);
		} else {
			value = source;
		}
		if (node.textContent !== value) node.textContent = value;
	}
	function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
	function emptyAIMemory() {
		return { version: 1, routes: {}, groupBias: { CT: 0.15, T: 0.15 }, teamFear: { CT: 0, T: 0 }, deaths: [] };
	}

	RangeGame.prototype.normalizeAIMemory = function (raw) {
		var m = raw && typeof raw === 'object' ? raw : {};
		var out = emptyAIMemory();
		if (m.routes && typeof m.routes === 'object') out.routes = m.routes;
		if (m.groupBias && typeof m.groupBias === 'object') {
			out.groupBias.CT = clamp(Number(m.groupBias.CT) || 0, 0, 1);
			out.groupBias.T = clamp(Number(m.groupBias.T) || 0, 0, 1);
		}
		if (m.teamFear && typeof m.teamFear === 'object') {
			out.teamFear.CT = clamp(Number(m.teamFear.CT) || 0, 0, 1);
			out.teamFear.T = clamp(Number(m.teamFear.T) || 0, 0, 1);
		}
		if (Array.isArray(m.deaths)) out.deaths = m.deaths.slice(-40);
		return out;
	};

	RangeGame.prototype.saveAIMemory = function () {
		saveJSON(AI_KEY, this.aiMemory);
	};

	RangeGame.prototype.difficultyFor = function (team) {
		var key = team === this.playerTeam ? this.settings.difficultyAlly : this.settings.difficultyEnemy;
		return C.DIFFICULTY[key] || C.DIFFICULTY.regular;
	};

	RangeGame.prototype.aiRouteKey = function (team, site, route) {
		return team + '|' + (site || '?') + '|' + (route || 'anchor');
	};

	RangeGame.prototype.aiRouteStat = function (team, site, route) {
		var key = this.aiRouteKey(team, site, route);
		if (!this.aiMemory.routes[key]) this.aiMemory.routes[key] = { uses: 0, deaths: 0, wins: 0, lastUse: 0, lastDeath: null };
		return this.aiMemory.routes[key];
	};

	RangeGame.prototype.teamFearValue = function (team) {
		return clamp(Number(this.teamFear && this.teamFear[team]) || 0, 0, 1);
	};

	RangeGame.prototype.registerTeamDeath = function (team, victim) {
		if (!this.teamFear) this.teamFear = { CT: 0, T: 0 };
		if (!this.recentDeaths) this.recentDeaths = { CT: [], T: [] };
		var now = this.now;
		var arr = this.recentDeaths[team] || (this.recentDeaths[team] = []);
		arr.push(now);
		while (arr.length && now - arr[0] > 10000) arr.shift();
		var c5 = 0, c10 = arr.length;
		for (var i = 0; i < arr.length; i++) if (now - arr[i] <= 5000) c5++;
		var spike = 0.035;
		if (c5 >= 2) spike += 0.18;
		if (c5 >= 3) spike += 0.12;
		else if (c10 >= 3) spike += 0.06;
		this.teamFear[team] = clamp(this.teamFearValue(team) + spike, 0, 1);
		this.aiMemory.teamFear[team] = this.teamFear[team];
		if (c5 >= 2) {
			if (!this.panicUntil) this.panicUntil = { CT: 0, T: 0 };
			this.panicUntil[team] = now + 8000;
			this.aiMemory.groupBias[team] = clamp((this.aiMemory.groupBias[team] || 0) + 0.07, 0, 1);
		}
		this.saveAIMemory();
		this.replanTeam(team, victim, c5 >= 2);
		if (team === this.playerTeam && c5 >= 2 && now - (this._panicToastAt || 0) > 4000) {
			this._panicToastAt = now;
			this.toast('Squad shaken — regrouping.');
		}
	};

	RangeGame.prototype.teamAce = function (team, n) {
		if (!this.teamFear) this.teamFear = { CT: 0, T: 0 };
		var cut = n >= 5 ? 0.35 : 0.18;
		this.teamFear[team] = clamp(this.teamFearValue(team) - cut, 0, 1);
		this.aiMemory.teamFear[team] = this.teamFear[team];
		if (this.panicUntil) this.panicUntil[team] = 0;
		this.aiMemory.groupBias[team] = clamp((this.aiMemory.groupBias[team] || 0) - 0.08, 0, 1);
		this.saveAIMemory();
		if (team === this.playerTeam) this.toast((n >= 5 ? '5K' : '4K') + ' — squad confidence.');
	};

	RangeGame.prototype.decayTeamFear = function (dt) {
		if (!this.teamFear) return;
		['CT', 'T'].forEach(function (team) {
			var f = clamp(Number(this.teamFear[team]) || 0, 0, 1);
			if (f <= 0) return;
			f = Math.max(0, f - dt * 0.006);
			this.teamFear[team] = f;
			this.aiMemory.teamFear[team] = f;
		}, this);
	};

	RangeGame.prototype.replanTeam = function (team, victim, rapid) {
		var now = this.now;
		if (!this.teamReplanAt) this.teamReplanAt = { CT: 0, T: 0 };
		if (!this.teamReplan) this.teamReplan = { CT: null, T: null };
		if (now - (this.teamReplanAt[team] || 0) < 1200) {
			this.teamReplan[team] = { at: now, victim: victim && victim.name, rapid: !!rapid, coalesced: true };
			return;
		}
		this.teamReplanAt[team] = now;
		var self = this;
		var alive = this.teamBots(team, true);
		if (!alive.length) return;
		var cx = 0, cz = 0;
		for (var a = 0; a < alive.length; a++) { cx += alive[a].x; cz += alive[a].z; }
		var rally = this.snapFreePoint(cx / alive.length, cz / alive.length, 0.46);
		for (var i = 0; i < alive.length; i++) {
			var bot = alive[i];
			if (bot.planting || this.criticalRole(bot)) continue;
			bot.replanUntil = now + 900;
			bot.replanPoint = team === 'CT'
				? (bot.holdPoint ? { x: bot.holdPoint.x, z: bot.holdPoint.z } : { x: bot.x, z: bot.z })
				: { x: rally.x, z: rally.z };
			bot.path = null;
			bot.pathGoal = null;
			bot.pathTimer = 0;
			if (team === 'T' && this.bomb && this.bomb.state === 'carried' && !bot.hasBomb && !bot.atSite) {
				var site = bot.site || this.tSite || 'A';
				var routes = this.world.routes[site] || this.world.routes.A;
				var routeName = this.aiChooseRoute('T', site, bot.tRouteName || 'main');
				var pts = routes && routes[routeName];
				if (pts && pts.length) {
					var bestIdx = 0, bestD = 1e9;
					for (var p = 0; p < pts.length; p++) {
						var pd = Math.hypot(pts[p].x - bot.x, pts[p].z - bot.z);
						if (pd < bestD) { bestD = pd; bestIdx = p; }
					}
					var sliced = [];
					for (var k = bestIdx; k < pts.length; k++) {
						sliced.push(self.snapFreePoint(pts[k].x, pts[k].z, 0.46));
					}
					if (sliced.length) {
						bot.route = sliced;
						bot.routeIndex = 0;
						bot.tRouteName = routeName;
						bot.atSite = false;
					}
				}
			}
		}
		/* If a CT anchor died at an under-defended site, pull one anchor over. */
		if (team === 'CT' && victim && victim.site) {
			var siteId = victim.site;
			var atSite = alive.filter(function (b) { return b.site === siteId; }).length;
			if (atSite < 2) {
				var other = siteId === 'A' ? 'B' : 'A';
				var candidate = alive.filter(function (b) {
					return b.site === other && !b.planting && !self.criticalRole(b);
				})[0];
				if (candidate) {
					candidate.site = siteId;
					candidate.atSite = false;
					candidate.plantSpot = null;
					var hold = this.ctPostFor(candidate, siteId);
					candidate.post = hold;
					candidate.holdPoint = hold;
					candidate.route = hold ? [this.snapFreePoint(hold.x, hold.z, 0.46)] : [];
					candidate.routeIndex = 0;
					candidate.path = null;
					candidate.pathGoal = null;
					candidate.replanUntil = now + 900;
					candidate.replanPoint = hold ? { x: hold.x, z: hold.z } : { x: candidate.x, z: candidate.z };
				}
			}
		}
		this.teamReplan[team] = { at: now, victim: victim && victim.name, rapid: !!rapid };
		this.saveAIMemory();
	};

	RangeGame.prototype.botReplanObjective = function (bot, dt) {
		if (!bot.replanUntil) return false;
		if (this.now >= bot.replanUntil) { bot.replanUntil = 0; bot.replanPoint = null; return false; }
		if (bot.planting || this.criticalRole(bot)) { bot.replanUntil = 0; return false; }
		if (bot.replanPoint) {
			var d = Math.hypot(bot.replanPoint.x - bot.x, bot.replanPoint.z - bot.z);
			if (d > 1.1) this.botPathTo(bot, bot.replanPoint.x, bot.replanPoint.z, bot.speed * 0.95, dt);
			else { bot.moveX = 0; bot.moveZ = 0; }
		} else { bot.moveX = 0; bot.moveZ = 0; }
		bot.mode = 'replan';
		return true;
	};

	RangeGame.prototype.botPanicObjective = function (bot, dt) {
		var fear = this.teamFearValue(bot.team);
		var panicking = fear >= 0.4 || (this.panicUntil && this.now < (this.panicUntil[bot.team] || 0));
		if (!panicking) return false;
		if (bot.planting || this.criticalRole(bot) || bot.hasBomb) return false;
		if (this.bomb && (this.bomb.state === 'planted' || this.bomb.state === 'planting')) return false;
		if (this.bomb && this.bomb.state === 'dropped') {
			var rank = this.bombRecoveryRank(bot);
			if (rank >= 0 && rank < 3) return false;
		}
		var nearest = null, nd = 1e9;
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b === bot || b.team !== bot.team || !b.alive || b.dead) continue;
			var d = Math.hypot(b.x - bot.x, b.z - bot.z);
			if (d < nd) { nd = d; nearest = b; }
		}
		if (this.player.alive && this.playerTeam === bot.team) {
			var pd = Math.hypot(this.player.x - bot.x, this.player.z - bot.z);
			if (pd < nd) { nd = pd; nearest = { x: this.player.x, z: this.player.z }; }
		}
		if (!nearest) return false;
		if (nd > 5.4) this.botPathTo(bot, nearest.x, nearest.z, bot.speed * 0.92, dt);
		else {
			bot.moveX = 0;
			bot.moveZ = 0;
			var alert = this.teamAlerts && this.teamAlerts[bot.team];
			if (alert && this.now - alert.seenAt < 8000) bot.face = { x: alert.x, z: alert.z };
			else bot.face = { x: nearest.x, z: nearest.z };
		}
		bot.mode = 'fear';
		return true;
	};

	RangeGame.prototype.aiRouteFear = function (team, site, route) {
		var stat = this.aiRouteStat(team, site, route);
		var fear = Number(stat.fear) || 0;
		if (!fear) return 0;
		var last = Number(stat.lastFearAt) || 0;
		if (!last) return clamp(fear, 0, 1);
		var age = Math.max(0, Date.now() - last);
		/* fear cools down over roughly two minutes without fresh bad news */
		return clamp(fear * Math.pow(0.5, age / 120000), 0, 1);
	};

	RangeGame.prototype.aiRecordPlayerKill = function (victim) {
		if (!this.aiMemory) return;
		var site = (victim && victim.site) || (this.nearestSite(this.player.x, this.player.z) || {}).id || 'A';
		var routes = this.playerTeam === 'T' ? ['main', 'flank'] : ['anchor'];
		for (var i = 0; i < routes.length; i++) {
			var stat = this.aiRouteStat(this.playerTeam, site, routes[i]);
			stat.kills = (stat.kills || 0) + 1;
			stat.lastKillAt = Date.now();
			stat.fear = clamp((stat.fear || 0) - 0.10, 0, 1);
			stat.lastFearAt = stat.fear > 0 ? Date.now() : 0;
		}
		this.saveAIMemory();
	};

	RangeGame.prototype.aiRecordRouteKill = function (bot) {
		if (!bot || !bot.team || !this.aiMemory) return;
		var site = bot.site || this.tSite || 'A';
		var route = bot.team === 'T' ? (bot.tRouteName || 'main') : 'anchor';
		var stat = this.aiRouteStat(bot.team, site, route);
		stat.kills = (stat.kills || 0) + 1;
		stat.lastKillAt = Date.now();
		stat.fear = clamp((stat.fear || 0) - 0.16, 0, 1);
		stat.lastFearAt = stat.fear > 0 ? Date.now() : 0;
		this.saveAIMemory();
	};

	RangeGame.prototype.aiNoteRouteUse = function (team, site, route) {
		var stat = this.aiRouteStat(team, site, route);
		stat.uses++;
		stat.lastUse = this.match ? this.match.round : 0;
	};

	RangeGame.prototype.aiChooseRoute = function (team, site, fallback) {
		var plan = (this.difficultyFor(team).planning || 0.5);
		var main = this.aiRouteStat(team, site, 'main');
		var flank = this.aiRouteStat(team, site, 'flank');
		var mainScore = (main.deaths + 1) / (main.uses + 2) + this.aiRouteFear(team, site, 'main') * 1.15;
		var flankScore = (flank.deaths + 1) / (flank.uses + 2) + this.aiRouteFear(team, site, 'flank') * 1.15;
		var exploitChance = 0.45 + plan * 0.45;
		if (Math.random() < exploitChance) return mainScore <= flankScore ? 'main' : 'flank';
		return Math.random() < 0.5 ? 'main' : (fallback || 'flank');
	};

	RangeGame.prototype.aiRecordDeath = function (bot, context) {
		if (!bot || !this.aiMemory) return;
		var team = bot.team;
		var site = bot.site || this.tSite || (bot.team === 'CT' ? 'A' : 'A');
		var route = bot.team === 'T' ? (bot.tRouteName || 'main') : 'anchor';
		var stat = this.aiRouteStat(team, site, route);
		stat.deaths++;
		stat.uses = Math.max(stat.uses, 1);
		var alliesNear = 0, enemiesNear = 0;
		var enemyTeam = team === 'CT' ? 'T' : 'CT';
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b === bot || !b.alive || b.dead) continue;
			var d = Math.hypot(b.x - bot.x, b.z - bot.z);
			if (b.team === team && d < 14) alliesNear++;
			else if (b.team === enemyTeam && d < 18) enemiesNear++;
		}
		if (this.player.alive && this.playerTeam === team && Math.hypot(this.player.x - bot.x, this.player.z - bot.z) < 14) alliesNear++;
		if (this.player.alive && this.playerTeam === enemyTeam && Math.hypot(this.player.x - bot.x, this.player.z - bot.z) < 18) enemiesNear++;
		var isolated = alliesNear < 2;
		var outnumbered = enemiesNear > alliesNear;
		var teamAlive = this.aliveTeamCount(team);
		var enemyAlive = this.aliveTeamCount(enemyTeam);
		var globalOut = enemyAlive > teamAlive;
		var bias = this.aiMemory.groupBias[team] || 0;
		if (isolated) bias += 0.14;
		if (outnumbered) bias += 0.07;
		if (globalOut) bias += 0.04;
		if (!isolated && !outnumbered && !globalOut) bias -= 0.03;
		this.aiMemory.groupBias[team] = clamp(bias, 0, 1);
		stat.fear = clamp((stat.fear || 0) + 0.22 + (isolated ? 0.08 : 0) + (outnumbered ? 0.08 : 0) + (globalOut ? 0.05 : 0), 0, 1);
		stat.lastFearAt = Date.now();
		stat.lastDeath = {
			round: this.match ? this.match.round : 0,
			x: +bot.x.toFixed(1), z: +bot.z.toFixed(1),
			allies: alliesNear, enemies: enemiesNear,
			teamAlive: teamAlive, enemyAlive: enemyAlive,
			isolated: isolated, outnumbered: outnumbered, globalOut: globalOut,
			cause: context || 'shot'
		};
		this.aiMemory.deaths.push({
			t: Date.now(), round: this.match ? this.match.round : 0, team: team, site: site, route: route,
			x: +bot.x.toFixed(1), z: +bot.z.toFixed(1),
			allies: alliesNear, enemies: enemiesNear,
			teamAlive: teamAlive, enemyAlive: enemyAlive,
			isolated: isolated, outnumbered: outnumbered, globalOut: globalOut,
			cause: context || 'shot', bomb: this.bomb ? this.bomb.state : null
		});
		if (this.aiMemory.deaths.length > 40) this.aiMemory.deaths.shift();
		this.saveAIMemory();
	};

	RangeGame.prototype.aiRecordPlayerDeath = function (fromBot) {
		if (!this.aiMemory) return;
		var team = this.playerTeam;
		var site = (this.nearestSite(this.player.x, this.player.z) || {}).id || 'A';
		var alliesNear = 0, enemiesNear = 0;
		var enemyTeam = team === 'CT' ? 'T' : 'CT';
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (!b.alive || b.dead) continue;
			var d = Math.hypot(b.x - this.player.x, b.z - this.player.z);
			if (b.team === team && d < 14) alliesNear++;
			else if (b.team === enemyTeam && d < 18) enemiesNear++;
		}
		var isolated = alliesNear < 1;
		var teamAlive = this.aliveTeamCount(team);
		var enemyAlive = this.aliveTeamCount(enemyTeam);
		var bias = this.aiMemory.groupBias[team] || 0;
		if (isolated) bias += 0.1;
		if (enemiesNear > alliesNear) bias += 0.06;
		if (enemyAlive > teamAlive) bias += 0.04;
		this.aiMemory.groupBias[team] = clamp(bias, 0, 1);
		this.aiMemory.deaths.push({
			t: Date.now(), round: this.match ? this.match.round : 0, team: team, site: site, route: 'player',
			x: +this.player.x.toFixed(1), z: +this.player.z.toFixed(1),
			allies: alliesNear, enemies: enemiesNear,
			teamAlive: teamAlive, enemyAlive: enemyAlive, isolated: isolated,
			cause: fromBot ? ('killed by ' + fromBot.name) : 'player death', bomb: this.bomb ? this.bomb.state : null
		});
		if (this.aiMemory.deaths.length > 40) this.aiMemory.deaths.shift();
		this.saveAIMemory();
	};

	RangeGame.prototype.aiRecordRound = function (winner) {
		if (!this.aiMemory) return;
		var loser = winner === 'CT' ? 'T' : 'CT';
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			var site = b.site || this.tSite || 'A';
			var route = b.team === 'T' ? (b.tRouteName || 'main') : 'anchor';
			var stat = this.aiRouteStat(b.team, site, route);
			if (b.team === winner) {
				stat.wins++;
				stat.fear = clamp((stat.fear || 0) - 0.02, 0, 1);
			} else if (b.team === loser) {
				/* a wipe makes the lane feel unsafe even for robots that died early */
				stat.fear = clamp((stat.fear || 0) + 0.10, 0, 1);
				stat.lastFearAt = Date.now();
			}
		}
		this.aiMemory.groupBias[winner] = clamp((this.aiMemory.groupBias[winner] || 0) - 0.02, 0, 1);
		this.saveAIMemory();
	};

	function circleHitsBox(x, z, r, c) {
		var nx = x < c.minX ? c.minX : (x > c.maxX ? c.maxX : x);
		var nz = z < c.minZ ? c.minZ : (z > c.maxZ ? c.maxZ : z);
		var dx = x - nx, dz = z - nz;
		return dx * dx + dz * dz < r * r;
	}
	function pad(n) { return n < 10 ? '0' + n : String(n); }
	function fmtTime(seconds) {
		seconds = Math.max(0, Math.ceil(seconds));
		return Math.floor(seconds / 60) + ':' + pad(seconds % 60);
	}
	function fmtMoney(n) {
		return '$' + Math.max(0, Math.round(n)).toLocaleString('en-US');
	}
	function escapeHTML(s) {
		return String(s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}
	function loadJSON(key, fallback) {
		try {
			var raw = global.localStorage.getItem(key);
			if (!raw) return fallback;
			var v = JSON.parse(raw);
			return v && typeof v === 'object' ? v : fallback;
		} catch (e) { return fallback; }
	}
	function saveJSON(key, value) {
		try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
	}
	function dampAngle(a, b, lambda, dt) {
		return a + C.angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
	}
	function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
	function easeOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }

	var WALL_PENETRATION_MAX = 0.5;
	var WALL_PENETRATION_LAYERS = 2;
	var WALL_PENETRATION_DAMAGE = 0.68;

	/* ======================================================================
	   the game
	   ====================================================================== */
	function RangeGame(host) {
		this.host = host;
		this.state = 'boot';
		this.el = {};
		this.listeners = [];
		this.locked = false;
		this.fallbackLook = false;
		this.ignoreUnlockUntil = 0;
		this.settings = Object.assign({
			difficultyAlly: 'regular', difficultyEnemy: 'regular',
			quality: 'balanced', sens: 1, volume: 0.7, muted: false
		}, loadJSON(SETTINGS_KEY, {}));
		/* migrate the single-difficulty setting from the old build */
		if (!this.settings.difficultyAlly) this.settings.difficultyAlly = this.settings.difficulty || 'regular';
		if (!this.settings.difficultyEnemy) this.settings.difficultyEnemy = this.settings.difficulty || 'regular';
		this.aiMemory = this.normalizeAIMemory(loadJSON(AI_KEY, null));
		this.teamFear = this.aiMemory.teamFear;
		this.records = Object.assign({
			bestWins: 0, bestRounds: 0, bestKills: 0, matches: 0
		}, loadJSON(RECORDS_KEY, {}));

		this.bots = [];
		this.botHitMeshes = [];
		this.botSeq = 0;
		this.bomb = null;
		this.bombGroup = null;
		this.bombModel = null;
		this.bombCarryMesh = null;
		this.defuseKit = false;
		this.playerDefusing = false;
		this.spectating = false;
		this.spectateTarget = null;
		this.tSite = 'A';
		this.carrier = null;
		this.teamAlerts = { CT: null, T: null };
		this.alertSeq = 0;
		this.contactAlert = null;
		this.playerContactTimer = 0;
		this.tracers = [];
		this.sparks = [];
		this.debris = [];
		this.shells = [];
		this.decals = [];
		this.drops = [];
		this.dropSeq = 0;
		this.chickens = [];
		this.targets = [];
		this.targetSeq = 0;
		this.playerTeam = 'CT';
		this.enemyTeam = 'T';
		this.playerHasBomb = false;
		this.playerPlanting = false;
		this.playerPlantProgress = 0;
		this.pendingTeam = 'CT';
		this.practice = false;
		this.practiceStats = { score: 0, hits: 0, targets: 0, centers: 0 };
		this.playerBody = null;
		this.deathInfo = null;
		this.nearestDrop = null;
		this._pickupKey = 0;
		this._overlayDrawn = false;
		this.killFeed = [];
		this.roundHistory = [];
		this.raycaster = THREE ? new THREE.Raycaster() : null;
		this.tmpA = THREE ? new THREE.Vector3() : null;
		this.tmpB = THREE ? new THREE.Vector3() : null;
		this.tmpC = THREE ? new THREE.Vector3() : null;
		this.menuT = 0;
		this.radarTimer = 0;
		this.now = 0;
		this.lastTime = 0;
		this.fps = 0;
		this.fpsFrames = 0;
		this.fpsAccum = 0;
		this.reduceMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
		this.isTouch = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches) ||
			(('ontouchstart' in global) && (global.navigator.maxTouchPoints || 0) > 0);
		this.supportsLock = 'pointerLockElement' in doc && !!this.host.querySelector('[data-csr-canvas]').requestPointerLock;

		this.player = {
			x: C.PLAYER_SPAWN ? C.PLAYER_SPAWN.x : 0,
			z: C.PLAYER_SPAWN ? C.PLAYER_SPAWN.z : 31,
			feetY: 0, vy: 0, yaw: 0, pitch: 0,
			eye: 1.62, eyeTarget: 1.62, height: 1.78,
			alive: true, health: 100, armor: 0, onGround: true,
			speed: 0, vx: 0, vz: 0, bobPhase: 0, stepTimer: 0,
			deathRoll: 0, deathT: 0
		};
		this.input = {
			forward: 0, strafe: 0, fire: false, defuse: false,
			jumpQueued: false, crouch: false,
			touchMoveX: 0, touchMoveY: 0, touchCrouch: false
		};
		this.keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };
		this.recoilPitch = 0;
		this.recoilYaw = 0;
		this.shake = 0;
		this.swayX = 0;
		this.swayY = 0;
		this.weaponKick = 0;
		this.weaponKickRot = 0;
		this.reloading = false;
		this.reloadEnd = 0;
		this.reloadStart = 0;
		this.switching = 0;
		this.switchTo = null;
		this.nextFire = 0;
		this.semiQueued = false;
		this.currentWeapon = 'usp';
		this.currentSlot = 'secondary';
		this.loadout = { primary: null, secondary: 'usp', melee: 'knife' };
		this.ammo = {};
		this.scoped = false;
		this.scopeT = 0;
		this.flashUntil = 0;
		this.resultTimer = 0;
		this.resultReward = 0;
		this.deathTimer = 0;
		this.buyOpen = false;
		this.controlsFrom = 'menu';
		this.scoreboardOpen = false;
		this.gameTime = 0;
	}

	RangeGame.prototype.init = function () {
		var self = this;
		this.el = this.cacheEls();
		this.sound = new C.SoundEngine();
		this.sound.volume = clamp(Number(this.settings.volume), 0, 1);
		this.sound.muted = !!this.settings.muted;
		this.bindUI();

		if (!this.createRenderer()) return;
		try {
			this.createWorld();
			this.createView();
			this.applyQuality(this.settings.quality, true);
			this.buildRadarBase();
			this.drawMapPreview();
			this.syncSettingsUI();
			this.updateMenuStats();
			this.resetMatch();
			this.showMenu();
			this.applyLanguage();
			this.loadingDone();
			this.beginLoop();
		} catch (err) {
			console.error('[dust range] boot failed', err);
			this.fail('BOOT FAILED — ' + (err && err.message ? err.message : 'unknown error'));
		}
	};

	RangeGame.prototype.cacheEls = function () {
		var h = this.host;
		var e = {
			canvas: $(h, 'canvas'),
			loading: $(h, 'loading'),
			loadingHint: $(h, 'loading-hint'),
			menu: $(h, 'menu'),
			team: $(h, 'team'),
			joinCt: $(h, 'join-ct'),
			joinT: $(h, 'join-t'),
			teamBack: $(h, 'team-back'),
			deploy: $(h, 'deploy'),
			menuExit: $(h, 'menu-exit'),
			openControls: $(h, 'open-controls'),
			openSettings: $(h, 'open-settings'),
			settingsPanel: $(h, 'settings-panel'),
			mapPreview: $(h, 'map-preview'),
			menuHostiles: $(h, 'menu-hostiles'),
			language: $(h, 'language'),
			practice: $(h, 'practice'),
			practiceHud: $(h, 'practice-hud'),
			practiceScore: $(h, 'practice-score'),
			practiceHits: $(h, 'practice-hits'),
			practiceAcc: $(h, 'practice-acc'),
			practiceTargets: $(h, 'practice-targets'),
			difficultyAlly: $(h, 'difficulty-ally'),
			difficultyEnemy: $(h, 'difficulty-enemy'),
			quality: $(h, 'quality'),
			sens: $(h, 'sens'),
			sensValue: $(h, 'sens-value'),
			vol: $(h, 'vol'),
			volValue: $(h, 'vol-value'),
			best: $(h, 'best'),
			bestRounds: $(h, 'best-rounds'),
			bestKills: $(h, 'best-kills'),
			hud: $(h, 'hud'),
			radar: $(h, 'radar'),
			roundTimer: $(h, 'round-timer'),
			roundNo: $(h, 'round-no'),
			roundWord: $(h, 'round-word'),
			scoreCt: $(h, 'score-ct'),
			scoreT: $(h, 'score-t'),
			phaseLabel: $(h, 'phase-label'),
			pips: $(h, 'pips'),
			hostiles: $(h, 'hostiles'),
			hostileDots: $(h, 'hostile-dots'),
			hostileLabel: $(h, 'hostile-label'),
			allies: $(h, 'allies'),
			allyDots: $(h, 'ally-dots'),
			allyLabel: $(h, 'ally-label'),
			c4tag: $(h, 'c4tag'),
			kit: $(h, 'kit'),
			bombhud: $(h, 'bombhud'),
			bombTimer: $(h, 'bomb-timer'),
			bombSite: $(h, 'bomb-site'),
			bombBar: $(h, 'bomb-bar'),
			defuse: $(h, 'defuse'),
			defuseText: $(h, 'defuse-text'),
			defuseKitLabel: $(h, 'defuse-kit'),
			defuseBar: $(h, 'defuse-bar'),
			spectate: $(h, 'spectate'),
			spectateName: $(h, 'spectate-name'),
			spectateAlive: $(h, 'spectate-alive'),
			spectateHp: $(h, 'spectate-hp'),
			spectateAmmo: $(h, 'spectate-ammo'),
			contact: $(h, 'contact'),
			contactLabel: $(h, 'contact-label'),
			contactNote: $(h, 'contact-note'),
			killfeed: $(h, 'killfeed'),
			crosshair: $(h, 'crosshair'),
			hitmarker: $(h, 'hitmarker'),
			headshot: $(h, 'headshot'),
			headshotBonus: $(h, 'headshot-bonus'),
			deathcam: $(h, 'deathcam'),
			killer: $(h, 'killer'),
			deathType: $(h, 'death-type'),
			killerWeapon: $(h, 'killer-weapon'),
			deathTimerEl: $(h, 'death-timer'),
			dmgdir: $(h, 'dmgdir'),
			scope: $(h, 'scope'),
			scopeLabel: $(h, 'scope-label'),
			health: $(h, 'health'),
			healthbar: $(h, 'healthbar'),
			armor: $(h, 'armor'),
			money: $(h, 'money'),
			slot: $(h, 'slot'),
			weapon: $(h, 'weapon'),
			ammo: $(h, 'ammo'),
			reserve: $(h, 'reserve'),
			slotInds: [$(h, 'slot-ind'), h.querySelectorAll('[data-csr-slot-ind]')],
			announce: $(h, 'announce'),
			hintbar: $(h, 'hintbar'),
			useHint: $(h, 'use-hint'),
			buyhint: $(h, 'buyhint'),
			pickup: $(h, 'pickup'),
			pickupName: $(h, 'pickup-name'),
			pickupAmmo: $(h, 'pickup-ammo'),
			pickupHint: $(h, 'pickup-hint'),
			debug: $(h, 'debug'),
			flash: $(h, 'flash'),
			damage: $(h, 'damage'),
			toast: $(h, 'toast'),
			touch: $(h, 'touch'),
			stick: $(h, 'stick'),
			touchFire: $(h, 'touch-fire'),
			touchReload: $(h, 'touch-reload'),
			touchJump: $(h, 'touch-jump'),
			touchCrouch: $(h, 'touch-crouch'),
			touchUse: $(h, 'touch-use'),
			touchBuy: $(h, 'touch-buy'),
			touchPause: $(h, 'touch-pause'),
			touchScore: $(h, 'touch-score'),
			scoreClose: $(h, 'score-close'),
			buy: $(h, 'buy'),
			buyGrid: $(h, 'buy-grid'),
			buyMoney: $(h, 'buy-money'),
			buyKicker: $(h, 'buy-kicker'),
			buyTitle: $(h, 'buy-title'),
			buyNote: $(h, 'buy-note'),
			pause: $(h, 'pause'),
			resume: $(h, 'resume'),
			pauseControls: $(h, 'pause-controls'),
			pauseMute: $(h, 'pause-mute'),
			pauseExit: $(h, 'exit'),
			pauseRound: $(h, 'pause-round'),
			pauseKills: $(h, 'pause-kills'),
			pauseScore: $(h, 'pause-score'),
			result: $(h, 'result'),
			resultPanel: $(h, 'result-panel'),
			resultKicker: $(h, 'result-kicker'),
			resultTitle: $(h, 'result-title'),
			resultReason: $(h, 'result-reason'),
			resultScore: $(h, 'result-score'),
			resultKills: $(h, 'result-kills'),
			resultHs: $(h, 'result-hs'),
			resultAcc: $(h, 'result-acc'),
			resultReward: $(h, 'result-reward'),
			resultNext: $(h, 'result-next'),
			resultSkip: $(h, 'result-skip'),
			banner: $(h, 'banner'),
			bannerKicker: $(h, 'banner-kicker'),
			bannerTitle: $(h, 'banner-title'),
			bannerReason: $(h, 'banner-reason'),
			bannerScore: $(h, 'banner-score'),
			bannerReward: $(h, 'banner-reward'),
			bannerNext: $(h, 'banner-next'),
			scoreboard: $(h, 'scoreboard'),
			boardRound: $(h, 'board-round'),
			boardCt: $(h, 'board-ct'),
			boardT: $(h, 'board-t'),
			boardCtRows: $(h, 'board-ct-rows'),
			boardTRows: $(h, 'board-t-rows'),
			controls: $(h, 'controls'),
			match: $(h, 'match'),
			matchPanel: $(h, 'match-panel'),
			matchTitle: $(h, 'match-title'),
			matchCopy: $(h, 'match-copy'),
			matchCt: $(h, 'match-ct'),
			matchT: $(h, 'match-t'),
			matchRounds: $(h, 'match-rounds'),
			matchKills: $(h, 'match-kills'),
			matchHs: $(h, 'match-hs'),
			matchAcc: $(h, 'match-acc'),
			again: $(h, 'again'),
			matchExit: $(h, 'exit-match'),
			matchExitFallback: null,
			rotate: $(h, 'rotate')
		};
		e.buyCloses = $$(h, 'buy-close');
		e.controlsCloses = $$(h, 'controls-close');
		e.deploy = e.deploy || h.querySelector('[data-csr-deploy]');
		e.menuExit = e.menuExit || h.querySelector('[data-csr-menu-exit]');
		e.again = e.again || h.querySelector('[data-csr-again]');
		e.matchExit = e.matchExit || h.querySelector('[data-csr-exit-match]');
		e.pauseExit = e.pauseExit || h.querySelector('[data-csr-exit]');
		e.touchScope = h.querySelector('[data-csr-touch-scope]');
		return e;
	};

	RangeGame.prototype.on = function (target, type, fn, opts) {
		if (!target) return;
		target.addEventListener(type, fn, opts);
		this.listeners.push([target, type, fn, opts]);
	};
	RangeGame.prototype.offAll = function () {
		this.listeners.forEach(function (l) {
			try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) { /* ignore */ }
		});
		this.listeners.length = 0;
	};

	/* ======================================================================
	   UI wiring
	   ====================================================================== */
	RangeGame.prototype.bindUI = function () {
		var self = this;
		var e = this.el;

		this.on(e.deploy, 'click', function () { self.openTeamSelect(); });
		this.on(e.joinCt, 'click', function () { self.chooseTeam('CT'); });
		this.on(e.joinT, 'click', function () { self.chooseTeam('T'); });
		this.on(e.teamBack, 'click', function () { self.closeTeamSelect(); });
		this.on(e.practice, 'click', function () { self.startPractice(); });
		this.on(e.menuExit, 'click', function () { self.exitToGames(); });
		this.on(e.openControls, 'click', function () { self.openControls('menu'); });
		this.on(e.openSettings, 'click', function () {
			if (!e.settingsPanel) return;
			e.settingsPanel.scrollIntoView({ behavior: self.reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
			e.settingsPanel.classList.add('is-pulse');
			setTimeout(function () { e.settingsPanel.classList.remove('is-pulse'); }, 700);
		});

		[['difficultyAlly', e.difficultyAlly], ['difficultyEnemy', e.difficultyEnemy]].forEach(function (pair) {
			var key = pair[0], host = pair[1];
			if (!host) return;
			host.addEventListener('click', function (ev) {
				var b = ev.target.closest ? ev.target.closest('button[data-value]') : null;
				if (!b) return;
				self.settings[key] = b.getAttribute('data-value');
				self.syncSettingsUI();
				self.saveSettings();
			});
		});
		if (e.quality) {
			e.quality.addEventListener('click', function (ev) {
				var b = ev.target.closest ? ev.target.closest('button[data-value]') : null;
				if (!b) return;
				self.settings.quality = b.getAttribute('data-value');
				self.syncSettingsUI();
				self.saveSettings();
				self.applyQuality(self.settings.quality);
			});
		}
		if (e.sens) {
			e.sens.addEventListener('input', function () {
				self.settings.sens = Number(e.sens.value) || 1;
				if (e.sensValue) text(e.sensValue, self.settings.sens.toFixed(2));
				self.saveSettings();
			});
		}
		if (e.vol) {
			e.vol.addEventListener('input', function () {
				self.settings.volume = Number(e.vol.value);
				if (e.volValue) text(e.volValue, Math.round(self.settings.volume * 100) + '%');
				self.sound.ensure();
				self.sound.setVolume(self.settings.volume);
				self.saveSettings();
			});
		}

		/* close buttons (there are two in the buy overlay) */
		e.buyCloses.forEach(function (b) { self.on(b, 'click', function () { self.closeBuy(); }); });
		e.controlsCloses.forEach(function (b) { self.on(b, 'click', function () { self.closeControls(); }); });
		this.on(e.buyhint, 'click', function () { if (!self.buyOpen) self.openBuy(); });
		this.on(e.pickup, 'click', function () { self.pickupNearest(); });
		this.on(e.scoreClose, 'click', function () { self.closeScoreboard(); });

		if (e.buyGrid) {
			e.buyGrid.addEventListener('click', function (ev) {
				var item = ev.target.closest ? ev.target.closest('[data-buy-id]') : null;
				if (!item) return;
				self.buyItem(item.getAttribute('data-buy-id'));
			});
		}

		this.on(e.resume, 'click', function () { self.resume(); });
		this.on(e.pauseControls, 'click', function () { self.openControls('pause'); });
		this.on(e.pauseMute, 'click', function () { self.toggleMute(); });
		this.on(e.pauseExit, 'click', function () { self.exitToGames(); });
		this.on(e.resultSkip, 'click', function () { self.nextRound(true); });
		this.on(e.banner, 'click', function () { if (self.state === 'roundover') self.nextRound(true); });
		this.on(e.again, 'click', function () { self.playAgain(); });
		this.on(e.matchExit, 'click', function () { self.exitToGames(); });

		this.on(e.canvas, 'click', function () {
			if (self.state === 'playing' && !self.isTouch && !self.locked) self.requestLock();
		});
		this.on(e.canvas, 'contextmenu', function (ev) { ev.preventDefault(); });
		this.on(e.canvas, 'mousedown', function (ev) { self.onCanvasMouseDown(ev); });
		this.on(e.canvas, 'wheel', function (ev) { self.onWheel(ev); }, { passive: false });

		this.on(doc, 'mousemove', function (ev) { self.onMouseMove(ev); });
		this.on(doc, 'mouseup', function (ev) { self.onMouseUp(ev); });
		this.on(doc, 'pointerlockchange', function () { self.onPointerLockChange(); });
		this.on(doc, 'pointerlockerror', function () {
			self.enableFallbackLook();
		});
		this.on(global, 'keydown', function (ev) { self.onKeyDown(ev); }, true);
		this.on(global, 'keyup', function (ev) { self.onKeyUp(ev); }, true);
		this.on(global, 'resize', function () { self.onResize(); });
		this.on(global, 'blur', function () { if (self.state === 'playing') self.pause(); });
		this.on(doc, 'visibilitychange', function () {
			if (doc.hidden && self.state === 'playing') self.pause();
		});
		if (e.language) {
			this.on(e.language, 'change', function () {
				var loc = e.language.value;
				if (global.i18n && typeof global.i18n.setLocale === 'function') {
					global.i18n.setLocale(loc).then(function () { self.applyLanguage(); }, function () {
						if (global.CSRangeI18n) global.CSRangeI18n.setLocale(loc);
						self.applyLanguage();
					});
				} else if (global.CSRangeI18n) {
					global.CSRangeI18n.setLocale(loc);
					self.applyLanguage();
				}
			});
		}
		this.on(doc, 'i18n:applied', function () { self.applyLanguage(); });
		if (this.isTouch) this.setupTouch();
	};

	RangeGame.prototype.syncSettingsUI = function () {
		var s = this.settings;
		var e = this.el;
		[['difficultyAlly', e.difficultyAlly], ['difficultyEnemy', e.difficultyEnemy]].forEach(function (pair) {
			var key = pair[0], host = pair[1];
			if (!host) return;
			Array.prototype.forEach.call(host.querySelectorAll('button'), function (b) {
				b.classList.toggle('is-active', b.getAttribute('data-value') === s[key]);
			});
		});
		if (e.quality) {
			Array.prototype.forEach.call(e.quality.querySelectorAll('button'), function (b) {
				b.classList.toggle('is-active', b.getAttribute('data-value') === s.quality);
			});
		}
		if (e.sens) e.sens.value = String(s.sens);
		if (e.sensValue) text(e.sensValue, Number(s.sens).toFixed(2));
		if (e.vol) e.vol.value = String(s.volume);
		if (e.volValue) text(e.volValue, Math.round(Number(s.volume) * 100) + '%');
		if (e.menuHostiles) text(e.menuHostiles, '5 v 5');
	};

	RangeGame.prototype.saveSettings = function () {
		saveJSON(SETTINGS_KEY, this.settings);
	};

	RangeGame.prototype.updateMenuStats = function () {
		var r = this.records;
		if (this.el.best) text(this.el.best, r.bestWins ? r.bestWins + ' WINS' : '—');
		if (this.el.bestRounds) text(this.el.bestRounds, String(r.totalRounds || r.bestRounds || 0));
		if (this.el.bestKills) text(this.el.bestKills, String(r.bestKills || 0));
	};

	RangeGame.prototype.loadingDone = function () {
		var self = this;
		if (this.el.loading) {
			this.el.loading.classList.add('is-done');
			setTimeout(function () {
				if (self.el.loading) self.el.loading.hidden = true;
			}, 520);
		}
	};

	RangeGame.prototype.showMenu = function () {
		this.clearPractice();
		this.state = 'menu';
		doc.documentElement.classList.add('csr-lock');
		if (this.el.hud) this.el.hud.hidden = true;
		if (this.el.menu) this.el.menu.hidden = false;
		if (this.el.team) this.el.team.hidden = true;
		if (this.el.banner) this.el.banner.hidden = true;
		this.hideOverlays();
		if (this.el.loading) this.el.loading.hidden = true;
		this.releaseLock(true);
	};

	RangeGame.prototype.openTeamSelect = function () {
		if (!this.renderer) return;
		this.hideMenu();
		this.state = 'menu';
		if (this.el.team) this.el.team.hidden = false;
		if (this.el.loading) this.el.loading.hidden = true;
		this.releaseLock(true);
	};

	RangeGame.prototype.closeTeamSelect = function () {
		if (this.el.team) this.el.team.hidden = true;
		if (this.el.menu) this.el.menu.hidden = false;
		this.state = 'menu';
	};

	RangeGame.prototype.chooseTeam = function (team) {
		this.playerTeam = team === 'T' ? 'T' : 'CT';
		this.enemyTeam = this.playerTeam === 'CT' ? 'T' : 'CT';
		this.pendingTeam = this.playerTeam;
		if (this.el.team) this.el.team.hidden = true;
		this.startMatch();
	};

	RangeGame.prototype.hideMenu = function () {
		if (this.el.menu) this.el.menu.hidden = true;
	};

	RangeGame.prototype.hideOverlays = function () {
		var e = this.el;
		[e.buy, e.pause, e.result, e.scoreboard, e.controls, e.match, e.team, e.banner].forEach(function (n) {
			if (n) n.hidden = true;
		});
	};

	RangeGame.prototype.fail = function (message) {
		this.state = 'error';
		if (this.el.loadingHint) text(this.el.loadingHint, message);
		if (this.el.loading) {
			this.el.loading.hidden = false;
			this.el.loading.classList.remove('is-done');
			var btn = doc.createElement('a');
			btn.href = '#/games';
			btn.setAttribute('data-route', 'games');
			btn.className = 'csr-btn csr-btn--sm';
			btn.style.marginTop = '18px';
			btn.textContent = 'BACK TO GAMES';
			this.el.loading.appendChild(btn);
		}
	};

	/* ======================================================================
	   renderer / scenes
	   ====================================================================== */
	RangeGame.prototype.createRenderer = function () {
		if (!THREE || !C) {
			this.fail('THREE.JS OR GAME CONTENT FAILED TO LOAD');
			return false;
		}
		try {
			this.renderer = new THREE.WebGLRenderer({
				canvas: this.el.canvas,
				antialias: true,
				alpha: false,
				powerPreference: 'high-performance',
				stencil: false
			});
		} catch (err) {
			this.fail('WEBGL IS NOT AVAILABLE IN THIS BROWSER');
			return false;
		}
		this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.5));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.06;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.autoClear = false;

		var w = global.innerWidth, h = global.innerHeight;
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(74, w / h, 0.05, 500);
		this.camera.rotation.order = 'YXZ';
		this.menuCamera = new THREE.PerspectiveCamera(55, w / h, 0.1, 600);
		this.renderer.setSize(w, h, false);
		this.el.canvas.tabIndex = -1;
		return true;
	};

	RangeGame.prototype.createWorld = function () {
		var self = this;
		this.tex = C.makeTextures(this.renderer);
		this.world = C.createMap(this.scene, this.tex, this.renderer);
		this.nav = C.buildNav(this.world.colliders, this.world.bounds, 0.46);
		this.hitWorld = this.world.meshes.slice();
		if (C.buildPlayerBody) {
			this.playerBody = C.buildPlayerBody();
			this.playerBody.visible = false;
			this.scene.add(this.playerBody);
		}
		this.fxGroup = new THREE.Group();
		this.scene.add(this.fxGroup);
		this.decalGroup = new THREE.Group();
		this.scene.add(this.decalGroup);
		this.decalIndex = 0;
		this.tracerIndex = 0;
		this.sparkIndex = 0;
		this.shellIndex = 0;

		/* shared geometry for shells */
		this.shellGeo = new THREE.BoxGeometry(0.018, 0.018, 0.045);
		this.shellMat = new THREE.MeshStandardMaterial({ color: 0xc8a14f, roughness: 0.35, metalness: 0.9 });
		for (var i = 0; i < 18; i++) {
			var shell = new THREE.Mesh(this.shellGeo, this.shellMat);
			shell.visible = false;
			shell.castShadow = false;
			this.scene.add(shell);
			this.shells.push({ mesh: shell, life: 0, vx: 0, vy: 0, vz: 0, spin: 0 });
		}
		/* decal pool */
		var decalMat = new THREE.MeshBasicMaterial({
			map: this.tex.hole, transparent: true, opacity: 0.92,
			depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4
		});
		for (var d = 0; d < 56; d++) {
			var dec = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), decalMat);
			dec.visible = false;
			this.decalGroup.add(dec);
			this.decals.push(dec);
		}
		this.updateMenuCamera(0);
	};

	RangeGame.prototype.createView = function () {
		var w = global.innerWidth, h = global.innerHeight;
		this.viewScene = new THREE.Scene();
		this.viewCamera = new THREE.PerspectiveCamera(62, w / h, 0.01, 12);
		this.viewScene.add(new THREE.HemisphereLight(0xfff1da, 0x5a5248, 2.2));
		this.viewScene.add(new THREE.AmbientLight(0xfff6e8, 1.15));
		var key = new THREE.DirectionalLight(0xfff2dd, 2.8);
		key.position.set(-1.4, 2.4, 1.2);
		this.viewScene.add(key);
		var rim = new THREE.DirectionalLight(0xb9d2ec, 0.8);
		rim.position.set(1.6, 0.2, -1);
		this.viewScene.add(rim);
		this.flashLight = new THREE.PointLight(0xffb060, 0, 2.4, 2);
		this.viewScene.add(this.flashLight);

		this.viewWeapons = C.buildViewWeapons();
		this.weaponBase = {};
		var self = this;
		Object.keys(this.viewWeapons).forEach(function (id) {
			var m = self.viewWeapons[id];
			m.group.visible = false;
			/* Camera-space rig: the gun sits low and right, yawed toward the
			   centre so the side of the receiver and the muzzle are readable. */
			var rig = {
				usp:    { s: 0.52, x: 0.24, y: -0.24, z: -0.52, ry: 0.24, rx: 0.04, rz: 0.02 },
				p250:   { s: 0.52, x: 0.24, y: -0.24, z: -0.52, ry: 0.24, rx: 0.04, rz: 0.02 },
				deagle: { s: 0.52, x: 0.24, y: -0.24, z: -0.52, ry: 0.23, rx: 0.04, rz: 0.02 },
				ak47:   { s: 0.52, x: 0.25, y: -0.25, z: -0.50, ry: 0.22, rx: 0.03, rz: 0.01 },
				m4a4:   { s: 0.52, x: 0.25, y: -0.25, z: -0.50, ry: 0.22, rx: 0.03, rz: 0.01 },
				mp9:    { s: 0.54, x: 0.24, y: -0.24, z: -0.48, ry: 0.22, rx: 0.03, rz: 0.01 },
				ump45:  { s: 0.52, x: 0.25, y: -0.25, z: -0.50, ry: 0.22, rx: 0.03, rz: 0.01 },
				galil:  { s: 0.52, x: 0.25, y: -0.25, z: -0.50, ry: 0.22, rx: 0.03, rz: 0.01 },
				sg553:  { s: 0.50, x: 0.25, y: -0.24, z: -0.50, ry: 0.22, rx: 0.03, rz: 0.01 },
				ssg08:  { s: 0.49, x: 0.25, y: -0.24, z: -0.50, ry: 0.22, rx: 0.03, rz: 0.01 },
				nova:   { s: 0.51, x: 0.25, y: -0.25, z: -0.50, ry: 0.22, rx: 0.03, rz: 0.01 },
				awp:    { s: 0.49, x: 0.25, y: -0.24, z: -0.50, ry: 0.22, rx: 0.03, rz: 0.01 },
				knife:  { s: 0.55, x: 0.23, y: -0.23, z: -0.48, ry: 0.24, rx: 0.04, rz: 0.04 }
			}[id];
			if (rig) {
				m.group.scale.setScalar(rig.s);
				m.group.position.set(rig.x, rig.y, rig.z);
				m.group.rotation.set(rig.rx, rig.ry, rig.rz);
			} else {
				m.group.scale.setScalar(0.52);
			}
			self.weaponBase[id] = {
				pos: m.group.position.clone(),
				rot: m.group.rotation.clone(),
				scale: m.group.scale.x
			};
			self.viewScene.add(m.group);
		});
		this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
			map: this.tex.glow, color: 0xffd07a, transparent: true,
			blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
		}));
		this.flashSprite.scale.set(0.34, 0.34, 1);
		this.flashSprite.visible = false;
		this.flashSprite.renderOrder = 10;
		this.viewScene.add(this.flashSprite);

		this.equipWeapon('usp', true);
	};

	RangeGame.prototype.applyQuality = function (q, initial) {
		if (!this.renderer) return;
		var dpr = Math.min(global.devicePixelRatio || 1, q === 'high' ? 2 : q === 'balanced' ? 1.4 : 1);
		this.renderer.setPixelRatio(dpr);
		var shadows = q !== 'low';
		this.renderer.shadowMap.enabled = shadows;
		if (this.world && this.world.lights) {
			var sun = this.world.lights.sun;
			sun.castShadow = shadows;
			var size = q === 'high' ? 2048 : 1024;
			sun.shadow.mapSize.set(size, size);
			if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
			this.renderer.shadowMap.needsUpdate = true;
		}
		this.onResize();
	};

	RangeGame.prototype.onResize = function () {
		if (!this.renderer) return;
		this._overlayDrawn = false;
		var w = global.innerWidth || this.host.clientWidth || 1280;
		var h = global.innerHeight || this.host.clientHeight || 720;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.menuCamera.aspect = w / h;
		this.menuCamera.updateProjectionMatrix();
		if (this.viewCamera) {
			this.viewCamera.aspect = w / h;
			this.viewCamera.updateProjectionMatrix();
		}
	};

	/* ======================================================================
	   menu camera + map preview / radar
	   ====================================================================== */
	RangeGame.prototype.updateMenuCamera = function (dt) {
		if (!this.menuCamera) return;
		this.menuT += dt;
		var t = this.menuT * 0.035 + 0.6;
		var radius = 33;
		var cam = this.menuCamera;
		cam.position.set(Math.cos(t) * radius, 13.2 + Math.sin(this.menuT * 0.22) * 0.5, Math.sin(t) * radius);
		cam.lookAt(0, 1.2, -2);
	};

	RangeGame.prototype.topDownLayout = function (w, h) {
		var bounds = this.world ? this.world.bounds : 38;
		var size = Math.min(w, h) - 16;
		var scale = size / (bounds * 2);
		return { size: size, scale: scale, ox: (w - size) / 2, oy: (h - size) / 2, bounds: bounds };
	};

	RangeGame.prototype.paintTopDown = function (ctx, w, h, detailed) {
		var lay = this.topDownLayout(w, h);
		var s = lay.scale, ox = lay.ox, oy = lay.oy, B = lay.bounds;
		function X(x) { return ox + (x + B) * s; }
		function Y(z) { return oy + (z + B) * s; }

		ctx.clearRect(0, 0, w, h);
		var bg = ctx.createLinearGradient(0, 0, 0, h);
		bg.addColorStop(0, '#0a1118');
		bg.addColorStop(1, '#06090c');
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);

		/* grid */
		ctx.strokeStyle = detailed ? 'rgba(215,162,74,0.09)' : 'rgba(215,162,74,0.07)';
		ctx.lineWidth = 1;
		for (var gx = -B; gx <= B; gx += 8) {
			ctx.beginPath(); ctx.moveTo(X(gx), Y(-B)); ctx.lineTo(X(gx), Y(B)); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(X(-B), Y(gx)); ctx.lineTo(X(B), Y(gx)); ctx.stroke();
		}

		var world = this.world;
		if (world && world.grid) {
			var grid = world.grid, GS = grid.size, gm = grid.min;
			ctx.fillStyle = detailed ? 'rgba(196,168,124,0.34)' : 'rgba(186,160,120,0.30)';
			for (var gz = 0; gz < GS; gz++) {
				for (var gx = 0; gx < GS; gx++) {
					if (!grid.cells[gz * GS + gx]) continue;
					ctx.fillRect(X(gm + gx), Y(gm + gz), s + 0.4, s + 0.4);
				}
			}
			/* crisp outline along every footprint edge */
			ctx.strokeStyle = detailed ? 'rgba(215,162,74,0.5)' : 'rgba(215,162,74,0.4)';
			ctx.lineWidth = detailed ? 1.2 : 1;
			ctx.beginPath();
			for (var oz = 0; oz < GS; oz++) {
				for (var ox = 0; ox < GS; ox++) {
					if (!grid.cells[oz * GS + ox]) continue;
					var wx0 = gm + ox, wz0 = gm + oz;
					if (ox === 0 || !grid.cells[oz * GS + ox - 1]) { ctx.moveTo(X(wx0), Y(wz0)); ctx.lineTo(X(wx0), Y(wz0 + 1)); }
					if (ox === GS - 1 || !grid.cells[oz * GS + ox + 1]) { ctx.moveTo(X(wx0 + 1), Y(wz0)); ctx.lineTo(X(wx0 + 1), Y(wz0 + 1)); }
					if (oz === 0 || !grid.cells[(oz - 1) * GS + ox]) { ctx.moveTo(X(wx0), Y(wz0)); ctx.lineTo(X(wx0 + 1), Y(wz0)); }
					if (oz === GS - 1 || !grid.cells[(oz + 1) * GS + ox]) { ctx.moveTo(X(wx0), Y(wz0 + 1)); ctx.lineTo(X(wx0 + 1), Y(wz0 + 1)); }
				}
			}
			ctx.stroke();
		}

		/* solid cover and building edges */
		var cols = world ? world.colliders : [];
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (c.minY > 2.4) continue;
			var hgt = c.maxY - c.minY;
			ctx.fillStyle = hgt > 2.4 ? 'rgba(4,8,10,0.82)' : hgt > 1.3 ? 'rgba(31,43,45,0.85)' : 'rgba(215,162,74,0.45)';
			ctx.fillRect(X(c.minX), Y(c.minZ), Math.max(1, (c.maxX - c.minX) * s), Math.max(1, (c.maxZ - c.minZ) * s));
		}

		/* bomb sites */
		if (world && world.sites) {
			world.sites.forEach(function (site) {
				ctx.strokeStyle = 'rgba(212,89,67,0.8)';
				ctx.lineWidth = detailed ? 2 : 1.2;
				ctx.beginPath();
				ctx.arc(X(site.x), Y(site.z), site.r * s, 0, Math.PI * 2);
				ctx.stroke();
				ctx.fillStyle = 'rgba(212,89,67,0.9)';
				ctx.font = '700 ' + Math.max(10, Math.round(18 * s / 4.3)) + 'px Bahnschrift, Arial Narrow, sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(site.id, X(site.x), Y(site.z));
			});
		}

		/* spawn markers */
		if (world && world.spawns) {
			var ct = world.spawns.ct && world.spawns.ct[0];
			var t = world.spawns.t && world.spawns.t[0];
			if (ct) {
				ctx.fillStyle = 'rgba(111,159,216,0.9)';
				ctx.beginPath();
				ctx.arc(X(ct.x), Y(ct.z), 4, 0, Math.PI * 2);
				ctx.fill();
			}
			if (t) {
				ctx.fillStyle = 'rgba(217,164,65,0.9)';
				ctx.beginPath();
				ctx.arc(X(t.x), Y(t.z), 4, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		/* callouts on the large map card */
		if (detailed && world && world.callouts) {
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			for (var k = 0; k < world.callouts.length; k++) {
				var co = world.callouts[k];
				ctx.fillStyle = co.big ? 'rgba(232,226,212,0.72)' : 'rgba(232,226,212,0.4)';
				ctx.font = (co.big ? '700 10px ' : '700 8px ') + 'Bahnschrift, Arial Narrow, sans-serif';
				ctx.fillText(co.name, X(co.x), Y(co.z));
			}
		}

		/* compass */
		ctx.fillStyle = 'rgba(232,226,212,0.45)';
		ctx.font = '9px Consolas, monospace';
		ctx.textAlign = 'center';
		ctx.fillText('N', X(0), Y(-B) - 4);
	};

	RangeGame.prototype.drawMapPreview = function () {
		var c = this.el.mapPreview;
		if (!c) return;
		var ctx = c.getContext('2d');
		this.paintTopDown(ctx, c.width, c.height, true);
		ctx.fillStyle = 'rgba(232,226,212,0.3)';
		ctx.font = '9px Consolas, monospace';
		ctx.textAlign = 'right';
		ctx.fillText('80 × 80 M · DE_DUST2', c.width - 16, 24);
	};

	RangeGame.prototype.buildRadarBase = function () {
		var c = doc.createElement('canvas');
		c.width = this.el.radar ? this.el.radar.width : 360;
		c.height = this.el.radar ? this.el.radar.height : 360;
		this.radarBase = c;
		this.paintTopDown(c.getContext('2d'), c.width, c.height, false);
	};

	RangeGame.prototype.drawRadar = function () {
		var canvas = this.el.radar;
		if (!canvas || !this.radarBase) return;
		var ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(this.radarBase, 0, 0);
		var lay = this.topDownLayout(canvas.width, canvas.height);
		var B = lay.bounds, s = lay.scale, ox = lay.ox, oy = lay.oy;
		var now = this.now;
		var px = ox + (this.player.x + B) * s;
		var py = oy + (this.player.z + B) * s;

		/* view cone */
		if (this.player.alive) {
			ctx.save();
			ctx.translate(px, py);
			ctx.rotate(-this.player.yaw);
			var grad = ctx.createLinearGradient(0, 0, 0, -70);
			grad.addColorStop(0, 'rgba(232,226,212,0.22)');
			grad.addColorStop(1, 'rgba(232,226,212,0)');
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(-38, -72);
			ctx.lineTo(38, -72);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}

		/* teammates, then hostiles (dim unless a CT has spotted them) */
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (!b || (!b.alive && b.deathT > 0.8)) continue;
			var bx = ox + (b.x + B) * s;
			var by = oy + (b.z + B) * s;
			if (b.team === this.playerTeam) {
				ctx.fillStyle = b.alive ? 'rgba(104,178,255,0.95)' : 'rgba(104,178,255,0.25)';
				ctx.beginPath();
				ctx.arc(bx, by, b.alive ? 3.1 : 2, 0, Math.PI * 2);
				ctx.fill();
			} else {
				var spotted = b.spottedUntil > now;
				ctx.fillStyle = b.alive ? (spotted ? 'rgba(224,88,62,0.98)' : 'rgba(214,110,90,0.45)') : 'rgba(224,88,62,0.2)';
				ctx.beginPath();
				ctx.arc(bx, by, b.alive ? (spotted ? 3.4 : 2.4) : 1.8, 0, Math.PI * 2);
				ctx.fill();
				if (b.alive && spotted) {
					ctx.strokeStyle = 'rgba(224,88,62,0.4)';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.arc(bx, by, 5.6, 0, Math.PI * 2);
					ctx.stroke();
				}
			}
		}

		/* the objective */
		var bomb = this.bomb;
		if (bomb && (bomb.state === 'planted' || bomb.state === 'dropped')) {
			var mx = ox + (bomb.x + B) * s;
			var my = oy + (bomb.z + B) * s;
			var pulse = 0.5 + 0.5 * Math.sin(now * 0.012);
			ctx.fillStyle = bomb.state === 'planted' ? 'rgba(255,72,42,' + (0.55 + pulse * 0.45) + ')' : 'rgba(255,196,90,0.9)';
			ctx.fillRect(mx - 3.5, my - 3.5, 7, 7);
			ctx.strokeStyle = 'rgba(255,92,52,0.55)';
			ctx.lineWidth = 1;
			ctx.strokeRect(mx - 6, my - 6, 12, 12);
			if (bomb.state === 'planted') {
				ctx.font = '700 9px Consolas, monospace';
				ctx.textAlign = 'center';
				ctx.fillStyle = 'rgba(255,120,90,0.9)';
				ctx.fillText('C4', mx, my - 9);
			}
		}

		var alert = this.teamAlerts && this.teamAlerts[this.playerTeam];
		if (alert && now - alert.seenAt < 6000) {
			var ax = ox + (alert.x + B) * s;
			var ay = oy + (alert.z + B) * s;
			var pulse = 0.5 + 0.5 * Math.sin(now * 0.01);
			ctx.strokeStyle = 'rgba(255, 196, 90, ' + (0.35 + pulse * 0.45) + ')';
			ctx.lineWidth = 1.4;
			ctx.beginPath();
			ctx.arc(ax, ay, 6 + pulse * 5, 0, Math.PI * 2);
			ctx.stroke();
			ctx.fillStyle = 'rgba(255, 210, 122, 0.9)';
			ctx.beginPath();
			ctx.arc(ax, ay, 2.2, 0, Math.PI * 2);
			ctx.fill();
		}

		/* weapon drops */
		for (var di = 0; di < this.drops.length; di++) {
			var dr = this.drops[di];
			var dxp = ox + (dr.x + B) * s;
			var dzp = oy + (dr.z + B) * s;
			ctx.fillStyle = 'rgba(255,205,110,0.95)';
			ctx.fillRect(dxp - 2, dzp - 2, 4, 4);
			ctx.strokeStyle = 'rgba(255,205,110,0.3)';
			ctx.strokeRect(dxp - 4, dzp - 4, 8, 8);
		}

		/* player arrow */
		if (this.player.alive) {
			ctx.save();
			ctx.translate(px, py);
			ctx.rotate(-this.player.yaw);
			ctx.fillStyle = '#f2ead8';
			ctx.beginPath();
			ctx.moveTo(0, -7);
			ctx.lineTo(5, 5);
			ctx.lineTo(0, 2.5);
			ctx.lineTo(-5, 5);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}
	};

	/* ======================================================================
	   match / round lifecycle
	   ====================================================================== */
	RangeGame.prototype.focusField = function () {
		if (!this.el.canvas) return;
		try { this.el.canvas.focus({ preventScroll: true }); } catch (e) { try { this.el.canvas.focus(); } catch (e2) {} }
	};

	RangeGame.prototype.resetMatch = function () {
		this.match = {
			round: 1, ct: 0, t: 0, kills: 0, deaths: 0, hs: 0,
			shots: 0, hits: 0, money: 800, started: 0, lossStreak: 0
		};
		this.roundHistory = [];
		this.loadout = { primary: null, secondary: 'usp', melee: 'knife' };
		this.ammo = {};
		Object.keys(C.WEAPONS).forEach(function (id) { this.ammo[id] = { mag: C.WEAPONS[id].mag, reserve: C.WEAPONS[id].reserve }; }, this);
		this.player.health = 100;
		this.player.armor = 0;
		this.player.alive = true;
		this.playerDiedLastRound = false;
		this.playerWasKilledLastRound = false;
		this.defuseKit = false;
		this.spectating = false;
		this.playerDefusing = false;
		this.bomb = null;
		this.hideSpectate();
		this.matchStartedAt = this.now;
		this.equipWeapon('usp', true);
		this.updateScoreHUD();
	};

	RangeGame.prototype.startMatch = function () {
		if (!this.renderer) return;
		this.clearPractice();
		this.sound.ensure();
		this.sound.setVolume(this.settings.volume);
		this.hideMenu();
		if (this.el.team) this.el.team.hidden = true;
		this.hideOverlays();
		if (this.el.hud) this.el.hud.hidden = false;
		this.resetMatch();
		this.startRound(true);
		this.focusField();
		if (!this.isTouch) this.requestLock();
		if (this.isTouch && this.el.touch) this.el.touch.hidden = false;
	};

	RangeGame.prototype.setPracticeChrome = function (on) {
		this.practice = !!on;
		if (this.el.hud) this.el.hud.classList.toggle('is-practice', !!on);
		if (this.el.practiceHud) this.el.practiceHud.hidden = !on;
		text(this.el.buyKicker, on ? 'ARMORY // PRACTICE RANGE' : 'ARMORY // BUY PHASE');
		text(this.el.buyTitle, on ? 'FREE ARMORY' : 'BUY MENU');
		text(this.el.buyNote, on ? 'FREE SWAP · INFINITE RESERVE' : 'PURCHASES ARE FINAL FOR THIS ROUND');
	};

	RangeGame.prototype.clearPractice = function () {
		this.practice = false;
		this.setPracticeChrome(false);
		this.clearTargets();
		this.clearChickens();
		this.hideDeathCam();
		this.hideSpectate();
		if (this.el.hud) this.el.hud.classList.remove('is-dead', 'is-spectating');
	};

	RangeGame.prototype.startPractice = function () {
		if (!this.renderer) return;
		this.clearPractice();
		this.sound.ensure();
		this.sound.setVolume(this.settings.volume);
		this.hideMenu();
		this.hideOverlays();
		this.clearBots();
		this.clearDrops();
		this.clearBomb();
		this.clearFx();
		this.bomb = null;
		this.defuseKit = false;
		this.playerDefusing = false;
		this.spectating = false;
		this.teamAlerts = { CT: null, T: null };
		this.gamblers = { CT: null, T: null };
		this.gambleNextAt = { CT: 0, T: 0 };
		this.recentDeaths = { CT: [], T: [] };
		this.panicUntil = { CT: 0, T: 0 };
		this.teamReplanAt = { CT: 0, T: 0 };
		this.teamReplan = { CT: null, T: null };
		/* morale carries a little between rounds, but a fresh round cools it */
		if (this.teamFear) {
			this.teamFear.CT = clamp(this.teamFearValue('CT') * 0.55, 0, 1);
			this.teamFear.T = clamp(this.teamFearValue('T') * 0.55, 0, 1);
			this.aiMemory.teamFear.CT = this.teamFear.CT;
			this.aiMemory.teamFear.T = this.teamFear.T;
		}
		this.contactAlert = null;
		if (this.el.contact) this.el.contact.hidden = true;
		if (this.el.kit) this.el.kit.hidden = true;
		if (this.el.hud) this.el.hud.classList.remove('is-dead', 'is-spectating');
		if (this.el.killfeed) { this.el.killfeed.innerHTML = ''; this.killFeed.length = 0; }
		this.state = 'playing';
		this.buyOpen = false;
		this.scoreboardOpen = false;
		this.match = {
			round: 1, ct: 0, t: 0, kills: 0, deaths: 0, hs: 0,
			shots: 0, hits: 0, money: 16000, started: this.now
		};
		this.round = { phase: 'live', timer: 9999, freezeLeft: 0, ended: false };
		this.roundStats = { kills: 0, hs: 0, shots: 0, hits: 0 };
		this.practiceStats = { score: 0, hits: 0, targets: 0, centers: 0 };
		this.loadout = { primary: null, secondary: 'usp', melee: 'knife' };
		this.ammo = {};
		Object.keys(C.WEAPONS).forEach(function (id) {
			this.ammo[id] = { mag: C.WEAPONS[id].mag, reserve: 999 };
		}, this);
		var p = this.player;
		p.x = C.PRACTICE_SPAWN.x;
		p.z = C.PRACTICE_SPAWN.z;
		p.feetY = 0; p.vy = 0; p.vx = 0; p.vz = 0;
		p.yaw = 0; p.pitch = 0;
		p.alive = true; p.health = 100; p.armor = 100; p.onGround = true;
		p.eye = 1.62; p.eyeTarget = 1.62; p.height = 1.78;
		p.deathT = 0; p.deathRoll = 0;
		this.deathInfo = null;
		this.deathTimer = 0;
		this.recoilPitch = 0; this.recoilYaw = 0; this.shake = 0;
		this.reloading = false; this.scoped = false; this.scopeT = 0;
		this.input.fire = false; this.semiQueued = false;
		this.keys.ctrl = false;
		this.currentWeapon = 'usp';
		this.currentSlot = 'secondary';
		this.equipWeapon('usp', true);
		this.setPracticeChrome(true);
		if (this.el.hud) this.el.hud.hidden = false;
		if (this.el.touch && this.isTouch) this.el.touch.hidden = false;
		this.hideDeathCam();
		this.spawnTargets();
		this.spawnChickens(6);
		this.updateRoundNo();
		this.updateScoreHUD();
		this.updateHostiles();
		this.updateVitalsHUD();
		this.updateAmmoHUD();
		this.updateHUD();
		this.updatePracticeHUD();
		this.updateBuyHint();
		this.announce('PRACTICE RANGE', 'SHOOT THE TARGETS — B OPENS THE FREE ARMORY');
		this.sound.roundStart();
		this.focusField();
		if (!this.isTouch) this.requestLock();
	};

	RangeGame.prototype.updatePractice = function (dt) {
		this.updatePlayer(dt);
		this.updateWeapon(dt);
		this.updateChickens(dt);
		this.updateTargets(dt);
		this.updateFx(dt);
		this.updateRoundTimer();
		this.updateVitalsHUD();
		this.updateAmmoHUD();
		this.updateCrosshair();
		this.updatePracticeHUD();
		this.updateBuyHint();
	};

	RangeGame.prototype.updatePracticeHUD = function () {
		if (!this.el.practiceHud) return;
		var s = this.practiceStats || {};
		var shots = this.match ? this.match.shots : 0;
		var hits = this.match ? this.match.hits : 0;
		var acc = shots > 0 ? Math.round(hits / shots * 100) : 0;
		text(this.el.practiceScore, s.score || 0);
		text(this.el.practiceHits, hits);
		text(this.el.practiceAcc, acc + '%');
		text(this.el.practiceTargets, s.targets || 0);
	};

	RangeGame.prototype.teamBots = function (team, aliveOnly) {
		var out = [];
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.team !== team) continue;
			if (aliveOnly && (!b.alive || b.dead)) continue;
			out.push(b);
		}
		return out;
	};

	RangeGame.prototype.aliveTeamCount = function (team) {
		var n = 0;
		if (team === this.playerTeam && this.player && this.player.alive) n++;
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.team === team && b.alive && !b.dead) n++;
		}
		return n;
	};

	RangeGame.prototype.teamAdvantage = function (team) {
		var enemyTeam = team === 'CT' ? 'T' : 'CT';
		var allies = this.aliveTeamCount(team);
		var enemies = this.aliveTeamCount(enemyTeam);
		return enemies > 0 && allies > enemies && (enemies <= 2 || allies - enemies >= 2);
	};

	RangeGame.prototype.criticalRole = function (bot) {
		var b = this.bomb;
		if (!b) return false;
		if (b.state === 'planted' && b.defuser === bot) return true;
		if (b.state === 'planting' && b.planter === bot) return true;
		if (bot.planting) return true;
		return false;
	};

	RangeGame.prototype.bombRecoveryRank = function (bot) {
		var b = this.bomb;
		if (!b || b.state !== 'dropped' || bot.team !== 'T') return -1;
		var list = this.teamBots('T', true).slice();
		list.sort(function (a, c) {
			return Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z);
		});
		return list.indexOf(bot);
	};

	RangeGame.prototype.huntPointFor = function (bot) {
		var now = this.now;
		var alert = this.teamAlerts && this.teamAlerts[bot.team];
		if (alert && now - alert.seenAt < 12000) return { x: alert.x, z: alert.z };
		var best = null, bestT = -1;
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.team !== bot.team || !b.alive || b.dead) continue;
			if (!b.lastSeen || now - b.lastSeen.t > 10000) continue;
			if (b.lastSeen.t > bestT) { bestT = b.lastSeen.t; best = { x: b.lastSeen.x, z: b.lastSeen.z }; }
		}
		if (best) return best;
		return null;
	};

	RangeGame.prototype.botHunt = function (bot, dt) {
		if (this.teamFearValue(bot.team) > 0.55) return false;
		if (!this.teamAdvantage(bot.team)) return false;
		if (this.criticalRole(bot)) return false;
		/* Never abandon an active plant/defuse for a hunt. */
		if (this.bomb && (this.bomb.state === 'planted' || this.bomb.state === 'planting')) return false;
		/* Keep the two closest T robots on a dropped C4 even while the rest
		   push the advantage. */
		if (this.bomb && this.bomb.state === 'dropped' && bot.team === 'T' &&
			this.bombRecoveryRank(bot) >= 0 && this.bombRecoveryRank(bot) < 2) return false;
		var pt = this.huntPointFor(bot);
		if (!pt) return false;
		/* Do not beeline into an unreachable pocket: only hunt a contact the
		   navmesh can actually reach. */
		var hp = this.snapFreePoint(pt.x, pt.z, 0.46);
		if (!bot.huntCheck || this.now - bot.huntCheck > 1500 ||
			!bot.huntPoint || Math.hypot(bot.huntPoint.x - hp.x, bot.huntPoint.z - hp.z) > 3) {
			var probe = C.findPath(this.nav, bot.x, bot.z, hp.x, hp.z);
			bot.huntCheck = this.now;
			bot.huntPoint = hp;
			bot.huntPathOk = !!(probe && probe.length);
		}
		if (!bot.huntPathOk) return false;
		pt = bot.huntPoint;
		var d = Math.hypot(pt.x - bot.x, pt.z - bot.z);
		bot.mode = 'hunt';
		if (d > 3.6) {
			this.botPathTo(bot, pt.x, pt.z, bot.speed * 1.08, dt);
			return true;
		}
		bot.moveX = 0;
		bot.moveZ = 0;
		var scan = Math.sin(this.now * 0.0011 + bot.scanPhase) * 3.2;
		bot.face = { x: pt.x + scan, z: pt.z + scan };
		if (this.now > (bot.huntRoamAt || 0)) {
			bot.huntRoamAt = this.now + 2200;
			bot.roamTarget = this.pickRoamPoint(bot, pt);
			bot.roamNextAt = 0;
		}
		if (bot.roamTarget && this.botMaybeRoam(bot, pt, dt)) return true;
		return true;
	};

	RangeGame.prototype.botGrouping = function (bot, dt) {
		var bias = (this.aiMemory && this.aiMemory.groupBias && this.aiMemory.groupBias[bot.team]) || 0;
		bias = Math.max(bias, this.teamFearValue(bot.team) * 0.65);
		var plan = (bot.diff && bot.diff.planning) || 0.5;
		var threshold = 0.16 + (1 - plan) * 0.24;
		if (bias <= threshold) return false;
		if (bot.planting || bot.hasBomb || this.criticalRole(bot)) return false;
		if (this.bomb && (this.bomb.state === 'planted' || this.bomb.state === 'planting')) return false;
		if (this.bomb && this.bomb.state === 'dropped') {
			var rank = this.bombRecoveryRank(bot);
			if (rank >= 0 && rank < 3) return false;
		}
		var nearest = null, nd = 1e9;
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b === bot || b.team !== bot.team || !b.alive || b.dead) continue;
			var d = Math.hypot(b.x - bot.x, b.z - bot.z);
			if (d < nd) { nd = d; nearest = b; }
		}
		if (this.player.alive && this.playerTeam === bot.team) {
			var pd = Math.hypot(this.player.x - bot.x, this.player.z - bot.z);
			if (pd < nd) { nd = pd; nearest = { x: this.player.x, z: this.player.z, player: true }; }
		}
		if (!nearest || nd < 7.2 || nd > 30) return false;
		this.botPathTo(bot, nearest.x, nearest.z, bot.speed * 0.96, dt);
		bot.mode = 'regroup';
		return true;
	};

	RangeGame.prototype.botHearObjective = function (bot, dt) {
		var h = bot.lastHeard;
		if (!h) return false;
		if (this.now - h.t > 5000) { bot.lastHeard = null; return false; }
		if (bot.planting || this.criticalRole(bot)) return false;
		if (bot.hasBomb && bot.atSite) return false;
		var d = Math.hypot(h.x - bot.x, h.z - bot.z);
		bot.mode = 'listen';
		if (d > 3.3) {
			this.botPathTo(bot, h.x, h.z, bot.speed * 0.9, dt);
		} else {
			bot.moveX = 0;
			bot.moveZ = 0;
			bot.face = { x: h.x, z: h.z };
		}
		return true;
	};

	RangeGame.prototype.teamTypes = function (team) {
		return team === 'CT'
			? ['trooper', 'heavy', 'scout', 'sniper']
			: ['trooper', 'trooper', 'scout', 'heavy', 'sniper'];
	};

	RangeGame.prototype.findOpenSpawn = function (pos, seed) {
		if (!this.collidesBot(pos.x, pos.z, 0.46)) return { x: pos.x, z: pos.z, yaw: pos.yaw || 0 };
		for (var r = 1; r <= 4; r++) {
			for (var a = 0; a < 12; a++) {
				var ang = (a / 12) * Math.PI * 2 + (seed || 0);
				var x = pos.x + Math.cos(ang) * r;
				var z = pos.z + Math.sin(ang) * r;
				if (this.world.walkableAt ? this.world.walkableAt(x, z) : true) {
					if (!this.collidesBot(x, z, 0.46)) return { x: x, z: z, yaw: pos.yaw || 0 };
				}
			}
		}
		return { x: pos.x, z: pos.z, yaw: pos.yaw || 0 };
	};

	RangeGame.prototype.snapFreePoint = function (x, z, r) {
		r = r || 0.46;
		if (this.world.walkableAt(x, z) && !this.collidesBot(x, z, r)) return { x: x, z: z };
		for (var ring = 1; ring <= 16; ring++) {
			var rad = ring * 0.5;
			for (var a = 0; a < 16; a++) {
				var ang = (a / 16) * Math.PI * 2 + (ring % 2 ? 0.19 : 0);
				var px = x + Math.cos(ang) * rad;
				var pz = z + Math.sin(ang) * rad;
				if (this.world.walkableAt(px, pz) && !this.collidesBot(px, pz, r)) return { x: px, z: pz };
			}
		}
		return { x: x, z: z };
	};

	RangeGame.prototype.spawnTeam = function (team, count) {
		var spawnList = this.world.spawns[team === 'CT' ? 'ct' : 't'] || [];
		var types = this.teamTypes(team);
		var startAt = team === this.playerTeam ? 1 : 0;
		for (var i = 0; i < count; i++) {
			var raw = spawnList[(startAt + i) % spawnList.length] || { x: 0, z: 0 };
			var pos = this.findOpenSpawn(raw, i * 0.7);
			var typeId = types[i % types.length];
			if (team === 'T' && i === 0) typeId = 'trooper';
			var bot = this.spawnBot(typeId, pos, team, i);
			bot.spawnIndex = i;
		}
	};

	RangeGame.prototype.startRound = function (first) {
		var self = this;
		this.practice = false;
		this.setPracticeChrome(false);
		this.clearTargets();
		this.hideDeathCam();
		this.hideSpectate();
		if (!first) this.match.round++;
		this.clearBots();
		this.clearDrops();
		this.clearBomb();
		this.clearFx();
		this.clearChickens();
		this.bomb = {
			state: 'carried', carrier: null, planter: null, defuser: null,
			x: 0, z: 0, site: null, fuse: 0, plantProgress: 0,
			defuseProgress: 0, playerDefuseProgress: 0,
			beepTimer: 0, ledPhase: 0, teamDefuseTime: 7
		};
		this.round = {
			phase: 'freeze', timer: 115, freezeLeft: 10.0,
			ended: false
		};
		this.roundStats = { kills: 0, hs: 0, shots: 0, hits: 0 };
		this.state = 'playing';
		this.resultReward = 0;
		this.playerHasBomb = false;
		this.playerPlanting = false;
		this.playerPlantProgress = 0;
		this.playerDefusing = false;
		this.spectating = false;
		this.spectateTarget = null;
		this.teamAlerts = { CT: null, T: null };
		this.contactAlert = null;
		if (this.el.contact) this.el.contact.hidden = true;
		this.playerDiedLastRound = false;
		var lostLoadout = !first && this.playerWasKilledLastRound;
		this.playerWasKilledLastRound = false;
		this.updateRoundNo();
		this.updateScoreHUD();
		this.updatePips();
		if (this.el.hud) {
			this.el.hud.hidden = false;
			this.el.hud.classList.remove('is-dead', 'is-spectating');
		}

		/* player respawn — the player is the fifth counter-terrorist */
		var p = this.player;
		var mySpawns = this.world.spawns[this.playerTeam === 'T' ? 't' : 'ct'] || [];
		var spawn = mySpawns[0] || C.PLAYER_SPAWN || { x: 0, z: 0 };
		p.x = spawn.x; p.z = spawn.z;
		p.yaw = (spawn.yaw || 0) + Math.PI;
		p.feetY = 0; p.vy = 0; p.vx = 0; p.vz = 0;
		p.pitch = 0;
		p.alive = true; p.health = 100; p.onGround = true;
		p.deathRoll = 0; p.deathT = 0;
		p.eye = 1.62; p.eyeTarget = 1.62; p.height = 1.78;
		this.recoilPitch = 0; this.recoilYaw = 0; this.shake = 0;
		this.reloading = false; this.scoped = false; this.scopeT = 0;
		this.input.fire = false; this.input.crouch = false; this.input.defuse = false; this.semiQueued = false;
		this.playerHasBomb = false;
		this.playerPlanting = false;
		this.playerPlantProgress = 0;
		this.keys.ctrl = false;
		this.deathTimer = 0;
		this.hideOverlays();
		if (this.el.hud) this.el.hud.hidden = false;

		/* dying loses the loadout; surviving keeps weapons, armour and the kit */
		if (first || lostLoadout || !this.loadout.secondary) {
			this.loadout = { primary: null, secondary: 'usp', melee: 'knife' };
			Object.keys(C.WEAPONS).forEach(function (id) {
				this.ammo[id] = { mag: C.WEAPONS[id].mag, reserve: C.WEAPONS[id].reserve };
			}, this);
			p.armor = 0;
			this.defuseKit = false;
			this.equipWeapon('usp', true);
		} else {
			var spent = this.ammo[this.currentWeapon];
			if (spent && spent.mag <= 0 && spent.reserve <= 0) this.equipWeapon(this.loadout.secondary, true);
			else this.equipWeapon(this.currentWeapon, true);
		}
		this.updateAmmoHUD();
		this.updateVitalsHUD();

		/* 5 v 5: the player fills one slot on the chosen side */
		this.usedBotNames = {};
		this.botSeq = this.botSeq || 0;
		this.spawnTeam('CT', this.playerTeam === 'CT' ? 4 : 5);
		this.spawnTeam('T', this.playerTeam === 'T' ? 4 : 5);
		this.setupRoundPlans();

		this.spawnChickens(5);
		this.updateHostiles();
		this.updateBuyHint();
		this.updateScoreHUD();
		this.updatePips();
		this.updateBombHUD();
		if (this.el.killfeed) { this.el.killfeed.innerHTML = ''; this.killFeed.length = 0; }
		this.announce('ROUND ' + this.match.round, this.playerTeam === 'T' ? 'TAKE A SITE — PRESS B TO OPEN THE ARMORY' : 'BUY TIME — PRESS B TO OPEN THE ARMORY');
		this.sound.roundStart();
		this.updateHUD();
		this.focusField();
	};

	RangeGame.prototype.setupRoundPlans = function () {
		var self = this;
		var site = Math.random() < 0.5 ? 'A' : 'B';
		this.tSite = site;
		var tRoutes = this.world.routes[site] || this.world.routes.A;
		var tBots = this.teamBots('T', true);
		var playerOnT = this.playerTeam === 'T';
		var roles = playerOnT ? ['entry', 'support', 'lurk', 'support'] : ['carrier', 'entry', 'support', 'lurk', 'support'];
		var routeNames = playerOnT ? ['main', 'main', 'flank', 'flank'] : ['main', 'main', 'main', 'flank', 'flank'];
		var carrier = null;
		tBots.forEach(function (bot, i) {
			bot.site = site;
			bot.role = roles[i] || 'support';
			bot.guardIndex = i;
			bot.tRouteName = self.aiChooseRoute('T', site, routeNames[i] || 'main');
			self.aiNoteRouteUse('T', site, bot.tRouteName);
			var route = tRoutes[bot.tRouteName] || tRoutes.main || [];
			bot.route = route.map(function (w, wi) {
				var jitter = wi === route.length - 1 ? 0 : 0.55;
				return self.snapFreePoint(w.x + C.rand(-jitter, jitter), w.z + C.rand(-jitter, jitter), 0.46);
			});
			bot.routeIndex = 0;
			bot.atSite = false;
			bot.mode = 'advance';
			bot.plantSpot = null;
			bot.planting = false;
			bot.plantProgress = 0;
			bot.holdPoint = null;
			bot.think = C.rand(0.05, 0.35);
			if (bot.role === 'carrier') carrier = bot;
		});
		if (!carrier && tBots.length) {
			carrier = tBots[0];
			carrier.role = 'carrier';
		}
		this.carrier = carrier;
		if (playerOnT) this.givePlayerBomb();
		else if (carrier) this.attachBombCarrier(carrier);

		var ctBots = this.teamBots('CT', true);
		var ctCount = ctBots.length;
		var aStat = this.aiRouteStat('CT', 'A', 'anchor');
		var bStat = this.aiRouteStat('CT', 'B', 'anchor');
		var aRate = (aStat.deaths + 1) / (aStat.uses + 2) + this.aiRouteFear('CT', 'A', 'anchor') * 0.18;
		var bRate = (bStat.deaths + 1) / (bStat.uses + 2) + this.aiRouteFear('CT', 'B', 'anchor') * 0.18;
		var dangerSite = null;
		if (aRate > bRate + 0.05) dangerSite = 'A';
		else if (bRate > aRate + 0.05) dangerSite = 'B';
		var dangerCount = Math.min(ctCount, Math.max(1, Math.ceil(ctCount * 0.6)));
		var siteCounts = { A: 0, B: 0 };
		ctBots.forEach(function (bot, i) {
			var assigned;
			if (!dangerSite) assigned = i < Math.min(2, ctCount) ? 'A' : 'B';
			else if (i < dangerCount) assigned = dangerSite;
			else assigned = dangerSite === 'A' ? 'B' : 'A';
			var idx = siteCounts[assigned]++;
			var holdList = assigned === 'A' ? self.world.holds.ctA : self.world.holds.ctB;
			var hold = holdList[idx % holdList.length] || holdList[0] || null;
			if (hold) {
				var hp = self.snapFreePoint(hold.x, hold.z, 0.46);
				hold = { x: hp.x, z: hp.z, lx: hold.lx, lz: hold.lz };
			}
			self.aiNoteRouteUse('CT', assigned, 'anchor');
			bot.site = assigned;
			bot.homeSite = assigned;
			bot.role = assigned === 'A' ? 'A ANCHOR' : 'B ANCHOR';
			bot.guardIndex = idx;
			bot.post = hold;
			bot.holdPoint = hold;
			var baseRoute = (self.world.routes.ct[assigned] || []).map(function (w) {
				return self.snapFreePoint(w.x + C.rand(-0.35, 0.35), w.z + C.rand(-0.35, 0.35), 0.46);
			});
			if (hold) baseRoute.push(self.snapFreePoint(hold.x, hold.z, 0.46));
			bot.route = baseRoute;
			bot.routeIndex = 0;
			bot.mode = 'defend';
			bot.think = C.rand(0.05, 0.4);
		});
		this.saveAIMemory();
	};

	RangeGame.prototype.spawnBot = function (typeId, pos, team, index) {
		var type = C.BOT_TYPES[typeId] || C.BOT_TYPES.trooper;
		var torsos = team === 'CT'
			? ['#6f7f8b', '#7d8b96', '#5e6f7c', '#86939b']
			: ['#b9b0a0', '#a69783', '#8b9690', '#9d7d61', '#d2c3a6'];
		var accents = team === 'CT'
			? ['#5aa9e6', '#7cc4ff', '#4f8fc4', '#9fd7ff']
			: ['#e2603b', '#f2a23c', '#d84b36', '#ff5f45'];
		var name = C.robotName();
		for (var attempt = 0; attempt < 24 && this.usedBotNames && this.usedBotNames[name]; attempt++) name = C.robotName();
		if (this.usedBotNames) this.usedBotNames[name] = true;
		var torsoColor = type.torso && team === 'T' ? type.torso : C.choice(torsos);
		if (team === 'T' && Math.random() < 0.5) torsoColor = C.choice(torsos);
		var robot = C.buildRobot({
			type: type, name: name,
			torso: torsoColor, accent: C.choice(accents)
		});
		robot.baseScale = type.scale || 1;
		robot.healthFriendly = (team === this.playerTeam);
		C.drawHealthSprite(robot);
		robot.root.scale.setScalar(robot.baseScale * 0.05);
		robot.root.position.set(pos.x, 0, pos.z);
		robot.root.rotation.y = pos.yaw || 0;
		robot.root.traverse(function (o) {
			if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
		});
		this.scene.add(robot.root);
		robot.flash = new THREE.Sprite(new THREE.SpriteMaterial({
			map: this.tex.glow, color: 0xffc070, transparent: true,
			blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true
		}));
		robot.flash.scale.set(0.52, 0.52, 1);
		robot.flash.visible = false;
		robot.muzzle.add(robot.flash);

		var teamLoadouts = C.TEAM_LOADOUTS[team] || C.TEAM_LOADOUTS.T;
		var primary;
		if (type.id === 'sniper') primary = C.choice(teamLoadouts.sniper);
		else if (type.id === 'scout') primary = C.choice(team === 'CT' ? ['mp9', 'ump45', 'mp9'] : ['mp9', 'ump45', 'galil']);
		else if (type.id === 'heavy') primary = C.choice(team === 'CT' ? ['m4a4', 'nova', 'ump45'] : ['ak47', 'nova', 'galil']);
		else primary = C.choice(teamLoadouts.primary);
		var secondary = C.choice(teamLoadouts.secondary);
		var loadout = [primary, secondary];
		var weapons = [];
		for (var wi = 0; wi < loadout.length; wi++) {
			var wDef = C.WEAPONS[loadout[wi]];
			if (!wDef) continue;
			var wMag = Math.max(4, Math.round(wDef.mag * C.rand(0.55, 0.82)));
			weapons.push({ id: loadout[wi], def: wDef, magSize: wMag, ammo: wMag, reloading: false, reloadEnd: 0, melee: false });
		}
		weapons.push({ id: 'knife', def: C.WEAPONS.knife, magSize: 1, ammo: 1, reloading: false, reloadEnd: 0, melee: true });
		var currentWeapon = weapons[0];
		var sniperWeapon = weapons.filter(function (w) { return w.def.category === 'SNIPER'; })[0] || null;
		var hasRifle = weapons.some(function (w) { return w.def.category === 'RIFLE'; });
		var hasSmg = weapons.some(function (w) { return w.def.category === 'SMG'; });

		var spawnDiff = this.difficultyFor(team);
		var baseSpeed = type.speed * (0.92 + Math.random() * 0.16);
		var bot = {
			id: ++this.botSeq,
			team: team,
			diff: spawnDiff,
			baseSpeed: baseSpeed,
			robot: robot,
			root: robot.root,
			x: pos.x, z: pos.z, y: 0,
			baseScale: robot.baseScale,
			hp: robot.hp, maxHp: robot.maxHp,
			alive: true, dead: false,
			gamble: false, wanderUntil: 0, wanderPoint: null, stallTimer: 0, twitchPenalty: 0, roundKills: 0,
			type: type, name: name,
			role: '',
			site: '',
			speed: baseSpeed * (spawnDiff.speed || 1),
			accuracy: type.accuracy * (0.92 + Math.random() * 0.16),
			damage: type.damage,
			weapons: weapons,
			weaponIndex: 0,
			weaponId: currentWeapon.id,
			weaponDef: currentWeapon.def,
			magSize: currentWeapon.magSize,
			ammo: currentWeapon.ammo,
			reloading: false,
			reloadEnd: 0,
			reloadSoundAt: 0,
			hasRifle: hasRifle,
			hasSmg: hasSmg,
			hasSniper: !!sniperWeapon,
			burstMode: hasRifle && hasSmg,
			burstLeft: 0,
			weaponThink: 0,
			weaponSwitchAt: 0,
			sniperCoverCooldown: 0,
			sniperCovered: false,
			meleeUntil: 0,
			stationaryUntil: 0,
			behavior: 'advance',
			mode: 'advance',
			behaviorSince: 0,
			behaviorUntil: 0,
			peekCooldown: C.rand(0.8, 2.4),
			peeking: false,
			coverPoint: null,
			peekPoint: null,
			tacPath: null,
			tacIndex: 0,
			tacTarget: null,
			nextShot: this.now + 1200,
			reaction: 0,
			reactionDone: false,
			think: 0,
			path: null,
			pathIndex: 0,
			pathTimer: 0,
			repath: 0,
			pathGoal: null,
			stuck: 0,
			lastX: pos.x, lastZ: pos.z,
			state: 'advance',
			yaw: pos.yaw || 0,
			strafe: Math.random() < 0.5 ? -1 : 1,
			strafeTimer: 0,
			walkPhase: Math.random() * 6,
			spawnT: 0,
			deathT: 0,
			deathSpin: C.rand(-2.4, 2.4),
			headshotDeath: false,
			kills: 0, deaths: 0, hs: 0,
			ping: C.randi(12, 42),
			flashUntil: 0,
			footTimer: 0,
			moveX: 0, moveZ: 0, moveSpeed: 0,
			target: null, targetKey: '', targetThink: 0,
			lastSeen: null, lastAttacker: null, lastHitAt: 0,
			route: [], routeIndex: 0, atSite: false,
			post: null, holdPoint: null,
			guardIndex: index || 0,
			hasBomb: false, bombPack: null,
			plantSpot: null, planting: false, plantProgress: 0,
			defuseTime: C.BOMB ? C.BOMB.defuse : 7,
			scanPhase: C.rand(0, 6.28),
			spottedUntil: 0,
			lastEnemySeenAt: this.now,
			idleLimit: C.rand(8, 14),
			roamNextAt: this.now + C.rand(8, 14),
			roamTarget: null, roamWaitUntil: 0, roamCount: 0,
			supportUntil: 0, supportTarget: null, supportAlertId: 0
		};
		robot.head.userData = { bot: bot, part: 'head', hit: true };
		robot.torso.userData = { bot: bot, part: 'body', hit: true };
		if (robot.bodyHit) robot.bodyHit.userData = { bot: bot, part: 'body', hit: true };
		robot.hp = bot.hp;
		robot.maxHp = bot.maxHp;
		robot.reloading = false;
		C.drawHealthSprite(robot);
		this.bots.push(bot);
		if (team === 'T') {
			this.botHitMeshes.push(robot.head, robot.torso);
			if (robot.bodyHit) this.botHitMeshes.push(robot.bodyHit);
		}
		return bot;
	};

	RangeGame.prototype.saveBotWeapon = function (bot) {
		var rec = bot.weapons && bot.weapons[bot.weaponIndex];
		if (!rec) return;
		rec.ammo = bot.ammo;
		rec.reloading = bot.reloading;
		rec.reloadEnd = bot.reloadEnd;
	};

	RangeGame.prototype.setBotWeapon = function (bot, index, silent) {
		if (!bot || !bot.weapons || index === bot.weaponIndex) return false;
		var rec = bot.weapons[index];
		if (!rec) return false;
		this.saveBotWeapon(bot);
		bot.weaponIndex = index;
		bot.weaponId = rec.id;
		bot.weaponDef = rec.def;
		bot.magSize = rec.magSize;
		bot.ammo = rec.ammo;
		bot.reloading = false;
		bot.reloadEnd = 0;
		rec.reloading = false;
		rec.reloadEnd = 0;
		bot.robot.reloading = false;
		bot.burstLeft = 0;
		bot.reactionDone = false;
		bot.reaction = 0;
		bot.nextShot = Math.max(bot.nextShot, this.now + 240);
		bot.weaponSwitchAt = this.now;
		bot.stationaryUntil = Math.max(bot.stationaryUntil || 0, this.now + 180);
		if (bot.behavior === 'sniperCover' && rec.def.category !== 'SNIPER') {
			bot.behavior = 'hunt';
			bot.behaviorUntil = 0;
			bot.tacTarget = null;
			bot.tacPath = null;
		}
		if (!silent) {
			var dist = Math.hypot(this.player.x - bot.x, this.player.z - bot.z);
			if (dist < 15) this.sound.burst({ dur: 0.05, type: 'bandpass', freq: 1700, q: 0.9, gain: 0.035 * (1 - dist / 20), pan: this.panFor(bot.x, bot.z) });
		}
		return true;
	};

	RangeGame.prototype.botGuns = function (bot) {
		return (bot.weapons || []).filter(function (w) { return !w.melee; });
	};

	RangeGame.prototype.botLoadedGuns = function (bot) {
		return this.botGuns(bot).filter(function (w) { return w.ammo > 0; });
	};

	RangeGame.prototype.botWeaponScore = function (bot, rec, dist) {
		var def = rec.def;
		var score = 1;
		if (def.category === 'SNIPER') {
			score = dist > 14 ? 3.2 : dist < 9 ? 0.2 : 1.7;
		} else if (def.category === 'SHOTGUN') {
			score = dist < 10 ? 2.4 : 0.5;
		} else if (def.category === 'SMG') {
			score = dist < 14 ? 2.0 : 1.0;
		} else if (def.category === 'RIFLE') {
			score = dist >= 8 && dist <= 34 ? 1.8 : 1.2;
		} else {
			score = 1.0;
		}
		if (rec === bot.weapons[bot.weaponIndex]) score += 0.35;
		return score;
	};

	RangeGame.prototype.bestBotGun = function (bot, dist, loadedOnly) {
		var list = loadedOnly ? this.botLoadedGuns(bot) : this.botGuns(bot);
		var best = null, bestScore = -1;
		for (var i = 0; i < list.length; i++) {
			var score = this.botWeaponScore(bot, list[i], dist);
			if (score > bestScore) { bestScore = score; best = list[i]; }
		}
		return best;
	};

	RangeGame.prototype.updateBotWeaponChoice = function (bot, dist) {
		if (!bot || bot.reloading) return;
		if (bot.weaponThink > 0) return;
		bot.weaponThink = C.rand(0.42, 0.72);
		var current = bot.weapons[bot.weaponIndex];
		var loaded = this.botLoadedGuns(bot);
		if (!current) return;
		if (current.melee) {
			if (loaded.length && dist > 2.4) {
				var back = this.bestBotGun(bot, dist, true);
				if (back) this.setBotWeapon(bot, bot.weapons.indexOf(back));
			} else if (!loaded.length && dist > 3.0) {
				var empty = this.bestBotGun(bot, dist, false);
				if (empty) {
					this.setBotWeapon(bot, bot.weapons.indexOf(empty));
					this.startBotReload(bot, this.player.x, this.player.feetY + this.player.eye, this.player.z);
				}
			}
			return;
		}
		if (bot.ammo <= 0) {
			if (loaded.length) {
				var swap = this.bestBotGun(bot, dist, true);
				if (swap) this.setBotWeapon(bot, bot.weapons.indexOf(swap));
				return;
			}
			if (dist < 3.4 && Math.random() < 0.6) {
				var knife = bot.weapons.filter(function (w) { return w.melee; })[0];
				if (knife) { this.setBotWeapon(bot, bot.weapons.indexOf(knife)); return; }
			}
			this.startBotReload(bot, this.player.x, this.player.feetY + this.player.eye, this.player.z);
			return;
		}
		/* keep the most appropriate loaded weapon in hand */
		var best = this.bestBotGun(bot, dist, true);
		if (!best) return;
		var bestScore = this.botWeaponScore(bot, best, dist);
		var currentScore = this.botWeaponScore(bot, current, dist);
		var mustSwap = false;
		if (best !== current && bestScore > currentScore + 0.55) mustSwap = true;
		if (current.def.category === 'SNIPER' && dist < 9 && best !== current) mustSwap = true;
		if (current.def.category !== 'SNIPER' && bot.hasSniper && dist > 17 && best.def.category === 'SNIPER') mustSwap = true;
		if (current.def.category === 'RIFLE' && dist < 9 && best.def.category === 'SMG') mustSwap = true;
		if (current.def.category === 'SMG' && dist > 16 && best.def.category === 'RIFLE') mustSwap = true;
		if (mustSwap) this.setBotWeapon(bot, bot.weapons.indexOf(best));
	};

	RangeGame.prototype.clearBots = function () {
		this.bots.forEach(function (b) {
			if (b.root) {
				b.root.traverse(function (o) {
					if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
				});
			}
			if (b.root && b.root.parent) b.root.parent.remove(b.root);
			if (b.robot && b.robot.materials) {
				b.robot.materials.forEach(function (m) { try { m.dispose(); } catch (e) {} });
			}
			if (b.robot && b.robot.healthTex) b.robot.healthTex.dispose();
			if (b.robot && b.robot.healthSprite && b.robot.healthSprite.material) b.robot.healthSprite.material.dispose();
			if (b.flash && b.flash.material) b.flash.material.dispose();
		});
		this.bots.length = 0;
		this.botHitMeshes.length = 0;
	};

	RangeGame.prototype.clearFx = function () {
		var self = this;
		this.tracers.forEach(function (t) { self.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); });
		this.tracers.length = 0;
		this.sparks.forEach(function (s) { self.fxGroup.remove(s.points); s.points.geometry.dispose(); s.points.material.dispose(); });
		this.sparks.length = 0;
		this.debris.forEach(function (d) { self.scene.remove(d.mesh); d.mesh.geometry.dispose(); });
		this.debris.length = 0;
		this.decals.forEach(function (d) { d.visible = false; });
		this.shells.forEach(function (s) { s.mesh.visible = false; s.life = 0; });
	};

	RangeGame.prototype.spawnChickens = function (count) {
		this.clearChickens();
		var spots = C.shuffle((C.CHICKEN_SPAWNS || []).slice());
		var colors = [0xe8dfca, 0xc7a77a, 0x9a7d5c, 0xd9c7a2, 0x7b5a3d];
		var n = count == null ? 5 : count;
		for (var i = 0; i < spots.length && this.chickens.length < n; i++) {
			var s = spots[i];
			if (this.collidesBot(s.x, s.z, 0.3)) continue;
			var model = C.buildChicken({ color: colors[Math.floor(Math.random() * colors.length)] });
			model.root.scale.setScalar(0.92 + Math.random() * 0.12);
			model.root.position.set(s.x, 0, s.z);
			var yaw = Math.random() * Math.PI * 2;
			model.root.rotation.y = yaw;
			var hitbox = new THREE.Mesh(
				new THREE.SphereGeometry(0.34, 8, 6),
				new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
			);
			hitbox.position.y = 0.36;
			model.root.add(hitbox);
			this.scene.add(model.root);
			var chicken = {
				root: model.root, body: model.body, head: model.head, hitbox: hitbox,
				wingL: model.wingL, wingR: model.wingR, legL: model.legL, legR: model.legR,
				x: s.x, z: s.z, yaw: yaw, targetYaw: yaw,
				alive: true, deadT: 0, phase: Math.random() * 8,
				speed: 0, walkTimer: C.rand(0.8, 2.6), pecking: false,
				cluckTimer: C.rand(2, 7), flee: false, wingPhase: Math.random() * 6
			};
			hitbox.userData = { chicken: chicken, part: 'body' };
			model.body.userData = { chicken: chicken, part: 'body' };
			model.head.userData = { chicken: chicken, part: 'head' };
			model.root.userData = { chicken: chicken };
			this.chickens.push(chicken);
		}
	};

	RangeGame.prototype.clearChickens = function () {
		for (var i = 0; i < this.chickens.length; i++) {
			var ch = this.chickens[i];
			if (!ch.root) continue;
			ch.root.traverse(function (o) {
				if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
			});
			if (ch.root.parent) ch.root.parent.remove(ch.root);
			if (ch.materials) ch.materials.forEach(function (m) { try { m.dispose(); } catch (e) {} });
		}
		this.chickens.length = 0;
	};

	RangeGame.prototype.updateChickens = function (dt) {
		var p = this.player;
		for (var i = 0; i < this.chickens.length; i++) {
			var ch = this.chickens[i];
			if (!ch.alive) {
				ch.deadT += dt;
				ch.root.rotation.z = Math.min(1.35, ch.deadT * 4.5);
				ch.root.position.y = Math.max(0, 0.2 - ch.deadT * 0.3);
				if (ch.deadT > 7) ch.root.visible = false;
				continue;
			}
			ch.cluckTimer -= dt;
			if (ch.cluckTimer <= 0) {
				ch.cluckTimer = C.rand(4.5, 11);
				this.sound.cluck(this.panFor(ch.x, ch.z));
			}
			var threatX = p.x, threatZ = p.z;
			var near = p.alive && Math.hypot(p.x - ch.x, p.z - ch.z) < 3.2;
			if (!near) {
				for (var bi = 0; bi < this.bots.length; bi++) {
					var bb = this.bots[bi];
					if (!bb.alive) continue;
					if (Math.hypot(bb.x - ch.x, bb.z - ch.z) < 2.9) {
						threatX = bb.x; threatZ = bb.z; near = true; break;
					}
				}
			}
			ch.flee = near;
			if (ch.flee) {
				var dx = ch.x - threatX, dz = ch.z - threatZ;
				var len = Math.hypot(dx, dz) || 1;
				ch.targetYaw = Math.atan2(-dx / len, -dz / len);
				ch.speed = 1.9;
				ch.walkTimer = 0.35;
			} else {
				ch.walkTimer -= dt;
				if (ch.walkTimer <= 0) {
					if (Math.random() < 0.32) {
						ch.speed = 0;
						ch.walkTimer = C.rand(0.9, 2.4);
					} else {
						ch.targetYaw = Math.random() * Math.PI * 2;
						ch.speed = C.rand(0.45, 0.9);
						ch.walkTimer = C.rand(1.2, 3.4);
					}
				}
			}
			var turn = 1 - Math.exp(-6 * dt);
			ch.yaw += Math.atan2(Math.sin(ch.targetYaw - ch.yaw), Math.cos(ch.targetYaw - ch.yaw)) * turn;
			var spd = ch.speed;
			if (spd > 0) {
				var wx = ch.x - Math.sin(ch.yaw) * spd * dt;
				var wz = ch.z - Math.cos(ch.yaw) * spd * dt;
				if (!this.collidesBot(wx, ch.z, 0.24)) ch.x = wx;
				else { ch.targetYaw += Math.PI * 0.7; ch.speed = 0; }
				if (!this.collidesBot(ch.x, wz, 0.24)) ch.z = wz;
				else { ch.targetYaw += Math.PI * 0.7; ch.speed = 0; }
				ch.phase += dt * (7 + spd * 7);
			} else {
				ch.phase += dt * 1.2;
			}
			ch.root.position.set(ch.x, Math.abs(Math.sin(ch.phase * 0.7)) * 0.018 * (ch.speed > 0 ? 2 : 1), ch.z);
			ch.root.rotation.y = ch.yaw;
			var leg = Math.sin(ch.phase) * (ch.speed > 0 ? 0.55 : 0.03);
			if (ch.legL) ch.legL.rotation.x = leg;
			if (ch.legR) ch.legR.rotation.x = -leg;
			var flap = Math.sin(ch.phase * 2.2) * (ch.speed > 1 ? 0.16 : 0.04);
			if (ch.wingL) ch.wingL.rotation.z = flap;
			if (ch.wingR) ch.wingR.rotation.z = -flap;
			if (ch.head) ch.head.position.y = 0.59 + Math.sin(ch.phase * 2.3) * 0.008;
		}
	};

	RangeGame.prototype.killChicken = function (ch, point) {
		if (!ch || !ch.alive) return;
		ch.alive = false;
		ch.deadT = 0;
		this.sound.squawk(this.panFor(ch.x, ch.z));
		this.spawnSparks(point || new THREE.Vector3(ch.x, 0.4, ch.z), 0xf0e6d0, 18, 2.6);
	};

	RangeGame.prototype.spawnTargets = function () {
		this.clearTargets();
		var spawn = C.PRACTICE_SPAWN || C.PLAYER_SPAWN;
		var list = C.PRACTICE_TARGETS || [];
		for (var i = 0; i < list.length; i++) {
			var s = list[i];
			if (this.collidesBot(s.x, s.z, 0.42)) continue;
			var scale = s.scale || 1;
			var built = C.buildPracticeTarget(s.type, scale);
			var yaw = Math.atan2(spawn.x - s.x, spawn.z - s.z);
			built.root.position.set(s.x, 0, s.z);
			built.root.rotation.y = yaw;
			built.face.userData = { target: null, part: 'target' };
			this.scene.add(built.root);
			var target = {
				root: built.root, pivot: built.pivot, hitMesh: built.face,
				x: s.x, z: s.z, baseX: s.x, baseZ: s.z,
				baseYaw: yaw, scale: scale, kind: s.type,
				move: s.move || 0, phase: Math.random() * Math.PI * 2,
				down: false, downT: 0, hits: 0,
				materials: built.materials
			};
			built.face.userData.target = target;
			this.targets.push(target);
		}
	};

	RangeGame.prototype.clearTargets = function () {
		for (var i = 0; i < this.targets.length; i++) {
			var t = this.targets[i];
			if (!t.root) continue;
			t.root.traverse(function (o) {
				if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
			});
			if (t.root.parent) t.root.parent.remove(t.root);
			(t.materials || []).forEach(function (m) {
				if (m.map) { try { m.map.dispose(); } catch (e) {} }
				try { m.dispose(); } catch (e2) {}
			});
		}
		this.targets.length = 0;
	};

	RangeGame.prototype.updateTargets = function (dt) {
		for (var i = 0; i < this.targets.length; i++) {
			var t = this.targets[i];
			if (t.down) {
				t.downT += dt;
				t.pivot.rotation.x = -1.28 * Math.min(1, t.downT * 4.5);
				if (t.downT >= 2.4) {
					t.down = false;
					t.downT = 0;
					t.pivot.rotation.x = 0;
					t.root.visible = true;
					t.x = t.baseX;
					t.root.position.x = t.x;
				}
			} else {
				if (t.move) {
					t.phase += dt * 0.9;
					t.x = t.baseX + Math.sin(t.phase) * t.move;
					t.root.position.x = t.x;
				}
				t.pivot.rotation.x = Math.sin(t.phase * 0.7) * 0.006;
			}
		}
	};

	RangeGame.prototype.hitPracticeTarget = function (target, hit) {
		if (!target || target.down) return false;
		target.down = true;
		target.downT = 0;
		target.hits++;
		var points = 10;
		var center = false;
		if (hit && hit.uv) {
			var d = Math.hypot(hit.uv.x - 0.5, hit.uv.y - 0.5);
			center = d < 0.11;
			points = center ? 25 : d < 0.23 ? 15 : 10;
		}
		this.practiceStats.score += points;
		this.practiceStats.hits++;
		this.practiceStats.targets++;
		if (center) this.practiceStats.centers++;
		this.sound.target(center);
		this.spawnSparks(hit && hit.point ? hit.point : new THREE.Vector3(target.x, 1.3, target.z), center ? 0xffd05a : 0xffb36b, center ? 16 : 10, 3.2);
		this.updatePracticeHUD();
		return true;
	};

	/* ======================================================================
	   the C4 objective and the spectator camera
	   ====================================================================== */
	RangeGame.prototype.nearestSite = function (x, z) {
		var best = null, bestD = 1e9;
		for (var i = 0; i < this.world.sites.length; i++) {
			var s = this.world.sites[i];
			var d = Math.hypot(x - s.x, z - s.z);
			if (d < bestD) { bestD = d; best = s; }
		}
		return best;
	};

	RangeGame.prototype.clearBomb = function () {
		this.detachBombCarrier();
		if (this.bombGroup) {
			this.scene.remove(this.bombGroup);
			this.bombGroup.traverse(function (o) {
				if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
				if (o.material) { try { o.material.dispose(); } catch (e2) {} }
			});
			this.bombGroup = null;
			this.bombModel = null;
		}
		this.bomb = null;
		this.playerDefusing = false;
		this.bombCarryMesh = null;
		if (this.el.bombhud) this.el.bombhud.hidden = true;
		if (this.el.defuse) this.el.defuse.hidden = true;
	};

	RangeGame.prototype.detachBombCarrier = function () {
		if (this.bombCarryMesh) {
			var parent = this.bombCarryMesh.parent;
			if (parent) parent.remove(this.bombCarryMesh);
			this.bombCarryMesh.traverse(function (o) {
				if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
				if (o.material) { try { o.material.dispose(); } catch (e2) {} }
			});
			this.bombCarryMesh = null;
		}
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.bombPack) { b.bombPack = null; }
			b.hasBomb = false;
		}
		if (this.bomb) this.bomb.carrier = null;
		this.playerHasBomb = false;
		this.playerPlanting = false;
		this.playerPlantProgress = 0;
	};

	RangeGame.prototype.attachBombCarrier = function (bot) {
		if (!bot || !this.bomb) return;
		this.detachBombCarrier();
		var g = new THREE.Group();
		var caseMat = new THREE.MeshStandardMaterial({ color: 0x39402f, roughness: 0.6, metalness: 0.32 });
		var ledMat = new THREE.MeshBasicMaterial({ color: 0xff3b22 });
		var body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.18), caseMat);
		body.castShadow = true;
		g.add(body);
		var led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.02), ledMat);
		led.position.set(0.12, 0.06, 0.095);
		g.add(led);
		var strap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.22), new THREE.MeshStandardMaterial({ color: 0x2a2b25, roughness: 0.9 }));
		strap.position.y = 0.14;
		g.add(strap);
		g.position.set(0, 1.25, -0.34);
		g.rotation.x = 0.08;
		bot.root.add(g);
		bot.bombPack = g;
		bot.hasBomb = true;
		this.bombCarryMesh = g;
		this.bomb.carrier = bot;
		this.bomb.state = 'carried';
		this.playerHasBomb = false;
	};

	RangeGame.prototype.givePlayerBomb = function () {
		if (!this.bomb) return;
		this.detachBombCarrier();
		this.bomb.state = 'carried';
		this.bomb.carrier = this.player;
		this.bomb.x = this.player.x;
		this.bomb.z = this.player.z;
		this.bomb.plantProgress = 0;
		this.playerHasBomb = true;
		this.playerPlanting = false;
		this.playerPlantProgress = 0;
		if (this.el.c4tag) this.el.c4tag.hidden = false;
	};

	RangeGame.prototype.createBombWorldModel = function (x, z, dropped) {
		if (this.bombGroup) {
			this.scene.remove(this.bombGroup);
			this.bombGroup.traverse(function (o) {
				if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
				if (o.material) { try { o.material.dispose(); } catch (e2) {} }
			});
			this.bombGroup = null;
		}
		var model = C.buildBomb();
		model.group.position.set(x, 0, z);
		model.group.rotation.y = dropped ? C.rand(0, 6.28) : -0.2;
		this.scene.add(model.group);
		var glow = new THREE.Sprite(new THREE.SpriteMaterial({
			map: this.tex.glow, color: 0xff4a2a, transparent: true, opacity: 0.5,
			blending: THREE.AdditiveBlending, depthWrite: false
		}));
		glow.scale.set(1.35, 1.35, 1);
		glow.position.y = 0.3;
		model.group.add(glow);
		model.glow = glow;
		this.bombGroup = model.group;
		this.bombModel = model;
		return model;
	};

	RangeGame.prototype.choosePlantSpot = function (bot, site) {
		if (!site) site = this.nearestSite(bot.x, bot.z);
		var spots = (site && site.plantSpots) || [];
		var best = null, bestD = 1e9;
		for (var i = 0; i < spots.length; i++) {
			var s = spots[i];
			if (this.collidesBot(s.x, s.z, 0.34)) continue;
			var d = Math.hypot(s.x - bot.x, s.z - bot.z);
			if (d < bestD) { bestD = d; best = s; }
		}
		return best || { x: site ? site.x : bot.x, z: site ? site.z : bot.z, name: 'DEFAULT' };
	};

	RangeGame.prototype.plantBomb = function (bot) {
		if (!this.bomb || (this.bomb.state !== 'carried' && this.bomb.state !== 'planting')) return;
		var site = this.nearestSite(bot.x, bot.z);
		if (!site) return;
		var spot = this.choosePlantSpot(bot, site);
		var b = this.bomb;
		b.state = 'planted';
		b.site = site.id;
		b.x = spot.x; b.z = spot.z;
		b.fuse = C.BOMB ? C.BOMB.fuse : 40;
		b.plantProgress = 0;
		b.beepTimer = 0.15;
		b.ledPhase = 0;
		b.planter = null;
		bot.hasBomb = false;
		bot.planting = false;
		bot.plantProgress = 0;
		bot.role = 'guard';
		this.detachBombCarrier();
		b.carrier = null;
		this.createBombWorldModel(spot.x, spot.z, false);
		for (var si = 0; si < this.bots.length; si++) {
			var sb = this.bots[si];
			sb.supportTarget = null;
			sb.supportUntil = 0;
			sb.supportAlertId = 0;
		}
		this.announce('BOMB PLANTED', 'SITE ' + site.id + ' — ' + this.tr('DEFUSE IT') + ' (' + (spot.name || 'C4') + ')');
		this.sound.tone({ freq: 620, to: 940, dur: 0.16, gain: 0.18, type: 'square' });
		this.sound.tone({ freq: 1240, dur: 0.1, gain: 0.09, type: 'sine', delay: 0.12 });
		this.updateHostiles();
	};

	RangeGame.prototype.dropBomb = function (bot) {
		if (!this.bomb) return;
		if (this.bomb.state !== 'carried' && this.bomb.state !== 'planting') return;
		var b = this.bomb;
		b.state = 'dropped';
		b.x = bot.x;
		b.z = bot.z;
		b.plantProgress = 0;
		b.defuseProgress = 0;
		b.playerDefuseProgress = 0;
		b.planter = null;
		bot.planting = false;
		bot.plantProgress = 0;
		this.detachBombCarrier();
		b.carrier = null;
		this.createBombWorldModel(bot.x, bot.z, true);
		this.announce('BOMB DROPPED', 'RECOVER THE C4');
	};

	RangeGame.prototype.prepareBombCarrier = function (bot) {
		if (!bot) return;
		var site = this.nearestSite(bot.x, bot.z) || this.siteById(this.tSite) || this.world.sites[0];
		if (!site) return;
		bot.role = 'carrier';
		bot.site = site.id;
		bot.atSite = false;
		bot.plantSpot = null;
		bot.planting = false;
		bot.plantProgress = 0;
		bot.routeIndex = 0;
		bot.path = null;
		bot.pathGoal = null;
		bot.think = 0;
		bot.route = [this.snapFreePoint(site.x, site.z, 0.46)];
		/* The rest of the squad regroups on the same site for the deployment. */
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b === bot || b.team !== 'T' || !b.alive || b.dead || b.planting) continue;
			b.site = site.id;
			b.atSite = false;
			b.plantSpot = null;
			b.route = [this.snapFreePoint(site.x, site.z, 0.46)];
			b.routeIndex = 0;
			b.path = null;
			b.pathGoal = null;
			b.think = 0;
		}
	};

	RangeGame.prototype.pickupBomb = function (bot) {
		if (!this.bomb || this.bomb.state !== 'dropped') return;
		if (Math.hypot(bot.x - this.bomb.x, bot.z - this.bomb.z) > 1.7) return;
		if (this.bombGroup) {
			this.scene.remove(this.bombGroup);
			this.bombGroup.traverse(function (o) {
				if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
				if (o.material) { try { o.material.dispose(); } catch (e2) {} }
			});
			this.bombGroup = null;
			this.bombModel = null;
		}
		this.bomb.state = 'carried';
		this.attachBombCarrier(bot);
		this.prepareBombCarrier(bot);
	};

	RangeGame.prototype.defuseTime = function () {
		return this.defuseKit ? (C.BOMB ? C.BOMB.defuseKit : 5) : (C.BOMB ? C.BOMB.defuse : 10);
	};

	RangeGame.prototype.defuseBomb = function (by) {
		if (!this.bomb || this.bomb.state !== 'planted') return;
		this.bomb.state = 'defused';
		this.bomb.playerDefuseProgress = this.defuseTime();
		this.playerDefusing = false;
		if (this.bombModel) {
			try {
				this.bombModel.ledMat.color.setHex(0x7dffb0);
				this.bombModel.glow.material.color.setHex(0x7dffb0);
			} catch (e) {}
		}
		var name = (by === 'player') ? 'YOU' : (by && by.name ? by.name : 'CT');
		this.announce('BOMB DEFUSED', this.tr(name) + ' — COUNTER-TERRORISTS WIN');
		this.sound.tone({ freq: 880, to: 440, dur: 0.4, gain: 0.2, type: 'triangle' });
		this.addKillFeed(name, 'C4', 'DEFUSE', false, by === 'player');
		this.endRound(true, 'The bomb was defused.', 'defuse');
	};

	RangeGame.prototype.explodeBomb = function () {
		if (!this.bomb || this.bomb.state === 'exploded' || this.bomb.state === 'defused') return;
		this.bomb.state = 'exploded';
		var bx = this.bomb.x, bz = this.bomb.z;
		this.sound.explode();
		this.shake = 1.3;
		this.flashDamage();
		if (this.el.flash) {
			var self = this;
			this.el.flash.classList.add('is-head');
			setTimeout(function () { if (self.el.flash) self.el.flash.classList.remove('is-head'); }, 420);
		}
		this.spawnSparks(new THREE.Vector3(bx, 1.2, bz), 0xffb060, 46, 9);
		if (this.bombGroup) this.bombGroup.visible = false;
		this.announce('BOMB DETONATED', 'SITE ' + (this.bomb.site || '?') + ' — TERRORISTS WIN');
		if (this.player.alive && Math.hypot(this.player.x - bx, this.player.z - bz) < 18) {
			this.player.health = 0;
			this.player.alive = false;
			this.playerWasKilledLastRound = true;
			this.playerDiedLastRound = true;
			this.el.hud && this.el.hud.classList.add('is-dead');
		}
		this.endRound(false, 'The bomb detonated.', 'explode');
	};

	RangeGame.prototype.nearestCTBotToBomb = function () {
		if (!this.bomb) return null;
		var best = null, bestD = 1e9;
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.team !== 'CT' || !b.alive || b.dead) continue;
			var d = Math.hypot(b.x - this.bomb.x, b.z - this.bomb.z);
			if (d < bestD) { bestD = d; best = b; }
		}
		return best;
	};

	RangeGame.prototype.pickupBombPlayer = function () {
		var b = this.bomb;
		if (!b || b.state !== 'dropped' || this.playerTeam !== 'T') return;
		if (Math.hypot(this.player.x - b.x, this.player.z - b.z) > 1.8) return;
		if (this.bombGroup) {
			this.scene.remove(this.bombGroup);
			this.bombGroup.traverse(function (o) {
				if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
				if (o.material) { try { o.material.dispose(); } catch (e2) {} }
			});
			this.bombGroup = null;
			this.bombModel = null;
		}
		b.state = 'carried';
		b.carrier = this.player;
		b.x = this.player.x;
		b.z = this.player.z;
		this.playerHasBomb = true;
		this.playerPlanting = false;
		this.playerPlantProgress = 0;
		this.announce('C4 RECOVERED', 'HOLD E AT A SITE TO PLANT');
		this.sound.tone({ freq: 520, to: 760, dur: 0.12, gain: 0.12, type: 'triangle' });
	};

	RangeGame.prototype.plantPlayerBomb = function (site) {
		var b = this.bomb;
		if (!b || b.state !== 'carried' || !this.playerHasBomb) return;
		if (!site) site = this.nearestSite(this.player.x, this.player.z);
		if (!site) return;
		b.state = 'planted';
		b.site = site.id;
		b.x = this.player.x;
		b.z = this.player.z;
		b.fuse = C.BOMB ? C.BOMB.fuse : 40;
		b.plantProgress = 0;
		b.playerPlantProgress = 0;
		b.playerDefuseProgress = 0;
		b.beepTimer = 0.15;
		b.ledPhase = 0;
		b.planter = this.player;
		this.playerHasBomb = false;
		this.playerPlanting = false;
		this.playerPlantProgress = 0;
		this.playerPlantProgress = 0;
		this.detachBombCarrier();
		this.createBombWorldModel(b.x, b.z, false);
		for (var si = 0; si < this.bots.length; si++) {
			var sb = this.bots[si];
			sb.supportTarget = null;
			sb.supportUntil = 0;
			sb.supportAlertId = 0;
		}
		this.announce('BOMB PLANTED', 'SITE ' + site.id + ' — DEFEND THE C4');
		this.sound.tone({ freq: 620, to: 940, dur: 0.16, gain: 0.18, type: 'square' });
		this.sound.tone({ freq: 1240, dur: 0.1, gain: 0.09, type: 'sine', delay: 0.12 });
		this.updateHostiles();
		this.updateBombHUD();
	};

	RangeGame.prototype.updatePlayerPlant = function (dt) {
		var b = this.bomb;
		var p = this.player;
		if (!b || !this.playerHasBomb || b.state !== 'carried') {
			this.playerPlanting = false;
			this.playerPlantProgress = Math.max(0, this.playerPlantProgress - dt * 2);
			return;
		}
		if (this.playerTeam !== 'T' || !p.alive || this.state !== 'playing' || !this.round || this.round.phase !== 'live') return;
		var site = this.nearestSite(p.x, p.z);
		var onSite = !!site && Math.hypot(p.x - site.x, p.z - site.z) <= site.r + 0.6;
		var moving = this.keys.w || this.keys.a || this.keys.s || this.keys.d || p.speed > 0.7 || this.input.fire;
		if (!onSite) {
			this.playerPlanting = false;
			this.playerPlantProgress = Math.max(0, this.playerPlantProgress - dt * 1.6);
			return;
		}
		if (this.input.defuse && !moving) {
			if (!this.playerPlanting) {
				this.playerPlanting = true;
				this.playerPlantProgress = 0;
				this.announce('PLANTING C4', 'HOLD E — STAY STILL');
			}
			this.playerPlantProgress += dt;
			if (this.playerPlantProgress >= (C.BOMB ? C.BOMB.plantTime : 3.2)) {
				this.plantPlayerBomb(site);
			}
		} else {
			this.playerPlanting = false;
			this.playerPlantProgress = Math.max(0, this.playerPlantProgress - dt * 2.2);
		}
	};

	RangeGame.prototype.updatePlayerDefuse = function (dt) {
		var b = this.bomb;
		var p = this.player;
		if (!b) return;
		if (this.playerTeam !== 'CT') { b.playerDefuseProgress = 0; this.playerDefusing = false; return; }
		if (b.state !== 'planted') { b.playerDefuseProgress = 0; this.playerDefusing = false; return; }
		var dist = Math.hypot(p.x - b.x, p.z - b.z);
		var near = p.alive && this.state === 'playing' && dist < 2.2 && this.round && this.round.phase === 'live';
		var moving = this.keys.w || this.keys.a || this.keys.s || this.keys.d || p.speed > 0.7 || this.input.fire;
		if (near && this.input.defuse && !moving) {
			this.playerDefusing = true;
			b.playerDefuseProgress += dt;
			if (b.playerDefuseProgress >= this.defuseTime()) {
				b.playerDefuseProgress = this.defuseTime();
				this.defuseBomb('player');
			}
		} else {
			this.playerDefusing = false;
			b.playerDefuseProgress = Math.max(0, b.playerDefuseProgress - dt * 2.2);
		}
	};

	RangeGame.prototype.updateBomb = function (dt) {
		var b = this.bomb;
		if (!b) return;
		var now = this.now;
		if (b.state === 'carried' || b.state === 'planting') {
			if (b.carrier) { b.x = b.carrier.x; b.z = b.carrier.z; }
			if (b.state === 'planting' && b.planter && (!b.planter.alive || b.planter.dead)) {
				this.dropBomb(b.planter);
			}
			if (b.carrier === this.player) this.updatePlayerPlant(dt);
		} else if (b.state === 'dropped') {
			/* a terrorist close enough picks the C4 back up */
			var ts = this.teamBots('T', true);
			for (var i = 0; i < ts.length; i++) {
				var t = ts[i];
				if (Math.hypot(t.x - b.x, t.z - b.z) < 1.55) { this.pickupBomb(t); break; }
			}
			if (this.playerTeam === 'T' && this.player.alive &&
				Math.hypot(this.player.x - b.x, this.player.z - b.z) < 1.7 &&
				this.input.defuse && this.round && this.round.phase === 'live') {
				this.pickupBombPlayer();
			}
			if (this.bombGroup) {
				this.bombGroup.position.y = Math.sin(this.gameTime * 2.4) * 0.02;
			}
		} else if (b.state === 'planted') {
			b.fuse -= dt;
			b.ledPhase += dt;
			var interval = b.fuse > 22 ? 1.15 : b.fuse > 11 ? 0.62 : 0.3;
			b.beepTimer -= dt;
			if (b.beepTimer <= 0) {
				b.beepTimer = interval;
				var distP = Math.hypot(this.player.x - b.x, this.player.z - b.z);
				var att = C.clamp(1 - distP / 80, 0.1, 1);
				this.sound.tone({ freq: b.fuse < 11 ? 1400 : 1050, dur: 0.05, gain: 0.09 * att, type: 'square', pan: this.panFor(b.x, b.z) });
				if (b.fuse < 8) this.sound.tone({ freq: 1800, dur: 0.04, gain: 0.05, type: 'sine' });
			}
			if (this.bombModel) {
				var on = Math.sin(b.ledPhase * (b.fuse < 11 ? 22 : 10)) > 0;
				this.bombModel.ledMat.color.setHex(on ? 0xff3b22 : 0x4a1208);
				if (this.bombModel.glow) this.bombModel.glow.material.opacity = on ? 0.62 : 0.16;
				this.bombModel.group.rotation.y += dt * 0.12;
			}
			/* bot defuser: one CT bot nearest the C4 tries to stick it */
			if (this.playerDefusing) {
				b.defuser = null;
				b.defuseProgress = 0;
			} else {
				if (!b.defuser || !b.defuser.alive || b.defuser.dead) {
					var best = this.nearestCTBotToBomb();
					if (best && Math.hypot(best.x - b.x, best.z - b.z) < 38) b.defuser = best;
				}
				if (b.defuser) {
					var d = b.defuser;
					if (!d.alive || d.dead || Math.hypot(d.x - b.x, d.z - b.z) > 1.9) {
						b.defuseProgress = Math.max(0, b.defuseProgress - dt * 2);
					} else {
						b.defuseProgress += dt;
						if (b.defuseProgress >= (d.defuseTime || 7)) {
							b.defuseProgress = d.defuseTime || 7;
							this.defuseBomb(d);
						}
					}
				}
			}
			this.updatePlayerDefuse(dt);
			if (b.fuse <= 0) { b.fuse = 0; this.explodeBomb(); }
		}
		this.updateBombHUD();
	};

	RangeGame.prototype.updateBombHUD = function () {
		var e = this.el;
		var b = this.bomb;
		if (!e) return;
		var planted = !!(b && b.state === 'planted');
		if (e.bombhud) {
			e.bombhud.hidden = !planted;
			if (planted) {
				var fuseTxt = Math.max(0, b.fuse).toFixed(1);
				text(e.bombTimer, fuseTxt);
				text(e.bombSite, 'SITE ' + (b.site || '?'));
				e.bombhud.classList.toggle('is-critical', b.fuse < 10);
				var prog = Math.max(b.playerDefuseProgress || 0, b.defuseProgress || 0);
				var total = this.defuseTime();
				var pct = C.clamp(prog / total, 0, 1) * 100;
				if (e.bombBar) e.bombBar.style.width = pct + '%';
			}
		}
		if (e.c4tag) e.c4tag.hidden = !this.playerHasBomb;
		if (e.defuse) {
			var showDefuse = false, defuseOn = false;
			var plantSite = null;
			if (this.playerTeam === 'T' && this.player.alive) {
				if (this.playerHasBomb && b && b.state === 'carried') {
					plantSite = this.nearestSite(this.player.x, this.player.z);
					var onSite = !!plantSite && Math.hypot(this.player.x - plantSite.x, this.player.z - plantSite.z) <= plantSite.r + 0.6;
					if (onSite && this.round && this.round.phase === 'live' && this.state === 'playing') {
						showDefuse = true;
						defuseOn = !!this.playerPlanting;
						var plantTotal = C.BOMB ? C.BOMB.plantTime : 3.2;
						if (e.defuseText) text(e.defuseText, this.playerPlanting ? 'PLANTING C4' : (this.isTouch ? 'HOLD USE TO PLANT' : 'HOLD E TO PLANT'));
						if (e.defuseKitLabel) text(e.defuseKitLabel, 'C4 · SITE ' + plantSite.id + ' · ' + plantTotal.toFixed(1) + 's');
						if (e.defuseBar) e.defuseBar.style.width = C.clamp((this.playerPlantProgress || 0) / plantTotal, 0, 1) * 100 + '%';
					}
				} else if (b && b.state === 'dropped' && Math.hypot(this.player.x - b.x, this.player.z - b.z) < 1.8) {
					showDefuse = true;
					if (e.defuseText) text(e.defuseText, 'PRESS E TO RECOVER THE C4');
					if (e.defuseKitLabel) text(e.defuseKitLabel, 'BOMB DROPPED');
					if (e.defuseBar) e.defuseBar.style.width = '0%';
				}
			} else if (this.playerTeam === 'CT') {
				var near = planted && this.player.alive && Math.hypot(this.player.x - b.x, this.player.z - b.z) < 2.2;
				showDefuse = near;
				if (near) {
					defuseOn = !!this.playerDefusing;
					var canKit = this.defuseKit;
					var seconds = this.defuseTime();
					if (e.defuseText) {
						text(e.defuseText, this.playerDefusing ? 'DEFUSING' : (this.isTouch ? 'HOLD USE TO DEFUSE' : 'HOLD E TO DEFUSE'));
					}
					if (e.defuseKitLabel) text(e.defuseKitLabel, this.tr(canKit ? 'KIT' : 'NO KIT') + ' · ' + seconds.toFixed(0) + 's');
					if (e.defuseBar) e.defuseBar.style.width = C.clamp((b.playerDefuseProgress || 0) / seconds, 0, 1) * 100 + '%';
				}
			}
			e.defuse.hidden = !showDefuse;
			e.defuse.classList.toggle('is-on', defuseOn);
		}
		if (e.kit) {
			e.kit.hidden = !(this.defuseKit && this.playerTeam === 'CT');
		}
	};

	RangeGame.prototype.selectSpectateTarget = function () {
		var best = null, bestD = 1e9;
		var p = this.player;
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.team !== this.playerTeam || !b.alive || b.dead) continue;
			var d = Math.hypot(b.x - p.x, b.z - p.z);
			if (d < bestD) { bestD = d; best = b; }
		}
		this.spectateTarget = best;
		return best;
	};

	RangeGame.prototype.restoreSpectateBody = function () {
		if (this._specHiddenBot && this._specHiddenBot.root) this._specHiddenBot.root.visible = true;
		this._specHiddenBot = null;
	};

	RangeGame.prototype.hideSpectateBody = function (t) {
		this.restoreSpectateBody();
		if (t && t.root) {
			t.root.visible = false;
			this._specHiddenBot = t;
		}
		if (this.playerBody) this.playerBody.visible = false;
	};

	RangeGame.prototype.beginSpectate = function () {
		if (this.spectating) return;
		this.spectating = true;
		this.selectSpectateTarget();
		if (this.spectateTarget) {
			this.hideDeathCam();
			this.hideSpectateBody(this.spectateTarget);
		}
		if (this.el.spectate) this.el.spectate.hidden = false;
		if (this.el.hud) {
			this.el.hud.classList.remove('is-dead');
			this.el.hud.classList.add('is-spectating');
		}
		this.updateSpectateHUD();
	};

	RangeGame.prototype.cycleSpectateTarget = function (dir) {
		var list = [];
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.team === this.playerTeam && b.alive && !b.dead) list.push(b);
		}
		if (!list.length) { this.restoreSpectateBody(); this.spectateTarget = null; this.updateSpectateHUD(); return; }
		var idx = list.indexOf(this.spectateTarget);
		idx = (idx + (dir || 1) + list.length) % list.length;
		this.spectateTarget = list[idx];
		this.hideSpectateBody(this.spectateTarget);
		if (this.el.spectate) this.el.spectate.hidden = false;
		if (this.el.hud) this.el.hud.classList.add('is-spectating');
		this.updateSpectateHUD();
		this.sound.tone({ freq: 620, to: 860, dur: 0.06, gain: 0.05, type: 'square' });
	};

	RangeGame.prototype.hideSpectate = function () {
		this.spectating = false;
		this.spectateTarget = null;
		this.restoreSpectateBody();
		if (this.el.spectate) this.el.spectate.hidden = true;
		if (this.el.hud) this.el.hud.classList.remove('is-spectating');
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.root) b.root.visible = true;
		}
	};

	RangeGame.prototype.updateSpectateHUD = function () {
		if (!this.spectating) return;
		var t = this.spectateTarget;
		if (!t || !t.alive || t.dead) t = this.selectSpectateTarget();
		if (!t) {
			if (this.el.spectateName) text(this.el.spectateName, 'NO ROBOTS LEFT');
			if (this.el.spectateHp) text(this.el.spectateHp, '0');
			if (this.el.spectateAmmo) text(this.el.spectateAmmo, '0');
			return;
		}
		this.spectateTarget = t;
		if (this._specHiddenBot !== t) this.hideSpectateBody(t);
		var hp = Math.max(0, Math.round(t.hp));
		if (this.el.spectateName) text(this.el.spectateName, t.name);
		if (this.el.spectateAlive) text(this.el.spectateAlive, String(this.aliveTeamCount(this.playerTeam)));
		if (this.el.spectateHp) text(this.el.spectateHp, hp);
		if (this.el.spectateAmmo) text(this.el.spectateAmmo, t.ammo != null ? t.ammo : '—');
		if (this.el.health) text(this.el.health, hp);
		if (this.el.armor) text(this.el.armor, t.armor != null ? Math.max(0, Math.round(t.armor)) : '0');
		var hbar = this.el.healthbar ? this.el.healthbar.querySelector('em') : null;
		if (hbar) hbar.style.width = clamp(hp / Math.max(1, t.maxHp) * 100, 0, 100) + '%';
		var hpar = this.el.health && this.el.health.parentNode;
		if (hpar) hpar.classList.toggle('is-low', hp <= 25);
		var def = t.weaponDef || (t.weapons && t.weapons[t.weaponIndex] && t.weapons[t.weaponIndex].def);
		if (def) {
			if (this.el.weapon) text(this.el.weapon, def.name);
			if (this.el.slot) text(this.el.slot, def.category || def.slot);
			if (this.el.ammo) text(this.el.ammo, t.ammo != null ? t.ammo : '—');
			if (this.el.reserve) text(this.el.reserve, '—');
			if (this.el.ammo && this.el.ammo.parentNode) {
				this.el.ammo.parentNode.classList.toggle('is-low', t.ammo != null && t.magSize && t.ammo <= Math.max(1, Math.floor(t.magSize * 0.2)));
			}
		}
	};

	RangeGame.prototype.updateSpectateCamera = function () {
		var t = this.spectateTarget;
		if (!t || !t.alive || t.dead) t = this.selectSpectateTarget();
		if (!t) {
			this.restoreSpectateBody();
			if (this.playerBody) this.playerBody.visible = true;
			this.updateDeathCamera();
			return;
		}
		this.spectateTarget = t;
		if (this._specHiddenBot !== t) this.hideSpectateBody(t);
		var cam = this.camera;
		var eye = 1.6 * t.baseScale + Math.sin(t.walkPhase || 0) * 0.012;
		var yaw;
		if (t.face) yaw = Math.atan2(-(t.face.x - t.x), -(t.face.z - t.z));
		else yaw = (t.yaw || 0) + Math.PI;
		var pitch = 0;
		if (t.target) {
			var td = Math.hypot(t.target.x - t.x, t.target.z - t.z);
			pitch = Math.atan2((t.target.eye || eye) - eye, Math.max(0.5, td));
		}
		cam.fov = 74;
		cam.position.set(t.x, eye, t.z);
		cam.rotation.set(pitch, yaw, 0);
		cam.updateProjectionMatrix();
		this.updateSpectateHUD();
	};

	RangeGame.prototype.updateRoundNo = function () {
		text(this.el.roundWord, this.practice ? 'PRACTICE' : 'ROUND');
		text(this.el.roundNo, this.practice ? '' : this.match.round);
		text(this.el.pauseRound, this.match.round);
		text(this.el.boardRound, this.match.round);
	};

	RangeGame.prototype.updateScoreHUD = function () {
		text(this.el.scoreCt, this.match.ct);
		text(this.el.scoreT, this.match.t);
		text(this.el.boardCt, this.match.ct);
		text(this.el.boardT, this.match.t);
		if (this.el.pauseScore) text(this.el.pauseScore, this.match.ct + ' — ' + this.match.t);
		this.updatePips();
	};

	RangeGame.prototype.updatePips = function () {
		if (!this.el.pips) return;
		var history = this.roundHistory.slice(-13);
		var html = '';
		for (var i = 0; i < 13; i++) {
			if (history[i]) html += '<i class="is-' + history[i] + '"></i>';
			else html += '<i></i>';
		}
		this.el.pips.innerHTML = html;
	};

	RangeGame.prototype.updateHostiles = function () {
		var enemyAlive = 0, allyAlive = this.player.alive ? 1 : 0;
		for (var i = 0; i < this.bots.length; i++) {
			if (!this.bots[i].alive) continue;
			if (this.bots[i].team === this.playerTeam) allyAlive++;
			else enemyAlive++;
		}
		text(this.el.hostiles, enemyAlive);
		if (this.el.hostileLabel) text(this.el.hostileLabel, this.enemyTeam === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS');
		if (this.el.hostileDots) {
			var html = '';
			for (var d = 0; d < enemyAlive; d++) html += '<span></span>';
			this.el.hostileDots.innerHTML = html;
		}
		if (this.el.allies) text(this.el.allies, allyAlive);
		if (this.el.allyLabel) text(this.el.allyLabel, this.playerTeam === 'CT' ? 'CT ALIVE' : 'T ALIVE');
		if (this.el.allyDots) {
			var html2 = '';
			for (var a = 0; a < allyAlive; a++) html2 += '<span></span>';
			this.el.allyDots.innerHTML = html2;
		}
	};

	RangeGame.prototype.updateRoundTimer = function () {
		if (this.practice) {
			text(this.el.roundTimer, '∞');
			if (this.el.phaseLabel) text(this.el.phaseLabel, 'PRACTICE');
			return;
		}
		var val;
		var bomb = this.bomb;
		var planted = bomb && bomb.state === 'planted';
		if (this.state === 'roundover' || this.state === 'matchover') val = '0:00';
		else if (this.round && this.round.phase === 'freeze') val = fmtTime(this.round.freezeLeft);
		else if (planted) val = fmtTime(Math.max(0, bomb.fuse));
		else if (this.round) val = fmtTime(this.round.timer);
		else val = '1:55';
		text(this.el.roundTimer, val);
		if (this.el.roundTimer) this.el.roundTimer.classList.toggle('is-bomb', !!planted);
		if (this.el.phaseLabel) {
			var label = 'BUY TIME';
			if (this.state === 'roundover') label = 'ROUND OVER';
			else if (this.state === 'matchover') label = 'MATCH OVER';
			else if (planted) label = this.playerDefusing ? 'DEFUSING' : 'BOMB PLANTED';
			else if (this.round && this.round.phase === 'live') label = 'LIVE';
			text(this.el.phaseLabel, label);
		}
	};

	RangeGame.prototype.updateBuyHint = function () {
		if (!this.el.buyhint) return;
		var show = this.state === 'playing' && (this.practice || (this.round && this.round.phase === 'freeze'));
		this.el.buyhint.classList.toggle('is-hidden', !show);
		var mode = this.practice ? 'practice' : 'live';
		if (this._buyHintMode !== mode) {
			this._buyHintMode = mode;
			var tag = this.el.buyhint.querySelector('span');
			var line = this.el.buyhint.querySelector('b');
			if (tag) text(tag, this.practice ? 'FREE ARMORY' : 'BUY PHASE');
			if (line) line.innerHTML = '<kbd>B</kbd> ' + escapeHTML(this.tr(this.practice ? 'TRY ANY WEAPON' : 'OPEN BUY MENU'));
		}
	};

	RangeGame.prototype.announce = function (main, sub) {
		var a = this.el.announce;
		if (!a) return;
		main = this.tr(main);
		sub = sub ? this.tr(sub) : '';
		a.innerHTML = escapeHTML(main) + (sub ? '<small>' + escapeHTML(sub) + '</small>' : '');
		a.classList.remove('is-show', 'is-stay');
		void a.offsetWidth;
		a.classList.add('is-show');
	};

	/* ======================================================================
	   the loop
	   ====================================================================== */
	RangeGame.prototype.beginLoop = function () {
		var self = this;
		this.lastTime = performance.now();
		function frame(now) {
			self.raf = global.requestAnimationFrame(frame);
			var dt = Math.min((now - self.lastTime) / 1000, 0.05);
			if (dt < 0) dt = 0;
			self.lastTime = now;
			self.now = now;
			self.gameTime += dt;
			try {
				self.update(dt);
				self.render();
			} catch (err) {
				if (!self._loopError) {
					self._loopError = true;
					console.error('[dust range] frame error', err);
				}
			}
		}
		this.raf = global.requestAnimationFrame(frame);
	};

	RangeGame.prototype.update = function (dt) {
		this.fpsFrames++;
		this.fpsAccum += dt;
		if (this.fpsAccum >= 0.5) {
			this.fps = Math.round(this.fpsFrames / this.fpsAccum);
			this.fpsFrames = 0;
			this.fpsAccum = 0;
			if (this.el.debug) text(this.el.debug, this.fps + ' FPS · ' + (this.bots ? this.bots.filter(function (b) { return b.alive; }).length : 0) + ' BOTS');
		}

		if (this.state === 'menu' || this.state === 'boot' || this.state === 'error') {
			this.updateMenuCamera(dt);
			this.updateFx(dt);
			return;
		}
		if (this.state === 'playing') {
			if (this.practice) this.updatePractice(dt);
			else this.updateMatch(dt);
		} else if (this.state === 'roundover') {
			this.updateResult(dt);
			this.updateBotsDeath(dt);
			this.updateFx(dt);
			this.updateViewWeapon(dt);
		} else if (this.state === 'matchover') {
			this.updateFx(dt);
			this.updateViewWeapon(dt);
		} else {
			this.updateFx(dt);
			this.updateViewWeapon(dt);
		}
		this.updateHUD();
		this.updateCrosshair();
		this.updateScopeVisual();
		if (this.state === 'playing' || this.state === 'roundover' || this.state === 'buy' || this.state === 'paused') {
			this.radarTimer -= dt;
			if (this.radarTimer <= 0) {
				this.radarTimer = 0.1;
				this.drawRadar();
			}
		}
	};

	RangeGame.prototype.updateMatch = function (dt) {
		var round = this.round;
		if (!round) return;
		if (round.phase === 'freeze') {
			round.freezeLeft -= dt;
			if (round.freezeLeft <= 0) {
				round.freezeLeft = 0;
				round.phase = 'live';
				this.announce('ROUND START', this.playerTeam === 'T' ? 'PLANT THE C4 — CLEAR THE SITE' : 'DEFEND THE SITES — STOP THE C4');
				this.sound.roundStart();
				this.updateBuyHint();
				if (this.buyOpen) this.closeBuy();
			}
		}
		if (round.phase === 'live') {
			var planted = this.bomb && this.bomb.state === 'planted';
			if (!planted) {
				round.timer -= dt;
				if (round.timer <= 0) {
					round.timer = 0;
					this.endRound(true, 'Time expired before the bomb was planted.', 'time');
					return;
				}
			}
		}

		this.updatePlayer(dt);
		this.checkPlayerContact(dt);
		this.updateWeapon(dt);
		this.updateBots(dt);
		this.updateBomb(dt);
		this.updateChickens(dt);
		this.updateFx(dt);
		this.updateRoundTimer();
		this.updateVitalsHUD();
		this.updateAmmoHUD();
		this.updateCrosshair();

		if (!this.player.alive) {
			this.deathTimer -= dt;
			this.updateDeathHUD();
			if (this.deathTimer <= 0 && !this.spectating) this.beginSpectate();
			if (this.spectating) this.updateSpectateHUD();
		}
		this.checkRoundEnd();
		this.updateBuyHint();
		this.updateBombHUD();
		this.updateContactHUD();
	};

	RangeGame.prototype.updateResult = function (dt) {
		this.resultTimer -= dt;
		if (this.el.bannerNext) {
			text(this.el.bannerNext, 'NEXT ROUND IN ' + Math.max(1, Math.ceil(this.resultTimer)));
		}
		this.updateFx(dt);
		this.updateBotsDeath(dt);
		this.updateViewWeapon(dt);
		if (this.resultTimer <= 0) this.nextRound(false);
	};

	RangeGame.prototype.nextRound = function (manual) {
		if (this.state !== 'roundover') return;
		this.hideRoundBanner();
		if (this.match.ct >= MATCH_TARGET || this.match.t >= MATCH_TARGET) {
			this.showMatch();
			return;
		}
		if (this.el.result) this.el.result.hidden = true;
		this.startRound(false);
	};

	RangeGame.prototype.endRound = function (win, reason, cause) {
		if (!this.round || this.round.ended) return;
		this.round.ended = true;
		this.round.phase = 'over';
		this.state = 'roundover';
		this.closeScoreboard();
		this.input.fire = false;
		this.input.defuse = false;
		this.semiQueued = false;
		this.reloading = false;
		this.scoped = false;
		this.playerPlanting = false;
		this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
		this.updateBuyHint();
		this.playerDefusing = false;
		if (this.el.defuse) this.el.defuse.hidden = true;
		if (this.el.bombhud) this.el.bombhud.hidden = true;
		if (this.el.contact) this.el.contact.hidden = true;
		if (this.el.c4tag) this.el.c4tag.hidden = true;
		if (this.el.announce) {
			this.el.announce.classList.remove('is-show', 'is-stay');
			this.el.announce.textContent = '';
		}

		var winner = win ? 'CT' : 'T';
		var playerWin = (winner === this.playerTeam);
		this.aiRecordRound(winner);
		this.roundPlayerWin = playerWin;
		var reward;
		if (playerWin) {
			reward = cause === 'defuse' ? 3500 : 3250;
			this.match.lossStreak = 0;
		} else {
			reward = clamp(1400 + this.match.lossStreak * 500, 1400, 3400);
			this.match.lossStreak++;
		}
		if (win) this.match.ct++; else this.match.t++;
		this.resultReward = reward;
		this.match.money = clamp(this.match.money + reward, 0, 16000);
		this.roundHistory.push(win ? 'ct' : 't');
		if (playerWin) this.sound.win(); else this.sound.lose();
		this.updateScoreHUD();
		this.updatePips();
		this.updateHostiles();
		this.updateHUD();

		/* The round result is a banner, not a modal page. The next round starts
		   on its own a few seconds later (Space skips). */
		if (this.el.result) this.el.result.hidden = true;
		this.showRoundBanner(playerWin, winner, reason || '', reward);
		this.resultTimer = 3.2;
	};

	RangeGame.prototype.showRoundBanner = function (playerWin, winner, reason, reward) {
		var e = this.el;
		if (!e || !e.banner) return;
		e.banner.hidden = false;
		e.banner.classList.toggle('is-win', !!playerWin);
		e.banner.classList.toggle('is-loss', !playerWin);
		e.banner.classList.toggle('is-ct', this.playerTeam === 'CT');
		e.banner.classList.toggle('is-t', this.playerTeam === 'T');
		if (e.bannerKicker) e.bannerKicker.textContent = this.tr('ROUND') + ' ' + this.match.round + ' · ' + this.tr(this.playerTeam === 'CT' ? 'COUNTER-TERRORISTS' : 'TERRORISTS');
		text(e.bannerTitle, winner === 'CT' ? 'COUNTER-TERRORISTS WIN' : 'TERRORISTS WIN');
		text(e.bannerReason, reason || '');
		text(e.bannerScore, 'CT ' + this.match.ct + ' — ' + this.match.t + ' T');
		text(e.bannerReward, '+' + fmtMoney(reward));
		text(e.bannerNext, 'NEXT ROUND IN 3');
	};

	RangeGame.prototype.hideRoundBanner = function () {
		if (this.el.banner) this.el.banner.hidden = true;
	};

	RangeGame.prototype.showMatch = function () {
		this.closeScoreboard();
		this.state = 'matchover';
		this.hideSpectate();
		this.hideRoundBanner();
		var myScore = this.playerTeam === 'CT' ? this.match.ct : this.match.t;
		var won = myScore >= MATCH_TARGET;
		var e = this.el;
		if (e.result) e.result.hidden = true;
		if (e.banner) e.banner.hidden = true;
		if (e.pause) e.pause.hidden = true;
		if (e.buy) e.buy.hidden = true;
		if (e.scoreboard) e.scoreboard.hidden = true;
		if (e.matchPanel) e.matchPanel.dataset.outcome = won ? 'won' : 'lost';
		text(e.matchTitle, won ? 'VICTORY' : 'DEFEAT');
		text(e.matchCopy, won
			? (this.playerTeam === 'CT' ? 'The sites held. Operation complete.' : 'The sites fell. Operation complete.')
			: (this.playerTeam === 'CT' ? 'The terrorist squad took the sites. Regroup and try again.' : 'The defence held. Regroup and try again.'));
		text(e.matchCt, this.match.ct);
		text(e.matchT, this.match.t);
		text(e.matchRounds, this.match.round);
		text(e.matchKills, this.match.kills);
		text(e.matchHs, this.match.hs);
		text(e.matchAcc, (this.match.shots ? Math.round(this.match.hits / this.match.shots * 100) : 0) + '%');
		if (e.match) e.match.hidden = false;
		this.releaseLock();

		var r = this.records;
		r.matches = (r.matches || 0) + 1;
		r.bestWins = Math.max(r.bestWins || 0, myScore);
		r.totalRounds = (r.totalRounds || 0) + myScore;
		r.bestRounds = Math.max(r.bestRounds || 0, myScore);
		r.bestKills = Math.max(r.bestKills || 0, this.match.kills);
		saveJSON(RECORDS_KEY, r);
		this.updateMenuStats();
		if (won) this.sound.win(); else this.sound.lose();
	};

	RangeGame.prototype.playAgain = function () {
		if (this.state !== 'matchover') return;
		if (this.el.match) this.el.match.hidden = true;
		this.sound.ensure();
		this.resetMatch();
		this.startRound(true);
		this.focusField();
		if (!this.isTouch) this.requestLock();
	};

	RangeGame.prototype.exitToGames = function () {
		this.releaseLock();
		if (global.Router && global.Router.navigate) global.Router.navigate('games');
		else global.location.hash = '#/games';
	};

	/* ======================================================================
	   player controller
	   ====================================================================== */
	RangeGame.prototype.updatePlayer = function (dt) {
		var p = this.player;
		var input = this.input;
		if (!p.alive) {
			p.deathT += dt;
			p.deathRoll = dampAngle(p.deathRoll, 0.9, 3, dt);
			return;
		}

		var frozen = this.round && this.round.phase === 'freeze';
		var speed = 0;
		var forward = 0, strafe = 0;
		if (!frozen) {
			forward = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0) + input.touchMoveY;
			strafe = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0) + input.touchMoveX;
			forward = clamp(forward, -1, 1);
			strafe = clamp(strafe, -1, 1);
		}
		var crouch = !!(this.keys.ctrl || input.touchCrouch);
		var walk = !!this.keys.shift;
		var maxSpeed = crouch ? 2.25 : walk ? 2.65 : 5.0;
		if (this.scoped) maxSpeed *= 0.65;

		/* desired velocity in world space */
		var len = Math.hypot(forward, strafe);
		if (len > 1) { forward /= len; strafe /= len; }
		var sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
		var wishX = (-sin * forward + cos * strafe) * maxSpeed;
		var wishZ = (-cos * forward - sin * strafe) * maxSpeed;
		var accel = p.onGround ? 14 : 3.4;
		p.vx = C.damp(p.vx, wishX, accel, dt);
		p.vz = C.damp(p.vz, wishZ, accel, dt);
		p.speed = Math.hypot(p.vx, p.vz);

		/* crouch / eye height */
		var wantCrouch = crouch;
		if (!wantCrouch && Math.abs(p.eyeTarget - 1.62) > 0.01) {
			/* only stand up when there is room */
			if (this.collidesAt(p.x, p.z, p.feetY, 1.78)) wantCrouch = true;
		}
		p.eyeTarget = wantCrouch ? 1.18 : 1.62;
		p.eye = C.damp(p.eye, p.eyeTarget, 12, dt);
		p.height = C.damp(p.height, wantCrouch ? 1.28 : 1.78, 12, dt);

		/* horizontal collision, axis separated for wall sliding + stair step-up */
		var nx = p.x + p.vx * dt;
		if (!this.collidesAt(nx, p.z, p.feetY, p.height) && !this.collidesChicken(nx, p.z, 0.34, p.feetY)) p.x = nx;
		else if (this.tryStepUp(nx, p.z)) p.x = nx;
		else p.vx = 0;
		var nz = p.z + p.vz * dt;
		if (!this.collidesAt(p.x, nz, p.feetY, p.height) && !this.collidesChicken(p.x, nz, 0.34, p.feetY)) p.z = nz;
		else if (this.tryStepUp(p.x, nz)) p.z = nz;
		else p.vz = 0;

		/* jump / gravity */
		if ((input.jumpQueued || this.keys.space) && p.onGround && !frozen) {
			p.vy = 4.9;
			p.onGround = false;
			this.sound.jump();
		}
		input.jumpQueued = false;
		if (!frozen) {
			p.vy -= 18 * dt;
			p.feetY += p.vy * dt;
			var support = this.supportY(p.x, p.z, p.feetY);
			if (p.vy <= 0 && p.feetY <= support + 0.04) {
				if (!p.onGround && p.vy < -3) this.sound.land(true);
				else if (!p.onGround && p.vy < -1) this.sound.land(false);
				p.feetY = support;
				p.vy = 0;
				p.onGround = true;
			} else {
				p.onGround = false;
			}
			if (p.feetY < 0) { p.feetY = 0; p.vy = 0; p.onGround = true; }
		}

		/* footsteps */
		if (p.onGround && p.speed > 1.2 && !frozen) {
			p.stepTimer -= dt;
			if (p.stepTimer <= 0) {
				p.stepTimer = walk ? 0.62 : crouch ? 0.72 : 0.38;
				this.sound.footstep(p.speed > 3.6);
			}
			p.bobPhase += dt * (6 + p.speed * 0.8);
		} else {
			p.bobPhase += dt * 1.4;
		}

		/* recoil recovery */
		this.recoilPitch = C.damp(this.recoilPitch, 0, 8, dt);
		this.recoilYaw = C.damp(this.recoilYaw, 0, 8, dt);
		this.shake = C.damp(this.shake, 0, 6, dt);
		this.swayX = C.damp(this.swayX, 0, 7, dt);
		this.swayY = C.damp(this.swayY, 0, 7, dt);

		/* FOV */
		var def = this.weaponDef(this.currentWeapon);
		var targetFov = this.scoped ? (def.scopeFov || 30) : 74;
		this.camera.fov = C.damp(this.camera.fov, targetFov, 16, dt);
		this.camera.updateProjectionMatrix();
	};

	RangeGame.prototype.updateCamera = function () {
		var p = this.player;
		if (!p.alive) {
			if (this.spectating) this.updateSpectateCamera();
			else this.updateDeathCamera();
			return;
		}
		var bob = 0, bobX = 0;
		if (!this.reduceMotion && p.onGround && p.speed > 1.2) {
			bob = Math.sin(p.bobPhase * 2.1) * 0.012 * Math.min(p.speed / 5, 1);
			bobX = Math.cos(p.bobPhase * 1.05) * 0.008 * Math.min(p.speed / 5, 1);
		}
		var shake = this.shake;
		var sx = (Math.random() - 0.5) * shake * 0.05;
		var sy = (Math.random() - 0.5) * shake * 0.05;
		var roll = 0;
		this.camera.position.set(p.x + bobX + sx, p.feetY + p.eye + bob + sy, p.z);
		var pitch = p.pitch + this.recoilPitch;
		var yaw = p.yaw + this.recoilYaw;
		this.camera.rotation.set(pitch, yaw, roll);
	};

	RangeGame.prototype.showDeathCam = function (fromBot, headshot) {
		var p = this.player;
		var weapon = fromBot && fromBot.weaponDef ? fromBot.weaponDef.name : 'UNKNOWN';
		this.deathInfo = {
			killer: fromBot || null,
			name: fromBot ? fromBot.name : 'THE RANGE',
			weapon: weapon,
			headshot: !!headshot
		};
		this.deathTimer = 1.4;
		if (this.el.announce) this.el.announce.classList.remove('is-show', 'is-stay');
		if (this.playerBody) {
			this.playerBody.visible = true;
			this.playerBody.position.set(p.x, p.feetY, p.z);
			this.playerBody.rotation.set(0, p.yaw, 0);
		}
		if (this.el.deathcam) this.el.deathcam.hidden = true;
		if (this.el.specHint) {
			this.el.specHint.hidden = false;
			text(this.el.specHint, (headshot ? 'HEADSHOT · ' : '') + 'ELIMINATED BY ' + this.deathInfo.name + ' · ' + this.deathInfo.weapon);
		}
		this.camera.fov = 74;
		this.camera.updateProjectionMatrix();
	};

	RangeGame.prototype.hideDeathCam = function () {
		if (this.playerBody) this.playerBody.visible = false;
		if (this.el.deathcam) this.el.deathcam.hidden = true;
		if (this.el.specHint) this.el.specHint.hidden = true;
		this.deathInfo = null;
	};

	RangeGame.prototype.updateDeathHUD = function () {
		if (this.el.deathTimerEl) text(this.el.deathTimerEl, String(Math.max(0, Math.ceil(this.deathTimer))));
	};

	RangeGame.prototype.updateDeathCamera = function () {
		var p = this.player;
		var info = this.deathInfo;
		var killer = info && info.killer;
		if (this.playerBody) {
			var fall = Math.min(1, p.deathT / 0.62);
			var e = 1 - Math.pow(1 - fall, 3);
			this.playerBody.position.set(p.x, p.feetY, p.z);
			this.playerBody.rotation.set(0, p.yaw, 1.36 * e);
		}
		var dx = killer ? killer.x - p.x : -Math.sin(p.yaw) * 4;
		var dz = killer ? killer.z - p.z : -Math.cos(p.yaw) * 4;
		var len = Math.hypot(dx, dz) || 1;
		dx /= len; dz /= len;
		var orbit = Math.sin(p.deathT * 0.45) * 0.24;
		var ox = dx * Math.cos(orbit) - dz * Math.sin(orbit);
		var oz = dx * Math.sin(orbit) + dz * Math.cos(orbit);
		var height = 2.35 + Math.sin(p.deathT * 0.8) * 0.05;
		var dist = 3.8;
		var camX = p.x - ox * dist, camZ = p.z - oz * dist;
		for (var d = dist; d > 1.35; d -= 0.42) {
			camX = p.x - ox * d;
			camZ = p.z - oz * d;
			if (Math.abs(camX) < 36.5 && Math.abs(camZ) < 36.5 && !this.collidesAt(camX, camZ, 0, height + 0.2)) break;
		}
		this.camera.position.set(camX, p.feetY + height, camZ);
		var lookX = p.x + dx * 1.55;
		var lookZ = p.z + dz * 1.55;
		this.camera.lookAt(lookX, p.feetY + 1.08, lookZ);
	};

	RangeGame.prototype.collidesAt = function (x, z, feetY, height) {
		var r = 0.32;
		var cols = this.world.colliders;
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (feetY + 0.06 >= c.maxY) continue;
			if (feetY + height <= c.minY + 0.02) continue;
			if (circleHitsBox(x, z, r, c)) return true;
		}
		return false;
	};

	RangeGame.prototype.collidesBot = function (x, z, r) {
		var cols = this.world.colliders;
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (c.maxY < 0.2) continue;
			if (c.minY > 1.6) continue;
			if (circleHitsBox(x, z, r, c)) return true;
		}
		return false;
	};

	RangeGame.prototype.supportY = function (x, z, feetY) {
		var best = 0;
		var r = 0.16;
		var cols = this.world.colliders;
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (c.maxY > feetY + 0.34) continue;
			if (c.maxY <= best) continue;
			if (circleHitsBox(x, z, r, c)) best = c.maxY;
		}
		return best;
	};

	RangeGame.prototype.collidesChicken = function (x, z, r, feetY) {
		if (feetY > 0.45) return false;
		for (var i = 0; i < this.chickens.length; i++) {
			var ch = this.chickens[i];
			if (!ch.alive) continue;
			if (Math.hypot(x - ch.x, z - ch.z) < r + 0.27) return true;
		}
		return false;
	};

	RangeGame.prototype.tryStepUp = function (nx, nz) {
		var p = this.player;
		if (!p.onGround || p.vy > 0.15) return false;
		var r = 0.32, maxStep = 0.46, best = 0;
		var cols = this.world.colliders;
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (!circleHitsBox(nx, nz, r, c)) continue;
			if (c.maxY > p.feetY + maxStep) return false;
			if (c.maxY > best) best = c.maxY;
		}
		if (best <= p.feetY + 0.04) return false;
		if (this.collidesAt(nx, nz, best, p.height)) return false;
		if (this.collidesChicken(nx, nz, r, best)) return false;
		p.feetY = best;
		p.vy = 0;
		p.onGround = true;
		return true;
	};

	/* ======================================================================
	   weapons
	   ====================================================================== */
	RangeGame.prototype.weaponDef = function (id) {
		return C.WEAPONS[id] || C.WEAPONS.usp;
	};

	RangeGame.prototype.equipWeapon = function (id, silent) {
		var def = this.weaponDef(id);
		if (!def) return;
		if (id === 'knife' || this.canHave(id)) {
			this.currentWeapon = id;
			this.currentSlot = def.slot;
			this.reloading = false;
			this.scoped = false;
			this.scopeT = 0;
			this.switching = silent ? 0 : 0.34;
			Object.keys(this.viewWeapons || {}).forEach(function (k) {
				var m = this.viewWeapons[k];
				if (m) m.group.visible = (k === id);
			}, this);
			if (!silent && this.sound) this.sound.switchWeapon();
			this.updateAmmoHUD();
		}
	};

	RangeGame.prototype.canHave = function (id) {
		var def = this.weaponDef(id);
		if (def.slot === 'primary') return this.loadout.primary === id;
		if (def.slot === 'secondary') return !!this.loadout.secondary;
		return true;
	};

	RangeGame.prototype.cycleWeapon = function (dir) {
		var order = ['secondary', 'primary', 'melee'];
		var ids = [this.loadout.secondary, this.loadout.primary, this.loadout.melee];
		var idx = order.indexOf(this.currentSlot);
		for (var i = 1; i <= 3; i++) {
			var n = (idx + dir * i + 9) % 3;
			if (ids[n]) { this.equipWeapon(ids[n]); return; }
		}
	};

	RangeGame.prototype.startReload = function () {
		if (!this.player.alive) return;
		var def = this.weaponDef(this.currentWeapon);
		var ammo = this.ammo[this.currentWeapon];
		if (!def || !ammo || def.slot === 'melee' || this.reloading) return;
		if (ammo.mag >= def.mag || ammo.reserve <= 0) return;
		this.reloading = true;
		this.reloadStart = this.now;
		this.reloadEnd = this.now + def.reload * 1000;
		this.scoped = false;
		this.sound.reload();
	};

	RangeGame.prototype.finishReload = function () {
		var def = this.weaponDef(this.currentWeapon);
		var ammo = this.ammo[this.currentWeapon];
		if (!def || !ammo) { this.reloading = false; return; }
		var need = def.mag - ammo.mag;
		var take = this.practice ? need : Math.min(need, ammo.reserve);
		ammo.mag += take;
		if (!this.practice) ammo.reserve -= take;
		this.reloading = false;
		this.updateAmmoHUD();
	};

	RangeGame.prototype.updateWeapon = function (dt) {
		if (this.reloading && this.now >= this.reloadEnd) this.finishReload();
		if (this.switching > 0) {
			this.switching = Math.max(0, this.switching - dt);
		}
		if (this.semiQueued) {
			this.semiQueued = false;
			this.tryFire();
		}
		var def = this.weaponDef(this.currentWeapon);
		if (def && def.auto && this.input.fire) this.tryFire();
		this.updateViewWeapon(dt);
	};

	RangeGame.prototype.currentSpread = function () {
		var def = this.weaponDef(this.currentWeapon);
		var p = this.player;
		var spread = def.spread || 0;
		var move = Math.min(p.speed / 5, 1);
		spread += (def.moveSpread || 0) * move;
		if (!p.onGround) spread += def.airSpread || 0.1;
		if (this.scoped) spread = def.scopedSpread != null ? def.scopedSpread : spread * 0.2;
		if (this.keys.shift) spread *= 0.7;
		if (this.keys.ctrl) spread *= 0.82;
		spread += Math.abs(this.recoilPitch) * 0.06;
		return spread;
	};

	RangeGame.prototype.tryFire = function () {
		if (this.state !== 'playing' || !this.player.alive) return;
		if (this.round && this.round.phase === 'freeze') return;
		if (this.reloading) return;
		if (this.now < this.nextFire) return;
		var def = this.weaponDef(this.currentWeapon);
		var ammo = this.ammo[this.currentWeapon];
		if (!def) return;
		if (def.slot === 'melee') {
			this.nextFire = this.now + 1000 * 60 / def.rpm;
			this.fireMelee(def);
			return;
		}
		if (!ammo || ammo.mag <= 0) {
			this.sound.dry();
			this.nextFire = this.now + 260;
			if (ammo && ammo.reserve > 0) this.startReload();
			this.semiQueued = false;
			return;
		}
		if (!def.auto && this.input.fire === false && !this.semiQueued) {
			/* handled by click, but keep safe */
		}
		ammo.mag--;
		this.nextFire = this.now + (60000 / def.rpm);
		this.match.shots++;
		this.roundStats.shots++;
		this.weaponKick = Math.min(1.4, this.weaponKick + 0.8);
		this.weaponKickRot = Math.min(1.2, this.weaponKickRot + 0.6);
		this.recoilPitch += def.recoil.pitch * C.rand(0.8, 1.2);
		this.recoilYaw += def.recoil.yaw * C.rand(-1.4, 1.4);
		this.shake = Math.min(1, this.shake + 0.07);
		this.flashUntil = this.now + 45;
		this.sound.shot(def.sound, 0);
		this.ejectShell();
		var pellets = def.pellets || 1;
		var anyHit = false, anyHead = false, anyKill = false;
		for (var pi = 0; pi < pellets; pi++) {
			var res = this.resolvePlayerShot(def, pellets > 1 ? 1.8 : 1);
			if (res.hit) {
				anyHit = true;
				if (res.head) anyHead = true;
				if (res.killed) anyKill = true;
			}
		}
		if (anyHit) {
			this.match.hits++;
			this.roundStats.hits++;
			this.showHitmarker(anyHead, anyKill);
			this.sound.hit(anyHead);
			if (anyHead) this.showHeadshot(anyKill);
		}
		this.updateAmmoHUD();
		this.semiQueued = false;
	};

	RangeGame.prototype.fireMelee = function (def) {
		if (this.sound) this.sound.shot('knife', 0);
		this.weaponKick = 1.1;
		this.weaponKickRot = 0.9;
		var origin = this.camera.position.clone();
		var dir = this.getAimDirection();
		this.raycaster.set(origin, dir);
		this.raycaster.far = def.range;
		var targets = this.hitTargets();
		var hits = this.raycaster.intersectObjects(targets, false);
		if (hits.length) {
			var hit = hits[0];
			var data = hit.object.userData;
			if (data && data.bot && data.bot.alive) {
				this.damageBot(data.bot, def.damage * (data.part === 'head' ? def.head : 1), data.part === 'head', 'KNIFE');
			} else {
				this.spawnImpact(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0), hit.object);
			}
		}
		this.raycaster.far = Infinity;
	};

	RangeGame.prototype.getAimDirection = function () {
		var dir = new THREE.Vector3(0, 0, -1);
		dir.applyQuaternion(this.camera.quaternion);
		return dir.normalize();
	};

	RangeGame.prototype.updateAimDirection = function (spread, out) {
		var camDir = this.getAimDirection();
		var right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
		var up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
		var a = Math.random() * Math.PI * 2;
		var r = Math.sqrt(Math.random()) * spread;
		out.copy(camDir).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
		return out;
	};

	RangeGame.prototype.hitTargets = function () {
		var out = this.hitWorld.slice();
		for (var i = 0; i < this.bots.length; i++) {
			if (this.bots[i].alive) {
				out.push(this.bots[i].robot.head, this.bots[i].robot.torso);
				if (this.bots[i].robot.bodyHit) out.push(this.bots[i].robot.bodyHit);
			}
		}
		for (var c = 0; c < this.chickens.length; c++) {
			var ch = this.chickens[c];
			if (ch && ch.alive) out.push(ch.hitbox);
		}
		for (var t = 0; t < this.targets.length; t++) {
			var tg = this.targets[t];
			if (tg && !tg.down && tg.hitMesh) out.push(tg.hitMesh);
		}
		return out;
	};

	RangeGame.prototype.rayBoxExit = function (origin, dir, c) {
		var lo = [c.minX, c.minY, c.minZ];
		var hi = [c.maxX, c.maxY, c.maxZ];
		var o = [origin.x, origin.y, origin.z];
		var d = [dir.x, dir.y, dir.z];
		var tmin = -Infinity, tmax = Infinity;
		for (var i = 0; i < 3; i++) {
			if (Math.abs(d[i]) < 1e-8) {
				if (o[i] < lo[i] || o[i] > hi[i]) return null;
			} else {
				var a = (lo[i] - o[i]) / d[i];
				var b = (hi[i] - o[i]) / d[i];
				if (a > b) { var tmp = a; a = b; b = tmp; }
				if (a > tmin) tmin = a;
				if (b < tmax) tmax = b;
				if (tmin > tmax) return null;
			}
		}
		return tmax >= 0 ? tmax : null;
	};

	RangeGame.prototype.wallPenetrationAt = function (origin, dir, hit) {
		var probe = hit.point.clone().addScaledVector(dir, 0.035);
		var bestExit = -1;
		var cols = this.world.colliders;
		var eps = 0.04;
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (probe.x < c.minX - eps || probe.x > c.maxX + eps) continue;
			if (probe.y < c.minY - eps || probe.y > c.maxY + eps) continue;
			if (probe.z < c.minZ - eps || probe.z > c.maxZ + eps) continue;
			var exit = this.rayBoxExit(origin, dir, c);
			if (exit != null && exit > hit.distance && exit > bestExit) bestExit = exit;
		}
		if (bestExit < 0) return null;
		return {
			thickness: bestExit - hit.distance,
			exitPoint: origin.clone().addScaledVector(dir, bestExit)
		};
	};

	RangeGame.prototype.resolvePlayerShot = function (def, spreadScale) {
		/* The ray leaves the camera at the exact crosshair centre. The gun is
		   only a visual: no muzzle offset is fed into hit detection. */
		var origin = this.camera.position.clone();
		var dir = new THREE.Vector3();
		this.updateAimDirection(this.currentSpread() * (spreadScale || 1), dir);
		this.raycaster.set(origin, dir);
		this.raycaster.far = def.range;
		var hits = this.raycaster.intersectObjects(this.hitTargets(), false);
		this.raycaster.far = Infinity;
		var result = { hit: false, head: false, killed: false, penetrations: 0 };
		var damageScale = 1;
		var walls = 0;
		var end = origin.clone().addScaledVector(dir, def.range);

		for (var hi = 0; hi < hits.length; hi++) {
			var hit = hits[hi];
			var data = hit.object.userData;
			if (data && data.bot && data.bot.alive) {
				if (data.bot.team === this.playerTeam) {
					this.spawnSparks(hit.point.clone(), 0x6fb2ff, 5, 1.7);
					end = hit.point.clone();
					break;
				}
				this.raiseAlert(data.bot.team, data.bot.x, data.bot.z, 'player');
				var dmg = def.damage * damageScale * (data.part === 'head' ? def.head : 1);
				if (def.pellets && hit.distance > 16) dmg *= clamp(1 - (hit.distance - 16) / 45, 0.32, 1);
				var killed = this.damageBot(data.bot, dmg, data.part === 'head', def.name);
				this.spawnSparks(hit.point.clone(), 0xffd27a, def.pellets ? 4 : 8, 3.2);
				result.hit = true;
				result.head = data.part === 'head';
				result.killed = !!killed;
				end = hit.point.clone();
				break;
			}
			if (data && data.chicken && data.chicken.alive) {
				this.killChicken(data.chicken, hit.point);
				result.hit = true;
				end = hit.point.clone();
				break;
			}
			if (data && data.target && !data.target.down) {
				this.hitPracticeTarget(data.target, hit);
				result.hit = true;
				end = hit.point.clone();
				break;
			}

			/* world geometry: only walls thinner than the penetration budget pass */
			var pen = this.wallPenetrationAt(origin, dir, hit);
			if (pen && pen.thickness <= WALL_PENETRATION_MAX && walls < WALL_PENETRATION_LAYERS) {
				walls++;
				result.penetrations++;
				damageScale *= WALL_PENETRATION_DAMAGE;
				var pn = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
				this.spawnImpact(hit.point.clone().addScaledVector(dir, -0.012), pn, hit.object);
				this.spawnSparks(pen.exitPoint || hit.point, 0xd8c09a, 4, 1.8);
				continue;
			}
			var n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
			this.spawnImpact(hit.point, n, hit.object);
			end = hit.point.clone();
			break;
		}

		var traceStart = origin.clone().addScaledVector(dir, 0.42);
		this.spawnTracer(traceStart, end, 0xffe0a0, 0.07);
		return result;
	};

	RangeGame.prototype.spawnTracer = function (from, to, color, life) {
		var geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
		var mat = new THREE.LineBasicMaterial({
			color: color, transparent: true, opacity: 0.8, depthWrite: false
		});
		var line = new THREE.Line(geo, mat);
		line.frustumCulled = false;
		this.scene.add(line);
		this.tracers.push({ line: line, life: life || 0.08, max: life || 0.08 });
		if (this.tracers.length > 40) {
			var old = this.tracers.shift();
			this.scene.remove(old.line);
			old.line.geometry.dispose();
			old.line.material.dispose();
		}
	};

	RangeGame.prototype.spawnSparks = function (point, color, count, speed) {
		var n = count || 8;
		var pos = new Float32Array(n * 3);
		var vel = [];
		for (var i = 0; i < n; i++) {
			pos[i * 3] = point.x;
			pos[i * 3 + 1] = point.y;
			pos[i * 3 + 2] = point.z;
			var a = Math.random() * Math.PI * 2;
			var b = Math.random() * Math.PI - Math.PI / 2;
			var s = (speed || 3) * (0.4 + Math.random() * 0.8);
			vel.push(new THREE.Vector3(Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + 1.2, Math.sin(a) * Math.cos(b) * s));
		}
		var geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		var mat = new THREE.PointsMaterial({
			color: color || 0xffc060, size: 0.055, transparent: true,
			opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending
		});
		var points = new THREE.Points(geo, mat);
		this.fxGroup.add(points);
		this.sparks.push({ points: points, vel: vel, life: 0.55, max: 0.55 });
	};

	RangeGame.prototype.spawnImpact = function (point, normal, object) {
		this.spawnSparks(point, 0xd8c09a, 6, 2.0);
		var n = normal.clone().normalize();
		var decal = this.decals[this.decalIndex % this.decals.length];
		this.decalIndex++;
		decal.visible = true;
		decal.position.copy(point).addScaledVector(n, 0.012);
		decal.lookAt(this.tmpA.copy(decal.position).add(n));
		var scale = 0.8 + Math.random() * 0.5;
		decal.scale.set(scale, scale, 1);
	};

	RangeGame.prototype.ejectShell = function () {
		var shell = this.shells[this.shellIndex % this.shells.length];
		this.shellIndex++;
		if (!shell) return;
		var right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
		var up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
		shell.mesh.position.copy(this.camera.position)
			.addScaledVector(right, 0.22).addScaledVector(up, -0.14);
		shell.mesh.visible = true;
		shell.life = 1.2;
		shell.vx = right.x * C.rand(1.2, 2.6) + C.rand(-0.4, 0.4);
		shell.vy = C.rand(1.4, 2.6);
		shell.vz = right.z * C.rand(1.2, 2.6) + C.rand(-0.4, 0.4);
		shell.spin = C.rand(-12, 12);
	};

	RangeGame.prototype.updateFx = function (dt) {
		var i, self = this;
		this.updateDrops(dt);
		/* tracers */
		for (i = this.tracers.length - 1; i >= 0; i--) {
			var tr = this.tracers[i];
			tr.life -= dt;
			if (tr.life <= 0) {
				this.scene.remove(tr.line);
				tr.line.geometry.dispose();
				tr.line.material.dispose();
				this.tracers.splice(i, 1);
			} else {
				tr.line.material.opacity = clamp(tr.life / tr.max, 0, 1) * 0.8;
			}
		}
		/* sparks */
		for (i = this.sparks.length - 1; i >= 0; i--) {
			var sp = this.sparks[i];
			sp.life -= dt;
			if (sp.life <= 0) {
				this.fxGroup.remove(sp.points);
				sp.points.geometry.dispose();
				sp.points.material.dispose();
				this.sparks.splice(i, 1);
				continue;
			}
			var attr = sp.points.geometry.attributes.position;
			for (var j = 0; j < sp.vel.length; j++) {
				var v = sp.vel[j];
				v.y -= 9 * dt;
				attr.array[j * 3] += v.x * dt;
				attr.array[j * 3 + 1] += v.y * dt;
				attr.array[j * 3 + 2] += v.z * dt;
			}
			attr.needsUpdate = true;
			sp.points.material.opacity = clamp(sp.life / sp.max, 0, 1);
		}
		/* shells */
		for (i = 0; i < this.shells.length; i++) {
			var sh = this.shells[i];
			if (sh.life <= 0) continue;
			sh.life -= dt;
			sh.vy -= 14 * dt;
			sh.mesh.position.x += sh.vx * dt;
			sh.mesh.position.y += sh.vy * dt;
			sh.mesh.position.z += sh.vz * dt;
			sh.mesh.rotation.x += sh.spin * dt;
			sh.mesh.rotation.z += sh.spin * 0.7 * dt;
			if (sh.life <= 0 || sh.mesh.position.y < 0.01) {
				sh.mesh.visible = false;
				sh.life = 0;
			}
		}
		/* debris (robot heads) */
		for (i = this.debris.length - 1; i >= 0; i--) {
			var db = this.debris[i];
			db.life -= dt;
			db.vy -= 12 * dt;
			db.mesh.position.x += db.vx * dt;
			db.mesh.position.y += db.vy * dt;
			db.mesh.position.z += db.vz * dt;
			db.mesh.rotation.x += db.spin * dt;
			db.mesh.rotation.y += db.spin * 0.6 * dt;
			if (db.mesh.position.y < 0.12) { db.mesh.position.y = 0.12; db.vy *= -0.35; db.vx *= 0.65; db.vz *= 0.65; }
			if (db.life <= 0) {
				this.scene.remove(db.mesh);
				db.mesh.geometry.dispose();
				if (db.mesh.material) db.mesh.material.dispose();
				this.debris.splice(i, 1);
			}
		}
		/* dust drift */
		if (this.world && this.world.dust) {
			var dust = this.world.dust;
			var arr = dust.geometry.attributes.position.array;
			for (i = 0; i < arr.length; i += 3) {
				arr[i] += Math.sin(this.gameTime * 0.2 + i) * 0.002;
				arr[i + 1] += Math.cos(this.gameTime * 0.12 + i) * 0.001;
			}
			dust.geometry.attributes.position.needsUpdate = true;
		}
		/* muzzle flash */
		if (this.now > this.flashUntil) {
			if (this.flashSprite) this.flashSprite.visible = false;
			if (this.flashLight) this.flashLight.intensity = 0;
		}
		for (i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (b.flash && b.flash.visible && this.now > b.flashUntil) b.flash.visible = false;
		}
	};

	/* ======================================================================
	   view-model animation
	   ====================================================================== */
	RangeGame.prototype.updateViewWeapon = function (dt) {
		if (!this.viewWeapons) return;
		var id = this.currentWeapon;
		var def = this.weaponDef(id);
		var model = this.viewWeapons[id];
		if (!model) return;
		Object.keys(this.viewWeapons).forEach(function (k) {
			this.viewWeapons[k].group.visible = (k === id) && !this.scoped;
		}, this);
		if (this.scoped) return;
		var base = this.weaponBase[id];
		var g = model.group;
		var p = this.player;
		var portrait = this.camera.aspect < 0.9;
		g.scale.setScalar(base.scale * (portrait ? 0.72 : 1));

		this.weaponKick = C.damp(this.weaponKick, 0, 12, dt);
		this.weaponKickRot = C.damp(this.weaponKickRot, 0, 10, dt);
		var move = Math.min(p.speed / 5, 1);
		var t = this.gameTime;
		var breathe = this.reduceMotion ? 0 : Math.sin(t * 1.7) * 0.0025;
		var bobX = this.reduceMotion ? 0 : Math.sin(p.bobPhase * 1.05) * 0.008 * move;
		var bobY = this.reduceMotion ? 0 : Math.abs(Math.cos(p.bobPhase * 1.05)) * 0.006 * move;
		var reloadP = 0;
		if (this.reloading) {
			var total = Math.max(1, this.reloadEnd - this.reloadStart);
			reloadP = clamp((this.now - this.reloadStart) / total, 0, 1);
		}
		var reloadDrop = Math.sin(reloadP * Math.PI) * 0.2;
		var reloadRot = Math.sin(reloadP * Math.PI) * 0.65;
		var switchDrop = this.switching > 0 ? Math.sin((this.switching / 0.34) * Math.PI) * 0.32 : 0;

		var swayTargetX = clamp(this.swayX, -0.02, 0.02);
		var swayTargetY = clamp(this.swayY, -0.02, 0.02);

		g.position.set(
			base.pos.x * (portrait ? 0.36 : 1) + bobX + swayTargetX,
			base.pos.y + (portrait ? 0.045 : 0) + bobY + breathe - reloadDrop - switchDrop,
			base.pos.z + (portrait ? 0.035 : 0) + this.weaponKick * 0.035
		);
		g.rotation.set(
			base.rot.x + this.weaponKickRot * 0.11 + reloadRot * 0.35,
			base.rot.y + swayTargetX * 1.4,
			base.rot.z + swayTargetX * 2.2 + reloadRot * 0.5
		);
		/* magazine drop during reload */
		if (model.mag && Array.isArray(model.mag)) {
			model.mag.forEach(function (m, i) {
				if (!m) return;
				if (!m.userData.base) m.userData.base = m.position.clone();
				var bp = m.userData.base;
				var drop = Math.sin(reloadP * Math.PI) * 0.12;
				m.position.y = bp.y - drop;
				m.position.z = bp.z + drop * 0.4;
			});
		}
		/* muzzle flash */
		if (this.now <= this.flashUntil && this.flashSprite) {
			model.muzzle.updateWorldMatrix(true, false);
			model.muzzle.getWorldPosition(this.tmpA);
			this.flashSprite.position.copy(this.tmpA);
			this.flashSprite.visible = true;
			this.flashSprite.material.opacity = 1;
			if (this.flashLight) {
				this.flashLight.position.copy(this.tmpA);
				this.flashLight.intensity = 2.6;
			}
		}
		/* weapon scale with view aspect? keep base */
	};

	RangeGame.prototype.updateCrosshair = function () {
		if (!this.el.crosshair) return;
		var scoped = this.scoped || !this.player.alive;
		this.el.crosshair.classList.toggle('is-hidden', scoped);
		if (scoped) return;
		var def = this.weaponDef(this.currentWeapon);
		var move = Math.min(this.player.speed / 5, 1);
		var gap = 3 + (def.spread || 0) * 800 + move * 5 + (this.player.onGround ? 0 : 6) + Math.abs(this.recoilPitch) * 60;
		gap = clamp(gap, 3, 26);
		this.el.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
		var low = this.el.health && this.el.health.parentNode;
		if (low) low.classList.toggle('is-low', this.player.health <= 25);
	};

	RangeGame.prototype.updateScopeVisual = function () {
		if (!this.el.scope) return;
		var def = this.weaponDef(this.currentWeapon);
		var want = this.scoped && !!def.scope && this.player.alive;
		this.el.scope.hidden = !want;
		if (want) {
			if (this.el.scopeLabel) text(this.el.scopeLabel, def.name + ' // SCOPED');
			Object.keys(this.viewWeapons || {}).forEach(function (k) {
				this.viewWeapons[k].group.visible = false;
			}, this);
		}
	};

	RangeGame.prototype.toggleScope = function () {
		var def = this.weaponDef(this.currentWeapon);
		if (!def.scope) return;
		if (this.reloading) return;
		this.scoped = !this.scoped;
		if (this.sound) this.sound.scope();
		this.updateScopeVisual();
	};

	/* ======================================================================
	   robot AI
	   ====================================================================== */
	/* ======================================================================
	   robot AI — two teams, C4 duty, holds and covering fire
	   ====================================================================== */
	/* --- team alerts, spectator-style info and idle relocation --------------- */
	RangeGame.prototype.calloutAt = function (x, z) {
		if (!this.world || !this.world.callouts) return 'CONTACT';
		var sites = this.world.sites || [];
		for (var i = 0; i < sites.length; i++) {
			var s = sites[i];
			if (Math.hypot(x - s.x, z - s.z) < s.r + 3) return s.id + ' SITE';
		}
		var best = null, bestD = 1e9;
		for (var c = 0; c < this.world.callouts.length; c++) {
			var co = this.world.callouts[c];
			var d = Math.hypot(x - co.x, z - co.z);
			if (d < bestD) { bestD = d; best = co; }
		}
		return best ? best.name : 'CONTACT';
	};

	RangeGame.prototype.assignSupporters = function (team, alert) {
		var b = this.bomb;
		if (b && (b.state === 'planted' || b.state === 'planting')) return 0;
		var now = this.now;
		var list = [];
		var bots = this.teamBots(team, true);
		for (var i = 0; i < bots.length; i++) {
			var bot = bots[i];
			if (bot.hasBomb || bot.planting) continue;
			if (b && b.defuser === bot) continue;
			if (Math.hypot(bot.x - alert.x, bot.z - alert.z) < 9) continue;
			list.push(bot);
		}
		list.sort(function (a, c) {
			return Math.hypot(a.x - alert.x, a.z - alert.z) - Math.hypot(c.x - alert.x, c.z - alert.z);
		});
		var max = team === 'T' ? 2 : 1;
		var n = 0;
		for (var j = 0; j < list.length && n < max; j++) {
			var bot2 = list[j];
			bot2.supportUntil = now + 6500;
			bot2.supportTarget = { x: alert.x, z: alert.z };
			bot2.supportAlertId = alert.id;
			bot2.roamTarget = null;
			bot2.roamWaitUntil = 0;
			bot2.path = null;
			bot2.pathGoal = null;
			n++;
		}
		return n;
	};

	RangeGame.prototype.raiseAlert = function (team, x, z, source) {
		if (this.state !== 'playing' || !this.round || this.round.phase !== 'live') return null;
		if (!this.teamAlerts) this.teamAlerts = { CT: null, T: null };
		var now = this.now;
		var prev = this.teamAlerts[team];
		if (prev) {
			prev.seenAt = now;
			if (Math.hypot(prev.x - x, prev.z - z) < 10 && now - prev.raisedAt < 9000) {
				if (team === this.playerTeam) this.updateContactHUD();
				return prev;
			}
		}
		var alert = {
			id: ++this.alertSeq,
			team: team, x: x, z: z,
			label: this.calloutAt(x, z),
			raisedAt: now, seenAt: now,
			source: (source && source.name) ? source.name : (source || null),
			supporters: 0
		};
		this.teamAlerts[team] = alert;
		alert.supporters = this.assignSupporters(team, alert);
		if (team === this.playerTeam) {
			this.contactAlert = alert;
			this.updateContactHUD();
			this.sound.tone({ freq: 940, to: 1280, dur: 0.07, gain: 0.07, type: 'square' });
			this.sound.tone({ freq: 560, dur: 0.05, gain: 0.035, type: 'sine', delay: 0.08 });
		}
		return alert;
	};

	RangeGame.prototype.updateContactHUD = function () {
		if (!this.el || !this.el.contact) return;
		var a = this.teamAlerts && this.teamAlerts[this.playerTeam];
		if (!a || this.now - a.seenAt > 5000 || this.state === 'roundover' || this.state === 'matchover') {
			this.el.contact.hidden = true;
			return;
		}
		this.el.contact.hidden = false;
		text(this.el.contactLabel, a.label || 'CONTACT');
		text(this.el.contactNote, a.supporters > 0 ? 'ALLY ROTATING' : 'ENEMY SPOTTED');
	};

	RangeGame.prototype.checkPlayerContact = function (dt) {
		this.playerContactTimer = (this.playerContactTimer || 0) - dt;
		if (this.playerContactTimer > 0) return;
		this.playerContactTimer = 0.22;
		var p = this.player;
		if (!p.alive || this.state !== 'playing' || !this.round || this.round.phase !== 'live') return;
		var dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
		var fl = Math.hypot(dir.x, dir.z) || 1;
		var ts = this.teamBots(this.enemyTeam, true);
		for (var i = 0; i < ts.length; i++) {
			var t = ts[i];
			var dx = t.x - p.x, dz = t.z - p.z;
			var dist = Math.hypot(dx, dz);
			if (dist > 42 || dist < 0.5) continue;
			var dot = (dir.x * (dx / dist) + dir.z * (dz / dist)) / fl;
			if (dist > 7 && dot < 0.25) continue;
			if (this.pointHasLos(p.x, p.feetY + p.eye, p.z, t.x, 1.36 * t.baseScale, t.z)) {
				this.raiseAlert(this.playerTeam, t.x, t.z, 'player');
				break;
			}
		}
	};

	RangeGame.prototype.pickRoamPoint = function (bot, post) {
		var siteId = (this.bomb && this.bomb.site) || bot.site || 'A';
		var site = this.siteById(siteId);
		var holds = bot.team === 'CT'
			? (siteId === 'A' ? this.world.holds.ctA : this.world.holds.ctB)
			: (siteId === 'A' ? this.world.holds.tA : this.world.holds.tB);
		var planted = !!(this.bomb && this.bomb.state === 'planted');
		var radius = planted ? 7.0 : 11.0;
		var candidates = [];
		var holdList = holds || [];
		for (var i = 0; i < holdList.length; i++) {
			var h = holdList[i];
			if (Math.hypot(h.x - bot.x, h.z - bot.z) < 2.2) continue;
			candidates.push({ x: h.x + C.rand(-1.2, 1.2), z: h.z + C.rand(-1.2, 1.2) });
		}
		var cx = post ? post.x : (site ? site.x : bot.x);
		var cz = post ? post.z : (site ? site.z : bot.z);
		for (var a = 0; a < 8; a++) {
			var ang = C.rand(0, Math.PI * 2);
			var r = C.rand(3, radius);
			candidates.push({ x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r });
		}
		if (site) {
			for (var b2 = 0; b2 < 4; b2++) {
				var ang2 = C.rand(0, Math.PI * 2);
				var r2 = C.rand(3, radius);
				candidates.push({ x: site.x + Math.cos(ang2) * r2, z: site.z + Math.sin(ang2) * r2 });
			}
		}
		C.shuffle(candidates);
		var tried = 0;
		for (var k = 0; k < candidates.length; k++) {
			var q = candidates[k];
			if (Math.abs(q.x) > this.world.bounds - 2 || Math.abs(q.z) > this.world.bounds - 2) continue;
			if (this.collidesBot(q.x, q.z, 0.55)) continue;
			if (this.world.walkableAt && !this.world.walkableAt(q.x, q.z)) continue;
			if (Math.hypot(q.x - bot.x, q.z - bot.z) < 2.4) continue;
			var path = C.findPath(this.nav, bot.x, bot.z, q.x, q.z);
			if (!path || !path.length) { if (++tried > 5) break; continue; }
			return { x: q.x, z: q.z };
		}
		return null;
	};

	RangeGame.prototype.botMaybeRoam = function (bot, post, dt) {
		var now = this.now;
		if (bot.supportTarget && now < bot.supportUntil) return false;
		if (now < (bot.roamNextAt || 0)) return false;
		if (this.bomb && this.bomb.state === 'planting') return false;
		if (this.bomb && this.bomb.state === 'planted' && this.bomb.defuser === bot) return false;
		if (this.bomb && this.bomb.state === 'planted' && bot.team === 'CT' && (this.bomb.defuser || this.playerDefusing)) return false;
		if (!bot.roamTarget) {
			bot.roamTarget = this.pickRoamPoint(bot, post);
			bot.roamWaitUntil = 0;
			if (!bot.roamTarget) {
				bot.roamNextAt = now + C.rand(4, 8);
				return false;
			}
			bot.path = null;
			bot.pathGoal = null;
		}
		var d = Math.hypot(bot.roamTarget.x - bot.x, bot.roamTarget.z - bot.z);
		if (d > 1.0) {
			this.botPathTo(bot, bot.roamTarget.x, bot.roamTarget.z, bot.speed * 0.9, dt);
			bot.mode = 'roam';
			return true;
		}
		bot.moveX = 0;
		bot.moveZ = 0;
		bot.mode = 'roam';
		if (!bot.roamWaitUntil) bot.roamWaitUntil = now + C.rand(1.2, 2.6);
		if (now < bot.roamWaitUntil) {
			var scan = now * 0.0011 + bot.scanPhase;
			bot.face = { x: bot.x + Math.cos(scan) * 3, z: bot.z + Math.sin(scan) * 3 };
			return true;
		}
		bot.roamTarget = null;
		bot.roamWaitUntil = 0;
		bot.roamCount = (bot.roamCount || 0) + 1;
		if (bot.roamCount < 2) {
			bot.roamTarget = this.pickRoamPoint(bot, post);
			if (bot.roamTarget) {
				bot.path = null;
				bot.pathGoal = null;
				bot.mode = 'roam';
				return true;
			}
		}
		bot.roamCount = 0;
		bot.roamNextAt = now + C.rand(7, 12);
		return false;
	};

	RangeGame.prototype.updateBots = function (dt) {
		this.decayTeamFear(dt);
		this.updateGamble();
		for (var i = 0; i < this.bots.length; i++) {
			var bot = this.bots[i];
			if (bot) this.updateBot(bot, dt);
		}
		this.checkTeamStall();
	};

	RangeGame.prototype.pointHasLos = function (fx, fy, fz, px, py, pz) {
		var from = this.tmpB.set(fx, fy, fz);
		var to = this.tmpC.set(px, py, pz);
		var dir = new THREE.Vector3().subVectors(to, from);
		var dist = dir.length();
		if (dist < 0.1) return true;
		dir.normalize();
		this.raycaster.set(from, dir);
		this.raycaster.far = dist - 0.15;
		var hits = this.raycaster.intersectObjects(this.hitWorld, false);
		this.raycaster.far = Infinity;
		return hits.length === 0;
	};

	RangeGame.prototype.panFor = function (x, z) {
		var right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
		var dir = new THREE.Vector3(x - this.player.x, 0, z - this.player.z);
		if (dir.lengthSq() < 0.001) return 0;
		dir.normalize();
		return clamp(dir.dot(right), -1, 1) * 0.65;
	};

	RangeGame.prototype.botLineOfSight = function (bot, px, py, pz) {
		return this.pointHasLos(bot.x, 1.48 * bot.baseScale, bot.z, px, py, pz);
	};

	RangeGame.prototype.playerTargetInfo = function () {
		var p = this.player;
		return {
			kind: 'player', alive: p.alive, x: p.x, z: p.z,
			feetY: p.feetY, eye: p.feetY + p.eye,
			speed: p.speed, name: 'YOU', team: this.playerTeam, bot: null
		};
	};

	RangeGame.prototype.botTargetInfo = function (b) {
		return {
			kind: 'bot', alive: b.alive && !b.dead, x: b.x, z: b.z,
			feetY: 0, eye: 1.36 * b.baseScale,
			speed: b.moveSpeed || 0, name: b.name, team: b.team, bot: b
		};
	};

	RangeGame.prototype.botCanSee = function (bot, target) {
		if (!target || !target.alive) return false;
		var dx = target.x - bot.x, dz = target.z - bot.z;
		var diff = bot.diff || this.difficultyFor(bot.team);
		var maxRange = ((bot.weaponDef && bot.weaponDef.category === 'SNIPER') ? 42 : 34) * (diff.sight || 1);
		if (dx * dx + dz * dz > maxRange * maxRange) return false;
		return this.pointHasLos(bot.x, 1.48 * bot.baseScale, bot.z, target.x, target.eye, target.z);
	};

	RangeGame.prototype.botPerception = function (bot) {
		if (bot.target && bot.target.alive && this.botCanSee(bot, bot.target)) {
			if (bot.target.kind === 'bot') bot.target.bot.spottedUntil = this.now + 2000;
			return bot.target;
		}
		var candidates = [];
		var enemyTeam = bot.team === 'CT' ? 'T' : 'CT';
		if (this.player.alive && this.playerTeam === enemyTeam) candidates.push(this.playerTargetInfo());
		var enemies = this.teamBots(enemyTeam, true);
		for (var i = 0; i < enemies.length; i++) candidates.push(this.botTargetInfo(enemies[i]));
		candidates.sort(function (a, b) {
			return Math.hypot(a.x - bot.x, a.z - bot.z) - Math.hypot(b.x - bot.x, b.z - bot.z);
		});
		var limit = Math.min(candidates.length, 4);
		for (var c = 0; c < limit; c++) {
			var t = candidates[c];
			if (this.botCanSee(bot, t)) {
				if (t.kind === 'bot') t.bot.spottedUntil = this.now + 2000;
				return t;
			}
		}
		return null;
	};

	RangeGame.prototype.botHear = function (bot, diff) {
		diff = diff || bot.diff || this.difficultyFor(bot.team);
		if (!diff.hearing) return;
		var now = this.now;
		if (now - (bot.hearCheck || 0) < 300) return;
		bot.hearCheck = now;
		var enemyTeam = bot.team === 'CT' ? 'T' : 'CT';
		var best = null, bestD = 1e9;
		var p = this.player;
		if (p.alive && this.playerTeam === enemyTeam) {
			var stride = this.keys.shift ? 0.55 : this.keys.ctrl ? 0.35 : 1;
			var pd = Math.hypot(p.x - bot.x, p.z - bot.z);
			if (p.speed > 0.9 && pd < diff.hearing * stride) { best = { x: p.x, z: p.z }; bestD = pd; }
		}
		var enemies = this.teamBots(enemyTeam, true);
		for (var i = 0; i < enemies.length; i++) {
			var eb = enemies[i];
			var sp = eb.moveSpeed || 0;
			if (sp < 1.1) continue;
			var d = Math.hypot(eb.x - bot.x, eb.z - bot.z);
			if (d < diff.hearing * (sp > 2.4 ? 1 : 0.72) && d < bestD) {
				best = { x: eb.x, z: eb.z };
				bestD = d;
			}
		}
		if (best) {
			bot.lastHeard = { x: best.x, z: best.z, t: now };
			if ((diff.hearing >= 14 || (diff.planning || 0) >= 0.8) && now - (bot.hearAlertAt || 0) > 2500) {
				bot.hearAlertAt = now;
				this.raiseAlert(bot.team, best.x, best.z, 'sound');
			}
		}
	};

	RangeGame.prototype.botUpdatePerception = function (bot, dt) {
		var diff = bot.diff || this.difficultyFor(bot.team);
		bot.think -= dt;
		if (bot.think > 0) return;
		bot.think = C.rand(0.2, 0.34) * (diff.think || 1);
		var t = this.botPerception(bot);
		this.botHear(bot, diff);
		var key = t ? (t.kind + (t.bot ? t.bot.id : 'p')) : '';
		if (key !== bot.targetKey) {
			bot.targetKey = key;
			bot.reaction = 0;
			bot.reactionDone = false;
			if (t) {
				/* High skill snaps onto a fresh target and fires much sooner. */
				var firstDelay = (bot.type.reaction * diff.reaction + C.rand(0, 0.08)) * 1000;
				bot.nextShot = Math.min(bot.nextShot || 1e9, this.now + firstDelay);
			}
		}
		if (t) {
			if (bot.gamble) {
				bot.gamble = false;
				bot.gamblePoint = null;
				if (this.gamblers && this.gamblers[bot.team] === bot) this.gamblers[bot.team] = null;
			}
			bot.lastSeen = { x: t.x, z: t.z, t: this.now };
			bot.lastEnemySeenAt = this.now;
			bot.roamNextAt = this.now + C.rand((bot.idleLimit || 10) * 0.85, (bot.idleLimit || 10) * 1.15);
			bot.roamTarget = null;
			bot.roamWaitUntil = 0;
			bot.roamCount = 0;
			this.raiseAlert(bot.team, t.x, t.z, bot);
		}
		bot.target = t;
	};

	RangeGame.prototype.botPathTo = function (bot, tx, tz, speed, dt) {
		var goalDist = Math.hypot(tx - bot.x, tz - bot.z);
		if (goalDist < 0.5) { bot.moveX = 0; bot.moveZ = 0; return true; }
		bot.pathTimer -= dt;
		if (!bot.path || bot.pathTimer <= 0 || !bot.pathGoal ||
			Math.hypot(bot.pathGoal.x - tx, bot.pathGoal.z - tz) > 2.2) {
			bot.path = C.findPath(this.nav, bot.x, bot.z, tx, tz);
			bot.pathIndex = 0;
			bot.pathTimer = C.rand(0.9, 1.4);
			bot.pathGoal = { x: tx, z: tz };
		}
		var wx = tx, wz = tz;
		if (bot.path && bot.path.length) {
			while (bot.pathIndex < bot.path.length) {
				var wp = bot.path[bot.pathIndex];
				if (Math.hypot(wp.x - bot.x, wp.z - bot.z) < 0.62) bot.pathIndex++;
				else break;
			}
			if (bot.pathIndex < bot.path.length) {
				wx = bot.path[bot.pathIndex].x;
				wz = bot.path[bot.pathIndex].z;
			}
		} else {
			var snapped = this.snapFreePoint(tx, tz, 0.46);
			wx = snapped.x;
			wz = snapped.z;
			/* A missing path must not turn into a blind beeline through a
			   corner; stand and retry instead. */
			if (Math.hypot(wx - bot.x, wz - bot.z) > 1.2) {
				bot.moveX = 0;
				bot.moveZ = 0;
				return false;
			}
		}
		var dx = wx - bot.x, dz = wz - bot.z;
		var d = Math.hypot(dx, dz);
		if (d > 0.2) {
			bot.moveX = dx / d * speed;
			bot.moveZ = dz / d * speed;
		} else {
			bot.moveX = 0;
			bot.moveZ = 0;
		}
		return goalDist < 0.9;
	};

	RangeGame.prototype.botFollowRoute = function (bot, dt) {
		if (!bot.route || !bot.route.length) return true;
		if (bot.routeIndex >= bot.route.length) return true;
		var wp = bot.route[bot.routeIndex];
		var d = Math.hypot(wp.x - bot.x, wp.z - bot.z);
		if (d < 1.3) {
			bot.routeIndex++;
			bot.path = null;
			if (bot.routeIndex >= bot.route.length) {
				bot.atSite = true;
				return true;
			}
			wp = bot.route[bot.routeIndex];
		}
		this.botPathTo(bot, wp.x, wp.z, bot.speed * 0.98, dt);
		return false;
	};

	RangeGame.prototype.tPostFor = function (bot) {
		var site = (this.bomb && this.bomb.site) ? this.bomb.site : (bot.site || this.tSite || 'A');
		var holds = site === 'A' ? this.world.holds.tA : this.world.holds.tB;
		if (!holds || !holds.length) return null;
		var post = holds[bot.guardIndex % holds.length];
		if (!post) return null;
		var p = this.snapFreePoint(post.x, post.z, 0.46);
		return { x: p.x, z: p.z, lx: post.lx, lz: post.lz };
	};

	RangeGame.prototype.ctPostFor = function (bot, site) {
		var holds = site === 'A' ? this.world.holds.ctA : this.world.holds.ctB;
		if (!holds || !holds.length) return null;
		var post = holds[bot.guardIndex % holds.length] || holds[0];
		if (!post) return null;
		var p = this.snapFreePoint(post.x, post.z, 0.46);
		return { x: p.x, z: p.z, lx: post.lx, lz: post.lz };
	};

	RangeGame.prototype.siteById = function (id) {
		if (!this.world || !this.world.sites) return null;
		for (var i = 0; i < this.world.sites.length; i++) {
			if (this.world.sites[i].id === id) return this.world.sites[i];
		}
		return null;
	};

	RangeGame.prototype.botHoldAt = function (bot, post, dt) {
		if (!post) { bot.moveX = 0; bot.moveZ = 0; return; }
		if (this.botMaybeRoam(bot, post, dt)) return;
		var d = Math.hypot(post.x - bot.x, post.z - bot.z);
		if (d > 1.1) {
			this.botPathTo(bot, post.x, post.z, bot.speed * 0.92, dt);
			bot.mode = 'rotate';
		} else {
			bot.moveX = 0;
			bot.moveZ = 0;
			bot.mode = 'hold';
			var scan = Math.sin(this.now * 0.00045 + bot.scanPhase) * 2.4;
			bot.face = { x: (post.lx || post.x) + scan * 0.5, z: (post.lz || post.z) + scan * 0.5 };
		}
	};

	RangeGame.prototype.nearestBombSeeker = function () {
		var b = this.bomb;
		if (!b) return null;
		var best = null, bestD = 1e9;
		var ts = this.teamBots('T', true);
		for (var i = 0; i < ts.length; i++) {
			var d = Math.hypot(ts[i].x - b.x, ts[i].z - b.z);
			if (d < bestD) { bestD = d; best = ts[i]; }
		}
		return best;
	};

	RangeGame.prototype.tacticalSamples = function (bot, px, py, pz) {
		var eye = 1.48 * bot.baseScale;
		var out = [];
		var radii = [1.9, 3.0, 4.4, 6.0];
		var bound = this.world.bounds - 1.6;
		for (var ri = 0; ri < radii.length; ri++) {
			var r = radii[ri];
			for (var ai = 0; ai < 12; ai++) {
				var a = (ai / 12) * Math.PI * 2;
				var x = bot.x + Math.cos(a) * r;
				var z = bot.z + Math.sin(a) * r;
				if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
				if (this.collidesBot(x, z, 0.5)) continue;
				out.push({ x: x, z: z, dist: r, los: this.pointHasLos(x, eye, z, px, py, pz) });
			}
		}
		return out;
	};

	RangeGame.prototype.findCoverPoint = function (bot, px, py, pz) {
		if (!this.pointHasLos(bot.x, 1.48 * bot.baseScale, bot.z, px, py, pz)) {
			return { x: bot.x, z: bot.z };
		}
		var samples = this.tacticalSamples(bot, px, py, pz).filter(function (s) { return !s.los && s.dist >= 1.8; });
		samples.sort(function (a, b) { return a.dist - b.dist; });
		for (var i = 0; i < samples.length && i < 6; i++) {
			var s = samples[i];
			var path = C.findPath(this.nav, bot.x, bot.z, s.x, s.z);
			if (path && path.length) return { x: s.x, z: s.z };
		}
		return { x: bot.x, z: bot.z };
	};

	RangeGame.prototype.startBotReload = function (bot, px, py, pz) {
		if (bot.reloading) return;
		if (!bot.weaponDef || bot.weaponDef.slot === 'melee') return;
		if (!bot.ammo && !(bot.weapons && bot.weapons[bot.weaponIndex])) return;
		bot.reloading = true;
		var def = bot.weaponDef || C.WEAPONS.ak47;
		bot.reloadEnd = this.now + def.reload * 1000 * C.rand(0.9, 1.15);
		var rec = bot.weapons && bot.weapons[bot.weaponIndex];
		if (rec) { rec.reloading = true; rec.reloadEnd = bot.reloadEnd; }
		bot.burstLeft = 0;
		bot.behavior = 'reload';
		bot.mode = 'reload';
		bot.reactionDone = false;
		bot.reaction = 0;
		bot.robot.reloading = true;
		bot.reloadGoal = null;
		if (px != null) {
			var cover = this.findCoverPoint(bot, px, py, pz);
			if (cover && Math.hypot(cover.x - bot.x, cover.z - bot.z) > 0.8) bot.reloadGoal = cover;
		}
		var dist = Math.hypot(this.player.x - bot.x, this.player.z - bot.z);
		if (dist < 24) {
			this.sound.burst({ dur: 0.06, type: 'bandpass', freq: 900, q: 1.2, gain: 0.04 * (1 - dist / 30), pan: this.panFor(bot.x, bot.z) });
		}
	};

	RangeGame.prototype.finishBotReload = function (bot) {
		bot.reloading = false;
		bot.ammo = bot.magSize;
		var rec = bot.weapons && bot.weapons[bot.weaponIndex];
		if (rec) { rec.ammo = bot.ammo; rec.reloading = false; rec.reloadEnd = 0; }
		bot.behavior = 'advance';
		bot.reactionDone = false;
		bot.reaction = 0;
		bot.robot.reloading = false;
		bot.stationaryUntil = 0;
		bot.reloadGoal = null;
		bot.path = null;
		C.drawHealthSprite(bot.robot);
		var dist = Math.hypot(this.player.x - bot.x, this.player.z - bot.z);
		if (dist < 24) {
			this.sound.burst({ dur: 0.04, type: 'bandpass', freq: 1500, q: 1.1, gain: 0.035 * (1 - dist / 30), pan: this.panFor(bot.x, bot.z) });
		}
	};

	RangeGame.prototype.botMelee = function (bot, target, dist, diff) {
		if (!target || !target.alive || dist > 2.35 || this.now < bot.nextShot) return;
		bot.nextShot = this.now + 560 * diff.fire * C.rand(0.9, 1.15);
		bot.stationaryUntil = this.now + 220;
		bot.meleeUntil = this.now + 280;
		bot.reactionDone = true;
		bot.reaction = 0;
		this.sound.shot('knife', this.panFor(bot.x, bot.z), Math.min(dist, 12));
		if (Math.random() < clamp(0.55 + (2.35 - dist) * 0.2, 0.4, 0.9)) {
			var dmg = bot.damage * 0.7 * diff.damage * C.rand(0.85, 1.15);
			if (target.kind === 'player') this.applyPlayerDamage(dmg, bot, false);
			else this.damageBotByBot(target.bot, dmg, bot, false, 'KNIFE');
		}
	};

	RangeGame.prototype.botCombat = function (bot, target, dt, diff) {
		var now = this.now;
		var dist = Math.hypot(target.x - bot.x, target.z - bot.z) || 0.001;
		bot.mode = 'fight';
		bot.behavior = 'attack';
		bot.face = { x: target.x, z: target.z };
		if (!bot.reactionDone) {
			bot.reaction += dt;
			if (bot.reaction >= bot.type.reaction * diff.reaction) bot.reactionDone = true;
		}
		bot.weaponThink = Math.max(0, bot.weaponThink - dt);
		if (!bot.reloading) this.updateBotWeaponChoice(bot, dist);
		if (bot.reloading) return true;

		var melee = bot.weaponDef && bot.weaponDef.slot === 'melee';
		if (melee) {
			if (dist > 1.65) {
				this.botPathTo(bot, target.x, target.z, bot.speed * 1.12, dt);
			} else {
				bot.moveX = 0;
				bot.moveZ = 0;
				this.botMelee(bot, target, dist, diff);
			}
			return true;
		}

		if (bot.ammo <= 0) {
			this.startBotReload(bot, target.x, target.eye, target.z);
			return true;
		}

		var canFire = bot.reactionDone && now >= bot.nextShot;
		if (canFire) {
			this.botShoot(bot, target, dist, diff);
		}

		/* fire discipline and footwork: hold ground with a rifle, strafe in
		   the mid range, and back off when the enemy is in the face */
		var nx = (target.x - bot.x) / dist;
		var nz = (target.z - bot.z) / dist;
		if (bot.weaponDef.category === 'SNIPER' && dist > 8 && bot.team === 'CT') {
			bot.moveX = 0;
			bot.moveZ = 0;
		} else if (dist > 8) {
			/* use the navmesh for the approach: a target visible across a
			   doorway is not a straight ground path */
			bot.strafeTimer -= dt;
			if (bot.strafeTimer <= 0) {
				bot.strafeTimer = C.rand(0.7, 1.8);
				if (Math.random() < 0.45) bot.strafe *= -1;
			}
			this.botPathTo(bot, target.x, target.z, bot.speed * (canFire ? 0.62 : 0.92), dt);
			var sx = -nz * bot.strafe * bot.speed * 0.25;
			var sz = nx * bot.strafe * bot.speed * 0.25;
			bot.moveX += sx;
			bot.moveZ += sz;
		} else {
			var prefMin = bot.type.preferMin, prefMax = bot.type.preferMax;
			var approach = dist > prefMax ? 1 : dist < prefMin ? -1 : 0;
			var strafeSpeed = bot.speed * 0.55;
			bot.strafeTimer -= dt;
			if (bot.strafeTimer <= 0) {
				bot.strafeTimer = C.rand(0.7, 1.8);
				if (Math.random() < 0.45) bot.strafe *= -1;
			}
			bot.moveX = -nz * bot.strafe * strafeSpeed + nx * approach * bot.speed * 0.9;
			bot.moveZ = nx * bot.strafe * strafeSpeed + nz * approach * bot.speed * 0.9;
			if (dist < 2.5) {
				bot.moveX -= nx * bot.speed * 1.2;
				bot.moveZ -= nz * bot.speed * 1.2;
			}
			if (canFire) {
				bot.moveX *= 0.2;
				bot.moveZ *= 0.2;
			}
		}
		/* never backpedal while holding a firing solution: keep the feet
		   moving laterally or forward, not away from the target */
		var backward = bot.moveX * nx + bot.moveZ * nz;
		if (backward < 0) {
			bot.moveX -= nx * backward;
			bot.moveZ -= nz * backward;
		}
		return true;
	};

	RangeGame.prototype.botShoot = function (bot, target, dist, diff) {
		if (!target || !target.alive || bot.reloading || bot.ammo <= 0) return;
		if (!bot.weaponDef || bot.weaponDef.slot === 'melee') return;
		var now = this.now;
		var def = bot.weaponDef || C.WEAPONS.ak47;
		bot.ammo--;
		var rec = bot.weapons && bot.weapons[bot.weaponIndex];
		if (rec) rec.ammo = bot.ammo;

		var baseGap = bot.type.fireRate;
		if (def.category === 'SMG') baseGap *= 0.66;
		else if (def.category === 'SHOTGUN') baseGap *= 1.08;
		else if (def.category === 'SNIPER') baseGap *= 1.34;

		var bursting = bot.burstMode && (def.category === 'RIFLE' || def.category === 'SMG');
		if (bursting) {
			if (bot.burstLeft <= 0) bot.burstLeft = C.randi(3, 5);
			bot.burstLeft--;
			if (bot.burstLeft > 0) {
				bot.nextShot = now + C.rand(80, 130);
				bot.reactionDone = true;
				bot.reaction = 0;
			} else {
				bot.nextShot = now + baseGap * diff.fire * C.rand(0.88, 1.18) * 1000;
				bot.reactionDone = false;
			}
		} else {
			bot.nextShot = now + baseGap * diff.fire * C.rand(0.88, 1.18) * 1000;
			bot.reactionDone = false;
		}
		bot.stationaryUntil = now + 300;

		var origin = this.tmpB.set(bot.x, 1.42 * bot.baseScale, bot.z);
		var aim = new THREE.Vector3(target.x, target.eye - C.rand(0.12, 0.42), target.z);
		var dir = new THREE.Vector3().subVectors(aim, origin).normalize();
		var tracerEnd = aim.clone();

		var missChance = diff.missChance != null ? diff.missChance : 0.22;
		if (target.speed > 2.2) missChance *= 1.1;
		if (dist > 34) missChance *= 1.12;
		var deliberateMiss = Math.random() < missChance;

		var chance = bot.accuracy * diff.accuracy;
		chance *= clamp(1.18 - dist / 48, 0.25, 1);
		if (target.speed > 2.2) chance *= 0.84;
		chance = clamp(chance, 0.05, 0.9);

		var hit = !deliberateMiss && Math.random() < chance;
		var headshot = false;
		if (hit) {
			var scale = def.category === 'SNIPER' ? 1.35 : def.category === 'SHOTGUN' ? 1.35 : def.category === 'SMG' ? 0.62 : def.category === 'RIFLE' ? 1.0 : 0.6;
			var dmg = bot.damage * scale * diff.damage * C.rand(0.82, 1.18);
			var hsChance = def.category === 'SNIPER' ? clamp(0.08 + diff.accuracy * 0.12, 0.1, 0.28) : 0.05;
			headshot = Math.random() < hsChance;
			if (headshot) dmg *= def.category === 'SNIPER' ? 2.3 : 1.6;
			if (Math.random() < 0.06) dmg *= 1.45;
			if (target.kind === 'player') {
				this.applyPlayerDamage(dmg, bot, headshot);
				this.spawnSparks(this.camera.position.clone(), 0xff6a4a, 5, 1.8);
			} else if (target.bot) {
				this.damageBotByBot(target.bot, dmg * 2.15, bot, headshot, def.name);
				this.spawnSparks(new THREE.Vector3(target.x, 1.25, target.z), 0xff8b52, 4, 1.8);
			}
		} else {
			var side = new THREE.Vector3(-dir.z, 0, dir.x);
			if (side.lengthSq() < 0.01) side.set(1, 0, 0);
			side.normalize();
			var spread = deliberateMiss ? C.rand(1.4, 4.4) : C.rand(0.7, 2.2);
			var sign = Math.random() < 0.5 ? -1 : 1;
			tracerEnd.copy(aim).addScaledVector(side, spread * sign);
			tracerEnd.y += deliberateMiss ? C.rand(-1.3, 2.0) : C.rand(-0.7, 1.1);
		}

		if (bot.flash) {
			bot.muzzle.updateWorldMatrix(true, false);
			bot.flash.visible = true;
			bot.flashUntil = now + 45;
			bot.flash.material.rotation = Math.random() * Math.PI * 2;
		}
		this.spawnTracer(origin.clone(), tracerEnd, 0xff9a50, 0.09);
		this.sound.shot(def.sound || 'rifle', this.panFor(bot.x, bot.z), dist);
	};

	RangeGame.prototype.tBotObjective = function (bot, dt) {
		var b = this.bomb;
		var now = this.now;
		if (!b) return;

		/* someone has to recover a dropped C4 */
		if (b.state === 'dropped') {
			var rank = this.bombRecoveryRank(bot);
			var squadSize = Math.min(3, this.teamBots('T', true).length);
			if (rank >= 0 && rank < squadSize) {
				if (Math.hypot(bot.x - b.x, bot.z - b.z) < 1.7) {
					this.pickupBomb(bot);
					bot.mode = 'advance';
					bot.path = null;
					return;
				}
				this.botPathTo(bot, b.x, b.z, bot.speed * 1.1, dt);
				bot.mode = 'recover';
				bot.face = { x: b.x, z: b.z };
				return;
			}
			var bd = Math.hypot(bot.x - b.x, bot.z - b.z);
			if (bd < 22) {
				var cover = this.snapFreePoint(b.x + (bot.x - b.x) * 0.22, b.z + (bot.z - b.z) * 0.22, 0.46);
				this.botHoldAt(bot, { x: cover.x, z: cover.z, lx: b.x, lz: b.z }, dt);
				bot.mode = 'recover';
				return;
			}
		}

		/* the carrier walks the route, then plants on the site */
		if (b.carrier === bot && (b.state === 'carried' || b.state === 'planting')) {
			if (!bot.atSite) {
				if (this.botFollowRoute(bot, dt)) bot.atSite = true;
				bot.mode = 'advance';
				return;
			}
			var site = this.siteById(bot.site) || this.nearestSite(bot.x, bot.z);
			if (!bot.plantSpot) bot.plantSpot = this.choosePlantSpot(bot, site);
			var spot = bot.plantSpot;
			if (!spot) { bot.moveX = 0; bot.moveZ = 0; return; }
			var sd = Math.hypot(spot.x - bot.x, spot.z - bot.z);
			if (!bot.planting) {
				if (sd > 0.95) {
					this.botPathTo(bot, spot.x, spot.z, bot.speed * 1.02, dt);
					bot.mode = 'plantrun';
					return;
				}
				bot.planting = true;
				bot.plantProgress = 0;
				b.state = 'planting';
				b.planter = bot;
				b.plantAnnounced = false;
			}
			bot.mode = 'plant';
			bot.moveX = 0;
			bot.moveZ = 0;
			bot.face = { x: spot.x, z: spot.z };
			b.x = bot.x;
			b.z = bot.z;
			bot.plantProgress += dt;
			b.plantProgress = bot.plantProgress;
			if (!b.plantAnnounced) {
				b.plantAnnounced = true;
				this.announce('C4 BEING PLANTED', this.tr('COVER THE CARRIER'));
			}
			if (bot.plantProgress >= (C.BOMB ? C.BOMB.plantTime : 3.2)) {
				this.plantBomb(bot);
			}
			return;
		}

		/* planted (or being planted): the rest of the squad covers the site */
		if (b.state === 'planted' || b.state === 'planting') {
			if (!bot.atSite) {
				if (this.botFollowRoute(bot, dt)) bot.atSite = true;
				bot.mode = 'advance';
				return;
			}
			this.botHoldAt(bot, this.tPostFor(bot), dt);
			bot.mode = b.state === 'planting' ? 'cover' : 'guard';
			return;
		}

		/* pre-plant movement */
		if (this.botFollowRoute(bot, dt)) bot.atSite = true;
		bot.mode = bot.atSite ? 'guard' : 'advance';
		if (bot.atSite) this.botHoldAt(bot, this.tPostFor(bot), dt);
	};

	RangeGame.prototype.ctBotObjective = function (bot, dt) {
		var b = this.bomb;
		var now = this.now;
		if (!b) return;
		if (b.state === 'planted') {
			if (b.defuser === bot) {
				var d = Math.hypot(bot.x - b.x, bot.z - b.z);
				if (d > 1.35) {
					this.botPathTo(bot, b.x, b.z, bot.speed * 1.12, dt);
					bot.mode = 'rotate';
				} else {
					bot.moveX = 0;
					bot.moveZ = 0;
					bot.mode = 'defuse';
					bot.face = { x: b.x, z: b.z };
				}
				return;
			}
			var siteObj = this.siteById(b.site) || this.nearestSite(b.x, b.z);
			if (siteObj && Math.hypot(bot.x - siteObj.x, bot.z - siteObj.z) > 17) {
				this.botPathTo(bot, siteObj.x, siteObj.z + 2.5, bot.speed * 1.08, dt);
				bot.mode = 'rotate';
				return;
			}
			var post = this.ctPostFor(bot, b.site);
			this.botHoldAt(bot, post, dt);
			bot.mode = 'guard';
			return;
		}

		/* pre-plant: hold the assigned site (botHoldAt also drives idle roaming) */
		var home = bot.post || this.ctPostFor(bot, bot.site);
		if (!home) { bot.moveX = 0; bot.moveZ = 0; return; }
		this.botHoldAt(bot, home, dt);
	};

	RangeGame.prototype.botAvoidChicken = function (bot) {
		var sp = Math.hypot(bot.moveX, bot.moveZ);
		if (sp < 0.2 || !this.chickens || !this.chickens.length) return;
		var nx = bot.moveX / sp, nz = bot.moveZ / sp;
		var best = null, bestD = 1e9;
		for (var i = 0; i < this.chickens.length; i++) {
			var ch = this.chickens[i];
			if (!ch.alive) continue;
			var dx = ch.x - bot.x, dz = ch.z - bot.z;
			var d = Math.hypot(dx, dz);
			if (d < 0.01 || d > 2.1) continue;
			var dot = (dx * nx + dz * nz) / d;
			if (dot < 0.22) continue;
			if (d < bestD) { bestD = d; best = ch; }
		}
		if (!best) return;
		if (bestD < 1.25 && this.now - (bot.chickenKillAt || 0) > 1300 && Math.random() < 0.45) {
			bot.chickenKillAt = this.now;
			this.killChicken(best, new THREE.Vector3(best.x, 0.4, best.z));
			return;
		}
		var cross = nx * (best.z - bot.z) - nz * (best.x - bot.x);
		var side = cross > 0 ? -1 : 1;
		var push = sp * (0.9 + (1.4 - Math.min(1.4, bestD)) * 0.9);
		bot.moveX += -nz * side * push;
		bot.moveZ += nx * side * push;
		bot.chickenAvoidAt = this.now;
	};

	RangeGame.prototype.pickWanderPoint = function (bot, minR, maxR, maxTries) {
		minR = minR || 3.5;
		maxR = maxR || 9;
		maxTries = maxTries || 16;
		for (var i = 0; i < maxTries; i++) {
			var ang = C.rand(0, Math.PI * 2);
			var r = C.rand(minR, maxR);
			var x = bot.x + Math.cos(ang) * r;
			var z = bot.z + Math.sin(ang) * r;
			if (Math.abs(x) > this.world.bounds - 2 || Math.abs(z) > this.world.bounds - 2) continue;
			if (this.collidesBot(x, z, 0.5)) continue;
			if (this.world.walkableAt && !this.world.walkableAt(x, z)) continue;
			var p = C.findPath(this.nav, bot.x, bot.z, x, z);
			if (p && p.length) return { x: x, z: z };
		}
		return null;
	};

	RangeGame.prototype.forceBotWander = function (bot) {
		if (!bot || !bot.alive || bot.dead) return false;
		if (bot.planting || this.criticalRole(bot)) return false;
		bot.path = null;
		bot.pathGoal = null;
		bot.pathTimer = 0;
		bot.stuck = 0;
		bot.stallTimer = 0;
		bot.wanderUntil = this.now + 2600;
		bot.wanderPoint = null;
		bot.wanderAngAt = 0;
		bot.stallProbeX = bot.x;
		bot.stallProbeZ = bot.z;
		bot.stallProbeAt = this.now;
		bot.mode = 'wander';
		bot.twitchPenalty = (bot.twitchPenalty || 0) + 1;
		if (bot.route && bot.routeIndex < bot.route.length - 1) bot.routeIndex++;
		return true;
	};

	RangeGame.prototype.botForceWander = function (bot, dt) {
		if (!bot.wanderUntil) return false;
		if (this.now >= bot.wanderUntil) {
			bot.wanderUntil = 0;
			bot.wanderPoint = null;
			return false;
		}
		if (bot.planting || this.criticalRole(bot)) {
			bot.wanderUntil = 0;
			return false;
		}
		if (!bot.wanderPoint || Math.hypot(bot.wanderPoint.x - bot.x, bot.wanderPoint.z - bot.z) < 1.1) {
			bot.wanderPoint = this.pickWanderPoint(bot, 3.5, 9) || this.pickWanderPoint(bot, 2, 5, 10);
		}
		if (bot.wanderPoint) {
			this.botPathTo(bot, bot.wanderPoint.x, bot.wanderPoint.z, bot.speed, dt);
			bot.mode = 'wander';
			return true;
		}
		if (this.now > (bot.wanderAngAt || 0)) {
			bot.wanderAng = C.rand(0, Math.PI * 2);
			bot.wanderAngAt = this.now + 1200;
		}
		bot.moveX = Math.cos(bot.wanderAng) * bot.speed * 0.8;
		bot.moveZ = Math.sin(bot.wanderAng) * bot.speed * 0.8;
		bot.mode = 'wander';
		return true;
	};

	RangeGame.prototype.botStallWatchdog = function (bot, dt, preX, preZ) {
		if (!this.round || this.round.phase !== 'live' || this.state !== 'playing' || bot.dead) return;
		if (bot.wanderUntil) { bot.stallTimer = 0; return; }
		if (bot.planting || this.criticalRole(bot)) { bot.stallTimer = 0; return; }
		var intended = Math.hypot(bot.moveX || 0, bot.moveZ || 0) > 0.3;
		var moved = Math.hypot(bot.x - preX, bot.z - preZ);
		var deliberatelyStill = this.now < (bot.stationaryUntil || 0);
		if (intended && !deliberatelyStill && moved < 0.055) bot.stallTimer = (bot.stallTimer || 0) + dt;
		else if (!intended || deliberatelyStill) bot.stallTimer = 0;
		else bot.stallTimer = Math.max(0, (bot.stallTimer || 0) - dt * 4);
		/* Net-displacement probe catches robots twitching back and forth
		   instead of making forward progress. */
		if (!bot.stallProbeAt || this.now - bot.stallProbeAt > 900) {
			var net = Math.hypot(bot.x - (bot.stallProbeX != null ? bot.stallProbeX : bot.x),
				bot.z - (bot.stallProbeZ != null ? bot.stallProbeZ : bot.z));
			if (intended && !deliberatelyStill && net < 0.32) bot.stallTimer = (bot.stallTimer || 0) + 0.9;
			else if (net > 0.45) bot.stallTimer = 0;
			bot.stallProbeX = bot.x;
			bot.stallProbeZ = bot.z;
			bot.stallProbeAt = this.now;
		}
		if (bot.stallTimer > 1.15) this.forceBotWander(bot);
	};

	RangeGame.prototype.checkTeamStall = function () {
		if (this.state !== 'playing' || !this.round || this.round.phase !== 'live') return;
		if (this.now < (this._teamStallBreakAt || 0)) return;
		var stalled = 0, alive = 0;
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (!b.alive || b.dead) continue;
			alive++;
			if ((b.stallTimer || 0) > 0.65 && !b.planting && !this.criticalRole(b)) stalled++;
		}
		if (stalled >= 3 && stalled >= Math.ceil(alive * 0.5)) {
			this._teamStallBreakAt = this.now + 4500;
			for (var j = 0; j < this.bots.length; j++) {
				var bot = this.bots[j];
				if (!bot.alive || bot.dead) continue;
				if (bot.planting || this.criticalRole(bot)) continue;
				this.forceBotWander(bot);
			}
		}
	};

	RangeGame.prototype.pickGamblePoint = function (bot) {
		var list = [];
		var callouts = this.world.callouts || [];
		for (var i = 0; i < callouts.length; i++) {
			var c = callouts[i];
			if (c && typeof c.x === 'number') list.push({ x: c.x, z: c.z, name: c.name });
		}
		if (this.world.sites) {
			for (var s = 0; s < this.world.sites.length; s++) list.push({ x: this.world.sites[s].x, z: this.world.sites[s].z });
		}
		C.shuffle(list);
		for (var k = 0; k < list.length; k++) {
			var p = list[k];
			if (Math.hypot(p.x - bot.x, p.z - bot.z) < 8) continue;
			if (this.collidesBot(p.x, p.z, 0.5)) continue;
			if (this.world.walkableAt && !this.world.walkableAt(p.x, p.z)) continue;
			var path = C.findPath(this.nav, bot.x, bot.z, p.x, p.z);
			if (path && path.length) return { x: p.x, z: p.z, name: p.name };
		}
		return this.pickWanderPoint(bot, 8, 18, 10);
	};

	RangeGame.prototype.botGambleObjective = function (bot, dt) {
		if (!bot.gamble) return false;
		if (this.teamFearValue(bot.team) > 0.5) return false;
		if (!this.bomb || this.bomb.state !== 'carried') return false;
		if (bot.planting || bot.hasBomb || this.criticalRole(bot)) return false;
		var now = this.now;
		if (!bot.gamblePoint || Math.hypot(bot.gamblePoint.x - bot.x, bot.gamblePoint.z - bot.z) < 1.4 ||
			now - (bot.gambleAt || 0) > 12000) {
			bot.gamblePoint = this.pickGamblePoint(bot);
			bot.gambleAt = now;
			if (!bot.gamblePoint) { bot.gamble = false; return false; }
		}
		this.botPathTo(bot, bot.gamblePoint.x, bot.gamblePoint.z, bot.speed * 1.03, dt);
		bot.mode = 'gamble';
		return true;
	};

	RangeGame.prototype.updateGamble = function () {
		if (this.state !== 'playing' || !this.round || this.round.phase !== 'live' || this.round.ended) return;
		if (!this.bomb || this.bomb.state !== 'carried') {
			for (var x = 0; x < this.bots.length; x++) this.bots[x].gamble = false;
			return;
		}
		if (!this.gamblers) this.gamblers = { CT: null, T: null };
		if (!this.gambleNextAt) this.gambleNextAt = { CT: 0, T: 0 };
		if (this.round.timer > 30) return;
		var self = this;
		['CT', 'T'].forEach(function (team) {
			if (self.aliveTeamCount(team) < 3) return;
			var current = self.gamblers[team];
			if (current && current.alive && !current.dead && current.gamble) return;
			if (self.now < (self.gambleNextAt[team] || 0)) return;
			var candidates = self.teamBots(team, true).filter(function (b) {
				return b.alive && !b.dead && !b.gamble && !b.hasBomb && !b.planting && !self.criticalRole(b);
			});
			if (!candidates.length) return;
			var pick = candidates.filter(function (b) { return b.role === 'lurk' || b.role === 'support'; })[0] || candidates[0];
			pick.gamble = true;
			pick.gamblePoint = null;
			pick.gambleAt = 0;
			self.gamblers[team] = pick;
			self.gambleNextAt[team] = self.now + 9000;
		});
	};

	RangeGame.prototype.botObjective = function (bot, dt) {
		if (this.botForceWander(bot, dt)) return;
		if (this.botReplanObjective(bot, dt)) return;
		if (this.botPanicObjective(bot, dt)) return;
		var b = this.bomb;
		if (bot.supportTarget) {
			if (this.now >= bot.supportUntil || (b && (b.state === 'planted' || b.state === 'planting')) || bot.hasBomb || bot.planting || (b && b.defuser === bot)) {
				bot.supportTarget = null;
				bot.supportUntil = 0;
				bot.supportAlertId = 0;
				bot.path = null;
			} else {
				var sd = Math.hypot(bot.supportTarget.x - bot.x, bot.supportTarget.z - bot.z);
				if (sd > 3.6) {
					this.botPathTo(bot, bot.supportTarget.x, bot.supportTarget.z, bot.speed * 1.05, dt);
					bot.mode = 'support';
					return;
				}
				bot.moveX = 0;
				bot.moveZ = 0;
				bot.mode = 'support';
				var suppScan = Math.sin(this.now * 0.0009 + bot.scanPhase) * 2.6;
				bot.face = { x: bot.supportTarget.x + suppScan, z: bot.supportTarget.z + suppScan };
				return;
			}
		}
		/* pursue a recently seen enemy, but never chase a ghost forever */
		if (bot.lastSeen && this.now - bot.lastSeen.t < 2400) {
			var d = Math.hypot(bot.lastSeen.x - bot.x, bot.lastSeen.z - bot.z);
			if (d > 2.4) {
				this.botPathTo(bot, bot.lastSeen.x, bot.lastSeen.z, bot.speed * 0.98, dt);
				bot.mode = 'hunt';
				return;
			}
		}
		if (this.botHunt(bot, dt)) return;
		if (this.botGrouping(bot, dt)) return;
		if (this.botHearObjective(bot, dt)) return;
		if (this.botGambleObjective(bot, dt)) return;
		if (bot.team === 'T') this.tBotObjective(bot, dt);
		else this.ctBotObjective(bot, dt);
	};

	RangeGame.prototype.updateBot = function (bot, dt) {
		var now = this.now;
		var root = bot.root;
		var preX = bot.x, preZ = bot.z;
		if (bot.dead) {
			this.updateBotsDeathOne(bot, dt);
			return;
		}
		bot.spawnT = Math.min(1, bot.spawnT + dt * 2.6);
		var targetScale = bot.baseScale * (0.35 + 0.65 * easeOut(bot.spawnT));
		root.scale.setScalar(targetScale);
		root.position.set(bot.x, 0, bot.z);

		if (!this.round || this.round.phase !== 'live' || this.state !== 'playing') {
			this.animateBotIdle(bot, dt);
			root.position.set(bot.x, 0, bot.z);
			return;
		}

		this.botUpdatePerception(bot, dt);
		var target = bot.target;
		if (target && (!target.alive || (target.bot && target.bot.dead))) {
			bot.target = null;
			target = null;
		}
		var diff = this.difficultyFor(bot.team);
		bot.diff = diff;
		if (bot.baseSpeed) bot.speed = bot.baseSpeed * (diff.speed || 1);
		var b = this.bomb;
		var distToBomb = b ? Math.hypot(bot.x - b.x, bot.z - b.z) : 1e9;
		var mustDefuse = !!(b && b.state === 'planted' && b.defuser === bot && b.fuse < 9 && distToBomb < 3.4);

		var targetDist = target ? Math.hypot(target.x - bot.x, target.z - bot.z) : 1e9;
		var carrierAtSite = !!(b && b.carrier === bot && bot.atSite && b.state === 'carried');
		if (bot.planting || (carrierAtSite && targetDist > 7)) {
			this.tBotObjective(bot, dt);
		} else if (target && this.botCanSee(bot, target) && !mustDefuse) {
			this.botCombat(bot, target, dt, diff);
		} else {
			this.botObjective(bot, dt);
		}

		if (bot.reloading) {
			if (now >= bot.reloadEnd) {
				this.finishBotReload(bot);
			} else {
				bot.mode = 'reload';
				if (bot.reloadGoal) this.botPathTo(bot, bot.reloadGoal.x, bot.reloadGoal.z, bot.speed * 0.9, dt);
				else { bot.moveX = 0; bot.moveZ = 0; }
				if (target) bot.face = { x: target.x, z: target.z };
			}
		}

		if (now < bot.stationaryUntil) {
			bot.moveX = 0;
			bot.moveZ = 0;
		}

		var speed = Math.hypot(bot.moveX, bot.moveZ);
		/* keep the squad from stacking into one silhouette */
		if (speed > 0.01) {
			for (var i = 0; i < this.bots.length; i++) {
				var o = this.bots[i];
				if (o === bot || !o.alive || o.dead) continue;
				var ox = bot.x - o.x, oz = bot.z - o.z;
				var od = Math.hypot(ox, oz);
				if (od > 0.001 && od < 1.35) {
					bot.moveX += ox / od * (1.35 - od) * 2.4;
					bot.moveZ += oz / od * (1.35 - od) * 2.4;
				}
			}
			speed = Math.hypot(bot.moveX, bot.moveZ);
		}
		this.botAvoidChicken(bot);
		speed = Math.hypot(bot.moveX, bot.moveZ);
		bot.moveSpeed = speed;

		if (speed > 0.001) {
			var stepX = bot.moveX * dt;
			var stepZ = bot.moveZ * dt;
			var oldX = bot.x, oldZ = bot.z;
			if (!this.collidesBot(bot.x + stepX, bot.z, 0.4) && !this.collidesChicken(bot.x + stepX, bot.z, 0.4, 0)) bot.x += stepX;
			if (!this.collidesBot(bot.x, bot.z + stepZ, 0.4) && !this.collidesChicken(bot.x, bot.z + stepZ, 0.4, 0)) bot.z += stepZ;
			var moved = Math.hypot(bot.x - oldX, bot.z - oldZ);
			if (moved < 0.001) {
				bot.stuck += dt;
				/* Round-body local avoidance: a circle never wedges on a right
				   angle the way a square box does. Try a short tangential slide
				   around the blocked corner, scored toward the current waypoint. */
				if (bot.stuck > 0.08) {
					var baseAng = Math.atan2(stepZ, stepX);
					var slideLen = Math.min(0.26, Math.max(0.09, speed * dt * 2.4));
					var gx = 0, gz = 0;
					if (bot.path && bot.pathIndex < bot.path.length) {
						gx = bot.path[bot.pathIndex].x - bot.x;
						gz = bot.path[bot.pathIndex].z - bot.z;
					} else if (bot.pathGoal) {
						gx = bot.pathGoal.x - bot.x;
						gz = bot.pathGoal.z - bot.z;
					} else {
						gx = stepX;
						gz = stepZ;
					}
					var gl = Math.hypot(gx, gz) || 1;
					gx /= gl; gz /= gl;
					var bestScore = -2, bestX = null, bestZ = null;
					var slideAngles = [0.55, -0.55, 1.0, -1.0, 1.5, -1.5];
					for (var si = 0; si < slideAngles.length; si++) {
						var sa = baseAng + slideAngles[si];
						var nx = bot.x + Math.cos(sa) * slideLen;
						var nz = bot.z + Math.sin(sa) * slideLen;
						if (this.collidesBot(nx, nz, 0.4) || this.collidesChicken(nx, nz, 0.4, 0)) continue;
						if (this.world.walkableAt && !this.world.walkableAt(nx, nz)) continue;
						var score = (nx - bot.x) * gx + (nz - bot.z) * gz;
						if (score > bestScore) { bestScore = score; bestX = nx; bestZ = nz; }
					}
					if (bestX != null) {
						bot.x = bestX;
						bot.z = bestZ;
						moved = slideLen;
						bot.pathTimer = 0;
					}
				}
				if (bot.stuck > 0.65) {
					bot.stuck = 0;
					bot.path = null;
					bot.pathTimer = 0;
					if (bot.route && bot.routeIndex < bot.route.length - 1) bot.routeIndex++;
					/* last resort: step out in a free compass direction */
					for (var na = 0; na < 8; na++) {
						var ca = (na / 8) * Math.PI * 2;
						var ux = bot.x + Math.cos(ca) * 0.32;
						var uz = bot.z + Math.sin(ca) * 0.32;
						if (!this.collidesBot(ux, uz, 0.4) && !this.collidesChicken(ux, uz, 0.4, 0) &&
							(!this.world.walkableAt || this.world.walkableAt(ux, uz))) {
							bot.x = ux;
							bot.z = uz;
							break;
						}
					}
				}
			} else {
				bot.stuck = Math.max(0, bot.stuck - dt * 2);
			}
		}

		var targetYaw = bot.yaw;
		if (bot.face) targetYaw = Math.atan2(bot.face.x - bot.x, bot.face.z - bot.z);
		else if (speed > 0.2) targetYaw = Math.atan2(bot.moveX, bot.moveZ);
		bot.yaw = dampAngle(bot.yaw, targetYaw, target ? 10 : 6, dt);
		root.rotation.y = bot.yaw;
		var gunBase = -0.04;
		var aimPitch = 0;
		if (target) {
			var tdist = Math.hypot(target.x - bot.x, target.z - bot.z);
			aimPitch = -Math.atan2(target.eye - (1.32 * bot.baseScale + 0.2), Math.max(0.5, tdist));
		}
		bot.robot.gun.rotation.x = C.damp(bot.robot.gun.rotation.x, gunBase + aimPitch * 0.7, 8, dt);
		root.position.set(bot.x, 0, bot.z);

		/* walk cycle */
		var walkSpeed = speed / Math.max(0.1, bot.speed);
		bot.walkPhase += dt * (4 + speed * 1.4);
		var swing = Math.sin(bot.walkPhase) * 0.6 * Math.min(1, walkSpeed);
		bot.robot.legL.rotation.x = swing;
		bot.robot.legR.rotation.x = -swing;
		bot.robot.armL.rotation.x = -0.8 + swing * 0.2;
		bot.robot.armR.rotation.x = -0.55 - swing * 0.12;
		if (now < bot.meleeUntil) {
			bot.robot.armR.rotation.x = -1.35;
			bot.robot.armL.rotation.x = -0.55;
		}
		if (bot.planting) {
			bot.robot.armR.rotation.x = -1.1;
			bot.robot.armL.rotation.x = -1.1;
		}
		bot.robot.torso.position.y = 1.28 + Math.abs(Math.sin(bot.walkPhase)) * 0.012 * Math.min(1, walkSpeed);
		bot.footTimer -= dt;
		if (speed > 0.5 && bot.footTimer <= 0) {
			bot.footTimer = 0.44;
			var fd = Math.hypot(bot.x - this.player.x, bot.z - this.player.z);
			if (fd < 26) this.sound.burst({ dur: 0.05, type: 'lowpass', freq: 300, gain: 0.03 * (1 - fd / 30), pan: this.panFor(bot.x, bot.z) });
		}
		if (bot.flash && bot.flash.visible && now > bot.flashUntil) bot.flash.visible = false;
		this.botStallWatchdog(bot, dt, preX, preZ);
	};

	RangeGame.prototype.animateBotIdle = function (bot, dt) {
		bot.walkPhase += dt * 1.2;
		bot.robot.legL.rotation.x = C.damp(bot.robot.legL.rotation.x, 0, 4, dt);
		bot.robot.legR.rotation.x = C.damp(bot.robot.legR.rotation.x, 0, 4, dt);
		bot.robot.torso.position.y = 1.28 + Math.sin(bot.walkPhase) * 0.008;
	};

	RangeGame.prototype.updateBotsDeath = function (dt) {
		for (var i = 0; i < this.bots.length; i++) this.updateBotsDeathOne(this.bots[i], dt);
	};

	RangeGame.prototype.updateBotsDeathOne = function (bot, dt) {
		if (!bot.dead) return;
		bot.deathT += dt;
		var t = Math.min(1, bot.deathT / 0.7);
		var e = easeOut(t);
		bot.root.rotation.x = -1.35 * e;
		bot.root.rotation.z = bot.deathSpin * 0.1 * e;
		bot.root.position.y = -0.18 * e;
		if (bot.deathT > 2.0) {
			bot.root.visible = false;
		}
	};

	RangeGame.prototype.applyPlayerDamage = function (amount, fromBot, headshot) {
		var p = this.player;
		if (!p.alive || this.state !== 'playing') return;
		if (p.armor > 0) {
			var armorPart = Math.min(p.armor, amount * 0.5);
			p.armor = Math.max(0, p.armor - armorPart);
			amount -= armorPart;
		}
		p.health -= amount;
		this.shake = Math.min(1.3, this.shake + 0.35);
		this.sound.hurt();
		this.flashDamage();
		this.showDamageDirection(fromBot ? fromBot.x : p.x, fromBot ? fromBot.z : p.z);
		this.updateVitalsHUD();
		if (fromBot) this.raiseAlert(this.playerTeam, fromBot.x, fromBot.z, fromBot);
		if (p.health <= 0) {
			p.health = 0;
			p.alive = false;
			p.deathT = 0;
			p.deathRoll = 0;
			this.match.deaths++;
			this.aiRecordPlayerDeath(fromBot);
			var playerSite = (this.nearestSite(p.x, p.z) || {}).id || 'A';
			this.registerTeamDeath(this.playerTeam, { name: 'YOU', x: p.x, z: p.z, site: playerSite });
			this.playerDiedLastRound = true;
			this.playerWasKilledLastRound = true;
			this.playerDefusing = false;
			this.playerHasBomb = false;
			this.playerPlanting = false;
			if (this.bomb && this.bomb.carrier === this.player) this.dropBomb(this.player);
			this.deathTimer = 1.6;
			this.spectating = false;
			this.showDeathCam(fromBot, !!headshot);
			if (this.el.hud) this.el.hud.classList.add('is-dead');
			if (fromBot) {
				fromBot.kills++;
				fromBot.roundKills = (fromBot.roundKills || 0) + 1;
				if (fromBot.roundKills === 4 || fromBot.roundKills === 5) this.teamAce(fromBot.team, fromBot.roundKills);
				if (headshot) fromBot.hs++;
				this.addKillFeed(fromBot.name, 'YOU', fromBot.weaponDef ? fromBot.weaponDef.name : 'RIFLE', !!headshot, false);
			}
			this.input.fire = false;
			this.semiQueued = false;
			this.reloading = false;
			this.scoped = false;
			this.camera.fov = 74;
			this.camera.updateProjectionMatrix();
			this.updateVitalsHUD();
			this.updateHostiles();
			this.checkRoundEnd();
		}
	};

	RangeGame.prototype.damageBot = function (bot, amount, headshot, weaponName) {
		if (!bot || !bot.alive || bot.team === this.playerTeam) return false;
		var killed = false;
		bot.hp -= amount;
		bot.robot.hp = Math.max(0, bot.hp);
		bot.robot.maxHp = bot.maxHp;
		bot.hitFlash = 0.08;
		bot.think = 0;
		bot.lastAttacker = 'player';
		bot.reactionDone = false;
		bot.reaction = 0;
		bot.lastEnemySeenAt = this.now;
		bot.roamNextAt = this.now + C.rand((bot.idleLimit || 10) * 0.9, (bot.idleLimit || 10) * 1.3);
		bot.roamTarget = null;
		this.raiseAlert(bot.team, this.player.x, this.player.z, 'player');
		C.drawHealthSprite(bot.robot);
		bot.robot.healthSprite.visible = bot.hp > 0;
		if (bot.hp <= 0) {
			this.killBot(bot, headshot, weaponName, 'player');
			killed = true;
		} else {
			bot.root.position.x += C.rand(-0.04, 0.04);
			bot.root.position.z += C.rand(-0.04, 0.04);
		}
		return killed;
	};

	RangeGame.prototype.damageBotByBot = function (bot, amount, attacker, headshot, weaponName) {
		if (!bot || !bot.alive || bot.dead) return false;
		if (attacker && attacker.team === bot.team) return false;
		bot.hp -= amount;
		bot.robot.hp = Math.max(0, bot.hp);
		bot.robot.maxHp = bot.maxHp;
		bot.hitFlash = 0.08;
		bot.think = 0;
		bot.lastAttacker = attacker || null;
		bot.lastHitAt = this.now;
		bot.lastEnemySeenAt = this.now;
		bot.roamNextAt = this.now + C.rand((bot.idleLimit || 10) * 0.9, (bot.idleLimit || 10) * 1.3);
		bot.roamTarget = null;
		if (attacker) this.raiseAlert(bot.team, attacker.x, attacker.z, attacker);
		bot.reactionDone = false;
		bot.reaction = 0;
		C.drawHealthSprite(bot.robot);
		bot.robot.healthSprite.visible = bot.hp > 0;
		if (bot.hp <= 0) {
			this.killBot(bot, headshot, weaponName || 'RIFLE', attacker);
			return true;
		}
		bot.root.position.x += C.rand(-0.04, 0.04);
		bot.root.position.z += C.rand(-0.04, 0.04);
		return false;
	};

	RangeGame.prototype.killBot = function (bot, headshot, weaponName, killer) {
		if (!bot || bot.dead) return;
		bot.dead = true;
		bot.alive = false;
		bot.hp = 0;
		var deathCause = (killer === 'player' || killer == null || killer === this.player)
			? ('killed by YOU' + (headshot ? ' (headshot)' : ''))
			: ('killed by ' + (killer && killer.name ? killer.name : 'enemy'));
		bot.deaths = 1;
		bot.headshotDeath = !!headshot;
		bot.robot.healthSprite.visible = false;
		bot.planting = false;
		if (headshot && bot.robot.head) {
			bot.robot.head.visible = false;
			this.spawnRobotHead(bot);
		}
		if (this.bomb && (this.bomb.carrier === bot || this.bomb.planter === bot) &&
			(this.bomb.state === 'carried' || this.bomb.state === 'planting')) {
			this.dropBomb(bot);
		}
		this.dropBotWeapon(bot);
		this.aiRecordDeath(bot, deathCause);
		if (killer && killer !== this.player && killer.team && killer.name) this.aiRecordRouteKill(killer);
		this.registerTeamDeath(bot.team, bot);
		var byPlayer = (killer === 'player' || killer == null || killer === this.player);
		if (byPlayer) {
			this.aiRecordPlayerKill(bot);
			this.match.kills++;
			this.roundStats.kills++;
			if (this.roundStats.kills === 4 || this.roundStats.kills === 5) this.teamAce(this.playerTeam, this.roundStats.kills);
			if (headshot) { this.match.hs++; this.roundStats.hs++; }
			var reward = 300 + (headshot ? 100 : 0);
			this.match.money = clamp(this.match.money + reward, 0, 16000);
			this.addKillFeed('YOU', bot.name, weaponName || 'RIFLE', headshot, true);
		} else {
			killer.kills++;
			killer.roundKills = (killer.roundKills || 0) + 1;
			if (killer.roundKills === 4 || killer.roundKills === 5) this.teamAce(killer.team, killer.roundKills);
			if (headshot) killer.hs++;
			this.addKillFeed(killer.name, bot.name, weaponName || 'RIFLE', headshot, false);
		}
		this.sound.explode();
		this.spawnSparks(new THREE.Vector3(bot.x, 1.3, bot.z), headshot ? 0xffd66a : 0xff8b52, 20, 4.4);
		this.updateHostiles();
		this.updateVitalsHUD();
		this.updateBombHUD();
		this.checkRoundEnd();
	};

	RangeGame.prototype.checkRoundEnd = function () {
		if (!this.round || this.round.ended || this.round.phase !== 'live' || this.state !== 'playing') return;
		var ctAlive = this.aliveTeamCount('CT');
		var tAlive = this.aliveTeamCount('T');
		if (ctAlive === 0) {
			this.endRound(false, 'All counter-terrorists eliminated.', 'elim');
			return;
		}
		if (tAlive === 0 && (!this.bomb || (this.bomb.state !== 'planted' && this.bomb.state !== 'defused' && this.bomb.state !== 'exploded'))) {
			this.endRound(true, 'All terrorists eliminated.', 'elim');
		}
	};

	RangeGame.prototype.createWeaponDrop = function (weaponId, def, ammo, x, z, spark) {
		if (!def || !C.buildWeaponPickup || def.slot === 'melee') return null;
		var pickup = C.buildWeaponPickup(weaponId, def, ammo);
		pickup.group.position.set(x, 0.02, z);
		this.scene.add(pickup.group);
		var drop = {
			id: ++this.dropSeq,
			group: pickup.group,
			body: pickup.body,
			ring: pickup.ring,
			label: pickup.label,
			labelTex: pickup.labelTex,
			materials: pickup.materials,
			weaponId: weaponId,
			def: def,
			ammo: ammo,
			x: x,
			z: z,
			life: 35,
			phase: C.rand(0, 6.28)
		};
		this.drops.push(drop);
		if (spark) this.spawnSparks(new THREE.Vector3(x, 0.55, z), 0xffd58a, 7, 2.2);
		return drop;
	};

	RangeGame.prototype.dropBotWeapon = function (bot) {
		var def = C.WEAPONS[bot.weaponId];
		if (!def || !C.buildWeaponPickup || def.slot === 'melee') return;
		var ammo = {
			mag: Math.max(1, Math.round(def.mag * C.rand(0.45, 0.9))),
			reserve: C.randi(0, def.reserve)
		};
		return this.createWeaponDrop(bot.weaponId, def, ammo, bot.x, bot.z, true);
	};

	RangeGame.prototype.removeDrop = function (drop) {
		var idx = this.drops.indexOf(drop);
		if (idx === -1) return;
		this.drops.splice(idx, 1);
		if (drop.group.parent) drop.group.parent.remove(drop.group);
		drop.group.traverse(function (o) {
			if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
		});
		drop.materials.forEach(function (m) { try { m.dispose(); } catch (e) {} });
		if (drop.labelTex) { try { drop.labelTex.dispose(); } catch (e2) {} }
		if (this.nearestDrop === drop) this.nearestDrop = null;
		this._pickupKey = -1;
	};

	RangeGame.prototype.clearDrops = function () {
		var list = this.drops.slice();
		for (var i = 0; i < list.length; i++) this.removeDrop(list[i]);
		this.drops.length = 0;
		this.nearestDrop = null;
		this._pickupKey = 0;
		if (this.el.pickup) this.el.pickup.hidden = true;
	};

	RangeGame.prototype.updateDrops = function (dt) {
		for (var i = this.drops.length - 1; i >= 0; i--) {
			var d = this.drops[i];
			d.life -= dt;
			if (d.life <= 0) { this.removeDrop(d); continue; }
			var bob = Math.sin(this.gameTime * 2.1 + d.phase) * 0.045;
			if (d.body) {
				d.body.position.y = 0.62 + bob;
				d.body.rotation.y += dt * 0.9;
			}
			if (d.ring) {
				var s = 1 + Math.sin(this.gameTime * 2.6 + d.phase) * 0.06;
				d.ring.scale.set(s, s, 1);
			}
			if (d.label) d.label.visible = Math.hypot(d.x - this.player.x, d.z - this.player.z) > 3.2;
			if (d.life < 4 && d.ring) d.ring.material.opacity = 0.2 + Math.abs(Math.sin(this.gameTime * 8)) * 0.4;
		}
	};

	RangeGame.prototype.updatePickupPrompt = function () {
		var p = this.player;
		var best = null;
		var bestDist = 2.8;
		if (this.state === 'playing' && p.alive) {
			for (var i = 0; i < this.drops.length; i++) {
				var d = this.drops[i];
				var dist = Math.hypot(d.x - p.x, d.z - p.z);
				if (dist < bestDist && this.pointHasLos(p.x, p.feetY + p.eye, p.z, d.x, 0.7, d.z)) {
					bestDist = dist;
					best = d;
				}
			}
		}
		var key = best ? best.id : 0;
		if (key === this._pickupKey) return;
		this._pickupKey = key;
		this.nearestDrop = best;
		if (!this.el.pickup) return;
		if (!best) { this.el.pickup.hidden = true; return; }
		this.el.pickup.hidden = false;
		text(this.el.pickupName, best.def.name);
		text(this.el.pickupAmmo, best.ammo.mag + ' / ' + best.ammo.reserve);
		if (this.el.pickupHint) {
			this.el.pickupHint.innerHTML = this.isTouch
				? escapeHTML(this.tr('TAP TO PICK UP'))
				: escapeHTML(this.tr('PRESS')) + ' <kbd>E</kbd> ' + escapeHTML(this.tr('TO PICK UP'));
		}
	};

	RangeGame.prototype.pickupNearest = function () {
		var drop = this.nearestDrop;
		if (!drop) return;
		var def = drop.def;
		if (!def || (def.slot !== 'primary' && def.slot !== 'secondary')) return;
		var slot = def.slot;
		var oldId = this.loadout[slot];
		if (oldId === drop.weaponId) {
			var ammo = this.ammo[drop.weaponId];
			if (!ammo) ammo = this.ammo[drop.weaponId] = { mag: 0, reserve: 0 };
			ammo.mag = Math.min(def.mag, ammo.mag + drop.ammo.mag);
			ammo.reserve = Math.min(def.reserve * 2, ammo.reserve + drop.ammo.reserve);
			this.toast('Picked up ' + def.name + ' ammo.');
		} else {
			/* Swap, not teleport: the replaced gun is thrown onto the floor
			   as a real pickup with its current magazine and reserve. */
			var droppedName = null;
			if (oldId) {
				var oldDef = C.WEAPONS[oldId];
				if (oldDef) {
					var oldAmmo = this.ammo[oldId] || { mag: oldDef.mag, reserve: oldDef.reserve };
					this.createWeaponDrop(oldId, oldDef, { mag: oldAmmo.mag, reserve: oldAmmo.reserve },
						this.player.x, this.player.z, true);
					droppedName = oldDef.name;
				}
				delete this.ammo[oldId];
			}
			this.loadout[slot] = drop.weaponId;
			this.ammo[drop.weaponId] = { mag: drop.ammo.mag, reserve: drop.ammo.reserve };
			this.equipWeapon(drop.weaponId, true);
			this.toast(droppedName ? ('Swapped ' + droppedName + ' for ' + def.name + '.') : ('Picked up ' + def.name + '.'));
		}
		this.sound.buy();
		this.updateAmmoHUD();
		this.updateVitalsHUD();
		this.removeDrop(drop);
		this._pickupKey = -1;
		this.updatePickupPrompt();
	};

	RangeGame.prototype.spawnRobotHead = function (bot) {
		var geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
		var mat = new THREE.MeshStandardMaterial({
			color: new THREE.Color(bot.robot.torsoColor).multiplyScalar(0.8),
			roughness: 0.55, metalness: 0.4
		});
		var mesh = new THREE.Mesh(geo, mat);
		mesh.position.set(bot.x, 1.9, bot.z);
		mesh.castShadow = true;
		this.scene.add(mesh);
		this.debris.push({
			mesh: mesh, life: 2.2,
			vx: C.rand(-2.2, 2.2), vy: C.rand(2.2, 4.2), vz: C.rand(-2.2, 2.2),
			spin: C.rand(-8, 8)
		});
	};

	/* ======================================================================
	   HUD
	   ====================================================================== */
	RangeGame.prototype.updateHUD = function () {
		if (this.el.useHint) text(this.el.useHint, (this.playerTeam === 'T' && !this.practice) ? 'PLANT C4' : 'PICK UP / DEFUSE');
		if (this.el.roundNo) text(this.el.roundNo, this.practice ? '' : (this.match ? this.match.round : 1));
		if (this.match) {
			text(this.el.health, Math.max(0, Math.round(this.player.health)));
			text(this.el.armor, Math.max(0, Math.round(this.player.armor)));
			text(this.el.money, this.practice ? '∞' : Math.max(0, Math.round(this.match.money)));
			var hp = this.el.health && this.el.health.parentNode;
			if (hp) hp.classList.toggle('is-low', this.player.health <= 25);
			var bar = this.el.healthbar ? this.el.healthbar.querySelector('em') : null;
			if (bar) bar.style.width = clamp(this.player.health, 0, 100) + '%';
		}
		this.updateRoundTimer();
		this.updateBuyHint();
		this.updatePickupPrompt();
		if (this.spectating) this.updateSpectateHUD();
	};

	RangeGame.prototype.updateVitalsHUD = function () {
		if (this.spectating) { this.updateSpectateHUD(); return; }
		text(this.el.health, Math.max(0, Math.round(this.player.health)));
		text(this.el.armor, Math.max(0, Math.round(this.player.armor)));
		if (this.match) text(this.el.money, this.practice ? '∞' : Math.max(0, Math.round(this.match.money)));
		var bar = this.el.healthbar ? this.el.healthbar.querySelector('em') : null;
		if (bar) bar.style.width = clamp(this.player.health, 0, 100) + '%';
		var hp = this.el.health && this.el.health.parentNode;
		if (hp) hp.classList.toggle('is-low', this.player.health <= 25);
	};

	RangeGame.prototype.updateAmmoHUD = function () {
		if (this.spectating) { this.updateSpectateHUD(); return; }
		var def = this.weaponDef(this.currentWeapon);
		var ammo = this.ammo[this.currentWeapon];
		text(this.el.weapon, def.name);
		text(this.el.slot, def.category || def.slot);
		if (def.slot === 'melee') {
			text(this.el.ammo, '—');
			text(this.el.reserve, '—');
		} else {
			text(this.el.ammo, ammo ? ammo.mag : def.mag);
			text(this.el.reserve, this.practice ? '∞' : (ammo ? ammo.reserve : def.reserve));
		}
		if (this.el.ammo && this.el.ammo.parentNode) {
			this.el.ammo.parentNode.classList.toggle('is-low', !!ammo && ammo.mag <= Math.max(1, Math.floor(def.mag * 0.2)));
		}
		var inds = this.el.slotInds || [];
		var slots = inds[1] || [];
		Array.prototype.forEach.call(slots, function (s) {
			var n = Number(s.getAttribute('data-csr-slot-ind'));
			var has = n === 1 ? !!this.loadout.secondary : n === 2 ? !!this.loadout.primary : !!this.loadout.melee;
			var active = (n === 1 && this.currentSlot === 'secondary') || (n === 2 && this.currentSlot === 'primary') || (n === 3 && this.currentSlot === 'melee');
			s.classList.toggle('is-empty', !has);
			s.classList.toggle('is-active', active);
		}.bind(this));
	};

	RangeGame.prototype.flashDamage = function () {
		if (!this.el.damage) return;
		this.el.damage.classList.add('is-hit');
		var self = this;
		clearTimeout(this._damageTimer);
		this._damageTimer = setTimeout(function () {
			if (self.el.damage) self.el.damage.classList.remove('is-hit');
		}, 140);
	};

	RangeGame.prototype.showDamageDirection = function (x, z) {
		if (!this.el.dmgdir) return;
		var right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
		var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
		var dir = new THREE.Vector3(x - this.player.x, 0, z - this.player.z).normalize();
		var angle = Math.atan2(dir.dot(right), dir.dot(forward)) * 180 / Math.PI;
		this.el.dmgdir.style.transform = 'rotate(' + angle.toFixed(1) + 'deg)';
		this.el.dmgdir.classList.remove('is-on');
		void this.el.dmgdir.offsetWidth;
		this.el.dmgdir.classList.add('is-on');
	};

	RangeGame.prototype.showHitmarker = function (headshot, killed) {
		if (!this.el.hitmarker) return;
		this.el.hitmarker.classList.remove('is-on', 'is-head', 'is-kill');
		void this.el.hitmarker.offsetWidth;
		this.el.hitmarker.classList.add('is-on');
		if (headshot) this.el.hitmarker.classList.add('is-head');
		if (headshot && killed) this.el.hitmarker.classList.add('is-kill');
	};

	RangeGame.prototype.showHeadshot = function (killed) {
		if (this.el.headshot) {
			this.el.headshot.classList.remove('is-on', 'is-kill');
			if (this.el.headshotBonus) text(this.el.headshotBonus, killed ? '+$100 KILL BONUS' : '4× DAMAGE');
			if (killed) this.el.headshot.classList.add('is-kill');
			void this.el.headshot.offsetWidth;
			this.el.headshot.classList.add('is-on');
			var self = this;
			clearTimeout(this._headshotTimer);
			this._headshotTimer = setTimeout(function () {
				if (self.el.headshot) self.el.headshot.classList.remove('is-on', 'is-kill');
			}, 820);
		}
		if (this.el.flash) {
			this.el.flash.classList.remove('is-head');
			void this.el.flash.offsetWidth;
			this.el.flash.classList.add('is-head');
			var self2 = this;
			clearTimeout(this._headFlashTimer);
			this._headFlashTimer = setTimeout(function () {
				if (self2.el.flash) self2.el.flash.classList.remove('is-head');
			}, 330);
		}
	};

	RangeGame.prototype.addKillFeed = function (killer, victim, weaponName, headshot, playerKill) {
		if (!this.el.killfeed) return;
		var row = doc.createElement('div');
		row.className = 'csr-kill' + (playerKill ? ' is-player' : '');
		row.innerHTML = '<b>' + escapeHTML(killer) + '</b>' +
			'<em>[' + escapeHTML(weaponName) + ']</em>' +
			(headshot ? '<span class="csr-kill__hs">HS</span>' : '') +
			'<b>' + escapeHTML(victim) + '</b>';
		this.el.killfeed.appendChild(row);
		if (global.CSRangeI18n) global.CSRangeI18n.apply(row);
		this.killFeed.push(row);
		while (this.killFeed.length > 5) {
			var old = this.killFeed.shift();
			if (old && old.parentNode) old.parentNode.removeChild(old);
		}
		setTimeout(function () {
			row.classList.add('is-out');
			setTimeout(function () { if (row.parentNode) row.parentNode.removeChild(row); }, 320);
		}, 6200);
	};

	RangeGame.prototype.toast = function (message) {
		if (!this.el.toast) return;
		this.el.toast.textContent = this.tr(message);
		this.el.toast.classList.add('is-on');
		var self = this;
		clearTimeout(this._toastTimer);
		this._toastTimer = setTimeout(function () {
			if (self.el.toast) self.el.toast.classList.remove('is-on');
		}, 2400);
	};

	/* ======================================================================
	   buy menu
	   ====================================================================== */
	RangeGame.prototype.openBuy = function () {
		if (this.state !== 'playing' || !this.round) return;
		this.closeScoreboard();
		if (!this.practice && this.round.phase !== 'freeze') {
			this.toast('Buy time is over — the armory is locked.');
			return;
		}
		this.state = 'buy';
		this.buyOpen = true;
		if (this.el.buy) this.el.buy.hidden = false;
		this.renderBuy();
		this.ignoreUnlockUntil = this.now + 600;
		this.releaseLock();
		this.updateBuyHint();
	};

	RangeGame.prototype.closeBuy = function () {
		if (!this.buyOpen) return;
		this.buyOpen = false;
		if (this.el.buy) this.el.buy.hidden = true;
		if (this.state === 'buy') this.state = 'playing';
		this.updateBuyHint();
		this.focusField();
		if (!this.isTouch) this.requestLock();
	};

	RangeGame.prototype.canBuyItem = function (item) {
		if (!item) return false;
		if (this.practice) return true;
		if (item.kind === 'kit') return this.playerTeam === 'CT';
		if (item.kind !== 'weapon') return true;
		var pool = this.playerTeam === 'CT'
			? ['m4a4', 'mp9', 'ump45', 'awp', 'ssg08', 'nova', 'p250', 'deagle']
			: ['ak47', 'galil', 'sg553', 'mp9', 'ump45', 'awp', 'ssg08', 'nova', 'p250', 'deagle'];
		return pool.indexOf(item.id) !== -1;
	};

	RangeGame.prototype.renderBuy = function () {
		if (!this.el.buyGrid) return;
		var free = this.practice;
		var money = this.match ? this.match.money : 0;
		text(this.el.buyMoney, free ? 'FREE' : fmtMoney(money));
		var html = '';
		for (var i = 0; i < C.BUY_ITEMS.length; i++) {
			var item = C.BUY_ITEMS[i];
			if (!this.canBuyItem(item)) continue;
			var def = item.kind === 'weapon' ? C.WEAPONS[item.id] : null;
			var name = def ? def.name : item.name;
			var cat = def ? def.category : item.category;
			var price = item.price;
			var owned = false;
			if (!free) {
				if (item.kind === 'armor') owned = this.player.armor >= 100;
				else if (item.kind === 'kit') owned = !!this.defuseKit;
				else if (def) {
					if (def.slot === 'primary') owned = this.loadout.primary === item.id;
					else owned = this.loadout.secondary === item.id;
				}
			}
			var can = free || (money >= price && !owned);
			var icon = C.weaponIcon(def ? def.icon : 'armor');
			var stats = def
				? '<span>DMG <b>' + def.damage + (def.pellets ? '×' + def.pellets : '') + '</b></span><span>RPM <b>' + def.rpm + '</b></span><span>MAG <b>' + def.mag + '</b></span>'
				: item.kind === 'kit'
					? '<span>DEFUSE <b>5.0s</b></span><span>KIT <b>FAST</b></span>'
					: '<span>ARMOR <b>+100</b></span><span>HEAD <b>PROTECTED</b></span>';
			html += '<button type="button" class="csr-buyitem' + (owned ? ' is-owned' : '') + (!can && !owned ? ' is-locked' : '') + '" data-buy-id="' + item.id + '">' +
				'<div class="csr-buyitem__top"><div><span class="csr-buyitem__key">' + (item.key ? item.key : '·') + '</span>' +
				'<p class="csr-buyitem__name">' + escapeHTML(name) + '</p>' +
				'<p class="csr-buyitem__cat">' + escapeHTML(cat) + '</p></div>' +
				(owned ? '<span class="csr-buyitem__owned">OWNED</span>' : '<span class="csr-buyitem__price' + (!free && money < price ? ' is-short' : '') + '">' + (free ? 'FREE' : fmtMoney(price)) + '</span>') +
				'</div>' +
				'<div class="csr-buyitem__stat">' + stats + '</div>' +
				'<span class="csr-buyitem__buy">' + (owned ? 'EQUIPPED' : money >= price ? (item.key ? 'BUY  [ ' + item.key + ' ]' : 'BUY') : 'NOT ENOUGH CASH') + '</span>' +
				'<div class="csr-buyitem__icon' + (def && (def.icon === 'pistol' || def.icon === 'knife') ? ' is-pistol' : '') + '">' + icon + '</div>' +
				'</button>';
		}
		this.el.buyGrid.innerHTML = html;
		if (global.CSRangeI18n) global.CSRangeI18n.apply(this.el.buyGrid);
	};

	RangeGame.prototype.buyItem = function (id) {
		if (!this.buyOpen || !this.match) return;
		var item = null;
		for (var i = 0; i < C.BUY_ITEMS.length; i++) if (C.BUY_ITEMS[i].id === id) item = C.BUY_ITEMS[i];
		if (!item || !this.canBuyItem(item)) return;
		var free = this.practice;
		if (!free && this.match.money < item.price) { this.toast('Not enough cash.'); return; }
		if (item.kind === 'kit') {
			if (this.playerTeam !== 'CT') { this.toast('Terrorists cannot buy a defuse kit.'); return; }
			if (this.defuseKit && !free) { this.toast('Defuse kit already equipped.'); return; }
			this.defuseKit = true;
			if (!free) this.match.money -= item.price;
			this.sound.buy();
			this.toast('Defuse kit acquired.');
			this.updateBombHUD();
		} else if (item.kind === 'armor') {
			if (this.player.armor >= 100 && !free) { this.toast('Armour is already full.'); return; }
			this.player.armor = 100;
			if (!free) this.match.money -= item.price;
			this.sound.buy();
			this.toast(free ? 'Armour refilled.' : 'Kevlar + helmet equipped.');
		} else {
			var def = C.WEAPONS[item.id];
			if (!def) return;
			if (!free && def.slot === 'primary' && this.loadout.primary === item.id) { this.toast('Already equipped.'); return; }
			if (!free && def.slot === 'secondary' && this.loadout.secondary === item.id) { this.toast('Already equipped.'); return; }
			if (!free) this.match.money -= item.price;
			if (def.slot === 'primary') this.loadout.primary = item.id;
			else this.loadout.secondary = item.id;
			this.ammo[item.id] = { mag: def.mag, reserve: free ? 999 : def.reserve };
			this.sound.buy();
			this.equipWeapon(item.id, true);
			this.toast(free ? def.name + ' loaded.' : def.name + ' acquired.');
		}
		this.updateVitalsHUD();
		this.updateAmmoHUD();
		this.renderBuy();
	};

	/* ======================================================================
	   scoreboard / controls
	   ====================================================================== */
	RangeGame.prototype.openScoreboard = function () {
		if (!this.el.scoreboard) return;
		if (this.practice) { this.toast('Practice session — no scoreboard.'); return; }
		this.scoreboardOpen = true;
		this.el.scoreboard.hidden = false;
		this.renderScoreboard();
	};
	RangeGame.prototype.closeScoreboard = function () {
		this.scoreboardOpen = false;
		if (this.el.scoreboard) this.el.scoreboard.hidden = true;
	};
	RangeGame.prototype.renderScoreboard = function () {
		if (!this.el.boardCtRows) return;
		var rounds = this.match ? this.match.round : 1;
		text(this.el.boardRound, rounds);
		if (this.match) {
			text(this.el.boardCt, this.match.ct);
			text(this.el.boardT, this.match.t);
		}
		var playerRow = '<div class="csr-board__row is-player' + (this.player.alive ? '' : ' is-dead') + '">' +
			'<span>YOU <small style="opacity:.5">' + this.playerTeam + '</small></span><span>' + this.match.kills + '</span><span>' + this.match.deaths + '</span><span>' + this.match.hs + '</span><span>LOCAL</span></div>';
		var ctBots = '';
		var tBots = '';
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			var row = '<div class="csr-board__row' + (b.alive ? '' : ' is-dead') + '">' +
				'<span>' + escapeHTML(b.name) + ' <small style="opacity:.5">' + escapeHTML(b.role || b.type.label) + '</small></span>' +
				'<span>' + b.kills + '</span><span>' + b.deaths + '</span><span>' + (b.hs || 0) + '</span><span>' + b.ping + '</span></div>';
			if (b.team === 'CT') ctBots += row; else tBots += row;
		}
		this.el.boardCtRows.innerHTML = (this.playerTeam === 'CT' ? playerRow : '') + ctBots;
		if (global.CSRangeI18n) global.CSRangeI18n.apply(this.el.boardCtRows);
		this.el.boardTRows.innerHTML = (this.playerTeam === 'T' ? playerRow : '') + tBots;
		if (global.CSRangeI18n) global.CSRangeI18n.apply(this.el.boardTRows);
	};

	RangeGame.prototype.openControls = function (from) {
		this.closeScoreboard();
		this.controlsFrom = from || 'menu';
		if (this.state === 'playing') this.pause();
		if (this.el.controls) this.el.controls.hidden = false;
		if (this.el.pause) this.el.pause.hidden = true;
		this.ignoreUnlockUntil = this.now + 500;
		if (this.locked) this.releaseLock();
	};
	RangeGame.prototype.closeControls = function () {
		if (this.el.controls) this.el.controls.hidden = true;
		if (this.controlsFrom === 'pause' && this.state === 'paused' && this.el.pause) this.el.pause.hidden = false;
		else if (this.controlsFrom === 'menu' && this.state !== 'menu' && this.el.pause) this.el.pause.hidden = false;
	};

	/* ======================================================================
	   pointer lock / pause
	   ====================================================================== */
	RangeGame.prototype.requestLock = function () {
		if (this.isTouch) return;
		if (!this.supportsLock) { this.enableFallbackLook(); return; }
		var self = this;
		try {
			var p = this.el.canvas.requestPointerLock();
			if (p && p.catch) p.catch(function () { self.enableFallbackLook(); });
		} catch (e) {
			this.enableFallbackLook();
		}
	};
	RangeGame.prototype.enableFallbackLook = function () {
		if (this.fallbackLook) return;
		this.fallbackLook = true;
		this.toast('Mouse lock unavailable — free look is active. Click to fire.');
	};
	RangeGame.prototype.releaseLock = function (quiet) {
		if (doc.pointerLockElement) {
			this.ignoreUnlockUntil = this.now + (quiet ? 2000 : 600);
			try { doc.exitPointerLock(); } catch (e) { /* ignore */ }
		}
	};
	RangeGame.prototype.onPointerLockChange = function () {
		var locked = doc.pointerLockElement === this.el.canvas;
		this.locked = locked;
		if (locked) this.fallbackLook = false;
		if (!locked && this.state === 'playing' && this.now > this.ignoreUnlockUntil && !this.fallbackLook) {
			this.pause();
		}
	};
	RangeGame.prototype.pause = function () {
		if (this.state !== 'playing') return;
		this.closeScoreboard();
		this.state = 'paused';
		this.input.fire = false;
		this.semiQueued = false;
		if (this.el.pause) this.el.pause.hidden = false;
		if (this.el.pauseRound) text(this.el.pauseRound, this.match.round);
		if (this.el.pauseKills) text(this.el.pauseKills, this.match.kills);
		if (this.el.pauseScore) text(this.el.pauseScore, this.match.ct + ' — ' + this.match.t);
		this.updatePauseMute();
		this.ignoreUnlockUntil = this.now + 500;
		if (this.locked) this.releaseLock();
	};
	RangeGame.prototype.resume = function () {
		if (this.state !== 'paused') return;
		this.state = 'playing';
		if (this.el.pause) this.el.pause.hidden = true;
		this.focusField();
		if (!this.isTouch) this.requestLock();
	};
	RangeGame.prototype.toggleMute = function () {
		this.sound.ensure();
		this.settings.muted = this.sound.toggleMute();
		this.saveSettings();
		this.updatePauseMute();
		this.toast(this.settings.muted ? 'Audio muted.' : 'Audio on.');
	};
	RangeGame.prototype.updatePauseMute = function () {
		if (this.el.pauseMute) text(this.el.pauseMute, 'SOUND: ' + (this.settings.muted ? 'OFF' : 'ON'));
	};

	/* ======================================================================
	   input
	   ====================================================================== */
	RangeGame.prototype.tr = function (source, params) {
		return global.CSRangeI18n ? global.CSRangeI18n.t(source, params) : String(source);
	};

	RangeGame.prototype.applyLanguage = function () {
		if (!this.el) return;
		if (global.CSRangeI18n) global.CSRangeI18n.apply(this.host);
		if (this.el.language && global.CSRangeI18n) this.el.language.value = global.CSRangeI18n.getLocale();
		this._buyHintMode = null;
		this._pickupKey = -1;
		this.updateHUD();
		this.updateAmmoHUD();
		this.updateVitalsHUD();
		this.updateHostiles();
		this.updatePracticeHUD();
		this.updatePauseMute();
		this.updateBuyHint();
		if (this.buyOpen) this.renderBuy();
		if (this.scoreboardOpen) this.renderScoreboard();
		if (this.deathInfo && this.el.deathType) {
			text(this.el.deathType, this.deathInfo.headshot ? 'HEADSHOT · ELIMINATED BY' : 'ELIMINATED BY');
		}
	};

	RangeGame.prototype.onKeyDown = function (ev) {
		var k = ev.key;
		var code = k.toLowerCase();
		var combo = !!(ev.ctrlKey || ev.metaKey);

		/* While the range owns the screen, stop browser shortcuts from escaping
		   the page. Gameplay keys still fall through: holding CTRL to crouch and
		   pressing S must crouch-walk backwards, not open the Save dialog. */
		if (combo) {
			var gameKeyForCombo = ['w', 'a', 's', 'd', 'shift', 'control', ' ', 'r', 'b', 'tab', 'escape', 'enter', '1', '2', '3', 'e', 'm', 'h', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
			var isGameKey = gameKeyForCombo.indexOf(k === ' ' ? ' ' : code) !== -1;
			ev.preventDefault();
			ev.stopPropagation();
			if (this.state === 'menu' || this.state === 'boot' || this.state === 'error' || !isGameKey) return;
			/* Ctrl+W / Ctrl+T / Ctrl+N are browser-reserved and cannot be reliably
			   cancelled; the request explicitly leaves Ctrl+W alone. */
		}

		/* F5/F3/F1/F6/F7 reload, find, help and address-bar shortcuts can be
		   cancelled in Chromium while the game is mounted. F11/F12 are left to
		   the browser because they are often intentional. */
		if (!combo && (k === 'F5' || k === 'F3' || k === 'F1' || k === 'F6' || k === 'F7')) {
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}
		if (!combo && ev.altKey && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}

		if (this.el.team && !this.el.team.hidden) {
			if (k === 'Escape') { this.closeTeamSelect(); return; }
			if (k === '1') { this.chooseTeam('CT'); return; }
			if (k === '2') { this.chooseTeam('T'); return; }
			return;
		}
		/* controls is a modal layer above menu/pause: close it with Esc / H / Enter */
		if (this.el.controls && !this.el.controls.hidden) {
			if (k === 'Escape' || code === 'h' || k === 'Enter') {
				ev.preventDefault();
				ev.stopPropagation();
				this.closeControls();
			}
			return;
		}
		if (this.state === 'menu' || this.state === 'boot' || this.state === 'error') return;
		var gameKeys = ['w', 'a', 's', 'd', 'shift', 'control', ' ', 'r', 'b', 'tab', 'escape', '1', '2', '3', 'e', 'm', 'h', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
		if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'roundover' && this.state !== 'buy' && this.state !== 'matchover') return;
		if (gameKeys.indexOf(k === ' ' ? ' ' : code) !== -1) {
			if (ev.target && ev.target.tagName === 'INPUT') return;
			ev.preventDefault();
			ev.stopPropagation();
		}

		if (this.state === 'buy') {
			if (code === 'b' || k === 'Escape') { this.closeBuy(); return; }
			var n = Number(k);
			if (n >= 1 && n <= 9) {
				var item = null;
				for (var bi = 0; bi < C.BUY_ITEMS.length; bi++) {
					if (C.BUY_ITEMS[bi].key === n && this.canBuyItem(C.BUY_ITEMS[bi])) item = C.BUY_ITEMS[bi];
				}
				if (item) this.buyItem(item.id);
				return;
			}
			return;
		}
		if (this.state === 'paused') {
			if (k === 'Escape' || k === 'Enter') this.resume();
			else if (code === 'h') this.openControls('pause');
			else if (code === 'm') this.toggleMute();
			return;
		}
		if (this.state === 'matchover') {
			if (k === 'Enter') this.playAgain();
			return;
		}
		if (this.state === 'roundover') {
			if (k === ' ' || k === 'Enter') this.nextRound(true);
			return;
		}
		if (this.state !== 'playing') return;

		switch (code) {
			case 'w': this.keys.w = true; break;
			case 'a': this.keys.a = true; break;
			case 's': this.keys.s = true; break;
			case 'd': this.keys.d = true; break;
			case 'shift': this.keys.shift = true; break;
			case 'control': this.keys.ctrl = true; break;
			case ' ':
				this.keys.space = true;
				if (!ev.repeat) this.input.jumpQueued = true;
				break;
			case 'r':
				if (!ev.repeat) this.startReload();
				break;
			case 'e':
				this.input.defuse = true;
				if (!ev.repeat) {
					var c4 = this.bomb;
					var nearC4 = c4 && c4.state === 'planted' && this.player.alive &&
						Math.hypot(this.player.x - c4.x, this.player.z - c4.z) < 2.2;
					if (!nearC4) this.pickupNearest();
				}
				break;
			case 'b':
				if (!ev.repeat) { if (this.buyOpen) this.closeBuy(); else this.openBuy(); }
				break;
			case 'tab':
				if (!ev.repeat) this.openScoreboard();
				break;
			case 'escape':
				this.pause();
				break;
			case '1': this.equipWeapon(this.loadout.secondary); break;
			case '2': this.equipWeapon(this.loadout.primary || this.loadout.secondary); break;
			case '3': this.equipWeapon(this.loadout.melee); break;
			case 'm':
				if (!ev.repeat) this.toggleMute();
				break;
			case 'h':
				if (!ev.repeat) this.openControls('pause');
				break;
			case 'arrowup': this.cycleWeapon(-1); break;
			case 'arrowdown': this.cycleWeapon(1); break;
		}
		if (this.keys.w || this.keys.a || this.keys.s || this.keys.d) this.sound.ensure();
	};

	RangeGame.prototype.onKeyUp = function (ev) {
		var code = ev.key.toLowerCase();
		if (code === 'e') this.input.defuse = false;
		if (code === 'w') this.keys.w = false;
		else if (code === 'a') this.keys.a = false;
		else if (code === 's') this.keys.s = false;
		else if (code === 'd') this.keys.d = false;
		else if (code === 'shift') this.keys.shift = false;
		else if (code === 'control') this.keys.ctrl = false;
		else if (code === ' ') this.keys.space = false;
		else if (code === 'tab') { this.closeScoreboard(); }
	};

	RangeGame.prototype.onMouseMove = function (ev) {
		if ((!this.locked && !(this.fallbackLook && !this.isTouch)) || this.state !== 'playing' || !this.player.alive) return;
		var scale = 0.0021 * Number(this.settings.sens || 1);
		if (this.scoped) scale *= 0.33;
		var mx = ev.movementX || 0, my = ev.movementY || 0;
		this.player.yaw -= mx * scale;
		this.player.pitch -= my * scale;
		this.player.pitch = clamp(this.player.pitch, -1.48, 1.48);
		this.swayX = clamp(this.swayX + mx * 0.00004, -0.02, 0.02);
		this.swayY = clamp(this.swayY + my * 0.00003, -0.02, 0.02);
	};

	RangeGame.prototype.onCanvasMouseDown = function (ev) {
		if (this.player && !this.player.alive) {
			if (this.state === 'playing' || this.state === 'roundover') {
				if (ev.button === 0) {
					if (this.spectating) this.cycleSpectateTarget(1);
					else this.beginSpectate();
				}
			}
			return;
		}
		if (this.state !== 'playing') return;
		if (!this.isTouch && !this.locked && !this.fallbackLook) {
			this.requestLock();
			return;
		}
		if (ev.button === 2) {
			ev.preventDefault();
			this.toggleScope();
			return;
		}
		if (ev.button !== 0) return;
		this.sound.ensure();
		this.input.fire = true;
		var def = this.weaponDef(this.currentWeapon);
		if (!def.auto || this.currentSlot === 'melee') this.semiQueued = true;
	};

	RangeGame.prototype.onMouseUp = function (ev) {
		if (ev.button === 0) this.input.fire = false;
	};

	RangeGame.prototype.onWheel = function (ev) {
		if (this.state !== 'playing') return;
		ev.preventDefault();
		this.cycleWeapon(ev.deltaY > 0 ? 1 : -1);
	};

	RangeGame.prototype.setupTouch = function () {
		var self = this;
		if (this.el.touch) this.el.touch.hidden = false;
		this.on(this.el.canvas, 'pointerdown', function (ev) {
			if (!self.isTouch || self.player.alive) return;
			if (self.state !== 'playing' && self.state !== 'roundover') return;
			if (self.spectating) self.cycleSpectateTarget(1);
			else self.beginSpectate();
		});
		if (this.el.stick) {
			var active = false;
			var cx = 0, cy = 0;
			var move = function (ev) {
				ev.preventDefault();
				var rect = self.el.stick.getBoundingClientRect();
				var dx = (ev.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
				var dy = (ev.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
				var len = Math.hypot(dx, dy);
				if (len > 1) { dx /= len; dy /= len; }
				self.input.touchMoveX = dx;
				self.input.touchMoveY = -dy;
				var knob = self.el.stick.querySelector('i');
				if (knob) knob.style.transform = 'translate(' + (dx * 28) + 'px,' + (dy * 28) + 'px)';
			};
			this.on(self.el.stick, 'pointerdown', function (ev) {
				active = true;
				self.el.stick.setPointerCapture(ev.pointerId);
				move(ev);
			});
			this.on(self.el.stick, 'pointermove', function (ev) { if (active) move(ev); });
			var end = function () {
				active = false;
				self.input.touchMoveX = 0;
				self.input.touchMoveY = 0;
				var knob = self.el.stick.querySelector('i');
				if (knob) knob.style.transform = '';
			};
			this.on(self.el.stick, 'pointerup', end);
			this.on(self.el.stick, 'pointercancel', end);
		}
		if (this.el.touchFire) {
			this.on(this.el.touchFire, 'pointerdown', function (ev) {
				ev.preventDefault();
				self.sound.ensure();
				self.input.fire = true;
				var def = self.weaponDef(self.currentWeapon);
				if (!def.auto) self.semiQueued = true;
			});
			var stop = function () { self.input.fire = false; };
			this.on(this.el.touchFire, 'pointerup', stop);
			this.on(this.el.touchFire, 'pointercancel', stop);
			this.on(this.el.touchFire, 'pointerleave', stop);
		}
		if (this.el.touchReload) this.on(this.el.touchReload, 'click', function () { self.startReload(); });
		if (this.el.touchJump) this.on(this.el.touchJump, 'click', function () { self.input.jumpQueued = true; });
		if (this.el.touchCrouch) this.on(this.el.touchCrouch, 'click', function () {
			self.input.touchCrouch = !self.input.touchCrouch;
			self.el.touchCrouch.classList.toggle('is-active', self.input.touchCrouch);
		});
		if (this.el.touchScope) this.on(this.el.touchScope, 'click', function () { self.toggleScope(); });
		if (this.el.touchUse) {
			this.on(this.el.touchUse, 'pointerdown', function (ev) {
				ev.preventDefault();
				self.sound.ensure();
				var c4 = self.bomb;
				var nearC4 = c4 && c4.state === 'planted' && self.player.alive &&
					Math.hypot(self.player.x - c4.x, self.player.z - c4.z) < 2.2;
				if (!nearC4) self.pickupNearest();
				self.input.defuse = true;
			});
			var useEnd = function () { self.input.defuse = false; };
			this.on(this.el.touchUse, 'pointerup', useEnd);
			this.on(this.el.touchUse, 'pointercancel', useEnd);
			this.on(this.el.touchUse, 'pointerleave', useEnd);
		}
		if (this.el.touchBuy) this.on(this.el.touchBuy, 'click', function () {
			if (self.buyOpen) self.closeBuy(); else self.openBuy();
		});
		if (this.el.touchPause) this.on(this.el.touchPause, 'click', function () { self.pause(); });
		if (this.el.touchScore) this.on(this.el.touchScore, 'click', function () {
			if (self.scoreboardOpen) self.closeScoreboard(); else self.openScoreboard();
		});

		/* touch look on the field */
		var lookId = null, lastX = 0, lastY = 0;
		this.on(this.el.canvas, 'pointerdown', function (ev) {
			if (ev.pointerType === 'mouse') return;
			if (self.state !== 'playing') return;
			lookId = ev.pointerId;
			lastX = ev.clientX; lastY = ev.clientY;
		});
		this.on(this.el.canvas, 'pointermove', function (ev) {
			if (ev.pointerType === 'mouse' || ev.pointerId !== lookId) return;
			var scale = 0.003 * Number(self.settings.sens || 1);
			self.player.yaw -= (ev.clientX - lastX) * scale;
			self.player.pitch -= (ev.clientY - lastY) * scale;
			self.player.pitch = clamp(self.player.pitch, -1.48, 1.48);
			lastX = ev.clientX; lastY = ev.clientY;
		});
		var endLook = function (ev) { if (ev.pointerId === lookId) lookId = null; };
		this.on(this.el.canvas, 'pointerup', endLook);
		this.on(this.el.canvas, 'pointercancel', endLook);
	};

	/* ======================================================================
	   render
	   ====================================================================== */
	RangeGame.prototype.render = function () {
		if (!this.renderer) return;
		var overlayState = this.state === 'paused' || this.state === 'buy' || this.state === 'roundover' || this.state === 'matchover';
		/* Freeze the 3D view under a modal overlay: the backdrop blur is static,
		   so repainting the WebGL scene behind it every frame is wasted work. */
		if (overlayState && this._overlayDrawn) return;
		if (this.state === 'menu' || this.state === 'boot' || this.state === 'error') {
			this._overlayDrawn = false;
			this.renderer.clear();
			this.renderer.render(this.scene, this.menuCamera);
			return;
		}
		this.updateCamera();
		this.renderer.clear();
		this.renderer.render(this.scene, this.camera);
		if (!this.scoped && this.currentWeapon && this.player.alive) {
			this.renderer.clearDepth();
			this.renderer.render(this.viewScene, this.viewCamera);
		}
		this._overlayDrawn = overlayState;
	};

	/* ======================================================================
	   teardown + public API
	   ====================================================================== */
	RangeGame.prototype.destroy = function () {
		if (this.raf) global.cancelAnimationFrame(this.raf);
		this.offAll();
		this.releaseLock(true);
		this.state = 'destroyed';
		doc.documentElement.classList.remove('csr-lock');
		if (this.sound) this.sound.dispose();
		if (this.renderer) {
			try { this.renderer.dispose(); } catch (e) {}
			try { this.renderer.forceContextLoss(); } catch (e2) {}
		}
		this.clearDrops();
		this.clearTargets();
		this.clearChickens();
		this.bots = [];
		this.botHitMeshes = [];
	};

	RangeGame.prototype.debugState = function () {
		return {
			state: this.state,
			round: this.match ? this.match.round : 0,
			score: this.match ? [this.match.ct, this.match.t] : [0, 0],
			phase: this.round ? this.round.phase : null,
			health: Math.round(this.player.health),
			armor: this.player.armor,
			alive: this.player.alive,
			botsAlive: this.bots.filter(function (b) { return b.alive; }).length,
			ctAlive: this.aliveTeamCount('CT'),
			tAlive: this.aliveTeamCount('T'),
			bots: this.bots.map(function (b) { return { name: b.name, team: b.team, role: b.role, mode: b.mode, type: b.type.id, weapon: b.weaponId, weaponIndex: b.weaponIndex, loadout: (b.weapons || []).map(function (w) { return w.id; }), inventory: (b.weapons || []).map(function (w) { return { id: w.id, ammo: w.ammo, reloading: w.reloading }; }), burstMode: !!b.burstMode, burstLeft: b.burstLeft, hasSniper: !!b.hasSniper, hp: Math.round(b.hp), maxHp: b.maxHp, alive: b.alive, ammo: b.ammo, reloading: b.reloading, behavior: b.behavior, target: b.target ? b.target.kind : null, x: +b.x.toFixed(2), z: +b.z.toFixed(2) }; }),
			bomb: this.bomb ? { state: this.bomb.state, site: this.bomb.site, fuse: +this.bomb.fuse.toFixed(1), carrier: this.bomb.carrier ? this.bomb.carrier.name : null, defuser: this.bomb.defuser ? this.bomb.defuser.name : null, defuse: +this.bomb.defuseProgress.toFixed(2), playerDefuse: +this.bomb.playerDefuseProgress.toFixed(2) } : null,
			defuseKit: !!this.defuseKit,
			playerTeam: this.playerTeam,
			playerHasBomb: !!this.playerHasBomb,
			playerPlanting: !!this.playerPlanting,
			spectating: !!this.spectating,
			spectateTarget: this.spectateTarget ? this.spectateTarget.name : null,
			weapon: this.currentWeapon,
			ammo: this.ammo[this.currentWeapon],
			money: this.match ? this.match.money : 0,
			drops: this.drops.map(function (d) { return { weapon: d.weaponId, x: +d.x.toFixed(2), z: +d.z.toFixed(2), mag: d.ammo.mag, reserve: d.ammo.reserve, life: +d.life.toFixed(1) }; }),
			locked: this.locked,
			practice: !!this.practice,
			practiceStats: this.practiceStats,
			targets: this.targets.map(function (t) { return { x: +t.x.toFixed(2), z: +t.z.toFixed(2), down: t.down, kind: t.kind, move: t.move }; }),
			chickens: this.chickens.map(function (c) { return { x: +c.x.toFixed(2), z: +c.z.toFixed(2), alive: c.alive, flee: c.flee }; }),
			death: this.deathInfo ? { killedBy: this.deathInfo.name, weapon: this.deathInfo.weapon, timer: +this.deathTimer.toFixed(2), body: !!(this.playerBody && this.playerBody.visible), camera: { x: +this.camera.position.x.toFixed(2), y: +this.camera.position.y.toFixed(2), z: +this.camera.position.z.toFixed(2) } } : null,
			player: { x: +this.player.x.toFixed(2), z: +this.player.z.toFixed(2), yaw: +this.player.yaw.toFixed(2) }
		};
	};

	RangeGame.prototype.debugStart = function () {
		this.startMatch();
		return this.debugState();
	};

	RangeGame.prototype.debugPractice = function () {
		this.startPractice();
		return this.debugState();
	};

	RangeGame.prototype.debugKillPlayer = function (index) {
		var bot = this.bots[Math.max(0, Math.min(this.bots.length - 1, index || 0))] || null;
		this.applyPlayerDamage(999, bot);
		return this.debugState();
	};

	RangeGame.prototype.debugTeleport = function (x, z, yaw) {
		this.player.x = x; this.player.z = z;
		this.player.feetY = 0; this.player.vy = 0;
		if (yaw != null) this.player.yaw = yaw;
		return this.debugState();
	};

	RangeGame.prototype.debugLookAt = function (x, z) {
		this.player.yaw = Math.atan2(-(x - this.player.x), -(z - this.player.z));
		return this.debugState();
	};

	RangeGame.prototype.debugKillAll = function () {
		for (var i = 0; i < this.bots.length; i++) if (this.bots[i].alive && this.bots[i].team === this.enemyTeam) this.killBot(this.bots[i], false, 'DEBUG', 'player');
		return this.debugState();
	};

	RangeGame.prototype.debugShoot = function () {
		this.semiQueued = true;
		this.input.fire = true;
		this.nextFire = 0;
		this.tryFire();
		this.input.fire = false;
		return this.debugState();
	};

	RangeGame.prototype.debugEndRound = function (win) {
		this.endRound(!!win, 'Debug round end.');
		return this.debugState();
	};

	/* ======================================================================
	   mounting
	   ====================================================================== */
	function destroyCurrent() {
		if (current) {
			try { current.destroy(); } catch (e) { console.warn('[dust range] destroy failed', e); }
			current = null;
		}
	}

	function mountAll(scope) {
		var host = (scope || doc).querySelector('[data-cs-range]');
		if (!host && scope && scope.matches && scope.matches('[data-cs-range]')) host = scope;
		if (!host) return null;
		if (current && current.host === host) return current;
		destroyCurrent();
		if (!THREE || !C) {
			var hint = host.querySelector('[data-csr-loading-hint]');
			if (hint) hint.textContent = 'THREE.JS OR GAME CONTENT FAILED TO LOAD';
			return null;
		}
		current = new RangeGame(host);
		current.init();
		return current;
	}

	doc.addEventListener('route:changed', function (ev) {
		var route = ev.detail && ev.detail.route;
		if (route !== ROUTE && current) destroyCurrent();
	});

	global.CSRange = {
		__real: true,
		mountAll: mountAll,
		destroy: destroyCurrent,
		active: function () { return !!current; },
		get game() { return current; },
		debug: {
			state: function () { return current ? current.debugState() : null; },
			start: function () { return current ? current.debugStart() : null; },
			practice: function () { return current ? current.debugPractice() : null; },
			killPlayer: function (i) { return current ? current.debugKillPlayer(i) : null; },
			teleport: function (x, z, yaw) { return current ? current.debugTeleport(x, z, yaw) : null; },
			lookAt: function (x, z) { return current ? current.debugLookAt(x, z) : null; },
			killAll: function () { return current ? current.debugKillAll() : null; },
			shoot: function () { return current ? current.debugShoot() : null; },
			endRound: function (win) { return current ? current.debugEndRound(win) : null; }
		}
	};
})(window);
