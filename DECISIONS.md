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

- 2026-11-02 · N6 · T10: le porte della lavagna stanno in `state/canvas-
  intake.ts`. Dall'albero si tengono solo gli id che l'host conferma: una
  domanda sola a `existingDocuments` per tutte le voci, e per i file che
  l'indice dei documenti non conosce (immagini, PDF) una domanda
  `vaultEntries` per cartella invece di un `resourceOpen` per file; una nota
  non confermata si scarta. Dal computer ogni file passa da
  `depositOrReuse`; le notifiche («N file già nel vault, uso quelli», e la
  prima volta «Copiati in cartella/» con «Cambia cartella») dicono anche ciò
  che è stato fatto prima di un errore. `revealSetting` sceglie la scheda
  dalla chiave (permessi → Componenti, scorciatoie → Scorciatoie, il resto →
  Impostazioni) e apre un eventuale `<details>`. Resta in `engine.ts` (fuori
  da T10): se nessuna voce dell'albero è confermata e il trascinamento porta
  anche `text/plain`, nasce una scheda di testo. Perché: un trascinamento è
  un dato che chiunque può scrivere, e un file non si copia due volte.
- 2026-11-02 · N6 · T7: la scheda di foglio legge solo le finestre di celle
  in vista (al massimo 256×128, scorrimento a righe e colonne intere), riusa
  paintCell e le classi del foglio, chiude la sessione da ferma e a destroy
  una volta sola e non chiama mai applyGridBytes; Stale arriva come errore
  "conflict" e si riprova una volta. La copia: in produzione
  writeClipboardText scrive con navigator.clipboard, che non accetta
  un'attesa, quindi la selezione si allarga solo su celle già lette e Ctrl+C
  non scrive niente se ne trova una non letta (l'orchestratore ha rimandato
  indietro la prima versione, che copiava vuote le celle mai lette). In v1
  non mostra grafici, immagini, barre di dati, icone, commenti, riquadri
  bloccati né lo zoom; il bordo d'accento e «Esc per uscire» li disegna la
  tela (data-card-entered). Perché: una copia non deve mai contenere dati
  diversi dal file.
- 2026-11-02 · N6 · T9: le schede portate sulla lavagna nascono in griglia
  per righe (ogni colonna larga quanto la sua scheda più larga), ordinate
  per nome e poi per percorso, agganciate a 8 px e mai sotto 40; il foglio
  nasce 480×304 invece di 480×300 di D-11, perché 300 non è multiplo di 8;
  un'immagine senza misura nasce 480×360 (4:3); un PDF largo 360 con
  l'altezza della prima pagina (senza misura 360×480); un file Craft
  320×160. DROP_SNAP e DROP_MIN_SIZE copiano le costanti di engine.ts (che
  porta il DOM) e un test le tiene uguali. Perché: tutto ciò che nasce sta
  sulla griglia della tela.
- 2026-11-02 · N6 · T8: la scheda web non fa richieste da sé: mostra
  indirizzo e dominio, e l'anteprima solo con «Mostra l'anteprima» (una
  richiesta per clic); l'icona passa solo se è un data: di immagine raster
  (la regola di safeIcon delle note, perché isAllowedLink ammetterebbe icone
  http che farebbero rete); un'anteprima fallita resta sobria, col motivo
  nel suggerimento e il pulsante per riprovare; un indirizzo non valido non
  ha pulsanti. Tutte le schede dicono lo stato in data-card-state e la
  specie in data-card-kind (allineate dall'orchestratore: l'immagine usava
  data-state). Manca una chiave «Scarico l'anteprima…»: per ora «Apro…».
  Perché: una lavagna aperta non contatta nessun sito senza che lo si
  chieda.
- 2026-11-02 · N6 · T6: la scheda PDF disegna la pagina in un canvas fuori
  dal DOM e la copia in quello visibile (la cache chiude le immagini che
  scarta), larga scheda × zoom × densità, al più 2× la scheda; la parte in
  cache è snapshotPart("page-N", larghezza); la pagina di partenza viene da
  #page con pdfPageFromFragment di pdf-view.ts; PgSu/PgGiù/Home/Fine senza
  modificatori; un PDF rotto o cifrato dice «Non riesco a mostrare…». Da
  decidere in T12/T13: un cambio di zoom ridisegna solo se la tela chiama
  resize() o setMode. Perché: una scheda ferma resta leggibile senza tenere
  aperto il motore PDF.
- 2026-11-02 · N6 · T5: la scheda d'immagine riduce alla misura della scheda
  con una sola decodifica (per JPEG, WebP e BMP la larghezza si legge
  dall'intestazione), tiene in cache la parte `whole@<larghezza>` come dice
  canvas-cards.md, mostra l'SVG solo come <img> da blob (mai svg o script
  nel DOM) e, dipinto, lo tiene in cache come canvas; oltre 64 MiB, HEIC e
  AVIF dicono «Non riesco a mostrare…» con «Apri». Rischio: il canvas della
  scheda è una copia del bitmap in cache, quindi la memoria per scheda viva
  raddoppia; lo stile delle classi nuove spetta a T12/T22. Perché: una foto
  grande non pesa sulla tela più della sua scheda.
- 2026-11-02 · N6 · T4: la scheda di nota non rende da sé ma chiede alla
  shell (NoteCardPort.show, più watch e un open facoltativo per «Apri»);
  ogni accensione rifà la resa, una scheda ferma non tiene ascoltatori e
  mostra la resa di prima inerte, un contatore di generazione scarta le
  risposte tardive; lo stato sta in data-card-state; `#A#B` mostra la
  sezione più interna. Perché: la tela non importa l'editor di testo e la
  scheda legge senza mai scrivere il file.
- 2026-11-02 · N6 · T3: depositOrReuse riusa un file già depositato con gli
  stessi byte (ricevuta ReusableReceipt, esito SameFile) invece di
  duplicarlo. Perché: incollare due volte la stessa immagine non riempie il
  vault di copie.
- 2026-11-02 · N6 · T1: il contratto delle schede
  (`editors/canvas/cards.ts`, `docs/reference/canvas-cards.md`). PenQuiet
  non c'è ancora in main: `cards.ts` ha un tipo strutturale suo, `CardQuiet
  { defer(key, work) }`, con la chiave `cards`. `snapshotPart` dà sempre
  `prefisso@larghezza` (multiplo di 32, minimo 32). «Più vicine al centro»
  si misura dal centro della vista al punto più vicino della scheda; se un
  `setMode` lancia, le altre schede cambiano lo stesso e l'errore esce alla
  fine; lo stesso renderer che nomina due volte una specie non è un
  doppione.
- 2026-11-02 · N6 · T2: la cache delle immagini ferme
  (`editors/canvas/card-cache.ts`) ha un tipo suo, `CardCacheSnapshot`,
  uguale per forma a quello del contratto di T1 senza importarlo; percorso e
  parte restano chiavi separate (mai unite in una stringa); rimettere la
  stessa immagine sotto la sua chiave non la chiude; un tetto negativo o NaN
  vale 0, i byte 0, negativi o NaN contano 1. Il tetto di 64 MiB è un valore
  di partenza.
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
