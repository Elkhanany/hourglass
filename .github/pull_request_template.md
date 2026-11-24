<!--
  One pull request, one release: what the phone gets with one new VERSION (or
  no release: tests and docs only).
  Fill in each part; write "none" where a part does not apply. The checklist
  in docs/architecture.md ("Releasing") has the reasons.
-->

## What changes on the phone

<!-- What someone holding the installed app sees, hears or feels differently. "Nothing" for tests and docs only. -->

## How to try it

<!-- The taps, turns or settings that show it, on an iPhone and in a desktop browser. -->

## Release

- `sw.js` VERSION: before `hourglass-v` → after `hourglass-v`
  <!-- Up whenever a shipped file changes (sw.js or any path of its SHELL); `check-release` holds the branch to it. -->
- `index.html`'s `hourglass-version` meta: equal to VERSION
- Engine build (only if `realsand/` changed): before → after, the same in `realsand/build.mjs`, `realsand/shaders/common.inc.wgsl`, `app.js` (REALSAND_BUILD) and `lab/sand/main.mjs` (BUILD_EXPECTED)
- A file the page loads added, moved or removed: its `<script>` tag, its line in SHELL, its row in `realsand/LICENSES.md` if the table names it

## Suites run

<!-- Each suite and its last line, for example "sim-identity: 12/12 passed". Say which were not run and why. -->

- [ ] `node tools/test/run-all.js check-` (the check group; also run on GitHub for every pull request)
- [ ] the quick Node suites (run on GitHub); the slow ones by hand (`replay-phone`, `sim-conservation`, `sim-fracture`, `sim-shape`, `sim-grain`, `sim-repose`, `sim-tone`, `sim-perf`)
- [ ] the browser suites this change touches, and every `app-*` and `e2e-*` if a shipped file changed
- [ ] `render-regression` and `sim-identity` bit-identical, or the new baseline in its own reviewed commit
- [ ] `realsand-gpu` (only named runs; if `realsand/` changed)

## Docs and licences

- [ ] `README.md` and `docs/` say what changed (the user's guide for what the phone does; the other documents for how)
- [ ] `realsand/LICENSES.md` names every new or moved file under `realsand/` and `lab/sand/` (`check-licences`)

## After the merge, on the phone

For a release (nothing to fill in here): open the installed app online once, close it and open it again. The last line of Tune's Sand tab shows the new version and nothing after the number. Then open it once in airplane mode: it opens and runs.
