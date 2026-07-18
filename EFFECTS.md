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
- **Motion:** oscillating cell sites accelerate independently with their assigned logarithmic FFT bin
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
