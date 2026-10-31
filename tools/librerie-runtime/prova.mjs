#!/usr/bin/env node
// La prova delle librerie a runtime (livello 3 del piano dei componenti, K0),
// su Linux, macOS e Windows:
//
//   node tools/librerie-runtime/prova.mjs --out DIR
//
// 1. compila ospite, comune e i due componenti con `-C prefer-dynamic`;
// 2. mette insieme la consegna: l'ospite, la libreria comune e quella
//    standard di Rust accanto, i componenti in `componenti/`;
// 3. fa girare l'ospite con tutti e due i componenti, poi toglie il file di B
//    e lo rifà girare: B deve sparire, A restare;
// 4. compila l'ospite statico, con i componenti dentro, e confronta il peso;
// 5. su macOS controlla la firma di ogni file con `codesign -v`.
//
// Scrive DIR/referto.json ed esce con 1 se una prova non passa.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const windows = process.platform === "win32";
const mac = process.platform === "darwin";

function args() {
  const i = process.argv.indexOf("--out");
  if (i < 0 || !process.argv[i + 1]) throw new Error("uso: prova.mjs --out DIR");
  return process.argv[i + 1];
}

function run(cmd, argv, opts = {}) {
  const result = spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 1 << 26, ...opts });
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${argv.join(" ")}: uscita ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

/// Il nome di una libreria dinamica sul sistema di adesso.
const dylib = (name) => (windows ? `${name}.dll` : mac ? `lib${name}.dylib` : `lib${name}.so`);
const exe = (name) => (windows ? `${name}.exe` : name);

/// La libreria standard di Rust in forma dinamica: sta nel sysroot.
function stdLibrary() {
  const dirs = [run("rustc", ["--print", "target-libdir"]).stdout.trim()];
  if (windows) dirs.push(join(run("rustc", ["--print", "sysroot"]).stdout.trim(), "bin"));
  for (const dir of dirs) {
    const found = readdirSync(dir).find((f) => /^(lib)?std-[0-9a-f]+\.(so|dylib|dll)$/.test(f));
    if (found) return join(dir, found);
  }
  throw new Error(`nessuna libreria standard dinamica in ${dirs.join(", ")}`);
}

function ospite(bin, componenti) {
  // Le librerie dell'ospite (comune e standard) stanno accanto a lui; i
  // componenti le trovano nello stesso modo.
  const key = windows ? "PATH" : mac ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
  const env = { ...process.env, [key]: [bin, process.env[key]].filter(Boolean).join(windows ? ";" : ":") };
  const result = run(join(bin, exe("ospite")), [componenti], { env, allowFail: true });
  if (result.status !== 0) return { uscita: result.status, stderr: result.stderr.slice(-2000) };
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

const size = (path) => statSync(path).size;

function main() {
  const out = args();
  rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  mkdirSync(out, { recursive: true });
  const manifest = join(here, "Cargo.toml");
  const prove = [];
  const check = (nome, passa, visto) => prove.push({ nome, passa, visto });

  // 1. La compilazione dinamica.
  const dinamico = join(out, "target-dinamico");
  const env = { ...process.env, RUSTFLAGS: "-C prefer-dynamic", CARGO_TARGET_DIR: dinamico };
  run("cargo", ["build", "--release", "--manifest-path", manifest], { env, stdio: ["ignore", "ignore", "pipe"] });
  const release = join(dinamico, "release");

  // 2. La consegna.
  const bin = join(out, "consegna", "bin");
  const componenti = join(out, "consegna", "componenti");
  mkdirSync(bin, { recursive: true });
  mkdirSync(componenti, { recursive: true });
  const std = stdLibrary();
  const file = {
    ospite: join(bin, exe("ospite")),
    comune: join(bin, dylib("comune")),
    standard: join(bin, std.split(/[\\/]/).pop()),
    a: join(componenti, dylib("componente_a")),
    b: join(componenti, dylib("componente_b")),
  };
  copyFileSync(join(release, exe("ospite")), file.ospite);
  copyFileSync(join(release, dylib("comune")), file.comune);
  copyFileSync(std, file.standard);
  copyFileSync(join(release, dylib("componente_a")), file.a);
  copyFileSync(join(release, dylib("componente_b")), file.b);

  // 3. Con tutti e due, poi senza B.
  const tutti = ospite(bin, componenti);
  const nomi = (r) => (r.componenti ?? []).map((c) => c.nome).join(",");
  check("due componenti caricati", nomi(tutti) === "componente-a,componente-b" && (tutti.errori ?? []).length === 0, tutti);
  check("una libreria comune sola in memoria", tutti.chiamate_viste_dall_ospite === 2, tutti.chiamate_viste_dall_ospite);
  rmSync(file.b);
  const senzaB = ospite(bin, componenti);
  check("tolto il file di B, resta A", nomi(senzaB) === "componente-a" && senzaB.chiamate_viste_dall_ospite === 1, senzaB);
  copyFileSync(join(release, dylib("componente_b")), file.b);

  // 4. L'ospite statico, con i componenti dentro. Solo il suo pacchetto: con
  // tutto il workspace la feature `ingresso` dei componenti tornerebbe accesa.
  const statico = join(out, "target-statico");
  run("cargo", ["build", "--release", "-p", "librerie-runtime-ospite", "--features", "statico", "--manifest-path", manifest], {
    env: { ...process.env, CARGO_TARGET_DIR: statico },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const ospiteStatico = join(statico, "release", exe("ospite"));
  const fermo = JSON.parse(run(ospiteStatico, ["--statico"]).stdout.trim());
  check("l'ospite statico dà gli stessi risultati", JSON.stringify(fermo.componenti) === JSON.stringify(tutti.componenti), fermo);

  // 5. Le firme su macOS: il linker firma ad hoc, la copia deve restare valida.
  if (mac) {
    for (const [nome, path] of Object.entries(file)) {
      const r = run("codesign", ["-v", path], { allowFail: true });
      check(`firma valida: ${nome}`, r.status === 0, r.stderr.trim());
    }
  }

  const peso = Object.fromEntries(Object.entries(file).map(([k, p]) => [k, size(p)]));
  const referto = {
    sistema: process.platform,
    architettura: process.arch,
    rustc: run("rustc", ["--version"]).stdout.trim(),
    peso: {
      dinamico: peso,
      dinamico_totale: Object.values(peso).reduce((a, b) => a + b, 0),
      statico: size(ospiteStatico),
    },
    prove,
  };
  writeFileSync(join(out, "referto.json"), JSON.stringify(referto, null, 2) + "\n");
  for (const p of prove) console.log(`${p.passa ? "✓" : "✗"} ${p.nome}`);
  console.log(`peso: dinamico ${referto.peso.dinamico_totale} byte (${JSON.stringify(peso)}), statico ${referto.peso.statico} byte`);
  if (prove.some((p) => !p.passa)) process.exit(1);
}

main();
