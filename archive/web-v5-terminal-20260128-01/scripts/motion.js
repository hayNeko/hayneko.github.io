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

		/* 入场**不生成克隆残影**(ghosts: 0)。
		   克隆残影的本质就是"同一份内容的另一个 DOM 节点", 只要它和主体拉开几像素,
		   看着就是"复制了一份元素/有虚影" —— 调模糊和不透明度只能减轻, 治不了根。
		   运动模糊改由 keyframes 里的 filter: blur() 提供: 速度快时糊、落位清晰。
		   克隆拖影只留给 header 的菜单和开机屏(那里本来就想要"残影"的味道)。 */
		var base = { duration: 500, delay: delay, ghosts: 0 };
		var handle = null;
		var total = 0;

		if (mode === 'drop') {
			handle = global.Smear.dropIn(el, { duration: 500, delay: delay, ghosts: 0 });
			total = delay + 500;
		} else if (mode === 'slide') {
			handle = global.Smear.slideIn(el, { duration: 500, delay: delay, ghosts: 0 });
			total = delay + 500;
		} else {
			handle = global.Smear.popIn(el, base);
			total = delay + 500;
		}

		/* 入场跑完**立刻**释放动画, 而且要和动画自己的结束时刻对齐。
		 *
		 * 两件事都靠这一下:
		 *   1. Smear 用的是 fill:'both', 不释放它会一直占着 transform ——
		 *      之后 :hover 放大 / :active 缩小 根本盖不过它(卡片点了没反应就是这个原因);
		 *   2. 更隐蔽的一条: 只要动画还挂着, filter 就一直是"有值"的 ——
		 *      哪怕已经插值到 blur(0), 元素依然被当成**带滤镜的合成层**在渲染,
		 *      真实显卡上会先栅格化成纹理再缩放, 看着就是"动画结束后还糊一小会"。
		 *      原来写的是 setTimeout(total + 90), 那 90ms 就是这个糊尾巴。
		 *
		 * 所以改等动画自己的 finished.promise。 */
		var released = false;
		var release = function () {
			if (released) return;
			released = true;
			if (handle && handle.dispose) { try { handle.dispose(); } catch (err) { /* 忽略 */ } }
		};
		if (handle && handle.main && handle.main.finished && handle.main.finished.then) {
			handle.main.finished.then(release).catch(function () { /* 被打断就算了 */ });
		}
		/* 兜底: finished 万一不来, 也不能让动画一直挂着 */
		setTimeout(release, total + 120);
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

	/* 只挑交互反馈类元素。坞里的按钮本身没有 transform 过渡以外的花样,
	   而且坞底那条指示条已经删掉了, 不需要再排除谁。 */
	var MOVE_SELECTOR = '.btn, .badge, .card, .sim-card, .dock__item, .dock-menu__item, ' +
		'.file-row, .term-suggest button';
	var MOVE_PROPS = { transform: 1, 'padding-left': 1, 'padding-right': 1, top: 1, left: 1 };
	/* el -> { props: { 属性: 在跑的过渡数 }, fallback: 兜底计时器 } */
	var moveState = new WeakMap();

	function parseMs(value) {
		value = String(value || '').trim();
		if (value.slice(-2) === 'ms') return parseFloat(value) || 0;
		if (value.slice(-1) === 's') return (parseFloat(value) || 0) * 1000;
		return 0;
	}

	/** 这个元素在这个属性上的过渡一共要跑多久(时长 + 延迟); 读不到就按 300ms 算 */
	function transitionMs(el, prop) {
		var cs = global.getComputedStyle(el);
		var props = String(cs.transitionProperty || '').split(',');
		var durs = String(cs.transitionDuration || '').split(',');
		var delays = String(cs.transitionDelay || '').split(',');
		var longest = 0;
		for (var i = 0; i < props.length; i++) {
			var name = props[i].trim();
			if (name !== prop && name !== 'all') continue;
			var ms = parseMs(durs[i % durs.length]) + parseMs(delays[i % delays.length]);
			if (ms > longest) longest = ms;
		}
		return longest || 300;
	}

	/* 模糊量跟着**速度**走, 不再是个定值:
	   悬停放大只有 2%(卡片) 到 14%(坞图标), 一律糊 0.9px 的话,
	   小位移元素的文字就先糊了 —— 明明几乎没动。改成按实际位移速度给模糊。 */
	var MOVE_BLUR_PER_SPEED = 3.2;   /* 模糊(px) = 速度(px/ms) × 这个系数 */
	var MOVE_BLUR_MIN_SPEED = 0.02;  /* 慢于这个当没动, 直接清晰, 免得挂着一层噪声级模糊 */

	function moveBlurCap(el) {
		var raw = global.getComputedStyle(el).getPropertyValue('--fx-move-max');
		var cap = parseFloat(raw);
		return isFinite(cap) && cap > 0 ? cap : 0.7;
	}

	/** 每帧量一下元素真的移动了多少, 换算成模糊 —— 停下来自然就回到 0 */
	function trackMoving(el) {
		var st = moveState.get(el);
		if (!st || st.raf) return;
		var cap = moveBlurCap(el);
		var prev = el.getBoundingClientRect();
		var prevAt = global.performance ? global.performance.now() : Date.now();
		var frame = function (now) {
			var live = moveState.get(el);
			if (!live || !el.isConnected) return;
			var rect = el.getBoundingClientRect();
			var dt = Math.max(8, now - prevAt);
			var moved = Math.max(
				Math.abs(rect.left - prev.left),
				Math.abs(rect.top - prev.top),
				Math.abs(rect.width - prev.width),
				Math.abs(rect.height - prev.height)
			);
			var speed = moved / dt;
			var blur = speed < MOVE_BLUR_MIN_SPEED ? 0 : Math.min(cap, speed * MOVE_BLUR_PER_SPEED);
			el.style.setProperty('--fx-move-blur', blur.toFixed(2) + 'px');
			prev = rect;
			prevAt = now;
			live.raf = global.requestAnimationFrame(frame);
		};
		st.raf = global.requestAnimationFrame(frame);
	}

	function markMoving(el, prop, runningMs) {
		var st = moveState.get(el);
		if (!st) { st = { props: {}, fallback: 0, raf: 0 }; moveState.set(el, st); }
		st.props[prop] = (st.props[prop] || 0) + 1;
		el.classList.add('is-moving');
		trackMoving(el);
		clearTimeout(st.fallback);
		/* 兜底: 过渡被打断时 transitionend 不一定来。给到"这段过渡跑完"就够了, 不再瞎等 760ms */
		st.fallback = setTimeout(function () { dropMoving(el); }, runningMs + 150);
	}

	/**
	 * 一个属性的过渡结束了。**全部**动着的属性都结束了才摘模糊 ——
	 * 以前是"谁先结束就摘", 于是 .file-row 这种"缩放 240ms + 左移 420ms"的元素
	 * 会在左移还没完的时候就变清晰(实测 397ms 就摘了, 位移一直到 591ms 才停)。
	 */
	function releaseMoving(el, prop) {
		var st = moveState.get(el);
		if (!st || !st.props[prop]) return;
		st.props[prop]--;
		if (st.props[prop] > 0) return;
		delete st.props[prop];
		for (var key in st.props) { if (st.props[key] > 0) return; }
		dropMoving(el);
	}

	function dropMoving(el) {
		var st = moveState.get(el);
		if (st) {
			clearTimeout(st.fallback);
			if (st.raf) global.cancelAnimationFrame(st.raf);
		}
		moveState.delete(el);
		el.classList.remove('is-moving');
		el.style.setProperty('--fx-move-blur', '0px');
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
			/* 伪元素自己的过渡(按钮扫光 ::after、卡片高光 ::before)不算"元素在动",
			   否则模糊会被这些装饰性的扫光拖长 */
			if (e.pseudoElement) return;
			var el = e.target;
			if (!el || !el.classList || !el.matches || !el.matches(MOVE_SELECTOR)) return;
			markMoving(el, e.propertyName, transitionMs(el, e.propertyName));
		}, true);

		doc.addEventListener('transitionend', function (e) {
			if (!MOVE_PROPS[e.propertyName] || e.pseudoElement) return;
			releaseMoving(e.target, e.propertyName);
		}, true);

		doc.addEventListener('transitioncancel', function (e) {
			if (!MOVE_PROPS[e.propertyName] || e.pseudoElement) return;
			releaseMoving(e.target, e.propertyName);
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
		get reduced() { return reduced(); }
	};
})(window);
