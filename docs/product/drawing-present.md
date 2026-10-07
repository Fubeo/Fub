# Disegni, presentare

> **Per chi:** chi mostra un disegno ad altri: una lezione, una riunione, un
> racconto per tavole.
> **Risultato:** sapere come si comincia una presentazione, come ci si muove
> fra le tavole, che cosa fanno gli schermi nero e bianco, il laser e
> l'inchiostro, e come si esce.

Dal [livello Standard](drawing.md#il-livello-standard) un [disegno](drawing.md)
si presenta: le sue [tavole](drawing-boards.md) a schermo intero, una alla
volta, nel loro ordine. La presentazione guarda e non scrive: il disegno, il
file e la [cronologia](drawing-history.md) restano come sono, e si presenta
anche un documento in sola lettura. Il codice sta in
`apps/client/src/editors/spatial/tools/present.ts`, che l'editor carica
soltanto quando si presenta.

## Cominciare

- **«Presenta»**, nella barra dopo «Tavole», e `F5` sul foglio cominciano
  dalla prima tavola.
- **`Maiusc+F5`** comincia dalla tavola di adesso: quella scelta o, se
  nessuna lo è, quella al centro della vista.
- **«Presenta da qui»**, nel menu di una riga dell'[elenco delle
  tavole](drawing-boards.md#lelenco-delle-tavole), comincia da quella tavola.

La presentazione chiede lo schermo intero; dove non lo si può avere copre la
finestra, con gli stessi tasti. Il fuoco va su di lei, e lo dice:
«Presentazione: Copertina, tavola 1 di 5. Esc per uscire.». `F5` con `Ctrl`,
`Alt` o `⌘` non presenta.

## Che cosa si vede

- **Ogni tavola intera**, al centro e il più grande possibile, su fondo nero.
  È ritagliata sul suo rettangolo come la mostra una nota che la
  [incorpora](drawing-boards.md#le-tavole-nelle-note), con le immagini del
  vault e i caratteri dell'app: di un oggetto a cavallo del bordo si vede la
  parte dentro. Dove la tavola non ha carta, sotto c'è il bianco. Il nome
  sopra la tavola, che è un'etichetta del foglio, non c'è.
- **La tavola giusta.** «Presenta da qui» e `Maiusc+F5` partono proprio da
  quella tavola, anche se un'altra ha lo stesso nome.
- **Senza tavole** il disegno è una tavola sola: la pagina o, in un disegno
  senza pagina, ciò che disegna, con un piccolo margine. Si chiama col titolo
  del disegno, o «Pagina», o «Il disegno». Un disegno vuoto e senza pagina
  mostra il nero.
- **Pronte prima.** Le immagini si preparano prima che servano: quella di
  adesso, poi la seguente e la precedente, così un passo mostra una tavola
  già pronta. Restano quelle a due passi da dove si è; le altre si liberano,
  e all'uscita tutte.
- **Il disegno di quando si comincia.** La presentazione mostra il disegno
  com'era quando è cominciata.

## Muoversi

| Tasti o gesto | Che cosa fa |
| --- | --- |
| `→`, `↓`, `Spazio`, `PagGiù`, `Invio`, `N` | la tavola dopo |
| un clic del mouse, il dito che scorre verso sinistra | la tavola dopo |
| `←`, `↑`, `PagSu`, `Backspace`, `P` | la tavola prima |
| il dito che scorre verso destra | la tavola prima |
| `Home`, `Fine` | la prima e l'ultima tavola |
| un numero, poi `Invio` | la tavola con quel numero |

Ogni passo si dice: «Evaporazione, tavola 2 di 5.».

- **Dopo l'ultima** viene lo schermo di fine, nero, con le parole «Fine della
  presentazione» e «Un altro passo avanti, o Esc, per uscire.»: un altro
  passo avanti esce, uno indietro torna all'ultima tavola. Dalla prima, un
  passo indietro lo dice, «Copertina è la prima tavola.», e non si torna
  all'ultima; dall'ultima non si ricomincia dalla prima.
- **Il numero.** Le cifre si scrivono senza vederle, e `Backspace` toglie
  l'ultima; `Invio` va alla tavola. Un numero che non c'è lo dice: «Non c’è
  la tavola 9: le tavole sono 5.».
- **Il clic** va avanti se il mouse non si muove più di qualche pixel: un
  trascinamento scrive. Il tasto destro non va avanti, e il menu del browser
  non si apre.
- **Il dito** cambia tavola scorrendo in orizzontale, almeno 48 pixel e il
  doppio di quanto sale o scende. Un tocco non fa niente, e due dita nemmeno.
  Mentre una penna è vicina o appoggiata il dito è il palmo di chi scrive, e
  non cambia tavola.

## Gli schermi nero e bianco

`B` o il punto mettono lo schermo nero, `W` o la virgola quello bianco: nero
e bianco veri, con ogni tema. Lo stesso tasto toglie lo schermo, e così un
tasto per muoversi o un clic, che tornano dov'era senza muoversi; un numero e
`Invio` vanno invece alla tavola. Gli schermi si dicono, «Schermo nero.» e
«Schermo bianco.», e tornando si ridice dove si è.

## Il laser

Un punto rosso segue il mouse e la penna sospesa sopra lo schermo, al posto
del cursore. È acceso quando si comincia, e compare quando il puntatore si
muove. `L` lo spegne e lo riaccende, e lo dice: «Laser spento.», «Laser
acceso.». Fermo tre secondi, il punto sparisce, e torna appena il puntatore
si muove; col laser spento lo stesso fa il cursore. Il dito non ha laser.

## L'inchiostro

- **Si scrive** trascinando col mouse o con la penna sulla tavola: un tratto
  rosso, fatto come quelli della penna dell'editor, con la pressione della
  penna. Un tocco della penna lascia un punto. Il dito non scrive, e il palmo
  appoggiato mentre si scrive non conta.
- **Svanisce** ogni tratto tre secondi dopo la fine; con il moto ridotto se
  ne va di colpo.
- **`E`** cancella tutto l'inchiostro, «Inchiostro cancellato.», o dice che
  non ce n'è. Lo toglie anche cambiare tavola, uno schermo vuoto e lo schermo
  di fine; sugli schermi vuoti e su quello di fine non si scrive.
- **Non entra nel disegno:** né nel file né nella cronologia.

## Uscire

`Esc` esce, e così un passo avanti dallo schermo di fine e uscire dallo
schermo intero in un altro modo. Il fuoco torna al foglio, e l'editor sceglie
e inquadra la tavola dove si era arrivati, e lo dice: «Pioggia, tavola 3 di
3, 400 × 200.»; in un disegno senza tavole torna soltanto il fuoco. Il
disegno non cambia. Chiudere il disegno chiude anche la presentazione.

## Da tastiera e coi lettori di schermo

La presentazione è una finestra modale, «Presentazione», e lo schermo è
un'area con i suoi tasti, «Schermo della presentazione», che li descrive. I
tasti restano suoi: i comandi dell'app, sotto, non li ricevono, e `Tab` non
esce. Quelli con `Ctrl`, `Alt` o `⌘` la presentazione non li usa.

| Tasto | Che cosa fa |
| --- | --- |
| `B` o `.` | mette e toglie lo schermo nero |
| `W` o `,` | mette e toglie lo schermo bianco |
| `L` | accende e spegne il laser |
| `E` | cancella l'inchiostro |
| `Esc` | esce |

- **A parole.** Ogni passo si dice nella regione live della presentazione,
  che in schermo intero è la sola che si sente: l'inizio, la tavola col suo
  numero, lo schermo di fine, gli schermi vuoti, il laser, l'inchiostro
  cancellato.
- **Il testo alternativo** di ogni tavola è il suo nome e, se c'è, la sua
  descrizione, il `desc` della tavola nel file ([formato della scena,
  tavole](../reference/scene-format-boards.md)): «Evaporazione. Il sole
  scalda il mare.».
- **Nessuno stato si legge dal solo colore:** lo schermo di fine ha le sue
  parole, e gli schermi vuoti e il laser si dicono.
- **Il moto ridotto** toglie lo svanire: l'inchiostro se ne va di colpo.

`?`, sul foglio, elenca `F5` e `Maiusc+F5` sotto «Vista», e i tasti della
presentazione sotto «Presentazione».

## Livelli e parti

All'Essenziale non ci sono il pulsante «Presenta», `F5`, `Maiusc+F5` e
«Presenta da qui». Sono la parte «Presentare» del
[Personalizzato](drawing-custom.md), che va anche senza la parte «Tavola»:
allora non c'è l'elenco, e nemmeno «Presenta da qui».
