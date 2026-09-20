/**
 * motion-pref.js — 动效偏好(最先加载)
 *
 * 为什么需要它:
 *   系统/浏览器开了「减少动态效果」时, 之前那份 CSS 用
 *     *, *::before, *::after { transition-duration: .001ms !important }
 *   把所有过渡和循环动画一刀切了 —— 结果悬停放大是"啪"地跳、
 *   描边高光定在原地不动, 看起来就像"完全没有动画"。
 *
 * 现在改为:
 *   - 只关掉真正会引起不适的**大幅 / 长时间**动效(整屏过渡、扫描带、主题擦除、
 *     逐字入场、光点甩尾、循环装饰), 小的交互反馈(悬停放大、按下缩小、颜色/边框
 *     过渡、描边高光旋转)保留;
 *   - 想全部打开的话, 访问 ?motion=full 即可(会记住), ?motion=reduce 可以再关回去,
 *     ?motion=auto 恢复跟随系统。
 *
 * 结果:
 *   window.MotionPref.reduced  → 给 JS 用
 *   <html class="reduce-motion" data-motion="reduced|full">  → 给 CSS 用
 */
(function (global) {
	'use strict';

	var KEY = 'dsh.motion';
	var doc = global.document;
	var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
	var systemReduced = !!(mq && mq.matches);

	var override = null;
	try {
		var fromQuery = new URLSearchParams(global.location.search).get('motion');
		if (fromQuery === 'full' || fromQuery === 'reduce' || fromQuery === 'auto') {
			override = fromQuery === 'auto' ? null : fromQuery;
			if (fromQuery === 'auto') global.localStorage.removeItem(KEY);
			else global.localStorage.setItem(KEY, fromQuery);
		} else {
			override = global.localStorage.getItem(KEY);
			if (override !== 'full' && override !== 'reduce') override = null;
		}
	} catch (err) { /* localStorage / URLSearchParams 不可用就忽略 */ }

	var reduced = override === 'full' ? false : (override === 'reduce' ? true : systemReduced);
	var source = override === 'full' ? 'override-full'
		: override === 'reduce' ? 'override-reduce'
		: (systemReduced ? 'system' : 'default');

	function apply() {
		var html = doc.documentElement;
		html.classList.toggle('reduce-motion', reduced);
		html.setAttribute('data-motion', reduced ? 'reduced' : 'full');
	}
	apply();

	if (mq) {
		var onChange = function () {
			systemReduced = !!mq.matches;
			if (override) return;
			var next = systemReduced;
			if (next === reduced) return;
			reduced = next;
			apply();
			doc.dispatchEvent(new CustomEvent('motion:changed', { detail: { reduced: reduced } }));
		};
		if (mq.addEventListener) mq.addEventListener('change', onChange);
		else if (mq.addListener) mq.addListener(onChange);
	}

	global.MotionPref = {
		reduced: reduced,
		systemReduced: systemReduced,
		source: source,
		/** 'full' | 'reduce' | 'auto' —— 会重载页面让所有模块重新初始化 */
		set: function (mode) {
			try {
				if (!mode || mode === 'auto') global.localStorage.removeItem(KEY);
				else global.localStorage.setItem(KEY, mode);
			} catch (err) { /* 忽略 */ }
			global.location.reload();
		},
		KEY: KEY
	};
})(window);
