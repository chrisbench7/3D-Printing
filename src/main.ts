import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  bounds, boxesOverlapXY, isWatertight, placementIssues, plateRect, triangleCount, volume,
  type Bounds, type Origin, type PlacementIssue,
} from './geometry';
import { PRINTERS, type Printer } from './printers';
import { TEST_PLATES } from './testplates';

interface Part {
  name: string;
  mesh: THREE.Mesh;
  bounds: Bounds;
  triangles: number;
  volume: number;
  watertight: boolean;
  color: string;
}

const PALETTE = ['#2f6fdb', '#e07a1f', '#2e9d5b', '#c2417a', '#7a57d1', '#1f9fb0', '#b08a1f', '#d14b4b'];
const USER_FILES = '__user__';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const plateSelect = $<HTMLSelectElement>('#plate-select');
const printerSelect = $<HTMLSelectElement>('#printer-select');
const fileInput = $<HTMLInputElement>('#file-input');
const stage = $<HTMLElement>('#stage');
const tbody = $<HTMLTableSectionElement>('#parts tbody');
const summary = $<HTMLParagraphElement>('#summary');

// ---------- scene ----------

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(-120, -160, 300);
scene.add(sun);

const plateGroup = new THREE.Group();
const partGroup = new THREE.Group();
scene.add(plateGroup, partGroup);

const persp = new THREE.PerspectiveCamera(40, 1, 1, 5000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
let camera: THREE.Camera = ortho;
let controls = new OrbitControls(camera, renderer.domElement);

const state = {
  printer: PRINTERS[0] as Printer,
  origin: 'corner' as Origin,
  view: 'top' as 'top' | '3d',
  parts: [] as Part[],
  loadToken: 0,
};

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function label(text: string, pos: THREE.Vector3, cls = 'label'): CSS2DObject {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.copy(pos);
  return obj;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
    if (o instanceof CSS2DObject) o.element.remove();
  });
  g.clear();
}

function drawPlate() {
  disposeGroup(plateGroup);
  const r = plateRect(state.printer, state.origin);
  const [x0, y0] = r.min, [x1, y1] = r.max;
  const w = x1 - x0, h = y1 - y0;

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: css('--panel'), transparent: true, opacity: 0.9 }),
  );
  surface.position.set(x0 + w / 2, y0 + h / 2, -0.05);
  plateGroup.add(surface);

  const grid: number[] = [];
  for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) grid.push(x, y0, 0, x, y1, 0);
  for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) grid.push(x0, y, 0, x1, y, 0);
  const gridGeom = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
  plateGroup.add(new THREE.LineSegments(gridGeom, new THREE.LineBasicMaterial({ color: css('--line') })));

  const border = new THREE.BufferGeometry().setFromPoints(
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => new THREE.Vector3(x, y, 0.01)),
  );
  plateGroup.add(new THREE.Line(border, new THREE.LineBasicMaterial({ color: css('--muted') })));

  const axisLen = Math.min(w, h) * 0.18;
  const axes: [THREE.Vector3, string, string][] = [
    [new THREE.Vector3(1, 0, 0), '#d14b4b', 'X'],
    [new THREE.Vector3(0, 1, 0), '#2e9d5b', 'Y'],
  ];
  for (const [dir, color, name] of axes) {
    plateGroup.add(new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0.02), axisLen, color, 4, 3));
    plateGroup.add(label(name, dir.clone().multiplyScalar(axisLen + 5), 'label axis'));
  }
  plateGroup.add(label('0,0', new THREE.Vector3(-4, -4, 0), 'label axis'));
  plateGroup.add(label(`${state.printer.name} · ${w} × ${h} mm`, new THREE.Vector3(x0 + w / 2, y1 + 6, 0), 'label axis'));
}

// ---------- parts ----------

const loader = new STLLoader();

