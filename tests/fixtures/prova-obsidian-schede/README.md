# La prova con Obsidian delle schede vive

Questa cartella è un vault di prova: si apre in Obsidian per vedere che cosa
Obsidian fa di ogni specie di scheda viva di Fub
([Le schede vive nella nota](../../../docs/product/live-cards.md)). L'esito si
scrive in quella pagina, alla sezione «In Obsidian».

> **Per chi:** chi ha Obsidian sul suo computer.
> **Quanto:** pochi minuti.
> **Risultato:** per ogni specie, se Obsidian la incorpora nella nota, la
> lascia come link o mostra un errore.

## I passi

1. **Copia la cartella** fuori dal repository, dalla radice del repository:

   ```bash
   cp -r tests/fixtures/prova-obsidian-schede ~/prova-obsidian-schede
   ```

2. **Aprila come vault** in Obsidian (in inglese *Open folder as vault*). Non
   usare il tuo vault vero, né quello di Fub.
3. **Apri la nota `Schede vive`** in *Reading view* (la lettura), poi in *Live
   Preview* (la modifica). Per ognuno dei sedici paragrafi annota che cosa si
   vede, con la tabella qui sotto.
4. **Scrivi la versione** di Obsidian (in inglese *Settings* → *General*).

Alla fine puoi cancellare la copia.

## Che cosa guardare

Per ogni riga, una di tre risposte: **dentro** (il contenuto si vede nella
nota), **link** (solo il nome del file, che si clicca) o **errore** (un
riquadro che dice che il file non c'è o non si può mostrare).

| N. | Specie | L'embed | Che cosa guardare |
|---:|---|---|---|
| 1 | PDF | `![[Contratto.pdf]]` | si vede la pagina, con le sue barre? |
| 2 | PDF a una pagina | `![[Contratto.pdf#page=1]]` | apre alla pagina 1? |
| 3 | Passo di PDF | `![[Contratto.pdf#page=1&selection=0,0,0,12]]` | il passo è evidenziato? |
| 4 | Foglio | `![[Conti.xlsx]]` | dentro o link? |
| 5 | Intervallo | `![[Conti.xlsx#Foglio1!A1:B3]]` | dentro o link? |
| 6 | Valore di cella | `![[Conti.xlsx#Foglio1!A3]]` in una frase | il numero 11, o un link? |
| 7 | Documento ODT | `![[Verbale.odt]]` | dentro o link? |
| 8 | Documento Word | `![[Relazione.docx]]` | dentro o link? |
| 9 | Disegno di Fub | `![[Ciclo dell acqua.svg]]` | si vede il disegno come un'immagine? |
| 10 | SVG di un altro programma | `![[Mappa del quartiere.svg]]` | si vede come un'immagine? |
| 11 | Lavagna | `![[Percorso della visita.canvas]]` | si vede la lavagna, con le schede e i fili? |
| 12 | File Craft | `![[Logo.vectorcraft]]` | link o errore? |
| 13 | Formato senza vista | `![[Foto.zip]]` | link o errore? |
| 14 | File mancante | `![[Contratto vecchio.pdf]]` | che cosa dice? |
| 15 | Misura | `![[Conti.xlsx\|640x300]]` | la misura cambia qualcosa? |
| 16 | Colonne | `> [!columns]` con due `> > [!column]` | due colonne, o due riquadri uno sotto l'altro? |

## Da dove viene ogni file

| File | Da dove viene |
|---|---|
| `Allegati/Contratto.pdf` | copia di `tests/fixtures/prealpha-corpus/PDF/Scena.pdf` (una pagina, col testo) |
| `Allegati/Conti.xlsx` | copia di `tests/fixtures/prealpha-corpus/Fogli/Conti con formule.xlsx` (il foglio `Foglio1`, A1:B3) |
| `Allegati/Verbale.odt` | copia di `crates/fub-format-rich/tests/corpus/odt/semplice.odt` |
| `Allegati/Relazione.docx` | copia di `crates/fub-format-rich/tests/corpus/docx/senza-perdite.docx` |
| `Allegati/Ciclo dell acqua.svg` | copia di `crates/fub-format-svg/tests/fixtures/drawing.svg`, un disegno di Fub |
| `Allegati/Mappa del quartiere.svg` | copia di `crates/fub-format-svg/tests/fixtures/foreign-crlf-bom.svg`, un SVG di Inkscape |
| `Allegati/Percorso della visita.canvas` | scritto a mano: tre schede di testo, due fili e il foglio |
| `Allegati/Logo.vectorcraft` | il segnaposto del banco (`apps/client/bench/craft-fixture.ts`): conta solo l'estensione |
| `Allegati/Foto.zip` | un archivio con un file di testo: conta solo l'estensione |

Il file `Contratto vecchio.pdf` manca apposta. Le licenze sono quelle dei
corpus d'origine: `MIT OR Apache-2.0`, come Fub. Il test
`apps/client/bench/prova-obsidian.test.ts` controlla che la nota abbia ogni
specie di `noteCardKindOf` e che ogni file nominato ci sia, tranne quello che
manca apposta.
