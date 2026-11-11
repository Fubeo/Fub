// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeMotions } from "../moto/animate";
import { createManualDriver, setMotionDriver, type ManualDriver, type RecordedPlay } from "../moto/driver";
import { curveOf } from "../moto/easing";
import { setMotionPreference } from "../moto/level";
import { DURATION } from "../moto/spring";
import { beginTreeMotion, CLOSE_EASING } from "./explorer-motion";

const ROW_PX = 28;
let driver: ManualDriver;
let list: HTMLElement;

/// Il layout finto: ogni riga dell'albero vero è alta `ROW_PX`, una sotto
/// l'altra; un gruppo va dalla sua prima riga all'ultima; un'immagine `fixed`
/// sta dove dicono i suoi stili in linea.
function measured(this: Element): DOMRect {
  const style = (this as HTMLElement).style;
  if (style?.position === "fixed") {
    return new DOMRect(parseFloat(style.left), parseFloat(style.top), parseFloat(style.width), parseFloat(style.height));
  }
  const live = [...list.querySelectorAll(".tree-row")].filter((row) => !row.closest("[inert]"));
  const index = live.indexOf(this);
  if (index >= 0) return new DOMRect(0, index * ROW_PX, 240, ROW_PX);
  if (this.matches('li[role="treeitem"]')) {
    const row = this.querySelector(":scope > .tree-row");
    return row ? measured.call(row) : new DOMRect();
  }
  if (this.matches(".tree-children")) {
    const inside = live.filter((row) => this.contains(row));
    if (inside.length === 0) return new DOMRect();
    return new DOMRect(0, live.indexOf(inside[0]!) * ROW_PX, 240, inside.length * ROW_PX);
  }
  return new DOMRect();
}

/// Una voce dell'albero, come la disegna `renderChildren`.
function item(path: string): HTMLLIElement {
  const li = document.createElement("li");
  li.setAttribute("role", "treeitem");
  li.dataset.path = path;
  const row = document.createElement("div");
  row.className = "tree-row";
  row.dataset.path = path;
  row.draggable = true;
  li.append(row);
  return li;
}

/// Apre o chiude `docs` toccando solo il suo sottoalbero, come `patchFolder`.
function patch(open: boolean): void {
  const folder = list.querySelector<HTMLElement>('[data-path="docs"]')!;
  folder.setAttribute("aria-expanded", String(open));
  if (!open) {
    folder.querySelector(":scope > .tree-children:not([inert])")?.remove();
    return;
  }
  const nested = document.createElement("ul");
  nested.className = "tree-children";
  nested.setAttribute("role", "group");
  nested.append(item("docs/a.md"), item("docs/b.md"));
  folder.querySelector(":scope > .tree-row")!.after(nested);
}

/// Disegna l'albero come `renderChildren`: `docs` aperta mostra `inside` note
/// (di serie due), e sotto di lei stanno le voci di `tail`.
function render(open: boolean, inside = 2, tail = ["zeta.md"]): void {
  const folder = item("docs");
  folder.setAttribute("aria-expanded", String(open));
  if (open) {
    const nested = document.createElement("ul");
    nested.className = "tree-children";
    nested.setAttribute("role", "group");
    const names = inside === 2 ? ["a", "b"] : Array.from({ length: inside }, (_, index) => `n${index}`);
    nested.append(...names.map((name) => item(`docs/${name}.md`)));
    folder.append(nested);
  }
  list.replaceChildren(item("alfa.md"), folder, ...tail.map(item));
}

const entries = (): string[] =>
  [...list.querySelectorAll<HTMLElement>('li[role="treeitem"]')].map((li) => li.dataset.path!);

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  list = document.createElement("ul");
  document.body.append(list);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(measured);
});

/// La finestra alta `rows` righe: la parte dell'albero che si vede.
function viewport(rows: number): void {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(rows * ROW_PX);
}

/// Le corse partite sulla riga di `path`.
const playsOf = (path: string): RecordedPlay[] =>
  driver.plays.filter((play) => (play.el.parentElement as HTMLElement | null)?.dataset.path === path);

