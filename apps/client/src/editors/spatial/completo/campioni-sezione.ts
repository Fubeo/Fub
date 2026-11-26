// La sezione «Campioni» della scheda Risorse del Completo (K6 T14, giro 2; prototipo
// `pezzo-pannello-risorse`, `draw-resources-swatches`): i campioni del documento, la scelta di uno,
// il campione dato alla selezione, e le azioni Nuovo, Opzioni, Duplica, Elimina, Ordina per nome,
// Aggiungi i colori usati e Togli i non usati, con le finestre del kit «Nuovo campione» e «Opzioni del
// campione». Unisci e Sposta non stanno qui: scelgono più campioni o un posto, e sono nell'indice dei comandi.
//
// - **I campioni dal modello.** La griglia mostra i campioni che il pannello legge dal disegno
//   (`ContestoSezione.campioni`): nessuna richiesta al motore per mostrarli. Ogni campione del file è
//   globale (formato della scena): cambiarlo cambia ogni oggetto che lo usa, in un passo.
// - **Un clic sceglie, e dà.** Un clic su un campione lo sceglie (`aria-pressed`, il segno); se c'è
//   una selezione, il campione va al lato attivo, quello che la sezione Colore mostra
//   (`LatoAttivo`), con `paint.setFill` o `paint.setStroke` `{swatch}`. Il doppio clic apre le
//   opzioni. Le frecce muovono il fuoco nella griglia, che ha una sola fermata del Tab.
// - **Un'azione, un comando.** Ogni azione manda un comando solo, dal percorso unico
//   (`eseguiPerId`): `swatch.new`, `swatch.edit`, `swatch.delete`, `swatch.addUsedColors`. «Togli i
//   non usati» conta i campioni che nessun elemento usa dal modello, e li elimina in un passo.
// - **La griglia resta finché i campioni sono gli stessi.** Il pannello rifà la sezione a ogni
//   cambio della selezione; con 2 000 campioni la griglia si rifà solo se l'elenco cambia, e scorre
//   dentro la scheda.

import { textButton } from "../../../kit";
import { createColorPicker } from "../../../kit/color/picker";
import { openDialog } from "../../../kit/dialog";
import { formBody, formNote, formText } from "../../../kit/form";
import { identifier } from "../../../ui/a11y";
import type { Lifetime } from "../../../ui/lifetime";
import { t, type DrawKey } from "../strings";
import { drawPickerText } from "../tools/color-text";
import type { LatoAttivo } from "./colore-sezione";
import { registraSezione, type CampioneDocumento, type ContestoSezione, type Sezione, type Sezioni, type VoceDelCompleto } from "./sezioni";

/// Il comando del motore: l'id della voce e i suoi valori.
export type EseguiCampioni = (id: string, valori: Readonly<Record<string, unknown>>) => void;

/// Il colore di serie di un campione nuovo, se non ce n'è uno scelto.
const NERO = "#000000";

/// Ciò che le finestre del campione rendono: il nome e il colore, o `null` con Annulla.
interface Risposta {
  readonly nome: string;
  readonly colore: string;
}

/// La finestra «Nuovo campione» o «Opzioni del campione»: il nome e il colore, col selettore del kit.
/// Un nome vuoto, o già di un altro campione, tiene aperta la finestra e dice che cosa fare.
export function finestraCampione(opzioni: {
  readonly titolo: string;
  readonly conferma: string;
  readonly nome: string;
  readonly colore: string;
  /// I nomi che il campione non può prendere: quelli degli altri.
  readonly altri: ReadonlySet<string>;
  readonly vita: Lifetime;
}): Promise<Risposta | null> {
  let colore = opzioni.colore;
  const nome = formText({ label: t("draw.resources.swatches.nome"), value: opzioni.nome, blank: t("draw.resources.swatches.nome.vuoto"), onChange: () => nome.setError(null), lifetime: opzioni.vita });
  const etichetta = document.createElement("p");
  etichetta.className = "kit-form-label draw-resources-swatches-label";
  etichetta.id = identifier("draw-swatch-color");
  etichetta.textContent = t("draw.resources.swatches.colore");
  const selettore = createColorPicker({
    value: colore,
    text: drawPickerText(),
    free: true,
    onChange: (nuovo) => {
      colore = nuovo;
    },
    lifetime: opzioni.vita,
  });
  selettore.element.classList.add("draw-resources-swatches-picker");
  selettore.element.setAttribute("aria-labelledby", etichetta.id);
  const corpo = formBody([nome.element, etichetta, selettore.element, formNote(t("draw.resources.swatches.globale"))]);
  const finestra = openDialog<boolean>({
    title: opzioni.titolo,
    body: corpo,
    actions: [
      { id: "cancel", label: t("draw.resources.swatches.annulla"), value: false },
      { id: "ok", label: opzioni.conferma, kind: "primary", value: true },
    ],
    dismissValue: false,
    lifetime: opzioni.vita,
    submit: "ok",
    className: "draw-resources-swatches-dialog",
    confirm: (ok) => {
      if (!ok) return true;
      if (!nome.valid()) {
        nome.setError(t("draw.resources.swatches.nome.vuoto"));
        nome.focus();
        return false;
      }
      if (opzioni.altri.has(nome.value().trim())) {
        nome.setError(t("draw.resources.swatches.nome.doppio"));
        nome.focus();
        return false;
      }
      return true;
    },
  });
  return finestra.result.then((ok) => (ok ? { nome: nome.value().trim(), colore } : null));
}

