// Pure mesh checks on non-indexed triangle soups (9 floats per triangle), so they run in
// the browser, in workers later, and headless under Vitest.

export type Vec3 = [number, number, number];
export interface Bounds { min: Vec3; max: Vec3 }
export type Origin = 'corner' | 'center';
export interface Plate { x: number; y: number; maxZ: number | null }

export function triangleCount(pos: ArrayLike<number>): number {
  return Math.floor(pos.length / 9);
}

export function bounds(pos: ArrayLike<number>): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

// Divergence theorem; positive for outward-wound closed meshes.
export function volume(pos: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

// Closed and consistently wound: every directed edge pairs with its reverse exactly once.
// STL stores float32, so vertices are matched on a 1e-4 mm grid rather than exactly.
export function isWatertight(pos: ArrayLike<number>): boolean {
  if (triangleCount(pos) === 0) return false;
  const key = (i: number) =>
    `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t + 8 < pos.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let e = 0; e < 3; e++) {
      const k = `${v[e]}>${v[(e + 1) % 3]}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of edges) {
    const [a, b] = k.split('>');
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}

export function plateRect(plate: Plate, origin: Origin): Bounds {
  const [x0, y0] = origin === 'corner' ? [0, 0] : [-plate.x / 2, -plate.y / 2];
  return { min: [x0, y0, 0], max: [x0 + plate.x, y0 + plate.y, plate.maxZ ?? Infinity] };
}

export type PlacementIssue = 'off-plate' | 'too-tall' | 'below-plate' | 'floating';

// Tolerance absorbs float32 rounding in STL coordinates.
export function placementIssues(b: Bounds, plate: Plate, origin: Origin, tol = 0.01): PlacementIssue[] {
  const r = plateRect(plate, origin);
  const issues: PlacementIssue[] = [];
  if (b.min[0] < r.min[0] - tol || b.min[1] < r.min[1] - tol || b.max[0] > r.max[0] + tol || b.max[1] > r.max[1] + tol) {
    issues.push('off-plate');
  }
  if (b.max[2] > r.max[2] + tol) issues.push('too-tall');
  if (b.min[2] < -tol) issues.push('below-plate');
  else if (b.min[2] > tol) issues.push('floating');
  return issues;
}

export function boxesOverlapXY(a: Bounds, b: Bounds): boolean {
  return a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1];
}
