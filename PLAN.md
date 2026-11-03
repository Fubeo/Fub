# Piano: N7 · I file Craft nel vault

Branch: piano/n7-file-craft
Obiettivo: i file delle app Craft (`.vectorcraft`, `.pcraft`, `.figcraft`) e
gli XMP che LightCraft scrive accanto alle foto hanno la loro specie
nell'albero, si aprono in una scheda che mostra l'anteprima e i dati, si
cercano, si incorporano nelle note e diventano link e backlink; le parole
chiave degli XMP diventano tag, voto, etichetta e scelta diventano proprietà.
«Apri con un'altra app» diventa un sottomenu con le app Craft installate, e un
documento aperto in un'app Craft resta in Fub in sola lettura finché non lo
riprendi. Fub non scrive mai un file Craft né un XMP.
Perché: oggi un file Craft nel vault è un allegato muto: niente anteprima,
niente ricerca, niente backlink, e «Apri con un'altra app» conosce solo l'app
predefinita del sistema (`crates/fub-app/src/reveal.rs`). Il passo 12c chiede
che i file Craft siano cittadini del vault anche senza le modalità di Fub che
li apriranno dentro (K5–K9).
Fuori scope: le modalità che aprono e modificano i file Craft dentro Fub
(K5–K9: qui la scheda è una vista in sola lettura che quelle modalità
prenderanno); ogni scrittura in un file Craft o in un XMP; le impostazioni di
sviluppo (`crs:`, `lc:settings`); in attesa di D-10, che consiglia di
lasciarli ai loro piani: il `.pcraft` a cartella, le anteprime dei fogli
(`.xlsx`, GridCraft), le miniature delle immagini comuni nell'albero, le
anteprime delle foto HEIC e TIFF che la WebView non mostra, e i metadati per
la ricerca dei file oltre il limite del kernel (64 MiB);
`library.import` di LightCraft e ogni canale di controllo senza
autenticazione (D-2 (a)); le anteprime fatte coi motori di Fub (il visore dei
PDF, il motore dei documenti); sapere se un'app è aperta quando non l'ha
avviata Fub; le prove su Windows e macOS (il codice c'è, le prove girano su
Linux); la CI per i coder (CLAUDE.md: la guarda l'orchestratore, T32); il
vault vero.
Assunzioni: A1–A17 qui sotto. A1–A12 le ha decise il pianificatore il
2026-11-02 di notte; lo stesso giorno l'utente ha risposto a D-1…D-9 (la
risposta è sotto ogni domanda) e A13–A17 vengono dalle risposte. D-10 è
nuova e non blocca: il piano segue la sua (a).
Ondate: T1 | T2 T3 T4 | T5 T6 | T7 T14 | T15 (fatti) | T18 T8 T9 T20 | T10 T21 | T19 T24 T27 | T11 T22 T25 | T12 T30 | T13 T23 T29 | T16 T28 T31 | T17 T26 | T32
Prototipo: `PLAN-ui/craft-anteprime.html`, per le parti nuove che le
risposte portano (la domanda sulle anteprime, i dati sulla foto, la scheda
di un RAW, il PDF nella nota, l'albero, le impostazioni nuove); scritto dal
pianificatore il 2026-11-03. Approvato: 2026-11-03 (T18), così com'è, con le
sei scelte «da decidere guardando» come le propone la pagina. Le parti di
T14–T17 non hanno prototipo: riusano pezzi che ci sono.

## Modifiche

- 2026-11-02, dopo le risposte dell'utente a D-1…D-9: task nuovi T18–T32 (il
  prototipo, il contratto 2, le letture a pezzi, il consenso, la domanda nella
  scheda, i dati sulla foto, l'albero, i RAW, le CLI di LightCraft, PdfCraft e
  WordCraft, i PDF e i documenti, la CI e la revisione). T11 riscritto: la CLI
  parte solo da `Host::craft_render`, dopo un gesto e col consenso, mai da
  `craft.preview`. T12 ha in più il comando `craft_render`; T13 le prove che
  niente si avvia e la nuova forma di `craft.preview`; T10 va in parallelo
  con T21 invece che con T11. Da rivedere T1, T2, T3, T6, T7, T14, T15.
  Aggiornati il cancello, le assunzioni, il fuori scope, le tabelle, le
  regole; D-10 nuova.
- 2026-11-03, scrivendo il prototipo: l'orientamento di un RAW lo scrive il
  codice (`editors/media/orientation.ts`, la vista dello zoom, la miniatura
  dell'albero), non otto classi della pelle (T26, T28); la riga d'avviso con
  due azioni non chiede CSS (T31); `craft-figure` e `craft-figure-page`
  nuove (T31); `craft-ask-answer` e `photo-data-line`, `photo-data-tags`
  nuove (T23, T25); un RAW nell'albero ha l'icona delle foto (T26); il peso
  massimo dice «(MiB)» nel nome e la frase di T7 perde «Vale su questo
  computer.» (T19); le chiavi delle frasi sono quelle della pagina.

## Dal prototipo

Le righe di T7 e T14–T17 non hanno prototipo: ogni parte riusa un pezzo che
c'è già. Le righe di T19–T31 vengono da `PLAN-ui/craft-anteprime.html` (T18):
ogni classe nuova nominata qui va nell'anatomia del pezzo.

| Pezzo | Destinazione | Task |
|---|---|---|
| L'icona e la sigla nell'albero (VECTORCRAFT, PHOTOCRAFT, FIGCRAFT, XMP) | `apps/client/src/ui/format-kind.ts`, `apps/client/src/ui/icons.ts` | T14 |
| La scheda di un file Craft: anteprima con lo zoom delle immagini, riga dei dati, «Crea l'anteprima» | `apps/client/src/editors/craft/surface.ts` (nuovo), con `mountImageView` di `editors/media/image-view.ts` | T14 |
| La scheda di un XMP: voto, etichetta, scelta, parole chiave, la foto, la copia `-Edit.psd`, la nota su LightCraft | `apps/client/src/editors/craft/xmp-view.ts` (nuovo) | T14 |
| L'aspetto delle due schede | `apps/client/src/theme/scrittoio/skin/media.css`, hook in `theme/scrittoio/anatomia/media.ts` | T14 |
| La figura nella nota (`![[logo.vectorcraft]]`) | `apps/client/src/editors/craft/figure.ts` (nuovo), agganciata in `editors/text/profiles/markdown/mount.ts` | T15 |
| L'anteprima al passaggio su un link a un file Craft | `apps/client/src/state/preview.ts` | T15 |
| Il sottomenu «Apri con un'altra app» | `apps/client/src/panels/open-with.ts` (nuovo), `panels/explorer.ts`, `editors/media/media-surface.ts` | T16 |
| La riga «Aperto in GridCraft · Riprendi qui» | `apps/client/src/panels/document.ts` (`noticeLinesOf`) | T17 |
| Le impostazioni «App esterne» | `crates/fub-host/src/settings.rs` | T7 |
| I testi della shell | `apps/client/src/i18n/catalog.ts` | T14, T16, T17 |
| La domanda «Faccio fare le anteprime alle app?» nella scheda (`craft-ask`, `craft-ask-text`, `craft-ask-actions`, `craft-ask-answer`, `craft-ask-hint`) e la riga «spente» (`craft-off`) | `apps/client/src/editors/craft/consent.ts` (nuovo), `theme/scrittoio/skin/media.css`, `anatomia/media.ts` | T23 |
| La stessa domanda nella riga d'avviso di un PDF o di un documento Word (una seconda azione nella riga, nessun CSS nuovo: `.sheet-notice` di `skin/sheets.css` va già a capo) | `apps/client/src/panels/document.ts` (`noticeLinesOf`) | T31 |
| La riga dei dati sulla foto: stelle, etichetta, scelta, parole chiave, «Apri l'XMP» (`photo-data`, `photo-data-line`, `photo-data-tags`, `photo-data-open`; stelle, etichetta e tag con le classi `craft-xmp-*` che ci sono) | `apps/client/src/editors/craft/photo-data.ts` (nuovo), agganciata in `editors/media/media-surface.ts`; `skin/media.css`, `anatomia/media.ts` | T25 |
| La scheda di un RAW: la foto con lo zoom, la riga dei dati della foto, «Crea l'anteprima con LightCraft» | `apps/client/src/editors/craft/surface.ts` (profilo `raw`) | T28 |
| Il RAW girato: lo raddrizza la vista dello zoom, che parte con la rotazione e lo specchio del file (nessun CSS) | `apps/client/src/editors/media/orientation.ts` (nuovo), `editors/media/zoom-view.ts`, `editors/media/image-view.ts` | T28 |
| Il PDF nella nota: la prima pagina come figura, col nome sotto; senza anteprima il link di oggi (`craft-figure` larga quanto l'immagine, `craft-figure-page` col filo e l'ombra) | `apps/client/src/editors/text/profiles/markdown/media.ts` (riga 396), `apps/client/src/editors/craft/figure.ts`; `skin/document.css`, `anatomia/document.ts` | T31 |
| La miniatura nella riga dell'albero (`tree-thumb`; l'orientamento lo scrive il codice), l'icona delle foto per un RAW e gli XMP nascosti | `apps/client/src/panels/explorer.ts`, `theme/scrittoio/skin/tree.css`, `anatomia/tree.ts` | T26 |
| Le impostazioni nuove di «App esterne»: «Anteprime fatte dalle app» (tre scelte, una tendina), «Peso massimo da leggere per un'anteprima (MiB)», «Miniature nell'albero», «Mostra i file XMP nell'albero» | `crates/fub-host/src/settings.rs` | T19 |
| I testi nuovi della shell | `apps/client/src/i18n/catalog.ts` | T23, T25, T28, T31 |

## Che cosa vede chi usa Fub

Nessun pezzo nuovo del kit: tutto è fatto con ciò che la shell ha già. Le
parti nuove che le risposte portano sono disegnate nel prototipo (T18).

- **Nell'albero.** Un `.vectorcraft` e un `.figcraft` hanno l'icona dei
  disegni e la sigla VECTORCRAFT o FIGCRAFT, come un `.svg` ha la sua; un
  `.pcraft` e un `.xmp` hanno un'icona nuova, una fotografia, con la sigla
  PHOTOCRAFT o XMP; un RAW ha l'icona delle foto. Le miniature sono spente;
  accendendo «Miniature nell'albero», accanto al nome di un file Craft, di un
  RAW, di un PDF o di un documento Word c'è la piccola anteprima che il file
  ha già (dentro o fatta prima), mai una fatta apposta (D-7 (d)): sta al
  posto dell'icona e alla sua misura, così la riga non cambia altezza.
  Spegnendo «Mostra i file XMP nell'albero» gli `.xmp` spariscono
  dall'albero; la ricerca li trova ancora, e la foto mostra i loro dati (D-5
  (d)).
- **La scheda.** Un clic su un file Craft apre una scheda in sola lettura.
  In alto l'anteprima, con lo zoom e la barra delle immagini (la stessa vista
  di una foto). Sotto, una riga di dati: l'app («Disegno di VectorCraft»), la
  versione del formato se il file la dice, il peso. Se il file non ha
  un'anteprima dentro (VectorCraft di solito non la salva), al suo posto c'è
  un riquadro col nome del file e ciò che dice la voce qui sotto. Mentre
  l'app lavora il riquadro dice «Preparo l'anteprima…». Un file grande ha
  l'anteprima lo stesso, quando il formato permette di leggerne solo un pezzo
  (l'indice di uno ZIP e la voce dell'anteprima); quando va letto intero e
  supera il «Peso massimo da leggere per un'anteprima» (64 MiB, si cambia)
  il riquadro lo dice, col link all'impostazione, e «Apri con» resta (D-8
  (c)).
- **Le anteprime fatte dalle app.** Sono spente finché non le accendi (D-1
  (b)). La prima volta che una scheda ne avrebbe bisogno (l'anteprima manca e
  l'app è installata), al posto del pulsante c'è una domanda: «Fub può far
  fare l'anteprima a VectorCraft, che lavora su una copia del file. Vuoi che
  lo faccia per i file che apri?», con «Sì, accendi» e «No, lasciale
  spente», e sotto «Puoi cambiare idea in Impostazioni › App esterne». La
  risposta vale per tutte le app e si salva. Accese: aprendo un file con un
  clic o un tasto, Fub fa l'anteprima che manca; una scheda riaperta
  all'avvio, o aperta da un link `fub://`, mostra invece il pulsante «Crea
  l'anteprima con VectorCraft». Spente: niente parte, e la scheda dice
  «Le anteprime fatte dalle app sono spente» con il link alle impostazioni.
  Le note, il passaggio del puntatore, l'albero, l'MCP e i plugin non
  avviano mai un'app.
- **Una foto.** Aprendo una foto (`.jpg`, `.png`, un RAW…) accanto a cui c'è
  l'XMP di LightCraft, sotto la foto c'è una riga coi suoi dati: le stelle,
  l'etichetta col colore, la scelta, le parole chiave (un clic cerca il tag)
  e «Apri l'XMP» (D-5 (d)). Tante parole chiave vanno a capo fino a tre
  righe e poi scorrono; un XMP vuoto o rotto lo dice, sempre con «Apri
  l'XMP».
- **Un RAW.** Un `.cr3`, `.nef`, `.arw`, `.dng`… si apre in una scheda come
  quella di una foto: l'anteprima che la fotocamera ha messo dentro il file,
  dritta come è stata scattata (una foto verticale resta verticale), con lo
  zoom, e la riga dei dati della foto. Se il file non ne ha una e
  LightCraft è installata, vale la voce delle anteprime fatte dalle app (D-9
  (c)).
- **PDF e documenti.** Un PDF incorporato in una nota (`![[contratto.pdf]]`),
  che oggi diventa un link, mostra la prima pagina come una figura quando
  l'anteprima c'è, con il filo e l'ombra di un foglio e il nome sotto;
  senza, resta il link. Con le anteprime accese, aprendo un
  PDF o un documento Word con un clic Fub fa fare a PdfCraft o a WordCraft
  l'anteprima che manca (a un `.docx` o un `.odt` che ha la miniatura dentro
  non serve); con la domanda ancora aperta, la scheda la fa nella riga
  d'avviso, con gli stessi due pulsanti (D-9 (c)).
- **La scheda di un XMP.** Il voto in stelle, l'etichetta col suo colore, la
  scelta («Scelta», «Scartata»), le parole chiave come i tag della nota (un
  clic cerca il tag), il nome della foto a cui l'XMP appartiene (un clic la
  apre) e, se c'è, la copia `-Edit.psd` fatta con PhotoCraft. In fondo una
  riga fissa: «LightCraft scrive questi dati quando salvi con ⌘S, o sempre se
  accendi la scrittura automatica degli XMP nelle sue preferenze» (D-5).
- **Nelle note.** `![[logo.vectorcraft]]` mostra l'anteprima come
  un'immagine incorporata, con la didascalia del nome sotto di lei; senza
  anteprima, un riquadro col nome e l'app. Passando col puntatore su un link
  a un file Craft, la finestrella dell'anteprima mostra la stessa figura. Le
  note non avviano mai l'app: mostrano solo ciò che c'è nel file o già
  pronto.
- **Cercare e collegare.** I file Craft compaiono nella ricerca col loro
  titolo e il loro testo; una foto piazzata in un disegno di VectorCraft ha,
  nei suoi backlink, il disegno; le parole chiave di LightCraft sono tag, nel
  pannello dei tag e nella ricerca `tag:`.
- **«Apri con un'altra app».** Nel menu del tasto destro di un file (e nella
  barra di una foto o di un PDF), se c'è almeno un'app Craft installata, la
  voce diventa un sottomenu: per prima «L'app predefinita del sistema», poi le
  app Craft che aprono quell'estensione. Quelle non installate restano
  visibili ma spente, con «Non installata»; quella che Fub ha già avviato dice
  «Già aperta». Senza app Craft installate la voce fa quello che fa oggi.
- **Il prestito.** Aprendo in un'app Craft un documento che Fub sa
  modificare (un `.xlsx` in GridCraft, un `.docx` in WordCraft), Fub salva
  prima ciò che è in coda; la scheda passa in sola lettura e mostra la riga
  «Aperto in GridCraft» con l'azione «Riprendi qui». Quando l'app salva, la
  scheda si aggiorna da sola. «Riprendi qui» o la chiusura della scheda
  finiscono il prestito.
- **Le impostazioni.** Nel gruppo nuovo «App esterne», tutte di questo
  computer: «Dove sono le app Craft» (una lista di righe
  `vectorcraft=/percorso/del/programma`, per chi le ha messe in un posto
  suo); «Anteprime fatte dalle app», una tendina con tre scelte, «Chiedi la
  prima volta» (la scelta di partenza), «Accese», «Spente»; «Peso massimo da
  leggere per un'anteprima (MiB)» (64); «Miniature nell'albero» (spenta);
  «Mostra i file XMP nell'albero» (accesa). Nei componenti, «File delle app
  Craft» nel gruppo dei disegni, acceso: spegnerlo toglie anteprime, schede,
  i dati sulla foto e le app Craft da «Apri con», mentre la ricerca e i
  backlink restano (D-7 (d)).

## Fonti

- Il passo 12c (N7) dei «Piani di Fub», con l'indice, le regole
  (`01-regole-e-decisioni.md`), il contesto e i rischi. I coder non li
  leggono: qui c'è ciò che serve, e dove il codice dice altro vince il codice
  (sezione «Differenze dal passo 12c»).
- Ciò che il passo dice delle app Craft (formati, CLI, canali, istanza
  singola) è preso come scritto: il codice delle app non è nel repo. La
  sezione «Con file finti, con un'app vera» separa ciò che i test provano da
  ciò che solo un'app installata può dire.
- Il codice letto: `crates/fub-abi` (`FormatProvider`, `DocumentSource`,
  `IndexQuery`, `HostApi`), `crates/fub-format-svg` (il modello del crate e
  dei link), `crates/fub-format-xlsx` (sola lettura, conformità, specchio
  TypeScript), `crates/fub-kernel/src/workspace.rs` (la rinomina),
  `crates/fub-host` (`mount.rs`, `link_card.rs`, `settings.rs`,
  `control.rs`, `session.rs`), `crates/fub-features/src/componenti.rs`,
  `crates/fub-app/src/reveal.rs` e `lib.rs`, `crates/fub-cli/src/mcp/`,
  `apps/client/src/` (`editors/core/bootstrap.ts`, `editors/media/`,
  `editors/text/profiles/markdown/`, `state/link-cards.ts`,
  `state/preview.ts`, `panels/explorer.ts`, `panels/document.ts`,
  `ui/format-kind.ts`), i presidi in `.github/scripts/`.
- Scritto su `origin/main` @ `620f0acd`.

## Chi aspetta chi

Le risposte a D-1…D-9 sono arrivate il 2026-11-02: la terza colonna dice
quale risposta il task segue, o quale aspetta ancora.

| Task | Parte dopo | Segue la risposta |
|---|---|---|
| T1 · il crate e il contratto | subito | nessuna |
| T2 · i contenitori | T1 | nessuna |
| T3 · gli XMP | T1 | D-5 (d) |
| T4 · i file collegati | T1 | nessuna |
| T5 · la rinomina coi file a byte | T4 (pagina) | D-3 (a) |
| T6 · il bundle `fub.craft` | T1, T2, T3, T4 | D-7 (d), D-8 (c) |
| T7 · il registro degli editor | T6 | D-1 (b) |
| T8 · l'avvio dei programmi | T6 | D-1 (b) |
| T9 · il canale di controllo | T6 | D-2 (a) |
| T10 · «Apri con» nell'host | T7, T8, T9 | D-1 (b), D-2 (a) |
| T11 · le anteprime con la CLI, dopo un gesto | T8, T9, T19, T20, T21 | D-1 (b), D-8 (c) |
| T12 · l'IPC | T10, T11 | D-1 (b) |
| T13 · gli strumenti MCP | T6, T10, T11, T20 | D-4 (a) |
| T14 · la scheda Craft e XMP | T1, T6 | D-5 (d), D-7 (d) |
| T15 · le figure e l'anteprima al passaggio | T14 | nessuna |
| T16 · il sottomenu «Apri con» | T12, T14 | D-6 (a) |
| T17 · il prestito | T16 | D-6 (a) |
| T18 · il prototipo, da approvare | subito (l'orchestratore) | D-1 (b), D-5 (d), D-7 (d), D-8 (c), D-9 (c) |
| T19 · le impostazioni nuove e il consenso | T7, T18, T20 | D-1 (b), D-5 (d), D-7 (d), D-8 (c) |
| T20 · il contratto 2 | T6 | D-1 (b), D-8 (c), D-9 (c) |
| T21 · le letture a pezzi nel core | T6, T20 | D-8 (c) |
| T22 · le anteprime lette a pezzi | T19, T20, T21 | D-8 (c) |
| T23 · la domanda e il gesto nella shell | T12, T18, T20 | D-1 (b) |
| T24 · la foto e il suo XMP nell'host | T20 | D-5 (d) |
| T25 · i dati sulla foto | T18, T24 | D-5 (d) |
| T26 · l'albero: miniature e XMP nascosti | T16, T18, T19, T22, T23, T28 | D-5 (d), D-7 (d) |
| T27 · i RAW: l'anteprima dentro il file | T20, T21 | D-9 (c) |
| T28 · la scheda di un RAW | T23, T25, T27, T29 | D-9 (c) |
| T29 · le CLI di LightCraft, PdfCraft e WordCraft | T11, T27, T30 | D-1 (b), D-9 (c) |
| T30 · le anteprime dei documenti | T20, T21, T22 | D-9 (c) |
| T31 · PDF e documenti nella shell | T18, T23, T29, T30 | D-1 (b), D-9 (c) |
| T32 · la CI completa e la revisione | tutti gli altri | nessuna |

T5 non usa niente di T1–T4: aspetta T4 solo perché scrive nella stessa
pagina nuova (`docs/product/craft-files.md`), che T1 crea. T18 è il primo dei
task nuovi perché la sua approvazione sblocca tutti i task con una parte
visibile: intanto i coder fanno T8, T9, T20, T10 e T21, che non ne
dipendono. T20 scrive anche gli scheletri dei moduli nuovi (come T1 e T6),
così i task della stessa ondata non toccano lo stesso file. Qualche attesa è
solo per un file: T26 aspetta T16 e T23 perché scrivono prima in
`panels/explorer.ts`, e T10 e T21 vanno insieme perché non si toccano. Le
ondate dicono che cosa può andare insieme; i coder al lavoro nello stesso
momento restano al più due.

## Domande per l'utente (raccolte, non bloccano)

Il piano procede con la prima opzione di ognuna.
Il 2026-11-02 l'utente ha risposto: la risposta è sotto ogni domanda. D-10
è nuova e non blocca: il piano segue la sua (a).

- D-1 · Chi può avviare programmi esterni, e quando (T7, T8, T10, T11).
  (a) Consigliata: solo il core di Fub (`fub-host`), mai un bundle o un
  plugin, e nessun permesso nuovo nell'ABI. «Apri con» parte solo da un clic
  o da uno strumento MCP con `apply`; la CLI di un'app parte all'apertura
  della scheda o dal pulsante «Crea l'anteprima», mai da sola in sottofondo
  né dalle note. Un interruttore di macchina, «Anteprime con le app Craft»,
  acceso. (b) Come (a), ma l'interruttore spento finché non lo accendi. (c)
  Un permesso nuovo dell'ABI, «avviare programmi», che un plugin può
  chiedere. Conseguenza: con (c) cambiano l'ABI, i permessi e la loro pagina,
  e un plugin di terzi può avviare programmi; tornare indietro dopo T12 vuol
  dire rifare T8, T10, T11.
  Risposta (2026-11-02): (b) — solo Fub, e solo dopo un gesto di chi lo usa,
  avvia un'app; le anteprime fatte dalle app sono spente finché non le
  accendi, e Fub lo chiede con una frase chiara la prima volta che servono.
- D-2 · Parlare con un'app aperta attraverso una porta locale (T9, T10).
  (a) Consigliata: mai attraverso un canale senza autenticazione
  (VectorCraft, FigCraft, LightCraft: qualsiasi programma della macchina
  potrebbe usarlo); un canale con token solo con le app che Fub ha avviato lui,
  scegliendo token e porta. Nessuna app, per quanto dice il passo, permette
  oggi di scegliere tutti e due (GridCraft prende il token da
  `GRIDCRAFT_CONTROL_TOKEN`, la porta non si sa): quindi «Apri con» usa
  l'istanza singola (PhotoCraft e PdfCraft su Linux e Windows) o un processo
  nuovo, e il canale resta pronto e provato con un'app finta. (b) Rinviare
  T9 finché un'app non documenta la porta. (c) Usare anche i canali senza
  autenticazione, dietro un'impostazione. Conseguenza: (c) apre una porta che
  chiunque sulla macchina può pilotare; (b) toglie un task e il canale.
  Risposta (2026-11-02): (a) — mai un canale senza autenticazione; il canale
  col token solo con un'app che Fub ha avviato lui.
- D-3 · Rinominare un file a cui punta un file Craft (T5). (a) Consigliata:
  la rinomina si fa, le note si aggiornano come oggi, e Fub dice «il disegno
  X punta ancora al vecchio nome» (Fub non riscrive i file Craft). (b) La
  rinomina si ferma finché il link c'è (com'è oggi per ogni file a byte con
  link). Conseguenza: con (b) una foto piazzata in un disegno non si può più
  rinominare da Fub.
  Risposta (2026-11-02): (a) — la rinomina si fa, e Fub dice quali file Craft
  puntano ancora al vecchio nome.
- D-4 · Gli strumenti MCP (T13). (a) Consigliata: `fub_open_with` vuole
  `apply: true` e il documento fra le radici di scrittura dell'agente (avvia
  un programma: è un'azione, non una lettura); senza `apply` dice che cosa
  farebbe. `fub_preview` dà l'anteprima che c'è (nel file o pronta) e non
  avvia mai la CLI. (b) `fub_open_with` anche con le sole radici di lettura.
  (c) `fub_preview` che avvia la CLI. Conseguenza: con (b) o (c) un agente
  può avviare programmi su un file che può solo leggere.
  Risposta (2026-11-02): (a) — `fub_open_with` vuole `apply` e le radici di
  scrittura; `fub_preview` non avvia mai un'app.
- D-5 · Gli XMP di LightCraft (T3, T14). (a) Consigliata: proprietà `rating`,
  `label`, `flag` e `tags`; una parola chiave con spazi diventa un tag col
  trattino («New York» → `#New-York`); i `.xmp` restano visibili nell'albero
  come file loro; nella scheda XMP la riga fissa su ⌘S e sulla scrittura
  automatica. (b) Gli spazi spezzano la parola in due tag. (c) Gli `.xmp`
  nascosti dall'albero, i dati mostrati solo sulla foto. Conseguenza: (c)
  vuole una scheda della foto che legge l'XMP accanto, cioè lavoro in più
  nella vista delle immagini.
  Risposta (2026-11-02): (d), un'opzione nuova — i tag col trattino come in
  (a); i dati dell'XMP si vedono anche sulla foto, nella vista delle
  immagini; un'impostazione nasconde gli `.xmp` dall'albero, dove per difetto
  restano visibili.
