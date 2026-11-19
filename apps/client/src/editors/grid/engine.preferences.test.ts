// @vitest-environment happy-dom
//
// Le due preferenze della griglia (griglia T9) nella griglia montata: le legge
// all'apertura, le rilegge quando cambiano, valgono dal gesto dopo in tutte
// le griglie aperte, e una griglia smontata non ascolta più.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, SettingValue } from "../../host/contract";
import { settings } from "../../host/query";
import { createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../../moto";
import { DURATION } from "../../moto/spring";
import { forwardNotice } from "../../state/kernel";
import { COPY_MARK_KEY, SELECTION_SPEED_KEY } from "./grid-motion";
import { settle, workbookHost, workbookMounted } from "./test-support";

vi.mock("../../host/query", () => ({ settings: vi.fn() }));

const FRAME = 1000 / 60;
let driver: ManualDriver;
/// Le griglie montate: un caso che fallisce a metà non lascia ascoltatori
/// ai casi dopo.
const opened: { destroy(): void }[] = [];

afterEach(() => {
  for (const engine of opened.splice(0)) engine.destroy();
  driver?.advance(5000);
  setMotionDriver(null);
  setMotionPreference("system");
  vi.mocked(settings).mockReset();
  document.body.replaceChildren();
});

function choice(key: string, value: SettingValue, options: readonly string[]): SettingEntry {
  return {
    spec: {
      key, label: key, description: "", group: "Editor", scope: "machine",
      kind: { kind: "choice", default: options[0]!, options: options.map((option) => ({ value: option, label: option })) },
      program_writable: false,
    },
    value,
    source: "machine",
  };
}

/// Le preferenze che l'host risponde da adesso.
function prefer(copy: string, speed: string): void {
  vi.mocked(settings).mockResolvedValue([
    choice(COPY_MARK_KEY, copy, ["dash-pulse", "dash", "pulse"]),
    choice(SELECTION_SPEED_KEY, speed, ["normal", "quick", "soft", "none"]),
  ]);
}

function changed(key: string): void {
  forwardNotice({ event: { type: "setting_changed", key, scope: "machine" }, origin: { actor: { kind: "user" }, batch: null } });
}

async function mountedGrid() {
  driver = createManualDriver();
  setMotionDriver(driver);
  const made = await workbookMounted(workbookHost());
  opened.push(made.engine);
  await settle();
  const copied = new Map<string, string>();
  const send = (type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (kind: string) => copied.get(kind) ?? "", setData: (kind: string, text: string) => { copied.set(kind, text); } },
    });
    made.viewport.dispatchEvent(event);
  };
  const key = (name: string) => made.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  const shown = (selector: string) => made.host.querySelectorAll<HTMLElement>(`${selector}:not([hidden])`).length;
  /// Il lato sinistro della selezione, dove si vede: il suo posto d'arrivo e
  /// lo spostamento che lo porta dove i numeri dicono.
  const leftEdge = () => {
    const edge = made.host.querySelector<HTMLElement>('.grid-marks-body [data-mark="rect-left"]:not([hidden])')!;
    const moved = /translate\((-?[\d.e-]+)px/.exec(edge.style.transform);
    return parseFloat(edge.style.left) + (moved ? Number(moved[1]) : 0);
  };
  return { ...made, send, key, shown, leftEdge };
}

