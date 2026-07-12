import https from "https";
import http from "http";
import { listener } from "./src/client.js";
import { SniPrepare, SniListener, SniDispose } from "./src/sni.js";

// development endpoint (use ngrok)
const plainServer = http.createServer(listener);
const secureServer = https.createServer({
    SNICallback: SniListener,
}, listener);

secureServer.on('listening', SniPrepare);
secureServer.on('close', SniDispose)

export {
    plainServer,
    secureServer
}

