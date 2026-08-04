// Il **recupero** di ciò che era rimasto non salvato (§15.2): il giudizio, non
// il disegno.
//
// Sta in un file suo e accanto a `salvataggio.ts` per la stessa ragione di
// quello: la decisione che c'è qui dentro — *questa bozza va offerta, e con
// quale domanda* — si prova in mezzo secondo e senza un DOM, ed è la parte di
// questo lavoro che si può sbagliare in un modo che, guardando l'app mentre
// tutto funziona, non si vede. Un recupero si guarda una volta ogni crash: se
// sbaglia, lo si scopre nel momento peggiore.
//
// Il kernel non giudica di proposito: manda i **fatti** (`base`, `current`,
// `exists`) e tace su cosa farne, perché *tenere il mio testo o quello sul
// disco* è una domanda che si fa a una persona. Questo modulo è il posto in cui
// quei fatti diventano la domanda da fare.

import type { DraftInfo } from "../host/contract";
import type { Chiave } from "../i18n/strings";

/// Che caso è questa bozza, cioè **quale domanda va fatta**.
///
///   - `superata` — il file sul disco è già quello che la bozza contiene: non
///     c'è niente da recuperare, e mostrarla sarebbe rumore. È il caso più
///     comune di tutti, perché una chiusura ordinata salva prima di chiudere;
///   - `nuova` — la nota non esiste sul disco: la bozza è **tutto** ciò che c'è.
///     Non c'è nessuna scelta da fare, solo un testo da non perdere;
///   - `orfana` — la nota c'era e non c'è più (cancellata mentre il buffer era
///     sporco). Come `nuova` per l'urgenza, diversa per la storia: qui qualcuno
///     ha cancellato qualcosa, e ridargli il testo senza dirglielo sarebbe
///     resuscitare una nota che aveva buttato;
///   - `divergente` — la nota c'è, e il file **è cambiato** da quando il buffer
///     se n'è discostato: è l'unico caso in cui si perde qualcosa in ogni
///     scelta, quindi è l'unico che deve mostrare i due testi;
///   - `incerta` — la nota c'è, ma non si sa da cosa il buffer sia partito
///     (`base` assente). Non è `divergente` e non è `superata`: è la risposta
///     onesta quando i fatti non bastano, e va tenuta separata invece di essere
///     accorpata al caso peggiore — trattare ogni incertezza come un conflitto
///     insegna a cliccare senza leggere.
export type CasoBozza = "superata" | "nuova" | "orfana" | "divergente" | "incerta";

export function casoDi(d: DraftInfo): CasoBozza {
  if (!d.exists) return d.base == null ? "nuova" : "orfana";
  // Il file di adesso è già ciò che la bozza dice: non c'è niente da chiedere.
  // Si guarda `current` contro `base` e non i testi, perché il testo del file
  // qui non ce l'abbiamo — e chiederlo per ogni bozza vorrebbe dire aprire N
  // file per scoprire, quasi sempre, che non c'era niente da fare.
  if (d.base == null) return "incerta";
  return d.base === d.current ? "superata" : "divergente";
}

/// Le bozze che **vale la pena mostrare**, dalla più recente.
///
/// «Superata» non passa: è la stragrande maggioranza dopo una chiusura
/// ordinata, e un pannello di recupero che si apre a ogni avvio con dentro
/// niente di utile è un pannello che si impara a chiudere senza leggere — cioè
/// che non sarà letto nemmeno il giorno in cui conta.
///
/// Nemmeno una bozza **vuota** passa, e non è un caso di scuola: chi seleziona
/// tutto, cancella e poi chiude ha lasciato un buffer vuoto e sporco. Offrirgli
/// «recupera» per rimettergli il nulla non aiuta nessuno.
export function daRecuperare(drafts: DraftInfo[]): DraftInfo[] {
  return drafts
    .filter((d) => d.text.trim() !== "" && casoDi(d) !== "superata")
    .sort((a, b) => b.at - a.at);
}

/// La chiave della frase da mostrare per un caso. Una chiave per caso e non una
/// frase composta a pezzi, per la ragione dei messaggi del kernel: uno spezzone
/// tradotto e concatenato sta in piedi in una lingua e cade in quella dopo.
export const CHIAVE_CASO: Record<CasoBozza, Chiave> = {
  superata: "draft.case.superata",
  nuova: "draft.case.nuova",
  orfana: "draft.case.orfana",
  divergente: "draft.case.divergente",
  incerta: "draft.case.incerta",
};
