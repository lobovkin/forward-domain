# Forward Domain

[![GitHub Repo stars](https://img.shields.io/github/stars/lobovkin/forward-domain?style=for-the-badge)](https://github.com/lobovkin/forward-domain/stargazers)
[![Uptime Robot ratio (30 days)](https://img.shields.io/uptimerobot/ratio/m802290576-83ad77ddde5a1154e00d824a?style=for-the-badge)](https://stats.uptimerobot.com/23TXC8bATV)

<img src="https://dev-to-uploads.s3.amazonaws.com/uploads/articles/7lp67jpzvabtf8opyzaf.png" alt="Banner" width="600">

> For hosting guide See [HOSTING.md](HOSTING.md) and [CHANGES.md](CHANGES.md)

This service forwards domains using HTTP(s) redirects.

Example scenarios:

+ Forward non-www to www domains or vice versa
+ Forward old domains to new domains

Why using this service?

+ No coding required
+ No hosting required
+ No registration required
+ Completely anonymous
+ Completely free

How does it works?

+ Point your domain to us using CNAME or A/AAAA records
+ Tell us where to forward using TXT records
+ We handle HTTPS certificates for you

## Get Started

To forward from `www.old.com` to `old.com`, add these records to your DNS:

```
www.old.com     IN    CNAME   r.dnsredirect.eu
_.www.old.com   IN    TXT     forward-domain=https://old.com/*
```

Because CNAME can't be used in apex domains, you can use A/AAAA records.<br>
To forward from `old.com` to `new.net`, add these records to your DNS:

```
old.com     IN    AAAA    2a01:4f8:1c18:eed4::
_.old.com   IN    TXT     forward-domain=https://new.net/*
```

The star `*` at the end tells us that the remaining URL path is also need to be forwarded to the destination URL.

> If you use Cloudflare or any DNS which supports [CNAME Flattening](https://blog.cloudflare.com/introducing-cname-flattening-rfc-compliant-cnames-at-a-domains-root/), you still can use CNAME records pointing to `r.dnsredirect.eu`. It's recommended to use CNAME records rather than A/AAAA records.

You can choose the type of redirection you want to use by declaring the `http-status` value:

```
www.old.com     IN    CNAME   r.dnsredirect.eu
_.www.old.com   IN    TXT     http-status=302;forward-domain=https://old.com/*
```

The HTTP codes available for use include:

+ `301` Permanent redirection (default)
+ `302` Temporary redirection (may keeping SEO from indexing new location)
+ `307` Temporary redirection while keeping HTTP verb
+ `308` Permanent redirection while keeping HTTP verb

## FAQ

### Is it really free?

Forwarding domains should be easy to setup.<br>
I use this myself for [domcloud.dev](https://domcloud.dev).<br>

### How can I check redirects will work?

This service uses Google's [Public DNS Resolver](https://dns.google).<br>
Once first accessed, values will be cached for a day.<br>
For right now there's no way to flush the cache sorry.

### Why it loads slowly?

It only slow at first time because it has to sign HTTPS certificates.

### How about IPv6?

IPv6 is supported by default. The service binds to IPv6 addresses (`::`) and services AAAA records. For self-hosting, see `HOSTING.md` for IPv6-only configuration. IPv4 support is optional via `ENABLE_IPV4=true` environment variable.

### What records do we keep?

We only keep caches of DNS records and SSL certs. This also means we can see how many users and what domains are using our service from the software cache, but that's all. We don't keep log traffic nor keep any user data anywhere on our server.

### How can I support this service?

Star our repo and spread the word, please :)

Additionally, you can also help us [cover hosting costs](https://github.com/sponsors/willnode).

## Credits

Things in `package.json`. I also borrow code from [zbo14/certnode](https://github.com/zbo14/certnode).

## Usual Disclaimer

```
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
