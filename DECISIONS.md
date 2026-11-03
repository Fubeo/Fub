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

- N7 T30 (b8131b11, dal coder 22ae7bf3): un `.docx` o un `.odt` dà la
  miniatura che porta dentro, letta a pezzi (la coda dello ZIP,
  `_rels/.rels` fino a 64 KiB, la voce della miniatura fino a 8 MiB), senza
  revisione e senza cache; un PDF, un `.rtf` o un `.doc` restano `absent`.
  Differenze dal piano: errori `OfficeError { NotZip, TooLarge,
  BadRelationships }`; conta solo la prima relazione miniatura; rifiutati
  `TargetMode=External` e i bersagli con segmenti vuoti, `.`, `..` o `\\`;
  una miniatura oltre 8 MiB o in EMF/WMF è `absent`, relazioni rotte o
  troppo grandi `unreadable`, come un docx cifrato; il tipo di pacchetto lo
  dicono le voci e non l'estensione; l'apertura dello ZIP ripete la sequenza
  di `zip_preview` perché `container.rs` è cambiato solo nella visibilità
  (anche `zip_tail.rs` e `craft_files.rs`, fuori dal Tocca); nuova regola di
  case-fold ASCII `office.rs::is_package_extension` in
  `a_named_rule_is_declared.rs`; sulla via dell'host senza lease i documenti
  restano `absent`, come i RAW. Rischi:
  `mounting_external_path_does_not_take_workspace_lock` (3 s) e
  `crossed_moves_take_the_locks_in_one_order` (30 s) sono caduti sotto
  carico e possono cadere in CI; nessuna prova con un docx salvato da Word
  vero, solo pacchetti fatti nei test.
- N7 T11 (9790d2ef): le anteprime con la CLI dopo un gesto, col biglietto.
  Differenze dal piano: `Host::craft_render` accoda con `Host::spawn_job`
  (l'esito arriva con `JobDone`) ed è dietro `#[cfg(feature = "craft")]`,
  perché `CraftPreview` e `PreviewSize` vivono in `fub-format-craft`, che è
  facoltativo: senza la feature il metodo non c'è (il piano lo voleva sempre
  compilato con `host.craft_render.off`); T12 e T23 lo chiamano sotto la
  stessa feature. I biglietti usati, scaduti, di un altro doc o misura, di
  un vault chiuso e il consenso ritirato si provano negli unit test di
  `craft/render.rs` (il biglietto non esce mai); i biglietti di un vault
  chiuso cadono alla riapertura e quando il lettore risulta chiuso; un
  errore di copia o I/O non segna «già provato»; l'offerta `render` vuole la
  CLI trovata e la revisione non già fallita. L'annullamento passa dal
  `JobHost` che smette di servire (il consenso letto dal job non risulta più
  `on`). Rischi: i test di tempo scaduto e annullamento allungano
  `craft_cli` di circa 25 s; `craft::open_with::tests::channel::a_single_ins
  tance_app_is_forwarded_on_its_systems` è caduto sotto carico nel check del
  coder (non toccato, verde da solo); `craft::launch::tests` cade in
  parallelo e passa con un thread solo, dalla base. Niente prova con una CLI
  vera.
