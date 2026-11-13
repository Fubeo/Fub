// node foto-pagina.mjs pagina.html out.png [larghezza] [altezza] → una foto della pagina (offline)
const { chromium } = await import("./client.mjs");
const [pagina, out, w = "1400", h = "1000", sel] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.route(/^https?:/, (r) => r.abort());
await p.goto(`file://${pagina}`);
await p.waitForTimeout(1200);
await p.screenshot({ path: out, fullPage: !sel });
await b.close();
