// @vitest-environment happy-dom
//
// La consegna: a fine avvio lo strato se ne va con tutto ciò che ha scritto,
// l'app sotto torna viva e col fuoco al suo posto prima che il passaggio
// cominci, e il passaggio è la cascata di `moto` (o la sola dissolvenza con
// meno movimento). Il tempo è finto: i timer, `performance.now()` e il motore
// di `moto`, che registra ogni corsa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import desktop from "../../index.html?raw";
import mobile from "../../mobile.html?raw";
import documento from "../../document.html?raw";
import stati from "../../public/avvio/stati.js?raw";
import luce from "../../public/avvio/luce.js?raw";
import { IT } from "../i18n/catalog";
import { resolvedLanguage } from "../i18n/strings";
import { activeMotions, animate, createManualDriver, setMotionDriver, type ManualDriver } from "../moto";
import { openLifetime } from "../ui/lifetime";
import { CACHE, consegna, fallito, fase, pronta, type TemaAvvio } from "./consegna";

vi.mock("../moto", async (importOriginal) => {
  const vero = await importOriginal<typeof import("../moto")>();
  return { ...vero, animate: vi.fn(vero.animate) };
});
const animata = vi.mocked(animate);

/// I colori dell'app, come li lascia il tema montato.
const COLORI_APP: Record<string, string> = {
  "--bg": "#0a0e16",
  "--text": "#e6e9ef",
  "--muted": "#8a93a6",
  "--accent": "#7c6cf0",
  "--accent-contrast": "#ffffff",
  "--border": "#232a38",
  "--danger": "#e5484d",
  "--focus-ring": "#9d8fff",
};

/// La pagina come la trova la webview: la testa con lo stile, il corpo con lo
/// strato e l'app inerte, gli attributi che luce.js scrive su `<html>`.
function monta(html: string, attributi: Record<string, string> = {}): void {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.head.querySelectorAll("script")) el.remove();
  for (const el of doc.body.querySelectorAll("script")) el.remove();
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  const root = document.documentElement;
  root.setAttribute("data-avvio-luce", "dark");
  root.setAttribute("data-avvio-contrasto", "normal");
  root.style.setProperty("--avvio-sfondo", "#101418");
  root.style.setProperty("color", "red");
  for (const [nome, valore] of Object.entries(attributi)) root.setAttribute(nome, valore);
  for (const [nome, valore] of Object.entries(COLORI_APP)) root.style.setProperty(nome, valore);
}

function strato(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".avvio");
}

/// Il marchio è entrato `fa` ms fa, come lo segna stati.js.
function marchioEntrato(fa: number): void {
  const el = strato()!;
  el.setAttribute("data-marchio", "");
  el.setAttribute("data-marchio-da", String(Math.round(performance.now() - fa)));
}

/// Le regioni disegnate: un rettangolo vero soltanto per gli id dati.
function disegnate(...id: string[]): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const piena = id.includes(this.id);
    return DOMRect.fromRect({ x: 0, y: 0, width: piena ? 200 : 0, height: piena ? 100 : 0 });
  });
}

const TEMA: TemaAvvio = {
  definitivo: () => Promise.resolve(),
  scelte: () => ({ light: "", contrast: "high" }),
};

