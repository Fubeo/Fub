# La prova con Obsidian

Questa cartella serve a scoprire che cosa fa Obsidian ai campi `fub:ink` di
una lavagna quando la riscrive: li tiene, li riordina o li perde. Fub mette
l'inchiostro dentro il file `.canvas`
([L'inchiostro della lavagna](../../docs/reference/canvas-ink.md)), e Obsidian
quei campi non li conosce.

> **Per chi:** chi ha Obsidian sul suo computer.
> **Quanto:** pochi minuti.
> **Risultato:** un testo da incollare nella risposta alla domanda D-8 del
> piano N4.

## Che cosa c'è

| File | Che cosa è |
|---|---|
| `lavagna-di-prova.canvas` | una lavagna con l'inchiostro su una scheda di testo, una scheda file, un gruppo e la radice, più un livello che Fub non conosce (`v: 2`), dei campi sconosciuti dentro un tratto e un `fub:ink` su un arco |
| `confronta.mjs` | lo script che confronta la lavagna prima e dopo Obsidian |
| `confronta.test.mjs` | le prove dello script |

Serve soltanto Node.js 22, lo stesso di Fub. Lo script non installa niente.

## I passi

1. **Crea un vault di prova vuoto** in Obsidian (in inglese *Open another vault* →
   *Create new vault*), per esempio in `~/prova-obsidian-vault`. Non usare
   il tuo vault vero, né quello di Fub.
2. **Copia la lavagna** nel vault di prova, dalla radice del repository:

   ```bash
   cp tools/prova-obsidian/lavagna-di-prova.canvas ~/prova-obsidian-vault/
   ```

3. **Aprila in Obsidian.** La scheda file punta a `Corsi/Statistica/voti.xlsx`,
   che nel vault di prova non c'è: è normale che Obsidian dica che non trova il
   file.
4. **Sposta** la scheda «Spostami» trascinandola.
5. **Ridimensiona** la scheda «Ridimensionami» tirandone un angolo.
6. **Salva**: Obsidian salva da solo dopo un attimo. Per esserne sicuro, chiudi
   la lavagna.
7. **Lancia lo script** dalla radice del repository, col file originale prima
   e quello del vault dopo:

   ```bash
   node tools/prova-obsidian/confronta.mjs tools/prova-obsidian/lavagna-di-prova.canvas ~/prova-obsidian-vault/lavagna-di-prova.canvas
   ```

8. **Incolla l'uscita** dello script, intera, nella risposta a D-8, con la
   versione di Obsidian (in inglese *Settings* → *General*).

Alla fine puoi cancellare il vault di prova.

## Come si legge l'uscita

Una riga per livello: le schede per id, poi la radice, poi l'arco.

- **c'è, uguale per valore:** il livello è rimasto com'era. «Chiavi in un altro
  ordine» vuol dire che Obsidian ha riscritto il JSON con un altro ordine: per
  Fub va bene, come `640.0` al posto di `640`.
- **CAMBIATO:** il livello c'è ma è diverso; sotto, una riga per ogni
  differenza, con il percorso del campo.
- **PERSO:** il campo `fub:ink` non c'è più, o non c'è più la scheda.
- **spostata, ridimensionata:** la scheda si è mossa; serve a vedere se
  Obsidian tocca l'inchiostro solo delle schede che sposta.

Lo script esce con 0 se ogni livello c'è ed è uguale per valore, con 1 se no,
con 2 se un file non si legge.

## Le prove dello script

Non stanno nella CI: si lanciano a mano, dalla radice del repository.

```bash
node --test tools/prova-obsidian/confronta.test.mjs
```
