# Phase 0 — RayWare handoff test plates

Synthetic, PHI-free test parts that answer the spec's go/no-go question: **does a nested plate survive import into RayWare?** Nothing here needs printing — every test is import-and-look (plus one optional print).

Regenerate with `node tools/phase0/generate.mjs` (no dependencies). Plate sizes come from [`config/printers.json`](../config/printers.json) and are **unverified**; test 3 measures them. Expected coordinates for every part are in [`manifest.json`](manifest.json).

## What's here

| Folder | Contents |
|---|---|
| `<printer>/frame-corner/` | 5-part plate with coordinates where the plate spans `0..X, 0..Y` (origin at a corner) |
| `<printer>/frame-center/` | Same plate, coordinates spanning `-X/2..X/2, -Y/2..Y/2` (origin at plate center) |
| `…/option1-separate/` | One STL per part, all in the shared plate frame (spec export option 1) |
| `…/option2-merged/` | The same 5 parts as one multi-shell STL (spec export option 2) |
| `<printer>/probes/` | 1 mm slabs at 98 / 100 / 102 % of the listed plate size |
| `density-set/` | 10 arch stand-ins + 20 crown stand-ins, all at the origin, for RayWare's auto-arrange |

We don't know whether RayWare's origin is a plate corner or the plate center, so both frames are provided; whichever frame lands its parts where the layout diagram says is RayWare's frame.

**The 5-part layout** (identify parts by height and shape):

```
 far corner (X,Y)                                 P3 crown, 8 mm
   ┌───────────────────────────────────────────────────┐
   │   P4 thin arch, tilted 45°,                       │
   │      floating 5 mm up                             │
   │                   P2 arch, 12 mm,                 │
   │                      spun 30°          P5 L, 5 mm,│
   │ P1 L, 3 mm                             spun 90°   │
   └───────────────────────────────────────────────────┘
 origin corner (0,0)
```

P1 and P5 are an asymmetric L: seen from above, a mirrored import reads as a **J**.

## Tests — run on each printer you have (Pro 2 first)

Start each test from an empty RayWare job. Don't let RayWare auto-orient or auto-arrange unless the step says so; note any prompts it shows.

1. **Separate files keep positions? (option 1)**
   Import all 5 files from `frame-corner/option1-separate/` in one go. Then a fresh job with `frame-center/option1-separate/`.
   Record for each part: where it landed vs. the diagram, rotation kept (P2 at 30°, P5 at 90°), L not mirrored, and whether P4 stayed tilted and floating or was dropped to the plate. Screenshot the top view.
2. **Merged file keeps positions? (option 2)**
   Import `option2-merged/plate_merged.stl` from whichever frame matched in test 1. Record: does it land in place; can RayWare split it into 5 parts; does auto-support treat each shell separately (supports on P4 only, none under the flat parts)?
3. **Build area.**
   Import each probe separately. Record which ones RayWare accepts without an out-of-bounds warning. If 100 % is accepted and 102 % is not, the listed plate size is about right; otherwise write down the largest size accepted (RayWare's dimension readout, if shown).
4. **Packing baseline.**
   Import all of `density-set/`, run RayWare's auto-arrange, and count how many arches and crowns it fits on one plate (and how many plates it uses). Screenshot the result. This is the number the Phase 1 nester has to beat.
5. **Round trip (optional).** Save the test-1 job as `.SPR`, reopen it, and check that the positions held.

## Results

Copy this table into a comment or commit it back with screenshots in `phase0/results/`.

| Test | Pro 2 | Pro 95 S | Notes |
|---|---|---|---|
| 1 · separate, corner frame — positions kept? | | | |
| 1 · separate, center frame — positions kept? | | | |
| 1 · rotation kept / not mirrored / P4 kept floating? | | | |
| 2 · merged — lands in place? splits into parts? per-shell supports? | | | |
| 3 · largest probe accepted | | | |
| 4 · auto-arrange: arches / crowns per plate | | | |
| 5 · .SPR round trip | | | |
| RayWare version | | | |

**Gate (from the spec):** Phase 1 proceeds if test 1 or test 2 keeps the layout and test 3 gives measured plate sizes. If both lose the layout, the only remaining route is export option 3, a .SPR integration with SprintRay's cooperation.
