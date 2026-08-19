# Il versionamento

In Fub i numeri di versione sono **tre**, e non sono lo stesso numero scritto
in tre posti: sono tre promesse, fatte a tre persone diverse, che si rompono in
tre modi diversi. Oggi i crate valgono `0.1.0` e il contratto `0.1.1` — due
numeri diversi, ed è la ragione per cui il documento esiste. Sembravano uno
solo finché il freeze di M4 non ha mosso il secondo.

| Numero | Dove sta | A chi promette | Cosa succede se si sbaglia |
|---|---|---|---|
| **versione dei crate** | [`Cargo.toml:24`](../Cargo.toml), ereditata dai nove crate [conta: crate-del-workspace]; [`frontend/package.json`](../frontend/package.json) la ripete per la shell | a chi compila Fub, o ci compila contro | la build rossa, subito |
| **versione del contratto** | [`ABI_VERSION`](../crates/fub-abi/src/traits.rs) (`traits.rs:3888`) e `package fub:abi@0.1.1` in [`crates/fub-abi/wit/fub/abi.wit`](../crates/fub-abi/wit/fub/abi.wit) | a un plugin **già compilato**, che non si ricompila | il confine si rompe a valle, dopo il rilascio, e a rompersi è il codice di qualcun altro |
| **versione degli schemi su disco** | undici costanti `SchemaVersion` [conta: schemi-su-disco] indipendenti nei crate, una per formato (tabella più sotto) | ai **file dell'utente**, che sopravvivono a ogni versione dell'app | dati letti male, o riscritti male: l'unico dei tre errori che non si annulla |

## 1. La versione dei crate

**Un numero solo per l'intero workspace.** `version = "0.1.0"` sta in
[`Cargo.toml:1`](../Cargo.toml) sotto `[workspace.package]`, e tutti e otto i
crate lo ereditano con `version.workspace = true`. La shell porta lo stesso
numero in `package.json`.

Un numero solo è sostenibile finché è vero che **nessun crate è pubblicato
separatamente**: oggi non ce n'è nessuno su crates.io, il prodotto è il binario
`fub`, e non esiste un consumatore che possa aggiornare `fub-kernel` senza
aggiornare `fub-abi`. Il giorno in cui `fub-abi` verrà pubblicato da solo —
perché chi scrive un plugin ci deve compilare contro — quel giorno il numero si
dovrà spezzare, e questa sezione andrà riscritta invece che aggirata.

**La regola è SemVer, con la clausola dello zero.** Finché la major è `0`, è la
**minor** a portare le rotture: `0.2.0` può cambiare qualunque cosa rispetto a
`0.1.x`, e `0.1.1` no. Non è una libertà che si usa volentieri, ma dirla è
meglio che lasciar credere una stabilità che il progetto non ha ancora: nessuna
versione è stata rilasciata, e la prima non è ancora uscita.

**L'MSRV è parte del contratto.** `rust-version = "1.89"` è dichiarato una volta
nel workspace, e non è una nota di stile: il job `build + test` della CI pinna la
toolchain esattamente a `1.89`
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)), quindi il primo uso
di una feature più recente diventa rosso lì, non sulla macchina di chi ha una
toolchain vecchia. Alzare l'MSRV è un cambio **minor**, e si fa deliberatamente,
non perché è comparso un warning.

È successo una volta, da 1.88 a 1.89, e il verbale dice perché
([0066](decisions/0066-un-aggiornamento-non-e-una-scrittura.md)): serviva
`std::fs::File::lock` per non far cancellare a due installazioni di Fub le
impostazioni a vicenda, e l'alternativa era una dipendenza in più. Delle due
promesse si è rotta quella a cui chi la legge può rispondere aggiornando la
toolchain, invece di aggiungerne una che chiunque installi si tiene per sempre.

## 2. La versione del contratto

`fub-abi` è la superficie che i plugin vedono, e
[`crates/fub-abi/wit/fub/abi.wit`](../crates/fub-abi/wit/fub/abi.wit) è
la stessa superficie detta nella lingua dei componenti WASM. Le due si
rispecchiano, e che si rispecchino è verificato
([`wit_conformance.rs`](../crates/fub-abi/tests/wit_conformance.rs)).

Quel numero non promette la stessa cosa della versione dei crate. La versione
dei crate parla a chi **ricompila**; questa parla a un componente WASM
**compilato mesi fa**, che non verrà ricompilato e che l'host deve saper
accettare o rifiutare da solo, guardando la stringa che il plugin dichiara.

**La regola di caricamento** è
[`abi_compatible`](../crates/fub-abi/src/traits.rs) (`traits.rs:4436`), e sta
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
qui. Il presidio è [`wit_additivity.rs`](../crates/fub-abi/tests/wit_additivity.rs),
che gira a ogni push.

**Dopo il freeze di M4** la superficie cresce solo per aggiunta, e
`wit_additivity` confronta il contratto vivo con ogni snapshot in `wit/frozen/`
della stessa major. Il freeze è M4
([milestones/M4-wit-hardening.md](milestones/M4-wit-hardening.md)): da lì la
tabella qui sopra è una promessa, non più una regola di implementazione.