- D-6 · Il menu e il prestito (T16, T17). (a) Consigliata: il sottomenu
  prende il posto della voce «Apri con un'altra app», con le app non
  installate visibili ma spente, e compare solo se c'è almeno un'app Craft
  installata; la voce della barra dei media («Apri con l'applicazione esterna») si
  allinea al nome «Apri con un'altra app»; il prestito vale per le app Craft e
  finisce con «Riprendi qui» o chiudendo la scheda. (b) Le app non installate
  nascoste. (c) Due voci: «Apri con un'altra app» com'è oggi e «Apri con…»
  per le app Craft. Conseguenza: (c) aggiunge una voce al menu delle note, che
  ne ha già nove, il massimo che la shell si dà.
  Risposta (2026-11-02): (a) — il sottomenu al posto della voce, le app non
  installate visibili ma spente, il prestito come è scritto.
- D-7 · Dove si vede e come si spegne (T6, T14). (a) Consigliata: niente
  miniature nell'albero; il componente «File delle app Craft» nel gruppo dei
  disegni, acceso; spegnerlo toglie anteprime, schede e le app Craft da «Apri
  con», mentre la ricerca e i backlink dei file Craft restano (sono del
  formato, non del componente). (b) Miniature nell'albero. (c) Spegnere il
  componente toglie anche i formati. Conseguenza: (b) vuole un'anteprima per
  ogni riga dell'albero, cioè molte letture di file quando si apre una
  cartella; (c) vuole una cargo feature per i formati e una per il resto.
  Risposta (2026-11-02): (d), un'opzione nuova — niente miniature per
  difetto, ma un'impostazione per accenderle; il componente resta acceso, e
  spegnerlo non toglie la ricerca e i link.
- D-8 · File molto grandi (T2, T6). (a) Consigliata: oltre 64 MiB niente
  anteprima né metadati (il file c'è, si cerca per nome, «Apri con» va).
  (b) Il limite più alto. Conseguenza: il kernel legge i file a byte in
  memoria; un limite più alto vuol dire più memoria a ogni indicizzazione.
  Risposta (2026-11-02): (c), un'opzione nuova — per l'anteprima Fub legge
  solo il pezzo del file che serve, dove il formato lo permette, formato per
  formato; i 64 MiB restano come rete di sicurezza per ciò che va letto
  intero, e diventano un'impostazione.
- D-9 · Che cosa resta fuori da N7. (a) Consigliata: LightCraft entra con
  gli XMP e «Apri con» (senza `library.import`); la copia `-Edit.psd` si vede
  nella scheda dell'XMP; restano fuori le anteprime dei RAW, la CLI di PdfCraft
  e WordCraft, il `.pcraft` a cartella e le anteprime DOCX e XLSX. (b)
  Dentro anche le anteprime dei PDF con PdfCraft. Conseguenza: (b) aggiunge
  una CLI e un formato già di Fub (i PDF hanno la loro vista) a T11.
  Risposta (2026-11-02): (c), un'opzione nuova — N7 comprende tutto:
  LightCraft con i dati e «Apri con», poi i RAW, poi le anteprime di PdfCraft
  e WordCraft, in task successivi; N7 si chiude quando ci sono tutti. Che
  cosa resta fuori lo chiede D-10.
- D-10 · Che cosa resta fuori anche dopo D-9 (c) (Fuori scope, T32).
  (a) Consigliata: cinque cose restano fuori da N7, ognuna per il piano di
  chi ne è padrone. Il `.pcraft` a cartella: vuole nel kernel i «pacchetti»,
  una cartella che è un documento solo per l'identità, la rinomina, il
  cestino e l'indice. Le anteprime dei fogli `.xlsx`: GridCraft non fa PNG,
  servirebbero due CLI in fila (GridCraft in PDF, poi PdfCraft), mentre Fub
  ha già il suo motore delle griglie. Le miniature delle immagini comuni
  nell'albero: vogliono una cache delle miniature per ogni immagine, che è
  dell'esplora, non di `fub.craft`. Le anteprime delle foto HEIC e TIFF,
  che la WebView non sa mostrare: la vista delle immagini lo dice già con
  parole chiare, e farle fare a LightCraft o a PhotoCraft è una scelta della
  vista delle immagini, non dei file Craft. I metadati per la ricerca dei
  file oltre 64 MiB: è il limite del kernel per ogni formato, non solo per i
  file Craft. (b) Come (a), ma il `.pcraft` a cartella entra come vista della
  shell: l'albero la mostra come una foto e la scheda legge `thumb.png` e
  `manifest.json` dentro, mentre per il kernel resta una cartella. (c) Come
  (a), ma anche il limite del kernel diventa un'impostazione. Conseguenza:
  con (b) una cosa che sembra un file si rinomina e si cestina come una
  cartella; con (c) cambia il kernel per tutti i formati, e più memoria a
  ogni indicizzazione.
  Risposta (2026-11-03): (a) — le cinque cose restano fuori da N7, ognuna
  per il piano di chi ne è padrone.

## Assunzioni

- A1 · Valgono le prime opzioni di D-1…D-9. **Cambiata (D-1…D-9,
  2026-11-02):** valgono le risposte dell'utente, scritte sotto ogni domanda;
  D-1 (b), D-5 (d), D-7 (d), D-8 (c) e D-9 (c) portano T18–T31; per D-10
  vale la (a).
- A2 · Formati presi dal passo: `.vectorcraft` è JSON, a volte gzip (inizia
  con `1f 8b`), e dalla versione 4 i blob stanno dopo `\n\0VCBLOBS\0`;
  l'anteprima è `/preview/data` in base64 (con o senza il prefisso
  `data:image/png;base64,`). `.pcraft` è uno ZIP (STORE o Deflate) con
  `manifest.json` (`format_version`), `thumb.png` e `composite/preview.png`.
  `.figcraft` è uno ZIP con `document.json` e `thumbnail.png`.
- A3 · I nomi dei campi che il passo non dice (il titolo, il testo, i file
  collegati) si leggono da più nomi possibili e la loro assenza non è un
  errore: `title` o `name` per il titolo; i testi da ogni campo `text`,
  `content` o `characters` di tipo stringa; i file collegati da ogni campo
  stringa `href`, `src`, `path`, `file`, `uri` o `link` che non è assoluto.
  Sono da confermare con file veri (sezione «Con file finti, con un'app
  vera»).
- A4 · Nessuna dipendenza esterna nuova: `zip` 9.0.5 (con `deflate`), `flate2`
  1.1.9, `quick-xml` 0.41.0, `base64` 0.22.1, `serde_json` e `tempfile` sono
  già nel workspace (prova 1).
- A5 · Fub non scrive mai un file Craft né un XMP: `serialize` risponde
  `FormatError::Unsupported`, `rewrite_links` resta quello di serie
  (`Ok(None)`), e la CLI lavora su una copia dei byte.
- A6 · I `FormatProvider` nuovi reclamano solo `vectorcraft`, `pcraft`,
  `figcraft` e `xmp`; le altre estensioni che le app aprono (`psd`, `pdf`,
  `xlsx`, `docx`…) restano di chi le ha, e servono solo a «Apri con».
- A7 · La scheda di N7 è una vista in sola lettura del bundle `fub.craft`;
  quando K5–K9 porteranno le modalità che modificano i file Craft, quelle
  prenderanno l'estensione e la vista resterà per i file senza modalità.
- A8 · I programmi esterni si avviano con argomenti separati, mai attraverso
  una shell, mai con argomenti costruiti come una stringa; solo dal core
  (`fub-host`); ogni avvio passa dall'interruttore del componente.
  **Cambiata (D-1 (b)):** una CLI per un'anteprima parte in più solo dopo un
  gesto (A13) e con il consenso acceso (T19).
- A9 · Le anteprime pronte stanno nella cache del bundle (`host.cache_write`,
  sotto `.fub/`): cancellarla non perde niente, si rifà. **Confermata (D-8
  (c)):** con il contratto 2 la cache della versione 1 si ignora e si rifà
  (A15).
- A10 · «Già aperta» vuol dire «avviata da Fub in questa sessione e non
  ancora uscita». Un'app aperta da sola, o passata a un'istanza singola, Fub
  non la vede: il prestito non finisce quando l'app si chiude. **Confermata
  (D-2 (a), D-6 (a)).**
- A11 · Le impostazioni delle app Craft sono di macchina (i percorsi dei
  programmi non viaggiano col vault), nel core di `fub-host`, accanto alle
  altre di macchina. **Confermata (D-1 (b), D-5 (d), D-7 (d), D-8 (c)):**
  anche le quattro nuove (il consenso, il peso massimo, le miniature, gli XMP
  nell'albero) sono di macchina, come `files.auto-reveal`; il consenso in più
  non è `program_writable`, come i permessi: un vault importato o un plugin
  non possono accenderlo.
- A12 · I test che avviano processi sono solo per unix (`#[cfg(unix)]`, script
  `/bin/sh` scritti dal test); i percorsi di Windows e macOS sono scritti ma
  non provati.
- A13 · Il gesto (D-1 (b)). Fub avvia la CLI di un'app solo per un file su
  cui chi usa Fub ha appena fatto un gesto nella shell principale: l'ha
  aperto con un clic o un tasto (albero, ricerca, link in una nota, figura,
  «Apri» del menu), o ha premuto «Crea l'anteprima» o «Sì, accendi». Non
  sono gesti: una scheda riaperta all'avvio, un link `fub://`, la vista di un
  plugin, l'MCP, la CLI di Fub, una nota che incorpora il file, il passaggio
  del puntatore, l'albero. Il gesto lo sa solo la shell, che vede l'input:
  per questo l'host fa valere tutto il resto (il consenso, un comando IPC
  riservato alla shell principale, il biglietto del job: T11, T12), e un
  errore della shell sul gesto non apre mai la porta ai plugin o all'MCP.
- A14 · Le letture a pezzi (D-8 (c)) usano le lease del kernel che servono
  già il protocollo `fub-asset:` (`resource_open_on`, `resource_read_at`:
  ogni pezzo riverifica che il file non sia cambiato, e un file cambiato è
  `Stale`, mai byte mescolati). Nessuna porta nuova nell'ABI né nella WIT:
  è una superficie `pub(crate)` del core per `fub.craft`, come
  `search_data_dir` per la ricerca, sopra un lettore del kernel che tiene il
  `Vault` e non il lucchetto del workspace (T21), perché CLAUDE.md fa
  nascere un contratto pubblico solo quando i casi veri l'hanno provato.
- A15 · Il contratto `CraftPreview` passa alla versione 2 in un task solo
  (T20), con tutto ciò che le risposte cambiano nella forma; i task dopo lo
  riempiono senza toccarne la forma. La cache della versione 1 si ignora e
  si rifà.
- A16 · I RAW (D-9 (c)): la prima scelta è il JPEG che la fotocamera mette
  dentro il file, letto a pezzi; LightCraft solo se manca, col consenso. Le
  forme dei RAW (TIFF per CR2, NEF, ARW, DNG, ORF e RW2; ISO BMFF per il CR3;
  l'intestazione del RAF) le provano file costruiti dai test; i file veri di
  ogni marca sono in «Non verificato».
- A17 · PDF e documenti Word (D-9 (c)): Fub ha già le sue viste per questi
  file, quindi le anteprime di PdfCraft e WordCraft servono dove Fub mostra
  un'anteprima e non il file: l'albero, il PDF nella nota (un `.docx`
  incorporato mostra già il suo testo), il passaggio del puntatore, l'MCP. Un
  documento con la miniatura dentro (`docProps/thumbnail.*` di OOXML,
  `Thumbnails/thumbnail.png` di ODF) non avvia WordCraft.

## Il contratto `CraftPreview`

Una forma sola, scritta in Rust in `crates/fub-format-craft/src/contract.rs`,
specchiata in TypeScript in `apps/client/src/host/craft.ts`, e letta dal
bundle (T6), dalla shell (T14–T15) e dall'MCP (T13). T1 l'ha scritta nella
versione 1; T20 la porta alla versione 2, quella qui sotto, con tutto ciò che
le risposte cambiano (A15). La pagina che la descrive è
`docs/reference/craft-formats.md`; le prove di conformità sono
`crates/fub-format-craft/tests/ts_preview.rs` (la fixture) e
`apps/client/src/host/craft.test.ts` (il lettore).

```json
{
  "version": 2,
  "doc": "Foto/IMG_0001.CR3",
  "revision": null,
  "size": "large",
  "origin": "file",
  "queued": false,
  "image": {
    "media_type": "image/jpeg", "data": "<base64>",
    "width": 1620, "height": 1080, "orientation": 6
  },
  "missing": null,
  "limit_bytes": null,
  "info": {
    "app": "raw",
    "editor": "LightCraft",
    "format_version": null,
    "bytes": 31457280,
    "photo": null,
    "edits": [],
    "xmp": null
  },
  "render": null
}
```

- `size`: `"small"` (la figura nella nota, l'anteprima al passaggio,
  l'albero) o `"large"` (la scheda).
- `origin`: `"file"` (l'anteprima era nel file), `"cli"` (l'ha fatta l'app),
  `"none"` (non c'è).
- `queued`: `true` solo nella risposta di `craft_render` (T11) che ha messo in
  coda il job `craft.render`; `craft.preview` non mette mai in coda niente.
- `image`: `null` o l'immagine. `media_type` è `"image/png"` o
  `"image/jpeg"`; `width` e `height` vengono dall'immagine (l'`IHDR` del PNG,
  il segmento `SOF` del JPEG), non dal file che la contiene; `orientation` è
  l'orientamento EXIF da 1 a 8 che la shell applica (1 vuol dire «così
  com'è»; un RAW lo dice nel suo IFD0, perché il JPEG dentro di solito non lo
  porta).
- `revision`: la revisione dei byte da cui l'anteprima è nata (la stessa di
  `document_revision`), o `null` quando Fub ha letto solo dei pezzi del file
  (un'anteprima dentro uno ZIP, un RAW, un `.docx`: T22, T27, T30): senza
  leggere tutti i byte non ne sa l'impronta, e leggerli tutti per saperla
  toglierebbe il senso delle letture a pezzi. Una risposta senza revisione
  non va in cache (rileggere l'indice costa poco) e per la shell vale come
  appena letta.
- `missing`: `null` quando `image` c'è; altrimenti perché manca:
  `"absent"` (il file non ne ha una), `"over_limit"` (andrebbe letto intero
  e supera il peso massimo, T19 e T22), `"unreadable"` (il file è rotto o
  non è del formato che dice), `"failed"` (l'app ha provato per questa
  revisione e non ci è riuscita). La shell dice la frase da qui e non rifà
  il conto del peso (oggi lo rifà con un gemello di `MAX_FILE_BYTES` in
  `editors/craft/surface.ts`, che T20 toglie).
- `limit_bytes`: `null`, o il peso massimo in byte quando `missing` è
  `"over_limit"`, perché la frase lo dica.
- `info.app`: `vectorcraft`, `photocraft`, `figcraft`, `xmp`, e in più `raw`
  (LightCraft), `pdf` (PdfCraft), `document` (WordCraft). È un'enum del
  contratto, `PreviewSubject`, separata da `CraftApp`, che resta quella dei
  quattro provider. `info.editor` il nome da mostrare; `info.format_version`
  stringa o `null`; `info.bytes` il peso del file.
- `info.photo`: per un XMP, la foto a cui appartiene se c'è nel vault
  (`"Foto/IMG_0001.CR3"`), altrimenti `null`. `info.edits`: le copie
  `-Edit.psd` che esistono. `info.xmp`: `null` o
  `{ "rating", "label", "flag", "keywords" }` come li legge T3.
- `render`: `null`, o `{ "app": "VectorCraft", "consent": "ask" }` quando
  l'anteprima manca, l'app che sa farla è installata e il file non supera il
  peso massimo. `consent` è il valore di `craft.cli-previews` (`"ask"`,
  `"on"`, `"off"`, T19): la shell sceglie fra la domanda, il pulsante e la
  riga «spente» senza leggere le impostazioni per conto suo.
- La cache: `previews/{:016x}.json`, con la chiave FNV-1a a 64 bit di
  `"{revision}\0{size}"`, come `link_card::cache_path`; si scrive solo con
  una revisione e per `origin` `file` e `cli`, e si legge solo se è della
  versione 2 e dello stesso `doc`. Una revisione nuova è una chiave nuova: la
  cache vecchia resta finché la cache del bundle non si pulisce.
- Da dove viene la revisione (T21): un file letto intero la calcola sugli
  stessi pezzi che legge, con `fub_abi::RevisionHasher`, come il kernel; per
  cercare in cache l'anteprima fatta dalla CLI, `ranged::revision` legge il
  file a pezzi (al più il peso massimo) e la ricorda finché la lease del
  kernel dice che il file è lo stesso (identità, `stat`, timbro di
  cambiamento). Il kernel tiene vuota la revisione delle sue lease
  (`workspace.rs`, riga 6343: un'impronta presa dall'anagrafe non è sempre
  quella dei byte), e il piano non la prende da lì.
- Il comando `craft.preview { doc, size }`: in sola lettura, effetto
  `CommandEffect::Custom { ns: "fub.craft", payload }` col `CraftPreview`.
  Non avvia mai niente: un `render` nella domanda (la forma della versione
  1) si ignora, e un test lo prova.
- Il comando `craft.photo { doc }` (T24): per una foto, l'XMP che le sta
  accanto e i suoi dati, in sola lettura:
  `{ "version": 2, "doc", "xmp": "Foto/IMG_0001.CR3.xmp" | null,
  "meta": { "rating", "label", "flag", "keywords" } | null, "edits": [] }`
  (`PhotoSidecar` in Rust, `readPhotoSidecar` in TypeScript).
- `craft_render` (T11, T12) non è un comando del bundle: è un metodo di
  `Host` e un comando IPC della sola shell principale; risponde col
  `CraftPreview` e `queued: true`, e il risultato arriva come `job_done` del
  job `craft.render`.

## I limiti

| Che cosa | Limite | Dove |
|---|---|---|
| Un file da leggere intero (indicizzare, il JSON di VectorCraft, la copia per la CLI) | 64 MiB; per l'anteprima è l'impostazione `craft.preview-max-mib` (da 1 a 4096) | T2, T21 |
| Un file letto a pezzi (ZIP, RAW) | nessuno: si leggono solo l'indice e la voce | T21, T22, T27, T30 |
| La directory centrale di uno ZIP letto a pezzi | 4 MiB, letta dopo l'EOCD | T22 |
| Un'anteprima nel file (PNG o JPEG) | 8 MiB | T2, T27, T30 |
| Voci di uno ZIP | 10 000 | T2, T22 |
| Un RAW: IFD seguiti, voci per IFD, scatole BMFF annidate | 16, 1000, 8 livelli | T27 |
| Testo per la ricerca | 64 KiB | T2 |
| File collegati per documento | 1000 | T4 |
| Parole chiave di un XMP | 500 | T3 |
| Una CLI: tempo | 20 s | T8, T11 |
| Una CLI: PNG scritto | 16 MiB | T8, T11 |
| Una CLI: stdout e stderr tenuti | 64 KiB ciascuno | T8 |
| Il job che aspetta la CLI guarda l'annullamento | ogni ~100 ms | T8, T11 |
| Un biglietto di `craft_render` | un uso, 60 s | T11 |
| Miniature dell'albero chieste insieme | 2 in volo, solo le righe in vista | T26 |

## Le app che Fub conosce

La tabella in Rust di T7 (`crates/fub-host/src/craft/editors.rs`), dal passo.
Il programma con l'interfaccia è `<id>`, quello senza `<id>-cli`.

| id | Nome | Apre | Anteprima con la CLI (T11) | Istanza singola | Canale |
|---|---|---|---|---|---|
| `vectorcraft` | VectorCraft | `vectorcraft`, `drawcraft`, `svg`, `ai`, `eps`, `pdf` | `convert {in} {out} --scale 0.25` | no | `app.open`, senza autenticazione: mai |
| `photocraft` | PhotoCraft | `pcraft`, `psd`, `psb`, `tif`, `tiff`, `png`, `jpg`, `jpeg`, `kra`, `xcf`, `ora` | `convert {in} {out}` | Linux, Windows | `app.open`, token |
| `lightcraft` | LightCraft | `cr3`, `cr2`, `nef`, `arw`, `raf`, `dng`, `orf`, `rw2`, `heic`, `jpg`, `jpeg` | `render {in} -o {out} --size 512` (T29; `--size 2048` per `large`) | no | senza autenticazione: mai |
| `pdfcraft` | PdfCraft | `pdf` | `render {in} --page 1 --dpi 36 --out {out}` (T29; `--dpi 144` per `large`) | Linux, Windows | `ui.open` JSON-RPC 2.0, token |
| `figcraft` | FigCraft | `figcraft`, `fig` | `render {in} -o {out}` | no | senza autenticazione: mai |
| `gridcraft` | GridCraft | `xlsx`, `csv`, `tsv` | nessuna: non fa PNG (D-10) | no | `app.open`, token da `GRIDCRAFT_CONTROL_TOKEN`, porta non nota |
| `wordcraft` | WordCraft | `docx`, `odt`, `rtf`, `doc` | `render {in} {out} --page 1 --scale 0.5` (T29; `--scale 1` per `large`) | no | `engine.execute`, «chiave»: formato non noto, mai |

`{in}` e `{out}` sono percorsi assoluti in una cartella privata (T11), passati
come argomenti separati. Gli argomenti di LightCraft, PdfCraft e WordCraft
vengono dal passo 12c; le misure per `large` le sceglie il piano (il passo
dà solo quelle piccole) e sono in «Non verificato».

## Prove fatte

1. **Le dipendenze del repo bastano** (prova usa e getta in
   `/home/fubeo/.cache/fub-k1/tmp/n7`, cancellata). Con `zip` 9.0.5 (feature
   `deflate`), `flate2` 1.1.9, `quick-xml` 0.41.0, `base64` 0.22.1 e
   `serde_json`, tutti già nel workspace: si legge uno ZIP con voci in STORE
   e in Deflate (`by_name`, `size()` prima di leggere, `take`); si scompatta un
   JSON gzip e lo si taglia a `\n\0VCBLOBS\0`; si decodifica il base64 di
   `/preview/data` e si leggono le misure dall'`IHDR`; si legge un XMP con
   voto ed etichetta come attributi e le parole chiave in `rdf:Bag/rdf:li`.
   In quick-xml 0.41 le entità arrivano come evento a parte
   (`Event::GeneralRef`), non dentro `Event::Text`: un `&amp;` in una parola
   chiave va ricomposto (T3).
2. **La rinomina oggi.** `invoke_prepared_link_rewrites`
   (`crates/fub-kernel/src/workspace.rs`, riga 1129) restituisce un errore
   `FormatError::Parse("il formato di … non offre la riscrittura dei link")`
   quando la sorgente da riscrivere non ha un provider o non sa riscrivere:
   un file a byte con un link verso il file rinominato ferma la rinomina
   (T5).
3. **I presidi che mordono** (letti, non lanciati): `check-doc-size.mjs`
   (riferimento 550 righe, il resto 450; `docs/reference/on-disk-layout.md` è
   a 549, `docs/product/vault-and-files.md`, `editor-and-preview.md` e
   `search-links-and-graph.md` a 449: non ci si aggiunge niente);
   `check-error-literals.mjs` è un cricchetto esatto (`fub-host` 377,
   `fub-kernel` 165, `fub-app` 88, `fub-features` 80): il codice nuovo non
   scrive `PluginError::X("…")` né `PluginError::X(format!(…))`;
   `check-cargo-feature-default.mjs` vuole ogni cargo feature raggiungibile
   dal `default`.

## Con file finti, con un'app vera

| Che cosa | Con file finti nei test | Serve un'app vera |
|---|---|---|
| Leggere i tre contenitori, l'anteprima, i limiti | sì, costruiti dal test con `zip`, `flate2`, `base64` (T2) | i nomi veri dei campi (A3) |
| Gli XMP | sì, scritti a mano come li descrive il passo (T3) | un XMP vero di LightCraft, coi suoi namespace |
| I file collegati e i backlink | sì (T4, T6) | il campo vero che VectorCraft usa per una foto piazzata |
| Rilevare le app | sì, con cartelle finte e un ambiente iniettato (T7) | `installed.json` vero del launcher, Flatpak, AppImage |
| Avviare un programma, la CLI, i limiti | sì, con script `/bin/sh` che fanno da app (T8, T10, T11) | gli argomenti veri delle CLI |
| Il canale di controllo | sì, con un `TcpListener` finto (T9) | il formato vero dell'autenticazione, la porta |
| L'istanza singola | no (lo fa l'app) | PhotoCraft o PdfCraft aperte |
| Il prestito senza perdite | sì, nella shell con l'host finto (T17) | GridCraft che salva un `.xlsx` aperto in Fub |
| Le letture a pezzi | sì, con file sparsi di 1 GiB e un lettore che conta i byte (T21, T22) | — |
| I RAW | sì, file costruiti dal test (T27) | un RAW vero di ogni marca |
| Le miniature dei documenti | sì, `.docx` e `.odt` costruiti dal test (T30) | un documento salvato da Word e da LibreOffice |
| Il gesto e il consenso | sì, con l'host finto che conta `craftRender` (T23, T31) e gli script che contano le chiamate (T11, T13, T29) | — |
| Windows e macOS | no | una macchina con quel sistema |

## Differenze dal passo 12c

- `DocumentSource::bytes()` non è un `Option` e non esiste
  `FormatError::unsupported(..)`: l'errore è
  `FormatError::Unsupported { format, got: SourceKind::Text }`.
- Niente `editors.toml`: il registro è una tabella Rust (il workspace non ha
  un lettore TOML fra le dipendenze, e una tabella si controlla col
  compilatore).
- Lo schizzo degli XMP usa `Event::Text` per le entità: in quick-xml 0.41
  arrivano come `Event::GeneralRef` (prova 1).
- `xmp.rs` sta nel crate dei formati (`fub-format-craft`), non in
  `fub-features/src/photos/` (che non esiste): l'XMP è un formato.
- Oggi una sorgente a byte con un link verso il file rinominato ferma la
  rinomina (prova 2): T5 la fa procedere con un avviso.
- Non esiste un permesso per avviare programmi, e nessun bundle li avvia:
  `fub-host` non avvia processi, `fub-app` sì (`reveal.rs`, «Apri con
  un'altra app»). «Apri con» passa per l'IPC e per il canale MCP (`Call`),
  non per un comando `fub.open_with` di un bundle (D-1).
- La voce della barra dei media si chiama «Apri con l'applicazione esterna»
  (`media.open_external`), contro il nome «Apri con un'altra app» del menu:
  T16 le allinea.
- La mappa dei componenti vuole per un bundle nuovo una riga, una cargo
  feature e i test che le confrontano (T6).
- Le impostazioni di macchina stanno nel core di `fub-host`; le frasi di un
  bundle stanno nel suo catalogo, non nella shell.
- Il menu delle note ha già nove voci, il massimo: «Apri con» non può essere
  una voce in più (D-6).
- «Il prestito finisce quando l'app si chiude» non si può fare: un'app a
  istanza singola passa il file e il processo avviato esce subito, e un'app
  aperta da sola Fub non la vede (A10).
- Per PhotoCraft il passo dice che `app.open` vuole un percorso «relativo
  alla radice di lettura»: non è chiaro quale. Non serve: PhotoCraft ha
  l'istanza singola, e Fub usa quella.
- Il quarto punto del cancello («con l'app già aperta, il file va in quella
  finestra») vale solo per le app a istanza singola (PhotoCraft e PdfCraft su
  Linux e Windows); per le altre Fub apre un processo nuovo (D-2).
- I presidi su nomi, FNV, entità HTML, errori letterali e pagine piene
  impongono vincoli che il passo non vede: sono nelle regole qui sotto.

Fra il piano e il codice dei task fatti (letto il 2026-11-02 su `a04094f5`;
vince il codice, e i task nuovi partono da qui):

- `craft::preview::preview` prende `&mut dyn HostApi`, non `&dyn HostApi`
  (T6); sceglie il formato con `host.format_of(doc)` e `CraftApp::of_format`,
  quindi un file che non ha un provider Craft (un RAW, un PDF) oggi è
  `BadArgs` con la chiave `not_craft`: T20 lo allarga.
- `preview` riprova fino a tre volte (`ATTEMPTS`) quando il file cambia fra
  la revisione e la lettura, e prende il peso dall'elenco della cartella
  (`Folder::read`, a pagine di 500): una domanda per ogni riga dell'albero
  rileggerebbe la cartella intera ogni volta. T21 prende il peso dalla lease.
- `craft.preview` legge `render` e lo ignora (`let _render =
  args.flag("render", false)` in `craft/mod.rs`); il job `craft.render`
  risponde `Unserved` con la chiave `render.no_cli`, come T6 diceva.
- La shell rifà il conto del «troppo grande»: `CRAFT_MAX_FILE_BYTES` in
  `apps/client/src/editors/craft/surface.ts` è un gemello di
  `container::MAX_FILE_BYTES`, e `tooLarge` lo confronta con `info.bytes`.
  Una regola in due posti: T20 la toglie con `missing`.
- Il lettore TypeScript (`host/craft.ts`) rifiuta un `media_type` diverso da
  `image/png` e un `app` fuori dai quattro: col contratto 2 va cambiato nello
  stesso task (T20), o la shell non leggerebbe più niente.
- La scheda (T14) chiede `render: true` da sola una volta, a ogni montaggio
  (`autoAsked` in `surface.ts`), anche per una scheda riaperta all'avvio; la
  figura (T15) chiede `{ render: false }`. T23 cambia la prima; la seconda
  resta, con la firma nuova.
- `craft.cli-previews` è un interruttore acceso (`SettingSpec::toggle`, riga
  1140 di `settings.rs`; le frasi alle righe 1875 e 2455); nessuno lo legge
  ancora. T19 lo cambia in tre scelte.
- `editors.rs` (T7) ha `cli: Some(..)` per VectorCraft, PhotoCraft e
  FigCraft, `None` per le altre quattro: T29 ne accende tre.

Trovato scrivendo il prototipo (letto il 2026-11-03, stesso commit):

- La vista dello zoom (`editors/media/zoom-view.ts`) scrive in linea la
  trasformazione dell'immagine (`transformOf`, rotazione compresa): una
  classe della pelle che ruota l'immagine sarebbe sovrascritta. T28 passa
  l'orientamento alla vista; l'albero (T26) lo scrive allo stesso modo.
- Le righe d'avviso di un foglio (`.sheet-notice`) stanno in
  `skin/sheets.css`, non in `document.css`, e vanno già a capo: due azioni
  non chiedono CSS (T31).
- `controlFor` (`panels/settings-model.ts`) fa pulsanti affiancati solo con
  2–3 scelte di al più 18 lettere (`SEGMENTED_MAX_LABEL`): «Chiedi la prima
  volta» ne ha 21, e la scelta del consenso è una tendina (T19).
- `formatBytes` scrive «24.2 MiB», col punto e senza GB: la riga di un RAW
  segue quella di un file Craft (T28).
- `fileRow` in `panels/explorer.ts` dà a un RAW 📎 (`FILE_ICONS.other`):
  T26 gli dà l'icona delle foto.
- La figura di un file Craft (T15, `figure.craft-figure`) non ha CSS né
  anatomia: prende le regole delle figure di K10, col nome al centro della
  colonna anche quando l'immagine è stretta. T31 la fa larga quanto
  l'immagine.

## Cancello di N7

| Fatto quando | Prova | Task |
|---|---|---|
| un file di ogni formato Craft ha anteprima, metadati e «Apri con»; Fub non lo scrive (byte uguali prima e dopo) | `crates/fub-host/tests/craft.rs`, `craft_open_with.rs`; la foto dal banco della scheda | T6, T10, T14 |
| un file collegato dentro un documento Craft mostra il backlink | `crates/fub-format-craft/tests/linked.rs`, il backlink in `crates/fub-host/tests/craft.rs` | T4, T6 |
| le parole chiave scritte da LightCraft sono tag e si cercano | `crates/fub-format-craft/tests/xmp.rs`, la domanda `IndexQuery::Tags` in `crates/fub-host/tests/craft.rs` | T3, T6 |
| con l'app già aperta, «Apri con» porta il file in quella finestra | `craft_open_with.rs` prova che l'istanza singola dà `forwarded`; il resto lo prova l'utente con PhotoCraft o PdfCraft | T10 e l'utente |
| aprire un `.xlsx` in GridCraft mentre è aperto in Fub non perde modifiche | `apps/client/src/state/lend.test.ts`; con GridCraft vera lo prova l'utente | T17 e l'utente |
| nessuna app parte senza un gesto e senza il consenso: un plugin, l'MCP (`fub_invoke`, `fub_preview`), `Call::InvokeJob`, una nota, il passaggio del puntatore, l'albero, una scheda riaperta e un link `fub://` non avviano niente; con «Chiedi la prima volta» la scheda chiede, e la scelta si salva | `crates/fub-host/tests/craft_cli.rs`, `crates/fub-cli/tests/mcp.rs`, `crates/fub-app/tests/ipc_permissions.rs`, `apps/client/src/editors/craft/consent.test.ts`; le foto dal banco della domanda | T11, T12, T13, T19, T23 |
| l'anteprima di un file grande legge solo il pezzo che serve: un `.pcraft` di 1 GiB dà la sua `thumb.png` leggendo meno di 1 MiB; oltre il peso massimo, ciò che va letto intero dice perché manca | `crates/fub-host/tests/craft_ranged.rs`, `crates/fub-format-craft/tests/containers.rs` | T21, T22 |
| una foto RAW mostra il JPEG che ha dentro, dritto, con i dati del suo XMP; senza JPEG e con LightCraft e il consenso, l'anteprima di LightCraft | `crates/fub-format-craft/tests/raw.rs`, `crates/fub-host/tests/craft_cli.rs`, `apps/client/src/editors/media/zoom-view.test.ts`; la foto dal banco della scheda di un RAW | T27, T28, T29 |
| i dati dell'XMP si vedono sulla foto, e con l'impostazione gli `.xmp` spariscono dall'albero ma non dalla ricerca | `crates/fub-host/tests/craft.rs` (`craft.photo`), `apps/client/src/editors/craft/photo-data.test.ts`, `apps/client/src/panels/explorer-craft.test.ts` | T24, T25, T26 |
| un PDF e un documento Word hanno un'anteprima (la miniatura dentro, o PdfCraft e WordCraft col consenso) e il PDF nella nota la mostra | `crates/fub-format-craft/tests/office.rs`, `crates/fub-host/tests/craft_cli.rs`, `apps/client/src/editors/craft/figure.test.ts`; la foto dal banco della nota | T29, T30, T31 |
| con «Miniature nell'albero» accese l'albero mostra le anteprime che ci sono, e non avvia niente | `apps/client/src/panels/explorer-craft.test.ts`; la foto dal banco dell'albero | T26 |
| la PR è pronta, la CI completa è verde, la revisione è scritta nella PR e l'utente ha detto sì al merge | `gh pr checks 299` | T32 |

## Regole che valgono per ogni task

- Vince il codice: se un percorso, una funzione o un numero di riga non è come
  scritto qui, il coder lo dice nel suo rapporto e segue il codice. I numeri
  di riga sono quelli di `620f0acd`.
- Nessuna dipendenza esterna nuova, né in Rust né in npm.
- Niente `unwrap`, `expect` o `panic!` nei sorgenti Rust fuori dai test; ogni
  errore è un `Result`. Gli errori dei moduli nuovi sono enum senza testi;
  il testo per chi guarda passa da una chiave del catalogo (`Text::key`,
  `Text::message`). Mai `PluginError::X("…")` né
  `PluginError::X(format!(…))`: `check-error-literals.mjs` è un cricchetto
  esatto.
- Ogni file è input ostile: misure controllate prima di leggere, letture con
  un tetto (`take`), nessuna allocazione decisa da un numero scritto nel
  file.
- Ogni funzione di produzione che piega il caso (`to_lowercase`,
  `eq_ignore_ascii_case`…) vuole una riga in `rules()` di
  `crates/fub-abi/tests/a_named_rule_is_declared.rs`, con la famiglia e la
  ragione. Il piano ne chiede due: in T7 (le estensioni di «Apri con») e in
  T20 (le estensioni dei soggetti dell'anteprima, `IMG_0001.CR3`); altrove i
  nomi si confrontano così come sono.
- L'HTML si scrive con `fub_abi::html::{escape, attr}`, mai a mano.
- Testi della shell in `apps/client/src/i18n/catalog.ts`, con la chiave in
  tutte le lingue; testi del bundle nel catalogo del bundle; testi del core in
  `core_catalog` di `crates/fub-host/src/settings.rs` (italiano e inglese).
- Ascoltatori e timer della shell passano da una `Lifetime`
  (`ui/lifetime.ts`); il TypeScript non scrive `var(--ruolo)`
  (`check-inline-theme.mjs`).
- Le pagine di `docs/` sono in italiano, restano nei limiti di
  `check-doc-size.mjs` (riferimento 550 righe, il resto 450,
  `docs/README.md` 150) e non dicono «oggi», «al momento», «questo commit».
  Una pagina nuova è linkata da `docs/README.md`.
- Quando cambia `Cargo.toml` o `Cargo.lock` della radice (T1, T6),
  `scripts/check.sh --rapido` controlla tutto il workspace: è lento, è giusto.
- La macchina è condivisa: niente build in `/tmp`; `TMPDIR` sotto
  `~/.cache/fub-k1/tmp/`.
- Mai il vault vero (`~/.cache/fub-live/`), mai `~/Progetti/Fub`.
- Un test che avvia uno script scrive il pid dello script in un file e alla
  fine controlla con `kill -0` che non sia vivo; mai `pgrep -f` né
  `pkill -f`, che sulla macchina condivisa prendono i processi degli altri.
- Due task della stessa ondata che scrivono in `apps/client/src/i18n/catalog.ts`,
  in `core_catalog`, in `apps/client/bench/scene.mjs` o nella stessa pagina
  di `docs/` aggiungono le loro righe
  ognuno nel suo punto (accanto alle chiavi o nella sezione che il task
  nomina), mai riordinando quelle degli altri; l'orchestratore li integra uno
  alla volta.

## T1 · Il crate e il contratto

Perché: gli id dei formati, la tabella delle app e la forma dell'anteprima li
leggono il kernel, l'host, la shell e l'MCP: vengono prima di chi li usa, e
con loro il crate in cui stanno.
Tocca: `crates/fub-format-craft/` (nuovo): `Cargo.toml`, `src/lib.rs`,
`src/apps.rs`, `src/contract.rs`, `src/provider.rs`, e gli scheletri
`src/container.rs`, `src/xmp.rs`, `src/linked.rs` (solo le firme, che T2, T3 e
T4 riempiono); `crates/fub-format-craft/tests/provider.rs` (nuovo),
`crates/fub-format-craft/tests/ts_preview.rs` (nuovo);
`apps/client/src/__fixtures__/craft-preview.json` (nuovo, generato);
`apps/client/src/host/craft.ts` (nuovo), `apps/client/src/host/craft.test.ts`
(nuovo); `Cargo.toml` della radice (il membro e la dipendenza del workspace),
`Cargo.lock`; `docs/architecture/overview.md` (il nodo del crate),
`docs/map/repo.md` (riga 51, l'elenco dei formati),
`docs/architecture/components-and-boundaries.md`,
`docs/getting-started/repository-tour.md`, `docs/README.md` (i link alle
quattro pagine nuove); `docs/reference/craft-formats.md` (nuovo),
`docs/reference/xmp-sidecars.md` (nuovo), `docs/reference/external-editors.md`
(nuovo), `docs/product/craft-files.md` (nuovo).
Non toccare: `crates/fub-host` (il provider non si monta ancora: lo monta T6);
`apps/client/src/ui/format-kind.ts` e il resto della shell (T14);
`crates/fub-abi` (nessun tipo nuovo nell'ABI: il contratto è del crate dei
formati); le pagine piene (`docs/product/vault-and-files.md`,
`editor-and-preview.md`, `search-links-and-graph.md`,
`docs/reference/on-disk-layout.md`).
Dipende da: nessuno
Cosa fare:
- `Cargo.toml` del crate come quello di `crates/fub-format-svg`
  (`version`, `edition`, `license`, `rust-version` dal workspace, una
  `description` in italiano). Dipendenze, tutte `{ workspace = true }`:
  `fub-abi`, `serde`, `serde_json`, `zip`, `flate2`, `quick-xml`, `base64`;
  fra le `dev-dependencies` `fub-sdk`. Nella radice: il membro
  `"crates/fub-format-craft"` dopo `"crates/fub-format-xlsx"` (riga 22) e
  `fub-format-craft = { path = "crates/fub-format-craft", version = "0.1.0" }`
  accanto a `fub-format-svg` (riga 164). `Cargo.lock` lo aggiorna cargo: non
  entra nessun pacchetto esterno nuovo.
- `src/apps.rs`: `pub enum CraftApp { VectorCraft, PhotoCraft, FigCraft, Xmp }`
  con `ALL`, `format_id()`, `name()`, `extensions()`, `editor()` (l'id
  dell'editor esterno: `vectorcraft`, `photocraft`, `figcraft`; `lightcraft`
  per gli XMP) e `pub fn of_format(id: &str) -> Option<CraftApp>`. Le costanti:
  `VECTORCRAFT_FORMAT_ID = "craft-vectorcraft"` (estensione `vectorcraft`),
  `PHOTOCRAFT_FORMAT_ID = "craft-photocraft"` (`pcraft`),
  `FIGCRAFT_FORMAT_ID = "craft-figcraft"` (`figcraft`),
  `XMP_FORMAT_ID = "craft-xmp"` (`xmp`).
- `src/contract.rs`: la forma della sezione «Il contratto `CraftPreview`»,
  con `serde` (`rename_all = "snake_case"` dove serve perché i nomi JSON siano
  quelli scritti): `CraftPreview`, `PreviewSize { Small, Large }`,
  `PreviewOrigin { File, Cli, None }`, `PreviewImage`, `PreviewInfo`,
  `XmpInfo`, `RenderOffer`. `pub const PREVIEW_VERSION: u32 = 1`, le costanti
  `PREVIEW_COMMAND = "craft.preview"`, `RENDER_JOB = "craft.render"`,
  `BUNDLE_NS = "fub.craft"`. `PreviewImage::from_png(bytes: &[u8]) ->
  Option<PreviewImage>`: controlla la firma PNG, prende le misure da
  `container::png_size` e codifica in base64. `pub fn cache_key(revision: &str,
  size: PreviewSize) -> String` dà `previews/{:016x}.json`, con FNV-1a a 64
  bit scritto come in `crates/fub-host/src/link_card.rs` (`cache_path`).
- `src/provider.rs`: `pub struct CraftProvider { app }`,
  `CraftProvider::boxed(app)` e `pub fn providers() -> Vec<Box<dyn
  FormatProvider>>` (i quattro). `descriptor`: id, nome, estensione,
  `SourceKind::Bytes`. `capabilities`: `FormatCapabilities::of(&[])`.
  `parse`: per `Xmp` `xmp::document_model(ctx, bytes)`; per gli altri
  `container::read_meta(app, bytes)` e il modello: titolo come metadato nel
  frontmatter (`title`, se il file lo dice), `text` dal contenitore, i link
  da `linked::collect(&json)` come `Link { target: LinkTarget::Path(p),
  embed: true, span: Span::EMPTY, context: None }`. Un file rotto o troppo
  grande dà un modello vuoto con il suo id, non un errore: il file resta nel
  vault e si trova per nome. `render_html`: `<figure class="fub-craft"
  data-embed-kind="craft" data-embed-doc="…" data-craft-app="…"><figcaption>
  nome del file</figcaption></figure>` (per un XMP `data-embed-kind="craft-xmp"`),
  scritto con `fub_abi::html::{escape, attr}`. `serialize`:
  `Err(FormatError::Unsupported { format, got: SourceKind::Text })`, come
  `crates/fub-format-xlsx/src/lib.rs` (riga 210). `rewrite_links` e
  `format_link` restano quelli di serie.
- Gli scheletri: `container::{Contents, read_meta, embedded_preview}`,
  `xmp::{PhotoMeta, read, document_model, photo_candidates, edit_copy_of}`,
  `linked::collect`, con le firme di T2, T3 e T4 e un corpo che dà il valore
  vuoto (`Contents::default()`, `None`, `Vec::new()`). In `container.rs`
  invece `pub struct Png { pub bytes: Vec<u8>, pub width: u32, pub height:
  u32 }` e `pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)>` sono già
  veri, perché li usa `PreviewImage::from_png`: la firma di 8 byte, poi il
  primo chunk lungo 13 e di tipo `IHDR`, larghezza e altezza big endian, non
  zero.
- `src/lib.rs`: il `//!` del crate (sola lettura: metadati, link,
  anteprima; mai il motore dell'app, mai una scrittura), i `pub mod` e le
  riesportazioni.
- `tests/provider.rs`: `fub_sdk::testing::conformance::a_format_respects_the_contract`
  sui quattro provider, come `crates/fub-format-xlsx/tests/provider.rs`; i
  descrittori (id, estensioni, `SourceKind::Bytes`); `serialize` rifiuta;
  `render_html` dà la figura con gli attributi e l'escape di un nome con `"`
  e `<`; byte a caso, vuoti o troncati danno un modello vuoto.
- `tests/ts_preview.rs`: come `crates/fub-format-xlsx/tests/ts_grid.rs`:
  scrive alcuni `CraftPreview` d'esempio (con immagine, senza, con `xmp`, con
  `render`, `queued`) in `apps/client/src/__fixtures__/craft-preview.json`, li
  confronta col committato, li rigenera con `UPDATE_MIRROR=1`.
- `apps/client/src/host/craft.ts`: le interfacce TypeScript del contratto e
  `readCraftPreview(value: unknown): CraftPreview | null`, che controlla ogni
  campo e rifiuta una `version` diversa da 1. `craft.test.ts` legge la
  fixture: ogni esempio passa e torna uguale; un campo mancante o di tipo
  sbagliato dà `null`.
- Docs: `craft-formats.md` (gli id, le estensioni, il contratto, i limiti),
  `xmp-sidecars.md`, `external-editors.md` e `craft-files.md` con il titolo e
  un paragrafo d'apertura che dice a che cosa servono (i task dopo aggiungono
  le loro sezioni); `docs/README.md` le linka. Nella mappa
  (`overview.md`: `craft["fub-format-craft"]` e `craft --> abi`;
  `docs/map/repo.md` riga 51; `components-and-boundaries.md`;
  `repository-tour.md`) il crate nuovo accanto agli altri formati.
Casi limite: un nome di file con `"`, `<`, `&` nella figura; un file di zero
byte; `of_format` con un id sconosciuto; un `CraftPreview` con `image: null`
e `render: null`; un JSON con un campo in più (il lettore TypeScript lo
ignora); `width` o `height` zero (`from_png` rifiuta); la fixture scritta su
una macchina con un'altra fine riga (si scrive con `\n`).
Fatto quando: `cargo test -p fub-format-craft --test provider --test
ts_preview` passa e la fixture è committata; `cd apps/client && npx vitest
run src/host/craft.test.ts` passa; `cargo test -p fub-abi --test
dependency_invariant` passa col crate nuovo; `cargo tree -p fub-format-craft
-e normal` non mostra pacchetti che `Cargo.lock` non avesse già.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft; cd
apps/client && npx vitest run src/host/craft.test.ts
Stato: [x] fatto
  Da rivedere: T20 lo cambia (D-1 (b), D-8 (c), D-9 (c)).

## T2 · I contenitori

Perché: i metadati e l'anteprima stanno dentro il file, in tre contenitori
diversi; leggerli senza il motore dell'app, con un tetto a ogni lettura, è
il cuore del formato.
Tocca: `crates/fub-format-craft/src/container.rs`,
`crates/fub-format-craft/tests/containers.rs` (nuovo),
`docs/reference/craft-formats.md` (sezione «Contenitori»).
Non toccare: `src/provider.rs` (usa già le firme di T1); `src/xmp.rs`,
`src/linked.rs` (T3, T4, in parallelo); `Cargo.toml` (le dipendenze ci
sono).
Dipende da: T1
Cosa fare:
- `pub struct Contents { pub format_version: Option<String>, pub title:
  Option<String>, pub text: String, pub json: Option<serde_json::Value> }`
  (`json` è il documento, che T4 attraversa per i file collegati).
- `pub fn read_meta(app: CraftApp, bytes: &[u8]) -> Result<Contents,
  ContainerError>`:
  - PhotoCraft: ZIP, `manifest.json`; `format_version` numero o stringa
    (diventa stringa); titolo da `title` o `name`.
  - FigCraft: ZIP, `document.json`; `format_version` da `format_version` o
    `version`; titolo da `title` o `name`; testo da ogni campo stringa
    `text`, `content` o `characters`.
  - VectorCraft: se comincia con `1f 8b` lo scompatta con
    `flate2::read::GzDecoder` e `take(MAX_JSON + 1)` (oltre: troppo grande);
    taglia al primo `\n\0VCBLOBS\0`; `serde_json::from_slice`; versione,
    titolo e testo come FigCraft.
  - Il testo si unisce con `\n` e si taglia a 64 KiB su un confine di
    carattere.
- `pub fn embedded_preview(app, bytes, size: PreviewSize) ->
  Result<Option<Png>, ContainerError>`: PhotoCraft `thumb.png` per `Small` e
  `composite/preview.png` per `Large`, ciascuna con l'altra come riserva;
  FigCraft `thumbnail.png` per le due misure; VectorCraft `/preview/data`
  (toglie un prefisso `data:…;base64,`, decodifica con `base64`, rifiuta una
  stringa più lunga di quanto 8 MiB diventano in base64).
- `Png` e `png_size` li ha scritti T1: `embedded_preview` li usa, e
  un'anteprima che non è un PNG è `None`.
- I limiti (sezione «I limiti»): sopra 64 MiB `ContainerError::TooLarge`
  senza aprire; più di 10 000 voci nello ZIP `TooLarge`; una voce si guarda
  con `size()` prima di leggerla e si legge con `take`; un JSON di una voce
  ZIP sopra 64 MiB `TooLarge`.
- `pub enum ContainerError { TooLarge, NotZip, NotJson, BadGzip, Missing }`,
  senza testi (`Debug`, `PartialEq`).
- `tests/containers.rs`: i file finti costruiti dal test con
  `zip::ZipWriter` (voci in STORE e in Deflate), `flate2::write::GzEncoder`,
  `base64` e un PNG minimo scritto a mano (firma, `IHDR`, `IEND`).
- «Contenitori» in `craft-formats.md`: che cosa si legge da ogni formato, le
  riserve, i limiti.
Casi limite: ZIP senza `manifest.json` (contenuti vuoti, non un errore);
voce dichiarata piccola che si scompatta grande (il `take` la ferma); gzip
troncato; `VCBLOBS` assente o all'inizio; JSON valido ma non un oggetto;
`/preview/data` vuoto, non base64, o un JPEG; PNG con `IHDR` corto; un
`.pcraft` che è una cartella (il kernel non lo dà come byte: fuori da N7); un
nome di voce con `../`; 10 001 voci; un file di 64 MiB e un byte.
Fatto quando: `cargo test -p fub-format-craft --test containers` copre ogni
caso limite qui sopra, e `--test provider` dà per un `.pcraft` finto il
titolo e la versione del manifesto.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft
Stato: [x] fatto
  Da rivedere: T22 lo cambia (D-8 (c)).

## T3 · Gli XMP

Perché: LightCraft scrive voto, etichetta, scelta e parole chiave in un XMP
accanto alla foto; letti, diventano proprietà e tag di Fub.
Tocca: `crates/fub-format-craft/src/xmp.rs`,
`crates/fub-format-craft/tests/xmp.rs` (nuovo),
`docs/reference/xmp-sidecars.md`.
Non toccare: `src/container.rs`, `src/linked.rs` (T2, T4, in parallelo);
`src/provider.rs`; `crates/fub-abi/src/rules/tag.rs` (la regola dei tag si
usa, non si cambia).
Dipende da: T1
Cosa fare:
- `pub struct PhotoMeta { pub rating: Option<i8>, pub label: Option<String>,
  pub flag: Option<Flag>, pub keywords: Vec<String> }`,
  `pub enum Flag { Pick, Reject }` (`lc:flag="none"` è `None`).
- `pub fn read(bytes: &[u8]) -> Result<PhotoMeta, XmpError>` con
  `quick_xml::Reader`, come lo schizzo del passo ma con quick-xml 0.41:
  voto, etichetta e scelta sia come attributi di `rdf:Description`
  (`xmp:Rating`, `xmp:Label`, `lc:flag`) sia come elementi
  (`<xmp:Rating>3</xmp:Rating>`); le parole chiave dai `rdf:li` dentro
  `dc:subject`, ricomponendo il testo dagli `Event::Text` e dagli
  `Event::GeneralRef` (le cinque entità predefinite e i riferimenti
  numerici; un'entità sconosciuta si salta). Il voto vale da -1 a 5,
  altrimenti `None`; l'etichetta si tiene se non è vuota e ha al massimo 64
  caratteri; al massimo 500 parole chiave, senza doppioni, nell'ordine del
  file.
- Mai leggere né riportare `crs:*` o `lc:settings`: non entrano nel modello.
- `pub fn document_model(ctx: &ParseContext, bytes: &[u8]) -> DocumentModel`:
  frontmatter con le sole chiavi presenti fra `rating`, `label`, `flag`
  (`"pick"`, `"reject"`) e `tags`; un tag è la parola chiave con i `#`
  iniziali tolti e ogni serie di spazi diventata `-` («New York» →
  `New-York`); i tag del modello sono `fub_abi::rules::tag::frontmatter_tags`
  di quel frontmatter, con `Span::EMPTY`, così la regola dei tag è una sola
  e una parola che non può essere un tag (con `&`, tutta cifre) resta solo
  nel testo; `text` sono le parole chiave e l'etichetta, una per riga. Un XMP
  rotto dà il modello vuoto.
- `pub fn photo_candidates(xmp_name: &str) -> PhotoMatch`: per
  `IMG_0001.CR3.xmp` (due estensioni) la foto è esattamente `IMG_0001.CR3`;
  per `IMG_0001.xmp` è un qualsiasi file accanto che si chiama `IMG_0001.<ext>`
  con `<ext>` diversa dall'estensione dell'XMP. Si toglie l'ultima estensione
  così com'è scritta, senza piegare il caso. `pub enum PhotoMatch {
  Exact(String), Stem(String) }`; chi guarda il vault (T6) sceglie.
- `pub fn edit_copy_of(photo: &str) -> String`: `IMG_0001.CR3` →
  `IMG_0001-Edit.psd`, il nome che PhotoCraft dà con «Modifica in
  PhotoCraft».
- `pub enum XmpError { NotXml, TooLarge }` senza testi; un XMP sopra 8 MiB
  non si legge.
- `tests/xmp.rs`: XMP scritti a mano come quelli di LightCraft (attributi,
  elementi, `rdf:Bag`), più i casi limite.
- `xmp-sidecars.md`: che cosa si legge, come diventa proprietà e tag, i due
  nomi, la copia `-Edit.psd`, che cosa Fub non tocca mai, e che LightCraft
  scrive l'XMP solo con ⌘S o con `autoWrite` acceso.
Casi limite: `&amp;` dentro una parola chiave; `<!DOCTYPE>` con un'entità
dichiarata (non si espande); un `rdf:li` fuori da `dc:subject` (si ignora);
voto `"5.0"`, `"6"`, `"-2"`; `lc:flag="none"`; 501 parole chiave; la stessa
parola due volte; parola chiave di soli spazi; `IMG.xmp` senza foto accanto;
`archivio.tar.xmp`; un XMP con il BOM; un XMP di zero byte.
Fatto quando: `cargo test -p fub-format-craft --test xmp` passa con tutti i
casi limite, e un XMP con `dc:subject` «New York», «mare» dà i tag
`New-York` e `mare` e il frontmatter `{ rating, label, flag, tags }`.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft
Stato: [x] fatto
  Da rivedere: T24 lo cambia (D-5 (d)).

## T4 · I file collegati

Perché: una foto piazzata in un disegno è un link del disegno; il kernel lo
risolve e la foto ha il backlink.
Tocca: `crates/fub-format-craft/src/linked.rs`,
`crates/fub-format-craft/tests/linked.rs` (nuovo),
`docs/product/craft-files.md` (sezione «File collegati»).
Non toccare: `src/container.rs`, `src/xmp.rs` (T2, T3, in parallelo);
`src/provider.rs` (mappa già i percorsi in `Link`); il kernel (risolve già un
`LinkTarget::Path` relativo con `resolve_against`,
`crates/fub-kernel/src/graph.rs` riga 817).
Dipende da: T1
Cosa fare:
- `pub fn collect(doc: &serde_json::Value) -> Vec<String>`: attraversa il
  JSON (oggetti e array, al massimo 64 livelli) e prende ogni valore stringa
  dei campi `href`, `src`, `path`, `file`, `uri` o `link` (A3).
- Tiene il percorso relativo così com'è scritto (il kernel lo risolve contro
  la cartella del documento) e scarta quelli assoluti o non di file: che
  cominciano con `/` o `\`, con una lettera e `:` (`C:`), con `file:`,
  `data:`, `http:`, `https:` o un altro schema `nome:`. Il modello da seguire
  è `crates/fub-format-svg/src/links.rs`.
- Al massimo 1000 percorsi, senza doppioni, nell'ordine in cui si trovano.
- `tests/linked.rs`: un JSON finto come un disegno con una foto piazzata
  (`{"layers":[{"type":"image","href":"../Foto/mare.jpg"}]}`), uno ZIP di
  FigCraft con `document.json`, e il provider che dà i `Link` con
  `embed: true`.
- «File collegati» in `craft-files.md`: un file piazzato diventa un link del
  documento e un backlink del file; Fub non cambia il file Craft quando il
  collegato si sposta (lo dice T5).
Casi limite: `href` vuoto; `href` con `#frammento` o `?query` (si toglie
la parte dopo `#` o `?`); un percorso con `%20`; `data:image/png;base64,…`;
un URL `https://`; `C:\Foto\a.jpg`; 1001 collegati; un JSON con 65 livelli;
un campo `src` che è un numero.
Fatto quando: `cargo test -p fub-format-craft --test linked` passa con i
casi limite; il modello di un disegno finto ha il `Link` verso
`../Foto/mare.jpg`.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft
Stato: [x] fatto

## T5 · La rinomina con i file a byte

Perché: oggi un file a byte che punta al file rinominato ferma la rinomina
(prova 2); con i file Craft che hanno link sarebbe la regola, non
l'eccezione (D-3).
Tocca: `crates/fub-kernel/src/workspace.rs`,
`crates/fub-kernel/tests/rename_and_events.rs`,
`docs/product/craft-files.md` (sezione «Rinominare»).
Non toccare: `crates/fub-format-craft` (il provider non riscrive niente);
`crates/fub-abi` (il default di `rewrite_links` resta `Ok(None)`); il
comportamento delle sorgenti di testo; `.github/scripts/check-error-literals.mjs`
(la soglia di `fub-kernel` non cambia: niente `PluginError` nuovi).
Dipende da: T4 (la stessa pagina)
Cosa fare:
- In `invoke_prepared_link_rewrites` (`workspace.rs`, riga 1129), per una
  sorgente con `prepared.source_kind == SourceKind::Bytes`: se il provider
  manca o `rewrite_links` dà `Ok(None)`, la sorgente si salta e lascia una
  riga `format!("{src}: un file a byte non si riscrive, il link punta ancora
  a {from}")`.
- Le righe finiscono nei `rewrite_failures` che ci sono già (righe 399 e 438,
  riempiti alle 1105 e 1495); l'esito è quello parziale che esiste,
  `Ok(Err(KernelError::LinkRewrite(failed.join("; "))))` (righe 8842-8860 e
  9061-9064): il file è rinominato, le note sono aggiornate, e chi ha chiesto
  la rinomina riceve l'avviso.
- Per farlo `invoke_prepared_link_rewrites` restituisce anche le righe
  saltate (per esempio `Result<(Vec<RenameRecoveryEdit>, Vec<String>)>`); i
  chiamanti alle righe 871, 1293 e 2704 le aggiungono ai loro
  `rewrite_failures`.
- Le sorgenti di testo senza riscrittura restano un errore, come oggi.
- `tests/rename_and_events.rs`: un provider di prova a byte (accanto a quello
  di riga 97) che dichiara un link verso `foto.png`; rinominare `foto.png`
  riesce, il file a byte ha gli stessi byte, la nota Markdown che puntava a
  `foto.png` è aggiornata, e l'esito porta la riga con i due nomi.
- «Rinominare» in `craft-files.md`: Fub aggiorna le note e dice quali file
  Craft puntano ancora al vecchio nome; il file Craft si ripara aprendolo
  nella sua app.
Casi limite: due file a byte che puntano allo stesso file (due righe); un
file a byte che punta a sé stesso; rinomina di una cartella intera; una
sorgente di testo e una a byte nello stesso giro; un provider a byte che sa
riscrivere (`Ok(Some(..))`: si comporta come oggi); l'annulla della rinomina
(i file a byte non hanno niente da annullare).
Fatto quando: `cargo test -p fub-kernel --test rename_and_events` ha il test
nuovo che fallisce prima del cambio (la rinomina si fermava) e passa dopo;
gli altri test della rinomina non cambiano.
Prova: scripts/check.sh --rapido; cargo test -p fub-kernel --test
rename_and_events
Stato: [x] fatto

## T6 · Il bundle `fub.craft`

Perché: i formati vanno montati, e qualcuno deve rispondere «dammi
l'anteprima di questo file» con la cache: è il bundle `fub.craft`, una riga
della mappa dei componenti dietro una cargo feature.
Tocca: `crates/fub-host/src/craft/mod.rs` (nuovo),
`crates/fub-host/src/craft/preview.rs` (nuovo); gli scheletri
`crates/fub-host/src/craft/editors.rs`, `crates/fub-host/src/craft/launch.rs`,
`crates/fub-host/src/craft/channel.rs`, `crates/fub-host/src/craft/open_with.rs`
(nuovi, solo la riga `//!` che dice che cosa conterranno);
`crates/fub-host/src/lib.rs` (`#[cfg(feature = "craft")] pub mod craft;`),
`crates/fub-host/src/mount.rs` (i provider e il bundle),
`crates/fub-host/Cargo.toml`, `crates/fub-features/Cargo.toml`,
`crates/fub-features/src/componenti.rs`,
`crates/fub-features/tests/cargo_features.rs`,
`crates/fub-host/tests/componenti.rs`, `crates/fub-host/tests/craft.rs`
(nuovo), `Cargo.lock`; `docs/reference/on-disk-layout.md` (riga 168, la riga
delle cache dei bundle: si cambia, non se ne aggiungono),
`docs/architecture/overview.md` (`host --> craft`),
`docs/reference/craft-formats.md` (sezione «Anteprima e cache»).
Non toccare: `crates/fub-kernel` (T5); `crates/fub-host/src/settings.rs`
(T7); `crates/fub-host/src/control.rs` (T9, T13); la shell (T14);
`.github/scripts/check-cargo-feature-default.mjs` (la feature è nel
`default`, quindi non va in `FUORI_DAL_DEFAULT`).
Dipende da: T1, T2, T3, T4
Cosa fare:
- Cargo: in `fub-host` `fub-format-craft = { workspace = true, optional =
  true }` e `craft = ["dep:fub-format-craft", "fub-features/craft"]`, nel
  `default` (riga 142); in `fub-features` la feature marcatore `craft = []`
  nel suo `default`, come `rich` e `xlsx`.
- `componenti.rs`: `#[cfg(feature = "craft")] Riga::servizio("fub.craft",
  "component.craft.name").group("disegnare").cargo_feature("craft")` accanto
  a `fub.draw` (riga 280); in `NOMI` `("component.craft.name", "File delle app
  Craft", "Craft app files")` accanto alla riga 400. `cargo_features.rs` e
  `crates/fub-host/tests/componenti.rs` (`#[cfg(feature = "craft")]
  ids.push("fub.craft")`, vicino alla riga 150) lo sanno.
- `mount.rs`: `#[cfg(feature = "craft")]
  builtin.extend(fub_format_craft::providers())` accanto ai provider dei
  disegni (riga 335); il bundle accanto a `LinkCardBundle` (riga 512).
- `craft/mod.rs`: `CraftBundle`, sul modello di
  `crates/fub-host/src/link_card.rs`: il manifest copia `uses`, `kind`,
  `group` e `ui` da `fub_features::componenti::riga("fub.craft")`; il
  comando `craft.preview` (`{ doc, size, render }`, in sola lettura, effetto
  `CommandEffect::Custom { ns: "fub.craft", payload }`) e il job
  `craft.render` (in T6 il job risponde «niente CLI» e basta: lo riempie
  T11); le frasi del bundle nel suo catalogo (italiano e inglese).
- `craft/preview.rs`: `pub fn preview(host: &dyn HostApi, doc: &DocId, size:
  PreviewSize) -> Result<CraftPreview, PluginError>`:
  - la revisione da `host.document_revision`; la cache da
    `host.cache_read(&cache_key(..))`, che risponde se è leggibile, della
    versione 1 e dello stesso `doc`;
  - altrimenti i byte da `host.read_document_bytes`, il formato dall'estensione
    (`CraftApp::of_format` dell'id del formato del documento),
    `container::embedded_preview` e `read_meta` per `info`; con l'anteprima
    nel file `origin: "file"` e la cache scritta (`host.cache_write`; un
    errore di scrittura non toglie l'anteprima);
  - per un XMP: `xmp::read` per `info.xmp`; la foto con
    `xmp::photo_candidates` e `host.query_index(IndexQuery::Entries {
    of_kind: None, within: Some(FolderScope::direct(cartella)), page })`
    (per `Stem` la prima in ordine di `DocId`); `info.edits` con
    `edit_copy_of`, se esiste;
  - `render` resta `null` (lo accende T11).
- Un file oltre 64 MiB: `origin: "none"` senza leggerlo (D-8).
- `tests/craft.rs`, con l'host di prova dei test vicini (per esempio
  `crates/fub-host/tests/svg_vault.rs`) e file finti scritti dal test:
  - un `.vectorcraft`, un `.pcraft` e un `.figcraft` con anteprima, e un
    `.vectorcraft` senza; per ognuno `craft.preview` small e large;
  - la seconda chiamata risponde dalla cache;
  - i byte di ogni file uguali prima e dopo (nessuna scrittura);
  - la ricerca trova un testo di un `.figcraft`;
  - `IndexQuery::Backlinks` della foto collegata dà il disegno;
  - `IndexQuery::Tags` trova il tag di un XMP, e `info.photo` e `info.edits`
    di un XMP accanto a `IMG_0001.CR3` e `IMG_0001-Edit.psd`;
  - con il componente spento il comando non c'è e i formati sì (D-7).
- Docs: la riga 168 di `on-disk-layout.md` nomina anche le anteprime di
  `fub.craft`; «Anteprima e cache» in `craft-formats.md` (le chiavi, chi la
  scrive, che si rifà).
Casi limite: un documento sparito fra la revisione e la lettura; la cache di
un'altra versione o di un altro `doc` (si ignora); la cache rotta; due
richieste insieme per lo stesso file; un `.pcraft` con solo `thumb.png`
chiesto `large` (dà quella, e lo dice la misura); un XMP senza foto; un id
che non è un formato Craft (`PluginError` con una chiave del catalogo, mai
un letterale); il vault chiuso.
Fatto quando: `cargo test -p fub-host --test craft --test componenti --test
format_guards --test syntax_declared --test catalogs` e `cargo test -p
fub-features --test cargo_features --test componenti` passano;
`node .github/scripts/check-cargo-feature-default.mjs` e
`node .github/scripts/check-error-literals.mjs` passano senza cambiare
soglie.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test craft
Stato: [x] fatto
  Da rivedere: T20, T21 e T22 lo cambiano (D-8 (c), D-9 (c)).

## T7 · Il registro delle app

Perché: «Apri con» e la CLI devono sapere quali app Craft ci sono, che cosa
aprono e dove sta il loro programma; e chi le ha messe in un posto suo deve
poterlo dire.
Tocca: `crates/fub-host/src/craft/editors.rs` (riempie lo scheletro di T6),
`crates/fub-host/src/settings.rs`,
`crates/fub-abi/tests/a_named_rule_is_declared.rs`,
`docs/product/craft-files.md` (sezione «Quali app trova Fub»).
Non toccare: `crates/fub-host/src/craft/launch.rs` e `channel.rs` (T8, T9, in
parallelo); `crates/fub-host/src/craft/mod.rs` (dichiara già il modulo);
`crates/fub-host/src/shell.rs` (le due impostazioni le disegna il modulo
generico: non vanno in `SETTINGS_WITH_THEIR_OWN_GESTURE`); la shell.
Dipende da: T6
Cosa fare:
- `editors.rs`: `pub struct Editor { id, name, opens, gui, cli,
  single_instance, control }`, tutto `&'static`, e `pub const EDITORS:
  &[Editor]` con le sette righe della tabella «Le app che Fub conosce»:
  `gui` è `<id>`, `cli` è `Some("<id>-cli")` per le tre app con l'anteprima
  (gli argomenti della CLI li scrive T11), `single_instance` dice su quali
  sistemi (`Os::Linux`, `Os::Windows`, `Os::MacOs`), `control` il metodo e
  l'autenticazione del passo (`Auth::None`, `Auth::Token { env:
  Option<&str> }`, `Auth::Key`), che T9 e T10 leggono: un canale con
  `Auth::None` o `Auth::Key` non si usa mai (D-2).
- `pub fn opens(editor: &Editor, extension: &str) -> bool` confronta
  l'estensione con `eq_ignore_ascii_case` (un `IMG.JPG` è un `jpg` per
  PhotoCraft); la riga in `rules()` di `a_named_rule_is_declared.rs`, famiglia
  `Family::AsciiCase`, con la ragione: le estensioni della tabella sono ASCII
  e il sistema le tratta così, e non è il nome di una nota, di un tag o di un
  percorso.
- `pub struct Env { home, os, path: Vec<PathBuf>, local_data, program_files,
  local_app_data, flatpak_roots }` con `Env::from_process()` e, nei test, uno
  costruito a mano: niente in `editors.rs` legge l'ambiente vero fuori da
  `from_process`.
- `pub fn detect(env: &Env, overrides: &[String]) -> Vec<Found>` (`Found {
  id, gui: Option<Launch>, cli: Option<PathBuf>, how }`), `Launch` =
  `Program(PathBuf)` o `Flatpak(String)` o `MacApp(PathBuf)`; nell'ordine:
  - le righe di `craft.editor-paths` (`vectorcraft=/opt/vc/vectorcraft`,
    `vectorcraft-cli=/opt/vc/vectorcraft-cli`): vincono su tutto; un id
    sconosciuto, una riga senza `=` o un percorso relativo si scartano;
  - `installed.json` del launcher (`artcraft-launcher/installed.json` sotto
    la cartella dei dati locali): letto con un tetto di 1 MiB e tollerante (un
    oggetto o un array, con `id` e un percorso fra `path`, `exe`,
    `executable`); un file rotto è come assente;
  - Linux: `/usr/bin/{id}`, `~/.local/bin/{id}`, un AppImage in
    `~/Applications` o `~/AppImages` il cui nome comincia con il nome
    dell'app o con il suo id così come sono scritti (`VectorCraft-…`,
    `vectorcraft-…`: niente piegatura del caso), e il Flatpak `ai.storyteller.{id}` cercato come cartella in
    `~/.local/share/flatpak/app/` e `/var/lib/flatpak/app/` (senza avviare
    `flatpak`);
  - macOS: `/Applications/{Nome}.app` e `~/Applications/{Nome}.app`;
  - Windows: `%LOCALAPPDATA%\Programs\ArtCraft\{Nome}\{id}.exe` e
    `%ProgramFiles%\ArtCraft\{Nome}\{id}.exe`;
  - la CLI accanto al programma trovato o in `~/.local/bin`; mai cercata nel
    `PATH` di sistema per nome nudo.
  Un percorso conta solo se è un file (o una cartella `.app` su macOS); un
  link simbolico si segue una volta.
- `pub fn find(env, overrides) -> Vec<Found>` con una cache di processo di 30
  secondi (un `OnceLock<Mutex<..>>` con l'ora): il menu non rifà le ricerche
  a ogni clic.
- `settings.rs`, tutto `#[cfg(feature = "craft")]`: `CRAFT_EDITOR_PATHS =
  "craft.editor-paths"` (`SettingKind::List`, vuota) e `CRAFT_CLI_PREVIEWS =
  "craft.cli-previews"` (`SettingSpec::toggle`, acceso), tutte e due
  `.for_machine()` (A11) e nel gruppo nuovo `C_GROUP_EXTERNAL_APPS =
  "core.group.external_apps"`, «App esterne» / «External apps», sul modello
  di `URI_ALLOWED` (righe 277 e 474-485). Le frasi in `core_catalog`, in
  italiano e in inglese (accanto alle righe 1828 e 2397): «Dove sono le app
  Craft» con la descrizione delle righe `id=percorso`; «Anteprime con le app
  Craft» con «Fub avvia la CLI dell'app per fare l'anteprima di un file che
  non ne ha una».
- Test in `editors.rs` (`#[cfg(test)]`): con un `Env` su una cartella
  temporanea finta per Linux, macOS e Windows (le regole dei percorsi si
  provano su ogni sistema, perché non avviano niente); le righe di
  `craft.editor-paths` buone e cattive; `installed.json` buono, rotto, enorme,
  con un id sconosciuto; `opens` con `JPG`; nessuna riga di `EDITORS` con
  `opens` vuoto o con due righe con lo stesso id.
- «Quali app trova Fub» in `craft-files.md`: dove le cerca, come dirgli un
  percorso, che cosa vuol dire «Non installata».
Casi limite: `HOME` assente; un percorso con spazi o con caratteri non UTF-8;
un AppImage senza il bit di esecuzione (non conta); `installed.json` che
punta a un file sparito; due righe di `craft.editor-paths` per lo stesso id
(vince l'ultima); un Flatpak installato per il sistema e per l'utente; la
cache dei 30 secondi dopo un cambio di `craft.editor-paths` (si svuota a
ogni cambio dell'impostazione); un'estensione con un punto davanti (`.JPG`).
Fatto quando: `cargo test -p fub-host --lib craft::editors` passa con i casi
qui sopra; `cargo test -p fub-host --test catalogs --test shell_ids_mirror`
passa; `cargo test -p fub-abi --test a_named_rule_is_declared` passa con la
riga nuova (e fallisce senza).
Prova: scripts/check.sh --rapido; cargo test -p fub-host --lib
craft::editors; cargo test -p fub-abi --test a_named_rule_is_declared
Stato: [x] fatto
  Da rivedere: T19 e T29 lo cambiano (D-1 (b), D-9 (c)).

## T8 · L'avvio dei programmi

Perché: «Apri con» avvia un'app e la lascia vivere da sola; la CLI si avvia
e si aspetta, con un tempo e un peso massimi. Due modi soli, scritti una
volta, senza shell.
Tocca: `crates/fub-host/src/craft/launch.rs` (riempie lo scheletro di T6),
`docs/reference/external-editors.md` (sezione «Avvio»).
Non toccare: `crates/fub-host/src/craft/editors.rs` (T7, si usa com'è) e
`channel.rs` (T9, in parallelo); `crates/fub-format-craft`, `craft/mod.rs` e
`craft/preview.rs` (T20, in parallelo); `crates/fub-app/src/reveal.rs`
(l'app di sistema resta di `fub-app`: T10 sposta solo `inside` e `plain`);
`crates/fub-host/Cargo.toml` (`tempfile` è già fra le dipendenze di
sviluppo).
Dipende da: T6
Cosa fare:
- `pub fn spawn_detached(program: &Path, args: &[OsString]) ->
  Result<u32, LaunchError>`: `std::process::Command` con argomenti separati,
  stdin, stdout e stderr a `Stdio::null()`, cartella di lavoro la home;
  su unix `CommandExt::process_group(0)` (l'app non muore se Fub si chiude);
  su Windows `creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)`;
  un thread con un nome (`fub-craft-wait`) fa `wait()` perché non restino
  processi zombie, e segna l'uscita nel registro che T10 legge
  (`pub fn on_exit(pid, Box<dyn FnOnce() + Send>)` o un canale: il coder
  sceglie).
- `pub fn run_cli(program: &Path, args: &[OsString], limits: &CliLimits,
  cancelled: &dyn Fn() -> bool) -> Result<CliOutput, LaunchError>`: stdout e
  stderr letti da due thread con un tetto di 64 KiB ciascuno (il resto si
  scarta, senza bloccare il processo); ogni ~100 ms guarda `cancelled()` e
  il tempo (20 s); a tempo scaduto o annullato uccide il processo (su unix
  l'intero gruppo) e aspetta che esca. `CliOutput { status, stdout, stderr }`.
- `pub struct CliLimits { time: Duration, stream: usize }` con il
  `Default` della sezione «I limiti».
- `pub enum LaunchError { NotFound, Denied, TimedOut, Cancelled, Failed(i32),
  Io }` senza testi (`Debug`, `PartialEq`); il testo lo mettono T10 e T11 con
  le chiavi del catalogo.
- Niente `sh -c`, niente `cmd /c`, niente variabili d'ambiente in più: si
  passa l'ambiente di Fub così com'è, meno le variabili di Fub stesse che
  cominciano con `FUB_` (un'app non deve trovare un token di Fub).
- Test `#[cfg(all(test, unix))]` in `launch.rs`, con script `/bin/sh` scritti
  in una cartella temporanea 0700 e resi eseguibili: uno che scrive un file e
  esce 0; uno che dorme 60 s (il tempo lo ferma, e l'annullamento pure, in
  meno di un secondo); uno che scrive 10 MiB su stdout (si tengono 64 KiB, il
  processo non si blocca); uno che esce 3 (`Failed(3)`); uno che stampa
  `FUB_*` (non ci sono); `spawn_detached` di uno che dorme: il pid torna
  subito e l'uscita arriva al registro.
- «Avvio» in `external-editors.md`: i due modi, perché niente shell, i
  limiti, che cosa succede chiudendo Fub.
Casi limite: un programma che non esiste (`NotFound`) o senza il bit di
esecuzione (`Denied`); un argomento con spazi, virgolette, `;` o `$(…)`
(arriva intatto: lo prova uno script che lo riscrive in un file); un
processo che chiude stdout e resta vivo; un figlio del figlio che resta
vivo dopo il tempo (il gruppo lo prende, su unix); l'annullamento mentre il
processo sta partendo; cento avvii di fila (nessun thread che resta).
Fatto quando: `cargo test -p fub-host --lib craft::launch` passa su Linux con
i casi qui sopra, e il test del sonno finisce in meno di 25 s con il tempo e
in meno di un secondo con l'annullamento.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --lib
craft::launch
Stato: [x] fatto · 85016cb9 (+ f2a40b7e) · check --rapido verde

## T9 · Il canale di controllo

Perché: un'app Craft avviata da Fub con un token scelto da Fub può ricevere
«apri questo file» nella finestra che ha già. Il canale va scritto una volta
e chiuso bene, anche se nessuna app della tabella lo permette ancora (D-2).
Tocca: `crates/fub-host/src/craft/channel.rs` (riempie lo scheletro di T6),
`crates/fub-host/src/control.rs` (solo `fresh_token`, riga 428, che diventa
`pub(crate)`), `docs/reference/permissions-and-security.md` (una
sottosezione accanto a «Canale di controllo», riga 223).
Non toccare: `crates/fub-host/src/craft/editors.rs` (T7, si usa com'è) e
`launch.rs` (T8, in parallelo); `crates/fub-format-craft`, `craft/mod.rs` e
`craft/preview.rs` (T20, in parallelo); il resto di `control.rs` (T13); il
canale di controllo di Fub (`Call`, `answer`): sono due canali diversi.
Dipende da: T6
Cosa fare:
- `pub struct Channel { port: u16, token: String, framing: Framing }`,
  `pub enum Framing { Line, JsonRpc2 }`; `Channel::new(port, framing)` sceglie
  il token con `fresh_token()`.
- Si connette solo a `127.0.0.1` o `::1` (`SocketAddr` costruito da Fub, mai
  da un nome), con un tempo di connessione di 1 s e di lettura di 2 s.
- `fn auth_request(&self) -> Value`: l'unico punto che scrive
  l'autenticazione (il passo non dice il formato: si scrive come
  `{"method":"auth","params":{"token":…}}` e la si cambia lì quando un'app
  lo documenta).
- `pub fn open(&self, path: &Path) -> Result<(), ChannelError>`: manda
  l'autenticazione e poi `app.open` (`Line`: un JSON per riga) o `ui.open`
  (`JsonRpc2`: `{"jsonrpc":"2.0","id":…}`); legge una risposta per richiesta
  con un tetto di 64 KiB; una risposta con `error` è
  `ChannelError::Refused`.
- `pub enum ChannelError { Unreachable, Refused, BadReply, TimedOut }` senza
  testi.
- Nessuno usa `Channel` con un'app che non è stata avviata da Fub con quel
  token (lo controlla T10); `Auth::None` e `Auth::Key` non creano mai un
  `Channel` (un `match` esaustivo lo rende visibile).
- Test in `channel.rs` con un `TcpListener` su `127.0.0.1:0` in un thread:
  riceve l'autenticazione e il comando, risponde bene, male, troppo, niente;
  le due cornici.
- La sottosezione in `permissions-and-security.md`: Fub parla solo con
  un'app che ha avviato lui, con un token suo, su loopback; mai con un canale
  senza autenticazione.
Casi limite: la porta chiusa (`Unreachable` subito); un server che accetta e
non risponde (`TimedOut` in 2 s); una risposta di 1 MiB senza fine riga
(`BadReply` a 64 KiB); una risposta con un `id` diverso; un percorso con
caratteri non UTF-8 (`BadReply` prima di mandare, perché il JSON vuole
UTF-8); un token che la risposta ripete (non finisce in nessun log).
Fatto quando: `cargo test -p fub-host --lib craft::channel` passa con i casi
qui sopra; i test di `control.rs` (`cargo test -p fub-host --lib control`)
passano invariati.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --lib
craft::channel
Stato: [x] fatto · d331e67f · check --rapido verde tranne 5 test di fub-host a tempo (watcher_factory_lock, lifecycle_teardown_lock) caduti con carico 35, verdi da soli (11 su 11)

## T10 · «Apri con» nell'host

Perché: il menu, l'MCP e il prestito chiedono la stessa cosa: «quali app
aprono questo file» e «aprilo con questa». La risposta è una, nel core.
Tocca: `crates/fub-host/src/open_with.rs` (nuovo, sempre compilato: i tipi e
i due metodi di `Host`), `crates/fub-host/src/craft/open_with.rs` (riempie lo
scheletro di T6), `crates/fub-host/src/vault_path.rs` (nuovo),
`crates/fub-host/src/lib.rs` (`pub mod open_with; pub mod vault_path;`),
`crates/fub-app/src/reveal.rs` (usa `fub_host::vault_path`),
`crates/fub-host/src/settings.rs` (le frasi `host.open_with.*`),
`crates/fub-host/tests/craft_open_with.rs` (nuovo),
`docs/reference/external-editors.md` (sezione «Apri con»).
Non toccare: `crates/fub-host/src/craft/preview.rs`, `craft/mod.rs`,
`craft/ranged.rs`, `registry.rs` e `mount.rs` (T21, in parallelo);
`crates/fub-app/src/lib.rs` (T12); `crates/fub-host/src/control.rs`
(T13); `launch.rs`, `editors.rs`, `channel.rs` (si usano come sono).
Dipende da: T7, T8, T9
Cosa fare:
- `vault_path.rs`: `pub fn inside(root: &Path, relative: &str) ->
  Result<PathBuf, PluginError>` e `plain`, spostati da
  `crates/fub-app/src/reveal.rs` (righe 71 e 102) con i loro test (righe
  229-243) e la stessa chiave `host.reveal.outside`; `reveal.rs` li usa da
  lì. Nessun testo letterale nuovo negli errori.
- `open_with.rs` (sempre compilato): `#[derive(Serialize, Deserialize)] pub
  struct ExternalEditor { id, name, opens, installed, running }`, `pub enum
  OpenHow { Forwarded, InRunning, NewProcess }` (`snake_case`), `pub struct
  OpenedWith { editor, how }`, e su `Host`:
  - `pub fn external_editors(&self, vault: Option<&str>, doc: Option<&str>)
    -> Result<Vec<ExternalEditor>, PluginError>`: senza la feature `craft`, o
    con `fub.craft` spento (`self.bundles(vault)`, `session.rs` riga 2424), una
    lista vuota; con `doc` solo le app che aprono la sua estensione
    (`editors::opens`), senza `doc` tutte e sette (la shell ci guarda per
    sapere se ce n'è almeno una installata);
  - `pub fn open_with(&self, vault: Option<&str>, path: &str, editor: &str,
    page: Option<u32>) -> Result<OpenedWith, PluginError>`.
- `craft/open_with.rs`, il percorso di `open_with`, in quest'ordine:
  1. `fub.craft` spento → `host.open_with.off`; editor sconosciuto →
     `host.open_with.unknown_editor`; l'estensione che l'app non apre →
     `host.open_with.wrong_kind`; non trovata da `editors::find` →
     `host.open_with.not_installed`;
  2. il percorso con `vault_path::inside` (fuori dal vault →
     `host.reveal.outside`; sparito → `host.open_with.missing`);
  3. un'app avviata da Fub, ancora viva e con un `Channel` (T9) → lo usa:
     `InRunning`; se il canale fallisce passa al punto 4;
  4. un'app con l'istanza singola su questo sistema → la avvia col file
     (l'app lo passa alla finestra aperta, se c'è): `Forwarded`;
  5. altrimenti un processo nuovo: `NewProcess`.
  Il programma: `Launch::Program` con `[file]`; `Launch::Flatpak` con
  `flatpak run ai.storyteller.{id} file` (`flatpak` cercato in `/usr/bin` e
  `/bin`); `Launch::MacApp` con `/usr/bin/open -a {app} file`. PdfCraft con
  `page` riceve `--page N` prima del file; le altre app ignorano `page`. Un
  errore di `spawn_detached` → `host.open_with.launch_failed` con il nome
  dell'app (mai il percorso del programma nel testo).
- Il registro delle app avviate: un `OnceLock<Mutex<HashMap<id, Started>>>`
  in `craft/open_with.rs` (`Started { pid, channel: Option<Channel> }`),
  aggiornato all'uscita (T8); `running` di `external_editors` vuol dire «avviata
  da Fub e non uscita» (A10). In N7 `channel` resta `None` per tutte le sette
  app (D-2): il punto 3 è scritto e provato con un editor di prova.
- Le frasi `host.open_with.*` in `core_catalog` (italiano e inglese), con
  `Text::key` e `Text::message`.
- `tests/craft_open_with.rs` (`#[cfg(unix)]`), con un vault temporaneo e
  script `/bin/sh` indicati da `craft.editor-paths` (impostati con
  `set_setting_for_user`, `session.rs` riga 2746) che scrivono i loro
  argomenti in un file:
  - `external_editors` di un `.pcraft` dà PhotoCraft installata; di un `.xyz`
    niente; senza `doc` le sette;
  - `open_with` di un `.pcraft` con PhotoCraft: lo script riceve il percorso
    assoluto del file, e `how` è `forwarded` su Linux;
  - VectorCraft dà `new_process`, e poi `running: true` finché lo script
    non esce;
  - PdfCraft con `page: 3` riceve `--page 3 file`;
  - un percorso con `..`, un'app sconosciuta, un'app non installata, un `.md`
    a PhotoCraft, `fub.craft` spento: ogni errore con la sua chiave.
- «Apri con» in `external-editors.md`: l'ordine dei tre modi, che cosa vuol
  dire «Già aperta», perché Fub non parla con un canale senza token.
Casi limite: un nome di file che comincia con `-` (si passa sempre il
percorso assoluto, che comincia con `/` o con la lettera del disco: non è
mai preso per un'opzione); un file con lo spazio nel nome;
il vault su un disco montato altrove (il percorso canonico); due «Apri con»
dello stesso file di fila; l'app che esce subito con un errore (`running`
torna `false`); un `vault` che non è aperto.
Fatto quando: `cargo test -p fub-host --test craft_open_with --test catalogs`
e `cargo test -p fub-app --lib reveal` passano;
`node .github/scripts/check-error-literals.mjs` passa senza cambiare
soglie.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test
craft_open_with
Stato: [ ] da fare

## T11 · Le anteprime con la CLI, dopo un gesto

Perché: VectorCraft di solito non salva l'anteprima nel file; la sua CLI la
sa fare. Ma avviare un programma è un'azione, non una lettura (D-1 (b)):
parte solo dal core, solo quando la shell principale lo chiede dopo un gesto
(A13), solo col consenso acceso, e su una copia del file. `craft.preview`
resta una lettura che non avvia mai niente.
Tocca: `crates/fub-host/src/craft_render.rs` (nuovo, sempre compilato: il
metodo di `Host`), `crates/fub-host/src/lib.rs` (`pub mod craft_render;`),
`crates/fub-host/src/craft/render.rs` (riempie lo scheletro di T20),
`crates/fub-host/src/craft/mod.rs` (il job `craft.render`),
`crates/fub-host/src/craft/preview.rs` (`render` col consenso),
`crates/fub-host/src/settings.rs` (le frasi `host.craft_render.*`),
`crates/fub-host/tests/craft_cli.rs` (nuovo),
`docs/reference/craft-formats.md` (sezione «Anteprime con la CLI»),
`docs/reference/permissions-and-security.md` (una sottosezione «Chi avvia
un'app Craft», accanto a quella di T9).
Non toccare: `crates/fub-host/src/craft/preview/` (T22, in parallelo: i
formati letti a pezzi); `crates/fub-format-craft` (la forma è di T20);
`editors.rs` e `launch.rs` (si usano come sono; le altre tre CLI le accende
T29); `crates/fub-host/src/control.rs` (T13); la shell (T25, in parallelo;
la domanda è di T23).
Dipende da: T8, T9, T19, T20, T21
Cosa fare:
- `craft/preview.rs`, quando nel file non c'è un'anteprima e il file non
  supera il peso massimo (`consent::max_bytes`, T19): prima la cache delle
  anteprime fatte dalla CLI, con la revisione di `ranged::revision` (T21):
  se c'è, `origin: "cli"`; se la revisione è nell'insieme «già provato» (qui
  sotto), `missing: "failed"` e `render: null`; altrimenti, se l'app del
  soggetto (`PreviewSubject::editor`, T20) ha la CLI (`editors::find`),
  `render` vale `{ app, consent }` con `consent::current` (T19), anche con
  `off`, perché la scheda sappia quale app direbbe «spente». Oltre il peso
  massimo `missing: "over_limit"` e nessuna offerta. `craft.preview` non
  legge `render` (lo toglie T20).
- `craft_render.rs`: `Host::craft_render(&self, vault: Option<&str>, doc:
  &str, size: PreviewSize) -> Result<CraftPreview, PluginError>`, in
  quest'ordine: senza la feature `craft` o con `fub.craft` spento →
  `host.craft_render.off`; il consenso non è `on` →
  `host.craft_render.no_consent` (quando chi usa Fub preme «Sì, accendi» la
  shell salva `on` e poi chiama); l'anteprima c'è già → la risposta di
  `craft.preview`, senza avviare niente; nessuna CLI per quel soggetto →
  `host.craft_render.no_cli`; il file oltre il peso massimo →
  `host.craft_render.over_limit`. Altrimenti un biglietto e il job
  `craft.render { doc, size, ticket }` in coda per quel vault (per la stessa
  via interna che usa `Call::InvokeJob` in `control.rs`), e la risposta col
  `CraftPreview` e `queued: true`.
- Il biglietto, in `craft/render.rs`: un valore di `control::fresh_token`
  (T9 lo rende `pub(crate)`) legato a `(vault, doc, size)`, buono una volta
  sola e per 60 secondi, in una tabella di processo con l'ora iniettabile nei
  test. Il job lo consuma prima di qualsiasi altra cosa; senza un biglietto
  buono risponde `Unserved` con `render.no_ticket` e non avvia niente. Così
  `Call::InvokeJob`, un plugin, `fub_invoke` e ogni altra via che arriva al
  job per nome non avviano niente. Il biglietto non va mai nel log né
  nell'esito del job. Chiudendo un vault i suoi biglietti si buttano.
- Il job `craft.render { doc, size, ticket }`:
  1. il biglietto (sopra);
  2. di nuovo il consenso (`on`) e il peso: la scelta può cambiare fra la
     domanda e il job;
  3. una cartella privata nuova (`tempfile::Builder` sotto la cartella
     temporanea di Fub, permessi 0700 su unix), dove copia il documento col
     lettore a pezzi di T21 (a blocchi, mai il file intero in memoria, al
     più il peso massimo) col suo nome (`in.vectorcraft`): la CLI non vede
     mai il file del vault (A5);
  4. `launch::run_cli` con gli argomenti della tabella «Le app che Fub
     conosce» (`convert {in} {out} --scale 0.25` per VectorCraft, `convert
     {in} {out}` per PhotoCraft, `render {in} -o {out}` per FigCraft; per
     `large` VectorCraft senza `--scale`), `{in}` e `{out}` assoluti,
     argomenti separati, e l'annullamento del job. Gli argomenti stanno in
     una funzione sola (`cli_args(subject, size, input, output) ->
     Option<Vec<OsString>>`), che T29 allunga;
  5. `out.png` guardato con `symlink_metadata` (un link o una cartella si
     rifiutano), letto con un tetto di 16 MiB e controllato con
     `PreviewImage::from_png`; con un PNG buono `origin: "cli"` e la cache
     scritta per la revisione presa all'inizio (se il file è cambiato nel
     frattempo la risposta lo dice e non si scrive);
  6. la cartella si cancella sempre, anche dopo un errore o un annullamento.
  L'esito del job è il `CraftPreview` nuovo (la shell lo riceve con
  `job_done`). Un errore (CLI che manca, tempo scaduto, PNG cattivo) è un
  `CraftPreview` con `origin: "none"`, `missing: "failed"` e `render: null`,
  e la coppia (revisione, misura) va in un insieme di processo «già
  provato» che `craft.preview` legge: la stessa revisione non si riprova
  finché il file non cambia o Fub non riparte. L'errore sta nel log del job,
  con una chiave del catalogo del bundle.
- Due `craft_render` per lo stesso `doc` e la stessa misura mentre una
  lavora: una sola CLI (un insieme dei lavori in corso); la seconda risponde
  `queued: true` senza un biglietto nuovo.
- Le frasi del job nel catalogo del bundle e le `host.craft_render.*` in
  `core_catalog`, in italiano e in inglese, con `Text::key`.
- `tests/craft_cli.rs` (`#[cfg(unix)]`), con `vectorcraft-cli` puntato da
  `craft.editor-paths` a uno script `/bin/sh` `fub-craft-test-*` che scrive
  un PNG minimo in `$2`, conta le sue chiamate in un file e scrive il suo pid
  in un altro:
  - con il consenso `ask` e `off`: `craft.preview` dà `render` col suo
    `consent`, `craft_render` è `no_consent`, lo script non parte;
  - con `on`: `craft_render` dà `queued`, poi il `job_done` con l'immagine;
    `craft.preview` dopo risponde dalla cache, e lo script ha contato 1;
  - le vie senza gesto, ognuna con lo script a 0 chiamate: `craft.preview`
    con `{ "render": true }`; `Call::InvokeJob` di `craft.render` senza
    biglietto, con uno inventato, con uno già usato, con uno di un altro
    documento o di un'altra misura, con uno scaduto; un plugin di prova che
    chiama `run_command("craft.preview", { "render": true })`, che prova a
    mettere in coda `craft.render` (un job non suo: rifiutato) e
    `set_setting("craft.cli-previews", "on")` (`PermissionDenied`, T19);
  - i byte del documento uguali; lo script che dorme si ferma a 20 s e
    annullando il job; lo script che scrive 17 MiB, un link simbolico o un
    file che non è un PNG dà `missing: "failed"`, e la stessa revisione non
    riparte; il file oltre il peso massimo non si copia; la cartella privata
    non c'è più dopo ogni caso.
- «Anteprime con la CLI» in `craft-formats.md`: quando parte (il gesto, il
  consenso), che cosa vede l'app (una copia), dove va l'anteprima, perché
  `craft.preview` non avvia mai niente. «Chi avvia un'app Craft» in
  `permissions-and-security.md`: solo il core e solo per la shell principale,
  mai un plugin, l'MCP o il canale di controllo; il biglietto.
Casi limite: il documento rinominato o cancellato mentre la CLI lavora; la
CLI che scrive in `{in}`; la cartella temporanea piena; uno `.xmp` (niente
CLI); un `.pcraft` che ha già `thumb.png` (niente CLI); la misura `large`
quando c'è solo la `small` della CLI; il consenso spento mentre il job è in
coda (il job non avvia niente); il vault chiuso con un biglietto aperto; un
`craft_render` su un `vault` che non è aperto.
Fatto quando: `cargo test -p fub-host --test craft_cli --test craft --test
catalogs` passa con i casi qui sopra; dopo i test nessun pid scritto dagli
script è ancora vivo (`kill -0` dal test; mai `pgrep -f`);
`node .github/scripts/check-error-literals.mjs` passa senza cambiare soglie.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test craft_cli
Stato: [ ] da fare

## T12 · L'IPC

Perché: la shell chiede all'app le due cose di T10 attraverso due comandi
Tauri, come fa già per «Apri con un'altra app» (`reveal_in_system`); e, con
un terzo, `craft_render` di T11: avviare un programma non passa dalle porte
generiche (`invoke_command`), che un plugin e l'MCP raggiungono (D-1 (b)).
Tocca: `crates/fub-app/src/lib.rs` (tre comandi e la loro registrazione),
`crates/fub-app/permissions/default.toml` (i tre nomi in `allow-shell`, riga
54 e seguenti), `crates/fub-app/tests/lean_ipc.rs`,
`crates/fub-app/tests/ipc_permissions.rs`,
`crates/fub-app/tests/ts_mirror_app.rs`,
`apps/client/src/__fixtures__/mirror-samples-app.json` (generato),
`apps/client/src/host/ipc.ts`, `apps/client/src/host/fake.ts`,
`apps/client/src/host/mirror.test.ts`, `docs/reference/ipc-contract.md`.
Non toccare: `crates/fub-host` (T10 e T11 hanno scritto ciò che serve); i
file MCP (T13); `crates/fub-app/permissions/mobile.toml` (sul telefono non si
avviano app Craft: i tre comandi non vi sono permessi); `reveal_in_system` (la
voce dell'app di sistema resta com'è); `apps/client/src/host/craft.ts` (la
forma è di T20).
Dipende da: T10, T11
Cosa fare:
- In `lib.rs`, accanto a `reveal_in_system` (riga 1940) e alla sua
  registrazione (riga 2663): `external_editors(window, host, vault:
  Option<String>, doc: Option<String>) -> Result<Vec<ExternalEditor>,
  PluginError>` e `open_with(window, host, vault, path: String, editor:
  String, page: Option<u32>) -> Result<OpenedWith, PluginError>`, come
  `reveal_in_system`: prima `guard_main_shell(&window, …)` (solo la shell
  principale), poi i metodi di `Host` in `spawn_blocking`. Il terzo,
  `craft_render(window, host, vault: Option<String>, doc: String, size:
  PreviewSize) -> Result<CraftPreview, PluginError>`, allo stesso modo, sotto
  `#[cfg(feature = "craft")]` se `fub-app` non ha già la feature accesa sempre
  (il coder segue il codice e lo dice).
- `default.toml`: `"external_editors"`, `"open_with"` e `"craft_render"`
  nella lista di `allow-shell`.
- `lean_ipc.rs`: le tre righe `("external_editors", Why::AppSurface)`,
  `("open_with", Why::AppSurface)` e `("craft_render", Why::AppSurface)`
  accanto alla riga 373, con un commento che dice perché `craft_render` non
  è un comando del bundle (A13); `ipc_permissions.rs` li trova registrati e
  permessi, e trova `craft_render` assente da `mobile.toml`.
- `ts_mirror_app.rs`: esempi di `ExternalEditor` (installata, non
  installata, già aperta) e di `OpenedWith` (i tre `how`) nella fixture;
  `mirror.test.ts` controlla le chiavi di `ExternalEditor` e `OpenedWith`
  (`APP_RECORD_KEYS`) e i valori di `how`.
- `ipc.ts`: i tipi `ExternalEditor`, `OpenHow`, `OpenedWith` e le tre
  funzioni `externalEditors(doc, vault?)`, `openWith(path, editor, page?,
  vault?)`, `craftRender(doc, size, vault?)` (legge la risposta con
  `readCraftPreview` di T20), accanto a `revealInSystem` (riga 227).
- `fake.ts`: le tre opzioni (`externalEditors?`, `openWith?`, `craftRender?`)
  come `revealInSystem` (righe 196 e 1343), e senza opzione la risposta
  «non disponibile» che usa già; l'host finto conta le chiamate a
  `craftRender`, perché i test della shell (T23, T26, T31) provano che una
  via senza gesto non lo chiama mai.
- `ipc-contract.md`: i tre comandi, le loro risposte, gli errori, e perché
  `craft_render` è solo della shell principale.
Casi limite: `doc` assente (le sette app); un `page` negativo o enorme
(`u32` lo rifiuta prima di Rust); la shell di un'app vecchia che non ha i
comandi (la shell tratta il rifiuto come «nessuna app Craft» e il menu resta
quello di oggi: lo dice T16); un `vault` chiuso fra le due chiamate;
`craft_render` chiamato da una finestra che non è la shell principale
(rifiutato da `guard_main_shell`, con un test); una `size` che non è `small`
o `large`.
Fatto quando: `cargo test -p fub-app --test lean_ipc --test ipc_permissions
--test ts_mirror_app` passa e la fixture è committata; `cd apps/client &&
npx vitest run src/host/mirror.test.ts` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-app --test lean_ipc
--test ipc_permissions --test ts_mirror_app
Stato: [ ] da fare

## T13 · Gli strumenti MCP

Perché: un agente che lavora nel vault vuole vedere un disegno e passarlo
all'app giusta, con le stesse regole di chi scrive (D-4 (a)); e non deve
poter avviare un'app per un'anteprima per nessuna via (D-1 (b)).
Tocca: `crates/fub-host/src/control.rs` (`Call::ExternalEditors`,
`Call::OpenWith` e i loro rami in `answer`, riga 185),
`crates/fub-cli/src/port.rs`, `crates/fub-cli/src/mcp/tools.rs`,
`crates/fub-cli/tests/mcp.rs`, `docs/reference/mcp-server.md`.
Non toccare: `crates/fub-app` (T12 ha scritto ciò che serve) e la shell
(T23, in parallelo); `crates/fub-cli/src/mcp/access.rs` (si usano
`check_read` e `check_write` come sono); il bundle `fub.craft` (T29, in
parallelo); `Call::InvokeJob` (resta com'è: il biglietto di T11 lo rende
innocuo per `craft.render`).
Dipende da: T6, T10, T11, T20
Cosa fare:
- `control.rs`: `Call::ExternalEditors { vault: Option<String>, doc:
  Option<String> }` e `Call::OpenWith { vault, path, editor, page }` (il
  `serde` di `Call` così com'è), che chiamano i metodi di T10; i test di
  `control.rs` che fanno il giro di ogni `Call`.
- `port.rs`: `external_editors` e `open_with` come gli altri metodi
  (all'app se è aperta, al `Host` locale se no, righe 133-240): così «Già
  aperta» lo sa l'app, che ha avviato i programmi.
- `tools.rs`, tre strumenti:
  - `fub_external_editors { doc }`: `check_read(doc)`, poi la lista;
  - `fub_open_with { doc, editor, page?, apply }`: senza `apply` dice che
    cosa farebbe (l'app, se è installata, `forwarded` o `new_process`) senza
    avviare niente; con `apply: true` vuole `check_write(doc)` (D-4) e poi
    `open_with`;
  - `fub_preview { doc, size? }`: `check_read(doc)`, poi `Call::InvokeCommand`
    di `craft.preview` con `{ doc, size }` (la forma 2 di T20, che non avvia
    mai niente); il risultato porta un contenuto
    `{"type":"image","data":…,"mimeType":…}` col `media_type` dell'immagine
    (`image/png` o `image/jpeg`) quando c'è, e un contenuto di testo con
    `info`, `origin` e `missing`. Oggi ogni risultato è testo (riga 247): il
    ramo per l'immagine è nuovo.
- Nessuno strumento nuovo chiama `craft_render`, e nessuno cambia
  `craft.cli-previews`: lo prova un test che elenca gli strumenti.
- `tests/mcp.rs`: i tre strumenti con un vault di prova: la lista; la prova
  senza `apply`; `apply` fuori dalle radici di scrittura rifiutato; un
  `.figcraft` con anteprima dà il contenuto immagine; un `.vectorcraft` senza
  dà solo il testo con `origin: "none"`. Le vie che non devono avviare
  niente, con `vectorcraft-cli` puntato a uno script che conta le chiamate
  (come in T11) e il consenso `on`: `fub_preview`; `fub_invoke` di
  `craft.preview` con `{ "render": true }`, senza e con `apply`; lo script
  resta a 0.
- `mcp-server.md`: i tre strumenti, le radici, perché `fub_preview` e
  `fub_invoke` non avviano mai un'app.
Casi limite: `doc` fuori dalle radici di lettura; `editor` sconosciuto;
`fub.craft` spento (la lista vuota, `fub_preview` dice che il comando non
c'è); un'anteprima di 8 MiB (passa, ed è il tetto); la CLI di Fub senza
l'app aperta (`running` sempre `false`).
Fatto quando: `cargo test -p fub-cli --test mcp` e i test di `control.rs`
(`cargo test -p fub-host --lib control`) passano.
Prova: scripts/check.sh --rapido; cargo test -p fub-cli --test mcp
Stato: [ ] da fare

## T14 · La scheda Craft e XMP

Perché: è ciò che si vede aprendo un file Craft o un XMP: l'anteprima, i
dati, il pulsante per farla fare all'app (sezione «Che cosa vede chi usa
Fub»).
Tocca: `apps/client/src/editors/craft/index.ts` (nuovo),
`apps/client/src/editors/craft/surface.ts` (nuovo),
`apps/client/src/editors/craft/xmp-view.ts` (nuovo),
`apps/client/src/editors/craft/craft.test.ts` (nuovo),
`apps/client/src/state/craft-previews.ts` (nuovo),
`apps/client/src/state/craft-previews.test.ts` (nuovo),
`apps/client/src/editors/core/bootstrap.ts`, `apps/client/src/ui/format-kind.ts`,
`apps/client/src/ui/format-kind.test.ts`, `apps/client/src/ui/icons.ts`,
`apps/client/src/ui/icons.test.ts`, `apps/client/src/i18n/catalog.ts`,
`apps/client/src/theme/scrittoio/skin/media.css`,
`apps/client/src/theme/scrittoio/anatomia/media.ts`,
`apps/client/src/host/fake.ts`, `crates/fub-features/src/componenti.rs`
(`.ui(&["editors/craft"])` sulla riga `fub.craft`),
`docs/product/craft-files.md` (sezione «La scheda»).
Non toccare: `apps/client/src/editors/media/image-view.ts` (si usa com'è);
`apps/client/src/editors/text/` e `state/preview.ts` (T15);
`apps/client/src/panels/` (T16, T17); `apps/client/src/host/craft.ts` (il
contratto è di T1: se manca un campo, si torna a T1, non si cambia qui); la
mappa delle tinte del kit (nessun ruolo nuovo).
Dipende da: T1, T6
Cosa fare:
- `state/craft-previews.ts`, sul modello di `state/link-cards.ts`:
  `previewOf(doc, size, { render })` chiede `craft.preview` con
  `api.invokeCommand("craft.preview", { doc, size, render }, …,
  ...vaultArg(vault))`, legge l'effetto con `readCraftPreview` (T1), tiene
  una risposta per `doc`, misura e revisione, ascolta con `onAnyEvent` i
  `job_done` di `craft.render` e avvisa chi aspetta; dimentica tutto alla
  chiusura del vault. Una sola domanda in volo per chiave.
- `editors/craft/surface.ts`: la superficie in sola lettura (nessuna
  modalità di modifica, `setReadOnly` che non cambia niente):
  - chiede `large`; con l'immagine fa `decodeImage({ handle, id: doc, len,
    mime: "image/png", kind: "image", revision }, bytes)` e
    `mountImageView(image, alt, life)` (`editors/media/image-view.ts`, righe
    125 e 210): lo zoom e la barra sono quelli di una foto;
  - sotto, la riga dei dati: «Disegno di VectorCraft» (o «Immagine di
    PhotoCraft», «Progetto di FigCraft»), la versione del formato se c'è, il
    peso;
  - senza immagine il riquadro col nome e l'app; con `render` il pulsante
    «Crea l'anteprima con {app}»; all'apertura della scheda chiede una volta
    con `render: true` se `render` c'è (D-1); con `queued` «Preparo
    l'anteprima…»; con un file oltre 64 MiB «File troppo grande per
    l'anteprima».
- `editors/craft/xmp-view.ts`: il voto in stelle (una lettura per lo schermo
  «3 stelle su 5», «Scartata» per -1), l'etichetta col suo colore (Red,
  Yellow, Green, Blue, Purple come le scrive LightCraft; un'altra etichetta
  senza colore), la scelta, le parole chiave come i tag della nota (un clic
  cerca `tag:`), la foto (un clic la apre), le copie `-Edit.psd`, e la riga
  fissa su ⌘S e sulla scrittura automatica (D-5).
- `editors/craft/index.ts` esporta la registrazione; `bootstrap.ts` la
  registra come la famiglia `grid` (riga 326): `owner: "fub.craft"`, una
  famiglia `craft`, i profili `craft` e `xmp`, `formats: {
  "craft-vectorcraft": "craft", "craft-photocraft": "craft",
  "craft-figcraft": "craft", "craft-xmp": "xmp" }` (le chiavi sono gli id dei
  formati: `editors/core/registry.ts` riga 648). Il modulo si carica con un
  `import()`, come la barra della griglia.
- `ui/format-kind.ts`: la specie nuova `photo` (`FormatKind`,
  `FORMAT_ICON` → `format-photo`, `FORMAT_NAME` → `format.kind.photo`);
  `vectorcraft` → `drawing` con la sigla VECTORCRAFT, `figcraft` → `drawing`
  con FIGCRAFT, `pcraft` → `photo` con PHOTOCRAFT, `xmp` → `photo` con XMP.
  `ui/icons.ts`: `format-photo` (una fotografia, nel tratto delle altre
  `format-*`); `icons.test.ts` lo sa.
- `media.css` e `anatomia/media.ts`: il riquadro senza anteprima, la riga
  dei dati, le stelle e l'etichetta, con i ruoli del tema che ci sono (niente
  colori scritti a mano: le cinque etichette usano i ruoli dei colori dei
  tag, se ci sono, o i loro nomi come testo).
- `catalog.ts`: tutte le frasi qui sopra, in tutte le lingue del catalogo,
  più quelle della figura che usa T15 (`craft.figure.no_preview`,
  `craft.figure.alt`).
- `host/fake.ts`: la risposta a `craft.preview` (in `invokeCommand`, riga
  1475) con un'opzione per i test e per il banco: con immagine, senza, con
  `render`, con `queued` e il `job_done` dopo.
- `componenti.rs`: `.ui(&["editors/craft"])` sulla riga di `fub.craft`
  (`ogni_ui_e_una_cartella_del_client` in `crates/fub-features/tests/componenti.rs`
  lo vuole adesso che la cartella c'è).
- `craft.test.ts` e `craft-previews.test.ts`: la superficie con ogni forma
  della risposta, il pulsante che chiede `render: true` una volta sola, il
  `job_done` che porta l'immagine, la vista XMP con ogni campo assente.
- Le foto dal banco (skill `banco`): la scheda di un `.vectorcraft` con
  anteprima, senza anteprima col pulsante, «Preparo l'anteprima…», un XMP
  completo; in chiaro e in scuro.
- «La scheda» in `craft-files.md`.
Dal prototipo: nessun prototipo; dalla tabella «Dal prototipo» le righe
di T14 (l'icona e la sigla, la scheda di un file Craft, la scheda di un XMP,
l'aspetto delle due schede, i testi), fatte con la vista delle immagini, i
tag della nota e la riga dei dati che le schede dei media hanno già.
Casi limite: un'immagine 1×1 e una 8000×8000; una `revision` che cambia
mentre la scheda è aperta (si richiede e si ridisegna); la risposta che
arriva dopo che la scheda è chiusa (si scarta, la `Lifetime` lo garantisce);
un `job_done` di un altro documento; `fub.craft` spento (il formato non ha
superficie e si apre con la vista dei file senza superficie, come oggi); un
XMP con 500 parole chiave (si vanno a capo, niente scorrimento orizzontale);
il nome di un'app che il catalogo non ha (si mostra com'è).
Fatto quando: `cd apps/client && npx vitest run src/editors/craft
src/state/craft-previews.test.ts src/ui/format-kind.test.ts
src/ui/icons.test.ts` passa; `cargo test -p fub-features --test componenti`
e `cargo test -p fub-host --test componenti` passano; le foto del banco
mostrano le quattro schede.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/craft src/state/craft-previews.test.ts
Stato: [x] fatto
  Da rivedere: T20, T23 e T28 lo cambiano (D-1 (b), D-8 (c), D-9 (c)); T25
  ne riusa la vista XMP (D-5 (d)).

## T15 · Le figure e l'anteprima al passaggio

Perché: `![[logo.vectorcraft]]` in una nota e il passaggio del puntatore su
un link a un file Craft devono mostrare l'anteprima, senza mai avviare l'app.
Tocca: `apps/client/src/editors/craft/figure.ts` (nuovo),
`apps/client/src/editors/craft/figure.test.ts` (nuovo),
`apps/client/src/editors/text/profiles/markdown/mount.ts`,
`apps/client/src/editors/text/profiles/markdown/media.test.ts`,
`apps/client/src/state/preview.ts`, `apps/client/src/state/preview.dom.test.ts`,
`docs/product/craft-files.md` (sezione «Nelle note»).
Non toccare: `apps/client/src/i18n/catalog.ts` (le frasi le ha messe T14);
`apps/client/src/panels/` e `ui/menu-cases.ts` (T16, in parallelo);
`editors/craft/surface.ts` e `xmp-view.ts` (T14); il segnaposto dei disegni
(`scenePlaceholder`, `showEmbeddedDrawing`), che resta com'è.
Dipende da: T14
Cosa fare:
- `figure.ts`: `craftPlaceholder(html: string): { doc, app, name } | null`,
  sul modello di `scenePlaceholder` (`markdown/media.ts`, riga 184): legge la
  `figure.fub-craft` con `data-embed-kind="craft"` (o `craft-xmp`) che dà il
  provider (T1); `showEmbeddedCraft(container, slot, placeholder, life)`, sul
  modello di `showEmbeddedDrawing` (riga 326): chiede `small` con `render:
  false` a `state/craft-previews.ts`; con l'immagine un `<img>` (un URL
  `blob:` liberato dalla `Lifetime`) con la didascalia del nome; senza, il
  riquadro col nome e l'app. Un clic apre il file nella sua scheda.
- `mount.ts`, accanto al ramo dei disegni (riga 474): se `craftPlaceholder`
  riconosce `content.html` e il `doc` coincide, `showEmbeddedCraft` e
  `return`. Se `![[x.vectorcraft]]` non arriva a quel ramo (per esempio
  perché un'altra via lo prende prima), il coder segue il codice e lo dice.
- `state/preview.ts`: la finestrella al passaggio riconosce la stessa figura
  e mostra `showEmbeddedCraft` invece dell'HTML.
- I test: `figure.test.ts` (la figura con e senza immagine, un HTML che non
  è una figura Craft, un `data-embed-doc` diverso dal documento, l'escape del
  nome); `media.test.ts` (la nota con `![[logo.vectorcraft]]` passa da
  `showEmbeddedCraft`); `preview.dom.test.ts` (il passaggio su
  `[[logo.vectorcraft]]`). In nessuno dei tre l'host finto riceve
  `render: true`.
- «Nelle note» in `craft-files.md`.
Dal prototipo: nessun prototipo; le righe di T15 (la figura nella nota,
l'anteprima al passaggio), fatte come la figura dei disegni.
Casi limite: la stessa figura dieci volte nella stessa nota (una domanda
sola); una figura dentro un embed dentro un embed; un XMP incorporato (il
riquadro coi dati principali, senza immagine); la nota chiusa prima della
risposta; un file Craft che non esiste più (resta il riquadro
«non risolto» che c'è già); `fub.craft` spento (il provider dà la figura, la
domanda fallisce: resta il riquadro col nome).
Fatto quando: `cd apps/client && npx vitest run src/editors/craft/figure.test.ts
src/editors/text/profiles/markdown/media.test.ts src/state/preview.dom.test.ts`
passa; una foto del banco con una nota che incorpora un `.figcraft`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/craft/figure.test.ts src/state/preview.dom.test.ts
Stato: [x] fatto
  Da rivedere: T20 e T23 lo cambiano (D-1 (b), D-8 (c)); T31 ne riusa la
  figura e le dà il CSS che non ha (`craft-figure`, D-9 (c)).

## T16 · Il sottomenu «Apri con un'altra app»

Perché: la voce di oggi conosce solo l'app predefinita del sistema; con le
app Craft installate diventa un sottomenu (D-6).
Tocca: `apps/client/src/panels/open-with.ts` (nuovo),
`apps/client/src/panels/open-with.test.ts` (nuovo),
`apps/client/src/state/external-editors.ts` (nuovo),
`apps/client/src/state/external-editors.test.ts` (nuovo),
`apps/client/src/panels/explorer.ts`,
`apps/client/src/editors/media/media-surface.ts`,
`apps/client/src/ui/menu-cases.ts`, `apps/client/src/i18n/catalog.ts`,
`docs/product/editor-menus.md`.
Non toccare: `apps/client/src/ui/menu.ts` (i sottomenu a cascata ci sono
già: `items` può essere una funzione asincrona); `apps/client/src/host/ipc.ts`
(T12); `editors/craft/`, `editors/text/`, `state/preview.ts` e
`ui/format-kind.ts` (T28 e T31, in parallelo); `state/document-controller.ts`
e `panels/document.ts` (T31 in parallelo, poi T17).
Dipende da: T12, T14
Cosa fare:
- `state/external-editors.ts`: all'apertura del vault chiede
  `externalEditors(null, vault)` (le sette) e tiene se ce n'è almeno una
  installata; la richiede quando cambia `craft.editor-paths` o il componente
  `fub.craft`; un rifiuto del comando (un'app vecchia) vale «nessuna».
- `panels/open-with.ts`: `openWithEntry(doc, deps): MenuItem`. Senza app
  Craft installate è la voce di oggi (`explorer.open_system`, che chiama
  `handToSystem`). Con almeno una è una voce con `submenu: true` e `items:
  async () => …`: per prima «L'app predefinita del sistema»
  (`open_with.system`), poi le app che `externalEditors(doc)` dà per quel
  file, nell'ordine della tabella; una non installata ha `enabled: false` e
  `hint` «Non installata» (`open_with.not_installed`), una avviata da Fub
  «Già aperta» (`open_with.running`). Un clic chiama `openWith` e, se fallisce,
  mostra l'errore con la frase che arriva dall'host.
- `explorer.ts`: `noteMenu` (riga 978) e `fileMenu` (riga 1011) usano
  `openWithEntry` al posto della voce `explorer.open_system` (righe 999 e
  1022): il numero delle voci non cambia (nove al massimo, `menu-budget.test.ts`).
- `media-surface.ts` (riga 285): la voce `media.open_external` della barra
  diventa `openWithEntry` (con `deps.openExternal` come app di sistema).
- `catalog.ts`: `open_with.system` «L'app predefinita del sistema» / «The
  system's default app», `open_with.not_installed` «Non installata» / «Not
  installed», `open_with.running` «Già aperta» / «Already open»;
  `media.open_external` (righe 1756 e 4727) diventa «Apri con un'altra app» /
  «Open with another app», come `explorer.open_system` (D-6). Le altre
  lingue del catalogo come vuole il catalogo.
- `menu-cases.ts`: il caso del menu di un file con il sottomenu (per i test
  del bilancio e delle foto dei menu).
- I test: `open-with.test.ts` (senza app installate la voce di oggi; con
  PhotoCraft installata il sottomenu di un `.pcraft` con l'app di sistema
  prima; VectorCraft non installata spenta; «Già aperta»; un `.md` col
  sottomenu che ha solo l'app di sistema; il clic che chiama `openWith` con
  l'id giusto; l'errore mostrato); `external-editors.test.ts` (il rifiuto,
  il cambio d'impostazione).
- `editor-menus.md`: il sottomenu, le sue voci, quando compare.
Dal prototipo: nessun prototipo; la riga di T16 (il sottomenu), fatta col
sottomenu a cascata di `ui/menu.ts`, la voce spenta e il suo `hint`.
Casi limite: il menu aperto con il dito (il sottomenu si apre al posto del
menu, con la voce per tornare: lo fa `menu.ts`); la risposta di
`externalEditors(doc)` che tarda (il sottomenu mostra la sua attesa, come
gli altri asincroni); il vault chiuso a menu aperto; un file senza
estensione; un nome di app lungo; l'app che esce mentre il menu è aperto
(«Già aperta» resta fino alla prossima apertura del menu).
Fatto quando: `cd apps/client && npx vitest run src/panels/open-with.test.ts
src/state/external-editors.test.ts src/ui/menu-budget.test.ts src/ui/menu.test.ts`
passa; una foto del banco del sottomenu aperto su un `.pcraft`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/panels/open-with.test.ts src/ui/menu-budget.test.ts
Stato: [ ] da fare

## T17 · Il prestito

Perché: aprire in GridCraft o in WordCraft un file aperto in Fub non deve
perdere modifiche: Fub salva prima, poi non scrive più finché non lo
riprendi.
Tocca: `apps/client/src/state/lend.ts` (nuovo), `apps/client/src/state/lend.test.ts`
(nuovo), `apps/client/src/state/document-controller.ts`,
`apps/client/src/panels/document.ts`, `apps/client/src/panels/open-with.ts`,
`apps/client/src/i18n/catalog.ts`, `docs/product/craft-files.md` (sezione
«Il prestito»).
Non toccare: `apps/client/src/state/document-session.ts` (salvataggio,
bozze e ricarica restano come sono: il prestito usa `flushPendingSave` e il
sola lettura che ci sono); l'host (il prestito è della shell: l'host non sa
che un file è in prestito); `ui/menu.ts`; `panels/explorer.ts` (T26, in
parallelo).
Dipende da: T16
Cosa fare:
- `state/lend.ts`: `lend(doc, app)`, `unlend(doc)`, `lentTo(doc): string |
  null`, `onLendChanged(listener)`; dimentica tutto alla chiusura del vault.
- `panels/open-with.ts`: scegliendo un'app Craft per un documento che ha una
  scheda aperta e modificabile, prima `flushPendingSave()`; se il documento è
  fra quelli il cui salvataggio è fallito, niente «Apri con» e niente
  prestito, e l'avviso «Non ho potuto salvare: {doc} non si apre in {app}»;
  altrimenti `openWith`, e solo se riesce `lend(doc, app)`.
- `document-controller.ts`: il sola lettura di una scheda è «cancellazione
  in sospeso, o chiusura in corso, o in prestito»: `setReadOnlyForDocument`
  (riga 1955), `freezeDocumentSurfaces` e il montaggio di una scheda nuova
  tengono conto di `lentTo(doc)`; `onLendChanged` ridisegna le schede e le
  loro righe; chiudere l'ultima scheda del documento chiama `unlend`.
- `panels/document.ts`: in `noticeLinesOf` (riga 1363) la riga «Aperto in
  {app}» (tono informativo) con l'azione «Riprendi qui», che chiama `unlend`.
- `catalog.ts`: `lend.notice` «Aperto in {app}. Fub non lo modifica finché
  non lo riprendi.», `lend.resume` «Riprendi qui», `lend.save_failed`, in
  tutte le lingue.
- `lend.test.ts`, con l'host finto: un `.docx` aperto e con una modifica
  in coda, «Apri con WordCraft»: il salvataggio parte prima di
  `openWith`; la scheda passa in sola lettura con la riga; un cambio sul
  disco (l'host finto lo annuncia) ricarica la scheda e non c'è conflitto;
  «Riprendi qui» toglie il sola lettura; il salvataggio fallito non apre
  l'app; chiudere la scheda finisce il prestito; la cancellazione in
  sospeso e il prestito insieme (togliere uno non toglie l'altro).
- «Il prestito» in `craft-files.md`: che cosa fa, come finisce, che Fub non
  sa quando l'app si chiude (A10).
Dal prototipo: nessun prototipo; la riga di T17 («Aperto in GridCraft ·
Riprendi qui»), fatta con le righe d'avviso che `noticeLinesOf` disegna già.
Casi limite: lo stesso documento in due riquadri; il prestito di un file che
Fub mostra già in sola lettura (`.xlsx`: la riga c'è, il resto non cambia);
«Apri con» l'app di sistema (nessun prestito: solo le app Craft); il
documento rinominato mentre è in prestito (il prestito segue il nome nuovo,
con l'evento di rinomina che la shell ha); il vault chiuso; la scheda
riaperta dopo «Riprendi qui».
Fatto quando: `cd apps/client && npx vitest run src/state/lend.test.ts
src/panels/open-with.test.ts src/panels/trash.test.ts` passa (`trash.test.ts`
prova la cancellazione in sospeso, l'altro motivo del sola lettura); una
foto del banco della riga «Aperto in WordCraft · Riprendi qui».
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/lend.test.ts
Stato: [ ] da fare

## T18 · Il prototipo delle anteprime

Perché: D-1 (b), D-5 (d), D-7 (d), D-8 (c) e D-9 (c) portano parti nuove che
si vedono: la domanda sulle anteprime e la riga «spente», i dati sulla foto,
la scheda di un RAW, il PDF nella nota e la sua riga d'avviso, l'albero con
le miniature, le impostazioni nuove. Arrivano solo dopo che l'utente ha
visto il prototipo e ha detto sì.
Tocca: `PLAN-ui/craft-anteprime.html` (la riga «Approvato» in testa e ciò
che l'utente chiede di cambiare), `PLAN.md` (la riga «Prototipo:», la
tabella «Dal prototipo», «Che cosa vede chi usa Fub» e A13 se cambiano),
`DECISIONS.md` (una riga).
Non toccare: il prodotto.
Dipende da: niente; parte subito (la prima versione c'è).
Cosa fare (lo fa l'orchestratore, e prima del sì non dà a nessun coder T19,
T23, T25, T26, T28 o T31):
- Pubblica la pagina come Artifact e la mostra all'utente con le note «Da
  decidere guardando» scritte in testa alla pagina. La barra della pagina fa
  vedere ogni stato (la scheda con la domanda, accese, spente, «Preparo
  l'anteprima…», le frasi del perché manca; la foto coi dati e senza XMP; il
  RAW dritto e girato; la nota col PDF con e senza anteprima; la riga
  d'avviso del PDF; l'albero con le miniature e con gli XMP nascosti; le
  impostazioni), chiaro e scuro, piena e 700 px.
- Ogni cambio chiesto va nella pagina, negli stessi blocchi `<style>` con la
  loro destinazione. Prima di ripubblicare, il CSS passa da
  `sanitizeThemeCss` con la sonda descritta in testa alla pagina, e ogni
  regola scartata si corregge; poi si ripubblica allo stesso link e si
  rimostra.
- Al sì: la data nella testa della pagina («Approvato: AAAA-MM-GG») e nella
  riga «Prototipo:» del piano, e la riga in `DECISIONS.md`. Se un cambio
  tocca il lavoro (una classe, una frase, un'impostazione), cambiano la
  tabella «Dal prototipo» e il task che la usa.
Casi limite: l'utente vuole un pezzo che chiede lavoro nuovo (un'icona nel
kit, un ruolo del tema): si chiede al pianificatore; l'utente cambia una
frase della domanda (cambiano le chiavi in T23 e T31, non la logica);
l'utente vuole le miniature anche delle immagini comuni (è D-10: si chiede,
non si allarga T26); l'utente dice no a un pezzo (la sua parte del task
grafico aspetta la nuova versione, il resto va avanti).
Fatto quando: la riga «Approvato» ha la data nella pagina e nel piano.
Prova: grep -n "Approvato" PLAN-ui/craft-anteprime.html PLAN.md
Stato: [x] fatto (approvato dall'utente il 2026-11-03)

## T19 · Le impostazioni nuove e il consenso

Perché: D-1 (b) vuole le anteprime fatte dalle app spente finché chi usa
Fub non le accende, con la domanda la prima volta; D-8 (c) vuole i 64 MiB
come impostazione; D-7 (d) e D-5 (d) vogliono due interruttori per
l'albero. Il consenso lo fa valere l'host, non la shell (A13): un plugin, un
bundle o un vault importato non lo possono accendere.
Tocca: `crates/fub-host/src/settings.rs` (`craft_settings`, riga 1127, le
chiavi e le frasi in `core_catalog`), `crates/fub-host/src/craft/consent.rs`
(riempie lo scheletro di T20), `crates/fub-host/tests/craft_settings.rs`
(nuovo), `apps/client/bench/scene.mjs` (la scena del gruppo «App esterne»,
accanto a `settings`, riga 149), `docs/product/craft-files.md` (sezione «Le
impostazioni»).
Non toccare: la shell (le impostazioni le disegna il modulo generico, come
per T7: non vanno in `SETTINGS_WITH_THEIR_OWN_GESTURE`); `craft/preview.rs`,
`craft/mod.rs` e `preview/` (T11 e T22 leggono il consenso e il peso
massimo); `crates/fub-format-craft` (l'enum del consenso è di T20);
`craft/photo.rs` (T24, in parallelo); `editors.rs` (T29).
Dipende da: T7, T18, T20
Cosa fare:
- `craft.cli-previews` tiene la sua chiave ma diventa `SettingKind::Choice`
  con tre opzioni, `ask` (la scelta di partenza), `on` e `off`, come
  `FILES_TRASH` (riga 421): di macchina, nel gruppo «App esterne», e **non**
  `program_writable`, con un commento che dice perché, sul modello di
  `PLUGINS_DISABLED` (riga 534).
- Un valore salvato dalla versione di T7 (un booleano) si legge come `ask`,
  mai come `on`: il vecchio `true` era la scelta di partenza, non un sì. Il
  coder segue come il codice legge un valore di un'altra specie e lo prova.
- Le tre nuove, tutte di macchina, nel gruppo «App esterne», sotto
  `#[cfg(feature = "craft")]`: `CRAFT_PREVIEW_MAX_MIB =
  "craft.preview-max-mib"` (`SettingKind::Number` da 1 a 4096, 64);
  `CRAFT_TREE_THUMBNAILS = "craft.tree-thumbnails"` (interruttore spento);
  `CRAFT_TREE_SHOW_XMP = "craft.tree-show-xmp"` (interruttore acceso).
- Le frasi in `core_catalog`, in italiano e in inglese, accanto alle righe
  1875 e 2455, con le chiavi e i testi della tabella «I testi nuovi e
  cambiati» del prototipo:
  - `core.craft.cli_previews` diventa «Anteprime fatte dalle app», con la
    descrizione «Fub fa fare l'anteprima di un file che non ne ha una
    all'app che lo apre, su una copia, solo quando apri il file tu.» e le
    tre scelte `.ask` «Chiedi la prima volta», `.on` «Accese», `.off`
    «Spente», come `core.files_trash.vault`;
  - `core.craft.preview_max_mib` «Peso massimo da leggere per
    un'anteprima (MiB)», con l'unità nel nome come «Corpo del testo (px)»;
    la descrizione «Un file che va letto intero per l'anteprima e pesa di
    più resta senza: i file che si leggono a pezzi non hanno limite.»;
  - `core.craft.tree_thumbnails` «Miniature nell'albero» («Accanto al nome
    di un file Craft, di un RAW, di un PDF o di un documento, la piccola
    anteprima che il file ha già. L'albero non avvia mai un'app.»);
  - `core.craft.tree_show_xmp` «Mostra i file XMP nell'albero» («Spento,
    gli XMP spariscono dall'albero: la ricerca li trova e la foto mostra i
    loro dati.»);
  - `core.craft.editor_paths.desc` (T7) perde l'ultima frase, «Vale su
    questo computer.» («Applies on this computer.»): lo dice già la riga
    «Questa macchina», e nessun'altra impostazione la ripete.
  La scelta a tre la disegna il modulo generico come una tendina
  (`setting-select`): «Chiedi la prima volta» è più lunga di 18 lettere, e
  sopra quella misura `controlFor` non fa pulsanti affiancati. Il peso è un
  campo numerico (`setting-number`). Nessun cambio nella shell.
- `craft/consent.rs`: `pub fn current(host: &dyn HostApi) -> RenderConsent`
  (`ask` se l'impostazione manca, è rotta o di un'altra specie) e `pub fn
  max_bytes(host: &dyn HostApi) -> u64` (i MiB per 1024 × 1024, riportati
  dentro 1–4096 se il valore salvato è fuori). Le due dell'albero le legge
  la shell.
- `tests/craft_settings.rs`: le quattro specifiche (specie, valore di
  partenza, di macchina, il consenso non `program_writable`);
  `set_setting_for_user` del consenso a `on` funziona; un bundle di prova
  che chiama `set_setting("craft.cli-previews", "on")` riceve
  `PermissionDenied`; un vault importato con `craft.cli-previews` nelle sue
  impostazioni non cambia niente (è di macchina); il vecchio `true` vale
  `ask`; `"forse"` vale `ask`; il peso a 0, a 5000 e negativo è rifiutato;
  `current` e `max_bytes` con ogni valore.
- La scena del banco: il gruppo «App esterne» con le cinque impostazioni.
- «Le impostazioni» in `craft-files.md`: le cinque di «App esterne», che
  cosa vuol dire «Chiedi la prima volta», che la CLI di Fub (`--set`) le
  cambia perché è chi usa Fub nel suo terminale, e che un plugin no.
Dal prototipo: la riga delle impostazioni nuove di «App esterne»; i nomi e
le descrizioni sono quelli della pagina approvata.
Casi limite: il consenso cambiato mentre un job è in coda (T11 lo rilegge);
un'app senza la feature `craft` (nessuna delle cinque); il reset del
consenso (torna `ask`); il peso cambiato mentre una scheda è aperta (la
prossima domanda usa il nuovo); le chiavi delle frasi vecchie
(`core.craft.cli_previews`) che cambiano testo ma non nome.
Fatto quando: `cargo test -p fub-host --test craft_settings --test catalogs
--test shell_ids_mirror` e `cargo test -p fub-host --lib settings` passano;
la foto del banco del gruppo «App esterne» somiglia al prototipo, in chiaro e
in scuro.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test
craft_settings
Stato: [ ] da fare

## T20 · Il contratto 2

Perché: le risposte cambiano la forma dell'anteprima (A15): un RAW dà un
JPEG con il suo orientamento, ci sono soggetti nuovi (RAW, PDF, documenti),
la risposta dice perché l'immagine manca e qual è il consenso, e una foto ha
i dati del suo XMP. La forma cambia una volta, qui, col lettore TypeScript e
la sua fixture; i task dopo la riempiono senza toccarla. Qui nascono anche
gli scheletri dei moduli nuovi, così i task della stessa ondata non
scrivono nello stesso file.
Tocca:
- `crates/fub-format-craft/src/contract.rs`, `crates/fub-format-craft/src/jpeg.rs`
  (nuovo), `crates/fub-format-craft/src/lib.rs` (gli scheletri `raw.rs` e
  `office.rs`, solo la riga `//!`), `crates/fub-format-craft/tests/ts_preview.rs`,
  `crates/fub-format-craft/tests/jpeg.rs` (nuovo),
  `apps/client/src/__fixtures__/craft-preview.json` (generata),
  `apps/client/src/host/craft.ts`, `apps/client/src/host/craft.test.ts`;
- `crates/fub-host/src/craft/mod.rs`, `crates/fub-host/src/craft/preview.rs`
  (diventa lo smistamento), `crates/fub-host/src/craft/preview/craft_files.rs`
  e `preview/xmp.rs` (nuovi: il codice di oggi, spostato), gli scheletri
  `preview/raw.rs`, `preview/documents.rs`, `craft/consent.rs`,
  `craft/ranged.rs`, `craft/render.rs`, `craft/photo.rs` (nuovi, solo la
  riga `//!`), `crates/fub-host/tests/craft.rs`;
- `crates/fub-abi/tests/a_named_rule_is_declared.rs` (una riga);
- `apps/client/src/state/craft-previews.ts`, `craft-previews.test.ts`,
  `apps/client/src/editors/craft/surface.ts`, `figure.ts`, `craft.test.ts`,
  `figure.test.ts`, `apps/client/src/host/fake.ts` (le risposte nella forma
  2);
- `docs/reference/craft-formats.md` (la sezione del contratto).
Non toccare: `crates/fub-host/src/craft/launch.rs` e `channel.rs` (T8, T9, in
parallelo); `settings.rs` (T19); `container.rs` (T22); il kernel (T21);
`apps/client/src/i18n/catalog.ts` (le frasi nuove sono dei task che le
mostrano: qui la scheda dice le frasi che ha già).
Dipende da: T6
Cosa fare:
- `contract.rs`, la forma della sezione «Il contratto `CraftPreview`»:
  - `PREVIEW_VERSION` 2; `JPEG_MEDIA_TYPE = "image/jpeg"`;
  - `PreviewImage` con `orientation: u8` (da 1 a 8; 1 vuol dire «così com'è»)
    e `PreviewImage::from_jpeg(bytes, orientation)` accanto a `from_png`;
  - `PreviewSubject` (`vectorcraft`, `photocraft`, `figcraft`, `xmp`, `raw`,
    `pdf`, `document`, `snake_case`) con `ALL`, `id()`, `From<CraftApp>`,
    `editor()` (l'id dell'app di «Le app che Fub conosce» che sa farne
    l'anteprima: `lightcraft` per `raw`, `pdfcraft` per `pdf`, `wordcraft`
    per `document`, nessuna per `xmp`) e `of_extension(ext)` per i tre nuovi:
    RAW `cr3`, `cr2`, `nef`, `arw`, `raf`, `dng`, `orf`, `rw2`; PDF `pdf`;
    documenti `docx`, `odt`, `rtf`, `doc`. Il confronto è
    `eq_ignore_ascii_case` (`IMG_0001.CR3`), con la sua riga in `rules()`,
    famiglia `Family::AsciiCase`, e la ragione di T7. `CraftApp` resta com'è
    (i quattro provider);
  - `PreviewInfo.app: PreviewSubject`;
  - `Missing` (`absent`, `over_limit`, `unreadable`, `failed`); nel
    `CraftPreview` `missing: Option<Missing>` e `limit_bytes: Option<u64>`
    (solo con `over_limit`);
  - `revision: Option<Revision>` (`null` per un'anteprima letta a pezzi:
    T21, T22);
  - `RenderOffer { app, consent: RenderConsent }`, con `RenderConsent`
    (`ask`, `on`, `off`): l'enum che usano `consent.rs` (T19) e la shell;
  - `PhotoSidecar { version, doc, xmp, meta, edits }` e `PHOTO_COMMAND =
    "craft.photo"` (lo riempie T24);
  - una voce di cache vale solo se è della versione 2.
- `jpeg.rs`: `pub fn size(bytes: &[u8]) -> Option<(u32, u32)>`: `FF D8`,
  poi i segmenti fino al primo `SOF` (da `C0` a `CF`, tranne `C4`, `C8` e
  `CC`), ogni lunghezza controllata contro i byte, al più 1000 segmenti;
  misure a zero o oltre 65 535 sono `None`. `tests/jpeg.rs`: un JPEG
  minimo base e progressivo, un `SOF` che manca, una lunghezza che esce,
  mille segmenti vuoti, un file di due byte.
- `ts_preview.rs`: la fixture ha un esempio per ogni `PreviewSubject`, ogni
  `Missing`, ogni `RenderConsent`, un JPEG con orientamento 6, `revision`
  stringa e `null`, un `PhotoSidecar` con e senza XMP; un test controlla che
  ogni variante vi compaia. `craft.ts`: i tipi e i lettori nella forma 2
  (`readCraftPreview`, `readPhotoSidecar`); `craft.test.ts` legge la fixture
  e rifiuta un soggetto inventato, `orientation` 0 o 9, `image/gif`, un
  `limit_bytes` senza `over_limit`, la versione 1.
- `craft/preview.rs` diventa lo smistamento: il soggetto dal formato
  (`host.format_of` e `CraftApp::of_format`, come oggi) o, senza un formato
  Craft, da `PreviewSubject::of_extension`; un file di nessun soggetto resta
  `BadArgs` con la chiave `not_craft`. Il codice di oggi va in
  `preview/craft_files.rs` e `preview/xmp.rs` senza cambiare che cosa fa;
  `preview/raw.rs` e `preview/documents.rs` rispondono `missing: "absent"`
  finché T27 e T30 non li riempiono. `render` resta `null` (T11);
  `revision` è quella di oggi, finché T21 e T22 non la cambiano.
- `craft/mod.rs`: `craft.preview` legge `{ doc, size }` e nient'altro (la
  riga `let _render` se ne va); un test in `tests/craft.rs` prova che
  `{ "render": true }` non cambia la risposta.
- La shell: `previewOf(doc, size, { revision })` non manda più `render`; una
  risposta con `revision: null` vale per ogni revisione chiesta (è stata
  letta adesso); `surface.ts` sceglie la frase da `missing` (il gemello
  `CRAFT_MAX_FILE_BYTES` e `tooLarge` se ne vanno), passa a `decodeImage` il
  `media_type` vero, e il pulsante «Crea l'anteprima» resta com'è fino a T23
  (non avvia niente: il job senza biglietto non parte, T11); `figure.ts`
  mostra un `image/jpeg` come un PNG; `fake.ts` risponde nella forma 2.
- La sezione del contratto in `craft-formats.md`, nella forma 2.
Casi limite: una voce di cache della versione 1 (si ignora e si rifà); un
`.CR3` e un `.Cr3` (sono RAW); un `.pdf` che ha il suo provider (il soggetto
`pdf` vale per l'anteprima, il provider resta per la ricerca); un file senza
estensione (nessun soggetto); un `.xmp` (resta il soggetto `xmp`, dal
formato); un JPEG con l'orientamento 9 nel file (vale 1: lo decide T27, qui
la forma rifiuta solo ciò che è fuori da 1–8).
Fatto quando: `cargo test -p fub-format-craft` e `cargo test -p fub-host
--test craft --lib craft` passano; `cargo test -p fub-abi --test
a_named_rule_is_declared` passa con la riga nuova (e fallisce senza); `cd
apps/client && npx vitest run src/host/craft.test.ts src/editors/craft
src/state/craft-previews.test.ts` passa; la fixture è rigenerata e
committata; le foto del banco di T14 e T15 sono uguali a prima.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft --test
ts_preview; cd apps/client && npx vitest run src/host/craft.test.ts
Stato: [~] in corso · coder · base f2a40b7e

## T21 · Le letture a pezzi nel core

Perché: D-8 (c): per l'anteprima Fub legge solo il pezzo che serve. Oggi
`fub.craft` vede un file solo intero (`read_document_bytes`, fino a 64 MiB)
e ne prende il peso dall'elenco della cartella. Le lease del kernel che
servono il protocollo `fub-asset:` leggono già un pezzo alla volta e si
accorgono di un file cambiato (A14): il bundle le usa senza una porta nuova
nell'ABI.
Tocca: `crates/fub-kernel/src/workspace.rs` (il lettore delle lease, accanto
a `prepare_resource_open`, riga 2716 circa),
`crates/fub-kernel/tests/resource_reader.rs` (nuovo),
`crates/fub-host/src/registry.rs` (accanto a `search_data_dir`, riga 248),
`crates/fub-host/src/mount.rs` (il bundle prende il lettore quando si
registra), `crates/fub-host/src/craft/ranged.rs` (riempie lo scheletro di
T20), `crates/fub-host/src/craft/mod.rs`, `crates/fub-host/src/craft/preview.rs`,
`crates/fub-host/src/craft/preview/craft_files.rs`,
`crates/fub-host/tests/craft_ranged.rs` (nuovo),
`docs/reference/craft-formats.md` (sezione «Letture a pezzi»).
Non toccare: `crates/fub-abi` e la WIT (A14);
`crates/fub-kernel/src/transfer.rs` (`resource_open_on` e
`resource_read_at` si usano come sono); `prepare_resource_open` e
`prepare_resource_read` (il protocollo `fub-asset:` resta com'è);
`crates/fub-host/src/resources.rs`; `crates/fub-format-craft` (T22);
`craft/open_with.rs`, `vault_path.rs`, `settings.rs` (T10, in parallelo).
Dipende da: T6, T20
Cosa fare:
- Nel kernel: `pub fn resource_reader(&self) -> ResourceReader`, con
  `ResourceReader` che tiene il `Vault` clonato (come `prepare_resource_open`
  lo clona a ogni apertura) e non il lucchetto del workspace; `open(&self,
  id: &DocId) -> Result<ResourceLease>` (`valid_doc_id`, poi
  `transfer::resource_open_on`) e `read_at(&self, lease, offset, len) ->
  Result<Vec<u8>>` (il controllo della radice di `check_resource_lease`, poi
  `transfer::resource_read_at` sullo storage del vault). Le stesse recinzioni
  delle due `prepare_*`, con le stesse funzioni. `tests/resource_reader.rs`:
  un `..`, un link simbolico che esce dal vault, un file cambiato fra due
  pezzi (`Stale`), sostituito da uno dello stesso peso e della stessa data
  (l'identità cambia: `Stale`), cancellato, una lease di un altro vault.
- `registry.rs`: `#[cfg(feature = "craft")] pub(crate) fn craft_reader(&self)
  -> Result<ResourceReader, PluginError>`, con il commento sul modello di
  `search_data_dir`: una superficie di `fub.craft` sola, non un accesso ai
  file per ogni bundle.
- Il bundle tiene il lettore e **non prende mai il lucchetto del workspace**
  dentro un comando o un job: il comando gira già col suo `HostApi`, e un
  secondo lucchetto sullo stesso `RwLock` dallo stesso thread può bloccarsi.
- `craft/ranged.rs`:
  - `RangedFile`, `Read + Seek` sopra una lease, a pezzi di 256 KiB, che
    conta i byte letti (`bytes_read()`); un `Stale` è un `io::Error` che il
    chiamante riconosce (`is_stale`);
  - `open(doc)`: il peso dalla lease (`lease.stat.size`), non più
    dall'elenco della cartella (`Folder::read` resta solo per la foto di un
    XMP);
  - `read_all(doc, max)`: il file intero a pezzi fino a `max` (oltre,
    `OverLimit` senza leggere niente), con la revisione calcolata sugli
    stessi pezzi con `fub_abi::RevisionHasher`, la stessa del kernel;
  - `revision(doc, max)`: solo quando serve (la cache delle anteprime fatte
    dalla CLI, l'insieme «già provato» di T11), a pezzi, fino a `max`; con
    una memoria di processo `(radice, doc) → (identità, stat, timbro,
    revisione)` di al più 4096 voci (piena, si svuota), che vale solo finché
    una lease nuova ha la stessa identità, lo stesso `stat` e lo stesso
    timbro: la formula con cui il kernel dice che una lease vale ancora.
- `craft/preview.rs` e `preview/craft_files.rs`: il peso dalla lease; i byte
  con `read_all` fino a 64 MiB (`container::MAX_FILE_BYTES`, finché T22 non
  passa all'impostazione); la revisione della risposta e della cache da
  `read_all`. Un `Stale` si riprova con una lease nuova, al più tre volte
  come oggi (`ATTEMPTS`); poi l'errore di oggi.
- `tests/craft_ranged.rs`, con un vault temporaneo:
  - `read_all` e `revision` danno la stessa revisione di
    `document_revision`;
  - un `RangedFile` aperto, il file riscritto: il pezzo dopo è `Stale`;
  - la memoria delle revisioni: riscrivere il file con lo stesso peso e
    rimettergli la stessa data (`File::set_modified`) cambia lo stesso la
    revisione, perché il timbro di cambiamento è nuovo;
  - un `craft.preview` mentre un altro thread scrive nel vault finisce
    entro 10 s (niente stallo);
  - i byte di ogni file uguali prima e dopo.
- «Letture a pezzi» in `craft-formats.md`: che cosa si legge a pezzi, come
  Fub si accorge di un file cambiato, che cosa si legge ancora intero.
Casi limite: un file vuoto; un file oltre 4 GiB (gli offset sono `u64`); il
vault chiuso con un `RangedFile` aperto (il pezzo dopo fallisce, niente
panico); un supporto senza identità o timbro (la lease non si apre: si torna
a `read_document_bytes` fino a 64 MiB, come oggi); un `Seek` oltre la fine;
l'ultimo pezzo più corto del chiesto.
Fatto quando: `cargo test -p fub-kernel --test resource_reader` e `cargo test
-p fub-host --test craft_ranged --test craft` passano; `cargo test -p
fub-host --lib resources` passa invariato.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test craft_ranged
Stato: [ ] da fare

## T22 · Le anteprime lette a pezzi

Perché: D-8 (c), formato per formato. In uno ZIP (`.pcraft`, `.figcraft`)
l'anteprima è una voce: bastano la fine del file, l'indice e quella voce. Un
`.vectorcraft` è un JSON da leggere dall'inizio, ma i blob dopo
`\n\0VCBLOBS\0` non servono. Ciò che va letto intero ha il limite di T19.
Tocca: `crates/fub-format-craft/src/container.rs`,
`crates/fub-format-craft/tests/containers.rs`,
`crates/fub-host/src/craft/preview/craft_files.rs`,
`crates/fub-host/tests/craft_ranged.rs`, `docs/reference/craft-formats.md`
(sezione «Letture a pezzi»: i tre formati).
Non toccare: `craft/preview.rs`, `craft/mod.rs`, `craft/render.rs` (T11, in
parallelo); `craft/ranged.rs` (si usa com'è); `read_meta` e la ricerca
(l'indice resta al limite del kernel, D-10); la shell (T25, in parallelo).
Dipende da: T19, T20, T21
Cosa fare:
- `container.rs`: `embedded_preview_from<R: Read + Seek>(app, reader, len,
  size)` accanto a `embedded_preview`, che resta per i byte in memoria e
  chiama la nuova su un `Cursor`:
  - ZIP: prima di `zip::ZipArchive::new`, legge gli ultimi 65 557 byte
    (l'EOCD più il commento più lungo) e trova l'EOCD, e se c'è il
    localizzatore e l'EOCD dello ZIP64; una directory centrale oltre 4 MiB,
    oltre 10 000 voci o fuori dal file è un `ContainerError` senza chiamare
    `zip`; poi `ZipArchive::new` sul lettore, `by_name`, `size()` prima di
    leggere (al più 8 MiB), `take`;
  - `info.format_version` del `.pcraft` dalla voce `manifest.json` letta
    allo stesso modo (al più 1 MiB);
  - VectorCraft: un lettore con il tetto del peso massimo, gzip se comincia
    con `1f 8b` (col tetto anche su ciò che si scompatta), letto fino a
    `\n\0VCBLOBS\0` o alla fine; il JSON prima dei blob oltre il tetto è
    `ContainerError::OverLimit` (nuovo, senza testi).
- `preview/craft_files.rs`: `.pcraft` e `.figcraft` con `RangedFile` ed
  `embedded_preview_from`, senza il peso massimo, `revision: null` e senza
  cache (rileggere l'indice costa poco); `.vectorcraft` con `read_all` fino a
  `consent::max_bytes` (T19): oltre, `missing: "over_limit"` con
  `limit_bytes`; sotto, la revisione e la cache come in T21. Uno ZIP rotto o
  che non è uno ZIP è `missing: "unreadable"`.
- `tests/containers.rs`, con un lettore che conta i byte: un `.pcraft` di 1
  GiB finto (un file sparso: una voce STORE enorme fatta con `set_len`, poi
  `thumb.png` e la directory centrale; il CRC della voce enorme non conta,
  perché non si legge) dà l'anteprima leggendo meno di 1 MiB; una directory
  centrale di 5 MiB dichiarata; 10 001 voci; un EOCD che punta fuori dal
  file; un commento dello ZIP che contiene un EOCD finto; uno ZIP64; un
  `.vectorcraft` con 100 MiB di blob dopo il marcatore (file sparso) che dà
  l'anteprima leggendo solo il JSON; un gzip che da 1 MiB diventa 1 GiB (il
  tetto lo ferma).
- `tests/craft_ranged.rs`: lo stesso `.pcraft` di 1 GiB nel vault con
  `craft.preview-max-mib` a 1 dà la sua `thumb.png` (la via a pezzi non
  guarda il limite); un `.vectorcraft` di 2 MiB con il limite a 1 dà
  `over_limit` con `limit_bytes` 1048576, e col limite a 64 l'anteprima.
- In «Letture a pezzi» di `craft-formats.md`: i tre formati, che cosa si
  legge di ognuno, il limite.
Casi limite: la voce in Deflate (si scompatta col tetto di 8 MiB); la voce
che dichiara 1 KiB e ne scompatta 1 GiB (il `take` la ferma); un `.pcraft`
senza `thumb.png` ma con `composite/preview.png` chiesto `large` (come
oggi); il file che cambia mentre si legge l'indice (`Stale`, si riprova come
in T21); un `.vectorcraft` senza il marcatore dei blob; un `.pcraft` di 0
byte.
Fatto quando: `cargo test -p fub-format-craft --test containers` e `cargo
test -p fub-host --test craft_ranged --test craft` passano, e il `.pcraft` di
1 GiB dà l'anteprima leggendo meno di 1 MiB.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft --test
containers
Stato: [ ] da fare

## T23 · La domanda e il gesto nella shell

Perché: D-1 (b): la prima volta che una scheda avrebbe bisogno di un'app,
Fub chiede con una frase chiara; con le anteprime accese l'app parte solo
dopo un gesto (A13). La shell è l'unica che vede il gesto: lo porta
dall'input alla scheda e chiede con `craftRender` (T12), mai con
`craft.preview`. È un task grafico: parte dopo il sì al prototipo (T18).
Tocca: `apps/client/src/editors/craft/consent.ts` (nuovo),
`apps/client/src/editors/craft/consent.test.ts` (nuovo),
`apps/client/src/editors/craft/surface.ts`, `craft.test.ts`, `figure.ts` (il
clic sulla figura è un gesto), `figure.test.ts`,
`apps/client/src/state/craft-previews.ts` (`renderPreview`),
`craft-previews.test.ts`, `apps/client/src/editors/core/registry.ts`
(`SurfaceMountContext`, riga 46), `apps/client/src/state/document-controller.ts`
(`openDocument`, riga 2588), i punti che aprono con un gesto
(`apps/client/src/panels/explorer.ts`, righe 877, 915 e 1018;
`panels/search.ts`, righe 694 e 719; `panels/quick-switcher.ts`, righe 76,
149 e 187; il clic su un link in una nota, che il coder trova da
`document-controller.ts`, righe 808 e 840), `apps/client/src/i18n/catalog.ts`,
`apps/client/src/theme/scrittoio/skin/media.css`,
`apps/client/src/theme/scrittoio/anatomia/media.ts`,
`apps/client/bench/scene.mjs` (le scene), `docs/product/craft-files.md`
(sezione «Le anteprime fatte dalle app»).
Non toccare: `apps/client/src/host/ipc.ts` e `fake.ts` (T12 ha `craftRender`
e il contatore); `state/vault-session.ts`, il ripristino delle schede
(`loadLayout`), `ui/incoming-links.ts` (`fub://open`) e le viste dei
plugin: restano senza gesto, ed è il punto; `crates/` (T13 e T29, in
parallelo).
Dipende da: T12, T18, T20
Cosa fare:
- `SurfaceMountContext.gesture?: boolean` (assente vale `false`) e
  `openDocument(id, options?: { gesture?: boolean })`. Il gesto vale solo
  per il montaggio che quella chiamata fa nascere: un rimontaggio (il tema,
  il riquadro spostato, la scheda riaperta) non lo porta, e nemmeno una
  scheda già aperta che prende il fuoco (resta il pulsante).
- Passano il gesto solo: il clic e Invio su una riga dell'albero, «Apri» del
  suo menu, un risultato della ricerca, il passaggio veloce, il clic su un
  link o su una figura in una nota. Ogni altro `openDocument` resta senza: il
  coder guarda le chiamate una per una (`document-controller.ts`,
  `desktop-shell.ts`, `shells/`) e nel rapporto scrive quelle lasciate
  senza, col perché.
- `state/craft-previews.ts`: `renderPreview(doc, size)` chiama
  `api.craftRender` e tiene la risposta (`queued`) come fa `previewOf`; il
  `job_done` di `craft.render` porta l'immagine come oggi. `previewOf` non
  avvia mai niente.
- `consent.ts`, `mountConsent(root, offer, deps, life)`, secondo
  `render.consent`:
  - `ask`: la domanda «Fub può far fare l'anteprima a {app}, che lavora su
    una copia del file. Vuoi che lo faccia per i file che apri?», con «Sì,
    accendi» e «No, lasciale spente», e sotto «Puoi cambiare idea in
    Impostazioni › App esterne». «Sì» salva `craft.cli-previews` = `on`
    (`api.setSetting`) e poi chiama `renderPreview` (il clic è il gesto);
    «No» salva `off`;
  - `off`: la riga «Le anteprime fatte dalle app sono spente», col link alle
    impostazioni (il gruppo «App esterne»);
  - `on`: il pulsante «Crea l'anteprima con {app}».
  Un `region` col suo nome, i pulsanti nell'ordine del prototipo, Invio e
  Spazio una volta ciascuno, il fuoco sul primo pulsante solo se la scheda
  ha già il fuoco.
- `surface.ts`: `autoAsked` se ne va. Al montaggio, con `context.gesture` e
  il consenso `on`, una sola `renderPreview`; senza gesto, il pulsante.
  `missing` dà la frase: `over_limit` «Il file pesa più del massimo da
  leggere per un'anteprima ({limit})», col link all'impostazione;
  `unreadable` «Il file non si legge: forse è rotto»; `failed` «{app} non è
  riuscita a fare l'anteprima»; `absent` senza app la frase di oggi.
  `{limit}` sono i MiB dell'impostazione (`limit_bytes` diviso 1024 × 1024,
  intero), uno spazio che non va a capo (` `) e «MiB»: «64 MiB», non
  il «64.0 MiB» di `formatBytes`.
- `figure.ts`: il clic apre con il gesto; la figura e l'anteprima al
  passaggio non chiamano mai `renderPreview`.
- `catalog.ts`: le frasi qui sopra con le chiavi del prototipo, in tutte le
  lingue: `craft.consent.region` (il nome del `region`), `.ask`, `.yes`,
  `.no`, `.hint`, `.off`, `.settings`, e `craft.over_limit`,
  `craft.unreadable`, `craft.cli_failed`. `craft.over_limit` prende il posto
  di `craft.too_large`, che se ne va. `media.css` e `anatomia/media.ts`:
  `craft-ask`, `craft-ask-text`, `craft-ask-actions`, `craft-ask-answer`
  (le due risposte, che pesano uguale), `craft-ask-hint`, `craft-off`;
  `craft-render` resta solo per «Crea l'anteprima».
- `consent.test.ts`, con l'host finto che conta `craftRender`: aperta con il
  gesto e `on`, una chiamata; senza gesto, zero; con `ask` la domanda, «Sì»
  salva `on` e chiama una volta, «No» salva `off` e zero; una scheda
  riaperta all'avvio (`loadLayout`), aperta da `fub://open`, da una vista di
  un plugin, rimontata, la figura e il passaggio del puntatore: zero; Invio
  e Spazio su «Sì», una volta ciascuno; il consenso cambiato altrove mentre
  la domanda è aperta (la scheda si ridisegna).
- Le foto del banco: la domanda, la riga «spente», «Preparo l'anteprima…»,
  le frasi di `missing`; in chiaro e in scuro, piena e 700 px.
- «Le anteprime fatte dalle app» in `craft-files.md`.
Dal prototipo: le righe di T23 (la domanda e la riga «spente»), con le
classi nuove nell'anatomia.
Casi limite: lo stesso file aperto con il gesto in due riquadri (una sola
CLI: lo garantisce il core, e la shell non chiede due volte); «Sì» premuto
due volte di fila; `api.setSetting` che fallisce (la domanda resta e dice
l'errore, niente `craftRender`); `craftRender` che risponde `no_consent`
perché il consenso è cambiato nel frattempo (torna la domanda o la riga); la
scheda chiusa prima della risposta; `fub.craft` spento.
Fatto quando: `cd apps/client && npx vitest run src/editors/craft
src/state/craft-previews.test.ts` passa con i casi qui sopra; le foto del
banco somigliano al prototipo, in chiaro e in scuro.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/craft/consent.test.ts
Stato: [ ] da fare

## T24 · La foto e il suo XMP nell'host

Perché: D-5 (d): i dati dell'XMP si vedono anche sulla foto. L'host sa
trovare l'XMP accanto a una foto (il contrario di `photo_candidates` di T3)
e leggerlo; la shell glielo chiede con un comando in sola lettura.
Tocca: `crates/fub-format-craft/src/xmp.rs` (`sidecar_candidates`),
`crates/fub-format-craft/tests/xmp.rs`, `crates/fub-host/src/craft/photo.rs`
(riempie lo scheletro di T20), `crates/fub-host/src/craft/mod.rs` (il comando
`craft.photo`), `crates/fub-host/tests/craft.rs`,
`docs/reference/xmp-sidecars.md` (sezione «Dalla foto all'XMP»).
Non toccare: `craft/preview.rs` e `preview/` (T27, in parallelo);
`settings.rs` e `consent.rs` (T19, in parallelo); `contract.rs` (la forma è
di T20); la shell (T25).
Dipende da: T20
Cosa fare:
- `xmp::sidecar_candidates(photo: &str) -> Vec<String>`: prima
  `IMG_0001.CR3.xmp` (il nome intero più `.xmp`), poi `IMG_0001.xmp` (il
  nome senza l'ultima estensione), così come sono scritti, con le cartelle;
  le stesse due forme di `photo_candidates`, lette al contrario.
- `craft/photo.rs`: `photo(host, doc) -> Result<PhotoSidecar, PluginError>`:
  i candidati che esistono (una domanda sola all'indice per la cartella,
  `IndexQuery::Entries` come fa la foto di un XMP); il primo che si legge
  vince; `meta` da `xmp::read` (col tetto di T3, `MAX_XMP_BYTES`); `edits`
  con `edit_copy_of`, se esiste. Il comando non guarda se `doc` è una foto:
  un file senza XMP accanto risponde `xmp: null`. Un XMP rotto dà il suo
  nome e `meta: null`.
- `craft/mod.rs`: `craft.photo { doc }`, in sola lettura, effetto `Custom {
  ns: "fub.craft", payload }` col `PhotoSidecar`; con `fub.craft` spento il
  comando non c'è.
- `tests/xmp.rs`: i candidati di `IMG_0001.CR3`, `a.b.jpg`, un nome senza
  estensione, `.nascosto`, `Foto/IMG.jpg`. `tests/craft.rs`: un `.jpg` con
  `IMG.jpg.xmp`, con `IMG.xmp`, con tutti e due (vince il primo), senza; un
  XMP rotto; un `.CR3` con la sua `-Edit.psd`; i byte uguali prima e dopo.
- «Dalla foto all'XMP» in `xmp-sidecars.md`: i due nomi, l'ordine, che cosa
  vede la foto.
Casi limite: l'XMP in un'altra cartella (non conta); `IMG.xmp` accanto a
`IMG.jpg` e a `IMG.CR3` (vale per tutte e due, se non hanno il loro); un
`doc` che è già un `.xmp` (`xmp: null`); un candidato che è una cartella;
il vault chiuso.
Fatto quando: `cargo test -p fub-format-craft --test xmp` e `cargo test -p
fub-host --test craft` passano.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test craft
Stato: [ ] da fare

## T25 · I dati sulla foto

Perché: D-5 (d): aprendo una foto accanto a cui c'è l'XMP di LightCraft,
sotto la foto ci sono i suoi dati. È un task grafico: parte dopo il sì al
prototipo (T18).
Tocca: `apps/client/src/editors/craft/photo-data.ts` (nuovo),
`apps/client/src/editors/craft/photo-data.test.ts` (nuovo),
`apps/client/src/state/craft-photos.ts` (nuovo), `craft-photos.test.ts`
(nuovo), `apps/client/src/editors/media/media-surface.ts`
(`MediaSurfaceDeps.photoData?`, come `annotate?` alla riga 33),
`apps/client/src/editors/core/bootstrap.ts` (l'aggancio),
`apps/client/src/host/fake.ts` (la risposta a `craft.photo`),
`apps/client/src/i18n/catalog.ts`, `skin/media.css`, `anatomia/media.ts`,
`apps/client/bench/scene.mjs`, `docs/product/craft-files.md` (sezione «Una
foto»).
Non toccare: `editors/craft/xmp-view.ts` (se ne usano i pezzi; un pezzo da
riusare si esporta, senza cambiarlo); `editors/media/image-view.ts`; la
voce `media.open_external` della barra (T16); `crates/` (T11 e T22, in
parallelo).
Dipende da: T18, T24
Cosa fare:
- `state/craft-photos.ts`, sul modello di `state/craft-previews.ts`:
  `photoOf(doc)` chiede `craft.photo { doc }` e legge con `readPhotoSidecar`
  (T20); una domanda in volo per documento; dimentica la risposta quando
  cambia la foto o uno dei suoi candidati XMP (gli eventi dei documenti che
  la shell ha già) e alla chiusura del vault.
- `photo-data.ts`, `mountPhotoData(root, sidecar, deps, life)`, col DOM
  del prototipo: una `section.photo-data` col nome «Dati di LightCraft»; la
  riga `photo-data-line` con le stelle, l'etichetta col colore (davanti, per
  il lettore di schermo, «Etichetta: » in `sr-only`), la scelta e «Apri
  l'XMP» (`link-button photo-data-open`, apre l'XMP con il gesto); sotto, le
  parole chiave come i tag (`craft-xmp-tags photo-data-tags`, un clic cerca
  `tag:`), che vanno a capo fino a tre righe e poi scorrono. Le classi
  `craft-xmp-*` sono quelle della vista XMP; le nuove sono `photo-data`,
  `photo-data-line`, `photo-data-tags`, `photo-data-open`. Niente se `xmp` è
  `null`; con `meta: null` solo «I dati dell'XMP non si leggono» e «Apri
  l'XMP»; un XMP senza voto, etichetta, scelta né parole chiave dice «L'XMP
  non ha voto, etichetta, scelta né parole chiave» e «Apri l'XMP».
- `media-surface.ts`: per il profilo `media-image`, se `deps.photoData` c'è,
  la riga sotto la foto; la foto si disegna subito e la riga arriva dopo (la
  vista non aspetta l'XMP). `bootstrap.ts` dà `photoData` solo con
  `fub.craft` acceso.
- `catalog.ts`: `craft.photo.region`, `.open_xmp`, `.unreadable`, `.empty`,
  in tutte le lingue; `media.css` e `anatomia/media.ts`: le quattro classi
  nuove, col CSS del prototipo.
- I test: `photo-data.test.ts` (ogni campo assente; l'XMP vuoto; 500 parole
  chiave, tutte nella lista; il voto -1, «Scartata»; l'XMP rotto; il clic su
  una parola chiave; «Apri l'XMP»; il nome della `section`);
  `craft-photos.test.ts` (l'XMP cambiato mentre la foto è aperta aggiorna la
  riga; un XMP creato dopo la fa comparire; il componente spento: nessuna
  domanda; un PDF: nessuna domanda).
- Le foto del banco: un JPG con l'XMP completo, uno senza (uguale a oggi);
  in chiaro e in scuro, piena e 700 px.
- «Una foto» in `craft-files.md`.
Dal prototipo: la riga dei dati sulla foto.
Casi limite: la foto in due riquadri; una foto senza XMP (nessuna riga,
nessuno spazio vuoto); un TIFF o un HEIC che la WebView non mostra (la frase
di oggi, e sotto la riga); un'etichetta che il catalogo non conosce (il
nome com'è); la foto rinominata mentre è aperta.
Fatto quando: `cd apps/client && npx vitest run src/editors/craft/photo-data.test.ts
src/state/craft-photos.test.ts src/editors/media` passa; le foto del banco
somigliano al prototipo, in chiaro e in scuro.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/craft/photo-data.test.ts
Stato: [ ] da fare

## T26 · L'albero: le miniature e gli XMP nascosti

Perché: D-7 (d): le miniature nell'albero si accendono con un'impostazione,
spenta di partenza; D-5 (d): un'impostazione nasconde gli `.xmp`
dall'albero, visibili di partenza. Le miniature mostrano solo ciò che c'è:
l'albero non avvia mai un'app. È un task grafico: parte dopo il sì al
prototipo (T18).
Tocca: `apps/client/src/panels/explorer.ts`,
`apps/client/src/panels/explorer-craft.test.ts` (nuovo),
`apps/client/src/state/tree-thumbnails.ts` (nuovo),
`apps/client/src/theme/scrittoio/skin/tree.css`,
`apps/client/src/theme/scrittoio/anatomia/tree.ts`,
`apps/client/bench/scene.mjs`, `docs/product/craft-files.md` (sezione
«Nell'albero»); solo se l'utente sceglie le miniature da 24 px, anche
`apps/client/src/theme/scrittoio/structure.css` (il token `--tree-thumb`).
Non toccare: `state/craft-previews.ts` (si usa `previewOf` com'è);
`editors/media/orientation.ts` (si usa com'è, T28); la ricerca e il pannello
dei tag (gli `.xmp` nascosti restano lì); `panels/document.ts` e
`state/document-controller.ts` (T17, in parallelo); `docs/product/vault-and-files.md`
(è a 449 righe).
Dipende da: T16, T18, T19, T22, T23, T28 (T16 e T23 scrivono prima in
`explorer.ts`; T28 ha l'orientamento)
Cosa fare:
- Le due impostazioni si leggono come `files.auto-reveal` (la via che
  l'esplora usa già per le impostazioni di macchina); un cambio ridisegna
  l'albero senza riaprirlo.
- Gli XMP nascosti: con `craft.tree-show-xmp` spento, una riga che
  `format-kind.ts` dice XMP non si disegna; la ricerca, il passaggio veloce,
  i backlink e i tag la trovano ancora; una cartella con soli XMP resta (è
  una cartella).
- Le miniature: con `craft.tree-thumbnails` acceso, per le righe in vista di
  un file Craft, un RAW, un PDF o un documento Word (un `IntersectionObserver`
  legato alla `Lifetime`), `previewOf(doc, "small")` attraverso una coda di
  al più 2 domande in volo (`state/tree-thumbnails.ts`), che lascia le righe
  uscite di vista; l'immagine `tree-thumb` (`alt=""`: la riga ha già il
  nome) al posto dell'icona, nella sua colonna; senza immagine l'icona.
  L'orientamento di un RAW lo scrive il codice, come la vista dello zoom
  (T28): `style.transform = orientationTransform(o)` e
  `style.imageOrientation = "none"`, mai una regola della pelle. Mai
  `renderPreview` né `craftRender`. L'URL `blob:` si libera quando la riga
  esce dall'albero o l'albero si chiude.
- L'icona di un RAW: `fileRow` dà a un file che `format-kind.ts` dice
  `photo` (un RAW, T28) l'icona `format-photo`, come dà a un `drawing` la
  sua, anche a miniature spente; oggi un RAW ha 📎.
- `tree.css` e `anatomia/tree.ts`: `tree-thumb`, col CSS del prototipo. Se
  l'utente sceglie la variante da 24 px, anche `--tree-thumb` in
  `structure.css` e la regola `.files-panel[data-tree-thumbs="large"]`;
  altrimenti niente di questi. Nessuna frase nuova: la miniatura non ha
  nome, la riga sì.
- `explorer-craft.test.ts`, con l'host finto: spente, nessuna domanda; accese,
  solo le righe in vista e al più 2 insieme; 500 file in una cartella; la
  cartella chiusa a metà (le domande in coda se ne vanno); `craftRender` a
  zero; gli XMP nascosti e trovati dalla ricerca; l'impostazione cambiata con
  l'albero aperto; un RAW con l'orientamento 6 (la trasformazione
  sull'immagine); un RAW a miniature spente (l'icona delle foto).
- Le foto del banco: l'albero con le miniature e con gli XMP nascosti; in
  chiaro e in scuro, piena e 700 px.
- «Nell'albero» in `craft-files.md`.
Dal prototipo: la riga della miniatura nell'albero e degli XMP nascosti.
Casi limite: un nome lunghissimo con la miniatura (si taglia il nome, non la
miniatura); una miniatura che arriva dopo che la riga è stata rinominata o
cancellata (si scarta); lo scorrimento veloce (le domande delle righe
passate escono dalla coda); un file senza anteprima (l'icona, nessun
riquadro vuoto); `fub.craft` spento (nessuna miniatura; gli XMP seguono lo
stesso l'impostazione, che è dell'albero); la riga col fuoco della tastiera.
Fatto quando: `cd apps/client && npx vitest run src/panels/explorer-craft.test.ts
src/panels` passa; le foto del banco somigliano al prototipo, in chiaro e in
scuro.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/panels/explorer-craft.test.ts
Stato: [ ] da fare

## T27 · I RAW: l'anteprima dentro il file

Perché: D-9 (c) e A16: quasi ogni RAW porta dentro un JPEG fatto dalla
fotocamera. Si legge a pezzi (l'intestazione, gli IFD, il JPEG), senza
decodificare il RAW e senza avviare un'app.
Tocca: `crates/fub-format-craft/src/raw.rs` (riempie lo scheletro di T20),
`crates/fub-format-craft/tests/raw.rs` (nuovo),
`crates/fub-host/src/craft/preview/raw.rs` (riempie lo scheletro di T20),
`crates/fub-host/tests/craft_ranged.rs` (i RAW),
`docs/reference/craft-formats.md` (sezione «I RAW»).
Non toccare: `contract.rs` e `jpeg.rs` (T20); `xmp.rs` (T24, in parallelo);
`craft/preview.rs` e `craft/mod.rs`; `settings.rs` (T19, in parallelo).
Dipende da: T20, T21
Cosa fare:
- `raw.rs`: `embedded_jpegs<R: Read + Seek>(reader, len) -> Result<RawPreviews,
  RawError>`, con `RawPreviews { candidates: Vec<JpegRange { offset, len }>,
  orientation: u8 }`:
  - TIFF (CR2, NEF, ARW, DNG, e ORF e RW2 con le loro firme `IIRO`, `MMOR`,
    `IIU\0`): IFD0, IFD1 e i SubIFD (tag 0x014A); un JPEG da
    `JPEGInterchangeFormat` e `…Length` (0x0201, 0x0202) o da una striscia
    sola con compressione 6 o 7 (0x0111, 0x0117); per RW2 anche il tag
    0x002E. Al più 16 IFD seguiti, 1000 voci per IFD, nessun IFD visitato
    due volte, ogni offset dentro il file. L'orientamento dal tag 0x0112 di
    IFD0, 1 se manca o è fuori da 1–8;
  - CR3 (ISO BMFF, `ftyp` con `crx `): `moov`, poi la `uuid` di Canon con
    `THMB`, e la `uuid` `PRVW` col JPEG grande; al più 8 livelli di scatole,
    ogni misura controllata contro il file e contro la scatola che la
    contiene;
  - RAF (`FUJIFILMCCD-RAW `): l'offset e la lunghezza del JPEG agli offset
    84 e 88, big endian;
  - ogni candidato comincia con `FF D8`, ha le misure di `jpeg::size` e al
    più 8 MiB.
  Per `small` il più piccolo largo almeno 256 px (o il più grande, se
  nessuno lo è); per `large` il più grande.
- `preview/raw.rs`: con `RangedFile` (T21), legge solo l'intestazione, gli
  IFD o le scatole e il JPEG scelto; `PreviewImage::from_jpeg` con
  l'orientamento; `info.app: "raw"`, `info.editor: "LightCraft"`;
  `revision: null`; senza JPEG `missing: "absent"` (LightCraft la offre
  T29); un file rotto `missing: "unreadable"`.
- `tests/raw.rs`, con file costruiti dal test: TIFF `II` e `MM` con IFD0 e
  IFD1; un DNG con un SubIFD; un CR3 con le scatole minime; un RAF con
  l'intestazione; e i cattivi: un anello di IFD, un IFD che dichiara 70 000
  voci, un offset oltre la fine, una scatola di misura 0 o più grande del
  file, 9 livelli di scatole, un JPEG che dichiara 12 MiB, un JPEG senza
  `SOF`. Con un lettore che conta i byte, un RAW sparso di 50 MiB dà
  l'anteprima leggendo il JPEG e al più 256 KiB in più.
- `tests/craft_ranged.rs`: un CR3 e un NEF finti nel vault: `craft.preview`
  `small` e `large` danno `image/jpeg` con l'orientamento 6 di IFD0; i byte
  uguali prima e dopo.
- «I RAW» in `craft-formats.md`: le marche, che cosa si legge, i limiti.
Casi limite: due candidati uguali; un JPEG progressivo (la WebView lo
mostra); un DNG senza anteprima (`absent`); un `.CR3` che è un MP4 qualunque
(`unreadable`); un RAW di 0 byte; un IFD che punta a sé stesso; un JPEG
lungo 0.
Fatto quando: `cargo test -p fub-format-craft --test raw` e `cargo test -p
fub-host --test craft_ranged` passano.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft --test raw
Stato: [ ] da fare

## T28 · La scheda di un RAW

Perché: D-9 (c): un RAW si apre in una scheda come una foto, col JPEG che
ha dentro, lo zoom e i dati del suo XMP; senza JPEG, LightCraft col
consenso. È un task grafico: parte dopo il sì al prototipo (T18).
Tocca: `apps/client/src/editors/craft/surface.ts` (il profilo `raw`),
`craft.test.ts`, `apps/client/src/editors/media/orientation.ts` (nuovo),
`orientation.test.ts` (nuovo), `apps/client/src/editors/media/zoom-view.ts`
e `zoom-view.test.ts` (l'orientamento di partenza),
`apps/client/src/editors/media/image-view.ts` e `image-view.test.ts` (lo
passa alla vista e dice le misure dritte),
`apps/client/src/editors/core/bootstrap.ts` (il RAW alla sua vista),
`apps/client/src/ui/format-kind.ts` (i RAW → `photo`),
`format-kind.test.ts`, `apps/client/src/i18n/catalog.ts`,
`apps/client/bench/scene.mjs`, `docs/product/craft-files.md` (sezione «Un
RAW»). Nessun CSS: l'orientamento lo scrive il codice.
Non toccare: `editors/craft/consent.ts` e `photo-data.ts` (si usano come
sono); `panels/` e `editors/media/media-surface.ts` (T16, in parallelo);
`editors/text/` e `figure.ts` (T31, in parallelo).
Dipende da: T23, T25, T27, T29
Cosa fare:
- `bootstrap.ts`: un RAW (le estensioni di `raw` in T20, in ogni caso di
  lettere) va alla scheda del profilo `raw` solo con `fub.craft` acceso;
  spento, resta il file senza vista di oggi. Il registro ha un solo legame
  per i byte (`sources: { bytes }` della famiglia `viewer`, riga 529): il
  coder segue il codice (la via più semplice è un profilo `media-raw` del
  `viewer` che monta la superficie di `editors/craft` col profilo `raw`) e
  scrive la scelta nel rapporto.
- `surface.ts`, profilo `raw`: chiede `large`; il JPEG con `decodeImage`
  (`mime: "image/jpeg"`) e `mountImageView` con l'orientamento
  dell'anteprima; sotto, la riga dei dati («Foto RAW · CR3 · 24.2 MiB», con
  `formatBytes` come la riga di un file Craft) e `mountPhotoData` (T25);
  senza JPEG, la domanda o il pulsante di T23, con LightCraft.
- L'orientamento lo scrive il codice, non la pelle: la vista dello zoom
  scrive già in linea la trasformazione dell'immagine (`transformOf`), e una
  classe CSS sarebbe sovrascritta; e un tema con un'altra pelle non lo può
  perdere. `editors/media/orientation.ts`: `orientationOf(exif)` dà
  `{ rotation: Rotation, mirrored: boolean }` (1 → 0; 2 → 0 specchiato; 3 →
  180; 4 → 180 specchiato; 5 → 270 specchiato; 6 → 90; 7 → 90 specchiato; 8
  → 270; fuori da 1–8, come 1) e `orientationTransform(exif)` la stringa CSS
  (`""` per 1, `"rotate(90deg)"` per 6, `"rotate(270deg) scaleX(-1)"` per 5,
  e così via). Lo usa anche l'albero (T26).
- `zoom-view.ts`: `ZoomViewOptions.orientation?` e `ZoomState.mirrored`.
  La vista parte con la rotazione del file, «Adatta» e «↻» partono da lì
  (`turned` e `fitted` sanno già la forma ruotata), `transformOf` aggiunge
  `scaleX(-1)` quando è specchiata. Con un orientamento dato l'immagine ha
  anche `imageOrientation = "none"`: se il JPEG dentro il RAW porta il suo
  EXIF, il browser non lo gira una seconda volta.
- `image-view.ts`: `mountImageView` prende l'orientamento e lo passa alla
  vista; la riga delle informazioni dice le misure dritte (800 × 1200 per un
  JPEG coricato 1200 × 800 con l'orientamento 6).
- `format-kind.ts`: le estensioni RAW → `photo`, con la sigla
  dell'estensione in maiuscolo (CR3, NEF…), come dice il prototipo.
- `catalog.ts`: `craft.kind.raw` («Foto RAW»), in tutte le lingue.
- I test: `craft.test.ts` (il profilo `raw` col JPEG e l'orientamento 6, senza
  JPEG col consenso `ask`, la riga dei dati della foto, il componente
  spento); `orientation.test.ts` (le otto, 0, 9); `zoom-view.test.ts`
  (l'orientamento 6 parte a 90 gradi e «↻» va a 180; il 5 è specchiato in
  `transformOf`; «Adatta» usa la forma ruotata; senza orientamento tutto come
  prima); `image-view.test.ts` (le misure dritte); `format-kind.test.ts`
  (`IMG.CR3`, `img.nef`).
- Le foto del banco: un RAW dritto, uno girato, uno senza JPEG con la
  domanda; in chiaro e in scuro, piena e 700 px.
- «Un RAW» in `craft-files.md`.
Dal prototipo: la riga della scheda di un RAW.
Casi limite: un RAW di 60 MiB (la scheda non aspetta niente oltre il JPEG);
solo il JPEG piccolo dentro (si mostra, e lo zoom si ferma alla sua misura);
l'orientamento 8 con lo zoom al massimo; un JPEG dentro il RAW col suo EXIF
(non gira due volte); il RAW rinominato mentre è aperto; un `.dng` aperto da
un link in una nota (il gesto vale: T23).
Fatto quando: `cd apps/client && npx vitest run src/editors/craft
src/ui/format-kind.test.ts src/editors/media` passa; le foto del banco
somigliano al prototipo, in chiaro e in scuro.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/media/orientation.test.ts src/editors/media/zoom-view.test.ts
Stato: [ ] da fare

## T29 · Le CLI di LightCraft, PdfCraft e WordCraft

Perché: D-9 (c): un RAW senza JPEG, un PDF e un documento Word senza
miniatura hanno l'anteprima dall'app che li apre, con le regole di T11 (il
gesto, il consenso, la copia, il biglietto).
Tocca: `crates/fub-host/src/craft/editors.rs` (il campo `cli` di tre app),
`crates/fub-host/src/craft/render.rs` (`cli_args` e l'uscita),
`crates/fub-host/tests/craft_cli.rs`, `docs/reference/craft-formats.md`
(sezione «Anteprime con la CLI»: le tre app), `docs/product/craft-files.md`
(sezione «Quali app trova Fub»: quali fanno anteprime).
Non toccare: `launch.rs` e `craft_render.rs` (si usano come sono); il
soggetto e la sua app (`PreviewSubject::editor`, T20); `crates/fub-cli` e
`control.rs` (T13, in parallelo); la shell (T23, in parallelo).
Dipende da: T11, T27, T30
Cosa fare:
- `editors.rs`: `cli: Some("lightcraft-cli")`, `Some("pdfcraft-cli")` e
  `Some("wordcraft-cli")`; il test che dice quali app hanno la CLI lo sa.
- `cli_args`: le righe della tabella «Le app che Fub conosce», con le misure
  di `large`. La copia si chiama `in.` più l'estensione così come è scritta
  (`in.CR3`): l'app riconosce il formato dal nome, e Fub non piega il caso.
- L'uscita: PNG o JPEG, riconosciuti dalla firma e controllati con
  `PreviewImage::from_png` o `from_jpeg`; altro è `missing: "failed"`.
- Ognuna solo per il suo soggetto e quando manca ciò che c'è dentro:
  LightCraft per un `raw` senza JPEG (mai per un `.jpg`, che la WebView
  mostra); PdfCraft per un `pdf`; WordCraft per un `document` senza
  miniatura.
- `tests/craft_cli.rs`, con tre script finti come in T11: un RAW senza JPEG
  e il consenso `on` dà a `lightcraft-cli` `render <dir>/in.cr3 -o
  <dir>/out.png --size 2048` per `large`; un PDF `small` dà `--dpi 36`; un
  `.docx` con la miniatura non avvia niente (lo script resta a 0), senza la
  avvia; uno script che scrive un JPEG va bene; per ognuna delle tre, le vie
  senza gesto di T11 (senza biglietto, `Call::InvokeJob`, un plugin)
  lasciano lo script a 0.
- In `craft-formats.md` le tre app; in `craft-files.md` quali app fanno le
  anteprime.
Casi limite: un PDF cifrato (la CLI fallisce: `failed`, la stessa revisione
non riparte); un PDF di 500 pagine (solo la prima); un `.doc` vecchio; un
nome di file che comincia con `-` (la copia si chiama sempre `in.<ext>`);
LightCraft che non c'è (niente `render`, nessuna domanda).
Fatto quando: `cargo test -p fub-host --test craft_cli --lib craft::editors`
passa; dopo i test nessun pid scritto dagli script è vivo (`kill -0`, mai
`pgrep -f`).
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test craft_cli
Stato: [ ] da fare

## T30 · Le anteprime dei documenti

Perché: D-9 (c) e A17: un `.docx` o un `.odt` ha spesso la sua miniatura
dentro (`docProps/thumbnail.*` di OOXML, `Thumbnails/thumbnail.png` di ODF),
letta a pezzi come quella di un `.pcraft`; un PDF no, e la fa PdfCraft
(T29).
Tocca: `crates/fub-format-craft/src/office.rs` (riempie lo scheletro di
T20), `crates/fub-format-craft/tests/office.rs` (nuovo),
`crates/fub-host/src/craft/preview/documents.rs` (riempie lo scheletro di
T20), `crates/fub-host/tests/craft_ranged.rs` (i documenti),
`docs/reference/craft-formats.md` (sezione «PDF e documenti»).
Non toccare: `container.rs` (si usa la lettura dello ZIP di T22; se serve,
cambia solo la visibilità di una funzione); i provider di Fub per `.docx`,
`.odt` e `.pdf` (restano com'è); `crates/fub-app` e la shell (T12, in
parallelo).
Dipende da: T20, T21, T22
Cosa fare:
- `office.rs`: `embedded_thumbnail<R: Read + Seek>(reader, len)`: OOXML
  legge `_rels/.rels` (al più 64 KiB) e la relazione
  `http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail`,
  poi quella voce; ODF legge `Thumbnails/thumbnail.png`. Solo PNG e JPEG (un
  `.emf` o un `.wmf` si scarta: la WebView non li mostra), al più 8 MiB, le
  misure dall'intestazione. Il percorso della relazione toglie una `/` in
  testa e rifiuta `..`: è solo un nome di voce, mai un percorso su disco.
- `preview/documents.rs`: `docx` e `odt` con `RangedFile` (T21) e la
  lettura dello ZIP di T22, `revision: null`; `rtf`, `doc` e `pdf` danno
  `missing: "absent"` (la CLI la offre T29); `info.app` `document` o `pdf`,
  `info.editor` WordCraft o PdfCraft.
- `tests/office.rs`: un `.docx` con la miniatura PNG, con una JPEG, con una
  EMF (assente), senza; un `.odt` con e senza; un `.rels` di 1 MiB; 10 000
  relazioni; un bersaglio `../../x` e uno `/docProps/thumbnail.jpeg`.
- `tests/craft_ranged.rs`: un `.docx` sparso di 300 MiB con la miniatura dà
  l'anteprima leggendo a pezzi; un PDF dà `absent` e `info.app: "pdf"`.
- «PDF e documenti» in `craft-formats.md`.
Casi limite: un `.docx` cifrato (non è uno ZIP: `unreadable`); una miniatura
dichiarata e assente; una miniatura di 0 byte; un `.odt` con il `mimetype`
sbagliato (si legge lo stesso: conta la voce).
Fatto quando: `cargo test -p fub-format-craft --test office` e `cargo test -p
fub-host --test craft_ranged` passano.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft --test
office
Stato: [ ] da fare

## T31 · PDF e documenti nella shell

Perché: D-9 (c) e A17: un PDF incorporato in una nota mostra la prima
pagina come figura, quando l'anteprima c'è; aprendo con un gesto un PDF o un
documento Word con le anteprime accese, Fub fa fare a PdfCraft o a
WordCraft l'anteprima che manca, per l'albero, le note e il passaggio del
puntatore; con la domanda ancora aperta, la scheda la fa nella riga
d'avviso. È un task grafico: parte dopo il sì al prototipo (T18).
Tocca: `apps/client/src/editors/text/profiles/markdown/media.ts` (riga 396,
il PDF incorporato), `markdown/media.test.ts`,
`apps/client/src/editors/craft/figure.ts`, `figure.test.ts`,
`apps/client/src/state/preview.ts`, `preview.dom.test.ts`,
`apps/client/src/state/craft-previews.ts` (`renderOnOpen`),
`apps/client/src/state/document-controller.ts` (la chiamata dopo un
`openDocument` con il gesto), `apps/client/src/panels/document.ts`
(`noticeLinesOf`, riga 1363: una seconda azione), `panels/document.test.ts`,
`apps/client/src/i18n/catalog.ts`,
`apps/client/src/theme/scrittoio/skin/document.css` e
`anatomia/document.ts` (la figura), `apps/client/bench/scene.mjs`,
`docs/product/craft-files.md` (sezione «PDF e documenti»).
Non toccare: `editors/media/pdf-view.ts` e il motore dei documenti (le viste
di Fub restano quelle); `editors/craft/consent.ts` (si usano le sue frasi e
le sue funzioni); `editors/craft/surface.ts` (T28, in parallelo);
`panels/explorer.ts` e `open-with.ts` (T16, in parallelo).
Dipende da: T18, T23, T29, T30
Cosa fare:
- `markdown/media.ts`: un `![[x.pdf]]` senza `#page=` con un'anteprima
  `small` diventa la figura di `showEmbeddedCraft` (la prima pagina, il nome
  sotto; un clic apre il PDF con il gesto); senza anteprima, o con
  `#page=N`, il link di oggi. Un `.docx` incorporato resta com'è (mostra il
  suo testo).
- `state/preview.ts`: il passaggio su un link a un PDF o a un documento Word
  mostra la figura quando l'anteprima c'è; altrimenti ciò che mostra oggi.
- `renderOnOpen(doc)` in `craft-previews.ts`, chiamata da `openDocument` solo
  con il gesto e solo per un `pdf` o un `document`: un `craft.preview`
  `small`; se manca e il consenso è `on`, una `renderPreview(doc, "small")`
  in sottofondo (la scheda non aspetta e non mostra niente).
- `noticeLinesOf`: con il consenso `ask`, l'app installata e l'anteprima che
  manca, la riga «Fub può far fare l'anteprima di questo file a {app}, che
  lavora su una copia. Accendo le anteprime fatte dalle app?» (tono
  informativo) con due azioni, «Sì, accendi» e «No, lasciale spente». La
  forma della riga passa da `action` ad `actions` (una lista), e le righe di
  oggi diventano liste di uno; «Sì» salva `on` e chiama `renderPreview`
  (il clic è il gesto), «No» salva `off`; la riga sparisce da ogni scheda
  quando il consenso cambia.
- La riga con due azioni non chiede CSS nuovo: `.sheet-notice` (in
  `skin/sheets.css`, che non si tocca) va già a capo, e ogni azione è un
  `link-button` come oggi.
- `document.css` e `anatomia/document.ts`, col CSS del prototipo:
  `craft-figure`, la figura larga quanto la sua immagine, col nome sotto di
  lei e non al centro della colonna (vale anche per i file Craft di T15); e
  `craft-figure-page`, il filo e l'ombra bassa di una pagina, che la figura
  di un PDF o di un documento ha accanto a `craft-figure-image`.
- `catalog.ts`: `craft.consent.notice`, in tutte le lingue; le due azioni
  usano `craft.consent.yes` e `craft.consent.no` di T23.
- I test: `media.test.ts` (un PDF con anteprima dà la figura, senza il link,
  con `#page=` il link; mai `renderPreview`); `preview.dom.test.ts` (il
  passaggio su un PDF); `document.test.ts` (la riga con due azioni, Invio e
  Spazio una volta ciascuno, «Sì» e «No», le righe di oggi uguali); un PDF
  aperto con il gesto e `on` chiama `craftRender` una volta, senza gesto e
  da una scheda riaperta zero.
- Le foto del banco: la nota col PDF, la scheda del PDF con la riga della
  domanda; in chiaro e in scuro, piena e 700 px.
- «PDF e documenti» in `craft-files.md`.
Dal prototipo: le righe della domanda nella riga d'avviso e del PDF nella
nota.
Casi limite: un PDF aperto in due riquadri (una domanda, la riga in tutti e
due); la risposta data in una scheda mentre l'altra mostra la riga; PdfCraft
non installata (nessuna riga); un PDF protetto (`failed`: la nota mostra il
link); lo stesso PDF dieci volte nella stessa nota (una domanda sola); un
PDF cambiato (la figura si rifà con la revisione nuova); la riga del
prestito di T17 insieme alla domanda (due righe, ognuna con le sue azioni);
un disegno Craft più largo della colonna (la figura resta larga quanto la
colonna, e il nome sotto).
Fatto quando: `cd apps/client && npx vitest run src/editors/text/profiles/markdown/media.test.ts
src/state/preview.dom.test.ts src/panels/document.test.ts src/editors/craft`
passa; le foto del banco somigliano al prototipo, in chiaro e in scuro.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/panels/document.test.ts
Stato: [ ] da fare

## T32 · La CI completa e la revisione prima del merge

Perché: N7 si chiude quando ci sono tutte le parti di D-9 (c), e si fonde in
`main` soltanto dopo la CI completa (Windows, macOS e i banchi) e una
revisione riga per riga di tutto N7: avvia programmi, legge file ostili e
cambia un contratto.
Tocca: la PR #299 (segnata pronta); i file che la revisione trova da
correggere, ognuno con un task nuovo in fondo al piano (e la sua riga in
«Modifiche») o con una correzione piccola, dove `DECISIONS.md` la lascia
all'orchestratore.
Non toccare: i limiti di `apps/client/bench/webview/budgets.json` (nessuno si
alza); i task fatti (un difetto in un task fatto si corregge con un task
nuovo).
Dipende da: tutti gli altri task (T1–T31)
Cosa fare (lo fa l'orchestratore, non un coder):
- `gh pr ready 299`: parte la CI completa (Linux, Windows, macOS, i banchi
  del client).
- Legge ogni job (`gh run view <run> --json jobs`, i log con `gh api
  repos/Fubeo/Fub/actions/jobs/<job>/logs`): ogni rosso ha la sua causa
  scritta. Un test instabile con l'issue aperta si rilancia una volta; senza
  issue, prima si apre l'issue. Nessun rosso è ammesso senza la sua causa.
- Le foto del banco delle scene nuove (T14, T15, T19, T23, T25, T26, T28,
  T31) dal runner, confrontate col prototipo.
- La revisione riga per riga del diff di N7 contro `main` (`git diff
  origin/main...piano/n7-file-craft`): nessuna via che avvia un'app senza un
  gesto e senza il consenso (il cancello, riga per riga); nessun processo
  che resta vivo; nessun file Craft, XMP o del vault scritto; ogni lettura
  di un file con un tetto; nessun lucchetto tenuto mentre si legge un file o
  si aspetta una CLI; i testi in ogni lingua; le pagine di `docs/` che
  dicono il presente; nessun file generato scritto a mano. La revisione si
  scrive nella PR, un commento per area con i file.
- Ogni difetto ha la sua correzione e la CI torna verde.
- Poi chiede all'utente il merge, col link alla PR, l'esito della CI e il
  riassunto della revisione. Il merge si fa soltanto dopo il sì.
Casi limite: un job di Windows o macOS che non parte (si aspetta, non si
salta); un rosso che c'è uguale su `main` (si scrive col run di `main`, non
si nasconde); la revisione trova un difetto in un task fatto (task nuovo, il
vecchio non si riapre); un difetto che cambia ciò che l'utente vede o un
contratto (si chiede, come dice `DECISIONS.md`).
Fatto quando: la PR #299 è pronta e ogni job è verde (un rosso che c'è
uguale su `main` è scritto, col run di `main`); la revisione è scritta nella
PR; nessun task resta aperto; l'utente ha detto sì al merge.
Prova: gh pr checks 299
Stato: [ ] da fare

## Non verificato stanotte

Il codice delle app Craft non è nel repo e nessuna è installata su questa
macchina: queste cose il piano le prende dal passo 12c e le mette dietro un
punto solo, così che cambiarle sia una riga.

- I nomi dei campi per titolo, testo, versione e file collegati (A3: un
  elenco di nomi in `container.rs` e `linked.rs`).
- Gli argomenti veri delle CLI (`convert`, `render`, `--scale`, `-o`,
  `--size`, `--dpi`, `--page`: la tabella «Le app che Fub conosce», in
  `cli_args` di T11 e T29), le misure per `large` che il piano ha scelto, e
  se LightCraft scrive un PNG o un JPEG (T29 li accetta tutti e due).
- Il formato dell'autenticazione dei canali, le porte, le variabili
  d'ambiente oltre `GRIDCRAFT_CONTROL_TOKEN` (`auth_request`, T9).
- Se l'istanza singola di PhotoCraft e PdfCraft porta davvero il file nella
  finestra aperta (lo prova l'utente).
- Il formato di `installed.json` del launcher (T7 lo legge con tolleranza).
- I percorsi su macOS e Windows (scritti, provati solo come regole sui
  percorsi; nessun avvio provato fuori da Linux).
- Se un'app Flatpak vede i file del vault (dipende dai permessi del
  Flatpak; se non li vede, «Apri con» la avvia e l'app non trova il file).
- I namespace veri degli XMP di LightCraft (`lc:`) e il `.pcraft` a
  cartella.
- I RAW veri di ogni marca (A16): T27 prova le forme con file costruiti dal
  test (TIFF, CR3, RAF); quale JPEG ogni fotocamera mette dentro e con quali
  misure lo dice solo un file vero, e gli ID delle scatole `uuid` del CR3
  vengono dalle descrizioni pubbliche del formato.
- Le miniature vere dei documenti: se Word e LibreOffice le salvano (Word di
  solito no, LibreOffice sì), in quale formato e con quale relazione (T30).
- Come `zip` 9.0.5 cerca la fine dello ZIP dentro un lettore a pezzi: il
  test del `.pcraft` di 1 GiB di T22 conta i byte e lo prova; se legge di
  più, T22 lo dice e non passa.
