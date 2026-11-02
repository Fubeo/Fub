# Piano: K3 · Lo strato dei motori

Branch: piano/k3-motori
Obiettivo: i motori copiati (per primi GridCraft e WordCraft) si costruiscono
alla prima richiesta, tengono le cache sotto un budget comune e le rendono
quando si chiude; i comandi di GridCraft diventano comandi di Fub, e ognuno si
raggiunge.
Perché: K0 ha misurato che chiudere non rende la memoria (glibc la trattiene,
le cache dei motori restano piene) e che senza un posto comune ogni motore
nuovo (PdfCraft in P1, VectorCraft in K5) porterebbe i suoi thread, le sue
cache e i suoi comandi scritti a mano.
Fuori scope: PdfCraft, VectorCraft, PhotoCraft, LightCraft (P1, K5, K7, K8);
la scheda grafica e l'archivio comune dei caratteri (A3); i processi a parte
per JavaScript dei PDF, OCR e IA (regola 7, arrivano con chi li usa); le
modalità complete; il nuovo IPC «scalda» e «documento chiuso» finché l'utente
non dice sì (A8: pronto su un branch a parte); rifare a mano la barra dei
fogli.
Assunzioni: A1–A10 qui sotto, decise dall'orchestratore il 2026-11-02 di notte
(l'utente non poteva rispondere; le domande sono in fondo).
Ondate: T1 T2 T3 | T4 T5 T6 | T7 T8 | T9
Prototipo: nessuno (l'unica cosa che si vede è la finestra dei parametri di
T7, fatta con i pezzi del kit).

## Modifiche

nessuna

## Fonti

- Piano «Fub a componenti», fase K3, e il passo `10-k3-motori.md` dei «Piani
  di Fub» (i coder non li leggono: qui c'è ciò che serve).
- Le misure di K0: `docs/misure/motori-2026-10-31-linux-ryzen.md`,
  `tools/motori-prova/budgets.json`, `apps/client/bench/webview/budgets.json`.
- Scritto su main @ 620f0acd (2026-11-02).

## Assunzioni

Dove il codice e il piano non dicono la stessa cosa vince il codice; la
differenza è scritta qui.

- A1 · **Il registro è dinamico, i motori stanno negli adattatori.** Il piano
  disegna `Motori { pdf: Pigro<MotorePdf>, … }` dentro `fub-motori`, con un
  campo per motore. Così `fub-motori` nominerebbe i motori, che per
  `check-engine-boundary.mjs` e `dependency_invariant` (`GRIDCRAFT_OWNERS`,
  `WORDCRAFT_OWNERS`) solo gli adattatori possono nominare, e dovrebbe
  dipendere dagli adattatori, che dipendono da lui. Quindi `fub-motori` non
  nomina nessun motore: dà `Pigro<T>`, `Servizi`, `Budget`, `Cache`, il
  catalogo e un registro `Motori` dove ogni adattatore iscrive il suo motore
  (`fub-format-xlsx` → «fogli», `fub-format-rich` → «documenti»).
- A2 · **Un registro e dei servizi per processo.** `Servizi::processo()` e
  `Motori::processo()` sono unici nel processo (Fub è un processo solo,
  regola 1); per i test c'è `Servizi::nuovi(config)`, che non tocca quelli del
  processo.
- A3 · **Scheda grafica e caratteri arrivano col primo motore che li usa.**
  Nessun motore acceso oggi usa `wgpu` (non è nemmeno nell'albero: sarebbe una
  dipendenza nuova) né un archivio di caratteri (GridCraft e WordCraft in Fub
  non ne hanno; quello del disegno, `fub_fonts()` in
  `crates/fub-features/src/draw.rs`, è solo suo). `Servizi` è fatto in modo
  che `gpu: Pigro<Gpu>` e `caratteri: Pigro<Caratteri>` si aggiungano senza
  cambiare chi lo usa. È una domanda per l'utente (D-1).
- A4 · **`rayon` e `libc` diretti.** Sono già nell'albero (`rayon` 1.12 da
  tantivy, `libc` 0.2 da notify e glib; `fub-kernel` usa già `libc` così, con
  il commento che lo spiega): nessun crate nuovo. Il gruppo di thread dei
  motori è un `rayon::ThreadPool` suo, con un nome, costruito alla prima
  richiesta, non quello globale (tantivy lo usa già).
- A5 · **Il tetto della memoria.** Parte da un ottavo della RAM installata,
  fra 256 MiB e 2 GiB (Linux: `MemTotal` di `/proc/meminfo`; altrove 1 GiB),
  e scende con la pressione: su Linux PSI (`/proc/pressure/memory`), metà con
  `some avg10 ≥ 10`, un quarto con `full avg10 ≥ 5`. Macos e Windows: per ora
  nessun segnale, il tetto resta quello di partenza (scritto nella pagina di
  `docs/`). La pressione si legge quando si chiama `rispetta()`, senza un thread
  in più.
- A6 · **«Chiudere libera» con `malloc_trim`.** Su Linux con glibc,
  `rilascia_al_sistema()` chiama `malloc_trim(0)`; altrove non fa niente. Si
  chiama quando un motore svuota le cache dopo l'ultima chiusura.
- A7 · **Le cache globali dei motori si liberano con patch numerate.** Oggi il
  dizionario dell'ortografia di GridCraft (`/usr/share/dict/words`, fino a due
  milioni di righe) e quelli di WordCraft (Hunspell, sillabazione) restano in
  un `OnceLock` per sempre. Una patch per motore li rende liberabili, con la
  sua proposta a monte (regola 7).
