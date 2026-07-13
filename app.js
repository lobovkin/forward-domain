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

const listenOptions = { host: bindAddress };
if (bindAddress === '::' && !enableIpv4) {
    listenOptions.ipv6Only = true;
}
plainServer.listen(port80, listenOptions, () => {
    console.log(`HTTP server listening on [${bindAddress}]:${port80}${enableIpv4 ? ' (dual-stack)' : ' (IPv6 only)'}`);
});
secureServer.listen(port443, listenOptions, () => {
    console.log(`HTTPS server listening on [${bindAddress}]:${port443}${enableIpv4 ? ' (dual-stack)' : ' (IPv6 only)'}`);
});
