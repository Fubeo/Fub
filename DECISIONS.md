# Decisioni del lavoro a piani

Questo file serve al workflow a piani (`/pianifica`, `/orchestra`, vedi
`CLAUDE.md`). Dice che cosa l'orchestratore decide da solo e che cosa chiede,
e tiene il registro delle scelte fatte durante il lavoro, perché il piano dopo
ne tenga conto. Le scelte di architettura vere vanno in un ADR
(`docs/decisions/`); qui resta una riga che lo nomina.

## Il criterio

Il risultato migliore, anche quando costa più tempo, più lavoro o più coder:
fra due strade si sceglie quella più solida, non quella più corta. E poche
domande: l'utente decide ciò che vede e ciò che non si può disfare; il resto lo
decide l'orchestratore, lo scrive nel registro e lo dice nel resoconto. Nel
dubbio su una scelta tecnica si decide, non si chiede.

## L'orchestratore decide da solo

- l'ordine dei task pronti e quanti coder far lavorare insieme (al massimo tre);
- il come che il piano approvato lascia aperto: nomi, tipi, dove sta una
  funzione, la forma di un messaggio d'errore, la forma dei test;
- un piccolo refactor dentro i file del task;
- i formati interni che solo Fub legge e scrive (chiavi delle impostazioni,
  file di cache, il canale fra CLI e app), dentro ciò che il piano ha approvato;
- una dipendenza nuova fra crate del workspace che il piano implica, con il
  diagramma di `docs/architecture/overview.md` e `dependency_invariant`
  aggiornati;
- allargare il perimetro di un task a un file strettamente legato (il suo
  test, un chiamante, un file generato, la pagina di `docs/` che lo descrive),
  anche su richiesta del coder;
- i conflitti banali quando unisce (una riga in una lista, un indice, una
  tabella di testi);
- rilanciare un coder con un'indicazione più precisa, o finire da sé una
  correzione piccola;
- correggere un rosso di fmt, clippy o test causato dal task;
- dividere un task troppo grande in due, senza cambiarne il «Fatto quando».

Ogni decisione presa da solo che un altro piano dovrebbe conoscere va nel
registro.

## Chiede sempre

- ciò che chi usa Fub vede o fa in modo diverso da come dice il piano
  approvato;
- il contratto pubblico: ABI e WIT dei plugin, i comandi IPC del client che il
  piano non nomina, un formato su disco che leggono altri programmi o versioni
  già pubblicate;
- sicurezza e permessi;
- una dipendenza esterna nuova o una licenza;
- cambiare «Fatto quando» o «Fuori scope», saltare o rinviare un task;
- disattivare, saltare o mettere in quarantena un test;
- il merge.

Quando chiede: le domande di un momento tutte insieme, solo quelle la cui
risposta cambia davvero il risultato, con la conseguenza pratica di ogni
scelta e la raccomandazione per prima.

## Registro

La più recente in cima: data · piano · decisione · perché.

- K3 T14 (e3b8afc0): il menu «Comandi» è `editors/grid/menu-comandi.ts`
  (`openCommandMenu`) agganciato alla fila `quick` della barra; i comandi
  che la barra non ha passano da una seconda istanza della tavolozza
  (`mountGridPalette` dentro `ribbon/ribbon.ts`, vive quanto la barra).
  `ui/menu.ts` ha tre opzioni nuove (`label`, `fullSearch`,
  `reachDisabled`); la ricerca piena tiene l'altezza del posto e scorre.
  Scarti dal prototipo: il tooltip del gettone è «Comandi» e «Tutti i
  comandi del foglio» è l'aria-label del menu; l'icona è `outline` perché
  `ribbon/icons.ts` era fuori dai Tocca (da rivedere in T17 col prototipo);
  la scena `grid-commands-search` usa una ricerca senza risultati perché con
  testo lo Spazio scrive nella ricerca e la regola tastiera dell'a11y la
  boccerebbe; nessuna scena sotto 560 px (scene.test vuole finestre ≥ 800
  px; il gettone senza nome lo mostra `mobile-grid-ribbon`). Restano: il
  piede del menu non resta fisso in fondo nelle ricerche lunghe; le baseline
  delle scene nuove e di `mobile-grid-ribbon` dal runner (T17).
