#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function requiredCommands(text) {
  const block = text.match(/<!-- ci-required:start -->\s*```text\s*([\s\S]*?)```\s*<!-- ci-required:end -->/);
  if (!block) throw new Error("manca il blocco ci-required in CONTRIBUTING.md");
  return block[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

if (process.argv.includes("--self-test")) {
  const sample = "<!-- ci-required:start -->\n```text\na\nb\n```\n<!-- ci-required:end -->";
  const parsed = requiredCommands(sample);
  if (parsed.join(",") !== "a,b") {
    console.error("Autoprova di check-locale-loop fallita.");
    process.exit(1);
  }
  console.log("Autoprova di check-locale-loop riuscita.");
  process.exit(0);
}

const contributing = fs.readFileSync(path.join(root, "CONTRIBUTING.md"), "utf8");
const commands = requiredCommands(contributing);
const workflowsDir = path.join(root, ".github", "workflows");
const workflows = fs.readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => fs.readFileSync(path.join(workflowsDir, name), "utf8"))
  .join("\n");

const errors = [];
for (const command of commands) {
  if (!workflows.includes(command)) {
    errors.push(`comando dichiarato ma assente dai workflow: ${command}`);
  }
}

const cargo = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
if (!/rust-version\s*=\s*"1\.89"/.test(cargo)) {
  errors.push("Cargo.toml non dichiara rust-version 1.89");
}
if (!/Rust 1\.89/.test(contributing)) {
  errors.push("CONTRIBUTING.md non dichiara Rust 1.89");
}
if (!/node-version:\s*22/.test(workflows)) {
  errors.push("nessun workflow usa Node 22");
}
if (!/Node\.js 22/.test(contributing)) {
  errors.push("CONTRIBUTING.md non dichiara Node.js 22");
}

if (errors.length) {
  console.error("Ciclo locale non allineato alla CI:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`${commands.length} comandi minimi presenti in CI; prerequisiti allineati.`);