afterEach(() => {
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("il moto dell'albero", () => {
  it("aprendo, i figli entrano sfalsati e la riga sotto scivola dal suo posto", () => {
    render(false);
    const motion = beginTreeMotion(list, "docs");
    render(true);
    const motions = motion.settle();

    expect(motions.some((m) => m.running)).toBe(true);
    const row = (path: string): Element => list.querySelector(`[data-path="${path}"] > .tree-row`)!;
    const played = (path: string): RecordedPlay[] => driver.plays.filter((play) => play.el === row(path));
    // La riga sotto parte dal suo posto vecchio, due righe più in alto.
    expect(String(played("zeta.md")[0]?.keyframes[0]?.transform)).toContain(`${-2 * ROW_PX}px`);
    // Le righe sopra e la cartella non si muovono.
    expect(played("alfa.md")).toHaveLength(0);
    expect(played("docs")).toHaveLength(0);
    driver.advance(5000);
    expect(played("docs/a.md")).toHaveLength(1);
    expect(played("docs/b.md")).toHaveLength(1);
    expect(String(played("docs/b.md")[0]?.keyframes[0]?.opacity)).toBe("0");
    expect(entries()).toEqual(["alfa.md", "docs", "docs/a.md", "docs/b.md", "zeta.md"]);
  });

  it("chiudendo, i figli escono come immagine dentro la cartella e poi non resta niente", () => {
    render(true);
    const motion = beginTreeMotion(list, "docs");
    render(false);
    motion.settle();

    const ghost = list.querySelector<HTMLElement>('[data-path="docs"] > .tree-children[inert]');
    expect(ghost).not.toBeNull();
    // L'immagine non è dell'albero: non si conta, non si trascina.
    expect(ghost!.querySelector("[role], [data-path], [draggable]")).toBeNull();
    expect(entries()).toEqual(["alfa.md", "docs", "zeta.md"]);
    driver.advance(5000);
    expect(list.querySelector("[inert]")).toBeNull();
  });

  it("aprire e chiudere di seguito non lascia nodi orfani", () => {
    render(false);
    for (let round = 0; round < 3; round++) {
      const opening = beginTreeMotion(list, "docs");
      render(true);
      opening.settle();
      const closing = beginTreeMotion(list, "docs");
      render(false);
      closing.settle();
    }
    driver.advance(5000);
    expect(list.querySelector("[inert]")).toBeNull();
    expect(entries()).toEqual(["alfa.md", "docs", "zeta.md"]);
  });

  it("nel moto ridotto non si muove niente", () => {
    setMotionPreference("reduced");
    render(true);
    const closing = beginTreeMotion(list, "docs");
    render(false);
    closing.settle();
    const opening = beginTreeMotion(list, "docs");
    render(true);
    opening.settle();

    expect(activeMotions()).toBe(0);
    expect(list.querySelector("[inert]")).toBeNull();
    expect(list.querySelector('[style*="transform"], [style*="opacity"]')).toBeNull();
  });

  it("dopo un riordino le righe scivolano al loro posto nuovo, e non entra niente", () => {
    render(false);
    const motion = beginTreeMotion(list, null);
    // Il riordino: `zeta.md` passa in cima.
    list.prepend(list.lastElementChild!);
    motion.settle();

    const moved = new Set(driver.plays.map((play) => (play.el.parentElement as HTMLElement).dataset.path));
    expect(moved).toEqual(new Set(["zeta.md", "alfa.md", "docs"]));
    expect(driver.plays.every((play) => play.keyframes[0]?.opacity === undefined)).toBe(true);
    expect(list.querySelector("[inert]")).toBeNull();
  });

  it("aprendo una cartella lunga entrano solo le righe che si vedono", () => {
    viewport(10);
    render(false, 60);
    const motion = beginTreeMotion(list, "docs");
    render(true, 60);
    motion.settle();
    driver.advance(5000);

    // `alfa.md` e `docs` occupano le prime due righe: dentro se ne vedono otto.
    const entered = entries().filter((path) => path.startsWith("docs/") && playsOf(path).length > 0);
    expect(entered).toEqual(Array.from({ length: 8 }, (_, index) => `docs/n${index}.md`));
    // La riga sotto si vedeva: scivola via.
    expect(playsOf("zeta.md")).toHaveLength(1);
  });

  it("chiudendo, la riga sotto parte da ferma e appena oltre il bordo, non da dove stava", () => {
    viewport(10);
    render(true, 60, ["zeta.md", "omega.md"]);
    const motion = beginTreeMotion(list, "docs");
    render(false, 60, ["zeta.md", "omega.md"]);
    motion.settle();

    const [play] = playsOf("zeta.md");
    expect(play).toBeDefined();
    // Stava a 62 righe, sotto la finestra; arriva alla terza. Parte dal bordo
    // di sotto: otto righe più giù, non sessanta.
    expect(String(play!.keyframes[0]?.transform)).toContain(`${8 * ROW_PX}px`);
    // Chi la segue fa lo stesso passo: restano in fila, non ammucchiate sul bordo.
    expect(playsOf("omega.md")[0]?.keyframes[0]?.transform).toBe(play!.keyframes[0]?.transform);
    // Breve come un'uscita, e senza salto: nel primo fotogramma fa meno del
    // 5 % della corsa (con `ease-out` ne faceva il 19 %).
    expect(play!.timing.duration).toBe(DURATION.swap);
    expect(play!.timing.easing).toBe(curveOf(CLOSE_EASING).css);
    expect(curveOf(play!.timing.easing).at(1000 / 60 / play!.timing.duration)).toBeLessThan(0.05);
    // L'immagine di chi esce arriva al bordo: otto voci, non sessanta.
    const ghost = list.querySelector('[data-path="docs"] > .tree-children[inert]');
    expect(ghost?.children).toHaveLength(8);
  });

  it("una riga ancora in volo riparte sullo stesso nodo, e la corsa vecchia si ferma", () => {
    render(true);
    const zeta = () => list.querySelector('[data-path="zeta.md"] > .tree-row');
    const row = zeta();
    const closing = beginTreeMotion(list, "docs");
    patch(false);
    closing.settle();
    driver.advance(2000 / 60);

    const opening = beginTreeMotion(list, "docs");
    patch(true);
    opening.settle();
    expect(zeta()).toBe(row);
    expect(playsOf("zeta.md").map((play) => play.state)).toEqual(["canceled", "running"]);
    expect(entries()).toEqual(["alfa.md", "docs", "docs/a.md", "docs/b.md", "zeta.md"]);
  });

  it("si compie una volta sola", () => {
    render(false);
    const motion = beginTreeMotion(list, "docs");
    render(true);
    expect(motion.settle().length).toBeGreaterThan(0);
    expect(motion.settle()).toEqual([]);
  });
});
