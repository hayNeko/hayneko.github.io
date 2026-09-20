/**
 * TitleChange.js — 标签页隐藏时循环提示文案, 回到页面后恢复
 *
 * 依赖: scripts/Internationalization.js (window.i18n)
 * 与 router.js 的 route:changed 事件协作: 每次路由切换后重新记录"基准标题"。
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var INTERVAL = 1700;

	var baseTitle = doc.title;
	var timer = null;
	var index = 0;
	var messages = [];

	var FALLBACK = ['👋 回来看看?', '📡 正在监听…'];

	function resolveMessages() {
		var i18n = global.i18n;
		var keys = ['tab.away.1', 'tab.away.2'];
		var out = [];
		keys.forEach(function (key, i) {
			var value = i18n && i18n.t ? i18n.t(key) : null;
			out.push(value || FALLBACK[i] || '');
		});
		return out.filter(Boolean);
	}

	function rememberBase() {
		if (!doc.hidden) baseTitle = doc.title;
	}

	function setTitle(text) {
		if (doc.title !== text) doc.title = text;
	}

	function start() {
		stop();
		messages = resolveMessages();
		if (!messages.length) return;
		index = 0;
		setTitle(messages[0]);
		timer = global.setInterval(function () {
			index = (index + 1) % messages.length;
			setTitle(messages[index]);
		}, INTERVAL);
	}

	function stop() {
		if (timer) global.clearInterval(timer);
		timer = null;
		setTitle(baseTitle);
	}

	doc.addEventListener('visibilitychange', function () {
		if (doc.hidden) start();
		else stop();
	});

	global.addEventListener('focus', function () { if (!doc.hidden) stop(); });

	/* 语言切换 → 重新取文案 */
	doc.addEventListener('i18n:applied', function () {
		rememberBase();
		if (doc.hidden) start();
	});

	/* 路由切换 → 更新基准标题 */
	doc.addEventListener('route:changed', function () {
		setTimeout(rememberBase, 60);
	});

	global.TitleChange = {
		setBase: function (text) { baseTitle = text; },
		getBase: function () { return baseTitle; },
		start: start,
		stop: stop
	};
})(window);
