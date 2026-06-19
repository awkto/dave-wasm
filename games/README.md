# Game data

## `dave1.jsdos` — included (Dangerous Dave, 1990)

This bundle contains the **original Dangerous Dave** (1990) by John Romero, which is freely
available and widely redistributed. It is packaged here as a `.jsdos` bundle:

```
.jsdos/dosbox.conf   DOSBox config (autoexec runs DAVE.EXE)
DAVE.EXE             the game executable
EGADAVE.DAV          EGA graphics
DSCORES.DAV          high-scores file
CHKLIST.CPS          checklist (shipped with the original)
```

## Dave 2 & 3 — NOT included (commercial)

**Dangerous Dave in the Haunted Mansion** (1991) and **Dangerous Dave's Risky Rescue** (1993)
are commercial Softdisk games. **Their data files must never be committed to this repository.**

- On the **public site**, players supply their own copies at runtime via the file picker; those
  files are assembled into a `.jsdos` bundle in the browser and never uploaded anywhere.
- On a **self-hosted server** (see the repo README), mount the full game files at `/data` — the
  container detects them, builds the bundles at startup, and serves the full games directly.

Each game's signature files (used for detection):

| Game | Run | Signature data |
|------|-----|----------------|
| Dangerous Dave (1990)            | `DAVE.EXE` | `EGADAVE.DAV` |
| Dave in the Haunted Mansion (1991)| `1.EXE`    | `*.DD2` (levels, tiles, sprites) |
| Dave's Risky Rescue (1993)        | `DAVE.EXE` | `EGAGRAPH.DAV` + `GAMEMAPS.DAV` + `AUDIO.DAV` |
