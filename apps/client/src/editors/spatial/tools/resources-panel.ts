// La scheda Risorse dell'ispettore (piano K6, T10; `docs/product/drawing-resources.md`).
// Esiste solo col Disegno completo acceso e aperto: mostra i campioni del
// documento, che K5 già sa leggere, e le sezioni che le famiglie registrano
// (`ispettore/risorse/<sezione>`, `completo/sezioni.ts`). Le stesse sezioni
// del registro che stanno nella scheda Design le disegna la stessa lista
// (`createSezioniList`), che sta qui perché è la sola che le sa montare.
//
// - **Una sezione si disegna da sé.** Ogni sezione ha il suo corpo; `disegna`
//   lo riempie e torna il disposer. Ogni giro (la selezione cambia, il
//   disegno cambia, il registro si allarga) chiude la vita del giro vecchio e
//   ne apre una nuova: una risposta che arriva dopo si scarta.
// - **Al più un giro per fotogramma.** Chi chiede un aggiornamento mentre un
//   giro è in attesa non ne fa un altro.
// - **Un errore non ferma le altre.** Una sezione che sbaglia dice che non si
//   è aperta, con «Riprova»; le altre restano com'erano.
// - **Lo stesso DOM dell'ispettore.** Le sezioni hanno le classi di
//   `properties.ts` (`draw-properties-section`, `-toggle`, `-body`), così il
//   tema e le foto le trattano allo stesso modo.

import { textButton } from "../../../kit";
import { iconEl } from "../../../ui/icons";
import { identifier } from "../../../ui/a11y";
import { openLifetime, type Lifetime, type Teardown } from "../../../ui/lifetime";
import type { ContestoSezione, Selezione, Sezione, Sezioni } from "../completo/sezioni";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { DocumentModel } from "../scene/model";
import { t } from "../strings";
import { resourcesOf } from "./resources";

/// Il pannello Risorse, come lo monta l'editor nella sua scheda.
export interface PannelloRisorse {
  /// La sezione `draw-properties` della scheda.
  readonly element: HTMLElement;
  /// Il Completo si apre (le sue sezioni arrivano) o si chiude (`null`).
  collega(sezioni: Sezioni | null, motore: MotoreDelDisegno | null): void;
  /// Il disegno o la selezione sono cambiati: si rifà, al più una volta per
  /// fotogramma.
  aggiorna(): void;
  /// Porta in vista la sezione `id` della scheda e le dà il fuoco (la voce
  /// «Pannelli ›» del menu). Falso se la sezione non c'è adesso.
  focusSection(id: string): boolean;
  /// Smonta le sezioni e i loro ascolti.
  dispose(): void;
}

export interface OpzioniPannelloRisorse {
  /// Il modello del disegno aperto, per i campioni del documento.
  readonly modello: () => DocumentModel | null;
  /// La selezione di adesso.
  readonly selezione: () => Selezione;
}

/// Una lista di sezioni montata dentro un contenitore: le sezioni che si
/// disegnano da sé, con il loro giro e il loro errore.
export interface SezioniList {
  /// Chiede un giro: al più uno per fotogramma.
  aggiorna(): void;
  /// Porta in vista la sezione `id` (la apre, se è chiusa) e le dà il fuoco.
  /// Falso se la sezione non c'è adesso.
  porta(id: string): boolean;
  /// Smonta tutte le sezioni e chiama i loro disposer.
  dispose(): void;
}

export interface OpzioniSezioniList {
  /// Le sezioni da mostrare, nell'ordine in cui stanno.
  readonly elenco: () => readonly Sezione[];
  /// La selezione di adesso: la sezione con `quando` la vede o no.
  readonly selezione: () => Selezione;
  /// Il motore del disegno, per i comandi delle sezioni.
  readonly motore: () => MotoreDelDisegno | null;
}

/// Una sezione montata: il suo elemento, il giro che la disegna e ciò che
/// serve a rifarla.
interface Montata {
  readonly sezione: Sezione;
  readonly root: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly body: HTMLElement;
  readonly errore: HTMLElement;
  readonly riprova: HTMLButtonElement;
  readonly corpo: HTMLElement;
  /// La vita della sezione: si chiude quando la sezione si smonta.
  readonly vita: Lifetime;
  /// Il disposer del giro in corso, se la sezione ne ha uno.
  fine: Teardown | null;
  /// La vita del giro in corso; `null` se non ce n'è uno.
  giro: Lifetime | null;
}

/// I campioni del documento, nell'ordine in cui stanno nel disegno: una
/// risorsa con `details.swatch` (`scene/classify/facts.ts`).
export function campioniDel(modello: DocumentModel): Array<{ readonly id: string; readonly name: string; readonly color: string }> {
  const out: Array<{ readonly id: string; readonly name: string; readonly color: string }> = [];
  for (const [id, leaf] of resourcesOf(modello)) {
    const swatch = leaf.details?.swatch;
    if (swatch !== undefined) out.push({ id, name: swatch.name, color: swatch.color });
  }
  return out;
}

