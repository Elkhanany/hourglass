//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
// (BSD-3-Clause, see ../LICENSES.md)
// Smoosh adaptation: Copyright (c) 2024 Alex Birch & Erik Sombroek (MIT, see ../LICENSES.md)
// Hourglass sand lab changes (GPL-3.0 project): the rigid bodies, emitters,
// drains and mouse are gone; gravity along -y became the glass-frame body
// force (bodyForce in common.inc); a particle at the glass wall keeps Coulomb
// friction; particles are never deleted, only put back inside the glass; a
// closed neck holds the top bulb's sand; sand measures how tightly it is
// packed from the grid, so that loose sand packs back down under load
// (EA's per-particle expansion memory is replaced by that measure): the mean
// over the filled nodes around it, not the densest node; the metered neck's
// membrane: a point crosses the counting line only downward, and only with a
// ticket.
//-----------------------------------------------------------------------------

//!include common.inc
//!include domain.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage, read_write> g_particles : array<Particle>;
@group(0) @binding(2) var<storage> g_gridSrc : array<i32>;
@group(0) @binding(3) var<storage, read_write> g_gridDst : array<atomic<i32>>;
@group(0) @binding(4) var<storage> g_bucketData : array<u32>;
@group(0) @binding(5) var<storage> g_domain : array<vec4f>;
// per grid node, x: the depth of sand above it along "up", cells (load.wgsl; read with yieldp.z
// = 2); y, z: the surface push, cells/s^2 (gridClear.wgsl; read with surf.x = 1); w: its memory
@group(0) @binding(6) var<storage> g_load : array<vec4f>;
// the neck's counters (solver.mjs): [2] crossings this run (tickets taken), [3] the points above
// at the run's start, [4] crossings refused this run, [5] upward crossings refused this run
@group(0) @binding(7) var<storage, read_write> g_counters : array<atomic<u32>>;

override enableSolidMaterials: bool = false;

const TotalBukkitEdgeLength = BukkitSize + BukkitHaloSize*2;
const TileDataSize = TotalBukkitEdgeLength * TotalBukkitEdgeLength * 4;
var<workgroup> s_tileData: array<atomic<i32>, TileDataSize>;
// zero-initialised by the WebGPU spec
var<workgroup> s_tileDataDst: array<atomic<i32>, TileDataSize>;

fn localGridIndex(index: vec2u) -> u32
{
    return (index.y * TotalBukkitEdgeLength + index.x)*4;
}

// Put a particle back inside the glass, with Coulomb friction against the wall.
fn wallContact(particle: ptr<function, Particle>)
{
    let boundary = sampleDomain((*particle).position);
    if (boundary.z < 0.25) {
        let n = safeNormal(boundary.xy);
        (*particle).position += n * (0.25 - boundary.z);
        var d = (*particle).displacement;
        let dn = dot(d, n);
        if (dn < 0.0) {
            d -= dn * n;
            let t = d - dot(d, n) * n;
            let tl = length(t);
            let limit = g_simConstants.wallFriction * (-dn);
            d -= t * min(1.0, limit / max(tl, 1e-9));
        }
        d -= (d - dot(d, n) * n) * g_simConstants.wallDrag;
        (*particle).displacement = d;
    }
    // the closed neck: a floor across it for the sand above
    if (g_simConstants.gate.x > 0.5) {
        let p = (*particle).position;
        if (abs(p.x - g_simConstants.center.x) < g_simConstants.gate.y + 3.0 &&
            p.y < g_simConstants.neckY + 0.5 && p.y > g_simConstants.neckY - 4.0) {
            (*particle).position.y = g_simConstants.neckY + 0.5;
            (*particle).displacement.y = max((*particle).displacement.y, 0.0);
        }
    }
}

