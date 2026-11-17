# 0239 — Il disegno passa dal motore vettoriale, e il file lo scrive il client

- **Stato:** accolta
- **Data:** 2026-11-02
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Gli strumenti del disegno (Selezione, Rettangolo, Ellisse, Linea, Freccia, i
colori e lo spessore) sono scritti a mano in TypeScript, in
`apps/client/src/editors/spatial/tools/`. Bastano per i dieci strumenti che
la [0231](0231-la-chiusura-di-fubdraw.md) tiene, ma non crescono fino al
disegno completo, con decine di strumenti e centinaia di comandi: riscriverli
uno per uno vorrebbe dire rifare un programma di grafica dentro Fub, la
strada che la 0231 ha chiuso.

VectorCraft fa già quel lavoro. Usato a sottoinsiemi, un motore solo dà gli
stessi strumenti al disegno, al disegno completo e alla lavagna. Il rischio è
la perdita: un motore che importa un SVG e lo riscrive cambia anche ciò che
la persona non ha toccato, e i disegni di Fub hanno attributi `fub:*`,
inchiostro e strutture che il motore non conosce. La scelta di chi scrive il
file, e di chi possiede l'inchiostro, è costosa da invertire: per questo sta
qui e non solo nel codice.

## Decisione

1. **Il motore gira nell'host, in Rust nativo.** Lo tiene lo strato dei
   motori (`crates/fub-motori`, della 0236), e il solo crate che nomina
   `vectorcraft-*` è l'adattatore `crates/fub-disegno`; la guardia
   `check-engine-boundary.mjs` lo fa rispettare. Il client non carica
   VectorCraft e parla con il motore per IPC, come per i fogli
   ([0219](0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md)).
   Il motore si costruisce al primo disegno aperto, non all'avvio.
2. **Il file lo scrive il client.** Il motore tiene una copia del disegno, ci
   fa girare i suoi strumenti e restituisce la differenza come operazioni di
   scena di Fub ([le operazioni sulla scena](../reference/scene-operations.md),
   le stesse che `parseWireOp` accetta). Il client le applica con
   `ctx.commit`, in un solo passo di annullamento, e la `DocumentSession` le
   porta al file. Ciò che il gesto non tocca resta byte per byte com'era. La
   cronologia del motore non si usa.
3. **La penna resta di Fub.** Penna, evidenziatore e gomma scrivono `fub:ink`
   dal client ([0204](0204-nucleo-inchiostro.md)); il motore non riceve i
   tratti. I campioni della pipeline della penna
   (`ink/dom/pointer-adapter.ts`, stabilizzati e senza il palmo) diventano
   gli eventi Down, Drag e Up degli strumenti del motore, in coordinate di
   scena e con lo zoom per le tolleranze.
4. **Gli elementi senza id si mappano con id sintetici.** Nella sola copia
   d'import un elemento senza id riceve `fubtmp-<n>`, che non arriva mai nel
   file. Un elemento senza id che un gesto modifica riceve un id vero con
   `ident` nello stesso lotto. Gli id nuovi hanno il formato di
   `apps/client/src/editors/spatial/scene/ids.ts`: il motore non scrive mai
   id suoi.
5. **La copia segue il file rileggendolo.** Dopo ogni modifica del documento
   il client la manda al motore, che reimporta il testo intero in sottofondo;
   un gesto che arriva prima aspetta la revisione giusta, e uno a una
   revisione diversa è rifiutato come vecchio. Un reimport più fine si fa solo
   se la misura del cancello lo chiede.
6. **Il motore è un componente con il suo interruttore.** Si chiama
   `fub.motore-vettoriale`, «Motore del disegno», ed è una riga sua nel
   gruppo «Disegnare» della pagina Componenti
   ([0234](0234-il-modello-dei-componenti.md)), accesa di serie. `fub.draw`
   lo usa senza richiederlo: spento il motore, i disegni restano accesi con
   gli strumenti semplici (punto 9). Nell'interfaccia non compare mai il nome
   VectorCraft.
7. **Il motore guida gli strumenti del profilo «vector»**, nei due spazi di
   lavoro: Semplice e Completo hanno gli stessi strumenti e cambiano solo
   l'aspetto. Il profilo `pdf` tiene i suoi strumenti TypeScript (0231 §3);
   i campi dell'ispettore e i comandi dei menu restano del client.
8. **Sei comandi IPC tipati**: `open_drawing`, `drawing_sync`,
   `drawing_gesture`, `drawing_commands`, `drawing_command` e
   `close_drawing`, con le forme in `crates/fub-abi/src/drawing.rs` e i
   limiti validati a ogni richiesta. I comandi del motore esposti sono solo
   colore del tratto, colore del riempimento e spessore.
9. **Due strade.** Con il motore spento, o fermo per un errore, il disegno
   usa gli strumenti semplici, quelli TypeScript del client, e un chip della
   superficie lo dice: «Accendi…» con il motore spento, «Riprova» con il
   motore fermo. I vettori dei gesti sono l'oracolo di tutte e due le strade,
   e l'inventario degli strumenti della 0231 §5 non cambia.

## Conseguenze

### Positive

