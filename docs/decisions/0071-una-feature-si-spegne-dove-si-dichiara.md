# 0071 — Una feature si spegne dove si dichiara

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §16.3 (seduta 16) — il **primo tempo**: la cargo feature per bundle |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/16-crate-sdk-banchi-di-prova.md) ·
[l'inventario che è la sorgente](0056-un-elenco-che-e-la-sorgente.md) ·
[chi possiede i bundle](0031-chi-possiede-i-bundle.md) ·
[il banco del lato host](0055-il-banco-del-lato-host.md)

---

`fub-features` era un crate solo con `tantivy` fra le dipendenze normali, quindi
**compilare il pannello struttura compilava un motore di ricerca**. Il §16.3
diceva questo, e diceva anche che la voce si taglia in due tempi che comprano
cose diverse: una cargo feature per bundle — «costa un pomeriggio, si può fare
subito» — e lo split in crate, che è l'unica forma che compra un confine contro
l'accoppiamento feature↔feature.

Questo verbale chiude il **primo tempo**, e lascia il secondo aperto con la sua
ragione scritta. Chiudere mezza voce non è una novità di processo: il criterio
l'ha fissato la [0031](0031-chi-possiede-i-bundle.md) e sta in fondo a questo
indice.

## La decisione

**Ogni feature ufficiale ha una cargo feature omonima, e il posto in cui si
legge è l'inventario.**

- `[features]` in `crates/fub-features/Cargo.toml`: `search`, `versioning`,
  `backlinks`, `outline`, `tags`, `stats`, `commands`, `blocks`. `default` le
  accende tutte. `tantivy` è `optional` e sta dietro `search`, che è l'unica
  dipendenza pesante del crate ed è di una feature sola.
- Ogni riga di `src/inventario.rs` sta dietro un `#[cfg(feature = "…")]`,
  insieme al suo `pub mod`. `UFFICIALI` smette di essere `[FeatureUfficiale; 8]`
  e diventa `&[FeatureUfficiale]`: **il numero non è più una costante**, e non
  deve esserlo.
- `fub-host` inoltra, una feature per bundle, sotto l'ombrello
  `feature-ufficiali`; i tre siti irregolari di `mount.rs` — indice, versioning,
  blocchi — e la superficie versioning di `session.rs` seguono il `cfg`.
- `fub-app` non ha cargo feature per bundle: l'app che spediamo è la build
  piena, e chiede per nome la sola feature che usa direttamente (`versioning`,
  per `VersionRef` che attraversa l'IPC).

**La misura**: il grafo delle dipendenze di `fub-features` passa da **120 crate
a 26** compilando la sola `outline`. È tutto ciò che il primo tempo prometteva,
ed è arrivato intero.

## Le decisioni prese, da NON ridiscutere senza motivo

### Il posto in cui si legge è l'inventario, e non è una preferenza di stile

La voce lo diceva già, come cliente arrivato dalla
[0056](0056-un-elenco-che-e-la-sorgente.md): l'inventario è già l'elenco di
*cosa esiste*, quindi «una riga che sparisce dietro un `#[cfg]` deve sparire da
lì».

La ragione per cui è la scelta giusta si vede provando l'alternativa. Se il
`#[cfg]` stesse solo sul `pub mod`, l'inventario resterebbe di otto righe in
ogni build, e in quelle parziali nominerebbe moduli che non esistono — cioè non
compilerebbe, e va bene. Ma la variante che compila è peggio: un inventario che
elenca *tutti* i bundle e un `mount` che ne salta alcuni. Quello è precisamente
il difetto che la 0056 ha chiuso — **un elenco che descrive invece di
costituire** — riaperto da un'altra porta, e sarebbe rimasto verde.

Con il `cfg` sulla riga i due sono la stessa cosa per costruzione: il modulo
sparisce, la riga sparisce, `mount` non la vede, il bundle non si dichiara. Non
esiste uno stato in cui una feature sia compilata e non dichiarata, o dichiarata
e non compilata.

### La corrispondenza si **calcola**, non si tabella

`tests/le_cargo_feature.rs` confronta le cargo feature dichiarate nel
`Cargo.toml` con le righe dell'inventario, e lo fa **senza una terza tabella**:
l'id di un bundle è `fub.<nome del modulo>` e la cargo feature ha il nome del
modulo, quindi la corrispondenza è togliere un prefisso.

Non è un dettaglio di implementazione. Una tabella `("search", SEARCH_ID)`
sarebbe stata un terzo elenco da tenere allineato agli altri due — il difetto di
partenza scritto una volta di più, con nomi migliori. Che i nomi coincidessero
già era una fortuna, e vale la pena dirlo: se un giorno non coincidessero, la
risposta è rinominare, non aggiungere la tabella.

Il presidio prova tre cose, e le direzioni non sono simmetriche:

- **ogni riga ha la sua cargo feature** — è la direzione che si rompe per prima
  (si scrive il modulo, lo si mette nell'inventario, e il `Cargo.toml` se lo
  dimentica: quella feature non si può spegnere e nessuno se ne accorge);
- **ogni cargo feature è in `default`** — perché il default *è* l'app che
  spediamo, e una feature fuori di lì sarebbe una feature che l'utente non ha,
  spenta senza dirlo a nessuno;
- **nella build piena i due elenchi coincidono** — la direzione opposta, che
  vale solo lì: in una build parziale l'inventario è più corto di proposito.

Le prime due sono state verificate al contrario. Togliere una riga
dall'inventario lasciando la cargo feature rende rosso il terzo test con
l'insieme stampato. Togliere una cargo feature lasciando la riga non arriva
nemmeno al test: **cargo rifiuta il manifest**, perché `default` nomina una
feature che non c'è. È un presidio migliore di quello che avevamo scritto, e non
l'abbiamo scritto noi.

### CI compila tre configurazioni parziali, e sono `build` e non `test`

Il `cargo test --workspace` compila sempre la build piena, quindi da solo non si
accorgerebbe mai che lo scorporo è tornato a essere finto: basta un `use` senza
`#[cfg]` e tutto resta verde, con tantivy dentro il pannello struttura. I tre
comandi in CI — nessuna feature, la sola `outline`, `fub-host` con la sola
`outline` — sono la misura al contrario, e la domanda che pongono è *se
compila*, non *se funziona*. Da qui la scelta di `build`.

### Il banco di una feature vive con lei

Nove file di test di `fub-features` hanno preso un `#![cfg(feature = "…")]` in
testa: senza il modulo non hanno un soggetto. Due presidi hanno preso un `cfg`
**diverso**, e la differenza dice qualcosa.

`conformita.rs` e `view_refresh_masks.rs` finiscono con
`assert!(viste > 0, "l'inventario non ha nessuna view")` — il conto che la 0056
aveva messo lì con la ragione «una suite che gira su zero implementazioni non è
una suite, è un test che passa». Quella ragione resta buona, ma da oggi *zero
view* è anche una build legittima. Il `cfg` che hanno preso è quindi
`any(backlinks, outline, tags, stats)`: **la domanda ha senso se c'è almeno una
view**, e allora la risposta deve essere maggiore di zero. Indebolire l'assert a
`>= 0` avrebbe spento il presidio per far passare un caso nuovo, che è il verso
sbagliato.

### L'app non si spegne a pezzi, e chi sta sotto sì

`fub-app` non ha una cargo feature per bundle. Il guadagno di compilazione sta
dove si compila il crate delle feature, cioè sotto; l'app è la build piena per
definizione, e darle otto interruttori sarebbe stato regalare configurazioni che
nessuno spedisce e che nessuno prova.

Ma la dipendenza su `versioning` è dichiarata lo stesso, e per una ragione che
vale oltre questo caso: che `fub-host` la accenda già di suo **non la rende
nostra**. Sarebbe una dipendenza che regge finché nessuno tocca il `Cargo.toml`
di qualcun altro — la feature unification di cargo è un fatto della build, non
una promessa fra crate.

Nota di attrito, per chi ci ripasserà: `default-features = false` va scritto
nella riga di `[workspace.dependencies]`, non nel crate che consuma. Cargo
ignora la seconda forma se la prima non c'è, e lo dice in un warning che
diventerà un errore.

## Cosa resta fuori, e perché

**Il secondo tempo — lo split in crate — resta aperto**, e non per mancanza di
tempo.

Comprerebbe una cosa sola che il primo non compra: il **confine contro
l'accoppiamento feature↔feature**, perché dentro un crate solo `pub(crate)`
lascia passare tutto. Quel confine serve quando c'è qualcosa da separare, e la
misura di «qualcosa» la dà la voce stessa: i venti moduli della §21.2 (FubTasks,
FubDB, FubCanvas, FubCalendar, FubAI, FubMaps…), che **oggi non esistono**. Le
feature ufficiali sono otto, e i loro moduli non si citano fra loro nemmeno una
volta — l'unico riferimento incrociato che c'è nei sorgenti è un link di
documentazione a `backlinks::catalog`, ripetuto in sei moduli su otto perché
spiega dove sta un catalogo.

Farlo adesso significa pagare venti `Cargo.toml` per otto moduli che non si
parlano. Farlo mai significa scoprire l'accoppiamento quando districarlo costa
venti volte tanto. La condizione che lo sblocca è scritta e non è una data: **il
primo import fra due moduli di feature che non sia un link di documentazione**.

Il primo tempo non aveva nessuna di queste condizioni, ed è esattamente per
questo che la voce lo teneva scorporato: era la parte che si poteva prendere
senza decidere il resto. Averla presa non anticipa niente del secondo — la cargo
feature per bundle è ciò da cui uno split partirebbe comunque.

## I precedenti

**Un numero fisso è una promessa che il `cfg` smentisce.** `[FeatureUfficiale; 8]`
era corretto, e lo era per una ragione che oggi non c'è più. Con lui sono cadute
sei righe di prosa che contavano — «gli otto bundle ufficiali», «le nove righe»,
«nessuna delle nove» in `mount.rs` — e nessuna era sbagliata prima di questo
commit. È la famiglia del [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md#168-la-prosa-che-conta-i-sorgenti-non-ha-nessun-presidio)
vista dal lato in cui si crea invece che da quello in cui si scopre: **un conteggio
scritto in italiano invecchia il giorno in cui il numero diventa condizionale**,
e chi rende condizionale un numero è l'unico che sa dove sono le righe da
riscrivere. Cercarle è parte del lavoro, non una pulizia da fare dopo.

**Un presidio che diventa rosso per un caso nuovo e legittimo non si
indebolisce: si circoscrive.** Il conto `viste > 0` è rimasto quello che era, ed
è cambiata la condizione in cui gli si fa la domanda. La differenza fra le due
mosse — abbassare la soglia, o dichiarare quando la soglia si applica — è che la
prima spegne il presidio anche nel caso per cui era stato scritto.
