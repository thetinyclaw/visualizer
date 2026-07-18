(() => {
  const config = window.VISUALIZER_CANDIDATE;
  const params = new URLSearchParams(location.search);
  const seed = Number.isFinite(+params.get('seed')) ? +params.get('seed') : config.defaultSeed;
  const benchmarkMode = params.has('benchmark');
  const sampleFrames = Math.max(120, Math.min(600, parseInt(params.get('frames') || '120', 10)));
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const info = document.getElementById('info');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL unavailable');
  const common = `precision highp float;
uniform float time; uniform vec2 resolution; uniform float seed; uniform float bass; uniform float mid; uniform float treble;
uniform vec4 fftBinsA; uniform vec4 fftBinsB; uniform vec4 fftBinsC; uniform vec4 fftBinsD;
#define PI 3.14159265359
#define TAU 6.28318530718
float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3 += dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash2(vec2 p){ return vec2(hash(p), hash(p+vec2(127.1,311.7))); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v += a*noise(p); p = mat2(1.62,1.18,-1.18,1.62)*p + 0.17; a*=0.5; } return v; }
float fftBand(float key){ float index=floor(clamp(key,0.0,0.9999)*16.0); float group=floor(index*0.25); float lane=index-group*4.0; vec4 values; if(group<0.5) values=fftBinsA; else if(group<1.5) values=fftBinsB; else if(group<2.5) values=fftBinsC; else values=fftBinsD; vec4 mask=1.0-step(vec4(0.5),abs(vec4(0.0,1.0,2.0,3.0)-lane)); return dot(values,mask); }
float boxMetric(vec2 p, vec2 b){ vec2 d=abs(p)-b; return max(d.x,d.y); }
`;
  const fragSrc = `${common}\n${config.shader}\nvoid main(){ vec2 uv=(gl_FragCoord.xy-resolution*0.5)/min(resolution.x,resolution.y); vec3 col=candidateColor(uv,time); float vig=1.0-smoothstep(0.78,1.55,length(uv)); col*=0.72+0.28*vig; gl_FragColor=vec4(pow(max(col,0.0),vec3(0.92)),1.0); }`;
  function compile(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ const e=gl.getShaderInfoLog(s); console.error('shader compile error',e); overlay.innerHTML=`<h1>Shader Error</h1><p>${e}</p>`; throw new Error(e); } return s; }
  const prog=gl.createProgram(); gl.attachShader(prog, compile(gl.VERTEX_SHADER, 'attribute vec2 position; void main(){gl_Position=vec4(position,0.0,1.0);}')); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc)); gl.linkProgram(prog); if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)); gl.useProgram(prog);
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW); const pos=gl.getAttribLocation(prog,'position'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
  const uni=Object.fromEntries(['time','resolution','seed','bass','mid','treble','fftBinsA','fftBinsB','fftBinsC','fftBinsD'].map(k=>[k,gl.getUniformLocation(prog,k)]));
  function resize(){ const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,2)); const w=window.innerWidth,h=window.innerHeight; canvas.style.width=w+'px'; canvas.style.height=h+'px'; canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr); gl.viewport(0,0,canvas.width,canvas.height); }
  window.addEventListener('resize', resize); resize();
  let audioCtx, analyser, freqDbArray, mode=benchmarkMode?'demo':'idle';
  const edges=[20,30.8,47.43,73.03,112.47,173.19,266.7,410.71,632.46,973.94,1499.79,2309.56,3556.56,5476.84,8433.93,12987.63,20000];
  const attack=[160,140,120,100,85,75,65,55,50,45,40,35,30,25,22,20], release=[400,350,300,250,212,188,162,138,125,112,100,88,75,62,55,50];
  const bins=new Float32Array(16), targets=new Float32Array(16); let lastAudio=performance.now();
  function demoTargets(t){ for(let i=0;i<16;i++){ const lo=Math.exp(-Math.pow((i-(2+Math.sin(t*.61)))/1.35,2))*.92; const mi=Math.exp(-Math.pow((i-(7+Math.sin(t*.37+1.7)*2))/1.75,2))*.70; const hi=Math.exp(-Math.pow((i-(12.1+Math.sin(t*.29+2.2)*2.4))/1.55,2))*.55; targets[i]=Math.max(0,Math.min(1,.05+lo+mi+hi+.045*Math.sin(t*3+i*1.61))); }}
  function micTargets(){ analyser.getFloatFrequencyData(freqDbArray); const hz=audioCtx.sampleRate/analyser.fftSize; for(let b=0;b<16;b++){ const first=Math.max(0,Math.ceil(edges[b]/hz)), last=Math.min(freqDbArray.length-1,Math.floor(edges[b+1]/hz)); let power=0,count=0; for(let j=first;j<=last;j++){ power += Math.pow(10,freqDbArray[j]/10); count++; } const mag=Math.sqrt(power/Math.max(1,count)); const db=20*Math.log10(Math.max(1e-8,mag)); targets[b]=Math.max(0,Math.min(1,(db+90)/78)); }}
  function updateAudio(now){ const dt=Math.min(100,now-lastAudio); lastAudio=now; if(analyser&&freqDbArray) micTargets(); else if(mode==='demo') demoTargets((now-start)/1000); else targets.fill(0); for(let i=0;i<16;i++){ const tau=targets[i]>bins[i]?attack[i]:release[i]; bins[i]+=(targets[i]-bins[i])*(1-Math.exp(-dt/tau)); }}
  async function startMic(){ overlay.classList.add('hidden'); try{ if(!window.isSecureContext && !['127.0.0.1','localhost'].includes(location.hostname)) throw new Error('microphone requires secure context'); audioCtx=new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') await audioCtx.resume(); const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false}); const src=audioCtx.createMediaStreamSource(stream); analyser=audioCtx.createAnalyser(); analyser.fftSize=4096; analyser.minDecibels=-90; analyser.maxDecibels=-12; analyser.smoothingTimeConstant=0; src.connect(analyser); freqDbArray=new Float32Array(analyser.frequencyBinCount); mode='mic'; }catch(e){ console.warn('mic unavailable; demo fallback',e); mode='demo'; }}
  function startDemo(){ mode='demo'; overlay.classList.add('hidden'); }
  const demoButton=document.getElementById('start-demo'), micButton=document.getElementById('start-mic');
  [demoButton,micButton].forEach(btn=>{ btn?.addEventListener('pointerdown',e=>e.stopPropagation()); btn?.addEventListener('pointerup',e=>e.stopPropagation()); });
  demoButton?.addEventListener('click',startDemo); micButton?.addEventListener('click',startMic); overlay?.addEventListener('pointerup',e=>{ if(e.target===overlay) startDemo(); }); document.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' ') startDemo(); }); if(benchmarkMode) overlay.classList.add('hidden');
  let start=performance.now(), last=0, warm=0, reported=false; const samples=[];
  function record(now){ if(!benchmarkMode||reported) return; if(!last){ last=now; return; } const dt=now-last; last=now; if(warm<30){ warm++; return; } samples.push(dt); if(samples.length<sampleFrames) return; const sorted=[...samples].sort((a,b)=>a-b), avg=samples.reduce((a,b)=>a+b,0)/samples.length; const dbg=gl.getExtension('WEBGL_debug_renderer_info'); const result={candidate:config.name,path:location.pathname.split('/').pop(),reference:config.reference,seed,sampleFrames,averageFps:1000/avg,averageFrameMs:avg,p95FrameMs:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],worstFrameMs:sorted[sorted.length-1],canvasWidth:canvas.width,canvasHeight:canvas.height,cssWidth:innerWidth,cssHeight:innerHeight,effectiveDprX:canvas.width/innerWidth,effectiveDprY:canvas.height/innerHeight,renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),userAgent:navigator.userAgent,nativeDensity:canvas.width/innerWidth>=.999&&canvas.height/innerHeight>=.999,fftBins:Array.from(bins)}; reported=true; window.__CANDIDATE_BENCHMARK__=result; console.log('CANDIDATE_BENCHMARK',JSON.stringify(result)); if(parent!==window) parent.postMessage({type:'candidate-benchmark',result},location.origin); }
  function frame(now){ updateAudio(now); const t=(now-start)/1000; const bass=(bins[0]+bins[1]+bins[2]+bins[3]+bins[4])/5, mid=(bins[5]+bins[6]+bins[7]+bins[8]+bins[9]+bins[10])/6, treble=(bins[11]+bins[12]+bins[13]+bins[14]+bins[15])/5; gl.uniform1f(uni.time,t); gl.uniform2f(uni.resolution,canvas.width,canvas.height); gl.uniform1f(uni.seed,seed); gl.uniform1f(uni.bass,bass); gl.uniform1f(uni.mid,mid); gl.uniform1f(uni.treble,treble); gl.uniform4fv(uni.fftBinsA,bins.subarray(0,4)); gl.uniform4fv(uni.fftBinsB,bins.subarray(4,8)); gl.uniform4fv(uni.fftBinsC,bins.subarray(8,12)); gl.uniform4fv(uni.fftBinsD,bins.subarray(12,16)); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); record(now); if(info&&(!info._tick||now-info._tick>250)){ info._tick=now; info.textContent=`${config.name} · seed ${seed} · ${mode} · native ${canvas.width}×${canvas.height}/${innerWidth}×${innerHeight}`; } requestAnimationFrame(frame); }
  console.log('CANDIDATE_READY', JSON.stringify({name:config.name, seed, reference:config.reference, sampleFrames})); requestAnimationFrame(frame);
})();
