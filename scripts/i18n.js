/**
 * Internationalization.js — 轻量级前端 i18n 引擎(零依赖, 原生浏览器 API)
 *
 * 核心行为: 读取 /i18n/<locale>.json, 把页面上所有带 i18n-key 的元素的文本
 *          替换成对应的翻译文本; 找不到翻译时保留 HTML 里写的默认文本兜底。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────
 * 1. 文本替换(元素内保留默认语言文本做兜底):
 *      <h1 i18n-key="home.heading">Welcome</h1>
 *      { "home.heading": "欢迎" }
 *
 * 2. 写进属性而不是文本(placeholder / title / aria-label / alt / value ...):
 *      <input i18n-key="form.email" i18n-attr="placeholder" placeholder="Email">
 *
 * 3. 插值参数(JSON, 占位符用 {name} 或 {0} 形式):
 *      <span i18n-key="cart.total" i18n-params='{"count":3}'>3 items</span>
 *      { "cart.total": "共 {count} 件" }
 *
 * 4. 翻译内容含 HTML 标签时加 i18n-html(仅用于可信语言包, 有 XSS 风险):
 *      <p i18n-key="about.desc" i18n-html>...</p>
 *
 * 5. 跳过某个元素: 加 i18n-ignore
 *
 * ── 可选全局配置(必须在加载本脚本之前定义) ───────────────────────────
 *   <script>
 *     window.I18N_CONFIG = {
 *       defaultLocale: 'zh-CN',
 *       locales: ['zh-CN', 'en-US'],
 *       basePath: '/i18n/',
 *       rtlLocales: [],
 *       debug: false,
 *       // detect: false,  persist: false,  queryParam: 'lang',  storageKey: 'i18n.locale'
 *     };
 *   </script>
 *
 * ── 公共 API: window.i18n ────────────────────────────────────────────
 *   await i18n.ready               首次初始化完成的 Promise
 *   await i18n.setLocale('zh-CN')  切换语言(写入 localStorage 并重新翻译整页)
 *                                  同时立即同步 <html lang="zh-CN"> / dir / data-i18n-locale
 *   i18n.getLocale()               当前语言
 *   i18n.locales                   支持的语言列表
 *   i18n.t(key, params)            取翻译文本(不存在时返回 undefined)
 *   i18n.has(key)                  是否存在该 key
 *   i18n.apply(el?)                翻译新插入的 DOM(动态内容 / 单页应用)
 *   i18n.number(v, opts) / i18n.date(v, opts) / i18n.relativeTime(v, unit, opts) / i18n.list(arr, opts)
 *   document.addEventListener('i18n:applied', e => e.detail)  每次翻译完成后触发
 */
