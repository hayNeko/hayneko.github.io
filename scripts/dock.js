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
		grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
		gamepad: '<path d="M8 8.2h8a4.6 4.6 0 0 1 4.5 5.5l-.8 3.2a2.35 2.35 0 0 1-4.2 1l-.9-1.1H9.4l-.9 1.1a2.35 2.35 0 0 1-4.2-1l-.8-3.2A4.6 4.6 0 0 1 8 8.2z"/><path d="M7.4 11.2v2.6M6.1 12.5h2.6"/><circle cx="16" cy="11.4" r=".95"/><circle cx="17.8" cy="13.4" r=".95"/>'
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
		{ href: 'pages/labs/phy-default/', key: 'sim.default', icon: 'flask' },
		{ href: 'pages/labs/phy-ntlaw2/', key: 'sim.ntlaw2', icon: 'grid' },
		{ href: 'pages/labs/phy-lens/', key: 'sim.lens', icon: 'search' },
		{ href: 'pages/labs/phy-wave/', key: 'sim.wave', icon: 'grid' }
	];

	var LANGS = [
		{ code: 'en', label: 'English' },
		{ code: 'zh-CN', label: '中文 (简体)' },
		{ code: 'zh-TW', label: '中文 (繁體)' },
		{ code: 'ja', label: '日本語' },
		{ code: 'ko', label: '한국어' }
	];

	/* 顶栏按钮: id / 图标 / i18n key / 行为 */
	/*
	 * 目录页的六栏。顺序与页码就是这一期的目次。
	 * label/desc 只是 HTML 兜底文本, 真正显示的是 titleKey/descKey(语言包)。
	 */
	var NAV = [
		{ id: '01', route: 'home', icon: 'home', label: 'Home', desc: 'Contents',
			titleKey: 'nav.item.home.label', descKey: 'nav.item.home.desc' },
		{ id: '02', route: 'terminal', icon: 'term', label: 'Terminal', desc: 'A shell that works',
			titleKey: 'nav.item.terminal.label', descKey: 'nav.item.terminal.desc' },
		{ id: '03', route: 'storage', icon: 'box', label: 'Storage', desc: 'The archive',
			titleKey: 'nav.item.storage.label', descKey: 'nav.item.storage.desc' },
		{ id: '04', route: 'labs', icon: 'flask', label: 'Labs', desc: 'Simulations & VM',
			titleKey: 'nav.item.lab.label', descKey: 'nav.item.lab.desc' },
		{ id: '05', route: 'games', icon: 'gamepad', label: 'Games', desc: 'Playable',
			titleKey: 'nav.item.games.label', descKey: 'nav.item.games.desc' },
		{ id: '06', route: 'links', icon: 'link', label: 'Friendly Links', desc: 'Elsewhere',
			titleKey: 'nav.item.links.label', descKey: 'nav.item.links.desc' }
	];

	/* 顶栏(索引条)上的按钮: 前六个是栏目本身, 后面是工具。
	   tip 只给图标看不出含义的那几个, 栏目图标本身已经说明问题。 */
	var navItems = NAV.map(function (n) {
		return { id: n.route, icon: n.icon, key: n.titleKey, act: 'route:' + n.route };
	});

	var ITEMS = navItems.concat([
		{ sep: true },
		{ id: 'index', icon: 'grid', key: 'dock.index.label', act: 'index', tip: true, tipKey: 'dock.index.tip' },
		{ id: 'search', icon: 'search', key: 'dock.search', act: 'menu:search', tip: true, tipKey: 'dock.search' },
		{ id: 'contact', icon: 'chat', key: 'dock.contact', act: 'menu:contact', tip: true, tipKey: 'dock.contact' },
		{ id: 'language', icon: 'globe', key: 'dock.language', act: 'menu:language', tip: true, tipKey: 'dock.language' },
		{ id: 'theme', icon: 'moon', key: 'dock.theme', act: 'theme', dual: true, tip: true, tipKey: 'dock.theme' }
	]);

	/* ------------------------------------------------------------ 构建 */

	function itemHTML(item) {
		if (item.sep) {
			return '<span class="dock__sep' + (item.avatar ? ' dock__sep--avatar' : '') + '"' +
				(item.compact ? ' data-compact-hide' : '') + ' aria-hidden="true"></span>';
		}
		/* 主题按钮放两个图标, 用 CSS 交叉淡入淡出 —— 切换主题时不会"啪"地换一个图形 */
		var inner = item.dual
			? '<span class="dock__icon dock__icon--dual">' + svg('moon', 'icon-moon') + svg('sun', 'icon-sun') + '</span>'
			: icon(item.icon);

		var idx = ITEMS.indexOf(item);
		return '<button type="button" class="dock__item" id="dock-' + item.id + '" data-dock="' + item.id + '"' +
			' style="--di:' + (idx < 0 ? 0 : idx) + '"' +
			(item.compact ? ' data-compact-hide' : '') +
			(item.tip ? ' data-tip="" i18n-attr="data-tip" i18n-key="' + item.tipKey + '"' : '') +
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

		var labMenu = menuHTML('labs', 'dock.menu.lab.title', '~/labs',
			[{
				/* 站内页面: 走路由, 不新开标签页 */
				href: '#/labs-vm', act: 'route:labs-vm', icon: 'term',
				key: 'lab.vm.menu.title', subKey: 'lab.vm.menu.desc', sub: '', arrow: '›'
			}].concat(SIMS.map(function (s) {
				return { href: s.href, external: true, icon: s.icon, key: 'lab.' + s.key + '.title', subKey: 'lab.' + s.key + '.desc', sub: '', arrow: '↗' };
			})).concat([
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

		var searchMenu = menuHTML('search', 'dock.menu.search.title', 'global', [],
			{
				tail: '<div class="dock-menu__search">' +
					'<input class="input" id="dock-search-input" type="search" autocomplete="off" spellcheck="false" ' +
					'placeholder="" i18n-attr="placeholder" i18n-key="dock.menu.search.placeholder">' +
					'</div><div id="dock-search-results"></div>'
			});

		/* 目录页: 六个栏目 + 版次色标, 排版像一本刊的目次页 */
		var indexRows = NAV.map(function (n) {
			return '<a class="dock-index__item" href="#' + n.id + '" data-route="' + n.route + '">' +
				'<span class="dock-index__no">' + n.id + '</span>' +
				'<span class="dock-index__body">' +
				'<span class="dock-index__label" i18n-key="' + n.titleKey + '">' + n.label + '</span>' +
				'<span class="dock-index__desc" i18n-key="' + n.descKey + '">' + n.desc + '</span>' +
				'</span>' +
				'<span class="dock-index__key" aria-hidden="true">↵</span>' +
				'</a>';
		}).join('');

		var indexPanel = '<div class="dock-index" id="dock-index" aria-hidden="true">' +
			'<div class="dock-index__inner">' +
			'<div class="dock-index__head">' +
			'<span class="dock-index__flag">Hayneko</span>' +
			'<span class="dock-index__issue" i18n-key="dock.index.issue">No. 01 — 2026</span>' +
			'<span class="dock-index__rule" aria-hidden="true"></span>' +
			'<span class="dock-index__hint" i18n-key="dock.index.hint"></span>' +
			'</div>' +
			'<nav class="dock-index__list" aria-label="" i18n-attr="aria-label" i18n-key="dock.index.aria">' + indexRows + '</nav>' +
			/* 目录页底部把"索引条上没有的东西"补齐:
			   版次色标、主题、语言。手机上索引条只留栏目 + 目录,
			   这三样都在这里, 不会出现"看不到的控件"。 */
			'<div class="dock-index__foot">' +
			'<span class="dock-index__label-sm" i18n-key="dock.index.edition">Edition</span>' +
			'<span class="accent-switch" role="group" aria-label="Edition colour">' +
			'<button type="button" data-accent="bordeaux" title="bordeaux"></button>' +
			'<button type="button" data-accent="racing" title="racing green"></button>' +
			'<button type="button" data-accent="prussian" title="prussian blue"></button>' +
			'</span>' +
			'<button type="button" class="dock-index__act" id="dock-theme-m" data-dock="theme">' +
			'<span class="dock__icon dock__icon--dual">' + svg('moon', 'icon-moon') + svg('sun', 'icon-sun') + '</span>' +
			'<span i18n-key="dock.index.theme">Theme</span>' +
			'</button>' +
			'<span class="dock-index__lang">' +
			'<span class="dock-index__label-sm" i18n-key="dock.index.language">Language</span>' +
			'<span class="lang-switch">' +
			'<button type="button" data-locale="en">EN</button>' +
			'<button type="button" data-locale="zh-CN">简</button>' +
			'<button type="button" data-locale="zh-TW">繁</button>' +
			'<button type="button" data-locale="ja">日</button>' +
			'<button type="button" data-locale="ko">한</button>' +
			'</span>' +
			'</span>' +
			'<span class="dock-index__spacer"></span>' +
			'<button type="button" class="dock-index__close" id="dock-index-close" i18n-key="dock.index.close">Close</button>' +
			'</div>' +
			'</div>' +
			'</div>';

		return indexPanel +
			'<nav class="dock" id="dock" aria-label="" i18n-attr="aria-label" i18n-key="dock.aria">' +
			'<button type="button" class="dock__avatar" id="dock-avatar" data-tip="" aria-expanded="true" aria-controls="dock-rail" ' +
				'i18n-attr="data-tip" i18n-key="dock.avatar.tip">' +
			'<img src="medias/pictures/avatarMikuHatsune1.jpg" alt="" draggable="false" class="protected-media">' +
			'</button>' +
			'<div class="dock__rail" id="dock-rail">' +
			items +
			'<span class="dock__spacer"></span>' +
			'</div>' +
			'<span class="dock__status" id="dock-status"><b>online</b> <span data-dock-locale>en</span></span>' +
			/* 收起态显示的东西: 当前时间 / 星期 / 当前页面。
			   放在轨外面, 所以收起时它留下、"轨"消失。 */
			'<div class="dock__now" aria-hidden="true">' +
			'<span class="dock__now-time" id="dock-now-time">--:--</span>' +
			'<span class="dock__now-sep">·</span>' +
			'<span class="dock__now-day" id="dock-now-day"></span>' +
			'<span class="dock__now-sep dock__now-sep--path">·</span>' +
			'<span class="dock__now-path" id="dock-now-path">~/home</span>' +
			'</div>' +
			'<button type="button" class="dock__toggle" id="dock-toggle" aria-expanded="true" aria-controls="dock-rail" ' +
				'aria-label="" i18n-attr="aria-label" i18n-key="dock.index.toggle"><i></i><i></i></button>' +
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
			global.localStorage.setItem('hayneko.theme.v6', light ? 'light' : 'dark');
		} catch (e) { /* 忽略 */ }
		/* 改版后旧站的 dark 偏好不再沿用: 键名带版次号 */
		if (global.GeometryBG && global.GeometryBG.setTheme) global.GeometryBG.setTheme(!light);
		return light ? 'light' : 'dark';
	}

	function initTheme() {
		var saved = null;
		try { saved = global.localStorage.getItem('hayneko.theme.v6'); } catch (e) { /* 忽略 */ }
		/* 没有存过偏好时不要动 <html> 上的默认值 —— 默认是日读版(浅色)。 */
		applyTheme(saved === 'light' || saved === 'dark' ? saved : currentTheme());
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

	/* 点头像时溅开的墨点: 用当前版次的油墨色 + 一点纸色, 不再是 RGB 三原色 */
	var PARTICLE_COLORS = ['rgba(125, 37, 50, .75)', 'rgba(36, 73, 47, .7)', 'rgba(28, 63, 94, .7)', 'rgba(20, 17, 13, .55)'];

	function burst(cx, cy) {
		for (var i = 0; i < 16; i++) {
			var p = doc.createElement('span');
			p.className = 'dock-particle';
			var size = 3 + Math.random() * 5;
			var color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
			p.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;width:' + size + 'px;height:' + size +
				'px;background:' + color;
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

	/* ---- 全局搜索 ----
	 *
	 * 索引用的是"活"的清单: 页面 / 小游戏 / 物理模拟 / 终端命令 / 资源下载 / 外链,
	 * 小游戏与终端命令分别问 Games 与 Terminal 要, 不在这里抄一份。
	 * 命中按"词条相关度 > 组内顺序"排, 再按分组展示 —— 空查询时列出全部,
	 * 也就是"所有可能的结果"。
	 */

	var PAGES = [
		{ label: 'Home', key: 'dock.home', route: 'home', icon: 'home', hint: '~/home' },
		{ label: 'Terminal', key: 'dock.terminal', route: 'terminal', icon: 'term', hint: '~/terminal' },
		{ label: 'Storage', key: 'dock.storage', route: 'storage', icon: 'box', hint: '~/storage' },
		{ label: 'Labs', key: 'dock.lab', route: 'labs', icon: 'flask', hint: '~/labs' },
		{ label: 'Arch32S VM', key: 'lab.vm.heading', route: 'labs-vm', icon: 'term', hint: '~/labs/vm' },
		{ label: 'Games', key: 'dock.games', route: 'games', icon: 'gamepad', hint: '~/games' },
		{ label: 'Dust Range', route: 'range', icon: 'gamepad', hint: '~/range · 3D FPS' },
		{ label: 'Links', key: 'dock.links', route: 'links', icon: 'link', hint: '~/links' }
	];

	/* 资源下载: 与 views/storage.html 保持一致(改那边记得顺手改这里) */
	var FILES = [
		{ label: "Intel 80386 Programmer's Reference Manual (1986)", key: 'lab.docs.i386.title', href: 'medias/files/docs/i386.pdf', icon: 'doc', hint: 'pdf · 1.0 MB' },
		{ label: 'nlohmann/json.hpp v3.12.0 — JSON for Modern C++', href: 'medias/files/programming/nlohmann_json.hpp', icon: 'box', hint: 'hpp · 956 KB' },
		{ label: 'Minecraft 1.21.1 PvP Map (datapack inside)', href: 'medias/files/games/PVP.zip', icon: 'box', hint: 'zip · no longer available' },
		{ label: 'Minecraft 1.21.1 PvP Map — full map', href: 'medias/files/games/1.21.1_command.zip', icon: 'box', hint: 'zip · no longer available' }
	];

	var LINKS = [
		{ label: 'GitHub', href: GITHUB, icon: 'github', hint: 'github.com/hayNeko' },
		{ label: 'Instagram', href: INSTAGRAM, icon: 'instagram', hint: '@hayneko_dword' },
		{ label: 'Email', href: 'mailto:' + EMAIL, icon: 'mail', hint: EMAIL }
	];

	/* 分组顺序 = 展示顺序; 组标题走 i18n */
	var SEARCH_GROUPS = [
		{ id: 'games', key: 'dock.searchMenu.group.games' },
		{ id: 'pages', key: 'dock.searchMenu.group.pages' },
		{ id: 'commands', key: 'dock.searchMenu.group.commands' },
		{ id: 'sims', key: 'dock.searchMenu.group.sims' },
		{ id: 'files', key: 'dock.searchMenu.group.files' },
		{ id: 'links', key: 'dock.searchMenu.group.links' }
	];

	function esc(text) {
		return String(text).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	/** 每次搜索现取: Games / Terminal 可能还没加载完, 懒着来最省心 */
	function globalIndex() {
		var rows = [];

		PAGES.forEach(function (p) {
			rows.push({ group: 'pages', label: p.label, key: p.key, hint: p.hint, icon: p.icon, route: p.route });
		});

		if (global.Games && global.Games.list) {
			global.Games.list().forEach(function (g) {
				rows.push({
					group: 'games', label: g.title, key: 'games.' + g.id + '.title',
					/* 说明也进索引: 游戏名是专有名词(Block Blast 各语言都写英文),
					   只匹配名字的话中文用户搜"棋盘 / 方块 / 三块"就找不到它 */
					extraKey: 'games.' + g.id + '.desc',
					hint: 'play ' + g.id, icon: 'gamepad', game: g.id
				});
			});
		}

		SIMS.forEach(function (s) {
			rows.push({
				group: 'sims', label: s.key, key: 'lab.' + s.key + '.title',
				hint: s.href, icon: s.icon, href: s.href, external: true
			});
		});

		if (global.Terminal && global.Terminal.commands) {
			global.Terminal.commands().forEach(function (c) {
				rows.push({
					group: 'commands', label: c.name, hint: c.usage, icon: 'term',
					command: c.name
				});
			});
		}

		FILES.forEach(function (f) {
			rows.push({ group: 'files', label: f.label, key: f.key, hint: f.hint, icon: f.icon, href: f.href, external: true });
		});

		LINKS.forEach(function (l) {
			rows.push({ group: 'links', label: l.label, hint: l.hint, icon: l.icon, href: l.href });
		});

		return rows;
	}

	/** 语言包就绪前不要调用 i18n.t —— 否则会刷一屏"缺少翻译"告警 */
	function tKey(key, fallback, params) {
		if (!i18nReady) return fallback;
		var i18n = global.i18n;
		if (!i18n || !i18n.t) return fallback;
		return i18n.t(key, params) || fallback;
	}

	function labelOf(row) {
		return row.key ? String(tKey(row.key, row.label)) : String(row.label);
	}

	/* 精确 > 前缀 > 包含 > 说明/路径里出现 */
	function scoreOf(row, label, q) {
		if (!q) return 1;
		var text = label.toLowerCase();
		if (text === q) return 4;
		if (text.indexOf(q) === 0) return 3;
		if (text.indexOf(q) !== -1) return 2;
		if (row.hint && String(row.hint).toLowerCase().indexOf(q) !== -1) return 1.5;
		if (row.key && String(row.key).toLowerCase().indexOf(q) !== -1) return 1.2;
		/* 本地化的说明文字(小游戏用): 排在名字与命令之后 */
		if (row.extraKey && String(tKey(row.extraKey, '')).toLowerCase().indexOf(q) !== -1) return 1.1;
		return 0;
	}

	function hitHTML(hit, index) {
		var row = hit.row;
		var attrs = ' class="dock-menu__item" style="--i:' + Math.min(index, 14) + '"';
		if (row.route) attrs += ' data-search-route="' + esc(row.route) + '"';
		else if (row.game) attrs += ' data-search-game="' + esc(row.game) + '"';
		else if (row.command) attrs += ' data-search-cmd="' + esc(row.command) + '"';
		else if (row.href) attrs += ' data-search-href="' + esc(row.href) + '"';
		var body = icon(row.icon || 'doc') + '<span class="dock-menu__text"><b>' + esc(hit.label) + '</b>';
		if (row.hint) body += '<small>' + esc(row.hint) + '</small>';
		body += '</span><span class="dock-menu__arrow" aria-hidden="true">' + (row.external ? '↗' : '›') + '</span>';
		return '<button type="button"' + attrs + '>' + body + '</button>';
	}

	function renderSearch(query) {
		var box = doc.getElementById('dock-search-results');
		if (!box) return;
		var q = (query || '').trim().toLowerCase();

		var hits = [];
		globalIndex().forEach(function (row, i) {
			var label = labelOf(row);
			var score = scoreOf(row, label, q);
			if (score > 0) hits.push({ row: row, label: label, score: score, i: i });
		});

		if (!hits.length) {
			box.innerHTML = '<div class="dock-menu__empty">' +
				esc(tKey('dock.menu.search.empty', 'No matching entry.')) + '</div>';
			return;
		}

		var byGroup = {};
		hits.forEach(function (hit) {
			if (!byGroup[hit.row.group]) byGroup[hit.row.group] = [];
			byGroup[hit.row.group].push(hit);
		});

		var html = '<div class="dock-menu__count">' + esc(q
			? tKey('dock.searchMenu.count', '{count} results', { count: hits.length })
			: tKey('dock.searchMenu.hint', 'Everything on this site — type to filter.')) + '</div>';

		var index = 0;
		SEARCH_GROUPS.forEach(function (group) {
			var list = byGroup[group.id];
			if (!list || !list.length) return;
			list.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
			html += '<div class="dock-menu__group">' + esc(tKey(group.key, group.id)) +
				' <b>' + list.length + '</b></div>';
			html += '<div class="dock-menu__list">' + list.map(function (hit) {
				return hitHTML(hit, index++);
			}).join('') + '</div>';
		});

		box.innerHTML = html;
	}

	/* ---- 状态栏 ---- */

	function syncStatus() {
		var el = root && root.querySelector('[data-dock-locale]');
		if (el) el.textContent = global.i18n ? global.i18n.getLocale() : 'en';
	}

	function syncActive() {
		var route = global.Router ? global.Router.current : null;
		/* 当前页面靠图标本身的 is-active 配色区分(dock.css 里 .dock__item.is-active) */
		root.querySelectorAll('[data-dock]').forEach(function (btn) {
			var id = btn.getAttribute('data-dock');
			btn.classList.toggle('is-active', id === route);
		});
	}

	function syncLocale() {
		var current = global.i18n ? global.i18n.getLocale() : 'en';
		root.querySelectorAll('[data-locale]').forEach(function (btn) {
			btn.classList.toggle('is-active', btn.getAttribute('data-locale') === current);
		});
		syncStatus();
	}

	/* ---- 索引条收起 / 展开 ---- */

	var COLLAPSE_KEY = 'hayneko.dock';

	/**
	 * 收起时轨里只剩一个头像。状态记在 localStorage 里, 刷新后保持。
	 * 头像与右侧箭头都是开关 —— 点了不会回首页, 只切换这一条。
	 */
	function setCollapsed(flag, persist) {
		var on = !!flag;
		if (dockEl) dockEl.classList.toggle('is-collapsed', on);
		var avatar = doc.getElementById('dock-avatar');
		var toggle = doc.getElementById('dock-toggle');
		if (avatar) avatar.setAttribute('aria-expanded', on ? 'false' : 'true');
		if (toggle) toggle.setAttribute('aria-expanded', on ? 'false' : 'true');
		if (on) closeMenus(true);
		if (persist !== false) {
			try { global.localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
		}
		return on;
	}

	/* ---- 收起态里的时间 / 星期 / 当前页 ---- */

	var clockTimer = 0;

	function tickClock() {
		var t = doc.getElementById('dock-now-time');
		var d = doc.getElementById('dock-now-day');
		if (!t) return;
		var now = new Date();
		var hh = ('0' + now.getHours()).slice(-2);
		var mm = ('0' + now.getMinutes()).slice(-2);
		t.textContent = hh + ':' + mm;
		if (d) d.textContent = '星期' + ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
	}

	function syncNowPath() {
		var el = doc.getElementById('dock-now-path');
		if (!el) return;
		var hash = (global.location.hash || '').replace(/^#\/?/, '').split('?')[0];
		var route = hash || 'home';
		var table = global.Router && global.Router.routes;
		if (table && !table[route]) route = 'home';
		el.textContent = (table && table[route]) ? table[route].path : '~/' + route;
	}

	function startClock() {
		tickClock();
		clearInterval(clockTimer);
		/* 10s 轮询: 页面从后台唤醒、或跨过整分钟时也不会慢一拍 */
		clockTimer = setInterval(tickClock, 10000);
	}

	function initCollapse() {
		var saved = null;
		try { saved = global.localStorage.getItem(COLLAPSE_KEY); } catch (e) { /* 忽略 */ }
		setCollapsed(saved === '1', false);
	}

	function toggleCollapsed() {
		var on = dockEl ? dockEl.classList.contains('is-collapsed') : false;
		return setCollapsed(!on);
	}

	/* ---- 目录页(整屏) ---- */

	var indexOpen = false;

	function setIndex(open) {
		var panel = doc.getElementById('dock-index');
		if (!panel) return false;
		indexOpen = !!open;
		panel.classList.toggle('is-open', indexOpen);
		panel.setAttribute('aria-hidden', indexOpen ? 'false' : 'true');
		doc.documentElement.classList.toggle('is-index-open', indexOpen);
		if (indexOpen) closeMenus(true);
		return indexOpen;
	}

	function toggleIndex() { return setIndex(!indexOpen); }

	/* ---- 事件 ---- */

	function onClick(e) {
		var avatar = e.target.closest && e.target.closest('#dock-avatar');
		if (avatar) {
			emitParticle();
			/* 改版: 点头像不再回首页, 只把索引条收成一个头像(再点展开) */
			toggleCollapsed();
			return;
		}

		var toggleBtn = e.target.closest && e.target.closest('#dock-toggle');
		if (toggleBtn) {
			toggleCollapsed();
			return;
		}

		var closeIndex = e.target.closest && e.target.closest('#dock-index-close');
		if (closeIndex) {
			setIndex(false);
			return;
		}

		/* 目录页里的栏目: 走 hash, 由 router 接住, 点完把目录收起来 */
		var indexLink = e.target.closest && e.target.closest('.dock-index__item[data-route]');
		if (indexLink) {
			e.preventDefault();
			var target = indexLink.getAttribute('data-route');
			setIndex(false);
			if (global.Router) global.Router.navigate(target);
			return;
		}

		var localeBtn = e.target.closest && e.target.closest('[data-locale]');
		if (localeBtn) {
			if (global.Motion) global.Motion.spin(doc.getElementById('dock-language'));
			closeMenus();
			return;
		}

		var searchHit = e.target.closest && e.target.closest(
			'[data-search-route],[data-search-href],[data-search-game],[data-search-cmd]');
		if (searchHit) {
			var route = searchHit.getAttribute('data-search-route');
			var href = searchHit.getAttribute('data-search-href');
			var game = searchHit.getAttribute('data-search-game');
			var cmd = searchHit.getAttribute('data-search-cmd');
			closeMenus();
			if (route && global.Router) global.Router.navigate(route);
			else if (game && global.Games) global.Games.launch(game);
			else if (cmd && global.Terminal && global.Terminal.run) global.Terminal.run(cmd);
			else if (href) global.open(href, '_blank', 'noopener');
			return;
		}

		/* 菜单项上的动作(例如 lab 菜单里的 ~/labs/vm): 以前只有坞按钮会派发,
		   带 data-menu-act 的条目点了没反应 —— 这里补上。 */
		var menuAct = e.target.closest && e.target.closest('[data-menu-act]');
		if (menuAct) {
			e.preventDefault();
			runAction(menuAct.getAttribute('data-menu-act'));
			return;
		}

		var btn = e.target.closest && e.target.closest('#dock [data-dock]');
		if (!btn) return;
		var act = btn.getAttribute('data-dock');
		var def = ITEMS.filter(function (i) { return i.id === act; })[0];
		if (!def) return;

		runAction(def.act);
	}

	function runAction(action) {
		if (action.indexOf('route:') === 0) {
			closeMenus();
			/* 这里以前会调 Motion.pop() 做个"弹跳"(fx-pop: 上移 9px + 放大到 1.2)。
			   但其它坞按钮都只有悬停放大 / 按下缩小, 就这五个会弹, 看着不统一, 去掉了。 */
			if (global.Router) global.Router.navigate(action.slice(6));
			return;
		}
		if (action === 'index') {
			toggleIndex();
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
		index: function (open) { return open === undefined ? indexOpen : setIndex(open); },
		indexToggle: function () { return toggleIndex(); },
		collapsed: function (flag) { return flag === undefined ? (dockEl ? dockEl.classList.contains('is-collapsed') : false) : setCollapsed(flag); },
		collapseToggle: function () { return toggleCollapsed(); },
		mounted: false
	};

	/* ------------------------------------------------------------ 挂载 */

	function mount(host) {
		root = typeof host === 'string' ? doc.querySelector(host) : (host || doc.body);
		root.insertAdjacentHTML('beforeend', buildHTML());
		dockEl = root.querySelector('#dock');

		initTheme();
		initCollapse();
		startClock();
		syncNowPath();
		renderSearch('');

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
			if (e.key !== 'Escape') return;
			if (indexOpen) { setIndex(false); return; }
			if (openMenuId != null) closeMenus();
		});
		doc.addEventListener('route:changed', function () {
			syncActive();
			syncNowPath();
			setIndex(false);
		});
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
