import fs from "node:fs";
import path from "node:path";

const bad = [];
const roots = [
  "crates/fub-app/src",
  "crates/fub-host/src",
  "crates/fub-host/examples",
  "crates/fub-host/tests",
  "crates/fub-wasm-host/src",
  "crates/fub-wasm-host/examples",
  "crates/fub-wasm-host/tests",
];
const consumerRoots = new Set(roots.filter((root) => root !== "crates/fub-host/src"));

for (const root of roots) {
  for (const name of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, String(name));
    if (!file.endsWith(".rs") || !fs.statSync(file).isFile()) continue;
    const source = fs.readFileSync(file, "utf8");

    // La shell non deve poter riaprire la porta monolitica con una chiamata
    // equivalente. Nel composition root le acquisizioni private sono lecite:
    // qui si controllano soltanto le dichiarazioni che attraversano il crate.
    if (
      consumerRoots.has(root) &&
      /\.(?:workspace|with_session|in_session|debug_workspace)\s*\(/.test(source)
    ) {
      bad.push(`${file}: consumer generico`);
    }
    if (
      /\bpub\s+(?:async\s+)?fn\s+(?:workspace|with_session|in_session|debug_workspace)\s*[<(]/.test(
        source,
      )
    ) {
      bad.push(`${file}: API generica pubblica`);
    }
  }
}

if (bad.length) {
  console.error(`confine Host/Workspace violato: ${bad.join(", ")}`);
  process.exit(1);
}
console.log("confine Host/Workspace: consumer e API su porte strette");
