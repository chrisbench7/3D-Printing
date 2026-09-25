# Dental STL Nesting & Smile Design — Spec

As of 2026-09-25 · Chris

> Repo copy of the living spec doc: https://claude.ai/code/artifact/f3f33ad0-6882-4249-b930-b3d6641ba127
> Comments and edits happen in the doc; re-sync this file when it changes.

Build a browser-only app that packs dental STLs onto SprintRay build plates and hands the plate to RayWare for supports and slicing. Ship 2D plate nesting first, then orientation-aware 3D packing, then 2D photo smile design, with 3D smile design last. Most of the regulatory and engineering risk sits in 3D design.

## Workflows

The app arranges parts that have already been designed. It never changes their shape, scale or fit surfaces. Each workflow gives the nester different rules, so every imported part is tagged with a part type on import. The tag is inferred from the file name and size, and the user can confirm or change it.

| Part type | Comes from | How it sits on a DLP plate | What nesting must protect |
| --- | --- | --- | --- |
| Occlusal guard | Guard design (3Shape, exocad, SprintRay AI design) | Tilted 30–90° on supports | Intaglio (fit) surface kept support-free; spacing so supports do not merge |
| Surgical guide | Implant planning software | Tilted on supports | Intaglio and sleeve/drill channels support-free; no scaling, ever |
| Model | Intraoral scan via a model builder | Flat on the platform (hollow, drain holes), or standing on edge for throughput | Base flat against the plate; largest footprints, so they drive plate utilization |
| Temporary (crown/bridge) | Restoration design | Tilted on supports | Margins support-free; many small parts, so grouping and labels matter |
| Smile-design mockup | This app (phase 5) | Same as model or temporary | Same rules as the part it becomes |

Supports and slicing stay in RayWare (see SprintRay targets). The nester only reserves room for them: each supported part's footprint is grown by a support margin before packing.

## SprintRay targets

Target the large-plate DLP printers (Pro 2 and Pro 95 S) first, since that is where batching many parts pays off. Midas is out of scope because it prints one restoration per resin capsule, so there is nothing to nest.

| Printer | Build volume (approximate, to verify) | Nesting target |
| --- | --- | --- |
| Pro 2 | ~188 × 105 × 200 mm | Yes, primary (current model, launched May 2024) |
| Pro 95 S | ~182 × 102 × 200 mm | Yes |
| Pro 55 S | Published listings conflict; confirm from SprintRay's spec sheet | Yes (smaller plate) |
| Midas | ~15 mm diameter × 20 mm per capsule | No |

These figures come from search listings. sprintray.com could not be opened from the environment that wrote this spec, so treat every number as unverified. Printer profiles live in a JSON config (plate X/Y, max Z, edge keep-out, pixel pitch). Fixing a number or adding a printer is then a data change, and Phase 0 checks each profile by measuring a real plate.

**Getting a nested plate into RayWare is the biggest feasibility risk.** RayWare imports STL and OBJ, and it saves complete jobs (models, layout and supports) in its own .SPR container. From public material, it is unclear whether RayWare keeps the coordinates of imported STLs or re-centers and auto-arranges them. If it re-arranges them, the layout is lost at the handoff. Export options, in the order to test:

1. **One STL per part, sharing a plate coordinate frame.** This is the cleanest route if RayWare keeps coordinates when several files are imported together.
2. **One merged STL per plate.** Positions are guaranteed. The test is whether RayWare supports each separate shell correctly and whether per-part settings are lost.
3. **Write .SPR directly.** It is an undocumented proprietary format, so only attempt this with SprintRay's cooperation. Ask SprintRay about a partner integration (an API or a published .SPR spec) in parallel with the spike.

RayWare already auto-arranges and auto-supports parts. The Phase 0 spike should therefore also count how many parts RayWare fits per plate against this nester, part type by part type. That gap is the product's reason to exist, and it should be measured before Phase 1 is funded.

## Architecture and stack

The app is a static TypeScript + Vite single-page app in this repo. Every mesh operation runs in Web Workers inside the browser, so scans never leave the machine and there is no backend holding PHI. Hosting is static files only.

Each part goes through this pipeline:

