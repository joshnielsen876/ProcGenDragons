// ============================================================================
// ProcGenDragons: seeded creatures from ../../creature-lab, swimming in this world
// ============================================================================
// LAB (the creature lab's genome, body and WGSL library) is bundled ahead of this file by build.mjs.
// Each creature follows a looping path around an anchor near one of the viewpoints. Its uniforms reuse the
// lab's struct: model[0] = anchor xyz + path radius, model[1] = angular speed (sign = direction), phase,
// size in metres, vertical drift.

const W_CREA = S_B + LAB.creatureLib(1) + /*wgsl*/`
struct CI { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) at: vec4f };
struct CO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) at: vec4f, @location(3) ln: vec3f, @location(4) lt: f32 };
struct CF { P: vec3f, T: vec3f, S: vec3f, Up: vec3f };
fn crFrame(t: f32) -> CF {
  let A = u.model[0]; let B = u.model[1];
  let R = A.w; let ta = t * B.x + B.y;
  if (u.anim2.z > 2.5) {
    // jellies drift slowly and bob, always upright
    let P = A.xyz + vec3f(R * .25 * cos(ta * .3), B.w * sin(t * .35 + B.y), R * .25 * sin(ta * .3));
    return CF(P, vec3f(0., 0., 1.), vec3f(1., 0., 0.), vec3f(0., 1., 0.));
  }
  let P = A.xyz + vec3f(R * cos(ta), B.w * sin(.7 * ta + B.y), R * .7 * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), .7 * B.w * cos(.7 * ta + B.y), R * .7 * cos(ta))) * sign(B.x);
  let S = normalize(cross(vec3f(0., 1., 0.), T)); let Up = cross(T, S);
  // bank into the turn
  let bank = -.3 * sign(B.x);
  return CF(P, T, S * cos(bank) + Up * sin(bank), Up * cos(bank) - S * sin(bank));
}
@vertex fn vsCrea(i: CI) -> CO {
  let t = g.cam.w; let sz = u.model[1].z;
  let d = crDeform(i.pos, i.nrm, i.at, t);
  let f = crFrame(t);
  let w = f.P + (f.S * d.p.x + f.Up * d.p.y + f.T * d.p.z) * sz;
  var o: CO;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w;
  o.n = f.S * d.n.x + f.Up * d.n.y + f.T * d.n.z;
  o.at = i.at; o.ln = d.n;
  o.lt = shadow1(w);
  return o;
}
@fragment fn fsCrea(i: CO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let t = g.cam.w;
  var n = normalize(i.n + vec3f(0., 1e-5, 0.)); var ln = normalize(i.ln + vec3f(0., 1e-5, 0.));
  if (!ff) { n = -n; ln = -ln; }
  let m = crSurface(i.at, ln, t);
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let E = sunE(i.wp.y, z) * i.lt;
  let ndv = sat(dot(n, V)); let fres = pow(1. - ndv, 3.);
  var c = m.col * (E * (.25 + .75 * sat(dot(n, L))) + amb(i.wp, n, vv.g, z) * 1.3);
  c += m.col * E * sat(dot(-n, L)) * m.trans;
  c += E * pow(sat(dot(n, normalize(V + L))), 30.) * m.spec;
  let ir = .5 + .5 * cos(CR_TAU * (vec3f(0., .33, .67) + fres * 1.4 + i.at.x * 2.));
  c += ir * u.pat.w * fres * (amb(i.wp, vec3f(0., 1., 0.), vv.g, z) * .8 + .02);
  c += vec3f(.3, .6, .7) * fres * .25 * vv.g;
  c += m.emit * CREA_GLOW;
  return fin(fog(c, i.wp, z));
}
`;
const CREA_GLOW = 1.2; // replaced in the shader text below; emission scale relative to the scene's light

// One creature per entry: seed, body-plan override (or null to let the seed choose), size in metres.
// Placed around the six viewpoints so every one has company.
const CREA_PLAN = [
  ['tidewyrm', 'serpent', 7], ['emberfin', 'drake', 2.6], ['glassveil', 'medusa', 2.2],
  ['duskkite', 'ray', 4.2], ['lanternmaw', 'drake', 2.2], ['deepcoil', 'serpent', 11],
  ['moonbell', 'medusa', 1.6], ['reefhorn', 'drake', 3.0], ['silkray', 'ray', 3.4],
  ['gloamcoil', 'serpent', 6], ['starbell', 'medusa', 2.6], ['ashwing', 'drake', 2.4],
  ['veilglider', 'ray', 5.0], ['brinewyrm', 'serpent', 8], ['halobell', 'medusa', 1.9],
  ['frostfang', 'drake', 2.8], ['tidekite', 'ray', 3.8], ['ninefold', 'serpent', 9],
];

