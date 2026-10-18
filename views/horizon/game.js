/**
 * views/horizon/game.js — HAYNEKO HORIZON: NAGISA COAST
 *
 * Mounts the world, drives the car, paints the HUD, runs the races and never
 * asks the network for anything after the scripts arrive.
 */
(function (global) {
	'use strict';

	var THREE = global.THREE;
	var HZ = global.HZ;
	var HZI18n = global.HZI18n;
	var ROUTE = 'horizon';
	var doc = global.document;

	function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
	function lerp(a, b, t) { return a + (b - a) * t; }
	function damp(a, b, l, dt) { return lerp(a, b, 1 - Math.exp(-l * dt)); }
	function angleDiff(a, b) {
		var d = (b - a + Math.PI * 3) % (Math.PI * 2) - Math.PI;
		return d;
	}
	function frame() { return new Promise(function (res) { global.requestAnimationFrame(function () { res(); }); }); }
	function delay(ms) { return new Promise(function (res) { global.setTimeout(res, ms); }); }
	function q(root, sel) { return root.querySelector(sel); }
	function qa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

	/* ======================================================================
	   particles
	   ====================================================================== */
	function SmokeSystem(scene) {
		var MAX = 260;
		var geo = new THREE.BufferGeometry();
		var positions = new Float32Array(MAX * 3);
		var sizes = new Float32Array(MAX);
		var alphas = new Float32Array(MAX);
		for (var i = 0; i < MAX; i++) { positions[i * 3 + 1] = -1000; }
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
		var mat = new THREE.ShaderMaterial({
			uniforms: { uTex: { value: HZ.textures.smoke() } },
			vertexShader: [
				'attribute float aSize; attribute float aAlpha; varying float vAlpha;',
				'void main(){ vAlpha = aAlpha;',
				'  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
				'  gl_PointSize = aSize * (340.0 / max(-mv.z, 1.0));',
				'  gl_Position = projectionMatrix * mv; }'
			].join('\n'),
			fragmentShader: [
				'uniform sampler2D uTex; varying float vAlpha;',
				'void main(){ vec4 t = texture2D(uTex, gl_PointCoord);',
				'  if (t.a * vAlpha < 0.01) discard;',
				'  gl_FragColor = vec4(0.86, 0.84, 0.80, t.a * vAlpha); }'
			].join('\n'),
			transparent: true, depthWrite: false, depthTest: true
		});
		var points = new THREE.Points(geo, mat);
		points.frustumCulled = false;
		scene.add(points);
		var parts = [];
		for (var p = 0; p < MAX; p++) parts.push({ life: 0, max: 1, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, size: 1 });
		var head = 0;
		this.spawn = function (x, y, z, vx, vy, vz, size, life) {
			var part = parts[head];
			head = (head + 1) % MAX;
			part.x = x; part.y = y; part.z = z;
			part.vx = vx; part.vy = vy; part.vz = vz;
			part.size = size; part.life = life; part.max = life;
		};
		this.update = function (dt) {
			for (var j = 0; j < MAX; j++) {
				var part = parts[j];
				if (part.life > 0) {
					part.life -= dt;
					part.x += part.vx * dt; part.y += part.vy * dt; part.z += part.vz * dt;
					part.vy += 0.55 * dt;
					part.size += dt * 0.9;
					var k = Math.max(0, part.life / part.max);
					alphas[j] = 0.46 * Math.min(1, k * 2.1) * Math.min(1, (1 - k) * 4 + 0.25);
					sizes[j] = part.size;
					positions[j * 3] = part.x; positions[j * 3 + 1] = part.y; positions[j * 3 + 2] = part.z;
				} else {
					alphas[j] = 0;
					sizes[j] = 0;
					positions[j * 3 + 1] = -1000;
				}
			}
			geo.attributes.position.needsUpdate = true;
			geo.attributes.aSize.needsUpdate = true;
			geo.attributes.aAlpha.needsUpdate = true;
		};
		this.clear = function () {
			for (var j = 0; j < MAX; j++) { parts[j].life = 0; alphas[j] = 0; sizes[j] = 0; positions[j * 3 + 1] = -1000; }
			geo.attributes.aAlpha.needsUpdate = true; geo.attributes.position.needsUpdate = true;
		};
	}

	function SkidSystem(scene) {
		var MAX = 520;
		var positions = new Float32Array(MAX * 18);
		var geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
		var mat = new THREE.MeshBasicMaterial({
			color: 0x101012, transparent: true, opacity: 0.4, depthWrite: false,
			polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
		});
		var mesh = new THREE.Mesh(geo, mat);
		mesh.frustumCulled = false;
		mesh.renderOrder = 1;
		scene.add(mesh);
		var head = 0;
		this.add = function (x1, z1, x2, z2, y, width) {
			var dx = x2 - x1, dz = z2 - z1;
			var len = Math.hypot(dx, dz) || 1;
			var nx = -dz / len * width, nz = dx / len * width;
			var i = head * 18;
			head = (head + 1) % MAX;
			var v = [
				x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz, x2 + nx, y, z2 + nz,
				x2 + nx, y, z2 + nz, x1 - nx, y, z1 - nz, x2 - nx, y, z2 - nz
			];
			for (var k = 0; k < 18; k++) positions[i + k] = v[k];
			geo.attributes.position.needsUpdate = true;
		};
		this.clear = function () {
			for (var k = 0; k < positions.length; k++) positions[k] = 0;
			geo.attributes.position.needsUpdate = true;
		};
	}

	/* ======================================================================
	   the game
	   ====================================================================== */
	function HorizonGame(host) {
		this.host = host;
		this.state = 'boot';
		this.paused = false;
		this.helpOpen = false;
		this.started = false;
		this.menuFromPause = false;
		this.suspendState = null;
		this.resumeSnapshot = null;
		this.pausedAt = 0;
		this.raf = 0;
		this.lastTime = 0;
		this.time = 0;
		this.fps = 60;
		this.frameAcc = 0;
		this.frameCount = 0;
		this.frameNo = 0;
		this.bankedThisEvent = 0;
		this.airAwardCooldown = 0;

		this.keys = Object.create(null);
		this.touch = { steer: 0, throttle: false, brake: false, hand: false };
		this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
		this.gamepadConnected = false;

		var hadSave = false;
		try { hadSave = !!global.localStorage.getItem('hayneko.horizon.save.v1'); } catch (e) { /* ignore */ }
		this.save = HZ.loadSave();
		if (!hadSave && global.matchMedia && global.matchMedia('(pointer: coarse)').matches) this.save.settings.quality = 'low';
		this.settings = this.save.settings;
		this.audio = HZ.Audio.create();
		this.muted = false;
		this.music = this.settings.music !== false;
		this.trackIndex = 0;
		this.trackTimer = 32;

		this.skill = { live: 0, chain: 0, mult: 1, idle: 0, hold: 0, total: this.save.skill || 0, inDrift: false, score: 0 };
		this.smokeAccum = 0;
		this.skidAccum = 0;
		this.trapCooldown = {};
		this.zoneCooldown = 0;
		this.waterTime = 0;
		this.shake = 0;
		this.promptEvent = null;
		this.hintTime = 0;
		this.lastHud = 0;
		this.lastMap = 0;
		this.camPos = new THREE.Vector3();
		this.camLook = new THREE.Vector3();
		this.camOrbit = -1.2;
		this.camMode = parseInt(this.settings.camera, 10) || 0;
		this.touchMode = false;

		this.vehicle = {
			x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, vy: 0, steer: 0, gear: 0,
			rpm: 900, vLong: 0, vLat: 0, drift: 0, pitch: 0, roll: 0,
			onRoad: true, offroad: false, speed: 0, wheelSpin: 0, shiftTimer: 0,
			throttle: 0, brake: 0, airborne: false, airTime: 0, groundY: 0,
			lastRampInfo: null, prevGroundY: null
		};
		this.events = [];
		this.race = null;
		this.rivals = [];
		this.traffic = [];
		this.lastError = null;
		this._handlers = [];
	}

	HorizonGame.prototype.$ = function (sel) { return this.host.querySelector(sel); };
	HorizonGame.prototype.hide = function (el) { if (el) el.hidden = true; };
	HorizonGame.prototype.show = function (el) { if (el) el.hidden = false; };

	HorizonGame.prototype.init = async function () {
		var self = this;
		try {
			HZI18n.init(this.settings.lang || null);
			this.settings.lang = HZI18n.getLocale();
			HZI18n.apply(this.host);
			this.cacheDom();
			this.syncAllUi();

			this.renderer = new THREE.WebGLRenderer({
				canvas: this.el.canvas, antialias: true, powerPreference: 'high-performance'
			});
			this.renderer.setPixelRatio(this.pixelRatio(this.settings.quality));
			this.renderer.setSize(global.innerWidth, global.innerHeight, false);
			this.renderer.outputColorSpace = THREE.SRGBColorSpace;
			this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
			this.renderer.toneMappingExposure = 1.02;
			this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
			this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

			this.scene = new THREE.Scene();
			this.camera = new THREE.PerspectiveCamera(58, global.innerWidth / Math.max(1, global.innerHeight), 0.2, 12000);
			this.camera.position.set(0, 6, -12);

			this.setLoading(10, 'CARVING THE COASTLINE');
			await frame();
			await delay(40);
			this.world = HZ.World.build(this.scene, { quality: this.settings.quality, renderer: this.renderer });

			this.setLoading(52, 'PAVING THE COAST ROAD');
			await frame();
			this.buildEvents();
			this.buildRaceFurniture();
			this.buildTraffic();
			this.buildRivals();
			this.buildParticles();
			this.buildPlayerCar();

			this.setLoading(80, 'MOUNTING THE KOUGEKI');
			await frame();
			this.bindUI();
			this.bindInput();
			this.buildTicks();
			this.applySettings(false);
			this.placeAtSpawn();
			this.applyCameraImmediate();

			this.setLoading(100, 'WELCOME TO NAGISA');
			await delay(420);
			this.hideLoading();
			this.showMenu({ boot: true });
			this.startLoop();
			global.HZGlobal = this;
		} catch (err) {
			this.lastError = String(err && err.stack || err);
			console.error('[horizon] init failed', err);
			this.setLoading(0, 'FAILED TO BUILD THE COAST');
			var hint = this.$('[data-hz-loading-hint]');
			if (hint) hint.textContent = 'WEBGL / WORLD ERROR — SEE CONSOLE';
		}
	};

	HorizonGame.prototype.cacheDom = function () {
		var h = this.host;
		this.el = {
			canvas: q(h, '[data-hz-canvas]'),
			loading: q(h, '[data-hz-loading]'),
			loadingBar: q(h, '[data-hz-loading-bar]'),
			loadingHint: q(h, '[data-hz-loading-hint]'),
			menu: q(h, '[data-hz-menu]'),
			hud: q(h, '[data-hz-hud]'),
			pause: q(h, '[data-hz-pause]'),
			results: q(h, '[data-hz-results]'),
			help: q(h, '[data-hz-help]'),
			fade: q(h, '[data-hz-fade]'),
			flash: q(h, '[data-hz-flash]'),
			speedfx: q(h, '[data-hz-speedfx]'),
			speed: q(h, '[data-hz-speed]'),
			units: q(h, '[data-hz-units]'),
			gear: q(h, '[data-hz-gear]'),
			needle: q(h, '[data-hz-needle]'),
			arc: q(h, '[data-hz-speed-arc]'),
			rpm: q(h, '[data-hz-rpm-fill]'),
			rpmLabel: q(h, '[data-hz-rpm-label]'),
			ticks: q(h, '[data-hz-ticks]'),
			skillMult: q(h, '[data-hz-skill-mult]'),
			skillPoints: q(h, '[data-hz-skill-points]'),
			skillBar: q(h, '[data-hz-skill-bar]'),
			skillBank: q(h, '[data-hz-skill-bank]'),
			race: q(h, '[data-hz-race]'),
			racePos: q(h, '[data-hz-race-pos]'),
			raceTime: q(h, '[data-hz-race-time]'),
			raceCp: q(h, '[data-hz-race-cp]'),
			raceBar: q(h, '[data-hz-race-bar]'),
			raceName: q(h, '[data-hz-race-name]'),
			message: q(h, '[data-hz-message]'),
			toasts: q(h, '[data-hz-toasts]'),
			countdown: q(h, '[data-hz-countdown]'),
			prompt: q(h, '[data-hz-prompt]'),
			promptText: q(h, '[data-hz-prompt-text]'),
			zone: q(h, '[data-hz-zone]'),
			zoneLabel: q(h, '[data-hz-zone-label]'),
			zoneScore: q(h, '[data-hz-zone-score]'),
			minimap: q(h, '[data-hz-minimap]'),
			radio: q(h, '[data-hz-radio]'),
			radioTrack: q(h, '[data-hz-radio-track]'),
			hint: q(h, '[data-hz-hint]'),
			eventList: q(h, '[data-hz-event-list]'),
			eventCount: q(h, '[data-hz-event-count]'),
			paint: q(h, '[data-hz-paint]'),
			quality: q(h, '[data-hz-quality]'),
			cameraSeg: q(h, '[data-hz-camera]'),
			unitsSeg: q(h, '[data-hz-units-seg]'),
			volume: q(h, '[data-hz-volume]'),
			volumeValue: q(h, '[data-hz-volume-value]'),
			musicBtn: q(h, '[data-hz-music]'),
			motionBtn: q(h, '[data-hz-motion]'),
			lang: q(h, '[data-hz-lang]'),
			lang2: q(h, '[data-hz-lang2]'),
			touch: q(h, '[data-hz-touch]'),
			resultName: q(h, '[data-hz-result-name]'),
			resultMedal: q(h, '[data-hz-result-medal]'),
			resultTime: q(h, '[data-hz-result-time]'),
			resultBest: q(h, '[data-hz-result-best]'),
			resultPos: q(h, '[data-hz-result-pos]'),
			resultSkill: q(h, '[data-hz-result-skill]'),
			resultTargets: q(h, '[data-hz-result-targets]')
		};
	};

	HorizonGame.prototype.setLoading = function (pct, text) {
		if (this.el && this.el.loadingBar) this.el.loadingBar.style.width = clamp(pct, 0, 100) + '%';
		if (this.el && this.el.loadingHint && text) this.el.loadingHint.textContent = text;
	};
	HorizonGame.prototype.hideLoading = function () {
		var el = this.el.loading;
		if (!el) return;
		el.classList.add('is-done');
		global.setTimeout(function () { if (el) el.hidden = true; }, 750);
	};

	/* ======================================================================
	   world content
	   ====================================================================== */
	HorizonGame.prototype.buildEvents = function () {
		var self = this;
		var targets = {
			coast: [48, 58, 70],
			touge: [86, 100, 118],
			circuit: [120, 136, 156]
		};
		var paces = { coast: 31, touge: 19, circuit: 28 };
		this.events = this.world.gates.map(function (gate) {
			var road = gate.road;
			var startDist = gate.index * road.step;
			var length = gate.length || road.length;
			if (!road.closed) length = Math.min(length, Math.max(200, road.length - startDist - 5));
			var count = gate.id === 'circuit' ? 12 : 8;
			var checkpoints = [];
			for (var i = 1; i <= count; i++) {
				var d = length * i / count;
				var p = self.world.roadPoint(road, startDist + d, 0, {});
				var mesh = HZ.World.gateMesh(gate.color);
				mesh.position.set(p.x, p.y + 0.04, p.z);
				mesh.rotation.y = p.yaw;
				mesh.visible = false;
				self.scene.add(mesh);
				checkpoints.push({ dist: d, x: p.x, y: p.y, z: p.z, yaw: p.yaw, mesh: mesh });
			}
			var tgt = targets[gate.id] || [length / 30, length / 26, length / 22];
			return {
				id: gate.id, nameKey: 'events.' + gate.id + '.name', descKey: 'events.' + gate.id + '.desc',
				typeKey: 'events.' + gate.id + '.type', name: HZI18n.t('events.' + gate.id + '.name'),
				gate: gate, road: road, startDist: startDist, length: length,
				checkpoints: checkpoints, color: gate.color, rivalPace: paces[gate.id] || 26,
				targets: { gold: tgt[0], silver: tgt[1], bronze: tgt[2] }
			};
		});
		this.refreshEventList();
	};

	HorizonGame.prototype.buildRaceFurniture = function () {
		var mat = new THREE.MeshBasicMaterial({
			color: 0xffc766, transparent: true, opacity: 0.115, depthWrite: false,
			blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false
		});
		var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, 34, 8, 1, true), mat);
		beam.visible = false;
		beam.frustumCulled = false;
		this.scene.add(beam);
		this.raceBeam = beam;
	};

	HorizonGame.prototype.buildTraffic = function () {
		var colors = [0x8b98a3, 0x6a7889, 0xc7b8a1, 0x3d5666, 0x9b5d55, 0x5c6d79, 0xb59a77, 0x77898f];
		var rng = HZ.rng(0x7a1c);
		var fleet = ['coast', 'coast', 'coast', 'south', 'south', 'north', 'north', 'coast'];
		this.traffic = [];
		for (var i = 0; i < fleet.length; i++) {
			var road = this.world.roads[fleet[i]] || this.world.roads.coast;
			var dir = i % 2 === 0 ? 1 : -1;
			var car = HZ.Car.buildSimple(colors[i % colors.length]);
			car.group.rotation.order = 'YXZ';
			this.scene.add(car.group);
			this.traffic.push({
				car: car,
				road: road,
				dist: (i / fleet.length) * road.length + HZ.randRange(rng, -30, 30),
				speed: HZ.randRange(rng, 13, 19),
				dir: dir,
				lane: dir > 0 ? -2.05 : 2.05,
				near: 0
			});
		}
		this.updateTraffic(0, true);
	};

	HorizonGame.prototype.buildRivals = function () {
		var defs = [
			{ name: 'AKARI', paint: 2, pace: 1.02, lateral: 2.35 },
			{ name: 'REN', paint: 5, pace: 0.97, lateral: -2.35 }
		];
		this.rivals = defs.map(function (d) {
			var car = HZ.Car.build({ paint: d.paint });
			car.group.visible = false;
			car.group.rotation.order = 'YXZ';
			car.group.userData.name = d.name;
			return { name: d.name, car: car, s: 0, speed: 0, finishTime: null, paceMod: d.pace, lateral: d.lateral };
		});
		var self = this;
		this.rivals.forEach(function (r) { self.scene.add(r.car.group); });
	};

	HorizonGame.prototype.buildParticles = function () {
		this.smoke = new SmokeSystem(this.scene);
		this.skids = new SkidSystem(this.scene);
		this.skidPrevL = null;
		this.skidPrevR = null;
	};

	HorizonGame.prototype.buildPlayerCar = function () {
		this.playerCar = HZ.Car.build({ paint: this.save.paint });
		this.playerCar.group.rotation.order = 'YXZ';
		this.scene.add(this.playerCar.group);
		/* soft contact shadow: keeps the car grounded even when quality turns
		   real shadows off, and gives jumps a readable height reference */
		this.playerShadow = new THREE.Mesh(
			new THREE.PlaneGeometry(3.1, 6.2),
			new THREE.MeshBasicMaterial({ map: HZ.textures.blob(), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })
		);
		this.playerShadow.rotation.x = -Math.PI / 2;
		this.playerShadow.renderOrder = 2;
		this.scene.add(this.playerShadow);
	};

	HorizonGame.prototype.placeAtSpawn = function () {
		var s = this.world.spawn;
		this.vehicle.x = s.x; this.vehicle.z = s.z;
		this.vehicle.y = this.groundAt(s.x, s.z) + 0.04;
		this.vehicle.yaw = s.yaw;
		this.vehicle.vx = 0; this.vehicle.vz = 0; this.vehicle.vy = 0;
		this.vehicle.speed = 0; this.vehicle.vLong = 0; this.vehicle.vLat = 0;
		this.vehicle.airborne = false; this.vehicle.airTime = 0;
		this.vehicle.lastRampInfo = null;
		this.syncPlayerCar(0);
	};

	/* ======================================================================
	   events / menu / overlays
	   ====================================================================== */
	HorizonGame.prototype.showMenu = function (opts) {
		opts = opts || {};
		if (this.state === 'driving' || this.state === 'race' || this.state === 'results') {
			this.suspendState = this.state;
			if (opts.fromPause) {
				this.resumeSnapshot = { vx: this.vehicle.vx, vz: this.vehicle.vz };
			}
		}
		this.state = 'menu';
		this.paused = false;
		this.helpOpen = false;
		this.host.dataset.state = 'menu';
		this.hide(this.el.hud);
		this.hide(this.el.pause);
		this.hide(this.el.results);
		this.hide(this.el.help);
		this.hide(this.el.touch);
		this.el.menu.hidden = false;
		this.vehicle.vx = 0; this.vehicle.vz = 0;
		this.camOrbit = -1.2;
		if (!opts.keepPanel) this.showPanel('events');
		this.refreshEventList();
		this.refreshGarage();
		this.updateBestInMenu();
		if (this.audio && this.audio.context) this.audio.update({ running: false, rpm: 900, throttle: 0, speed: 0, slip: 0 });
		this.applyCameraImmediate();
	};

	HorizonGame.prototype.showPanel = function (name) {
		qa(this.host, '[data-hz-view]').forEach(function (v) {
			v.hidden = v.getAttribute('data-hz-view') !== name;
		});
		qa(this.host, '.hz-btn, .hz-iconbtn').forEach(function (b) { b.classList.remove('is-active'); });
		var map = { events: '[data-hz-events]', garage: '[data-hz-garage]', settings: '[data-hz-settings]' };
		var btn = map[name] ? this.$(map[name]) : null;
		if (btn) btn.classList.add('is-active');
		this.panel = name;
	};

	HorizonGame.prototype.refreshEventList = function () {
		if (!this.el || !this.el.eventList) return;
		var self = this;
		var save = this.save;
		var html = '';
		this.events.forEach(function (ev, i) {
			var best = save.best.events && save.best.events[ev.id];
			var bestText = best ? HZ.formatTime(best) : HZI18n.t('events.none');
			var medal = self.medalFor(ev, best);
			var color = '#' + ('000000' + ev.color.toString(16)).slice(-6);
			html += '<article class="hz-event" data-event="' + ev.id + '" style="--event-color:' + color + '">' +
				'<div class="hz-event__idx">0' + (i + 1) + '</div>' +
				'<div class="hz-event__main">' +
				'<span class="hz-event__type">' + HZI18n.t(ev.typeKey) + '</span>' +
				'<h4>' + HZI18n.t(ev.nameKey) + '</h4>' +
				'<p>' + HZI18n.t(ev.descKey) + '</p>' +
				'</div>' +
				'<div class="hz-event__side">' +
				'<span class="hz-event__best">' + HZI18n.t('events.best') + '</span>' +
				'<b>' + bestText + '</b>' +
				'<span class="hz-medal hz-medal--' + medal + '">' +
				(medal === 'none' ? '—' : HZI18n.t('events.medal.' + medal)) + '</span>' +
				'</div>' +
				'<button type="button" class="hz-event__start" data-event-start="' + ev.id + '">' +
				HZI18n.t('events.start') + '<span>↗</span></button>' +
				'</article>';
		});
		this.el.eventList.innerHTML = html;
		this.el.eventCount.textContent = '0' + this.events.length;
	};

	HorizonGame.prototype.refreshGarage = function () {
		if (!this.el || !this.el.paint) return;
		var current = this.save.paint;
		var html = '';
		global.HZ.Car.palette.forEach(function (p, i) {
			var hex = '#' + ('000000' + p.color.toString(16)).slice(-6);
			html += '<button type="button" class="hz-swatch' + (i === current ? ' is-active' : '') + '" data-paint="' + i +
				'" style="--swatch:' + hex + '" title="' + p.name + '" aria-label="' + p.name + '"><i></i></button>';
		});
		this.el.paint.innerHTML = html;
	};

	HorizonGame.prototype.updateBestInMenu = function () {
		/* the board is rebuilt on language and race changes; nothing else needed */
	};

	HorizonGame.prototype.medalFor = function (ev, time) {
		if (!time) return 'none';
		if (time <= ev.targets.gold) return 'gold';
		if (time <= ev.targets.silver) return 'silver';
		if (time <= ev.targets.bronze) return 'bronze';
		return 'finished';
	};

	HorizonGame.prototype.startDrive = function () {
		var resumingRace = this.menuFromPause && this.suspendState === 'race' && this.race;
		this.menuFromPause = false;
		this.hide(this.el.menu);
		this.el.hud.hidden = false;
		this.el.touch.hidden = false;
		this.paused = false;
		this.helpOpen = false;
		this.host.dataset.state = 'driving';
		this.state = 'driving';
		if (resumingRace) {
			this.state = 'race';
			this.host.dataset.state = 'race';
			this.el.race.hidden = false;
			this.updateRaceGateVisibility();
		} else {
			if (!this.started) {
				this.placeAtSpawn();
				this.started = true;
			}
			this.cleanupRace();
			this.el.race.hidden = true;
		}
		if (this.resumeSnapshot) {
			this.vehicle.vx = this.resumeSnapshot.vx;
			this.vehicle.vz = this.resumeSnapshot.vz;
			this.resumeSnapshot = null;
		}
		this.startAudio();
		this.applyCameraImmediate();
		this.hintTime = 15;
		this.el.hint.classList.remove('is-off');
		if (!resumingRace) {
			this.showMessage(HZI18n.t('hud.freeRoam'), 'NAGISA COAST · GOLDEN HOUR', 2600);
			this.toast('HAYNEKO FM 88.3 · ' + HZI18n.t('radio.track1'), 'is-radio');
		}
		this.audio.playClick();
	};

	HorizonGame.prototype.startEvent = function (id) {
		var ev = null;
		for (var i = 0; i < this.events.length; i++) if (this.events[i].id === id) ev = this.events[i];
		if (!ev) return;
		this.startAudio();
		this.hide(this.el.menu);
		this.hide(this.el.pause);
		this.hide(this.el.results);
		this.hide(this.el.help);
		this.el.hud.hidden = false;
		this.el.touch.hidden = false;
		this.menuFromPause = false;
		this.paused = false;
		this.helpOpen = false;
		this.cleanupRace();
		this.state = 'race';
		this.host.dataset.state = 'race';
		this.started = true;

		var p = this.world.roadPoint(ev.road, ev.startDist, 0, {});
		this.vehicle.x = p.x; this.vehicle.z = p.z;
		this.vehicle.y = this.groundAt(p.x, p.z) + 0.04;
		this.vehicle.yaw = p.yaw;
		this.vehicle.vx = 0; this.vehicle.vz = 0; this.vehicle.vy = 0; this.vehicle.speed = 0;
		this.vehicle.vLong = 0; this.vehicle.vLat = 0; this.vehicle.gear = 0;
		this.vehicle.airborne = false; this.vehicle.airTime = 0; this.vehicle.lastRampInfo = null;
		this.vehicle.rpm = 900;
		this.vehicle.steer = 0;
		this.resetSkids();
		this.skill.live = 0; this.skill.chain = 0; this.skill.mult = 1; this.skill.hold = 0;
		this.bankedThisEvent = 0;
		this.syncPlayerCar(0);

		var route = [];
		for (var d = 0; d <= ev.length; d += 4) {
			var rp = this.world.roadPoint(ev.road, ev.startDist + d, 0, {});
			route.push({ x: rp.x, z: rp.z, d: d, yaw: rp.yaw });
		}
		if (!route.length || route[route.length - 1].d < ev.length) {
			var endp = this.world.roadPoint(ev.road, ev.startDist + ev.length, 0, {});
			route.push({ x: endp.x, z: endp.z, d: ev.length, yaw: endp.yaw });
		}

		this.race = {
			event: ev, phase: 'countdown', countdown: 3.0, elapsed: 0, cpIndex: 0,
			route: route, playerIndex: 0, playerDist: 0, position: 1,
			skillAtStart: this.save.skill, lastBeep: 4, finished: false
		};
		this.raceBeam.material.color.setHex(ev.color);
		this.raceBeam.visible = true;
		this.el.race.hidden = false;
		this.el.raceName.textContent = HZI18n.t(ev.nameKey);
		this.el.racePos.textContent = '1/3';
		this.el.raceTime.textContent = HZ.formatTime(0);
		this.el.raceCp.textContent = '1/' + ev.checkpoints.length;
		this.el.raceBar.style.width = '0%';
		this.hide(this.el.prompt);
		this.promptEvent = null;

		for (var r = 0; r < this.rivals.length; r++) {
			var rv = this.rivals[r];
			rv.s = 0; rv.speed = 0; rv.finishTime = null;
			rv.car.group.visible = true;
			var base = this.world.roadPoint(ev.road, ev.startDist, rv.lateral, {});
			rv.car.group.position.set(base.x, base.y + 0.05, base.z);
			rv.car.group.rotation.set(0, base.yaw, 0);
		}
		this.world.gates.forEach(function (g) { g.gate.visible = false; });
		this.updateRaceGateVisibility();
		this.applyCameraImmediate();
		this.hintTime = 0;
		this.el.hint.classList.add('is-off');
		this.showMessage(HZI18n.t(ev.nameKey), HZI18n.t(ev.typeKey), 2600);
		var self = this;
		this.fade(function () { self.audio.playClick(); });
	};

	HorizonGame.prototype.cleanupRace = function () {
		if (this.race) {
			this.race.event.checkpoints.forEach(function (c) { c.mesh.visible = false; });
		}
		if (this.events) {
			this.events.forEach(function (ev) { ev.checkpoints.forEach(function (c) { c.mesh.visible = false; }); });
		}
		if (this.raceBeam) this.raceBeam.visible = false;
		if (this.world) this.world.gates.forEach(function (g) { g.gate.visible = true; });
		this.rivals.forEach(function (r) { r.car.group.visible = false; r.speed = 0; r.finishTime = null; });
		this.race = null;
		if (this.el) this.el.race.hidden = true;
	};

	HorizonGame.prototype.updateRaceGateVisibility = function () {
		if (!this.race) return;
		var idx = this.race.cpIndex;
		var ev = this.race.event;
		ev.checkpoints.forEach(function (c, i) { c.mesh.visible = i === idx; });
		var cp = ev.checkpoints[Math.min(idx, ev.checkpoints.length - 1)];
		if (cp) {
			this.raceBeam.position.set(cp.x, cp.y + 17, cp.z);
			this.raceBeam.visible = !this.race.finished;
		}
	};

	HorizonGame.prototype.finishRace = function () {
		if (!this.race || this.race.finished) return;
		this.race.finished = true;
		this.race.phase = 'finished';
		this.state = 'results';
		this.host.dataset.state = 'results';
		this.bankSkill(true, true);
		var ev = this.race.event;
		var time = this.race.elapsed;
		var rivalsFinished = this.rivals.filter(function (r) { return r.finishTime != null && r.finishTime < time; }).length;
		var position = 1 + rivalsFinished;
		var medal = this.medalFor(ev, time);
		var best = this.save.best.events[ev.id];
		var newBest = !best || time < best;
		if (newBest) this.save.best.events[ev.id] = time;
		if (medal === 'gold') this.addBanked(1000);
		else if (medal === 'silver') this.addBanked(600);
		else if (medal === 'bronze') this.addBanked(350);
		else this.addBanked(150);
		HZ.storeSave(this.save);
		this.bankedThisEvent = this.race.skillAtStart != null ? Math.max(0, this.save.skill - this.race.skillAtStart) : 0;

		this.el.resultName.textContent = HZI18n.t(ev.nameKey);
		this.el.resultMedal.textContent = HZI18n.t('events.medal.' + medal);
		this.el.resultMedal.className = 'hz-results__medal hz-medal--' + medal;
		this.el.resultTime.textContent = HZ.formatTime(time);
		this.el.resultBest.textContent = HZ.formatTime(this.save.best.events[ev.id]) + (newBest ? ' · ' + HZI18n.t('results.newBest') : '');
		this.el.resultPos.textContent = position + ' / 3';
		this.el.resultSkill.textContent = HZ.formatInt(this.bankedThisEvent);
		var targetsHtml = '';
		[['gold', ev.targets.gold], ['silver', ev.targets.silver], ['bronze', ev.targets.bronze]].forEach(function (t) {
			targetsHtml += '<div class="' + (medal === t[0] ? 'is-hit' : '') + '"><span>' + HZI18n.t('events.medal.' + t[0]) + '</span><b>' + HZ.formatTime(t[1]) + '</b></div>';
		});
		this.el.resultTargets.innerHTML = targetsHtml;
		this.el.results.hidden = false;
		this.el.touch.hidden = true;
		this.updateRaceGateVisibility();
		this.audio.beep(880, 0.3, 0.12);
		this.audio.beep(1320, 0.4, 0.1);
		this.updateRaceHud();
	};

	HorizonGame.prototype.endRaceToFree = function () {
		this.hide(this.el.results);
		this.cleanupRace();
		this.state = 'driving';
		this.host.dataset.state = 'driving';
		this.el.hud.hidden = false;
		this.el.touch.hidden = false;
		this.el.race.hidden = true;
		this.applyCameraImmediate();
		this.showMessage(HZI18n.t('hud.freeRoam'), 'NAGISA COAST', 2200);
	};

	HorizonGame.prototype.raceResultsToMenu = function () {
		this.cleanupRace();
		this.hide(this.el.results);
		this.el.hud.hidden = true;
		this.showMenu({});
		this.showPanel('events');
	};

	HorizonGame.prototype.restartRace = function () {
		var id = this.race ? this.race.event.id : null;
		this.cleanupRace();
		if (id) this.startEvent(id);
	};

	HorizonGame.prototype.startAudio = function () {
		if (!this.audio) return;
		this.audio.init();
		this.audio.resume();
		this.audio.setEnabled(!this.muted);
		this.audio.setVolume(this.settings.volume);
		this.audio.setMusic(this.music);
	};

	HorizonGame.prototype.openHelp = function () {
		if (this.helpOpen) return this.closeHelp();
		if (this.state !== 'driving' && this.state !== 'race') return;
		this.helpOpen = true;
		this.el.help.hidden = false;
		this.el.touch.hidden = true;
	};
	HorizonGame.prototype.closeHelp = function () {
		this.helpOpen = false;
		this.el.help.hidden = true;
		if (this.state === 'driving' || this.state === 'race') this.el.touch.hidden = false;
	};

	HorizonGame.prototype.togglePause = function () {
		if (this.state !== 'driving' && this.state !== 'race') return;
		if (this.helpOpen) return this.closeHelp();
		if (this.paused) this.resumeGame(); else this.pauseGame();
	};
	HorizonGame.prototype.pauseGame = function () {
		this.paused = true;
		this.pausedAt = performance.now();
		this.el.pause.hidden = false;
		this.el.touch.hidden = true;
		this.clearInput();
		if (this.audio && this.audio.context) this.audio.update({ running: false, rpm: 900, throttle: 0, speed: 0, slip: 0 });
		this.audio.playClick();
	};
	HorizonGame.prototype.resumeGame = function () {
		this.paused = false;
		this.el.pause.hidden = true;
		this.el.touch.hidden = false;
		this.audio.playClick();
	};

	HorizonGame.prototype.fade = function (cb) {
		var el = this.el.fade;
		if (!el) { cb(); return; }
		el.classList.add('is-on');
		global.setTimeout(function () {
			cb();
			el.classList.remove('is-on');
		}, 220);
	};

	HorizonGame.prototype.showMessage = function (main, sub, ms, cls) {
		if (!this.el || !this.el.message) return;
		var el = this.el.message;
		el.className = 'hz-message' + (cls ? ' ' + cls : '');
		el.innerHTML = '';
		var b = doc.createElement('b');
		b.textContent = main;
		el.appendChild(b);
		if (sub) {
			var s = doc.createElement('span');
			s.textContent = sub;
			el.appendChild(s);
		}
		el.classList.add('is-on');
		if (this.messageTimer) clearTimeout(this.messageTimer);
		var self = this;
		this.messageTimer = global.setTimeout(function () { el.classList.remove('is-on'); }, ms || 2200);
	};

	HorizonGame.prototype.toast = function (text, cls, ms) {
		if (!this.el || !this.el.toasts) return;
		var d = doc.createElement('div');
		d.className = 'hz-toast' + (cls ? ' ' + cls : '');
		d.textContent = text;
		this.el.toasts.appendChild(d);
		while (this.el.toasts.children.length > 4) this.el.toasts.removeChild(this.el.toasts.firstChild);
		global.setTimeout(function () {
			d.classList.add('is-out');
			global.setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 400);
		}, ms || 2400);
	};

	/* ======================================================================
	   HUD / skill
	   ====================================================================== */
	HorizonGame.prototype.addSkill = function (points, label) {
		if (!(points > 0)) return;
		this.skill.live += points;
		this.skill.idle = 0;
		if (label) this.toast('+' + HZ.formatInt(points) + '  ' + label, 'is-skill');
	};
	HorizonGame.prototype.addBanked = function (points) {
		if (!(points > 0)) return;
		this.save.skill = (this.save.skill || 0) + Math.round(points);
		this.skill.total = this.save.skill;
		this.skill.chain = Math.min(12, this.skill.chain + 1);
		this.skill.mult = 1 + Math.min(4, Math.floor(this.skill.chain / 2));
		HZ.storeSave(this.save);
	};
	HorizonGame.prototype.bankSkill = function (force, silent) {
		var pts = Math.round(this.skill.live);
		if (pts <= 0) {
			if (force) { this.skill.live = 0; }
			return;
		}
		var mult = this.skill.mult;
		var total = pts * mult;
		this.save.skill = (this.save.skill || 0) + total;
		this.skill.total = this.save.skill;
		this.skill.live = 0;
		this.skill.chain = Math.min(12, this.skill.chain + 1);
		this.skill.mult = 1 + Math.min(4, Math.floor(this.skill.chain / 2));
		this.skill.idle = 0;
		this.skill.hold = 0;
		if (!silent) {
			this.toast(HZI18n.t('skill.banked') + ' +' + HZ.formatInt(total), 'is-bank');
			if (mult > 1) this.audio.skill(Math.min(4, mult));
		}
		HZ.storeSave(this.save);
	};
	HorizonGame.prototype.breakChain = function () {
		if (this.skill.live > 0 || this.skill.inDrift) {
			this.skill.live = 0;
			this.skill.inDrift = false;
			this.skill.hold = 0;
			this.skill.chain = 0;
			this.skill.mult = 1;
			this.showMessage(HZI18n.t('skill.lost'), '', 1200, 'is-alert');
		}
	};
	HorizonGame.prototype.updateSkill = function (dt, drifting, driftAmount, speed) {
		var sk = this.skill;
		if (drifting && speed > 8) {
			sk.inDrift = true;
			var gain = Math.min(140, speed * Math.abs(driftAmount) * 7.5);
			sk.live += gain * dt;
			sk.idle = 0;
			sk.hold = 0;
		} else if (sk.inDrift) {
			sk.inDrift = false;
			sk.hold = 0.7;
		}
		if (sk.hold > 0) {
			sk.hold -= dt;
			if (sk.hold <= 0) this.bankSkill(false, false);
		}
		sk.idle += dt;
		if (sk.idle > 4.2) {
			if (sk.live > 0) this.bankSkill(false, false);
			sk.chain = Math.max(0, sk.chain - dt * 0.6);
			sk.mult = 1 + Math.min(4, Math.floor(sk.chain / 2));
		}
	};

	HorizonGame.prototype.buildTicks = function () {
		if (!this.el.ticks) return;
		var html = '';
		for (var i = 0; i <= 8; i++) {
			var a = (-90 + (i / 8) * 180) * Math.PI / 180;
			var x1 = 130 + Math.cos(a) * 96, y1 = 134 + Math.sin(a) * 96;
			var x2 = 130 + Math.cos(a) * (i % 2 === 0 ? 84 : 89), y2 = 134 + Math.sin(a) * (i % 2 === 0 ? 84 : 89);
			html += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" class="' + (i % 2 === 0 ? 'is-major' : '') + '"/>';
		}
		this.el.ticks.innerHTML = html;
	};

	HorizonGame.prototype.updateHud = function (dt) {
		var v = this.vehicle;
		var metric = this.settings.units !== 'imperial';
		var speed = Math.abs(v.vLong) * 3.6;
		var shown = metric ? speed : speed * 0.621371;
		var maxDisplay = metric ? 320 : 200;
		var ratio = clamp(shown / maxDisplay, 0, 1);
		if (this.el.speed) this.el.speed.textContent = String(Math.round(shown));
		if (this.el.units) this.el.units.textContent = HZI18n.t(metric ? 'units.kmh' : 'units.mph');
		var gearText = 'N';
		if (v.vLong < -0.6) gearText = 'R';
		else if (Math.abs(v.vLong) > 0.6) gearText = String(v.gear + 1);
		if (this.el.gear) this.el.gear.textContent = gearText;
		if (this.el.needle) this.el.needle.setAttribute('transform', 'rotate(' + (-90 + ratio * 180).toFixed(2) + ' 130 134)');
		if (this.el.arc) {
			var len = Math.PI * 102;
			this.el.arc.style.strokeDasharray = len + ' ' + len;
			this.el.arc.style.strokeDashoffset = String(len * (1 - ratio));
		}
		if (this.el.rpm) {
			var rpmRatio = clamp((v.rpm - 900) / 7000, 0, 1);
			this.el.rpm.style.width = (rpmRatio * 100).toFixed(1) + '%';
			this.el.rpm.style.background = rpmRatio > 0.86 ? 'linear-gradient(90deg,#ffb340,#ff4b2e)' : 'linear-gradient(90deg,#ffd580,#ff9d3c)';
		}

		/* skill */
		this.el.skillPoints.textContent = HZ.formatInt(Math.round(this.skill.live));
		this.el.skillMult.textContent = '×' + this.skill.mult;
		this.el.skillBank.textContent = HZ.formatInt(this.skill.total);
		this.el.skillBar.style.width = clamp(this.skill.live / 1200, 0, 1) * 100 + '%';

		/* race */
		if (this.race && !this.race.finished) this.updateRaceHud();

		/* speed fx */
		var motion = this.settings.motion !== false;
		var fx = motion ? clamp((speed - 105) / 150, 0, 1) * 0.75 : 0;
		this.el.speedfx.style.opacity = fx.toFixed(3);

		/* hint fade */
		if (this.hintTime > 0) {
			this.hintTime -= dt;
			if (this.hintTime <= 0) this.el.hint.classList.add('is-off');
		}
	};

	HorizonGame.prototype.updateRaceHud = function () {
		var r = this.race;
		if (!r || !this.el.race) return;
		var ev = r.event;
		this.el.raceTime.textContent = HZ.formatTime(r.elapsed);
		var cp = Math.min(r.cpIndex + 1, ev.checkpoints.length);
		if (r.phase === 'running' && r.cpIndex < ev.checkpoints.length) {
			var next = ev.checkpoints[r.cpIndex];
			var dist = Math.round(Math.hypot(this.vehicle.x - next.x, this.vehicle.z - next.z));
			this.el.raceCp.textContent = cp + '/' + ev.checkpoints.length + ' · ' + dist + ' M';
		} else {
			this.el.raceCp.textContent = cp + '/' + ev.checkpoints.length;
		}
		this.el.racePos.textContent = r.position + '/3';
		var progress = clamp(r.playerDist / ev.length, 0, 1) * 100;
		this.el.raceBar.style.width = progress.toFixed(1) + '%';
	};

	HorizonGame.prototype.drawMinimap = function () {
		if (!this.el || !this.el.minimap || !this.world) return;
		var cv = this.el.minimap;
		var ctx = cv.getContext('2d');
		var size = cv.width;
		ctx.clearRect(0, 0, size, size);
		ctx.drawImage(this.world.minimap.canvas, 0, 0, size, size);
		var toMap = this.world.minimap.toMap;
		var mapScale = size / 260;
		function p(x, z) {
			var m = toMap(x, z);
			return { x: m.x * mapScale, y: m.y * mapScale };
		}
		/* zones */
		this.world.driftZones.forEach(function (z) {
			var m = p(z.x, z.z);
			ctx.strokeStyle = 'rgba(185,123,255,0.75)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(m.x, m.y, z.radius * mapScale * 260 / (this.world.size || 3000), 0, Math.PI * 2);
			ctx.stroke();
		}, this);
		/* event gates */
		if (!this.race) {
			this.world.gates.forEach(function (g) {
				var m = p(g.x, g.z);
				ctx.fillStyle = 'rgba(255,210,140,0.9)';
				ctx.beginPath();
				ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
				ctx.fill();
			});
			this.world.traps.forEach(function (t) {
				var m = p(t.x, t.z);
				ctx.fillStyle = 'rgba(255,255,255,0.75)';
				ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
			});
		} else {
			var ev = this.race.event;
			ctx.strokeStyle = 'rgba(255,204,120,0.85)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			for (var i = 0; i < this.race.route.length; i += 6) {
				var m = p(this.race.route[i].x, this.race.route[i].z);
				if (i === 0) ctx.moveTo(m.x, m.y); else ctx.lineTo(m.x, m.y);
			}
			ctx.stroke();
			ev.checkpoints.forEach(function (c, idx) {
				var m = p(c.x, c.z);
				ctx.fillStyle = idx === this.race.cpIndex ? '#fff3d0' : 'rgba(255,255,255,0.12)';
				ctx.beginPath();
				ctx.arc(m.x, m.y, idx === this.race.cpIndex ? 3.5 : 2, 0, Math.PI * 2);
				ctx.fill();
			}, this);
			this.rivals.forEach(function (r) {
				if (!r.car.group.visible) return;
				var m = p(r.car.group.position.x, r.car.group.position.z);
				ctx.fillStyle = 'rgba(120,255,220,0.95)';
				ctx.beginPath();
				ctx.arc(m.x, m.y, 2.6, 0, Math.PI * 2);
				ctx.fill();
			});
		}
		/* player */
		var pm = p(this.vehicle.x, this.vehicle.z);
		var yaw = this.vehicle.yaw;
		var fx = Math.sin(yaw), fy = Math.cos(yaw);
		var rx = Math.cos(yaw), ry = -Math.sin(yaw);
		ctx.fillStyle = '#ffb340';
		ctx.strokeStyle = 'rgba(20,20,24,0.8)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(pm.x + fx * 7, pm.y + fy * 7);
		ctx.lineTo(pm.x - fx * 4.5 - rx * 4.2, pm.y - fy * 4.5 - ry * 4.2);
		ctx.lineTo(pm.x - fx * 2.2, pm.y - fy * 2.2);
		ctx.lineTo(pm.x - fx * 4.5 + rx * 4.2, pm.y - fy * 4.5 + ry * 4.2);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	};

	/* ======================================================================
	   physics
	   ====================================================================== */
	HorizonGame.prototype.groundAt = function (x, z) {
		var h = this.world.heightAt(x, z);
		var near = this.world.nearroad(x, z);
		if (near && near.dist < near.half + 3.4) {
			var t = 1 - clamp((near.dist - near.half) / 3.4, 0, 1);
			var roadY = near.y + 0.09;
			if (t > 0.02) h = lerp(h, Math.max(h, roadY), t);
			if (near.dist < near.half) h = Math.max(h, roadY);
		}
		if (this.world.plazaAt) {
			var plaza = this.world.plazaAt(x, z);
			if (plaza) h = Math.max(h, plaza.y);
		}
		if (this.world.rampAt) {
			var ramp = this.world.rampAt(x, z);
			if (ramp) h = Math.max(h, ramp.y);
		}
		return h;
	};

	HorizonGame.prototype.readInputs = function () {
		var k = this.keys;
		var steer = 0, throttle = 0, brake = 0, hand = false;
		if (k.KeyA || k.ArrowLeft) steer -= 1;
		if (k.KeyD || k.ArrowRight) steer += 1;
		if (k.KeyW || k.ArrowUp) throttle += 1;
		if (k.KeyS || k.ArrowDown) brake += 1;
		if (k.Space) hand = true;
		steer += this.touch.steer;
		if (this.touch.throttle) throttle += 1;
		if (this.touch.brake) brake += 1;
		if (this.touch.hand) hand = true;

		/* gamepad */
		var pads = global.navigator && global.navigator.getGamepads ? global.navigator.getGamepads() : null;
		if (pads) {
			for (var i = 0; i < pads.length; i++) {
				var pad = pads[i];
				if (!pad) continue;
				var ax = pad.axes && pad.axes.length ? pad.axes[0] : 0;
				if (Math.abs(ax) > 0.12) steer += ax;
				if (pad.buttons && pad.buttons[7]) throttle += pad.buttons[7].value || (pad.buttons[7].pressed ? 1 : 0);
				if (pad.buttons && pad.buttons[6]) brake += pad.buttons[6].value || (pad.buttons[6].pressed ? 1 : 0);
				if (pad.buttons && pad.buttons[0] && pad.buttons[0].pressed) hand = true;
				if (pad.buttons && pad.buttons[3] && pad.buttons[3].pressed && !this._padCPressed) { this._padCPressed = true; this.cycleCamera(); }
				if (pad.buttons && pad.buttons[3] && !pad.buttons[3].pressed) this._padCPressed = false;
				break;
			}
		}
		this.input.steer = clamp(steer, -1, 1);
		this.input.throttle = clamp(throttle, 0, 1);
		this.input.brake = clamp(brake, 0, 1);
		this.input.handbrake = hand;
	};

	HorizonGame.prototype.updateVehicle = function (dt) {
		var v = this.vehicle;
		if (this.state === 'menu' || this.state === 'results' || this.state === 'boot') {
			this.syncPlayerCar(dt);
			return;
		}
		if (this.race && this.race.phase === 'countdown') {
			v.vx = 0; v.vz = 0;
			v.vLong = 0; v.vLat = 0;
			v.rpm = damp(v.rpm, 1200 + this.input.throttle * 3600, 5, dt);
			this.readInputs();
			this.updateRace(dt);
			this.syncPlayerCar(dt);
			return;
		}
		this.airAwardCooldown = Math.max(0, this.airAwardCooldown - dt);
		this.readInputs();
		var input = this.input;
		var airAtStart = v.airborne;
		var fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
		var rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
		var near = this.world.nearroad(v.x, v.z);
		var onRoad = !airAtStart && !!(near && near.dist < near.half + 1.0);
		var speedLimit = airAtStart ? 96 : (onRoad ? 84 : 44);
		var vLong = v.vx * fx + v.vz * fz;
		var vLat = v.vx * rx + v.vz * rz;
		var speed = Math.hypot(v.vx, v.vz);

		/* steering */
		var steerTarget = input.steer;
		v.steer = damp(v.steer, steerTarget, 7.5, dt);

		/* longitudinal — the engine only pushes while the tyres are down */
		var accel = 0;
		if (!airAtStart) {
			if (input.throttle > 0.01) {
				var ratio = clamp(Math.abs(vLong) / speedLimit, 0, 1);
				accel += input.throttle * (14.8 * (1 - ratio * ratio * 0.82) + 1.4) * (onRoad ? 1 : 0.62);
			}
			if (input.brake > 0.01) {
				if (vLong > 0.4) accel -= 26 * input.brake;
				else accel -= 8.5 * input.brake;
			}
			if (input.handbrake) {
				accel -= 8.5 * Math.sign(vLong) * Math.min(1, Math.abs(vLong) / 3);
			}
			accel -= 0.00044 * vLong * Math.abs(vLong) * (onRoad ? 1 : 2.1);
			accel -= (onRoad ? 0.55 : 3.4) * Math.sign(vLong) * Math.min(1, Math.abs(vLong) / 2.5);
			var hF = this.groundAt(v.x + fx * 1.5, v.z + fz * 1.5);
			var hB = this.groundAt(v.x - fx * 1.5, v.z - fz * 1.5);
			accel -= 9.81 * clamp((hF - hB) / 3.0, -0.8, 0.8);
		} else {
			accel -= 0.00018 * vLong * Math.abs(vLong);
		}

		/* gearbox (uses the speed we entered this step with) */
		v.shiftTimer = Math.max(0, v.shiftTimer - dt);
		this.updateGear(vLong, dt);

		/* yaw */
		var speedFactor = clamp(Math.abs(vLong) / 4.5, 0, 1);
		var speedReduce = 1 - 0.45 * clamp(Math.abs(vLong) / 78, 0, 1);
		var yawRate = v.steer * 1.08 * speedFactor * speedReduce * (onRoad ? 1 : 0.72);
		if (input.handbrake && !airAtStart) yawRate *= 1.32;
		if (airAtStart) yawRate *= 0.2;
		/* keep A = left and D = right even while reversing; the old sign flip
		   made the chase view read as a right turn when rolling backwards */
		if (vLong < -0.3) yawRate *= 0.78;
		v.yaw += yawRate * dt;

		/* re-decompose the old momentum into the new heading, then push the
		   engine/brake force along that heading and bleed the lateral slip */
		fx = Math.sin(v.yaw); fz = Math.cos(v.yaw);
		rx = Math.cos(v.yaw); rz = -Math.sin(v.yaw);
		vLong = v.vx * fx + v.vz * fz;
		vLat = v.vx * rx + v.vz * rz;
		vLong += accel * dt;
		if (vLong < -9) vLong = -9;
		if (vLong > speedLimit * 1.05) vLong = lerp(vLong, speedLimit * 1.05, 0.35);
		var grip = airAtStart ? 0.16 : (onRoad ? (input.handbrake ? 2.1 : 8.8) : (input.handbrake ? 1.4 : 4.1));
		vLat *= Math.exp(-grip * dt);
		if (!airAtStart && Math.abs(vLat) > 1.5) vLong -= Math.abs(vLat) * 0.035 * dt;
		v.vx = fx * vLong + rx * vLat;
		v.vz = fz * vLong + rz * vLat;
		v.x += v.vx * dt;
		v.z += v.vz * dt;

		/* bounds and water */
		var limit = (this.world.half || 1500) - 40;
		if (v.x < -limit) { v.x = -limit; v.vx = Math.abs(v.vx) * -0.15; }
		if (v.x > limit) { v.x = limit; v.vx = -Math.abs(v.vx) * 0.15; }
		if (v.z < -limit) { v.z = -limit; v.vz = Math.abs(v.vz) * -0.15; }
		if (v.z > limit) { v.z = limit; v.vz = -Math.abs(v.vz) * 0.15; }
		var ground = this.groundAt(v.x, v.z);
		var rampInfo = this.world.rampAt ? this.world.rampAt(v.x, v.z) : null;
		var ride = 0.04;
		if (v.airborne) {
			v.vy -= 18 * dt;
			v.y += v.vy * dt;
			v.airTime += dt;
			if (v.y <= ground + ride) {
				var impact = -v.vy;
				v.y = ground + ride;
				v.vy = 0;
				v.airborne = false;
				if (v.airTime > 0.45 && this.airAwardCooldown <= 0) {
					var airPoints = Math.round(60 + v.airTime * 150);
					this.airAwardCooldown = 1.1;
					this.addSkill(airPoints, 'AIR');
					this.showMessage('AIR', v.airTime.toFixed(2) + ' S · +' + airPoints, 1400, 'is-record');
					for (var dust = 0; dust < 10; dust++) {
						var da = Math.random() * Math.PI * 2;
						this.smoke.spawn(v.x + Math.cos(da) * 1.1, ground + 0.2, v.z + Math.sin(da) * 1.1,
							Math.cos(da) * 2, 1.2 + Math.random(), Math.sin(da) * 2, 0.7 + Math.random() * 0.5, 1.1);
					}
				}
				if (impact > 4.5) {
					this.shake = Math.min(1.4, this.shake + impact / 26);
					this.audio.impact(clamp(impact / 18, 0.2, 1));
					v.vx *= 0.96; v.vz *= 0.96;
				}
				v.airTime = 0;
			}
		} else {
			var targetY = ground + ride;
			if (v.prevGroundY != null && targetY < v.y - 0.55 && v.speed > 14) {
				v.airborne = true; v.vy = 0; v.airTime = 0;
			} else {
				if (targetY > v.y) v.y = targetY;
				else v.y = damp(v.y, targetY, 32, dt);
				if (v.y < ground) v.y = ground;
			}
			/* ramp lip: while the wheels are on the ramp remember it, and when
			   the ramp disappears under the car convert the slope into lift */
			if (rampInfo && v.speed > 7) {
				v.lastRampInfo = rampInfo.ramp;
			} else if (!rampInfo && v.lastRampInfo) {
				var rmp = v.lastRampInfo;
				var dot = Math.sin(v.yaw) * rmp.fx + Math.cos(v.yaw) * rmp.fz;
				if (dot > 0.22 && v.speed > 8) {
					v.airborne = true;
					v.vy = clamp(v.speed * (rmp.height / rmp.length) * 1.8 + 1.4, 2, 18);
					v.airTime = 0;
					v.y = Math.max(v.y, ground + ride + 0.02);
					this.shake = Math.max(this.shake, 0.2);
					this.audio.beep(560, 0.09, 0.06);
				} else {
					v.lastRampInfo = null;
				}
			}
		}
		v.prevGroundY = ground;
		if (!isFinite(v.y) || v.y < ground - 2) { v.y = ground + ride; v.vy = 0; v.airborne = false; }
		if (!v.airborne && ground < 0.3 && !onRoad) this.waterTime += dt; else this.waterTime = 0;
		if (this.waterTime > 1.0) {
			this.waterTime = 0;
			this.showMessage(HZI18n.t('toast.water'), '', 1200, 'is-alert');
			this.resetVehicle(this.state === 'race');
		}

		/* collisions */
		this.resolveCollisions(dt);

		/* ground orientation (or a ballistic pitch while airborne) */
		var pitchTarget, rollTarget;
		if (v.airborne) {
			pitchTarget = clamp(-v.vy * 0.018, -0.22, 0.16);
			rollTarget = clamp(-v.vLat * 0.008, -0.08, 0.08);
		} else {
			var hf2 = this.groundAt(v.x + fx * 1.45, v.z + fz * 1.45);
			var hb2 = this.groundAt(v.x - fx * 1.45, v.z - fz * 1.45);
			var hr2 = this.groundAt(v.x + rx * 0.92, v.z + rz * 0.92);
			var hl2 = this.groundAt(v.x - rx * 0.92, v.z - rz * 0.92);
			pitchTarget = -Math.atan2(hf2 - hb2, 2.9);
			rollTarget = Math.atan2(hr2 - hl2, 1.84);
		}
		v.pitch = damp(v.pitch, pitchTarget, 10, dt);
		v.roll = damp(v.roll, rollTarget, 10, dt);

		/* derived values */
		v.vLong = vLong;
		v.vLat = vLat;
		v.speed = Math.hypot(v.vx, v.vz);
		v.drift = Math.atan2(vLat, Math.max(Math.abs(vLong), 2.5));
		v.onRoad = onRoad;
		v.offroad = !onRoad;
		v.throttle = input.throttle;
		v.brake = input.brake;
		v.rpm = this.computeRpm(vLong, input.throttle);

		var drifting = Math.abs(v.drift) > 0.14 && v.speed > 8;
		this.updateSkill(dt, drifting, v.drift, v.speed);
		this.spawnEffects(dt, drifting);
		this.updateActivities(dt);
		this.updateTraffic(dt, false);
		this.updateRace(dt);
		this.syncPlayerCar(dt);
		this.updateCameraShakeInput(dt, onRoad && !v.airborne);
	};

	HorizonGame.prototype.updateGear = function (vLong, dt) {
		var v = this.vehicle;
		var ratios = [3.55, 2.45, 1.85, 1.45, 1.18, 0.94];
		var rpm;
		if (Math.abs(vLong) < 0.35) {
			rpm = 900 + this.input.throttle * 2800;
			v.gear = 0;
		} else {
			rpm = Math.abs(vLong) / (2 * Math.PI * 0.35) * 60 * ratios[v.gear] * 3.75;
			if (v.shiftTimer <= 0) {
				if (rpm > 7100 && v.gear < ratios.length - 1) {
					v.gear++;
					v.shiftTimer = 0.22;
					this.audio.shift(true);
				} else if (rpm < 2750 && v.gear > 0) {
					v.gear--;
					v.shiftTimer = 0.22;
					this.audio.shift(false);
				}
			}
			rpm = clamp(rpm, 850, 7900);
		}
		v.rpm = rpm;
	};

	HorizonGame.prototype.computeRpm = function (vLong, throttle) {
		if (Math.abs(vLong) < 0.35) return 900 + throttle * 2600;
		var ratios = [3.55, 2.45, 1.85, 1.45, 1.18, 0.94];
		return clamp(Math.abs(vLong) / (2 * Math.PI * 0.35) * 60 * ratios[this.vehicle.gear] * 3.75, 850, 7900);
	};

	HorizonGame.prototype.resolveCollisions = function (dt) {
		var v = this.vehicle;
		var speed = Math.hypot(v.vx, v.vz);
		for (var i = 0; i < this.world.colliders.length; i++) {
			var c = this.world.colliders[i];
			if (!c.r) continue;
			var dx = v.x - c.x, dz = v.z - c.z;
			var d = Math.hypot(dx, dz);
			var rad = c.r + 1.25;
			if (d < rad && d > 0.0001) {
				var nx = dx / d, nz = dz / d;
				v.x = c.x + nx * rad;
				v.z = c.z + nz * rad;
				var vn = v.vx * nx + v.vz * nz;
				if (vn < 0) { v.vx -= vn * nx * 1.4; v.vz -= vn * nz * 1.4; }
				v.vx *= 0.62; v.vz *= 0.62;
				if (speed > 6) {
					this.shake = Math.min(1.4, this.shake + speed / 42);
					this.audio.impact(clamp(speed / 28, 0.2, 1));
					this.flash();
					this.breakChain();
				}
			}
		}
	};

	HorizonGame.prototype.updateCameraShakeInput = function (dt, onRoad) {
		var v = this.vehicle;
		if (!onRoad && v.speed > 12) this.shake = Math.min(0.5, this.shake + dt * 0.4);
		this.shake = Math.max(0, this.shake - dt * 1.4);
	};

	HorizonGame.prototype.flash = function () {
		var el = this.el.flash;
		if (!el) return;
		el.classList.remove('is-on');
		void el.offsetWidth;
		el.classList.add('is-on');
	};

	HorizonGame.prototype.syncPlayerCar = function (dt) {
		var v = this.vehicle;
		var car = this.playerCar;
		if (!car) return;
		var g = car.group;
		g.position.set(v.x, v.y, v.z);
		g.rotation.x = v.pitch;
		g.rotation.y = v.yaw;
		g.rotation.z = v.roll;
		var load = clamp(v.vLat * -0.006 + v.steer * -0.02, -0.08, 0.08);
		car.bodyGroup.rotation.z = damp(car.bodyGroup.rotation.z, load, 8, dt || 0);
		car.bodyGroup.rotation.x = damp(car.bodyGroup.rotation.x, clamp(v.brake * 0.012 - v.throttle * 0.007, -0.03, 0.03), 6, dt || 0);
		var spin = v.vLong / 0.35 * (dt || 0);
		for (var i = 0; i < car.wheels.length; i++) {
			var w = car.wheels[i];
			w.steer.rotation.y = w.front ? v.steer * 0.46 : 0;
			w.spin.rotation.x += spin;
		}
		car.tailMat.emissiveIntensity = v.brake > 0.2 ? 3.2 : 1.35;
		if (this.playerShadow) {
			var gh = this.groundAt(v.x, v.z);
			var airH = Math.max(0, v.y - gh);
			this.playerShadow.position.set(v.x, gh + 0.035, v.z);
			this.playerShadow.material.opacity = clamp(0.55 / (1 + airH * 0.45), 0.07, 0.55);
			var sc = 1 + Math.min(1.1, airH * 0.07);
			this.playerShadow.scale.set(sc, sc, 1);
		}
	};

	HorizonGame.prototype.spawnEffects = function (dt, drifting) {
		var v = this.vehicle;
		var hand = this.input.handbrake;
		var slip = Math.abs(v.drift) > 0.14 || (hand && v.speed > 6);
		if (!slip || v.speed < 5) {
			this.smokeAccum = 0; this.skidAccum = 0;
			this.skidPrevL = null; this.skidPrevR = null;
			return;
		}
		var fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
		var rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
		var rearX = v.x - fx * 1.36, rearZ = v.z - fz * 1.36;
		var lx = rearX - rx * 0.84, lz = rearZ - rz * 0.84;
		var rxp = rearX + rx * 0.84, rzp = rearZ + rz * 0.84;
		var ly = this.groundAt(lx, lz) + 0.07;
		var ry = this.groundAt(rxp, rzp) + 0.07;
		this.smokeAccum += dt;
		this.skidAccum += dt;
		var self = this;
		while (this.smokeAccum > 0.026) {
			this.smokeAccum -= 0.026;
			var strength = clamp(Math.abs(v.drift) * 3 + (hand ? 0.6 : 0), 0.2, 1.2);
			this.smoke.spawn(lx + (Math.random() - 0.5) * 0.4, ly + 0.18, lz + (Math.random() - 0.5) * 0.4,
				(Math.random() - 0.5) * 1.2 - v.vx * 0.04, 0.45 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2 - v.vz * 0.04,
				0.5 + Math.random() * 0.45, 0.9 + strength * 0.8);
			this.smoke.spawn(rxp + (Math.random() - 0.5) * 0.4, ry + 0.18, rzp + (Math.random() - 0.5) * 0.4,
				(Math.random() - 0.5) * 1.2 - v.vx * 0.04, 0.45 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2 - v.vz * 0.04,
				0.5 + Math.random() * 0.45, 0.9 + strength * 0.8);
		}
		if (this.skidAccum > 0.035) {
			this.skidAccum = 0;
			if (this.skidPrevL) this.skids.add(this.skidPrevL.x, this.skidPrevL.z, lx, lz, ly + 0.012, 0.13);
			if (this.skidPrevR) this.skids.add(this.skidPrevR.x, this.skidPrevR.z, rxp, rzp, ry + 0.012, 0.13);
			this.skidPrevL = { x: lx, z: lz };
			this.skidPrevR = { x: rxp, z: rzp };
		}
	};

	HorizonGame.prototype.resetSkids = function () {
		this.skidPrevL = null; this.skidPrevR = null;
	};

	HorizonGame.prototype.updateActivities = function (dt) {
		var v = this.vehicle;
		if (this.state !== 'driving' && this.state !== 'race') return;
		/* speed traps */
		for (var i = 0; i < this.world.traps.length; i++) {
			var t = this.world.traps[i];
			this.trapCooldown[t.id] = Math.max(0, (this.trapCooldown[t.id] || 0) - dt);
			var d = Math.hypot(v.x - t.x, v.z - t.z);
			if (d < 12 && this.trapCooldown[t.id] <= 0 && v.speed > 16) {
				this.trapCooldown[t.id] = 5;
				var kmh = Math.round(v.speed * 3.6);
				var prev = (this.save.best.traps && this.save.best.traps[t.id]) || 0;
				var record = kmh > prev;
				if (record) { this.save.best.traps[t.id] = kmh; HZ.storeSave(this.save); }
				this.showMessage(HZI18n.t('skill.trap'), t.label + ' · ' + kmh + ' KM/H' + (record ? ' · ' + HZI18n.t('toast.trap') : ''), 2400, record ? 'is-record' : '');
				this.addSkill(90 + Math.max(0, kmh - 140) * 2, null);
				this.audio.beep(760, 0.14, 0.08);
			}
		}
		/* drift zones */
		var inZone = null;
		for (var z = 0; z < this.world.driftZones.length; z++) {
			var zone = this.world.driftZones[z];
			if (Math.hypot(v.x - zone.x, v.z - zone.z) < zone.radius) { inZone = zone; break; }
		}
		if (inZone && Math.abs(v.drift) > 0.14 && v.speed > 8) {
			if (!this.activeZone || this.activeZone !== inZone) {
				this.activeZone = inZone;
				this.zoneScore = 0;
			}
			this.zoneScore += Math.abs(v.drift) * v.speed * dt * 11;
			this.el.zone.hidden = false;
			this.el.zoneLabel.textContent = inZone.label;
			this.el.zoneScore.textContent = HZ.formatInt(Math.round(this.zoneScore));
		} else {
			if (this.activeZone) {
				if (this.zoneScore > 100) {
					var best = this.save.best.drifts[this.activeZone.id] || 0;
					var isRecord = this.zoneScore > best;
					if (isRecord) { this.save.best.drifts[this.activeZone.id] = Math.round(this.zoneScore); HZ.storeSave(this.save); }
					this.showMessage(HZI18n.t('skill.zone'), this.activeZone.label + ' · ' + HZ.formatInt(Math.round(this.zoneScore)) + (isRecord ? ' · ' + HZI18n.t('toast.drift') : ''), 2400, isRecord ? 'is-record' : '');
					this.addSkill(Math.round(this.zoneScore * 0.25), null);
				}
				this.activeZone = null;
				this.zoneScore = 0;
			}
			this.el.zone.hidden = true;
		}
		/* event gate prompts */
		this.promptEvent = null;
		if (!this.race) {
			var bestD = 1e9;
			for (var e = 0; e < this.events.length; e++) {
				var ev = this.events[e];
				var gd = Math.hypot(v.x - ev.gate.x, v.z - ev.gate.z);
				if (gd < 18 && gd < bestD) { bestD = gd; this.promptEvent = ev; }
			}
		}
		if (this.promptEvent) {
			this.el.prompt.hidden = false;
			this.el.promptText.textContent = HZI18n.t('prompt.start', { event: this.promptEvent.name });
		} else if (!this.race) {
			this.el.prompt.hidden = true;
		}
	};

	HorizonGame.prototype.updateTraffic = function (dt, initial) {
		if (!this.traffic) return;
		var visible = this.state === 'menu' || this.state === 'driving' || (this.state === 'race' && !this.race);
		for (var i = 0; i < this.traffic.length; i++) {
			var t = this.traffic[i];
			t.car.group.visible = visible && !this.race;
			if (!t.car.group.visible) continue;
			if (!initial) {
				t.dist += t.speed * t.dir * dt;
				t.dist = HZ.wrap(t.dist, 0, t.road.length);
			}
			var p = this.world.roadPoint(t.road, t.dist, t.lane, {});
			t.car.group.position.set(p.x, p.y + 0.03, p.z);
			t.car.group.rotation.y = p.yaw + (t.dir < 0 ? Math.PI : 0);
			/* near miss / collision only in free roam */
			if (!initial && this.state === 'driving' && !this.race) {
				var d = Math.hypot(this.vehicle.x - p.x, this.vehicle.z - p.z);
				t.near = Math.max(0, t.near - dt);
				if (d < 2.6 && d > 1.45 && t.near <= 0 && this.vehicle.speed > 12) {
					t.near = 4;
					this.addSkill(55, HZI18n.t('skill.nearMiss'));
					this.audio.beep(920, 0.08, 0.05);
				}
				if (d < 1.55 && this.vehicle.speed > 6) {
					var nx = (this.vehicle.x - p.x) / (d || 1);
					var nz = (this.vehicle.z - p.z) / (d || 1);
					this.vehicle.x += nx * 0.8; this.vehicle.z += nz * 0.8;
					this.vehicle.vx *= 0.55; this.vehicle.vz *= 0.55;
					this.shake = Math.min(1.2, this.shake + 0.6);
					this.audio.impact(0.55);
					this.breakChain();
				}
			}
		}
	};

	/* ======================================================================
	   races
	   ====================================================================== */
	HorizonGame.prototype.updateRace = function (dt) {
		var r = this.race;
		if (!r || r.finished) return;
		if (r.phase === 'countdown') {
			r.countdown -= dt;
			var n = Math.ceil(r.countdown);
			if (r.countdown > 0) {
				this.el.countdown.hidden = false;
				this.el.countdown.querySelector('span').textContent = String(n);
				if (n !== r.lastBeep) { r.lastBeep = n; this.audio.countdown(n); }
			} else {
				r.phase = 'running';
				r.lastBeep = -1;
				this.el.countdown.querySelector('span').textContent = 'GO';
				this.audio.countdown(0);
				var self = this;
				global.setTimeout(function () { if (self.el) self.el.countdown.hidden = true; }, 800);
				if (r.event.checkpoints[0]) r.event.checkpoints[0].mesh.visible = true;
			}
			return;
		}
		if (this.paused || this.helpOpen) return;
		r.elapsed += dt;
		/* progress on route */
		var proj = this.projectRoute(this.vehicle.x, this.vehicle.z, r.playerIndex);
		r.playerIndex = proj.index;
		r.playerDist = proj.d;
		/* opponent positions */
		for (var i = 0; i < this.rivals.length; i++) {
			var rv = this.rivals[i];
			if (rv.finishTime != null) continue;
			var ahead = this.world.roadPoint(r.event.road, r.event.startDist + rv.s + 24, 0, {});
			var ahead2 = this.world.roadPoint(r.event.road, r.event.startDist + rv.s + 82, 0, {});
			var turn = Math.abs(angleDiff(ahead.yaw, ahead2.yaw));
			var target = r.event.rivalPace * rv.paceMod * (1 - clamp(turn / 1.5, 0, 1) * 0.48);
			rv.speed = damp(rv.speed, target, 1.6, dt);
			rv.s += rv.speed * dt;
			if (rv.s >= r.event.length) {
				rv.s = r.event.length;
				rv.finishTime = r.elapsed;
			}
			var rp = this.world.roadPoint(r.event.road, r.event.startDist + rv.s, rv.lateral, {});
			rv.car.group.position.set(rp.x, rp.y + 0.05, rp.z);
			rv.car.group.rotation.set(0, rp.yaw, 0);
			var spin = rv.speed / 0.35 * dt;
			for (var w = 0; w < rv.car.wheels.length; w++) rv.car.wheels[w].spin.rotation.x += spin;
			/* soft contact with the player */
			var pd = Math.hypot(this.vehicle.x - rp.x, this.vehicle.z - rp.z);
			if (pd < 2.2 && pd > 0.001) {
				var nx = (this.vehicle.x - rp.x) / pd, nz = (this.vehicle.z - rp.z) / pd;
				this.vehicle.x += nx * (2.2 - pd) * 0.5;
				this.vehicle.z += nz * (2.2 - pd) * 0.5;
			}
		}
		/* rank */
		var aheadCount = 0;
		for (var j = 0; j < this.rivals.length; j++) {
			var rr = this.rivals[j];
			if (rr.finishTime != null || rr.s > r.playerDist + 1) aheadCount++;
		}
		r.position = 1 + aheadCount;
		/* checkpoints */
		var ev = r.event;
		if (r.cpIndex < ev.checkpoints.length) {
			var cp = ev.checkpoints[r.cpIndex];
			if (Math.hypot(this.vehicle.x - cp.x, this.vehicle.z - cp.z) < 23) {
				r.cpIndex++;
				if (r.cpIndex >= ev.checkpoints.length) {
					this.finishRace();
				} else {
					this.audio.beep(680, 0.1, 0.07);
					this.toast('CHECKPOINT ' + r.cpIndex + '/' + ev.checkpoints.length, 'is-cp', 1500);
					this.updateRaceGateVisibility();
				}
			}
		}
		/* wrong way / off route warning */
		if (proj.dist > 90 && r.phase === 'running') {
			this.el.message.classList.add('is-warn');
		} else if (this.el.message) {
			this.el.message.classList.remove('is-warn');
		}
	};

	HorizonGame.prototype.projectRoute = function (x, z, hint) {
		var pts = this.race.route;
		var n = pts.length;
		var best = Infinity, bi = 0;
		var self = this;
		function scan(from, to) {
			for (var i = from; i <= to; i++) {
				var dx = x - pts[i].x, dz = z - pts[i].z;
				var d = dx * dx + dz * dz;
				if (d < best) { best = d; bi = i; }
			}
		}
		var from = Math.max(0, hint - 90), to = Math.min(n - 1, hint + 90);
		scan(from, to);
		if (best > 3600) { best = Infinity; scan(0, n - 1); }
		return { index: bi, d: pts[bi].d, dist: Math.sqrt(best) };
	};

	HorizonGame.prototype.resetVehicle = function (raceReset) {
		var v = this.vehicle;
		var p = null;
		if (raceReset && this.race && this.race.event) {
			var ev = this.race.event;
			if (this.race.cpIndex > 0) {
				var cp = ev.checkpoints[Math.min(this.race.cpIndex - 1, ev.checkpoints.length - 1)];
				if (cp) p = { x: cp.x, z: cp.z, y: cp.y, yaw: cp.yaw };
			} else {
				p = this.world.roadPoint(ev.road, ev.startDist, 0, {});
			}
		}
		if (!p) {
			var near = this.world.nearroad(v.x, v.z);
			if (near && near.sample) {
				var s = near.sample;
				p = { x: s.x, z: s.z, y: s.y, yaw: Math.atan2(s.tx, s.tz) };
			} else {
				p = this.world.spawn;
			}
		}
		v.x = p.x; v.z = p.z; v.yaw = p.yaw;
		v.y = this.groundAt(p.x, p.z) + 0.04;
		v.vx = 0; v.vz = 0; v.vy = 0; v.vLong = 0; v.vLat = 0; v.speed = 0;
		v.airborne = false; v.airTime = 0; v.lastRampInfo = null; v.prevGroundY = null;
		v.steer = 0; v.rpm = 900; v.gear = 0; v.pitch = 0; v.roll = 0;
		this.waterTime = 0;
		this.resetSkids();
		this.shake = 0;
		this.audio.beep(420, 0.16, 0.06);
		this.showMessage(HZI18n.t('toast.reset'), '', 1200);
		this.applyCameraImmediate();
		this.syncPlayerCar(0);
	};

	/* ======================================================================
	   camera
	   ====================================================================== */
	HorizonGame.prototype.cycleCamera = function () {
		this.camMode = (this.camMode + 1) % 3;
		this.settings.camera = this.camMode;
		HZ.storeSave(this.save);
		this.syncSeg(this.el.cameraSeg, String(this.camMode));
		this.toast(this.camMode === 0 ? 'CHASE CAMERA' : (this.camMode === 1 ? 'HOOD CAMERA' : 'BUMPER CAMERA'), 'is-ui', 1000);
	};

	HorizonGame.prototype.applyCameraImmediate = function () {
		var v = this.vehicle;
		if (this.state === 'menu') {
			this.camPos.set(v.x + Math.sin(this.camOrbit) * 9.4, v.y + 3.0, v.z + Math.cos(this.camOrbit) * 9.4);
			this.camera.position.copy(this.camPos);
			this.camera.lookAt(v.x, v.y + 0.95, v.z);
			this.camera.fov = 52;
			this.camera.updateProjectionMatrix();
			return;
		}
		var fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
		if (this.camMode === 0) {
			this.camPos.set(v.x - fx * 7.4, v.y + 2.5, v.z - fz * 7.4);
		} else if (this.camMode === 1) {
			this.camPos.set(v.x + fx * 0.35, v.y + 1.18, v.z + fz * 0.35);
		} else {
			this.camPos.set(v.x + fx * 2.15, v.y + 0.72, v.z + fz * 2.15);
		}
		this.camera.position.copy(this.camPos);
		this.camLook.set(v.x + fx * 9, v.y + 1.15, v.z + fz * 9);
		this.camera.lookAt(this.camLook);
		this.camera.fov = this.camMode === 0 ? 62 : 70;
		this.camera.updateProjectionMatrix();
	};

	HorizonGame.prototype.updateCamera = function (dt) {
		var v = this.vehicle;
		if (this.state === 'menu') {
			this.camOrbit += dt * 0.075;
			this.camPos.set(v.x + Math.sin(this.camOrbit) * 9.4, v.y + 3.0 + Math.sin(this.time * 0.4) * 0.3, v.z + Math.cos(this.camOrbit) * 9.4);
			this.camera.position.lerp(this.camPos, 1 - Math.exp(-3 * dt));
			this.camLook.set(v.x, v.y + 0.95, v.z);
			this.camera.lookAt(this.camLook);
			this.camera.fov = damp(this.camera.fov, 52, 3, dt);
			this.camera.updateProjectionMatrix();
			return;
		}
		var fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
		var rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
		var speed = v.speed;
		if (this.camMode === 0) {
			var back = 7.2 + clamp(speed * 0.022, 0, 2.6);
			var desiredX = v.x - fx * back;
			var desiredZ = v.z - fz * back;
			var desiredY = v.y + 2.55 + clamp(speed * 0.006, 0, 0.5);
			this.camPos.x = damp(this.camPos.x, desiredX, 7.5, dt);
			this.camPos.z = damp(this.camPos.z, desiredZ, 7.5, dt);
			this.camPos.y = damp(this.camPos.y, desiredY, 6.5, dt);
			var lookYaw = v.yaw + clamp(angleDiff(v.yaw, Math.atan2(v.vx, v.vz)), -0.5, 0.5) * 0.14;
			var lx = Math.sin(lookYaw), lz = Math.cos(lookYaw);
			this.camLook.x = damp(this.camLook.x, v.x + lx * 10, 12, dt);
			this.camLook.y = damp(this.camLook.y, v.y + 1.15, 10, dt);
			this.camLook.z = damp(this.camLook.z, v.z + lz * 10, 12, dt);
			this.camera.position.copy(this.camPos);
			if (this.shake > 0.001) {
				this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.55;
				this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.35;
			}
			this.camera.lookAt(this.camLook);
			this.camera.rotation.z += -v.roll * 0.32;
			this.camera.fov = damp(this.camera.fov, 60 + clamp(speed / 80, 0, 1) * 18, 4, dt);
			this.camera.updateProjectionMatrix();
		} else if (this.camMode === 1) {
			this.camera.position.set(v.x + fx * 0.35 + (Math.random() - 0.5) * this.shake * 0.14, v.y + 1.18, v.z + fz * 0.35);
			this.camera.lookAt(v.x + fx * 25, v.y + 1.25, v.z + fz * 25);
			this.camera.fov = damp(this.camera.fov, 70 + clamp(speed / 80, 0, 1) * 12, 5, dt);
			this.camera.updateProjectionMatrix();
		} else {
			this.camera.position.set(v.x + fx * 2.18, v.y + 0.72, v.z + fz * 2.18);
			this.camera.lookAt(v.x + fx * 30, v.y + 0.9, v.z + fz * 30);
			this.camera.fov = damp(this.camera.fov, 74 + clamp(speed / 80, 0, 1) * 12, 5, dt);
			this.camera.updateProjectionMatrix();
		}
	};

	/* ======================================================================
	   audio / radio
	   ====================================================================== */
	HorizonGame.prototype.audioTick = function (dt) {
		if (!this.audio || !this.audio.context) return;
		var v = this.vehicle;
		var running = (this.state === 'driving' || this.state === 'race') && !this.paused && !this.helpOpen;
		var slip = clamp(Math.abs(v.drift) * 2.1 + (this.input.handbrake && v.speed > 6 ? 0.5 : 0), 0, 1);
		this.audio.update({
			running: running,
			rpm: v.rpm,
			throttle: this.input.throttle,
			speed: v.speed,
			slip: slip,
			offroad: v.offroad
		});
		this.trackTimer -= dt;
		if (this.trackTimer <= 0) {
			this.trackTimer = 32;
			this.trackIndex = (this.trackIndex + 1) % 4;
			if (this.el.radioTrack) this.el.radioTrack.textContent = HZI18n.t('radio.track' + (this.trackIndex + 1));
		}
	};

	/* ======================================================================
	   input
	   ====================================================================== */
	HorizonGame.prototype.bindInput = function () {
		var self = this;
		this.onKeyDownBound = function (e) { self.onKeyDown(e); };
		this.onKeyUpBound = function (e) { self.onKeyUp(e); };
		this.onResizeBound = function () { self.resize(); };
		this.onBlurBound = function () { self.clearInput(); };
		this.onVisibilityBound = function () {
			if (doc.hidden && (self.state === 'driving' || self.state === 'race') && !self.paused && !self.helpOpen) self.pauseGame();
		};
		doc.addEventListener('keydown', this.onKeyDownBound);
		doc.addEventListener('keyup', this.onKeyUpBound);
		global.addEventListener('resize', this.onResizeBound);
		global.addEventListener('blur', this.onBlurBound);
		doc.addEventListener('visibilitychange', this.onVisibilityBound);

		var touchButtons = qa(this.host, '[data-hz-touch-steer]');
		touchButtons.forEach(function (btn) {
			var dir = parseFloat(btn.getAttribute('data-hz-touch-steer'));
			var down = function (e) { e.preventDefault(); self.touch.steer = dir; btn.classList.add('is-down'); };
			var up = function (e) { e.preventDefault(); if (self.touch.steer === dir) self.touch.steer = 0; btn.classList.remove('is-down'); };
			btn.addEventListener('pointerdown', down);
			btn.addEventListener('pointerup', up);
			btn.addEventListener('pointercancel', up);
			btn.addEventListener('pointerleave', up);
		});
		function pedal(sel, key, val) {
			var btn = q(self.host, sel);
			if (!btn) return;
			var down = function (e) { e.preventDefault(); self.touch[key] = val; btn.classList.add('is-down'); };
			var up = function (e) { e.preventDefault(); self.touch[key] = false; btn.classList.remove('is-down'); };
			btn.addEventListener('pointerdown', down);
			btn.addEventListener('pointerup', up);
			btn.addEventListener('pointercancel', up);
			btn.addEventListener('pointerleave', up);
		}
		pedal('[data-hz-touch-throttle]', 'throttle', true);
		pedal('[data-hz-touch-brake]', 'brake', true);
		pedal('[data-hz-touch-hand]', 'hand', true);
	};

	HorizonGame.prototype.onKeyDown = function (e) {
		var c = e.code;
		if (this.helpOpen && c !== 'KeyH' && c !== 'Escape') return;
		if (this.state === 'menu') {
			if (c === 'Enter' && !this.el.menu.hidden) { e.preventDefault(); this.startDrive(); }
			return;
		}
		if (this.state !== 'driving' && this.state !== 'race') return;
		if (c === 'Escape') {
			e.preventDefault();
			if (this.helpOpen) this.closeHelp();
			else this.togglePause();
			return;
		}
		if (c === 'KeyH') { e.preventDefault(); this.openHelp(); return; }
		if (c === 'KeyC') { e.preventDefault(); this.cycleCamera(); return; }
		if (c === 'KeyR') { e.preventDefault(); this.resetVehicle(this.state === 'race'); return; }
		if (c === 'KeyE') {
			e.preventDefault();
			if (this.promptEvent && !this.race) this.startEvent(this.promptEvent.id);
			return;
		}
		if (c === 'KeyM') { e.preventDefault(); this.toggleMute(); return; }
		if (c === 'KeyT') { e.preventDefault(); this.toggleRadio(); return; }
		if (c === 'Space' || c.indexOf('Arrow') === 0) e.preventDefault();
		this.keys[c] = true;
	};
	HorizonGame.prototype.onKeyUp = function (e) {
		this.keys[e.code] = false;
		if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) {
			if (this.state === 'driving' || this.state === 'race') e.preventDefault();
		}
	};
	HorizonGame.prototype.clearInput = function () {
		this.keys = Object.create(null);
		this.touch.steer = 0;
		this.touch.throttle = false;
		this.touch.brake = false;
		this.touch.hand = false;
		this.input.throttle = 0; this.input.brake = 0; this.input.steer = 0; this.input.handbrake = false;
	};

	HorizonGame.prototype.toggleMute = function () {
		this.muted = !this.muted;
		if (this.audio) this.audio.setEnabled(!this.muted);
		this.toast(this.muted ? HZI18n.t('toast.muted') : 'AUDIO ON', 'is-ui', 1500);
	};
	HorizonGame.prototype.toggleRadio = function () {
		this.music = !this.music;
		this.settings.music = this.music;
		if (this.audio) this.audio.setMusic(this.music);
		this.syncToggle(this.el.musicBtn, this.music);
		this.el.radio.classList.toggle('is-off', !this.music);
		this.toast(HZI18n.t('toast.radio', { state: this.music ? 'ON' : 'OFF' }), 'is-ui', 1600);
		HZ.storeSave(this.save);
	};

	/* ======================================================================
	   UI bindings
	   ====================================================================== */
	HorizonGame.prototype.bindUI = function () {
		var self = this;
		var h = this.host;
		function on(sel, ev, fn) {
			var el = q(h, sel);
			if (el) { el.addEventListener(ev, fn); self._handlers.push([el, ev, fn]); }
			return el;
		}
		on('[data-hz-drive]', 'click', function () { self.startDrive(); });
		on('[data-hz-events]', 'click', function () { self.showPanel('events'); });
		on('[data-hz-garage]', 'click', function () { self.showPanel('garage'); });
		on('[data-hz-settings]', 'click', function () { self.showPanel('settings'); });
		on('[data-hz-exit]', 'click', function () { self.exitToGames(); });
		on('[data-hz-lang]', 'change', function (e) { self.setLanguage(e.target.value); });
		on('[data-hz-lang2]', 'change', function (e) { self.setLanguage(e.target.value); });
		on('[data-hz-help-close]', 'click', function () { self.closeHelp(); });
		on('[data-hz-resume]', 'click', function () { self.resumeGame(); });
		on('[data-hz-pause-reset]', 'click', function () { self.resumeGame(); self.resetVehicle(self.state === 'race'); });
		on('[data-hz-pause-settings]', 'click', function () {
			var st = self.state;
			self.el.pause.hidden = true;
			self.suspendState = st;
			self.menuFromPause = true;
			self.paused = false;
			self.el.hud.hidden = true;
			self.el.menu.hidden = false;
			self.state = 'menu';
			self.host.dataset.state = 'menu';
			self.el.touch.hidden = true;
			self.showPanel('settings');
			self.applyCameraImmediate();
		});
		on('[data-hz-pause-menu]', 'click', function () {
			self.el.pause.hidden = true;
			self.cleanupRace();
			self.el.hud.hidden = true;
			self.el.menu.hidden = false;
			self.state = 'menu';
			self.host.dataset.state = 'menu';
			self.el.touch.hidden = true;
			self.suspendState = null;
			self.menuFromPause = false;
			self.showPanel('events');
			self.refreshEventList();
			self.applyCameraImmediate();
		});
		on('[data-hz-pause-exit]', 'click', function () { self.exitToGames(); });

		on('[data-hz-result-restart]', 'click', function () { self.restartRace(); });
		on('[data-hz-result-free]', 'click', function () { self.endRaceToFree(); });
		on('[data-hz-result-events]', 'click', function () { self.raceResultsToMenu(); });

		var eventList = this.el.eventList;
		if (eventList) {
			var handler = function (e) {
				var btn = e.target.closest ? e.target.closest('[data-event-start]') : null;
				var card = e.target.closest ? e.target.closest('[data-event]') : null;
				var id = btn ? btn.getAttribute('data-event-start') : (card ? card.getAttribute('data-event') : null);
				if (id) { e.preventDefault(); self.startEvent(id); }
			};
			eventList.addEventListener('click', handler);
			this._handlers.push([eventList, 'click', handler]);
		}
		var paint = this.el.paint;
		if (paint) {
			var paintHandler = function (e) {
				var btn = e.target.closest ? e.target.closest('[data-paint]') : null;
				if (!btn) return;
				var idx = parseInt(btn.getAttribute('data-paint'), 10) || 0;
				self.save.paint = idx;
				HZ.storeSave(self.save);
				if (self.playerCar) self.playerCar.setPaint(HZ.Car.palette[idx].color);
				self.refreshGarage();
				self.audio.playClick();
			};
			paint.addEventListener('click', paintHandler);
			this._handlers.push([paint, 'click', paintHandler]);
		}

		/* segmented settings */
		this.bindSeg(this.el.quality, function (value) { self.setQuality(value); });
		this.bindSeg(this.el.cameraSeg, function (value) { self.setCamera(parseInt(value, 10)); });
		this.bindSeg(this.el.unitsSeg, function (value) { self.setUnits(value); });

		if (this.el.volume) {
			this.el.volume.value = String(Math.round(this.settings.volume * 100));
			var volHandler = function () {
				var v = clamp(parseFloat(self.el.volume.value) / 100, 0, 1);
				self.settings.volume = v;
				self.el.volumeValue.textContent = Math.round(v * 100) + '%';
				if (self.audio) self.audio.setVolume(v);
				HZ.storeSave(self.save);
			};
			this.el.volume.addEventListener('input', volHandler);
			this._handlers.push([this.el.volume, 'input', volHandler]);
		}
		on('[data-hz-music]', 'click', function () { self.toggleRadio(); });
		on('[data-hz-motion]', 'click', function () {
			self.settings.motion = self.settings.motion === false;
			self.syncToggle(self.el.motionBtn, self.settings.motion !== false);
			HZ.storeSave(self.save);
		});

		var exitHandler = function (e) { if (e.target.closest && e.target.closest('button')) { self.audio.init(); self.audio.playClick(); } };
		h.addEventListener('click', exitHandler);
		this._handlers.push([h, 'click', exitHandler]);

		this.onLangBound = function () { self.onLanguageEvent(); };
		doc.addEventListener('hz:lang', this.onLangBound);
		this.onI18nBound = function () { self.syncWithSiteLocale(); };
		doc.addEventListener('i18n:applied', this.onI18nBound);
	};

	HorizonGame.prototype.bindSeg = function (root, cb) {
		if (!root) return;
		var self = this;
		var handler = function (e) {
			var btn = e.target.closest ? e.target.closest('button[data-value]') : null;
			if (!btn) return;
			qa(root, 'button[data-value]').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
			cb(btn.getAttribute('data-value'));
		};
		root.addEventListener('click', handler);
		this._handlers.push([root, 'click', handler]);
	};

	HorizonGame.prototype.syncSeg = function (root, value) {
		if (!root) return;
		qa(root, 'button[data-value]').forEach(function (b) {
			b.classList.toggle('is-active', b.getAttribute('data-value') === String(value));
		});
	};
	HorizonGame.prototype.syncToggle = function (btn, on) {
		if (!btn) return;
		btn.classList.toggle('is-on', !!on);
		btn.setAttribute('aria-pressed', on ? 'true' : 'false');
		var span = btn.querySelector('span');
		if (span) span.textContent = HZI18n.t(on ? 'settings.on' : 'settings.off');
	};
	HorizonGame.prototype.syncAllUi = function () {
		if (!this.el) return;
		if (this.el.lang) this.el.lang.value = HZI18n.getLocale();
		if (this.el.lang2) this.el.lang2.value = HZI18n.getLocale();
		this.syncSeg(this.el.quality, this.settings.quality);
		this.syncSeg(this.el.cameraSeg, this.settings.camera);
		this.syncSeg(this.el.unitsSeg, this.settings.units);
		if (this.el.volume) this.el.volume.value = String(Math.round(this.settings.volume * 100));
		if (this.el.volumeValue) this.el.volumeValue.textContent = Math.round(this.settings.volume * 100) + '%';
		this.syncToggle(this.el.musicBtn, this.music);
		this.syncToggle(this.el.motionBtn, this.settings.motion !== false);
		if (this.el.units) this.el.units.textContent = HZI18n.t(this.settings.units === 'imperial' ? 'units.mph' : 'units.kmh');
		if (this.el.radio) this.el.radio.classList.toggle('is-off', !this.music);
		this.refreshGarage();
	};

	HorizonGame.prototype.setLanguage = function (loc) {
		HZI18n.setLocale(loc, { root: this.host });
		this.settings.lang = HZI18n.getLocale();
		HZ.storeSave(this.save);
		this.syncAllUi();
		this.refreshEventList();
		if (this.race) this.el.raceName.textContent = HZI18n.t(this.race.event.nameKey);
		this.refreshGarage();
		if (global.i18n && typeof global.i18n.setLocale === 'function' && global.i18n.getLocale && global.i18n.getLocale() !== HZI18n.getLocale()) {
			try { global.i18n.setLocale(HZI18n.getLocale()); } catch (e) { /* ignore */ }
		}
	};
	HorizonGame.prototype.onLanguageEvent = function () {
		this.syncAllUi();
		this.refreshEventList();
	};
	HorizonGame.prototype.syncWithSiteLocale = function () {
		if (!global.i18n || typeof global.i18n.getLocale !== 'function') return;
		var site = HZI18n.normalize(global.i18n.getLocale());
		if (site !== HZI18n.getLocale()) {
			HZI18n.setLocale(site, { root: this.host });
			this.settings.lang = site;
			HZ.storeSave(this.save);
			this.syncAllUi();
			this.refreshEventList();
		}
	};

	HorizonGame.prototype.setQuality = function (quality) {
		if (['low', 'balanced', 'high'].indexOf(quality) < 0) return;
		this.settings.quality = quality;
		this.renderer.setPixelRatio(this.pixelRatio(quality));
		this.resize();
		var sun = this.world && this.world.sun;
		if (sun) {
			var size = quality === 'high' ? 2048 : 1536;
			sun.castShadow = quality !== 'low';
			if (sun.shadow.mapSize.x !== size) {
				sun.shadow.mapSize.set(size, size);
				if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
			}
		}
		this.renderer.shadowMap.enabled = quality !== 'low';
		this.syncSeg(this.el.quality, quality);
		HZ.storeSave(this.save);
		this.toast(HZI18n.t('toast.quality', { quality: quality.toUpperCase() }), 'is-ui', 1500);
	};
	HorizonGame.prototype.pixelRatio = function (quality) {
		var dpr = global.devicePixelRatio || 1;
		if (quality === 'low') return 1;
		if (quality === 'high') return Math.min(dpr, 2);
		return Math.min(dpr, 1.35);
	};
	HorizonGame.prototype.setCamera = function (mode) {
		this.camMode = clamp(mode || 0, 0, 2);
		this.settings.camera = this.camMode;
		this.syncSeg(this.el.cameraSeg, String(this.camMode));
		HZ.storeSave(this.save);
		this.applyCameraImmediate();
	};
	HorizonGame.prototype.setUnits = function (units) {
		this.settings.units = units === 'imperial' ? 'imperial' : 'metric';
		this.syncSeg(this.el.unitsSeg, this.settings.units);
		this.updateHud(0);
		HZ.storeSave(this.save);
	};
	HorizonGame.prototype.applySettings = function (save) {
		this.syncAllUi();
		if (save !== false) HZ.storeSave(this.save);
		if (this.audio) this.audio.setVolume(this.settings.volume);
	};

	HorizonGame.prototype.exitToGames = function () {
		this.audio.playClick();
		if (this.el && this.el.fade) this.el.fade.classList.add('is-on');
		global.setTimeout(function () { global.location.hash = '#/games'; }, 160);
	};

	/* ======================================================================
	   loop
	   ====================================================================== */
	HorizonGame.prototype.startLoop = function () {
		var self = this;
		this.lastTime = performance.now();
		function loop(now) {
			if (self.state === 'destroyed') return;
			var dt = Math.min(0.05, Math.max(0.0001, (now - self.lastTime) / 1000));
			self.lastTime = now;
			self.time += dt;
			self.frameNo++;
			self.frameAcc += dt; self.frameCount++;
			if (self.frameAcc > 0.5) { self.fps = self.frameCount / self.frameAcc; self.frameAcc = 0; self.frameCount = 0; }
			if (!self.paused && !self.helpOpen) {
				if (self.state === 'driving' || self.state === 'race') {
					self.updateVehicle(dt);
				} else if (self.state === 'menu') {
					self.updateTraffic(dt, false);
					self.syncPlayerCar(dt);
				}
				self.updateCamera(dt);
			}
			if (self.world) {
				self.world.update(dt, self.time, self.camera.position);
				if (self.world.sun) {
					var target = self.vehicle;
					self.world.sun.position.set(target.x + self.world.sunDir.x * 260, target.y + 160, target.z + self.world.sunDir.z * 260);
					self.world.sun.target.position.set(target.x, target.y, target.z);
					self.world.sun.target.updateMatrixWorld();
				}
			}
			if (self.smoke) self.smoke.update(dt);
			self.readInputs();
			self.audioTick(dt);
			if (self.time - self.lastHud > 0.055) {
				self.lastHud = self.time;
				self.updateHud(dt);
			}
			if (self.time - self.lastMap > 0.09) {
				self.lastMap = self.time;
				if (self.state !== 'menu') self.drawMinimap();
			}
			self.render();
			self.raf = global.requestAnimationFrame(loop);
		}
		this.raf = global.requestAnimationFrame(loop);
	};

	HorizonGame.prototype.render = function () {
		if (!this.renderer || !this.scene || !this.camera) return;
		this.renderer.render(this.scene, this.camera);
	};

	HorizonGame.prototype.resize = function () {
		if (!this.renderer) return;
		var w = global.innerWidth, h = global.innerHeight;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / Math.max(1, h);
		this.camera.updateProjectionMatrix();
	};

	HorizonGame.prototype.placeCameraImmediate = HorizonGame.prototype.applyCameraImmediate;

	/* ======================================================================
	   mounting
	   ====================================================================== */
	HorizonGame.prototype.destroy = function () {
		this.state = 'destroyed';
		if (this.raf) global.cancelAnimationFrame(this.raf);
		if (this.onKeyDownBound) doc.removeEventListener('keydown', this.onKeyDownBound);
		if (this.onKeyUpBound) doc.removeEventListener('keyup', this.onKeyUpBound);
		if (this.onResizeBound) global.removeEventListener('resize', this.onResizeBound);
		if (this.onBlurBound) global.removeEventListener('blur', this.onBlurBound);
		if (this.onVisibilityBound) doc.removeEventListener('visibilitychange', this.onVisibilityBound);
		if (this.onLangBound) doc.removeEventListener('hz:lang', this.onLangBound);
		if (this.onI18nBound) doc.removeEventListener('i18n:applied', this.onI18nBound);
		(this._handlers || []).forEach(function (h) { h[0].removeEventListener(h[1], h[2]); });
		this._handlers = [];
		if (this.audio) { try { this.audio.dispose(); } catch (e) { /* ignore */ } }
		if (this.renderer) {
			try {
				this.scene.traverse(function (obj) {
					if (obj.geometry) obj.geometry.dispose();
					if (obj.material) {
						if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose(); });
						else obj.material.dispose();
					}
				});
				this.renderer.dispose();
			} catch (e) { /* ignore */ }
		}
		doc.documentElement.classList.remove('hz-lock');
	};

	var current = null;

	function destroyCurrent() {
		if (current) {
			try { current.destroy(); } catch (e) { console.warn('[horizon] destroy failed', e); }
			current = null;
		}
	}

	function mountAll(scope) {
		var host = (scope || doc).querySelector('[data-hz]');
		if (!host && scope && scope.matches && scope.matches('[data-hz]')) host = scope;
		if (!host) return null;
		if (current && current.host === host) return current;
		destroyCurrent();
		if (!THREE || !HZ || !HZI18n) {
			var hint = host.querySelector('[data-hz-loading-hint]');
			if (hint) hint.textContent = 'THREE.JS OR HORIZON CONTENT FAILED TO LOAD';
			return null;
		}
		doc.documentElement.classList.add('hz-lock');
		doc.documentElement.setAttribute('data-hz-active', '1');
		current = new HorizonGame(host);
		current.init();
		return current;
	}

	doc.addEventListener('route:changed', function (ev) {
		var route = ev.detail && ev.detail.route;
		if (route !== ROUTE && current) destroyCurrent();
	});

	global.Horizon = {
		__real: true,
		mountAll: mountAll,
		destroy: destroyCurrent,
		active: function () { return !!current; },
		get game() { return current; },
		debug: {
			state: function () {
				if (!current) return null;
				var v = current.vehicle;
				return {
					state: current.state, paused: current.paused, helpOpen: current.helpOpen,
					frameNo: current.frameNo, time: current.time,
					keys: Object.keys(current.keys).filter(function (k) { return current.keys[k]; }),
					input: { throttle: current.input.throttle, brake: current.input.brake, steer: current.input.steer, handbrake: current.input.handbrake },
					race: current.race ? {
						id: current.race.event.id, phase: current.race.phase, countdown: current.race.countdown, elapsed: current.race.elapsed,
						cp: current.race.cpIndex, position: current.race.position, finished: current.race.finished
					} : null,
					car: { x: v.x, z: v.z, y: v.y, yaw: v.yaw, speed: v.speed, vLong: v.vLong, vLat: v.vLat, vy: v.vy, airborne: v.airborne, airTime: v.airTime, gear: v.gear, rpm: v.rpm },
					skill: { live: current.skill.live, total: current.skill.total, mult: current.skill.mult },
					fps: current.fps, error: current.lastError
				};
			},
			drive: function () { if (current) current.startDrive(); return current ? current.state : null; },
			event: function (id) { if (current) current.startEvent(id); return current ? current.state : null; },
			teleport: function (x, z, yaw) {
				if (!current) return null;
				var v = current.vehicle;
				v.x = x; v.z = z; v.y = current.groundAt(x, z) + 0.04;
				if (yaw != null) v.yaw = yaw;
				v.vx = 0; v.vz = 0; v.vy = 0; v.speed = 0;
				v.airborne = false; v.airTime = 0; v.lastRampInfo = null; v.prevGroundY = null;
				current.syncPlayerCar(0);
				current.applyCameraImmediate();
				return { x: current.vehicle.x, z: current.vehicle.z, y: current.vehicle.y };
			},
			quality: function (q) { if (current) current.setQuality(q); },
			menu: function () { if (current) current.showMenu({}); },
			step: function (seconds) {
				if (!current) return null;
				var steps = Math.max(1, Math.min(3600, Math.round((seconds || 1) * 60)));
				for (var i = 0; i < steps; i++) {
					current.time += 1 / 60;
					if (current.state === 'driving' || current.state === 'race') current.updateVehicle(1 / 60);
					current.updateCamera(1 / 60);
					if (current.world) current.world.update(1 / 60, current.time, current.camera.position);
				}
				if (current.smoke) current.smoke.update(1 / 60);
				current.updateHud(0.016);
				current.drawMinimap();
				current.syncPlayerCar(0);
				current.render();
				return { state: current.state, frame: current.frameNo, time: current.time };
			},
			teleportRoad: function (roadId, dist, lateral, yawOffset) {
				if (!current) return null;
				var road = current.world.roads[roadId];
				if (!road) return null;
				var p = current.world.roadPoint(road, dist, lateral || 0, {});
				var v = current.vehicle;
				v.x = p.x; v.z = p.z; v.y = p.y + 0.12;
				v.yaw = p.yaw + (yawOffset || 0);
				v.y = current.groundAt(p.x, p.z) + 0.04;
				v.vx = 0; v.vz = 0; v.vy = 0; v.vLong = 0; v.vLat = 0; v.speed = 0;
				v.airborne = false; v.airTime = 0; v.lastRampInfo = null; v.prevGroundY = null;
				v.steer = 0; v.pitch = 0; v.roll = 0;
				current.resetSkids();
				current.applyCameraImmediate();
				current.syncPlayerCar(0);
				return { x: v.x, z: v.z, y: v.y, yaw: v.yaw, road: roadId, dist: dist };
			},
			lastError: function () { return current ? current.lastError : null; },
			screenshot: function () { return current && current.renderer ? current.renderer.info.render : null; }
		}
	};
})(window);