// The metered neck's membrane (valve.mjs), after the last iteration's integration: oldY is the
// point's height before it, the point is where it ended. A downward crossing of the counting line
// takes a ticket, t = crossings so far this run; it may cross only while t < (the points above at
// the run's start) + allow, so the sand above never falls below the substep's target. Refused, it
// gives its ticket back (between dispatches the crossings are exact; inside one a refused thread
// can over-count for a moment, which refuses more, never fewer) and rests just above the line.
// An upward crossing is refused.
fn membrane(particle: ptr<function, Particle>, oldY: f32)
{
    let line = g_simConstants.neckY;
    let y = (*particle).position.y;
    if (oldY > line && y <= line) {
        let t = i32(atomicAdd(&g_counters[2], 1u));
        if (t >= i32(atomicLoad(&g_counters[3])) + i32(floor(g_simConstants.allow))) {
            atomicSub(&g_counters[2], 1u);
            atomicAdd(&g_counters[4], 1u);
            (*particle).position.y = line + 0.02;
            (*particle).displacement.y = max((*particle).displacement.y, 0.0);
        } else {
            // the substep of the run's last crossing (its simFrame + 1): when the last grain left
            atomicMax(&g_counters[6], g_simConstants.simFrame + 1u);
        }
    } else if (oldY <= line && y > line) {
        atomicAdd(&g_counters[5], 1u);
        (*particle).position.y = line - 0.02;
        (*particle).displacement.y = min((*particle).displacement.y, 0.0);
    }
}

