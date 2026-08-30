# Layout su disco

> **Ambito:** file scritti da Fub a livello macchina e dentro un vault.
> **Fonti autorevoli:** moduli proprietari, `SchemaVersion` e test degli schemi.

## Regola di lettura

Ogni voce è classificata come:

- **utente**: contenuto del vault;
- **autorevole**: stato non ricostruibile;
- **derivata**: cache ricostruibile;
- **diagnostica**: utile per supporto, non fonte del prodotto;
- **dipende dal plugin**: il proprietario dichiara autorità e migrazione.

Non classificare una directory intera per il solo nome.

## Configurazione della macchina

La cartella viene scelta in ordine:

1. `FUB_CONFIG_DIR`;
2. `fub-config/` accanto all'eseguibile se esiste `fub.portable`;
3. cartella di configurazione dell'utente per il sistema operativo.

| Percorso relativo | Classe | Schema | Contenuto |
|---|---|---:|---|
| `settings.json` | autorevole | 1 | impostazioni della macchina |
| `vaults.json` | autorevole | 1 | vault recenti, preferiti, nome e icona |
| `view-state.json` | autorevole locale | 1 | stato delle view di questa macchina |
| `themes/<id>/manifest.json` | installato | manifest | identità e compatibilità del tema |
| `themes/<id>/` | installato | per tema | fogli, skin e asset |
| `logs/fub.log` | diagnostica | n/a | log del processo |

Se la cartella di configurazione non è disponibile, l'host può lavorare in
memoria. Un file illeggibile non viene riscritto da uno stato vuoto.

## Radice del vault

| Percorso | Classe | Contenuto |
|---|---|---|
| `**/*.md` e altri formati registrati | utente | documenti |
| `**/*.fubsheet` | utente autorevole | workbook testuale, schema 1 |
| allegati e file sconosciuti | utente | contenuto da preservare |
| `.trash/` | utente | file cestinati |
| `.fub/` | servizio | stato, cache e storage namespaced |

Un file sconosciuto esiste anche se nessun provider lo riconosce. Non viene
eliminato né escluso da un backup senza una scelta esplicita.

### Workbook `.fubsheet`

`fub-format-sheet` possiede lo schema. Il record esterno porta `schema` e
`workbook`; la versione 1 persiste:

- id del workbook e dei fogli;
- ordine e id stabili di righe e colonne;
- input delle celle identificati da `RowId + ColumnId`;
- dimensioni esplicite, stile semantico e metadati.

Indirizzi A1, AST, valori calcolati, dipendenze, cache, errori, viewport e
selezione sono derivati e non entrano nel file. Una versione assente o futura,
un campo sconosciuto, un'identità duplicata o una cella con riferimenti
inesistenti rendono la lettura un errore: Fub non riscrive una forma che non ha
interpretato integralmente.

## Stato del vault

| Percorso | Classe | Schema | Proprietario |
|---|---|---:|---|
| `.fub/settings.json` | autorevole | 1 | kernel/host impostazioni |
| `.fub/workspace.json` | autorevole | 1 | organizzazione |
| `.fub/journal.jsonl` | autorevole operativo | 1 | registro mutazioni |
| `.fub/drafts/` | autorevole | 1 | bozze non consolidate |
| `.fub/data/entries.json` | derivata | 4 | anagrafe dei file |
| `.fub/data/trash/*.json` | sidecar | 1 | provenienza del cestino |
| `.fub/plugins/<id>/` | per-plugin | proprio | storage persistente namespaced |

Il nome esatto delle chiavi sotto lo storage plugin appartiene al plugin.

## Storage dei plugin

Lo storage persistente usa una radice per id. Due esempi mostrano perché la
classificazione è per proprietario:

### Ricerca

L'indice Tantivy di `fub.search` è derivato. Una versione incompatibile può
essere eliminata e ricostruita dai documenti.

### Versioning

`fub.versioning` conserva:

```text
.fub/plugins/fub.versioning/
├── versions.json
└── <impronta>/
    ├── meta.json
    └── <timestamp>.md
```

`versions.json` è un indice ricostruibile. `meta.json` e gli snapshot sono
autorevoli: eliminarli perde la memoria delle versioni.

Quindi `.fub/plugins/` non è né tutta cache né tutto dato autorevole.

## Cestino

Quando Fub cestina `Appunti/Nota.md`:

```text
.trash/Nota.md
.fub/data/trash/Nota.md.json
```

Il sidecar conserva provenienza e timbro. Se manca o non corrisponde, il file
resta ripristinabile con il fallback sicuro previsto; il contenuto non viene
scartato.

## Versioni di schema

Una versione futura viene rifiutata quando interpretarla potrebbe perdere dati.

| Famiglia | Su incompatibilità |
|---|---|
| anagrafe e indice | elimina e ricostruisci |
| impostazioni, organizzazione, bozze | migra o rifiuta |
| versioni | migra o rifiuta gli snapshot; ricostruisci soltanto l'indice |
| sidecar del cestino | usa il fallback definito |
| diagnostica | rigenera |
| storage di terzi | applica la policy del plugin |

## Scrittura

I file autorevoli seguono:

- scrittura temporanea;
- flush quando richiesto dal formato;
- sostituzione atomica;
- lock di macchina quando più processi possono competere;
- nessuna riscrittura se il file di partenza non è stato letto in modo
  affidabile.

## Backup

Un backup completo include:

- documenti, allegati e file sconosciuti;
- `.trash/`;
- ogni voce autorevole in `.fub/`;
- storage autorevole dei plugin;
- configurazione macchina soltanto quando si vuole ripristinare preferenze e
  registro locale.

Indici, cache e log possono essere omessi se la procedura dimostra la
ricostruzione. La prova è tracciata in
[#7](https://github.com/Fubeo/Fub/issues/7).
