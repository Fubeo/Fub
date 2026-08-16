// Tutta l'interazione del grafo: puntatore (hover, drag, pan, zoom, click) e
// tastiera (focus nodi, frecce, fit, apertura). Il wiring vive su Pointer
// Events unificati con `setPointerCapture`, così mouse, penna e tocco passano
// da un solo codice.
//
// Il file ha due strati, come il resto del lotto:
// - `nodoIn` e `aggiornaDrag` sono pure: niente DOM, niente Canvas2D — è ciò
//   che i test esercitano (l'hit-test in screen space con scala ≠ 1 era il
//   bug del codice di prima, che confrontava coordinate mondo e schermo
//   senza convertire).
// - `creaInterazione` incolla le pure agli eventi reali del canvas.
//
// I bug dei report chiusi qui:
// - 2-2: `pointerleave` azzera `hovered` e il cursore — l'highlight non
//   resta orfano quando il puntatore esce dal canvas.
// - 2-4 / S5-3: `tabindex=0` + `role="application"` + `aria-label`
//   iniettabile e un percorso tastiera completo (frecce, +/−, F, Invio, Esc,
//   P) — il grafo non è più una superficie solo-mouse.
//
// Niente i18n qui: ogni stringa mostrata all'utente arriva da un parametro
// (`impostaEtichettaA11y`), perché i test non devono conoscere le lingue.

import type { Camera, CameraStato, Punto, BoundMondo } from "./render/camera";
import { schermoInMondo } from "./render/camera";
import type { Struttura } from "./sim/tipi";

export interface AzioniInterazione {
  apri(id: string): void;
  riscalda(livello: number): void;
  richiediRidisegno(): void;
}

export interface OpzioniInterazione {
  canvas: HTMLCanvasElement;
  strutturaRef: () => Struttura;
  cameraStato: CameraStato;
  azioni: AzioniInterazione;
}

export interface Interazione {
  distruggi(): void;
  impostaEtichettaA11y(testo: string): void;
  focusNodo(i: number): void;
  /// Il nodo selezionato da tastiera: l'orchestratore lo incolla in
  /// `StatoDisegno.focalizzato`, così il pittore lo tratta come focus
  /// senza che l'interazione conosca il pittore.
  leggiFocalizzato(): number;
}

/// Hit-test in screen space: il nodo va convertito in coordinate schermo
/// (x·scala + t) prima di misurare la distanza, e la soglia è `r·scala + 6`
/// — 6 px di tolleranza **di schermo**, non di mondo. Senza la scala il
/// hit-test era giusto solo a scala 1 e il click mancava i nodi zoommati.
/// Ritorna l'indice del nodo più vicino entro soglia, −1 se nessuno.
export function nodoIn(s: Struttura, c: Camera, x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < s.n; i++) {
    const dx = s.x[i] * c.scala + c.tx - x;
    const dy = s.y[i] * c.scala + c.ty - y;
    const soglia = s.raggio[i] * c.scala + 6;
    const d2 = dx * dx + dy * dy;
    if (d2 < soglia * soglia && d2 < bestD) {
      best = i;
      bestD = d2;
    }
  }
  return best;
}

/// Lo stato della macchina a stati del puntatore. `pinMappa` (quale `fisso`
/// aveva il nodo prima del drag) vive nel wiring: dipende dalla struttura
/// reale, che la macchina pura non tocca.
export interface StatoDrag {
  hovered: number;
  trascinato: number;
  trascinaVuoto: boolean;
  ultimoX: number;
  ultimoY: number;
}

export function statoDragIniziale(): StatoDrag {
  return { hovered: -1, trascinato: -1, trascinaVuoto: false, ultimoX: 0, ultimoY: 0 };
}

export interface EventoDrag {
  tipo: "down" | "move" | "up" | "leave";
  x: number;
  y: number;
  pulsante: number;
}

export interface EsitoDrag {
  stato: StatoDrag;
  /// Delta di schermo accumulato dal pan a vuoto (da applicare alla camera).
  panDx: number;
  panDy: number;
  /// Nuovo bersaglio mondo del nodo trascinato (da scrivere in px/py).
  bersaglio: Punto | null;
}

