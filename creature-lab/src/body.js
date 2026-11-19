// Turns a genome into geometry. The creature faces +z with its nose at z = +L/2.
import { Mesh, PART, V3 } from './mesh.js';
import { makeRng } from './rng.js';

const { PI, sin, cos, exp, pow, sqrt, max, min, abs } = Math;
const smooth = (a, b, x) => { const t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildCreature(g) {
  const m = new Mesh();
  const r = makeRng('body:' + g.seed);
  if (g.plan === 'medusa') {
    buildMedusa(m, g, r);
    // Built along +z for convenience; stand it upright so the bell is on top.
    for (let i = 0; i < m.p.length; i += 3) { const y = m.p[i + 1]; m.p[i + 1] = m.p[i + 2]; m.p[i + 2] = -y; }
  } else buildVertebrate(m, g, r);
  return m.build();
}

function profile(g, s) {
  const head = g.girth * g.headSize * exp(-pow((s - 0.05) / 0.045, 2));
  const nose = smooth(0, 0.06, s) * 0.75 + 0.25;
  let body;
  if (g.plan === 'serpent') body = 1 - 0.8 * pow(s, 1.6);
  else if (g.plan === 'ray') body = pow(max(0, sin(PI * min(1, s * 1.05))), 0.6) * (1 - 0.6 * s);
  else body = pow(max(0, sin(PI * min(1, s * 0.92 + 0.04))), 0.55) * (1 - 0.55 * s);
  return g.girth * nose * body + head + 0.002;
}

function buildVertebrate(m, g, r) {
  const L = g.length;
  const wx = sqrt(g.flatten), wy = 1 / sqrt(g.flatten);
  const center = (s) => [0, g.arch * sin(PI * s), L * (0.5 - s)];
  const surf = (s, a, grow = 1) => {
    const c = center(s), rr = profile(g, s) * grow;
    return [c[0] + rr * wx * cos(a), c[1] + rr * wy * sin(a), c[2]];
  };

  // Torso
  const N = g.plan === 'serpent' ? 96 : 60, M = 18, rings = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, ring = [];
    for (let j = 0; j < M; j++) {
      const a = (j / M) * PI * 2;
      ring.push(m.v(surf(s, a), [s, j / M, PART.BODY, 0]));
    }
    rings.push(ring);
  }
  m.grid(rings, true);
  const nc = center(0);
  const noseTip = m.v([nc[0], nc[1], nc[2] + profile(g, 0) * 0.8], [0, 0, PART.BODY, 0]);
  for (let j = 0; j < M; j++) m.tri(rings[0][(j + 1) % M], rings[0][j], noseTip);

  // Dorsal sail
  if (g.dorsal > 0) {
    const s0 = g.plan === 'serpent' ? 0.08 : 0.14, s1 = g.plan === 'serpent' ? 0.92 : 0.62, K = 28;
    const root = [], outer = [];
    for (let i = 0; i <= K; i++) {
      const u = i / K, s = s0 + (s1 - s0) * u;
      let h = g.dorsal * L * pow(sin(PI * u), 0.6);
      if (g.dorsalJag) h *= 0.55 + 0.45 * abs(sin(g.dorsalJag * PI * u));
      const b = surf(s, PI / 2, 0.92);
      root.push(b); outer.push([b[0], b[1] + h, b[2] - h * 0.35]);
    }
    m.membrane(root, outer, 3, (u, k) => [s0 + (s1 - s0) * u, k, PART.MEMBRANE, 0]);
  }

  // Paired fins or wings
  for (let p = 0; p < g.finPairs; p++) {
    const isWing = g.plan === 'ray' || (g.plan === 'drake' && p === 0);
    const sc = g.plan === 'ray' ? 0.38 : 0.2 + p * (0.5 / max(1, g.finPairs));
    const chord = g.plan === 'ray' ? 0.62 : isWing ? 0.22 * g.finSize : 0.1 * g.finSize;
    const span = (g.plan === 'ray' ? 0.62 : isWing ? 0.55 : 0.16) * g.finSize * L * (p === 0 ? 1 : 0.7);
    const sweep = g.plan === 'ray' ? 0.15 : isWing ? 0.25 : 0.4;
    for (const side of [-1, 1]) {
      const K = 20, root = [], outer = [];
      const sa = sc - chord / 2, sb = sc + chord / 2;
      for (let i = 0; i <= K; i++) {
        const u = i / K, s = sa + (sb - sa) * u;
        const b = surf(s, side > 0 ? 0 : PI, 0.85);
        let reach = g.plan === 'ray' ? pow(sin(PI * u), 0.75) : pow(sin(PI * pow(u, 0.55)), 0.9);
        if (g.plan === 'drake' && isWing) reach *= 0.72 + 0.28 * abs(cos(3 * PI * u));
        const d = span * reach;
        outer.push([b[0] + side * d, b[1] - 0.12 * d, b[2] - sweep * d - 0.08 * L * u * reach]);
        root.push(b);
      }
      m.membrane(root, outer, 7, (u, k) => [sa + (sb - sa) * u, k, PART.MEMBRANE, side * k * (isWing ? 1 : 0.35)]);
      if (g.plan === 'drake' && isWing) {
        // Finger bones along the leading edge and through the membrane
        for (const fu of [0.02, 0.33, 0.66]) {
          const idx = Math.round(fu * K), a = root[idx], b = outer[idx], pts = [];
          for (let q = 0; q <= 8; q++) pts.push(V3.lerp(a, b, q / 8));
          m.tube(pts, (k) => g.girth * 0.12 * (1 - 0.7 * k), 5, (k) => [sa + (sb - sa) * fu, k, PART.HORN, side * k]);
        }
      }
    }
  }

  // Tail
  const tailRoot = center(1);
  const tr = profile(g, 0.97);
  if (g.tail === 'whip' || g.tail === 'twin') {
    const n = g.tail === 'twin' ? 2 : 1;
    for (let t = 0; t < n; t++) {
      const spread = n === 2 ? (t ? 1 : -1) * 0.12 : 0, pts = [];
      for (let q = 0; q <= 16; q++) {
        const k = q / 16;
        pts.push([spread * k * L, tailRoot[1] + 0.02 * L * k, tailRoot[2] - k * L * 0.55]);
      }
      m.tube(pts, (k) => max(tr, 0.004) * (1 - 0.92 * k), 6, (k) => [1 + k * 0.55, k, PART.BODY, 0]);
    }
  } else {
    const lobes = g.tail === 'fork' ? [[0.7, 0.75], [-0.7, 0.75]] : [[0, 1]];
    for (const [dir, len] of lobes) {
      const root = [], outer = [], K = 10, size = L * 0.16 * g.finSize * len;
      for (let i = 0; i <= K; i++) {
        const u = i / K;
        const ang = g.tail === 'fan' ? (u - 0.5) * 1.6 : dir * (0.3 + 0.5 * u);
        const reach = g.tail === 'fan' ? size * (0.8 + 0.2 * cos(u * PI * 6)) : size * (1 - 0.6 * u);
        root.push([0, tailRoot[1] + (u - 0.5) * tr * 1.2, tailRoot[2] + 0.01]);
        outer.push([0, tailRoot[1] + sin(ang) * reach, tailRoot[2] - cos(ang) * reach]);
      }
      m.membrane(root, outer, 4, (u, k) => [1 + k * 0.2, k, PART.MEMBRANE, 0]);
    }
  }

  // Horns
  const hornSet = g.horns === 3 ? [-1, 0, 1] : g.horns === 2 ? [-1, 1, -0.5, 0.5].slice(0, 4) : g.horns === 1 ? [-1, 1] : [];
  for (const hs of hornSet) {
    const big = abs(hs) === 1 ? 1 : 0.65, base = surf(0.06, PI / 2 + hs * 0.55, 0.9), pts = [];
    let dir = V3.norm([hs * 0.35, 0.7, -0.6]);
    let pnt = base;
    const segLen = (g.hornLen * L * big) / 10;
    for (let q = 0; q <= 10; q++) {
      pts.push(pnt);
      const c = g.hornCurl * 0.22, cy = cos(c), sy = sin(c);
      dir = V3.norm([dir[0], dir[1] * cy - dir[2] * sy, dir[1] * sy + dir[2] * cy]);
      pnt = V3.add(pnt, V3.scl(dir, segLen));
    }
    m.tube(pts, (k) => g.girth * 0.3 * big * (1 - 0.95 * k), 6, (k) => [0.06, k, PART.HORN, 0]);
  }

  // Whiskers
  for (let w = 0; w < g.whiskers; w++) for (const side of [-1, 1]) {
    const base = surf(0.025 + w * 0.02, side > 0 ? -0.3 : PI + 0.3, 0.9), pts = [];
    const len = L * r.range(0.25, 0.45);
    for (let q = 0; q <= 14; q++) {
      const k = q / 14;
      pts.push([base[0] + side * k * len * 0.35, base[1] - k * k * len * 0.25, base[2] - k * len * 0.6]);
    }
    m.tube(pts, (k) => g.girth * 0.06 * (1 - 0.8 * k), 4, (k) => [0.03, k, PART.TENTACLE, k]);
  }

  // Lantern lure
  if (g.lure) {
    const base = surf(0.035, PI / 2, 0.95), pts = [];
    for (let q = 0; q <= 12; q++) {
      const k = q / 12;
      pts.push([base[0], base[1] + sin(k * PI * 0.8) * L * 0.12, base[2] + k * L * 0.14]);
    }
    m.tube(pts, (k) => g.girth * 0.07, 4, (k) => [0.03, k, PART.TENTACLE, k * 0.6], false);
    m.sphere(pts[pts.length - 1], g.girth * 0.4, [0.03, 1, PART.BULB, 0.6]);
  }

  // Eyes
  const er = g.girth * (0.2 + 0.12 * g.headSize);
  for (let e = 0; e < g.eyes; e++) for (const side of [-1, 1]) {
    const s = 0.045 + e * 0.028;
    const p = surf(s, side > 0 ? 0.45 : PI - 0.45, 0.9);
    m.sphere(p, er * (1 - e * 0.2), [s, 0, PART.EYE, 0], 6);
  }
}

