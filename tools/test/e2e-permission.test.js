/*
 * Integration E12: the five permission cases of the controller's acceptance
 * test 1 (app-permission.test.js), run against the tree's real motion.js
 * instead of the motion stub. Device events come from window.__drive.
 *
 *   node tools/test/e2e-permission.test.js [--root <dir>] [--port <n>]
 */
'use strict';
if (process.argv.indexOf('--real') < 0) process.argv.push('--real');
require('./app-permission.test.js');
