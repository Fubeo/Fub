// L'adattatore del browser per l'inchiostro: dagli eventi del puntatore al
// ciclo di vita dei tratti.
//
// Si attacca a un elemento, trasforma ogni `PointerEvent` in un `PointerSample`
// (le coordinate nella scena, l'angolo e la scala della vista) e lo passa alla
// `Session` di `../input/session`, che decide tutto: ruoli, doppioni,
// coalescenti, predizione, limite dei campioni, annullamenti. L'adattatore fa
// soltanto ciò che è del DOM: ascolta gli eventi, cattura e rilascia il
// puntatore, e consegna gli effetti della sessione ai gestori di chi disegna.
// Non disegna e non conosce strumenti né camera: le coordinate arrivano da
// `toScene`, che la camera fornisce.
//
// Le regole del tratto stanno nella sessione e nella sua copia Rust
// (`crates/fub-ink`); qui restano quelle della piattaforma:
//
// - **Subito.** Gli effetti di un evento si consegnano dentro il gestore
//   dell'evento, mai al fotogramma dopo.
// - **Un ridisegno per evento.** Un movimento può dare campioni e predizione,
//   due callback per lo stesso tratto. `onSettled` arriva una volta, dopo
//   l'ultima, se il tratto è ancora aperto: è lì che chi disegna rifà
//   l'anteprima, invece che a ogni callback.
// - **Fermo sullo schermo, fermo nella scena.** Un evento nello stesso punto
//   dello schermo dell'ultimo evento vero dello stesso puntatore riprende il
//   suo punto nella scena. Se intanto la vista si è mossa, alzarsi senza
//   muoversi non aggiunge un tratto che il puntatore non ha fatto.
// - **Gli eventi, in cattura.** Gli ascoltatori sono in fase di cattura, così
//   ruoli e stato sono già aggiornati quando gli ascoltatori della camera, in
//   bolla sullo stesso elemento, li leggono. Il `pointerup` e il
//   `pointercancel` si ascoltano sul documento: arrivano anche se la cattura non
//   è riuscita e il puntatore si è alzato fuori dalla superficie.
// - **La cattura è una richiesta.** La sessione chiede di catturare e di
//   rilasciare il puntatore; un puntatore che il motore non considera attivo
//   non si cattura, e il tratto prosegue con gli eventi che arrivano.
// - **Le callback rientrano.** Chi riceve un effetto può chiamare `cancel` o
//   `destroy`: la sessione ha già deciso tutti gli effetti di quell'evento, ma
//   quelli che restano non si consegnano più, e un tratto annunciato che non
//   ha avuto né fine né annullamento si annulla (ogni `onStart` ha il suo
//   `onEnd` o `onCancel`, sempre). Una callback che lancia non ferma la
//   consegna del resto: l'errore risale dopo l'ultimo effetto.
//
// L'elemento deve avere `touch-action: none` (altrimenti il browser si prende
// il dito per scorrere e manda `pointercancel`) e `user-select: none`: sono
// regole di presentazione e le mette la superficie.

import { openLifetime } from "../../ui/lifetime";
import type { Lifetime } from "../../ui/lifetime";
import type { InkSample } from "../sample";
import { pointerTypeOf, type PointerSample } from "../input/pointer";
import type { PointerRole, TouchPolicy } from "../input/roles";
import {
  Session,
  type CancelReason,
  type Effect,
  type FinishedStroke,
  type PressureMap,
  type StrokeStart,
} from "../input/session";
import type { StabilizerConfig } from "../input/stabilizer";

/// Un punto della scena, in unità locali del tratto.
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

