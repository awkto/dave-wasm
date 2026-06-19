# dave-wasm — Dangerous Dave 1·2·3 in the browser

Play the **Dangerous Dave** trilogy directly in a web browser. 100% client-side — no server,
nothing uploaded.

- **Dangerous Dave (1990)** — the original by John Romero is **freely available**, so it ships
  with the site and plays instantly with no setup.
- **Dave 2 — Haunted Mansion (1991)** & **Dave 3 — Risky Rescue (1993)** — commercial Softdisk
  games. **Drag-and-drop your own data files** onto the page; they are assembled into a `.jsdos`
  bundle in-browser and never leave your machine.

## How it works

The real DOS binaries run under [js-dos](https://js-dos.com) (DOSBox compiled to WebAssembly),
entirely in your browser tab.

### Supplying your own data (Dave 2 / Dave 3)

Drop **all** of the game's files (the whole folder) onto the page:

| Game | Run | Files to drop |
|------|-----|---------------|
| Haunted Mansion | `1.EXE`    | `1.EXE` + every `*.DD2` (levels, tiles, sprites) |
| Risky Rescue    | `DAVE.EXE` | `DAVE.EXE` + `EGAGRAPH.DAV`, `GAMEMAPS.DAV`, `AUDIO.DAV`, `GFX_LIB.DAV`, `DIGSND.DAV`, `CONFIG.DAV`, … |

The launcher detects which game it is from the files and builds the bundle in your browser.

## Controls

- **Keyboard:** arrows move · **Up** = jump · **Ctrl** = fire (when you have the gun) ·
  **Alt** = jetpack (Dave 1). Each game also has its own in-game key-redefine screen.
- **Touch** (phones/tablets, or force it in Settings): the screen splits — game on top, an
  on-screen joystick + Jump/Fire/Jet buttons on the bottom.
- **Settings:** aspect ratio, crisp vs. smooth pixels, touch-controls mode, and DOSBox vs.
  DOSBox-X (real-time save/load states).
- **Saves persist** automatically in your browser (IndexedDB, per game) and survive reloads.

## Project layout

```
index.html          launcher UI
css/app.css         styling
js/app.js           launch logic + in-browser .jsdos bundle builder
js/fflate.min.js    vendored zip library (assembles bundles client-side)
games/dave1.jsdos   prebuilt Dangerous Dave (1990) bundle (free)
docker/             entrypoint + nginx config for self-hosting
deploy/             docker-compose + reverse-proxy templates for box/pro
```

## GitHub Pages

The site is static — `git push`, enable **Pages** (Settings → Pages → Deploy from branch → `main`
/ root), done. Dangerous Dave (1990) plays instantly; Dave 2/3 are bring-your-own-data.
(`.nojekyll` is present so the `.jsdos` bundle is served verbatim.)

```
python3 -m http.server 8087   # local dev → http://127.0.0.1:8087
```
(js-dos requires `http://`, not `file://`.)

## Self-hosting with Docker (server / kiosk mode)

A container image is published to Docker Hub as **`awkto/dave-wasm`** by GitHub Actions on every
`v*.*.*` tag (`:latest` tracks the newest release).

Mount a directory of your own Dave files at `/data`. On startup the container detects each game,
builds its `.jsdos` bundle, and writes `games/manifest.json` — the launcher then shows **only the
available games** as one-click buttons and **hides the upload UI** entirely. Layout under `/data`
is one subdir per game (recommended) or flat:

```
/data/dave1/DAVE.EXE EGADAVE.DAV ...
/data/dave2/1.EXE *.DD2 ...
/data/dave3/DAVE.EXE EGAGRAPH.DAV GAMEMAPS.DAV AUDIO.DAV ...
```

```bash
docker run -d --name dave-wasm --restart unless-stopped \
  -p 127.0.0.1:5024:80 \
  -v /srv/dave-data:/data:ro \
  awkto/dave-wasm:latest
```

Dangerous Dave (1990) falls back to the bundled copy if `/data` has no dave1. Commercial Dave 2/3
data is never baked into the image — it only ever lives in your mounted `/data`.

### Production deployment (box.dnsif.ca / pro.dnsif.ca)

See [`deploy/README.md`](deploy/README.md) for the full setup: `docker-compose` per host, an nginx
reverse-proxy vhost (TLS via the `*.dnsif.ca` wildcard cert), and wildcard DNS. On those instances
the full retail Dave 2/3 live in the mounted `/data`, so all three games run with no uploads and
the bring-your-own UI is hidden.

## Licensing

- **This launcher code** (everything except `games/` and `js/fflate.min.js`) is MIT — see
  [`LICENSE`](LICENSE).
- **`js/fflate.min.js`** is [fflate](https://github.com/101arrowz/fflate), MIT.
- **js-dos** is loaded from its CDN under its own (GPL) license; it is not redistributed here.
- **Dangerous Dave** is the property of its respective owners. Only the freely-available original
  (1990) is included. **Do not commit Dave 2/3 data to this repository.**
