# 0239 — Il disegno passa dal motore vettoriale, e il file lo scrive il client

- **Stato:** proposta
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
6. **Il motore è un componente.** Si chiama `fub.motore-vettoriale`,
   «Motore del disegno», è un motore di supporto, e `fub.draw` lo richiede,
   come `fub.rich` richiede `fub.motore-documenti`
   ([0234](0234-il-modello-dei-componenti.md)). Nell'interfaccia non compare
   mai il nome VectorCraft.
7. **Il motore guida gli strumenti del profilo «vector»**, nei due spazi di
   lavoro: Semplice e Completo hanno gli stessi strumenti e cambiano solo
   l'aspetto. Il profilo `pdf` tiene i suoi strumenti TypeScript (0231 §3);
   i campi dell'ispettore e i comandi dei menu restano del client.
8. **Sei comandi IPC tipati**: `open_drawing`, `drawing_sync`,
   `drawing_gesture`, `drawing_commands`, `drawing_command` e
   `close_drawing`, con le forme in `crates/fub-abi/src/drawing.rs` e i
   limiti validati a ogni richiesta. I comandi del motore esposti sono solo
   colore del tratto, colore del riempimento e spessore.
9. **Il ripiego ha una fine.** Finché il cancello non passa, senza motore gli
   strumenti del disegno sono quelli TypeScript. Dopo il cancello vale D-8:
   con la raccomandazione, gli strumenti del motore si spengono e la
   superficie dice che cosa manca.

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
- a ogni modifica il motore reimporta il disegno intero, finché la misura non
  dice che serve altro;
- la copia nel motore occupa memoria nell'host per ogni disegno aperto;
- fino al cancello convivono due strade per gli stessi strumenti.

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

### La penna nel motore subito

Plausibile, perché il disegno completo la vorrà. Scartata: il nucleo
dell'inchiostro è di Fub (0204), il cancello chiede `bench:ink` e la latenza
della penna invariati, e l'inclinazione della penna nel motore non c'è.

## Da decidere

Ogni domanda con la raccomandazione per prima; il lavoro procede con quella.

- **D-1, la copia di VectorCraft:** da un mirror `Fubeo/vectorcraft`, come
  WordCraft e GridCraft (consigliata), o da `storytold/vectorcraft` a una
  revisione fissata.
- **D-2, le librerie comuni di Craft:** in `vendor/craft-libs/` solo
  `docpath` e `vectorcraft-format`, con il PDF del motore dietro una feature
  spenta (consigliata); anche `craft-pdf`; o dipendenze Git.
- **D-3, dipendenze e licenze nuove:** allineare verso l'alto le versioni in
  comune e alzare una volta il tetto `librerie_doppie`, con l'elenco motivato
  in `docs/misure/` (consigliata); patch che abbassano VectorCraft; o niente
  motore.
- **D-4, i sei comandi IPC** e le loro righe in `permissions/default.toml`:
  sì, nella forma dei fogli (consigliata).
- **D-5, i caratteri del motore:** quelli di Fub, da un servizio dello strato
  dei motori, subito (consigliata); la riga di componente `caratteri` arriva
  con chi ne ha bisogno da solo.
- **D-6, chi scrive il file:** il client, con le operazioni di scena del
  motore (consigliata, punto 2); o il motore che riscrive l'SVG.
- **D-7, lo strumento Testo:** torna in barra, e un clic crea un testo
  «Testo» con il cursore nel campo dell'ispettore (consigliata); o resta
  fuori. Con il sì questa decisione cambia la 0231 §2 per il solo Testo.
- **D-8, senza motore:** dopo il cancello gli strumenti del motore si
  spengono con «Serve il Motore del disegno» e «Accendi…» (consigliata); o
  il ripiego TypeScript resta per sempre, in silenzio.
- **D-9, aspetto e parole:** i testi proposti nel piano, guardati al banco
  (consigliata).
- **D-10, l'interruttore Semplice · Completo nella barra del file:** con il
  disegno completo; fino ad allora resta nel menu ≡ (consigliata).
- **D-11, la lavagna che dice che cosa manca:** con la lavagna sul motore; il
  disegno lo dice già (consigliata).
- **D-12, l'inclinazione della penna nel motore:** proposta a monte quando la
  penna entra nel motore (consigliata).
- **D-13, il motore nello spazio Completo:** in tutti e due gli spazi
  (consigliata, punto 7); o solo nel Semplice.

## Verifica

- `crates/fub-disegno/tests/` e i vettori dei gesti in
  `apps/client/src/__fixtures__/disegno-gesti/`: il motore fa ciò che fanno
  gli strumenti TypeScript, con le differenze ammesse scritte;
- `crates/fub-disegno/tests/corpus.rs` e `tests/corpus/perdite.tsv`: ciò che
  il motore non sa modificare è elencato per file;
- `node tools/disegno-cancello/cancello.mjs`: il corpus si apre, si modifica e
  si salva senza perdite visibili, al confronto a pixel;
- un test dei gesti nel client: penna, evidenziatore e gomma non chiamano
  l'IPC del disegno;
- `check-engine-boundary.mjs` e `dependency_invariant.rs`: solo
  `fub-disegno` nomina `vectorcraft-*`.

La pagina di architettura è [Il disegno sul motore](../architecture/disegno.md).