/// La macchina a stati del puntatore, pura e testabile da sola. Consuma
/// eventi e produce il prossimo stato più i delta da applicare fuori (camera
/// per il pan, struttura per il drag). Il wiring si occupa solo di eseguirli.
export function aggiornaDrag(
  prev: StatoDrag,
  ev: EventoDrag,
  hit: (x: number, y: number) => number,
  s2m: (x: number, y: number) => Punto,
): EsitoDrag {
  const st: StatoDrag = { ...prev };
  let panDx = 0;
  let panDy = 0;
  let bersaglio: Punto | null = null;
  if (ev.tipo === "down" && st.trascinato < 0 && !st.trascinaVuoto) {
    if (ev.pulsante === 1) {
      // Tasto centrale: pan anche sopra un nodo (il piano §6 lo riserva al
      // pan; il primario sopra un nodo trascina, sopra il vuoto pana).
      st.trascinaVuoto = true;
    } else if (ev.pulsante === 0) {
      const i = hit(ev.x, ev.y);
      if (i >= 0) {
        st.trascinato = i;
        st.hovered = -1;
      } else {
        st.trascinaVuoto = true;
      }
    }
  } else if (ev.tipo === "move") {
    if (st.trascinato >= 0) {
      bersaglio = s2m(ev.x, ev.y);
    } else if (st.trascinaVuoto) {
      panDx = ev.x - st.ultimoX;
      panDy = ev.y - st.ultimoY;
    } else {
      st.hovered = hit(ev.x, ev.y);
    }
  } else if (ev.tipo === "up") {
    if (st.trascinato >= 0) st.trascinato = -1;
    if (st.trascinaVuoto) st.trascinaVuoto = false;
  } else if (ev.tipo === "leave") {
    // Bug 2-2: uscire dal canvas è il segnale canonico «non c'è più nessun
    // nodo sotto». Non tocca il drag: con setPointerCapture il leave non
    // arriva durante un drag, ma se arrivasse non deve spezzarlo. E non
    // aggiorna la base del pan: le coordinate (0,0) del leave sono finte, e
    // spostare lì `ultimoX/Y` farebbe slittare il pan al rientro nel canvas.
    if (st.trascinato < 0 && !st.trascinaVuoto) st.hovered = -1;
    return { stato: st, panDx: 0, panDy: 0, bersaglio: null };
  }
  st.ultimoX = ev.x;
  st.ultimoY = ev.y;
  return { stato: st, panDx, panDy, bersaglio };
}

/// Il nodo più vicino al focalizzato nella direzione (dx, dy) di una freccia:
/// la scelta del «vicino» è il coseno dell'angolo col vettore — il nodo che
/// sta più sulla linea della freccia, non il più vicino in assoluto.
function nodoInDirezione(s: Struttura, i: number, dx: number, dy: number): number {
  let best = -1;
  let bestCos = -Infinity;
  const xf = s.x[i];
  const yf = s.y[i];
  for (let k = 0; k < s.n; k++) {
    if (k === i) continue;
    const vx = s.x[k] - xf;
    const vy = s.y[k] - yf;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) continue;
    const cos = (vx * dx + vy * dy) / len;
    if (cos > bestCos) {
      bestCos = cos;
      best = k;
    }
  }
  return best;
}

/// I versori delle frecce, in una tabella statica: la tastiera è un dominio
/// chiuso, non serve una mappa dinamica.
const DIR_FRECCE: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/// Bounds del mondo occupato dai nodi. Con zero nodi non esistono bounds
/// sensati: un quadrato di comodo evita di mandare `Infinity` dentro
/// `inquadra`, che produrrebbe NaN.
function boundMondo(s: Struttura): BoundMondo {
  if (s.n === 0) return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < s.n; i++) {
    if (s.x[i] < minX) minX = s.x[i];
    if (s.y[i] < minY) minY = s.y[i];
    if (s.x[i] > maxX) maxX = s.x[i];
    if (s.y[i] > maxY) maxY = s.y[i];
  }
  return { minX, minY, maxX, maxY };
}

/// Il drag è un gesto, non un click: oltre 5 px di spostamento il click
/// nativo che segue un drag non deve aprire una nota.
const SOGLIA_CLICK_PX = 5;
/// Prima di aprire su click si aspetta questo tempo: se arriva un dblclick
/// (pin + centra), l'apertura viene cancellata — altrimenti il doppio click
/// su un nodo aprirebbe la nota due volte.
const CLICK_RITARDO_MS = 250;
const PAN_TASTO_PX = 40;
const ZOOM_TASTO = 1.2;

