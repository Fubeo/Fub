// Sonda: quali controlli di uno stato stanno sotto qualcosa che non è un
// controllo, e che cosa li copre (tag, classi, rettangoli).
// node sonda-coperti.mjs <out-dir> <stato,stato,…> [larghezza]
import { chromium } from "./client.mjs";
const [dir, id, larghezza = "piena"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.route(/^https?:/, (r) => r.abort());
let giro = 0;
for (const uno of id.split(",")) {
await p.goto(`file://${dir}/simulatore.html#stato=${uno}&larghezza=${larghezza}&moto=${giro++ % 2 ? "calmo" : "ridotto"}`);
await p.waitForFunction((uno) => document.getElementById("sim-box")?.dataset.pronto?.startsWith(uno + "--"), uno, { timeout: 30000 });
await p.waitForTimeout(200);
const r = await p.evaluate(() => {
  const doc = document.getElementById("sim-schermo").contentDocument;
  const win = doc.defaultView;
  const SEL = 'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=radio], [role=switch], [role=checkbox], [role=option], [role=treeitem], [role=link], [role=gridcell], [role=columnheader], [role=slider], [role=spinbutton], [contenteditable=true], [tabindex="0"]';
  const desc = (e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${String(e.className?.baseVal ?? e.className).split(" ").slice(0, 3).join(".")}${e.getAttribute("role") ? "[" + e.getAttribute("role") + "]" : ""}`;
  const rr = (e) => {
    const c = e.getBoundingClientRect();
    return `${Math.round(c.left)},${Math.round(c.top)} ${Math.round(c.width)}x${Math.round(c.height)}`;
  };
  // Tagliato da un antenato che scorre o ritaglia: non si vede, non conta.
  const tagliato = (el, x, y) => {
    for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
      const s = win.getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible" && !/paint|strict|content/.test(s.contain)) continue;
      const r = a.getBoundingClientRect();
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return true;
    }
    return false;
  };
  const out = [];
  for (const el of doc.querySelectorAll(SEL)) {
    if (el.closest("[data-sim-velo], [hidden], [inert]")) continue;
    const rc = el.getBoundingClientRect();
    if (rc.width < 2 || rc.height < 2 || rc.bottom < 0 || rc.right < 0 || rc.top > win.innerHeight || rc.left > win.innerWidth) continue;
    const cs = win.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0 || cs.pointerEvents === "none") continue;
    const top = doc.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
    if (!top || el.contains(top)) continue;
    if (tagliato(el, rc.left + rc.width / 2, rc.top + rc.height / 2)) continue;
    if (top.matches?.("iframe[data-sim-strato], .kit-dialog-scrim, .drawer-scrim, .launcher-veil") || top.closest(SEL) || top.closest(".kit-dialog, [role=dialog], [role=menu], [role=listbox], [role=tooltip], .toast")) continue;
    const anc = [];
    for (let a = el.parentElement; a && anc.length < 4; a = a.parentElement) anc.push(desc(a));
    out.push(`${desc(el)} ${rr(el)} «${(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30)}»\n    sotto ${desc(top)} ${rr(top)}\n    in ${anc.join(" < ")}`);
  }
  return { w: win.innerWidth, h: win.innerHeight, out };
});
console.log(`== ${uno}: schermo ${r.w}x${r.h}, coperti ${r.out.length}`);
for (const x of r.out.slice(0, 12)) console.log(x);
}
await b.close();
