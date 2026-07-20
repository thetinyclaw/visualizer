# Effect Ledger

Each accepted effect gets a fingerprint. Recurring agents must compare candidates against the five most recent entries before implementation.

## Existing families

### Stipple Waves
- **Composition:** flowing dotted terrain across the full screen
- **Primitive:** displaced grid, curl noise, analytic dots
- **Motion:** rolling surface and drifting flow
- **Audio:** five wave harmonics own deterministic FFT bins that change elevation, frequency, and travel speed; spatially interpolated bins bend the curl cloth; every dot owns a logarithmic bin controlling offset, radius, pulse cadence, color, and glow
- **Material:** luminous point-cloud cloth
- **Cost:** five fixed direct-bin harmonic calls reuse each phase for height and analytic normals; branchless per-dot bin ownership and analytic curl-like flow avoid divergent selectors and three 3D-noise samples per pixel

### Neurons
- **Composition:** dense cellular somas joined by two field-wide families of luminous axons
- **Primitive:** cell-local hashed bodies, polar dendrite fans, and analytic warped contours
- **Motion:** crawling dendrites, crossing axon currents, and traveling synaptic pulses
- **Audio:** bass joins somas and widens axons; mids alter dendrite topology and paths; treble reveals cell-local synapses
- **Material:** bioluminescent nervous tissue
- **Cost:** one local soma and bounded analytic fields replace 12 neuron plus 20 spark distance tests per pixel

### Flow Field
- **Composition:** two crossing families of continuous luminous rivers with fine capillaries
- **Primitive:** analytic sine contours over a compact curl/domain-warp field
- **Motion:** phase-propagating streams and topology deformation
- **Audio:** bass changes filament width, mids bend the field, treble reveals capillaries
- **Material:** luminous plasma/mycelial currents
- **Cost:** bounded noise samples with no per-fragment particle-integration loops

### Branches
- **Composition:** thick roots from opposing edges fork and converge around a dark central choke point, creating an inward gripping tree-root cage
- **Primitive:** two inverse-domain root families with seed-varied spacing, tapering trunk/fork SDFs, cylindrical cross-section shading, and loop-free convergence
- **Motion:** slow bass-led constriction and mid-frequency woody writhing; Randomize changes root spacing, fork direction, grain, and family rotation
- **Audio:** low FFT bins tighten the grip and swell root mass, mids deform centerlines and expose knots, and high bins open bark fissures
- **Material:** dark heartwood, warm bark, longitudinal ridges, split cracks, and recessed knots over near-black soil
- **Cost:** two analytic root-field evaluations with no explicit root/branch loops

### Reaction
- **Composition:** full-screen cellular blobs and boundaries
- **Primitive:** warped interference field approximating reaction diffusion
- **Motion:** slow phase drift and curl distortion
- **Audio:** bass changes scale; treble/mids expose boundaries
- **Material:** wet cellular membrane

### Voronoi
- **Composition:** coherent stained-glass cells with independent nucleus-to-membrane spectral pressure waves
- **Primitive:** stable nearest/second-nearest Voronoi topology plus frequency-owned interior displacement, concentric pressure rings, and membrane flares
- **Motion:** generator sites remain glacial at `VORONOI_TIME_SCALE = 0.08`; changing FFT amplitude advances each cell’s pressure phase immediately without accelerating the tessellation
- **Audio:** every cell owns one logarithmic FFT bin controlling pressure phase, interior contraction, nucleus radius, ring propagation, boundary flare, and color; topology is intentionally unweighted to prevent block seams
- **Material:** stained glass / living pressurized cells
- **Cost:** squared-distance ordering across the 3×3 neighborhood with branchless FFT selection and only two final square roots for shading

### Ribbons
- **Composition:** layered horizontal waveform bands
- **Primitive:** analytic sine-curve distance fields
- **Motion:** traveling waves
- **Audio:** bass deforms waves; treble intensifies glow
- **Material:** luminous fabric
- **Cost:** loop-invariant phases, gradient, and layer division are hoisted; compact cubic halos replace one exponential per ribbon

### Galaxy
- **Composition:** three-arm galactic disk with a dense nucleus, field-wide stars, and seed-random **Infinity Wells** distributed across center and periphery
- **Primitive:** analytic polar spiral, cell-local hashed stars, and a seamless coarse well field whose `x²-y²` saddle contours form literal hyperbolic/asymptotic arms
- **Motion:** differential arm rotation, a slowly orbiting stellar lattice, and subtle FFT-owned Infinity Well phase drift
- **Audio:** bass opens the nucleus and well halos, mids change spiral topology and well contours, and treble intensifies dust, stars, and well cores
- **Material:** luminous stellar dust and bright singularity nodes suspended in a velvet void
- **Visibility:** arm intensity retains a `0.48` peripheral floor and dust retains `0.34`, preventing center-out attenuation from erasing off-axis Infinity Wells
- **Cost:** cell-local stars plus a bounded 3×3 Infinity Well neighborhood; no full-screen star/well particle loops

### RGB Subpixels
- **Composition:** irregular full-frame field of independently scaled and rotated RGB clusters
- **Primitive:** jittered two-nearest generators with overlapping RGB box-distance cores, soft spill, and luminous edge contours
- **Motion:** frequency-owned drift, rotation, breathing scale, and sparse spectral glints
- **Audio:** every cluster owns one of 16 logarithmic FFT bins controlling size, brightness, motion, blur pressure, and edge intensity
- **Material:** crisp emissive subpixels suspended in restrained chromatic bloom
- **Cost:** nine cheap generator comparisons shade one cluster plus a distance-gated second cluster; rare glint square roots are branch-gated

