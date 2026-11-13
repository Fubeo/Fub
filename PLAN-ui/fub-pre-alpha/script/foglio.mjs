// Un foglio di provini: node foglio.mjs <out.png> <colonne> <larghezza cella> img...
import { chromium } from "./client.mjs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, basename } from "node:path";
const [out, cols, cw, ...imgs] = process.argv.slice(2);
const html = `<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:3px;background:#777;font:11px sans-serif">` +
  imgs.map((i) => `<figure style="margin:0"><img src="file://${resolve(i)}" style="width:${cw}px;display:block"><figcaption style="background:#222;color:#fff;padding:1px 4px">${basename(i)}</figcaption></figure>`).join("") + "</body>";
const pagina = resolve(tmpdir(), `foglio-${process.pid}.html`);
writeFileSync(pagina, html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: cols * (+cw + 3), height: 400 } });
await p.goto(`file://${pagina}`);
await p.waitForTimeout(300);
await p.screenshot({ path: out, fullPage: true });
await b.close();
