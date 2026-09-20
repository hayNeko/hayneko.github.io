/**
 * motion.js — 交互反馈 + 入场编排
 *
 * 1. entrance(page)  页面内容的入场总编排
 *      - 首屏内(视口里)的元素: 立刻按顺序播 smear 入场
 *      - 首屏外的元素: 交给 IntersectionObserver, 滚动到眼前时才播
 *        (之前所有元素都在 inject 的瞬间一起播完, 视口外的等于白播,
 *         所以长页面看起来"没有动画")
 * 2. ripple          按下时从指针位置扩散一圈
 * 3. spotlight       卡片跟随指针的高光
 * 4. themeWipe       主题切换整屏擦除
 * 5. routeSweep      切页时一道淡扫描带掠过
 * 6. splitChars      标题逐字入场
 *
 * 全部尊重 prefers-reduced-motion。
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
	function reduced() {
		if (global.MotionPref) return !!global.MotionPref.reduced;
		return !!(mq && mq.matches);
	}

	/* ------------------------------------------------------------ 涟漪 */

	var RIPPLE_SELECTOR = '.btn, .term-suggest button, .file-row, .dock-menu__item, .card, .empty-state a';

	function spawnRipple(el, clientX, clientY) {
		var rect = el.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		var size = Math.max(rect.width, rect.height) * 2.1;
		var span = doc.createElement('span');
		span.className = 'fx-ripple';
		span.style.width = size + 'px';
		span.style.height = size + 'px';
		span.style.left = (clientX - rect.left - size / 2) + 'px';
		span.style.top = (clientY - rect.top - size / 2) + 'px';
		el.appendChild(span);
		span.addEventListener('animationend', function () { span.remove(); });
		setTimeout(function () { span.remove(); }, 900);
	}

	function initRipple() {
		doc.addEventListener('pointerdown', function (e) {
			if (e.button !== 0 || reduced()) return;
			var el = e.target.closest ? e.target.closest(RIPPLE_SELECTOR) : null;
			if (!el || el.hasAttribute('disabled')) return;
			spawnRipple(el, e.clientX, e.clientY);
		}, { passive: true });
	}

	/* ------------------------------------------------------------ 卡片高光 */

	var SPOT_SELECTOR = '.card, .sim-card, .profile-card, .avatar-card, .file-list, .term-window, .empty-state';
	var spotPending = 0;

	function initSpotlight() {
		if (reduced()) return;
		doc.addEventListener('pointermove', function (e) {
			if (spotPending) return;
			spotPending = global.requestAnimationFrame(function () {
				spotPending = 0;
				var el = e.target && e.target.closest ? e.target.closest(SPOT_SELECTOR) : null;
				if (!el) return;
				var r = el.getBoundingClientRect();
				if (!r.width) return;
				el.classList.add('has-spot');
				el.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
				el.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
			});
		}, { passive: true });
	}

	/* ------------------------------------------------------------ 标题逐字 */

	/**
	 * 把一个元素里的文本拆成逐字 span。
	 *
	 * 注意两件事:
	 *   1. 拆过之后元素里只剩 .fx-char, 没有文本节点了 —— 再次调用必须从
	 *      已有的字符里把文本读回来, 否则会把文字清空;
	 *   2. i18n 切语言时会往元素里"插入"一个新文本节点, 这时要以它为准。
	 *
	 * @param {boolean} force 强制重播(入场时用), 否则已拆好就跳过
	 */
	function splitChars(el, force) {
		var target = el.querySelector('[data-fx-text]') || el;
		var chars = Array.prototype.slice.call(target.querySelectorAll('.fx-char'));

		var fresh = '';
		for (var n = 0; n < target.childNodes.length; n++) {
			var node = target.childNodes[n];
			if (node.nodeType === 3 && node.nodeValue.trim()) fresh += node.nodeValue;
		}
		fresh = fresh.replace(/\s+/g, ' ').trim();

		/* 没有新文本、也已经拆过、又不是强制重播 → 保持现状 */
		if (!fresh && chars.length && !force) return;

		var text = fresh || chars.map(function (c) {
			return c.textContent === '\u00a0' ? ' ' : c.textContent;
		}).join('').replace(/\s+/g, ' ').trim();

		if (!text) return;

		target.textContent = '';
		var frag = doc.createDocumentFragment();
		for (var i = 0; i < text.length; i++) {
			var s = doc.createElement('span');
			s.className = 'fx-char';
			s.style.setProperty('--ci', String(i));
			s.textContent = text.charAt(i) === ' ' ? '\u00a0' : text.charAt(i);
			frag.appendChild(s);
		}
		target.appendChild(frag);
	}

	function splitAll(scope) {
		if (reduced()) return;
		Array.prototype.forEach.call((scope || doc).querySelectorAll('[data-fx-split]'), function (el) {
			splitChars(el, false);
		});
	}

	/* ------------------------------------------------------------ 入场编排 */

	var revealObserver = null;
	var revealTimer = 0;

	function revealNow(el, delay) {
		if (el.classList.contains('is-revealed')) return;
		el.classList.add('is-revealed');

		/* 入场时强制重播逐字动画 */
		if (el.hasAttribute('data-fx-split')) splitChars(el, true);
		if (!global.Smear || reduced()) return;

		var mode = el.getAttribute('data-smear') || 'pop';
		var base = { duration: 500, delay: delay, ghosts: 4, lag: 22, blur: 1.4, fade: 0.5 };
		var handle = null;
		var total = 0;

		if (mode === 'drop') {
			handle = global.Smear.dropIn(el, { duration: 500, delay: delay, ghosts: 5, lag: 26, blur: 1.8, fade: 0.5 });
			total = delay + 500;
		} else if (mode === 'slide') {
			handle = global.Smear.slideIn(el, { duration: 500, delay: delay, ghosts: 4, lag: 22, blur: 1.3, fade: 0.48 });
			total = delay + 500;
		} else {
			handle = global.Smear.popIn(el, base);
			total = delay + 500;
		}

		/* 入场跑完立刻释放动画。
		   Smear 用的是 fill:'both', 不释放的话它会一直占着 transform,
		   之后 :hover 放大 / :active 缩小 根本盖不过它 —— 卡片点了没反应就是这个原因。 */
		setTimeout(function () {
			if (handle && handle.dispose) { try { handle.dispose(); } catch (err) { /* 忽略 */ } }
		}, total + 90);
	}

	function entrance(page) {
		if (!page) return;
		var targets = Array.prototype.slice.call(page.querySelectorAll('[data-smear]'));
		splitAll(page);
		if (!targets.length) return;

		if (reduced() || !global.Smear) {
			targets.forEach(function (el) { el.classList.add('is-revealed'); });
			return;
		}

		/* 只在 JS + 非降级时隐藏未入场的元素, 避免没有动画时内容消失 */
		doc.documentElement.classList.add('fx-ready');

		if (revealObserver) { revealObserver.disconnect(); revealObserver = null; }

		var vh = global.innerHeight || 800;
		var inView = [];
		var later = [];

		targets.forEach(function (el) {
			if (el.classList.contains('is-revealed')) return;
			var r = el.getBoundingClientRect();
			if (r.top < vh * 0.93 && r.bottom > -60) inView.push(el);
			else later.push(el);
		});

		inView.forEach(function (el, i) { revealNow(el, Math.min(i * 62, 400)); });

		if (later.length && 'IntersectionObserver' in global) {
			revealObserver = new IntersectionObserver(function (entries) {
				var k = 0;
				entries.forEach(function (en) {
					if (!en.isIntersecting) return;
					revealObserver.unobserve(en.target);
					revealNow(en.target, Math.min(k++ * 70, 280));
				});
			}, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
			later.forEach(function (el) { revealObserver.observe(el); });
		} else {
			later.forEach(function (el) { revealNow(el, 0); });
		}

		/* 兜底: 万一 observer 没触发, 8 秒后强制显示, 不留空白 */
		clearTimeout(revealTimer);
		revealTimer = setTimeout(function () {
			Array.prototype.forEach.call(page.querySelectorAll('[data-smear]:not(.is-revealed)'), function (el) {
				revealNow(el, 0);
			});
		}, 8000);
	}

	/* ------------------------------------------------------------ 位移中的运动模糊 */

	/* 注意: 这里**不能**包含 .dock__indicator。
	   光点的 .is-moving 由 dock.js 专门管理(它还要负责 --dir / --ind-stretch),
	   而 --ind-stretch 会改变 transform → 又触发 transitionrun → 再加 .is-moving,
	   两边互相触发会变成死循环, 光点会一直抖。 */
	var MOVE_SELECTOR = '.btn, .badge, .card, .sim-card, .dock__item, .dock-menu__item, ' +
		'.file-row, .term-suggest button';
	var MOVE_PROPS = { transform: 1, 'padding-left': 1, 'padding-right': 1, top: 1, left: 1 };
	var moveTimers = new WeakMap();

	function markMoving(el) {
		el.classList.add('is-moving');
		clearTimeout(moveTimers.get(el));
		/* 兜底: 过渡被打断时 transitionend 不一定来 */
		moveTimers.set(el, setTimeout(function () {
			el.classList.remove('is-moving');
			moveTimers.delete(el);
		}, 760));
	}

	function clearMoving(el) {
		clearTimeout(moveTimers.get(el));
		moveTimers.delete(el);
		el.classList.remove('is-moving');
	}

	/**
	 * 任何"会动"的过渡(transform / padding-left / top / left)一旦开始,
	 * 就给元素加上 .is-moving 做运动模糊, 过渡结束再摘掉。
	 * 这样悬停放大、按下缩小、列表行缩进都会带上一层拖动感。
	 */
	function initMotionBlur() {
		if (reduced()) return;

		doc.addEventListener('transitionrun', function (e) {
			if (!MOVE_PROPS[e.propertyName]) return;
			var el = e.target;
			if (!el || !el.classList || !el.matches || !el.matches(MOVE_SELECTOR)) return;
			markMoving(el);
		}, true);

		doc.addEventListener('transitionend', function (e) {
			if (!MOVE_PROPS[e.propertyName]) return;
			var el = e.target;
			if (!el || !el.classList || !el.classList.contains('is-moving')) return;
			clearMoving(el);
		}, true);

		doc.addEventListener('transitioncancel', function (e) {
			var el = e.target;
			if (el && el.classList && el.classList.contains('is-moving')) clearMoving(el);
		}, true);
	}

	/* ------------------------------------------------------------ 主题擦除 */

	function themeWipe(toTheme, apply) {
		if (reduced() || typeof apply !== 'function') { if (apply) apply(); return; }
		var toLight = toTheme === 'light';

		var overlay = doc.createElement('div');
		overlay.className = 'theme-wipe';
		overlay.setAttribute('data-to', toLight ? 'light' : 'dark');
		overlay.style.transformOrigin = toLight ? 'top center' : 'bottom center';
		doc.body.appendChild(overlay);

		global.requestAnimationFrame(function () {
			overlay.classList.add('is-active');
			setTimeout(function () {
				apply();
				overlay.classList.add('is-out');
				setTimeout(function () { overlay.remove(); }, 560);
			}, 360);
		});
	}

	/* ------------------------------------------------------------ 路由扫描 */

	var sweepEl = null;
	function routeSweep() {
		if (reduced()) return;
		if (sweepEl) { sweepEl.remove(); sweepEl = null; }
		sweepEl = doc.createElement('div');
		sweepEl.className = 'fx-sweep';
		doc.body.appendChild(sweepEl);
		sweepEl.addEventListener('animationend', function () {
			if (sweepEl) { sweepEl.remove(); sweepEl = null; }
		});
	}

	/* ------------------------------------------------------------ 小反馈 */

	function spin(el) {
		if (!el || reduced()) return;
		el.classList.remove('is-spinning');
		void el.offsetWidth;
		el.classList.add('is-spinning');
		setTimeout(function () { el.classList.remove('is-spinning'); }, 500);
	}

	function pop(el) {
		if (!el || reduced()) return;
		el.classList.remove('is-popped');
		void el.offsetWidth;
		el.classList.add('is-popped');
		setTimeout(function () { el.classList.remove('is-popped'); }, 500);
	}

	/* ------------------------------------------------------------ 初始化 */

	function init() {
		initRipple();
		initSpotlight();
		initMotionBlur();
		doc.addEventListener('route:changed', routeSweep);
		/* 切语言后 i18n 会重写文本, 逐字标题要重新拆一次 */
		doc.addEventListener('i18n:applied', function () { splitAll(doc); });
		if (reduced()) doc.documentElement.classList.add('fx-no-motion');
	}

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
	else init();

	global.Motion = {
		entrance: entrance,
		reveal: revealNow,
		splitChars: splitChars,
		ripple: spawnRipple,
		themeWipe: themeWipe,
		routeSweep: routeSweep,
		spin: spin,
		pop: pop,
		get reduced() { return reduced(); }
	};
})(window);