### Stipple concept family
- **Composition:** standalone topographic, reef, and ink-dune dotted terrains
- **Primitive:** shared distorted stipple grid with variant shading
- **Motion:** flowing terrain
- **Audio:** structural breathing and sparkle
- **Material:** cartographic ink, glass reef, paper grain

## Accepted autonomous additions

### Cosmic Mycelium Revelation
- **Composition:** a centered abyssal aperture surrounded by nested revelation rings and branching fungal/cosmic veins
- **Primitive:** folded polar coordinates, domain-warped interference, angular mycelial filaments, sparse stellar cells
- **Motion:** rings dilate while veins crawl inward and the aperture lenses its surroundings
- **Audio:** bass opens the aperture, mids bend the living filaments, treble reveals spores and stellar microstructure
- **Material:** bioluminescent tissue suspended in a velvet stellar void
- **Cost:** seven bounded warp octaves feed both geometry and nebula shading; analytic polar fields and a cell-local spore layer avoid redundant noise and particle loops

### Spectral Hive Shell
- **Composition:** a center-facing hex with roughly three foreshortened shell layers across a loose spherical hive, surrounded by full-frame radial shafts
- **Primitive:** front-hemisphere normals, 3D rotation, longitude/latitude projection, analytic two-lattice hex coordinates, and loop-free angular rays
- **Motion:** the shell rotates slowly in three dimensions while trapped seam illumination migrates and external shafts breathe
- **Audio:** angular rays and rotating chamber identities consume the 16-bin FFT bus; bass loosens plates and low bins intensify center-facing seams
- **Material:** dark shell plates around a bright internal source, cool beveled leakage, and restrained volumetric haze
- **Novelty boundary:** inspired only by the supplied reference's spherical honeycomb/internal-light grammar; seeded spectral tint, FFT ownership, rotating projection, and depth hierarchy are original
- **Cost:** no loops or general powers; fixed multiplication chains form narrow shafts and squared gates avoid redundant shell-distance roots

### Infinite Hexsphere
- **Composition:** a perfectly tiled sphere with onset-modulated radius whose complete front gap network emits as continuous luminous lines
- **Primitive:** lattice-matched hex Voronoi cells over an unbounded front-hemisphere longitude/latitude domain with the coordinate wrap permanently behind the camera
- **Motion:** constant-speed longitude motion rotates continuously without exposing a projection seam; positive spectral flux expands the whole sphere independently
- **Audio:** sustained bass/treble and per-cell bins drive a 400% gap displacement; positive spectral flux/onsets drive radius; rotation ignores audio
- **Material:** near-black shell plates, continuous cold seam-line emitters, and volumetric shafts driven by integrated line energy
- **Novelty boundary:** no independent background ray lattice, random tile placement, visible longitude reset, or shared generic pulse across gap/radius/rotation is permitted
- **Cost:** an allocation-free 256-angle CPU map integrates ten front-surface seam depths per angle; the shader uses one filtered lookup for the outgoing field

### Filament Vortex Candidate
- **Composition:** full-frame plasma hair filaments spiraling into a seed-varied dark aperture; Randomize changes its lobe count, eccentricity, phase, center offset, and radius
- **Primitive:** log-polar analytic stripe fields, radial advection, antialiased lane distances, and seeded clump cells; angular harmonics/lane counts are integer-periodic, FFT ownership interpolates circularly from bin 15 back to bin 0, and bundle hashing uses a `cos/sin` embedding instead of an unwrapped `atan` index
- **Motion:** inward spiral drift with organic phase perturbations around a stable vortex throat
- **Audio:** 16 logarithmic FFT bands structurally control aperture size, curl strength, radial advection, filament width, and treble hair splitting; brightness is secondary
- **Material:** six seeded palette families—ice, ember, aurora, ultraviolet, citrus, and ocean—preserve bright fibers over a dark cosmic void while making Randomize visually consequential
- **Novelty boundary:** preserves only high-level topology/material/motion from the supplied image; no pixels, tracing, source texture, or monochrome frame reproduction
- **Cost:** three analytic lane families plus one seeded clump hash; no particle integration, raymarch, texture dependency, or sub-native backing resolution

### Reference Candidate Suite — Main Cycle 13–18
- **Prismatic Rupture Cathedral:** full-frame monochrome shard ribs and aperture fractures; FFT bins alter slab opening, seam width, and glint hierarchy.
- **Chromatic Iris Mycorrhiza:** biological toroidal iris with radial fiber bundles, spores, a breathing void, and angular 16-band ownership.
- **Recursive Diamond Lattice:** tone-mapped folded diamond rails, circuit nodes, and FFT packet gates over controlled recursive scales.
- **Neon Voxel Scan Cloud:** three occluding parallax voxel slices with spectral block ownership and moving scan faces.
- **Scarlet Velocity Ribbons:** black/scarlet aerodynamic layers surrounding a nonliteral low-slung singularity, with FFT-controlled widths, wakes, and ring pressure; each primary layer reuses one analytic streak distance for its sharp core and broad glow masks.
- **Cycle contract:** all six run through the shared main canvas, FFT bus, deterministic seed route, transitions, and benchmark system; standalone pages remain for focused iteration.
- **Novelty boundary:** autonomous runs may refine them but must not collapse them into existing Hive, Mycelium, RGB, or Stipple fingerprints.
