import * as THREE from 'three';
import { Press } from './press.js';

const DEG = Math.PI / 180;
export const FOV = 26;
/** The sheet: page units, y down. */
export const SHEET = { cx: 1700, cy: 1000, w: 16000, h: 11000 };
export const toWorld = (x, y, z = 0) => new THREE.Vector3(x, -y, z);

const PAPER_GLSL = /* glsl */ `
  varying vec2 vPaper;
  float ph(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float pn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(ph(i), ph(i + vec2(1, 0)), u.x), mix(ph(i + vec2(0, 1)), ph(i + vec2(1, 1)), u.x), u.y);
  }
  // Paper relief in page units. Octaves fade out once they are smaller than a pixel.
  float paperHeight(vec2 p, float px) {
    float h = 0.0;
    float a = 0.5;
    float f = 0.03;
    vec2 q = p;
    for (int i = 0; i < 4; i++) {
      float vis = 1.0 - smoothstep(0.25, 0.9, px * f);
      h += a * vis * (pn(q * f) - 0.5);
      q = mat2(0.8, -0.6, 0.6, 0.8) * q + 17.0;
      f *= 2.2;
      a *= 0.5;
    }
    // Sparse cotton fibres lying every which way.
    float fv = 1.0 - smoothstep(0.35, 1.1, px * 0.7);
    if (fv > 0.0) {
      float fib = 0.0;
      for (int k = 0; k < 3; k++) {
        float ang = float(k) * 2.1 + 0.4;
        mat2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        vec2 u = r * (p + float(k) * 41.0);
        float n = pn(vec2(u.x * 0.07, u.y * 0.6));
        float m = pn(u * 0.012 + float(k) * 7.0);
        fib += smoothstep(0.68, 0.92, n) * smoothstep(0.35, 0.75, m);
      }
      h += 0.07 * fv * fib;
    }
    return h;
  }
  // Rare inclusions in the stock: soft round flecks.
  float fleckMask(vec2 p, float px) {
    vec2 c = floor(p / 18.0);
    float r = ph(c);
    if (r < 0.986) return 0.0;
    vec2 at = (c + 0.2 + 0.6 * vec2(ph(c + 3.1), ph(c + 7.7))) * 18.0;
    float rad = 0.5 + 1.1 * ph(c + 1.3);
    float d = length(p - at);
    return (1.0 - smoothstep(rad * 0.4, rad, d)) * (1.0 - smoothstep(0.8, 2.0, px));
  }
`;

/** A dark studio with softboxes: metal and foil read as highlights, not as a bright room. */
function studio() {
  const s = new THREE.Scene();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.048, 0.045), side: THREE.BackSide }));
  s.add(shell);
  const box = (w, h, color, k, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  // World z is up (the sheet faces +z). Key softbox upper-left, as the key light.
  box(60, 40, 0xfff1e0, 5.0, [-42, 52, 58]);
  box(14, 70, 0xffffff, 3.0, [70, -10, 40]);
  box(80, 14, 0xffe2c4, 1.6, [0, -70, 30]);
  box(36, 36, 0xf4f0ea, 1.1, [0, 0, 95]);
  return s;
}

