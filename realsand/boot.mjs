/*
 * Hourglass sand engine: the module the app loads when Real sand is on (design 2.2).
 *
 * app.js is a classic script and stays one (an old parser would reject a whole file that held
 * import()), so it cannot import this folder itself. With the Tune switch "Real sand" on, and
 * only then, it appends <script type="module" src="./realsand/boot.mjs">; this module imports
 * the adapter and hands its class and the engine's build stamp to app.js, which checks the
 * stamp against the one it was written for and starts the engine. With the switch off nothing
 * in this folder is requested.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */
import { RealSand, BUILD } from './app-sand.mjs';

const H = globalThis.Hourglass;
if (H && typeof H.attachRealSand === 'function') H.attachRealSand(RealSand, BUILD);
