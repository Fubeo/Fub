# `fub-testkit` — Banco di prova del lato host

## A cosa serve

[`crates/fub-testkit`](../../crates/fub-testkit) è il banco di prova per i test di integrazione (*end-to-end*) e di sistema di Fub.

Consente di:
- Istituire un vault reale su directory temporanea isolata con ciclo di vita garantito.
- Montare un'istanza effettiva di `Workspace` (kernel reale) con formati e plugin configurabili.
- Registrare e asserire con precisione su ogni singolo evento generato dal bus eventi (`with_spy`).
- Simulare modifiche al filesystem effettuate "alle spalle del kernel" da processi esterni o da altri editor.

---

## Architettura dei Banchi di Prova: `fub-testkit` vs `fub-sdk::testing`

Fub adotta due banchi di test distinti e complementari:
1. **`fub-sdk::testing` (Lato Provider)**: usa `MemoryHost` per testare l'implementazione di un provider in isolamento puro su RAM, senza toccare il disco né dipendere dal kernel.
2. **`fub-testkit` (Lato Host)**: monta il `fub-kernel` reale su una cartella temporanea gestita da `tempfile::TempDir`, validando l'interazione tra componenti, filesystem, indicizzazione ed eventi.

---

## Come si usa: il builder `Bench` e `Mounted`

Il banco è strutturato come un builder (`Bench`) che varia su 5 assi indipendenti (radice, formati registrati, plugin, file precaricati, scansione iniziale):

```rust
use fub_testkit::Bench;
use fub_abi::event::EventKind;

#[test]
fn test_flusso_modifica_nota() {
    // 1. Configurazione del banco con spia degli eventi abilitata
    let mut banco = Bench::new()
        .with_spy()
        .with_file("Nota.md", "# Titolo Iniziale\nTesto con [[Altro]]")
        .mounts();

    // 2. Operazioni sul vault
    assert!(banco.exists("Nota.md"));
    let contenuto = banco.read("Nota.md");
    assert!(contenuto.contains("Titolo Iniziale"));

    // 3. Modifica fisica del file (simulazione agente esterno)
    banco.write("Nota.md", "# Titolo Aggiornato");

    // 4. Verifica degli eventi emessi
    let tipi_eventi = banco.event_kinds();
    assert!(tipi_eventi.contains(&EventKind::DocumentChanged));
}
```

---

## Capacità principali della struttura `Mounted`

- **Accesso disco**: `.root()` (percorso `Utf8Path`), `.write(path, text)`, `.write_byte(path, bytes)`, `.read(path)`, `.exists(path)`.
- **Ispezione eventi**: `.events()` (vettore clonabile di `Event`), `.event_kinds()` (sequenza tipizzata di `EventKind`).
- **Controllo scansione**: `.reindex()` per forzare la rilettura e reindicizzazione di tutte le note del vault.

---

## Dipendenze e Invarianti

- **Dipendenze interne**: [`fub-abi`](../../crates/fub-abi) e [`fub-kernel`](../../crates/fub-kernel).
- **Invariante fondamentale**: `fub-testkit` **non entra mai nelle dipendenze di produzione** di alcun crate. È dichiarato esclusivamente sotto `[dev-dependencies]` ed è presidiato dal test `the_test_bench_enters_no_library`.
- **Dipendenze esterne**: `camino`, `tempfile`.

---

## File chiave del modulo

- [`crates/fub-testkit/src/lib.rs`](../../crates/fub-testkit/src/lib.rs): definizione del builder `Bench` e del wrapper `Mounted`.
- [`crates/fub-testkit/src/format.rs`](../../crates/fub-testkit/src/format.rs): estrattori di testo campione (`SampleExtractor`, `SampleText`) per simulare formati personalizzati nei test.

---

## Se vuoi il dettaglio

- Guarda [`crates/fub-host/tests/concurrency.rs`](../../crates/fub-host/tests/concurrency.rs) per test pratici di concorrenza su `Custody`.
- Guarda [`crates/fub-features/tests/`](../../crates/fub-features/tests/) per esempi di test end-to-end che montano feature ufficiali con `Bench`.
