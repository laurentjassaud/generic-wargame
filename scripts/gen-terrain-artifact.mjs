// Génère un artefact HTML autonome : la carte Arnhem + la grille d'hex colorée
// par type de terrain, avec le coût de mouvement affiché sur chaque hex —
// pour vérification visuelle de public/modules/arnhem/arnhem.json (module.terrain).
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_CALIBRATION } from '../src/lib/calibration.js'

const mod = JSON.parse(readFileSync('public/modules/arnhem/arnhem.json', 'utf8'))
const { imageWidth, imageHeight, cols, rows } = mod.map
const { x0, y0, colStep, a, rowStep } = DEFAULT_CALIBRATION
const b = rowStep / 2
const grid = mod.terrain.grid
const TYPES = mod.terrain.types

const imgBuf = readFileSync('public/modules/arnhem/images/arnhem-map.jpg')
const imgB64 = imgBuf.toString('base64')

const hexes = []
for (let c = 0; c < cols; c++) {
  const cx0 = x0 + c * colStep
  const yoff = c % 2 === 1 ? rowStep / 2 : 0
  for (let r = 1; r <= rows; r++) {
    const cy = y0 + (r - 1) * rowStep + yoff
    const hexId = String(c + 1).padStart(2, '0') + String(r).padStart(2, '0')
    const pts = [
      [cx0 - a, cy], [cx0 - a / 2, cy - b], [cx0 + a / 2, cy - b],
      [cx0 + a, cy], [cx0 + a / 2, cy + b], [cx0 - a / 2, cy + b],
    ].map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
    const terrain = grid[hexId] || 'mixed'
    hexes.push({ id: hexId, cx: cx0, cy, pts, terrain, mp: TYPES[terrain].mp })
  }
}

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
    <button id="reset">recentrer</button>
    <span id="zoomLabel">100%</span>
  </div>
</header>

<main id="viewport">
  <svg id="svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}">
    <image href="data:image/jpeg;base64,${imgB64}" x="0" y="0" width="${imageWidth}" height="${imageHeight}" />
    <g id="hexLayer">
${hexes.map((h) => `      <polygon class="hex hex-${h.terrain}" points="${h.pts}" data-id="${h.id}" data-terrain="${h.terrain}" data-mp="${h.mp}" />`).join('\n')}
    </g>
    <g id="labelLayer">
${hexes.map((h) => `      <text class="mp" x="${h.cx.toFixed(1)}" y="${(h.cy + a * 0.15).toFixed(1)}" font-size="${(a * 0.5).toFixed(1)}">${h.mp}</text><text class="hexid" x="${h.cx.toFixed(1)}" y="${(h.cy - a * 0.32).toFixed(1)}" font-size="${(a * 0.28).toFixed(1)}">${h.id}</text>`).join('\n')}
    </g>
  </svg>
</main>

<footer>
  <span>${hexes.length} hexs</span>
  <span><span class="dot" style="background:var(--manual-dot)"></span>colonie (lecture manuelle des noms de la carte)</span>
  <span><span class="dot" style="background:var(--auto-dot)"></span>terrain (classification automatique par couleur)</span>
  <span>routes / sentiers / rivières / ponts non détectés &mdash; à ajouter</span>
</footer>

<script>
const TYPES = ${JSON.stringify(TYPES)};
const counts = {};
document.querySelectorAll('.hex').forEach(h => { const t = h.dataset.terrain; counts[t] = (counts[t]||0)+1; });
const legend = document.getElementById('legend');
Object.keys(TYPES).forEach(k => {
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.innerHTML = '<span class="swatch" style="background:var(--' + k + ')"></span>' +
    TYPES[k].label + ' <span class="count">' + TYPES[k].mp + 'MP &middot; ' + (counts[k]||0) + '</span>';
  legend.appendChild(chip);
});

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
document.querySelectorAll('text.hexid').forEach(t => t.style.display = 'none');
</script>
`

const outPath = process.argv[2] || 'terrain-artifact.html'
writeFileSync(outPath, html)
console.log('Wrote', outPath, (html.length / 1024 / 1024).toFixed(2), 'MB')