- N7 T25 (a7b9223c): i dati dell'XMP di LightCraft sotto la foto. Differenze
  dal piano: acceso o spento si legge dal kernel (`craft.photo` fra i
  comandi), bootstrap passa sempre `photoData`; tre file fuori da «Tocca»
  (desktop-shell.ts per mountCraftPhotos, bench/fake-ipc.ts con
  `?photo=xmp|senza`, bench/photo-fixture.ts); `LABEL_COLORS` e
  `COLOR_NAMES` esportati da xmp-view.ts; la domanda parte dopo che la foto
  è disegnata (o dopo la frase d'errore di TIFF/HEIC); craft-photos ascolta
  anche gli eventi `entry_*` (una foto è una risorsa); il fake host elenca
  `craft.preview` e `craft.photo` col componente acceso; il voto -1 mostra
  «Scartata». Rischi: i RAW non contano come foto (`isPhotoDoc`), T28 deve
  allargarlo; il fake host copia la regola dei candidati XMP; le baseline
  delle 2 scene nuove vengono dal runner; niente prova sull'host vero. Nel
  check, block-id.test (seme fisso) è caduto sotto carico: il campo si
  calcola con l'albero a metà e `ensureSyntaxTree` dopo non lo ricalcola;
  verde da solo, non è di T25.
- 2026-11-03 · N7 · T22 (fd595ce4, cb2bd25e): l'orchestratore ha permesso al
  coder di toccare `craft/preview.rs` (`limit_of`, `over_limit(limit)`,
  `fill(limit)`), perché il tetto per formato vive lì e nessun altro task lo
  possiede ora. `embedded_preview_from` restituisce `Embedded`; il nuovo
  `zip_tail.rs` legge la coda dello ZIP con un budget (`Budgeted`). La
  versione di FigCraft si legge da `document.json` con un tetto di 1 MiB;
  uno ZIP sulla via dell'host senza lease ha un tetto di 64 MiB. Toccata una
  riga di `product/craft-files.md`. La prova da 1 GiB dura circa 33 s;
  `Stale` è provato solo da un test unitario. L'orchestratore ha rimesso a
  misura un commento troppo lungo (cb2bd25e). Check d'integrazione
  `--rapido` verde (21 passi).
- T27 (0284ab88, d8562abf): il coder si è fermato sul filo in
  `craft/preview.rs` (in «Non toccare» per non scontrarsi con T19 e T24, e
  nessun task lo possedeva). L'orchestratore l'ha applicato (una decina di
  righe in `ranged_preview`: un RAW passa da `raw::read_from`, `Stale`
  riprova, ogni altro errore torna alla via dell'host), perché nessun task
  in corso tocca quel file. Il test vecchio
  `a_raw_photo_is_a_subject_from_its_extension` aspettava `absent` per un
  `.CR3` di 9 byte che non è un RAW: ora è `unreadable`, come vuole il piano
  (un `.CR3` che non è un RAW). Differenze dal piano: `JpegRange` ha anche
  `width` e `height`; costanti in più `MAX_BOXES` (10 000) e
  `MAX_CANDIDATES` (64); un JPEG senza perdita (SOF C3, C7, CB, CF) si
  scarta perché sono dati del sensore, un JPEG progressivo si tiene;
  l'orientamento di un RAF viene dall'EXIF del suo JPEG; un ORF dà `absent`
  (le sue anteprime stanno nella MakerNote, che non si legge); il test delle
  «70 000 voci» usa 65 535 e 1001 perché il conteggio è un u16; il cammino
  dei segmenti JPEG ricalca `jpeg::size` perché `jpeg.rs` non si tocca.
  Rischio: provato solo su file costruiti nei test, non su RAW di fotocamere
  vere (resta per T32 e per le prove a mano).
- T24 (a62ce774): craft.photo ha un suo elenco paginato della cartella,
  perché `Folder` sta in preview.rs, che è di T27 (quando T27 lo tocca, le
  due letture si possono unire). Una foto senza XMP dà `photo.missing`
  (NotFound); le chiavi del catalogo sono `cmd.photo` e `cmd.photo.doc`. Un
  XMP troppo grande conta come rotto e una lettura fallita passa al
  candidato dopo; un documento `.xmp` si riconosce da `CraftApp::Xmp` e ha
  modifiche vuote. Rischio accettato e provato da un test: `a.b.jpg` prende
  `a.b.xmp` come secondo candidato, mentre l'anteprima di quell'XMP punta ad
  «a.b» (asimmetria scritta in `docs/reference/xmp-sidecars.md`).
- 2026-11-03 · N7 · T19 integrato (3bda61f1). `craft.cli-previews` è una
  scelta ask/on/off di macchina e non `program_writable` (un bundle riceve
  `PermissionDenied`, un vault importato non la cambia); i valori vecchi
  (true, false, "forse") valgono `ask` per la regola di risoluzione del
  kernel, senza migrazione, e il valore salvato resta com'è.
  `consent::current` e `consent::max_bytes` per T11 e T22. Allargato a `fub-
  cli/src/login.rs`: `config --set` prende la specie dallo schema (prima
  `on` diventava un interruttore e la scelta veniva rifiutata), con un test
  unitario e uno e2e. Restano: le 2 baseline della scena `settings-external-
  apps` (chiara e scura) vanno prese dal runner in T32, e fino ad allora
  `bench/scene.test.ts` resta rosso in locale e in CI; `cargo test -p fub-
  host --no-default-features` non compila già alla base (import di
  fub_features), da guardare in T32; `fub-wasm-
  host::the_instance_and_the_turn::an_index_feed_and_a_job…` è caduto dopo
  353 s sotto il carico di tre build ed è verde da solo.
- 2026-11-03 · N7 · T21 integrato (921de8db il lettore nel kernel, 30038ed9
  le anteprime a pezzi, 14a0947d lo scrittore di fuori). Il kernel ha
  `ResourceReader` (`Workspace::resource_reader()`): apre e legge le lease
  fuori dal lucchetto del workspace, con un `AtomicBool` che `prepare_close`
  spegne; fub-host lo passa ai comandi Craft con `Registrar::craft_reader()`
  (pub(crate), solo con la feature `craft`). Differenze dal piano:
  `mount.rs` non toccato; i percorsi delle lease rispondono `revision: null`
  per RAW, PDF, documenti e file oltre il limite; senza lettore si ricade
  sul percorso dell'host; il caso /etc/passwd tolto (la / iniziale si
  toglie). Rischi: il lettore non passa dal Guard di `HostApi` (A14, come
  `fub-asset:`): va ricordato nella revisione di T32; la ricaduta è provata
  solo con MemoryHost; `ranged::revision` resta inutilizzato fino a T11.
- 2026-11-03 · N7 · T10 integrato (279c1859): Started.channel è
  Option<Arc<Channel>> e si usa fuori dal lucchetto del registro; gli errori
  sono off=Unserved, unknown_editor e wrong_kind=BadArgs, not_installed e
  missing=NotFound, launch_failed=Io; su macOS la pagina va dopo --args di
  open; senza il programma flatpak l'errore è launch_failed; sul canale page
  si ignora · InRunning non scatta con nessuna delle sette app (nessuna ha
  un canale col token, D-2) ed è provato solo con un editor di prova nei
  test unitari.
- 2026-11-03 · N7 · T20 integrato (ecf05750 lo spostamento, 1c3ed3df la
  forma 2): il parametro render resta dichiarato e invoke lo ignora, perché
  senza la dichiarazione l'host rifiuterebbe una domanda della versione 1;
  craft.preview non avvia mai l'app, quindi la shell non chiede più
  l'anteprima da sola e il pulsante richiede soltanto; unreadable e failed
  mostrano craft.no_preview finché le frasi non arrivano in catalog.ts; un
  file che comincia col punto (.pdf) non ha soggetto · le foto T14/T15 sono
  15 su 16 uguali, xmp-dark-1280 cambia 10 pixel dell'angolo arrotondato di
  1–2 livelli, contenuto identico.
- 2026-11-03 · N7 · T9 integrato (d331e67f): Framing è lo stesso tipo di
  Protocol di T7, Channel::new restituisce io::Result perché il token può
  mancare, Channel::for_control decide con un match esaustivo su Auth,
  l'autenticazione è {method: auth, params: {token}} scritta solo in
  auth_request · il formato non è documentato dalle app, così si cambia in
  un punto solo; T10 prende il token da Channel::token.
- 2026-11-03 · N7 · T8: l'avvio sta in `craft/launch.rs`; il gruppo di una
  CLI si ferma con `rustix::process::kill_process_group` (la feature
  `process` di rustix, che cap-primitives accendeva già: nessun crate nuovo
  e Cargo.lock uguale), anche dopo un'uscita normale; il registro delle
  uscite è `on_exit(pid, callback)` più `running(pid)`; un programma con un
  percorso non assoluto è `NotFound`, mai una ricerca nel PATH; un'uscita da
  segnale è `Failed(-segnale)`; il filtro `FUB_` su Windows non distingue il
  maiuscolo (la sua voce in `a_named_rule_is_declared`). Restano scritti
  nella pagina: su Windows il tempo ferma solo la CLI e non i suoi figli
  (servirebbe un job object, cioè windows-sys, una dipendenza nuova), e una
  CLI lasciata da Fub che esce arriva in fondo da sola · un programma
  esterno non passa mai da una shell e non lascia processi dietro di sé.
- 2026-11-03 · N7 · il prototipo delle anteprime (T18) è approvato così
  com'è, con le sei scelte da decidere guardando come le propone (le due
  risposte con lo stesso peso, le miniature da 16 px, la tendina, le parole
  chiave su tre righe che poi scorrono, la riga dei dati senza etichette
  scritte, il PDF con filo e ombra); D-10 (a), le cinque cose restano fuori
  · parole dell'utente («si, mi piace» e «si»); T19, T23, T25, T26, T28 e
  T31 possono partire quando tocca a loro.
