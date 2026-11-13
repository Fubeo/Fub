// La riga dei dati sotto il titolo di una nota: quando è stata modificata,
// quante note la citano e quali etichette porta.
//
// Tre letture piccole sulle porte di oggi, nessuna porta nuova: le etichette
// e i backlink dal canale dati (`host/query.ts`), l'ultima modifica
// dall'anagrafe della cartella della nota. Chi possiede i dati è l'indice;
// qui si mettono insieme e si rileggono quando l'indice può essere cambiato:
// all'apertura, dopo un salvataggio riuscito della nota (`document_changed`,
// il fatto che il kernel ha scritto) e al segnale `documents`. Mai a ogni
// battuta: il testo che si scrive non passa di qui.
//
// La riga è un ornamento: una lettura che fallisce lascia vuota la sua parte
// e non dice «guasto».

import type { Page } from "../host/contract";
import { backlinkCount, noteTags, vaultEntries } from "../host/query";
import { parentOf } from "../rules/organizer";
import { Race } from "../ui/race";
import { onEvent } from "./kernel";
import { on } from "./store";

/// I dati di una nota. Una parte che non si sa è vuota: `modified` `null`
/// (la nota non è nell'anagrafe, o non ha risposto), `links` 0, `tags` [].
export interface NoteFacts {
  /// L'ultima modifica, in millisecondi unix.
  readonly modified: number | null;
  /// Quante note la citano.
  readonly links: number;
  /// Le etichette, coi nomi dell'indice (senza `#`).
  readonly tags: readonly string[];
}

/// Le tre letture, una per parte: separate perché una che fallisce non porti
/// via le altre, e sostituibili nei test.
export interface NoteFactsPorts {
  tags(doc: string): Promise<readonly string[]>;
  links(doc: string): Promise<number>;
  modified(doc: string): Promise<number | null>;
}

/// La finestra dell'anagrafe in cui si cerca la nota: la sua cartella, un
/// livello solo. Una cartella con più note di così lascia senza data quelle
/// che stanno oltre, e la riga non scrive il tempo.
export const ENTRIES_WINDOW: Page = { offset: 0, limit: 1000 };

/// L'ultima modifica di `doc` dall'anagrafe della sua cartella, o `null` se
/// la nota non c'è (un file appena arrivato, una nota mai salvata). Un tempo
/// a zero è un disco che non l'ha dato, non il primo gennaio 1970.
export async function modifiedFromEntries(doc: string): Promise<number | null> {
  const page = await vaultEntries(ENTRIES_WINDOW, "document", { path: parentOf(doc), descendants: false });
  const mtime = page.items.find((entry) => entry.id === doc)?.mtime;
  return mtime !== undefined && mtime > 0 ? mtime : null;
}

/// Le porte vere: l'indice e l'anagrafe del vault aperto. Le funzioni si
/// leggono a ogni chiamata, non quando il modulo si carica.
export const INDEX_PORTS: NoteFactsPorts = {
  tags: (doc) => noteTags(doc),
  links: (doc) => backlinkCount(doc),
  modified: (doc) => modifiedFromEntries(doc),
};

/// I tre dati di `doc`, ognuno vuoto se la sua lettura fallisce.
export async function readNoteFacts(doc: string, ports: NoteFactsPorts = INDEX_PORTS): Promise<NoteFacts> {
  const [modified, links, tags] = await Promise.all([
    ports.modified(doc).catch(() => null),
    ports.links(doc).catch(() => 0),
    ports.tags(doc).catch((): readonly string[] => []),
  ]);
  return { modified, links: Math.max(0, links), tags: [...tags] };
}

/// Vero se non c'è niente da scrivere: la riga allora non c'è.
export function noFacts(facts: NoteFacts): boolean {
  return facts.modified === null && facts.links === 0 && facts.tags.length === 0;
}

/// Lo stesso contenuto, per non ridisegnare una riga uguale.
export function sameFacts(a: NoteFacts | null, b: NoteFacts | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.modified === b.modified && a.links === b.links
    && a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);
}

/// Quando rileggere: `again` a ogni occasione, `doc()` per sapere se un evento
/// riguarda la nota. Torna lo smontaggio.
export type NoteFactsWatch = (doc: () => string, again: () => void) => () => void;

/// Le occasioni vere: il segnale `documents`, e il kernel che ha scritto la
/// nota (da sola o in un lotto) o l'ha rinominata.
export const INDEX_WATCH: NoteFactsWatch = (doc, again) => {
  const stops = [
    on("documents", again),
    onEvent("document_changed", (event) => {
      if (event.id === doc()) again();
    }),
    onEvent("batch_ended", (event) => {
      if (event.changed.includes(doc())) again();
    }),
    onEvent("document_renamed", (event) => {
      if (event.to === doc() || event.from === doc()) again();
    }),
  ];
  return () => stops.forEach((stop) => stop());
};

/// Ciò che una superficie riceve per mostrare la riga: chi segue i dati di
/// una nota, e i due gesti della riga.
export interface NoteFactsSource {
  /// Segue i dati della nota `doc()` (l'id si rilegge a ogni giro: una
  /// rinomina lo cambia) e chiama `draw` con ogni risposta nuova. Un giro
  /// nuovo supera il vecchio: una risposta vecchia non arriva mai dopo una
  /// nuova. Torna lo smontaggio.
  follow(doc: () => string, draw: (facts: NoteFacts) => void): () => void;
  /// Il clic su «3 collegamenti»: la scheda Collegamenti dell'ispettore.
  openLinks(): void;
}

/// Segue i dati di `doc()` finché non si chiama lo smontaggio: un primo giro
/// subito, poi uno a ogni occasione di `watch`.
export function followNoteFacts(
  doc: () => string,
  draw: (facts: NoteFacts) => void,
  ports: NoteFactsPorts = INDEX_PORTS,
  watch: NoteFactsWatch = INDEX_WATCH,
): () => void {
  const race = new Race();
  let stopped = false;
  const again = (): void => {
    if (stopped) return;
    void race.last(async (expected) => {
      const facts = await expected(readNoteFacts(doc(), ports));
      if (!stopped) draw(facts);
    });
  };
  const stopWatching = watch(doc, again);
  again();
  return () => {
    if (stopped) return;
    stopped = true;
    race.cancel();
    stopWatching();
  };
}

/// La sorgente vera, con il gesto dei collegamenti dato da chi monta.
export function noteFactsSource(openLinks: () => void): NoteFactsSource {
  return {
    follow: (doc, draw) => followNoteFacts(doc, draw),
    openLinks,
  };
}
