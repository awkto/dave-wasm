/*
 * Dangerous Dave 1/2/3 launcher (js-dos baseline).
 *
 * - Dangerous Dave (1990) ships as a prebuilt bundle (games/dave1.jsdos) — the
 *   original is freely available, so it plays instantly with no setup.
 * - Dave 2 (Haunted Mansion) / Dave 3 (Risky Rescue) are commercial Softdisk
 *   games: the user supplies their own files, which we assemble into a .jsdos
 *   bundle entirely in the browser (nothing is uploaded).
 * - In server/kiosk mode (container with a mounted /data dir) the launcher shows
 *   only the games detected on the server and hides the upload UI.
 *
 * Wrapped in an IIFE: js-dos.js declares globals (including `var $`), so we must
 * keep our own top-level names ($ , launch, DOSBOX_CONF, …) out of global scope.
 */

(function () {
"use strict";

// The three Dangerous Dave games. `run` is the DOS executable launched by the
// bundle's autoexec; `detect` identifies the game from a set of (UPPERCASED)
// filenames the user dropped; `need` is the checklist shown in the UI.
const GAMES = {
  dave1: {
    title: "Dangerous Dave",
    run: "DAVE.EXE",
    detect: (set) => set.has("EGADAVE.DAV"),
    need: [["DAVE.EXE", (set) => set.has("DAVE.EXE")],
           ["EGADAVE.DAV", (set) => set.has("EGADAVE.DAV")]],
  },
  dave2: {
    title: "Dangerous Dave in the Haunted Mansion",
    run: "1.EXE",
    detect: (set) => [...set].some((n) => /\.DD2$/.test(n)),
    need: [["the game .EXE", (set) => [...set].some((n) => /\.EXE$/.test(n))],
           ["*.DD2 level/tile data", (set) => [...set].some((n) => /\.DD2$/.test(n))]],
  },
  dave3: {
    title: "Dangerous Dave's Risky Rescue",
    run: "DAVE.EXE",
    detect: (set) => set.has("EGAGRAPH.DAV") && set.has("GAMEMAPS.DAV"),
    need: [["the game .EXE", (set) => [...set].some((n) => /\.EXE$/.test(n))],
           ["EGAGRAPH.DAV", (set) => set.has("EGAGRAPH.DAV")],
           ["GAMEMAPS.DAV", (set) => set.has("GAMEMAPS.DAV")],
           ["AUDIO.DAV", (set) => set.has("AUDIO.DAV")]],
  },
};
const GAME_KEYS = Object.keys(GAMES);

// Identify which Dave game a set of filenames belongs to (dave2 first: its .DD2
// signature is the most specific). Returns a key ("dave1"/"dave2"/"dave3") or null.
function detectGame(names) {
  const set = new Set(names);
  if (GAMES.dave2.detect(set)) return "dave2";
  if (GAMES.dave3.detect(set)) return "dave3";
  if (GAMES.dave1.detect(set)) return "dave1";
  return null;
}

// dosbox.conf used for user-supplied bundles. __RUNCMD__ is replaced with the
// game's executable. Kept in sync with games/dave1.jsdos's config.
const DOSBOX_CONF = `[sdl]
autolock=false
fullscreen=false
output=surface
mapperfile=mapper-jsdos.map
usescancodes=true
[dosbox]
machine=svga_s3
memsize=16
[cpu]
core=auto
cputype=auto
cycles=auto
cycleup=10
cycledown=20
[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20
[render]
frameskip=0
aspect=false
scaler=none
[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
sbmixer=true
oplmode=auto
oplemu=default
oplrate=44100
[speaker]
pcspeaker=true
pcrate=44100
[dos]
xms=true
ems=true
umb=true
keyboardlayout=auto
[autoexec]
echo off
mount c .
c:
__RUNCMD__
`;

let dosCi = null;           // running js-dos instance
let gameCi = null;          // emulator command interface (for sending key events)
let pendingBlobUrl = null;  // object URL for a built bundle, awaiting Play
let pendingFiles = null;    // [{name, data:Uint8Array}]
let pendingRunCmd = null;
let pendingKey = null;      // persistence key for the BYO game
const launchable = {};      // key -> bundle url (server games + bundled demo) for deep-links
let currentKey = null;      // key of the running game (for autosave)
let savedBlobUrl = null;    // object URL of a snapshot we booted from
let saveTimer = null;       // periodic autosave interval

const $ = (id) => document.getElementById(id);

// ---- persistent saves (self-managed) ---------------------------------------
// js-dos autoSave is unreliable here, so we snapshot the emulator filesystem
// (ci.persist(false) → a standalone .jsdos bundle holding the game's saves +
// config) into our own IndexedDB, keyed per game. We boot from that snapshot
// next time so progress is restored, and the launcher can Download/Upload/Delete
// it (portable across browsers/devices).
const SAVE_DB = "dave-saves";
const SAVE_STORE = "blobs";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(SAVE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(SAVE_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function saveGet(key) {
  try { const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(SAVE_STORE, "readonly").objectStore(SAVE_STORE).get(key);
      t.onsuccess = () => res(t.result || null); t.onerror = () => res(null);
    });
  } catch (_) { return null; }
}
async function savePut(key, blob) {
  try { const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(SAVE_STORE, "readwrite").objectStore(SAVE_STORE).put(blob, key);
      t.onsuccess = () => res(true); t.onerror = () => res(false);
    });
  } catch (_) { return false; }
}
async function saveDelete(key) {
  try { const db = await idbOpen();
    await new Promise((res) => {
      const t = db.transaction(SAVE_STORE, "readwrite").objectStore(SAVE_STORE).delete(key);
      t.onsuccess = () => res(); t.onerror = () => res();
    });
  } catch (_) {}
}
async function saveListKeys() {
  try { const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(SAVE_STORE, "readonly").objectStore(SAVE_STORE).getAllKeys();
      t.onsuccess = () => res(t.result || []); t.onerror = () => res([]);
    });
  } catch (_) { return []; }
}