- 2026-11-02 · N7 · Le risposte dell'utente a D-1…D-9: D-1 (b), le anteprime
  fatte dalle app spente finché chi usa Fub non le accende, con la domanda
  la prima volta («Chiedi la prima volta», non un permesso dei plugin), e
  un'app parte solo dal core, per la shell principale, dopo un gesto, col
  biglietto del job (T11, T12, T19, T23); D-5 (d), i dati dell'XMP anche
  sulla foto e un'impostazione per nascondere gli `.xmp` dall'albero
  (T24–T26); D-7 (d), le miniature nell'albero dietro un'impostazione
  spenta, che non avviano mai un'app (T26); D-8 (c), per l'anteprima Fub
  legge solo il pezzo che serve con le lease del kernel, senza porte nuove
  nell'ABI, e i 64 MiB restano per ciò che va letto intero come impostazione
  (T21, T22); D-9 (c), N7 comprende i RAW, PdfCraft e WordCraft (T27–T31) e
  si chiude con la CI completa e la revisione (T32); il contratto
  `CraftPreview` passa alla versione 2 in un task solo (T20), con `revision`
  vuota per ciò che si legge a pezzi; il prototipo
  `PLAN-ui/craft-anteprime.html` va approvato prima dei task che si vedono
  (T18); D-10 nuova, il piano segue la (a) · avviare un programma è
  un'azione e la decide chi usa Fub, non un plugin, un agente o un file
  riaperto; un file grande non deve costare la sua lettura intera, e una
  forma che cambia una volta sola non lascia la shell e l'host a parlare due
  lingue.
