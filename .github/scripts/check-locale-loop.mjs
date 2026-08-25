#!/usr/bin/env node
// Verifica che i comandi di controllo presenti nella CI siano riproducibili
// dal ciclo locale di CONTRIBUTING.md oppure dichiarati come eccezioni.

import fs from "node:fs";
import path from "node:path";

function fencedCommands(markdown) {
  const heading = markdown.indexOf("## Ciclo locale");
  if (heading < 0) return null;
  const after = markdown.slice(heading);
  const match = after.match(/```(?:bash|sh)\s*\n([\s\S]*?)```/);
  if (!match) return null;
  return commandsFromBlock(match[1]);
}

function exceptions(markdown) {
  const heading = markdown.indexOf("### Le eccezioni al ciclo");
  if (heading < 0) return [];
  const section = markdown.slice(heading).split(/^## /m, 1)[0];
  return [...section.matchAll(/^-\s*`([^`]+)`/gm)].map((m) => m[1]);
}

function commandsFromBlock(block) {
  const out = [];
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    while (line.endsWith("\\") && i + 1 < lines.length) {
      line = line.slice(0, -1).trimEnd() + " " + lines[++i].trim();
    }
    out.push(line);
  }
  return out;
}

function workflowCommands(yaml) {
  const out = [];
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const scalar = line.match(/^\s*-?\s*run:\s*(.+)$/);
    if (scalar && !/^[|>][-+]?\s*$/.test(scalar[1].trim())) {
      out.push(scalar[1].trim().replace(/\s+#.*$/, ""));
      continue;
    }
    const block = line.match(/^(\s*)-?\s*run:\s*[|>][-+]?\s*$/);
    if (block) {
      const indent = block[1].length;
      const chunk = [];
      let j = i + 1;
      while (j < lines.length) {
        const lead = (lines[j].match(/^\s*/) ?? [""])[0].length;
        if (lines[j].trim() && lead <= indent) break;
        chunk.push(lines[j]);
        j++;
      }
      out.push(...commandsFromBlock(chunk.join("\n")));
      i = j - 1;
    }
    if (/uses:\s*EmbarkStudios\/cargo-deny-action/.test(line)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const command = lines[j].match(/^\s*command:\s*(\S+)/);
        if (command) { out.push(`cargo deny ${command[1]}`); break; }
      }
    }
  }
  return out;
}

function packageScripts(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "frontend/package.json"), "utf8")).scripts ?? {};
  } catch { return {}; }
}

function normalize(command, scripts) {
  let value = command.trim();
  value = value.replace(/^sudo\s+/, "");
  value = value.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)+/, "");
  value = value.replace(/^cd\s+[^&]+&&\s*/, "");
  value = value.replace(/^npx\s+/, "");

  const npmRun = value.match(/^npm\s+run\s+(\S+)(.*)$/);
  if (npmRun && typeof scripts[npmRun[1]] === "string" && !/[&|><]/.test(scripts[npmRun[1]])) {
    value = scripts[npmRun[1]] + npmRun[2];
  } else {
    const npmShort = value.match(/^npm\s+(test|build)(.*)$/);
    if (npmShort && typeof scripts[npmShort[1]] === "string" && !/[&|><]/.test(scripts[npmShort[1]])) {
      value = scripts[npmShort[1]] + npmShort[2];
    }
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens[0] === "node" && tokens[1]?.includes(".github/scripts/")) {
    return tokens.filter((t, i) => i < 2 || !t.startsWith("-")).join(" ");
  }
  return tokens.join(" ");
}

function provisioning(command) {
  return /^(?:sudo\s+)?apt-get\s+(?:update|install)|^npm\s+(?:ci|install|i)\b|^cargo\s+install\b|^rustup\b|playwright\s+install|\s>\s/.test(command);
}

function stripCargoScope(command) {
  const tokens = command.split(/\s+/);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "-p" || tokens[i] === "--test") { i++; continue; }
    if (tokens[i] === "--workspace") continue;
    out.push(tokens[i]);
  }
  return out.join(" ");
}

function covers(local, ci) {
  if (local === ci) return true;
  const l = stripCargoScope(local);
  const c = stripCargoScope(ci);
  if (l === c) return true;
  if (l === "cargo test" && (c.startsWith("cargo test") || c.startsWith("cargo build"))) {
    return !/--(?:no-default-features|features|target|release)\b/.test(c);
  }
  return false;
}

function selfTest() {
  const md = "## Ciclo locale\n\n```bash\ncargo test --workspace\n```\n\n### Le eccezioni al ciclo\n\n- `cargo check --target x` — motivo\n";
  const ok = fencedCommands(md)?.length === 1 && exceptions(md)[0] === "cargo check --target x" &&
    covers("cargo test", "cargo test") && !covers("cargo test", "cargo build --target x");
  console.log(`self-test: ${ok ? "ok" : "rosso"}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();

const root = path.resolve(process.argv[2] ?? process.cwd());
const contributing = fs.readFileSync(path.join(root, "CONTRIBUTING.md"), "utf8");
const localRaw = fencedCommands(contributing);
if (!localRaw) {
  console.error("ciclo locale: blocco mancante in CONTRIBUTING.md");
  process.exit(1);
}
const exceptionRaw = exceptions(contributing);
const scripts = packageScripts(root);
const local = localRaw.map((c) => normalize(c, scripts));
const exception = exceptionRaw.map((c) => normalize(c, scripts));

const ciRaw = [];
const workflows = path.join(root, ".github/workflows");
for (const name of fs.readdirSync(workflows).filter((n) => /\.ya?ml$/.test(n))) {
  ciRaw.push(...workflowCommands(fs.readFileSync(path.join(workflows, name), "utf8")));
}
const ci = ciRaw.filter((c) => !provisioning(c)).map((c) => normalize(c, scripts));

const problems = [];
for (const command of ci) {
  if (local.some((candidate) => covers(candidate, command))) continue;
  if (exception.includes(command)) continue;
  problems.push(`CI senza posto nel ciclo locale: ${command}`);
}
for (const command of local) {
  if (!ci.some((candidate) => covers(candidate, command))) {
    problems.push(`comando locale non eseguito dalla CI: ${command}`);
  }
}
for (const command of exception) {
  if (!ci.includes(command)) problems.push(`eccezione scaduta: ${command}`);
  if (local.includes(command)) problems.push(`eccezione duplicata nel ciclo: ${command}`);
}

if (problems.length === 0) {
  console.log(`ciclo locale: ${local.length} comandi, ${exception.length} eccezioni, coerente con la CI`);
  process.exit(0);
}
for (const problem of problems) console.error(problem);
process.exit(1);