- A8 · **Scaldare e «documento chiuso» vogliono IPC nuovi.** Il piano dice
  «quando il puntatore passa su un file, o si apre una cartella, il motore si
  prepara»; l'host non sa né l'una né l'altra cosa, e il client non dice mai
  all'host che un documento (`.docx`) si è chiuso: l'host di WordCraft è senza
  stato. I due comandi IPC non sono nominati dal piano, quindi si chiedono
  (D-2). Stanotte T8 li scrive su un branch a parte, `piano/k3-ipc-motori`,
  pronto da unire con un sì; nel branch del piano i documenti si liberano alla
  chiusura del vault e quando il budget lo chiede.
- A9 · **WordCraft non ha un catalogo dei comandi in Fub.** La facciata
  `engine` di WordCraft non è copiata (`vendor/wordcraft/UPSTREAM.md`); i
  comandi del documento sono del client (ProseMirror). Per WordCraft «passa sul
  registro» vuol dire vita del motore e cache; il catalogo vale per GridCraft,
  e per PdfCraft da P1.
- A10 · **«Raggiungibile».** Il client ha la barra dei fogli scritta a mano
  (`apps/client/src/editors/grid/ribbon/tabs.ts`), con le sue finestre. Non si
  rifà: il catalogo importato aggiunge ogni comando servito alla tavolozza dei
  comandi quando un foglio ha il fuoco (T7), con la finestra dei parametri
  generata dallo schema quando servono. Un comando del motore è raggiungibile
  se è importato (titolo, posto nel menu, parametri leggibili) o se è
  nell'elenco «non servito» con il suo perché. Il test di copertura stampa
  anche quanti comandi stanno solo nella tavolozza: «quanto manca» alla barra.

## Domande per l'utente (raccolte, non bloccano)

- D-1 · Scheda grafica e caratteri: li aggiungo quando arriva il primo motore
  che li usa (PdfCraft o VectorCraft), non in K3? Consiglio: sì, perché oggi
  sarebbero codice che nessuno chiama, e la scheda grafica porterebbe una
  libreria nuova.
- D-2 · Due comandi nuovi fra la finestra e il programma: «scalda il motore di
  questo tipo» (al passaggio del puntatore su un file, all'apertura di una
  cartella) e «ho chiuso questo documento» (per svuotare subito le cache dei
  documenti). Sono pronti su un branch a parte. Consiglio: sì.
- D-3 · I comandi dei fogli che non sono nella barra si trovano nella
  tavolozza dei comandi, con una finestra dei parametri generata. Va bene così
  per ora, o li vuoi anche in un menu? Consiglio: tavolozza per ora; il menu
  arriva con la modalità completa dei fogli.

## Cancello di K3