export function creaInterazione(opzioni: OpzioniInterazione): Interazione {
  const { canvas, strutturaRef, cameraStato, azioni } = opzioni;

  const s2m = (x: number, y: number): Punto => schermoInMondo(cameraStato.stato(), { x, y });
  const hit = (x: number, y: number): number => nodoIn(strutturaRef(), cameraStato.stato(), x, y);
  const viewport = (): { w: number; h: number } => {
    const r = canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };
  const locali = (e: { clientX: number; clientY: number }): Punto => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  let stato = statoDragIniziale();
  let focalizzato = -1;
  /// Il `fisso` che aveva il nodo prima del drag: al rilascio torna quello
  /// (un pin esplicito non deve essere mangiato da un trascinamento).
  const pinMappa = new Map<number, number>();
  /// I pointer attualmente giù, per il pinch a due dita. Map perché i
  /// pointer sono chiavi dinamiche (inserzione/rimozione runtime).
  const pointerAttivi = new Map<number, Punto>();
  /// Base del pinch: distanza tra le due dita alla seconda discesa e scala
  /// di partenza. Il fattore di zoom è distanza attuale / distanza base.
  let pinchBase: { distanza: number; medioX: number; medioY: number } | null = null;
  let downX = 0;
  let downY = 0;
  let clickTimeout: ReturnType<typeof setTimeout> | undefined;
  let pendingClick: Punto | null = null;
  let etichettaA11y = "";

  // Superficie tastierabile e annunciabile (bug 2-4 / S5-3): senza questi tre
  // attributi il canvas è invisibile a screen reader e irraggiungibile da
  // tastiera, mentre il resto della shell è presidiato.
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", etichettaA11y);

  // Rilascio della presa corrente: ripristina il `fisso` che il nodo aveva
  // prima del drag (pinMappa), riaccende la sim e pulisce il cursore. La
  // usa `suPointerUp` e il pinch, che smonta il drag del primo dito quando
  // arriva il secondo.
  const rilasciaPresa = (): void => {
    const s = strutturaRef();
    if (stato.trascinato >= 0) {
      const i = stato.trascinato;
      s.fisso[i] = pinMappa.get(i) ?? 0;
      pinMappa.delete(i);
      s.trascinato = -1;
      // Il rilascio lascia il nodo col suo carico di velocità: si scalda la
      // sim perché lo smaltisca, e il drag finito non lascia un nodo
      // appiccicato alla molla.
      azioni.riscalda(0.3);
    } else if (stato.trascinaVuoto) {
      canvas.style.cursor = "default";
    }
  };

  const suPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    const p = locali(e);
    pointerAttivi.set(e.pointerId, p);
    // Secondo dito sul touch: si smonta drag/pan del primo e parte il pinch.
    // Il pinch è zoom sul punto medio delle dita, con fattore pari al
    // rapporto tra distanza attuale e distanza alla discesa del secondo dito.
    if (pointerAttivi.size >= 2) {
      rilasciaPresa();
      stato = statoDragIniziale();
      const pts = [...pointerAttivi.values()];
      pinchBase = {
        distanza: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        medioX: (pts[0].x + pts[1].x) / 2,
        medioY: (pts[0].y + pts[1].y) / 2,
      };
      azioni.richiediRidisegno();
      return;
    }
    const esito = aggiornaDrag(stato, { tipo: "down", x: p.x, y: p.y, pulsante: e.button }, hit, s2m);
    stato = esito.stato;
    // Base per il confronto click/drag: se il pointer si sposta oltre la
    // soglia prima dell'up, il click non scatta.
    downX = p.x;
    downY = p.y;
    if (stato.trascinato >= 0) {
      const i = stato.trascinato;
      pinMappa.set(i, strutturaRef().fisso[i]);
      const s = strutturaRef();
      s.trascinato = i;
      s.fisso[i] = 2;
      const m = s2m(p.x, p.y);
      s.px[i] = m.x;
      s.py[i] = m.y;
      // La molla del puntatore vive nel motore: se la sim è addormentata il
      // nodo non la sentirebbe — la si risveglia.
      azioni.riscalda(0.3);
      if (typeof canvas.setPointerCapture === "function") canvas.setPointerCapture(e.pointerId);
    } else if (stato.trascinaVuoto) {
      canvas.style.cursor = "grabbing";
      if (typeof canvas.setPointerCapture === "function") canvas.setPointerCapture(e.pointerId);
    }
    azioni.richiediRidisegno();
  };

  const suPointerMove = (e: PointerEvent): void => {
    const p = locali(e);
    if (pointerAttivi.has(e.pointerId)) pointerAttivi.set(e.pointerId, p);
    if (pinchBase) {
      // Zoom sul punto medio: il fattore è il rapporto delle distanze, così
      // il pinch scala in modo simmetrico e resta ancorato alle dita.
      const pts = [...pointerAttivi.values()];
      if (pts.length >= 2) {
        const distanza = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        const medioX = (pts[0].x + pts[1].x) / 2;
        const medioY = (pts[0].y + pts[1].y) / 2;
        cameraStato.zoom(distanza / pinchBase.distanza, medioX, medioY);
        pinchBase = { distanza, medioX, medioY };
      }
      azioni.richiediRidisegno();
      return;
    }
    const prima = stato;
    const esito = aggiornaDrag(stato, { tipo: "move", x: p.x, y: p.y, pulsante: 0 }, hit, s2m);
    stato = esito.stato;
    if (stato.trascinato >= 0 && esito.bersaglio) {
      const s = strutturaRef();
      s.px[stato.trascinato] = esito.bersaglio.x;
      s.py[stato.trascinato] = esito.bersaglio.y;
      azioni.riscalda(0.3);
    } else if (stato.trascinaVuoto) {
      if (esito.panDx !== 0 || esito.panDy !== 0) cameraStato.pan(esito.panDx, esito.panDy);
    } else if (stato.hovered !== prima.hovered) {
      canvas.style.cursor = stato.hovered >= 0 ? "pointer" : "default";
    }
    azioni.richiediRidisegno();
  };

  const suPointerUp = (e: PointerEvent): void => {
    const p = locali(e);
    pointerAttivi.delete(e.pointerId);
    if (pointerAttivi.size < 2) pinchBase = null;
    // Prima si rilascia la presa, poi si aggiorna la macchina: `aggiornaDrag`
    // con "up" azzera `trascinato`/`trascinaVuoto` nello stato, e
    // `rilasciaPresa` legge da lì l'indice del nodo da sbloccare.
    const presaAttiva = stato.trascinato >= 0 || stato.trascinaVuoto;
    if (presaAttiva) rilasciaPresa();
    const esito = aggiornaDrag(stato, { tipo: "up", x: p.x, y: p.y, pulsante: e.button }, hit, s2m);
    stato = esito.stato;
    azioni.richiediRidisegno();
  };

  const suPointerLeave = (): void => {
    const prima = stato;
    const esito = aggiornaDrag(stato, { tipo: "leave", x: 0, y: 0, pulsante: 0 }, hit, s2m);
    stato = esito.stato;
    if (stato.hovered !== prima.hovered) {
      canvas.style.cursor = "default";
      azioni.richiediRidisegno();
    }
  };

  const suWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = locali(e);
    const fattore = Math.exp(-e.deltaY * 0.0015);
    cameraStato.zoom(fattore, p.x, p.y);
    azioni.richiediRidisegno();
  };

  const suClick = (e: MouseEvent): void => {
    const p = locali(e);
    if (Math.hypot(p.x - downX, p.y - downY) > SOGLIA_CLICK_PX) return;
    pendingClick = p;
    clearTimeout(clickTimeout);
    clickTimeout = setTimeout(() => {
      const q = pendingClick;
      pendingClick = null;
      if (!q) return;
      const i = nodoIn(strutturaRef(), cameraStato.stato(), q.x, q.y);
      if (i >= 0) {
        // Il click è anche un focus: chi arriva da tastiera dopo un click
        // trova il nodo già focalizzato e può riaprirlo con Invio.
        focalizzato = i;
        azioni.apri(strutturaRef().id[i]);
        azioni.richiediRidisegno();
      }
    }, CLICK_RITARDO_MS);
  };

  const suDoppioClick = (e: MouseEvent): void => {
    clearTimeout(clickTimeout);
    clickTimeout = undefined;
    pendingClick = null;
    const p = locali(e);
    const i = nodoIn(strutturaRef(), cameraStato.stato(), p.x, p.y);
    if (i >= 0) {
      const s = strutturaRef();
      // Pin: doppio click blocca il nodo, un altro lo sblocca. Il pin è un
      // impegno dell'utente, non uno stato del motore: va salvato e
      // rispettato dal drag (pinMappa).
      s.fisso[i] = s.fisso[i] === 1 ? 0 : 1;
      cameraStato.centraSu(s.x[i], s.y[i], 1.6, viewport());
    } else {
      cameraStato.inquadra(boundMondo(strutturaRef()), viewport());
    }
    azioni.richiediRidisegno();
  };

  const suKeyDown = (e: KeyboardEvent): void => {
    const k = e.key;
    if (k in DIR_FRECCE) {
      const [dx, dy] = DIR_FRECCE[k];
      if (focalizzato >= 0) {
        const nuovo = nodoInDirezione(strutturaRef(), focalizzato, dx, dy);
        if (nuovo >= 0) {
          focalizzato = nuovo;
        }
      } else {
        cameraStato.pan(dx * PAN_TASTO_PX, dy * PAN_TASTO_PX);
      }
      e.preventDefault();
      azioni.richiediRidisegno();
    } else if (k === "+" || k === "=") {
      cameraStato.zoom(ZOOM_TASTO, viewport().w / 2, viewport().h / 2);
      e.preventDefault();
      azioni.richiediRidisegno();
    } else if (k === "-") {
      cameraStato.zoom(1 / ZOOM_TASTO, viewport().w / 2, viewport().h / 2);
      e.preventDefault();
      azioni.richiediRidisegno();
    } else if (k === "f" || k === "F") {
      cameraStato.inquadra(boundMondo(strutturaRef()), viewport());
      e.preventDefault();
      azioni.richiediRidisegno();
    } else if (k === "Enter") {
      if (focalizzato >= 0) {
        azioni.apri(strutturaRef().id[focalizzato]);
        azioni.richiediRidisegno();
      }
      e.preventDefault();
    } else if (k === "Escape") {
      if (focalizzato >= 0) {
        focalizzato = -1;
        azioni.richiediRidisegno();
      }
      e.preventDefault();
    } else if (k === "p" || k === "P") {
      if (focalizzato >= 0) {
        const s = strutturaRef();
        s.fisso[focalizzato] = s.fisso[focalizzato] === 1 ? 0 : 1;
        azioni.richiediRidisegno();
      }
      e.preventDefault();
    }
  };

  const suFocus = (): void => {
    // Anello di focus sul canvas stesso: il token --focus-ring se il tema lo
    // definisce, altrimenti l'outline di default del browser. Il token vive
    // su :root, quindi si legge da documentElement.
    const fc = getComputedStyle(document.documentElement).getPropertyValue("--focus-ring").trim();
    if (fc) {
      canvas.style.outline = `2px solid ${fc}`;
      canvas.style.outlineOffset = "1px";
    }
  };

  const suBlur = (): void => {
    canvas.style.outline = "";
    canvas.style.outlineOffset = "";
  };

  const listener = <K extends keyof HTMLElementEventMap>(
    tipo: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    canvas.addEventListener(tipo, fn as EventListener, opts);
  };

  listener("pointerdown", suPointerDown);
  listener("pointermove", suPointerMove);
  listener("pointerup", suPointerUp);
  listener("pointercancel", suPointerUp);
  listener("pointerleave", suPointerLeave);
  listener("wheel", suWheel, { passive: false });
  listener("click", suClick);
  listener("dblclick", suDoppioClick);
  listener("keydown", suKeyDown);
  listener("focus", suFocus);
  listener("blur", suBlur);

  return {
    distruggi() {
      clearTimeout(clickTimeout);
      clickTimeout = undefined;
      // Il canvas appartiene al chiamante: qui si tolgono solo i gestori.
      canvas.removeEventListener("pointerdown", suPointerDown);
      canvas.removeEventListener("pointermove", suPointerMove);
      canvas.removeEventListener("pointerup", suPointerUp);
      canvas.removeEventListener("pointercancel", suPointerUp);
      canvas.removeEventListener("pointerleave", suPointerLeave);
      canvas.removeEventListener("wheel", suWheel);
      canvas.removeEventListener("click", suClick);
      canvas.removeEventListener("dblclick", suDoppioClick);
      canvas.removeEventListener("keydown", suKeyDown);
      canvas.removeEventListener("focus", suFocus);
      canvas.removeEventListener("blur", suBlur);
    },
    impostaEtichettaA11y(testo: string) {
      etichettaA11y = testo;
      canvas.setAttribute("aria-label", testo);
    },
    focusNodo(i: number) {
      focalizzato = i;
      azioni.richiediRidisegno();
    },
    leggiFocalizzato() {
      return focalizzato;
    },
  };
}
