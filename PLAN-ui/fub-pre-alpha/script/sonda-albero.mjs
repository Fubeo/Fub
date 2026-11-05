import fs from "node:fs";
const cart = ["nuove2","nuove4","nuove3","nuove","s2","avvio"];
const paths = new Map(); const sel = {};
for (const c of cart) for (const f of fs.readdirSync(c)) {
  if (!f.endsWith("-light.json")) continue;
  const b = JSON.parse(fs.readFileSync(`${c}/${f}`, "utf8")).body;
  for (const m of b.matchAll(/<li[^>]*data-path="([^"]+)"[^>]*>/g)) {
    if (!paths.has(m[1])) paths.set(m[1], `${c}/${f}`);
    if (/aria-selected="true"/.test(m[0])) (sel[m[1]] ??= []).push(f.replace("-light.json",""));
  }
  const tabs = [...b.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(m => (m[0].match(/id="([^"]+)"/)||[])[1] + (/aria-selected="true"/.test(m[0]) ? "*" : "")).filter(x=>x && x.startsWith("pane"));
  if (process.argv[2] === "tabs") console.log(f, tabs.join(" "));
}
console.log([...paths.keys()].sort().join("\n"));
console.log(JSON.stringify(sel, null, 1));
