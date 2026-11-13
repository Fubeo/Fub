// Sonda: gli attributi dei controlli di Aspetto in uno stato del simulatore.
// node sonda-aspetto.mjs <out-dir> <stato> <selettore>
import { chromium } from "./client.mjs";
const [dir, stato, sel, larghezza = "piena"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.route(/^https?:/, (r) => r.abort());
await p.goto(`file://${dir}/simulatore.html#stato=${stato}&larghezza=${larghezza}&moto=ridotto`);
await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 });
const out = await p.evaluate((sel) => {
  const doc = document.getElementById("sim-schermo").contentDocument;
  return [...doc.querySelectorAll(sel)].slice(0, 80).map((el) => {
    const at = [...el.attributes].filter((a) => !a.name.startsWith("data-proto") && a.name !== "class" && a.name !== "style").map((a) => `${a.name}=${a.value.slice(0, 40)}`).join(" ");
    const up = el.closest("[data-setting-key]")?.dataset.settingKey ?? "";
    return `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} {${at}} key=${up} «${(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}»`;
  });
}, sel);
console.log(out.join("\n"));
await b.close();
