import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../ui/lifetime";
import { idleSchedule } from "./idle";

/// Finti solo i `setTimeout`: i timer finti di Vitest fingono anche
/// `requestIdleCallback`, e coprirebbero quello del test.
function useFakeTimeouts(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

/// Un `requestIdleCallback` finto: tiene le richieste e le fa girare a comando.
function fakeIdle() {
  const requests = new Map<number, { run: () => void; timeout: number | undefined }>();
  let next = 1;
  const cancelled: number[] = [];
  return {
    requests,
    cancelled,
    request: vi.fn((run: () => void, options?: { timeout?: number }) => {
      const handle = next++;
      requests.set(handle, { run, timeout: options?.timeout });
      return handle;
    }),
    cancel: vi.fn((handle: number) => {
      cancelled.push(handle);
      requests.delete(handle);
    }),
    runAll(): void {
      const all = [...requests.values()];
      requests.clear();
      for (const request of all) request.run();
    },
  };
}

describe("idleSchedule con requestIdleCallback", () => {
  let idle: ReturnType<typeof fakeIdle>;

  beforeEach(() => {
    useFakeTimeouts();
    idle = fakeIdle();
    vi.stubGlobal("requestIdleCallback", idle.request);
    vi.stubGlobal("cancelIdleCallback", idle.cancel);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("chiede al browser il tempo libero, col timeout dato", () => {
    const owner = openLifetime();
    const schedule = idleSchedule(owner, 250);
    const run = vi.fn();
    schedule(run);
    expect(idle.request).toHaveBeenCalledTimes(1);
    expect([...idle.requests.values()][0]!.timeout).toBe(250);
    // Non è un setTimeout.
    vi.runAllTimers();
    expect(run).not.toHaveBeenCalled();
    idle.runAll();
    expect(run).toHaveBeenCalledTimes(1);
    owner.close();
  });

  it("il timeout di serie è 100 millisecondi", () => {
    const owner = openLifetime();
    idleSchedule(owner)(() => {});
    expect([...idle.requests.values()][0]!.timeout).toBe(100);
    owner.close();
  });

  it("l'annulla cancella la richiesta, una volta sola", () => {
    const owner = openLifetime();
    const run = vi.fn();
    const cancel = idleSchedule(owner)(run);
    cancel();
    cancel();
    expect(idle.cancel).toHaveBeenCalledTimes(1);
    idle.runAll();
    expect(run).not.toHaveBeenCalled();
    owner.close();
    expect(idle.cancel).toHaveBeenCalledTimes(1);
  });

  it("un annulla dopo che la richiesta è girata non cancella niente", () => {
    const owner = openLifetime();
    const run = vi.fn();
    const cancel = idleSchedule(owner)(run);
    idle.runAll();
    cancel();
    owner.close();
    expect(run).toHaveBeenCalledTimes(1);
    expect(idle.cancel).not.toHaveBeenCalled();
  });

  it("la chiusura della Lifetime cancella le richieste in attesa, solo quelle", () => {
    const owner = openLifetime();
    const schedule = idleSchedule(owner);
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    schedule(first);
    schedule(second);
    const cancelThird = schedule(third);
    // La prima gira, la terza si annulla: alla chiusura resta solo la seconda.
    const [firstHandle] = [...idle.requests.keys()];
    const firstRequest = idle.requests.get(firstHandle!)!;
    idle.requests.delete(firstHandle!);
    firstRequest.run();
    cancelThird();
    idle.cancel.mockClear();
    owner.close();
    expect(idle.cancel).toHaveBeenCalledTimes(1);
    expect(idle.cancel).toHaveBeenCalledWith(2);
    idle.runAll();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
  });

  it("una richiesta che il browser fa girare dopo la chiusura non gira", () => {
    const owner = openLifetime();
    const run = vi.fn();
    idleSchedule(owner)(run);
    const stale = [...idle.requests.values()][0]!;
    owner.close();
    stale.run();
    expect(run).not.toHaveBeenCalled();
  });

  it("su una Lifetime chiusa una richiesta non chiede niente", () => {
    const owner = openLifetime();
    const schedule = idleSchedule(owner);
    owner.close();
    const run = vi.fn();
    const cancel = schedule(run);
    expect(idle.request).not.toHaveBeenCalled();
    cancel();
    expect(idle.cancel).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(run).not.toHaveBeenCalled();
  });

  it("legge requestIdleCallback a ogni richiesta, non all'import", () => {
    const owner = openLifetime();
    const schedule = idleSchedule(owner);
    vi.stubGlobal("requestIdleCallback", undefined);
    const run = vi.fn();
    schedule(run);
    expect(idle.request).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
    owner.close();
  });
});

describe("idleSchedule senza requestIdleCallback (WebKitGTK)", () => {
  beforeEach(() => {
    useFakeTimeouts();
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ripiega su setTimeout(run, 0)", () => {
    const owner = openLifetime();
    const run = vi.fn();
    idleSchedule(owner)(run);
    expect(vi.getTimerCount()).toBe(1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);
    owner.close();
  });

  it("l'annulla cancella il timer", () => {
    const owner = openLifetime();
    const run = vi.fn();
    const cancel = idleSchedule(owner)(run);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(run).not.toHaveBeenCalled();
    owner.close();
  });

  it("la chiusura della Lifetime cancella i timer in attesa", () => {
    const owner = openLifetime();
    const schedule = idleSchedule(owner);
    const first = vi.fn();
    const second = vi.fn();
    schedule(first);
    schedule(second);
    expect(vi.getTimerCount()).toBe(2);
    owner.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("su una Lifetime chiusa una richiesta non arma timer", () => {
    const owner = openLifetime();
    const schedule = idleSchedule(owner);
    owner.close();
    const run = vi.fn();
    schedule(run);
    expect(vi.getTimerCount()).toBe(0);
  });
});
