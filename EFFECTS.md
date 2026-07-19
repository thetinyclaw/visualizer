# Effect Ledger

Each accepted effect gets a fingerprint. Recurring agents must compare candidates against the five most recent entries before implementation.

## Existing families

### Stipple Waves
- **Composition:** flowing dotted terrain across the full screen
- **Primitive:** displaced grid, curl noise, analytic dots
- **Motion:** rolling surface and drifting flow
- **Audio:** bass breathes elevation; mids resize dots; treble brightens glow
- **Material:** luminous point-cloud cloth
- **Cost:** one five-harmonic loop reuses phase calculations for both surface height and analytic normals

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
- **Composition:** a repeating grove of upward binary trees beneath a fine twig canopy
- **Primitive:** inverse-folded branch coordinates, analytic segment fields, and a cellular seed layer
- **Motion:** slowly breathing fork angles, alternating skeletal sway, and drifting seeds
- **Audio:** bass changes fork topology, mids articulate skeleton motion, and treble reveals canopy microstructure
- **Material:** electric botanical filaments and luminous seeds
- **Cost:** five inverse-fold iterations replace 256 explicit segment tests and 30 leaf-distance tests per pixel

### Reaction
- **Composition:** full-screen cellular blobs and boundaries
- **Primitive:** warped interference field approximating reaction diffusion
- **Motion:** slow phase drift and curl distortion
- **Audio:** bass changes scale; treble/mids expose boundaries
- **Material:** wet cellular membrane

### Voronoi
- **Composition:** animated stained-glass cells
- **Primitive:** 16-bin frequency-affinity weighted nearest/second-nearest Voronoi distance
- **Motion:** oscillating cell sites run at `VORONOI_TIME_SCALE = 0.3333333` (tripled cycle duration) while still accelerating independently with their assigned logarithmic FFT bin
- **Audio:** stable one-of-sixteen spectral ownership changes individual cell area and motion; louder owned cells widen boundaries and nuclei without changing global grid density
- **Material:** stained glass / living cells
- **Cost:** squared-distance ordering across the 3×3 neighborhood with only two final square roots for shading

### Ribbons
- **Composition:** layered horizontal waveform bands
- **Primitive:** analytic sine-curve distance fields
- **Motion:** traveling waves
- **Audio:** bass deforms waves; treble intensifies glow
- **Material:** luminous fabric
- **Cost:** loop-invariant phases, gradient, and layer division are hoisted; compact cubic halos replace one exponential per ribbon

### Galaxy
- **Composition:** centered three-arm disk with a dense nucleus, dust lanes, and field-wide stars
- **Primitive:** analytic polar spiral plus cell-local hashed stars
- **Motion:** differential arm rotation and a slowly orbiting stellar lattice
- **Audio:** bass opens the nucleus, mids change spiral topology, and treble increases dust microstructure
- **Material:** luminous stellar dust suspended in a velvet void
- **Cost:** one local star test per fragment replaces 100 full-screen star-distance tests

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
- **Composition:** full-frame pearl/cold-plasma hair filaments spiraling into a seeded dark aperture
- **Primitive:** log-polar analytic stripe fields, radial advection, antialiased lane distances, seeded clump cells
- **Motion:** inward spiral drift with organic phase perturbations around a stable vortex throat
- **Audio:** 16 logarithmic FFT bands structurally control aperture size, curl strength, radial advection, filament width, and treble hair splitting; brightness is secondary
- **Material:** crisp white-blue metallic fibers over a blue-black cosmic void with a restrained violet throat rim
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
