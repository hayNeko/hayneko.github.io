'use strict';

/* Minimal zero-dependency suite runner shared by every i486 module test. */

var state = { suites: [], current: null, failed: 0, passed: 0, errors: [] };

function suite(name, body) {
  var prev = state.current;
  state.current = { name: name, tests: [] };
  state.suites.push(state.current);
  try {
    body();
  } finally {
    state.current = prev;
  }
}

function test(name, body) {
  if (!state.current) throw new Error('test() outside suite(): ' + name);
  state.current.tests.push({ name: name, body: body });
}

function fail(message) {
  var err = new Error(message);
  err.isAssertion = true;
  throw err;
}

function assert(cond, message) {
  if (!cond) fail(message || 'assertion failed');
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    fail((message ? message + ': ' : '') + 'expected ' + fmt(expected) + ', got ' + fmt(actual));
  }
}

function neq(actual, unexpected, message) {
  if (actual === unexpected) {
    fail((message ? message + ': ' : '') + 'expected not ' + fmt(unexpected));
  }
}

function near(actual, expected, tolerance, message) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    fail((message ? message + ': ' : '') + 'expected ~' + expected + ' +/-' + tolerance + ', got ' + actual);
  }
}

function hex(n, width) {
  var s = (n >>> 0).toString(16).toUpperCase();
  while (width && s.length < width) s = '0' + s;
  return s;
}

function toArray(bytes) {
  if (bytes == null) return [];
  if (Array.isArray(bytes)) return bytes.slice();
  return Array.prototype.slice.call(bytes);
}

function bytes(actual, expected, message) {
  var a = toArray(actual),
      e = toArray(expected),
      i;
  if (a.length !== e.length) {
    fail((message ? message + ': ' : '') + 'length ' + a.length + ' != ' + e.length + ' (got ' + dump(a) + ')');
  }
  for (i = 0; i < a.length; i++) {
    if ((a[i] & 0xFF) !== (e[i] & 0xFF)) {
      fail((message ? message + ': ' : '') + 'byte ' + i + ' expected ' + hex(e[i], 2) + ' got ' + hex(a[i], 2) + ' [' + dump(a) + ']');
    }
  }
}

function dump(list) {
  var out = [], i;
  for (i = 0; i < list.length; i++) out.push(hex(list[i], 2));
  return out.join(' ');
}

function fmt(value) {
  if (typeof value === 'number') return '0x' + hex(value) + ' (' + value + ')';
  if (value instanceof Uint8Array) return '[' + dump(toArray(value)) + ']';
  if (typeof value === 'function') return 'function';
  try { return JSON.stringify(value); } catch (e) { return String(value); }
}

function throws(fn, message) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) fail(message || 'expected an exception');
}

function run() {
  var i, j, s, t, failed = 0, passed = 0, lines = [];
  for (i = 0; i < state.suites.length; i++) {
    s = state.suites[i];
    for (j = 0; j < s.tests.length; j++) {
      t = s.tests[j];
      try {
        t.body();
        passed++;
        if (process.env.I486_VERBOSE) lines.push('  ok   ' + s.name + ' / ' + t.name);
      } catch (err) {
        failed++;
        lines.push('  FAIL ' + s.name + ' / ' + t.name);
        lines.push('       ' + (err && err.message ? err.message : String(err)));
        if (err && err.stack && !err.isAssertion) {
          lines.push(String(err.stack).split('\n').slice(1, 4).join('\n'));
        }
      }
    }
  }
  state.passed = passed;
  state.failed = failed;
  console.log(lines.join('\n'));
  console.log((failed ? 'FAIL ' : 'PASS ') + passed + ' passed, ' + failed + ' failed, ' + state.suites.length + ' suites');
  return failed;
}

function reset() {
  state = { suites: [], current: null, failed: 0, passed: 0, errors: [] };
}

module.exports = {
  suite: suite,
  test: test,
  assert: assert,
  eq: eq,
  neq: neq,
  near: near,
  bytes: bytes,
  hex: hex,
  throws: throws,
  run: run,
  reset: reset,
  stats: function () { return { passed: state.passed, failed: state.failed, suites: state.suites.length }; }
};