- K3 T13, dopo la CI di 8493f177: effetto.rs cadeva sul runner perché
  review.spelling chiede l'elenco di parole del sistema
  (/usr/share/dict/words), che il runner non ha, e GridCraft rifiuta il
  controllo prima di toccare la cartella. L'orchestratore accetta quel solo
  rifiuto, per i comandi review.*, come «non provato» (lo stampa); con
  l'elenco il comando gira e la prova vale. Provato in locale nei due modi
  (con l'elenco, e con l'elenco coperto in uno spazio dei nomi).
- K3 T13 integrata (4f244e0d). Gli effetti sono 250 cambia, 31 legge, 22
  mostra (il prototipo ne dice 250/29/24, il piano 249/29/24).
  L'orchestratore tiene la regola del piano, provata da effetto.rs, al posto
  dei conti: view.normal, view.split, view.customViews e
  formulas.watchWindow scrivono nel giornale e passano fra i Cambia (il
  prototipo li dice mostra o legge); insert.chartRecommendations,
  data.scenarioManager e file.printPreview (legge) e file.exportPdf (mostra)
  lasciano commit.edit vuoto e restano accesi in sola lettura (il prototipo
  li dice cambia). La tavolozza scrive «Scheda X della barra» solo se la
  barra mostra la scheda e il gruppo del posto, altrimenti «Comando del
  foglio di calcolo»: file, draw e pivot non hanno testi della barra, e i
  testi del menu sono di T14. Toccati in più palette/form.ts e form.test.ts,
  dove sta il tipo CatalogCommand. Rischio: l'effetto vale per comando, non
  per parametri.
- 2026-11-04 · K3 · T18 integrato con i bottoni a 44 px al telefono. La
  shell mobile impone ai bottoni almeno 44×44 (`mobile.css`), e il prototipo
  non ne teneva conto: al telefono i gruppi chiusi impilati sono alti 44
  invece di 38, il vassoio 100 invece di 88, Dati ha 0 gruppi aperti su 4
  invece di 1, Inserisci scorre di 61 invece di 54. Perché: abbassare un
  bersaglio del dito sotto il minimo della shell è una scelta di
  accessibilità e cambia il «Fatto quando», quindi è dell'utente; finché non
  risponde resta la regola della shell, che non tocca il resto del lavoro
  (un'eccezione sarebbe solo CSS dentro `.grid-ribbon`). Le baseline delle 9
  scene nuove arrivano dal runner con T17; fino ad allora `bench/scene.test`
  «ci sono tutte» resta rosso.
- K3 · D-7 (il foglietto chiuso della variante C): l'utente ha scelto
  l'ibrida il 2026-11-03, due o più chiusi a pila alti 38 px, uno rimasto
  solo a tessera alta quanto la barra (80 px). Il pianificatore l'ha scritta
  in T18, nella tabella «Dal prototipo» e nel Cancello; pila, tessera e
  dorso restano nel prototipo solo per confronto. Le varianti A e B non
  cambiano. Il piano delle celle della griglia (16 difetti misurati) è un
  piano a parte, piano/griglia-celle, perché tocca gli stessi file di T14,
  T15, T18 e T19.
- 2026-11-03 · K3 · risposta dell'utente al terzo prototipo della barra: la
  variante C (i riquadri sollevati) e le animazioni piacciono («stupenda»,
  l'apertura sul posto di Allineamento e Carattere «bellissima e comoda»,
  anche pensando al telefono). D-6 = C; A e B non piacciono e restano come sono, senza altro lavoro. Un solo difetto di C, che blocca
  l'approvazione del gruppo chiuso: il gruppo ripiegato (nome sopra, icona e
  freccia sotto, tanto spazio vuoto, proporzioni sbilanciate) è «grezzo» e
  va ridisegnato dal pianificatore prima di T18. Chiesto anche di
  pianificare le celle della griglia (oggi sulla 1432 ci sono difetti di
  disegno e animazioni povere) allo stesso livello della barra.
