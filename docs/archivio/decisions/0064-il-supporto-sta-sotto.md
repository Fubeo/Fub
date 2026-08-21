# 0064 — Il supporto sta sotto, e la specie di una voce non segue il link

**In breve:** l'accesso al file system per le note è isolato in un tratto unico
`VaultStorage`, necessario per cifratura e altri supporti virtuali.

|  |  |
|---|---|
| **Decisa** | 2026-08-01 |
| **Origine** | `todo.md` §15.1 (seduta 15) — **meno una casella** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/15-il-disco.md) ·
[le voci a leva più alta](../roadmap/leva.md) ·
[la mappa del disco](../architecture/on-disk-layout.md)

---

## Il problema

Fino ad oggi, un vault era solo una cartella sul filesystem e il codice usava
`std::fs` ovunque. Questo non è un difetto finché il filesystem è uno solo.
Tuttavia, **cinque** famiglie di FEATURES aspettano una soluzione che richiede
astrazione:
- La cifratura at-rest (23.1).
- I vault remoti e il sync (18.1).
- La PWA su OPFS (26.3).
- I vault read-only e su share di rete (3.1).
- I drive rimovibili (2.3).

La cifratura decide la forma: la stratificazione funziona **solo se sta sotto**
`data_*` e `vault_*`. Un plugin di cifratura farebbe attraversare il confine a
ogni byte due volte, lasciando l'indice di ricerca in chiaro.

## La decisione

**Il kernel tocca i byte di un vault da un posto solo: `kernel/storage.rs`.**

```rust
pub trait VaultStorage: Send + Sync {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>>;
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()>;
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()>;
    fn remove(&self, path: &Utf8Path) -> io::Result<()>;
    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>>;
    fn stat(&self, path: &Utf8Path) -> io::Result<Stat>;
    fn exists(&self, path: &Utf8Path) -> bool { /* default: stat().is_ok() */ }
    fn remove_dir_all(&self, dir: &Utf8Path) -> io::Result<()> { /* default */ }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()>;
}

pub struct FsStorage;   // il filesystem, come è sempre stato
pub struct MemStorage;  // la seconda implementazione
```

- Il [`Vault`](../../crates/fub-kernel/src/vault.rs) lo tiene in un `Arc` e lo
  presta a chi scrive senza passare per un `DocId`.
- Ne beneficiano: lo spazio dati dei plugin (`data_read`, `data_write`,
  `data_list`, `data_remove` in `host/kernel.rs` e `host/read.rs`), l'elenco
  degli spazi dati (`documents.rs`), la camminata di `collect_data_files`
  (`workspace.rs`) e la migrazione dello stato (`docdata.rs`). Sotto la linea
  del vault, `std::fs` sparisce.
- Il trait è interno al kernel. Non scade col freeze, come già detto dalla
  [leva](../roadmap/leva.md).

## Le decisioni prese, da NON ridiscutere senza motivo

### La durabilità non entra qui

- Il write di `FsStorage` è ancora una `std::fs::write`.
- La durabilità è coperta dal
  [§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery), e la seduta
  anticipa il §15.1 esattamente per permettere al §15.2 di scendere dentro
  questa funzione. Il costo di anticiparla non sarebbe stato zero.
- Riscrivere con temp+rename su una nota dell'utente cambia inode a ogni
  salvataggio. Non si nota su un file di configurazione (`write_atomic` lo fa
  già dalla [0036](0036-le-impostazioni-e-i-tre-stati.md)), ma si vede sui file
  utente.
- La classe di un dato ("si può buttare o no") non entra qui: la
  [0048](0048-una-radice-sola.md) ha già deciso che sta nel path.

### Il `MemStorage` non è per i test e2e

- Spostare i test e2e in memoria lavora contro il §15.2. I test di durabilità
  devono restare su un filesystem vero (`FsStorage`).
- Il `MemStorage` esiste per essere il **secondo** cliente del trait, e per
  reggere i test unitari di livello superiore.

### Sette operazioni e due default

- `exists` e `remove_dir_all` hanno un default composto dalle altre. Chiederle
  come capacità extra obbligherebbe i supporti futuri a riscriverle (come
  insegna il [§7.1](0021-il-confine.md) e il §6.2). `FsStorage` le sovrascrive,
  altri possono ignorarle.
- La creazione delle cartelle mancanti è **dentro** `write` e `rename`.
  Ripeterla a carico di chi chiama a **cinque** posti aumentava i rischi di
  errori futuri.

### Il recinto non si sposta qui

- `VaultStorage` prende path assoluti. Chi decide i permessi resta
  `Workspace::plugin_data_path`. Ad esempio `../../etc/passwd` viene fermato lì.

### Gli errori

- Gli errori sono `io::Error`, non `KernelError`. Il contesto viene aggiunto da
  chi chiama: `KernelError::Io { path, source }`.

## Trovato per strada

- **`file_type()` e `metadata()` sono diverse.** Su una voce di elenco,
  `file_type()` non segue i symlink. La scansione del vault usava la prima,
  mentre `walk_trash` e `collect_data_files` usavano la seconda.
- **Evitata un'asimmetria silenziosa.** Usare `metadata()` per tutto avrebbe
  fatto seguire i symlink alla scansione senza dirlo.

Si usa una terza variante:

```rust
pub enum EntryKind { File, Dir, Other }
```

- La specie di una voce di elenco non segue il link (arriva come `Other`). Uno
  `stat` invece lo segue. Questo evita il terzo ramo implicito di un `if`.
- `EntryKind::Other` sarà il punto in cui il [§15.6](../roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione) deciderà diversamente, dato che la [0058](0058-un-nome-che-nasce.md) aveva demandato a un `IgnorePolicy` l'ignorare o meno il comportamento di `std::fs`.

## Verifica (I presidi in `crates/fub-kernel/tests/il_supporto.rs`)

Tre test presiedono a **tre** cose diverse:
1. **`le_due_implementazioni_rispondono_uguale`**: prova il tratto.
2. **`un_vault_intero_su_un_supporto_che_non_e_il_disco`**: prova che il kernel
   non scavalchi l'astrazione, facendo un giro intero su `MemStorage`
   (scrittura, scansione, rinomina, cestino, sidecar, svuotamento). Un
   `std::fs::write` dimenticato fallisce qui.
3. **`un_collegamento_non_e_la_cosa_a_cui_punta`**: presidia la gestione
   corretta dei symlink. Nessun test esistente (`fedelta_del_testo.rs`,
   `anagrafe.rs`) è stato toccato.

## Cosa resta scoperto

- **Una casella residua (aspetta il §15.2):** dentro `.fub/` scrivono ancora con
  `std::fs` tre file: `organization.rs` (`workspace.json`), `settings.rs`
  (`settings.json`) ed `entries.rs` (`entries.json`). Tutti e tre usano già
  `write_atomic`. Passarli a `VaultStorage::write` ora toglierebbe l'atomicità.
  Precedente diverso dalla
  [0062](0062-il-log-e-il-pavimento-l-evento-e-la-porta.md).
- **Un buco dichiarato:** `Workspace::plugin_data_dir` consegna a un provider
  nativo una vera cartella del filesystem. Tantivy ne ha bisogno per mappare i
  file in RAM. È documentato dalla [0021](0021-il-confine.md). Lì la cifratura
  si ferma, finché l'M5 WASI non permetterà di evitarlo.
- **Il §15.2 e il §15.7 restano aperti.**
