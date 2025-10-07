import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

CameraControls.install({ THREE });

export const themes = {
  nebula: {
    sphere: [new THREE.Color(0x00ffff), new THREE.Color(0xff1493), new THREE.Color(0x4169e1), new THREE.Color(0xff69b4), new THREE.Color(0x00bfff)],
    rings: (i, count, j, pCount) => new THREE.Color().setHSL((i / count) * 0.6 + (j / pCount) * 0.2 + 0.5, 0.8, 0.6),
    // Use CORS-friendly HDR from threejs examples
    hdr: 'https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr'
  },
  sunset: {
    sphere: [new THREE.Color(0xff4500), new THREE.Color(0xff8c00), new THREE.Color(0xffd700), new THREE.Color(0xff0080), new THREE.Color(0xda70d6)],
    rings: (i, count, j, pCount) => new THREE.Color().setHSL((i / count) * 0.1 + (j / pCount) * 0.1 + 0.0, 0.9, 0.7),
    hdr: 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr'
  },
  forest: {
    sphere: [new THREE.Color(0x228b22), new THREE.Color(0x00ff7f), new THREE.Color(0x3cb371), new THREE.Color(0x1e90ff), new THREE.Color(0x87cefa)],
    rings: (i, count, j, pCount) => new THREE.Color().setHSL((i / count) * 0.2 + (j / pCount) * 0.1 + 0.25, 0.8, 0.55),
    hdr: 'https://threejs.org/examples/textures/equirectangular/lebombo_1k.hdr'
  },
  aurora: {
    sphere: [new THREE.Color(0x00ff7f), new THREE.Color(0x40e0d0), new THREE.Color(0x483d8b), new THREE.Color(0x9932cc), new THREE.Color(0x00fa9a)],
    rings: (i, count, j, pCount) => new THREE.Color().setHSL((i / count) * 0.3 + (j / pCount) * 0.1 + 0.45, 0.9, 0.65),
    hdr: 'https://threejs.org/examples/textures/equirectangular/moonless_golf_1k.hdr'
  }
};

const pointMaterialShader = {
  vertexShader: `
    attribute float size; attribute vec3 randomDir; attribute vec3 morphPosition; varying vec3 vColor; varying float vDistance; varying float vMouseEffect; varying vec2 vUv; uniform float time; uniform vec2 uMouse; uniform float uExplode; uniform float uReactiveScale; uniform float uMorph; uniform float uVideoDepth;
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0,0.5,1.0,2.0);
      vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx); vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy; i = mod289(i);
      vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx; vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw); vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww; vec3 p0 = vec3(a0.xy,h.x); vec3 p1 = vec3(a0.zw,h.y); vec3 p2 = vec3(a1.xy,h.z); vec3 p3 = vec3(a1.zw,h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3))); p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m; return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
    void main() {
      vColor = color; vUv = uv;
      // Explosion wobble on base sphere position (kept subtle so morph grid stays coherent)
      float explodeAmount = uExplode * 35.0;
      float turbulence = snoise(position * 0.4 + randomDir * 2.0 + time * 0.8) * 10.0 * uExplode;
      vec3 explodedPos = position + randomDir * (explodeAmount + turbulence);
      vec3 basePos = mix(position, explodedPos, uExplode);

      // Morph between sphere and precomputed grid (morphPosition)
      vec3 morphPos = morphPosition;
      vec3 morphed = mix(basePos, morphPos, clamp(uMorph, 0.0, 1.0));

      // Organic noise displacement (reduced as we morph into the grid so image stays readable)
      vec4 projectedVertex = projectionMatrix * modelViewMatrix * vec4(morphed, 1.0);
      vec2 screenPos = projectedVertex.xy / projectedVertex.w;
      float mouseDist = distance(screenPos, uMouse);
      float mouseEffect = 1.0 - smoothstep(0.0, 0.25, mouseDist);
      vMouseEffect = mouseEffect;
      float noiseFrequency = 0.4;
      float noiseAmplitude = (0.8 + mouseEffect * 3.5) * (1.0 - uExplode);
      // Reduce noise as morph increases so the webcam image remains stable
      noiseAmplitude *= (1.0 - 0.7 * clamp(uMorph, 0.0, 1.0));
      noiseAmplitude *= (1.0 + uReactiveScale);
      vec3 noiseInput = morphed * noiseFrequency + time * 0.5;
      vec3 displacement = vec3(
        snoise(noiseInput),
        snoise(noiseInput + vec3(10.0)),
        snoise(noiseInput + vec3(20.0))
      );
      // Optional extra depth offset knob for grid state (kept small for readability)
      vec3 finalPos = morphed + displacement * noiseAmplitude + vec3(0.0, 0.0, uVideoDepth * clamp(uMorph, 0.0, 1.0));
      float pulse = sin(time + length(position)) * 0.1 + 1.0;
      vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
      vDistance = -mvPosition.z;
      gl_PointSize = size * (400.0 / -mvPosition.z) * pulse * (1.0 + vMouseEffect * 0.5);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor; varying float vMouseEffect; varying vec2 vUv; uniform float time; uniform float uExplode; uniform float uReactiveBright; uniform sampler2D uVideo; uniform float uVideoEnabled; uniform float uMorph; uniform float uMirror;
    float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec2 cxy = 2.0 * gl_PointCoord - 1.0; float r = dot(cxy, cxy); if (r > 1.0) discard;
      float glow = exp(-r * 3.5) + vMouseEffect * 0.5; float twinkle = rand(gl_PointCoord + time) * 0.5 + 0.5;
      vec3 explosionColor = vec3(2.0, 3.0, 3.5);
      vec3 baseCol = mix(vColor, explosionColor, uExplode * 0.8) * (1.0 + uExplode * 6.0);
      // Sample webcam when enabled and morphed; mirror if requested
      vec3 camCol = baseCol;
      if (uVideoEnabled > 0.5 && uMorph > 0.0) {
        vec2 tuv = vUv; if (uMirror > 0.5) { tuv.x = 1.0 - tuv.x; }
        camCol = texture2D(uVideo, tuv).rgb;
      }
      vec3 mixedColor = mix(baseCol, camCol, clamp(uMorph, 0.0, 1.0));
      vec3 finalColor = mixedColor * (1.1 + sin(time * 0.8) * 0.2 + vMouseEffect * 0.5) * glow * twinkle; finalColor *= (1.0 + uReactiveBright);
      gl_FragColor = vec4(finalColor, smoothstep(0.0, 1.0, glow));
    }
  `,
};

