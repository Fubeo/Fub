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