/// La sezione dei campioni del documento: il solo gruppo che c'è adesso.
function sezioneCampioni(modello: () => DocumentModel | null): Sezione {
  return {
    id: "documento",
    scheda: "risorse",
    titolo: t("draw.resources.swatches"),
    ordine: 0,
    disegna({ corpo }) {
      const documento = modello();
      const campioni = documento === null ? [] : campioniDel(documento);
      const nota = document.createElement("p");
      nota.className = "draw-properties-note";
      nota.dataset.column = "all";
      nota.textContent = campioni.length === 0 ? t("draw.resources.swatches.none") : t("draw.resources.count", { count: campioni.length });
      corpo.append(nota);
      if (campioni.length === 0) return;
      const gruppo = document.createElement("div");
      gruppo.className = "kit-color-group";
      const titolo = document.createElement("div");
      titolo.className = "kit-color-group-title";
      titolo.id = identifier("kit-color-group");
      titolo.textContent = t("draw.resources.swatches.document");
      const fila = document.createElement("div");
      fila.className = "kit-color-swatches";
      fila.setAttribute("role", "group");
      fila.setAttribute("aria-labelledby", titolo.id);
      for (const campione of campioni) {
        const voce = document.createElement("span");
        voce.className = "kit-color-swatch";
        voce.setAttribute("role", "img");
        voce.setAttribute("aria-label", campione.name);
        voce.title = campione.name;
        const chip = document.createElement("span");
        chip.className = "kit-color-chip";
        chip.style.backgroundColor = campione.color;
        voce.append(chip);
        fila.append(voce);
      }
      gruppo.append(titolo, fila);
      // Il contenitore dei campioni: la colonna del colore del kit, senza la
      // sua larghezza fissa (`draw-resources-swatches` nella pelle).
      const contenitore = document.createElement("div");
      contenitore.className = "draw-resources-swatches";
      contenitore.append(gruppo);
      corpo.append(contenitore);
    },
  };
}

