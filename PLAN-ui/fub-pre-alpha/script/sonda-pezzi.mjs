// Quali sovrapposizioni ha una cattura: node sonda-pezzi.mjs <cattura.json>
import { chromium } from "/home/fubeo/Progetti/Fub/apps/client/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<body>${j.body}</body>`);
const out = await p.evaluate(() => {
  const r = [];
  for (const el of document.body.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"],.kit-popover,#context-menu,.launcher,.slash-menu,[data-proto-focus]')) {
    if (el.parentElement?.closest('[role="menu"],[role="dialog"],.kit-popover,.launcher')) continue;
    r.push(`${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join(".")} role=${el.getAttribute("role")} hidden=${el.hidden} parent=${el.parentElement?.tagName}#${el.parentElement?.id}.${el.parentElement?.className?.toString().slice(0,40)} style=${(el.getAttribute("data-proto-style")||"").slice(0,90)} len=${el.outerHTML.length}`);
  }
  return r;
});
console.log(out.join("\n"));
await b.close();
