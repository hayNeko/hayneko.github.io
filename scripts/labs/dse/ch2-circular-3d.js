/**
 * ch2-circular-3d.js — 圓周運動（3D · DSE 物理 第二章 II.f · 實驗 14）
 *
 * 為什麼要立體: 圓周運動的難點不是公式, 而是「速率不變、速度一直在變」。
 * 平面圖只能畫一條切線; 立方視角裡球真的繞著軸轉, 綠色箭頭永遠貼著切線、
 * 紅色箭頭永遠指回軸心, 兩者夾角永遠是 90° —— 學生看到的是幾何, 不是口訣。
 *
 * 傾斜彎道共用同一個舞台: 路面是圓錐面的一段 (內緣低、外緣高), 傾角
 * θ = atan(v²/(rg)) 就是那個圓錐的半頂角; 車身跟著路面傾, N 與 W 的箭頭
 * 長度比就是 N : W = 1/cosθ : 1。彎道是 20–80 m 的環, 但畫面上固定成
 * 同一個大小 (半徑寫在標籤與讀數上) —— 否則一台 4 m 的車在 160 m 的環裡
 * 只剩三個像素, θ 反而看不見。r 改變時該變的是傾角, 不是縮圖。
 *
 * 尺度: 相機距離、箭桿粗細、標籤字高都由 dist 推出來, 不是固定像素 ——
 * 換個 r 或換個視窗寬度都不會爆框或糊掉。
 */
