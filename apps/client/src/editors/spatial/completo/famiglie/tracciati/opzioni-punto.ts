// La fila dei punti scelti (piano K6, T12; `docs/product/drawing-pen.md`):
// con la Selezione diretta o il Punto di ancoraggio, la riga delle opzioni
// dice che cosa si fa coi punti scelti, come il pezzo `opzioni-punto` del
// prototipo (`PLAN-ui/disegno-completo.html`).
//
// - **Converti**: angolo o morbido (`path.convertAnchors`, `to`);
// - **Punto**: taglia il tracciato nel punto (`path.cutAtAnchors`), unisci
//   i due punti finali (`path.join`), elimina il punto (`path.removeAnchors`);
// - **Posizione del punto**: X e Y del punto scelto. Con un punto solo si
//   scrivono, e il punto va lì (`path.moveAnchor`, il tracciato nominato con
//   `element` e il numero del punto, in coordinate della scena); con più punti
//   o nessuno restano in sola lettura, e il campo dice perché.
//
// I punti vengono dallo stato dello strumento (`DrawingToolState.anchors`) e
// vanno al motore nel `value` del comando (`anchors`), che li controlla sulla
// copia: un punto che non c'è più è `stale`. Dopo un comando lo stato si
// rilegge (`comandoDellaFila`), quindi la posizione mostrata segue il punto. Un pulsante che adesso non vale
// resta raggiungibile (`aria-disabled`) e dice perché, nel suggerimento e,
// premuto, a chi ascolta.

import type { DrawingAnchor, DrawingToolState } from "../../../../../host/contract";
import { onLanguage, languageCurrent } from "../../../../../i18n/strings";
import { numberField, type NumberField } from "../../../../../kit/number-field";
import type { Lifetime } from "../../../../../ui/lifetime";
import { iconEl } from "../../../../../ui/icons";
import { problemaDelNumero, type AzioniFila, type Etichette, type FilaOpzioni } from "../../opzioni";

/// I comandi del motore sui punti scelti.
export const COMANDI_PUNTI = {
  converti: "path.convertAnchors",
  taglia: "path.cutAtAnchors",
  unisci: "path.join",
  elimina: "path.removeAnchors",
  sposta: "path.moveAnchor",
} as const;

/// Le priorità dei tre pezzi nella riga delle opzioni, come nel prototipo
/// (`data-proto-priorita`): la posizione va per prima in «…».
const PRIORITA = { converti: 3, punto: 2, posizione: 1 } as const;

/// Perché un pulsante della fila non vale adesso: nessun punto scelto, o per
/// unire non due punti finali. `null` se vale.
export type PerchePunto = "serve_punto" | "serve_estremi" | null;

/// Le regole della fila, senza DOM: che cosa vale con i punti `punti`.
export function regolePunti(punti: readonly DrawingAnchor[]): {
  readonly converti: PerchePunto;
  readonly taglia: PerchePunto;
  readonly unisci: PerchePunto;
  readonly elimina: PerchePunto;
  /// La posizione mostrata: quella del punto, se ne è scelto uno solo.
  readonly posizione: readonly [number, number] | null;
} {
  const nessuno: PerchePunto = punti.length === 0 ? "serve_punto" : null;
  const estremi = punti.length === 2 && punti.every((p) => p.end);
  return {
    converti: nessuno,
    taglia: nessuno,
    unisci: nessuno ?? (estremi ? null : "serve_estremi"),
    elimina: nessuno,
    posizione: punti.length === 1 ? [punti[0]!.at[0], punti[0]!.at[1]] : null,
  };
}

/// I punti di uno stato dello strumento: una lista ben fatta, o niente.
function puntiDi(stato: DrawingToolState | null): readonly DrawingAnchor[] {
  const punti = stato?.anchors;
  return Array.isArray(punti) ? punti : [];
}

