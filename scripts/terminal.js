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
			'# Hayneko',
			'',
			'Student, hobbyist developer, Miku fan.',
			'- hobbies ....... music, anime, programming',
			'- games ......... Minecraft, NTE',
			'- languages ..... 中文 / English / 日本語'
		],
		'contact.txt': [
			'mail    : haydenwong825@gmail.com',
			'mail    : mikudword_t32@hotmail.com',
			'github  : github.com/hayNeko',
			'insta   : @hayneko_dword',
			'timezone: UTC+8',
			'status  : open to new things'
		],
		'sims.txt': [
			'1  phy-default   Force & motion',
			'2  phy-ntlaw2    Newtons second law',
			'3  phy-lens      Lenses',
			'',
			'Run "sim 2" to open one.'
		],
		'games.txt': [
			'1  tetris        classic falling-block puzzle',
			'2  blockblast    8x8 board, three pieces at a time',
			'',
			'Run "play tetris" or "play blockblast" to open one.',
			'Flags (same names for both, the meaning differs):',
			'  --easy-mode       tetris: no speed-up / blockblast: more long bars & squares',
			'  --with-roll-back  adds an Undo button'
		],
		'.help': [
			'Try: help, ls, cat about.md, sim 2, play tetris, theme light, neofetch.'
		]
	};

	var EPOCH_FILES = ['about.md', 'contact.txt', 'sims.txt', 'games.txt', '.help'];

	/* 物理模拟入口(sim 命令用) */
	var SIMS = [
		{ name: 'phy-default', href: 'pages/physics-sim/phy-default/' },
		{ name: 'phy-ntlaw2', href: 'pages/physics-sim/phy-ntlaw2/' },
		{ name: 'phy-lens', href: 'pages/physics-sim/phy-lens/' }
	];

	/* 小游戏页有没有加载成功兜底: 清单以 scripts/games.js 为准(alias 也要跟着来) */
	var GAMES_FALLBACK = [
		{ id: 'tetris', title: 'Tetris', desc: 'classic falling-block puzzle' },
		{
			id: 'blockblast', title: 'Block Blast', desc: '8x8 board, three pieces at a time',
			alias: ['block-blast', 'block_blast', 'blast', 'bb']
		}
	];

	function gameList() {
		if (global.Games && global.Games.list) return global.Games.list();
		return GAMES_FALLBACK;
	}

	/* 帮助表是唯一的事实来源: help / man / 全局搜索都从这里读 */
	var HELP_GROUPS = [
		{ title: 'files & navigation', rows: [
			['help', 'show this list'],
			['man <cmd>', 'usage of a single command'],
			['ls', 'list virtual files'],
			['tree', 'virtual files as a tree'],
			['cat <file>', 'print a virtual file'],
			['open <page>', 'navigate: home | terminal | storage | lab | games | links'],
			['sim [n]', 'list / open a physics simulation'],
			['clear', 'clear the screen']
		] },
		{ title: 'games', rows: [
			['games', 'list the mini games on this site'],
			['play <game> [flags]', 'open a mini game and start it (tetris | blockblast)'],
			['  --easy-mode', 'tetris: never speeds up · blockblast: more long bars and squares'],
			['  --with-roll-back', 'adds an Undo button (U) that takes back the last move']
		] },
		{ title: 'encode & hash', rows: [
			['b64 <text>', 'base64 encode'],
			['b64d <text>', 'base64 decode'],
			['hex <text>', 'text -> hex bytes'],
			['unhex <hex>', 'hex bytes -> text'],
			['url <text>', 'URL encode'],
			['urldecode <text>', 'URL decode'],
			['hash [algo] <text>', 'sha1 / sha256 / sha384 / sha512'],
			['json <text>', 'pretty-print JSON']
		] },
		{ title: 'numbers & time', rows: [
			['calc <expr>', 'math + 7 bitwise ops (NOT AND NAND OR NOR XOR XNOR, 32-bit) + tests (= <> > < >= <= ~=)'],
			['base <value>', 'convert 0x.. / 0b.. / 0o.. / decimal'],
			['ts [value]', 'unix timestamp <-> date'],
			['uuid [n]', 'generate n uuid v4'],
			['pass [len] [-s]', 'random password, -s adds symbols'],
			['color <value>', '#hex | rgb(r,g,b) | hsl(h,s%,l%) + swatch']
		] },
		{ title: 'text', rows: [
			['text <op> <t>', 'upper | lower | title | rev | trim | slug'],
			['count <text>', 'characters / words / lines / utf-8 bytes'],
			['lorem [n]', 'placeholder sentences'],
			['cron <expr>', 'explain a cron expression + next runs']
		] },
		{ title: 'system & fun', rows: [
			['whoami / date', 'user and time'],
			['history', 'command history'],
			['env', 'locale / theme / accent / viewport'],
			['theme <t>', 'dark | light'],
			['accent <c>', 'red | green | blue'],
			['neofetch', 'system info'],
			['matrix', '...']
		] }
	];

	/* 给全局搜索用的扁平清单: 只列文档里有的命令(别名不进搜索, 免得一堆重复项) */
	function commandList() {
		var out = [];
		HELP_GROUPS.forEach(function (group) {
			group.rows.forEach(function (row) {
				var name = String(row[0]).split(' ')[0];
				if (!name || name.charAt(0) === '-') return;   /* 标志位那两行不是命令 */
				out.push({ name: name, usage: row[0], desc: row[1], group: group.title });
			});
		});
		return out;
	}

	var instances = [];

	function create(root, chips) {
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

		/**
		 * 输入行别被底部那条固定坞压住。
		 * 浏览器把聚焦的元素滚进视口时并不认识这条 fixed 坞, 所以聚焦之后自己再看一眼:
		 * 只要输入行的底边落进坞里, 就把页面往上滚一点。
		 */
		function keepPromptClear() {
			var dock = doc.getElementById('dock');
			var line = root.querySelector('.term__prompt-line');
			if (!dock || !line || !line.getBoundingClientRect || !global.scrollBy) return;
			var overlap = line.getBoundingClientRect().bottom + 12 - dock.getBoundingClientRect().top;
			if (overlap <= 0) return;
			var smooth = !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
			global.scrollBy({ top: overlap, behavior: smooth ? 'smooth' : 'auto' });
		}

		function scrollToEnd() {
			body.scrollTop = body.scrollHeight;
		}

		function echoCommand(cmd) {
			var line = doc.createElement('div');
			line.className = 'term__out';
			var prompt = doc.createElement('span');
			prompt.className = 't-ok';
			prompt.textContent = (ps1 ? ps1.textContent : 'hayneko@blog:~$') + ' ';
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
			HELP_GROUPS.forEach(function (group) {
				print('');
				print('  -- ' + group.title, 't-dim');
				group.rows.forEach(function (row) {
					print('  ' + row[0].padEnd(20, ' ') + row[1]);
				});
			});
			print('');
			print(COMMAND_NAMES.length + ' commands  ·  Tab completes, up/down recalls', 't-dim');
		}

		function cmdMan(args) {
			var name = (args[0] || '').toLowerCase();
			if (!name) { print('usage: man <command>', 't-err'); return; }
			var found = null;
			HELP_GROUPS.forEach(function (group) {
				group.rows.forEach(function (row) {
					if (row[0].split(' ')[0] === name) found = row;
				});
			});
			if (!found) { print('man: no entry for "' + name + '"', 't-err'); return; }
			print(name, 't-info');
			print('  usage  ' + found[0], 't-key');
			print('  ' + found[1]);
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

		function cmdSim(args) {
			if (!args.length) {
				print('Available simulations', 't-info');
				SIMS.forEach(function (s, i) {
					print('  ' + (i + 1) + '  ' + s.name.padEnd(14, ' ') + s.href);
				});
				print('');
				print('usage: sim <1-3>', 't-dim');
				return;
			}
			var n = parseInt(args[0], 10);
			var pick = SIMS[n - 1];
			if (!pick) { print('sim: no simulation #' + args[0], 't-err'); return; }
			print('opening ' + pick.name + ' ...', 't-info');
			scrollToEnd();
			global.open(pick.href, '_blank', 'noopener');
		}

		/* 小游戏: 清单由 scripts/games.js 提供, 开局也走它的 launch() */
		function cmdGames() {
			var list = gameList();
			if (!list.length) { print('games: nothing installed', 't-err'); return; }
			print('Available mini games', 't-info');
			list.forEach(function (g, i) {
				print('  ' + (i + 1) + '  ' + g.id.padEnd(12, ' ') + (g.desc || ''));
			});
			print('');
			print('  --easy-mode        tetris: no speed-up / blockblast: more long bars & squares', 't-dim');
			print('  --with-roll-back   adds an Undo button (U)', 't-dim');
			print('');
			print('usage: play <game> [flags]', 't-dim');
		}

		/* play 支持的命令行标志位 -> Games.launch() 里的开关 */
		var PLAY_FLAGS = {
			'--easy-mode': 'easy',
			'--easy': 'easy',
			'--with-roll-back': 'rollback',
			'--with-rollback': 'rollback',
			'--rollback': 'rollback'
		};

		/* play 认 id, 也认 GAMES 里写的 alias(block-blast / blast / bb), id 优先 */
		function findGame(list, name) {
			var found = null;
			list.forEach(function (g) {
				if (g.id === name) found = g;
				else if (!found && g.alias && g.alias.indexOf(name) !== -1) found = g;
			});
			return found;
		}

		function cmdPlay(args) {
			var flags = { easy: false, rollback: false };
			var rest = [];
			var unknown = null;
			args.forEach(function (arg) {
				var lower = String(arg).toLowerCase();
				if (lower.charAt(0) === '-') {
					if (PLAY_FLAGS[lower]) flags[PLAY_FLAGS[lower]] = true;
					else if (!unknown) unknown = arg;
				} else {
					rest.push(arg);
				}
			});
			if (unknown) {
				print('play: unknown flag "' + unknown + '"', 't-err');
				print('  available: --easy-mode   --with-roll-back', 't-dim');
				return;
			}
			var name = (rest[0] || '').toLowerCase();
			if (!name) { cmdGames(); return; }
			var list = gameList();
			var found = findGame(list, name);
			if (!found) {
				print('play: no game named "' + rest[0] + '"', 't-err');
				print('  try: ' + list.map(function (g) { return g.id; }).join(' | '), 't-dim');
				return;
			}
			if (!global.Games || !global.Games.launch) {
				print('play: the games page is not loaded on this build', 't-err');
				return;
			}
			var label = found.id + (flags.easy ? ' --easy-mode' : '') + (flags.rollback ? ' --with-roll-back' : '');
			print('starting ' + label + ' ...', 't-ok');
			scrollToEnd();
			global.Games.launch(found.id, flags);
		}

		function cmdTheme(args) {
			var name = (args[0] || '').toLowerCase();
			if (['dark', 'light'].indexOf(name) === -1) {
				print('usage: theme dark | light', 't-err');
				return;
			}
			if (global.Dock && global.Dock.theme) global.Dock.theme(name);
			print('theme -> ' + name, 't-ok');
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
				'  ██╗  ██╗███╗   ██╗',
				'  ██║  ██║████╗  ██║',
				'  ███████║██╔██╗ ██║',
				'  ██╔══██║██║╚██╗██║',
				'  ██║  ██║██║ ╚████║',
				'  ╚═╝  ╚═╝╚═╝  ╚═══╝'
			];
			var theme = doc.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
			var info = [
				'hayneko@blog',
				'-----------',
				'OS       : HaynekoOS 16.0.0',
				'Shell    : hayneko-sh 1.0',
				'Theme    : ' + theme,
				'Locale   : ' + (global.i18n ? global.i18n.getLocale() : 'n/a'),
				'Viewport : ' + global.innerWidth + 'x' + global.innerHeight,
				'Runtime  : ' + (global.Smear ? 'canvas + smear' : 'canvas')
			];
			var rows = Math.max(logo.length, info.length);
			for (var i = 0; i < rows; i++) {
				var left = (logo[i] || '').padEnd(24, ' ');
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

		/* ================================================== 文本 / 编码 */

		function utf8Bytes(str) { return new TextEncoder().encode(str); }

		function bytesToHex(bytes) {
			var out = '';
			for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
			return out;
		}

		function hexToBytes(hex) {
			var clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
			if (!clean.length) throw new Error('no hex digits');
			if (clean.length % 2) throw new Error('length must be even');
			var bytes = new Uint8Array(clean.length / 2);
			for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
			return bytes;
		}

		function cmdHex(args) {
			if (!args.length) { print('usage: hex <text>', 't-err'); return; }
			var bytes = utf8Bytes(args.join(' '));
			var hex = bytesToHex(bytes);
			print(hex);
			print(hex.replace(/(..)/g, '$1 ').trim(), 't-dim');
			print(bytes.length + ' bytes', 't-dim');
		}

		function cmdUnhex(args) {
			if (!args.length) { print('usage: unhex <hex>', 't-err'); return; }
			try {
				print(new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(args.join(''))), 't-ok');
			} catch (err) {
				print('unhex: not valid UTF-8 (' + err.message + ')', 't-err');
			}
		}

		function cmdUrl(args) {
			if (!args.length) { print('usage: url <text>', 't-err'); return; }
			print(encodeURIComponent(args.join(' ')));
		}

		function cmdUrldecode(args) {
			if (!args.length) { print('usage: urldecode <text>', 't-err'); return; }
			try { print(decodeURIComponent(args.join(' ')), 't-ok'); }
			catch (err) { print('urldecode: malformed input', 't-err'); }
		}

		function cmdCount(args) {
			if (!args.length) { print('usage: count <text>', 't-err'); return; }
			var s = args.join(' ');
			print('  chars        ' + s.length);
			print('  chars(no ws) ' + s.replace(/\s/g, '').length);
			print('  words        ' + (s.trim() ? s.trim().split(/\s+/).length : 0));
			print('  lines        ' + s.split('\n').length);
			print('  bytes(utf8)  ' + utf8Bytes(s).length);
		}

		function cmdText(args) {
			if (args.length < 2) {
				print('usage: text <op> <text>   op = upper | lower | title | rev | trim | slug', 't-err');
				return;
			}
			var op = args[0].toLowerCase();
			var s = args.slice(1).join(' ');
			var out;
			if (op === 'upper') out = s.toUpperCase();
			else if (op === 'lower') out = s.toLowerCase();
			else if (op === 'title') out = s.replace(/[^\s]+/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); });
			else if (op === 'rev') out = s.split('').reverse().join('');
			else if (op === 'trim') out = s.trim().replace(/\s+/g, ' ');
			else if (op === 'slug') out = s.toLowerCase().trim().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
			else { print('text: unknown op "' + op + '"', 't-err'); return; }
			print(out, 't-ok');
		}

		/* ================================================== 数字 / 进制 */

		function cmdBase(args) {
			if (!args.length) {
				print('usage: base <value>    0x.. hex | 0b.. bin | 0o.. oct | plain = decimal', 't-err');
				return;
			}
			var raw = String(args[0]).replace(/_/g, '');
			var n = NaN;
			if (/^0[xX][0-9a-fA-F]+$/.test(raw)) n = parseInt(raw.slice(2), 16);
			else if (/^0[bB][01]+$/.test(raw)) n = parseInt(raw.slice(2), 2);
			else if (/^0[oO][0-7]+$/.test(raw)) n = parseInt(raw.slice(2), 8);
			else if (/^-?[0-9]+$/.test(raw)) n = Number(raw);
			if (!isFinite(n)) { print('base: not an integer: ' + args[0], 't-err'); return; }
			if (Math.abs(n) > Number.MAX_SAFE_INTEGER) { print('base: beyond 2^53, may be inexact', 't-warn'); }

			var neg = n < 0;
			var abs = Math.abs(n);
			var sign = neg ? '-' : '';
			print('  dec  ' + sign + abs);
			print('  hex  0x' + sign + abs.toString(16).toUpperCase());
			print('  oct  0o' + sign + abs.toString(8));
			print('  bin  0b' + sign + abs.toString(2).replace(/\B(?=(\d{4})+(?!\d))/g, ' '));
			print('  u32  ' + byteBreakdown(abs), 't-dim');
		}

		function byteBreakdown(n) {
			if (n > 0xffffffff) return '(too large for 32-bit)';
			var parts = [];
			for (var shift = 24; shift >= 0; shift -= 8) {
				parts.push((((n >>> shift) & 0xff)).toString(16).toUpperCase().padStart(2, '0'));
			}
			return parts.join(' ');
		}

		function round12(v) { return String(Math.round(v * 1e12) / 1e12); }

		/* -------------------------------------------------- calc 表达式求值
		 *
		 * 手写词法分析 + 递归下降, 不用 eval。
		 * 优先级(低 → 高):
		 *   OR/NOR < XOR/XNOR < AND/NAND < NOT < 比较 < + - < * / % < 一元± < ^
		 *
		 * 两类运算符的输出完全不同, 别混:
		 *   - 比较(= <> > < >= <= ~=) 判断条件是否成立 → TRUE / FALSE;
		 *   - NOT / AND / OR / XOR / NAND / NOR / XNOR 是**位运算**,
		 *     按 32 位有符号整数算, 打印十进制结果(calc 3 xnor 4 → -8)。
		 */

		var CALC_FN1 = {
			sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
			sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log, log10: Math.log10, exp: Math.exp,
			sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
			asin: Math.asin, acos: Math.acos, atan: Math.atan,
			asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
			cbrt: Math.cbrt
		};

		var CALC_FN_N = { pow: Math.pow, min: Math.min, max: Math.max };

		var CALC_CONST = { pi: Math.PI, e: Math.E, true: true, false: false };

		var CALC_CMP = { '=': 1, '==': 1, '<>': 1, '!=': 1, '~=': 1, '>': 1, '<': 1, '>=': 1, '<=': 1 };

		/* 七种逻辑运算: NOT / AND / NAND / OR / NOR / XOR / XNOR */
		var CALC_LOGIC = { not: 1, and: 1, nand: 1, or: 1, nor: 1, xor: 1, xnor: 1 };
		var CALC_ORDER = '^ > * / % > + - > compare > NOT > AND/NAND > XOR/XNOR > OR/NOR';

		/* 比较的结果是布尔, 进了算术/位运算就当 1 / 0 用 */
		function toNumber(v) { return typeof v === 'boolean' ? (v ? 1 : 0) : v; }

		/* 显示是按 12 位小数四舍五入的, 比较也放宽到同一档 ——
		   否则 calc 0.1+0.2 = 0.3 会显示 0.3 却判成 FALSE */
		function calcNear(a, b) {
			if (a === b) return true;
			var scale = Math.max(Math.abs(a), Math.abs(b), 1);
			return Math.abs(a - b) <= 1e-12 * scale;
		}

		function calcCompare(a, b, op) {
			if (op === '=' || op === '==') return calcNear(a, b);
			if (op === '<>' || op === '!=' || op === '~=') return !calcNear(a, b);
			if (op === '>') return a > b;
			if (op === '<') return a < b;
			if (op === '>=') return a >= b;
			return a <= b;
		}

		function calcNumber(raw) {
			return /^0[xX]/.test(raw) ? parseInt(raw.slice(2), 16) : Number(raw);
		}

		function calcTokenize(src) {
			var tokens = [];
			var i = 0;
			while (i < src.length) {
				var ch = src.charAt(i);
				if (ch === ' ' || ch === '\t') { i++; continue; }
				if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src.charAt(i + 1)))) {
					var num = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
					tokens.push({ t: 'num', v: calcNumber(num[0]), raw: num[0], start: i, end: i + num[0].length });
					i += num[0].length;
					continue;
				}
				if (/[a-zA-Z_]/.test(ch)) {
					var id = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))[0];
					tokens.push({ t: 'id', v: id.toLowerCase(), raw: id, start: i, end: i + id.length });
					i += id.length;
					continue;
				}
				var pair = src.substr(i, 2);
				if (pair === '>=' || pair === '<=' || pair === '<>' || pair === '~=' || pair === '!=' || pair === '==') {
					tokens.push({ t: 'op', v: pair, raw: pair, start: i, end: i + 2 });
					i += 2;
					continue;
				}
				if ('+-*/%^()=<>,'.indexOf(ch) !== -1) {
					tokens.push({ t: 'op', v: ch, raw: ch, start: i, end: i + 1 });
					i++;
					continue;
				}
				throw new Error('unexpected "' + ch + '"');
			}
			return tokens;
		}

		function calcCall(name, args, raw) {
			if (CALC_FN_N[name]) {
				if (name === 'pow' && args.length !== 2) throw new Error('pow() takes 2 arguments');
				return CALC_FN_N[name].apply(null, args.map(toNumber));
			}
			if (!CALC_FN1[name]) throw new Error('unknown function "' + raw + '"');
			if (args.length !== 1) throw new Error(name + '() takes 1 argument');
			return CALC_FN1[name](toNumber(args[0]));
		}

		/* 中缀的位运算符(not 是前缀, 不算) */
		var CALC_INFIX = { and: 1, nand: 1, or: 1, nor: 1, xor: 1, xnor: 1 };

		/**
		 * 括号没闭合时把 ")" 补在哪儿, 很影响读出来的意思。
		 *
		 *   calc 1+2*3-sin(1 and 1
		 *     ✗ 补在最末尾 → sin(1 and 1)   —— 位运算被包进了函数里
		 *     ✓ 补在 and 前面 → sin(1) and 1 —— 位运算留在括号外
		 *
		 * 所以规则是: 括号里如果出现**同层的位运算 / 比较运算**, 就把 ")" 补在那个运算符前面;
		 * 一层里没有这类运算符, 才补在最末尾(原来的行为)。
		 * 返回补好之后的表达式与补了几个, 显示时用的就是补好之后的样子。
		 */
		function calcAutoClose(text) {
			var tokens = calcTokenize(text);
			var depthBefore = [];
			var stack = [];
			var d = 0;
			for (var i = 0; i < tokens.length; i++) {
				depthBefore.push(d);
				var tk = tokens[i];
				if (tk.t === 'op' && tk.v === '(') { stack.push(i); d++; }
				else if (tk.t === 'op' && tk.v === ')') { if (stack.length) { stack.pop(); d--; } }
			}
			if (!stack.length) return { src: text, closed: 0 };

			var inserts = [];
			stack.forEach(function (p) {
				var inner = depthBefore[p] + 1;
				for (var j = p + 1; j < tokens.length; j++) {
					if (depthBefore[j] < inner) break;
					var t = tokens[j];
					if ((t.t === 'op' && CALC_CMP[t.v]) || (t.t === 'id' && CALC_INFIX[t.v])) {
						inserts.push(tokens[j].start);
						return;
					}
				}
				inserts.push(text.length);
			});

			/* 从后往前插, 免得前面的位置被后面的插入顶偏 */
			inserts.sort(function (a, b) { return b - a; });
			var out = text;
			inserts.forEach(function (pos) {
				var at = pos;
				while (at > 0 && (out.charAt(at - 1) === ' ' || out.charAt(at - 1) === '\t')) at--;
				out = out.slice(0, at) + ')' + out.slice(at);
			});
			return { src: out, closed: inserts.length };
		}

		function calcEval(src) {
			var tokens = calcTokenize(src);
			if (!tokens.length) throw new Error('empty expression');
			var pos = 0;
			var depth = 0;
			var tiers = {};

			var powerTicks = {};      /* 每层括号里用过几次 "^"(要分清 (-3)^2 与 -(3^2)) */
			var lastPower = null;     /* 最近解析的那个乘方(底数/指数的文字与数值) */

			function powerTickAt() { return powerTicks[depth] || 0; }

			function tierAt() { return tiers[depth] || (tiers[depth] = {}); }
			function markTier(name) { tierAt()[name] = true; }

			function peek() { return tokens[pos]; }
			function take() { return tokens[pos++]; }
			function isOp(v) { var t = peek(); return !!t && t.t === 'op' && t.v === v; }
			function isWord(v) { var t = peek(); return !!t && t.t === 'id' && t.v === v; }

			function parseExpr() { return parseOr(); }

			/* 注意: 右边一定要先解析出来再算, 不能写成 left || parseXor() ——
			   JS 的短路求值会让右边那句根本不执行, 右边的操作数就没被吃掉,
			   于是 1 OR 0 会报 "unexpected 0"。 */
			/* 位运算统一按 32 位有符号整数算 —— JS 的 & | ^ ~ 本身就是 ToInt32,
			   所以 3 XNOR 4 = ~(3 ^ 4) = ~7 = -8(十进制有符号)。 */
			function parseOr() {
				var left = parseXor();
				for (;;) {
					if (isWord('or')) { take(); markTier('bitwise'); left = toNumber(left) | toNumber(parseXor()); }
					else if (isWord('nor')) { take(); markTier('bitwise'); left = ~(toNumber(left) | toNumber(parseXor())); }
					else return left;
				}
			}

			function parseXor() {
				var left = parseAnd();
				for (;;) {
					if (isWord('xor')) { take(); markTier('bitwise'); left = toNumber(left) ^ toNumber(parseAnd()); }
					else if (isWord('xnor')) { take(); markTier('bitwise'); left = ~(toNumber(left) ^ toNumber(parseAnd())); }
					else return left;
				}
			}

			function parseAnd() {
				var left = parseNot();
				for (;;) {
					if (isWord('and')) { take(); markTier('bitwise'); left = toNumber(left) & toNumber(parseNot()); }
					else if (isWord('nand')) { take(); markTier('bitwise'); left = ~(toNumber(left) & toNumber(parseNot())); }
					else return left;
				}
			}

			function parseNot() {
				if (isWord('not')) { take(); markTier('bitwise'); return ~toNumber(parseNot()); }
				return parseCompare();
			}

			function parseCompare() {
				var left = parseAdd();
				var links = 0;
				for (;;) {
					var t = peek();
					var op = t && t.t === 'op' && CALC_CMP[t.v] ? t.v : null;
					if (!op) return left;
					take();
					links++;
					markTier('compare');
					/* 连着写 1 < 2 < 3 才有歧义; 5 >= 5 AND 1 <> 2 是两个独立比较, 不算 */
					if (links > 1) tierAt().compareChain = true;
					left = calcCompare(toNumber(left), toNumber(parseAdd()), op);
				}
			}

			function parseAdd() {
				var v = parseMul();
				for (;;) {
					if (isOp('+')) { take(); markTier('arith'); v = toNumber(v) + toNumber(parseMul()); }
					else if (isOp('-')) { take(); markTier('arith'); v = toNumber(v) - toNumber(parseMul()); }
					else return v;
				}
			}

			function parseMul() {
				var v = parseUnary();
				for (;;) {
					if (isOp('*')) { take(); markTier('arith'); v = toNumber(v) * toNumber(parseUnary()); }
					else if (isOp('/')) { take(); markTier('arith'); v = toNumber(v) / toNumber(parseUnary()); }
					else if (isOp('%')) { take(); markTier('arith'); v = toNumber(v) % toNumber(parseUnary()); }
					else return v;
				}
			}

			function parseUnary() {
				if (isOp('-')) {
					var minusAt = pos;
					take();
					markTier('arith');
					var before = powerTickAt();
					var neg = -toNumber(parseUnary());
					/* -3^2: 负号在前、乘方在后, 到底是 -(3^2) 还是 (-3)^2 —— 两种写法都算出来给他看 */
					if (powerTickAt() > before) {
						if (lastPower) {
							var alt = Math.pow(-lastPower.baseValue, lastPower.expValue);
							tierAt().minusPower = {
								text: src.slice(tokens[minusAt].start, tokens[pos - 1].end).trim(),
								baseText: lastPower.baseText,
								expText: lastPower.expText,
								plain: -Math.pow(lastPower.baseValue, lastPower.expValue),
								alt: alt
							};
						} else {
							tierAt().minusPower = true;
						}
					}
					return neg;
				}
				if (isOp('+')) { take(); markTier('arith'); return toNumber(parseUnary()); }
				return parsePower();
			}

			function tokenText(a, b) {
				if (b <= a) return '';
				return src.slice(tokens[a].start, tokens[b - 1].end).trim();
			}

			function parsePower() {
				var baseStart = pos;
				var base = parseAtom();
				if (isOp('^')) {
					var caret = pos;
					take();
					markTier('power');
					var here = powerTickAt();
					powerTicks[depth] = here + 1;
					var expStart = pos;
					var exp = parseUnary();
					var expEnd = pos;

					var baseText = tokenText(baseStart, caret);
					var expText = tokenText(expStart, expEnd);
					var inner = lastPower;   /* 指数本身若又是个乘方, 这里就是它的信息 */
					lastPower = {
						baseText: baseText,
						expText: expText,
						baseValue: toNumber(base),
						expValue: toNumber(exp)
					};

					/* a^b^c: 由**外层**这一回来报 —— 只有它同时知道整条链和两种取值。
					   同层又用了一次 ^ 才算链; 2^(3^4) 里层 depth 变了, 不算。 */
					if (inner && powerTickAt() > here + 1) {
						tierAt().powerChain = {
							text: baseText + '^' + inner.baseText + '^' + inner.expText,
							rightText: baseText + '^(' + inner.baseText + '^' + inner.expText + ')',
							leftText: '(' + baseText + '^' + inner.baseText + ')^' + inner.expText,
							right: Math.pow(toNumber(base), toNumber(exp)),
							left: Math.pow(Math.pow(toNumber(base), inner.baseValue), inner.expValue)
						};
					}
					return Math.pow(toNumber(base), toNumber(exp));
				}
				return base;
			}

			/* 2x / 2(3) 这类省略乘号不支持 —— 报错时说清楚该怎么写 */
			function rejectImplicit(numTok) {
				var t = peek();
				if (!t) return;
				if (t.t === 'id' && CALC_LOGIC[t.v]) return;   /* AND / OR / XOR... 是运算符, 不是省略乘号 */
				if (t.t === 'num' || t.t === 'id') {
					throw new Error('implicit multiplication is not supported — write "' + numTok.raw + ' * ' + t.raw + '"');
				}
				if (t.t === 'op' && t.v === '(') {
					throw new Error('implicit multiplication is not supported — write "' + numTok.raw + ' * (...)"');
				}
			}

			function parseAtom() {
				var tok = take();
				if (!tok) throw new Error('unexpected end of expression');
				if (tok.t === 'num') { rejectImplicit(tok); return tok.v; }
				if (tok.t === 'op' && tok.v === '(') {
					depth++;
					var inner = parseExpr();
					depth--;
					if (isOp(')')) take();
					else throw new Error('missing ")"');
					return inner;
				}
				if (tok.t === 'id') {
					if (Object.prototype.hasOwnProperty.call(CALC_CONST, tok.v)) return CALC_CONST[tok.v];
					if (isOp('(')) {
						take();
						depth++;
						var list = [];
						if (!isOp(')')) {
							list.push(parseExpr());
							while (isOp(',')) { take(); list.push(parseExpr()); }
						}
						depth--;
						if (!isOp(')')) throw new Error('missing ")"');
						take();
						return calcCall(tok.v, list, tok.raw);
					}
					throw new Error('unknown name "' + tok.raw + '"');
				}
				throw new Error('unexpected "' + (tok.raw || tok.v) + '"');
			}

			var value = parseExpr();
			if (pos < tokens.length) {
				var rest = tokens[pos];
				if (rest.t === 'op' && rest.v === ')') throw new Error('unmatched ")"');
				throw new Error('unexpected "' + (rest.raw || rest.v) + '"');
			}
			return { value: value, tiers: tiers };
		}

		/**
		 * 只在**真的容易读错**的时候提示, 提示一律走 warn 色(黄)。
		 *
		 * 3+2*3-4 这种不提示 —— 先乘除后加减是常识, 每次都念一遍等于没念。
		 * 真正提示的是这几类:
		 *   1. 位运算与算术混写    —— 1 xor 2 + 3 and 4
		 *   2. a^b^c 的右结合     —— 2^3^4
		 *   3. 一元负号遇上乘方    —— -3^2 是 -(3^2) 还是 (-3)^2
		 *   4. 连着写比较         —— 1 < 2 < 3(而 5 >= 5 AND 1 <> 2 是两个独立比较, 不算)
		 * 括号没闭合另有一条灰色 note; 若其内容又混了运算符, 上面第 1 条会一并报出来。
		 */
		function calcWarnings(tiers) {
			var flags = {};
			Object.keys(tiers).forEach(function (d) {
				var t = tiers[d];
				if (t.bitwise && t.arith) flags.mix = true;
				if (t.powerChain) flags.powerChain = t.powerChain;
				if (t.minusPower) flags.minusPower = t.minusPower;   /* 对象里带着两种写法的文字与取值 */
				if (t.compareChain) flags.compareChain = true;
			});
			var out = [];
			if (flags.mix) out.push('warn: bitwise mixed with arithmetic — parenthesize; standard order: ' + CALC_ORDER);
			if (flags.powerChain) {
				var pc = flags.powerChain;
				if (pc === true) {
					out.push('warn: chained "^" is right-associative here — add parentheses');
				} else {
					out.push('warn: "' + pc.text + '" is right-associative — write ' + pc.rightText + ' = ' +
						round12(pc.right) + ' or ' + pc.leftText + ' = ' + round12(pc.left));
				}
			}
			if (flags.minusPower) {
				var mp = flags.minusPower;
				if (mp === true) {
					out.push('warn: unary minus with "^" is ambiguous — add parentheses');
				} else {
					out.push('warn: ambiguous "' + mp.text + '" — write -(' + mp.baseText + '^' + mp.expText + ') = ' +
						round12(mp.plain) + ' or (-' + mp.baseText + ')^' + mp.expText + ' = ' + round12(mp.alt));
				}
			}
			if (flags.compareChain) out.push('warn: chained comparison is left-associative here ((a < b) < c) — add parentheses');
			return out;
		}

		function cmdCalc(args) {
			if (!args.length) {
				print('usage: calc <expression>', 't-err');
				print('  e.g.  calc (1+2)*3^2   calc cbrt(27)   calc sinh(1)   calc 2 < 3   calc 1 AND NOT 0', 't-dim');
				print('  funcs: sqrt abs round floor ceil sin cos tan log log10 exp pow min max', 't-dim');
				print('         sinh cosh tanh asin acos atan asinh acosh atanh cbrt', 't-dim');
				print('  bitwise (32-bit signed): NOT x    x AND/NAND/OR/NOR/XOR/XNOR y', 't-dim');
				print('  tests: = <> > < >= <= ~=   -> TRUE / FALSE', 't-dim');
				return;
			}
			var src = args.join(' ');
			var note = '';
			/* 括号没闭合: 自动补上(补在哪儿见 calcAutoClose), 并说明补了几个 */
			var fixed = calcAutoClose(src);
			if (fixed.closed) {
				note = 'note: auto-closed ' + fixed.closed + ' unclosed "("';
				src = fixed.src;
			}
			try {
				var out = calcEval(src);
				if (note) print(note, 't-dim');
				calcWarnings(out.tiers).forEach(function (w) { print(w, 't-warn'); });
				if (typeof out.value === 'boolean') {
					print(src + '  =  ' + (out.value ? 'TRUE' : 'FALSE'), 't-ok');
					return;
				}
				if (!isFinite(out.value)) { print('calc: result is not finite (domain error?)', 't-err'); return; }
				print(src + '  =  ' + round12(out.value), 't-ok');
			} catch (err) {
				print('calc: ' + err.message, 't-err');
			}
		}

		/* ================================================== 时间 / 哈希 */

		function cmdTs(args) {
			var now = new Date();
			if (!args.length) {
				print('  unix(s)   ' + Math.floor(now.getTime() / 1000));
				print('  unix(ms)  ' + now.getTime());
				print('  iso       ' + now.toISOString());
				print('  local     ' + now.toString());
				return;
			}
			var raw = args.join(' ');
			if (/^-?\d+(\.\d+)?$/.test(raw)) {
				var num = Number(raw);
				/* 小于 1e11 当秒, 否则当毫秒 */
				var ms = Math.abs(num) < 1e11 ? num * 1000 : num;
				var d = new Date(ms);
				if (isNaN(d.getTime())) { print('ts: out of range', 't-err'); return; }
				print('  iso    ' + d.toISOString());
				print('  local  ' + d.toString());
				print('  unix(s) ' + Math.floor(ms / 1000), 't-dim');
			} else {
				var parsed = new Date(raw);
				if (isNaN(parsed.getTime())) { print('ts: cannot parse "' + raw + '"', 't-err'); return; }
				print('  unix(s)  ' + Math.floor(parsed.getTime() / 1000));
				print('  unix(ms) ' + parsed.getTime());
				print('  iso      ' + parsed.toISOString(), 't-dim');
			}
		}

		var HASH_ALGOS = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

		function cmdHash(args) {
			var rest = args.slice();
			var algo = 'SHA-256';
			var head = (rest[0] || '').toLowerCase().replace(/-/g, '');
			if (HASH_ALGOS[head]) { algo = HASH_ALGOS[head]; rest.shift(); }
			if (!rest.length) { print('usage: hash [sha1|sha256|sha384|sha512] <text>', 't-err'); return; }
			if (!global.crypto || !global.crypto.subtle) {
				print('hash: crypto.subtle unavailable (needs https or localhost)', 't-err');
				return;
			}
			var data = utf8Bytes(rest.join(' '));
			var pending = print('computing ' + algo + ' ...', 't-dim');
			global.crypto.subtle.digest(algo, data).then(function (buf) {
				pending.remove();
				print(algo.toLowerCase().replace(/-/g, '') + '  ' + bytesToHex(new Uint8Array(buf)), 't-ok');
				scrollToEnd();
			}).catch(function (err) {
				pending.textContent = 'hash: ' + err.message;
				pending.className = 'term__out t-err';
			});
		}

		/* ================================================== 颜色 */

		function hslToRgb(h, s, l) {
			h = (((h % 360) + 360) % 360) / 360;
			if (s === 0) {
				var g0 = Math.round(l * 255);
				return { r: g0, g: g0, b: g0 };
			}
			var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			var p = 2 * l - q;
			function hue(t) {
				if (t < 0) t += 1;
				if (t > 1) t -= 1;
				if (t < 1 / 6) return p + (q - p) * 6 * t;
				if (t < 1 / 2) return q;
				if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
				return p;
			}
			return { r: Math.round(hue(h + 1 / 3) * 255), g: Math.round(hue(h) * 255), b: Math.round(hue(h - 1 / 3) * 255) };
		}

		function rgbToHsl(r, g, b) {
			r /= 255; g /= 255; b /= 255;
			var max = Math.max(r, g, b);
			var min = Math.min(r, g, b);
			var l = (max + min) / 2;
			var h = 0, s = 0, d = max - min;
			if (d) {
				s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
				if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
				else if (max === g) h = (b - r) / d + 2;
				else h = (r - g) / d + 4;
				h *= 60;
			}
			return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
		}

		function parseColor(v) {
			var s = String(v).trim().replace(/\s+/g, '');
			var m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
			if (m) {
				var h = m[1];
				if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
				return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
			}
			m = /^rgba?\((\d+),(\d+),(\d+)/.exec(s);
			if (m) return { r: Math.min(255, +m[1]), g: Math.min(255, +m[2]), b: Math.min(255, +m[3]) };
			m = /^hsla?\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?)%?,(\d+(?:\.\d+)?)%?/.exec(s);
			if (m) return hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
			return null;
		}

		function cmdColor(args) {
			if (!args.length) { print('usage: color <#hex | rgb(r,g,b) | hsl(h,s%,l%)>', 't-err'); return; }
			var c = parseColor(args.join(''));
			if (!c) { print('color: cannot parse "' + args.join(' ') + '"', 't-err'); return; }
			var hex = '#' + [c.r, c.g, c.b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
			var hsl = rgbToHsl(c.r, c.g, c.b);
			/* 只插入自己算出来的规范值, 不插入用户原始输入 */
			printHTML('<span style="display:inline-block;width:3em;height:1em;vertical-align:-0.15em;background:' +
				hex + ';border:1px solid rgba(230,237,243,.35)"></span>   ' + hex.toUpperCase() +
				'   rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')   hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)');
			print('  ' + hex.replace('#', '').toUpperCase() + '  ·  ' + hex.replace('#', '').toLowerCase(), 't-dim');
		}

		/* ================================================== 生成器 */

		var LOREM_WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut ' +
			'labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ' +
			'ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur ' +
			'excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ');

		function cmdLorem(args) {
			var n = parseInt(args[0], 10);
			if (isNaN(n) || n < 1) n = 3;
			n = Math.min(n, 12);
			for (var s = 0; s < n; s++) {
				var len = 8 + Math.floor(Math.random() * 12);
				var words = [];
				for (var i = 0; i < len; i++) words.push(LOREM_WORDS[Math.floor(Math.random() * LOREM_WORDS.length)]);
				var text = words.join(' ');
				print(text.charAt(0).toUpperCase() + text.slice(1) + '.');
			}
			print('');
			print(n + ' sentences', 't-dim');
		}

		/* 无偏随机: 拒绝采样, 避免取模偏置 */
		function randomInt(max) {
			if (max <= 1) return 0;
			var limit = Math.floor(4294967296 / max) * max;
			var buf = new Uint32Array(1);
			var v;
			do {
				if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(buf);
				else buf[0] = Math.floor(Math.random() * 4294967296);
				v = buf[0];
			} while (v >= limit);
			return v % max;
		}

		var PASS_SETS = {
			lower: 'abcdefghijkmnopqrstuvwxyz',
			upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
			digit: '23456789',
			symbol: '!@#$%^&*-_=+?'
		};

		function cmdPass(args) {
			var len = parseInt(args[0], 10);
			if (isNaN(len) || len < 4) len = 20;
			len = Math.min(len, 128);
			var pool = PASS_SETS.lower + PASS_SETS.upper + PASS_SETS.digit;
			if (args.indexOf('-s') !== -1 || args.indexOf('--symbols') !== -1) pool += PASS_SETS.symbol;
			var out = '';
			for (var i = 0; i < len; i++) out += pool.charAt(randomInt(pool.length));
			print(out, 't-ok');
			print(len + ' chars · alphabet ' + pool.length + ' · ' + (global.crypto && global.crypto.getRandomValues ? 'crypto' : 'Math.random'), 't-dim');
		}

		/* ================================================== cron */

		function parseCronField(field, min, max) {
			var out = {};
			field.split(',').forEach(function (part) {
				var step = 1;
				var range = part;
				var slash = part.indexOf('/');
				if (slash !== -1) {
					range = part.slice(0, slash);
					step = parseInt(part.slice(slash + 1), 10);
				}
				if (!isFinite(step) || step < 1) throw new Error('bad step in "' + part + '"');
				var lo, hi;
				if (range === '*') { lo = min; hi = max; }
				else if (range.indexOf('-') !== -1) {
					var seg = range.split('-');
					lo = parseInt(seg[0], 10);
					hi = parseInt(seg[1], 10);
				} else {
					lo = hi = parseInt(range, 10);
				}
				if (!isFinite(lo) || !isFinite(hi) || lo < min || hi > max || lo > hi) {
					throw new Error('out of range in "' + part + '"');
				}
				for (var v = lo; v <= hi; v += step) out[v] = true;
			});
			return out;
		}

		function describeCronField(field, set, min, max) {
			if (field === '*') return 'every';
			if (/^\*\/\d+$/.test(field)) return 'every ' + field.slice(2);
			var keys = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
			if (keys.length === max - min + 1) return 'every';
			return 'at ' + keys.join(', ');
		}

		function nextCronRuns(sets, count) {
			var out = [];
			var d = new Date();
			d.setSeconds(0, 0);
			d.setMinutes(d.getMinutes() + 1);
			/* 最多往前找 400 天 */
			for (var guard = 0; guard < 60 * 24 * 400 && out.length < count; guard++) {
				if (sets[0][d.getMinutes()] && sets[1][d.getHours()] && sets[2][d.getDate()] &&
					sets[3][d.getMonth() + 1] && sets[4][d.getDay()]) {
					out.push(new Date(d.getTime()));
				}
				d.setMinutes(d.getMinutes() + 1);
			}
			return out;
		}

		function cmdCron(args) {
			if (!args.length) {
				print('usage: cron "<min> <hour> <day-of-month> <month> <day-of-week>"', 't-err');
				print('  e.g.  cron "*/15 9-17 * * 1-5"', 't-dim');
				return;
			}
			var parts = args.join(' ').trim().split(/\s+/);
			if (parts.length !== 5) { print('cron: need exactly 5 fields, got ' + parts.length, 't-err'); return; }
			var FIELDS = [
				['minute', 0, 59], ['hour', 0, 23], ['day of month', 1, 31], ['month', 1, 12], ['day of week', 0, 6]
			];
			var sets = [];
			try {
				for (var i = 0; i < 5; i++) sets.push(parseCronField(parts[i], FIELDS[i][1], FIELDS[i][2]));
			} catch (err) {
				print('cron: ' + err.message, 't-err');
				return;
			}
			print('  ' + parts.join(' '), 't-cmd');
			for (var j = 0; j < 5; j++) {
				print('  ' + FIELDS[j][0].padEnd(14, ' ') + describeCronField(parts[j], sets[j], FIELDS[j][1], FIELDS[j][2]));
			}
			var runs = nextCronRuns(sets, 3);
			print('');
			if (!runs.length) { print('  no run in the next 400 days', 't-dim'); return; }
			print('  next runs', 't-info');
			runs.forEach(function (d) { print('    ' + d.toString().slice(0, 24)); });
		}

		/* ================================================== 终端 / 系统 */

		function cmdHistory() {
			if (!history.length) { print('history: empty', 't-dim'); return; }
			history.forEach(function (h, i) { print('  ' + String(i + 1).padStart(4, ' ') + '  ' + h); });
			print('');
			print(history.length + ' entries', 't-dim');
		}

		function cmdTree() {
			print(doc.querySelector('.term__ps1') ? '~/tools' : '~/');
			EPOCH_FILES.forEach(function (name, i) {
				var last = i === EPOCH_FILES.length - 1;
				print('  ' + (last ? '└── ' : '├── ') + name + '   ' + VFS[name].length + ' lines', 't-dim');
			});
		}

		function cmdEnv() {
			var i18n = global.i18n;
			var html = doc.documentElement;
			var pref = global.MotionPref;
			print('  locale      ' + (i18n ? i18n.getLocale() : 'n/a'));
			print('  theme       ' + (html.getAttribute('data-theme') || 'dark'));
			print('  accent      ' + (html.getAttribute('data-accent') || 'green'));
			print('  motion      ' + (pref ? (pref.reduced ? 'reduced (' + pref.source + ')' : 'full (' + pref.source + ')') : 'n/a'));
			print('  viewport    ' + global.innerWidth + 'x' + global.innerHeight + ' @' + (global.devicePixelRatio || 1) + 'x');
			print('  route       ' + (global.Router ? '#/' + global.Router.current : 'n/a'));
			print('  dock items  ' + doc.querySelectorAll('#dock [data-dock]').length);
			print('  commands    ' + COMMAND_NAMES.length, 't-dim');
		}

		/* ================================================== 彩蛋 */

		function cmdSudo(args) {
			/* 彩蛋: sudo rm -rf /* —— 参数里同时出现 r、f 与 "/" 或 "/*" 才触发 */
			var flags = { r: false, f: false };
			var wipe = false;
			(args || []).forEach(function (arg) {
				if (/^-[a-z]+$/i.test(arg)) {
					var letters = arg.slice(1).toLowerCase();
					if (letters.indexOf('r') !== -1) flags.r = true;
					if (letters.indexOf('f') !== -1 && letters.indexOf('i') === -1) flags.f = true;
				} else if (/^\/\*?$/.test(arg)) {
					wipe = true;
				}
			});
			if (flags.r && flags.f && wipe) { wipeEgg(); return; }
			print('hayneko is not in the sudoers file.  This incident has been reported.', 't-err');
		}

		/* sudo rm -rf /* 的完整演出 */
		function wipeEgg() {
			var script = [
				['[sudo] password for guest: ********', 't-dim', 0],
				['rm: descending into / ...', null, 320],
				['rm: removed /home/hayneko .......... 1.2 GiB', null, 540],
				['rm: removed /etc ................... 4.1 MiB', null, 720],
				['rm: removed /usr ................... 1.8 GiB', null, 900],
				['rm: removed /var/log ............... 220 MiB', null, 1080],
				['rm: removed /boot/vmlinuz .......... 11 MiB', null, 1260],
				['rm: removed / ...................... done', 't-err', 1440],
				['KERNEL PANIC - not syncing: Attempted to kill init!', 't-err', 1700],
				['...', 't-dim', 1980],
				['just kidding — this site is static, there is no server left to delete :)', 't-ok', 2200],
				['(run "clear" for a clean screen)', 't-dim', 2420]
			];
			script.forEach(function (row) {
				global.setTimeout(function () {
					print(row[0], row[1] || undefined);
					scrollToEnd();
				}, row[2]);
			});
		}

		function cmdVim() {
			print('vim: opening ...', 't-dim');
			setTimeout(function () { print('vim: use :q! to leave.  (you know the way out)', 't-info'); scrollToEnd(); }, 320);
		}

		var MATRIX_CHARS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789';

		function cmdMatrix() {
			print('entering the matrix ...   (run "clear" to leave)', 't-ok');
			var box = doc.createElement('div');
			box.className = 'term-matrix';
			for (var c = 0; c < 30; c++) {
				var col = doc.createElement('span');
				col.style.animationDelay = (-Math.random() * 3).toFixed(2) + 's';
				col.style.animationDuration = (1.6 + Math.random() * 1.8).toFixed(2) + 's';
				var chars = '';
				for (var r = 0; r < 30; r++) chars += MATRIX_CHARS.charAt(Math.floor(Math.random() * MATRIX_CHARS.length)) + '\n';
				col.textContent = chars;
				box.appendChild(col);
			}
			body.appendChild(box);
			scrollToEnd();
		}

		function cmdNotFound(name) {
			print(name + ': command not found', 't-err');
			print("type 'help' for the command list", 't-dim');
		}

		var COMMANDS = {
			/* 帮助 / 导航 */
			help: cmdHelp,
			'?': cmdHelp,
			man: cmdMan,
			ls: cmdLs,
			dir: cmdLs,
			tree: cmdTree,
			cat: cmdCat,
			open: cmdOpen,
			clear: cmdClear,
			cls: cmdClear,

			/* 文本 */
			echo: cmdEcho,
			text: cmdText,
			count: cmdCount,
			lorem: cmdLorem,

			/* 编码 / 哈希 */
			b64: cmdB64,
			base64: cmdB64,
			b64d: cmdB64d,
			hex: cmdHex,
			unhex: cmdUnhex,
			url: cmdUrl,
			urldecode: cmdUrldecode,
			hash: cmdHash,
			sha256: cmdSha256,
			json: cmdJson,

			/* 数字 / 时间 */
			calc: cmdCalc,
			base: cmdBase,
			ts: cmdTs,
			uuid: cmdUuid,
			pass: cmdPass,
			color: cmdColor,
			cron: cmdCron,

			/* 系统 */
			whoami: cmdWhoami,
			date: cmdDate,
			history: cmdHistory,
			env: cmdEnv,
			theme: cmdTheme,
			accent: cmdAccent,
			neofetch: cmdNeofetch,
			sim: cmdSim,
			sims: cmdSim,

			/* 小游戏 */
			games: cmdGames,
			play: cmdPlay,

			/* 彩蛋 */
			matrix: cmdMatrix,
			sudo: cmdSudo,
			vim: cmdVim
		};

		var COMMAND_NAMES = Object.keys(COMMANDS);

		/* -------------------------------------------------- 执行 */

		/**
		 * 按 shell 的习惯切词: 支持单/双引号, 引号里的空格不会被拆开。
		 * 这样带引号的 cron 表达式、带空格的 hex 文本都能按预期工作。
		 * (注意: 块注释里不能出现星号加斜杠, 会提前结束注释 —— 这里就不写示例了)
		 */
		function tokenize(line) {
			var out = [];
			var cur = '';
			var quoted = false;
			var pending = false;
			for (var i = 0; i < line.length; i++) {
				var ch = line.charAt(i);
				if (quoted) {
					if (ch === quoted) quoted = false;
					else cur += ch;
					continue;
				}
				if (ch === '"' || ch === "'") { quoted = ch; pending = true; continue; }
				if (ch === ' ' || ch === '\t') {
					if (cur.length || pending) { out.push(cur); cur = ''; pending = false; }
					continue;
				}
				cur += ch;
			}
			if (cur.length || pending) out.push(cur);
			return out;
		}

		function run(raw) {
			var line = raw.trim();
			echoCommand(raw);
			if (line) {
				var parts = tokenize(line);
				var name = (parts[0] || '').toLowerCase();
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

		input.addEventListener('focus', function () {
			/* 先让浏览器自己的"滚进视口"落地, 再补一刀避开坞 */
			global.setTimeout(keepPromptClear, 60);
		});

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

		/* chip 是 .term 的兄弟节点, 不在 root 里面 —— 由 mountAll 从外层一起传进来 */
		var suggestions = chips && chips.length ? chips : root.querySelectorAll('[data-cmd]');
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

		if (title) title.textContent = 'hayneko@blog: ~';

		// 开机横幅
		print('hayneko-sh 1.0  ·  hayneko.github.io', 't-info');
		print("type 'help' to list commands, 'Tab' to complete.", 't-dim');
		print('');

		return {
			run: run,
			print: print,
			focus: function () { input.focus(); },
			/* 页面片段会被路由整个换掉, 旧实例其实已经不在文档里了 */
			connected: function () { return root.isConnected; }
		};
	}

	function mountAll(scope) {
		var host = scope || doc;
		var roots = host.querySelectorAll('[data-terminal]');
		Array.prototype.forEach.call(roots, function (root) {
			if (root.dataset.termMounted === 'true') return;
			root.dataset.termMounted = 'true';
			/* .term-suggest 是 .term 的兄弟节点, 所以要在外层容器里找 chip */
			var area = (root.closest && root.closest('.section')) || host;
			var inst = create(root, area.querySelectorAll('[data-cmd]'));
			if (inst) {
				instances.push(inst);
				if (root.dataset.autofocus === 'true') setTimeout(function () { inst.focus(); }, 400);
				/* 从全局搜索点了一条命令: 等终端挂好再补跑 */
				if (pendingCmd) {
					(function (cmd) {
						pendingCmd = null;
						setTimeout(function () { inst.run(cmd); inst.focus(); }, 240);
					})(pendingCmd);
				}
			}
		});
		return instances;
	}

	/* 全局搜索点一条命令时用: 终端不在当前页就先跳过去, 挂载完自动补跑 */
	var pendingCmd = null;

	function liveInstance() {
		for (var i = 0; i < instances.length; i++) {
			if (instances[i].connected()) return instances[i];
		}
		return null;
	}

	function runCommand(cmd) {
		if (!cmd) return false;
		var inst = liveInstance();
		if (inst) {
			inst.run(cmd);
			inst.focus();
			return true;
		}
		pendingCmd = cmd;
		if (global.Router && global.Router.current !== 'terminal') global.Router.navigate('terminal');
		return true;
	}

	global.Terminal = {
		mountAll: mountAll,
		instances: instances,
		run: runCommand,
		commands: commandList
	};

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { mountAll(doc); }, { once: true });
	else mountAll(doc);
})(window);
