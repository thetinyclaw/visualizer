(() => {
  const cfg = window.STIPPLE_CONFIG;
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const info = document.getElementById('info');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('WebGL unavailable');

  let audioCtx, analyser, freqArray, audioStartPromise;
  let bass = 0, mid = 0, treble = 0;
  let sb = 0, sm = 0, st = 0;
  const seed = Math.random() * 9999;
  const start = performance.now();

  const vert = `attribute vec2 p; void main(){ gl_Position=vec4(p,0.0,1.0); }`;
  const frag = `
precision highp float;
uniform vec2 resolution;
uniform float time, bass, mid, treble, seed;
uniform int variant;
uniform vec3 c1, c2, c3, bg;
#define TAU 6.28318530718
float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5; } return v; }
vec2 curl(vec2 p){ float e=0.015,n=noise(p),x=noise(p+vec2(e,0.0)),y=noise(p+vec2(0.0,e)); return vec2(x-n,n-y)/e; }
float dotMask(vec2 p, float r){ return smoothstep(r, r*0.35, length(p)); }
void main(){
  vec2 uv=(gl_FragCoord.xy-resolution*0.5)/min(resolution.x,resolution.y);
  vec2 flow=curl(uv*2.2+time*0.07+seed)*0.08;
  vec2 p=uv+flow;
  float h=0.0;
  h+=sin(p.x*6.0+time*0.45+seed)*0.18;
  h+=cos(p.y*5.0-time*0.30)*0.14;
  h+=fbm(p*3.4+time*0.05)*0.55;
  h+=bass*0.18*sin(length(p)*10.0-time*2.0);

  float density = variant==1 ? 74.0 : (variant==2 ? 92.0 : 86.0);
  vec2 grid=(p+vec2(h*0.08, h*0.04))*density;
  vec2 cell=floor(grid), local=fract(grid)-0.5;
  float rnd=hash(cell+seed);
  local += (vec2(hash(cell+3.1), hash(cell+8.7))-0.5)*0.34;
  float radius=(variant==1 ? 0.18 : 0.14) + h*0.05 + mid*0.04;
  float dot=dotMask(local, radius);

  float contour=smoothstep(0.035,0.0,abs(fract(h*7.0+0.5)-0.5));
  float ridge=smoothstep(0.7,1.0,fbm(p*8.0+seed));
  float glitter=step(0.988, hash(cell+floor(time*8.0)+seed))*smoothstep(0.35,1.0,treble);
  float glass=pow(max(0.0, 1.0-length(local*vec2(1.4,0.8))), 8.0);
  float grain=(hash(gl_FragCoord.xy+seed)-0.5)*0.05;

  vec3 col=bg;
  if(variant==0){
    vec3 topo=mix(c1,c2,clamp(h+0.45,0.0,1.0));
    col=mix(col, topo, dot*(0.65+0.35*contour));
    col+=c3*contour*(0.25+0.35*dot);
  } else if(variant==1){
    vec3 reef=mix(c1,c2,fbm(p*2.0+seed));
    col=mix(col, reef, dot*0.85);
    col+=c3*(glass*0.45 + glitter*0.9 + ridge*0.12);
    col+=vec3(0.15,0.55,0.95)*sin((uv.x+uv.y+time*0.12)*45.0)*0.025;
  } else {
    float ink=dot*(0.35+0.65*smoothstep(-0.25,0.75,h));
    float dune=smoothstep(0.03,0.0,abs(sin((p.x*3.0+p.y*5.0+h*2.0)*TAU)));
    col=mix(bg,c1,ink);
    col=mix(col,c2,dune*0.35);
    col+=c3*contour*0.18;
    col+=grain;
  }
  float vignette=1.0-length(uv)*0.35;
  gl_FragColor=vec4(col*vignette,1.0);
}`;

  function shader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['resolution','time','bass','mid','treble','seed','variant','c1','c2','c3','bg'].map(k => [k, gl.getUniformLocation(prog, k)]));

  function hex(v){ v=v.replace('#',''); return [0,2,4].map(i => parseInt(v.slice(i,i+2),16)/255); }
  function resize(){ const dpr=Math.min(devicePixelRatio||1,2); canvas.style.width=innerWidth+'px'; canvas.style.height=innerHeight+'px'; canvas.width=innerWidth*dpr|0; canvas.height=innerHeight*dpr|0; gl.viewport(0,0,canvas.width,canvas.height); }
  addEventListener('resize', resize); resize();
  gl.uniform1f(u.seed, seed); gl.uniform1i(u.variant, cfg.variant);
  gl.uniform3fv(u.c1, hex(cfg.colors[0])); gl.uniform3fv(u.c2, hex(cfg.colors[1])); gl.uniform3fv(u.c3, hex(cfg.colors[2])); gl.uniform3fv(u.bg, hex(cfg.colors[3]));

  function band(a,b){ if(!freqArray) return 0; let s=0, i0=(a*freqArray.length)|0, i1=(b*freqArray.length)|0; for(let i=i0;i<i1;i++) s+=freqArray[i]; return s/(i1-i0)/255; }
  function audio(){ if(analyser){ analyser.getByteFrequencyData(freqArray); bass=band(0,0.12); mid=band(0.12,0.55); treble=band(0.55,1); } else { const t=(performance.now()-start)/1000; bass=.45+.35*Math.sin(t*1.7); mid=.4+.28*Math.sin(t*2.1+1); treble=.35+.3*Math.sin(t*6.4); } sb=sb*.82+bass*.18; sm=sm*.84+mid*.16; st=st*.86+treble*.14; }
  async function startAudio(){ if(audioStartPromise) return audioStartPromise; audioStartPromise=(async()=>{ overlay.classList.add('hidden'); try{ audioCtx=new (AudioContext||webkitAudioContext)(); if(audioCtx.state==='suspended') await audioCtx.resume(); const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false}); analyser=audioCtx.createAnalyser(); analyser.fftSize=512; audioCtx.createMediaStreamSource(stream).connect(analyser); freqArray=new Uint8Array(analyser.frequencyBinCount); } catch(e){ console.warn('demo audio', e); } })(); return audioStartPromise; }
  overlay.addEventListener('pointerup', e => { e.preventDefault(); startAudio(); });
  overlay.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); startAudio(); }});
  document.addEventListener('keydown', e => { if(e.key==='r'||e.key==='R') location.reload(); });

  function frame(now){ audio(); gl.uniform2f(u.resolution, canvas.width, canvas.height); gl.uniform1f(u.time, (now-start)/1000); gl.uniform1f(u.bass, sb); gl.uniform1f(u.mid, sm); gl.uniform1f(u.treble, st); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); info.textContent = `${cfg.title} | demo/mic reactive | R reload`; requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
})();
