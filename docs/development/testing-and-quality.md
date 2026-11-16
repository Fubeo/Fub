# Test e qualità

> **Domanda:** quale banco dimostra una proprietà e quali guard impediscono la
> deriva?
> **Fonti autorevoli:** test nei crate, test frontend e workflow CI.

## Piramide

```mermaid
flowchart TD
    UNIT["unit test<br/>regola locale"] --> INTEGRATION["integrazione<br/>confine reale"]
    INTEGRATION --> E2E["end-to-end<br/>flusso utente"]
    E2E --> VISUAL["visuale e accessibilità"]
    UNIT --> GUARD["guard statici<br/>architettura e contratti"]
```

Ogni livello risponde a una domanda diversa. Un guard non sostituisce il test
del comportamento; un test end-to-end non sostituisce la verifica di una
invariante strutturale.

## Rust

### Test unitari

Vivono vicino alla regola o nel crate proprietario. Sono adatti a:

- canonicalizzazione;
- parser e serializzazione;
- query;
- compatibilità;
- conversioni;
- errori;
- versioni di schema.

### `MemoryHost`

`fub-sdk::testing::MemoryHost` serve a esercitare provider senza montare
l'intera applicazione. È il primo banco per comandi, view e servizi che usano
`HostApi`.

Il doppio non parsa: modelli, outline, tag, backlink e archi si seminano, e
un formato diverso dal Markdown di serie si dichiara con `with_format`. Ciò
che sa di sé lo serve con le regole condivise del kernel: anagrafe e specie
delle voci, documenti, risoluzione dei riferimenti, vicini a partire dai semi,
filtri su id, cartella, link e proprietà dei modelli seminati. Una domanda che
vorrebbe un indice, come testo, tag o glob, risponde `unserved` invece di
ignorare il filtro. `crates/fub-features/tests/both_hosts_answer_alike.rs`
confronta le risposte dei due host, anche con un secondo formato registrato.

### `fub-testkit`

`fub-testkit` monta kernel e host con fixture reali. Usalo per:

- lifecycle dei bundle;
- storage;
- eventi;
- registri;
- conflitti;
- aperture e teardown.

Resta una dipendenza di sviluppo.

### Test del contratto

I guard del contratto verificano:

- Rust ↔ WIT;
- additività rispetto a `wit/frozen/`;
- radice pubblica di `fub-abi`;
- proiezioni TypeScript;
- enum e fixture generate;
- dipendenze vietate.

### Snapshot globale (#5)

Il protocollo globale e la sua orchestrazione host si verificano separatamente
dal drill storico di backup/restore per-file:

```bash
cargo +1.95.0 test -p fub-kernel snapshot
cargo +1.95.0 test -p fub-host --test global_snapshot
cargo +1.95.0 test -p fub-app --test schemas_on_disk
```

I primi due comandi esercitano manifest, preflight, transazione, recovery e
riapertura osservabile del vault per #5. `schemas_on_disk` presidia invece la
registrazione persistente dello schema; il comando legacy di #7 resta quello
indicato nella sezione seguente.

### Drill backup/restore

Il banco d'integrazione eseguibile è:

```bash
cargo +1.95.0 test -p fub-host --lib legacy_tests::backup_restore_drill -- --nocapture
```

Il fixture copre l'intero vault: documenti Markdown, allegati binari, file
sconosciuti, `.trash/` e stato autorevole sotto `.fub/`, inclusi storage di
plugin e versioning. La configurazione macchina resta esclusa. Il manifesto
indipendente verifica per ogni path classe, dimensione, impronta FNV-1a e
schema; la scansione rifiuta symlink e file speciali.

Il drill opera offline in un parent temporaneo privato ed esclusivo. Copia
l'albero in uno staging adiacente alla destinazione e pubblica con un solo
rename. Questo dimostra il flusso del banco, non una garanzia universale di
no-replace concorrente o di durabilità dopo un crash.

Un artefatto corrotto o mancante viene validato prima di creare lo staging e
prima di toccare la destinazione. Una destinazione occupata resta invariata e
lo staging completo resta disponibile. La verifica finale usa `Host` reale:
apertura, attesa dell'indicizzazione e lettura del documento, poi chiusura.

`fub.backup` riguarda soltanto le note nello stesso vault; non è il backup
completo esercitato da questo drill. Il drill storico di #7 documenta il
comportamento legacy e resta distinto dalla verifica del protocollo globale #5.

