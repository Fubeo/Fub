// solo simulatore: prova i selettori delle toppe su una cattura.
// node sonda-sel.mjs <id> <sel> [<sel>…]   (stampa quanti e l'inizio del primo)
// node sonda-sel.mjs <id> --albero <sel>    (stampa la struttura sotto il selettore, 3 livelli)
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const { Window } = (await import("./client.mjs")).richiedi("happy-dom");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARTELLE = ["giro4", "giro3", "giro2", "tel", "piani", "nuove6", "nuove5", "nuove2", "nuove4", "nuove3", "nuove", "s2", "avvio"];
const [id, ...sels] = process.argv.slice(2);
let p = null;
for (const c of CARTELLE) {
  const f = join(root, "catture", c, `${id}-light.json`);
  if ((await readdir(join(root, "catture", c))).includes(`${id}-light.json`)) {
    p = f;
    break;
  }
}
if (!p) throw new Error(`nessuna cattura ${id}`);
const j = JSON.parse(await readFile(p, "utf8"));
const w = new Window();
w.document.write(`<!doctype html><html><body>${j.body}</body></html>`);
const doc = w.document;
const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
function albero(el, d = 0, max = 3) {
  const t = el.children.length ? "" : ` «${(el.textContent || "").trim().slice(0, 40)}»`;
  console.log(`${"  ".repeat(d)}${desc(el)}${t}`);
  if (d < max) for (const c of el.children) albero(c, d + 1, max);
}
console.log(p.replace(root + "/", ""), "viewport", JSON.stringify(j.viewport));
if (sels[0] === "--tutti") {
  // --tutti <sel> [attr]: un valore per ogni elemento (l'attributo, o il testo)
  for (const el of doc.querySelectorAll(sels[1])) console.log(" ", sels[2] ? el.getAttribute(sels[2]) : (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90));
} else if (sels[0] === "--html") {
  const el = doc.querySelector(sels[1]);
  console.log(el ? el.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").slice(0, Number(sels[2] ?? 1500)) : "nessuno");
} else if (sels[0] === "--albero") {
  const el = doc.querySelector(sels[1]);
  if (!el) console.log("nessuno:", sels[1]);
  else albero(el, 0, Number(sels[2] ?? 3));
} else {
  for (const s of sels) {
    const all = doc.querySelectorAll(s);
    console.log(`${all.length}  ${s}  ${all[0] ? desc(all[0]) + " «" + (all[0].textContent || "").trim().replace(/\s+/g, " ").slice(0, 70) + "»" : ""}`);
  }
}
await w.happyDOM.close();
