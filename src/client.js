import { LRUCache } from "lru-cache";
import { client, getStat } from "./sni.js";
import querystring from 'querystring';
import validator from 'validator';
import {
    findTxtRecord,
    isHostBlacklisted,
    combineURLs,
    isIpAddress,
    blacklistRedirectUrl,
    isExceedLabelLimit,
    validateCAARecords,
    isExceedHostLimit,
    isHttpCodeAllowed,
    debugOutput,
    getExpiryDate
} from "./util.js";

const MAX_DATA_SIZE = 10 * 1024; // 10 KB

/**
 * @typedef {Object} Cache
 * @property {string} url
 * @property {boolean} expand
 * @property {boolean} blacklisted
 * @property {number} expire
 * @property {number} httpStatus
 */
/**
 * @type {LRUCache<string, Cache>}
 */
let httpRedirectCache = new LRUCache({ max: 10000 });

function pruneCache() {
    httpRedirectCache = new LRUCache({ max: 10000 });
}

/**
 * @param {string} host
 * @returns {Promise<Cache>}
 */
async function buildCache(host) {
    if (isIpAddress(host)) {
        // https://community.letsencrypt.org/t/90635/2
        throw new Error('unable to serve with direct IP address');
    }
    if (isExceedHostLimit(host)) {
        // https://stackoverflow.com/q/39035571/3908409
        throw new Error('Host name is too long (Must no more than 64 char)');
    }
    if (isExceedLabelLimit(host)) {
        // https://community.letsencrypt.org/t/138688/5
        throw new Error('Host parts is too long (Must less than 10 dots)');
    }
    let caaRecords = await validateCAARecords(host);
    if (caaRecords) {
        // https://community.letsencrypt.org/t/199119/2
        throw new Error(`CAA record is not "letsencrypt.org". Records found: ${caaRecords}.`);
    }
    let expand = false;
    let recordData = await findTxtRecord(host);
    if (!recordData) {
        throw new Error(`The TXT record data for "_.${host}" or "fwd.${host}" is missing`);
    }
    let { url, httpStatus = '302' } = recordData;
    if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
        throw new Error(`The TXT record data for "_.${host}" or "fwd.${host}" is not an absolute URL`);
    }
    if (url.endsWith('*')) {
        url = url.slice(0, -1);
        expand = true;
    }
    if (!isHttpCodeAllowed(httpStatus)) {
        throw new Error(`The record "${url}" wants to use the http status code ${httpStatus} which is not allowed (only 301, 302, 307 and 308)`);
    }
    return {
        url,
        expand,
        blacklisted: isHostBlacklisted(host),
        expire: getExpiryDate(),
        httpStatus: parseInt(httpStatus),
    };
}

const acme_prefix = '/.well-known/acme-challenge/';

/**
 * @type {import('http').RequestListener}
 */
const listener = async function (req, res) {
    try {
        const url = req.url || '';
        if (url.startsWith(acme_prefix)) {
            if (client.challengeCallbacks) {
                res.writeHead(200, {
                    // This is important :)
                    'content-type': 'application/octet-stream'
                });
                res.write(client.challengeCallbacks());
            }
            else {
                res.writeHead(404);
            }
            return;
        }
        const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
        if (!host) {
            res.writeHead(400);
            res.write('Host header is required');
            return;
        }
        debugOutput(1, `Received HTTP request for ${host}`);
        if (host === process.env.HOME_DOMAIN) {
            // handle CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Access-Control-Max-Age', '86400');
            if (req.method === 'OPTIONS') {
                res.statusCode = 204;
                return;
            }

            switch (url) {
                case '/stat':
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.write(JSON.stringify(getStat()));
                    return;
                case '/health':
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.write("ok");
                    return;
                case '/flushcache':
                    if (req.method !== 'POST') {
                        res.writeHead(405, { 'Content-Type': 'text/plain' });
                        res.write("Method Not Allowed");
                        return;
                    }
                    let body = '';
                    let totalSize = 0;

                    req.on('data', chunk => {
                        totalSize += chunk.length;
                        // Disconnect if the data stream is too large
                        if (totalSize > MAX_DATA_SIZE) {
                            debugOutput(3, `Data stream for request ${host} too large`);
                            req.destroy();
                            return;
                        }

                        body += chunk.toString();
                    });

                    req.on('end', () => {
                        if (totalSize <= MAX_DATA_SIZE) {
                            const parsedData = querystring.parse(body);
                            const domain = parsedData.domain;

                            if (!domain || typeof domain !== 'string') {
                                return;
                            }

                            if (validator.isFQDN(domain)) {
                                const cacheExists = httpRedirectCache.get(domain);
                                if (cacheExists) {
                                    // Remove the cache entry
                                    httpRedirectCache.delete(domain);
                                    debugOutput(1, `Cache cleared for ${domain}`);
                                }
                            }
                        }
                    });

                    req.on('error', (err) => {
                        debugOutput(3, `Request error during flushcache: ${err.message}`);
                    });
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.write("Cache cleared");
                    return;
            }

        }
        let cache = httpRedirectCache.get(host);
        if (!cache || (Date.now() > cache.expire)) {
            cache = await buildCache(host);
            httpRedirectCache.set(host, cache);
            debugOutput(1, `No cache found for ${host}, storing new data`);
        } else {
            debugOutput(1, `Found cache for ${host}, using stored data`);
	    }
        if (cache.blacklisted) {
            if (blacklistRedirectUrl) {
                res.writeHead(302, {
                    'Location': blacklistRedirectUrl + "?d=" + encodeURIComponent(req.headers.host + ""),
                });
            } else {
                res.writeHead(403);
                res.write('Host is forbidden');
            }
            return;
        }
        res.writeHead(cache.httpStatus, {
            'Location': cache.expand ? combineURLs(cache.url, url) : cache.url,
        });
        return;
    }

    catch (/** @type {any} */ error) {
        const message = error?.message;
        res.writeHead(message ? 400 : 500);
        res.write(message || 'Unknown error');
    }
    finally {
        res.end();
    }
};

export {
    listener,
    pruneCache,
    buildCache,
}
