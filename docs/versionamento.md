# Il versionamento

In FubMD i numeri di versione sono **tre**, e non sono lo stesso numero scritto
in tre posti: sono tre promesse, fatte a tre persone diverse, che si rompono in
tre modi diversi. Oggi due di loro valgono `0.1.0` e sembrano uno solo — è una
coincidenza di questo momento, non una regola, ed è la ragione per cui il
documento esiste.

| Numero | Dove sta | A chi promette | Cosa succede se si sbaglia |
|---|---|---|---|
| **versione dei crate** | [`Cargo.toml:19`](../Cargo.toml), ereditata dai sette crate; [`frontend/package.json`](../frontend/package.json) la ripete per la shell | a chi compila FubMD, o ci compila contro | la build rossa, subito |
| **versione del contratto** | [`ABI_VERSION`](../crates/fubmd-abi/src/traits.rs) (`traits.rs:2912`) e `package fubmd:abi@0.1.0` in [`crates/fubmd-abi/wit/fubmd/abi.wit`](../crates/fubmd-abi/wit/fubmd/abi.wit) | a un plugin **già compilato**, che non si ricompila | il confine si rompe a valle, dopo il rilascio, e a rompersi è il codice di qualcun altro |
| **versione degli schemi su disco** | sette `SCHEMA_VERSION` indipendenti nei crate (tabella più sotto) | ai **file dell'utente**, che sopravvivono a ogni versione dell'app | dati letti male, o riscritti male: l'unico dei tre errori che non si annulla |

## 1. La versione dei crate

**Un numero solo per l'intero workspace.** `version = "0.1.0"` sta in
[`Cargo.toml:19`](../Cargo.toml) sotto `[workspace.package]`, e tutti e sette i
crate lo ereditano con `version.workspace = true`. La shell porta lo stesso
numero in `package.json`.

Un numero solo è sostenibile finché è vero che **nessun crate è pubblicato
separatamente**: oggi non ce n'è nessuno su crates.io, il prodotto è il binario
`fubmd`, e non esiste un consumatore che possa aggiornare `fubmd-kernel` senza
aggiornare `fubmd-abi`. Il giorno in cui `fubmd-abi` verrà pubblicato da solo —
perché chi scrive un plugin ci deve compilare contro — quel giorno il numero si
dovrà spezzare, e questa sezione andrà riscritta invece che aggirata.

**La regola è SemVer, con la clausola dello zero.** Finché la major è `0`, è la
**minor** a portare le rotture: `0.2.0` può cambiare qualunque cosa rispetto a
`0.1.x`, e `0.1.1` no. Non è una libertà che si usa volentieri, ma dirla è
meglio che lasciar credere una stabilità che il progetto non ha ancora: nessuna
versione è stata rilasciata, e la prima non è ancora uscita.

**L'MSRV è parte del contratto.** `rust-version = "1.88"` è dichiarato una volta
nel workspace, e non è una nota di stile: il job `build + test` della CI pinna la
toolchain esattamente a `1.88`
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)), quindi il primo uso
di una feature più recente diventa rosso lì, non sulla macchina di chi ha una
toolchain vecchia. Alzare l'MSRV è un cambio **minor**, e si fa deliberatamente,
non perché è comparso un warning.

## 2. La versione del contratto

`fubmd-abi` è la superficie che i plugin vedono, e
[`crates/fubmd-abi/wit/fubmd/abi.wit`](../crates/fubmd-abi/wit/fubmd/abi.wit) è
la stessa superficie detta nella lingua dei componenti WASM. Le due si
rispecchiano, e che si rispecchino è verificato
([`wit_conformance.rs`](../crates/fubmd-abi/tests/wit_conformance.rs)).

Quel numero non promette la stessa cosa della versione dei crate. La versione
dei crate parla a chi **ricompila**; questa parla a un componente WASM
**compilato mesi fa**, che non verrà ricompilato e che l'host deve saper
accettare o rifiutare da solo, guardando la stringa che il plugin dichiara.

**La regola di caricamento** è
[`abi_compatible`](../crates/fubmd-abi/src/traits.rs) (`traits.rs:3080`), e sta
in quattro righe:

| Caso | Esito | Perché |
|---|---|---|
| major diversa | **rifiuto** | il contratto è cambiato in modo incompatibile |
| stessa major, minor del plugin ≤ minor dell'host | accetto | post-freeze si cresce solo per aggiunta: un host più nuovo serve ogni plugin più vecchio |
| stessa major, minor del plugin maggiore | **rifiuto** | il plugin usa cose che questo host non ha |
| versione che non si parsa | **rifiuto** | meglio un no chiaro che un errore a runtime, più tardi |

La patch non conta: è per le correzioni che non toccano la superficie.

**Cosa fa muovere questo numero.** La minor sale quando la superficie **cresce**
— un record con un campo in più in fondo, una funzione nuova, un'interfaccia
nuova. La major, dopo il freeze di M4, non sale: è esattamente la promessa che il
freeze fa, e romperla vorrebbe dire ammettere che ogni plugin esistente smette
di funzionare.

