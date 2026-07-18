window.CANDIDATE_CYCLE_SHADER_BLOCK = String.raw`
// Main-cycle adaptations of the six standalone reference candidates.
float cycleInvSmooth(float lo, float hi, float x) { return 1.0 - smoothstep(lo, hi, x); }
mat2 cycleRot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
float cycleFftIndex(float index) { return fftBand((mod(index, 16.0) + 0.01) / 16.0); }
float cycleBoxMetric(vec2 p, vec2 b) { vec2 d = abs(p) - b; return max(d.x, d.y); }
float cycleAaLine(float v, float width) {
    float d = abs(fract(v) - 0.5);
    float px = max(1.35 / min(resolution.x, resolution.y), 0.0012);
    return 1.0 - smoothstep(width, width + px, d);
}

vec3 cycleFilamentVortex(vec2 uv, float t) {
    float centerKey = hash(vec2(seed, 17.0));
    vec2 center = vec2((centerKey - 0.5) * 0.16, (hash(vec2(seed, 29.0)) - 0.5) * 0.10);
    float baseTwist = 2.65 + hash(vec2(seed, 41.0)) * 0.8;
    float material = hash(vec2(seed, 53.0));
    vec2 p = uv - center;
    float r = length(p) + 0.0007;
    float a = atan(p.y, p.x);
    float localBass = (fftBinsA.x + fftBinsA.y + fftBinsA.z) * 0.3333;
    float lowMid = (fftBinsB.x + fftBinsB.y + fftBinsB.z + fftBinsB.w) * 0.25;
    float highMid = (fftBinsC.x + fftBinsC.y + fftBinsC.z + fftBinsC.w) * 0.25;
    float localTreble = (fftBinsD.x + fftBinsD.y + fftBinsD.z + fftBinsD.w) * 0.25;
    float rimWarp = 0.014 * sin(a * 3.0 + seed * 0.011 + t * 0.07) +
        0.008 * sin(a * 7.0 - seed * 0.017 + lowMid * 2.6) +
        0.005 * sin(a * 11.0 + t * 0.16 + highMid * 3.1);
    float aperture = 0.050 + localBass * 0.052 + fftBinsA.w * 0.018;
    float apertureRadius = aperture + rimWarp;
    float apertureDelta = r - apertureRadius;
    float throat = cycleInvSmooth(-0.006, 0.007, apertureDelta);
    float rim = cycleInvSmooth(0.0025, 0.010 + localBass * 0.004, abs(apertureDelta));
    float logR = log(r + 0.026);
    float angularFlow = a + logR * (baseTwist + lowMid * 2.35 - localTreble * 0.64);
    angularFlow += 0.26 * sin(a * 2.7 - logR * 5.1 + t * (0.16 + highMid * 0.72));
    angularFlow += 0.15 * sin(a * 6.3 + r * 11.0 - t * (0.36 + localTreble * 0.64));
    angularFlow += 0.055 * sin((a + logR) * 17.0 + seed * 0.003 + t * 0.23);
    float inward = 1.0 / (r + 0.12);
    float radialAdvection = r * (8.4 + localBass * 2.0) - t * (0.28 + lowMid * 0.58) + 0.36 * sin(angularFlow * 2.3 + t * 0.17);
    float bandKey = fract(angularFlow / TAU + 0.5 + seed * 0.000019);
    float owned = fftBand(bandKey);
    float filamentWidth = mix(0.018, 0.052, clamp(owned + localTreble * 0.35, 0.0, 1.0));
    float laneCountA = 88.0 + floor(material * 22.0) + localTreble * 16.0;
    float laneCountB = 131.0 + mod(floor(seed), 29.0);
    float laneCountC = 211.0 + mod(floor(seed), 17.0);
    float familyA = cycleAaLine(angularFlow / TAU * laneCountA + radialAdvection * 0.019 + sin(radialAdvection * 0.71) * 0.11, filamentWidth);
    float familyB = cycleAaLine((angularFlow + sin(r * 15.0 - t * 0.24) * 0.035) / TAU * laneCountB - radialAdvection * (0.037 + highMid * 0.035), 0.013 + owned * 0.022);
    float familyC = cycleAaLine((angularFlow + sin(radialAdvection * 1.9 + a * 5.0) * 0.055) / TAU * laneCountC + radialAdvection * (0.071 + localTreble * 0.05), 0.0085 + localTreble * 0.012);
    vec2 bundleCell = floor(vec2(angularFlow / TAU * 42.0 + sin(logR * 4.0), log(r + 0.045) * 24.0 - t * 0.10));
    float shred = 0.54 + 0.58 * smoothstep(0.10, 0.92, hash(bundleCell + seed * 0.113) + owned * 0.32);
    float brokenBundle = 0.70 + 0.36 * smoothstep(0.04, 0.88, hash(bundleCell + vec2(17.0, 71.0) + floor(t * 0.65)) + owned * 0.24 + highMid * 0.16);
    float radialGate = smoothstep(apertureRadius - 0.004, apertureRadius + 0.030, r) * cycleInvSmooth(1.04, 1.50, r);
    float midFieldMist = smoothstep(apertureRadius + 0.035, 0.72, r) * cycleInvSmooth(0.36, 1.42, r);
    float vortexGain = pow(clamp(inward * 0.56, 0.0, 1.0), 0.44);
    float fibers = (familyA * 0.62 + familyB * 0.44 + familyC * 0.34) * radialGate * shred * brokenBundle * (0.58 + 0.52 * vortexGain);
    float capillaryFog = (familyA + familyB * 0.8 + familyC * 0.7) * midFieldMist * (0.06 + highMid * 0.10);
    float dust = hash(gl_FragCoord.xy + floor(t * 20.0) + seed) - 0.5;
    float farHaze = cycleInvSmooth(0.20, 1.36, r) * (0.08 + highMid * 0.15);
    vec3 cold = mix(vec3(0.43,0.53,0.66), vec3(0.72,0.79,1.0), owned + localTreble * 0.32);
    vec3 pearl = vec3(0.93, 0.97, 1.0);
    vec3 col = vec3(0.004, 0.006, 0.015);
    col += vec3(0.20, 0.18, 0.35) * (0.42 + lowMid) * (farHaze + capillaryFog);
    col += cold * fibers * (0.72 + owned * 0.86) + pearl * fibers * fibers * (0.74 + localTreble * 0.72);
    col += mix(vec3(0.50,0.58,0.92), pearl, 0.34) * rim * (0.92 + localBass * 0.80);
    col *= 1.0 - throat * (0.86 + localBass * 0.06);
    col += vec3(dust * 0.018);
    float lens = cycleInvSmooth(apertureRadius - 0.003, apertureRadius + 0.016, r);
    return mix(col, vec3(0.0, 0.0, 0.004), lens * (0.78 + localBass * 0.06));
}

float cycleFractureCell(vec2 p, float scale, float bandBase) {
    vec2 g = p * scale, id = floor(g), f = fract(g) - 0.5;
    float owner = hash(id + seed * 0.017 + bandBase);
    float b = cycleFftIndex(bandBase + owner * 15.0);
    vec2 q = cycleRot(owner * TAU + b * 0.42) * f;
    float bend = sin((q.x + q.y) * 7.0 + owner * 9.0 + time * 0.19) * (0.020 + b * 0.018);
    float a = abs(q.x + bend), c = abs(q.y - bend * 0.7);
    float d = abs(q.x * 0.72 + q.y * 0.92 + sin(owner * 14.0) * 0.08);
    float e = abs(q.x * 1.15 - q.y * 0.48 + cos(owner * 11.0) * 0.05);
    return min(min(a, c), min(d, e + 0.05 * smoothstep(0.08, 0.48, hash(id + 3.1))));
}
float cycleShardSlab(vec2 p, float angle, float lane, float width) {
    vec2 q = cycleRot(angle) * p;
    float stripe = abs(fract(q.x * lane + seed * 0.001) - 0.5);
    return cycleInvSmooth(0.0, width, stripe) * cycleInvSmooth(0.06, 0.92, abs(q.y)) * cycleInvSmooth(0.18, 1.55, length(p));
}
float cycleArchRib(vec2 p, float span, float lift, float band) {
    vec2 q = p; q.y += lift;
    float arch = abs(length(q * vec2(1.0 / span, 1.26)) - 0.82);
    return cycleInvSmooth(0.0, 0.022 + band * 0.024, arch) * smoothstep(0.05, 0.95, abs(p.x)) * cycleInvSmooth(0.12, 1.82, length(p));
}
vec3 cyclePrismaticRupture(vec2 uv, float t) {
    vec2 p = uv * 2.0; p.x *= resolution.x / resolution.y;
    float localBass = cycleFftIndex(1.0), lowMid = cycleFftIndex(4.0), high = cycleFftIndex(13.0);
    float orbit = t * 0.18 + seed * 0.00013;
    vec3 color = vec3(0.0); float occlusion = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i), depth = fi / 4.0;
        vec2 q = cycleRot(orbit * (0.48 + depth * 0.34) + fi * 0.61 + 0.11 * sin(t * 0.23 + fi)) * (p * (0.78 + depth));
        q += vec2(sin(t * 0.19 + fi * 1.73 + seed * 0.002) * 0.24 * depth, cos(t * 0.16 + fi * 1.11) * 0.13 * depth);
        float crack = cycleFractureCell(q, 2.2 + fi * 1.22 + localBass * 0.45, fi * 2.7);
        float seamWidth = 0.020 + cycleFftIndex(fi * 2.0 + 2.0) * 0.040;
        float seam = cycleInvSmooth(0.0, seamWidth, crack), filament = cycleInvSmooth(0.0, seamWidth * 0.32, crack);
        float ring = abs(length(q * vec2(0.86, 1.05)) - (0.36 + depth * 0.42 + 0.05 * sin(t * 0.7 + fi)));
        float tunnelRib = cycleInvSmooth(0.0, 0.026 + high * 0.018, ring);
        float radialGate = cycleInvSmooth(1.42, 2.38, length(q));
        float mirror = max(cycleShardSlab(q, fi * 0.77 + orbit, 2.6 + fi * 0.7, 0.034 + lowMid * 0.018), cycleShardSlab(q, -fi * 0.54 + orbit * 0.7, 2.0 + fi, 0.022 + high * 0.015));
        float aperture = cycleInvSmooth(0.18, 0.98 + localBass * 0.08, max(abs(q.x * 0.34), abs(q.y * 1.42 + sin(fi + t * 0.4) * 0.12)));
        float layerLight = (seam * 0.68 + filament * 1.18 + tunnelRib * 0.62 + mirror * (1.20 + 1.20 * cycleFftIndex(fi + 8.0))) * radialGate;
        layerLight += cycleInvSmooth(0.22, 1.20, abs(q.x + sin(t * 0.33 + fi) * 0.22)) * cycleInvSmooth(0.0, 0.82, abs(q.y)) * aperture * (0.12 + 1.30 * localBass) * (1.0 - depth * 0.12);
        color += vec3(layerLight) * (0.28 + depth * 0.25) * occlusion + vec3(0.18, 0.21, 0.25) * seam * depth * 0.24;
        occlusion *= 0.82 + 0.10 * smoothstep(0.55, 1.45, length(q));
    }
    vec2 flankA = cycleRot(0.62 + orbit * 0.42) * (p + vec2(-0.72, 0.02));
    vec2 flankB = cycleRot(-0.60 + orbit * 0.38) * (p + vec2(0.72, -0.02));
    float sideMask = cycleInvSmooth(1.35, 2.45, length(p)) * (0.36 + 0.82 * smoothstep(0.18, 1.40, abs(p.x)));
    color += vec3(0.52,0.57,0.64) * (cycleInvSmooth(0.0,0.030+high*0.012,cycleFractureCell(flankA,3.10+localBass,6.0)) + cycleInvSmooth(0.0,0.028+lowMid*0.014,cycleFractureCell(flankB,3.75+high,10.0))) * sideMask;
    float sheets = cycleShardSlab(flankA,0.23,4.6,0.020+high*0.015) + cycleShardSlab(flankB,-0.18,4.3,0.018+lowMid*0.014) + cycleShardSlab(p,0.92+orbit*.18,3.2,.020+high*.012) + cycleShardSlab(p,-.82+orbit*.15,3.0,.020+lowMid*.012);
    float arch = cycleArchRib(p+vec2(0,.26),1.28,.12,lowMid) + cycleArchRib(p+vec2(0,-.16),1.55,-.08,high);
    color += vec3(.86,.91,.98) * (sheets + arch * 1.10) * sideMask * (.36 + .90 * high);
    float cross = cycleInvSmooth(0.0,.102+localBass*.04,abs(p.x))*cycleInvSmooth(0.0,1.10,abs(p.y)) + cycleInvSmooth(0.0,.065+high*.024,abs(p.y))*cycleInvSmooth(0.0,1.42,abs(p.x));
    float vignette = cycleInvSmooth(1.60,2.72,length(p));
    color += vec3(cross) * (.46 + localBass * 1.15);
    color = color * vignette + vec3(.018,.022,.027) * (1.0-vignette) + vec3(.020,.024,.030);
    color = color / (1.0 + color * .72);
    return pow(max(color,vec3(0.0)),vec3(.72));
}

vec3 cycleSpectralRamp(float a, float r, float energy) {
    vec3 c = mix(vec3(.48,.10,1.24), vec3(.02,.85,1.35), smoothstep(-.25,.72,cos(a+2.22)));
    c = mix(c,vec3(1.45,.58,.16),smoothstep(-.35,.58,cos(a-.55))*smoothstep(.22,.88,r));
    return mix(c,vec3(.06,1.05,.62),smoothstep(.64,.98,sin(a*1.7+energy*1.2))*.35);
}
float cycleMycelialThreads(float angle, float radius, float t) {
    float total=0.0;
    for(int i=0;i<4;i++) {
        float fi=float(i), count=34.0+fi*23.0;
        float phase=angle/TAU*count+seed*.00073*(fi+1.0)+sin(radius*(5.2+fi*1.7)-t*(.24+fi*.04))*(.12+.03*fi);
        float band=cycleFftIndex(fi*3.0+floor(fract(phase)*16.0));
        float thread=cycleInvSmooth(0.0,.020+band*.012,abs(fract(phase)-.5));
        float companion=cycleInvSmooth(0.0,.012+band*.008,abs(fract(phase*1.618+fi*.27)-.5));
        total+=(thread+companion*.46)*smoothstep(.18,.50,radius)*cycleInvSmooth(1.03,1.54,radius)*(.24+band*.76)/(1.0+fi*.36);
    }
    return total;
}
float cycleFastSpores(float angle,float radius,float t) {
    vec2 g=vec2(angle*3.1+seed*.003,log(max(radius,.05))*7.5-t*.38), cell=floor(g*vec2(13,17)), f=fract(g*vec2(13,17))-.5;
    vec2 h=hash2(cell+seed*.011)-.5; float owner=hash(cell+4.2), b=cycleFftIndex(owner*15.0), d=length(f-h*.68);
    return (cycleInvSmooth(0.0,.055+b*.048,d)*step(.42,owner)+cycleInvSmooth(0.0,.020+b*.015,abs(fract((g.x+g.y)*9.7+owner*4.1)-.5))*.25)*smoothstep(.42,.82,radius)*cycleInvSmooth(1.0,1.55,radius);
}
vec3 cycleChromaticIris(vec2 uv,float t) {
    vec2 p=uv*2.0; p.x*=resolution.x/resolution.y; p=cycleRot(-.31+sin(seed*.001)*.13)*p; p.x*=.86;
    float radius=length(p), angle=atan(p.y,p.x), localBass=cycleFftIndex(1.0);
    float mids=(cycleFftIndex(5.0)+cycleFftIndex(7.0)+cycleFftIndex(9.0))*.3333;
    float highs=(cycleFftIndex(12.0)+cycleFftIndex(14.0)+cycleFftIndex(15.0))*.3333;
    float irisRadius=.55+localBass*.060+.022*sin(t*.39), thickness=.175+mids*.075, dRing=abs(radius-irisRadius);
    float ring=cycleInvSmooth(0.0,thickness,dRing), innerMask=cycleInvSmooth(0.0,irisRadius*.60+localBass*.035,radius), outerFade=cycleInvSmooth(1.26,1.92,radius);
    float orbital=angle+t*.19+.34*sin(radius*3.0-t*.17)+.12*sin(radius*9.0+t*.31);
    float rib=cycleMycelialThreads(orbital,radius,t), hair=cycleMycelialThreads(orbital*1.013+.7,radius*1.16,-t*.61)*.46;
    float caustic=cycleInvSmooth(0.0,.065+highs*.020,abs(dRing+.024*sin(angle*19.0+t*.65)));
    float innerFire=cycleInvSmooth(0.0,.18+localBass*.050,abs(radius-(irisRadius-thickness*.58)))*smoothstep(-.2,.96,cos(angle-.38));
    float outerBlue=cycleInvSmooth(0.0,.28,abs(radius-(irisRadius+thickness*.70)))*smoothstep(-.35,.95,cos(angle+2.55));
    vec3 base=cycleSpectralRamp(angle+t*.08,radius,mids), color=base*ring*(.34+rib*2.10+hair*1.05);
    color+=vec3(1.55,.86,.42)*innerFire*(.70+localBass*1.65)+vec3(.10,.95,1.55)*outerBlue*(.48+highs*1.25)+vec3(1.1,.55,1.6)*caustic*(.20+mids*1.15);
    color+=mix(vec3(.18,.9,1.35),vec3(1.25,.22,1.0),fract(angle*2.0+radius*3.0))*cycleFastSpores(orbital,radius,t)*(.50+highs);
    color+=base*max(cycleInvSmooth(0.0,.20+.05*mids,dRing)*(.35+.65*sin(angle*8.0+radius*6.0-t*.42)),0.0)*.22;
    color+=base*cycleInvSmooth(0.0,.78,dRing)*smoothstep(.18,1.35,radius)*outerFade*.22;
    vec2 neb=cycleRot(t*.035)*p; float veil=sin(neb.x*4.4+t*.13)*sin(neb.y*3.3-t*.17)*.5+.5;
    color+=vec3(.018,.030,.070)+vec3(.040,.022,.092)*veil*outerFade;
    color*=1.0-innerMask*.78; color*=cycleInvSmooth(1.45,2.08,radius); color=color/(1.0+color*.58);
    return pow(max(color,vec3(0.0)),vec3(.76));
}

vec3 cycleRecursiveDiamond(vec2 uv,float t) {
    uv.x*=resolution.x/resolution.y; float angle=PI*.25+sin(t*.07+seed)*.012; vec2 p=cycleRot(angle)*uv;
    p*=.86+bass*.10+.018*sin(t*.17); float line=0.0,glow=0.0,node=0.0,micro=0.0; vec2 q=p;
    for(int layer=0;layer<5;layer++) {
        float lf=float(layer),band=fftBand(fract(.071*lf+seed*.00013)); vec2 a=abs(q); float radius=.32+lf*.155+band*.018,diamond=abs(a.x+a.y-radius),railWidth=.0065+lf*.0009+band*.004;
        float rails=cycleInvSmooth(railWidth,railWidth*2.85,diamond), railGlow=cycleInvSmooth(railWidth*3.0,.070+band*.035,diamond);
        float packet=fract((a.x-a.y)*7.25+lf*.41+t*(.22+band*.38)); float gate=mix(.72,1.0,smoothstep(.18,.50,packet)*cycleInvSmooth(.62,.96,packet));
        line+=rails*(.34+band*.42)*gate; glow+=railGlow*(.026+band*.045);
        float grid=2.05+lf*.72; vec2 cell=floor((q+vec2(.54))*grid),local=fract((q+vec2(.54))*grid)-.5; float key=hash(cell+lf+seed),cb=fftBand(key); vec2 jp=(hash2(cell+seed*.3+lf)-.5)*.22;
        float d2=dot(local-jp,local-jp); node+=cycleInvSmooth(.006+cb*.006,.020+cb*.016,d2)*step(.82-lf*.035,key)*(.22+cb*.58);
        micro+=cycleInvSmooth(.0055,.017,abs(abs(local.x)-abs(local.y)))*step(.66,hash(cell+lf*11.0))*(.032+cb*.075);
        q=abs(q)*1.43-vec2(.37+.018*sin(t*.10+lf),.245-.014*cos(t*.12+lf)); q=mat2(.707,-.707,.707,.707)*q;
    }
    float center=cycleInvSmooth(.012,.052,abs(length(p)-(.115+bass*.018)));
    vec3 col=vec3(.0025,.0032,.0042)+vec3(.50,.58,.62)*line+vec3(.20,.46,.70)*glow+vec3(.95,.82,.45)*node+vec3(.52,.60,.62)*micro+vec3(.55,.78,1.0)*center*(.16+fftBinsA.x*.18);
    col*=.90+.10*sin((uv.y+t*.018)*210.0); return col/(1.0+col*1.55)*1.12;
}

vec3 cycleNeonVoxel(vec2 uv,float t) {
    uv.x*=resolution.x/resolution.y; vec2 camera=uv+vec2(sin(t*.12+seed)*.06,cos(t*.10)*.04); vec3 col=vec3(0); float occ=0.0;
    for(int slice=0;slice<3;slice++) {
        float sf=float(slice),z=(sf+1.0)/3.0; vec2 p=camera*(1.0+z*.34)+vec2((z-.5)*.28+sin(t*.16+sf)*.055,(z-.5)*-.20);
        vec2 gridUv=vec2(p.x*(5.2+z*3.1)+sin(p.y*2.4+t*.12)*.20,p.y*(4.0+z*2.2)+cos(p.x*1.7-t*.11)*.16),cell=floor(gridUv),f=fract(gridUv)-.5;
        float id=hash(cell+seed+sf*19.7),band=fftBand(id),lane=fract(cell.y*.083+t*(.34+band*.48)+z*.21);
        float active=step(.28-z*.055,id)*smoothstep(.02,.20,lane)*cycleInvSmooth(.42,.98,lane), chance=step(.62-band*.13-z*.05,hash(cell*vec2(1.3,2.1)+seed*.7+sf));
        vec2 size=vec2(.145+.055*band,.105+.045*band)*mix(.72,1.08,z),skew=vec2(.105,-.070)*(.45+z*.65); float front=cycleBoxMetric(f,size);
        float top=cycleInvSmooth(.010,.033,abs(cycleBoxMetric(f+skew,size*.92))),side=cycleInvSmooth(.012,.034,abs(cycleBoxMetric(f-skew*.55,size*.86))),outline=cycleInvSmooth(.010,.034,abs(front)),face=cycleInvSmooth(-.050,.018,front);
        float scanFace=pow(max(0.0,1.0-abs(fract((f.y+.5)*5.0+t*(.35+z*.25))-.5)*2.0),7.0); vec3 neon=mix(vec3(.04,1,.18),vec3(.02,.76,1),smoothstep(.20,.56,id)); neon=mix(neon,vec3(.95,.06,1),step(.79,id)); neon=mix(neon,vec3(1,.48,.03),step(.93,id));
        float alpha=active*chance*(.30+z*.40)*(1.0-occ*.45); col+=neon*(outline*.46+top*.16+side*.13)*(.55+band*.92)*alpha+mix(neon,vec3(1),.20)*face*scanFace*(.12+band*.24)*alpha; occ+=face*alpha*.34;
    }
    float scan=pow(max(0.0,1.0-abs(fract((uv.y+.75)*22.0-t*2.75)-.5)*2.0),12.0); vec2 cell=floor((uv+vec2(t*.12,0))*vec2(82,34)),f=fract((uv+vec2(t*.12,0))*vec2(82,34))-.5;
    col+=vec3(.25,.75,1)*step(.988-treble*.018,hash(cell+seed))*cycleInvSmooth(.0001,.0009,dot(f,f))+vec3(.03,.8,.16)*scan*(.045+mid*.10);
    col*=cycleInvSmooth(.22,1.45,length(uv*vec2(.82,1.05))); return col/(1.0+col*.95);
}

float cycleStreak(vec2 uv,float slope,float offset,float width) { return cycleInvSmooth(width,width*3.2,abs(uv.y-uv.x*slope-offset)); }
vec3 cycleScarletVelocity(vec2 uv,float t) {
    uv.x*=resolution.x/resolution.y; vec2 p=uv; p.y+=.040*sin(p.x*2.1+t*.12); vec3 col=vec3(.003,0,.002);
    col+=vec3(.060,0,.008)*cycleInvSmooth(.12,1.35,length(p*vec2(.88,1.34)))+vec3(.55,.01,.018)*cycleInvSmooth(.008,.030,abs(p.y+.255))*(.28+bass*.25);
    for(int i=0;i<12;i++) { float fi=float(i),key=fract(fi*.097+seed*.00021),b=fftBand(key),flow=fract(t*(.055+fi*.004+b*.050)+key),off=-.70+fi*.125+.075*sin(t*.18+fi*1.7)+(flow-.5)*.18,sl=mix(.065,.310,hash(vec2(fi,seed))),width=.0032+hash(vec2(seed,fi))*.0032+b*.0048,depth=mix(.42,1.0,fract(key*7.1)); vec2 rp=p*vec2(1.0+depth*.16,1.0)+vec2(depth*.19-.09,sin(t*.11+fi)*.016); rp.y+=.075*sin(rp.x*1.72+t*.10+fi*.31)*cycleInvSmooth(.18,1.05,abs(rp.x)); float gate=smoothstep(-.68,.42,rp.y)*cycleInvSmooth(.10,1.08,abs(rp.x)); vec3 sc=mix(vec3(.98,.020,.012),vec3(1,.13,.030),hash(vec2(fi,3))); col+=sc*cycleStreak(rp,sl,off,width)*gate*(.42+b*.76)*depth+vec3(.48,.006,.020)*cycleStreak(rp,sl,off,width*4.2)*gate*(.024+b*.040); }
    for(int j=0;j<5;j++) { float fj=float(j),b=fftBand(fract(.37+fj*.141+seed*.00017)); vec2 ap=p; ap.y+=.10*sin(ap.x*(1.15+fj*.23)+t*.08+fj); col+=vec3(.82,.012,.018)*cycleStreak(ap,.16+fj*.035,-.38+fj*.12,.0045+b*.004)*smoothstep(-.62,.30,ap.y)*cycleInvSmooth(.12,.95,abs(ap.x))*(.20+b*.38); }
    vec2 body=p-vec2(.02,-.235); float keel=cycleBoxMetric(mat2(1,.06,-.08,1)*body,vec2(.54,.050)),upper=abs(body.y+.035+.050*cos((body.x+.02)*3.6));
    float singularity=cycleInvSmooth(.000,.030,keel)*cycleInvSmooth(.12,.70,abs(body.x))+cycleInvSmooth(.010,.040,upper)*cycleInvSmooth(.05,.55,abs(body.x+.02));
    float nose=cycleInvSmooth(.010,.038,abs(p.y+.223+abs(p.x+.46)*.125))*cycleInvSmooth(.10,.64,abs(p.x+.42)),tail=cycleInvSmooth(.006,.030,cycleBoxMetric(p-vec2(.49,-.205),vec2(.12,.030)));
    float ringA=abs(length((p-vec2(-.36,-.312))*vec2(1,1.2))-.070),ringB=abs(length((p-vec2(.35,-.312))*vec2(1,1.2))-.078),rings=cycleInvSmooth(.004,.016,ringA)+cycleInvSmooth(.004,.017,ringB),glow=cycleInvSmooth(.018,.085,ringA)+cycleInvSmooth(.018,.092,ringB);
    float wake=pow(max(0.0,1.0-abs(p.y+.405)*6.0),3.0)*cycleInvSmooth(-.65,.75,p.x); col=mix(col,vec3(.0006,.0002,.0004),clamp(singularity*.86,0.0,1.0));
    col+=vec3(.48,.005,.010)*(singularity*.18+nose*.30+tail*.18)+vec3(1,.055,.020)*(rings*(.45+treble*.35)+glow*(.040+mid*.075))+vec3(.62,0,.018)*wake*(.14+bass*.18);
    col*=.78+.22*cycleInvSmooth(.72,1.45,length(uv)); return col/(1.0+col*1.22);
}
`;
