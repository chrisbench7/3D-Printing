import type { Origin } from './geometry';

// Phase 0 plates bundled into the build, so the viewer works with no files on hand.
const urls = import.meta.glob('../phase0/**/*.stl', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface TestPlate {
  id: string;
  label: string;
  printerKey: string | null;
  origin: Origin;
  files: { name: string; url: string }[];
}

const PRINTER_LABELS: Record<string, string> = {
  'sprintray-pro-2': 'Pro 2',
  'sprintray-pro-95s': 'Pro 95 S',
};

function describe(id: string): Omit<TestPlate, 'files'> {
  const [printer, frame, option] = id.split('/');
  if (printer === 'density-set') {
    return { id, label: 'Density set · loose parts at the origin', printerKey: null, origin: 'center' };
  }
  const p = PRINTER_LABELS[printer] ?? printer;
  if (frame === 'probes') return { id, label: `${p} · build-area probes`, printerKey: printer, origin: 'center' };
  const origin: Origin = frame === 'frame-center' ? 'center' : 'corner';
  const opt = option === 'option2-merged' ? 'merged file' : 'separate files';
  return { id, label: `${p} · ${origin} origin · ${opt}`, printerKey: printer, origin };
}

export const TEST_PLATES: TestPlate[] = (() => {
  const groups = new Map<string, { name: string; url: string }[]>();
  for (const [path, url] of Object.entries(urls)) {
    const rel = path.replace(/^\.\.\/phase0\//, '');
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push({ name, url });
  }
  return [...groups.entries()]
    .map(([id, files]) => ({ ...describe(id), files: files.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
})();