- 2026-11-02 · N7 · T15: la figura di un file Craft in una nota e nella
  finestrella al passaggio (`editors/craft/figure.ts`) chiede sempre
  `render: false`: un test in ognuno dei tre file lo controlla. Un embed da
  solo nel paragrafo ha già la didascalia K10, come i disegni, quindi la
  figura non ne aggiunge una seconda e il riquadro senza anteprima non
  ripete il nome; la didascalia propria compare solo nella finestrella e in
  un embed dentro una riga. Il clic nella nota apre il file con
  `openWikilink` (se non riesce, `preview.open_failed`); nella finestrella
  la figura non ha clic, come il resto. Niente CSS nuovo: il riquadro usa
  `.image-missing`, l'immagine le regole delle immagini della nota. Perché:
  un'anteprima in una nota non deve mai avviare un'app.
- 2026-11-02 · N7 · T14: la scheda dei file Craft e degli XMP è in sola
  lettura (`editors/craft/`). Con l'anteprima si vede nella vista delle
  immagini con la riga dei dati sotto; senza, la riga dei dati sta dentro il
  riquadro (niente riga doppia), con lo stato e il pulsante «Crea
  l'anteprima con …». L'anteprima con `render: true` si chiede da sola una
  volta per montaggio della scheda (D-1, prima opzione). Lo store
  `state/craft-previews.ts` si monta da `desktop-shell.ts` come
  `mountLinkCards` (un file fuori dal «Tocca», una riga). Il componente
  spento si riconosce dall'errore `unknown_command` e mostra «Nessuna
  superficie disponibile». Le etichette XMP sono tradotte (Red → «Rossa»);
  il tetto di 64 MiB e la regola dei tag sono quelli di `xmp.rs`. Restano
  fuori: la Struttura mostra lo schema della nota precedente su un file
  Craft, e il toast generico dei job scrive l'id grezzo `craft.render`.
  Perché: un file Craft si guarda in Fub e si cambia nella sua app.
- 2026-11-02 · N7 · T7: il registro delle sette app Craft sta in
  `craft/editors.rs` e trova i programmi senza mai avviarne uno (un test lo
  controlla). `Env` ha in più `root` (`/` fuori dai test), per provare
  `/usr/bin` e `/Applications` su una cartella finta. `detect` dà una riga
  per ognuna delle 7 app, con `How::Missing` per quelle che non trova. Una
  riga di `craft.editor-paths` che punta a un file sparito non ferma la
  ricerca: si passa ai posti standard. Per gli AppImage il nome va seguito
  da `-`, `_` o `.` e deve finire in `.AppImage`; i `-cli` sono esclusi, e
  fra più file vince il nome più grande in ordine di byte. La cache di 30 s
  (`FindCache`) si rifà da sola quando cambiano l'ambiente o le righe. I
  nomi dei campi di installed.json vanno confermati con un file vero.
  Perché: «Apri con» deve sapere quali app ci sono senza lanciare niente.
