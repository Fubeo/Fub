# `fub-sdk` — Kit di sviluppo per provider e plugin

## A cosa serve

[`crates/fub-sdk`](../../crates/fub-sdk) raccoglie funzioni, costruttori e strumenti di supporto per facilitare la scrittura di provider (nativi o guest WASM) conformi a [`fub-abi`](../../crates/fub-abi).

Riesporta interamente `fub-abi` (`pub use fub_abi as abi;`), offrendo un punto di accesso unificato.

---

## Moduli e Funzionalità Principali

### 1. `ui` — Costruzione dell'Interfaccia Grafica
Offre costruttori tipizzati e helper ergonomici per generare nodi dell'albero grafico dichiarativo [`UiNode`](../../crates/fub-abi/src/ui.rs):
- Layout compositi: `stack`, `row`, `column` con spaziatura e allineamenti preimpostati.
- Elementi complessi: costruttori per `table` con colonne ordinate, `tree` per gerarchie e `empty_state` per viste vuote.
- Azioni interattive: associazione fluida di `ActionRef` con payload e intenti semantici (`Neutral`, `Primary`, `Danger`).

### 2. `ids` — Generazione Identificativi
Genera forme standard di identità sfruttando i byte casuali forniti dall'host:
- `uuid_v4` e `uuid_v7` (ordinabili temporalmente).
- Identificativi brevi e leggibili per elementi di interfaccia o sessioni temporanee.

### 3. `scan` — Scansione e Riconoscimento del Testo
Toolkit di scansione testuale leggero e indipendente da specifici motori di parsing:
- Estrazione e individuazione di etichette `#tag` e collegamenti `[[wikilink]]`.
- Utile per provider di anteprima o formati alternativi che necessitano di estrarre metadati senza dipendere da `comrak`.

### 4. `testing` — Il Banco del Lato Provider
Fornisce l'infrastruttura necessaria per collaudare un provider in isolamento assoluto:
- **`MemoryHost`**: implementazione in-memory completa di `HostApi` che simula documenti, impostazioni, storage e bus eventi su RAM, senza toccare il filesystem reale.
- **`conformance`**: suite di test pronti per validare che una data implementazione di `ViewProvider`, `IndexProvider` o `CommandProvider` rispetti gli invarianti del contratto.

---

## Esempio di Test Unitario con `MemoryHost`

```rust
use fub_sdk::testing::MemoryHost;
use fub_sdk::abi::traits::HostApi;

#[test]
fn test_provider_in_memoria() {
    let mut host = MemoryHost::new();
    host.add_document("Nota.md", "# Contenuto di Prova");

    // Il provider può leggere o eseguire query contro l'host in memoria
    let testo = host.read_document("Nota.md").expect("lettura documento");
    assert_eq!(testo, "# Contenuto di Prova");
}
```

---

## Dipendenze e Invarianti

- **Dipendenze interne**: dipende unicamente da [`fub-abi`](../../crates/fub-abi).
- **Invariante fondamentale**: `fub-sdk` **non dipende e non dipenderà mai da `fub-kernel`**.
  Essendo l'SDK una dipendenza normale di chi scrive provider (e guest WASM), includere il kernel contaminerebbe la sandbox esponendo codice interno di gestione disco e lock.
- **Presidio CI**: verificato da `fub-abi/tests/dependency_invariant.rs::the_sdk_does_not_see_the_kernel`.

---

## File chiave del modulo

- [`crates/fub-sdk/src/lib.rs`](../../crates/fub-sdk/src/lib.rs): punto di ingresso e riesportazione di `fub_abi`.
- [`crates/fub-sdk/src/ui.rs`](../../crates/fub-sdk/src/ui.rs): helper e builder per i componenti grafici.
- [`crates/fub-sdk/src/ids.rs`](../../crates/fub-sdk/src/ids.rs): generazione UUID e identificatori.
- [`crates/fub-sdk/src/scan.rs`](../../crates/fub-sdk/src/scan.rs): tokenizer per wikilink e tag.
- [`crates/fub-sdk/src/testing/mod.rs`](../../crates/fub-sdk/src/testing/mod.rs): simulatore host in memoria `MemoryHost`.
- [`crates/fub-sdk/src/testing/conformance.rs`](../../crates/fub-sdk/src/testing/conformance.rs): harness di test di conformità per provider.

---

## Se vuoi il dettaglio

- Guarda [`docs/04-plugin/05-creare-un-plugin.md`](../04-plugin/05-creare-un-plugin.md) per una guida pratica all'uso dell'SDK nella creazione di un plugin.
- Guarda [`docs/02-componenti/10-fub-testkit.md`](./10-fub-testkit.md) per conoscere il banco complementare per test end-to-end con il kernel reale.