(function (global) {
	'use strict';

	const DEFAULT_CONFIG = {
		/** 兜底语言: 缺失翻译时回退到它 */
		defaultLocale: 'en-US',
		/** 支持的语言列表 */
		locales: ['en-US', 'zh-CN'],
		/** 语言包目录 */
		basePath: '/i18n/',
		keyAttribute: 'i18n-key',
		targetAttribute: 'i18n-attr',
		paramsAttribute: 'i18n-params',
		htmlAttribute: 'i18n-html',
		ignoreAttribute: 'i18n-ignore',
		readyAttribute: 'i18n-ready',
		/** 通过 ?lang=xx 强制指定语言 */
		queryParam: 'lang',
		storageKey: 'i18n.locale',
		/** 是否记忆用户选择 */
		persist: true,
		/** 是否按浏览器语言自动选择 */
		detect: true,
		/** 需要 RTL 布局的语言 */
		rtlLocales: [],
		debug: false
	};

	/** 语言包缓存: locale -> Promise<messages|null> */
	const messagesCache = new Map();
	/** 记录由本脚本插入的文本节点, 避免重复插入 */
	const injectedTextNodes = new WeakSet();
	/** 已告警过的缺失 key, 避免刷屏 */
	const warnedKeys = new Set();

	const state = {
		config: null,
		locale: null,
		/** 当前语言的语言包 */
		messages: {},
		/** 兜底语言的语包 */
		fallback: {}
	};

	let initialized = false;
	let resolveReady;
	const ready = new Promise((resolve) => { resolveReady = resolve; });

	// ── 工具函数 ───────────────────────────────────────────────────────

	function log(...args) {
		if (state.config && state.config.debug) console.log('[i18n]', ...args);
	}

	function normalize(tag) {
		return String(tag == null ? '' : tag).trim().replace(/_/g, '-').toLowerCase();
	}

	/** 把 'zh-cn' / 'zh-Hans-CN' 这类标签匹配到配置里的标准语言代码 */
	function matchLocale(tag) {
		const target = normalize(tag);
		if (!target || !state.config) return null;
		const locales = state.config.locales;
		const exact = locales.find((l) => normalize(l) === target);
		if (exact) return exact;
		const base = target.split('-')[0];
		return locales.find((l) => normalize(l).split('-')[0] === base) || null;
	}

	/** 语言来源优先级: ?lang= > localStorage > 浏览器语言 > 默认语言 */
	function detectLocale() {
		const cfg = state.config;

		try {
			const fromQuery = matchLocale(new URLSearchParams(global.location.search).get(cfg.queryParam));
			if (fromQuery) return fromQuery;
		} catch (err) { /* 忽略 */ }

		if (cfg.persist) {
			try {
				const stored = matchLocale(global.localStorage.getItem(cfg.storageKey));
				if (stored) return stored;
			} catch (err) { /* localStorage 可能被禁用 */ }
		}

		if (cfg.detect) {
			const candidates = [].concat(global.navigator.languages || [], global.navigator.language || []);
			for (const candidate of candidates) {
				const matched = matchLocale(candidate);
				if (matched) return matched;
			}
		}
		return cfg.defaultLocale;
	}

	/** 生成语言包的候选 URL: 先绝对路径, 再相对于当前页面的路径 */
	function candidateUrls(locale) {
		let base = state.config.basePath || '';
		if (base && !base.endsWith('/')) base += '/';
		const file = encodeURIComponent(locale) + '.json';

		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) return [base + file];

		const list = [base.startsWith('/') ? base + file : '/' + base + file];
		list.push(base.replace(/^\/+/, '') + file);
		return Array.from(new Set(list)).filter(Boolean);
	}

	/** 加载语言包; 全部候选地址都失败时返回 null(页面保持 HTML 默认文本) */
	async function loadMessages(locale) {
		const cacheKey = normalize(locale);
		if (messagesCache.has(cacheKey)) return messagesCache.get(cacheKey);

		const promise = (async () => {
			const urls = candidateUrls(locale);
			for (const url of urls) {
				try {
					const response = await fetch(url);
					if (!response.ok) throw new Error('HTTP ' + response.status);
					const data = await response.json();
					log('已加载语言包', locale, '←', url);
					return data && typeof data === 'object' ? data : {};
				} catch (err) {
					log('加载失败', url, err.message);
				}
			}
			console.error(
				'[i18n] 无法加载语言包 "' + locale + '": ' + urls.join(', ') +
				'\n         请确认文件存在, 并用本地服务器打开页面' +
				'(如 VS Code Live Server / `npx serve`)。直接双击 file:// 打开时浏览器会拦截读取本地 JSON。'
			);
			return null;
		})();

		messagesCache.set(cacheKey, promise);
		return promise;
	}

	/** 取 key 对应的值, 同时支持扁平键("a.b")与嵌套对象({a:{b}}) */
	function lookup(messages, key) {
		if (!messages || typeof key !== 'string' || !key) return undefined;
		if (Object.prototype.hasOwnProperty.call(messages, key)) return messages[key];
		if (key.indexOf('.') === -1) return undefined;
		return key.split('.').reduce((acc, part) => {
			if (acc && typeof acc === 'object' && Object.prototype.hasOwnProperty.call(acc, part)) return acc[part];
			return undefined;
		}, messages);
	}

	function interpolate(template, params) {
		if (!params) return template;
		return template.replace(/\{(\w+)\}/g, (match, name) => (
			Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
		));
	}

	function translate(key, params) {
		let value = lookup(state.messages, key);
		if (value === undefined) value = lookup(state.fallback, key);
		if (value === undefined) {
			if (key && !warnedKeys.has(key)) {
				warnedKeys.add(key);
				console.warn('[i18n] 缺少翻译: "' + key + '" (' + state.locale + '), 已保留 HTML 默认文本');
			}
			return undefined;
		}
		return typeof value === 'string' ? interpolate(value, params) : value;
	}

	function readParams(el) {
		const raw = el.getAttribute(state.config.paramsAttribute);
		if (!raw) return null;
		try {
			return JSON.parse(raw);
		} catch (err) {
			console.warn('[i18n] i18n-params 不是合法 JSON:', raw);
			return null;
		}
	}

	/**
	 * 只替换元素"自己的"文本节点, 元素内部的子标签保持不动。
	 * 例如 <p i18n-key="x">你好 <strong>世界</strong></p> 不会丢掉 <strong>。
	 */
	function setOwnText(el, text) {
		const textNodes = [];
		for (const node of el.childNodes) {
			if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() !== '') textNodes.push(node);
		}

		if (textNodes.length === 0) {
			// 元素本身没有文本: 复用/新建一个脚本自己的文本节点, 而不是覆盖掉子元素
			let node = el.firstChild;
			if (!node || node.nodeType !== Node.TEXT_NODE || !injectedTextNodes.has(node)) {
				node = document.createTextNode('');
				injectedTextNodes.add(node);
				el.insertBefore(node, el.firstChild);
			}
			node.nodeValue = text;
			return;
		}

		textNodes[0].nodeValue = text;
		for (let i = 1; i < textNodes.length; i++) textNodes[i].nodeValue = '';
	}

	function applyToElement(el) {
		const cfg = state.config;
		if (el.hasAttribute(cfg.ignoreAttribute)) return;

		const key = el.getAttribute(cfg.keyAttribute);
		if (!key) return;

		const message = translate(key, readParams(el));
		if (message === undefined) return; // 保留 HTML 中的默认文本

		const targetAttr = el.getAttribute(cfg.targetAttribute);
		if (targetAttr) el.setAttribute(targetAttr, message);
		else if (el.hasAttribute(cfg.htmlAttribute)) el.innerHTML = message;
		else setOwnText(el, message);

		el.setAttribute(cfg.readyAttribute, '');
	}

	function collect(root) {
		const cfg = state.config;
		const scope = root && root.nodeType ? root : document;
		const nodes = [];
		if (scope.nodeType === Node.ELEMENT_NODE && scope.hasAttribute && scope.hasAttribute(cfg.keyAttribute)) {
			nodes.push(scope);
		}
		if (scope.querySelectorAll) {
			scope.querySelectorAll('[' + cfg.keyAttribute + ']').forEach((el) => nodes.push(el));
		}
		return nodes;
	}

	function isRtl(locale) {
		return (state.config.rtlLocales || []).some((l) => normalize(l) === normalize(locale));
	}

	/** 同步 <html> 上的语言相关属性: lang / dir / data-i18n-locale */
	function setDocumentLocale(locale) {
		const html = document.documentElement;
		html.setAttribute('lang', locale);
		html.setAttribute('data-i18n-locale', locale);
		html.setAttribute('dir', isRtl(locale) ? 'rtl' : 'ltr');
	}

	/** 翻译整个文档(或某个子树)中所有带 i18n-key 的元素 */
	function apply(root) {
		if (!state.config) return 0;
		const nodes = collect(root);
		nodes.forEach(applyToElement);

		setDocumentLocale(state.locale);

		document.dispatchEvent(new CustomEvent('i18n:applied', {
			detail: { locale: state.locale, count: nodes.length }
		}));
		log('已翻译 ' + nodes.length + ' 个元素 → ' + state.locale);
		return nodes.length;
	}

	// ── 语言切换 ───────────────────────────────────────────────────────

	async function setLocale(locale, options) {
		const opts = options || {};
		if (!state.config) await init();

		const resolved = matchLocale(locale);
		if (!resolved) {
			console.warn('[i18n] 不支持的语言: "' + locale + '", 可用: ' + state.config.locales.join(', '));
			return state.locale;
		}
		if (resolved === state.locale && Object.keys(state.messages).length && !opts.force) return resolved;

		state.locale = resolved;
		// 先同步 <html lang>/dir, 不等语言包加载完成(加载失败时语言属性依然正确)
		setDocumentLocale(resolved);

		state.messages = (await loadMessages(resolved)) || {};

		// 非默认语言时, 再加载一份默认语言包作为逐条兜底
		state.fallback = resolved === state.config.defaultLocale
			? state.messages
			: (await loadMessages(state.config.defaultLocale)) || {};

		if (state.config.persist) {
			try { global.localStorage.setItem(state.config.storageKey, resolved); } catch (err) { /* 忽略 */ }
		}

		apply(document);
		return resolved;
	}

	async function init(userConfig) {
		if (initialized) return state.locale;
		initialized = true;

		state.config = Object.assign({}, DEFAULT_CONFIG, global.I18N_CONFIG || {}, userConfig || {});
		if (!state.config.locales || !state.config.locales.length) state.config.locales = [state.config.defaultLocale];
		if (!state.config.locales.some((l) => normalize(l) === normalize(state.config.defaultLocale))) {
			state.config.locales = [state.config.defaultLocale].concat(state.config.locales);
		}

		const locale = state.config.detect === false ? state.config.defaultLocale : detectLocale();
		await setLocale(locale, { force: true });
		log('初始化完成:', state.locale);
		resolveReady(i18n);
		return state.locale;
	}

	// ── 对外 API ───────────────────────────────────────────────────────

	const i18n = {
		ready,
		init,
		config: DEFAULT_CONFIG,
		apply,
		setLocale,
		translate,
		t: translate,

		getLocale() { return state.locale; },

		get locales() { return state.config ? state.config.locales.slice() : []; },

		/** 是否存在该 key(不触发缺失告警) */
		has(key) {
			return lookup(state.messages, key) !== undefined || lookup(state.fallback, key) !== undefined;
		},

		/** 当前语言包的浅拷贝 */
		getMessages() { return Object.assign({}, state.messages); },

		/** 数字格式化: i18n.number(1234.5, { style: 'currency', currency: 'CNY' }) */
		number(value, options) {
			return new Intl.NumberFormat(state.locale || undefined, options).format(value);
		},

		/** 日期格式化: i18n.date(new Date(), { dateStyle: 'long' }) */
		date(value, options) {
			const target = value instanceof Date ? value : new Date(value);
			return new Intl.DateTimeFormat(state.locale || undefined, options).format(target);
		},

		/** 相对时间: i18n.relativeTime(Date.now() - 3600000, 'hour') → "1 小时前" */
		relativeTime(value, unit, options) {
			const unitMs = {
				year: 31536000000, month: 2592000000, week: 604800000,
				day: 86400000, hour: 3600000, minute: 60000, second: 1000
			};
			const ms = unitMs[unit] || 1000;
			const target = value instanceof Date ? value.getTime() : Number(value);
			const amount = (target - Date.now()) / ms;
			return new Intl.RelativeTimeFormat(state.locale || undefined, options || { numeric: 'auto' })
				.format(Math.round(amount), unit || 'second');
		},

		/** 列表连接: i18n.list(['A','B','C']) → "A、B和C" */
		list(items, options) {
			return new Intl.ListFormat(state.locale || undefined, options).format(items);
		}
	};

	global.i18n = i18n;

	// 自动初始化: defer 加载时 DOM 已解析完毕, 否则等 DOMContentLoaded
	function boot() {
		if (global.I18N_AUTO_INIT === false) return;
		init().catch((err) => console.error('[i18n] 初始化失败:', err));
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot, { once: true });
	} else {
		boot();
	}
})(window);
