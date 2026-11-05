// @vitest-environment happy-dom
//
// `public/avvio/stati.js` tiene i tempi dello strato d'avvio: il marchio a
// 120 ms, la fase a 2 s, «Ci vuole più del solito.» a 10 s, il guasto a 30 s
// se l'avvio non ha detto `data-pronta`. Si esegue com'è, sul markup vero di
// `index.html`, con i timer finti.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import codice from "../../public/avvio/stati.js?raw";
import html from "../../index.html?raw";
import { EN, IT } from "../i18n/catalog";
import { expand } from "../i18n/strings";

const MARKUP = new DOMParser().parseFromString(html, "text/html").querySelector(".avvio")!.outerHTML;

function strato(): HTMLElement {
  return document.querySelector<HTMLElement>(".avvio")!;
}
function esegui(): void {
  new Function(codice)();
}
/// Le risposte degli osservatori sono microcompiti.
async function microcompiti(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  localStorage.clear();
  document.documentElement.removeAttribute("data-avvio-script");
  document.body.innerHTML = MARKUP;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stati.js", () => {
  it("i tempi: 119 ms niente marchio, poi il marchio, 2 s attesa, 10 s lento, 30 s guasto", () => {
    esegui();
    const avvio = strato();
    const annuncio = avvio.querySelector(".avvio-annuncio")!;
    vi.advanceTimersByTime(119);
    expect(avvio.hasAttribute("data-marchio")).toBe(false);
    expect(annuncio.textContent).toBe("");
    vi.advanceTimersByTime(1);
    expect(avvio.hasAttribute("data-marchio")).toBe(true);
    expect(Number(avvio.dataset.marchioDa)).toBeGreaterThanOrEqual(120);
    expect(annuncio.textContent).toBe(IT["app.avvio.annuncio"]);
    expect(avvio.dataset.stato).toBe("avvio");
    vi.advanceTimersByTime(2000 - 120 - 1);
    expect(avvio.dataset.stato).toBe("avvio");
    vi.advanceTimersByTime(1);
    expect(avvio.dataset.stato).toBe("attesa");
    expect(avvio.querySelector(".avvio-fase")!.textContent).toBe(IT["app.avvio.pagina"]);
    vi.advanceTimersByTime(8000);
    expect(avvio.dataset.stato).toBe("lento");
    vi.advanceTimersByTime(19_999);
    expect(avvio.dataset.stato).toBe("lento");
    vi.advanceTimersByTime(1);
    expect(avvio.dataset.stato).toBe("guasto");
    expect(avvio.querySelector(".avvio-motivo")!.textContent).toBe(
      expand(IT["app.avvio.motivo.tempo"], { phase: IT["app.startup_phase.page"] }),
    );
    expect(document.activeElement?.id).toBe("avvio-riprova");
    expect(annuncio.textContent).toBe(`${IT["app.avvio.guasto"]} ${avvio.querySelector(".avvio-motivo")!.textContent}`);
  });

  it("data-pronta prima dei 30 s: niente guasto", () => {
    esegui();
    vi.advanceTimersByTime(29_000);
    strato().setAttribute("data-pronta", "");
    vi.advanceTimersByTime(5000);
    expect(strato().dataset.stato).toBe("lento");
  });

  it("lo script mancante dà subito il guasto, col percorso, e il fuoco su Riprova", () => {
    document.documentElement.setAttribute("data-avvio-script", "/assets/desktop-shell-3f9a2c.js");
    esegui();
    const avvio = strato();
    expect(avvio.dataset.stato).toBe("guasto");
    expect(avvio.hasAttribute("data-marchio")).toBe(true);
    expect(avvio.querySelector(".avvio-motivo")!.textContent).toBe(
      expand(IT["app.avvio.motivo.script"], { src: "/assets/desktop-shell-3f9a2c.js" }),
    );
    expect(document.activeElement?.id).toBe("avvio-riprova");
    // I tempi dopo non lo spostano.
    vi.advanceTimersByTime(12_000);
    expect(avvio.dataset.stato).toBe("guasto");
  });

  it("lo script che manca dopo la partenza lo dice appena luce.js lo scrive", async () => {
    esegui();
    vi.advanceTimersByTime(500);
    document.documentElement.setAttribute("data-avvio-script", "/assets/tardi.js");
    await microcompiti();
    expect(strato().dataset.stato).toBe("guasto");
    expect(document.activeElement?.id).toBe("avvio-riprova");
  });

  it("avvio:guasto mostra il motivo come testo, e Riprova ricarica", () => {
    const ricarica = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: ricarica, href: window.location.href });
    esegui();
    const motivo = "<img src=x onerror=alert(1)>";
    strato().dispatchEvent(new CustomEvent("avvio:guasto", { detail: { motivo } }));
    const scritto = strato().querySelector(".avvio-motivo")!;
    expect(scritto.textContent).toBe(motivo);
    expect(scritto.children).toHaveLength(0);
    (document.activeElement as HTMLElement).click();
    expect(ricarica).toHaveBeenCalledTimes(1);
  });

  it("«Copia i dettagli» c'è solo con gli appunti, e copia motivo, fase, agente e tempi", async () => {
    esegui();
    strato().dispatchEvent(new CustomEvent("avvio:guasto", { detail: { motivo: "senza appunti" } }));
    const copia = strato().querySelector<HTMLButtonElement>("#avvio-copia")!;
    if (!("clipboard" in navigator) || !navigator.clipboard) expect(copia.hidden).toBe(true);
    document.body.innerHTML = MARKUP;
    const scrivi = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { userAgent: "agente di prova", clipboard: { writeText: scrivi } });
    esegui();
    strato().setAttribute("data-fase", "vault");
    strato().dispatchEvent(new CustomEvent("avvio:guasto", { detail: { motivo: "la shell non è partita" } }));
    const bottone = strato().querySelector<HTMLButtonElement>("#avvio-copia")!;
    expect(bottone.hidden).toBe(false);
    bottone.click();
    expect(scrivi).toHaveBeenCalledTimes(1);
    const testo = (scrivi.mock.calls[0] as unknown as [string])[0];
    expect(testo).toContain("la shell non è partita");
    expect(testo).toContain("vault");
    expect(testo).toContain("agente di prova");
    expect(testo).toMatch(/marchio -?\d+ ms/);
    await microcompiti();
    expect(bottone.textContent).toBe(IT["app.avvio.copiato"]);
  });

  it("la fase e il nome: textContent fra le virgolette, e cambiano quando l'avvio li scrive", async () => {
    esegui();
    vi.advanceTimersByTime(2000);
    const avvio = strato();
    const nome = "Archivio <b>lunghissimo</b> " + "x".repeat(200);
    avvio.setAttribute("data-nome", nome);
    avvio.setAttribute("data-fase", "vault");
    await microcompiti();
    const fase = avvio.querySelector(".avvio-fase")!;
    expect(fase.textContent).toBe(expand(IT["app.avvio.vault"], { name: nome }));
    expect(avvio.querySelector(".avvio-nome")!.textContent).toBe(nome);
    expect(avvio.querySelector(".avvio-nome")!.children).toHaveLength(0);
    avvio.setAttribute("data-fase", "finestra");
    await microcompiti();
    expect(fase.textContent).toBe(IT["app.avvio.finestra"]);
  });

  it("i testi salvati alla consegna sostituiscono l'italiano; lang resta quello della pagina", () => {
    const testi = Object.fromEntries(Object.entries(EN).filter(([k]) => k.startsWith("app.avvio.") || k === "app.retry" || k.startsWith("app.startup_phase.")));
    localStorage.setItem("fub.avvio", JSON.stringify({ v: 1, testi, lingua: "en" }));
    document.documentElement.lang = "it";
    esegui();
    const avvio = strato();
    expect(avvio.querySelector("#avvio-riprova")!.textContent).toBe(EN["app.retry"]);
    expect(avvio.querySelector(".avvio-lento-testo")!.textContent).toBe(EN["app.avvio.lento"]);
    expect(avvio.querySelector("#avvio-regione")!.textContent).toBe(EN["app.avvio.regione"]);
    vi.advanceTimersByTime(30_000);
    expect(avvio.querySelector(".avvio-motivo")!.textContent).toBe(
      expand(EN["app.avvio.motivo.tempo"], { phase: EN["app.startup_phase.page"] }),
    );
    expect(document.documentElement.lang).toBe("it");
  });

  it("l'italiano di serie dello script è quello del catalogo", () => {
    const tabella = /var DI_SERIE = (\{[\s\S]*?\});/.exec(codice);
    expect(tabella).not.toBeNull();
    const diSerie = new Function(`return ${tabella![1]}`)() as Record<string, string>;
    expect(Object.keys(diSerie).length).toBeGreaterThan(10);
    for (const [chiave, testo] of Object.entries(diSerie)) {
      expect(testo, chiave).toBe(IT[chiave as keyof typeof IT]);
    }
    for (const chiave of Object.keys(IT).filter((k) => k.startsWith("app.avvio."))) {
      expect(diSerie[chiave], chiave).toBeDefined();
    }
  });

  it("senza cache, la fase e il guasto parlano l'italiano di serie", async () => {
    esegui();
    const avvio = strato();
    avvio.setAttribute("data-fase", "vault");
    avvio.setAttribute("data-nome", "Note");
    await microcompiti();
    vi.advanceTimersByTime(30_000);
    expect(avvio.querySelector(".avvio-fase")!.textContent).toBe(expand(IT["app.avvio.vault"], { name: "Note" }));
    expect(avvio.querySelector(".avvio-motivo")!.textContent).toBe(
      expand(IT["app.avvio.motivo.tempo"], { phase: IT["app.startup_phase.vault"] }),
    );
  });

  it("a strato tolto non resta nessun timer acceso", () => {
    esegui();
    vi.advanceTimersByTime(130);
    strato().remove();
    vi.advanceTimersByTime(2000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