- 2026-11-03 · K3 · T11 integrato (95cd097e..1cfcca49): ogni DocumentSession
  ha una chiave di apertura, fatta prima della lettura e chiusa da un'uscita
  sola (#release), e tutte le letture e scritture della sessione la passano;
  RICH_FORMAT_IDS è tolto; un presidio sull'AST di TypeScript vieta
  openDocument, documentClosed e la scrittura con chiave fuori dalle
  sessioni; fuori da «Tocca» il coder ha aggiornato sei helper dei banchi e
  tre e2e, perché documentClosed è ora obbligatorio nell'API, senza
  indebolire asserzioni · dopo un ricaricamento della finestra le chiavi
  vecchie restano nell'host fino alla chiusura del vault o al tetto di 1024:
  è scritto in motori.md, e non serve codice perché il tetto LRU le
  richiude.
- 2026-11-03 · K3 · T10 integrato (d94cd18f..ed10cc56): le letture semplici
  non aprono un documento nel motore, solo una chiave di apertura (OpenKey)
  lo tiene aperto; quando le chiavi sono troppe si chiude quella usata meno
  di recente (LRU) e non la più vecchia, perché un documento appena
  riguardato non deve perdere la sua prova; Host::open_keys esiste per i
  test e per l'host finto; la pagina motori.md la aggiorna T11 · il piano
  diceva «la più vecchia», ma con l'LRU un documento in uso non si richiude
  sotto le mani.
- 2026-11-03 · K3 · D-5 (b): i nomi dei gruppi sulla barra dei fogli
  restano, ma discreti (grigi, poco evidenti, eleganti); il prototipo
  rifatto non è approvato e si rifà una terza volta, con un'organizzazione
  della barra nuova invece di quella di Excel, più identità di Fub, meno
  spazio vuoto sotto e le animazioni predisposte · parole dell'utente («mi
  piace la variante B con i nomi … un po' più discreti … in un grigio»,
  «l'organizzazione della barra mi sembra proprio una copia rispetto a
  Excel. vorrei qualcosa di nuovo, qualcosa di più bello … predisposte anche
  le animazioni»).
- 2026-11-03 · K3 · T10: l'utente dà l'OK al cambio dell'IPC (read_document
  e write_document con open?, document_closed con {open}, al più 1024 chiavi
  per vault) · parole dell'utente («ok»): le letture semplici non tengono
  più aperti i documenti; la riga nel piano la scrive l'orchestratore quando
  il pianificatore della barra ha finito.
- 2026-11-03 · K3 · il prototipo di T12 non è approvato: la barra
  multifunzione dei fogli va ridisegnata nello stile di Fub (moderno,
  minimale, stondato) invece che come Excel; si comincia dai fogli, e i
  documenti e le altre modalità la riprenderanno più avanti, quindi in K3 la
  barra degli altri editor non cambia · parole dell'utente; il menu
  «Comandi» resta, con la barra nuova.
- 2026-11-02 · K3 · Le risposte dell'utente a D-1…D-4 (e merge-k3,
  ci-soglia): D-2 (c), T8 unito e una lettura conta come apertura solo con
  la chiave di una sessione della shell, che la chiude in ogni uscita
  (contratto IPC cambiato: T10, T11); D-3 (c), un menu «Comandi» vero per i
  fogli, con il prototipo T12 da approvare prima di T13–T15, un posto e un
  effetto per ogni comando; D-4 (a), K3 si chiude e la memoria della WebView
  va in un piano a parte; il merge solo dopo la CI completa e la revisione
  (T17); il limite di R1 non si alza · ogni cosa che apre un documento lo
  deve chiudere, un comando che si trova solo con una scorciatoia è
  nascosto, e un numero rosso non si nasconde alzando la soglia.
