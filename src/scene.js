/**
 * 3D Scene Manager
 *
 * This file handles all 3D graphics rendering using Three.js. It creates and manages:
 * - Particle systems (spheres, rings, stars, sparks)
 * - Camera controls and animation
 * - Post-processing effects (bloom, chromatic aberration)
 * - Theme system (colors, HDR backgrounds)
 * - Shader effects (reactive to audio features)
 *
 * What this file does:
 * 1. Initializes Three.js scene, camera, renderer
 * 2. Creates particle systems that react to audio
 * 3. Manages themes and visual styles
 * 4. Handles camera controls and mouse interaction
 * 5. Applies post-processing effects for visual polish
 * 6. Updates visuals every frame based on audio features
 *
 * Key Concepts:
 * - Points: 3D particles rendered as glowing points
 * - Shaders: GPU programs that control particle appearance and motion
 * - Post-processing: Effects applied after rendering (bloom, chromatic aberration)
 * - HDR: High Dynamic Range backgrounds for realistic lighting
 *
 * Data Flow:
 * - Audio features → sceneApi.update() → Visual animations
 * - User settings → sceneApi.state.params → Visual parameters
 */

import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ChromaticAberrationEffect } from 'postprocessing';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createEyeLayer, createCornea, updateEyeUniforms } from './eye.js';
import { createDispersionLayer } from './dispersion.js';
import { withDispersionDefaults } from './dispersion-config.js';

// Install CameraControls plugin for Three.js
// This provides smooth, interactive camera controls
CameraControls.install({ THREE });

// Hard-disable the experimental eye feature (remove center overlay completely)
// This was an experimental visual effect that has been disabled
const EYE_FEATURE_ENABLED = false;

/**
 * Visual Themes
 * 
 * Predefined color schemes and HDR backgrounds for different visual styles.
 * Each theme defines:
 * - sphere: Array of colors for the main particle sphere
 * - rings: Function that generates colors for orbit rings
 * - hdr: URL to HDR environment map for realistic lighting
 * 
 * Themes:
 * - nebula: Cyan/pink space theme
 * - sunset: Warm orange/purple sunset theme
 * - forest: Green nature theme
 * - aurora: Cyan/purple aurora theme
 */
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

/**
 * Point Material Shader
 * 
 * Custom GLSL shader for rendering particles as glowing points.
 * This shader:
 * - Applies noise-based displacement for organic motion
 * - Creates explosion effect when triggered
 * - Responds to mouse position for interactive effects
 * - Uses Simplex noise for smooth, organic movement
 * - Adds pulsing and twinkling effects
 */
const pointMaterialShader = {
  vertexShader: `
    attribute float size; attribute vec3 randomDir; varying vec3 vColor; varying float vDistance; varying float vMouseEffect; uniform float time; uniform vec2 uMouse; uniform float uExplode; uniform float uReactiveScale;
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
      vColor = color;
      // Explosion wobble on base sphere position
      float explodeAmount = uExplode * 35.0;
      float turbulence = snoise(position * 0.4 + randomDir * 2.0 + time * 0.8) * 10.0 * uExplode;
      vec3 explodedPos = position + randomDir * (explodeAmount + turbulence);
      vec3 morphed = mix(position, explodedPos, uExplode);

      // Organic noise displacement (reduced as we morph into the grid so image stays readable)
      vec4 projectedVertex = projectionMatrix * modelViewMatrix * vec4(morphed, 1.0);
      vec2 screenPos = projectedVertex.xy / projectedVertex.w;
      float mouseDist = distance(screenPos, uMouse);
      float mouseEffect = 1.0 - smoothstep(0.0, 0.25, mouseDist);
      vMouseEffect = mouseEffect;
      float noiseFrequency = 0.4;
      float noiseAmplitude = (0.8 + mouseEffect * 3.5) * (1.0 - uExplode);
      noiseAmplitude *= (1.0 + uReactiveScale);
      vec3 noiseInput = morphed * noiseFrequency + time * 0.5;
      vec3 displacement = vec3(
        snoise(noiseInput),
        snoise(noiseInput + vec3(10.0)),
        snoise(noiseInput + vec3(20.0))
      );
      vec3 finalPos = morphed + displacement * noiseAmplitude;
      float pulse = sin(time + length(position)) * 0.1 + 1.0;
      vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
      vDistance = -mvPosition.z;
      gl_PointSize = size * (400.0 / -mvPosition.z) * pulse * (1.0 + vMouseEffect * 0.5);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor; varying float vMouseEffect; uniform float time; uniform float uExplode; uniform float uReactiveBright;
    float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec2 cxy = 2.0 * gl_PointCoord - 1.0; float r = dot(cxy, cxy); if (r > 1.0) discard;
      float glow = exp(-r * 3.5) + vMouseEffect * 0.5; float twinkle = rand(gl_PointCoord + time) * 0.5 + 0.5;
      vec3 explosionColor = vec3(2.0, 3.0, 3.5);
      vec3 baseCol = mix(vColor, explosionColor, uExplode * 0.8) * (1.0 + uExplode * 6.0);
      vec3 finalColor = baseCol * (1.1 + sin(time * 0.8) * 0.2 + vMouseEffect * 0.5) * glow * twinkle; finalColor *= (1.0 + uReactiveBright);
      gl_FragColor = vec4(finalColor, smoothstep(0.0, 1.0, glow));
    }
  `,
};

/**
 * Creates a radial gradient texture for particle glow effects.
 * 
 * This generates a canvas-based texture with a radial gradient from white
 * in the center to transparent at the edges. Used for making particles glow.
 * 
 * @param {number} [size=256] - Texture size in pixels (square)
 * @returns {THREE.Texture|null} The glow texture, or null if canvas creation fails
 */
function createGlowTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0.0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,220,255,0.85)');
  gradient.addColorStop(0.45, 'rgba(255,120,255,0.35)');
  gradient.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipMapLinearFilter;
  try {
    texture.colorSpace = THREE.SRGBColorSpace;
  } catch (_) {}
  return texture;
}

/**
 * Star Shader
 * 
 * Simple shader for background stars.
 * Creates subtle twinkling effects with pulsing size and glow.
 */
const starShader = {
  vertexShader: `
    attribute float size; varying vec3 vColor; uniform float time; uniform float uTwinkleGain; void main(){ vColor=color; vec4 mvPosition=modelViewMatrix*vec4(position,1.0); float twinkle=sin(time*3.0+position.x*0.1+position.y*0.2)*0.3+0.7; twinkle *= (1.0 + uTwinkleGain); gl_PointSize=size*twinkle*(1000.0/-mvPosition.z); gl_Position=projectionMatrix*mvPosition; }
  `,
  fragmentShader: `
    varying vec3 vColor; void main(){ vec2 cxy=2.0*gl_PointCoord-1.0; float r=dot(cxy,cxy); if(r>1.0) discard; float glow=exp(-r*4.0); gl_FragColor=vec4(vColor, glow*0.8); }
  `,
};

/**
 * Spark Shader
 * 
 * Shader for particle sparks that fade out over time.
 * Used for explosion effects and visual accents.
 */
const sparkShader = {
  vertexShader: `
    attribute float size; attribute float life; varying float vLife; void main(){ vLife=life; vec4 mvPosition=modelViewMatrix*vec4(position,1.0); float s=size*(1000.0/-mvPosition.z); gl_PointSize=s*(0.6+0.4*vLife); gl_Position=projectionMatrix*mvPosition; }
  `,
  fragmentShader: `
    varying float vLife; void main(){ vec2 cxy=2.0*gl_PointCoord-1.0; float r=dot(cxy,cxy); if(r>1.0) discard; float glow=exp(-r*6.0); vec3 col=mix(vec3(0.8,0.4,1.0), vec3(1.0,0.6,0.2), vLife); gl_FragColor=vec4(col, glow*vLife); }
  `,
};

/**
 * Creates a shader material for point particles.
 * 
 * Sets up uniforms (time, mouse position, explosion amount, reactive scaling)
 * that are updated every frame to animate the particles.
 * 
 * @param {THREE.Vector2} mouse - Current mouse position (normalized -1 to 1)
 * @returns {THREE.ShaderMaterial} The configured shader material
 */
function createPointShaderMaterial(mouse) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      uMouse: { value: mouse },
      uExplode: { value: 0.0 },
      uReactiveScale: { value: 0.0 },
      uReactiveBright: { value: 0.0 },
    },
    vertexShader: pointMaterialShader.vertexShader,
    fragmentShader: pointMaterialShader.fragmentShader,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/**
 * Creates the main particle sphere using a spiral distribution algorithm.
 * 
 * Uses Fibonacci spiral distribution to evenly distribute particles across
 * a sphere surface. This creates a visually pleasing, organic distribution.
 * 
 * @param {number} radius - Sphere radius
 * @param {number} particleCount - Number of particles to create
 * @param {THREE.Vector2} mouse - Mouse position for shader uniforms
 * @returns {THREE.Points} The particle system configured as a sphere
 */
function createSpiralSphere(radius, particleCount, mouse) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const randomDirs = new Float32Array(particleCount * 3).fill(0);
  for (let i = 0; i < particleCount; i++) {
    const i3 = i * 3; const phi = Math.acos(-1 + (2 * i) / particleCount); const theta = Math.sqrt(particleCount * Math.PI) * phi;
    positions[i3] = radius * Math.cos(theta) * Math.sin(phi);
    positions[i3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
    positions[i3 + 2] = radius * Math.cos(phi);
    sizes[i] = Math.random() * 0.2 + 0.1;
    // Seed visible colors (white) until theme applies
    colors[i3] = 0.9; colors[i3 + 1] = 0.9; colors[i3 + 2] = 0.9;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('randomDir', new THREE.BufferAttribute(randomDirs, 3));
  const material = createPointShaderMaterial(mouse);
  material.uniforms.uExplode.value = 0;
  return new THREE.Points(geometry, material);
}

/**
 * Creates orbiting ring particle systems.
 * 
 * Generates multiple circular rings of particles that orbit around the center.
 * Each ring has particles distributed around its circumference with slight
 * random variations for organic appearance.
 * 
 * @param {number} radius - Base radius of the rings
 * @param {number} count - Number of rings to create
 * @param {number} thickness - Thickness/variation of each ring
 * @param {number} particleCount - Particles per ring
 * @param {THREE.Vector2} mouse - Mouse position for shader uniforms
 * @returns {THREE.Group} Group containing all ring particle systems
 */
function createOrbitRings(radius, count, thickness, particleCount, mouse) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const ringGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const randomDirs = new Float32Array(particleCount * 3);
    const randomVec = new THREE.Vector3();
    for (let j = 0; j < particleCount; j++) {
      const j3 = j * 3; const angle = (j / particleCount) * Math.PI * 2; const radiusVariation = radius + (Math.random() - 0.5) * thickness;
      positions[j3] = Math.cos(angle) * radiusVariation; positions[j3 + 1] = (Math.random() - 0.5) * (thickness * 0.5); positions[j3 + 2] = Math.sin(angle) * radiusVariation;
      sizes[j] = Math.random() * 0.15 + 0.08; randomVec.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      randomDirs[j3] = randomVec.x; randomDirs[j3 + 1] = randomVec.y; randomDirs[j3 + 2] = randomVec.z;
    }
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
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
  try {
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    geometry.attributes.life.setUsage(THREE.DynamicDrawUsage);
  } catch (_) {}
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, vertexShader: sparkShader.vertexShader, fragmentShader: sparkShader.fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function easeOutExpo(x) { return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); }

