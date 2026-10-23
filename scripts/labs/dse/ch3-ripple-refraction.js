/**
 * ch3-ripple-refraction.js — 水波跨介質：f 不變 (lab id: ripple-refraction)
 *
 * 兩區的波前刻意用「同一個相位分數」推位置: 頻率由波源鎖住, 所以同一瞬間兩個
 * 介質各有一條波前穿過介面點 P —— 波前在 P 折彎就是這樣來的。若兩區各走各的
 * 相位, 交界處會出現不該有的錯位。
 * 角度一律自法線量起 (i、r 都是); 法線是垂直介面的虛線。
 * 比例尺由畫面「高度」定 (pxPerM = 0.18h), 寬高比怎麼變都還有 8–9 條波前可數。
 */
(function () {
	'use strict';

	var I_MIN = 0, I_MAX = 75, I_STEP = 1;
	var V1_MIN = 0.8, V1_MAX = 1.4, V1_STEP = 0.02;
	var V2_MIN = 0.3, V2_MAX = 1.2, V2_STEP = 0.02;
	var F_HZ = 1.2;          /* 波源頻率: 跨介質不變的那個量 */
	var DEG = Math.PI / 180;

	window.DSELab.define('ripple-refraction', function (mount, ctx) {
		var C = ctx.colors;
		var D = window.DSEDraw;
		var doc = document;

		var st = { i: 30, v1: 1.2, v2: 0.6 };
		var lastTex = '';
		var lastT = 0;
		var dragging = false;

		function mk(tag, cls, text) {
			var el = doc.createElement(tag);
			if (cls) el.className = cls;
			if (text != null) el.textContent = text;
			return el;
		}

		function clampNum(v, a, b) { return v < a ? a : v > b ? b : v; }
		function round2(v) { return Math.round(v * 100) / 100; }

		/* ---------------------------------------------------------------- DOM */

		var grid = mk('div', 'dl-lab__grid');
		var stage = mk('div', 'dl-lab__stage');
		var wrap = mk('div', 'dl-lab__canvaswrap');
		var canvas = mk('canvas', 'dl-canvas dl-canvas--drag');
		canvas.setAttribute('role', 'img');
		canvas.setAttribute('aria-label', '水波由深水斜射進淺水: 波前折向法線, 頻率不變');
		wrap.appendChild(canvas);
		wrap.appendChild(mk('p', 'dl-hint md-hint', '拖動上端箭頭改入射角'));
		stage.appendChild(wrap);
		grid.appendChild(stage);

		var panel = mk('div', 'dl-lab__panel');
		grid.appendChild(panel);

		var gMed = mk('div', 'dl-panel__group');
		gMed.appendChild(mk('span', 'dl-panel__label', '兩種介質'));
		var fV1 = makeField('深水 v₁', V1_MIN, V1_MAX, V1_STEP, st.v1, 'm/s', 2, onV1);
		var fV2 = makeField('淺水 v₂', V2_MIN, V2_MAX, V2_STEP, st.v2, 'm/s', 2, onV2);
		gMed.appendChild(fV1.row);
		gMed.appendChild(fV2.row);
		panel.appendChild(gMed);

		var gGeo = mk('div', 'dl-panel__group');
		gGeo.appendChild(mk('span', 'dl-panel__label', '入射方向'));
		var fI = makeField('入射角 i', I_MIN, I_MAX, I_STEP, st.i, '°', 0, onAngle);
		gGeo.appendChild(fI.row);
		panel.appendChild(gGeo);

		var roF = readout('頻率 f');
		var roL1 = readout('λ₁ = v₁/f');
		var roL2 = readout('λ₂ = v₂/f');
		var roR = readout('折射角 r');
		var roBox = mk('div', 'dl-readouts');
		roBox.appendChild(roF.row);
		roBox.appendChild(roL1.row);
		roBox.appendChild(roL2.row);
		roBox.appendChild(roR.row);
		panel.appendChild(roBox);

		var texEl = mk('p', 'md-formula');
		panel.appendChild(texEl);
		var note = mk('p', 'dl-note', '');
		panel.appendChild(note);

		mount.appendChild(grid);

		/* ------------------------------------------------------------ 控件 */

		function makeField(labelText, min, max, step, value, unit, digits, onInput) {
			var row = mk('div', 'dl-field md-field');
			row.appendChild(mk('span', 'dl-field__label', labelText));
			var input = doc.createElement('input');
			input.type = 'range';
			input.className = 'dl-range';
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(value);
			input.setAttribute('aria-label', labelText);
			var out = mk('output', 'dl-field__val', value.toFixed(digits) + joinUnit(unit));
			input.addEventListener('input', function () {
				var val = parseFloat(input.value);
				if (!isFinite(val)) return;
				onInput(val);
			});
			row.appendChild(input);
			row.appendChild(out);
			return { row: row, input: input, out: out, digits: digits, unit: unit };
		}

		/* 角度符號貼著數字 ("30°"), 其他單位空一格 ("1.20 m/s") */
		function joinUnit(unit) { return unit === '°' ? unit : ' ' + unit; }

		function syncField(f, value) {
			var txt = String(value);
			if (f.input.value !== txt) f.input.value = txt;
			f.out.textContent = value.toFixed(f.digits) + joinUnit(f.unit);
		}

		function readout(k) {
			var row = mk('span', 'dl-readout');
			row.appendChild(mk('span', 'dl-readout__k md-key', k));
			var val = mk('span', 'dl-readout__v', '—');
			row.appendChild(val);
			return { row: row, val: val };
		}

		function onV1(val) {
			st.v1 = clampNum(val, V1_MIN, V1_MAX);
			/* v₂ 只能小於 v₁: 跨介質折射要求 v₂/v₁ < 1, 不然 sin r 會大於 1 */
			if (st.v2 > st.v1 - 0.019) st.v2 = Math.max(V2_MIN, round2(st.v1 - 0.02));
			refresh();
		}

		function onV2(val) {
			st.v2 = clampNum(Math.min(val, round2(st.v1 - 0.02)), V2_MIN, V2_MAX);
			refresh();
		}

		function onAngle(val) {
			st.i = clampNum(Math.round(val), I_MIN, I_MAX);
			refresh();
		}

		/* ------------------------------------------------------------ 幾何 */

		var view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		function refrAngle() {
			var s = (st.v2 / st.v1) * Math.sin(st.i * DEG);
			if (!isFinite(s)) return 0;
			return Math.asin(clampNum(s, -1, 1));
		}

		function handleRadius(h, py, px) {
			return Math.max(30, Math.min(h * 0.34, px * 0.9, py - 22));
		}

		/* ------------------------------------------------------------ 繪圖 */

		function draw(t) {
			var g = view.ctx2d;
			if (!g) return;
			var w = view.w, h = view.h;
			if (w < 4 || h < 4) return;

			var yi = Math.round(h * 0.46);
			var px = Math.round(w * 0.36);
			var py = yi;
			var iRad = st.i * DEG;
			var rRad = refrAngle();
			var s1 = Math.sin(iRad), c1 = Math.cos(iRad);
			var s2 = Math.sin(rRad), c2 = Math.cos(rRad);
			var pxPerM = h * 0.18;
			var lam1 = (st.v1 / F_HZ) * pxPerM;
			var lam2 = (st.v2 / F_HZ) * pxPerM;
			var p = (t * F_HZ) % 1;
			if (!(p >= 0)) p = 0;
			var R = handleRadius(h, py, px);

			g.clearRect(0, 0, w, h);
			/* 淺水區鋪一層較深的紙: 兩區不能只靠一條線分開 */
			g.fillStyle = C.paper2;
			g.fillRect(0, yi, w, h - yi);

			fronts(g, w, h, px, py, s1, c1, lam1, p, 0, yi);
			fronts(g, w, h, px, py, s2, c2, lam2, p, yi, h);

			D.line(g, 0, yi + 0.5, w, yi + 0.5, { color: C.lineStrong, width: 1 });

			/* 法線 (虛線) */
			D.line(g, px, Math.max(5, py - R - 16), px, Math.min(h - 5, py + R * 0.9), {
				color: C.inkFaint, width: 1, dash: [4, 4]
			});

			/* 三條入射線 + 三條折射線: 箭頭就是傳播方向 */
			var off = Math.min(0.088 * w, 40);
			for (var kk = -1; kk <= 1; kk++) {
				var ox = c1 * off * kk, oy = -s1 * off * kk;      /* 垂直於入射方向 */
				var qx = px + ox, qy = py + oy;
				var tt = c1 > 1e-6 ? (py - qy) / c1 : 0;
				var ex = qx + s1 * tt;
				var ey = py;
				if (c1 > 1e-6) {
					var L1 = ey / c1;
					if (L1 > 6 && ex > -40 && ex < w + 40) {
						D.arrow(g, ex - s1 * L1, ey - c1 * L1, ex, ey, {
							color: kk === 0 ? C.inkDim : C.inkFaint, width: 1, head: 5
						});
					}
				}
				var remY = c2 > 1e-6 ? (h - 5 - ey) / c2 : 0;
				var remX = s2 > 1e-6 ? (w - 5 - ex) / s2 : 1e9;
				var L2 = Math.min(remY, remX);
				if (L2 > 8 && ex > -20 && ex < w - 4) {
					D.arrow(g, ex, ey, ex + s2 * L2, ey + c2 * L2, {
						color: kk === 0 ? C.ink : C.inkFaint, width: 1, head: 5
					});
				}
			}

			/* λ 的量法: 沿射線量相鄰兩條波前的距離, 兩端各打一個垂直小刻度 */
			var len1 = py / Math.max(c1, 0.26);
			if (lam1 < 0.72 * len1) {
				var sA1 = 0.30 * len1;
				dimMark(g, w, h,
					px - s1 * sA1, py - c1 * sA1,
					px - s1 * (sA1 + lam1), py - c1 * (sA1 + lam1),
					chipLam('λ₁', st.v1 / F_HZ, w), C.paper0);
			}
			var len2 = (h - 5 - py) / Math.max(c2, 0.26);
			if (lam2 < 0.60 * len2) {
				var sA2 = 0.45 * len2;
				dimMark(g, w, h,
					px + s2 * sA2, py + c2 * sA2,
					px + s2 * (sA2 + lam2), py + c2 * (sA2 + lam2),
					chipLam('λ₂', st.v2 / F_HZ, w), C.paper2);
			}

			/* 波速方向標籤: 擺在射線的另一側, 不跟 λ 標籤打架 */
			var lv1x = px - s1 * (0.72 * len1) - c1 * 12;
			var lv1y = py - c1 * (0.72 * len1) + s1 * 12;
			D.label(g, 'v₁', clampNum(lv1x, 14, w - 14), clampNum(lv1y, 12, yi - 12), {
				color: C.inkDim, size: 10, mono: true, align: 'center', bg: C.paper0, pad: 2
			});
			var d2 = Math.min(0.80 * len2, 150);
			D.label(g, 'v₂', clampNum(px + s2 * d2 - c2 * 12, 14, w - 14),
				clampNum(py + c2 * d2 + s2 * 12, yi + 12, h - 12), {
				color: C.ink, size: 10, mono: true, align: 'center', bg: C.paper2, pad: 2
			});

			/* 入射角 / 折射角 的弧與標籤 */
			var ra = Math.max(20, Math.min(R * 0.46, 42));
			var rb = Math.max(16, Math.min(R * 0.36, 32));
			if (st.i > 1.5) {
				D.arc(g, px, py, ra, -Math.PI / 2, -Math.PI / 2 - iRad, { color: C.inkDim, width: 1, ccw: true });
			}
			if (rRad > 0.02) {
				D.arc(g, px, py, rb, Math.PI / 2, Math.PI / 2 - rRad, { color: C.inkDim, width: 1, ccw: true });
			}
			var mi = -Math.PI / 2 - iRad / 2;
			D.tag(g, 'i ' + st.i.toFixed(0) + '°',
				clampNum(px + Math.cos(mi) * (ra + 16), 26, w - 26),
				clampNum(py + Math.sin(mi) * (ra + 16), 12, yi - 12),
				{ color: C.ink, fill: C.paper0, size: 10 });
			var mr = Math.PI / 2 - rRad / 2;
			D.tag(g, 'r ' + (rRad / DEG).toFixed(1) + '°',
				clampNum(px + Math.cos(mr) * (rb + 16), 26, w - 26),
				clampNum(py + Math.sin(mr) * (rb + 16), yi + 12, h - 12),
				{ color: C.ink, fill: C.paper2, size: 10 });

			/* 可拖的握把: 入射線的遠端 */
			D.handle(g, px - s1 * R, py - c1 * R, { color: C.accent, fill: C.paper0, size: 10, width: 1.2 });

			/* 區域標籤 */
			D.label(g, '深水 v₁', Math.max(4, w * 0.045), Math.max(12, h * 0.10), {
				color: C.inkDim, size: 10.5, mono: true, align: 'left', bg: C.paper0, pad: 2
			});
			D.label(g, '淺水 v₂', Math.max(4, w * 0.045), Math.min(h - 10, yi + h * 0.11), {
				color: C.ink, size: 10.5, mono: true, align: 'left', bg: C.paper2, pad: 2
			});

			/* 全場唯一的重點: f 跨介質不變 */
			D.tag(g, 'f 不變 = ' + F_HZ.toFixed(2) + ' Hz',
				clampNum(w * 0.72, 56, w - 56), Math.max(14, yi - h * 0.13),
				{ color: C.accent, fill: C.paper0, size: 10 });
		}

		function fronts(g, w, h, px, py, sd, cd, lam, p, top, bot) {
			if (!(lam > 0.5)) return;
			var nx = cd, ny = -sd;                  /* 垂直於傳播方向 */
			var len = (w + h) * 1.5;
			var mx = Math.min(80, Math.ceil((w + h) / lam) + 2);
			g.save();
			g.beginPath();
			g.rect(0, top, w, bot - top);
			g.clip();
			g.strokeStyle = C.line;
			g.lineWidth = 1;
			g.setLineDash([]);
			g.beginPath();
			for (var m = -mx; m <= mx; m++) {
				var d = (m + p) * lam;
				var cx = px + sd * d;
				var cy = py + cd * d;
				if (cy < top - len || cy > bot + len) continue;
				g.moveTo(cx - nx * len, cy - ny * len);
				g.lineTo(cx + nx * len, cy + ny * len);
			}
			g.stroke();
			g.restore();
		}

		/* 窄畫布上只留符號: 波長值在讀數欄, 晶片太寬會壓到射線與角度標籤 */
		function chipLam(sym, metres, w) {
			return w < 470 ? sym : sym + ' ' + ctx.fmt(metres, 2) + ' m';
		}

		function dimMark(g, w, h, ax, ay, bx, by, text, bg) {
			var dx = bx - ax, dy = by - ay;
			var len = Math.sqrt(dx * dx + dy * dy);
			if (!(len > 22)) return;
			var nx = -dy / len, ny = dx / len;
			D.line(g, ax - nx * 4, ay - ny * 4, ax + nx * 4, ay + ny * 4, { color: C.lineStrong, width: 1 });
			D.line(g, bx - nx * 4, by - ny * 4, bx + nx * 4, by + ny * 4, { color: C.lineStrong, width: 1 });
			D.arrow(g, ax, ay, bx, by, { color: C.inkDim, width: 1, head: 4 });
			D.arrow(g, bx, by, ax, ay, { color: C.inkDim, width: 1, head: 4 });
			var lx = clampNum((ax + bx) / 2 + nx * 15, 34, w - 34);
			var ly = (ay + by) / 2 + ny * 15;
			if (!(ly > 12) || ly > h - 12) return;
			D.label(g, text, lx, ly, { color: C.ink, size: 10.5, mono: true, align: 'center', bg: bg, pad: 2 });
		}

		/* ------------------------------------------------------------ 更新 */

		function refresh() {
			var rDeg = refrAngle() / DEG;
			roF.val.textContent = F_HZ.toFixed(2) + ' Hz';
			roL1.val.textContent = ctx.fmt(st.v1 / F_HZ, 3) + ' m';
			roL2.val.textContent = ctx.fmt(st.v2 / F_HZ, 3) + ' m';
			roR.val.textContent = ctx.fmt(rDeg, 1) + '°';

			syncField(fV1, st.v1);
			syncField(fV2, st.v2);
			syncField(fI, st.i);

			var tex;
			if (st.i < 0.5 || rDeg < 0.1) {
				tex = '\\( \\sin r = \\dfrac{v_2}{v_1}\\sin i = 0 \\;\\Rightarrow\\; r = 0^\\circ \\)';
			} else {
				tex = '\\( \\dfrac{\\sin i}{\\sin r} = \\dfrac{\\sin ' + st.i.toFixed(0) +
					'^\\circ}{\\sin ' + rDeg.toFixed(1) + '^\\circ} = ' + (st.v1 / st.v2).toFixed(2) +
					' = \\dfrac{v_1}{v_2} \\)';
			}
			if (tex !== lastTex) {
				lastTex = tex;
				texEl.textContent = tex;
				ctx.tex(texEl);
			}

			var nt = '頻率由波源決定，跨介質不變；波速變小則波長變短，波前向法線靠攏。';
			if (st.v2 >= round2(st.v1 - 0.02)) nt += ' v₂ 必須小於 v₁，已收在 ' + st.v2.toFixed(2) + ' m/s。';
			if (st.i < 1) nt += ' i = 0：垂直入射不偏折，r = 0。';
			if (ctx.reduced) nt += ' 已依系統設定暫停動態。';
			note.textContent = nt;

			draw(lastT);
		}

		/* ------------------------------------------------------------ 拖曳 */

		function toLocal(e) {
			var r = canvas.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };
		}

		function applyDrag(pp) {
			var w = view.w, h = view.h;
			var px = Math.round(w * 0.36), py = Math.round(h * 0.46);
			var vx = pp.x - px, vy = pp.y - py;
			/* 握把在 P 的上方偏左, 所以入射角 = atan2(−vx, −vy), 自向上的法線量起 */
			var ang = Math.atan2(-vx, -vy) / DEG;
			if (!isFinite(ang)) ang = 0;
			st.i = clampNum(Math.round(ang), I_MIN, I_MAX);
			refresh();
		}

		canvas.addEventListener('pointerdown', function (e) {
			var pp = toLocal(e);
			var w = view.w, h = view.h;
			var R = handleRadius(h, Math.round(h * 0.46), Math.round(w * 0.36));
			var iRad = st.i * DEG;
			var hx = Math.round(w * 0.36) - Math.sin(iRad) * R;
			var hy = Math.round(h * 0.46) - Math.cos(iRad) * R;
			if (Math.abs(pp.x - hx) > 28 || Math.abs(pp.y - hy) > 28) return;
			e.preventDefault();
			dragging = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 舊瀏覽器沒有捕獲 */ }
			applyDrag(pp);
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			applyDrag(toLocal(e));
		});

		function endDrag(e) {
			if (!dragging) return;
			dragging = false;
			try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 已釋放 */ }
		}

		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);

		ctx.onResize(function () { draw(lastT); });

		/* ------------------------------------------------------------ 起跑 */

		refresh();

		if (!ctx.reduced) {
			ctx.raf(function (dt, t) {
				lastT = t;
				draw(t);
			});
		}

		return {
			destroy: function () { dragging = false; }
		};
	});
})();