### Corpus senza perdite della pre-alpha

```bash
cargo +1.95.0 test -p fub-host --test prealpha_corpus
```

Un file vero per ogni formato della pre-alpha, in
[`tests/fixtures/prealpha-corpus/`](../../tests/fixtures/prealpha-corpus/README.md):
Markdown con CRLF, con BOM, col frontmatter e con caratteri fuori dal piano
base; un `.docx` modificabile e uno protetto; un `.xlsx` con formule; un SVG
di Inkscape; un `.canvas` di Obsidian con CRLF e BOM; un PDF. Il `README.md`
della cartella dice da quale corpus viene ciascuno.

Il test copia il corpus in una cartella temporanea, apre il vault con `Host`
e prova per ogni file:

- aprire e chiudere come la shell non cambia un byte: la lettura sotto la
  chiave di apertura e `document_closed` dei motori, la griglia per un foglio,
  la risorsa per un PDF;
- una scrittura da una revisione vecchia dà `Conflict`, e il file resta;
- un file che sparisce fra la lettura e la scrittura dà un errore tipizzato e
  non rinasce;
- per Markdown e SVG una parola cambiata, per il `.canvas` una scheda spostata
  con `canvas.apply`: i byte cambiano solo nello spazio della modifica, e i
  fine riga e il BOM restano.

La sola lettura si prova coi motivi che l'host conosce, uguali sui tre
sistemi: il `.docx` protetto (`host.rich.readonly.protected`) e una cartella
di Excel che la shell coprirebbe con dei byte suoi (`host.xlsx.readonly`). Il
permesso del file non è uno di questi motivi: su Linux e macOS la scrittura
atomica sostituisce anche un file senza permesso di scrittura.

Le modifiche di un `.docx` e di un `.xlsx` hanno i loro corpus nei crate dei
formati (`fub-format-rich`, `fub-format-xlsx`, test `corpus`). Un formato che
entra nella pre-alpha aggiunge qui il suo file, con la provenienza.

### Albero delle dipendenze

Il [guard dei motori](../../.github/scripts/check-motori.mjs) legge l'albero
di `fub-app` con `cargo tree`, solo gli archi normali, con tutte le feature e
tutte le piattaforme, e pone due tetti a ciò che si installa.

- Nessuna interfaccia di un'app Craft: `egui`, `eframe`, `egui-wgpu`,
  `egui-winit`, `winit`, `rfd` e `accesskit_winit` fanno fallire il guard, con
  la catena di chi li tira dentro. Fa eccezione `rfd` portato da
  `tauri-plugin-dialog`, che apre i dialoghi di sistema della shell.
- Le librerie presenti in due o più versioni non superano `librerie_doppie`
  di [`budgets.json`](../reference/budgets.json). Il tetto si può soltanto
  abbassare: quando il conto scende, il guard avvisa di scriverci il numero
  nuovo.

Un Cargo che non riesce a dare l'albero fa uscire il guard con 2, mai con un
conto vuoto. `--self-test` prova il lettore su un albero finto; `--albero` e
`--budgets` leggono l'albero e i tetti da file.


## Frontend

Vitest 5 usa un fake host. Con `clearMocks: true`, prima di ogni test vengono
svuotate chiamate, istanze e risultati delle spy (`vi.clearAllMocks()`), senza
ripristinare l'implementazione né rimuovere i mock; i test che richiedono un
comportamento diverso devono configurarlo esplicitamente. I test devono
verificare la shell senza avviare Tauri.

Aree importanti:

- conversione byte UTF-8 ↔ offset JavaScript;
- sincronizzazione dell'editor;
- layout e focus;
- lifecycle di listener, observer e timer;
- rendering dichiarativo;
- tema;
- comandi e race cancellabili;
- comportamento end-to-end della shell.

`npm run typecheck`, `npm test` e `npm run build` sono tre controlli distinti.

### Bundle e dipendenze

La [configurazione Vite](../../apps/client/vite.config.ts) separa i runtime
riusabili e mantiene grafo, Mermaid, linguaggi opzionali e l'editor dei
disegni su richiesta.
Ogni chunk, cioè un blocco JavaScript emesso dalla build, ha un limite di
500.000 byte minificati, prima della compressione di trasporto.
Il solo parser precompilato di Mermaid ha un limite di 700.000 byte e non
può appartenere alle dipendenze statiche degli ingressi applicativi.
Il controllo misura il codice finale, dopo la riscrittura degli import di
Vite, e interrompe la build in caso di superamento.

