// Il nucleo della lavagna come modulo WebAssembly, fatto da Vite a ogni build
// (D-2 (a) del piano N3): la shell trova sempre il `.wasm` dei sorgenti di
// adesso, in sviluppo, nei test e nella build, e uno vecchio non può esistere.
//
// Il plugin dà il modulo virtuale `virtual:fub-canvas-wasm`, che esporta
// `loadCanvasWasm()` (i byte del modulo) e `canvasWasmHash`. Ogni volta che
// serve il modulo lancia il comando della pagina
// `docs/reference/canvas-operations.md` § «WebAssembly», con il suo
// `CARGO_TARGET_DIR` (`target/canvas-wasm` nella radice del repository):
// cargo ricompila solo se i sorgenti sono cambiati, e con due build insieme
// la seconda aspetta il lucchetto della cartella. Se cargo fallisce non c'è
// ripiego su un `.wasm` di prima: la build si ferma e dice perché.
//
// - `vite build`: compila all'inizio, emette il modulo come asset
//   (`assets/fub-canvas-<hash>.wasm`, anche se nessun modulo lo importa
//   ancora) e ne stampa la dimensione.
// - `vite` (sviluppo, banco): compila alla prima richiesta, serve i byte da
//   `/__fub-canvas-wasm/<hash>.wasm` e osserva i sorgenti dei due crate: un
//   `.rs` cambiato ricompila e ricarica la pagina.
// - Vitest: compila prima delle prove (`canvas-wasm.global-setup.mjs`), poi
//   legge il file dal disco.
//
// Serve `cargo` nel PATH con il bersaglio `wasm32-unknown-unknown`; senza,
// l'errore dice che cosa installare.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const VIRTUAL_ID = "virtual:fub-canvas-wasm";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const TARGET = "wasm32-unknown-unknown";
const SERVE_PREFIX = "__fub-canvas-wasm/";

/** La radice del repository: questo file sta in `apps/client/build/`. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** I crate da cui viene il modulo: un file cambiato qui lo ricompila. */
const CRATES = ["crates/fub-canvas-core", "crates/fub-canvas-wasm"];

/** Il comando di A5: la libreria `rlib` del crate fatta `cdylib` da `cargo rustc`. */
const CARGO_ARGS = [
  "rustc", "-p", "fub-canvas-wasm", "--lib", "--release", "--locked",
  "--target", TARGET, "--crate-type", "cdylib",
];

/** Le opzioni del profilo, da variabili d'ambiente: niente profilo nuovo nella radice. */
const PROFILE_ENV = {
  CARGO_PROFILE_RELEASE_OPT_LEVEL: "s",
  CARGO_PROFILE_RELEASE_LTO: "true",
  CARGO_PROFILE_RELEASE_PANIC: "abort",
  CARGO_PROFILE_RELEASE_STRIP: "true",
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "1",
};

const INSTALL_HINT = `rustup target add ${TARGET}`;

/** Un errore del passo, con il comando da lanciare quando manca qualcosa. */
export class CanvasWasmBuildError extends Error {
  /**
   * @param {string} message
   * @param {"cargo-missing" | "target-missing" | "cargo-failed" | "output-missing"} kind
   */
  constructor(message, kind) {
    super(message);
    this.name = "CanvasWasmBuildError";
    this.kind = kind;
  }
}

/** Vero se l'errore di cargo è quello di un bersaglio non installato. */
export function isMissingTarget(stderr) {
  return /target may not be installed|can't find crate for `(?:core|std)`/.test(stderr);
}

/**
 * Compila il modulo e ne dà i byte.
 *
 * @param {object} [options]
 * @param {string} [options.root] la radice del repository
 * @param {string} [options.targetDir] il `CARGO_TARGET_DIR` (predefinito `<root>/target/canvas-wasm`)
 * @param {readonly string[]} [options.cargo] il comando di cargo, con gli argomenti che lo precedono
 * @param {Record<string, string | undefined>} [options.env] l'ambiente (predefinito `process.env`)
 * @returns {Promise<{ bytes: Buffer, file: string, hash: string }>}
 */