- 2026-11-02 · N7 · T6: il bundle fub.craft sta in fub-host dietro la
  feature `craft`, nel default, sul modello di LinkCardBundle; il comando
  craft.preview è in sola lettura e il job craft.render per ora risponde
  «niente CLI» (lo riempie T11). I test dell'inventario e delle estensioni
  conoscono fub.craft. Il check è rosso solo per i due test a tempo di fub-
  services (stalled publish/vault), che rilanciati da soli passano. Perché:
  il formato si monta come gli altri componenti e si spegne con la sua
  feature.
- 2026-11-02 · N7 · T5: un file a byte che non sa riscriversi (provider
  assente o `Ok(None)`) non ferma più la rinomina;
  `invoke_prepared_link_rewrites` restituisce `PreparedLinkRewriteOutcome {
  edits, unwritable_bytes }`, le righe «un file a byte non si riscrive, il
  link punta ancora a …» passano per Parsed/Pending/Completed in
  `stale_byte_links` e si aggiungono ai `rewrite_failures` solo in
  `finish_*`, così l'intent di recupero si chiude; l'unione di note
  (`PreparedLinkRetarget::edits`) invece si ferma ancora con l'errore di
  prima · D-3 (a): la rinomina si fa e Fub avvisa; nell'unione non c'è una
  rinomina già fatta a cui appendere l'avviso, e si cestinerebbe un file a
  cui il link punta ancora.
- 2026-11-02 · N7 T4 · `linked.rs` prende come file collegati i valori
  stringa dei campi `href`, `src`, `path`, `file`, `uri` e `link` a ogni
  profondità fino a 64 livelli, al massimo 1000 senza doppioni, ripuliti
  come un URL e senza la parte da `#` o `?`; in un file Craft un percorso
  che comincia con `/` è del disco e si scarta come `C:` e gli schemi, a
  differenza dei disegni SVG dove `/` è la radice del vault; il `%20` resta
  scritto e lo decodifica il kernel; Fub non riscrive mai il file Craft
  quando il file collegato si sposta; integrato dopo T2, perché i suoi test
  vogliono il documento vero di `read_meta`.
- 2026-11-02 · N7 T2 · `container.rs` legge i tre contenitori con un tetto a
  ogni lettura: prima di aprire uno ZIP conta le voci che dichiara la fine
  della directory centrale (anche ZIP64), poi ricontrolla quelle aperte,
  così un file ostile di 64 MiB non fa leggere un milione di voci; una voce
  che si dichiara piccola e si scompatta grande la ferma il crate zip (CRC,
  NotZip) e dopo il `take`; fra le due anteprime di un `.pcraft` si passa
  alla riserva anche quando la voce c'è ma non è un PNG o è troppo grande;
  il base64 di `/preview/data` accetta il riempimento mancante e gli a capo
  e ha il tetto sulla stringa e sul decodificato; titolo e versione vuoti
  contano come assenti; il testo si raccoglie con una pila, non per
  ricorsione; il documento di FigCraft e VectorCraft sta in `Contents.json`,
  che serve ai file collegati di T4; il modello del documento non ha un
  posto per la versione, che si legge da `read_meta`.
- 2026-11-02 · N7 T3 · `xmp.rs` legge `xmp:Rating`, `lc:label`, `lc:flag`
  (pick, reject, none) e `dc:subject` dalle forme attributo ed elemento, con
  un lettore XML ristretto: le entità non predefinite non si espandono mai e
  il DOCTYPE si ignora, così un XMP ostile non gonfia la memoria; un voto
  scritto "5.0" vale 5; l'URI dello spazio `lc:` e i valori di `lc:flag`
  vengono dal piano e vanno confermati con un XMP vero di LightCraft, perché
  nel repo non ce n'è uno.
- 2026-11-02 · N7 T1 · il crate `fub-format-craft` con i quattro provider a
  byte in sola lettura, `CraftApp` (con `id()` ed `editor_name()` in più del
  piano) e il contratto `CraftPreview` v1 con la gemella TS `host/craft.ts`
  legata dalla fixture `craft-preview.json` (UPDATE_MIRROR=1); `revision` è
  `fub_abi::Revision`, in JSON una stringa; il lettore TS accetta solo
  `image/png`; le costanti dei limiti stanno in container, xmp e linked per
  T2–T4; nel grafo di `overview.md` il crate ha un blocco suo, perché il
  primo superava 20 nodi · i provider non sono ancora registrati: chi usa
  Fub non vede niente finché non arriva il task che li monta.
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