let capturing = false;
// Snapshot the running emulator's filesystem into our IndexedDB under `key`.
async function captureSave(key) {
  if (!gameCi || typeof gameCi.persist !== "function" || capturing || !key) return;
  capturing = true;
  try {
    const u = await gameCi.persist(false);   // full standalone .jsdos bundle
    if (u && u.length) await savePut(key, new Blob([u], { type: "application/octet-stream" }));
  } catch (_) {} finally { capturing = false; }
}

// ---- settings (persisted in localStorage) ----------------------------------

const SETTING_DEFAULTS = { aspect: "4/3", rendering: "pixelated", touch: "auto", engine: "dosbox" };
const getSetting = (k) => localStorage.getItem("dave." + k) || SETTING_DEFAULTS[k];
const setSetting = (k, v) => localStorage.setItem("dave." + k, v);

function touchEnabled() {
  const mode = getSetting("touch");
  if (mode === "on") return true;
  if (mode === "off") return false;
  return window.matchMedia("(pointer: coarse)").matches; // auto
}

// ---- launching -------------------------------------------------------------

// `key` scopes the IndexedDB save storage so saves persist across reloads
// (stable per game, even when BYO bundles get fresh blob: URLs each time).
async function launch(url, key) {
  $("launcher").hidden = true;
  $("topbar").hidden = true;
  $("footer").hidden = true;
  $("game-stage").hidden = false;
  currentKey = key;

  // Emulator engine: DOSBox (default, lighter) or DOSBox-X (adds real-time
  // save/load states). The xstate class reveals the SAVE/LOAD buttons.
  const engine = getSetting("engine") === "dosboxX" ? "dosboxX" : "dosbox";
  $("game-stage").classList.toggle("xstate", engine === "dosboxX");

  const touch = touchEnabled();
  if (touch) {
    $("game-stage").classList.add("touch");
    $("touch-controls").hidden = false;
    renderTouchActions(key);   // jump/fire/jet buttons for this specific game
    // Size the game pane to the chosen display aspect so the canvas fills it
    // with no black letterbox below (the freed height goes to the controls).
    const AR = { "4/3": "4 / 3", "5/4": "5 / 4", "16/10": "16 / 10", "16/9": "16 / 9",
                 "1/1": "1 / 1", "AsIs": "16 / 10", "Fit": "16 / 10" };
    $("dos").style.aspectRatio = AR[getSetting("aspect")] || "4 / 3";
  }

  // Boot from our saved snapshot for this game if we have one (restores
  // progress); otherwise boot the supplied bundle.
  let bootUrl = url;
  const saved = await saveGet(key);
  if (saved) { savedBlobUrl = URL.createObjectURL(saved); bootUrl = savedBlobUrl; }

  // Dos() boots DOSBox-WASM into #dos and loads the .jsdos bundle.
  dosCi = Dos($("dos"), {
    url: bootUrl,
    key,
    autoStart: true,
    autoSave: false,           // we persist explicitly via captureSave()
    backend: engine,           // "dosbox" (default) or "dosboxX" (save states)
    noCloud: true,             // self-contained: no cloud account prompts
    thinSidebar: touch,        // slim the js-dos sidebar on touch (CSS hides it)
    renderAspect: getSetting("aspect"),
    imageRendering: getSetting("rendering"),
    onEvent: (event, arg) => {
      if (event === "ci-ready") {
        gameCi = arg;          // command interface for touch input + persist()
        try { if (/[?&#]debug/.test(location.href)) window.__daveCi = arg; } catch (_) {}
      }
      if (event === "error") {
        alert("js-dos error:\n\n" + arg +
          "\n\nIf you supplied your own files, double-check you selected the whole game " +
          "folder — the .EXE plus all its data files (.DD2 or .DAV).");
      }
    },
  });

  // Safety-net autosave while playing (covers the game's in-menu saves).
  clearInterval(saveTimer);
  saveTimer = setInterval(() => captureSave(key), 30000);

  // Give the running game its own URL (#dave<n>) so the browser Back button /
  // system back gesture quits it.
  if (location.hash !== "#" + key) history.pushState({ playing: key }, "", "#" + key);
}

// Back leaves the game's #hash and fires popstate — snapshot progress, then
// reload to tear the emulator down cleanly and return to the launcher.
window.addEventListener("popstate", async () => {
  if (!dosCi) return;
  clearInterval(saveTimer);
  await captureSave(currentKey);
  location.reload();
});
// Extra safety: snapshot when the tab is hidden/backgrounded (covers closing it).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && dosCi) captureSave(currentKey);
});

// Deep-link: opening the page at #dave<n> auto-launches that game (server games
// + the bundled demo). We normalize to the base URL first so a launcher entry
// sits behind the game and Back returns to it.
function deepLink() {
  const key = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  history.replaceState(null, "", location.pathname + location.search);
  if (key && launchable[key]) launch(launchable[key], key);
}

// ---- user-supplied data -> .jsdos bundle -----------------------------------

async function handleFiles(fileList) {
  const status = $("file-status");
  status.hidden = false;
  $("play-byo").disabled = true;
  pendingFiles = null;

  const files = [];
  for (const f of fileList) {
    const name = f.name.toUpperCase();
    files.push({ name, data: new Uint8Array(await f.arrayBuffer()) });
  }

  const names = files.map((f) => f.name);
  const set = new Set(names);
  const key = detectGame(names);
  const game = key ? GAMES[key] : null;

  // Pick the executable to run: the game's canonical one if present, else any .EXE.
  const exe = (game && set.has(game.run) && game.run)
           || (files.find((f) => /\.EXE$/.test(f.name)) || {}).name
           || null;

  if (!game) {
    status.innerHTML = `<div class="miss">✗ Couldn't recognise these as Dave 2 or Dave 3 files. ` +
      `Select the whole game folder — the <code>.EXE</code> plus <code>*.DD2</code> ` +
      `(Haunted Mansion) or <code>EGAGRAPH.DAV</code>/<code>GAMEMAPS.DAV</code> (Risky Rescue).</div>`;
    return;
  }

  const checks = game.need.map(([label, test]) => [test(set), label]);
  const rows = checks
    .map(([ok, label]) => `<div class="${ok ? "ok" : "miss"}">${ok ? "✓" : "✗"} ${label}</div>`)
    .join("");
  const allOk = checks.every(([ok]) => ok) && !!exe;

  status.innerHTML = `<div><strong>Selected ${files.length} file(s) — detected ` +
    `${game.title}:</strong></div>` + rows;

  if (allOk) {
    pendingFiles = files;
    pendingRunCmd = exe;
    pendingKey = key;
    $("play-byo").disabled = false;
  }
}

function buildBundleBlob(files, runCmd) {
  const conf = DOSBOX_CONF.replace("__RUNCMD__", runCmd);
  const tree = {
    ".jsdos/dosbox.conf": fflate.strToU8(conf),
    "dosbox.conf": fflate.strToU8("[cpu]\ncycles=auto\n"),
  };
  // Bundle EVERY supplied file — Dave games need their full data set (all the
  // *.DD2 levels/sprites, or the *.DAV graphics/maps/audio + helpers).
  for (const f of files) tree[f.name] = f.data;
  const zipped = fflate.zipSync(tree, { level: 6 });
  return new Blob([zipped], { type: "application/octet-stream" });
}

function playByo() {
  if (!pendingFiles) return;
  const blob = buildBundleBlob(pendingFiles, pendingRunCmd);
  pendingBlobUrl = URL.createObjectURL(blob);
  launch(pendingBlobUrl, pendingKey);
}

// ---- touch controls --------------------------------------------------------

const activeByPointer = new Map(); // pointerId -> [keyCodes]

function sendKey(code, down) {
  if (gameCi && typeof gameCi.sendKeyEvent === "function") {
    try { gameCi.sendKeyEvent(code, down); } catch (_) {}
  }
}

function bindTouchButton(btn) {
  const keys = (btn.dataset.keys || "").split(",").map(Number).filter(Boolean);
  if (!keys.length) return;
  // Optional stagger (ms) between successive key-downs (data-keys order sets the
  // sequence). Unused by the Dave buttons but kept for flexibility.
  const stagger = parseInt(btn.dataset.stagger || "0", 10) || 0;
  let timers = [];

  const press = (e) => {
    e.preventDefault();
    // Capture the pointer so this button keeps every move/up event for the
    // whole hold — the OS can't reroute it into a long-press gesture.
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    btn.classList.add("active");
    if (e.pointerId != null) activeByPointer.set(e.pointerId, keys);
    timers.forEach(clearTimeout); timers = [];
    keys.forEach((k, i) => {
      if (stagger && i > 0) timers.push(setTimeout(() => sendKey(k, true), stagger * i));
      else sendKey(k, true);
    });
  };
  const release = (e) => {
    timers.forEach(clearTimeout); timers = [];
    btn.classList.remove("active");
    keys.forEach((k) => sendKey(k, false));
    if (e && e.pointerId != null) activeByPointer.delete(e.pointerId);
  };

  btn.addEventListener("pointerdown", press);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
  // Kill the browser's long-press behaviours (context menu, text selection,
  // iOS callout) that otherwise fire pointercancel mid-hold and drop the keys.
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
}

// Per-game on-screen action buttons (label + GLFW key code + colour class).
// Movement is the joystick (arrow keys); these are the game's jump/fire/etc.
// The keys differ per title (verified against each game's manual):
//   Dave 1 (1990):           Up=Jump, Alt=Fire, Ctrl=Jetpack
//   Dave 2 (Haunted Mansion): Ctrl=Jump, Alt=Fire
//   Dave 3 (Risky Rescue):    Ctrl=Jump, Alt=Fire
// GLFW codes: Up=265, Left-Ctrl=341, Left-Alt=342.
const TOUCH_ACTIONS = {
  dave1: [{ label: "FIRE", keys: "342", cls: "fire" },
          { label: "JET",  keys: "341", cls: "jet"  },
          { label: "JUMP", keys: "265", cls: "jump" }],
  dave2: [{ label: "FIRE", keys: "342", cls: "fire" },
          { label: "JUMP", keys: "341", cls: "jump" }],
  dave3: [{ label: "FIRE", keys: "342", cls: "fire" },
          { label: "JUMP", keys: "341", cls: "jump" }],
};

// Build the action buttons for the game being launched and bind them. (Movement,
// menu, Y/N and save/load buttons are static; only these differ per game.)
function renderTouchActions(key) {
  const wrap = document.querySelector("#touch-controls .actions");
  if (!wrap) return;
  const cfg = TOUCH_ACTIONS[key] || TOUCH_ACTIONS.dave2;
  wrap.innerHTML = "";
  cfg.forEach((b) => {
    const el = document.createElement("button");
    el.className = "abtn " + b.cls;
    el.dataset.keys = b.keys;
    el.textContent = b.label;
    wrap.appendChild(el);
    bindTouchButton(el);
  });
}

// Virtual joystick -> arrow keys (8-way). Removes the dead center of a d-pad.
const ARROWS = { up: 265, down: 264, left: 263, right: 262 };
const arrowState = { up: false, down: false, left: false, right: false };

function setArrow(dir, on) {
  if (arrowState[dir] !== on) {
    arrowState[dir] = on;
    sendKey(ARROWS[dir], on);
  }
}
function clearArrows() { Object.keys(ARROWS).forEach((d) => setArrow(d, false)); }

function setupJoystick() {
  const base = $("stick");
  const knob = $("stick-knob");
  if (!base) return;
  let pid = null;

  const update = (cx, cy) => {
    const r = base.getBoundingClientRect();
    const ox = r.left + r.width / 2;
    const oy = r.top + r.height / 2;
    const dx = cx - ox;
    const dy = cy - oy;
    const max = r.width / 2;
    const dist = Math.hypot(dx, dy);
    const k = Math.min(1, dist / max);
    const ang = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(ang) * k * max}px, ${Math.sin(ang) * k * max}px)`;

    const want = { up: false, down: false, left: false, right: false };
    if (dist >= max * 0.3) {               // deadzone
      let a = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360; // 0=right, 90=up
      if (a >= 22.5 && a < 67.5) { want.up = want.right = true; }
      else if (a >= 67.5 && a < 112.5) { want.up = true; }
      else if (a >= 112.5 && a < 157.5) { want.up = want.left = true; }
      else if (a >= 157.5 && a < 202.5) { want.left = true; }
      else if (a >= 202.5 && a < 247.5) { want.down = want.left = true; }
      else if (a >= 247.5 && a < 292.5) { want.down = true; }
      else if (a >= 292.5 && a < 337.5) { want.down = want.right = true; }
      else { want.right = true; }
    }
    Object.keys(ARROWS).forEach((d) => setArrow(d, want[d]));
  };
  const reset = () => { pid = null; knob.style.transform = ""; clearArrows(); };

  base.addEventListener("pointerdown", (e) => {
    e.preventDefault(); pid = e.pointerId;
    try { base.setPointerCapture(pid); } catch (_) {}
    update(e.clientX, e.clientY);
  });
  base.addEventListener("pointermove", (e) => { if (e.pointerId === pid) update(e.clientX, e.clientY); });
  base.addEventListener("pointerup", (e) => { if (e.pointerId === pid) reset(); });
  base.addEventListener("pointercancel", (e) => { if (e.pointerId === pid) reset(); });
}

// On-screen keyboard: a hidden <input> whose focus raises the device soft
// keyboard. We forward typed characters/keys to the emulator (held briefly so
// the emulator polls them). Lets you type save-game names on touch devices.
function setupKeyboard() {
  const btn = $("kbd-btn");
  const proxy = $("kbd-proxy");
  if (!btn || !proxy) return;

  const SHIFT = 340;                 // GLFW left shift
  const SPECIAL = {                  // keys that arrive as keydown (even on Android)
    Enter: 257, Backspace: 259, Tab: 258, Escape: 256,
    ArrowUp: 265, ArrowDown: 264, ArrowLeft: 263, ArrowRight: 262,
  };
  const PUNCT = { "-":45,"=":61,"[":91,"]":93,";":59,"'":39,",":44,".":46,"/":47,"\\":92,"`":96 };

  // press a key, then release it a few frames later so the emulator registers it
  const hold = (code, shift) => {
    if (shift) sendKey(SHIFT, true);
    sendKey(code, true);
    setTimeout(() => { sendKey(code, false); if (shift) sendKey(SHIFT, false); }, 50);
  };
  const typeChar = (ch) => {
    if (ch === " ") return hold(32);
    if (ch === "\n") return hold(257);
    const u = ch.toUpperCase().charCodeAt(0);
    if ((u >= 65 && u <= 90) || (u >= 48 && u <= 57)) return hold(u, ch >= "A" && ch <= "Z");
    if (PUNCT[ch] != null) return hold(PUNCT[ch]);
  };

  const toggle = (e) => {
    e.preventDefault();
    if (document.activeElement === proxy) { proxy.blur(); btn.classList.remove("active"); }
    else { proxy.value = ""; proxy.focus(); btn.classList.add("active"); }
  };
  btn.addEventListener("pointerup", toggle);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  proxy.addEventListener("blur", () => btn.classList.remove("active"));

  // Printable characters: soft keyboards fire `beforeinput` (keydown is unreliable
  // on Android — it reports keyCode 229). Keep the field empty after each char.
  proxy.addEventListener("beforeinput", (e) => {
    if (e.inputType === "insertText" && e.data) { for (const ch of e.data) typeChar(ch); }
    e.preventDefault();
    proxy.value = "";
  });
  // Enter / Backspace / arrows / Esc: these do fire keydown. stopPropagation so
  // js-dos's own key handler doesn't also process them (would double the input).
  proxy.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (SPECIAL[e.key] != null) { hold(SPECIAL[e.key]); e.preventDefault(); }
  });
  proxy.addEventListener("keyup", (e) => { e.stopPropagation(); });
  proxy.addEventListener("keypress", (e) => { e.stopPropagation(); });
}

