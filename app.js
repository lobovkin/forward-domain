import { plainServer, secureServer } from "./index.js";
import { pruneCache as pruneCacheSni } from "./src/sni.js";
import { pruneCache as pruneCacheClient } from "./src/client.js";
import { clearConfig } from "./src/util.js";
import fs from "fs";
import { watch } from "chokidar";
import dotenv from "dotenv";

function reloadEnv() {
  if (fs.existsSync('.env')) {
    const envConfig = dotenv.parse(fs.readFileSync('.env'));
    for (const k in envConfig) {
      process.env[k] = envConfig[k];
    }
    console.log('Environment variables reloaded.');
  } else {
    console.warn('.env file does not exist.');
  }
}

watch('.env').on('change', () => {
  console.log('.env file changed, reloading...');
  clearConfig();
  pruneCacheClient();
  pruneCacheSni();
  reloadEnv();
});

reloadEnv();

const port80 = parseInt(process.env.HTTP_PORT || "8080");
const port443 = parseInt(process.env.HTTPS_PORT || "8443");
const bindAddress = process.env.BIND_ADDRESS || "::";
const enableIpv4 = process.env.ENABLE_IPV4 === "true";
console.log("Forward Domain running with env", process.env.NODE_ENV);

const listenOptions = { host: bindAddress, ipv6Only: true };
plainServer.listen(port80, listenOptions, () => {
    console.log(`HTTP server listening on [${bindAddress}]:${port80}`);
});
secureServer.listen(port443, listenOptions, () => {
    console.log(`HTTPS server listening on [${bindAddress}]:${port443}`);
});

if (enableIpv4) {
    const ipv4ListenOptions = { host: "0.0.0.0" };
    plainServer.listen(port80, ipv4ListenOptions, () => {
        console.log(`HTTP server also listening on 0.0.0.0:${port80} (IPv4 enabled)`);
    });
    secureServer.listen(port443, ipv4ListenOptions, () => {
        console.log(`HTTPS server also listening on 0.0.0.0:${port443} (IPv4 enabled)`);
    });
}
