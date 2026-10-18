/**
 * views/horizon/car.js — procedural sports coupe.
 *
 * No GLTF: the bodyshell is an extruded silhouette with bevelled edges, then
 * glass, trim, lights and four assembled wheels are bolted on. The result is
 * about 4.4 m long, sits with its origin on the road surface and faces +Z.
 */
(function (global) {
	'use strict';
	var THREE = global.THREE;
	var HZ = global.HZ;

	var PALETTE = [
		{ name: 'EMBER', color: 0xf24b2d, accent: 0x2a2c30 },
		{ name: 'PEARL', color: 0xeee8dc, accent: 0x22252a },
		{ name: 'TIDELINE', color: 0x16b7a4, accent: 0x1a2428 },
		{ name: 'SUNBURST', color: 0xffb02e, accent: 0x2a2926 },
		{ name: 'COBALT', color: 0x2e63d8, accent: 0x20242c },
		{ name: 'WISTERIA', color: 0xa75dff, accent: 0x241f2b },
		{ name: 'GRAPHITE', color: 0x2b3038, accent: 0x16191e }
	];

	function sideWindowGeometry() {
		var shape = new THREE.Shape();
		shape.moveTo(0.92, 0.96);
		shape.lineTo(0.60, 1.25);
		shape.quadraticCurveTo(0.46, 1.33, 0.30, 1.33);
		shape.lineTo(-0.34, 1.33);
		shape.quadraticCurveTo(-0.60, 1.32, -0.74, 1.20);
		shape.lineTo(-1.10, 0.96);
		shape.closePath();
		var geo = new THREE.ShapeGeometry(shape, 8);
		return geo;
	}

	function quadGeo(a, b, c, d) {
		var geo = new THREE.BufferGeometry();
		var pos = new Float32Array([
			a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
			a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]
		]);
		var uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
		geo.computeVertexNormals();
		return geo;
	}

	function buildCar(opts) {
		opts = opts || {};
		var palette = PALETTE[opts.paint || 0] || PALETTE[0];
		var color = opts.color != null ? opts.color : palette.color;
		var root = new THREE.Group();
		root.name = 'car';

		var bodyGroup = new THREE.Group();
		root.add(bodyGroup);

		var paint = new THREE.MeshPhysicalMaterial({
			color: color, metalness: 0.72, roughness: 0.26,
			clearcoat: 1, clearcoatRoughness: 0.14, envMapIntensity: 1.35
		});
		var paintMatte = new THREE.MeshStandardMaterial({ color: 0x17191d, metalness: 0.35, roughness: 0.58 });
		var trim = new THREE.MeshStandardMaterial({ color: 0x0e1013, metalness: 0.5, roughness: 0.42 });
		var chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.22, envMapIntensity: 1.6 });
		var glass = new THREE.MeshPhysicalMaterial({
			color: 0x0a1720, metalness: 0.32, roughness: 0.06, transparent: true, opacity: 0.92,
			side: THREE.DoubleSide, envMapIntensity: 1.7, clearcoat: 1
		});
		var rubber = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.92 });
		var rim = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.95, roughness: 0.25, envMapIntensity: 1.4 });
		var headMat = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xfff0c8, emissiveIntensity: 2.4, roughness: 0.2 });
		var tailMat = new THREE.MeshStandardMaterial({ color: 0xff2a18, emissive: 0xff1a08, emissiveIntensity: 1.7, roughness: 0.3 });
		var amber = new THREE.MeshStandardMaterial({ color: 0xff9a2e, emissive: 0xff7a10, emissiveIntensity: 1.4, roughness: 0.35 });

		/* ---------------- shell ---------------- */
		var s = new THREE.Shape();
		s.moveTo(-2.16, 0.30);
		s.lineTo(-2.24, 0.52);
		s.quadraticCurveTo(-2.24, 0.82, -1.92, 0.86);
		s.lineTo(-1.16, 0.94);
		s.quadraticCurveTo(-0.86, 0.98, -0.72, 1.24);
		s.lineTo(-0.50, 1.34);
		s.lineTo(0.28, 1.36);
		s.lineTo(0.54, 1.30);
		s.quadraticCurveTo(0.76, 1.02, 1.02, 0.96);
		s.lineTo(1.72, 0.87);
		s.quadraticCurveTo(2.12, 0.82, 2.24, 0.58);
		s.lineTo(2.20, 0.33);
		s.lineTo(1.92, 0.25);
		s.lineTo(-1.94, 0.25);
		s.closePath();
		var bodyGeo = new THREE.ExtrudeGeometry(s, {
			depth: 1.84, bevelEnabled: true, bevelSegments: 2,
			bevelSize: 0.055, bevelThickness: 0.055, curveSegments: 10, steps: 1
		});
		bodyGeo.rotateY(-Math.PI / 2);
		bodyGeo.translate(0.92, 0, 0);
		bodyGeo.computeVertexNormals();
		var body = new THREE.Mesh(bodyGeo, paint);
		body.castShadow = true;
		body.receiveShadow = true;
		bodyGroup.add(body);

		/* ---------------- lower trim, splitter, diffuser ---------------- */
		var under = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.16, 3.9), paintMatte);
		under.position.set(0, 0.26, 0); bodyGroup.add(under);
		var splitter = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.06, 0.56), trim);
		splitter.position.set(0, 0.24, 2.08); bodyGroup.add(splitter);
		var diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.14, 0.52), trim);
		diffuser.position.set(0, 0.25, -2.06); bodyGroup.add(diffuser);
		for (var fin = -1; fin <= 1; fin++) {
			var vane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.26), trim);
			vane.position.set(fin * 0.34, 0.28, -2.18); bodyGroup.add(vane);
		}
		var skirtL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 2.5), trim);
		skirtL.position.set(0.965, 0.32, 0); bodyGroup.add(skirtL);
		var skirtR = skirtL.clone(); skirtR.position.x = -0.965; bodyGroup.add(skirtR);

		/* ---------------- glass ---------------- */
		var winGeo = sideWindowGeometry();
		var winL = new THREE.Mesh(winGeo, glass);
		winL.rotation.y = -Math.PI / 2;
		winL.position.set(0.985, 0, 0);
		bodyGroup.add(winL);
		var winR = new THREE.Mesh(winGeo, glass);
		winR.rotation.y = -Math.PI / 2;
		winR.position.set(-0.985, 0, 0);
		bodyGroup.add(winR);

		var wind = new THREE.Mesh(quadGeo(
			[-0.74, 1.00, 1.04], [0.74, 1.00, 1.04],
			[0.58, 1.33, 0.52], [-0.58, 1.33, 0.52]
		), glass);
		bodyGroup.add(wind);
		var rear = new THREE.Mesh(quadGeo(
			[-0.66, 1.31, -0.50], [0.66, 1.31, -0.50],
			[0.78, 0.96, -1.14], [-0.78, 0.96, -1.14]
		), glass);
		bodyGroup.add(rear);

		/* ---------------- roof / pillars ---------------- */
		var roof = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.07, 0.86), paint);
		roof.position.set(0, 1.375, -0.04); bodyGroup.add(roof);
		var roofGlass = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.025, 0.66), glass);
		roofGlass.position.set(0, 1.414, -0.04); bodyGroup.add(roofGlass);

		/* ---------------- wheel arches ---------------- */
		var archGeo = new THREE.TorusGeometry(0.43, 0.055, 6, 20, Math.PI);
		for (var wz = -1; wz <= 1; wz += 2) {
			for (var wx = -1; wx <= 1; wx += 2) {
				var arch = new THREE.Mesh(archGeo, trim);
				arch.rotation.y = Math.PI / 2;
				arch.position.set(wx * 0.918, 0.36, wz * 1.36);
				bodyGroup.add(arch);
			}
		}

		/* ---------------- wing, mirrors, lights ---------------- */
		var wing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.055, 0.34), trim);
		wing.position.set(0, 1.10, -2.03); bodyGroup.add(wing);
		var wingSupportL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.18), trim);
		wingSupportL.position.set(0.62, 1.0, -2.0); bodyGroup.add(wingSupportL);
		var wingSupportR = wingSupportL.clone(); wingSupportR.position.x = -0.62; bodyGroup.add(wingSupportR);

		for (var mx = -1; mx <= 1; mx += 2) {
			var mirror = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.16), paint);
			mirror.position.set(mx * 0.96, 1.03, 0.74);
			mirror.rotation.z = mx * -0.12;
			bodyGroup.add(mirror);
			var stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.06), trim);
			stalk.position.set(mx * 0.86, 0.99, 0.74);
			bodyGroup.add(stalk);
		}

		var headL = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.05), headMat);
		headL.position.set(0.60, 0.73, 2.255); bodyGroup.add(headL);
		var headR = headL.clone(); headR.position.x = -0.60; bodyGroup.add(headR);
		var drl = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.035, 0.04), headMat);
		drl.position.set(0, 0.60, 2.26); bodyGroup.add(drl);
		var tail = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.085, 0.045), tailMat);
		tail.position.set(0, 0.72, -2.265); bodyGroup.add(tail);
		var tailL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.04), tailMat);
		tailL.position.set(0.72, 0.72, -2.262); bodyGroup.add(tailL);
		var tailR = tailL.clone(); tailR.position.x = -0.72; bodyGroup.add(tailR);
		var brakeGlow = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.02), tailMat);
		brakeGlow.position.set(0, 0.86, -2.24); bodyGroup.add(brakeGlow);

		/* grille + vents */
		var grille = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 0.05), trim);
		grille.position.set(0, 0.44, 2.27); bodyGroup.add(grille);
		var vents = [];
		for (var v = 0; v < 3; v++) {
			var vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.03), trim);
			vent.position.set(0, 0.48 + v * 0.04, 2.285);
			bodyGroup.add(vent);
			vents.push(vent);
		}
		var intakeL = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.03), trim);
		intakeL.position.set(0.72, 0.45, 2.27); bodyGroup.add(intakeL);
		var intakeR = intakeL.clone(); intakeR.position.x = -0.72; bodyGroup.add(intakeR);

		/* door seams and handles */
		for (var side = -1; side <= 1; side += 2) {
			var seamA = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.34, 0.012), trim);
			seamA.position.set(side * 0.982, 0.64, 0.58); bodyGroup.add(seamA);
			var seamB = seamA.clone(); seamB.position.z = -0.92; bodyGroup.add(seamB);
			var handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.045, 0.24), chrome);
			handle.position.set(side * 0.993, 0.83, -0.18); bodyGroup.add(handle);
		}
		/* roof antenna */
		var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.016, 0.16, 5), trim);
		antenna.position.set(0, 1.47, -0.52); bodyGroup.add(antenna);

		/* side marker */
		var markerL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.20), amber);
		markerL.position.set(0.963, 0.62, 1.78); bodyGroup.add(markerL);
		var markerR = markerL.clone(); markerR.position.x = -0.963; bodyGroup.add(markerR);

		/* plate */
		var plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.13),
			new THREE.MeshBasicMaterial({ map: HZ.textures.plate('NAGISA'), toneMapped: false }));
		plate.position.set(0, 0.50, -2.272); plate.rotation.y = Math.PI;
		bodyGroup.add(plate);

		/* exhausts */
		for (var ex = -1; ex <= 1; ex += 2) {
			var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10), chrome);
			pipe.rotation.x = Math.PI / 2;
			pipe.position.set(ex * 0.36, 0.29, -2.24);
			bodyGroup.add(pipe);
		}

		/* ---------------- wheels ---------------- */
		var wheels = [];
		var wheelRadius = 0.35;
		for (var iz = -1; iz <= 1; iz += 2) {
			for (var ix = -1; ix <= 1; ix += 2) {
				var isFront = iz === 1;
				var steer = new THREE.Group();
				steer.position.set(ix * 0.90, wheelRadius, iz * 1.36);
				var spin = new THREE.Group();
				steer.add(spin);
				var tire = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.26, 22), rubber);
				tire.rotation.z = Math.PI / 2;
				tire.castShadow = true;
				spin.add(tire);
				var rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.275, 18), rim);
				rimMesh.rotation.z = Math.PI / 2;
				spin.add(rimMesh);
				var spokeGroup = new THREE.Group();
				for (var sp = 0; sp < 5; sp++) {
					var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.20, 0.05), rim);
					spoke.position.set(0, 0.17, 0);
					spokeGroup.add(spoke);
					spoke.rotation.x = sp * Math.PI * 2 / 5;
					/* rotate the spoke around the wheel axis by positioning it on a rotating pivot */
				}
				/* rebuild spokes on pivots for correct geometry */
				spokeGroup.clear();
				for (var sp2 = 0; sp2 < 5; sp2++) {
					var pivot = new THREE.Group();
					pivot.rotation.x = sp2 * Math.PI * 2 / 5;
					var spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.06), rim);
					spoke2.position.y = 0.18;
					pivot.add(spoke2);
					spokeGroup.add(pivot);
				}
				spokeGroup.position.x = ix * 0.06;
				spin.add(spokeGroup);
				var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.30, 10), chrome);
				hub.rotation.z = Math.PI / 2;
				spin.add(hub);
				/* caliper stays with the steering knuckle */
				var caliper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), amber);
				caliper.position.set(ix * 0.02, 0.05, -0.18);
				steer.add(caliper);
				root.add(steer);
				wheels.push({ steer: steer, spin: spin, front: isFront, side: ix });
			}
		}

		root.userData.car = {
			paint: paint, tail: tailMat, head: headMat, wheels: wheels,
			bodyGroup: bodyGroup
		};
		return {
			group: root, bodyGroup: bodyGroup, paint: paint, tailMat: tailMat,
			headMat: headMat, wheels: wheels, palette: palette, wheelRadius: wheelRadius,
			setPaint: function (hex) { paint.color.setHex(hex); }
		};
	}

	/* much simpler car for traffic */
	function buildSimpleCar(color) {
		var root = new THREE.Group();
		var paint = new THREE.MeshStandardMaterial({ color: color, metalness: 0.5, roughness: 0.4 });
		var dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5 });
		var glass = new THREE.MeshStandardMaterial({ color: 0x152a38, metalness: 0.4, roughness: 0.15 });
		var body = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.62, 4.1), paint);
		body.position.y = 0.62; body.castShadow = true; root.add(body);
		var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.52, 1.9), glass);
		cabin.position.set(0, 1.12, -0.12); cabin.castShadow = true; root.add(cabin);
		var roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.7), paint);
		roof.position.set(0, 1.4, -0.12); root.add(roof);
		var wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
		var wheelMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.9 });
		for (var fx = -1; fx <= 1; fx += 2) {
			for (var fz = -1; fz <= 1; fz += 2) {
				var wheel = new THREE.Mesh(wheelGeo, wheelMat);
				wheel.rotation.z = Math.PI / 2;
				wheel.position.set(fx * 0.88, 0.34, fz * 1.32);
				root.add(wheel);
			}
		}
		var tailMat = new THREE.MeshStandardMaterial({ color: 0xff3018, emissive: 0xff2010, emissiveIntensity: 1.2 });
		var tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.04), tailMat);
		tail.position.set(0, 0.72, -2.06); root.add(tail);
		var blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.8),
			new THREE.MeshBasicMaterial({ map: HZ.textures.blob(), transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }));
		blob.rotation.x = -Math.PI / 2; blob.position.y = 0.025; root.add(blob);
		var headMat = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffe8b0, emissiveIntensity: 1.4 });
		for (var hx = -1; hx <= 1; hx += 2) {
			var h = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.04), headMat);
			h.position.set(hx * 0.58, 0.72, 2.06); root.add(h);
		}
		return { group: root, paint: paint, tailMat: tailMat };
	}

	HZ.Car = { build: buildCar, buildSimple: buildSimpleCar, palette: PALETTE };
})(window);
