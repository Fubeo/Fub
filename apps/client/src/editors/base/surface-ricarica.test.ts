// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult, KernelEvent } from "../../host/contract";
import { forwardNotice } from "../../state/kernel";
import { mountBaseSurface } from "./surface";

// Quante volte la Base rilegge il vault per un fatto del kernel (#520). Il
// kernel annuncia un salvataggio con `document_changed` e subito dopo
// `index_updated`, che arrivano al webview in due giri separati.

vi.mock("../../ui/notify", () => ({ notify: () => {} }));

const NOTES = 3000;

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  let stato = "Da fare";
  // La risposta di `derive` si può tenere ferma, per le prove sull'ordine.
  let hold: Promise<void> | null = null;
  const queryIndex = vi.fn(async (request: IndexQuery): Promise<IndexResult> => {
    // La risposta dell'IPC arriva in un altro giro, come quella vera.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (request.kind === "documents") {
      const offset = request.page?.offset ?? 0;
      const count = Math.max(0, Math.min(request.page?.limit ?? 0, NOTES - offset));
      return { kind: "documents", value: { offset, total: NOTES, items: Array.from({ length: count }, (_, i) => ({
        doc: `n${offset + i}.md`, properties: [{ key: "stato", value: { kind: "text", value: offset + i === 0 ? stato : "Da fare" } }],
      })) } };
    }
    const query = request.kind === "custom" ? request.query as { op: string; rows?: { doc: string; props: Record<string, { value: string }> }[] } : null;
    if (query?.op === "parse") return { kind: "custom", value: { views: ["Tabella"], types: ["table"] } };
    if (query?.op === "plan") return { kind: "custom", value: {
      view: "Tabella", view_type: "table", columns: ["stato"], column_labels: {}, required_props: ["stato"], all_properties: false,
      group: null, limit: null, map: null, create_defaults: {}, filters: "all", sort: [], order: [],
    } };
    if (query?.op === "derive") {
      const rows = query.rows!.map((row) => ({ doc: row.doc, values: { stato: { kind: "text", value: row.props.stato?.value ?? "" } } }));
      if (hold) await hold;
      return { kind: "custom", value: { summaries: {}, rows } };
    }
    throw new Error(`unexpected query ${JSON.stringify(request).slice(0, 80)}`);
  });
  const surface = mountBaseSurface("base", { paneId: "base-ricarica", documentId: "Tutte.base", parent: host }, {
    queryIndex, invokeCommand: vi.fn(async () => ({})), viewState: async () => null, setViewState: async () => {}, onOpenDocument: () => {},
  });
  surface.buffer.setDoc("views:\n  - {name: Tabella, type: table}\n");
  const derives = () => queryIndex.mock.calls.filter(([q]) => q.kind === "custom" && (q.query as { op: string }).op === "derive").length;
  const reads = () => queryIndex.mock.calls.filter(([q]) => q.kind === "documents" && (q.page?.offset ?? 0) === 0).length;
  return {
    host, queryIndex, derives, reads,
    save: (value: string) => { stato = value; },
    holdDerive: () => { let release = () => {}; hold = new Promise<void>((resolve) => { release = resolve; }); return () => { hold = null; release(); }; },
    close: () => { surface.destroy(); host.remove(); },
  };
}

const emit = (event: KernelEvent) => forwardNotice({ event, origin: { actor: { kind: "kernel" }, batch: null } });
const changed = (id: string): KernelEvent => ({ type: "document_changed", id, changes: { aspects: ["frontmatter"], properties: ["stato"], tags_added: [], tags_removed: [] } });
const INDEX: KernelEvent = { type: "index_updated" };
// Un altro giro del ciclo degli eventi, come fra due messaggi del ponte.
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const cell = (host: HTMLElement) => host.querySelector<HTMLInputElement>('tr[data-doc="n0.md"] td[data-cell="1"] input')?.value;
const settle = async (base: ReturnType<typeof mount>) => {
  await nextTask();
  await vi.waitFor(() => expect(base.queryIndex.mock.results.every((r) => r.type === "return")).toBe(true));
  // Le risposte già date sono state lette.
  for (let i = 0; i < 5; i++) await nextTask();
};

