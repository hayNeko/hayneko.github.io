/**
 * app.js — 站点引导 (bootstrap)
 *
 * 负责:
 *   - 启动屏动画, 首屏路由就绪后再淡出
 *   - 主题强调色 (红 / 绿 / 蓝) 的持久化与切换
 *   - 语言切换按钮
 *   - 轻量 Toast
 *   - 全局快捷键
 */
(function (global) {
	'use strict';

	var doc = global.document;
	var ACCENT_KEY = 'dsh.accent';
	var ACCENTS = ['red', 'green', 'blue'];

	/* ------------------------------------------------------------ Toast */

	var stack = null;
	function toastRoot() {
		if (stack && stack.isConnected) return stack;
		stack = doc.getElementById('toast-stack');
		if (!stack) {
			stack = doc.createElement('div');
			stack.id = 'toast-stack';
			stack.className = 'toast-stack';
			doc.body.appendChild(stack);
		}
		return stack;
	}

	function toast(text, type) {
		var el = doc.createElement('div');
		el.className = 'toast' + (type ? ' toast--' + type : '');
		el.setAttribute('role', 'status');
		var dot = doc.createElement('span');
		dot.className = 'dot ' + (type === 'ok' ? 'dot--green' : type === 'warn' ? 'dot--red' : 'dot--blue');
		var span = doc.createElement('span');
		span.textContent = text;
		el.appendChild(dot);
		el.appendChild(span);
		toastRoot().appendChild(el);

		setTimeout(function () {
			el.classList.add('is-out');
			setTimeout(function () { el.remove(); }, 260);
		}, 2600);
	}

	global.Toast = { show: toast };

	/* ------------------------------------------------------------ 强调色 */

	function applyAccent(name) {
		if (ACCENTS.indexOf(name) === -1) name = 'blue';
		doc.documentElement.setAttribute('data-accent', name);
		Array.prototype.forEach.call(doc.querySelectorAll('.accent-switch button'), function (btn) {
			btn.classList.toggle('is-active', btn.getAttribute('data-accent') === name);
		});
		return name;
	}

	function initAccent() {
		var saved = null;
		try { saved = global.localStorage.getItem(ACCENT_KEY); } catch (e) { /* noop */ }
		applyAccent(saved || doc.documentElement.getAttribute('data-accent') || 'blue');

		doc.addEventListener('click', function (e) {
			var btn = e.target.closest ? e.target.closest('.accent-switch button') : null;
			if (!btn) return;
			var name = btn.getAttribute('data-accent');
			applyAccent(name);
			try { global.localStorage.setItem(ACCENT_KEY, name); } catch (err) { /* noop */ }
			if (global.GeometryBG) global.GeometryBG.pulse(name);
		});

		doc.addEventListener('accent:changed', function (e) {
			applyAccent(e.detail && e.detail.accent);
		});
	}

	/* ------------------------------------------------------------ 语言 */

	function initLanguage() {
		doc.addEventListener('click', function (e) {
			var btn = e.target.closest ? e.target.closest('[data-locale]') : null;
			if (!btn) return;
			var locale = btn.getAttribute('data-locale');
			if (!global.i18n || !global.i18n.setLocale) return;
			if (global.i18n.getLocale() === locale) return;
			global.i18n.setLocale(locale).then(function (applied) {
				toast('locale → ' + applied);
				if (global.GeometryBG) global.GeometryBG.pulse('blue');
			});
		});
	}

	function syncLanguageButtons() {
		var current = global.i18n ? global.i18n.getLocale() : null;
		Array.prototype.forEach.call(doc.querySelectorAll('[data-locale]'), function (btn) {
			btn.classList.toggle('is-active', btn.getAttribute('data-locale') === current);
		});
	}

	/* ------------------------------------------------------------ 联系表单 */

	function t(key, fallback) {
		var i18n = global.i18n;
		var value = i18n && i18n.t ? i18n.t(key) : null;
		return value || fallback;
	}

	function fieldError(form, name, message) {
		var slot = form.querySelector('[data-error-for="' + name + '"]');
		var input = form.querySelector('[name="' + name + '"]');
		if (slot) {
			slot.textContent = message || '';
			slot.classList.toggle('is-shown', !!message);
		}
		if (input) {
			if (message) input.setAttribute('aria-invalid', 'true');
			else input.removeAttribute('aria-invalid');
		}
	}

	function handleContact(form) {
		var name = (form.elements.name && form.elements.name.value || '').trim();
		var email = (form.elements.email && form.elements.email.value || '').trim();
		var message = (form.elements.message && form.elements.message.value || '').trim();
		var valid = true;

		if (!name) { fieldError(form, 'name', t('contact.form.error.name', '请填写称呼')); valid = false; }
		else fieldError(form, 'name', '');

		if (!email) { fieldError(form, 'email', t('contact.form.error.email.empty', '请填写邮箱')); valid = false; }
		else if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
			fieldError(form, 'email', t('contact.form.error.email.invalid', '邮箱格式不正确'));
			valid = false;
		} else fieldError(form, 'email', '');

		if (message.length < 8) {
			fieldError(form, 'message', t('contact.form.error.message', '再多写几个字吧(至少 8 个字符)'));
			valid = false;
		} else fieldError(form, 'message', '');

		if (!valid) {
			toast(t('contact.form.error.toast', '表单还有未通过校验的字段'), 'warn');
			var first = form.querySelector('[aria-invalid="true"]');
			if (first) first.focus();
			return;
		}

		var button = form.querySelector('button[type="submit"]');
		var label = form.querySelector('[data-submit-label]');
		var original = label ? label.textContent : '';
		form.classList.add('is-sending');
		if (button) button.setAttribute('disabled', 'disabled');
		if (label) label.textContent = t('contact.form.sending', '发送中…');

		setTimeout(function () {
			form.classList.remove('is-sending');
			form.classList.add('is-sent');
			if (button) button.removeAttribute('disabled');
			if (label) label.textContent = original || t('contact.form.submit', '发送');
			toast(t('contact.form.success', '消息已记录(纯前端演示)'), 'ok');
			if (global.GeometryBG) global.GeometryBG.pulse('green');
			form.reset();
			setTimeout(function () { form.classList.remove('is-sent'); }, 1800);
		}, 900);
	}

	function initContactForm() {
		doc.addEventListener('submit', function (e) {
			var form = e.target && e.target.closest ? e.target.closest('#contact-form') : null;
			if (!form) return;
			e.preventDefault();
			handleContact(form);
		});
		doc.addEventListener('input', function (e) {
			var input = e.target;
			if (!input || !input.name) return;
			var form = input.closest ? input.closest('#contact-form') : null;
			if (!form || !input.getAttribute('aria-invalid')) return;
			fieldError(form, input.name, '');
		});
	}

	/* ------------------------------------------------------------ 启动屏 */

	function bootSequence() {
		var boot = doc.getElementById('boot-screen');
		if (!boot) return { finish: function () {} };

		var bar = boot.querySelector('.boot__bar i');
		var log = boot.querySelector('.boot__log');

		var lines = [
			['go', 'booting dsh.kernel 1.0.0'],
			['ok', 'mount  /dev/canvas ......... geometry background online'],
			['ok', 'load   /styles/*.css ....... design tokens ready'],
			['ok', 'link   /scripts/smear.js ... motion blur armed'],
			['go', 'probe  /i18n/*.json ........ resolving locale'],
			['ok', 'route  #/home .............. partials cached'],
			['ok', 'ready']
		];

		var i = 0;
		function step() {
			if (i >= lines.length) return;
			var item = lines[i];
			var li = doc.createElement('li');
			var tag = doc.createElement('span');
			tag.className = item[0];
			tag.textContent = '[' + (item[0] === 'ok' ? ' OK ' : item[0] === 'no' ? 'FAIL' : ' .. ') + ']';
			var text = doc.createElement('span');
			text.textContent = item[1];
			li.appendChild(tag);
			li.appendChild(text);
			log.appendChild(li);
			if (log.children.length > 7) log.removeChild(log.firstChild);
			if (bar) bar.style.width = Math.round(((i + 1) / lines.length) * 100) + '%';
			i++;
			setTimeout(step, 90 + Math.random() * 110);
		}
		step();

		return {
			finish: function () {
				if (bar) bar.style.width = '100%';
				setTimeout(function () {
					boot.classList.add('is-done');
					setTimeout(function () { boot.remove(); }, 700);
				}, 280);
			}
		};
	}

	/* ------------------------------------------------------------ 快捷键 */

	function initShortcuts() {
		doc.addEventListener('keydown', function (e) {
			var tag = (e.target && e.target.tagName || '').toLowerCase();
			var typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);

			/* Ctrl/Cmd + K → 展开导航 */
			if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
				e.preventDefault();
				if (global.HeaderNav) global.HeaderNav.toggle();
				return;
			}
			if (typing) return;

			/* g 然后 h/t/c/g → 跳转 */
			if (e.key === 'g') {
				pendingG = true;
				setTimeout(function () { pendingG = false; }, 900);
				return;
			}
			if (pendingG) {
				var map = { h: 'home', t: 'tools', c: 'contact', g: 'gallery' };
				var target = map[e.key.toLowerCase()];
				if (target && global.Router) {
					e.preventDefault();
					pendingG = false;
					global.Router.navigate(target);
				}
			}
		});
	}
	var pendingG = false;

	/* ------------------------------------------------------------ 引导 */

	function boot() {
		var booter = bootSequence();
		initAccent();
		initLanguage();
		initShortcuts();
		initContactForm();

		var yearEl = doc.getElementById('footer-year');
		if (yearEl) yearEl.textContent = String(new Date().getFullYear());

		doc.addEventListener('i18n:applied', syncLanguageButtons);
		if (global.i18n && global.i18n.ready) global.i18n.ready.then(syncLanguageButtons);
		else syncLanguageButtons();

		if (!global.Router) {
			booter.finish();
			return;
		}

		global.Router.init()
			.catch(function (err) { console.error('[app] 路由初始化失败:', err); })
			.then(function () { booter.finish(); });

		/* 首屏之后给个提示, 让用户知道顶栏可以展开 */
		setTimeout(function () {
			if (global.innerWidth > 900 && global.matchMedia('(hover: hover)').matches) {
				toast('把鼠标移到顶栏即可展开导航', 'ok');
			}
		}, 2400);
	}

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
	else boot();
})(window);
