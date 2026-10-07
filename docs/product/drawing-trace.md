# Disegni, ricalco delle immagini

> **Per chi:** chi ha un logo, una scansione, uno schizzo o una foto come
> immagine e lo vuole come forme da modificare.
> **Risultato:** sapere come «Ricalca immagine» fa di un'immagine tracciati
> pieni, che cosa cambiano il tipo e i cursori, e che cosa resta
> dell'immagine.

Dal [livello Esperto](drawing-expert.md), **«Ricalca immagine…»** fa di
un'[immagine](drawing-images.md) un gruppo di **tracciati pieni**, uno per
macchia di colore, che si modificano come ogni altra forma: con lo strumento
Nodi, coi colori, con le operazioni booleane. Il pulsante sta nella barra
«Disponi» quando è scelta un'immagine da sola. L'immagine non si riscrive:
resta nel disegno, nascosta, sotto il gruppo.

## La barra

«Ricalca immagine…» apre una barra in fondo al foglio, come quella dello
[scostamento](drawing-paths.md#scostamento), con l'anteprima sul foglio al
posto dell'immagine. È un gruppo col nome del comando, e il fuoco va al
tipo; ciò che il ricalco trova si legge da solo quando cambia.

- **Il tipo** dice da dove si parte:
  - **Bianco e nero**, per un logo, un testo o una scansione: ciò che è più
    scuro della soglia diventa nero, il resto non si dipinge. La soglia di
    partenza sta a metà fra gli scuri e i chiari dell'immagine.
  - **Pochi colori**, il tipo di partenza, per un'illustrazione a tinte
    piatte: sei colori, da cambiare col cursore.
  - **Schizzo**, per la matita o la penna su un foglio fotografato: la
    soglia è relativa alla carta lì attorno, così un'ombra sul foglio resta
    carta.
  - **Foto**: ventiquattro colori, anche il bianco, e l'immagine appena
    ammorbidita, perché il rumore dei pixel non diventi macchie.
- **I cursori**, col valore accanto, prendono quelli del tipo quando
  cambia:
  - **Soglia**, nel bianco e nero e nello schizzo: più alta, più nero.
  - **Colori**, nei pochi colori e nella foto: quanti al più, da 2 a 32.
    Due colori che l'occhio non distingue sono uno.
  - **Dettaglio**, da 0 a 100: più alto, le curve stanno più vicine ai
    pixel e restano anche i puntini più piccoli.
  - **Senza il bianco**, una casella nei pochi colori e nella foto: toglie
    le forme bianche, come il fondo di un logo.
- **L'anteprima** cambia mentre i cursori corrono, e la barra dice che cosa
  ha trovato: «12 forme, 340 nodi, 5 colori.» Il ricalco gira a parte, in un
  worker: il foglio e la barra restano pronti anche mentre si ricalca una
  foto grande, e di un cursore che corre conta l'ultima posizione.
- **Applica**, o `Invio` in un campo, scrive il ricalco, e se uno corre
  ancora aspetta quello; **Annulla**, o `Esc`, chiude la barra senza
  scrivere niente. La barra si chiude anche quando cambia la scelta o
  l'immagine.
- **La volta dopo** la barra riparte dal tipo e dai valori dell'ultimo
  ricalco scritto; la soglia del bianco e nero si rifà su ogni immagine.

## Che cosa si ricalca

- **Ciò che si vede.** Il riquadro dell'immagine e il suo
  `preserveAspectRatio` dicono quali pixel si vedono e dove: con `slice` si
  ricalca soltanto la parte che il riquadro mostra, e ogni forma va dove sono
  i suoi pixel.
- **Le immagini incollate e quelle del vault.** Un'immagine dal web no,
  perché il disegno non carica niente dalla rete: la barra non si apre, e lo
  si dice. Un'immagine che non si apre più, o che il browser non sa leggere,
  lo dice anche lei.
- **Un'immagine grande** si legge al più a otto milioni di pixel, e si
  ricalca a due milioni, con la media dei pixel che ognuno copre: i bordi
  restano lisci.
- **I pixel trasparenti** non hanno colore: restano vuoti nel gruppo, e
  l'inchiostro su un fondo trasparente si legge come su carta bianca.

## Il risultato

- **Un gruppo, subito sopra l'immagine**, con un tracciato pieno per forma,
  dalla più grande alla più piccola: ciò che sta dentro un'altra forma le sta
  sopra. Fra due colori vicini non resta una fessura, perché la forma sotto
  si allunga di qualche pixel sotto quella sopra; un buco dove si vede
  attraverso resta buco.
- **I contorni** passano dove il colore è a metà fra le due macchie, anche
  dove l'antialiasing lo sfuma: un bordo morbido dà una curva liscia, non a
  scalini. Gli spigoli restano spigoli, i lati dritti linee senza nodi in
  mezzo, e le curve cubiche con pochi nodi da spostare.
- **Il gruppo prende** la trasformazione dell'immagine, la sua opacità e il
  suo titolo: chi legge il disegno col lettore di schermo trova lo stesso
  nome. Le forme non hanno contorno, anche dove il livello ne dà uno.
- **L'immagine resta**, con `display="none"`, subito sotto il gruppo:
  l'albero degli oggetti la mostra di nuovo, come ogni oggetto
  [nascosto](drawing-selection.md#bloccare-e-nascondere), e i suoi byte non
  cambiano.
- **È un passo solo**, «Ricalca immagine», e dopo è scelto il gruppo; si
  dice quante forme ha.

## Dove il disegno non lo regge

La barra lo dice accanto a ciò che il ricalco ha trovato, prima di Applica:

- **Al più 5000 forme**: oltre, le più piccole si uniscono alle vicine, e il
  ricalco si scrive lo stesso.
- **Un ricalco troppo grande** per il disegno, che lo porterebbe oltre la
  sua misura o oltre i suoi elementi, o con una forma troppo intricata per
  un attributo, non si scrive: la barra chiede di abbassare il dettaglio o i
  colori, e Applica lo ripete.

## Chi monta l'editor

Il ricalco sta in `apps/client/src/editors/spatial/tools/trace.ts` e
`trace-pixels.ts`, le impostazioni dei tipi in `trace-settings.ts`, il gruppo
nel disegno in `trace-ops.ts`, il worker in `trace-worker.ts` e chi gli
parla in `trace-runner.ts`; la barra e l'anteprima in `editor.ts`. Le misure
del ricalco su un corpus di immagini sintetiche, con l'errore e i nodi di
ogni tipo, sono in `trace.test.ts`.

L'editor legge i pixel col decodificatore delle immagini, `imageCodec`, lo
stesso che le riduce quando entrano, e i file del vault con `images`:
senza, un'immagine del vault non si ricalca. Al posto del worker si può
dare `tracer`, chi ricalca. Il worker è un file della stessa origine, che la
politica dei contenuti ammette; dove i worker non ci sono il ricalco gira
nella pagina. Nel Personalizzato è la parte «Ricalca immagine» ([Disegni,
livello Personalizzato](drawing-custom.md)).