export async function buildCanvasWasm(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const targetDir = path.resolve(root, options.targetDir ?? "target/canvas-wasm");
  const [command, ...prefix] = options.cargo ?? ["cargo"];
  const env = { ...(options.env ?? process.env), ...PROFILE_ENV, CARGO_TARGET_DIR: targetDir };
  const { code, stderr, spawnError } = await new Promise((resolve) => {
    const child = spawn(command, [...prefix, ...CARGO_ARGS], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
    let text = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      text += chunk;
    });
    child.on("error", (error) => resolve({ code: null, stderr: text, spawnError: error }));
    child.on("close", (status) => resolve({ code: status, stderr: text, spawnError: null }));
  });
  if (spawnError) {
    if (spawnError.code === "ENOENT") {
      throw new CanvasWasmBuildError(
        `fub-canvas-wasm: non trovo \`${command}\`. Il client compila il nucleo della lavagna con Rust: ` +
          `installa Rust (https://rustup.rs), poi il bersaglio con \`${INSTALL_HINT}\`.`,
        "cargo-missing",
      );
    }
    throw new CanvasWasmBuildError(`fub-canvas-wasm: \`${command}\` non parte: ${spawnError.message}`, "cargo-failed");
  }
  if (code !== 0) {
    const tail = stderr.trimEnd().split("\n").slice(-40).join("\n");
    if (isMissingTarget(stderr)) {
      const toolchain = env.RUSTUP_TOOLCHAIN ? ` --toolchain ${env.RUSTUP_TOOLCHAIN}` : "";
      throw new CanvasWasmBuildError(
        `fub-canvas-wasm: manca il bersaglio ${TARGET}, che serve al client per il nucleo della lavagna. ` +
          `Installalo con \`${INSTALL_HINT}${toolchain}\`.\n${tail}`,
        "target-missing",
      );
    }
    throw new CanvasWasmBuildError(`fub-canvas-wasm: cargo è uscito con ${String(code)}.\n${tail}`, "cargo-failed");
  }
  const file = path.join(targetDir, TARGET, "release", "fub_canvas_wasm.wasm");
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw new CanvasWasmBuildError(`fub-canvas-wasm: cargo è riuscito ma ${file} non c'è (${String(error)})`, "output-missing");
  }
  return { bytes, file, hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16) };
}

/** La dimensione del modulo, per la riga che la build stampa. */
export function describeSize(bytes) {
  const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
  return `${kib(bytes.length)}, ${kib(gzipSync(bytes, { level: 9 }).length)} compressi`;
}

/** Vero se `file` (assoluto) è un sorgente da cui viene il modulo. */
function isSource(root, file) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel === "Cargo.lock" || rel === "Cargo.toml") return true;
  return CRATES.some((crate) => rel === `${crate}/Cargo.toml` || (rel.startsWith(`${crate}/src/`) && rel.endsWith(".rs")));
}

/** I sorgenti da cui viene il modulo, come percorsi assoluti. */
async function sourceFiles(root) {
  const files = [path.join(root, "Cargo.toml"), path.join(root, "Cargo.lock")];
  for (const crate of CRATES) {
    files.push(path.join(root, crate, "Cargo.toml"));
    const src = path.join(root, crate, "src");
    for (const entry of await readdir(src, { recursive: true })) {
      if (entry.endsWith(".rs")) files.push(path.join(src, entry));
    }
  }
  return files;
}

/**
 * Il plugin di Vite.
 *
 * @param {Parameters<typeof buildCanvasWasm>[0]} [options] come `buildCanvasWasm`
 * @returns {import("vite").Plugin}
 */
