# 0048 — Una radice sola, e la classe di un dato

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §15.4 (seduta 15) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/15-il-disco.md) ·
[la mappa che ne esce](../architecture/on-disk-layout.md)

---

La voce aveva due metà, e la ragione per cui vanno insieme è tutta qui:

> **Oggi la classe di un dato si deduce da una cosa sola — la radice in cui il
> file sta.** Spostare le radici senza dire cosa significano toglie l'unico
> indizio esistente prima di aver messo quello vero.

Un vault portava tre cartelle nostre: `.fub/` (autorevole), `.fub-data/`
(derivato) e `.trash/`. E `data_write` non ha mai chiesto se ciò che scrive si
può buttare: la classe stava in prosa, in testa a ogni modulo che ne apriva uno
nuovo, dedotta dalla radice e ripetuta a parole.

## La decisione

**Dentro un vault la radice è una: `.fub/`, coi derivati in `.fub/data/`.** La
profondità dice la classe — in cima l'autorevole, sotto `data/` il buttabile — e
la mappa di chi scrive dove, con quale versione di schema e con quale disciplina
di scrittura, è [on-disk-layout.md](../architecture/on-disk-layout.md).

**La classe si dichiara scegliendo dove si scrive**, non taggando ogni
scrittura: delle tre forme possibili è scelta la **seconda radice per plugin** —
`data_*` resta la famiglia dell'autorevole, una `cache_*` porta il derivato. È
additiva, quindi non scade col freeze e l'implementazione segue M3.

```rust
pub const FUB_DIR: &str = ".fub";              // kernel/vault.rs
pub fn data_root(root: &Utf8Path) -> Utf8PathBuf;  // <root>/.fub/data
pub fn migrate_layout(root: &Utf8Path) -> Option<String>;
```

## Le decisioni prese, da NON ridiscutere senza motivo

### Annidata, non piatta

Un `.fub/` senza sottocartella avrebbe fuso le due radici e **cancellato**
l'unico posto in cui la classe è scritta. Annidare la conserva — un livello più
in basso — e resta vera anche quando la classe diventerà esplicita: un path che
dice già la classe non contraddice una capacità che la dichiara. È anche la
ragione per cui la seconda metà si scrive nella stessa forma: `data_*` salirà a
`.fub/plugins/<id>/` e `cache_*` resterà in `.fub/data/plugins/<id>/`, cioè la
stessa regola applicata un livello più in giù.

### L'argomento contrario pesava meno di quanto sembrasse

Due radici distinte rendono banale escludere i derivati da un backup o da un
sync con una regola sola. Ma quella promessa **era già falsa**: gli snapshot del
versioning stanno sotto la radice dei derivati e non si ricostruiscono da
niente, e con loro il sidecar del cestino (`.fub/data/trash/`), che ricorda da
quale cartella veniva un file cancellato. Si è persa una comodità che non c'era,
e la si ricompra davvero solo con la seconda metà — quando `cache_*` conterrà
**solo** roba rifabbricabile.

### `.trash/` resta fuori

È l'unica delle tre che non è roba nostra. Il nome è quello che usa Obsidian per
"Move to Obsidian trash", ed è deliberato dal primo giorno (`kernel/vault.rs`,
`TRASH_DIR`): un vault condiviso fra le due app ha **un solo** cestino.
Spostarlo in `.fub/trash/` avrebbe rotto quella compatibilità in cambio di una
cartella nascosta in meno.

E c'è una ragione che vale anche senza Obsidian: là dentro ci sono **file
dell'utente**, non metadati di Fub. Una nota cancellata è ancora una nota. La
radice unica raccoglie ciò che Fub scrive *a proposito* del vault; il cestino
non lo è, e un cestino che si trova è metà del suo valore.

Il suo *sidecar*, invece, sta sotto i derivati: quello sì è nostro, Obsidian non
lo scrive, e la sua assenza degrada garbatamente (si ripristina in radice col
nome de-timbrato) invece di perdere il file.

### La migrazione è un rename, e rifiuta invece di indovinare

È la **prima migrazione di layout** del repo. Le tre `migrate` che esistevano —
`organization.rs`, `docdata.rs`, `workspace.rs::migrate_identity` — seguono la
rinomina di un *documento*: non sono il precedente, e la disciplina di questa è
stata decisa, non imitata.

