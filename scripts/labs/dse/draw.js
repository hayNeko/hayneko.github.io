/**
 * draw.js — DSE 實驗頁的 canvas 2D 繪圖小工具
 *
 * 為什麼獨立一支: 12 個實驗畫的是同一套語彙(箭頭 / 法線 / 網格 / 標籤 / 拖曳點),
 * 各寫一次就會長出 12 種線寬與 12 種標籤留白, 整頁看起來就不像同一本書。
 * 這裡只管「把參數畫出來」: 顏色一律由呼叫端傳入(通常是 DSELab 的 ctx.colors),
 * 沒傳就沿用呼叫端已經設好的 strokeStyle / fillStyle, 所以本檔一個色值都沒有 ——
 * 換紙換墨不必動它。
 */
(function (global) {
	'use strict';

	var fonts = null;

	/* 字族從 tokens 讀; 讀一次快取起來, 每次畫標籤都 getComputedStyle 太貴 */
	function fontFor(mono) {
		if (!fonts) {
			var cs = global.getComputedStyle(global.document.documentElement);
			fonts = {
				serif: (cs.getPropertyValue('--font') || 'serif').trim(),
				mono: (cs.getPropertyValue('--font-mono') || 'monospace').trim()
			};
		}
		return mono ? fonts.mono : fonts.serif;
	}

	function setDash(g, dash) {
		g.setLineDash(dash && dash.length ? dash : []);
	}

	function roundRect(g, x, y, w, h, r) {
		g.beginPath();
		g.moveTo(x + r, y);
		g.lineTo(x + w - r, y);
		g.quadraticCurveTo(x + w, y, x + w, y + r);
		g.lineTo(x + w, y + h - r);
		g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
		g.lineTo(x + r, y + h);
		g.quadraticCurveTo(x, y + h, x, y + h - r);
		g.lineTo(x, y + r);
		g.quadraticCurveTo(x, y, x + r, y);
		g.closePath();
	}

	function line(g, x1, y1, x2, y2, o) {
		o = o || {};
		g.save();
		g.strokeStyle = o.color || g.strokeStyle;
		g.lineWidth = o.width == null ? 1 : o.width;
		g.lineCap = 'butt';
		setDash(g, o.dash);
		g.beginPath();
		g.moveTo(x1, y1);
		g.lineTo(x2, y2);
		g.stroke();
		g.restore();
	}

	function arrow(g, x1, y1, x2, y2, o) {
		o = o || {};
		var color = o.color || g.strokeStyle;
		var width = o.width == null ? 1.4 : o.width;
		var head = o.head == null ? 7 : o.head;
		var ang = Math.atan2(y2 - y1, x2 - x1);
		g.save();
		g.strokeStyle = color;
		g.lineWidth = width;
		g.lineCap = 'butt';
		setDash(g, o.dash);
		g.beginPath();
		g.moveTo(x1, y1);
		g.lineTo(x2, y2);
		g.stroke();
		setDash(g, null);
		g.beginPath();
		g.moveTo(x2, y2);
		g.lineTo(x2 - Math.cos(ang - 0.42) * head, y2 - Math.sin(ang - 0.42) * head);
		g.moveTo(x2, y2);
		g.lineTo(x2 - Math.cos(ang + 0.42) * head, y2 - Math.sin(ang + 0.42) * head);
		g.stroke();
		g.restore();
	}

	/* 由 (x,y) 出發, 往 angle 方向走 len, 箭頭落在終點 */
	function ray(g, x, y, angle, len, o) {
		arrow(g, x, y, x + Math.cos(angle) * len, y + Math.sin(angle) * len, o);
	}

	function dot(g, x, y, r, o) {
		o = o || {};
		var color = o.color || g.strokeStyle;
		g.save();
		g.beginPath();
		g.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
		if (o.fill !== false) {
			g.fillStyle = typeof o.fill === 'string' ? o.fill : color;
			g.fill();
		}
		if (o.stroke !== false) {
			g.strokeStyle = typeof o.stroke === 'string' ? o.stroke : color;
			g.lineWidth = o.width == null ? 1.4 : o.width;
			g.stroke();
		}
		g.restore();
	}

	function label(g, text, x, y, o) {
		o = o || {};
		var size = o.size == null ? 11 : o.size;
		var align = o.align || 'left';
		var baseline = o.baseline || 'middle';
		g.save();
		g.font = '400 ' + size + 'px ' + fontFor(!!o.mono);
		g.textAlign = align;
		g.textBaseline = baseline;
		if (o.bg) {
			var pad = o.pad == null ? 4 : o.pad;
			var w = g.measureText(text).width + pad * 2;
			var h = size + pad * 2;
			var bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
			var by = baseline === 'middle' ? y - h / 2 : baseline === 'bottom' ? y - h : y;
			g.fillStyle = o.bg;
			roundRect(g, bx, by, w, h, 2);
			g.fill();
		}
		g.fillStyle = o.color || g.fillStyle;
		g.fillText(text, x, y);
		g.restore();
	}

	/* 參數標記用的小晶片(i / r / C / θ), 以 (x,y) 為中心 */
	function tag(g, text, x, y, o) {
		o = o || {};
		var size = o.size == null ? 10 : o.size;
		var color = o.color || g.strokeStyle;
		g.save();
		g.font = '400 ' + size + 'px ' + fontFor(true);
		var w = Math.ceil(g.measureText(text).width) + 10;
		var h = size + 8;
		g.fillStyle = o.fill || g.fillStyle;
		g.strokeStyle = color;
		g.lineWidth = 1;
		roundRect(g, x - w / 2, y - h / 2, w, h, 2);
		g.fill();
		g.stroke();
		g.fillStyle = color;
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		g.fillText(text, x, y + 0.5);
		g.restore();
	}

	function axis(g, x, y, len, dir, labelText, o) {
		o = o || {};
		var dx = dir === 'x+' ? 1 : dir === 'x-' ? -1 : 0;
		var dy = dir === 'y+' ? 1 : dir === 'y-' ? -1 : 0;
		var x2 = x + dx * len;
		var y2 = y + dy * len;
		arrow(g, x, y, x2, y2, o);
		if (!labelText) return;
		var lx = x2 + dx * 9;
		var ly = y2 + dy * 9;
		label(g, labelText, lx, ly, {
			color: o.color,
			size: o.size,
			mono: o.mono,
			bg: o.bg,
			align: dx > 0 ? 'left' : dx < 0 ? 'right' : 'center',
			baseline: dy > 0 ? 'top' : dy < 0 ? 'bottom' : 'middle'
		});
	}

	function grid(g, x, y, w, h, step, o) {
		o = o || {};
		if (!(step > 0)) return;
		g.save();
		g.strokeStyle = o.color || g.strokeStyle;
		g.lineWidth = o.width == null ? 1 : o.width;
		setDash(g, null);
		g.beginPath();
		for (var gx = x; gx <= x + w + 0.01; gx += step) {
			var px = Math.round(gx) + 0.5;   /* 半像素: 1px 線才不會被攤成 2px 灰邊 */
			g.moveTo(px, y);
			g.lineTo(px, y + h);
		}
		for (var gy = y; gy <= y + h + 0.01; gy += step) {
			var py = Math.round(gy) + 0.5;
			g.moveTo(x, py);
			g.lineTo(x + w, py);
		}
		g.stroke();
		g.restore();
	}

	function dashed(g, x1, y1, x2, y2, o) {
		o = o || {};
		line(g, x1, y1, x2, y2, { color: o.color, width: o.width, dash: o.dash || [4, 4] });
	}

	function arc(g, cx, cy, r, a0, a1, o) {
		o = o || {};
		g.save();
		g.strokeStyle = o.color || g.strokeStyle;
		g.lineWidth = o.width == null ? 1 : o.width;
		setDash(g, o.dash);
		g.beginPath();
		g.arc(cx, cy, r, a0, a1, !!o.ccw);
		g.stroke();
		g.restore();
	}

	function frame(g, x, y, w, h, o) {
		o = o || {};
		g.save();
		g.strokeStyle = o.color || g.strokeStyle;
		g.lineWidth = o.width == null ? 1 : o.width;
		setDash(g, o.dash);
		g.beginPath();
		g.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
		g.stroke();
		g.restore();
	}

	/* 可拖動的點: 紙色填底蓋住底下的線, 只剩勃艮第紅的方框 */
	function handle(g, x, y, o) {
		o = o || {};
		var s = o.size == null ? 8 : o.size;
		g.save();
		g.fillStyle = o.fill || g.fillStyle;
		g.strokeStyle = o.color || g.strokeStyle;
		g.lineWidth = o.width == null ? 1.2 : o.width;
		g.setLineDash([]);
		g.beginPath();
		g.rect(Math.round(x - s / 2) + 0.5, Math.round(y - s / 2) + 0.5, s, s);
		g.fill();
		g.stroke();
		g.restore();
	}

	/* y = y0 + amp·sin(kx − ωt), 每 2px 取一點; 尾端補一個點, 否則右邊界會缺 0~2px */
	function wave(g, x0, x1, y0, amp, k, omega, t, o) {
		o = o || {};
		g.save();
		g.strokeStyle = o.color || g.strokeStyle;
		g.lineWidth = o.width == null ? 1.4 : o.width;
		g.lineJoin = 'round';
		setDash(g, o.dash);
		g.beginPath();
		var x = x0;
		var y = y0 + amp * Math.sin(k * x - omega * t);
		g.moveTo(x, y);
		for (x = x0 + 2; x < x1; x += 2) {
			g.lineTo(x, y0 + amp * Math.sin(k * x - omega * t));
		}
		g.lineTo(x1, y0 + amp * Math.sin(k * x1 - omega * t));
		g.stroke();
		g.restore();
	}

	global.DSEDraw = {
		arrow: arrow,
		line: line,
		ray: ray,
		dot: dot,
		label: label,
		tag: tag,
		axis: axis,
		grid: grid,
		dashed: dashed,
		arc: arc,
		frame: frame,
		handle: handle,
		wave: wave
	};
})(window);
