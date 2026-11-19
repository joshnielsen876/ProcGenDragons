import { makeGenome, PLANS, PATTERNS, TAILS } from './genome.js';
import { buildCreature } from './body.js';
import { createRenderer } from './renderer.js';
import { randomSeed, makeRng } from './rng.js';

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid'), focus = $('#focus'), stage = $('#stage');
const TILE_COUNT = 9;

const SLIDERS = [
  ['length', 'Length', 0.6, 1.5, 0.01],
  ['girth', 'Girth', 0.02, 0.16, 0.001],
  ['headSize', 'Head', 0, 1.2, 0.01],
  ['dorsal', 'Dorsal sail', 0, 0.25, 0.005],
  ['finSize', 'Fin and wing size', 0.4, 1.8, 0.01],
  ['hornLen', 'Horn length', 0.04, 0.4, 0.005],
  ['undulation', 'Body wave', 0, 0.14, 0.002],
  ['flap', 'Wingbeat', 0, 0.4, 0.005],
  ['patternFreq', 'Pattern scale', 0.3, 2.2, 0.01],
  ['patternContrast', 'Pattern contrast', 0, 1, 0.01],
  ['iridescence', 'Iridescence', 0, 1, 0.01],
  ['glow', 'Glow', 0, 2, 0.01],
];
const SELECTS = [['plan', 'Body plan', PLANS], ['tail', 'Tail', TAILS], ['pattern', 'Pattern', PATTERNS]];

let renderer;
const tiles = [];
let focusView = null, focusSeed = null, overrides = {};

function rarityClass(r) { return 'rarity rarity-' + r.toLowerCase(); }

function describe(g) {
  return g.plan === 'medusa' ? `medusa · ${g.tentacles} tentacles · ${g.pattern}` : `${g.plan} · ${g.tail} tail · ${g.pattern}`;
}

function setTile(tile, seed) {
  const g = makeGenome(seed);
  const mesh = buildCreature(g);
  tile.seed = seed;
  tile.view.setCreature(g, mesh);
  tile.el.querySelector('.name').textContent = g.name;
  tile.el.querySelector('.meta').textContent = describe(g);
  const badge = tile.el.querySelector('.rarity');
  badge.textContent = g.rarity;
  badge.className = rarityClass(g.rarity);
  tile.el.setAttribute('aria-label', `${g.name}, ${g.rarity}. Open in the lab.`);
}

function fillGrid(seeds) {
  seeds.forEach((s, i) => setTile(tiles[i], s));
}

function newSpecimens() { fillGrid(Array.from({ length: TILE_COUNT }, randomSeed)); }

function huntRarities() {
  const found = [];
  for (let i = 0; i < 6000 && found.length < TILE_COUNT; i++) {
    const s = randomSeed();
    const g = makeGenome(s);
    if (g.rarity === 'Rare' || g.rarity === 'Mythic') found.push(s);
  }
  fillGrid(found);
}

function buildGrid() {
  for (let i = 0; i < TILE_COUNT; i++) {
    const el = document.createElement('button');
    el.className = 'tile';
    el.type = 'button';
    el.innerHTML = '<span class="label"><span class="name"></span><span class="meta"></span></span><span class="rarity"></span>';
    grid.appendChild(el);
    const tile = { el, view: renderer.makeView(el), seed: null };
    el.addEventListener('click', () => openFocus(tile.seed));
    el.addEventListener('pointerenter', () => { tile.view.selected = 1; });
    el.addEventListener('pointerleave', () => { tile.view.selected = 0; });
    tiles.push(tile);
  }
}

function controls() {
  const box = $('#controls');
  box.innerHTML = '';
  for (const [key, label, opts] of SELECTS) {
    const id = 'ctl-' + key;
    const wrap = document.createElement('label');
    wrap.className = 'ctl';
    wrap.htmlFor = id;
    wrap.innerHTML = `<span>${label}</span><select id="${id}">${opts.map((o) => `<option value="${o}">${o}</option>`).join('')}</select>`;
    box.appendChild(wrap);
    wrap.querySelector('select').addEventListener('change', (e) => {
      if (key === 'plan') overrides = { plan: e.target.value };
      else overrides[key] = e.target.value;
      refreshFocus();
    });
  }
  for (const [key, label, lo, hi, step] of SLIDERS) {
    const id = 'ctl-' + key;
    const wrap = document.createElement('label');
    wrap.className = 'ctl';
    wrap.htmlFor = id;
    wrap.innerHTML = `<span>${label}<output></output></span><input id="${id}" type="range" min="${lo}" max="${hi}" step="${step}">`;
    box.appendChild(wrap);
    wrap.querySelector('input').addEventListener('input', (e) => {
      overrides[key] = parseFloat(e.target.value);
      refreshFocus();
    });
  }
}