(function () {
	'use strict';

	var G = 9.81;                  /* m s⁻² */
	var TAU = Math.PI * 2;
	var PIVOT_Y = 1.15;            /* 支點離桌面高 (m) */
	var DROP = 0.60;               /* 支點到圓周平面的高度差 (m) */
	var PLANE_Y = PIVOT_Y - DROP;
	var TABLE_PAD = 0.7;           /* 桌面比圓周大半徑多出的邊 (m) */
	var FLOOR_Y = -1.15;           /* 地面 (m) */
	var BANK_R = 10;               /* 彎道畫在固定的 10 單位上 (見檔頭) */
	var BANK_W = 2.8;              /* 路面寬 (畫布單位) */

	var ROPE = { r: [0.5, 3, 0.05], v: [1, 12, 0.1], m: [0.2, 2, 0.05] };
	var BANK = { r: [20, 80, 1], v: [5, 30, 0.5] };

	var GREEN = '#2f9e63';         /* 畫布內: 綠=速度 */
	var RED = '#c0392b';           /* 畫布內: 紅=力 */
	var AMBER = '#e8a33d';         /* 畫布內: 橙=重力 */

	window.DSELab.define('circular-3d', function (mount, ctx) {
		var D = window.DSEThree;
		var doc = document;
		var THREE = null;

		/* ---------------- 狀態 ---------------- */
		var mode = 'rope';
		var P = { rope: { r: 1, v: 3, m: 0.5 }, bank: { r: 50, v: 15 } };
		var st = {
			r: 1, v: 3, m: 0.5, T: 0, w: 0, ac: 0, Fc: 0, th: 0, thDeg: 0,
			dist: 8.4, lbl: 0.46, sh: 0.077, hRoad: 0
		};
		var angle = 0;                 /* 累積轉角 (rad) */

		/* ---------------- 小工具 ---------------- */

		function el(tag, cls, txt) {
			var n = doc.createElement(tag);
			if (cls) n.className = cls;
			if (txt != null) n.textContent = txt;
			return n;
		}

		function num(x, d) {
			if (typeof x !== 'number' || !isFinite(x)) return '—';
			return (Math.abs(x) < 5e-7 ? 0 : x).toFixed(d == null ? 2 : d);
		}

		function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

		/* ---------------- DOM ---------------- */

		var grid = el('div', 'dl-lab__grid');
		var stageBox = el('div', 'dl-lab__stage');
		var wrap = el('div', 'dl-lab__canvaswrap');
		var canvas = el('canvas');
		var hint = el('p', 'dl-hint', '拖動可旋轉視角');
		wrap.appendChild(canvas);
		wrap.appendChild(hint);
		stageBox.appendChild(wrap);

		var panel = el('div', 'dl-lab__panel');
		grid.appendChild(stageBox);
		grid.appendChild(panel);
		mount.appendChild(grid);

		var stage = D.createStage(canvas, ctx, {
			camera: { yaw: -0.7, pitch: 0.30, dist: 5.6, target: [0, 0.35, 0] }
		});
		if (!stage) return;            /* three-kit 已經把替代文字畫進 wrap */

		THREE = window.THREE;
		var UP = new THREE.Vector3(0, 1, 0);

		stage.add(new THREE.AmbientLight(0xf4f7fa, 0.64));
		var key = new THREE.DirectionalLight(0xffffff, 0.9);
		key.position.set(7, 13, 9);
		stage.add(key);
		var fill = new THREE.DirectionalLight(0xdbe6f2, 0.34);
		fill.position.set(-9, 5, -7);
		stage.add(fill);
		stage.add(D.sky('#7fb2d9', '#e8eef4'));

		var root = new THREE.Group();
		stage.add(root);

		/* ---------------- 幾何小工具 ---------------- */

		function clearGroup(g) {
			for (var i = g.children.length - 1; i >= 0; i--) {
				var c = g.children[i];
				if (c.children && c.children.length) clearGroup(c);
				if (c.geometry && c.geometry.dispose) c.geometry.dispose();
				var mats = c.material ? (c.material.length ? c.material : [c.material]) : [];
				for (var j = 0; j < mats.length; j++) {
					var mt = mats[j];
					if (!mt) continue;
					if (mt.map && mt.map.dispose) mt.map.dispose();
					if (mt.dispose) mt.dispose();
				}
				g.remove(c);
			}
		}

		/* 兩點之間的細桿: 繩、半徑虛線、鋼管都用它 */
		function strut(ax, ay, az, bx, by, bz, rad, color, opts) {
			var a = new THREE.Vector3(ax, ay, az);
			var d = new THREE.Vector3(bx - ax, by - ay, bz - az);
			var len = d.length();
			if (!(len > 1e-4)) return null;
			d.multiplyScalar(1 / len);
			var mesh = D.cylinder(rad, rad, len, color, opts || { segments: 12 });
			mesh.position.copy(a).addScaledVector(d, len * 0.5);
			mesh.quaternion.setFromUnitVectors(UP, d);
			return mesh;
		}

		function tag(text, size, color) {
			var sp = D.label(text, color || '#f4f7fb', { size: size, bg: 'rgba(11,18,32,.6)' });
			/* 標籤是標注層: 不寫深度, 否則被地面或筒身擋住就整句消失 */
			sp.material.depthTest = false;
			sp.renderOrder = 60;
			return sp;
		}

		/* ---------------- 螢幕空間標籤佈局 ----------------
		   貼圖大小是世界單位算的, 但「有沒有壓到網格、有沒有互相重疊」是螢幕上的事 ——
		   相機一轉、畫布一窄就變。做法: 把錨點投影到螢幕, 沿外法線往外推, 推到
		   不撞已佔矩形為止, 再反投影回同一個深度。全程重用向量, 每幀零配置。 */
		var LB = { items: [], boxes: [], hud: null };
		var _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3();
		var _pd = new THREE.Vector3(), _pe = new THREE.Vector3(), _upv = new THREE.Vector3(0, 1, 0);

		/* clearPx = 螢幕上的清空距離 (px); clearW = 世界單位的清空距離 (隨距離換算成 px,
		   大場景才不會因為固定 px 而把標籤黏在錨點上) */
		function lbAdd(sprite, anchor, normal, obj, clearPx, clearW) {
			LB.items.push({
				sp: sprite,
				loc: new THREE.Vector3().fromArray(anchor),
				nrm: new THREE.Vector3().fromArray(normal).normalize(),
				obj: obj || null, clear: clearPx == null ? 10 : clearPx, clearW: clearW || 0, lead: null
			});
			return LB.items[LB.items.length - 1];
		}

		function lbLead(item, rad, color) {
			var m = D.cylinder(rad, rad, 1, color, { roughness: 0.9, metalness: 0, opacity: 0.5, segments: 6 });
			item.lead = m;
			return m;
		}


		/* 網格障礙: 標籤不准壓在它描述的物件上, 所以先把物件的螢幕外包矩形
		   放進已佔清單 (可掛在會動的 obj 上, 例如球或車) */
		var LBobs = [];
		function lbBlock(anchor, hwWorld, hhWorld, obj) {
			LBobs.push({ loc: new THREE.Vector3().fromArray(anchor), hw: hwWorld, hh: hhWorld, obj: obj || null });
		}

		function lbLayout(w, h) {
			var cam = stage.camera;
			cam.updateMatrixWorld();
			cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
			var fovK = Math.tan(cam.fov * Math.PI / 360);
			var i, b, it, step, t, ang, ca, sa, rx, ry, dist, ok, cx, cy;
			LB.boxes.length = 0;

			if (LB.hud) {
				var hs = Math.max(0.7, Math.min(1, w / 700));
				var hw0 = LB.hud.w * hs / 2, hh0 = LB.hud.h * hs / 2;
				var cx0 = w - 6 - hw0, cy0 = 6 + hh0;
				var kpx = (h * 0.5) / (1.5 * fovK);
				var me = cam.matrixWorld.elements;
				LB.hud.g.quaternion.copy(cam.quaternion);
				LB.hud.g.scale.setScalar(hs / kpx);
				_pa.set(me[12], me[13], me[14]);
				_pb.set(-me[8], -me[9], -me[10]);
				_pc.set(me[0], me[1], me[2]);
				_pd.set(me[4], me[5], me[6]);
				LB.hud.g.position.copy(_pa).addScaledVector(_pb, 1.5)
					.addScaledVector(_pc, (cx0 - w / 2) / kpx)
					.addScaledVector(_pd, (h / 2 - cy0) / kpx);
				LB.boxes.push({ x: cx0, y: cy0, hw: hw0, hh: hh0 });
			}

			/* 先放入網格障礙 */
			var oi, ob, kk;
			for (oi = 0; oi < LBobs.length; oi++) {
				ob = LBobs[oi];
				if (ob.obj) _pe.copy(ob.loc).applyMatrix4(ob.obj.matrixWorld);
				else _pe.copy(ob.loc);
				_pa.copy(_pe).project(cam);
				if (_pa.z > 1) continue;
				_pd.copy(_pe).applyMatrix4(cam.matrixWorldInverse);
				kk = (h * 0.5) / (Math.max(0.05, -_pd.z) * fovK);
				LB.boxes.push({
					x: (_pa.x * 0.5 + 0.5) * w, y: (0.5 - _pa.y * 0.5) * h,
					hw: ob.hw * kk, hh: ob.hh * kk
				});
			}

			for (i = 0; i < LB.items.length; i++) {
				it = LB.items[i];
				if (it.obj) _pe.copy(it.loc).applyMatrix4(it.obj.matrixWorld);
				else _pe.copy(it.loc);
				_pa.copy(_pe).project(cam);
				if (_pa.z > 1) {
					it.sp.visible = false;
					if (it.lead) it.lead.visible = false;
					continue;
				}
				it.sp.visible = true;
				_pd.copy(_pe).applyMatrix4(cam.matrixWorldInverse);
				var k = (h * 0.5) / (Math.max(0.05, -_pd.z) * fovK);
				var hw = it.sp.scale.x * k * 0.5, hh = it.sp.scale.y * k * 0.5;
				var clr = it.clear + it.clearW * k;
				var px = (_pa.x * 0.5 + 0.5) * w, py = (0.5 - _pa.y * 0.5) * h;
				if (it.obj) _pd.copy(it.nrm).transformDirection(it.obj.matrixWorld);
				else _pd.copy(it.nrm);
				_pb.copy(_pe).add(_pd).project(cam);
				var dx = (_pb.x - _pa.x) * w * 0.5, dy = (_pa.y - _pb.y) * h * 0.5;
				var dl = Math.sqrt(dx * dx + dy * dy);
				if (!(dl > 1e-3)) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
				rx = dx; ry = dy; cx = px; cy = py; ok = false;
				for (step = 0; step < 9 && !ok; step++) {
					/* 標籤中心至少要「清空距離 + 半個標籤」, 否則標籤會壓在錨點上 */
					dist = clr + Math.max(hw, hh) * 0.75 + 5 + step * (hh * 0.8 + 5);
					for (t = 0; t < 4 && !ok; t++) {
						ang = t === 0 ? 0 : (t === 1 ? 0.6 : (t === 2 ? -0.6 : 1.25));
						ca = Math.cos(ang); sa = Math.sin(ang);
						rx = dx * ca - dy * sa; ry = dx * sa + dy * ca;
						cx = px + rx * dist; cy = py + ry * dist;
						if (cx - hw < 3) cx = 3 + hw;
						if (cx + hw > w - 3) cx = w - 3 - hw;
						if (cy - hh < 3) cy = 3 + hh;
						if (cy + hh > h - 3) cy = h - 3 - hh;
						ok = true;
						for (b = 0; b < LB.boxes.length; b++) {
							if (Math.abs(cx - LB.boxes[b].x) < hw + LB.boxes[b].hw + 3 &&
								Math.abs(cy - LB.boxes[b].y) < hh + LB.boxes[b].hh + 3) { ok = false; break; }
						}
					}
				}
				LB.boxes.push({ x: cx, y: cy, hw: hw, hh: hh });
				_pc.set((cx / w) * 2 - 1, 1 - (cy / h) * 2, _pa.z).unproject(cam);
				it.sp.position.copy(_pc);
				if (it.lead) {
					var tx = Math.min(hw / Math.max(1e-3, Math.abs(rx)), hh / Math.max(1e-3, Math.abs(ry)));
					_pc.set(((cx - rx * tx) / w) * 2 - 1, 1 - ((cy - ry * tx) / h) * 2, _pa.z).unproject(cam);
					_pd.copy(_pc).sub(_pe);
					var len = _pd.length();
					if (len > 1e-3) {
						_pd.multiplyScalar(1 / len);
						it.lead.visible = true;
						it.lead.position.copy(_pe).addScaledVector(_pd, len * 0.5);
						it.lead.quaternion.setFromUnitVectors(_upv, _pd);
						it.lead.scale.set(1, len, 1);
					} else it.lead.visible = false;
				}
			}
		}

		/* ---------------- 物理 ---------------- */

		function compute() {
			var p = P[mode];
			st.r = p.r; st.v = p.v; st.m = mode === 'rope' ? p.m : 0;
			st.T = TAU * st.r / st.v;
			st.w = st.v / st.r;
			st.ac = st.v * st.v / st.r;
			st.Fc = st.m * st.ac;
			st.th = Math.atan(st.v * st.v / (st.r * G));
			st.thDeg = st.th * 180 / Math.PI;
			st.hRoad = BANK_W * Math.tan(st.th);
			/* 彎道在大傾角時是一個深碗, 近端邊緣透視放大: 相機距離要跟著 h 長 */
			/* 繩模式: 鏡頭跟著圈的大小走, 小 r 時球才不會縮成一個點 */
			st.dist = mode === 'rope' ? 3.2 + 2.4 * st.r : 26 + 1.3 * st.hRoad;
			/* 標籤字高: 由相機距離與畫布高度一起推, 目標是「畫面上 13px」——
			   畫布高 213 (390px 手機) 與 445 (1280) 都要落在 13px 左右,
			   否則小螢幕的字太小、大螢幕的標籤又會互相壓住。 */
			var bb = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
			box.w = bb && bb.width > 40 ? bb.width : 340;
			box.h = bb && bb.height > 40 ? bb.height : 213;
			st.lbl = 13.8 * st.dist / box.h;
			st.sh = st.dist * 0.011;     /* 箭桿半徑 */
		}

		/* ---------------- 場景: 繩與球 ---------------- */

		function buildRope() {
			var r = st.r, lbl = st.lbl, sh = st.sh;

			var grass = D.ground(22, '#6f7f5a');
			grass.position.y = FLOOR_Y;
			root.add(grass);

			/* 桌腳頂端要收在桌面下方: 兩個共平面的圓盤會打架, 桌面中心會長出一圈尖刺 */
			var pedR = Math.min(0.46, (r + TABLE_PAD) * 0.22);
			var pedTop = -0.16;
			var ped = D.cylinder(pedR, pedR * 1.6, pedTop - FLOOR_Y, '#9aa3ad', { roughness: 0.42, metalness: 0.62, segments: 24 });
			ped.position.y = (pedTop + FLOOR_Y) / 2;
			root.add(ped);

			var tableR = r + TABLE_PAD;
			var table = D.cylinder(tableR, tableR, 0.14, '#8a6a44', { roughness: 0.88, metalness: 0.02, segments: 56 });
			table.position.y = -0.07;
			root.add(table);

			var post = D.cylinder(0.045, 0.045, PIVOT_Y, '#9aa3ad', { roughness: 0.34, metalness: 0.72, segments: 16 });
			post.position.y = PIVOT_Y / 2;
			root.add(post);
			var knob = D.sphere(0.07, '#9aa3ad', { roughness: 0.34, metalness: 0.72 });
			knob.position.set(0, PIVOT_Y, 0);
			root.add(knob);

			/* 會轉的那一組: 球、繩、箭頭、標籤都掛這裡, 每幀只改 rotation.y */
			var rig = new THREE.Group();
			rig.position.set(0, PLANE_Y, 0);
			root.add(rig);

			rig.add(D.ring(r - 0.018, r + 0.018, '#eaf1f8', { axis: 'y', opacity: 0.42, segments: 96 }));
			var spoke = strut(0, 0, 0, r, 0, 0, sh * 0.3, '#eaf1f8', { opacity: 0.55, roughness: 0.9, metalness: 0 });
			if (spoke) rig.add(spoke);
			rig.add(D.sphere(sh * 0.8, '#eaf1f8', { roughness: 0.9, metalness: 0 }));

			var string = strut(0, DROP, 0, r, 0, 0, sh * 0.34, '#f2f6fa', { roughness: 0.72, metalness: 0.04 });
			if (string) rig.add(string);

			var ball = D.sphere(0.2, '#b03a2e', { roughness: 0.38, metalness: 0.08 });
			ball.position.set(r, 0, 0);
			rig.add(ball);

			/* 切線速度: 沿 -Z (rotation.y 增大時球就往 -Z 走) */
			var vLen = clamp(0.4 + st.v * 0.05, 0.45, 1.0);
			rig.add(D.arrow3([r, 0, -0.2], [r, 0, -0.2 - vLen], GREEN, { width: sh }));
			/* 向心: 沿 -X 指回軸心; 小 r 時縮短, 免得穿過軸 */
			var cLen = clamp(0.3 + st.Fc * 0.055, 0.3, 1.0);
			cLen = Math.min(cLen, r * 0.82);
			rig.add(D.arrow3([r - 0.2, 0, 0], [r - 0.2 - cLen, 0, 0], RED, { width: sh }));

			/* 只留一個數字標籤: r 小時圈只有一個指頭大, 兩個標籤會把球壓住。
			   位置由 lbLayout 推開 (錨點在 rig 座標裡, 所以跟著球轉)。 */
			lbBlock([r, 0, 0], 0.22, 0.22, rig);                 /* 球本身不准壓 */
			var lv = tag('v = ' + num(st.v, 1) + ' m/s', lbl, '#c8f0d8');
			root.add(lv);
			root.add(lbLead(lbAdd(lv, [r, 0, -0.2 - vLen], [0.15, 1, -0.5], rig, 8, 0.42), sh * 0.35, '#e8eef4'));

			return rig;
		}

		/* ---------------- 場景: 傾斜彎道 ---------------- */

		function buildBank() {
			var lbl = st.lbl, sh = st.sh, th = st.th;
			var h = st.hRoad;
			var RIN = BANK_R - BANK_W / 2, ROUT = BANK_R + BANK_W / 2;
			var hh = Math.max(h, 0.002);

			var grass = D.ground(90, '#6f7f5a');
			grass.position.y = -0.35;
			root.add(grass);

			/* 路面 = 圓錐面的一段: 內緣低 (y=0)、外緣高 (y=h) */
			var road = D.cylinder(ROUT, RIN, hh, '#4a4d52', {
				open: true, side: THREE.DoubleSide, roughness: 0.95, metalness: 0.05, segments: 96
			});
			road.position.y = hh / 2;
			root.add(road);

			/* 兩條邊線: 俯視時才讀得出這是「環」 */
			var inLine = D.ring(RIN - sh * 0.7, RIN + sh * 0.7, '#e8eef4', { axis: 'y', opacity: 0.8, segments: 120 });
			inLine.position.y = 0.03;
			root.add(inLine);
			var outLine = D.ring(ROUT - sh * 0.7, ROUT + sh * 0.7, '#e8eef4', { axis: 'y', opacity: 0.8, segments: 120 });
			outLine.position.y = hh + 0.03;
			root.add(outLine);

			var rig = new THREE.Group();
			root.add(rig);

			var car = new THREE.Group();
			car.position.set(BANK_R, h / 2, 0);
			car.rotation.z = th;      /* 車身貼著路面傾 */
			rig.add(car);

			var body = D.box(1.15, 0.5, 2.5, '#2e6db4', { roughness: 0.35, metalness: 0.3 });
			body.position.set(0, 0.38, 0);
			car.add(body);
			var cabin = D.box(1.0, 0.38, 1.2, '#20262e', { roughness: 0.26, metalness: 0.34 });
			cabin.position.set(0, 0.72, -0.1);
			car.add(cabin);
			for (var i = 0; i < 4; i++) {
				var wheel = D.cylinder(0.21, 0.21, 0.16, '#1b1d21', { roughness: 0.82, metalness: 0.1, segments: 16 });
				wheel.rotation.z = Math.PI / 2;
				wheel.position.set(i < 2 ? -0.56 : 0.56, 0.21, i % 2 ? -0.82 : 0.82);
				car.add(wheel);
			}

			/* N 垂直路面, W 垂直向下; 長度比就是 N : W = 1/cosθ : 1 (上限 3.2 倍, 免得爆框) */
			/* 兩支箭頭都從車頂上方的一點畫出去: 從車身中心畫會穿過車體, 頭也看不見。
			   箭桿細一點, 短箭頭才不會變成蘑菇。 */
			var base = 1.9;
			var ln = Math.min(base / Math.cos(th), base * 3.2);
			var lw = 1.7;
			var oy = 1.95;
			var thin = sh * 0.55;
			car.add(D.arrow3([0, oy, 0], [0, oy + ln, 0], RED, { width: thin }));
			var wx = -Math.sin(th) * lw, wy = -Math.cos(th) * lw;
			car.add(D.arrow3([0, oy, 0], [wx, oy + wy, 0], AMBER, { width: thin }));

			lbBlock([0, 1.0, 0], 1.1, 1.1, car);                 /* 車身不准壓 */
			var lN = tag('N', lbl, '#f4c7c0');
			root.add(lN);
			root.add(lbLead(lbAdd(lN, [0, oy + ln, 0], [0.4, 1, 0], car, 9), sh * 0.35, '#f4c7c0'));
			var lW = tag('W', lbl, '#f6d6a2');
			root.add(lW);
			root.add(lbLead(lbAdd(lW, [wx, oy + wy, 0], [-1, -0.6, 0], car, 9), sh * 0.35, '#f6d6a2'));

			/* 傾角畫在路面外緣, 半徑寫在環外側 */
			var lT = tag('θ = ' + num(st.thDeg, 1) + '°', lbl);
			root.add(lT);
			root.add(lbLead(lbAdd(lT, [0, hh, BANK_R * 0.7], [0, 1, 0.45], null, 10), sh * 0.35, '#e8eef4'));
			var lR = tag('r = ' + num(st.r, 0) + ' m', lbl, '#dfe7ee');
			root.add(lR);
			root.add(lbLead(lbAdd(lR, [-BANK_R * 0.78, h * 0.5, -BANK_R * 0.5], [-1, 0.5, -0.3], null, 10), sh * 0.35, '#dfe7ee'));

			return rig;
		}

		var rigRef = null;
		var box = { w: 340, h: 213 };        /* 畫布 CSS 尺寸 (標籤佈局要用) */

		function build() {
			clearGroup(root);
			rigRef = mode === 'rope' ? buildRope() : buildBank();
		}

		function fit() {
			if (mode === 'rope') {
				stage.orbit({ minDist: 3.5, maxDist: 24, minPitch: 0.05, maxPitch: 1.28 });
				stage.look({ yaw: -0.7, pitch: 0.30, dist: st.dist, target: [0, 0.35, 0] });
			} else {
				stage.orbit({ minDist: 12, maxDist: 120, minPitch: 0.05, maxPitch: 1.28 });
				stage.look({
					yaw: -0.7, pitch: 0.30, dist: st.dist,
					target: [0, Math.min(st.hRoad * 0.42, 6.5), 0]
				});
			}
		}

		/* ---------------- 面板 ---------------- */

		var gMode = el('div', 'dl-panel__group');
		gMode.appendChild(el('span', 'dl-panel__label', '模式'));
		var seg = el('div', 'dl-seg');
		var btnRope = el('button', 'dl-btn', '繩與球');
		var btnBank = el('button', 'dl-btn', '傾斜彎道');
		btnRope.type = 'button';
		btnBank.type = 'button';
		seg.appendChild(btnRope);
		seg.appendChild(btnBank);
		gMode.appendChild(seg);

		var gGeo = el('div', 'dl-panel__group');
		gGeo.appendChild(el('span', 'dl-panel__label', '圓周'));

		function field(labelText, aria) {
			var f = el('div', 'dl-field');
			f.appendChild(el('span', 'dl-field__label', labelText));
			var inp = el('input', 'dl-range');
			inp.type = 'range';
			inp.setAttribute('aria-label', aria);
			var out = el('output', 'dl-field__val c3-out', '—');
			f.appendChild(inp);
			f.appendChild(out);
			return { root: f, inp: inp, out: out };
		}

		var fR = field('半徑 r', '圓周半徑（米）');
		var fV = field('速率 v', '速率（米每秒）');
		var fM = field('質量 m', '球質量（公斤）');
		gGeo.appendChild(fR.root);
		gGeo.appendChild(fV.root);
		gGeo.appendChild(fM.root);

		function cell(k) {
			var c = el('span', 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}

		var rds = el('div', 'dl-readouts');
		var rdT = cell('週期 T');
		var rdW = cell('角速度 ω');
		var rdA = cell('a_c');
		var rdK = cell('F_c');
		rds.appendChild(rdT.root);
		rds.appendChild(rdW.root);
		rds.appendChild(rdA.root);
		rds.appendChild(rdK.root);

		var texBox = el('div', 'c3-tex');
		var note = el('p', 'dl-note', '');

		panel.appendChild(gMode);
		panel.appendChild(gGeo);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		/* ---------------- 文字 ---------------- */

		var LEGEND_ROPE = '綠＝切線速度、紅＝向心力（沿半徑指回軸心）。速率不變，速度卻一直在變，因為方向每秒都在轉。';
		var LEGEND_BANK = '紅＝正向力 N（垂直路面）、橙＝重力 W。tanθ = v²/(rg)：v 越大、r 越小，路面越斜；環的大小固定，實際半徑看讀數。';
		var REDUCED = ' 已依系統設定暫停動態。';

		var lastTex = '';
		var lastH = 0;

		function setTex(text) {
			if (text === lastTex) return;
			lastTex = text;
			texBox.textContent = text;
			ctx.tex(texBox);
		}

		function writeNote() {
			note.textContent = (mode === 'rope' ? LEGEND_ROPE : LEGEND_BANK) + (ctx.reduced ? REDUCED : '');
		}

		function writeOut() {
			var p = P[mode];
			var rr = mode === 'rope' ? ROPE : BANK;
			fR.inp.min = String(rr.r[0]); fR.inp.max = String(rr.r[1]); fR.inp.step = String(rr.r[2]);
			fV.inp.min = String(rr.v[0]); fV.inp.max = String(rr.v[1]); fV.inp.step = String(rr.v[2]);
			fR.inp.value = String(p.r);
			fV.inp.value = String(p.v);
			fM.inp.min = String(ROPE.m[0]); fM.inp.max = String(ROPE.m[1]); fM.inp.step = String(ROPE.m[2]);
			fM.inp.value = String(P.rope.m);

			fR.out.textContent = mode === 'rope' ? num(st.r, 2) + ' m' : num(st.r, 0) + ' m';
			fV.out.textContent = num(st.v, 1) + ' m/s';
			fM.out.textContent = num(P.rope.m, 2) + ' kg';

			rdT.v.textContent = num(st.T, 2) + ' s';
			rdW.v.textContent = num(st.w, 2) + ' rad/s';
			rdA.v.textContent = num(st.ac, 2) + ' m/s²';
			if (mode === 'rope') {
				rdK.k.textContent = 'F_c';
				rdK.v.textContent = num(st.Fc, 2) + ' N';
			} else {
				rdK.k.textContent = '傾斜角 θ';
				rdK.v.textContent = num(st.thDeg, 2) + '°';
			}
		}

		function writeTex() {
			if (mode === 'rope') {
				setTex('\\( a_c = \\dfrac{v^2}{r} = \\dfrac{' + num(st.v, 2) + '^2}{' + num(st.r, 2) +
					'} = ' + num(st.ac, 2) + '\\ \\mathrm{m\\,s^{-2}} \\)');
			} else {
				setTex('\\( \\tan\\theta = \\dfrac{v^2}{rg} = ' + num(st.v * st.v / (st.r * G), 3) +
					' \\Rightarrow \\theta = ' + num(st.thDeg, 2) + '^\\circ \\)');
			}
		}

		/* ---------------- 更新 ---------------- */

		function refresh() {
			compute();
			build();
			fit();
			writeOut();
			writeTex();
			writeNote();
			lbLayout(box.w, box.h);
			stage.render();
		}

		function setMode(next) {
			if (next === mode) return;
			mode = next;
			btnRope.classList.toggle('is-on', mode === 'rope');
			btnBank.classList.toggle('is-on', mode === 'bank');
			btnRope.setAttribute('aria-pressed', mode === 'rope' ? 'true' : 'false');
			btnBank.setAttribute('aria-pressed', mode === 'bank' ? 'true' : 'false');
			fM.root.classList.toggle('c3-off', mode !== 'rope');
			angle = 0;
			refresh();
		}

		btnRope.addEventListener('click', function () { setMode('rope'); });
		btnBank.addEventListener('click', function () { setMode('bank'); });

		fR.inp.addEventListener('input', function () {
			var n = parseFloat(fR.inp.value);
			if (!isFinite(n)) return;
			P[mode].r = n;
			refresh();
		});
		fV.inp.addEventListener('input', function () {
			var n = parseFloat(fV.inp.value);
			if (!isFinite(n)) return;
			P[mode].v = n;
			refresh();
		});
		fM.inp.addEventListener('input', function () {
			var n = parseFloat(fM.inp.value);
			if (!isFinite(n)) return;
			P.rope.m = n;
			refresh();
		});

		/* ---------------- 開機 ---------------- */

		/* 版面一變就補一格: 暫停動態時沒有迴圈, 重設 drawing buffer 之後畫布會變空。
		   畫布高度變得多, 連標籤字高都要重算, 那就整幕重建一次。 */
		if (ctx.onResize) ctx.onResize(function () {
			var bh = canvas.getBoundingClientRect().height;
			if (Math.abs(bh - lastH) > 12) { lastH = bh; refresh(); } else stage.render();
		});

		btnRope.classList.add('is-on');
		btnRope.setAttribute('aria-pressed', 'true');
		btnBank.setAttribute('aria-pressed', 'false');
		refresh();

		if (ctx.reduced) {
			if (rigRef) rigRef.rotation.y = 0.5;
			stage.render();
		} else {
			stage.animate(function (dt) {
				angle = (angle + (P[mode].v / P[mode].r) * dt) % TAU;
				if (rigRef) rigRef.rotation.y = angle;
				lbLayout(box.w, box.h);
			});
		}

		return { destroy: function () { /* 收線由 dse-labs.js / three-kit.js 負責 */ } };
	});
})();