- 2026-11-02 · K3 · T9: la misura del cancello prima (cb4213ec, codice di
  620f0acd) e dopo (c5851334) sulla stessa macchina, tre giri R1/S1/S6
  alternati per lato sotto Xvfb e i banchi; T8 non misurato. L'avvio e i
  banchi passano; gli obiettivi di R1 no, per la WebView: lo segno come
  fatto perché il «Fatto quando» di T9 è la pagina col giudizio, e il
  cancello va all'utente come D-4. In tempi.rs la lettura dopo un'altra
  cartella chiusa costa 6–15% in più (malloc_trim di T5): annotato, non
  abbassato nessun tetto.
- 2026-11-02 · K3 · T7: i titoli dei 303 comandi e i nomi dei campi stanno
  in un catalogo dei testi a parte (`editors/grid/palette/strings.ts`),
  caricato col foglio, e non in `i18n/catalog.ts`, per non gonfiare i testi
  della shell; i valori delle scelte restano come li scrive il catalogo. La
  finestra costruita dai campi serve ai 106 comandi con parametri
  obbligatori e chiede solo la forma principale; i 197 senza partono subito
  sulla selezione, come il pulsante della barra; quelli con una finestra
  scritta a mano aprono quella. Un comando spento resta in elenco col motivo.
  I comandi compaiono anche nel lanciatore dello Scrittoio. Limiti noti: i
  comandi che leggono soltanto non mostrano il risultato; due comandi hanno
  lo stesso titolo «Riempimento rapido» e si distinguono dalla scheda.

- 2026-11-02 · K3 · T8 (branch `piano/k3-ipc-motori`, in attesa di D-2):
  `Host::warm_engine` e `Host::document_closed` hanno nomi inglesi come il
  resto di `fub-host`; l'host sa quali documenti ricchi sono aperti dalle
  revisioni che ha dato alla shell (al più otto per documento) e dimentica la
  prova a vuoto per revisione (`MotoreDocumenti::dimentica`, pubblica); il
  client scalda dopo 300 ms di puntatore fermo e solo i tipi con un motore,
  e avvisa la chiusura da `DocumentSessionCollection.close`. · La revisione è
  già l'impronta dei byte con cui il motore ricorda la prova: niente disco da
  rileggere. Limite noto: le letture fuori da una sessione (l'anteprima della
  ricerca) contano come aperture senza chiusura, e allora la cache resta fino
  alla chiusura del vault.
- 2026-11-02 · K3 · `scripts/check.sh --rapido` fa girare i test di
  `fub-abi` anche quando il diff tocca soltanto documenti. · Un riquadro
  doppio nel grafo di `overview.md` è passato verde in locale e rosso in CI:
  `dependency_invariant` legge i documenti ma girava solo se cambiava un
  crate.
- 2026-11-02 · K3 · T4: `importa` e `verifica_copertura` ricevono un
  `Adattamento` dell'adattatore (posti dei menu, lessico dei nomi nudi dei
  parametri, correzioni per comando) e restituiscono tutte le mancanze, non la
  prima; `Modulo::da_schema` prende il lessico, differenza dal piano che lo
  voleva dal solo schema. Il catalogo dei fogli ha 303 comandi, 43 non serviti
  con il loro perché e 75 solo nella tavolozza. · Lo schema del motore scrive
  spesso nomi nudi (`range`, `at`) senza tipo: senza lessico i campi
  sarebbero tutti testo libero. I tipi del lessico vengono dal codice di
  GridCraft; alcune scelte portano nomi del motore (il tema «Craft») che la
  shell non deve mostrare così come sono.
