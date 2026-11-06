// Sonda: i controlli di una pagina di piano (select con le opzioni, bottoni con data-*), per scrivere i passi.
// node sonda-controlli.mjs <pagina.html> [selettore della barra]
const { chromium } = await import("./client.mjs");
const [file, bar = "body"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
await p.goto("file://" + file, { waitUntil: "load" });
await p.waitForTimeout(500);
const out = await p.evaluate((bar) => {
  const lines = [];
  const root = document.querySelector(bar) ?? document.body;
  for (const s of root.querySelectorAll("select")) {
    const lab = s.labels?.[0]?.textContent?.trim() ?? s.getAttribute("aria-label") ?? "";
    lines.push(`select#${s.id || "?"}${s.name ? "[name=" + s.name + "]" : ""} «${lab}»: ${[...s.options].map((o) => o.value + (o.selected ? "*" : "")).join(" ")}`);
  }
  const seen = new Map();
  for (const btn of root.querySelectorAll("button, input[type=radio]")) {
    const data = [...btn.attributes].filter((a) => a.name.startsWith("data-") && !a.name.startsWith("data-i18n")).map((a) => `${a.name}=${a.value}`);
    const key = data.map((d) => d.split("=")[0]).join(",") || (btn.name ? "name=" + btn.name : "");
    if (!key) continue;
    const v = btn.type === "radio" ? `${btn.value}${btn.checked ? "*" : ""}` : data.map((d) => d.split("=")[1]).join("/") + (btn.getAttribute("aria-pressed") === "true" ? "*" : "");
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(v);
  }
  for (const [k, v] of seen) lines.push(`${k}: ${v.join(" ")}`);
  return lines.join("\n");
}, bar);
console.log(out);
await b.close();
