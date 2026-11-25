//-----------------------------------------------------------------------------
// Hourglass sand lab: clear the particle buckets for a substep inside the
// compute pass (Smoosh did this with clearBuffer and copies between passes);
// with sand's spread on, it also clears the sub-cell density grid that the
// substep's spreadSplat fills (spreadClear's work, folded in to save a
// dispatch: nothing touches that grid between here and spreadSplat). Its entry
// point csKeep, once after a run whose beds were summed, keeps each bed's
// fastest fall from the sums spreadShift left (bedPeak, below).
// Uses the shared include derived from EA pbmpm / Smoosh: see ../LICENSES.md.
// Part of the Hourglass project (GPL-3.0).
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage,read_write> bucketCount: array<u32>;
@group(0) @binding(2) var<storage,read_write> bucketInsertCount: array<u32>;
@group(0) @binding(3) var<storage,read_write> allocator: array<u32>;
@group(0) @binding(4) var<storage,read_write> bucketArgs: array<u32>;
@group(0) @binding(5) var<storage,read_write> gridArgs: array<u32>;
@group(0) @binding(6) var<storage,read_write> fine: array<i32>;
// the beds' sums (spreadShift.wgsl csBeds), 8 words for each substep that summed them, in slots
// [0, PeakSlots): slot j holds the substep BedsEvery (j + 1) before the run's last; then for each
// bulb's bed ([PeakAt, +6) the one above the counting line, [PeakAt + 6, +6) the one on it or below),
// its fastest fall toward the glass's floor (along the grid's -y, the glass's axis, whatever the
// field: a bed the field throws up the glass is not falling) since the solver last read these
// words (solver.mjs run: copied into the readback, then cleared): [+0] its mean velocity along -y
// (cells/s x 4), [+1, +2] its mean velocity, x and y (cells/s x 4; signed, two's complement), [+3]
// its points, [+4] how many of them move, [+5] the frame number of the substep after the one it
// was measured at the end of (0: none)
@group(0) @binding(7) var<storage,read_write> bedPeak: array<u32>;

// as solver.mjs's PEAK_SLOTS, BEDS_EVERY
const PeakSlots = 48u;
const BedsEvery = 2u;
const PeakAt = PeakSlots * 8u;
const PeakWords = 6u;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < g_simConstants.bukkitCount) {
        bucketCount[id.x] = 0u;
        bucketInsertCount[id.x] = 0u;
    }
    // (dispatched over the whole sub-cell grid only while sand spreads: solver.mjs run)
    let fineCount = (2u * g_simConstants.gridSize.x + 2u) * (2u * g_simConstants.gridSize.y + 2u);
    if (id.x < fineCount) { fine[id.x] = 0; }
    if (id.x == 0u) {
        allocator[0] = 0u;
        bucketArgs[0] = 0u; bucketArgs[1] = 1u; bucketArgs[2] = 1u; bucketArgs[3] = 0u;
        gridArgs[0] = 0u; gridArgs[1] = 1u; gridArgs[2] = 1u; gridArgs[3] = 0u;
    }
}

// once a run in which the beds were summed, after its last substep (solver.mjs's prepareKeep
// pipeline, one workgroup, the last substep's uniforms: compaction.w, the slots used): each bed's
// fastest fall over those substeps is kept if it falls faster than any since the words were last
// read, and the sums are cleared. (An entry point of its own, dispatched once a run: kept at every
// substep inside prepare's csMain, this alone cost about an eighth of a substep on a software GPU.)
@compute @workgroup_size(64)
fn csKeep(@builtin(local_invocation_index) li: u32) {
    if (li != 0u) { return; }
    let slots = min(u32(g_simConstants.compaction.w + 0.5), PeakSlots);
    for (var j = 0u; j < slots; j++) {
        // (the frame number of the substep after the one slot j was summed at the end of)
        let frame = g_simConstants.simFrame + 1u - BedsEvery * (j + 1u);
        keepPeak(j * 8u, 0u, frame); keepPeak(j * 8u + 4u, 1u, frame);
    }
}

// bulb b's bed in the sums at o: kept if it falls faster than any since the words were last read;
// the sums cleared
fn keepPeak(o: u32, b: u32, frame: u32) {
    let n = bedPeak[o + 2u];
    if (n > 0u) {
        let vy = f32(bitcast<i32>(bedPeak[o + 1u])) / f32(n);
        let uq = u32(max(-vy, 0.0));
        let k = PeakAt + b * PeakWords;
        if (uq > bedPeak[k]) {
            bedPeak[k] = uq;
            bedPeak[k + 1u] = bitcast<u32>(i32(round(f32(bitcast<i32>(bedPeak[o])) / f32(n))));
            bedPeak[k + 2u] = bitcast<u32>(i32(round(vy)));
            bedPeak[k + 3u] = n;
            bedPeak[k + 4u] = bedPeak[o + 3u];
            bedPeak[k + 5u] = frame;
        }
        for (var w = 0u; w < 4u; w++) { bedPeak[o + w] = 0u; }
    }
}
