# Disegni, grafici

> **Per chi:** chi mette in un disegno un grafico a colonne, a torta o a
> linee, da una tabella di numeri.
> **Risultato:** sapere come si disegna un grafico, come si scrivono i suoi
> dati e il suo tipo, e che cosa ne resta nel file.

Solo il [Disegno completo](drawing.md) disegna i grafici, come VectorCraft
(`vendor/vectorcraft/crates/engine/src/cmd/graph/`). Gli strumenti stanno nel
riquadro delle forme composte della colonna, dopo i simboli.

## Gli strumenti

Nove strumenti, uno per tipo: a colonne, a colonne sovrapposte, a barre, a
barre sovrapposte, a linee, ad aree, a dispersione, a torta e radar.

- **Il trascinamento** disegna il grafico nel rettangolo, coi dati di serie
  (`Maiusc` lo tiene quadrato, `Alt` parte dal centro), poi apre i suoi dati.
- **Il clic** chiede la larghezza e l'altezza e disegna il grafico dal punto
  del clic, poi apre i suoi dati.

## I dati

La finestra «Dati del grafico» (menu Oggetto › Grafico › Dati, o dopo uno
strumento) è una tabella: la prima riga ha i nomi delle serie, la prima
colonna le categorie, le altre celle i numeri.

- **Un numero** si scrive col punto o con la virgola; una cella vuota è un
  valore che manca. Una cella che non è un numero ferma Applica e la finestra
  dice quale.
- **Righe e colonne** si aggiungono e si tolgono in fondo; ne resta sempre
  almeno una.
- **Scambia righe e colonne** e, per la dispersione, **Scambia x e y**
  partono subito, insieme ai dati scritti.
- **Applica** ridisegna il grafico e lascia la finestra aperta;
  **Ripristina** torna ai dati del grafico; **Chiudi** non cambia niente.

La finestra lavora sul grafico scelto quando si è aperta. I limiti sono del
motore: 256 serie e 10 000 categorie.

## Il tipo

La finestra «Tipo di grafico» parte dalle opzioni del grafico scelto: il
tipo, l'asse dei valori, la larghezza delle colonne e dei gruppi, la legenda,
l'ombra, l'ordine delle serie, i punti e le linee, le tacche dei due assi
(al più 100 divisioni e 20 tacche fra due), il prefisso e il suffisso dei
numeri.

Le finestre Colonna, Indicatore e Design del grafico ancora mancano.

## Nel file

Il grafico è un gruppo di oggetti disegnati: ogni lettore di SVG lo mostra.
I dati e le opzioni stanno nella sua ricetta (`vectorcraft:recipe` nei
metadati in testa al disegno, [il formato](../reference/scene-format-recipe.md)),
così un grafico riaperto si cambia ancora come grafico. Cambiare il gruppo
fuori dal Completo stacca la ricetta: il grafico resta disegnato, ma non si
ridisegna più dai dati.
