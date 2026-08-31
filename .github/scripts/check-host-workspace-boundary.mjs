import fs from "node:fs";
import path from "node:path";

const bad = [];
for (const name of fs.readdirSync("crates/fub-app/src", { recursive: true })) {
  const file = path.join("crates/fub-app/src", String(name));
  if (!file.endsWith(".rs") || !fs.statSync(file).isFile()) continue;
  if (/\.workspace\s*\(/.test(fs.readFileSync(file, "utf8"))) bad.push(file);
}
if (bad.length) {
  console.error(`Accesso generico Host::workspace vietato nella shell: ${bad.join(", ")}`);
  process.exit(1);
}
console.log("confine Host/Workspace: shell su porte strette");
