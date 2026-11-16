import * as THREE from 'three';
import { FONT } from './press.js';
import { mulberry32 } from './util.js';

const rounded = (w, h, r) => {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

const alphaMask = (w, h, r, px = 512) => {
  const c = document.createElement('canvas');
  const k = px / Math.max(w, h);
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(1, 1, c.width - 2, c.height - 2, r * k);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
};

/** Fine anisotropic grain for hot-foil and brushed metal. */
const grainNormal = (seed, stretch = 6) => {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const r = mulberry32(seed);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let x = 0; x < n; x++) {
      acc = acc * (1 - 1 / stretch) + (r() - 0.5);
      h[y * n + x] = acc;
    }
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const dx = h[y * n + ((x + 1) % n)] - h[i];
      const dy = h[((y + 1) % n) * n + x] - h[i];
      img.data[i * 4] = 128 + dx * 40;
      img.data[i * 4 + 1] = 128 + dy * 40;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

// ---------------------------------------------------------------------------
// Foil: the emerald lens where the two rings overlap.
// ---------------------------------------------------------------------------
export class Foil {
  constructor() {
    this.uniforms = {
      lensR: { value: 200 },
      lensD: { value: 100 },
      domeH: { value: 9 },
      domeE: { value: 34 },
    };
    this.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#169a69'),
      metalness: 1,
      roughness: 0.34,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
      envMapIntensity: 1.7,
      normalMap: grainNormal(11, 3),
      normalScale: new THREE.Vector2(0.12, 0.12),
      transparent: true,
      opacity: 1,
    });
    this.material.normalMap.repeat.set(3, 3);
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position.xy;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vLocal;
          uniform float lensR, lensD, domeH, domeE;
          float lensEdge(vec2 p) {
            // Smooth minimum: the pressed foil has no crease where the two arcs meet.
            float a = lensR - length(p - vec2(-lensD, 0.0));
            float b = lensR - length(p - vec2(lensD, 0.0));
            float k = 22.0;
            return -k * log(exp(-a / k) + exp(-b / k)) + k * 0.69;
          }
          float dome(vec2 p) {
            float e = max(lensEdge(p), 0.0);
            return domeH * (1.0 - exp(-e / domeE));
          }
          vec3 perturbDome(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
            vec3 vSigmaX = dFdx(surf_pos);
            vec3 vSigmaY = dFdy(surf_pos);
            vec3 R1 = cross(vSigmaY, surf_norm);
            vec3 R2 = cross(surf_norm, vSigmaX);
            float fDet = dot(vSigmaX, R1) * faceDirection;
            vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
            return normalize(abs(fDet) * surf_norm - vGrad);
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec2 dx = dFdx(vLocal);
            vec2 dy = dFdy(vLocal);
            float h0 = dome(vLocal);
            vec2 dh = vec2(dome(vLocal + dx) - h0, dome(vLocal + dy) - h0);
            normal = perturbDome(-vViewPosition, normal, dh, faceDirection);
          }`,
        );
    };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.receiveShadow = true;
    this.key = '';
  }

  /** Lens of two circles radius R whose centres sit ±d from (x, y). */
  set(x, y, R, d, z = 0.6) {
    const k = `${R.toFixed(2)}:${d.toFixed(2)}`;
    if (k !== this.key && d < R) {
      this.key = k;
      const hh = Math.sqrt(R * R - d * d);
      const a = Math.atan2(hh, d);
      const s = new THREE.Shape();
      // Right edge belongs to the left circle, left edge to the right circle (world y up).
      s.absarc(-d, 0, R, -a, a, false);
      s.absarc(d, 0, R, Math.PI - a, Math.PI + a, false);
      const geo = new THREE.ShapeGeometry(s, 48);
      // UVs for the grain texture.
      const pos = geo.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = pos.getX(i) / (R * 0.6);
        uv[i * 2 + 1] = pos.getY(i) / (R * 0.6);
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
    }
    this.uniforms.lensR.value = R;
    this.uniforms.lensD.value = d;
    this.mesh.position.set(x, -y, z);
  }
}

// ---------------------------------------------------------------------------
// The Cachet card: machined dark metal, face printed from the real binding.
// ---------------------------------------------------------------------------
const CARD_W = 600;
const CARD_H = 378;

const shortMid = (s, a, b) => `${s.slice(0, a)}…${s.slice(-b)}`;

const isoDate = (sec) => {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}·${String(d.getUTCMonth() + 1).padStart(2, '0')}·${String(d.getUTCDate()).padStart(2, '0')}`;
};

