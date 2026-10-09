# Disegni, importare da Excalidraw e draw.io

> **Per chi:** chi ha schemi e lavagne fatti con Excalidraw o con draw.io
> (diagrams.net) e li vuole nel vault come disegni da cambiare.
> **Risultato:** sapere da dove si importa, che cosa si vede prima di
> scrivere, dove nasce il disegno e che cosa diventa ogni cosa del file.

«Importa disegno» fa un [disegno](drawing.md) nuovo da un file di Excalidraw
o di draw.io. Il file d'origine non cambia mai: il disegno nasce accanto, ed è
un disegno come gli altri, con forme, testi, connettori e tavole che l'editor
cambia come se li avesse disegnati lui. Niente usa la rete: il file si legge
sulla macchina, e un'immagine che nel file non c'è resta fuori.

## Da dove si apre

«Importa disegno» c'è dove si crea un disegno nuovo, quando la feature `draw`
è accesa:

- nel menu dell'app, accanto a «Nuovo disegno…», come «Importa disegno…»,
  che sceglie il file dal disco;
- nella palette dei comandi, «Importa disegno», senza tasti suoi;
- nel menu di una cartella dell'esplorazione e in quello del titolo dei file,
  come «Importa un disegno qui…», che sceglie il file dal disco e mette il
  disegno in quella cartella;
- nel menu di un file del vault che si può importare, come «Importa in un
  disegno…»;
- con un clic su un file del vault che Fub non sa mostrare ma sa importare,
  per esempio un `.drawio` o un `.excalidraw`.

Ogni porta apre la stessa finestra. Senza la feature `draw` non c'è nessuna
delle porte.

## I file che si leggono

| File | Da dove |
| --- | --- |
| `.excalidraw`, `.excalidraw.json` | Excalidraw, «Salva su disco» o «Esporta» |
| `.drawio`, `.dio`, `.drawio.xml` | draw.io, il file del diagramma, con le pagine compresse o no |
| `.drawio.svg`, `.drawio.png` | draw.io, un'immagine esportata col diagramma dentro |

Il programma si riconosce dal contenuto, non dal nome: un `.json`, un `.xml`,
un `.svg` o un `.png` che portano un disegno di uno dei due programmi si
importano lo stesso. Il file più grande che si legge è di 64 MB.

## La finestra

È un dialogo modale col suo nome, «Importa disegno». Si apre subito e legge
il file; intanto dice che cosa sta facendo, «Leggo il file…» e poi «Preparo
il disegno…». Quando il disegno è pronto mostra:

- **da dove viene**: il nome del file e il programma, per esempio «Da
  «rete.drawio», un disegno di draw.io.»;
- **l'anteprima**: il disegno com'è venuto, sulla sua pagina, con i caratteri
  dell'app;
- **quanto c'è**: le forme, i testi, le linee, i tratti a mano libera, le
  immagini, le tavole e i livelli;
- **che cosa cambia**: una frase per ogni genere di cosa che non entra o che
  entra diversa, col numero di volte e, dove aiuta a trovarla, un esempio,
  come il nome di una forma o un indirizzo. Se non cambia niente lo dice:
  «Entra tutto com'è.»;
- **il nome e la cartella** del disegno nuovo, già scritti e da cambiare.

«Importa» scrive il disegno e lo apre, e una notifica dice dove è nato.
Prima che il disegno sia pronto il pulsante non risponde, ma il nome e la
cartella si scrivono già. `Invio` importa, `Esc` chiude senza scrivere
niente, e il fuoco torna dove era. Ce n'è una sola: un secondo gesto riporta
alla finestra aperta.

Un file che non si importa lo dice nella finestra, e toglie il nome e
«Importa»: non è un disegno dei due programmi, non ha niente da disegnare, è
troppo grande da leggere, oppure non sta nei limiti di un disegno nemmeno con
le immagini rimpicciolite. Un nome che non va o una scrittura che non riesce
restano nella finestra, nell'avviso, e si può riprovare.

Sul telefono la finestra prende lo schermo, coi campi in colonna; col
movimento ridotto non c'è nessuna transizione. L'anteprima ha un nome per chi
legge con una voce, lo stato di lettura si annuncia da sé, e gli errori
arrivano in un avviso.

## Dove nasce il disegno

- **La cartella** è quella del file, se viene dal vault; quella da cui si è
  chiesto, se viene dal disco; la radice, dal menu dell'app e dalla palette.
- **Il nome** è quello del file senza l'estensione del programma:
  `rete.drawio.png` diventa `rete.svg`. Un nome con una barra è un percorso
  dalla radice del vault, come in «Nuovo disegno»; un nome lasciato vuoto è
  quello del file; un `.svg` scritto in fondo non si ripete.
