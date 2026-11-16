// I conti degli scenari F1–F3 (`frames.mjs`) e la CPU per processo
// (`cpuPercent` in `memory.mjs`).
import { describe, expect, it } from "vitest";

import { blockedPerRepetition, frameStats, parseWebkitGpu, renderPath } from "./frames.mjs";
import { cpuPercent } from "./memory.mjs";

describe("i fotogrammi rispetto al periodo", () => {
  it("a 60 Hz perfetti nessun fotogramma perso", () => {
    const stats = frameStats(Array(60).fill(16.67), 16.67);
    expect(stats).toMatchObject({ count: 60, median: 16.7, p95: 16.7, lost: 0, hz: 60 });
  });

  it("il tetto dei 60 Hz su uno schermo a 180: due fotogrammi persi ogni delta", () => {
    const stats = frameStats(Array(10).fill(16), 5.56);
    expect(stats.lost).toBe(20);
    expect(stats.hz).toBe(62.5);
  });

  it("un buco lungo conta i fotogrammi che copre", () => {
    expect(frameStats([16.7, 16.7, 50, 16.7], 16.67)).toMatchObject({ max: 50, lost: 2 });
    expect(frameStats([], 16.67)).toBeNull();
  });
});

describe("il thread principale bloccato per ripetizione", () => {
  it("il buco più lungo di ogni ripetizione, la mediana e i long task", () => {
    const blocked = blockedPerRepetition({
      marks: [0, 1000, 2000],
      // [fine del buco, durata]
      gaps: [[100, 8], [300, 95], [1500, 12], [2950, 60], [2960, 7]],
      stopped: 3000,
    });
    expect(blocked.perRep).toEqual([95, 12, 60]);
    expect(blocked.median).toBe(60);
    expect(blocked.max).toBe(95);
    expect(blocked.over50ms).toBe(155);
  });

  it("una ripetizione senza buchi vale zero", () => {
    expect(blockedPerRepetition({ marks: [0, 500], gaps: [], stopped: 1000 })).toMatchObject({ perRep: [0, 0], median: 0, max: 0 });
  });
});

/// Un pezzo di `webkit://gpu` su `pc-debian-di-fub` col driver disallineato.
const GPU_PAGE = ["VBlank type", "Timer", "VBlank refresh rate", "60Hz", "Renderer", "DMABuf (Supported buffers: Shared Memory)", "Threaded rendering", "GPU (2 threads)", "GL_RENDERER", "llvmpipe (LLVM 19.1.7, 256 bits)", "GL_VENDOR", "Mesa"].join("\n");

describe("il percorso di disegno", () => {
  it("llvmpipe è la CPU, un renderer vero è la GPU", () => {
    expect(renderPath({ webgl: "llvmpipe (LLVM 19.1.7, 256 bits)" }).path).toBe("cpu");
    expect(renderPath({ webgl: "NVIDIA GeForce RTX 4070/PCIe/SSE2" }).path).toBe("gpu");
    expect(renderPath({}).path).toBe("sconosciuto");
  });

  it("WebKitGTK nasconde il renderer a WebGL: vale webkit://gpu", () => {
    expect(renderPath({ webgl: "Apple GPU" })).toMatchObject({ path: "sconosciuto", renderer: null });
    const gpu = parseWebkitGpu(GPU_PAGE);
    expect(gpu).toEqual({ renderer: "llvmpipe (LLVM 19.1.7, 256 bits)", vblank: "Timer", vblankRate: "60Hz", buffers: "DMABuf (Supported buffers: Shared Memory)", threaded: "GPU (2 threads)" });
    expect(renderPath({ gpu, webgl: "Apple GPU" })).toMatchObject({ path: "cpu", source: "webkit://gpu", vblank: "Timer, 60Hz" });
    expect(parseWebkitGpu("niente\n")).toBeNull();
  });
});

describe("la CPU fra due letture", () => {
  it("per gruppo, in % di un core; un processo nato in mezzo conta da zero", () => {
    const before = [{ pid: 1, group: "webview", ticks: 100 }, { pid: 2, group: "app", ticks: 50 }];
    const after = [{ pid: 1, group: "webview", ticks: 300 }, { pid: 2, group: "app", ticks: 50 }, { pid: 3, group: "webview", ticks: 20 }];
    // 220 tick = 2,2 s di CPU in 1 s: 220 % di un core.
    expect(cpuPercent(before, after, 1000)).toEqual({ webview: 220, app: 0 });
    expect(cpuPercent(null, after, 1000)).toBeNull();
  });
});
