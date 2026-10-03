/**
 * perf-tier.js — 设备分级 + 动效预算
 *
 * 在动效层(geometry-bg.js 等)之前**同步**跑一次:
 *   1. 先看 UA / client hints 判断手机·平板;
 *   2. 再探一组"能力": 逻辑核数、设备内存、屏幕尺寸、指针精度、DPR、
 *      省流开关(saveData)、网络类型、系统「减少动态效果」;
 *   3. 加权算分 → 分三档 high / mid / low, 外加一个"干脆别加载"的开关;
 *   4. 把结果摊成一张**预算表**(粒子数倍率 / 掩码列数上限 / 环数 / DPR 上限 /
 *      帧率上限 / 扫描带·涟漪·打乱是否保留 / 要不要加载背景),
 *      动效层直接照着它做减法, 自己不用再判断设备。
 *
 * 只做同步探测、不碰 DOM, 所以可以作为 head 里的普通(阻塞)脚本放在最前面 ——
 * 体积目标是 1KB 以内, 换来的是后面每个动效模块都不用重复判断。
 */
(function (global) {
	'use strict';

	var nav = global.navigator || {};
	var ua = nav.userAgent || '';
	var uaData = nav.userAgentData || null;

	/* ---------------------------------------------------------------- UA */

	/*
	 * ⚠️ client hints 的 mobile 只能当**正向信号**用。
	 * 桌面浏览器(navigator.userAgentData.mobile === false)与"UA 被覆盖/伪装"的场景都会给 false,
	 * 拿它当权威就会把真手机判成桌面 —— 实测无头 Edge 用 CDP 覆盖成安卓 UA 时,
	 * userAgentData.mobile 仍然是 false。所以两种信号取"或"。
	 */
	var uaMobile = /Android|iPhone|iPod|Windows Phone|IEMobile|Mobile|HarmonyOS/i.test(ua);
	var mobileHint = (uaData && uaData.mobile === true) || uaMobile;
	/* iPadOS 从 13 起 UA 跟 macOS 一样, 只能靠触摸点数量区分 */
	var iPad = /iPad/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
	var mobile = mobileHint || iPad;
	var tablet = !mobile && /Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua);

	/* ------------------------------------------------------------ 能力探测 */

	var cores = nav.hardwareConcurrency || 0;
	var memory = nav.deviceMemory || 0;
	var conn = nav.connection || nav.mozConnection || nav.webkitConnection || null;
	var saveData = !!(conn && conn.saveData);
	var slowNet = !!(conn && /(^|-)2g$/.test(String(conn.effectiveType || '')));
	var coarse = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
	var noHover = !!(global.matchMedia && global.matchMedia('(hover: none)').matches);
	var dpr = global.devicePixelRatio || 1;
	var vw = global.innerWidth || 1024;
	var vh = global.innerHeight || 768;
	var small = Math.min(vw, vh) <= 520;
	var reduced = global.MotionPref
		? !!global.MotionPref.reduced
		: !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

	/* ---------------------------------------------------------------- 打分 */

	/* 每一项都是"越弱越加分"; 阈值挑得比较保守, 现代手机落在 mid, 老手机/省流落在 low */
	var score = 0;
	var reasons = [];
	function add(n, why) { if (n > 0) { score += n; reasons.push(why + '+' + n); } }

	add(mobile ? 2 : 0, 'ua-mobile');
	add(tablet ? 1 : 0, 'ua-tablet');
	add(small ? 1 : 0, 'small-viewport');
	add(coarse || noHover ? 1 : 0, 'coarse-pointer');
	add(cores > 0 && cores <= 4 ? 1 : 0, 'cores<=4');
	add(cores > 0 && cores <= 2 ? 2 : 0, 'cores<=2');
	add(memory > 0 && memory <= 4 ? 1 : 0, 'mem<=4');
	add(memory > 0 && memory <= 2 ? 2 : 0, 'mem<=2');
	add(dpr > 2 ? 1 : 0, 'dpr>2');
	add(saveData ? 4 : 0, 'save-data');
	add(slowNet ? 3 : 0, 'slow-net');

	var tier = score >= 7 ? 'low' : (score >= 3 ? 'mid' : 'high');

	/* 极端情况: 干脆不加载背景动效(省流 / 单核 / 1G 内存) */
	var skipBackground = saveData || (cores > 0 && cores <= 1) || (memory > 0 && memory <= 1);
	if (skipBackground && tier === 'high') tier = 'low';

	/*
	 * 预算表:
	 *   particles  粒子数倍率(散字与目标上限都按它缩)
	 *   maskCols   字形掩码列数上限(列数越少 = 字越大越省)
	 *   rings      行星环圈数
	 *   dprCap     渲染 DPR 上限(手机上 2~3 倍 DPR 是最大的开销来源之一)
	 *   fps        帧率上限, 0 = 不限制(跟着 rAF)
	 *   sweep      扫描带 / pulses 涟漪 / 切页打乱 这些"纯装饰"要不要留
	 */
	var BUDGETS = {
		high: { particles: 1, maskCols: 92, rings: 2, dprCap: 1.5, fps: 0, planetDensity: 1, depth: 3, sweep: true, pulses: true, scramble: true, spin: true },
		mid: { particles: 0.62, maskCols: 76, rings: 1, dprCap: 1.25, fps: 0, planetDensity: 0.8, depth: 3, sweep: true, pulses: true, scramble: true, spin: true },
		low: { particles: 0.32, maskCols: 60, rings: 1, dprCap: 1, fps: 30, planetDensity: 0.62, depth: 2, sweep: false, pulses: false, scramble: false, spin: false }
	};

	var budget = BUDGETS[tier];
	budget.background = !skipBackground;
	budget.tier = tier;
	budget.staticOnly = reduced;

	global.PerfTier = {
		tier: tier,
		score: score,
		reasons: reasons,
		mobile: mobile,
		tablet: tablet,
		cores: cores,
		memory: memory,
		saveData: saveData,
		slowNet: slowNet,
		coarse: coarse,
		dpr: dpr,
		small: small,
		reduced: reduced,
		skipBackground: skipBackground,
		budget: budget,
		/* 供调试点开: console.log(PerfTier.report()) */
		report: function () {
			return {
				tier: tier, score: score, reasons: reasons.join(' '),
				mobile: mobile, tablet: tablet, cores: cores, memory: memory,
				saveData: saveData, slowNet: slowNet, coarse: coarse, dpr: dpr,
				small: small, reduced: reduced, background: budget.background
			};
		}
	};
})(window);
