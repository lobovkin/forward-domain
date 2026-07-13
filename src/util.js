import request from "./certnode/lib/request.js";
import fs from "node:fs";
import { isIPv4, isIPv6 } from "node:net";
import { fileURLToPath } from "node:url";
import dns from 'dns/promises';
import forge from "node-forge";
const recordParamDestUrl = 'forward-domain';
const recordParamHttpStatus = 'http-status';
const caaRegex = /^0 issue (")?letsencrypt\.org(;validationmethods=http-01)?\1$/;
const validDebugLevels = [0, 1, 2, 3];

/**
 * @type {Record<string, boolean>}
 */
const allowedHttpStatusCodes = {
    "301": true, // Legacy Permanent Redirect with POST -> GET
    "302": true, // Legacy Temporary Redirect with POST -> GET
    "307": true, // Modern Temporary Redirect with POST -> POST
    "308": true, // Modern Permanent Redirect with POST -> POST
}


/**
 * @type {boolean | null}
 */
let useLocalDNS = null
/**
 * @type {string | null}
 */
let resolverUrl = null;
/**
 * @type {Record<string, boolean> | null}
 */
let blacklistMap = null;
/**
 * @type {Record<string, boolean> | null}
 */
let whitelistMap = null;
/**
 * @type {number | null}
 */
let cacheExpirySeconds = null;
/**
 * @type {number | null}
 */
let debugLevel = null

export function getExpiryDate() {
    if (cacheExpirySeconds === null) {
        cacheExpirySeconds = parseInt(process.env.CACHE_EXPIRY_SECONDS || '86400')
    }
    return Date.now() + cacheExpirySeconds * 1000;
}

/**
 * @returns {string}
 */
function getResolverUrl() {
    if (resolverUrl === null) {
        resolverUrl = process.env.RESOLVER_URL || 'https://dns.google/resolve';
    }
    return resolverUrl;
}

/**
 * @returns {Record<string, any>}
 */
export function initMap() {
    return {}
}

/**
 * @type {string?}
 */
export let blacklistRedirectUrl = null;

/**
 * @param {string} str
 * @return {Array<number>}
 */
function findDotPositions(str) {
    let dotPositions = [0];
    let index = str.indexOf('.');

    while (index !== -1) {
        dotPositions.push(index + 1);
        index = str.indexOf('.', index + 1);
    }

    return dotPositions;
}


/**
 * @param {string} str
 * @return {Record<string, boolean>}
 */
function csvToMap(str) {
    return (str || "").split(',').reduce((acc, host) => {
        host = host.trim().toLowerCase();
        const labelPositions = findDotPositions(host);
        for (let i = labelPositions.length; i-- > 0;) {
            acc[host.slice(labelPositions[i])] = i == 0
        }
        return acc;
    }, initMap())
}

/**
* @return {void}
*/
export function clearConfig() {
    whitelistMap = null;
    blacklistMap = null;
    useLocalDNS = null;
    blacklistRedirectUrl = null;
    cacheExpirySeconds = null;
    debugLevel = null;
    resolverUrl = null;
}

/**
 * @param {Record<string, string>} [mockEnv]
 */
export function isHostBlacklisted(domain = '', mockEnv = undefined) {
    if (blacklistMap === null || mockEnv) {
        let env = mockEnv || process.env;
        if (env.WHITELIST_HOSTS) {
            whitelistMap = csvToMap(env.WHITELIST_HOSTS || "");
        }
        blacklistMap = csvToMap(env.BLACKLIST_HOSTS || "");
        blacklistRedirectUrl = env.BLACKLIST_REDIRECT || null;
    }
    const labelPositions = findDotPositions(domain);
    if (whitelistMap === null) {
        for (let i = labelPositions.length; i-- > 0;) {
            let val = blacklistMap[domain.slice(labelPositions[i])]
            if (val === false) {
                continue;
            } else if (val === true) {
                return true;
            } else {
                return false;
            }
        }
        return false;
    } else {
        for (let i = labelPositions.length; i-- > 0;) {
            let val = whitelistMap[domain.slice(labelPositions[i])]
            if (val === false) {
                continue;
            } else if (val === true) {
                return false;
            } else {
                return true;
            }
        }
        return true;
    }
}

/**
 * Returns the current date and time in the format: "YYYY-MM-DD HH:MM:SS".
 *
 * @returns {string} The current date and time as a formatted string.
 */
export function CurrentDate() {
    const now = new Date();

    return (
        now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0')
    );
}

/**
 * Outputs debug messages to the console based on the specified debug level.
 * Debugging is controlled by the `DEBUG_LEVEL` environment variable.
 *
 * @param {number} level - The debug level of the message (1 - 3).
 * @param {string} msg - The debug message to output.
 * 
 */
export function debugOutput(level,msg) {
    if (debugLevel === null) {
        debugLevel = validDebugLevels.includes(parseInt(process.env.DEBUG_LEVEL)) ? parseInt(process.env.DEBUG_LEVEL) : 0;
    }
    if (level <= debugLevel) {
        const date = CurrentDate();
        console.log(`[${date}] ${msg}`);
    }
}

/**
 * @param {string} host
 */
export function isIpAddress(host) {
    return isIPv4(host) || isIPv6(host)
}
/**
 * @param {string} host
 */
export function isExceedLabelLimit(host) {
    return [...host].filter(x => x === '.').length >= 10
}
/**
 * @param {string} host
 */
export function isExceedHostLimit(host) {
    return host.length > 64
}
/**
 * @param {string} code
 */
export function isHttpCodeAllowed(code) {
    return allowedHttpStatusCodes[code] || false
}
/**
 * @param {fs.PathLike} dir
 */
export function ensureDirSync(dir) {
    try {
        fs.accessSync(dir, fs.constants.W_OK | fs.constants.O_DIRECTORY);
    }
    catch (error) {
        fs.mkdirSync(dir, {
            recursive: true
        });
    }
}

/**
 * @param {string} value
 */
const parseTxtRecordData = (value) => {
    /**
     * @type {Record<string, string>}
     */
    const result = {};
    for (const part of value.split(';')) {
        const [key, ...value] = part.split('=');
        if (key && value.length > 0) {
            result[key] = value.join('=');
        }
    }
    return result;
}

/**
 * @param {string} host
 * @param {any} mockResolve
 * @return {Promise<string[] | null>}
 */
export async function validateCAARecords(host, mockResolve = undefined) {
    if (useLocalDNS === null) {
        useLocalDNS = process.env.USE_LOCAL_DNS == 'true';
	debugOutput(3, `useLocalDNS: ${useLocalDNS}`);
    }
    let issueRecords;
    if (useLocalDNS && !mockResolve) {
        const records = mockResolve || await dns.resolveCaa(host).catch(() => null);
        issueRecords = (records || []).filter(record => record.issue).map(record => `0 issue "${record.issue}"`);

    } else {
        /**
         * @type {{data: {Answer: {data: string, type: number}[]}}}
         */
        let resolve;
        try {
            resolve = mockResolve || await request(`${getResolverUrl()}?name=${encodeURIComponent(host)}&type=CAA`);
        } catch (err) {
            debugOutput(3, `validateCAARecords resolver failed: ${err.message}`);
            return null;
        }
        if (!resolve.data.Answer) {
            return null;
        }

        issueRecords = resolve.data.Answer.filter((x) =>
            x.type == 257 && typeof x.data === 'string' && x.data.startsWith('0 issue ')
        ).map(x => x.data);
    }

    // Check if any record allows Let's Encrypt (or no record at all)
    if (issueRecords.length === 0 || issueRecords.some(record => caaRegex.test(record))) {
        return null;
    }

    debugOutput(3, `issueRecords for ${host}: ${issueRecords}`);
    return issueRecords;
}

/**
 * @param {string} host
 * @param {any} mockResolve
 * @return {Promise<{url: string, httpStatus?: string} | null>}
 */
export async function findTxtRecord(host, mockResolve = undefined) {
    if (useLocalDNS === null) {
        useLocalDNS = process.env.USE_LOCAL_DNS == 'true';
    }
    if (useLocalDNS && !mockResolve) {
        const resolvePromises = [
            dns.resolveTxt(`_.${host}`),
            dns.resolveTxt(`fwd.${host}`)
        ];
    
        const resolved = await Promise.any(resolvePromises).catch(() => null);
    
        if (resolved) {
	    debugOutput(2, `findTxtRecord for ${host}: ${resolved}`);
            for (const record of resolved) {
                const joinedRecord = record.join(';');
                const txtData = parseTxtRecordData(joinedRecord);
                if (!txtData[recordParamDestUrl]) continue;
                return {
                    url: txtData[recordParamDestUrl],
                    httpStatus: txtData[recordParamHttpStatus],
                };
            }
        }
    } else {
        /**
         * @type {{data: string, type: number}[]}
         */
        let resolve;
        try {
            const baseUrl = getResolverUrl();
            resolve = mockResolve ? mockResolve.data.Answer : [
                ...(await request(`${baseUrl}?name=_.${encodeURIComponent(host)}&type=TXT`)).data.Answer || [],
                ...(await request(`${baseUrl}?name=fwd.${encodeURIComponent(host)}&type=TXT`)).data.Answer || [],
            ];
        } catch (err) {
            debugOutput(3, `findTxtRecord resolver failed: ${err.message}`);
            return null;
        }
        for (const head of resolve) {
            if (head.type !== 16) { // RR type of TXT is 16
                continue;
            }
            const txtData = parseTxtRecordData(head.data);
            if (!txtData[recordParamDestUrl]) continue;
            debugOutput(2, `findTxtRecord for ${host}: ${txtData[recordParamDestUrl]}`);
            return {
                url: txtData[recordParamDestUrl],
                httpStatus: txtData[recordParamHttpStatus],
            };
        }
    }
    return null;
}

/**
 * 
 * @param {string} cert 
 */
export function getCertExpiry(cert) {
    const x509 = forge.pki.certificateFromPem(cert);
    debugOutput(3, `LE cert expire after: ${x509.validity.notAfter.getTime()}`);
    return x509.validity.notAfter.getTime()
}

/**
 * 
 * @param {string} key 
 */
export function pemToDer(key) {
    const keys = forge.pem.decode(key);
    return keys.map(x => Buffer.from(x.body, 'binary'));
}

/**
 * @param {Buffer|Buffer[]} derBuffer
 * @param {"public"|"private"|"certificate"} type
 * @returns {string}
 */
export function derToPem(derBuffer, type) {
    if (Array.isArray(derBuffer)) {
        return derBuffer.filter(x => x && x.length > 0).map(x => derToPem(x, type)).join('');
    }
    const prefix = {
        'certificate': 'CERTIFICATE',
        'public': 'PUBLIC KEY',
        'private': 'PRIVATE KEY'
    }[type];

    const header = `-----BEGIN ${prefix}-----\n`;
    const footer = `-----END ${prefix}-----\n`;

    const base64Content = derBuffer.toString('base64').match(/.{0,64}/g) || [];
    const pemContent = `${header}${base64Content.join('\n')}${footer}`;
    return pemContent;
}

/**
 * @param {string} baseURL
 * @param {string} relativeURL
 */
export function combineURLs(baseURL, relativeURL) {
    if (!relativeURL) {
        return baseURL;
    }
    return baseURL.replace(/\/+$/, '') + '/' + relativeURL.replace(/^\/+/, '');
}

/**
 * @param {string} metaURL
 */
export function isMainProcess(metaURL) {
    return [process.argv[1], process.env.pm_exec_path].includes(fileURLToPath(metaURL));
}
