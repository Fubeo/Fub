// @vitest-environment happy-dom
//
// Il chip dello stato del documento: dice lo stato che la superficie dà, si
// annuncia una volta, apre il riquadro con le voci e le azioni, e mostra
// «Registra» quando si registra.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurfaceStanding, SurfaceStandingState } from "../editors/core/registry";
import { t } from "../i18n/strings";
import { createStandingChip } from "./standing";

afterEach(() => document.body.replaceChildren());

function source(first: SurfaceStandingState | null) {
  let now = first;
  const listeners = new Set<() => void>();
  const standing: SurfaceStanding = {
    current: () => now,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    standing,
    listeners,
    set(next: SurfaceStandingState | null) {
      now = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

const CLOSED: SurfaceStandingState = {
  kind: "closed",
  text: "2 parti chiuse",
  title: "2 parti restano come sono nel file",
  body: "Fub non le riscriverebbe identiche.",
  source: "Le regole sono del formato.",
  places: [
    { label: "«chiuso», pagina 1", run: vi.fn() },
    { label: "Una tabella, pagina 2", run: vi.fn() },
  ],
  actions: [{ label: "Mostra la prima parte chiusa", run: vi.fn() }],
  recording: false,
};

describe("il chip dello stato", () => {
  it("in sola lettura «Che cosa manca?» apre e richiude l'elenco, e solo le voci con un posto hanno «Vai»", () => {
    const go = vi.fn();
    const readonly: SurfaceStandingState = {
      kind: "readonly",
      text: "Sola lettura",
      title: "Sola lettura, per non rovinare il file",
      body: "Fub lo apre in lettura.",
      places: [{ label: "Una modifica di formato registrata: «due»", run: go }, { label: "Modifiche registrate nelle note" }],
      placesAsk: "Che cosa manca?",
      actions: [{ label: "Cerca", run: vi.fn() }],
      recording: false,
    };
    const chip = createStandingChip();
    document.body.append(chip.element);
    chip.follow(source(readonly).standing);
    chip.element.querySelector<HTMLButtonElement>(".pane-standing-chip")!.click();
    const panel = document.querySelector<HTMLElement>(".pane-standing-panel")!;
    const ask = panel.querySelector<HTMLButtonElement>(".pane-standing-ask")!;
    expect(ask.textContent).toBe("Che cosa manca?");
    expect(ask.getAttribute("aria-expanded")).toBe("false");
    expect(panel.querySelector(".pane-standing-places")).toBeNull();
    // La domanda è il primo posto del fuoco, prima di «Cerca».
    expect(document.activeElement).toBe(ask);
    ask.click();
    const list = panel.querySelector<HTMLElement>(".pane-standing-places")!;
    expect(ask.getAttribute("aria-expanded")).toBe("true");
    expect(ask.getAttribute("aria-controls")).toBe(list.id);
    expect(list.getAttribute("aria-label")).toBe("Che cosa manca?");
    expect(ask.nextElementSibling).toBe(list);
    const items = [...list.querySelectorAll("li")];
    expect(items.map((item) => item.querySelectorAll("button").length)).toEqual([1, 0]);
    ask.click();
    expect(panel.querySelector(".pane-standing-places")).toBeNull();
    expect(ask.getAttribute("aria-expanded")).toBe("false");
    ask.click();
    panel.querySelector<HTMLButtonElement>(".pane-standing-places button")!.click();
    expect(go).toHaveBeenCalledTimes(1);
    chip.destroy();
  });

  it("dice lo stato, si annuncia una volta, e apre il riquadro con le voci", () => {
    const chip = createStandingChip();
    document.body.append(chip.element);
    const from = source(CLOSED);
    chip.follow(from.standing);
    const button = chip.element.querySelector<HTMLButtonElement>(".pane-standing-chip")!;
    const said = chip.element.querySelector<HTMLElement>('[role="status"]')!;
    expect(chip.element.hidden).toBe(false);
    expect(chip.element.dataset.standing).toBe("closed");
    expect(button.textContent).toBe("2 parti chiuse");
    expect(button.getAttribute("aria-label")).toBe(t("document.standing.label", { state: "2 parti chiuse" }));
    expect(said.textContent).toBe(t("document.standing.announce", { state: CLOSED.text, title: CLOSED.title }));
    // Cambiare stato dopo non parla di nuovo.
    from.set({ ...CLOSED, kind: "body", text: "Solo il testo", title: "Si scrivono paragrafi e tabelle", places: [], actions: [] });
    expect(button.textContent).toBe("Solo il testo");
    expect(said.textContent).toBe(t("document.standing.announce", { state: CLOSED.text, title: CLOSED.title }));
    from.set(CLOSED);

    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const panel = document.querySelector<HTMLElement>(".pane-standing-panel")!;
    expect(panel.querySelector(".pane-standing-title")!.textContent).toBe(CLOSED.title);
    expect(panel.querySelector(".pane-standing-body")!.textContent).toBe(CLOSED.body);
    expect(panel.querySelector(".pane-standing-source")!.textContent).toBe(CLOSED.source);
    const items = [...panel.querySelectorAll("li")];
    expect(items.map((item) => item.firstElementChild!.textContent)).toEqual(CLOSED.places!.map((place) => place.label));
    const go = items[1]!.querySelector<HTMLButtonElement>("button")!;
    expect(go.textContent).toBe(t("document.standing.go"));
    expect(go.getAttribute("aria-label")).toBe(t("document.standing.go.label", { place: CLOSED.places![1]!.label }));
    expect(document.activeElement).toBe(items[0]!.querySelector("button"));
    // «Vai» chiude il riquadro e ci porta.
    go.click();
    expect(CLOSED.places![1]!.run).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".pane-standing-panel")).toBeNull();
    // L'azione principale.
    button.click();
    const first = document.querySelector<HTMLElement>(".pane-standing-actions button")!;
    expect(first.textContent).toBe(CLOSED.actions![0]!.label);
    first.click();
    expect(CLOSED.actions![0]!.run).toHaveBeenCalledTimes(1);
    chip.destroy();
    expect(from.listeners.size).toBe(0);
  });

  it("mostra «Registra» quando si registra, e senza stato non c'è", () => {
    const chip = createStandingChip();
    document.body.append(chip.element);
    const from = source(null);
    chip.follow(from.standing);
    expect(chip.element.hidden).toBe(true);
    const recording = chip.element.querySelector<HTMLElement>(".pane-standing-rec")!;
    from.set({ kind: "writes", text: "Si scrive", title: "Si scrive tutto", body: "", recording: false });
    expect(chip.element.hidden).toBe(false);
    expect(recording.hidden).toBe(true);
    from.set({ kind: "writes", text: "Si scrive", title: "Si scrive tutto", body: "", recording: true, recordingHint: "Registra modifiche." });
    expect(recording.hidden).toBe(false);
    expect(recording.textContent).toBe(t("document.standing.recording"));
    // Un altro documento: lo stato di prima se ne va, e il nuovo si annuncia.
    const other = source({ kind: "readonly", text: "Sola lettura", title: "Sola lettura, per non rovinare il file", body: "", recording: false });
    chip.follow(other.standing);
    expect(from.listeners.size).toBe(0);
    expect(chip.element.querySelector('[role="status"]')!.textContent).toBe(
      t("document.standing.announce", { state: "Sola lettura", title: "Sola lettura, per non rovinare il file" }),
    );
    chip.follow(null);
    expect(chip.element.hidden).toBe(true);
    expect(other.listeners.size).toBe(0);
    chip.destroy();
    expect(chip.element.isConnected).toBe(false);
  });
});