1. **Import.** STL (binary and ASCII), OBJ and PLY are parsed in a worker. Units are assumed to be mm, and a part is flagged when its size suggests inches or a corrupt file.
2. **Check.** The worker tests for a watertight, manifold mesh and records shell count, volume and bounds. Problems are reported, never fixed silently: a repair runs only after the user confirms, and surgical guides are never auto-repaired.
3. **Tag.** The part type (guard, guide, model, temporary or mockup) is guessed from the file name and size, and the user confirms it.
4. **Orient.** Rules depend on the part type: models sit on a flat base, supported parts tilt within a set angle range, and fit surfaces face away from the supports. The user can override with a rotate gizmo.
5. **Footprint.** The oriented mesh is projected onto the plate as an outline polygon (a Clipper2 union of projected triangles, then simplified). The outline is grown by part spacing plus a support margin.
6. **Nest.** The packing engine runs in a worker across one or more plates (see Nesting engine).
7. **Validate.** Every part must sit inside the plate minus its edge keep-out, overlap nothing, and fit under the maximum Z.
8. **Export.** Output follows whichever RayWare handoff the Phase 0 spike proves out. A printable plate sheet listing case IDs by position goes with it.

| Concern | Choice | License | Why |
| --- | --- | --- | --- |
| Language and build | TypeScript + Vite | MIT | Typed geometry code; bundles WASM modules and workers cleanly |
| 3D view and file I/O | [three.js](https://github.com/mrdoob/three.js) (STL/OBJ/PLY loaders, STL exporter, transform gizmo) | MIT | Standard WebGL toolkit |
| Mesh booleans, repair, offsets | [manifold-3d](https://github.com/elalish/manifold) (WASM) | Apache-2.0 | Robust booleans for labels, hollowing and smile-design mockups |
| 2D polygons | [Clipper2](https://github.com/AngusJohnson/Clipper2) (clipper2-js port) | Boost | Footprint union, offsets and no-fit-polygon building blocks |
| Nesting reference | [SVGnest](https://github.com/Jack000/SVGnest), [deepnest-next](https://github.com/deepnest-next/deepnest) | MIT | Proven no-fit-polygon + genetic-algorithm design to port from, with attribution |
| Face landmarks (2D smile design) | MediaPipe Tasks Vision, Face Landmarker | Apache-2.0 | Runs in the browser; places the midline, pupils and lip line automatically |
| UI | Plain TypeScript DOM modules, no framework | — | Per the stack decision; revisit if the UI outgrows it |
| Local storage | IndexedDB + WebCrypto AES-GCM | Built in | Same at-rest encryption pattern as Sugarbot Notes |
| Tests | Vitest + golden STL fixtures | MIT | Nesting and validation run headless in Node |

Avoid [libnest2d](https://github.com/tamasmeszaros/libnest2d) (LGPL-3.0), because bundling it into a shipped web app brings relinking obligations. Also avoid opencascade.js (LGPL-2.1): nothing here needs CAD kernels or STEP files. Full-arch models can run to hundreds of thousands of triangles. Footprints are therefore computed on decimated copies, while exports always write the original, untouched mesh.

## Nesting engine

The engine has two modes, but on a SprintRay the "3D" mode means something narrower than general 3D packing. A DLP printer anchors every part to the build platform, so parts cannot float or stack. The real 3D problem is picking each part's orientation so more fit on the plate under a Z limit.

**Rules both modes share**

- **Rigid moves only.** A part is only ever rotated and translated, stored as one 4×4 matrix per part. It is never scaled, mirrored or remeshed. After export, the volume and triangle count are checked against the original, and any mismatch blocks the export.
- **Batch by resin first.** One plate holds one resin, and guards, guides, models and temporaries use different resins. Parts are grouped by material before packing.
- **Pack true outlines, not bounding boxes.** Full-arch parts are U-shaped, so temporaries can sit inside the curve of a model or guard. Bounding-box packing wastes that space.
- **The user can take over.** Parts can be dragged and rotated on the plate with a live collision check. Locked parts stay put when the rest is re-nested.

**Mode A: 2D plate layout (Phase 1)**

- **Input:** footprint polygons, allowed rotations about Z (configurable per part type), the plate minus its edge keep-out, and a priority per part (due date or case).
- **Algorithm:** bottom-left placement driven by no-fit polygons against the plate's inner-fit polygon. A genetic algorithm searches part order and rotation, following the SVGnest design. Fitness ranks plates used first, then utilization, then compactness toward one corner.
- **Responsiveness:** a greedy big-parts-first layout appears at once. The genetic search keeps improving it in a worker until the user accepts or stops it.
- **Overflow:** parts that don't fit spill onto plate 2, 3 and so on. Due-date priority decides which parts make the first plate.

**Mode B: orientation-aware packing (Phase 2)**

- **Trade-off:** on DLP, print time follows the tallest part (the layer count), not the number of parts. Standing parts on edge fits more per plate but lengthens the print.
- **Search:** each part type has a set of candidate orientations, such as a model lying flat or standing on edge, or a guard tilted 30–90°. Each candidate gets its own footprint, and the genetic algorithm chooses the orientation along with order and rotation.
- **Objective:** the user picks between the most parts under a Z cap and the fewest plates × print time.
- **Collision safety:** a footprint is the full projection of the part plus its support margin. Footprints that don't overlap therefore guarantee tilted neighbours can't collide.

True volumetric packing, with parts stacked through the build volume, only applies to powder-bed printers (SLS/MJF) and is not planned for SprintRay. The engine sits behind a `Packer` interface, so a voxel-based packer can be added later if a powder printer joins the lineup.

## Smile design

2D photo design ships first as a case-presentation tool. 3D design on the scan comes last and starts with printable additive mockups. Designing temporaries is full restoration CAD, so it is deferred until a regulatory review is done.

**2D photo design (Phase 3)**

- **Input:** a full-face smile photo and a close-up smile photo (JPEG or PNG).
- **Landmarks:** MediaPipe Face Landmarker places the interpupillary line, facial midline, lip commissures and upper lip line. Every point can be dragged.
- **Guides:** facial midline, horizontal reference, smile arc along the lower lip, incisal plane, and a tooth-proportion grid. Proportion presets (width-to-length ratio, golden or RED proportion) are editable references, not rules.
- **Tooth outlines:** 2D outlines for canine to canine (premolars optional), in selectable shape families. Each has scale and position handles, with mirrored left/right editing.
- **Calibration:** the user enters one known measurement, such as the central incisor width from the model, and the design then reports proposed widths and lengths in mm.
- **Output:** before/after images, a patient PDF, and a design file (landmarks, outlines, mm dimensions) that seeds the 3D phase.

**3D design on the scan (Phase 5)**

- **Input:** the upper arch scan (lower arch and bite optional) and the 2D design file. The photo is matched to the scan through three or more points the user picks (incisal edges, cusp tips).
- **Tooth library:** 3D anterior tooth shapes, placed with a gizmo and scaled to the 2D design's mm values, with mirrored editing. There is no well-known open 3D tooth library, so this needs a licensed set or one modelled in-house.
- **Mockup model (first scope):** a manifold-3d union of the scan and the library teeth, which is additive only. The printed model is used to make a matrix for an in-mouth mockup, and it enters the nester as a mockup part.
- **Temporaries (deferred):** a shell made from the library tooth minus the prepared tooth needs margins, minimum thickness and cement gap. That is restoration design. Until the regulatory review is done, design temporaries in existing CAD (exocad, 3Shape) and use this app only to nest them.

## Privacy and regulatory

In brief: keep all patient data in the browser, and keep the app on the print-preparation side of the line. It nests surgical guides and temporaries but does not design them until counsel has reviewed an intended-use statement.

**PHI handling**

- **Scans and photos are PHI.** A scan becomes PHI once it is tied to a patient, and scanner exports often put the patient name in the file name. Full-face photos are one of HIPAA's 18 identifiers.
- **No upload.** Parsing, nesting, booleans and landmark detection all run in the browser. No mesh, photo or file name is sent to a server, including in error reports or analytics.
- **Encrypted at rest.** Saved cases go in IndexedDB under AES-GCM, following the Sugarbot Notes pattern. Where the key comes from is an open question (see below).
- **Names stay off outputs.** Export file names and the plate sheet use case IDs, not patient names, unless the user turns names on.
- **Retention.** Saved cases are deleted automatically after a set number of days, matching Sugarbot Notes' 30-day sweep.

**FDA exposure by feature**

| Feature | Exposure | How to stay on the safe side |
| --- | --- | --- |
| Nesting and export (Phases 1–2) | Lowest. The app moves finished designs and never changes them | Rigid-move invariant, geometry check on export, per-plate audit log. Supports and slicing stay in RayWare, which keeps practices inside SprintRay's validated resin workflows |
| 2D smile design (Phase 3) | Low if framed as visualization for discussion | Label outputs "for illustration"; never use diagnosis or treatment-planning language |
| 3D mockup model (Phase 5) | Moderate. The app creates geometry that is used in the mouth | Legal review before the phase starts |
| Temporaries design | High. Dental restoration CAD appears to fall under 21 CFR 872.3661 (Class II) | Not planned; design stays in cleared CAD |
| Surgical guide design | High. Guide planning software has usually gone through 510(k) | Not planned; the app only nests finished guides |

The 872.3661 reference comes from search listings, because FDA and eCFR pages could not be opened from the environment that wrote this spec. Confirm it with regulatory counsel. As with Sugarbot Notes (explicitly not a device) and Sugarbot Detect (510(k) K250264), this product needs its own written intended-use statement before any marketing copy is written.

## Roadmap

Phase 0 is a one-to-two-week spike that decides whether the product is viable. Nothing after it gets built until its gate passes.

| Phase | Scope | Rough effort | Exit gate |
| --- | --- | --- | --- |
| 0 · RayWare spike | Import test, plate profiles, packing baseline | 1–2 wk | Layout survives RayWare import, and plate profiles are measured |
| 1 · 2D nesting MVP | Import, check, footprint, NFP nest, export | 4–6 wk | More parts per plate than RayWare on real cases, zero geometry drift |
| 2 · Orientation packing | Candidate orientations, Z-cap objective | 3–4 wk | Beats Mode A on plates × print time on the same case sets |
| 3 · 2D smile design | Photo landmarks, guides, outlines, PDF | 4–5 wk | Clinician sign-off on 2D outputs, and counsel reviews the 3D scope |
| 4 · Cases and labels | Saved cases, plate sheets, model labels | 3–4 wk | Encryption and retention tested, and one pilot office using it |
| 5 · 3D mockup design | Scan registration, tooth library, union | 8–12 wk | Printed mockups fit the models within a tolerance Chris sets |

Effort is a rough estimate for one engineer. Phases 1–3 hold everything in memory (scans and photos), so no PHI persists until Phase 4 adds encrypted storage. Phase 3 does not depend on the nester, so a second engineer could run it alongside Phases 1–2.

## Open questions

- [ ] **Who runs it day to day?** An office printing its own cases needs a different UI and plate-priority model than a lab running many plates a day.
- [ ] **Will SprintRay share a .SPR spec or an import API, and who owns that contact?** The answer decides export option 3.
- [ ] **What is the edge over RayWare's auto-arrange?** Packing density, batching across cases, smile design, or all three. The Phase 0 baseline answers part of this.
- [ ] **Which printers and resins do target offices run?** For each part type: which Pro models (2, 95 S, 55 S), and which resin.
- [ ] **Standalone product or a Sugarbot module with shared accounts?** This decides where the encryption key comes from: Sugarbot's per-user server key or a local passphrase.
- [ ] **Tooth libraries.** License a commercial 2D/3D tooth set, or model one in-house?
- [ ] **Regulatory.** Who writes the intended-use statement, and who engages counsel before Phase 5?
- [ ] **Hosting.** Azure Static Web Apps next to Sugarbot, or somewhere else?

## Sources

The license terms in the stack table come from these files, all opened:

- [three.js LICENSE](https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE): MIT
- [manifold LICENSE](https://raw.githubusercontent.com/elalish/manifold/master/LICENSE): Apache-2.0
- [Clipper2 LICENSE](https://raw.githubusercontent.com/AngusJohnson/Clipper2/main/LICENSE): Boost
- [SVGnest LICENSE](https://raw.githubusercontent.com/Jack000/SVGnest/master/LICENSE.txt): MIT
- [deepnest-next LICENSE](https://raw.githubusercontent.com/deepnest-next/deepnest/main/LICENSE): MIT
- [libnest2d LICENSE](https://raw.githubusercontent.com/tamasmeszaros/libnest2d/master/LICENSE.txt): LGPL-3.0
- npm registry entries for [clipper2-js](https://registry.npmjs.org/clipper2-js/latest) (Boost), [@mediapipe/tasks-vision](https://registry.npmjs.org/@mediapipe/tasks-vision) (Apache-2.0) and [opencascade.js](https://registry.npmjs.org/opencascade.js/latest) (LGPL-2.1)

These pages are still to verify. The environment that wrote this spec blocks them, so the figures above come from search listings:

- [SprintRay Pro technical specifications](https://sprintray.com/pro-desktop-3dprinter/pro-desktop-3d-printer-technical-specifications/) and the [Pro 2 overview](https://support.sprintray.com/en_US/pro-2-getting-started/pro-2-overview) (build volumes)
- [Midas technical specification](https://support.sprintray.com/getting-started/midas-technical-specification-) (capsule volume)
- [Using SPR File Format](https://support.sprintray.com/hc/en-us/articles/360024054953-Using-SPR-File-Format) (what .SPR stores)
- [21 CFR 872.3661](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-872/subpart-D/section-872.3661) (dental CAD/CAM classification)