- 2026-11-02 · K3 · T5 e T6: il motore dei fogli conta le istanze aperte con
  una `Presa` (cade l'ultima, si svuotano le sue cache); le cache dei documenti
  (le prove a vuoto, `documenti.prove`, con la stima dei byte misurata sul
  corpus) e i dizionari del correttore (`correttore.dizionari`) si svuotano
  alla chiusura dell'ultimo vault, passando da `fub-host/src/rich.rs` e da
  `fub_features::proof` senza nominare WordCraft · perché: chi chiude non deve
  sapere quali motori ci sono. Rischi annotati: lo svuotamento dei fogli gira
  sotto il lucchetto della superficie della griglia del kernel (toglierlo vuol
  dire toccare `fub-kernel`/`fub-host`); svuotare i dizionari toglie anche la
  sillabazione, che si ricostruisce alla prima richiesta.
- 2026-11-02 · K3 · Il test di copertura dei comandi (T4): la regola sta in
  `fub-motori` (`catalogo`, provata con specifiche finte in
  `crates/fub-motori/tests/copertura.rs`), il test vero sul motore dei fogli
  in `crates/fub-format-xlsx/tests/copertura.rs`; `fub-motori` non dipende
  da nessun adattatore, nemmeno nei test (differenza dal piano, che diceva
  una dev-dipendenza da `fub-format-xlsx`) · perché: ADR 0236, e ogni motore
  che verrà usa la stessa regola dal suo adattatore.
- 2026-11-02 · K3 · `check-motori.mjs` ammette `rfd` solo se lo porta
  `tauri-plugin-dialog` (i dialoghi di sistema della shell di Fub, non
  l'interfaccia di un motore); «librerie doppie» sono i nomi in due o più
  versioni (45 con tutte le feature e tutte le piattaforme), non i 61 nomi di
  `cargo tree -d`, che conta anche la stessa versione ripetuta · fonte:
  report del coder di T2, accettato dall'orchestratore.
- 2026-11-02 · K3 · Lavoro di notte senza l'utente: le domande del «Chiede
  sempre» si raccolgono in `PLAN.md` (D-1…D-3) e intanto vale la scelta più
  sicura e reversibile; i due IPC nuovi (scaldare, «documento chiuso») si
  scrivono su un branch a parte, `piano/k3-ipc-motori`, e non entrano nel
  branch del piano senza un sì; nessun merge · fonte: l'utente («voglio che
  tu implementi più parti possibili durante la notte … segui il piano»).
- 2026-11-02 · K3 · `fub-motori` non nomina nessun motore: dà `Pigro<T>`,
  `Servizi`, `Budget`, `Cache`, il catalogo e un registro `Motori` dinamico in
  cui ogni adattatore iscrive il suo motore («fogli», «documenti»); servizi e
  registro unici nel processo · perché: solo gli adattatori nominano i motori
  (`check-engine-boundary.mjs`, `GRIDCRAFT_OWNERS`, `WORDCRAFT_OWNERS`) e un
  campo per motore farebbe un ciclo fra `fub-motori` e gli adattatori; ADR
  0236.
- 2026-11-02 · K3 · `rayon` (gruppo di thread dei motori, suo e con un nome)
  e `libc` (`malloc_trim` su glibc) diretti in `fub-motori`: erano già
  nell'albero, nessun crate nuovo · fonte: `Cargo.lock` (rayon 1.12 da
  tantivy; libc 0.2 come in `fub-kernel`).
- 2026-11-02 · K3 · Scheda grafica e archivio dei caratteri non entrano in K3:
  nessun motore acceso li usa e `wgpu` sarebbe una dipendenza nuova; arrivano
  col primo motore che li chiede · domanda D-1 per l'utente.
- 2026-11-01 · regole · L'orchestratore e i coder decidono da soli il come
  tecnico, i formati interni, le dipendenze fra crate del workspace e i file
  legati al task; «Chiede sempre» resta per ciò che si vede, il contratto
  pubblico, sicurezza, dipendenze esterne, scope, test e merge; il criterio è
  il risultato migliore, non la strada più corta · fonte: l'utente («mi stai
  facendo troppe domande … ti voglio più autonomo»; «voglio sempre ottenere il
  risultato migliore, non importa se ci mettiamo più tempo o più risorse»).
