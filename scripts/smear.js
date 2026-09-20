/**
 * smear.js — DOM 运动模糊 (Motion Blur / Smear) 引擎
 *
 * 原理与 deepseek_html_..._smear_motion_demo.html 中的 canvas 版本一致:
 *   1. 主元素沿轨迹运动;
 *   2. 在运动方向上叠加 N 个"残影", 每个残影都沿同一条轨迹、但时间上滞后 lag 毫秒;
 *   3. 残影越靠后, 透明度越低、模糊半径越大 —— 形成拖尾;
 *   4. 残影使用 mix-blend-mode: screen(等价 canvas 的 'lighter'), 叠加处更亮。
 *
 * 残影放在 #smear-host (position: fixed) 里, 因此:
 *   - 不会被父级的 overflow: hidden 裁掉, 拖影可以飞出面板;
 *   - 统一使用视口坐标, 无需处理 offsetParent 链。
 *
 * 用法:
 *   Smear.play(el, keyframes, { duration, easing, delay, ghosts, lag, blur, fade, blend })
 *   Smear.dropIn(el, { duration, delay, ghosts, stretch })
 *   Smear.slideOut(el, { ... })
 *
 * ghostsOnly: true —— 只生成拖影, 不动主元素。
 * 主元素交给 CSS transition 驱动时用这个模式, 避免 WAAPI 与 CSS 抢同一个属性。
 * 只要两边用同一组 keyframes 值、同一 duration/easing/delay, 拖影就会贴合主元素。
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;

	function reduced() {
		if (global.MotionPref) return !!global.MotionPref.reduced;
		return !!(mq && mq.matches);
	}

	var host = null;
	function getHost() {
		if (host && host.isConnected) return host;
		host = doc.getElementById('smear-host');
		if (!host) {
			host = doc.createElement('div');
			host.id = 'smear-host';
			host.className = 'smear-host';
			host.setAttribute('aria-hidden', 'true');
			doc.body.appendChild(host);
		}
		return host;
	}

	var DEFAULTS = {
		duration: 500,
		easing: 'cubic-bezier(0.15, 1, 0, 1)',
		delay: 0,
		ghosts: 5,
		lag: 30,
		blur: 1.6,
		fade: 0.52,
		blend: 'screen',
		tail: 150,
		ghostsOnly: false
	};

	/**
	 * 在"去掉 transform"的状态下测量元素, 得到不受动画影响的视口矩形。
	 * 这样残影的起点与主元素的布局位置完全一致, 套用同一组 keyframes 即可重合。
	 */
	function measure(el) {
		var prevTransform = el.style.transform;
		var prevTransition = el.style.transition;
		el.style.transition = 'none';
		el.style.transform = 'none';
		var rect = el.getBoundingClientRect();
		el.style.transform = prevTransform;
		el.style.transition = prevTransition;
		return rect;
	}

	function buildGhost(target, rect, opts) {
		var ghost = target.cloneNode(true);
		ghost.removeAttribute('id');
		var withId = ghost.querySelectorAll('[id]');
		for (var i = 0; i < withId.length; i++) withId[i].removeAttribute('id');
		ghost.setAttribute('aria-hidden', 'true');
		ghost.classList.add('smear-ghost');
		ghost.style.cssText =
			'position:absolute' +
			';left:' + rect.left + 'px' +
			';top:' + rect.top + 'px' +
			';width:' + rect.width + 'px' +
			';height:' + rect.height + 'px' +
			';margin:0' +
			';pointer-events:none' +
			';mix-blend-mode:' + opts.blend +
			';opacity:0';
		return ghost;
	}

	/** 把一组 keyframes 变成第 i 层残影的 keyframes: 降透明度 + 加方向性模糊 */
	function ghostKeyframes(keyframes, index, opts) {
		var factor = Math.pow(opts.fade, index);
		var blurPx = opts.blur * index;
		return keyframes.map(function (kf) {
			var out = {};
			for (var key in kf) {
				if (Object.prototype.hasOwnProperty.call(kf, key)) out[key] = kf[key];
			}
			var base = typeof out.opacity === 'number' ? out.opacity : 1;
			out.opacity = Math.max(0, base * factor);
			if (blurPx > 0.05) {
				out.filter = (out.filter ? out.filter + ' ' : '') + 'blur(' + blurPx.toFixed(2) + 'px)';
			}
			return out;
		});
	}

	/**
	 * 播放一次带 smear 的动画。
	 * @returns {{ main: Animation, ghosts: Array, dispose: Function }}
	 */
	function play(target, keyframes, options) {
		var result = { main: null, ghosts: [], dispose: function () {}, ghostsOnly: !!(options && options.ghostsOnly) };
		if (!target || !target.animate) return result;

		var opts = {};
		for (var k in DEFAULTS) {
			if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) opts[k] = DEFAULTS[k];
		}
		if (options) {
			for (var k2 in options) {
				if (Object.prototype.hasOwnProperty.call(options, k2)) opts[k2] = options[k2];
			}
		}

		var timing = {
			duration: opts.duration,
			easing: opts.easing,
			delay: opts.delay,
			fill: 'both'
		};

		if (!opts.ghostsOnly) {
			result.main = target.animate(keyframes, timing);
		}

		var count = reduced() ? 0 : Math.max(0, opts.ghosts | 0);
		var timers = [];

		if (count > 0) {
			var rect = measure(target);
			var container = getHost();
			var group = [];

			for (var i = 1; i <= count; i++) {
				var ghost = buildGhost(target, rect, opts);
				container.appendChild(ghost);
				var anim = ghost.animate(ghostKeyframes(keyframes, i, opts), {
					duration: opts.duration,
					easing: opts.easing,
					delay: opts.delay + opts.lag * i,
					fill: 'both'
				});
				group.push({ el: ghost, anim: anim });
			}
			result.ghosts = group;

			var tailAt = opts.delay + opts.duration + opts.lag * count + 10;
			timers.push(setTimeout(function () {
				group.forEach(function (item) {
					if (!item.el.isConnected) return;
					var current = parseFloat(global.getComputedStyle(item.el).opacity) || 0;
					var fade = item.el.animate(
						[{ opacity: current }, { opacity: 0 }],
						{ duration: opts.tail, easing: 'linear', fill: 'forwards' }
					);
					fade.finished.then(function () {
						item.anim.cancel();
						item.el.remove();
					}).catch(function () { /* 被取消, 忽略 */ });
				});
			}, tailAt));
		}

		result.dispose = function () {
			timers.forEach(clearTimeout);
			if (result.main) {
				try { result.main.cancel(); } catch (e) { /* noop */ }
			}
			result.ghosts.forEach(function (item) {
				try { item.anim.cancel(); } catch (e) { /* noop */ }
				item.el.remove();
			});
			result.ghosts = [];
		};

		return result;
	}

	/** 从上方带 smear 落下的入场 */
	function dropIn(el, options) {
		var opts = options || {};
		var stretch = opts.stretch == null ? 1.34 : opts.stretch;
		var squash = opts.squash == null ? 0.95 : opts.squash;
		var kfs = [
			{ offset: 0, transform: 'translateY(-205%) scaleY(' + stretch + ')', opacity: 0 },
			{ offset: 0.62, transform: 'translateY(9%) scaleY(' + squash + ')', opacity: 1 },
			{ offset: 0.82, transform: 'translateY(-2.5%) scaleY(1.02)', opacity: 1 },
			{ offset: 1, transform: 'translateY(0) scaleY(1)', opacity: 1 }
		];
		return play(el, kfs, opts);
	}

	/** 向上抽走的退场 */
	function liftOut(el, options) {
		var opts = options || {};
		var kfs = [
			{ offset: 0, transform: 'translateY(0)', opacity: 1 },
			{ offset: 0.32, transform: 'translateY(-4%) scaleY(1.06)', opacity: 1 },
			{ offset: 1, transform: 'translateY(-150%) scaleY(0.92)', opacity: 0 }
		];
		return play(el, kfs, Object.assign({ duration: 300 }, opts));
	}

	/** 侧向滑入(用于标题 / 段落) */
	function slideIn(el, options) {
		var opts = options || {};
		var from = opts.from == null ? -26 : opts.from;
		var kfs = [
			{ offset: 0, transform: 'translateX(' + from + 'px)', opacity: 0 },
			{ offset: 0.7, transform: 'translateX(3px)', opacity: 1 },
			{ offset: 1, transform: 'translateX(0)', opacity: 1 }
		];
		return play(el, kfs, Object.assign({ duration: 460, delay: opts.delay || 0, ghosts: 4 }, opts));
	}

	/** 缩放淡入 */
	function popIn(el, options) {
		var opts = options || {};
		var kfs = [
			{ offset: 0, transform: 'translateY(16px) scale(0.97)', opacity: 0 },
			{ offset: 0.7, transform: 'translateY(-2px) scale(1.004)', opacity: 1 },
			{ offset: 1, transform: 'translateY(0) scale(1)', opacity: 1 }
		];
		return play(el, kfs, Object.assign({ duration: 480, ghosts: 3, blur: 1.2 }, opts));
	}

	global.Smear = {
		play: play,
		dropIn: dropIn,
		liftOut: liftOut,
		slideIn: slideIn,
		popIn: popIn,
		get reduced() { return reduced(); },
		defaults: DEFAULTS
	};
})(window);
