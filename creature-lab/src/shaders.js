// WGSL for the creature lab: a backdrop pass and the creature pass.
// Animation is done in the vertex shader from the per-vertex [s, v, part, w] attributes,
// so a creature costs one draw call no matter how it moves.
export const UNIFORM_FLOATS = 68; // 2 mat4 + 9 vec4

const common = /* wgsl */ `
struct U {
  vp: mat4x4f,
  model: mat4x4f,
  cam: vec4f,      // xyz camera position
  back: vec4f,
  belly: vec4f,
  accent: vec4f,
  glow: vec4f,
  pat: vec4f,      // pattern type, frequency, contrast, iridescence
  anim: vec4f,     // undulation, waves along body, swim speed, flap amplitude
  anim2: vec4f,    // flap speed, tentacle sway, body plan, time
  misc: vec4f,     // glow amount, glow pulse, length, selected
};
@group(0) @binding(0) var<uniform> u: U;

fn hash2(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}
// Distance to the nearest cell point; the cells wrap every 'period' cells in y.
fn cells(p: vec2f, period: f32) -> f32 {
  let i = floor(p); let f = fract(p);
  var d = 9.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2f(f32(x), f32(y));
      var c = i + o; c.y = c.y - period * floor(c.y / period);
      let h = hash2(c);
      d = min(d, length(o + h * 0.8 + 0.1 - f));
    }
  }
  return d;
}
`;

export const creatureWGSL = common + /* wgsl */ `
struct VI { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) at: vec4f };
struct VO {
  @builtin(position) cp: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) at: vec4f,
  @location(3) ln: vec3f,
};

const TAU = 6.2831853;

@vertex fn vs(i: VI) -> VO {
  var p = i.pos;
  var n = i.nrm;
  let s = i.at.x; let part = i.at.z; let w = i.at.w;
  let t = u.anim2.w; let L = u.misc.z; let plan = u.anim2.z;

  if (plan > 2.5) {
    // Medusa: the bell contracts and the trailing parts sway.
    let ph = sin(t * u.anim.z * 2.2);
    if (s < 0.305 && part < 1.5) {
      let k = 1.0 - 0.13 * ph * pow(w, 1.5);
      p = vec3f(p.x * k, p.y + 0.035 * L * ph * w, p.z * k);
    }
  } else {
    // Swimming: a wave travels from nose to tail.
    let env = select(pow(max(s, 0.0), 1.6), 0.3 + 0.7 * s, plan < 0.5);
    let phase = TAU * u.anim.y * s - t * u.anim.z * 3.6;
    p.x += u.anim.x * L * env * sin(phase);
    let slope = u.anim.x * env * TAU * u.anim.y * cos(phase);
    n = normalize(n + vec3f(0.0, 0.0, n.x * slope * 0.5));
    // Wings and fins flap; the outer edge lags the root.
    if (abs(w) > 0.0 && part > 0.5 && part < 2.5) {
      let aw = abs(w);
      p.y += u.anim.w * L * pow(aw, 1.3) * sin(t * u.anim2.x * 3.0 - aw * 1.4);
    }
  }
  if (part > 2.5 && part < 3.5) {
    // Tentacles, whiskers and lure stalks drift.
    let ph = p.x * 13.0 + p.y * 7.0;
    let amp = u.anim2.y * L * pow(w, 1.5);
    let ph2 = select(ph, p.x * 13.0 + p.z * 7.0, plan > 2.5);
    p.x += amp * sin(t * 1.7 + w * 5.0 + ph2);
    let sway = amp * 0.7 * cos(t * 1.3 + w * 4.0 + ph2 * 1.3);
    if (plan > 2.5) { p.z += sway; } else { p.y += sway; }
  }
  p.y += 0.012 * L * sin(t * 0.9);

  var o: VO;
  let wp = u.model * vec4f(p, 1.0);
  o.cp = u.vp * wp;
  o.wp = wp.xyz;
  o.n = (u.model * vec4f(n, 0.0)).xyz;
  o.at = i.at;
  o.ln = n;
  return o;
}

fn patternValue(s: f32, v: f32, part: f32) -> f32 {
  let kind = u.pat.x; let f = u.pat.y;
  if (kind < 0.5) { // stripes
    let x = sin(s * 46.0 * f + sin(v * TAU) * 1.2);
    return smoothstep(0.1, 0.5, x);
  } else if (kind < 1.5) { // spots
    let per = round(7.0 * f);
    let d = cells(vec2f(s * 40.0 * f, v * per), per);
    return 1.0 - smoothstep(0.18, 0.3, d);
  } else if (kind < 2.5) { // rings
    let x = fract(s * 14.0 * f);
    return smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.22, 0.3, x));
  }
  // scales
  let per = round(22.0 * f);
  let d = cells(vec2f(s * 120.0 * f, v * per), per);
  return smoothstep(0.25, 0.55, d);
}

@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let s = i.at.x; let v = i.at.y; let part = i.at.z; let w = i.at.w;
  let t = u.anim2.w;
  var N = normalize(i.n + vec3f(0.0, 1e-5, 0.0));
  var ln = normalize(i.ln + vec3f(0.0, 1e-5, 0.0));
  if (!ff) { N = -N; ln = -ln; }
  let V = normalize(u.cam.xyz - i.wp);
  let Ld = normalize(vec3f(0.25, 1.0, 0.35));

  let belly = u.belly.rgb; let back = u.back.rgb; let accent = u.accent.rgb; let glowC = u.glow.rgb;
  var col = mix(belly, back, smoothstep(-0.35, 0.45, ln.y));
  var emit = vec3f(0.0);

  if (part < 0.5) {
    col = mix(col, accent, patternValue(s, v, part) * u.pat.z);
    // Glowing markings along the flanks, pulsing from head to tail.
    let flank = 1.0 - smoothstep(0.15, 0.55, abs(ln.y));
    let per = 6.0;
    let spot = 1.0 - smoothstep(0.12, 0.22, cells(vec2f(s * 34.0, v * per), per));
    let pulse = 0.55 + 0.45 * sin(t * u.misc.y * 3.0 - s * 14.0);
    emit += glowC * u.misc.x * flank * spot * pulse * 1.6;
    if (u.anim2.z > 2.5) { // medusa bell rim glow
      emit += glowC * u.misc.x * smoothstep(0.75, 1.0, w) * pulse * 0.8;
      col = mix(col, accent, 0.25);
    }
  } else if (part < 1.5) {
    // Membranes: lighter, with veins and light passing through them.
    let vein = smoothstep(0.9, 1.0, abs(sin(s * 90.0 + v * 4.0))) * 0.6;
    col = mix(mix(col, accent, 0.45), back * 0.6, vein * 0.5);
    col = mix(col, accent, u.pat.z * 0.3 * smoothstep(0.6, 1.0, v));
    emit += glowC * u.misc.x * 0.5 * smoothstep(0.8, 1.0, v) * (0.6 + 0.4 * sin(t * 2.0 + s * 20.0));
  } else if (part < 2.5) {
    col = mix(vec3f(0.82, 0.78, 0.7), accent, 0.25) * mix(1.0, 0.55, v);
  } else if (part < 3.5) {
    col = mix(col, accent, 0.5);
    emit += glowC * u.misc.x * 0.6 * pow(w, 3.0);
  } else if (part < 4.5) {
    col = vec3f(0.01);
    emit += glowC * (0.6 + 0.8 * u.misc.x);
  } else {
    emit += glowC * (2.2 + 0.8 * sin(t * u.misc.y * 4.0));
  }

  let diff = max(dot(N, Ld), 0.0);
  let amb = mix(vec3f(0.05, 0.12, 0.2), vec3f(0.22, 0.36, 0.45), 0.5 + 0.5 * N.y);
  let H = normalize(Ld + V);
  let spec = pow(max(dot(N, H), 0.0), 48.0) * select(select(0.3, 0.08, part > 0.5 && part < 1.5), 0.8, part > 3.5);
  let fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  let irid = (0.5 + 0.5 * cos(TAU * (fres * 1.4 + s * 2.0 + vec3f(0.0, 0.33, 0.67)))) * u.pat.w * fres;
  var trans = vec3f(0.0);
  if (part > 0.5 && part < 1.5) { trans = col * max(dot(-N, Ld), 0.0) * 0.6; }

  var c = col * (diff * vec3f(1.0, 0.97, 0.9) * 0.9 + amb) + trans + spec * vec3f(0.8, 0.9, 1.0) + irid * 0.9 + emit;
  c += vec3f(0.1, 0.35, 0.5) * fres * 0.35;

  let dist = length(u.cam.xyz - i.wp);
  c = mix(c, vec3f(0.02, 0.09, 0.14), 1.0 - exp(-dist * 0.05));
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
}
`;