function makePart(name: string, buffer: ArrayBuffer, index: number): Part {
  const geom = loader.parse(buffer);
  const pos = geom.getAttribute('position').array;
  const color = PALETTE[index % PALETTE.length];
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
  );
  return { name, mesh, bounds: bounds(pos), triangles: triangleCount(pos), volume: volume(pos), watertight: isWatertight(pos), color };
}

async function loadParts(files: { name: string; data: () => Promise<ArrayBuffer> }[]) {
  const token = ++state.loadToken;
  summary.textContent = `Loading ${files.length} file${files.length === 1 ? '' : 's'}…`;
  const parts: Part[] = [];
  for (const [i, f] of files.entries()) {
    try {
      parts.push(makePart(f.name, await f.data(), i));
    } catch (err) {
      console.warn(`Could not read ${f.name}`, err);
    }
    if (token !== state.loadToken) return;
  }
  disposeGroup(partGroup);
  state.parts = parts;
  for (const p of parts) {
    partGroup.add(p.mesh);
    const c = new THREE.Vector3((p.bounds.min[0] + p.bounds.max[0]) / 2, (p.bounds.min[1] + p.bounds.max[1]) / 2, p.bounds.max[2] + 2);
    partGroup.add(label(p.name.replace(/\.stl$/i, ''), c));
  }
  refreshTable();
  frame();
}

const ISSUE_TEXT: Record<PlacementIssue, string> = {
  'off-plate': 'off plate',
  'too-tall': 'too tall',
  'below-plate': 'below plate',
  floating: 'floating',
};