/// Le parti della sezione che restano da un giro all'altro.
interface Parti {
  /// La griglia del kit (`kit-color`), come il prototipo: la nota le sta sopra, le azioni sotto.
  readonly radice: HTMLElement;
  readonly azioni: HTMLElement;
  readonly nota: HTMLParagraphElement;
  readonly fila: HTMLElement;
  readonly nuovo: HTMLButtonElement;
  readonly opzioni: HTMLButtonElement;
  readonly elimina: HTMLButtonElement;
  readonly duplica: HTMLButtonElement;
  readonly ordina: HTMLButtonElement;
  readonly usati: HTMLButtonElement;
  readonly togli: HTMLButtonElement;
}

/// Le voci del menu che aprono le finestre della sezione (righe `ui.newSwatch` e `ui.swatchOptions`).
export const VOCE_NUOVO = "ui.newSwatch";
export const VOCE_OPZIONI = "ui.swatchOptions";

/// La sezione «Campioni» per la scheda Risorse, da registrare nel Completo aperto: `vita` è quella del
/// Completo, `lato` il lato attivo che la sezione Colore condivide. In `voci` mette le voci del menu
/// «Nuovo campione…» e «Opzioni campione…», che aprono le stesse finestre.
export function sezioneCampioni(
  esegui: EseguiCampioni,
  vita: Lifetime,
  lato: LatoAttivo = { lato: "fill" },
  vociMenu?: Map<string, VoceDelCompleto>,
): Sezione {
  let parti: Parti | null = null;
  /// L'id del campione scelto; resta finché il campione c'è.
  let scelto: string | null = null;
  /// L'elenco dell'ultimo giro, e la sua firma: la griglia si rifà solo se cambia.
  let elenco: readonly CampioneDocumento[] = [];
  let firma: string | null = null;
  /// Il contesto dell'ultimo giro: la selezione e i campioni non usati.
  let ultimo: ContestoSezione | null = null;
  /// Un'altra finestra non si apre mentre una è aperta.
  let aperta = false;

  const campioneScelto = (): CampioneDocumento | undefined => elenco.find((campione) => campione.id === scelto);
  const voci = (p: Parti): HTMLButtonElement[] => [...p.fila.querySelectorAll<HTMLButtonElement>(".kit-color-swatch")];

  /// Segna il campione scelto, e la sola fermata del Tab della griglia.
  const segna = (p: Parti): void => {
    const tutte = voci(p);
    const fermata = tutte.find((voce) => voce.dataset.swatch === scelto) ?? tutte[0];
    for (const voce of tutte) {
      const si = voce.dataset.swatch === scelto;
      voce.classList.toggle("selected", si);
      voce.setAttribute("aria-pressed", String(si));
      voce.tabIndex = voce === fermata ? 0 : -1;
    }
    const manca = campioneScelto() === undefined;
    p.opzioni.disabled = manca;
    p.elimina.disabled = manca;
    p.duplica.disabled = manca;
    // Ordinare vuole almeno due campioni.
    p.ordina.disabled = elenco.length < 2;
    p.duplica.title = manca ? t("draw.resources.swatches.sceglino") : t("draw.resources.swatches.duplica.nota");
    for (const bottone of [p.opzioni, p.elimina]) {
      const nota = manca ? t("draw.resources.swatches.sceglino") : t(bottone === p.opzioni ? "draw.resources.swatches.opzioni.nota" : "draw.resources.swatches.elimina.nota");
      bottone.title = nota;
    }
  };

  const scegli = (id: string): void => {
    scelto = id;
    if (parti !== null) segna(parti);
    const campione = campioneScelto();
    if (campione === undefined || ultimo === null || ultimo.sel.numero === 0) return;
    esegui(lato.lato === "fill" ? "paint.setFill" : "paint.setStroke", { swatch: campione.name });
  };

  const nomiTranne = (tranne: string | null): Set<string> => new Set(elenco.filter((campione) => campione.id !== tranne).map((campione) => campione.name));

  const nuovo = async (): Promise<void> => {
    if (aperta) return;
    aperta = true;
    try {
      const risposta = await finestraCampione({
        titolo: t("draw.resources.swatches.nuovoTitolo"),
        conferma: t("draw.resources.swatches.crea"),
        nome: "",
        colore: campioneScelto()?.color ?? NERO,
        altri: nomiTranne(null),
        vita,
      });
      if (risposta !== null) esegui("swatch.new", { name: risposta.nome, color: risposta.colore });
    } finally {
      aperta = false;
    }
  };

  const opzioni = async (): Promise<void> => {
    const campione = campioneScelto();
    if (campione === undefined || aperta) return;
    aperta = true;
    try {
      const risposta = await finestraCampione({
        titolo: t("draw.resources.swatches.opzioniTitolo"),
        conferma: t("draw.resources.swatches.ok"),
        nome: campione.name,
        colore: campione.color,
        altri: nomiTranne(campione.id),
        vita,
      });
      if (risposta === null) return;
      const valori: Record<string, unknown> = { name: campione.name };
      if (risposta.nome !== campione.name) valori.newName = risposta.nome;
      if (risposta.colore.toLowerCase() !== campione.color.toLowerCase()) valori.color = risposta.colore;
      if (Object.keys(valori).length > 1) esegui("swatch.edit", valori);
    } finally {
      aperta = false;
    }
  };

  /// La griglia dei campioni, come il prototipo: un gruppo «Documento» coi pulsanti del kit.
  const riempi = (p: Parti): void => {
    p.fila.replaceChildren(
      ...elenco.map((campione) => {
        const voce = document.createElement("button");
        voce.type = "button";
        voce.className = "kit-color-swatch";
        voce.dataset.swatch = campione.id;
        voce.dataset.color = campione.color;
        voce.title = campione.name;
        voce.setAttribute("aria-label", campione.name);
        voce.setAttribute("aria-pressed", "false");
        const chip = document.createElement("span");
        chip.className = "kit-color-chip";
        chip.style.backgroundColor = campione.color;
        const segno = document.createElement("span");
        segno.className = "kit-color-check";
        segno.setAttribute("aria-hidden", "true");
        segno.textContent = "✓";
        voce.append(chip, segno);
        return voce;
      }),
    );
    p.radice.hidden = elenco.length === 0;
  };

  /// Le frecce muovono il fuoco fra i campioni: a destra e a sinistra di uno, su e giù di una riga.
  const muovi = (p: Parti, evento: KeyboardEvent): void => {
    const tutte = voci(p);
    const qui = tutte.indexOf(evento.target as HTMLButtonElement);
    if (qui < 0) return;
    const prima = tutte[0]!.offsetTop;
    const perRiga = Math.max(1, tutte.findIndex((voce) => voce.offsetTop !== prima) === -1 ? tutte.length : tutte.findIndex((voce) => voce.offsetTop !== prima));
    const passi: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRiga, ArrowUp: -perRiga };
    let dove: number;
    if (evento.key === "Home") dove = 0;
    else if (evento.key === "End") dove = tutte.length - 1;
    else if (evento.key in passi) dove = Math.min(tutte.length - 1, Math.max(0, qui + passi[evento.key]!));
    else return;
    evento.preventDefault();
    for (const voce of tutte) voce.tabIndex = -1;
    tutte[dove]!.tabIndex = 0;
    tutte[dove]!.focus();
  };

  const crea = (): Parti => {
    const radice = document.createElement("div");
    radice.className = "kit-color draw-resources-swatches";
    const nota = document.createElement("p");
    nota.className = "draw-properties-note";
    nota.dataset.column = "all";
    const griglia = document.createElement("div");
    griglia.className = "kit-color-group";
    const titolo = document.createElement("div");
    titolo.className = "kit-color-group-title";
    titolo.id = identifier("kit-color-group");
    titolo.textContent = t("draw.resources.swatches.document");
    const fila = document.createElement("div");
    fila.className = "kit-color-swatches";
    fila.setAttribute("role", "group");
    fila.setAttribute("aria-labelledby", titolo.id);
    griglia.append(titolo, fila);
    const azioni = document.createElement("div");
    azioni.className = "draw-resources-swatches-actions";
    azioni.setAttribute("role", "group");
    azioni.setAttribute("aria-label", t("draw.resources.swatches.azioni"));
    const bottone = (chiave: DrawKey, nota: DrawKey, premi: () => void): HTMLButtonElement => {
      const uno = textButton({ label: t(chiave), onPress: premi, lifetime: vita });
      uno.dataset.action = chiave.slice(chiave.lastIndexOf(".") + 1);
      uno.title = t(nota);
      return uno;
    };
    const fatte: Parti = {
      radice,
      azioni,
      nota,
      fila,
      nuovo: bottone("draw.resources.swatches.nuovo", "draw.resources.swatches.nuovo.nota", () => void nuovo()),
      opzioni: bottone("draw.resources.swatches.opzioni", "draw.resources.swatches.opzioni.nota", () => void opzioni()),
      elimina: bottone("draw.resources.swatches.elimina", "draw.resources.swatches.elimina.nota", () => {
        const campione = campioneScelto();
        if (campione !== undefined) esegui("swatch.delete", { name: campione.name });
      }),
      duplica: bottone("draw.resources.swatches.duplica", "draw.resources.swatches.duplica.nota", () => {
        const campione = campioneScelto();
        if (campione !== undefined) esegui("swatch.duplicate", { name: campione.name });
      }),
      ordina: bottone("draw.resources.swatches.ordina", "draw.resources.swatches.ordina.nota", () => esegui("swatch.sortByName", {})),
      usati: bottone("draw.resources.swatches.usati", "draw.resources.swatches.usati.nota", () => {
        esegui("swatch.addUsedColors", ultimo !== null && ultimo.sel.numero > 0 ? { selection: true } : {});
      }),
      togli: bottone("draw.resources.swatches.togli", "draw.resources.swatches.togli.nota", () => {
        const ids = new Set(ultimo?.campioni?.nonUsati() ?? []);
        const nomi = elenco.filter((campione) => ids.has(campione.id)).map((campione) => campione.name);
        if (nomi.length > 0) esegui("swatch.delete", { names: nomi });
      }),
    };
    azioni.append(fatte.nuovo, fatte.opzioni, fatte.duplica, fatte.elimina, fatte.ordina, fatte.usati, fatte.togli);
    radice.append(griglia);
    vita.listen(fila, "click", (evento) => {
      const voce = (evento.target as HTMLElement).closest<HTMLButtonElement>(".kit-color-swatch");
      if (voce?.dataset.swatch !== undefined) scegli(voce.dataset.swatch);
    });
    vita.listen(fila, "dblclick", (evento) => {
      if ((evento.target as HTMLElement).closest(".kit-color-swatch") !== null) void opzioni();
    });
    vita.listen(fila, "keydown", (evento) => muovi(fatte, evento));
    return fatte;
  };

  const disegna = (contesto: ContestoSezione): (() => void) => {
    const p = (parti ??= crea());
    ultimo = contesto;
    elenco = contesto.campioni?.elenco ?? [];
    const nuova = elenco.map((campione) => `${campione.id}\u0000${campione.name}\u0000${campione.color}`).join("\u0001");
    if (nuova !== firma) {
      firma = nuova;
      riempi(p);
    }
    if (campioneScelto() === undefined) scelto = null;
    p.nota.textContent = elenco.length === 0 ? t("draw.resources.swatches.none") : t("draw.resources.count", { count: elenco.length });
    // «Togli i non usati» si spegne se ogni campione è usato: lo dice il suggerimento.
    const nonUsati = elenco.length === 0 ? 0 : (contesto.campioni?.nonUsati().length ?? 0);
    p.togli.disabled = nonUsati === 0;
    p.togli.title = nonUsati === 0 && elenco.length > 0 ? t("draw.resources.swatches.togli.nessuno") : t("draw.resources.swatches.togli.nota");
    segna(p);
    contesto.corpo.append(p.nota, p.radice, p.azioni);
    return () => {
      if (ultimo === contesto) ultimo = null;
      contesto.corpo.replaceChildren();
    };
  };

  // Il menu apre le stesse finestre, anche con la scheda chiusa: i nomi sono quelli dell'ultimo giro.
  vociMenu?.set(VOCE_NUOVO, { stato: () => null, esegui: () => void nuovo() });
  vociMenu?.set(VOCE_OPZIONI, {
    stato: () => (campioneScelto() === undefined ? t("draw.resources.swatches.sceglino") : null),
    esegui: () => void opzioni(),
  });

  return {
    id: "swatches",
    scheda: "risorse",
    titolo: t("draw.resources.swatches"),
    ordine: 0,
    disegna,
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraCampioni(sezioni: Sezioni, esegui: EseguiCampioni, vita: Lifetime, lato?: LatoAttivo, voci?: Map<string, VoceDelCompleto>): boolean {
  return registraSezione({ sezioni }, sezioneCampioni(esegui, vita, lato, voci));
}
