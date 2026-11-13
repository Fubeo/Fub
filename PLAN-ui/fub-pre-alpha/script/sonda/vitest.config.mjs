// Le prove del CSS nuovo del simulatore contro il sanitizer del tema del client.
//   CLIENT=<apps/client di un checkout con npm ci> \
//     <CLIENT>/node_modules/.bin/vitest run --config script/sonda/vitest.config.mjs
// I blocchi si leggono da ../../blocchi; il client dà il sanitizer, il profilo
// theme-2, la ricetta e il contrasto.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const qui = dirname(fileURLToPath(import.meta.url));
const client = process.env.CLIENT;
if (!client) throw new Error("Manca CLIENT: la cartella apps/client di un checkout con npm ci.");

export default {
  root: qui,
  cacheDir: `${process.env.TMPDIR || "/tmp"}/vitest-sonda-sim`,
  server: { fs: { allow: [qui, dirname(dirname(qui)), client] } },
  test: { include: ["*.test.ts"], environment: "node", globals: true },
};
