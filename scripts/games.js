/**
 * games.js — 页面小游戏(俄罗斯方块 + Block Blast)
 *
 * 三个入口共用同一套挂载逻辑:
 *   1. #/games 页面底部的机台(views/games.html, 由 router 调 mountAll 挂载)
 *   2. 终端命令 play / games(scripts/terminal.js 调 Games.launch)
 *   3. dock 的小游戏按钮(走路由, 与 1 是同一个)
 *
 * GAMES 是唯一事实来源 —— 卡片、dock 搜索、终端 games 命令都读它。
 * 一款游戏一个引擎 + 一个机台分组(.cabinet-group[data-game-group]): 两块机台都写在
 * 页面里, 只显示当前这款, 卡片上的 is-active 也跟着走。标志位(easy / rollback)
 * 是两款游戏共用的名字, 但各自解释(见下面的 createTetris / createBlockBlast)。
 *
 * 俄罗斯方块: 7-bag 生成、矩阵旋转 + 踢墙、幽灵方块、暂存(hold)、锁定延迟、消行闪光、等级加速。
 * Block Blast: 8×8 棋盘、一次三块、拖放 / 触屏键 / 键盘三套输入、消行消列与连击。
 * 渲染都是纯 Canvas —— 配色跟着主题走, 离开页面或切走标签页会自动暂停。
 * 最高分各自记在 localStorage。
 */
(function (global) {
	'use strict';

	var doc = global.document;

	/* ------------------------------------------------------------ 游戏清单 */

	/* 页面卡片 / dock 搜索 / 终端 games 命令都读这一份。
	   alias 是终端 play 认的别名(block-blast / blast 都能开局), 卡片与搜索只用 id。 */
	var GAMES = [
		{ id: 'tetris', title: 'Tetris', desc: 'classic falling-block puzzle' },
		{
			id: 'blockblast', title: 'Block Blast',
			desc: '8x8 board, three pieces at a time',
			alias: ['block-blast', 'block_blast', 'blast', 'bb']
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
	   Block Blast hayneko.game.blockblast.best —— 两款游戏的分数没有可比性。 */
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

	/* ------------------------------------------------- 画布小工具(两款游戏共用) */

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

	/* 机台标题栏上的状态字(ready / running / paused / over) —— 两款游戏共用 */
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
	 * opt 由终端命令行传进来(见 scripts/terminal.js 的 play 命令):
	 *   easy     --easy-mode       不加速: 等级固定 1, 下落间隔恒定 800ms
	 *   rollback --with-roll-back  多一个"撤回"按钮, 可以退回上一步落子
	 * 不带标志位时两个都是 false —— 机台就是默认形态, 而且只在这一次挂载生效,
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
	var BB_COMBO_GRACE = 3;      /* 连着这么多次没消除, 连击才断(中间的空放不算断) */
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
			combo: 0,             /* 连着几次放置都有消线; 0 = 没连上 */
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
				game.combo += 1;
				game.misses = 0;      /* 消掉了, 缓冲重新开始 */
				game.score += Math.round(10 * n * (n + 1) / 2) * game.combo;
				game.lines += n;
				game.clearRows = rows;
				game.clearCols = cols;
				game.clearTimer = BB_CLEAR_MS;
				if (game.score > game.best) { game.best = game.score; writeBest(BB_BEST_KEY, game.best); }
			} else {
				/* 连击不是一空放就断: 连着 BB_COMBO_GRACE 次没消除才断, 中间留着缓冲
				   (差一次就断的那次, HUD 上的连击会变成黄色提醒) */
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
				elCombo.textContent = '×' + Math.max(1, game.combo);
				/* 连击在冷却 / 只剩最后一次机会 —— 不然玩家不知道它为什么突然断了 */
				var live = game.combo > 0;
				elCombo.classList.toggle('is-fading', live && game.misses > 0);
				elCombo.classList.toggle('is-last', live && game.misses >= BB_COMBO_GRACE - 1);
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


	/* ------------------------------------------------------------ 挂载 */

	var controller = null;
	var currentId = null;      /* 当前挂在页面上的那一款 */
	var pendingGame = null;    /* 下一次挂载用哪一款(从终端 / 卡片点了之后再切路由) */
	var pendingOpts = null;
	var pendingStart = false;  /* 挂载完成后是否自动开局 */
	var routeHooked = false;

	function findGame(id) {
		for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
		return null;
	}

	function normalizeOpts(raw) {
		var o = raw || {};
		return { easy: !!o.easy, rollback: !!o.rollback };
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
		controller = id === 'blockblast' ? createBlockBlast(cab, opt) : createTetris(cab, opt);
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
				return;
			}
			/* 从终端 / 卡片点了"开局", 路由切过来之后才真正开始 */
			if (pendingStart) {
				pendingStart = false;
				if (controller) {
					controller.start();
					/* 路由自己会把页面滚回顶部 —— 等它做完这一手, 再把机台拉到眼前,
					否则人在页面顶部, 方块已经开始落了 */
					setTimeout(function () {
						if (controller) controller.scrollTo();
					}, 150);
				}
			}
		});

		/* 卡片上的 Play 按钮(委托, 页面片段换掉也不用重新绑) */
		doc.addEventListener('click', function (e) {
			var btn = e.target.closest ? e.target.closest('[data-game-launch]') : null;
			if (!btn) return;
			e.preventDefault();
			launch(btn.getAttribute('data-game-launch'));
		});
	}

	/**
	* 从终端 / 站内任何地方开局。
	* 不在 games 页就先记下来, 等路由切换完成后再启动。
	* 已经在小游戏页就换掉当前机台重挂一台(标志位跟着这一次开局走, 也从零开始)。
	*/
	function launch(id, opts) {
		var found = findGame(id);
		if (!found) return false;
		pendingGame = found.id;
		pendingOpts = normalizeOpts(opts);
		var router = global.Router;
		if (router && router.current !== 'games') {
			pendingStart = true;
			router.navigate('games');
			return true;
		}
		pendingStart = false;
		mountAll(doc);
		if (controller) {
			controller.start();
			controller.scrollTo();
		}
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
		launch: launch,
		mountAll: mountAll,
		/* 当前挂的是哪一款(没有机台时 null) */
		current: function () { return currentId; },
		active: function () { return !!(controller && controller.state() === 'running'); },
		get controller() { return controller; }
	};
})(window);
