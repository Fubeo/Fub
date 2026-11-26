// La sezione «Aspetto» del Design del Completo (mappa: `ispettore/design/aspetto`), come il
// pannello Aspetto di VectorCraft (`vendor/vectorcraft/crates/ui-egui/src/panels/appearance.rs`)
// per la sua parte degli effetti: la pila degli effetti dal vivo degli oggetti scelti, letta dal
// motore (`effect.list`), nell'ordine in cui si applicano. Prima gli effetti dell'oggetto, poi
// quelli di ogni riempimento o tratto che ne ha. Per ogni effetto:
//
// - **Visibile** (l'occhio): `effect.setParams` con `visible`;
// - il **nome**: apre la finestra dell'effetto coi valori che ha, e OK (o l'anteprima) manda
//   `effect.setParams` con `params` (`opzioni` delle azioni), come `effect.dialog` di VectorCraft;
//   un effetto senza valori non ha finestra e il nome non è un pulsante;
// - **Su** e **Giù**: `effect.move` di un posto nella stessa pila;
// - **Duplica** (`effect.duplicate`) e **Togli** (`effect.remove`).
//
// In fondo **Espandi aspetto** (`effect.expandAppearance`) rende gli effetti oggetti veri.
//
// Più oggetti scelti con pile diverse: come VectorCraft, la sezione elenca solo gli effetti
// dell'oggetto che tutti hanno (allineati per uguaglianza, `allinea`), ogni comando porta
// `aligned` e vale dove ogni oggetto ha quell'effetto; non si spostano (Su e Giù spenti), e gli
// effetti dei riempimenti e dei tratti non si elencano (il motore non dice se quei riempimenti
// sono uguali). Ogni comando è un passo della cronologia, dal percorso unico senza la finestra
// della voce; la risposta di un giro passato si butta (la sua vita è chiusa).

import { t } from "../strings";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// L'id della sezione: l'ultimo pezzo del posto dei comandi della pila.
export const SEZIONE_ASPETTO = "aspetto";

/// Un effetto applicato, come lo legge `effect.list`.
export interface EffettoApplicato {
  readonly id: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly visibile: boolean;
}

/// La pila di un oggetto scelto: i suoi effetti e quelli dei suoi riempimenti e tratti.
export interface PilaOggetto {
  readonly effetti: readonly EffettoApplicato[];
  readonly elementi: readonly { readonly posto: number; readonly tipo: string; readonly effetti: readonly EffettoApplicato[] }[];
}

/// Una riga della sezione: l'effetto al posto `posto` della pila dell'oggetto (`elemento` `null`)
/// o del riempimento o tratto `elemento`.
export interface RigaEffetto {
  readonly elemento: number | null;
  readonly posto: number;
  readonly effetto: EffettoApplicato;
  /// Se può salire o scendere di un posto nella sua pila.
  readonly su: boolean;
  readonly giu: boolean;
}

/// Un gruppo di righe: quelle dell'oggetto (`elemento` `null`) o di un riempimento o tratto.
export interface GruppoEffetti {
  readonly elemento: number | null;
  /// `fill` o `stroke` per un elemento; vuoto per l'oggetto.
  readonly tipo: string;
  readonly righe: readonly RigaEffetto[];
}

/// Le righe che la sezione elenca, e se i comandi portano `aligned`.
export interface StatoAspetto {
  readonly gruppi: readonly GruppoEffetti[];
  readonly allineati: boolean;
  /// Se c'è qualcosa da espandere: un effetto in una pila di un oggetto scelto.
  readonly espandibile: boolean;
}

/// Ciò che la sezione usa del Completo.
export interface AzioniAspetto {
  /// Manda la voce `id` dell'indice coi valori `valori`, senza finestra.
  readonly esegui: (id: string, valori: Readonly<Record<string, unknown>>) => Promise<void>;
  /// La lettura di `effect.list` sugli oggetti scelti; `null` se il motore non c'è o non risponde.
  readonly leggi: () => Promise<unknown>;
  /// Il nome dell'effetto `id` nella lingua dell'app (l'etichetta della sua voce).
  readonly nome: (id: string) => string;
  /// Se l'effetto `id` ha una finestra (dei valori da scegliere).
  readonly haOpzioni: (id: string) => boolean;
  /// Apre la finestra dell'effetto `id` coi valori `params`; OK e l'anteprima mandano
  /// `effect.setParams` con `posto` (`index`, `item` e, se serve, `aligned`) e i valori scelti.
  readonly opzioni: (id: string, posto: Readonly<Record<string, unknown>>, params: Readonly<Record<string, unknown>>) => void;
}

