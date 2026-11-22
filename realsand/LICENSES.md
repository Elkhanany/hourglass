# Licences of the sand engine

The sand engine (this folder, `realsand/`, used by the sand lab in
`lab/sand/`) is part of the Hourglass project, which is licensed under the
GNU General Public License, version 3 (see `LICENSE` at the root of the
repository). Its solver is derived from two other projects, whose notices are
kept in every file derived from them and whose full texts follow. Both
licences are compatible with the GPL-3.0.

| File | Derived from | Licence of the original |
|---|---|---|
| `solver.mjs` | Smoosh: `src/smoosh.mjs`, `src/gpu.mjs`, `src/layout.mjs`, `src/materials.mjs` | MIT (Smoosh) |
| `shaders/common.inc.wgsl`, `g2p2g.wgsl`, `gridUpdate.wgsl`, `bukkitCount.wgsl`, `bukkitAllocate.wgsl`, `bukkitInsert.wgsl` | EA's PB-MPM shaders, as adapted in Smoosh | BSD-3-Clause (EA) and MIT (Smoosh) |
| `shaders/domain.inc.wgsl`, `rescale.wgsl` | Smoosh: `domain.inc.wgsl`, `rescaleParticles.wgsl` | MIT (Smoosh) |
| `shaders/grains.wgsl` | the idea of Smoosh's `density.wgsl`; EA's particle layout | MIT (Smoosh), BSD-3-Clause (EA) |
| `shaders/prepare.wgsl`, `gridClear.wgsl`, `tally.wgsl`, `load.wgsl`, `spreadSplat.wgsl`, `spreadShift.wgsl`, `flip.wgsl` | new, using the shared include above | GPL-3.0 (with the notices of the include) |
| `shaders/tone.wgsl` | new: layered sand's tone pass; EA's particle layout; its patterns port the app's `Sim._phase` (`physics.js`) | GPL-3.0, with EA's layout (BSD-3-Clause) |
| `glass.mjs`, `palette.mjs` | the Hourglass app (`physics.js`) | GPL-3.0 |
| `pace.mjs`, `build.mjs`, `valve.mjs`, `fill.mjs`, `rate.mjs`, `felt.mjs` | new (the last three taken out of the lab page's `main.mjs`) | GPL-3.0 |
| `modes.mjs` | taken out of the lab's Timer, `lab/sand/timer.mjs` | GPL-3.0 |
| `app-sand.mjs` | new: the app's adapter, after the lab page's frame loop (`main.mjs`) and the app's `Sim` contract (`physics.js`) | GPL-3.0 |
| `boot.mjs` | new: the module the app loads when Real sand is on | GPL-3.0 |
| `layers.mjs` | new: layered sand on the GPU, after the app's own layered sand (`physics.js`: `_style`, `_layer`, `_siftAll`, `_pourLayer`) | GPL-3.0 |
| `grains.mjs` | taken out of the lab page's `main.mjs`; its quad per point follows Smoosh's `density.wgsl` | GPL-3.0, with the idea from MIT (Smoosh) |
| the lab page, `lab/sand/` (`main.mjs`, `index.html`, `lab.css`) | the Hourglass app (`physics.js`, `styles.css`, `motion.js`) | GPL-3.0 |
| the lab's Timer, `lab/sand/timer.mjs` | the Hourglass app (`app.js`: `grainsFor`, `calibrate`, `topAt`, `remAt`, the breathing) | GPL-3.0 |

Sources: Smoosh, <https://github.com/ErikSom/smoosh>; EA's PB-MPM,
<https://github.com/electronicarts/pbmpm>.

## Smoosh: MIT License

```
MIT License

Copyright (c) 2024 Alex Birch & Erik Sombroek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## EA PB-MPM: BSD-3-Clause

```
Copyright (c) 2024 Electronic Arts Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1.  Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2.  Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3.  Neither the name of Electronic Arts, Inc. ("EA") nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