const starShader = {
  vertexShader: `
    attribute float size; varying vec3 vColor; uniform float time; uniform float uTwinkleGain; void main(){ vColor=color; vec4 mvPosition=modelViewMatrix*vec4(position,1.0); float twinkle=sin(time*3.0+position.x*0.1+position.y*0.2)*0.3+0.7; twinkle *= (1.0 + uTwinkleGain); gl_PointSize=size*twinkle*(1000.0/-mvPosition.z); gl_Position=projectionMatrix*mvPosition; }
  `,
  fragmentShader: `
    varying vec3 vColor; void main(){ vec2 cxy=2.0*gl_PointCoord-1.0; float r=dot(cxy,cxy); if(r>1.0) discard; float glow=exp(-r*4.0); gl_FragColor=vec4(vColor, glow*0.8); }
  `,
};

const sparkShader = {
  vertexShader: `
    attribute float size; attribute float life; varying float vLife; void main(){ vLife=life; vec4 mvPosition=modelViewMatrix*vec4(position,1.0); float s=size*(1000.0/-mvPosition.z); gl_PointSize=s*(0.6+0.4*vLife); gl_Position=projectionMatrix*mvPosition; }
  `,
  fragmentShader: `
    varying float vLife; void main(){ vec2 cxy=2.0*gl_PointCoord-1.0; float r=dot(cxy,cxy); if(r>1.0) discard; float glow=exp(-r*6.0); vec3 col=mix(vec3(0.8,0.4,1.0), vec3(1.0,0.6,0.2), vLife); gl_FragColor=vec4(col, glow*vLife); }
  `,
};