function createShockwave() {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColorInner: { value: new THREE.Color(0xffffff) },
      uColorOuter: { value: new THREE.Color(0x6fffff) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uProgress;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColorInner;
      uniform vec3 uColorOuter;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float dist = length(p);
        float clampedProgress = clamp(uProgress, 0.0, 1.0);
        float radius = mix(0.18, 0.95, clampedProgress);
        float thickness = mix(0.22, 0.06, clampedProgress);
        float band = abs(dist - radius);
        float ring = 1.0 - smoothstep(0.0, thickness, band);
        float fade = 1.0 - smoothstep(0.9, 1.45, dist);
        float glow = smoothstep(0.0, 0.45, clampedProgress);
        float wave = 0.7 + 0.3 * sin(uTime * 5.5 + dist * 18.0);
        vec3 col = mix(uColorInner, uColorOuter, clamp((dist - radius) * 2.5 + 0.5, 0.0, 1.0));
        float alpha = ring * fade * glow * uOpacity * wave * clamp(uIntensity, 0.0, 2.5);
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(col * (0.8 + 0.4 * uIntensity), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, material };
}

export function initScene() {
  const state = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000),
    renderer: new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }),
    composer: null,
    renderPass: null,
    effectPass: null,
    controls: null,
    clock: new THREE.Clock(),
    mouse: new THREE.Vector2(-10, -10),
    coreSphere: null,
    outerSphere: null,
    orbitRings: null,
    starfield: null,
    centralLight: null,
    centralGlow: null,
    bloomEffect: null,
    chromaticEffect: null,
    chromaticIntensity: 0,
    // Optional external provider for per-frame uniform deltas (e.g., performance pads)
    _perfDeltasProvider: null,
    currentHdrTexture: null,
    isExplosionActive: false,
    explosionStartTime: 0,
    explosionDuration: 2000,
    mainGroup: new THREE.Group(),
    shockwave: { mesh: null, material: null, active: false, startTime: 0, duration: 1.2, intensity: 1, progress: 0, opacity: 0 },
    dispersion: { layer: null, zoom: 0, offsetX: 0, offsetY: 0, opacity: 0.3, twist: 0, twistDir: 1, stutterTimes: [], travel: 0, _flipBeatAccumulator: 0, _flipSetting: 0, _downbeatEnv: 0 },
    metrics: {
      coreScale: 1,
      outerScale: 1,
      coreNoise: 0,
      coreBrightness: 0,
      bloomIntensity: 1.2,
      chromaticEnabled: 0,
      chromaticOffset: 0,
      chromaticOffsetY: 0,
      starTwinkle: 0,
      starTilt: 0,
      ringScale: 1,
      ringSpeed: 0,
      ringNoise: 0,
      ringBrightness: 0,
      cameraFov: 75,
      cameraRoll: 0,
      centroidDelta: 0,
      fluxZ: 0,
      groupSway: 0,
      chromaHue: 0,
      chromaEnergy: 0,
      chromaIndex: 0,
      eyePupil: 0,
      eyeBlink: 0,
      eyeCatAspect: 0,
      lightHue: 0,
      lightMix: 0,
      shockwaveActive: 0,
      shockwaveProgress: 0,
      shockwaveOpacity: 0,
      shockwaveIntensity: 0,
      sparksActive: 1,
      sparksAlive: 0,
      parallaxOffsetX: 0,
      parallaxOffsetY: 0,
      downbeatPulse: 0,
      beatsPerBar: 4,
      beatIndex: 0,
      tintMix: 0,
    },
    // Effects profile scales for global quality control
    effectsBloomScale: 1.0,
    effectsChromaticScale: 1.0,
    _centroidEma: Number.NaN,
    _cameraRoll: 0,
    _fluxSway: 0,
    _parallaxCentroidEma: Number.NaN,
    _parallaxFluxEma: Number.NaN,
    _parallaxOffsetX: 0,
    _parallaxOffsetY: 0,
    _beatIndex: -1,
    _beatsPerBar: 4,
    _lastBeatIntervalMs: 0,
    _lastBeatTimeMs: 0,
    _tintMix: Number.NaN,
    params: {
      theme: 'nebula',
      autoRotate: 0.0005,
      useHdrBackground: false,
      useLensflare: true,
      bloomStrengthBase: 1.2,
      bloomReactiveGain: 0.8,
      fogDensity: 0.008,
      performanceMode: false,
      pixelRatioCap: Math.min(2, window.devicePixelRatio || 1),
      particleDensity: 0.9, // 0.9 = slightly reduced for better perf on mid-range GPUs
      enableSparks: true,
      // Outer shell around the core sphere
      outerShell: { enabled: true, densityScale: 0.6, radius: 6.2 },
      // Auto resolution
      autoResolution: true,
      targetFps: 60,
      minPixelRatio: 0.6,
      // Reactivity
      map: {
        sizeFromRms: 0.5,
        ringScaleFromBands: 0.45,
        ringSpeedFromBands: 1.8,
        colorBoostFromCentroid: 0.4,
        cameraShakeFromBeat: 0.2,
        sphereBrightnessFromRms: 1.6,
        sphereNoiseFromMid: 1.2,
        ringNoiseFromBands: 0.45,
        lightIntensityFromBass: 2.4,
        // new band sensitivities
        bandWeightBass: 1.4,
        bandWeightMid: 1.15,
        bandWeightTreble: 1.2,
        starTwinkleFromTreble: 0.8,
      ringTiltFromBass: 0.65,
        // new: sphere bass punch and treble sparkle
        spherePulseFromBass: 0.95,
        sphereSparkleFromTreble: 0.8,
        // FOV pump strength
        fovPumpFromBass: 0.6,
        cameraRollFromCentroid: 0.18,
        mainSwayFromFlux: 0.12,
        chromaLightInfluence: 0.22,
        ringBrightFromChroma: 0.3,
        // Advanced mapping toggle
        advancedMapping: false,
        // Per-target band weights (used when advancedMapping = true)
        sizeWeights: { bass: 1.0, mid: 0.4, treble: 0.2 },
        ringScaleWeights: { bass: 0.8, mid: 0.6, treble: 0.2 },
        ringSpeedWeights: { bass: 0.6, mid: 0.9, treble: 0.3 },
        sphereNoiseWeights: { bass: 0.2, mid: 1.0, treble: 0.4 },
        ringNoiseWeights: { bass: 0.4, mid: 0.6, treble: 0.3 },
        // Drop visuals
        drop: { intensity: 1.0, bloomBoost: 0.6, shake: 0.5, ringBurst: 0.6 },
        // Chromatic aberration response
        chromatic: { base: 0.00025, treble: 0.0009, beat: 0.0012, drop: 0.0024, lerp: 0.14 },
        // Shockwave pulse
        shockwave: { enabled: true, beatIntensity: 0.55, dropIntensity: 1.2, durationMs: 1200 },
        eye: {
          enabled: false,
          pupilBase: 0.22,
          pupilRange: 0.45,
          pupilAttack: 0.18,
          pupilRelease: 0.35,
          catAspectMax: 0.65,
          hueMixFromChroma: 0.65,
          saturationFromCentroid: 0.5,
          fiberContrast: 1.2,
          fiberNoiseScale: 3.0,
          limbusDarkness: 0.55,
          blinkOnDrop: true,
          blinkDurationMs: 150,
          randomBlinkMinSec: 12,
          randomBlinkMaxSec: 28,
          corneaEnabled: false,
          corneaFresnel: 1.25,
          corneaTintMix: 0.25,
          corneaOpacity: 0.65,
          glintSize: 0.035,
        glintIntensity: 1.2,
        predatorMode: false,
      },
      },
      // Morph/Webcam removed
      explosion: { onBeat: true, cooldownMs: 500 },
      _lastBeatTime: -9999,
      // Overlay features
      enableDispersion: true,
      dispersionShaderVariant: 'classic', // 'classic' | 'vortexDrill'
      // Visual mode: 'classic' | 'overlay' | 'shader-only'
      visualMode: 'shader-only',
      // Effects profile: 'off' | 'medium' | 'high'
      effectsProfile: 'high',
    },
    eye: {
      mesh: null,
      cornea: null,
      baseScale: 5.4,
      pupilRadius: 0.22,
      blink: 0,
      blinkDuration: 0.15,
      blinkElapsed: 0,
      catAspect: 0,
      catDropTimer: 0,
      lastBlinkAt: 0,
      nextBlinkAt: 0,
      predatorMode: false,
      baseHue: 0.6,
      hue: 0.6,
      saturation: 0.65,
      irisGain: 1.0,
      glint: new THREE.Vector2(0.25, -0.18),
      qualityDropActive: false,
      dropBlinkCooldown: 0,
    },
    // Morph/Webcam removed state
  };

  state.params.dispersion = withDispersionDefaults(state.params.dispersion || {});

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

  function buildComposer() {
    const renderPass = new RenderPass(state.scene, state.camera);
    state.renderPass = renderPass;
    state.bloomEffect = new BloomEffect({ intensity: state.params.bloomStrengthBase });
    state.chromaticEffect = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: false, modulationOffset: 0.0 });
    state.chromaticIntensity = 0;
    state.metrics.chromaticEnabled = state.chromaticEffect ? 1 : 0;
    const effectPass = new EffectPass(state.camera, state.bloomEffect, state.chromaticEffect);
    state.effectPass = effectPass;
    state.metrics.bloomIntensity = state.bloomEffect.intensity;
    // Force 8-bit framebuffer to avoid glCopyTexSubImage2D format issues on some GPUs
    state.composer = new EffectComposer(state.renderer, { frameBufferType: THREE.UnsignedByteType });
    state.composer.addPass(renderPass);
    state.composer.addPass(effectPass);
  }

  buildComposer();

  // Dispersion overlay layer (full-screen quad), composited after effects
  function setupVisualMode(mode) {
    // Remove any existing dispersion pass if present
    if (state.dispersion?.layer) {
      try { state.dispersion.layer.pass.enabled = false; } catch(_) {}
    }
    // Defaults
    state.renderPass.enabled = true;
    state.effectPass.enabled = true;
    try { state.effectPass.renderToScreen = false; } catch(_) {}

    if (mode === 'classic') {
      // Only the existing 3D visuals
      if (state.dispersion?.layer) state.dispersion.layer.setEnabled(false);
      try { state.effectPass.renderToScreen = true; } catch(_) {}
    } else if (mode === 'overlay') {
      // 3D + shader overlay on top
      ensureDispersion();
      state.dispersion.layer.setEnabled(state.params.enableDispersion !== false);
      state.dispersion.layer.pass.renderToScreen = true;
      state.effectPass.renderToScreen = false;
    } else if (mode === 'shader-only') {
      // Hide 3D render, only draw the dispersion shader to screen
      ensureDispersion();
      state.renderPass.enabled = false;
      state.effectPass.enabled = false;
      state.dispersion.layer.setEnabled(true);
      state.dispersion.layer.pass.renderToScreen = true;
    }
  }

  function ensureDispersion() {
    if (state.dispersion?.layer) return state.dispersion.layer;
    try {
      state.dispersion.layer = createDispersionLayer(state.params.dispersionShaderVariant || 'classic');
      state.dispersion.layer.setSize(window.innerWidth, window.innerHeight);
      state.composer.addPass(state.dispersion.layer.pass);
    } catch (e) {
      console.warn('Dispersion overlay unavailable:', e);
      state.dispersion.layer = null;
      state.params.enableDispersion = false;
    }
    return state.dispersion.layer;
  }

  setupVisualMode(state.params.visualMode || 'overlay');

  /**
   * Update global effects profile scaling.
   * off: disables bloom/chromatic influence; medium: reduces; high: full.
   */
  function setEffectsProfile(profile) {
    const p = String(profile || 'high');
    state.params.effectsProfile = p;
    if (p === 'off') {
      state.effectsBloomScale = 0.0;
      state.effectsChromaticScale = 0.0;
    } else if (p === 'medium') {
      state.effectsBloomScale = 0.6;
      state.effectsChromaticScale = 0.5;
    } else {
      state.effectsBloomScale = 1.0;
      state.effectsChromaticScale = 1.0;
    }
  }

  // Initialize effects profile scaling from params
  setEffectsProfile(state.params.effectsProfile || 'high');

  /**
   * Rebuild the post-processing pipeline (composer and passes) and reapply visual mode.
   * Useful as a panic/fix action during live operation.
   */
  function resetVisualPipeline() {
    try {
      buildComposer();
      // Re-attach dispersion pass if it exists
      if (state.dispersion?.layer?.pass) {
        try { state.composer.addPass(state.dispersion.layer.pass); } catch (_) {}
      }
      setupVisualMode(state.params.visualMode || 'overlay');
    } catch (_) {}
  }

  // Particles
  const sphereCount = Math.floor(40000 * state.params.particleDensity);
  const ringCountPer = Math.floor(4000 * state.params.particleDensity);
  const starCount = Math.floor(10000 * state.params.particleDensity);

  // Decide if we should enable the outer shell layer (perf guard)
  function shouldEnableOuterShell() {
    if (!state.params.outerShell?.enabled) return false;
    if (state.params.performanceMode) return false;
    try { return state.renderer.getPixelRatio() >= (state.params.minPixelRatio + 0.05); } catch(_) { return true; }
  }

  function scheduleNextBlink(nowMs) {
    if (!state.params.map.eye) state.params.map.eye = {};
    const cfg = state.params.map.eye;
    const minSec = Math.max(0, cfg.randomBlinkMinSec ?? 12);
    const maxSec = Math.max(minSec + 0.5, cfg.randomBlinkMaxSec ?? 28);
    const minMs = minSec * 1000;
    const spanMs = Math.max(0, (maxSec - minSec) * 1000);
    state.eye.nextBlinkAt = nowMs + minMs + Math.random() * spanMs;
  }

  function triggerEyeBlink(durationMs) {
    if (!state.params.map.eye) state.params.map.eye = {};
    const cfg = state.params.map.eye;
    const durMs = Math.max(45, durationMs ?? cfg.blinkDurationMs ?? 150);
    state.eye.blink = 1;
    state.eye.blinkElapsed = 0;
    state.eye.blinkDuration = durMs / 1000;
    const now = performance.now();
    state.eye.lastBlinkAt = now;
    scheduleNextBlink(now);
  }

  function setEyeEnabled(enabled) {
    if (!state.params.map.eye) state.params.map.eye = {};
    const cfg = state.params.map.eye;
    cfg.enabled = !!enabled;
    if (state.eye.mesh) state.eye.mesh.visible = !!enabled;
    if (state.eye.cornea) {
      const corneaEnabled = cfg.corneaEnabled !== false && enabled;
      state.eye.cornea.visible = corneaEnabled;
    }
    if (enabled) {
      scheduleNextBlink(performance.now());
    } else {
      state.eye.blink = 0;
      state.eye.nextBlinkAt = 0;
    }
  }

  function setEyeCorneaEnabled(enabled) {
    if (!state.params.map.eye) state.params.map.eye = {};
    const cfg = state.params.map.eye;
    cfg.corneaEnabled = !!enabled;
    if (enabled) {
      if (!state.eye.cornea) {
        try {
          state.eye.cornea = createCornea(5.06);
          state.eye.cornea.visible = cfg.enabled !== false;
          state.scene.add(state.eye.cornea);
        } catch (e) {
          console.error('Failed to create cornea layer on enable', e);
          state.eye.cornea = null;
        }
      } else {
        state.eye.cornea.visible = cfg.enabled !== false;
      }
    } else if (state.eye.cornea) {
      try {
        state.scene.remove(state.eye.cornea);
        state.eye.cornea.geometry.dispose();
        state.eye.cornea.material.dispose();
      } catch (_) {}
      state.eye.cornea = null;
    }
  }

  function setEyePredatorMode(enabled) {
    if (!state.params.map.eye) state.params.map.eye = {};
    const next = !!enabled;
    state.params.map.eye.predatorMode = next;
    state.eye.predatorMode = next;
    return next;
  }

  function toggleEyePredatorMode() {
    return setEyePredatorMode(!state.eye.predatorMode);
  }

  state.coreSphere = createSpiralSphere(5, sphereCount, state.mouse);
  if (shouldEnableOuterShell()) {
    const outerCount = Math.max(1000, Math.floor(sphereCount * (state.params.outerShell.densityScale || 0.6)));
    state.outerSphere = createSpiralSphere(state.params.outerShell.radius || 6.2, outerCount, state.mouse);
    try { state.outerSphere.renderOrder = 1; } catch(_) {}
  }
  state.orbitRings = createOrbitRings(7.5, 8, 0.6, ringCountPer, state.mouse);
  state.starfield = createStarfield(starCount, 50000);
  state.sparks = state.params.enableSparks ? createSparks(Math.floor(8000 * state.params.particleDensity)) : null;
  const shockwaveLayer = createShockwave();
  state.shockwave.mesh = shockwaveLayer.mesh;
  state.shockwave.material = shockwaveLayer.material;
  state.shockwave.mesh.visible = false;
  state.mainGroup.add(state.coreSphere); if (state.outerSphere) state.mainGroup.add(state.outerSphere); state.mainGroup.add(state.orbitRings);
  state.scene.add(state.mainGroup); state.scene.add(state.starfield); if (state.sparks) state.scene.add(state.sparks);
  state.scene.add(state.shockwave.mesh);
  state.metrics.sparksActive = state.sparks ? 1 : 0;

  if (EYE_FEATURE_ENABLED) {
    if (!state.params.map.eye) state.params.map.eye = {};
    const eyeParams = state.params.map.eye;
    state.eye.predatorMode = !!eyeParams.predatorMode;
    try {
      state.eye.mesh = createEyeLayer();
      state.eye.mesh.scale.setScalar(state.eye.baseScale);
      state.eye.mesh.visible = eyeParams.enabled !== false;
      state.eye.mesh.position.set(0, 0.12, 0);
      state.mainGroup.add(state.eye.mesh);
      scheduleNextBlink(performance.now());
    } catch (e) {
      console.error('Failed to create eye layer', e);
      state.eye.mesh = null;
    }
    if (eyeParams.corneaEnabled !== false) {
      try {
        state.eye.cornea = createCornea(5.06);
        state.eye.cornea.visible = eyeParams.enabled !== false;
        state.scene.add(state.eye.cornea);
      } catch (e) {
        console.error('Failed to create cornea layer', e);
        state.eye.cornea = null;
      }
    }
  }

  // Webcam/morph feature removed

  // Lights + optional central glow sprite
  state.centralLight = new THREE.PointLight(0xffffff, 2, 0);
  state.centralLight.position.set(0, 0, 0); state.scene.add(state.centralLight);
  function setupLensflare() {
    if (state.centralGlow) return;
    const texture = createGlowTexture(256);
    if (!texture) {
      console.warn('Failed to create core glow texture; disabling glow layer');
      state.params.useLensflare = false;
      return;
    }
    try {
      const maxAniso = state.renderer?.capabilities?.getMaxAnisotropy?.();
      if (maxAniso && Number.isFinite(maxAniso)) {
        texture.anisotropy = Math.min(8, maxAniso);
      }
    } catch (_) {}
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      color: state.centralLight.color.clone(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.6,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(14);
    sprite.renderOrder = 5;
    sprite.position.set(0, 0, 0);
    sprite.userData.dispose = () => {
      try { texture.dispose(); } catch (_) {}
      try { material.dispose(); } catch (_) {}
    };
    state.centralGlow = sprite;
    state.centralLight.add(sprite);
  }
  function teardownLensflare() {
    if (!state.centralGlow) return;
    try { state.centralLight.remove(state.centralGlow); } catch(_) {}
    try { state.centralGlow.userData.dispose?.(); } catch(_) {}
    state.centralGlow = null;
  }
  if (state.params.useLensflare) setupLensflare();

  function applyThemeColors(theme) {
    if (Array.isArray(theme?.sphere) && theme.sphere.length) {
      let sumX = 0;
      let sumY = 0;
      let hueCount = 0;
      let satSum = 0;
      theme.sphere.forEach((color) => {
        if (!color) return;
        const hsl = { h: 0, s: 0, l: 0 };
        color.getHSL(hsl);
        const angle = hsl.h * Math.PI * 2;
        sumX += Math.cos(angle);
        sumY += Math.sin(angle);
        satSum += hsl.s;
        hueCount++;
      });
      if (hueCount > 0) {
        let avgHue = Math.atan2(sumY / hueCount, sumX / hueCount) / (2 * Math.PI);
        if (avgHue < 0) avgHue += 1;
        state.eye.baseHue = avgHue;
        state.eye.hue = avgHue;
      }
    }

    const sphereColorsAttr = state.coreSphere.geometry.attributes.color;
    for (let i = 0; i < sphereColorsAttr.count; i++) {
      const colorPos = (i / sphereColorsAttr.count) * (theme.sphere.length - 1);
      const c1 = theme.sphere[Math.floor(colorPos)];
      const c2 = theme.sphere[Math.min(Math.floor(colorPos) + 1, theme.sphere.length - 1)];
      const newColor = new THREE.Color().copy(c1).lerp(c2, colorPos - Math.floor(colorPos));
      sphereColorsAttr.setXYZ(i, newColor.r, newColor.g, newColor.b);
    }
    sphereColorsAttr.needsUpdate = true;
    if (state.outerSphere) {
      const outerAttr = state.outerSphere.geometry.attributes.color;
      for (let i = 0; i < outerAttr.count; i++) {
        const colorPos = (i / outerAttr.count) * (theme.sphere.length - 1);
        const c1 = theme.sphere[Math.floor(colorPos)];
        const c2 = theme.sphere[Math.min(Math.floor(colorPos) + 1, theme.sphere.length - 1)];
        const base = new THREE.Color().copy(c1).lerp(c2, colorPos - Math.floor(colorPos));
        const halo = new THREE.Color().copy(base).lerp(new THREE.Color(0xffffff), 0.25);
        outerAttr.setXYZ(i, halo.r, halo.g, halo.b);
      }
      outerAttr.needsUpdate = true;
    }
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
      // Try local asset first, then fallback to theme.hdr remote URL
      let texture = null;
      const fileName = (theme.hdr || '').split('/').pop();
      if (fileName) {
        try { texture = await loader.loadAsync(`/assets/hdr/${fileName}`); } catch (_) { texture = null; }
      }
      if (!texture) {
        texture = await loader.loadAsync(theme.hdr);
      }
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

  function triggerShockwave(intensity = 1, overrideDurationMs) {
    if (!state.shockwave?.mesh) return;
    const cfg = state.params.map.shockwave || {};
    if (cfg.enabled === false) return;
    state.shockwave.active = true;
    state.shockwave.intensity = Math.max(0.2, intensity);
    const durationMs = overrideDurationMs ?? cfg.durationMs ?? 1200;
    state.shockwave.duration = Math.max(0.25, durationMs / 1000);
    state.shockwave.startTime = state.clock.getElapsedTime();
    state.shockwave.mesh.visible = true;
    state.metrics.shockwaveActive = 1;
    state.metrics.shockwaveIntensity = state.shockwave.intensity;
    state.metrics.shockwaveProgress = 0;
    state.metrics.shockwaveOpacity = 1;
    if (state.shockwave.material?.uniforms) {
      state.shockwave.material.uniforms.uOpacity.value = 1.0;
      state.shockwave.material.uniforms.uProgress.value = 0.0;
      state.shockwave.material.uniforms.uIntensity.value = state.shockwave.intensity;
    }
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
    state.mainGroup.remove(state.coreSphere); if (state.outerSphere) state.mainGroup.remove(state.outerSphere); state.mainGroup.remove(state.orbitRings); state.scene.remove(state.starfield); if (state.sparks) state.scene.remove(state.sparks);
    state.coreSphere.geometry.dispose(); state.coreSphere.material.dispose();
    if (state.outerSphere) { try { state.outerSphere.geometry.dispose(); state.outerSphere.material.dispose(); } catch(_) {} }
    state.orbitRings.children.forEach(r => { r.geometry.dispose(); r.material.dispose(); });
    state.starfield.geometry.dispose(); state.starfield.material.dispose(); if (state.sparks) { state.sparks.geometry.dispose(); state.sparks.material.dispose(); }

    const sphereCount = Math.floor(40000 * state.params.particleDensity);
    const ringCountPer = Math.floor(4000 * state.params.particleDensity);
    const starCount = Math.floor(10000 * state.params.particleDensity);

    state.coreSphere = createSpiralSphere(5, sphereCount, state.mouse);
    if (shouldEnableOuterShell()) {
      const outerCount = Math.max(1000, Math.floor(sphereCount * (state.params.outerShell.densityScale || 0.6)));
      state.outerSphere = createSpiralSphere(state.params.outerShell.radius || 6.2, outerCount, state.mouse);
      try { state.outerSphere.renderOrder = 1; } catch(_) {}
    } else {
      state.outerSphere = null;
    }
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

    state.mainGroup.add(state.coreSphere); if (state.outerSphere) state.mainGroup.add(state.outerSphere); state.mainGroup.add(state.orbitRings); state.scene.add(state.starfield); if (state.sparks) state.scene.add(state.sparks);
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
      state.metrics.sparksActive = 0;
      state.metrics.sparksAlive = 0;
    } else {
      state.sparks = createSparks(Math.floor(8000 * state.params.particleDensity));
      state.scene.add(state.sparks);
      state.metrics.sparksActive = 1;
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
    if (state.dispersion?.layer) {
      try { state.dispersion.layer.setSize(window.innerWidth, window.innerHeight); } catch(_) {}
    }
    // Re-apply mode to keep renderToScreen wiring intact after pass list changes
    try { setupVisualMode(state.params.visualMode || 'overlay'); } catch(_) {}
  }

  function onMouseMove(event) {
    state.mouse.x = (event.clientX / window.innerWidth) * 2 - 1; state.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  // maintain a local high-resolution delta for camera-controls
  let _lastUpdateNow = performance.now();

  function update(features) {
    const t = state.clock.getElapsedTime();
    // Fetch external performance deltas once per frame
    const perf = (typeof state._perfDeltasProvider === 'function') ? (state._perfDeltasProvider() || {}) : {};
    const nowPerf = performance.now();
    const dt = (nowPerf - _lastUpdateNow) / 1000;
    _lastUpdateNow = nowPerf;
    const nowMs = nowPerf;
    const rms = features?.rmsNorm ?? 0.0;
    const isBeat = !!(features && features.beat);
    const isDrop = !!(features && features.drop);
    const dispersionParams = withDispersionDefaults(state.params.dispersion || {});
    state.params.dispersion = dispersionParams;

    // Explosion on beat
    if (isBeat) {
      if (state.params.explosion.onBeat && nowMs - state.params._lastBeatTime > state.params.explosion.cooldownMs) {
        state.params._lastBeatTime = nowMs; triggerExplosion();
      }
    }

    updateExplosion(t);

    const beatGrid = features?.beatGrid;
    const prevBeatsPerBar = Math.max(1, state._beatsPerBar || 4);
    let beatsPerBar = prevBeatsPerBar;
    let beatIntervalMs = state._lastBeatIntervalMs || 0;
    if (beatGrid && typeof beatGrid.bpm === 'number' && beatGrid.bpm > 0) {
      const candidateIntervalMs = 60000 / beatGrid.bpm;
      if (candidateIntervalMs > 0) beatIntervalMs = candidateIntervalMs;
      if (Array.isArray(beatGrid.downbeats) && beatGrid.downbeats.length >= 2 && candidateIntervalMs > 0) {
        for (let i = 1; i < beatGrid.downbeats.length; i++) {
          const diff = beatGrid.downbeats[i] - beatGrid.downbeats[i - 1];
          if (diff > 1e-3) {
            const candidateBeats = Math.round(diff / (candidateIntervalMs / 1000));
            if (candidateBeats >= 1 && candidateBeats <= 16) {
              beatsPerBar = candidateBeats;
              break;
            }
          }
        }
      }
    } else if (typeof features?.bpm === 'number' && features.bpm > 0) {
      beatIntervalMs = 60000 / features.bpm;
    }
    if (beatIntervalMs > 0) state._lastBeatIntervalMs = beatIntervalMs;
    if (beatsPerBar !== prevBeatsPerBar) state._beatIndex = -1;
    state._beatsPerBar = beatsPerBar;
    let downbeatPulse = 0;
    if (isBeat) {
      if (state._beatIndex === null || state._beatIndex < 0 || state._beatIndex >= beatsPerBar) {
        state._beatIndex = 0;
        downbeatPulse = 1;
      } else {
        state._beatIndex = (state._beatIndex + 1) % beatsPerBar;
        if (state._beatIndex === 0) downbeatPulse = 1;
      }
      state._lastBeatTimeMs = nowMs;
    } else if (state._lastBeatIntervalMs > 0) {
      const sinceLast = nowMs - (state._lastBeatTimeMs || nowMs);
      if (sinceLast > state._lastBeatIntervalMs * 3) {
        state._beatIndex = -1;
      }
    }
    state.metrics.downbeatPulse = downbeatPulse;
    state.metrics.beatsPerBar = beatsPerBar;
    state.metrics.beatIndex = Math.max(0, state._beatIndex ?? 0);

    if (state.shockwave?.material?.uniforms) {
      const sw = state.shockwave;
      const cfg = state.params.map.shockwave || {};
      if (cfg.enabled === false) {
        sw.active = false;
        sw.mesh.visible = false;
        sw.progress = 0;
        sw.opacity = 0;
        state.metrics.shockwaveActive = 0;
        state.metrics.shockwaveProgress = 0;
        state.metrics.shockwaveOpacity = 0;
        state.metrics.shockwaveIntensity = 0;
      } else {
        if (sw.active) {
          const elapsed = t - sw.startTime;
          const progress = THREE.MathUtils.clamp(elapsed / sw.duration, 0, 1);
          const eased = easeOutExpo(progress);
          sw.material.uniforms.uTime.value = t;
          sw.material.uniforms.uProgress.value = eased;
          sw.material.uniforms.uIntensity.value = sw.intensity;
          const opacity = Math.max(0, 1 - progress) * 0.85 * sw.intensity;
          sw.material.uniforms.uOpacity.value = opacity;
          sw.mesh.scale.setScalar(5 + eased * 38);
          sw.mesh.position.set(0, 0.2 + rms * 1.1, 0);
          sw.progress = progress;
          sw.opacity = opacity;
          state.metrics.shockwaveActive = 1;
          state.metrics.shockwaveProgress = progress;
          state.metrics.shockwaveOpacity = opacity;
          state.metrics.shockwaveIntensity = sw.intensity;
          if (progress >= 1) {
            sw.active = false;
            sw.mesh.visible = false;
            state.metrics.shockwaveActive = 0;
            state.metrics.shockwaveIntensity = 0;
          }
        } else {
          sw.progress = 0;
          sw.opacity = 0;
          state.metrics.shockwaveActive = 0;
          state.metrics.shockwaveProgress = 0;
          state.metrics.shockwaveOpacity = 0;
          state.metrics.shockwaveIntensity = 0;
        }
      }
    }

    // Uniforms/time (guarded)
    if (state.coreSphere?.material?.uniforms) {
      state.coreSphere.material.uniforms.time.value = t; state.coreSphere.material.uniforms.uMouse.value.copy(state.mouse);
    }
    if (state.outerSphere?.material?.uniforms) { state.outerSphere.material.uniforms.time.value = t; state.outerSphere.material.uniforms.uMouse.value.copy(state.mouse); }
    if (state.orbitRings?.children) { state.orbitRings.children.forEach(r => { if (r.material?.uniforms) { r.material.uniforms.time.value = t; r.material.uniforms.uMouse.value.copy(state.mouse); } }); }
    if (state.starfield?.material?.uniforms) { state.starfield.material.uniforms.time.value = t; }

    // Reactivity mappings
    const sub = features?.bandEnv?.sub ?? features?.bands?.sub ?? 0.0;
    const bass = features?.bandEnv?.bass ?? features?.bands?.bass ?? 0.0;
    const mid = features?.bandEnv?.mid ?? features?.bands?.mid ?? 0.0;
    const treble = features?.bandEnv?.treble ?? features?.bands?.treble ?? 0.0;
    const centroid = features?.centroidNorm ?? 0.0;
    const shockCfg = state.params.map.shockwave || {};
    const chromaCfg = state.params.map.chromatic || {};
    const chromaArray = Array.isArray(features?.chroma) ? features.chroma : null;
    const chromaLength = chromaArray?.length ?? 0;

    let dominantChromaIndex = state.metrics.chromaIndex || 0;
    let dominantChromaEnergy = state.metrics.chromaEnergy || 0;
    let chromaHue = state.metrics.chromaHue || (dominantChromaIndex / Math.max(1, chromaLength || 12));
    if (chromaArray && chromaLength) {
      let maxVal = -Infinity;
      for (let i = 0; i < chromaLength; i++) {
        const val = chromaArray[i] ?? 0;
        if (val > maxVal) {
          maxVal = val;
          dominantChromaIndex = i;
          dominantChromaEnergy = Math.max(0, val);
        }
      }
      if (maxVal <= 0) {
        dominantChromaEnergy = 0;
      }
      chromaHue = dominantChromaIndex / chromaLength;
    } else {
      dominantChromaEnergy = 0;
    }
    dominantChromaEnergy = Math.min(1, dominantChromaEnergy);
    state.metrics.chromaIndex = dominantChromaIndex;
    state.metrics.chromaEnergy = dominantChromaEnergy;
    state.metrics.chromaHue = chromaHue;

    if (state.eye.mesh) {
      const eyeCfg = state.params.map.eye || {};
      const eyeEnabled = eyeCfg.enabled !== false;
      if (state.eye.mesh.visible !== eyeEnabled) state.eye.mesh.visible = eyeEnabled;
      if (state.eye.cornea) {
        const corneaVisible = eyeEnabled && eyeCfg.corneaEnabled !== false;
        if (state.eye.cornea.visible !== corneaVisible) state.eye.cornea.visible = corneaVisible;
      }
      if (eyeEnabled) {
        if (typeof eyeCfg.predatorMode === 'boolean' && eyeCfg.predatorMode !== state.eye.predatorMode) {
          state.eye.predatorMode = eyeCfg.predatorMode;
        }
        if (state.eye.dropBlinkCooldown > 0) state.eye.dropBlinkCooldown = Math.max(0, state.eye.dropBlinkCooldown - dt);
        if (!Number.isFinite(state.eye.nextBlinkAt) || state.eye.nextBlinkAt <= 0) scheduleNextBlink(nowPerf);
        if (eyeCfg.randomBlinkMaxSec > 0 && nowPerf >= state.eye.nextBlinkAt) triggerEyeBlink();
        if (eyeCfg.blinkOnDrop && isDrop && state.eye.dropBlinkCooldown <= 0) {
          triggerEyeBlink();
          state.eye.dropBlinkCooldown = 1.2;
        }

        const pupilBase = THREE.MathUtils.clamp(eyeCfg.pupilBase ?? 0.22, 0.02, 0.9);
        const pupilRange = Math.max(0, eyeCfg.pupilRange ?? 0.45);
        const pupilMod = THREE.MathUtils.clamp(0.65 * bass - 0.25 * treble + 0.2 * rms, 0, 1);
        const pupilTarget = THREE.MathUtils.clamp(pupilBase + pupilRange * pupilMod, 0.08, 0.95);
        const attack = Math.max(0.01, eyeCfg.pupilAttack ?? 0.18);
        const release = Math.max(0.01, eyeCfg.pupilRelease ?? 0.35);
        const lerpRate = dt / (pupilTarget > state.eye.pupilRadius ? attack : release);
        const pupilLerp = THREE.MathUtils.clamp(lerpRate, 0, 1);
        state.eye.pupilRadius = THREE.MathUtils.lerp(state.eye.pupilRadius, pupilTarget, pupilLerp);

        if (state.eye.catDropTimer > 0) state.eye.catDropTimer = Math.max(0, state.eye.catDropTimer - dt);
        const catMax = THREE.MathUtils.clamp(eyeCfg.catAspectMax ?? 0.65, 0, 1);
        if (isDrop && catMax > 0) state.eye.catDropTimer = Math.max(state.eye.catDropTimer, 1.5);
        let catTarget = state.eye.predatorMode ? catMax : 0;
        if (state.eye.catDropTimer > 0) catTarget = Math.max(catTarget, catMax * 0.7);
        state.eye.catAspect = THREE.MathUtils.lerp(state.eye.catAspect, catTarget, Math.min(1, dt * 3));

        if (state.eye.blink > 0) {
          const blinkDur = Math.max(0.05, state.eye.blinkDuration || 0.15);
          state.eye.blink = Math.max(0, state.eye.blink - (dt / blinkDur));
        }

        const hueMixWeight = Math.min(1, dominantChromaEnergy * (eyeCfg.hueMixFromChroma ?? 0.65));
        state.eye.hue = THREE.MathUtils.lerp(state.eye.baseHue ?? chromaHue, chromaHue, hueMixWeight);
        const saturationGain = THREE.MathUtils.clamp(0.52 + (eyeCfg.saturationFromCentroid ?? 0.5) * centroid, 0, 1);
        state.eye.saturation = saturationGain;
        state.eye.irisGain = 0.9 + rms * 0.7;

        const glintX = 0.2 + 0.08 * Math.sin(t * 0.7);
        const glintY = -0.18 + 0.06 * Math.cos(t * 0.45);
        state.eye.glint.set(glintX, glintY);

        const perfDrop = state.params.performanceMode;
        const fiberContrast = perfDrop ? Math.max(0.6, (eyeCfg.fiberContrast ?? 1.2) * 0.75) : (eyeCfg.fiberContrast ?? 1.2);
        const fiberNoiseScale = perfDrop ? Math.max(1.2, (eyeCfg.fiberNoiseScale ?? 3.0) * 0.7) : (eyeCfg.fiberNoiseScale ?? 3.0);
        const limbus = eyeCfg.limbusDarkness ?? 0.55;
        const alpha = perfDrop ? 0.85 : 1.0;

        updateEyeUniforms(state.eye.mesh, {
          time: t,
          pupilRadius: state.eye.pupilRadius,
          pupilAspect: state.eye.catAspect,
          blink: state.eye.blink,
          hue: state.eye.hue,
          saturation: state.eye.saturation,
          irisGain: state.eye.irisGain,
          fiberContrast,
          fiberNoiseScale,
          limbus,
          glintPos: state.eye.glint,
          glintSize: eyeCfg.glintSize ?? 0.035,
          glintIntensity: eyeCfg.glintIntensity ?? 1.2,
          alpha,
        });

        const scaleFactor = state.eye.baseScale * (state.metrics.coreScale || 1);
        state.eye.mesh.scale.setScalar(scaleFactor);
        try { state.eye.mesh.quaternion.copy(state.camera.quaternion); } catch (_) {}

        state.metrics.eyePupil = state.eye.pupilRadius;
        state.metrics.eyeBlink = state.eye.blink;
        state.metrics.eyeCatAspect = state.eye.catAspect;
      }
    }
    if (state.eye.cornea && state.eye.cornea.visible) {
      const eyeCfg = state.params.map.eye || {};
      const scaleFactor = state.metrics.coreScale || 1;
      state.eye.cornea.scale.setScalar(scaleFactor);
      state.eye.cornea.rotation.y += dt * 0.12;
      state.eye.cornea.rotation.x += dt * 0.06;
      const uniforms = state.eye.cornea.userData?.uniforms || state.eye.cornea.material.uniforms;
      if (uniforms) {
        uniforms.uTime.value = t;
        uniforms.uFresnel.value = eyeCfg.corneaFresnel ?? 1.25;
        const lightColor = state.centralLight?.color || new THREE.Color(0xffffff);
        const tintMix = THREE.MathUtils.clamp(eyeCfg.corneaTintMix ?? 0.25, 0, 1);
        const tint = new THREE.Color(0xffffff).lerp(lightColor, tintMix);
        uniforms.uTint.value.copy(tint);
        const opacityBase = eyeCfg.corneaOpacity ?? 0.65;
        const opacity = Math.min(1, opacityBase + (isDrop ? 0.15 : 0));
        uniforms.uOpacity.value = opacity;
      }
    }

    if (!Number.isFinite(state._centroidEma)) state._centroidEma = centroid;
    const centroidDelta = centroid - state._centroidEma;
    state._centroidEma = THREE.MathUtils.lerp(state._centroidEma, centroid, 0.18);
    state.metrics.centroidDelta = centroidDelta;
    const rollStrength = state.params.map.cameraRollFromCentroid ?? 0;
    const rollTarget = THREE.MathUtils.clamp(centroidDelta * rollStrength, -0.45, 0.45);
    state._cameraRoll = THREE.MathUtils.lerp(state._cameraRoll ?? 0, rollTarget, 0.12);

    const flux = features?.flux ?? 0;
    const fluxMean = features?.fluxMean ?? flux;
    const fluxStd = features?.fluxStd ?? 0;
    let fluxZ = 0;
    if (fluxStd > 1e-5) {
      fluxZ = (flux - fluxMean) / fluxStd;
    }
    fluxZ = THREE.MathUtils.clamp(fluxZ, -6, 6);
    state.metrics.fluxZ = fluxZ;
    const swayStrength = state.params.map.mainSwayFromFlux ?? 0;
    const swayTarget = THREE.MathUtils.clamp(fluxZ * swayStrength, -0.6, 0.6);
    state._fluxSway = THREE.MathUtils.lerp(state._fluxSway ?? 0, swayTarget, 0.1);
    state.metrics.groupSway = state._fluxSway;
    state.mainGroup.rotation.x = state._fluxSway;

    const dispersionCfg = dispersionParams;
    const parallaxCentroidGain = typeof dispersionCfg.parallaxCentroidGain === 'number' ? dispersionCfg.parallaxCentroidGain : 0.08;
    const parallaxFluxGain = typeof dispersionCfg.parallaxFluxGain === 'number' ? dispersionCfg.parallaxFluxGain : 0.024;
    const parallaxClamp = THREE.MathUtils.clamp(dispersionCfg.parallaxClamp ?? 0.16, 0.01, 0.8);
    const parallaxEnabled = (parallaxCentroidGain !== 0 || parallaxFluxGain !== 0);
    const centroidInput = THREE.MathUtils.clamp(centroidDelta, -2, 2);
    if (!Number.isFinite(state._parallaxCentroidEma)) state._parallaxCentroidEma = centroidInput;
    if (!Number.isFinite(state._parallaxFluxEma)) state._parallaxFluxEma = fluxZ;
    const centroidEma = THREE.MathUtils.lerp(state._parallaxCentroidEma, centroidInput, 0.2);
    const fluxEma = THREE.MathUtils.lerp(state._parallaxFluxEma, fluxZ, 0.18);
    state._parallaxCentroidEma = centroidEma;
    state._parallaxFluxEma = fluxEma;

    const targetParallaxX = parallaxEnabled
      ? THREE.MathUtils.clamp(centroidEma * parallaxCentroidGain, -parallaxClamp, parallaxClamp)
      : 0;
    const targetParallaxY = parallaxEnabled
      ? THREE.MathUtils.clamp(fluxEma * parallaxFluxGain, -parallaxClamp, parallaxClamp)
      : 0;
    const baseLerp = THREE.MathUtils.clamp(dispersionCfg.parallaxLerp ?? 0.18, 0.01, 1.0);
    const attack = Math.min(1, baseLerp * 1.6);
    const release = Math.min(1, baseLerp * 0.6);
    const smoothParallax = (current, target) => {
      const rate = target > current ? attack : release;
      return THREE.MathUtils.lerp(current, target, rate);
    };
    state._parallaxOffsetX = smoothParallax(state._parallaxOffsetX ?? 0, targetParallaxX);
    state._parallaxOffsetY = smoothParallax(state._parallaxOffsetY ?? 0, targetParallaxY);
    if (!parallaxEnabled) {
      state._parallaxOffsetX = THREE.MathUtils.lerp(state._parallaxOffsetX, 0, 0.25);
      state._parallaxOffsetY = THREE.MathUtils.lerp(state._parallaxOffsetY, 0, 0.25);
    }
    state.metrics.parallaxOffsetX = state._parallaxOffsetX;
    state.metrics.parallaxOffsetY = state._parallaxOffsetY;

    if (isBeat && shockCfg.enabled !== false && !isDrop) {
      if (bass > 0.28 || rms > 0.32) {
        const intensity = THREE.MathUtils.clamp((bass * 0.7 + rms * 0.5) * (shockCfg.beatIntensity ?? 0.55), 0.25, 1.1);
        triggerShockwave(intensity);
      }
    }

    // Core scale: RMS base + bass punch
    const bassPunch = bass * state.params.map.spherePulseFromBass;
    let breathe = 1;
    // Advanced mapping: compute size from weighted bands if enabled
    if (state.params.map.advancedMapping) {
      const w = state.params.map.sizeWeights || { bass: 1, mid: 0.4, treble: 0.2 };
      const sizeMix = Math.max(0, bass * w.bass + mid * w.mid + treble * w.treble);
      breathe = 1 + sizeMix * state.params.map.sizeFromRms + bassPunch * 0.25;
    } else {
      breathe = 1 + rms * state.params.map.sizeFromRms + bassPunch * 0.4;
    }
    state.coreSphere.scale.set(breathe, breathe, breathe);
    state.metrics.coreScale = breathe;
    if (state.outerSphere) {
      const b2 = breathe * 1.02;
      state.outerSphere.scale.set(b2, b2, b2);
      state.metrics.outerScale = b2;
    } else {
      state.metrics.outerScale = 0;
    }

    const wBass = state.params.map.bandWeightBass;
    const wMid = state.params.map.bandWeightMid;
    const wTreble = state.params.map.bandWeightTreble;
    const bandMixBase = (bass * wBass * 0.6 + mid * wMid * 0.3 + treble * wTreble * 0.1);
    let ringScaleAccum = 0;
    let ringSpeedAccum = 0;
    let ringNoiseAccum = 0;
    let ringBrightAccum = 0;
    const ringCount = state.orbitRings.children.length || 1;
    state.orbitRings.children.forEach((ring, index) => {
      // Advanced mapping per-target
      let ringScaleMix = bandMixBase;
      let ringSpeedMix = bandMixBase;
      if (state.params.map.advancedMapping) {
        const ws = state.params.map.ringScaleWeights || { bass: 0.8, mid: 0.6, treble: 0.2 };
        const wv = state.params.map.ringSpeedWeights || { bass: 0.6, mid: 0.9, treble: 0.3 };
        ringScaleMix = Math.max(0, bass * ws.bass + mid * ws.mid + treble * ws.treble);
        ringSpeedMix = Math.max(0, bass * wv.bass + mid * wv.mid + treble * wv.treble);
      }
      const speed = 0.0004 * (index + 1) * (1 + ringSpeedMix * state.params.map.ringSpeedFromBands);
      ring.rotation.z += speed; ring.rotation.x += speed * 0.3; ring.rotation.y += speed * 0.2;
      const scaleY = 1.0 + ringScaleMix * state.params.map.ringScaleFromBands; ring.scale.y = scaleY;
      ringScaleAccum += scaleY;
      ringSpeedAccum += speed;
      // subtle tilt from bass energy
      ring.rotation.x += (bass * wBass) * 0.0005 * state.params.map.ringTiltFromBass;
    });
    state.metrics.ringScale = ringScaleAccum / ringCount;
    state.metrics.ringSpeed = ringSpeedAccum / ringCount;

    // Bloom reactivity (centroid boost is user-tunable)
    let bloomReactive =
      state.params.bloomStrengthBase +
      rms * state.params.bloomReactiveGain +
      centroid * (state.params.map.colorBoostFromCentroid ?? 0.2);
    bloomReactive = Math.max(0, bloomReactive) * (state.effectsBloomScale ?? 1);
    state.bloomEffect.intensity = bloomReactive;
    state.metrics.bloomIntensity = state.bloomEffect.intensity;

    // Sphere specific reactivity (noise and brightness)
    if (state.coreSphere?.material?.uniforms) {
      // Noise from mid, brightness from RMS + treble sparkle
      const coreNoise = Math.max(0.0, mid * state.params.map.sphereNoiseFromMid);
      state.coreSphere.material.uniforms.uReactiveScale.value = coreNoise;
      const sparkle = treble * state.params.map.sphereSparkleFromTreble;
      const coreBright = Math.max(0.0, rms * state.params.map.sphereBrightnessFromRms + sparkle * 0.6);
      state.coreSphere.material.uniforms.uReactiveBright.value = coreBright;
      state.metrics.coreNoise = coreNoise;
      state.metrics.coreBrightness = coreBright;
    }
    if (state.outerSphere?.material?.uniforms) {
      const outerNoise = Math.max(0.0, mid * state.params.map.sphereNoiseFromMid * 0.4);
      const outerBright = Math.max(0.0, rms * state.params.map.sphereBrightnessFromRms * 0.5);
      state.outerSphere.material.uniforms.uReactiveScale.value = outerNoise;
      state.outerSphere.material.uniforms.uReactiveBright.value = outerBright;
    }

    // Rings turbulence from band energy
    state.orbitRings.children.forEach((ring) => {
      if (ring.material?.uniforms) {
        let ringNoiseMix = (bass * wBass * 0.6 + mid * wMid * 0.3 + treble * wTreble * 0.1);
        if (state.params.map.advancedMapping) {
          const wn = state.params.map.ringNoiseWeights || { bass: 0.4, mid: 0.6, treble: 0.3 };
          ringNoiseMix = Math.max(0, bass * wn.bass + mid * wn.mid + treble * wn.treble);
        }
        const ringReactive = Math.max(0.0, ringNoiseMix * state.params.map.ringNoiseFromBands);
        ring.material.uniforms.uReactiveScale.value = ringReactive;
        ringNoiseAccum += ringReactive;
        const ringBright = Math.max(0.0, rms * 0.4 + dominantChromaEnergy * (state.params.map.ringBrightFromChroma ?? 0));
        ring.material.uniforms.uReactiveBright.value = ringBright;
        ringBrightAccum += ringBright;
      }
    });
    state.metrics.ringNoise = ringNoiseAccum / ringCount;
    state.metrics.ringBrightness = ringBrightAccum / ringCount;

    // Lens flare subtle color boost with centroid/chroma + intensity from bass
    const chromaInfluence = Math.max(0, state.params.map.chromaLightInfluence ?? 0);
    const chromaMix = Math.min(1, chromaInfluence * dominantChromaEnergy);
    const baseHue = THREE.MathUtils.euclideanModulo(0.6 + 0.4 * centroid, 1);
    const hue = THREE.MathUtils.lerp(baseHue, chromaHue, chromaMix);
    const centralColor = new THREE.Color().setHSL(hue, 0.65 + 0.15 * centroid, 0.55 + 0.25 * rms);
    state.metrics.lightHue = hue;
    state.metrics.lightMix = chromaMix;
    state.centralLight.color.lerp(centralColor, 0.05);
    state.centralLight.intensity = 1.8 + (bass * wBass) * state.params.map.lightIntensityFromBass + rms * 0.8;
    if (state.centralGlow?.material) {
      state.centralGlow.material.color.copy(state.centralLight.color);
      const glowOpacity = THREE.MathUtils.clamp(0.45 + rms * 0.6 + treble * 0.35, 0.2, 1.0);
      state.centralGlow.material.opacity = glowOpacity;
      const glowScale = 12 * (1 + bass * 0.9 + rms * 0.4);
      state.centralGlow.scale.setScalar(glowScale);
    }

    // Camera micro shake on beat
    if (features?.beat) {
      const amt = 0.02 * state.params.map.cameraShakeFromBeat;
      state.camera.position.x += (Math.random() - 0.5) * amt; state.camera.position.y += (Math.random() - 0.5) * amt;
    }

    // Stars twinkle more with treble
    if (state.starfield?.material?.uniforms?.uTwinkleGain) {
      const twinkleValue = Math.max(0.0, treble * wTreble * state.params.map.starTwinkleFromTreble);
      state.starfield.material.uniforms.uTwinkleGain.value = twinkleValue;
      state.metrics.starTwinkle = twinkleValue;
    }
    if (state.starfield) {
      state.starfield.rotation.y += 0.00002 + treble * 0.00035;
      const targetTilt = (centroid - 0.5) * 0.35;
      state.starfield.rotation.x = THREE.MathUtils.lerp(state.starfield.rotation.x, targetTilt, 0.02);
      state.metrics.starTilt = state.starfield.rotation.x;
    }

    if (state.chromaticEffect) {
      let targetChromatic =
        (chromaCfg.base ?? 0.0002) +
        treble * (chromaCfg.treble ?? 0.0008) +
        rms * 0.00025;
      if (isBeat) targetChromatic += (chromaCfg.beat ?? 0.001);
      if (isDrop) targetChromatic += (chromaCfg.drop ?? 0.002);
      if (typeof perf.chromatic === 'number') targetChromatic += perf.chromatic;
      const lerpFactor = THREE.MathUtils.clamp(chromaCfg.lerp ?? 0.14, 0.02, 0.4);
      state.chromaticIntensity = THREE.MathUtils.lerp(state.chromaticIntensity || 0, targetChromatic, lerpFactor);
      const scale = state.effectsChromaticScale ?? 1;
      const offset = Math.min(0.006, Math.max(0, state.chromaticIntensity * scale));
      state.chromaticEffect.offset.set(offset, offset * 0.65);
      state.metrics.chromaticEnabled = scale > 0 ? 1 : 0;
      state.metrics.chromaticOffset = offset;
      state.metrics.chromaticOffsetY = offset * 0.65;
    } else {
      state.metrics.chromaticEnabled = 0;
      state.metrics.chromaticOffset = 0;
      state.metrics.chromaticOffsetY = 0;
    }

    // Camera FOV pump from bass (use sub+bass for kick focus)
    const baseFov = 75;
    const pump = Math.max(0, (0.7 * bass + 0.3 * sub)) * (state.params.map.fovPumpFromBass || 0);
    const perfFov = (typeof perf.cameraFovDelta === 'number') ? perf.cameraFovDelta : 0;
    state.camera.fov = baseFov + pump * 10.0 + perfFov;
    state.camera.far = 50000; state.camera.updateProjectionMatrix();
    state.metrics.cameraFov = state.camera.fov;

    // Drop visuals
    if (isDrop) {
      const m = state.params.map.drop || {};
      // Bloom flash
      state.bloomEffect.intensity = (state.params.bloomStrengthBase || 1.2) + (m.bloomBoost || 0.6);
      state.metrics.bloomIntensity = state.bloomEffect.intensity;
      // Extra camera shake
      const shakeAmt = 0.05 * (m.shake || 0.5);
      state.camera.position.x += (Math.random() - 0.5) * shakeAmt; state.camera.position.y += (Math.random() - 0.5) * shakeAmt;
      // Ring burst
      state.orbitRings.children.forEach((ring) => { ring.scale.y *= (1.0 + 0.4 * (m.ringBurst || 0.6)); });
      if (shockCfg.enabled !== false) {
        const dropIntensity = THREE.MathUtils.clamp((m.intensity || 1.0) * (shockCfg.dropIntensity ?? 1.2) * (0.7 + rms + bass * 0.6), 0.6, 2.2);
        triggerShockwave(dropIntensity, shockCfg.durationMs);
      }
    }

    // Sparks: emit on beats and breathe with RMS
    if (state.sparks) {
      // Throttle spark updates when FPS is low to save CPU
      const approxFps = dt > 1e-6 ? Math.min(240, Math.max(1, 1 / dt)) : 60;
      const fpsTarget = state.params.targetFps || 60;
      const lowFps = approxFps < (fpsTarget - 10);
      state._sparkStep = (state._sparkStep || 0) + 1;
      const shouldUpdate = !lowFps || (state._sparkStep % 2 === 0);
      if (shouldUpdate) {
        const g = state.sparks.geometry;
        const pos = g.attributes.position.array;
        const life = g.attributes.life.array;
        const N = life.length;
        let alive = 0;
        // Lower respawn probability when FPS is low
        const respawnP = features?.beat ? (lowFps ? 0.05 : 0.1) : 0;
        for (let i = 0; i < N; i++) {
          // decay
          life[i] = Math.max(0, life[i] - dt * 0.8);
          if (respawnP && Math.random() < respawnP) {
            // respawn a subset on beat
            const i3 = i * 3; const r = 0.5 + Math.random() * 1.5;
            const theta = Math.random() * Math.PI * 2; const phi = Math.acos(2*Math.random()-1);
            pos[i3] = Math.cos(theta) * Math.sin(phi) * r;
            pos[i3+1] = Math.sin(theta) * Math.sin(phi) * r;
            pos[i3+2] = Math.cos(phi) * r;
            life[i] = 1.0;
          }
          if (life[i] > 0.05) alive++;
        }
        g.attributes.life.needsUpdate = true; g.attributes.position.needsUpdate = true;
        state.metrics.sparksActive = 1;
        state.metrics.sparksAlive = N ? alive / N : 0;
      }
    } else {
      state.metrics.sparksActive = 0;
      state.metrics.sparksAlive = 0;
    }

    // Slow auto-rotate
    state.mainGroup.rotation.y += state.params.autoRotate;

    // Dispersion overlay uniforms
    if (state.dispersion?.layer) {
      const enable = state.params.enableDispersion !== false;
      try { state.dispersion.layer.setEnabled(enable); } catch(_) {}
      if (enable) {
        // Ensure shader variant is applied if changed at runtime (no forced override here)
        try { state.dispersion.layer.setVariant?.(state.params.dispersionShaderVariant || 'classic'); } catch(_) {}
        const d = dispersionParams;
        let twistFlippedThisFrame = false;
        const zoomGain = typeof d.zoomGain === 'number' ? d.zoomGain : 28.0;
        const zoomBias = typeof d.zoomBias === 'number' ? d.zoomBias : -10.0;
        const zoomLerp = typeof d.zoomLerp === 'number' ? d.zoomLerp : 0.1;
        const opacityBase = typeof d.opacityBase === 'number' ? d.opacityBase : 0.18;
        const opacityTrebleGain = typeof d.opacityTrebleGain === 'number' ? d.opacityTrebleGain : 0.55;
        const opacityMin = typeof d.opacityMin === 'number' ? d.opacityMin : 0.12;
        const opacityMax = typeof d.opacityMax === 'number' ? d.opacityMax : 0.8;
        const opacityLerp = typeof d.opacityLerp === 'number' ? d.opacityLerp : 0.12;
        const warpFrom = d.warpFrom || 'bass';
        const warpGain = typeof d.warpGain === 'number' ? d.warpGain : 0.8;
        const warpOnBeat = d.warpOnBeat !== false;
        const warpOnDropBoost = typeof d.warpOnDropBoost === 'number' ? d.warpOnDropBoost : 0.6;
        const tintHue = typeof d.tintHue === 'number' ? d.tintHue : 0.0;
        const tintSat = typeof d.tintSat === 'number' ? d.tintSat : 0.0;
        const tintMixBase = typeof d.tintMixBase === 'number'
          ? d.tintMixBase
          : (typeof d.tintMix === 'number' ? d.tintMix : 0.0);
        const tintMixChromaGain = typeof d.tintMixChromaGain === 'number' ? d.tintMixChromaGain : 0.45;
        const tintMixMax = typeof d.tintMixMax === 'number' ? d.tintMixMax : 0.85;
        const chromaEnergy = THREE.MathUtils.clamp(state.metrics.chromaEnergy ?? dominantChromaEnergy ?? 0, 0, 1);
        const tintMixTarget = THREE.MathUtils.clamp(tintMixBase + chromaEnergy * tintMixChromaGain, 0, tintMixMax);
        if (!Number.isFinite(state._tintMix)) state._tintMix = tintMixTarget;
        state._tintMix = THREE.MathUtils.lerp(state._tintMix, tintMixTarget, 0.25);
        const tintMix = state._tintMix;
        state.metrics.tintMix = tintMix;
        const brightBase = typeof d.brightness === 'number' ? d.brightness : 1.0;
        const brightGain = typeof d.brightnessGain === 'number' ? d.brightnessGain : 0.4;
        const contrastBase = typeof d.contrast === 'number' ? d.contrast : 1.0;
        const contrastGain = typeof d.contrastGain === 'number' ? d.contrastGain : 0.3;

        let zoomTarget = THREE.MathUtils.clamp((bass * 1.2 + rms * 0.6) * zoomGain + zoomBias, -30.0, 30.0);
        if (typeof perf.dispersionZoom === 'number') {
          zoomTarget = THREE.MathUtils.clamp(zoomTarget + perf.dispersionZoom, -30.0, 30.0);
        }
        // perf.dispersionZoomPulse reserved (not used currently)
        if (typeof perf.zoomSnap === 'number' && perf.zoomSnap) {
          zoomTarget = THREE.MathUtils.clamp(zoomTarget + perf.zoomSnap, -30.0, 30.0);
        }
        if (typeof perf.zoomBounce === 'number' && perf.zoomBounce) {
          zoomTarget = THREE.MathUtils.clamp(zoomTarget + perf.zoomBounce, -30.0, 30.0);
        }
        state.dispersion.zoom = THREE.MathUtils.lerp(state.dispersion.zoom || 0, zoomTarget, zoomLerp);
        const parallaxOffsetX = state._parallaxOffsetX ?? 0;
        const parallaxOffsetY = state._parallaxOffsetY ?? 0;
        const centerK = (typeof perf.centering === 'number') ? THREE.MathUtils.clamp(perf.centering, 0, 1) : 0;
        // Pull offsets towards center while active so the zoom is centered
        state.dispersion.offsetX = parallaxOffsetX * (1 - centerK);
        state.dispersion.offsetY = parallaxOffsetY * (1 - centerK);
        let opacityTarget = THREE.MathUtils.clamp(opacityBase + treble * opacityTrebleGain, opacityMin, opacityMax);
        if (typeof perf.dispersionOpacityBoost === 'number') {
          opacityTarget = THREE.MathUtils.clamp(opacityTarget + perf.dispersionOpacityBoost, 0.0, 1.0);
        }
        state.dispersion.opacity = THREE.MathUtils.lerp(state.dispersion.opacity || opacityTarget, opacityTarget, opacityLerp);
        let warpSource = 0;
        if (warpFrom === 'bass') warpSource = bass; else if (warpFrom === 'mid') warpSource = mid; else if (warpFrom === 'treble') warpSource = treble; else if (warpFrom === 'rms') warpSource = rms; else warpSource = bass;
        let warp = warpSource * warpGain + (warpOnBeat && isBeat ? 0.25 : 0) + (isDrop ? warpOnDropBoost : 0);
        warp = Math.max(0, warp + (typeof perf.dispersionWarp === 'number' ? perf.dispersionWarp : 0));
        const hue = (tintHue + state.metrics.chromaHue) - Math.floor(tintHue + state.metrics.chromaHue);
        const sat = THREE.MathUtils.clamp(tintSat, 0, 1);
        const val = 1.0;
        const c = val * sat;
        const x = c * (1.0 - Math.abs(((hue * 6.0) % 2.0) - 1.0));
        const m = val - c;
        let rt = 0.0, gt = 0.0, bt = 0.0;
        if (hue < 1.0/6.0) { rt = c; gt = x; bt = 0.0; }
        else if (hue < 2.0/6.0) { rt = x; gt = c; bt = 0.0; }
        else if (hue < 3.0/6.0) { rt = 0.0; gt = c; bt = x; }
        else if (hue < 4.0/6.0) { rt = 0.0; gt = x; bt = c; }
        else if (hue < 5.0/6.0) { rt = x; gt = 0.0; bt = c; }
        else { rt = c; gt = 0.0; bt = x; }
        const tintColor = new THREE.Color(rt + m, gt + m, bt + m);
        const brightness = brightBase + brightGain * rms + (typeof perf.dispersionBrightnessBoost === 'number' ? perf.dispersionBrightnessBoost : 0);
        const contrast = contrastBase + contrastGain * (bass * 0.6 + treble * 0.4);

        // Twist synthesis
        const twistBase = typeof d.twistBase === 'number' ? d.twistBase : 0.0;
        const twistMax = typeof d.twistMax === 'number' ? d.twistMax : 0.8;
        const twistBassGain = typeof d.twistBassGain === 'number' ? d.twistBassGain : 0.6;
        const twistBeatGain = typeof d.twistBeatGain === 'number' ? d.twistBeatGain : 0.35;
        const twistOnsetGain = typeof d.twistOnsetGain === 'number' ? d.twistOnsetGain : 0.25;
        const twistFluxGain = typeof d.twistFluxGain === 'number' ? d.twistFluxGain : 0.15;
        const twistStutterGain = typeof d.twistStutterGain === 'number' ? d.twistStutterGain : 0.2;
        const twistAttack = typeof d.twistAttack === 'number' ? d.twistAttack : 0.32;
        const twistRelease = typeof d.twistRelease === 'number' ? d.twistRelease : 0.14;
        const pulseHalfLifeMs = typeof d.pulseHalfLifeMs === 'number' ? d.pulseHalfLifeMs : 160;
        const twistFalloff = typeof d.twistFalloff === 'number' ? d.twistFalloff : 1.2;
        const stutterWindowMs = typeof d.stutterWindowMs === 'number' ? d.stutterWindowMs : 180;
        const flipOnStutter = d.flipOnStutter !== false;
        const downbeatTwistBoost = typeof d.downbeatTwistBoost === 'number' ? d.downbeatTwistBoost : 0.3;
        const flipEveryNBeats = Math.max(0, Math.floor(typeof d.flipEveryNBeats === 'number' ? d.flipEveryNBeats : 0));
        if (state.dispersion._flipSetting !== flipEveryNBeats) {
          state.dispersion._flipSetting = flipEveryNBeats;
          state.dispersion._flipBeatAccumulator = 0;
        }
        if (flipEveryNBeats <= 0) {
          state.dispersion._flipBeatAccumulator = 0;
        } else if (isBeat) {
          state.dispersion._flipBeatAccumulator = (state.dispersion._flipBeatAccumulator || 0) + 1;
          if (downbeatPulse && state.dispersion._flipBeatAccumulator >= flipEveryNBeats) {
            state.dispersion.twistDir = (state.dispersion.twistDir || 1) * -1;
            state.dispersion._flipBeatAccumulator = 0;
            twistFlippedThisFrame = true;
          }
        }

        // Track onsets for stutter detection
        if (features?.aubioOnset) {
          state.dispersion.stutterTimes.push(nowMs);
        }
        // Remove old events
        const cutoff = nowMs - Math.max(80, stutterWindowMs);
        state.dispersion.stutterTimes = state.dispersion.stutterTimes.filter(t0 => t0 >= cutoff);
        const stutterCount = state.dispersion.stutterTimes.length >= 2 ? 1 : 0;
        if (stutterCount && flipOnStutter && !twistFlippedThisFrame) {
          state.dispersion.twistDir = (state.dispersion.twistDir || 1) * -1;
          twistFlippedThisFrame = true;
        }

        const fluxZ = (features && typeof features.fluxStd === 'number' && features.fluxStd > 1e-6)
          ? Math.max(0, (features.flux - features.fluxMean) / Math.max(1e-3, features.fluxStd))
          : 0;

        const decayAlpha = 1.0 - Math.exp(-dt * 1000.0 / Math.max(10, pulseHalfLifeMs));
        state.dispersion._beatEnv = (state.dispersion._beatEnv || 0) * (1 - decayAlpha) + (isBeat ? 1 : 0) * decayAlpha;
        state.dispersion._onsetEnv = (state.dispersion._onsetEnv || 0) * (1 - decayAlpha) + ((features?.aubioOnset ? 1 : 0)) * decayAlpha;
        state.dispersion._fluxEnv = (state.dispersion._fluxEnv || 0) * (1 - decayAlpha) + (fluxZ) * decayAlpha;
        state.dispersion._downbeatEnv = (state.dispersion._downbeatEnv || 0) * (1 - decayAlpha) + (downbeatPulse ? 1 : 0) * decayAlpha;

        let twistTarget = twistBase
          + bass * twistBassGain
          + state.dispersion._beatEnv * twistBeatGain
          + state.dispersion._onsetEnv * twistOnsetGain
          + state.dispersion._fluxEnv * twistFluxGain
          + state.dispersion._downbeatEnv * downbeatTwistBoost
          + stutterCount * twistStutterGain;
        if (typeof perf.dispersionTwistBoost === 'number') twistTarget += perf.dispersionTwistBoost;
        twistTarget = THREE.MathUtils.clamp(twistTarget, 0, twistMax);
        {
          const current = state.dispersion.twist || 0;
          const lerpRate = twistTarget > current ? twistAttack : twistRelease;
          state.dispersion.twist = THREE.MathUtils.lerp(current, twistTarget, THREE.MathUtils.clamp(lerpRate, 0, 1));
        }

        // Travel accumulation (forward motion)
        const travelBase = typeof d.travelBase === 'number' ? d.travelBase : 0.06;
        const travelGain = typeof d.travelGain === 'number' ? d.travelGain : 0.12;
        const travelBeatBoost = typeof d.travelBeatBoost === 'number' ? d.travelBeatBoost : 0.06;
        const travelDropBoost = typeof d.travelDropBoost === 'number' ? d.travelDropBoost : 0.12;
        const travelAttack = typeof d.travelAttack === 'number' ? d.travelAttack : 0.20;
        const travelRelease = typeof d.travelRelease === 'number' ? d.travelRelease : 0.08;
        const travelModulo = typeof d.travelModulo === 'number' ? d.travelModulo : 400;
        let travelSpeedTarget = travelBase + rms * travelGain + (isBeat ? travelBeatBoost : 0) + (isDrop ? travelDropBoost : 0);
        if (typeof perf.dispersionTravelBoost === 'number') travelSpeedTarget += perf.dispersionTravelBoost;
        {
          const current = state.dispersion.travelSpeed || travelSpeedTarget;
          const lr = travelSpeedTarget > current ? travelAttack : travelRelease;
          state.dispersion.travelSpeed = THREE.MathUtils.lerp(current, travelSpeedTarget, THREE.MathUtils.clamp(lr, 0, 1));
        }
        state.dispersion.travel = (state.dispersion.travel || 0) + state.dispersion.travelSpeed * dt * 60.0; // scale for frame-rate
        if (travelModulo > 1) {
          const m = travelModulo;
          state.dispersion.travel = ((state.dispersion.travel % m) + m) % m;
        }

        try {
          const dbSize = new THREE.Vector2();
          try { state.renderer.getDrawingBufferSize(dbSize); } catch(_) {}
          const dcfg = d; // alias
          // Variant-specific reactive mapping for Vortex Drill
          const isVortex = (state.params.dispersionShaderVariant === 'vortexDrill');
          let drillBoxVal = dcfg.drillBox ?? 1.5;
          let drillRadiusVal = dcfg.drillRadius ?? 1.0;
          let repPeriodVal = dcfg.repPeriod ?? 4.0;
          let rotDepthVal = dcfg.rotDepth ?? 0.10;
          let stepsVal = dcfg.steps ?? 300;
          if (isVortex) {
            const att = 0.28, rel = 0.16;
            const smooth = (current, target) => {
              const cur = (typeof current === 'number' && isFinite(current)) ? current : target;
              return THREE.MathUtils.lerp(cur, target, target > cur ? att : rel);
            };
            const boxTarget = THREE.MathUtils.clamp((dcfg.drillBox ?? 1.5) - bass * 0.25 - (downbeatPulse ? 0.12 : 0) - (isDrop ? 0.18 : 0), 0.8, 2.8);
            state.dispersion.drillBox = smooth(state.dispersion.drillBox, boxTarget);
            const radiusTarget = THREE.MathUtils.clamp((dcfg.drillRadius ?? 1.0) + treble * 0.35 + (isBeat ? 0.06 : 0) + (isDrop ? 0.12 : 0), 0.5, 1.8);
            state.dispersion.drillRadius = smooth(state.dispersion.drillRadius, radiusTarget);
            const repTarget = THREE.MathUtils.clamp((dcfg.repPeriod ?? 4.0) + centroid * 1.2 + (state.dispersion._fluxEnv || 0) * 0.5, 2.0, 8.0);
            state.dispersion.repPeriod = smooth(state.dispersion.repPeriod, repTarget);
            const rotTarget = THREE.MathUtils.clamp((dcfg.rotDepth ?? 0.10) + bass * 0.06 + (state.dispersion._beatEnv || 0) * 0.05 + (state.dispersion._onsetEnv || 0) * 0.03, 0.0, 0.25);
            state.dispersion.rotDepth = smooth(state.dispersion.rotDepth, rotTarget);
            const stepsTarget = THREE.MathUtils.clamp((dcfg.steps ?? 300) + (isDrop ? 30 : 0) + ((state.renderer.getPixelRatio?.() || 1) >= 1.25 ? 10 : 0), 60, 420);
            state.dispersion.steps = stepsTarget;
            drillBoxVal = state.dispersion.drillBox;
            drillRadiusVal = state.dispersion.drillRadius;
            repPeriodVal = state.dispersion.repPeriod;
            rotDepthVal = state.dispersion.rotDepth;
            stepsVal = state.dispersion.steps;
          }
          // Push variant-specific uniforms
          if (state.dispersion?.layer?.material?.uniforms) {
            const u = state.dispersion.layer.material.uniforms;
            if (u.uDrillBox) u.uDrillBox.value = THREE.MathUtils.clamp(drillBoxVal, 0.5, 4.0);
            if (u.uDrillRadius) u.uDrillRadius.value = THREE.MathUtils.clamp(drillRadiusVal, 0.2, 3.0);
            if (u.uRepPeriod) u.uRepPeriod.value = THREE.MathUtils.clamp(repPeriodVal, 1.0, 12.0);
            if (u.uRotDepth) u.uRotDepth.value = THREE.MathUtils.clamp(rotDepthVal, 0.0, 0.4);
            if (u.uSteps) u.uSteps.value = THREE.MathUtils.clamp(stepsVal, 60, 450);
          }
          state.dispersion.layer.update({
            time: t,
            zoom: state.dispersion.zoom,
            offsetX: state.dispersion.offsetX,
            offsetY: state.dispersion.offsetY,
            opacity: state.dispersion.opacity,
            warp,
            tint: tintColor,
            tintMix,
            brightness,
            contrast,
            twist: (state.dispersion.twist || 0) * (state.dispersion.twistDir || 1),
            twistFalloff,
            travel: state.dispersion.travel || 0,
            width: dbSize.x || state.renderer.domElement.width,
            height: dbSize.y || state.renderer.domElement.height,
          });
        } catch(_) {}
      }
    }

    try { state.controls.update(dt); } catch(_) {}
    try { state.camera.rotation.z = state._cameraRoll || 0; } catch(_) {}
    state.metrics.cameraRoll = state._cameraRoll || 0;
    if (state.composer && state.composer.render) { state.composer.render(); } else { try { state.renderer.render(state.scene, state.camera); } catch(_) {} }
    return state.metrics;
  }

  changeTheme('nebula');

  return {
    state,
    changeTheme,
    triggerExplosion,
    triggerShockwave,
    triggerEyeBlink,
    setPixelRatioCap,
    rebuildParticles,
    setEnableSparks,
    setUseLensflare,
    setEffectsProfile,
    resetVisualPipeline,
    setEyeEnabled,
    setEyeCorneaEnabled,
    setEyePredatorMode,
    toggleEyePredatorMode,
    onResize,
    onMouseMove,
    update,
    setUniformDeltasProvider: (fn) => { state._perfDeltasProvider = typeof fn === 'function' ? fn : null; },
    setVisualMode: (mode) => { try { setupVisualMode(mode); } catch(_) {} },
    getPixelRatio: () => state.renderer.getPixelRatio(),
  };
}
