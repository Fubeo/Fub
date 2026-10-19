// I `fub://` del sistema: chi legge si esegue, chi scrive aspetta il sì, un
// altro vault si apre soltanto se lo si chiede, e un campanello durante un giro
// non ne avvia un secondo in parallelo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutcome } from "../host/contract";
import type { IncomingLink, IncomingPorts } from "./incoming-links";

const fake = vi.hoisted(() => ({
  invoke: vi.fn(),
  ring: null as null | (() => void),
}));
vi.mock("../host/ipc", () => ({
  api: {
    invokeCommand: fake.invoke,
    // La coda passa dallo stesso finto dei comandi, col suo id.
    takePendingUris: () => fake.invoke("uri.pending", {}, "apply"),
    onPendingUris: (handler: () => void) => {
      fake.ring = handler;
      return Promise.resolve(() => { fake.ring = null; });
    },
  },
}));

import { mountIncomingLinks, searchQuery } from "./incoming-links";
import { openLifetime } from "./lifetime";

const outcome = (effect: CommandOutcome["effect"], notify: string | null = null): CommandOutcome =>
  ({ notify, effect, undo: null, partial: null }) as CommandOutcome;

const queue = (actions: IncomingLink[], refused = 0) =>
  outcome({ kind: "custom", ns: "fub.uri.pending", payload: { actions, refused } });

const here = { asked: "Diario", root: "/v/Diario", current: true };

type Mocked = { [K in keyof IncomingPorts]: ReturnType<typeof vi.fn<IncomingPorts[K]>> };

function ports(answer = true): Mocked {
  return {
    confirm: vi.fn<IncomingPorts["confirm"]>(async () => answer),
    notify: vi.fn<IncomingPorts["notify"]>(),
    openVault: vi.fn<IncomingPorts["openVault"]>(async () => true),
    open: vi.fn<IncomingPorts["open"]>(async () => true),
    search: vi.fn<IncomingPorts["search"]>(),
    show: vi.fn<IncomingPorts["show"]>(async () => {}),
  };
}

