// @vitest-environment happy-dom
// Il controllo degli aggiornamenti della scheda «Informazioni»: parte soltanto
// dal pulsante, riconosce il proprio `job_done` e non scambia un esito che non
// capisce per un «aggiornato».
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KernelEvent } from "../host/contract";
import { api } from "../host/ipc";
import { forwardNotice } from "../state/kernel";
import { state } from "../state/store";
import { openLifetime } from "../ui/lifetime";
import { checkMessage, mountUpdateCheck, readCheck, UPDATES_CHECK, UPDATES_CHECK_JOB } from "./about";

function emit(event: KernelEvent): void {
  forwardNotice({ event, origin: { actor: { kind: "kernel" }, batch: null } });
}

afterEach(() => {
  vi.restoreAllMocks();
  state.vaultRoot = "";
});

describe("l'esito del controllo", () => {
  it("una versione più nuova porta la sua pagina, un link estraneo no", () => {
    expect(readCheck({ Ok: { latest: "0.2.0", newer: true, url: "https://github.com/Fubeo/Fub/releases/tag/v0.2.0" } }))
      .toEqual({ kind: "done", latest: "0.2.0", newer: true, url: "https://github.com/Fubeo/Fub/releases/tag/v0.2.0" });
    expect(readCheck({ Ok: { latest: "0.2.0", newer: true, url: "https://altrove.example/x" } }))
      .toMatchObject({ url: null });
  });

  it("un errore o una forma ignota sono un fallimento detto", () => {
    expect(readCheck({ Err: { kind: "io", message: "offline" } })).toEqual({ kind: "failed", reason: "offline" });
    expect(readCheck({ Ok: { latest: "0.2.0" } }).kind).toBe("failed");
    expect(readCheck(null).kind).toBe("failed");
    const status = readCheck({ Ok: { current: "0.1.0", failed: "status", status: 403 } });
    expect(status.kind).toBe("failed");
    expect(status.kind === "failed" && status.reason).toContain("403");
  });

  it("ogni stato ha la sua frase", () => {
    expect(checkMessage({ kind: "done", latest: null, newer: false, url: null }, "0.1.0")).not.toBe("");
    expect(checkMessage({ kind: "done", latest: "0.2.0", newer: true, url: null }, "0.1.0")).toContain("0.2.0");
    expect(checkMessage({ kind: "done", latest: "0.1.0", newer: false, url: null }, "0.1.0")).toContain("0.1.0");
  });
});

describe("il controllo", () => {
  it("senza vault non chiama niente e lo dice", async () => {
    const invoke = vi.spyOn(api, "invokeCommand");
    const lifetime = openLifetime();
    const checker = mountUpdateCheck(lifetime, () => {});
    await checker.start();
    expect(checker.state().kind).toBe("no_vault");
    expect(invoke).not.toHaveBeenCalled();
    lifetime.close();
  });

  it("accoda il comando e prende l'esito dal suo job, non da un altro", async () => {
    state.vaultRoot = "/vault";
    const invoke = vi.spyOn(api, "invokeCommand").mockResolvedValue({
      notify: null, effect: { kind: "done" }, undo: null, partial: null,
    });
    const changed = vi.fn();
    const lifetime = openLifetime();
    const checker = mountUpdateCheck(lifetime, changed);
    await checker.start();
    expect(invoke).toHaveBeenCalledWith(UPDATES_CHECK, {}, "apply", "/vault");
    expect(checker.state().kind).toBe("checking");

    emit({ type: "job_done", id: "1", job: "export", result: { Ok: { newer: true } } });
    expect(checker.state().kind).toBe("checking");
    emit({ type: "job_done", id: "2", job: UPDATES_CHECK_JOB, result: { Ok: { latest: "0.1.0", newer: false, url: null } } });
    expect(checker.state()).toEqual({ kind: "done", latest: "0.1.0", newer: false, url: null });
    expect(changed).toHaveBeenCalled();

    lifetime.close();
    await checker.start();
    expect(invoke, "chiuso il pannello, il pulsante non chiede più").toHaveBeenCalledTimes(1);
    emit({ type: "job_done", id: "3", job: UPDATES_CHECK_JOB, result: { Ok: { latest: "9.0.0", newer: true, url: null } } });
    expect(checker.state().kind, "e nessuno ascolta più").toBe("done");
  });

  it("un vault che cambia a metà lascia cadere il controllo", async () => {
    state.vaultRoot = "/vault";
    vi.spyOn(api, "invokeCommand").mockResolvedValue({ notify: null, effect: { kind: "done" }, undo: null, partial: null });
    const lifetime = openLifetime();
    const checker = mountUpdateCheck(lifetime, () => {});
    await checker.start();
    emit({ type: "vault_closed", root: "/vault" } as KernelEvent);
    expect(checker.state().kind).toBe("idle");
    lifetime.close();
  });
});
