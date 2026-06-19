# Deploying dave-wasm to box.dnsif.ca & pro.dnsif.ca

Each host runs its own container + nginx reverse proxy. The full retail Dave 2/3 files live in a
mounted `/data`, so all three games run with no uploads and the bring-your-own UI is hidden.

```
            *.dnsif.ca wildcard DNS + wildcard TLS cert
                          │
        box.dnsif.ca ─────┤                   pro.dnsif.ca ─────┐
                          ▼                                     ▼
   ┌──────────────────────────────┐         ┌──────────────────────────────┐
   │ nginx :443 (host)            │         │ nginx :443 (host)            │
   │   proxy_pass 127.0.0.1:5024  │         │   proxy_pass 127.0.0.1:5024  │
   │ docker: awkto/dave-wasm      │         │ docker: awkto/dave-wasm      │
   │   /srv/dave-data:/data:ro    │         │   /srv/dave-data:/data:ro    │
   └──────────────────────────────┘         └──────────────────────────────┘
```

## 1. Stage the game files on each host

Put the **full** versions under `/srv/dave-data`, one subdir per game:

```
/srv/dave-data/
├── dave1/   DAVE.EXE  EGADAVE.DAV  DSCORES.DAV  CHKLIST.CPS
├── dave2/   1.EXE  *.DD2  (EGATILES, LEVEL01-08, S_*, TITLE1/2, INTRO, PROGPIC, STARPIC, CTLPANEL)
└── dave3/   DAVE.EXE  EGAGRAPH.DAV  GAMEMAPS.DAV  AUDIO.DAV  GFX_LIB.DAV  DIGSND.DAV  CONFIG.DAV  DAVE3.CHT
```

From your workstation (the files are staged in this repo's gitignored `deploy/data/`):

```bash
rsync -av deploy/data/  root@box.dnsif.ca:/srv/dave-data/
rsync -av deploy/data/  root@pro.dnsif.ca:/srv/dave-data/
```

## 2. Run the container

Copy `deploy/docker-compose.yml` to each host and bring it up:

```bash
docker compose up -d           # pulls awkto/dave-wasm:latest, mounts /srv/dave-data
docker logs dave-wasm          # should list: built dave1/dave2/dave3 + the manifest
```

(If CI hasn't pushed the image yet, switch the compose file to the local `build:` block, or
`docker build -t awkto/dave-wasm . && docker save | ...`.)

## 3. nginx reverse proxy + TLS

Install `deploy/nginx-dave.conf` on each host, setting `server_name` (`box.dnsif.ca` on box,
`pro.dnsif.ca` on pro) and pointing `ssl_certificate*` at the `*.dnsif.ca` wildcard cert:

```bash
cp deploy/nginx-dave.conf /etc/nginx/conf.d/dave-wasm.conf
# edit server_name + cert paths
nginx -t && systemctl reload nginx
```

Both names are single-label subdomains of `dnsif.ca`, so the `*.dnsif.ca` wildcard cert covers
them with no per-host certificate.

## 4. DNS

Ensure `box.dnsif.ca` and `pro.dnsif.ca` resolve to each host's public IP. If the `*.dnsif.ca`
wildcard record already points at the right place this is automatic; otherwise add explicit A/AAAA
records for the two names.

## Verify

```bash
curl -sk https://box.dnsif.ca/games/manifest.json
# {"serverMode":true,"games":[{"key":"dave1",...},{"key":"dave2",...},{"key":"dave3",...}]}
```

Open the site: it should show three one-click **Play** buttons and **no** upload card.

## Updating

```bash
docker compose pull && docker compose up -d     # new image
# bundles rebuild from /data at every container start; no extra step needed
```
