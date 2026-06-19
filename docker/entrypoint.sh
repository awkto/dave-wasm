#!/bin/sh
# Build .jsdos bundles + a manifest from a mounted /data dir, then serve the site.
#
# Mount your own Dangerous Dave files at /data (one subdir per game, or flat):
#   /data/dave1/DAVE.EXE EGADAVE.DAV ...        (the original, 1990)
#   /data/dave2/1.EXE *.DD2 ...                 (Haunted Mansion, 1991)
#   /data/dave3/DAVE.EXE EGAGRAPH.DAV ...        (Risky Rescue, 1993)
# When any game is detected, the launcher shows ONLY the server games and hides
# the upload UI. Commercial Dave 2/3 data is never baked into the image.
set -e

WEB=/usr/share/nginx/html
GAMES="$WEB/games"
DATA=/data

# detect_game <src_dir> -> echoes the game key (dave1/dave2/dave3) it contains, or nothing.
# dave2 first: its *.DD2 signature is the most specific.
detect_game() {
  src="$1"
  if find "$src" -maxdepth 1 -iname "*.DD2" 2>/dev/null | grep -q .; then echo dave2; return; fi
  if find "$src" -maxdepth 1 -iname "EGAGRAPH.DAV" 2>/dev/null | grep -q . \
     && find "$src" -maxdepth 1 -iname "GAMEMAPS.DAV" 2>/dev/null | grep -q .; then echo dave3; return; fi
  if find "$src" -maxdepth 1 -iname "EGADAVE.DAV" 2>/dev/null | grep -q .; then echo dave1; return; fi
}

run_cmd_for() {
  case "$1" in
    dave2) echo "1.EXE" ;;
    *)     echo "DAVE.EXE" ;;   # dave1 + dave3
  esac
}
title_for() {
  case "$1" in
    dave1) echo "Dangerous Dave" ;;
    dave2) echo "Dangerous Dave in the Haunted Mansion" ;;
    dave3) echo "Dangerous Dave's Risky Rescue" ;;
  esac
}

# build_game <key> <src_dir> -> writes games/<key>.jsdos with the whole data set.
build_game() {
  key="$1"; src="$2"
  run=$(run_cmd_for "$key")
  # The run executable must actually be present (canonical name, else any .EXE).
  exe=$(find "$src" -maxdepth 1 -iname "$run" 2>/dev/null | head -1)
  [ -z "$exe" ] && exe=$(find "$src" -maxdepth 1 -iname "*.EXE" 2>/dev/null | head -1)
  [ -n "$exe" ] || return 1
  runcmd=$(basename "$exe" | tr '[:lower:]' '[:upper:]')

  work=$(mktemp -d)
  mkdir -p "$work/.jsdos"
  # Copy every file from the game dir (uppercasing names to DOS convention).
  for f in "$src"/*; do
    [ -f "$f" ] || continue
    bn=$(basename "$f" | tr '[:lower:]' '[:upper:]')
    cp "$f" "$work/$bn"
  done

  cat > "$work/.jsdos/dosbox.conf" <<CONF
[sdl]
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
[mixer]
nosound=false
rate=44100
[sblaster]
sbtype=sb16
oplmode=auto
oplrate=44100
[speaker]
pcspeaker=true
[dos]
xms=true
ems=true
umb=true
[autoexec]
echo off
mount c .
c:
$runcmd
CONF
  printf '[cpu]\ncycles=auto\n' > "$work/dosbox.conf"

  # rm first: zip appends to an existing archive (the image ships dave1.jsdos),
  # which would corrupt the bundle when rebuilding dave1 from /data.
  rm -f "$GAMES/$key.jsdos"
  ( cd "$work" && zip -rq -X "$GAMES/$key.jsdos" . )
  rm -rf "$work"
  return 0
}

games_json=""
add_game() {
  key="$1"
  [ -n "$games_json" ] && games_json="$games_json,"
  # Append a content hash to the bundle URL so js-dos (which caches bundles by
  # URL in IndexedDB) re-fetches whenever the data changes.
  h=$(md5sum "$GAMES/$key.jsdos" 2>/dev/null | cut -c1-8)
  title=$(title_for "$key")
  games_json="$games_json{\"key\":\"$key\",\"title\":\"$title\",\"bundle\":\"games/$key.jsdos?v=$h\"}"
}

built=""   # space-separated keys already built (each game once)
if [ -d "$DATA" ]; then
  echo "[dave-wasm] scanning $DATA for Dangerous Dave data..."
  for d in "$DATA" "$DATA"/*; do
    [ -d "$d" ] || continue
    key=$(detect_game "$d")
    [ -n "$key" ] || continue
    echo "$built" | grep -qw "$key" && continue
    if build_game "$key" "$d"; then
      echo "[dave-wasm] built $key from $d"
      add_game "$key"
      built="$built $key"
    fi
  done
fi

# Fall back to the bundled Dangerous Dave (1990) if /data didn't supply dave1.
if [ -f "$GAMES/dave1.jsdos" ] && ! echo "$built" | grep -qw dave1; then
  add_game dave1
fi

if [ -n "$games_json" ]; then
  printf '{"serverMode":true,"games":[%s]}\n' "$games_json" > "$GAMES/manifest.json"
  echo "[dave-wasm] manifest: $(cat "$GAMES/manifest.json")"
else
  rm -f "$GAMES/manifest.json"
  echo "[dave-wasm] no game data found; running in bring-your-own-data mode"
fi

exec nginx -g 'daemon off;'
