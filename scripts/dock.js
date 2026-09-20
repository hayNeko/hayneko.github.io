/**
 * dock.js — 底部程序坞
 *
 * 沿用旧站 macOS Dock 的结构与交互(头像 + 图标按钮 + tooltip + 点击弹出菜单),
 * 视觉与动效换成新的终端语言:
 *   - 展开/收起走与顶栏同一套 CSS 时序(--nav-dur / --nav-ease), 不会多停留一拍;
 *   - 菜单项用 --i 依次错位入场;
 *   - 点击头像迸发粒子;
 *   - 语言 / 主题 / 搜索 都是真的可用。
 */
(function (global) {
	'use strict';

	var doc = global.document;

	/* ------------------------------------------------------------ 图标 */

	var ICONS = {
		home: '<path d="M3 10.6 12 3l9 7.6V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
		box: '<path d="M3 7.2 12 3l9 4.2v9.6L12 21 3 16.8z"/><path d="M3 7.2 12 11.3l9-4.1"/><path d="M12 11.3V21"/>',
		flask: '<path d="M9 3h6"/><path d="M10.2 3v6.2L5 18.1A1.4 1.4 0 0 0 6.2 20.3h11.6A1.4 1.4 0 0 0 19 18.1l-5.2-8.9V3"/><path d="M7.2 14.5h9.6"/>',
		link: '<path d="M10.4 13.6a4.4 4.4 0 0 0 6.2 0l2.6-2.6a4.4 4.4 0 0 0-6.2-6.2l-1.2 1.2"/><path d="M13.6 10.4a4.4 4.4 0 0 0-6.2 0l-2.6 2.6a4.4 4.4 0 0 0 6.2 6.2l1.2-1.2"/>',
		chat: '<path d="M21 12a8 8 0 0 1-8 8H7.6L3 23V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>',
		globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
		moon: '<path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/>',
		sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
		code: '<path d="M8.5 6.5 2.5 12l6 5.5"/><path d="M15.5 6.5 21.5 12l-6 5.5"/>',
		term: '<path d="M4 6.5 9.5 12 4 17.5"/><path d="M12.5 17.5H20"/>',
		search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/>',
		image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.6" cy="9.4" r="1.6"/><path d="m21 15.5-4.6-4.6L5.5 21"/>',
		github: '<path d="M9 19.5c-4.5 1.4-4.5-2.3-6.3-2.8m12.6 5.2v-3.6a3 3 0 0 0-.9-2.4c2.9-.3 5.9-1.4 5.9-6.4a4.8 4.8 0 0 0-1.3-3.4 4.5 4.5 0 0 0-.1-3.3s-1.1-.3-3.6 1.3a12.2 12.2 0 0 0-6.6 0C6.2 2.5 5.1 2.8 5.1 2.8a4.5 4.5 0 0 0-.1 3.3A4.8 4.8 0 0 0 3.7 9.5c0 5 2.9 6.1 5.8 6.4a3 3 0 0 0-.9 2.3V21"/>',
		instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1"/>',
		mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
		doc: '<path d="M14 2.5H6.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20V7.5z"/><path d="M14 2.5V7.5h5"/><path d="M8.5 12.5h7M8.5 16h5"/>',
		external: '<path d="M14 3.5h6.5V10"/><path d="M20.5 3.5 11 13"/><path d="M18.5 14v5.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19.5V8a1.5 1.5 0 0 1 1.5-1.5H11"/>',
		check: '<path d="m4.5 12.5 5 5 10-11"/>',
		grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'
	};

	function svg(name, cls) {
		return '<svg' + (cls ? ' class="' + cls + '"' : '') +
			' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
			'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
			(ICONS[name] || '') + '</svg>';
	}

	function icon(name, cls) {
		return '<span class="dock__icon' + (cls ? ' ' + cls : '') + '">' + svg(name) + '</span>';
	}

	/* ------------------------------------------------------------ 结构定义 */

	var GITHUB = 'https://github.com/hayNeko';
	var INSTAGRAM = 'https://www.instagram.com/hayneko_dword/';
	var EMAIL = 'haydenwong825@gmail.com';

	var SIMS = [
		{ href: 'pages/physics-sim/phy-default/', key: 'sim.default', icon: 'flask' },
		{ href: 'pages/physics-sim/phy-ntlaw2/', key: 'sim.ntlaw2', icon: 'grid' },
		{ href: 'pages/physics-sim/phy-lens/', key: 'sim.lens', icon: 'search' }
	];

	var LANGS = [
		{ code: 'en', label: 'English' },
		{ code: 'zh-CN', label: '中文 (简体)' },
		{ code: 'zh-TW', label: '中文 (繁體)' },
		{ code: 'ja', label: '日本語' },
		{ code: 'ko', label: '한국어' }
	];

	/* 顶栏按钮: id / 图标 / i18n key / 行为 */
	var ITEMS = [
		{ id: 'home', icon: 'home', key: 'dock.home', act: 'route:home' },
		{ id: 'terminal', icon: 'term', key: 'dock.terminal', act: 'route:terminal' },
		{ id: 'storage', icon: 'box', key: 'dock.storage', act: 'route:storage' },
		{ id: 'lab', icon: 'flask', key: 'dock.lab', act: 'menu:lab' },
		{ id: 'links', icon: 'link', key: 'dock.links', act: 'route:links', compact: true },
		{ sep: true },
		{ id: 'search', icon: 'search', key: 'dock.search', act: 'menu:search' },
		{ id: 'contact', icon: 'chat', key: 'dock.contact', act: 'menu:contact' },
		{ id: 'language', icon: 'globe', key: 'dock.language', act: 'menu:language' },
		{ id: 'theme', icon: 'moon', key: 'dock.theme', act: 'theme', dual: true },
		{ sep: true },
		{ id: 'projects', icon: 'github', key: 'dock.projects', act: 'link:' + GITHUB },
		{ id: 'album', icon: 'image', key: 'dock.album', act: 'soon', compact: true }
	];

	/* ------------------------------------------------------------ 构建 */

	function itemHTML(item) {
		if (item.sep) return '<span class="dock__sep" aria-hidden="true"></span>';
		/* 主题按钮放两个图标, 用 CSS 交叉淡入淡出 —— 切换主题时不会"啪"地换一个图形 */
		var inner = item.dual
			? '<span class="dock__icon dock__icon--dual">' + svg('moon', 'icon-moon') + svg('sun', 'icon-sun') + '</span>'
			: icon(item.icon);

		return '<button type="button" class="dock__item" id="dock-' + item.id + '" data-dock="' + item.id + '"' +
			(item.compact ? ' data-compact-hide' : '') +
			' data-tip="" i18n-attr="data-tip" i18n-key="' + item.key + '"' +
			' aria-label="" i18n-attr="aria-label" i18n-key="' + item.key + '">' +
			inner + '</button>';
	}

	function menuItemHTML(row, index, opts) {
		var tag = opts && opts.as === 'a' ? 'a' : (opts && opts.as === 'div' ? 'div' : 'button');
		var attrs = ' class="dock-menu__item" style="--i:' + index + '"';
		if (tag === 'a') {
			attrs += ' href="' + row.href + '"' + (row.external ? ' target="_blank" rel="noopener noreferrer"' : '');
		} else if (tag === 'button') {
			attrs += ' type="button"';
		}
		if (row.locale) attrs += ' data-locale="' + row.locale + '"';
		if (row.act) attrs += ' data-menu-act="' + row.act + '"';
		/* 注意: i18n-key 只挂在内层 <b> 上。
		   如果外层容器也带同一个 key, i18n 引擎会给"没有自己的文本节点"的元素
		   在最前面插入一个文本节点, 结果是标签重复渲染两遍。 */
		if (row.aria) attrs += ' aria-label="" i18n-attr="aria-label" i18n-key="' + row.key + '"';

		var body = icon(row.icon || 'doc');
		body += '<span class="dock-menu__text">';
		body += '<b' + (row.key ? ' i18n-key="' + row.key + '"' : '') + '>' + (row.label || '') + '</b>';
		if (row.sub) body += '<small' + (row.subKey ? ' i18n-key="' + row.subKey + '"' : '') + '>' + row.sub + '</small>';
		body += '</span>';
		body += '<span class="dock-menu__arrow" aria-hidden="true">' + (row.arrow || '›') + '</span>';
		if (row.locale) body += '<span class="check" aria-hidden="true">' + icon('check') + '</span>';

		return '<' + tag + attrs + '>' + body + '</' + tag + '>';
	}

	function menuHTML(id, headKey, headCode, rows, opts) {
		var list = rows.map(function (row, i) { return menuItemHTML(row, i, opts); }).join('');
		return '<div class="dock-menu" id="dock-menu-' + id + '" role="dialog" aria-modal="false" ' +
			'aria-label="" i18n-attr="aria-label" i18n-key="' + headKey + '">' +
			'<div class="dock-menu__head"><span i18n-key="' + headKey + '"></span><code>' + (headCode || '') + '</code></div>' +
			(list ? '<div class="dock-menu__list">' + list + '</div>' : '') +
			(opts && opts.tail ? opts.tail : '') +
			'</div>';
	}

	function buildHTML() {
		var items = ITEMS.map(itemHTML).join('');

		var labMenu = menuHTML('lab', 'dock.menu.lab.title', '~/lab',
			SIMS.map(function (s) {
				return { href: s.href, external: true, icon: s.icon, key: 'lab.' + s.key + '.title', subKey: 'lab.' + s.key + '.desc', sub: '', arrow: '↗' };
			}).concat([
				{ href: 'medias/files/docs/i386.pdf', external: true, icon: 'doc', key: 'lab.docs.i386.title', subKey: 'lab.docs.i386.desc', sub: '', arrow: '↗' }
			]), { as: 'a' });

		var contactMenu = menuHTML('contact', 'dock.menu.contact.title', '~/contact', [
			{ href: GITHUB, external: true, icon: 'github', label: 'GitHub', sub: 'hayNeko', arrow: '↗' },
			{ href: INSTAGRAM, external: true, icon: 'instagram', label: 'Instagram', sub: '@hayneko_dword', arrow: '↗' },
			{ href: 'mailto:' + EMAIL, icon: 'mail', label: EMAIL, sub: '', arrow: '↗' }
		], { as: 'a' });

		var langMenu = menuHTML('language', 'dock.menu.language.title', 'LANG',
			LANGS.map(function (l) {
				return { locale: l.code, icon: 'globe', label: l.label, arrow: '' };
			}));

		var searchMenu = menuHTML('search', 'dock.menu.search.title', 'grep', [],
			{
				tail: '<div class="dock-menu__search">' +
					'<input class="input" id="dock-search-input" type="search" autocomplete="off" spellcheck="false" ' +
					'placeholder="" i18n-attr="placeholder" i18n-key="dock.menu.search.placeholder">' +
					'</div><div id="dock-search-results"></div>'
			});

		return '<nav class="dock" id="dock" aria-label="" i18n-attr="aria-label" i18n-key="dock.aria">' +
			'<button type="button" class="dock__avatar" id="dock-avatar" data-tip="" i18n-attr="data-tip" i18n-key="dock.avatar.tip">' +
			'<img src="medias/picures/avatarMikuHatsune1.jpg" alt="Hayno" draggable="false" class="protected-media">' +
			'</button>' +
			'<span class="dock__sep" aria-hidden="true"></span>' +
			items +
			'<span class="dock__spacer"></span>' +
			'<span class="dock__status" id="dock-status"><b>online</b> <span data-dock-locale>en</span></span>' +
			'<span class="dock__indicator" id="dock-indicator" aria-hidden="true"></span>' +
			'</nav>' +
			labMenu + contactMenu + langMenu + searchMenu;
	}

	/* ------------------------------------------------------------ 运行时 */

	var root = null;
	var dockEl = null;
	var openMenuId = null;
	var applying = false;
	var i18nReady = false;

	function menus() { return root ? root.querySelectorAll('.dock-menu') : []; }

	function closeMenus(immediate) {
		menus().forEach(function (m) {
			if (m.classList.contains('is-open')) m.classList.remove('is-open');
			m.setAttribute('aria-hidden', 'true');
		});
		openMenuId = null;
		if (dockEl) dockEl.classList.remove('has-open-menu');
	}

	/** 只负责打开(幂等); 点击按钮的"再点一次收起"逻辑在 toggleMenu 里 */
	function showMenu(id) {
		var target = doc.getElementById('dock-menu-' + id);
		if (!target) return;
		if (openMenuId === id) return;
		closeMenus(true);

		target.classList.add('is-open');
		target.setAttribute('aria-hidden', 'false');
		openMenuId = id;
		if (dockEl) dockEl.classList.add('has-open-menu');

		var input = target.querySelector('input');
		if (input) setTimeout(function () { input.focus(); }, 120);
	}

	function toggleMenu(id) { if (openMenuId === id) closeMenus(); else showMenu(id); }

	/* ---- 主题 ---- */

	function currentTheme() {
		return doc.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
	}

	function applyTheme(theme) {
		var light = theme === 'light';
		doc.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
		try {
			global.localStorage.setItem('preferredTheme', light ? 'light' : 'dark');
			global.localStorage.setItem('hayneko.theme', light ? 'light' : 'dark');
		} catch (e) { /* 忽略 */ }
		if (global.GeometryBG && global.GeometryBG.setTheme) global.GeometryBG.setTheme(!light);
		return light ? 'light' : 'dark';
	}

	function initTheme() {
		var saved = null;
		try { saved = global.localStorage.getItem('hayneko.theme') || global.localStorage.getItem('preferredTheme'); } catch (e) { /* 忽略 */ }
		applyTheme(saved === 'light' ? 'light' : 'dark');
	}

	/** 用户主动切换主题: 走整屏擦除过渡 + 图标旋转, 不再"啪"地一下换掉 */
	function switchTheme(name) {
		var current = currentTheme();
		var next = (name === 'light' || name === 'dark') ? name : (current === 'light' ? 'dark' : 'light');
		if (next === current) return current;

		var btn = doc.getElementById('dock-theme');
		var apply = function () { applyTheme(next); };
		if (global.Motion && global.Motion.themeWipe) global.Motion.themeWipe(next, apply);
		else apply();
		if (global.Motion) global.Motion.spin(btn);

		var i18n = global.i18n;
		var label = (i18n && i18n.t ? (i18n.t('dock.theme') || 'theme') : 'theme');
		if (global.Toast) global.Toast.show(label + ' → ' + next, 'ok');
		return next;
	}

	/* ---- 粒子 ---- */

	var PARTICLE_COLORS = ['#ff4d5a', '#3ce07b', '#4d9dff', '#e6edf3', '#ff4d5a', '#4d9dff'];

	function burst(cx, cy) {
		for (var i = 0; i < 16; i++) {
			var p = doc.createElement('span');
			p.className = 'dock-particle';
			var size = 3 + Math.random() * 5;
			var color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
			p.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;width:' + size + 'px;height:' + size +
				'px;background:' + color + ';box-shadow:0 0 10px ' + color;
			doc.body.appendChild(p);
			var angle = Math.random() * Math.PI * 2;
			var dist = 26 + Math.random() * 78;
			p.animate([
				{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
				{ transform: 'translate(calc(-50% + ' + (Math.cos(angle) * dist).toFixed(1) + 'px), calc(-50% + ' +
					(Math.sin(angle) * dist).toFixed(1) + 'px)) scale(0.15)', opacity: 0 }
			], {
				duration: 320 + Math.random() * 180,
				easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
				fill: 'forwards'
			}).finished.then(function () { return null; }).catch(function () { return null; }).then(function () { p.remove(); });
		}
	}

	function emitParticle() {
		var avatar = doc.getElementById('dock-avatar');
		if (!avatar) return;
		avatar.classList.add('is-clicked');
		setTimeout(function () { avatar.classList.remove('is-clicked'); }, 340);
		var rect = avatar.getBoundingClientRect();
		burst(rect.left + rect.width / 2, rect.top + rect.height / 2);
	}

	/* ---- 搜索 ---- */

	var SEARCH_INDEX = [
		{ label: 'Home', key: 'dock.home', route: 'home', icon: 'home' },
		{ label: 'Terminal', key: 'dock.terminal', route: 'terminal', icon: 'term' },
		{ label: 'Storage', key: 'dock.storage', route: 'storage', icon: 'box' },
		{ label: 'Lab', key: 'dock.lab', route: 'lab', icon: 'flask' },
		{ label: 'Links', key: 'dock.links', route: 'links', icon: 'link' }
	].concat(SIMS.map(function (s) {
		return { label: s.key, key: 'lab.' + s.key + '.title', href: s.href, icon: s.icon };
	}));

	/** 语言包就绪前不要调用 i18n.t —— 否则会刷一屏"缺少翻译"告警 */
	function tKey(key, fallback) {
		if (!i18nReady) return fallback;
		var i18n = global.i18n;
		if (!i18n || !i18n.t) return fallback;
		return i18n.t(key) || fallback;
	}

	function renderSearch(query) {
		var box = doc.getElementById('dock-search-results');
		if (!box) return;
		var q = (query || '').trim().toLowerCase();

		var hits = SEARCH_INDEX.filter(function (row) {
			var label = tKey(row.key, row.label);
			return !q || String(label).toLowerCase().indexOf(q) !== -1 || row.key.toLowerCase().indexOf(q) !== -1;
		});

		var emptyText = tKey('dock.menu.search.empty', 'No matching entry.');

		if (!hits.length) {
			box.innerHTML = '<div class="dock-menu__empty">' + emptyText + '</div>';
		} else {
			box.innerHTML = '<div class="dock-menu__list">' + hits.map(function (row, i) {
				var label = tKey(row.key, row.label);
				var attrs = ' class="dock-menu__item" style="--i:' + i + '"';
				if (row.route) attrs += ' data-search-route="' + row.route + '"';
				else attrs += ' data-search-href="' + row.href + '"';
				return '<button type="button"' + attrs + '>' + icon(row.icon) +
					'<span class="dock-menu__text"><b>' + label + '</b></span>' +
					'<span class="dock-menu__arrow" aria-hidden="true">›</span></button>';
			}).join('') + '</div>';
		}
	}

	/* ---- 状态栏 ---- */

	function syncStatus() {
		var el = root && root.querySelector('[data-dock-locale]');
		if (el) el.textContent = global.i18n ? global.i18n.getLocale() : 'en';
	}

	/* ------------------------------------------------------------ 坞底滑动光点 */

	var indicator = null;
	var hoveredItem = null;
	var indicatorX = null;
	var indicatorTimer = 0;

	function moveIndicator(item) {
		if (!indicator || !indicator.isConnected) indicator = doc.getElementById('dock-indicator');
		if (!indicator || !dockEl) return;

		var target = item || hoveredItem || dockEl.querySelector('.dock__item.is-active');
		if (!target) { indicator.style.opacity = '0'; return; }

		var r = target.getBoundingClientRect();
		var d = dockEl.getBoundingClientRect();
		if (!r.width || !d.width) { indicator.style.opacity = '0'; return; }

		var x = r.left - d.left + r.width / 2;
		var from = indicatorX == null ? x : indicatorX;
		var moved = Math.abs(x - from) > 1.5;

		/* --dir 告诉 CSS 拖尾往哪边甩, --ind-stretch 让光点在移动时拉长成一道，
		   这两个都由 motion.css 里的 .is-moving 控制 */
		indicator.style.setProperty('--dir', x >= from ? '1' : '-1');
		indicator.style.opacity = '1';
		indicator.style.transform = 'translateX(' + x.toFixed(1) + 'px) scaleX(var(--ind-stretch, 1))';
		indicatorX = x;

		if (moved) {
			indicator.classList.add('is-moving');
			clearTimeout(indicatorTimer);
			/* 比 transform 的 520ms 再长一点, 让拖影"留"一会儿 */
			indicatorTimer = setTimeout(function () { indicator.classList.remove('is-moving'); }, 500);
		}
	}

	function wireIndicator() {
		if (!dockEl) return;
		dockEl.addEventListener('pointerover', function (e) {
			var item = e.target.closest ? e.target.closest('.dock__item') : null;
			if (!item) return;
			hoveredItem = item;
			moveIndicator(item);
		});
		dockEl.addEventListener('pointerleave', function () {
			hoveredItem = null;
			moveIndicator(null);
		});
		global.addEventListener('resize', function () { moveIndicator(null); });
	}

	function syncActive() {
		var route = global.Router ? global.Router.current : null;
		root.querySelectorAll('[data-dock]').forEach(function (btn) {
			var id = btn.getAttribute('data-dock');
			btn.classList.toggle('is-active', id === route);
		});
		moveIndicator(null);
	}

	function syncLocale() {
		var current = global.i18n ? global.i18n.getLocale() : 'en';
		root.querySelectorAll('[data-locale]').forEach(function (btn) {
			btn.classList.toggle('is-active', btn.getAttribute('data-locale') === current);
		});
		syncStatus();
	}

	/* ---- 事件 ---- */

	function onClick(e) {
		var avatar = e.target.closest && e.target.closest('#dock-avatar');
		if (avatar) {
			emitParticle();
			if (global.Router) global.Router.navigate('home');
			return;
		}

		var localeBtn = e.target.closest && e.target.closest('[data-locale]');
		if (localeBtn) {
			if (global.Motion) global.Motion.spin(doc.getElementById('dock-language'));
			closeMenus();
			return;
		}

		var searchHit = e.target.closest && e.target.closest('[data-search-route],[data-search-href]');
		if (searchHit) {
			var route = searchHit.getAttribute('data-search-route');
			var href = searchHit.getAttribute('data-search-href');
			closeMenus();
			if (route && global.Router) global.Router.navigate(route);
			else if (href) global.open(href, '_blank', 'noopener');
			return;
		}

		var btn = e.target.closest && e.target.closest('#dock [data-dock]');
		if (!btn) return;
		var act = btn.getAttribute('data-dock');
		var def = ITEMS.filter(function (i) { return i.id === act; })[0];
		if (!def) return;

		var action = def.act;
		if (action.indexOf('route:') === 0) {
			closeMenus();
			if (global.Motion) global.Motion.pop(btn);
			if (global.Router) global.Router.navigate(action.slice(6));
			return;
		}
		if (action === 'theme') {
			switchTheme();
			return;
		}
		if (action === 'soon') {
			var i18n = global.i18n;
			var msg = i18n && i18n.t ? i18n.t('dock.toast.soon') : null;
			if (global.Toast) global.Toast.show(msg || 'Coming soon', 'warn');
			return;
		}
		if (action.indexOf('link:') === 0) {
			global.open(action.slice(5), '_blank', 'noopener');
			return;
		}
		if (action.indexOf('menu:') === 0) {
			toggleMenu(action.slice(5));
		}
	}

	/* ------------------------------------------------------------ 对外 API */

	/* 这些方法在脚本加载时就挂到 Dock 上 —— 不依赖 mount() 是否执行到最后,
	   即使挂载过程中某一步出错, dock 的接口依然可用。 */
	var API = {
		close: function () { return closeMenus(); },
		open: function (id) { return showMenu(id); },
		toggle: function (id) { return toggleMenu(id); },
		theme: function (t) { return switchTheme(t); },
		applyTheme: function (t) { return applyTheme(t); },
		burst: function () { return emitParticle(); },
		menu: function () { return openMenuId; },
		mounted: false
	};

	/* ------------------------------------------------------------ 挂载 */

	function mount(host) {
		root = typeof host === 'string' ? doc.querySelector(host) : (host || doc.body);
		root.insertAdjacentHTML('beforeend', buildHTML());
		dockEl = root.querySelector('#dock');

		initTheme();
		renderSearch('');
		wireIndicator();

		root.addEventListener('click', onClick);

		var searchInput = doc.getElementById('dock-search-input');
		if (searchInput) {
			searchInput.addEventListener('input', function () { renderSearch(searchInput.value); });
			searchInput.addEventListener('keydown', function (e) {
				if (e.key !== 'Enter') return;
				var first = doc.querySelector('#dock-search-results [data-search-route],#dock-search-results [data-search-href]');
				if (first) first.click();
			});
		}

		doc.addEventListener('click', function (e) {
			if (openMenuId == null) return;
			if (e.target.closest && (e.target.closest('.dock-menu') || e.target.closest('#dock'))) return;
			closeMenus();
		});
		doc.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && openMenuId != null) closeMenus();
		});
		doc.addEventListener('route:changed', syncActive);
		doc.addEventListener('i18n:applied', function () {
			/* 再入保护: renderSearch 里若再触发 i18n 相关逻辑, 不会绕回来 */
			if (applying) return;
			applying = true;
			syncLocale();
			renderSearch(searchInput ? searchInput.value : '');
			applying = false;
		});

		syncActive();
		syncLocale();
		/* 等一帧, 让 dock 完成布局后再把光点放到当前页面对应的图标下面 */
		global.requestAnimationFrame(function () { moveIndicator(null); });

		API.mounted = true;

		/* 翻译要等语言包就绪再跑, 否则会刷一屏"缺少翻译"的告警 */
		var i18n = global.i18n;
		if (i18n && i18n.apply) {
			if (i18n.ready) {
				i18n.ready.then(function () {
					i18nReady = true;
					try { i18n.apply(root); syncLocale(); renderSearch(''); } catch (err) { /* 忽略 */ }
				});
			} else {
				try { i18n.apply(root); } catch (err) { /* 忽略 */ }
			}
		}
		return API;
	}

	global.Dock = {
		mount: mount,
		buildHTML: buildHTML,
		icon: icon,
		instance: API,
		close: API.close,
		open: API.open,
		toggle: API.toggle,
		theme: API.theme,
		switchTheme: API.theme,
		burst: API.burst
	};
})(window);