/// Le promesse e i timer finti fanno un giro.
async function giro(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

let motore: ManualDriver;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.advanceTimersByTime(5000);
  motore = createManualDriver();
  setMotionDriver(motore);
  animata.mockClear();
  localStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(() => {
  // Le corse lasciate a metà da un caso finiscono qui: il contatore di `moto`
  // è del modulo.
  motore.advance(10_000);
  setMotionDriver(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  const root = document.documentElement;
  root.removeAttribute("style");
  for (const nome of root.getAttributeNames()) if (nome.startsWith("data-")) root.removeAttribute(nome);
});

function nienteStrato(): void {
  const root = document.documentElement;
  expect(strato()).toBeNull();
  expect(document.getElementById("avvio-stile")).toBeNull();
  expect(root.getAttributeNames().filter((nome) => nome.startsWith("data-avvio"))).toEqual([]);
  expect(root.getAttribute("style") ?? "").not.toContain("--avvio-");
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  expect(document.querySelectorAll("[aria-busy]")).toHaveLength(0);
  expect(document.activeElement).not.toBe(document.body);
}

/// L'app è viva e lo strato non prende più niente: il primo fotogramma del
/// passaggio.
function appViva(): void {
  expect(strato()?.hasAttribute("data-consegna")).toBe(true);
  expect(strato()?.getAttribute("aria-hidden")).toBe("true");
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  expect(document.querySelectorAll("[aria-busy]")).toHaveLength(0);
}

describe("consegna senza marchio: l'avvio istantaneo", () => {
  it("index.html: via lo strato e i suoi segni, l'app viva, il fuoco sui fogli, nessuna corsa", async () => {
    monta(desktop);
    expect(document.querySelectorAll("[inert]")).toHaveLength(2);
    await consegna();
    nienteStrato();
    expect(animata).not.toHaveBeenCalled();
    expect(motore.plays).toHaveLength(0);
    expect(document.activeElement?.id).toBe("panes");
    // Ciò che non è dello strato resta.
    expect(document.documentElement.style.getPropertyValue("color")).toBe("red");
    expect(document.getElementById("app")).not.toBeNull();
  });

  it("il fuoco va prima al foglio attivo, poi alla scelta del vault", async () => {
    monta(desktop);
    const onboarding = document.getElementById("onboarding")!;
    onboarding.hidden = false;
    await consegna();
    expect(document.activeElement?.id).toBe("onboarding-open");

    monta(desktop);
    const foglio = document.createElement("div");
    foglio.className = "pane focus";
    const scritto = document.createElement("div");
    scritto.setAttribute("contenteditable", "true");
    foglio.appendChild(scritto);
    document.getElementById("panes")!.appendChild(foglio);
    await consegna();
    expect(document.activeElement).toBe(scritto);
  });

  it("un fuoco già dato dall'avvio resta dov'è", async () => {
    monta(desktop);
    const vault = document.getElementById("vault-chip")!;
    // Il fuoco fuori da un elemento inerte: come se l'avvio l'avesse dato dopo.
    document.getElementById("app")!.removeAttribute("inert");
    vault.focus();
    await consegna();
    expect(document.activeElement).toBe(vault);
  });

  it("document.html: #document-window torna viva", async () => {
    monta(documento);
    // L'editor che l'ingresso monta nel foglio.
    const scritto = document.createElement("div");
    scritto.setAttribute("contenteditable", "true");
    document.getElementById("document-window-sheet")!.appendChild(scritto);
    await consegna();
    expect(document.activeElement).toBe(scritto);
    nienteStrato();
    expect(document.getElementById("document-window")?.hasAttribute("inert")).toBe(false);
  });

  it("senza strato non fa niente", async () => {
    document.body.innerHTML = '<div id="app" inert></div>';
    document.documentElement.setAttribute("data-avvio-luce", "dark");
    await consegna({ tema: TEMA });
    fase("vault", "Note");
    pronta();
    expect(fallito("x")).toBe(false);
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true);
    expect(document.documentElement.getAttribute("data-avvio-luce")).toBe("dark");
    expect(localStorage.getItem(CACHE)).toBeNull();
  });
});

describe("i segni dell'avvio sullo strato", () => {
  it("fase, nome e pronta", () => {
    monta(desktop);
    fase("finestra");
    expect(strato()!.dataset.fase).toBe("finestra");
    expect(strato()!.hasAttribute("data-nome")).toBe(false);
    fase("vault", "Note <di> lavoro");
    expect(strato()!.dataset.fase).toBe("vault");
    expect(strato()!.dataset.nome).toBe("Note <di> lavoro");
    expect(strato()!.hasAttribute("data-pronta")).toBe(false);
    pronta();
    expect(strato()!.hasAttribute("data-pronta")).toBe(true);
  });
});

describe("il passaggio", () => {
  it("col marchio entrato da 100 ms la consegna aspetta fino a 400 ms, poi l'app è viva prima di ogni corsa finita", async () => {
    monta(desktop);
    disegnate("topbar", "panes");
    marchioEntrato(100);
    const fatto = consegna({ tema: TEMA });
    let finita = false;
    void fatto.then(() => (finita = true));
    await giro(299);
    expect(strato()!.hasAttribute("data-consegna")).toBe(false);
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true);
    expect(animata).not.toHaveBeenCalled();
    await giro(1);
    // Il primo fotogramma del passaggio: niente è ancora finito.
    appViva();
    expect(document.activeElement?.id).toBe("panes");
    expect(motore.plays.length).toBeGreaterThan(0);
    expect(motore.plays.every((corsa) => corsa.state === "running")).toBe(true);
    expect(finita).toBe(false);
    // Lo strato sfuma in 90 ms, poi se ne va; il suo stile e i segni su
    // `<html>` aspettano che la cascata sia finita.
    motore.advance(100);
    await giro();
    expect(strato()).toBeNull();
    expect(document.getElementById("avvio-stile")).not.toBeNull();
    expect(finita).toBe(false);
    motore.advance(3000);
    await giro();
    expect(finita).toBe(true);
    nienteStrato();
  });

  it("cascata: snap per il marchio, elastic per ogni regione disegnata, ogni 30 ms senza buchi", async () => {
    monta(desktop);
    // L'ispettore è chiuso, il lato non ha rettangolo: si saltano.
    document.getElementById("right-pane")!.hidden = true;
    disegnate("topbar", "rail", "right-pane", "panes", "status-band");
    marchioEntrato(1000);
    const fatto = consegna({ tema: TEMA });
    await giro();
    appViva();

    const dissolvenza = animata.mock.calls.find(([el]) => el === strato());
    expect(dissolvenza?.[1]).toMatchObject({ from: { opacity: 1 }, to: { opacity: 0 }, duration: 90, easing: "linear" });
    const marchio = animata.mock.calls.find(([el]) => (el as Element).classList.contains("avvio-marchio"));
    expect(marchio?.[1]).toMatchObject({ to: { scale: 0.94 }, spring: "snap" });

    const regioni = animata.mock.calls.filter(([el]) => !strato()!.contains(el));
    expect(regioni.map(([el]) => (el as Element).id)).toEqual(["topbar", "rail", "panes", "status-band"]);
    expect(regioni.map(([, spec]) => spec?.spring)).toEqual(["elastic", "elastic", "elastic", "elastic"]);
    expect(regioni.map(([, spec]) => spec?.from)).toEqual([
      { opacity: 0, y: -8 },
      { opacity: 0, x: -8 },
      { opacity: 0, y: 16, scale: 0.98 },
      { opacity: 0, y: 8 },
    ]);
    const ritardi = motore.plays.filter((corsa) => !strato()!.contains(corsa.el)).map((corsa) => corsa.timing.delay);
    expect(ritardi).toEqual([0, 30, 60, 90]);

    // Alla fine dello strato la sua corsa del marchio si annulla; quelle
    // dell'app finiscono da sole e non lasciano niente.
    motore.advance(100);
    await giro();
    expect(strato()).toBeNull();
    expect(motore.plays.find((corsa) => corsa.el.classList.contains("avvio-marchio"))?.state).toBe("canceled");
    expect(motore.plays.filter((corsa) => corsa.el.id === "topbar")[0]?.state).toBe("running");
    motore.advance(3000);
    await fatto;
    nienteStrato();
    expect(activeMotions()).toBe(0);
    expect(motore.plays.every((corsa) => corsa.state !== "running")).toBe(true);
    for (const id of ["topbar", "rail", "panes", "status-band"]) {
      expect(document.getElementById(id)!.getAttribute("style") ?? "").toBe("");
    }
  });

  it("il telefono: la barra, i fogli, poi il binario in basso che sale da y +8", async () => {
    monta(mobile, { "data-client-shell": "mobile", "data-mobile-form-factor": "phone" });
    disegnate("topbar", "rail", "sidebar", "panes", "status-band");
    marchioEntrato(1000);
    const fatto = consegna({ tema: TEMA });
    await giro();
    const regioni = animata.mock.calls.filter(([el]) => !strato()!.contains(el));
    expect(regioni.map(([el]) => (el as Element).id)).toEqual(["topbar", "panes", "rail"]);
    expect(regioni[2]?.[1]?.from).toEqual({ opacity: 0, y: 8 });
    motore.advance(3000);
    await fatto;
    nienteStrato();
  });

  it("document.html: entra soltanto #document-window, con la posa dei fogli", async () => {
    monta(documento);
    document.getElementById("document-window-sheet")!.appendChild(document.createElement("div")).setAttribute("contenteditable", "true");
    disegnate("document-window");
    marchioEntrato(1000);
    const fatto = consegna();
    await giro();
    const regioni = animata.mock.calls.filter(([el]) => !strato()!.contains(el));
    expect(regioni.map(([el]) => (el as Element).id)).toEqual(["document-window"]);
    expect(regioni[0]?.[1]).toMatchObject({ from: { opacity: 0, y: 16, scale: 0.98 }, spring: "elastic" });
    motore.advance(3000);
    await fatto;
    nienteStrato();
    // Senza il tema dell'app la cache non si scrive.
    expect(localStorage.getItem(CACHE)).toBeNull();
  });

  it("moto ridotto: una sola dissolvenza di 90 ms, nessun transform", async () => {
    monta(desktop, { "data-avvio-moto": "ridotto" });
    disegnate("topbar", "rail", "sidebar", "panes", "right-pane", "status-band");
    marchioEntrato(1000);
    const fatto = consegna({ tema: TEMA });
    await giro();
    appViva();
    expect(animata).toHaveBeenCalledTimes(1);
    expect(animata.mock.calls[0]?.[0]).toBe(strato());
    expect(motore.plays).toHaveLength(1);
    expect(motore.plays[0]!.timing.duration).toBe(90);
    expect(motore.plays[0]!.keyframes.every((fotogramma) => !("transform" in fotogramma))).toBe(true);
    motore.advance(100);
    await fatto;
    nienteStrato();
  });

  it("dopo la consegna: niente strato, nessuna corsa viva, fub.avvio scritto e valido", async () => {
    monta(desktop);
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.contrast = "high";
    document.documentElement.dataset.motion = "calm";
    // Un avvio precedente aveva salvato la luce chiara: resta.
    localStorage.setItem(CACHE, JSON.stringify({ v: 1, colori: { light: { sfondo: "#e8edf5", testo: "red;}" } } }));
    disegnate("topbar", "panes");
    marchioEntrato(1000);
    const fatto = consegna({ tema: TEMA });
    await giro();
    motore.advance(3000);
    await fatto;
    nienteStrato();
    expect(activeMotions()).toBe(0);

    const cache = JSON.parse(localStorage.getItem(CACHE)!);
    expect(cache).toMatchObject({ v: 1, luce: "system", contrasto: "high", moto: "calm", lingua: resolvedLanguage() });
    expect(cache.colori["dark-high"]).toEqual({
      sfondo: "#0a0e16",
      testo: "#e6e9ef",
      tenue: "#8a93a6",
      accento: "#7c6cf0",
      inchiostro: "#ffffff",
      bordo: "#232a38",
      guasto: "#e5484d",
      fuoco: "#9d8fff",
    });
    // Il colore cattivo della cache vecchia non sopravvive.
    expect(cache.colori.light).toEqual({ sfondo: "#e8edf5" });
    expect(cache.testi["app.avvio.vault"]).toBe(IT["app.avvio.vault"]);
    expect(cache.testi["app.retry"]).toBe(IT["app.retry"]);
    expect(cache.testi["app.startup_phase.vault"]).toBe(IT["app.startup_phase.vault"]);
    expect(Object.keys(cache.testi).filter((chiave) => chiave.startsWith("app.avvio."))).toHaveLength(
      Object.keys(IT).filter((chiave) => chiave.startsWith("app.avvio.")).length,
    );
  });

  it("la cache scritta è quella che luce.js legge: la stessa luce, lo stesso contrasto, lo stesso moto", async () => {
    monta(desktop);
    const root = document.documentElement;
    root.dataset.theme = "light";
    root.dataset.contrast = "high";
    root.dataset.motion = "reduced";
    await consegna({ tema: { ...TEMA, scelte: () => ({ light: "light", contrast: "high" }) } });
    nienteStrato();
    expect(JSON.parse(localStorage.getItem(CACHE)!)).toMatchObject({ luce: "light", contrasto: "high", moto: "reduced" });
    // Il prossimo avvio.
    new Function(luce)();
    expect(root.getAttribute("data-avvio-luce")).toBe("light");
    expect(root.getAttribute("data-avvio-contrasto")).toBe("high");
    expect(root.getAttribute("data-avvio-moto")).toBe("ridotto");
    expect(root.style.getPropertyValue("--avvio-sfondo")).toBe("#0a0e16");
    expect(root.style.getPropertyValue("--avvio-fuoco")).toBe("#9d8fff");
  });

  it("le --avvio-* vanno ai colori dell'app prima del passaggio", async () => {
    monta(desktop);
    disegnate("panes");
    marchioEntrato(1000);
    const fatto = consegna({ tema: TEMA });
    await giro();
    expect(document.documentElement.style.getPropertyValue("--avvio-sfondo")).toBe("#0a0e16");
    expect(document.documentElement.style.getPropertyValue("--avvio-accento")).toBe("#7c6cf0");
    motore.advance(3000);
    await fatto;
  });

  it("il tema che non arriva: dopo 1,5 s si consegna con quello che c'è", async () => {
    monta(desktop);
    const fatto = consegna({ tema: { ...TEMA, definitivo: () => new Promise<void>(() => {}) } });
    await giro(1499);
    expect(strato()).not.toBeNull();
    await giro(1);
    await fatto;
    nienteStrato();
    expect(localStorage.getItem(CACHE)).not.toBeNull();
  });

  it("localStorage che lancia: la consegna avviene lo stesso", async () => {
    monta(desktop);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("archivio negato");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("archivio negato");
    });
    await consegna({ tema: TEMA });
    nienteStrato();
  });

  it("la vita chiusa a metà passaggio: niente corse vive, niente strato", async () => {
    monta(desktop);
    disegnate("topbar", "rail", "panes");
    marchioEntrato(1000);
    const vita = openLifetime();
    const fatto = consegna({ tema: TEMA, vita });
    await giro();
    motore.advance(20);
    expect(activeMotions()).toBeGreaterThan(0);
    vita.close();
    await fatto;
    nienteStrato();
    expect(activeMotions()).toBe(0);
  });

  it("due chiamate fanno una consegna sola", async () => {
    monta(desktop);
    disegnate("panes");
    marchioEntrato(1000);
    const prima = consegna({ tema: TEMA });
    const seconda = consegna({ tema: TEMA });
    expect(seconda).toBe(prima);
    await giro();
    motore.advance(3000);
    await prima;
    expect(animata.mock.calls.filter(([el]) => (el as Element).id === "panes")).toHaveLength(1);
  });
});

