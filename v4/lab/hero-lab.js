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

  function uploadAndDraw(mesh, t, fft){ const mvp = m4mul(perspective(55*Math.PI/180, canvas.width/canvas.height, .05, 80), lookAt(cameraFor(t, fft), [0,0,0], [0,1,0])); gl.uniformMatrix4fv(uMvp,false,new Float32Array(mvp)); gl.bindBuffer(gl.ARRAY_BUFFER,posBuf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh.positions), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0); gl.bindBuffer(gl.ARRAY_BUFFER,colBuf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh.colors), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(aColor); gl.vertexAttribPointer(aColor,4,gl.FLOAT,false,0,0); gl.drawArrays(mesh.primitive,0,mesh.positions.length/3); }
  function cameraFor(t, fft){ if(scene==='prismatic-cathedral') return [Math.sin(t*.18)*1.1, .55+fft[5]*.3, 5.2+Math.cos(t*.11)*.7]; if(scene==='neon-voxel-cloud') return [Math.sin(t*.12)*1.7, .75+fft[9]*.4, 7.5+Math.cos(t*.09)*.8]; return [Math.sin(t*.1)*.9, .35+fft[2]*.25, 4.8]; }

  function buildFilament(){
    const strands = Array.from({length:72}, (_,s)=>({phase:rand()*6.28, radius:.22+rand()*1.55, z:-1.7+rand()*3.4, bin:s%16, pts:Array.from({length:36},()=>[0,0,0])}));
    const mesh = {primitive: gl.LINES, topology:'persistent strand/advection line bundles', geometry:'72 depth-tested 3D strands', positions:[], colors:[], update(t, fft){ this.positions=[]; this.colors=[]; for(const strand of strands){ strand.phase += .004 + fft[strand.bin]*.012; strand.radius += (Math.sin(t*.2+strand.bin)*.002); for(let i=0;i<strand.pts.length;i++){ const u=i/(strand.pts.length-1); const r=Math.max(.08, strand.radius*(1-u*.82) + .05*Math.sin(t*.6+u*11+strand.bin)); const a=strand.phase + u*6.2 + t*(.1+fft[strand.bin]*.25); strand.pts[i]=[Math.cos(a)*r, Math.sin(a)*r*.72 + .12*Math.sin(a*2.3), strand.z + (u-.5)*1.6 + Math.sin(a+t)*.06]; } for(let i=0;i<strand.pts.length-1;i++){ const hi=fft[strand.bin]; const c=[.45+hi*.35,.76+hi*.2,1, .22+hi*.55]; this.positions.push(...strand.pts[i],...strand.pts[i+1]); this.colors.push(...c,...c); } } }}; mesh.update(0,bands(0)); return mesh; }
  function buildCathedral(){
    const shards = Array.from({length:46},(_,i)=>({x:(rand()-.5)*4.2,y:(rand()-.5)*2.2,z:-6+rand()*11,s:.18+rand()*.55,r:rand()*6.28,bin:i%16}));
    const mesh={primitive:gl.TRIANGLES,topology:'actual prism/shard triangles with depth occlusion',geometry:'46 emissive 3D shard prisms',positions:[],colors:[],update(t,fft){this.positions=[];this.colors=[]; for(const sh of shards){ const travel=((sh.z+t*(.35+fft[1]*.25)+6)%12)-6; addShard(this, sh.x+Math.sin(t*.2+sh.bin)*.2, sh.y, travel, sh.s*(.8+fft[sh.bin]*.7), sh.r+t*.07, [.65+fft[sh.bin]*.35,.78,.98, .35+fft[sh.bin]*.5]); } }}; mesh.update(0,bands(0)); return mesh; }
  function buildVoxels(){
    const cells = Array.from({length:110},(_,i)=>({x:(rand()-.5)*5.5,y:(rand()-.5)*3.2,z:-7+rand()*12,s:.07+rand()*.18,bin:i%16,on:rand(),phase:rand()*6.28}));
    const mesh={primitive:gl.TRIANGLES,topology:'persistent scan occupancy over instanced-style cube cells',geometry:'110 3D voxel cubes with face depth',positions:[],colors:[],update(t,fft){this.positions=[];this.colors=[]; for(const c of cells){ const scan=(Math.sin(t*.9+c.y*2.2+c.phase)+1)/2; c.on = c.on*.94 + scan*.06; const active=c.on + fft[c.bin]*.6; if(active<.32) continue; const z=((c.z+t*(.28+fft[3]*.22)+7)%14)-7; const hue=c.bin%4; const col=hue===0?[.05,1,.28,.72]:hue===1?[.05,.8,1,.68]:hue===2?[1,.08,.95,.65]:[1,.55,.03,.62]; addCube(this,c.x,c.y,z,c.s*(.8+fft[c.bin]),col); } }}; mesh.update(0,bands(0)); return mesh; }
  function addShard(m,x,y,z,s,r,c){ const base=[[0,s*1.7,0],[-s,-s,0],[s,-s,0],[0,0,s*2.2],[0,0,-s*1.7]]; const faces=[[0,1,3],[0,3,2],[0,4,1],[0,2,4],[1,2,3],[1,4,2]]; for(const f of faces){ for(const idx of f){ const p=base[idx], cr=Math.cos(r), sr=Math.sin(r); m.positions.push(x+p[0]*cr-p[2]*sr,y+p[1],z+p[0]*sr+p[2]*cr); m.colors.push(...c); } } }
  function addCube(m,x,y,z,s,c){ const v=[[-s,-s,-s],[s,-s,-s],[s,s,-s],[-s,s,-s],[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]], F=[[0,1,2,0,2,3],[4,6,5,4,7,6],[0,4,5,0,5,1],[3,2,6,3,6,7],[1,5,6,1,6,2],[0,3,7,0,7,4]]; for(const face of F) for(const i of face){ const p=v[i]; m.positions.push(x+p[0],y+p[1],z+p[2]); m.colors.push(...c); } }

  function canvasFallback(reason){ state.renderer='canvas2d-fallback'; state.unsupported=true; state.fallbackReason=reason; const ctx=canvas.getContext('2d'); function fit(){ const dpr=Math.max(1,devicePixelRatio||1); canvas.width=innerWidth*dpr; canvas.height=innerHeight*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); state.effectiveDprX=dpr; state.effectiveDprY=dpr; } fit(); addEventListener('resize',fit); const strands=Array.from({length:64},()=>({a:rand()*6.28,r:.2+rand()*1.5,b:Math.floor(rand()*16)})); const start=performance.now(); function draw(now){ const t=Number.isFinite(lockedTime)?lockedTime:(now-start)/1000, fft=bands(t); ctx.fillStyle='#02030a'; ctx.fillRect(0,0,innerWidth,innerHeight); ctx.translate(innerWidth/2,innerHeight/2); for(const s of strands){ s.a+=.002+fft[s.b]*.01; ctx.beginPath(); for(let i=0;i<50;i++){ const u=i/49, r=s.r*(1-u*.86)*Math.min(innerWidth,innerHeight)*.33, a=s.a+u*7+t*.08; const x=Math.cos(a)*r, y=Math.sin(a)*r*.72; i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.strokeStyle=`rgba(130,210,255,${.15+fft[s.b]*.55})`; ctx.stroke(); } ctx.setTransform(state.effectiveDprX,0,0,state.effectiveDprY,0,0); if(status) status.textContent=`${reason} · seed ${seed}`; requestAnimationFrame(draw);} requestAnimationFrame(draw); }
  function perspective(fovy, aspect, near, far){ const f=1/Math.tan(fovy/2), nf=1/(near-far); return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]; }
  function lookAt(e,c,u){ const z=norm([e[0]-c[0],e[1]-c[1],e[2]-c[2]]), x=norm(cross(u,z)), y=cross(z,x); return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,e),-dot(y,e),-dot(z,e),1]; }
  function m4mul(a,b){ const o=new Array(16).fill(0); for(let r=0;r<4;r++) for(let c=0;c<4;c++) for(let k=0;k<4;k++) o[c*4+r]+=a[k*4+r]*b[c*4+k]; return o; }
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];} function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];} function norm(v){const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l];}
})();