- **Un rename, non una ricostruzione.** Sotto il vecchio nome non c'era solo
  l'indice: c'erano gli snapshot del versioning e lo stato per-documento della
  [0044](0044-lo-stato-per-documento.md). «Se non c'è, si ricostruisce» qui vuol
  dire cancellare la memoria di com'erano i file.
- **Una chiamata sola**, dentro lo stesso filesystem: non c'è una copia a metà
  da finire, e un'interruzione lascia o il vecchio nome o il nuovo, mai due
  mezzi.
- **Due nomi insieme si rifiutano.** È il
  [rifiuto in avanti](../versionamento.md) applicato a un layout invece che a un
  numero di schema: se esistono entrambe le cartelle, questa copia sta guardando
  un vault che qualcun altro ha già mosso. Non fonde, non cancella, lo dice e
  lavora sulla nuova — perché scegliere fra due versioni dello stesso snapshot
  non è una cosa che un programma sappia fare.
- **Non impedisce di aprire.** Se il rename fallisce, il vault si apre lo stesso
  con i derivati vuoti e un avviso in chiaro, sullo stesso canale degli avvisi
  di configurazione e dello stato per-documento (`host/mount.rs`). Il vault è la
  verità; quell'albero no.
- **Sta prima di ogni lettura** (`Workspace::with_machine_settings`): le tre
  righe che aprono impostazioni, organizzazione e anagrafe leggono sotto la
  radice, e aprire prima di spostare vorrebbe dire non trovare niente e poi
  spostare un albero che qualcuno ha appena riscritto.

### Perché non un parametro su `data_write`

Era l'unica delle tre che **scadeva** — un ritaglio della linea di base oggi,
una major dopo il freeze — ed è quella che si è scartata. Non per il costo:
perché è la forma sbagliata. La classe è proprietà del **path**, non della
singola scrittura: con `data_write(path, bytes, class)` la stessa chiave si può
dichiarare derivata a una scrittura e autorevole a quella dopo — il contratto
permetterebbe di contraddirsi — e ogni chiamante ripete a ogni chiamata un tag
che non cambia mai.

### Perché non un campo di manifest

Dichiara una volta sola, come la seconda radice, ed è additiva quanto lei. Ma la
dichiarazione sta **lontano dalla scrittura**: un elenco di prefissi nel
manifest si disallinea da ciò che il codice scrive davvero, e il disallineamento
non fa rumore — nessun test diventa rosso perché un prefisso non copre più la
cartella che è stata rinominata. Con due radici sbagliare la classe vuol dire
scrivere nel posto sbagliato: lo si vede aprendo il vault.

Il prezzo è due capacità in più su un elenco che la
[0013](0013-elenco-delle-capacita.md) ha dichiarato chiuso. È il prezzo previsto
da quella stessa decisione — «da qui in avanti aggiungerne uno è una minor» — e
lo paga l'host, non il guest: un plugin che non conosce `cache_*` continua a
funzionare.

### Il marcatore del checker migliora, non trasloca

`check-doc-links.mjs` riconosce un vault dalla cartella che il core ci scrive
dentro, per saltarlo. Era `.fub-data/`, cioè la cartella dei **derivati**: un
vault aperto e mai indicizzato non ce l'ha, e lo script gli camminava dentro
trattando le note di qualcuno come documentazione del repo. `.fub/` compare alla
prima cosa che Fub scrive su quel vault, che è prima.

La verifica è il numero che quello script stampa. Prima: **117 file, 1864 link,
0 rotti**; col marcatore nuovo e i due documenti che questo commit aggiunge:
**119 file, 1916 link, 0 rotti**. Se il conteggio dei file *calasse* invece di
salire, vorrebbe dire che il marcatore ha cominciato a saltare `docs/` — che è
esattamente il difetto per cui quello script conta anche gli alberi che salta.

### Un posto solo che traduce

