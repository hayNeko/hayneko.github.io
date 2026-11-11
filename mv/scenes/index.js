'use strict';
const S = {};
const files = ['./a_boot.js','./b_exec.js','./d_geom.js','./e_ladder.js','./f_objects.js','./g_switched.js','./h_fall.js','./h_fall2.js','./i_exec.js','./p_love.js','./p_fix.js','./p_embed2.js'];
for (const f of files) { try { Object.assign(S, require(f)); } catch (e) { if (!/Cannot find module/.test(e.message)) console.error('skip ' + f + ': ' + e.message); } }
module.exports = S;