@compute @workgroup_size(ParticleDispatchSize)
fn csMain( @builtin(local_invocation_index) indexInGroup: u32, @builtin(workgroup_id) groupId: vec3<u32> )
{
    let header = groupId.x * 4u;
    let threadData = BukkitThreadData(g_bucketData[header], g_bucketData[header+1u], g_bucketData[header+2u], g_bucketData[header+3u]);

    // Load grid
    let localGridOrigin = BukkitSize*vec2i(vec2u(threadData.bukkitX, threadData.bukkitY)) - vec2i(BukkitHaloSize);
    let idInGroup = vec2i(i32(indexInGroup) % TotalBukkitEdgeLength, i32(indexInGroup) / TotalBukkitEdgeLength);
    let gridVertex = idInGroup + localGridOrigin;

    let gridVertexIsValid = all(gridVertex >= vec2i(0)) && all(gridVertex < vec2i(g_simConstants.gridSize)) && indexInGroup < u32(TotalBukkitEdgeLength*TotalBukkitEdgeLength);
    var gridValues = vec4i(0);
    if (gridVertexIsValid) {
        let address = gridVertexIndex(vec2u(gridVertex), g_simConstants.gridSize);
        gridValues = vec4i(g_gridSrc[address],g_gridSrc[address+1],g_gridSrc[address+2],g_gridSrc[address+3]);
    }
    let tileDataIndex = localGridIndex(vec2u(idInGroup));
    if (indexInGroup < u32(TotalBukkitEdgeLength*TotalBukkitEdgeLength)) {
        atomicStore(&s_tileData[tileDataIndex],gridValues.x);
        atomicStore(&s_tileData[tileDataIndex+1],gridValues.y);
        atomicStore(&s_tileData[tileDataIndex+2],gridValues.z);
        atomicStore(&s_tileData[tileDataIndex+3],gridValues.w);
    }

    workgroupBarrier();

    if(indexInGroup < threadData.rangeCount)
    {
        // Load Particle
        let myParticleIndex = g_bucketData[g_simConstants.bucketParticleOffset + threadData.rangeStart + indexInGroup];
        var particle = g_particles[myParticleIndex];
        let materialParams = g_simConstants.material;

        var p = particle.position;
        let weightInfo = quadraticWeightInit(p);

        if(g_simConstants.iteration != 0)
        {
            // G2P
            var B = ZeroMatrix;
            var d = vec2f(0);
            var volume = 0.0;
            // sand: how tightly the sand around the particle is packed (1: the fill's packing): the
            // grid's volume, weighted, over the nodes the sand fills (wFilled: their share of the weights)
            var packing = 0.0;
            var wFilled = 0.0;
            for(var i = 0; i < 3; i++)
            {
                for(var j = 0; j < 3; j++)
                {
                    let weight = weightInfo.weights[i].x * weightInfo.weights[j].y;
                    let neighbourCellIndex = vec2i(weightInfo.cellIndex) + vec2i(i,j);
                    let neighbourCellIndexLocal = neighbourCellIndex - localGridOrigin;
                    let gridVertexIdx = localGridIndex(vec2u(neighbourCellIndexLocal));

                    let weightedDisplacement = weight * vec2f(
                        decodeFixedPoint(atomicLoad(&s_tileData[gridVertexIdx + 0]), g_simConstants.fixedPointMultiplier),
                        decodeFixedPoint(atomicLoad(&s_tileData[gridVertexIdx + 1]), g_simConstants.fixedPointMultiplier)
                    );

                    let offset = vec2f(neighbourCellIndex) - p + 0.5;
                    B += outerProduct(weightedDisplacement, offset);
                    d += weightedDisplacement;

                    if(g_simConstants.useGridVolumeForLiquid != 0)
                    {
                        let nodeVolume = decodeFixedPoint(atomicLoad(&s_tileData[gridVertexIdx + 3]), g_simConstants.fixedPointMultiplier);
                        volume += weight * nodeVolume;
                        if (nodeVolume > 0.25) { wFilled += weight; }
                    }
                }
            }

            if(g_simConstants.useGridVolumeForLiquid != 0)
            {
                packing = volume / max(wFilled, 0.05);
                // drawing only (grains.wgsl's motion blur): how crowded the point is, the grid's
                // volume weighted over the nodes around it: high inside a bed, lower at its
                // surface, near 0 for a grain in flight
                particle.color.y = volume;
            }
            // Recover an objective measure of a liquid's volume from the grid, when compressed.
            if(g_simConstants.useGridVolumeForLiquid != 0)
            {
                volume = 1.0/volume;
                if(volume < 1)
                {
                    particle.liquidDensity = mix(particle.liquidDensity, volume, 0.1);
                }
            }

            particle.deformationDisplacement = B * 4.0;
            particle.displacement = d;

            // Do integration
            if(g_simConstants.iteration == g_simConstants.iterationCount -1)
            {
                if(particle.material == MaterialLiquid)
                {
                    // det(F^n+1) = (1+tr(D))*det(F^n), to first order
                    particle.liquidDensity *= (tr(particle.deformationDisplacement) + 1.0);
                    particle.liquidDensity = max(particle.liquidDensity, 0.05);
                }
                else if (enableSolidMaterials)
                {
                    particle.deformationGradient = (Identity + particle.deformationDisplacement) * particle.deformationGradient;
                }

                if(enableSolidMaterials && particle.material != MaterialLiquid)
                {
                    var svdResult = svd(particle.deformationGradient);

                    // Clamp the lower bound of scale to prevent explosions
                    svdResult.Sigma = clamp(svdResult.Sigma, vec2f(0.1), vec2f(10000.0));

                    if(particle.material == MaterialSand)
                    {
                        // Drucker-Prager sand based on:
                        // Gergely Klár, Theodore Gast, Andre Pradhana, Chuyuan Fu, Craig Schroeder, Chenfanfu Jiang, and Joseph Teran. 2016.
                        // Drucker-prager elastoplasticity for sand animation. ACM Trans. Graph. 35, 4, Article 103 (July 2016), 12 pages.
                        // https://doi.org/10.1145/2897824.2925906
                        let sinPhi = sin(materialParams.physical.x/180.0 * 3.14159);
                        let alpha = sqrt(2.0/3.0)*2.0*sinPhi/(3.0 - sinPhi);
                        // How loose the sand is (log of its volume over its rest volume, >= 0), measured on
                        // the grid: the weighted mean packing of the nodes around the particle that the sand
                        // fills. (Nodes outside the sand, at a free surface or a wall, are left out, or they
                        // would make dense sand look loose. The densest node, used before, read a bed 3 to 5 %
                        // looser than its fill as packed, because the most of nine noisy nodes reads high, so
                        // the bed swelled 6.5 % at rest, 14 % at real speed, and never packed back.) EA kept a per-particle memory of
                        // expansion instead (logJp = beta * trace); in this solver that memory decayed
                        // within a few substeps, while the over-relaxed constraint below kept pushing points
                        // apart, so a bed swelled at rest and never packed back down.
                        // rest packing: mechanical.y for sand (1: as filled)
                        let restPacking = materialParams.mechanical.y;
                        // this point's own packing (padding; 0 until it changes: the material's), which
                        // shaking raises (below)
                        let phi0 = select(restPacking, particle.padding, particle.padding > 0.0);
                        let loose = select(0.0, clamp(log(phi0 / max(packing, 1e-3)), 0.0, 1.5), g_simConstants.useGridVolumeForLiquid != 0);
                        var gammaP = 0.0;

                        let eDiag = log(max(abs(svdResult.Sigma), vec2f(1e-6)));
                        // compression up to the looseness only fills voids: it is plastic and costs nothing
                        let trace = eDiag.x + eDiag.y + loose;

                        if(trace >= 0.0)
                        {
                            // expansion, or compaction of loose sand: no resistance; forget the deformation
                            svdResult.Sigma = vec2f(1);
                        }
                        else
                        {
                            // the compression beyond what the voids took is elastic
                            let e2 = eDiag + vec2f(0.5 * loose);
                            let eHat = e2 - vec2f(trace * 0.5);
                            let frobNrm = length(eHat);
                            // (d lambda + 2 mu) / (2 mu) of Klar et al.: EA used elasticityRatio + 1;
                            // the lab sets it from Poisson's ratio (mechanical.w for sand)
                            let coneK = select(materialParams.mechanical.z + 1.0, materialParams.mechanical.w, materialParams.mechanical.w > 0.0);
                            let deltaGammaI = frobNrm + coneK * trace * alpha;
                            if(deltaGammaI > 0)
                            {
                                gammaP = deltaGammaI;
                                // Project to cone surface.
                                svdResult.Sigma = exp(e2 - deltaGammaI/max(frobNrm, 0.000001) * eHat);
                            }
                            else
                            {
                                svdResult.Sigma = exp(e2);
                            }
                        }
                        // carried to the next substep's constraint: loose sand may be compressed this far
                        particle.logJp = loose;
                        // Tapping or shaking packs sand tighter, and it stays packed: each time a point is
                        // packed down again from a loosened state (looser than 2 %), its own packing gains a
                        // share of the room left to the densest packing, in proportion to the compaction
                        // taken; plastic shear loosens it back toward the fill's packing (Reynolds dilatancy).
                        let cmp = g_simConstants.compaction;
                        if (cmp.x > 0.0) {
                            let taken = min(max(0.0, -(eDiag.x + eDiag.y)), loose);
                            var phi = phi0;
                            if (loose > 0.02) { phi += cmp.x * taken * (cmp.y - phi); }
                            phi -= cmp.z * gammaP * max(phi - restPacking, 0.0);
                            particle.padding = clamp(phi, restPacking, max(cmp.y, restPacking));
                        }
                    }
                    else if(particle.material == MaterialVisco)
                    {
                        let yieldSurface = exp(1-materialParams.mechanical.w);
                        let J = svdResult.Sigma.x*svdResult.Sigma.y;
                        svdResult.Sigma = clamp(svdResult.Sigma, vec2f(1.0/yieldSurface), vec2f(yieldSurface));
                        let newJ = svdResult.Sigma.x*svdResult.Sigma.y;
                        svdResult.Sigma *= sqrt(J/newJ);
                    }

                    particle.deformationGradient = svdResult.U * diag(svdResult.Sigma) * svdResult.Vt;
                }

                // Integrate position
                particle.position += particle.displacement;
                particle.position = projectInsideGuardian(particle.position, g_simConstants.gridSize, f32(GuardianSize) + 1.0);
                wallContact(&particle);
                // (p: the position before this integration; every move above is metered at once)
                if (neckOn()) { membrane(&particle, p.y); }

                // The next substep's prediction: the field the sand feels in the glass, and on an
                // over-steep free surface the push down it (gridClear.wgsl), from the nodes around
                // the point before this integration (the push changes no crossing: the membrane
                // has acted).
                let dt = g_simConstants.deltaTime;
                var push = vec2f(0.0);
                if (g_simConstants.surf.x > 0.5 && (g_simConstants.surf.x < 1.5 || g_simConstants.surf.x > 2.5) && particle.material == MaterialSand) {
                    for (var i = 0; i < 3; i++) {
                        for (var j = 0; j < 3; j++) {
                            let c = vec2u(vec2i(weightInfo.cellIndex) + vec2i(i, j));
                            push += weightInfo.weights[i].x * weightInfo.weights[j].y * g_load[c.y * g_simConstants.gridSize.x + c.x].yz;
                        }
                    }
                }
                particle.displacement += (bodyForce(particle.position, particle.displacement / dt) + push) * dt * dt;

                g_particles[myParticleIndex] = particle;
            } else if (g_simConstants.useGridVolumeForLiquid != 0) {
                g_particles[myParticleIndex].liquidDensity = particle.liquidDensity;
            }
        }

        // Particle update
        if(particle.material == MaterialLiquid)
        {
            // Simple liquid viscosity: remove the deviatoric part of the deformation displacement
            let deviatoric = -1.0*(particle.deformationDisplacement + transpose(particle.deformationDisplacement));
            particle.deformationDisplacement += materialParams.mechanical.x*0.5*deviatoric;

            // Volume preservation constraint
            let alpha = 0.5*(1.0/particle.liquidDensity - tr(particle.deformationDisplacement) - 1.0);
            particle.deformationDisplacement += materialParams.mechanical.y*alpha*Identity;
        }
        else if(enableSolidMaterials && (particle.material == MaterialElastic || particle.material == MaterialVisco))
        {
            let F =  (Identity + particle.deformationDisplacement) * particle.deformationGradient;
            var svdResult = svd(F);
            let df = det(F);
            let cdf = clamp(abs(df), 0.1, 1000);
            let Q = (1.0f/(select(-1.0, 1.0, df >= 0.0)*sqrt(cdf)))*F;
            let alpha = materialParams.mechanical.z;
            let tgt = alpha*(svdResult.U*svdResult.Vt) + (1.0-alpha)*Q;
            let diff = (tgt*inverse(particle.deformationGradient) - Identity) - particle.deformationDisplacement;
            particle.deformationDisplacement += materialParams.physical.z*diff;
        }
        else if(enableSolidMaterials && particle.material == MaterialSand)
        {
            let F =  (Identity + particle.deformationDisplacement) * particle.deformationGradient;
            var svdResult = svd(F);

            // Resist compression. EA resisted none while the particle remembered an expansion,
            // so loose sand fell freely until it was packed again, and in this solver the bed
            // then bounced in place. Here loose sand is resisted too (floorLoose = 0) and packs down
            // only as fast as its load gets through this constraint; the return map keeps that
            // compaction instead of pushing it back. (floorLoose = 1: loose sand may be compressed
            // as far as its looseness, freely.)
            var tgt: mat2x2f;
            // the surface push's skin hold (surf.x = 4): a point of the surface layer (load.w's
            // half, gridClear.wgsl) or one a push acted on lately holds its shear inside the cone
            // without dilating while it is compressed (the yield target with the whole trial
            // strain's compression, at 0.8 of the cone), so a flank keeps its slope until the push
            // acts on it
            var skinHold = false;
            if (g_simConstants.surf.x > 3.5) {
                var sk = 0.0;
                for (var i = 0; i < 3; i++) {
                    for (var j = 0; j < 3; j++) {
                        let c = vec2u(vec2i(weightInfo.cellIndex) + vec2i(i, j));
                        sk += weightInfo.weights[i].x * weightInfo.weights[j].y * g_load[c.y * g_simConstants.gridSize.x + c.x].w;
                    }
                }
                skinHold = sk > 0.0;
            }
            let epsS = log(max(abs(svdResult.Sigma), vec2f(1e-6)));
            if (skinHold && epsS.x + epsS.y < 0.0 && g_simConstants.yieldp.x < 0.5)
            {
                let trS = epsS.x + epsS.y;
                let eHatS = epsS - vec2f(trS * 0.5);
                let nrmS = length(eHatS);
                let sinPhiS = sin(materialParams.physical.x/180.0 * 3.14159);
                let alphaS = sqrt(2.0/3.0)*2.0*sinPhiS/(3.0 - sinPhiS);
                let coneKS = select(materialParams.mechanical.z + 1.0, materialParams.mechanical.w, materialParams.mechanical.w > 0.0);
                let dgS = nrmS + coneKS * trS * alphaS * 0.8;
                let keepS = select(vec2f(0.0), eHatS * (dgS / max(nrmS, 1e-6)), dgS > 0.0);
                tgt = svdResult.U*mat2x2f(exp(keepS.x), 0, 0, exp(keepS.y))*svdResult.Vt;
            }
            else if (g_simConstants.yieldp.x > 0.5)
            {
                // Yield inside the iterations (yieldp.x = 1). EA's target clamps the trial strain's
                // principal stretches at 1 from below: compression is resisted, extension is free, so
                // a shear (stretches e^g, e^-g) becomes a dilation (e^g, 1), and that dilation, about
                // 45 degrees' worth, was the sand's only resistance to shear inside the solve: a bed
                // turned as one block and, once failed, ran out like a liquid. Here the target is the
                // trial strain projected onto the Drucker-Prager cone of its own compression: expansion
                // stays free; under compression, shear inside the cone is corrected (the sand holds)
                // and only the shear beyond it is kept, as plastic flow, with no volume change. The
                // cone is yieldp.y (yieldScale) of the return map's, which also acts at the end of
                // the substep: together they give the heap's angle.
                let eps = log(max(abs(svdResult.Sigma), vec2f(1e-6)));
                let trY = eps.x + eps.y;
                let eHatY = eps - vec2f(trY * 0.5);
                let nrmY = length(eHatY);
                let sinPhiY = sin(materialParams.physical.x/180.0 * 3.14159);
                let alphaY = sqrt(2.0/3.0)*2.0*sinPhiY/(3.0 - sinPhiY);
                let coneKY = select(materialParams.mechanical.z + 1.0, materialParams.mechanical.w, materialParams.mechanical.w > 0.0);
                var keep = eps;
                // the load's compression (yieldp.z >= 2): the depth of sand above the point (load.wgsl)
                // times g, in the solver's strain units (g dt^2 per cell of depth), times yieldp.w
                // (loadScale); +1 cell: a point at the surface carries about its own cell's weight
                var loadTr = 0.0;
                if (g_simConstants.yieldp.z > 1.5)
                {
                    var h = 0.0;
                    for (var i = 0; i < 3; i++)
                    {
                        for (var j = 0; j < 3; j++)
                        {
                            let c = vec2u(vec2i(weightInfo.cellIndex) + vec2i(i, j));
                            h += weightInfo.weights[i].x * weightInfo.weights[j].y * g_load[c.y * g_simConstants.gridSize.x + c.x].x;
                        }
                    }
                    let dtY = g_simConstants.deltaTime;
                    loadTr = g_simConstants.yieldp.w * (h + 1.0) * length(g_simConstants.gravity) * dtY * dtY;
                }
                if (trY >= 0.0 && g_simConstants.yieldp.z > 2.5)
                {
                    // yieldp.z = 3: loosened (dilated) sand that still carries the sand above it keeps
                    // its friction, sized by that load: a flowing layer is not a liquid. (Without it,
                    // sand that dilated had no strength at all, and a bed thrown by a fast turn ran
                    // out to 13 to 16 degrees.) Its expansion stays free.
                    let dgL = nrmY - coneKY * loadTr * alphaY * g_simConstants.yieldp.y;
                    keep = vec2f(trY * 0.5) + select(vec2f(0.0), eHatY * (dgL / max(nrmY, 1e-6)), dgL > 0.0);
                }
                if (trY < 0.0)
                {
                    // the compression the cone is sized by: the whole trial strain's (yieldp.z = 0), or
                    // only this substep's, the stored part of F taken out, times yieldp.w (yieldp.z = 1)
                    var trC = trY;
                    if (g_simConstants.yieldp.z > 1.5 && g_simConstants.yieldp.z < 2.5)
                    {
                        // yieldp.z = 2: no more than the load allows. Sand's friction is in proportion to
                        // the weight of the sand above the point: its depth along "up" (load.wgsl) times
                        // g, in the solver's strain units (g dt^2 per cell of depth), times yieldp.w
                        // (loadScale). The stored compression alone grows with the time the sand has
                        // lain, so a settled bed was stronger than a fresh heap: it held past its angle
                        // and then turned in the glass as one block. (+1 cell: a point at the surface
                        // carries about its own cell's weight through the stencil.)
                        trC = max(trY, -loadTr);
                    }
                    else if (g_simConstants.yieldp.z > 0.5 && g_simConstants.yieldp.z < 1.5)
                    {
                        trC = min(0.0, g_simConstants.yieldp.w * (trY - log(max(abs(det(particle.deformationGradient)), 1e-6))));
                    }
                    let dgY = nrmY + coneKY * trC * alphaY * g_simConstants.yieldp.y;
                    keep = select(vec2f(0.0), eHatY * (dgY / max(nrmY, 1e-6)), dgY > 0.0);
                }
                tgt = svdResult.U*mat2x2f(exp(keep.x), 0, 0, exp(keep.y))*svdResult.Vt;
            }
            else
            {
                let floorSigma = exp(-0.5 * g_simConstants.floorLoose * max(particle.logJp, 0.0));
                svdResult.Sigma = clamp(svdResult.Sigma, vec2f(floorSigma), vec2f(1000, 1000));

                // Closest matrix to F with det == 1
                let df = det(F);
                let cdf = clamp(abs(df), 0.1, 1);
                let Q = (1.0f/(select(-1.0, 1.0, df >= 0.0)*sqrt(cdf)))*F;
                let alpha = materialParams.mechanical.z;
                tgt = alpha*(svdResult.U*mat2x2f(svdResult.Sigma.x, 0, 0, svdResult.Sigma.y)*svdResult.Vt) + (1.0-alpha)*Q;
            }

            let diff = (tgt*inverse(particle.deformationGradient) - Identity) - particle.deformationDisplacement;
            particle.deformationDisplacement += materialParams.physical.z*diff;

            let deviatoric = -1.0*(particle.deformationDisplacement + transpose(particle.deformationDisplacement));
            particle.deformationDisplacement += materialParams.mechanical.x*0.5*deviatoric;

        }

        // P2G
        for(var i = 0; i < 3; i++)
        {
            for(var j = 0; j < 3; j++)
            {
                let weight = weightInfo.weights[i].x * weightInfo.weights[j].y;
                let neighbourCellIndex = vec2i(weightInfo.cellIndex) + vec2i(i,j);
                let neighbourCellIndexLocal = neighbourCellIndex - localGridOrigin;
                let gridVertexIdx = localGridIndex(vec2u(neighbourCellIndexLocal));

                let offset = vec2f(neighbourCellIndex) - p + 0.5;

                let weightedMass = weight * particle.mass;
                let momentum = weightedMass * (particle.displacement +  particle.deformationDisplacement * offset);

                atomicAdd(&s_tileDataDst[gridVertexIdx + 0], encodeFixedPoint(momentum.x, g_simConstants.fixedPointMultiplier));
                atomicAdd(&s_tileDataDst[gridVertexIdx + 1], encodeFixedPoint(momentum.y, g_simConstants.fixedPointMultiplier));
                atomicAdd(&s_tileDataDst[gridVertexIdx + 2], encodeFixedPoint(weightedMass, g_simConstants.fixedPointMultiplier));

                if(g_simConstants.useGridVolumeForLiquid != 0)
                {
                    atomicAdd(&s_tileDataDst[gridVertexIdx + 3], encodeFixedPoint(particle.volume * weight, g_simConstants.fixedPointMultiplier));
                }
            }
        }
    }

    workgroupBarrier();

    // Save Grid
    if(gridVertexIsValid)
    {
        let gridVertexAddress = gridVertexIndex(vec2u(gridVertex), g_simConstants.gridSize);

        let dxi = atomicLoad(&s_tileDataDst[tileDataIndex]);
        let dyi = atomicLoad(&s_tileDataDst[tileDataIndex+1]);
        let wi = atomicLoad(&s_tileDataDst[tileDataIndex+2]);
        let vi = atomicLoad(&s_tileDataDst[tileDataIndex+3]);

        atomicAdd(&g_gridDst[gridVertexAddress + 0], dxi);
        atomicAdd(&g_gridDst[gridVertexAddress + 1], dyi);
        atomicAdd(&g_gridDst[gridVertexAddress + 2], wi);
        atomicAdd(&g_gridDst[gridVertexAddress + 3], vi);
    }
}