export class Engine {
  constructor(canvas, { width, height }) {
    this.width = width;
    this.height = height;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(studio(), 0.02).texture;
    scene.environmentIntensity = 0.5;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(FOV, width / height, 10, 60000);
    this.camera.up.set(0, 1, 0);

    // ---------- press canvases (projected onto the sheet) ----------
    this.press = new Press(Math.round(width * 1.25), Math.round(height * 1.25), Math.round(width * 0.6), Math.round(height * 0.6));
    const inkTex = new THREE.CanvasTexture(this.press.ink.canvas);
    inkTex.colorSpace = THREE.SRGBColorSpace;
    inkTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    inkTex.generateMipmaps = true;
    inkTex.minFilter = THREE.LinearMipmapLinearFilter;
    inkTex.wrapS = inkTex.wrapT = THREE.ClampToEdgeWrapping;
    const reliefTex = new THREE.CanvasTexture(this.press.relief.canvas);
    reliefTex.colorSpace = THREE.NoColorSpace;
    reliefTex.wrapS = reliefTex.wrapT = THREE.ClampToEdgeWrapping;
    this.inkTex = inkTex;
    this.reliefTex = reliefTex;

    // ---------- the sheet ----------
    const paperMat = new THREE.MeshStandardMaterial({ map: inkTex, bumpMap: reliefTex, bumpScale: 3, roughness: 0.93, metalness: 0, envMapIntensity: 1 });
    paperMat.onBeforeCompile = (shader) => {
      shader.uniforms.fiberAmp = { value: 0.9 };
      this.paperUniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPaper;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaper = (modelMatrix * vec4(position, 1.0)).xy * vec2(1.0, -1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PAPER_GLSL}\nuniform float fiberAmp;`)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            float px = length(fwidth(vPaper));
            float fleck = fleckMask(vPaper, px);
            float tone = pn(vPaper * 0.004) * 0.035 + pn(vPaper * 0.02) * 0.02;
            diffuseColor.rgb *= (0.975 + tone) * (1.0 - fleck * 0.35);
          }`,
        )
        .replace(
          '#include <bumpmap_pars_fragment>',
          `#ifdef USE_BUMPMAP
            uniform sampler2D bumpMap;
            uniform float bumpScale;
            vec2 dHdxy_fwd() {
              vec2 dSTdx = dFdx( vBumpMapUv );
              vec2 dSTdy = dFdy( vBumpMapUv );
              float px = length(fwidth(vPaper));
              float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x + fiberAmp * paperHeight(vPaper, px);
              float Hx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x + fiberAmp * paperHeight(vPaper + dFdx(vPaper), px);
              float Hy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x + fiberAmp * paperHeight(vPaper + dFdy(vPaper), px);
              return vec2( Hx - Hll, Hy - Hll );
            }
            vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
              // Unnormalized (Mikkelsen): heights are in page units, so relief keeps its depth at any zoom.
              vec3 vSigmaX = dFdx( surf_pos.xyz );
              vec3 vSigmaY = dFdy( surf_pos.xyz );
              vec3 vN = surf_norm;
              vec3 R1 = cross( vSigmaY, vN );
              vec3 R2 = cross( vN, vSigmaX );
              float fDet = dot( vSigmaX, R1 ) * faceDirection;
              vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
              return normalize( abs( fDet ) * surf_norm - vGrad );
            }
          #endif`,
        );
    };
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SHEET.w, SHEET.h), paperMat);
    sheet.position.copy(toWorld(SHEET.cx, SHEET.cy, 0));
    sheet.receiveShadow = true;
    scene.add(sheet);
    this.sheet = sheet;
    this.paperMat = paperMat;

    // ---------- lights ----------
    const key = new THREE.DirectionalLight(0xfff1de, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 14;
    key.shadow.blurSamples = 20;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0;
    scene.add(key, key.target);
    this.key = key;

    const spot = new THREE.SpotLight(0xffe7c8, 0, 0, 0.3, 0.75, 0);
    scene.add(spot, spot.target);
    this.spot = spot;

    const hemi = new THREE.HemisphereLight(0xfff6ea, 0x3a3328, 0.0);
    scene.add(hemi);
    this.hemi = hemi;

    // ---------- post ----------
    const rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(width, height),
    });
    this.rtScene = rt;
    this.rtDof = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.dofMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: rt.texture },
        tDepth: { value: rt.depthTexture },
        focus: { value: 2000 },
        aperture: { value: 0 },
        maxBlur: { value: 14 },
        near: { value: 10 },
        far: { value: 60000 },
        resolution: { value: new THREE.Vector2(width, height) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        #include <packing>
        varying vec2 vUv;
        uniform sampler2D tColor, tDepth;
        uniform float focus, aperture, maxBlur, near, far;
        uniform vec2 resolution;
        float viewZ(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return -perspectiveDepthToViewZ(d, near, far);
        }
        float coc(float z) { return clamp(abs(z - focus) / z * aperture, 0.0, maxBlur); }
        void main() {
          vec4 base = texture2D(tColor, vUv);
          if (aperture <= 0.0) { gl_FragColor = base; return; }
          float c0 = coc(viewZ(vUv));
          vec3 acc = base.rgb;
          float wsum = 1.0;
          const int N = 40;
          float ga = 2.39996323;
          for (int i = 1; i < N; i++) {
            float r = sqrt(float(i) / float(N)) * maxBlur;
            float a = float(i) * ga;
            vec2 o = vec2(cos(a), sin(a)) * r / resolution;
            float cs = coc(viewZ(vUv + o));
            float w = smoothstep(r - 1.0, r + 1.0, min(cs, c0 + 2.0) + 0.5);
            acc += texture2D(tColor, vUv + o).rgb * w;
            wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });

    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtDof.texture },
        frame: { value: 0 },
        grain: { value: 0.045 },
        vignette: { value: 0.32 },
        fade: { value: 1 },
        resolution: { value: new THREE.Vector2(width, height) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tColor;
        uniform float frame, grain, vignette, fade;
        uniform vec2 resolution;
        float h(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        void main() {
          vec4 c = texture2D(tColor, vUv);
          c.rgb *= fade;
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          vec2 q = vUv - 0.5;
          q.x *= resolution.x / resolution.y;
          float v = 1.0 - vignette * smoothstep(0.35, 1.15, length(q));
          gl_FragColor.rgb *= v;
          float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
          float n = (h(vec3(gl_FragCoord.xy, frame)) + h(vec3(gl_FragCoord.xy + 37.0, frame + 11.0)) - 1.0);
          gl_FragColor.rgb += n * grain * (0.35 + 0.65 * (1.0 - abs(lum - 0.45) * 1.6));
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
  }

  /** Camera from a rig: target (x, y) on the page, visible height h, pitch/yaw/roll in degrees. */
  setCamera({ x, y, h, pitch = 0, yaw = 0, roll = 0 }) {
    const cam = this.camera;
    const dist = h / 2 / Math.tan((FOV / 2) * DEG);
    const p = pitch * DEG;
    const yw = yaw * DEG;
    const target = toWorld(x, y, 0);
    const off = new THREE.Vector3(0, -Math.sin(p) * dist, Math.cos(p) * dist);
    off.applyAxisAngle(new THREE.Vector3(0, 0, 1), yw);
    cam.position.copy(target).add(off);
    const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), yw);
    const fwd = target.clone().sub(cam.position).normalize();
    up.applyAxisAngle(fwd, roll * DEG);
    cam.up.copy(up);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    this.focusDist = dist;
    this.target = target;
    this.viewH = h;
  }

  /** Page-space rect the camera sees (y down), clamped near the horizon. */
  visibleRect() {
    const cam = this.camera;
    const pts = [];
    const lim = this.viewH * 4;
    for (const [nx, ny] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const v = new THREE.Vector3(nx * 1.04, ny * 1.04, 0.5).unproject(cam);
      const dir = v.sub(cam.position).normalize();
      let t = dir.z < -1e-4 ? -cam.position.z / dir.z : Infinity;
      let p = cam.position.clone().add(dir.multiplyScalar(Math.min(t, 1e6)));
      // Clamp far corners so a tilted view does not waste the press on the horizon.
      const dx = p.x - this.target.x;
      const dy = p.y - this.target.y;
      const d = Math.hypot(dx, dy);
      if (!isFinite(t) || d > lim) {
        p = new THREE.Vector3(this.target.x + (dx / d) * lim, this.target.y + (dy / d) * lim, 0);
      }
      pts.push(p);
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => -p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  /** Maps the press canvases onto the sheet for this rect. */
  mapPress(r) {
    const rw = r.x1 - r.x0;
    const rh = r.y1 - r.y0;
    const left = SHEET.cx - SHEET.w / 2;
    const bottomWorld = -(SHEET.cy + SHEET.h / 2);
    for (const tex of [this.inkTex, this.reliefTex]) {
      tex.repeat.set(SHEET.w / rw, SHEET.h / rh);
      tex.offset.set((left - r.x0) / rw, (bottomWorld + r.y1) / rh);
      tex.needsUpdate = true;
    }
  }

  setLights(L) {
    const t = this.target;
    const key = this.key;
    const az = L.azimuth * DEG;
    const el = L.elevation * DEG;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el));
    key.position.copy(t).addScaledVector(dir, 6000);
    key.target.position.copy(t);
    key.target.updateMatrixWorld();
    key.intensity = L.key;
    key.color.setHex(L.keyColor ?? 0xfff1de);
    const s = Math.max(this.viewH * 2.6, 1600);
    const sc = key.shadow.camera;
    sc.left = -s;
    sc.right = s;
    sc.top = s;
    sc.bottom = -s;
    sc.near = 100;
    sc.far = 14000;
    sc.updateProjectionMatrix();

    this.hemi.intensity = L.hemi;
    this.scene.environmentIntensity = L.env;

    const sp = this.spot;
    sp.intensity = L.spot ?? 0;
    if (sp.intensity > 0) {
      const at = toWorld(L.spotX, L.spotY, 0);
      sp.position.set(at.x - 300, at.y + 900, 3200);
      sp.target.position.copy(at);
      sp.target.updateMatrixWorld();
      sp.angle = L.spotAngle;
      sp.penumbra = L.spotSoft ?? 0.8;
      sp.decay = 0;
    }
    this.renderer.toneMappingExposure = L.exposure;
  }

  render({ frame, aperture = 0, focusOffset = 0, grain = 0.045, vignette = 0.3, fade = 1 }) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.render(this.scene, this.camera);

    const u = this.dofMat.uniforms;
    u.focus.value = this.focusDist + focusOffset;
    u.aperture.value = aperture;
    this.quad.material = this.dofMat;
    r.setRenderTarget(this.rtDof);
    r.render(this.quadScene, this.quadCam);

    const f = this.finalMat.uniforms;
    f.frame.value = frame % 997;
    f.grain.value = grain;
    f.vignette.value = vignette;
    f.fade.value = fade;
    this.quad.material = this.finalMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