// Emulator save states (DOSBox-X only): js-dos triggers these via a backend event.
function backendTrigger(event) {
  if (gameCi && typeof gameCi.sendBackendEvent === "function") {
    try { gameCi.sendBackendEvent({ type: "wc-trigger-event", event }); } catch (_) {}
  }
}
// Realtime save states behind a 💾 popup (DOSBox-X). Tapping 💾 opens a Save/Load
// popup; tapping either runs the emulator state action (and persists) and closes it.
function setupSaveLoad() {
  const trigger = $("saveload-btn");
  const popup = $("saveload-popup");
  const save = $("savestate-btn");
  const load = $("loadstate-btn");
  if (!trigger || !popup) return;

  const isOpen = () => popup.classList.contains("open");
  const open = () => { popup.hidden = false; popup.classList.add("open"); };
  const close = () => { popup.classList.remove("open"); popup.hidden = true; };

  trigger.addEventListener("pointerup", (e) => { e.preventDefault(); isOpen() ? close() : open(); });
  trigger.addEventListener("contextmenu", (e) => e.preventDefault());
  trigger.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

  const act = (btn, fn) => {
    if (!btn) return;
    btn.addEventListener("pointerup", (e) => {
      e.preventDefault(); btn.classList.add("active"); fn();
      setTimeout(() => btn.classList.remove("active"), 200); close();
    });
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    btn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  };
  act(save, () => { backendTrigger("hand_savestate"); setTimeout(() => captureSave(currentKey), 700); });
  act(load, () => backendTrigger("hand_loadstate"));

  // Tap outside the popup/trigger to dismiss.
  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !popup.contains(e.target) && !trigger.contains(e.target)) close();
  }, true);
}