function buildMedusa(m, g, r) {
  const L = g.length, R = 0.26 * L * g.finSize, zA = 0.32 * L, depth = 0.26 * L;
  const N = 24, M = 36, rings = [];
  const bell = (v, a) => {
    const rho = R * pow(sin(min(v, 1) * PI / 2), 0.75) * (1 + 0.06 * pow(v, 4) * cos(a * 8));
    return [rho * cos(a), rho * sin(a), zA - depth * pow(v, 1.5)];
  };
  for (let i = 0; i <= N; i++) {
    const v = i / N, ring = [];
    for (let j = 0; j < M; j++) ring.push(m.v(bell(v, (j / M) * PI * 2), [v * 0.3, j / M, PART.BODY, v]));
    rings.push(ring);
  }
  m.grid(rings, true);
  // Inner lining, slightly smaller, so the bell has thickness when seen from below
  const inner = [];
  for (let i = N; i >= 6; i--) {
    const v = i / N, ring = [];
    for (let j = 0; j < M; j++) {
      const p = bell(v, (j / M) * PI * 2);
      ring.push(m.v([p[0] * 0.9, p[1] * 0.9, p[2] + 0.03 * L], [v * 0.3, j / M, PART.MEMBRANE, v]));
    }
    inner.push(ring);
  }
  m.grid(inner, true);

  // Marginal tentacles
  for (let t = 0; t < g.tentacles; t++) {
    const a = (t / g.tentacles) * PI * 2, base = bell(1, a), len = L * r.range(0.6, 1.1), pts = [];
    for (let q = 0; q <= 20; q++) {
      const k = q / 20;
      pts.push([base[0] * (1 - 0.3 * k), base[1] * (1 - 0.3 * k), base[2] - k * len]);
    }
    m.tube(pts, (k) => L * 0.006 * (1 - 0.7 * k), 4, (k) => [0.3 + k * 0.7, k, PART.TENTACLE, k], true);
  }
  // Oral arms: thicker, frilled ribbons from the center
  const arms = r.int(3, 5);
  for (let t = 0; t < arms; t++) {
    const a = (t / arms) * PI * 2 + 0.3, len = L * r.range(0.45, 0.7), pts = [];
    for (let q = 0; q <= 18; q++) {
      const k = q / 18;
      pts.push([cos(a) * R * 0.12 * (1 + k), sin(a) * R * 0.12 * (1 + k), zA - depth * 0.6 - k * len]);
    }
    m.tube(pts, (k) => L * 0.022 * (1 - 0.6 * k) * (0.7 + 0.3 * sin(k * 40)), 6, (k) => [0.35 + k * 0.6, k, PART.MEMBRANE, k * 0.7], true);
  }
  // Glowing rim beads
  for (let t = 0; t < 12; t++) {
    const a = (t / 12) * PI * 2;
    m.sphere(bell(0.97, a), L * 0.012, [0.3, 1, PART.BULB, 1], 4);
  }
}
