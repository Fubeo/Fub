# `wit/` — contratto WIT di Fub

Questa directory contiene il contratto **WIT** (WebAssembly Interface Type).
Esso mappa `fub-abi` (la libreria Rust che definisce l'interfaccia dei plugin).
Il contratto garantisce la validazione di una regola d'oro.
Ogni tipo presente in un trait risulta sempre esprimibile come record, variant o enum WIT.
Questo approccio rende meccanica l'implementazione del runtime WASM (l'ambiente di esecuzione isolato) di [M5](../milestones/M5-wasm-runtime.md).
Assicura inoltre la serializzazione automatica di tutte le firme.

- **Contratto attuale**: [`fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit) — package `fub:abi@0.1.0`.
- **Versioni storiche**: [`frozen/`](wit-congelato.md).
- **Mapping tipo-abi → WIT**: [traits.md](traits.md).
- **Modello dati**: [data-model.md](data-model.md).

## Ciclo di vita ("vivo da M2, freeze a M4")

- **M2 (ora)** (la milestone corrente): Il WIT evolve assieme a `fub-abi`.
  La superficie dell'interfaccia cambia liberamente.
  Un test di conformità analizza la coerenza durante ogni `cargo test`.
  Il fallimento del test segnala una divergenza tra i due componenti.
- **[M4](../milestones/M4-wit-hardening.md)** (la milestone di stabilizzazione): La superficie viene **congelata**.
  I futuri cambiamenti seguono un approccio additivo e versionato.
  I cambiamenti incompatibili comportano un bump (un incremento di versione) del package.

## Conformità

**Test**: [`crates/fub-abi/tests/wit_conformance.rs`](../../crates/fub-abi/tests/wit_conformance.rs).

Il test convalida la corrispondenza esatta tra le interfacce.
Il modulo analizza `abi.wit` mediante `wit-parser` (uno strumento di parsing formale).
L'analisi confronta i nomi e i tipi dichiarati effettivi.
Il pacchetto `wit-parser` opera come **dev-dependency** (una dipendenza limitata allo sviluppo).
Questo garantisce l'invariante di `fub-abi` sulle dipendenze standard.
Il file [`dependency_invariant.rs`](../../crates/fub-abi/tests/dependency_invariant.rs) presidia quest'ultima regola.

Il documento [traits.md](traits.md) ("Come la conformità è verificata") approfondisce i seguenti aspetti:

- Le quattro direzioni di pressione.
- La deduzione automatica dei tipi attesi.
- Il test-del-test (una convalida basata su quattordici divergenze di prova).

## Additività: l'altra promessa, l'altro test

**Test**: [`crates/fub-abi/tests/wit_additivity.rs`](../../crates/fub-abi/tests/wit_additivity.rs).

L'additività rappresenta la garanzia di retrocompatibilità.
La conformità valuta esclusivamente lo stato presente di abi e WIT.
Rinominare un campo in tutti e due mantiene l'esito positivo della conformità.
Questa azione causa tuttavia la rottura dei plugin compilati.
La regola `abi_compatible` (la funzione di verifica a runtime) ammette questi cambiamenti quando la minor (la seconda cifra di versione semantica) resta identica.

Il sistema archivia una copia del contratto per ogni versione all'interno di [`frozen/`](wit-congelato.md).
Un test specifico valida il supporto attuale verso ogni iterazione storica.
Le regole di compatibilità storica si applicano a:

- Campi
- Casi
- Alias
- Firme
- World

Questi elementi richiedono il mantenimento esatto del nome e della posizione.
L'inserimento di novità avviene esclusivamente in coda.
Il documento [`frozen/README.md`](wit-congelato.md) elenca le regole complete e le istruzioni di aggiornamento.

## Convenzioni

Le regole seguenti definiscono la traduzione dei tipi tra l'ecosistema Rust e il formato WIT.

- **Nomenclatura**:
  - I nomi WIT usano il formato **kebab-case**.
  - Essi corrispondono direttamente ai nomi Rust.
  - Le varianti serde impiegano `rename_all = "snake_case"`.
  - Questo attributo mappa in proporzione 1:1 sul formato kebab WIT.
- **Valori JSON liberi**:
  - Tali valori comprendono frontmatter, `attrs` di `Custom` (una via d'uscita per dati arbitrari), argomenti dei comandi e storage dei plugin.
  - Questi elementi attraversano il confine usando `type json = string`.
  - La struttura preserva la flessibilità dell'escape hatch (il meccanismo di fallback).
  - Il team confermerà questa decisione al momento del freeze di M4.
- **Payload di variante**:
  - Le varianti con molteplici campi usano record ausiliari.
  - Esempi di record: `block-heading`, `link-target-wiki`, `ui-stack`.
  - Una `variant` WIT accetta un solo tipo per ogni caso.
- **Alberi ricorsivi**:
  - Le strutture (`block`, `inline`, `ui-node`) diventano un'arena al confine.
  - Un'arena consiste in una lista piatta di nodi e indici `u32` (`block-ref`, `inline-ref`, `ui-ref`).
  - Il linguaggio WIT supporta esclusivamente strutture piatte.
  - L'utilizzo dell'arena adatta le strutture dati complesse a questo vincolo.
  - I tipi Rust nativi rimangono dei veri alberi.
  - Il modulo `fub_abi::arena` gestisce l'intera conversione.
  - Il proxy WASM di M5 (il livello intermedio di esecuzione) invocherà questa funzione.
  - Il documento [traits.md](traits.md) ("Alberi ricorsivi al confine") approfondisce i motivi architetturali per la scelta dell'arena rispetto a una stringa JSON.
- **Keyword riservate**:
  - Le parole `list`, `result` e `from` sono **keyword WIT**.
  - Il carattere escape `%` precede queste parole nei nomi di variante o di campo.
  - I nomi Rust mantengono la propria sintassi originale.
