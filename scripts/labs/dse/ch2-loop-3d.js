/**
 * ch2-loop-3d.js — 過山車圓環（3D · DSE 物理 第二章 II.f · 實驗 15）
 *
 * 為什麼要立體: 圓環最高點「重力與正向力同向」這件事, 平面圖畫不出來 ——
 * 只有在立著的環裡, 車廂是貼在環的內側跑, 重量才真的指向環心。
 *
 * 一條軌道三段: 直進段 → 環 (參數式 (R sinφ, R − R cosφ)) → 出環段。
 * 速度全程由能量給: v² = v_b² − 2g·y (y 由環底量起)。環頂 v_top² = v_b² − 4gR,
 * 若 ≤ 0 車子爬不到頂, 停在最高可達點。N/m = v²/R + g·cosφ, φ 由環底量起;
 * 頂點 N/m = v_top²/R − g, 一旦 < 0 就是脫軌 —— 而且會更早發生:
 * 解 cosφ = (2gR − v_b²)/(3gR) 就是 N 歸零的角度, 車在那裡離開軌道。
 */
(function () {
	'use strict';

	var G = 9.81;
	var TAU = Math.PI * 2;
	var GREEN = '#2f9e63';
	var RED = '#c0392b';
	var AMBER = '#e8a33d';
	var SPACING = 3.6;             /* 兩節車廂的間距 (m) */

	window.DSELab.define('loop-3d', function (mount, ctx) {
		var D = window.DSEThree;
		var doc = document;
		var THREE = null;

		/* ---------------- 狀態 ---------------- */
		var P = { R: 10, vb: 25 };
		var st = {
			R: 10, vb: 25, vTop2: 0, vTop: 0, Nm: 0, vMin: 0, phiDet: 0, phiStop: 0,
			bad: false, state: '', dist: 32, lbl: 1.76, sh: 0.35, tube: 0.22
		};
		var box = { w: 340, h: 213 };        /* 畫布 CSS 尺寸 (標籤佈局要用) */
		var path = [];
		var sTotal = 0, sLoop0 = 0, sLoop1 = 0, sDet = -1, sStop = -1;
		var sPos = 0, flying = false, flyT = 0, holdT = 0;
		var flyP = [0, 0], flyD = [1, 0], flyV = 0;

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
			camera: { yaw: -0.75, pitch: 0.28, dist: 32, target: [0, 9.5, 0] }
		});
		if (!stage) return;

		THREE = window.THREE;
		var AIM = new THREE.Vector3();
		var UP0 = new THREE.Vector3(0, 1, 0);

		stage.add(new THREE.AmbientLight(0xf4f7fa, 0.62));
		var key = new THREE.DirectionalLight(0xffffff, 0.95);
		key.position.set(9, 16, 11);
		stage.add(key);
		var fill = new THREE.DirectionalLight(0xdbe6f2, 0.32);
		fill.position.set(-11, 7, -9);
		stage.add(fill);
		stage.add(D.sky('#7fb2d9', '#e8eef4'));

		var root = new THREE.Group();
		stage.add(root);

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

		function strut(ax, ay, az, bx, by, bz, rad, color, opts) {
			var a = new THREE.Vector3(ax, ay, az);
			var d = new THREE.Vector3(bx - ax, by - ay, bz - az);
			var len = d.length();
			if (!(len > 1e-4)) return null;
			d.multiplyScalar(1 / len);
			var mesh = D.cylinder(rad, rad, len, color, opts || { segments: 12 });
			mesh.position.copy(a).addScaledVector(d, len * 0.5);
			mesh.quaternion.setFromUnitVectors(UP0, d);
			return mesh;
		}

		function tag(text, size, color) {
			var sp = D.label(text, color || '#f4f7fb', { size: size, bg: 'rgba(11,18,32,.62)' });
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
			st.R = P.R; st.vb = P.vb;
			var R = st.R, vb = st.vb;
			st.vMin = Math.sqrt(5 * G * R);
			st.vTop2 = vb * vb - 4 * G * R;
			st.vTop = st.vTop2 > 0 ? Math.sqrt(st.vTop2) : NaN;
			st.Nm = st.vTop2 / R - G;            /* 頂點: N/m = v_top²/R − g */

			var cosDet = (2 * G * R - vb * vb) / (3 * G * R);
			st.bad = false;
			if (st.vTop2 <= 0.05) {
				st.state = '未能到達頂部';
				st.bad = true;
				var yStop = vb * vb / (2 * G);
				st.phiStop = Math.acos(clamp(1 - yStop / R, -1, 1));
			} else if (st.Nm < -0.3) {
				st.state = '脫軌（N < 0）';
				st.bad = true;
				st.phiDet = Math.acos(clamp(cosDet, -1, 1));
			} else if (st.Nm <= 0.3) {
				/* 滑桿一格 0.1 m/s, 頂點 N/m 一格差約 0.22 N/kg;
				   門檻若只給 0.15,「剛好 N = 0」永遠點不到 */
				st.state = '剛好 N = 0';
			} else {
				st.state = '安全';
			}

			var L = 1.0 * R + 5;
			st.dist = 2.5 * R + 12;
			var bb = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
			box.w = bb && bb.width > 40 ? bb.width : 340;
			box.h = bb && bb.height > 40 ? bb.height : 213;
			st.lbl = 13.8 * st.dist / box.h;
			st.sh = st.dist * 0.011;
			st.tube = clamp(0.022 * R, 0.14, 0.45);
			st.straight = L;
		}

		function buildPath() {
			var R = st.R, L = st.straight;
			var N = 120;
			path = [];
			sTotal = 0;
			var prevX = null, prevY = null;

			function push(px, py, tx, ty, ux, uy) {
				if (prevX !== null) sTotal += Math.sqrt((px - prevX) * (px - prevX) + (py - prevY) * (py - prevY));
				path.push({ px: px, py: py, tx: tx, ty: ty, ux: ux, uy: uy, s: sTotal });
				prevX = px; prevY = py;
			}

			push(-L, 0, 1, 0, 0, 1);
			sLoop0 = sTotal;
			for (var i = 0; i <= N; i++) {
				var f = i / N * TAU;
				var sn = Math.sin(f), cs = Math.cos(f);
				push(R * sn, R - R * cs, cs, sn, -sn, cs);
			}
			sLoop1 = sTotal;
			push(L, 0, 1, 0, 0, 1);

			sDet = st.vTop2 > 0.05 && st.state === '脫軌（N < 0）' ? sLoop0 + R * st.phiDet : -1;
			sStop = st.vTop2 <= 0.05 ? sLoop0 + R * st.phiStop : -1;
		}

		/* 弧長 → 位置/切線/法線; 用上一次的索引往前找, 每幀只走幾格 */
		var lastIdx = 0;
		function sampleAt(s) {
			var n = path.length;
			if (s <= 0) return path[0];
			if (s >= sTotal) return path[n - 1];
			var i = lastIdx;
			if (i >= n - 1) i = 0;
			while (i < n - 2 && path[i + 1].s < s) i++;
			while (i > 0 && path[i].s > s) i--;
			lastIdx = i;
			var a = path[i], b = path[i + 1];
			var span = b.s - a.s;
			var t = span > 1e-6 ? (s - a.s) / span : 0;
			return {
				px: a.px + (b.px - a.px) * t,
				py: a.py + (b.py - a.py) * t,
				tx: a.tx + (b.tx - a.tx) * t,
				ty: a.ty + (b.ty - a.ty) * t,
				ux: a.ux + (b.ux - a.ux) * t,
				uy: a.uy + (b.uy - a.uy) * t
			};
		}

		/* ---------------- 場景 ---------------- */

		var cars = [];
		/* 跟著車跑的受力圖: nPvt 紅色正向力, wPvt 橙色重力, vPvt 綠色速度 */
		var nPvt = null, wPvt = null, vPvt = null, lvT = null, lwT = null;
		var wLen = 1, vLen = 1, kArrow = 1;
		var _up = new THREE.Vector3(0, 1, 0), _down = new THREE.Vector3(0, -1, 0), _dir = new THREE.Vector3();
		var lvItem = null, trail = null, animT = 0, lastTxtT = -9, lastTxt = '';

		function makeCar(color, roof) {
			var g = new THREE.Group();
			var body = D.box(2.0, 1.1, 3.3, color, { roughness: 0.36, metalness: 0.24 });
			body.position.y = 0.62;
			g.add(body);
			var top = D.box(1.7, 0.62, 1.9, roof, { roughness: 0.3, metalness: 0.3 });
			top.position.set(0, 1.42, -0.1);
			g.add(top);
			var seat = D.box(1.6, 0.5, 0.5, '#20262e', { roughness: 0.6, metalness: 0.1 });
			seat.position.set(0, 1.2, 1.0);
			g.add(seat);
			for (var i = 0; i < 4; i++) {
				var wheel = D.cylinder(0.3, 0.3, 0.2, '#1b1d21', { roughness: 0.85, metalness: 0.1, segments: 14 });
				wheel.rotation.z = Math.PI / 2;
				wheel.position.set(i < 2 ? -1.0 : 1.0, 0.3, i % 2 ? -1.1 : 1.1);
				g.add(wheel);
			}
			return g;
		}

		function buildTrack() {
			var R = st.R, L = st.straight, tr = st.tube, lbl = st.lbl, sh = st.sh;

			var grass = D.ground(Math.max(60, 4 * R + 40), '#6f7f5a');
			grass.position.y = -0.4;
			root.add(grass);

			/* 直軌: 兩條扁帶, 頂面在 y=0 */
			var t1 = D.box(2 * L, 0.4, 2.4, '#4a4d52', { roughness: 0.9, metalness: 0.08 });
			t1.position.set(-L / 2, -0.2, 0);
			root.add(t1);
			var t2 = D.box(2 * L, 0.4, 2.4, '#4a4d52', { roughness: 0.9, metalness: 0.08 });
			t2.position.set(L / 2, -0.2, 0);
			root.add(t2);

			/* 圓環: 48 段鋼管接成一圈 (DSEThree 沒有 tube, 就用短圓柱排) */
			/* 從環心 (0, R) 指向該點的水平/垂直混合方向 = 螢幕上的「往外」 */
			function radOut(p) {
				var dx = p[0] - 0, dy = p[1] - R, dz2 = p[2] - 0;
				var len = Math.sqrt(dx * dx + dy * dy + dz2 * dz2) || 1;
				return [dx / len, dy / len, dz2 / len];
			}

			var seg = 48;
			for (var i = 0; i < seg; i++) {
				var a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
				var piece = strut(R * Math.sin(a0), R - R * Math.cos(a0), 0,
					R * Math.sin(a1), R - R * Math.cos(a1), 0, tr, '#9aa3ad',
					{ roughness: 0.35, metalness: 0.7, segments: 10 });
				if (piece) root.add(piece);
			}

			/* 受力圖跟著車跑 (不是畫在固定的環頂):
			   三支箭頭各自掛在一個 pivot 上, pivot 每幀移到車的位置再做旋轉,
			   箭頭本身是「沿 +Y、長度 1」的單位箭, 長度靠 pivot.scale.y 伸縮。 */
			/* 箭長要成正比, N/W 才等於 (v²/R + g)/g。比例尺取「環底最大 N = 0.9R」,
			   兩支箭頭就同時留在框內, 又不會因為夾住上限而失真。 */
			/* 上限取 0.55R: 比例仍精確, 而箭頭在螢幕上不至於長到被透視拉歪
			   (同一支垂直箭頭越長, 近端與遠端的 px/單位差越多) */
			var nmMax = st.vb * st.vb / R + G;
			kArrow = 0.55 * R / nmMax;
			wLen = G * kArrow;
			vLen = R * 0.34;
			nPvt = new THREE.Group();
			wPvt = new THREE.Group();
			vPvt = new THREE.Group();
			nPvt.add(D.arrow3([0, 0, 0], [0, 1, 0], RED, { width: sh }));
			wPvt.add(D.arrow3([0, 0, 0], [0, 1, 0], AMBER, { width: sh }));
			vPvt.add(D.arrow3([0, 0, 0], [0, 1, 0], GREEN, { width: sh }));
			/* 受力圖是標注層: 不寫深度, 環底那支向下的 W 才不會鑽進軌道裡消失 */
			var arrowSets = [nPvt, wPvt, vPvt];
			for (var ai = 0; ai < arrowSets.length; ai++) {
				arrowSets[ai].traverse(function (obj) {
					if (obj.isMesh && obj.material) {
						obj.material.depthTest = false;
						obj.material.depthWrite = false;
						obj.renderOrder = 40;
					}
				});
			}
			root.add(nPvt); root.add(wPvt); root.add(vPvt);

			/* 標籤掛在各自的箭頭尖上 (pivot 的局部座標 (0,1,0) 就是箭頭尖),
			   所以車一動、箭頭一轉, 標籤的錨點也跟著走 */
			var lN = tag('N', lbl, '#f4c7c0');
			root.add(lN);
			lbLead(lbAdd(lN, [0, 1, 0], [0.4, 1, 0], nPvt, 8), sh * 0.35, '#f4c7c0');
			lwT = tag('W = mg', lbl, '#f6d6a2');
			root.add(lwT);
			/* 翻轉後局部 +Y = 世界向下; 再往 +Z (鏡頭這一側) 推一點,
			   標籤才不會停在軌道那塊深色板子上 */
			lbLead(lbAdd(lwT, [0, 1, 0], [0.5, 0.4, 1.2], wPvt, 8, st.R * 0.12), sh * 0.35, '#f6d6a2');
			lvT = tag('v = ' + num(st.vTop, 1) + ' m/s', lbl, '#c8f0d8');
			lastTxt = lvT.userData.txt = 'v = ' + num(st.vTop, 1) + ' m/s';
			root.add(lvT);
			lvItem = lbAdd(lvT, [0, 1, 0], [0.2, 1, 0.3], vPvt, 8);
			lbLead(lvItem, sh * 0.35, '#c8f0d8');
			/* 脫軌後那 0.4 秒的直線痕跡 */
			trail = D.cylinder(sh * 0.5, sh * 0.5, 1, RED, { roughness: 0.9, metalness: 0, opacity: 0.8, segments: 6 });
			trail.visible = false;
			root.add(trail);

			/* 兩種失敗都要在畫面上留下位置, 否則「底部速率」這個滑桿在 未能到達
			   與 脫軌 兩種情形下完全看不出差別 (兩者都只是頂點 N < 0 或沒有頂點) */
			if (st.vTop2 <= 0.05) {
				var yl = clamp(st.vb * st.vb / (2 * G), 0.3, 2 * R - 0.3);
				var line = D.box(1.7 * R, 0.05, 0.05, '#e8eef4', { roughness: 0.6, metalness: 0.1 });
				line.position.set(0, yl, 0);
				root.add(line);
				var mx0 = R * Math.sin(st.phiStop), my0 = R - R * Math.cos(st.phiStop);
				var stopDot = D.sphere(sh * 1.7, AMBER, { roughness: 0.45, metalness: 0.1 });
				stopDot.position.set(mx0, my0, 0);
				root.add(stopDot);
				var lstop = tag('最高 h = ' + num(yl, 1) + ' m', lbl, '#f6d6a2');
				root.add(lstop);
				root.add(lbLead(lbAdd(lstop, [R * 0.5, yl, 0], [1, 0.5, 0.3], null, 8, R * 0.5), sh * 0.35, '#f6d6a2'));
			} else if (st.bad) {
				var mx1 = R * Math.sin(st.phiDet), my1 = R - R * Math.cos(st.phiDet);
				var detDot = D.sphere(sh * 1.7, RED, { roughness: 0.45, metalness: 0.1 });
				detDot.position.set(mx1, my1, 0);
				root.add(detDot);
				var ldet = tag('N = 0 脫軌', lbl, '#f4c7c0');
				root.add(ldet);
				root.add(lbLead(lbAdd(ldet, [mx1, my1, 0], [0.9, 0.7, 0.25], null, 8, R * 0.3), sh * 0.35, '#f4c7c0'));
			}

			/* 環底的起跑標記: 至少要這麼快才不會在頂點掉下來 */
			var lmin = tag('v_min = ' + num(st.vMin, 1) + ' m/s', lbl, '#eaf1f8');
			root.add(lmin);
			root.add(lbLead(lbAdd(lmin, [-R * 0.35, 0.12, 3.4], [1, -0.2, 0.7], null, 10, R * 0.3), sh * 0.35, '#eaf1f8'));
			var bar = D.box(R * 0.5, 0.12, 0.12, GREEN, { roughness: 0.5, metalness: 0.1 });
			bar.position.set(-R * 0.35, 0.06, 3.4);
			root.add(bar);

			cars = [makeCar('#b03a2e', '#e8eef4'), makeCar('#2e6db4', '#e8eef4')];
			for (var c = 0; c < cars.length; c++) root.add(cars[c]);
		}

		function placeCar(car, s) {
			var q = sampleAt(s);
			car.position.set(q.px, q.py, 0);
			car.up.set(q.ux, q.uy, 0);
			AIM.set(q.px + q.tx, q.py + q.ty, 0);
			car.lookAt(AIM);
		}

		function placeTrain(s) {
			if (!cars.length) return;
			placeCar(cars[0], s);
			placeCar(cars[1], Math.max(0, s - SPACING));
			placeArrows(sampleAt(s));
			if (nPvt) { nPvt.visible = wPvt.visible = vPvt.visible = true; }
		}

		function fit() {
			stage.orbit({ minDist: st.R * 1.1, maxDist: st.R * 8, minPitch: 0.05, maxPitch: 1.2 });
			stage.look({ yaw: -0.75, pitch: 0.26, dist: st.dist, target: [0, st.R * 0.98, 0] });
		}

		/* ---------------- 面板 ---------------- */

		var gGeo = el('div', 'dl-panel__group');
		gGeo.appendChild(el('span', 'dl-panel__label', '圓環'));

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

		var fR = field('半徑 R', '圓環半徑（米）');
		var fV = field('底部速率 v', '環底速率（米每秒）');
		gGeo.appendChild(fR.root);
		gGeo.appendChild(fV.root);

		function cell(k, wide) {
			var c = el('span', wide ? 'dl-readout c3-wide' : 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}

		var rds = el('div', 'dl-readouts');
		var rdTop = cell('頂點 v');
		var rdAcc = cell('v²/R');
		var rdN = cell('N/m');
		var rdMin = cell('v_min');
		var rdS = cell('狀態', true);
		rds.appendChild(rdTop.root);
		rds.appendChild(rdAcc.root);
		rds.appendChild(rdN.root);
		rds.appendChild(rdMin.root);
		rds.appendChild(rdS.root);

		var texBox = el('div', 'c3-tex');
		var note = el('p', 'dl-note', '');
		panel.appendChild(gGeo);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		var NOTE = '橙＝重力 W、紅＝正向力 N、綠＝速度。頂點 N = 0 就是維持圓周的最小速率，對應環底 v_min = √(5gR)。';
		var REDUCED = ' 已依系統設定暫停動態。';
		note.textContent = NOTE + (ctx.reduced ? REDUCED : '');
		if (ctx.onResize) ctx.onResize(function () {
			var bh = canvas.getBoundingClientRect().height;
			if (Math.abs(bh - lastH) > 12) { lastH = bh; rebuild(false); } else stage.render();
		});
		var lastTex = '';
		var lastH = 0;

		function setTex(text) {
			if (text === lastTex) return;
			lastTex = text;
			texBox.textContent = text;
			ctx.tex(texBox);
		}

		function writeOut() {
			fR.inp.min = '5'; fR.inp.max = '20'; fR.inp.step = '0.5'; fR.inp.value = String(P.R);
			fV.inp.min = '10'; fV.inp.max = '40'; fV.inp.step = '0.1'; fV.inp.value = String(P.vb);
			fR.out.textContent = num(st.R, 1) + ' m';
			fV.out.textContent = num(st.vb, 1) + ' m/s';

			rdTop.v.textContent = isFinite(st.vTop) ? num(st.vTop, 2) + ' m/s' : '—';
			rdTop.v.classList.toggle('c3-mute', !isFinite(st.vTop));
			rdAcc.v.textContent = st.vTop2 > 0 ? num(st.vTop2 / st.R, 2) + ' m/s²' : '—';
			rdN.v.textContent = st.vTop2 > 0 ? num(st.Nm, 2) + ' N/kg' : '—';
			rdN.v.classList.toggle('c3-warn', st.bad);
			rdMin.v.textContent = num(st.vMin, 2) + ' m/s';
			rdS.v.textContent = st.state;
			rdS.v.classList.toggle('c3-warn', st.bad);
		}

		function writeTex() {
			if (st.vTop2 > 0) {
				setTex('\\( \\dfrac{N}{m} = \\dfrac{v_{top}^2}{R} - g = ' + num(st.vTop2 / st.R, 2) +
					' - 9.81 = ' + num(st.Nm, 2) + '\\ \\mathrm{N\\,kg^{-1}} \\)');
			} else {
				setTex('\\( v_{top}^2 = v_b^2 - 4gR = ' + num(st.vTop2, 1) +
					' < 0 \\Rightarrow \\text{爬不到頂} \\)');
			}
		}

		function rebuild(resetPos) {
			compute();
			buildPath();
			clearGroup(root);
			buildTrack();
			fit();
			writeOut();
			writeTex();
			if (resetPos) {
				sPos = 0;
				flying = false;
				holdT = 0;
			}
			placeTrain(sPos);       /* 重建後車廂要放回去, 暫停動態時沒有下一幀可等 */
			lbLayout(box.w, box.h);
			stage.render();
		}

		fR.inp.addEventListener('input', function () {
			var n = parseFloat(fR.inp.value);
			if (!isFinite(n)) return;
			P.R = n;
			rebuild(true);
		});
		fV.inp.addEventListener('input', function () {
			var n = parseFloat(fV.inp.value);
			if (!isFinite(n)) return;
			P.vb = n;
			rebuild(true);
		});

		/* ---------------- 動畫 ---------------- */

		function resetRun() {
			sPos = 0;
			flying = false;
			holdT = 0;
			flyT = 0;
			if (trail) trail.visible = false;
		}

		/* 每幀把三支箭頭放到車上: N 指向環心, W 永遠向下, v 沿切線 */
		function placeArrows(q) {
			if (!nPvt) return;
			var R = st.R;
			/* 以「車頂」為原點: 沿車自己的 up (環內側) 抬 1.1, 車身中心在 0.9,
			   所以任何環位置 (含倒掛的頂點) 箭尾與車心的距離都固定 0.2 世界單位 */
			var cx = q.px + q.ux * 1.1, cy = q.py + q.uy * 1.1;
			/* N: 由車指向環心 (0, R, 0) */
			_dir.set(0 - cx, R - cy, 0);
			var dLen = _dir.length() || 1;
			_dir.multiplyScalar(1 / dLen);
			var v2 = st.vb * st.vb - 2 * G * q.py;
			var spd = v2 > 0 ? Math.sqrt(v2) : 0;
			var cosPhi = (R - q.py) / R;
			var nm = spd * spd / R + G * cosPhi;          /* N/m, 可為負 */
			nPvt.position.set(cx, cy, 0);
			nPvt.quaternion.setFromUnitVectors(_up, _dir);
			nPvt.scale.set(1, Math.max(nm * kArrow, st.R * 0.015), 1);
			/* W: 垂直向下, 長度固定 (mg 是常數) */
			/* 箭頭是沿 +Y 建的, 所以「向下」= 把 pivot 轉 180° (不是靠負 scale,
			   負 scale 會同時把箭頭的頭與法線翻面, 看起來仍是向上) */
			wPvt.position.set(cx, cy, 0);
			wPvt.quaternion.setFromUnitVectors(_up, _down);
			wPvt.scale.set(1, wLen, 1);
			/* v: 沿切線 */
			_dir.set(q.tx, q.ty, 0);
			vPvt.position.set(cx, cy, 0);
			vPvt.quaternion.setFromUnitVectors(_up, _dir);
			vPvt.scale.set(1, vLen, 1);
			/* 速度文字: 變了才重建貼圖 (每秒最多幾次) */
			var txt = 'v = ' + num(spd, 1) + ' m/s';
			/* 每 0.3 秒重建一次速度貼圖 (貼圖文字不能就地改), 上限約 3 張/秒 */
			if (lvItem && animT - lastTxtT > 0.3 && txt !== lastTxt) {
				lastTxt = txt;
				lastTxtT = animT;
				var old = lvItem.sp;
				var sp = tag(txt, st.lbl, '#c8f0d8');
				if (sp.material.map && old && old.material.map) old.material.map.dispose();
				if (old && old.material) old.material.dispose();
				if (old && old.parent) old.parent.remove(old);
				lvItem.sp = sp;
				lvT = sp;
				root.add(sp);
			}
		}

		function frame(dt) {
			var R = st.R, vb = st.vb;
			animT += dt;
			if (flying) {
				flyT += dt;
				var px = flyP[0] + flyD[0] * flyV * flyT;
				var py = flyP[1] + flyD[1] * flyV * flyT - 0.5 * G * flyT * flyT;
				if (nPvt) { nPvt.visible = wPvt.visible = vPvt.visible = false; }
				if (cars.length) {
					for (var c = 0; c < cars.length; c++) {
						var off = c * SPACING;
						cars[c].position.set(px - flyD[0] * off, py - flyD[1] * off, 0);
						cars[c].up.copy(UP0);
						AIM.set(px - flyD[0] * off + flyD[0], py - flyD[1] * off + flyD[1], 0);
						cars[c].lookAt(AIM);
					}
				}
				if (trail) {
					_dir.set(px - flyP[0], py - flyP[1], 0);
					var tl = _dir.length();
					if (tl > 1e-3) {
						trail.visible = true;
						trail.position.set((px + flyP[0]) / 2, (py + flyP[1]) / 2, 0);
						trail.quaternion.setFromUnitVectors(_up, _dir.multiplyScalar(1 / tl));
						trail.scale.set(1, tl, 1);
					}
				}
				/* 只飛 0.4 秒就回起點重跑; 飛出 2.5R 也立刻收 */
				var far = Math.sqrt(px * px + (py - st.R) * (py - st.R)) > st.R * 2.5;
				if (flyT > 0.4 || py < -1 || far) resetRun();
				return;
			}

			var q = sampleAt(sPos);
			var v2 = vb * vb - 2 * G * q.py;
			var v = v2 > 0 ? Math.sqrt(v2) : 0;
			if (v > 0) sPos += v * dt;

			if (sStop >= 0 && sPos >= sStop) {
				sPos = sStop;
				holdT += dt;
				if (holdT > 1.4) resetRun();
			} else if (sDet >= 0 && sPos >= sDet) {
				flying = true;
				flyT = 0;
				flyP = [q.px, q.py];
				flyD = [q.tx, q.ty];
				flyV = v;
			} else if (sPos >= sTotal) {
				resetRun();
			}
			placeTrain(sPos);
			lbLayout(box.w, box.h);
		}

		/* ---------------- 開機 ---------------- */

		rebuild(true);

		if (ctx.reduced) {
			placeTrain(sLoop0 + Math.PI * st.R);
			stage.render();
		} else {
			stage.animate(frame);
		}

		return { destroy: function () { /* 收線由 dse-labs.js / three-kit.js 負責 */ } };
	});
})();