function setupTouchControls() {
  document.querySelectorAll("#touch-controls [data-keys]").forEach(bindTouchButton);
  setupJoystick();
  setupKeyboard();
  setupSaveLoad();

  // Take over touch for the whole control pad: non-passive preventDefault stops
  // long-press selection/callout, double-tap zoom, and scroll across the pad.
  const pad = $("touch-controls");
  if (pad) {
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    pad.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    pad.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }
  // Safety net: if a pointer is lost (window blur, etc.), release everything.
  const releaseAll = () => {
    activeByPointer.forEach((keys) => keys.forEach((k) => sendKey(k, false)));
    activeByPointer.clear();
    clearArrows();
    document.querySelectorAll("#touch-controls .active").forEach((b) => b.classList.remove("active"));
  };
  window.addEventListener("blur", releaseAll);
}

// ---- launcher: saved-game download / upload / delete -----------------------

const numOfKey = (k) => (String(k).match(/^dave([1-9])$/) || [])[1];

async function refreshSavesUI() {
  const list = $("saves-list");
  if (!list) return;
  const keys = (await saveListKeys()).filter((k) => /^dave[1-9]$/.test(k)).sort();
  if (!keys.length) {
    list.innerHTML = `<p class="save-info">No saved games yet — your progress is stored here automatically once you play.</p>`;
    return;
  }
  const rows = await Promise.all(keys.map(async (k) => {
    const b = await saveGet(k);
    const kb = b ? Math.round(b.size / 1024) : 0;
    const title = (GAMES[k] && GAMES[k].title) || ("Dave " + numOfKey(k));
    return `<div class="save-row"><span>${title} <small>(${kb}&nbsp;KB)</small></span>` +
      `<span class="save-row-btns">` +
      `<button class="save-btn" data-dl="${k}">⤓ Download</button>` +
      `<button class="save-btn danger" data-del="${k}" aria-label="Delete">🗑</button></span></div>`;
  }));
  list.innerHTML = rows.join("");
  list.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => downloadSave(b.getAttribute("data-dl"))));
  list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteSaveUI(b.getAttribute("data-del"))));
}

