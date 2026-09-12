// Génère un artefact HTML autonome : la carte Arnhem + la grille d'hex colorée
// par type de terrain, avec le coût de mouvement affiché sur chaque hex —
// pour vérification visuelle de public/modules/arnhem/arnhem.json (module.terrain).
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_CALIBRATION } from '../src/lib/calibration.js'
import { hexExists, removedHexSet } from '../src/lib/mapShape.js'

const mod = JSON.parse(readFileSync('public/modules/arnhem/arnhem.json', 'utf8'))
const { imageWidth, imageHeight, cols, rows, evenColMinus } = mod.map
const removedSet = removedHexSet(mod.map)
const mapShapeCfg = { cols, rows, evenColMinus }
const hexOnMap = (c, r) => hexExists(c, r, mapShapeCfg, removedSet)
const initialRemoved = [...removedSet].sort()
const { x0, y0, colStep, a, rowStep } = DEFAULT_CALIBRATION
const b = rowStep / 2
const grid = mod.terrain.grid
const TYPES = mod.terrain.types

const imgBuf = readFileSync('public/modules/arnhem/images/arnhem-map.jpg')
const imgB64 = imgBuf.toString('base64')

const AXIAL_DIRS = [
  { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 },
]
function offsetToCube(col, row) {
  const q = col
  const r = row - (col - (col & 1)) / 2
  return { q, r }
}
function fromAxial(q, r) {
  return { col: q, row: r + (q - (q & 1)) / 2 }
}
function neighborsOf(col, row) {
  const { q, r } = offsetToCube(col, row)
  return AXIAL_DIRS.map((d) => fromAxial(q + d.dq, r + d.dr))
}

const centerOf = (c, r) => {
  const yoff = c % 2 === 1 ? rowStep / 2 : 0
  return { x: x0 + c * colStep, y: y0 + (r - 1) * rowStep + yoff }
}
const idOf = (c, r) => String(c + 1).padStart(2, '0') + String(r).padStart(2, '0')

const hexes = []
for (let c = 0; c < cols; c++) {
  for (let r = 1; r <= rows; r++) {
    if (!hexOnMap(c, r)) continue
    const { x: cx0, y: cy } = centerOf(c, r)
    const pts = [
      [cx0 - a, cy], [cx0 - a / 2, cy - b], [cx0 + a / 2, cy - b],
      [cx0 + a, cy], [cx0 + a / 2, cy + b], [cx0 - a / 2, cy + b],
    ].map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
    const hexId = idOf(c, r)
    const terrain = grid[hexId] || 'mixed'
    hexes.push({ id: hexId, cx: cx0, cy, pts, terrain, mp: TYPES[terrain].mp })
  }
}

// Bordures hex-à-hex (routes) : chaque paire d'hex adjacents, une seule fois
// (clé canonique = les deux id triés), avec le centre des deux hex pour
// tracer la ligne cliquable.
const edgeMap = new Map()
for (let c = 0; c < cols; c++) {
  for (let r = 1; r <= rows; r++) {
    if (!hexOnMap(c, r)) continue
    const aId = idOf(c, r)
    const A = centerOf(c, r)
    for (const n of neighborsOf(c, r)) {
      if (!hexOnMap(n.col, n.row)) continue
      const bId = idOf(n.col, n.row)
      const key = aId < bId ? aId + '-' + bId : bId + '-' + aId
      if (edgeMap.has(key)) continue
      const B = centerOf(n.col, n.row)
      edgeMap.set(key, { key, ax: A.x, ay: A.y, bx: B.x, by: B.y })
    }
  }
}
const edges = [...edgeMap.values()]
const initialRoads = mod.terrain.roads || []
const initialTrails = mod.terrain.trails || []
const initialRivers = mod.terrain.rivers || []
const initialStreams = mod.terrain.streams || []

