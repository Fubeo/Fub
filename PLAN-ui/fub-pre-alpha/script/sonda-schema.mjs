// Sonda: lo schema del DOM di una cattura (tag, id, classi, ruolo) fino a una profondità.
// node sonda-schema.mjs <cattura.json> <selettore> [profondità]
import { readFile } from "node:fs/promises";
const { chromium } = await import("./client.mjs");
const [file, sel = "body", depth = "4"] = process.argv.slice(2);
const j = JSON.parse(await readFile(file, "utf8"));
const b = await chromium.launch();
const p = await b.newPage();
await p.route(/.*/, (r) => r.abort());
await p.setContent(`<!doctype html><html><body>${j.body}</body></html>`, { waitUntil: "domcontentloaded" }).catch(() => {});
const out = await p.evaluate(([sel, depth]) => {
  const lines = [];
  const walk = (el, d) => {
    if (d > depth) return;
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length ? "." + [...el.classList].slice(0, 4).join(".") : "";
    const role = el.getAttribute("role") ? ` [${el.getAttribute("role")}]` : "";
    const lab = el.getAttribute("aria-label") ? ` «${el.getAttribute("aria-label").slice(0, 40)}»` : "";
    const txt = el.children.length === 0 ? ` "${(el.textContent || "").trim().slice(0, 30)}"` : "";
    const hid = el.hidden ? " (hidden)" : "";
    lines.push(`${"  ".repeat(d)}${el.tagName.toLowerCase()}${id}${cls}${role}${lab}${hid}${txt}`);
    const kids = [...el.children].filter((c) => !["svg", "path", "script", "style"].includes(c.tagName.toLowerCase()));
    for (const c of kids.slice(0, 14)) walk(c, d + 1);
    if (kids.length > 14) lines.push(`${"  ".repeat(d + 1)}… altri ${kids.length - 14}`);
  };
  for (const el of document.querySelectorAll(sel)) walk(el, 0);
  return lines.join("\n");
}, [sel, Number(depth)]);
console.log(out);
await b.close();
