# Piano: N4 · L'inchiostro su tutto

Branch: piano/n4-inchiostro
Obiettivo: sulla lavagna la penna scrive sempre, sopra ogni scheda (nota,
foglio, PDF, foto) e sul vuoto, senza attivare niente; il dito sposta e
ingrandisce la lavagna; il mouse seleziona come oggi e scrive solo tenendo
premuto D o con l'interruttore «Scrivi col mouse». Un menu sceglie penna,
colore, spessore e gomma (quella che toglie il tratto intero e quella che
taglia un pezzo). L'inchiostro si salva nel `.canvas` (dove resta lo decide
la prova con Obsidian, T24), segue la scheda quando la sposti, cresce senza
deformarsi con le immagini e i PDF che ridimensioni e resta fermo sulle
altre schede, si annulla tratto per tratto e non tocca mai il file della
scheda.
Perché: l'inchiostro oggi c'è nei disegni e nelle note (`crates/fub-ink`,
`apps/client/src/ink/`, `editors/spatial/`, `editors/rich/ink.ts`), ma la
lavagna (`apps/client/src/editors/canvas/engine.ts`) non lo conosce: non
distingue penna, dito e mouse, e il `.canvas` non ha un posto per i tratti.
Fuori scope: le ancore di contenuto (celle di un foglio, pagina di un PDF,
blocco di una nota: v2); le anteprime vive dei file nelle schede (oggi sono
segnaposti: arrivano con N6); il bagnato nativo (N5); il lazo; un'operazione
per gli agenti che taglia un tratto (`erase_strokes` toglie tratti interi:
tagliare è un gesto della mano); PenQuiet per il grafo e l'indice; la copia
SVG per gli altri programmi e il file accanto alla lavagna, salvo che la
prova di Obsidian (T24) li renda necessari e l'utente li scelga (D-12);
scrivere dentro un DOCX o un PDF (ADR 0226, P3); InkML; i sottocomandi della
CLI; la CI (i coder non la toccano: CLAUDE.md; la CI completa la guarda
l'orchestratore in T25); il vault vero.
Assunzioni: A1–A16 e la forma del formato `fub:ink` qui sotto, decise dal
pianificatore il 2026-11-02 di notte. Il 2026-11-02 l'utente ha risposto a
D-1…D-11 e a merge-n3n4 (la riga «Risposta» sotto ogni domanda): A11–A13
cambiano, A17–A23 vengono dalle risposte; A19–A23 sono proposte del
prototipo e valgono quando l'utente lo approva (T20).
Ondate: T1 T2 T3 | T4 T5 T6 | T7 T8 T9 | T10 | T11 | T18 T20 | T19 | T17 | T12
| T13 | T14 | T15 T22 | T16 | T21 | T23 | T25; T24 parte quando l'utente
incolla l'uscita della prova con Obsidian (dopo T18, se T18 è in corso; mai
insieme a T17 o T22, che toccano anche loro `canvas-ink.md`). Da
T17 in poi il ramo contiene N3 finito fino a T22 (lo fonde l'orchestratore).
Prototipo: `PLAN-ui/lavagna-penne.html` (T20): la barra con il menu della
penna e «Scrivi col mouse», il menu aperto, le due righe delle Impostazioni.
Approvato: 2026-11-02, con una modifica dell'utente: lo spessore si sceglie
con un cursore e non con tre pulsanti (la pagina è alla versione 2, dove
sulla lavagna finta si scrive davvero per provare le penne).

## Modifiche

- 2026-11-02 · la riga «Risposta» sotto ogni domanda; il prototipo
  `PLAN-ui/lavagna-penne.html`; cancello, assunzioni, fuori scope, «Che cosa
  si vede» e «Chi aspetta chi» rifatti; la domanda D-12, che vale solo se la
  prova con Obsidian dice che l'inchiostro si perde · l'utente ha risposto a
  D-1…D-11 e a merge-n3n4, e N3 ha cambiato T16 e aggiunto T19–T22 · nuovi
  T17–T25; T4 e T5 da rivedere (li cambia T18); T12, T13, T14, T15 e T16
  (da fare) riscritti dove le risposte o N3 li cambiano.

## Dal prototipo

Il prototipo è `PLAN-ui/lavagna-penne.html` (T20). Ogni blocco `<style>` dice
il file dove va; le classi nuove sono `canvas-ink-pen`,
`canvas-ink-pen-chip`, `canvas-ink-pen-name`, `canvas-pen-popover`,
`canvas-pen-menu`, `canvas-pen-section`, `canvas-pen-heading`,
`canvas-pen-list`, `canvas-pen-item`, `canvas-pen-preview`,
`canvas-pen-swatches`, `canvas-pen-swatch`, `canvas-pen-more`,
`canvas-pen-note`: il coder le aggiunge all'anatomia
(`theme/scrittoio/anatomia/editors.ts`). Il resto riusa pezzi che ci sono
(`segmented`, `kit-popover`, il selettore dei colori del kit, le righe delle
Impostazioni).

| Pezzo | Destinazione | Task |
|---|---|---|
| La scia sotto la penna (bagnato) | `editors/canvas/ink-layer.ts`, con `StrokePreview` di `ink/tools/stroke.ts` | T4 |
| Il tratto finito sulla scheda e sul vuoto (asciutto) | `editors/canvas/ink-paint.ts`, `structure.css` | T4, T12 |
| Il tratto che cresce con l'immagine o il PDF e resta fermo sulle altre schede (non è nel prototipo: lo dicono D-9 (c) e A17) | `editors/canvas/ink-fit.ts` (nuovo), `ink-paint.ts` | T18 |
| La gomma che sbiadisce il tratto | `ink-layer.ts`, `ink-paint.ts` (opacità 0,25 come `FADED_OPACITY` di `editors/spatial/painter/svg-dom.ts`) | T13 |
| La gomma che taglia: il pezzo strofinato sbiadisce, i pezzi intorno restano | `editors/canvas/ink-erase.ts` (nuovo), `ink-paint.ts` | T22 |
| L'interruttore «Scrivi col mouse», in testa alla barra, premuto con `--accent-wash` e `--accent` | `#drawToolbar` in `engine.ts`; il blocco `→ skin/editors.css` del prototipo | T16 |
| Il cursore: croce per scrivere, `cell` per la gomma | il blocco `→ structure.css` del prototipo, come `.rich-ink-veil` | T16, T21 |
| Il menu della penna: il pulsante col colore e il nome, il rialzo con Strumento, Tipo di penna, Colore, Spessore, La gomma cancella | `editors/canvas/pen-menu.ts` (nuovo), `#drawToolbar`; i blocchi `→ structure.css` e `→ skin/editors.css`; testi `canvas.ink.*` in `catalog.ts` | T21 |
| L'anteprima di ogni penna nel menu | `inkPath` col pennello di `penBrush`, come `penPreview` di `editors/spatial/tools/editor/chrome/pen-options.ts` (nel prototipo è approssimata) | T21 |
| «Altro colore…» | `colorWell` o `createColorPicker` di `kit/color/`, come la scheda «Disegna» dei documenti | T21 |
| Le due righe «Ricorda se scrivi col mouse» e «Il dito sposta le schede» | lo schema e i testi in `crates/fub-features/src/lavagna.rs`; le righe le disegna `panels/settings.ts` | T19 |
| Gli avvisi («tratto troppo lungo», «lavagna piena», «inchiostro di un'altra versione») | `#showIntakeError` dentro `canvas-intake-error`, testi in `catalog.ts` | T12 |
| Il dito che sposta la lavagna, il pizzico, la testata che sposta la scheda | `engine.ts`, `editors/canvas/touch.ts` | T14 |

## Che cosa si vede

Nessun pezzo nuovo del kit: tutto è fatto con ciò che la shell ha già.

- **La scia.** Mentre la penna è giù, sotto la punta appare il tratto che si
  allarga e si stringe con la pressione: è la stessa anteprima dei disegni
  (`StrokePreview`), disegnata in un livello SVG sopra la lavagna e sotto la
  barra. Non sa che cosa c'è sotto.
- **Il tratto asciutto.** Quando la penna si alza, la scia lascia il posto al
  tratto vero nello stesso fotogramma. Se il tratto è sopra una scheda, sta
  sopra il suo contenuto (testo, segnaposto del file, gruppo) e si muove con
  lei: trascinando la scheda o tirandone l'angolo, l'inchiostro la segue già
  durante il trascinamento, non solo alla fine. Se il tratto è sul vuoto o a
  cavallo di due schede, sta sopra tutte le schede, come una pellicola sulla
  lavagna.
- **Ridimensionare.** Su una scheda d'immagine o PDF l'inchiostro cresce e
  cala con la scheda, uguale nei due sensi e senza deformarsi, e resta sopra
  lo stesso punto (D-9 c). Su tutte le altre schede (testo, nota, foglio,
  gruppo, pagina web) resta fermo dov'era, della sua misura: se la scheda
  si stringe, l'inchiostro che esce si vede ancora e si cancella.
- **La penna e il colore.** In testa alla barra c'è il pulsante della penna:
  un tondo del colore e il nome della penna («Sfera»). Apre un menu con lo
  strumento (Penna, Evidenziatore, Gomma), il tipo di penna con
  l'anteprima, gli otto colori della tavolozza e «Altro colore…», lo
  spessore con un cursore (la penna da 0,5 a 20 pixel a mezzo pixel,
  l'evidenziatore da 4 a 48) e che cosa cancella la gomma. Di serie: Sfera
  blu (`#0072b2`), 4 pixel dello schermo allo zoom del momento (D-5 b). Cambiare penna non cambia i tratti già scritti.
- **La gomma.** Col retro della penna, col tasto laterale premuto o con lo
  strumento Gomma. Di serie toglie il tratto intero: i tratti toccati
  sbiadiscono mentre si passa (come la gomma dei disegni) e spariscono
  quando si alza la penna. Con «Solo il pezzo» taglia il tratto dove passa:
  il pezzo strofinato sbiadisce, i pezzi intorno restano come tratti nuovi
  (D-6 b). Annulla riporta tutta la passata in un passo.
- **Il mouse.** Fa quello che fa oggi (seleziona, sposta, collega). Nella
  barra, subito dopo la penna, c'è un pulsante di testo in più, «Scrivi col
  mouse»: premuto ha lo sfondo color accento, come i pulsanti premuti dei
  disegni (D-11 a); il suggerimento dice «Oppure tieni premuto D». Mentre il
  mouse scrive, il cursore è una croce (con la Gomma, `cell`), come
  nell'inchiostro delle note. Riaprendo una lavagna l'interruttore è spento,
  salvo che nelle Impostazioni sia accesa «Ricorda se scrivi col mouse»
  (D-4 c).
- **Il dito.** Un dito sposta la lavagna, anche sopra le schede; due dita la
  ingrandiscono (pizzico); per spostare una scheda col dito si trascina la sua
  testata (la riga col titolo). Il palmo appoggiato mentre si scrive non fa
  niente. Con «Il dito sposta le schede» accesa nelle Impostazioni, il dito
  sposta la scheda che tocca e la lavagna solo sul vuoto (D-10 c).
- **Le Impostazioni.** Nella sezione «Lavagna», due interruttori di questo
  computer, di serie spenti: «Ricorda se scrivi col mouse» e «Il dito sposta
  le schede».
- **Gli avvisi.** Un tratto rifiutato (troppo lungo, lavagna piena, scheda con
  inchiostro di un'altra versione di Fub) scompare e la barra mostra il
  messaggio nella riga degli avvisi che la lavagna usa già per i file
  rifiutati (`canvas-intake-error`).
- **Un caso da sapere.** Se il corpo di una scheda di testo scorre,
  l'inchiostro resta sulla cornice della scheda e non scorre col testo: le
  ancore al contenuto sono la v2 (fuori scope).

## Fonti

- I passi 12b (N4) e 12a (N3) dei «Piani di Fub», le regole e i rischi
  (`01-regole-e-decisioni.md`, `03-rischi-e-domande.md`). I coder non li
  leggono: qui c'è ciò che serve, e dove il codice dice altro vince il codice
  (sezione «Differenze dal passo 12b»).
- Il piano N3 (`PLAN.md` sul branch `piano/n3-logica-in-rust`, che questo
  file sostituisce in questa copia): A1 (toppe con l'immagine di prima), A10
  (id dal seme), A11 (`fub:ink` campo sconosciuto), il contratto R1–R10 (R6
  scrivere come `JSON.stringify`, R9 confronto per valore, R10 ordine dei
  campi), `CanvasOp`, la facciata WebAssembly (T13, T14) e la tela sul nucleo
  (T16).
- Scritto su `piano/n3-logica-in-rust` @ `f5e2503a` (in N3: T2 fatto, T1 in
  corso). Ciò che N3 non ha ancora fatto è segnato «dopo N3 Tn».
- Riallineato il 2026-11-02 al piano N3 @ `16e3ae76` (T16 registra il testo
  delle schede a pause; T18 toglie la logica TypeScript; T19 il testo in
  sospeso nelle bozze; T20 le toppe degli archi con `at`; T21 l'annulla che
  torna ai byte; T22 la sola lettura; T23 la CI completa) e al piano N6
  (`piano/n6-lavagna` @ `a6be320a`: la scheda di foglio è T7, la tela che
  tiene le schede è T11).
- Il codice letto: `crates/fub-ink` (ruoli, sessione, specchio
  `tests/ts_mirror.rs`), `apps/client/src/ink/` (input, adattatore, strumenti,
  penne), `editors/spatial/ink/codec.ts`, `crates/fub-scene/src/{ink,brush}.rs`
  e la §5 di `docs/reference/scene-format.md`, `editors/canvas/`
  (`engine.ts`, `operation.ts`, `model.ts`, `source-edit.ts`),
  `graph/interaction.ts` (il pizzico), `ui/lifetime.ts`,
  `crates/fub-abi/tests/dependency_invariant.rs`, ADR 0204 e 0226,
  `bench/webview/`, `docs/misure/`.

## Chi aspetta chi

| Task N4 | Parte subito? Dopo quali task di N4 | Aspetta in N3 | Aspetta una risposta |
|---|---|---|---|
| T1 · il mouse che non scrive | subito | nessuno | nessuna |
| T2 · PenQuiet | subito | nessuno | nessuna |
| T3 · la scheda sotto il tratto | subito | nessuno | nessuna |
| T4 · lo strato d'inchiostro | dopo T1, T2 | nessuno | D-9 (una riga) |
| T5 · la forma `fub:ink` | subito, a risposte date | N3 T1 (crea `docs/reference/canvas-format.md`) | D-1, D-2 |
| T6 · il crate `fub-ink-codec` | subito, a risposta data | nessuno | D-2 |
| T7 · il kit per Obsidian | dopo T5 | nessuno | D-1, D-8 |
| T8 · l'inchiostro nel nucleo | dopo T5, T6 | N3 T1, N3 T3 | D-1, D-2 |
| T9 · i tratti nel client | dopo T3, T4, T5 | nessuno | D-1, D-2, D-5 |
| T10 · toppa e operazioni in Rust | dopo T8 | N3 T5, T6, T7, T8 | D-3 |
| T11 · toppa nel client | dopo T9, T10 | N3 T7 (e N3 T14 se c'è) | D-3 |
| T12 · la penna scrive | dopo T2, T4, T9, T11, T17, T18 | N3 T16, T19, T21, T22 (fusi con T17) | D-5 (data) |
| T13 · gomma e D tenuto | dopo T12, T18 | come T12 | D-4, D-6 (date) |
| T14 · il dito | dopo T13, T19 | come T12 | D-10 (data) |
| T15 · la prima misura | dopo T14 | N3 T15 (il nome dello scenario) | D-7 (data) |
| T16 · l'interruttore e il cursore | dopo T19, T20, T22 | come T12 | D-4, D-11 (date); il sì al prototipo |
| T17 · l'inchiostro sul nucleo di N3 | dopo T11 | N3 fino a T22, fuso in questo ramo | nessuna |
| T18 · la misura della scheda | subito | nessuno | D-9 (data) |
| T19 · le impostazioni | dopo T20 | nessuno | D-4, D-10 (date); il sì al prototipo |
| T20 · il prototipo | subito (la prima versione c'è) | nessuno | il sì dell'utente |
| T21 · il menu delle penne | dopo T16, T19, T20, T22 | come T12 | D-5 (data); il sì al prototipo |
| T22 · la gomma che taglia | dopo T14, T18, T20 | come T12 | D-6 (data); il sì al prototipo |
| T23 · la seconda misura | dopo T15, T21 | nessuno | D-7 (data); in N6 la scheda di foglio viva dentro la lavagna (N6 T7, T11, T12, T13) |
| T24 · dopo la prova con Obsidian | dopo T7, T18 | nessuno | l'uscita della prova (D-8); D-12 se l'inchiostro si perde |
| T25 · la CI e la revisione | dopo tutti | N3 in `main` (N3 T23) | il sì al merge |

Le ondate 1 e 2 non aspettano niente di N3 tranne T5 (la pagina di N3 T1).
T18, T19, T20 e T24 non aspettano N3. Da T17 in poi il ramo contiene N3
fino a T22: l'orchestratore lo fonde quando N3 T22 è fatto, prima di far
partire T17 (N3 T18 toglie le funzioni TypeScript che T11 aveva allargato:
il conflitto si risolve tenendo la versione di N3, poi T17 sistema
l'inchiostro). Se N3 T23 corregge ancora qualcosa, l'orchestratore rifonde
prima di T25.
**Un nodo con N6.** La seconda misura (T23) vuole la scheda di foglio vera
dentro la lavagna, che arriva con N6 T11; ma N6 T11 oggi aspetta «N3 fino a
T18 e N4 fino a T16 fusi in `main`», e N4 entra in `main` solo dopo T23
(merge-n3n4 b). Per sciogliere il nodo, N6 T11 parte dal ramo di N4 con
fatti tutti i task che toccano `engine.ts` (T12, T13, T14, T22, T16, T21)
invece che da `main`, e T23 misura su quel ramo di N6. Lo decide
l'orchestratore col pianificatore di N6: «N4 fino a T16» di N6 T11 diventa
«N4 fino a T21». Senza questo accordo T23 non può partire e N4 non entra
in `main`.

## Domande per l'utente (raccolte, non bloccano)

Il piano è andato avanti con la prima opzione di ognuna; il 2026-11-02
l'utente ha risposto (la riga «Risposta» sotto ogni domanda). D-12 è nuova
e si fa solo se la prova con Obsidian dice che l'inchiostro si perde.

- D-1 · Dove si salva l'inchiostro (T5 e chi viene dopo). (a) Consigliata:
  campi `fub:ink` dentro il `.canvas`, sulla scheda e alla radice: un file
  solo, un'ancora per tratto, e il modello della lavagna li conserva già
  (A11 di N3). Obsidian non li vede; se, riscrivendo il file, li perde, lo
  dice il kit di T7. (b) Un SVG accanto, come scheda `file`: Obsidian lo
  vede come immagine ferma, ma i file sono due e spostare una scheda non
  sposta l'inchiostro. (c) A, più una copia B che Fub scrive per gli altri
  programmi: si decide dopo la prova di T7. Conseguenza: cambiare idea dopo
  T8 vuol dire riscrivere T5 e T8–T12.
  Risposta (2026-11-02): (c) — si decide dopo la prova con Obsidian; fino ad
  allora il codice tiene l'inchiostro nel `.canvas` (T24).
- D-2 · Come si scrivono i punti (T5, T6). (a) Consigliata: la stessa stringa
  dei tratti dei disegni (§5 di `scene-format.md`), in unità della scheda
  alla misura che aveva quando si è scritto; il codice c'è già in Rust e in
  TypeScript ed è circa il 40% più corto del base64 del passo (prova 3).
  Richiede T6 (il codec in un crate piccolo). (b) Il base64 di numeri `f32`
  del passo: un codec nuovo in due lingue e file più lunghi, ma niente T6.
  Conseguenza: altri programmi leggeranno questo formato; cambiarlo dopo
  vuol dire una `v: 2` e una conversione dei file.
  Risposta (2026-11-02): (a) — come i tratti dei disegni, come il piano.
- D-3 · Cancellare una scheda che ha inchiostro (T10, T12). (a) Consigliata:
  l'inchiostro va via con la scheda; annulla riporta tutto in un passo. (b)
  L'inchiostro resta sulla lavagna dov'era, come inchiostro libero.
  Conseguenza: (b) chiede una conversione delle coordinate nella toppa di
  rimozione e vettori in più in T10.
  Risposta (2026-11-02): (a) — l'inchiostro va via con la scheda, come il
  piano.
- D-4 · Scrivere col mouse (T13, T16). (a) Consigliata: l'interruttore nella
  barra, che riaprendo la lavagna torna spento, più D tenuto premuto. (b)
  L'interruttore ricordato (per lavagna o per tutto Fub). Conseguenza: (b) è
  una preferenza nuova da salvare e da mostrare in Impostazioni.
  Risposta (2026-11-02): (c) — un'impostazione «ricorda Scrivi col mouse»,
  di serie spenta; il tasto D resta (T19, T16).
- D-5 · Penna, colore e spessore di serie (T9, T12). (a) Consigliata: la
  biro, blu `#0072b2` (il nero sparisce sul tema scuro), larga 4 pixel dello
  schermo allo zoom del momento; il menu delle penne arriva con N6. (b) Il
  menu di penne e colori dei disegni già ora sulla lavagna (un task grafico
  in più). (c) Nero, come i disegni. Conseguenza: colore e spessore si
  scrivono in ogni tratto; cambiare la scelta dopo non cambia i tratti già
  scritti.
  Risposta (2026-11-02): (b) — il menu di penne e colori già adesso, di
  serie la biro blu da 4 pixel; prima il prototipo (T20), poi il menu
  (T21); colore e spessore restano scritti in ogni tratto.
- D-6 · La gomma (T13). (a) Consigliata: cancella il tratto intero che tocca,
  come la gomma a tratto dei disegni. (b) Anche la gomma che taglia un pezzo
  di tratto (il codice per tagliare c'è, `ink/tools/split.ts`). Conseguenza:
  (b) è un task in più e ogni passata crea tratti nuovi.
  Risposta (2026-11-02): (b) — accanto alla gomma che toglie il tratto
  intero, una che taglia solo il pezzo strofinato; un passaggio è un passo
  di annulla (T22).
- D-7 · La misura del cancello (T15). (a) Consigliata: le schede file oggi
  sono segnaposti (nessun foglio vivo), quindi la misura mette sotto la
  penna una scheda di testo con una tabella da 10 000 celle, una scheda
  `.xlsx` vera per l'hash e 2000 tratti già scritti; il foglio vivo entra
  nella misura quando arriva la sua anteprima. (b) Rinviare il cancello
  della latenza fino al foglio vivo. Conseguenza: (a) chiude N4 con un caso
  vicino a quello del passo ma non uguale; (b) lascia N4 aperto.
  Risposta (2026-11-02): (c) — tutte e due: ora sul caso simile (T15), poi
  sul foglio vero dentro la lavagna (T23); N4 si chiude solo con la
  seconda.
- D-8 · La prova con Obsidian (T7). (a) Consigliata: il kit di T7 (una
  lavagna di prova e uno script che confronta); l'utente apre la lavagna in
  Obsidian, sposta una scheda, salva, e lancia lo script: pochi minuti. (b)
  Scegliere A senza la prova. Conseguenza: senza la prova la voce del
  cancello «si sa che cosa succede ai campi» resta aperta.
  Risposta (2026-11-02): (a) — la prova la fa l'utente col kit di T7 e
  incolla l'uscita dello script (T24).
- D-9 · Ridimensionare una scheda con inchiostro (T4). (a) Consigliata:
  l'inchiostro si stira con la scheda in larghezza e in altezza, così le
  annotazioni restano sopra le stesse parti (il tratto si deforma un po').
  (b) Scala uniforme: il tratto resta proporzionato ma può non arrivare più
  dove arrivava. Conseguenza: è un attributo della resa, il file non cambia:
  si può cambiare dopo senza costi.
  Risposta (2026-11-02): (c) — dipende dalla scheda: su immagini e PDF
  l'inchiostro scala con lo stesso fattore nei due sensi, ancorato alla
  scheda; sulle altre resta fermo e non si deforma (T18). Il codice di
  adesso stira (`INK_ASPECT = "none"` in `ink-paint.ts`).
- D-10 · Il dito sopra una scheda (T14). (a) Consigliata: il dito sposta la
  lavagna ovunque, anche sopra le schede; per spostare una scheda col dito
  si trascina la sua testata; il pizzico ingrandisce. (b) Il dito sposta la
  scheda che tocca, come il mouse, e la lavagna solo sul vuoto. Conseguenza:
  con (b) il palmo o un dito appoggiato sposta schede per sbaglio.
  Risposta (2026-11-02): (c) — di serie (a); un'impostazione per chi vuole
  spostare col dito la scheda che tocca (T19, T14).
- D-11 · L'aspetto dell'interruttore (T16). (a) Consigliata: un pulsante di
  testo «Scrivi col mouse» come gli altri della barra; premuto ha lo sfondo
  color accento. (b) Un'icona di penna (serve un'icona nel kit e un nome per
  i lettori di schermo). Conseguenza: solo aspetto, si cambia dopo con poco.
  Risposta (2026-11-02): (a) — il pulsante con la scritta, colorato quando è
  acceso, come il piano (T16).
- merge-n3n4 · Quando N4 entra in `main`. (a) Appena i suoi task sono fatti,
  come gli altri piani. (b) Solo dopo N3, a task tutti fatti, con la CI
  completa (PR non in bozza: Windows, macOS, banchi) e una revisione riga
  per riga. Conseguenza: (b) aggiunge un task finale e una voce al cancello.
  Risposta (2026-11-02): (b) — dopo N3, con la CI completa e la revisione
  riga per riga (T25).
- D-12 · **Solo se la prova con Obsidian (T24) dice che l'inchiostro si
  perde.** Dove lo si tiene allora. (a) Consigliata: resta nel `.canvas`,
  Fub ne tiene una copia di riserva in `.fub/`; aprendo la lavagna, se
  l'inchiostro di una scheda che c'è ancora (stesso id) o della radice è
  sparito, lo dice e offre «Rimetti l'inchiostro», che si annulla. Un file
  solo per gli altri programmi, niente conversione. (b) Un file a parte
  accanto alla lavagna: Obsidian non lo tocca, ma i file sono due,
  rinominare la lavagna li separa e serve una `v: 2` con la conversione.
  (c) (a), più una copia SVG che gli altri programmi vedono come immagine:
  due copie da tenere allineate. Conseguenza: qualunque scelta sono task
  nuovi che il pianificatore scrive dopo la risposta; N4 non entra in
  `main` prima.
- D-13 · Il cursore dello spessore anche nei disegni e nei documenti (nuova,
  dall'orchestratore, 2026-11-03, dopo il sì al prototipo di T20). Sulla
  lavagna lo spessore si sceglie con un cursore (T21); nei disegni e nei
  documenti restano i tre pulsanti Sottile, Medio, Spesso. (a) Consigliata:
  lo stesso cursore anche lì, perché la stessa penna non si comporti in due
  modi. (b) Lì restano i tre pulsanti.
  Risposta (2026-11-03): (a) — il cursore dello spessore anche nei disegni e
  nei documenti; il task lo scrive il pianificatore.

## Assunzioni

- A1 · **La penna scrive sempre**, anche sopra una scheda di testo aperta in
  modifica: il campo non si chiude e non riceve il tratto, che è della
  lavagna (regola 5 del passo).
- A2 · **Un gruppo è una scheda** per l'ancora: chi scrive sul vuoto di un
  gruppo scrive sul gruppo. I figli stanno sopra il gruppo nell'ordine delle
  schede, quindi chi scrive su un figlio scrive sul figlio.
- A3 · **Conta solo la scheda più in alto che il tratto tocca** (l'ultima
  nell'array `nodes` fra quelle che intersecano il riquadro del tratto). Il
  tratto le appartiene se lei contiene il centro del riquadro, se almeno
  metà del riquadro sta dentro di lei e se il suo livello non è estraneo;
  altrimenti è libero. Il motivo: l'inchiostro di una scheda si disegna
  dentro di lei, quindi un tratto ancorato a una scheda che sta sotto
  un'altra finirebbe nascosto in parte (differenza dal passo).
- A4 · **Ogni tratto è un passo di annulla**; un tratto che l'adattatore
  spezza (`split`) o continua (`continued`) resta un passo solo. Una passata
  di gomma è un passo, anche se cancella dieci tratti.
- A5 · **Mentre una penna è giù, annulla e ripeti non fanno niente.**
- A6 · **Duplicare una scheda copia il suo inchiostro.** Gli id dei tratti
  sono unici nel livello, non nella lavagna: la copia tiene gli stessi id.
- A7 · **Gli agenti** possono aggiungere e cancellare tratti con le
  operazioni `add_strokes` ed `erase_strokes` quando N3 dà `canvas.apply`
  (N3 T10, T12); N4 non aggiunge comandi.
- A8 · **Sola lettura e lavagna troppo grande**: lo strato d'inchiostro non
  si monta (la penna non scrive); l'inchiostro asciutto si vede dove si
  vedono le schede.
- A9 · **Una modifica da fuori mentre una penna è giù** (`syncDoc`): modello
  e sorgente si aggiornano subito, il ridisegno aspetta che la penna si alzi
  (PenQuiet, chiave `"render"`); il tratto in corso non si perde; la scheda
  si sceglie sul documento del momento in cui la penna si alza; se la scheda
  non c'è più il tratto diventa libero.
- A10 · **Dalla T12 il dito e il mouse non scrivono sulla lavagna** (dito
  `"navigate"`, mouse `"ignore"`): fanno esattamente quello che fanno oggi
  finché T13 (D tenuto, interruttore) e T14 (il dito) non li cambiano.
- A11 · **La penna di serie** è quella di D-5 (b): la biro «Sfera», blu
  `#0072b2` (`INK_PEN_COLOR` di `ink-record.ts`; il nero sparisce sul tema
  scuro), spessore 4 pixel dello schermo allo zoom del momento,
  scritti nel tratto in unità della scheda (o della lavagna se libero). Il
  menu per cambiarla è T21; prima di T21 si scrive solo con questa.
- A12 · **Il formato** è quello di D-2 (a) descritto qui sotto, nel `.canvas`
  come dice D-1 (c) finché la prova con Obsidian non è fatta (T24). La
  decisione scritta da T5 resta «proposta» fino a T24, che la fa «accolta»
  oppure apre D-12.
- A13 · **La decisione di N4 è la 0238**
  (`docs/decisions/0238-inchiostro-sulla-lavagna.md`, scritta da T5); i
  task di N4 la aggiornano, non ne aprono un'altra.
- A14 · **Testi nuovi** in `apps/client/src/i18n/catalog.ts`, in italiano e
  in inglese, senza il gergo di `apps/client/src/i18n/gergo.ts`.
- A15 · **Ciò che Fub non sa disegnare si conserva e non si tocca**: un
  tratto con strumento, colore, pennello o punti non validi si conserva byte
  per byte e non si disegna; in un livello estraneo Fub non scrive.
- A16 · **Lo scenario nuovo della misura non entra nella CI** (i coder non
  la toccano); se entrarci lo decide l'orchestratore.
- A17 · **Ridimensionare dipende dalla scheda** (D-9 (c)). Il tipo si legge
  con `mediaKindOfId` di `apps/client/src/editors/media/media-types.ts`
  sull'id del file della scheda. Immagine e PDF: l'inchiostro scala con lo
  stesso fattore nei due sensi, il minore fra larghezza nuova su larghezza
  scritta e altezza nuova su altezza scritta, centrato nel riquadro della
  scheda (`preserveAspectRatio="xMidYMid meet"`); lo spessore scala con lui.
  Tutte le altre (testo, nota, foglio, gruppo, link, audio, video, tipo
  sconosciuto): l'inchiostro resta alla misura in cui è stato scritto,
  fermo nell'angolo in alto a sinistra, e se esce dalla scheda non si
  taglia. Il file non cambia: è solo resa.
- A18 · **Le due impostazioni nuove** (D-4 (c), D-10 (c)) sono della
  feature `fub.lavagna`, valgono per questo computer (come quelle dei
  disegni), sono interruttori e partono spente: `canvas.ink_mouse_remember`
  «Ricorda se scrivi col mouse» e `canvas.finger_moves_card` «Il dito sposta
  le schede». «Ricorda» tiene uno stato solo per tutte le lavagne del
  computer.
- A19 · **La scelta della penna si ricorda per computer** (proposta del
  prototipo), nello stato di vista `canvas.pen`; penna ed evidenziatore
  hanno ciascuno il proprio colore e spessore. La prima volta: Sfera, blu,
  4 pixel; l'evidenziatore giallo `#f0e442`, 16 pixel. Lo spessore è un
  numero (pixel dello schermo, con il passo del cursore): uno fuori
  dall'intervallo si riporta al bordo, uno non valido vale quello di serie.
- A20 · **La gomma di serie toglie il tratto intero** (proposta del
  prototipo). La scelta «La gomma cancella» vale per il retro della penna,
  per il suo tasto laterale e per lo strumento Gomma del menu. Quando taglia,
  i pezzi tengono strumento, pennello, colore, ancora e i campi che Fub non
  conosce del tratto di partenza; prendono id nuovi (`newNodeId("s")`) e
  `at` spostato all'inizio del pezzo.
- A21 · **«Gomma» è anche uno strumento del menu** (proposta del
  prototipo), per il mouse e per le penne senza retro; il retro della penna
  cancella sempre, qualunque strumento sia scelto.
- A22 · **L'evidenziatore sulla lavagna** è trasparente a metà (l'opacità di
  `penLook` di `ink/pens.ts`, 0,5) ma senza `multiply`, in tutti e due i
  temi: sulle schede scure (`--doc-bg` `#151a21`) `multiply` lo farebbe
  sparire (proposta del prototipo).
- A23 · **Il nero sul tema scuro** (proposta del prototipo): il campione si
  può scegliere e il suo nome dice «poco leggibile sul tema scuro»; il
  tratto si salva com'è, senza cambiare colore col tema.

## Il formato `fub:ink`

    {
      "nodes": [
        { "id": "f1", "type": "file", "file": "Corsi/Statistica/voti.xlsx",
          "x": 0, "y": 0, "width": 640, "height": 420,
          "fub:ink": { "v": 1, "strokes": [
            { "id": "s-mh0k2q1x-4f9a-1", "tool": "pen",
              "at": "2026-11-02T09:20:31.250Z",
              "brush": "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
              "color": "#0072b2",
              "anchor": { "kind": "card", "width": 640, "height": 420 },
              "ink": "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8" } ] } },
        { "id": "n2", "type": "text", "text": "Perché la media è così bassa?",
          "x": 700, "y": 40, "width": 280, "height": 90 }
      ],
      "edges": [],
      "fub:ink": { "v": 1, "strokes": [
        { "id": "s-mh0k2r7c-0b1e-2", "tool": "pen", "brush": "pf1 …",
          "color": "#0072b2", "anchor": { "kind": "free" }, "ink": "1 s100 cxypt …" } ] }
    }

_Lezione 4.canvas · schizzo_

- **Il livello**: l'oggetto `{"v": 1, "strokes": [...]}` sotto la chiave
  `fub:ink` di una scheda (di ogni tipo, gruppi compresi) o della radice. Gli
  altri campi del livello si conservano.
- **Il tratto**: `id` (unico nel livello; i nuovi come
  `newNodeId("s")` di `operation.ts`), `tool` (`"pen"` o `"highlighter"`),
  `at` facoltativo (ISO, come `fub:at` dei disegni), `brush` (la grammatica
  di `fub:brush`, §5 di `scene-format.md`, con `pen=`), `color`
  (`#rrggbb`), `anchor`, `ink` (la stringa `fub:ink` della §5: versione,
  scala, canali, campioni). I campi sconosciuti si conservano.
- **L'ancora**: `{"kind": "card", "width": W, "height": H}` è la misura della
  scheda quando il tratto si è scritto; i punti sono in unità della scheda a
  quella misura, con l'origine in alto a sinistra. Sposti la scheda: niente
  cambia nel file. La ridimensioni: niente cambia nel file; la resa, su
  immagini e PDF, scala il tratto da `W×H` alla misura di adesso con lo
  stesso fattore nei due sensi; sulle altre schede lo lascia com'è (D-9 (c),
  A17). `{"kind": "free"}` vuol dire
  punti in coordinate della lavagna. `card` vale solo in un livello di
  scheda, `free` solo alla radice; altrimenti il tratto non si disegna.
- **Ordine dei campi in scrittura** (R10 di N3): `id`, `tool`, `at`, `brush`,
  `color`, `anchor`, `ink`, poi gli sconosciuti nell'ordine in cui erano;
  nell'ancora `kind`, `width`, `height`.
- **Livello estraneo**: `v` diverso da 1, `strokes` che non è un array, un
  tratto senza `id` stringa o due tratti con lo stesso `id`. Si conserva byte
  per byte, non si disegna, Fub non ci scrive: la penna su quella scheda
  scrive inchiostro libero; se è estraneo il livello della radice, un tratto
  libero si rifiuta con un avviso (`canvas.ink.foreign`).
- **Tratto che non si disegna**: `tool`, `anchor`, `color`, `brush` o `ink`
  non validi, o oltre i limiti. Si conserva, non si disegna, la gomma non lo
  vede.
- **Limiti**: quelli della §5 per ogni tratto (10 000 campioni, 512 KiB della
  stringa `ink`), e i 16 MiB del file (`MAX_CANVAS_SOURCE_BYTES`). Un tratto
  nuovo che li supera si rifiuta con un avviso (`canvas.ink.full`).
- **L'ultimo tratto tolto**: se il livello resta esattamente
  `{"v": 1, "strokes": []}` la chiave sparisce; annulla la rimette in fondo
  alla scheda (per R9 il modello è lo stesso).
- `fub:ink` su un arco, o dentro un tratto, è un campo sconosciuto come gli
  altri.
- **Che cosa si disegna**: l'inchiostro di una scheda sopra il suo
  contenuto, come dice A17 (scalato senza deformarsi su immagini e PDF,
  fermo sulle altre); l'inchiostro libero sopra tutte le schede.
  Spostare o ridimensionare una scheda non scrive niente di nuovo nel file
  per l'inchiostro.

## La toppa e le operazioni

- **`LayerRef`**: `"board"` per la radice, `{"node": "<id>"}` per una scheda
  (una stringa sola sarebbe ambigua con una scheda di id `"board"`).
- **La toppa** `{"kind": "ink", "layer": LayerRef, "at": n, "before":
  tratto|null, "after": tratto|null}`: aggiunge (`before` nullo), toglie
  (`after` nullo) o cambia il tratto alla posizione `at` dell'array
  `strokes`. L'inversa scambia `before` e `after`. Un'immagine di prima che
  non torna (R9) o una scheda che non c'è è `Stale`; un livello estraneo è
  `Invalid`. La prima toppa crea il livello; l'ultimo tratto tolto lo toglie
  secondo la regola qui sopra.
- **Le operazioni d'intento** (le `CanvasOp` di N3 T8):
  `add_strokes {layer, strokes}` (un `id` mancante lo dà il seme, A10 di N3)
  ed `erase_strokes {layer, ids}`, compilate in toppe `ink`; errori nuovi
  `UnknownStroke` e `ForeignLayer` oltre a `UnknownNode`, `DuplicateId`,
  `Invalid`. `move` e `resize` non toccano l'inchiostro; `remove` porta via
  l'inchiostro della scheda (D-3 a).
- **Perché una toppa sua e non `upsert-node`**: un tratto su una scheda con
  2000 tratti, scritto come `upsert-node`, metterebbe due copie del livello
  intero in ogni passo di annulla (la cronologia tiene 100 passi,
  `MAX_CANVAS_HISTORY`). Spostare quella scheda resta un `upsert-node` che
  porta il livello intero: T10 misura quanti byte sono.

## Prove fatte

Stanotte, fuori dal repo sotto `/home/fubeo/.cache/fub-k1/tmp/n4`, e poi
cancellate.

1. `crates/fub-scene/src/ink.rs` e `brush.rs`, copiati in un crate con la
   sola dipendenza `fub-ink`, compilano per `wasm32-unknown-unknown` e i loro
   tre test d'unità passano. Usano solo `std` e `fub_ink` (`Sample`,
   `MAX_SAMPLES`). Quindi T6 è uno spostamento, non una riscrittura.
2. `fub-ink` da solo compila per `wasm32-unknown-unknown`.
3. I `pts` dell'esempio del passo, decodificati, sono in unità (61, 21…), non
   fra 0 e 1: le `u`, `v` del passo non bastano a rimettere un tratto in
   una scheda ridimensionata. La stessa traccia scritta nella stringa della
   §5 (scala 100) è circa il 40% più corta del base64 di `f32`, con un errore
   massimo di 0,005 unità.
4. `node --test <cartella>/` in Node 22 non trova i file e fallisce: le
   prove di questo piano nominano il file del test.
5. Lettura del codice, non prova: `patchCanvasSource`
   (`editors/canvas/source-edit.ts`) accoppia per `id` ogni array i cui
   elementi hanno tutti un `id` stringa, a ogni profondità; aggiungere un
   tratto riscrive solo il tratto nuovo. Il ritocco Rust di N3 T5 promette
   l'accoppiamento per gli array di schede e archi: T10 controlla con un
   test gli array annidati e, se serve, lo estende.

## Differenze dal passo 12b

Vince il codice; queste sono le differenze trovate e come il piano le
tratta.

- **Nessun foglio vivo nelle schede.** Le schede `file` sono segnaposti
  (`canvas-media-placeholder`, anche le immagini: «IMAGE · percorso»), e
  `#render` ridisegna tutte le schede a ogni cambio. «Un foglio da 10 000
  celle sotto la penna» oggi non esiste: T15 misura con una tabella di
  10 000 celle in una scheda di testo (D-7).
- **Lo scenario S5 è sul disegno**, non sulla lavagna, ed è solo fra le
  mete di `bench/webview/budgets.json`, non nella CI: T15 aggiunge uno
  scenario nuovo (S8 o il primo nome libero dopo N3 T15).
- **Il formato dei punti.** Il passo propone base64 di quadruple `f32`; il
  codice ha già la stringa `fub:ink` della §5 dei disegni, in Rust e in
  TypeScript, con lo stesso nome e un'altra grammatica (D-2). E `f32` non è
  «senza perdite» rispetto ai `f64` della pipeline.
- **L'ancora `u`, `v` del solo centro non basta**: i punti sono in unità, e
  per scalare un tratto con la scheda serve la misura che la scheda aveva.
  L'ancora v1 è `{"kind": "card", "width", "height"}`.
- **`anchorAt` del passo** sceglie la scheda più alta che contiene il centro;
  il piano guarda solo la scheda più alta che il tratto tocca (A3).
- **`pen`, `color`, `size` del passo** diventano `tool`, `brush` (con
  `pen=` e `size=`) e `color`, come nei disegni.
- **`openWetTrail` e `ink/wet` non esistono** (sono N5): il bagnato è
  `StrokePreview` in un SVG della lavagna.
- **`board.camera.toCanvas`, `board.commit`, `board.cards` non esistono**: la
  lavagna è `CanvasEngine` (`#screenToWorld`, `#commitLocal` con toppe).
- **Il mouse oggi disegna** in `fub-ink` (tasto principale = inchiostro) e non
  c'è un modo per dirgli di no: T1 aggiunge la regola del mouse.
- **L'adattatore non ferma l'evento**: la lavagna riceverebbe anche lei il
  `pointerdown` della penna (selezione, trascinamento, doppio tocco che crea
  una scheda di testo con `#dblclick`): T4 lo ferma.
- **Nessun dito né pizzico nella lavagna**: c'è solo in
  `graph/interaction.ts`; T14 lo porta.
- **PenQuiet dello schizzo** non ha chiave (il commento la promette), usa
  `setTimeout` senza proprietario (`check-listeners.mjs` lo vieta) e un
  globale del DOM nel nucleo dell'inchiostro (ADR 0204 punto 3 lo vieta):
  T2 lo scrive puro, con lo scheduler passato da fuori.
- **`AddStrokes`/`EraseStrokes` di 12a** diventano operazioni d'intento
  compilate in toppe `ink`, come tutte le `CanvasOp` di N3.
- **Il nucleo della lavagna di N3 non può dipendere da nessun membro del
  workspace** (`the_canvas_core_stands_alone`): per leggere l'inchiostro
  serve un'eccezione nominata per `fub-ink-codec` e `fub-ink` (T6, T8).
- **Il vettore `move-with-ink.json` di N3** (con `pts` finti) resta valido:
  i tratti si conservano e non si disegnano, perché il loro `ink` non è
  valido.
- **Il doppio clic sul vuoto crea una scheda di testo**: un doppio tocco di
  penna la creerebbe; T4 ferma `click` e `dblclick` dopo un tratto.

Trovate il 2026-11-02, rileggendo il codice per le risposte:

- **La resa di adesso stira**: `INK_ASPECT = "none"` in
  `editors/canvas/ink-paint.ts` (T4, D-9 (a)). D-9 (c) la cambia: T18.
- **Il tipo della scheda si calcola due volte in modo diverso**: `engine.ts`
  (il ramo `case "file"` del disegno delle schede) ha una sua lista di
  estensioni, `mediaKindOfId` di `editors/media/media-types.ts` un'altra (per
  esempio `bmp`, `heic`, `tiff` sono immagini solo per la seconda). T12 fa
  usare a tutte e due la stessa funzione, così la resa dell'inchiostro e
  `data-media-kind` non si contraddicono.
- **La pagina `docs/reference/canvas-ink.md`, sezione «Obsidian», decide già**
  «A più una copia B» se Obsidian perde i livelli: contro D-1 (c), che
  rimanda la scelta all'utente. T24 la corregge.
- **La decisione è la 0238**, non la 0237 che il piano pensava (A13).
- **Note e disegni hanno già le due gomme** (`rich.ink.whole` nel catalogo,
  `draw.eraser.stroke` e `draw.eraser.precise`, `editors/spatial/tools/
  erase-precise.ts`): T22 riusa `ink/tools/split.ts` come loro.
- **La tavolozza parte nera** (`INK_DEFAULT_COLOR` in `ink/palette.ts`, per
  note e disegni), la lavagna blu (`INK_PEN_COLOR` in
  `editors/canvas/ink-record.ts`): T21 tiene il blu solo per la lavagna.
- **L'evidenziatore dei disegni usa `multiply`** (`penLook` di
  `ink/pens.ts`): sul fondo scuro delle schede non si vede; A22.
- **La barra della lavagna si rifà a ogni disegno** (`bar.replaceChildren()`
  in `#drawToolbar`): un menu aperto ancorato a un pulsante rifatto si
  chiuderebbe da solo. T21 tiene vivi il pulsante della penna e
  l'interruttore.
- **La feature `fub.lavagna` non ha impostazioni** (`settings: None` in
  `crates/fub-features/src/inventory.rs`): T19 gliele dà.
- **T16 diceva «(D-6)» per l'interruttore ricordato**: è D-4.

## Cancello di N4

| Fatto quando | Prova | Task |
|---|---|---|
| prima misura: mentre si scrive sopra 10 000 celle, un `.xlsx` vero e 2000 tratti, si sa quanto dura il fotogramma più lungo (il caso simile, D-7 (c)); non chiude N4 | lo scenario nuovo di `npm run bench:webview`, il campo `penFrameGap.max`, la pagina in `docs/misure/` | T15 |
| seconda misura: sopra il foglio vero dentro la lavagna, nessun fotogramma oltre 33 ms; chiude la voce | lo stesso scenario sul ramo con l'anteprima di N6, la pagina in `docs/misure/` | T23 |
| spostare una scheda sposta il suo inchiostro; ridimensionarla lo scala senza deformarlo su immagini e PDF e lo lascia fermo sulle altre | i vettori `canvas-ops/move-card-with-ink.json`, `resize-card-with-ink.json` e `canvas-ink-fit/`; il test della tela che sposta, ridimensiona e legge la resa | T10, T12, T18 |
| annulla e ripeti funzionano per tratto e per passata di gomma, anche quella che taglia | `engine-ink.test.ts` | T12, T13, T22 |
| il `.xlsx` sotto l'inchiostro ha lo stesso hash prima e dopo | il test della tela (nessuna scrittura fuori dal `.canvas`) e lo sha256 nei rapporti delle due misure | T12, T15, T23 |
| si sa che cosa fa Obsidian ai campi `fub:ink`, e il posto dell'inchiostro è deciso | il kit di T7, lanciato dall'utente; l'ADR 0238 «accolta», oppure la risposta a D-12 e i suoi task fatti; la riga in DECISIONS.md | T7, T24 e l'utente |
| Rust e TypeScript leggono e cambiano l'inchiostro allo stesso modo, e dopo T17 le regole stanno in una copia sola (Rust, nel client per `.wasm`) | i vettori `canvas-ink/`, `canvas-patches/ink-*.json`, `canvas-ops/*ink*.json` in `cargo test -p fub-canvas-core` e in Vitest per `.wasm` | T8, T9, T10, T11, T17 |
| le due impostazioni ci sono, si leggono in Impostazioni in italiano e in inglese e partono spente | i test di `fub-features` e `fub-host`, lo specchio nel client | T19, T14, T16 |
| il menu della penna e «Scrivi col mouse» sono come il prototipo approvato, nei due temi | le schermate del banco accanto a `PLAN-ui/lavagna-penne.html` | T20, T16, T21 |
| N3 è già in `main`, la CI completa è verde e la revisione riga per riga è fatta | `gh pr checks 298` sulla PR non in bozza (Linux, Windows, macOS, banchi) | T25 |

## Regole che valgono per ogni task

- Vince il codice: se un percorso o una funzione non è come scritto qui, il
  coder lo dice nel suo rapporto e segue il codice.
- I numeri di riga e i nomi privati di `engine.ts` (`#commitLocal`,
  `#render`, `#keydown`, `#drawToolbar`, `#zoomAt`) sono quelli scritti
  quando il piano è nato; N3 T16, T19, T21 e T22 cambiano il motore: dopo,
  si cercano per nome e per ruolo.
- `engine.ts` lo cambia un task alla volta: N3 fino a T22 prima, poi in N4
  T12 → T13 → T14 → T22 → T16 → T21. Due task che toccano `engine.ts` non
  vanno in parallelo.
- Nessuna dipendenza esterna nuova, né in Rust né in npm.
- Il nucleo dell'inchiostro (`apps/client/src/ink/` fuori da `ink/dom/`) non
  usa globali del DOM e non conosce prodotti (ADR 0204 punto 3,
  `ink/boundary.test.ts`).
- Ascoltatori e timer passano da una `Lifetime` (`ui/lifetime.ts`):
  `check-listeners.mjs` vieta `window.addEventListener` e i timer non
  cancellati.
- Il TypeScript degli editor non scrive `var(--ruolo)`
  (`check-inline-theme.mjs`); il colore di un tratto è un valore del file e
  va come attributo `fill`.
- Niente `unwrap` o `expect` nei sorgenti Rust fuori dai test; ogni errore è
  un `Result` con un enum di `thiserror` dove il crate lo usa già.
- I vettori sono scritti a mano, non generati dal codice che verificano.
- Testi della shell in `catalog.ts`, con la chiave in tutte le lingue.
- Le pagine di `docs/` sono in italiano e restano nei limiti di
  `check-doc-size.mjs` (architettura 450 righe, riferimento 550, decisione
  180, `docs/README.md` e `docs/decisions/README.md` 150);
  `docs/architecture/editor-surfaces.md` è già a 449: non si tocca. Una pagina
  nuova è linkata da `docs/README.md`.
- Non scrivere numeri non misurati.
- Quando cambia `Cargo.toml` o `Cargo.lock` della radice (T6, T8),
  `scripts/check.sh --rapido` controlla tutto il workspace: è lento, è giusto.
- Mai il vault vero (`~/.cache/fub-live/`), mai `~/Progetti/Fub`.

## T1 · Il mouse che non scrive

Perché: regola 1 del passo: sulla lavagna il mouse seleziona, e scrive solo
con D tenuto o con l'interruttore. Oggi in `fub-ink` il tasto principale del
mouse è sempre inchiostro e non c'è un modo per dirgli di no.
Tocca: `crates/fub-ink/src/roles.rs`, `crates/fub-ink/src/session.rs`,
`crates/fub-ink/src/lib.rs`, `crates/fub-ink/tests/session.rs`,
`crates/fub-ink/tests/ts_mirror.rs`,
`apps/client/src/ink/__fixtures__/ink-samples.json` (rigenerato),
`apps/client/src/ink/input/roles.ts`, `apps/client/src/ink/input/roles.test.ts`,
`apps/client/src/ink/input/session.ts`,
`apps/client/src/ink/input/session.test.ts`,
`apps/client/src/ink/mirror.test.ts`,
`apps/client/src/ink/dom/pointer-adapter.ts`,
`apps/client/src/ink/dom/pointer-adapter.test.ts`,
`docs/architecture/ink-and-tools.md` (sezione «Chi disegna»).
Non toccare: gli editor (`editors/rich`, `editors/spatial`, `editors/canvas`):
il valore di serie resta «il mouse scrive» e nessun prodotto cambia;
`crates/fub-ink/benches/pipeline.rs` (costruisce la configurazione con `..`);
il resto di `ink-and-tools.md`.
Dipende da: —
Cosa fare:
- Rust: `pub enum MousePolicy { Ink, Ignore }` in `roles.rs`, con `Default`
  = `Ink`; il campo `mouse` in `RoleContext`; in `classify_pointer`, per
  `PointerKind::Mouse` con `Ignore`: tasto principale `Ignore`, centrale
  `Navigate` (come oggi), gli altri `Ignore`. Riesportato in `lib.rs`.
- `SessionConfig { mouse, .. }` (di serie `Ink`) e
  `Session::set_mouse_policy`, come `set_touch_policy`: vale per i tratti che
  cominciano dopo.
- `tests/ts_mirror.rs`: i casi dei ruoli girano con le due regole del mouse;
  il fixture si rigenera con `UPDATE_MIRROR=1 cargo test -p fub-ink --test
  ts_mirror`.
- TypeScript: `MousePolicy = "ink" | "ignore"`, `RoleContext.mouse`,
  `classifyPointer` (nel ramo `default`, che copre il mouse e il tipo `""`),
  `SessionConfig.mouse?` (di serie `"ink"`), `Session.setMousePolicy`;
  `mirror.test.ts` legge la regola dal fixture; l'adattatore prende
  l'opzione `mouse?` e dà `InkInput.setMousePolicy`.
- «Chi disegna»: una frase sulla regola del mouse e su chi la sceglie (il
  prodotto).
Casi limite: cambiare regola mentre un tratto di mouse è in corso (il tratto
finisce com'è); il tipo `""` segue la regola del mouse (lo si scrive nella
pagina: un driver che manda la penna come `""` con `"ignore"` non scrive);
il tasto centrale resta `Navigate` con tutte e due le regole; penna e dito
non cambiano con nessuna delle due.
Fatto quando: con `"ignore"` il tasto principale del mouse dà `ignore` in
Rust e in TypeScript e il fixture rigenerato contiene i casi; con la regola
di serie niente cambia: i test di oggi passano, toccati solo dove
costruiscono un `RoleContext`.
Prova: scripts/check.sh --rapido; cargo test -p fub-ink; cd apps/client &&
npx vitest run src/ink
Stato: [x] fatto

## T2 · PenQuiet

Perché: mentre una penna è giù il lavoro pesante (ridisegnare la lavagna
dopo una modifica da fuori) deve aspettare. Lo schizzo del passo non ha la
chiave che promette, usa un `setTimeout` senza proprietario e un globale del
DOM nel nucleo dell'inchiostro.
Tocca: `apps/client/src/ink/quiet.ts` (nuovo),
`apps/client/src/ink/quiet.test.ts` (nuovo),
`apps/client/src/ink/dom/idle.ts` (nuovo),
`apps/client/src/ink/dom/idle.test.ts` (nuovo).
Non toccare: `docs/architecture/ink-and-tools.md` (la sezione su PenQuiet la
scrive T4, che tocca la pagina dopo T1); `engine.ts`;
`ink/boundary.test.ts` (se il file nuovo lo fa fallire, si corregge il file
nuovo).
Dipende da: —
Cosa fare:
- `export type Schedule = (run: () => void) => () => void;` (dà la funzione
  che annulla).
- `class PenQuiet { constructor(schedule: Schedule); get active(): boolean;
  enter(); leave(); defer(key: string, work: () => void); dispose() }`.
- `enter`/`leave` contati; un `leave` di troppo non va sotto zero.
- `defer`: senza penna giù il lavoro gira subito; con la penna giù va in coda
  per chiave, e una seconda richiesta con la stessa chiave prende il posto
  della prima.
- All'ultimo `leave` la coda si consegna allo scheduler una volta; se una
  penna torna giù prima che giri, la consegna si annulla e la coda aspetta il
  `leave` dopo.
- Un lavoro che lancia non ferma gli altri: girano tutti, poi si rilancia il
  primo errore.
- `dispose`: annulla la consegna e svuota la coda; dopo, niente fa niente.
- `ink/dom/idle.ts`: `idleSchedule(owner: Lifetime, timeoutMs = 100):
  Schedule`, con `requestIdleCallback` letto da `globalThis` (WebKitGTK può
  non averlo) e altrimenti `setTimeout(run, 0)`; ogni richiesta si cancella
  col suo annulla e alla chiusura della `Lifetime`.
Casi limite: `leave` senza `enter`; `defer` chiamato da un lavoro che sta
girando; `enter` chiamato da un lavoro; la stessa chiave con lavori
diversi; `dispose` con una consegna in volo; `Lifetime` chiusa prima che la
consegna giri; ambiente senza `requestIdleCallback`.
Fatto quando: `quiet.test.ts`, con uno scheduler finto a mano, copre tutti i
casi limite; `idle.test.ts` copre i due rami e la chiusura della
`Lifetime`; `ink/boundary.test.ts` passa (`quiet.ts` non usa globali del
DOM).
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/ink/quiet.test.ts src/ink/dom/idle.test.ts src/ink/boundary.test.ts
Stato: [x] fatto

## T3 · La scheda sotto il tratto

Perché: ogni tratto sa a chi appartiene (regola 6 e le ancore del passo); la
scelta è una funzione pura che non dipende dal formato.
Tocca: `apps/client/src/editors/canvas/anchor.ts` (nuovo),
`apps/client/src/editors/canvas/anchor.test.ts` (nuovo).
Non toccare: `engine.ts`, `model.ts`, `operation.ts`; il formato (T5).
Dipende da: —
Cosa fare:
- `interface Bounds { x; y; width; height }`;
  `strokeBounds(points: Iterable<{ x: number; y: number }>, size: number):
  Bounds`, il riquadro dei punti allargato di metà spessore da ogni lato (un
  tocco solo ha comunque un'area).
- `anchorAt(nodes: readonly CanvasNode[], b: Bounds, canHold: (node:
  CanvasNode) => boolean): CanvasNode | null` secondo A3: fra le schede che
  intersecano `b` conta solo l'ultima dell'array (la più in alto); è sua se
  contiene il centro di `b`, se almeno metà dell'area di `b` sta dentro di
  lei e se `canHold(node)`; altrimenti `null` (tratto libero).
- Le schede con misure non finite o non positive non intersecano niente.
Casi limite: il centro esattamente sul bordo (i bordi contano dentro); metà
esatta (0,5 basta); un tratto di un punto solo; un gruppo sotto un figlio;
due schede uguali sovrapposte (vince l'ultima); coordinate oltre 2^53;
`canHold` falso sulla più alta mentre una sotto andrebbe bene (resta
libero).
Fatto quando: `anchor.test.ts` ha un caso con l'attesa scritta a mano per
ogni caso limite e passa; il file non importa niente del DOM.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/anchor.test.ts
Stato: [x] fatto

## T4 · Lo strato d'inchiostro della lavagna

Perché: serve un pezzo che prenda la penna sopra la lavagna, disegni la scia,
fermi l'evento prima che la lavagna lo usi per selezionare o spostare, e
disegni i tratti asciutti in modo che seguano la scheda anche durante il
trascinamento. Senza il formato: riceve tratti già pronti da disegnare.
Tocca: `apps/client/src/editors/canvas/ink-layer.ts` (nuovo),
`apps/client/src/editors/canvas/ink-layer.test.ts` (nuovo),
`apps/client/src/editors/canvas/ink-paint.ts` (nuovo),
`apps/client/src/editors/canvas/ink-paint.test.ts` (nuovo),
`apps/client/src/theme/scrittoio/structure.css`,
`docs/architecture/ink-and-tools.md` (una sezione nuova, «Lo strato della
lavagna»).
Non toccare: `engine.ts` (lo collega T12); `apps/client/src/ink/` (T1 e T2
sono fatti); `theme/scrittoio/skin/` (T16); il formato (T5, T9).
Dipende da: T1, T2
Cosa fare:
- `mountInkLayer(options, owner: Lifetime): InkLayer`. Le opzioni:
  `viewport`, `toWorld(clientX, clientY)`, `look()` (pennello, colore e
  strumento di adesso), `quiet: PenQuiet`, `onStroke(stroke)` (il tratto
  finito: l'id della scia, i campioni in coordinate della lavagna, il
  pennello e il colore), `onCancel?(id)`, `onErase?(id, points)` e
  `onEraseEnd?(id)` (le usa T13; qui si provano con un finto).
- Dentro: `attachInkInput(viewport, …, owner)` con `touch: "navigate"` e
  `mouse: "ignore"`; `onStart` chiama `quiet.enter()`, la fine e
  l'annullamento `quiet.leave()`.
- Un ascoltatore `pointerdown` in cattura sul viewport, registrato dopo
  `attachInkInput`: se `input.roleOf(pointerId)` è `ink`, `erase` o
  `barrel` chiama `stopPropagation()` e `preventDefault()`, così la lavagna
  non seleziona, non sposta, non prende il fuoco e non seleziona testo. Il
  `click` e il `dblclick` che arrivano dopo un tratto, prima del
  `pointerdown` seguente, si fermano allo stesso modo (il doppio tocco della
  penna non crea una scheda).
- La scia: `<svg class="canvas-ink-wet">` nel viewport, fuori dallo stage,
  con la trasformazione della camera (`setCamera(x, y, zoom)`, che T12
  chiama da `#applyCamera`); un percorso per tratto con `StrokePreview` di
  `ink/tools/stroke.ts`. `settle(id)` toglie la scia di un tratto (T12 la
  chiama nello stesso giro in cui aggiunge l'asciutto).
- `ink-paint.ts`: `DryStroke { id; path; fill; ref: { width; height } |
  null; faded? }` (`path` in unità della misura di riferimento, `ref` nullo
  per l'inchiostro libero). `paintCard(host, strokes)` mette nell'elemento
  della scheda un `<svg class="canvas-ink-card">` largo e alto 100%, con
  dentro un `<svg>` per ogni misura di riferimento (`viewBox="0 0 W H"`,
  100%, `preserveAspectRatio="none"` per D-9 a; per D-9 b basta
  `"xMinYMin meet"`), un `<path>` per tratto con `fill` come attributo. Così
  `#renderLive`, che durante trascinamento e ridimensionamento cambia solo
  posizione e misura dell'elemento, porta l'inchiostro con sé senza
  ridisegnare. `paintBoard(stage, strokes)`: `<svg class="canvas-ink-board">`
  dopo le schede, in coordinate della lavagna, come `canvas-edges`. Una cache
  dei percorsi per `id` + `ink` + `brush`, che a ogni giro lascia andare ciò
  che non si disegna più.
- `structure.css`: posizione, `overflow: visible`, `pointer-events: none` per
  i tre SVG; nessun colore (viene dal tratto).
- La sezione «Lo strato della lavagna»: chi ferma l'evento e perché, la scia
  e l'asciutto, PenQuiet e il suo scheduler.
Casi limite: la penna sulla testata, sulla maniglia o su `[data-connect]` di
una scheda (scrive: A1); la penna su una scheda di testo in modifica (il
campo resta com'è); un tratto annullato dall'adattatore (palmo, perdita della
cattura, finestra nascosta: la scia sparisce e `quiet.leave()` arriva una
volta); due penne insieme (due scie); `setCamera` durante un tratto; un
`pointerdown` sul viewport stesso e uno su una scheda (tutti e due
fermati); il mouse con `"ignore"` (arriva alla lavagna, nessuna scia).
Fatto quando: in happy-dom, una penna finta sul viewport fa apparire la scia
in `.canvas-ink-wet`, `onStroke` riceve i campioni in coordinate della
lavagna, e un ascoltatore a bolla sul viewport (come quello della lavagna)
non riceve né `pointerdown` né `click` né `dblclick`; il mouse arriva
all'ascoltatore e non fa scia; `paintCard` con due misure di riferimento
crea due SVG annidati coi `viewBox` giusti; cambiare la misura dell'elemento
non tocca i percorsi; un tratto uguale non si ricalcola.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/ink-layer.test.ts src/editors/canvas/ink-paint.test.ts
Stato: [x] fatto
  Da rivedere: T18 lo cambia (D-9 (c)).

## T5 · La forma `fub:ink` e la decisione

Perché: il formato è una forma condivisa (Rust, TypeScript, Obsidian, altri
programmi); va scritto e provato con vettori prima di chi lo usa.
Tocca: `docs/reference/canvas-ink.md` (nuovo),
`docs/decisions/NNNN-inchiostro-sulla-lavagna.md` (nuovo; NNNN è il primo
numero libero, probabilmente 0237), `docs/decisions/README.md`,
`docs/README.md` (un link fra i contratti),
`docs/reference/canvas-format.md` (un rimando; esiste dopo N3 T1),
`apps/client/src/__fixtures__/canvas-ink/` (nuovo).
Non toccare: il codice; `DECISIONS.md` (la riga c'è già); le pagine di N3
oltre al rimando.
Dipende da: N3 T1; le risposte a D-1 e D-2 (o la raccomandazione)
Cosa fare:
- `canvas-ink.md`: il livello, il tratto, l'ancora, l'ordine dei campi, il
  livello estraneo, il tratto che non si disegna, i limiti, l'ultimo tratto
  tolto, come si stira (le regole della sezione «Il formato `fub:ink`» di
  questo piano); un esempio completo; dove stanno i vettori. La toppa e le
  operazioni le scrive T10 in `canvas-operations.md`: qui un rimando.
- La decisione, in stato «proposta»: il contesto (passo 12b, A11 di N3), la
  scelta (A con la stringa della §5 e la misura di riferimento), le
  alternative (B, base64 di `f32`, `u`/`v`), le conseguenze (T6,
  l'eccezione nel nucleo, la prova di Obsidian). Passa ad «accolta» quando
  l'utente risponde a D-1 e la prova di T7 è fatta.
- Almeno 20 vettori, uno per file: `{name, description, source, expect:
  {layers: [{layer, state: "ok"|"foreign", strokes: [{id, drawn, reason?}]}]}}`
  con `source` il testo grezzo del `.canvas` e `reason` una parola fissa
  (`tool`, `anchor`, `color`, `brush`, `ink`). Coprono: livello vuoto, radice
  e scheda insieme, gruppo, ogni ragione, `v: 2`, `strokes` non array, id
  doppio, id mancante, `card` alla radice, `free` su una scheda, colore a tre
  cifre, campi sconosciuti nel livello e nel tratto, `fub:ink` su un arco,
  un `at` che non è una data (il tratto si disegna, `at` si conserva), BOM e
  CRLF.
Casi limite: i limiti di dimensione si provano nei test d'unità di T8 e T9,
non nei vettori (un vettore da 512 KiB non sta nel repo); misure scritte
come `640.0` (R9: si confrontano per valore); due livelli estranei nello
stesso file.
Fatto quando: la pagina e la decisione esistono, sono linkate da
`docs/README.md` e `docs/decisions/README.md`, e `check-doc-size` e
`check-prose` passano; ogni vettore si legge come JSON e il suo `source`
anche.
Prova: scripts/check.sh --rapido; node -e "const fs = require('fs'), d =
'apps/client/src/__fixtures__/canvas-ink/'; for (const f of
fs.readdirSync(d)) JSON.parse(JSON.parse(fs.readFileSync(d + f,
'utf8')).source.replace(/^\uFEFF/, ''))"
Stato: [x] fatto
  Da rivedere: T18 lo cambia (D-9 (c)).

## T6 · Il crate `fub-ink-codec`

Perché: il nucleo della lavagna (N3) non può dipendere da `fub-scene`, che
porta con sé il lettore XML dei disegni; il codec dei tratti (§5) e la
grammatica dei pennelli invece servono a tutti e due. La prova 1 dice che si
spostano senza riscriverli.
Tocca: `crates/fub-ink-codec/` (nuovo: `Cargo.toml`, `src/lib.rs`, e
`src/ink.rs`, `src/brush.rs` spostati con `git mv` da `crates/fub-scene/src/`),
`crates/fub-scene/Cargo.toml`, `crates/fub-scene/src/lib.rs`, `Cargo.toml`
(radice: membro e `[workspace.dependencies]`), `Cargo.lock`,
`crates/fub-abi/tests/dependency_invariant.rs`,
`docs/decisions/0204-nucleo-inchiostro.md` (punto 2),
`docs/reference/scene-format-pens.md` (riga 7),
`docs/architecture/overview.md`, `docs/map/repo.md`.
Non toccare: `crates/fub-scene/src/classify.rs` e `export.rs` (con le
riesportazioni non cambiano); i test di `crates/fub-scene/tests/`, che
devono passare così come sono; `crates/fub-ink`; il client.
Dipende da: la risposta a D-2 (con D-2 b il task non si fa)
Cosa fare:
- Il crate con la sola dipendenza `fub-ink`; `ink.rs` (quantizzazione
  compresa) e `brush.rs` interi, coi loro test d'unità.
- `fub-scene`: `pub use fub_ink_codec::ink;` al posto di `pub mod ink;` e
  `use fub_ink_codec::brush;` al posto di `mod brush;`; le riesportazioni di
  `lib.rs` restano: l'API pubblica di `fub-scene` non cambia.
- `dependency_invariant.rs`: `fub-ink-codec` in `SCENE_ALLOWED_DIRECT` e in
  `INK_ALLOWED_DEPENDENTS`; un test nuovo `the_ink_codec_stands_alone`
  (dipende solo da `fub-ink`; i suoi clienti sono `fub-scene` e, da T8,
  `fub-canvas-core`), col messaggio che rimanda alla 0204.
- La 0204, punto 2: il crate nuovo fra i clienti, con il perché.
Casi limite: un plugin prende `fub-scene` per revisione Git e lo compila per
`wasm32-wasip2`: il crate nuovo sta nello stesso repo e non ha codice di
piattaforma; N3 T1 e N3 T13 toccano anche `dependency_invariant.rs` (alla
fusione si tengono tutte le liste); `check-cargo-versions` vuole la
dipendenza in `[workspace.dependencies]`; i link `crate::` nei commenti dei
file spostati.
Fatto quando: `cargo test -p fub-scene` passa senza toccare i suoi test;
`cargo test -p fub-ink-codec` passa; il crate compila per
`wasm32-unknown-unknown`; il test nuovo dell'invariante passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-ink-codec -p fub-scene;
cargo build -p fub-ink-codec --target wasm32-unknown-unknown; cargo test -p
fub-abi --test dependency_invariant
Stato: [x] fatto

## T7 · Il kit per la prova con Obsidian

Perché: il cancello chiede di sapere che cosa fa Obsidian ai campi
`fub:ink`; Obsidian non c'è su questa macchina e un coder non può aprirlo.
Il kit fa sì che all'utente bastino pochi minuti (D-8).
Tocca: `tools/prova-obsidian/README.md` (nuovo),
`tools/prova-obsidian/lavagna-di-prova.canvas` (nuovo),
`tools/prova-obsidian/confronta.mjs` (nuovo),
`tools/prova-obsidian/confronta.test.mjs` (nuovo),
`docs/reference/canvas-ink.md` (sezione «Obsidian»), `docs/map/repo.md`
(una riga per la cartella).
Non toccare: la shell; il vault vero; il formato (se il kit trova un buco si
dice nel rapporto); `DECISIONS.md`; `scripts/check.sh` e la CI (il kit è
una prova a mano: il suo test si lancia a mano).
Dipende da: T5
Cosa fare:
- La lavagna di prova: una scheda di testo, una `file`, un gruppo, ognuna
  con un livello valido; un livello alla radice; un livello estraneo
  (`v: 2`); un campo sconosciuto in un tratto; `fub:ink` su un arco. I
  tratti veri, presi dai vettori di T5.
- `node tools/prova-obsidian/confronta.mjs <prima.canvas> <dopo.canvas>`:
  per ogni livello (per id della scheda, e la radice) dice se c'è ancora, se
  è uguale per valore, se è cambiato e dove, e se la scheda si è spostata o
  ridimensionata. Esce con 0 se ogni livello c'è ed è uguale per valore, 1
  se no, 2 se un file non si legge. Solo `node:fs`, niente dipendenze.
- Il README, in italiano e in pochi passi: copiare la lavagna in un vault
  di prova (mai quello vero), aprirla in Obsidian, spostare una scheda,
  ridimensionarne un'altra, salvare, lanciare lo script, incollare l'uscita
  nella risposta a D-8.
- `confronta.test.mjs` con `node:test`, coi file temporanei sotto
  `os.tmpdir()`: file uguali (0), livello perso (1), livello cambiato (1),
  scheda spostata col livello intatto (0, e lo dice), file illeggibile (2).
- La sezione «Obsidian»: che cosa si sa (niente, finché l'utente non prova),
  come si prova, che cosa decide (A resta; oppure A più una copia B).
Casi limite: Obsidian riordina le chiavi o riscrive `640` come `640.0`
(uguale per valore: 0); toglie il livello solo dalle schede che sposta;
toglie una scheda; il file con BOM.
Fatto quando: il test passa; lo script sulla lavagna di prova contro se
stessa esce con 0.
Prova: scripts/check.sh --rapido; node --test
tools/prova-obsidian/confronta.test.mjs; node
tools/prova-obsidian/confronta.mjs tools/prova-obsidian/lavagna-di-prova.canvas
tools/prova-obsidian/lavagna-di-prova.canvas
Stato: [x] fatto

## T8 · L'inchiostro nel nucleo della lavagna

Perché: il nucleo Rust di N3 è l'autorità sulla lavagna (host, CLI, MCP,
WebView); deve sapere leggere e controllare l'inchiostro come la shell.
Tocca: `crates/fub-canvas-core/src/ink.rs` (nuovo),
`crates/fub-canvas-core/src/lib.rs`, `crates/fub-canvas-core/Cargo.toml`,
`crates/fub-canvas-core/tests/ink_vectors.rs` (nuovo), `Cargo.lock`,
`crates/fub-abi/tests/dependency_invariant.rs`,
`docs/reference/canvas-format.md` (sezione «Chi lo usa»),
`docs/architecture/overview.md`. Il crate e la pagina esistono dopo N3 T1.
Non toccare: `patch.rs`, `ops.rs`, `commit.rs`, `source.rs` (T10);
`crates/fub-format-canvas`; il client; `docs/reference/canvas-ink.md` (un
errore della pagina si dice nel rapporto).
Dipende da: T5, T6; N3 T1, N3 T3
Cosa fare:
- `LayerRef` (serde: `"board"` oppure `{"node": id}`), `InkLayer`,
  `InkStroke` (i campi noti più quelli sconosciuti, come il resto del
  modello), lo stato del livello (`Ok`, `Foreign`) e del tratto (disegnato,
  oppure conservato con la ragione).
- `read_layers(&Canvas)` (tutti i livelli col loro stato) e
  `layer(&Canvas, &LayerRef)`; i controlli con `fub_ink_codec::ink` (la
  stringa) e `fub_ink_codec::brush` (il pennello) e i loro limiti.
- Il giro lettura e scrittura non perde niente (A11 di N3).
- `dependency_invariant.rs`: `fub-ink-codec` in `CANVAS_CORE_ALLOWED_DIRECT`
  e un'eccezione nominata nella chiusura di `the_canvas_core_stands_alone`
  per `fub-ink-codec` e `fub-ink`, gli unici membri del workspace ammessi;
  `fub-canvas-core` fra i clienti nel test di T6.
- `tests/ink_vectors.rs` legge `apps/client/src/__fixtures__/canvas-ink/`
  come `patch_vectors.rs` di N3 T7 legge i suoi.
- I limiti nei test d'unità: 10 001 campioni, stringa oltre 512 KiB.
Casi limite: misure scritte `640.0` o `6.4e2`; `width` o `height` zero o
negative (non si disegna, ragione `anchor`); colore con cifre maiuscole
(valido, si riscrive com'era); `at` che non è una data (il tratto si
disegna, `at` si conserva); un livello su un arco (campo sconosciuto).
Fatto quando: `tests/ink_vectors.rs` passa su tutti i vettori di T5; il
nucleo compila per `wasm32-unknown-unknown`; l'invariante passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cargo build
-p fub-canvas-core --target wasm32-unknown-unknown; cargo test -p fub-abi
--test dependency_invariant
Stato: [x] fatto

## T9 · I tratti nel client

Perché: la shell deve leggere i livelli come il nucleo, e trasformare un
tratto finito nel record da salvare; sono le stesse regole di T8, in
TypeScript, sugli stessi vettori.
Tocca: `apps/client/src/editors/canvas/ink-record.ts` (nuovo),
`apps/client/src/editors/canvas/ink-record.test.ts` (nuovo),
`apps/client/src/editors/canvas/ink-vectors.test.ts` (nuovo).
Non toccare: `engine.ts`; `operation.ts` (T11); `model.ts`;
`editors/spatial/ink/codec.ts` e `ink/` (si importano); `ink-layer.ts` e
`ink-paint.ts` salvo il tipo `DryStroke` se non basta (si dice nel
rapporto).
Dipende da: T3, T4, T5
Cosa fare:
- `readInkLayers(doc: CanvasDocument)`: per ogni livello lo stato, per ogni
  tratto disegnato o conservato con la ragione (le stesse parole dei
  vettori), e i tratti disegnabili già decodificati.
- `strokeRecord(stroke, holder: CanvasNode | null, look, now)`: porta i
  campioni in unità della scheda (o lascia quelle della lavagna se il tratto
  è libero) come fa il disegno, con `buildStroke` di `ink/tools/stroke.ts` e
  la matrice dalla lavagna alla scheda, poi `encodeInk`
  (`editors/spatial/ink/codec.ts`); lo spessore è 4 pixel dello schermo
  diviso lo zoom (A11); l'ancora prende la misura della scheda di adesso;
  l'id è `newNodeId("s")`. Oltre i limiti (`INK_MAX_SAMPLES`,
  `INK_MAX_BYTES`) dà un rifiuto, non un'eccezione.
- `toDry(record)`: il `DryStroke` di T4, col percorso di `inkPath`
  (`ink/outline.ts`, dopo `decodeInk` e `inkToQuantized` di `codec.ts`).
- `ink-vectors.test.ts`: gli stessi vettori di T5 con `import.meta.glob`,
  contro `readInkLayers`.
Casi limite: un tratto che l'adattatore ha spezzato (più record, uno per
pezzo); zoom molto piccolo e molto grande; una scheda a coordinate negative;
il mouse senza pressione; un tratto di un punto solo.
Fatto quando: `ink-vectors.test.ts` passa sugli stessi vettori di T8; un
record scritto e riletto dà un tratto disegnabile con gli stessi punti entro
l'errore della §5; un tratto oltre i limiti si rifiuta.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/ink-record.test.ts src/editors/canvas/ink-vectors.test.ts
Stato: [x] fatto

## T10 · La toppa e le operazioni in Rust

Perché: ogni tratto è un passo di annulla, e un agente deve poter aggiungere
e cancellare tratti; la toppa `ink` e le due operazioni vivono nel nucleo,
coi vettori che il client riusa in T11.
Tocca: `crates/fub-canvas-core/src/patch.rs`,
`crates/fub-canvas-core/src/ops.rs`, `crates/fub-canvas-core/src/source.rs`
(solo se il test dice che gli array annidati non si accoppiano per id),
`crates/fub-canvas-core/tests/ink_patch.rs` (nuovo),
`apps/client/src/__fixtures__/canvas-patches/` (vettori nuovi `ink-*.json`),
`apps/client/src/__fixtures__/canvas-ops/` (vettori nuovi coi nomi della
lista qui sotto), `docs/reference/canvas-operations.md` (sezione
«Inchiostro»). File e cartelle esistono dopo N3 T5–T8.
Non toccare: `ink.rs` (T8) e `commit.rs` salvo errori (si dice nel
rapporto); il client (T11); i vettori di N3 (`move-with-ink.json` resta
com'è).
Dipende da: T8; N3 T5, N3 T6, N3 T7, N3 T8
Cosa fare:
- `CanvasPatch::Ink { layer, at, before, after }` in `patch.rs`, con
  `draft`, `apply`, `inverse` e il confronto per valore (R9); `Stale` e
  `Invalid` come nella sezione «La toppa e le operazioni»; il livello nasce
  con la prima toppa e la chiave sparisce secondo la regola dell'ultimo
  tratto.
- `CanvasOp::AddStrokes` ed `EraseStrokes` in `ops.rs`, compilate in toppe
  `ink`; id dal seme (A10 di N3); gli errori nuovi `UnknownStroke` e
  `ForeignLayer`. `remove` porta via l'inchiostro con la scheda (D-3 a).
- `tests/ink_patch.rs`: un tratto aggiunto a una scheda con 2000 tratti
  cambia nel sorgente solo il tratto nuovo (`Committed.edit` di N3 T7 è
  piccolo); se non è così, `source.rs` impara ad accoppiare per id gli
  array annidati, come `patchCanvasSource`.
- La misura in byte, nel rapporto: la toppa di spostamento di una scheda
  con 2000 tratti, e i byte che cambiano nel sorgente per un tratto nuovo.
- Almeno 12 vettori `canvas-patches/ink-*.json`, nella forma di N3 T7:
  aggiungere alla radice; aggiungere a una scheda senza livello (nasce) e con
  livello; togliere l'ultimo tratto (la chiave sparisce) e la sua inversa;
  togliere l'ultimo tratto di un livello con campi in più (la chiave resta);
  cambiare un tratto; immagine di prima che non torna; scheda che non c'è;
  livello estraneo; `at` oltre la fine; due toppe sullo stesso livello; un
  tratto con campi sconosciuti; CRLF e BOM.
- Almeno 8 vettori `canvas-ops/`, nella forma di N3 T8:
  `add-strokes-board.json`, `add-strokes-card.json`,
  `add-strokes-seed-id.json`, `erase-strokes.json`,
  `erase-strokes-unknown.json`, `add-strokes-foreign.json`,
  `move-card-with-ink.json`, `resize-card-with-ink.json`,
  `remove-card-with-ink.json`.
- La sezione «Inchiostro» di `canvas-operations.md`, con un esempio per la
  toppa e per ogni operazione.
Casi limite: `erase_strokes` con un id ripetuto; `add_strokes` con un id già
preso (`DuplicateId`); la toppa su un gruppo; l'annulla di «togli l'ultimo
tratto» (il livello torna in fondo ai campi della scheda, R10).
Fatto quando: `cargo test -p fub-canvas-core` passa (vettori delle toppe,
delle operazioni e `ink_patch.rs`); il rapporto dà le due misure in byte.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core
Stato: [x] fatto

## T11 · La toppa nel client

Perché: la tela costruisce la toppa di un tratto e la manda al nucleo; il
tipo e i costruttori stanno in `operation.ts`, e i vettori di T10 devono
passare anche dal lato della shell.
Tocca: `apps/client/src/editors/canvas/operation.ts`,
`apps/client/src/editors/canvas/operation.test.ts`; e solo se elencano i file
a mano invece di leggere la cartella, `editors/canvas/vectors.test.ts`
(N3 T7) e `editors/canvas/wasm/vectors.test.ts` (N3 T14).
Non toccare: `engine.ts` (T12); `source-edit.ts` salvo errori (si dice nel
rapporto); i vettori di T10 (un vettore che fallisce in TypeScript si
corregge in TypeScript, non nel vettore).
Dipende da: T9, T10; N3 T7 (e N3 T14, se è fatto)
Cosa fare:
- Il tipo della toppa `ink` nell'unione `CanvasPatch`, `LayerRef` e il tipo
  del tratto salvato.
- `addStrokePatch(doc, layer, record)` (in fondo all'array) ed
  `eraseStrokePatch(doc, layer, id)`.
- Se N3 T18 non ha ancora tolto la logica TypeScript (`canvasDraft`,
  `applyCanvasPatches`, `inverseCanvasPatches`, `commitCanvasPatches`), la
  toppa `ink` anche lì, così i vettori passano contro il TypeScript; se l'ha
  tolta, solo tipi e costruttori, e i vettori passano dal WebAssembly (N3
  T14).
Casi limite: la toppa su una scheda tolta nel frattempo (`Stale`); più toppe
`ink` nello stesso commit (una passata di gomma); l'inversa di una lista con
aggiunte e tolte nello stesso livello (l'ordine degli `at`).
Fatto quando: `npx vitest run src/editors/canvas` passa coi vettori `ink-*`;
i due costruttori hanno test.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [x] fatto

## T12 · La penna scrive sulla lavagna

Perché: è il cuore di N4: la penna scrive, il tratto si salva nel `.canvas`
con un passo di annulla, segue la scheda, e niente rallenta mentre si
scrive.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-ink.test.ts` (nuovo),
`apps/client/src/i18n/catalog.ts`, `docs/architecture/ink-and-tools.md`
(sezione «Come lo usa la lavagna»).
Non toccare: `engine.test.ts` (deve passare com'è), `surface.ts`,
`ink-layer.ts`, `ink-paint.ts`, `ink-fit.ts`, `ink-record.ts`,
`operation.ts`, `wasm/` salvo errori (si dice nel rapporto); la barra e gli
stili (T16, T21); la gomma (T13, T22); il dito (T14).
Dipende da: T2, T4, T9, T11, T17, T18; N3 T16, T19, T21, T22 (tutti e
quattro cambiano `engine.ts`: il ramo li contiene già, vedi «Chi aspetta
chi»)
Cosa fare:
- La lavagna apre una `openLifetime()` quando nasce e la chiude in
  `destroy`, accanto al suo `AbortController`; dentro, `PenQuiet` con
  `idleSchedule` e lo strato di T4, che non si monta in sola lettura o se la
  lavagna è troppo grande (A8).
- `#applyCamera` chiama `setCamera` dello strato; `#render` disegna
  l'asciutto (`paintCard` per ogni scheda col suo livello e il modo di T18,
  poi `paintBoard`). Il tipo della scheda viene da `mediaKindOfId`
  (`editors/media/media-types.ts`), e lo stesso valore va in
  `data-media-kind`: la lista di estensioni scritta in `engine.ts` se ne va
  (vedi «Differenze»), così resa e segnaposto non si contraddicono.
- Lo stato dei livelli (quali tratti si disegnano, quali livelli sono
  estranei) viene dal nucleo per `.wasm` (T17), una volta per testo nuovo
  (`open`, `reset`, `commit`), non a ogni disegno.
- Un tratto finito: `anchorAt(doc.nodes, strokeBounds(...), canHold)` (il
  livello della scheda non è estraneo), `strokeRecord`, `addStrokePatch`,
  poi `#commitLocal(patches, …, render = false)`: una chiamata al nucleo per
  tratto. Nello stesso giro si aggiunge l'asciutto del solo livello toccato e
  si chiama `settle(id)`.
- Un tratto spezzato dall'adattatore si salva pezzo per pezzo, ma nella
  cronologia è un passo (A4).
- Il testo in sospeso di una scheda (`#pending` di N3 T16) si registra prima
  del tratto, come prima di ogni altro gesto: sono due passi di annulla, il
  testo e poi il tratto. Il campo resta aperto col suo testo (A1).
- Annulla e ripeti passano dalla via di N3 T21 (il tratto di testo esatto
  se la versione torna, le toppe inverse se no); un passo fatto solo di
  toppe `ink` ridisegna solo lo strato, senza `#render`; con una penna giù
  annulla e ripeti non fanno niente (A5).
- La sola lettura della tela di N3 T22 (testo che Fub non può riscrivere) va
  e viene da sola: lo strato si smonta quando arriva e si rimonta quando se
  ne va; un tratto in corso si annulla (la scia sparisce) e resta l'avviso
  della sola lettura, senza un secondo avviso.
- `syncDoc` (A9): modello e sorgente si aggiornano subito (il nucleo
  compreso); `#render()` passa da `quiet.defer("render", …)`.
- Gli avvisi, con `#showIntakeError` e chiavi nuove in italiano e inglese:
  `canvas.ink.full` (tratto oltre i limiti, file oltre 16 MiB),
  `canvas.ink.foreign` (livello della radice estraneo),
  `canvas.ink.refused` (il nucleo rifiuta il commit). La scia sparisce.
- Gomma e tasto laterale, fino a T13: niente scia e niente gesto della
  lavagna.
- La sezione «Come lo usa la lavagna»: chi decide la scheda, il passo di
  annulla, la modifica da fuori a penna giù.
Casi limite: la scheda tolta da fuori mentre la penna è giù (il tratto va
libero); la lavagna chiusa a penna giù (il tratto si perde senza errori, la
`Lifetime` chiude tutto); il commit rifiutato; il passo numero 101 della
cronologia; due penne che finiscono nello stesso fotogramma; zoom molto
piccolo e molto grande; duplicare (A6) e cancellare (D-3) una scheda con
inchiostro; sola lettura del pannello e della tela (N3 T22), anche arrivata
a penna giù; una penna che scrive sopra una scheda col campo aperto e il
testo non ancora registrato; un'immagine `.heic` o `.bmp` (immagine per
`mediaKindOfId`, scala); una scheda video (resta ferma).
Fatto quando: `engine-ink.test.ts` (happy-dom, penna finta) prova che: un
tratto è una toppa `ink`, una chiamata al nucleo e un passo; annulla e
ripeti vanno per tratto e ridanno il testo di prima byte per byte (N3
T21); spostare una scheda porta il suo inchiostro; ridimensionare
un'immagine o un PDF lo scala senza deformarlo e ridimensionare una nota lo
lascia fermo (stessi percorsi, gli attributi di T18); il testo in sospeso e
il tratto sono due passi; `syncDoc` a penna giù ridisegna dopo; la sola
lettura di N3 T22 smonta lo strato e lo rimonta; l'unica cosa scritta è il
testo del `.canvas` (nessuna chiamata che scrive altri file);
`engine.test.ts` passa invariato.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T13 · La gomma e il tasto D

Perché: il retro della penna e il tasto laterale cancellano (regola 2), e
col mouse si scrive tenendo premuto D (regola 1).
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-ink.test.ts`,
`apps/client/src/editors/canvas/ink-layer.ts`,
`apps/client/src/editors/canvas/ink-layer.test.ts`,
`apps/client/src/editors/canvas/ink-paint.ts`.
Non toccare: `apps/client/src/ink/` (`EraseSweep` si importa); `operation.ts`
e `ink-fit.ts` salvo errori (si dice nel rapporto); la barra e gli stili
(T16, T21); il dito (T14); la gomma che taglia (T22).
Dipende da: T12, T18
Cosa fare:
- La gomma (ruolo `Erase` o `Barrel` dell'adattatore): `EraseSweep` di
  `ink/tools/sweep.ts` sui tratti disegnati, in coordinate della lavagna
  (i punti di un tratto di scheda passano dalla trasformazione di
  `ink-fit.ts`, così la gomma prende il tratto dove si vede); i
  tratti presi si attenuano (opacità 0,25, come `FADED_OPACITY` di
  `editors/spatial/painter/svg-dom.ts`), con un attributo sul path,
  senza ridisegnare il resto.
- Alla fine della passata, un commit con una `eraseStrokePatch` per tratto:
  un passo di annulla. Nessun tratto preso: nessun commit. Passata annullata
  (`onCancel`): i tratti tornano normali.
- Il tasto D in `#keydown` (oggi gestisce solo z, y, a, d, +, -, 0 con Ctrl
  o Cmd): D senza modificatori, non ripetuto, fuori dai campi di testo,
  porta il mouse a `"ink"` e mette `data-ink="pen"` sul viewport; al
  rilascio, alla perdita del fuoco (`lifetime.listen(window, "blur")`) e a
  `visibilitychange` torna `"ignore"`. Un tratto di mouse già giù finisce
  normalmente.
- `setInkMouse(on: boolean)` sulla lavagna, per l'interruttore di T16.
- Questa è la gomma «Il tratto intero», quella di serie (A20); quella che
  taglia arriva con T22.
Dal prototipo: la gomma che sbiadisce il tratto (opacità 0,25), come il
tratto d'esempio della pagina con «Il tratto intero».
Casi limite: D in un campo di testo della scheda (scrive la lettera); D
lasciato a metà tratto; la gomma su una scheda di un livello estraneo
(niente si cancella); una passata che prende tratti di più livelli (più
toppe, un passo); la gomma su un tratto conservato e non disegnato (non si
vede, non si prende); la gomma su un'immagine ingrandita e su una nota
rimpicciolita (prende il tratto dove si vede, non dove sarebbe stirato).
Fatto quando: `engine-ink.test.ts` prova che la gomma cancella i tratti
toccati in un passo e che l'annulla li rimette; che prende il tratto di
un'immagine ridimensionata dove si vede; che D tenuto fa scrivere il
mouse e D lasciato no; che D in un campo di testo non cambia niente;
`engine.test.ts` passa invariato.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T14 · Il dito sposta e ingrandisce

Perché: sul tablet il dito sposta e ingrandisce la lavagna (regola 1); oggi
la lavagna non ha pizzico, e il dito trascina le schede come il mouse.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/touch.ts` (nuovo),
`apps/client/src/editors/canvas/touch.test.ts` (nuovo),
`apps/client/src/editors/canvas/engine-touch.test.ts` (nuovo).
Non toccare: `apps/client/src/graph/interaction.ts` (si imita, non si cambia);
`ink-layer.ts` (il dito è già `navigate`); la barra e gli stili (T16, T21);
`preferences.ts` salvo l'uso (è di T19).
Dipende da: T13, T19
Cosa fare:
- `touch.ts`, puro: `pinchCamera(start, a0, b0, a1, b1)` che dà la camera
  nuova da due dita (centro e distanza), entro i limiti di zoom della
  lavagna; e la soglia del tocco breve.
- Nella lavagna, `pointerType === "touch"`: un dito sposta la vista ovunque,
  tranne sulla testata della scheda (`canvas-node-handle`, che sposta la
  scheda), sulle maniglie di ridimensionamento, su `[data-connect]` e sui
  pulsanti; due dita pizzicano usando `#zoomAt(clientX, clientY, factor)`; un
  tocco breve fa quello che fa un clic. Il palmo non fa niente (lo scarta già
  l'adattatore). Come `graph/interaction.ts` (righe 313–519).
- Con l'impostazione «Il dito sposta le schede» accesa (T19, D-10 (c)): un
  dito sopra una scheda la sposta come il mouse, e sul vuoto sposta la
  lavagna; il pizzico resta. La lavagna legge l'impostazione da
  `preferences.ts`; un cambio nelle Impostazioni vale dal tocco dopo, non a
  metà di un trascinamento.
Casi limite: dal pan al pizzico quando arriva il secondo dito; un dito che si
alza a metà pizzico (resta il pan); la penna che si posa mentre un dito
sposta (vince la penna, il dito si ferma); `pointercancel`; i limiti dello
zoom; sola lettura (il dito sposta, niente schede trascinate, anche con
l'impostazione accesa); l'impostazione cambiata a dito giù.
Fatto quando: `touch.test.ts` prova la camera del pizzico;
`engine-touch.test.ts` (happy-dom, dita finte) prova pan, pizzico, tocco
sulla testata e penna che vince, con l'impostazione spenta e accesa (accesa:
il dito sopra una scheda la sposta); `engine.test.ts` passa invariato.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T15 · La misura S8

Perché: il cancello chiede nessun fotogramma oltre 33 ms mentre si scrive
sopra un foglio grosso; i numeri si misurano, non si promettono. D-7 (c):
questa è la prima misura, sul caso simile; la seconda, sul foglio vero
dentro la lavagna, è T23, e solo quella chiude la voce.
Tocca: `apps/client/bench/webview/run.mjs`,
`apps/client/bench/webview/fixtures.mjs`,
`apps/client/bench/webview/budgets.json` (solo `targets`),
`docs/development/webview-measurements.md`,
`docs/misure/lavagna-inchiostro-AAAA-MM-GG.md` (nuovo, con la data del
giorno), `docs/misure/README.md`.
Non toccare: `.github/workflows/ci.yml`; il prodotto (un fotogramma lento si
dice nel rapporto, con dove va il tempo, non si corregge qui); gli scenari
S1–S7.
Dipende da: T14; N3 T15
Cosa fare:
- In `fixtures.mjs`, `S8/Lezione.canvas`: una scheda con una tabella
  Markdown di 100 per 100 celle (il foglio vivo che il passo 12b chiede non
  esiste ancora: vedi «Differenze»), una scheda `S8/voti.xlsx` fatta con
  `workbook()` (un foglio vero di 100 per 100 celle, lo stesso che userà
  T23), e 2000 tratti deterministici sulle schede, anche su quella del
  `.xlsx`, e sulla lavagna, scritti col piccolo codificatore della §5
  dentro `fixtures.mjs`.
- In `run.mjs`, S8 nella lista di default di `--only` (riga 36) e
  nell'ordine degli scenari (verso la riga 559): dieci tratti di penna da
  300 ms sopra la tabella; se `report.input.pen.count` è 0 (il driver non
  manda la penna), il mouse con D tenuto, e il rapporto lo dice. Poi lo
  spostamento della scheda coi suoi tratti (`S8.moveFrameGap.max`, senza
  tetto); il conto dei path asciutti; lo sha256 di `voti.xlsx` prima e dopo.
- In `budgets.json`, solo in `targets`: `S8.penFrameGap.max: 33`.
- Se lo scenario di N3 T15 ha già preso il nome S8, questo prende il primo
  nome libero, dappertutto (dati, chiavi, rapporto).
- Tre giri; il rapporto dà il peggiore e dice che Xvfb disegna in software,
  e che è il caso simile di D-7 (c): il foglio sotto la penna è una
  tabella di testo, non il foglio vivo.
- Lo scenario si scrive in modo che T23 lo rilanci uguale con l'anteprima
  vera (stessi dati, stesse chiavi): solo il contenuto della scheda
  `.xlsx` cambia.
Casi limite: il driver che non manda `pointerType` `pen`; Xvfb più lento di
una macchina vera (i numeri valgono come tetto, non come promessa); il
primo giro più lento (il WebAssembly si carica); la scheda xlsx che non si
apre in Xvfb (la misura va lo stesso, il rapporto lo dice).
Fatto quando: `docs/misure/lavagna-inchiostro-AAAA-MM-GG.md` riporta i tre
giri di S8 (fotogramma più lungo a penna, allo spostamento, path asciutti,
hash uguale o no), dice che è la prima delle due misure, e la pagina è
nell'indice di `docs/misure/README.md`. Un fotogramma oltre 33 ms qui non
blocca: si scrive con dove va il tempo, e l'orchestratore decide se serve
un task prima di T23.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && cd
../.. && cargo build --release --locked -p fub-app --features
tauri/custom-protocol && cd apps/client && xvfb-run -a npm run bench:webview
-- --only=S8 --budgets=targets --native-driver=/usr/bin/WebKitWebDriver
Stato: [ ] da fare

## T16 · L'interruttore e il cursore

Perché: col mouse si scrive anche senza tenere D, con un interruttore nella
barra della lavagna; chi scrive vede che la lavagna è in modo penna. D-11
(a): un pulsante con la scritta; D-4 (c): con l'impostazione accesa lo
stato si ricorda.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-ink.test.ts`,
`apps/client/src/i18n/catalog.ts`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/skin.css` e
`apps/client/theme/author/sample/skin.css` (derivati, con `npm run
theme:generate`), `apps/client/src/theme/scrittoio/structure.css`,
`docs/development/ink-input-smoke-test.md` (sezione «La lavagna»), e
`apps/client/src/theme/scrittoio/anatomia/editors.ts` solo se `npm run theme:verify`
lo chiede.
Non toccare: gli altri pulsanti della barra; i token del tema; le icone del
kit; la gomma (T13, T22); il dito (T14); il menu della penna (T21).
Dipende da: T13, T14, T19, T20, T22 (`engine.ts`, uno alla volta); il
prototipo approvato
Cosa fare:
- In `#drawToolbar`, dove lo mette il prototipo approvato (in testa alla
  barra, dopo il posto del menu della penna di T21), un pulsante
  `mk("ink-mouse", t("canvas.ink.mouse"), …)` con `aria-pressed`, `title` da
  `canvas.ink.mouse_hint` («Oppure tieni premuto D»), che chiama
  `setInkMouse`. Con l'impostazione «Ricorda se scrivi col mouse» spenta
  (di serie) riaprendo la lavagna torna spento; accesa, lo stato si salva
  nello stato di vista (`preferences.ts` di T19) e ogni lavagna del
  computer si apre così (D-4 (c), A18).
- `canvas.ink.mouse` e `canvas.ink.mouse_hint` in italiano e inglese.
- Lo stile del pulsante premuto come `skin/draw.css` (riga 46):
  `.canvas-toolbar > button[aria-pressed="true"]` con `--accent-wash` e
  `--accent`; il cursore `crosshair` su `.canvas-viewport[data-ink="pen"]`,
  come `.rich-ink-veil` (il cursore della gomma scelta dal menu è di T21).
- La sezione «La lavagna» della prova a mano: penna, gomma, D,
  interruttore, dito, annulla.
- Le foto dal banco (skill `banco`) nel rapporto, tema chiaro e scuro, col
  pulsante spento e acceso e un tratto sopra una scheda, accanto alle stesse
  viste di `PLAN-ui/lavagna-penne.html`.
Dal prototipo: l'interruttore «Scrivi col mouse» (posto, testo, stato
premuto), il blocco `→ skin/editors.css` del pulsante premuto, il cursore a
croce del blocco `→ structure.css`; lo stato «Scrivi col mouse acceso» e
«Sola lettura» della barra di stato della pagina.
Casi limite: sola lettura (pulsante disabilitato); pulsante acceso e D
tenuto insieme (D lasciato non lo spegne); il contrasto del pulsante premuto
nel tema scuro; la barra stretta; il pulsante raggiunto con la tastiera; il
lettore di schermo (nome e stato); l'impostazione accesa o spenta a
lavagna aperta (vale dalla prossima apertura, lo stato di adesso resta);
due lavagne aperte insieme con «ricorda» acceso.
Fatto quando: il pulsante accende e spegne la scrittura col mouse (test);
con «ricorda» spento riaprendo torna spento, acceso torna com'era (test);
`npm run theme:verify` passa; le foto chiaro e scuro sono nel rapporto e
somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npm run theme:verify &&
npx vitest run src/editors/canvas
Stato: [ ] da fare

## T17 · L'inchiostro sul nucleo finito di N3

Perché: N3 T18 toglie la copia TypeScript delle regole della lavagna
(`parseCanvas`, `canvasDraft`, `applyCanvasPatches`,
`inverseCanvasPatches`), e T11 aveva messo la toppa `ink` proprio lì
(`inkStep` in `operation.ts`). E il lettore dei livelli del client
(`readInkLayers`, `inkLayerWritable` in `ink-record.ts`) è una seconda copia
delle regole di `crates/fub-canvas-core/src/ink.rs` (`read_layers`). Dopo
questo task le regole dell'inchiostro stanno solo in Rust, e il client le
usa per `.wasm`, come tutte le altre della lavagna.
Tocca: `apps/client/src/editors/canvas/operation.ts` (restano i tipi e i
costruttori `addStrokePatch`, `eraseStrokePatch`, `eraseStrokePatches`),
`apps/client/src/editors/canvas/ink-record.ts`, `ink-record.test.ts`,
`ink-vectors.test.ts` (diventa `wasm/ink-vectors.test.ts`),
`apps/client/src/editors/canvas/wasm/core.ts`, `wasm/core.test.ts`,
`crates/fub-canvas-wasm/src/api.rs`, `src/abi.rs`, `tests/api.rs`,
`tests/abi.rs`, `docs/reference/canvas-operations.md` (sezione
«WebAssembly»), `docs/reference/canvas-ink.md` (sezione «I vettori»).
Non toccare: `crates/fub-canvas-core/src/ink.rs` salvo errori (si dice nel
rapporto); i vettori (`canvas-ink/`, `canvas-patches/ink-*.json`,
`canvas-ops/*ink*.json`); `engine.ts` (T12); il disegno (`ink-paint.ts`,
`ink-fit.ts`).
Dipende da: T11; N3 T13, T14, T18, T19, T20, T21, T22 (N3 fino a T22, fuso
in questo ramo dall'orchestratore)
Cosa fare:
- L'orchestratore fonde N3 (fino a T22) in un ramo di lavoro e lo dà al
  coder così com'è: nei conflitti di `operation.ts` vince la versione di
  N3 (la logica se ne va, `inkStep` con lei); restano i costruttori dei
  tratti. Il ramo di N4 riceve la fusione e T17 insieme, verdi.
- In `crates/fub-canvas-wasm`: `ink_layers(handle)` in `api.rs` e
  `canvas_ink_layers(h) -> i32` in `abi.rs`, che rispondono con i livelli
  di `read_layers` nella forma di `expect` dei vettori di `canvas-ink/`
  (`layer`, `state`, `strokes` con `id`, `drawn` e `reason`); un commento
  `SAFETY` come gli altri blocchi; la memoria come le altre chiamate.
- In `wasm/core.ts`: `inkLayers()` sulla lavagna aperta. La tela la chiede
  una volta per testo nuovo (dopo `open`, `reset`, `commit`), non a ogni
  disegno.
- `readInkLayers`, `readInkLayer` e `inkLayerWritable` se ne vanno; chi li
  usava (i costruttori dei tratti, `toDry`) prende lo stato dal nucleo. Il
  client tiene solo ciò che serve a disegnare: decodificare la stringa
  `ink` col codec della §5 e fare il contorno.
- `wasm/ink-vectors.test.ts`: i 28 vettori di `canvas-ink/` per `.wasm`; i
  vettori `canvas-patches/ink-*.json` e `canvas-ops/*ink*.json` passano già
  da `wasm/vectors.test.ts` di N3: il test ne controlla il numero, così uno
  che sparisce si vede.
- Le due pagine: la funzione nuova (JSON, chi libera la memoria) e che i
  vettori dell'inchiostro si leggono per `.wasm`.
Casi limite: un livello estraneo (il nucleo lo dice, il client non scrive);
un tratto che il nucleo dice da non disegnare; il nucleo che dice
«disegnabile» e il codec TypeScript che non sa decodificare (non si
disegna, e un test sui 28 vettori vieta che succeda); il `.wasm` che non si
carica (la tela mostra il testo come N3 T16, niente inchiostro); una
trappola a metà (si rifà l'istanza, come N3 T14); handle chiuso.
Fatto quando: `grep -rn "readInkLayers\|inkLayerWritable\|inkStep"
apps/client/src` non trova più definizioni; `wasm/ink-vectors.test.ts`
passa i 28 vettori per `.wasm`; `cargo test -p fub-canvas-wasm` prova
`ink_layers` per le due vie (api e abi) su tutti i vettori di `canvas-ink/`
e che dopo 10 000 giri la memoria viva torna quella del primo;
`npm run typecheck` è verde.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-wasm; cd
apps/client && npm run typecheck && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T18 · La misura della scheda e l'inchiostro

Perché: D-9 (c): su immagini e PDF l'inchiostro scala con la scheda senza
deformarsi; sulle altre resta fermo. Oggi si stira (`INK_ASPECT = "none"`
in `ink-paint.ts`, T4). È una regola della resa che un altro programma deve
poter rifare uguale: va nel riferimento, con vettori scritti a mano.
Tocca: `apps/client/src/editors/canvas/ink-fit.ts` (nuovo),
`ink-fit.test.ts` (nuovo), `apps/client/src/__fixtures__/canvas-ink-fit/`
(nuovo, un file per caso), `apps/client/src/editors/canvas/ink-paint.ts`,
`ink-paint.test.ts`, `docs/reference/canvas-ink.md` («L'ancora», «Come si
disegna»), `docs/decisions/0238-inchiostro-sulla-lavagna.md` (punto 3 e
conseguenze; resta «proposta»), `docs/architecture/ink-and-tools.md` (la
riga dell'asciutto che nomina `INK_ASPECT`).
Non toccare: `engine.ts` (lo collega T12); il formato e i vettori di
`canvas-ink/` (il file non cambia); `ink-record.ts`; `media-types.ts` (si
usa).
Dipende da: T4, T5 (fatti); D-9 (c), risposta del 2026-11-02. Parte subito.
Cosa fare:
- `ink-fit.ts`, puro: `inkFitMode(node)` dà `"scale"` per una scheda
  `file` il cui file è un'immagine o un PDF per `mediaKindOfId`
  (estensione in minuscolo, senza `subpath`), `"fixed"` per tutte le altre
  (A17); `inkFit(mode, ref, size)` dà fattore e spostamento: con `"scale"`
  `s = min(w/W, h/H)`, `x = (w − W·s)/2`, `y = (h − H·s)/2`; con `"fixed"`
  `s = 1`, `x = y = 0`.
- I vettori `canvas-ink-fit/*.json`: `name`, `description`, la scheda
  (`type`, `file`), `ref`, `size`, `expect` (`mode`, `s`, `x`, `y` e
  qualche punto prima e dopo). Almeno: immagine allargata, allungata, con
  le stesse proporzioni, rimpicciolita; PDF; `.PNG` maiuscolo; `.heic`;
  nota `.md`, foglio `.xlsx`, testo, gruppo, link, audio, video, file senza
  estensione; `ref` uguale a `size`.
- `paintCard(host, strokes, mode)`: con `"scale"` l'SVG annidato è largo e
  alto quanto la scheda, col `viewBox` della misura di riferimento e
  `preserveAspectRatio="xMidYMid meet"` (lo spessore scala con lui); con
  `"fixed"` è largo `W` e alto `H` nell'angolo in alto a sinistra, senza
  scala, e ciò che esce dalla scheda si vede. Spostare e ridimensionare
  continuano a non ridisegnare i percorsi. `INK_ASPECT` se ne va.
- Il riferimento: la regola con la formula, i due modi, chi è «immagine» e
  chi «PDF», e il rimando ai vettori; l'ADR: il punto 3 e la conseguenza
  sul ridimensionamento non uniforme.
Casi limite: una scheda di misura zero o non finita (niente `NaN`: `s = 0`
non si vede); ridimensionare a un'altra proporzione e tornare (l'inchiostro
torna uguale); un gruppo che contiene un'immagine (il gruppo è fermo,
l'immagine scala); un file rinominato da `.png` a `.md` (il modo cambia, il
file no); un tratto che esce dalla scheda; più misure di riferimento nella
stessa scheda (ognuna col suo SVG annidato).
Fatto quando: `ink-fit.test.ts` passa tutti i vettori di `canvas-ink-fit/`
e ne controlla il numero; `ink-paint.test.ts` prova gli attributi dei due
modi e che ridimensionare non riscrive i percorsi; `grep -rn INK_ASPECT
apps/client/src` non trova niente; le pagine dicono la regola nuova.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas; cd ../.. && node .github/scripts/check-doc-links.mjs
Stato: [x] fatto

## T19 · Le impostazioni della lavagna

Perché: D-4 (c) e D-10 (c): due interruttori nuovi, «Ricorda se scrivi col
mouse» e «Il dito sposta le schede», spenti di serie (A18). Oggi
`fub.lavagna` non ha impostazioni (`settings: None` in `inventory.rs`).
Tocca: `crates/fub-features/src/lavagna.rs` (le chiavi, `settings()`, le
stringhe in italiano e inglese, i test), `crates/fub-features/src/inventory.rs`
(`settings: Some(lavagna::settings)`),
`crates/fub-host/tests/lavagna_feature.rs` (nuovo, come
`draw_feature.rs`), `apps/client/src/editors/canvas/preferences.ts`
(nuovo), `preferences.test.ts` (nuovo), `settings-mirror.test.ts` (nuovo,
come `editors/spatial/draw-settings-mirror.test.ts`),
`docs/architecture/ink-and-tools.md` (la parte della lavagna),
`docs/map/dove-sta-x.md` (una riga).
Non toccare: `engine.ts` (le leggono T14 e T16); `panels/settings.ts` (le
righe le disegna da sé); `catalog.ts` del client (i testi delle
impostazioni sono della feature).
Dipende da: T20 (i nomi e le frasi sono quelli del prototipo approvato);
D-4 (c), D-10 (c), risposte del 2026-11-02
Cosa fare:
- In `lavagna.rs`: le costanti `canvas.ink_mouse_remember` e
  `canvas.finger_moves_card`; `settings()` con due `SettingKind::Toggle {
  default: false }`, `.for_machine()`, `.describing(…)` e
  `.grouped(…)` nel gruppo «Lavagna», come `draw.suggestions` in
  `draw.rs`; nomi e descrizioni del prototipo, in italiano e inglese.
- In `preferences.ts` del client: le due letture da `settings()` di
  `host/query`, seguite con `onEvent("setting_changed")` come
  `editors/spatial/preferences.ts`; l'ultima lettura resta qui e una
  lavagna nuova parte da lì. Lo stato ricordato di «Scrivi col mouse» nello
  stato di vista `canvas.ink_mouse` (`api.viewState`, `api.setViewState`),
  uno per computer. Ogni ascolto ha un proprietario e si chiude.
- I test: in Rust le due impostazioni, la macchina, spente, i testi nelle
  due lingue; in `fub-host` che con la feature accesa ci sono e si scrivono
  per la macchina, e spenta no; nel client lo specchio delle chiavi e le
  letture (anche il cambio da `setting_changed`).
- Le foto dal banco della sezione «Lavagna» di Impostazioni, chiaro e
  scuro, accanto alle righe del prototipo.
Dal prototipo: le due righe della sezione «Lavagna» (nomi, descrizioni,
interruttori spenti), lo stato «Impostazioni» della pagina; le disegna
`panels/settings.ts` come le altre, niente CSS nuovo.
Casi limite: la feature `lavagna` spenta (`--no-default-features`); un
valore non booleano scritto a mano nel file delle impostazioni (vale
spento); il cambio da un'altra finestra; lo stato di vista che manca o è
rotto (spento); l'interfaccia in inglese.
Fatto quando: `cargo test -p fub-features` e il test di `fub-host` passano;
`preferences.test.ts` e `settings-mirror.test.ts` passano; le foto della
sezione sono nel rapporto e somigliano al prototipo.
Prova: scripts/check.sh --rapido; cargo test -p fub-features; cargo test
-p fub-host --test lavagna_feature; cd apps/client && npx vitest run
src/editors/canvas
Stato: [~] in corso · coder · base fb1179a5

## T20 · Il prototipo delle penne

Perché: D-5 (b): il menu delle penne arriva dopo che l'utente ha visto il
prototipo e detto sì; le proposte A19–A23 valgono solo allora.
Tocca: `PLAN-ui/lavagna-penne.html` (la riga «Approvato» in testa e ciò che
l'utente chiede di cambiare), `PLAN.md` (la riga «Prototipo:», A19–A23 e la
tabella «Dal prototipo» se cambiano), `DECISIONS.md` (una riga).
Non toccare: il prodotto.
Dipende da: niente; parte subito (la prima versione c'è).
Cosa fare (lo fa l'orchestratore):
- Pubblica la pagina come Artifact e la mostra all'utente con le sette note
  «Da decidere guardando»; la barra di stato della pagina fa vedere ogni
  stato (menu chiuso, Penna, Evidenziatore, Gomma, colore libero, Scrivi col
  mouse acceso, sola lettura, Impostazioni), chiaro e scuro, piena e
  700 px.
- Ogni cambio chiesto va nella pagina, negli stessi blocchi `<style>` con la
  loro destinazione; poi si ripubblica e si rimostra.
- Al sì: la data nella testa della pagina («Approvato: AAAA-MM-GG») e nella
  riga «Prototipo:» del piano, e la riga in DECISIONS.md. Se una nota
  cambia, cambiano A19–A23 e, se tocca il lavoro, il pianificatore rivede
  T16, T19 e T21.
Casi limite: l'utente vuole un pezzo che chiede lavoro nuovo (un'icona nel
kit): si chiede al pianificatore; l'utente dice no a una proposta: la sua
assunzione cambia prima di T19.
Fatto quando: la riga «Approvato» ha la data nella pagina e nel piano.
Prova: grep -n "Approvato" PLAN-ui/lavagna-penne.html PLAN.md
Stato: [x] fatto (approvato il 2026-11-02, con lo spessore a cursore)

## T21 · Il menu delle penne

Perché: D-5 (b): penna, colore e spessore si scelgono sulla lavagna, e D-6
(b) chiede di scegliere che cosa cancella la gomma; il prototipo approvato
dice come.
Tocca: `apps/client/src/editors/canvas/pen-menu.ts` (nuovo),
`pen-menu.test.ts` (nuovo), `engine.ts` (`#drawToolbar`, lo strumento del
tratto), `engine-ink.test.ts`, `ink-record.ts` (`defaultInkLook` diventa il
look della scelta), `ink-layer.ts` e `ink-paint.ts` (l'opacità
dell'evidenziatore), `preferences.ts` (lo stato di vista `canvas.pen`),
`apps/client/src/i18n/catalog.ts` (`canvas.ink.*`),
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`, i derivati
`apps/client/src/theme/scrittoio/skin.css` e
`apps/client/theme/author/sample/skin.css` (con `npm run theme:generate`),
`docs/development/ink-input-smoke-test.md` (sezione «La lavagna»),
`docs/architecture/ink-and-tools.md` (la parte della lavagna).
Non toccare: `apps/client/src/ink/` (si importano `PENS`, `penBrush`,
`penLook`, `inkPath`, `INK_PALETTE`, `INK_WIDTHS`,
`INK_HIGHLIGHTER_WIDTHS`); `editors/spatial/` (si imita `pen-options.ts`);
`kit/color/` (si usa); i token del tema; il formato.
Dipende da: T16, T19, T20 (approvato), T22
Cosa fare:
- `pen-menu.ts`: il pulsante della penna (`canvas-ink-pen`, il colore e il
  nome, `aria-haspopup="dialog"`, `aria-label` come «Penna: Sfera, Blu,
  4 px») in testa alla barra, e il rialzo `kit-popover
  canvas-pen-popover` con le sezioni del prototipo: Strumento (Penna,
  Evidenziatore, Gomma), Tipo di penna (le sei di `PENS`, con l'anteprima
  disegnata da `inkPath` col pennello di `penBrush`, come `penPreview`),
  Colore (gli otto di `INK_PALETTE` e «Altro colore…» col selettore del
  kit), Spessore con un cursore (`input type="range"` col suo `<label>`,
  il valore in pixel in un `<output>` accanto, `aria-valuetext` «4 pixel»,
  e sotto l'anteprima del tratto vero su carta: la penna da 0,5 a 20 a
  passi di 0,5, l'evidenziatore da 4 a 48 a passi di 1; l'utente l'ha
  chiesto al posto dei tre pulsanti Sottile, Medio, Spesso, che restano
  nei disegni e nei documenti), «La gomma cancella» (Il tratto intero, Solo il
  pezzo, con `setInkEraser` di T22), la nota «Cambiare penna non cambia i
  tratti già scritti.». La tastiera come il prototipo: Invio o Spazio
  apre, le frecce si muovono, Esc chiude e rende il fuoco al pulsante.
- La scelta (A19) si legge e si scrive nello stato di vista `canvas.pen`;
  una scelta non valida o di una versione futura vale quella di serie,
  senza errore. Il tratto nuovo prende `tool`, `brush` (`penBrush(pen,
  px / zoom, pressione)`) e `color` dalla scelta. Prima della scelta, Sfera
  blu da 4 pixel (A11).
- L'evidenziatore (A22): opacità 0,5 senza `multiply`, nella scia e
  nell'asciutto; si salva `tool: "highlighter"`.
- Lo strumento Gomma (A21): il mouse (con D o con l'interruttore) e la
  penna cancellano col modo scelto; il cursore `cell` su
  `.canvas-viewport[data-ink="eraser"]`, come il prototipo. Il retro della
  penna cancella sempre.
- La barra si rifà a ogni disegno (`bar.replaceChildren()` in
  `#drawToolbar`): il pulsante della penna e l'interruttore restano gli
  stessi elementi fra un disegno e l'altro, così il rialzo aperto non si
  stacca e non si chiude da solo.
- Sola lettura: il pulsante è spento e il menu si chiude.
- Le foto dal banco nel rapporto: chiaro e scuro, piena e 700 px, menu
  chiuso e aperto su Penna, Evidenziatore e Gomma, accanto al prototipo.
Dal prototipo: il pulsante della penna (`canvas-ink-pen`,
`canvas-ink-pen-chip`, `canvas-ink-pen-name`) e il rialzo con le sue
classi (`canvas-pen-popover`, `canvas-pen-menu`, `canvas-pen-section`,
`canvas-pen-heading`, `canvas-pen-list`, `canvas-pen-item`,
`canvas-pen-preview`, `canvas-pen-swatches`, `canvas-pen-swatch`,
`canvas-pen-more`, `canvas-pen-note`, `canvas-pen-width-head`,
`canvas-pen-width`, `canvas-pen-width-value`, `canvas-pen-width-preview`),
i blocchi `→ structure.css` e
`→ skin/editors.css`, il cursore `cell`; gli stati Penna, Evidenziatore,
Gomma e «Colore libero».
Casi limite: il menu aperto quando arriva `syncDoc` o la sola lettura; una
scelta a metà tratto (vale dal tratto dopo); un colore libero (il pulsante
dice il codice); il nero sul tema scuro (A23); il lettore di schermo (nomi
e stato di ogni scelta); la barra stretta (il pulsante resta visibile); due
lavagne aperte (l'altra prende la scelta alla prossima apertura); lo stato
di vista rotto.
Fatto quando: `pen-menu.test.ts` prova apertura, tastiera, scelta e
chiusura; `engine-ink.test.ts` prova che un tratto prende penna, colore e
spessore scelti, che l'evidenziatore si salva col suo strumento e colore,
che la Gomma del menu cancella col modo scelto, che riaprendo la lavagna la
scelta torna e che una ridisegnata non chiude il menu; `npm run
theme:verify` passa; le foto somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npm run theme:generate
&& npm run theme:verify && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T22 · La gomma che taglia

Perché: D-6 (b): accanto alla gomma che toglie il tratto intero (T13), una
che taglia solo il pezzo strofinato; i pezzi restano come tratti nuovi e un
passaggio è un passo di annulla. Note e disegni lo fanno già con
`ink/tools/split.ts` (`editors/spatial/tools/erase-precise.ts`).
Tocca: `apps/client/src/editors/canvas/ink-erase.ts` (nuovo),
`ink-erase.test.ts` (nuovo), `engine.ts`, `engine-ink.test.ts`,
`ink-paint.ts` (il pezzo sbiadito durante la passata),
`docs/reference/canvas-ink.md` (sezione «Scrittura»: una riga sui pezzi),
`docs/architecture/ink-and-tools.md` (la parte della lavagna).
Non toccare: `ink/tools/split.ts` (si usa); `editors/spatial/` (si imita);
il nucleo e i vettori (le toppe sono quelle di T11: togli e aggiungi); la
barra (T21).
Dipende da: T14 (`engine.ts`, uno alla volta), T18, T20 (il pezzo che
sbiadisce è nel prototipo)
Cosa fare:
- `ink-erase.ts`, puro: per un tratto, il percorso della gomma portato in
  unità del tratto (con `ink-fit.ts`) e il raggio, `splitInk` e `cutBrush`
  danno i pezzi; ogni pezzo diventa un record coi campi del tratto di
  partenza (A20), un id nuovo (`newNodeId("s")`), `at` spostato all'inizio
  del pezzo se c'era, e la stringa `ink` del pezzo.
- Nella lavagna `setInkEraser(mode)`, `"stroke"` o `"piece"`, di serie
  `"stroke"`. Con `"piece"` la passata sbiadisce solo il pezzo strofinato;
  alla fine un commit: per ogni tratto toccato una `eraseStrokePatch` e
  una `addStrokePatch` per pezzo, i pezzi al posto del tratto e nel suo
  ordine. Un tratto coperto tutto se ne va senza pezzi.
- Un commit rifiutato dal nucleo (troppo grande: `canvas.ink.full`, o
  altro) non cambia niente: il tratto torna com'era e l'avviso lo dice.
Dal prototipo: il tratto d'esempio con «Solo il pezzo» (il pezzo
strofinato sbiadisce, i pezzi intorno restano).
Casi limite: la pressione (ogni pezzo tiene quella dei suoi campioni); una
passata che fa 1000 pezzi (un commit, un passo); più schede in una passata
(più livelli, un passo); un livello estraneo (non si taglia); un tratto non
disegnato (non si vede, non si taglia); il tratto di un'immagine
ridimensionata (taglia dove si vede); un pezzo di un campione solo; la
passata annullata (`onCancel`); il file che coi pezzi passerebbe i 16 MiB
(rifiuto, niente perso); campi sconosciuti nel tratto (passano ai pezzi).
Fatto quando: `ink-erase.test.ts` prova i pezzi (campi, id nuovi, `at`,
pressione) su tratti scritti a mano; `engine-ink.test.ts` prova che una
passata taglia ed è un passo, che l'annulla ridà il testo di prima byte per
byte, che 1000 pezzi sono un commit, che il rifiuto non cambia niente;
`engine.test.ts` passa invariato.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas src/ink
Stato: [ ] da fare

## T23 · La seconda misura sul foglio vero

Perché: D-7 (c): N4 si chiude solo con la misura sopra il foglio vero
dentro la lavagna; T15 ha misurato il caso simile.
Tocca: `apps/client/bench/webview/run.mjs`,
`apps/client/bench/webview/fixtures.mjs` (solo se lo scenario lo chiede),
`docs/misure/lavagna-inchiostro-foglio-AAAA-MM-GG.md` (nuovo, con la data
del giorno), `docs/misure/README.md`.
Non toccare: `.github/workflows/ci.yml`; `budgets.json` (la meta di 33 ms è
di T15); il prodotto (un fotogramma lento si scrive con dove va il tempo,
non si corregge qui); gli altri scenari.
Dipende da: T15, T21; in N6 la scheda di foglio viva dentro la lavagna
(N6 T7, T11, T12, T13: vedi «Un nodo con N6»)
Cosa fare:
- Sul ramo di N6 che contiene N4 e la scheda di foglio viva, lo scenario di
  T15 rilanciato com'è: aspetta che la scheda `voti.xlsx` sia viva
  (`[data-card-kind=sheet][data-card-mode=live]`, come N6 T20) prima della
  penna; dieci tratti sopra le celle, lo spostamento, lo sha256 del
  `.xlsx` prima e dopo.
- Tre giri; il rapporto dà il peggiore, dice il ramo e il commit, e mette
  il numero accanto a quello di T15.
- La pagina dice se la voce del cancello è chiusa (nessun fotogramma oltre
  33 ms) o no; se no, dove va il tempo, e l'orchestratore chiede al
  pianificatore un task prima di T25.
Casi limite: la scheda che non diventa viva in Xvfb (la misura non vale: si
dice, non si chiude); il driver senza penna (il mouse con D, come T15);
il primo giro più lento.
Fatto quando: la pagina in `docs/misure/` riporta i tre giri sopra il
foglio vivo e l'hash, ed è nell'indice; la riga del cancello «seconda
misura» ha la sua prova.
Prova: cd apps/client && npm run build && cd ../.. && cargo build
--release --locked -p fub-app --features tauri/custom-protocol && cd
apps/client && xvfb-run -a npm run bench:webview -- --only=S8
--budgets=targets --native-driver=/usr/bin/WebKitWebDriver
Stato: [ ] da fare

## T24 · Il posto dell'inchiostro dopo la prova con Obsidian

Perché: D-1 (c) e D-8 (a): l'utente fa la prova col kit di T7 e incolla
l'uscita di `confronta.mjs`; da lì si decide se l'inchiostro resta solo nel
`.canvas`. Oggi `docs/reference/canvas-ink.md` («Obsidian») dice già «A
più una copia B» se i livelli si perdono: è una scelta che D-1 (c) lascia
all'utente.
Tocca: `docs/decisions/0238-inchiostro-sulla-lavagna.md`,
`docs/reference/canvas-ink.md` (sezione «Obsidian»), `DECISIONS.md`;
`PLAN.md` solo se servono i task di D-12.
Non toccare: il codice; il kit di T7 (se l'uscita mostra un suo errore, è
un task a parte).
Dipende da: T7, T18 (tutti e due toccano `canvas-ink.md`); l'uscita della
prova incollata dall'utente
Cosa fare (lo fa l'orchestratore, o un coder con l'uscita in mano):
- Ogni livello intatto (le schede, anche quelle spostate e ridimensionate,
  la radice e i livelli estranei; uscita 0): l'ADR 0238 passa ad «accolta»,
  con la versione di Obsidian e la data della prova; la sezione «Obsidian»
  dice che cosa si è visto e toglie la frase sulla copia B; una riga in
  DECISIONS.md.
- Un livello `PERSO` o `CAMBIATO` su una scheda, sulla radice o su un
  livello estraneo: l'ADR resta «proposta», l'orchestratore fa all'utente
  la domanda D-12 con l'uscita, e il pianificatore scrive i task
  dell'opzione scelta. N4 non entra in `main` prima che siano fatti.
- Solo il `fub:ink` dell'arco cambia o sparisce: si scrive nella sezione
  (è un campo sconosciuto, Fub non ci scrive), il resto come il primo caso.
- L'uscita 2 (file non trovati o non validi): la prova si rifà.
Casi limite: un riordino delle chiavi o `640.0` al posto di `640` (non
contano: si confronta per valore); Obsidian che riscrive solo le schede
toccate; «PERSO, la scheda non c'è più» perché l'utente ha tolto una
scheda (non è inchiostro perso: si chiede); un'uscita incollata a metà (si
chiede di nuovo).
Fatto quando: l'ADR è «accolta» con la sezione «Obsidian» aggiornata,
oppure D-12 ha la risposta e i suoi task sono nel piano; la riga è in
DECISIONS.md.
Prova: node .github/scripts/check-doc-links.mjs; grep -n "Stato"
docs/decisions/0238-inchiostro-sulla-lavagna.md
Stato: [ ] da fare

## T25 · La CI completa e la revisione prima del merge

Perché: merge-n3n4 (b): N4 entra in `main` solo dopo N3, a task tutti fatti,
dopo la CI completa (che sulla PR in bozza non gira tutta) e una revisione
riga per riga.
Tocca: nessun file di prodotto in partenza; ciò che la CI o la revisione
trovano, nei file dei task che l'hanno scritto.
Non toccare: N3 e N6 (li segue il loro orchestratore); la storia del ramo
(niente force-push senza chiedere).
Dipende da: tutti i task, T23 e T24 compresi; N3 in `main` (N3 T23 fatto e
fuso)
Cosa fare (lo fa l'orchestratore):
- Dopo il merge di N3, porta la base della PR #298 da
  `piano/n3-logica-in-rust` a `main` (`gh api -X PATCH
  repos/Fubeo/Fub/pulls/298 -f base=main`, perché `gh pr edit` qui
  fallisce) e riallinea il ramo; se N3 T23 ha cambiato qualcosa dopo la
  fusione di T17, rifonde prima.
- Segna la PR pronta, così parte la CI completa: Linux, Windows, macOS, i
  banchi (visivo, `bench:webview`, `bench:ink`).
- Legge ogni job, anche i verdi con avvisi; un job rosso o un avviso nuovo
  diventa una correzione, con un coder se serve, e la CI riparte.
- La revisione riga per riga di tutto il diff di N4 contro `main`:
  perdita di dati (l'inchiostro e il `.xlsx` sotto), contratti (le pagine
  `canvas-ink.md` e `canvas-operations.md` e i loro vettori), test che
  provano la frontiera vera, testi per l'utente, gergo vietato, ascoltatori
  senza proprietario; corregge ciò che trova.
- Controlla che ogni riga del cancello abbia la sua prova verde.
- Chiede all'utente il merge, con il resoconto: che cosa c'è, che cosa
  cambia per lui, che cosa resta fuori, la CI e la revisione.
Casi limite: un job che fallisce per una ragione che non è di N4 (si scrive
e si chiede); un conflitto con `main` nel frattempo (si riallinea e la CI
riparte); un banco visivo che cambia per il menu nuovo (la base viene dal
runner, mai rifatta qui).
Fatto quando: la PR #298 ha base `main` e non è in bozza, tutti i controlli
della CI completa sono verdi, il resoconto della revisione è nel rapporto
con ogni punto corretto o motivato, ogni riga del cancello ha la sua prova,
e l'utente ha detto sì al merge.
Prova: gh pr checks 298; scripts/check.sh
Stato: [ ] da fare

## Non verificato stanotte

- Obsidian: non c'è su questa macchina; che cosa fa ai campi `fub:ink` lo
  dice solo la prova di D-8 col kit di T7.
- La latenza vera nella WebView e su un tablet: le prove di stanotte sono
  in happy-dom e in Node; S8 di T15 misura sotto Xvfb, in software.
- Se WebKitWebDriver manda `pointerType` `pen`: T15 ha il ripiego col mouse
  e D.
- Quanto costano `#render` e un commit con 2000 tratti sulla lavagna: lo
  dicono T10 (byte) e T15 (tempo).
- Le dimensioni vere dei file con molti tratti e la memoria delle toppe di
  spostamento: le stime sono nella «Prove fatte», la misura in T10.
- Che `source.rs` di N3 T5 accoppi per id gli array annidati: T10 lo prova
  e, se no, lo insegna.
- Il doppio tocco e il `dblclick` nelle WebView vere (la lavagna crea una
  scheda al doppio clic: un doppio tocco del dito non deve crearla per
  sbaglio).
- Quanto happy-dom è fedele per la penna e la cattura del puntatore.
- Il plugin che prende `fub-scene` da una revisione Git dopo che T6 ne
  sposta il codificatore.
- Il contrasto del blu `#0072b2` (il colore di default di D-5) sul tema
  scuro.
- Che, in WebKitGTK, `stopPropagation` nell'ascoltatore in cattura del
  viewport fermi anche l'ascoltatore a bolla dello stesso viewport quando la
  penna cade sul viewport vuoto: lo standard di oggi dice di sì, i motori
  più vecchi no. T4 lo prova in happy-dom; nella WebView vera lo vede la
  prova a mano di T16.
- L'invariante del nucleo l'ho letta su `piano/n3-logica-in-rust` @ 2acb9ae7;
  in questa copia non c'è ancora, come `docs/reference/canvas-format.md` e
  `docs/reference/canvas-operations.md`, che arrivano con N3 T1 e N3 T6.

Aggiunto il 2026-11-02, con le risposte:

- Che cosa fa Obsidian: l'utente non ha ancora incollato l'uscita della
  prova (T24); D-12 si fa solo se l'inchiostro si perde.
- La regola di A17 scala l'inchiostro sul riquadro intero della scheda.
  Quando N6 disegnerà immagini e PDF nella scheda (sotto la testata; il PDF
  adattato alla larghezza), il contenuto potrebbe non stare nello stesso
  riquadro: la regola si cambierà solo in `ink-fit.ts` e nei suoi vettori,
  senza toccare il file. Lo deve dire N6 (T5, T6, T19).
- Audio e video restano fermi come le note: la risposta a D-9 parla solo di
  immagini e PDF.
- Quanto si vede l'evidenziatore trasparente a metà senza `multiply` sulle
  schede chiare e scure: lo dice il prototipo (T20) e le foto di T21.
- L'accordo con N6 su T11 («Un nodo con N6»): senza, T23 non parte.
- I nomi `ink_layers` e `canvas_ink_layers` della facciata di N3: N3 T13 non
  è ancora fatto, i nomi seguono i suoi.
