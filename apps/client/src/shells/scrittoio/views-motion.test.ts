// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Come nel banco del riconciliatore: il centro notifiche si finge, e `ui/node`
// resta fuori dalla catena `state/kernel` → `host/ipc`.
vi.mock("../../ui/notify", () => ({ notify: vi.fn() }));
import type { UiNode } from "../../host/contract";
import {
  activeMotions,
  createManualDriver,
  liveState,
  setMotionDriver,
  setMotionPreference,
  type ManualDriver,
  type RecordedPlay,
} from "../../moto";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { mountTree, patchTree } from "../../ui/node";
import { CHANGED_MAX, MEASURED_MAX, mountViewsMotion } from "./views-motion";

let driver: ManualDriver;
let lifetime: Lifetime;

// Il layout finto, ma vivo: happy-dom non impagina, e qui le misure si prendono
// in due momenti diversi dello stesso giro. Una riga sta dove la mette il suo
// posto fra i fratelli **nell'istante della misura**; un contenitore sta dove
// lo si posa; un'immagine `fixed` sta dove dicono i suoi stili in linea.
const ROW = 30;
const WIDTH = 300;
const placed = new WeakMap<Element, () => DOMRect>();

function place(el: Element, left: number, top: number | (() => number), width: number, height: number): void {
  placed.set(el, () => new DOMRect(left, typeof top === "function" ? top() : top, width, height));
}

/// I figli di `container` sono righe alte `ROW`, in colonna da `top`.
const columns = new WeakMap<Element, () => number>();
function column(container: Element, top: number | (() => number) = 0): void {
  columns.set(container, typeof top === "function" ? top : () => top);
}

function atRest(el: Element): DOMRect {
  const own = placed.get(el);
  if (own) return own();
  const style = (el as HTMLElement).style;
  if (style?.position === "fixed") {
    return new DOMRect(parseFloat(style.left), parseFloat(style.top), parseFloat(style.width), parseFloat(style.height));
  }
  const parent = el.parentElement;
  const top = parent ? columns.get(parent) : undefined;
  if (!parent || !top) return new DOMRect();
  return new DOMRect(0, top() + [...parent.children].indexOf(el) * ROW, WIDTH, ROW);
}

/// Come nel browser, una corsa in volo sposta il riquadro dell'elemento e di
/// tutto ciò che contiene: chi misura dopo averne avviata una la ritrova nella
/// misura.
function measured(this: Element): DOMRect {
  const rest = atRest(this);
  let x = 0;
  let y = 0;
  for (let at: Element | null = this; at; at = at.parentElement) {
    const pose = liveState(at)?.pose;
    x += pose?.x ?? 0;
    y += pose?.y ?? 0;
  }
  return x || y ? new DOMRect(rest.x + x, rest.y + y, rest.width, rest.height) : rest;
}

const voice = (key: string | undefined, selected = false, title = key ?? "voce"): UiNode =>
  ({ node: "list_item", title, subtitle: null, action: null, selected, ...(key ? { key } : {}) }) as UiNode;
const list = (items: UiNode[], key?: string): UiNode => ({ node: "list", items, ...(key ? { key } : {}) }) as UiNode;
const keyed = (...keys: string[]): UiNode => list(keys.map((key) => voice(key)));
const pile = (children: UiNode[]): UiNode => ({ node: "stack", dir: "column", gap: 0, children }) as UiNode;
const branch = (key: string, selected = false, children: UiNode[] = []): UiNode =>
  ({ node: "tree_item", label: key, expanded: true, selected, action: null, children, key }) as UiNode;

/// Una vista montata: il contenitore ha la classe che la shell gli dà, e il
/// suo elenco è una colonna di righe.
function view(tree: UiNode, className = "declared-view"): HTMLElement {
  const host = document.createElement("div");
  host.className = className;
  document.body.append(host);
  place(host, 0, 0, WIDTH, 600);
  draw(host, tree);
  return host;
}

function draw(host: HTMLElement, tree: UiNode): void {
  mountTree(host, tree, async () => {});
  for (const container of host.querySelectorAll(".ui-list, .ui-tree")) {
    if (!columns.has(container)) column(container);
  }
}

