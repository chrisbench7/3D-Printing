# CLAUDE.md

> First stop for any Claude session or engineer picking up this repo.
> The full plan lives in [`docs/SPEC.md`](docs/SPEC.md) (repo copy of the living spec doc: https://claude.ai/code/artifact/f3f33ad0-6882-4249-b930-b3d6641ba127).

## Status

Spec only — no code yet. **Next: Phase 0 spike** (does a nested plate survive import into SprintRay RayWare, measured printer profiles, packing baseline vs. RayWare's own auto-arrange). Nothing after Phase 0 gets built until its gate passes.

| Phase | Scope | Status |
|---|---|---|
| 0 | RayWare handoff spike + printer profiles | ⚪ Not started |
| 1 | 2D plate nesting MVP (Mode A) | ⚪ |
| 2 | Orientation-aware packing (Mode B) | ⚪ |
| 3 | 2D photo smile design | ⚪ |
| 4 | Saved cases, plate sheets, model labels | ⚪ |
| 5 | 3D smile design — additive mockup model | ⚪ Blocked on regulatory review |

## What this is

A browser-only app that nests dental STLs (occlusal guards, surgical guides, models, temporaries, smile-design mockups) onto SprintRay DLP build plates, then hands the plate to RayWare, which keeps doing supports and slicing. Smile design comes in two stages: 2D on patient photos first, 3D on the scan later.

## Hard rules

- **Rigid moves only.** Parts are rotated and translated, never scaled, mirrored or remeshed. Store one 4×4 matrix per part; export must verify volume and triangle count against the original and block on mismatch.
- **No PHI leaves the browser.** Scans, photos and file names are never uploaded, logged remotely, or sent in error reports/analytics. Persisted cases are AES-GCM encrypted in IndexedDB (Phase 4+); Phases 1–3 keep everything in memory.
- **Never auto-repair a surgical guide.** Mesh repair only runs after explicit user confirmation, and never on guides.
- **One resin per plate.** Group parts by material before packing.
- **Print prep, not design.** The app nests surgical guides and temporaries; it does not design them. Don't add restoration or guide design, and don't write diagnosis / treatment-planning language in UI or copy, without Chris's sign-off (see SPEC → Privacy and regulatory).
- **Supports and slicing stay in RayWare.** The nester only reserves a support margin around supported parts.

## Stack

TypeScript + Vite static SPA, no UI framework (plain TS DOM modules), no backend. three.js for viewing and STL/OBJ/PLY I/O; manifold-3d (WASM) for booleans; Clipper2 (clipper2-js) for 2D footprints and no-fit polygons; SVGnest / deepnest-next as the nesting reference (MIT — keep attribution); MediaPipe Face Landmarker for 2D smile landmarks; Vitest with golden STL fixtures. All heavy geometry runs in Web Workers.

**License rule:** permissive licenses only (MIT / Apache-2.0 / Boost / BSD). Don't bundle LGPL/GPL code (e.g. libnest2d, opencascade.js) without asking.

## Conventions

- Printer profiles are data (JSON: plate X/Y, max Z, edge keep-out, pixel pitch) — never hardcode plate sizes. Current numbers in SPEC are unverified until Phase 0 measures them.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(nest): …`, `fix(export): …`, `docs: …`).
- Keep `docs/SPEC.md` in sync with the spec doc when either changes, and update the status table above when a phase moves.
