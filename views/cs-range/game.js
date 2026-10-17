/**
 * views/cs-range/game.js — DUST RANGE
 *
 * The match layer: pointer-lock FPS controller, hitscan weapons, round economy,
 * buy menu, random robot AI with A* navigation, kill feed, radar and HUD.
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
	var MATCH_TARGET = 8;

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
		value = String(value);
		if (node.textContent !== value) node.textContent = value;
	}
	function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
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
			difficulty: 'regular', squad: 5, quality: 'balanced',
			sens: 1, volume: 0.7, muted: false
		}, loadJSON(SETTINGS_KEY, {}));
		this.records = Object.assign({
			bestWins: 0, bestRounds: 0, bestKills: 0, matches: 0
		}, loadJSON(RECORDS_KEY, {}));

		this.bots = [];
		this.botHitMeshes = [];
		this.tracers = [];
		this.sparks = [];
		this.debris = [];
		this.shells = [];
		this.decals = [];
		this.drops = [];
		this.dropSeq = 0;
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
			forward: 0, strafe: 0, fire: false,
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
			deploy: $(h, 'deploy'),
			menuExit: $(h, 'menu-exit'),
			openControls: $(h, 'open-controls'),
			openSettings: $(h, 'open-settings'),
			settingsPanel: $(h, 'settings-panel'),
			mapPreview: $(h, 'map-preview'),
			menuHostiles: $(h, 'menu-hostiles'),
			difficulty: $(h, 'difficulty'),
			squad: $(h, 'squad'),
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
			scoreCt: $(h, 'score-ct'),
			scoreT: $(h, 'score-t'),
			phaseLabel: $(h, 'phase-label'),
			pips: $(h, 'pips'),
			hostiles: $(h, 'hostiles'),
			hostileDots: $(h, 'hostile-dots'),
			killfeed: $(h, 'killfeed'),
			crosshair: $(h, 'crosshair'),
			hitmarker: $(h, 'hitmarker'),
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
			touchPause: $(h, 'touch-pause'),
			touchScore: $(h, 'touch-score'),
			scoreClose: $(h, 'score-close'),
			buy: $(h, 'buy'),
			buyGrid: $(h, 'buy-grid'),
			buyMoney: $(h, 'buy-money'),
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

		this.on(e.deploy, 'click', function () { self.startMatch(); });
		this.on(e.menuExit, 'click', function () { self.exitToGames(); });
		this.on(e.openControls, 'click', function () { self.openControls('menu'); });
		this.on(e.openSettings, 'click', function () {
			if (!e.settingsPanel) return;
			e.settingsPanel.scrollIntoView({ behavior: self.reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
			e.settingsPanel.classList.add('is-pulse');
			setTimeout(function () { e.settingsPanel.classList.remove('is-pulse'); }, 700);
		});

		if (e.difficulty) {
			e.difficulty.addEventListener('click', function (ev) {
				var b = ev.target.closest ? ev.target.closest('button[data-value]') : null;
				if (!b) return;
				self.settings.difficulty = b.getAttribute('data-value');
				self.syncSettingsUI();
				self.saveSettings();
			});
		}
		if (e.squad) {
			e.squad.addEventListener('click', function (ev) {
				var b = ev.target.closest ? ev.target.closest('button[data-value]') : null;
				if (!b) return;
				var v = b.getAttribute('data-value');
				self.settings.squad = (v === 'auto') ? 'auto' : Number(v);
				self.syncSettingsUI();
				self.saveSettings();
			});
		}
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
		if (this.isTouch) this.setupTouch();
	};

	RangeGame.prototype.syncSettingsUI = function () {
		var s = this.settings;
		var e = this.el;
		if (e.difficulty) {
			Array.prototype.forEach.call(e.difficulty.querySelectorAll('button'), function (b) {
				b.classList.toggle('is-active', b.getAttribute('data-value') === s.difficulty);
			});
		}
		if (e.squad) {
			var want = String(s.squad);
			Array.prototype.forEach.call(e.squad.querySelectorAll('button'), function (b) {
				b.classList.toggle('is-active', b.getAttribute('data-value') === want);
			});
		}
		if (e.quality) {
			Array.prototype.forEach.call(e.quality.querySelectorAll('button'), function (b) {
				b.classList.toggle('is-active', b.getAttribute('data-value') === s.quality);
			});
		}
		if (e.sens) e.sens.value = String(s.sens);
		if (e.sensValue) text(e.sensValue, Number(s.sens).toFixed(2));
		if (e.vol) e.vol.value = String(s.volume);
		if (e.volValue) text(e.volValue, Math.round(Number(s.volume) * 100) + '%');
		if (e.menuHostiles) {
			text(e.menuHostiles, s.squad === 'auto' ? 'AUTO' : String(s.squad));
		}
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
		this.state = 'menu';
		doc.documentElement.classList.add('csr-lock');
		if (this.el.hud) this.el.hud.hidden = true;
		if (this.el.menu) this.el.menu.hidden = false;
		this.hideOverlays();
		if (this.el.loading) this.el.loading.hidden = true;
		this.releaseLock(true);
	};

	RangeGame.prototype.hideMenu = function () {
		if (this.el.menu) this.el.menu.hidden = true;
	};

	RangeGame.prototype.hideOverlays = function () {
		var e = this.el;
		[e.buy, e.pause, e.result, e.scoreboard, e.controls, e.match].forEach(function (n) {
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
		/* floor */
		ctx.fillStyle = detailed ? 'rgba(190,162,120,0.08)' : 'rgba(190,162,120,0.06)';
		ctx.fillRect(X(-B), Y(-B), B * 2 * s, B * 2 * s);
		/* colliders */
		var cols = this.world ? this.world.colliders : [];
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (c.minY > 2) continue;
			var hgt = c.maxY - c.minY;
			ctx.fillStyle = hgt > 3 ? 'rgba(207,182,143,0.28)' : hgt > 1.6 ? 'rgba(207,182,143,0.45)' : 'rgba(215,162,74,0.5)';
			ctx.fillRect(X(c.minX), Y(c.minZ), Math.max(1, (c.maxX - c.minX) * s), Math.max(1, (c.maxZ - c.minZ) * s));
		}
		/* sites */
		if (this.world) {
			this.world.sites.forEach(function (site) {
				ctx.strokeStyle = 'rgba(212,89,67,0.7)';
				ctx.lineWidth = detailed ? 2 : 1.2;
				ctx.beginPath();
				ctx.arc(X(site.x), Y(site.z), site.r * s, 0, Math.PI * 2);
				ctx.stroke();
				ctx.fillStyle = 'rgba(212,89,67,0.8)';
				ctx.font = '700 ' + Math.round(14 * s / 4.3) + 'px Bahnschrift, Arial Narrow, sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(site.id, X(site.x), Y(site.z));
			});
		}
		/* spawn markers */
		ctx.fillStyle = 'rgba(111,159,216,0.8)';
		ctx.beginPath();
		ctx.arc(X(0), Y(31), 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = 'rgba(217,164,65,0.8)';
		ctx.beginPath();
		ctx.arc(X(0), Y(-31), 4, 0, Math.PI * 2);
		ctx.fill();
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
		/* a little print-map typography around the square preview */
		ctx.fillStyle = 'rgba(232,226,212,0.3)';
		ctx.font = '9px Consolas, monospace';
		ctx.textAlign = 'right';
		ctx.fillText('76 × 76 M', c.width - 16, 24);
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
		var px = ox + (this.player.x + B) * s;
		var py = oy + (this.player.z + B) * s;

		/* view cone */
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

		/* bots */
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			if (!b || (!b.alive && b.deathT > 0.8)) continue;
			var bx = ox + (b.x + B) * s;
			var by = oy + (b.z + B) * s;
			ctx.fillStyle = b.alive ? 'rgba(224,88,62,0.95)' : 'rgba(224,88,62,0.25)';
			ctx.beginPath();
			ctx.arc(bx, by, b.alive ? 3.4 : 2.2, 0, Math.PI * 2);
			ctx.fill();
			if (b.alive) {
				ctx.strokeStyle = 'rgba(224,88,62,0.32)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
				ctx.stroke();
			}
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
			shots: 0, hits: 0, money: 800, started: 0
		};
		this.roundHistory = [];
		this.loadout = { primary: null, secondary: 'usp', melee: 'knife' };
		this.ammo = {};
		Object.keys(C.WEAPONS).forEach(function (id) { this.ammo[id] = { mag: C.WEAPONS[id].mag, reserve: C.WEAPONS[id].reserve }; }, this);
		this.player.health = 100;
		this.player.armor = 0;
		this.player.alive = true;
		this.playerDiedLastRound = false;
		this.matchStartedAt = this.now;
		this.equipWeapon('usp', true);
		this.updateScoreHUD();
	};

	RangeGame.prototype.startMatch = function () {
		if (!this.renderer) return;
		this.sound.ensure();
		this.sound.setVolume(this.settings.volume);
		this.hideMenu();
		this.hideOverlays();
		if (this.el.hud) this.el.hud.hidden = false;
		this.resetMatch();
		this.startRound(true);
		this.focusField();
		if (!this.isTouch) this.requestLock();
		if (this.isTouch && this.el.touch) this.el.touch.hidden = false;
	};

	RangeGame.prototype.squadCount = function () {
		if (this.settings.squad === 'auto') return clamp(3 + Math.floor((this.match.round - 1) / 2), 3, 7);
		return clamp(Number(this.settings.squad) || 5, 1, 7);
	};

	RangeGame.prototype.pickBotType = function () {
		var round = this.match.round;
		var pool = ['scout', 'trooper', 'trooper', 'trooper'];
		if (round >= 2) pool.push('heavy');
		if (round >= 2) pool.push('heavy');
		if (round >= 3) pool.push('sniper');
		if (round >= 4) pool.push('scout', 'sniper');
		return C.choice(pool);
	};

	RangeGame.prototype.startRound = function (first) {
		var self = this;
		if (!first) this.match.round++;
		this.clearBots();
		this.clearFx();
		this.round = {
			phase: 'freeze', timer: 120, freezeLeft: 6.5,
			ended: false
		};
		this.roundStats = { kills: 0, hs: 0, shots: 0, hits: 0 };
		this.state = 'playing';
		this.resultReward = 0;
		var lostLoadout = !first && this.playerDiedLastRound;
		this.playerDiedLastRound = false;
		this.updateRoundNo();
		this.updateScoreHUD();
		this.updatePips();

		/* player respawn */
		var p = this.player;
		p.x = C.PLAYER_SPAWN.x; p.z = C.PLAYER_SPAWN.z;
		p.feetY = 0; p.vy = 0; p.vx = 0; p.vz = 0;
		p.yaw = 0; p.pitch = 0;
		p.alive = true; p.health = 100; p.onGround = true;
		p.deathRoll = 0; p.deathT = 0;
		p.eye = 1.62; p.eyeTarget = 1.62; p.height = 1.78;
		this.recoilPitch = 0; this.recoilYaw = 0; this.shake = 0;
		this.reloading = false; this.scoped = false; this.scopeT = 0;
		this.input.fire = false; this.input.crouch = false; this.semiQueued = false;
		this.keys.ctrl = false;
		this.deathTimer = 0;
		this.hideOverlays();
		if (this.el.hud) this.el.hud.hidden = false;

		/* if the player died last round, the loadout is lost */
		if (first || lostLoadout || !this.loadout.secondary) {
			this.loadout = { primary: null, secondary: 'usp', melee: 'knife' };
			Object.keys(C.WEAPONS).forEach(function (id) {
				this.ammo[id] = { mag: C.WEAPONS[id].mag, reserve: C.WEAPONS[id].reserve };
			}, this);
			p.armor = 0;
			this.equipWeapon('usp', true);
		} else {
			var spent = this.ammo[this.currentWeapon];
			if (spent && spent.mag <= 0 && spent.reserve <= 0) this.equipWeapon(this.loadout.secondary, true);
			else this.equipWeapon(this.currentWeapon, true);
		}
		this.updateAmmoHUD();
		this.updateVitalsHUD();

		/* robots */
		var count = this.squadCount();
		var used = [];
		this.usedBotNames = {};
		var spawns = C.shuffle(C.BOT_SPAWNS.slice());
		for (var i = 0; i < count; i++) {
			var type = this.pickBotType();
			var pos = this.pickSpawn(spawns, used);
			if (!pos) break;
			used.push(pos);
			this.spawnBot(type, pos);
		}
		this.clearDrops();
		this.updateHostiles();
		this.updateBuyHint();
		this.updateScoreHUD();
		this.updatePips();
		if (this.el.killfeed) { this.el.killfeed.innerHTML = ''; this.killFeed.length = 0; }
		this.announce('ROUND ' + this.match.round, 'BUY TIME — PRESS B TO OPEN THE ARMORY');
		this.sound.roundStart();
		this.updateHUD();
		this.focusField();
	};

	RangeGame.prototype.pickSpawn = function (spawns, used) {
		var p = this.player;
		for (var i = 0; i < spawns.length; i++) {
			var s = spawns[i];
			if (used.indexOf(s) !== -1) continue;
			if (Math.hypot(s.x - p.x, s.z - p.z) < 13) continue;
			if (this.collidesBot(s.x, s.z, 0.45)) continue;
			return s;
		}
		for (var j = 0; j < spawns.length; j++) {
			if (!this.collidesBot(spawns[j].x, spawns[j].z, 0.45)) return spawns[j];
		}
		return null;
	};

	RangeGame.prototype.spawnBot = function (typeId, pos) {
		var type = C.BOT_TYPES[typeId] || C.BOT_TYPES.trooper;
		var torsos = ['#b9b0a0', '#8b9690', '#6d746d', '#a69783', '#9d7d61', '#7d858f'];
		var accents = ['#e2603b', '#f2a23c', '#d84b36', '#ff5f45', '#7ab6b0', '#d6c26a', '#9a8cff'];
		var name = C.robotName();
		for (var attempt = 0; attempt < 24 && this.usedBotNames && this.usedBotNames[name]; attempt++) name = C.robotName();
		if (this.usedBotNames) this.usedBotNames[name] = true;
		var robot = C.buildRobot({
			type: type, name: name,
			torso: C.choice(torsos), accent: C.choice(accents)
		});
		robot.baseScale = type.scale || 1;
		robot.root.scale.setScalar(robot.baseScale * 0.05);
		robot.root.position.set(pos.x, 0, pos.z);
		robot.root.rotation.y = Math.atan2(-pos.x, -pos.z);
		robot.root.traverse(function (o) {
			if (o.isMesh || o.isSprite) {
				if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
			}
		});
		this.scene.add(robot.root);
		robot.flash = new THREE.Sprite(new THREE.SpriteMaterial({
			map: this.tex.glow, color: 0xffc070, transparent: true,
			blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true
		}));
		robot.flash.scale.set(0.52, 0.52, 1);
		robot.flash.visible = false;
		robot.muzzle.add(robot.flash);

		var weaponId = C.choice(type.weaponPool || ['ak47']);
		var weaponDef = C.WEAPONS[weaponId] || C.WEAPONS.ak47;
		var magSize = Math.max(4, Math.round(weaponDef.mag * C.rand(0.55, 0.82)));

		var bot = {
			robot: robot,
			root: robot.root,
			x: pos.x, z: pos.z, y: 0,
			baseScale: robot.baseScale,
			hp: robot.hp, maxHp: robot.maxHp,
			alive: true, dead: false,
			type: type, name: name,
			speed: type.speed * (0.92 + Math.random() * 0.16),
			accuracy: type.accuracy * (0.92 + Math.random() * 0.16),
			damage: type.damage,
			weaponId: weaponId,
			weaponDef: weaponDef,
			magSize: magSize,
			ammo: magSize,
			reloading: false,
			reloadEnd: 0,
			reloadSoundAt: 0,
			stationaryUntil: 0,
			behavior: 'hunt',
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
			stuck: 0,
			lastX: pos.x, lastZ: pos.z,
			state: 'hunt',
			yaw: robot.root.rotation.y,
			strafe: Math.random() < 0.5 ? -1 : 1,
			strafeTimer: 0,
			walkPhase: Math.random() * 6,
			spawnT: 0,
			deathT: 0,
			deathSpin: C.rand(-2.4, 2.4),
			headshotDeath: false,
			kills: 0, deaths: 0,
			ping: C.randi(12, 42),
			flashUntil: 0,
			footTimer: 0
		};
		robot.head.userData = { bot: bot, part: 'head', hit: true };
		robot.torso.userData = { bot: bot, part: 'body', hit: true };
		if (robot.bodyHit) robot.bodyHit.userData = { bot: bot, part: 'body', hit: true };
		robot.hp = bot.hp;
		robot.maxHp = bot.maxHp;
		robot.reloading = false;
		C.drawHealthSprite(robot);
		this.bots.push(bot);
		this.botHitMeshes.push(robot.head, robot.torso);
		if (robot.bodyHit) this.botHitMeshes.push(robot.bodyHit);
		return bot;
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

	RangeGame.prototype.updateRoundNo = function () {
		text(this.el.roundNo, this.match.round);
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
		var history = this.roundHistory.slice(-8);
		var html = '';
		for (var i = 0; i < 8; i++) {
			if (history[i]) html += '<i class="is-' + history[i] + '"></i>';
			else html += '<i></i>';
		}
		this.el.pips.innerHTML = html;
	};

	RangeGame.prototype.updateHostiles = function () {
		var alive = 0;
		for (var i = 0; i < this.bots.length; i++) if (this.bots[i].alive) alive++;
		text(this.el.hostiles, alive);
		if (this.el.hostileDots) {
			var html = '';
			for (var d = 0; d < alive; d++) html += '<span></span>';
			this.el.hostileDots.innerHTML = html;
		}
	};

	RangeGame.prototype.updateRoundTimer = function () {
		var val;
		if (this.state === 'roundover' || this.state === 'matchover') val = '0:00';
		else if (this.round && this.round.phase === 'freeze') val = fmtTime(this.round.freezeLeft);
		else if (this.round) val = fmtTime(this.round.timer);
		else val = '1:55';
		text(this.el.roundTimer, val);
		if (this.el.phaseLabel) {
			var label = 'BUY TIME';
			if (this.state === 'roundover') label = 'ROUND OVER';
			else if (this.state === 'matchover') label = 'MATCH OVER';
			else if (this.round && this.round.phase === 'live') label = 'LIVE';
			text(this.el.phaseLabel, label);
		}
	};

	RangeGame.prototype.updateBuyHint = function () {
		if (!this.el.buyhint) return;
		var show = this.state === 'playing' && this.round && this.round.phase === 'freeze';
		this.el.buyhint.classList.toggle('is-hidden', !show);
	};

	RangeGame.prototype.announce = function (main, sub) {
		var a = this.el.announce;
		if (!a) return;
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
			this.updateMatch(dt);
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
				this.announce('ROUND START', 'ELIMINATE THE ROBOT SQUAD');
				this.sound.roundStart();
				this.updateBuyHint();
				if (this.buyOpen) this.closeBuy();
			}
		}
		if (round.phase === 'live' && this.player.alive) {
			round.timer -= dt;
			if (round.timer <= 0) {
				round.timer = 0;
				this.endRound(false, 'Time expired before the squad was eliminated.');
			}
		}

		this.updatePlayer(dt);
		this.updateWeapon(dt);
		this.updateBots(dt);
		this.updateFx(dt);
		this.updateRoundTimer();
		this.updateVitalsHUD();
		this.updateAmmoHUD();
		this.updateCrosshair();

		if (!this.player.alive) {
			this.deathTimer -= dt;
			if (this.deathTimer <= 0) this.endRound(false, 'You were eliminated by the robot squad.');
		} else if (round.phase === 'live') {
			var alive = 0;
			for (var i = 0; i < this.bots.length; i++) if (this.bots[i].alive) alive++;
			if (alive === 0) this.endRound(true, 'All hostiles eliminated.');
		}
		this.updateBuyHint();
	};

	RangeGame.prototype.updateResult = function (dt) {
		this.resultTimer -= dt;
		if (this.el.resultNext) {
			text(this.el.resultNext, 'NEXT ROUND IN ' + Math.max(1, Math.ceil(this.resultTimer)));
		}
		this.updateFx(dt);
		this.updateViewWeapon(dt);
		if (this.resultTimer <= 0) this.nextRound(false);
	};

	RangeGame.prototype.nextRound = function (manual) {
		if (this.state !== 'roundover') return;
		if (this.match.ct >= MATCH_TARGET || this.match.t >= MATCH_TARGET) {
			this.showMatch();
			return;
		}
		if (this.el.result) this.el.result.hidden = true;
		this.startRound(false);
	};

	RangeGame.prototype.endRound = function (win, reason) {
		if (!this.round || this.round.ended) return;
		this.round.ended = true;
		this.round.phase = 'over';
		this.state = 'roundover';
		this.closeScoreboard();
		this.input.fire = false;
		this.semiQueued = false;
		this.reloading = false;
		this.scoped = false;
		this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
		this.updateBuyHint();

		var reward = win ? 3250 : 1900;
		this.resultReward = reward;
		this.match.money = clamp(this.match.money + reward, 0, 16000);
		if (win) this.match.ct++; else this.match.t++;
		this.roundHistory.push(win ? 'ct' : 't');
		if (win) this.sound.win(); else this.sound.lose();
		this.updateScoreHUD();
		this.updatePips();
		this.updateHostiles();
		this.updateHUD();

		var e = this.el;
		if (e.resultPanel) e.resultPanel.dataset.outcome = win ? 'win' : 'lose';
		text(e.resultKicker, 'ROUND ' + this.match.round);
		text(e.resultTitle, win ? 'COUNTER-TERRORISTS WIN' : 'ROBOT SQUAD WINS');
		text(e.resultReason, reason || '');
		text(e.resultScore, 'CT ' + this.match.ct + ' — ' + this.match.t + ' T');
		text(e.resultKills, this.roundStats.kills);
		text(e.resultHs, this.roundStats.hs);
		text(e.resultAcc, (this.roundStats.shots ? Math.round(this.roundStats.hits / this.roundStats.shots * 100) : 0) + '%');
		text(e.resultReward, '+' + fmtMoney(reward));
		text(e.resultNext, 'NEXT ROUND IN 5');
		if (e.result) e.result.hidden = false;
		this.resultTimer = 5.2;
	};

	RangeGame.prototype.showMatch = function () {
		this.closeScoreboard();
		this.state = 'matchover';
		var won = this.match.ct >= MATCH_TARGET;
		var e = this.el;
		if (e.result) e.result.hidden = true;
		if (e.pause) e.pause.hidden = true;
		if (e.buy) e.buy.hidden = true;
		if (e.scoreboard) e.scoreboard.hidden = true;
		if (e.matchPanel) e.matchPanel.dataset.outcome = won ? 'won' : 'lost';
		text(e.matchTitle, won ? 'VICTORY' : 'DEFEAT');
		text(e.matchCopy, won ? 'The training site is clear. Operation complete.' : 'The robot squad held the site. Regroup and try again.');
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
		r.bestWins = Math.max(r.bestWins || 0, this.match.ct);
		r.totalRounds = (r.totalRounds || 0) + this.match.ct;
		r.bestRounds = Math.max(r.bestRounds || 0, this.match.ct);
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

		/* horizontal collision, axis separated for wall sliding */
		var nx = p.x + p.vx * dt;
		if (!this.collidesAt(nx, p.z, p.feetY, p.height)) p.x = nx;
		else p.vx = 0;
		var nz = p.z + p.vz * dt;
		if (!this.collidesAt(p.x, nz, p.feetY, p.height)) p.z = nz;
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
		var bob = 0, bobX = 0;
		if (!this.reduceMotion && p.onGround && p.speed > 1.2) {
			bob = Math.sin(p.bobPhase * 2.1) * 0.012 * Math.min(p.speed / 5, 1);
			bobX = Math.cos(p.bobPhase * 1.05) * 0.008 * Math.min(p.speed / 5, 1);
		}
		var shake = this.shake;
		var sx = (Math.random() - 0.5) * shake * 0.05;
		var sy = (Math.random() - 0.5) * shake * 0.05;
		var roll = 0;
		var eye = p.eye;
		if (!p.alive) {
			eye = 0.36;
			roll = p.deathRoll;
		}
		this.camera.position.set(p.x + bobX + sx, p.feetY + eye + bob + sy, p.z);
		var pitch = p.pitch + this.recoilPitch;
		var yaw = p.yaw + this.recoilYaw;
		if (!p.alive) {
			pitch = -0.35;
			yaw = p.yaw;
		}
		this.camera.rotation.set(pitch, yaw, roll);
	};

	RangeGame.prototype.collidesAt = function (x, z, feetY, height) {
		var r = 0.34;
		var cols = this.world.colliders;
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (feetY + 0.06 >= c.maxY) continue;
			if (feetY + height <= c.minY + 0.02) continue;
			if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
		}
		return false;
	};

	RangeGame.prototype.collidesBot = function (x, z, r) {
		var cols = this.world.colliders;
		for (var i = 0; i < cols.length; i++) {
			var c = cols[i];
			if (c.maxY < 0.2) continue;
			if (c.minY > 1.6) continue;
			if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
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
			if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) best = c.maxY;
		}
		return best;
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
		var take = Math.min(need, ammo.reserve);
		ammo.mag += take;
		ammo.reserve -= take;
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
		var anyHit = false, anyHead = false;
		for (var pi = 0; pi < pellets; pi++) {
			var res = this.resolvePlayerShot(def, pellets > 1 ? 1.8 : 1);
			if (res.hit) { anyHit = true; if (res.head) anyHead = true; }
		}
		if (anyHit) {
			this.match.hits++;
			this.roundStats.hits++;
			this.showHitmarker(anyHead);
			this.sound.hit(anyHead);
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
		return out;
	};

	RangeGame.prototype.resolvePlayerShot = function (def, spreadScale) {
		var origin = this.camera.position.clone();
		var right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
		var up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
		origin.addScaledVector(right, 0.12).addScaledVector(up, -0.09);
		var dir = new THREE.Vector3();
		this.updateAimDirection(this.currentSpread() * (spreadScale || 1), dir);
		this.raycaster.set(origin, dir);
		this.raycaster.far = def.range;
		var targets = this.hitTargets();
		var hits = this.raycaster.intersectObjects(targets, false);
		this.raycaster.far = Infinity;
		var end;
		var result = { hit: false, head: false };
		if (hits.length) {
			var hit = hits[0];
			end = hit.point.clone();
			var data = hit.object.userData;
			if (data && data.bot && data.bot.alive) {
				var dmg = def.damage * (data.part === 'head' ? def.head : 1);
				if (def.pellets && hit.distance > 16) dmg *= clamp(1 - (hit.distance - 16) / 45, 0.32, 1);
				this.damageBot(data.bot, dmg, data.part === 'head', def.name);
				this.spawnSparks(end, 0xffd27a, def.pellets ? 4 : 8, 3.2);
				result.hit = true;
				result.head = data.part === 'head';
			} else {
				var n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
				this.spawnImpact(end, n, hit.object);
			}
		} else {
			end = origin.clone().addScaledVector(dir, def.range);
		}
		this.spawnTracer(origin, end, 0xffe0a0, 0.07);
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
		var scoped = this.scoped;
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
		var want = this.scoped && !!def.scope;
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
	RangeGame.prototype.updateBots = function (dt) {
		for (var i = 0; i < this.bots.length; i++) this.updateBot(this.bots[i], dt);
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

	RangeGame.prototype.tacticalSamples = function (bot, px, py, pz) {
		var eye = 1.5 * bot.baseScale;
		var out = [];
		var radii = [1.8, 2.8, 4, 5.5, 7];
		var bound = this.world.bounds - 1.6;
		for (var ri = 0; ri < radii.length; ri++) {
			var r = radii[ri];
			for (var ai = 0; ai < 16; ai++) {
				var a = (ai / 16) * Math.PI * 2;
				var x = bot.x + Math.cos(a) * r;
				var z = bot.z + Math.sin(a) * r;
				if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
				if (this.collidesBot(x, z, 0.5)) continue;
				out.push({
					x: x, z: z, dist: r,
					los: this.pointHasLos(x, eye, z, px, py, pz)
				});
			}
		}
		return out;
	};

	RangeGame.prototype.findCoverPoint = function (bot, px, py, pz) {
		if (!this.pointHasLos(bot.x, 1.5 * bot.baseScale, bot.z, px, py, pz)) {
			return { x: bot.x, z: bot.z, path: null };
		}
		var samples = this.tacticalSamples(bot, px, py, pz).filter(function (s) { return !s.los && s.dist >= 1.8; });
		samples.sort(function (a, b) { return a.dist - b.dist; });
		for (var i = 0; i < samples.length && i < 8; i++) {
			var s = samples[i];
			var path = C.findPath(this.nav, bot.x, bot.z, s.x, s.z);
			if (path && path.length) return { x: s.x, z: s.z, path: path };
		}
		return { x: bot.x, z: bot.z, path: null };
	};

	RangeGame.prototype.findPeekPoint = function (bot, px, py, pz) {
		var samples = this.tacticalSamples(bot, px, py, pz).filter(function (s) {
			return s.los && s.dist >= 1.4 && s.dist <= 6.5;
		});
		samples.sort(function (a, b) { return a.dist - b.dist; });
		for (var i = 0; i < samples.length && i < 8; i++) {
			var s = samples[i];
			var path = C.findPath(this.nav, bot.x, bot.z, s.x, s.z);
			if (path && path.length) return { x: s.x, z: s.z, path: path };
		}
		return null;
	};

	RangeGame.prototype.startTacticalMove = function (bot, point) {
		if (!point) { bot.tacTarget = null; bot.tacPath = null; return; }
		bot.tacTarget = { x: point.x, z: point.z };
		bot.tacPath = point.path || C.findPath(this.nav, bot.x, bot.z, point.x, point.z);
		bot.tacIndex = 0;
	};

	RangeGame.prototype.nextTacticalWaypoint = function (bot) {
		if (!bot.tacTarget) return null;
		if (bot.tacPath && bot.tacPath.length) {
			while (bot.tacIndex < bot.tacPath.length) {
				var wp = bot.tacPath[bot.tacIndex];
				if (Math.hypot(wp.x - bot.x, wp.z - bot.z) < 0.55) bot.tacIndex++;
				else return wp;
			}
		}
		return bot.tacTarget;
	};

	RangeGame.prototype.startBotReload = function (bot, px, py, pz) {
		if (bot.reloading) return;
		bot.reloading = true;
		var def = bot.weaponDef || C.WEAPONS.ak47;
		bot.reloadEnd = this.now + def.reload * 1000 * C.rand(0.9, 1.2);
		bot.behavior = 'reload';
		bot.behaviorSince = this.now;
		bot.behaviorUntil = 0;
		bot.reactionDone = false;
		bot.reaction = 0;
		bot.robot.reloading = true;
		var cover = this.findCoverPoint(bot, px, py, pz);
		bot.coverPoint = cover;
		this.startTacticalMove(bot, cover);
		var dist = Math.hypot(px - bot.x, pz - bot.z);
		if (dist < 24) {
			this.sound.burst({ dur: 0.06, type: 'bandpass', freq: 900, q: 1.2, gain: 0.045 * (1 - dist / 30), pan: this.panFor(bot.x, bot.z) });
		}
	};

	RangeGame.prototype.finishBotReload = function (bot) {
		bot.reloading = false;
		bot.ammo = bot.magSize;
		bot.behavior = 'hunt';
		bot.behaviorUntil = 0;
		bot.reactionDone = false;
		bot.reaction = 0;
		bot.robot.reloading = false;
		bot.stationaryUntil = 0;
		C.drawHealthSprite(bot.robot);
		var dist = Math.hypot(this.player.x - bot.x, this.player.z - bot.z);
		if (dist < 24) {
			this.sound.burst({ dur: 0.04, type: 'bandpass', freq: 1500, q: 1.1, gain: 0.04 * (1 - dist / 30), pan: this.panFor(bot.x, bot.z) });
		}
	};

	RangeGame.prototype.tryBotPeek = function (bot, px, py, pz) {
		if (bot.peekCooldown > 0) return false;
		var peek = this.findPeekPoint(bot, px, py, pz);
		if (!peek) {
			bot.peekCooldown = C.rand(1.4, 2.6);
			return false;
		}
		bot.behavior = 'peekOut';
		bot.behaviorSince = this.now;
		bot.behaviorUntil = this.now + C.rand(2200, 3400);
		bot.peekPoint = peek;
		bot.coverPoint = { x: bot.x, z: bot.z, path: null };
		bot.peeking = false;
		bot.peekCooldown = C.rand(5.5, 8.5);
		this.startTacticalMove(bot, peek);
		return true;
	};

	RangeGame.prototype.beginPeekRetreat = function (bot) {
		bot.behavior = 'peekIn';
		bot.behaviorSince = this.now;
		bot.behaviorUntil = this.now + C.rand(850, 1400);
		bot.peeking = false;
		this.startTacticalMove(bot, bot.coverPoint || { x: bot.x, z: bot.z });
	};

	RangeGame.prototype.updateBot = function (bot, dt) {
		var now = this.now;
		var root = bot.root;
		if (bot.dead) {
			this.updateBotsDeathOne(bot, dt);
			return;
		}
		bot.spawnT = Math.min(1, bot.spawnT + dt * 2.6);
		var targetScale = bot.baseScale * (0.35 + 0.65 * easeOut(bot.spawnT));
		root.scale.setScalar(targetScale);
		root.position.set(bot.x, 0, bot.z);

		if (this.round.phase !== 'live' || !this.player.alive) {
			this.animateBotIdle(bot, dt);
			return;
		}
		var p = this.player;
		var px = p.x, pz = p.z, py = p.feetY + p.eye;
		var dx = px - bot.x, dz = pz - bot.z;
		var dist = Math.hypot(dx, dz) || 0.001;
		var los = this.botLineOfSight(bot, px, py, pz);
		var diff = C.DIFFICULTY[this.settings.difficulty] || C.DIFFICULTY.regular;

		bot.peekCooldown = Math.max(0, bot.peekCooldown - dt);
		bot.strafeTimer -= dt;
		if (bot.strafeTimer <= 0) {
			bot.strafeTimer = C.rand(0.75, 1.9);
			if (Math.random() < 0.42) bot.strafe *= -1;
		}

		/* reload lifecycle */
		if (bot.reloading && now >= bot.reloadEnd) this.finishBotReload(bot);
		if (!bot.reloading && bot.ammo <= 0) this.startBotReload(bot, px, py, pz);

		/* reaction / sight acquisition */
		if (!bot.reloading && los) {
			if (!bot.reactionDone) {
				bot.reaction += dt;
				if (bot.reaction >= bot.type.reaction * diff.reaction) bot.reactionDone = true;
			}
		} else if (!los) {
			bot.reactionDone = false;
			bot.reaction = Math.max(0, bot.reaction - dt * 1.4);
		}

		var moveX = 0, moveZ = 0;
		var behavior = bot.reloading ? 'reload' : bot.behavior;
		var canFire = false;
		var faceTarget = null;

		if (behavior === 'reload' || behavior === 'peekIn') {
			bot.state = behavior === 'reload' ? 'reload' : 'peek';
			var wp = this.nextTacticalWaypoint(bot);
			if (wp) {
				var wdx = wp.x - bot.x, wdz = wp.z - bot.z;
				var wd = Math.hypot(wdx, wdz);
				if (wd > 0.65) {
					moveX = wdx / wd * bot.speed * 0.84;
					moveZ = wdz / wd * bot.speed * 0.84;
				}
			}
			faceTarget = { x: px, z: pz };
			if (behavior === 'peekIn' && ((wp && Math.hypot(wp.x - bot.x, wp.z - bot.z) < 0.7) || now >= bot.behaviorUntil)) {
				bot.behavior = 'hunt';
				bot.behaviorSince = now;
				bot.behaviorUntil = 0;
				bot.tacTarget = null;
				bot.tacPath = null;
				bot.reactionDone = false;
			}
		} else if (behavior === 'peekOut') {
			bot.state = 'peek';
			faceTarget = { x: px, z: pz };
			if (!bot.peeking) {
				var pwp = this.nextTacticalWaypoint(bot);
				if (pwp) {
					var pdx = pwp.x - bot.x, pdz = pwp.z - bot.z;
					var pd = Math.hypot(pdx, pdz);
					if (pd > 0.65) {
						moveX = pdx / pd * bot.speed * 0.95;
						moveZ = pdz / pd * bot.speed * 0.95;
					}
				}
				var nearPeek = bot.peekPoint && Math.hypot(bot.peekPoint.x - bot.x, bot.peekPoint.z - bot.z) < 0.7;
				if (nearPeek || (los && now - bot.behaviorSince > 1350)) {
					bot.peeking = true;
				}
			}
			if (bot.peeking) {
				moveX = 0; moveZ = 0;
				if (los && bot.reactionDone && now >= bot.nextShot) canFire = true;
			}
			if (now >= bot.behaviorUntil) this.beginPeekRetreat(bot);
		} else {
			var attacking = los && dist < 42;
			bot.state = attacking ? 'attack' : 'hunt';
			if (attacking) {
				var prefMin = bot.type.preferMin, prefMax = bot.type.preferMax;
				var approach = 0;
				if (dist > prefMax) approach = 1;
				else if (dist < prefMin) approach = -1;
				var nx = dx / dist, nz = dz / dist;
				var sx = -nz * bot.strafe, sz = nx * bot.strafe;
				var strafeSpeed = bot.speed * (0.62 + (bot.type.id === 'scout' ? 0.12 : 0));
				moveX = sx * strafeSpeed * 0.8 + nx * approach * bot.speed;
				moveZ = sz * strafeSpeed * 0.8 + nz * approach * bot.speed;
				if (dist < 2.6) { moveX -= nx * bot.speed * 1.2; moveZ -= nz * bot.speed * 1.2; }
				faceTarget = { x: px, z: pz };
				if (bot.reactionDone && now >= bot.nextShot) canFire = true;
			} else if (dist < 38 && bot.peekCooldown <= 0 && this.tryBotPeek(bot, px, py, pz)) {
				/* behavior switched to peekOut this frame; movement starts next tick */
			} else {
				if (bot.pathTimer <= 0 || !bot.path || bot.pathIndex >= bot.path.length) {
					bot.pathTimer = C.rand(0.55, 1.15);
					var tx = px + C.rand(-2.5, 2.5);
					var tz = pz + C.rand(-2.5, 2.5);
					bot.path = C.findPath(this.nav, bot.x, bot.z, tx, tz);
					bot.pathIndex = 0;
				}
				if (bot.path && bot.path.length) {
					while (bot.pathIndex < bot.path.length) {
						var chaseWp = bot.path[bot.pathIndex];
						if (Math.hypot(chaseWp.x - bot.x, chaseWp.z - bot.z) < 0.62) bot.pathIndex++;
						else break;
					}
					if (bot.pathIndex < bot.path.length) {
						var cwp = bot.path[bot.pathIndex];
						var cdx = cwp.x - bot.x, cdz = cwp.z - bot.z;
						var cd = Math.hypot(cdx, cdz) || 1;
						moveX = cdx / cd * bot.speed;
						moveZ = cdz / cd * bot.speed;
					}
				} else {
					moveX = dx / dist * bot.speed;
					moveZ = dz / dist * bot.speed;
				}
			}
		}

		if (canFire) {
			moveX = 0;
			moveZ = 0;
		}
		if (now < bot.stationaryUntil) {
			moveX = 0;
			moveZ = 0;
		}

		/* separation */
		if (!canFire) {
			for (var i = 0; i < this.bots.length; i++) {
				var o = this.bots[i];
				if (o === bot || !o.alive || o.dead) continue;
				var ox = bot.x - o.x, oz = bot.z - o.z;
				var od = Math.hypot(ox, oz);
				if (od > 0.001 && od < 1.5) {
					moveX += ox / od * (1.5 - od) * 2.2;
					moveZ += oz / od * (1.5 - od) * 2.2;
				}
			}
		}

		var speed = Math.hypot(moveX, moveZ);
		if (speed > 0.001) {
			var stepX = moveX * dt;
			var stepZ = moveZ * dt;
			var oldX = bot.x, oldZ = bot.z;
			if (!this.collidesBot(bot.x + stepX, bot.z, 0.4)) bot.x += stepX;
			if (!this.collidesBot(bot.x, bot.z + stepZ, 0.4)) bot.z += stepZ;
			var moved = Math.hypot(bot.x - oldX, bot.z - oldZ);
			if (moved < 0.001) bot.stuck += dt; else bot.stuck = Math.max(0, bot.stuck - dt * 2);
			if (bot.stuck > 0.7) {
				bot.stuck = 0;
				bot.pathTimer = 0;
				bot.x += Math.cos(now * 0.001 + bot.walkPhase) * 0.25;
				bot.z += Math.sin(now * 0.001 + bot.walkPhase) * 0.25;
			}
		}

		/* facing */
		var targetYaw;
		if (faceTarget) targetYaw = Math.atan2(px - bot.x, pz - bot.z);
		else if (speed > 0.2) targetYaw = Math.atan2(moveX, moveZ);
		else targetYaw = bot.yaw;
		bot.yaw = dampAngle(bot.yaw, targetYaw, 9, dt);
		root.rotation.y = bot.yaw;
		var gunBase = -0.04;
		var aimPitch = bot.reloading ? 0 : -Math.atan2(py - (1.32 * bot.baseScale + 0.2), Math.max(0.5, dist));
		bot.robot.gun.rotation.x = C.damp(bot.robot.gun.rotation.x, gunBase + aimPitch * 0.7, 8, dt);
		root.position.set(bot.x, 0, bot.z);

		/* walk animation */
		var walkSpeed = speed / Math.max(0.1, bot.speed);
		bot.walkPhase += dt * (4 + speed * 1.4);
		var swing = Math.sin(bot.walkPhase) * 0.6 * Math.min(1, walkSpeed);
		bot.robot.legL.rotation.x = swing;
		bot.robot.legR.rotation.x = -swing;
		bot.robot.armL.rotation.x = -0.8 + swing * 0.2;
		bot.robot.armR.rotation.x = -0.55 - swing * 0.12;
		bot.robot.torso.position.y = 1.28 + Math.abs(Math.sin(bot.walkPhase)) * 0.012 * Math.min(1, walkSpeed);
		bot.footTimer -= dt;
		if (speed > 0.5 && bot.footTimer <= 0) {
			bot.footTimer = 0.42;
			var fd = Math.hypot(bot.x - p.x, bot.z - p.z);
			if (fd < 26) this.sound.burst({ dur: 0.05, type: 'lowpass', freq: 300, gain: 0.035 * (1 - fd / 30), pan: this.panFor(bot.x, bot.z) });
		}

		if (canFire) this.botShoot(bot, dist, diff);
		if (bot.flash && bot.flash.visible && now > bot.flashUntil) bot.flash.visible = false;
	};

	RangeGame.prototype.animateBotIdle = function (bot, dt) {
		bot.walkPhase += dt * 1.2;
		bot.robot.legL.rotation.x = C.damp(bot.robot.legL.rotation.x, 0, 4, dt);
		bot.robot.legR.rotation.x = C.damp(bot.robot.legR.rotation.x, 0, 4, dt);
		bot.robot.torso.position.y = 1.28 + Math.sin(bot.walkPhase) * 0.008;
	};

	RangeGame.prototype.botLineOfSight = function (bot, px, py, pz) {
		return this.pointHasLos(bot.x, 1.5 * bot.baseScale, bot.z, px, py, pz);
	};

	RangeGame.prototype.panFor = function (x, z) {
		var right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
		var dir = new THREE.Vector3(x - this.player.x, 0, z - this.player.z);
		if (dir.lengthSq() < 0.001) return 0;
		dir.normalize();
		return clamp(dir.dot(right), -1, 1) * 0.65;
	};

	RangeGame.prototype.botShoot = function (bot, dist, diff) {
		if (!this.player.alive || bot.reloading || bot.ammo <= 0) return;
		var now = this.now;
		var p = this.player;
		var def = bot.weaponDef || C.WEAPONS.ak47;
		bot.ammo--;
		var baseGap = bot.type.fireRate;
		if (def.category === 'SMG') baseGap *= 0.62;
		else if (def.category === 'SHOTGUN') baseGap *= 1.08;
		else if (def.category === 'SNIPER') baseGap *= 1.3;
		bot.nextShot = now + baseGap * diff.fire * C.rand(0.88, 1.18) * 1000;
		bot.reaction = 0;
		bot.reactionDone = false;
		bot.stationaryUntil = now + 360;

		var origin = this.tmpB.set(bot.x, 1.42 * bot.baseScale, bot.z);
		var target = new THREE.Vector3(p.x, p.feetY + p.eye - C.rand(0.18, 0.5), p.z);
		var dir = new THREE.Vector3().subVectors(target, origin).normalize();
		var tracerEnd = target.clone();

		/* deliberate miss roll: lower difficulty -> wider, more frequent misses */
		var missChance = diff.missChance != null ? diff.missChance : 0.22;
		if (p.speed > 2.2) missChance *= 1.12;
		if (dist > 34) missChance *= 1.12;
		var deliberateMiss = Math.random() < missChance;

		var chance = bot.accuracy * diff.accuracy;
		chance *= clamp(1.18 - dist / 48, 0.25, 1);
		if (p.speed > 2.2) chance *= 0.82;
		if (this.keys.ctrl || this.input.touchCrouch) chance *= 0.88;
		chance = clamp(chance, 0.05, 0.92);

		var hit = !deliberateMiss && Math.random() < chance;
		if (hit) {
			var dmg = bot.damage * diff.damage * C.rand(0.82, 1.18);
			if (Math.random() < 0.07) dmg *= 1.7;
			this.applyPlayerDamage(dmg, bot);
		} else {
			var side = new THREE.Vector3(-dir.z, 0, dir.x);
			if (side.lengthSq() < 0.01) side.set(1, 0, 0);
			side.normalize();
			var spread = deliberateMiss ? C.rand(1.4, 4.4) : C.rand(0.8, 2.4);
			var sign = Math.random() < 0.5 ? -1 : 1;
			var lift = deliberateMiss ? C.rand(-1.4, 2.1) : C.rand(-0.8, 1.2);
			tracerEnd.copy(target).addScaledVector(side, spread * sign);
			tracerEnd.y += lift;
		}

		if (bot.flash) {
			bot.muzzle.updateWorldMatrix(true, false);
			bot.flash.visible = true;
			bot.flashUntil = now + 45;
			bot.flash.material.rotation = Math.random() * Math.PI * 2;
		}
		this.spawnTracer(origin.clone(), tracerEnd, 0xff9a50, 0.09);
		this.sound.shot(def.sound || 'rifle', this.panFor(bot.x, bot.z), dist);
		if (hit) this.spawnSparks(this.camera.position.clone(), 0xff6a4a, 5, 1.8);
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

	RangeGame.prototype.applyPlayerDamage = function (amount, fromBot) {
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
		if (p.health <= 0) {
			p.health = 0;
			p.alive = false;
			p.deathT = 0;
			p.deathRoll = 0;
			this.match.deaths++;
			this.playerDiedLastRound = true;
			this.deathTimer = 1.8;
			this.announce('YOU WERE KILLED', 'THE SQUAD IS STILL ACTIVE');
			if (fromBot) {
				fromBot.kills++;
				this.addKillFeed(fromBot.name + ' [' + fromBot.type.label + ']', 'YOU', 'RIFLE', false, false);
			}
			this.input.fire = false;
			this.semiQueued = false;
			this.reloading = false;
			this.scoped = false;
			this.updateVitalsHUD();
		}
	};

	RangeGame.prototype.damageBot = function (bot, amount, headshot, weaponName) {
		if (!bot || !bot.alive) return;
		bot.hp -= amount;
		bot.robot.hp = Math.max(0, bot.hp);
		bot.robot.maxHp = bot.maxHp;
		bot.hitFlash = 0.08;
		C.drawHealthSprite(bot.robot);
		bot.robot.healthSprite.visible = bot.hp > 0;
		if (bot.hp <= 0) {
			this.killBot(bot, headshot, weaponName);
		} else {
			/* small flinch */
			bot.root.position.x += C.rand(-0.04, 0.04);
			bot.root.position.z += C.rand(-0.04, 0.04);
		}
	};

	RangeGame.prototype.killBot = function (bot, headshot, weaponName) {
		if (!bot || bot.dead) return;
		bot.dead = true;
		bot.alive = false;
		bot.hp = 0;
		bot.deaths = 1;
		bot.headshotDeath = !!headshot;
		bot.robot.healthSprite.visible = false;
		if (headshot && bot.robot.head) {
			bot.robot.head.visible = false;
			this.spawnRobotHead(bot);
		}
		this.dropBotWeapon(bot);
		this.match.kills++;
		this.roundStats.kills++;
		if (headshot) { this.match.hs++; this.roundStats.hs++; }
		var reward = 300 + (headshot ? 100 : 0);
		this.match.money = clamp(this.match.money + reward, 0, 16000);
		this.addKillFeed('YOU', bot.name, weaponName, headshot, true);
		this.sound.explode();
		this.spawnSparks(new THREE.Vector3(bot.x, 1.3, bot.z), headshot ? 0xffd66a : 0xff8b52, 20, 4.4);
		this.updateHostiles();
		this.updateVitalsHUD();
		if (this.round.phase === 'live') {
			var alive = 0;
			for (var i = 0; i < this.bots.length; i++) if (this.bots[i].alive) alive++;
			if (alive === 0) this.endRound(true, 'All hostiles eliminated.');
		}
	};

	RangeGame.prototype.dropBotWeapon = function (bot) {
		var def = C.WEAPONS[bot.weaponId];
		if (!def || !C.buildWeaponPickup) return;
		var ammo = {
			mag: Math.max(1, Math.round(def.mag * C.rand(0.45, 0.9))),
			reserve: C.randi(0, def.reserve)
		};
		var pickup = C.buildWeaponPickup(bot.weaponId, def, ammo);
		pickup.group.position.set(bot.x, 0.02, bot.z);
		this.scene.add(pickup.group);
		var drop = {
			id: ++this.dropSeq,
			group: pickup.group,
			body: pickup.body,
			ring: pickup.ring,
			label: pickup.label,
			labelTex: pickup.labelTex,
			materials: pickup.materials,
			weaponId: bot.weaponId,
			def: def,
			ammo: ammo,
			x: bot.x,
			z: bot.z,
			life: 35,
			phase: C.rand(0, 6.28)
		};
		this.drops.push(drop);
		this.spawnSparks(new THREE.Vector3(bot.x, 0.55, bot.z), 0xffd58a, 7, 2.2);
		return drop;
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
				? 'TAP TO PICK UP'
				: 'PRESS <kbd>E</kbd> TO PICK UP';
		}
	};

	RangeGame.prototype.pickupNearest = function () {
		var drop = this.nearestDrop;
		if (!drop) return;
		var def = drop.def;
		if (!def || (def.slot !== 'primary' && def.slot !== 'secondary')) return;
		var slot = def.slot;
		if (this.loadout[slot] === drop.weaponId) {
			var ammo = this.ammo[drop.weaponId];
			if (!ammo) ammo = this.ammo[drop.weaponId] = { mag: 0, reserve: 0 };
			ammo.mag = Math.min(def.mag, ammo.mag + drop.ammo.mag);
			ammo.reserve = Math.min(def.reserve * 2, ammo.reserve + drop.ammo.reserve);
			this.toast('Picked up ' + def.name + ' ammo.');
		} else {
			this.loadout[slot] = drop.weaponId;
			this.ammo[drop.weaponId] = { mag: drop.ammo.mag, reserve: drop.ammo.reserve };
			this.equipWeapon(drop.weaponId, true);
			this.toast('Picked up ' + def.name + '.');
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
		if (this.el.roundNo) text(this.el.roundNo, this.match ? this.match.round : 1);
		if (this.match) {
			text(this.el.health, Math.max(0, Math.round(this.player.health)));
			text(this.el.armor, Math.max(0, Math.round(this.player.armor)));
			text(this.el.money, Math.max(0, Math.round(this.match.money)));
			var hp = this.el.health && this.el.health.parentNode;
			if (hp) hp.classList.toggle('is-low', this.player.health <= 25);
			var bar = this.el.healthbar ? this.el.healthbar.querySelector('em') : null;
			if (bar) bar.style.width = clamp(this.player.health, 0, 100) + '%';
		}
		this.updateRoundTimer();
		this.updateBuyHint();
		this.updatePickupPrompt();
	};

	RangeGame.prototype.updateVitalsHUD = function () {
		text(this.el.health, Math.max(0, Math.round(this.player.health)));
		text(this.el.armor, Math.max(0, Math.round(this.player.armor)));
		if (this.match) text(this.el.money, Math.max(0, Math.round(this.match.money)));
		var bar = this.el.healthbar ? this.el.healthbar.querySelector('em') : null;
		if (bar) bar.style.width = clamp(this.player.health, 0, 100) + '%';
		var hp = this.el.health && this.el.health.parentNode;
		if (hp) hp.classList.toggle('is-low', this.player.health <= 25);
	};

	RangeGame.prototype.updateAmmoHUD = function () {
		var def = this.weaponDef(this.currentWeapon);
		var ammo = this.ammo[this.currentWeapon];
		text(this.el.weapon, def.name);
		text(this.el.slot, def.category || def.slot);
		if (def.slot === 'melee') {
			text(this.el.ammo, '—');
			text(this.el.reserve, '—');
		} else {
			text(this.el.ammo, ammo ? ammo.mag : def.mag);
			text(this.el.reserve, ammo ? ammo.reserve : def.reserve);
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

	RangeGame.prototype.showHitmarker = function (headshot) {
		if (!this.el.hitmarker) return;
		this.el.hitmarker.classList.remove('is-on', 'is-head');
		void this.el.hitmarker.offsetWidth;
		this.el.hitmarker.classList.add('is-on');
		if (headshot) this.el.hitmarker.classList.add('is-head');
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
		this.el.toast.textContent = message;
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
		if (this.round.phase !== 'freeze') {
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

	RangeGame.prototype.renderBuy = function () {
		if (!this.el.buyGrid) return;
		var money = this.match ? this.match.money : 0;
		text(this.el.buyMoney, fmtMoney(money));
		var html = '';
		for (var i = 0; i < C.BUY_ITEMS.length; i++) {
			var item = C.BUY_ITEMS[i];
			var def = item.kind === 'weapon' ? C.WEAPONS[item.id] : null;
			var name = def ? def.name : item.name;
			var cat = def ? def.category : item.category;
			var price = item.price;
			var owned = false;
			if (item.kind === 'armor') owned = this.player.armor >= 100;
			else if (def.slot === 'primary') owned = this.loadout.primary === item.id;
			else owned = this.loadout.secondary === item.id;
			var can = money >= price && !owned;
			var icon = C.weaponIcon(def ? def.icon : 'armor');
			var stats = def
				? '<span>DMG <b>' + def.damage + (def.pellets ? '×' + def.pellets : '') + '</b></span><span>RPM <b>' + def.rpm + '</b></span><span>MAG <b>' + def.mag + '</b></span>'
				: '<span>ARMOR <b>+100</b></span><span>HEAD <b>PROTECTED</b></span>';
			html += '<button type="button" class="csr-buyitem' + (owned ? ' is-owned' : '') + (!can && !owned ? ' is-locked' : '') + '" data-buy-id="' + item.id + '">' +
				'<div class="csr-buyitem__top"><div><span class="csr-buyitem__key">' + (item.key ? item.key : '·') + '</span>' +
				'<p class="csr-buyitem__name">' + escapeHTML(name) + '</p>' +
				'<p class="csr-buyitem__cat">' + escapeHTML(cat) + '</p></div>' +
				(owned ? '<span class="csr-buyitem__owned">OWNED</span>' : '<span class="csr-buyitem__price' + (money < price ? ' is-short' : '') + '">' + fmtMoney(price) + '</span>') +
				'</div>' +
				'<div class="csr-buyitem__stat">' + stats + '</div>' +
				'<span class="csr-buyitem__buy">' + (owned ? 'EQUIPPED' : money >= price ? 'BUY  [ ' + item.key + ' ]' : 'NOT ENOUGH CASH') + '</span>' +
				'<div class="csr-buyitem__icon' + (def && (def.icon === 'pistol' || def.icon === 'knife') ? ' is-pistol' : '') + '">' + icon + '</div>' +
				'</button>';
		}
		this.el.buyGrid.innerHTML = html;
	};

	RangeGame.prototype.buyItem = function (id) {
		if (!this.buyOpen || !this.match) return;
		var item = null;
		for (var i = 0; i < C.BUY_ITEMS.length; i++) if (C.BUY_ITEMS[i].id === id) item = C.BUY_ITEMS[i];
		if (!item) return;
		if (this.match.money < item.price) { this.toast('Not enough cash.'); return; }
		if (item.kind === 'armor') {
			if (this.player.armor >= 100) { this.toast('Armour is already full.'); return; }
			this.player.armor = 100;
			this.match.money -= item.price;
			this.sound.buy();
			this.toast('Kevlar + helmet equipped.');
		} else {
			var def = C.WEAPONS[item.id];
			if (!def) return;
			if (def.slot === 'primary' && this.loadout.primary === item.id) { this.toast('Already equipped.'); return; }
			if (def.slot === 'secondary' && this.loadout.secondary === item.id) { this.toast('Already equipped.'); return; }
			this.match.money -= item.price;
			if (def.slot === 'primary') this.loadout.primary = item.id;
			else this.loadout.secondary = item.id;
			this.ammo[item.id] = { mag: def.mag, reserve: def.reserve };
			this.sound.buy();
			this.equipWeapon(item.id, true);
			this.toast(def.name + ' acquired.');
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
		var ct = '<div class="csr-board__row is-player' + (this.player.alive ? '' : ' is-dead') + '">' +
			'<span>PLAYER</span><span>' + this.match.kills + '</span><span>' + this.match.deaths + '</span><span>' + this.match.hs + '</span><span>LOCAL</span></div>';
		this.el.boardCtRows.innerHTML = ct;
		var html = '';
		for (var i = 0; i < this.bots.length; i++) {
			var b = this.bots[i];
			html += '<div class="csr-board__row' + (b.alive ? '' : ' is-dead') + '">' +
				'<span>' + escapeHTML(b.name) + ' <small style="opacity:.5">' + b.type.label + '</small></span>' +
				'<span>' + b.kills + '</span><span>' + b.deaths + '</span><span>0</span><span>' + b.ping + '</span></div>';
		}
		this.el.boardTRows.innerHTML = html;
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
	RangeGame.prototype.onKeyDown = function (ev) {
		var k = ev.key;
		var code = k.toLowerCase();
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
				for (var bi = 0; bi < C.BUY_ITEMS.length; bi++) if (C.BUY_ITEMS[bi].key === n) item = C.BUY_ITEMS[bi];
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
				if (!ev.repeat) this.pickupNearest();
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
		if (!this.scoped && this.currentWeapon) {
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
			bots: this.bots.map(function (b) { return { name: b.name, type: b.type.id, weapon: b.weaponId, hp: Math.round(b.hp), maxHp: b.maxHp, alive: b.alive, ammo: b.ammo, reloading: b.reloading, behavior: b.behavior, peeking: b.peeking, x: +b.x.toFixed(2), z: +b.z.toFixed(2) }; }),
			weapon: this.currentWeapon,
			ammo: this.ammo[this.currentWeapon],
			money: this.match ? this.match.money : 0,
			drops: this.drops.map(function (d) { return { weapon: d.weaponId, x: +d.x.toFixed(2), z: +d.z.toFixed(2), mag: d.ammo.mag, reserve: d.ammo.reserve, life: +d.life.toFixed(1) }; }),
			locked: this.locked,
			player: { x: +this.player.x.toFixed(2), z: +this.player.z.toFixed(2), yaw: +this.player.yaw.toFixed(2) }
		};
	};

	RangeGame.prototype.debugStart = function () {
		this.startMatch();
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
		for (var i = 0; i < this.bots.length; i++) if (this.bots[i].alive) this.killBot(this.bots[i], false, 'DEBUG');
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
			teleport: function (x, z, yaw) { return current ? current.debugTeleport(x, z, yaw) : null; },
			lookAt: function (x, z) { return current ? current.debugLookAt(x, z) : null; },
			killAll: function () { return current ? current.debugKillAll() : null; },
			shoot: function () { return current ? current.debugShoot() : null; },
			endRound: function (win) { return current ? current.debugEndRound(win) : null; }
		}
	};
})(window);
