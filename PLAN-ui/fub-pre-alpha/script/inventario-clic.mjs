// L'inventario dei controlli visibili di ogni stato del simulatore v2 (documento
// principale, non gli strati), con l'esito che solo-simulatore.js dà al clic.
// node inventario-clic.mjs <out-dir> <uscita.tsv> [larghezza] [solo=id,id]
import { chromium } from "./client.mjs";
import { writeFileSync } from "node:fs";
const [dir, uscita, larghezza = "piena", soloArg] = process.argv.slice(2);
const solo = soloArg ? new Set(soloArg.replace(/^solo=/, "").split(",")) : null;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errori = [];
p.on("pageerror", (e) => errori.push("pageerror " + e.message));
await p.route(/^https?:/, (r) => r.abort());
await p.goto(`file://${dir}/simulatore.html#stato=nota-riposo`);
await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 });
const ids = await p.evaluate(() => window.SIM_STATI.map((s) => s.id));
const righe = [];
for (const id of ids) {
  if (solo && !solo.has(id)) continue;
  await p.evaluate(([id, l]) => { location.hash = `stato=${id}&luce=light&larghezza=${l}&moto=ridotto`; }, [id, larghezza]);
  const ok = await p.waitForFunction(([id]) => document.getElementById("sim-box").dataset.pronto?.startsWith(`${id}--`), [id], { timeout: 20000 }).then(() => true, () => false);
  if (!ok) { errori.push(`non pronto ${id}`); continue; }
  const r = await p.evaluate(() => {
    const doc = document.getElementById("sim-schermo").contentDocument;
    const win = doc.defaultView;
    const SEL = 'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=radio], [role=switch], [role=checkbox], [role=option], [role=treeitem], [role=link], [role=gridcell], [role=columnheader], [role=slider], [role=spinbutton], [contenteditable=true], [tabindex="0"]';
    const vis = (el) => {
      if (el.closest("[data-sim-velo], [hidden], [inert]")) return false;
      const rc = el.getBoundingClientRect();
      if (rc.width < 2 || rc.height < 2 || rc.bottom < 0 || rc.right < 0 || rc.top > win.innerHeight || rc.left > win.innerWidth) return false;
      const cs = win.getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0 || cs.pointerEvents === "none") return false;
      // coperto da uno strato?
      const x = rc.left + rc.width / 2, y = rc.top + rc.height / 2;
      const top = doc.elementFromPoint(x, y);
      if (!top) return false;
      if (top.matches?.("iframe[data-sim-strato]")) return false;
      return true;
    };
    const chiave = (el) => {
      if (el.id) return `#${el.id}`;
      const da = [...el.attributes].filter((a) => a.name.startsWith("data-") && !a.name.startsWith("data-proto") && !a.name.startsWith("data-sim") && a.name !== "data-key").map((a) => `[${a.name}${a.value && a.value.length < 30 ? `=${a.value}` : ""}]`);
      const cl = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
      const role = el.getAttribute("role");
      return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${cl}${da.slice(0, 2).join("")}`;
    };
    const out = [];
    const visti = new Set();
    for (const el of doc.querySelectorAll(SEL)) {
      if (visti.has(el)) continue;
      // il controllo più esterno conta (un bottone dentro una riga cliccabile no)
      if (!vis(el)) continue;
      visti.add(el);
      const d = doc.__simDecidi ? doc.__simDecidi(el) : { esito: "?", dettaglio: "" };
      const testo = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.value || "").replace(/\s+/g, " ").trim().slice(0, 50);
      out.push([chiave(el), testo, d.esito, (d.dettaglio ?? "").slice(0, 90)]);
    }
    return out;
  });
  for (const x of r) righe.push([id, ...x].join("\t"));
}
writeFileSync(uscita, righe.join("\n") + "\n");
const conta = {};
for (const r of righe) { const e = r.split("\t")[3]; conta[e] = (conta[e] ?? 0) + 1; }
console.log(righe.length, "controlli", JSON.stringify(conta));
console.log("errori:", errori.length ? `\n  ${errori.join("\n  ")}` : "nessuno");
await b.close();
