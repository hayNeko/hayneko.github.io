/**
 * views/horizon/world.js — the NAGISA coast, procedurally built.
 *
 * One 3.0 km square of Japanese coastline: a harbour town, an 11 km asphalt
 * network (coastal loop, mountain touge, southern loop, northern ridge and
 * harbour streets), a festival ground with stunt ramps, a shrine, sea and sky.
 * No external meshes or textures.
 */
(function (global) {
	'use strict';

	var THREE = global.THREE;
	var HZ = global.HZ;

	var WORLD = {
		size: 3000,
		half: 1500,
		seaLevel: 0,
		festival: { x: 430, z: 650, radius: 82 },
		shrine: { x: -1070, z: 120, radius: 48 },
		town: { minX: 455, maxX: 735, minZ: -240, maxZ: 280 }
	};

	var defs = [
		{
			id: 'coast', name: 'NAGISA COAST', closed: true, width: 9.6,
			points: [
				[260, 500], [430, 560], [590, 520], [690, 400], [730, 260], [725, 120],
				[670, -10], [590, -140], [470, -260], [320, -360], [130, -430], [-80, -440],
				[-260, -390], [-380, -290], [-430, -150], [-410, 10], [-340, 160], [-220, 300],
				[-60, 400], [120, 470]
			]
		},
		{
			id: 'pass', name: 'KIRI TOUGE', closed: false, width: 8.2,
			points: [
				[-438, -148], [-560, -140], [-690, -190], [-780, -300], [-730, -420],
				[-610, -450], [-530, -550], [-620, -650], [-790, -630], [-890, -510],
				[-920, -370], [-870, -230], [-940, -110], [-1060, -30], [-1070, 120]
			]
		},
		{
			id: 'spur', name: 'FESTIVAL DRIVE', closed: false, width: 6.6,
			points: [[430, 560], [452, 596], [442, 632], [414, 660], [382, 690]]
		},
		{
			id: 'south', name: 'MINAMI LOOP', closed: false, width: 8.8,
			points: [
				[590, 520], [520, 700], [380, 880], [300, 1120], [430, 1320],
				[690, 1370], [860, 1210], [880, 980], [760, 800], [600, 680], [430, 560]
			]
		},
		{
			id: 'north', name: 'KITA RIDGE', closed: false, width: 8.4,
			points: [
				[725, 120], [790, -80], [740, -330], [600, -560], [380, -760],
				[120, -880], [-160, -920], [-380, -820], [-500, -640], [-480, -440],
				[-380, -330], [-260, -390]
			]
		},
		{
			id: 'townloop', name: 'HARBOUR STREETS', closed: false, width: 7.4,
			points: [
				[690, 400], [620, 340], [650, 250], [560, 190], [520, 90],
				[590, 10], [680, 40], [725, 120]
			]
		}
	];

	/* ------------------------------------------------------------ coast & terrain */
	function shoreX(z) {
		return Math.max(760, 838 + Math.sin(z * 0.0022) * 120 + Math.sin(z * 0.0009 + 1.7) * 55);
	}
	WORLD.shoreX = shoreX;

	function baseHeight(x, z) {
		var land = 1 - HZ.sstep(shoreX(z) - 150, shoreX(z) + 70, x);
		var hills = 9 + 26 * HZ.fbm(x * 0.0019 + 11.3, z * 0.0019 - 4.7, 4, 2, 0.5) +
			9 * HZ.fbm(x * 0.006 - 3, z * 0.006 + 9, 2, 2, 0.5);
		var west = 1 - HZ.sstep(-1080, -230, x);
		var ridge = HZ.fbm(x * 0.0022 + 40, z * 0.0022 - 12, 4, 2, 0.5);
		var mountain = west * (72 + 126 * ridge + 28 * HZ.fbm(x * 0.009 + 2, z * 0.009 + 5, 2, 2, 0.5));
		var h = hills * land + mountain * land + (1 - land) * (-26);
		h += 2.4 * HZ.fbm(x * 0.024, z * 0.024, 2, 2, 0.5);
		return h;
	}
	WORLD.baseHeight = baseHeight;

	var festivalY = baseHeight(WORLD.festival.x, WORLD.festival.z) + 1.1;
	var shrineY = baseHeight(WORLD.shrine.x, WORLD.shrine.z) + 0.8;
	WORLD.festival.y = festivalY;
	WORLD.shrine.y = shrineY;

	function rawHeight(x, z) {
		var h = baseHeight(x, z);
		var f = WORLD.festival;
		var df = Math.hypot(x - f.x, z - f.z);
		var padF = 1 - HZ.sstep(f.radius * 0.5, f.radius * 1.05, df);
		h = HZ.lerp(h, festivalY, padF);
		var s = WORLD.shrine;
		var ds = Math.hypot(x - s.x, z - s.z);
		var padS = 1 - HZ.sstep(s.radius * 0.45, s.radius, ds);
		h = HZ.lerp(h, shrineY, padS);
		return h;
	}

	function slopeAt(x, z) {
		var d = 5;
		var hx = rawHeight(x + d, z) - rawHeight(x - d, z);
		var hz = rawHeight(x, z + d) - rawHeight(x, z - d);
		return Math.hypot(hx, hz) / (2 * d);
	}

	/* ------------------------------------------------------------ roads */
	function smoothHeights(samples, closed, radius, passes) {
		var n = samples.length;
		for (var p = 0; p < passes; p++) {
			var copy = new Float32Array(n);
			for (var i = 0; i < n; i++) copy[i] = samples[i].y;
			for (var j = 0; j < n; j++) {
				var sum = 0, count = 0;
				for (var k = -radius; k <= radius; k++) {
					var idx = closed ? (j + k + n) % n : j + k;
					if (idx < 0 || idx >= n) continue;
					sum += copy[idx]; count++;
				}
				samples[j].y = sum / count;
			}
		}
	}

	function sampleRoad(def, junctionY) {
		var pts = def.points.map(function (p) { return new THREE.Vector3(p[0], 0, p[1]); });
		var curve = new THREE.CatmullRomCurve3(pts, def.closed, 'catmullrom', 0.5);
		var length = curve.getLength();
		var step = 4.2;
		var count = Math.max(24, Math.round(length / step));
		step = length / (def.closed ? count : (count - 1));
		var samples = [];
		for (var i = 0; i < count; i++) {
			var t = def.closed ? i / count : i / (count - 1);
			var p = curve.getPointAt(t);
			samples.push({ x: p.x, z: p.z, y: rawHeight(p.x, p.z) });
		}
		/* hills are noisy — roads must not be */
		smoothHeights(samples, def.closed, def.closed ? 7 : 8, def.id === 'pass' ? 5 : 3);
		/* enforce a sane maximum grade */
		var maxGrade = def.id === 'pass' ? 0.17 : 0.12;
		for (var pass = 0; pass < 2; pass++) {
			for (var j = 1; j < samples.length; j++) {
				var maxDy = step * maxGrade;
				var dy = samples[j].y - samples[j - 1].y;
				if (dy > maxDy) samples[j].y = samples[j - 1].y + maxDy;
				else if (dy < -maxDy) samples[j].y = samples[j - 1].y - maxDy;
			}
			if (def.closed) {
				var first = samples[0], last = samples[samples.length - 1];
				var wrapDy = first.y - last.y;
				var wmax = step * maxGrade;
				if (wrapDy > wmax) first.y = last.y + wmax;
				else if (wrapDy < -wmax) first.y = last.y - wmax;
			}
			smoothHeights(samples, def.closed, 3, 1);
		}
		if (junctionY != null) {
			var blend = Math.min(18, samples.length - 1);
			var delta = junctionY - samples[0].y;
			for (var b = 0; b < blend; b++) {
				var w = 1 - b / blend;
				samples[b].y += delta * w;
			}
		}
		/* never pave below the tideline */
		for (var m = 0; m < samples.length; m++) {
			if (samples[m].y < 2.2) samples[m].y = 2.2;
		}
		/* tangents, right vectors and surface normals */
		for (var k = 0; k < samples.length; k++) {
			var prev = samples[def.closed ? (k - 1 + samples.length) % samples.length : Math.max(0, k - 1)];
			var next = samples[def.closed ? (k + 1) % samples.length : Math.min(samples.length - 1, k + 1)];
			var dx = next.x - prev.x, dy = next.y - prev.y, dz = next.z - prev.z;
			var hl = Math.hypot(dx, dz) || 1;
			var tx = dx / hl, tz = dz / hl;
			var ty = dy / hl;
			var rx = tz, rz = -tx;
			var nx = -ty * tx, ny = 1, nz = -ty * tz;
			var nl = Math.hypot(nx, ny, nz) || 1;
			samples[k].tx = tx; samples[k].tz = tz; samples[k].ty = ty;
			samples[k].rx = rx; samples[k].rz = rz;
			samples[k].nx = nx / nl; samples[k].ny = ny / nl; samples[k].nz = nz / nl;
			samples[k].dist = k * step;
		}
		return {
			id: def.id, name: def.name, closed: def.closed, width: def.width,
			half: def.width / 2, samples: samples, length: length, step: step,
			curve: curve
		};
	}

	function recomputeTangents(road) {
		var samples = road.samples;
		var n = samples.length;
		for (var k = 0; k < n; k++) {
			var prev = samples[road.closed ? (k - 1 + n) % n : Math.max(0, k - 1)];
			var next = samples[road.closed ? (k + 1) % n : Math.min(n - 1, k + 1)];
			var dx = next.x - prev.x, dy = next.y - prev.y, dz = next.z - prev.z;
			var hl = Math.hypot(dx, dz) || 1;
			var tx = dx / hl, tz = dz / hl;
			var ty = dy / hl;
			var rx = tz, rz = -tx;
			var nx = -ty * tx, ny = 1, nz = -ty * tz;
			var nl = Math.hypot(nx, ny, nz) || 1;
			samples[k].tx = tx; samples[k].tz = tz; samples[k].ty = ty;
			samples[k].rx = rx; samples[k].rz = rz;
			samples[k].nx = nx / nl; samples[k].ny = ny / nl; samples[k].nz = nz / nl;
			samples[k].dist = k * road.step;
		}
	}

	function connectRoadEnd(road, atStart, existing) {
		var n = road.samples.length;
		var end = road.samples[atStart ? 0 : n - 1];
		var best = null, bestD = Infinity;
		Object.keys(existing).forEach(function (key) {
			var s = nearestSample(existing[key], end.x, end.z);
			if (s.dist < bestD) { bestD = s.dist; best = s; }
		});
		if (!best) return;
		var blend = Math.min(14, n - 1);
		for (var i = 0; i < blend; i++) {
			var idx = atStart ? i : n - 1 - i;
			var w = 1 - i / blend;
			road.samples[idx].x += (best.x - end.x) * w;
			road.samples[idx].z += (best.z - end.z) * w;
			road.samples[idx].y += (best.y - end.y) * w;
		}
		var last = road.samples[atStart ? 0 : n - 1];
		last.x = best.x; last.z = best.z; last.y = best.y;
	}

	function buildRoads() {
		var roads = {};
		var coast = sampleRoad(defs[0], null);
		roads.coast = coast;
		/* every other road is welded to whatever already exists, so loops read
		   as one continuous network instead of floating asphalt islands */
		for (var i = 1; i < defs.length; i++) {
			var def = defs[i];
			var road = sampleRoad(def, null);
			connectRoadEnd(road, true, roads);
			if (def.id !== 'pass' && def.id !== 'spur') connectRoadEnd(road, false, roads);
			recomputeTangents(road);
			roads[def.id] = road;
		}
		return roads;
	}

	function nearestSample(road, x, z) {
		var best = 0, bestD = Infinity;
		for (var i = 0; i < road.samples.length; i++) {
			var s = road.samples[i];
			var d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
			if (d < bestD) { bestD = d; best = i; }
		}
		var s2 = road.samples[best];
		return { index: best, y: s2.y, x: s2.x, z: s2.z, dist: Math.sqrt(bestD) };
	}

	/* spatial hash over every road sample */
	function buildIndex(roads) {
		var CELL = 32;
		var map = new Map();
		var all = [];
		Object.keys(roads).forEach(function (key) {
			var road = roads[key];
			for (var i = 0; i < road.samples.length; i++) {
				var s = road.samples[i];
				s.road = road;
				all.push(s);
				var cx = Math.floor(s.x / CELL), cz = Math.floor(s.z / CELL);
				var k = cx + ',' + cz;
				var arr = map.get(k);
				if (!arr) { arr = []; map.set(k, arr); }
				arr.push(s);
			}
		});
		function nearby(x, z, radius) {
			var cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
			var out = [];
			for (var ix = cx - radius; ix <= cx + radius; ix++) {
				for (var iz = cz - radius; iz <= cz + radius; iz++) {
					var arr = map.get(ix + ',' + iz);
					if (arr) for (var i = 0; i < arr.length; i++) out.push(arr[i]);
				}
			}
			return out;
		}
		return { cell: CELL, map: map, all: all, nearby: nearby };
	}

	function closestOnSegment(px, pz, ax, az, bx, bz) {
		var dx = bx - ax, dz = bz - az;
		var len2 = dx * dx + dz * dz || 1;
		var t = HZ.clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
		var x = ax + dx * t, z = az + dz * t;
		return { t: t, x: x, z: z, d: Math.hypot(px - x, pz - z) };
	}

	function makeRoadQuery(index) {
		function coarse(x, z) {
			var cand = index.nearby(x, z, 2);
			var best = null, bestD = Infinity;
			for (var i = 0; i < cand.length; i++) {
				var s = cand[i];
				var d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
				if (d < bestD) { bestD = d; best = s; }
			}
			return best ? { sample: best, dist: Math.sqrt(bestD) } : null;
		}
		function query(x, z) {
			var cand = index.nearby(x, z, 2);
			var best = null, bestD = Infinity;
			for (var i = 0; i < cand.length; i++) {
				var s = cand[i];
				var road = s.road;
				var n = road.samples.length;
				var idx = s.index != null ? s.index : road.samples.indexOf(s);
				if (idx < 0) continue;
				var prevIdx = road.closed ? (idx - 1 + n) % n : Math.max(0, idx - 1);
				var nextIdx = road.closed ? (idx + 1) % n : Math.min(n - 1, idx + 1);
				var prev = road.samples[prevIdx], next = road.samples[nextIdx];
				var seg = closestOnSegment(x, z, s.x, s.z, next.x, next.z);
				if (seg.d < bestD) {
					var y = HZ.lerp(s.y, next.y, seg.t);
					bestD = seg.d;
					best = { road: road, sample: s, index: idx, y: y, dist: seg.d, t: seg.t, half: road.half };
				}
				var seg2 = closestOnSegment(x, z, prev.x, prev.z, s.x, s.z);
				if (seg2.d < bestD) {
					var y2 = HZ.lerp(prev.y, s.y, seg2.t);
					bestD = seg2.d;
					best = { road: road, sample: s, index: idx, y: y2, dist: seg2.d, t: seg2.t, half: road.half };
				}
			}
			return best;
		}
		return { coarse: coarse, query: query };
	}

	/* ------------------------------------------------------------ height field */
	function buildHeightField(query) {
		var N = 576;
		var size = WORLD.size;
		var data = new Float32Array(N * N);
		for (var iz = 0; iz < N; iz++) {
			var z = -WORLD.half + (iz / (N - 1)) * size;
			for (var ix = 0; ix < N; ix++) {
				var x = -WORLD.half + (ix / (N - 1)) * size;
				var h = rawHeight(x, z);
				var near = query.coarse(x, z);
				if (near && near.sample) {
					var s = near.sample;
					var d = near.dist;
					var flat = 1 - HZ.sstep(s.road.half + 4.0, s.road.half + 40, d);
					if (flat > 0) h = HZ.lerp(h, s.y - 0.52, flat);
				}
				data[iz * N + ix] = h;
			}
		}
		function sample(x, z) {
			var fx = (x + WORLD.half) / size * (N - 1);
			var fz = (z + WORLD.half) / size * (N - 1);
			fx = HZ.clamp(fx, 0, N - 1.001);
			fz = HZ.clamp(fz, 0, N - 1.001);
			var x0 = Math.floor(fx), z0 = Math.floor(fz);
			var tx = fx - x0, tz = fz - z0;
			var i00 = z0 * N + x0, i10 = i00 + 1, i01 = i00 + N, i11 = i01 + 1;
			return HZ.lerp(
				HZ.lerp(data[i00], data[i10], tx),
				HZ.lerp(data[i01], data[i11], tx), tz);
		}
		return { N: N, data: data, sample: sample };
	}

	/* ------------------------------------------------------------ sky, sea, light */
	function makeSky(scene, quality) {
		var sunDir = new THREE.Vector3(0.72, 0.17, 0.42).normalize();
		var uniforms = {
			uSun: { value: sunDir },
			uTime: { value: 0 },
			uHorizon: { value: new THREE.Color('#f4a06b') },
			uZenith: { value: new THREE.Color('#3c6f9e') },
			uSunColor: { value: new THREE.Color('#ffd9a3') }
		};
		var sky = new THREE.Mesh(
			new THREE.SphereGeometry(7600, 48, 24),
			new THREE.ShaderMaterial({
				side: THREE.BackSide, depthWrite: false, fog: false,
				uniforms: uniforms,
				vertexShader: [
					'varying vec3 vDir;',
					'void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
				].join('\n'),
				fragmentShader: [
					'varying vec3 vDir;',
					'uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSunColor; uniform float uTime;',
					'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
					'float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);',
					'  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }',
					'float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=noise(p)*a; p*=2.03; a*=0.5; } return s; }',
					'void main(){',
					'  vec3 d = normalize(vDir);',
					'  float h = clamp(d.y, -0.08, 1.0);',
					'  float grad = pow(smoothstep(-0.02, 0.62, h), 0.62);',
					'  vec3 col = mix(uHorizon, uZenith, grad);',
					'  float sd = max(dot(d, uSun), 0.0);',
					'  col += uSunColor * pow(sd, 8.0) * 0.30;',
					'  col += uSunColor * smoothstep(0.9984, 0.9998, sd) * 1.55;',
					'  col += uSunColor * pow(max(sd, 0.0), 180.0) * 0.45;',
					'  col += vec3(1.0,0.64,0.38) * pow(sd, 2.0) * 0.13;',
					'  vec2 cuv = d.xz / max(d.y + 0.16, 0.11);',
					'  float cl = fbm(cuv * 0.55 + vec2(uTime * 0.004, 0.0));',
					'  cl = smoothstep(0.50, 0.84, cl) * smoothstep(-0.02, 0.2, d.y) * 0.52;',
					'  col = mix(col, vec3(1.0,0.78,0.58), cl);',
					'  float haze = 1.0 - smoothstep(-0.06, 0.16, d.y);',
					'  col = mix(col, vec3(0.93,0.68,0.52), haze * 0.5);',
					'  gl_FragColor = vec4(col, 1.0);',
					'}'
				].join('\n')
			})
		);
		sky.frustumCulled = false;
		sky.renderOrder = -10;
		scene.add(sky);
		var sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
			map: HZ.textures.glow(), color: 0xffcf9a, transparent: true, opacity: 0.62,
			depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
		}));
		sunGlow.position.copy(sunDir).multiplyScalar(5600);
		sunGlow.scale.set(1500, 1500, 1);
		sunGlow.frustumCulled = false;
		scene.add(sunGlow);

		/* ocean */
		var oceanNormal = HZ.textures.waterNormal();
		var ocean = new THREE.Mesh(
			new THREE.PlaneGeometry(16000, 16000, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0x1c5368, roughness: 0.17, metalness: 0.32,
				normalMap: oceanNormal, normalScale: new THREE.Vector2(0.55, 0.55),
				envMapIntensity: 1.1, emissive: 0x04141b, emissiveIntensity: 0.55
			})
		);
		ocean.rotation.x = -Math.PI / 2;
		ocean.position.y = -0.35;
		ocean.frustumCulled = false;
		scene.add(ocean);

		var sun = new THREE.DirectionalLight(0xffd2a1, 2.2);
		sun.position.copy(sunDir).multiplyScalar(420);
		sun.castShadow = quality !== 'low';
		sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1536, quality === 'high' ? 2048 : 1536);
		sun.shadow.camera.left = -120;
		sun.shadow.camera.right = 120;
		sun.shadow.camera.top = 120;
		sun.shadow.camera.bottom = -120;
		sun.shadow.camera.near = 20;
		sun.shadow.camera.far = 900;
		sun.shadow.bias = -0.0006;
		sun.shadow.normalBias = 0.45;
		scene.add(sun);
		scene.add(sun.target);

		var hemi = new THREE.HemisphereLight(0xffd9b4, 0x33423b, 0.78);
		scene.add(hemi);
		var fill = new THREE.DirectionalLight(0x8fb7d9, 0.35);
		fill.position.set(-0.4, 0.5, -0.7);
		scene.add(fill);

		scene.fog = new THREE.Fog(0xe3a77d, 420, 3200);

		return { sky: sky, ocean: ocean, oceanNormal: oceanNormal, sun: sun, sunDir: sunDir, uniforms: uniforms, hemi: hemi };
	}

	function makeEnvironment(renderer) {
		var o = HZ.canvas(1024, 512), ctx = o.ctx;
		var g = ctx.createLinearGradient(0, 0, 0, 512);
		g.addColorStop(0, '#2b5c8a');
		g.addColorStop(0.38, '#84a9c2');
		g.addColorStop(0.52, '#f0b184');
		g.addColorStop(0.6, '#f7c79a');
		g.addColorStop(0.62, '#4b4a42');
		g.addColorStop(1, '#201f1c');
		ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
		var sg = ctx.createRadialGradient(780, 320, 10, 780, 320, 250);
		sg.addColorStop(0, 'rgba(255,244,210,1)');
		sg.addColorStop(0.25, 'rgba(255,210,150,0.75)');
		sg.addColorStop(1, 'rgba(255,170,110,0)');
		ctx.fillStyle = sg; ctx.fillRect(0, 0, 1024, 512);
		var tex = new THREE.CanvasTexture(o.canvas);
		tex.mapping = THREE.EquirectangularReflectionMapping;
		tex.colorSpace = THREE.SRGBColorSpace;
		var pmrem = new THREE.PMREMGenerator(renderer);
		var env = pmrem.fromEquirectangular(tex).texture;
		pmrem.dispose();
		tex.dispose();
		return env;
	}

	/* ------------------------------------------------------------ helpers */
	var dummy = new THREE.Object3D();

	function instanced(geometry, material, list, dynamicColor) {
		var mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
		mesh.count = list.length;
		for (var i = 0; i < list.length; i++) {
			var it = list[i];
			dummy.position.set(it.x, it.y, it.z);
			dummy.rotation.set(0, it.ry || 0, 0);
			if (it.rx) dummy.rotation.x = it.rx;
			if (it.rz) dummy.rotation.z = it.rz;
			dummy.scale.set(it.sx || 1, it.sy || 1, it.sz || 1);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
			if (dynamicColor && it.color != null) mesh.setColorAt(i, it.color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
		return mesh;
	}

	function roadPoint(road, dist, lateral, out) {
		out = out || {};
		var n = road.samples.length;
		var d = road.closed ? HZ.wrap(dist, 0, road.length) : HZ.clamp(dist, 0, road.length);
		var f = d / road.step;
		var i0 = Math.floor(f) % n;
		var i1 = road.closed ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
		if (!road.closed && i0 >= n - 1) { i0 = n - 1; i1 = n - 1; }
		var t = f - Math.floor(f);
		var a = road.samples[i0], b = road.samples[i1];
		out.x = HZ.lerp(a.x, b.x, t) + HZ.lerp(a.rx, b.rx, t) * lateral;
		out.z = HZ.lerp(a.z, b.z, t) + HZ.lerp(a.rz, b.rz, t) * lateral;
		out.y = HZ.lerp(a.y, b.y, t);
		out.yaw = Math.atan2(HZ.lerp(a.tx, b.tx, t), HZ.lerp(a.tz, b.tz, t));
		out.rx = HZ.lerp(a.rx, b.rx, t);
		out.rz = HZ.lerp(a.rz, b.rz, t);
		out.tx = HZ.lerp(a.tx, b.tx, t);
		out.tz = HZ.lerp(a.tz, b.tz, t);
		out.dist = d;
		return out;
	}

	function findRoadIndex(road, x, z) {
		return nearestSample(road, x, z).index;
	}

	/* ------------------------------------------------------------ terrain mesh */
	function buildTerrain(heightField, quality) {
		var div = quality === 'low' ? 384 : (quality === 'high' ? 544 : 480);
		var size = WORLD.size;
		var vertices = (div + 1) * (div + 1);
		var pos = new Float32Array(vertices * 3);
		var col = new Float32Array(vertices * 3);
		var uv = new Float32Array(vertices * 2);
		var grassA = new THREE.Color('#728b4f');
		var grassB = new THREE.Color('#4f6a3e');
		var grassC = new THREE.Color('#8a8254');
		var dry = new THREE.Color('#ab9668');
		var sand = new THREE.Color('#cdb98c');
		var rock = new THREE.Color('#8a8478');
		var rockDark = new THREE.Color('#625d55');
		var snow = new THREE.Color('#dcdad2');
		var c = new THREE.Color();
		for (var iz = 0; iz <= div; iz++) {
			for (var ix = 0; ix <= div; ix++) {
				var x = -WORLD.half + (ix / div) * size;
				var z = -WORLD.half + (iz / div) * size;
				var y = heightField.sample(x, z);
				var i = iz * (div + 1) + ix;
				pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
				uv[i * 2] = x / 42; uv[i * 2 + 1] = z / 42;
				var slope = Math.hypot(
					heightField.sample(x + 6, z) - heightField.sample(x - 6, z),
					heightField.sample(x, z + 6) - heightField.sample(x, z - 6)) / 12;
				var n = HZ.fbm(x * 0.02, z * 0.02, 3, 2, 0.5);
				c.copy(grassA).lerp(grassB, HZ.clamp(n * 1.4, 0, 1));
				if (n > 0.58) c.lerp(grassC, (n - 0.58) * 1.5);
				/* dry verge near the road */
				var near = heightField.nearRoad ? heightField.nearRoad(x, z) : null;
				if (near && near.dist < 22) c.lerp(dry, (1 - near.dist / 22) * 0.55);
				/* beach sand */
				if (y < 5.2) c.lerp(sand, HZ.clamp((5.2 - y) / 4.2, 0, 1) * 0.95);
				/* rock on steep faces */
				if (slope > 0.34) c.lerp(rock, HZ.clamp((slope - 0.34) / 0.6, 0, 1) * 0.9);
				if (slope > 0.9) c.lerp(rockDark, HZ.clamp((slope - 0.9) / 0.8, 0, 1) * 0.55);
				/* high mountain tint + snow */
				if (y > 120) c.lerp(rockDark, HZ.clamp((y - 120) / 90, 0, 1) * 0.35);
				if (y > 176) c.lerp(snow, HZ.clamp((y - 176) / 45, 0, 1) * 0.92);
				if (y < 0.6) c.lerp(new THREE.Color('#948a70'), 0.5);
				col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
			}
		}
		var index = [];
		for (var iy = 0; iy < div; iy++) {
			for (var ix2 = 0; ix2 < div; ix2++) {
				var a = iy * (div + 1) + ix2;
				var b = a + 1;
				var c2 = a + div + 1;
				var d = c2 + 1;
				index.push(a, c2, b, b, c2, d);
			}
		}
		var geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
		geo.setIndex(index);
		geo.computeVertexNormals();
		var mat = new THREE.MeshStandardMaterial({
			map: HZ.textures.grass(), bumpMap: HZ.textures.grass(), bumpScale: 0.28,
			vertexColors: true, roughness: 0.97, metalness: 0, color: 0xffffff
		});
		mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
		var mesh = new THREE.Mesh(geo, mat);
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		return mesh;
	}

	/* ------------------------------------------------------------ roads mesh */
	function buildRoadMeshes(roads) {
		var group = new THREE.Group();
		group.name = 'roads';
		var asphalt = HZ.textures.asphalt();
		var gravel = HZ.textures.gravel();
		Object.keys(roads).forEach(function (key) {
			var road = roads[key];
			var n = road.samples.length;
			var segs = road.closed ? n : n - 1;
			var pos = [], uv = [], idx = [], spos = [], suv = [], sidx = [];
			var vcount = 0, scount = 0;
			var dist = 0;
			for (var i = 0; i < n; i++) {
				var s = road.samples[i];
				var half = road.half;
				pos.push(s.x - s.rx * half, s.y + 0.09, s.z - s.rz * half);
				pos.push(s.x + s.rx * half, s.y + 0.09, s.z + s.rz * half);
				var v = s.dist / 12;
				uv.push(0, v, 1, v);
				var sh = half + 2.2;
				spos.push(s.x - s.rx * sh, s.y - 0.02, s.z - s.rz * sh);
				spos.push(s.x + s.rx * sh, s.y - 0.02, s.z + s.rz * sh);
				suv.push(0, s.dist / 18, 1, s.dist / 18);
				if (i < segs || road.closed) {
					var ni = (i + 1) % n;
					if (!road.closed && i === n - 1) break;
					idx.push(vcount, vcount + 2, vcount + 1, vcount + 1, vcount + 2, vcount + 3);
					sidx.push(scount, scount + 2, scount + 1, scount + 1, scount + 2, scount + 3);
				}
				vcount += 2; scount += 2;
			}
			var geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
			geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
			geo.setIndex(idx);
			geo.computeVertexNormals();
			var mat = new THREE.MeshStandardMaterial({
				map: asphalt, bumpMap: asphalt, bumpScale: 0.025,
				roughness: 0.88, metalness: 0.06, color: 0xffffff
			});
			var mesh = new THREE.Mesh(geo, mat);
			mesh.receiveShadow = true;
			mesh.frustumCulled = false;
			group.add(mesh);

			var sgeo = new THREE.BufferGeometry();
			sgeo.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
			sgeo.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
			sgeo.setIndex(sidx);
			sgeo.computeVertexNormals();
			var smat = new THREE.MeshStandardMaterial({
				map: gravel, roughness: 1, metalness: 0, color: 0xa8a08d
			});
			var smesh = new THREE.Mesh(sgeo, smat);
			smesh.receiveShadow = true;
			smesh.frustumCulled = false;
			group.add(smesh);
		});
		return group;
	}

	/* ------------------------------------------------------------ roadside posts and lamps */
	function buildRoadFurniture(roads, quality) {
		var group = new THREE.Group();
		var posts = [], caps = [];
		var lampPoles = [], lampHeads = [];
		var rails = [], railPosts = [];
		Object.keys(roads).forEach(function (key) {
			var road = roads[key];
			var stepN = key === 'coast' ? 4 : 6;
			for (var i = 0; i < road.samples.length; i += stepN) {
				var s = road.samples[i];
				var side = (key === 'coast') ? 1 : -1;
				var off = road.half + 1.1;
				var px = s.x + s.rx * off * side, pz = s.z + s.rz * off * side;
				var ground = s.y;
				posts.push({ x: px, y: ground + 0.42, z: pz, ry: Math.atan2(s.tx, s.tz) });
				caps.push({ x: px, y: ground + 0.86, z: pz, ry: Math.atan2(s.tx, s.tz) });
			}
			if (key !== 'spur') {
				for (var j = 0; j < road.samples.length; j += 26) {
					var l = road.samples[j];
					var side2 = -1;
					var o2 = road.half + 4.2;
					var lx = l.x + l.rx * o2 * side2, lz = l.z + l.rz * o2 * side2;
					lampPoles.push({ x: lx, y: l.y + 3.6, z: lz, ry: Math.atan2(l.tx, l.tz) });
					lampHeads.push({ x: lx + l.rx * 1.2 * side2, y: l.y + 6.9, z: lz + l.rz * 1.2 * side2, ry: Math.atan2(l.tx, l.tz) });
				}
			}
			/* steel guardrails: the whole touge plus the outside of the coast road */
			if (key !== 'spur' && key !== 'townloop') {
				var railStep = key === 'pass' ? 1 : 2;
				for (var r = 6; r < road.samples.length - 2; r += railStep) {
					var rs = road.samples[r];
					var side3 = key === 'pass' ? 1 : 1;
					var off3 = road.half + 0.55;
					var rx3 = rs.x + rs.rx * off3 * side3;
					var rz3 = rs.z + rs.rz * off3 * side3;
					rails.push({ x: rx3, y: rs.y + 0.62, z: rz3, ry: Math.atan2(rs.tx, rs.tz), sz: railStep * road.step * 1.02 });
					if (r % (key === 'pass' ? 2 : 3) === 0) railPosts.push({ x: rx3, y: rs.y + 0.35, z: rz3, ry: Math.atan2(rs.tx, rs.tz) });
				}
			}
		});
		var postGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.84, 6);
		var postMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.55 });
		var postMesh = instanced(postGeo, postMat, posts);
		postMesh.castShadow = false; group.add(postMesh);
		var capGeo = new THREE.BoxGeometry(0.16, 0.12, 0.16);
		var capMat = new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff6b1c, emissiveIntensity: 0.9, roughness: 0.4 });
		var capMesh = instanced(capGeo, capMat, caps);
		group.add(capMesh);

		if (lampPoles.length) {
			var poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 7.2, 6);
			var poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 });
			var poleMesh = instanced(poleGeo, poleMat, lampPoles);
			poleMesh.castShadow = false; group.add(poleMesh);
			var headGeo = new THREE.BoxGeometry(1.5, 0.16, 0.34);
			var headMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb060, emissiveIntensity: 1.4, roughness: 0.3 });
			group.add(instanced(headGeo, headMat, lampHeads));
		}
		if (rails.length) {
			var railMat = new THREE.MeshStandardMaterial({ color: 0x8d949a, metalness: 0.7, roughness: 0.38 });
			var railGeo = new THREE.BoxGeometry(0.09, 0.28, 1);
			var railMesh = instanced(railGeo, railMat, rails);
			railMesh.castShadow = false; group.add(railMesh);
			var rpGeo = new THREE.BoxGeometry(0.1, 0.82, 0.1);
			var rpMat = new THREE.MeshStandardMaterial({ color: 0x5a6066, metalness: 0.5, roughness: 0.5 });
			group.add(instanced(rpGeo, rpMat, railPosts));
		}
		return group;
	}

	/* ------------------------------------------------------------ trees, rocks */
	function buildFlora(heightField, query, quality) {
		var group = new THREE.Group();
		var rng = HZ.rng(0x5eeda71);
		var trunks = [], broad = [], cedar = [], cherry = [], rocks = [];
		var fest = WORLD.festival, shrine = WORLD.shrine, town = WORLD.town;
		var maxTrees = quality === 'low' ? 1400 : (quality === 'high' ? 3200 : 2400);
		var attempts = 0;
		while (trunks.length < maxTrees && attempts < maxTrees * 12) {
			attempts++;
			var x = HZ.randRange(rng, -WORLD.half + 30, WORLD.half - 30);
			var z = HZ.randRange(rng, -WORLD.half + 30, WORLD.half - 30);
			var y = heightField.sample(x, z);
			if (y < 2.4 || y > 172) continue;
			var near = query.coarse(x, z);
			if (near && near.dist < 13) continue;
			if (Math.hypot(x - fest.x, z - fest.z) < fest.radius + 6) continue;
			if (Math.hypot(x - shrine.x, z - shrine.z) < shrine.radius) continue;
			if (x > town.minX - 10 && x < town.maxX + 10 && z > town.minZ - 10 && z < town.maxZ + 10) {
				if (rng() < 0.8) continue;
			}
			if (slopeAt(x, z) > 0.52) continue;
			var s = HZ.randRange(rng, 0.7, 1.55);
			var h = HZ.randRange(rng, 4.4, 9.5) * s;
			var ry = rng() * HZ.TAU;
			trunks.push({ x: x, y: y + h * 0.4, z: z, sy: h / 7, sx: s, sz: s, ry: ry });
			var kind = rng();
			if (kind < 0.48) {
				broad.push({ x: x, y: y + h * 0.72, z: z, sx: s * HZ.randRange(rng, 1.5, 2.4), sy: s * HZ.randRange(rng, 1.4, 2.2), sz: s * HZ.randRange(rng, 1.5, 2.4), ry: ry, color: new THREE.Color().setHSL(0.25 + rng() * 0.06, 0.38 + rng() * 0.2, 0.3 + rng() * 0.12) });
			} else if (kind < 0.9) {
				cedar.push({ x: x, y: y + h * 0.66, z: z, sx: s * HZ.randRange(rng, 1.2, 1.9), sy: s * HZ.randRange(rng, 1.7, 2.6), sz: s * HZ.randRange(rng, 1.2, 1.9), ry: ry, color: new THREE.Color().setHSL(0.32, 0.4, 0.2 + rng() * 0.08) });
			} else {
				cherry.push({ x: x, y: y + h * 0.7, z: z, sx: s * 2.1, sy: s * 1.7, sz: s * 2.1, ry: ry, color: new THREE.Color().setHSL(0.94, 0.45, 0.66) });
			}
		}
		/* cherry boulevard around the festival and along the drive */
		var spur = null;
		var rng2 = HZ.rng(0xbeef);
		for (var i = 0; i < 54; i++) {
			var a = (i / 54) * HZ.TAU;
			var rr = fest.radius + HZ.randRange(rng2, 4, 14);
			var cx = fest.x + Math.cos(a) * rr, cz = fest.z + Math.sin(a) * rr;
			var cy = heightField.sample(cx, cz);
			cherry.push({ x: cx, y: cy + 3.1, z: cz, sx: 2.2, sy: 1.9, sz: 2.2, ry: rng2() * HZ.TAU, color: new THREE.Color().setHSL(0.95, 0.5, 0.68) });
			trunks.push({ x: cx, y: cy + 1.6, z: cz, sy: 0.72, sx: 0.85, sz: 0.85, ry: 0 });
		}
		/* rocks */
		var rng3 = HZ.rng(0x70c4);
		for (var r = 0; r < 460; r++) {
			var rx = HZ.randRange(rng3, -WORLD.half, WORLD.half);
			var rz = HZ.randRange(rng3, -WORLD.half, WORLD.half);
			var ry2 = heightField.sample(rx, rz);
			if (ry2 < 1.4) continue;
			var nr = query.coarse(rx, rz);
			if (nr && nr.dist < 11) continue;
			if (Math.hypot(rx - fest.x, rz - fest.z) < fest.radius) continue;
			var scale = HZ.randRange(rng3, 0.5, 2.8);
			rocks.push({ x: rx, y: ry2 + scale * 0.25, z: rz, sx: scale, sy: scale * HZ.randRange(rng3, 0.5, 1.1), sz: scale, ry: rng3() * HZ.TAU, rx: rng3() * 0.3, rz: rng3() * 0.3, color: new THREE.Color().setHSL(0.1, 0.06, 0.3 + rng3() * 0.12) });
		}
		var trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 7, 5);
		trunkGeo.translate(0, 0, 0);
		var trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a34, roughness: 0.95 });
		var trunkMesh = instanced(trunkGeo, trunkMat, trunks);
		trunkMesh.castShadow = true; group.add(trunkMesh);
		if (broad.length) {
			var bGeo = new THREE.IcosahedronGeometry(1, 1);
			var bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
			var bMesh = instanced(bGeo, bMat, broad, true);
			bMesh.castShadow = true; group.add(bMesh);
		}
		if (cedar.length) {
			var cGeo = new THREE.ConeGeometry(1, 2.6, 7, 2);
			var cMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true });
			var cMesh = instanced(cGeo, cMat, cedar, true);
			cMesh.castShadow = true; group.add(cMesh);
		}
		if (cherry.length) {
			var hGeo = new THREE.IcosahedronGeometry(1, 1);
			var hMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, flatShading: true });
			var hMesh = instanced(hGeo, hMat, cherry, true);
			hMesh.castShadow = true; group.add(hMesh);
		}
		if (rocks.length) {
			var rGeo = new THREE.DodecahedronGeometry(1, 0);
			var rMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
			var rMesh = instanced(rGeo, rMat, rocks, true);
			rMesh.castShadow = true; rMesh.receiveShadow = true; group.add(rMesh);
		}
		/* low grass tufts and roadside flowers, one instanced draw call */
		var tufts = [];
		var tuftRng = HZ.rng(0x7a11);
		for (var t = 0; t < 2200; t++) {
			var tx = HZ.randRange(tuftRng, -WORLD.half + 30, WORLD.half - 30);
			var tz = HZ.randRange(tuftRng, -WORLD.half + 30, WORLD.half - 30);
			var ty = heightField.sample(tx, tz);
			if (ty < 2.4 || ty > 165) continue;
			var tn = query.coarse(tx, tz);
			if (tn && tn.dist < 5.5) continue;
			if (Math.hypot(tx - fest.x, tz - fest.z) < fest.radius + 4) continue;
			var ts = HZ.randRange(tuftRng, 0.25, 0.8);
			tufts.push({ x: tx, y: ty + ts * 0.22, z: tz, sx: ts, sy: ts, sz: ts, ry: tuftRng() * HZ.TAU, color: new THREE.Color().setHSL(0.24 + tuftRng() * 0.08, 0.4, 0.32 + tuftRng() * 0.16) });
		}
		if (tufts.length) {
			var tuftGeo = new THREE.ConeGeometry(0.14, 0.55, 4);
			var tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
			group.add(instanced(tuftGeo, tuftMat, tufts, true));
		}
		if (quality === 'low') {
			var treeShadows = trunks.map(function (t) {
				var g = heightField.sample(t.x, t.z) + 0.045;
				return { x: t.x, y: g, z: t.z, sx: 2.8 + t.sx, sy: 2.8 + t.sx, sz: 1, rx: -Math.PI / 2, ry: 0 };
			});
			var shadowMat = new THREE.MeshBasicMaterial({ map: HZ.textures.blob(), transparent: true, opacity: 0.34, depthWrite: false });
			group.add(instanced(new THREE.PlaneGeometry(1, 1), shadowMat, treeShadows));
		}
		return group;
	}

	/* ------------------------------------------------------------ town */
	function buildTown(heightField, query) {
		var group = new THREE.Group();
		var rng = HZ.rng(0x7011);
		var windowMats = [
			new THREE.MeshStandardMaterial({ map: HZ.textures.windows(0), roughness: 0.8, metalness: 0.08,
				emissiveMap: HZ.textures.windowsEmissive(0), emissive: 0xffffff, emissiveIntensity: 0.32 }),
			new THREE.MeshStandardMaterial({ map: HZ.textures.windows(1), roughness: 0.8, metalness: 0.08,
				emissiveMap: HZ.textures.windowsEmissive(1), emissive: 0xffffff, emissiveIntensity: 0.32 })
		];
		var roofMat = new THREE.MeshStandardMaterial({ color: 0x3c3a36, roughness: 0.92 });
		var roofs = [], boxes = [];
		var colliders = [];
		var town = WORLD.town;
		for (var x = town.minX; x < town.maxX; x += 28) {
			for (var z = town.minZ; z < town.maxZ; z += 28) {
				var px = x + HZ.randRange(rng, -7, 7);
				var pz = z + HZ.randRange(rng, -7, 7);
				var near = query.coarse(px, pz);
				if (near && near.dist < 22) continue;
				var y = heightField.sample(px, pz);
				if (y < 3 || y > 70) continue;
				if (slopeAt(px, pz) > 0.35) continue;
				if (rng() < 0.18) continue;
				var w = HZ.randRange(rng, 11, 20);
				var d = HZ.randRange(rng, 11, 20);
				var h = HZ.randRange(rng, 7, 27);
				var ry = rng() < 0.5 ? 0 : Math.PI / 2;
				boxes.push({ x: px, y: y + h / 2 - 0.4, z: pz, sx: w, sy: h, sz: d, ry: ry, color: new THREE.Color().setHSL(0.09, 0.08 + rng() * 0.08, 0.68 + rng() * 0.12), variant: rng() < 0.5 ? 0 : 1 });
				roofs.push({ x: px, y: y + h - 0.25, z: pz, sx: w * 1.06, sy: 0.5, sz: d * 1.06, ry: ry });
				colliders.push({ x: px, z: pz, r: Math.max(w, d) * 0.56 + 1.2, y: y, type: 'building' });
			}
		}
		var geo = new THREE.BoxGeometry(1, 1, 1);
		var groups = [[], []];
		for (var i = 0; i < boxes.length; i++) groups[boxes[i].variant].push(boxes[i]);
		for (var g = 0; g < 2; g++) {
			if (!groups[g].length) continue;
			var mesh = instanced(geo, [windowMats[g], windowMats[g], roofMat, roofMat, windowMats[g], windowMats[g]], groups[g], true);
			mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
		}
		var rGeo = new THREE.BoxGeometry(1, 1, 1);
		var rMesh = instanced(rGeo, roofMat, roofs);
		rMesh.castShadow = true; group.add(rMesh);
		return { group: group, colliders: colliders };
	}

	/* ------------------------------------------------------------ festival */
	function buildFestival(scene, group, heightField) {
		var f = WORLD.festival;
		var y = f.y;
		var rng = HZ.rng(0xf3571);
		var root = new THREE.Group();
		root.position.set(f.x, y, f.z);
		group.add(root);

		var pad = new THREE.Mesh(
			new THREE.CircleGeometry(f.radius, 64),
			new THREE.MeshStandardMaterial({ map: HZ.textures.pad(), roughness: 0.88, metalness: 0.04 })
		);
		pad.rotation.x = -Math.PI / 2;
		pad.position.y = 0.05;
		pad.receiveShadow = true;
		root.add(pad);

		/* stage */
		var stageMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.7, metalness: 0.2 });
		var stage = new THREE.Mesh(new THREE.BoxGeometry(30, 1.4, 13), stageMat);
		stage.position.set(44, 0.7, 8);
		stage.castShadow = true; stage.receiveShadow = true;
		root.add(stage);
		var backWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, 25), new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.8 }));
		backWall.position.set(59, 5.5, 8);
		backWall.castShadow = true;
		root.add(backWall);
		var screen = new THREE.Mesh(
			new THREE.PlaneGeometry(20, 7.5),
			new THREE.MeshBasicMaterial({ map: HZ.textures.banner('HAYNEKO', 'HORIZON FESTIVAL', ['#ff4d2e', '#ffb340', '#182135']), toneMapped: false })
		);
		screen.position.set(58.6, 7.4, 8);
		screen.rotation.y = -Math.PI / 2;
		root.add(screen);

		var trussMat = new THREE.MeshStandardMaterial({ color: 0x8b9297, roughness: 0.34, metalness: 0.8 });
		for (var t = -1; t <= 1; t += 2) {
			var truss = new THREE.Mesh(new THREE.BoxGeometry(0.35, 13, 0.35), trussMat);
			truss.position.set(44, 6.5, 8 + t * 7);
			truss.castShadow = true; root.add(truss);
			var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffb050, emissiveIntensity: 2 }));
			lamp.position.set(44, 13.2, 8 + t * 7);
			root.add(lamp);
		}
		var topBeam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 14.35), trussMat);
		topBeam.position.set(44, 13, 8); root.add(topBeam);

		/* soft volumetric beams sweeping the festival sky */
		var beamColors = [0xffb340, 0x45e0c2, 0xff5a45];
		for (var bm = 0; bm < 3; bm++) {
			var beamMat = new THREE.MeshBasicMaterial({
				color: beamColors[bm], transparent: true, opacity: 0.045,
				blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
			});
			var lightBeam = new THREE.Mesh(new THREE.ConeGeometry(3.4, 42, 10, 1, true), beamMat);
			lightBeam.position.set(42 + bm * 2, 32, 6 + bm * 2);
			lightBeam.rotation.z = Math.PI;
			lightBeam.rotation.x = (bm - 1) * 0.14;
			root.add(lightBeam);
		}

		/* tents */
		var tentColors = [0xff6f3c, 0x35b7a4, 0xffc145, 0xe4505f];
		for (var i = 0; i < 7; i++) {
			var a = (i / 7) * HZ.TAU + 0.4;
			var rr = f.radius * HZ.randRange(rng, 0.52, 0.8);
			var tx = Math.cos(a) * rr, tz = Math.sin(a) * rr;
			var tent = new THREE.Group();
			tent.position.set(tx, 0, tz);
			var body = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xf0e8d6, roughness: 0.85 }));
			body.position.y = 1.1; body.castShadow = true; tent.add(body);
			var roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.4, 4), new THREE.MeshStandardMaterial({ color: tentColors[i % tentColors.length], roughness: 0.8 }));
			roof.position.y = 3.4; roof.rotation.y = Math.PI / 4; roof.castShadow = true; tent.add(roof);
			root.add(tent);
		}
		/* crowd — kept on the stage side so the player's car has room */
		var people = [];
		var heads = [];
		var pRng = HZ.rng(0xc0f);
		for (var p = 0; p < 46; p++) {
			var px = HZ.randRange(pRng, 15, 48), pz = HZ.randRange(pRng, -25, 27);
			var face = Math.atan2(44 - px, 8 - pz) + Math.PI;
			var scl = HZ.randRange(pRng, 0.86, 1.12);
			var hue = pRng();
			people.push({ x: px, y: 0.55 * scl, z: pz, sx: scl, sy: scl, sz: scl, ry: face, color: new THREE.Color().setHSL(hue, 0.4, 0.3 + pRng() * 0.28) });
			heads.push({ x: px, y: 1.2 * scl, z: pz, sx: scl, sy: scl, sz: scl, ry: face, color: new THREE.Color().setHSL(0.07, 0.35, 0.55 + pRng() * 0.18) });
		}
		if (people.length) {
			var pGeo = new THREE.CapsuleGeometry(0.2, 0.68, 4, 6);
			var pMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
			var pMesh = instanced(pGeo, pMat, people, true);
			pMesh.castShadow = true; root.add(pMesh);
			var hGeo = new THREE.SphereGeometry(0.135, 6, 5);
			var hMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
			var hMesh = instanced(hGeo, hMat, heads, true);
			hMesh.castShadow = true; root.add(hMesh);
		}
		/* floodlight masts around the pad */
		for (var m = 0; m < 6; m++) {
			var ma = (m / 6) * HZ.TAU + 0.3;
			var mx = Math.cos(ma) * (f.radius - 7), mz = Math.sin(ma) * (f.radius - 7);
			var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 14, 6), new THREE.MeshStandardMaterial({ color: 0x454a4f, metalness: 0.7, roughness: 0.4 }));
			mast.position.set(mx, 7, mz); root.add(mast);
			var bulb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 0.25), new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffc370, emissiveIntensity: 1.8 }));
			bulb.position.set(mx, 14.1, mz); bulb.lookAt(0, 1.4, 0); root.add(bulb);
		}
		/* entry arch over the drive */
		var arch = new THREE.Group();
		var archMat = new THREE.MeshStandardMaterial({ color: 0x222a33, metalness: 0.5, roughness: 0.45 });
		for (var s = -1; s <= 1; s += 2) {
			var leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), archMat);
			leg.position.set(s * 7.4, 4.5, 0); leg.castShadow = true; arch.add(leg);
		}
		var beam = new THREE.Mesh(new THREE.BoxGeometry(16.4, 1.6, 0.7), archMat);
		beam.position.y = 9.2; arch.add(beam);
		var sign = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 1.9), new THREE.MeshBasicMaterial({ map: HZ.textures.banner('HORIZON', 'FESTIVAL / NAGISA'), toneMapped: false }));
		sign.position.set(0, 9.2, 0.38); arch.add(sign);
		var sign2 = sign.clone(); sign2.position.z = -0.38; sign2.rotation.y = Math.PI; arch.add(sign2);
		/* place the arch near the spur entry, facing the pad */
		var archSample = roadPointOf(worldRoads.spur, worldRoads.spur.length * 0.72);
		arch.position.set(archSample.x - f.x, archSample.y - y, archSample.z - f.z);
		arch.rotation.y = archSample.yaw;
		root.add(arch);

		/* colliders for stage and arch legs */
		var colliders = [];
		colliders.push({ x: f.x + 44, z: f.z + 8, r: 16, y: y, type: 'stage' });
		colliders.push({ x: f.x + arch.position.x - 7.4 * Math.cos(arch.rotation.y), z: f.z + arch.position.z + 7.4 * Math.sin(arch.rotation.y), r: 1.1, y: y, type: 'arch' });
		colliders.push({ x: f.x + arch.position.x + 7.4 * Math.cos(arch.rotation.y), z: f.z + arch.position.z - 7.4 * Math.sin(arch.rotation.y), r: 1.1, y: y, type: 'arch' });

		return { group: root, colliders: colliders };
	}

	/* worldRoads is set during buildWorld so buildFestival can use it */
	var worldRoads = null;
	function roadPointOf(road, dist) { var o = {}; return roadPoint(road, dist, 0, o); }

	/* ------------------------------------------------------------ torii & shrine */
	function buildTorii(x, y, z, yaw, scale) {
		scale = scale || 1;
		var root = new THREE.Group();
		root.position.set(x, y, z);
		root.rotation.y = yaw;
		root.scale.setScalar(scale);
		var red = new THREE.MeshStandardMaterial({ color: 0xb83a2b, roughness: 0.6 });
		var dark = new THREE.MeshStandardMaterial({ color: 0x25211d, roughness: 0.7 });
		for (var s = -1; s <= 1; s += 2) {
			var pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 6.4, 8), red);
			pillar.position.set(s * 3.2, 3.2, 0); pillar.castShadow = true; root.add(pillar);
			var foot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.6, 8), dark);
			foot.position.set(s * 3.2, 0.3, 0); root.add(foot);
		}
		var top = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.55, 1.1), red);
		top.position.y = 6.7; top.castShadow = true; root.add(top);
		var top2 = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.32, 1.4), dark);
		top2.position.y = 7.06; top2.castShadow = true; root.add(top2);
		var mid = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.4, 0.8), red);
		mid.position.y = 5.2; mid.castShadow = true; root.add(mid);
		var plaque = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.18), dark);
		plaque.position.y = 5.85; root.add(plaque);
		return root;
	}

	function buildShrine(scene, group) {
		var s = WORLD.shrine;
		var root = new THREE.Group();
		root.position.set(s.x, s.y, s.z);
		group.add(root);
		var stone = new THREE.MeshStandardMaterial({ color: 0x8b877a, roughness: 0.9 });
		var wood = new THREE.MeshStandardMaterial({ color: 0x5c3826, roughness: 0.8 });
		var roofMat = new THREE.MeshStandardMaterial({ color: 0x2c2724, roughness: 0.7 });
		var hall = new THREE.Mesh(new THREE.BoxGeometry(14, 5.4, 9), wood);
		hall.position.set(-10, 2.7, -14); hall.castShadow = true; root.add(hall);
		var roof = new THREE.Mesh(new THREE.ConeGeometry(11, 3.4, 4), roofMat);
		roof.position.set(-10, 7, -14); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.7; roof.castShadow = true; root.add(roof);
		root.add(buildTorii(0, 0, 2, 0, 1.15));
		for (var i = 0; i < 7; i++) {
			var step = new THREE.Mesh(new THREE.BoxGeometry(5.6 - i * 0.08, 0.28, 1.1), stone);
			step.position.set(0, 0.14 + i * 0.24, 8 + i * 1.05);
			step.receiveShadow = true; root.add(step);
		}
		for (var l = -1; l <= 1; l += 2) {
			var lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 2.2, 6), stone);
			lantern.position.set(l * 4.8, 1.1, 6); lantern.castShadow = true; root.add(lantern);
			var cap = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.6, 6), stone);
			cap.position.set(l * 4.8, 2.5, 6); root.add(cap);
		}
		var colliders = [
			{ x: s.x - 10, z: s.z - 14, r: 9, y: s.y, type: 'shrine' },
			{ x: s.x - 3.8, z: s.z + 2, r: 1, y: s.y, type: 'torii' },
			{ x: s.x + 3.8, z: s.z + 2, r: 1, y: s.y, type: 'torii' }
		];
		return { group: root, colliders: colliders };
	}

	/* ------------------------------------------------------------ harbour boats */
	function buildBoats() {
		var group = new THREE.Group();
		var rng = HZ.rng(0xb0a7);
		var hullMat = new THREE.MeshStandardMaterial({ color: 0x27333b, roughness: 0.65, metalness: 0.2 });
		var cabinMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.7 });
		var lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd27a, emissiveIntensity: 1.6 });
		for (var i = 0; i < 4; i++) {
			var z = HZ.randRange(rng, -260, 420);
			var x = shoreX(z) + HZ.randRange(rng, 55, 170);
			var boat = new THREE.Group();
			boat.position.set(x, 0.35, z);
			boat.rotation.y = HZ.randRange(rng, -0.6, 0.6) + (rng() < 0.5 ? 0 : Math.PI);
			var len = HZ.randRange(rng, 7, 12);
			var hull = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.3, len), hullMat);
			hull.position.y = 0.35; boat.add(hull);
			var bow = new THREE.Mesh(new THREE.ConeGeometry(1.55, 3, 4), hullMat);
			bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(0, 0.3, -len / 2 - 1.2); boat.add(bow);
			var cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, len * 0.35), cabinMat);
			cabin.position.set(0, 1.6, len * 0.05); boat.add(cabin);
			var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 8, 5), new THREE.MeshStandardMaterial({ color: 0x5b6166, metalness: 0.6, roughness: 0.4 }));
			mast.position.set(0, 5.2, -len * 0.2); boat.add(mast);
			var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), lightMat);
			lamp.position.set(0, 9.2, -len * 0.2); boat.add(lamp);
			group.add(boat);
		}
		return group;
	}

	/* ------------------------------------------------------------ jumps & countryside */
	function makeRampGeometry(w, l, h) {
		var w2 = w / 2, l2 = l / 2;
		var verts = [
			/* slope */
			[-w2, 0, -l2], [w2, 0, -l2], [w2, h, l2],
			[-w2, 0, -l2], [w2, h, l2], [-w2, h, l2],
			/* back */
			[-w2, 0, l2], [w2, 0, l2], [w2, h, l2],
			[-w2, 0, l2], [w2, h, l2], [-w2, h, l2],
			/* left */
			[-w2, 0, -l2], [-w2, h, l2], [-w2, 0, l2],
			/* right */
			[w2, 0, -l2], [w2, 0, l2], [w2, h, l2]
		];
		var uvs = [
			[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1],
			[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1],
			[0, 0], [0, 1], [1, 0], [0, 0], [1, 0], [1, 1]
		];
		var positions = [];
		var texCoords = [];
		for (var i = 0; i < verts.length; i++) {
			positions.push(verts[i][0], verts[i][1], verts[i][2]);
			texCoords.push(uvs[i][0], uvs[i][1]);
		}
		var geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(texCoords, 2));
		geo.computeVertexNormals();
		return geo;
	}

	function buildRamps(roads, group) {
		var defs = [];
		var padY = WORLD.festival.y + 0.06;
		defs.push({
			id: 'festival-ramp', x: WORLD.festival.x - 30, z: WORLD.festival.z + 50,
			y: padY, yaw: -0.32, width: 13, length: 22, height: 2.6
		});
		if (roads.south) {
			var sp = roadPoint(roads.south, roads.south.length * 0.46, 0, {});
			defs.push({ id: 'minami-ramp', x: sp.x, z: sp.z, y: sp.y + 0.09, yaw: sp.yaw, width: 10, length: 19, height: 2.4 });
		}
		if (roads.north) {
			var np = roadPoint(roads.north, roads.north.length * 0.64, 0, {});
			defs.push({ id: 'kita-ramp', x: np.x, z: np.z, y: np.y + 0.09, yaw: np.yaw, width: 10, length: 19, height: 2.4 });
		}
		var mat = new THREE.MeshStandardMaterial({ map: HZ.textures.ramp(), roughness: 0.82, metalness: 0.05 });
		var lipMat = new THREE.MeshStandardMaterial({ color: 0xffb340, emissive: 0xff8a2c, emissiveIntensity: 1.1, roughness: 0.4 });
		var signMat = new THREE.MeshBasicMaterial({ map: HZ.textures.sign('JUMP', 'STUNT RAMP', '#ffb340'), toneMapped: false });
		var postMat = new THREE.MeshStandardMaterial({ color: 0x3c4247, roughness: 0.5, metalness: 0.5 });
		var ramps = [];
		for (var i = 0; i < defs.length; i++) {
			var d = defs[i];
			var root = new THREE.Group();
			root.position.set(d.x, d.y, d.z);
			root.rotation.y = d.yaw;
			var mesh = new THREE.Mesh(makeRampGeometry(d.width, d.length, d.height), mat);
			mesh.castShadow = true; mesh.receiveShadow = true;
			root.add(mesh);
			var lip = new THREE.Mesh(new THREE.BoxGeometry(d.width + 0.6, 0.22, 0.5), lipMat);
			lip.position.set(0, d.height + 0.02, d.length / 2 - 0.25);
			root.add(lip);
			var post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.2, 6), postMat);
			post.position.set(d.width / 2 + 1.2, 2.1, -d.length / 2 + 1);
			root.add(post);
			var sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), signMat);
			sign.position.set(d.width / 2 + 1.2, 4.4, -d.length / 2 + 1);
			sign.rotation.y = Math.PI / 2;
			sign.material.side = THREE.DoubleSide;
			root.add(sign);
			group.add(root);
			d.fx = Math.sin(d.yaw); d.fz = Math.cos(d.yaw);
			d.rx = Math.cos(d.yaw); d.rz = -Math.sin(d.yaw);
			ramps.push(d);
		}
		/* cones and tyre barriers make the stunt ramps read as an event, not a bug */
		var cones = [], tyres = [];
		for (var c = 0; c < ramps.length; c++) {
			var rr = ramps[c];
			for (var sd = -1; sd <= 1; sd += 2) {
				for (var k = -1; k <= 1; k++) {
					var along = rr.length * 0.5 + 2 + k * 2.4;
					var lat = sd * (rr.width / 2 + 1.1);
					cones.push({
						x: rr.x + rr.fx * along + rr.rx * lat,
						y: rr.y + 0.32,
						z: rr.z + rr.fz * along + rr.rz * lat,
						ry: rr.yaw
					});
				}
			}
			for (var ty = 0; ty < 4; ty++) {
				var along2 = -rr.length * 0.5 - 2 - (ty % 2) * 1.5;
				var lat2 = (ty < 2 ? -1 : 1) * (rr.width / 2 + 1.8);
				tyres.push({
					x: rr.x + rr.fx * along2 + rr.rx * lat2,
					y: rr.y + 0.14,
					z: rr.z + rr.fz * along2 + rr.rz * lat2,
					ry: rr.yaw
				});
			}
		}
		if (cones.length) {
			var coneMat = new THREE.MeshStandardMaterial({ color: 0xff6b32, roughness: 0.65 });
			group.add(instanced(new THREE.ConeGeometry(0.18, 0.62, 8), coneMat, cones));
		}
		if (tyres.length) {
			var tyreMat = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.9 });
			var tyreGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.24, 12);
			group.add(instanced(tyreGeo, tyreMat, tyres));
		}
		return ramps;
	}

	function buildCountryside(roads, heightField, query, group) {
		var rng = HZ.rng(0xfa4a3);
		var fields = [];
		var houses = [];
		var roofs = [];
		var poles = [];
		var arms = [];
		var colliders = [];
		var fieldMat = new THREE.MeshStandardMaterial({ map: HZ.textures.field(), roughness: 1, side: THREE.DoubleSide });
		var houseMat = new THREE.MeshStandardMaterial({ color: 0xded4bb, roughness: 0.86 });
		var roofMat = new THREE.MeshStandardMaterial({ color: 0x4a3a31, roughness: 0.9 });
		var poleMat = new THREE.MeshStandardMaterial({ color: 0x5a544c, roughness: 0.7, metalness: 0.3 });
		for (var f = 0; f < 28; f++) {
			var fx = HZ.randRange(rng, -WORLD.half + 100, WORLD.half - 100);
			var fz = HZ.randRange(rng, -WORLD.half + 100, WORLD.half - 100);
			if (fz > -350 && fz < 550) continue;
			if (Math.hypot(fx - WORLD.festival.x, fz - WORLD.festival.z) < 150) continue;
			if (Math.hypot(fx - WORLD.shrine.x, fz - WORLD.shrine.z) < 90) continue;
			var fy = heightField.sample(fx, fz);
			if (fy < 3) continue;
			var near = query.coarse(fx, fz);
			if (near && near.dist < 34) continue;
			if (slopeAt(fx, fz) > 0.24) continue;
			var fs = HZ.randRange(rng, 34, 62);
			fields.push({ x: fx, y: fy + 0.05, z: fz, sx: fs, sy: fs * HZ.randRange(rng, 0.55, 0.9), sz: 1, ry: HZ.randRange(rng, -0.4, 0.4), rx: -Math.PI / 2 });
			if (rng() < 0.55) {
				var hx = fx + HZ.randRange(rng, -fs * 0.7, fs * 0.7);
				var hz = fz + HZ.randRange(rng, -fs * 0.7, fs * 0.7);
				var hy = heightField.sample(hx, hz);
				if (hy > 2 && slopeAt(hx, hz) < 0.3) {
					var hs = HZ.randRange(rng, 0.8, 1.35);
					houses.push({ x: hx, y: hy + 2.2 * hs, z: hz, sx: 7 * hs, sy: 4.4 * hs, sz: 5.5 * hs, ry: rng() * HZ.TAU });
					roofs.push({ x: hx, y: hy + 4.7 * hs, z: hz, sx: 8 * hs, sy: 0.7 * hs, sz: 6.5 * hs, ry: rng() * HZ.TAU });
					colliders.push({ x: hx, z: hz, r: 4.6 * hs, y: hy, type: 'village' });
				}
			}
		}
		if (fields.length) group.add(instanced(new THREE.PlaneGeometry(1, 1), fieldMat, fields));
		if (houses.length) {
			var hMesh = instanced(new THREE.BoxGeometry(1, 1, 1), houseMat, houses);
			hMesh.castShadow = true; group.add(hMesh);
			var rMesh = instanced(new THREE.ConeGeometry(0.72, 0.75, 4), roofMat, roofs.map(function (r) {
				return { x: r.x, y: r.y + 0.4, z: r.z, sx: r.sx * 0.62, sy: 1.1, sz: r.sz * 0.62, ry: Math.PI / 4 };
			}));
			rMesh.castShadow = true; group.add(rMesh);
		}
		/* power poles along the two long new roads */
		['south', 'north'].forEach(function (key) {
			var road = roads[key];
			if (!road) return;
			for (var i = 12; i < road.samples.length; i += 24) {
				var s = road.samples[i];
				var side = 1;
				var px = s.x + s.rx * (road.half + 4.8) * side;
				var pz = s.z + s.rz * (road.half + 4.8) * side;
				var py = heightField.sample(px, pz);
				if (py < 2) continue;
				poles.push({ x: px, y: py + 3.8, z: pz, sy: 1, ry: Math.atan2(s.tx, s.tz) });
				arms.push({ x: px, y: py + 7.2, z: pz, ry: Math.atan2(s.tx, s.tz) });
			}
		});
		if (poles.length) {
			var poleGeo = new THREE.CylinderGeometry(0.1, 0.16, 7.6, 5);
			var poleMesh = instanced(poleGeo, poleMat, poles);
			poleMesh.castShadow = true; group.add(poleMesh);
			var armGeo = new THREE.BoxGeometry(2.4, 0.1, 0.12);
			var armMesh = instanced(armGeo, poleMat, arms);
			group.add(armMesh);
		}
		return { group: group, colliders: colliders, ramps: null };
	}

	/* ------------------------------------------------------------ distant world */
	function buildDistant(renderer) {
		var group = new THREE.Group();
		var rng = HZ.rng(0xf00d);
		var rockMat = new THREE.MeshStandardMaterial({ color: 0x5d6b73, roughness: 1, flatShading: true });
		var ridgeMat = new THREE.MeshStandardMaterial({ color: 0x4b5a63, roughness: 1, flatShading: true });
		var snowMat = new THREE.MeshStandardMaterial({ color: 0xcfd9dc, roughness: 0.92, flatShading: true });
		/* a few low, soft ridges far north, almost lost in the haze */
		for (var i = 0; i < 4; i++) {
			var a = HZ.randRange(rng, 1.0, 2.6);
			var r = HZ.randRange(rng, 2900, 3600);
			var x = Math.cos(a) * r, z = Math.sin(a) * r;
			var h = HZ.randRange(rng, 260, 420);
			var w = HZ.randRange(rng, 850, 1250);
			var peak = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), ridgeMat);
			peak.position.set(x, h / 2 - 70, z);
			peak.rotation.y = rng() * HZ.TAU;
			group.add(peak);
		}
		/* Fuji-like cone across the bay */
		var fuji = new THREE.Group();
		fuji.position.set(2500, -30, -900);
		var body = new THREE.Mesh(new THREE.ConeGeometry(1150, 620, 40), new THREE.MeshStandardMaterial({ color: 0x53636e, roughness: 1 }));
		body.position.y = 310; fuji.add(body);
		var cap = new THREE.Mesh(new THREE.ConeGeometry(365, 185, 40), snowMat);
		cap.position.y = 468; fuji.add(cap);
		group.add(fuji);
		return group;
	}

	function buildAtmosphere() {
		var rng = HZ.rng(0x51a7);
		var n = 4200;
		var positions = new Float32Array(n * 3);
		for (var i = 0; i < n; i++) {
			positions[i * 3] = HZ.randRange(rng, -1250, 1250);
			positions[i * 3 + 1] = HZ.randRange(rng, 2.5, 95);
			positions[i * 3 + 2] = HZ.randRange(rng, -1250, 1250);
		}
		var geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		var mat = new THREE.PointsMaterial({
			map: HZ.textures.mote(), color: 0xffd9a0, size: 2.1, sizeAttenuation: true,
			transparent: true, opacity: 0.30, depthWrite: false, toneMapped: false,
			blending: THREE.AdditiveBlending
		});
		var points = new THREE.Points(geo, mat);
		points.frustumCulled = false;
		points.renderOrder = 1;
		return points;
	}

	function buildClouds() {
		var group = new THREE.Group();
		var tex = HZ.textures.cloud();
		var rng = HZ.rng(0xc10d);
		for (var i = 0; i < 26; i++) {
			var mat = new THREE.SpriteMaterial({ map: tex, color: 0xffe3c4, transparent: true, opacity: HZ.randRange(rng, 0.2, 0.5), depthWrite: false });
			var s = new THREE.Sprite(mat);
			var a = rng() * HZ.TAU;
			var r = HZ.randRange(rng, 700, 2600);
			s.position.set(Math.cos(a) * r, HZ.randRange(rng, 230, 620), Math.sin(a) * r);
			var sc = HZ.randRange(rng, 300, 800);
			s.scale.set(sc, sc * 0.42, 1);
			group.add(s);
		}
		return group;
	}

	/* ------------------------------------------------------------ event furniture */
	function gateMesh(color) {
		var root = new THREE.Group();
		var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8, toneMapped: false });
		var ring = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.16, 6, 40, Math.PI), mat);
		ring.position.y = 0.1;
		root.add(ring);
		var glow = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.5, 6, 40, Math.PI),
			new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.12, toneMapped: false, depthWrite: false }));
		glow.position.y = 0.1;
		root.add(glow);
		for (var s = -1; s <= 1; s += 2) {
			var post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6.5, 0.3), mat);
			post.position.set(s * 6.4, 3.25, 0);
			root.add(post);
		}
		root.userData.ring = ring;
		root.userData.glow = glow;
		root.userData.color = color;
		return root;
	}

	function buildGates(roads, group) {
		var defs = [
			{ id: 'coast', road: 'coast', at: [700, 330], color: 0xffb340, label: 'NAGISA COAST SPRINT', length: 1500 },
			{ id: 'touge', road: 'pass', at: [-520, -142], color: 0xff5a3c, label: 'KIRI TOUGE CLIMB', length: 1900 },
			{ id: 'circuit', road: 'coast', at: [470, 545], color: 0x45e0c2, label: 'FESTIVAL CIRCUIT', length: null }
		];
		var out = [];
		for (var i = 0; i < defs.length; i++) {
			var d = defs[i];
			var road = roads[d.road];
			var index = findRoadIndex(road, d.at[0], d.at[1]);
			var p = road.samples[index];
			var gate = gateMesh(d.color);
			gate.position.set(p.x, p.y + 0.05, p.z);
			gate.rotation.y = Math.atan2(p.tx, p.tz);
			var hex = '#' + ('000000' + d.color.toString(16)).slice(-6);
			var signMat = new THREE.MeshBasicMaterial({ map: HZ.textures.sign(d.label, 'START EVENT', hex), toneMapped: false });
			var gateSign = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 1.7), signMat);
			gateSign.position.y = 7.5;
			gate.add(gateSign);
			var gateSignBack = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 1.7), signMat);
			gateSignBack.position.set(0, 7.5, -0.02);
			gateSignBack.rotation.y = Math.PI;
			gate.add(gateSignBack);
			group.add(gate);
			out.push({
				id: d.id, road: road, index: index, color: d.color, label: d.label,
				length: d.length == null ? road.length : d.length,
				gate: gate, x: p.x, y: p.y, z: p.z, yaw: Math.atan2(p.tx, p.tz)
			});
		}
		return out;
	}

	function buildTraps(roads, group) {
		var defs = [
			{ id: 'trap-coast', road: 'coast', at: [728, 180], label: 'NAGISA TRAP' },
			{ id: 'trap-harbour', road: 'coast', at: [320, -360], label: 'HARBOUR TRAP' },
			{ id: 'trap-touge', road: 'pass', at: [-880, -520], label: 'TOUGE TRAP' },
			{ id: 'trap-minami', road: 'south', at: [430, 1320], label: 'MINAMI TRAP' },
			{ id: 'trap-kita', road: 'north', at: [-500, -800], label: 'RIDGE TRAP' }
		];
		var out = [];
		for (var i = 0; i < defs.length; i++) {
			var d = defs[i];
			var road = roads[d.road];
			var index = findRoadIndex(road, d.at[0], d.at[1]);
			var p = road.samples[index];
			var root = new THREE.Group();
			root.position.set(p.x, p.y, p.z);
			root.rotation.y = Math.atan2(p.tx, p.tz);
			var metal = new THREE.MeshStandardMaterial({ color: 0x3f464d, metalness: 0.7, roughness: 0.4 });
			for (var s = -1; s <= 1; s += 2) {
				var post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), metal);
				post.position.set(s * 6.2, 3, 0); root.add(post);
			}
			var bar = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.6, 0.4), metal);
			bar.position.y = 6; root.add(bar);
			var signTex = HZ.textures.sign(d.label, 'SPEED TRAP', '#ffb340');
			var sign = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 3.7), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
			sign.position.set(0, 7.9, 0.25); root.add(sign);
			var sign2 = sign.clone(); sign2.position.z = -0.25; sign2.rotation.y = Math.PI; root.add(sign2);
			group.add(root);
			out.push({ id: d.id, road: road, index: index, x: p.x, y: p.y, z: p.z, yaw: Math.atan2(p.tx, p.tz), label: d.label });
		}
		return out;
	}

	function buildDriftZones(roads, group) {
		var defs = [
			{ id: 'drift-coast', road: 'coast', at: [650, 500], radius: 70, label: 'COAST DRIFT ZONE' },
			{ id: 'drift-touge', road: 'pass', at: [-760, -610], radius: 55, label: 'HAIRPIN DRIFT ZONE' },
			{ id: 'drift-minami', road: 'south', at: [300, 1120], radius: 65, label: 'MINAMI DRIFT ZONE' },
			{ id: 'drift-kita', road: 'north', at: [-160, -920], radius: 55, label: 'RIDGE DRIFT ZONE' }
		];
		var out = [];
		for (var i = 0; i < defs.length; i++) {
			var d = defs[i];
			var road = roads[d.road];
			var index = findRoadIndex(road, d.at[0], d.at[1]);
			var p = road.samples[index];
			/* a pair of purple marker flags */
			var root = new THREE.Group();
			root.position.set(p.x, p.y, p.z);
			var mat = new THREE.MeshBasicMaterial({ color: 0xb97bff, toneMapped: false });
			for (var s = -1; s <= 1; s += 2) {
				var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 5), new THREE.MeshStandardMaterial({ color: 0x8d8d8d }));
				pole.position.set(s * (road.half + 1.4), 2.3, 0);
				root.add(pole);
				var flag = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.1), mat);
				flag.position.set(s * (road.half + 1.4) + s * 1.15, 4.2, 0);
				root.add(flag);
			}
			group.add(root);
			out.push({ id: d.id, road: road, index: index, x: p.x, y: p.y, z: p.z, radius: d.radius, label: d.label });
		}
		return out;
	}

	function buildBillboards(roads, group) {
		var defs = [
			{ at: [748, 250], title: 'NAGISA', sub: 'COAST ROAD', color: '#ffb340' },
			{ at: [-506, -138], title: 'KIRI', sub: 'TOUGE PASS', color: '#ff6a45' },
			{ at: [418, 585], title: 'FESTIVAL', sub: 'HAYNEKO HORIZON', color: '#45e0c2' },
			{ at: [300, -400], title: '88.3', sub: 'HAYNEKO FM', color: '#ffd166' }
		];
		for (var i = 0; i < defs.length; i++) {
			var d = defs[i];
			var near = nearestSample(roads.coast, d.at[0], d.at[1]);
			var road = roads.coast;
			if (d.at[1] < -500) road = roads.pass;
			var sample = d.at[0] < -450 ? nearestSample(roads.pass, d.at[0], d.at[1]) : near;
			var idx = sample.index;
			var p = road.samples[idx];
			var side = 1;
			var root = new THREE.Group();
			root.position.set(p.x + p.rx * (road.half + 8) * side, p.y, p.z + p.rz * (road.half + 8) * side);
			root.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI / 2;
			var postMat = new THREE.MeshStandardMaterial({ color: 0x3d4247, metalness: 0.6, roughness: 0.5 });
			for (var s = -1; s <= 1; s += 2) {
				var post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.5, 6), postMat);
				post.position.set(s * 3.2, 2.75, 0); root.add(post);
			}
			var board = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 4.1),
				new THREE.MeshBasicMaterial({ map: HZ.textures.sign(d.title, d.sub, d.color), toneMapped: false, side: THREE.DoubleSide }));
			board.position.y = 6.4; root.add(board);
			group.add(root);
		}
	}

	/* ------------------------------------------------------------ minimap */
	function buildMinimap(heightField, roads, gates, traps) {
		var size = 260;
		var canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		var ctx = canvas.getContext('2d');
		var img = ctx.createImageData(size, size);
		for (var y = 0; y < size; y++) {
			for (var x = 0; x < size; x++) {
				var wx = -WORLD.half + (x / (size - 1)) * WORLD.size;
				var wz = -WORLD.half + (y / (size - 1)) * WORLD.size;
				var h = heightField.sample(wx, wz);
				var r, g, b;
				if (h < 0.5) {
					var deep = HZ.clamp(-h / 30, 0, 1);
					r = HZ.lerp(44, 18, deep); g = HZ.lerp(104, 48, deep); b = HZ.lerp(116, 64, deep);
				} else if (h < 4) {
					r = 150; g = 150; b = 112;
				} else {
					var t = HZ.clamp(h / 180, 0, 1);
					var n = HZ.fbm(wx * 0.01, wz * 0.01, 2);
					r = HZ.lerp(86, 128, t) + n * 18;
					g = HZ.lerp(110, 120, t) + n * 16;
					b = HZ.lerp(64, 98, t) + n * 12;
				}
				var o = (y * size + x) * 4;
				img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		function toMap(x, z) { return { x: (x + WORLD.half) / WORLD.size * size, y: (z + WORLD.half) / WORLD.size * size }; }
		ctx.lineCap = 'round';
		Object.keys(roads).forEach(function (key) {
			var road = roads[key];
			ctx.strokeStyle = key === 'coast' ? 'rgba(255,211,138,0.95)' : (key === 'south' || key === 'north' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.55)');
			ctx.lineWidth = key === 'coast' ? 3.2 : (key === 'pass' || key === 'south' || key === 'north' ? 2.4 : 1.8);
			ctx.beginPath();
			for (var i = 0; i < road.samples.length; i += 2) {
				var p = toMap(road.samples[i].x, road.samples[i].z);
				if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
			}
			if (road.closed) ctx.closePath();
			ctx.stroke();
		});
		return { canvas: canvas, toMap: toMap };
	}

	/* ------------------------------------------------------------ main build */
	function buildWorld(scene, opts) {
		opts = opts || {};
		var quality = opts.quality || 'balanced';
		var skyRig = makeSky(scene, quality);
		if (opts.renderer) {
			var env = makeEnvironment(opts.renderer);
			scene.environment = env;
		}
		var roads = buildRoads();
		worldRoads = roads;
		var index = buildIndex(roads);
		var query = makeRoadQuery(index);
		var heightField = buildHeightField(query);
		heightField.nearRoad = function (x, z) { return query.coarse(x, z); };

		var group = new THREE.Group();
		group.name = 'world';
		scene.add(group);

		group.add(buildTerrain(heightField, quality));
		group.add(buildRoadMeshes(roads));
		group.add(buildRoadFurniture(roads, quality));
		group.add(buildFlora(heightField, query, quality));

		var town = buildTown(heightField, query);
		group.add(town.group);

		var festival = buildFestival(scene, group, heightField);
		var shrine = buildShrine(scene, group);
		/* a stone apron under the shrine so the car never clips the slope */
		var shrineApron = new THREE.Mesh(
			new THREE.CircleGeometry(WORLD.shrine.radius * 0.82, 36),
			new THREE.MeshStandardMaterial({ color: 0x8c8778, roughness: 0.95 })
		);
		shrineApron.rotation.x = -Math.PI / 2;
		shrineApron.position.set(WORLD.shrine.x, WORLD.shrine.y + 0.035, WORLD.shrine.z);
		shrineApron.receiveShadow = true;
		group.add(shrineApron);

		/* torii at the touge entrance and on the new north ridge */
		var passStart = roads.pass.samples[6];
		group.add(buildTorii(passStart.x + passStart.rx * 8, passStart.y - 0.2, passStart.z + passStart.rz * 8, Math.atan2(passStart.tx, passStart.tz) + Math.PI / 2, 1));
		var northToriiSample = roads.north.samples[Math.floor(roads.north.samples.length * 0.58)];
		group.add(buildTorii(northToriiSample.x + northToriiSample.rx * 10, northToriiSample.y - 0.2, northToriiSample.z + northToriiSample.rz * 10, Math.atan2(northToriiSample.tx, northToriiSample.tz) + Math.PI / 2, 1.1));

		var countryside = buildCountryside(roads, heightField, query, group);
		var ramps = buildRamps(roads, group);

		var gates = buildGates(roads, group);
		var traps = buildTraps(roads, group);
		var driftZones = buildDriftZones(roads, group);
		buildBillboards(roads, group);

		group.add(buildBoats());
		group.add(buildClouds());
		group.add(buildAtmosphere());

		var minimap = buildMinimap(heightField, roads, gates, traps);

		var spawnS = roads.spur.length * 0.56;
		var spawn = roadPoint(roads.spur, spawnS, 0, {});

		var colliders = town.colliders.concat(festival.colliders, shrine.colliders, countryside.colliders);
		/* stage and shrine colliders are already in world coordinates */
		var plazas = [
			{ x: WORLD.festival.x, z: WORLD.festival.z, r: WORLD.festival.radius * 0.97, y: festivalY + 0.05 },
			{ x: WORLD.shrine.x, z: WORLD.shrine.z, r: WORLD.shrine.radius * 0.8, y: shrineY + 0.035 }
		];
		function plazaAt(x, z) {
			var best = null;
			for (var i = 0; i < plazas.length; i++) {
				var p = plazas[i];
				if (Math.hypot(x - p.x, z - p.z) < p.r) {
					if (!best || p.y > best.y) best = p;
				}
			}
			return best;
		}
		function rampAt(x, z) {
			for (var i = 0; i < ramps.length; i++) {
				var r = ramps[i];
				var dx = x - r.x, dz = z - r.z;
				var along = dx * r.fx + dz * r.fz;
				var lat = dx * r.rx + dz * r.rz;
				if (Math.abs(lat) <= r.width / 2 && along >= -r.length / 2 && along <= r.length / 2) {
					var t = (along + r.length / 2) / r.length;
					return { ramp: r, y: r.y + t * r.height, t: t };
				}
			}
			return null;
		}
		var gateColliders = [];
		gates.forEach(function (g) {
			gateColliders.push({ x: g.x, z: g.z, r: 0, y: g.y, type: 'gate', gate: g });
		});

		var world = {
			group: group, roads: roads, heightField: heightField, query: query, index: index,
			size: WORLD.size, half: WORLD.half,
			festival: WORLD.festival, shrine: WORLD.shrine, town: WORLD.town,
			festivalObject: festival, shrineObject: shrine,
			gates: gates, traps: traps, driftZones: driftZones,
			colliders: colliders, minimap: minimap, ramps: ramps, plazas: plazas,
			spawn: { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw },
			heightAt: function (x, z) { return heightField.sample(x, z); },
			plazaAt: plazaAt,
			rampAt: rampAt,
			nearroad: query.query,
			roadPoint: roadPoint,
			sky: skyRig,
			sun: skyRig.sun,
			sunDir: skyRig.sunDir,
			update: function (dt, time, cameraPos) {
				/* sky follows the eye so the dome never clips */
				skyRig.sky.position.copy(cameraPos);
				skyRig.uniforms.uTime.value = time;
				if (skyRig.oceanNormal) {
					skyRig.oceanNormal.offset.x = (time * 0.0032) % 1;
					skyRig.oceanNormal.offset.y = (time * 0.0019) % 1;
				}
				/* gate shimmer */
				for (var i = 0; i < gates.length; i++) {
					var g = gates[i];
					var p = 0.72 + Math.sin(time * 2.4 + i * 1.7) * 0.28;
					if (g.gate.userData.ring) g.gate.userData.ring.material.opacity = 0.5 + p * 0.35;
					if (g.gate.userData.glow) g.gate.userData.glow.material.opacity = 0.05 + p * 0.08;
				}
			}
		};
		return world;
	}

	HZ.World = {
		WORLD: WORLD,
		build: buildWorld,
		roadPoint: roadPoint,
		gateMesh: gateMesh
	};
})(window);