function createPointShaderMaterial(mouse) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      uMouse: { value: mouse },
      uExplode: { value: 0.0 },
      uReactiveScale: { value: 0.0 },
      uReactiveBright: { value: 0.0 },
      // Morph/webcam defaults
      uMorph: { value: 0.0 },
      uVideo: { value: null },
      uVideoEnabled: { value: 0.0 },
      uVideoDepth: { value: 0.0 },
      uMirror: { value: 1.0 },
    },
    vertexShader: pointMaterialShader.vertexShader,
    fragmentShader: pointMaterialShader.fragmentShader,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function createSpiralSphere(radius, particleCount, mouse) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const morphPositions = new Float32Array(particleCount * 3);
  const uvs = new Float32Array(particleCount * 2);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const randomDirs = new Float32Array(particleCount * 3).fill(0);
  for (let i = 0; i < particleCount; i++) {
    const i3 = i * 3; const phi = Math.acos(-1 + (2 * i) / particleCount); const theta = Math.sqrt(particleCount * Math.PI) * phi;
    positions[i3] = radius * Math.cos(theta) * Math.sin(phi);
    positions[i3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
    positions[i3 + 2] = radius * Math.cos(phi);
    sizes[i] = Math.random() * 0.2 + 0.1;
    // Initialize morph target and uv placeholder; will be set when webcam grid is built
    morphPositions[i3] = positions[i3];
    morphPositions[i3 + 1] = positions[i3 + 1];
    morphPositions[i3 + 2] = positions[i3 + 2];
    const i2 = i * 2;
    uvs[i2] = 0.0; uvs[i2 + 1] = 0.0;
    // Seed visible colors (white) until theme applies
    colors[i3] = 0.9; colors[i3 + 1] = 0.9; colors[i3 + 2] = 0.9;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('morphPosition', new THREE.BufferAttribute(morphPositions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('randomDir', new THREE.BufferAttribute(randomDirs, 3));
  const material = createPointShaderMaterial(mouse);
  material.uniforms.uExplode.value = 0;
  // New morph/video uniforms
  material.uniforms.uMorph = { value: 0.0 };
  material.uniforms.uVideo = { value: null };
  material.uniforms.uVideoEnabled = { value: 0.0 };
  material.uniforms.uVideoDepth = { value: 0.0 };
  material.uniforms.uMirror = { value: 1.0 };
  return new THREE.Points(geometry, material);
}

function createOrbitRings(radius, count, thickness, particleCount, mouse) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const ringGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const morphPositions = new Float32Array(particleCount * 3);
    const uvs = new Float32Array(particleCount * 2);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const randomDirs = new Float32Array(particleCount * 3);
    const randomVec = new THREE.Vector3();
    for (let j = 0; j < particleCount; j++) {
      const j3 = j * 3; const angle = (j / particleCount) * Math.PI * 2; const radiusVariation = radius + (Math.random() - 0.5) * thickness;
      positions[j3] = Math.cos(angle) * radiusVariation; positions[j3 + 1] = (Math.random() - 0.5) * (thickness * 0.5); positions[j3 + 2] = Math.sin(angle) * radiusVariation;
      sizes[j] = Math.random() * 0.15 + 0.08; randomVec.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      randomDirs[j3] = randomVec.x; randomDirs[j3 + 1] = randomVec.y; randomDirs[j3 + 2] = randomVec.z;
      // Dummy morph target and uv (not used visually on rings, but required by shader)
      morphPositions[j3] = positions[j3];
      morphPositions[j3 + 1] = positions[j3 + 1];
      morphPositions[j3 + 2] = positions[j3 + 2];
      const j2 = j * 2; uvs[j2] = 0.0; uvs[j2 + 1] = 0.0;
    }
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    ringGeometry.setAttribute('morphPosition', new THREE.BufferAttribute(morphPositions, 3));
    ringGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    ringGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    ringGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    ringGeometry.setAttribute('randomDir', new THREE.BufferAttribute(randomDirs, 3));
    const ring = new THREE.Points(ringGeometry, createPointShaderMaterial(mouse));
    ring.rotation.x = Math.random() * Math.PI; ring.rotation.y = Math.random() * Math.PI;
    group.add(ring);
  }
  return group;
}

function createStarfield(count, spread) {
  const geometry = new THREE.BufferGeometry();
  const positions = []; const colors = []; const sizes = [];
  for (let i = 0; i < count; i++) {
    positions.push((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
    const color = new THREE.Color(); color.setHSL(0.6, 0.0, 0.85);
    colors.push(color.r, color.g, color.b); sizes.push(0.5 + Math.random() * 1.0);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, uTwinkleGain: { value: 0 } }, vertexShader: starShader.vertexShader, fragmentShader: starShader.fragmentShader,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

function createSparks(count) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const life = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3; positions[i3] = 0; positions[i3+1] = 0; positions[i3+2] = 0; sizes[i] = Math.random() * 0.6 + 0.2; life[i] = 0;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('life', new THREE.BufferAttribute(life, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, vertexShader: sparkShader.vertexShader, fragmentShader: sparkShader.fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

export function initScene() {
  const state = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000),
    renderer: new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }),
    composer: null,
    controls: null,
    clock: new THREE.Clock(),
    mouse: new THREE.Vector2(-10, -10),
    coreSphere: null,
    orbitRings: null,
    starfield: null,
    centralLight: null,
    lensflare: null,
    bloomEffect: null,
    currentHdrTexture: null,
    isExplosionActive: false,
    explosionStartTime: 0,
    explosionDuration: 2000,
    mainGroup: new THREE.Group(),
    params: {
      theme: 'nebula',
      autoRotate: 0.0005,
      useHdrBackground: false,
      useLensflare: true,
      bloomStrengthBase: 1.2,
      bloomReactiveGain: 0.6,
      fogDensity: 0.008,
      performanceMode: false,
      pixelRatioCap: Math.min(2, window.devicePixelRatio || 1),
      particleDensity: 0.9, // 0.9 = slightly reduced for better perf on mid-range GPUs
      enableSparks: true,
      // Auto resolution
      autoResolution: true,
      targetFps: 60,
      minPixelRatio: 0.6,
      // Reactivity
      map: {
        sizeFromRms: 0.35,
        ringScaleFromBands: 0.25,
        ringSpeedFromBands: 1.0,
        colorBoostFromCentroid: 0.4,
        cameraShakeFromBeat: 0.2,
        sphereBrightnessFromRms: 1.2,
        sphereNoiseFromMid: 0.8,
        ringNoiseFromBands: 0.3,
        lightIntensityFromBass: 1.5,
        // new band sensitivities
        bandWeightBass: 1.0,
        bandWeightMid: 1.0,
        bandWeightTreble: 1.0,
        starTwinkleFromTreble: 0.8,
        ringTiltFromBass: 0.3,
      },
      // Morph controls
      morph: {
        onBeat: true,
        durationMs: 650,
        holdMs: 120,
        amount: 1.0,
        autoStartWebcam: true,
        useManual: false,
        manual: 0.0,
      },
      explosion: { onBeat: true, cooldownMs: 500 },
      _lastBeatTime: -9999,
    },
    // Morph state
    morphActive: false,
    morphStartMs: 0,
    _morphPeak: 0,
    webcamTexture: null,
    webcamReady: false,
  };

  state.scene.fog = new THREE.FogExp2(0x000000, state.params.fogDensity);
  state.camera.position.set(0, 2.5, 12);
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.setClearColor(0x000000);
  state.renderer.setPixelRatio(state.params.pixelRatioCap);
  document.body.appendChild(state.renderer.domElement);

  state.controls = new CameraControls(state.camera, state.renderer.domElement);
  // camera-controls API updates: use smoothTime/draggingSmoothTime instead of deprecated *dampingFactor
  state.controls.smoothTime = 0.12; state.controls.minDistance = 10; state.controls.maxDistance = 50; state.controls.draggingSmoothTime = 0.15;
  state.controls.setLookAt(0, 5, 14, 0, 0, 0);

  const renderPass = new RenderPass(state.scene, state.camera);
  state.bloomEffect = new BloomEffect({ intensity: state.params.bloomStrengthBase });
  const effectPass = new EffectPass(state.camera, state.bloomEffect);
  // Force 8-bit framebuffer to avoid glCopyTexSubImage2D format issues on some GPUs
  state.composer = new EffectComposer(state.renderer, { frameBufferType: THREE.UnsignedByteType });
  state.composer.addPass(renderPass); state.composer.addPass(effectPass);

  // Particles
  const sphereCount = Math.floor(40000 * state.params.particleDensity);
  const ringCountPer = Math.floor(4000 * state.params.particleDensity);
  const starCount = Math.floor(10000 * state.params.particleDensity);

  state.coreSphere = createSpiralSphere(5, sphereCount, state.mouse);
  state.orbitRings = createOrbitRings(7.5, 8, 0.6, ringCountPer, state.mouse);
  state.starfield = createStarfield(starCount, 50000);
  state.sparks = state.params.enableSparks ? createSparks(Math.floor(8000 * state.params.particleDensity)) : null;
  state.mainGroup.add(state.coreSphere); state.mainGroup.add(state.orbitRings);
  state.scene.add(state.mainGroup); state.scene.add(state.starfield); if (state.sparks) state.scene.add(state.sparks);

  // Build initial webcam grid morph target when webcam is ready (lazy)
  async function ensureWebcamTexture() {
    if (state.webcamTexture) return state.webcamTexture;
    try {
      // AudioEngine is constructed in main.js and passed into UI; we access via window for simplicity
      const ae = window.__audioEngineRef;
      if (!ae) return null;
      const tex = await ae.startWebcam({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }, audio: false });
      state.webcamTexture = tex; state.webcamReady = true;
      // Assign to material uniforms
      state.coreSphere.material.uniforms.uVideo.value = tex;
      state.coreSphere.material.uniforms.uVideoEnabled.value = 1.0;
      // Build grid morph target and uvs to match video aspect
      buildMorphGridForSphere();
      try { ae.webcam?.video?.play?.(); } catch(_) {}
      return tex;
    } catch (_) {
      state.webcamReady = false;
      return null;
    }
  }

  function buildMorphGridForSphere() {
    if (!state.coreSphere || !state.webcamTexture) return;
    const g = state.coreSphere.geometry;
    const N = g.attributes.position.count;
    const morph = g.attributes.morphPosition.array;
    const uvs = g.attributes.uv.array;
    // Determine grid dimensions close to square but matching N
    let cols = Math.ceil(Math.sqrt(N));
    let rows = Math.ceil(N / cols);
    // Adjust to video aspect ratio to minimize stretching
    const vw = state.webcamTexture.image?.videoWidth || 320;
    const vh = state.webcamTexture.image?.videoHeight || 240;
    const aspect = vw / Math.max(1, vh);
    // Try to fit cols/rows to aspect
    cols = Math.max(1, Math.round(Math.sqrt(N * aspect)));
    rows = Math.max(1, Math.ceil(N / cols));

    // Grid size in world units roughly equal to current sphere diameter
    const span = 10.0; // ~2*radius
    const dx = span / Math.max(1, cols - 1);
    const dy = span / Math.max(1, rows - 1);
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (idx >= N) break;
        const x = -span / 2 + c * dx;
        const y = span / 2 - r * dy;
        const i3 = idx * 3;
        morph[i3] = x; morph[i3 + 1] = y; morph[i3 + 2] = 0;
        const i2 = idx * 2;
        const u = cols > 1 ? c / (cols - 1) : 0.0;
        const v = rows > 1 ? r / (rows - 1) : 0.0;
        uvs[i2] = u; uvs[i2 + 1] = v;
        idx++;
      }
    }
    g.attributes.morphPosition.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
  }

  // Lights + optional lensflare
  state.centralLight = new THREE.PointLight(0xffffff, 2, 0);
  state.centralLight.position.set(0, 0, 0); state.scene.add(state.centralLight);
  function setupLensflare() {
    if (state.lensflare) return;
    const textureLoader = new THREE.TextureLoader();
    let failed = false;
    const onErr = () => {
      failed = true;
      console.warn('Lensflare textures failed to load; disabling lensflare');
      state.params.useLensflare = false;
    };
    const textureFlare0 = textureLoader.load(
      'https://threejs.org/examples/textures/lensflare/lensflare0.png',
      undefined, undefined, onErr
    );
    const textureFlare3 = textureLoader.load(
      'https://threejs.org/examples/textures/lensflare/lensflare3.png',
      undefined, undefined, onErr
    );
    // Check if loading failed synchronously (unlikely but possible)
    if (failed) return;
    state.lensflare = new Lensflare();
    state.lensflare.addElement(new LensflareElement(textureFlare0, 500, 0, state.centralLight.color));
    state.lensflare.addElement(new LensflareElement(textureFlare3, 60, 0.6));
    state.lensflare.addElement(new LensflareElement(textureFlare3, 70, 0.7));
    state.lensflare.addElement(new LensflareElement(textureFlare3, 120, 0.9));
    state.lensflare.addElement(new LensflareElement(textureFlare3, 70, 1));
    state.centralLight.add(state.lensflare);
  }
  function teardownLensflare() {
    if (!state.lensflare) return;
    try { state.centralLight.remove(state.lensflare); } catch(_) {}
    try { state.lensflare.dispose?.(); } catch(_) {}
    state.lensflare = null;
  }
  if (state.params.useLensflare) setupLensflare();

  function applyThemeColors(theme) {
    const sphereColorsAttr = state.coreSphere.geometry.attributes.color;
    for (let i = 0; i < sphereColorsAttr.count; i++) {
      const colorPos = (i / sphereColorsAttr.count) * (theme.sphere.length - 1);
      const c1 = theme.sphere[Math.floor(colorPos)];
      const c2 = theme.sphere[Math.min(Math.floor(colorPos) + 1, theme.sphere.length - 1)];
      const newColor = new THREE.Color().copy(c1).lerp(c2, colorPos - Math.floor(colorPos));
      sphereColorsAttr.setXYZ(i, newColor.r, newColor.g, newColor.b);
    }
    sphereColorsAttr.needsUpdate = true;
    state.orbitRings.children.forEach((ring, i) => {
      const ringColorsAttr = ring.geometry.attributes.color;
      for (let j = 0; j < ringColorsAttr.count; j++) {
        const newColor = theme.rings(i, state.orbitRings.children.length, j, ringColorsAttr.count);
        ringColorsAttr.setXYZ(j, newColor.r, newColor.g, newColor.b);
      }
      ringColorsAttr.needsUpdate = true;
    });
  }

  async function applyHdr(theme) {
    if (!state.params.useHdrBackground) {
      if (state.currentHdrTexture) { try { state.currentHdrTexture.dispose(); } catch(_){} }
      state.scene.background = new THREE.Color(0x000000);
      state.scene.environment = null;
      state.currentHdrTexture = null;
      return;
    }
    try {
      const loader = new RGBELoader();
      const texture = await loader.loadAsync(theme.hdr);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      if (state.currentHdrTexture) state.currentHdrTexture.dispose();
      state.scene.background = texture; state.scene.environment = texture; state.currentHdrTexture = texture;
    } catch (e) {
      // CORS or network error: fallback to black
      state.scene.background = new THREE.Color(0x000000);
      state.scene.environment = null;
    }
  }

  function changeTheme(themeName) {
    const theme = themes[themeName]; if (!theme) return;
    state.params.theme = themeName; applyThemeColors(theme); applyHdr(theme);
    // Toggle active class for swatches if present
    document.querySelectorAll('.theme-swatch').forEach(sw => sw.classList.toggle('active', sw.getAttribute('data-theme') === themeName));
    // Ensure base visibility in case theme colors apply very darkly
    try {
      const cAttr = state.coreSphere.geometry.attributes.color;
      for (let i = 0; i < cAttr.count; i+=Math.max(1, Math.floor(cAttr.count/1000))) {
        const r = cAttr.getX(i) + cAttr.getY(i) + cAttr.getZ(i);
        if (!isFinite(r) || r < 0.01) { cAttr.setXYZ(i, 0.9, 0.9, 0.9); }
      }
      cAttr.needsUpdate = true;
    } catch(_) {}
  }

  function triggerExplosion() {
    if (state.isExplosionActive) return; state.isExplosionActive = true; state.explosionStartTime = state.clock.getElapsedTime();
    const btn = document.getElementById('explode-btn'); if (btn) btn.classList.add('active');
  }

  function updateExplosion(elapsedTime) {
    if (!state.isExplosionActive) return;
    const explosionTime = (elapsedTime - state.explosionStartTime) * 1000; const progress = Math.min(explosionTime / state.explosionDuration, 1.0);
    const pulseProgress = Math.sin(progress * Math.PI); const easedProgress = easeInOutCubic(pulseProgress);
    state.orbitRings.children.forEach(ring => { ring.material.uniforms.uExplode.value = easedProgress; });
    if (progress >= 1.0) { state.isExplosionActive = false; const btn = document.getElementById('explode-btn'); if (btn) btn.classList.remove('active'); }
  }

  function setPixelRatioCap(value) { state.params.pixelRatioCap = value; state.renderer.setPixelRatio(value); }

  function rebuildParticles() {
    // Remove current
    state.mainGroup.remove(state.coreSphere); state.mainGroup.remove(state.orbitRings); state.scene.remove(state.starfield); if (state.sparks) state.scene.remove(state.sparks);
    state.coreSphere.geometry.dispose(); state.coreSphere.material.dispose();
    state.orbitRings.children.forEach(r => { r.geometry.dispose(); r.material.dispose(); });
    state.starfield.geometry.dispose(); state.starfield.material.dispose(); if (state.sparks) { state.sparks.geometry.dispose(); state.sparks.material.dispose(); }

    const sphereCount = Math.floor(40000 * state.params.particleDensity);
    const ringCountPer = Math.floor(4000 * state.params.particleDensity);
    const starCount = Math.floor(10000 * state.params.particleDensity);

    state.coreSphere = createSpiralSphere(5, sphereCount, state.mouse);
    // Re-wire video uniforms if webcam already running
    if (state.webcamTexture && state.coreSphere?.material?.uniforms) {
      state.coreSphere.material.uniforms.uVideo.value = state.webcamTexture;
      state.coreSphere.material.uniforms.uVideoEnabled.value = state.webcamReady ? 1.0 : 0.0;
    }
    // Rebuild morph grid for new particle count
    if (state.webcamTexture) {
      buildMorphGridForSphere();
    }
    state.orbitRings = createOrbitRings(7.5, 8, 0.6, ringCountPer, state.mouse);
    state.starfield = createStarfield(starCount, 50000);
    state.sparks = state.params.enableSparks ? createSparks(Math.floor(8000 * state.params.particleDensity)) : null;

    state.mainGroup.add(state.coreSphere); state.mainGroup.add(state.orbitRings); state.scene.add(state.starfield); if (state.sparks) state.scene.add(state.sparks);
    // Reapply theme colors
    applyThemeColors(themes[state.params.theme]);
  }

  function setEnableSparks(enabled) {
    if (enabled === state.params.enableSparks) return;
    state.params.enableSparks = enabled;
    if (!enabled) {
      if (state.sparks) {
        state.scene.remove(state.sparks);
        try { state.sparks.geometry.dispose(); state.sparks.material.dispose(); } catch(_) {}
      }
      state.sparks = null;
    } else {
      state.sparks = createSparks(Math.floor(8000 * state.params.particleDensity));
      state.scene.add(state.sparks);
    }
  }

  function setUseLensflare(enabled) {
    if (enabled === state.params.useLensflare) return;
    state.params.useLensflare = enabled;
    if (enabled) setupLensflare(); else teardownLensflare();
  }

  function onResize() {
    state.camera.aspect = window.innerWidth / window.innerHeight; state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight); state.composer.setSize(window.innerWidth, window.innerHeight);
  }

  function onMouseMove(event) {
    state.mouse.x = (event.clientX / window.innerWidth) * 2 - 1; state.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  // maintain a local high-resolution delta for camera-controls
  let _lastUpdateNow = performance.now();

  function update(features) {
    const t = state.clock.getElapsedTime();
    const nowPerf = performance.now();
    const dt = (nowPerf - _lastUpdateNow) / 1000;
    _lastUpdateNow = nowPerf;

    // Explosion on beat
    if (features && features.beat) {
      const nowMs = performance.now();
      if (state.params.explosion.onBeat && nowMs - state.params._lastBeatTime > state.params.explosion.cooldownMs) {
        state.params._lastBeatTime = nowMs; triggerExplosion();
      }
    }

    updateExplosion(t);

    // Start webcam lazily if morph-on-beat is enabled and autoStartWebcam true
    if (state.params.morph.autoStartWebcam && state.params.morph.onBeat && !state.webcamTexture) {
      ensureWebcamTexture();
    }

    // Handle morph timeline (on beat → hold → release)
    if (features && features.beat && state.params.morph.onBeat && state.webcamReady) {
      state.morphActive = true; state.morphStartMs = performance.now(); state._morphPeak = state.params.morph.amount;
    }
    let morphValue = 0.0;
    if (state.params.morph.useManual) {
      morphValue = Math.max(0.0, Math.min(1.0, state.params.morph.manual));
    } else {
    if (state.morphActive) {
      const elapsed = performance.now() - state.morphStartMs;
      const d = state.params.morph.durationMs;
      const hold = state.params.morph.holdMs;
      if (elapsed <= d) {
        // Ease-in to peak
        const p = elapsed / d; morphValue = easeInOutCubic(Math.min(1, p)) * state._morphPeak;
      } else if (elapsed <= d + hold) {
        morphValue = state._morphPeak;
      } else if (elapsed <= d * 2 + hold) {
        // Ease out back to 0 over same duration
        const p = (elapsed - d - hold) / d; morphValue = (1.0 - easeInOutCubic(Math.min(1, p))) * state._morphPeak;
      } else {
        state.morphActive = false; morphValue = 0.0;
      }
    }
    }

    // Uniforms/time
    state.coreSphere.material.uniforms.time.value = t; state.coreSphere.material.uniforms.uMouse.value.copy(state.mouse);
    if (state.coreSphere.material.uniforms.uMorph) state.coreSphere.material.uniforms.uMorph.value = morphValue;
    if (state.coreSphere.material.uniforms.uVideoEnabled) state.coreSphere.material.uniforms.uVideoEnabled.value = state.webcamReady ? 1.0 : 0.0;
    if (state.coreSphere.material.uniforms.uMirror) {
      try { state.coreSphere.material.uniforms.uMirror.value = window.__audioEngineRef?.webcam?.mirror ? 1.0 : 0.0; } catch(_) {}
    }
    state.orbitRings.children.forEach(r => { r.material.uniforms.time.value = t; r.material.uniforms.uMouse.value.copy(state.mouse); });
    state.starfield.material.uniforms.time.value = t;

    // Reactivity mappings
    const rms = features?.rmsNorm ?? 0.0; const bass = features?.bands?.bass ?? 0.0; const mid = features?.bands?.mid ?? 0.0; const treble = features?.bands?.treble ?? 0.0; const centroid = features?.centroidNorm ?? 0.0;

    const breathe = 1 + rms * state.params.map.sizeFromRms; state.coreSphere.scale.set(breathe, breathe, breathe);

    const wBass = state.params.map.bandWeightBass;
    const wMid = state.params.map.bandWeightMid;
    const wTreble = state.params.map.bandWeightTreble;
    const bandMixBase = (bass * wBass * 0.6 + mid * wMid * 0.3 + treble * wTreble * 0.1);
    state.orbitRings.children.forEach((ring, index) => {
      const bandMix = bandMixBase;
      const speed = 0.0004 * (index + 1) * (1 + bandMix * state.params.map.ringSpeedFromBands);
      ring.rotation.z += speed; ring.rotation.x += speed * 0.3; ring.rotation.y += speed * 0.2;
      const scaleY = 1.0 + bandMix * state.params.map.ringScaleFromBands; ring.scale.y = scaleY;
      // subtle tilt from bass energy
      ring.rotation.x += (bass * wBass) * 0.0005 * state.params.map.ringTiltFromBass;
    });

    // Bloom reactivity (centroid boost is user-tunable)
    const bloomReactive =
      state.params.bloomStrengthBase +
      rms * state.params.bloomReactiveGain +
      centroid * (state.params.map.colorBoostFromCentroid ?? 0.2);
    state.bloomEffect.intensity = bloomReactive;

    // Sphere specific reactivity (noise and brightness)
    if (state.coreSphere?.material?.uniforms) {
      state.coreSphere.material.uniforms.uReactiveScale.value = Math.max(0.0, mid * state.params.map.sphereNoiseFromMid);
      state.coreSphere.material.uniforms.uReactiveBright.value = Math.max(0.0, rms * state.params.map.sphereBrightnessFromRms);
    }

    // Rings turbulence from band energy
    state.orbitRings.children.forEach((ring) => {
      if (ring.material?.uniforms) {
        const bandMix = (bass * wBass * 0.6 + mid * wMid * 0.3 + treble * wTreble * 0.1);
        ring.material.uniforms.uReactiveScale.value = Math.max(0.0, bandMix * state.params.map.ringNoiseFromBands);
        ring.material.uniforms.uReactiveBright.value = Math.max(0.0, rms * 0.4);
      }
    });

    // Lens flare subtle color boost with centroid + intensity from bass
    const c = new THREE.Color().setHSL(0.6 + 0.4 * centroid, 0.7, 0.6 + 0.2 * rms);
    state.centralLight.color.lerp(c, 0.05);
    state.centralLight.intensity = 1.8 + (bass * wBass) * state.params.map.lightIntensityFromBass + rms * 0.8;

    // Camera micro shake on beat
    if (features?.beat) {
      const amt = 0.02 * state.params.map.cameraShakeFromBeat;
      state.camera.position.x += (Math.random() - 0.5) * amt; state.camera.position.y += (Math.random() - 0.5) * amt;
    }

    // Stars twinkle more with treble
    if (state.starfield?.material?.uniforms?.uTwinkleGain) {
      state.starfield.material.uniforms.uTwinkleGain.value = Math.max(0.0, treble * wTreble * state.params.map.starTwinkleFromTreble);
    }

    // Sparks: emit on beats and breathe with RMS
    if (state.sparks) {
      const g = state.sparks.geometry;
      const pos = g.attributes.position.array;
      const life = g.attributes.life.array;
      const N = life.length;
      for (let i = 0; i < N; i++) {
        // decay
        life[i] = Math.max(0, life[i] - dt * 0.8);
        if (features?.beat && Math.random() < 0.1) {
          // respawn a subset on beat
          const i3 = i * 3; const r = 0.5 + Math.random() * 1.5;
          const theta = Math.random() * Math.PI * 2; const phi = Math.acos(2*Math.random()-1);
          pos[i3] = Math.cos(theta) * Math.sin(phi) * r;
          pos[i3+1] = Math.sin(theta) * Math.sin(phi) * r;
          pos[i3+2] = Math.cos(phi) * r;
          life[i] = 1.0;
        }
      }
      g.attributes.life.needsUpdate = true; g.attributes.position.needsUpdate = true;
    }

    // Slow auto-rotate
    state.mainGroup.rotation.y += state.params.autoRotate;

    state.controls.update(dt); state.composer.render();
  }

  changeTheme('nebula');

  return {
    state,
    changeTheme,
    triggerExplosion,
    // Morph/webcam controls
    async startWebcam() { return await ensureWebcamTexture(); },
    stopWebcam() { try { window.__audioEngineRef?.stopWebcam?.(); } catch(_) {} state.webcamTexture = null; state.webcamReady = false; if (state.coreSphere?.material?.uniforms?.uVideoEnabled) state.coreSphere.material.uniforms.uVideoEnabled.value = 0.0; },
    setMorphOnBeat(v) { state.params.morph.onBeat = !!v; },
    setMorphAmount(v) { state.params.morph.amount = Math.max(0, Math.min(1, v)); },
    setMorphDuration(ms) { state.params.morph.durationMs = Math.max(50, ms|0); },
    setMorphHold(ms) { state.params.morph.holdMs = Math.max(0, ms|0); },
    setVideoDepth(z) { if (state.coreSphere?.material?.uniforms?.uVideoDepth) state.coreSphere.material.uniforms.uVideoDepth.value = z; },
    setPixelRatioCap,
    rebuildParticles,
    setEnableSparks,
    setUseLensflare,
    onResize,
    onMouseMove,
    update,
    getPixelRatio: () => state.renderer.getPixelRatio(),
  };
}