export interface InkInputOptions {
  /// Da coordinate del client a coordinate della scena. La fornisce la camera
  /// e si chiama per ogni campione, così un cambio di vista vale da subito.
  readonly toScene: (clientX: number, clientY: number) => ScenePoint;
  readonly onStart: (stroke: StrokeStart) => void;
  /// Campioni nuovi del tratto, nell'ordine, da aggiungere a quelli già dati.
  readonly onSamples: (id: number, samples: readonly InkSample[]) => void;
  /// La predizione corrente: sostituisce la precedente; vuota la cancella.
  /// Senza, gli eventi predetti non si raccolgono.
  readonly onPredicted?: (id: number, samples: readonly InkSample[]) => void;
  /// Gli effetti di un evento sono consegnati e il tratto `id`, ancora aperto,
  /// ha avuto campioni o predizione: il momento di ridisegnarlo, una volta per
  /// evento. Non arriva dopo `onEnd` né `onCancel`, né se una callback ha
  /// interrotto la consegna.
  readonly onSettled?: (id: number) => void;
  readonly onEnd: (stroke: FinishedStroke) => void;
  /// Il tratto non esiste più: l'anteprima si cancella, niente si scrive.
  readonly onCancel: (id: number, reason: CancelReason) => void;
  /// Che cosa fa un dito quando nessuna penna è vicina (default `auto`).
  readonly touch?: TouchPolicy;
  /// Campioni per tratto prima di dividerlo (default `INK_MAX_SAMPLES`).
  readonly maxSamples?: number;
  /// La curva della pressione: dalla pressione della penna, 0…1, a quella del
  /// tratto. Si legge a ogni campione. Senza, la pressione è com'è.
  readonly pressure?: PressureMap;
  /// L'angolo della vista, in gradi in senso orario. Si legge a ogni evento.
  /// Senza, 0.
  readonly turn?: () => number;
  /// I pixel dello schermo per unità della scena. Si legge a ogni evento e
  /// serve alla corda dello stabilizzatore. Senza, 1.
  readonly scale?: () => number;
  /// Lo stabilizzatore dei tratti che cominciano da adesso. Si legge a ogni
  /// `pointerdown`. Senza, spento.
  readonly stabilizer?: () => StabilizerConfig;
}

export interface InkInput {
  /// Il ruolo di un puntatore giù su questa superficie, `null` se non c'è.
  /// Può cambiare mentre il puntatore è giù: un dito diventa palmo quando
  /// arriva la penna, un dito che disegnava diventa navigazione quando se ne
  /// appoggia un secondo.
  roleOf(pointerId: number): PointerRole | null;
  /// Su questa superficie si è vista una penna.
  readonly penSeen: boolean;
  /// Un tratto è in corso.
  readonly drawing: boolean;
  setTouchPolicy(policy: TouchPolicy): void;
  /// Annulla il tratto in corso (`reason: "api"`); il puntatore smette di
  /// disegnare finché non si alza.
  cancel(): void;
  /// Annulla il tratto in corso e toglie ogni ascoltatore. Idempotente.
  destroy(): void;
}

