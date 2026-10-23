/**
 * ch2-washer-3d.js — 洗衣機脫水（3D · DSE 物理 第二章 II.f · 實驗 16）
 *
 * 為什麼要立體: 「水滴沿切線飛出去」是慣性, 只有在鼓外看得到那條直線 ——
 * 平面圓圖只能說「切線方向」, 立體圖裡水滴是真的走直線, 而鼓一直在轉。
 *
 * 判據: 布料/孔洞能提供的最大向心加速度是 a_max。需要的是 a_c = ω²r;
 * 一旦 a_c > a_max, 水滴就留不住, 以當時的切線速度 v = ωr 離開。
 * 真實轉速下 31 m/s 的水滴 0.05 秒就飛出畫面, 所以畫面用 1/18 慢動作,
 * 讀數仍是真值 (面板的 .dl-note 有寫)。
 */
(function () {
	'use strict';

	var G = 9.81;
	var TAU = Math.PI * 2;
	var SLOW = 1 / 18;             /* 畫面上的慢動作倍率 (只有畫面, 不動物理) */
	var DRUM_H = 0.62;
	var MAX_DROPS = 8;
	var GREEN = '#2f9e63';
	var RED = '#c0392b';
	var METAL = '#9aa3ad';

	window.DSELab.define('washer-3d', function (mount, ctx) {
		var D = window.DSEThree;
		var doc = document;
		var THREE = null;

		var P = { rpm: 1200, r: 0.25, aMax: 2000 };
		var st = { w: 0, v: 0, ac: 0, gRel: 0, out: false, dist: 2.4, lbl: 0.13, sh: 0.026 };

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
			camera: { yaw: -0.7, pitch: 0.36, dist: 2.4, target: [0, -0.02, 0] }
		});
		if (!stage) return;

		THREE = window.THREE;

		stage.add(new THREE.AmbientLight(0xf4f7fa, 0.66));
		var key = new THREE.DirectionalLight(0xffffff, 0.95);
		key.position.set(4, 7, 5);
		stage.add(key);
		var fill = new THREE.DirectionalLight(0xdbe6f2, 0.34);
		fill.position.set(-5, 3, -4);
		stage.add(fill);
		stage.add(D.sky('#8fb6d6', '#eef2f6'));

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

		function tag(text, size, color) {
			var sp = D.label(text, color || '#f4f7fb', { size: size, bg: 'rgba(11,18,32,.62)' });
			/* 標籤是標注層: 不寫深度, 否則被地面或筒身擋住就整句消失 */
			sp.material.depthTest = false;
			sp.renderOrder = 60;
			return sp;
		}

		/* ---------------- 螢幕空間標籤佈局 ----------------
		   貼圖的大小是世界單位算的, 但「有沒有壓到網格、有沒有互相重疊」是螢幕上的
		   事 —— 相機一轉、畫布一窄就變。做法: 把錨點投影到螢幕, 沿外法線往外推,
		   推到不撞已佔矩形為止, 再反投影回同一個深度。全程重用向量, 每幀零配置。 */
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

			/* HUD 板先佔右上角: 它固定貼在畫面上, 不跟場景一起轉 */
			if (LB.hud) {
				/* 窄畫布時整塊縮小 (字仍 >=10px): 340px 畫布上 152px 的板子會佔掉一半 */
				var hs = Math.max(0.74, Math.min(1, w / 700));
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
			st.w = P.rpm * TAU / 60;
			st.v = st.w * P.r;
			st.ac = st.w * st.w * P.r;
			st.gRel = st.ac / G;
			st.out = st.ac > P.aMax;
			var bb = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
			box.w = bb && bb.width > 40 ? bb.width : 340;
			box.h = bb && bb.height > 40 ? bb.height : 213;
			st.lbl = 13.8 * st.dist / box.h;
			st.sh = st.dist * 0.011;
		}

		/* ---------------- 鼓壁貼圖: 一層不鏽鋼 + 排孔 ---------------- */

		function holeTexture() {
			var c = doc.createElement('canvas');
			c.width = 512; c.height = 256;
			var g = c.getContext('2d');
			g.fillStyle = '#c2cad2';
			g.fillRect(0, 0, 512, 256);
			var i, j;
			for (i = 0; i < 12; i++) {     /* 直條壓光: 讓鼓轉起來看得出來 */
				g.fillStyle = i % 2 ? 'rgba(255,255,255,.16)' : 'rgba(90,102,114,.10)';
				g.fillRect(i * 42.6, 0, 21, 256);
			}
			for (i = 0; i < 12; i++) {
				for (j = 0; j < 5; j++) {
					var x = i * 42.6 + 21.3, y = 26 + j * 46;
					g.beginPath(); g.arc(x, y, 9, 0, TAU);
					g.fillStyle = '#39424b'; g.fill();
					g.beginPath(); g.arc(x - 1.5, y - 1.5, 7, 0, TAU);
					g.fillStyle = '#20262c'; g.fill();
				}
			}
			var tex = new THREE.CanvasTexture(c);
			tex.wrapS = THREE.RepeatWrapping;
			tex.wrapT = THREE.ClampToEdgeWrapping;
			return tex;
		}

		/* ---------------- 場景 ---------------- */

		var drum = null, cling = null, drops = [], dropRoot = null;
		var box = { w: 340, h: 213 };         /* 畫布的 CSS 尺寸 (標籤佈局要用) */
		var drumAngle = 0, spawnT = 0;

		function buildScene() {
			var r = P.r, lbl = st.lbl, sh = st.sh;
			var half = DRUM_H / 2;

			var floorPad = D.cylinder(r * 1.95, r * 1.95, 0.05, '#4a4d52', { roughness: 0.92, metalness: 0.05, segments: 48 });
			floorPad.position.y = -half - 0.025;
			root.add(floorPad);

			var baseM = D.cylinder(r * 1.06, r * 1.16, 0.1, '#7c848c', { roughness: 0.42, metalness: 0.66, segments: 48 });
			baseM.position.y = -half + 0.05;
			root.add(baseM);

			drum = new THREE.Group();
			drum.position.y = 0;
			root.add(drum);

			var wall = D.cylinder(r, r * 0.98, DRUM_H, '#ffffff', {
				open: true, side: THREE.DoubleSide, roughness: 0.34, metalness: 0.62, segments: 64
			});
			wall.material.map = holeTexture();
			wall.material.needsUpdate = true;
			drum.add(wall);

			var floor = D.cylinder(r * 0.98, r * 0.9, 0.04, METAL, { roughness: 0.36, metalness: 0.66, segments: 48 });
			floor.position.y = -half + 0.02;
			drum.add(floor);

			/* 鼓緣的凸塊: 轉動的參照物 */
			for (var i = 0; i < 10; i++) {
				var a = i / 10 * TAU;
				var stud = D.box(0.03, 0.055, 0.03, '#7c848c', { roughness: 0.4, metalness: 0.7 });
				stud.position.set(r * Math.cos(a), half, r * Math.sin(a));
				drum.add(stud);
			}

			/* 貼在鼓壁上的水 (甩不出去的時候) */
			cling = new THREE.Group();
			for (var k = 0; k < 8; k++) {
				var ang = k / 8 * TAU + 0.4;
				var bead = D.sphere(0.018, '#2f6f9f', { roughness: 0.3, metalness: 0.05, opacity: 0.92 });
				bead.position.set(r * 0.965 * Math.cos(ang), -0.12 + (k % 3) * 0.11, r * 0.965 * Math.sin(ang));
				cling.add(bead);
			}
			drum.add(cling);

			/* 滴滴: 每顆 = 頭 + 三顆拖尾 (拖尾就是那條直線) */
			dropRoot = new THREE.Group();
			root.add(dropRoot);
			drops = [];
			for (var d = 0; d < MAX_DROPS; d++) {
				var mat = new THREE.MeshStandardMaterial({
					color: new THREE.Color('#2f6f9f'), roughness: 0.28, metalness: 0.06,
					transparent: true, opacity: 0.95
				});
				var grp = new THREE.Group();
				var head = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), mat);
				grp.add(head);
				var tail = [];
				for (var t = 0; t < 3; t++) {
					var dot = new THREE.Mesh(new THREE.SphereGeometry(0.009 - t * 0.002, 8, 6), mat);
					grp.add(dot);
					tail.push(dot);
				}
				grp.visible = false;
				dropRoot.add(grp);
				drops.push({ grp: grp, head: head, tail: tail, mat: mat, on: false, t: 0, x0: 0, y0: 0, z0: 0, vx: 0, vz: 0 });
			}

			/* 固定位置的三支說明箭頭 (在近端, 不隨鼓轉) */
			var aa = 2.15;
			var ax = r * Math.cos(aa), az = r * Math.sin(aa), ay = 0.02;
			var tanX = -Math.sin(aa), tanZ = Math.cos(aa);
			var vLen = 0.34;
			root.add(D.arrow3([ax + tanX * 0.02, ay, az + tanZ * 0.02], [ax + tanX * vLen, ay, az + tanZ * vLen], GREEN, { width: sh }));
			var cLen = Math.min(0.65 * r, 0.22);
			root.add(D.arrow3([ax * 0.97, ay, az * 0.97], [ax * 0.97 - Math.cos(aa) * cLen, ay, az * 0.97 - Math.sin(aa) * cLen], RED, { width: sh }));

			lbBlock([0, -0.02, 0], r * 1.16, half * 1.05);      /* 鼓身 (含底座) 不准壓 */
			lbBlock([0, -half - 0.02, 0], r * 1.3, 0.06);

			/* 三個說明標籤: 位置交給 lbLayout 推開, 這裡只給錨點、外法線、引線 */
			var lv = tag('v = ' + num(st.v, 1) + ' m/s', lbl, '#c8f0d8');
			root.add(lv);
			root.add(lbLead(lbAdd(lv, [ax + tanX * (vLen + 0.01), ay, az + tanZ * (vLen + 0.01)],
				[tanX, 0.35, tanZ], null, 9), sh * 0.4, '#e8eef4'));

			var lc = tag('a_c = ' + num(st.ac, 0) + ' m/s²', lbl, '#f4c7c0');
			root.add(lc);
			root.add(lbLead(lbAdd(lc, [ax * 0.99, ay, az * 0.99],
				[-0.92, 0.16, 0.34], null, 26), sh * 0.4, '#f4c7c0'));

			var lr = tag('r = ' + num(r, 2) + ' m', lbl, '#dfe7ee');
			root.add(lr);
			root.add(lbLead(lbAdd(lr, [r, 0.2, 0], [1, 0.5, 0], null, 26), sh * 0.4, '#dfe7ee'));

			/* a_c 對 a_max 的長條圖: 做成貼在畫布右上角的 HUD 板 (單位 = 畫素),
			   不再浮在地面上跟鼓搶位置。板子的尺寸寫在這裡, 位置由 lbLayout 給。 */
			var hud = new THREE.Group();
			var pw = 152, ph = 58;
			/* HUD 用不受光材料: 它是「面板」不是場景物件, 顏色要固定, 不能跟著陽光變暗 */
			function flatBox(bw, bh, bd, color, op) {
				var m = D.box(bw, bh, bd, '#ffffff');
				m.material.dispose();
				m.material = new THREE.MeshBasicMaterial({
					color: new THREE.Color(color), transparent: op != null && op < 1, opacity: op == null ? 1 : op
				});
				return m;
			}
			var plate = flatBox(pw, ph, 1, '#0b1220', 0.92);
			plate.renderOrder = 30;
			plate.material.depthTest = false;
			plate.material.depthWrite = false;
			hud.add(plate);
			var track = flatBox(112, 2.5, 1.6, '#8d949b', 1);
			track.position.set(0, -4, 2);
			track.renderOrder = 31;
			track.material.depthTest = false;
			hud.add(track);
			var frac = clamp(st.ac / 8000, 0.004, 1);
			var bar = flatBox(Math.max(1, 112 * frac), 9, 2, '#e0483a', 1);
			bar.position.set(-56 + 56 * frac, -4, 2);
			bar.renderOrder = 32;
			bar.material.depthTest = false;
			hud.add(bar);
			var mf = clamp(P.aMax / 8000, 0.004, 1);
			var mark = flatBox(3.5, 18, 2.2, '#ffffff', 1);
			mark.position.set(-56 + 112 * mf, -4, 2);
			mark.renderOrder = 33;
			mark.material.depthTest = false;
			hud.add(mark);
			var lg = tag('a_c', 16, '#f4c7c0');
			lg.position.set(-52, 15, 3);
			hud.add(lg);
			var lm = tag('a_max', 16, '#eef3f8');
			lm.position.set(clamp(-56 + 112 * mf, -34, 38), -19, 3);
			hud.add(lm);
			root.add(hud);
			LB.hud = { g: hud, w: pw, h: ph };
		}

		function fit() {
			stage.orbit({ minDist: 1.2, maxDist: 6, minPitch: 0.05, maxPitch: 1.25 });
			stage.look({ yaw: -0.7, pitch: 0.36, dist: st.dist, target: [0, -0.02, 0] });
		}

		/* ---------------- 面板 ---------------- */

		var gGeo = el('div', 'dl-panel__group');
		gGeo.appendChild(el('span', 'dl-panel__label', '滾筒'));

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

		var fN = field('轉速', '轉速（每分鐘轉數）');
		var fR = field('半徑 r', '滾筒半徑（米）');
		var fA = field('附著上限', '附著力上限（米每秒平方）');
		gGeo.appendChild(fN.root);
		gGeo.appendChild(fR.root);
		gGeo.appendChild(fA.root);

		function cell(k, wide) {
			var c = el('span', wide ? 'dl-readout c3-wide' : 'dl-readout');
			var kk = el('span', 'dl-readout__k', k);
			var vv = el('span', 'dl-readout__v', '—');
			c.appendChild(kk);
			c.appendChild(vv);
			return { root: c, k: kk, v: vv };
		}

		var rds = el('div', 'dl-readouts');
		var rdN = cell('轉速');
		var rdW = cell('ω');
		var rdV = cell('切線 v');
		var rdA = cell('a_c');
		var rdG = cell('a_c / g');
		var rdS = cell('狀態', true);
		rds.appendChild(rdN.root);
		rds.appendChild(rdW.root);
		rds.appendChild(rdV.root);
		rds.appendChild(rdA.root);
		rds.appendChild(rdG.root);
		rds.appendChild(rdS.root);

		var texBox = el('div', 'c3-tex');
		var note = el('p', 'dl-note', '');
		panel.appendChild(gGeo);
		panel.appendChild(rds);
		panel.appendChild(texBox);
		panel.appendChild(note);

		var NOTE = '綠＝切線速度、紅＝向心加速度。需要 a_c = ω²r，若超過附著上限 a_max 水滴就沿切線飛出（慣性），畫面以 1/18 慢動作顯示，讀數為真值。';
		var REDUCED = ' 已依系統設定暫停動態。';
		var lastTex = '';
		var lastH = 0;

		function setTex(text) {
			if (text === lastTex) return;
			lastTex = text;
			texBox.textContent = text;
			ctx.tex(texBox);
		}

		function writeOut() {
			fN.inp.min = '200'; fN.inp.max = '1600'; fN.inp.step = '10'; fN.inp.value = String(P.rpm);
			fR.inp.min = '0.15'; fR.inp.max = '0.35'; fR.inp.step = '0.005'; fR.inp.value = String(P.r);
			fA.inp.min = '500'; fA.inp.max = '8000'; fA.inp.step = '50'; fA.inp.value = String(P.aMax);
			fN.out.textContent = num(P.rpm, 0) + ' rpm';
			fR.out.textContent = num(P.r, 3) + ' m';
			fA.out.textContent = num(P.aMax, 0) + ' m/s²';

			rdN.v.textContent = num(P.rpm, 0) + ' rpm';
			rdW.v.textContent = num(st.w, 2) + ' rad/s';
			rdV.v.textContent = num(st.v, 2) + ' m/s';
			rdA.v.textContent = num(st.ac, 0) + ' m/s²';
			rdG.v.textContent = num(st.gRel, 0) + ' g';
			rdS.v.textContent = st.out ? '甩脫' : '留得住';
			rdS.v.classList.toggle('c3-warn', st.out);
		}

		function writeTex() {
			setTex('\\( a_c = r\\omega^2 = ' + num(P.r, 3) + ' \\times ' + num(st.w, 2) + '^2 = ' +
				num(st.ac, 0) + '\\ \\mathrm{m\\,s^{-2}} \\)');
		}

		function rebuild() {
			compute();
			clearGroup(root);
			buildScene();
			fit();
			writeOut();
			writeTex();
			note.textContent = NOTE + (ctx.reduced ? REDUCED : '');
			lbLayout(box.w, box.h);
			stage.render();
		}

		fN.inp.addEventListener('input', function () {
			var n = parseFloat(fN.inp.value);
			if (!isFinite(n)) return;
			P.rpm = n;
			rebuild();
		});
		fR.inp.addEventListener('input', function () {
			var n = parseFloat(fR.inp.value);
			if (!isFinite(n)) return;
			P.r = n;
			rebuild();
		});
		fA.inp.addEventListener('input', function () {
			var n = parseFloat(fA.inp.value);
			if (!isFinite(n)) return;
			P.aMax = n;
			rebuild();
		});

		/* ---------------- 動畫 ---------------- */

		function spawn() {
			var d = null;
			for (var i = 0; i < drops.length; i++) { if (!drops[i].on) { d = drops[i]; break; } }
			if (!d) return;
			var a = Math.random() * TAU;
			d.on = true;
			d.t = 0;
			d.x0 = P.r * Math.cos(a);
			d.z0 = P.r * Math.sin(a);
			d.y0 = -0.1 + Math.random() * 0.16;
			d.vx = -Math.sin(a) * st.v;
			d.vz = Math.cos(a) * st.v;
			d.grp.visible = true;
		}

		function stepDrops(dt) {
			var k;
			if (st.out) {
				spawnT += dt;
				if (spawnT > 0.34) { spawnT = 0; spawn(); }
			} else {
				spawnT = 0;
			}
			for (k = 0; k < drops.length; k++) {
				var d = drops[k];
				if (!d.on) continue;
				d.t += dt;
				var TTL = 0.9;
				if (d.t > TTL) { d.on = false; d.grp.visible = false; continue; }
				var tt = d.t * SLOW;
				var px = d.x0 + d.vx * tt;
				var pz = d.z0 + d.vz * tt;
				var py = d.y0 - 0.5 * G * tt * tt;
				d.head.position.set(px, py, pz);
				for (var j = 0; j < d.tail.length; j++) {
					var f = 0.5 + j * 0.18;
					d.tail[j].position.set(
						d.x0 + (px - d.x0) * f,
						d.y0 + (py - d.y0) * f,
						d.z0 + (pz - d.z0) * f
					);
				}
				d.mat.opacity = clamp(1 - d.t / TTL, 0, 1) * 0.95;
			}
		}

		function frame(dt) {
			if (!drum) return;
			drumAngle = (drumAngle + st.w * SLOW * dt) % TAU;
			/* three 的 rotation.y = a 會把 (ρ,0,0) 轉到 (ρcos a, 0, −ρsin a);
			   水滴用的是 p(θ) = (ρcosθ, 0, ρsinθ)、v ∝ (−sinθ, 0, cosθ),
			   所以鼓面轉角要取負號, 凸塊和水滴才會同向 —— 否則切線箭頭看起來是反的。 */
			drum.rotation.y = -drumAngle;
			/* 甩不出去的時候, 水滴貼在鼓壁上一起轉 */
			if (cling) cling.visible = !st.out;
			stepDrops(dt);
			lbLayout(box.w, box.h);
		}

		/* ---------------- 開機 ---------------- */

		if (ctx.onResize) ctx.onResize(function () {
			var bh = canvas.getBoundingClientRect().height;
			if (Math.abs(bh - lastH) > 12) { lastH = bh; rebuild(); } else stage.render();
		});

		rebuild();

		if (ctx.reduced) {
			drum.rotation.y = -0.6;
			if (cling) cling.visible = !st.out;
			/* 靜態的一格: 放兩三顆在軌跡上, 讓「沿切線走直線」看得見 */
			for (var i = 0; i < 3; i++) {
				var d = drops[i];
				var a = 2.15 - i * 0.5;
				d.on = true;
				d.grp.visible = true;
				d.x0 = P.r * Math.cos(a); d.z0 = P.r * Math.sin(a); d.y0 = 0.02;
				var tt = 0.04 + i * 0.05;
				d.head.position.set(d.x0 - Math.sin(a) * st.v * tt, d.y0, d.z0 + Math.cos(a) * st.v * tt);
				for (var j = 0; j < d.tail.length; j++) {
					var f = 0.5 + j * 0.18;
					d.tail[j].position.set(
						d.x0 + (d.head.position.x - d.x0) * f, d.y0,
						d.z0 + (d.head.position.z - d.z0) * f
					);
				}
				d.mat.opacity = 0.9;
			}
			lbLayout(box.w, box.h);
			stage.render();
		} else {
			stage.animate(frame);
		}

		return { destroy: function () { /* 收線由 dse-labs.js / three-kit.js 負責 */ } };
	});
})();
