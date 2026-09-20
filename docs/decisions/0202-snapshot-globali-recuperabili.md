# 0202 — Snapshot globali offline recuperabili

- **Stato:** accolta
- **Data:** 2026-09-20
- **Ambito:** storage
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Il restore di `fub.versioning` protegge una singola sorgente e usa la revisione
come CAS per-file. Non protegge invece la fotografia coerente dell'intero vault:
documenti, allegati, file sconosciuti, cestino e stato autorevole `.fub/` devono
avanzare insieme. Una directory `.fub/data/` contiene anche dati derivati, quindi
il solo prefisso non è una classificazione sufficiente. La configurazione della
macchina è fuori dal vault.

## Decisione

`fub-kernel::snapshot` possiede manifest, validazione e applicazione offline.
L'host può invocarlo solo con il vault chiuso e quiescente e con una radice
canonica priva di symlink; non mantiene un lock `Workspace` durante l'I/O.
Prima di montare un vault l'host esegue la recovery degli artefatti riconosciuti.

Lo scope autorevole comprende:

- documenti, allegati e file sconosciuti nella radice;
- `.trash/`;
- `.fub/settings.json`, `workspace.json`, `journal.jsonl` e `drafts/`;
- sidecar autorevoli del cestino;
- `.fub/plugins/<id>/`, classificato dal proprietario del plugin.

Sono esclusi configurazione macchina e derivati dichiarati dal catalogo, inclusi
anagrafe `.fub/data/entries.json` e cache nello spazio dati dei plugin che
contengono il marker `.fub-cache-root`. Una directory
`.fub/data/plugins/<id>/` senza quel marker è invece storage autorevole legacy e
entra nel manifest come `plugin:<id>`. Un file sconosciuto non viene scartato
solo perché vive sotto `.fub/data/`.

Il manifest è schema 1, ordinato per path relativo normalizzato e serializzato in
modo deterministico. Ogni entry dichiara una classe, owner, schema quando
applicabile, dimensione e digest SHA-256. La classe `user` è unica per documenti,
allegati e file sconosciuti perché il kernel non possiede il `FormatRegistry`;
settings/organizzazione/drafts/journal, sidecar, cestino e plugin hanno classi
core proprie. Preflight rifiuta schema futuro, path assoluti, traversal,
separatori non canonici, duplicati, symlink, file speciali, entry mancanti,
dimensioni o digest errati e classi incompatibili con il catalogo path del kernel.
La revisione di base è il digest SHA-256 del manifest autorevole live e viene
ricontrollata sotto il lock subito prima della pubblicazione.

L'applicazione usa un lock cooperativo stabile sibling e una transazione
persistente:

1. `prepare`: valida tutto, crea staging privato sibling e scrive il record;
2. `commit`: sposta la vecchia root in un contenitore `.old` e pubblica lo
   staging con rename;
3. `finalize`: conserva la root vecchia finché il nuovo contenitore è visibile,
   poi rimuove `.old` e il record.

I record sono idempotenti e portano schema, transaction id, path attesi,
manifest atteso e fase. Al riavvio vengono riconosciuti solo nomi, schema e id
di questa implementazione; artefatti sconosciuti restano intatti. Una fase
`prepare` viene annullata, `OldMoved` ripristina il vecchio contenitore quando
necessario e `Published` completa o finalizza soltanto dopo aver ricontrollato il
manifest. Le cache sparite dalla nuova root vengono ricostruite alla riapertura.

La garanzia è all-or-old-or-new per writer cooperativi che usano il lock. Non è
atomicità universale contro writer esterni, processi che ignorano il protocollo,
filesystem privi di rename/fsync durevoli o guasti che impediscono anche il
rollback; in questi casi il risultato espone `RecoveryNeeded` e non finge un
successo.

## Conseguenze

### Positive

- una revisione globale impedisce di applicare una fotografia su stato più
  recente;
- ogni errore di preflight avviene prima di modificare il vault;
- crash fra prepare, commit e finalize hanno un record persistente e una recovery
  deterministica;
- il contenuto autorevole sconosciuto viene preservato.

### Negative

- il vault deve essere chiuso: watcher, job e provider non possono concorrere
  con la sostituzione della root;
- la pubblicazione richiede spazio temporaneo sibling e supporto filesystem
  adeguato;
- writer esterni e filesystem senza durabilità restano fuori dalla garanzia.

## Alternative scartate

### Un file alla volta

È il protocollo di `version.restore`, ma lascia una fotografia mista se una
seconda entry fallisce.

### Trattare tutto `.fub/data/` come cache

Perde sidecar o dati autorevoli non ricostruibili. La classificazione è per voce
e proprietario, come stabilito da ADR 0187.

### Usare il journal come WAL

Il journal racconta mutazioni concluse e non conserva preimage; non è sufficiente
per rollback di un aggiornamento multi-file.

### Rename diretto senza recovery record

Un crash fra due rename non lascia il kernel in grado di distinguere rollback,
completamento o cleanup; il record persistente è parte del protocollo.

## Verifica

`SnapshotManifest::validate_files` copre schema, path, duplicati, entry mancanti,
dimensioni e digest prima dell'I/O di commit. I test kernel esercitano revisione
stale, dati derivati esclusi, fault prima/durante la scrittura, crash simulati
fra prepare/commit e recovery dopo commit. I test host verificano il rifiuto di
un vault aperto, la recovery prima del mount e la riapertura dopo l'applicazione.
