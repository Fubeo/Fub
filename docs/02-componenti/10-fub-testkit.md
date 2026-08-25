# `fub-testkit` — banco del lato host

[`crates/fub-testkit/`](../../crates/fub-testkit) costruisce un vault reale su
una directory temporanea e vi monta il kernel. Serve ai test di integrazione che
devono osservare filesystem, registri, indicizzazione ed eventi insieme.

Non è una dipendenza di produzione. I crate che lo usano lo dichiarano soltanto
fra le dipendenze di sviluppo.

## I due banchi

| Banco | Uso |
|---|---|
| `fub-sdk::testing` | Prova un provider isolato contro un `MemoryHost`. |
| `fub-testkit` | Prova componenti e flussi contro un `Workspace` reale. |

## Costruire un banco

`Bench` permette di scegliere in modo indipendente:

- radice temporanea o directory fornita dal test;
- formati registrati;
- feature di base o plugin di terzi dichiarati;
- file presenti prima della prima scansione;
- spia degli eventi;
- scansione iniziale automatica o manuale.

Esempio:

```rust
use fub_testkit::Bench;

let mut banco = Bench::new()
    .with_file("Nota.md", "# Titolo")
    .with_spy()
    .mounts();

assert!(banco.exists("Nota.md"));

// Scrive direttamente sul disco, come farebbe un programma esterno.
banco.write("Nota.md", "# Titolo aggiornato");

// Il kernel vede la modifica quando il test lo fa risincronizzare.
banco.reindex().expect("nuova scansione");
assert!(!banco.events().is_empty());
```

`write` e `write_byte` lavorano deliberatamente alle spalle del kernel. Non
emettono da soli un evento di modifica: il test deve eseguire `reindex` oppure
montare e pilotare il watcher appropriato.

## API principali

### `Bench`

- `new` e `on` scelgono la radice;
- `with_format`, `without_format` e `with_extension` configurano i formati;
- `with_plugin`, `with_plugins` e `with_third_party_plugin` dichiarano identità e fiducia;
- `with_file` semina la directory;
- `with_spy` registra un `EventHandler` che conserva le notifiche;
- `without_scan` lascia al test il controllo della prima scansione;
- `mounts` restituisce il banco pronto.

### `Mounted`

- espone `root`, `write`, `write_byte`, `read` ed `exists` per il disco;
- espone `events`, `event_kinds` e `forgets_events` per la spia;
- `adapt` applica builder che consumano il `Workspace`;
- implementa `Deref` e `DerefMut` verso il kernel montato.

Quando la scansione iniziale è automatica, gli eventi prodotti durante la
preparazione vengono cancellati prima che `mounts` restituisca il banco. Chi
deve osservarli usa `without_scan`, monta, poi avvia esplicitamente la scansione.

## Dipendenze e invariante

Il crate dipende da `fub-abi`, `fub-kernel`, `camino`, `serde_json` e
`tempfile`. Un test di dipendenza verifica che nessuna libreria di produzione lo
importi normalmente.