function isRecord(valore: unknown): valore is Readonly<Record<string, unknown>> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

function effettiDa(valore: unknown): EffettoApplicato[] {
  if (!Array.isArray(valore)) return [];
  return valore.flatMap((uno): EffettoApplicato[] => {
    if (!isRecord(uno) || typeof uno["id"] !== "string") return [];
    return [{ id: uno["id"], params: isRecord(uno["params"]) ? uno["params"] : {}, visibile: uno["visible"] !== false }];
  });
}

/// Le pile degli oggetti scelti da una lettura di `effect.list`; `null` se non è una lettura.
export function pileDaLettura(lettura: unknown): PilaOggetto[] | null {
  if (!isRecord(lettura) || !Array.isArray(lettura["applied"])) return null;
  return lettura["applied"].filter(isRecord).map((oggetto) => ({
    effetti: effettiDa(oggetto["effects"]),
    elementi: (Array.isArray(oggetto["items"]) ? oggetto["items"] : []).filter(isRecord).flatMap((elemento) =>
      typeof elemento["index"] === "number" ? [{ posto: elemento["index"], tipo: typeof elemento["kind"] === "string" ? elemento["kind"] : "", effetti: effettiDa(elemento["effects"]) }] : [],
    ),
  }));
}

function uguali(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => uguali(v, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const chiavi = Object.keys(a);
    return chiavi.length === Object.keys(b).length && chiavi.every((k) => k in b && uguali(a[k], b[k]));
  }
  return false;
}

/// Dove sta l'effetto 3D a cui «Predefinito illuminazione 3D» del menu cambia la luce: il primo
/// della pila dell'oggetto, se no il primo di un suo elemento (riempimento o contorno). Il comando
/// del motore vuole lo stesso posto su tutti gli oggetti scelti: `nessuno` se uno non ha un effetto
/// 3D, `diversi` se gli oggetti lo hanno in posti diversi.
export function postoDel3D(
  pile: readonly PilaOggetto[],
): { readonly item: number | null; readonly index: number } | "nessuno" | "diversi" {
  const del3D = (pila: PilaOggetto): { readonly item: number | null; readonly index: number } | null => {
    const primo = (effetti: readonly EffettoApplicato[]) => effetti.findIndex((effetto) => effetto.id.startsWith("threeD."));
    const index = primo(pila.effetti);
    if (index >= 0) return { item: null, index };
    for (const elemento of pila.elementi) {
      const suo = primo(elemento.effetti);
      if (suo >= 0) return { item: elemento.posto, index: suo };
    }
    return null;
  };
  const posti = pile.map(del3D);
  const primo = posti[0];
  if (primo === undefined || posti.some((posto) => posto === null)) return "nessuno";
  return posti.every((posto) => posto!.item === primo!.item && posto!.index === primo!.index) ? primo! : "diversi";
}

/// Due effetti applicati uguali: stesso effetto, stessi valori, stessa visibilità.
export function stessoEffetto(a: EffettoApplicato, b: EffettoApplicato): boolean {
  return a.id === b.id && a.visibile === b.visibile && uguali(a.params, b.params);
}

