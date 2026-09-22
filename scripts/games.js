/**
 * games.js — 页面小游戏(目前只有俄罗斯方块)
 *
 * 三个入口共用同一个引擎:
 *   1. #/games 页面底部的机台(views/games.html, 由 router 调 mountAll 挂载)
 *   2. 终端命令 play / games(scripts/terminal.js 调 Games.launch)
 *   3. dock 的小游戏按钮(走路由, 与 1 是同一个)
 *
 * 引擎要点: 7-bag 随机、矩阵旋转 + 踢墙、幽灵方块、暂存(hold)、
 * 锁定延迟、消行闪光、等级加速; 最高分记在 localStorage。
 * 渲染是纯 Canvas —— 配色跟着主题走, 离开页面或切走标签页会自动暂停。
 */
(function (global) {
	'use strict';

	var doc = global.document;

	/* ------------------------------------------------------------ 游戏清单 */

	/* 页面卡片 / dock 搜索 / 终端 games 命令都读这一份 */
	var GAMES = [
		{ id: 'tetris', title: 'Tetris', desc: 'classic falling-block puzzle' }
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

	var LOCK_MS = 430;          /* 落地后的锁定宽限 */
	var MAX_LOCK_RESETS = 12;   /* 宽限最多重置多少次, 防止原地无限转 */
	var CLEAR_MS = 150;         /* 消行闪光时长 */

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

	/* 7-bag: 每七个方块里七个形状各出现一次, 不会连续来五个 S */
	function shuffleBag() {
		var bag = PIECES.slice();
		for (var i = bag.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var tmp = bag[i];
			bag[i] = bag[j];
			bag[j] = tmp;
		}
		return bag;
	}

	/* 等级越高落得越快; 70ms 是上限, 再快就没法玩了 */
	function gravityMs(level) {
		return Math.max(70, 800 * Math.pow(0.85, level - 1));
	}

	function readBest() {
		try { return parseInt(global.localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
	}

	function writeBest(value) {
		try { global.localStorage.setItem(BEST_KEY, String(value)); } catch (e) { /* 忽略 */ }
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

		var game = {
			board: emptyBoard(),
			queue: [],
			bag: [],
			cur: null,
			hold: null,
			canHold: true,
			score: 0,
			level: 1,
			lines: 0,
			best: readBest(),
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
			if (!game.bag.length) game.bag = shuffleBag();
			return game.bag.pop();
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
				bag: game.bag.slice(),
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
			game.bag = snap.bag;
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
			if (game.score > game.best) { game.best = game.score; writeBest(game.best); }
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
			game.bag = [];
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
			if (game.score > game.best) { game.best = game.score; writeBest(game.best); }
			stopLoop();
			updateHud();
			draw();
			sync();
		}

		/* ---- HUD / 覆盖层 ---- */

		function stateLabel() {
			var map = {
				ready: ['games.state.ready', 'ready'],
				running: ['games.state.running', 'running'],
				paused: ['games.state.paused', 'paused'],
				over: ['games.state.over', 'game over']
			};
			var row = map[game.state] || map.ready;
			return t(row[0], row[1]);
		}

		function updateHud() {
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
					title = t('games.overlay.readyTitle', 'TETRIS');
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
					esc(t('games.flag.easyTip', '--easy-mode: no speed-up')) + '">' +
					esc(t('games.flag.easy', 'EASY')) + '</span>');
			}
			if (opt.rollback) {
				chips.push('<span class="cabinet__flag cabinet__flag--undo" title="' +
					esc(t('games.flag.rollbackTip', '--with-roll-back: undo is available')) + '">' +
					esc(t('games.flag.rollback', 'UNDO')) + '</span>');
			}
			flagsBox.innerHTML = chips.join('');
		}

		/* ---- 渲染 ---- */

		function gridColor() {
			return doc.documentElement.getAttribute('data-theme') === 'light'
				? 'rgba(12, 18, 26, 0.10)'
				: 'rgba(230, 237, 243, 0.07)';
		}

		function block(c, px, py, size, color, alpha) {
			var pad = Math.max(1, size * 0.07);
			c.globalAlpha = alpha;
			c.fillStyle = color;
			c.fillRect(px + pad, py + pad, size - pad * 2, size - pad * 2);
			c.fillStyle = 'rgba(255, 255, 255, 0.22)';
			c.fillRect(px + pad, py + pad, size - pad * 2, Math.max(1, size * 0.12));
			c.globalAlpha = 1;
		}

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

	/* ------------------------------------------------------------ 挂载 */

	var controller = null;
	var pendingId = null;
	var pendingOpts = null;
	var routeHooked = false;

	function normalizeOpts(raw) {
		var o = raw || {};
		return { easy: !!o.easy, rollback: !!o.rollback };
	}

	function destroyCurrent() {
		if (controller) {
			controller.destroy();
			controller = null;
		}
	}

	function mountAll(scope) {
		var host = scope || doc;
		var cab = host.querySelector('[data-game="tetris"]');
		if (!cab) return controller;
		destroyCurrent();
		controller = createTetris(cab, normalizeOpts(pendingOpts));
		pendingOpts = null;   /* 只对这一次挂载生效 */
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
				pendingId = null;
				pendingOpts = null;
				return;
			}
			/* 从终端 / 别处点了"开局", 路由切过来之后才真正开始 */
			if (pendingId) {
				pendingId = null;
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
	 * 若要从终端跳到机台并自动滚过去, 这里再补一次 scrollTo。
	 */
	function launch(id, opts) {
		var found = null;
		for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) found = GAMES[i];
		if (!found) return false;
		var router = global.Router;
		pendingOpts = normalizeOpts(opts);
		if (router && router.current !== 'games') {
			pendingId = found.id;
			router.navigate('games');
			return true;
		}
		/* 已经在小游戏页: 重挂一台, 好把标志位应用上(没有标志位时等于重开) */
		pendingId = null;
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
		ids: function () { return GAMES.map(function (g) { return g.id; }); },
		launch: launch,
		mountAll: mountAll,
		active: function () { return !!(controller && controller.state() === 'running'); },
		get controller() { return controller; }
	};
})(window);
