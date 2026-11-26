/*
 * Hourglass sand engine: its build stamp.
 *
 * Raised whenever the engine's code changes (a module or a shader in this
 * folder; not for a change in comments alone), so that a page that finds a
 * different stamp from the one it was written for knows it holds a mix of
 * old and new files (a cached page beside a fresh engine, or the reverse).
 * The line "Engine build" in shaders/common.inc.wgsl carries the same stamp, so
 * that the app can tell shaders of another build from its modules' too.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */
export const BUILD = '8';