Il [guard delle copie npm](../../.github/scripts/check-npm-copies.mjs)
mantiene uniche le dipendenze che condividono identità applicativa.
Le eccezioni per i motori privati di Mermaid e gli strumenti Node sono
limitate alle versioni verificate: una versione diversa o una copia
aggiuntiva richiede una nuova valutazione, non un override fra major.

## Banchi

Tutti i comandi girano da `apps/client/`; gli script sorgente sono in
`apps/client/package.json` e in `bench/`:

| Comando | Che cosa misura |
|---|---|
| `npm run bench:verify` | le scene del banco visivo contro le baseline Linux |
| `npm run bench:update` | rigenera le baseline (solo dal runner Linux) |
| `npm run bench:a11y` | accessibilità della pagina resa (`-- --scene=a,b` per alcune scene, `-- --light=dark` per una luce) |
| `npm run bench:motion` | le coreografie del moto dello Scrittoio |
| `npm run bench:lampo` | lo strato d'avvio prima di ogni modulo |
| `npm run bench:interaction` | il budget d'interazione (menu, palette, nota) |
| `npm run bench:ink` | l'inchiostro in TypeScript e in WebAssembly, fianco a fianco |
| `npm run bench:fidelity` | la fedeltà pixel dei disegni (foglio, PNG, Lettura) |
| `npm run bench:grid` | i gesti della griglia con mouse e tastiera veri |
| `npm run bench:graph-scale` | il grafo a 2k/10k nodi: tempi, heap, soak |
| `npm run bench:large` | i disegni grandi (da 200 a 49 900 elementi) nell'app vera |
| `npm run bench:webview` | le misure nella WebView vera (vedi [webview-measurements.md](webview-measurements.md)) |

Varianti usate dalle prove di accettazione della Graph View e dei disegni
grandi:

```bash
cd apps/client
npm run bench:graph-scale -- --nodes 2000 --seed 6 --cycles 3
npm run bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 8
npm run bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 16
npm run bench:large -- --elements 30000   # da 200 a 49 900 elementi, senza soglie
npm run bench:large -- --cpu 4            # la pagina quattro volte più lenta
```

## Visuale e accessibilità

Scene, baseline, soglie, palco e banco dell'accessibilità stanno in
[banco visivo e accessibilità](visual-bench.md).

## Runtime WASM

Un test reale costruisce i componenti in `esempi/`. Le classi minime sono:

| Classe | Proprietà |
|---|---|
| successo | mount, chiamata, esito e teardown |
| compatibilità | ABI incompatibile rifiutata prima dell'attivazione |
| capability | accesso negato come errore tipizzato |
| isolamento | trap o panic non abbatte l'host |
| disponibilità | loop infinito fermato dalla deadline |
| memoria | limite applicato prima dell'istanza |
| forma | arena e output malformati rifiutati |
| lifecycle | registrazioni e risorse rimosse |

## Documentazione

I guard documentali controllano:

- link e target;
- raggiungibilità delle pagine;
- dimensioni;
- struttura Markdown;
- blocchi Mermaid, resi in Chromium con la sandbox accesa;
- tabelle;
- riferimenti legacy e cronaca vietata;
- allineamento del ciclo locale.

Il [guard dei commenti di Rust](../../.github/scripts/check-rust-comments.mjs)
controlla che ogni `///` stia sopra l'item che descrive: niente righe
ripetute, niente doc staccati da una riga vuota o da un commento, niente
attributi sopra il doc, niente intestazioni di sezione spezzate. Gli attributi
stanno fra il doc e l'item: uno sopra il doc passa all'item di un altro doc
appena qualcuno inserisce un item nel mezzo.

## La CI in breve

- Una PR **bozza** riceve la CI corta: solo Linux, senza banchi. Pronta per
  la revisione gira la CI completa, Windows e macOS compresi; su `main` gira
  sempre tutto.
- I test del workspace girano con `cargo nextest run --workspace --profile ci`
  più `cargo test --workspace --doc`; i fuzzer del Markdown girano a 2000 casi
  (20000 nella corsa settimanale e con `fuzz_completo`).
- La cache Rust salva solo da `main` (budget di 10 GB); i job che possono
  riutilizzarla leggono la test cache di Linux con `shared-key: test` e non la
  risalvano.
