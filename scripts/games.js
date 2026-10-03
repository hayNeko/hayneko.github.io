/**
 * games.js — 页面小游戏(俄罗斯方块 + Block Blast + 函数球打砖块)
 *
 * 三个入口共用同一套挂载逻辑:
 *   1. #/games 页面底部的机台(views/games.html, 由 router 调 mountAll 挂载)
 *   2. 终端命令 play / games(scripts/terminal.js 调 Games.launch)
 *   3. dock 的小游戏按钮(走路由, 与 1 是同一个)
 *
 * GAMES 是唯一事实来源 —— 卡片、dock 搜索、终端 games 命令都读它。
 * 一款游戏一个引擎 + 一个机台分组(.cabinet-group[data-game-group]): 三块机台都写在
 * 页面里, 只显示当前这款, 卡片上的 is-active 也跟着走。标志位(easy / rollback /
 * slow)由各款自己在 GAMES[].flags 里声明能认哪些 —— 名字一样含义也各解释各的
 * (见下面的 createTetris / createBlockBlast / createFuncBall, 终端 play 按这份校验)。
 *
 * 俄罗斯方块: 7-bag 生成、矩阵旋转 + 踢墙、幽灵方块、暂存(hold)、锁定延迟、消行闪光、等级加速。
 * Block Blast: 8×8 棋盘、一次三块、拖放 / 触屏键 / 键盘三套输入、消行消列与连击。
 * 函数球打砖块: 两边各一条 f(x)(自写解析器, 不用 eval), 每弹一次算一次命中, 谁先打穿砖墙落地谁赢。
 * 渲染都是纯 Canvas —— 配色跟着主题走, 离开页面或切走标签页会自动暂停。
 * 俄罗斯方块与 Block Blast 的最高分各自记在 localStorage(函数球是对决, 只记这一局的用时与总伤害)。
 */