export const backdropWGSL = common + /* wgsl */ `
struct BO { @builtin(position) cp: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> BO {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: BO;
  o.cp = vec4f(p[vi], 0.9999, 1.0);
  o.uv = p[vi] * 0.5 + 0.5;
  return o;
}
@fragment fn fs(i: BO) -> @location(0) vec4f {
  let t = u.anim2.w;
  let top = vec3f(0.08, 0.27, 0.36); let deep = vec3f(0.01, 0.04, 0.08);
  var c = mix(deep, top, pow(i.uv.y, 1.6));
  // Slanted light shafts from the surface
  let x = i.uv.x + i.uv.y * 0.35;
  let shafts = pow(0.5 + 0.5 * sin(x * 9.0 + sin(x * 3.0 + t * 0.2) * 2.0 + t * 0.15), 6.0);
  c += vec3f(0.12, 0.25, 0.28) * shafts * pow(i.uv.y, 2.0) * 0.6;
  // Drifting marine snow
  let g = vec2f(i.uv.x * 30.0, i.uv.y * 30.0 + t * 0.4);
  let d = cells(g, 1000.0);
  c += vec3f(0.5, 0.6, 0.6) * (1.0 - smoothstep(0.0, 0.05, d)) * 0.25;
  // Selected tile gets a faint warm rim
  let e = min(min(i.uv.x, 1.0 - i.uv.x), min(i.uv.y, 1.0 - i.uv.y));
  c += vec3f(0.9, 0.7, 0.3) * u.misc.w * (1.0 - smoothstep(0.0, 0.015, e)) * 0.6;
  return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
}
`;