/// Il microtask della passata: dopo, le corse sono partite.
const settled = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const row = (host: Element, key: string): HTMLElement => host.querySelector<HTMLElement>(`.ui-list [data-key="${key}"]`)!;
const ghosts = (host: Element): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(":scope > [inert]")];
const running = (): RecordedPlay[] => driver.plays.filter((play) => play.state === "running");
const playOn = (el: Element, pseudo?: string): RecordedPlay | undefined =>
  running().find((play) => play.el === el && play.timing.pseudo === pseudo);

/// La traslazione di un fotogramma chiave, in px.
function shift(frame: Keyframe | undefined): [number, number] {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(frame?.transform ?? ""));
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(measured);
  lifetime = openLifetime();
  mountViewsMotion(lifetime);
});

afterEach(async () => {
  await settled();
  driver.advance(5000);
  // Finita ogni corsa non resta niente: né un movimento, né un'immagine.
  expect(activeMotions()).toBe(0);
  expect(document.querySelector("[inert]")).toBeNull();
  lifetime.close();
  setMotionDriver(null);
  setMotionPreference("system");
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("chi resta", () => {
  it("al primo disegno non si muove niente", async () => {
    view(keyed("a", "b", "c"));
    await settled();
    expect(driver.plays).toHaveLength(0);
  });

  it("un ridisegno che non sposta niente non avvia corse", async () => {
    const host = view(keyed("a", "b", "c"));
    draw(host, keyed("a", "b", "c"));
    await settled();
    expect(driver.plays).toHaveLength(0);
  });

  it("chi cambia posto scivola da dov'era, ed è l'elemento nuovo a farlo", async () => {
    const host = view(keyed("a", "b", "c"));
    const old = row(host, "c");
    draw(host, keyed("c", "a", "b"));
    // Lo stato è già quello finale, prima di ogni corsa.
    expect([...host.querySelectorAll(".ui-list-item")].map((el) => (el as HTMLElement).dataset.key)).toEqual(["c", "a", "b"]);
    expect(driver.plays).toHaveLength(0);
    await settled();

    // Una voce è una foglia: il riconciliatore l'ha ricostruita.
    expect(row(host, "c")).not.toBe(old);
    expect(shift(playOn(row(host, "c"))?.keyframes[0])).toEqual([0, 2 * ROW]);
    expect(shift(playOn(row(host, "a"))?.keyframes[0])).toEqual([0, -ROW]);
    expect(shift(playOn(row(host, "b"))?.keyframes[0])).toEqual([0, -ROW]);
    // Solo `transform` e `opacity`, e l'arrivo è il riposo.
    for (const play of driver.plays) {
      for (const frame of play.keyframes) {
        expect(Object.keys(frame).every((name) => name === "transform" || name === "opacity")).toBe(true);
      }
      expect(shift(play.keyframes[play.keyframes.length - 1])).toEqual([0, 0]);
    }
  });

  it("alla fine il DOM è quello di una vista senza movimento", async () => {
    const moving = view(keyed("a", "b", "c"));
    draw(moving, keyed("c", "x", "a"));
    await settled();
    expect(running().length).toBeGreaterThan(0);
    driver.advance(5000);

    lifetime.close();
    const plain = view(keyed("a", "b", "c"));
    draw(plain, keyed("c", "x", "a"));
    await settled();
    expect(moving.innerHTML).toBe(plain.innerHTML);
  });

  it("un contenitore che scende porta con sé le sue righe: non si muovono due volte", async () => {
    const tree = (first: string[], second: string[]): UiNode =>
      pile([list(first.map((key) => voice(key)), "sopra"), list(second.map((key) => voice(key)), "sotto")]);
    const host = view(tree(["a", "b"], ["p", "q"]));
    const [above, below] = [...host.querySelectorAll(".ui-list")];
    place(above, 0, 0, WIDTH, 0);
    place(below, 0, () => above.children.length * ROW, WIDTH, 2 * ROW);
    column(below, () => above.children.length * ROW);

    draw(host, tree(["a"], ["p", "q"]));
    await settled();
    // L'elenco di sotto sale di una riga; le sue voci stanno ferme dentro di lui.
    expect(shift(playOn(below)?.keyframes[0])).toEqual([0, ROW]);
    expect(playOn(row(below, "p"))).toBeUndefined();
    expect(playOn(row(below, "q"))).toBeUndefined();
  });
});

describe("chi entra e chi esce", () => {
  it("chi entra compare scendendo, una voce dopo l'altra", async () => {
    const host = view(keyed("a", "b"));
    draw(host, keyed("a", "x", "y", "b"));
    await settled();

    const first = playOn(row(host, "x"))!;
    const second = playOn(row(host, "y"))!;
    expect(first.keyframes[0].opacity).toBe(0);
    expect(shift(first.keyframes[0])).toEqual([0, -6]);
    expect(first.keyframes[first.keyframes.length - 1].opacity).toBe(1);
    expect(first.timing.delay).toBe(0);
    expect(second.timing.delay).toBeGreaterThan(0);
    // Chi stava sotto scende di due righe, dal posto che aveva.
    expect(shift(playOn(row(host, "b"))?.keyframes[0])).toEqual([0, -2 * ROW]);
    expect(playOn(row(host, "a"))).toBeUndefined();
  });

  it("chi esce lascia un'immagine ferma dov'era, che sbiadisce e se ne va", async () => {
    const host = view(keyed("a", "b", "c"));
    draw(host, keyed("a", "c"));
    // Lo stato è cambiato subito: la voce non c'è più, l'immagine non ancora.
    expect(host.querySelector('.ui-list [data-key="b"]')).toBeNull();
    expect(ghosts(host)).toHaveLength(0);
    await settled();

    const [ghost] = ghosts(host);
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.textContent).toBe("b");
    expect(ghost.style.position).toBe("fixed");
    expect([ghost.style.left, ghost.style.top, ghost.style.width, ghost.style.height]).toEqual(["0px", "30px", "300px", "30px"]);
    // Sta nella vista ma fuori dall'albero montato: una patch non la trova.
    expect(ghost.parentElement).toBe(host);
    expect(patchTree(host, "b", voice("b"))).toBe(false);
    const play = playOn(ghost)!;
    expect(play.keyframes[play.keyframes.length - 1].opacity).toBe(0);
    expect(play.timing.duration).toBe(140);
    expect(shift(playOn(row(host, "c"))?.keyframes[0])).toEqual([0, ROW]);

    driver.advance(200);
    expect(ghosts(host)).toHaveLength(0);
  });

  it("senza chiave non entra e non esce niente con un movimento", async () => {
    const host = view(list([voice(undefined), voice(undefined), voice(undefined)]));
    draw(host, list([voice(undefined), voice(undefined)]));
    await settled();
    draw(host, list([voice(undefined), voice(undefined), voice(undefined)]));
    await settled();
    expect(driver.plays).toHaveLength(0);
    expect(ghosts(host)).toHaveLength(0);
  });

  it("dove cambia più di quanto resta è un altro elenco: niente entrate né uscite", async () => {
    const host = view(keyed("a", "b", "c"));
    draw(host, keyed("a", "x", "y"));
    await settled();
    expect(ghosts(host)).toHaveLength(0);
    expect(driver.plays).toHaveLength(0);
  });

  it("una voce che rientra mentre la sua immagine esce ne prende il posto", async () => {
    const host = view(keyed("a", "b", "c"));
    draw(host, keyed("a", "c"));
    await settled();
    const [ghost] = ghosts(host);
    driver.advance(70);
    const faded = liveState(ghost)!.pose.opacity!;
    expect(faded).toBeGreaterThan(0);
    expect(faded).toBeLessThan(1);

    draw(host, keyed("a", "b", "c"));
    await settled();
    expect(ghosts(host)).toHaveLength(0);
    expect(playOn(row(host, "b"))!.keyframes[0].opacity).toBeCloseTo(faded, 2);
  });
});

describe("quando non si muove", () => {
  it("se la passata tocca troppe voci lo stato cambia e basta", async () => {
    const few = Array.from({ length: CHANGED_MAX }, (_, i) => `n${i}`);
    const host = view(keyed("a", "b"));
    draw(host, keyed("a", ...few, "x", "b"));
    await settled();
    expect(driver.plays).toHaveLength(0);

    // Appena sotto la soglia, invece, si muove.
    const other = view(keyed("a", "b"));
    draw(other, keyed("a", ...few, "b"));
    await settled();
    expect(running().length).toBe(CHANGED_MAX + 1);
  });

  it("se la vista ha troppe voci da misurare non ne misura nessuna", async () => {
    const many = Array.from({ length: MEASURED_MAX + 1 }, (_, i) => `n${i}`);
    const host = view(keyed(...many));
    const measures = vi.mocked(Element.prototype.getBoundingClientRect);
    measures.mockClear();
    draw(host, keyed(...many.slice(1), many[0]));
    await settled();
    expect(driver.plays).toHaveLength(0);
    // La vista stessa, per sapere se si vede; nessuna riga.
    expect(measures.mock.contexts.filter((el) => (el as Element).classList.contains("ui-list-item"))).toHaveLength(0);
  });

  it("se la vista non si vede non misura e non muove", async () => {
    const host = view(keyed("a", "b", "c"));
    place(host, 0, 0, 0, 0);
    const measures = vi.mocked(Element.prototype.getBoundingClientRect);
    measures.mockClear();
    draw(host, keyed("c", "a"));
    await settled();
    expect(driver.plays).toHaveLength(0);
    expect(ghosts(host)).toHaveLength(0);
    expect(measures.mock.contexts).toEqual([host]);
  });

  it("ciò che il pannello taglia non si muove e non lascia immagini", async () => {
    const panel = document.createElement("div");
    // Come il pannello vero, che scorre in verticale (happy-dom non scompone
    // la scorciatoia `overflow` nei due assi).
    panel.style.overflowY = "auto";
    document.body.append(panel);
    place(panel, 0, 0, WIDTH, 2 * ROW);
    const host = view(keyed("a", "b", "c", "d", "e", "f"));
    panel.append(host);

    // `e` esce ed `f` sale: tutti e due sotto il taglio.
    draw(host, keyed("a", "b", "c", "d", "f"));
    await settled();
    expect(ghosts(host)).toHaveLength(0);
    expect(driver.plays).toHaveLength(0);

    // `a` esce dentro il taglio: l'immagine c'è. Si muove chi si vede prima o
    // dopo — `b` che sale, `c` che entra in vista —, e `d` resta sotto.
    draw(host, keyed("b", "c", "d", "f"));
    await settled();
    expect(ghosts(host)).toHaveLength(1);
    expect(running().map((play) => (play.el as HTMLElement).dataset.key).sort()).toEqual(["a", "b", "c"]);
  });

  it("negli incastri del documento, che non sono viste, non tocca niente", async () => {
    const host = view(keyed("a", "b", "c"), "cm-incastro");
    draw(host, keyed("c", "a"));
    await settled();
    expect(driver.plays).toHaveLength(0);
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("le righe di una tabella non sono un flusso", async () => {
    const table = (rows: string[]): UiNode =>
      ({
        node: "table",
        columns: [{ title: "Nome", align: "start" }],
        rows: rows.map((key) => ({ node: "row", cells: [{ node: "text", content: key }], action: null, key })),
      }) as UiNode;
    const host = view(table(["a", "b", "c"]));
    draw(host, table(["c", "a"]));
    await settled();
    expect(driver.plays).toHaveLength(0);
    expect(document.querySelector("[inert]")).toBeNull();
  });
});

describe("i livelli", () => {
  const lowest = (play: RecordedPlay): number => Math.min(...play.keyframes.map((frame) => shift(frame)[1]));

  it("di sistema la molla morbida passa appena il segno; calmo no, e arriva lo stesso", async () => {
    const full = view(keyed("a", "b", "c"));
    draw(full, keyed("c", "a", "b"));
    await settled();
    expect(lowest(playOn(row(full, "c"))!)).toBeLessThan(0);
    driver.advance(5000);

    setMotionPreference("calm");
    const calm = view(keyed("a", "b", "c"));
    draw(calm, keyed("c", "a", "b"));
    await settled();
    const play = playOn(row(calm, "c"))!;
    expect(shift(play.keyframes[0])).toEqual([0, 2 * ROW]);
    expect(lowest(play)).toBe(0);
  });

  it("ridotto: niente scivola e niente esce; chi entra compare in dissolvenza", async () => {
    setMotionPreference("reduced");
    const host = view(keyed("a", "b", "c"));
    const measures = vi.mocked(Element.prototype.getBoundingClientRect);
    draw(host, keyed("c", "a", "x"));
    await settled();

    expect(ghosts(host)).toHaveLength(0);
    expect(running().map((play) => (play.el as HTMLElement).dataset.key)).toEqual(["x"]);
    const [play] = running();
    expect(play.keyframes.every((frame) => frame.transform === undefined)).toBe(true);
    expect(play.keyframes[0].opacity).toBe(0);
    expect(play.timing.duration).toBe(90);
    expect(play.timing.delay).toBe(0);
    // Niente FLIP, niente misure «prima»: delle voci vecchie non ne ha letta una.
    expect(measures.mock.contexts.filter((el) => !(el as Element).isConnected)).toHaveLength(0);
  });
});

describe("una passata dopo l'altra", () => {
  it("una patch a metà corsa riparte da dove la voce si vede, con la sua velocità", async () => {
    const host = view(keyed("a", "b", "c"));
    draw(host, keyed("c", "a", "b"));
    await settled();
    const first = playOn(row(host, "c"))!;
    driver.advance(50);
    const live = liveState(row(host, "c"))!;
    expect(live.pose.y).toBeGreaterThan(0);
    expect(live.pose.y).toBeLessThan(2 * ROW);

    // Torna in fondo: a riposo starebbe due righe più giù di dove sta ora.
    draw(host, keyed("a", "b", "c"));
    await settled();
    expect(first.state).toBe("canceled");
    const second = playOn(row(host, "c"))!;
    expect(shift(second.keyframes[0])[1]).toBeCloseTo(live.pose.y! - 2 * ROW, 1);
    // La velocità è quella che aveva: il secondo campione prosegue verso l'alto.
    expect(shift(second.keyframes[1])[1]).toBeLessThan(shift(second.keyframes[0])[1]);
    expect(driver.plays.filter((play) => play.state === "running").length).toBe(3);
  });

  it("un ridisegno uguale a metà corsa non la tronca: prosegue sull'elemento nuovo", async () => {
    const host = view(keyed("a", "b", "c"));
    draw(host, keyed("c", "a", "b"));
    await settled();
    driver.advance(50);
    const live = liveState(row(host, "c"))!;
    const old = row(host, "c");

    draw(host, keyed("c", "a", "b"));
    await settled();
    expect(row(host, "c")).not.toBe(old);
    expect(shift(playOn(row(host, "c"))?.keyframes[0])[1]).toBeCloseTo(live.pose.y!, 1);
  });

  it("due riconciliazioni nello stesso giro sono una passata sola", async () => {
    const host = view(keyed("a", "b", "c"));
    draw(host, keyed("b", "c", "a"));
    draw(host, keyed("c", "a", "b"));
    await settled();
    // Dal posto di prima di tutte e due, non da quello di mezzo.
    expect(shift(playOn(row(host, "c"))?.keyframes[0])).toEqual([0, 2 * ROW]);
    expect(shift(playOn(row(host, "a"))?.keyframes[0])).toEqual([0, -ROW]);
    expect(driver.plays).toHaveLength(3);
  });

  it("chiudere la vita ferma le corse, toglie le immagini e il gancio", async () => {
    const host = view(keyed("a", "b", "c", "d"));
    draw(host, keyed("d", "a", "c"));
    await settled();
    expect(ghosts(host)).toHaveLength(1);
    expect(activeMotions()).toBeGreaterThan(0);

    lifetime.close();
    expect(activeMotions()).toBe(0);
    expect(ghosts(host)).toHaveLength(0);

    const plays = driver.plays.length;
    draw(host, keyed("a", "c"));
    await settled();
    expect(driver.plays).toHaveLength(plays);
    expect(ghosts(host)).toHaveLength(0);
  });

  it("una vita chiusa prima del microtask non avvia niente", async () => {
    const host = view(keyed("a", "b", "c"));
    draw(host, keyed("c", "a"));
    lifetime.close();
    await settled();
    expect(driver.plays).toHaveLength(0);
    expect(ghosts(host)).toHaveLength(0);
  });
});

describe("la sagoma della voce scelta", () => {
  const choice = (selected: string): UiNode => list(["a", "b", "c"].map((key) => voice(key, key === selected)));

  it("scivola dalla riga di prima a quella di adesso, sotto il testo", async () => {
    const host = view(choice("a"));
    draw(host, choice("c"));
    await settled();

    expect(driver.plays).toHaveLength(1);
    const play = playOn(row(host, "c"), "::after")!;
    expect(shift(play.keyframes[0])).toEqual([0, -2 * ROW]);
    expect(shift(play.keyframes[play.keyframes.length - 1])).toEqual([0, 0]);
    // Lo stato non ha aspettato: la riga scelta è già quella nuova.
    expect(row(host, "c").getAttribute("aria-current")).toBe("true");
    expect(row(host, "a").hasAttribute("aria-current")).toBe(false);
  });

  it("in un albero la riga è l'etichetta del ramo scelto, e prende la sua misura", async () => {
    const tree = (selected: string): UiNode =>
      ({ node: "tree", roots: [branch("uno", selected === "uno", [branch("due", selected === "due")])] }) as UiNode;
    const host = view(tree("uno"));
    const label = (key: string): HTMLElement => host.querySelector<HTMLElement>(`[data-key="${key}"] > .ui-tree-label`)!;
    place(label("uno"), 0, 0, WIDTH, ROW);
    place(label("due"), 20, ROW, WIDTH - 20, ROW);

    draw(host, tree("due"));
    await settled();
    const play = playOn(label("due"), "::after")!;
    // I centri: da (150, 15) a (160, 45); la sagoma parte larga come quella di prima.
    expect(shift(play.keyframes[0])).toEqual([-10, -ROW]);
    expect(String(play.keyframes[0].transform)).toContain(`scale(${Math.round((WIDTH / (WIDTH - 20)) * 1e4) / 1e4}, 1)`);
  });

  it("una patch a metà scivolata riparte da dove la sagoma si vede", async () => {
    const host = view(choice("a"));
    draw(host, choice("c"));
    await settled();
    driver.advance(50);
    const live = liveState(row(host, "c"), "::after")!;

    draw(host, choice("b"));
    await settled();
    // La sagoma stava `live.y` sopra la terza riga; ora riposa sulla seconda.
    expect(shift(playOn(row(host, "b"), "::after")?.keyframes[0])[1]).toBeCloseTo(live.pose.y! + ROW, 1);
    expect(running()).toHaveLength(1);
  });

  it("la stessa voce ridisegnata non riparte, e una scivolata in corso la segue", async () => {
    const host = view(choice("a"));
    draw(host, choice("a"));
    await settled();
    expect(driver.plays).toHaveLength(0);

    draw(host, choice("c"));
    await settled();
    driver.advance(50);
    const live = liveState(row(host, "c"), "::after")!;
    draw(host, choice("c"));
    await settled();
    expect(shift(playOn(row(host, "c"), "::after")?.keyframes[0])[1]).toBeCloseTo(live.pose.y!, 1);
    expect(running()).toHaveLength(1);
  });

  it("col moto ridotto la sagoma è già al suo posto", async () => {
    setMotionPreference("reduced");
    const host = view(choice("a"));
    draw(host, choice("c"));
    await settled();
    expect(driver.plays).toHaveLength(0);
  });

  it("segue la riga anche quando la riga cambia posto", async () => {
    const host = view(list([voice("a", true), voice("b"), voice("c")]));
    // `c` diventa la scelta e sale in cima: la sua riga parte due righe più
    // giù, e la sagoma, che si muove con lei, deve partire dalla prima.
    draw(host, list([voice("c", true), voice("a"), voice("b")]));
    await settled();
    expect(shift(playOn(row(host, "c"))?.keyframes[0])).toEqual([0, 2 * ROW]);
    expect(shift(playOn(row(host, "c"), "::after")?.keyframes[0])).toEqual([0, -2 * ROW]);
  });
});
