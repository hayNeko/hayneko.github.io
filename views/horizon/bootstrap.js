/**
 * views/horizon/bootstrap.js — lazy loader for HAYNEKO HORIZON
 *
 * The game is ~170 KB of JS (Three.js, world, car, audio and runtime). It is
 * only fetched when #/horizon opens, so every other page keeps its weight.
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var ASSETS = [
		'views/horizon/vendor/three.min.js',
		'views/horizon/core.js',
		'views/horizon/i18n.js',
		'views/horizon/world.js',
		'views/horizon/car.js',
		'views/horizon/audio.js',
		'views/horizon/game.js'
	];
	var loading = false;
	var pendingHost = null;
	var callbacks = [];
	var failed = false;
	var watcher = null;

	function setHint(text) {
		if (!pendingHost) return;
		var hint = pendingHost.querySelector('[data-hz-loading-hint]');
		if (hint) hint.textContent = text;
	}

	function loadScript(src, next) {
		var s = doc.createElement('script');
		s.src = src;
		s.async = false;
		s.onload = next;
		s.onerror = function () {
			failed = true;
			setHint('FAILED TO LOAD ' + src.split('/').pop().toUpperCase());
			console.error('[horizon] failed to load', src);
		};
		doc.head.appendChild(s);
	}

	function loadAll() {
		if (realApi()) return;
		var i = 0;
		function step() {
			if (failed) return;
			if (i >= ASSETS.length) {
				loading = false;
				callbacks.splice(0).forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } });
				return;
			}
			loadScript(ASSETS[i++], step);
		}
		step();
	}

	function realApi() {
		var api = global.Horizon;
		return api && api.__real ? api : null;
	}

	function watch() {
		if (failed) { stopWatch(); return; }
		var real = realApi();
		if (!real) return;
		stopWatch();
		if (!pendingHost) return;
		var host = pendingHost;
		pendingHost = null;
		if (!host.isConnected) return;
		try { real.mountAll(host); } catch (e) { console.error('[horizon] mount failed', e); }
	}

	function stopWatch() {
		if (watcher) { clearInterval(watcher); watcher = null; }
	}

	var API = {};
	API.mountAll = function (scope) {
		var host = (scope || doc).querySelector('[data-hz]');
		if (!host) return null;
		var real = realApi();
		if (real) return real.mountAll(host);
		pendingHost = host;
		setHint('LOADING THE COAST');
		callbacks.push(function () {
			var real2 = realApi();
			if (real2) real2.mountAll(host);
		});
		if (!watcher) watcher = global.setInterval(watch, 160);
		if (!loading && !failed) {
			loading = true;
			loadAll();
		}
		return null;
	};

	API.destroy = function () {
		var real = realApi();
		if (real && real.destroy) real.destroy();
		pendingHost = null;
	};

	API.active = function () {
		var real = realApi();
		return !!(real && real.active && real.active());
	};

	API.debug = {
		state: function () { var r = realApi(); return r && r.debug ? r.debug.state() : null; },
		drive: function () { var r = realApi(); return r && r.debug ? r.debug.drive() : null; },
		event: function (id) { var r = realApi(); return r && r.debug ? r.debug.event(id) : null; },
		teleport: function (x, z, yaw) { var r = realApi(); return r && r.debug ? r.debug.teleport(x, z, yaw) : null; },
		quality: function (q) { var r = realApi(); return r && r.debug ? r.debug.quality(q) : null; },
		menu: function () { var r = realApi(); return r && r.debug ? r.debug.menu() : null; },
		lastError: function () { var r = realApi(); return r && r.debug ? r.debug.lastError() : null; }
	};

	Object.defineProperty(API, 'game', {
		get: function () { var r = realApi(); return r ? r.game : null; }
	});

	API._debug = function () {
		return {
			loading: loading, failed: failed, callbacks: callbacks.length,
			hasPending: !!pendingHost, real: !!realApi(),
			three: !!global.THREE, core: !!global.HZ, i18n: !!global.HZI18n
		};
	};

	global.Horizon = API;
})(window);