function syncControls(g) {
  for (const [key] of SELECTS) $('#ctl-' + key).value = g[key];
  for (const [key] of SLIDERS) {
    const input = $('#ctl-' + key);
    input.value = g[key];
    input.previousElementSibling.querySelector('output').textContent = Number(g[key]).toFixed(2);
  }
}

function refreshFocus(sync = true) {
  const g = makeGenome(focusSeed, overrides);
  const mesh = buildCreature(g);
  focusView.setCreature(g, mesh);
  $('#f-name').textContent = g.name;
  $('#f-rarity').textContent = g.rarity;
  $('#f-rarity').className = rarityClass(g.rarity);
  $('#f-seed').textContent = focusSeed;
  $('#f-traits').textContent = g.traitLabels.length ? g.traitLabels.join(', ') : 'No rare traits';
  $('#f-stats').textContent = `${mesh.triangles.toLocaleString()} triangles`;
  $('#f-edited').hidden = Object.keys(overrides).length === 0;
  if (sync) syncControls(g);
}

function openFocus(seed) {
  focusSeed = seed; overrides = {};
  grid.hidden = true; $('#grid-actions').hidden = true; focus.hidden = false;
  try { history.replaceState(null, '', '#s-' + seed); } catch {}
  refreshFocus();
  window.scrollTo(0, 0);
}

function closeFocus() {
  focus.hidden = true; grid.hidden = false; $('#grid-actions').hidden = false;
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
}

function mutate() {
  const r = makeRng(randomSeed());
  const g = makeGenome(focusSeed, overrides);
  for (const [key, , lo, hi] of SLIDERS) {
    if (r.chance(0.5)) overrides[key] = Math.min(hi, Math.max(lo, g[key] * r.range(0.8, 1.25) + r.range(-0.02, 0.02) * (hi - lo)));
  }
  refreshFocus();
}

function setupStage() {
  focusView = renderer.makeView(stage);
  focusView.spin = true;
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; focusView.spin = false; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    focusView.yaw -= (e.clientX - drag.x) * 0.01;
    focusView.pitch = Math.max(-1.2, Math.min(1.2, focusView.pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
  });
  const end = () => { drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); focusView.zoom = Math.max(0.5, Math.min(3, focusView.zoom * Math.exp(-e.deltaY * 0.001))); }, { passive: false });
  stage.addEventListener('dblclick', () => { focusView.spin = !focusView.spin; });
}

async function main() {
  try {
    renderer = await createRenderer($('#gpu'));
  } catch (err) {
    $('#nogpu').hidden = false;
    $('#app').hidden = true;
    return;
  }
  buildGrid();
  setupStage();
  controls();
  newSpecimens();

  $('#btn-new').addEventListener('click', newSpecimens);
  $('#btn-hunt').addEventListener('click', huntRarities);
  $('#btn-back').addEventListener('click', closeFocus);
  $('#btn-reset').addEventListener('click', () => { overrides = {}; refreshFocus(); });
  $('#btn-mutate').addEventListener('click', mutate);
  $('#seed-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = $('#seed-input').value.trim();
    if (s) openFocus(s);
  });
  $('#btn-copy').addEventListener('click', () => {
    navigator.clipboard?.writeText(focusSeed).then(() => { $('#btn-copy').textContent = 'Copied'; setTimeout(() => { $('#btn-copy').textContent = 'Copy seed'; }, 1200); }).catch(() => {});
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !focus.hidden) closeFocus(); });

  const m = /^#s-([a-z0-9-]+)$/i.exec(location.hash);
  if (m) openFocus(m[1]);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  const loop = (now) => {
    renderer.frame(reduce ? 2 : (now - t0) / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__lab = { ready: true, capture: (t) => renderer.capture(t), openFocus, huntRarities, fillGrid };
}

main();
