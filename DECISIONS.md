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

- 2026-11-05 · griglia-celle · D-1…D-6 e D-8: l'utente «seguo i tuoi
  consigli». Valgono B1–B4, B6, B7 e «coperte» come sono scritte; in più,
  come l'orchestratore aveva consigliato, il segno della copia (D-1) e la
  velocità della selezione (D-5) diventano due preferenze in Impostazioni
  (`editor.grid.copy-mark`, `editor.grid.selection-speed`), con di norma la
  scelta del prototipo: il task nuovo T9, fra T6 e T8. È l'unico lavoro
  nell'host del piano (due voci in `settings.rs`, nessuna porta) · perché:
  l'utente vuole il prodotto più personalizzabile possibile e il consiglio
  dato a D-1 e D-5 era «di norma come il prototipo, più una scelta in
  Impostazioni»; la lettura che le preferenze facciano parte del consiglio
  seguito è dell'orchestratore, ed è scritta nel rapporto all'utente.
- 2026-11-04 · griglia-celle · D-7, la selezione col puntatore: «scivola»,
  la risposta dell'utente («in celle dei fogli voglio selezione del
  puntatore -> scivola sempre»). Il puntatore usa le regole dei tasti; B5,
  T3 (regole del passo, prove, «Fatto quando» di g3-mouse-fitto) e la scelta
  del prototipo cambiano di conseguenza · perché: l'utente preferisce il
  moto di prima anche se un lato che cala mostra per un attimo qualche cella
  non scelta.