## 3. Le versioni degli schemi su disco

È il numero che si dimentica, ed è l'unico i cui errori non si annullano: un
file dell'utente scritto male resta scritto male. Ogni file che Fub scrive
porta il **suo** numero, indipendente dagli altri, perché gli schemi cambiano in
momenti diversi e legarli vorrebbe dire migrare sei file per una modifica a uno.

**Il numero è un tipo, e il tipo si chiama `SchemaVersion`**
([`crates/fub-abi/src/schema.rs`](../crates/fub-abi/src/schema.rs)). Non è
igiene: è chi tiene in piedi l'elenco. Un conto che li cerca nei sorgenti deve
saper dire *questa costante è una versione di schema*, e per due giri l'ha detto
guardando il **nome** — prima `SCHEMA_VERSION`, che lasciava fuori
`DIAGNOSTICS_VERSION`, poi un qualunque intero il cui nome finisse per `VERSION`,
che lasciava fuori un `const E_SCHEMA_REV`. Un nome però non si fa rispettare da
nessuno: chi lo sceglie diverso non sta violando una regola, sta scegliendo un
nome, e il presidio si elude senza che nessuno lo voglia. Un tipo invece lo si
attraversa — il campo del record lo pretende, e un `u32` non lo soddisfa — e chi
lo fa rispettare è il compilatore. Il conto passa dal nome al tipo e diventa
insensibile alle rinomine ([0128](decisions/0128-una-versione-di-schema-e-un-tipo.md)).

I formati sono **undici** [conta: schemi-in-tabella], e la tabella qui sotto è
l'elenco: che sia **tutto** l'elenco lo verifica
[`schemi_su_disco.rs`](../crates/fub-app/tests/schemi_su_disco.rs), che legge
questa tabella e i sorgenti che cita e li confronta nei due versi — riga per riga
e numero per numero. Non è pedanteria da presidio: finché quel test non è
esistito, questa tabella ne dichiarava nove mentre il codice ne aveva dieci, e
**cinque righe su nove** puntavano a una riga di sorgente che nel frattempo si
era spostata. Un elenco che nessuno riconta è un ricordo.

| Schema | Dove | Oggi | Cosa contiene |
|---|---|---|---|
| registro dei vault | [`crates/fub-host/src/vaults.rs:44`](../crates/fub-host/src/vaults.rs) | 1 | i vault conosciuti, sul file della macchina |
| organizzazione | [`crates/fub-kernel/src/organization.rs:78`](../crates/fub-kernel/src/organization.rs) | 1 | il sidecar della sidebar: albero, icone, spazi, appuntate |
| stato di vista | [`crates/fub-kernel/src/viewstate.rs:57`](../crates/fub-kernel/src/viewstate.rs) | 1 | dove si era rimasti, per esemplare di vista |
| anagrafe | [`crates/fub-kernel/src/entries.rs:142`](../crates/fub-kernel/src/entries.rs) | **4** | ciò che il kernel si ricorda di ogni file, per non rileggerlo — in coda di record (0112) |
| impostazioni | [`crates/fub-kernel/src/settings.rs:84`](../crates/fub-kernel/src/settings.rs) | 1 | i valori scritti, per vault e per macchina |
| versioning | [`crates/fub-features/src/versioning.rs:261`](../crates/fub-features/src/versioning.rs) | 1 | gli snapshot, cioè la memoria di com'erano i file |
| indice di ricerca | [`crates/fub-features/src/search.rs:93`](../crates/fub-features/src/search.rs) | **5** | i campi, le opzioni e il tokenizer di tantivy |
| registro delle mutazioni | [`crates/fub-kernel/src/journal.rs:177`](../crates/fub-kernel/src/journal.rs) | 1 | ciò che è successo al vault, una riga per mutazione |
| bozze | [`crates/fub-kernel/src/drafts.rs:110`](../crates/fub-kernel/src/drafts.rs) | 1 | ciò che l'utente ha scritto e non ha salvato |
| bundle diagnostico | [`crates/fub-kernel/src/maintenance.rs:232`](../crates/fub-kernel/src/maintenance.rs) | 1 | una copia di fatti che stanno altrove, per chi cerca un guasto |
| sidecar del cestino | [`crates/fub-kernel/src/vault.rs:112`](../crates/fub-kernel/src/vault.rs) | 1 | da quale cartella veniva una voce cestinata |

**La regola comune è il rifiuto in avanti.** Un file la cui `version` è
**maggiore** di quella che questa copia di Fub conosce non si legge e non si
riscrive: si rifiuta, dicendolo. Interpretare a metà un file scritto da una
versione più nuova è il modo più diretto per cancellare un campo che non si
capisce.

