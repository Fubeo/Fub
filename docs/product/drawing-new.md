# Disegni, modelli e suggerimenti

> **Per chi:** chi apre FubDraw per la prima volta, e chi comincia spesso
> disegni dello stesso tipo: una lezione, una diapositiva, uno schema.
> **Risultato:** sapere da dove nasce un disegno nuovo, quali modelli offre
> Fub e come se ne aggiungono altri nel vault, e che cosa sono i suggerimenti
> brevi che l'editor mostra sotto il foglio.

Un [disegno](drawing.md) nuovo nasce dalla finestra **«Nuovo disegno»**: un
nome, una cartella e un modello, distribuito con Fub o preso dal vault. Poi,
mentre si disegna, l'editor dice qualche gesto che non si vede, uno alla volta
e una volta sola. Niente di questo usa la rete: i modelli e le loro anteprime
sono file di Fub e del vault.

## Da dove si apre

«Nuovo disegno…» c'è dove Fub offre già di creare una nota, quando la
feature `draw` è accesa:

- nella palette dei comandi, `drawing.create`;
- nel menu dell'app, accanto a «Nuova nota»;
- nel menu di una cartella dell'esplorazione, come «Nuovo disegno qui…», che
  apre la finestra con quella cartella;
- nel riquadro vuoto, e nella shell del telefono fra le altre creazioni.

Ogni porta apre la stessa finestra. Senza la feature `draw` non c'è nessuna
delle porte, e nemmeno il comando.

## La finestra

È un dialogo modale col suo nome, «Nuovo disegno».

- **Il nome** è vuoto, col segnaposto «Disegno»: lasciato vuoto, il disegno si
  chiama «Disegno», o «Disegno 1», «Disegno 2», … se il nome è preso. Il
  nome dà anche il titolo del file.
- **La cartella** è quella da cui si è aperta la finestra, o la radice.
- **I modelli** sono schede, ognuna col nome, l'anteprima e una riga che dice
  a che cosa serve. Si sceglie con un clic o con le frecce, `Home` e `Fine`;
  il gruppo è un `radiogroup`, e una scheda sola alla volta ha il fuoco.
- **«Dal vault»** elenca i disegni della cartella dei modelli del vault, sotto.

`Invio` crea il disegno e lo apre, `Esc` chiude, e il fuoco torna dove era.
Un errore, per esempio un nome già preso, resta nella finestra accanto al
nome, e il fuoco torna al nome: niente si scrive finché il comando non
riesce. L'ultimo modello scelto si ricorda su questa macchina e vale per la
prossima volta; la prima volta è «Vuoto».

Sul telefono la finestra prende lo schermo e le schede stanno su due colonne.
Coi colori forzati le schede hanno il bordo del sistema, e la scelta si vede
anche senza colore; col movimento ridotto non c'è nessuna transizione.

## I modelli di Fub

| Modello | Che cosa c'è |
| --- | --- |
| Vuoto | il foglio di 1600 × 1000 con «Livello 1», come un disegno nuovo di sempre |
| A4 verticale | la pagina A4 in verticale, come la scrive «Dimensione della pagina» |
| A4 orizzontale | la stessa pagina, in orizzontale |
| Diapositiva 16:9 | una [tavola](drawing-boards.md) di 1920 × 1080, «Diapositiva 1», con un titolo e un sottotitolo da cambiare |
| Diagramma di flusso | un piccolo schema di partenza: inizio, un passo, una decisione col «Sì» verso la fine e il «No» verso un secondo passo che torna indietro |
| Lavagna per la lezione | una pagina di 1920 × 1080, col livello «Sfondo» bloccato e il foglio a quadretti grande quanto la pagina, e sopra il livello «Lavagna» col titolo della lezione |
| Storyboard | sei tavole di 1920 × 1080, «Scena 1» … «Scena 6», tre per riga |
| Mappa concettuale | un argomento al centro e quattro idee attorno, ognuna legata all'argomento |

Ogni modello è un disegno come gli altri, che si cambia tutto: le forme del
diagramma e della mappa vengono dalle [raccolte di forme](drawing-library.md),
coi testi come [etichette nelle forme](drawing-labels.md) e legate da
[connettori](drawing-connectors.md), e seguono come quelle disegnate a mano.
Le forme del diagramma stanno sulla griglia di 20: chi accende la griglia le
trova allineate. La griglia resta com'era, perché è una scelta della vista,
non del file.

I nomi dei livelli, delle tavole e i testi sono nella lingua dell'interfaccia
di chi crea il disegno, in italiano o in inglese; dopo, sono testo del disegno
come ogni altro. La [verifica dell'accessibilità](drawing-accessibility.md) di
un modello appena creato non ha niente da dire.

## I modelli del vault

L'impostazione del vault **`draw.templates`**, «Cartella dei modelli», dice
dove stanno i modelli propri; vale `Templates`. Ogni disegno di quella cartella
è un modello: la finestra lo offre sotto «Dal vault», e il disegno nuovo ne è
una copia col nome nuovo per titolo. Il modello resta com'è. Se la cartella è
vuota o non c'è, la finestra dice dove mettere i disegni da usare come
modelli.

## I suggerimenti brevi

Alcuni gesti dell'editor non si vedono finché qualcuno non li dice. Il
suggerimento breve li dice nel momento in cui servono, subito dopo un gesto
che gli somiglia:

| Dopo | Il suggerimento |
| --- | --- |
| un tratto fatto col dito | due dita spostano il foglio, e allargandole o stringendole lo avvicinano o lo allontanano; dal livello Standard, coi gesti accesi, anche che un tocco di due dita annulla e uno di tre ripete |
| un tratto che somiglia a una forma, dal livello Standard | tenendo fermo mezzo secondo alla fine del tratto, prima di lasciare, il tratto diventa una forma pulita ([forme dal tratto](drawing-ink-shapes.md)) |
| una forma nuova, quando ce ne sono almeno due senza testo, dal livello Standard | due tocchi o `F2` scrivono dentro una forma |

- **Uno alla volta, e una volta sola.** Un suggerimento mostrato non torna, in
  nessun disegno. Chi fa già il gesto da sé, per esempio sposta il foglio con
  due dita prima del primo tratto, non lo vede mai. Uno che arriverebbe mentre
  un altro è a schermo aspetta la sua prossima occasione.
- **Mai sopra il disegno.** Il suggerimento è una riga sotto il foglio, che si
  accorcia per farle posto: non copre il disegno né la barra, a nessun livello
  e su nessuno schermo.
- **Non se ne va da solo.** Resta finché non lo si chiude con la sua croce o
  con `Esc`, e il fuoco torna al foglio; così si legge con calma.
- **Si spengono.** La casella «Non mostrare più suggerimenti» li spegne tutti:
  quello a schermo resta finché non lo si chiude, e altri non ne vengono;
  tolto il segno, tornano. La casella scrive l'impostazione della macchina
  **`draw.suggestions`**, «Suggerimenti brevi», che si cambia anche dalle
  impostazioni.

La riga è un gruppo col nome «Suggerimento», e un lettore di schermo legge il
suggerimento quando compare, da una regione sua, senza perdere l'annuncio del
gesto che l'ha fatto comparire. Quelli già visti si ricordano su questa
macchina, nello stato della vista, per tutti i disegni.
