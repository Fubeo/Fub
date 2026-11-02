# Piano: N6 · La lavagna v1

Branch: piano/n6-lavagna
Obiettivo: sulla lavagna una scheda mostra il contenuto vero del suo file:
la nota resa, le celle del foglio, la pagina del PDF, l'immagine, la pagina
web; ci si entra per scorrere, scegliere e copiare, e la penna (N4) ci scrive
sopra. Si trascinano note e file dall'albero e dal computer: i file esterni
si copiano nel vault una volta sola e nascono in griglia sotto il puntatore.
La lavagna resta fluida perché vivono solo le schede in vista; le altre
mostrano un'immagine ferma.
Perché: oggi una scheda di file è un segnaposto («KIND · percorso» e un link,
`#cardBody` in `apps/client/src/editors/canvas/engine.ts`), anche per una
nota `.md`; dall'albero nasce una scheda di testo col percorso, perché
`resolvePaths` non è collegato (`state/document-controller.ts`). La lavagna
è il centro del lavoro di studio (`riferimenti/lavagna.md`) solo se mostra
ciò che ci si mette.
Fuori scope: lo scrivere dentro le schede (le note con l'editor vero, i
valori dei fogli: area T di `lavagna.md`, D-7); gli estratti (area S: pagine,
zone, figure, sezioni; aspettano P1 e P4 di PdfCraft, bloccati dal mirror
`Fubeo/pdfcraft`); l'impianto del disegno sulla lavagna (colonna degli
strumenti, ispettore, navigatore, banda, spazio Semplice: K5, bloccato dal
mirror `Fubeo/vectorcraft`); la ricerca nella lavagna (H); i fili dai link
delle note (D); le ancore a celle e blocchi (v2, D-6); i nove colori dei
Blocchi (D-13); le istantanee su disco (N2 di `lavagna.md`, v2); le 10 000
schede (N5); tagliare e incollare schede intere fra lavagne; audio e video
(C6); una lavagna dentro una lavagna (G5); dal browser (G4); «Incolla come
foglio» (v2); il formato `fub:ink` e la prova con Obsidian (N4); la CI (i
coder non la toccano: CLAUDE.md); il vault vero.
Assunzioni: A-1…A-14 qui sotto, decise dal pianificatore il 2026-11-02 di
notte (l'utente non poteva rispondere). Le domande D-1…D-19 non bloccano: il
piano segue la prima opzione di ognuna. T19 (l'inchiostro attaccato alla
pagina del PDF) cambia il formato su disco e segue D-4: per questo sta in
un'ondata dopo, a risposta data e dopo N4.
Ondate: T1 T2 T3 | T4 T5 T6 | T7 T8 T9 | T10 | T11 | T12 T13 | T14 | T15 | T16 | T17 | T18 T19 | T20 T21 | T22 | T23
Prototipo: nessuno stanotte. Le parti visibili (sezione «Che cosa si vede»)
riusano pezzi che esistono; le scelte d'aspetto dell'utente sono D-10, D-11,
D-12, D-13. Prima di T22 e T23 serve il prototipo con l'utente (passo 8
della skill `pianifica`): T22 non parte senza.

## Modifiche

nessuna

## Dal prototipo

Nessun prototipo stanotte. Ogni parte visibile riusa un pezzo che c'è già;
la tabella dice dove finisce e chi la fa. I task fino a T21 usano le classi
di oggi e la sola struttura che serve a funzionare (`structure.css`);
l'aspetto vero (colori, bordi, ombre, etichette) lo dà T22 dopo il prototipo.