- Il job supply chain scrive la SBOM Rust con `.github/scripts/sbom.mjs`, da
  `cargo metadata`, e fallisce se non corrisponde a `Cargo.lock`.
- `motori-provenienza.yml` riscarica ogni copia di `vendor/` ogni settimana e
  sulle PR che toccano `vendor/` o `tools/vendor-craft/`, con strumento e
  upstream della base: i motori di `motori.mjs` (`vendor.mjs verify-upstream`)
  e i dati di `dati.mjs` (`provenienza.mjs verify-upstream`, sha256 dell'URL
  contro il checkout); una cartella non dichiarata è rossa.
- Il gate di release è `.github/scripts/check-release-gate.mjs`: aggiungere o
  rinominare un job richiede di aggiornarlo.
- Un push fa girare la CI solo su `main`; una PR la fa girare a ogni push, e un
  push più recente annulla la corsa precedente.
- Un test noto come instabile ha un'issue aperta: rilancia una volta i job
  falliti; se un job resta rosso, indaga prima di dirlo instabile.
- Per leggere una corsa: `gh run view <corsa> --json jobs`; il log di un job:
  `gh api repos/Fubeo/Fub/actions/jobs/<job>/logs`; un artefatto:
  `gh api repos/Fubeo/Fub/actions/artifacts/<id>/zip`, perché `gh run
  download` ne rifiuta alcuni.

### Le baseline dal runner

Quando la CI di una PR pronta cade **soltanto** sul banco visivo,
[`baseline.yml`](../../.github/workflows/baseline.yml) committa sul ramo, come
`github-actions[bot]`, le foto del runner nuove e cambiate (mai cancellazioni),
poi rilancia `npm-supply-chain.yml` e `ci.yml` con `riuso_di=<corsa>` (senza,
se il ramo è partito prima di questo input). Non agisce su un fork, sul ramo
predefinito, se il ramo è andato avanti o se la PR ha l'etichetta
`baseline-a-mano`; non esegue codice della PR e convalida l'artefatto prima di
scrivere un file. Le regole e le loro prove stanno in
[`baseline-dal-runner.mjs`](../../.github/scripts/baseline-dal-runner.mjs).

Nella corsa rilanciata il job `cosa cambia` decide il **riuso**: se il commit
ha per unico genitore la testa della corsa `riuso_di`, cambia solo
`apps/client/bench/baseline/*.png` e in quella corsa ogni job tranne il banco
visivo era verde o saltato, con i test sui tre sistemi, gli altri job si
saltano e contano come in quella corsa; gira soltanto il banco visivo. Il
riepilogo della corsa dice quali job riusa, o perché gira tutto. Il riuso non
vale per il cancello del rilascio, che vuole ogni job verde.

Il banco visivo della corsa rilanciata fotografa la testa del ramo, non il
merge di prova con `main`: se `main` nel frattempo ha cambiato la grafica può
cadere, e le baseline si sistemano a mano. Le foto del commit del bot si
guardano comunque, nel foglio di contatto dell'artefatto, prima di unire.

## Matrice per modifica

| Modifica | Test necessari |
|---|---|
| helper puro | unit test |
| provider | unit test e `MemoryHost` |
| kernel, mount o sessione | test del crate e integrazione `fub-testkit` |
| storage | integrazione, corruzione e interruzione |
| IPC | mirror, fixture e test shell |
| UI | Vitest, type-check, build, accessibilità |
| menu o voci di un menu | `src/ui/menu-budget.test.ts` (nove voci e quattro gruppi al primo livello, niente tasti per muoversi scritti nel menu) |
| azioni di un blocco, maniglia, barra di formato, pulsanti sul foglio | `src/editors/text/profiles/markdown/three-doors.test.ts` (le stesse azioni da ogni porta, nessun pulsante a riposo) |
| resa | banco visuale |
| WIT | conformità, additività e componente reale |
| runtime WASM | componente reale, casi positivi e negativi di limiti e ciclo di vita |
| docs | tutti i guard documentali |
| trasversale | il ciclo Rust e frontend pertinente e i guard di `CONTRIBUTING.md` |

## Qualità della prova

Un test deve fallire per la proprietà che nomina. Evita:

- conteggi fragili senza significato architetturale;
- snapshot enormi non leggibili;
- test saltati quando manca l'artefatto che dovrebbero costruire;
- attese basate su sleep quando esiste un clock controllabile;
- fixture che copiano l'implementazione;
- verifiche che cercano una sottostringa in un errore tipizzato.
