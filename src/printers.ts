import config from '../config/printers.json';
import type { Plate } from './geometry';

export interface Printer extends Plate { key: string; name: string; verified: boolean }

// Profiles without a known plate size are skipped rather than guessed.
export const PRINTERS: Printer[] = Object.entries(config.printers)
  .filter(([, p]) => p.plateX != null && p.plateY != null)
  .map(([key, p]) => ({
    key,
    name: p.name,
    x: p.plateX as number,
    y: p.plateY as number,
    maxZ: p.maxZ,
    verified: p.verified,
  }));
