/**
 * router.js — 无刷新单页路由
 *
 * - hash 路由 (#/home, #/tools, ...), 刷新后可直接定位
 * - 切换时: 旧页面 blur + 上移淡出 → 拉取 partial → 新页面 blur + 上移淡入
 * - 新页面里 [data-smear] 的元素会依次带 smear 拖影落位
 * - 顶部 RGB 进度条 + 顶栏路径 / <title> 同步
 */
(function (global) {
	'use strict';

	var doc = global.document;

	var ROUTES = {
		home:     { id: 'home',     path: '~/home',     partial: 'views/home.html',     titleKey: 'title.home',     accent: 'green' },
		terminal: { id: 'terminal', path: '~/terminal', partial: 'views/terminal.html', titleKey: 'title.terminal', accent: 'blue' },
		storage: { id: 'storage', path: '~/storage', partial: 'views/storage.html', titleKey: 'title.storage', accent: 'blue' },
		lab:     { id: 'lab',     path: '~/lab',     partial: 'views/lab.html',     titleKey: 'title.lab',     accent: 'red' },
		links:   { id: 'links',   path: '~/links',   partial: 'views/links.html',   titleKey: 'title.links',   accent: 'white' }
	};
	var FALLBACK = 'home';

	var cache = new Map();
	var busy = false;
	var queued = null;
	var current = null;
	var inited = false;

	var progressEl = null;
	var progressFill = null;

	function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

	/* ------------------------------------------------------------ 工具 */

	function parseHash() {
		var raw = (global.location.hash || '').replace(/^#\/?/, '');
		raw = raw.split('?')[0].split('/')[0];
		return ROUTES[raw] ? raw : FALLBACK;
	}

	function load(partial) {
		if (cache.has(partial)) return cache.get(partial);
		var p = global.fetch(partial, { credentials: 'same-origin' }).then(function (res) {
			if (!res.ok) throw new Error('HTTP ' + res.status);
			return res.text();
		});
		cache.set(partial, p);
		p.catch(function () { cache.delete(partial); });
		return p;
	}

	function setProgress(value) {
		if (!progressEl) return;
		if (value == null) {
			progressEl.classList.remove('is-active');
			if (progressFill) progressFill.style.width = '0%';
			return;
		}
		progressEl.classList.add('is-active');
		if (progressFill) progressFill.style.width = Math.round(value * 100) + '%';
	}

	function escapeHtml(text) {
		return String(text).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	function errorHTML(err) {
		return '<div class="wrap"><div class="page-error">' +
			'<p><strong>[ ENOENT ]</strong> 无法加载页面片段。</p>' +
			'<p class="mono-faint" style="margin-top:10px">' + escapeHtml(err && err.message ? err.message : err) + '</p>' +
			'<p class="mono-faint" style="margin-top:14px">请通过本地 HTTP 服务器打开本站(例如 <code>npx serve</code> 或 <code>python -m http.server</code>),' +
			' 直接双击 <code>file://</code> 打开时浏览器会拦截 fetch 请求。</p>' +
			'</div></div>';
	}

	/* ------------------------------------------------------------ 元信息 */

	function updateTitle(route) {
		var titleEl = doc.querySelector('title');
		if (!titleEl) return;
		titleEl.setAttribute('i18n-key', route.titleKey);
		var i18n = global.i18n;
		var text = i18n && i18n.t ? i18n.t(route.titleKey) : null;
		if (text) titleEl.textContent = text;
	}

	function updateHeaderPath(route) {
		if (global.HeaderNav && global.HeaderNav.setPath) global.HeaderNav.setPath(route.path);
	}

	async function applyI18n(root) {
		var i18n = global.i18n;
		if (!i18n) return;
		try {
			if (i18n.ready) await i18n.ready;
			i18n.apply(root);
		} catch (err) {
			console.warn('[router] i18n apply 失败:', err);
		}
	}

	/* ------------------------------------------------------------ 入场编排 */

	function runEntrance(page) {
		/* 入场编排在 motion.js: 视口内的立刻播, 视口外的等滚到眼前再播。
		   这里的实现只作为 Motion 缺失时的兜底。 */
		if (global.Motion && global.Motion.entrance) return global.Motion.entrance(page);

		var Smear = global.Smear;
		var targets = page.querySelectorAll('[data-smear]');
		if (!Smear || !targets.length || Smear.reduced) return;

		Array.prototype.forEach.call(targets, function (el, i) {
			var mode = el.getAttribute('data-smear') || 'pop';
			var delay = Math.min(i * 62, 420);
			if (mode === 'drop') {
				Smear.dropIn(el, { duration: 500, delay: delay, ghosts: 0 });
			} else if (mode === 'slide') {
				Smear.slideIn(el, { duration: 500, delay: delay, ghosts: 0 });
			} else {
				Smear.popIn(el, { duration: 500, delay: delay, ghosts: 0 });
			}
		});
	}

	/* ------------------------------------------------------------ 渲染 */

	async function render(id) {
		if (busy) { queued = id; return; }
		busy = true;

		var routeId = ROUTES[id] ? id : FALLBACK;
		var route = ROUTES[routeId];
		var page = doc.getElementById('page');
		if (!page) { busy = false; return; }

		setProgress(0.18);

		// 1) 离场
		if (page.dataset.route) {
			page.dataset.state = 'leaving';
			await wait(180);
		}

		setProgress(0.5);

		// 2) 取内容
		var html;
		try {
			html = await load(route.partial);
		} catch (err) {
			console.error('[router] 加载失败:', route.partial, err);
			html = errorHTML(err);
		}
		setProgress(0.72);

		page.innerHTML = html;
		page.dataset.route = routeId;
		current = routeId;

		updateHeaderPath(route);
		/* 注意: 属性名不能叫 data-route —— 它会被 closest('[data-route]') 命中,
		   导致页面上任何一次点击都被当成站内链接拦截掉。 */
		document.documentElement.setAttribute('data-route-current', routeId);

		await applyI18n(page);
		/* 语言包就绪之后再写 <title>, 否则会先报一次"缺少翻译" */
		updateTitle(route);
		setProgress(0.9);

		// 3) 入场
		page.dataset.state = 'entering';
		runEntrance(page);

		if (global.Terminal && global.Terminal.mountAll) global.Terminal.mountAll(page);
		if (global.GeometryBG && global.GeometryBG.pulse) global.GeometryBG.pulse(route.accent === 'white' ? 'blue' : route.accent);

		var scroller = doc.scrollingElement || doc.documentElement;
		var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (scroller.scrollTop > 0) {
			if (reduce) scroller.scrollTop = 0;
			else global.scrollTo({ top: 0, behavior: 'smooth' });
		}

		doc.dispatchEvent(new CustomEvent('route:changed', {
			detail: { route: routeId, path: route.path, first: !page.dataset.booted }
		}));
		page.dataset.booted = 'true';

		setTimeout(function () {
			page.dataset.state = 'idle';
			setProgress(null);
		}, 520);

		busy = false;
		if (queued != null && queued !== routeId) {
			var next = queued;
			queued = null;
			render(next);
		} else {
			queued = null;
		}
	}

	/* ------------------------------------------------------------ 导航 */

	function navigate(id, options) {
		var opts = options || {};
		var routeId = ROUTES[id] ? id : FALLBACK;
		var target = '#/' + routeId;
		if (global.location.hash === target) {
			if (!current) render(routeId);
			return;
		}
		if (opts.replace) global.history.replaceState(null, '', target);
		else global.location.hash = target;
		if (opts.replace) render(routeId);
	}

	function prefetch() {
		Object.keys(ROUTES).forEach(function (key) {
			if (key === current) return;
			load(ROUTES[key].partial).catch(function () { /* 忽略预取失败 */ });
		});
	}

	/* ------------------------------------------------------------ 初始化 */

	function init() {
		if (inited) return Promise.resolve(current);
		inited = true;

		progressEl = doc.getElementById('route-progress');
		progressFill = progressEl ? progressEl.querySelector('i') : null;

		// 拦截站内链接
		doc.addEventListener('click', function (e) {
			if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			/* 只认真正的站内 <a>, 不再用裸属性选择器 */
			var link = e.target.closest ? e.target.closest('a[data-route]') : null;
			if (!link) return;
			var id = link.getAttribute('data-route');
			if (!ROUTES[id]) return;
			e.preventDefault();
			navigate(id);
			if (global.HeaderNav) global.HeaderNav.close();
		});

		global.addEventListener('hashchange', function () {
			render(parseHash());
		});

		if (!global.location.hash) {
			global.history.replaceState(null, '', '#/' + FALLBACK);
		}

		var first = render(parseHash());
		setTimeout(prefetch, 1800);
		return first.then(function () { return current; });
	}

	global.Router = {
		init: init,
		navigate: navigate,
		render: render,
		routes: ROUTES,
		get current() { return current; },
		path: function () { return ROUTES[current] ? ROUTES[current].path : '~'; }
	};
})(window);
