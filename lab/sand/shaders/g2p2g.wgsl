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
// (EA's per-particle expansion memory is replaced by that measure).
//-----------------------------------------------------------------------------

//!include common.inc
//!include domain.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage, read_write> g_particles : array<Particle>;
@group(0) @binding(2) var<storage> g_gridSrc : array<i32>;
@group(0) @binding(3) var<storage, read_write> g_gridDst : array<atomic<i32>>;
@group(0) @binding(4) var<storage> g_bucketData : array<u32>;
@group(0) @binding(5) var<storage> g_domain : array<vec4f>;

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
            // sand: the packing of the densest grid node around the particle (1: the fill's packing)
            var packing = 0.0;
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
                        packing = max(packing, nodeVolume);
                    }
                }
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
                        // the grid: the packing of the densest node around the particle. (Not the mean over
                        // the nodes: at a free surface or a wall the nodes outside the sand would make dense
                        // sand look loose; the densest node is inside it.) EA kept a per-particle memory of
                        // expansion instead (logJp = beta * trace); in this solver that memory decayed
                        // within a few substeps, while the over-relaxed constraint below kept pushing points
                        // apart, so a bed swelled at rest and never packed back down.
                        // rest packing: mechanical.y for sand (1: as filled)
                        let restPacking = materialParams.mechanical.y;
                        let loose = select(0.0, clamp(log(restPacking / max(packing, 1e-3)), 0.0, 1.5), g_simConstants.useGridVolumeForLiquid != 0);

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

                // The next substep's prediction: the field the sand feels in the glass.
                let dt = g_simConstants.deltaTime;
                particle.displacement += bodyForce(particle.position, particle.displacement / dt) * dt * dt;

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
            // then bounced in place. Here loose sand is resisted too (sand.w = 0) and packs down
            // only as fast as its load gets through this constraint; the return map keeps that
            // compaction instead of pushing it back. (sand.w = 1: loose sand may be compressed
            // as far as its looseness, freely.)
            let floorSigma = exp(-0.5 * g_simConstants.sand.w * max(particle.logJp, 0.0));
            svdResult.Sigma = clamp(svdResult.Sigma, vec2f(floorSigma), vec2f(1000, 1000));

            // Closest matrix to F with det == 1
            let df = det(F);
            let cdf = clamp(abs(df), 0.1, 1);
            let Q = (1.0f/(select(-1.0, 1.0, df >= 0.0)*sqrt(cdf)))*F;
            let alpha = materialParams.mechanical.z;
            let tgt = alpha*(svdResult.U*mat2x2f(svdResult.Sigma.x, 0, 0, svdResult.Sigma.y)*svdResult.Vt) + (1.0-alpha)*Q;

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
