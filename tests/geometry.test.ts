import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { bounds, isWatertight, placementIssues, volume } from '../src/geometry';

const manifest = JSON.parse(readFileSync(join(__dirname, '../phase0/manifest.json'), 'utf8'));
const load = (rel: string) => {
  const buf = readFileSync(join(__dirname, '../phase0', rel));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new STLLoader().parse(ab).getAttribute('position').array;
};

// A unit cube, outward-wound, as a triangle soup.
const cube = (() => {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return new Float32Array(f.flatMap((t) => t.flatMap((i) => v[i])));
})();

describe('geometry', () => {
  it('measures a closed cube', () => {
    expect(isWatertight(cube)).toBe(true);
    expect(volume(cube)).toBeCloseTo(1, 6);
    expect(bounds(cube)).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });

  it('rejects an open mesh', () => {
    expect(isWatertight(cube.slice(0, cube.length - 9))).toBe(false);
  });

  it('flags placement against a corner-origin plate', () => {
    const plate = { x: 100, y: 50, maxZ: 20 };
    expect(placementIssues({ min: [1, 1, 0], max: [10, 10, 5] }, plate, 'corner')).toEqual([]);
    expect(placementIssues({ min: [95, 1, 0], max: [105, 10, 5] }, plate, 'corner')).toEqual(['off-plate']);
    expect(placementIssues({ min: [1, 1, 5], max: [10, 10, 25] }, plate, 'corner')).toEqual(['too-tall', 'floating']);
    expect(placementIssues({ min: [1, 1, 0], max: [10, 10, 5] }, plate, 'center')).toEqual([]);
    expect(placementIssues({ min: [-60, 0, 0], max: [-40, 10, 5] }, plate, 'center')).toEqual(['off-plate']);
  });
});

describe('phase0 plates', () => {
  for (const [key, printer] of Object.entries<any>(manifest.printers)) {
    for (const [frame, plate] of Object.entries<any>(printer.plates)) {
      const base = `${key}/frame-${frame}`;
      it(`${base}: parts match the manifest, are closed and sit where expected`, () => {
        const [X, Y, Z] = printer.plate;
        for (const part of plate.parts) {
          const pos = load(`${base}/${part.file}`);
          const b = bounds(pos);
          expect(isWatertight(pos)).toBe(true);
          expect(volume(pos)).toBeGreaterThan(0);
          b.min.forEach((v, k) => expect(v).toBeCloseTo(part.bboxMin[k], 1));
          b.max.forEach((v, k) => expect(v).toBeCloseTo(part.bboxMax[k], 1));
          const issues = placementIssues(b, { x: X, y: Y, maxZ: Z }, frame as 'corner' | 'center');
          expect(issues).toEqual(part.tiltX ? ['floating'] : []);
        }
      });
    }
  }
});