- il client resta l'unico scrittore della scena: annulla, bozze, conflitti e
  salvataggio restano quelli della `DocumentSession`;
- un gesto cambia solo gli attributi degli elementi che tocca, e la prova
  «senza perdite» si fa per elemento, non sul file intero;
- l'inchiostro, la sua latenza e `bench:ink` non dipendono dal motore;
- il disegno completo e la lavagna useranno lo stesso motore, con più
  strumenti, senza cambiare chi scrive il file.

### Negative

- ciò che non si scrive come attributi dell'elemento originale non si fa: il
  gesto è rifiutato invece di riscrivere l'elemento;
- ciò che il motore non sa modificare resta com'è e lo si dice all'apertura e
  al gesto, non al salvataggio, perché Fub salva da sé;
- la copia nel motore occupa memoria nell'host per ogni disegno aperto, e a
  ogni modifica si reimporta intera, finché la misura non dice che serve altro;
- convivono due strade per gli stessi strumenti, da mantenere e da provare
  tutte e due;
- `usvg` entra in due versioni, quella di Fub e quella del motore, e il tetto
  `librerie_doppie` si alza una volta sola, con l'elenco motivato.

## Alternative scartate

### Il motore in WebAssembly nel client

Plausibile, perché tiene il gesto vicino al puntatore. Scartata: i motori
vivono nell'host (0236), con la loro custodia e i loro limiti di memoria, e
un motore nel client peserebbe sul caricamento della superficie e
raddoppierebbe la sua integrazione per la lavagna.

### Il motore che riscrive l'SVG a ogni gesto

Plausibile, perché è la strada più corta. Scartata: ogni gesto riscriverebbe
anche ciò che non tocca, e il cancello senza perdite diventerebbe una
scommessa su ogni file.

### Senza motore, gli strumenti del motore spenti

Plausibile, perché una cosa sola si comporta in un modo solo: con il motore
spento Selezione, forme e Testo si sarebbero disattivati, con «Accendi…».
Scartata dall'utente: un disegno si deve poter modificare anche senza motore,
con meno memoria e meno codice in esecuzione.

### Il ripiego in silenzio

Plausibile, perché non chiede niente alla persona. Scartata: gli strumenti
semplici restano, ma la superficie dice quando li sta usando e perché.

### La penna nel motore subito

Plausibile, perché il disegno completo la vorrà. Scartata: il nucleo
dell'inchiostro è di Fub (0204), il cancello chiede `bench:ink` e la latenza
della penna invariati, e l'inclinazione della penna nel motore non c'è.

## Le scelte dell'utente (2026-11-02)

Le risposte a D-1…D-13 sono del 2026-11-02, quella a D-14 del 2026-11-03.

- **D-1, la copia di VectorCraft:** dal mirror `Fubeo/vectorcraft`.
- **D-2, le librerie comuni di Craft:** in `vendor/` soltanto `docpath` e
  `vectorcraft-format`; il PDF del motore resta dietro una feature spenta.
- **D-3, dipendenze e licenze nuove:** le versioni in comune si allineano
  dove si può e il tetto `librerie_doppie` si alza una volta sola, con
  l'elenco motivato in `docs/misure/`; `usvg` resta doppio.
- **D-4, i sei comandi IPC:** sì, con le righe dei permessi (punto 8).
- **D-5, i caratteri del motore:** quelli di Fub, dallo strato dei motori.
- **D-6, chi scrive il file:** il client (punto 2).
- **D-7, lo strumento Testo:** torna in barra (cambia la 0231 §2 per il solo
  Testo); un clic crea «Testo», lo seleziona e apre il campo dell'ispettore.
- **D-8, senza motore:** gli strumenti semplici, detti dal chip (punto 9).
- **D-9, aspetto e parole:** le frasi proposte, guardate al banco; quelle del
  motore spento e fermo si scelgono sul prototipo del piano.
- **D-10, l'interruttore Semplice · Completo nella barra del file:** arriva
  con il disegno completo; fino ad allora resta nel menu ≡.
- **D-11, la lavagna che dice che cosa manca:** arriva con la lavagna sul
  motore; il disegno lo dice già.
- **D-12, l'inclinazione della penna nel motore:** a monte, dopo il piano.
- **D-13, il motore nello spazio Completo:** in tutti e due (punto 7).
- **D-14, l'interruttore del motore:** una riga sua, accesa (punto 6).

## Verifica

- `crates/fub-disegno/tests/` e i vettori dei gesti in
  `apps/client/src/__fixtures__/disegno-gesti/`: il motore fa ciò che fanno
  gli strumenti TypeScript, con le differenze ammesse scritte;
- `crates/fub-disegno/tests/corpus.rs` e `tests/corpus/perdite.tsv`: ciò che
  il motore non sa modificare è elencato per file;
- `node tools/disegno-cancello/cancello.mjs`: il corpus si apre, si modifica e
  si salva senza perdite visibili, al confronto a pixel;
- un test dei gesti nel client: penna, evidenziatore e gomma senza l'IPC;
- `check-engine-boundary.mjs` e `dependency_invariant.rs`: solo
  `fub-disegno` nomina `vectorcraft-*`.

La pagina di architettura è [Il disegno sul motore](../architecture/disegno.md).
