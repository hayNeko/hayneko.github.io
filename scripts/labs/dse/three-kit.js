/**
 * three-kit.js — DSE 物理頁的 3D 共用層
 *
 * 為什麼要一層: 第二章 5 個實驗要用 WebGL, 而「建 renderer / 依 container 尺寸重設 / 看不到就停 /
 * 頁面丟棄要收線 / context 掉了不能把例外丟回實驗」每支各寫一次一定漏一項。尤其 context 預算:
 * 一頁 6 個 stage 若載入時就全建 renderer 會撞上瀏覽器上限, 所以 renderer 一律 lazy
 * (第一次 onVisible(true) 或第一次 render() 才建)。
 * 依賴只有 window.THREE (r149 UMD, 頁面先載入)。顏色由呼叫端給 CSS 字串; 本檔只留必要
 * 內容色(保底灰、地球/月球貼圖的海陸與月面、標籤白字), 不碰主題色。
 */
(function (global) {
	'use strict'; var doc = global.document;
	var NEUTRAL = 0x9aa3ad;                /* 保底灰: 呼叫端沒給顏色時才用, 不是主題色 */
	/* 貼圖內容色(海/陸/冰/月面): 畫的是東西, 不是版面配色, 所以不走 tokens */
	var TEX = { ocean: '#123f66', deep: '#0d3153', land: '#4c7048', dry: '#8d7f58', ice: '#e6edf3',
		moon: '#9b9b98', crater: '#7d7d7a', rim: '#b4b4b0', seed: 20240917 };
	var FALLBACK_CLASS = 'dl-gl-fallback'; var TEXT_NO_THREE = '此頁沒有載入 three.js，3D 實驗無法顯示';
	var TEXT_NO_WEBGL = '此裝置無法建立 WebGL，3D 實驗無法顯示'; var TEXT_LOST = '3D 繪圖中斷（GPU 資源被回收），重新整理即可恢復';
	var webglProbe = null;                 /* null=未測: 探測只做一次 */
	var liveStages = 0;
	var cache = { textures: {}, geometries: {} };
	function T() { return global.THREE; }
	function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
	/* 決定性亂數: 貼圖與星空每次載入都一樣, 否則同一頁重整兩次畫面會漂 */
	function rng(seed) {
		var s = seed >>> 0;
		return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
	}
	function supportsWebGL() {
		if (webglProbe !== null) return webglProbe;
		if (!global.WebGLRenderingContext) { webglProbe = false; return false; }
		var probe = doc.createElement('canvas'), gl = null;
		try { gl = probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl'); }
		catch (err) { gl = null; }
		webglProbe = !!gl;
		if (gl) {   /* 探測用的 context 立刻還掉: 每個都是一份 GPU 預算 */
			var lose = gl.getExtension('WEBGL_lose_context');
			if (lose) { try { lose.loseContext(); } catch (err2) { /* 舊瀏覽器沒有就算了 */ } }
		}
		return webglProbe;
	}
	function ready() { return !!T() && supportsWebGL(); }
	/* 一個函式兩個方向: 給 message 就畫替代文字並藏 canvas, 傳 null 就收回去 */
	function paintFallback(canvas, message) {
		var host = canvas.parentNode; var box = host && host.querySelector('.' + FALLBACK_CLASS);
		if (!message) {
			if (box) box.parentNode.removeChild(box); canvas.style.display = ''; return;
		}
		if (!host) return;
		if (!box) {
			box = doc.createElement('div'); box.className = FALLBACK_CLASS; box.setAttribute('role', 'status');
			host.appendChild(box);
		}
		box.textContent = message; canvas.style.display = 'none';
	}
	/* 一律先過一層: THREE.Color 遇到 'var(--accent)' 這種字串只會安安靜靜地失敗 */
	function colorOf(value) {
		var THREE = T(); if (value == null || value === '') return new THREE.Color(NEUTRAL);
		try { return new THREE.Color(value); } catch (err) { return new THREE.Color(NEUTRAL); }
	}
	function standard(color, opts) {
		opts = opts || {};
		var THREE = T();
		var mat = new THREE.MeshStandardMaterial({
			color: colorOf(color),
			roughness: opts.roughness == null ? 0.55 : opts.roughness,
			metalness: opts.metalness == null ? 0.05 : opts.metalness
		});
		if (opts.emissive) {
			mat.emissive = colorOf(opts.emissive);
			mat.emissiveIntensity = opts.emissiveIntensity == null ? 0.6 : opts.emissiveIntensity;
		}
		if (opts.flat) mat.flatShading = true; if (opts.side) mat.side = opts.side;
		if (opts.opacity != null && opts.opacity < 1) { mat.transparent = true; mat.opacity = opts.opacity; }
		return mat;
	}
	function disposeTree(root) {
		root.traverse(function (obj) {
			if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
			var list = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
			for (var i = 0; i < list.length; i++) {
				var mat = list[i]; if (!mat) continue;
				/* 只丟標籤貼圖(每個 stage 自己生一張): 地球/月球貼圖跨 stage 共用, 這裡丟就變死貼圖 */
				if (mat.isSpriteMaterial && mat.map && mat.map.dispose) mat.map.dispose(); mat.dispose();
			}
		});
	}
	function disposeCache() {
		var key;
		for (key in cache.textures) {
			if (cache.textures[key] && cache.textures[key].dispose) cache.textures[key].dispose(); delete cache.textures[key];
		}
		for (key in cache.geometries) {
			if (cache.geometries[key] && cache.geometries[key].dispose) cache.geometries[key].dispose();
			delete cache.geometries[key];
		}
	}

	function createStage(canvas, ctx, opts) {
		if (!canvas || !ctx) return null; var THREE = T();
		if (!THREE) { paintFallback(canvas, TEXT_NO_THREE); return null; }
		if (!supportsWebGL()) { paintFallback(canvas, TEXT_NO_WEBGL); return null; }
		opts = opts || {};
		var cam = opts.camera || {};
		var aspectNum = 1.6;
		if (opts.aspect) {
			var parts = String(opts.aspect).split('/'); var aw = parseFloat(parts[0]);
			var ah = parts.length > 1 ? parseFloat(parts[1]) : 1; if (aw > 0 && ah > 0) aspectNum = aw / ah;
		}
		var view = {
			yaw: cam.yaw == null ? -0.7 : cam.yaw,
			pitch: cam.pitch == null ? 0.32 : cam.pitch,
			dist: cam.dist == null ? 9 : cam.dist,
			target: new THREE.Vector3().fromArray(cam.target || [0, 1, 0]),
			minPitch: -1.35, maxPitch: 1.35, minDist: 1, maxDist: 60,
			sens: 0.008, invert: false
		};
		var scene = new THREE.Scene(); var camera = new THREE.PerspectiveCamera(opts.fov || 45, aspectNum, 0.05, 420);
		var cap = opts.pixelRatioCap || 2; var background = opts.background || null;
		var renderer = null, frameCb = null, stopLoop = null; var visible = false, lost = false, disposed = false;
		var bound = false, drag = false, dragId = null, lastX = 0, lastY = 0; var cssW = 0, cssH = 0, resizeOff = null;
		var shadowCfg = null;                /* { light, mapSize, radius } */
		var aim = new THREE.Vector3();        /* 每幀重用: frame loop 裡不 new */
		if (background) scene.background = colorOf(background);

		function applyLook() {
			view.pitch = clamp(view.pitch, -1.35, 1.35); view.dist = clamp(view.dist, view.minDist, view.maxDist);
			var cp = Math.cos(view.pitch);
			camera.position.set(
				view.target.x + Math.sin(view.yaw) * cp * view.dist,
				view.target.y + Math.sin(view.pitch) * view.dist,
				view.target.z + Math.cos(view.yaw) * cp * view.dist
			); aim.copy(view.target); camera.lookAt(aim);
		}
		function boxSize() {
			var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
			var w = rect && rect.width ? rect.width : cssW, h = rect && rect.height ? rect.height : cssH;
			if (!w || !h) {   /* 還沒進版面(或離屏測試): 先信 canvas 自己的屬性 */
				w = canvas.width || 320; h = canvas.height || 200;
			}
			return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
		}
		function resize() {
			if (!renderer || lost) return; var box = boxSize(); cssW = box.w; cssH = box.h;
			/* CSS 尺寸交給 stylesheet(.dl-lab--3d canvas 有 aspect-ratio), 這裡只管 drawing buffer */
			renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, cap)); renderer.setSize(box.w, box.h, false);
			camera.aspect = box.w / box.h; camera.updateProjectionMatrix();
		}
		function markShadows(root) {
			if (!shadowCfg) return;
			root.traverse(function (obj) {
				if (obj.isMesh && !obj.userData.noShadow) obj.castShadow = true;
			});
		}
		function enableShadow() {
			if (!shadowCfg || !renderer) return; renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = THREE.PCFSoftShadowMap; var light = shadowCfg.light; light.castShadow = true;
			light.shadow.mapSize.set(shadowCfg.mapSize, shadowCfg.mapSize); light.shadow.radius = shadowCfg.radius;
			light.shadow.bias = -0.0012; markShadows(scene);
		}
		function initRenderer() {
			if (renderer || lost || disposed) return renderer;
			try {
				renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
			} catch (err) {
				paintFallback(canvas, TEXT_NO_WEBGL); return null;
			}
			if (THREE.sRGBEncoding && 'outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding; applyLook();
			resize(); if (shadowCfg) enableShadow(); markShadows(scene); return renderer;
		}
		function stopLoopNow() { if (stopLoop) { stopLoop(); stopLoop = null; } }
		function render() {
			if (disposed || lost) return; if (!renderer) initRenderer(); if (!renderer) return;
			try { renderer.render(scene, camera); }
			catch (err) {   /* context 掉掉時 WebGL 會丟例外, 不能讓它竄回實驗的迴圈 */
				lost = true; stopLoopNow(); paintFallback(canvas, TEXT_LOST);
			}
		}
		function tick(dt, elapsed) {
			if (disposed || lost) return;
			if (frameCb) { try { frameCb(dt, elapsed); } catch (err) { frameCb = null; } }
			render();
		}
		function startLoop() {
			if (stopLoop || disposed || lost) return; if (!renderer) initRenderer(); if (!renderer || !ctx.raf) return;
			stopLoop = ctx.raf(tick);
		}
		function setVisible(next) {
			visible = !!next;
			if (!visible) { stopLoopNow(); return; }
			if (!renderer) initRenderer(); if (frameCb) startLoop();
			else render();   /* 沒有動畫的靜態場景: 進畫面時畫一次就夠 */
		}
		function onDown(e) {
			if (e.pointerType === 'mouse' && e.button != null && e.button !== 0) return; drag = true; dragId = e.pointerId;
			lastX = e.clientX; lastY = e.clientY;
			if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 捕捉失敗仍可拖 */ } }
			canvas.style.cursor = 'grabbing'; if (e.preventDefault) e.preventDefault();
		}
		function onMove(e) {
			if (!drag || e.pointerId !== dragId) return; var dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX;
			lastY = e.clientY; var s = view.sens * (view.invert ? -1 : 1); view.yaw -= dx * s;
			view.pitch = clamp(view.pitch + dy * s, view.minPitch, view.maxPitch); applyLook();
			render();   /* 拖動要立刻反映: 實驗可能沒有自己的動畫迴圈 */
		}
		function onUp(e) {
			if (e.pointerId !== dragId) return; drag = false; dragId = null; canvas.style.cursor = 'grab';
			if (canvas.releasePointerCapture) { try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 已經放手 */ } }
		}
		function unbind() {
			if (!bound) return; bound = false; canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp);
			canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('lostpointercapture', onUp);
			canvas.style.cursor = '';
		}
		function onContextLost(e) {
			if (e && e.preventDefault) e.preventDefault();   /* 不 preventDefault, 瀏覽器根本不會嘗試還原 */
			lost = true; stopLoopNow();
			paintFallback(canvas, TEXT_LOST);                /* 畫面已沒了, 留著 canvas 只會是一片黑 */
		}
		function onContextRestored() {
			lost = false;
			if (renderer) { try { renderer.dispose(); } catch (err) { /* 已經失效 */ } }
			renderer = null;   /* 舊 renderer 的 GL 物件全部作廢, 重新建立一個 */
			paintFallback(canvas, null); if (!initRenderer()) return; if (frameCb && visible) startLoop(); else render();
		}
		function dispose() {
			if (disposed) return; disposed = true; stopLoopNow(); unbind();
			if (resizeOff) { resizeOff(); resizeOff = null; }
			canvas.removeEventListener('webglcontextlost', onContextLost);
			canvas.removeEventListener('webglcontextrestored', onContextRestored); disposeTree(scene);
			if (renderer) {
				try { renderer.dispose(); } catch (err) { /* 已丟失 */ }
				/* 明確還掉 context: 不還就要等 GC, 同頁連開幾個實驗就撞上限 */
				if (renderer.forceContextLoss) { try { renderer.forceContextLoss(); } catch (err2) { /* 同上 */ } }
				renderer = null;
			}
			liveStages = Math.max(0, liveStages - 1); if (!liveStages) disposeCache();
		}

		var api = {
			scene: scene,
			camera: camera,
			get renderer() { return renderer; },
			look: function (next) {
				next = next || {};
				if (next.yaw != null) view.yaw = next.yaw; if (next.pitch != null) view.pitch = next.pitch;
				if (next.dist != null) view.dist = next.dist; if (next.target) view.target.fromArray(next.target); applyLook();
				return api;
			},
			orbit: function (o) {
				o = o || {};
				if (o.drag === false) { unbind(); return api; }
				if (o.minPitch != null) view.minPitch = clamp(o.minPitch, -1.35, 1.35);
				if (o.maxPitch != null) view.maxPitch = clamp(o.maxPitch, -1.35, 1.35);
				if (o.minDist != null) view.minDist = Math.max(0.1, o.minDist);
				if (o.maxDist != null) view.maxDist = Math.max(view.minDist, o.maxDist);
				if (o.sensitivity != null) view.sens = 0.008 * o.sensitivity; view.invert = !!o.invert; if (bound) return api;
				bound = true; canvas.style.cursor = 'grab';
				canvas.style.touchAction = 'none';   /* 保險: stylesheet 沒載入也不會拖著頁面滾 */
				canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
				canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
				canvas.addEventListener('lostpointercapture', onUp); return api;
			},
			render: function () { render(); return api; },
			animate: function (fn) {
				frameCb = typeof fn === 'function' ? fn : null;
				if (!frameCb) { stopLoopNow(); return api; }
				if (!renderer) initRenderer(); if (visible) startLoop(); return api;
			},
			add: function (obj) { if (obj) { scene.add(obj); markShadows(obj); } return api; },
			remove: function (obj) { if (obj) scene.remove(obj); return api; },
			shadows: function (o) {
				o = o || {};
				if (shadowCfg) return api;   /* 只加一盞: 這裡不是通用光照 API */
				var dir = o.dir || [6, 10, 4];
				var light = new THREE.DirectionalLight(0xffffff, 1.15);   /* 白光, 顏色交給材質 */
				light.position.set(dir[0], dir[1], dir[2]); light.target.position.copy(view.target); scene.add(light);
				scene.add(light.target);
				shadowCfg = { light: light, mapSize: o.mapSize || 1024, radius: o.radius == null ? 3 : o.radius };
				enableShadow(); return api;
			},
			setBackground: function (color) {
				background = color || null; scene.background = background ? colorOf(background) : null; return api;
			},
			sleep: function () { stopLoopNow(); return api; },
			wake: function () {
				if (disposed || lost) return api; if (!renderer) initRenderer(); if (frameCb) startLoop(); else render(); return api;
			},
			fail: function (message) {
				stopLoopNow(); frameCb = null; paintFallback(canvas, message || TEXT_NO_WEBGL); return api;
			},
			dispose: dispose
		};

		canvas.addEventListener('webglcontextlost', onContextLost, false);
		canvas.addEventListener('webglcontextrestored', onContextRestored, false);
		if (ctx.onResize) resizeOff = ctx.onResize(resize); if (ctx.onDestroy) ctx.onDestroy(dispose);
		else global.addEventListener('pagehide', dispose); applyLook(); liveStages += 1;
		if (ctx.onVisible) ctx.onVisible(setVisible);   /* 第一次 true 才會建立 renderer */
		return api;
	}
	function sphere(r, color, opts) {
		opts = opts || {};
		var THREE = T(); var seg = opts.segments || Math.round(clamp(r * 16, 24, 48));
		var mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(16, Math.round(seg * 0.6))), standard(color, opts));
		mesh.castShadow = true; return mesh;
	}
	function ring(rInner, rOuter, color, opts) {
		opts = opts || {};
		var THREE = T();
		var mat = new THREE.MeshBasicMaterial({
			color: colorOf(color),
			side: THREE.DoubleSide,
			transparent: opts.opacity != null && opts.opacity < 1,
			opacity: opts.opacity == null ? 1 : opts.opacity
		});
		var mesh = new THREE.Mesh(new THREE.RingGeometry(rInner, rOuter, opts.segments || 72), mat);
		/* axis 指環面的法線: 'z' 是預設(RingGeometry 本來就躺在 XY 平面) */
		if (opts.axis === 'y') mesh.rotation.x = -Math.PI / 2; else if (opts.axis === 'x') mesh.rotation.y = Math.PI / 2;
		return mesh;
	}
	function box(w, h, d, color, opts) {
		var THREE = T(); var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), standard(color, opts));
		mesh.castShadow = true; return mesh;
	}
	function cylinder(rTop, rBot, h, color, opts) {
		opts = opts || {};
		var THREE = T(); var geo = new THREE.CylinderGeometry(rTop, rBot, h, opts.segments || 24, 1, !!opts.open);
		var mesh = new THREE.Mesh(geo, standard(color, opts)); mesh.castShadow = true; return mesh;
	}
	function arrow3(from, to, color, opts) {
		opts = opts || {};
		var THREE = T(); var a = new THREE.Vector3().fromArray(from), b = new THREE.Vector3().fromArray(to);
		var dir = new THREE.Vector3().subVectors(b, a); var len = dir.length(); var group = new THREE.Group();
		if (!(len > 0.0001)) return group;
		var shaftRadius = opts.width || 0.035;                 /* head 半徑 2.4x, 頭長 0.18L */
		var headLen = Math.min(len * 0.18, len * 0.6); var unit = dir.clone().normalize();
		var mat = standard(color, { emissive: opts.emissive, roughness: 0.42, opacity: opts.opacity, metalness: 0.02 });
		var shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, len - headLen, 12), mat);
		shaft.position.copy(a).addScaledVector(unit, (len - headLen) / 2);
		shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit);
		var head = new THREE.Mesh(new THREE.ConeGeometry(shaftRadius * 2.4, headLen, 16), mat);
		head.position.copy(a).addScaledVector(unit, len - headLen / 2); head.quaternion.copy(shaft.quaternion);
		group.add(shaft); group.add(head);
		group.traverse(function (obj) { if (obj.isMesh) obj.castShadow = true; });
		return group;
	}
	function label(text, color, opts) {
		opts = opts || {};
		var THREE = T(); var size = opts.size == null ? 0.34 : opts.size; var pad = opts.pad == null ? 6 : opts.pad;
		var px = 30;                                          /* 基準字級: 貼圖 2x 才不糊 */
		var scale = 2; var pattern = opts.font || '600 __px JetBrains Mono, monospace';
		var bg = opts.bg === undefined ? 'rgba(11,18,32,.55)' : opts.bg;
		var measure = doc.createElement('canvas').getContext('2d'); measure.font = pattern.replace('__', px);
		var w = Math.ceil(measure.measureText(text).width) + pad * 2; var h = Math.ceil(px * 1.45) + pad * 2;
		var canvas = doc.createElement('canvas'); canvas.width = Math.max(2, w * scale);
		canvas.height = Math.max(2, h * scale); var g = canvas.getContext('2d'); g.scale(scale, scale);
		if (bg) {
			g.fillStyle = bg; g.beginPath(); if (g.roundRect) g.roundRect(0.5, 0.5, w - 1, h - 1, 3);
			else g.rect(0.5, 0.5, w - 1, h - 1); g.fill();
		}
		g.font = pattern.replace('__', px); g.textAlign = 'center'; g.textBaseline = 'middle';
		g.fillStyle = color || 'rgba(255,255,255,.94)'; g.fillText(text, w / 2, h / 2 + 0.5);
		var tex = new THREE.CanvasTexture(canvas); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
		var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
		var k = size / h;                                     /* size = 標籤的行高(世界單位) */
		sprite.scale.set(w * k, h * k, 1); return sprite;
	}
	function ground(size, color, opts) {
		opts = opts || {};
		var THREE = T(); var group = new THREE.Group();
		var plane = new THREE.Mesh(
			new THREE.PlaneGeometry(size, size),
			new THREE.MeshStandardMaterial({ color: colorOf(color), roughness: 0.94, metalness: 0, side: THREE.DoubleSide })
		); plane.rotation.x = -Math.PI / 2; plane.receiveShadow = true;
		plane.userData.noShadow = true;                       /* 地面不投影, 只接影 */
		group.add(plane);
		if (opts.grid) {
			var grid = new THREE.GridHelper(size, Math.max(4, Math.round(size / 2)), colorOf(color), colorOf(color));
			grid.material.transparent = true; grid.material.opacity = 0.16; grid.position.y = 0.002; group.add(grid);
		}
		return group;
	}
	function sky(top, bottom) {
		var THREE = T();
		var mat = new THREE.ShaderMaterial({
			uniforms: { topColor: { value: colorOf(top) }, bottomColor: { value: colorOf(bottom) } },
			vertexShader: 'varying float vH; void main() { vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
			fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; varying float vH;' +
				'void main() { float t = smoothstep(-0.35, 0.9, vH); gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0); }',
			side: THREE.BackSide,
			depthWrite: false
		});
		var mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat); mesh.frustumCulled = false; return mesh;
	}
	function stars(count) {
		var THREE = T(); var n = Math.max(1, count || 600); var rand = rng(TEX.seed + n);
		var positions = new Float32Array(n * 3);
		for (var i = 0; i < n; i++) {
			var radius = 60 + rand() * 30, theta = rand() * Math.PI * 2, y = rand() * 2 - 1;
			var r = Math.sqrt(Math.max(0, 1 - y * y)); positions[i * 3] = Math.cos(theta) * r * radius;
			positions[i * 3 + 1] = y * radius; positions[i * 3 + 2] = Math.sin(theta) * r * radius;
		}
		var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		return new THREE.Points(geo, new THREE.PointsMaterial({
			color: 0xffffff, size: 0.42, sizeAttenuation: true,
			transparent: true, opacity: 0.9, depthWrite: false
		}));
	}
	/* 大陸塊: 由中心往外長出鋸齒邊緣, 同一顆種子所以每次一樣 */
	function blob(g, cx, cy, r, rand, steps) {
		g.beginPath();
		for (var i = 0; i <= steps; i++) {
			var ang = (i / steps) * Math.PI * 2; var rad = r * (0.62 + rand() * 0.5);
			var x = cx + Math.cos(ang) * rad * 1.35, y = cy + Math.sin(ang) * rad; if (i === 0) g.moveTo(x, y);
			else g.lineTo(x, y);
		}
		g.closePath(); g.fill();
	}
	function earthTexture() {
		if (cache.textures.earth) return cache.textures.earth; var THREE = T(); var canvas = doc.createElement('canvas');
		canvas.width = 1024; canvas.height = 512; var g = canvas.getContext('2d'); g.fillStyle = TEX.ocean;
		g.fillRect(0, 0, 1024, 512); g.fillStyle = TEX.deep; g.fillRect(0, 0, 1024, 20); g.fillRect(0, 492, 1024, 20);
		var rand = rng(TEX.seed);
		/* 九塊大陸: 固定中心, 邊緣用亂數長, 所以海洋與陸地的位置每次都一樣 */
		var land = [[190, 176, 132], [300, 246, 74], [430, 150, 104], [520, 300, 92],
			[636, 372, 58], [700, 196, 128], [812, 306, 70], [884, 128, 52], [120, 330, 56]];
		var i; g.fillStyle = TEX.land;
		for (i = 0; i < land.length; i++) blob(g, land[i][0], land[i][1], land[i][2], rand, 14); g.fillStyle = TEX.dry;
		for (i = 0; i < land.length; i++) blob(g, land[i][0] + 12, land[i][1] - 8, land[i][2] * 0.46, rand, 12);
		g.fillStyle = TEX.ice;                                          /* 南北極冠 */
		g.fillRect(0, 0, 1024, 30); g.fillRect(0, 482, 1024, 30); var tex = new THREE.CanvasTexture(canvas);
		tex.wrapS = THREE.RepeatWrapping; cache.textures.earth = tex; return tex;
	}
	function moonTexture() {
		if (cache.textures.moon) return cache.textures.moon; var THREE = T(); var canvas = doc.createElement('canvas');
		canvas.width = 1024; canvas.height = 512; var g = canvas.getContext('2d'); g.fillStyle = TEX.moon;
		g.fillRect(0, 0, 1024, 512); var rand = rng(TEX.seed + 7); var i;
		g.globalAlpha = 0.5;                                            /* 月海: 大而淡的暗斑 */
		g.fillStyle = TEX.crater;
		for (i = 0; i < 44; i++) {
			var mx = rand() * 1024, my = 80 + rand() * 352, mr = 26 + rand() * 58; g.beginPath();
			g.ellipse(mx, my, mr * 1.2, mr, 0, 0, Math.PI * 2); g.fill();
		}
		g.globalAlpha = 1;
		for (i = 0; i < 90; i++) {                                      /* 環形山: 暗坑 + 亮邊 */
			var cx = rand() * 1024, cy = rand() * 512, cr = 3 + rand() * 13; g.fillStyle = TEX.crater; g.beginPath();
			g.ellipse(cx, cy, cr, cr * 0.86, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = TEX.rim; g.lineWidth = 1.2;
			g.beginPath(); g.ellipse(cx - 0.6, cy - 0.6, cr, cr * 0.86, 0, Math.PI * 0.15, Math.PI * 1.1); g.stroke();
		}
		var tex = new THREE.CanvasTexture(canvas); tex.wrapS = THREE.RepeatWrapping; cache.textures.moon = tex; return tex;
	}

	global.DSEThree = {
		ready: ready, createStage: createStage, sphere: sphere, ring: ring, box: box, cylinder: cylinder,
		arrow3: arrow3, label: label, ground: ground, sky: sky, stars: stars,
		earthTexture: earthTexture, moonTexture: moonTexture, disposeCache: disposeCache
	};
})(window);
