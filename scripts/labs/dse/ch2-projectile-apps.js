/**
 * ch2-projectile-apps.js — 拋體應用：投籃、發球、水柱（DSE 物理 · II.c · 實驗 08）
 *
 * 為什麼要把「所需角度」印成兩個: 同一個落點在無阻力下幾乎都有高弧線與低弧線兩解,
 * 學生自己試角時只會撞到其中一個, 於是以為答案唯一。這裡把兩個解都畫成細虛線,
 * 再用實線畫目前這一發——按鈕與滑桿一動, 三個弧的相對位置就自己解釋了為什麼
 * 「投不進」不是初速不夠, 而是選了另一條弧。
 *
 * 四個情境共用同一組運動方程式, 差別只在目標點 (x_T, y_T)、出手高度 y0 與場景畫法;
 * 目標高度一律以「球心 / 水柱中心」對齊, 容差 0.05 m(無人機為 ±1 m, 因為它只有水平速度)。
 */
(function () {
	'use strict';

	var G = 9.81;
	var DRONE_TARGET = 30;      /* m，無人機的降落點目標 */
	var REDUCED_TXT = ' 已依系統設定暫停動態。';

	window.DSELab.define('projectile-apps', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;
		var fmt = ctx.fmt;

		/* 每個情境自己記住 u / θ: 切回上一個情境時不會被別人的數字帶著跑 */
		var PRE = [
			{ id: 'hoop', name: '籃球', u: 9, th: 45, xT: 4.6, yT: 3.05, y0: 2.05, tol: 0.05, base: { x: 5.6, y: 4.1 } },
			{ id: 'volley', name: '排球發球', u: 16, th: 20, xT: 9.0, yT: 2.43, y0: 2.0, tol: 0.05, base: { x: 11.2, y: 3.5 } },
			{ id: 'fire', name: '消防水柱', u: 16, th: 38, xT: 15.0, yT: 6.0, y0: 1.2, tol: 0.15, base: { x: 17.0, y: 8.4 } },
			{ id: 'drone', name: '無人機投遞', u: 15, th: 0, xT: DRONE_TARGET, yT: 0, y0: 20, tol: 1.0, base: { x: 34, y: 26 } }
		];

		var idx = 0;
		var hDrone = 20;         /* m，只給無人機用 */
		var phase = 0;          /* 0..1，球在軌跡上的位置 */
		var playing = !ctx.reduced;
		var scrubbing = false;

		var view = null;
		var canvas = null;

		var map = { ox: 0, oy: 0, s: 1, xmax: 1 };

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}
		function num(v, d) { return fmt(v, d); }
		function estW(text, size) {
			var w = 0;
			for (var i = 0; i < text.length; i++) w += text.charCodeAt(i) > 0x2e80 ? size : size * 0.6;
			return w;
		}

		/* ---------------- 物理 ---------------- */

		/* 一次算完這一發會用到的所有量; 任何一項非有限值都退回 0, 讀數才不會出現 NaN */
		function shot() {
			var p = PRE[idx];
			var u = Math.max(0.001, +stateU());
			var th = p.id === 'drone' ? 0 : curTh;
			var rad = th * Math.PI / 180;
			var y0 = p.id === 'drone' ? hDrone : p.y0;
			var ux = u * Math.cos(rad);
			var uy = u * Math.sin(rad);
			var disc = uy * uy + 2 * G * y0;
			var tLand = (uy + Math.sqrt(Math.max(0, disc))) / G;
			var xLand = ux * tLand;
			var yApex = y0 + uy * uy / (2 * G);
			var st = {
				p: p, u: u, th: th, rad: rad, ux: ux, uy: uy, y0: y0,
				tLand: tLand, xLand: xLand, yApex: yApex,
				reached: false, yAtXT: NaN, vyAtXT: NaN, tAtXT: NaN
			};
			var tAt = ux > 0.0001 ? p.xT / ux : NaN;
			if (isFinite(tAt) && tAt >= 0 && tAt <= tLand + 1e-9) {
				st.reached = true;
				st.tAtXT = tAt;
				st.yAtXT = y0 + uy * tAt - 0.5 * G * tAt * tAt;
				st.vyAtXT = uy - G * tAt;
			}
			if (!isFinite(st.xLand)) st.xLand = 0;
			if (!isFinite(st.yApex)) st.yApex = y0;
			if (!isFinite(st.tLand)) st.tLand = 0;
			return st;
		}

		function stateU() { return PRE[idx].u; }
		var curTh = 45;          /* 目前情境的發射角，切換時與 PRE[idx].th 同步 */

		/* 命中所需的兩個角（高、低）; 無解回 null */
		function solveAngles(xT, dy, uSp) {
			if (!(xT > 0) || !(uSp > 0)) return null;
			var k = G * xT * xT / (2 * uSp * uSp);
			var disc = xT * xT - 4 * k * (dy + k);
			if (!(disc >= 0)) return null;
			var sq = Math.sqrt(disc);
			var hi = Math.atan((xT + sq) / (2 * k)) * 180 / Math.PI;
			var lo = Math.atan((xT - sq) / (2 * k)) * 180 / Math.PI;
			return [hi, lo];
		}

		/* 判定: 文字與語意色 */
		function judge(st) {
			var p = st.p;
			if (p.id === 'drone') {
				var d = st.xLand - DRONE_TARGET;
				if (Math.abs(d) <= p.tol) return { t: '命中', acc: true };
				return { t: d > 0 ? '過遠' : '不足', acc: false };
			}
			if (!st.reached) {
				return { t: p.id === 'hoop' ? '未及' : (p.id === 'volley' ? '落網' : '澆不到'), acc: false };
			}
			var dy = st.yAtXT - p.yT;
			if (Math.abs(dy) <= p.tol) {
				if (p.id === 'hoop' && !(st.vyAtXT < 0)) return { t: '過高', acc: false };
				if (p.id === 'volley') return { t: '觸網', acc: false };
				if (p.id === 'fire') return { t: '命中', acc: true };
				return { t: '命中', acc: true };
			}
			if (p.id === 'hoop') return { t: dy > 0 ? '過高' : '過短', acc: false };
			if (p.id === 'volley') return { t: dy > 0 ? '過網' : '落網', acc: false };
			return { t: dy > 0 ? '越過' : '澆不到', acc: false };
		}

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		canvas = el('canvas', 'dl-canvas dl-canvas--drag');
		var hint = el('p', 'dl-hint', '拖畫布：看這一球飛到哪');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stage.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel pe-panel');

		var gScene = el('div', 'dl-panel__group');
		gScene.appendChild(el('span', 'dl-panel__label', '情境'));
		var seg = el('div', 'dl-seg');
		var btns = [];
		for (var bi = 0; bi < PRE.length; bi++) {
			var b = el('button', 'dl-btn', PRE[bi].name);
			b.type = 'button';
			b.setAttribute('aria-pressed', bi === 0 ? 'true' : 'false');
			if (bi === 0) b.classList.add('is-on');
			seg.appendChild(b);
			btns.push(b);
		}
		gScene.appendChild(seg);

		var fU = el('div', 'dl-field');
		fU.appendChild(el('span', 'dl-field__label', '初速 u'));
		var inU = el('input', 'dl-range');
		inU.type = 'range';
		inU.min = '5';
		inU.max = '30';
		inU.step = '0.5';
		inU.value = '9';
		inU.setAttribute('aria-label', '初速 u（米每秒）');
		var outU = el('output', 'dl-field__val', '9 m/s');
		fU.appendChild(inU);
		fU.appendChild(outU);
		gScene.appendChild(fU);

		var fT = el('div', 'dl-field');
		fT.appendChild(el('span', 'dl-field__label', '發射角 θ'));
		var inT = el('input', 'dl-range');
		inT.type = 'range';
		inT.min = '0';
		inT.max = '85';
		inT.step = '1';
		inT.value = '45';
		inT.setAttribute('aria-label', '發射角 θ（度）');
		var outT = el('output', 'dl-field__val', '45°');
		fT.appendChild(inT);
		fT.appendChild(outT);
		gScene.appendChild(fT);

		var fH = el('div', 'dl-field');
		var hLabel = el('span', 'dl-field__label', '投放高度 h');
		fH.appendChild(hLabel);
		var inH = el('input', 'dl-range');
		inH.type = 'range';
		inH.min = '10';
		inH.max = '40';
		inH.step = '0.5';
		inH.value = '20';
		inH.setAttribute('aria-label', '無人機投放高度（米）');
		var outH = el('output', 'dl-field__val', '20 m');
		fH.appendChild(inH);
		fH.appendChild(outH);
		fH.hidden = true;
		gScene.appendChild(fH);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}
		var rds = el('div', 'dl-readouts pe-rd');
		var cells = [];
		for (var ci = 0; ci < 5; ci++) {
			var cc = cell('—');
			if (ci === 2) cc.root.classList.add('pe-wide');   /* 判定: 整行讀 */
			cells.push(cc);
			rds.appendChild(cc.root);
		}

		var texBox = el('div', 'pe-tex');
		var texA = el('span', 'pe-tex__row', '');
		var texB = el('span', 'pe-tex__row', '');
		texBox.appendChild(texA);
		texBox.appendChild(texB);

		var note = el('p', 'dl-note', '');

		panel.appendChild(gScene);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);
		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);

		view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------- 讀數 / 文字 ---------------- */

		var NOTE = '四個情境共用同一組方程式：x = (u cosθ)t、y = y₀ + (u sinθ)t − ½gt²。' +
			'籃球與水柱把兩解都印出來（高弧線／低弧線），細虛線就是那兩條解；實線是目前這一發。' +
			'無人機不同：它只有水平速度，落地點 x = u√(2h/g)，包裹永遠在機身正下方。';
		var lastA = '';
		var lastB = '';

		function setTeX(node, text, last) {
			if (text === last) return text;
			node.textContent = text;
			ctx.tex(node);
			return text;
		}

		function syncUI() {
			var p = PRE[idx];
			var st = shot();
			var vd = judge(st);
			outU.textContent = num(p.u, 1) + ' m/s';
			outT.textContent = num(st.th, 0) + '°';
			outH.textContent = num(hDrone, 1) + ' m';
			inU.value = String(p.u);
			inT.value = String(st.th);
			inH.value = String(hDrone);
			inU.disabled = false;
			inT.disabled = p.id === 'drone';
			inT.setAttribute('aria-disabled', p.id === 'drone' ? 'true' : 'false');
			fH.hidden = p.id !== 'drone';
			fT.style.opacity = p.id === 'drone' ? '0.45' : '';

			var k = [];
			var v = [];
			if (p.id === 'drone') {
				k = ['落點 x', '飛行時間', '判定', '與目標差', '所需 u'];
				v = [num(st.xLand, 2) + ' m', num(st.tLand, 3) + ' s', vd.t,
					num(st.xLand - DRONE_TARGET, 2) + ' m',
					num(DRONE_TARGET / Math.sqrt(2 * hDrone / G), 2) + ' m/s'];
			} else {
				var sol = solveAngles(p.xT, p.yT - st.y0, p.u);
				k = ['射程 R', 'y(' + num(p.xT, 1) + ' m)', '判定', '高弧線 θ', '低弧線 θ'];
				v = [num(st.xLand, 2) + ' m', st.reached ? num(st.yAtXT, 2) + ' m' : '—', vd.t,
					sol ? sol[0].toFixed(2) + '°' : '無解',
					sol ? sol[1].toFixed(2) + '°' : '—'];
			}
			/* 靜態（或定格）時把球停在關鍵處: 那一格讀數講的是這一個瞬間 */
			if (!playing) {
				if (p.id === 'drone') phase = 1;
				else if (st.reached && st.tLand > 0) phase = ctx.clamp(st.tAtXT / st.tLand, 0, 1);
				else phase = 0.6;
			}

			for (var i = 0; i < cells.length; i++) {
				cells[i].k.textContent = k[i];
				cells[i].v.textContent = v[i];
				cells[i].v.classList.toggle('pe-acc', i === 3 && vd.acc);
				cells[i].v.classList.toggle('pe-mute', (i === 3 && !vd.acc) || v[i] === '—' || v[i] === '無解');
			}

			var a = '\\( R = \\dfrac{u^2\\sin 2\\theta}{g} \\)　\\( y = y_0 + (u\\sin\\theta)t - \\tfrac{1}{2}gt^2 \\)';
			var b;
			if (p.id === 'drone') {
				b = '落地 \\( t = \\sqrt{\\dfrac{2h}{g}} = \\sqrt{\\dfrac{' + num(2 * hDrone, 1) + '}{9.81}} = ' +
					num(st.tLand, 3) + '\\;\\text{s} \\)，\\( x = u t = ' + num(st.xLand, 2) + '\\;\\text{m} \\)';
					} else if (p.id === 'hoop') {
				var hs = solveAngles(p.xT, p.yT - st.y0, p.u);
				b = hs
					? '命中解：\\( \\theta = ' + hs[0].toFixed(3) + '^\\circ \\)（高弧線）或 \\( ' +
						hs[1].toFixed(3) + '^\\circ \\)（低弧線）；兩解都令 \\( y(' + num(p.xT, 1) + ') = 3.05\\;\\text{m} \\)'
					: '初速不夠：這個 u 沒有任何角度能命中 3.05 m';
} else if (p.id === 'volley') {
				b = '過網看 \\( y(' + num(p.xT, 1) + ') \\) 與網頂 2.43 m 的差：差 0.05 m 內算觸網';
			} else {
				var fs = solveAngles(p.xT, p.yT - st.y0, p.u);
				b = fs
					? '命中解：\\( \\theta = ' + fs[0].toFixed(3) + '^\\circ \\) 或 \\( ' + fs[1].toFixed(3) +
						'^\\circ \\)；水柱中心要落在火點 \\( \\pm 0.15\\;\\text{m} \\) 內'
					: '初速不夠：這個 u 沒有任何角度能澆到火點';
			}
			lastA = setTeX(texA, a, lastA);
			lastB = setTeX(texB, b, lastB);
			note.textContent = NOTE + (ctx.reduced ? REDUCED_TXT : '');
		}

		/* ---------------- 繪圖 ---------------- */

		function skyTop(g, W, H, c0, c1, c2) {
			var grd = g.createLinearGradient(0, 0, 0, Math.max(1, H));
			grd.addColorStop(0, c0);
			grd.addColorStop(0.62, c1);
			grd.addColorStop(1, c2);
			g.fillStyle = grd;
			g.fillRect(0, 0, W, H);
		}

		function soil(g, W, H, groundY, top, bottom) {
			var grd = g.createLinearGradient(0, groundY, 0, H);
			grd.addColorStop(0, top);
			grd.addColorStop(1, bottom);
			g.fillStyle = grd;
			g.fillRect(0, groundY, W, H - groundY);
		}

		/* 把世界座標換成畫布座標（等比例，所以角度與高度差不會被拉歪） */
		function fit(W, H, st, base) {
			var m = Math.max(8, Math.min(W, H) * 0.03);
			var band = ctx.clamp(H * 0.17, 22, 46);
			var groundY = Math.round(H - band);
			var xmax = Math.max(base.x, st.xLand * 1.04, st.p.xT * 1.3, 4);
			var ymax = Math.max(base.y, st.yApex * 1.08, 2);
			var s = Math.min((W - m * 2 - 18) / xmax, (groundY - m - 20) / ymax);
			if (!isFinite(s) || s <= 0.0001) s = 1;
			map.ox = Math.round(m + 10);
			map.oy = groundY;
			map.s = s;
			map.xmax = xmax;
			return { m: m, groundY: groundY, band: band };
		}

		function PX(x) { return map.ox + x * map.s; }
		function PY(y) { return map.oy - y * map.s; }

		/* 軌跡點: 只畫到落點或畫布右緣 */
		function traj(g, st, color, width, stepPx) {
			if (!(st.tLand > 0) || !(map.s > 0)) return;
			var xEnd = Math.min(st.xLand, map.xmax);
			var n = Math.max(12, Math.round(xEnd * map.s / (stepPx || 7)));
			for (var i = 0; i <= n; i++) {
				var x = xEnd * i / n;
				var t = st.ux > 0.0001 ? x / st.ux : 0;
				var y = st.y0 + st.uy * t - 0.5 * G * t * t;
				if (y < -0.2) break;
				D.dot(g, PX(x), PY(y), width || 1.15, { color: color, fill: color, stroke: false });
			}
		}

		function ballAt(g, st, x, y, r, fill, edge) {
			g.save();
			g.beginPath();
			g.arc(PX(x), PY(y), r, 0, Math.PI * 2);
			g.fillStyle = fill;
			g.fill();
			if (edge) {
				g.strokeStyle = edge;
				g.lineWidth = 1;
				g.stroke();
			}
			g.restore();
		}

		/* ---- 情境 1: 籃球 ---- */
		function sceneHoop(g, W, H, geo, st) {
			var p = st.p;
			skyTop(g, W, H, '#e6ded0', '#eee8dc', '#e3dbca');
			/* 地板 */
			soil(g, W, H, geo.groundY, '#c79c66', '#a87f4e');
			g.strokeStyle = 'rgba(90,60,30,0.22)';
			g.lineWidth = 1;
			g.beginPath();
			for (var px = 0; px < W; px += 26) {
				g.moveTo(px, geo.groundY);
				g.lineTo(px - 10, H);
			}
			g.stroke();
			g.strokeStyle = '#7a5a34';
			g.beginPath();
			g.moveTo(0, geo.groundY + 0.5);
			g.lineTo(W, geo.groundY + 0.5);
			g.stroke();

			var brdX = p.xT + 0.37;          /* 篮板在篮框后 0.37 m */
			var topY = p.yT + 0.75;
			var botY = p.yT - 0.28;
			/* 篮架 */
			D.line(g, PX(brdX + 0.22), geo.groundY, PX(brdX + 0.22), PY(topY + 0.15), { color: '#585652', width: 2.2 });
			D.line(g, PX(brdX + 0.22), PY(topY + 0.05), PX(brdX), PY(topY + 0.05), { color: '#585652', width: 2 });
			/* 篮板: 侧视图是一片有厚度的板(太薄會讀成一條電線杆) */
			var bwid = Math.max(4, 0.13 * map.s);
			g.save();
			g.fillStyle = 'rgba(240,238,231,0.95)';
			g.strokeStyle = '#6a665e';
			g.lineWidth = 1.2;
			g.beginPath();
			g.rect(PX(brdX), PY(topY), bwid, PY(botY) - PY(topY));
			g.fill();
			g.stroke();
			/* 板上方框: 側視時只能看到它的邊, 畫成板內的一條橫線與兩條豎線 */
			g.strokeStyle = 'rgba(150,60,38,0.85)';
			g.lineWidth = 1.1;
			g.beginPath();
			g.moveTo(PX(brdX) + 1, PY(p.yT + 0.45));
			g.lineTo(PX(brdX) + bwid - 1, PY(p.yT + 0.45));
			g.moveTo(PX(brdX) + 1, PY(p.yT + 0.02));
			g.lineTo(PX(brdX) + bwid - 1, PY(p.yT + 0.02));
			g.stroke();
			g.restore();
			/* 支架 */
			D.line(g, PX(brdX) + bwid, PY(topY + 0.35), PX(brdX + 0.22), PY(topY + 0.05), { color: '#5c5954', width: 1.6 });
			/* 篮框 */
			D.line(g, PX(p.xT), PY(p.yT), PX(brdX) + 1, PY(p.yT), { color: '#c2551f', width: 3 });
			/* 网 */
			var nx0 = PX(p.xT), nx1 = PX(brdX);
			var ny = PY(p.yT);
			var netH = Math.min(0.42 * map.s, Math.max(6, 30));
			g.save();
			g.strokeStyle = 'rgba(245,245,242,0.85)';
			g.lineWidth = 1;
			for (var i = 0; i <= 5; i++) {
				var k = i / 5;
				g.beginPath();
				g.moveTo(nx0 + (nx1 - nx0) * k, ny);
				g.lineTo(nx0 + (nx1 - nx0) * (0.18 + 0.64 * k), ny + netH);
				g.stroke();
			}
			g.beginPath();
			g.moveTo(nx0 + (nx1 - nx0) * 0.18, ny + netH);
			g.lineTo(nx0 + (nx1 - nx0) * 0.82, ny + netH);
			g.stroke();
			g.restore();

			/* 出手點 */
			D.dashed(g, PX(0), PY(p.y0), PX(0) - 14, PY(p.y0), { color: C.inkFaint, width: 1 });
			D.label(g, '出手 ' + num(p.y0, 2) + ' m', PX(0) + 4, PY(p.y0) - 9,
				{ color: C.inkDim, size: 10, align: 'left', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
			/* 框高標籤 */
			D.dashed(g, PX(brdX) + 4, PY(p.yT), PX(brdX) + 20, PY(p.yT), { color: C.inkFaint, width: 1 });
			D.label(g, '3.05 m', Math.min(W - 4, PX(brdX) + 22), PY(p.yT),
				{ color: C.inkDim, size: 10, align: 'left', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
		}

		/* ---- 情境 2: 排球發球 ---- */
		function sceneVolley(g, W, H, geo, st) {
			var p = st.p;
			skyTop(g, W, H, '#bcd7e8', '#dfeaf0', '#eaeee4');
			soil(g, W, H, geo.groundY, '#c3a274', '#a3855c');
			g.strokeStyle = 'rgba(120,90,50,0.35)';
			g.lineWidth = 1;
			g.beginPath();
			g.moveTo(0, geo.groundY + 0.5);
			g.lineTo(W, geo.groundY + 0.5);
			g.stroke();
			/* 網: 側視圖是一條窄帶 + 上緣白帶 */
			var nx = PX(p.xT);
			var topY = PY(p.yT);
			var netBot = PY(0.9);
			g.save();
			g.fillStyle = 'rgba(238,239,236,0.55)';
			g.fillRect(nx - 3, topY, 6, netBot - topY);
			g.strokeStyle = 'rgba(120,124,120,0.75)';
			g.lineWidth = 1;
			for (var y = topY; y < netBot; y += 5) {
				g.beginPath();
				g.moveTo(nx - 3, y);
				g.lineTo(nx + 3, y + 3);
				g.stroke();
			}
			g.fillStyle = '#f4f4f0';
			g.fillRect(nx - 4, topY - 2, 8, 4);
			g.strokeStyle = '#6f726e';
			g.beginPath();
			g.moveTo(nx, topY - 2);
			g.lineTo(nx, geo.groundY);
			g.stroke();
			g.restore();
			/* 網頂標籤 */
			D.dashed(g, nx, topY, Math.min(W - 4, nx + 20), topY, { color: C.inkFaint, width: 1 });
			D.label(g, '網頂 2.43 m', Math.min(W - 4, nx + 22), topY,
				{ color: C.inkDim, size: 10, align: 'left', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
			/* 底線 */
			D.line(g, PX(0), PY(p.y0), PX(0), geo.groundY, { color: 'rgba(60,50,36,0.5)', width: 1 });
			D.label(g, '發球 2.0 m', PX(0) + 5, PY(p.y0) - 9,
				{ color: C.inkDim, size: 10, align: 'left', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
		}

		/* ---- 情境 3: 消防水柱 ---- */
		function sceneFire(g, W, H, geo, st) {
			var p = st.p;
			skyTop(g, W, H, '#e4c8a4', '#ecd9bc', '#e6dcc8');
			/* 對面的樓: 磚牆 */
			var wallX = PX(p.xT - 2.2);
			var wallY = PY(9.4);
			g.save();
			g.fillStyle = '#9a5f47';
			g.fillRect(wallX, wallY, W - wallX, geo.groundY - wallY);
			g.strokeStyle = 'rgba(70,38,26,0.28)';
			g.lineWidth = 1;
			for (var yy = wallY; yy < geo.groundY; yy += 9) {
				g.beginPath();
				g.moveTo(wallX, yy);
				g.lineTo(W, yy);
				g.stroke();
			}
			for (var x2 = wallX + 22; x2 < W; x2 += 34) {
				g.fillStyle = 'rgba(40,34,30,0.55)';
				g.fillRect(x2, PY(8.4), 12, 16);
			}
			g.restore();
			soil(g, W, H, geo.groundY, '#9d9a92', '#7f7d76');
			g.strokeStyle = '#6c6a64';
			g.beginPath();
			g.moveTo(0, geo.groundY + 0.5);
			g.lineTo(W, geo.groundY + 0.5);
			g.stroke();
			/* 火點: 光暈 + 火焰 */
			var fx = PX(p.xT);
			var fy = PY(p.yT);
			var glow = g.createRadialGradient(fx, fy, 1, fx, fy, Math.max(14, 1.1 * map.s));
			glow.addColorStop(0, 'rgba(255,196,92,0.85)');
			glow.addColorStop(0.55, 'rgba(240,132,48,0.35)');
			glow.addColorStop(1, 'rgba(240,132,48,0)');
			g.fillStyle = glow;
			g.beginPath();
			g.arc(fx, fy, Math.max(14, 1.1 * map.s), 0, Math.PI * 2);
			g.fill();
			var fh = Math.max(9, 0.7 * map.s);
			g.save();
			g.fillStyle = '#e2621f';
			g.beginPath();
			g.moveTo(fx - fh * 0.42, fy + fh * 0.5);
			g.quadraticCurveTo(fx - fh * 0.1, fy - fh * 0.7, fx, fy - fh);
			g.quadraticCurveTo(fx + fh * 0.12, fy - fh * 0.5, fx + fh * 0.42, fy + fh * 0.5);
			g.closePath();
			g.fill();
			g.fillStyle = '#f3b53c';
			g.beginPath();
			g.moveTo(fx - fh * 0.2, fy + fh * 0.5);
			g.quadraticCurveTo(fx, fy - fh * 0.35, fx + fh * 0.12, fy + fh * 0.5);
			g.closePath();
			g.fill();
			g.restore();
			D.label(g, '火點 6.0 m', Math.max(4, fx - 20), fy - fh - 8,
				{ color: C.ink, size: 10, align: 'center', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
			/* 水龍頭 */
			var nx = PX(0);
			var ny = PY(p.y0);
			D.line(g, nx - 6, ny, nx + 2, ny, { color: '#3f4a52', width: 3 });
			D.line(g, nx - 6, geo.groundY, nx - 6, ny, { color: '#5b6a74', width: 3 });
			D.dot(g, nx + 2, ny, 2.2, { color: '#2c353b', fill: '#2c353b', stroke: false });
		}

		/* ---- 情境 4: 無人機投遞 ---- */
		function sceneDrone(g, W, H, geo, st) {
			skyTop(g, W, H, '#b7d4e6', '#dbe9f0', '#eaf0e6');
			g.fillStyle = 'rgba(255,255,255,0.5)';
			for (var ci = 0; ci < 2; ci++) {
				var cx = W * (0.3 + ci * 0.45);
				var cy = geo.groundY * (0.18 + ci * 0.08);
				g.beginPath();
				g.ellipse(cx, cy, W * 0.09, W * 0.032, 0, 0, Math.PI * 2);
				g.fill();
			}
			soil(g, W, H, geo.groundY, '#8aa566', '#6f8a50');
			g.strokeStyle = '#5d7444';
			g.lineWidth = 1;
			g.beginPath();
			g.moveTo(0, geo.groundY + 0.5);
			g.lineTo(W, geo.groundY + 0.5);
			g.stroke();
			/* 目標靶 */
			var tx = PX(DRONE_TARGET);
			var r = Math.max(5, 0.55 * map.s);
			for (var k2 = 3; k2 >= 1; k2--) {
				D.arc(g, tx, geo.groundY, r * k2 / 3, Math.PI, Math.PI * 2,
					{ color: k2 === 3 ? '#b8442a' : '#b8442a', width: k2 === 1 ? 2 : 1.2 });
			}
			D.line(g, tx, geo.groundY, tx, geo.groundY - r * 1.5, { color: '#6e6a62', width: 1 });
			D.label(g, '30 m 目標', Math.min(W - 4, tx + 5), geo.groundY - r * 1.5 - 6,
				{ color: C.inkDim, size: 10, align: 'left', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
			/* 無人機水平航線 */
			D.dashed(g, PX(0), PY(st.y0), PX(Math.min(st.xLand, map.xmax)), PY(st.y0),
				{ color: C.inkFaint, width: 1, dash: [3, 5] });
		}

		/* 無人機本體（跟著包裹同一個 x: 兩者的水平速度一樣） */
		function droneBody(g, x, y, f) {
			var cx = PX(x);
			var cy = PY(y);
			var bw = ctx.clamp(0.62 * map.s, Math.max(20, Math.min(view.w, view.h) * 0.055), 46);
			var bh = bw * 0.34;
			D.line(g, cx - bw * 0.55, cy - bh * 0.9, cx + bw * 0.55, cy - bh * 0.9, { color: '#4a4e52', width: 1.6 });
			for (var i = 0; i < 2; i++) {
				var ax = cx + (i ? bw * 0.5 : -bw * 0.5);
				D.arc(g, ax, cy - bh * 1.35, bw * 0.26, 0, Math.PI * 2, { color: 'rgba(70,74,78,0.75)', width: 1.2 });
				D.line(g, ax, cy - bh * 0.9, ax, cy - bh * 1.35, { color: '#4a4e52', width: 1.4 });
			}
			g.save();
			g.fillStyle = '#3d4246';
			g.beginPath();
			g.ellipse(cx, cy - bh * 0.45, bw * 0.34, bh * 0.6, 0, 0, Math.PI * 2);
			g.fill();
			g.fillStyle = '#8d9296';
			g.beginPath();
			g.ellipse(cx + bw * 0.1, cy - bh * 0.55, bw * 0.12, bh * 0.24, 0, 0, Math.PI * 2);
			g.fill();
			g.restore();
			if (f) {
				/* 水平速度箭頭: 無人機只有水平速度 */
				D.arrow(g, cx + bw * 0.4, cy - bh * 0.45, cx + bw * 0.4 + Math.max(12, bw * 0.7), cy - bh * 0.45,
					{ color: C.accent, width: 1.3, head: 5 });
			}
		}

		function draw() {
			var g = view.ctx2d;
			var W = view.w;
			var H = view.h;
			if (!g || W < 40 || H < 40) return;

			var st = shot();
			var geo = fit(W, H, st, st.p.base);
			var vd = judge(st);

			if (st.p.id === 'hoop') sceneHoop(g, W, H, geo, st);
			else if (st.p.id === 'volley') sceneVolley(g, W, H, geo, st);
			else if (st.p.id === 'fire') sceneFire(g, W, H, geo, st);
			else sceneDrone(g, W, H, geo, st);

			/* 兩個解: 細虛線（只在有解時畫，畫成點線以免和目前的實線混淆） */
			var sol = (st.p.id === 'hoop' || st.p.id === 'fire')
				? solveAngles(st.p.xT, st.p.yT - st.y0, st.u) : null;
			if (sol) {
				for (var si = 0; si < 2; si++) {
					var rad = sol[si] * Math.PI / 180;
					traj(g, {
						ux: st.u * Math.cos(rad), uy: st.u * Math.sin(rad), y0: st.y0,
						tLand: (st.u * Math.sin(rad) + Math.sqrt(Math.pow(st.u * Math.sin(rad), 2) + 2 * G * st.y0)) / G,
						xLand: st.p.xT * 1.35, p: st.p
					}, 'rgba(96,92,84,0.55)', 0.9);
				}
				D.label(g, '細點線：兩個命中解', map.ox + 2, geo.m + 26,
					{ color: C.inkFaint, size: 10, align: 'left', bg: 'rgba(248,246,241,0.86)', pad: 2 });
			}

			/* 目前的弧: 水柱那一格不畫墨線 —— 水柱本身就是軌跡, 畫兩條會互相蓋住 */
			if (st.p.id === 'fire') {
				/* 交給下面的水柱 */
			} else if (st.p.id !== 'drone') traj(g, st, C.ink, 1.35);
			else {
				/* 包裹: x 與無人機相同, y 由能量關係掉下來 */
				var tp = st.tLand * phase;
				var pxr = st.u * tp;
				var pyr = st.y0 - 0.5 * G * tp * tp;
				D.dashed(g, PX(pxr), PY(st.y0), PX(pxr), PY(pyr), { color: 'rgba(60,56,50,0.5)', width: 1, dash: [2, 3] });
				/* 已走過的拋物線 */
				for (var i2 = 0; i2 <= 26; i2++) {
					var tt = st.tLand * i2 / 26;
					if (tt > tp) break;
					D.dot(g, PX(st.u * tt), PY(st.y0 - 0.5 * G * tt * tt), 1.1, { color: C.ink, fill: C.ink, stroke: false });
				}
				/* 包裹 */
				g.save();
				g.fillStyle = '#a8763f';
				g.strokeStyle = '#6f4a24';
				g.lineWidth = 1;
				var s2 = Math.max(4, 0.34 * map.s);
				g.beginPath();
				g.rect(PX(pxr) - s2 / 2, PY(pyr) - s2 / 2, s2, s2);
				g.fill();
				g.stroke();
				g.restore();
				droneBody(g, pxr, st.y0, true);
				D.label(g, '包裹在機身正下方', Math.min(W - 4, PX(pxr) + 8), PY(pyr) - 10,
					{ color: C.inkDim, size: 10, align: PX(pxr) + 8 > W - 100 ? 'right' : 'left', bg: 'rgba(248,246,241,0.86)', pad: 2 });
			}

			/* 關鍵 x 的垂直線與高度值 */
			if (st.p.id !== 'drone') {
				var cx = PX(st.p.xT);
				D.dashed(g, cx, PY(st.p.yT), cx, geo.groundY, { color: C.inkFaint, width: 1, dash: [2, 4] });
				var txt = st.reached
					? 'y(' + num(st.p.xT, 1) + ' m) = ' + num(st.yAtXT, 2) + ' m'
					: '未達 ' + num(st.p.xT, 1) + ' m';
				D.label(g, txt, cx + (cx > W - 80 ? -6 : 6), geo.groundY - 8,
					{ color: C.inkDim, size: 10, align: cx > W - 80 ? 'right' : 'left', mono: true, bg: 'rgba(248,246,241,0.9)', pad: 2 });
			}

			/* 判定: 畫在左上角, 與讀數同一句話 */
			D.label(g, vd.t, map.ox + 2, geo.m + 12, {
				color: vd.acc ? C.accent : C.inkDim, size: 12, align: 'left', bg: 'rgba(248,246,241,0.9)', pad: 3
			});

			/* 球 / 水柱末端 */
			if (st.p.id !== 'drone') {
				var t = st.tLand * phase;
				var bx = st.u * Math.cos(st.rad) * t;
				var by = st.y0 + st.u * Math.sin(st.rad) * t - 0.5 * G * t * t;
				var rb = ctx.clamp(Math.min(W, H) * 0.019, 3, 6);
				if (st.p.id === 'hoop') {
					g.save();
					g.beginPath();
					g.arc(PX(bx), PY(by), rb, 0, Math.PI * 2);
					g.fillStyle = '#d0762d';
					g.fill();
					g.strokeStyle = '#7c3f14';
					g.lineWidth = 1;
					g.stroke();
					g.beginPath();
					g.moveTo(PX(bx) - rb, PY(by));
					g.lineTo(PX(bx) + rb, PY(by));
					g.moveTo(PX(bx), PY(by) - rb);
					g.lineTo(PX(bx), PY(by) + rb);
					g.strokeStyle = 'rgba(90,44,12,0.75)';
					g.lineWidth = 0.9;
					g.stroke();
					g.restore();
				} else if (st.p.id === 'volley') {
					ballAt(g, st, bx, by, rb, '#f2f2ee', '#8d8f88');
				} else {
					/* 水柱: 由噴嘴到落點逐漸收細的點串(整條水柱同時存在, 不是一顆水珠在跑);
					   前端另外點一顆水滴, 讓動態有東西可看 */
					/* 水撞到牆就停; 澆不到時它會先落地 */
					var tStop = st.tLand;
					if (st.reached && st.tAtXT < tStop) tStop = st.tAtXT;
					var n2 = Math.max(24, Math.round((st.u * Math.cos(st.rad) * tStop * map.s) / 4));
					for (var q = 0; q <= n2; q++) {
						var f = q / n2;
						var tq = tStop * f;
						var xq = st.u * Math.cos(st.rad) * tq;
						var yq = st.y0 + st.u * Math.sin(st.rad) * tq - 0.5 * G * tq * tq;
						if (yq < -0.3) break;
						var rr = Math.max(0.9, 2.8 - 1.6 * f);
						D.dot(g, PX(xq), PY(yq), rr, {
							color: 'rgba(58,112,146,' + (0.9 - 0.35 * f).toFixed(2) + ')',
							fill: 'rgba(74,140,180,' + (0.9 - 0.35 * f).toFixed(2) + ')', stroke: false
						});
					}
					D.dot(g, PX(bx), PY(by), 3.1, { color: '#356c8c', fill: '#4f93b8', stroke: false });
				}
			}
		}

		/* ---------------- 互動 ---------------- */

		function setU(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 5, 30) * 2) / 2;
			PRE[idx].u = n;
			syncUI();
			draw();
		}

		function setTh(v) {
			if (!isFinite(v)) return;
			var n = Math.round(ctx.clamp(v, 0, 85));
			curTh = n;
			PRE[idx].th = n;
			syncUI();
			draw();
		}

		function setPreset(next) {
			if (next === idx) return;
			idx = next;
			curTh = PRE[idx].th;
			for (var i = 0; i < btns.length; i++) {
				var on = i === idx;
				btns[i].classList.toggle('is-on', on);
				btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
			}
			phase = 0;
			syncUI();
			draw();
		}

		inU.addEventListener('input', function () { setU(parseFloat(inU.value)); });
		inT.addEventListener('input', function () { setTh(parseFloat(inT.value)); });
		inH.addEventListener('input', function () {
			var v = parseFloat(inH.value);
			if (!isFinite(v)) return;
			hDrone = ctx.clamp(v, 10, 40);
			syncUI();
			draw();
		});

		for (var qi = 0; qi < btns.length; qi++) {
			(function (i) {
				btns[i].addEventListener('click', function () { setPreset(i); });
			})(qi);
		}

		function phaseFromPointer(clientX) {
			var st = shot();
			if (!(st.tLand > 0) || !(st.ux > 0.0001)) return;
			var r = canvas.getBoundingClientRect();
			var xm = (clientX - r.left - map.ox) / map.s;
			var t = xm / st.ux;
			phase = ctx.clamp(t / st.tLand, 0, 1);
			draw();
		}

		canvas.addEventListener('pointerdown', function (e) {
			scrubbing = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒有可捕捉的指標 */ }
			e.preventDefault();
			playing = false;
			phaseFromPointer(e.clientX);
		});
		canvas.addEventListener('pointermove', function (e) {
			if (!scrubbing) return;
			e.preventDefault();
			phaseFromPointer(e.clientX);
		});
		function endScrub(e) {
			if (!scrubbing) return;
			scrubbing = false;
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
				canvas.releasePointerCapture(e.pointerId);
			}
		}
		canvas.addEventListener('pointerup', endScrub);
		canvas.addEventListener('pointercancel', endScrub);

		ctx.onResize(draw);

		curTh = PRE[0].th;
		syncUI();
		draw();

		if (!ctx.reduced) {
			ctx.raf(function (dt) {
				var st = shot();
				if (playing) {
					phase += st.tLand > 0 ? dt / Math.max(1.6, st.tLand * 1.15) : 0;
					if (phase > 1) phase = 0;
				}
				draw();
			});
		}

		return { destroy: function () { canvas = null; } };
	});
})();