| Fatto quando | Prova | Task |
|---|---|---|
| dopo «chiudi tutto» la RAM torna entro la tolleranza di K0 | R1 (`npm run bench:webview -- --only=R1`): `R1.residuo.MiB` e `R1.giri.pendenza.MiB` entro i target di `bench/webview/budgets.json` dove la macchina li misura, entro `ci` nella CI; numeri prima e dopo in `docs/misure/` | T5, T6, T9 |
| il tempo d'avvio di Fub non cambia | S6 `coldStart` prima e dopo, stesso build, differenza dentro il rumore di due giri uguali | T9 |
| nessuna regressione nei banchi di fogli e documenti | `bench:grid`, `bench:large`, `bench:fidelity`, `tempi.rs` dei fogli, `corpus.rs` dei documenti: prima e dopo | T9 |
| ogni comando del motore si raggiunge | `crates/fub-motori/tests/copertura.rs`, `ogni_comando_del_motore_si_raggiunge`, e il test del client sulla tavolozza | T4, T7 |
| nessuna interfaccia di un'app Craft in Fub, librerie doppie sotto il tetto | `node .github/scripts/check-motori.mjs` nella CI | T2 |
| niente all'avvio | test: dopo l'apertura di un vault nessun motore è costruito; il primo `.xlsx` aperto costruisce solo «fogli» | T1, T5 |

## Regole che valgono per ogni task

- Mai un lucchetto tenuto mentre un motore lavora o mentre si chiama una
  cache: si prende l'`Arc`, si lascia il lucchetto, poi si chiama (AGENTS.md).
- Niente thread nuovi all'avvio; niente lavoro all'avvio.
- Non scrivere numeri non misurati.
- I motori copiati si cambiano solo con una patch numerata e la sua riga in
  `UPSTREAM.md` (`tools/vendor-craft/vendor.mjs … check` deve restare verde).
- Testi nei cataloghi, con la chiave in tutte le lingue; il gergo vietato di
  `apps/client/src/i18n/gergo.ts` resta fuori. Nessun nome ArtCraft o Craft
  nell'interfaccia.
- Mai il vault reale (`~/.cache/fub-live/vault-tutti/`).

## T1 · Il crate `fub-motori`

Perché: un posto solo per costruire i motori quando servono, per il gruppo di
thread e per il budget delle cache.
Tocca: `crates/fub-motori/` (nuovo: `Cargo.toml`, `src/lib.rs`,
`src/pigro.rs`, `src/servizi.rs`, `src/lavori.rs`, `src/memoria.rs`,
`src/pressione.rs`, `src/registro.rs`, `tests/`), `Cargo.toml` della radice
(membro e `[workspace.dependencies]`), `Cargo.lock`,
`docs/architecture/overview.md` (la scatola e la riga che la spiega),
`crates/fub-abi/tests/dependency_invariant.rs` solo se un elenco lo chiede,
`docs/architecture/motori.md` (nuovo) e il suo collegamento da un indice di
`docs/`, `docs/decisions/0236-lo-strato-dei-motori.md` (nuovo, ADR).
Non toccare: gli adattatori (`fub-format-xlsx`, `fub-format-rich`), `vendor/`,
`fub-host`.
Dipende da: nessuno
Cosa fare:
- `ErroreMotore` (thiserror): lucchetto avvelenato, creazione fallita con il
  motivo, motore sconosciuto.
- `Pigro<T>`: `Pigro::nuovo(crea: fn(&Arc<Servizi>) -> Result<T, ErroreMotore>)`;
  `prendi(&self, &Arc<Servizi>) -> Result<Arc<T>, ErroreMotore>`; `scalda(self:
  &Arc<Self>, Arc<Servizi>)` in sottofondo; `libera(&self) -> bool`;
  `acceso(&self) -> bool`. Uno stato Vuoto · In costruzione · Pronto: chi
  arriva durante la costruzione aspetta su una `Condvar` senza tenere il
  lucchetto mentre `crea` lavora, e la creazione avviene una volta sola; se
  `crea` fallisce si torna a Vuoto e chi aspettava riceve l'errore; `crea` che
  va in panico non lascia lo stato in costruzione per sempre. `libera` durante
  la costruzione non la interrompe.
