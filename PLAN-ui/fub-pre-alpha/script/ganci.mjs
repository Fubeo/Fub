// Per ogni blocco <style data-destinazione> del prototipo: le classi che
// nessun file di anatomia di main conosce ancora (i ganci nuovi da aggiungere).
import { readFileSync, readdirSync } from "node:fs";
const html = readFileSync(process.argv[2], "utf8");
const dir = "apps/client/src/theme/scrittoio/anatomia";
const anat = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.includes(".test")).map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
const re = /<style[^>]*data-destinazione="([^"]+)"[^>]*>([\s\S]*?)<\/style>/g;
for (let m; (m = re.exec(html)); ) {
  const css = m[2].replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "");
  const cls = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]).filter((c) => !/^\d/.test(c)));
  const nuove = [...cls].filter((c) => !new RegExp(`["'\`.]${c.replace(/-/g, "\\-")}["'\`\\s,:)\\]]`).test(anat));
  console.log(`${m[1]}: ${nuove.length ? nuove.join(" ") : "(nessuna)"}`);
}