async function downloadSave(key) {
  const blob = await saveGet(key);
  if (!blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = key + "-save.jsdos";   // a .jsdos is a zip of the save/game files
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function deleteSaveUI(key) {
  const title = (GAMES[key] && GAMES[key].title) || ("Dave " + numOfKey(key));
  if (!confirm(`Delete the saved game for ${title} in this browser? This cannot be undone.`)) return;
  await saveDelete(key);
  await refreshSavesUI();
}

// Import a downloaded save. Detect the game from the filename, else by sniffing
// the data files inside the .jsdos (zip) bundle.
async function importSave(file) {
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  let key = (file.name.match(/dave[ _-]?([1-3])/i) || [])[1];
  key = key ? "dave" + key : null;
  if (!key) {
    try {
      key = detectGame(Object.keys(fflate.unzipSync(buf)).map((n) => n.toUpperCase().split("/").pop()));
    } catch (_) {}
  }
  if (!key || !GAMES[key]) {
    alert("Couldn't tell which game this save is for — expected a Dangerous Dave 1/2/3 save.");
    return;
  }
  await savePut(key, new Blob([buf], { type: "application/octet-stream" }));
  await refreshSavesUI();
  alert("Save imported for " + GAMES[key].title + ". It loads next time you play that game.");
}

// ---- settings UI -----------------------------------------------------------

function setupSettings() {
  [["set-aspect", "aspect"], ["set-rendering", "rendering"], ["set-touch", "touch"], ["set-engine", "engine"]]
    .forEach(([id, key]) => {
      const sel = $(id);
      sel.value = getSetting(key);
      sel.addEventListener("change", () => setSetting(key, sel.value));
    });
}

// ---- server / kiosk mode ---------------------------------------------------

// When served from the container with a mounted data dir, an entrypoint writes
// games/manifest.json listing the available games. In that case we show only
// those games and hide the bring-your-own-data UI.
async function setupServerMode() {
  let manifest;
  try {
    const res = await fetch("games/manifest.json", { cache: "no-store" });
    if (!res.ok) return;
    manifest = await res.json();
  } catch (_) { return; }
  if (!manifest || !manifest.serverMode || !Array.isArray(manifest.games) || !manifest.games.length) return;

  $("demo-card").hidden = true;
  $("byo-card").hidden = true;

  const list = $("server-games-list");
  list.innerHTML = "";
  manifest.games
    .slice()
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
    .forEach((g) => {
      const btn = document.createElement("button");
      btn.className = "play-btn";
      const title = g.title || (GAMES[g.key] && GAMES[g.key].title) || g.key;
      btn.textContent = `▶ Play ${title}`;
      launchable[g.key] = g.bundle;   // enable deep-link / back routing
      btn.addEventListener("click", () => launch(g.bundle, g.key));
      list.appendChild(btn);
    });
  $("server-games").hidden = false;
}

// ---- wiring ----------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  setupSettings();
  setupTouchControls();
  launchable["dave1"] = "games/dave1.jsdos";   // bundled free game (overridden by server manifest if present)
  setupServerMode().then(deepLink);            // deep-link after the manifest (if any) has loaded

  refreshSavesUI();
  $("save-upload").addEventListener("click", () => $("save-file-input").click());
  $("save-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = ""; importSave(f);
  });

  $("play-dave1").addEventListener("click", () => launch("games/dave1.jsdos", "dave1"));
  $("play-byo").addEventListener("click", playByo);

  const dz = $("dropzone");
  const input = $("file-input");
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });
  input.addEventListener("change", () => { if (input.files.length) handleFiles(input.files); });

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) handleFiles(dt.files);
  });
});

})();