- `Lavori`: un `rayon::ThreadPool` costruito alla prima richiesta, thread
  `fub-motore-{n}`, quanti `available_parallelism() - 1` (almeno 1, al più 8);
  `in_sottofondo(f)` e `installa(f)`; un panico in un lavoro si scrive con
  `tracing` e non chiude il processo (`panic_handler`).
- `memoria.rs`: `trait Cache: Send + Sync { nome, byte, libera(quanto) -> u64,
  ultimo_uso() -> Instant }`; `Budget { tetto, cache: Weak<dyn Cache> }` con
  `registra(&Arc<dyn Cache>)`, `usati()`, `tetto()`, `rispetta()` (dalla meno
  usata di recente finché si sta sotto il tetto; le `Weak` morte si tolgono;
  due `rispetta()` insieme non lavorano due volte), `svuota_tutto()` e
  `rilascia_al_sistema()` (A6). Il lucchetto dell'elenco non è tenuto mentre si
  chiama una cache.
- `pressione.rs`: il tetto di A5; la lettura di `/proc/meminfo` e di
  `/proc/pressure/memory` è una funzione pura sul testo, provata con campioni;
  la sorgente si sostituisce nei test.
- `servizi.rs`: `Servizi { lavori, memoria }`, `Servizi::processo()` e
  `Servizi::nuovi(config)` (A2, A3).
- `registro.rs`: `Motori` con `registra(spazio, estensioni, voce)`, dove la
  voce è un `Arc<dyn Voce>` (`acceso`, `scalda`, `svuota`, `libera`, `byte`);
  `scalda_per(estensione)`, `voce(spazio)`, `elenco()` (spazio, acceso, byte),
  `Motori::processo()`. Registrare due volte lo stesso spazio è un errore.
- L'ADR 0236 dice A1, A2, A3, A5 e A6; `docs/architecture/motori.md` spiega
  le regole (niente all'avvio, un lucchetto mai tenuto, il budget, chiudere
  libera) e come un adattatore iscrive il suo motore.