- 2026-11-01 · K1 · L'assunzione A2 era sbagliata: un campo in coda a un
  record rompe i plugin compilati prima (il guest a undici campi del manifest
  non si istanzia nell'host a sedici); `0.2.0` non è pubblicata e K1 resta, ma
  dal primo rilascio un record pubblicato non cresce e le novità passano da
  interfacce nuove · fonte: prova dell'orchestratore con `ping-wasm` compilato
  su `d235d3f6`, decisione con l'utente; ADR 0235. Fuori dal Tocca, con
  l'OK dell'utente: la riga dell'esempio in `exclude` del `Cargo.toml` della
  radice e la frase sull'additività in `docs/architecture/document-model.md`.
- 2026-11-01 · K1 · Via MCP accendere e spegnere un componente con `apply`
  vogliono tutto il vault fra le radici di scrittura, come un piano che non
  dice quali note tocca: un componente cambia il comportamento di tutto il
  vault · fonte: revisione dell'orchestratore su T4 (il coder chiedeva una
  radice qualsiasi); ADR 0234.
- 2026-11-01 · K1 · `fub-cli` dipende da `fub-componenti` (con la freccia nel
  grafo di `overview.md`): i tipi del risolutore (`Stato`, `Effetto`,
  `Perche`, `Errore`) non sono riesportati da `fub-features` e la CLI li
  usa nelle firme e nei `match` · fonte: blocco del coder di T4, scelta
  dell'orchestratore (l'alternativa toccava `fub-features`, fuori dal Tocca).
- 2026-11-01 · K1 · La mappa vera (`fub-features::componenti`): le righe
  senza feature Cargo sono 7, non 4 (anche `fub.core`, `fub.maintenance`,
  `fub.importers`, che oggi si compilano sempre); `SOLO_DELLA_MAPPA` è
  `fub.markdown`, `fub.dizionari`, `fub.penna` e i due motori, ognuno col suo
  perché; una feature marcatore nuova `http-client` per le righe di sync,
  publish, updates e linkcard; `rich` e `xlsx` portano con sé i loro motori ·
  fonte: report del coder di T3; il codice vince sul «Fatto quando» del piano.
- 2026-11-01 · K1 · I requisiti che esistono solo per la mappa
  (`fub.markdown`, `fub.dizionari`: nucleo e componenti senza bundle) stanno
  nella riga di `fub-features::componenti`, non nel manifest; il manifest tiene
  i `requires` di oggi, perché il kernel soddisfa un requisito solo col
  `provides` di un bundle montato (`provider_of`) · fonte: risposta
  dell'utente al blocco del coder di T3; altrimenti le feature delle note non
  si monterebbero più.
- 2026-11-01 · K1 · T3 tocca anche i due blocchi di `mount.rs` che montano
  `fub.rich` e `fub.xlsx` fuori dal ciclo ufficiale (~376–404), solo per i
  campi della riga; righe anche per `fub.core` e `fub.maintenance` (il nucleo
  deve avere una riga); `fub.draw` resta fuori dal `default` come oggi e non
  richiede `fub.markdown` · fonte: risposta dell'utente; il resto deciso
  dall'orchestratore (il codice vince).
- 2026-11-01 · K1 · `Delivery` nel JSON è un enum con tag interno `kind`
  (`{"kind":"download","url":…}`), e la validazione di `fub-wasm-host` accetta
  lo sha256 in esadecimale maiuscolo o minuscolo; la conversione WIT → Rust di
  0.2.0 sta in `translate.rs`, `compat.rs` (ABI legacy) prende i default ·
  fonte: report del coder di T1.