| Pezzo | Destinazione | Task |
|---|---|---|
| Il corpo di ogni specie di scheda | `apps/client/src/editors/canvas/cards/*.ts`, `apps/client/src/editors/grid/card.ts` | T4–T8 |
| La scheda ferma (istantanea) e quella da lontano | i renderer, con `data-card-mode` sul `.canvas-node` | T4–T8, T13 |
| La scheda attiva (bordo d'accento, «Esc per uscire») | `engine.ts`, `structure.css`; aspetto in `skin/editors.css` | T14, T22 |
| Il fantasma delle schede mentre si trascina | `engine.ts`, `drop-layout.ts`, `structure.css` | T15, T22 |
| Le notifiche «Già nel vault, uso quello» e «Cambia cartella» | `notify` di `ui/notify.ts`, testi in `catalog.ts` | T10 |
| La scheda «File mancante» con «Ritrova…» e «Togli dalla lavagna» | `engine.ts`, `canvas-media-placeholder` e i pulsanti del kit | T16, T22 |
| Il menu della scheda, con la testata | il menu contestuale di `engine.ts` (`SurfaceMenu`) | T17 |
| Le testate con «↩ 2» e «×2» | `engine.ts` (testata di oggi, `canvas-node-title`) | T22 |
| Classi nuove dell'aspetto | `apps/client/src/theme/scrittoio/skin/editors.css` e `anatomia/editors.ts` | T22 |
| La pagina di prodotto | `docs/product/lavagna.md` (nuovo) | T23 |

## Che cosa si vede

Nessun pezzo nuovo del kit: tutto è fatto con ciò che la shell ha già.
L'aspetto preciso (misure, colori, ombre) si decide col prototipo (D-10).

- **La scheda di nota** (un `.md`, e anche un `.docx` o un `.odt`, D-14).
  La testata è quella di oggi (titolo e →). Sotto, la nota resa come
  nell'anteprima delle note, con titoli, elenchi, immagini e formule,
  tagliata alla misura della scheda; se continua, un'ombra in fondo lo dice.
  Con un `subpath` (`Nota#Titolo`) si vede solo quella sezione. Un clic
  sceglie la scheda anche se cade su un link (D-18); entrati nella scheda, i
  link si seguono e il testo si scorre e si seleziona.
- **La scheda di foglio** (un `.xlsx`). Le celle del foglio attivo, con i
  colori del file e la carta del tema come nel foglio aperto, la riga e la
  colonna di intestazione; niente nastro, niente barra della formula,
  niente linguette dei fogli (D-10). La rotella sopra la scheda sposta la
  lavagna. Un clic dentro, o Invio con la scheda scelta, la rende attiva:
  bordo d'accento e «Esc per uscire»; allora la rotella scorre il foglio,
  il trascinamento sceglie le celle e Ctrl+C le copia (come testo a
  tabulazioni). Esc o un clic fuori esce.
- **La scheda PDF.** Una pagina alla volta, adattata alla larghezza, con
  «3 / 24» in basso; al passaggio, ‹ e › ai lati; con la scheda scelta
  PgSu e PgGiù cambiano pagina. Si parte dalla pagina del `subpath`
  (`#page=3`) se c'è, sennò dalla prima; sfogliare non cambia il file (D-5).
- **La scheda d'immagine** (PNG, JPG, WebP, GIF, SVG). L'immagine intera,
  con le sue proporzioni, dentro la scheda; il doppio clic apre il visore
  (`ui/lightbox.ts`). Un SVG è un'immagine ferma, mai il disegno vivo.
- **La scheda di pagina web.** Come oggi: indirizzo e dominio, mai la
  pagina. In più «Mostra l'anteprima», che chiede titolo, sito e
  descrizione con la stessa richiesta delle schede di link delle note (e il
  suo permesso di rete); dopo, si vedono quelli. Senza rete: solo indirizzo
  e dominio, niente rosso.
- **La scheda di file** (CSV, ZIP, audio, video, `.canvas`, i file Craft
  finché N7 non c'è, ogni formato con il componente spento): il segnaposto
  di oggi, «SPECIE · percorso» e «Apri».
- **Da lontano.** Sotto lo zoom 0,35, e per una scheda che non è mai stata
  in vista, la scheda mostra ciò che mostra oggi (titolo e specie) o
  l'ultima immagine ferma che ha avuto (D-12). Spostandosi, le schede che
  entrano in vista si accendono quando il gesto finisce, non durante.
- **La scheda «File mancante».** Grigia: «File mancante: Statistica/voti.xlsx»,
  con «Ritrova…» (cerca per nome nel vault, propone per primo lo stesso
  nome) e «Togli dalla lavagna».
- **Trascinare.** Mentre si trascina sopra la lavagna, rettangoli
  tratteggiati mostrano dove nasceranno le schede (uno per elemento, in
  griglia, a partire dal puntatore). Al rilascio nascono lì, in ordine di
  nome; oltre 12 elementi finiscono in un gruppo «47 file», già scelto.
  Dal computer: la prima volta una notifica dice dove sono andati i file
  («Copiati in attachments/») con «Cambia cartella»; un file che c'è già:
  «Già nel vault, uso quello».
- **Incollare.** Sotto il puntatore se è sulla lavagna, sennò al centro
  della vista. Celle copiate da un foglio: una scheda di testo con una
  tabella Markdown.
- **Il menu della scheda** (tasto destro). Testata «Scheda di foglio ·
  voti.xlsx»; poi Apri, Apri a lato, Collega… (C); Colore › con i pallini
  dei sei colori di oggi; Disponi › (Davanti, Dietro, Allinea, Distribuisci);
  Duplica (Ctrl+D); in fondo, rosso, «Togli dalla lavagna» (Canc), perché il
  file resta nel vault.

## Fonti

- Il passo 15 (N6) dei «Piani di Fub», le regole e i rischi
  (`01-regole-e-decisioni.md`, `03-rischi-e-domande.md`), `riferimenti/lavagna.md`
  (aree C, G, N, P, le tappe e le domande aperte) e `riferimenti/tasto-destro.md`
  (il menu «Scheda della lavagna»). I coder non li leggono: qui c'è ciò che
  serve, e dove il codice dice altro vince il codice (sezione «Differenze
  dal passo 15 e da `lavagna.md`»).
- I piani su cui N6 poggia, letti e non cambiati: N3 (`piano/n3-logica-in-rust`
  @ 7a27eeca: fatti T1–T8), N4 (`piano/n4-inchiostro` @ ae7e299a: fatti
  T1–T7 e T9), N7 (`piano/n7-file-craft` @ b718e196), K3 (`piano/k3-motori`),
  K5 (`piano/k5-disegno`, solo il piano).
- Il codice letto, su `main` @ 620f0acd: `editors/canvas/` (`engine.ts`,
  `surface.ts`, `engine.test.ts`), `editors/core/bootstrap.ts`,
  `state/document-controller.ts`, `editors/media/` (`attachment-target.ts`,
  `resource-port.ts`, `image-view.ts`, `pdf-view.ts`, `media-types.ts`),
  `editors/grid/` (`engine.ts`, `paint.ts`), `crates/fub-host/src/session.rs`
  (`grid_bytes_open`), `crates/fub-host/src/resources.rs`,
  `crates/fub-abi/src/grid_bytes.rs`, `ui/` (`format-kind.ts`, `lightbox.ts`,
  `notify.ts`, `drag-types.ts`, `sanitize.ts`), `host/query.ts`
  (`renderEmbed`, `existingDocuments`), `state/link-cards.ts`,
  `panels/settings.ts`, `panels/explorer.ts`, `bench/webview/`, i presidi in
  `.github/scripts/`; su N4: `ink/quiet.ts` (`PenQuiet.defer(key, work)`),
  `editors/canvas/ink-record.ts`, `anchor.ts`, `docs/reference/canvas-ink.md`.

## Chi aspetta chi

| Task N6 | Parte subito? Dopo quali task di N6 | Aspetta in altri piani | Aspetta una risposta |
|---|---|---|---|
| T1 · il contratto delle schede | subito | nessuno | D-1 (l'elenco delle specie) |
| T2 · la cache delle immagini ferme | subito | nessuno | nessuna |
| T3 · lo stesso file non si duplica | subito | nessuno | D-3 |
| T4 · la scheda di nota | dopo T1, T2 | nessuno | D-14 |
| T5 · la scheda d'immagine | dopo T1, T2 | nessuno | nessuna |
| T6 · la scheda PDF | dopo T1, T2 | nessuno | D-5 |
| T7 · la scheda di foglio | dopo T1, T2 | nessuno | D-6, D-7 |
| T8 · la scheda di pagina web | dopo T1 | nessuno | nessuna |
| T9 · dove nascono le schede | dopo T1 | nessuno | D-11 |
| T10 · le porte per portare dentro | dopo T3 | nessuno (N7 T17 e K5 T24 toccano gli stessi file: chi si fonde dopo ricuce) | D-2, D-3 |
| T11 · la tela tiene le schede | dopo T1 | N3 fino a T18, N4 fino a T16, fusi in `main` | nessuna |
| T12 · il collegamento | dopo T4–T8, T10, T11 | N3 T16 (il montaggio pigro) | nessuna |
| T13 · vive solo le utili | dopo T11 | N4 T2 e T12 (PenQuiet nella tela) | nessuna |
| T14 · entrare e uscire | dopo T12, T13 | nessuno oltre i precedenti | D-7, D-17, D-18 |
| T15 · trascinare e incollare | dopo T9, T12, T14 | nessuno oltre i precedenti | D-2, D-11 |
| T16 · il file mancante | dopo T15 | nessuno oltre i precedenti | nessuna |
| T17 · il menu della scheda | dopo T16 | nessuno oltre i precedenti | D-13, D-19 |
| T18 · la scheda dei file Craft | dopo T12 | N7 T14 e T16; K5 T24 per «Accendi…» | D-15 |
| T19 · l'inchiostro sulla pagina del PDF | dopo T6, T13 | N4 T8–T12 | **D-4 (costosa)** |
| T20 · la misura S3 | dopo T13, T14 | N3 T15, N4 T15, K3 T9 (toccano `budgets.json`) | D-8, D-9 |
| T21 · la prova del cancello | dopo T15, T17 | nessuno oltre i precedenti | nessuna |
| T22 · l'aspetto | dopo T21 | nessuno | D-10–D-13 e il prototipo |
| T23 · la pagina di prodotto | dopo T22 | nessuno | nessuna |

Le ondate 1–4 (T1–T10) non aspettano niente: partono su `main` di oggi,
perché toccano solo moduli nuovi, `attachment-target.ts`,
`document-controller.ts`, `panels/settings.ts` e `catalog.ts`. Le ondate
dalla 5 in poi cambiano `engine.ts`, che N3 T16 e N4 T12–T16 riscrivono:
partono solo quando N3 e N4 sono fusi in `main`. K5 non serve: niente in N6
usa il motore del disegno.

## Domande per l'utente (raccolte, non bloccano)

Il piano procede con la prima opzione di ognuna.

- D-1 · Fin dove arriva la v1 (tutto il piano). (a) Consigliata: N6 è il
  passo 15 più le parti di `lavagna.md` che servono a quel lavoro: G1, G2,
  G3 senza «Incolla come foglio», G6; C2, C3 (in lettura), C4, C5, C7, C8
  (i Craft dopo N7), C14 (solo «×2» nella testata, T22), C15; N1, N3, N4 e
  la misura di N5 sulle 300 schede; il menu della scheda di
  `tasto-destro.md`. Fuori: le aree S (estratti) e T (modifica sul posto),
  la ricerca, il navigatore, la colonna degli strumenti, lo spazio
  Semplice, le 10 000 schede, i fili dai link, il testo che cresce fino a
  480 px (C1). (b) Tutta la v1 di `lavagna.md`. (c) Il passo 15 alla
  lettera, senza «File mancante», gruppo oltre 12 file e menu. Conseguenza:
  (b) è almeno il doppio dei task, e una metà aspetta K5 e PdfCraft, che
  sono bloccati dai mirror; (c) lascia buchi che chi usa vede subito (una
  scheda rotta senza spiegazione, 40 foto da raccogliere a mano).
- D-2 · Dove vanno i file trascinati dal computer (T10, T15). (a)
  Consigliata: nella stessa cartella degli allegati delle note, l'impostazione
  `files.attachment-folder` che c'è già (di serie `attachments`, alla radice);
  «Cambia cartella» apre le Impostazioni su quella voce. Chi la vuole accanto
  alla lavagna scrive `./Allegati`, che il codice sa già fare
  (`folderForNote`). (b) Un'impostazione nuova «Impostazioni › Lavagna ›
  Dove metto i file trascinati», di serie `Allegati/` accanto alla lavagna,
  come dice `lavagna.md` (P). (c) Cambiare il valore di serie di
  `files.attachment-folder` in `./Allegati` per tutti. Conseguenza: (b) è
  un'impostazione nuova nell'host (`crates/fub-host/src/settings.rs`), cioè
  contratto pubblico: un task Rust in più, dopo la risposta; (c) cambia dove
  finiscono anche gli allegati delle note e quelli importati da Obsidian.
- D-3 · Quando un file «è già nel vault» (T3, T10). (a) Consigliata: quando
  nella cartella degli allegati c'è un file con lo stesso nome (o una delle
  varianti «nome 1.ext» che Fub crea) e gli stessi byte; vale per la
  lavagna, le note restano come oggi (un doppione diventa «nome 1.ext»).
  (b) Lo stesso contenuto ovunque nel vault, anche con un altro nome. (c)
  Come (a), anche nelle note. Conseguenza: (b) chiede un indice delle
  impronte nell'host, cioè un IPC nuovo; (a) non riconosce lo stesso file
  rinominato a mano.
- D-4 · L'inchiostro attaccato alla pagina di un PDF (T19). (a) Consigliata:
  un'ancora nuova `{"kind":"page","page":3,…}` nei campi `fub:ink` di N4,
  con i vettori in Rust e in TypeScript e un ADR: cambiando pagina il tratto
  sparisce con lei e torna tornandoci, come chiede C4. (b) In v1 l'inchiostro
  sopra un PDF è della scheda, sopra ogni pagina. Conseguenza: (a) cambia il
  formato su disco di N4, che altri programmi leggeranno: per questo T19
  aspetta la risposta e N4 fuso; con (b) i segni della pagina 3 restano
  sopra la pagina 4.
- D-5 · La pagina che una scheda PDF mostra (T6). (a) Consigliata: non si
  salva; si parte da `#page=N` del `subpath` se c'è, sennò dalla prima.
  (b) Si salva in un campo `fub:page` sulla scheda: riaprendo si torna dove
  si era. Conseguenza: con (b) ogni pagina sfogliata è una modifica del
  `.canvas` (un passo di annulla, un file che cambia anche per Obsidian), e
  un campo nuovo del formato.
- D-6 · Le ancore alle celle (T7). (a) Consigliata: in v2, come dice
  `lavagna.md`; in v1 l'inchiostro sopra un foglio si attacca alla scheda
  (N4) e, scorrendo il foglio dentro la scheda, resta fermo. (b) Ora, come
  scrive il passo 15. Conseguenza: (b) è un'altra ancora del formato su disco
  e un task in Rust in più, dopo N4; con (a) chi scrive su una cella e poi
  scorre vede il tratto staccarsi dalla cella.
- D-7 · Scrivere dentro le schede (T14). (a) Consigliata: dopo N6, in un
  piano suo (area T); in v1 entrare in una scheda vuol dire leggere,
  scorrere, scegliere e copiare; per cambiare si apre il file («Apri», o
  Ctrl+clic sulla testata). (b) In N6: la nota con l'editor vero sulla
  stessa sessione (C2) e i valori del foglio (C3). Conseguenza: (b) porta
  CodeMirror e il giornale del foglio dentro la lavagna: almeno tre task in
  più, e la misura S3 va rifatta.
- D-8 · Lo scenario S3 (T20). (a) Consigliata: S3 cambia come dice il
  cancello: 20 schede di foglio vive (20 `.xlsx` in un blocco, guardati a
  zoom 0,5), le 20 note restano come schede di nota, le soglie della CI si
  ritarano dopo la prima misura sul runner. (b) Uno scenario nuovo accanto
  a S3, che resta com'è. Conseguenza: (a) interrompe la serie delle misure
  di S3 (la pagina in `docs/misure/` lo dice); (b) tiene la serie ma il
  cancello guarda un nome nuovo, e il banco cresce di un giro.
- D-9 · Windows e macOS (il cancello). (a) Consigliata: le misure le prendi
  tu sulle tue macchine col comando di `docs/development/webview-measurements.md`;
  il cancello resta aperto finché non ci sono. (b) Il cancello si chiude con
  la sola misura di Linux, e le altre due arrivano quando arrivano.
  Conseguenza: con (a) N6 non è finito finché qualcuno non lancia la misura
  su una macchina Windows e una macOS.
- D-10 · L'aspetto della scheda attiva e delle testate (T14, T22). (a)
  Consigliata: bordo del colore d'accento e «Esc per uscire» in piccolo
  sopra la scheda; la testata con il titolo, «↩ 2» (quanti la citano) e
  «×2» (la stessa nota due volte); nella scheda di foglio solo il foglio
  attivo, senza linguette. (b) Altro, dal prototipo. Conseguenza: è solo
  aspetto; si decide col prototipo prima di T22.
- D-11 · Quanto è grande una scheda appena nata (T9). (a) Consigliata: nota
  e documento 320×240, foglio 480×300, PDF 360 di larghezza con le
  proporzioni della prima pagina (360×480 finché non si sanno), immagine con
  il lato lungo di 480 e le sue proporzioni (C5), pagina web 320×120, file
  320×160 come oggi; in griglia con 24 px fra le schede. (b) Altre misure.
  Conseguenza: cambiano solo le costanti di `drop-layout.ts`.
- D-12 · La scheda da lontano (T13). (a) Consigliata: sotto lo zoom 0,35 una
  scheda mostra l'ultima immagine ferma che ha avuto in questa seduta; se
  non l'ha mai avuta, il titolo e la specie come oggi. (b) Sempre e solo
  titolo e specie da lontano. Conseguenza: (a) usa memoria (la cache di T2,
  64 MiB di partenza); (b) è più leggera ma da lontano tutte le schede si
  somigliano.
- D-13 · I colori della scheda (T17). (a) Consigliata: in N6 restano i sei
  colori di oggi, nel menu come pallini; i nove colori dei Blocchi col loro
  nome (C10) arrivano dopo, insieme alle note. (b) I nove colori in N6.
  Conseguenza: (b) cambia l'aspetto di tutte le lavagne che esistono (il
  «Viola» di oggi è il colore d'accento) e scrive colori esadecimali nel
  file.
- D-14 · DOCX e ODT (T4). (a) Consigliata: in v1 la scheda mostra
  l'anteprima di lettura che Fub sa già fare (la stessa delle note), non la
  prima pagina impaginata; la pagina vera quando il motore di videoscrittura
  la saprà dare. (b) Una scheda di file finché non c'è la prima pagina.
  Conseguenza: con (a) un documento lungo si vede come testo che scorre, non
  come foglio A4.
- D-15 · Il disegno spento (D-11 di K5, passato a N6). (a) Consigliata: se
  ne parla quando la lavagna avrà gli strumenti del disegno (K5): oggi la
  lavagna non usa il motore del disegno, e non le manca niente da dire. Per
  i file Craft con il componente spento, la scheda offre «Apri con» (N7) e,
  quando K5 T24 c'è, «Accendi…». (b) Ora una riga nella barra della lavagna
  che dice che gli strumenti del disegno arrivano col componente.
  Conseguenza: (b) annuncia una funzione che non c'è.
- D-16 · I file CSV (T1). (a) Consigliata: in v1 un `.csv` è una scheda di
  file (nome e «Apri»), perché Fub non ha ancora un foglio per il CSV
  (`fub-format-xlsx` lo rifiuta). (b) Una scheda di foglio in sola lettura
  con un lettore CSV nuovo nel client. Conseguenza: (b) è codice nuovo che
  il motore dei fogli farà comunque, dopo.
- D-17 · La rotella sposta o ingrandisce (domanda aperta di `lavagna.md`).
  Consiglio di `lavagna.md`: sposta, con un'impostazione per cambiarlo.
  (a) Consigliata per N6: sposta (è già così), e l'impostazione arriva con
  le altre di «Impostazioni › Lavagna», dopo. (b) L'impostazione in N6.
  Conseguenza: (b) è un'impostazione nuova nell'host.
- D-18 · Un clic su un link lo segue subito? (domanda aperta). Consiglio di
  `lavagna.md`: no in Lavagna (prima si sceglie la scheda), sì in Lettura.
  (a) Consigliata: così; dentro una scheda attiva, sì. (b) Sempre sì.
  Conseguenza: con (b) è facile aprire una nota per sbaglio mentre si
  sceglie una scheda.
- D-19 · Il tasto per collegare (domanda aperta). Consiglio di `lavagna.md`:
  C, libero nel disegno e nello Scrittoio. (a) Consigliata: C con una
  scheda scelta fa ciò che fa il pulsante → della testata, e compare nel
  menu come «Collega… · C». (b) Nessun tasto. Conseguenza: nessuna oltre
  la scorciatoia.

Le altre domande aperte di `lavagna.md` non toccano N6 con lo scope di D-1:
i fili dai link (D), dove si salva l'inchiostro (è D-1 di N4), il testo che
cresce fino a 480 px (C1), il selettore che si apre trascinando un PDF, lo
Spazio per leggere da vicino, l'inchiostro degli estratti e la figura come
zona (tutte dell'area S).

## Assunzioni

- A-1 · Lo scope è quello di D-1 (a).
- A-2 · Le cartelle trascinate dall'albero non entrano: l'albero non le mette
  fra le voci (`panels/explorer.ts`, «le cartelle non ci entrano»). Quelle
  trascinate dal computer entrano con tutti i loro file, come oggi
  (`droppedFiles` in `document-controller.ts`).
- A-3 · Una specie senza renderer (il componente spento, un formato senza
  superficie) è una scheda di file, con «Apri».
- A-4 · Una scheda legge, non scrive: nessun renderer scrive nel file della
  scheda. Le sole scritture di N6 sono il `.canvas` e i file depositati dal
  computer o incollati.
- A-5 · Le immagini ferme stanno in memoria (una cache a byte, 64 MiB di
  partenza), non su disco: le istantanee su disco sono N2 di `lavagna.md`,
  v2.
- A-6 · I valori di partenza: vive dallo zoom 0,35 in su (il passo), con un
  margine di mezza vista per lato (il passo, `inflate(view, 0.5)`), al più
  40 schede vive (`MAX_LIVE_CARDS`); la misura di T20 li conferma o li
  cambia, e `docs/reference/canvas-cards.md` dice da dove vengono.
- A-7 · «A fine gesto» vuol dire: al rilascio del puntatore dopo uno
  spostamento, un pizzico o un trascinamento di schede, e 150 ms dopo
  l'ultimo scatto della rotella.
- A-8 · Lasciare cadere un file su una scheda di file ne sostituisce il file,
  come oggi (`#intake`), anche se la scheda è viva.
- A-9 · La scheda di foglio mostra il file salvato; se il file è aperto in un
  riquadro, mostra ciò che mostra il riquadro (il giornale della sessione e
  la sua base).
- A-10 · Il foglio mostrato è quello attivo del file; cambiare foglio dentro
  la scheda non c'è in v1.
- A-11 · La rotella sposta la lavagna fuori da una scheda attiva, come oggi
  (D-17); dentro, scorre la scheda.
- A-12 · Un clic su una scheda non attiva la sceglie, anche sopra un link
  (D-18).
- A-13 · I file del sistema passano tutti da `deposit` (la porta di oggi):
  nessun byte entra nel vault senza la conferma dell'host (`already_exists`,
  limite di 64 MiB).
- A-14 · Il registro delle schede si costruisce dentro il montaggio pigro
  della tela (N3 T16): i renderer non pesano sull'avvio di Fub.

## Il contratto delle schede

Il modulo `apps/client/src/editors/canvas/cards.ts` (T1) è la forma che
tutti i renderer e la tela condividono. Questa è la sua forma; i nomi sono
quelli che i task usano.

```ts
export type CardMode = "live" | "snapshot";
export type CardKind = "note" | "document" | "sheet" | "pdf" | "image" | "web" | "craft" | "file";

/// La specie di una scheda dalla sua forma: `null` per testo e gruppi, che
/// la tela disegna da sé come oggi.
export function cardKindOf(node: CanvasNode): CardKind | null;

export interface CardSize { readonly width: number; readonly height: number }
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/// Le immagini ferme di un file, per parte («w640», «page-3@640»: la parte
/// dice anche la larghezza, arrotondata a 32 px); la cache di T2 ha questa forma.
export interface CardSnapshots {
  get(path: string, part: string): CardSnapshot | undefined;
  put(path: string, part: string, snapshot: CardSnapshot): void;
  forget(path: string): void;
}
export interface CardSnapshot { readonly bitmap: ImageBitmap | HTMLCanvasElement; readonly bytes: number }
export function snapshotPart(prefix: string, width: number): string; // "page-3@640"

export interface CardContext {
  readonly path: string;          // il file, dal vault, senza subpath
  readonly subpath: string | null; // "#page=3", "#Titolo"…
  readonly documentId: string;    // la lavagna
  readonly lifetime: Lifetime;    // si chiude con destroy
  readonly snapshots: CardSnapshots;
  size(): CardSize;               // in unità della lavagna
  zoom(): number;
  missing(): void;                // il file non c'è: la tela mostra C15 (T16)
}

export interface CardView {
  setMode(mode: CardMode): void;
  resize?(): void;                // la scheda ha cambiato misura (fine gesto)
  enter?(): boolean;              // false: non c'è niente in cui entrare
  leave?(): void;
  key?(event: KeyboardEvent): boolean; // true: il tasto è della scheda
  page?(): number;                // la pagina mostrata, da 1 (il PDF; la usa T19)
  destroy(): void;
}

export interface CardRenderer {
  readonly kinds: readonly CardKind[];
  mount(node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView;
}

export interface CardRegistry { rendererFor(kind: CardKind): CardRenderer | null }
export function createCardRegistry(renderers: readonly CardRenderer[]): CardRegistry;

export const LIVE_ZOOM_MIN = 0.35;
export const LIVE_MARGIN = 0.5;
export const MAX_LIVE_CARDS = 40;

/// Le schede che devono essere vive: dentro la vista allargata di metà per
/// lato, dallo zoom 0,35 in su, al più `limit`, le più vicine al centro.
export function liveCardIds(nodes: readonly CanvasNode[], view: Rect, zoom: number, limit?: number): Set<string>;

/// Mette ogni scheda nel modo voluto, nel lavoro rimandato «cards» di PenQuiet.
export function updateLiveCards(
  cards: ReadonlyMap<string, CardView>,
  wanted: ReadonlySet<string>,
  current: Map<string, CardMode>,
  quiet: { defer(key: string, work: () => void): void },
): void;
```

Il passo dava al renderer gli id dei FormatProvider (`formats`) e due metodi
per le ancore di contenuto (`anchorAt`, `place`): qui la specie viene
dall'estensione, come fa la shell in `ui/format-kind.ts` (il client non sa
il provider di un file senza chiederlo), e le ancore non ci sono in T1, che
dà solo `page()`: l'ancora di pagina la aggiunge T19, a risposta data; quelle a celle e blocchi
sono v2 (D-6). `quiet` è la forma di `PenQuiet` di N4 (`ink/quiet.ts`), che
chiede una chiave.

## Differenze dal passo 15 e da `lavagna.md`

Il codice di `main` @ 620f0acd, e i piani N3 e N4, dicono altro in questi
punti; il piano segue il codice.

- Il passo dice che la Markdown ha già «l'anteprima che esiste»: nella
  lavagna no. Ogni scheda di file è un segnaposto, anche un `.md`
  (`#cardBody` di `engine.ts`). `lavagna.md` segna C2–C5 «c'è già»: c'è nel
  resto di Fub (anteprima, foglio, pdf.js, visore), non nella lavagna.
- Dall'albero oggi nasce una scheda di testo col percorso: `resolvePaths` è
  nella porta della tela ma `document-controller.ts` non lo collega (T10).
- La cartella dei file trascinati c'è già ed è una sola per tutto il vault:
  `files.attachment-folder`, di serie `attachments` alla radice, non
  `Allegati/` accanto alla lavagna (D-2).
- Il PDF: il passo dice `PdfEngine.renderPage` (pdf.js), `lavagna.md` C4 i
  tasselli di PdfCraft. Si usa pdf.js, che c'è; PdfCraft aspetta il suo
  mirror.
- L'anteprima di un `.xlsx` esiste già come HTML (`renderEmbed`), ma il
  passo vuole la superficie del foglio: la scheda usa la sessione dei byte
  del foglio (`GridHost`), sola lettura, e la sessione di oggi chiede il
  giornale e la base (`grid_bytes_open` rifiuta una base vecchia con
  `Stale`).
- S3 oggi ha 20 note in schede di file, non 20 fogli, e la lavagna si apre
  inquadrando tutte le 300 schede: a quello zoom (sotto 0,35) nessuna
  sarebbe viva. T20 cambia lo scenario (D-8).
- `MAX_INTERACTIVE_NODES` di `engine.ts` è 2000; `lavagna.md` N5 parla di
  10 000 schede: fuori da N6.
- `#render` di `engine.ts` rifà tutte le schede a ogni cambio: una scheda
  viva (una sessione di foglio, un PDF aperto) morirebbe a ogni modifica.
  T11 lo cambia prima di tutto il resto.
- La rotella oggi sposta, Ctrl+rotella ingrandisce (`#wheel`): coincide col
  consiglio di `lavagna.md`.
- Nel passo `board.cards`, `Board` e `cardsIn` non esistono; `PenQuiet.defer`
  di N4 vuole una chiave.
- Il registro per id di FormatProvider diventa un registro per specie
  dall'estensione (sezione sopra).
- Le ancore alle celle del passo sono v2 per `lavagna.md` (D-6); quella alla
  pagina è v1 per tutti e due, ma cambia il formato di N4 (D-4, T19).
- I colori: `lavagna.md` C10 vuole i nove colori dei Blocchi; la tela ha i
  colori 1–6 scritti come `var(--…)` in `PRESET_FILL` (D-13).
- Il passo dice «istantanee (immagini in cache)»: una nota e un foglio sono
  DOM, e farne un'immagine chiederebbe una libreria che non c'è. Nel piano
  la loro istantanea è il loro DOM fermo (`inert`, nessuna sessione
  aperta); le immagini vere sono quelle di PDF e foto (T2).
- «Cambia cartella» chiede di aprire le Impostazioni su una voce: oggi non
  c'è un modo (T10 aggiunge `revealSetting`).
- Il CSV di C3 non ha una specie né un foglio in Fub (D-16).
- Incollare un'immagine e incollare un indirizzo ci sono già (`#intake`);
  manca solo il «sotto il puntatore» e le celle come tabella (T15).
- La v1 di `lavagna.md` è molto più grande del passo 15 (impianto del
  disegno, ricerca, navigatore, Semplice, estratti, modifica sul posto): la
  linea è D-1.

## Cancello di N6

| Fatto quando | Prova | Task |
|---|---|---|
| S3 con 20 schede di foglio vive: p95 entro 16,7 ms e massimo entro 50 ms fra fotogrammi, su Linux (WebKitGTK) | `npm run bench:webview -- --only=S3 --budgets=targets`, la pagina in `docs/misure/` | T20 |
| la stessa misura su Windows (WebView2) e macOS (WKWebView) | il comando di `webview-measurements.md`, lanciato dall'utente | l'utente (D-9) |
| trascini un `.xlsx` dal sistema, ci scrivi sopra, chiudi e riapri: tutto al suo posto, il file con gli stessi byte | `src/canvas-cards.e2e.test.ts` e la prova a mano in `docs/development/ink-input-smoke-test.md` | T21 |
| nota, foglio, PDF, immagine e pagina web si vedono nella scheda | i test dei renderer e `src/canvas-cards.e2e.test.ts` | T4–T8, T12 |
| vive solo le schede utili; sotto 0,35 nessuna; mai più di `MAX_LIVE_CARDS` | `editors/canvas/engine-cards.test.ts` | T13 |
| mentre la penna è giù nessuna scheda cambia modo | `engine-cards.test.ts` (penna finta) | T13 |
| lo stesso file trascinato due volte non si duplica | `attachment-target.test.ts`, `state/canvas-intake.test.ts` | T3, T10 |

## Regole che valgono per ogni task

- Vince il codice: se un percorso o una funzione non è come scritto qui, il
  coder lo dice nel suo rapporto e segue il codice.
- I numeri di riga e i nomi privati di `engine.ts` (`#render`,
  `#renderLive`, `#cardBody`, `#intake`, `#wheel`, `#keydown`,
  `#applyCamera`, il menu contestuale) sono quelli di `main` @ 620f0acd;
  N3 T16 e N4 T12–T16 cambiano il motore: dopo, si cercano per nome e per
  ruolo.
- Nessuna dipendenza esterna nuova, né in npm né in Rust, e niente in
  `vendor/`.
- CodeMirror e ProseMirror solo nei loro pacchetti
  (`check-codemirror-boundary.mjs`, `check-prosemirror-boundary.mjs`): la
  tela non importa moduli di `editors/text/` (che li tirano dentro), ma
  riceve porte (funzioni) da `bootstrap.ts` o tipi strutturali suoi.
- Il nucleo dell'inchiostro (`apps/client/src/ink/` fuori da `ink/dom/`) non
  usa il DOM (ADR 0204).
- Ascoltatori, osservatori e timer passano da una `Lifetime`
  (`ui/lifetime.ts`) o da un `AbortSignal` come fa la tela:
  `check-listeners.mjs` vieta il resto.
- Il TypeScript degli editor non scrive `var(--ruolo)`
  (`check-inline-theme.mjs`).
- Le classi nuove che hanno un aspetto vanno in
  `theme/scrittoio/skin/editors.css` e sono dichiarate in
  `theme/scrittoio/anatomia/editors.ts` (`anatomia.test.ts`); la struttura
  in `theme/scrittoio/structure.css`. Una classe usata solo dal TypeScript
  non serve dichiararla.
- Testi in `apps/client/src/i18n/catalog.ts`, in italiano (blocco `canvas.*`
  verso la riga 2471) e in inglese (verso la 5390), con gli stessi
  argomenti, senza le parole di `i18n/gergo.ts` (niente «render», «view»,
  «snapshot»: si dice «resa», «vista», «immagine ferma»). `catalog.ts` lo
  tocca al più un task per ondata.
- Rust: niente `unwrap` o `expect` fuori dai test, errori con `thiserror`
  dove il crate lo usa, nessun errore letterale nuovo
  (`check-error-literals.mjs`).
- Le pagine di `docs/` sono in italiano e restano nei limiti di
  `check-doc-size.mjs` (`docs/README.md` 150 righe, riferimento 550,
  decisione 180, il resto 450); `docs/architecture/editor-surfaces.md` è a
  449 e non si tocca. Una pagina nuova è linkata da `docs/README.md`.
- Non scrivere numeri non misurati come misure: i valori di partenza si
  chiamano così.
- Mai il vault vero (`~/.cache/fub-live/`), mai `~/Progetti/Fub`; nei test
  solo vault finti (`host/fake.ts`, cartelle temporanee).
- Prima di una prova Vitest: `npm ci` in `apps/client` se manca
  `node_modules`.

## T1 · Il contratto delle schede

Perché: tutti i renderer (T4–T8, T18) e la tela (T11–T17) parlano la
stessa forma; scritta prima, i renderer si fanno in parallelo.
Tocca: `apps/client/src/editors/canvas/cards.ts` (nuovo),
`apps/client/src/editors/canvas/cards.test.ts` (nuovo),
`apps/client/src/i18n/catalog.ts` (le chiavi `canvas.card.*` dei renderer),
`docs/reference/canvas-cards.md` (nuovo), `docs/README.md` (una riga).
Non toccare: `engine.ts`, `surface.ts`, `model.ts` (N3 T18 lo svuota tenendo
i tipi: `cards.ts` importa solo `type CanvasNode`); `ui/format-kind.ts` (N7
ci aggiunge specie: `cardKindOf` lo usa, non lo cambia); le righe che N3 e
N4 aggiungono a `docs/README.md` prima del «server MCP».
Dipende da: nessuno
Cosa fare:
- I tipi e le funzioni della sezione «Il contratto delle schede», con i
  commenti in italiano.
- `cardKindOf`: `text` e `group` → `null`; `link` → `web`; `file`: si
  guarda l'estensione del percorso, in minuscolo, senza `subpath`; `md`,
  `markdown` → `note`; ciò che `formatKindOf` dice `word` o `odt` →
  `document`; `sheet` → `sheet`; `mediaKindOfId` `pdf` → `pdf`, `image` →
  `image` (l'SVG è un'immagine, anche se `formatKindOf` lo dice `drawing`);
  tutto il resto (CSV, `.canvas`, audio, video, ZIP, senza estensione) →
  `file`. `craft` è nel tipo ma nessuna estensione ci porta finché T18 non
  la aggiunge.
- `createCardRegistry`: una specie con due renderer è un errore
  (`Error("card kind <specie> has two renderers")`), detto subito, non al
  primo uso.
- `liveCardIds`: niente sotto `LIVE_ZOOM_MIN` (insieme vuoto); la vista
  allargata di `LIVE_MARGIN` della sua larghezza e altezza per lato; dentro
  vuol dire che il rettangolo della scheda la tocca; solo le schede con una
  specie (`cardKindOf` non `null`); se sono più di `limit`, restano le più
  vicine al centro della vista (a pari distanza, l'ordine del file).
- `updateLiveCards`: confronta `wanted` con `current` e chiama `setMode`
  solo dove il modo cambia, tutto dentro `quiet.defer("cards", …)`;
  `current` si aggiorna nel lavoro rimandato, non prima.
- Le parti delle immagini ferme si scrivono come dice il commento di
  `CardSnapshots` (larghezza arrotondata a 32 px): i renderer le
  costruiscono con una funzione `snapshotPart(prefix, width)` esportata qui.
- In `catalog.ts`, IT ed EN: `canvas.card.loading` («Apro…»),
  `canvas.card.unreadable` («Non riesco a mostrare {name}»),
  `canvas.card.page` («{page} / {pages}»), `canvas.card.previous_page`,
  `canvas.card.next_page`, `canvas.card.sheet_unavailable` («Il foglio non
  si può mostrare qui: aprilo»), `canvas.card.show_preview` («Mostra
  l'anteprima»), `canvas.card.open` («Apri»), `canvas.card.too_large`
  («{name} è troppo grande per la scheda»). Il coder sistema le parole, non
  il loro numero.
- `docs/reference/canvas-cards.md`: che cos'è una scheda viva e una ferma,
  le specie e da quale estensione, il contratto, le regole di
  `liveCardIds` con i valori di partenza (A-6) e da dove vengono, che un
  renderer non scrive mai il file (A-4). Una riga in `docs/README.md`
  subito dopo «Il server MCP» (N3 e N4 aggiungono le loro prima: così il
  merge non si tocca).
Casi limite: un percorso con un punto nel nome di una cartella e nessuna
estensione (`Corsi.2026/leggimi`) → `file`; estensione maiuscola (`FOTO.JPG`)
→ `image`; un `subpath` con un punto (`Nota.md#1.2 Titolo`) non conta per
l'estensione; zoom esattamente 0,35 → vive; vista vuota (larghezza zero) →
nessuna; due schede alla stessa distanza dal centro; `limit` 0; una scheda
più grande della vista che la contiene tutta.
Fatto quando: `cards.test.ts` prova ogni ramo di `cardKindOf`, il doppione
nel registro, `liveCardIds` (sotto e sopra 0,35, margine, limite, ordine) e
che `updateLiveCards` chiama `setMode` solo nel lavoro rimandato e solo
dove il modo cambia (un `quiet` finto che tiene i lavori finché il test non
li lascia andare).
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards.test.ts
Stato: [ ] da fare

## T2 · La cache delle immagini ferme

Perché: tornando su una scheda PDF o d'immagine, la sua immagine ferma deve
esserci subito, senza rileggere e ridisegnare il file; e la memoria deve
avere un tetto.
Tocca: `apps/client/src/editors/canvas/card-cache.ts` (nuovo),
`apps/client/src/editors/canvas/card-cache.test.ts` (nuovo).
Non toccare: `cards.ts` (T1, stessa ondata: la cache ha la forma
`CardSnapshots` di T1 per struttura, senza importarla); le cache di
`state/document-caches.ts` (sono dei documenti, non delle schede).
Dipende da: nessuno
Cosa fare:
- `export class CardCache` con `constructor(limitBytes = 64 * 1024 * 1024)`,
  `get(path, part)`, `put(path, part, snapshot: { bitmap, bytes })`,
  `forget(path)`, `clear()`, `size()` (i byte tenuti). Dentro, una mappa per
  percorso e un ordine d'uso comune a tutte le voci.
- Il più vecchio usato esce per primo quando i byte superano il tetto; chi
  esce viene chiuso (`ImageBitmap.close()` se c'è; un `HTMLCanvasElement`
  si rimpicciolisce a 0×0 perché il motore liberi la memoria).
- `get` rinfresca l'età; `put` con una chiave che c'è sostituisce e chiude
  la vecchia; una voce più grande del tetto intero non entra (e si chiude
  subito).
- `forget(path)` toglie e chiude tutte le parti di quel file, solo di quello.
Casi limite: tetto 0; `put` della stessa voce due volte; `forget` di un
percorso che è il prefisso di un altro (`a.pdf` e `a.pdf.bak`: il secondo
resta); `bytes` 0 o negativo (si tratta come 1); `close` che lancia (si
ignora, la voce esce lo stesso); un percorso con caratteri strani (la
mappa non li interpreta).
Fatto quando: `card-cache.test.ts` prova l'ordine di uscita, il tetto,
`forget` col prefisso, la chiusura di chi esce (bitmap finti che contano le
chiusure).
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/card-cache.test.ts
Stato: [x] fatto

## T3 · Lo stesso file non si duplica

Perché: G2 di `lavagna.md`: trascinare due volte lo stesso file non deve
fare «foto 1.jpg», «foto 2.jpg».
Tocca: `apps/client/src/editors/media/attachment-target.ts`,
`apps/client/src/editors/media/attachment-target.test.ts` (nuovo).
Non toccare: `depositAttachment` e `depositFiles`, che le note e il
registratore usano (`recorder.ts`, `mountAttachmentDropPaste`): il loro
comportamento resta identico (D-3); l'host (`resources.rs`).
Dipende da: nessuno
Cosa fare:
- `export async function depositOrReuse(target: AttachmentDeposit, name,
  bytes, same: (id: string, bytes: Uint8Array) => Promise<boolean>):
  Promise<{ receipt: AttachmentReceipt; reused: boolean }>`.
- Prova i candidati nello stesso ordine di `depositAttachment`
  (`attachmentCandidate`); quando l'host risponde `already_exists`, chiede
  `same(id, bytes)`: se `true` restituisce quell'id con `reused: true`
  (la revisione è quella del descrittore, o `null` se il lease non la
  porta); se `false`, o se `same` lancia, passa al candidato dopo.
- Gli stessi limiti di `depositAttachment` (64 MiB, nome vuoto →
  `errors.attachment.no_name`).
- Test anche per `depositAttachment`, che oggi non ne ha: il candidato
  dopo un `already_exists`, il nome vuoto, il limite.
Casi limite: il file c'è con lo stesso nome ma byte diversi (nasce «nome
1.ext»); c'è «nome 1.ext» uguale e «nome.ext» diverso (si riusa «nome
1.ext»); `same` lento e la scrittura di un altro nel frattempo; byte vuoti;
nome con caratteri che il vault rifiuta (lo dice l'host, come oggi).
Fatto quando: `attachment-target.test.ts` passa con un `write` finto che
risponde `already_exists` e un `same` finto; le prove di oggi delle note
passano senza cambiare.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/media/attachment-target.test.ts
Stato: [ ] da fare

## T4 · La scheda di nota

Perché: C2 di `lavagna.md` e il primo punto del passo: una nota sulla
lavagna si legge, non è un nome.
Tocca: `apps/client/src/editors/canvas/cards/note.ts` (nuovo),
`apps/client/src/editors/canvas/cards/note.test.ts` (nuovo).
Non toccare: `engine.ts` (la tela la monta in T11–T13); `host/query.ts` e
`state/preview.ts` (la resa arriva da una porta); `editors/text/` (niente
editor dentro la scheda: D-7).
Dipende da: T1, T2
Cosa fare:
- `export function noteCardRenderer(port: NoteCardPort): CardRenderer` con
  `kinds: ["note", "document"]` e `interface NoteCardPort { show(path,
  heading: string | null, host: HTMLElement, life: Lifetime): Promise<void>;
  watch(path, changed: () => void): () => void }`. In T12 la porta è
  `renderEmbed` più la stessa montatura sicura che usano le schede di testo
  (`mountMarkdown` o `setSanitizedHtml`), fatta in `document-controller.ts`.
- `heading` viene dal `subpath` (`#Titolo` → `Titolo`; `#^blocco` → nessun
  titolo, la nota intera).
- Vivo: chiama `show`; mentre aspetta, «Apro…»; se `show` lancia, la scheda
  di file di oggi con `canvas.card.unreadable`; se l'errore dice che il file
  non c'è, chiama `context.missing()`.
- Fermo: il contenuto che c'era resta, con `inert` e senza ascoltatori;
  se non è mai stato vivo, titolo e specie (il segnaposto di oggi).
- `watch`: quando il file cambia, se vivo si ridisegna, se fermo si segna
  da rifare alla prossima accensione.
- `enter()` restituisce `true` (si scorre e si seleziona); `leave()` lascia
  lo scorrimento dov'è.
Casi limite: nota vuota; nota enorme (la resa la taglia l'host come per gli
embed); un titolo del `subpath` che non c'è (la nota intera, come gli embed);
`destroy` mentre `show` aspetta (il risultato non tocca più il DOM); la
stessa nota due volte sulla lavagna; un `.docx` che `renderEmbed` non sa
rendere (scheda di file, D-14).
Fatto quando: `note.test.ts`, con una porta finta, prova vivo, fermo, mai
stato vivo, errore, file mancante, cambio del file da fermo e da vivo, e
che dopo `destroy` nessuna risposta tardiva scrive nel DOM.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/note.test.ts
Stato: [ ] da fare

## T5 · La scheda d'immagine

Perché: C5: foto e schermate si vedono nella scheda.
Tocca: `apps/client/src/editors/canvas/cards/image.ts` (nuovo),
`apps/client/src/editors/canvas/cards/image.test.ts` (nuovo).
Non toccare: `editors/media/image-view.ts` (si usa `decodeImage`, non si
cambia); `ui/lightbox.ts` (arriva da una porta).
Dipende da: T1, T2
Cosa fare:
- `export function imageCardRenderer(port: ImageCardPort): CardRenderer`,
  `kinds: ["image"]`, con `interface ImageCardPort { read(path):
  Promise<{ bytes: Uint8Array; descriptor: ResourceDescriptor } | null>;
  open(path): void; watch(path, changed): () => void }` (in T12: la
  `ResourceTransport` di `options.media` con `openResourcePort`, e il
  visore).
- Vivo: legge, `decodeImage`; un raster diventa un `ImageBitmap` largo al
  più il doppio della scheda (`createImageBitmap` con `resizeWidth`; se il
  motore non lo sa fare, un `<canvas>` 2D), messo in `context.snapshots`
  con la parte `snapshotPart("w", width)`; un SVG resta un `<img>` inerte con
  l'URL del blob (mai nel DOM come SVG). L'URL si revoca con la `Lifetime`.
- Fermo: l'immagine in cache se c'è, sennò titolo e specie.
- Doppio clic: `port.open(path)` (la tela lo instrada in T14).
- Il lettore ha un tetto: oltre 64 MiB `canvas.card.too_large`.
Casi limite: immagine 1×1 e 20 000×20 000 (si riduce, non si decodifica
intera due volte); formato che il motore non decodifica (HEIC, AVIF:
scheda di file con `canvas.card.unreadable`); GIF animata (la prima
immagine, ferma); file che cambia mentre si decodifica; `null` dalla porta
(`context.missing()`).
Fatto quando: `image.test.ts` prova la riduzione (larghezza chiesta a
`createImageBitmap`), la cache (seconda accensione senza `read`), SVG come
`<img>`, il tetto, il file mancante, la revoca dell'URL a `destroy`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/image.test.ts
Stato: [ ] da fare

## T6 · La scheda PDF

Perché: C4 e il passo: una pagina del PDF nella scheda, sfogliabile.
Tocca: `apps/client/src/editors/canvas/cards/pdf.ts` (nuovo),
`apps/client/src/editors/canvas/cards/pdf.test.ts` (nuovo).
Non toccare: `editors/media/pdf-view.ts` (si usa `PdfEngine` così com'è);
`editors/spatial/pdf/` (le annotazioni); il formato `.canvas` (la pagina non
si salva: D-5).
Dipende da: T1, T2
Cosa fare:
- `export function pdfCardRenderer(port: PdfCardPort): CardRenderer`,
  `kinds: ["pdf"]`, con `interface PdfCardPort { read(path): Promise<Uint8Array
  | null>; load: PdfEngineLoader; watch(path, changed): () => void }` (in
  T12: la `ResourceTransport` e `options.media.pdfLoader ?? loadPdf`, come
  le annotazioni in `bootstrap.ts`).
- Vivo: apre il `PdfEngine`, disegna la pagina corrente con `renderPage` in
  un `<canvas>` largo quanto la scheda per lo zoom (al più 2× la scheda),
  mette i pixel in cache (parte `snapshotPart("page-N", width)`); «3 / 24»
  in basso, ‹ e › ai lati.
- La pagina di partenza: `#page=N` del `subpath` (da 1), sennò la prima;
  fuori dall'intervallo, la prima.
- `key()`: PgSu e PgGiù cambiano pagina e restituiscono `true`; Home e Fine
  la prima e l'ultima.
- Fermo: `destroy` del `PdfEngine` (un PDF chiuso non tiene il worker), resta
  l'immagine della pagina dalla cache.
- `resize()`: ridisegna alla nuova larghezza a fine gesto.
- `page()` del `CardView` dà la pagina mostrata (da 1): la usa T19.
Casi limite: PDF di una pagina (niente frecce); PDF cifrato o rotto
(`canvas.card.unreadable`); pagina orizzontale; una resa interrotta da
un'altra (vince l'ultima); `destroy` mentre pdf.js carica; cambio pagina
mentre la scheda è ferma (non si può: i tasti arrivano solo da viva);
`subpath` `#page=0` o `#page=abc`.
Fatto quando: `pdf.test.ts`, con un `PdfEngine` finto, prova la pagina di
partenza, PgSu/PgGiù, la cache, la chiusura del motore da fermo, il
file mancante, la risposta tardiva dopo `destroy`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/pdf.test.ts
Stato: [ ] da fare

## T7 · La scheda di foglio

Perché: C3 e il passo: un `.xlsx` sulla lavagna mostra le sue celle, in
lettura, con la selezione e la copia.
Tocca: `apps/client/src/editors/grid/card.ts` (nuovo),
`apps/client/src/editors/grid/card.test.ts` (nuovo).
Non toccare: `editors/grid/engine.ts` e `paint.ts` (si importano tipi e
`paintCell`, non si cambiano); l'host (`grid_bytes_open`); la Tabella
(`src/tabella/`); `applyGridBytes`: la scheda non scrive (A-4, D-7).
Dipende da: T1, T2
Cosa fare:
- `export function sheetCardRenderer(port: SheetCardPort): CardRenderer`,
  `kinds: ["sheet"]`, con `interface SheetCardPort { host: GridHost;
  source(path): Promise<{ journal: string; base: string; format: string |
  null } | null>; paper(): GridPaper | undefined; watch(path, changed):
  () => void }`. In T12 `source` dà il giornale e la base della sessione
  aperta del documento se c'è (A-9), sennò `readDocument` (giornale vuoto,
  revisione dei byte su disco).
- Vivo: sceglie la superficie come fa il foglio (`family === "grid"`, la
  versione del protocollo, il formato), `openGridBytes`, il foglio attivo
  visibile, chiede con `gridBytesWindow` solo le righe e colonne che si
  vedono, disegna ogni cella con `paintCell` (le intestazioni comprese).
  Senza superficie o con un errore: `canvas.card.sheet_unavailable` e
  «Apri».
- `enter()`: lo scorrimento interno (rotella) chiede le finestre nuove; il
  trascinamento sceglie un rettangolo di celle; Ctrl+C copia come testo a
  tabulazioni (`tsvRows` di `editors/core/tsv.ts`, via `writeClipboardText`).
  `leave()`: la selezione si toglie, lo scorrimento resta.
- Fermo: `closeGridBytes` (nessuna sessione aperta per una scheda ferma);
  resta il DOM delle celle, `inert`.
- `watch`: il file cambia → da viva si riapre la sessione, da ferma si segna.
Casi limite: `Stale` all'apertura (il file è cambiato fra `source` e
l'apertura: si riprova una volta, poi `sheet_unavailable`); foglio vuoto;
foglio di 1 048 576 righe (solo la finestra); tutti i fogli nascosti; celle
unite (`merges`); `destroy` con una finestra in volo (la sessione si chiude
lo stesso, una volta sola); due schede dello stesso file (due sessioni).
Fatto quando: `card.test.ts`, con un `GridHost` finto, prova apertura,
finestra, scorrimento da attiva, selezione e copia, chiusura della
sessione da ferma e a `destroy`, `Stale`, e che `applyGridBytes` non è mai
chiamato.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/grid/card.test.ts
Stato: [ ] da fare

## T8 · La scheda di pagina web

Perché: C7: titolo, sito e descrizione di una pagina, solo su richiesta.
Tocca: `apps/client/src/editors/canvas/cards/web.ts` (nuovo),
`apps/client/src/editors/canvas/cards/web.test.ts` (nuovo).
Non toccare: `editors/text/profiles/markdown/link-card.ts` (porta
CodeMirror: la scheda ha un tipo strutturale suo); `state/link-cards.ts`
(arriva da una porta in T12).
Dipende da: T1
Cosa fare:
- `export function webCardRenderer(port: WebCardPort): CardRenderer`,
  `kinds: ["web"]`, con `WebCardPort` della stessa forma di `LinkCardSource`
  (`view(url)`, `request(url)`, `watch(changed)`), tipi copiati in
  struttura, e `open(url)` (il visore di oggi, `media.openViewer`).
- Sempre: indirizzo e dominio come oggi (`canvas-url-text`,
  `canvas-open-url`); se `view(url)` ha una scheda, titolo, sito,
  descrizione e icona (l'icona solo se `isAllowedLink` di `ui/sanitize.ts`
  la ammette); se non c'è, «Mostra l'anteprima» chiama `request(url)`.
- Mai un iframe, mai una richiesta di rete fatta dalla scheda.
Casi limite: indirizzo non valido (resta il testo, nessun pulsante);
anteprima fallita (indirizzo e dominio, niente rosso); `watch` dopo
`destroy`; titolo lunghissimo (si taglia con i puntini dal CSS).
Fatto quando: `web.test.ts` prova i quattro stati della porta, che la
scheda non fa richieste da sé e che «Mostra l'anteprima» chiama `request`
una volta.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/web.test.ts
Stato: [ ] da fare

## T9 · Dove nascono le schede

Perché: G1, G3, G6: più file insieme in griglia, in ordine di nome, sotto
il puntatore; oltre 12 in un gruppo.
Tocca: `apps/client/src/editors/canvas/drop-layout.ts` (nuovo),
`apps/client/src/editors/canvas/drop-layout.test.ts` (nuovo).
Non toccare: `engine.ts` (la usa T15); il gruppo di Ctrl+G della tela (la
regola dei 24 px è la stessa, il codice no).
Dipende da: T1
Cosa fare:
- Funzioni pure, senza DOM: `bornSize(kind: CardKind, image?: { width;
  height }): CardSize` con le misure di D-11; `dropLayout(items: readonly {
  path: string; kind: CardKind; size: CardSize }[], at: { x; y }):
  { cards: { path; x; y; width; height }[]; group: Rect | null }`.
- Ordine per nome con `Intl.Collator(undefined, { numeric: true })` sul
  nome del file; colonne `ceil(sqrt(n))`; 24 px fra le schede; l'angolo in
  alto a sinistra della prima al punto; tutto agganciato a 8 px come la
  tela (`CANVAS_SNAP`).
- Oltre 12 elementi: `group` è il rettangolo che li contiene con 24 px di
  margine (l'etichetta la mette T15, con il numero).
- `markdownTable(rows: readonly string[][]): string`: la prima riga è
  l'intestazione, le barre verticali nelle celle si scrivono `\|`, le
  righe corte si allungano.
Casi limite: zero elementi; un elemento; 13 (il gruppo); 500; nomi uguali
in cartelle diverse; nomi con numeri («foto 2», «foto 10»); un'immagine
senza misura; una tabella di una cella; celle con a capo (diventano
spazi).
Fatto quando: `drop-layout.test.ts` prova ordine, griglia, aggancio,
gruppo, le misure per specie, l'immagine 4000×1000 → 480×120, e la tabella.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/drop-layout.test.ts
Stato: [ ] da fare

## T10 · Le porte per portare dentro

Perché: G1 e G2: dall'albero nasce una scheda di file (oggi testo); dal
computer il file si copia una volta sola, con la notifica la prima volta.
Tocca: `apps/client/src/state/canvas-intake.ts` (nuovo),
`apps/client/src/state/canvas-intake.test.ts` (nuovo),
`apps/client/src/state/document-controller.ts` (solo `canvasAttachments`),
`apps/client/src/panels/settings.ts`, `apps/client/src/panels/settings.test.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `engine.ts` (la porta `CanvasAttachmentPort` ha già
`resolvePaths`); le note (`mountDocumentAttachments`); l'host e
`files.attachment-folder` (D-2); `ui/drag-types.ts`.
Dipende da: T3
Cosa fare:
- `canvas-intake.ts`, con le dipendenze passate (per i test):
  `resolveCanvasPaths(data, deps)`: legge `ENTRIES_DRAG_TYPE`
  (`draggedEntries`) o, se manca, `NOTE_DRAG_TYPE`; tiene solo gli id che
  l'host conferma (`existingDocuments`; se non risponde per i file che non
  sono note, un `resourceOpen` chiuso subito: il coder sceglie e lo
  scrive); mai il `text/plain`.
  `depositCanvasFiles(files, documentId, deps)`: `attachmentDeposit` di
  oggi, per ogni file `depositOrReuse` con `same` che legge il file del vault
  (`openResourcePort`, prima la lunghezza, poi i byte) e li confronta; alla
  fine, se uno almeno è stato riusato, `notify` «Già nel vault, uso quello»
  (uno solo, col numero); la prima volta che la lavagna copia file
  (`readState`/`writeState` con la chiave `canvas.attachments-noticed`),
  `notify` «Copiati in {folder}» con l'azione «Cambia cartella».
- `document-controller.ts`: `canvasAttachments` usa le due funzioni.
- `panels/settings.ts`: `export function revealSetting(key: string):
  Promise<void>`: apre le Impostazioni come `#open-settings`, sceglie la
  scheda dove la voce sta, la tiene in vista (`pinnedRow`), la scorre in
  vista e dà il fuoco al suo campo. «Cambia cartella» la chiama con
  `files.attachment-folder`.
- `catalog.ts`, IT ed EN: `canvas.intake.reused` (con il conteggio),
  `canvas.intake.copied` («Copiati in {folder}»), `canvas.intake.change_folder`
  («Cambia cartella»).
Casi limite: un id dell'albero che è stato cancellato nel frattempo (si
scarta); voci miste note e file; 500 voci (una domanda sola all'host);
`readState` che fallisce (la notifica si mostra, e va bene); il file del
vault più lungo di 64 MiB (non è uguale, senza leggerlo); `revealSetting`
con una chiave che non c'è (apre le Impostazioni e basta); Impostazioni già
aperte.
Fatto quando: `canvas-intake.test.ts` prova che dall'albero arrivano solo
id confermati, che il doppione si riusa con una notifica, che la prima
volta c'è «Cambia cartella» e la seconda no; `settings.test.ts` prova
`revealSetting` su una voce di un'altra scheda.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/canvas-intake.test.ts src/panels/settings.test.ts
Stato: [ ] da fare

## T11 · La tela tiene le schede

Perché: oggi `#render` rifà tutte le schede a ogni cambio; una scheda viva
deve sopravvivere a una modifica che non la riguarda.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts` (nuovo),
`docs/reference/canvas-cards.md` (da T1).
Non toccare: lo strato d'inchiostro di N4 (`ink-layer.ts`, `ink-paint.ts`);
il nucleo di N3 (`wasm/core.ts`, `fub-canvas-core`); `surface.ts` e
`bootstrap.ts` (T12); le schede di testo e i gruppi (si disegnano come
oggi).
Dipende da: T1; N3 fino a T18 e N4 fino a T16 fusi in `main`
Cosa fare:
- Un'opzione nuova `cards?: CanvasCards` in `CanvasEngineOptions`, con
  `CanvasCards { registry: CardRegistry; snapshots: CardSnapshots }`.
- La resa diventa a chiavi: una mappa id → elemento e vista; a ogni resa
  si aggiornano posizione e misura di chi c'è, si crea chi è nuovo, si
  distrugge chi è sparito; il corpo di una scheda si rifà solo se cambiano
  `type`, `file`, `subpath`, `url`, `text` o `label`.
- Per ogni scheda con una specie e un renderer: `mount(node, corpo,
  "snapshot", context)`, con una `Lifetime` sua; senza renderer, il corpo
  di oggi. `data-card-kind` e `data-card-mode` sul `.canvas-node`.
- `context.missing()` per ora mostra il segnaposto di oggi (T16 lo cambia).
- `destroy` della tela distrugge ogni vista, una volta.
- Nella pagina: la sezione «Come la tela tiene le schede».
Casi limite: `setDoc` dall'esterno con le stesse schede (nessuna
rimontatura); annulla che riporta una scheda tolta (nuova vista); id
cambiato con lo stesso file (vista nuova); 2000 schede
(`MAX_INTERACTIVE_NODES`, oltre il limite come oggi); la lavagna in sola
lettura; un renderer che lancia in `mount` (la scheda di file di oggi, la
tela va avanti).
Fatto quando: `engine-cards.test.ts`, con un renderer finto che conta
`mount` e `destroy`, prova che spostare, ridimensionare, colorare o
scrivere in un'altra scheda non rimonta niente, che cambiare il file
rimonta, che togliere distrugge; i test di `engine.test.ts` e di N4
passano.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T12 · Il collegamento

Perché: i renderer di T4–T8 e le porte di T10 arrivano alla tela vera.
Tocca: `apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/state/document-controller.ts`,
`apps/client/src/canvas-cards.e2e.test.ts` (nuovo).
Non toccare: `engine.ts` (T13 nella stessa ondata); `canvas-intake.ts`
(T10); `host/fake.ts`, salvo ciò che manca per la prova (lo dice il
rapporto).
Dipende da: T4, T5, T6, T7, T8, T10, T11; N3 T16
Cosa fare:
- `bootstrap.ts`: dentro il montaggio pigro della tela (A-14) costruisce il
  registro con i cinque renderer e una `CardCache` per finestra; le porte
  vengono da un'opzione nuova `canvasCards?: CanvasCardPorts` (note,
  immagini, PDF, foglio, web), più `options.media` e `gridHost` che ci sono.
  La scheda di foglio arriva con `import()` al primo foglio.
- `surface.ts`: passa `cards` alla tela.
- `document-controller.ts`: le porte: la nota con `renderEmbed` e la stessa
  montatura delle schede di testo; immagini e PDF con `mediaTransport`;
  il foglio con `documentSessions.inspect(doc)` o `api.readDocument`, e
  `gridHost`; il web con `linkCardView`, `requestLinkCard`,
  `on("link-cards")`; ogni `watch` con `onEvent("entry_changed")` per quel
  percorso, che chiama anche `snapshots.forget(path)`.
- `canvas-cards.e2e.test.ts`, sulla shell vera e l'host finto: una lavagna
  con una scheda di nota e una d'immagine; aperta e inquadrata, la nota
  mostra il suo titolo reso, l'immagine ha il suo `<img>` o `<canvas>`.
Casi limite: la tela senza porte (un'altra finestra, le prove vecchie):
tutto come oggi; il vault che cambia mentre una scheda carica; un evento
`entry_changed` per un file che nessuna scheda mostra; due lavagne aperte
sullo stesso file.
Fatto quando: la prova e2e passa; con `canvasCards` assente
`engine.test.ts` e `shell.e2e.test.ts` passano senza cambiare.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/canvas-cards.e2e.test.ts
Stato: [ ] da fare

## T13 · Vive solo le schede utili

Perché: N1 e N4 di `lavagna.md`, terzo punto del passo: la lavagna resta
fluida con 300 schede.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts` (da T11),
`docs/reference/canvas-cards.md` (da T1).
Non toccare: `cards.ts` (le regole stanno lì, da T1); `ink/quiet.ts` (si
usa la stessa `PenQuiet` della tela di N4); la camera (`#applyCamera`: lo
spostamento resta una trasformazione, N3).
Dipende da: T11; N4 T2 e T12
Cosa fare:
- A fine gesto (A-7), al cambio del documento e quando la vista cambia
  misura: `liveCardIds` con la vista in coordinate della lavagna e lo zoom,
  poi `updateLiveCards` con la `PenQuiet` della tela.
- Durante un gesto nessuna scheda cambia modo; con la penna giù il lavoro
  aspetta che si alzi (PenQuiet).
- `resize()` delle schede ridimensionate a fine gesto.
- Nella pagina: la sezione «Vive e ferme», con il percorso di un gesto.
Casi limite: zoom che attraversa 0,35 in un gesto solo; una scheda
trascinata da fuori a dentro la vista; la lavagna nascosta (un'altra
linguetta: niente cambi finché non torna in vista); 300 schede tutte in
vista a zoom 0,4 (ne vivono 40); la penna giù durante uno spostamento col
dito (N4 T14).
Fatto quando: `engine-cards.test.ts` prova che dopo lo spostamento le
schede in vista sono vive e le altre ferme, che sotto 0,35 nessuna è viva,
che mai più di `MAX_LIVE_CARDS`, e che con la penna finta giù nessuna
cambia modo fino a quando si alza.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine-cards.test.ts
Stato: [ ] da fare

## T14 · Entrare e uscire

Perché: C3: la rotella sopra un foglio sposta la lavagna finché non ci si
entra; dentro, scorre il foglio, senza restarci intrappolati.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts` (da T11),
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: i renderer (hanno già `enter`, `leave`, `key`); la scrittura
delle schede di testo (`#beginCardEdit`); l'inchiostro (la penna scrive
sopra anche una scheda attiva: N4).
Dipende da: T12, T13
Cosa fare:
- Un clic su una scheda la sceglie (come oggi), anche sopra un link (A-12).
- Un clic dentro una scheda già scelta, o Invio con una scheda scelta che
  non è di testo, chiama `enter()`; se `true`, la scheda è attiva
  (`data-card-active`): il contenuto riceve puntatore e tastiera; la
  rotella sopra di lei va a lei; «Esc per uscire» (`canvas.card.exit_hint`)
  compare sopra.
- Esc, un clic fuori, o la scheda che esce dalla vista: `leave()`.
- Con la scheda scelta e non attiva, `key()` riceve PgSu, PgGiù, Home,
  Fine (il PDF).
- Una scheda attiva resta viva anche se la regola di T13 la spegnerebbe.
- Doppio clic su una scheda d'immagine: il visore; su una nota o un
  foglio: come Invio.
- `structure.css`: fuori da una scheda attiva il contenuto non prende il
  puntatore (`pointer-events`), dentro sì; lo scorrimento interno.
Casi limite: Esc mentre si sceglie un rettangolo di celle; entrare in una
scheda ferma (diventa viva, poi entra); due clic veloci; sola lettura;
tastiera sola (Tab arriva alla scheda, Invio entra, Esc esce); la scheda
attiva tolta da un annulla.
Fatto quando: `engine-cards.test.ts` prova rotella fuori e dentro, Esc,
clic fuori, Invio, PgGiù sulla scheda scelta, e che un clic su un link di
una scheda non attiva non lo segue.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine-cards.test.ts
Stato: [ ] da fare

## T15 · Trascinare e incollare

Perché: G1, G3, G6 e il primo punto del passo, nella tela.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `drop-layout.ts` (si usa); `canvas-intake.ts` (si usa dalla
porta); `editors/text/profiles/markdown/paste.ts` (arriva da una porta).
Dipende da: T9, T12, T14
Cosa fare:
- `#intake`: le schede nascono con `bornSize` e `dropLayout` al punto del
  rilascio; per le immagini la misura viene da una porta nuova
  `measureImage?(path): Promise<{ width; height } | null>` (in
  `bootstrap.ts` dalla `ResourceTransport` e `decodeImage`); oltre 12 un
  gruppo con l'etichetta `canvas.intake.group` («{count} file»), già scelto;
  tutto in un commit solo (un annulla).
- Incollare: sotto il puntatore se è sulla lavagna (l'ultima posizione
  vista dentro la vista), sennò al centro come oggi; celle copiate (HTML
  con una tabella, o testo a tabulazioni su più righe): una porta nuova
  `clipboardMarkdown?(data): Promise<string | null>` (in `bootstrap.ts`
  `markdownFromClipboard`), e per il testo a tabulazioni `parseTsv` più
  `markdownTable`: una scheda di testo.
- Il fantasma: durante `dragover` con file o voci dell'albero, rettangoli
  tratteggiati (`canvas-drop-ghost`, solo struttura) dove nasceranno; il
  numero da `dataTransfer.items.length`, 1 se non si sa; spariscono a
  `dragleave` e `drop`.
- Il rilascio su una scheda di file ne cambia il file come oggi (A-8).
Casi limite: rilascio fuori dalla vista (non c'è); 40 foto; un file che
l'host rifiuta a metà (le schede dei file andati nascono, l'errore come
oggi in `canvas-intake-error`); una cartella del sistema con 500 file;
`dragover` senza tipi leggibili (WebKit); incollare mentre si scrive in una
scheda di testo (va nel testo, come oggi); misura dell'immagine che non
arriva (la misura di serie).
Fatto quando: `engine.test.ts` (i rilasci simulati di oggi) prova griglia,
ordine, gruppo oltre 12, un solo annulla, incolla sotto il puntatore, celle
come tabella.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T16 · Il file mancante

Perché: C15: una scheda il cui file non c'è più resta, e dice che cosa fare.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts` (da T11),
`apps/client/src/editors/core/bootstrap.ts` (la firma di
`onPickCanvasFile`), `apps/client/src/state/document-controller.ts`
(`pickCanvasFile`), `apps/client/src/i18n/catalog.ts`.
Non toccare: `pickFromList` (le voci arrivano già ordinate); `rewrite_links` del provider (rinominare dentro Fub aggiorna
già i percorsi: O2); i renderer (chiamano già `missing()`).
Dipende da: T15
Cosa fare:
- `context.missing()`: il corpo diventa «File mancante: {path}»
  (`canvas.card.missing`) con «Ritrova…» e «Togli dalla lavagna».
- «Ritrova…»: il selettore di file di oggi (`onPickFile`, in
  `document-controller.ts` `pickCanvasFile`) prende un nome facoltativo e
  mette per prime le voci con quel nome; il file scelto sostituisce il
  percorso nella scheda (un commit, un annulla).
- «Togli dalla lavagna»: toglie la scheda, come Canc.
- Quando il file torna (`watch`), la scheda si rimonta da sé.
Casi limite: il file torna mentre il selettore è aperto; sola lettura
(nessun pulsante); una scheda di link (non manca mai); molte schede
mancanti insieme (una cartella spostata fuori da Fub).
Fatto quando: `engine-cards.test.ts` prova lo stato, «Ritrova…» con un
percorso scelto e annullato, «Togli», e il ritorno del file.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine-cards.test.ts
Stato: [ ] da fare

## T17 · Il menu della scheda

Perché: il menu «Scheda della lavagna» di `tasto-destro.md`: rosso in fondo,
colori come scelte esclusive, «Togli» perché il file resta.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/state/document-controller.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `editors/core/editor-menu.ts` (il menu ha già voci, sottomenu,
`checked`, `danger`); il menu del vuoto e quello dei fili; i nove colori
(D-13).
Dipende da: T16
Cosa fare:
- La testata del menu: «Scheda di {specie} · {nome}» (`canvas_menu.header`).
- L'ordine: la riga degli appunti come oggi; Apri; Apri a lato (una porta
  nuova `onOpenPathBeside?`, come `onOpenWikilinkBeside` delle note, in
  `surface.ts`, `bootstrap.ts` e `document-controller.ts`); Collega… · C;
  ———; Colore › con i sei colori di oggi come scelte esclusive (radio, non
  spunta); Disponi › (Davanti Ctrl+], Dietro Ctrl+[, ———, Allinea…,
  Distribuisci…, con le voci di oggi); Duplica · Ctrl+D; ———; Togli dalla
  lavagna · Canc, rosso, in fondo.
