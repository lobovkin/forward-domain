# Host Forward-Domain on Hetzner — IPv6-Only with Optional IPv4

## Goal
Deploy `forward-domain` on a Hetzner VPS under `dnsredirect.eu`, IPv6-only by default, IPv4 available via explicit configuration switch. Target hardening, parameterization, and removal of redundant/dead code.

---

## 1. Code Review Findings

### Redundant / Dead Code
- `index.js:16-21` — `isMainProcess` branch is unreachable when imported by `app.js` because `import.meta.url` resolves differently. Makes the entry-point confusing.
- `src/client.js:32` and `src/sni.js:31` — Both declare `resolveCache` with the same name but store completely different data (HTTP redirects vs TLS certs). Rename one or both to eliminate confusion.
- `src/util.js:177` — Outer `if (debugLevel >= 1)` is redundant with the inner `level <= debugLevel`.

### Reliability Gaps
- `src/util.js:311-314` — `findTxtRecord` remote HTTPS fallback path (`dns.google/resolve`) lacks try/catch. Should reject gracefully so the caller returns `null` instead of crashing.
- `src/client.js:142-151` — `/flushcache` handler doesn't consume request errors; missing `req.on('error')`.

### Missing Observability / Hardening
- No access logging at all.
- No rate limiting on the redirect handler.
- `dns.google/resolve` fallback is hardcoded; should be configurable via env.

---

## 2. Configuration Changes

### Env Variables (add to `.env.example`)
```env
BIND_ADDRESS=::
ENABLE_IPV4=false
USE_LOCAL_DNS=false
RESOLVER_URL=https://dns.google/resolve
```

- `BIND_ADDRESS` — Interface to bind Node.js servers. Default `::` (all IPv6).
- `ENABLE_IPV4` — When `true`, also bind on `0.0.0.0` (dual-stack). Default `false`.
- `RESOLVER_URL` — Override Google DNS HTTPS fallback (for `findTxtRecord` and `validateCAARecords`).

### App Binding (`app.js`)
- Read `BIND_ADDRESS` (default `::`).
- Pass `{ host: BIND_ADDRESS, ipv6Only: true }` to `plainServer.listen()` and `secureServer.listen()`.
- If `ENABLE_IPV4=true`, also call `listen()` on `0.0.0.0`.
- Log actual bind addresses on startup.

### Nginx Config (document in `HOSTING.md`)
Parameterize all hardcoded values with labels the operator fills in:

| Label | Meaning |
|---|---|
| `[YOUR_HETZNER_IPV6]` | Hetzner IPv6 address from robot dashboard |
| `[HOME_DOMAIN]` | e.g., `dnsredirect.eu` |
| `[FORWARDER_PORT]` | Port the Node app listens on (default `8080`) |
| `[HOME_PORT]` | Port the home app listens on for `/stat` (default `8443`) |

**Default IPv6-only config:**

```nginx
stream {
    upstream main {
        server [YOUR_HETZNER_IPV6]:[HOME_PORT];
    }
    upstream forwarder {
        server [YOUR_HETZNER_IPV6]:[FORWARDER_PORT];
    }
    map $ssl_preread_server_name $upstream {
        [HOME_DOMAIN] main;
        default forwarder;
    }
    server {
        listen [YOUR_HETZNER_IPV6]:443;
        resolver 2606:4700:4700::1111 2606:4700:4700::1001;
        proxy_pass $upstream;
        ssl_preread on;
    }
}
http {
    server {
        server_name _ default_server;
        listen [YOUR_HETZNER_IPV6]:80;
        location / {
            proxy_pass http://127.0.0.1:[FORWARDER_PORT];
            proxy_set_header Host $host;
        }
    }
    server {
        server_name [HOME_DOMAIN];
        listen [YOUR_HETZNER_IPV6]:80;
        location / {
            proxy_pass http://127.0.0.1:[HOME_PORT];
            proxy_set_header Host $host;
        }
        listen [YOUR_HETZNER_IPV6]:[HOME_PORT] ssl;
        ssl_certificate /path/to/ssl.combined;
        ssl_certificate_key /path/to/ssl.key;
    }
}
```

**IPv4-Enabled (optional) variant:**
Un-comment the `listen [YOUR_HETZNER_IPV6]:[PORT]` and duplicate with `[YOUR_HETZNER_IPV4]:[PORT]` lines to add IPv4 listeners.

### DNS
- AAAA-only by default for `dnsredirect.eu` and `r.dnsredirect.eu`.
- If `ENABLE_IPV4=true` in production, add A records pointing to Hetzner IPv4 address.

### Firewall
- Allow `80/tcp` and `443/tcp` on IPv6 only.
- If `ENABLE_IPV4` is true, also allow `80/tcp` and `443/tcp` on IPv4.

