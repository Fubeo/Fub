// Ciò che il motore delle operazioni consegna: l'esito applicato o rifiutato,
// l'undo e il seguito delle operazioni (vedi `../engine.ts`).

import type { TextOperation } from "../../../core/text-operation";
import type { DocumentModel } from "../model";
import type { Op, Reason } from "../ops";

/// Un'operazione applicata.
export interface Applied {
  readonly outcome: "applied";
  /// L'operazione come si è applicata: quella chiesta, oppure, se qualcosa
  /// la segue ([`Follow`]) o la raccolta ha tolto delle risorse, un `batch`
  /// con lei, poi ciò che la segue e i `remove` della raccolta (§2).
  readonly forward: Op;
  /// L'inversa, calcolata sulla scena di prima (§2).
  readonly inverse: Op;
  /// Gli id degli elementi toccati, con quelli dei loro discendenti.
  readonly touched: readonly string[];
  /// Le modifiche sul testo a LF di prima (§6).
  readonly operation: TextOperation;
  /// Il testo grezzo di dopo, coi terminatori del file.
  readonly text: string;
  /// Un `add` di un elemento già presente e identico (§8): niente cambia.
  readonly duplicate: boolean;
  /// L'undo di questa operazione.
  readonly undo: Undo;
}

/// Ciò che segue ogni operazione applicata, nello stesso passo: le
/// operazioni che l'editor aggiunge a quella chiesta, viste la scena di dopo
/// e gli id che ha toccato, come le punte di una linea che tengono il suo
/// colore. `null` se non c'è niente da aggiungere. Il passo resta col nome
/// dell'operazione chiesta: quello di un `batch` che segue non conta.
///
/// Il motore lo chiede a giri, fino a [`FOLLOW_ROUNDS`]. Al primo `touched`
/// è tutto ciò che l'operazione ha toccato; a ogni giro dopo, soltanto ciò
/// che il giro prima ha toccato in più. `op` è l'operazione chiesta a
/// `apply`, la stessa a ogni giro: dice che cosa ha fatto chi ha chiamato,
/// per esempio quali oggetti ha spostato, anche quando `touched` ormai ne
/// elenca altri. Un seguito che non guarda `op` può non dichiararlo.
export type Follow = (model: DocumentModel, touched: ReadonlySet<string>, op: Op) => Op | null;

/// Quanti giri di seguito il motore chiede al più: ciò che un giro tocca si
/// segue a sua volta, come la regione del filtro di un connettore che il
/// primo giro ha ricalcolato. Oltre, il seguito si ferma anche se avrebbe
/// altro da dire.
export const FOLLOW_ROUNDS = 3;

/// Un'operazione rifiutata: la scena resta com'era.
export interface Rejected {
  readonly outcome: "rejected";
  readonly reason: Reason;
  readonly detail: string;
  /// In un `batch`, l'indice dell'operazione che ha fallito.
  readonly index?: number;
}

export type Outcome = Applied | Rejected;

/// Una fila di undo applicati uno dopo l'altro (`SceneEngine.undoAll`), con
/// un solo cambiamento del testo, quello di tutta la fila.
export interface Replayed {
  /// L'undo di ogni undo applicato, in ordine: rimette il suo passo.
  readonly undos: readonly Undo[];
  /// Il rifiuto che ha fermato la fila, all'undo di indice `undos.length`;
  /// `null` se la fila è arrivata in fondo.
  readonly rejected: Rejected | null;
  /// Gli id toccati dalla fila, ciascuno una volta, nell'ordine in cui la
  /// fila li ha toccati.
  readonly touched: readonly string[];
  /// Le modifiche di tutta la fila sul testo a LF di prima (§6).
  readonly operation: TextOperation;
  /// Il testo grezzo di dopo.
  readonly text: string;
}

/// L'undo di un'operazione applicata: l'inversa, e l'operazione che l'undo
/// annulla, che è l'inversa dell'undo stesso (il redo).
export class Undo {
  constructor(
    readonly inverse: Op,
    readonly forward: Op,
    readonly touched: readonly string[],
  ) {}
}