function setupCreatures(poses) {
  const code = W_CREA.replace('CREA_GLOW', CREA_GLOW.toFixed(3));
  const m = mod(code);
  const bgl1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: {} }] });
  const pipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] }),
    vertex: { module: m, entryPoint: 'vsCrea', buffers: [{ arrayStride: 40, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'float32x3'), A(2, 24, 'float32x4')] }] },
    fragment: { module: m, entryPoint: 'fsCrea', targets: [{ format: HDR }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA },
  });
  const lin = (c) => c.map((x) => x ** 2.2);
  const list = [];
  CREA_PLAN.forEach(([seed, plan, size], k) => {
    const g = LAB.makeGenome(seed, plan ? { plan } : {});
    const mesh = LAB.buildCreature(g);
    const r = LAB.makeRng('place:' + seed);
    // anchor: partway from a viewpoint toward what it looks at, lifted clear of the floor
    const p = poses[k % poses.length], f = r.range(0.25, 0.55);
    const ax = p[0] + (p[3] - p[0]) * f + r.range(-6, 6), az = p[2] + (p[5] - p[2]) * f + r.range(-6, 6);
    const ay = max(p[1] + r.range(1.5, 5), p[1] + (p[4] - p[1]) * f + r.range(-2, 3)) + (plan === 'medusa' ? 3 : 0);
    const R = plan === 'medusa' ? 3 : r.range(5, 11) + size * 0.4;
    const speed = (r.chance(0.5) ? 1 : -1) * r.range(0.6, 1.2) * (plan === 'serpent' ? 1.6 : 2.2) / R;
    const U = new Float32Array(LAB.UNIFORM_FLOATS);
    U.set([ax, ay, az, R, speed, r.range(0, 6.28), size, plan === 'medusa' ? 1.2 : r.range(0.5, 2)], 16);
    const c = g.colors;
    U.set([...lin(c.back), 1, ...lin(c.belly), 1, ...lin(c.accent), 1, ...lin(c.glow), 1], 36);
    U.set([LAB.PATTERNS.indexOf(g.pattern), g.patternFreq, g.patternContrast, g.iridescence], 52);
    U.set([g.undulation, g.waves, g.swimSpeed, g.flap], 56);
    U.set([g.flapSpeed, g.plan === 'medusa' ? 0.05 : 0.025, LAB.PLANS.indexOf(g.plan), 0], 60);
    U.set([g.glow, g.glowPulse, g.length, 0], 64);
    const ub = buf(U, BU.UNIFORM);
    list.push({
      g, U, n: mesh.indices.length, vb: buf(mesh.verts, BU.VERTEX), ib: buf(mesh.indices, BU.INDEX),
      bg: device.createBindGroup({ layout: bgl1, entries: [{ binding: 0, resource: { buffer: ub } }] }),
    });
  });
  // world position of creature c at time t (mirrors crFrame), for the field journal readout
  const where = (c, t) => {
    const U = c.U, R = U[19], ta = t * U[20] + U[21];
    if (c.g.plan === 'medusa') return [U[16] + R * 0.25 * cos(ta * 0.3), U[17] + U[23] * sin(t * 0.35 + U[21]), U[18] + R * 0.25 * sin(ta * 0.3)];
    return [U[16] + R * cos(ta), U[17] + U[23] * sin(0.7 * ta + U[21]), U[18] + R * 0.7 * sin(ta)];
  };
  return {
    list,
    draw(r) {
      r.setPipeline(pipe);
      for (const c of list) { r.setBindGroup(1, c.bg); r.setVertexBuffer(0, c.vb); r.setIndexBuffer(c.ib, 'uint32'); r.drawIndexed(c.n); }
    },
    // the creature nearest the centre of view within 30 m, or null
    spotted(cx, cy, cz, fx, fy, fz, t) {
      let best = null, bs = 0;
      for (const c of list) {
        const p = where(c, t), dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz, d = hypot(dx, dy, dz);
        if (d > 30) continue;
        const a = (dx * fx + dy * fy + dz * fz) / d; // cosine to the view axis
        const score = a - d / 120;
        if (a > 0.85 && score > bs) { bs = score; best = { c, d }; }
      }
      return best;
    },
  };
}
