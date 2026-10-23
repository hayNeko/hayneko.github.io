/**
 * dse-labs.js — DSE 物理實驗頁的註冊表 + 載入器
 *
 * 為什麼要有載入器: 一頁掛 12 個 canvas, 沒人想讓 12 支模組各自處理
 * 「看不到就別畫」「裝置像素比」「頁面被丟棄要收線」這幾件事 —— 那會變成
 * 12 份寫法略有不同的樣板。模組只寫自己的物理與畫面, 其餘由這裡給。
 * 註冊表只有一個全域: DSELab。
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var TEX_OPTS = {
		delimiters: [
			{ left: '\\(', right: '\\)', display: false },
			{ left: '\\[', right: '\\]', display: true }
		],
		throwOnError: false,
		ignoredClasses: ['dl-no-tex']
	};
		var factories = {};
	var order = [];
	var contexts = [];
	var booted = false;

	function define(id, factory) {
		if (!id || typeof factory !== 'function') return;
		if (!factories[id]) order.push(id);
		factories[id] = factory;
	}
	function get(id) { return factories[id] || null; }
	function list() { return order.slice(); }

	function texAt(node) {
		if (global.renderMathInElement && node) global.renderMathInElement(node, TEX_OPTS);
	}

	/* 顏色只在建立 ctx 時讀一次: 12 個實驗 × 每幀讀計算樣式會把版面逼出 reflow */
	function readColors(el) {
		var cs = global.getComputedStyle(el);
		function v(name) { return (cs.getPropertyValue(name) || '').trim(); }
		return {
			accent: v('--accent'), accentRgb: v('--accent-rgb'), accentSoft: v('--accent-soft'),
			ink: v('--fg'), inkDim: v('--fg-dim'), inkFaint: v('--fg-faint'),
			line: v('--line'), lineStrong: v('--line-strong'),
			paper0: v('--paper-0'), paper1: v('--paper-1'), paper2: v('--paper-2')
		};
	}

	function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
	function lerp(a, b, t) { return a + (b - a) * t; }

	/* 讀數: 固定小數位再削掉尾零, 拖滑桿時數字不會忽長忽短 */
	function fmt(n, d) {
		if (typeof n !== 'number' || !isFinite(n)) return '—';
		var s = n.toFixed(d == null ? 2 : d);
		if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
		return s === '-0' ? '0' : s;
	}

	function makeCtx(id, el) {
		var loops = [];
		var visSubs = [];
		var destroySubs = [];
		var observers = [];
		var onscreen = false;
		var visible = false;
		var disposed = false;
		var api = null;

		function call(fn, arg) {
			try { fn(arg); } catch (err) { console.error('[dse-lab] ' + id, err); }
		}

		function setVisible(next) {
			next = !!next && !doc.hidden;
			if (next === visible) return;
			visible = next;
			for (var i = 0; i < visSubs.length; i++) call(visSubs[i], visible);
			if (visible) for (var j = 0; j < loops.length; j++) loops[j].wake();
		}

		function sync() { setVisible(onscreen); }

		function setupCanvas(canvas, opts) {
			opts = opts || {};
			var view = { ctx2d: canvas.getContext('2d'), w: 1, h: 1, dpr: 1 };
			canvas.style.width = '100%';
			canvas.style.display = 'block';
			canvas.style.aspectRatio = opts.aspect || '16 / 10';

			/* 模組每幀自己讀 view.w / view.h, 所以這裡就地改同一個物件 */
			function resize() {
				var rect = canvas.getBoundingClientRect();
				if (!rect.width) return;   /* 還不在版面裡(或 display:none), 等下一次 RO 回報 */
				var dpr = Math.min(global.devicePixelRatio || 1, 2);
				var w = Math.max(1, Math.round(rect.width));
				/* 上限量 CSS 像素: 一張 3x 點陣的高畫布在手機上會吃掉整頁記憶體預算 */
				var h = Math.max(1, Math.round(Math.min(rect.height || w * 0.625, 900)));
				if (w === view.w && h === view.h && dpr === view.dpr) return;
				view.w = w;
				view.h = h;
				view.dpr = dpr;
				canvas.width = Math.round(w * dpr);
				canvas.height = Math.round(h * dpr);
				view.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
			}

			resize();
			if (global.ResizeObserver) {
				var ro = new global.ResizeObserver(resize);
				ro.observe(canvas);
				observers.push(ro);
			}
			return view;
		}

		function raf(fn) {
			var queued = 0;
			var last = 0;
			var elapsed = 0;
			var stopped = false;

			function tick(now) {
				queued = 0;
				if (stopped || !visible) return;
				var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
				last = now;
				elapsed += dt;
				try { fn(dt, elapsed); } catch (err) { console.error('[dse-lab] ' + id, err); }
				if (stopped || !visible || queued) return;
				queued = global.requestAnimationFrame(tick);
			}

			function wake() {
				if (stopped || !visible || queued) return;
				last = 0;   /* 停過一段時間再回來, 第一幀的 dt 不跳 */
				queued = global.requestAnimationFrame(tick);
			}

			var handle = {
				wake: wake,
				stop: function () {
					stopped = true;
					if (queued) global.cancelAnimationFrame(queued);
					queued = 0;
					var i = loops.indexOf(handle);
					if (i >= 0) loops.splice(i, 1);
				}
			};
			loops.push(handle);
			wake();
			return handle.stop;
		}

		function onVisible(fn) {
			visSubs.push(fn);
			call(fn, visible);
			return function () {
				var i = visSubs.indexOf(fn);
				if (i >= 0) visSubs.splice(i, 1);
			};
		}

		function onResize(fn) {
			var hit = function () { call(fn); };
			global.addEventListener('resize', hit);
			var ro = global.ResizeObserver ? new global.ResizeObserver(hit) : null;
			if (ro) ro.observe(el);
			return function () {
				global.removeEventListener('resize', hit);
				if (ro) ro.disconnect();
			};
		}

		function onDestroy(fn) { if (typeof fn === 'function') destroySubs.push(fn); }
		function tex(node) { texAt(node); }

		function dispose() {
			if (disposed) return;
			disposed = true;
			while (loops.length) loops[0].stop();
			for (var i = 0; i < observers.length; i++) observers[i].disconnect();
			observers.length = 0;
			visSubs.length = 0;
			var at = contexts.indexOf(api);
			if (at >= 0) contexts.splice(at, 1);
			var subs = destroySubs.slice();
			destroySubs.length = 0;
			for (var j = 0; j < subs.length; j++) {
				try { subs[j](); } catch (err) { console.error('[dse-lab] ' + id, err); }
			}
		}

		api = {
			id: id,
			el: el,
			reduced: !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches),
			colors: readColors(el),
			clamp: clamp,
			lerp: lerp,
			fmt: fmt,
			tex: tex,
			setupCanvas: setupCanvas,
			raf: raf,
			onVisible: onVisible,
			onResize: onResize,
			onDestroy: onDestroy,
			dispose: dispose,
			syncVisibility: sync
		};

		if (global.IntersectionObserver) {
			var io = new global.IntersectionObserver(function (entries) {
				onscreen = entries[entries.length - 1].isIntersecting;
				sync();
			}, { rootMargin: '160px 0px' });
			io.observe(el);
			observers.push(io);
		} else {
			onscreen = true;
			sync();
		}

		contexts.push(api);
		return api;
	}

	function mountLab(section) {
		var id = section.getAttribute('data-lab');
		var factory = get(id);
		/* 掛載點是 section 裡那個 [data-mount], 不是 section 本身: 標題/描述/
		   公式都留在外面, 模組只拿到它該畫的那一格 */
		var el = section.querySelector('[data-mount]') || section;
		var ctx = makeCtx(id, el);

		if (!factory) {
			el.textContent = '';
			var miss = doc.createElement('p');
			miss.className = 'dl-lab__pending';
			miss.textContent = '此實驗尚未載入';
			el.appendChild(miss);
			return;
		}

		try {
			var inst = factory(el, ctx);
			if (inst && typeof inst.destroy === 'function') ctx.onDestroy(inst.destroy);
		} catch (err) {
			console.error('[dse-lab] ' + id, err);
			el.textContent = '';
			var box = doc.createElement('div');
			box.className = 'dl-lab__error';
			box.textContent = '實驗 ' + id + ' 載入失敗：' + (err && err.message ? err.message : String(err));
			el.appendChild(box);
			ctx.dispose();
		}
	}

	function boot() {
		if (booted) return;
		booted = true;
		texAt(doc.body);   /* 頁面層公式先算完, 模組之後只補自己 mount 裡的那些 */
		var els = doc.querySelectorAll('[data-lab]');
		for (var i = 0; i < els.length; i++) mountLab(els[i]);
		doc.dispatchEvent(new global.CustomEvent('dselab:ready'));
	}

	doc.addEventListener('visibilitychange', function () {
		for (var i = 0; i < contexts.length; i++) contexts[i].syncVisibility();
	});

	global.addEventListener('pagehide', function () {
		var all = contexts.slice();
		for (var i = 0; i < all.length; i++) all[i].dispose();
	});

	/* 一定要等 DOMContentLoaded: 12 支模組是 defer, 在 dse-labs.js 之後才執行,
	   readyState 這時已經是 'interactive' 但註冊還沒發生, 提早 boot 會全部
	   當成「尚未載入」。只有本檔被動態插進已完成的頁面時才直接跑。 */
	if (doc.readyState === 'complete') boot();
	else doc.addEventListener('DOMContentLoaded', boot);

	global.DSELab = { define: define, get: get, list: list, boot: boot, tex: texAt };
})(window);
