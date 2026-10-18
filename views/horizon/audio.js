/**
 * views/horizon/audio.js — Web Audio engine, tyres, wind and HAYNEKO FM.
 *
 * Everything is synthesised: four oscillators and a filter for the engine,
 * looped noise for tyres and wind, and a small look-ahead sequencer for the
 * radio. The context is created on the first user gesture.
 */
(function (global) {
	'use strict';
	var HZ = global.HZ;

	function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

	function createAudio() {
		var ctx = null;
		var master = null, sfx = null, musicBus = null;
		var engine = null, tyre = null, wind = null;
		var noiseBuffer = null;
		var enabled = true;
		var volume = 0.7;
		var musicOn = true;
		var started = false;
		var musicTimer = null;
		var nextNote = 0;
		var step = 0;
		var shiftCut = 0;
		var lastRpm = 0;
		var radio = { chord: 0, bar: 0 };

		function makeNoise() {
			var len = ctx.sampleRate * 2;
			var buf = ctx.createBuffer(1, len, ctx.sampleRate);
			var data = buf.getChannelData(0);
			for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
			return buf;
		}

		function connectGraph() {
			master = ctx.createGain();
			master.gain.value = volume;
			master.connect(ctx.destination);
			sfx = ctx.createGain(); sfx.gain.value = 0.42; sfx.connect(master);
			musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.26 : 0; musicBus.connect(master);

			/* engine */
			engine = { osc1: ctx.createOscillator(), osc2: ctx.createOscillator(), osc3: ctx.createOscillator(), sub: ctx.createOscillator(), filter: ctx.createBiquadFilter(), gain: ctx.createGain() };
			engine.osc1.type = 'sawtooth'; engine.osc2.type = 'sawtooth'; engine.osc3.type = 'square'; engine.sub.type = 'sine';
			engine.filter.type = 'lowpass'; engine.filter.frequency.value = 620; engine.filter.Q.value = 1.1;
			engine.gain.gain.value = 0.0001;
			engine.osc1.connect(engine.filter);
			engine.osc2.connect(engine.filter);
			engine.osc3.connect(engine.filter);
			engine.sub.connect(engine.filter);
			engine.filter.connect(engine.gain);
			engine.gain.connect(sfx);
			engine.osc1.start(); engine.osc2.start(); engine.osc3.start(); engine.sub.start();

			/* tyres */
			noiseBuffer = makeNoise();
			var tsrc = ctx.createBufferSource(); tsrc.buffer = noiseBuffer; tsrc.loop = true;
			var tbp = ctx.createBiquadFilter(); tbp.type = 'bandpass'; tbp.frequency.value = 1800; tbp.Q.value = 6;
			tyre = ctx.createGain(); tyre.gain.value = 0.0001;
			tsrc.connect(tbp); tbp.connect(tyre); tyre.connect(sfx);
			tsrc.start();

			/* wind */
			var wsrc = ctx.createBufferSource(); wsrc.buffer = noiseBuffer; wsrc.loop = true;
			var wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 520;
			wind = ctx.createGain(); wind.gain.value = 0.0001;
			wsrc.connect(wlp); wlp.connect(wind); wind.connect(sfx);
			wsrc.start();

			/* radio delay */
			var delay = ctx.createDelay(0.5);
			delay.delayTime.value = 0.28;
			var fb = ctx.createGain(); fb.gain.value = 0.24;
			var wet = ctx.createGain(); wet.gain.value = 0.25;
			delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(musicBus);
			audio.delay = delay;
		}

		var audio = {
			init: function () {
				if (ctx) return audio;
				var AC = global.AudioContext || global.webkitAudioContext;
				if (!AC) return audio;
				try {
					ctx = new AC();
					connectGraph();
					started = true;
				} catch (e) { console.warn('[horizon] audio unavailable', e); ctx = null; }
				return audio;
			},
			resume: function () {
				if (ctx && ctx.state === 'suspended') ctx.resume();
			},
			setEnabled: function (on) {
				enabled = !!on;
				if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.05);
			},
			setVolume: function (v) {
				volume = HZ.clamp(v, 0, 1);
				if (master && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.08);
			},
			setMusic: function (on) {
				musicOn = !!on;
				if (musicBus && ctx) musicBus.gain.setTargetAtTime(musicOn ? 0.26 : 0, ctx.currentTime, 0.2);
				if (musicOn) startMusic();
			},
			isMusic: function () { return musicOn; },
			playClick: function () {
				if (!ctx || !enabled) return;
				var o = ctx.createOscillator(), g = ctx.createGain();
				o.type = 'triangle'; o.frequency.value = 660;
				g.gain.setValueAtTime(0.0001, ctx.currentTime);
				g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.008);
				g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
				o.connect(g); g.connect(sfx); o.start(); o.stop(ctx.currentTime + 0.14);
			},
			beep: function (freq, dur, gain) {
				if (!ctx || !enabled) return;
				var o = ctx.createOscillator(), g = ctx.createGain();
				o.type = 'sine'; o.frequency.value = freq || 440;
				var t = ctx.currentTime;
				g.gain.setValueAtTime(0.0001, t);
				g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.01);
				g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.15));
				o.connect(g); g.connect(sfx); o.start(); o.stop(t + dur + 0.02);
			},
			countdown: function (n) {
				audio.beep(n === 0 ? 880 : 440 + n * 30, n === 0 ? 0.42 : 0.14, 0.14);
			},
			shift: function (up) {
				if (!ctx || !enabled) return;
				shiftCut = 0.14;
				var o = ctx.createOscillator(), g = ctx.createGain();
				o.type = 'triangle'; o.frequency.setValueAtTime(up ? 130 : 90, ctx.currentTime);
				o.frequency.exponentialRampToValueAtTime(up ? 200 : 60, ctx.currentTime + 0.09);
				g.gain.setValueAtTime(0.0001, ctx.currentTime);
				g.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.006);
				g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
				o.connect(g); g.connect(sfx); o.start(); o.stop(ctx.currentTime + 0.14);
			},
			impact: function (force) {
				if (!ctx || !enabled) return;
				var f = HZ.clamp(force || 0.4, 0.1, 1);
				var o = ctx.createOscillator(), g = ctx.createGain();
				o.type = 'sine'; o.frequency.setValueAtTime(90, ctx.currentTime);
				o.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.3);
				g.gain.setValueAtTime(0.0001, ctx.currentTime);
				g.gain.exponentialRampToValueAtTime(0.16 * f + 0.03, ctx.currentTime + 0.01);
				g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
				o.connect(g); g.connect(sfx); o.start(); o.stop(ctx.currentTime + 0.42);
			},
			skill: function (tier) {
				if (!ctx || !enabled) return;
				var base = 520 + (tier || 0) * 120;
				audio.beep(base, 0.12, 0.09);
				setTimeout(function () { audio.beep(base * 1.25, 0.16, 0.08); }, 90);
			},
			update: function (state) {
				if (!ctx || !enabled) return;
				var now = ctx.currentTime;
				var rpm = state.rpm || 900;
				var throttle = state.throttle || 0;
				var speed = state.speed || 0;
				var slip = state.slip || 0;
				var on = state.running ? 1 : 0;
				var f = 26 + rpm / 60 * 1.55;
				lastRpm = HZ.lerp(lastRpm, f, 0.22);
				engine.osc1.frequency.setTargetAtTime(lastRpm, now, 0.035);
				engine.osc2.frequency.setTargetAtTime(lastRpm * 2.02 + 1.4, now, 0.035);
				engine.osc3.frequency.setTargetAtTime(lastRpm * 0.5, now, 0.05);
				engine.sub.frequency.setTargetAtTime(lastRpm * 0.25, now, 0.06);
				var cut = shiftCut > 0 ? 0.4 : 1;
				shiftCut = Math.max(0, shiftCut - 0.016);
				var filterFreq = (330 + throttle * 1700 + (rpm / 7500) * 1600) * cut;
				engine.filter.frequency.setTargetAtTime(HZ.clamp(filterFreq, 160, 5200), now, 0.04);
				var eg = on * (0.028 + throttle * 0.075 + (rpm / 8000) * 0.03) * cut;
				engine.gain.gain.setTargetAtTime(eg, now, 0.05);

				var tGain = on * HZ.clamp(slip, 0, 1) * 0.14;
				tyre.gain.setTargetAtTime(tGain + 0.0001, now, 0.06);
				var wGain = on * HZ.clamp(speed / 70, 0, 1) * 0.075;
				wind.gain.setTargetAtTime(wGain + 0.0001, now, 0.12);
				if (state.offroad) tyre.gain.setTargetAtTime(on * 0.05, now, 0.08);
			},
			setRadioName: function (name) { radio.name = name; },
			dispose: function () {
				if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
				if (ctx) {
					try { ctx.close(); } catch (e) { /* ignore */ }
					ctx = null;
				}
			},
			get context() { return ctx; }
		};

		/* ------------------------------------------------------------ radio sequencer */
		var CHORDS = [
			{ root: 45, notes: [57, 60, 64], arp: [69, 72, 76, 72] },
			{ root: 41, notes: [53, 57, 60], arp: [65, 69, 72, 69] },
			{ root: 48, notes: [48, 52, 55], arp: [60, 64, 67, 64] },
			{ root: 43, notes: [55, 59, 62], arp: [67, 71, 74, 71] }
		];
		var BPM = 104;
		var stepDur = 60 / BPM / 4;

		function startMusic() {
			if (!ctx || !musicOn) return;
			if (musicTimer) return;
			nextNote = ctx.currentTime + 0.12;
			step = 0;
			musicTimer = setInterval(schedule, 26);
		}

		function schedule() {
			if (!ctx || !musicOn) { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } return; }
			while (nextNote < ctx.currentTime + 0.18) {
				playStep(step, nextNote, stepDur);
				nextNote += stepDur;
				step = (step + 1) % 64;
			}
		}

		function playStep(s, t, dur) {
			var bar = Math.floor(s / 16) % 4;
			var inBar = s % 16;
			var chord = CHORDS[bar];
			/* kick */
			if (inBar % 4 === 0) {
				var k = ctx.createOscillator(), kg = ctx.createGain();
				k.type = 'sine';
				k.frequency.setValueAtTime(120, t);
				k.frequency.exponentialRampToValueAtTime(44, t + 0.16);
				kg.gain.setValueAtTime(0.0001, t);
				kg.gain.exponentialRampToValueAtTime(0.32, t + 0.008);
				kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.23);
				k.connect(kg); kg.connect(musicBus); k.start(t); k.stop(t + 0.25);
			}
			/* snare */
			if (inBar === 4 || inBar === 12) {
				var sn = ctx.createBufferSource(), sg = ctx.createGain(), sf = ctx.createBiquadFilter();
				sn.buffer = noiseBuffer; sf.type = 'highpass'; sf.frequency.value = 1400;
				sg.gain.setValueAtTime(0.0001, t);
				sg.gain.exponentialRampToValueAtTime(0.10, t + 0.005);
				sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
				sn.connect(sf); sf.connect(sg); sg.connect(musicBus); sn.start(t); sn.stop(t + 0.16);
			}
			/* hat */
			if (inBar % 2 === 0) {
				var hn = ctx.createBufferSource(), hg = ctx.createGain(), hf = ctx.createBiquadFilter();
				hn.buffer = noiseBuffer; hf.type = 'highpass'; hf.frequency.value = 7200;
				hg.gain.setValueAtTime(0.0001, t);
				hg.gain.exponentialRampToValueAtTime(0.028, t + 0.002);
				hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
				hn.connect(hf); hf.connect(hg); hg.connect(musicBus); hn.start(t); hn.stop(t + 0.05);
			}
			/* bass */
			if (inBar % 4 === 0) {
				var b = ctx.createOscillator(), bg = ctx.createGain(), bf = ctx.createBiquadFilter();
				b.type = 'sawtooth'; b.frequency.value = midi(chord.root - 12);
				bf.type = 'lowpass'; bf.frequency.setValueAtTime(420, t); bf.frequency.exponentialRampToValueAtTime(120, t + 0.3);
				bg.gain.setValueAtTime(0.0001, t);
				bg.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
				bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
				b.connect(bf); bf.connect(bg); bg.connect(musicBus); b.start(t); b.stop(t + 0.44);
			}
			/* pad at the top of each bar */
			if (inBar === 0) {
				for (var n = 0; n < chord.notes.length; n++) {
					var p = ctx.createOscillator(), pg = ctx.createGain(), pf = ctx.createBiquadFilter();
					p.type = 'sawtooth'; p.frequency.value = midi(chord.notes[n]);
					p.detune.value = (n - 1) * 7;
					pf.type = 'lowpass'; pf.frequency.value = 1500;
					pg.gain.setValueAtTime(0.0001, t);
					pg.gain.linearRampToValueAtTime(0.018, t + 0.4);
					pg.gain.setValueAtTime(0.018, t + dur * 13);
					pg.gain.linearRampToValueAtTime(0.0001, t + dur * 16);
					p.connect(pf); pf.connect(pg); pg.connect(musicBus); p.start(t); p.stop(t + dur * 16 + 0.05);
				}
			}
			/* arpeggio */
			if (inBar % 2 === 0) {
				var a = ctx.createOscillator(), ag = ctx.createGain(), af = ctx.createBiquadFilter();
				var note = chord.arp[(inBar / 2) % 4] + 12;
				a.type = 'square'; a.frequency.value = midi(note);
				af.type = 'lowpass'; af.frequency.value = 2400;
				ag.gain.setValueAtTime(0.0001, t);
				ag.gain.exponentialRampToValueAtTime(0.022, t + 0.006);
				ag.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
				a.connect(af); af.connect(ag); ag.connect(musicBus); ag.connect(audio.delay || musicBus);
				a.start(t); a.stop(t + 0.13);
			}
		}

		return audio;
	}

	HZ.Audio = { create: createAudio };
})(window);