describe("una Base rilegge il vault una volta per salvataggio (#520)", () => {
  it("document_changed e poi index_updated, in due giri, sono una ricarica sola con la nota scritta", async () => {
    const base = mount();
    try {
      await vi.waitFor(() => expect(cell(base.host)).toBe("Da fare"));
      await settle(base);
      const reads = base.reads();
      base.save("Fatto");
      emit(changed("n0.md"));
      await nextTask();
      emit(INDEX);
      await settle(base);
      expect(base.reads() - reads).toBe(1);
      expect(cell(base.host)).toBe("Fatto");
    } finally { base.close(); }
  });

  it("due salvataggi sono due ricariche, e vince l'ultimo", async () => {
    const base = mount();
    try {
      await vi.waitFor(() => expect(cell(base.host)).toBe("Da fare"));
      await settle(base);
      const reads = base.reads();
      base.save("In corso");
      emit(changed("n0.md"));
      await nextTask();
      emit(INDEX);
      await settle(base);
      base.save("Fatto");
      emit(changed("n0.md"));
      await nextTask();
      emit(INDEX);
      await settle(base);
      expect(base.reads() - reads).toBe(2);
      expect(cell(base.host)).toBe("Fatto");
    } finally { base.close(); }
  });

  it("un index_updated senza un fatto di nota ricarica", async () => {
    const base = mount();
    try {
      await vi.waitFor(() => expect(cell(base.host)).toBe("Da fare"));
      await settle(base);
      const reads = base.reads();
      base.save("Fatto");
      emit(INDEX);
      await settle(base);
      expect(base.reads() - reads).toBe(1);
      expect(cell(base.host)).toBe("Fatto");
    } finally { base.close(); }
  });

  it("un host che manda solo document_changed (il finto) non lascia indietro l'index_updated dopo", async () => {
    const base = mount();
    try {
      await vi.waitFor(() => expect(cell(base.host)).toBe("Da fare"));
      await settle(base);
      const reads = base.reads();
      base.save("In corso");
      emit(changed("n0.md"));
      await settle(base);
      expect(cell(base.host)).toBe("In corso");
      // Più tardi l'indice cambia da solo: la Base lo rilegge.
      base.save("Fatto");
      emit(INDEX);
      await settle(base);
      expect(base.reads() - reads).toBe(2);
      expect(cell(base.host)).toBe("Fatto");
    } finally { base.close(); }
  });

  it("batch_ended e overflow ricaricano anche dopo un fatto di nota", async () => {
    const base = mount();
    try {
      await vi.waitFor(() => expect(cell(base.host)).toBe("Da fare"));
      await settle(base);
      let reads = base.reads();
      emit(changed("n0.md"));
      await nextTask();
      emit({ type: "batch_ended", batch: "1", changed: ["n0.md"] });
      await settle(base);
      expect(base.reads() - reads).toBe(2);
      reads = base.reads();
      emit({ type: "overflow", dropped: 3 });
      await settle(base);
      expect(base.reads() - reads).toBe(1);
    } finally { base.close(); }
  });

  it("una risposta vecchia non copre quella nuova", async () => {
    const base = mount();
    try {
      await vi.waitFor(() => expect(cell(base.host)).toBe("Da fare"));
      await settle(base);
      // La prima ricarica resta ferma su `derive` mentre arriva un altro
      // salvataggio, che si ferma lì anche lui; poi rispondono nell'ordine.
      const derives = base.derives();
      const release = base.holdDerive();
      base.save("In corso");
      emit(changed("n0.md"));
      await nextTask();
      emit(INDEX);
      await vi.waitFor(() => expect(base.derives()).toBe(derives + 1));
      base.save("Fatto");
      emit(changed("n0.md"));
      await nextTask();
      emit(INDEX);
      await vi.waitFor(() => expect(base.derives()).toBe(derives + 2));
      release();
      await settle(base);
      expect(cell(base.host)).toBe("Fatto");
      expect(base.derives()).toBe(derives + 2);
    } finally { base.close(); }
  });
});
