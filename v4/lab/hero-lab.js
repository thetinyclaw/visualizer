((root, factory) => {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.start(root);
})(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  const CONTRACTS = Object.freeze({
    filament: { scene: 'filament-vortex', strands: 118, pointsPerStrand: 52, ribbonLayers: 3, maxVertices: 118 * 51 * 6 * 3, occupiedSilhouette: 0.70, lineBundleWidth: 0.022, cameraZ: 4.65 },
    cathedral: { scene: 'prismatic-cathedral', arches: 13, shards: 72, maxVertices: 7200, nearPlaneClearance: 3.25, maxShardSize: 0.34, corridorHalfWidth: 1.04, cameraZ: 4.85 },
    voxels: { scene: 'neon-voxel-cloud', cells: 260, maxVertices: (260 + 58) * 36, coherentMassRadius: 2.95, maxCubeSize: 0.24, cameraZ: 6.05 },
  });
  const SCENE_TO_KEY = Object.freeze({ 'filament-vortex': 'filament', 'prismatic-cathedral': 'cathedral', 'neon-voxel-cloud': 'voxels' });

  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function pulse(t, i, seed, inputMode){ if (inputMode === 'flat') return 0; return .5 + .5 * Math.sin(t * (.55 + i * .071) + i * 1.91 + seed * .00013); }
  function fillBands(out, t, seed, inputMode){ for(let i=0;i<16;i++) out[i]=.04 + .62*Math.exp(-Math.pow((i-(2+pulse(t,1,seed,inputMode)*2))/1.7,2)) + .45*Math.exp(-Math.pow((i-(7+pulse(t,3,seed,inputMode)*4))/2.2,2)) + .28*Math.exp(-Math.pow((i-(12+pulse(t,5,seed,inputMode)*3))/1.9,2)); return out; }

  function makeMesh(maxVertices, primitiveName){
    return { primitiveName, primitive: null, maxVertices, positions: new Float32Array(maxVertices * 3), colors: new Float32Array(maxVertices * 4), vertexCount: 0, bounds: { minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0 }, reset(){ this.vertexCount = 0; this.bounds.minX=Infinity; this.bounds.minY=Infinity; this.bounds.minZ=Infinity; this.bounds.maxX=-Infinity; this.bounds.maxY=-Infinity; this.bounds.maxZ=-Infinity; } };
  }
  function pushVertex(m,x,y,z,c){ const v=m.vertexCount++; if(v>=m.maxVertices) throw new Error(`mesh capacity exceeded: ${m.primitiveName}`); let p=v*3, q=v*4; m.positions[p]=x; m.positions[p+1]=y; m.positions[p+2]=z; m.colors[q]=c[0]; m.colors[q+1]=c[1]; m.colors[q+2]=c[2]; m.colors[q+3]=c[3]; if(x<m.bounds.minX)m.bounds.minX=x; if(x>m.bounds.maxX)m.bounds.maxX=x; if(y<m.bounds.minY)m.bounds.minY=y; if(y>m.bounds.maxY)m.bounds.maxY=y; if(z<m.bounds.minZ)m.bounds.minZ=z; if(z>m.bounds.maxZ)m.bounds.maxZ=z; }
  function addRibbon(m, ax,ay,az, bx,by,bz, w, c){ const dx=bx-ax, dy=by-ay, l=Math.hypot(dx,dy)||1, nx=-dy/l*w, ny=dx/l*w; pushVertex(m,ax+nx,ay+ny,az,c); pushVertex(m,ax-nx,ay-ny,az,c); pushVertex(m,bx+nx,by+ny,bz,c); pushVertex(m,ax-nx,ay-ny,az,c); pushVertex(m,bx-nx,by-ny,bz,c); pushVertex(m,bx+nx,by+ny,bz,c); }
  function addBeam(m,x1,y1,z1,x2,y2,z2,w,c){ addRibbon(m,x1,y1,z1,x2,y2,z2,w,c); }
  function addArch(m,x,y,z,w,h,top,thick,c){ addBeam(m,x-w,y,z,x-w,y+h,z,thick,c); addBeam(m,x+w,y,z,x+w,y+h,z,thick,c); const steps=13; for(let i=0;i<steps;i++){ const a=Math.PI*(i/steps), b=Math.PI*((i+1)/steps); addBeam(m,x+Math.cos(a)*w,y+h+Math.sin(a)*top*.34,z,x+Math.cos(b)*w,y+h+Math.sin(b)*top*.34,z,thick,c); } }
  function addShard(m,x,y,z,s,r,c){ const cr=Math.cos(r), sr=Math.sin(r); const base=[[0,s*1.85,0],[-s*.86,-s*.96,-s*.18],[s*.86,-s*.88,s*.16],[0,0,s*1.72],[0,0,-s*1.42],[-s*.34,s*.18,s*.46],[s*.28,s*.12,-s*.52]]; const faces=[[0,1,3],[0,3,2],[0,4,1],[0,2,4],[1,5,3],[2,3,6],[1,4,5],[2,6,4],[5,4,6],[5,6,3]]; for(const f of faces){ for(const idx of f){ const p=base[idx]; pushVertex(m,x+p[0]*cr-p[2]*sr,y+p[1],z+p[0]*sr+p[2]*cr,c); } } }
  function addFloorRunes(m,t,fft){ for(let i=0;i<30;i++){ const z=1.15-i*.255, w=.28+i*.035, a=.12+fft[i%16]*.11, y=-.98-.018*Math.sin(t+i); addBeam(m,-w,y,z,w,y,z-.10,.012,[.18,.72,1,a]); addBeam(m,-w*.65,y-.035,z-.08,w*.65,y-.035,z-.17,.008,[.95,.54,1,a*.55]); } }
  function addCube(m,x,y,z,s,c){ const v=[[-s,-s,-s],[s,-s,-s],[s,s,-s],[-s,s,-s],[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]], F=[[0,1,2,0,2,3],[4,6,5,4,7,6],[0,4,5,0,5,1],[3,2,6,3,6,7],[1,5,6,1,6,2],[0,3,7,0,7,4]]; for(const face of F) for(const i of face){ const p=v[i]; pushVertex(m,x+p[0],y+p[1],z+p[2],c); } }

  function buildFilament(ctx){
    const rand=ctx.rand, cfg=CONTRACTS.filament, pts=new Float32Array(cfg.strands*cfg.pointsPerStrand*3);
    const strands = Array.from({length:cfg.strands}, (_,s)=>{ const phase=rand()*6.28, radius=.82+rand()*1.25; return {phase, radius, basePhase:phase, baseRadius:radius, z:-2.05+rand()*4.1, bin:s%16, tier:s%5, handed:s%2?1:-1}; });
    const mesh = makeMesh(cfg.maxVertices, 'triangles');
    mesh.topology='118 persistent strand/advection ribbon bundles × 52 samples; unlocked frames mutate phase/radius in place while locked captures derive from immutable seed state + absolute time';
    mesh.geometry='118x52 ribbon strands'; mesh.contract=cfg; mesh.stateful=strands;
    function renderFilaments(t,fft,absolute){ mesh.reset(); let ptr=0; for(const strand of strands){ const hi=fft[strand.bin]; let phase, radius; if(absolute){ phase = strand.basePhase + strand.handed*t*(.006 + hi*.014)*60; radius = strand.baseRadius + Math.sin(t*.27+strand.bin)*.00135*60; } else { strand.phase += strand.handed*(.006 + hi*.014); strand.radius += Math.sin(t*.27+strand.bin)*.00135; phase = strand.phase; radius = strand.radius; } for(let i=0;i<cfg.pointsPerStrand;i++){ const u=i/(cfg.pointsPerStrand-1); const funnel=1.18-u*.76; const r=Math.max(.13, radius*funnel + .070*Math.sin(t*.72+u*13.7+strand.bin)); const a=phase + strand.handed*(u*9.25 + t*(.18+hi*.38)); pts[ptr++]=Math.cos(a)*r; pts[ptr++]=Math.sin(a)*r*(.66+.07*Math.sin(u*6.28+strand.tier)) + .12*Math.sin(a*2.1+u*4.0); pts[ptr++]=strand.z + (u-.5)*2.45 + Math.sin(a+t*.7)*.09; }
      let start=ptr-cfg.pointsPerStrand*3; for(let i=0;i<cfg.pointsPerStrand-1;i++){ const u=i/(cfg.pointsPerStrand-1), a=start+i*3, b=a+3; const w=(.0065+.0045*(strand.tier===0)+hi*.009)*(1.10-u*.40); const halo=[.05+hi*.10,.28+hi*.16,1,.055+hi*.075], core=[.72+hi*.22,.94+hi*.06,1,.46+hi*.18], fine=[.98,1,1,.26+hi*.14]; addRibbon(mesh,pts[a],pts[a+1],pts[a+2],pts[b],pts[b+1],pts[b+2],w*2.4,halo); addRibbon(mesh,pts[a],pts[a+1],pts[a+2],pts[b],pts[b+1],pts[b+2],w*.82,core); addRibbon(mesh,pts[a]*1.012,pts[a+1]*1.012,pts[a+2]+.012,pts[b]*1.012,pts[b+1]*1.012,pts[b+2]+.012,w*.24,fine); }
    } mesh.summary = summarize(mesh); }
    mesh.update=(t,fft)=>{ renderFilaments(t,fft,true); };
    mesh.step=(t,fft)=>{ renderFilaments(t,fft,false); };
    return mesh;
  }
  function buildCathedral(ctx){
    const rand=ctx.rand, cfg=CONTRACTS.cathedral;
    const arches = Array.from({length:cfg.arches},(_,i)=>({z:1.55-i*.46, bin:i%16, skew:(rand()-.5)*.12, glow:rand()}));
    const shards = Array.from({length:cfg.shards},(_,i)=>{ const side=i%2?-1:1, lane=i%3, depth=1.65-rand()*6.7, wall=1.02+rand()*.62+lane*.12; return {x:side*wall+(rand()-.5)*.16,y:-.62+rand()*2.08,z:depth,s:.064+rand()*.155,r:rand()*6.28,bin:i%16,side,lane}; });
    const mesh=makeMesh(cfg.maxVertices,'triangles'); mesh.topology='13 arch corridor ribs plus 72 persistent prismatic shard meshes, layered floor reflections, central traversable void'; mesh.geometry='13 arches + 72 shards'; mesh.contract=cfg; mesh.stateful=shards;
    mesh.update=(t,fft)=>{ mesh.reset(); for(const a of arches){ const z=((a.z+t*(.28+fft[1]*.12)+4.7)%6.25)-4.7; const pulseA=.55+fft[a.bin]*.45; const edge=[.70,.93,1,.58+.22*pulseA], core=[1,.62+fft[a.bin]*.25,.96,.27+.18*pulseA]; addArch(mesh,a.skew,.00,z,1.33,.58,2.45,.040+.018*fft[a.bin],edge); addArch(mesh,a.skew,-.015,z-.05,1.08,.44,2.05,.017,core); addBeam(mesh,-.68,.82,z,.68,.82,z-.16,.024,core); addBeam(mesh,.68,.82,z,-.68,.82,z-.16,.024,core); }
      for(const sh of shards){ const travel=((sh.z+t*(.30+fft[sh.bin]*.16)+4.95)%6.85)-4.95; const wallPush=.07*Math.sin(t*.45+sh.bin); const depthGlow=1-Math.max(0,Math.min(1,(travel+4.95)/6.85)); const highTrim=sh.y>1.02?.76:1; const size=Math.min(cfg.maxShardSize,sh.s*(1.18+fft[sh.bin]*.52)*(sh.lane===2?.82:1)*highTrim); const alpha=.30+fft[sh.bin]*.27+depthGlow*.16; addShard(mesh, sh.x+sh.side*wallPush, sh.y, travel, size, sh.r+t*(.10+fft[sh.bin]*.10), [.66+fft[sh.bin]*.28,.86,.99, alpha]); addShard(mesh, sh.x*.92, -1.20-(sh.y+.6)*.05, travel-.04, size*.54, -sh.r+t*.04, [.48,.38+.32*fft[sh.bin],1, alpha*.25]); }
      addFloorRunes(mesh,t,fft); mesh.summary=summarize(mesh); };
    return mesh;
  }
  function buildVoxels(ctx){
    const rand=ctx.rand, cfg=CONTRACTS.voxels;
    const cells = Array.from({length:cfg.cells},(_,i)=>{ const z=-4.8+rand()*6.7, theta=z*1.08 + rand()*2.35, shell=Math.pow(rand(),.62), tunnel=.42+shell*2.58; return {x:Math.cos(theta)*tunnel+(rand()-.5)*.52,y:Math.sin(theta)*tunnel*.72+(rand()-.5)*.42,z,s:.052+rand()*.116,bin:i%16,on:.38+rand()*.40,phase:rand()*6.28,core:shell<.30,large:rand()>.72}; });
    const mesh=makeMesh(cfg.maxVertices,'triangles'); mesh.topology='260 persistent cube cells in a nonuniform tunnel cloud with smoothed diagonal scan-front occupancy and fog hierarchy'; mesh.geometry='260 voxels'; mesh.contract=cfg; mesh.stateful=cells;
    mesh.update=(t,fft)=>{ mesh.reset(); for(const c of cells){ const z=((c.z+t*(.30+fft[3]*.14)+4.9)%6.9)-4.9; const front=z*.82+c.y*1.36+c.x*.20-t*1.15; const scan=Math.exp(-Math.pow(Math.sin(front+c.phase*.14)*1.38,2.0)); c.on = c.on*.88 + scan*.12; const active=c.on + fft[c.bin]*.55; if(active<.26) continue; const drift=.18*Math.sin(t*.33+c.phase); const hue=c.bin%3; const fog=Math.max(.30,1-(z+4.9)/7.4); const alpha=(.34+active*.40)*fog; const col=hue===0?[.08,.95,1,alpha]:hue===1?[.82,.18,1,alpha*.96]:[.25,1,.58,alpha*.92]; const size=Math.min(cfg.maxCubeSize,c.s*(c.core?1.70:(c.large?1.33:.92))*(.98+fft[c.bin]*.82)); addCube(mesh,c.x+drift,c.y+.12*Math.sin(t*.42+c.bin),z,size,col); }
      for(let k=0;k<58;k++){ const z=((1.8-k*.15+t*.34+4.9)%6.9)-4.9, r=.52+k*.032, a=t*.45+k*.43; const scanA=.22+.20*Math.exp(-Math.pow(k-18-fft[5]*14,2)/120); addCube(mesh,Math.cos(a)*r,Math.sin(a)*r*.62,z,.040+k*.0008,[.66,.98,1,scanA]); } mesh.summary=summarize(mesh); };
    return mesh;
  }
  function summarize(mesh){ const b=mesh.bounds; return { vertexCount: mesh.vertexCount, bounds: { minX:+b.minX.toFixed(3), maxX:+b.maxX.toFixed(3), minY:+b.minY.toFixed(3), maxY:+b.maxY.toFixed(3), minZ:+b.minZ.toFixed(3), maxZ:+b.maxZ.toFixed(3) }, width:+(b.maxX-b.minX).toFixed(3), height:+(b.maxY-b.minY).toFixed(3), depth:+(b.maxZ-b.minZ).toFixed(3) }; }

  function createHeadlessScene(scene, seed=491009, inputMode='demo'){
    const rand=mulberry32(seed), ctx={seed,inputMode,rand}, key=SCENE_TO_KEY[scene] || 'filament';
    const mesh=key==='filament'?buildFilament(ctx):key==='cathedral'?buildCathedral(ctx):buildVoxels(ctx);
    const fft=new Float32Array(16); fillBands(fft,0,seed,inputMode); mesh.update(0,fft);
    return { scene, seed, inputMode, mesh, fft, update(t){ fillBands(fft,t,seed,inputMode); mesh.update(t,fft); return mesh.summary; } };
  }

  function perspective(out, fovy, aspect, near, far){ const f=1/Math.tan(fovy/2), nf=1/(near-far); out[0]=f/aspect;out[1]=0;out[2]=0;out[3]=0; out[4]=0;out[5]=f;out[6]=0;out[7]=0; out[8]=0;out[9]=0;out[10]=(far+near)*nf;out[11]=-1; out[12]=0;out[13]=0;out[14]=2*far*near*nf;out[15]=0; return out; }
  function lookAt(out,e,c,u){ const zx=e[0]-c[0],zy=e[1]-c[1],zz=e[2]-c[2],zl=Math.hypot(zx,zy,zz)||1, z0=zx/zl,z1=zy/zl,z2=zz/zl; let x0=u[1]*z2-u[2]*z1,x1=u[2]*z0-u[0]*z2,x2=u[0]*z1-u[1]*z0; const xl=Math.hypot(x0,x1,x2)||1; x0/=xl;x1/=xl;x2/=xl; const y0=z1*x2-z2*x1,y1=z2*x0-z0*x2,y2=z0*x1-z1*x0; out[0]=x0;out[1]=y0;out[2]=z0;out[3]=0; out[4]=x1;out[5]=y1;out[6]=z1;out[7]=0; out[8]=x2;out[9]=y2;out[10]=z2;out[11]=0; out[12]=-(x0*e[0]+x1*e[1]+x2*e[2]);out[13]=-(y0*e[0]+y1*e[1]+y2*e[2]);out[14]=-(z0*e[0]+z1*e[1]+z2*e[2]);out[15]=1; return out; }
  function m4mul(out,a,b){ for(let r=0;r<4;r++) for(let c=0;c<4;c++) out[c*4+r]=a[0*4+r]*b[c*4+0]+a[1*4+r]*b[c*4+1]+a[2*4+r]*b[c*4+2]+a[3*4+r]*b[c*4+3]; return out; }
  function cameraFor(out,scene,t,fft){ if(scene==='prismatic-cathedral'){ out[0]=Math.sin(t*.18)*.38; out[1]=.70+fft[5]*.16; out[2]=CONTRACTS.cathedral.cameraZ+Math.cos(t*.11)*.22; } else if(scene==='neon-voxel-cloud'){ out[0]=Math.sin(t*.14)*.62; out[1]=.35+fft[9]*.13; out[2]=CONTRACTS.voxels.cameraZ+Math.cos(t*.09)*.20; } else { out[0]=Math.sin(t*.1)*.46; out[1]=.15+fft[2]*.15; out[2]=CONTRACTS.filament.cameraZ; } return out; }

  function start(window){
    const document=window.document, scene = window.V4_HERO_SCENE || 'filament-vortex', params = new URLSearchParams(window.location.search), seed = Number.parseInt(params.get('seed') || '491009', 10) || 491009, lockedTime = params.has('time') ? Number.parseFloat(params.get('time')) : null, inputMode = params.get('mode') || 'demo';
    const canvas=document.getElementById('hero-canvas'), status=document.getElementById('status'), state={scene,seed,inputMode,lockedTime,renderer:'webgl2',unsupported:false,fallbackReason:'',structuralAudio:true,persistentState:true,nativeDensity:true, contracts:CONTRACTS}; window.__V4_HERO_LAB__=state;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }) || canvas.getContext('webgl', { antialias: true, alpha: false });
    if(!gl) return canvasFallback(window, canvas, status, state, seed, inputMode, lockedTime, 'WebGL unavailable; topology-preserving Canvas fallback active');
    const vs=`attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uMvp; varying vec4 vColor; void main(){ vColor=aColor; gl_Position=uMvp*vec4(aPos,1.0); }`;
    const fs=`precision mediump float; varying vec4 vColor; void main(){ gl_FragColor=vec4(vColor.rgb, vColor.a); }`;
    function compile(type, src){ const s=gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    function link(v, f){ const p=gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, v)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
    const program=link(vs,fs); gl.useProgram(program); const aPos=gl.getAttribLocation(program,'aPos'), aColor=gl.getAttribLocation(program,'aColor'), uMvp=gl.getUniformLocation(program,'uMvp');
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const headless=createHeadlessScene(scene,seed,inputMode), mesh=headless.mesh; mesh.primitive=gl.TRIANGLES; state.vertexTopology=mesh.topology; state.geometry=mesh.geometry; state.webgpuViable=false; state.webgpuFallback=scene==='filament-vortex'?'WebGL2 ribbon fallback used instead of WebGPU/WGSL; persistent CPU advection topology preserved.':'not requested';
    const posBuf=gl.createBuffer(), colBuf=gl.createBuffer(), fft=headless.fft, proj=new Float32Array(16), view=new Float32Array(16), mvp=new Float32Array(16), cam=new Float32Array(3), center=new Float32Array([0,0,0]), up=new Float32Array([0,1,0]);
    gl.bindBuffer(gl.ARRAY_BUFFER,posBuf); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions.byteLength, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,colBuf); gl.bufferData(gl.ARRAY_BUFFER, mesh.colors.byteLength, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(aColor); gl.vertexAttribPointer(aColor,4,gl.FLOAT,false,0,0);
    function resize(){ const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,2)); canvas.width=Math.floor(window.innerWidth*dpr); canvas.height=Math.floor(window.innerHeight*dpr); canvas.style.width=window.innerWidth+'px'; canvas.style.height=window.innerHeight+'px'; gl.viewport(0,0,canvas.width,canvas.height); state.effectiveDprX=canvas.width/window.innerWidth; state.effectiveDprY=canvas.height/window.innerHeight; state.nativeDensity=state.effectiveDprX>=.999&&state.effectiveDprY>=.999; }
    window.addEventListener('resize',resize); resize(); const startTime=window.performance.now();
    function frame(now){ const locked=Number.isFinite(lockedTime), t=locked?lockedTime:(now-startTime)/1000; fillBands(fft,t,seed,inputMode); gl.clearColor(.002,.004,.014,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); if(!locked && mesh.step) mesh.step(t,fft); else mesh.update(t,fft); center[0]=0; center[1]=scene==='prismatic-cathedral'?.10:0; center[2]=scene==='prismatic-cathedral'?-1.55:0; perspective(proj,50*Math.PI/180,canvas.width/canvas.height,.05,80); lookAt(view,cameraFor(cam,scene,t,fft),center,up); m4mul(mvp,proj,view); gl.uniformMatrix4fv(uMvp,false,mvp); gl.bindBuffer(gl.ARRAY_BUFFER,posBuf); gl.bufferSubData(gl.ARRAY_BUFFER,0,mesh.positions.subarray(0,mesh.vertexCount*3)); gl.bindBuffer(gl.ARRAY_BUFFER,colBuf); gl.bufferSubData(gl.ARRAY_BUFFER,0,mesh.colors.subarray(0,mesh.vertexCount*4)); gl.drawArrays(mesh.primitive,0,mesh.vertexCount); state.summary=mesh.summary; state.vertexCount=mesh.vertexCount; state.bounds=mesh.summary.bounds; if(status && (!status._t || now-status._t>250)){ status._t=now; status.textContent=`seed ${seed} · ${inputMode} input · ${mesh.geometry} · ${mesh.vertexCount} verts · DPR ${state.effectiveDprX.toFixed(2)} · ${scene==='filament-vortex'?'WebGL fallback, WebGPU noted':'WebGL depth'}`; } window.requestAnimationFrame(frame); }
    window.requestAnimationFrame(frame);
  }

  function canvasFallback(window, canvas, status, state, seed, inputMode, lockedTime, reason){ state.renderer='canvas2d-fallback'; state.unsupported=true; state.fallbackReason=reason; const ctx=canvas.getContext('2d'), rand=mulberry32(seed), fft=new Float32Array(16); function fit(){ const dpr=Math.max(1,window.devicePixelRatio||1); canvas.width=window.innerWidth*dpr; canvas.height=window.innerHeight*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); state.effectiveDprX=dpr; state.effectiveDprY=dpr; } fit(); window.addEventListener('resize',fit); const strands=Array.from({length:64},()=>{ const a=rand()*6.28; return {a,baseA:a,r:.2+rand()*1.5,b:Math.floor(rand()*16)}; }); const start=window.performance.now(); function draw(now){ const locked=Number.isFinite(lockedTime), t=locked?lockedTime:(now-start)/1000; fillBands(fft,t,seed,inputMode); ctx.fillStyle='#02030a'; ctx.fillRect(0,0,window.innerWidth,window.innerHeight); ctx.save(); ctx.translate(window.innerWidth/2,window.innerHeight/2); for(const s of strands){ const a0=locked?s.baseA+t*(.002+fft[s.b]*.01)*60:(s.a+=.002+fft[s.b]*.01); ctx.beginPath(); for(let i=0;i<50;i++){ const u=i/49, r=s.r*(1-u*.86)*Math.min(window.innerWidth,window.innerHeight)*.33, a=a0+u*7+t*.08; const x=Math.cos(a)*r, y=Math.sin(a)*r*.72; i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.strokeStyle=`rgba(130,210,255,${.15+fft[s.b]*.55})`; ctx.stroke(); } ctx.restore(); if(status) status.textContent=`${reason} · seed ${seed}`; window.requestAnimationFrame(draw); } window.requestAnimationFrame(draw); }

  return { CONTRACTS, createHeadlessScene, fillBands, mulberry32, summarize, start };
});
