#!/usr/bin/env node
// Una versione del prodotto, scritta in quattro posti che devono dire lo
// stesso numero: il workspace Cargo (che la scheda «Informazioni» e il
// controllo degli aggiornamenti leggono), la configurazione Tauri (che dà il
// nome agli installer), il `package.json` del frontend e il suo lockfile.
//
// Con un tag (`node check-release-version.mjs v0.2.0`) il tag deve essere
// `v` più quel numero: un installer chiamato 0.1.0 dentro la release 0.2.0
// direbbe a chi lo scarica una versione e ne installerebbe un'altra.

import fs from "node:fs";

function workspaceVersion(text) {
  const section = text.split(/^\[workspace\.package\]\s*$/m)[1];
  const match = section?.split(/^\[/m)[0].match(/^version\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

const json = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const lock = json("apps/client/package-lock.json");
const found = {
  "Cargo.toml [workspace.package]": workspaceVersion(fs.readFileSync("Cargo.toml", "utf8")),
  "crates/fub-app/tauri.conf.json": json("crates/fub-app/tauri.conf.json").version ?? null,
  "apps/client/package.json": json("apps/client/package.json").version ?? null,
  "apps/client/package-lock.json": lock.packages?.[""]?.version ?? lock.version ?? null,
};

let problems = 0;
const expected = found["Cargo.toml [workspace.package]"];
if (!expected || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(expected)) {
  console.error(`la versione del workspace non è major.minor.patch: ${expected}`);
  problems++;
}
for (const [where, version] of Object.entries(found)) {
  if (version !== expected) {
    console.error(`${where}: ${version}, il workspace dice ${expected}`);
    problems++;
  }
}
const tag = process.argv[2];
if (tag !== undefined && tag !== `v${expected}`) {
  console.error(`il tag ${tag} non è v${expected}`);
  problems++;
}
if (problems) process.exit(1);
console.log(`versione ${expected} concorde in ${Object.keys(found).length} posti${tag ? ` e nel tag ${tag}` : ""}`);
