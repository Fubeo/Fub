// Il prestito (N7, T17): un documento aperto in Fub e dato a un'app Craft
// («Apri con» GridCraft, WordCraft…) resta in Fub in sola lettura finché chi
// lo guarda non lo riprende. Fub salva prima di prestarlo, poi non scrive più:
// le modifiche arrivano dall'app, sul disco, e la scheda le ricarica come ogni
// cambio di fuori.
//
// È della shell: l'host non sa che un file è in prestito, e Fub non sa quando
// l'app si chiude (A10). Il prestito finisce con «Riprendi qui», con la
// chiusura dell'ultima scheda del documento e con la chiusura del vault.
//
// Qui sta soltanto il registro: chi lo legge è `state/document-controller.ts`
// (la sola lettura delle schede, la fine con l'ultima scheda, la rinomina) e
// `panels/document.ts` (la riga «Aperto in {app}»); chi presta è
// `panels/open-with.ts`, attraverso la porta che il controller registra
// (`LendGate`), perché il pannello non conosce le schede.

import type { Lifetime, Teardown } from "../ui/lifetime";
import { onEvent } from "./kernel";
import { on } from "./store";

/// Ciò che il prestito chiede a chi tiene le schede.
export interface LendGate {
  /// `doc` ha una scheda aperta che mostra il documento (non i soli byte di
  /// un'immagine o di un PDF): soltanto allora c'è qualcosa da prestare.
  lendable(doc: string): boolean;
  /// Salva i documenti con modifiche in coda; restituisce quelli rimasti da
  /// salvare, con l'id che hanno adesso (`flushPendingSave`).
  flush(): Promise<string[]>;
}

/// Un prestito chiesto e non ancora deciso: l'app sta per aprire il file.
/// Segue la rinomina del documento, e muore con la chiusura del vault.
export interface LendReservation {
  /// Il documento, col nome che ha adesso.
  readonly doc: string;
  /// Presta il documento a `app`, se la prenotazione è ancora viva e il
  /// documento ha ancora una scheda; vero se l'ha prestato.
  commit(app: string): boolean;
  /// Lascia la prenotazione senza prestare.
  cancel(): void;
}

type Listener = (doc: string) => void;

/// Documento → nome dell'app che lo tiene.
const lent = new Map<string, string>();
const listeners = new Set<Listener>();
const reservations = new Set<{ doc: string }>();
let gate: LendGate | null = null;

function changed(doc: string): void {
  for (const listener of [...listeners]) listener(doc);
}

/// Presta `doc` all'app `app` (il nome da mostrare): da qui le sue schede
/// sono in sola lettura e portano la riga «Aperto in {app}».
export function lend(doc: string, app: string): void {
  if (lent.get(doc) === app) return;
  lent.set(doc, app);
  changed(doc);
}

/// Riprende `doc`: le sue schede tornano modificabili, se nient'altro le
/// tiene ferme (una cancellazione in sospeso, la chiusura della finestra).
export function unlend(doc: string): void {
  if (!lent.delete(doc)) return;
  changed(doc);
}

/// L'app a cui `doc` è prestato, o `null`.
export function lentTo(doc: string): string | null {
  return lent.get(doc) ?? null;
}

/// `doc` è in prestito, o un prestito è prenotato e l'app sta per aprirlo:
/// in tutti e due i casi le sue schede sono in sola lettura, così niente si
/// scrive dopo che l'app ha letto il file. La riga «Aperto in {app}» la
/// porta soltanto il prestito (`lentTo`).
export function lendHeld(doc: string): boolean {
  if (lent.has(doc)) return true;
  for (const reservation of reservations) if (reservation.doc === doc) return true;
  return false;
}

/// I documenti in prestito.
export function lentDocuments(): string[] {
  return [...lent.keys()];
}

/// Ascolta i cambi di prestito; il disposer smette.
export function onLendChanged(listener: Listener): Teardown {
  const entry: Listener = (doc) => listener(doc);
  listeners.add(entry);
  return () => void listeners.delete(entry);
}

/// Il documento ha cambiato nome: il prestito, e le prenotazioni, lo seguono.
export function renameLend(from: string, to: string): void {
  if (from === to) return;
  let moved = false;
  for (const reservation of reservations) {
    if (reservation.doc !== from) continue;
    reservation.doc = to;
    moved = true;
  }
  const app = lent.get(from);
  if (app !== undefined) {
    lent.delete(from);
    lent.set(to, app);
  }
  if (app === undefined && !moved) return;
  changed(from);
  changed(to);
}

/// Dimentica ogni prestito e ogni prenotazione: il vault si è chiuso, o ne
/// è arrivato un altro.
export function forgetLends(): void {
  const docs = new Set([...lent.keys(), ...[...reservations].map((reservation) => reservation.doc)]);
  reservations.clear();
  lent.clear();
  for (const doc of docs) changed(doc);
}

/// Prenota il prestito di `doc` prima di chiedere all'app di aprirlo: la
/// risposta arriva dopo un'attesa in cui il documento può cambiare nome o il
/// vault chiudersi. `lendable` dice se il documento ha ancora una scheda.
/// Da qui le schede del documento sono in sola lettura (`lendHeld`), prima
/// del salvataggio; tornano scrivibili se la prenotazione si lascia.
export function reserveLend(doc: string, lendable: (doc: string) => boolean): LendReservation {
  const entry = { doc };
  reservations.add(entry);
  changed(doc);
  return {
    get doc() {
      return entry.doc;
    },
    commit(app: string): boolean {
      const alive = reservations.delete(entry);
      if (!alive) return false;
      if (!lendable(entry.doc)) {
        changed(entry.doc);
        return false;
      }
      if (lent.get(entry.doc) === app) {
        // Già prestato alla stessa app: `lend` non avviserebbe, e la sola
        // lettura resta quella del prestito.
        changed(entry.doc);
        return true;
      }
      lend(entry.doc, app);
      return true;
    },
    cancel(): void {
      if (reservations.delete(entry)) changed(entry.doc);
    },
  };
}

/// La porta del controller, se c'è: senza (un test, una finestra che non ha
/// schede) niente è prestabile.
export function lendGate(): LendGate | null {
  return gate;
}

/// Registra la porta di chi tiene le schede, finché il disposer non la toglie.
export function provideLendGate(next: LendGate): Teardown {
  gate = next;
  return () => {
    if (gate === next) gate = null;
  };
}

/// Tiene il registro legato al vault finché `lifetime` è viva: la chiusura
/// del vault, o un vault nuovo, dimenticano ogni prestito.
export function mountLends(lifetime: Lifetime): void {
  lifetime.add(onEvent("vault_closed", () => forgetLends()));
  lifetime.add(on("vault", () => forgetLends()));
  lifetime.add(() => forgetLends());
}