- **Un nome preso non si sovrascrive mai.** Il disegno prende il primo libero
  della famiglia, `rete 1.svg`, `rete 2.svg`, …, come un allegato incollato
  in una nota, e la notifica dice quale.
- **Il titolo** del disegno è il nome che ha preso.

Il nome passa la stessa regola dei nomi nuovi del vault: niente caratteri che
un filesystem si riserva, niente nomi che Windows si tiene, non più di 255
byte, e la frase dell'errore dice quale regola manca.

## Che cosa diventa

L'importazione scrive il disegno con l'editor, come lo scriverebbe chi lo
disegna: un'etichetta segue la sua forma, un connettore i suoi oggetti, e la
[verifica dell'accessibilità](drawing-accessibility.md) lo legge come ogni
altro disegno.

### Da Excalidraw

| In Excalidraw | Nel disegno |
| --- | --- |
| rettangolo, ellisse, rombo | la stessa forma, col rettangolo dall'angolo tondo e il rombo della [raccolta di forme](drawing-library.md) |
| riempimento pieno, a tratteggio, incrociato | pieno, o una [campitura](drawing-patterns.md) a righe del colore del riempimento, col passo di Excalidraw |
| testo dentro una forma | l'[etichetta della forma](drawing-labels.md) |
| testo a sé | un testo, a punto o in area se in Excalidraw ha una larghezza fissa |
| freccia agganciata, dritta, curva o a gomito | un [connettore](drawing-connectors.md) sugli stessi oggetti, col testo come sua etichetta |
| freccia o linea libera | una linea con le stesse [punte](drawing-tips.md) |
| tratto a mano libera | un tratto della Penna, con la pressione se il file la ha |
| immagine | un'[immagine](drawing-images.md) |
| gruppo, cornice | un gruppo, una [tavola](drawing-boards.md) |

Il tratto «a mano» di Excalidraw diventa un tratto pulito, e i caratteri a
mano (Virgil, Excalifont) diventano Inter; Cascadia e Comic Shanns diventano
il carattere a larghezza fissa.

### Da draw.io

| In draw.io | Nel disegno |
| --- | --- |
| pagine | [tavole](drawing-boards.md), l'una accanto all'altra; una pagina sola resta il foglio |
| livelli | [livelli](drawing-layers.md) |
| rettangolo, ellisse, rombo, forme dei diagrammi di flusso | la stessa forma, dalla raccolta quando c'è |
| triangolo, esagono, parallelogramma e le altre forme fatte di lati | un contorno uguale |
| testo della cella, in HTML o no | l'etichetta della forma quando sta in mezzo, altrimenti un testo dove lo mette draw.io, in un gruppo con la forma; grassetto, corsivo, sottolineato, barrato, colori, corpi, elenchi e tabelle restano |
| contenitori, corsie, tabelle | gruppi con dentro i loro oggetti |
| arco agganciato, dritto, a gomito o curvo | un connettore sugli stessi oggetti, con le etichette lungo la linea |
| immagine nel file | un'immagine |
| ombra | l'[effetto Ombra](drawing-effects.md), coi valori di draw.io |

`shadow` getta l'ombra della forma, `textShadow` quella del testo, e l'ombra
della pagina vale per tutto. Il tratto «sketch» diventa pulito, una
sfumatura diventa il colore pieno del riempimento, e i caratteri a mano
diventano Inter.

### Che cosa non entra, o entra diverso

Il rapporto della finestra lo dice prima di scrivere, una frase per genere:

- un oggetto che non si sa leggere, un contenuto incorporato (una pagina web,
  un video) e un'immagine che sta fuori dal file o in un formato che non si
  legge restano fuori;
- un collegamento su un oggetto o in un testo si perde: l'oggetto o il testo
  resta;
- un pezzo dell'aspetto di un testo che il disegno non ha (un'immagine nel
  testo, un apice, uno sfondo) resta fuori, e il testo resta;
- una forma che FubDraw non ha, come le icone dei servizi cloud, diventa la
  più vicina, di solito un rettangolo dei suoi colori;
- una punta che FubDraw non ha diventa la più vicina, o nessuna; una punta
  vuota diventa piena;
- un percorso disegnato a mano su un connettore lascia il posto a quello che
  il connettore trova da sé, quando i due sono lontani;
- un segnaposto di draw.io (`%nome%`) senza un valore resta com'è scritto;
- un'immagine troppo pesante per un disegno si rimpicciolisce: un disegno
  incorpora PNG, JPEG, WebP e GIF fino a 5 MiB ciascuna, e resta
  modificabile fino a 20 MiB in tutto. Un SVG diventa un PNG al doppio della
  sua misura;
- se con le ombre il disegno non sta nei suoi limiti, le ombre restano fuori.
