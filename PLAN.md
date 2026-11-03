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
la scheda grafica e l'archivio comune dei caratteri (A3, D-1: arrivano con il
primo motore che li usa, i caratteri con il disegno di K5); i processi a parte
per JavaScript dei PDF, OCR e IA (regola 7, arrivano con chi li usa); le
modalità complete; rifare a mano la barra dei fogli (T18 ne cambia soltanto
l'aspetto: non i comandi, non il DOM); un menu «Comandi» nella barra dei
documenti (A9: i loro comandi sono del client); il nuovo stile nella barra dei
documenti, in quella delle tabelle e nelle altre modalità (dopo K3: vedi la
fine di T18); la memoria della WebView (D-4: un piano a parte, vedi «Il piano
dopo» in fondo); le descrizioni
delle funzioni dei fogli in italiano (il motore le dà in inglese, anche nella
finestra «Inserisci funzione» che c'è già: un difetto a parte, per cui
l'orchestratore apre un'issue).
Assunzioni: A1–A10 qui sotto, decise dall'orchestratore il 2026-11-02 di notte
(l'utente non poteva rispondere). L'utente ha risposto il 2026-11-02 (D-1…D-4,
più il merge e la soglia della CI): A3 resta, A8 e A10 cambiano.
Ondate: T1 T2 T3 | T4 T5 T6 | T7 T8 | T9 T12 | T10 T13 T18 | T11 T14 | T15 |
T16 | T17 (T13, T14, T15 e T18 partono solo dopo il sì dell'utente al
prototipo di T12; T11 e T13 non girano insieme, perché toccano tutte e due
`docs/architecture/motori.md`; T18 va prima di T14, perché tutti e due
toccano `structure.css`, `skin/editors.css`, l'anatomia e il banco, e la
pillola «Comandi» di T14 sta sulla barra di T18)
Prototipo: `PLAN-ui/menu-comandi-fogli.html` (T12 e T18), fatto il
2026-11-02, rifatto il 2026-11-03 con la barra dei fogli nello stile di Fub
(due varianti, A e B, e il confronto «Barra: nuova / di prima»); approvato: —
(aspetta il sì dell'utente; l'orchestratore scrive qui la data).
La finestra dei parametri di T7 è fatta con i pezzi del kit e non ha un
prototipo.

## Modifiche

- 2026-11-02 · le risposte dell'utente: T8 unito a K3; task nuovi T10–T17
  (letture che non aprono, ogni documento aperto si chiude, il prototipo del
  menu «Comandi» dei fogli, un posto e un effetto per ogni comando, il menu,
  i risultati e i perché in italiano, la misura con i documenti che si
  chiudono, la CI completa e la revisione prima del merge); cambiano il
  cancello, A3, A8, A10, il fuori scope; in fondo «Il piano dopo: la memoria
  della WebView» · D-1 (a), D-2 (c), D-3 (c), D-4 (a), merge (c), soglia della
  CI (a) · T7 e T8 da rivedere, T10–T17 nuovi.
- 2026-11-03 · il commento dell'utente al prototipo di T12 («troppo simile a
  excel e a tutti gli altri editor simili»): il prototipo è rifatto con la
  barra dei fogli nello stile di Fub, in due varianti (A senza i nomi dei
  gruppi, B con i nomi sopra i comandi) e con il confronto «Barra: nuova / di
  prima»; task nuovo T18 (la barra dei fogli nello stile di Fub); domanda
  nuova D-5 (la variante e due dettagli da guardare); cambiano T14 (dipende
  da T18, la pillola «Comandi» nello stile di T18, i 700 px), T17 (dipende da
  T18, le foto di T18), il cancello, il fuori scope, le ondate e la riga del
  prototipo; nella tabella «Dal prototipo» gli hook di T15 sono quattro
  (`grid-result` e `grid-result-dialog` non li veste la pelle) · nessuna
  risposta nuova · T14, T15 e T17 da rivedere, T18 nuovo.

## Dal prototipo

Il prototipo è `PLAN-ui/menu-comandi-fogli.html`. I blocchi di CSS segnati
«copia» sono di Fub e non si spostano; quelli segnati «→ file» sono il codice
nuovo; quelli «solo prototipo» restano lì. I token vengono da
`theme/scrittoio/sheet-light.css` e `sheet-dark.css` (non da
`foundation.css`, come dice la guida del prototipo: è lì che stanno).
Le regole marcate `data-barra="prima"` sono il CSS della barra di adesso,
copiato per il confronto «Barra: nuova / di prima»: non vanno in nessun file.
I blocchi marcati `data-variante="b"` vanno nel codice solo se D-5 sceglie B.
Per un riscontro, lo script del pianificatore ha scritto i due file come
saranno dopo T18 in `/home/fubeo/.cache/fub-k1/tmp/k3-barra/lavoro/dopo-T18/`
(fuori dal repo, se c'è ancora; la fonte resta il prototipo).

| Pezzo | Destinazione | Task |
|---|---|---|
| il posto di ogni comando: `MENU` nella pagina, `tabs[].id` (scheda), `groups[].id` (gruppo), `extra` (i comandi che la barra non ha) | `crates/fub-format-xlsx/src/catalogo.rs` | T13 |
| le schede e i gruppi solo del menu (`solo: true`: File, Disegna, Tabella pivot; Home › Annulla, Home › Selezione, …) | `crates/fub-format-xlsx/src/catalogo.rs` | T13 |
| l'effetto di ogni comando (`e`: `legge`, `mostra`, `cambia`) | `crates/fub-motori/src/catalogo.rs`, `crates/fub-format-xlsx/src/catalogo.rs` | T13 |
| il pulsante «Comandi» nella fila `quick` (DOM, `aria-haspopup`, lettera C) | `apps/client/src/kit/ribbon/ribbon.ts`, `editors/grid/ribbon/ribbon.ts` | T14 |
| l'albero del menu: schede, gruppi, controlli della barra rispecchiati, «Altri comandi del gruppo», «Per ciò che hai selezionato» | `apps/client/src/editors/grid/menu-comandi.ts` (nuovo) | T14 |
| la ricerca completa: percorso, accese prima e spente dopo col perché, nessun tetto, il piede | `apps/client/src/ui/menu.ts` | T14 |
| CSS `→ structure.css`: `.grid-ribbon-quick` | `apps/client/src/theme/scrittoio/structure.css` | T14 |
| CSS `→ structure.css`: `.grid-result-table`, `.grid-result-ref` | `apps/client/src/theme/scrittoio/structure.css` | T15 |
| CSS `→ skin/editors.css (T14, nello stile della barra di T18)`: `.grid-ribbon-quick`, con la sua regola per il foglio sotto i 900 px | `apps/client/src/theme/scrittoio/skin/editors.css`, dopo le regole della barra di T18 | T14 |
| CSS `→ skin/editors.css`: `.grid-result-*` | `apps/client/src/theme/scrittoio/skin/editors.css` | T15 |
| hook nuovo `grid-ribbon-quick` (voce `grid-ribbon`) | `apps/client/src/theme/scrittoio/anatomia/editors.ts` | T14 |
| hook nuovi `grid-result-table`, `grid-result-key`, `grid-result-number`, `grid-result-ref` (le classi che la pelle veste; `grid-result-dialog` resta una classe del DOM senza hook, perché la pelle non la veste e il test dell'anatomia vuole che classi e hook coincidano) | `apps/client/src/theme/scrittoio/anatomia/editors.ts` | T15 |
| testi `fogli.menu.*` (anche `fogli.menu.tab.*`, `fogli.menu.group.*`, `fogli.menu.more_colors`) e `fogli.motivo.context.*` | `apps/client/src/editors/grid/palette/strings.ts` | T14 |
| testi `fogli.motivo.*` dei perché del motore e `fogli.result.*` | `apps/client/src/editors/grid/palette/strings.ts` | T15 |
| la finestra del risultato: caricamento, tabella, riferimenti che portano alla cella, «Copia», errore con «Riprova» | `apps/client/src/editors/grid/risultato.ts` (nuovo) | T15 |
| gli stati per il banco: menu aperto, ricerca, sola lettura, schede contestuali | `apps/client/bench/scene.mjs` | T14 |
| gli stati per il banco: risultato, risultato lungo, errore | `apps/client/bench/scene.mjs` | T15 |
| CSS `→ structure.css (T18)`: la geometria della barra dei fogli, tutta in selettori `.grid-ribbon-…`; dalle liste che oggi uniscono `.rich-ribbon-…` e `.grid-ribbon-…` si tolgono i selettori `.grid-ribbon-…` | `apps/client/src/theme/scrittoio/structure.css`, al posto della sezione «La barra multifunzione del foglio» | T18 |
| CSS `→ skin/editors.css (T18)`: la pelle della barra dei fogli (le schede a pillola col velo che scorre, il vassoio, i fili corti, i pulsanti, i pulsanti divisi, le schede per la selezione, i campi, le lettere di Alt, la tavolozza, la barra ritirata, i colori forzati, il foglio sotto i 900 px); dalle liste condivise si tolgono i selettori `.grid-ribbon-…` | `apps/client/src/theme/scrittoio/skin/editors.css`, nella sezione «La barra multifunzione: le schede su un filetto…» | T18 |
| CSS `→ structure.css (T18, solo con la variante B)` e `→ skin/editors.css (T18, solo con la variante B)`: i nomi dei gruppi sopra i comandi | gli stessi due file, dopo i blocchi di T18 (solo se D-5 dice B) | T18 |
| hook nuovi `grid-ribbon-split-large` e `kit-tab-indicator` (voce `grid-ribbon`, accanto a `kit-tabs` e `kit-tab`) | `apps/client/src/theme/scrittoio/anatomia/editors.ts` | T18 |
| la pelle montata | `apps/client/src/theme/scrittoio/skin.css` (`npm run theme:generate`, mai a mano) | T18 |
| gli stati per il banco della barra: a riposo, 700 px con la scheda della tabella, le lettere di Alt, un gruppo raccolto aperto, la tavolozza dei colori, la barra ritirata, un nome di tabella lunghissimo, sola lettura | `apps/client/bench/scene.mjs`, e se serve `apps/client/bench/fake-ipc.ts` | T18 |

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
  **Confermata (D-1 (a)):** i caratteri arrivano con il disegno (K5 D-5 (a)),
  la scheda grafica con il primo motore che la usa.
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
  **Cambiata (D-2 (c)):** T8 è unito a K3 (merge del 2026-11-02). In più,
  una lettura conta come apertura solo se viene da una sessione di documento
  della shell, con la sua chiave (T10), e ogni sessione chiude la sua chiave
  in ogni modo in cui finisce (T11): l'anteprima della ricerca, la CLI, il
  server MCP, la cattura e il controllo leggono senza aprire.
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
  **Cambiata (D-3 (c)):** oltre alla tavolozza, ogni comando servito è in un
  menu vero, «Comandi», a sinistra delle schede della barra dei fogli,
  progettato una volta sola per la barra di oggi e per la modalità completa
  (T12–T15). Raggiungibile vuol dire: nel menu, con una scheda e un gruppo
  (e nella barra, se la barra lo mostra), e sempre anche nella tavolozza;
  nessun comando sta solo nella tavolozza.

## Domande per l'utente (raccolte, non bloccano)

- D-1 · Scheda grafica e caratteri: li aggiungo quando arriva il primo motore
  che li usa (PdfCraft o VectorCraft), non in K3? Consiglio: sì, perché oggi
  sarebbero codice che nessuno chiama, e la scheda grafica porterebbe una
  libreria nuova.
  Risposta (2026-11-02): (a) — arrivano con il primo motore che li usa, non in
  K3; i caratteri arrivano con il disegno (K5 D-5 (a)).
- D-2 · Due comandi nuovi fra la finestra e il programma: «scalda il motore di
  questo tipo» (al passaggio del puntatore su un file, all'apertura di una
  cartella) e «ho chiuso questo documento» (per svuotare subito le cache dei
  documenti). Sono pronti su un branch a parte. Consiglio: sì. Un limite
  noto: anche le letture fatte fuori da un documento aperto (l'anteprima
  della ricerca con «più contesto») contano il documento come aperto, e
  nessuno lo chiude; finché c'è, la cache dei documenti si svuota solo alla
  chiusura del vault, come senza i due comandi. Si perde solo memoria, mai
  dati.
  Risposta (2026-11-02): (c) — T8 è unito a K3, e ogni cosa che apre un
  documento lo chiude, anteprima della ricerca compresa (T10, T11).
- D-3 · I comandi dei fogli che non sono nella barra si trovano nella
  tavolozza dei comandi, con una finestra dei parametri generata. Va bene così
  per ora, o li vuoi anche in un menu? Consiglio: tavolozza per ora; il menu
  arriva con la modalità completa dei fogli.
  Risposta (2026-11-02): (c) — un menu vero adesso, progettato una volta sola:
  il prototipo è T12; T13, T14 e T15 partono dopo il sì dell'utente.
- D-4 · Il cancello di K3 non passa per intero: l'avvio e i banchi sì, gli
  obiettivi di R1 no (pendenza dei giri fra 7,5 e 9,2 MiB per giro contro
  l'obiettivo di 1; il residuo supera i 50 MiB in un giro su tre). Il
  processo di Fub ora rende memoria (residuo da +7…+12 a −53…−61 MiB), ma
  quasi tutto il residuo è della WebView, che K3 non tocca. Con le soglie
  `ci` passa. Chiudo K3 così, con la memoria della WebView in un piano a
  parte? Consiglio: sì; misure in `docs/misure/k3-motori-2026-11-02-server-
  di-fub.md`.
  Risposta (2026-11-02): (a) — K3 si chiude così; la memoria della WebView va
  in un piano a parte («Il piano dopo», in fondo), con lo stesso obiettivo di
  1 MiB per giro.
- merge-k3 · Posso fondere K3 (PR #295) in main? (domanda generale)
  Risposta (2026-11-02): (c) — sì, ma prima la CI completa (Windows, macOS e
  i banchi) e una revisione riga per riga di tutto K3: T17.
- ci-soglia · Il controllo della memoria della WebView è rosso anche su main:
  che cosa faccio? (domanda generale)
  Risposta (2026-11-02): (a) — il limite resta com'è: `R1.giri.pendenza.MiB`
  resta rosso finché il piano della memoria della WebView non lo porta sotto.
- D-5 · La barra dei fogli nello stile di Fub (T18; nel prototipo, «Barra:
  nuova» e «Variante»). I nomi dei gruppi: (a) la variante A, senza i nomi
  (li dicono ancora il lettore di schermo e il pulsante del gruppo raccolto;
  la barra è alta 144 px invece di 135); (b) la variante B, con i nomi in
  maiuscoletto sopra i comandi (168 px); (c) A di serie, e B come
  impostazione. Consiglio: (a) adesso. La barra respira e i comandi parlano
  da soli; un'impostazione è un contratto dell'host (`fub-host`
  `settings.rs`, l'IPC, le preferenze), e conviene disegnarla una volta sola
  per tutte le barre quando lo stile passa al kit (vedi la fine di T18), non
  per i soli fogli. Due dettagli da guardare nel prototipo: il filo fra i
  gruppi, alto 40 px nel colore dei bordi (consiglio: questo, il più
  quieto) o corto, 16 px, e più scuro come nella barra di formato delle
  note; la barra ritirata, con il filetto sotto la fila delle schede
  (consiglio: con, perché separa la fila dalla griglia quando il vassoio non
  c'è) o senza.
  Risposta (2026-11-03): (b), la variante B con i nomi dei gruppi, ma più
  discreti: in grigio, messi in modo meno evidente, eleganti. Il prototipo
  non è ancora approvato: «la direzione» piace, «il riquadro» e
  l'impostazione anche, ma è «la stessa grafica di prima, stondata un
  pochino», con «troppo spazio bianco sotto», senza «un reale miglioramento
  identitario», e l'organizzazione della barra è «una copia rispetto a
  Excel». L'utente vuole «qualcosa di nuovo, qualcosa di più bello», con le
  animazioni predisposte. Il prototipo si rifà una terza volta.

## Cancello di K3

| Fatto quando | Prova | Task |
|---|---|---|
| dopo «chiudi tutto» il processo di Fub rende la memoria; la crescita per giro della WebView va nel piano dopo (D-4 (a)) | R1 (`npm run bench:webview -- --only=R1`): il residuo dell'app sotto zero e la sua pendenza sotto 1 MiB per giro (misurati: da +7…+12 a −53…−61 MiB, pendenza 0,24–0,29); numeri prima e dopo in `docs/misure/`; `R1.giri.pendenza.MiB` può restare rosso e nessun limite di `bench/webview/budgets.json` si alza (ci-soglia (a)) | T5, T6, T9, T16 |
| il tempo d'avvio di Fub non cambia | S6 `coldStart` prima e dopo, stesso build, differenza dentro il rumore di due giri uguali | T9 |
| nessuna regressione nei banchi di fogli e documenti | `bench:grid`, `bench:large`, `bench:fidelity`, `tempi.rs` dei fogli, `corpus.rs` dei documenti: prima e dopo | T9 |
| ogni comando del motore si raggiunge, e ogni comando servito è anche nel menu «Comandi» con il suo posto | `crates/fub-format-xlsx/tests/copertura.rs` (`ogni_comando_del_motore_si_raggiunge`, `ogni_comando_ha_scheda_e_gruppo`), il test di copertura del client (`editors/grid/palette/palette.test.ts`: «ogni comando servito è anche nel menu»), le foto del banco del menu confrontate col prototipo | T4, T7, T13, T14 |
| un comando che legge mostra il suo risultato, un comando spento dice il perché in italiano, la sola lettura spegne solo ciò che cambia la cartella | `editors/grid/risultato.test.ts`, `editors/grid/motivi.test.ts` (ogni frase di `motivi.generated.json` ha la sua chiave in ogni lingua), ogni chiave di `risultati.generated.json` ha il suo testo, `crates/fub-format-xlsx/tests/effetto.rs`, le foto del banco del risultato | T13, T15 |
| ogni documento che la shell apre si chiude; una lettura che non apre non conta | test dell'host (`crates/fub-host/tests/engines_open.rs`): cento letture semplici di cento documenti lasciano zero aperture e zero prove ricordate; test del client: l'anteprima della ricerca su cento file non apre niente, e ogni uscita di una sessione chiude la sua chiave | T10, T11 |
| nessuna interfaccia di un'app Craft in Fub, librerie doppie sotto il tetto | `node .github/scripts/check-motori.mjs` nella CI | T2 |
| niente all'avvio | test: dopo l'apertura di un vault nessun motore è costruito; il primo `.xlsx` aperto costruisce solo «fogli» | T1, T5 |
| la barra dei fogli ha lo stile di Fub; la barra dei documenti e quella delle tabelle restano com'erano | le foto del banco della barra dei fogli (`grid-*` e le scene nuove di T18), chiara e scura, confrontate col prototipo; nella CI nessuna baseline delle scene dei documenti e delle tabelle cambia (`document-*`, `window-document`, `mobile-document*`, `live-14-tabella-attiva`, `slash-05-tabella`); `bench:a11y`, `theme:verify` e i test del tema verdi | T18 |
| K3 passa la CI completa e una revisione riga per riga prima del merge | la PR #295 segnata pronta: tutti i job verdi su Linux, Windows e macOS, banchi compresi (salvo `R1.giri.pendenza.MiB`, spiegato); la revisione scritta nella PR; il sì dell'utente al merge | T17 |

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
Stato: [x] fatto

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
Stato: [x] fatto

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
Stato: [x] fatto
  Da rivedere: T13 lo cambia (D-3 (c)).

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
Stato: [x] fatto

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
Stato: [x] fatto

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
Stato: [x] fatto (le due foto del banco della scena `grid-command-form` arrivano dal runner)
  Da rivedere: T14 e T15 lo cambiano (D-3 (c)).

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
Stato: [x] fatto; unito a K3 il 2026-11-02 (merge `122a373e`, con il sì a D-2)
  Da rivedere: T10 e T11 lo cambiano (D-2 (c)).

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
Stato: [x] fatto

## T10 · Le letture semplici non aprono un documento

Perché: ogni lettura di un documento di videoscrittura lo conta come aperto e
ne ricorda la prova a vuoto, anche quando non lo apre nessuno (l'anteprima
della ricerca, la CLI, il server MCP, la cattura, il controllo, i lavori dei
plugin); nessuno lo chiude, e la cache dei documenti si svuota soltanto alla
chiusura del vault (D-2 (c)).
Tocca: `crates/fub-host/src/engines.rs` (`OpenRich` per chiave, il tipo
`OpenKey`), `crates/fub-host/src/session.rs` (`read_document_with_format`,
`open_document_with_format` nuovo, `write_document`, `write_open_document`
nuovo, `document_closed`), `crates/fub-host/src/rich.rs`,
`crates/fub-format-rich/src/session.rs` e `src/lib.rs` (l'apertura che non
ricorda la prova), `crates/fub-app/src/lib.rs` (`read_document`,
`write_document`, `document_closed`), i test di conformità IPC che nominano
questi comandi (`crates/fub-app/tests/lean_ipc.rs`, `ipc_permissions.rs`,
`ts_mirror_app.rs` e le fixture che rigenerano),
`apps/client/src/host/ipc.ts`, `host/fake.ts` e il suo test,
`crates/fub-host/tests/engines_document_closed.rs`, `engines_on_close.rs`,
`crates/fub-host/tests/engines_open.rs` (nuovo),
`docs/reference/ipc-contract.md` («Documenti di videoscrittura», «Motori dei
formati»).
Non toccare: `apps/client/src/state/document-session.ts` e gli altri
chiamanti del client (T11); `docs/architecture/motori.md` (la scrive T11 per
le due parti, per non toccarla insieme a T13); `fub-motori`; i chiamanti
dell'host in `crates/fub-cli/`, `control.rs`, `capture.rs`, `jobs.rs`: con
questo task diventano letture semplici senza cambiare codice.
Dipende da: nessuno
Cosa fare:
- La **chiave di apertura** la sceglie la shell, una per sessione di
  documento: da 1 a 64 caratteri `[A-Za-z0-9_-]` (un UUID va bene). Il tipo
  `OpenKey` in `engines.rs`, con un `parse` che dà `BadArgs` (con una chiave
  del catalogo dei testi del core) prima di leggere il disco.
- `read_document { id, vault?, open? }`. Senza `open` è una **lettura
  semplice**: stessa proiezione, stessa revisione e stesso `format_id` di
  un'apertura, ma il documento non conta come aperto e la prova a vuoto non
  resta ricordata. La prova si fa lo stesso, perché la proiezione sia uguale
  (le parti chiuse, la sola lettura): serve una variante di
  `fub_format_rich::open` che non chiama `preservation::remember`. Con `open`
  è un'**apertura**: come oggi, e la revisione si segna sotto la chiave.
- `Host::read_document_with_format` e `Host::read_document` diventano letture
  semplici; l'apertura è `Host::open_document_with_format(vault, id, chiave)`.
- `write_document { id, source, base, vault?, open? }`. Con `open`, la
  revisione dei byte sovrascritti e quella dei byte nuovi si segnano sotto la
  chiave (la chiave si apre, se non lo era: una sessione nuova può scrivere
  prima di leggere). Senza `open` (`Host::write_document`, la CLI e gli
  altri), le prove che la scrittura ha lasciato e che nessuna chiave tiene si
  dimenticano subito. `Host::write_open_document(…, chiave)` è la variante
  con la chiave.
- `document_closed { open, vault? }`: toglie la chiave, dimentica le prove
  delle sue revisioni che nessun'altra chiave aperta (in nessun vault) ha, e
  se non resta nessuna chiave in nessun vault svuota la cache dei documenti e
  chiama `rilascia_al_sistema()`, come oggi. Una chiave sconosciuta, già
  chiusa o di un vault non aperto non fa niente e non è un errore. Il campo
  `id` di T8 non c'è più: quel contratto non è ancora su `main`, quindi si
  cambia invece di aggiungerne un altro.
- Una chiave tiene le ultime `REVISIONS_PER_DOC` revisioni, come oggi un
  documento. Al più 1024 chiavi aperte per vault: oltre, si chiude la più
  vecchia (con le sue prove) e un `tracing::warn!` lo dice. Così una shell
  che dimentica di chiudere non fa crescere la memoria senza fine.
- `open` su un documento che non è di videoscrittura (Markdown, cartella di
  Excel, PDF) si accetta e non segna niente. Senza la feature `rich`
  (`--no-default-features`) la chiave si valida e si ignora.
- Il lato TypeScript: `readDocument(id, vault?)` resta la lettura semplice;
  `openDocument(id, open, vault?)` nuova (lo stesso comando, con `open`);
  `writeDocument(id, source, base, vault?, open?)`; `documentClosed(open,
  vault?)`. Il fake host accetta `open` e dice quante chiavi sono aperte (per
  esempio `openKeys()`), per i test di T11.
- Fra T10 e T11 la shell non passa ancora chiavi: nessun documento conta come
  aperto, il salvataggio rifà la prova (più lento, ma giusto), e la
  `documentClosed` che la shell manda con l'id del documento riceve `BadArgs`
  o non trova niente (la shell ignora già l'errore). Nessun dato in gioco, e
  il branch non si fonde prima di T17.
Casi limite: chiave vuota, di 65 caratteri, con `/`, `.`, spazi o caratteri
non ASCII; `open: null` (vale come assente); la stessa chiave per due nomi
(una sessione rinominata: la chiave segue la sessione, non il nome); due
chiavi sullo stesso documento (chiuderne una lascia la prova all'altra);
una lettura con la chiave che fallisce (file che non c'è, byte rotti): la
chiave non si apre; una scrittura con la chiave che fallisce (conflitto, sola
lettura): nessuna prova resta senza una chiave che la tiene; una lettura con
una chiave appena chiusa la riapre (tocca alla shell richiuderla, T11; il
tetto limita il danno); due vault aperti e una chiave in uno solo; il vault
si chiude con chiavi aperte (si chiudono tutte, come oggi); 1025 chiavi.
Fatto quando: `crates/fub-host/tests/engines_open.rs`, un eseguibile a parte
come `engines_document_closed.rs` perché le cache sono del processo: cento
letture semplici di cento `.docx` diversi (l'anteprima ripetuta su cento
file) lasciano `MotoreDocumenti::processo().prove_ricordate()` com'era e
nessuna chiave aperta, e aprire e chiudere poi una chiave sola svuota la
cache (sul codice di prima no); un'apertura e la sua chiusura lasciano zero
prove; due chiavi sullo stesso documento; scrittura con la chiave e poi
chiusura, zero prove; scrittura senza chiave, zero prove; 1025 chiavi, la
prima si chiude; chiave malformata, `BadArgs` in lettura, scrittura e
chiusura; chiave sconosciuta, `Ok`; `open` su un `.md` e su un `.xlsx`,
niente segnato; la lettura semplice e l'apertura danno la stessa proiezione
e la stessa revisione. Un test di `fub-format-rich`: l'apertura che non
ricorda dà la stessa proiezione di `open` e non cambia `prove_ricordate()`.
`cargo test -p fub-host --no-default-features` verde. I test di conformità
IPC verdi con le forme nuove; il test del fake (un'apertura conta, una
chiusura scala). `ipc-contract.md` descrive lettura semplice e apertura;
`node .github/scripts/check-doc-links.mjs` verde.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · ed10cc56 · check --rapido verde tranne un test a tempo di grid/engine.test.ts (carico 20), verde da solo; al primo giro anche headless::close_a_vault… (verde 5 volte da solo) e un test di fub-wasm-host, verdi al secondo
  Risposta (2026-11-03): l'utente dà l'OK al cambio dell'IPC (`read_document`
  e `write_document` con `open?`, `document_closed` con `{open}`, al più 1024
  chiavi per vault).

## T11 · Ogni documento che la shell apre si chiude

Perché: con T10 conta come aperto soltanto ciò che una sessione di documento
apre con la sua chiave; la shell deve passarla sempre, e chiuderla in ogni
modo in cui la sessione finisce, non solo con «chiudi» (D-2 (c)).
Tocca: `apps/client/src/state/document-session.ts` (la chiave della sessione,
`DocumentSessionApi`, le letture e le scritture della sessione, ogni uscita),
`state/document-session.test.ts`, `apps/client/src/state/open-key.guard.test.ts`
(nuovo), `apps/client/src/panels/search-preview.test.ts` (nuovo),
`docs/architecture/motori.md` («Scaldare e chiudere un documento»: la parte
dell'host di T10 e quella della shell).
Non toccare: `host/` (T10); i chiamanti che leggono e basta
(`panels/search.ts`, `panels/document.ts`, `desktop-shell.ts`,
`editors/base/surface.ts`, `state/document-controller.ts`): restano letture
semplici. Se uno di loro dovesse aprire, è una domanda per l'orchestratore,
non un'apertura di nascosto.
Dipende da: T10
Cosa fare:
- Ogni `DocumentSession` ha una chiave sua, fatta dalla collezione con
  `crypto.randomUUID()` (o da `crypto.getRandomValues` dove manca), tenuta
  accanto al vault della sessione. Tutte le letture e le scritture della
  sessione la passano (`openDocument`, `writeDocument(…, open)`), per ogni
  formato: quale documento è ricco lo sa l'host, quindi `RICH_FORMAT_IDS` si
  toglie.
- `read(id)` fa la chiave prima di leggere e la passa a `#create`; se la
  lettura non diventa una sessione (un'altra sessione si è aperta nel
  frattempo, una rinomina, un'identità o un vault cambiati, una cancellazione
  in corso) la chiave si chiude subito. Anche `#create` senza lettura (la
  bozza, un documento nuovo) fa la sua chiave.
- Una sola uscita, per esempio `#release(session)`, chiude la chiave una
  volta sola, chiamata da ogni punto da cui la sessione esce per sempre:
  `close`, `closeAll`, `handleExternalRemoval`, la cancellazione confermata,
  `#create` che sostituisce una sessione non più aperta, un errore che toglie
  la sessione. La rinomina tiene la chiave.
- Una lettura o una scrittura con la chiave che finisce dopo che la sessione
  è uscita (`#reloadFromDisk` o un salvataggio in volo) richiude la chiave:
  per l'host chiudere due volte non costa niente.
- `motori.md`: la lettura semplice e l'apertura, la chiave per sessione, il
  tetto delle chiavi, chi apre (solo le sessioni) e chi legge e basta.
Casi limite: due riquadri sullo stesso documento (una sessione, una chiave);
chiudere e riaprire subito lo stesso file (due chiavi, la vecchia chiusa);
chiudere tutto con dieci documenti aperti; il file cancellato o rinominato
da fuori; la lettura che fallisce; la cartella di Excel e la nota Markdown
(la chiave si passa e l'host la ignora); la finestra che si ricarica
(sviluppo, crash della WebView): le chiavi di prima restano all'host fino
alla chiusura del vault o al tetto di T10, ed è solo memoria; il vault che si
chiude con sessioni aperte.
Fatto quando: `document-session.test.ts`, con il fake di T10: per ogni uscita
(chiudi, chiudi tutto, cancellazione, rimozione da fuori, lettura scartata,
lettura che fallisce, lettura o salvataggio in volo dopo la chiusura) le
chiavi aperte tornano a zero; la rinomina tiene la chiave; un `.md`, un
`.docx` e un `.xlsx` passano la chiave. `search-preview.test.ts`: l'anteprima della
ricerca con «più contesto» ripetuta su cento file lascia zero chiavi aperte.
`open-key.guard.test.ts`: fuori da `state/document-session.ts` nessun file
del client chiama `openDocument` o `documentClosed`, né passa `open` a
`writeDocument` (fallisce se si aggiunge una chiamata altrove; cerca le
chiamate e non la parola, perché `"documentClosed"` è anche un motivo di fine
della sessione dal vivo, `LiveEndReason`). `npm run typecheck` verde; `node .github/scripts/check-doc-links.mjs` verde.
Prova: scripts/check.sh --rapido
Stato: [~] in corso · coder · base ff09f815

## T12 · Il prototipo del menu «Comandi» dei fogli

Perché: il menu è una cosa che si vede e che resta (D-3 (c)): l'utente lo
guarda prima che lo si scriva, ed è pensato una volta sola, per la barra di
oggi e per la modalità completa dei fogli.
Tocca: `PLAN-ui/menu-comandi-fogli.html` (nuovo).
Non toccare: il codice.
Dipende da: nessuno
Cosa fare:
- Il pulsante «Comandi» (Alt e poi C) all'inizio della fila dell'accesso
  rapido della barra dei fogli. Apre un menu con le schede della barra, e in
  più File, Disegna e Tabella pivot che la barra non ha; in ogni scheda i suoi
  gruppi; in ogni gruppo gli stessi controlli della barra (pulsanti, pulsanti
  divisi, menu, colori) e «Altri comandi del gruppo» per quelli che la barra
  non mostra; i gruppi che solo il menu ha (Annulla, Selezione, …); in fondo
  «Per ciò che hai selezionato», con le schede contestuali (Tabella, Grafico,
  Oggetto, Tabella pivot), spente col perché quando non c'è niente di
  selezionato.
- La ricerca: si scrive con il menu aperto; trova in tutto l'albero, mostra
  il percorso, le voci accese prima e quelle spente dopo col perché, senza
  tetto, con il conto nel piede.
- In sola lettura sono spente soltanto le voci che cambiano la cartella, col
  perché. I comandi che leggono aprono una finestra col risultato.
- Gli stati: a riposo, menu aperto, ricerca, ricerca con centinaia di voci,
  nessun risultato, schede per la selezione spente e accese (una tabella dal
  nome lungo), sola lettura, risultato in caricamento, risultato, 500 righe,
  errore, tastiera; luce chiara e scura; larghezza piena e 700 px.
- I dati sono quelli veri, generati da `catalogo.generated.json` e dalla
  barra (`ribbon/tabs.ts`), con le chiavi vere dei testi.
Prima di andare avanti: l'orchestratore mostra il prototipo all'utente e
aspetta il suo sì; T13, T14, T15 e T18 dipendono da quel sì.
Casi limite: un nome di tabella lunghissimo; nessun risultato; 500 righe; la
finestra stretta (il terzo livello si apre a sinistra, come fa già
`ui/menu.ts`); un comando con due posti nella barra; due comandi con lo
stesso titolo («Riempimento rapido»: li distingue il percorso).
Fatto quando: la pagina si apre senza errori nella console in tutti gli
stati, nelle due luci e alle due larghezze; il conto dice 303 comandi su 303
nel menu; l'utente ha detto sì.
Prova: aprire `PLAN-ui/menu-comandi-fogli.html` in un browser (con
Playwright: nessun errore nella console)
Stato: [x] fatto, aspetta il sì dell'utente
  Risposta (2026-11-03): non ancora approvato. L'utente: «il prototipo mi
  piace abbastanza, ma mi sembra troppo simile a excel e a tutti gli altri
  editor simili. vorrei che la barra multifunzione assumesse caratteristiche
  più in linea con lo stile moderno, minimale e stondato di Fub» e «più avanti
  riproporremo il design anche in docs e su altre modalità, ma partiamo da
  fogli». Il prototipo si rifà con la barra dei fogli nello stile di Fub.
  Rifatto (2026-11-03): la barra dei fogli nello stile di Fub, varianti A e B
  e il confronto «Barra: nuova / di prima»; il menu non cambia. La barra la
  porta T18, la variante la sceglie D-5; aspetta di nuovo il sì dell'utente.

## T13 · Un posto e un effetto per ogni comando dei fogli

Perché: il menu ha bisogno di un posto vero per ogni comando (scheda e
gruppo), e la sola lettura e il risultato hanno bisogno di sapere se un
comando cambia la cartella, la legge o cambia soltanto ciò che si vede. Oggi
75 comandi non hanno un posto e 16 hanno la scheda ma non il gruppo.
Tocca: `crates/fub-motori/src/catalogo.rs` (`Posto`, `ComandoFub`,
`Copertura`, `Effetto` nuovo), `crates/fub-motori/tests/copertura.rs`,
`crates/fub-format-xlsx/src/catalogo.rs` (`POSTI`, le schede e i gruppi
soltanto del menu, l'effetto), `crates/fub-format-xlsx/tests/copertura.rs`,
`tests/ts_catalogo.rs`, `crates/fub-format-xlsx/tests/effetto.rs` (nuovo),
`apps/client/src/editors/grid/catalogo.generated.json` (rigenerato),
`apps/client/src/editors/grid/palette/commands.ts` e `palette.test.ts`
(soltanto ciò che la forma nuova chiede: niente che si veda),
`docs/architecture/motori.md` («Il catalogo dei comandi»).
Non toccare: `vendor/gridcraft/` (l'effetto si legge da `CommandSpec`, il
motore non cambia); `ribbon/tabs.ts`; i testi del client (T14); `engine.ts`
(T15).
Dipende da: T12 (il sì dell'utente)
Cosa fare:
- `Posto` diventa `{ scheda, gruppo }`, tutti e due sempre pieni: niente più
  `Tavolozza` e niente gruppo vuoto. Le schede e i gruppi sono quelli del
  prototipo (`MENU` in `PLAN-ui/menu-comandi-fogli.html`: `tabs[].id` e
  `groups[].id`), cioè quelli della barra e quelli soltanto del menu (le
  schede `file`, `draw` e `pivot`; i gruppi segnati `solo`). Un comando che
  la barra mostra ha il gruppo dove la barra lo mostra; uno che la barra non
  ha, il gruppo dove il prototipo lo mette (`extra`). Un comando con il menu
  del motore vuoto ha una riga per id.
- Un elenco delle schede e dei gruppi, nell'ordine del menu, con `solo` e la
  scheda contestuale (`table`, `chart`, `object`, `pivot`) dove c'è; ogni
  posto nomina una scheda e un gruppo dell'elenco.
- `importa` dà una `Mancanza` per un comando servito senza posto; la
  `Copertura` non conta più «solo tavolozza» ma i comandi per scheda.
- `Effetto` in `ComandoFub`, deciso dall'adattatore: `Cambia` se il comando
  cambia la cartella (`commands::edits(id)`, cioè annullabile o composto) o è
  annulla o ripeti; `Legge` se il motore non lo scrive nel giornale
  (`journal: false`); `Mostra` per gli altri (selezione, foglio attivo,
  vista). Con il catalogo di oggi sono 249, 29 e 24 (i nomi sono nel
  prototipo, campo `e`).
- `effetto.rs`: ogni comando `Legge` e `Mostra`, fatto girare come in
  `tests/commands.rs` su una cartella costruita con `tests/common/` e
  preparata con i comandi che servono (una tabella pivot, un commento, un
  grafico creati prima con i loro comandi), con i parametri di partenza dallo
  schema, va a buon fine e lascia `commit.edit` vuoto. Un
  `Mostra` che cambia il giornale passa fra i `Cambia`, con il perché in un
  commento: nel dubbio si sceglie `Cambia`, che in sola lettura è spento.
- Il JSON generato ha `posto: { scheda, gruppo }` sempre, `effetto`, e in più
  `schede` (l'elenco di sopra).
- `motori.md`: il posto sempre pieno, l'effetto, l'elenco delle schede.
Casi limite: un comando in più posti della barra (dodici, per esempio
`home.formatCells`): il posto è il primo nell'ordine della barra, e il menu
lo mostra in tutti (T14); un comando che il motore aggiunge con un
aggiornamento, senza riga: la copertura fallisce e lo nomina; un gruppo senza
comandi: errore; un comando annullabile che il motore segna `query`: è
`Cambia`; un comando composto: `Cambia`; un comando che non gira sulla
cartella di prova: è un errore del test, non un salto.
Fatto quando: `cargo test -p fub-motori` e `cargo test -p fub-format-xlsx`
verdi, con `ogni_comando_ha_scheda_e_gruppo` (che sul codice di prima
fallisce: 75 senza posto, 16 senza gruppo) ed `effetto.rs`; il JSON
rigenerato con `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --test
ts_catalogo` ha 303 comandi con scheda, gruppo ed effetto, e le stesse
coppie id → scheda e gruppo di `MENU` nel prototipo (il coder lo controlla
con uno script e scrive nel resoconto ogni differenza col suo perché); i test
del client verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare
  Aspetta: il sì dell'utente al prototipo rifatto di T12 e la risposta a D-5.

## T14 · Il menu «Comandi» dei fogli

Perché: ogni comando dei fogli si deve trovare anche senza la tavolozza, in
un menu che segue la barra e che resta quello anche nella modalità completa
(D-3 (c)).
Tocca: `apps/client/src/kit/ribbon/ribbon.ts` e `kit/ribbon/types.ts` (la
fila `quick` accetta anche un `MenuControl`, con la sua lettera di Alt),
`kit/ribbon/ribbon.test.ts`, `apps/client/src/ui/menu.ts` (la ricerca
completa come opzione) e `ui/menu.test.ts`,
`apps/client/src/editors/grid/menu-comandi.ts` (nuovo) e
`menu-comandi.test.ts` (nuovo), `editors/grid/ribbon/ribbon.ts` (il pulsante
nella fila `quick`), `editors/grid/palette/strings.ts` (`fogli.menu.*`,
`fogli.motivo.context.*`), `editors/grid/palette/palette.test.ts` (la
copertura), `apps/client/src/theme/scrittoio/structure.css`,
`theme/scrittoio/skin/editors.css`, `theme/scrittoio/anatomia/editors.ts`
(l'hook `grid-ribbon-quick`), `apps/client/bench/scene.mjs` (gli stati del
menu), `docs/architecture/grid-surface.md` («La barra multifunzione», «I
comandi nella tavolozza», «Dove si trova»).
Non toccare: `ribbon/tabs.ts` e `ribbon/strings.ts` (il menu legge la barra,
non la cambia); `dialogs/`; il JSON generato (T13); `engine.ts` e
`palette/commands.ts` (T15); la barra dei documenti (`editors/rich/`); le
regole della barra dei fogli di T18 (il blocco di `.grid-ribbon-quick` si
aggiunge dopo di loro, non le cambia).
Dipende da: T12 (il sì dell'utente), T13, T18
Cosa fare:
- Il pulsante «Comandi» (`fogli.menu.button`, titolo `fogli.menu.label`) è
  il primo della fila dell'accesso rapido, con `aria-haspopup="menu"` e
  `aria-expanded`. Invio, Spazio e freccia giù aprono; Esc chiude e rende il
  fuoco al pulsante; Alt e poi C lo aprono, come le lettere delle schede.
- L'albero (`menu-comandi.ts`) si costruisce dalla barra (`ribbon/tabs.ts`:
  gli stessi controlli, le stesse voci, i separatori, le spunte e le scelte,
  acceso o spento come nella barra in quel momento) e dal catalogo (`posto`
  e `schede` di T13), nell'ordine di `schede`. In ogni gruppo prima i
  controlli della barra, poi «Altri comandi del gruppo» con quelli che la
  barra non mostra. Le schede contestuali stanno sotto «Per ciò che hai
  selezionato»: accese quando la selezione le chiede, col nome («Tabella
  «Vendite»»), spente col perché (`fogli.motivo.context.*`) altrimenti.
- Una voce del menu fa ciò che fa la barra, per la stessa strada
  (`grid_bytes_command`, le finestre scritte a mano, la finestra dei
  parametri di T7).
- La ricerca: con il menu aperto si scrive; trova in tutte le voci, anche
  dentro i sottomenu e nelle schede contestuali; mostra il percorso («Home ›
  Carattere › Grassetto»); prima le accese, poi le spente col perché; senza
  il tetto di `SEARCH_LIMIT`, con un'opzione nuova di `ui/menu.ts` (gli altri
  menu restano come sono); il piede conta le voci; nessun risultato dice
  `context.search.none`.
- Lo stato si chiede al motore (`grid_bytes_commands`) una volta quando il
  menu si apre, non per voce; a menu aperto, un cambio (la selezione si
  sposta) aggiorna le voci.
- La copertura: il test di T7 in `palette.test.ts` aggiunge «ogni comando
  servito è anche nel menu»: l'albero, costruito con ogni scheda contestuale
  accesa, ha ogni id del catalogo almeno una volta; ogni scheda e gruppo del
  catalogo esiste nella barra o fra quelli soltanto del menu.
- I testi in italiano e in inglese (`catalog(IT, { en: EN })`) con le chiavi
  del prototipo; il CSS e l'hook dal prototipo; gli stati del menu nel banco.
- Il CSS è quello «nella barra nuova» del prototipo: «Comandi» è una pillola
  piena (`--overlay-hover`, `--radius-pill`), staccata dalle schede da un
  filo corto; aperta prende il velo d'accento (`--accent-wash`). Il blocco di
  `skin/editors.css` sta dopo le regole di T18, con la sua regola per il
  foglio sotto i 900 px (`@container sheet`). Il blocco «solo prototipo»
  dell'accesso rapido sulla barra di prima resta nel prototipo.
- Gli stati del menu nel banco riusano ciò che T18 ha messo nel banco: la
  scheda della tabella, il nome lunghissimo, la sola lettura.
Dal prototipo: il pulsante e la fila `quick`, l'albero (`MENU`), la ricerca
completa, il CSS di `.grid-ribbon-quick`, l'hook `grid-ribbon-quick`, i testi
`fogli.menu.*` e `fogli.motivo.context.*`, gli stati del banco (la tabella
«Dal prototipo»).
Casi limite: la cartella si chiude a menu aperto (il menu si chiude, nessun
comando parte); un comando che si accende a menu aperto; un nome di tabella
lunghissimo (i puntini, il nome intero nel titolo); 700 px (il terzo livello
si apre a sinistra, come fa già `placeCascade`; la pillola «Comandi» e tutte
le schede, anche quella della tabella, stanno nella fila); una ricerca che trova
centinaia di voci («a»: si scorre, la tastiera arriva in fondo); una ricerca
senza risultati; due comandi con lo stesso titolo («Riempimento rapido»: li
distingue il percorso); un comando in più posti (compare in tutti);
`home.accounting`, che si raggiunge dalla parte grande del pulsante diviso;
un lettore di schermo (i ruoli `menu`, `menuitem`, `menuitemcheckbox`,
`menuitemradio`, `aria-disabled` e il perché nella descrizione); nessun
foglio con il fuoco (la barra dei fogli non c'è, e il pulsante con lei).
Fatto quando: i test vitest di `menu-comandi.test.ts` (l'albero, la ricerca,
le contestuali, la tastiera), di `ui/menu.test.ts` (la ricerca completa, e
quella di sempre ancora col tetto), di `kit/ribbon/ribbon.test.ts` (un menu
nella fila `quick`); la copertura «ogni comando servito è anche nel menu»,
che fallisce se si toglie un comando dall'albero; `npm run typecheck`, `npm
run theme:verify` e `bench:a11y` verdi con gli stati nuovi; le foto del banco
del menu, chiara e scura, piena e stretta, corrispondono al prototipo con la
barra nuova.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare
  Aspetta: il sì dell'utente al prototipo rifatto di T12 e la risposta a D-5.

## T15 · Il risultato dei comandi che leggono, e i perché in italiano

Perché: un comando che legge (le statistiche della selezione, il controllo
dell'accessibilità, …) non mostra niente (il limite noto di T7); in sola
lettura il motore e la tavolozza spengono anche i comandi che non cambiano
niente; il perché di un comando spento arriva in inglese, com'è nel motore.
Tocca: `apps/client/src/editors/grid/risultato.ts` (nuovo) e
`risultato.test.ts` (nuovo), `editors/grid/motivi.ts` (nuovo: dalle frasi del
motore alle chiavi) e `motivi.test.ts` (nuovo), `editors/grid/engine.ts`
(`command()` e `run()` in sola lettura) e `engine.test.ts`,
`editors/grid/palette/commands.ts` (la sola lettura per effetto, il
risultato) e `palette.test.ts`, `editors/grid/menu-comandi.ts`
(il risultato, i perché tradotti), `editors/grid/ribbon/ribbon.ts` (dove la
barra mostra il perché, `ribbon.unavailable`),
`editors/grid/palette/strings.ts` (`fogli.motivo.*`,
`fogli.result.*`), `crates/fub-format-xlsx/tests/ts_risultati.rs` (nuovo:
genera `apps/client/src/editors/grid/risultati.generated.json` e
`motivi.generated.json`), `theme/scrittoio/structure.css`,
`theme/scrittoio/skin/editors.css`, `theme/scrittoio/anatomia/editors.ts`
(gli hook `grid-result*`), `apps/client/bench/scene.mjs` (gli stati del
risultato), `docs/architecture/grid-surface.md`.
Non toccare: `vendor/gridcraft/` (le frasi restano quelle del motore e si
traducono nella shell); `GridCommandState` e l'ABI (la frase passa com'è);
`ribbon/tabs.ts`; le finestre scritte a mano (`dialogs/`).
Dipende da: T14
Cosa fare:
- In sola lettura si spengono soltanto i comandi con effetto `cambia` (il
  perché è `fogli.palette.read_only`); `legge` e `mostra` restano accesi
  nella barra, nel menu e nella tavolozza. `engine.ts` li lascia passare e,
  per prudenza, scarta un esito che porta modifiche (`commit.edit` non vuoto)
  in sola lettura: non lo applica e lo scrive nel log.
- Un comando `legge` senza una finestra scritta a mano apre la finestra del
  risultato (`risultato.ts`, con `kit/dialog.ts`), dalla barra, dal menu e
  dalla tavolozza: «Sto leggendo il risultato…» mentre aspetta; poi una
  tabella (chiave e valore, o colonne) con i numeri allineati a destra e i
  riferimenti di cella come pulsanti che portano alla cella e chiudono la
  finestra; «Copia» copia il risultato come testo con le tabulazioni; un
  errore dice che cosa è successo e offre «Riprova»; Esc chiude e rende il
  fuoco a chi l'ha aperta. Un risultato lungo scorre con l'intestazione
  ferma. Un comando con una finestra scritta a mano apre quella, come oggi.
- I perché in italiano: `motivi.ts` riconosce le frasi del motore e
  dell'adattatore (anche quelle con un numero o un errore dentro, come
  «rewriting the workbook would lose {n} item(s)») e dà la chiave
  `fogli.motivo.*`; una frase che non conosce non si perde: si mostra una
  frase generica in italiano con quella del motore fra virgolette. Lo usano
  il menu, la barra e la tavolozza.
- `ts_risultati.rs` scrive, con `UPDATE_MIRROR=1`, `motivi.generated.json`
  (ogni perché che il motore dà su cartelle costruite con `tests/common/`:
  vuota e piena, senza annulla, senza appunti, senza commenti, con e senza
  una tabella, un grafico, una tabella pivot; più le frasi scritte in
  `vendor/gridcraft/crates/engine/src/cmd/` e in
  `crates/fub-format-xlsx/src/commands.rs` e `grid.rs`, cercate nei
  sorgenti; la ricerca deve trovare almeno le frasi già note, così non ne
  trova zero senza dirlo) e
  `risultati.generated.json` (per ogni comando `legge` sulle stesse
  cartelle, le chiavi, le colonne e le parole fisse del suo risultato, non i
  valori: il file dev'essere uguale su ogni macchina, anche dove il
  dizionario dell'ortografia cambia). Le parole inglesi fisse dentro i
  risultati («Missing alternative text», «Merged cells», …) hanno la loro
  chiave come le colonne.
- Gli stati del risultato nel banco; il CSS e gli hook dal prototipo;
  `grid-surface.md` (la sola lettura per effetto, il risultato, i perché).
Dal prototipo: la finestra del risultato e i suoi stati, il CSS di
`.grid-result*`, gli hook `grid-result*`, i testi `fogli.result.*` e
`fogli.motivo.*` (la tabella «Dal prototipo»).
Casi limite: un risultato vuoto (una frase sua, non una tabella vuota); 500
righe; un valore lunghissimo (va a capo, la finestra non si allarga oltre lo
schermo); un riferimento a un foglio che non c'è più (il pulsante dice
perché non porta); la cartella si chiude con la finestra aperta (la finestra
si chiude); due clic di fila sullo stesso comando (una finestra sola); gli
appunti che non si possono scrivere («Copia» lo dice); una frase del motore
sconosciuta; una frase con un parametro; sola lettura e un comando `mostra`
(va); sola lettura e un esito con modifiche (scartato).
Fatto quando: `risultato.test.ts` (caricamento, tabella, numeri a destra,
riferimenti, «Copia», errore e «Riprova», Esc e il fuoco); `motivi.test.ts`
(ogni frase di `motivi.generated.json` ha la sua chiave in italiano e in
inglese; una frase sconosciuta non si perde); un test che ogni chiave di
`risultati.generated.json` ha il suo testo; `palette.test.ts`: in sola
lettura sono spenti soltanto i `cambia`; `engine.test.ts`: in sola lettura
`legge` e `mostra` passano e un esito con modifiche si scarta;
`bench:a11y` verde; le foto del banco del risultato, chiara e scura, piena e
stretta, corrispondono al prototipo.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare
  Aspetta: il sì dell'utente al prototipo rifatto di T12 e la risposta a D-5.

## T16 · La misura con i documenti che si chiudono

Perché: la pagina della misura di K3 dice che T8 non è misurato e che senza
T8 la cache dei documenti si svuota soltanto alla chiusura del vault; con
T8, T10 e T11 la shell chiude i documenti, e il numero va misurato, non
supposto.
Tocca: `docs/misure/k3-motori-2026-11-02-server-di-fub.md` (una sezione
nuova con i numeri e «Non misurato» aggiornato); se la macchina non è la
stessa, una pagina nuova `docs/misure/k3-motori-<data>-<macchina>.md` con il
collegamento dall'indice di `docs/misure/`.
Non toccare: il codice; `apps/client/bench/webview/budgets.json` e
`tools/motori-prova/budgets.json` si toccano soltanto per abbassare un
tetto, come in T9 (nessun limite si alza).
Dipende da: T11, T15
Cosa fare:
- R1 sulla stessa macchina e nello stesso modo di T9 (Xvfb, almeno tre giri,
  `npm run bench:webview -- --only=R1`), sul branch con T8–T15, accanto ai
  numeri «dopo» di T9: il residuo dell'app con il documento di R1 chiuso dal
  client; le misure di `tools/motori-prova` per i documenti dopo «chiudi
  tutto».
- La riga del giudizio di R1 si riscrive soltanto se i numeri la cambiano.
Casi limite: la macchina non è quella di T9 (si rimisura anche il lato di
T9, per confronto); la WebView senza schermo (si scrive, e vale il job
`webview` della CI); il rumore (tutti i giri nella tabella, non solo la
media).
Fatto quando: la pagina ha i numeri nuovi con il modo di lancio; «Non
misurato» non nomina più T8; `node .github/scripts/check-doc-links.mjs`
verde.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T17 · La CI completa e la revisione prima del merge

Perché: l'utente fonde K3 in `main` soltanto dopo la CI completa (Windows,
macOS e i banchi) e una revisione riga per riga di tutto K3 (merge-k3 (c)).
Tocca: la PR #295 (segnata pronta); i file che la revisione trova da
correggere, ognuno con un task nuovo in fondo al piano (e la sua riga in
«Modifiche») o con una correzione piccola, dove `DECISIONS.md` la lascia
all'orchestratore.
Non toccare: i limiti di `apps/client/bench/webview/budgets.json` (nessuno si
alza: ci-soglia (a)); i task fatti (un difetto in un task fatto si corregge
con un task nuovo).
Dipende da: T10, T11, T13, T14, T15, T16, T18
Cosa fare (lo fa l'orchestratore, non un coder):
- `gh pr ready 295`: parte la CI completa (Linux, Windows, macOS, i banchi
  del client).
- Legge ogni job (`gh run view <run> --json jobs`, i log con `gh api
  repos/Fubeo/Fub/actions/jobs/<job>/logs`): ogni rosso ha la sua causa
  scritta. Un test instabile con l'issue aperta si rilancia una volta; senza
  issue, prima si apre l'issue. L'unico rosso ammesso è
  `R1.giri.pendenza.MiB` della WebView, con il rimando a «Il piano dopo».
- Le foto del banco delle scene nuove (T7, T14, T15, T18) e delle scene
  `grid-*` che T18 cambia dal runner, confrontate col prototipo; le baseline
  delle scene dei documenti e delle tabelle restano le stesse (T18).
- La revisione riga per riga del diff di K3 contro `main`
  (`git diff origin/main...piano/k3-motori`): correttezza, nessuna perdita di
  dati, nessun lucchetto tenuto mentre si chiama un motore, ogni
  registrazione con chi la toglie, i testi in ogni lingua, le pagine di
  `docs/` che dicono il presente, nessun file generato scritto a mano. La
  revisione si scrive nella PR, un commento per area con i file.
- Ogni difetto ha la sua correzione e la CI torna verde.
- Poi chiede all'utente il merge, con il link alla PR, l'esito della CI e il
  riassunto della revisione. Il merge si fa soltanto dopo il sì.
Casi limite: un job di Windows o macOS che non parte (si aspetta, non si
salta); un rosso che c'è uguale su `main` (si scrive con il run di `main`,
non si nasconde); la revisione trova un difetto in un task fatto (task
nuovo, il vecchio non si riapre); un difetto che cambia ciò che l'utente vede
o un contratto (si chiede, come dice `DECISIONS.md`).
Fatto quando: la PR #295 è pronta e ogni job è verde, salvo
`R1.giri.pendenza.MiB` se è rosso, spiegato; la revisione è scritta nella
PR; nessun task resta aperto; l'utente ha detto sì al merge.
Prova: gh pr checks 295
Stato: [ ] da fare

## T18 · La barra dei fogli nello stile di Fub

Perché: l'utente trova la barra dei fogli «troppo simile a excel e a tutti
gli altri editor simili» e la vuole «più in linea con lo stile moderno,
minimale e stondato di Fub», cominciando dai fogli (T12, risposta del
2026-11-03). Cambia soltanto l'aspetto: i comandi, i ruoli, l'ordine del
fuoco e le lettere di Alt restano quelli.
Tocca: `apps/client/src/theme/scrittoio/structure.css` (la sezione «La barra
multifunzione del foglio»), `theme/scrittoio/skin/editors.css` (la sezione
«La barra multifunzione: le schede su un filetto…»),
`theme/scrittoio/skin.css` (solo con `npm run theme:generate`),
`theme/scrittoio/anatomia/editors.ts` (gli hook `grid-ribbon-split-large` e
`kit-tab-indicator`), `apps/client/bench/scene.mjs` (le scene della barra),
`apps/client/bench/fake-ipc.ts` (solo per la tabella e la sola lettura, che
il finto della cartella non ha), `docs/architecture/grid-surface.md` («La
barra multifunzione»).
Non toccare: `editors/rich/` e `tabella/` (le loro barre restano com'erano);
le regole `.rich-ribbon-…` di `structure.css` e `skin/editors.css` (perdono
soltanto i selettori `.grid-ribbon-…` delle liste che oggi condividono);
`kit/ribbon/*.ts` e `kit/tabs.ts`; `editors/grid/ribbon/` (il DOM, i testi,
`tabs.ts`); i token (`sheet-*.css`); `src/__fixtures__/xlsx-grid.json`
(generato da `crates/fub-format-xlsx/tests/ts_grid.rs`); le baseline del
banco (arrivano dal runner, T17); il CSS di T14 e di T15.
Dipende da: T12 (il sì dell'utente al prototipo rifatto, e D-5)
Cosa fare:
- In `structure.css` e in `skin/editors.css`, dalle liste che uniscono
  `.rich-ribbon-…` e `.grid-ribbon-…` si tolgono i selettori
  `.grid-ribbon-…`: le regole dei documenti restano carattere per carattere.
  Al loro posto, nella stessa sezione, i blocchi «→ structure.css (T18…)» e
  «→ skin/editors.css (T18…)» del prototipo; i blocchi della variante B solo
  se D-5 la sceglie.
- Ciò che si vede. Le schede sono pillole; la scelta è il velo d'accento
  (`.kit-tab-indicator`, che `kit/tabs.ts` già sposta con `moto/`) e scorre
  da una scheda all'altra; sotto le schede non c'è più il filetto. I comandi
  stanno su un vassoio stondato (`--sheet-2`), i gruppi si separano con un
  filo corto. I pulsanti sono quelli della barra di formato delle note (alti
  28 px, stondati, un velo al passaggio, il velo d'accento quando sono
  accesi; le icone grandi a 24 px). Un pulsante diviso è un pezzo solo con
  due bocche. Le schede per la selezione hanno l'accento e un punto, e
  stanno un passo più in là. I campi sono quelli del kit (il bordo
  `--outline`, l'alone del fuoco, i puntini su un nome lungo). Le lettere di
  Alt sono pastiglie scure e tonde (`--sheet` su `--text`, la coppia di
  contrasto che c'è già, rovesciata). La tavolozza ha i titoli in
  maiuscoletto e i campioni stondati.
- In un foglio sotto i 900 px (`@container sheet`: il contenitore è
  `.pane-editor`) le schede si stringono, e con loro, di un passo, i margini
  della fila e del vassoio, che restano allineati: a 700 px ci stanno tutte,
  anche quella della selezione. Con la barra di adesso, a 700 px, una scheda
  esce dalla fila. Le regole del foglio stretto vanno dopo quelle che
  cambiano (una query del contenitore non pesa di più), come nel prototipo.
- Gli hook nuovi nella voce `grid-ribbon` di `anatomia/editors.ts`:
  `grid-ribbon-split-large` (la classe c'è già nel DOM del kit e in
  `structure.css`) e `kit-tab-indicator` (è già in `anatomia/kit.ts`: la
  voce lo nomina come nomina già `kit-tabs` e `kit-tab`, e l'unione degli
  hook resta senza doppioni). Poi `npm run theme:generate`.
- Il banco: le scene `grid-*` cambiano foto. Scene nuove della barra: 700 px
  con la scheda della tabella e un nome di tabella lunghissimo; le lettere di
  Alt; un gruppo raccolto e il suo riquadro; la tavolozza dei colori; la
  barra ritirata; la sola lettura. Il finto della cartella (`?workbook=1`,
  `xlsx-grid.json`) non ha tabelle né la sola lettura: le scene li ottengono
  in `bench/fake-ipc.ts` (una copia della finestra con una tabella, dietro un
  parametro della query), senza toccare il JSON generato. T14 le riusa per
  gli stati del menu.
- In `grid-surface.md`, «La barra multifunzione»: l'aspetto in una frase (le
  schede a pillola, il vassoio, i fili corti) e il foglio stretto, dove le
  schede si stringono.
Dal prototipo: i blocchi «→ structure.css (T18…)» e «→ skin/editors.css
(T18…)», quelli della variante B se D-5 la sceglie, gli hook, gli stati del
banco (la tabella «Dal prototipo»). Il confronto «Barra: nuova / di prima»
mostra le due barre negli stessi stati.
Casi limite: 700 px con la scheda della tabella accesa (tutte le schede
nella fila, nessuna tagliata); un nome di tabella lunghissimo (i puntini nel
campo del nome); la sola lettura (i comandi spenti si riconoscono, il perché
nel suggerimento); i token ad alto contrasto (`sheet-light-high.css`,
`sheet-dark-high.css`); i colori forzati (la scheda scelta la segna il
contorno del kit, il vassoio e i fili diventano bordi); Alt e F10 (le
pastiglie non escono dalla barra); la barra ritirata (Ctrl+F1, il pulsante
in fondo alla fila); un gruppo raccolto e il suo riquadro; la tavolozza; un
foglio appena sotto e appena sopra i 900 px; una finestra documento
(`document/window.ts` dà lo stesso contenitore `sheet`); il movimento
ridotto e il livello calmo (il velo arriva al suo posto senza scorrere: lo
decide `moto/`).
Fatto quando: le foto del banco della barra (le scene `grid-*` e quelle
nuove), chiara e scura, piena e 700 px, corrispondono al prototipo con la
barra nuova; la barra dei documenti e quella delle tabelle non cambiano: le
regole che nominano `.rich-ribbon-…` sono le stesse prima e dopo, tolti i
selettori `.grid-ribbon-…`, e ogni selettore nuovo comincia da
`.grid-ribbon` (una prova scritta nel rapporto), e nella CI `bench:verify`
trova invariate le scene dei documenti e delle tabelle (`document-*`,
`window-document`, `mobile-document*`, `live-14-tabella-attiva`,
`slash-05-tabella`), senza baseline nuove per loro; i test del tema
(`theme/scrittoio/anatomia.test.ts`, `theme/skin.test.ts`,
`theme/structure.test.ts`, `theme/contrast.test.ts`,
`theme/forced-colors.test.ts`), `npm run theme:verify`, `npm run typecheck`
e `bench:a11y` verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare
  Aspetta: il sì dell'utente al prototipo rifatto di T12 e la risposta a D-5.

Dopo K3, non in K3: lo stesso stile passa alla barra dei documenti, a quella
delle tabelle e alle altre modalità spostando queste regole da
`.grid-ribbon-…` al kit (`kit/ribbon/`: una pelle sola per ogni barra del
kit, con selettori che non dipendono dal prefisso); con quel passo arriva,
se serve, l'impostazione dei nomi dei gruppi (D-5 (c)), una volta sola per
tutte le barre.

## Il piano dopo: la memoria della WebView

Non è un task di K3: è il punto di partenza per il pianificatore del piano che
viene dopo (D-4 (a)).

Che cosa sappiamo, dalla misura di K3
(`docs/misure/k3-motori-2026-11-02-server-di-fub.md`, R1 sotto Xvfb, tre
giri per lato):

- il processo di Fub ora rende la memoria: dopo «chiudi tutto» il suo residuo
  è passato da +7…+12 a −53…−61 MiB (il `malloc_trim` di T5 rende anche la
  memoria dell'indicizzazione dell'avvio); la sua pendenza resta di 0,24–0,29
  MiB per giro, qualche centinaio di KiB che ogni giro lascia ancora;
- quasi tutto il resto è della WebView: il suo residuo è fra 46 e 123 MiB, la
  sua pendenza fra 7,3 e 9,0 MiB per giro; la pendenza totale è fra 7,48 e
  9,23 MiB per giro, contro l'obiettivo di 1;
- nella CI (soglia `ci` di 20 MiB per giro): `main` 34,67, rosso; la PR #295
  19,58, verde. Fra un run e l'altro di `main` la pendenza va da −4 a +48 MiB
  per giro: il rumore è più grande della differenza da misurare;
- R1 legge `/proc`: macOS e Windows non sono misurati.

Che cosa resta: l'obiettivo di R1 (`targets` in
`apps/client/bench/webview/budgets.json`), residuo entro 50 MiB e pendenza
entro 1 MiB per giro. `R1.giri.pendenza.MiB` resta rosso finché non ci
arriva: l'utente ha scelto di non alzare il limite (ci-soglia (a)).

Da dove partire: chi tiene memoria nella WebView fra un giro e l'altro (nodi
staccati, ascoltatori, immagini e canvas, worker, le cache di WebKit, la
raccolta della memoria di JavaScriptCore); un modo di misurare con meno
rumore prima di cambiare codice (più giri, la mediana, la raccolta forzata
misurata a parte); i pochi KiB per giro del processo di Fub; come misurare su
macOS e Windows. La guida delle misure è
`docs/development/webview-measurements.md`.
