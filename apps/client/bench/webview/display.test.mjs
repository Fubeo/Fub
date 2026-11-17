// Il banco WebView con `WAYLAND_DISPLAY`: senza `--x11` né `--wayland` non parte
// (la finestra andrebbe sullo schermo di chi misura, T46). La prova del
// cablaggio lancia `run.mjs` e non deve avviare niente: esce con 2 prima di
// scrivere le fixture e di cercare il driver.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GTK_FAILED, GtkFailed, gtkWatcher, openWithGtkRetry, waylandProblem, xvfbResetProblem } from "./display.mjs";

const run = fileURLToPath(new URL("./run.mjs", import.meta.url));

describe("il banco su una sessione Wayland", () => {
  it("senza WAYLAND_DISPLAY può partire", () => {
    expect(waylandProblem({}, {})).toBeNull();
  });

  it("con WAYLAND_DISPLAY e senza scelta si ferma e dice --x11 e --wayland", () => {
    const message = waylandProblem({ WAYLAND_DISPLAY: "wayland-1" }, {});
    expect(message).toContain("--x11");
    expect(message).toContain("--wayland");
    expect(message).toContain("env -u WAYLAND_DISPLAY");
  });

  it("con --x11 o con --wayland la scelta è fatta", () => {
    expect(waylandProblem({ WAYLAND_DISPLAY: "wayland-1" }, { x11: "true" })).toBeNull();
    expect(waylandProblem({ WAYLAND_DISPLAY: "wayland-1" }, { wayland: "true" })).toBeNull();
  });

  it("run.mjs con WAYLAND_DISPLAY e senza scelta esce con 2 e lo dice, senza avviare l'app", () => {
    const result = spawnSync(process.execPath, [run, "--app=/nonexistent/fub", "--driver=/nonexistent/tauri-driver"], {
      env: { ...process.env, WAYLAND_DISPLAY: "wayland-1" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--x11");
    expect(result.stderr).toContain("--wayland");
  });
});

// #287: sotto un Xvfb che si rigenera quando esce il suo ultimo client, l'app
// dello scenario dopo a volte non apre il display e muore con GTK_FAILED.
describe("Xvfb senza -noreset", () => {
  const xvfb = (...extra) => ["Xvfb", ":99", "-screen", "0", "1280x800x24", ...extra, "-auth", "/tmp/xvfb-run.x/Xauthority"];

  it("lo dice per l'Xvfb che serve DISPLAY, e indica -noreset", () => {
    const message = xvfbResetProblem({ DISPLAY: ":99" }, [["node", "run.mjs"], xvfb()]);
    expect(message).toContain(":99");
    expect(message).toContain("-noreset");
    expect(xvfbResetProblem({ DISPLAY: ":99.0" }, [["/usr/bin/Xvfb", ":99"]])).toContain("-noreset");
  });

  it("tace con -noreset, su un altro display, senza Xvfb o senza DISPLAY", () => {
    expect(xvfbResetProblem({ DISPLAY: ":99" }, [xvfb("-noreset")])).toBeNull();
    expect(xvfbResetProblem({ DISPLAY: ":100" }, [xvfb()])).toBeNull();
    expect(xvfbResetProblem({ DISPLAY: ":0" }, [["/usr/lib/xorg/Xorg", ":0"]])).toBeNull();
    expect(xvfbResetProblem({}, [xvfb()])).toBeNull();
  });
});

describe("GTK che non parte", () => {
  const panic = `${GTK_FAILED}: BoolError { message: "Failed to initialize GTK" }`;

  it("il lettore dello stderr trova la riga anche spezzata, e soltanto quella", () => {
    const seen = [];
    const feed = gtkWatcher((line) => seen.push(line));
    feed("thread 'main' panicked at tao/event_loop.rs:217:53:\nFailed to ini");
    feed("tialize gtk backend!: BoolError { … }\nError serving connection\n");
    feed("(fub:1): dbind-WARNING **: AT-SPI\n");
    expect(seen).toEqual(["Failed to initialize gtk backend!: BoolError { … }"]);
  });

  /// Un driver finto: `outcomes` dice, tentativo per tentativo, se l'app
  /// muore con GTK (`"gtk"`), se la sessione si apre (`"ok"`) o se la
  /// richiesta fallisce in altro modo (`"errore"`).
  function fake(outcomes) {
    const listeners = new Set();
    const calls = { open: 0, restart: 0, aborted: 0, log: [] };
    const options = {
      open: (signal) => {
        const outcome = outcomes[calls.open++];
        if (outcome === "ok") return Promise.resolve({ id: calls.open });
        if (outcome === "errore") return Promise.reject(new Error("fetch failed"));
        // L'app muore e la richiesta resta appesa (WebKitWebDriver aspetterebbe
        // cinque minuti): soltanto `signal` la chiude.
        queueMicrotask(() => {
          for (const listener of [...listeners]) listener(panic);
        });
        return new Promise((_, fail) => signal.addEventListener("abort", () => {
          calls.aborted++;
          fail(new Error("aborted"));
        }));
      },
      watch: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      restart: async () => {
        calls.restart++;
      },
      log: (text) => calls.log.push(text),
    };
    return { options, calls, listeners };
  }

  it("una volta: interrompe la richiesta, riavvia il driver, riprova e lo dice", async () => {
    const { options, calls, listeners } = fake(["gtk", "ok"]);
    await expect(openWithGtkRetry("C1", options)).resolves.toEqual({ id: 2 });
    expect(calls).toMatchObject({ open: 2, restart: 1, aborted: 1 });
    expect(calls.log).toHaveLength(1);
    expect(calls.log[0]).toContain("C1");
    expect(calls.log[0]).toContain(GTK_FAILED);
    expect(listeners.size).toBe(0);
  });

  it("due volte: un solo nuovo tentativo, poi GtkFailed col driver di nuovo in piedi", async () => {
    const { options, calls, listeners } = fake(["gtk", "gtk", "ok"]);
    await expect(openWithGtkRetry("S1", options)).rejects.toBeInstanceOf(GtkFailed);
    expect(calls).toMatchObject({ open: 2, restart: 2, aborted: 2 });
    expect(calls.log).toHaveLength(1);
    expect(listeners.size).toBe(0);
  });

  it("un altro errore passa com'è, senza nuovi tentativi né riavvii", async () => {
    const { options, calls } = fake(["errore", "ok"]);
    await expect(openWithGtkRetry("S2", options)).rejects.toThrow("fetch failed");
    expect(calls).toMatchObject({ open: 1, restart: 0, aborted: 0 });
    expect(calls.log).toHaveLength(0);
  });

  it("una sessione che si apre non riavvia niente e non scrive niente", async () => {
    const { options, calls } = fake(["ok"]);
    await expect(openWithGtkRetry("S3", options)).resolves.toEqual({ id: 1 });
    expect(calls).toMatchObject({ open: 1, restart: 0, aborted: 0 });
    expect(calls.log).toHaveLength(0);
  });
});
