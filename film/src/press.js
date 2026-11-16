// The press: vector ink and blind relief drawn in page units, re-rasterised every frame for
// exactly the part of the sheet the camera sees, so type stays sharp from macro to overview.
import { clamp } from './util.js';

export const FONT = {
  serif: '"Film Serif"',
  italic: '"Film Serif Italic"',
  sans: '"Film Sans"',
  mono: '"Film Mono"',
};

class Layer {
  constructor(w, h, relief) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.relief = relief;
    this.w = w;
    this.h = h;
    if (relief) {
      this.tmp = document.createElement('canvas');
      this.tmp.width = w;
      this.tmp.height = h;
    }
  }

  begin(rect, fill) {
    const { ctx, w, h } = this;
    this.view = rect;
    this.sx = w / (rect.x1 - rect.x0);
    this.sy = h / (rect.y1 - rect.y0);
    this.unit = Math.min(this.sx, this.sy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    this.reset();
  }

  reset() {
    const { ctx } = this;
    ctx.setTransform(this.sx, 0, 0, this.sy, -this.view.x0 * this.sx, -this.view.y0 * this.sy);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = this.relief ? 'source-over' : 'multiply';
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.letterSpacing = '0px';
  }

  /** Soften the relief so the bump has slopes, not steps. */
  finish(blurUnits = 1.6) {
    if (!this.relief) return;
    const px = clamp(blurUnits * this.unit, 0.6, 6);
    const t = this.tmp.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.filter = 'none';
    t.drawImage(this.canvas, 0, 0);
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = `blur(${px.toFixed(2)}px)`;
    ctx.drawImage(this.tmp, 0, 0);
    ctx.filter = 'none';
  }

  visible(x0, y0, x1, y1) {
    const r = this.view;
    return x1 >= r.x0 && x0 <= r.x1 && y1 >= r.y0 && y0 <= r.y1;
  }

  /** Relief colour: depth 1 = pressed in, -1 = raised. */
  depth(d) {
    const v = Math.round(clamp(128 - d * 120, 0, 255));
    return `rgb(${v},${v},${v})`;
  }

  font(o) {
    const fam = FONT[o.font ?? 'sans'];
    return `${o.weight ?? 400} ${o.size}px ${fam}`;
  }

  measure(s, o) {
    const { ctx } = this;
    ctx.font = this.font(o);
    ctx.letterSpacing = `${(o.track ?? 0) * o.size}px`;
    const m = ctx.measureText(s);
    return m.width - (o.track ?? 0) * o.size;
  }

  /**
   * Text with an optional left-to-right ink wipe (reveal 0..1). Kerning is kept because the
   * string is drawn whole and the wipe is a gradient, not per-glyph alpha.
   */
  text(s, x, y, o) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0.002 || !s) return;
    const reveal = o.reveal ?? 1;
    if (reveal <= 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = this.font(o);
    ctx.letterSpacing = `${(o.track ?? 0) * o.size}px`;
    ctx.textBaseline = o.baseline ?? 'alphabetic';
    const w = this.measure(s, o);
    const align = o.align ?? 'left';
    let x0 = x;
    if (align === 'center') x0 = x - w / 2;
    else if (align === 'right') x0 = x - w;
    ctx.textAlign = 'left';
    if (o.rotate || o.scale) {
      ctx.translate(x, y);
      if (o.rotate) ctx.rotate(o.rotate);
      if (o.scale) ctx.scale(o.scale, o.scale);
      ctx.translate(-x, -y);
    }
    const color = this.relief ? this.depth(o.depth ?? 0.5) : o.color ?? '#1b1a17';
    ctx.globalAlpha = alpha;
    if (reveal < 1) {
      const soft = o.soft ?? Math.max(o.size * 1.6, w * 0.18);
      const edge = x0 - soft + reveal * (w + soft * 2);
      const g = ctx.createLinearGradient(edge - soft, 0, edge + soft * 0.02, 0);
      g.addColorStop(0, color);
      g.addColorStop(1, this.relief ? this.depth(0) : 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      if (!this.relief) {
        // Multiply with transparent white is a no-op, so the wipe reads as ink arriving.
        ctx.globalCompositeOperation = 'multiply';
      }
    } else {
      ctx.fillStyle = color;
    }
    if (o.over) ctx.globalCompositeOperation = 'source-over';
    ctx.fillText(s, x0, y);
    ctx.restore();
    ctx.letterSpacing = '0px';
  }

  /** Monospace characters placed one by one (for typing, curling, and diffing). */
  glyph(ch, x, y, o) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0.002) return;
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    if (o.rotate) ctx.rotate(o.rotate);
    ctx.font = this.font(o);
    ctx.textAlign = 'center';
    ctx.textBaseline = o.baseline ?? 'middle';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.relief ? this.depth(o.depth ?? 0.5) : o.color ?? '#1b1a17';
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }

  line(x1, y1, x2, y2, o = {}) {
    const p = o.progress ?? 1;
    if (p <= 0 || (o.alpha ?? 1) <= 0.002) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.strokeStyle = this.relief ? this.depth(o.depth ?? 0.5) : o.color ?? '#1b1a17';
    ctx.lineWidth = o.width ?? 1;
    ctx.lineCap = o.cap ?? 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p);
    ctx.stroke();
    ctx.restore();
  }

  /** Arc from a0 sweeping `sweep` radians, drawn up to `progress`. */
  arc(cx, cy, r, a0, sweep, o = {}) {
    const p = o.progress ?? 1;
    if (p <= 0 || (o.alpha ?? 1) <= 0.002 || r <= 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.strokeStyle = this.relief ? this.depth(o.depth ?? 0.5) : o.color ?? '#1b1a17';
    ctx.lineWidth = o.width ?? 1;
    ctx.lineCap = o.cap ?? 'butt';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath();
    const s = sweep * p;
    if (Math.abs(s) >= Math.PI * 2 - 1e-3) {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.closePath();
    } else ctx.arc(cx, cy, r, a0, a0 + s, s < 0);
    ctx.stroke();
    ctx.restore();
  }

  circle(cx, cy, r, o = {}) {
    this.arc(cx, cy, r, o.start ?? -Math.PI / 2, Math.PI * 2, o);
  }

  dot(x, y, r, o = {}) {
    if ((o.alpha ?? 1) <= 0.002) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.fillStyle = this.relief ? this.depth(o.depth ?? 0.5) : o.color ?? '#1b1a17';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  poly(pts, o = {}) {
    const p = o.progress ?? 1;
    if (p <= 0 || pts.length < 2 || (o.alpha ?? 1) <= 0.002) return;
    const { ctx } = this;
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l);
      total += l;
    }
    let left = total * p;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.strokeStyle = this.relief ? this.depth(o.depth ?? 0.5) : o.color ?? '#1b1a17';
    ctx.lineWidth = o.width ?? 1;
    ctx.lineCap = o.cap ?? 'round';
    ctx.lineJoin = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const l = lens[i - 1];
      const k = Math.min(1, left / l);
      ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k);
      left -= l;
    }
    if (o.close && p >= 1) ctx.closePath();
    if (o.fill) {
      ctx.fillStyle = this.relief ? this.depth(o.depth ?? 0.5) : o.fill;
      ctx.fill();
    }
    if (o.stroke !== false) ctx.stroke();
    ctx.restore();
  }

  rect(x, y, w, h, o = {}) {
    if ((o.alpha ?? 1) <= 0.002) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, o.radius ?? 0);
    if (o.fill) {
      ctx.fillStyle = this.relief ? this.depth(o.depth ?? 0.5) : o.fill;
      ctx.fill();
    }
    if (o.stroke) {
      ctx.strokeStyle = this.relief ? this.depth(o.depth ?? 0.5) : o.stroke;
      ctx.lineWidth = o.width ?? 1;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.stroke();
    }
    ctx.restore();
  }

  image(img, x, y, w, h, o = {}) {
    if ((o.alpha ?? 1) <= 0.002) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.translate(x, y);
    if (o.rotate) ctx.rotate(o.rotate);
    if (o.scale) ctx.scale(o.scale, o.scale);
    if (this.relief && o.reliefImage) ctx.drawImage(o.reliefImage, -w / 2, -h / 2, w, h);
    else if (!this.relief) ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /** A hand-drawn loop, like a proofreader's pencil circling a mistake. */
  loop(cx, cy, rx, ry, o = {}) {
    const p = o.progress ?? 1;
    if (p <= 0) return;
    const seed = o.seed ?? 1;
    const pts = [];
    const turns = 1.12;
    const n = 90;
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * turns;
      const a = -Math.PI * 0.62 + u * Math.PI * 2;
      const wob = 1 + 0.035 * Math.sin(u * 9 + seed) + 0.025 * Math.sin(u * 23 + seed * 3) + u * 0.05;
      pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
    }
    this.poly(pts, { ...o, progress: p });
  }
}

export class Press {
  constructor(iw, ih, rw, rh) {
    this.ink = new Layer(iw, ih, false);
    this.relief = new Layer(rw, rh, true);
  }

  begin(rect, paper) {
    this.ink.begin(rect, paper);
    this.relief.begin(rect, 'rgb(128,128,128)');
  }

  finish() {
    this.relief.finish();
  }
}

/** Calls `fn` on both layers: ink with colours, relief with depth. */
export const both = (press, fn) => {
  fn(press.ink, false);
  fn(press.relief, true);
};
