// Misura gli stessi elementi nel prototipo S2 e nel simulatore.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const { chromium } = await import("/home/fubeo/Progetti/Fub/apps/client/node_modules/playwright/index.mjs");
const [proto, simDir, stato, ...sels] = process.argv.slice(2);
const tipi = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };
const srv = (root, file, port) => createServer((q, r) => {
  const p = file ?? join(root, decodeURIComponent(q.url.split("?")[0].split("#")[0]).replace(/^\/$/, "/simulatore.html"));
  if (!existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": tipi[extname(p)] ?? "application/octet-stream" }); r.end(readFileSync(p));
}).listen(port, "127.0.0.1");
const a = srv(null, proto, 1461), b = srv(simDir, null, 1462);
const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 1400, height: 1400 } });
const misura = (frame) => p.evaluate(({ frame, sels }) => {
  const d = document.getElementById(frame).contentDocument;
  return sels.map((s) => { const e = d.querySelector(s); if (!e) return `${s}: -`; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return `${s}: x${r.x.toFixed(1)} y${r.y.toFixed(1)} w${r.width.toFixed(1)} h${r.height.toFixed(1)} font ${cs.fontFamily.slice(0,30)} ${cs.fontSize}`; });
}, { frame, sels });
await p.goto(`http://127.0.0.1:1461/?stato=${stato}&luce=light&larghezza=piena`);
await p.waitForSelector(`#proto-box[data-pronto]`);
await p.waitForTimeout(300);
console.log("PROTO\n" + (await misura("proto-schermo")).join("\n"));
await p.goto(`http://127.0.0.1:1462/#stato=${stato}&luce=light&larghezza=piena`);
await p.waitForSelector(`#sim-box[data-pronto]`);
await p.waitForTimeout(300);
console.log("SIM\n" + (await misura("sim-schermo")).join("\n"));
await br.close(); a.close(); b.close();