/// Monta una lista di sezioni dentro `host`, che la lista riempie da sola: le
/// sezioni che la selezione vuole, nell'ordine di `elenco`.
export function createSezioniList(host: HTMLElement, life: Lifetime, opzioni: OpzioniSezioniList): SezioniList {
  const montate = new Map<Sezione, Montata>();
  /// Un giro è in attesa del suo fotogramma, e il suo numero per annullarlo.
  let pendente = false;
  let frame = 0;
  let closed = false;

  function crea(sezione: Sezione): Montata {
    const root = document.createElement("div");
    root.className = "draw-properties-section";
    root.dataset.section = sezione.id;
    root.setAttribute("role", "group");
    const heading = document.createElement("h3");
    heading.className = "draw-properties-heading";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "draw-properties-toggle";
    toggle.id = identifier("draw-resources-section");
    toggle.setAttribute("aria-expanded", "true");
    const text = document.createElement("span");
    text.className = "draw-properties-toggle-text";
    text.textContent = sezione.titolo;
    toggle.append(text);
    const chevron = iconEl("draw-section");
    if (chevron !== null) toggle.append(chevron);
    heading.append(toggle);
    const body = document.createElement("div");
    body.className = "draw-properties-body";
    body.id = identifier("draw-resources-body");
    toggle.setAttribute("aria-controls", body.id);
    root.setAttribute("aria-labelledby", toggle.id);
    const errore = document.createElement("p");
    errore.className = "draw-properties-error";
    errore.hidden = true;
    // La vita della sezione: finisce quando la sezione si smonta, e con lei
    // i suoi ascolti (il pulsante «Riprova» e l'apertura).
    const vita = openLifetime();
    const riprova = textButton({ label: t("draw.resources.retry"), onPress: () => disegna(m), lifetime: vita });
    riprova.classList.add("draw-resources-retry");
    riprova.hidden = true;
    const corpo = document.createElement("div");
    corpo.className = "draw-resources-corpo";
    body.append(errore, riprova, corpo);
    root.append(heading, body);
    const m: Montata = { sezione, root, toggle, body, errore, riprova, corpo, vita, fine: null, giro: null };
    vita.listen(toggle, "click", () => {
      const aperta = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(aperta));
      body.hidden = !aperta;
    });
    return m;
  }

  /// Chiude il giro in corso: il disposer della sezione e la sua vita.
  function chiudi(m: Montata): void {
    const fine = m.fine;
    const giro = m.giro;
    m.fine = null;
    m.giro = null;
    fine?.();
    giro?.close();
  }

  /// Smonta una sezione: il suo giro, i suoi ascolti, il suo elemento.
  function butta(m: Montata): void {
    chiudi(m);
    m.vita.close();
    m.root.remove();
  }

  /// Un giro nuovo di una sezione: il suo corpo, o l'errore con «Riprova».
  function disegna(m: Montata): void {
    chiudi(m);
    m.corpo.replaceChildren();
    m.errore.hidden = true;
    m.riprova.hidden = true;
    const giro = openLifetime();
    m.giro = giro;
    const ctx: ContestoSezione = {
      corpo: m.corpo,
      sel: opzioni.selezione(),
      motore: opzioni.motore(),
      aggiorna: () => pianifica(),
      vita: giro,
    };
    try {
      const fine = m.sezione.disegna(ctx);
      m.fine = typeof fine === "function" ? fine : null;
    } catch {
      chiudi(m);
      m.errore.textContent = t("draw.resources.failed");
      m.errore.hidden = false;
      m.riprova.hidden = false;
    }
  }

  /// Porta le sezioni montate a quelle di adesso: monta le nuove, smonta le
  /// uscite, rifà le altre.
  function rifai(): void {
    if (closed) return;
    const sel = opzioni.selezione();
    const visibili = opzioni.elenco().filter((sezione) => sezione.quando?.(sel) ?? true);
    // Una sezione montata che non è più fra le visibili (la selezione non la
    // vuole più) si smonta; le altre si rifanno. Le sezioni si cercano per
    // oggetto, non per id: un id di famiglia può coincidere con quello di
    // una sezione integrata, e restano due sezioni.
    for (const [sezione, m] of montate) {
      if (visibili.includes(sezione)) continue;
      butta(m);
      montate.delete(sezione);
    }
    const nuove = visibili.map((sezione) => {
      let m = montate.get(sezione);
      if (m === undefined) {
        m = crea(sezione);
        montate.set(sezione, m);
      }
      return m;
    });
    // L'ordine nel contenitore è quello di `visibili`.
    host.replaceChildren(...nuove.map((m) => m.root));
    for (const m of nuove) disegna(m);
  }

  /// Un solo giro per fotogramma, anche se la selezione cambia in fretta: una
  /// richiesta che arriva mentre un giro aspetta il suo fotogramma non ne fa un
  /// altro.
  function pianifica(): void {
    if (closed || pendente) return;
    pendente = true;
    const esegui = (): void => {
      pendente = false;
      frame = 0;
      rifai();
    };
    if (typeof requestAnimationFrame !== "function") {
      esegui();
      return;
    }
    frame = requestAnimationFrame(esegui);
  }

  function smonta(): void {
    if (pendente && frame !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    pendente = false;
    frame = 0;
    for (const m of montate.values()) butta(m);
    montate.clear();
  }

  pianifica();
  life.add(() => {
    closed = true;
    smonta();
  });

  return {
    aggiorna: pianifica,
    porta(id) {
      const m = [...montate.values()].find((each) => each.sezione.id === id);
      if (m === undefined) return false;
      m.toggle.setAttribute("aria-expanded", "true");
      m.body.hidden = false;
      m.root.scrollIntoView?.({ block: "nearest" });
      m.toggle.focus({ preventScroll: true });
      return true;
    },
    dispose() {
      closed = true;
      smonta();
    },
  };
}

/// Il pannello Risorse per un editor: la sezione dei campioni del documento,
/// e sotto le sezioni del registro del Completo, nell'ordine della mappa.
export function createResourcesPanel(life: Lifetime, opzioni: OpzioniPannelloRisorse): PannelloRisorse {
  const element = document.createElement("section");
  element.className = "draw-properties draw-resources";
  element.id = identifier("draw-resources");
  element.tabIndex = -1;
  element.setAttribute("aria-label", t("draw.resources.aria"));
  const scroller = document.createElement("div");
  scroller.className = "draw-properties-scroll";
  element.append(scroller);

  const campioni = sezioneCampioni(opzioni.modello);
  let sezioni: Sezioni | null = null;
  let motore: MotoreDelDisegno | null = null;
  let stopRegistro: Teardown | null = null;
  let closed = false;
  const lista = createSezioniList(scroller, life, {
    elenco: () => [campioni, ...(sezioni?.di("risorse") ?? [])],
    selezione: opzioni.selezione,
    motore: () => motore,
  });

  life.add(() => {
    closed = true;
    stopRegistro?.();
    stopRegistro = null;
  });

  return {
    element,
    collega(nuovi, nuovo) {
      if (closed) return;
      stopRegistro?.();
      stopRegistro = null;
      sezioni = nuovi;
      motore = nuovo;
      if (nuovi !== null) stopRegistro = nuovi.ascolta(() => lista.aggiorna());
      lista.aggiorna();
    },
    aggiorna() {
      lista.aggiorna();
    },
    focusSection(id) {
      return lista.porta(id);
    },
    dispose() {
      closed = true;
      stopRegistro?.();
      stopRegistro = null;
      lista.dispose();
    },
  };
}
