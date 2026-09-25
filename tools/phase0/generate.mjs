// Phase 0 test-plate generator. Writes synthetic, PHI-free STLs used to check
// how RayWare treats part positions on import. No dependencies: `node tools/phase0/generate.mjs`.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'phase0');
const printers = JSON.parse(readFileSync(join(ROOT, 'config', 'printers.json'), 'utf8')).printers;

// ---------- 2D shapes (CCW polygons, mm) ----------

// Asymmetric L: a mirrored import reads as a "J", so mirroring is visible at a glance.
const lShape = () => [[0, 0], [20, 0], [20, 6], [6, 6], [6, 14], [0, 14]];

const ngon = (r, n) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return [r * Math.cos(a), r * Math.sin(a)];
});

// Horseshoe standing in for a full-arch footprint; opening faces -Y.
function horseshoe(outer, inner, segs = 24, a0 = -15, a1 = 195) {
  const rad = (d) => (d * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = rad(a0 + ((a1 - a0) * i) / segs);
    pts.push([outer * Math.cos(a), outer * Math.sin(a)]);
  }
  for (let i = segs; i >= 0; i--) {
    const a = rad(a0 + ((a1 - a0) * i) / segs);
    pts.push([inner * Math.cos(a), inner * Math.sin(a)]);
  }
  return pts;
}

// ---------- mesh building ----------

function signedArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

// Ear clipping for a simple CCW polygon; returns index triples.
function triangulate(p) {
  const idx = p.map((_, i) => i);
  const tris = [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (pt, a, b, c) => cross(a, b, pt) >= 0 && cross(b, c, pt) >= 0 && cross(c, a, pt) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = p[ia], b = p[ib], c = p[ic];
      if (cross(a, b, c) <= 0) continue;
      const blocked = idx.some((j) => j !== ia && j !== ib && j !== ic && inside(p[j], a, b, c));
      if (blocked) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('triangulation failed (polygon not simple/CCW?)');
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// Closed prism: polygon extruded from z=0 to z=h. Triangles as [[x,y,z]x3], outward winding.
function prism(poly, h) {
  if (signedArea(poly) <= 0) throw new Error('polygon must be CCW');
  const tris = [];
  for (const [a, b, c] of triangulate(poly)) {
    tris.push([[...poly[a], h], [...poly[b], h], [...poly[c], h]]);
    tris.push([[...poly[a], 0], [...poly[c], 0], [...poly[b], 0]]);
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    tris.push([[...a, 0], [...b, 0], [...b, h]]);
    tris.push([[...a, 0], [...b, h], [...a, h]]);
  }
  return tris;
}

// Every directed edge must pair with its reverse exactly once.
function assertWatertight(tris, label) {
  const key = (v) => v.map((n) => n.toFixed(6)).join(',');
  const edges = new Map();
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const e = key(t[i]) + '>' + key(t[(i + 1) % 3]);
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  for (const [e, n] of edges) {
    const [a, b] = e.split('>');
    if (n !== 1 || edges.get(b + '>' + a) !== 1) throw new Error(`${label}: not watertight at ${e}`);
  }
}

function volume(tris) {
  let v = 0;
  for (const [a, b, c] of tris) {
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

const rotZ = (deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return ([x, y, z]) => [c * x - s * y, s * x + c * y, z];
};
const rotX = (deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return ([x, y, z]) => [x, c * y - s * z, s * y + c * z];
};
const mapTris = (tris, f) => tris.map((t) => t.map(f));

function bbox(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], v[i]);
    max[i] = Math.max(max[i], v[i]);
  }
  return { min, max };
}

// Rotate (tilt about X, then spin about Z), then translate so the bbox min lands on `at`.
function place(tris, { spin = 0, tilt = 0, at = [0, 0, 0] }) {
  let t = mapTris(tris, rotX(tilt));
  t = mapTris(t, rotZ(spin));
  const { min } = bbox(t);
  return mapTris(t, ([x, y, z]) => [x - min[0] + at[0], y - min[1] + at[1], z - min[2] + at[2]]);
}

function stlBinary(tris, name) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write(`phase0 ${name}`.slice(0, 79), 0, 'ascii');
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    for (const x of [...n.map((q) => q / len), ...a, ...b, ...c]) { buf.writeFloatLE(x, o); o += 4; }
    buf.writeUInt16LE(0, o); o += 2;
  }
  return buf;
}

const round = (v) => v.map((n) => Math.round(n * 100) / 100);

function write(path, tris, label) {
  assertWatertight(tris, label);
  if (volume(tris) <= 0) throw new Error(`${label}: inverted (negative volume)`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stlBinary(tris, label));
}

// ---------- part library ----------
// Heights differ per part so each can be identified by height alone in RayWare.

const PARTS = {
  L3: { desc: 'L-block, 3 mm tall (mirror check: must read as L, not J, from above)', mesh: () => prism(lShape(), 3) },
  L5: { desc: 'L-block, 5 mm tall', mesh: () => prism(lShape(), 5) },
  ARCH12: { desc: 'Arch-shaped model stand-in, 12 mm tall', mesh: () => prism(horseshoe(30, 18), 12) },
  CROWN8: { desc: 'Octagonal crown stand-in, 8 mm tall', mesh: () => prism(ngon(5, 8), 8) },
  GUARD3: { desc: 'Thin arch (guard stand-in), 3 mm, tilted 45°, floating 5 mm above the plate', mesh: () => prism(horseshoe(28, 22), 3) },
};