/// La fila dei punti scelti con le parole `testi` della famiglia. Vive quanto
/// `vita`; `aggiorna` la rifà con i punti dello stato nuovo, e la fila resta
/// (spenta, col suo perché) anche senza punti scelti.
export function filaPunti(testi: Etichette, stato: DrawingToolState | null, azioni: AzioniFila, vita: Lifetime): FilaOpzioni | null {
  if (vita.closed) return null;
  const parola = (chiave: string): string => {
    const voce = testi[chiave];
    if (voce === undefined) return chiave;
    return languageCurrent().startsWith("en") ? voce.en : voce.it;
  };
  let punti = puntiDi(stato);

  interface Pulsante {
    readonly control: HTMLButtonElement;
    readonly nome: string;
    readonly titolo: string;
    perche: PerchePunto;
  }
  const pulsanti: Pulsante[] = [];

  /// Un pulsante della fila: l'icona del prototipo, il nome e il suo titolo.
  const pulsante = (parent: HTMLElement, nome: string, titolo: string, icona: string, run: () => void): Pulsante => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button kit-bar-button";
    control.tabIndex = -1;
    const svg = iconEl(icona);
    if (svg !== null) control.append(svg);
    const voce: Pulsante = { control, nome, titolo, perche: null };
    vita.listen(control, "click", () => {
      if (voce.perche !== null) {
        azioni.annuncia(`${parola(nome)}: ${parola(`punto.${voce.perche}`)}`);
        return;
      }
      run();
    });
    parent.append(control);
    pulsanti.push(voce);
    return voce;
  };

  const gruppo = (classe: string, ruolo: string, nome: string): HTMLDivElement => {
    const el = document.createElement("div");
    el.className = `draw-group kit-bar-group${classe === "" ? "" : ` ${classe}`}`;
    el.setAttribute("role", ruolo);
    el.dataset.nome = nome;
    return el;
  };

  // Converti: angolo o morbido. Il motore non dice com'è il punto scelto, quindi
  // sono due comandi, non una scelta con uno acceso.
  const converti = gruppo("", "group", "punto.converti");
  const comandoConverti = (to: "corner" | "smooth", nome: string) => () =>
    azioni.esegui(COMANDI_PUNTI.converti, { to, anchors: [...punti] }, parola(nome));
  const angolo = pulsante(converti, "punto.angolo", "punto.angolo.titolo", "draw-point-corner", comandoConverti("corner", "punto.angolo.titolo"));
  const morbido = pulsante(converti, "punto.morbido", "punto.morbido.titolo", "draw-point-smooth", comandoConverti("smooth", "punto.morbido.titolo"));

  // Punto: taglia, unisci, elimina.
  const punto = gruppo("", "group", "punto.gruppo");
  const taglia = pulsante(punto, "punto.taglia", "punto.taglia", "draw-point-cut", () =>
    azioni.esegui(COMANDI_PUNTI.taglia, { anchors: [...punti] }, parola("punto.taglia")),
  );
  const unisci = pulsante(punto, "punto.unisci", "punto.unisci", "draw-point-join", () =>
    azioni.esegui(COMANDI_PUNTI.unisci, { anchors: [...punti] }, parola("punto.unisci")),
  );
  const elimina = pulsante(punto, "punto.elimina", "punto.elimina", "draw-point-delete", () =>
    azioni.esegui(COMANDI_PUNTI.elimina, { anchors: [...punti] }, parola("punto.elimina")),
  );

  // La posizione del punto: si scrive con un punto solo.
  const posizione = gruppo("draw-point-place", "group", "punto.posizione");
  /// Le parti nascoste delle etichette («X» si legge «X del punto»).
  const nascosti: HTMLSpanElement[] = [];
  /// Manda il punto scelto, se è uno solo, a `x` o `y`; l'altra coordinata
  /// resta la sua. Una stringa è il perché non si fa, e il campo la dice.
  const sposta = (asse: 0 | 1, valore: number): string | void => {
    const scelto = punti.length === 1 ? punti[0]! : null;
    if (scelto === null) return parola("punto.serve_uno");
    const at: [number, number] = [scelto.at[0], scelto.at[1]];
    at[asse] = valore;
    azioni.esegui(
      COMANDI_PUNTI.sposta,
      { element: scelto.element, subpath: scelto.subpath, anchor: scelto.anchor, x: at[0], y: at[1] },
      parola("punto.sposta"),
    );
  };
  const campo = (lettera: string, asse: 0 | 1): NumberField => {
    const f = numberField({
      label: lettera,
      value: null,
      unit: "px",
      places: 2,
      mixedText: "",
      problem: problemaDelNumero,
      onCommit: (valore) => sposta(asse, valore),
      lifetime: vita,
    });
    f.element.classList.add("draw-point-coord");
    // Il nome intero per chi ascolta: «X del punto».
    const nascosto = document.createElement("span");
    nascosto.className = "sr-only";
    f.element.querySelector("label")?.append(nascosto);
    nascosti.push(nascosto);
    posizione.append(f.element);
    return f;
  };
  const x = campo("X", 0);
  const y = campo("Y", 1);

  /// Le parole nella lingua di adesso: nomi, titoli e perché.
  const rinomina = (): void => {
    for (const g of [converti, punto, posizione]) g.setAttribute("aria-label", parola(g.dataset.nome!));
    for (const p of pulsanti) {
      const nome = parola(p.nome);
      p.control.setAttribute("aria-label", nome);
      p.control.title = p.perche === null ? parola(p.titolo) : `${parola(p.titolo)} — ${parola(`punto.${p.perche}`)}`;
    }
    for (const nascosto of nascosti) nascosto.textContent = parola("punto.coordinata");
    const titolo = punti.length === 1 ? parola("punto.scrivi") : parola("punto.serve_uno");
    for (const f of [x, y]) f.input.title = titolo;
  };

  /// La fila coi punti di adesso: chi vale, chi no e perché, e la posizione.
  const mostra = (): void => {
    const regole = regolePunti(punti);
    const stati: [Pulsante, PerchePunto][] = [
      [angolo, regole.converti],
      [morbido, regole.converti],
      [taglia, regole.taglia],
      [unisci, regole.unisci],
      [elimina, regole.elimina],
    ];
    for (const [p, perche] of stati) {
      p.perche = perche;
      if (perche === null) p.control.removeAttribute("aria-disabled");
      else p.control.setAttribute("aria-disabled", "true");
    }
    x.setValue(regole.posizione?.[0] ?? null);
    y.setValue(regole.posizione?.[1] ?? null);
    // Con un punto solo i campi si scrivono; altrimenti sola lettura.
    for (const f of [x, y]) {
      f.input.readOnly = regole.posizione === null;
      if (regole.posizione === null) f.input.setAttribute("aria-readonly", "true");
      else f.input.removeAttribute("aria-readonly");
    }
    rinomina();
  };

  mostra();
  vita.add(onLanguage(() => rinomina()));

  const element = document.createElement("div");
  element.className = "draw-options-row";
  return {
    element,
    voci: [
      { element: converti, priorita: PRIORITA.converti },
      { element: punto, priorita: PRIORITA.punto },
      { element: posizione, priorita: PRIORITA.posizione },
    ],
    aggiorna(_opzioni, nuovo) {
      if (nuovo !== undefined) punti = puntiDi(nuovo);
      mostra();
      return true;
    },
  };
}
