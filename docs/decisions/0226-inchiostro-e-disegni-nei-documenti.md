# 0226 — Inchiostro e disegni nei documenti

- **Stato:** proposta
- **Data:** 2026-10-27
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Nei documenti di Word e di OpenDocument non si scriveva a mano e non si
inseriva un disegno. L'inchiostro che Word salva (la scheda «Disegna») si
apriva come un oggetto opaco, mostrato soltanto col suo ripiego. FubDraw
sapeva già raccogliere tratti con pressione e disegnare con una penna
(`fub-ink`, `apps/client/src/ink/`), e sapeva fare un disegno intero.

Word tiene l'inchiostro come InkML in una parte `w14:contentPart`, dentro un
`mc:AlternateContent` con un'immagine di ripiego per chi non lo legge. Un
disegno vettoriale è un'immagine SVG (`asvg:svgBlip`) con un PNG accanto.
OpenDocument non ha inchiostro: ha cornici `draw:frame` con un'immagine e le
sue alternative.

## Decisione

1. **La proiezione passa alla versione 4.** Due specie d'oggetto nuove,
   `ink` (i tratti, `InkShape`) e `drawing` (l'SVG di FubDraw), e un posto
   `float` su ogni oggetto (`square`, `front`, `behind`, con `x` e `y` in
   punti dal paragrafo dell'ancora). Le versioni da 1 a 3 si leggono ancora;
   la forma è in [`rich-projection.md`](../reference/rich-projection.md).
2. **InkML in `fub-ink`.** `crates/fub-ink/src/inkml.rs` scrive e legge il
   sottoinsieme che Word usa (`traceFormat` X Y F T, pennello con colore,
   spessore, punta e trasparenza). `fub-format-rich` diventa un cliente
   ammesso del nucleo dell'inchiostro, accanto a `fub-scene` (ADR 0204).
3. **WordCraft scrive come Word.** La patch
   `vendor/wordcraft/patches/0004-inchiostro-e-svg.patch` aggiunge
   `wordcraft_docx::ink`: un inchiostro nuovo è InkML in `w14:contentPart`
   dentro `mc:AlternateContent` col suo PNG; un disegno è `asvg:svgBlip` col
   PNG. Un inchiostro letto dal file torna con i suoi tratti; uno che non si
   legge resta opaco col suo ripiego.
4. **OpenDocument riceve disegni.** Un `drawing` nuovo diventa una cornice in
   linea con l'SVG e il PNG. Un `ink` nuovo è rifiutato dal codec: la scheda
   «Disegna» di un documento OpenDocument consegna la sessione come
   `drawing`, l'SVG dei tratti.
5. **Il PNG di ripiego lo fa il client.** L'inchiostro con una tela a doppia
   densità (`editors/rich/ink.ts`), il disegno con `spatial/tools/png.ts`. Il
   provider non disegna.
6. **La scheda «Disegna».** Un velo sopra la pagina raccoglie i tratti con
   l'adattatore dell'inchiostro (penna, dito, mouse, palmo, pressione); i
   tratti di una sessione diventano un `ink` davanti al testo, ancorato al
   paragrafo più vicino, in un passo di Annulla. La gomma e il lazo lavorano
   sugli oggetti del documento; un oggetto cambiato perde il suo `k` e si
   riscrive. I colori sono un pozzo col selettore del kit, senza tavolozza a
   forme.
7. **Inserisci › Disegno.** Una tavola di 12 × 8 cm o la copia di un SVG del
   vault, in linea; la scheda «Oggetto» ne cambia la disposizione. Doppio clic
   o Invio aprono l'editor dei disegni sopra l'oggetto, in un pezzo caricato
   allora; «Fine» o Esc scrivono SVG e PNG nuovi in un passo di Annulla.
8. **Niente perso in silenzio.** Un inchiostro che non si legge è detto in
   «Che cosa manca?». Un disegno che cambia mentre è aperto, o che il
   documento non accetta lì, entra come disegno nuovo accanto, e lo si dice.

## Conseguenze

### Positive

- si scrive a mano in un documento, e Word lo apre come inchiostro;
- l'inchiostro salvato da Word torna modificabile;
- un disegno di FubDraw sta in un documento e si modifica sul posto.

### Negative

- un inchiostro nuovo chiede una scrittura e una lettura in più del
  documento, perché il codec assegna gli id del markup scrivendo
  (`settle_ink` in `unproject.rs`);
- in OpenDocument un disegno riletto è un'immagine, e l'inchiostro è un
  disegno: non torna inchiostro;
- la lettura di un inchiostro salvato davvero da Word non è ancora provata
  con un file di Word.

## Alternative scartate

### A. L'inchiostro come sola immagine

Più semplice, ma in Word non sarebbe più inchiostro: niente gomma, niente
riconoscimento, niente «Riproduci».

### B. I disegni come forme DrawingML

Avrebbe chiesto di tradurre la scena di FubDraw in un altro modello, e di
perdere ciò che DrawingML non dice.

### C. Il PNG dal provider

Il provider non ha un motore di resa, e il client sa già disegnare sia i
tratti sia la scena.

## Verifica

- `cargo test -p fub-ink` (InkML), `cargo test -p fub-format-rich` (proiezione
  v4, inchiostro e disegno nel docx e nell'odt);
- `node tools/vendor-craft/vendor.mjs wordcraft check` con la patch 0004;
- `apps/client/src/editors/rich/ink.test.ts`, `drawing.test.ts`,
  `fixture.test.ts`, `standing.test.ts`, `ribbon.test.ts`;
- `cargo test -p fub-abi --test dependency_invariant`.
