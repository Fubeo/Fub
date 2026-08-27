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

import type { DraftInfo, WriteBase } from "../host/contract";
import type { Key } from "../i18n/strings";

/// Che caso è questa bozza, cioè **quale domanda va fatta**.
///
///   - `superata` — il file sul disco è già quello che la bozza contiene: non
///     c'è niente da recuperare, e mostrarla sarebbe rumore. Questo caso non è
///     deducibile dalle sole impronte di `DraftInfo`, ma resta nominato per le
///     risposte che arrivassero già giudicate da una fonte più ricca;
///   - `nuova` — la nota non esiste sul disco: la bozza è **tutto** ciò che c'è.
///     Non c'è nessuna scelta da fare, solo un testo da non perdere;
///   - `orfana` — la nota c'era e non c'è più (cancellata mentre il buffer era
///     sporco). Come `nuova` per l'urgenza, diversa per la storia: qui qualcuno
///     ha cancellato qualcosa, e ridargli il testo senza dirglielo sarebbe
///     resuscitare una nota che aveva buttato;
///   - `intatta` — la nota c'è, e il file **non è cambiato** da quando il
///     buffer se n'è discostato: la bozza è l'unica copia delle battute nuove,
///     quindi va offerta senza chiamarla conflitto;
///   - `divergente` — la nota c'è, e il file **è cambiato** da quando il buffer
///     se n'è discostato: è l'unico caso in cui si perde qualcosa in ogni
///     scelta, quindi è l'unico che deve mostrare i due testi;
///   - `incerta` — la nota c'è, ma non si sa da cosa il buffer sia partito
///     (`base` assente). Non è `divergente` e non è `superata`: è la risposta
///     onesta quando i fatti non bastano, e va tenuta separata invece di essere
///     accorpata al caso peggiore — trattare ogni incertezza come un conflitto
///     insegna a cliccare senza leggere.
export type DraftCase = "superata" | "nuova" | "orfana" | "intatta" | "divergente" | "incerta";

export function caseOf(d: DraftInfo): DraftCase {
  if (!d.exists) return d.base == null ? "nuova" : "orfana";
  // `base` è la revisione del file da cui la bozza si è discostata, mentre
  // `current` è la revisione del file adesso. Se coincidono il file è rimasto
  // intatto: la bozza è l'unica copia delle battute non salvate e va offerta.
  // Se divergono c'è invece un conflitto reale. Si confrontano le impronte e
  // non i testi, perché il testo del file qui non ce l'abbiamo — e chiederlo
  // per ogni bozza vorrebbe dire aprire N file per scoprire la stessa cosa.
  if (d.base == null) return "incerta";
  return d.base === d.current ? "intatta" : "divergente";
}

/// Le bozze che **vale la pena mostrare**, dalla più recente.
///
/// «Superata» non passa: il file contiene già ciò che la bozza dice. Una bozza
/// con `base === current`, invece, passa proprio perché il file è rimasto
/// intatto e il testo non salvato esiste solo nel buffer di crash.
///
/// Nemmeno una bozza **vuota** passa, e non è un caso di scuola: chi seleziona
/// tutto, cancella e poi chiude ha lasciato un buffer vuoto e sporco. Offrirgli
/// «recupera» per rimettergli il nulla non aiuta nessuno.
export function toRecover(drafts: DraftInfo[]): DraftInfo[] {
  return drafts
    .filter((d) => d.text.trim() !== "" && caseOf(d) !== "superata")
    .sort((a, b) => b.at - a.at);
}

/// La chiave della frase da mostrare per un caso. Una chiave per caso e non una
/// frase composta a pezzi, per la ragione dei messaggi del kernel: uno spezzone
/// tradotto e concatenato sta in piedi in una lingua e cade in quella dopo.
export const CASE_KEY: Record<DraftCase, Key> = {
  "superata": "draft.case.superata",
  "nuova": "draft.case.nuova",
  "orfana": "draft.case.orfana",
  "intatta": "draft.case.intatta",
  "divergente": "draft.case.divergente",
  "incerta": "draft.case.incerta",
};

/// L'owner di una sessione documento, per la parte che il ricongiungimento
/// vede e aggiorna.
///
/// È la firma minima di `DocumentSession`: ciò che la decisione non guarda
/// non c'è, mentre la coda, i timer e il resto dello stato restano privati.
export interface DraftBuffer {
  readonly dirty: boolean;
}

export interface DraftBufferStore {
  get(doc: string): DraftBuffer | undefined;
  restore(doc: string, text: string, base: WriteBase): void;
}

/// Il ricongiungimento, come decisione sul buffer: quali bozze rientrano nel
/// loro documento, e con che testo.
///
/// È la metà di `recoverDrafts` che si prova senza un DOM: riceve un owner di
/// sessioni e lo muta — la bozza **sostituisce** la copia pulita che c'era,
/// sporcandola, e se il documento non era aperto la sessione nasce — e
/// restituisce le bozze rientrate, una per documento. Una sessione **sporca**
/// invece non si tocca: porta un'identità diversa — un testo battuto dopo, in
/// questa sessione — e sovrascriverlo la farebbe sparire; la bozza resta orfana
/// sul disco. E la sessione sporca che il rientro produce ferma la voce
/// successiva che nomina lo stesso documento: il ricongiungimento è **uno** solo,
/// il documento giusto — il suo.
export function rejoinDrafts(
  drafts: DraftInfo[],
  buffers: DraftBufferStore,
): DraftInfo[] {
  const rejoined: DraftInfo[] = [];
  for (const b of drafts) {
    // Solo se nessuno tiene già quel documento **sporco** in questa sessione:
    // una sessione sporca porta un testo più recente della bozza — un'identità
    // diversa — e sovrascriverlo la farebbe sparire. Una sessione pulita è
    // invece solo il disco riletto da poco, e la bozza è più nuova di lei.
    if (buffers.get(b.doc)?.dirty) continue;
    buffers.restore(
      b.doc,
      b.text,
      b.base === null ? { kind: "dictated" } : { kind: "descends_from", value: b.base },
    );
    rejoined.push(b);
  }
  return rejoined;
}