- 2026-11-01 · K1 · Le regole di `fub-componenti` che il piano lasciava aperte:
  un requisito offerto via `provides` da più componenti è un errore della mappa
  (`RequisitoAmbiguo`); `attivi` segue i `requires` anche dal nucleo;
  `applica_profilo` svuota `in_attesa`; `Richiesto { da }` elenca i dipendenti
  a catena, e `spegni_con_dipendenti` dà `Nucleo` se la catena lo tocca;
  `perche` ha anche `Nucleo` e `Sconosciuto` · fonte: report del coder di T2,
  accettato dall'orchestratore; chi costruisce la mappa (T3) non può dichiarare
  due offerenti dello stesso requisito.
- 2026-11-01 · K1 · T1 tocca anche `crates/fub-abi/src/lib.rs` (`ComponentKind`
  e `Delivery` nel `pub use`, per `superficie_della_radice`) e
  `apps/client/src/host/enums.generated.ts`, solo rigenerato con
  `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums` · fonte: risposta
  dell'utente al blocco del coder; un enum senza payload in `fub-abi` porta
  sempre con sé la sua riga nel derivato TS.
- 2026-11-01 · K1 · Le PR #261–#269 (N13, N1, N2, K0) sono tutte in `main`:
  #269 è stata unita con lo stack intero, le altre chiuse perché contenute,
  #264 unita il 31/10 · fonte: `gh pr list`; nessun task di K1 aspetta una PR.
- 2026-10-31 · K0 · Il livello 3 della consegna sono le **edizioni**; niente
  librerie caricate a runtime (ADR 0233) · fonte: `piani/STATO.md`, risposte
  del 31/10 mattina; in K1 è il caso `Delivery::Edition` del manifest.
- 2026-10-31 · K0 · La tolleranza di R1 sta in
  `apps/client/bench/webview/budgets.json` (residuo 50 MiB, pendenza 1 MiB a
  giro; nella CI 480 e 20) · fonte: `piani/STATO.md`; è il metro di «spento non
  costa» per i task che misurano.
- 2026-10-31 · N2 · Il server MCP sta in `fub-cli mcp` sulla stessa
  `Connection` (passa dall'app se tiene il vault), protocollo scritto a mano
  (stdio, JSON-RPC sincrono), niente `rmcp` (ADR 0232,
  `docs/reference/mcp-server.md`) · fonte: `piani/STATO.md`; gli strumenti
  nuovi (i componenti di K1) seguono la stessa forma e i nomi `fub_*`.
- 2026-10-31 · N2 · Senza `--automation-write-root` il server è in sola
  lettura; senza `--automation-read-root` si legge tutto il vault;
  `fub_invoke` senza `apply` è una prova · fonte: `piani/STATO.md`; vale anche
  per accendere e spegnere componenti via MCP.
- 2026-10-30 · tasto destro (piano 2) · Le parole dei componenti sono
  Accendi, Spegni, Serve a…, Non serve più, Togli, Tienili, «Accendi…»; regola
  12: un componente spento non ha voci · fonte: `piani/STATO.md`; K1 le usa
  nei testi della CLI, K2 nel client.
- 2026-10-31 · piani · Le domande aperte dei piani seguono il loro
  «Consiglio» se l'utente non dice altro · fonte: `piani/STATO.md`,
  «Questions for the user».

- 2026-10-31 · workflow · Il piano vive in `PLAN.md` (e il prototipo in
  `PLAN-ui/`) sul branch del piano, e se ne va con l'ultimo commit prima del
  merge · una sessione sul web vede solo ciò che è su GitHub; dopo il merge
  restano il codice e questo registro.
- 2026-10-31 · workflow · Una PR in bozza ha la CI corta (Linux); segnata
  pronta ha la CI completa. I banchi del client girano sulle PR pronte solo se
  cambia `apps/client/`; su `main` gira sempre tutto · Windows, macOS e banchi
  costano tanto e servono una volta per piano, prima del merge.
- 2026-10-31 · workflow · I coder non lanciano altri agenti, non pushano e non
  toccano la CI; pusha solo l'orchestratore, una volta per task unito · un solo
  punto che integra, e la CI di ogni push copre tutto ciò che c'è prima.
