// A tiny mesh builder. Each vertex carries position, normal and four animation
// attributes: [s, v, part, w].
//   s    : position along the creature's spine (0 = nose, 1 = tail root, >1 = tail extensions)
//   v    : second surface coordinate (around the body, across a fin, along a horn)
//   part : 0 body, 1 membrane, 2 horn, 3 tentacle, 4 eye, 5 glowing bulb
//   w    : animation weight (signed flap weight for wings, length fraction for tentacles)
export const PART = { BODY: 0, MEMBRANE: 1, HORN: 2, TENTACLE: 3, EYE: 4, BULB: 5 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const V3 = { sub, add, scl, dot, cross, norm, lerp: (a, b, t) => add(a, scl(sub(b, a), t)) };

export class Mesh {
  constructor() { this.p = []; this.a = []; this.idx = []; }
  v(p, attr) { this.p.push(p[0], p[1], p[2]); this.a.push(attr[0], attr[1], attr[2], attr[3]); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  // Connect a grid of vertex ids (rows x cols). wrap joins the last column to the first.
  grid(ids, wrap = false) {
    for (let i = 0; i < ids.length - 1; i++) {
      const r0 = ids[i], r1 = ids[i + 1], n = r0.length;
      for (let j = 0; j < (wrap ? n : n - 1); j++) {
        const j2 = (j + 1) % n;
        this.quad(r0[j], r1[j], r1[j2], r0[j2]);
      }
    }
  }

  // Sweep a circle along a polyline. radius(k) and attr(k, around) take k in [0, 1].
  tube(points, radius, sides, attr, capEnd = true) {
    const n = points.length, rings = [];
    let prevN = null;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const t = norm(sub(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]));
      let nn;
      if (!prevN) { const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; nn = norm(cross(ref, t)); }
      else nn = norm(sub(prevN, scl(t, dot(prevN, t))));
      prevN = nn;
      const b = cross(t, nn), r = radius(k), ring = [];
      for (let j = 0; j < sides; j++) {
        const ang = (j / sides) * Math.PI * 2;
        const off = add(scl(nn, Math.cos(ang) * r), scl(b, Math.sin(ang) * r));
        ring.push(this.v(add(points[i], off), attr(k, j / sides)));
      }
      rings.push(ring);
    }
    this.grid(rings, true);
    if (capEnd) {
      const tip = this.v(points[n - 1], attr(1, 0));
      const last = rings[n - 1];
      for (let j = 0; j < sides; j++) this.tri(last[j], last[(j + 1) % sides], tip);
    }
  }

  sphere(center, r, attr, seg = 8) {
    const rows = [];
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI, row = [];
      for (let j = 0; j < seg * 2; j++) {
        const ph = (j / (seg * 2)) * Math.PI * 2;
        row.push(this.v([center[0] + r * Math.sin(th) * Math.cos(ph), center[1] + r * Math.cos(th), center[2] + r * Math.sin(th) * Math.sin(ph)], attr));
      }
      rows.push(row);
    }
    this.grid(rows, true);
  }

  // Flat membrane between a root curve and an outer curve, subdivided across.
  membrane(root, outer, rows, attr) {
    const ids = [];
    for (let k = 0; k <= rows; k++) {
      const t = k / rows, row = [];
      for (let i = 0; i < root.length; i++) row.push(this.v(V3.lerp(root[i], outer[i], t), attr(i / (root.length - 1), t)));
      ids.push(row);
    }
    this.grid(ids, false);
  }

  build() {
    const nv = this.p.length / 3, nrm = new Float32Array(nv * 3), P = this.p;
    for (let i = 0; i < this.idx.length; i += 3) {
      const a = this.idx[i], b = this.idx[i + 1], c = this.idx[i + 2];
      const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
      const fn = cross(sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pa), sub([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], pa));
      for (const v of [a, b, c]) { nrm[v * 3] += fn[0]; nrm[v * 3 + 1] += fn[1]; nrm[v * 3 + 2] += fn[2]; }
    }
    const verts = new Float32Array(nv * 10);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[i * 3 + c]); hi[c] = Math.max(hi[c], P[i * 3 + c]); }
    const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    let radius = 0;
    for (let i = 0; i < nv; i++) {
      const raw = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
      const n = Math.hypot(...raw) > 1e-12 ? norm(raw) : [0, 1, 0];
      verts.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2], n[0], n[1], n[2], this.a[i * 4], this.a[i * 4 + 1], this.a[i * 4 + 2], this.a[i * 4 + 3]], i * 10);
      radius = Math.max(radius, Math.hypot(P[i * 3] - center[0], P[i * 3 + 1] - center[1], P[i * 3 + 2] - center[2]));
    }
    return { verts, indices: new Uint32Array(this.idx), radius, center, triangles: this.idx.length / 3 };
  }
}