/// Dove sta, nella pila `altra`, ogni posto della pila `prima` (`null` dove manca): la sottosequenza
/// comune più lunga, come `align` di VectorCraft (`vendor/vectorcraft/crates/doc/src/appearance.rs`).
export function allinea<T>(prima: readonly T[], altra: readonly T[], uguale: (a: T, b: T) => boolean): (number | null)[] {
  const n = prima.length;
  const m = altra.length;
  const fuori: (number | null)[] = new Array<number | null>(n).fill(null);
  if (n === 0 || m === 0) return fuori;
  // `lun[i][j]`: la corrispondenza più lunga fra `prima[i..]` e `altra[j..]`.
  const lun: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lun[i]![j] = uguale(prima[i]!, altra[j]!) ? lun[i + 1]![j + 1]! + 1 : Math.max(lun[i + 1]![j]!, lun[i]![j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (uguale(prima[i]!, altra[j]!) && lun[i]![j] === lun[i + 1]![j + 1]! + 1) {
      fuori[i] = j;
      i++;
      j++;
    } else if (lun[i + 1]![j]! >= lun[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return fuori;
}

function righe(effetti: readonly EffettoApplicato[], elemento: number | null, mobili: boolean, posti?: readonly number[]): RigaEffetto[] {
  const quali = posti ?? effetti.map((_, i) => i);
  return quali.map((posto) => ({
    elemento,
    posto,
    effetto: effetti[posto]!,
    su: mobili && posto > 0,
    giu: mobili && posto < effetti.length - 1,
  }));
}

/// Lo stato dalle pile degli oggetti scelti: `null` se non ce n'è nessuno. Un oggetto solo, o
/// più con pile uguali, mostra la sua pila intera; pile diverse, gli effetti dell'oggetto che tutti
/// hanno (`allineati`).
export function statoDallePile(pile: readonly PilaOggetto[]): StatoAspetto | null {
  const [prima, ...altre] = pile;
  if (prima === undefined) return null;
  const espandibile = pile.some((p) => p.effetti.length > 0 || p.elementi.some((e) => e.effetti.length > 0));
  const stesse = altre.every(
    (p) =>
      p.effetti.length === prima.effetti.length &&
      p.effetti.every((e, i) => stessoEffetto(e, prima.effetti[i]!)) &&
      p.elementi.length === prima.elementi.length &&
      p.elementi.every((e, i) => {
        const suo = prima.elementi[i]!;
        return e.posto === suo.posto && e.tipo === suo.tipo && e.effetti.length === suo.effetti.length && e.effetti.every((x, k) => stessoEffetto(x, suo.effetti[k]!));
      }),
  );
  if (stesse) {
    const gruppi: GruppoEffetti[] = [];
    if (prima.effetti.length > 0) gruppi.push({ elemento: null, tipo: "", righe: righe(prima.effetti, null, true) });
    for (const elemento of prima.elementi) {
      if (elemento.effetti.length > 0) gruppi.push({ elemento: elemento.posto, tipo: elemento.tipo, righe: righe(elemento.effetti, elemento.posto, true) });
    }
    return { gruppi, allineati: false, espandibile };
  }
  const mappe = altre.map((p) => allinea(prima.effetti, p.effetti, stessoEffetto));
  const comuni = prima.effetti.map((_, i) => i).filter((i) => mappe.every((mappa) => mappa[i] !== null));
  const gruppi: GruppoEffetti[] = comuni.length === 0 ? [] : [{ elemento: null, tipo: "", righe: righe(prima.effetti, null, false, comuni) }];
  return { gruppi, allineati: true, espandibile };
}

function pulsante(testo: string, etichetta: string, acceso: boolean, contesto: ContestoSezione, fai: () => void): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "draw-button draw-appearance-button";
  control.textContent = testo;
  control.title = etichetta;
  control.setAttribute("aria-label", etichetta);
  control.disabled = !acceso;
  contesto.vita.listen(control, "click", () => {
    if (!control.disabled) fai();
  });
  return control;
}

function titoloGruppo(gruppo: GruppoEffetti, numeri: Map<string, number>): string {
  if (gruppo.elemento === null) return t("draw.aspetto.oggetto");
  const tipo = gruppo.tipo === "stroke" ? "stroke" : "fill";
  const n = (numeri.get(tipo) ?? 0) + 1;
  numeri.set(tipo, n);
  return t(tipo === "stroke" ? "draw.aspetto.tratto" : "draw.aspetto.riempimento", { n: String(n) });
}

function disegnaCorpo(contesto: ContestoSezione, azioni: AzioniAspetto, stato: StatoAspetto): void {
  const { corpo, vita } = contesto;
  const posto = (riga: RigaEffetto): Record<string, unknown> => ({
    index: riga.posto,
    item: riga.elemento,
    ...(stato.allineati ? { aligned: true } : {}),
  });
  const manda = (id: string, valori: Readonly<Record<string, unknown>>): void => {
    void azioni.esegui(id, valori);
  };
  const figli: HTMLElement[] = [];
  if (stato.gruppi.length === 0) {
    const nota = document.createElement("p");
    nota.className = "draw-properties-note";
    nota.textContent = t(stato.allineati && stato.espandibile ? "draw.aspetto.diversi" : "draw.aspetto.nessuno");
    figli.push(nota);
  }
  const numeri = new Map<string, number>();
  for (const gruppo of stato.gruppi) {
    const elenco = document.createElement("ul");
    elenco.className = "draw-appearance-list";
    const titolo = titoloGruppo(gruppo, numeri);
    elenco.setAttribute("aria-label", titolo);
    const testa = document.createElement("p");
    testa.className = "draw-properties-label draw-appearance-head";
    testa.textContent = titolo;
    for (const riga of gruppo.righe) {
      const voce = document.createElement("li");
      voce.className = "draw-properties-bar draw-appearance-row";
      voce.dataset.effect = riga.effetto.id;
      const nome = azioni.nome(riga.effetto.id);
      const occhio = document.createElement("input");
      occhio.type = "checkbox";
      occhio.className = "draw-appearance-eye";
      occhio.checked = riga.effetto.visibile;
      occhio.setAttribute("aria-label", t("draw.aspetto.visibile", { effetto: nome }));
      vita.listen(occhio, "change", () => manda("effect.setParams", { ...posto(riga), visible: occhio.checked }));
      let etichetta: HTMLElement;
      if (azioni.haOpzioni(riga.effetto.id)) {
        const apri = document.createElement("button");
        apri.type = "button";
        apri.className = "draw-button draw-appearance-name";
        apri.textContent = nome;
        apri.title = t("draw.aspetto.opzioni", { effetto: nome });
        vita.listen(apri, "click", () => azioni.opzioni(riga.effetto.id, posto(riga), riga.effetto.params));
        etichetta = apri;
      } else {
        etichetta = document.createElement("span");
        etichetta.className = "draw-appearance-name";
        etichetta.textContent = nome;
      }
      if (!riga.effetto.visibile) etichetta.dataset.hidden = "true";
      const spostaDi = (verso: number): void =>
        manda("effect.move", { from: riga.posto, to: riga.posto + verso, fromItem: riga.elemento, toItem: riga.elemento });
      voce.append(
        occhio,
        etichetta,
        pulsante("↑", t("draw.aspetto.su", { effetto: nome }), riga.su, contesto, () => spostaDi(-1)),
        pulsante("↓", t("draw.aspetto.giu", { effetto: nome }), riga.giu, contesto, () => spostaDi(1)),
        pulsante("⧉", t("draw.aspetto.duplica", { effetto: nome }), true, contesto, () => manda("effect.duplicate", posto(riga))),
        pulsante("×", t("draw.aspetto.togli", { effetto: nome }), true, contesto, () => manda("effect.remove", posto(riga))),
      );
      elenco.append(voce);
    }
    figli.push(testa, elenco);
  }
  const espandi = document.createElement("button");
  espandi.type = "button";
  espandi.className = "draw-button draw-appearance-expand";
  espandi.textContent = t("draw.aspetto.espandi");
  espandi.disabled = !stato.espandibile;
  vita.listen(espandi, "click", () => {
    if (!espandi.disabled) manda("effect.expandAppearance", {});
  });
  figli.push(espandi);
  corpo.replaceChildren(...figli);
}

function disegna(contesto: ContestoSezione, azioni: AzioniAspetto): () => void {
  const { corpo, vita } = contesto;
  if (contesto.motore === null) {
    contesto.mostra?.(false);
    return () => corpo.replaceChildren();
  }
  void azioni.leggi().then(
    (lettura) => {
      if (vita.closed) return;
      const pile = pileDaLettura(lettura);
      const stato = pile === null ? null : statoDallePile(pile);
      if (stato === null) {
        corpo.replaceChildren();
        contesto.mostra?.(false);
        return;
      }
      disegnaCorpo(contesto, azioni, stato);
      contesto.mostra?.(true);
    },
    () => {
      if (!vita.closed) contesto.mostra?.(false);
    },
  );
  return () => corpo.replaceChildren();
}

/// La sezione «Aspetto» per la scheda Design.
export function sezioneAspetto(azioni: AzioniAspetto): Sezione {
  return {
    id: SEZIONE_ASPETTO,
    scheda: "design",
    titolo: t("draw.aspetto.titolo"),
    // Senza oggetti scelti VectorCraft mostra l'aspetto degli oggetti nuovi, che in Fub danno le
    // sezioni Colore e Contorno: questa sezione non c'è.
    quando: (sel) => sel.numero > 0,
    nascostaAllInizio: true,
    disegna: (contesto) => disegna(contesto, azioni),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraAspetto(sezioni: Sezioni, azioni: AzioniAspetto): boolean {
  return registraSezione({ sezioni }, sezioneAspetto(azioni));
}
