// The genome: a seeded description of one creature. Everything visual and behavioral
// is derived from these numbers, so the same seed always produces the same animal.
import { makeRng } from './rng.js';

export const PLANS = ['serpent', 'ray', 'drake', 'medusa'];
export const PATTERNS = ['stripes', 'spots', 'rings', 'scales'];
export const TAILS = ['fork', 'fan', 'whip', 'twin'];

// Rare traits for the abyssal ecosystem. p is the chance a creature rolls it.
const TRAITS = [
  { id: 'luminous', label: 'Luminous', p: 0.22 },
  { id: 'crowned', label: 'Crowned', p: 0.14 },
  { id: 'lantern', label: 'Lantern-bearer', p: 0.12 },
  { id: 'twinTail', label: 'Twin-tailed', p: 0.08 },
  { id: 'manyFinned', label: 'Many-finned', p: 0.1 },
  { id: 'albino', label: 'Pale', p: 0.04 },
  { id: 'gilded', label: 'Gilded', p: 0.03 },
  { id: 'voidborn', label: 'Voidborn', p: 0.025 },
];

const NOUNS = {
  serpent: ['Wyrm', 'Eel', 'Serpent', 'Ribbon', 'Coil'],
  ray: ['Veilray', 'Glider', 'Mantle', 'Kite', 'Skimmer'],
  drake: ['Drake', 'Finwyrm', 'Seadrake', 'Wyvern', 'Reefdrake'],
  medusa: ['Lantern', 'Bellmoth', 'Medusa', 'Veil', 'Chandelier'],
};
const SYL_A = ['Vel', 'Mor', 'Ish', 'Tal', 'Ael', 'Quo', 'Ser', 'Nym', 'Dra', 'Cael', 'Ory', 'Thal', 'Lum', 'Vash'];
const SYL_B = ['lu', 'ra', 'ne', 'tho', 'shi', 'va', 'mi', 'qua', 'ri', 'do', 'sae', 'ny'];
const SYL_C = ['ran', 'mis', 'thar', 'lis', 'dun', 'vae', 'rok', 'nel', 'sith', 'or'];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

export function makeGenome(seed, overrides = {}) {
  const r = makeRng('genome:' + seed);
  const traits = {};
  for (const t of TRAITS) if (r.chance(t.p)) traits[t.id] = true;
  // Palettes are mutually exclusive; keep the rarest one.
  if (traits.voidborn) { delete traits.gilded; delete traits.albino; }
  if (traits.gilded) delete traits.albino;

  const plan = overrides.plan ?? r.weighted([['serpent', 3], ['ray', 2], ['drake', 3], ['medusa', 2]]);
  if (plan === 'medusa') { delete traits.manyFinned; delete traits.twinTail; delete traits.lantern; }
  let rarityScore = 0;
  for (const t of TRAITS) if (traits[t.id]) rarityScore += -Math.log2(t.p);

  const g = {
    seed,
    plan,
    traits,
    length: r.range(0.85, 1.15),
    girth: plan === 'serpent' ? r.range(0.035, 0.06) : plan === 'ray' ? r.range(0.05, 0.075) : r.range(0.07, 0.12),
    flatten: plan === 'ray' ? r.range(1.6, 2.4) : r.range(0.75, 1.25),
    headSize: r.range(0.0, 0.6),
    arch: r.range(-0.03, 0.05),
    dorsal: r.chance(plan === 'medusa' ? 0 : 0.75) ? r.range(0.04, 0.14) : 0,
    dorsalJag: r.chance(0.5) ? r.int(3, 9) : 0,
    finPairs: plan === 'ray' ? 1 : plan === 'medusa' ? 0 : r.int(1, 2),
    finSize: r.range(0.7, 1.3),
    tail: r.pick(TAILS),
    horns: r.chance(0.55) ? r.int(1, 2) : 0,
    hornLen: r.range(0.08, 0.22),
    hornCurl: r.range(-0.6, 0.9),
    whiskers: r.chance(0.45) ? r.int(1, 2) : 0,
    tentacles: plan === 'medusa' ? r.int(8, 16) : 0,
    eyes: r.weighted([[1, 6], [2, 2], [3, 1]]),
    pattern: r.pick(PATTERNS),
    patternFreq: r.range(0.6, 1.6),
    patternContrast: r.range(0.35, 0.9),
    iridescence: r.range(0, 0.8),
    glow: r.range(0.05, 0.3),
    glowPulse: r.range(0.6, 2.2),
    swimSpeed: r.range(0.7, 1.4),
    undulation: plan === 'serpent' ? r.range(0.06, 0.1) : plan === 'drake' ? r.range(0.03, 0.06) : r.range(0.01, 0.03),
    waves: plan === 'serpent' ? r.range(1.2, 2.2) : r.range(0.6, 1.1),
    flap: plan === 'ray' ? r.range(0.15, 0.3) : plan === 'drake' ? r.range(0.12, 0.25) : 0.05,
    flapSpeed: r.range(1.2, 2.4),
  };

  if (traits.crowned) { g.horns = 3; g.hornLen *= 1.4; }
  if (traits.lantern) g.lure = true;
  if (traits.twinTail) g.tail = 'twin';
  if (traits.manyFinned && plan !== 'medusa') g.finPairs += 2;
  if (traits.luminous) g.glow = r.range(0.8, 1.3);

  // Palette: a harmony around a base hue, with rare palettes overriding it.
  const h = r.next();
  const harmony = r.pick([0.08, 0.5, 0.33, -0.12]);
  let back = hsl(h, r.range(0.45, 0.8), r.range(0.22, 0.38));
  let belly = hsl(h + 0.04, r.range(0.25, 0.5), r.range(0.6, 0.78));
  let accent = hsl(h + harmony, r.range(0.6, 0.95), r.range(0.4, 0.6));
  let glowC = hsl(h + harmony + r.range(-0.1, 0.1), 0.9, 0.62);
  if (traits.albino) { back = [0.86, 0.84, 0.86]; belly = [0.97, 0.95, 0.95]; accent = [0.95, 0.62, 0.7]; glowC = [1, 0.5, 0.6]; }
  if (traits.gilded) { back = [0.55, 0.38, 0.1]; belly = [0.95, 0.82, 0.45]; accent = [1, 0.78, 0.25]; glowC = [1, 0.85, 0.4]; g.iridescence = 1; }
  if (traits.voidborn) { back = [0.02, 0.02, 0.04]; belly = [0.06, 0.05, 0.1]; accent = [0.1, 0.08, 0.18]; glowC = hsl(h, 1, 0.6); g.glow = 1.6; }
  g.colors = { back, belly, accent, glow: glowC };

  Object.assign(g, overrides);

  g.rarityScore = rarityScore;
  g.rarity = rarityScore >= 7 ? 'Mythic' : rarityScore >= 4 ? 'Rare' : rarityScore >= 2 ? 'Uncommon' : 'Common';
  g.traitLabels = TRAITS.filter((t) => traits[t.id]).map((t) => t.label);

  const nr = makeRng('name:' + seed);
  const genus = nr.pick(SYL_A) + nr.pick(SYL_B) + nr.pick(SYL_C);
  const epithet = g.traitLabels.length ? g.traitLabels[0] + ' ' : '';
  g.name = `${epithet}${genus} ${nr.pick(NOUNS[g.plan])}`;
  g.length = clamp(g.length, 0.5, 1.6);
  return g;
}
