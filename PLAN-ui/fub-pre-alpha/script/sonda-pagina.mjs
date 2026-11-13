// Sonda: lo schema del DOM di una pagina di piano (tag, id, classi, attributi data) fino a una profondità.
// node sonda-pagina.mjs <pagina.html> <selettore> [profondità] [larghezza]
const { chromium } = await import("./client.mjs");
const [file, sel = "body", depth = "4", width = "1400"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(width), height: 1000 } });
await p.goto("file://" + file, { waitUntil: "load" });
await p.waitForTimeout(600);
const out = await p.evaluate(([sel, depth]) => {
  const lines = [];
  const walk = (el, d) => {
    if (d > depth) return;
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length ? "." + [...el.classList].slice(0, 4).join(".") : "";
    const data = [...el.attributes].filter((a) => a.name.startsWith("data-") || a.name === "role").map((a) => `${a.name}=${a.value.slice(0, 24)}`).slice(0, 4).join(" ");
    const txt = el.children.length === 0 ? ` "${(el.textContent || "").trim().slice(0, 30)}"` : "";
    const r = el.getBoundingClientRect();
    const box = d <= 3 ? ` {${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}}` : "";
    lines.push(`${"  ".repeat(d)}${el.tagName.toLowerCase()}${id}${cls}${data ? " [" + data + "]" : ""}${box}${txt}`);
    const kids = [...el.children].filter((c) => !["svg", "path", "script", "style", "link", "meta"].includes(c.tagName.toLowerCase()));
    for (const c of kids.slice(0, 12)) walk(c, d + 1);
    if (kids.length > 12) lines.push(`${"  ".repeat(d + 1)}… altri ${kids.length - 12}`);
  };
  for (const el of document.querySelectorAll(sel)) walk(el, 0);
  return lines.join("\n");
}, [sel, Number(depth)]);
console.log(out);
await b.close();