const html = `<!doctype html>
<title>Grille de Mouvement Arnhem</title>
<style>
:root {
  --ground: #eee7d6;
  --ink: #2a2620;
  --ink-dim: #6b6353;
  --panel: #e2d9c2;
  --panel-border: #b8ac8e;
  --accent: #a8551f;
  --mixed: #cdc4a4;
  --woods: #5c7a2e;
  --broken: #9c8f76;
  --rough: #c17f3a;
  --city: #9c2b2b;
  --town: #4a6b8a;
  --auto-dot: #8a8265;
  --manual-dot: #a8551f;
  --road: #d13b1f;
  --trail: #8a6d1f;
  --river: #1f5f8a;
  --stream: #4a90b8;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #1c1a14;
    --ink: #ece4d0;
    --ink-dim: #a49a80;
    --panel: #262218;
    --panel-border: #4a4331;
    --accent: #e0925a;
    --mixed: #6b6449;
    --woods: #4b6428;
    --broken: #756b54;
    --rough: #c17f3a;
    --city: #b23c3c;
    --town: #5f83a6;
    --auto-dot: #8a8265;
    --manual-dot: #e0925a;
    --road: #e8532f;
    --trail: #d1ab4a;
    --river: #5fb3e0;
    --stream: #8ecae6;
  }
}
:root[data-theme="dark"] {
  --ground: #1c1a14;
  --ink: #ece4d0;
  --ink-dim: #a49a80;
  --panel: #262218;
  --panel-border: #4a4331;
  --accent: #e0925a;
  --mixed: #6b6449;
  --woods: #4b6428;
  --broken: #756b54;
  --rough: #c17f3a;
  --city: #b23c3c;
  --town: #5f83a6;
  --auto-dot: #8a8265;
  --manual-dot: #e0925a;
  --road: #e8532f;
  --trail: #d1ab4a;
  --river: #5fb3e0;
  --stream: #8ecae6;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: 'Public Sans', system-ui, sans-serif;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 20px;
  border-bottom: 2px solid var(--panel-border);
  background: var(--panel);
  flex-wrap: wrap;
  z-index: 5;
}
h1 {
  font-family: 'Oswald', system-ui, sans-serif;
  font-weight: 600;
  font-size: 1.15rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0;
  color: var(--accent);
  white-space: nowrap;
}
.legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.72rem;
}
.legend .chip {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.legend .swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(0,0,0,.25);
  flex: none;
}
.legend .count {
  color: var(--ink-dim);
}
.spacer { flex: 1; }
.controls {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.72rem;
}
.controls label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  user-select: none;
}
.controls button {
  font-family: inherit;
  font-size: inherit;
  background: transparent;
  border: 1px solid var(--panel-border);
  color: var(--ink);
  border-radius: 4px;
  padding: 3px 9px;
  cursor: pointer;
}
.controls button:hover { border-color: var(--accent); color: var(--accent); }
main {
  position: relative;
  flex: 1;
  overflow: hidden;
  cursor: grab;
  background: #14120d;
}
main.dragging { cursor: grabbing; }
main.dragging * { cursor: grabbing !important; }
svg { display: block; position: absolute; top: 0; left: 0; }
polygon.hex {
  stroke: rgba(0,0,0,.35);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  fill-opacity: .55;
}
.hex-mixed  { fill: var(--mixed); }
.hex-woods  { fill: var(--woods); }
.hex-broken { fill: var(--broken); }
.hex-rough  { fill: var(--rough); }
.hex-city   { fill: var(--city); }
.hex-town   { fill: var(--town); }
polygon.hex:hover { cursor: pointer; }
text.mp {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 700;
  fill: var(--ink);
  paint-order: stroke;
  stroke: var(--ground);
  stroke-width: 3.5px;
  stroke-linejoin: round;
  text-anchor: middle;
  pointer-events: none;
}
text.hexid {
  font-family: 'IBM Plex Mono', monospace;
  fill: var(--ink-dim);
  paint-order: stroke;
  stroke: var(--ground);
  stroke-width: 2.5px;
  text-anchor: middle;
  pointer-events: none;
  opacity: .85;
}
.edge .hit {
  stroke: transparent;
  stroke-width: 16;
  pointer-events: stroke;
}
.edge .road {
  stroke: var(--road);
  stroke-width: 7;
  stroke-linecap: round;
  opacity: 0;
  pointer-events: none;
}
.edge.road-active .road { opacity: .95; }
.edge .trail {
  stroke: var(--trail);
  stroke-width: 5;
  stroke-linecap: round;
  stroke-dasharray: 4 7;
  opacity: 0;
  pointer-events: none;
}
.edge.trail-active .trail { opacity: .95; }
.edge .river {
  stroke: var(--river);
  stroke-width: 9;
  stroke-linecap: round;
  opacity: 0;
  pointer-events: none;
}
.edge.river-active .river { opacity: .95; }
.edge .stream {
  stroke: var(--stream);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-dasharray: 2 5;
  opacity: 0;
  pointer-events: none;
}
.edge.stream-active .stream { opacity: .95; }
svg.hide-roads .road { display: none; }
svg.hide-trails .trail { display: none; }
svg.hide-rivers .river { display: none; }
svg.hide-streams .stream { display: none; }
.mode-road .hit, .mode-trail .hit, .mode-river .hit, .mode-stream .hit { cursor: pointer; }
.mode-road .hit:hover, .mode-trail .hit:hover, .mode-river .hit:hover, .mode-stream .hit:hover { stroke: rgba(255,255,255,.32); }
.mode-remove polygon.hex:hover { fill: rgba(192,57,43,.45); }
polygon.hex.marked-removed { fill: #c0392b; fill-opacity: .65; }
text.remx {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 700;
  fill: #ffffff;
  text-anchor: middle;
  pointer-events: none;
  opacity: 0;
}
text.remx.active { opacity: 1; }
#terrainMenu {
  position: fixed;
  z-index: 20;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 14px rgba(0,0,0,.35);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.72rem;
}
#terrainMenu[hidden] { display: none; }
#terrainMenu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: none;
  color: var(--ink);
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  text-align: left;
}
#terrainMenu button:hover { background: rgba(255,255,255,.1); }
#terrainMenu .swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid rgba(0,0,0,.25);
  flex: none;
}
#saveBar {
  display: flex;
  align-items: center;
  gap: 10px;
}
#saveBar button.primary {
  background: var(--accent);
  color: var(--ground);
  border-color: var(--accent);
  font-weight: 600;
}
#saveStatus {
  color: var(--ink-dim);
  min-width: 90px;
}
#saveStatus.dirty { color: var(--accent); }
#saveStatus.err { color: #c0392b; }
footer {
  padding: 6px 20px;
  border-top: 1px solid var(--panel-border);
  background: var(--panel);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.68rem;
  color: var(--ink-dim);
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}
footer .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; vertical-align: middle; }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600&display=swap">

<header>
  <h1>Arnhem &mdash; Grille de Mouvement</h1>
  <div class="legend" id="legend"></div>
  <div class="spacer"></div>
  <div class="controls">
    <label><input type="checkbox" id="toggleMp" checked> coût</label>
    <label><input type="checkbox" id="toggleId"> id hex</label>
    <label><input type="checkbox" id="toggleFill" checked> teinte</label>
    <label><input type="checkbox" id="toggleRoads" checked> routes</label>
    <label><input type="checkbox" id="toggleTrails" checked> sentiers</label>
    <label><input type="checkbox" id="toggleRivers" checked> rivières</label>
    <label><input type="checkbox" id="toggleStreams" checked> ruisseaux</label>
    <button id="reset">recentrer</button>
    <span id="zoomLabel">100%</span>
  </div>
  <div id="saveBar">
    <label><input type="checkbox" id="roadMode" checked> mode route (clic = tracer)</label>
    <span id="roadCount">0 route(s)</span>
    <button id="clearRoads">tout effacer</button>
    <label><input type="checkbox" id="trailMode"> mode sentier (clic = tracer)</label>
    <span id="trailCount">0 sentier(s)</span>
    <button id="clearTrails">tout effacer</button>
    <label><input type="checkbox" id="riverMode"> mode rivière (clic = tracer)</label>
    <span id="riverCount">0 rivière(s)</span>
    <button id="clearRivers">tout effacer</button>
    <label><input type="checkbox" id="streamMode"> mode ruisseau (clic = tracer)</label>
    <span id="streamCount">0 ruisseau(x)</span>
    <button id="clearStreams">tout effacer</button>
    <label><input type="checkbox" id="removeMode"> mode suppression hex (clic = marquer)</label>
    <span id="removedCount">0 hex marqué(s)</span>
    <button id="clearRemoved">tout effacer</button>
    <button id="exportJson">export JSON</button>
    <button id="save" class="primary">enregistrer</button>
    <span id="saveStatus">à jour</span>
  </div>
</header>

<main id="viewport">
  <svg id="svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}">
    <image href="data:image/jpeg;base64,${imgB64}" x="0" y="0" width="${imageWidth}" height="${imageHeight}" />
    <g id="hexLayer">
${hexes.map((h) => `      <polygon class="hex hex-${h.terrain}" points="${h.pts}" data-id="${h.id}" data-terrain="${h.terrain}" data-mp="${h.mp}" />`).join('\n')}
    </g>
    <g id="edgeLayer">
${edges.map((e) => `      <g class="edge" data-key="${e.key}"><line class="hit" x1="${e.ax.toFixed(1)}" y1="${e.ay.toFixed(1)}" x2="${e.bx.toFixed(1)}" y2="${e.by.toFixed(1)}" /><line class="road" x1="${e.ax.toFixed(1)}" y1="${e.ay.toFixed(1)}" x2="${e.bx.toFixed(1)}" y2="${e.by.toFixed(1)}" /><line class="trail" x1="${e.ax.toFixed(1)}" y1="${e.ay.toFixed(1)}" x2="${e.bx.toFixed(1)}" y2="${e.by.toFixed(1)}" /><line class="river" x1="${e.ax.toFixed(1)}" y1="${e.ay.toFixed(1)}" x2="${e.bx.toFixed(1)}" y2="${e.by.toFixed(1)}" /><line class="stream" x1="${e.ax.toFixed(1)}" y1="${e.ay.toFixed(1)}" x2="${e.bx.toFixed(1)}" y2="${e.by.toFixed(1)}" /></g>`).join('\n')}
    </g>
    <g id="labelLayer">
${hexes.map((h) => `      <text class="mp" data-id="${h.id}" x="${h.cx.toFixed(1)}" y="${(h.cy + a * 0.15).toFixed(1)}" font-size="${(a * 0.5).toFixed(1)}">${h.mp}</text><text class="hexid" x="${h.cx.toFixed(1)}" y="${(h.cy - a * 0.32).toFixed(1)}" font-size="${(a * 0.28).toFixed(1)}">${h.id}</text>`).join('\n')}
    </g>
    <g id="removedLayer">
${hexes.map((h) => `      <text class="remx" data-id="${h.id}" x="${h.cx.toFixed(1)}" y="${(h.cy + a * 0.32).toFixed(1)}" font-size="${(a * 0.9).toFixed(1)}">&times;</text>`).join('\n')}
    </g>
  </svg>
</main>

<div id="terrainMenu" hidden></div>

<script id="roads-data" type="application/json">${JSON.stringify(initialRoads)}</script>
<script id="trails-data" type="application/json">${JSON.stringify(initialTrails)}</script>
<script id="rivers-data" type="application/json">${JSON.stringify(initialRivers)}</script>
<script id="streams-data" type="application/json">${JSON.stringify(initialStreams)}</script>
<script id="removed-data" type="application/json">${JSON.stringify(initialRemoved)}</script>

<footer>
  <span>${hexes.length} hexs &middot; ${edges.length} bordures</span>
  <span><span class="dot" style="background:var(--manual-dot)"></span>colonie (lecture manuelle des noms de la carte)</span>
  <span><span class="dot" style="background:var(--auto-dot)"></span>terrain (classification automatique par couleur)</span>
  <span><span class="dot" style="background:var(--road)"></span>route (tracée à la main, enregistrée dans le module)</span>
  <span><span class="dot" style="background:var(--trail)"></span>sentier (tracé à la main, enregistré dans le module)</span>
  <span><span class="dot" style="background:var(--river)"></span>rivière (tracée à la main, enregistrée dans le module)</span>
  <span><span class="dot" style="background:var(--stream)"></span>ruisseau (tracé à la main, enregistré dans le module)</span>
  <span>ponts non couverts encore &mdash; à ajouter</span>
</footer>

<script>
const TYPES = ${JSON.stringify(TYPES)};
const legend = document.getElementById('legend');
function renderLegend() {
  const counts = {};
  document.querySelectorAll('.hex').forEach(h => { const t = h.dataset.terrain; counts[t] = (counts[t]||0)+1; });
  legend.innerHTML = '';
  Object.keys(TYPES).forEach(k => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = '<span class="swatch" style="background:var(--' + k + ')"></span>' +
      TYPES[k].label + ' <span class="count">' + TYPES[k].mp + 'MP &middot; ' + (counts[k]||0) + '</span>';
    legend.appendChild(chip);
  });
}
renderLegend();

const viewport = document.getElementById('viewport');
const svg = document.getElementById('svg');
const W = ${imageWidth}, H = ${imageHeight};
let zoom = 0.42;
function applyZoom() {
  svg.style.width = (W * zoom) + 'px';
  svg.style.height = (H * zoom) + 'px';
  document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
}
function centerView() {
  viewport.scrollLeft = (svg.scrollWidth - viewport.clientWidth) / 2;
  viewport.scrollTop = 40;
}
applyZoom();
requestAnimationFrame(centerView);

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const step = 0.05;
  zoom = Math.min(2, Math.max(0.15, zoom + (e.deltaY < 0 ? step : -step)));
  applyZoom();
}, { passive: false });

let drag = null;
viewport.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop };
  viewport.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  viewport.scrollLeft = drag.sl - (e.clientX - drag.x);
  viewport.scrollTop = drag.st - (e.clientY - drag.y);
});
window.addEventListener('mouseup', () => { drag = null; viewport.classList.remove('dragging'); });

document.getElementById('reset').addEventListener('click', () => { zoom = 0.42; applyZoom(); centerView(); });
document.getElementById('toggleMp').addEventListener('change', (e) => {
  document.querySelectorAll('text.mp').forEach(t => t.style.display = e.target.checked ? '' : 'none');
});
document.getElementById('toggleId').addEventListener('change', (e) => {
  document.querySelectorAll('text.hexid').forEach(t => t.style.display = e.target.checked ? '' : 'none');
});
document.getElementById('toggleFill').addEventListener('change', (e) => {
  document.getElementById('hexLayer').style.display = e.target.checked ? '' : 'none';
});
document.getElementById('toggleRoads').addEventListener('change', (e) => {
  svg.classList.toggle('hide-roads', !e.target.checked);
});
document.getElementById('toggleTrails').addEventListener('change', (e) => {
  svg.classList.toggle('hide-trails', !e.target.checked);
});
document.getElementById('toggleRivers').addEventListener('change', (e) => {
  svg.classList.toggle('hide-rivers', !e.target.checked);
});
document.getElementById('toggleStreams').addEventListener('change', (e) => {
  svg.classList.toggle('hide-streams', !e.target.checked);
});
document.querySelectorAll('text.hexid').forEach(t => t.style.display = 'none');

// ─────────────────────────────────────────────────────────────
// Édition des routes : clic sur une bordure hex-à-hex pour tracer/effacer
// une route. État en mémoire (roads: Set des clés "id-id"), persistée via
// la capability "artifact" (le bouton "enregistrer" republie une nouvelle
// version de la page). Rien n'est conservé tant que ce n'est pas
// explicitement enregistré.
// ─────────────────────────────────────────────────────────────
const roadsData = document.getElementById('roads-data');
const roads = new Set(JSON.parse(roadsData.textContent || '[]'));
let dirty = false;

function edgeGroup(key) { return document.querySelector('.edge[data-key="' + key + '"]'); }
function paintRoad(key) {
  const g = edgeGroup(key);
  if (g) g.classList.toggle('road-active', roads.has(key));
}
roads.forEach(paintRoad);

function updateRoadCount() {
  document.getElementById('roadCount').textContent = roads.size + ' route(s)';
}
function setStatus(text, cls) {
  const el = document.getElementById('saveStatus');
  el.textContent = text;
  el.className = cls || '';
}
updateRoadCount();

// Les 4 modes d'édition de bordure (route/sentier/rivière/ruisseau) sont
// mutuellement exclusifs : cocher l'un décoche automatiquement les 3 autres,
// pour qu'un clic sur une bordure n'ait jamais qu'une seule interprétation
// possible. edgeModes liste, pour chaque case, sa classe CSS sur #viewport
// (active tant que la case est cochée, pour le style ".mode-XXX .hit:hover").
const roadModeBox = document.getElementById('roadMode');
const trailModeBox = document.getElementById('trailMode');
const riverModeBox = document.getElementById('riverMode');
const streamModeBox = document.getElementById('streamMode');
const edgeModes = [
  { box: roadModeBox, cls: 'mode-road' },
  { box: trailModeBox, cls: 'mode-trail' },
  { box: riverModeBox, cls: 'mode-river' },
  { box: streamModeBox, cls: 'mode-stream' },
];
edgeModes.forEach(({ box, cls }) => {
  box.addEventListener('change', (e) => {
    viewport.classList.toggle(cls, e.target.checked);
    if (e.target.checked) {
      edgeModes.forEach((other) => {
        if (other.box !== box) { other.box.checked = false; viewport.classList.remove(other.cls); }
      });
    }
  });
});
viewport.classList.toggle('mode-road', roadModeBox.checked);

document.getElementById('edgeLayer').addEventListener('click', (e) => {
  const g = e.target.closest('.edge');
  if (!g) return;
  const key = g.dataset.key;
  if (roadModeBox.checked) {
    if (roads.has(key)) roads.delete(key); else roads.add(key);
    paintRoad(key);
    updateRoadCount();
  } else if (trailModeBox.checked) {
    if (trails.has(key)) trails.delete(key); else trails.add(key);
    paintTrail(key);
    updateTrailCount();
  } else if (riverModeBox.checked) {
    if (rivers.has(key)) rivers.delete(key); else rivers.add(key);
    paintRiver(key);
    updateRiverCount();
  } else if (streamModeBox.checked) {
    if (streams.has(key)) streams.delete(key); else streams.add(key);
    paintStream(key);
    updateStreamCount();
  } else {
    return;
  }
  dirty = true;
  setStatus('non enregistré', 'dirty');
});

document.getElementById('clearRoads').addEventListener('click', () => {
  if (!roads.size) return;
  if (!confirm('Effacer les ' + roads.size + ' route(s) tracée(s) ?')) return;
  [...roads].forEach((key) => { roads.delete(key); paintRoad(key); });
  updateRoadCount();
  dirty = true;
  setStatus('non enregistré', 'dirty');
});

// ─────────────────────────────────────────────────────────────
// Édition des sentiers : fonctionnement identique aux routes ci-dessus
// (même bordures, Set séparé, persistance via le même bouton "enregistrer").
// Les modes route/sentier sont mutuellement exclusifs (cf. plus haut) —
// un seul détermine ce que le clic sur une bordure modifie.
// ─────────────────────────────────────────────────────────────
const trailsData = document.getElementById('trails-data');
const trails = new Set(JSON.parse(trailsData.textContent || '[]'));

function paintTrail(key) {
  const g = edgeGroup(key);
  if (g) g.classList.toggle('trail-active', trails.has(key));
}
trails.forEach(paintTrail);

function updateTrailCount() {
  document.getElementById('trailCount').textContent = trails.size + ' sentier(s)';
}
updateTrailCount();

document.getElementById('clearTrails').addEventListener('click', () => {
  if (!trails.size) return;
  if (!confirm('Effacer les ' + trails.size + ' sentier(s) tracé(s) ?')) return;
  [...trails].forEach((key) => { trails.delete(key); paintTrail(key); });
  updateTrailCount();
  dirty = true;
  setStatus('non enregistré', 'dirty');
});

// ─────────────────────────────────────────────────────────────
// Édition des rivières et ruisseaux : même mécanique que routes/sentiers
// ci-dessus (bordures hex-à-hex, Set en mémoire par type, persistance via le
// bouton "enregistrer"). Contrairement à route/sentier qui RÉDUISENT le coût
// de mouvement en suivant la bordure, rivière/ruisseau sont des obstacles —
// leur effet sur le coût de traversée (et l'éventuelle règle de pont) n'est
// pas encore branché dans useAssisted.js ; cet artefact ne fait pour l'instant
// que capturer leur tracé géographique dans terrain.rivers / terrain.streams.
// ─────────────────────────────────────────────────────────────
const riversData = document.getElementById('rivers-data');
const rivers = new Set(JSON.parse(riversData.textContent || '[]'));

function paintRiver(key) {
  const g = edgeGroup(key);
  if (g) g.classList.toggle('river-active', rivers.has(key));
}
rivers.forEach(paintRiver);

function updateRiverCount() {
  document.getElementById('riverCount').textContent = rivers.size + ' rivière(s)';
}
updateRiverCount();

document.getElementById('clearRivers').addEventListener('click', () => {
  if (!rivers.size) return;
  if (!confirm('Effacer les ' + rivers.size + ' rivière(s) tracée(s) ?')) return;
  [...rivers].forEach((key) => { rivers.delete(key); paintRiver(key); });
  updateRiverCount();
  dirty = true;
  setStatus('non enregistré', 'dirty');
});

const streamsData = document.getElementById('streams-data');
const streams = new Set(JSON.parse(streamsData.textContent || '[]'));

function paintStream(key) {
  const g = edgeGroup(key);
  if (g) g.classList.toggle('stream-active', streams.has(key));
}
streams.forEach(paintStream);

function updateStreamCount() {
  document.getElementById('streamCount').textContent = streams.size + ' ruisseau(x)';
}
updateStreamCount();

document.getElementById('clearStreams').addEventListener('click', () => {
  if (!streams.size) return;
  if (!confirm('Effacer les ' + streams.size + ' ruisseau(x) tracé(s) ?')) return;
  [...streams].forEach((key) => { streams.delete(key); paintStream(key); });
  updateStreamCount();
  dirty = true;
  setStatus('non enregistré', 'dirty');
});

// ─────────────────────────────────────────────────────────────
// Suppression d'hex : clic sur un hex (mode "suppression" actif) pour le
// marquer comme absent de la carte imprimée. Même logique de persistance que
// les routes (republication de la page) ; le bouton "export JSON" affiche en
// plus la valeur à recopier dans map.removedHexes du module (aucune écriture
// disque n'est possible depuis la page publiée).
// ─────────────────────────────────────────────────────────────
const removedData = document.getElementById('removed-data');
const removedHexes = new Set(JSON.parse(removedData.textContent || '[]'));

function paintRemoved(id) {
  const poly = document.querySelector('polygon.hex[data-id="' + id + '"]');
  const mark = document.querySelector('text.remx[data-id="' + id + '"]');
  const on = removedHexes.has(id);
  if (poly) poly.classList.toggle('marked-removed', on);
  if (mark) mark.classList.toggle('active', on);
}
removedHexes.forEach(paintRemoved);

function updateRemovedCount() {
  document.getElementById('removedCount').textContent = removedHexes.size + ' hex marqué(s)';
}
updateRemovedCount();

const removeModeBox = document.getElementById('removeMode');
removeModeBox.addEventListener('change', (e) => { viewport.classList.toggle('mode-remove', e.target.checked); });

document.getElementById('hexLayer').addEventListener('click', (e) => {
  const poly = e.target.closest('polygon.hex');
  if (!poly) return;
  const id = poly.dataset.id;
  if (removeModeBox.checked) {
    if (removedHexes.has(id)) removedHexes.delete(id); else removedHexes.add(id);
    paintRemoved(id);
    updateRemovedCount();
    dirty = true;
    setStatus('non enregistré', 'dirty');
    return;
  }
  // Hors mode suppression, un clic sur un hex ouvre le menu de terrain
  // (cf. plus bas) — stopPropagation évite que ce même clic soit aussitôt
  // vu comme un "clic en dehors" par le listener qui ferme ce menu.
  e.stopPropagation();
  openTerrainMenu(id, e.clientX, e.clientY);
});

document.getElementById('clearRemoved').addEventListener('click', () => {
  if (!removedHexes.size) return;
  if (!confirm('Effacer les ' + removedHexes.size + ' hex marqué(s) ?')) return;
  [...removedHexes].forEach((id) => { removedHexes.delete(id); paintRemoved(id); });
  updateRemovedCount();
  dirty = true;
  setStatus('non enregistré', 'dirty');
});

// ─────────────────────────────────────────────────────────────
// Changement de terrain : clic gauche sur un hex (mode suppression inactif,
// cf. le handler de clic sur #hexLayer plus haut) ouvre un petit menu pour
// choisir un nouveau type. L'état vit directement dans le DOM (classe
// hex-<type>, data-terrain, data-mp, texte du coût) donc il est capturé tel
// quel par "enregistrer", sans Set ni script de données séparé.
// ─────────────────────────────────────────────────────────────
const terrainMenu = document.getElementById('terrainMenu');
let terrainMenuHexId = null;
terrainMenu.innerHTML = Object.keys(TYPES).map((k) =>
  '<button data-terrain="' + k + '"><span class="swatch" style="background:var(--' + k + ')"></span>' +
  TYPES[k].label + ' (' + TYPES[k].mp + ' MP)</button>'
).join('');

function closeTerrainMenu() { terrainMenu.hidden = true; terrainMenuHexId = null; }
function openTerrainMenu(id, x, y) {
  terrainMenuHexId = id;
  terrainMenu.style.left = Math.min(x, innerWidth - 190) + 'px';
  terrainMenu.style.top = Math.min(y, innerHeight - 220) + 'px';
  terrainMenu.hidden = false;
}

function setHexTerrain(id, terrain) {
  const poly = document.querySelector('polygon.hex[data-id="' + id + '"]');
  if (!poly || poly.dataset.terrain === terrain) return;
  poly.classList.remove('hex-' + poly.dataset.terrain);
  poly.classList.add('hex-' + terrain);
  poly.dataset.terrain = terrain;
  poly.dataset.mp = TYPES[terrain].mp;
  const mpText = document.querySelector('text.mp[data-id="' + id + '"]');
  if (mpText) mpText.textContent = TYPES[terrain].mp;
  renderLegend();
  dirty = true;
  setStatus('non enregistré', 'dirty');
}

terrainMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-terrain]');
  if (btn && terrainMenuHexId) setHexTerrain(terrainMenuHexId, btn.dataset.terrain);
  closeTerrainMenu();
});
document.addEventListener('click', (e) => {
  if (!terrainMenu.hidden && !terrainMenu.contains(e.target)) closeTerrainMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTerrainMenu(); });
viewport.addEventListener('wheel', closeTerrainMenu, { passive: true });

document.getElementById('exportJson').addEventListener('click', () => {
  const value = [...removedHexes].sort().join(',');
  window.prompt(
    'A copier dans public/modules/arnhem/arnhem.json, clé "map.removedHexes" (Ctrl+C puis Entrée) :',
    value
  );
});

async function save() {
  const artifact = await claude.use('artifact');
  if (!artifact) { setStatus('indisponible', 'err'); return; }
  setStatus('enregistrement...', 'dirty');
  roadsData.textContent = JSON.stringify([...roads].sort());
  trailsData.textContent = JSON.stringify([...trails].sort());
  riversData.textContent = JSON.stringify([...rivers].sort());
  streamsData.textContent = JSON.stringify([...streams].sort());
  removedData.textContent = JSON.stringify([...removedHexes].sort());
  try {
    await artifact.publish('<!doctype html>\\n' + document.documentElement.outerHTML);
    dirty = false;
    setStatus('à jour');
  } catch (err) {
    setStatus('échec (' + (err && err.code || 'erreur') + ')', 'err');
  }
}
document.getElementById('save').addEventListener('click', save);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
</script>
`

const outPath = process.argv[2] || 'terrain-artifact.html'
writeFileSync(outPath, html)
console.log('Wrote', outPath, (html.length / 1024 / 1024).toFixed(2), 'MB')
