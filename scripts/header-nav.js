/**
 * header-nav.js — 顶部栏的展开 / 收起编排
 *
 * 动效分工(这是之前"内容愣一会才消失"的修复关键):
 *   - 主元素(导航项、面板底、顶栏基线)全部交给 **CSS transition** 驱动,
 *     共用 --nav-dur / --nav-ease, 所以展开时一起出现、收起时一起消失;
 *   - 展开的错位(stagger)只写在 .is-open 的 transition-delay 里 ——
 *     CSS 过渡取"变化后"的 delay, 因此收起时没有错位, 所有内容同一时刻退场;
 *   - JS 只负责额外"叠一层"smear 拖影(ghostsOnly), 不参与主元素动画;
 *     拖影在收起时被立即 dispose, 不会残留。
 *
 * 交互:
 *   - 鼠标移入顶栏 → 展开; 移出 → 收起
 *   - 点击顶栏切换; Esc 收起; Ctrl/Cmd+K 切换
 *   - ← ↓ ↑ → 在链接间移动, Enter 跳转
 *   - 触摸设备: 点击顶栏切换
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var header = doc.getElementById('site-header');
	if (!header) return;

	var bar = doc.getElementById('header-bar');
	var nav = doc.getElementById('site-nav');
	var statusEl = doc.getElementById('header-status');
	var pathEl = doc.getElementById('header-path');

	var items = nav ? Array.prototype.slice.call(nav.querySelectorAll('.nav-item')) : [];
	var meta = nav ? nav.querySelector('.nav-meta') : null;

	/* ---- 时序: 与 CSS 共用同一组值, 保证拖影贴合主元素 ---- */
	var NAV_DUR = 480;
	var NAV_STAGGER = 42;
	var NAV_EASE = 'cubic-bezier(0.15, 1, 0, 1)';

	/* 收起态与展开态的形态, CSS 里的 .nav-item 必须与此一致 */
	var NAV_FROM = 'translateY(-165%) scaleY(1.18)';
	var NAV_TO = 'translateY(0) scaleY(1)';

	var NAV_KEYFRAMES = [
		{ offset: 0, transform: NAV_FROM, opacity: 0 },
		{ offset: 0.62, transform: 'translateY(4%) scaleY(0.98)', opacity: 1 },
		{ offset: 1, transform: NAV_TO, opacity: 1 }
	];

	var isOpen = false;
	var closeTimer = 0;
	var ghosts = [];
	var ready = false;

	var OPEN_HOVER_DELAY = 0;
	var CLOSE_DELAY = 100;

	/* ------------------------------------------------------------ 初始化 */

	function applyTimingVars() {
		var root = doc.documentElement;
		root.style.setProperty('--nav-dur', NAV_DUR + 'ms');
		root.style.setProperty('--nav-stagger', NAV_STAGGER + 'ms');
		root.style.setProperty('--nav-ease', NAV_EASE);
		items.forEach(function (item, i) { item.style.setProperty('--nav-i', String(i)); });
		if (meta) meta.style.setProperty('--nav-count', String(items.length));
	}

	function setStatus(text, state) {
		if (!statusEl) return;
		if (text != null) statusEl.textContent = text;
		if (state) statusEl.setAttribute('data-state', state);
	}

	function disposeGhosts() {
		ghosts.forEach(function (g) { g.dispose(); });
		ghosts = [];
	}

	/* ------------------------------------------------------------ 展开 */

	function open() {
		if (isOpen) return;
		isOpen = true;
		clearTimeout(closeTimer);
		disposeGhosts();

		header.classList.add('is-open');
		header.setAttribute('data-open', 'true');
		if (bar) bar.setAttribute('aria-expanded', 'true');
		setStatus('[ nav ]', 'busy');

		var Smear = global.Smear;
		if (!Smear) return;

		items.forEach(function (item, i) {
			ghosts.push(Smear.play(item, NAV_KEYFRAMES, {
				ghostsOnly: true,
				duration: NAV_DUR,
				easing: NAV_EASE,
				delay: i * NAV_STAGGER,
				ghosts: 6,
				lag: 26,
				blur: 1.9,
				fade: 0.5,
				blend: 'screen'
			}));
		});

		setTimeout(function () {
			if (isOpen) setStatus('[ ready ]', 'done');
		}, NAV_DUR + items.length * NAV_STAGGER);
	}

	/* ------------------------------------------------------------ 收起 */

	function close() {
		if (!isOpen) return;
		isOpen = false;
		clearTimeout(closeTimer);
		/* 先干掉拖影, 再摘掉 is-open —— 两件事在同一帧内完成,
		   主元素交给同一条 CSS 过渡退场, 不会有多余的东西留在屏幕上。 */
		disposeGhosts();
		header.classList.remove('is-open');
		header.setAttribute('data-open', 'false');
		if (bar) bar.setAttribute('aria-expanded', 'false');
		setStatus('[ ready ]', 'idle');
	}

	function toggle() { if (isOpen) close(); else open(); }

	/* ------------------------------------------------------------ 事件 */

	function isTouch() {
		return !!(global.matchMedia && global.matchMedia('(hover: none)').matches);
	}

	function cancelClose() { clearTimeout(closeTimer); }

	function scheduleClose() {
		cancelClose();
		closeTimer = setTimeout(function () {
			/* 焦点还在顶栏里就不收 */
			if (header.contains(doc.activeElement) && doc.activeElement !== bar) return;
			close();
		}, CLOSE_DELAY);
	}

	if (bar) {
		bar.addEventListener('pointerenter', function () {
			if (isTouch()) return;
			cancelClose();
			if (ready) open();
		});
		bar.addEventListener('focus', function () { if (ready) open(); });
		bar.addEventListener('click', function (e) {
			e.preventDefault();
			toggle();
		});
		bar.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				open();
				setTimeout(function () { focusItem(0); }, 90);
			}
		});
	}

	header.addEventListener('pointerenter', function () {
		if (isTouch()) return;
		cancelClose();
		closeTimer = setTimeout(function () { if (ready) open(); }, OPEN_HOVER_DELAY);
	});
	header.addEventListener('pointerleave', scheduleClose);
	header.addEventListener('focusin', function () { cancelClose(); if (ready) open(); });
	header.addEventListener('focusout', function () {
		cancelClose();
		closeTimer = setTimeout(function () {
			if (!header.contains(doc.activeElement)) close();
		}, 120);
	});

	function focusItem(index) {
		if (!items.length) return;
		var i = (index + items.length) % items.length;
		items[i].focus();
	}

	nav && nav.addEventListener('keydown', function (e) {
		var index = items.indexOf(doc.activeElement);
		if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(index + 1); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(index - 1); }
		else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
		else if (e.key === 'End') { e.preventDefault(); focusItem(items.length - 1); }
		else if (e.key === 'Escape') { e.preventDefault(); close(); if (bar) bar.focus(); }
	});

	doc.addEventListener('keydown', function (e) {
		if (e.key === 'Escape' && isOpen) { close(); if (bar) bar.focus(); }
	});

	doc.addEventListener('pointerdown', function (e) {
		if (!isOpen) return;
		if (!header.contains(e.target)) close();
	});

	doc.addEventListener('route:changed', function (e) {
		var route = e.detail && e.detail.route;
		items.forEach(function (item) {
			item.classList.toggle('is-active', item.getAttribute('data-route') === route);
		});
	});

	doc.addEventListener('i18n:applied', function () {
		if (isOpen) setStatus('[ nav ]', 'busy');
		else setStatus('[ ready ]', 'idle');
	});

	/* ------------------------------------------------------------ 就绪 */

	applyTimingVars();
	if (header.classList.contains('is-open')) { isOpen = true; setStatus('[ nav ]', 'busy'); }

	global.addEventListener('load', function () { setTimeout(function () { ready = true; }, 240); });
	if (doc.readyState === 'complete') setTimeout(function () { ready = true; }, 240);

	global.HeaderNav = {
		open: open,
		close: close,
		toggle: toggle,
		isOpen: function () { return isOpen; },
		setPath: function (text) { if (pathEl) pathEl.textContent = text; },
		timing: { duration: NAV_DUR, stagger: NAV_STAGGER, ease: NAV_EASE }
	};
})(window);
