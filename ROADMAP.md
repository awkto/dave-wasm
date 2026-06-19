# Roadmap

## Path 1 — js-dos baseline ✅ (current)

Real DOS binaries under DOSBox-WASM, fully client-side.

- [x] Dangerous Dave (1990) playable from a prebuilt `.jsdos` bundle
- [x] Drag-drop / file-picker → in-browser `.jsdos` bundle for Dave 2 (Haunted Mansion) & Dave 3 (Risky Rescue)
- [x] Per-game auto-detection from dropped files (`*.DD2` → Dave 2, `EGAGRAPH.DAV`+`GAMEMAPS.DAV` → Dave 3, `EGADAVE.DAV` → Dave 1)
- [x] Static site, deployable to GitHub Pages
- [x] Save-game persistence across reloads (IndexedDB snapshot, keyed per game)
- [x] Settings panel: aspect ratio + crisp/smooth pixels + DOSBox/DOSBox-X
- [x] Mobile/touch on-screen controls (joystick + Jump/Fire/Jet)
- [x] Server/kiosk mode: container detects full games in a mounted `/data` and hides the upload UI
- [x] Production deployment kit (compose + nginx reverse proxy) for box.dnsif.ca / pro.dnsif.ca
- [ ] Per-game cycles tuning in the settings panel (the original Dave is speed-sensitive)
- [ ] Optional cross-origin isolation (COOP/COEP) to enable SharedArrayBuffer for smoother audio

## Path 2 — native-web port (idea, separate branch)

The original Dangerous Dave has been fully reverse-engineered (e.g. MaiZure's "Let's Build
Dangerous Dave"). A from-source C reimplementation compiled to WebAssembly with Emscripten would
give crisp integer scaling, remappable input, and no DOS-emulation layer — at the cost of being a
per-game port rather than one emulator covering all three. Tracked here for later.
