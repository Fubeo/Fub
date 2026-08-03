// **Le note aperte di recente**, e nient'altro: la memoria corta che il quick
// switcher mostra a mani vuote (§21.5).
//
// # Perché è in memoria, e perché è poco
//
// Perché una cronologia è materia della §21.7 e del capitolo 23, non di questa
// voce: *cosa si è cercato e cosa si è aperto* dice di una persona più di cosa
// ha scritto, e la voce che la governa la vuole **opzionale e spegnibile**.
// Quella decisione qui non si anticipa. Ciò che si può fare senza anticiparla è
// una lista che vive quanto la finestra: si perde chiudendo l'app, non tocca il
// disco, e non c'è niente da spegnere perché non c'è niente che resti. Il
// giorno in cui la §21.7 deciderà dove si scrive una cronologia, questo modulo
// è il posto che diventa il suo lettore — non un secondo posto da riconciliare.
//
// # Perché sta in `state/` e non nel pannello
//
// Perché è la regola del §1.2 (e la ragione per cui `rules/risultati.ts`
// esiste): ciò che si prova senza un DOM non abita dentro un pannello. Qui la
// cosa da provare è una riga sola — *riaprire una nota la porta in cima e non
// la duplica* — e in un pannello si proverebbe solo aprendo l'app.
import { documentiEsistenti } from "../host/query";
import { on } from "./store";

/// Quante se ne ricordano.
///
/// Dieci: è un elenco che si guarda tutto in un colpo d'occhio senza scorrere,
/// e la memoria corta serve a tornare su ciò che si stava facendo — non a
/// consultare uno storico, che è un'altra cosa e avrà un altro posto (§21.7).
const QUANTE = 10;

let recenti: string[] = [];

/// La lista con `doc` in cima, senza doppioni e lunga al più `max`.
///
/// Pura, perché è la sola decisione che questo modulo prende: una nota già
/// vista **si sposta** in cima invece di comparire due volte, che è la
/// differenza fra una memoria corta e un registro di accessi.
export function conInCima(lista: string[], doc: string, max = QUANTE): string[] {
  return [doc, ...lista.filter((d) => d !== doc)].slice(0, max);
}

/// Le note aperte di recente, dalla più recente.
///
/// Possono contenere note che **non ci sono più** — rinominate o cestinate
/// mentre l'app era aperta —, e non si ripuliscono qui: chi le mostra le passa
/// da `documentiEsistenti`, che è una domanda sola e risponde su tutte insieme.
/// Ascoltare `document_removed` e `document_renamed` sarebbe un secondo posto
/// che deve restare d'accordo col vault, cioè la cosa che la 0082 rifiuta per
/// gli elenchi tenuti dagli eventi.
export function noteRecenti(): string[] {
  return recenti;
}

/// Le recenti che esistono **ancora**, nell'ordine in cui si ricordano.
///
/// Una nota rinominata o cestinata mentre l'app era aperta è ancora nella
/// memoria corta, e proporla vorrebbe dire aprire un errore invece di una nota.
/// La domanda è **una sola per tutte** (`documentiEsistenti`, cioè la foglia
/// `docs` del canale dati) e non un ascolto degli eventi di rinomina: uno stato
/// tenuto d'accordo col vault dagli eventi è ciò che la 0082 rifiuta, e qui non
/// serve nemmeno — le recenti si guardano quando si apre una modale, cioè nel
/// momento in cui una domanda in più non la sente nessuno.
///
/// La usano tutte e due le superfici che propongono dei nomi: il quick switcher
/// a query vuota e l'autocompletamento dei wikilink su `[[` appena aperto.
export async function noteRecentiEsistenti(): Promise<string[]> {
  if (recenti.length === 0) return [];
  const vive = await documentiEsistenti(recenti);
  return recenti.filter((d) => vive.has(d));
}

/// Solo per i banchi, e per chi chiude un vault: la memoria corta è di **questo**
/// vault, e portarsela in quello dopo mostrerebbe i path di un altro albero.
export function scordaRecenti(): void {
  recenti = [];
}

/// Comincia a ricordare.
///
/// Si iscrive ad `active-doc`, che è il segnale del documento del riquadro col
/// fuoco: «aperto di recente» vuol dire *guardato*, e il fuoco è chi lo sa —
/// non `openDocument`, che non viene chiamato quando si torna su una tab già
/// aperta o si cambia riquadro.
export function ricordaLeAperture(): void {
  on("active-doc", (doc) => {
    if (doc !== null) recenti = conInCima(recenti, doc);
  });
  on("vault", () => scordaRecenti());
}
