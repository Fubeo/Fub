// node antenati.mjs <cattura.json> <selettore>: la catena dei genitori
import { chromium } from "./client.mjs";
import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<body>${j.body}</body>`);
console.log(await p.evaluate((sel) => {
  let el = document.querySelector(sel); const r = [];
  while (el && el !== document.body) { r.push(`${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join(".")} ${el.getAttribute("role")||""} st=${(el.getAttribute("data-proto-style")||"").slice(0,70)}`); el = el.parentElement; }
  return r.join("\n  ← ");
}, process.argv[3]));
await b.close();
