/**
 * terminal.js — 工具页里的可交互终端
 *
 * 支持: 命令历史(↑/↓)、Tab 补全、内置虚拟文件系统、Base64 / JSON / UUID / SHA-256 等小工具。
 * 输出刻意保持英文, 与真实 shell 的观感一致。
 */
(function (global) {
	'use strict';

	var doc = global.document;

	var VFS = {
		'about.md': [
			'# dsh://terminal',
			'',
			'A single-page, zero-dependency, terminal-flavoured website.',
			'- background ...... canvas geometry',
			'- navigation ...... hash router (no reload)',
			'- motion ......... DOM smear / motion blur',
			'- palette ........ black, white, red, green, blue'
		],
		'skills.txt': [
			'html        ████████████████████  95%',
			'css         ██████████████████░░  90%',
			'javascript  █████████████████░░░  85%',
			'canvas 2d   ████████████████░░░░  80%',
			'dx / a11y   ███████████████░░░░░  75%'
		],
		'contact.txt': [
			'mail    : hello@dsh.dev',
			'github  : github.com/dsh',
			'timezone: UTC+8',
			'status  : open to interesting problems'
		],
		'.help': [
			'This shell is a demo. Try: help, ls, cat about.md, b64, uuid, json, sha256, accent blue, neofetch.'
		]
	};

	var EPOCH_FILES = ['about.md', 'skills.txt', 'contact.txt', '.help'];

	var instances = [];

	function create(root) {
		var body = root.querySelector('.term__body');
		var input = root.querySelector('.term__input');
		var ps1 = root.querySelector('.term__ps1');
		var title = root.querySelector('.term__title') || root.querySelector('[data-term-title]');
		if (!body || !input) return null;

		var history = [];
		var historyIndex = -1;
		var draft = '';

		function print(text, cls) {
			var line = doc.createElement('div');
			line.className = 'term__out' + (cls ? ' ' + cls : '');
			line.textContent = text;
			body.appendChild(line);
			return line;
		}

		function printHTML(html) {
			var line = doc.createElement('div');
			line.className = 'term__out';
			line.innerHTML = html;
			body.appendChild(line);
			return line;
		}

		function scrollToEnd() {
			body.scrollTop = body.scrollHeight;
		}

		function echoCommand(cmd) {
			var line = doc.createElement('div');
			line.className = 'term__out';
			var prompt = doc.createElement('span');
			prompt.className = 't-ok';
			prompt.textContent = (ps1 ? ps1.textContent : 'guest@dsh:~$') + ' ';
			var text = doc.createElement('span');
			text.className = 't-cmd';
			text.textContent = cmd;
			line.appendChild(prompt);
			line.appendChild(text);
			body.appendChild(line);
		}

		/* -------------------------------------------------- 命令实现 */

		function cmdHelp() {
			print('Available commands', 't-info');
			print('');
			var rows = [
				['help', 'show this list'],
				['ls', 'list virtual files'],
				['cat <file>', 'print a virtual file'],
				['whoami', 'current user'],
				['date', 'current date & time'],
				['echo <text>', 'print text'],
				['clear', 'clear the screen'],
				['open <page>', 'navigate: home | tools | contact | gallery'],
				['b64 <text>', 'encode to base64'],
				['b64d <text>', 'decode from base64'],
				['uuid [n]', 'generate n uuid v4 (default 1)'],
				['json <text>', 'pretty-print JSON'],
				['sha256 <text>', 'sha-256 digest (needs https / localhost)'],
				['accent <c>', 'switch accent: red | green | blue'],
				['neofetch', 'system info'],
				['clear', 'clear the screen']
			];
			rows.forEach(function (row) {
				print('  ' + row[0].padEnd(16, ' ') + row[1]);
			});
			print('');
		}

		function cmdLs() {
			EPOCH_FILES.forEach(function (name) {
				var size = (VFS[name].join('\n').length + '').padStart(6, ' ');
				print('  -rw-r--r--  ' + size + '  ' + name);
			});
			print('');
			print(EPOCH_FILES.length + ' files', 't-dim');
		}

		function cmdCat(args) {
			if (!args.length) { print('cat: missing operand', 't-err'); return; }
			var name = args[0].replace(/^\.\//, '');
			if (!VFS[name]) { print('cat: ' + name + ': No such file or directory', 't-err'); return; }
			VFS[name].forEach(function (line) { print(line); });
		}

		function cmdEcho(args) { print(args.join(' ')); }

		function cmdWhoami() { print('guest'); }

		function cmdDate() {
			print(new Date().toString());
		}

		function cmdClear() { body.innerHTML = ''; }

		function cmdOpen(args) {
			var target = (args[0] || '').toLowerCase();
			var routes = global.Router && global.Router.routes;
			if (!routes || !routes[target]) {
				print('open: unknown page "' + (args[0] || '') + '"', 't-err');
				print('  try: ' + Object.keys(routes || { home: 1, tools: 1 }).join(' | '), 't-dim');
				return;
			}
			print('navigating to ' + routes[target].path + ' ...', 't-info');
			scrollToEnd();
			setTimeout(function () { global.Router.navigate(target); }, 190);
		}

		function cmdB64(args) {
			if (!args.length) { print('usage: b64 <text>', 't-err'); return; }
			try { print(global.btoa(unescape(encodeURIComponent(args.join(' '))))); }
			catch (err) { print('b64: ' + err.message, 't-err'); }
		}

		function cmdB64d(args) {
			if (!args.length) { print('usage: b64d <base64>', 't-err'); return; }
			try { print(decodeURIComponent(escape(global.atob(args.join(' '))))); }
			catch (err) { print('b64d: invalid base64 input', 't-err'); }
		}

		function cmdUuid(args) {
			var n = parseInt(args[0], 10);
			if (isNaN(n) || n < 1) n = 1;
			n = Math.min(n, 12);
			for (var i = 0; i < n; i++) print(uuidv4());
		}

		function uuidv4() {
			if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
			var bytes = new Uint8Array(16);
			if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(bytes);
			else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
			bytes[6] = (bytes[6] & 0x0f) | 0x40;
			bytes[8] = (bytes[8] & 0x3f) | 0x80;
			var hex = [];
			for (var j = 0; j < 16; j++) hex.push((bytes[j] + 0x100).toString(16).slice(1));
			return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
				hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
		}

		function cmdJson(args) {
			if (!args.length) { print('usage: json <text>', 't-err'); return; }
			try {
				var parsed = JSON.parse(args.join(' '));
				print(JSON.stringify(parsed, null, 2), 't-info');
			} catch (err) {
				print('json: ' + err.message, 't-err');
			}
		}

		function cmdSha256(args) {
			if (!args.length) { print('usage: sha256 <text>', 't-err'); return; }
			if (!global.crypto || !global.crypto.subtle) {
				print('sha256: crypto.subtle unavailable (open the site over https or localhost)', 't-err');
				return;
			}
			var data = new TextEncoder().encode(args.join(' '));
			var pending = print('computing ...', 't-dim');
			global.crypto.subtle.digest('SHA-256', data).then(function (buf) {
				var bytes = Array.prototype.slice.call(new Uint8Array(buf));
				var hex = bytes.map(function (b) { return ('00' + b.toString(16)).slice(-2); }).join('');
				pending.remove();
				print(hex, 't-ok');
				scrollToEnd();
			}).catch(function (err) {
				pending.textContent = 'sha256: ' + err.message;
				pending.className = 'term__out t-err';
			});
		}

		function cmdAccent(args) {
			var name = (args[0] || '').toLowerCase();
			if (['red', 'green', 'blue'].indexOf(name) === -1) {
				print('usage: accent red | green | blue', 't-err');
				return;
			}
			doc.documentElement.setAttribute('data-accent', name);
			try { global.localStorage.setItem('dsh.accent', name); } catch (e) { /* noop */ }
			doc.dispatchEvent(new CustomEvent('accent:changed', { detail: { accent: name } }));
			print('accent -> ' + name, 't-ok');
		}

		function cmdNeofetch() {
			var logo = [
				'   ██████╗ ███████╗██╗  ██╗',
				'   ██╔══██╗██╔════╝██║  ██║',
				'   ██║  ██║███████╗███████║',
				'   ██║  ██║╚════██║██╔══██║',
				'   ██████╔╝███████║██║  ██║',
				'   ╚═════╝ ╚══════╝╚═╝  ╚═╝'
			];
			var info = [
				'guest@dsh',
				'---------',
				'OS       : DSH Terminal Web',
				'Shell    : smear-sh 1.0',
				'Locale   : ' + (global.i18n ? global.i18n.getLocale() : 'n/a'),
				'Viewport : ' + global.innerWidth + 'x' + global.innerHeight,
				'DPR      : ' + (global.devicePixelRatio || 1),
				'Renderer : ' + (global.Smear ? 'DOM smear + canvas' : 'n/a')
			];
			var rows = Math.max(logo.length, info.length);
			for (var i = 0; i < rows; i++) {
				var left = (logo[i] || '').padEnd(32, ' ');
				var right = info[i] || '';
				var line = doc.createElement('div');
				line.className = 'term__out';
				var l = doc.createElement('span');
				l.className = 't-info';
				l.textContent = left;
				var r = doc.createElement('span');
				r.textContent = right;
				line.appendChild(l);
				line.appendChild(r);
				body.appendChild(line);
			}
		}

		function cmdNotFound(name) {
			print(name + ': command not found', 't-err');
			print("type 'help' for the command list", 't-dim');
		}

		var COMMANDS = {
			help: cmdHelp,
			'?': cmdHelp,
			ls: cmdLs,
			dir: cmdLs,
			cat: cmdCat,
			echo: cmdEcho,
			whoami: cmdWhoami,
			date: cmdDate,
			clear: cmdClear,
			cls: cmdClear,
			open: cmdOpen,
			b64: cmdB64,
			base64: cmdB64,
			b64d: cmdB64d,
			uuid: cmdUuid,
			json: cmdJson,
			sha256: cmdSha256,
			accent: cmdAccent,
			neofetch: cmdNeofetch
		};

		var COMMAND_NAMES = Object.keys(COMMANDS);

		/* -------------------------------------------------- 执行 */

		function run(raw) {
			var line = raw.trim();
			echoCommand(raw);
			if (line) {
				var parts = line.split(/\s+/);
				var name = parts[0].toLowerCase();
				var args = parts.slice(1);
				if (COMMANDS[name]) COMMANDS[name](args);
				else cmdNotFound(parts[0]);
			}
			scrollToEnd();
		}

		function complete(value) {
			var m = value.match(/^(.*\s)?([^\s]*)$/);
			var head = m && m[1] ? m[1] : '';
			var word = m && m[2] ? m[2] : '';
			if (!word) return null;
			var matches = COMMAND_NAMES.filter(function (n) { return n.indexOf(word) === 0; });
			if (!matches.length) return null;
			if (matches.length === 1) return head + matches[0] + ' ';
			print(matches.join('   '), 't-dim');
			return head + commonPrefix(matches);
		}

		function commonPrefix(list) {
			var prefix = list[0];
			for (var i = 1; i < list.length; i++) {
				while (list[i].indexOf(prefix) !== 0) prefix = prefix.slice(0, -1);
			}
			return prefix;
		}

		/* -------------------------------------------------- 事件 */

		input.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') {
				var value = input.value;
				if (value.trim()) {
					history.push(value);
					if (history.length > 60) history.shift();
				}
				historyIndex = -1;
				draft = '';
				input.value = '';
				run(value);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				if (!history.length) return;
				if (historyIndex === -1) { draft = input.value; historyIndex = history.length - 1; }
				else if (historyIndex > 0) historyIndex--;
				input.value = history[historyIndex];
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				if (historyIndex === -1) return;
				if (historyIndex < history.length - 1) { historyIndex++; input.value = history[historyIndex]; }
				else { historyIndex = -1; input.value = draft; }
			} else if (e.key === 'Tab') {
				e.preventDefault();
				var completed = complete(input.value);
				if (completed != null) input.value = completed;
			} else if (e.key === 'l' && e.ctrlKey) {
				e.preventDefault();
				cmdClear();
			}
		});

		root.addEventListener('click', function (e) {
			if (global.getSelection && String(global.getSelection()).length) return;
			if (e.target.closest && e.target.closest('[data-cmd]')) return;
			input.focus();
		});

		var suggestions = root.querySelectorAll('[data-cmd]');
		Array.prototype.forEach.call(suggestions, function (btn) {
			btn.addEventListener('click', function (e) {
				e.stopPropagation();
				var cmd = btn.getAttribute('data-cmd');
				input.value = cmd;
				input.focus();
				run(cmd);
				input.value = '';
			});
		});

		if (title) title.textContent = 'guest@dsh: ~/tools';

		// 开机横幅
		print('smear-sh 1.0  ·  dsh://terminal', 't-info');
		print("type 'help' to list commands, 'Tab' to complete.", 't-dim');
		print('');

		return { run: run, print: print, focus: function () { input.focus(); } };
	}

	function mountAll(scope) {
		var roots = (scope || doc).querySelectorAll('[data-terminal]');
		Array.prototype.forEach.call(roots, function (root) {
			if (root.dataset.termMounted === 'true') return;
			root.dataset.termMounted = 'true';
			var inst = create(root);
			if (inst) {
				instances.push(inst);
				if (root.dataset.autofocus === 'true') setTimeout(function () { inst.focus(); }, 400);
			}
		});
		return instances;
	}

	global.Terminal = { mountAll: mountAll, instances: instances };

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { mountAll(doc); }, { once: true });
	else mountAll(doc);
})(window);
