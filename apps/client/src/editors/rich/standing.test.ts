// @vitest-environment happy-dom
//
// Lo stato del documento che il chip dice (B1): una voce per ogni ragione di
// sola lettura, per le parti chiuse, per il solo testo e per il documento che
// si scrive tutto. Le parole, il riquadro e le azioni.
import { afterEach, describe, expect, it, vi } from "vitest";
import closedFixture from "../../__fixtures__/rich-closed.json";
import type { SurfaceStandingState } from "../core/registry";
import { t } from "../../i18n/strings";
import { RichEngine } from "./engine";
import type { ReadOnlyReason } from "./projection";
import { richStanding } from "./standing";
import * as engineModule from "./engine";
import { mountRichSurface, RICH_PROFILE } from "./surface";

const CLOSED = closedFixture.source;
const SOURCE = JSON.stringify({
  format: "fub-rich",
  version: 1,
  blocks: [{ t: "para", role: { kind: "body" }, k: "P", c: [{ t: "text", x: "ciao", k: "R" }] }],
});

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

function standing(source: string, review = true) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  engines.push(engine);
  engine.setDoc(source);
  const find = vi.fn();
  const now = richStanding(engine, { format: "docx", review, find });
  return { engine, find, now: () => now() as SurfaceStandingState };
}

const REASONS: readonly ReadOnlyReason[] = ["revisions", "track_changes", "protected", "projection", "codec", "import"];

describe("lo stato del documento", () => {
  for (const reason of REASONS) {
    it(`in sola lettura per «${reason}» dice perché e offre di cercare`, () => {
      const { now, find } = standing(JSON.stringify({ ...JSON.parse(SOURCE), readonly: reason }));
      const state = now();
      expect(state.kind).toBe("readonly");
      expect(state.text).toBe(t("rich.standing.readonly"));
      expect(state.title).toBe(t("rich.standing.readonly.title"));
      expect(state.body).toBe(t("rich.standing.readonly.body"));
      expect(state.source).toBe(t("rich.standing.reason", { reason: t(`rich.readonly.${reason}`) }));
      expect(state.actions!.map((action) => action.label)).toEqual([t("rich.standing.find")]);
      state.actions![0]!.run();
      expect(find).toHaveBeenCalledTimes(1);
    });
  }

  it("con parti chiuse le conta, le elenca, e il «Vai» ci porta senza scrivere", () => {
    const { now, engine } = standing(CLOSED);
    const state = now();
    expect(state.kind).toBe("closed");
    expect(state.text).toBe(t("rich.standing.closed", { count: 2 }));
    expect(state.title).toBe(t("rich.standing.closed.title", { count: 2 }));
    expect(state.body).toBe(t("rich.standing.closed.body"));
    expect(state.source).toBe(t("rich.standing.closed.source"));
    // Con la carta, ciascuna dice anche in che pagina sta.
    const page = (place: string) => t("rich.standing.place.page", { place, page: 1 });
    expect(state.places!.map((place) => place.label)).toEqual([
      page(t("rich.standing.place.para", { excerpt: engine.state.doc.child(1).textContent })),
      page(t("rich.standing.place.table")),
    ]);
    expect(state.actions!.map((action) => action.label)).toEqual([t("rich.standing.closed.first")]);
    const before = engine.getDoc();
    state.places![1]!.run();
    const table = engine.state.doc.child(2);
    expect(engine.state.selection.from).toBeGreaterThan(engine.state.doc.child(0).nodeSize + engine.state.doc.child(1).nodeSize);
    expect(engine.state.selection.from).toBeLessThan(engine.state.doc.child(0).nodeSize + engine.state.doc.child(1).nodeSize + table.nodeSize);
    state.actions![0]!.run();
    expect(engine.state.selection.from).toBe(engine.state.doc.child(0).nodeSize + 1);
    expect(engine.getDoc()).toBe(before);
  });

  it("con un solo blocco chiuso parla al singolare", () => {
    const one = JSON.parse(CLOSED);
    one.blocks = one.blocks.filter((block: { t: string }) => block.t !== "table");
    const state = standing(JSON.stringify(one)).now();
    expect(state.text).toBe(t("rich.standing.closed.one", { count: 1 }));
    expect(state.title).toBe(t("rich.standing.closed.title.one", { count: 1 }));
  });

  it("dove si scrive soltanto il corpo dice che pagina, intestazioni, commenti e note restano", () => {
    const state = standing(CLOSED.replaceAll(`"locked":true,`, "")).now();
    expect(state.kind).toBe("body");
    expect(state.text).toBe(t("rich.standing.body"));
    expect(state.title).toBe(t("rich.standing.body.title"));
    expect(state.body).toBe(t("rich.standing.body.body"));
    expect(state.source).toBe(t("rich.standing.body.source", { format: t("rich.prop.format.docx") }));
    expect(state.actions ?? []).toEqual([]);
  });

  it("dove si scrive tutto offre di registrare, e registrando lo dice", () => {
    const { now, engine } = standing(SOURCE);
    const state = now();
    expect(state.kind).toBe("writes");
    expect(state.text).toBe(t("rich.standing.writes"));
    expect(state.title).toBe(t("rich.standing.writes.title"));
    expect(state.body).toBe(t("rich.standing.writes.body"));
    expect(state.source).toBe(t("rich.standing.writes.source", { format: t("rich.prop.format.docx") }));
    expect(state.recording).toBe(false);
    expect(state.actions!.map((action) => action.label)).toEqual([t("rich.standing.track")]);
    state.actions![0]!.run();
    expect(engine.tracking()).toBe(true);
    const after = now();
    expect(after.recording).toBe(true);
    expect(after.recordingHint).toBe(t("rich.track.notice"));
    expect(after.actions!.map((action) => action.label)).toEqual([t("rich.standing.track.stop")]);
    // Un formato che non registra non lo offre.
    expect(standing(SOURCE, false).now().actions).toEqual([]);
  });

  it("la superficie lo dà al posto della riga di avviso, e lo dice quando cambia", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const surface = mountRichSurface(
      RICH_PROFILE,
      { paneId: "pane", documentId: "lettera.docx", parent, formatId: "docx" },
      { onChange: () => {}, onSelectionChange: () => {}, loadEngine: () => Promise.resolve(engineModule) },
    );
    expect(surface.standing!.current()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const heard = vi.fn();
    const stop = surface.standing!.subscribe(heard);
    surface.buffer!.setDoc(CLOSED);
    expect(heard).toHaveBeenCalled();
    expect(surface.standing!.current()!.kind).toBe("closed");
    const notice = parent.querySelector<HTMLElement>(".rich-notice")!;
    expect(notice.hidden).toBe(true);
    surface.buffer!.setDoc(JSON.stringify({ ...JSON.parse(SOURCE), readonly: "codec" }));
    expect(surface.standing!.current()!.kind).toBe("readonly");
    expect(notice.hidden).toBe(true);
    // Un documento che non si legge non ha uno stato: lo dice la riga.
    surface.buffer!.setDoc("{");
    expect(surface.standing!.current()).toBeNull();
    expect(notice.textContent).toBe(t("rich.invalid"));
    stop();
    surface.destroy();
    expect(surface.standing!.current()).toBeNull();
  });
});
