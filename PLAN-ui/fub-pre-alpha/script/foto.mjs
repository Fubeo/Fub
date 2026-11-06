// Fotografa una pagina locale: node foto.mjs <file.html> <out.png> [larghezza] [altezza] [js da eseguire]
import { chromium } from "./client.mjs";
const [file, out, w = "1280", h = "800", js] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.route(/^https?:/, (r) => r.abort());
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto("file://" + file);
await p.waitForTimeout(800);
if (js) { await p.evaluate(js); await p.waitForTimeout(500); }
await p.screenshot({ path: out });
await b.close();
