//-----------------------------------------------------------------------------
// Hourglass sand lab: clear the particle buckets for a substep inside the
// compute pass (Smoosh did this with clearBuffer and copies between passes);
// with sand's spread on, it also clears the sub-cell density grid that the
// substep's spreadSplat fills (spreadClear's work, folded in to save a
// dispatch: nothing touches that grid between here and spreadSplat). Its entry
// point csKeep, after a substep whose beds were summed, also keeps each bed's
// fastest fall from the sums that substep's spreadShift left (bedPeak, below).
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
// [0-7] the beds' sums at the last substep's end (spreadShift.wgsl; 0 at a substep it did not
// sum); then for each bulb's bed ([8-13] the one above the counting line, [14-19] the one on it
// or below), its fastest fall toward the glass's floor (along the grid's -y, the glass's axis,
// whatever the field: a bed the field throws up the glass is not falling) since the solver last
// read these words (solver.mjs run: copied into the readback, then cleared): [+0] its mean
// velocity along -y (cells/s x 4), [+1, +2] its mean velocity, x and y (cells/s x 4; signed, two's
// complement), [+3] its points, [+4] how many of them move, [+5] the frame number of the
// substep after the one it was measured at the end of (0: none)
@group(0) @binding(7) var<storage,read_write> bedPeak: array<u32>;

const PeakAt = 8u;
const PeakWords = 6u;

// the bed of bulb b at the last substep's end: kept if it falls faster than any since the
// words were last read; the sums cleared for this substep's
fn keepPeak(b: u32) {
    let o = b * 4u;
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
            bedPeak[k + 5u] = g_simConstants.simFrame;
        }
        for (var w = 0u; w < 4u; w++) { bedPeak[o + w] = 0u; }
    }
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    clearAll(id.x);
}

// the same, after a substep whose beds spreadShift.wgsl summed (csBeds): its first thread also
// keeps each bed's fastest fall (solver.mjs's prepareKeep pipeline; an entry point of its own,
// so that csMain, every other substep's, is as it was: on a software GPU the keeping alone, in
// the one shader, cost about a tenth of a substep)
@compute @workgroup_size(64)
fn csKeep(@builtin(global_invocation_id) id: vec3u) {
    clearAll(id.x);
    if (id.x == 0u) { keepPeak(0u); keepPeak(1u); }
}

fn clearAll(i: u32) {
    if (i < g_simConstants.bukkitCount) {
        bucketCount[i] = 0u;
        bucketInsertCount[i] = 0u;
    }
    // (dispatched over the whole sub-cell grid only while sand spreads: solver.mjs run)
    let fineCount = (2u * g_simConstants.gridSize.x + 2u) * (2u * g_simConstants.gridSize.y + 2u);
    if (i < fineCount) { fine[i] = 0; }
    if (i == 0u) {
        allocator[0] = 0u;
        bucketArgs[0] = 0u; bucketArgs[1] = 1u; bucketArgs[2] = 1u; bucketArgs[3] = 0u;
        gridArgs[0] = 0u; gridArgs[1] = 1u; gridArgs[2] = 1u; gridArgs[3] = 0u;
    }
}
