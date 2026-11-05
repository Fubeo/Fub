// @vitest-environment happy-dom
//
// Il movimento della barra: con «ridotto» non parte nessuna corsa, salvo la
// dissolvenza del vassoio che torna; chiusa la vita della barra, niente resta
// vivo e nessuna immagine resta nella pagina; senza movimento lo stato cambia
// e basta.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeMotions, createManualDriver, liveState, setMotionDriver, setMotionPreference, type ManualDriver } from "../../moto";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { FOLD_TRAVEL, LIFT_TRAVEL, STILL_RIBBON, TAB_TRAVEL, ribbonMotion, type RibbonMotion } from "./ribbon-motion";

let driver: ManualDriver;
let life: Lifetime;
let motion: RibbonMotion;
let ribbon: HTMLElement;
let panels: HTMLElement;
let host: HTMLElement;
let formula: HTMLElement;
let grid: HTMLElement;
/// Il layout finto (happy-dom non ne ha uno): la formula e la griglia stanno
/// sotto il vassoio quando si vede, subito sotto le schede quando no. Come in
/// un browser, il riquadro misurato comprende la traslazione in volo.
const layout = new Map<Element, () => DOMRect>();

function hiddenUp(el: Element): boolean {
  for (let at: Element | null = el; at; at = at.parentElement) if ((at as HTMLElement).hidden) return true;
  return false;
}

function box(el: HTMLElement, rect: () => DOMRect): void {
  layout.set(el, rect);
  el.getBoundingClientRect = () => {
    if (hiddenUp(el)) return new DOMRect();
    const base = rect();
    const pose = liveState(el)?.pose;
    return new DOMRect(base.x + (pose?.x ?? 0), base.y + (pose?.y ?? 0), base.width, base.height);
  };
  el.getClientRects = () => (hiddenUp(el) ? ([] as unknown as DOMRectList) : ([el.getBoundingClientRect()] as unknown as DOMRectList));
}

const trayTop = () => (panels.hidden ? 40 : 120);

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  life = openLifetime();
  const surface = document.createElement("div");
  host = document.createElement("div");
  ribbon = document.createElement("div");
  panels = document.createElement("div");
  for (let at = 0; at < 3; at += 1) {
    const group = document.createElement("div");
    const body = document.createElement("div");
    group.append(body);
    panels.append(group);
    box(group, () => new DOMRect(at * 120, 40, 110, 80));
    box(body, () => new DOMRect(at * 120, 40, 110, 70));
  }
  ribbon.append(panels);
  host.append(ribbon);
  formula = document.createElement("div");
  grid = document.createElement("div");
  // Ciò che sta fuori dal flusso non è della tenda.
  const announce = document.createElement("div");
  announce.style.position = "absolute";
  surface.append(host, formula, grid, announce);
  document.body.append(surface);
  box(ribbon, () => new DOMRect(0, 0, 400, trayTop()));
  box(panels, () => new DOMRect(0, 40, 400, 80));
  box(formula, () => new DOMRect(0, trayTop(), 400, 30));
  box(grid, () => new DOMRect(0, trayTop() + 30, 400, 400));
  box(announce, () => new DOMRect(0, 0, 1, 1));
  motion = ribbonMotion({ element: ribbon, panels, host }, life);
});

afterEach(() => {
  life.close();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  layout.clear();
  document.body.replaceChildren();
});

const groups = () => [...panels.children] as HTMLElement[];
const playsOn = (el: Element) => driver.plays.filter((play) => play.el === el);
const ghosts = () => ribbon.querySelectorAll("[inert]").length;