/// Lascia girare le promesse finché il giro della coda è finito.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/// Risponde a `uri.pending` con le code date, una per chiamata, poi vuota.
function pendingSequence(...queues: CommandOutcome[]) {
  fake.invoke.mockImplementation(async (id: string, _args: unknown, mode: string) => {
    if (id === "uri.pending") return queues.shift() ?? queue([]);
    if (id === "uri.apply" && mode === "dry_run") {
      return outcome({ kind: "plan", summary: "Crea Ciao.md", docs: ["Ciao.md"], edits: [] } as never);
    }
    if (id === "uri.apply") return outcome({ kind: "navigate", doc: "Ciao.md" }, "Creata Ciao.md");
    throw new Error(id);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.ring = null;
});

describe("collegamenti fub:// in arrivo", () => {
  it("apre la nota al punto e nel posto chiesti, senza conferma", async () => {
    pendingSequence(queue([
      { raw: "fub://open?note=a", action: "open", writes: false, vault: here, note: "a", heading: "Due", split: "down" },
    ]));
    const p = ports();
    mountIncomingLinks(openLifetime(), p);
    await settle();
    expect(p.open).toHaveBeenCalledWith("a", "Due", null, "col");
    expect(p.confirm).not.toHaveBeenCalled();
  });

  it("una nota che non c'è si dice, e non si crea", async () => {
    pendingSequence(queue([{ raw: "fub://open?note=x", action: "open", vault: here, note: "x" }]));
    const p = ports();
    p.open.mockResolvedValue(false);
    mountIncomingLinks(openLifetime(), p);
    await settle();
    expect(p.notify).toHaveBeenCalledWith(expect.stringContaining("x"), "guasto");
    expect(fake.invoke).not.toHaveBeenCalledWith("uri.apply", expect.anything(), "apply");
  });

  it("chi scrive mostra la prova e scrive soltanto dopo il sì", async () => {
    const link: IncomingLink = { raw: "fub://new?title=Ciao", action: "new", writes: true, vault: here, title: "Ciao" };
    pendingSequence(queue([link]));
    const no = ports(false);
    mountIncomingLinks(openLifetime(), no);
    await settle();
    expect(no.confirm).toHaveBeenCalledWith(expect.stringContaining("Crea Ciao.md"), expect.anything());
    expect(fake.invoke).toHaveBeenCalledWith("uri.apply", { uri: link.raw }, "dry_run");
    expect(fake.invoke).not.toHaveBeenCalledWith("uri.apply", expect.anything(), "apply");

    pendingSequence(queue([link]));
    const yes = ports(true);
    mountIncomingLinks(openLifetime(), yes);
    await settle();
    expect(fake.invoke).toHaveBeenCalledWith("uri.apply", { uri: link.raw }, "apply");
    expect(yes.show).toHaveBeenCalledWith("Ciao.md");
    expect(yes.notify).toHaveBeenCalledWith("Creata Ciao.md", "info");
  });

  it("un altro vault si apre dopo il sì; uno sconosciuto o rifiutato ferma il collegamento", async () => {
    const other = { asked: "Lavoro", root: "/v/Lavoro", current: false };
    pendingSequence(queue([
      { raw: "fub://open?vault=Lavoro&note=a", action: "open", vault: other, note: "a" },
      { raw: "fub://open?vault=Boh&note=a", action: "open", vault: { asked: "Boh", root: null, current: false }, note: "a" },
    ]));
    const p = ports();
    mountIncomingLinks(openLifetime(), p);
    await settle();
    expect(p.openVault).toHaveBeenCalledWith("/v/Lavoro");
    expect(p.open).toHaveBeenCalledTimes(1);
    expect(p.notify).toHaveBeenCalledWith(expect.stringContaining("Boh"), "guasto");

    pendingSequence(queue([{ raw: "fub://open?vault=Lavoro&note=a", action: "open", vault: other, note: "a" }]));
    const failed = ports();
    failed.openVault.mockResolvedValue(false);
    mountIncomingLinks(openLifetime(), failed);
    await settle();
    expect(failed.open).not.toHaveBeenCalled();
  });

  it("un collegamento non valido e la coda piena si dicono", async () => {
    pendingSequence(queue([{ raw: "fub://exec", error: "azione sconosciuta" }], 2));
    const p = ports();
    mountIncomingLinks(openLifetime(), p);
    await settle();
    expect(p.notify).toHaveBeenCalledWith(expect.stringContaining("azione sconosciuta"), "guasto");
    expect(p.notify).toHaveBeenCalledWith(expect.stringContaining("2"), "guasto");
  });

  it("un campanello durante il giro ne fa un altro alla fine, mai due insieme", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let peak = 0;
    let calls = 0;
    fake.invoke.mockImplementation(async () => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      if (calls === 1) await gate;
      active -= 1;
      return queue([]);
    });
    const life = openLifetime();
    mountIncomingLinks(life, ports());
    await settle();
    fake.ring?.();
    fake.ring?.();
    release();
    await settle();
    await settle();
    expect(calls).toBe(2);
    expect(peak).toBe(1);
    life.close();
    expect(fake.ring).toBeNull();
  });

  it("un host senza la coda non è un guasto", async () => {
    fake.invoke.mockRejectedValue({ kind: "unknown_command", message: "uri.pending" });
    const p = ports();
    mountIncomingLinks(openLifetime(), p);
    await settle();
    expect(p.notify).not.toHaveBeenCalled();
  });

  it("la ricerca porta i filtri nella sintassi della barra", () => {
    expect(searchQuery({ raw: "", q: "lago", tag: "#viaggi", folder: "note di viaggio" }))
      .toBe('lago tag:viaggi folder:"note di viaggio"');
  });
});
