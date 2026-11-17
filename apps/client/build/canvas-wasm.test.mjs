// Il passo di `canvas-wasm.mjs` quando manca qualcosa: l'errore dice che cosa
// installare, e non c'è ripiego su un `.wasm` di prima.
//
// Il bersaglio mancante è vero: un `--sysroot` vuoto fa dire a rustc lo
// stesso errore di un bersaglio non installato (E0463, «the
// `wasm32-unknown-unknown` target may not be installed»), con una cartella di
// cargo a parte che non tocca `target/canvas-wasm`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildCanvasWasm, CanvasWasmBuildError, isMissingTarget } from "./canvas-wasm.mjs";

const scratch = await mkdtemp(path.join(tmpdir(), "fub-canvas-wasm-"));

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("la build doveva fallire");
}

describe("il passo del nucleo della lavagna", () => {
  it("senza il bersaglio, l'errore dice il comando che lo installa", async () => {
    const sysroot = await mkdtemp(path.join(scratch, "sysroot-"));
    const error = await failure(
      buildCanvasWasm({
        targetDir: path.join(scratch, "target"),
        env: { ...process.env, RUSTFLAGS: `--sysroot ${sysroot}` },
      }),
    );
    expect(error).toBeInstanceOf(CanvasWasmBuildError);
    expect(error.kind).toBe("target-missing");
    expect(error.message).toContain("rustup target add wasm32-unknown-unknown");
    // Il messaggio di cargo resta, per chi indaga.
    expect(error.message).toContain("E0463");
  }, 180_000);

  it("senza cargo, l'errore dice che cosa installare", async () => {
    const error = await failure(buildCanvasWasm({ cargo: [path.join(scratch, "non-c-e", "cargo")] }));
    expect(error).toBeInstanceOf(CanvasWasmBuildError);
    expect(error.kind).toBe("cargo-missing");
    expect(error.message).toContain("https://rustup.rs");
    expect(error.message).toContain("rustup target add wasm32-unknown-unknown");
  });

  it("un altro errore di cargo non diventa un bersaglio mancante", async () => {
    // `node -e` al posto di cargo: scrive un errore qualunque ed esce con 101.
    const fake = [process.execPath, "-e", "process.stderr.write('error: qualcos\\'altro\\n'); process.exit(101)", "--"];
    const error = await failure(buildCanvasWasm({ cargo: fake, targetDir: path.join(scratch, "fake") }));
    expect(error.kind).toBe("cargo-failed");
    expect(error.message).toContain("qualcos'altro");
    expect(error.message).not.toContain("rustup target add");
  });

  it("riconosce le due forme dell'errore di rustc", () => {
    expect(isMissingTarget("note: the `wasm32-unknown-unknown` target may not be installed")).toBe(true);
    expect(isMissingTarget("error[E0463]: can't find crate for `std`")).toBe(true);
    expect(isMissingTarget("error[E0463]: can't find crate for `serde`")).toBe(false);
  });
});
