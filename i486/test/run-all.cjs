'use strict';

/* Runs every i486 test file in this directory and exits non-zero on failure. */

var fs = require('fs');
var path = require('path');
var harness = require('./harness.cjs');

var dir = __dirname;
var files = fs.readdirSync(dir).filter(function (f) {
  return /\.test\.cjs$/.test(f);
}).sort();

if (!files.length) {
  console.error('no *.test.cjs files in ' + dir);
  process.exit(1);
}

files.forEach(function (f) {
  require(path.join(dir, f));
});

var failed = harness.run();
process.exit(failed ? 1 : 0);