**I due numeri che non sono 1 non sono un'anomalia, sono l'altra famiglia.** La
riga che divide questa tabella non è il numero, è **chi sa rifare il file**.
L'indice di ricerca, l'anagrafe e il bundle diagnostico sono **derivati**: un
manifest con versione diversa fa buttare via il file e ricostruirlo dal vault,
che è la sorgente di verità. Uno schema che si rigenera può cambiare numero senza
costare niente a nessuno — l'indice di ricerca l'ha fatto **cinque** volte,
l'anagrafe tre (la `v2` sono le ancore della
[decisione 0049](decisions/0049-una-posizione-dentro-un-documento.md), la `v3`
toglie `written_at`, la `v4` è la coda di record del difetto `0112`; il costo è
una riapertura lenta, o una fotografia che alla prima scrittura sostituisce il
file di prima). Gli altri **sette** contengono cose che il vault
non sa riprodurre (dove si era rimasti, come si era ordinata la sidebar, cosa
c'era nel file prima), e lì un numero che sale è una **migrazione da scrivere**,
o un rifiuto.

**L'undicesimo non è né l'uno né l'altro, e dice quando il rifiuto si tace.** Il
sidecar del cestino ricorda da quale cartella veniva una voce cestinata: nessuno
lo sa rifare — l'informazione è andata con lo spostamento — ma la sua assenza ha
già una risposta prevista, perché una voce cestinata da Obsidian il sidecar non ce
l'ha mai avuto e si ripristina in radice col nome de-timbrato. Quindi lì una
versione che non si conosce **vale come un sidecar che non c'è**, in silenzio:
non perché tacere costi meno, ma perché ciò che il rifiuto rumoroso protegge —
non perdere quello che l'utente aveva scritto — qui non è in gioco, e la nota
torna comunque. La regola che ne esce, e vale per il formato che nascerà domani:
**il rifiuto in avanti si dice quando tacere farebbe perdere qualcosa, e si tace
quando il degrado è già la risposta prevista del formato**
([0106](decisions/0106-un-formato-si-presenta.md)).

**Lo stesso silenzio vale per un sidecar che parla di un altro file.** La chiave
è il nome della voce cestinata, e due voci omonime cestinate in momenti diversi
se la dividono: perciò il sidecar porta il **timbro** del file di cui parla —
dimensione e `mtime`, che un `rename` non tocca — e quando il timbro non torna
vale come un sidecar che non c'è, con il degrado di sempre. Il campo è
facoltativo e lo schema **non** è salito di numero apposta: un sidecar scritto
prima che il timbro esistesse non ha niente da smentire e resta creduto, mentre
un numero nuovo avrebbe buttato via il cestino di chi aggiorna, che è il
contrario di ciò che il rifiuto in avanti protegge.

Il dettaglio conta anche nel verso opposto: l'anagrafe non legge un file **senza**
campo `version` come «versione 0», perché quel formato è nato con il campo — un
file che non ce l'ha non è vecchio, è di qualcun altro
(`entries.rs:114-142`). Il sidecar dell'organizzazione, che è nato prima, sì.

**SemVer non copre niente di tutto questo.** La versione dei crate può passare da
`0.1.0` a `0.2.0` senza che un solo schema si muova, e uno schema può salire in
una patch. Sono assi indipendenti, e l'unica cosa che li lega è che una release
che alza uno schema deve portare con sé la migrazione.

## Cosa non è versionato, e di proposito

- **I file dell'utente.** Un vault è markdown con frontmatter YAML, compatibile
  Obsidian. Non è un formato di Fub e non prende un numero da Fub: è il
  motivo per cui si può smettere di usare questo programma senza perdere niente.
- **Le API interne dei crate.** Finché nessun crate è pubblicato, `pub` dentro
  `fub-kernel` non è una promessa verso l'esterno. L'unica superficie promessa
  è `fub-abi`, ed è il numero 2 di questo documento.
- **I moduli TypeScript della shell.** `frontend/` è un'applicazione, non una
  libreria: il numero in `package.json` esiste per accompagnare quello dei
  crate, non per essere consumato da qualcuno.
- **Il layout su disco.** *Dove* stanno i file non ha un numero, e non può
  averlo: il numero abita dentro un file, e chi deve sapere se una cartella si è
  spostata non l'ha ancora aperto. Si riconosce dai **nomi**, ed è ciò che ha
  fatto la prima e finora unica migrazione di layout, quella della [decisione
  0048](decisions/0048-una-radice-sola.md): due radici dentro il vault diventate
  una. Quel codice è stato tolto al rename del progetto — prima del rilascio a
  spostare le cartelle è chi ha scritto il codice — e la regola che resta è che
  dopo il rilascio non sarà più facoltativo. La mappa di cosa sta dove è
  [architecture/on-disk-layout.md](architecture/on-disk-layout.md).

## Quando arriva `1.0`

Non è una data, è una condizione: **il contratto congelato** (M4) e **un runtime
che lo esercita da fuori** (M5, plugin WASM di terzi). Prima di allora, dire
`1.0` significherebbe promettere stabilità su una superficie che non è ancora
stata usata da nessuno che non sia questo repo — e una promessa del genere si
scopre falsa esattamente quando comincia a costare.

Fino a lì valgono le regole dello zero: la minor può rompere, il changelog lo
dice ([CHANGELOG.md](CHANGELOG.md)), e i verbali dicono perché
([decisions/](decisions/README.md)).
