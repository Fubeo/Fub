// Il banco WebView con `WAYLAND_DISPLAY`: senza `--x11` né `--wayland` non parte
// (la finestra andrebbe sullo schermo di chi misura, T46). La prova del
// cablaggio lancia `run.mjs` e non deve avviare niente: esce con 2 prima di
// scrivere le fixture e di cercare il driver.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { waylandProblem } from "./display.mjs";

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
