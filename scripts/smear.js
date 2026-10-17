/**
 * smear.js — DOM 运动模糊 (Motion Blur / Smear) 引擎
 *
 * 原理:
 *   1. 主元素沿轨迹运动;
 *   2. 在运动方向上叠加 N 个"残影", 每个残影沿同一条轨迹、但时间上滞后 lag 毫秒;
 *   3. 残影越靠后, 透明度越低、模糊半径越大 —— 形成拖尾;
 *   4. 残影用普通叠加(blend: normal)而不是 screen —— 因为本站同时有纸张(浅底)
 *      与墨底两种版式, screen 在浅底上会把拖影叠成白色, 反而像"复制了一份元素"。
 *      normal + 低透明度在两种底上都读得出"一条干净利落的拖影"。
 *
 * 残影放在 #smear-host (position: fixed) 里, 因此:
 *   - 不会被父级的 overflow: hidden 裁掉, 拖影可以飞出面板;
 *   - 统一使用视口坐标, 无需处理 offsetParent 链。
 *
 * 用法:
 *   Smear.play(el, keyframes, { duration, easing, delay, ghosts, lag, blur, fade, blend })
 *   Smear.dropIn(el, { duration, delay, ghosts, stretch })
 *   Smear.slideIn(el, { duration, delay, stretch })
 *   Smear.popIn(el, { duration, delay })
 *
 * ghostsOnly: true —— 只生成拖影, 不动主元素(主元素交给 CSS transition 驱动时用)。
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;

	function reduced() {
		if (global.MotionPref) return !!global.MotionPref.reduced;
		return !!(mq && mq.matches);
	}

	function parseMs(value) {
		value = String(value || '').trim();
		if (value.slice(-2) === 'ms') return parseFloat(value) || 0;
		if (value.slice(-1) === 's') return (parseFloat(value) || 0) * 1000;
		return 0;
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

	/*
	 * 调参要点 —— "看起来是糊的" vs "看起来是两个元素":
	 *   拖影之间隔的是**时间**(lag), 元素动得快时 lag 大 = 空间上离得远 = 一眼看出是两份;
	 *   所以 lag 要小、层数要多, 让相邻残影互相叠住连成一片;
	 *   同时第一层就得有足够模糊, 否则它就是一份清晰的拷贝。
	 */
	var DEFAULTS = {
		duration: 520,
		easing: 'cubic-bezier(0.15, 1, 0, 1)',
		delay: 0,
		ghosts: 8,
		lag: 7,
		blur: 4.2,
		fade: 0.34,
		/* 普通叠加: 纸张底与墨底都能读, 不用 screen(浅底上会发白) */
		blend: 'normal',
		tail: 170,
		ghostsOnly: false
	};

	/**
	 * 拖影动画要用 CSS 自己的过渡时长, 否则残影会比主元素先停/后停。
	 * 读不到就退回 opts.duration。
	 */
	function resolveDuration(target, prop, opts) {
		if (!target || !prop || !global.getComputedStyle) return opts.duration;
		var cs = global.getComputedStyle(target);
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
		return longest || opts.duration;
	}

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
		/* 模糊半径也要封顶, 否则最外层是一团 20px+ 的糊, 又贵又难看 */
		var blurPx = Math.min(opts.blur * index, 18);
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

		/* 不传 duration 时, 自动贴合主元素在该属性上的 CSS 过渡时长 */
		if (opts.follow && !(options && options.duration != null)) {
			opts.duration = resolveDuration(target, opts.followProp, opts);
		}

		/* 主元素用 fill: 'both' —— 最后一帧是自然状态(transform: none / filter: none),
		   动画跑完由 motion.js 在 finished 上 dispose, 所以不会长期挂着滤镜层。 */
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
					fill: 'forwards'
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

	/*
	 * 落版(dropIn):
	 * 起手是"被上方的速度拉长"的形态 —— 竖向拉伸 + 一点点横向压窄, 再加整体偏斜。
	 * 这就是"文字在动画过程中被大幅度拉伸"的来源; 最后一帧必须是 none,
	 * 否则元素会一直挂着一个 filter, 停下来还发糊。
	 */
	function dropIn(el, options) {
		var opts = options || {};
		var stretch = opts.stretch == null ? 1.52 : opts.stretch;
		var squash = opts.squash == null ? 0.96 : opts.squash;
		var kfs = [
			{ offset: 0,    transform: 'translateY(-175%) skewY(-2.4deg) scaleY(' + stretch + ') scaleX(0.9)', opacity: 0, filter: 'blur(13px)' },
			{ offset: 0.42, transform: 'translateY(3%) skewY(0.8deg) scaleY(1.04) scaleX(1.01)', opacity: 1, filter: 'blur(5px)' },
			{ offset: 0.6,  transform: 'translateY(9%) skewY(-0.5deg) scaleY(' + squash + ')', opacity: 1, filter: 'blur(2.2px)' },
			{ offset: 0.8,  transform: 'translateY(-2.5%) scaleY(1.02)', opacity: 1, filter: 'blur(0.6px)' },
			{ offset: 1,    transform: 'none', opacity: 1, filter: 'none' }
		];
		return play(el, kfs, opts);
	}

	/** 向上抽走的退场 */
	function liftOut(el, options) {
		var opts = options || {};
		var kfs = [
			{ offset: 0, transform: 'none', opacity: 1 },
			{ offset: 0.32, transform: 'translateY(-4%) scaleY(1.08)', opacity: 1, filter: 'blur(2px)' },
			{ offset: 1, transform: 'translateY(-150%) scaleY(0.9)', opacity: 0, filter: 'blur(8px)' }
		];
		return play(el, kfs, Object.assign({ duration: 320 }, opts));
	}

	/** 侧向滑入: 横向被速度拉长, 行进方向带拖影 */
	function slideIn(el, options) {
		var opts = options || {};
		var from = opts.from == null ? -30 : opts.from;
		var stretch = opts.stretch == null ? 1.18 : opts.stretch;
		var kfs = [
			{ offset: 0,    transform: 'translateX(' + from + 'px) skewX(-7deg) scaleX(' + stretch + ')', opacity: 0, filter: 'blur(9.5px)' },
			{ offset: 0.42, transform: 'translateX(-5px) skewX(2.4deg) scaleX(0.99)', opacity: 1, filter: 'blur(3.4px)' },
			{ offset: 0.68, transform: 'translateX(3px) skewX(-1deg) scaleX(1.008)', opacity: 1, filter: 'blur(1px)' },
			{ offset: 1,    transform: 'none', opacity: 1, filter: 'none' }
		];
		return play(el, kfs, Object.assign({ duration: 520, delay: opts.delay || 0, ghosts: 8, lag: 7, blur: 4.2, fade: 0.34 }, opts));
	}

	/** 缩放淡入(最克制的一种, 用于成组的内容块) */
	function popIn(el, options) {
		var opts = options || {};
		var kfs = [
			{ offset: 0,   transform: 'translateY(18px) skewY(0.7deg) scaleY(1.12) scaleX(0.99)', opacity: 0, filter: 'blur(8px)' },
			{ offset: 0.5, transform: 'translateY(4px) scaleY(0.995)', opacity: 1, filter: 'blur(2.6px)' },
			{ offset: 0.72, transform: 'translateY(-2px) scaleY(1.006)', opacity: 1, filter: 'blur(0.7px)' },
			{ offset: 1,   transform: 'none', opacity: 1, filter: 'none' }
		];
		return play(el, kfs, Object.assign({ duration: 500, ghosts: 6, blur: 4.2, fade: 0.34 }, opts));
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