describe("il guasto", () => {
  it("fallito(): lo strato resta, col motivo, e Riprova ha il fuoco; la consegna non avviene", async () => {
    monta(desktop);
    new Function(stati)();
    expect(fallito("il ponte non risponde")).toBe(true);
    expect(strato()!.dataset.stato).toBe("guasto");
    expect(strato()!.querySelector(".avvio-motivo")!.textContent).toBe("il ponte non risponde");
    await consegna({ tema: TEMA });
    await giro(5000);
    expect(strato()).not.toBeNull();
    expect(strato()!.hasAttribute("data-consegna")).toBe(false);
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true);
    expect(document.activeElement?.id).toBe("avvio-riprova");
    expect(localStorage.getItem(CACHE)).toBeNull();
  });

  it("il guasto per tempo e poi l'avvio che finisce: la consegna avviene, e il fuoco lascia Riprova", async () => {
    monta(desktop);
    new Function(stati)();
    await giro(30_000);
    expect(strato()!.dataset.stato).toBe("guasto");
    expect(document.activeElement?.id).toBe("avvio-riprova");
    disegnate("panes");
    const fatto = consegna({ tema: TEMA });
    await giro();
    motore.advance(3000);
    await fatto;
    nienteStrato();
    expect(document.activeElement?.id).toBe("panes");
  });
});
