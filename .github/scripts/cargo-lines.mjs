// **Le righe di un `Cargo.toml`**, per i guard che le leggono senza un
// lettore TOML.
//
// Cinque lettori di questa cartella — `workspace-members.mjs`,
// `check-cargo-versions.mjs`, `check-cargo-feature-default.mjs`,
// `check-crate-type.mjs` e `check-dev-profile.mjs` — riconoscevano
// l'intestazione di una tabella con la stessa espressione, copiata cinque
// volte. La regola sta qui; ciò che ogni guard fa di una sezione, e come
// dichiara ciò che non sa leggere, resta nel guard.
//
// Il modulo non ha effetti all'import: niente file letti, niente `process`,
// così chi lo importa stampa ed esce esattamente come prima.

/**
 * Il nome della tabella di una riga `[…]` o `[[…]]`, o `null` se la riga non
 * lo è.
 *
 * `[[example]]` è una riga di tabella anche quando nessun guard la legge:
 * **chiude** la sezione precedente, e trattarla come una riga qualunque farebbe
 * leggere gli esempi come parte di quella sezione.
 */
export function sectionName(line) {
  const m = line.match(/^\[\[?([^\]]+)\]\]?\s*$/);
  return m === null ? m : m[1].trim();
}
