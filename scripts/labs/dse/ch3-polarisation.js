/**
 * ch3-polarisation.js — 偏振與 Malus 定律（lab id: polarisation）
 *
 * 為什麼透射振幅畫成單向箭頭、不是雙頭：E 在軸上的分量是 E·cosθ，θ 過了 90°
 * 餘弦變負 —— 負號是反相，不是「沒有光」。雙頭箭頭看不出這個差別，所以只在
 * 第一片之後用雙頭（那是偏振方向本身），第二片之後用單向箭頭（帶正負的分量）。
 * 強度只看平方，所以 0.5 和 −0.5 一樣亮。
 */
(function () {
	'use strict';

	var DD = window.DSEDraw;

	/* 未偏振光的角度：固定的一組，每幀不重新配置陣列 */
	var RAND = [18, 52, 76, 104, 138, 162, 34, 66, 92];

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	function fx(n, d) {
		return isFinite(n) ? n.toFixed(d) : '—';
	}

	var seq = 0;

	function field(labelText, min, max, step, value, shown) {
		var id = 'wo-pol-' + (++seq);
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

	window.DSELab.define('polarisation', function (mount, ctx) {
		var C = ctx.colors;
		var st = { theta: 45, graph: true };
		var L = { d2x: 0, cy: 0, hr: 24 };
		var lastT = 0;

		var noteText = '兩片正交（θ = 90°）全暗，θ = 90° 與 270° 時 I 恰為 0；' +
			'若光源本來就未偏振，第一片後只剩 I₀/2。本主題在必修只要求定性理解，' +
			'定量式屬延伸。θ 與 θ+180° 給同一個亮度（偏振片只認軸的方向）。' +
			(ctx.reduced ? '已依系統設定暫停動態。' : '');

		/* ---------------------------------------------------------------- 版面 */
		var grid = el('div', 'dl-lab__grid');
		var stage = el('div', 'dl-lab__stage');
		var wrapEl = el('div', 'dl-lab__canvaswrap');
		var canvas = document.createElement('canvas');
		canvas.className = 'dl-canvas dl-canvas--drag';
		canvas.tabIndex = 0;
		canvas.setAttribute('aria-label', '偏振與 Malus 定律：拖動第二片偏振片邊緣的手柄改變夾角');
		wrapEl.appendChild(canvas);
		wrapEl.appendChild(el('p', 'dl-hint', '拖動第二片邊緣的手柄'));
		stage.appendChild(wrapEl);

		var panel = el('div', 'dl-lab__panel');

		var gAngle = el('div', 'dl-panel__group');
		gAngle.appendChild(el('span', 'dl-panel__label', '兩片夾角'));
		var fTheta = field('夾角 θ', 0, 360, 1, 45, '45°');
		gAngle.appendChild(fTheta.wrap);

		var segEl = el('div', 'dl-seg');
		var presets = [0, 45, 90, 135];
		var presetBtns = [];
		for (var i = 0; i < presets.length; i++) {
			var b = el('button', 'dl-btn', presets[i] + '°');
			b.type = 'button';
			b.setAttribute('aria-pressed', 'false');
			b.dataset.angle = String(presets[i]);
			segEl.appendChild(b);
			presetBtns.push(b);
		}
		gAngle.appendChild(segEl);

		var gView = el('div', 'dl-panel__group');
		gView.appendChild(el('span', 'dl-panel__label', '顯示'));
		var segView = el('div', 'dl-seg');
		/* 公式要保留大小寫：.dl-btn 的 uppercase 會把 cos²θ 印成 COS²Θ */
		var btnGraph = el('button', 'dl-btn wo-lower is-on', 'cos²θ 曲線');
		btnGraph.type = 'button';
		btnGraph.setAttribute('aria-pressed', 'true');
		segView.appendChild(btnGraph);
		gView.appendChild(segView);

		var roEl = el('div', 'dl-readouts');
		var rTheta = readoutRow('夾角');
		var rAcute = readoutRow('等效銳角');
		var rI = readoutRow('I / I₀');
		var rPct = readoutRow('透射率');
		roEl.appendChild(rTheta.row);
		roEl.appendChild(rAcute.row);
		roEl.appendChild(rI.row);
		roEl.appendChild(rPct.row);

		/* 外殼已在 mount 下面印了 I = I₀cos²θ，這裡多給半角式，順便說明為什麼
		   θ 與 θ+180° 一樣亮 */
		var formula = el('p', 'wo-formula',
			'\\( I = I_0\\cos^2\\theta \\)　\\( I = \\tfrac{1}{2}I_0\\,(1 + \\cos 2\\theta) \\)');
		var live = el('p', 'wo-live', '');
		var note = el('p', 'dl-note', noteText);

		panel.appendChild(gAngle);
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
		function ratio() {
			var c = Math.cos(st.theta * Math.PI / 180);
			return c * c;
		}

		function acute() {
			var m = ((st.theta % 180) + 180) % 180;
			return m > 90 ? 180 - m : m;
		}

		function set(node, text) {
			if (node.textContent !== text) node.textContent = text;
		}

		function syncDom() {
			var I = ratio();
			set(rTheta.v, st.theta + '°');
			set(rAcute.v, fx(acute(), 0) + '°');
			set(rI.v, fx(I, 3));
			set(rPct.v, fx(I * 100, 1) + '%');
			set(fTheta.out, st.theta + '°');
			set(live, 'I/I₀ = cos²' + st.theta + '° = ' + fx(I, 3));
			if (Number(fTheta.input.value) !== st.theta) fTheta.input.value = String(st.theta);
			for (var k = 0; k < presetBtns.length; k++) {
				var on = presets[k] === st.theta;
				presetBtns[k].classList.toggle('is-on', on);
				presetBtns[k].setAttribute('aria-pressed', on ? 'true' : 'false');
			}
		}

		/* ---------------------------------------------------------------- 繪圖 */
		function draw(t) {
			var g = view.ctx2d;
			var w = view.w, h = view.h;
			if (!g || w < 8 || h < 8) return;
			g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
			g.clearRect(0, 0, w, h);

			var padX = Math.max(10, Math.min(16, Math.round(w * 0.035)));
			/* 左下角固定壓著 .dl-hint（約 20px 高的帶），所以圖表的軸線與度數刻度
			   一律排在這條帶之上 —— 否則 320px 時提示字會直接蓋在 0°/90° 上。 */
			var hintBand = 22;
			var graphH = st.graph ? ctx.clamp(h * 0.30, 52, 150) : 0;
			var graphBottom = h - (st.graph ? hintBand : 0);
			var mainBot = graphBottom - graphH - (st.graph ? 6 : 0);
			var padTop = Math.max(18, Math.round(h * 0.09));
			var cy = padTop + (mainBot - padTop) / 2;
			var ry = Math.max(14, Math.min((mainBot - padTop) * 0.33, h * 0.20));

			var d1x = w * 0.34;
			var d2x = w * 0.62;
			var rx = Math.max(5, w * 0.014);
			var barW = Math.max(12, Math.round(w * 0.03));
			var barX = w - padX - barW;
			var barH = Math.min(ry * 1.6, mainBot - padTop - 8);

			var th = st.theta * Math.PI / 180;
			var cth = Math.cos(th);
			var sth = Math.sin(th);
			var I = cth * cth;

			/* 1. 光軸 */
			DD.dashed(g, padX, cy, barX, cy, { color: C.line, dash: [3, 4] });

			/* 2. 第一片之前：各方向都有，慢慢轉 —— 未偏振 */
			var x0 = padX + 6, x1 = d1x - Math.max(20, rx * 2.2);
			var cw = (x1 - x0) / 2;
			var rowStep = ry * 0.58;
			var hl = Math.min(11, ry * 0.34);
			for (var i = 0; i < RAND.length; i++) {
				var cx = x0 + (i % 3) * cw;
				var cyy = cy + (Math.floor(i / 3) - 1) * rowStep;
				var ang = (RAND[i] + t * (4 + (i % 5) * 1.7)) * Math.PI / 180;
				var ux = Math.cos(ang) * hl, uy = Math.sin(ang) * hl;
				DD.arrow(g, cx - ux, cyy - uy, cx + ux, cyy + uy, { color: C.inkDim, width: 1, head: 4 });
				DD.arrow(g, cx + ux, cyy + uy, cx - ux, cyy - uy, { color: C.inkDim, width: 1, head: 4 });
			}
			DD.label(g, '未偏振', (x0 + x1) / 2, cy - ry - 8,
				{ mono: true, size: 10, color: C.inkFaint, align: 'center' });

			/* 3. 偏振片 1：固定在垂直方向 */
			g.save();
			g.beginPath();
			g.ellipse(d1x, cy, rx, ry, 0, 0, Math.PI * 2);
			g.fillStyle = C.paper2;
			g.fill();
			g.strokeStyle = C.ink;
			g.lineWidth = 1.2;
			g.stroke();
			g.restore();
			var ax1 = ry * 0.62;
			DD.arrow(g, d1x, cy + ax1, d1x, cy - ax1, { color: C.ink, width: 1, head: 5 });
			DD.arrow(g, d1x, cy - ax1, d1x, cy + ax1, { color: C.ink, width: 1, head: 5 });
			DD.label(g, '偏振片 1', d1x, cy + ry + 12,
				{ mono: true, size: 10, color: C.inkFaint, align: 'center' });

			/* 4. 兩片之間：只剩一個偏振方向 */
			var xm1 = (d1x + d2x) / 2;
			var ax2 = ry * 0.42;
			DD.arrow(g, xm1, cy + ax2, xm1, cy - ax2, { color: C.ink, width: 1.4, head: 5 });
			DD.arrow(g, xm1, cy - ax2, xm1, cy + ax2, { color: C.ink, width: 1.4, head: 5 });
			DD.label(g, 'I₀/2', xm1, cy + ax2 + 10,
				{ mono: true, size: 10, color: C.inkDim, align: 'center' });

			/* 5. 偏振片 2 與可拖的量角環 */
			var hr = Math.max(ry * 0.95, 24);
			L.d2x = d2x; L.cy = cy; L.hr = hr;
			g.save();
			g.beginPath();
			g.ellipse(d2x, cy, rx, ry, 0, 0, Math.PI * 2);
			g.fillStyle = C.paper2;
			g.fill();
			g.strokeStyle = C.ink;
			g.lineWidth = 1.2;
			g.stroke();
			g.restore();

			g.strokeStyle = C.line;
			g.lineWidth = 1;
			g.setLineDash([2, 4]);
			g.beginPath();
			g.arc(d2x, cy, hr, 0, Math.PI * 2);
			g.stroke();
			g.setLineDash([]);
			for (var k = 0; k < 12; k++) {
				var ta = k * Math.PI / 6;
				var tx = d2x + Math.sin(ta), ty = cy - Math.cos(ta);
				DD.line(g, d2x + tx * (hr - 3), cy - Math.cos(ta) * (hr - 3),
					d2x + tx * (hr + 3), cy - Math.cos(ta) * (hr + 3), { color: C.line });
			}
			var axisLen = ry * 0.62;
			DD.arrow(g, d2x - sth * axisLen, cy + cth * axisLen,
				d2x + sth * axisLen, cy - cth * axisLen, { color: C.ink, width: 1, head: 5 });
			DD.arrow(g, d2x + sth * axisLen, cy - cth * axisLen,
				d2x - sth * axisLen, cy + cth * axisLen, { color: C.ink, width: 1, head: 5 });
			DD.handle(g, d2x + sth * hr, cy - cth * hr, { size: 9, color: C.accent, fill: C.paper0 });
			DD.label(g, '偏振片 2', d2x, cy + ry + 12,
				{ mono: true, size: 10, color: C.inkFaint, align: 'center' });

			/* 6. 第二片之後：帶正負號的分量（cosθ < 0 是反相，不是沒有光） */
			var xm2 = d2x + (barX - d2x) * 0.45;
			var ampMax = ry * 0.62;
			DD.dashed(g, xm2 - sth * axisLen, cy + cth * axisLen,
				xm2 + sth * axisLen, cy - cth * axisLen, { color: C.line, dash: [2, 4] });
			var tipX = xm2 + ampMax * cth * sth;
			var tipY = cy - ampMax * cth * cth;
			var reach = Math.abs(ampMax * cth);
			if (reach > 1.4) {
				DD.arrow(g, xm2, cy, tipX, tipY, { color: C.accent, width: 1.4, head: 6 });
				if (reach > 11) {
					/* 標籤放在箭頭中點上方：放在箭頭旁邊會撞到第二片的旋轉手柄 */
					DD.label(g, 'E cosθ', ctx.clamp((xm2 + tipX) / 2, 30, barX - 26),
						Math.min(tipY, cy) - 13,
						{ mono: true, size: 10, color: C.accent, align: 'center' });
				}
			} else {
				DD.dot(g, xm2, cy, 1.6, { color: C.accent, width: 1 });
				DD.label(g, '0', xm2, cy - 9, { mono: true, size: 10, color: C.accent, align: 'center' });
			}

			/* 7. 探測器：填滿的比例就是 I/I₀ */
			var bt = cy - barH / 2;
			g.fillStyle = C.paper2;
			g.fillRect(barX, bt, barW, barH);
			g.save();
			g.globalAlpha = I;
			g.fillStyle = C.accent;
			g.fillRect(barX, cy + barH / 2 - barH * I, barW, barH * I);
			g.restore();
			DD.frame(g, barX, bt, barW, barH, { color: C.ink });
			DD.label(g, '探測器', barX + barW / 2, bt + barH + 10,
				{ mono: true, size: 10, color: C.inkFaint, align: 'center' });

			/* 8. I/I₀–θ 曲線：一條 cos²，游標跟著 θ 走 */
			if (st.graph) {
				var gx0 = padX + 24, gx1 = w - padX - 2;
				var gy0 = mainBot + 8, gy1 = graphBottom - 14;
				DD.line(g, gx0, gy1, gx1, gy1, { color: C.lineStrong });
				DD.line(g, gx0, gy0 - 3, gx0, gy1, { color: C.lineStrong });
				g.strokeStyle = C.accent;
				g.lineWidth = 1.4;
				g.beginPath();
				for (var s = 0; s <= 180; s++) {
					var deg = s * 2;
					var cc = Math.cos(deg * Math.PI / 180);
					var px = gx0 + (gx1 - gx0) * (s / 180);
					var py = gy1 - (gy1 - gy0) * cc * cc;
					if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
				}
				g.stroke();
				var mx = gx0 + (gx1 - gx0) * (st.theta / 360);
				var my = gy1 - (gy1 - gy0) * I;
				DD.dashed(g, mx, gy0 - 3, mx, gy1, { color: C.line, dash: [2, 3] });
				DD.handle(g, mx, my, { size: 7, color: C.accent, fill: C.paper0 });
				var marks = ['0°', '90°', '180°', '270°', '360°'];
				for (var q = 0; q < 5; q++) {
					var qx = gx0 + (gx1 - gx0) * (q / 4);
					DD.label(g, marks[q], qx, gy1 + 9,
						{ mono: true, size: 10, color: C.inkFaint,
							align: q === 0 ? 'left' : q === 4 ? 'right' : 'center' });
				}
				DD.label(g, '1', gx0 - 4, gy0, { mono: true, size: 10, color: C.inkFaint, align: 'right' });
				DD.label(g, 'I / I₀', gx0, gy0 - 10, { mono: true, size: 10, color: C.inkFaint });
			}
		}

		/* ---------------------------------------------------------------- 互動 */
		var dragging = false;

		function thetaAt(e) {
			var rect = canvas.getBoundingClientRect();
			var dx = e.clientX - rect.left - L.d2x;
			var dy = e.clientY - rect.top - L.cy;
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return st.theta;
			var deg = Math.atan2(dx, -dy) * 180 / Math.PI;
			deg = Math.round(deg) % 360;
			return (deg + 360) % 360;
		}

		function render() {
			syncDom();
			draw(lastT);
		}

		canvas.addEventListener('pointerdown', function (e) {
			e.preventDefault();
			dragging = true;
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒有捕獲一樣能拖 */ }
			st.theta = thetaAt(e);
			render();
		});
		canvas.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			e.preventDefault();
			st.theta = thetaAt(e);
			render();
		});
		function stopDrag() { dragging = false; }
		canvas.addEventListener('pointerup', stopDrag);
		canvas.addEventListener('pointercancel', stopDrag);

		canvas.addEventListener('keydown', function (e) {
			var stepv = e.shiftKey ? 10 : 1;
			var dlt = 0;
			if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dlt = stepv;
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dlt = -stepv;
			else return;
			e.preventDefault();
			st.theta = ((st.theta + dlt) % 360 + 360) % 360;
			render();
		});

		fTheta.input.addEventListener('input', function () {
			st.theta = Math.round(Number(fTheta.input.value)) % 360;
			render();
		});

		for (i = 0; i < presetBtns.length; i++) {
			(function (btn) {
				btn.addEventListener('click', function () {
					st.theta = Number(btn.dataset.angle);
					render();
				});
			})(presetBtns[i]);
		}

		btnGraph.addEventListener('click', function () {
			st.graph = !st.graph;
			btnGraph.classList.toggle('is-on', st.graph);
			btnGraph.setAttribute('aria-pressed', st.graph ? 'true' : 'false');
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
