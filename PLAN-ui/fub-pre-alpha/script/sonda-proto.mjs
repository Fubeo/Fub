// node script/sonda-proto.mjs <pagina.html> <query> <espressione js sul documento del frame (d)>
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const [pagina, query, expr] = process.argv.slice(2);
const nm = join(process.cwd(), "anteprima-copia/apps/client/node_modules");
const { chromium } = await import(pathToFileURL(join(nm, "playwright/index.mjs")).href);
const html = await readFile(pagina);
const server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); }).listen(1457, "127.0.0.1");
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 1400 } });
  p.on("pageerror", (e) => console.log("ERR", String(e)));
  await p.goto(`http://127.0.0.1:1457/?${query}`);
  await p.waitForSelector("#proto-box[data-pronto]");
  await p.waitForTimeout(300);
  console.log(await p.evaluate(`(() => { const d = document.getElementById("proto-schermo").contentDocument; return JSON.stringify(${expr}, null, 1); })()`));
} finally { await b.close(); server.close(); }
