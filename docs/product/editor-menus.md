# Tasto destro, mini-barra e «/»

> **Per chi:** chi scrive e lavora negli editor di Fub e chi aggiunge un menu
> a una superficie.
> **Risultato:** sapere cosa offre il tasto destro in ogni editor, quando
> compare la mini-barra e come si usa il «/» nelle note.

## L'anatomia del menu

Il tasto destro, il tasto Menu o Maiusc+F10 aprono in ogni editor un menu con
le stesse sezioni, nello stesso ordine; una sezione vuota non c'è. In una nota
Markdown in scrittura sono:

1. ciò che sta sotto il puntatore: le correzioni del correttore, il link
   (apri, copia la destinazione, rimuovi il link), la casella di un'attività,
   il rientro di una voce di lista, il contenuto di un blocco di codice, le
   righe e colonne di una tabella in Sorgente, le proprietà, la nota a piè di
   pagina;
2. Taglia, Copia, Incolla, Incolla come testo semplice, «Copia come»
   (Markdown, HTML, testo semplice);
3. «Formato» e «Trasforma in»;
4. «Inserisci», con i blocchi del «/»;
5. «Comandi», con i comandi del vault dichiarati per il «/», e le voci dei
   plugin per la nota;
6. Copia link a questo punto, Cerca nel documento, Seleziona tutto. «Cerca
   nel documento» c'è dove l'editor ha la sua barra di ricerca: note,
   documenti di Word, codice; non su PDF, immagini, fogli e lavagne.

Il tasto destro fuori dalla selezione porta lì il cursore; dentro, la lascia.
Una voce che adesso non si può fare, come in sola lettura, è spenta. In
Lettura il menu copia il testo scelto o il Markdown della nota, esporta e offre
«Modifica da qui»; «Copia il link a questo punto» copia il punto cliccato.
Il tasto destro su un link in Live lascia il cursore dov'è, così la sintassi
del link resta nascosta. Aperto col mouse, il menu tiene il fuoco su di sé e
nessuna voce ha l'anello: la prima freccia sceglie la prima voce, o l'ultima
con la freccia su. Dal tasto Menu o da Maiusc+F10 il fuoco va subito alla
prima voce.

Dove Fub non ha un menu, il tasto destro non apre quello della WebView: resta
nei campi di testo, sul testo scelto, sul lettore audio e video e con
Maiusc+tasto destro, che dà sempre il menu del sistema.

## La mini-barra

Sopra il menu c'è la **mini-barra**: lo stile del paragrafo, le formattazioni
in riga e i link. Sulla selezione compare da sola quando la barra di
formattazione è spenta. L'impostazione «Mini-barra di formattazione»
(`editor.minibar`) sceglie fra `auto` (così), `always` (anche su ogni
selezione con la barra accesa), `menu` (solo col tasto destro) e `off`.

## Il «/» nel testo

Il **«/»** scritto a inizio riga o dopo uno spazio apre il menu dei blocchi:
Testo (paragrafo, titoli, citazione, riquadro), Elenchi, Inserisci (tabella,
separatore, codice, formula, diagramma, immagine, link a una nota, nota
incorporata, nota a piè di pagina) e i comandi del vault, con i recenti in
testa. Ciò che si scrive dopo il «/» filtra il menu, anche in inglese («/h2»,
«/todo»). Scegliere una voce toglie il «/…» e applica il blocco come una sola
modifica: un Annulla fa tornare il testo scritto. Escape chiude il menu e
lascia il testo. «e/o», «24/09» e gli indirizzi non lo aprono, né dentro
codice, link e formule. L'impostazione «Menu «/» nel testo» (`editor.slash`)
lo spegne. Con una selezione il «/» apre il menu dei comandi sulla selezione,
col suo campo. I blocchi sono dichiarati da `fub.formatting`: spento il
plugin, il «/» offre soltanto i comandi del vault.

## Gli altri editor

| Editor | Sotto il puntatore |
|---|---|
| Documenti di Word | link, revisione tracciata, tabella; la mini-barra di Word ([Documenti di Word](word-documents.md)) |
| Fogli di Excel | cella, intestazione di riga o di colonna, angolo, scheda del foglio, oggetto; la mini-barra di Excel |
| Tela (`.canvas`) | sulla carta: modifica, apri, colore, duplica, ordine, allinea e distribuisci, inquadra, elimina; sull'arco: colore, inverti, elimina; sul vuoto: aggiungi qui (testo, file, link, gruppo) nel punto cliccato, inquadra, zoom |
| Base (`.base`) | sulla riga o la scheda: apri la nota, copia il link `[[ ]]`, copia la riga; sulla cella: copia il valore, cerca questo valore, svuota la cella; sull'intestazione: raggruppa per la colonna, copia la colonna; in fondo la vista, la nota nuova e il CSV |
| Immagini | copia l'immagine, zoom, il link `![[ ]]`, apri con l'applicazione esterna, mostra nell'albero |
| PDF | copia e copia con la citazione `[[file.pdf#page=N]]` del testo scelto, copia il link alla pagina, annota, il link `![[ ]]`, apri esterno |
| Audio e video | sul lettore il menu del sistema; attorno, il link `![[ ]]` e apri esterno |

In modalità Blocchi la maniglia di un blocco apre il suo menu col clic e col
tasto destro: Trasforma in, Colore, Colonne, Duplica, Copia il link al blocco,
Sposta su e giù, e «Elimina il blocco» per ultimo.

Nell'albero, il tasto destro su una nota della scelta multipla apre il menu
della scelta: Copia, Sposta in…, In una cartella nuova, Deseleziona e «Sposta
nel cestino» per ultimo. Fuori dalla scelta vale il menu della nota.

Il disegno ha i suoi menu ([Disegni, selezione](drawing-selection.md)); la
griglia delle tabelle in Live ha il suo
([Editor e anteprima](editor-and-preview.md#tabelle-in-live)).

## Dove si trova

- `apps/client/src/editors/core/editor-menu.ts`: le forme del menu di una
  superficie;
- `apps/client/src/panels/editor-menu.ts`: il compositore e l'apertura;
- `apps/client/src/ui/menu.ts`: il menu, il fuoco e la tastiera;
- `apps/client/src/ui/system-menu.ts`: il menu della WebView spento dove Fub
  non ne ha uno;
- `apps/client/src/panels/mini-bar.ts`: la mini-barra;
- `apps/client/src/panels/slash-menu.ts` e
  `apps/client/src/editors/text/profiles/markdown/slash.ts`: il «/» nel testo;
- `crates/fub-features/src/formatting.rs`: le voci di blocco del «/»;
- [Superfici dell'editor](../architecture/editor-surfaces.md): le capacità
  `contextMenu` e `miniBar`.
