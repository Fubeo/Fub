// Lo scheletro di una cattura: tag, id, classi, ruolo, fino a una profondità.
import { chromium } from "/home/fubeo/Progetti/Fub/apps/client/node_modules/playwright/index.mjs";
import fs from "node:fs";
const [file, depth = "5", root = "body"] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(file, "utf8"));
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent(`<!doctype html><html><body>${j.body}</body></html>`);
const out = await p.evaluate(([d, root]) => {
  const lines = [];
  const walk = (el, n) => {
    if (n > d) return;
    for (const c of el.children) {
      if (["svg","path","script","style"].includes(c.localName)) continue;
      const desc = c.localName + (c.id ? "#" + c.id : "") + (c.className && typeof c.className === "string" ? "." + c.className.trim().split(/\s+/).join(".") : "") + (c.getAttribute("role") ? `[role=${c.getAttribute("role")}]` : "") + (c.getAttribute("aria-label") ? ` «${c.getAttribute("aria-label")}»` : "");
      lines.push("  ".repeat(n) + desc);
      walk(c, n + 1);
    }
  };
  walk(document.querySelector(root), 0);
  return lines.join("\n");
}, [Number(depth), root]);
console.log(out); await b.close();
