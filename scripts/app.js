/**
 * app.js — Hayneko 站引导
 * 启动屏 / 强调色 / 语言 / Toast / 快捷键 / 标签页标题提示 / 挂载 dock
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var ACCENT_KEY = 'hayneko.accent';
	var ACCENTS = ['red', 'green', 'blue'];

	/* ------------------------------------------------------------ Toast */

	var stack = null;
	function toastRoot() {
		if (stack && stack.isConnected) return stack;
		stack = doc.getElementById('toast-stack');
		if (!stack) {
			stack = doc.createElement('div');
			stack.id = 'toast-stack';
			stack.className = 'toast-stack';
			doc.body.appendChild(stack);
		}
		return stack;
	}

	function toast(text, type, action) {
		var el = doc.createElement('div');
		el.className = 'toast' + (type ? ' toast--' + type : '');
		el.setAttribute('role', 'status');
		var dot = doc.createElement('span');
		dot.className = 'dot ' + (type === 'ok' ? 'dot--green' : type === 'warn' ? 'dot--red' : 'dot--blue');
		var span = doc.createElement('span');
		span.textContent = text;
		el.appendChild(dot);
		el.appendChild(span);

		var life = 2600;
		if (action && action.label && action.onClick) {
			var btn = doc.createElement('button');
			btn.type = 'button';
			btn.className = 'toast__action';
			btn.textContent = action.label;
			btn.addEventListener('click', function (e) {
				e.preventDefault();
				action.onClick();
			});
			el.appendChild(btn);
			life = 11000;   /* 有按钮就多留一会儿让人点 */
		}

		toastRoot().appendChild(el);
		setTimeout(function () {
			el.classList.add('is-out');
			setTimeout(function () { el.remove(); }, 260);
		}, life);
	}
	global.Toast = { show: toast };

	/* ------------------------------------------------------------ 强调色 */

	function applyAccent(name) {
		if (ACCENTS.indexOf(name) === -1) name = 'green';
		doc.documentElement.setAttribute('data-accent', name);
		Array.prototype.forEach.call(doc.querySelectorAll('.accent-switch button'), function (btn) {
			btn.classList.toggle('is-active', btn.getAttribute('data-accent') === name);
		});
		return name;
	}

	function initAccent() {
		var saved = null;
		try { saved = global.localStorage.getItem(ACCENT_KEY); } catch (e) { /* 忽略 */ }
		applyAccent(saved || doc.documentElement.getAttribute('data-accent') || 'green');

		doc.addEventListener('click', function (e) {
			var btn = e.target.closest ? e.target.closest('.accent-switch button') : null;
			if (!btn) return;
			var name = btn.getAttribute('data-accent');
			applyAccent(name);
			try { global.localStorage.setItem(ACCENT_KEY, name); } catch (err) { /* 忽略 */ }
			if (global.GeometryBG) global.GeometryBG.pulse(name);
		});
		doc.addEventListener('accent:changed', function (e) {
			applyAccent(e.detail && e.detail.accent);
		});
	}

	/* ------------------------------------------------------------ 语言 */

	function syncLanguageButtons() {
		var current = global.i18n ? global.i18n.getLocale() : null;
		Array.prototype.forEach.call(doc.querySelectorAll('[data-locale]'), function (btn) {
			btn.classList.toggle('is-active', btn.getAttribute('data-locale') === current);
		});
	}

	function initLanguage() {
		doc.addEventListener('click', function (e) {
			var btn = e.target.closest ? e.target.closest('[data-locale]') : null;
			if (!btn) return;
			var locale = btn.getAttribute('data-locale');
			if (!global.i18n || !global.i18n.setLocale) return;
			if (global.i18n.getLocale() === locale) return;
			global.i18n.setLocale(locale).then(function (applied) {
				toast('locale → ' + applied);
				if (global.GeometryBG) global.GeometryBG.pulse('blue');
			});
		});
	}

	/* ------------------------------------------------------------ 标签页标题 */

	function initTitle() {
		var base = doc.title || 'Hayneko';
		var away = '';

		function refresh() {
			var i18n = global.i18n;
			away = (i18n && i18n.t ? i18n.t('tab.away') : '') || '';
			if (!doc.hidden) base = doc.title;
		}

		/* 只在语言包就绪之后取文案, 避免刷一屏"缺少翻译"告警 */
		doc.addEventListener('i18n:applied', function () {
			refresh();
			if (doc.hidden) doc.title = ' (>_<) ' + away + base;
		});
		if (global.i18n && global.i18n.ready) global.i18n.ready.then(refresh);
		doc.addEventListener('route:changed', function () {
			setTimeout(function () { if (!doc.hidden) base = doc.title; }, 60);
		});
		doc.addEventListener('visibilitychange', function () {
			if (doc.hidden) doc.title = ' (>_<) ' + away + base;
			else doc.title = base;
		});
		global.addEventListener('focus', function () { if (!doc.hidden) doc.title = base; });
	}

	/* ------------------------------------------------------------ 快捷键 */

	function initShortcuts() {
		var pending = false;
		doc.addEventListener('keydown', function (e) {
			var tag = (e.target && e.target.tagName || '').toLowerCase();
			var typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);

			if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
				e.preventDefault();
				if (global.HeaderNav) global.HeaderNav.toggle();
				return;
			}
			if (typing) return;

			if (e.key === 'g') {
				pending = true;
				setTimeout(function () { pending = false; }, 900);
				return;
			}
			if (!pending) return;
			var map = { h: 'home', s: 'storage', l: 'lab', k: 'links' };
			var target = map[e.key.toLowerCase()];
			if (target && global.Router) {
				e.preventDefault();
				pending = false;
				global.Router.navigate(target);
			}
		});
	}

	/* ------------------------------------------------------------ 启动屏 */

	function bootSequence() {
		var boot = doc.getElementById('boot-screen');
		if (!boot) return { finish: function () {} };

		var bar = boot.querySelector('.boot__bar i');
		var log = boot.querySelector('.boot__log');
		var lines = [
			['go', 'hayneko.kernel 16.0.0'],
			['ok', 'mount  /dev/canvas ......... geometry online'],
			['ok', 'load   /styles/*.css ....... tokens ready'],
			['ok', 'link   /scripts/dock.js .... dock mounted'],
			['go', 'probe  /i18n/*.json ........ resolving locale'],
			['ok', 'route  #/home .............. views cached'],
			['ok', 'ready']
		];

		var i = 0;
		function step() {
			if (i >= lines.length) return;
			var item = lines[i];
			var li = doc.createElement('li');
			var tag = doc.createElement('span');
			tag.className = item[0];
			tag.textContent = '[' + (item[0] === 'ok' ? ' OK ' : ' .. ') + ']';
			var text = doc.createElement('span');
			text.textContent = item[1];
			li.appendChild(tag);
			li.appendChild(text);
			log.appendChild(li);
			if (log.children.length > 7) log.removeChild(log.firstChild);
			if (bar) bar.style.width = Math.round(((i + 1) / lines.length) * 100) + '%';
			i++;
			setTimeout(step, 80 + Math.random() * 100);
		}
		step();

		return {
			finish: function () {
				if (bar) bar.style.width = '100%';
				setTimeout(function () {
					boot.classList.add('is-done');
					setTimeout(function () { boot.remove(); }, 700);
				}, 260);
			}
		};
	}

	/* ------------------------------------------------------------ 保护媒体 */

	function initProtectedMedia(scope) {
		(scope || doc).querySelectorAll('.protected-media').forEach(function (el) {
			el.setAttribute('draggable', 'false');
			el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
			el.addEventListener('dragstart', function (e) { e.preventDefault(); });
		});
	}

	/* ------------------------------------------------------------ 动效偏好提示 */

	/**
	 * 系统开了「减少动态效果」时, 只关掉大幅动效(见 tokens.css)。
	 * 如果用户其实想要全部动效, 在这里给一个一次性的入口。
	 */
	function initMotionNotice() {
		var pref = global.MotionPref;
		if (!pref || pref.source !== 'system') return;

		var KEY = 'dsh.motion.notice';
		try {
			if (global.localStorage.getItem(KEY)) return;
			global.localStorage.setItem(KEY, '1');
		} catch (err) { return; }

		setTimeout(function () {
			toast('系统开着「减少动态效果」，大幅动画已关闭', 'warn', {
				label: '开启完整动效',
				onClick: function () { pref.set('full'); }
			});
		}, 3000);
	}

	/* ------------------------------------------------------------ 引导 */

	function boot() {
		var booter = bootSequence();

		initAccent();
		initLanguage();
		initShortcuts();
		initTitle();
		initMotionNotice();

		if (global.Dock) global.Dock.mount(doc.body);
		initProtectedMedia(doc);

		var yearEl = doc.getElementById('footer-year');
		if (yearEl) yearEl.textContent = String(new Date().getFullYear());

		doc.addEventListener('i18n:applied', syncLanguageButtons);
		if (global.i18n && global.i18n.ready) {
			global.i18n.ready.then(function () {
				global.i18n.apply(doc);
				syncLanguageButtons();
			});
		} else {
			syncLanguageButtons();
		}

		if (!global.Router) { booter.finish(); return; }

		global.Router.init()
			.catch(function (err) { console.error('[app] 路由初始化失败:', err); })
			.then(function () { booter.finish(); });
	}

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
	else boot();
})(window);