// Layout expressed in plate-corner coordinates as fractions of the plate, so it scales per printer.
function layout(X, Y) {
  return [
    { id: 'P1', part: 'L3', spin: 0, at: [5, 5, 0], why: 'near the X0/Y0 corner — reveals origin placement' },
    { id: 'P2', part: 'ARCH12', spin: 30, at: [X * 0.4, Y * 0.2, 0], why: 'rotated 30° about Z — reveals rotation kept or reset' },
    { id: 'P3', part: 'CROWN8', spin: 0, at: [X - 15, Y - 15, 0], why: 'near the far corner — with P1, reveals scaling/recentering' },
    { id: 'P4', part: 'GUARD3', spin: 0, tilt: 45, at: [X * 0.08, Y * 0.55, 5], why: 'tilted + floating — reveals whether Z is dropped to the plate' },
    { id: 'P5', part: 'L5', spin: 90, at: [X * 0.78, Y * 0.1, 0], why: 'rotated 90° — second rotation check' },
  ];
}

// ---------- generate ----------

// Only clear generated output; README.md and results/ in phase0/ are hand-written.
for (const d of [...Object.keys(printers), 'density-set', 'manifest.json']) rmSync(join(OUT, d), { recursive: true, force: true });
const manifest = { generated: new Date().toISOString().slice(0, 10), units: 'mm', printers: {} };

for (const [key, pr] of Object.entries(printers)) {
  if (!pr.plateX || !pr.plateY) continue;
  const X = pr.plateX, Y = pr.plateY;
  const entry = { name: pr.name, plate: [X, Y, pr.maxZ], plates: {} };

  for (const frame of ['corner', 'center']) {
    // corner: plate spans 0..X, 0..Y. center: plate spans -X/2..X/2, -Y/2..Y/2.
    const off = frame === 'corner' ? [0, 0, 0] : [-X / 2, -Y / 2, 0];
    const dir = join(OUT, key, `frame-${frame}`);
    const merged = [];
    const parts = [];
    for (const p of layout(X, Y)) {
      const at = [p.at[0] + off[0], p.at[1] + off[1], p.at[2]];
      const tris = place(PARTS[p.part].mesh(), { spin: p.spin, tilt: p.tilt || 0, at });
      const file = `option1-separate/${p.id}_${p.part}.stl`;
      write(join(dir, file), tris, `${key} ${frame} ${p.id}`);
      merged.push(...tris);
      const { min, max } = bbox(tris);
      const { max: fMax } = bbox(place(PARTS[p.part].mesh(), { spin: p.spin, tilt: p.tilt || 0 }));
      if (p.at[0] + fMax[0] > X || p.at[1] + fMax[1] > Y) throw new Error(`${key} ${p.id} off plate`);
      parts.push({ id: p.id, part: p.part, desc: PARTS[p.part].desc, spinZ: p.spin, tiltX: p.tilt || 0, bboxMin: round(min), bboxMax: round(max), checks: p.why, file });
    }
    write(join(dir, 'option2-merged/plate_merged.stl'), merged, `${key} ${frame} merged`);
    entry.plates[frame] = { plateSpans: frame === 'corner' ? [[0, X], [0, Y]] : [[-X / 2, X / 2], [-Y / 2, Y / 2]], parts, merged: 'option2-merged/plate_merged.stl' };
  }

  // Build-area probes: 1 mm slabs at 98 / 100 / 102 % of the listed plate, centered at the origin.
  entry.probes = [];
  for (const pct of [98, 100, 102]) {
    const w = (X * pct) / 100, d = (Y * pct) / 100;
    const tris = place(prism([[0, 0], [w, 0], [w, d], [0, d]], 1), { at: [-w / 2, -d / 2, 0] });
    const file = `probes/probe_${pct}pct_${w.toFixed(1)}x${d.toFixed(1)}.stl`;
    write(join(OUT, key, file), tris, `${key} probe ${pct}`);
    entry.probes.push({ pct, size: [round([w])[0], round([d])[0], 1], file });
  }
  manifest.printers[key] = entry;
}

// Density set: loose parts at the origin for RayWare's own auto-arrange (the packing baseline).
const density = { arches: 10, crowns: 20 };
for (let i = 1; i <= density.arches; i++) {
  write(join(OUT, 'density-set', `arch_${String(i).padStart(2, '0')}.stl`), place(PARTS.ARCH12.mesh(), {}), `arch ${i}`);
}
for (let i = 1; i <= density.crowns; i++) {
  write(join(OUT, 'density-set', `crown_${String(i).padStart(2, '0')}.stl`), place(PARTS.CROWN8.mesh(), {}), `crown ${i}`);
}
manifest.densitySet = { ...density, archFootprintMm: round(bbox(place(PARTS.ARCH12.mesh(), {})).max), crownFootprintMm: round(bbox(place(PARTS.CROWN8.mesh(), {})).max) };

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${OUT}`);