- Il tasto C con una scheda scelta comincia il collegamento come il
  pulsante → della testata; Ctrl+] e Ctrl+[ come «Davanti» e «Dietro».
- Su una scheda di pagina web, «Mostra l'anteprima»; su una scheda d'immagine,
  «Apri nel visore».
Casi limite: più schede scelte (la testata dice «{n} schede», niente
Apri); un gruppo (il suo menu di oggi); sola lettura (le voci che
cambiano sono spente, non nascoste); C mentre si scrive in una scheda di
testo (va nel testo).
Fatto quando: `engine.test.ts` prova l'ordine delle voci, il pericoloso in
fondo, i colori radio, C, Ctrl+] e Ctrl+[.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T18 · La scheda dei file Craft

Perché: C8 e il passo: un file di VectorCraft, PhotoCraft o FigCraft mostra
l'anteprima di N7, con «Apri con».
Tocca: `apps/client/src/editors/canvas/cards/craft.ts` (nuovo),
`apps/client/src/editors/canvas/cards/craft.test.ts` (nuovo),
`apps/client/src/editors/canvas/cards.ts` (da T1: le estensioni Craft in
`cardKindOf`), `apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/state/document-controller.ts`.
Non toccare: `editors/craft/` e `state/craft-previews.ts` di N7 (si usano);
`panels/open-with.ts` di N7.
Dipende da: T12; N7 T14 e T16; K5 T24 per «Accendi…»
Cosa fare:
- `cardKindOf`: le estensioni che N7 dà alle specie Craft in
  `ui/format-kind.ts` → `craft`.
- `craftCardRenderer(port)`: l'immagine di `previewOf(path)` (N7) in cache
  come le immagini; «Apri con» apre il pannello di N7; con il componente
  acceso «Apri» apre la modalità di Fub; con il componente spento e K5 T24
  fuso, «Accendi…».
Casi limite: anteprima che non c'è (scheda di file); componente acceso
mentre la scheda è viva; un file Craft rotto.
Fatto quando: `craft.test.ts` prova anteprima, «Apri con», componente
spento; `cards.test.ts` prova le estensioni nuove.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards
Stato: [ ] da fare

## T19 · L'inchiostro sulla pagina del PDF

Perché: C4: i segni della pagina 3 non devono restare sopra la pagina 4.
Tocca: `crates/fub-canvas-core/src/ink.rs` (di N3 e N4),
`crates/fub-canvas-core/tests/` (di N3: i vettori),
`apps/client/src/__fixtures__/canvas-ink/` (di N4: vettori nuovi,
scritti a mano), `apps/client/src/editors/canvas/ink-record.ts` (di N4),
`apps/client/src/editors/canvas/anchor.ts` (di N4),
`apps/client/src/editors/canvas/engine.ts` (dà ad `anchor.ts` la pagina
della scheda sotto il tratto), `docs/reference/canvas-ink.md` (di N4),
`docs/decisions/` (un ADR nuovo, il primo numero libero quando si fonde),
`docs/decisions/README.md`.
Non toccare: le ancore `card` e `free` di N4 (restano identiche); il
`.fubann` del PDF (l'inchiostro resta della lavagna: domanda aperta di
`lavagna.md`); `cards.ts` e `cards/pdf.ts` (`page()` c'è da T1 e T6).
Dipende da: T6, T13; N4 T8–T12 fusi; **la risposta a D-4**
Cosa fare:
- Solo se D-4 è (a). L'ancora `{"kind":"page","width","height","page"}`
  (la pagina da 1) in Rust e TypeScript, letta e scritta allo stesso modo
  (i vettori nuovi passano in tutti e due); un campo sconosciuto si
  conserva come per le altre (A11 di N3).
- Un tratto che comincia sopra una scheda PDF viva prende la pagina
  mostrata (`page()`); si disegna solo quando la scheda mostra quella
  pagina.
- L'ADR: perché un'ancora nuova e non un campo della scheda, e che cosa
  vede Obsidian (niente: i campi `fub:ink` restano suoi).
- `canvas-ink.md`: la sezione dell'ancora di pagina.
Casi limite: un tratto che parte su una pagina e finisce fuori dalla
scheda; la scheda che diventa ferma con la pagina 5 (l'immagine ferma ha
l'inchiostro della 5); il PDF sostituito con uno più corto (l'ancora a una
pagina che non c'è: il tratto resta nel file e non si mostra); un file
scritto da una versione di Fub che non conosce `page`.
Fatto quando: i vettori nuovi passano in `cargo test -p fub-canvas-core`
e in Vitest; una prova della tela scrive sulla pagina 2, va alla 3 (il
tratto sparisce) e torna (ricompare).
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T20 · La misura S3

Perché: il primo punto del cancello: 300 schede, 20 fogli vivi, entro gli
obiettivi di N0.
Tocca: `apps/client/bench/webview/fixtures.mjs`,
`apps/client/bench/webview/run.mjs`, `apps/client/bench/webview/budgets.json`,
`docs/development/webview-measurements.md`, `docs/misure/` (una pagina
nuova con la data), `docs/misure/README.md`.
Non toccare: gli altri scenari; le soglie degli altri; il job `webview`
della CI (i coder non la toccano).
Dipende da: T13, T14; N3 T15, N4 T15 e K3 T9 fusi (toccano gli stessi
file)
Cosa fare:
- `fixtures.mjs`: 20 `.xlsx` (`S3/Conti-01.xlsx`…, dal `workbook()` di oggi)
  in un blocco 5×4 in alto a sinistra della lavagna di `board()`; le 20 note
  restano, subito dopo (D-8).
- `run.mjs` S3: porta la vista sul blocco a zoom fra 0,4 e 0,6 con i gesti
  della tela (il coder sceglie quali e lo scrive); aspetta che le schede di
  foglio vive siano almeno 20 (`[data-card-kind=sheet][data-card-mode=live]`);
  poi lo spostamento e lo zoom di oggi; il valore nuovo `S3.liveCards`.
- `budgets.json`: gli obiettivi restano (16,7 e 50); le soglie della CI si
  ritarano dopo la prima misura, con il numero del giro nella nota.
- La pagina in `docs/misure/`: macchina, WebView, numeri, sha.
Casi limite: il driver senza rotella (il referto lo dice, come oggi);
meno di 20 schede vive dopo l'attesa (lo scenario fallisce, non misura
altro); WebKitGTK sotto Xvfb in software (i numeri dicono poco di una GPU:
la pagina lo scrive).
Fatto quando: il comando gira e scrive S3 con `liveCards` ≥ 20; la pagina
delle misure c'è; la riga S3 di `webview-measurements.md` dice «20 fogli
vivi».
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && cd
../.. && cargo build --release --locked -p fub-app --features
tauri/custom-protocol && cd apps/client && xvfb-run -a npm run bench:webview
-- --only=S3 --budgets=targets --native-driver=/usr/bin/WebKitWebDriver
Stato: [ ] da fare

## T21 · La prova del cancello

Perché: il secondo punto del cancello: trascini un `.xlsx` dal sistema, ci
scrivi sopra, chiudi e riapri; tutto al suo posto, il file intatto.
Tocca: `apps/client/src/canvas-cards.e2e.test.ts` (da T12),
`docs/development/ink-input-smoke-test.md` (una sezione «Le schede vive»).
Non toccare: il codice di prodotto (se la prova trova un difetto, il coder
lo scrive nel rapporto e il pianificatore apre un task).
Dipende da: T15, T17; N4 T12
Cosa fare:
- Nella prova e2e: un `File` `.xlsx` (byte noti) rilasciato sulla lavagna;
  si controlla che l'host finto abbia scritto quei byte nella cartella degli
  allegati e che sia nata una scheda di foglio; un tratto con la penna
  finta di N4 sopra la scheda; si chiude e si riapre la lavagna: la scheda
  e il tratto ci sono; i byte del `.xlsx` sono gli stessi; nessuna scrittura
  oltre il `.canvas` e il file depositato. Un secondo rilascio dello stesso
  file non crea un file nuovo («Già nel vault»).
- La prova a mano: i passi sulla app vera, con un `.xlsx` vero, e lo sha256
  prima e dopo.
Casi limite: l'host finto che non sa aprire un foglio (conta il file, non
le celle: lo scrive la prova); la prova a mano su Windows e macOS la fa
l'utente.
Fatto quando: la prova e2e passa; la sezione c'è e dice i comandi.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/canvas-cards.e2e.test.ts
Stato: [ ] da fare

## T22 · L'aspetto

Perché: le scelte d'aspetto (D-10–D-13) si fanno col prototipo, e qui
diventano il tema.
Tocca: `apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/editors/canvas/engine.ts` (la testata: «↩ N» e «×2»),
`apps/client/src/i18n/catalog.ts`.
Non toccare: i renderer, salvo le classi che il prototipo chiede (lo dice
il prototipo); i colori dei tratti (sono del file).
Dipende da: T21; **il prototipo approvato dall'utente** (passo 8 della
skill `pianifica`)
Cosa fare:
- Ciò che il prototipo approvato dice, per: la scheda attiva, «Esc per
  uscire», il fantasma del rilascio, la scheda «File mancante», l'ombra
  che dice «continua», le frecce e «3 / 24» del PDF, la scheda da lontano,
  le testate con «↩ N» (quante note la citano, dall'indice) e «×2».
- Le classi nuove dichiarate in `anatomia/editors.ts`.
Casi limite: tema scuro e alto contrasto; moto ridotto (niente animazioni
sulle schede che si accendono); una testata stretta (i numeri prima del
titolo che si taglia).
Fatto quando: `anatomia.test.ts` passa; le foto del banco (skill `banco`)
mostrano gli stati del prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/theme/scrittoio/anatomia.test.ts
Stato: [ ] da fare

## T23 · La pagina di prodotto

Perché: la pagina `product/lavagna.md` è riservata in `docs/README.md`
(«Le pagine che verranno»): nasce quando la lavagna v1 passa il cancello.
Tocca: `docs/product/lavagna.md` (nuovo), `docs/README.md`,
`docs/map/ownership.md`, `docs/map/dove-sta-x.md`.
Non toccare: `docs/architecture/editor-surfaces.md` (è a 449 righe);
`docs/reference/canvas-cards.md` (è il riferimento, non il prodotto).
Dipende da: T22
Cosa fare:
- La pagina: che cosa mostra una scheda per specie, come si entra ed esce,
  come si porta dentro, dove vanno i file, che cosa non fa ancora (con i
  rimandi a ciò che verrà), le scorciatoie.
- `docs/README.md`: la riga passa da «Le pagine che verranno» alla tabella
  «Capire il prodotto».
- `ownership.md`: le regole «vive solo le utili» e «una scheda non scrive»
  con il file e il test che le presidiano; `dove-sta-x.md`: «le schede vive
  della lavagna» → `editors/canvas/cards.ts`.
Casi limite: i limiti di righe; i link verso pagine che N3 e N4 hanno
aggiunto (esistono solo dopo la loro fusione).
Fatto quando: `check-doc-links`, `check-doc-orphans` e `check-doc-size`
passano.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## Non verificato stanotte

- Niente è stato compilato né provato: la macchina era carica e il disco
  pieno. Percorsi, firme e numeri di riga sono letti su `main` @ 620f0acd.
- Che `render_embed` sappia rendere un DOCX o un ODT (D-14): se no, T4 dà
  una scheda di file e lo dice.
- Che `existingDocuments` risponda anche per i file che non sono note (T10
  ha l'alternativa).
- Che `createImageBitmap` con `resizeWidth` funzioni in WebKitGTK e
  WKWebView (T5 ha il ripiego col `<canvas>`), e che HEIC e AVIF si
  decodifichino.
- Quanta memoria prendono 20 sessioni di foglio aperte nell'host, e quanti
  worker apre pdf.js con molti PDF vivi: lo dice T20, e se serve un tetto
  per specie si aggiunge a `liveCardIds`.
- Che WebKitWebDriver sappia portare la vista sul blocco dei fogli con i
  gesti della tela (T20 sceglie i gesti).
- Che `dataTransfer.items.length` sia leggibile in `dragover` in tutte e
  tre le WebView (il fantasma ripiega su 1).
- I nomi di `engine.ts` dopo N3 T16 e N4 T12–T16, che non sono ancora
  fatti.
- Che la riga di `docs/README.md` dopo «Il server MCP» si fonda senza
  conflitti con quelle di N3 e N4.
- Le estensioni Craft e i nomi di N7 (`previewOf`, `panels/open-with.ts`):
  letti nel piano di N7, non nel codice.