Casi limite: `prendi` da dieci thread insieme (una costruzione); `crea` che
fallisce e poi riesce; panico in `crea`; `libera` mentre un altro tiene l'`Arc`
(il motore vive finché l'ultimo `Arc` non cade); una cache che libera meno di
quanto chiesto o niente; tetto zero; `/proc/pressure` assente (kernel vecchio,
container).
Fatto quando: test in `crates/fub-motori/tests/`: una costruzione con dieci
thread; errore e ritentativo; panico in `crea`; `rispetta()` libera dalla meno
usata e si ferma sotto il tetto; una `Weak` morta sparisce; parser di PSI e di
`meminfo` sui campioni; il diagramma di `overview.md` e `dependency_invariant`
verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T2 · La guardia `check-motori.mjs`

Perché: l'interfaccia di un'app Craft non deve entrare in Fub per errore, e le
librerie compilate due volte possono solo calare.
Tocca: `.github/scripts/check-motori.mjs` (nuovo), un suo test accanto se le
altre guardie ne hanno uno, `docs/reference/budgets.json` (nuovo), la pagina di
`docs/` che elenca le guardie della CI (cercare dove sono descritte
`check-engine-boundary.mjs` e le sorelle) e `docs/map/repo.md` se le elenca.
Non toccare: `.github/workflows/ci.yml` (lo aggiunge l'orchestratore), i
`Cargo.toml`.
Dipende da: nessuno
Cosa fare:
- Nessuna interfaccia: `cargo tree -p fub-app -e normal --prefix none
  --all-features --target all`; se compare uno fra `egui`, `eframe`,
  `egui-wgpu`, `egui-winit`, `winit`, `rfd`, `accesskit_winit`, fallisce con
  il nome e chi lo tira dentro (`cargo tree -i`).
- Librerie doppie: `cargo tree -p fub-app -d --depth 0 --prefix none -e normal
  --all-features --target all`, i nomi distinti; il tetto è
  `librerie_doppie` in `docs/reference/budgets.json`, scritto col numero di
  oggi; sopra il tetto fallisce con l'elenco; sotto il tetto di più di zero
  avvisa di abbassarlo (il tetto può solo scendere: lo dice il messaggio e il
  `README` del file).
- Lo stile delle altre guardie (stessi aiuti, stesse uscite, italiano); deve
  girare nel job `invariants` della CI, dove c'è Node e Cargo.
Casi limite: `cargo` che fallisce (errore chiaro, non «zero doppie»); righe
`(*)` di `cargo tree`; un nome con `-` e `_`.
Fatto quando: `node .github/scripts/check-motori.mjs` esce 0 sul branch e
stampa i due numeri; con un `budgets.json` di prova a tetto più basso esce 1
con l'elenco; con un albero finto che contiene `winit` esce 1 (se lo script
accetta un albero da file per la prova, quella è la prova).
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T3 · Le patch che rendono liberabili le cache globali dei motori

Perché: oggi dizionari e cache dei motori restano in memoria per sempre, anche
dopo «chiudi tutto» (A7).
Tocca: `vendor/gridcraft/crates/engine/src/cmd/spelling.rs`,
`vendor/gridcraft/crates/engine/src/display.rs`, i file di WordCraft
`vendor/wordcraft/crates/proof/src/` (`hyphen.rs`, `hunspell.rs`, i
`*/mod.rs` delle lingue, `lib.rs` per l'API), le patch nuove in
`vendor/gridcraft/patches/` e `vendor/wordcraft/patches/` (numeri successivi
all'ultimo), le righe di `UPSTREAM.md` dei due motori.
Non toccare: i crate di Fub (gli adattatori li usano in T5 e T6).
Dipende da: nessuno
Cosa fare:
- GridCraft: il dizionario dell'ortografia diventa liberabile e misurabile
  (`spelling_dictionary_bytes()`, `release_spelling_dictionary()`: si ricarica
  alla prossima richiesta), e la cache dei formati dei numeri si svuota
  (`clear_number_format_cache()`, con quante voci teneva). Nomi e stile del
  codice di GridCraft (inglese).
- WordCraft: Hunspell per lingua e sillabazione per lingua diventano
  liberabili e misurabili (`loaded_dictionaries_bytes()`,
  `release_dictionaries()`; lo stesso per la sillabazione). Le parole
  dell'utente e quelle ignorate non si toccano (sono stato, non cache).
- I byte sono una stima onesta (capacità delle strutture, non `size_of`), e
  la patch dice come si calcola.
- Una patch per motore, generata con il flusso di `tools/vendor-craft`, con
  la riga in `UPSTREAM.md` che dice che cosa fa e perché, e il testo della
  proposta per loro.
Casi limite: liberare mentre un altro thread usa il dizionario (chi lo usa
tiene l'`Arc`, il prossimo lo ricarica); liberare due volte; dizionario di
sistema assente.
Fatto quando: test nei crate copiati (o nel modo che `vendor.mjs` prevede):
carica, misura > 0, libera, misura 0, si ricarica e funziona;
`node tools/vendor-craft/vendor.mjs gridcraft check` e `wordcraft check` verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T4 · Il catalogo dei comandi e il test di copertura

Perché: ogni comando di un motore deve diventare un comando di Fub senza
scriverlo a mano, e nessuno deve restare irraggiungibile (A10).
Tocca: `crates/fub-motori/src/catalogo.rs`, `src/modulo.rs` (nuovi) e il loro
posto in `lib.rs`, `crates/fub-motori/tests/copertura.rs` (nuovo) e la
dev-dipendenza da `fub-format-xlsx`, `crates/fub-format-xlsx/src/catalogo.rs`
(nuovo: da `CommandSpec` di GridCraft a `SpecMotore`), `commands.rs` solo per
dare a ogni voce di `NOT_SERVED` e `NOT_SERVED_PREFIXES` il suo perché, il
`Cargo.toml` di `fub-format-xlsx`, un test che scrive il catalogo per il client
(`crates/fub-format-xlsx/tests/ts_catalogo.rs`, nuovo) e il file generato
`apps/client/src/editors/grid/catalogo.generated.json` (nuovo),
`overview.md` e `dependency_invariant` per le frecce nuove.
Non toccare: `grid.rs` e la vita delle istanze (T5), il client oltre al file
generato (T7), `vendor/`.
Dipende da: T1
Cosa fare:
- `SpecMotore { id, etichetta, menu: Vec<String>, parametri: String }`: la
  forma neutra che ogni adattatore produce dal suo motore.
- `importa(spazio, &[SpecMotore]) -> Vec<ComandoFub>`: `id` =
  `«spazio».«id»` («fogli.format.bold»), `titolo` = la chiave
  `«spazio».cmd.«id»`, `menu` mappato sul posto di Fub (una tabella dal
  percorso del motore, per esempio `["Home", "Font"]`, alla scheda e al gruppo
  della barra dei fogli; un percorso che la tabella non ha è un errore del
  test, non un ripiego), `tasti: None`, `parametri: Modulo::da_schema`,
  `abilitato: Delega::Motore(id)`.
- `Modulo::da_schema`: legge la forma dei parametri di GridCraft (per esempio
  `"{cell, word, to, all?: bool}"`) in campi con nome, tipo (testo, numero,
  sì/no, cella, intervallo, foglio, elenco di valori se lo schema li dà) e
  facoltativo. Si guardano tutte le forme che i ~345 comandi usano davvero; una
  forma che non si capisce è un errore, non un campo di testo silenzioso.
- Lo spazio dei fogli è «fogli». Il catalogo generato per il client contiene,
  per ogni comando servito: id del motore, id di Fub, chiave del titolo,
  etichetta inglese del motore (per T7), posto nel menu, campi. Si rigenera con
  `UPDATE_MIRROR=1` come gli altri file specchiati del repo, e il test
  fallisce se il file non è aggiornato.
- `copertura.rs`, `ogni_comando_del_motore_si_raggiunge`: per ogni comando di
  `command_specs()`, o è importato (titolo, posto, parametri letti) o è fra i
  non serviti con un perché non vuoto. Stampa quanti stanno solo nella
  tavolozza (non sono nella barra: il test del client sa quali sono nella
  barra; qui basta il numero dei comandi senza posto di menu nel motore).
Casi limite: un comando con `menu` vuoto (va nella tavolozza, «senza posto»);
due comandi che dopo il prefisso avrebbero lo stesso id; parametri vuoti; un
id con punti dentro.
Fatto quando: `copertura.rs` verde, e rosso se si aggiunge un comando di prova
(`register_test_command`) senza posto né perché; `ts_catalogo.rs` verde e
rosso con il file generato vecchio; test di `Modulo::da_schema` su ogni forma
trovata.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T5 · GridCraft sul registro

Perché: i fogli sono il primo motore che si costruisce alla prima apertura e
rende la memoria quando l'ultimo foglio si chiude.
Tocca: `crates/fub-format-xlsx/src/motore.rs` (nuovo), `src/grid.rs` (apertura,
chiusura, `shutdown`), `src/lib.rs`, il `Cargo.toml` di `fub-format-xlsx`,
`crates/fub-format-xlsx/tests/motore.rs` (nuovo), `overview.md` e
`dependency_invariant` se la freccia non c'è già.
Non toccare: `commands.rs` e `catalogo.rs` (T4), `fub-host`, il client,
`vendor/` (le API arrivano da T3).
Dipende da: T1, T3
Cosa fare:
- `MotoreFogli` dietro un `Pigro`, iscritto in `Motori::processo()` con lo
  spazio «fogli» e le estensioni `xlsx`, `xlsm`, `xltx`, `xltm` la prima volta
  che il provider si crea (non all'avvio: crearsi il provider non costruisce
  il motore). Costruirlo prepara ciò che oggi si prepara alla prima apertura
  (catalogo dei comandi, funzioni); l'apertura di un foglio lo prende.
- Due cache iscritte nel budget: il dizionario dell'ortografia e i formati dei
  numeri (API di T3), con `ultimo_uso` vero.
- Chiusa l'ultima istanza (`close` che lascia `instances` vuoto, e
  `shutdown`): si svuotano le cache del motore e si chiama
  `rilascia_al_sistema()`; il motore si libera quando il budget lo chiede.
  Chiusa un'istanza qualsiasi: `rispetta()`. Niente di questo con un
  lucchetto del provider tenuto.
- Il salvataggio apre e chiude un'istanza temporanea (`write_workbook_in` in
  `fub-host`): non deve svuotare le cache se un foglio è ancora aperto (conta
  le istanze, non le chiusure).
Casi limite: due riquadri sullo stesso file (due istanze: si svuota alla
chiusura della seconda); chiusura durante un comando lungo; `shutdown` con
istanze aperte; il dizionario mai caricato.
Fatto quando: test in `tests/motore.rs`: creare il provider non costruisce il
motore; la prima apertura sì; chiusa l'ultima istanza le cache sono a zero
byte; con due istanze, chiuderne una non svuota; il budget a tetto basso libera
il dizionario; i test di oggi di `fub-format-xlsx` verdi senza cambiare le
attese.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T6 · WordCraft sul registro

Perché: le prove a vuoto dei documenti (fino a 350 MB) e i dizionari restano in
memoria per sempre; devono stare sotto il budget comune e andarsene quando si
chiude.
Tocca: `crates/fub-format-rich/src/motore.rs` (nuovo),
`src/preservation.rs` (`BASELINES`), `src/lib.rs`, il `Cargo.toml` di
`fub-format-rich`, `crates/fub-format-rich/tests/motore.rs` (nuovo),
`crates/fub-features/src/proof.rs` (le cache dei dizionari, API di T3) e il
`Cargo.toml` di `fub-features` per la feature `proof`,
`crates/fub-host/src/rich.rs` e il punto di chiusura del vault in
`crates/fub-host/src/session.rs` solo per chiamare lo svuotamento,
`overview.md` e `dependency_invariant` per le frecce.
Non toccare: `fub-format-xlsx`, il client, `fub-app`, `vendor/`.
Dipende da: T1, T3
Cosa fare:
- `MotoreDocumenti` iscritto con lo spazio «documenti» e le estensioni dei
  `Codec::ALL`, la prima volta che `RichProvider` si crea.
- `BASELINES` diventa una cache del budget: `byte` stimati dal peso (la stima
  scritta accanto, misurata su un documento vero), `libera` dalla più vecchia,
  `ultimo_uso` aggiornato da `remember` e `remembered`. Le regole di oggi
  (`REMEMBERED`, `REMEMBERED_WEIGHT`, l'ultima tenuta) restano dentro il
  tetto del budget; il budget può togliere anche l'ultima: il salvataggio senza
  prova ricordata la rifà (`session.rs` riga ~214), più lento ma giusto.
- I dizionari di `proof` sono una cache del budget, iscritta da `ProofIndex`.
- Chiusura del vault: si svuotano le cache dei documenti e dei dizionari e si
  chiama `rilascia_al_sistema()`. Il «documento chiuso» dal client è T8 (A8).
Casi limite: salvare dopo che il budget ha tolto la prova (stesso file
scritto); due vault aperti (svuota quello che si chiude solo se l'altro non
ha documenti: se non si sa, si lascia al budget); un documento enorme che da
solo supera il tetto.
Fatto quando: test in `tests/motore.rs`: la cache conta i byte di una prova
ricordata; il budget a tetto basso la toglie e il salvataggio dopo dà gli
stessi byte di prima; i test di oggi (`corpus.rs`, `graft.rs` dove gira, i
test di `preservation.rs`) verdi senza cambiare le attese; un test di
`fub-host` che chiude il vault e trova le cache a zero.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T7 · I comandi dei fogli nella tavolozza

Perché: un comando servito dal motore che non è nella barra oggi non si
raggiunge; con il catalogo arriva nella tavolozza dei comandi, con i parametri
chiesti da una finestra generata (A10).
Tocca: `apps/client/src/editors/grid/` (un modulo nuovo che legge
`catalogo.generated.json` e iscrive i comandi nella tavolozza quando un foglio
ha il fuoco, e la finestra dei parametri generata), il punto dove la tavolozza
riceve i comandi di un editor (`apps/client/src/state/palette-host.ts` o chi
lo usa), i cataloghi dei testi del client (i titoli `fogli.cmd.*` in tutte le
lingue: italiano scritto bene, inglese dall'etichetta del motore, le altre
lingue come fa il repo per una chiave nuova), i test accanto, una scena del
banco per la finestra generata e le sue foto chiara, scura e stretta.
Non toccare: `ribbon/tabs.ts`, `ribbon/strings.ts` e le finestre scritte a mano
(`dialogs/`), il file generato (si rigenera solo da T4), `host/ipc.ts`.
Dipende da: T4
Cosa fare:
- Ogni comando del catalogo è nella tavolozza con il titolo tradotto e il
  gruppo «Foglio»; abilitato o no con il motivo, dallo stato che il provider
  dà già (`grid_bytes_commands`); chiamato con `grid_bytes_command` come fa la
  barra.
- Se il comando ha una finestra scritta a mano (`dialogs/catalog.ts`) si usa
  quella; se ha parametri e nessuna finestra, una finestra generata dai campi
  del modulo con i pezzi del kit (etichette, valori di partenza dalla
  selezione per cella e intervallo, «Annulla» e «Applica», tastiera completa,
  errore del motore mostrato nella finestra).
- Il test del client: ogni comando del catalogo è nella barra, nel menu del
  tasto destro, fra le scorciatoie o nella tavolozza; ogni titolo esiste in
  ogni lingua; stampa quanti sono solo nella tavolozza.
Casi limite: titolo lunghissimo; comando disabilitato con motivo; parametro
facoltativo lasciato vuoto; un foglio in sola lettura; nessun foglio con il
fuoco (i comandi non compaiono).
Fatto quando: test vitest della tavolozza e della finestra generata (anche da
tastiera); `bench:a11y` verde con la scena nuova; le foto della finestra nelle
due luci e stretta.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T8 · Scaldare e «documento chiuso» (branch a parte, A8)

Perché: il motore deve prepararsi prima della prima apertura, e le cache dei
documenti devono svuotarsi alla chiusura dell'ultimo, non solo del vault.
Tocca: (sul branch `piano/k3-ipc-motori`, dal branch del piano dopo T5 e T6)
`crates/fub-host/` (`Host::scalda_motore(estensione)`,
`Host::documento_chiuso(vault, percorso)`), `crates/fub-app/src/lib.rs`, i
permessi e i test di conformità IPC come in K2 (`lean_ipc.rs`,
`ipc_permissions.rs`, `ts_mirror_app.rs`), `apps/client/src/host/ipc.ts`,
`host/contract.ts`, i fake, i punti del client che chiamano (passaggio del
puntatore su un file dell'albero, apertura di una cartella, chiusura di un
documento ricco), `docs/reference/ipc-contract.md`.
Non toccare: `fub-motori` (usa le sue API), i motori.
Dipende da: T5, T6
Cosa fare:
- `warm_engine(extension)`: in sottofondo, al più una volta per motore finché
  è acceso, con un ritardo breve al passaggio del puntatore (non scaldare se il
  puntatore passa e basta); nessuna risposta d'errore se il tipo non ha
  motore.
- `document_closed(vault, path)`: quando il client chiude l'ultima sessione di
  un documento ricco; l'host svuota le cache dei documenti quando non ne resta
  aperto nessuno.
- Tutto dietro i permessi di sempre; con il componente spento non fa niente.
Fatto quando: test di conformità IPC verdi; test dell'host: scaldare costruisce
il motore senza aprire file; chiuso l'ultimo documento le cache sono a zero;
test del client sul ritardo del puntatore.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T9 · La misura del cancello

Perché: il cancello di K3 si dice con i numeri, prima e dopo, sulla stessa
macchina.
Tocca: `docs/misure/k3-motori-<data>-<macchina>.md` (nuovo), il collegamento
da un indice di `docs/misure/`, `apps/client/bench/webview/budgets.json` e
`tools/motori-prova/budgets.json` solo per abbassare un tetto.
Non toccare: il codice.
Dipende da: T5, T6 (e T8 se unito)
Cosa fare:
- R1 e S6 sul main di partenza e sul branch, stesso modo di lancio, almeno due
  giri ciascuno; i banchi `bench:grid`, `bench:large`, `bench:fidelity`;
  `tempi.rs` dei fogli e `corpus.rs` dei documenti; le misure di
  `tools/motori-prova` per fogli e documenti dopo «chiudi tutto».
- Dove la macchina non può misurare (WebView senza schermo), lo si scrive e si
  usa il job `webview` della CI.
Fatto quando: la pagina con le tabelle prima/dopo e il giudizio sul cancello,
con i numeri veri.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare
