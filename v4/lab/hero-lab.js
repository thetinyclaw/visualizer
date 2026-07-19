(() => {
  'use strict';
  const scene = window.V4_HERO_SCENE || 'filament-vortex';
  const params = new URLSearchParams(location.search);
  const seed = Number.parseInt(params.get('seed') || '491009', 10) || 491009;
  const lockedTime = params.has('time') ? Number.parseFloat(params.get('time')) : null;
  const inputMode = params.get('mode') || 'demo';
  const canvas = document.getElementById('hero-canvas');
  const status = document.getElementById('status');
  const rand = mulberry32(seed);
  const state = { scene, seed, inputMode, lockedTime, renderer: 'webgl2', unsupported: false, fallbackReason: '', structuralAudio: true, persistentState: true, nativeDensity: true };
  window.__V4_HERO_LAB__ = state;

  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function pulse(t, i){ if (inputMode === 'flat') return 0; return .5 + .5 * Math.sin(t * (.55 + i * .071) + i * 1.91 + seed * .00013); }
  function bands(t){ const b = new Float32Array(16); for (let i=0;i<16;i++) b[i]=.04 + .62*Math.exp(-Math.pow((i-(2+pulse(t,1)*2))/1.7,2)) + .45*Math.exp(-Math.pow((i-(7+pulse(t,3)*4))/2.2,2)) + .28*Math.exp(-Math.pow((i-(12+pulse(t,5)*3))/1.9,2)); return b; }

  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }) || canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl || scene === 'filament-vortex-webgpu-only') return canvasFallback('WebGL unavailable; topology-preserving Canvas fallback active');

  const vs = `attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uMvp; varying vec4 vColor; void main(){ vColor=aColor; gl_Position=uMvp*vec4(aPos,1.0); }`;
  const fs = `precision mediump float; varying vec4 vColor; void main(){ gl_FragColor=vColor; }`;
  const program = link(vs, fs); gl.useProgram(program);
  const aPos = gl.getAttribLocation(program, 'aPos'), aColor = gl.getAttribLocation(program, 'aColor'), uMvp = gl.getUniformLocation(program, 'uMvp');
  const posBuf = gl.createBuffer(), colBuf = gl.createBuffer();
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  let built = scene === 'filament-vortex' ? buildFilament() : scene === 'prismatic-cathedral' ? buildCathedral() : buildVoxels();
  state.vertexTopology = built.topology; state.geometry = built.geometry; state.webgpuViable = false; state.webgpuFallback = scene === 'filament-vortex' ? 'WebGL2 line-bundle fallback used instead of WebGPU/WGSL because this no-build lab keeps browser support broad while preserving persistent advection topology.' : 'not requested';

  function compile(type, src){ const s=gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function link(v, f){ const p=gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, v)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
  function resize(){ const dpr=Math.max(1, Math.min(devicePixelRatio || 1, 2)); canvas.width=Math.floor(innerWidth*dpr); canvas.height=Math.floor(innerHeight*dpr); canvas.style.width=innerWidth+'px'; canvas.style.height=innerHeight+'px'; gl.viewport(0,0,canvas.width,canvas.height); state.effectiveDprX=canvas.width/innerWidth; state.effectiveDprY=canvas.height/innerHeight; state.nativeDensity=state.effectiveDprX>=.999&&state.effectiveDprY>=.999; }
  addEventListener('resize', resize); resize();
  const start = performance.now();
  function frame(now){ const t = Number.isFinite(lockedTime) ? lockedTime : (now-start)/1000; const fft = bands(t); gl.clearColor(.004,.006,.018,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); built.update(t, fft); uploadAndDraw(built, t, fft); if(status && (!status._t || now-status._t>250)){ status._t=now; status.textContent=`seed ${seed} · ${inputMode} input · ${built.geometry} · DPR ${state.effectiveDprX.toFixed(2)} · ${scene==='filament-vortex'?'WebGL fallback, WebGPU noted':'WebGL depth'}`; } requestAnimationFrame(frame); }
  requestAnimationFrame(frame);

  function uploadAndDraw(mesh, t, fft){ const mvp = m4mul(perspective(55*Math.PI/180, canvas.width/canvas.height, .05, 80), lookAt(cameraFor(t, fft), scene==='prismatic-cathedral' ? [0,.15,-1.2] : [0,0,0], [0,1,0])); gl.uniformMatrix4fv(uMvp,false,new Float32Array(mvp)); gl.bindBuffer(gl.ARRAY_BUFFER,posBuf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh.positions), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0); gl.bindBuffer(gl.ARRAY_BUFFER,colBuf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh.colors), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(aColor); gl.vertexAttribPointer(aColor,4,gl.FLOAT,false,0,0); gl.drawArrays(mesh.primitive,0,mesh.positions.length/3); }
  function cameraFor(t, fft){ if(scene==='prismatic-cathedral') return [Math.sin(t*.15)*.55, .78+fft[5]*.18, 7.0+Math.cos(t*.09)*.35]; if(scene==='neon-voxel-cloud') return [Math.sin(t*.12)*.82, .40+fft[9]*.14, 5.8+Math.cos(t*.09)*.25]; return [Math.sin(t*.1)*.55, .18+fft[2]*.16, 4.25]; }

  function buildFilament(){
    state.composition={occupiedSilhouette:.68,lineBundleWidth:.052,depthLayers:4,cameraZ:4.25};
    const strands = Array.from({length:118}, (_,s)=>({phase:rand()*6.28, radius:.86+rand()*1.35, z:-1.95+rand()*3.9, bin:s%16, tier:s%5, handed:s%2?1:-1, pts:Array.from({length:52},()=>[0,0,0])}));
    const mesh = {primitive: gl.TRIANGLES, topology:'persistent strand/advection ribbon bundles with nested luminous core hierarchy', geometry:'118 thick depth-tested 3D strand ribbons', positions:[], colors:[], update(t, fft){ this.positions=[]; this.colors=[]; for(const strand of strands){ const hi=fft[strand.bin]; strand.phase += strand.handed*(.006 + hi*.014); strand.radius += Math.sin(t*.27+strand.bin)*.0016; for(let i=0;i<strand.pts.length;i++){ const u=i/(strand.pts.length-1); const funnel=1.18-u*.74; const r=Math.max(.16, strand.radius*funnel + .11*Math.sin(t*.72+u*13.7+strand.bin)); const a=strand.phase + strand.handed*(u*8.9 + t*(.15+hi*.32)); const yScale=.66+.08*Math.sin(u*6.28+strand.tier); strand.pts[i]=[Math.cos(a)*r, Math.sin(a)*r*yScale + .18*Math.sin(a*2.1+u*4.0), strand.z + (u-.5)*2.45 + Math.sin(a+t*.7)*.10]; }
        for(let i=0;i<strand.pts.length-1;i++){ const u=i/(strand.pts.length-1); const width=(.026+.018*(strand.tier===0)+hi*.034)*(1.22-u*.38); const core=[.66+hi*.30,.88+hi*.12,1, .48+hi*.42]; const halo=[.10+hi*.20,.44+hi*.35,1, .12+hi*.20]; addRibbon(this,strand.pts[i],strand.pts[i+1],width*2.2,halo); addRibbon(this,strand.pts[i],strand.pts[i+1],width,core); } } }}; mesh.update(0,bands(0)); return mesh; }
  function buildCathedral(){
    state.composition={nearPlaneClearance:3.9,maxShardSize:.36,corridorHalfWidth:1.72,archCount:13,cameraZ:7.0};
    const arches = Array.from({length:13},(_,i)=>({z:1.9-i*.62, bin:i%16, skew:(rand()-.5)*.10, glow:rand()}));
    const shards = Array.from({length:72},(_,i)=>{ const side=i%2?-1:1, depth=2.05-rand()*8.2, wall=1.35+rand()*.58; return {x:side*wall+(rand()-.5)*.18,y:-.58+rand()*2.55,z:depth,s:.075+rand()*.22,r:rand()*6.28,bin:i%16,side}; });
    const mesh={primitive:gl.TRIANGLES,topology:'bounded corridor prism/arch triangles with depth occlusion and traversable negative space',geometry:'13 arch ribs plus 72 bounded emissive shard prisms',positions:[],colors:[],update(t,fft){this.positions=[];this.colors=[]; for(const a of arches){ const z=((a.z+t*(.20+fft[1]*.10)+6.2)%8.4)-6.2; const pulseA=.55+fft[a.bin]*.45; const edge=[.74,.92,1,.52+.25*pulseA], core=[1,.74+fft[a.bin]*.20,.96,.32+.22*pulseA]; addArch(this,0+a.skew,.05,z,1.66,.36,2.15,.060+.022*fft[a.bin],edge); addBeam(this,-.92,.74,z,.92,.74,z-.12,.035,core); addBeam(this,.92,.74,z,-.92,.74,z-.12,.035,core); }
        for(const sh of shards){ const travel=((sh.z+t*(.18+fft[sh.bin]*.12)+6.1)%8.7)-6.1; const wallPush=.08*Math.sin(t*.4+sh.bin); const size=Math.min(.36,sh.s*(.82+fft[sh.bin]*.50)); const alpha=.18+fft[sh.bin]*.28+(sh.y>.9?.08:0); addShard(this, sh.x+sh.side*wallPush, sh.y, travel, size, sh.r+t*.045, [.64+fft[sh.bin]*.24,.80,.98, alpha]); }
        addFloorRunes(this,t,fft); }}; mesh.update(0,bands(0)); return mesh; }
  function buildVoxels(){
    state.composition={coherentMassRadius:2.25,maxCubeSize:.26,scanAxis:'diagonal y/z front',cellCount:260,cameraZ:5.8};
    const cells = Array.from({length:260},(_,i)=>{ const z=-5.8+rand()*7.9, theta=z*1.10 + rand()*1.85, shell=Math.sqrt(rand()), tunnel=.54+shell*1.72; return {x:Math.cos(theta)*tunnel+(rand()-.5)*.34,y:Math.sin(theta)*tunnel*.60+(rand()-.5)*.28,z,s:.060+rand()*.125,bin:i%16,on:.42+rand()*.38,phase:rand()*6.28,core:shell<.42}; });
    const mesh={primitive:gl.TRIANGLES,topology:'persistent diagonal scan-front occupancy over a tunnel-shaped voxel cloud',geometry:'260 bounded 3D voxel cubes with foggy face depth',positions:[],colors:[],update(t,fft){this.positions=[];this.colors=[]; for(const c of cells){ const z=((c.z+t*(.20+fft[3]*.11)+6.0)%8.2)-6.0; const front=z*.68+c.y*1.25-t*.95; const scan=Math.exp(-Math.pow(Math.sin(front+c.phase*.14)*1.45,2.0)); c.on = c.on*.89 + scan*.11; const active=c.on + fft[c.bin]*.55; if(active<.30) continue; const drift=.16*Math.sin(t*.3+c.phase); const hue=c.bin%3; const fog=Math.max(.36,1-(z+6.0)/9.0); const alpha=(.34+active*.38)*fog; const col=hue===0?[.08,.95,1,alpha]:hue===1?[.78,.18,1,alpha*.96]:[.25,1,.58,alpha*.92]; const size=Math.min(.26,c.s*(c.core?1.62:1.06)*(.94+fft[c.bin]*.86)); addCube(this,c.x+drift,c.y+.08*Math.sin(t*.42+c.bin),z,size,col); }
        for(let k=0;k<32;k++){ const z=((2.0-k*.30+t*.24+6.0)%8.2)-6.0, r=.64+k*.035, a=t*.35+k*.50; addCube(this,Math.cos(a)*r,Math.sin(a)*r*.52,z,.052,[.68,.98,1,.32]); } }}; mesh.update(0,bands(0)); return mesh; }
  function addRibbon(m,a,b,w,c){ const dx=b[0]-a[0], dy=b[1]-a[1], l=Math.hypot(dx,dy)||1, nx=-dy/l*w, ny=dx/l*w; const p1=[a[0]+nx,a[1]+ny,a[2]], p2=[a[0]-nx,a[1]-ny,a[2]], p3=[b[0]+nx,b[1]+ny,b[2]], p4=[b[0]-nx,b[1]-ny,b[2]]; for(const p of [p1,p2,p3,p2,p4,p3]){ m.positions.push(...p); m.colors.push(...c); } }
  function addShard(m,x,y,z,s,r,c){ const base=[[0,s*1.55,0],[-s*.78,-s,0],[s*.78,-s,0],[0,0,s*1.55],[0,0,-s*1.20]]; const faces=[[0,1,3],[0,3,2],[0,4,1],[0,2,4],[1,2,3],[1,4,2]]; for(const f of faces){ for(const idx of f){ const p=base[idx], cr=Math.cos(r), sr=Math.sin(r); m.positions.push(x+p[0]*cr-p[2]*sr,y+p[1],z+p[0]*sr+p[2]*cr); m.colors.push(...c); } } }
  function addBeam(m,x1,y1,z1,x2,y2,z2,w,c){ const a=[x1,y1,z1], b=[x2,y2,z2]; addRibbon(m,a,b,w,c); }
  function addArch(m,x,y,z,w,h,top,thick,c){ addBeam(m,x-w,y,z,x-w,y+h,z,thick,c); addBeam(m,x+w,y,z,x+w,y+h,z,thick,c); const steps=11; for(let i=0;i<steps;i++){ const a=Math.PI*(i/steps), b=Math.PI*((i+1)/steps); const p1=[x+Math.cos(a)*w,y+h+Math.sin(a)*top*.34,z], p2=[x+Math.cos(b)*w,y+h+Math.sin(b)*top*.34,z]; addRibbon(m,p1,p2,thick,c); } }
  function addFloorRunes(m,t,fft){ for(let i=0;i<18;i++){ const z=1.4-i*.42, w=.22+i*.018, a=.18+fft[i%16]*.10; addBeam(m,-w,-.66,z,w,-.66,z-.10,.018,[.35,.78,1,a]); } }
  function addCube(m,x,y,z,s,c){ const v=[[-s,-s,-s],[s,-s,-s],[s,s,-s],[-s,s,-s],[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]], F=[[0,1,2,0,2,3],[4,6,5,4,7,6],[0,4,5,0,5,1],[3,2,6,3,6,7],[1,5,6,1,6,2],[0,3,7,0,7,4]]; for(const face of F) for(const i of face){ const p=v[i]; m.positions.push(x+p[0],y+p[1],z+p[2]); m.colors.push(...c); } }

  function canvasFallback(reason){ state.renderer='canvas2d-fallback'; state.unsupported=true; state.fallbackReason=reason; const ctx=canvas.getContext('2d'); function fit(){ const dpr=Math.max(1,devicePixelRatio||1); canvas.width=innerWidth*dpr; canvas.height=innerHeight*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); state.effectiveDprX=dpr; state.effectiveDprY=dpr; } fit(); addEventListener('resize',fit); const strands=Array.from({length:64},()=>({a:rand()*6.28,r:.2+rand()*1.5,b:Math.floor(rand()*16)})); const start=performance.now(); function draw(now){ const t=Number.isFinite(lockedTime)?lockedTime:(now-start)/1000, fft=bands(t); ctx.fillStyle='#02030a'; ctx.fillRect(0,0,innerWidth,innerHeight); ctx.translate(innerWidth/2,innerHeight/2); for(const s of strands){ s.a+=.002+fft[s.b]*.01; ctx.beginPath(); for(let i=0;i<50;i++){ const u=i/49, r=s.r*(1-u*.86)*Math.min(innerWidth,innerHeight)*.33, a=s.a+u*7+t*.08; const x=Math.cos(a)*r, y=Math.sin(a)*r*.72; i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.strokeStyle=`rgba(130,210,255,${.15+fft[s.b]*.55})`; ctx.stroke(); } ctx.setTransform(state.effectiveDprX,0,0,state.effectiveDprY,0,0); if(status) status.textContent=`${reason} · seed ${seed}`; requestAnimationFrame(draw);} requestAnimationFrame(draw); }
  function perspective(fovy, aspect, near, far){ const f=1/Math.tan(fovy/2), nf=1/(near-far); return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]; }
  function lookAt(e,c,u){ const z=norm([e[0]-c[0],e[1]-c[1],e[2]-c[2]]), x=norm(cross(u,z)), y=cross(z,x); return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,e),-dot(y,e),-dot(z,e),1]; }
  function m4mul(a,b){ const o=new Array(16).fill(0); for(let r=0;r<4;r++) for(let c=0;c<4;c++) for(let k=0;k<4;k++) o[c*4+r]+=a[k*4+r]*b[c*4+k]; return o; }
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];} function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];} function norm(v){const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l];}
})();