- 2026-11-04 · Celle dei fogli · terzo giro sul movimento, D-7 e D-8
  (l'utente: «un po' glitchata… la velocizzerei leggermente», «per una
  frazione di secondo… una porzione maggiore di superficie», «glitcha e esce
  dal normale funzionamento e seleziona male il tutto»). Le cause, provate
  sul prototipo di prima con una sonda a 1000 Hz (`probe5.mjs` e
  `analyze5.mjs` in `/home/fubeo/.cache/fub-k1/tmp/griglia-moto3/`: 9 stati,
  1280 e 390 px, CPU 1× e 4×, più `pointermove` per fotogramma) e coi
  fotogrammi dipinti: (1) le corse WAAPI annullate a ogni cella restavano
  dipinte dal compositore, poi la selezione saltava di circa 200 px; (2)
  anche i lati che calano scivolavano, quindi la selezione mostrava celle
  non scelte: 1777 fotogrammi a 1280 px, fino a 509 px, e 98 dei 240
  dipinti; (3) un bersaglio nuovo ereditava la velocità: 39 fotogrammi oltre
  il bersaglio e 276 all'indietro; (4) il moto dipendeva da quanti eventi
  arrivano in un fotogramma: con lo stesso bersaglio finale la velocità di
  partenza andava da 0 a 7097 px/s; (5) le maniglie del tocco nella colonna
  bloccata stavano 3,5 px fuori posto (origine CSS al centro, corsa
  calcolata dall'angolo); (6) la cella sotto il puntatore non si rileggeva
  allo scorrimento né al rilascio, come nel prodotto; (7) il quadratino e le
  maniglie del tocco si tagliavano per zona come i lati, già nel prototipo
  che l'utente ha provato: sul filo del blocco un tondo diventava due ovali
  con una cucitura bianca, quattro pezzi su B2, dopo uno scorrimento di lato
  ne restava uno spicchio sul filo, e del quadratino di A5 restavano 4 px;
  la sonda li vede divisi o tagliati in 464–1586 fotogrammi per giro
  (`maniglia/confronto-v5.png`). Scelto: un motore solo, con il bersaglio,
  la posa mostrata e un passo per fotogramma (un evento cambia solo il
  bersaglio); nessuna velocità all'indietro, un tetto alla radice lenta
  della molla, niente oltre il bersaglio; col puntatore il modo «segue» (il
  lato che cala salta, quello che cresce scivola); la cella riletta allo
  scorrimento e al rilascio; i segni d'angolo un pezzo solo, intero, nel
  livello della zona del loro angolo, coperto dalla fascia ferma come le
  celle, e presi dove si vede l'angolo (B7). Dopo, la stessa sonda: zero
  difetti in 44 900 fotogrammi nei quattro giri, segni d'angolo compresi, e
  in 334 dipinti; `sim.mjs` zero su 600 gesti simulati con due semi (272 954
  e 295 127 fotogrammi); il gestore del puntatore costa come prima (al 99°
  percentile 1,2 ms per fotogramma). D-7 resta all'utente: «segue» è
  consigliato perché tiene il moto un po' più svelto che l'utente vuole e
  non mostra mai una cella non scelta, ma mentre cresce ne mostra qualcuna
  in meno (fino a 341 px a 1280); «salta» è la lettura stretta di «mai
  un'area diversa» (zero fotogrammi diversi); «scivola» è il moto di prima
  senza i salti, con la porzione maggiore (fino a 507 px). D-8 resta
  all'utente: «coperte» è consigliato perché la maniglia la sposta lo
  scorrimento del browser insieme alle celle, senza ritardo, ed è la regola
  di tutti gli altri segni; «sopra» tiene il tondo intero sul filo (con la
  sua regola la sonda vede 122–131 pezzi saliti sopra la fascia per giro, a
  1280 e 390 px e con la CPU 4×, tutti interi e al posto giusto, e zero
  difetti), ma lo sposta lo script un fotogramma dietro le celle e quando
  l'angolo passa sotto la fascia torna giù di colpo.
- Celle dei fogli, secondo giro sul movimento (l'utente: «per una frazione
  di secondo viene selezionata una porzione maggiore»). Causa: quando la
  selezione passava la riga o la colonna bloccata, i lati e le fasce della
  zona nuova comparivano già alla misura finale (in dissolvenza) mentre il
  resto scivolava ancora, e uscendo sparivano di colpo. Scelto: ogni pezzo
  che compare o se ne va durante una corsa corre con gli altri dalla stessa
  geometria, uscendo dal filo del blocco o rientrandoci. Sonda su 21 gesti
  (clic, Maiusc, frecce svelte, trascinamenti, pagine, Home, oltre il
  blocco) a 1280 e 390 px: 0 fotogrammi con un pezzo fuori dal bordo; stato
  finale uguale con e senza movimento.
- Celle dei fogli, il movimento dei segni (richiesta dell'utente: «un po'
  glitchata», «la velocizzerei leggermente»). Nel prototipo il velo usciva
  dal bordo durante la corsa, un tasto tenuto giù ripartiva ogni volta da
  fermo, l'anello e il velo sparivano di colpo e la molla snap rimbalzava di
  2 px. Scelto: una sola geometria di dieci numeri per tutti i pezzi, una
  molla per numero con la velocità che si conserva, l'anello e il velo
  sempre presenti che crescono dal bordo, e due molle della griglia smorzate
  al punto critico, GLIDE 1400/75 e SLIDE 700/53, in cima a grid-motion.ts,
  al posto di snap e soft: circa il 30 % più svelte e senza rimbalzo.
  moto/spring.ts non cambia. Misurato con le sonde: 0 fotogrammi col velo
  fuori dal bordo, stato finale uguale con e senza movimento.
- Griglia-celle · piano nuovo, scritto dal pianificatore di K3 il 2026-11-03
  sulla richiesta dell'utente di portare le celle dei fogli al livello della
  barra: 16 difetti misurati, otto task (T1 | T2 | T3 | T4 T7 | T5 | T6 |
  T8), prototipo PLAN-ui/celle-griglia.html. Il ramo nasce da
  piano/k3-motori @ 06e054c8 per avere la barra e il prototipo di K3
  accanto; il primo task parte solo dopo che T19 di K3 è integrato, e allora
  piano/k3-motori si unisce in questo ramo tenendo il PLAN.md della griglia
  (il PLAN.md di K3 resta su piano/k3-motori). Le domande D-1…D-6 sono
  all'utente; i default B1–B6 valgono finché non risponde.
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