**Come quella promessa è resa meccanica** — cosa conta come aggiunta, dov'è la
linea di base, e come si ritaglia quando prima del freeze si rompe qualcosa di
proposito — sta in
[architecture/wit-congelato.md](architecture/wit-congelato.md), e non si ripete
qui. Il presidio è [`wit_additivity.rs`](../crates/fubmd-abi/tests/wit_additivity.rs),
che gira a ogni push.

**Prima del freeze (adesso)** la superficie è ancora libera di cambiare, e il
test non lo impedisce: lo rende visibile in review. Il freeze è M4
([milestones/M4-wit-hardening.md](milestones/M4-wit-hardening.md)), ed è da lì
che la tabella qui sopra diventa una promessa invece che una regola di
implementazione.

## 3. Le versioni degli schemi su disco

È il numero che si dimentica, ed è l'unico i cui errori non si annullano: un
file dell'utente scritto male resta scritto male. Ogni file che FubMD scrive
porta il **suo** numero, indipendente dagli altri, perché gli schemi cambiano in
momenti diversi e legarli vorrebbe dire migrare sei file per una modifica a uno.

| Schema | Dove | Oggi | Cosa contiene |
|---|---|---|---|
| registro dei vault | [`crates/fubmd-host/src/vaults.rs:39`](../crates/fubmd-host/src/vaults.rs) | 1 | i vault conosciuti, sul file della macchina |
| organizzazione | [`crates/fubmd-kernel/src/organization.rs:74`](../crates/fubmd-kernel/src/organization.rs) | 1 | il sidecar della sidebar: albero, icone, spazi, appuntate |
| stato di vista | [`crates/fubmd-kernel/src/viewstate.rs:56`](../crates/fubmd-kernel/src/viewstate.rs) | 1 | dove si era rimasti, per esemplare di vista |
| anagrafe | [`crates/fubmd-kernel/src/entries.rs:78`](../crates/fubmd-kernel/src/entries.rs) | 1 | ciò che il kernel si ricorda di ogni file, per non rileggerlo |
| impostazioni | [`crates/fubmd-kernel/src/settings.rs:51`](../crates/fubmd-kernel/src/settings.rs) | 1 | i valori scritti, per vault e per macchina |
| versioning | [`crates/fubmd-features/src/versioning.rs:139`](../crates/fubmd-features/src/versioning.rs) | 1 | gli snapshot, cioè la memoria di com'erano i file |
| indice di ricerca | [`crates/fubmd-features/src/search.rs:81`](../crates/fubmd-features/src/search.rs) | **4** | i campi, le opzioni e il tokenizer di tantivy |

**La regola comune è il rifiuto in avanti.** Un file la cui `version` è
**maggiore** di quella che questa copia di FubMD conosce non si legge e non si
riscrive: si rifiuta, dicendolo. Interpretare a metà un file scritto da una
versione più nuova è il modo più diretto per cancellare un campo che non si
capisce.

**Il numero 4 non è un'anomalia, è l'altra famiglia.** L'indice di ricerca è
l'unico schema **rigenerabile**: un manifest con versione diversa fa buttare via
l'indice e ricostruirlo dal vault, che è la sorgente di verità. Uno schema che si
rigenera può cambiare numero quattro volte senza costare niente a nessuno — ed è
successo quattro volte. Gli altri sei contengono cose che il vault non sa
riprodurre (dove si era rimasti, come si era ordinata la sidebar, cosa c'era nel
file prima), e lì un numero che sale è una **migrazione da scrivere**, o un
rifiuto.

Il dettaglio conta anche nel verso opposto: l'anagrafe non legge un file **senza**
campo `version` come «versione 0», perché quel formato è nato con il campo — un
file che non ce l'ha non è vecchio, è di qualcun altro
(`entries.rs:73-78`). Il sidecar dell'organizzazione, che è nato prima, sì.

**SemVer non copre niente di tutto questo.** La versione dei crate può passare da
`0.1.0` a `0.2.0` senza che un solo schema si muova, e uno schema può salire in
una patch. Sono assi indipendenti, e l'unica cosa che li lega è che una release
che alza uno schema deve portare con sé la migrazione.

## Cosa non è versionato, e di proposito

- **I file dell'utente.** Un vault è markdown con frontmatter YAML, compatibile
  Obsidian. Non è un formato di FubMD e non prende un numero da FubMD: è il
  motivo per cui si può smettere di usare questo programma senza perdere niente.
- **Le API interne dei crate.** Finché nessun crate è pubblicato, `pub` dentro
  `fubmd-kernel` non è una promessa verso l'esterno. L'unica superficie promessa
  è `fubmd-abi`, ed è il numero 2 di questo documento.
- **I moduli TypeScript della shell.** `frontend/` è un'applicazione, non una
  libreria: il numero in `package.json` esiste per accompagnare quello dei
  crate, non per essere consumato da qualcuno.

## Quando arriva `1.0`

Non è una data, è una condizione: **il contratto congelato** (M4) e **un runtime
che lo esercita da fuori** (M5, plugin WASM di terzi). Prima di allora, dire
`1.0` significherebbe promettere stabilità su una superficie che non è ancora
stata usata da nessuno che non sia questo repo — e una promessa del genere si
scopre falsa esattamente quando comincia a costare.

Fino a lì valgono le regole dello zero: la minor può rompere, il changelog lo
dice ([CHANGELOG.md](CHANGELOG.md)), e i verbali dicono perché
([decisions/](decisions/README.md)).
