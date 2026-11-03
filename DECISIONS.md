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

- 2026-11-03 · K5 · D-14 (a): il Motore del disegno ha un interruttore suo
  in «Disegnare», acceso di serie; il repository Fubeo/vectorcraft si crea
  come fork di storytold/vectorcraft, come WordCraft e GridCraft (l'utente
  ha detto sì; il comando lo lancia lui, perché all'orchestratore è negato)
  · le consigliate, accettate dall'utente («ci sto»).
- 2026-11-02 · K5 · Le risposte dell'utente a D-1…D-13: tutte come le
  consigliate tranne D-8, (c): senza motore il disegno usa gli strumenti
  semplici di prima e il chip lo dice. Ne nascono D-14 (il motore come riga
  sua, che si spegne: consigliata e seguita), Testo anche senza motore
  (A17), i task T25–T30 (il prototipo prima dei task grafici, l'ultimo con
  la CI completa e la revisione prima del merge) e il tetto
  `librerie_doppie` alzato una volta sola, con `usvg` doppio · disegnare
  deve restare possibile con un componente spento, e un motore di supporto
  che `fub.draw` richiede non si potrebbe spegnere mai.
- 2026-11-02 · K5 · Dopo T8: la CI era rossa su `fub-
  app/tests/ipc_permissions.rs` perché `host/ipc.ts` chiamava i sei comandi
  del disegno, che l'app registra solo con T19 (D-4). Le porte ora
  rispondono `unserved` senza chiamare l'app, lo stesso rifiuto dell'host
  senza il motore (prima l'app avrebbe dato un errore «comando sconosciuto»,
  cioè motore «errore» e non «spento»); con T19 tornano `invoke`. Il test
  non si tocca. Il ciclo rapido non l'aveva visto: `check-scope.mjs` ora
  aggiunge i crate i cui test nominano un file del client cambiato.
- 2026-11-02 · K5 · T5: chiuso con la fermata del piano. Nessun `svg2pdf`
  pubblicato usa `usvg` 0.48 (l'ultimo, 0.13.0, chiede ^0.45; anche `krilla-
  svg` 0.8.1 chiede ^0.47; letto da crates.io il 2026-11-02), quindi
  `Cargo.lock` e i `Cargo.toml` non cambiano e l'export resta com'è. Il file
  di misura `docs/misure/disegno-versioni-2026-11.md` conta le librerie
  doppie per nome (45 nomi, 109 versioni, prima e dopo uguali) e dice quali
  resteranno doppie col motore (`usvg`, `svgtypes`, `roxmltree`, `tiny-skia-
  path`, `imagesize`, `kurbo`; `skrifa` a tre versioni, `peniko` a due). D-3
  resta aperta: l'opzione consigliata è tenere due `usvg`, 0.45 per l'export
  e 0.48 per il motore. Perché: non si cambia l'export per una libreria che
  non c'è.
- 2026-11-02 · K5 · T12: i comandi di colore e spessore partono dai campi
  Contorno, Riempimento e Spessore del pannello delle proprietà
  (`changeField`), perché il pozzo colore della barra non tocca la selezione
  e cambia solo lo stile dei gesti dopo, che arriva già al motore con
  `DrawingGesture.style`. L'esito passa da `changeFromPanel` (la stessa
  strada del pannello: sola lettura, lucchetto, rifiuto) e non da
  `ctx.commit` diretto. Al motore vanno solo `#rrggbb`, il riempimento
  «nessuno» come `null` e gli spessori ≥ 0 in unità della scena; il resto lo
  scrive il pannello come prima. Un comando che `drawingCommands` non elenca
  vale spento (`ctx.campiDelMotore` in `panel.ts`, una riga fuori dal
  «Tocca»). Se il motore manca o smette di rispondere, il pannello scrive da
  sé solo se disegno e selezione sono ancora quelli di partenza. Fra comandi
  e gesti non c'è una fila comune: un comando lanciato mentre l'esito di un
  gesto è in volo si calcola sulla copia senza quel gesto, e un rifiuto si
  annuncia. Perché: senza motore la barra scrive come prima.
- 2026-11-02 · K5 · T10: i gesti di select, rect, ellipse, line e arrow
  passano dal motore (`editors/spatial/motore/gesti.ts`) e ogni esito è un
  passo di annulla. L'opzione dell'editor è una porta `MotoreDelDisegno` che
  può essere ancora «in apertura» (non la `SessioneMotore` del piano): la
  superficie la passa subito, un gesto aspetta l'apertura fino a 2 s e poi
  non scrive niente; con il motore assente, o se l'apertura fallisce, fanno
  gli strumenti TypeScript come prima, in silenzio. Il motore non si usa sui
  fogli PDF né dentro un gruppo isolato; il doppio clic resta del client; il
  movimento senza tasto premuto non si manda. I connettori seguono con
  l'hook `follow` del motore della scena dentro il commit, quindi
  `followConnectors` non si chiama a mano. Toccati anche `marks.ts` e
  `stroke-shapes.ts` (maniglie e lazo dall'anteprima del motore). I motivi
  dei rifiuti usano le chiavi che ci sono, fino a T21. Perché: senza motore
  niente deve cambiare, e con il motore un gesto è un solo passo.
- 2026-11-02 · K5 · T8: la sessione del motore nel client
  (`editors/spatial/motore/sessione.ts`) segue la `DocumentSession` come
  superficie `motore-disegno:<n>` (un id per sessione, come `live:<n>`, così
  due sessioni sullo stesso documento non si rimpiazzano) e non origina mai
  modifiche. Le sei porte di `host/ipc.ts` usano i nomi della D-4
  (`open_drawing`…`close_drawing`), ancora da confermare: l'host le avrà con
  T19. Le richieste vanno in fila con un tempo limite di 10 s; a uno `stale`
  si rimanda il testo intero (in LF) e si riprova una volta, anche per
  `drawing_command`; qualunque errore o tempo scaduto ferma la sessione come
  `{ perche: "errore" }`, la stacca dal documento e chiude l'istanza come
  può. Il finto `DrawingFake` tiene la sua copia e controlla che ogni
  differenza si applichi. Perché: il client deve essere pronto prima del
  motore, e un motore che non risponde non deve bloccare il disegno.
- 2026-11-02 · K5 · T4: il contratto del disegno in fub-abi ha limiti
  espliciti (20 MiB di testo, 100 000 eventi per gesto, 10 000 operazioni, 8
  MiB di operazioni, 50 000 perdite) e un validate() per ogni messaggio; gli
  specchi TS sono controllati da ts_mirror e mirror.test.ts. Perché: un
  messaggio fuori misura si rifiuta al confine, prima del motore.
- 2026-11-02 · K5 · T2: l'oracolo a pixel sta in fub-testkit dietro la
  feature `pixel`, fuori dal default e in FUORI_DAL_DEFAULT; resvg diventa
  dipendenza di workspace e il banco lo prende con il solo `text` (niente
  raster, niente caratteri di sistema); l'altezza viene da width/height
  dell'SVG, con tetto di 8192 px, sfondo bianco opaco e famiglie generiche
  sulla prima faccia. Ho aggiunto io in ci.yml clippy e nextest con
  `--features pixel`. Perché: il confronto è identico su ogni macchina e chi
  usa il banco per il kernel non compila un rasterizzatore.
- 2026-11-02 · K5 · T3: i vettori dei gesti (49) sono registrati dagli
  strumenti TypeScript così come sono; la loro forma sta in una pagina
  nuova, docs/reference/scene-gestures.md, e il §10 di scene-operations.md è
  un rimando, perché quella pagina era al tetto delle righe. `refused` ha
  due valori in più del piano, `locked` e `hidden`, perché gli strumenti
  rifiutano già quei due casi; il vettore ridimensiona-estraneo registra che
  un elemento estraneo si ridimensiona già, non solo si sposta: il motore
  lo rifà o lo scrive nel .tsv.
- 2026-11-02 · K5 · T1: l'ADR 0239 «Il disegno passa dal motore vettoriale,
  e il file lo scrive il client» (stato proposta, ambito contratto) e la
  pagina docs/architecture/disegno.md; le domande D-1…D-13 stanno nell'ADR
  come «Da decidere»; ciò che non esiste ancora è nominato come percorso in
  codice con «(arriva con T…)» · il numero 0239 segue 0236–0238 di K3, N3 e
  N4, e si rinumera alla fusione se serve.
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