export function canvasWasm(options = {}) {
  const root = options.root ?? REPO_ROOT;
  let command = "serve";
  let base = "/";
  let logger = console;
  /** @type {Promise<{ bytes: Buffer, file: string, hash: string }> | null} */
  let built = null;
  /** Le modifiche ai sorgenti: una build partita prima di una modifica non vale più. */
  let generation = 0;
  let assetRef = null;

  /** I byte dei sorgenti di adesso: una build che una modifica ha superato si rifà. */
  const current = () => {
    if (!built) {
      const started = generation;
      const attempt = buildCanvasWasm(options).then(
        // Una modifica arrivata durante la build l'ha già tolta di mezzo
        // (`built = null`): si rifà sui sorgenti nuovi.
        (result) => (started === generation ? result : current()),
        (error) => {
          if (built === attempt) built = null;
          throw error;
        },
      );
      built = attempt;
    }
    return built;
  };

  return {
    name: "fub-canvas-wasm",
    configResolved(config) {
      command = config.command;
      base = config.base;
      logger = config.logger;
    },
    async buildStart() {
      if (command !== "build") return;
      logger.info("fub-canvas-wasm: compilo il nucleo della lavagna…");
      let result;
      try {
        result = await current();
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
      // Sempre fra gli asset, anche prima che un modulo lo importi.
      assetRef = this.emitFile({ type: "asset", name: "fub-canvas.wasm", source: result.bytes });
      // Con `vite build --watch` un sorgente cambiato rifà la build.
      for (const file of await sourceFiles(root)) this.addWatchFile(file);
    },
    writeBundle() {
      if (command !== "build" || !assetRef || !built) return;
      const name = this.getFileName(assetRef);
      return built.then((result) => logger.info(`fub-canvas-wasm: ${name} · ${describeSize(result.bytes)}`));
    },
    watchChange(id) {
      if (isSource(root, id)) {
        generation++;
        built = null;
      }
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      let result;
      try {
        result = await current();
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
      const hash = JSON.stringify(result.hash);
      if (command === "build") {
        return [
          `export const canvasWasmHash = ${hash};`,
          `const url = import.meta.ROLLUP_FILE_URL_${assetRef};`,
          fetchLoader(),
        ].join("\n");
      }
      if (process.env.VITEST) {
        // Vitest gira in Node: il file si legge dal disco, quello appena fatto.
        return [
          `export const canvasWasmHash = ${hash};`,
          `export async function loadCanvasWasm() {`,
          `  const { readFile } = await import("node:fs/promises");`,
          `  return readFile(${JSON.stringify(result.file)});`,
          `}`,
        ].join("\n");
      }
      return [
        `export const canvasWasmHash = ${hash};`,
        `const url = ${JSON.stringify(`${base}${SERVE_PREFIX}${result.hash}.wasm`)};`,
        fetchLoader(),
      ].join("\n");
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const prefix = `${base}${SERVE_PREFIX}`;
        if (!req.url?.startsWith(prefix)) return next();
        current().then(
          (result) => {
            if (req.url !== `${prefix}${result.hash}.wasm`) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.setHeader("Content-Type", "application/wasm");
            // L'hash è nel nome, e un nome vecchio risponde 404: il browser
            // non può tenere un modulo di prima.
            res.setHeader("Cache-Control", "no-cache");
            res.end(result.bytes);
          },
          (error) => next(error),
        );
      });
      if (!server.watcher) return;
      server.watcher.add([...CRATES.map((crate) => path.join(root, crate)), path.join(root, "Cargo.lock")]);
      const changed = (file) => {
        if (!isSource(root, file)) return;
        generation++;
        built = null;
        const module = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (!module) return;
        server.moduleGraph.invalidateModule(module);
        logger.info("fub-canvas-wasm: sorgente cambiato, ricompilo il nucleo della lavagna", { timestamp: true });
        server.ws.send({ type: "full-reload" });
      };
      for (const event of ["add", "change", "unlink"]) server.watcher.on(event, changed);
    },
  };
}

/** Il caricatore del browser: i byte dall'URL del modulo. */
function fetchLoader() {
  return [
    `export async function loadCanvasWasm() {`,
    `  const response = await fetch(url);`,
    `  if (!response.ok) throw new Error(\`fub-canvas-wasm: \${url} risponde \${response.status}\`);`,
    `  return response.arrayBuffer();`,
    `}`,
  ].join("\n");
}