(function (global) {
	'use strict';

	var doc = global.document;

	/* ------------------------------------------------------------ 游戏清单 */

	/* 页面卡片 / dock 搜索 / 终端 games 命令都读这一份。
	   alias 是终端 play 认的别名(block-blast / blast 都能开局), 卡片与搜索只用 id。
	   flags 是这一款认哪些命令行开关(opt 里的键名): 终端 play 按它校验, 各台机台下面
	   自己的 .flag-panel 也只放这几个 —— 不认的开关会直接报错, 不会"接受但没反应"。
	   needsSetup: 开局前必须先设参数的那一款(函数球的 f(x) / 砖墙) —— 见 launch() 里的说明。 */
	var GAMES = [
		{
			id: 'tetris', title: 'Tetris', desc: 'classic falling-block puzzle',
			flags: ['easy', 'rollback']
		},
		{
			id: 'blockblast', title: 'Block Blast',
			desc: '8x8 board, three pieces at a time',
			alias: ['block-blast', 'block_blast', 'blast', 'bb'],
			flags: ['easy', 'rollback']
		},
		{
			id: 'funcball', title: 'Function Ball Breaker',
			desc: 'two function balls race down a brick wall',
			alias: ['function-ball', 'functionball', 'fnball', 'fball', 'fb'],
			flags: ['easy', 'slow'],
			/* 开局前要先设两边函数与砖墙 —— 自动开局会把整块参数面板锁掉 */
			needsSetup: true
		}
	];

	/* ------------------------------------------------------------ 方块常量 */

	var COLS = 10;
	var ROWS = 20;
	var PIECES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

	var SHAPES = {
		I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
		J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
		L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
		O: [[1, 1], [1, 1]],
		S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
		T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
		Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
	};

	var COLORS = {
		I: '#4dd8ff', J: '#4d9dff', L: '#ff9f45', O: '#ffd24d',
		S: '#3ce07b', T: '#b06bff', Z: '#ff4d5a'
	};

	/* 旋转踢墙: 先原地, 再左右各试两格, 最后试上抬一格(贴地时也转得动) */
	var KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1]];

	var LOCK_MS = 400;          /* 落地后的锁定宽限 */
	var MAX_LOCK_RESETS = 12;   /* 宽限最多重置多少次, 防止原地无限转 */
	var CLEAR_MS = 250;         /* 消行闪光时长 */

	/* 长按连续移动: DAS = 按住多久才开始连发, ARR = 连发的间隔。
	   这两个值越短越容易"滑过头" —— 只想横移一两格, 手一抖就多跑三四格。 */
	var DAS_MS = 250;           /* 横移: 起步延迟 */
	var ARR_MS = 75;           /* 横移: 连发间隔 */
	var SOFT_DAS_MS = 250;      /* 软降: 起步延迟 */
	var SOFT_ARR_MS = 50;       /* 软降: 连发间隔(往下滑过头不心疼) */
	var SCORE_TABLE = [0, 100, 300, 500, 800];
	var BEST_KEY = 'hayneko.game.tetris.best';

	var EASY_GRAVITY_MS = 800;  /* --easy-mode: 不加速, 永远按第一档下落 */
	var HOLD_RESTART_MS = 700;  /* "重新游玩"要长按这么久才生效, 免得误触 */
	var HISTORY_MAX = 30;       /* --with-roll-back: 最多能退多少步 */

	function rotateCW(m) {
		var n = m.length;
		var out = [];
		for (var y = 0; y < n; y++) {
			out.push([]);
			for (var x = 0; x < n; x++) out[y].push(m[n - 1 - x][y]);
		}
		return out;
	}

	function rotateCCW(m) {
		return rotateCW(rotateCW(rotateCW(m)));
	}

	function emptyBoard() {
		var rows = [];
		for (var y = 0; y < ROWS; y++) {
			var row = [];
			for (var x = 0; x < COLS; x++) row.push(null);
			rows.push(row);
		}
		return rows;
	}

	/* 跨袋是否允许"上一袋最后一块"和"这一袋第一块"同形(1/7 概率, 于是最多连出两块)。
	   设成 false 就一块都不会连着出 —— 更平均, 但少了点手感。 */
	var BAG_EDGE_REPEAT = true;

	/**
	 * 方块生成: **7-bag**(每七个方块装一袋, 袋内七种形状各有且仅有一个)。
	 *
	 * 之前是"每次七选一 + 同一种最多连出三次"。单看每一块都是均匀的,
	 * 但连起来常常一边倒 —— 比如 A A A B C C C: 前七个里 A 扎堆、接下来 C 扎堆,
	 * 某种形状可能一袋都见不到。现在每 7 块必定七种齐全, 不会缺谁、也不会扎堆,
	 * 最长只能连出两块(官方 guideline 也是这个行为), 连着三块已经不可能。
	 */
	function refillBag(state) {
		var bag = PIECES.slice();
		for (var i = bag.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var tmp = bag[i];
			bag[i] = bag[j];
			bag[j] = tmp;
		}
		/* 抽屉式发放: 从末尾取(见 drawType), 所以"下一个要发的"是最后一格 */
		var top = bag.length - 1;
		if (!BAG_EDGE_REPEAT && top > 0 && bag[top] === state.lastType) {
			var k = Math.floor(Math.random() * top);
			var swap = bag[top];
			bag[top] = bag[k];
			bag[k] = swap;
		}
		state.bag = bag;
	}

	/* 抽一块出来(袋空了就装新的一袋) */
	function drawType(state) {
		if (!state.bag.length) refillBag(state);
		var type = state.bag.pop();
		state.lastType = type;
		return type;
	}

	/* 等级越高落得越快; 70ms 是上限, 再快就没法玩了 */
	function gravityMs(level) {
		return Math.max(70, 800 * Math.pow(0.85, level - 1));
	}

	/* 最高分按 key 分开存: 俄罗斯方块 hayneko.game.tetris.best,
	   Block Blast hayneko.game.blockblast.best —— 两款带分数的游戏没有可比性。 */
	function readBest(key) {
		try { return parseInt(global.localStorage.getItem(key || BEST_KEY), 10) || 0; } catch (e) { return 0; }
	}

	function writeBest(key, value) {
		try { global.localStorage.setItem(key, String(value)); } catch (e) { /* 忽略 */ }
	}

	function t(key, fallback, params) {
		var i18n = global.i18n;
		var text = i18n && i18n.t ? i18n.t(key, params) : null;
		return text || fallback;
	}

	function esc(text) {
		return String(text).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	/* ------------------------------------------------- 画布小工具(几款游戏共用) */

	function gridColor() {
		return doc.documentElement.getAttribute('data-theme') === 'light'
			? 'rgba(12, 18, 26, 0.10)'
			: 'rgba(230, 237, 243, 0.07)';
	}

	/* 棋盘/分区的外框线: 比网格线重一档, 用来把"棋盘"和"手牌条"这类不同区域分开 */
	function gridEdgeColor() {
		return doc.documentElement.getAttribute('data-theme') === 'light'
			? 'rgba(12, 18, 26, 0.24)'
			: 'rgba(230, 237, 243, 0.17)';
	}

	/* 一块方块: 本色打底 + 顶上一条高光 —— 俄罗斯方块和 Block Blast 用同一个画法,
	   于是两块机台看起来是同一套像素风。 */
	function block(c, px, py, size, color, alpha) {
		var pad = Math.max(1, size * 0.07);
		c.globalAlpha = alpha == null ? 1 : alpha;
		c.fillStyle = color;
		c.fillRect(px + pad, py + pad, size - pad * 2, size - pad * 2);
		c.fillStyle = 'rgba(255, 255, 255, 0.22)';
		c.fillRect(px + pad, py + pad, size - pad * 2, Math.max(1, size * 0.12));
		c.globalAlpha = 1;
	}

	/* 机台标题栏上的状态字(ready / running / paused / over) —— 几款游戏共用 */
	function stateText(state) {
		var map = {
			ready: ['games.state.ready', 'ready'],
			running: ['games.state.running', 'running'],
			paused: ['games.state.paused', 'paused'],
			over: ['games.state.over', 'game over']
		};
		var row = map[state] || map.ready;
		return t(row[0], row[1]);
	}

	/* ------------------------------------------------------------ 引擎 */

	/**
	 * opt 由终端命令行传进来(见 scripts/terminal.js 的 play 命令)。各款游戏只处理自己在
	 * GAMES[].flags 里声明的那几个, 名字一样也各解释各的:
	 *   easy     --easy-mode       tetris: 不加速 / blockblast: 温和出牌 / funcball: 平坦砖墙
	 *   rollback --with-roll-back  tetris / blockblast: 多一个"撤回"按钮(函数球不接受)
	 *   slow     --slow-motion     funcball: 弹跳高度翻倍
	 * 不带标志位时都是 false —— 机台就是默认形态, 而且只在这一次挂载生效,
	 * 离开 #/games 后标志位与撤回记录一并丢掉(下次进来还是默认机台)。
	 */
	function createTetris(cab, opt) {
		opt = opt || {};
		var canvas = cab.querySelector('[data-tetris-canvas]');
		if (!canvas || !canvas.getContext) return null;

		var ctx = canvas.getContext('2d');
		var nextCv = cab.querySelector('[data-tetris-next]');
		var holdCv = cab.querySelector('[data-tetris-hold]');
		var overlay = cab.querySelector('[data-tetris-overlay]');
		var ovTitle = cab.querySelector('[data-tetris-ov-title]');
		var ovHint = cab.querySelector('[data-tetris-ov-hint]');
		var elScore = cab.querySelector('[data-tetris-score]');
		var elLevel = cab.querySelector('[data-tetris-level]');
		var elLines = cab.querySelector('[data-tetris-lines]');
		var elBest = cab.querySelector('[data-tetris-best]');
		var elState = cab.querySelector('[data-game-state]');
		var btnStart = cab.querySelector('[data-tetris-action="start"]');
		var btnPause = cab.querySelector('[data-tetris-action="pause"]');
		var btnRestart = cab.querySelector('[data-tetris-action="restart"]');
		var btnUndo = cab.querySelector('[data-tetris-action="undo"]');
		var flagsBox = cab.querySelector('[data-game-flags]');
		var padUndo = cab.querySelector('[data-pad="undo"]');
		var undoKeyHint = cab.querySelector('[data-undo-key]');
		/* 标志位面板在机台"下面", 是机台的兄弟节点 —— 从同一节里找 */
		var flagPanel = cab.parentNode ? cab.parentNode.querySelector('[data-game-flags-panel]') : null;
		var flagChips = flagPanel ? flagPanel.querySelectorAll('[data-flag]') : [];

		/* 生成器状态: 当前这一袋 + 上一次发出的类型(跨袋规则要用) */
		var bagState = { bag: [], lastType: null };

		var game = {
			board: emptyBoard(),
			queue: [],
			cur: null,
			hold: null,
			canHold: true,
			score: 0,
			level: 1,
			lines: 0,
			best: readBest(BEST_KEY),
			state: 'ready',       /* ready | running | paused | over */
			dropTimer: 0,
			lockTimer: 0,
			lockResets: 0,
			grounded: false,
			clearRows: [],
			clearTimer: 0,
			dropScore: 0        /* 当前这一块靠软降/硬降拿到的分, 撤回时要一起还回去 */
		};

		var held = { left: false, right: false, down: false };
		var repeat = { left: 0, right: 0, down: 0 };
		var raf = 0;
		var last = 0;
		var observer = null;
		var destroyed = false;
		var history = [];        /* --with-roll-back 的撤回栈 */
		var holdTimer = null;    /* "重新游玩"的长按计时器 */
		var holdBtn = null;      /* 正在被按住的那个按钮(键盘按 R 时也是它) */
		var restartKeyDown = false;

		/* ---- 队列 / 出生 ---- */

		function nextType() {
			return drawType(bagState);
		}

		function refillQueue() {
			while (game.queue.length < 3) game.queue.push(nextType());
		}

		function make(type) {
			var m = SHAPES[type].map(function (row) { return row.slice(); });
			var top = 0;
			for (var y = 0; y < m.length; y++) {
				if (m[y].indexOf(1) !== -1) { top = y; break; }
			}
			return { type: type, m: m, x: Math.floor((COLS - m.length) / 2), y: -top };
		}

		function fits(piece, dx, dy) {
			var m = piece.m;
			for (var y = 0; y < m.length; y++) {
				for (var x = 0; x < m.length; x++) {
					if (!m[y][x]) continue;
					var nx = piece.x + x + dx;
					var ny = piece.y + y + dy;
					if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
					if (ny >= 0 && game.board[ny][nx]) return false;
				}
			}
			return true;
		}

		function spawn() {
			refillQueue();
			game.cur = make(game.queue.shift());
			game.grounded = false;
			game.lockTimer = 0;
			game.lockResets = 0;
			game.dropTimer = 0;
			game.dropScore = 0;
			if (!fits(game.cur, 0, 0)) gameOver();
			drawMini(nextCv, game.queue[0]);
		}

		/* ---- 移动 / 旋转 ---- */

		/* 落地之后还能挪一挪: 一旦又悬空了就取消锁定, 否则重新计时(次数有限) */
		function afterMove() {
			if (!game.grounded) return;
			if (fits(game.cur, 0, 1)) { game.grounded = false; game.lockTimer = 0; return; }
			if (game.lockResets < MAX_LOCK_RESETS) {
				game.lockResets++;
				game.lockTimer = LOCK_MS;
			}
		}

		function tryMove(dx, dy) {
			if (!game.cur || !fits(game.cur, dx, dy)) return false;
			game.cur.x += dx;
			game.cur.y += dy;
			afterMove();
			return true;
		}

		function tryRotate(ccw) {
			if (!game.cur) return false;
			var rotated = ccw ? rotateCCW(game.cur.m) : rotateCW(game.cur.m);
			for (var i = 0; i < KICKS.length; i++) {
				var probe = {
					type: game.cur.type, m: rotated,
					x: game.cur.x + KICKS[i][0], y: game.cur.y + KICKS[i][1]
				};
				if (fits(probe, 0, 0)) {
					game.cur.m = rotated;
					game.cur.x = probe.x;
					game.cur.y = probe.y;
					afterMove();
					return true;
				}
			}
			return false;
		}

		function ground() {
			if (game.grounded) return;
			game.grounded = true;
			game.lockTimer = LOCK_MS;
		}

		function softDrop() {
			if (tryMove(0, 1)) {
				game.score += 1;
				game.dropScore += 1;
				game.dropTimer = 0;
				updateHud();
			} else {
				ground();
				game.lockTimer = Math.min(game.lockTimer, 140);
			}
		}

		function hardDrop() {
			var cells = 0;
			while (tryMove(0, 1)) cells++;
			game.score += cells * 2;
			game.dropScore += cells * 2;
			lockPiece();
		}

		function holdPiece() {
			if (!game.canHold || !game.cur) return;
			var current = game.cur.type;
			var swap = game.hold;
			game.hold = current;
			game.cur = swap ? make(swap) : make(game.queue.shift());
			refillQueue();
			game.canHold = false;
			game.grounded = false;
			game.lockTimer = 0;
			game.lockResets = 0;
			game.dropTimer = 0;
			drawMini(holdCv, game.hold);
			drawMini(nextCv, game.queue[0]);
			if (!fits(game.cur, 0, 0)) gameOver();
		}

		/* ---- 撤回(--with-roll-back) ---- */

		/* 在落子"之前"拍一张: 板面 / 队列 / 分数 / 暂存 / 正在下的那一块 */
		function snapshot() {
			history.push({
				board: game.board.map(function (row) { return row.slice(); }),
				queue: game.queue.slice(),
				bag: bagState.bag.slice(),
				lastType: bagState.lastType,
				curType: game.cur ? game.cur.type : null,
				hold: game.hold,
				canHold: game.canHold,
				score: game.score,
				dropScore: game.dropScore,
				lines: game.lines,
				level: game.level
			});
			if (history.length > HISTORY_MAX) history.shift();
			updateUndoBtn();
		}

		function canUndo() { return !!opt.rollback && history.length > 0; }

		/* 撤回按钮的可用状态跟着栈走 —— 只在 sync() 里刷会晚一步:
		   第一块落地时栈已经有东西了, 按钮却还是灰的, 得按 U 才"亮"起来。 */
		function updateUndoBtn() {
			if (btnUndo) btnUndo.disabled = !canUndo();
		}

		/* 退回"上一块落下之前": 那一块重新回到手上, 连消行与分数一起还回来 */
		function undo() {
			if (!canUndo()) return false;
			var snap = history.pop();
			game.board = snap.board;
			game.queue = snap.queue;
			bagState.bag = snap.bag.slice();
			bagState.lastType = snap.lastType;
			game.hold = snap.hold;
			game.canHold = snap.canHold;
			/* 这一块的软降/硬降加分也一并退掉, 否则撤回再放一次会白赚分 */
			game.score = Math.max(0, snap.score - (snap.dropScore || 0));
			game.dropScore = 0;
			game.lines = snap.lines;
			game.level = snap.level;
			game.clearRows = [];
			game.clearTimer = 0;
			game.grounded = false;
			game.lockTimer = 0;
			game.lockResets = 0;
			game.dropTimer = 0;
			game.cur = snap.curType ? make(snap.curType) : null;
			if (!game.cur) spawn();
			/* 撤到"游戏结束"之前也照样能接着玩 */
			if (game.state !== 'running') {
				game.state = 'running';
				ensureLoop();
			}
			drawMini(nextCv, game.queue[0]);
			drawMini(holdCv, game.hold);
			updateHud();
			draw();
			sync();
			return true;
		}

		/* ---- 锁定 / 消行 ---- */

		function lockPiece() {
			if (opt.rollback) snapshot();
			var m = game.cur.m;
			for (var y = 0; y < m.length; y++) {
				for (var x = 0; x < m.length; x++) {
					if (!m[y][x]) continue;
					var ny = game.cur.y + y;
					var nx = game.cur.x + x;
					if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) game.board[ny][nx] = game.cur.type;
				}
			}
			game.canHold = true;
			game.grounded = false;
			game.lockTimer = 0;
			game.lockResets = 0;

			var full = [];
			for (var row = 0; row < ROWS; row++) {
				if (game.board[row].indexOf(null) === -1) full.push(row);
			}
			if (full.length) {
				/* 先闪一下再消, 闪光期间不接输入 —— 但主循环要保持运行 */
				game.clearRows = full;
				game.clearTimer = CLEAR_MS;
			} else {
				spawn();
				updateHud();
			}
			draw();
		}

		function applyClear() {
			var count = game.clearRows.length;
			var kept = [];
			for (var y = 0; y < ROWS; y++) {
				if (game.clearRows.indexOf(y) === -1) kept.push(game.board[y]);
			}
			for (var i = 0; i < count; i++) {
				var row = [];
				for (var x = 0; x < COLS; x++) row.push(null);
				kept.unshift(row);
			}
			game.board = kept;
			game.clearRows = [];
			game.clearTimer = 0;
			game.lines += count;
			game.score += SCORE_TABLE[count] * game.level;
			game.level = opt.easy ? 1 : Math.floor(game.lines / 10) + 1;
			if (game.score > game.best) { game.best = game.score; writeBest(BEST_KEY, game.best); }
			spawn();
			updateHud();
			draw();
		}

		/* ---- 状态 ---- */

		function reset() {
			history.length = 0;
			updateUndoBtn();
			game.board = emptyBoard();
			game.queue = [];
			bagState.bag = [];
			bagState.lastType = null;
			game.hold = null;
			game.canHold = true;
			game.score = 0;
			game.level = 1;
			game.lines = 0;
			game.dropTimer = 0;
			game.lockTimer = 0;
			game.lockResets = 0;
			game.grounded = false;
			game.clearRows = [];
			game.clearTimer = 0;
			spawn();
			drawMini(holdCv, null);
			updateHud();
			draw();
		}

		function start() {
			if (destroyed || game.state === 'running') return;
			if (game.state === 'over' || game.state === 'ready') reset();
			game.state = 'running';
			ensureLoop();
			sync();
		}

		function pause() {
			if (game.state !== 'running') return;
			game.state = 'paused';
			stopLoop();
			draw();
			sync();
		}

		function resume() {
			if (game.state !== 'paused') return;
			game.state = 'running';
			ensureLoop();
			sync();
		}

		function togglePause() {
			if (game.state === 'running') pause();
			else if (game.state === 'paused') resume();
		}

		function gameOver() {
			game.state = 'over';
			if (game.score > game.best) { game.best = game.score; writeBest(BEST_KEY, game.best); }
			stopLoop();
			updateHud();
			draw();
			sync();
		}

		/* ---- HUD / 覆盖层 ---- */

		function stateLabel() {
			return stateText(game.state);
		}

		/* Best 是"到目前为止最高的一次", 所以它永远不会低于正在打的这一局 ——
		   不然刚刷新纪录时会看到 Best 比 Score 还小。写盘仍然只在消行 / 结束时做。 */
		function updateHud() {
			if (game.score > game.best) game.best = game.score;
			if (elScore) elScore.textContent = String(game.score);
			if (elLevel) elLevel.textContent = String(game.level);
			if (elLines) elLines.textContent = String(game.lines);
			if (elBest) elBest.textContent = String(game.best);
		}

		/* 覆盖层与状态字是 JS 直接写的文本 —— 切语言时靠 i18n:applied 再刷一次 */
		function sync() {
			var title;
			var hint;
			if (game.state === 'running') {
				if (overlay) overlay.classList.remove('is-shown');
			} else {
				if (game.state === 'paused') {
					title = t('games.overlay.pausedTitle', 'PAUSED');
					hint = t('games.overlay.pausedHint', 'P or Esc to resume');
				} else if (game.state === 'over') {
					title = t('games.overlay.overTitle', 'GAME OVER');
					hint = t('games.overlay.overHint', 'score {score} · best {best}', {
						score: game.score, best: game.best
					});
				} else {
					title = t('games.tetris.readyTitle', 'TETRIS');
					hint = t('games.overlay.readyHint', 'Press Start or Space');
				}
				if (ovTitle) ovTitle.textContent = title;
				if (ovHint) ovHint.textContent = hint;
				if (overlay) overlay.classList.add('is-shown');
			}
			if (elState) elState.textContent = stateLabel();
			renderFlags();
			if (btnPause) {
				btnPause.textContent = game.state === 'paused'
					? t('games.btn.resume', 'Resume')
					: t('games.btn.pause', 'Pause');
				btnPause.disabled = (game.state !== 'running' && game.state !== 'paused');
			}
			if (btnStart) btnStart.disabled = game.state === 'running';
			updateUndoBtn();
		}

		/* 面板上的两个开关与当前状态同步 */
		function updateFlagChips() {
			Array.prototype.forEach.call(flagChips, function (chip) {
				var on = chip.getAttribute('data-flag') === 'easy' ? !!opt.easy : !!opt.rollback;
				chip.classList.toggle('is-on', on);
				chip.setAttribute('aria-pressed', on ? 'true' : 'false');
			});
		}

		/**
		 * 把 opt 落到界面上。撤回相关的三样东西(按钮 / 触屏键 / 键位图例)
		 * 只有开着 --with-roll-back 时才存在 —— 注意 [hidden] 会被 .btn 的
		 * display: inline-flex 盖掉, 所以 CSS 里另外写了一条 !important 兜底。
		 */
		function applyFlags() {
			if (btnUndo) btnUndo.hidden = !opt.rollback;
			if (padUndo) padUndo.hidden = !opt.rollback;
			if (undoKeyHint) undoKeyHint.hidden = !opt.rollback;
			if (!opt.rollback) history.length = 0;
			/* 不加速: 等级立刻回到 1; 关掉时按消行数重算 */
			game.level = opt.easy ? 1 : Math.floor(game.lines / 10) + 1;
			updateUndoBtn();
			updateFlagChips();
			renderFlags();
			updateHud();
			draw();
			sync();
		}

		function setFlags(next) {
			if (!next) return;
			if (typeof next.easy === 'boolean') opt.easy = next.easy;
			if (typeof next.rollback === 'boolean') opt.rollback = next.rollback;
			applyFlags();
		}

		function toggleFlag(name) {
			if (name !== 'easy' && name !== 'rollback') return;
			var next = { easy: opt.easy, rollback: opt.rollback };
			next[name] = !next[name];
			setFlags(next);
		}

		function onFlagClick(e) {
			var chip = e.target.closest ? e.target.closest('[data-flag]') : null;
			if (!chip) return;
			e.preventDefault();
			toggleFlag(chip.getAttribute('data-flag'));
		}

		/* 机台标题栏上的标志位小牌子(终端用 --easy-mode / --with-roll-back 开局时才有) */
		function renderFlags() {
			if (!flagsBox) return;
			var chips = [];
			if (opt.easy) {
				chips.push('<span class="cabinet__flag cabinet__flag--easy" title="' +
					esc(t('games.tetris.flag.easyTip', '--easy-mode: no speed-up')) + '">' +
					esc(t('games.tetris.flag.easy', 'EASY')) + '</span>');
			}
			if (opt.rollback) {
				chips.push('<span class="cabinet__flag cabinet__flag--undo" title="' +
					esc(t('games.tetris.flag.rollbackTip', '--with-roll-back: undo is available')) + '">' +
					esc(t('games.tetris.flag.rollback', 'UNDO')) + '</span>');
			}
			flagsBox.innerHTML = chips.join('');
		}

		/* ---- 渲染 ---- */

		function metrics() {
			var cell = Math.min(canvas.width / COLS, canvas.height / ROWS);
			return {
				cell: cell,
				ox: (canvas.width - cell * COLS) / 2,
				oy: (canvas.height - cell * ROWS) / 2
			};
		}

		function draw() {
			if (!ctx || !canvas.width || !canvas.height) return;
			var mt = metrics();
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			/* 井底网格 */
			ctx.strokeStyle = gridColor();
			ctx.lineWidth = Math.max(1, mt.cell * 0.05);
			ctx.beginPath();
			for (var gx = 1; gx < COLS; gx++) {
				ctx.moveTo(mt.ox + gx * mt.cell, mt.oy);
				ctx.lineTo(mt.ox + gx * mt.cell, mt.oy + ROWS * mt.cell);
			}
			for (var gy = 1; gy < ROWS; gy++) {
				ctx.moveTo(mt.ox, mt.oy + gy * mt.cell);
				ctx.lineTo(mt.ox + COLS * mt.cell, mt.oy + gy * mt.cell);
			}
			ctx.stroke();

			/* 已经落定的方块 */
			for (var y = 0; y < ROWS; y++) {
				for (var x = 0; x < COLS; x++) {
					var type = game.board[y][x];
					if (!type) continue;
					block(ctx, mt.ox + x * mt.cell, mt.oy + y * mt.cell, mt.cell, COLORS[type], 0.92);
				}
			}

			/* 幽灵方块: 只描一圈边, 提示这一手会落在哪 */
			if (game.cur && game.state !== 'over') {
				var ghost = { type: game.cur.type, m: game.cur.m, x: game.cur.x, y: game.cur.y };
				while (fits(ghost, 0, 1)) ghost.y++;
				ctx.strokeStyle = COLORS[ghost.type];
				ctx.globalAlpha = 0.3;
				ctx.lineWidth = Math.max(1, mt.cell * 0.09);
				for (var qy = 0; qy < ghost.m.length; qy++) {
					for (var qx = 0; qx < ghost.m.length; qx++) {
						if (!ghost.m[qy][qx]) continue;
						var py = ghost.y + qy;
						if (py < 0) continue;
						ctx.strokeRect(
							mt.ox + (ghost.x + qx) * mt.cell + mt.cell * 0.14,
							mt.oy + py * mt.cell + mt.cell * 0.14,
							mt.cell * 0.72, mt.cell * 0.72
						);
					}
				}
				ctx.globalAlpha = 1;
			}

			/* 当前方块 */
			if (game.cur && game.state !== 'over') {
				for (var cy = 0; cy < game.cur.m.length; cy++) {
					for (var cx = 0; cx < game.cur.m.length; cx++) {
						if (!game.cur.m[cy][cx]) continue;
						var row = game.cur.y + cy;
						if (row < 0) continue;
						block(ctx, mt.ox + (game.cur.x + cx) * mt.cell, mt.oy + row * mt.cell,
							mt.cell, COLORS[game.cur.type], 1);
					}
				}
			}

			/* 消行闪光 */
			if (game.clearRows.length) {
				ctx.globalAlpha = 0.25 + 0.6 * (1 - Math.max(0, game.clearTimer / CLEAR_MS));
				ctx.fillStyle = '#ffffff';
				game.clearRows.forEach(function (row) {
					ctx.fillRect(mt.ox, mt.oy + row * mt.cell, COLS * mt.cell, mt.cell);
				});
				ctx.globalAlpha = 1;
			}
		}

		/* next / hold 的小窗: 把方块裁到包围盒再居中画 */
		function drawMini(cv, type) {
			if (!cv || !cv.getContext) return;
			var c = cv.getContext('2d');
			c.clearRect(0, 0, cv.width, cv.height);
			if (!type) return;
			var m = SHAPES[type];
			var minX = 9, maxX = -1, minY = 9, maxY = -1;
			for (var y = 0; y < m.length; y++) {
				for (var x = 0; x < m.length; x++) {
					if (!m[y][x]) continue;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
			var w = maxX - minX + 1;
			var h = maxY - minY + 1;
			var step = Math.min(cv.width / 5, cv.height / 5);
			var offX = (cv.width - w * step) / 2;
			var offY = (cv.height - h * step) / 2;
			for (var py = minY; py <= maxY; py++) {
				for (var px = minX; px <= maxX; px++) {
					if (!m[py][px]) continue;
					block(c, offX + (px - minX) * step, offY + (py - minY) * step, step, COLORS[type], 1);
				}
			}
		}

		/**
		 * 尺寸用 clientWidth/clientHeight 而不是 getBoundingClientRect:
		 * 页面入场动画给 .page 挂了 transform, 量出来的矩形是缩放过的,
		 * 会按错的尺寸建画布 —— 那样画面会糊, 直到下一次 resize 才恢复。
		 */
		function resize() {
			var dpr = Math.min(global.devicePixelRatio || 1, 2);
			var w = canvas.clientWidth;
			var h = canvas.clientHeight;
			if (w && h) {
				canvas.width = Math.max(1, Math.round(w * dpr));
				canvas.height = Math.max(1, Math.round(h * dpr));
			}
			[nextCv, holdCv].forEach(function (cv) {
				if (!cv) return;
				var cw = cv.clientWidth;
				var ch = cv.clientHeight;
				if (!cw || !ch) return;
				cv.width = Math.max(1, Math.round(cw * dpr));
				cv.height = Math.max(1, Math.round(ch * dpr));
			});
			drawMini(nextCv, game.queue[0]);
			drawMini(holdCv, game.hold);
			draw();
		}

		/* ---- 主循环 ---- */

		function tick(dt) {
			if (game.state !== 'running') return;

			if (game.clearRows.length) {
				game.clearTimer -= dt;
				if (game.clearTimer <= 0) applyClear();
				return;
			}

			/* 长按连续移动(浏览器自带的方向键重复的节奏也和这里对不上, 自己排) */
			if (held.left) {
				repeat.left -= dt;
				if (repeat.left <= 0) { tryMove(-1, 0); repeat.left = ARR_MS; }
			}
			if (held.right) {
				repeat.right -= dt;
				if (repeat.right <= 0) { tryMove(1, 0); repeat.right = ARR_MS; }
			}
			if (held.down) {
				repeat.down -= dt;
				if (repeat.down <= 0) { softDrop(); repeat.down = SOFT_ARR_MS; }
			}

			game.dropTimer += dt;
			if (game.dropTimer >= (opt.easy ? EASY_GRAVITY_MS : gravityMs(game.level))) {
				game.dropTimer = 0;
				if (!tryMove(0, 1)) ground();
			}

			if (game.grounded) {
				game.lockTimer -= dt;
				if (game.lockTimer <= 0) lockPiece();
			}
		}

		function frame(now) {
			if (destroyed) return;
			if (!canvas.isConnected) { destroy(); return; }
			raf = global.requestAnimationFrame(frame);
			if (!last) { last = now; return; }
			var dt = Math.min(now - last, 120);
			last = now;
			tick(dt);
			draw();
		}

		function ensureLoop() {
			if (raf || destroyed) return;
			last = 0;
			raf = global.requestAnimationFrame(frame);
		}

		function stopLoop() {
			if (!raf) return;
			global.cancelAnimationFrame(raf);
			raf = 0;
		}

		/* ---- 输入 ---- */

		var ACTIONS = {
			ArrowLeft: 'left', a: 'left', A: 'left',
			ArrowRight: 'right', d: 'right', D: 'right',
			ArrowDown: 'down', s: 'down', S: 'down',
			ArrowUp: 'rotate', x: 'rotate', X: 'rotate', w: 'rotate', W: 'rotate',
			z: 'rotateCCW', Z: 'rotateCCW',
			' ': 'drop', Spacebar: 'drop',
			c: 'hold', C: 'hold', Shift: 'hold',
			p: 'pause', P: 'pause', Escape: 'pause',
			u: 'undo', U: 'undo',
			r: 'restart', R: 'restart'
		};

		function press(action) {
			if (game.state === 'ready') {
				if (action === 'drop' || action === 'pause') start();
				return;
			}
			if (game.state === 'paused') {
				if (action === 'pause' || action === 'drop') resume();
				return;
			}
			if (game.state === 'over') {
				if (action === 'drop') start();
				return;
			}
			if (game.clearRows.length) return;

			if (action === 'left') { tryMove(-1, 0); held.left = true; repeat.left = DAS_MS; }
			else if (action === 'right') { tryMove(1, 0); held.right = true; repeat.right = DAS_MS; }
			else if (action === 'down') { softDrop(); held.down = true; repeat.down = SOFT_DAS_MS; }
			else if (action === 'rotate') tryRotate(false);
			else if (action === 'rotateCCW') tryRotate(true);
			else if (action === 'drop') hardDrop();
			else if (action === 'hold') holdPiece();
			else if (action === 'undo') { undo(); return; }
			else if (action === 'pause') { pause(); return; }
			updateHud();
			draw();
		}

		function release(action) {
			if (action === 'left') held.left = false;
			else if (action === 'right') held.right = false;
			else if (action === 'down') held.down = false;
		}

		function releaseAll() {
			held.left = false;
			held.right = false;
			held.down = false;
		}

		function onKeyDown(e) {
			if (destroyed) return;
			var target = e.target;
			var tag = (target && target.tagName || '').toLowerCase();
			if (tag === 'input' || tag === 'textarea' || (target && target.isContentEditable)) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			var action = ACTIONS[e.key];
			if (!action) return;
			if (action === 'undo' && !opt.rollback) return;   /* 没开撤回时 u 不归游戏 */

			/* 只有真正会被游戏用掉的按键才 preventDefault ——
			   没在跑的时候方向键还要留给页面滚动 */
			var playing = game.state === 'running';
			var starting = (game.state === 'ready' || game.state === 'over') && action === 'drop';
			var resuming = game.state === 'paused' && (action === 'pause' || action === 'drop');
			var restarting = action === 'restart';
			if (!playing && !starting && !resuming && !restarting) return;

			e.preventDefault();
			/* R 和"重新游玩"按钮一样要长按: 按下去开始填, 松手就取消 */
			if (action === 'restart') {
				if (restartKeyDown) return;
				restartKeyDown = true;
				beginHold(btnRestart);
				return;
			}
			if (action !== 'pause' && playing && held[action]) return;   /* 长按由 tick 接管 */
			press(action);
		}

		function onKeyUp(e) {
			var action = ACTIONS[e.key];
			if (!action) return;
			if (action === 'restart') {
				restartKeyDown = false;
				endHold();
				return;
			}
			release(action);
		}

		function padTarget(e) {
			return e.target && e.target.closest ? e.target.closest('[data-pad]') : null;
		}

		function onPadDown(e) {
			var btn = padTarget(e);
			if (!btn) return;
			e.preventDefault();
			var action = btn.getAttribute('data-pad');
			if (action === 'left' || action === 'right' || action === 'down') {
				if (held[action]) return;
				press(action);
			} else {
				press(action);
			}
		}

		function onPadUp() {
			releaseAll();
		}

		function doRestart() {
			reset();
			start();
		}

		/* ---- "重新游玩"要长按才生效 ---- */

		function beginHold(btn) {
			if (destroyed || holdTimer) return;
			holdBtn = btn || btnRestart;
			if (holdBtn) holdBtn.classList.add('is-holding');
			holdTimer = global.setTimeout(function () {
				holdTimer = null;
				var el = holdBtn;
				holdBtn = null;
				if (el) {
					el.classList.remove('is-holding');
					el.classList.add('is-done');
					global.setTimeout(function () { el.classList.remove('is-done'); }, 420);
				}
				doRestart();
			}, HOLD_RESTART_MS);
		}

		function endHold() {
			if (holdTimer) {
				global.clearTimeout(holdTimer);
				holdTimer = null;
			}
			if (holdBtn) {
				holdBtn.classList.remove('is-holding');
				holdBtn = null;
			}
		}

		function actionTarget(e) {
			return e.target && e.target.closest ? e.target.closest('[data-tetris-action]') : null;
		}

		function onPointerDown(e) {
			if (destroyed) return;
			var pad = padTarget(e);
			if (pad) { onPadDown(e); return; }
			var btn = actionTarget(e);
			if (btn && btn.getAttribute('data-tetris-action') === 'restart') {
				/* 长按在触屏上会选中文字 / 弹右键菜单, 这里一起按掉 */
				e.preventDefault();
				beginHold(btn);
			}
		}

		function onPointerUp() {
			releaseAll();
			endHold();
		}

		function onClick(e) {
			if (destroyed) return;
			var el = actionTarget(e);
			if (!el) return;
			var act = el.getAttribute('data-tetris-action');
			if (act === 'start') start();
			else if (act === 'pause') togglePause();
			else if (act === 'undo') undo();
			else if (act === 'restart') {
				/* 指针那条路走 pointerdown/up; 这里只接键盘 —— 键盘触发的 click 里 detail 为 0 */
				if (e.detail === 0) doRestart();
			}
		}

		function overlayClick() {
			if (game.state === 'running') pause();
			else if (game.state === 'paused') resume();
			else start();
		}

		function onVisibility() {
			if (doc.hidden && game.state === 'running') pause();
		}

		function onI18n() {
			sync();
		}

		/* ---- 挂载 / 卸载 ---- */

		cab.addEventListener('click', onClick);
		cab.addEventListener('pointerdown', onPointerDown);
		cab.addEventListener('pointerup', onPointerUp);
		cab.addEventListener('pointercancel', onPointerUp);
		cab.addEventListener('pointerleave', onPointerUp);
		cab.addEventListener('contextmenu', function (e) {
			/* 长按"重新游玩"时不要弹右键菜单 */
			if (e.target.closest && e.target.closest('[data-tetris-action="restart"]')) e.preventDefault();
		});
		doc.addEventListener('pointerup', onPointerUp);
		if (overlay) overlay.addEventListener('click', overlayClick);
		doc.addEventListener('keydown', onKeyDown);
		doc.addEventListener('keyup', onKeyUp);
		doc.addEventListener('visibilitychange', onVisibility);
		doc.addEventListener('i18n:applied', onI18n);

		if (global.ResizeObserver) {
			observer = new global.ResizeObserver(function () { resize(); });
			observer.observe(canvas);
		} else {
			global.addEventListener('resize', resize);
		}

		function destroy() {
			if (destroyed) return;
			destroyed = true;
			stopLoop();
			if (observer) observer.disconnect();
			else global.removeEventListener('resize', resize);
			endHold();
			if (flagPanel) flagPanel.removeEventListener('click', onFlagClick);
			doc.removeEventListener('pointerup', onPointerUp);
			doc.removeEventListener('keydown', onKeyDown);
			doc.removeEventListener('keyup', onKeyUp);
			doc.removeEventListener('visibilitychange', onVisibility);
			doc.removeEventListener('i18n:applied', onI18n);
			releaseAll();
			delete cab.dataset.gameReady;
		}

		if (flagPanel) flagPanel.addEventListener('click', onFlagClick);

		cab.dataset.gameReady = 'true';
		updateHud();
		reset();
		applyFlags();     /* 撤回按钮 / 牌子 / 面板开关都按 opt 落一遍 */
		resize();
		setTimeout(resize, 60);

		return {
			start: start,
			pause: pause,
			reset: reset,
			setFlags: setFlags,
			resize: resize,
			state: function () { return game.state; },
			undo: undo,
			/* 只读快照: 排查手感 / 自动化验证时看看当前方块在哪 */
			debug: function () {
				return {
					state: game.state,
					type: game.cur ? game.cur.type : null,
					x: game.cur ? game.cur.x : null,
					y: game.cur ? game.cur.y : null,
					score: game.score,
					lines: game.lines,
					level: game.level,
					easy: !!opt.easy,
					rollback: !!opt.rollback,
					undoHidden: btnUndo ? btnUndo.hidden : null,
					undoDisabled: btnUndo ? btnUndo.disabled : null,
					history: history.length,
					canUndo: canUndo()
				};
			},
			scrollTo: function () {
				if (!cab.scrollIntoView) return;
				var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
				cab.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
			},
			destroy: destroy
		};
	}


	/* ------------------------------------------------------------ Block Blast */

	/* 8x8 棋盘, 一次三块。板面格子存颜色字符串(空 = null)。
	形状库只有直线、方块和"两条边"的拐角 —— Block Blast 没有 T/S/Z 这类斜角。 */
	var BB_COLS = 8;
	var BB_ROWS = 8;
	var BB_SLOTS = 3;
	var BB_TRAY_H = 2.6;         /* 手牌条高度, 单位是"格" */
	var BB_TRAY_SCALE = 0.6;     /* 手牌里的方块画多大(相对棋盘格), 这是上限 */
	var BB_TRAY_FIT = 0.84;      /* 手牌格子最多占多少: 5 连也要塞得进那一格 */
	var BB_CLEAR_MS = 240;       /* 消线闪光时长 */
	var BB_DRAG_SLOP = 9;        /* 指针移动超过这么多像素才算"拖", 之内当成点选 */
	var BB_POINT_PER_CELL = 2;   /* 放下一格得几分 */
	var BB_COMBO_GRACE = 4;      /* 消除之后连着这么多次没消除, 连击才断(中间的空放不算断) */
	var BB_BEST_KEY = 'hayneko.game.blockblast.best';

	var BB_SHAPES = [
		{ id: 'dot', m: [[1]] },
		{ id: 'h2', m: [[1, 1]] },
		{ id: 'v2', m: [[1], [1]] },
		{ id: 'h3', m: [[1, 1, 1]] },
		{ id: 'v3', m: [[1], [1], [1]] },
		{ id: 'h4', m: [[1, 1, 1, 1]] },
		{ id: 'v4', m: [[1], [1], [1], [1]] },
		{ id: 'h5', m: [[1, 1, 1, 1, 1]] },
		{ id: 'v5', m: [[1], [1], [1], [1], [1]] },
		{ id: 'sq2', m: [[1, 1], [1, 1]] },
		{ id: 'sq3', m: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] },
		{ id: 'r32', m: [[1, 1, 1], [1, 1, 1]] },        /* 3 宽 2 高 */
		{ id: 'r23', m: [[1, 1], [1, 1], [1, 1]] },      /* 2 宽 3 高 */
		{ id: 'c2a', m: [[1, 0], [1, 1]] },
		{ id: 'c2b', m: [[0, 1], [1, 1]] },
		{ id: 'c2c', m: [[1, 1], [1, 0]] },
		{ id: 'c2d', m: [[1, 1], [0, 1]] },
		{ id: 'c3a', m: [[1, 0, 0], [1, 0, 0], [1, 1, 1]] },
		{ id: 'c3b', m: [[0, 0, 1], [0, 0, 1], [1, 1, 1]] },
		{ id: 'c3c', m: [[1, 1, 1], [1, 0, 0], [1, 0, 0]] },
		{ id: 'c3d', m: [[1, 1, 1], [0, 0, 1], [0, 0, 1]] }
	];

	/* 出牌权重: 五连 / 3x3 / 大拐角这种大块少出, 小块多出 —— 均匀出牌两下就把棋盘堵死。
	池子里一个形状按权重放几份, 抽的时候按份等概率, 所以权重就是这个形状的出现比例。 */
	var BB_WEIGHTS = {
		dot: 2, h2: 4, v2: 4, h3: 4, v3: 4, h4: 2, v4: 2, h5: 1, v5: 1,
		sq2: 4, sq3: 1, r32: 2, r23: 2,
		c2a: 3, c2b: 3, c2c: 3, c2d: 3, c3a: 1, c3b: 1, c3c: 1, c3d: 1
	};

	/* --easy-mode 的牌池: 只出直线与方块(没有拐角), 而且**长条 / 大方块权重更高** ——
	   三格以上的直线占了六成多, 玩家更容易凑满整行整列, 连击也更好拿。 */
	var BB_EASY_IDS = [
		'dot', 'h2', 'v2', 'h3', 'v3', 'h4', 'v4', 'h5', 'v5', 'sq2', 'sq3', 'r32', 'r23'
	];
	var BB_EASY_WEIGHTS = {
		dot: 1, h2: 2, v2: 2, h3: 5, v3: 5, h4: 6, v4: 6, h5: 5, v5: 5,
		sq2: 4, sq3: 3, r32: 4, r23: 4
	};

	var BB_COLORS = ['#4d9dff', '#3ce07b', '#ffd24d', '#b06bff', '#ff4d5a', '#4dd8ff', '#ff9f45'];

	/* 把权重摊成池子: 一个形状放 n 份, 抽的时候按份等概率 —— 权重就是出现比例 */
	function bbPool(easy) {
		var out = [];
		for (var i = 0; i < BB_SHAPES.length; i++) {
			var s = BB_SHAPES[i];
			if (easy && BB_EASY_IDS.indexOf(s.id) === -1) continue;
			var n = (easy ? BB_EASY_WEIGHTS[s.id] : BB_WEIGHTS[s.id]) || 1;
			for (var k = 0; k < n; k++) out.push(s);
		}
		return out;
	}

	var BB_POOL = bbPool(false);
	var BB_EASY_POOL = bbPool(true);

	/* 抽一块: 形状按权重, 颜色每次随机(同一种形状的每块颜色都不一样) */
	function bbDrawPiece(easy) {
		var pool = easy ? BB_EASY_POOL : BB_POOL;
		var shape = pool[Math.floor(Math.random() * pool.length)];
		var cells = [];
		for (var y = 0; y < shape.m.length; y++) {
			for (var x = 0; x < shape.m[y].length; x++) {
				if (shape.m[y][x]) cells.push([x, y]);
			}
		}
		return {
			id: shape.id,
			color: BB_COLORS[Math.floor(Math.random() * BB_COLORS.length)],
			cells: cells,
			w: shape.m[0].length,
			h: shape.m.length
		};
	}

	function bbEmptyBoard() {
		var rows = [];
		for (var y = 0; y < BB_ROWS; y++) {
			var row = [];
			for (var x = 0; x < BB_COLS; x++) row.push(null);
			rows.push(row);
		}
		return rows;
	}

	function bbFits(board, piece, cx, cy) {
		for (var i = 0; i < piece.cells.length; i++) {
			var x = cx + piece.cells[i][0];
			var y = cy + piece.cells[i][1];
			if (x < 0 || x >= BB_COLS || y < 0 || y >= BB_ROWS) return false;
			if (board[y][x]) return false;
		}
		return true;
	}

	/* 这块牌还有没有地方放 —— 游戏结束的判据 */
	function bbFitsAnywhere(board, piece) {
		for (var y = 0; y <= BB_ROWS - piece.h; y++) {
			for (var x = 0; x <= BB_COLS - piece.w; x++) {
				if (bbFits(board, piece, x, y)) return true;
			}
		}
		return false;
	}

	/**
	* opt 与俄罗斯方块共用同一组开关名字(见 createTetris 的注释):
	*   easy     --easy-mode       温和出牌: 只出直线与方块(没有拐角), 长条/大方块权重更高
	*   rollback --with-roll-back  多一个"撤回"按钮, 退回上一次放置之前(分数一起还回来)
	* 不带标志位时两个都是 false, 而且只在这一次挂载生效。
	*
	* 输入有三条路, 最后都落到同一组 game.sel / game.cur 上:
	*   鼠标 / 手指  从手牌条拖到棋盘(拖到哪算到哪), 或者点一下手牌再点棋盘
	*   键盘         1/2/3 选块, 方向键移落点, 空格放下
	*   触屏键       左下十字键移落点, 右手两个大键 = 放下 / 换一块
	*/
	function createBlockBlast(cab, opt) {
		opt = opt || {};
		var canvas = cab.querySelector('[data-bb-canvas]');
		if (!canvas || !canvas.getContext) return null;

		var ctx = canvas.getContext('2d');
		var overlay = cab.querySelector('[data-bb-overlay]');
		var ovTitle = cab.querySelector('[data-bb-ov-title]');
		var ovHint = cab.querySelector('[data-bb-ov-hint]');
		var elScore = cab.querySelector('[data-bb-score]');
		var elBest = cab.querySelector('[data-bb-best]');
		var elCombo = cab.querySelector('[data-bb-combo]');
		var elLines = cab.querySelector('[data-bb-lines]');
		var elState = cab.querySelector('[data-game-state]');
		var btnStart = cab.querySelector('[data-bb-action="start"]');
		var btnPause = cab.querySelector('[data-bb-action="pause"]');
		var btnRestart = cab.querySelector('[data-bb-action="restart"]');
		var btnUndo = cab.querySelector('[data-bb-action="undo"]');
		var flagsBox = cab.querySelector('[data-game-flags]');
		var padUndo = cab.querySelector('[data-pad="undo"]');
		var undoKeyHint = cab.querySelector('[data-undo-key]');
		/* 标志位面板在机台"下面", 是机台的兄弟节点 —— 一个机台分组里只有一份 */
		var flagPanel = cab.parentNode ? cab.parentNode.querySelector('[data-game-flags-panel]') : null;
		var flagChips = flagPanel ? flagPanel.querySelectorAll('[data-flag]') : [];

		var game = {
			board: bbEmptyBoard(),
			tray: [null, null, null],
			sel: -1,              /* 手上选中的那一块(键盘 / 触屏键 / 点选), -1 = 没选 */
			cur: { x: 0, y: 0 },  /* 选中块的落点: 方块左上角在棋盘上的格坐标 */
			score: 0,
			lines: 0,
			combo: 0,             /* 这一轮连击累计消掉的线数: 消 1 条 +1, 一次消 3 条就 +3; 0 = 没连击 */
			misses: 0,            /* 这一轮连击里已经空放了几次 —— 到 BB_COMBO_GRACE 才断 */
			best: readBest(BB_BEST_KEY),
			state: 'ready',       /* ready | running | paused | over */
			previewRows: [],      /* 按当前落点放下去"会消掉"的行 / 列 —— 整条高亮给玩家看 */
			previewCols: [],
			clearRows: [],
			clearCols: [],
			clearTimer: 0
		};

		var drag = null;        /* { slot, grabX, grabY, x, y, fromX, fromY, moved } */
		var raf = 0;
		var last = 0;
		var dirty = true;
		var observer = null;
		var destroyed = false;
		var history = [];       /* --with-roll-back 的撤回栈 */
		var holdTimer = null;   /* "重新游玩"的长按计时器 */
		var holdBtn = null;
		var restartKeyDown = false;

		/* ---- 手牌 ---- */

		function refillTray() {
			for (var i = 0; i < BB_SLOTS; i++) {
				if (!game.tray[i]) game.tray[i] = bbDrawPiece(!!opt.easy);
			}
		}

		function trayLeft() {
			var n = 0;
			for (var i = 0; i < BB_SLOTS; i++) if (game.tray[i]) n++;
			return n;
		}

		function firstSlot(from) {
			for (var i = 0; i < BB_SLOTS; i++) {
				var idx = (from + i + BB_SLOTS) % BB_SLOTS;
				if (game.tray[idx]) return idx;
			}
			return -1;
		}

		/* 新选中一块时落点摆在棋盘中间(放不下也没关系, 提示会红着) */
		function defaultCursor(piece) {
			return {
				x: Math.max(0, Math.floor((BB_COLS - piece.w) / 2)),
				y: Math.max(0, Math.floor((BB_ROWS - piece.h) / 2))
			};
		}

		function selected() {
			return game.sel >= 0 ? game.tray[game.sel] : null;
		}

		function select(slot) {
			if (slot < 0 || slot >= BB_SLOTS || !game.tray[slot]) return false;
			if (game.sel !== slot) {
				game.sel = slot;
				game.cur = defaultCursor(game.tray[slot]);
			}
			dirty = true;
			return true;
		}

		/* 方向键 / 十字键: 没选块就自动选第一块, 落点夹在棋盘里 */
		function moveCursor(dx, dy) {
			var piece = selected();
			if (!piece) {
				if (!select(firstSlot(0))) return;
				piece = selected();
			}
			game.cur.x = Math.max(0, Math.min(BB_COLS - piece.w, game.cur.x + dx));
			game.cur.y = Math.max(0, Math.min(BB_ROWS - piece.h, game.cur.y + dy));
			dirty = true;
		}

		/* 换一块: 从当前这块往后找下一块还有的(触屏键 ⇄) */
		function cycleSlot() {
			var start = game.sel;
			for (var i = 1; i <= BB_SLOTS; i++) {
				var idx = (start + i + BB_SLOTS) % BB_SLOTS;
				if (game.tray[idx]) { select(idx); return; }
			}
		}

		/* ---- 放置 / 消线 ---- */

		/* 放下: 落点不合法就什么都不做(棋盘上那块红着的提示已经说明问题) */
		function place() {
			if (game.state !== 'running' || game.clearTimer) return false;
			if (!selected() && !select(firstSlot(0))) return false;
			var piece = selected();
			if (!bbFits(game.board, piece, game.cur.x, game.cur.y)) return false;
			if (opt.rollback) snapshot();

			var i;
			for (i = 0; i < piece.cells.length; i++) {
				game.board[game.cur.y + piece.cells[i][1]][game.cur.x + piece.cells[i][0]] = piece.color;
			}
			game.score += piece.cells.length * BB_POINT_PER_CELL;
			game.tray[game.sel] = null;
			game.sel = -1;

			var rows = [];
			var cols = [];
			var x, y;
			for (y = 0; y < BB_ROWS; y++) {
				var fullRow = true;
				for (x = 0; x < BB_COLS; x++) if (!game.board[y][x]) { fullRow = false; break; }
				if (fullRow) rows.push(y);
			}
			for (x = 0; x < BB_COLS; x++) {
				var fullCol = true;
				for (y = 0; y < BB_ROWS; y++) if (!game.board[y][x]) { fullCol = false; break; }
				if (fullCol) cols.push(x);
			}

			if (rows.length || cols.length) {
				/* 一次消 n 条(行 + 列一起数): 10*n*(n+1)/2 再乘连击倍率
				—— 1 条 10 分, 2 条 30 分, 3 条 60 分; 连着消就是 x2 x3 ... */
				var n = rows.length + cols.length;
				/* 连击数 = 这一轮累计消掉多少条线: 一次消 2 行就是 +2(不是 +1),
				   一次吃多行的收益因此是叠加的 */
				game.combo += n;
				game.misses = 0;      /* 消掉了, 宽限重新开始 */
				game.score += Math.round(10 * n * (n + 1) / 2) * game.combo;
				game.lines += n;
				game.clearRows = rows;
				game.clearCols = cols;
				game.clearTimer = BB_CLEAR_MS;
				if (game.score > game.best) { game.best = game.score; writeBest(BB_BEST_KEY, game.best); }
			} else {
				/* 连击不是一空放就断: 消完还能白放 BB_COMBO_GRACE-1(=3) 次,
				   第 4 次再没消掉才清空连击(中间这些空放, HUD 上的连击会依次变黄、变红) */
				game.misses += 1;
				if (game.misses >= BB_COMBO_GRACE) game.combo = 0;
				afterPlace();
			}

			updateHud();
			dirty = true;
			requestDraw();
			return true;
		}

		/* 一次放置彻底结算: 手牌用完就补三块, 然后看还有没有地方放 */
		function afterPlace() {
			if (trayLeft() === 0) refillTray();
			if (!anyMove()) gameOver();
			dirty = true;
		}

		function anyMove() {
			for (var i = 0; i < BB_SLOTS; i++) {
				if (game.tray[i] && bbFitsAnywhere(game.board, game.tray[i])) return true;
			}
			return false;
		}

		function applyClear() {
			var rows = game.clearRows;
			var cols = game.clearCols;
			game.clearRows = [];
			game.clearCols = [];
			game.clearTimer = 0;
			for (var y = 0; y < BB_ROWS; y++) {
				for (var x = 0; x < BB_COLS; x++) {
					if (rows.indexOf(y) !== -1 || cols.indexOf(x) !== -1) game.board[y][x] = null;
				}
			}
			afterPlace();
			updateHud();
			dirty = true;
			requestDraw();
		}

		/* ---- 撤回(--with-roll-back) ---- */

		/* 在放置"之前"拍一张: 板面 / 手牌 / 选中项 / 分数 / 连击 */
		function snapshot() {
			history.push({
				board: game.board.map(function (row) { return row.slice(); }),
				tray: game.tray.slice(),
				sel: game.sel,
				cur: { x: game.cur.x, y: game.cur.y },
				score: game.score,
				lines: game.lines,
				combo: game.combo,
				misses: game.misses
			});
			if (history.length > HISTORY_MAX) history.shift();
			updateUndoBtn();
		}

		function canUndo() { return !!opt.rollback && history.length > 0; }

		/* 撤回按钮的可用状态跟着栈走(与俄罗斯方块同一个坑: 只在 sync() 里刷会晚一步) */
		function updateUndoBtn() {
			if (btnUndo) btnUndo.disabled = !canUndo();
		}

		function undo() {
			if (!canUndo()) return false;
			var snap = history.pop();
			game.board = snap.board;
			game.tray = snap.tray;
			game.sel = snap.sel;
			game.cur = snap.cur;
			game.score = snap.score;
			game.lines = snap.lines;
			game.combo = snap.combo;
			game.misses = snap.misses;
			game.clearRows = [];
			game.clearCols = [];
			game.clearTimer = 0;
			/* 撤到"游戏结束"之前也照样能接着玩 */
			if (game.state !== 'running') game.state = 'running';
			updateHud();
			sync();
			dirty = true;
			requestDraw();
			return true;
		}

		/* ---- 状态 ---- */

		function reset() {
			history.length = 0;
			updateUndoBtn();
			game.board = bbEmptyBoard();
			game.tray = [null, null, null];
			refillTray();
			game.sel = -1;
			game.cur = { x: 0, y: 0 };
			game.score = 0;
			game.lines = 0;
			game.combo = 0;
			game.misses = 0;
			game.clearRows = [];
			game.clearCols = [];
			game.clearTimer = 0;
			updateHud();
			dirty = true;
			requestDraw();
		}

		function start() {
			if (destroyed || game.state === 'running') return;
			if (game.state === 'over' || game.state === 'ready') reset();
			game.state = 'running';
			sync();
			dirty = true;
			requestDraw();
		}

		function pause() {
			if (game.state !== 'running') return;
			game.state = 'paused';
			stopLoop();
			sync();
			dirty = true;
			requestDraw();
		}

		function resume() {
			if (game.state !== 'paused') return;
			game.state = 'running';
			sync();
			dirty = true;
			requestDraw();
		}

		function togglePause() {
			if (game.state === 'running') pause();
			else if (game.state === 'paused') resume();
		}

		function gameOver() {
			game.state = 'over';
			if (game.score > game.best) { game.best = game.score; writeBest(BB_BEST_KEY, game.best); }
			stopLoop();
			updateHud();
			sync();
			dirty = true;
			requestDraw();
		}

		/* ---- HUD / 覆盖层 ---- */

		/* 与俄罗斯方块一样: Best 不会低于正在打的这一局(写盘还是只在消线 / 结束时) */
		function updateHud() {
			if (game.score > game.best) game.best = game.score;
			if (elScore) elScore.textContent = String(game.score);
			if (elBest) elBest.textContent = String(game.best);
			if (elCombo) {
				/* 没有连击就是 ×0。颜色表示这一轮连击的健康度 ——
				   灰(没连击) / 白(刚触发) / 绿(空放 1 次) / 黄(2 次) / 红(3 次, 再空放就断)。
				   页面下方 .combo-legend 用的是同一套类名, 颜色永远一致(见 games.css)。 */
				elCombo.textContent = '×' + game.combo;
				var live = game.combo > 0;
				elCombo.classList.toggle('is-off', !live);
				elCombo.classList.toggle('is-live', live && game.misses === 0);
				elCombo.classList.toggle('is-miss1', live && game.misses === 1);
				elCombo.classList.toggle('is-miss2', live && game.misses === 2);
				elCombo.classList.toggle('is-miss3', live && game.misses >= 3);
			}
			if (elLines) elLines.textContent = String(game.lines);
		}

		/* 覆盖层与状态字是 JS 直接写的文本 —— 切语言时靠 i18n:applied 再刷一次 */
		function sync() {
			if (game.state === 'running') {
				if (overlay) overlay.classList.remove('is-shown');
			} else {
				var title;
				var hint;
				if (game.state === 'paused') {
					title = t('games.overlay.pausedTitle', 'PAUSED');
					hint = t('games.overlay.pausedHint', 'P or Esc to resume');
				} else if (game.state === 'over') {
					title = t('games.overlay.overTitle', 'GAME OVER');
					hint = t('games.overlay.overHint', 'score {score} · best {best}', {
						score: game.score, best: game.best
					});
				} else {
					title = t('games.blockblast.readyTitle', 'BLOCK BLAST');
					hint = t('games.overlay.readyHint', 'Press Start, or Space');
				}
				if (ovTitle) ovTitle.textContent = title;
				if (ovHint) ovHint.textContent = hint;
				if (overlay) overlay.classList.add('is-shown');
			}
			if (elState) elState.textContent = stateText(game.state);
			renderFlags();
			if (btnPause) {
				btnPause.textContent = game.state === 'paused'
					? t('games.btn.resume', 'Resume')
					: t('games.btn.pause', 'Pause');
				btnPause.disabled = (game.state !== 'running' && game.state !== 'paused');
			}
			if (btnStart) btnStart.disabled = game.state === 'running';
			updateUndoBtn();
		}

		/* 面板上的两个开关与当前状态同步 */
		function updateFlagChips() {
			Array.prototype.forEach.call(flagChips, function (chip) {
				var on = chip.getAttribute('data-flag') === 'easy' ? !!opt.easy : !!opt.rollback;
				chip.classList.toggle('is-on', on);
				chip.setAttribute('aria-pressed', on ? 'true' : 'false');
			});
		}

		/* 撤回相关的三样东西(按钮 / 触屏键 / 键位图例)只有开着 --with-roll-back 时才存在。
		--easy-mode 只影响"接下来补的牌", 已经在手上的三块不动 —— 别的没什么可改的。 */
		function applyFlags() {
			if (btnUndo) btnUndo.hidden = !opt.rollback;
			if (padUndo) padUndo.hidden = !opt.rollback;
			if (undoKeyHint) undoKeyHint.hidden = !opt.rollback;
			if (!opt.rollback) history.length = 0;
			updateUndoBtn();
			updateFlagChips();
			renderFlags();
			updateHud();
			dirty = true;
			requestDraw();
			sync();
		}

		function setFlags(next) {
			if (!next) return;
			if (typeof next.easy === 'boolean') opt.easy = next.easy;
			if (typeof next.rollback === 'boolean') opt.rollback = next.rollback;
			applyFlags();
		}

		function toggleFlag(name) {
			if (name !== 'easy' && name !== 'rollback') return;
			var next = { easy: opt.easy, rollback: opt.rollback };
			next[name] = !next[name];
			setFlags(next);
		}

		function onFlagClick(e) {
			var chip = e.target.closest ? e.target.closest('[data-flag]') : null;
			if (!chip) return;
			e.preventDefault();
			toggleFlag(chip.getAttribute('data-flag'));
		}

		function renderFlags() {
			if (!flagsBox) return;
			var chips = [];
			if (opt.easy) {
				chips.push('<span class="cabinet__flag cabinet__flag--easy" title="' +
					esc(t('games.blockblast.flag.easyTip', '--easy-mode: more long bars and big squares')) + '">' +
					esc(t('games.blockblast.flag.easy', 'GENTLE')) + '</span>');
			}
			if (opt.rollback) {
				chips.push('<span class="cabinet__flag cabinet__flag--undo" title="' +
					esc(t('games.blockblast.flag.rollbackTip', '--with-roll-back: undo is available')) + '">' +
					esc(t('games.blockblast.flag.rollback', 'UNDO')) + '</span>');
			}
			flagsBox.innerHTML = chips.join('');
		}

		/* ---- 渲染 ---- */

		/**
		 * 落点预览: **手里这块放在当前落点的话, 会消掉哪几行哪几列**。
		 *
		 * 判据就是"放下之后这一行/列正好填满" —— 先把方块虚拟地放上去, 再逐行逐列数空格,
		 * 所以高亮出来的那条线就是真会消掉的那条(顺带也就意味着会吃到 combo)。
		 * 没选块 / 落点放不下 / 正在消线 时都是空的。
		 * 8x8 而已, 每次重画前重算一遍很便宜, 不用维护增量状态。
		 */
		function previewClears() {
			game.previewRows = [];
			game.previewCols = [];
			if (game.state !== 'running' || game.clearTimer > 0) return;
			var piece = selected();
			if (!piece) return;
			if (!bbFits(game.board, piece, game.cur.x, game.cur.y)) return;

			/* 落点上这一块占的格子: 用一维标记表, 免得为了预览去复制整个板面 */
			var put = {};
			var i, x, y;
			for (i = 0; i < piece.cells.length; i++) {
				put[(game.cur.y + piece.cells[i][1]) * BB_COLS + (game.cur.x + piece.cells[i][0])] = true;
			}
			function filled(px, py) {
				return !!game.board[py][px] || !!put[py * BB_COLS + px];
			}
			for (y = 0; y < BB_ROWS; y++) {
				var fullRow = true;
				for (x = 0; x < BB_COLS; x++) if (!filled(x, y)) { fullRow = false; break; }
				if (fullRow) game.previewRows.push(y);
			}
			for (x = 0; x < BB_COLS; x++) {
				var fullCol = true;
				for (y = 0; y < BB_ROWS; y++) if (!filled(x, y)) { fullCol = false; break; }
				if (fullCol) game.previewCols.push(x);
			}
		}

		function metrics() {
			var cell = Math.min(canvas.width / BB_COLS, canvas.height / (BB_ROWS + BB_TRAY_H));
			var ox = (canvas.width - cell * BB_COLS) / 2;
			var oy = (canvas.height - cell * (BB_ROWS + BB_TRAY_H)) / 2;
			return {
				cell: cell,
				ox: ox,
				oy: oy,
				trayY: oy + cell * BB_ROWS,
				slotW: cell * BB_COLS / BB_SLOTS,
				trayH: cell * BB_TRAY_H
			};
		}

		/**
		 * 手牌条第 idx 格里, 方块画在哪儿(居中)。
		 *
		 * 缩放取三者的最小值: 常规倍率(0.6)、按格宽能塞下、按格高能塞下 ——
		 * 五连横过来有 5 格宽, 而一格只有 8/3 格宽, 只用 0.6 的话会凸到隔壁格外面去。
		 */
		function slotOrigin(mt, idx, piece) {
			var fitW = mt.slotW * BB_TRAY_FIT / piece.w;
			var fitH = mt.trayH * BB_TRAY_FIT / piece.h;
			var scale = Math.min(mt.cell * BB_TRAY_SCALE, fitW, fitH);
			return {
				x: mt.ox + idx * mt.slotW + (mt.slotW - piece.w * scale) / 2,
				y: mt.trayY + (mt.trayH - piece.h * scale) / 2,
				scale: scale
			};
		}

		function drawPieceAt(c, piece, px, py, scale, alpha) {
			for (var i = 0; i < piece.cells.length; i++) {
				block(c, px + piece.cells[i][0] * scale, py + piece.cells[i][1] * scale,
					scale, piece.color, alpha);
			}
		}

		/* 落点提示: 放得下用方块本色描一圈 + 半透明填充, 放不下就整块红着 */
		function drawGhost(c, mt, piece, ok) {
			var i, gx, gy;
			var color = ok ? piece.color : '#ff4d5a';
			c.fillStyle = color;
			c.strokeStyle = color;
			c.lineWidth = Math.max(1, mt.cell * 0.08);
			for (i = 0; i < piece.cells.length; i++) {
				gx = game.cur.x + piece.cells[i][0];
				gy = game.cur.y + piece.cells[i][1];
				if (gx < 0 || gx >= BB_COLS || gy < 0 || gy >= BB_ROWS) continue;
				c.globalAlpha = ok ? 0.34 : 0.16;
				c.fillRect(mt.ox + gx * mt.cell, mt.oy + gy * mt.cell, mt.cell, mt.cell);
				c.globalAlpha = ok ? 0.9 : 0.5;
				c.strokeRect(mt.ox + gx * mt.cell + mt.cell * 0.14, mt.oy + gy * mt.cell + mt.cell * 0.14,
					mt.cell * 0.72, mt.cell * 0.72);
			}
			c.globalAlpha = 1;
		}

		function draw() {
			if (!ctx || !canvas.width || !canvas.height) return;
			var mt = metrics();
			var i, x, y;
			previewClears();     /* 先按当前落点算一遍"这一手会不会消" */
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			/* 棋盘底网格 */
			ctx.strokeStyle = gridColor();
			ctx.lineWidth = Math.max(1, mt.cell * 0.05);
			ctx.beginPath();
			for (i = 1; i < BB_COLS; i++) {
				ctx.moveTo(mt.ox + i * mt.cell, mt.oy);
				ctx.lineTo(mt.ox + i * mt.cell, mt.oy + BB_ROWS * mt.cell);
			}
			for (i = 1; i < BB_ROWS; i++) {
				ctx.moveTo(mt.ox, mt.oy + i * mt.cell);
				ctx.lineTo(mt.ox + BB_COLS * mt.cell, mt.oy + i * mt.cell);
			}
			ctx.stroke();

			/* 棋盘外框: 顺手把手牌条分开 —— 少这一圈的话, 手牌条看着像第 9、10 行 */
			ctx.strokeStyle = gridEdgeColor();
			ctx.lineWidth = Math.max(1, mt.cell * 0.06);
			ctx.strokeRect(mt.ox, mt.oy, BB_COLS * mt.cell, BB_ROWS * mt.cell);

			var dragging = !!(drag && drag.moved);

			/* 已经落定的格子(正在消的那几行几列压暗, 等闪光走完再清) */
			for (y = 0; y < BB_ROWS; y++) {
				for (x = 0; x < BB_COLS; x++) {
					var color = game.board[y][x];
					if (!color) continue;
					var clearing = game.clearTimer > 0 &&
						(game.clearRows.indexOf(y) !== -1 || game.clearCols.indexOf(x) !== -1);
					block(ctx, mt.ox + x * mt.cell, mt.oy + y * mt.cell, mt.cell, color, clearing ? 0.3 : 0.92);
				}
			}

			/* 消线闪光 */
			if (game.clearTimer > 0) {
				var k = 1 - Math.max(0, game.clearTimer / BB_CLEAR_MS);
				ctx.globalAlpha = 0.2 + 0.6 * k;
				ctx.fillStyle = '#ffffff';
				game.clearRows.forEach(function (row) {
					ctx.fillRect(mt.ox, mt.oy + row * mt.cell, BB_COLS * mt.cell, mt.cell);
				});
				game.clearCols.forEach(function (col) {
					ctx.fillRect(mt.ox + col * mt.cell, mt.oy, mt.cell, BB_ROWS * mt.cell);
				});
				ctx.globalAlpha = 1;
			}

			var piece = selected();

			/* 落点提示: 拖动 / 键盘 / 点选三种路径都看这一块 */
			if (piece && !game.clearTimer && game.state !== 'over') {
				drawGhost(ctx, mt, piece, bbFits(game.board, piece, game.cur.x, game.cur.y));
			}

			/**
			 * 落点预览: 这一手放下去"会消掉"的整行 / 整列, 高亮给玩家看。
			 * 只在这一手真能消的时候出现(见 previewClears), 所以只要看到高亮,
			 * 松手就是一次消除(带 combo) —— 画在幽灵之上, 整条线读起来是一件事。
			 */
			if (game.previewRows.length || game.previewCols.length) {
				ctx.fillStyle = '#ffffff';
				ctx.strokeStyle = '#ffffff';
				ctx.globalAlpha = 0.17;
				game.previewRows.forEach(function (row) {
					ctx.fillRect(mt.ox, mt.oy + row * mt.cell, BB_COLS * mt.cell, mt.cell);
				});
				game.previewCols.forEach(function (col) {
					ctx.fillRect(mt.ox + col * mt.cell, mt.oy, mt.cell, BB_ROWS * mt.cell);
				});
				ctx.globalAlpha = 0.85;
				ctx.lineWidth = Math.max(2, mt.cell * 0.09);
				game.previewRows.forEach(function (row) {
					ctx.strokeRect(mt.ox + 1, mt.oy + row * mt.cell + 1, BB_COLS * mt.cell - 2, mt.cell - 2);
				});
				game.previewCols.forEach(function (col) {
					ctx.strokeRect(mt.ox + col * mt.cell + 1, mt.oy + 1, mt.cell - 2, BB_ROWS * mt.cell - 2);
				});
				ctx.globalAlpha = 1;
			}

			/* 手牌条: 三格, 选中的那格描一圈本色 */
			for (i = 0; i < BB_SLOTS; i++) {
				var slotX = mt.ox + i * mt.slotW;
				if (i > 0) {
					ctx.strokeStyle = gridColor();
					ctx.lineWidth = Math.max(1, mt.cell * 0.05);
					ctx.beginPath();
					ctx.moveTo(slotX, mt.trayY + mt.trayH * 0.14);
					ctx.lineTo(slotX, mt.trayY + mt.trayH * 0.86);
					ctx.stroke();
				}
				var slotPiece = game.tray[i];
				if (!slotPiece) continue;
				var org = slotOrigin(mt, i, slotPiece);
				drawPieceAt(ctx, slotPiece, org.x, org.y, org.scale,
					dragging && drag.slot === i ? 0.28 : 1);
				if (game.sel === i && !dragging) {
					ctx.strokeStyle = slotPiece.color;
					ctx.globalAlpha = 0.5;
					ctx.lineWidth = Math.max(1.5, mt.cell * 0.08);
					ctx.strokeRect(slotX + mt.cell * 0.14, mt.trayY + mt.cell * 0.14,
						mt.slotW - mt.cell * 0.28, mt.trayH - mt.cell * 0.28);
					ctx.globalAlpha = 1;
				}
			}

			/* 拖在手上的那块: 跟着指针走(位置夹在画布内), 松手才判定放不放得下 */
			if (dragging && piece) {
				var dpos = dragPos(piece, mt);
				drawPieceAt(ctx, piece, dpos.x, dpos.y, mt.cell, 0.95);
			}
		}

		/* ---- 尺寸 / 主循环 ---- */

		/* 与俄罗斯方块同理: 用 clientWidth/clientHeight —— 入场动画给 .page 挂了 transform,
		getBoundingClientRect 量出来是缩放过的尺寸, 会按错的尺寸建画布(画面糊)。 */
		function resize() {
			var dpr = Math.min(global.devicePixelRatio || 1, 2);
			var w = canvas.clientWidth;
			var h = canvas.clientHeight;
			if (w && h) {
				canvas.width = Math.max(1, Math.round(w * dpr));
				canvas.height = Math.max(1, Math.round(h * dpr));
			}
			dirty = true;
			requestDraw();
		}

		/* Block Blast 没有重力, 平时根本不用逐帧画 —— 只有消线闪光那 240ms 需要。
		   所以主循环是"按需唤起"的: 输入把 dirty 打开, 画完自己停, 页面能真闲着。
		   (落点预览是"跟着幽灵走"的静态高亮, 不需要排帧。) */
		function frame(now) {
			if (destroyed) return;
			if (!canvas.isConnected) { destroy(); return; }
			var dt = last ? Math.min(now - last, 120) : 0;
			last = now;
			if (game.clearTimer > 0) {
				game.clearTimer -= dt;
				if (game.clearTimer <= 0) applyClear();
				dirty = true;
			}
			if (dirty) { draw(); dirty = false; }
			if (game.clearTimer > 0) raf = global.requestAnimationFrame(frame);
			else { raf = 0; last = 0; }
		}

		function requestDraw() {
			dirty = true;
			if (raf || destroyed) return;
			last = 0;
			raf = global.requestAnimationFrame(frame);
		}

		function stopLoop() {
			if (!raf) return;
			global.cancelAnimationFrame(raf);
			raf = 0;
		}

		/* ---- 指针: 拖动 / 点选 ---- */

		function canvasPos(e) {
			var r = canvas.getBoundingClientRect();
			return {
				x: (e.clientX - r.left) / (r.width || 1) * canvas.width,
				y: (e.clientY - r.top) / (r.height || 1) * canvas.height
			};
		}

		function slotAt(p, mt) {
			if (p.y < mt.trayY) return -1;
			var idx = Math.floor((p.x - mt.ox) / mt.slotW);
			if (idx < 0 || idx >= BB_SLOTS) return -1;
			return game.tray[idx] ? idx : -1;
		}

		/**
		 * 拖动中方块的绘制位置 —— **夹在画布里面**。
		 * 指针(尤其是指针捕获之后)可以跑到画布外面很远, 不夹的话方块会被拖出显示区域,
		 * 只剩半块甚至整块看不见。夹完再按这个位置算落点, 于是"方块画在哪"和"会落在哪"永远一致。
		 */
		function dragPos(piece, mt) {
			var maxX = Math.max(0, canvas.width - piece.w * mt.cell);
			var maxY = Math.max(0, canvas.height - piece.h * mt.cell);
			return {
				x: Math.min(Math.max(drag.x - drag.grabX * mt.cell, 0), maxX),
				y: Math.min(Math.max(drag.y - drag.grabY * mt.cell, 0), maxY)
			};
		}

		/* 指针位置 -> 方块左上角的格坐标。grab 是按下时手指在方块里的相对位置(单位是格);
		点棋盘(没有 grab)时按方块中心算, 手感上就是"点在哪儿就摆在哪儿"。 */
		function anchorFrom(p, piece, grab, mt) {
			var gx = grab ? grab.x : piece.w / 2;
			var gy = grab ? grab.y : piece.h / 2;
			return {
				x: Math.round((p.x - mt.ox) / mt.cell - gx),
				y: Math.round((p.y - mt.oy) / mt.cell - gy)
			};
		}

		function onCanvasDown(e) {
			if (destroyed || e.button > 0) return;
			if (game.state === 'ready') start();
			if (game.state === 'paused') { resume(); return; }
			if (game.state !== 'running' || game.clearTimer) return;

			var mt = metrics();
			var p = canvasPos(e);
			var slot = slotAt(p, mt);
			if (slot >= 0) {
				/* 按在手牌上: 拎起来, 松手时按移动距离判定是"拖"还是"点" */
				select(slot);
				var grabPiece = game.tray[slot];
				var org = slotOrigin(mt, slot, grabPiece);
				/* 抓点夹在方块自己的范围里: 小方块在大格子里按到边角时, 不会一拎起来就偏半格 */
				var grabX = Math.min(Math.max((p.x - org.x) / org.scale, 0), grabPiece.w);
				var grabY = Math.min(Math.max((p.y - org.y) / org.scale, 0), grabPiece.h);
				drag = {
					slot: slot,
					grabX: grabX,
					grabY: grabY,
					x: p.x, y: p.y,
					fromX: p.x, fromY: p.y,
					moved: false
				};
				game.cur = anchorFrom(p, grabPiece, { x: grabX, y: grabY }, mt);
				if (canvas.setPointerCapture && e.pointerId != null) {
					try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
				}
			} else if (p.y < mt.trayY) {
				/* 点棋盘: 手上有选中的牌就放在点到的地方 */
				var piece = selected();
				if (piece) {
					game.cur = anchorFrom(p, piece, null, mt);
					place();
				}
			} else {
				game.sel = -1;   /* 点在手牌条的空白处 = 取消选择 */
			}
			e.preventDefault();
			dirty = true;
			requestDraw();
		}

		function onCanvasMove(e) {
			if (destroyed || !drag) return;
			var p = canvasPos(e);
			drag.x = p.x;
			drag.y = p.y;
			if (!drag.moved &&
				Math.abs(p.x - drag.fromX) + Math.abs(p.y - drag.fromY) > BB_DRAG_SLOP) {
				drag.moved = true;
			}
			if (drag.moved) {
				var held = game.tray[drag.slot];
				if (!held) return;
				/* 落点按"夹过的绘制位置"算 —— 方块画在哪就落在哪, 不会出现手指已经滑到画布外、
				   方块却还在更外面跟着跑的情况 */
				var mt = metrics();
				var pos = dragPos(held, mt);
				game.cur = {
					x: Math.round((pos.x - mt.ox) / mt.cell),
					y: Math.round((pos.y - mt.oy) / mt.cell)
				};
			}
			e.preventDefault();
			dirty = true;
			requestDraw();
		}

		function onCanvasUp(e) {
			if (!drag) return;
			var moved = drag.moved;
			var slot = drag.slot;
			drag = null;
			if (moved) place();      /* 放不下就退回手牌, 方块不会消失 */
			else select(slot);       /* 只是点了一下: 选中, 等第二次点棋盘 */
			if (e && e.pointerId != null && canvas.releasePointerCapture) {
				try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
			}
			dirty = true;
			requestDraw();
		}

		/* ---- 键盘 / 触屏键 ---- */

		var ACTIONS = {
			ArrowLeft: 'left', a: 'left', A: 'left',
			ArrowRight: 'right', d: 'right', D: 'right',
			ArrowUp: 'up', w: 'up', W: 'up',
			ArrowDown: 'down', s: 'down', S: 'down',
			' ': 'place', Spacebar: 'place', Enter: 'place',
			'1': 'slot1', '2': 'slot2', '3': 'slot3',
			p: 'pause', P: 'pause', Escape: 'pause',
			u: 'undo', U: 'undo',
			r: 'restart', R: 'restart'
		};

		function press(action) {
			if (game.state === 'ready') {
				if (action === 'place' || action === 'pause') start();
				return;
			}
			if (game.state === 'paused') {
				if (action === 'pause' || action === 'place') resume();
				return;
			}
			if (game.state === 'over') {
				if (action === 'place') start();
				return;
			}
			if (game.clearTimer) return;

			if (action === 'left') moveCursor(-1, 0);
			else if (action === 'right') moveCursor(1, 0);
			else if (action === 'up') moveCursor(0, -1);
			else if (action === 'down') moveCursor(0, 1);
			else if (action === 'slot1') select(0);
			else if (action === 'slot2') select(1);
			else if (action === 'slot3') select(2);
			else if (action === 'next') cycleSlot();
			else if (action === 'place') place();
			else if (action === 'undo') { undo(); return; }
			else if (action === 'pause') { pause(); return; }
			dirty = true;
			requestDraw();
		}

		function onKeyDown(e) {
			if (destroyed) return;
			var target = e.target;
			var tag = (target && target.tagName || '').toLowerCase();
			if (tag === 'input' || tag === 'textarea' || (target && target.isContentEditable)) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			var action = ACTIONS[e.key];
			if (!action) return;
			if (action === 'undo' && !opt.rollback) return;   /* 没开撤回时 u 不归游戏 */

			/* 只有真正会被游戏用掉的按键才 preventDefault ——
			没在跑的时候方向键还要留给页面滚动 */
			var playing = game.state === 'running';
			var starting = (game.state === 'ready' || game.state === 'over') && action === 'place';
			var resuming = game.state === 'paused' && (action === 'pause' || action === 'place');
			var restarting = action === 'restart';
			if (!playing && !starting && !resuming && !restarting) return;

			e.preventDefault();
			/* R 和"重新游玩"按钮一样要长按 */
			if (action === 'restart') {
				if (restartKeyDown) return;
				restartKeyDown = true;
				beginHold(btnRestart);
				return;
			}
			press(action);
		}

		function onKeyUp(e) {
			var action = ACTIONS[e.key];
			if (!action) return;
			if (action === 'restart') {
				restartKeyDown = false;
				endHold();
			}
		}

		/* 触屏键只有单步, 没有俄罗斯方块那种长按连发: 十字键一下走一格,
		右手两个大键 = 放下(drop) / 换一块(hold) */
		function onPadDown(e) {
			var btn = e.target && e.target.closest ? e.target.closest('[data-pad]') : null;
			if (!btn) return;
			e.preventDefault();
			var pad = btn.getAttribute('data-pad');
			if (pad === 'undo' && !opt.rollback) return;
			press(pad === 'drop' ? 'place' : (pad === 'hold' ? 'next' : pad));
		}

		function doRestart() {
			reset();
			start();
		}

		/* ---- "重新游玩"要长按才生效 ---- */

		function beginHold(btn) {
			if (destroyed || holdTimer) return;
			holdBtn = btn || btnRestart;
			if (holdBtn) holdBtn.classList.add('is-holding');
			holdTimer = global.setTimeout(function () {
				holdTimer = null;
				var el = holdBtn;
				holdBtn = null;
				if (el) {
					el.classList.remove('is-holding');
					el.classList.add('is-done');
					global.setTimeout(function () { el.classList.remove('is-done'); }, 420);
				}
				doRestart();
			}, HOLD_RESTART_MS);
		}

		function endHold() {
			if (holdTimer) {
				global.clearTimeout(holdTimer);
				holdTimer = null;
			}
			if (holdBtn) {
				holdBtn.classList.remove('is-holding');
				holdBtn = null;
			}
		}

		function actionTarget(e) {
			return e.target && e.target.closest ? e.target.closest('[data-bb-action]') : null;
		}

		function onCabDown(e) {
			if (destroyed) return;
			if (e.target.closest && e.target.closest('[data-pad]')) { onPadDown(e); return; }
			var btn = actionTarget(e);
			if (btn && btn.getAttribute('data-bb-action') === 'restart') {
				/* 长按在触屏上会选中文字 / 弹右键菜单, 这里一起按掉 */
				e.preventDefault();
				beginHold(btn);
			}
		}

		function onCabUp() {
			endHold();
		}

		function onClick(e) {
			if (destroyed) return;
			var el = actionTarget(e);
			if (!el) return;
			var act = el.getAttribute('data-bb-action');
			if (act === 'start') start();
			else if (act === 'pause') togglePause();
			else if (act === 'undo') undo();
			else if (act === 'restart') {
				/* 指针那条路走 pointerdown/up; 这里只接键盘 —— 键盘触发的 click 里 detail 为 0 */
				if (e.detail === 0) doRestart();
			}
		}

		function overlayClick() {
			if (game.state === 'running') pause();
			else if (game.state === 'paused') resume();
			else start();
		}

		function onVisibility() {
			if (doc.hidden && game.state === 'running') pause();
		}

		function onI18n() {
			sync();
		}

		/* ---- 挂载 / 卸载 ---- */

		cab.addEventListener('click', onClick);
		cab.addEventListener('pointerdown', onCabDown);
		cab.addEventListener('pointerup', onCabUp);
		cab.addEventListener('pointercancel', onCabUp);
		cab.addEventListener('pointerleave', onCabUp);
		cab.addEventListener('contextmenu', function (e) {
			/* 长按"重新游玩"时不要弹右键菜单 */
			if (e.target.closest && e.target.closest('[data-bb-action="restart"]')) e.preventDefault();
		});
		canvas.addEventListener('pointerdown', onCanvasDown);
		canvas.addEventListener('pointermove', onCanvasMove);
		canvas.addEventListener('pointerup', onCanvasUp);
		canvas.addEventListener('pointercancel', onCanvasUp);
		/* 兜底: 指针捕获没生效时, 手指在画布外抬起也要把这一手了结 */
		doc.addEventListener('pointerup', onCanvasUp);
		if (overlay) overlay.addEventListener('click', overlayClick);
		doc.addEventListener('keydown', onKeyDown);
		doc.addEventListener('keyup', onKeyUp);
		doc.addEventListener('visibilitychange', onVisibility);
		doc.addEventListener('i18n:applied', onI18n);

		if (global.ResizeObserver) {
			observer = new global.ResizeObserver(function () { resize(); });
			observer.observe(canvas);
		} else {
			global.addEventListener('resize', resize);
		}

		function destroy() {
			if (destroyed) return;
			destroyed = true;
			stopLoop();
			if (observer) observer.disconnect();
			else global.removeEventListener('resize', resize);
			endHold();
			if (flagPanel) flagPanel.removeEventListener('click', onFlagClick);
			doc.removeEventListener('pointerup', onCanvasUp);
			doc.removeEventListener('keydown', onKeyDown);
			doc.removeEventListener('keyup', onKeyUp);
			doc.removeEventListener('visibilitychange', onVisibility);
			doc.removeEventListener('i18n:applied', onI18n);
			drag = null;
			delete cab.dataset.gameReady;
		}

		if (flagPanel) flagPanel.addEventListener('click', onFlagClick);

		cab.dataset.gameReady = 'true';
		updateHud();
		reset();
		applyFlags();     /* 撤回按钮 / 牌子 / 面板开关都按 opt 落一遍 */
		resize();
		setTimeout(resize, 60);

		return {
			start: start,
			pause: pause,
			reset: reset,
			setFlags: setFlags,
			resize: resize,
			state: function () { return game.state; },
			undo: undo,
			/* 只读快照: 排查出牌 / 自动化验证时看看当前是什么局面。
			   先算一遍 preview —— 它是"当前落点会消什么", 只在 draw() 里算的话会慢一帧,
			   快照就不等于"此刻的局面"了。 */
			debug: function () {
				previewClears();
				return {
					game: 'blockblast',
					state: game.state,
					score: game.score,
					lines: game.lines,
					combo: game.combo,
					misses: game.misses,
					best: game.best,
					sel: game.sel,
					cursor: { x: game.cur.x, y: game.cur.y },
					tray: game.tray.map(function (p) { return p ? p.id : null; }),
					/* 手牌的形状也要能看到 —— 验证"三块都放不下才算结束"时要用 */
					pieces: game.tray.map(function (p) {
						return p ? { id: p.id, w: p.w, h: p.h, cells: p.cells } : null;
					}),
					/* 当前落点放下去会消掉哪些行/列(见 previewClears) */
					preview: { rows: game.previewRows.slice(), cols: game.previewCols.slice() },
					/* 板面文字图: '#' = 有块, '.' = 空(从上往下每一行一行) */
					board: game.board.map(function (row) {
						return row.map(function (cell) { return cell ? '#' : '.'; }).join('');
					}),
					easy: !!opt.easy,
					rollback: !!opt.rollback,
					undoHidden: btnUndo ? btnUndo.hidden : null,
					undoDisabled: btnUndo ? btnUndo.disabled : null,
					history: history.length,
					canUndo: canUndo()
				};
			},
			scrollTo: function () {
				if (!cab.scrollIntoView) return;
				var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
				cab.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
			},
			destroy: destroy
		};
	}



	/* ============================================================ 函数球打砖块 */

	/*
	 * 两位选手各一颗函数球, 中间一道挡板, 各自面对完全相同的一堵砖墙。
	 *   - 球只上下弹, 每次弹跳的高度恒定(页面上的滑杆可调, --slow-motion 再翻倍);
	 *   - 每弹一次算一次命中: 这一次的伤害就是 f(x), 然后 x 按"每跳增量"往上涨;
	 *   - 砖块生命值掉到 0 以下才碎(正好打到 0 不碎), 溢出伤害不结转给下一块;
	 *   - 一层碎完球就落到下一层, 先打穿整堵墙、落到地面的那方获胜, 对决立刻结束。
	 *
	 * f(x) 由下面的解析器自己算(不用 eval / new Function):
	 * 支持 + - * / % ^ 、括号、后缀阶乘 ! 、一元负号、隐含乘号(2x / 3(x+1));
	 * 函数与常量见 FB_FUNCS / FB_CONSTS, 变量名 x 与 n 等价。伤害算出来是负数一律当 0,
	 * 免得"越打血越多"永远打不穿。
	 */

	var FB_GRAVITY = 1800;        /* px/s^2: 弹跳高度是固定的, 重力只决定"多久弹一次" */
	var FB_BOUNCE = 56;           /* 弹跳高度(px)的出厂值, 页面滑杆与 --slow-motion 都在这个基础上算 */
	var FB_BOUNCE_MIN = 20;
	var FB_BOUNCE_MAX = 140;
	var FB_BOUNCE_SLOW = 2;       /* --slow-motion: 弹跳高度翻倍, 每跳更慢 */
	var FB_TRAIL = 14;            /* 球的拖尾采样点数 */
	var FB_X_MAX = 4000;          /* x 的上限, 防止跑飞 */
	var FB_HP_MAX = 1e30;         /* 砖块生命值上限 */
	var FB_STEP_MS = 8;           /* 物理固定步长, 与帧率无关 */
	var FB_HOLD_RESTART_MS = 700; /* 与另外两台一样: 重开要长按 */
	var FB_FONT = '"JetBrains Mono", Menlo, Consolas, monospace';

	/* 0! = 1(所以阶乘球第一下就是 1 点伤害); 171! 起就溢出成 Infinity 了 */
	function fbFact(n) {
		if (isNaN(n)) return NaN;
		if (!isFinite(n)) return n > 0 ? Infinity : NaN;
		n = Math.round(n);
		if (n < 0) return NaN;
		if (n > 170) return Infinity;
		var r = 1;
		for (var i = 2; i <= n; i++) r *= i;
		return r;
	}

	/* F(0) = 0, F(1) = 1; 1477 项就溢出双精度了 */
	function fbFib(n) {
		if (isNaN(n)) return NaN;
		if (!isFinite(n)) return n > 0 ? Infinity : NaN;
		n = Math.round(n);
		if (n < 0) return NaN;
		if (n > 1476) return Infinity;
		var a = 0, b = 1;
		for (var i = 0; i < n; i++) { var t = a + b; a = b; b = t; }
		return a;
	}

	var FB_CONSTS = { pi: Math.PI, e: Math.E };

	var FB_FUNCS = {
		abs: Math.abs,
		sqrt: Math.sqrt,
		floor: Math.floor,
		ceil: Math.ceil,
		round: Math.round,
		trunc: Math.trunc || Math.floor,
		sign: Math.sign || function (a) { return a > 0 ? 1 : (a < 0 ? -1 : 0); },
		exp: Math.exp,
		log: Math.log,
		ln: Math.log,
		log10: Math.log10 || function (a) { return Math.log(a) / Math.LN10; },
		log2: Math.log2 || function (a) { return Math.log(a) / Math.LN2; },
		sin: Math.sin,
		cos: Math.cos,
		tan: Math.tan,
		pow: Math.pow,
		min: Math.min,
		max: Math.max,
		mod: function (a, b) { return a % b; },
		gcd: function (a, b) {
			a = Math.abs(Math.round(a));
			b = Math.abs(Math.round(b));
			while (b) { var t = a % b; a = b; b = t; }
			return a;
		},
		fact: fbFact,
		fib: fbFib
	};

	/* 需要两个参数的函数(其余都只吃一个; min / max 不限个数) */
	var FB_ARITY2 = { pow: 1, mod: 1, gcd: 1 };

	function fbTokens(src) {
		var out = [];
		var i = 0;
		while (i < src.length) {
			var c = src.charAt(i);
			if (c === ' ' || c === '	') { i++; continue; }
			if ((c >= '0' && c <= '9') || (c === '.' && src.charAt(i + 1) >= '0' && src.charAt(i + 1) <= '9')) {
				var j = i;
				while (j < src.length && src.charAt(j) >= '0' && src.charAt(j) <= '9') j++;
				if (src.charAt(j) === '.') {
					j++;
					while (j < src.length && src.charAt(j) >= '0' && src.charAt(j) <= '9') j++;
				}
				/* 科学计数法 1e6 / 2e-3 —— 但光一个 e(欧拉数)不算, 后面必须跟数字 */
				if (src.charAt(j) === 'e' || src.charAt(j) === 'E') {
					var d = j + 1;
					if (src.charAt(d) === '+' || src.charAt(d) === '-') d++;
					if (src.charAt(d) >= '0' && src.charAt(d) <= '9') {
						while (d < src.length && src.charAt(d) >= '0' && src.charAt(d) <= '9') d++;
						j = d;
					}
				}
				out.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
				i = j;
				continue;
			}
			if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
				var k = i;
				while (k < src.length) {
					var ch = src.charAt(k);
					if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_') k++;
					else break;
				}
				out.push({ t: 'name', v: src.slice(i, k) });
				i = k;
				continue;
			}
			if ('+-*/%^()!,'.indexOf(c) >= 0) { out.push({ t: c }); i++; continue; }
			throw new Error('unexpected "' + c + '"');
		}
		return out;
	}

	/**
	 * f(x) -> 语法树。递归下降, 优先级从低到高:
	 *   expr  : term (('+' | '-') term)*
	 *   term  : unary (('*' | '/' | '%') unary | 隐含乘号)*
	 *   unary : ('-' | '+') unary | power
	 *   power : postfix ('^' unary)?        右结合, 于是 2^3^2 = 2^(3^2)
	 *   postfix: primary '!'*               阶乘是后缀, 所以写 x! 而不是 !x
	 *   primary: 数字 | x | 常量 | 函数(参数...) | '(' expr ')'
	 */
	function fbParse(src) {
		var toks = fbTokens(String(src == null ? '' : src));
		var pos = 0;

		function peek() { return toks[pos]; }
		function next() { return toks[pos++]; }
		function want(t) {
			var tk = next();
			if (!tk || tk.t !== t) throw new Error('expected "' + t + '"');
			return tk;
		}
		function label(tk) {
			if (!tk) return 'end of input';
			return tk.t === 'num' || tk.t === 'name' ? '"' + tk.v + '"' : '"' + tk.t + '"';
		}

		function parseExpr() {
			var node = parseTerm();
			for (;;) {
				var tk = peek();
				if (tk && (tk.t === '+' || tk.t === '-')) { next(); node = { op: tk.t, a: node, b: parseTerm() }; }
				else return node;
			}
		}

		function parseTerm() {
			var node = parseUnary();
			for (;;) {
				var tk = peek();
				if (tk && (tk.t === '*' || tk.t === '/' || tk.t === '%')) {
					next();
					node = { op: tk.t, a: node, b: parseUnary() };
				} else if (tk && (tk.t === 'num' || tk.t === 'name' || tk.t === '(')) {
					/* 隐含乘号: 2x / 3(x+1) / 2pi */
					node = { op: '*', a: node, b: parseUnary() };
				} else {
					return node;
				}
			}
		}

		function parseUnary() {
			var tk = peek();
			if (tk && (tk.t === '-' || tk.t === '+')) {
				next();
				var inner = parseUnary();
				return tk.t === '-' ? { op: 'neg', a: inner } : inner;
			}
			return parsePower();
		}

		function parsePower() {
			var base = parsePostfix();
			var tk = peek();
			if (tk && tk.t === '^') {
				next();
				return { op: '^', a: base, b: parseUnary() };
			}
			return base;
		}

		function parsePostfix() {
			var node = parsePrimary();
			while (peek() && peek().t === '!') { next(); node = { op: 'fact', a: node }; }
			return node;
		}

		function parsePrimary() {
			var tk = next();
			if (!tk) throw new Error('unexpected end of input');
			if (tk.t === 'num') return { num: tk.v };
			if (tk.t === '(') {
				var inner = parseExpr();
				want(')');
				return inner;
			}
			if (tk.t === 'name') {
				var name = tk.v.toLowerCase();
				if (peek() && peek().t === '(') {
					next();
					var args = [];
					if (!(peek() && peek().t === ')')) {
						args.push(parseExpr());
						while (peek() && peek().t === ',') { next(); args.push(parseExpr()); }
					}
					want(')');
					if (!FB_FUNCS[name]) throw new Error('unknown function "' + tk.v + '"');
					if (FB_ARITY2[name] && args.length !== 2) throw new Error(name + '() takes 2 numbers');
					if (!FB_ARITY2[name] && name !== 'min' && name !== 'max' && args.length !== 1) {
						throw new Error(name + '() takes 1 number');
					}
					if ((name === 'min' || name === 'max') && !args.length) throw new Error(name + '() needs a number');
					return { fn: name, args: args };
				}
				if (name === 'x' || name === 'n') return { x: 1 };
				if (Object.prototype.hasOwnProperty.call(FB_CONSTS, name)) return { num: FB_CONSTS[name] };
				throw new Error('unknown name "' + tk.v + '"');
			}
			throw new Error('unexpected ' + label(tk));
		}

		var ast = parseExpr();
		if (pos < toks.length) throw new Error('unexpected ' + label(toks[pos]));
		return ast;
	}

	function fbEval(node, x) {
		if (node.num !== undefined) return node.num;
		if (node.x !== undefined) return x;
		if (node.fn) {
			var args = [];
			for (var i = 0; i < node.args.length; i++) args.push(fbEval(node.args[i], x));
			return FB_FUNCS[node.fn].apply(null, args);
		}
		var a = fbEval(node.a, x);
		if (node.op === 'neg') return -a;
		if (node.op === 'fact') return fbFact(a);
		var b = fbEval(node.b, x);
		if (node.op === '+') return a + b;
		if (node.op === '-') return a - b;
		if (node.op === '*') return a * b;
		if (node.op === '/') return a / b;
		if (node.op === '%') return a % b;
		if (node.op === '^') return Math.pow(a, b);
		return 0;
	}

	/**
	 * 伤害: NaN 与负数一律当 0(负数当"治疗"的话永远打不穿), 并且取整。
	 * 取整是为了"砖块上的大数字"好看, 也为了每个数字都能一眼读出来 ——
	 * 百分比球 10 * 1.35^x 会算出 9893577.29 这种小数, 会一路带进生命值和总计里。
	 */
	function fbDamage(ast, x) {
		var v = fbEval(ast, x);
		if (typeof v !== 'number' || isNaN(v) || v < 0) return 0;
		return Math.round(v);
	}

	/* 大数字显示: 1e18 照原样写成一长串(和参考图一样), 再大才转科学计数法 */
	function fbNum(v) {
		if (typeof v !== 'number') return '0';
		if (isNaN(v)) return '?';
		if (!isFinite(v)) return v > 0 ? '∞' : '-∞';
		if (v === Math.round(v) && Math.abs(v) < 1e21) return String(v);
		if (Math.abs(v) >= 1e21) return v.toExponential(2).replace('e+', 'e');
		return String(Math.round(v * 100) / 100);
	}

	function fbClock(sec) {
		return (sec || 0).toFixed(2) + 's';
	}

	/* HUD 那一列很窄: 精确写法超过 11 个字符就折成 3 位有效数字的指数写法。
	   结算面板里给的仍然是精确值(那是"总输出伤害"要交代的地方), 这里只是别撑破侧栏。 */
	function fbShort(v) {
		var exact = fbNum(v);
		if (exact.length <= 11 || !isFinite(v)) return exact;
		return v.toExponential(2).replace('e+', 'e');
	}

	/* 占位符 {name} 的兜底替换: i18n 还没加载时, 默认文案也要能填上数字 */
	function fbFill(tpl, params) {
		tpl = String(tpl == null ? '' : tpl);
		if (!params) return tpl;
		var out = '';
		var i = 0;
		while (i < tpl.length) {
			if (tpl.charAt(i) === '{') {
				var j = tpl.indexOf('}', i + 1);
				if (j > i) {
					var key = tpl.slice(i + 1, j);
					out += params[key] == null ? tpl.slice(i, j + 1) : String(params[key]);
					i = j + 1;
					continue;
				}
			}
			out += tpl.charAt(i);
			i++;
		}
		return out;
	}

	function fbT(key, fallback, params) {
		var i18n = global.i18n;
		var text = i18n && i18n.t ? i18n.t(key, params) : null;
		return text || fbFill(fallback, params);
	}

	/* ------------------------------------------------------------ 砖墙与世界 */

	function fbRowsFrom(wall) {
		var rows = [];
		for (var i = 0; i < wall.layers; i++) {
			var hp = wall.hp;
			for (var k = 0; k < i; k++) {
				hp *= wall.growth;
				if (hp > FB_HP_MAX) { hp = FB_HP_MAX; break; }
			}
			hp = Math.max(1, Math.round(hp));
			var bricks = [];
			for (var j = 0; j < wall.perRow; j++) {
				bricks.push({ col: j, hp: hp, max: hp, broken: false });
			}
			rows.push({ max: hp, bricks: bricks });
		}
		return rows;
	}

	function fbMakeWorld(wall, lanes) {
		return {
			wall: wall,
			time: 0,
			winner: -1,
			lanes: lanes.map(function (spec, i) {
				return {
					i: i,
					ast: spec.ast,
					expr: spec.expr,
					glyph: spec.glyph,
					x: spec.x0,
					step: spec.step,
					hits: 0,
					damage: 0,
					rows: fbRowsFrom(wall),
					trail: [],
					floats: [],
					log: [],
					done: false,
					time: 0,
					ball: { x: 0, y: 0, vy: 0, placed: false }
				};
			})
		};
	}

	/* 当前该打哪一层: 第一个还有砖的层(全碎完就是 -1 = 到底了) */
	function fbCurrentRow(lane) {
		for (var i = 0; i < lane.rows.length; i++) {
			var row = lane.rows[i];
			for (var j = 0; j < row.bricks.length; j++) if (!row.bricks[j].broken) return i;
		}
		return -1;
	}

	function fbBricksLeft(lane) {
		var n = 0;
		for (var i = 0; i < lane.rows.length; i++) {
			for (var j = 0; j < lane.rows[i].bricks.length; j++) if (!lane.rows[i].bricks[j].broken) n++;
		}
		return n;
	}

	/* 还没碎的最左边那一块 —— 球就打在它正上方 */
	function fbTargetBrick(lane) {
		var i = fbCurrentRow(lane);
		if (i < 0) return null;
		var bricks = lane.rows[i].bricks;
		for (var j = 0; j < bricks.length; j++) if (!bricks[j].broken) return bricks[j];
		return null;
	}

	function fbBrickX(geo, laneIdx, col) {
		return geo.laneX[laneIdx] + geo.padX + col * (geo.brickW + geo.gap);
	}

	function fbBrickCx(geo, laneIdx, col) {
		return fbBrickX(geo, laneIdx, col) + geo.brickW / 2;
	}

	/* 没有活砖 = 没有目标(null): 这时候球保持自己的横坐标直着落下去,
	   而不是被"拉回场地中心" —— 打碎最后一块的瞬间往回滑一格看起来像穿模 */
	function fbTargetX(lane, geo) {
		var brick = fbTargetBrick(lane);
		return brick ? fbBrickCx(geo, lane.i, brick.col) : null;
	}

	function fbLaneCenterX(lane, geo) {
		return geo.laneX[lane.i] + geo.laneW / 2;
	}

	/**
	 * 场地几何: 一道竖挡板把画布劈成左右两块, 砖墙堆在最下面(第 0 层在最上面,
	 * 也就是最先被打掉的那一层), 球在砖墙上方来回弹。
	 * 砖块高度按层数反推, 所以层数从 1 改到 8 都不会溢出画布。
	 */
	function fbGeometry(w, h, wall) {
		var div = Math.max(4, Math.round(w * 0.009));
		var laneW = (w - div) / 2;
		var padX = Math.max(5, Math.round(laneW * 0.03));
		var gap = Math.max(3, Math.round(h * 0.008));
		var padBottom = Math.max(6, Math.round(h * 0.018));
		var brickH = (h * 0.54 - (wall.layers - 1) * gap - padBottom) / wall.layers;
		brickH = Math.max(14, Math.min(46, brickH));
		var stackH = wall.layers * brickH + (wall.layers - 1) * gap;
		var stackTop = h - padBottom - stackH;
		var rowTop = [];
		for (var i = 0; i < wall.layers; i++) rowTop.push(stackTop + i * (brickH + gap));
		var brickW = (laneW - padX * 2 - (wall.perRow - 1) * gap) / wall.perRow;
		return {
			w: w, h: h, div: div, laneW: laneW, laneX: [0, laneW + div],
			padX: padX, gap: gap, brickH: brickH, brickW: brickW, rowTop: rowTop,
			stackTop: stackTop, floorY: h - padBottom,
			r: Math.max(9, Math.min(20, Math.min(laneW * 0.062, brickH * 0.52))),
			bounce: FB_BOUNCE
		};
	}

	function fbSurfaceY(lane, geo) {
		var i = fbCurrentRow(lane);
		if (i < 0) return geo.floorY;
		var top = geo.rowTop[i];
		/* 兜底: 世界与几何万一对不上(改了层数却还没重算), 宁可让球踩到地面,
		   也不能让它对着 undefined 一直往下掉、掉出画布 */
		return typeof top === 'number' && isFinite(top) ? top : geo.floorY;
	}

	function fbApplyHit(world, lane, geo) {
		var ri = fbCurrentRow(lane);
		var brick = fbTargetBrick(lane);
		if (!brick) return;
		var dmg = fbDamage(lane.ast, lane.x);
		brick.hp -= dmg;
		lane.damage += dmg;
		lane.hits++;
		lane.floats.push({ x: fbBrickCx(geo, lane.i, brick.col), y: ri < 0 ? geo.floorY : geo.rowTop[ri], text: fbNum(dmg), age: 0 });
		if (lane.floats.length > 12) lane.floats.shift();
		lane.log.push({ x: lane.x, dmg: dmg, hp: brick.hp });
		if (brick.hp < 0) brick.broken = true;
		lane.x = Math.min(FB_X_MAX, lane.x + lane.step);
	}

	/**
	 * 推进一步(纯逻辑, 不碰画布)。两个关键点:
	 *   1. 反弹速度由 sqrt(2*g*h) 反推 —— 不管重力多少, 每次弹起的高度都正好是 h;
	 *   2. 只有"正在下落、并且碰到当前那层顶面"才算一次命中; 那一层清空后, 顶面自己往下走一层。
	 * 谁先落到地面(没有下一层了)谁就赢, 另一方的进度原地冻结。
	 */
	function fbStepWorld(world, dt, geo) {
		for (var i = 0; i < world.lanes.length; i++) {
			var lane = world.lanes[i];
			if (lane.done) continue;
			var b = lane.ball;
			if (!b.placed) {
				b.placed = true;
				var startX = fbTargetX(lane, geo);
				b.x = startX == null ? fbLaneCenterX(lane, geo) : startX;
				b.y = Math.max(geo.r + 2, 4);
				b.vy = 0;
			}
			b.vy += FB_GRAVITY * dt;
			b.y += b.vy * dt;
			var surf = fbSurfaceY(lane, geo);
			if (b.vy > 0 && b.y + geo.r >= surf) {
				b.y = surf - geo.r;
				if (fbCurrentRow(lane) < 0) {
					lane.done = true;
					lane.time = world.time + dt;
					if (world.winner < 0) world.winner = lane.i;
					continue;
				}
				var h = geo.bounce;
				var cap = Math.max(6, surf - geo.r - 2);
				if (h > cap) h = cap;
				b.vy = -Math.sqrt(2 * FB_GRAVITY * h);
				fbApplyHit(world, lane, geo);
			}
			var tx = fbTargetX(lane, geo);
			if (tx != null) b.x += (tx - b.x) * Math.min(1, dt / 0.085);
			lane.trail.push({ x: b.x, y: b.y });
			if (lane.trail.length > FB_TRAIL) lane.trail.shift();
			for (var f = lane.floats.length - 1; f >= 0; f--) {
				lane.floats[f].age += dt;
				if (lane.floats[f].age > 0.85) lane.floats.splice(f, 1);
			}
		}
		world.time += dt;
	}

	function fbRoundRect(c, x, y, w, h, r) {
		r = Math.max(0, Math.min(r, w / 2, h / 2));
		c.beginPath();
		c.moveTo(x + r, y);
		c.lineTo(x + w - r, y);
		c.arcTo(x + w, y, x + w, y + r, r);
		c.lineTo(x + w, y + h - r);
		c.arcTo(x + w, y + h, x + w - r, y + h, r);
		c.lineTo(x + r, y + h);
		c.arcTo(x, y + h, x, y + h - r, r);
		c.lineTo(x, y + r);
		c.arcTo(x, y, x + r, y, r);
		c.closePath();
	}

	function fbVar(name, fallback) {
		try {
			var v = global.getComputedStyle(doc.documentElement).getPropertyValue(name);
			v = v ? v.trim() : '';
			return v || fallback;
		} catch (e) { return fallback; }
	}

	/* 主题色只在 data-theme 变化时重读一次(配色仍然跟着 tokens.css 走, 不另写一套) */
	function fbTheme() {
		var stamp = doc.documentElement.getAttribute('data-theme') || '';
		if (fbTheme.stamp === stamp && fbTheme.data) return fbTheme.data;
		fbTheme.stamp = stamp;
		fbTheme.data = {
			fg: fbVar('--fg', '#e6edf3'),
			dim: fbVar('--fg-faint', '#5d6b7a'),
			line: fbVar('--line-strong', 'rgba(230,237,243,0.26)'),
			lineSoft: fbVar('--line', 'rgba(230,237,243,0.12)'),
			bg: fbVar('--bg-0', '#04060a'),
			lane: [fbVar('--blue', '#4d9dff'), fbVar('--yellow', '#ffd24d')],
			warn: fbVar('--red', '#ff4d5a')
		};
		return fbTheme.data;
	}
	fbTheme.stamp = null;
	fbTheme.data = null;

	/* 模板: 页面上"函数模板"下拉里的五项, 也是 f(x) 的一键示例 */
	var FB_TEMPLATES = {
		fact: { glyph: 'n!', expr: 'x!', x0: 0, step: 1 },
		percent: { glyph: '%', expr: '10 * 1.35^x', x0: 46, step: 1 },
		power: { glyph: 'xⁿ', expr: 'x^2', x0: 2, step: 1 },
		fib: { glyph: 'Fₙ', expr: 'fib(x)', x0: 1, step: 1 },
		custom: { glyph: 'f(x)', expr: 'x', x0: 0, step: 1 }
	};

	function fbGlyphFor(expr) {
		var trimmed = String(expr || '').trim();
		for (var id in FB_TEMPLATES) {
			if (Object.prototype.hasOwnProperty.call(FB_TEMPLATES, id) && id !== 'custom') {
				if (FB_TEMPLATES[id].expr === trimmed) return FB_TEMPLATES[id].glyph;
			}
		}
		if (!trimmed) return 'f(x)';
		return trimmed.length <= 4 ? trimmed : trimmed.slice(0, 3) + '…';
	}


	/**
	 * 函数球打砖块的机台控制器。对外接口与另外两台一致
	 * (start / pause / reset / setFlags / resize / state / debug / scrollTo / destroy),
	 * 所以挂载、路由、终端、dock 都不用为它破例。
	 */
	function createFuncBall(cab, opt) {
		opt = opt || {};
		var canvas = cab.querySelector('[data-fb-canvas]');
		if (!canvas || !canvas.getContext) return null;
		var ctx = canvas.getContext('2d');

		var overlay = cab.querySelector('[data-fb-overlay]');
		var ovTitle = cab.querySelector('[data-fb-ov-title]');
		var ovHint = cab.querySelector('[data-fb-ov-hint]');
		var elTime = cab.querySelector('[data-fb-time]');
		var elDmgA = cab.querySelector('[data-fb-dmg-a]');
		var elDmgB = cab.querySelector('[data-fb-dmg-b]');
		var elBricks = cab.querySelector('[data-fb-bricks]');
		var elState = cab.querySelector('[data-game-state]');
		var btnStart = cab.querySelector('[data-fb-action="start"]');
		var btnPause = cab.querySelector('[data-fb-action="pause"]');
		var btnRestart = cab.querySelector('[data-fb-action="restart"]');
		var flagsBox = cab.querySelector('[data-game-flags]');
		var flagPanel = cab.parentNode ? cab.parentNode.querySelector('[data-game-flags-panel]') : null;
		var flagChips = flagPanel ? flagPanel.querySelectorAll('[data-flag]') : [];
		var setup = cab.querySelector('.fb-setup');
		var bounceOut = cab.querySelector('[data-fb-bounce-out]');
		var fields = {
			layers: cab.querySelector('[data-fb-layers]'),
			perRow: cab.querySelector('[data-fb-per-row]'),
			hp: cab.querySelector('[data-fb-hp]'),
			growth: cab.querySelector('[data-fb-growth]'),
			bounce: cab.querySelector('[data-fb-bounce]')
		};
		var laneUi = [0, 1].map(function (i) {
			var el = cab.querySelector('[data-fb-lane="' + i + '"]');
			return {
				el: el,
				tpl: el.querySelector('[data-fb-template]'),
				expr: el.querySelector('[data-fb-expr]'),
				x0: el.querySelector('[data-fb-x0]'),
				step: el.querySelector('[data-fb-step]'),
				tag: el.querySelector('[data-fb-tag]'),
				err: el.querySelector('[data-fb-err]')
			};
		});

		var st = 'ready';           /* ready | running | paused | over */
		var world = null;
		var cssW = 640;
		var cssH = 456;
		var geo = fbGeometry(640, 456, { layers: 3, perRow: 1, hp: 1000, growth: 1000 });
		var acc = 0;
		var raf = 0;
		var last = 0;
		var destroyed = false;
		var observer = null;
		var hudAt = 0;
		var growthSaved = null;
		var holdTimer = null;
		var holdBtn = null;
		var overTime = 0;

		/* ---- 读输入 ---- */

		/* writeBack=false 时不回写输入框: 用户在打字, 每敲一下就抹掉重写太闹心 */
		function readInt(el, min, max, dflt, writeBack) {
			var v = el ? parseFloat(el.value) : NaN;
			if (!isFinite(v)) v = dflt;
			v = Math.round(v);
			if (v < min) v = min;
			if (v > max) v = max;
			if (el && writeBack) el.value = String(v);
			return v;
		}

		function readWall(writeBack) {
			return {
				layers: readInt(fields.layers, 1, 8, 3, writeBack),
				perRow: readInt(fields.perRow, 1, 6, 1, writeBack),
				hp: readInt(fields.hp, 1, FB_HP_MAX, 1000, writeBack),
				growth: readInt(fields.growth, 1, 1e12, 1000, writeBack)
			};
		}

		function bounceBase() {
			return readInt(fields.bounce, FB_BOUNCE_MIN, FB_BOUNCE_MAX, FB_BOUNCE, false);
		}

		function effectiveBounce() {
			return Math.max(6, bounceBase() * (opt.slow ? FB_BOUNCE_SLOW : 1));
		}

		function bounceLabel() {
			var base = bounceBase();
			return opt.slow ? base + ' ×2 = ' + (base * FB_BOUNCE_SLOW) : String(base);
		}

		/**
		 * 把界面上的输入读成一颗世界。两边表达式都解析成功才返回世界,
		 * 否则在各自那一栏下面标出解析器给的原话(英文)—— 这也是"开始对决"按不下去的原因。
		 */
		function buildWorld(writeBack) {
			var wall = readWall(writeBack);
			var lanes = [];
			var ok = true;
			for (var i = 0; i < 2; i++) {
				var ui = laneUi[i];
				var expr = String(ui.expr.value || '').trim();
				var ast = null;
				var err = '';
				try { ast = fbParse(expr); } catch (e) { err = e.message || 'error'; }
				if (ui.err) {
					ui.err.hidden = !err;
					ui.err.textContent = err ? fbT('games.funcball.exprError', 'f(x) cannot be read') + ' — ' + err : '';
				}
				if (ui.tag) ui.tag.textContent = fbGlyphFor(expr);
				if (err) { ok = false; continue; }
				lanes.push({
					ast: ast,
					expr: expr,
					glyph: fbGlyphFor(expr),
					x0: readInt(ui.x0, 0, 400, FB_TEMPLATES.fact.x0, writeBack),
					step: readInt(ui.step, 1, 20, 1, writeBack)
				});
			}
			if (!ok) return null;
			return fbMakeWorld(wall, lanes);
		}

		/* 球停在这一次弹跳的最高点(改参数 / 改窗口大小时用, 免得球卡在砖里) */
		function reseat() {
			if (!world) return;
			for (var i = 0; i < world.lanes.length; i++) {
				var lane = world.lanes[i];
				var surf = fbSurfaceY(lane, geo);
				lane.ball.placed = true;
				var rx = fbTargetX(lane, geo);
				lane.ball.x = rx == null ? fbLaneCenterX(lane, geo) : rx;
				lane.ball.y = Math.max(geo.r + 2, surf - geo.r - geo.bounce);
				lane.ball.vy = 0;
				lane.trail.length = 0;
				lane.floats.length = 0;
			}
		}

		/* 还没开跑时, 参数一动就把场地重画一遍(这就是"预览") */
		function preview() {
			refreshGeo();
			acc = 0;
			world = buildWorld(false);
			if (world) reseat();
			draw();
			updateHud(true);
		}

		/**
		 * 重算场地几何。层数 / 每层砖块数 / 弹跳高度都会改几何(砖块高度、每一层的顶边、砖宽),
		 * 所以这几个输入一动就必须重算 —— 只重建 world 而不重算 geo 的话,
		 * geo.rowTop 还是按旧层数算的: 深出来的那几层画不出来, 球碰到 undefined 的顶面
		 * 会一直往下掉, 直接掉出画布(用户报的"打完看得见的砖就飞出去了"就是这个)。
		 */
		function refreshGeo() {
			geo = fbGeometry(cssW, cssH, readWall(false));
			geo.bounce = effectiveBounce();
		}

		/*
		 * 改了参数(表达式 / 砖墙 / 标志位)之后怎么收场:
		 *   ready          就地重画预览(球停到新的最高点);
		 *   over           用户其实是要开新的一局了 —— 回到 ready, 免得结算面板留着旧数字;
		 *   running/paused 输入框是锁着的, 走不到这里。
		 */
		function afterEdit() {
			if (st === 'over') reset();
			else if (st !== 'running' && st !== 'paused') preview();
		}

		/* ---- 尺寸 ---- */

		function resize() {
			var dpr = Math.min(global.devicePixelRatio || 1, 2);
			var w = canvas.clientWidth;
			var h = canvas.clientHeight;
			if (w && h) {
				canvas.width = Math.max(1, Math.round(w * dpr));
				canvas.height = Math.max(1, Math.round(h * dpr));
				cssW = w;
				cssH = h;
			}
			refreshGeo();
			if (!world) world = buildWorld(false);
			reseat();
			draw();
		}

		/* ---- 画 ---- */

		function setFont(px, weight) {
			ctx.font = (weight ? weight + ' ' : '') + px + 'px ' + FB_FONT;
		}

		function fitFont(text, maxW, startPx, weight) {
			var px = startPx;
			for (var i = 0; i < 20; i++) {
				setFont(px, weight);
				if (ctx.measureText(text).width <= maxW || px <= 6) break;
				px = Math.max(6, px - Math.max(0.5, px * 0.09));
			}
			return px;
		}

		function ellipsize(text, maxW, px, weight) {
			setFont(px, weight);
			if (ctx.measureText(text).width <= maxW) return text;
			var cut = String(text);
			while (cut.length > 1 && ctx.measureText(cut + '…').width > maxW) cut = cut.slice(0, cut.length - 1);
			return cut + '…';
		}

		function drawBrick(lane, rowIdx, brick, theme) {
			var x = fbBrickX(geo, lane.i, brick.col);
			var y = geo.rowTop[rowIdx];
			var w = geo.brickW;
			var h = geo.brickH;
			var color = theme.lane[lane.i];
			var frac = Math.max(0, Math.min(1, brick.hp / brick.max));

			ctx.save();
			fbRoundRect(ctx, x, y, w, h, Math.min(6, h * 0.24));
			ctx.globalAlpha = 0.1 + 0.2 * frac;
			ctx.fillStyle = color;
			ctx.fill();
			ctx.globalAlpha = 0.6;
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = color;
			ctx.stroke();
			/* 底边一条余量条: 一眼看出这块还剩多少 */
			ctx.globalAlpha = 0.72;
			ctx.fillStyle = color;
			ctx.fillRect(x + 1.5, y + h - 3.5, Math.max(0, (w - 3) * frac), 2);
			/* 大数字就是它剩下的生命值(参考图里那排数字) */
			ctx.globalAlpha = 1;
			ctx.fillStyle = theme.fg;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			var text = fbNum(brick.hp);
			setFont(fitFont(text, w - 8, Math.min(h * 0.66, w * 0.5), '600'), '600');
			ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
			ctx.restore();
		}

		function drawLane(lane, theme) {
			var color = theme.lane[lane.i];
			var left = geo.laneX[lane.i];
			ctx.save();
			ctx.beginPath();
			ctx.rect(left, 0, geo.laneW, cssH);
			ctx.clip();

			/* 顶上: 这一方的 f(x) / 当前 x / 命中次数 */
			var labelPx = Math.max(10, Math.min(13, geo.laneW * 0.042));
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			ctx.globalAlpha = 0.95;
			ctx.fillStyle = color;
			setFont(labelPx, '600');
			ctx.fillText(ellipsize('f(x) = ' + lane.expr, geo.laneW - geo.padX * 2 - geo.laneW * 0.3, labelPx, '600'), left + geo.padX, 9);
			ctx.textAlign = 'right';
			setFont(labelPx + 2, '700');
			ctx.fillText(fbT('games.funcball.chipX', 'x = {x}', { x: fbNum(lane.x) }), left + geo.laneW - geo.padX, 8);
			ctx.textAlign = 'left';
			ctx.globalAlpha = 0.62;
			ctx.fillStyle = theme.dim;
			setFont(Math.max(9, labelPx - 1.5), '500');
			ctx.fillText(fbT('games.funcball.chipHits', '{n} hits', { n: String(lane.hits) }), left + geo.padX, 10 + labelPx + 4);
			ctx.globalAlpha = 1;

			var r, j;
			for (r = 0; r < lane.rows.length && r < geo.rowTop.length; r++) {
				for (j = 0; j < lane.rows[r].bricks.length; j++) {
					if (lane.rows[r].bricks[j].broken) continue;
					drawBrick(lane, r, lane.rows[r].bricks[j], theme);
				}
			}

			/* 拖尾 —— 一列由暗到亮的圆, 越靠近球越大越实(参考图里那道拖影) */
			var b = lane.ball;
			var n = lane.trail.length;
			for (var t = 0; t < n; t++) {
				var p = lane.trail[t];
				var k = (t + 1) / n;
				ctx.globalAlpha = 0.05 + 0.3 * k * k;
				ctx.fillStyle = color;
				ctx.beginPath();
				ctx.arc(p.x, p.y, geo.r * (0.34 + 0.62 * k), 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
			ctx.beginPath();
			ctx.arc(b.x, b.y, geo.r, 0, Math.PI * 2);
			ctx.fillStyle = color;
			ctx.fill();
			ctx.beginPath();
			ctx.arc(b.x, b.y, geo.r * 0.66, 0, Math.PI * 2);
			ctx.fillStyle = theme.fg;
			ctx.fill();
			var glyph = lane.glyph || 'f(x)';
			ctx.fillStyle = theme.bg;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			setFont(fitFont(glyph, geo.r * 1.24, geo.r * 0.92, '700'), '700');
			ctx.fillText(glyph, b.x, b.y + 0.5);

			/* 上浮的伤害数字 */
			ctx.textAlign = 'center';
			ctx.textBaseline = 'bottom';
			for (var f = 0; f < lane.floats.length; f++) {
				var fl = lane.floats[f];
				var life = Math.max(0, 1 - fl.age / 0.85);
				ctx.globalAlpha = Math.min(1, life * 1.5);
				ctx.fillStyle = color;
				setFont(fitFont(fl.text, geo.laneW * 0.72, Math.min(geo.brickH * 0.72, geo.laneW * 0.22), '700'), '700');
				ctx.fillText(fl.text, fl.x, fl.y - 3 - (1 - life) * 26);
			}
			ctx.globalAlpha = 1;
			ctx.restore();
		}

		function drawEmpty(theme) {
			ctx.fillStyle = theme.dim;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			setFont(Math.max(11, Math.min(15, cssW * 0.026)), '600');
			ctx.fillText(fbT('games.funcball.exprError', 'f(x) cannot be read'), cssW / 2, cssH / 2);
		}

		function draw() {
			if (!ctx || !canvas.width || !cssW || !geo) return;
			var theme = fbTheme();
			ctx.save();
			ctx.setTransform(canvas.width / cssW, 0, 0, canvas.height / cssH, 0, 0);
			ctx.clearRect(0, 0, cssW, cssH);
			/* 中间的挡板 */
			ctx.fillStyle = theme.line;
			ctx.fillRect(geo.laneW, 0, geo.div, cssH);
			if (world) {
				for (var i = 0; i < world.lanes.length; i++) drawLane(world.lanes[i], theme);
			} else {
				drawEmpty(theme);
			}
			/* 结束: 输的那边压暗, 赢的那边描一圈 */
			if (st === 'over' && world && world.winner >= 0) {
				var loser = 1 - world.winner;
				ctx.globalAlpha = 0.45;
				ctx.fillStyle = theme.bg;
				ctx.fillRect(geo.laneX[loser], 0, geo.laneW, cssH);
				ctx.globalAlpha = 1;
				ctx.strokeStyle = theme.lane[world.winner];
				ctx.lineWidth = 3;
				ctx.strokeRect(geo.laneX[world.winner] + 1.5, 1.5, geo.laneW - 3, cssH - 3);
			}
			ctx.restore();
		}

		/* ---- HUD / 状态 ---- */

		function updateHud(force) {
			var now = 0;
			try { now = Date.now(); } catch (e) { now = 0; }
			if (!force && now - hudAt < 100) return;
			hudAt = now;
			var a = world ? world.lanes[0] : null;
			var b = world ? world.lanes[1] : null;
			if (elTime) elTime.textContent = fbClock(st === 'over' ? overTime : (world ? world.time : 0));
			if (elDmgA) elDmgA.textContent = fbShort(a ? a.damage : 0);
			if (elDmgB) elDmgB.textContent = fbShort(b ? b.damage : 0);
			if (elBricks) elBricks.textContent = String((a ? fbBricksLeft(a) : 0) + (b ? fbBricksLeft(b) : 0));
		}

		function sync() {
			if (elState) elState.textContent = stateText(st);
			if (btnStart) btnStart.disabled = (st === 'running' || st === 'paused');
			if (btnPause) {
				btnPause.textContent = st === 'paused' ? t('games.btn.resume', 'Resume') : t('games.btn.pause', 'Pause');
				btnPause.disabled = (st !== 'running' && st !== 'paused');
			}
		}

		/* 界面上的"锁": 开跑之后函数与砖墙参数都不能改, 免得两边看的不是同一堵墙 */
		function setLocked(on) {
			if (!setup) return;
			var els = setup.querySelectorAll('input, select');
			Array.prototype.forEach.call(els, function (el) {
				if (on) el.disabled = true;
				else el.disabled = !!(el === fields.growth && opt.easy);
			});
		}

		function showOverlay(title, hint) {
			if (ovTitle) ovTitle.textContent = title;
			if (ovHint) ovHint.textContent = hint;
			if (overlay) overlay.classList.add('is-shown');
		}

		function hideOverlay() {
			if (overlay) overlay.classList.remove('is-shown');
		}

		function showResult() {
			if (!world || world.winner < 0) return;
			var w = world.winner;
			var a = world.lanes[0];
			var b = world.lanes[1];
			var winText = w === 0
				? fbT('games.funcball.win.a', 'Ball A wins!')
				: fbT('games.funcball.win.b', 'Ball B wins!');
			var lines = [];
			lines.push(fbT('games.funcball.overTime', 'Time {time}', { time: fbClock(overTime) }));
			lines.push(fbT('games.funcball.overDamage', 'A: {a} damage in {an} hits · B: {b} damage in {bn} hits', {
				a: fbNum(a.damage), an: String(a.hits), b: fbNum(b.damage), bn: String(b.hits)
			}));
			lines.push(fbT('games.funcball.againHint', 'Press Start duel to run again with these settings - hold Restart to go back and edit them'));
			showOverlay(fbT('games.funcball.overTitle', 'Duel over') + ' · ' + winText, lines.join(String.fromCharCode(10)));
		}

		/* ---- 流程 ---- */

		function start() {
			if (st === 'running') return;
			var next = buildWorld(true);
			if (!next) { afterEdit(); return; }
			world = next;
			refreshGeo();   /* buildWorld(true) 已经把输入回写成夹紧后的值, 几何照它算 */
			acc = 0;
			overTime = 0;
			st = 'running';
			setLocked(true);
			hideOverlay();
			/* 球从场地最上面落下 —— 交给 fbStepWorld 放第一颗(placed=false) */
			if (world) {
				for (var i = 0; i < world.lanes.length; i++) {
					world.lanes[i].ball.placed = false;
					world.lanes[i].trail.length = 0;
					world.lanes[i].floats.length = 0;
				}
			}
			sync();
			updateHud(true);
			draw();
			ensureLoop();
		}

		function pause() {
			if (st !== 'running') return;
			st = 'paused';
			showOverlay(fbT('games.overlay.pausedTitle', 'Paused'), fbT('games.funcball.pausedHint', 'Press P or Esc to resume - hold Restart to go back and edit the setup'));
			sync();
			draw();
		}

		function resume() {
			if (st !== 'paused') return;
			st = 'running';
			last = 0;
			hideOverlay();
			sync();
		}

		function reset() {
			st = 'ready';
			acc = 0;
			overTime = 0;
			setLocked(false);
			refreshGeo();
			world = buildWorld(false);
			if (world) reseat();
			showOverlay(fbT('games.funcball.readyTitle', 'FUNCTION BALL'), fbT('games.funcball.readyHint', 'Set both functions, then press Start duel'));
			sync();
			updateHud(true);
			draw();
		}

		/**
		 * 长按「重开」= 回到 ready, 不是"立刻又开一局"。
		 * 这台机台的参数只在 ready 能改, 一开局就锁上 —— 所以重开必须把编辑权还回来:
		 * 重置砖墙 / 球 / 计时, 解锁参数面板, 等用户按「开始对决」。
		 * (俄罗斯方块与 Block Blast 没有需要预设置的参数, 它们的长按重开就是直接重开一局,
		 *  那是有意为之 —— 见 README「重新游玩要长按」。)
		 */
		function doRestart() {
			reset();
		}

		function togglePause() {
			if (st === 'running') pause();
			else if (st === 'paused') resume();
		}

		function endDuel() {
			st = 'over';
			overTime = world ? world.time : 0;
			/* 结算不是死路: 参数在这里就解锁, 改完直接按「开始对决」就是新一局 */
			setLocked(false);
			showResult();
			sync();
			updateHud(true);
			draw();
		}

		function advance(dtMs) {
			acc += dtMs;
			var guard = 0;
			while (world && acc >= FB_STEP_MS && guard < 200) {
				fbStepWorld(world, FB_STEP_MS / 1000, geo);
				acc -= FB_STEP_MS;
				guard++;
				if (world.winner >= 0) break;
			}
			if (acc > 500) acc = 0;   /* 卡顿一下之后不要把欠的步数一次性补完 */
			if (world && world.winner >= 0 && st === 'running') endDuel();
		}

		/* ---- 主循环 ---- */

		function frame(now) {
			if (destroyed) return;
			if (!canvas.isConnected) { destroy(); return; }
			raf = global.requestAnimationFrame(frame);
			if (!last) { last = now; return; }
			var dt = Math.min(now - last, 120);
			last = now;
			if (st === 'running' && world) advance(dt);
			updateHud(false);
			draw();
		}

		function ensureLoop() {
			if (raf || destroyed) return;
			last = 0;
			raf = global.requestAnimationFrame(frame);
		}

		function stopLoop() {
			if (!raf) return;
			global.cancelAnimationFrame(raf);
			raf = 0;
		}

		/* ---- 输入 ---- */

		function actionTarget(e) {
			return e.target && e.target.closest ? e.target.closest('[data-fb-action]') : null;
		}

		function beginHold(btn) {
			if (destroyed || holdTimer) return;
			holdBtn = btn;
			if (btn) btn.classList.add('is-holding');
			holdTimer = global.setTimeout(function () {
				holdTimer = null;
				var el = holdBtn;
				holdBtn = null;
				if (el) {
					el.classList.remove('is-holding');
					el.classList.add('is-done');
					global.setTimeout(function () { el.classList.remove('is-done'); }, 420);
				}
				doRestart();
			}, FB_HOLD_RESTART_MS);
		}

		function endHold() {
			if (holdTimer) {
				global.clearTimeout(holdTimer);
				holdTimer = null;
			}
			if (holdBtn) {
				holdBtn.classList.remove('is-holding');
				holdBtn = null;
			}
		}

		function onPointerDown(e) {
			if (destroyed) return;
			var btn = actionTarget(e);
			if (btn && btn.getAttribute('data-fb-action') === 'restart') {
				e.preventDefault();
				beginHold(btn);
			}
		}

		function onPointerUp() {
			endHold();
		}

		function onClick(e) {
			if (destroyed) return;
			var el = actionTarget(e);
			if (!el) return;
			var act = el.getAttribute('data-fb-action');
			if (act === 'start') start();
			else if (act === 'pause') togglePause();
			else if (act === 'restart') {
				/* 指针那条路走 pointerdown/up; 这里只接键盘 —— 键盘触发的 click 里 detail 为 0 */
				if (e.detail === 0) doRestart();
			}
		}

		function overlayClick() {
			if (st === 'running') pause();
			else if (st === 'paused') resume();
			else start();
		}

		function inField(e) {
			var tag = e.target && e.target.tagName ? e.target.tagName : '';
			return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
		}

		function onKeyDown(e) {
			if (destroyed || e.defaultPrevented) return;
			var k = e.key;
			if (inField(e)) return;             /* 在输入框里打字时不抢按键 */
			if (k === ' ' || k === 'Spacebar') {
				e.preventDefault();
				if (st === 'running') pause();
				else if (st === 'paused') resume();
				else start();
			} else if (k === 'p' || k === 'P' || k === 'Escape') {
				e.preventDefault();
				togglePause();
			} else if (k === 'r' || k === 'R') {
				beginHold(btnRestart);
			}
		}

		function onKeyUp(e) {
			if (e.key === 'r' || e.key === 'R') endHold();
		}

		function onVisibility() {
			if (doc.hidden && st === 'running') pause();
		}

		function onI18n() {
			renderFlags();
			if (st === 'over') showResult();
			else if (st === 'paused') showOverlay(fbT('games.overlay.pausedTitle', 'Paused'), fbT('games.overlay.pausedHint', 'Press P or Esc to resume'));
			else if (st === 'ready') showOverlay(fbT('games.funcball.readyTitle', 'FUNCTION BALL'), fbT('games.funcball.readyHint', 'Set both functions, then press Start duel'));
			sync();
		}

		function onSetupInput(e) {
			if (bounceOut) bounceOut.textContent = bounceLabel();
			if (e && e.target === fields.bounce) geo.bounce = effectiveBounce();
			afterEdit();
		}

		/* 换模板 = 把这一栏的三个输入一起填好; "自定义"只改牌子, 表达式不动 */
		function onTemplateChange(i) {
			var ui = laneUi[i];
			var id = ui.tpl ? ui.tpl.value : '';
			var tpl = FB_TEMPLATES[id];
			if (!tpl || !ui.expr) return;
			if (id !== 'custom') {
				ui.expr.value = tpl.expr;
				if (ui.x0) ui.x0.value = String(tpl.x0);
				if (ui.step) ui.step.value = String(tpl.step);
			}
			if (ui.tag) ui.tag.textContent = fbGlyphFor(ui.expr.value);
			afterEdit();
		}

		/* 手动改表达式 -> 下拉跳到"自定义" */
		function onExprInput(i) {
			var ui = laneUi[i];
			var val = String(ui.expr.value || '').trim();
			if (ui.tpl && ui.tpl.value !== 'custom') {
				for (var id in FB_TEMPLATES) {
					if (id !== 'custom' && FB_TEMPLATES[id].expr === val && ui.tpl.value !== id) ui.tpl.value = id;
				}
				var known = false;
				for (var id2 in FB_TEMPLATES) {
					if (id2 !== 'custom' && FB_TEMPLATES[id2].expr === val) known = true;
				}
				if (!known) ui.tpl.value = 'custom';
			}
			if (ui.tag) ui.tag.textContent = fbGlyphFor(val);
			afterEdit();
		}

		/* ---- 标志位 ---- */

		function updateFlagChips() {
			Array.prototype.forEach.call(flagChips, function (chip) {
				var name = chip.getAttribute('data-flag');
				var on = !!opt[name];
				chip.classList.toggle('is-on', on);
				chip.setAttribute('aria-pressed', on ? 'true' : 'false');
			});
		}

		function renderFlags() {
			if (!flagsBox) return;
			var chips = [];
			if (opt.easy) {
				chips.push('<span class="cabinet__flag cabinet__flag--easy" title="' +
					esc(t('games.funcball.flag.easyTip', '--easy-mode: no per-layer HP growth')) + '">' +
					esc(t('games.funcball.flag.easy', 'FLAT')) + '</span>');
			}
			if (opt.slow) {
				chips.push('<span class="cabinet__flag cabinet__flag--slow" title="' +
					esc(t('games.funcball.flag.slowTip', '--slow-motion: higher, slower bounces')) + '">' +
					esc(t('games.funcball.flag.slow', 'SLOW')) + '</span>');
			}
			flagsBox.innerHTML = chips.join('');
		}

		/* --easy-mode: 每层生命值不再翻倍 —— 把那个输入框压成 1 并禁掉, 免得看着像没生效 */
		function applyFlags() {
			if (opt.easy) {
				if (growthSaved === null && fields.growth) growthSaved = fields.growth.value;
				if (fields.growth) {
					fields.growth.value = '1';
					fields.growth.disabled = true;
				}
			} else if (growthSaved !== null) {
				if (fields.growth) {
					fields.growth.value = growthSaved;
					fields.growth.disabled = (st === 'running');
				}
				growthSaved = null;
			}
			geo.bounce = effectiveBounce();
			if (bounceOut) bounceOut.textContent = bounceLabel();
			updateFlagChips();
			renderFlags();
			afterEdit();
			draw();
		}

		function setFlags(next) {
			if (!next) return;
			if (typeof next.easy === 'boolean') opt.easy = next.easy;
			if (typeof next.slow === 'boolean') opt.slow = next.slow;
			applyFlags();
		}

		function toggleFlag(name) {
			if (name !== 'easy' && name !== 'slow') return;
			var next = { easy: opt.easy, slow: opt.slow };
			next[name] = !next[name];
			setFlags(next);
		}

		function onFlagClick(e) {
			var chip = e.target.closest ? e.target.closest('[data-flag]') : null;
			if (!chip) return;
			e.preventDefault();
			toggleFlag(chip.getAttribute('data-flag'));
		}

		/* ---- 挂载 / 卸载 ---- */

		cab.addEventListener('click', onClick);
		cab.addEventListener('pointerdown', onPointerDown);
		cab.addEventListener('pointerup', onPointerUp);
		cab.addEventListener('pointercancel', onPointerUp);
		cab.addEventListener('pointerleave', onPointerUp);
		cab.addEventListener('contextmenu', function (e) {
			if (e.target.closest && e.target.closest('[data-fb-action="restart"]')) e.preventDefault();
		});
		doc.addEventListener('pointerup', onPointerUp);
		if (overlay) overlay.addEventListener('click', overlayClick);
		if (setup) {
			setup.addEventListener('input', onSetupInput);
			setup.addEventListener('change', onSetupInput);
		}
		laneUi.forEach(function (ui, i) {
			if (ui.tpl) ui.tpl.addEventListener('change', function () { onTemplateChange(i); });
			if (ui.expr) ui.expr.addEventListener('input', function () { onExprInput(i); });
		});
		if (flagPanel) flagPanel.addEventListener('click', onFlagClick);
		doc.addEventListener('keydown', onKeyDown);
		doc.addEventListener('keyup', onKeyUp);
		doc.addEventListener('visibilitychange', onVisibility);
		doc.addEventListener('i18n:applied', onI18n);

		if (global.ResizeObserver) {
			observer = new global.ResizeObserver(function () { resize(); });
			observer.observe(canvas);
		} else {
			global.addEventListener('resize', resize);
		}

		function destroy() {
			if (destroyed) return;
			destroyed = true;
			stopLoop();
			if (observer) observer.disconnect();
			else global.removeEventListener('resize', resize);
			endHold();
			if (flagPanel) flagPanel.removeEventListener('click', onFlagClick);
			doc.removeEventListener('pointerup', onPointerUp);
			doc.removeEventListener('keydown', onKeyDown);
			doc.removeEventListener('keyup', onKeyUp);
			doc.removeEventListener('visibilitychange', onVisibility);
			doc.removeEventListener('i18n:applied', onI18n);
			delete cab.dataset.gameReady;
		}

		cab.dataset.gameReady = 'true';
		resize();
		applyFlags();     /* 牌子 / 面板开关 / 场地预览都按 opt 落一遍 */
		sync();

		return {
			start: start,
			pause: pause,
			reset: reset,
			setFlags: setFlags,
			resize: resize,
			state: function () { return st; },
			undo: function () { return false; },   /* 这台没有撤回: 对决是一路向前的 */
			/* 只读快照: 排查与自动化验证用(见控制台 Games.controller.debug()) */
			debug: debug,
			scrollTo: function () {
				if (!cab.scrollIntoView) return;
				var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
				cab.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
			},
			destroy: destroy
		};

		function debug() {
			var lane = function (l) {
				return {
					expr: l.expr,
					glyph: l.glyph,
					x: l.x,
					hits: l.hits,
					damage: l.damage,
					damageText: fbNum(l.damage),
					done: l.done,
					time: l.time,
					row: fbCurrentRow(l),
					bricksLeft: fbBricksLeft(l),
					hp: l.rows.map(function (row) {
						return row.bricks.map(function (br) { return br.broken ? 0 : br.hp; });
					}),
					ball: { x: Math.round(l.ball.x * 10) / 10, y: Math.round(l.ball.y * 10) / 10, placed: l.ball.placed },
					trail: l.trail.length,
					floats: l.floats.length
				};
			};
			return {
				game: 'funcball',
				state: st,
				time: st === 'over' ? overTime : (world ? world.time : 0),
				winner: world ? world.winner : -1,
				wall: world ? {
					layers: world.wall.layers, perRow: world.wall.perRow,
					hp: world.wall.hp, growth: world.wall.growth
				} : null,
				bounce: geo ? geo.bounce : 0,
				bounceBase: bounceBase(),
				easy: !!opt.easy,
				slow: !!opt.slow,
				locked: !!(fields.layers && fields.layers.disabled),
				growthDisabled: !!(fields.growth && fields.growth.disabled),
				overlayShown: !!(overlay && overlay.classList.contains('is-shown')),
				overlayTitle: ovTitle ? ovTitle.textContent : '',
				overlayHint: ovHint ? ovHint.textContent : '',
				canvas: { w: canvas.width, h: canvas.height, cssW: cssW, cssH: cssH },
				/* 几何整份给出来: 验证"改层数 / 每层砖块数之后场地有没有跟着重算"要用到它 */
				geo: geo ? {
					w: geo.w, h: geo.h, div: geo.div, laneW: Math.round(geo.laneW * 10) / 10, laneX: geo.laneX,
					padX: geo.padX, gap: geo.gap, brickH: Math.round(geo.brickH * 10) / 10,
					brickW: Math.round(geo.brickW * 100) / 100, rowTop: geo.rowTop,
					stackTop: Math.round(geo.stackTop * 10) / 10, floorY: geo.floorY,
					r: Math.round(geo.r * 10) / 10, bounce: geo.bounce
				} : null,
				lanes: world ? world.lanes.map(lane) : []
			};
		}
	}

	/* ------------------------------------------------------------ 挂载 */

	var controller = null;
	var currentId = null;      /* 当前挂在页面上的那一款 */
	var pendingGame = null;    /* 下一次挂载用哪一款(从终端 / 卡片点了之后再切路由) */
	var pendingOpts = null;
	var pendingStart = false;   /* 挂载完成后是否自动开局(只有终端 play 会要求) */
	var pendingScroll = false;  /* 挂载完成后把机台拉到眼前(点卡片 Play 只是"看这一台") */
	var routeHooked = false;

	function findGame(id) {
		for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
		return null;
	}

	function normalizeOpts(raw) {
		var o = raw || {};
		/* slow 只有函数球认(GAMES[].flags): --slow-motion, 弹跳高度翻倍 */
		return { easy: !!o.easy, rollback: !!o.rollback, slow: !!o.slow };
	}

	function destroyCurrent() {
		if (controller) {
			controller.destroy();
			controller = null;
		}
		currentId = null;
	}

	/**
	* 一屏只显示一款机台: 每款外面套一个 .cabinet-group[data-game-group],
	* 挂载时把当前这款的 hidden 摘掉、其余藏起来, 卡片上的 is-active 也跟着走。
	* (两块机台都写在 views/games.html 里 —— 换游戏不重新拉页面片段, 也不丢 i18n。)
	*/
	function showGame(host, id) {
		Array.prototype.forEach.call(host.querySelectorAll('[data-game-group]'), function (group) {
			if (group.getAttribute('data-game-group') === id) group.removeAttribute('hidden');
			else group.setAttribute('hidden', '');
		});
		Array.prototype.forEach.call(host.querySelectorAll('[data-game-card]'), function (card) {
			card.classList.toggle('is-active', card.getAttribute('data-game-card') === id);
		});
	}

	function mountAll(scope) {
		var host = scope || doc;
		var id = pendingGame || currentId || (GAMES[0] && GAMES[0].id);
		if (!findGame(id)) id = GAMES[0] ? GAMES[0].id : null;
		var cab = id ? host.querySelector('[data-game="' + id + '"]') : null;
		destroyCurrent();
		if (!cab) return null;
		showGame(host, id);
		var opt = normalizeOpts(pendingOpts);
		if (id === 'blockblast') controller = createBlockBlast(cab, opt);
		else if (id === 'funcball') controller = createFuncBall(cab, opt);
		else controller = createTetris(cab, opt);
		currentId = id;
		pendingGame = null;   /* 只对这一次挂载生效 */
		pendingOpts = null;
		return controller;
	}

	function hookRoute() {
		if (routeHooked) return;
		routeHooked = true;

		/* 页面已经换掉了 → 停掉旧机台的回调与 rAF */
		doc.addEventListener('route:changed', function (e) {
			var route = e.detail && e.detail.route;
			if (route !== 'games') {
				/* 离开页面: 机台、标志位、撤回记录全部丢掉 */
				destroyCurrent();
				pendingGame = null;
				pendingOpts = null;
				pendingStart = false;
				pendingScroll = false;
				return;
			}
			/* 从终端 / 卡片点了进来, 路由切过来之后才轮到这台机台 */
			var wantStart = pendingStart;
			var wantScroll = pendingScroll;
			pendingStart = false;
			pendingScroll = false;
			if (!controller) return;
			if (wantStart) controller.start();
			/* 路由自己会把页面滚回顶部 —— 等它做完这一手, 再把机台拉到眼前。
			   不自动开局也要滚: 点了 Play 就是想看这一台。 */
			if (wantStart || wantScroll) {
				setTimeout(function () {
					if (controller) controller.scrollTo();
				}, 150);
			}
		});

		/* 卡片上的 Play 按钮(委托, 页面片段换掉也不用重新绑): 只换机台, 不自动开局 ——
		   参数(函数球的 f(x) 等)要留给用户改; 开局是机台上那颗"开始"的事 */
		doc.addEventListener('click', function (e) {
			var btn = e.target.closest ? e.target.closest('[data-game-launch]') : null;
			if (!btn) return;
			e.preventDefault();
			launch(btn.getAttribute('data-game-launch'));
		});
	}

	/**
	* 从终端 / 站内任何地方把某一款换成当前机台。
	*   id    游戏 id(别名也认)
	*   opts  标志位(见 GAMES[].flags)
	*   start 传 true 才真的开局 —— 卡片 Play 与 dock 搜索都不传, 于是只换机台、停在 ready,
	*         参数随便改, 什么时候开始由用户按机台上的按钮; 终端 play 传 true,
	*         因为"play"本来就该直接玩起来。声明了 needsSetup 的那一款(函数球要先设 f(x))
	*         连 start=true 也只停到 ready —— 不然一开局参数就锁上了。
	* 不在 games 页就先记下来, 等路由切换完成后再挂载(两种情况都会把机台滚到眼前)。
	*/
	function launch(id, opts, start) {
		var found = findGame(id);
		if (!found) return false;
		pendingGame = found.id;
		pendingOpts = normalizeOpts(opts);
		pendingScroll = true;
		var wantStart = !!start && !found.needsSetup;
		var router = global.Router;
		if (router && router.current !== 'games') {
			pendingStart = wantStart;
			router.navigate('games');
			return true;
		}
		pendingStart = false;
		pendingScroll = false;
		mountAll(doc);
		if (!controller) return true;
		if (wantStart) controller.start();
		controller.scrollTo();
		return true;
	}

	hookRoute();

	global.Games = {
		list: function () { return GAMES.slice(); },
		/* 俄罗斯方块的 7-bag 生成序列(不碰正在玩的那一局): Games.sample(20) → ['T','I','S',...] */
		sample: function (count) {
			var state = { bag: [], lastType: null };
			var n = Math.max(1, Math.min(count || 100, 100000));
			var out = [];
			for (var i = 0; i < n; i++) out.push(drawType(state));
			return out;
		},
		ids: function () { return GAMES.map(function (g) { return g.id; }); },
		/**
		 * 函数球打砖块: 表达式试算与"无渲染跑一局"。
		 * 调默认值、跑回归都用它, 不碰页面上正在玩的那一台:
		 *   Games.funcball.evalAt('x!', 5)                      -> 120
		 *   Games.funcball.simulate({ hp: 1000, growth: 1000, layers: 3,
		 *     lanes: [{ expr: 'x!', x0: 0 }, { expr: '10 * 1.35^x', x0: 48 }] })
		 */
		funcball: {
			templates: function () {
				return Object.keys(FB_TEMPLATES).map(function (id) {
					return {
						id: id, glyph: FB_TEMPLATES[id].glyph, expr: FB_TEMPLATES[id].expr,
						x0: FB_TEMPLATES[id].x0, step: FB_TEMPLATES[id].step
					};
				});
			},
			/* 解析成功就 { ok: true }, 否则把解析器原话带出来 */
			check: function (expr) {
				try { fbParse(expr); return { ok: true, error: null }; }
				catch (e) { return { ok: false, error: e.message }; }
			},
			evalAt: function (expr, x) { return fbEval(fbParse(expr), x); },
			damageAt: function (expr, x) { return fbDamage(fbParse(expr), x); },
			format: fbNum,
			compact: fbShort,
			simulate: function (cfg) {
				var c = cfg || {};
				var wall = {
					layers: c.layers || 3,
					perRow: c.perRow || 1,
					hp: c.hp || 1000,
					growth: c.growth || 1
				};
				var specs = (c.lanes || ['x!', '10 * 1.35^x']).map(function (l) {
					var spec = typeof l === 'string' ? { expr: l } : (l || {});
					return {
						ast: fbParse(spec.expr),
						expr: spec.expr,
						glyph: fbGlyphFor(spec.expr),
						x0: spec.x0 || 0,
						step: spec.step || 1
					};
				});
				var geo = fbGeometry(600, 456, wall);
				geo.bounce = c.bounce || FB_BOUNCE;
				var w = fbMakeWorld(wall, specs);
				var step = FB_STEP_MS / 1000;
				var guard = 0;
				while (w.winner < 0 && guard < 300000) { fbStepWorld(w, step, geo); guard++; }
				return {
					time: w.time,
					winner: w.winner,
					lanes: w.lanes.map(function (lane) {
						return {
							expr: lane.expr, x: lane.x, hits: lane.hits, damage: lane.damage,
							damageText: fbNum(lane.damage), done: lane.done, time: lane.time,
							log: lane.log
						};
					})
				};
			}
		},
		launch: launch,
		mountAll: mountAll,
		/* 当前挂的是哪一款(没有机台时 null) */
		current: function () { return currentId; },
		active: function () { return !!(controller && controller.state() === 'running'); },
		get controller() { return controller; }
	};
})(window);
