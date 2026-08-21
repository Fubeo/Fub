# `wit/` — contratto WIT di Fub

Questa directory contiene il contratto **WIT** (WebAssembly Interface Type), che
è `fub-abi` — la libreria Rust che definisce l'interfaccia dei plugin —
riscritto una seconda volta in un'altra lingua.

Serve a validare una regola d'oro: **ogni tipo che compare in un trait deve
essere esprimibile come record, variant o enum WIT**. Finché la regola tiene, il
runtime WASM di [M5](../milestones/M5-wasm-runtime.md) è lavoro meccanico, e
tutte le firme si serializzano da sole. Dal 2026-08-15 la promessa ha un
consumatore che la attraversa **in esecuzione** e non solo un validatore che la
legge: `crates/fub-wasm-host` genera i binding lato host da **questo** file — il
vivo, non la copia congelata — e ci monta sopra un componente.

- **Contratto attuale**: [`fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit) —
  package `fub:abi@0.1.1`.
- **Versioni storiche**: [`frozen/`](wit-congelato.md).
- **Mapping tipo-abi → WIT**: [traits.md](traits.md).
- **Modello dati**: [data-model.md](data-model.md).

## Ciclo di vita ("vivo da M2, freeze a M4")

- **M2**: il WIT nasce vivo accanto a `fub-abi` e la superficie cambia
  liberamente. Un test di conformità gira a ogni `cargo test` e diventa rosso
  appena i due divergono.
- **[M4](../milestones/M4-wit-hardening.md) (ora)**: la superficie è
  **congelata** a `fub:abi@0.1.1`. Da lì in poi si cresce solo per aggiunta, e
  una rottura vuole un bump di versione del package.

## Conformità

**Test**:
[`crates/fub-abi/tests/wit_conformance.rs`](../../crates/fub-abi/tests/wit_conformance.rs).

Il test legge `abi.wit` con `wit-parser` e confronta nomi e tipi con quelli
dichiarati davvero in Rust. `wit-parser` è una **dev-dependency**: così
`fub-abi` non se lo porta dietro fra le dipendenze normali, e la sua invariante
resta intera. A presidiarla è
[`dependency_invariant.rs`](../../crates/fub-abi/tests/dependency_invariant.rs).

Il capitolo "Come la conformità è verificata" di [traits.md](traits.md) entra
nel dettaglio di tre cose:

- Le quattro direzioni di pressione.
- Come i tipi attesi si deducono invece di essere scritti a mano.
- Il test-del-test: quattordici divergenze finte, per vedere se il test le vede.

## Additività: l'altra promessa, l'altro test

**Test**:
[`crates/fub-abi/tests/wit_additivity.rs`](../../crates/fub-abi/tests/wit_additivity.rs).

La conformità guarda **oggi**: abi e WIT devono dire la stessa cosa adesso.
Rinominare un campo in tutti e due la lascia verde — e intanto ogni plugin già
compilato si rompe. La regola `abi_compatible`, che gira a runtime, non se ne
accorge nemmeno lei: accetta tutto finché la minor (la seconda cifra della
versione semantica) resta la stessa.

L'additività copre quel buco. Di ogni versione si archivia una copia del
contratto in [`frozen/`](wit-congelato.md), e un test verifica che l'host di
oggi regga ancora ognuna di quelle copie. Devono restare **col nome e nella
posizione di prima**:

- Campi
- Casi
- Alias
- Firme
- World

Il nuovo si mette solo in coda. Le regole per intero, e come si aggiorna la
linea di base, stanno in [`frozen/README.md`](wit-congelato.md).

## Convenzioni

Come si traducono i tipi fra Rust e WIT.

- **Nomenclatura**:
  - I nomi WIT sono in **kebab-case** e corrispondono a quelli Rust.
  - Le varianti serde usano `rename_all = "snake_case"`, che sul kebab WIT mappa
    1:1.
- **Valori JSON liberi**:
  - Sono il frontmatter, gli `attrs` di `Custom` (la via d'uscita per dati
    arbitrari), gli argomenti dei comandi e lo storage dei plugin.
  - Attraversano il confine come `type json = string`, così l'escape hatch resta
    flessibile.
  - La scelta si riconferma al freeze di M4.
- **Payload di variante**:
  - Una `variant` WIT ammette un tipo solo per caso.
  - Le varianti con più campi usano quindi un record ausiliario:
    `block-heading`,
    `link-target-wiki`, `ui-stack`.
- **Alberi ricorsivi**:
  - WIT sa solo strutture piatte, quindi `block`, `inline` e `ui-node` al
    confine diventano un'**arena**: una lista piatta di nodi più indici `u32`
    (`block-ref`, `inline-ref`, `ui-ref`).
  - I tipi Rust nativi restano alberi veri. La conversione sta tutta in
    `fub_abi::arena`, e il proxy WASM di M5 chiamerà quella.
  - Perché un'arena e non una stringa JSON lo spiega il capitolo "Alberi
    ricorsivi al confine" di [traits.md](traits.md).
- **Keyword riservate**:
  - `list`, `result` e `from` sono **keyword WIT**.
  - Nei nomi di variante o di campo si scappano con `%`. I nomi Rust restano
    quelli che sono.