describe("le preferenze della griglia montata (griglia T9)", () => {
  it("di serie, e con un valore che non esiste, la copia ha il tratteggio e il battito", async () => {
    prefer("zigzag", "lentissima");
    const { engine, send, shown, go } = await mountedGrid();
    expect(settings).toHaveBeenCalled();
    go(1, 1);
    send("copy");
    expect(shown(".grid-mark-copy")).toBe(4);
    expect(shown(".grid-mark-flash")).toBeGreaterThan(0);
    engine.destroy();
  });

  it("«Solo il tratteggio»: il tratteggio senza battito", async () => {
    prefer("dash", "normal");
    const { engine, send, shown, go } = await mountedGrid();
    go(1, 1);
    send("copy");
    expect(shown(".grid-mark-copy")).toBe(4);
    expect(shown(".grid-mark-flash")).toBe(0);
    engine.destroy();
  });

  it("«Solo il battito»: il battito, il bordo della selezione resta, e il taglio ha sempre il tratteggio fitto", async () => {
    prefer("pulse", "normal");
    const { engine, send, shown, go } = await mountedGrid();
    go(1, 1);
    send("copy");
    expect(shown(".grid-mark-copy")).toBe(0);
    expect(shown(".grid-mark-flash")).toBeGreaterThan(0);
    expect(shown(".grid-mark-edge")).toBe(4);
    driver.advance(DURATION.swap + FRAME * 2);
    await settle();
    expect(shown(".grid-mark-flash")).toBe(0);
    send("cut");
    expect(shown(".grid-mark-cut")).toBe(4);
    engine.destroy();
  });

  it("A scatti: coi tasti la selezione è subito sulla cella nuova; Come di norma scivola", async () => {
    prefer("dash-pulse", "none");
    const { engine, key, go, leftEdge, host } = await mountedGrid();
    go(1, 1);
    driver.advance(1000);
    const before = leftEdge();
    key("ArrowRight");
    const snapped = leftEdge();
    expect(snapped).toBeGreaterThan(before);
    // Già al suo posto d'arrivo: nessuno spostamento che lo porti altrove.
    expect(host.querySelector<HTMLElement>('.grid-marks-body [data-mark="rect-left"]:not([hidden])')!.style.transform).toBe("");
    driver.advance(FRAME);
    expect(leftEdge()).toBe(snapped);

    prefer("dash-pulse", "normal");
    changed(SELECTION_SPEED_KEY);
    await settle();
    key("ArrowRight");
    const start = leftEdge();
    driver.advance(FRAME);
    const next = leftEdge();
    expect(next).toBeGreaterThan(start);
    driver.advance(1000);
    expect(leftEdge()).toBeGreaterThan(next);
    engine.destroy();
  });

  it("una scelta cambiata a griglia aperta vale dal gesto dopo, senza far saltare il segno che scivola", async () => {
    prefer("dash-pulse", "normal");
    const { engine, key, go, leftEdge, send, shown } = await mountedGrid();
    go(1, 1);
    driver.advance(1000);
    const from = leftEdge();
    key("ArrowRight");
    driver.advance(FRAME * 2);
    const mid = leftEdge();
    expect(mid).toBeGreaterThan(from);

    prefer("dash", "none");
    changed(SELECTION_SPEED_KEY);
    await settle();
    // Il segno resta dov'era e continua la sua corsa.
    expect(leftEdge()).toBe(mid);
    driver.advance(FRAME);
    const later = leftEdge();
    expect(later).toBeGreaterThan(mid);
    driver.advance(1000);
    const arrived = leftEdge();
    expect(arrived).toBeGreaterThan(later);
    // Il gesto dopo: a scatti, e la copia senza battito.
    key("ArrowRight");
    const snapped = leftEdge();
    expect(snapped).toBeGreaterThan(arrived);
    driver.advance(FRAME);
    expect(leftEdge()).toBe(snapped);
    send("copy");
    expect(shown(".grid-mark-copy")).toBe(4);
    expect(shown(".grid-mark-flash")).toBe(0);
    engine.destroy();
  });

  it("due griglie aperte cambiano insieme", async () => {
    prefer("dash-pulse", "normal");
    const first = await mountedGrid();
    const second = await mountedGrid();
    prefer("pulse", "normal");
    changed(COPY_MARK_KEY);
    await settle();
    for (const grid of [first, second]) {
      grid.go(1, 1);
      grid.send("copy");
      expect(grid.shown(".grid-mark-copy")).toBe(0);
      expect(grid.shown(".grid-mark-flash")).toBeGreaterThan(0);
    }
    first.engine.destroy();
    second.engine.destroy();
  });

  it("una risposta vecchia non scrive sopra una più nuova", async () => {
    let answerOld!: (entries: SettingEntry[]) => void;
    prefer("dash-pulse", "normal");
    const { engine, send, shown, go } = await mountedGrid();
    vi.mocked(settings).mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; }));
    changed(COPY_MARK_KEY);
    prefer("dash", "normal");
    changed(COPY_MARK_KEY);
    await settle();
    answerOld([choice(COPY_MARK_KEY, "pulse", ["dash-pulse", "dash", "pulse"])]);
    await settle();
    go(1, 1);
    send("copy");
    expect(shown(".grid-mark-copy")).toBe(4);
    expect(shown(".grid-mark-flash")).toBe(0);
    engine.destroy();
  });

  it("una griglia smontata prima che arrivino le impostazioni non ascolta più", async () => {
    let answer!: (entries: SettingEntry[]) => void;
    vi.mocked(settings).mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    driver = createManualDriver();
    setMotionDriver(driver);
    const { engine } = await workbookMounted(workbookHost());
    engine.destroy();
    const calls = vi.mocked(settings).mock.calls.length;
    answer([choice(COPY_MARK_KEY, "pulse", ["dash-pulse", "dash", "pulse"])]);
    await settle();
    changed(COPY_MARK_KEY);
    changed(SELECTION_SPEED_KEY);
    await settle();
    expect(vi.mocked(settings).mock.calls.length).toBe(calls);
  });

  it("senza un vault (la lettura fallisce) restano le scelte di serie", async () => {
    vi.mocked(settings).mockRejectedValue(new Error("nessun vault"));
    const { engine, send, shown, go } = await mountedGrid();
    go(1, 1);
    send("copy");
    expect(shown(".grid-mark-copy")).toBe(4);
    expect(shown(".grid-mark-flash")).toBeGreaterThan(0);
    engine.destroy();
  });
});