/// Attacca l'adattatore a `element`. Vive finché `owner` non si chiude o finché
/// non si chiama `destroy`. Lancia `RangeError` se `maxSamples` non è un intero
/// in 2…`INK_MAX_SAMPLES`.
export function attachInkInput(element: HTMLElement, options: InkInputOptions, owner: Lifetime): InkInput {
  const session = new Session({
    ...(options.touch === undefined ? {} : { touch: options.touch }),
    ...(options.maxSamples === undefined ? {} : { maxSamples: options.maxSamples }),
    curve: options.pressure ?? null,
  });
  const life = openLifetime();
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  let destroyed = false;
  /// Il tratto che chi disegna ha ricevuto con `onStart` e a cui non ha ancora
  /// dato fine né annullamento.
  let open: number | null = null;
  /// Quante consegne sono in corso (le callback rientrano) e a che punto è la
  /// generazione: un'interruzione dentro una consegna la fa avanzare, e gli
  /// effetti ancora da consegnare di quelle precedenti non valgono più.
  let depth = 0;
  let generation = 0;

  /// Il campione di un evento senza le coordinate della scena: per un puntatore
  /// che non disegna, di cui la sessione non guarda dove sta.
  function bare(event: PointerEvent): PointerSample {
    return sampleOf(event, Number.NaN, Number.NaN, 0, 1);
  }

  function sampleOf(event: PointerEvent, x: number, y: number, turn: number, scale: number): PointerSample {
    return {
      pointerId: event.pointerId,
      pointerType: pointerTypeOf(event.pointerType),
      x,
      y,
      timeStamp: event.timeStamp,
      pressure: event.pressure,
      tiltX: event.tiltX,
      tiltY: event.tiltY,
      altitudeAngle: event.altitudeAngle,
      azimuthAngle: event.azimuthAngle,
      twist: event.twist ?? 0,
      buttons: event.buttons,
      button: event.button,
      turn,
      scale,
    };
  }

  /// Dov'era, sullo schermo e nella scena, l'ultimo evento vero di ogni
  /// puntatore giù.
  const seen = new Map<number, { readonly clientX: number; readonly clientY: number; readonly x: number; readonly y: number }>();

  /// Il campione di un evento, con la vista letta una volta per evento. Un
  /// puntatore fermo sullo schermo resta dov'era nella scena anche se intanto
  /// la vista si è mossa: alzarlo senza muoverlo non aggiunge un tratto che non
  /// ha fatto. Una predizione (`real` falso) non conta come ultimo evento.
  function pointerOf(event: PointerEvent, turn: number, scale: number, real = true): PointerSample {
    const last = seen.get(event.pointerId);
    const point = last !== undefined && last.clientX === event.clientX && last.clientY === event.clientY
      ? last
      : options.toScene(event.clientX, event.clientY);
    if (real) seen.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY, x: point.x, y: point.y });
    return sampleOf(event, point.x, point.y, turn, scale);
  }

  function capture(pointerId: number): void {
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // Un puntatore che il motore non considera attivo non si cattura: il
      // tratto prosegue con gli eventi che arrivano, e `pointerup` si ascolta
      // sul documento apposta.
    }
  }

  function release(pointerId: number): void {
    try {
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      // Già rilasciata: è l'esito voluto.
    }
  }

  /// Consegna un effetto a chi lo aspetta.
  function deliver(effect: Effect): void {
    switch (effect.fx) {
      case "capture":
        capture(effect.pointer);
        return;
      case "release":
        release(effect.pointer);
        return;
      case "start":
        open = effect.id;
        options.onStart({
          id: effect.id,
          pointerType: effect.pointerType,
          pressure: effect.pressure,
          timeStamp: effect.timeStamp,
          continued: effect.continued,
        });
        return;
      case "samples":
        if (effect.id === open) options.onSamples(effect.id, effect.samples);
        return;
      case "predicted":
        if (effect.id === open) options.onPredicted?.(effect.id, effect.samples);
        return;
      case "end":
        if (effect.id !== open) return;
        open = null;
        options.onEnd({
          id: effect.id,
          pointerType: effect.pointerType,
          pressure: effect.pressure,
          timeStamp: effect.timeStamp,
          continued: effect.continued,
          samples: effect.samples,
          tilt: effect.tilt,
          split: effect.split,
        });
        return;
      case "cancel":
        // Un tratto che chi disegna non ha mai visto non ha da essere annullato.
        if (effect.id !== open) return;
        open = null;
        options.onCancel(effect.id, effect.reason);
        return;
    }
  }

  /// Consegna gli effetti nell'ordine, poi `onSettled` al tratto aperto che ha
  /// avuto campioni o predizione. Se una callback interrompe (`cancel`,
  /// `destroy`), gli effetti che restano non valgono più, salvo i rilasci della
  /// cattura, che sono sempre dovuti. Se una callback lancia, si consegna il
  /// resto e l'errore risale in fondo.
  function run(effects: readonly Effect[]): void {
    if (effects.length === 0) return;
    const mine = generation;
    let failed = false;
    let failure: unknown;
    let touched: number | null = null;
    depth++;
    try {
      for (const effect of effects) {
        if (mine !== generation && effect.fx !== "release") continue;
        if ((effect.fx === "samples" || effect.fx === "predicted") && effect.id === open) touched = effect.id;
        try {
          deliver(effect);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      }
      if (touched !== null && touched === open && mine === generation && options.onSettled !== undefined) {
        try {
          options.onSettled(touched);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      }
    } finally {
      depth--;
    }
    if (failed) throw failure;
  }

  /// Un'interruzione (di chi disegna o della piattaforma): consegna gli effetti
  /// della sessione e annulla il tratto che chi disegna ha ancora aperto e la
  /// sessione non conosce più, come quello che stava per cominciare la
  /// continuazione di un tratto diviso.
  function interrupt(effects: readonly Effect[], reason: CancelReason): void {
    if (depth > 0) generation++;
    try {
      run(effects);
    } finally {
      const id = open;
      if (id !== null) {
        open = null;
        options.onCancel(id, reason);
      }
    }
  }

  life.listen(element, "pointerdown", (event) => {
    if (options.stabilizer) session.setStabilizer(options.stabilizer());
    // Un contatto nuovo si porta nella scena con la vista di adesso.
    seen.delete(event.pointerId);
    run(session.pointerDown(pointerOf(event, options.turn?.() ?? 0, options.scale?.() ?? 1)));
  }, { capture: true });

  life.listen(element, "pointermove", (event) => {
    // Un puntatore che non disegna non ha niente da raccogliere; solo la penna
    // conta lo stesso, perché la sua vicinanza cambia il ruolo delle dita.
    if (!session.tracks(event.pointerId)) {
      if (event.pointerType === "pen") run(session.pointerMove([], bare(event), []));
      return;
    }
    const turn = options.turn?.() ?? 0;
    const scale = options.scale?.() ?? 1;
    const coalesced = typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents().map((one) => pointerOf(one, turn, scale))
      : [];
    const predicted = options.onPredicted !== undefined && typeof event.getPredictedEvents === "function"
      ? event.getPredictedEvents().map((one) => pointerOf(one, turn, scale, false))
      : [];
    run(session.pointerMove(coalesced, pointerOf(event, turn, scale), predicted));
  }, { capture: true });

  // Sul documento, in cattura: il `pointerup` arriva anche se la cattura non è
  // riuscita e il puntatore si è alzato fuori dalla superficie.
  life.listen(doc, "pointerup", (event) => {
    const sample = session.tracks(event.pointerId)
      ? pointerOf(event, options.turn?.() ?? 0, options.scale?.() ?? 1)
      : bare(event);
    seen.delete(event.pointerId);
    run(session.pointerUp(sample));
  }, { capture: true });

  life.listen(doc, "pointercancel", (event) => {
    seen.delete(event.pointerId);
    run(session.pointerCancel(event.pointerId));
  }, { capture: true });

  life.listen(element, "lostpointercapture", (event) => {
    run(session.lostCapture(event.pointerId));
  });

  // `pointerleave` non risale: senza cattura arriva solo quando il puntatore
  // lascia l'elemento, non i suoi figli. Una penna lo manda anche quando esce
  // dal raggio di hover.
  life.listen(element, "pointerleave", (event) => {
    session.pointerLeave(event.pointerId, pointerTypeOf(event.pointerType));
  });

  if (view) life.listen(view, "blur", () => interrupt(session.interrupt("blur"), "blur"));
  life.listen(doc, "visibilitychange", () => {
    if (doc.visibilityState === "hidden") interrupt(session.interrupt("hidden"), "hidden");
  });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    life.close();
    interrupt(session.destroy(), "destroy");
  }
  owner.add(destroy);

  return {
    roleOf: (pointerId) => session.roleOf(pointerId),
    get penSeen() {
      return session.penSeen;
    },
    get drawing() {
      return session.drawing;
    },
    setTouchPolicy(policy) {
      session.setTouchPolicy(policy);
    },
    cancel() {
      if (!destroyed) interrupt(session.cancel(), "api");
    },
    destroy,
  };
}
