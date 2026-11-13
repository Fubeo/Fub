// Sonda: monta uno stato, clicca un controllo per nome e dice che cosa succede.
// node sonda-clic.mjs <out-dir> <stato> <nome del controllo> [larghezza] [foto.png]
import { chromium } from "./client.mjs";
const [dir, id, nome, larghezza = "piena", foto] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.route(/^https?:/, (r) => r.abort());
await p.goto(`file://${dir}/simulatore.html#stato=${id}&larghezza=${larghezza}&moto=ridotto`);
await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 });
await p.waitForTimeout(200);
const info = await p.evaluate((nome) => {
  const doc = document.getElementById("sim-schermo").contentDocument;
  const els = [...doc.querySelectorAll("button, [role=button], a[href], [role=menuitem], [role=tab]")].filter(
    (e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().startsWith(nome),
  );
  return els.map((el) => {
    const rc = el.getBoundingClientRect();
    const top = doc.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
    el.setAttribute("data-sonda", "");
    const d = doc.__simDecidi?.(el);
    return {
      tag: el.tagName,
      id: el.id,
      rc: [rc.left, rc.top, rc.width, rc.height].map(Math.round),
      top: top ? `${top.tagName}#${top.id}.${String(top.className).slice(0, 60)}` : null,
      esito: d?.esito,
      dettaglio: String(d?.dettaglio ?? "").slice(0, 120),
    };
  });
}, nome);
console.log(JSON.stringify(info, null, 1));
const prima = await p.evaluate(() => location.hash);
const fr = p.frameLocator("#sim-schermo").locator("[data-sonda]").first();
await fr.click({ force: true, timeout: 3000 }).catch((e) => console.log("clic:", e.message.split("\n")[0]));
await p.waitForTimeout(300);
const dopo = await p.evaluate(() => ({ hash: location.hash, msg: document.getElementById("sim-msg").textContent.trim() }));
console.log("prima", prima, "\ndopo ", dopo.hash, "\nmsg  ", dopo.msg);
if (foto) await p.locator("#sim-schermo").screenshot({ path: foto });
await b.close();
