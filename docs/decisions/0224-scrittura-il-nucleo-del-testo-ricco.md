# 0224 — Scrittura, il nucleo del testo ricco

- **Stato:** proposta
- **Data:** 2026-10-27
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

I documenti di Word si scrivono con ProseMirror (`editors/rich/`). Il testo
dei disegni si scriveva invece in un campo fatto a mano
(`editors/spatial/tools/text-field.ts`) su un `contenteditable` senza
modello: ogni battuta, la composizione (accenti, giapponese), la scelta e
l'incolla erano codice del disegno. Il carattere si sceglieva soltanto
nell'ispettore, e il correttore non c'era. Due editor di testo ricco, e
quello del disegno più povero.

Portare il disegno dentro lo schema del documento non serve: un testo SVG è
fatto di righe (`tspan`) e di pezzi coi loro attributi, e deve tornare
attributo per attributo com'era, compresi quelli che Fub non mostra.

## Decisione

1. **Un nucleo, `apps/client/src/scrittura/`.** Vi stanno i pezzi del testo
   ricco che non sono di un formato: i caratteri (`fonts.ts`), le marche del
   carattere (`marks.ts`), i comandi su quelle marche (`look.ts`) e la vista
   ProseMirror con un owner (`view.ts`). Il documento di Word compone il suo
   schema sopra queste marche (`editors/rich/schema.ts`, `commands.ts`).
2. **ProseMirror ha un confine.** Soltanto `src/scrittura/` e
   `src/editors/rich/` importano `prosemirror-*`;
   `.github/scripts/check-prosemirror-boundary.mjs` lo controlla in CI.
3. **Un profilo per il disegno.** `scrittura/profiles/lines.ts` è uno schema
   a righe: una riga è un paragrafo coi suoi attributi, gli attributi che
   Scrittura sa dire diventano marche coi nomi del nucleo, e il resto viaggia
   nella marca opaca `rest`, nell'ordine in cui era scritto. Il ponte sta nel
   nucleo e non nel disegno, perché il disegno non importa ProseMirror.
4. **Il campo del disegno scrive con Scrittura.** `profiles/line-writer.ts`
   monta la vista sul campo che il disegno ha già messo nella pagina. Il
   disegno tiene il modello (`rich.ts`) e decide che cosa fa una battuta; la
   vista tiene il DOM, la scelta, la composizione e i segni. Chiudere il
   campo resta una `TextOperation`, un passo di Annulla.
5. **Pezzo pigro.** Scrittura arriva al disegno con un import dinamico
   (`editors/spatial/tools/writing.ts`), dopo il montaggio, nel pezzo
   `scrittura` della build. Finché non arriva il campo non si scrive; se non
   arriva lo dice e il testo resta com'è.
6. **Il carattere e il correttore come nei documenti.** Mentre si scrive, la
   riga delle opzioni mostra il gruppo «Carattere» (scelta del carattere e
   campo numerico del kit, grassetto, corsivo, sottolineato, barrato). Il
   correttore è il client condiviso (`editors/core/proof.ts`), un segmento
   per riga, coi suggerimenti nel menu col tasto destro.

## Conseguenze

### Positive

- accenti, composizione, scelta e incolla del testo dei disegni sono quelli
  di ProseMirror, già provati nei documenti;
- un testo SVG torna attributo per attributo, anche con ciò che Fub non
  mostra;
- il disegno non porta ProseMirror all'apertura: il pezzo `scrittura` arriva
  dopo;
- chi scrive un testo nel disegno ha la barra del carattere e il correttore.

### Negative

- un campo di testo del disegno aperto subito dopo il montaggio aspetta il
  pezzo pigro, per poco;
- due schemi montano marche coi nomi del nucleo ma con DOM diversi: un
  comando di `look.ts` vale soltanto per lo schema del documento;
- i test che scrivevano nel campo cambiando `textContent` ora mandano un
  `beforeinput`, come il browser.

## Alternative scartate

### A. Il testo dei disegni nello schema del documento

Uno schema solo per tutti avrebbe perso gli attributi del `tspan` che il
documento non conosce, o li avrebbe portati dentro lo schema di Word.

### B. Tenere il campo fatto a mano e aggiungervi la barra del carattere

Restava un secondo editor di testo da tenere, con la composizione e la
scelta scritte a mano, e senza il correttore.

### C. ProseMirror nel pezzo del disegno

Il disegno sarebbe cresciuto di circa 200 KB all'apertura, anche per chi non
scrive.

## Verifica

- `apps/client/src/scrittura/profiles/lines.test.ts`: andata e ritorno di
  righe e pezzi, attributi sconosciuti intatti e nel loro ordine;
- `apps/client/src/editors/spatial/tools/text-field.test.ts` e
  `editor.test.ts`: scrittura, composizione, gruppo «Carattere» e
  correttore;
- `apps/client/src/editors/rich/`: i test del documento restano verdi;
- `node .github/scripts/check-prosemirror-boundary.mjs`;
- `npm run build`: il pezzo `scrittura` è separato da quelli del disegno.