describe("il movimento della barra", () => {
  it("la sezione nuova: i foglietti entrano uno dopo l'altro dal suo verso", () => {
    motion.section({ panel: panels, groups: groups() }, null, -1);
    const starts = groups().map((group) => playsOn(group)[0]);
    expect(starts.every(Boolean)).toBe(true);
    expect(starts.map((play) => play!.timing.delay)).toEqual([0, 12, 24]);
    expect(String(starts[0]!.keyframes[0]!.transform)).toContain(`translate(${-TAB_TRAVEL}px`);
  });

  it("tornando indietro a metà, i foglietti della sezione lasciata escono come immagine da dove si vedevano", () => {
    // La seconda sezione, vuota di layout: i suoi foglietti stanno dove i primi.
    const other = document.createElement("div");
    const fresh = document.createElement("div");
    other.append(fresh);
    other.hidden = true;
    ribbon.append(other);
    box(fresh, () => new DOMRect(0, 40, 110, 80));
    motion.section({ panel: panels, groups: groups() }, null, 1);
    driver.advance(60);
    const flying = groups()[0]!.getBoundingClientRect().left;
    expect(flying).toBeGreaterThan(0);
    // `kit/tabs` cambia il pannello prima di dirlo.
    panels.hidden = true;
    other.hidden = false;
    motion.section({ panel: other, groups: [fresh] }, { panel: panels, groups: groups() }, -1);
    expect(panels.hidden).toBe(true);
    expect(other.hidden).toBe(false);
    expect(ghosts()).toBe(3);
    expect(groups().every((group) => liveState(group) === null)).toBe(true);
    driver.advance(200);
    expect(ghosts()).toBe(0);
  });

  it("una sezione che se ne va mentre compariva svanisce da dov'era; una ferma no", () => {
    const [shown, still] = groups();
    motion.appear([shown!]);
    driver.advance(30);
    const vanish = motion.leave([shown!, still!]);
    shown!.remove();
    still!.remove();
    vanish();
    // L'immagine resta nella fila dell'originale, dove ne prende gli stili.
    expect(panels.querySelectorAll("[inert]")).toHaveLength(1);
  });

  it("il ritiro: l'immagine del vassoio svanisce nella barra, la tenda sale entro il tempo di un'uscita", () => {
    let applied = 0;
    motion.tray(false, () => {
      applied += 1;
      panels.hidden = true;
    });
    expect(applied).toBe(1);
    expect(ghosts()).toBe(1);
    const curtain = [...playsOn(formula), ...playsOn(grid)];
    expect(curtain).toHaveLength(2);
    expect(curtain.every((play) => play.timing.duration <= 140)).toBe(true);
    expect(String(curtain[0]!.keyframes[0]!.transform)).toContain("translate(0px, 80px)");
    driver.advance(200);
    expect(ghosts()).toBe(0);
  });

  it("la riapertura a metà del ritiro riparte da dov'è", () => {
    motion.tray(false, () => (panels.hidden = true));
    driver.advance(60);
    const midway = formula.getBoundingClientRect().top;
    expect(midway).toBeGreaterThan(40);
    expect(midway).toBeLessThan(120);
    motion.tray(true, () => (panels.hidden = false));
    expect(formula.getBoundingClientRect().top).toBeCloseTo(midway, 0);
    // L'immagine se ne va: il vassoio vero riparte dalla sua opacità.
    expect(ghosts()).toBe(0);
    expect(liveState(panels)).not.toBeNull();
  });

  it("il foglietto che si apre si alza e il suo contenuto scende; gli altri scivolano", () => {
    const [first, opened, last] = groups();
    let moved = false;
    motion.fold(groups(), opened!, () => {
      moved = true;
      box(last!, () => new DOMRect(300, 40, 110, 80));
    });
    expect(moved).toBe(true);
    expect(playsOn(first!)).toHaveLength(0);
    expect(String(playsOn(opened!)[0]!.keyframes[0]!.transform)).toContain(`translate(0px, ${-LIFT_TRAVEL}px)`);
    expect(String(playsOn(last!)[0]!.keyframes[0]!.transform)).toContain("translate(-60px, 0px)");
    expect(String(playsOn(opened!.firstElementChild!)[0]!.keyframes[0]!.transform)).toContain(`translate(0px, ${-FOLD_TRAVEL}px)`);
  });

  it("un foglietto ancora in corsa che cambia forma lascia la sua immagine; uno che la tiene prosegue", () => {
    const [first, opened, last] = groups();
    motion.fold(groups(), opened!, () => box(last!, () => new DOMRect(300, 40, 110, 80)));
    driver.advance(40);
    // Esc a metà: l'aperto torna stretto, l'ultimo torna al suo posto con la sua forma.
    Object.defineProperty(opened!, "offsetWidth", { configurable: true, get: () => 110 });
    let narrow = false;
    motion.fold(groups(), null, () => {
      narrow = true;
      box(last!, () => new DOMRect(240, 40, 110, 80));
      Object.defineProperty(opened!, "offsetWidth", { configurable: true, get: () => 40 });
    });
    expect(narrow).toBe(true);
    expect(ghosts()).toBe(1);
    expect(liveState(last!)).not.toBeNull();
    expect(playsOn(first!)).toHaveLength(0);
  });

  it("con «ridotto» nessuna corsa, salvo la dissolvenza del vassoio che torna", () => {
    setMotionPreference("reduced");
    const badge = document.createElement("span");
    box(badge, () => new DOMRect(0, 0, 10, 10));
    motion.section({ panel: panels, groups: groups() }, null, 1);
    motion.fold(groups(), groups()[1]!, () => {});
    motion.appear(groups());
    motion.tips([badge], life);
    motion.tray(false, () => (panels.hidden = true));
    expect(driver.plays).toHaveLength(0);
    expect(ghosts()).toBe(0);
    expect(panels.hidden).toBe(true);
    motion.tray(true, () => (panels.hidden = false));
    expect(driver.plays.map((play) => play.el)).toEqual([panels]);
    expect(driver.plays[0]!.keyframes.every((frame) => Object.keys(frame).every((key) => key === "opacity" || key === "offset" || key === "easing"))).toBe(true);
  });

  it("chiusa la vita della barra a metà corsa, niente resta vivo e nessuna immagine resta", () => {
    motion.section({ panel: panels, groups: groups() }, null, 1);
    motion.tray(false, () => (panels.hidden = true));
    driver.advance(30);
    expect(activeMotions()).toBeGreaterThan(0);
    life.close();
    expect(activeMotions()).toBe(0);
    expect(ghosts()).toBe(0);
    expect(groups().every((group) => liveState(group) === null)).toBe(true);
  });

  it("senza movimento lo stato cambia e basta", () => {
    let applied = 0;
    STILL_RIBBON.tray(false, () => (applied += 1));
    STILL_RIBBON.fold(groups(), null, () => (applied += 1));
    STILL_RIBBON.section({ panel: panels, groups: groups() }, null, 1);
    expect(STILL_RIBBON.leave(groups())).toBeTypeOf("function");
    expect(applied).toBe(2);
    expect(driver.plays).toHaveLength(0);
  });
});
