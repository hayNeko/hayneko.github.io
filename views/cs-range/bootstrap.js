/**
 * views/cs-range/bootstrap.js — lazy loader for DUST RANGE
 *
 * The 3D game is ~750 KB of JS (Three.js + content + game). Only load it when
 * the player actually opens #/range, so every other page on the site keeps its
 * original weight. This tiny shim is the only game script loaded globally.
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var BUILD = '20261020n';
	var ASSETS = [
		'views/cs-range/vendor/three.min.js',
		'views/cs-range/content.js?v=' + BUILD,
		'views/cs-range/i18n.js?v=' + BUILD,
		'views/cs-range/game.js?v=' + BUILD
	];
	var loading = false;
	var pendingHost = null;
	var callbacks = [];
	var failed = false;
	var API = {};
	var watcher = null;

	function setHint(text) {
		if (!pendingHost) return;
		var hint = pendingHost.querySelector('[data-csr-loading-hint]');
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
			console.error('[dust range] failed to load', src);
		};
		doc.head.appendChild(s);
	}

	function loadAll(done) {
		if (global.THREE && global.CSRangeContent && global.CSRange && global.CSRange.__real) {
			done();
			return;
		}
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

	function watch() {
		if (failed) { if (watcher) { clearInterval(watcher); watcher = null; } return; }
		if (!pendingHost || !realApi()) return;
		var host = pendingHost;
		if (!host.isConnected) { pendingHost = null; if (watcher) { clearInterval(watcher); watcher = null; } return; }
		pendingHost = null;
		if (watcher) { clearInterval(watcher); watcher = null; }
		try { realApi().mountAll(host); } catch (e) { console.error('[dust range] mount failed', e); }
	}

	function realApi() {
		var api = global.CSRange;
		return api && api.__real ? api : null;
	}

	API.mountAll = function (scope) {
		var host = (scope || doc).querySelector('[data-cs-range]');
		if (!host) return null;
		pendingHost = host;

		var real = realApi();
		if (real) return real.mountAll(host);

		setHint('LOADING 3D ENGINE');
		/* the host can be replaced by the router while scripts are in flight */
		var mine = host;
		var wait = function () {
			if (mine !== pendingHost || !mine.isConnected) return;
			var r = realApi();
			if (r) r.mountAll(mine);
		};
		callbacks.push(wait);
		if (!watcher) watcher = global.setInterval(watch, 160);
		if (!loading && !failed) {
			loading = true;
			loadAll(function () { /* callbacks run inside loadAll */ });
		}
		return null;
	};

	API.destroy = function () {
		var r = realApi();
		if (r && r.destroy) r.destroy();
		pendingHost = null;
	};

	API.active = function () {
		var r = realApi();
		return !!(r && r.active && r.active());
	};

	API.debug = {
		state: function () { var r = realApi(); return r && r.debug ? r.debug.state() : null; },
		start: function () { var r = realApi(); return r && r.debug ? r.debug.start() : null; },
		teleport: function (x, z, yaw) { var r = realApi(); return r && r.debug ? r.debug.teleport(x, z, yaw) : null; },
		lookAt: function (x, z) { var r = realApi(); return r && r.debug ? r.debug.lookAt(x, z) : null; },
		killAll: function () { var r = realApi(); return r && r.debug ? r.debug.killAll() : null; },
		shoot: function () { var r = realApi(); return r && r.debug ? r.debug.shoot() : null; },
		endRound: function (win) { var r = realApi(); return r && r.debug ? r.debug.endRound(win) : null; }
	};

	Object.defineProperty(API, 'game', {
		get: function () { var r = realApi(); return r ? r.game : null; }
	});

	API._debug = function () {
		return { loading: loading, failed: failed, callbacks: callbacks.length, hasPending: !!pendingHost, real: !!realApi(), three: !!global.THREE, content: !!global.CSRangeContent };
	};

	global.CSRange = API;
})(window);