function curvePts(K = 7.6, SHIFT = 0.3) {
  const VERTEX = -Math.cbrt(7);
  const up = [];
  const down = [];
  for (let i = 0; i <= 96; i++) {
    const u = i / 96;
    const x = VERTEX + (2.8 - VERTEX) * u * u;
    const y = Math.sqrt(Math.max(0, x ** 3 + 7)) * K;
    up.push([(x - SHIFT) * K, -y]);
    down.push([(x - SHIFT) * K, y]);
  }
  return { up, down };
}

const keyPoint = (hex, odd, K = 7.6, SHIFT = 0.3) => {
  const f = parseInt(hex.slice(0, 12), 16) / 2 ** 48;
  const x = -1.45 + f * (2.3 + 1.45);
  const y = Math.sqrt(x ** 3 + 7) * (odd ? -1 : 1);
  return [(x - SHIFT) * K, -y * K];
};

function drawFace(data, scale) {
  const W = CARD_W * scale;
  const H = CARD_H * scale;
  const ink = document.createElement('canvas');
  ink.width = W;
  ink.height = H;
  const mat = document.createElement('canvas');
  mat.width = W;
  mat.height = H;
  const g = ink.getContext('2d');
  const m = mat.getContext('2d');
  g.scale(scale, scale);
  m.scale(scale, scale);

  // Ground: dark anodised metal with brushed grain.
  const grd = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  grd.addColorStop(0, '#22221f');
  grd.addColorStop(1, '#151513');
  g.fillStyle = grd;
  g.fillRect(0, 0, CARD_W, CARD_H);
  const rnd = mulberry32(5);
  for (let i = 0; i < 1600; i++) {
    const y = rnd() * CARD_H;
    g.strokeStyle = `rgba(255,255,255,${0.006 + rnd() * 0.018})`;
    g.lineWidth = 0.18 + rnd() * 0.25;
    g.beginPath();
    const x = rnd() * CARD_W;
    g.moveTo(x, y);
    g.lineTo(x + 40 + rnd() * 260, y);
    g.stroke();
  }
  // Material: R unused, G roughness, B metalness.
  m.fillStyle = 'rgb(0,105,215)';
  m.fillRect(0, 0, CARD_W, CARD_H);
  const paint = 'rgb(0,150,10)';

  const both = (fn) => {
    fn(g, false);
    fn(m, true);
  };
  const CX = 456;
  const CY = 189;
  const R = 124;
  const D = 57.2;
  const fg = '#ecebe5';
  const dim = '#8d8b84';

  // Rules.
  both((c, isM) => {
    c.strokeStyle = isM ? paint : 'rgba(236,235,229,0.12)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, 53);
    c.lineTo(CARD_W, 53);
    c.moveTo(0, 325);
    c.lineTo(CARD_W, 325);
    c.stroke();
  });

  // Lens, maths and rings, clipped to the chamber.
  const hh = Math.sqrt(R * R - D * D);
  const a = Math.atan2(hh, D);
  const lens = new Path2D();
  lens.arc(CX - D, CY, R, -a, a);
  lens.arc(CX + D, CY, R, Math.PI - a, Math.PI + a);
  lens.closePath();
  both((c, isM) => {
    c.save();
    c.beginPath();
    c.rect(0, 53, CARD_W, 272);
    c.clip();
    if (isM) {
      c.fillStyle = 'rgb(0,62,255)';
      c.fill(lens);
    } else {
      const lg = c.createLinearGradient(CX - 60, CY - hh, CX + 60, CY + hh);
      lg.addColorStop(0, '#22b585');
      lg.addColorStop(0.52, '#149668');
      lg.addColorStop(1, '#0b6e4b');
      c.fillStyle = lg;
      c.fill(lens);
      // Counter-changed maths inside the lens.
      c.save();
      c.clip(lens);
      c.strokeStyle = 'rgba(255,255,255,0.22)';
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(CX - D, CY);
      c.lineTo(CX, CY - hh);
      c.lineTo(CX + D, CY);
      c.lineTo(CX, CY + hh);
      c.closePath();
      c.moveTo(276, CY);
      c.lineTo(600, CY);
      c.moveTo(CX, 53);
      c.lineTo(CX, 325);
      c.stroke();
      const { up, down } = curvePts();
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = 1.5;
      for (const br of [up, down]) {
        c.beginPath();
        br.forEach(([x, y], i) => (i ? c.lineTo(CX + x * 2.2, CY + y * 2.2) : c.moveTo(CX + x * 2.2, CY + y * 2.2)));
        c.stroke();
      }
      const P = keyPoint(data.pubkey, false);
      const Q = keyPoint(data.bchPublicKey.slice(2), data.bchPublicKey.startsWith('03'));
      const px = CX + P[0] * 2.2;
      const py = CY + P[1] * 2.2;
      const qx = CX + Q[0] * 2.2;
      const qy = CY + Q[1] * 2.2;
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(qx, qy);
      c.stroke();
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(px, py, 3, 0, Math.PI * 2);
      c.fill();
      c.save();
      c.translate(qx, qy);
      c.rotate(Math.PI / 4);
      c.fillRect(-2.4, -2.4, 4.8, 4.8);
      c.restore();
      c.font = `600 9px ${FONT.mono}`;
      c.fillText('P', px - 12, py - 4);
      c.fillText('Q', qx + 7, qy + 10);
      c.restore();
    }
    c.strokeStyle = isM ? 'rgb(0,80,240)' : '#d9d7cf';
    c.lineWidth = 13;
    c.beginPath();
    c.arc(CX - D, CY, R, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(CX + D, CY, R, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  });

  const text = (s, x, y, o) => {
    both((c, isM) => {
      c.font = `${o.weight ?? 400} ${o.size}px ${FONT[o.font ?? 'mono']}`;
      c.letterSpacing = `${(o.track ?? 0) * o.size}px`;
      c.textAlign = o.align ?? 'left';
      c.fillStyle = isM ? paint : o.color ?? fg;
      c.fillText(s, x, y);
      c.letterSpacing = '0px';
    });
  };
  text('CACHET', 24, 34, { font: 'sans', weight: 650, size: 15, track: 0.26 });
  text('/ NIP-39', 104, 34, { size: 10.5, color: dim, track: 0.08 });
  const serial = data.bindingId.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
  text(serial, 576, 34, { size: 13, align: 'right', track: 0.06 });
  text('ID', 576 - 166, 34, { size: 10, color: dim, align: 'right', track: 0.1 });

  text('01  NOSTR · BIP-340', 24, 118, { size: 10, color: dim, track: 0.1 });
  text(shortMid(data.npub, 9, 6), 24, 143, { size: 17.5, weight: 500 });
  text('02  BITCOIN CASH · ECDSA', 24, 186, { size: 10, color: dim, track: 0.1 });
  text(shortMid(data.cashaddr.split(':')[1], 7, 6), 24, 211, { size: 17.5, weight: 500 });
  text('secp256k1 · y² = x³ + 7', 24, 252, { size: 9, color: '#6c6a64', track: 0.06 });
  // Signature ticks.
  for (const [x, y, col] of [
    [174, 114, '#a78bfa'],
    [222, 182, '#34d399'],
  ]) {
    g.strokeStyle = col;
    g.lineWidth = 1.8;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - 4, y - 2);
    g.lineTo(x - 1, y + 1);
    g.lineTo(x + 5, y - 6);
    g.stroke();
  }

  // Verified pill.
  both((c, isM) => {
    c.fillStyle = isM ? paint : '#13271e';
    c.beginPath();
    c.roundRect(24, 337, 100, 24, 5);
    c.fill();
  });
  g.fillStyle = '#3cc38b';
  g.beginPath();
  g.arc(37, 349, 3.2, 0, Math.PI * 2);
  g.fill();
  text('VERIFIED', 47, 353, { size: 11, color: '#62d5a3', track: 0.16, weight: 500 });
  text(isoDate(data.expiresAt), 576, 354, { size: 13, align: 'right', track: 0.04 });
  text('VALID THRU', 576 - 112, 354, { size: 9, color: dim, align: 'right', track: 0.14 });

  return { ink, mat };
}

export class Card {
  constructor(data, renderer) {
    const scale = 4;
    const W = 760;
    const H = W * (CARD_H / CARD_W);
    const T = 5;
    this.size = { w: W, h: H, t: T };
    this.group = new THREE.Group();
    const bevel = 0.9;
    const body = new THREE.ExtrudeGeometry(rounded(W - bevel * 2, H - bevel * 2, 30), {
      depth: T - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 24,
    });
    body.translate(0, 0, -T / 2 + bevel);
    const edgeMat = new THREE.MeshPhysicalMaterial({
      color: '#5d5c58',
      metalness: 1,
      roughness: 0.28,
      envMapIntensity: 1.2,
      normalMap: grainNormal(3, 30),
      normalScale: new THREE.Vector2(0.25, 0.25),
    });
    const bodyMesh = new THREE.Mesh(body, edgeMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = false;
    this.group.add(bodyMesh);

    const { ink, mat } = drawFace(data, scale);
    const map = new THREE.CanvasTexture(ink);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mmap = new THREE.CanvasTexture(mat);
    mmap.colorSpace = THREE.NoColorSpace;
    const faceMat = new THREE.MeshPhysicalMaterial({
      map,
      metalnessMap: mmap,
      roughnessMap: mmap,
      metalness: 1,
      roughness: 1,
      clearcoat: 0.55,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.05,
      alphaMap: alphaMask(W, H, 29),
      transparent: true,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.2, H - 1.2), faceMat);
    face.position.z = T / 2 + 0.05;
    face.receiveShadow = false;
    this.group.add(face);
    this.faceMat = faceMat;
  }
}

// ---------------------------------------------------------------------------
// Real screens, printed and laid on the desk. A vesica-shaped iris swaps states.
// ---------------------------------------------------------------------------
export class Print {
  constructor(images, width, renderer, { radius = 14 } = {}) {
    const first = images[0];
    const aspect = first.width / first.height;
    this.w = width;
    this.h = width / aspect;
    this.textures = images.map((img) => {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      t.needsUpdate = true;
      return t;
    });
    this.uniforms = {
      map2: { value: this.textures[1] ?? this.textures[0] },
      wipe: { value: 0 },
      wipeAt: { value: new THREE.Vector2(0.5, 0.5) },
      aspect: { value: aspect },
      dim: { value: 0 },
      glow: { value: 0.08 },
    };
    const mat = new THREE.MeshStandardMaterial({
      map: this.textures[0],
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: 0.06,
      alphaMap: alphaMask(this.w, this.h, radius),
      transparent: true,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D map2; uniform float wipe, aspect, dim, glow; uniform vec2 wipeAt;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 p = (vMapUv - wipeAt) * vec2(aspect, 1.0);
            float R = wipe;
            float d = R * 0.4615;
            float inside = min(R - length(p - vec2(d, 0.0)), R - length(p + vec2(d, 0.0)));
            float m = smoothstep(-0.004, 0.004, inside);
            vec4 b = texture2D(map2, vMapUv);
            vec3 ui = mix(diffuseColor.rgb, b.rgb, m);
            // Calibrate sRGB UI tones to archival stock under the 1.42x studio exposure so
            // subtle card surfaces, borders, and brand inks keep full separation without blowout.
            vec3 ink = pow(max(ui, vec3(0.0)), vec3(1.28)) * 0.86;
            ink *= 1.0 - dim;
            totalEmissiveRadiance += ink * glow;
            diffuseColor.rgb = ink * (1.0 - glow);
          }`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          reflectedLight.directSpecular *= 0.18;
          reflectedLight.indirectSpecular *= 0.18;`,
        );
    };
    this.material = mat;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: mat.alphaMap, alphaTest: 0.5 });
  }

  /** Sets the base (a) and incoming (b) texture indices and wipe radius (0..~2). */
  state(a, b, wipe, at) {
    this.material.map = this.textures[a];
    this.uniforms.map2.value = this.textures[b];
    this.uniforms.wipe.value = wipe;
    if (at) this.uniforms.wipeAt.value.set(at[0], at[1]);
  }
}
