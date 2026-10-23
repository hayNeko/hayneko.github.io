/**
 * ch3-grating.js — 衍射光柵（lab id: grating）
 *
 * 為什麼所有亮點都放在同一段圓弧上：光柵的衍射角只由 d 與 λ 決定，與「離光柵
 * 多遠」無關；把弧的半徑取成固定值，弧上的位置就是角度本身，量角器臂才對得上
 * 讀數。弧的半徑被畫布高度鎖住（半圓），右邊剩下的空白留給算式欄，不硬拉伸
 * 角度，否則「θ = 36.9°」看起來就不是 36.9°。
 */
(function () {
	'use strict';

	var DD = window.DSEDraw;
	var LAM_MIN = 400e-9, LAM_MAX = 700e-9;   /* 白光的取樣範圍 */
	var SNAP = 1.5;                            /* 吸附容差（度）：手指誤差之內，又不至於抓不住中間角度 */

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	function fx(n, d) {
		return isFinite(n) ? n.toFixed(d) : '—';
	}

	/* 光譜色：白光模式要用的顏色本身就是被示範的量（λ→色），只能由公式生成，
	   所以這裡輸出 hsl，沒有任何寫死的色值。 */
	function spectral(nm) {
		var t = (nm - 380) / 320;
		if (!(t >= 0)) t = 0;
		if (t > 1) t = 1;
		return 'hsl(' + Math.round(270 - 270 * Math.pow(t, 0.92)) + ', 68%, 46%)';
	}

	var seq = 0;

	function field(labelText, min, max, step, value, shown) {
		var id = 'wo-gr-' + (++seq);
		var wrap = el('div', 'dl-field');
		var lab = el('label', 'dl-field__label', labelText);
		lab.htmlFor = id;
		var inp = document.createElement('input');
		inp.type = 'range';
		inp.className = 'dl-range';
		inp.id = id;
		inp.min = String(min);
		inp.max = String(max);
		inp.step = String(step);
		inp.value = String(value);
		inp.setAttribute('aria-valuetext', shown);
		var out = el('output', 'dl-field__val', shown);
		out.htmlFor = id;
		wrap.appendChild(lab);
		wrap.appendChild(inp);
		wrap.appendChild(out);
		return { wrap: wrap, input: inp, out: out, label: lab };
	}

	function readoutRow(key) {
		var row = el('span', 'dl-readout');
		row.appendChild(el('span', 'dl-readout__k', key));
		var v = el('span', 'dl-readout__v', '—');
		row.appendChild(v);
		return { row: row, v: v };
	}

	window.DSELab.define('grating', function (mount, ctx) {
		var C = ctx.colors;
		var st = { lpm: 500, lambda: 600e-9, white: false, arm: 0 };
		var L = { gx: 100, cy: 100, R: 80 };
		var phys = { d: 2e-6, nmax: 3, nth: 0, th1: 0, th2: 0, seen: 3 };
		var lastT = 0;

		var noteText = '每毫米刻線數要先換算成每米（ℓ 每 mm ＝ 1000ℓ 每 m）；' +
			'光柵條紋又窄又亮，不能套楊氏雙縫的 Δy 公式。白光時各級的紅端張得最開，' +
			'所以高級數會先從藍端被切掉。' +
			(ctx.reduced ? '已依系統設定暫停動態。' : '');

		/* ---------------------------------------------------------------- 版面 */
		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrapEl = el('div', 'dl-lab__canvaswrap');
		var canvas = document.createElement('canvas');
		canvas.className = 'dl-canvas dl-canvas--drag';
		canvas.tabIndex = 0;
		canvas.setAttribute('aria-label', '衍射光柵：拖動量角器臂測量衍射角');
		wrapEl.appendChild(canvas);
		wrapEl.appendChild(el('p', 'dl-hint', '拖動量角器臂的末端'));
		stage.appendChild(wrapEl);

		var panel = el('div', 'dl-lab__panel');

		var gGrating = el('div', 'dl-panel__group');
		gGrating.appendChild(el('span', 'dl-panel__label', '光柵與光'));
		var fL = field('刻線 ℓ /mm', 100, 600, 10, 500, '500');
		var fLam = field('波長 λ', 380, 700, 5, 600, '600 nm');
		gGrating.appendChild(fL.wrap);
		gGrating.appendChild(fLam.wrap);

		var gView = el('div', 'dl-panel__group');
		gView.appendChild(el('span', 'dl-panel__label', '顯示'));
		var segEl = el('div', 'dl-seg');
		var btnWhite = el('button', 'dl-btn', '白光');
		btnWhite.type = 'button';
		btnWhite.setAttribute('aria-pressed', 'false');
		segEl.appendChild(btnWhite);
		gView.appendChild(segEl);

		var roEl = el('div', 'dl-readouts');
		/* 標籤避開拉丁字母與下標：.dl-readout__k 會轉大寫，µm 會變成希臘大寫 Μ。
		   單位與符號改放中文標籤與數值欄，case 才不會被吃掉。 */
		var rDnm = readoutRow('刻線距（奈米）');
		var rDum = readoutRow('刻線距（微米）');
		var rNmax = readoutRow('級數上限');
		var rSeen = readoutRow('最高級數');
		var rT1 = readoutRow('一級角');
		var rT2 = readoutRow('二級角');
		roEl.appendChild(rDnm.row);
		roEl.appendChild(rDum.row);
		roEl.appendChild(rNmax.row);
		roEl.appendChild(rSeen.row);
		roEl.appendChild(rT1.row);
		roEl.appendChild(rT2.row);

		var formula = el('p', 'wo-formula', '\\( d\\sin\\theta = n\\lambda \\)　\\( d = \\dfrac{1}{\\ell} \\)');
		var live = el('p', 'wo-live', '');
		var note = el('p', 'dl-note', noteText);

		panel.appendChild(gGrating);
		panel.appendChild(gView);
		panel.appendChild(roEl);
		panel.appendChild(formula);
		panel.appendChild(live);
		panel.appendChild(note);

		grid.appendChild(stage);
		grid.appendChild(panel);
		mount.appendChild(grid);
		ctx.tex(formula);

		var view = ctx.setupCanvas(canvas, { aspect: '16 / 10' });

		/* ---------------------------------------------------------------- 物理 */
		function dOf() {
			return 1 / (st.lpm * 1000);              /* ℓ 每 mm → 每 m，再取倒數 */
		}

		function thetaDeg(n, lam) {
			var x = n * lam / dOf();
			if (!(x >= 0)) x = 0;
			if (x > 1) x = 1;
			return Math.asin(x) * 180 / Math.PI;
		}

		function compute() {
			var d = dOf();
			phys.d = d;
			/* 浮點：d/λ 剛好整數時 floor 可能少一級，給一點餘裕 */
			phys.nmax = Math.max(0, Math.floor(d / st.lambda + 1e-9));
			phys.th1 = phys.nmax >= 1 ? thetaDeg(1, st.lambda) : NaN;
			phys.th2 = phys.nmax >= 2 ? thetaDeg(2, st.lambda) : NaN;
			/* 白光時能看到的最高級數由最短的波長（藍端）決定，與 λ 滑桿無關 */
			phys.seen = st.white ? Math.max(0, Math.floor(d / LAM_MIN + 1e-9)) : phys.nmax;
		}

		function snapped() {
			var best = st.arm, hit = 0, best2 = SNAP;
			if (Math.abs(st.arm) < best2) { best = 0; hit = 0; best2 = Math.abs(st.arm); }
			var top = Math.min(phys.nmax, 6);
			for (var n = 1; n <= top; n++) {
				var th = thetaDeg(n, st.lambda);
				var dd1 = Math.abs(st.arm - th);
				if (dd1 < best2) { best2 = dd1; best = th; hit = n; }
				var dd2 = Math.abs(st.arm + th);
				if (dd2 < best2) { best2 = dd2; best = -th; hit = -n; }
			}
			/* hit 要另外回報：n = 0 既是「吸附到中央」也是「沒吸附」 */
			return { deg: best, n: hit, hit: best2 < SNAP };
		}

		function set(node, text) {
			if (node.textContent !== text) node.textContent = text;
		}

		function syncDom() {
			var d = phys.d;
			set(rDnm.v, fx(d * 1e9, 0));
			set(rDum.v, fx(d * 1e6, 3));
			set(rNmax.v, String(phys.nmax));
			set(rSeen.v, String(phys.seen));
			set(rT1.v, isFinite(phys.th1) ? fx(phys.th1, 2) + '°' : '—');
			set(rT2.v, isFinite(phys.th2) ? fx(phys.th2, 2) + '°' : '—');
			set(fL.out, String(st.lpm));
			set(fLam.out, Math.round(st.lambda * 1e9) + ' nm');
			var sn = snapped();
			set(live, 'd = 1 ÷ (' + st.lpm + '/mm × 1000) = ' + fx(d * 1e9, 0) + ' nm；' +
				'臂 θ = ' + fx(sn.deg, 1) + '°' + (sn.n ? '（吸附 ±' + Math.abs(sn.n) + ' 級）' : ''));
		}

		/* ---------------------------------------------------------------- 繪圖 */
		function draw(t) {
			var g = view.ctx2d;
			var w = view.w, h = view.h;
			if (!g || w < 8 || h < 8) return;
			g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
			g.clearRect(0, 0, w, h);

			var cy = h / 2;
			var gx = Math.max(46, w * 0.30);
			var R = Math.max(16, Math.min(h / 2 - 15, w * 0.46));
			L.gx = gx; L.cy = cy; L.R = R;

			var d = phys.d;
			var nshow = Math.min(phys.nmax, 6);
			var topN = Math.min(phys.seen, 6);

			/* 1. 入射光 */
			var bx0 = Math.max(8, gx - R * 0.62);
			DD.arrow(g, bx0, cy, gx - 3, cy, { color: C.ink, width: 1.4, head: 6 });
			DD.label(g, st.white ? '白光' : '入射光', bx0, cy - 9,
				{ mono: true, size: 10, color: C.inkDim });

			/* 2. 光柵：一條實線加上一排細刻線，才讀得出「每 mm 幾百條」 */
			var gTop = cy - R * 0.74, gBot = cy + R * 0.74;
			DD.line(g, gx, gTop, gx, gBot, { color: C.lineStrong, width: 1.2 });
			var ticks = 15;
			var step = (gBot - gTop) / (ticks - 1);
			var tickLen = Math.max(4, Math.min(9, R * 0.07));
			g.strokeStyle = C.inkFaint;
			g.lineWidth = 1;
			g.beginPath();
			for (var i = 0; i < ticks; i++) {
				var ty = gTop + i * step;
				g.moveTo(gx + 1, ty);
				g.lineTo(gx + 1 + tickLen, ty);
			}
			g.stroke();

			/* 3. 半圓屏與零級軸 */
			DD.arc(g, gx, cy, R, -Math.PI / 2, Math.PI / 2, { color: C.line, width: 1 });
			DD.dashed(g, gx, cy, gx + R, cy, { color: C.line, dash: [3, 4] });

			/* 4. 各級亮點；λ 模式畫光線，白光模式只留光譜 */
			for (var n = 1; n <= nshow; n++) {
				var th = thetaDeg(n, st.lambda);
				for (var sg = 0; sg < 2; sg++) {
					var a = (sg ? -1 : 1) * th * Math.PI / 180;
					var px = gx + R * Math.cos(a);
					var py = cy - R * Math.sin(a);
					if (!st.white) {
						DD.arrow(g, gx + 4 * Math.cos(a), cy + 4 * Math.sin(a + Math.PI), px, py,
							{ color: C.inkFaint, width: 1, head: 5 });
					}
					DD.dot(g, px, py, 2.8, { color: C.accent, width: 1 });
				}
			}
			DD.dot(g, gx + R, cy, 3.4, { color: C.accent, width: 1 });
			DD.label(g, '0', gx + R + 8, cy - 9, { mono: true, size: 10, color: C.inkDim });

			/* 波前脈衝：同一時刻，各級衍射光離光柵的距離相同（都同速）
			   —— 這一顆點跑一圈 R 要 4 秒多，慢到不搶讀數。 */
			var frac = (t * 0.22) % 1;
			if (!st.white) {
				var rd = R * (0.25 + 0.68 * frac);
				for (var pn = 0; pn <= nshow; pn++) {
					var pth = (pn === 0 ? 0 : thetaDeg(pn, st.lambda)) * Math.PI / 180;
					DD.dot(g, gx + rd * Math.cos(pth), cy - rd * Math.sin(pth), 1.6,
						{ color: C.inkDim, width: 1 });
					if (pn > 0) {
						DD.dot(g, gx + rd * Math.cos(-pth), cy + rd * Math.sin(pth), 1.6,
							{ color: C.inkDim, width: 1 });
					}
				}
			}
			DD.dot(g, bx0 + (gx - 5 - bx0) * (0.25 + 0.75 * frac), cy, 1.6, { color: C.inkDim, width: 1 });

			/* 5. 白光：每一級用 12 個波長取樣，各自放到自己的 θ 上 */
			if (st.white) {
				for (n = 1; n <= topN; n++) {
					for (sg = 0; sg < 2; sg++) {
						for (var k = 0; k < 12; k++) {
							var lamK = LAM_MIN + (LAM_MAX - LAM_MIN) * (k / 11);
							var ak = thetaDeg(n, lamK) * Math.PI / 180 * (sg ? -1 : 1);
							g.fillStyle = spectral(lamK * 1e9);
							g.fillRect(gx + R * Math.cos(ak) - 2, cy - R * Math.sin(ak) - 2, 4, 4);
						}
					}
				}
			}

			/* 6. 級數標籤：白光時貼在紅色那一端，λ 模式貼在亮點上 */
			for (n = 1; n <= nshow; n++) {
				var thL = st.white ? Math.min(90, thetaDeg(n, LAM_MAX)) : thetaDeg(n, st.lambda);
				for (sg = 0; sg < 2; sg++) {
					var al = (sg ? -1 : 1) * thL * Math.PI / 180;
					var lx = gx + (R + 9) * Math.cos(al);
					var ly = cy - (R + 9) * Math.sin(al);
					var cosA = Math.cos(al);
					var align = cosA > 0.35 ? 'left' : cosA < -0.35 ? 'right' : 'center';
					DD.label(g, (sg ? '\u2212' : '+') + n + ' ' + fx(thL, 1) + '°',
						lx, ctx.clamp(ly, 11, h - 26),
						{ mono: true, size: 10, color: C.inkDim, align: align });
				}
			}

			/* 7. 量角器臂（吸附時取吸附後的角度，拖開就立刻回到手指） */
			var sn = snapped();
			var aa = sn.deg * Math.PI / 180;
			var armL = R * 0.72;   /* 比弧短一截：臂端的手柄才不會跟 0 級亮點疊在一起 */
			var hx = gx + armL * Math.cos(aa);
			var hy = cy - armL * Math.sin(aa);
			DD.dashed(g, gx, cy, hx, hy, { color: C.inkDim, dash: [5, 4] });
			if (Math.abs(sn.deg) > 1) {
				DD.arc(g, gx, cy, Math.max(14, R * 0.26), 0, -aa, { color: C.inkFaint, ccw: aa > 0 });
			}
			DD.handle(g, hx, hy, { size: 9, color: C.accent, fill: C.paper0 });

			if (sn.hit) {
				/* 吸附到某一級（含中央）：在該亮點外畫一圈，說「就是這一級」 */
				DD.dot(g, gx + R * Math.cos(aa), cy - R * Math.sin(aa), 6.5,
					{ fill: false, color: C.accent, width: 1 });
			}

			var tagText = 'θ = ' + fx(sn.deg, 1) + '°';
			var tx = gx + (armL + 13) * Math.cos(aa);
			var ty = cy - (armL + 13) * Math.sin(aa);
			var cosT = Math.cos(aa);
			var tAlign = cosT > 0.3 ? 'left' : cosT < -0.3 ? 'right' : 'center';
			DD.label(g, tagText, ctx.clamp(tx, 26, w - 26), ctx.clamp(ty, 12, h - 26),
				{ mono: true, size: 10, color: sn.hit ? C.accent : C.inkDim,
					align: tAlign, bg: C.paper0, pad: 2 });

			/* 8. 右邊空白放算式欄：只在真的夠寬時畫，窄屏留給弧就好 */
			if (w - (gx + R) > 210) {
				var mx = gx + R + 34;
				var lines = [
					'd = 1/ℓ = ' + fx(d * 1e9, 0) + ' nm',
					'n ≤ d/λ = ' + fx(d / st.lambda, 2) + ' → n_max = ' + phys.nmax,
					isFinite(phys.th1) ? 'sin θ₁ = λ/d = ' + fx(st.lambda / d, 3) : 'sin θ₁ > 1，無一級',
					isFinite(phys.th2) ? 'θ₂ = ' + fx(phys.th2, 2) + '°' : 'θ₂ —'
				];
				var ly0 = cy - 8 - (lines.length - 1) * 7;
				DD.label(g, '算式', mx, ly0 - 14, { mono: true, size: 10, color: C.inkFaint });
				for (i = 0; i < lines.length; i++) {
					DD.label(g, lines[i], mx, ly0 + i * 14, { mono: true, size: 10, color: C.inkDim });
				}
			}
		}

		/* ---------------------------------------------------------------- 互動 */
		var dragging = false;

		function armAt(e) {
			var rect = canvas.getBoundingClientRect();
			var dx = Math.max(2, e.clientX - rect.left - L.gx);
			var dy = L.cy - (e.clientY - rect.top);
			var deg = Math.atan2(dy, dx) * 180 / Math.PI;
			return ctx.clamp(deg, -90, 90);
		}

		function render() {
			compute();
			syncDom();
			draw(lastT);
		}

		canvas.addEventListener('pointerdown', function (e) {
			e.preventDefault();
			dragging = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒有捕獲一樣能拖 */ }
			st.arm = armAt(e);
			render();
		});
		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			st.arm = armAt(e);
			render();
		});
		function stopDrag() { dragging = false; }
		canvas.addEventListener('pointerup', stopDrag);
		canvas.addEventListener('pointercancel', stopDrag);

		canvas.addEventListener('keydown', function (e) {
			var stepv = e.shiftKey ? 5 : 1;
			var dlt = 0;
			if (e.key === 'ArrowUp') dlt = stepv;
			else if (e.key === 'ArrowDown') dlt = -stepv;
			else if (e.key === 'ArrowRight') dlt = stepv;
			else if (e.key === 'ArrowLeft') dlt = -stepv;
			else return;
			e.preventDefault();
			st.arm = ctx.clamp(st.arm + dlt, -90, 90);
			render();
		});

		fL.input.addEventListener('input', function () {
			st.lpm = Number(fL.input.value);
			render();
		});
		fLam.input.addEventListener('input', function () {
			st.lambda = Number(fLam.input.value) * 1e-9;
			render();
		});
		btnWhite.addEventListener('click', function () {
			st.white = !st.white;
			btnWhite.classList.toggle('is-on', st.white);
			btnWhite.setAttribute('aria-pressed', st.white ? 'true' : 'false');
			render();
		});

		ctx.onResize(render);
		render();

		if (!ctx.reduced) {
			ctx.raf(function (dt, t) {
				lastT = t;
				draw(t);
			});
		}

		return {
			destroy: function () {
				dragging = false;
			}
		};
	});
})();