Quattro verbali ([0025](0025-la-ricerca-predefinita.md),
[0038](0038-il-kernel-possiede-il-sidecar.md),
[0044](0044-lo-stato-per-documento.md), [0046](0046-l-anagrafe-del-vault.md)) e
la linea di base congelata continueranno a dire `.fub-data/`, ed è corretto:
sono fotografie. La traduzione sta in **un punto solo** — la sezione «Il nome di
prima» di [on-disk-layout.md](../architecture/on-disk-layout.md) — sul modello
di [numerazione.md](../roadmap/numerazione.md) per i numeri delle voci, e non
come una nota ripetuta in venti file.

Nel codice il nome vecchio sopravvive in una costante sola, `LEGACY_DATA_DIR`,
che serve alla sola migrazione.

### Il costo, misurato

| Cosa | Quanto |
|---|---|
| Costanti di produzione | **una**, `DATA_DIR`, diventata `FUB_DIR` + `data_root()` |
| Menzioni di `DATA_DIR` nel kernel | 14 righe, 6 delle quali componevano un path |
| Path composti a mano nei test | 11 in 8 file — già un difetto prima: adesso passano da `data_root` |
| Prosa (commenti, documenti, WIT vivo) | una quarantina di menzioni |
| Presidi | `.gitignore` (ignorava già entrambe), il marcatore del checker, un commento di CI |
| Scansione del vault | **niente**: ogni dot-dir è già ignorata (`is_ignored_name`), quindi `.fub/data/` lo è per la regola generale |

`DATA_DIR` non è stata rinominata in una stringa con dentro uno slash: è
diventata una **funzione**, così i sei posti che componevano un path non
compilavano finché non passavano da lì. Una costante `".fub/data"` avrebbe
lasciato compilare chiunque avesse continuato a comporlo a mano — e il nome
della costante non dice quanti livelli ha dentro.

## Cosa si è scartato, e perché

- **Un `.fub/` piatto.** Cancella l'unico posto in cui la classe è scritta, che
  è la metà di ciò che questa voce doveva sistemare.
- **Tenere due radici per poter escludere i derivati con una regola sola.** La
  promessa era già falsa: sotto i derivati stanno gli snapshot del versioning e
  il sidecar del cestino.
- **`data_write(path, bytes, class)`.** L'unica forma che scadeva col freeze, e
  la sbagliata: permette a due scritture della stessa chiave di contraddirsi.
- **Il campo di manifest.** Dichiara lontano da dove si scrive, e si disallinea
  in silenzio.
- **Portare `.trash/` dentro la radice.** Rompe il cestino condiviso con
  Obsidian, che è una decisione presa e documentata, per una cartella nascosta
  in meno.
- **Ricostruire invece di migrare.** Sotto il vecchio nome c'è roba che nessuno
  saprebbe rifare.
- **Fondere due alberi quando ci sono entrambi.** Vorrebbe dire scegliere quale
  copia di uno snapshot è quella buona, e non c'è nessun dato che lo sappia.
- **Aggiornare la linea di base congelata.** Le due occorrenze sono commenti,
  quindi `wit_additivity` non se ne accorge e il freeze non c'entra — ma una
  fotografia non si ritocca per cosmesi.

## Cosa resta scoperto (e dove è scritto)

- **Le capacità native ci sono; resta il linker WASM**, scritto nella casella
  aperta della seduta 15 (§15.4), da usare prima di M5.
- **Gli snapshot del versioning restano sotto la radice dei derivati**, e
  restano autorevoli. È la prima riga delle eccezioni in
  [on-disk-layout.md](../architecture/on-disk-layout.md), e si chiude con la
  casella qui sopra.
- **Ciò che passa da `data_write` non è scritto atomicamente**
  (`host/kernel.rs`: `std::fs::write`), snapshot compresi. È il
  [§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery), non questa voce.
- **La migrazione non ha un test su un vault vero.** I quattro casi —
  spostamento, rifiuto, vault nuovo, `.fub-data` che non è una cartella — sono
  su directory temporanee (`kernel/tests/radice_unica.rs`). Il primo vault vero
  a passarci è `docs/` di questo repo, alla prima apertura dopo questo commit.
- **Nessun comando la ripete.** Non esiste un `rebuild_index` né un
  `vault_health` che sappia dire «questi sono i derivati, buttali»: sono
  [§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery) e 24.2, e adesso
  hanno una mappa da cui leggere la risposta invece di indovinarla.