---

## 3. Code Changes

### `app.js`
- Add `BIND_ADDRESS` / `ENABLE_IPV4` handling.
- Pass listener options to both `listen()` calls.
- Log bind addresses.

### `.env.example`
- Add three new variables shown in Section 2.

### `src/client.js`
- Rename `resolveCache` → `httpRedirectCache`.
- Update all internal references.
- Add `req.on('error')` handler in `/flushcache`.

### `src/sni.js`
- Keep naming consistent with `httpRedirectCache` in `client.js` (no functional change needed; same data boundaries).

### `src/index.js`
- Remove unreachable `isMainProcess` branch. Keep module exports only.

### `src/util.js`
- Add try/catch around `request()` in `findTxtRecord` remote path (lines ~311-314). Return `null` on failure so callers continue with `dns.resolveTxt` or `dns.resolveCaa` as designed.
- Remove redundant outer `if (debugLevel >= 1)` guard.

### `HOSTING.md`
- Parameterize nginx config as shown in Section 2.
- Add IPv4-optional variant.
- Update installation steps to reflect `BIND_ADDRESS` default `::`.

### `README.md`
- Update DNS examples to use AAAA records.
- Note `ENABLE_IPV4` as the override for old A-record clients.

### Dockerfile
- No change required for IPv6 binding. Node binds to `::` inside container. Docker will publish ports on container's IPv6-enabled address if host is IPv6-only.
- If `ipv6Only: true` causes issues inside container, drop the socket option and rely on Docker `--ipv6` flag.

---

## 4. Validation

| Check | Method |
|---|---|
| Bind addresses | `ss -tlnp \| grep :80` shows `[::]:80` only if IPv6-only; `0.0.0.0:80` only if IPv4 enabled |
| HTTP redirect works | `curl -6 -H "Host: r.dnsredirect.eu" http://[IPv6]/test` → 302 |
| HTTPS redirect works | `curl -6 --insecure -H "Host: r.dnsredirect.eu" https://[IPv6]/test` → 302 with valid cert |
| ACME challenge path | Access `/.well-known/acme-challenge/<nonce>` during cert issuance |
| `/stat` endpoint | `curl -6 -H "Host: dnsredirect.eu" http://[IPv6]/stat` → JSON |
| `/health` endpoint | `curl -6 -H "Host: dnsredirect.eu" http://[IPv6]/health` → `ok` |
| IPv4 optional | Set `ENABLE_IPV4=true`, confirm A record resolves and binds on `0.0.0.0` |
| Remote DNS fallback | Verify `dns.google/resolve` works over IPv6 when local DNS unavailable |
| Graceful failure | Simulate failed `RESOLVER_URL` */resolve* request; app must return null, not throw |

---

## 5. Infrastructure

1. Provision Hetzner VPS with IPv6-enabled image. Record /64 subnet.
2. Configure `ufw` (or `iptables`/`nftables`) to allow `80/tcp` and `443/tcp` on IPv6 only.
3. If IPv4 is wanted, also allow same ports on IPv4.
4. Install nginx with stream module. Use parameterized config.
5. Clone repo, `npm ci`, copy `.env.example` to `.env`, configure `BIND_ADDRESS` and `HOME_DOMAIN`.
6. Set systemd unit to run `node app.js` as a non-root user (or use setcap `cap_net_bind_service` if ports 80/443 are needed directly; alternatively run on high ports and let nginx proxy).
7. DNS: AAAA records for apex and `r.` subdomain. Optionally A records if `ENABLE_IPV4=true`.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Node.js `ipv6Only: true` inside Docker may fail if Hetzner kernel lacks support | Verfiy with `ss -tlnp` after deployment; fallback to omit the option and rely on Docker `--ipv6` |
| Google DNS HTTPS (`dns.google`) blocked or slow on IPv6-first networks | Configure `RESOLVER_URL` to an IPv6-friendly resolver or enable `USE_LOCAL_DNS=true` |
| Missing `req.on('error')` causes crash under chunked transfer abuse | Fix in `client.js` as listed above |
| Duplicate cache naming causes developer confusion | Rename one to `httpRedirectCache`, the other to `tlsCertCache` |

---

## 7. Rollout Path

1. Fix dead code and rename caches (low risk, no behavior change).
2. Add `BIND_ADDRESS` + `ENABLE_IPV4` to `app.js`; test locally with `BIND_ADDRESS=::`.
3. Parameterize `HOSTING.md` nginx config.
4. Add remote DNS error handling in `src/util.js`.
5. Update documentation (README, .env.example) for IPv6-first instructions.
6. Provision Hetzner VPS, deploy nginx + Node, verify checks in Section 4.

---

## 8. Open Questions

None remaining. Ready to implement.
