#!/usr/bin/env node
// La SBOM Rust di Fub in SPDX 2.3, ricavata da `cargo metadata --locked` e dai
// checksum di `Cargo.lock`, senza strumenti scaricati: niente da fissare a
// una versione, niente binario di terzi che gira con il token della CI.
//
//   node .github/scripts/sbom.mjs --out fub-sbom.spdx.json
//       genera la SBOM del commit corrente e la confronta con `Cargo.lock`;
//   node .github/scripts/sbom.mjs --check fub-sbom.spdx.json
//       confronta con `Cargo.lock` una SBOM già scritta (anche vecchia);
//   node .github/scripts/sbom.mjs --self-test
//       prova il confronto su casi rotti scritti qui.
//
// Il confronto è nei due versi: ogni `[[package]]` del lock compare una e una
// sola volta con nome, versione, provenienza e checksum uguali, e la SBOM non
// ha pacchetti che il lock non ha. Una SBOM che sottostima il grafo, o resta
// indietro di una versione, fallisce (audit del 2026-10-30, M11).
//
// La SBOM npm del client la scrive `npm sbom` in `npm-supply-chain.yml`, dal
// `package-lock.json` installato con `npm ci`.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index";
const NOASSERTION = "NOASSERTION";

/** I `[[package]]` di un `Cargo.lock` (formato 3 o 4): nome, versione,
 * provenienza (`null` per un percorso) e checksum. */
function parseLock(text) {
  const packages = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "[[package]]") {
      current = { name: null, version: null, source: null, checksum: null };
      packages.push(current);
      continue;
    }
    if (line.startsWith("[")) {
      current = null;
      continue;
    }
    const match = /^(name|version|source|checksum) = "([^"]*)"$/.exec(line);
    if (current && match) current[match[1]] = match[2];
  }
  for (const pkg of packages) {
    if (!pkg.name || !pkg.version) {
      throw new Error(`Cargo.lock: un [[package]] senza nome o versione: ${JSON.stringify(pkg)}`);
    }
  }
  return packages;
}

/** Dove si scarica un pacchetto, nella forma di SPDX. */
function downloadLocation(pkg) {
  if (!pkg.source) return NOASSERTION;
  if (pkg.source === CRATES_IO) {
    return `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`;
  }
  if (pkg.source.startsWith("git+")) {
    // `git+https://host/repo?rev=x#<commit>` → `git+https://host/repo@<commit>`
    const [url, commit] = pkg.source.split("#");
    return `${url.replace(/\?.*$/, "")}@${commit}`;
  }
  // Un altro registro: la sua origine, così il confronto la distingue.
  return pkg.source;
}

/** Il purl di un pacchetto, se ne ha uno. */
function purl(pkg) {
  if (pkg.source === CRATES_IO) return `pkg:cargo/${pkg.name}@${pkg.version}`;
  if (pkg.source?.startsWith("git+")) {
    return `pkg:cargo/${pkg.name}@${pkg.version}?vcs_url=${encodeURIComponent(downloadLocation(pkg))}`;
  }
  return null;
}

/** La licenza dichiarata come espressione SPDX: `MIT/Apache-2.0`, la forma
 * vecchia di Cargo, diventa `MIT OR Apache-2.0`. Quello che non ha la forma
 * di un'espressione resta `NOASSERTION`. */
function licenseExpression(license) {
  if (!license) return NOASSERTION;
  const expression = license
    .split("/")
    .map((part) => part.trim())
    .join(" OR ")
    .replace(/\s+/g, " ")
    .trim();
  return /^[A-Za-z0-9.+\-() ]+$/.test(expression) ? expression : NOASSERTION;
}

/** La chiave con cui il lock e la SBOM si confrontano. */
function key(name, version, location) {
  return `${name}@${version} ${location}`;
}

/** Gli identificatori SPDX, unici e nella forma che SPDX accetta. */
function spdxIds(packages) {
  const used = new Set();
  return packages.map((pkg) => {
    const base = `SPDXRef-Package-${pkg.name}-${pkg.version}`.replace(/[^A-Za-z0-9.-]/g, "-");
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

/**
 * La SBOM SPDX 2.3 da `cargo metadata` e dal lock.
 * `commit` e `created` la legano al commit da cui nasce; a parità di commit il
 * file esce uguale byte per byte.
 */
function buildSbom({ metadata, lock, lockText, commit, created }) {
  const checksums = new Map(
    lock.map((pkg) => [key(pkg.name, pkg.version, downloadLocation(pkg)), pkg.checksum]),
  );
  const packages = [...metadata.packages].sort((a, b) =>
    a.name === b.name
      ? a.version.localeCompare(b.version) || String(a.source).localeCompare(String(b.source))
      : a.name < b.name ? -1 : 1,
  );
  const ids = spdxIds(packages);
  const byCargoId = new Map(packages.map((pkg, i) => [pkg.id, ids[i]]));
  const spdxPackages = packages.map((pkg, i) => {
    const location = downloadLocation(pkg);
    const entry = {
      name: pkg.name,
      SPDXID: ids[i],
      versionInfo: pkg.version,
      downloadLocation: location,
      filesAnalyzed: false,
      licenseConcluded: NOASSERTION,
      licenseDeclared: licenseExpression(pkg.license),
      copyrightText: NOASSERTION,
    };
    const sum = checksums.get(key(pkg.name, pkg.version, location));
    if (sum) entry.checksums = [{ algorithm: "SHA256", checksumValue: sum }];
    const ref = purl(pkg);
    if (ref) {
      entry.externalRefs = [
        { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: ref },
      ];
    }
    if (!pkg.source) entry.comment = "pacchetto del workspace di Fub o copia in vendor/";
    return entry;
  });

  const relationships = [];
  for (const member of [...metadata.workspace_members].sort()) {
    relationships.push({
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: byCargoId.get(member),
    });
  }
  const edges = new Set();
  for (const node of metadata.resolve?.nodes ?? []) {
    for (const dep of node.deps ?? []) {
      edges.add(`${byCargoId.get(node.id)}\n${byCargoId.get(dep.pkg)}`);
    }
  }
  for (const edge of [...edges].sort()) {
    const [from, to] = edge.split("\n");
    relationships.push({ spdxElementId: from, relationshipType: "DEPENDS_ON", relatedSpdxElement: to });
  }

  const lockHash = createHash("sha256").update(lockText).digest("hex");
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `fub-${commit}`,
    documentNamespace: `https://github.com/Fubeo/Fub/sbom/${commit}`,
    creationInfo: {
      created,
      creators: ["Tool: fub .github/scripts/sbom.mjs"],
      comment: `Cargo.lock sha256 ${lockHash}; commit ${commit}`,
    },
    packages: spdxPackages,
    relationships,
  };
}

/** Il confronto di una SBOM con il lock: gli errori, vuoti se torna. */
function verify(sbom, lock) {
  const errors = [];
  if (sbom?.spdxVersion !== "SPDX-2.3") errors.push(`versione SPDX inattesa: ${sbom?.spdxVersion}`);
  const seen = new Map();
  for (const pkg of sbom?.packages ?? []) {
    const k = key(pkg.name, pkg.versionInfo, pkg.downloadLocation);
    if (seen.has(k)) errors.push(`pacchetto ripetuto nella SBOM: ${k}`);
    seen.set(k, pkg);
  }
  const wanted = new Set();
  for (const pkg of lock) {
    const k = key(pkg.name, pkg.version, downloadLocation(pkg));
    wanted.add(k);
    const found = seen.get(k);
    if (!found) {
      errors.push(`nel lock e non nella SBOM: ${k}`);
      continue;
    }
    const sum = found.checksums?.find((c) => c.algorithm === "SHA256")?.checksumValue ?? null;
    if (sum !== pkg.checksum) {
      errors.push(`checksum diverso per ${k}: SBOM ${sum}, lock ${pkg.checksum}`);
    }
  }
  for (const k of seen.keys()) {
    if (!wanted.has(k)) errors.push(`nella SBOM e non nel lock: ${k}`);
  }
  return errors;
}

function selfTest() {
  const lockText = [
    "version = 4",
    "",
    "[[package]]",
    'name = "fub-app"',
    'version = "0.1.0"',
    'dependencies = ["serde"]',
    "",
    "[[package]]",
    'name = "serde"',
    'version = "1.0.0"',
    `source = "${CRATES_IO}"`,
    'checksum = "aa"',
    "",
    "[[package]]",
    'name = "serde"',
    'version = "0.9.0"',
    `source = "${CRATES_IO}"`,
    'checksum = "bb"',
    "",
    "[[package]]",
    'name = "motore"',
    'version = "2.0.0"',
    'source = "git+https://example.org/motore?rev=v2#0123abcd"',
    "",
  ].join("\n");
  const lock = parseLock(lockText);
  const pkg = (name, version, source, license = "MIT/Apache-2.0") => ({
    id: `${source ?? "path+file:///fub"}#${name}@${version}`,
    name,
    version,
    source,
    license,
  });
  const metadata = {
    packages: [
      pkg("serde", "1.0.0", CRATES_IO),
      pkg("fub-app", "0.1.0", null, "GPL-3.0-or-later"),
      pkg("serde", "0.9.0", CRATES_IO),
      pkg("motore", "2.0.0", "git+https://example.org/motore?rev=v2#0123abcd", "strana; licenza"),
    ],
    workspace_members: ["path+file:///fub#fub-app@0.1.0"],
    resolve: {
      nodes: [
        { id: "path+file:///fub#fub-app@0.1.0", deps: [{ pkg: `${CRATES_IO}#serde@1.0.0` }] },
      ],
    },
  };
  const build = () =>
    buildSbom({ metadata, lock, lockText, commit: "abc", created: "2026-11-16T00:00:00Z" });
  const failures = [];
  const expect = (label, errors, needle) => {
    const ok = needle === null ? errors.length === 0 : errors.some((e) => e.includes(needle));
    if (!ok) failures.push(`${label}: ${JSON.stringify(errors)}`);
  };

  const good = build();
  expect("SBOM giusta", verify(good, lock), null);
  if (JSON.stringify(build()) !== JSON.stringify(good)) failures.push("due generazioni diverse");
  const serde = good.packages.find((p) => p.name === "serde" && p.versionInfo === "1.0.0");
  if (serde?.licenseDeclared !== "MIT OR Apache-2.0") failures.push(`licenza: ${serde?.licenseDeclared}`);
  if (serde?.externalRefs?.[0]?.referenceLocator !== "pkg:cargo/serde@1.0.0") failures.push("purl");
  const motore = good.packages.find((p) => p.name === "motore");
  if (motore?.downloadLocation !== "git+https://example.org/motore@0123abcd") {
    failures.push(`git: ${motore?.downloadLocation}`);
  }
  if (motore?.licenseDeclared !== NOASSERTION) failures.push("licenza strana accettata");
  const edge = good.relationships.find((r) => r.relationshipType === "DEPENDS_ON");
  if (edge?.relatedSpdxElement !== serde?.SPDXID) failures.push("arco di dipendenza");

  const mutated = (change) => {
    const copy = structuredClone(good);
    change(copy);
    return copy;
  };
  expect(
    "manca un pacchetto",
    verify(mutated((s) => s.packages.splice(s.packages.findIndex((p) => p.versionInfo === "0.9.0"), 1)), lock),
    "nel lock e non nella SBOM: serde@0.9.0",
  );
  expect(
    "versione vecchia",
    verify(mutated((s) => { s.packages.find((p) => p.versionInfo === "1.0.0").versionInfo = "0.8.0"; }), lock),
    "nella SBOM e non nel lock: serde@0.8.0",
  );
  expect(
    "checksum cambiato",
    verify(mutated((s) => { s.packages.find((p) => p.versionInfo === "1.0.0").checksums[0].checksumValue = "cc"; }), lock),
    "checksum diverso per serde@1.0.0",
  );
  expect(
    "pacchetto in più",
    verify(mutated((s) => s.packages.push({ ...s.packages[0], name: "intruso" })), lock),
    "nella SBOM e non nel lock: intruso@",
  );
  expect(
    "pacchetto due volte",
    verify(mutated((s) => s.packages.push(s.packages[0])), lock),
    "pacchetto ripetuto",
  );
  expect("altra versione SPDX", verify(mutated((s) => { s.spdxVersion = "SPDX-2.2"; }), lock), "versione SPDX");

  if (failures.length) {
    console.error(`Autoprova di sbom.mjs fallita:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Autoprova di sbom.mjs riuscita.");
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const root = git("rev-parse", "--show-toplevel");
  const lockText = fs.readFileSync(path.join(root, "Cargo.lock"), "utf8");
  const lock = parseLock(lockText);

  const checkAt = argv.indexOf("--check");
  const outAt = argv.indexOf("--out");
  let sbom;
  let target;
  if (checkAt >= 0 && argv[checkAt + 1]) {
    target = argv[checkAt + 1];
    sbom = JSON.parse(fs.readFileSync(target, "utf8"));
  } else if (outAt >= 0 && argv[outAt + 1]) {
    target = argv[outAt + 1];
    const metadata = JSON.parse(
      execFileSync(process.env.CARGO ?? "cargo", ["metadata", "--format-version", "1", "--locked"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      }),
    );
    const commit = git("rev-parse", "HEAD");
    const created = new Date(Number(git("log", "-1", "--format=%ct")) * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    sbom = buildSbom({ metadata, lock, lockText, commit, created });
  } else {
    console.error("uso: sbom.mjs --out <file> | --check <file> | --self-test");
    process.exit(2);
  }

  const errors = verify(sbom, lock);
  if (errors.length) {
    console.error(`La SBOM ${target} non corrisponde a Cargo.lock:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
  if (outAt >= 0) fs.writeFileSync(target, `${JSON.stringify(sbom, null, 2)}\n`);
  console.log(`SBOM ${target}: ${sbom.packages.length} pacchetti, uguali a Cargo.lock.`);
}

main(process.argv.slice(2));