function refreshTable() {
  const fmt = (n: number) => n.toFixed(1);
  const overlaps = new Set<number>();
  state.parts.forEach((a, i) => state.parts.forEach((b, j) => {
    if (i < j && boxesOverlapXY(a.bounds, b.bounds)) { overlaps.add(i); overlaps.add(j); }
  }));

  tbody.replaceChildren();
  let offPlate = 0;
  state.parts.forEach((p, i) => {
    const issues = placementIssues(p.bounds, state.printer, state.origin);
    if (issues.includes('off-plate')) offPlate++;
    const notes: [string, string][] = issues.map((s) => [ISSUE_TEXT[s], s === 'floating' ? 'warn' : 'bad']);
    if (overlaps.has(i)) notes.push(['boxes overlap', 'warn']);
    if (!p.watertight) notes.push(['not closed', 'bad']);
    if (p.volume < 0) notes.push(['inside-out', 'bad']);

    const [sx, sy, sz] = p.bounds.max.map((v, k) => v - p.bounds.min[k]);
    const tr = document.createElement('tr');
    tr.title = `${p.triangles.toLocaleString()} triangles · ${fmt(Math.abs(p.volume) / 1000)} cm³`;
    const cells = [
      `<span class="swatch" style="background:${p.color}"></span>`,
      '', `${fmt(sx)} × ${fmt(sy)} × ${fmt(sz)}`, p.bounds.min.map(fmt).join(', '), '',
    ];
    cells.forEach((html, k) => {
      const td = document.createElement('td');
      if (k === 1) td.textContent = p.name;
      else if (k === 4) {
        if (notes.length === 0) td.innerHTML = '<span class="ok">on plate</span>';
        for (const [text, cls] of notes) {
          const s = document.createElement('span');
          s.className = cls;
          s.textContent = (td.childNodes.length ? ' · ' : '') + text;
          td.appendChild(s);
        }
      } else td.innerHTML = html;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  const n = state.parts.length;
  summary.textContent = n === 0
    ? 'No parts loaded.'
    : `${n} part${n === 1 ? '' : 's'} · ${offPlate ? `${offPlate} off the plate` : 'all inside the plate'} (${state.origin} origin)`;
}

// ---------- camera ----------

function sceneBounds(): THREE.Box3 {
  const box = new THREE.Box3();
  const r = plateRect(state.printer, state.origin);
  box.expandByPoint(new THREE.Vector3(r.min[0], r.min[1], 0));
  box.expandByPoint(new THREE.Vector3(r.max[0], r.max[1], 0));
  box.expandByObject(partGroup);
  return box;
}

function frame() {
  const box = sceneBounds();
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const { clientWidth: w, clientHeight: h } = stage;
  const aspect = w / Math.max(h, 1);

  controls.dispose();
  if (state.view === 'top') {
    const half = Math.max(size.x / 2 / aspect, size.y / 2) * 1.2 + 10;
    Object.assign(ortho, { left: -half * aspect, right: half * aspect, top: half, bottom: -half, zoom: 1 });
    ortho.up.set(0, 1, 0);
    ortho.position.set(center.x, center.y, 1000);
    ortho.lookAt(center.x, center.y, 0);
    ortho.updateProjectionMatrix();
    camera = ortho;
    controls = new OrbitControls(ortho, renderer.domElement);
    controls.enableRotate = false;
  } else {
    persp.aspect = aspect;
    persp.up.set(0, 0, 1);
    const dist = Math.max(size.x, size.y) * 1.3 + 40;
    persp.position.set(center.x - dist * 0.35, center.y - dist * 0.8, dist * 0.7);
    persp.updateProjectionMatrix();
    camera = persp;
    controls = new OrbitControls(persp, renderer.domElement);
  }
  controls.target.set(center.x, center.y, 0);
  controls.update();
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  frame();
}

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// ---------- UI wiring ----------

for (const p of PRINTERS) printerSelect.add(new Option(p.name, p.key));
for (const tp of TEST_PLATES) plateSelect.add(new Option(tp.label, tp.id));
plateSelect.add(new Option('Your files (Open STL files… or drop)', USER_FILES));

function setOrigin(origin: Origin) {
  state.origin = origin;
  (document.querySelector(`input[name=origin][value=${origin}]`) as HTMLInputElement).checked = true;
}

function selectTestPlate(id: string) {
  const tp = TEST_PLATES.find((t) => t.id === id);
  if (!tp) return;
  plateSelect.value = tp.id;
  const printer = PRINTERS.find((p) => p.key === tp.printerKey);
  if (printer) { state.printer = printer; printerSelect.value = printer.key; }
  setOrigin(tp.origin);
  drawPlate();
  void loadParts(tp.files.map((f) => ({ name: f.name, data: () => fetch(f.url).then((r) => r.arrayBuffer()) })));
}

function openFiles(list: FileList | File[]) {
  const files = [...list].filter((f) => /\.stl$/i.test(f.name));
  if (files.length === 0) return;
  plateSelect.value = USER_FILES;
  void loadParts(files.map((f) => ({ name: f.name, data: () => f.arrayBuffer() })));
}

plateSelect.addEventListener('change', () => {
  if (plateSelect.value !== USER_FILES) selectTestPlate(plateSelect.value);
  else fileInput.click();
});
printerSelect.addEventListener('change', () => {
  state.printer = PRINTERS.find((p) => p.key === printerSelect.value) ?? state.printer;
  drawPlate(); refreshTable(); frame();
});
document.querySelectorAll<HTMLInputElement>('input[name=origin]').forEach((el) =>
  el.addEventListener('change', () => { state.origin = el.value as Origin; drawPlate(); refreshTable(); frame(); }));
document.querySelectorAll<HTMLInputElement>('input[name=view]').forEach((el) =>
  el.addEventListener('change', () => { state.view = el.value as 'top' | '3d'; frame(); }));
$<HTMLButtonElement>('#open-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files) openFiles(fileInput.files); fileInput.value = ''; });

window.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) stage.classList.remove('dragging'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('dragging');
  if (e.dataTransfer?.files) openFiles(e.dataTransfer.files);
});
window.addEventListener('resize', resize);

resize();
selectTestPlate(TEST_PLATES.find((t) => t.id === 'sprintray-pro-2/frame-corner/option1-separate')?.id ?? TEST_PLATES[0].id);
