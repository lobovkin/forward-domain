import tls from "tls";
import path from "path";
import AsyncLock from 'async-lock';
import { Client } from "./certnode/lib/index.js";
import { CertsDB } from "./db.js";
import { LRUCache } from 'lru-cache'
import {
    blacklistRedirectUrl,
    isIpAddress,
    isHostBlacklisted,
    ensureDirSync,
    isExceedHostLimit,
    isExceedLabelLimit,
    validateCAARecords,
    findTxtRecord,
    derToPem
} from "./util.js";

const lock = new AsyncLock();
// the regex is for Windows shenanigans
const __dirname = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:\/)/, '$1');
const certsDir = path.join(__dirname, '../.certs');
const dbFile = path.join(__dirname, '../.certs/db.sqlite');
const client = new Client();
ensureDirSync(certsDir);
const db = new CertsDB(dbFile);

/**
 * @type {LRUCache<string, import("./db.js").CertCache>}
 */
let tlsCertCache = new LRUCache({ max: 10000 });


/**
 * @type {{domains: number, in_mem: number, iat: number, exp: number}}
 */
let statCache;

function pruneCache() {
    tlsCertCache = new LRUCache({ max: 10000 });
}

function getStat() {
    if (statCache && statCache.exp > Date.now()) {
        return statCache;
    }
    statCache = {
        domains: db.countCert(),
        in_mem: tlsCertCache.size,
        iat: Date.now(),
        exp: Date.now() + 1000 * 60 * 60,
    };
    return statCache;
}

/**
 * @param {string} host
 * @returns {Promise<import("./db.js").CertCache | null>}
 */
async function buildCache(host) {
    try {
        let data = db.resolveCertAsCache(host);
        if (Date.now() > data.expire)
            throw new Error('expired');
        return data;
    }
    catch {
        if ((isHostBlacklisted(host) && !blacklistRedirectUrl) || isIpAddress(host)) {
            return null;
        }
        if (isExceedHostLimit(host) || isExceedLabelLimit(host) || await validateCAARecords(host)) {
            return null;
        }

        // Check if domain has redirect DNS record
        const txtRecord = await findTxtRecord(host);
        if (!txtRecord) {
            return null;
        }

        // can only process one certificate generation at a time
        return await lock.acquire('cert', async () => {
            // race condition check
            try {
                let data = db.resolveCertAsCache(host);
                if (Date.now() < data.expire) {
                    return data;
                }
            } catch { };

            const { cert, key } = await client.generateCertificate(host);
            const { expire } = db.saveCertFromCache(host, key, cert);
            return {
                cert,
                key,
                expire,
            };
        });
    }
}
/**
 * @param {string} servername
 */
async function getKeyCert(servername) {
    servername = servername.toLowerCase();
    const cache = tlsCertCache.get(servername);
    if (!cache || (Date.now() > cache.expire)) {
        let cacheNew = await buildCache(servername);
        if (!cacheNew) {
            return undefined;
        }
        tlsCertCache.set(servername, cacheNew);
        return {
            key: cacheNew.key,
            cert: cacheNew.cert,
        }
    }
    return {
        key: cache.key,
        cert: cache.cert,
    };
}
/**
 * @param {string} servername
 * @param {(err: any, cb: tls.SecureContext|undefined) => void} ctx
 */
async function SniListener(servername, ctx) {
    // Generate fresh account keys for Let's Encrypt
    try {
        const keyCert = await getKeyCert(servername);
        ctx(null, keyCert && tls.createSecureContext(keyCert));
    }
    catch (error) {
        console.log(error);
        ctx(error, undefined);
    }
}

const SniPrepare = async () => {
    let config = db.getConfig();
    if (config.accountPrivateKey && config.accountPublicKey) {
        await client.importAccountKeyPair(
            config.accountPrivateKey,
            config.accountPublicKey,
            '');
    } else {
        console.log("Creating new account key pair");
        await client.generateAccountKeyPair();
        Object.assign(config, client.exportAccountKeyPair(''));
        // Note we save this as PEM format cause this isn't BLOB
        db.saveConfig('accountPublicKey', config.accountPublicKey || '');
        db.saveConfig('accountPrivateKey', config.accountPrivateKey || '');
    }
};

const SniDispose = () => {
    db.close();
}

export {
    SniListener,
    SniPrepare,
    SniDispose,
    pruneCache,
    getStat,
    client,
};
