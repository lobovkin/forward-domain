# Self-Hosting Guide

This guide will walk you through the process of setting up your own instance of ForwardDomain. This is not a guide for setting up a development environment, but rather a guide for setting up a production instance.

## Prerequisites

- `node` LTS node (20.x or higher)
- `go` (>= 1.22) and `bun` (>= 1.1) for running tests
- A server with public IPv6 address (IPv4 optional)
- NGINX with stream module (optional, for reverse proxy)

## Installation

1. Clone the repository: `git clone https://github.com/willnode/forward-domain.git`
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in the values
4. Run the app: `npm start`

## Configuration

### Environment Variables

| Variable | Description |
| --- | --- |
| `HTTP_PORT` | The port to listen for HTTP requests |
| `HTTPS_PORT` | The port to listen for HTTPS requests |
| `WHITELIST_HOSTS` | A comma-separated list of root domains to whitelist |
| `BLACKLIST_HOSTS` | A comma-separated list of root domains to blacklist |
| `BLACKLIST_REDIRECT` | The URL to redirect to when a blacklisted host is accessed |
| `HOME_DOMAIN` | The host to enable `/stat` endpoint |
| `USE_LOCAL_DNS` | Default is `false`, so the Google DNS is used. Set it to `true` if you want to use the DNS resolver of your own host |
| `CACHE_EXPIRY_SECONDS` | Option to override the default cache TTL of 86400 seconds (1 day) |
| `DEBUG_LEVEL` | Default level is 0 (disabled) and can be set up to level 3 for maximum information |
| `BIND_ADDRESS` | IPv6 address to bind to (default `::` for all IPv6). Set to `0.0.0.0` to listen on all IPv4 only. |
| `ENABLE_IPV4` | Set to `true` to also listen on IPv4 (dual-stack). Default is `false` (IPv6-only). |
| `RESOLVER_URL` | DNS-over-HTTPS resolver URL (default `https://dns.google/resolve`). |

If `WHITELIST_HOSTS` is set, `BLACKLIST_HOSTS` is ignored. Both is mutually exclusive.

If `BLACKLIST_REDIRECT` empty or unset, it will not attempt to generate certificates on HTTPS (resulting "alert handshake failure" closing connection immediately) or return 403 on HTTP. It's recommended to leave this blank if `WHITELIST_HOSTS` is set.

### Network Binding

- By default, the app binds to `::` (all IPv6 addresses) with `ipv6Only: true`.
- Set `ENABLE_IPV4=true` to also bind to `0.0.0.0` (IPv4).
- For IPv6-only deployments (recommended), leave `BIND_ADDRESS=::` and `ENABLE_IPV4=false`.

### Startup Files

+ `app.js` This is the startup file for production, listening on both `HTTP_PORT` and `HTTPS_PORT`.
+ `index.js` This is for development or testing only, exporting the server modules.
+ The `/stat`, `/health`, and `/flushcache` endpoints are served on the host set in `HOME_DOMAIN` (no separate process is required).

### SSL Certificates

SSL certificates is saved in `./.certs` directory. No additional configuration is needed. 

## Running the App

`sudo npm start` is recommended to run the app. This is because the app needs to listen to port 80 and 443 directly, which requires root access.

If you want to run the app without root access, or wanted to filter some domains for other services, you have to use NGINX with stream plugin.

## NGINX + Stream Plugin

You cannot run this server via regular NGINX's `server` directive because that's mean you won't get benefited from automatic HTTPS cert installation and only-DNS-needed setup approach.

[NGINX Stream plugin](http://nginx.org/en/docs/stream/ngx_stream_core_module.html) is used to filter some domain while still be able forwards HTTPS connection directly. It has to be that way since NGINX doesn't handle HTTPS certificates.

This configuration below sets up an IPv6-only reverse proxy. Replace the placeholder values with your actual configuration:

### Placeholders

| Placeholder | Description |
| --- | --- |
| `[YOUR_HETZNER_IPV6]` | Your Hetzner IPv6 address (e.g., `2a01:4f8:1c18:eed4::`) |
| `[HOME_DOMAIN]` | Your configured `HOME_DOMAIN` (e.g., `dnsredirect.eu`) |
| `[FORWARDER_PORT]` | The HTTP port the app listens on (default `8080`) |
| `[HOME_PORT]` | The HTTPS port the app listens on (default `8443`) |

### IPv6-Only Nginx Config

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

include /usr/share/nginx/modules/*.conf;

events {
    worker_connections  1024;
}
stream {
    upstream main {
        server 127.0.0.1:8443;
    }
    upstream forwarder {
        server 127.0.0.1:8080;
    }

    map $ssl_preread_server_name $upstream {
        HOME_DOMAIN main;
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
        server_name HOME_DOMAIN;
        listen [YOUR_HETZNER_IPV6]:80;
        location / {
            proxy_pass http://127.0.0.1:8443;
            proxy_set_header Host $host;
        }
        listen [YOUR_HETZNER_IPV6]:8443 ssl;
        ssl_certificate /path/to/ssl.combined;
        ssl_certificate_key /path/to/ssl.key;
    }
}
```

### Dual-Stack (IPv4 + IPv6) - Optional

To enable IPv4, add these additional listen directives (uncomment all `listen IPv4` lines) and set `ENABLE_IPV4=true` in your `.env`:

```nginx
stream {
    # ... upstream definitions same as above ...
    server {
        listen [YOUR_HETZNER_IPV6]:443;   # IPv6
        listen [YOUR_HETZNER_IPV4]:443;   # IPv4 (optional)
        resolver 2606:4700:4700::1111 2606:4700:4700::1001;
        proxy_pass $upstream;
        ssl_preread on;
    }
}
http {
    server {
        server_name _ default_server;
        listen [YOUR_HETZNER_IPV6]:80;    # IPv6
        listen YOUR_HETZNER_IPV4:80;      # IPv4 (optional)
        location / {
            proxy_pass http://127.0.0.1:[FORWARDER_PORT];
            proxy_set_header Host $host;
        }
    }
    server {
        server_name HOME_DOMAIN;
        listen [YOUR_HETZNER_IPV6]:80;    # IPv6
        listen YOUR_HETZNER_IPV4:80;      # IPv4 (optional)
        location / {
            proxy_pass http://127.0.0.1:8443;
            proxy_set_header Host $host;
        }
        listen [YOUR_HETZNER_IPV6]:8443 ssl;  # IPv6
        listen YOUR_HETZNER_IPV4:8443 ssl;      # IPv4 (optional)
        ssl_certificate /path/to/ssl.combined;
        ssl_certificate_key /path/to/ssl.key;
    }
}
```

## Firewall Configuration

For IPv6-only deployments, configure your firewall to only allow IPv6 ports:

```bash
# ufw
ufw allow 80/tcp
ufw allow 443/tcp

# Or iptables for IPv6 only
ip6tables -A INPUT -p tcp --dport 80 -j ACCEPT
ip6tables -A INPUT -p tcp --dport 443 -j ACCEPT
```

If `ENABLE_IPV4=true`, also allow IPv4 ports as needed.
