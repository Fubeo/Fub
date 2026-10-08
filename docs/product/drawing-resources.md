# Disegni, risorse

> **Per chi:** chi apre e cambia disegni con sfumature, motivi, punte di
> freccia, ritagli, maschere od ombre, fatti con FubDraw o con un altro
> programma.
> **Risultato:** sapere quali oggetti restano modificabili, come si vedono,
> che cosa ne fanno i comandi e gli appunti.

Una sfumatura, un motivo, un marcatore, un ritaglio, una maschera, un
filtro o il tracciato che un [testo segue](drawing-typography.md#il-testo-su-tracciato)
non si disegnano da soli: stanno nelle risorse del disegno, e gli
oggetti li usano per nome. Un [disegno](drawing.md) li legge, li mostra e
li tiene veri mentre lo si cambia; come il file li scrive è in [Formato della
scena, risorse](../reference/scene-format-resources.md).

## Che cosa resta modificabile

- **Un oggetto che usa una risorsa del disegno** si sceglie, si sposta, si
  trasforma e si cambia come gli altri, se la risorsa è nelle risorse del
  disegno e il formato la conosce tutta. È il caso dei disegni di FubDraw
  e di molti SVG di altri programmi.
- **Ciò che il formato non conosce resta estraneo**, insieme a chi lo usa:
  una sfumatura che ne eredita un'altra, come Inkscape le scrive spesso, una
  sfumatura accanto agli oggetti, come in Illustrator, un filtro con una
  trama o un'immagine, una risorsa con uno stile CSS. Si vede com'è, e si
  sposta e si elimina intero.
- **Un riferimento a un nome che il disegno non ha** si disegna senza la
  risorsa, e la diagnostica lo segnala (S014).

## Come si vedono

Sul foglio le risorse sono vive: un oggetto con una sfumatura la mostra
mentre lo si sposta o lo si ridimensiona, e due disegni aperti insieme non si
scambiano le risorse, anche se hanno gli stessi nomi. Gli oggetti estranei
portano nella loro immagine le risorse che usano. In Lettura e
nell'esportazione il file è quello che è.

## Il pannello delle proprietà

- **Un riempimento o un contorno con una risorsa** si legge «Sfumatura» o
  «Motivo». Il pulsante del colore accanto mostra i punti della sfumatura, da
  sinistra a destra o dal centro, o una scacchiera per un motivo.
- **Scrivere un colore** e confermarlo mette il colore al posto della
  risorsa, in un passo di annulla; `Esc` prima di confermare torna alla
  risorsa, e `Invio` senza aver cambiato niente non fa niente.

## I comandi

- **Duplica** copia le risorse proprie dell'oggetto, una volta sola anche
  se più oggetti duplicati le usano, e con nomi nuovi: cambiare la copia non
  cambia l'originale. Le risorse condivise, come una punta di freccia, e
  quelle scritte da un altro programma restano in comune.
- **Separa** (`Ctrl+Maiusc+G`) non separa un gruppo con un ritaglio, una
  maschera o un filtro, che valgono per tutto il gruppo, e lo dice; con più
  gruppi separa gli altri e dice quanti ne restano interi. Allo stesso modo
  «Togli il collegamento» lascia un collegamento con un effetto.
- **«Applica trasformazione»** lascia la trasformazione a un oggetto che usa
  una risorsa, anche ereditata dal gruppo, e a un gruppo con un ritaglio,
  una maschera o un filtro: la risorsa vive nelle loro coordinate, e
  portarla nella geometria cambierebbe ciò che si vede. Gli oggetti dentro
  il gruppo la applicano ciascuno per sé
  ([Disegni, livello Esperto](drawing-expert.md#applica-trasformazione)).
- **Eliminare** un oggetto toglie anche le risorse proprie o condivise che
  nessun altro usa più, nello stesso passo di annulla; quelle scritte da un
  altro programma restano.
- **Più oggetti con la stessa risorsa propria** possono nascere da Separa,
  dal costruttore di forme o dalle forbici: la usano insieme, e resta finché
  uno di loro la usa. «Incolla lo stile» e il contagocce danno invece a ogni
  oggetto la sua copia.

## Copiare e incollare

- **Copiare** mette negli appunti le risorse che gli oggetti usano, anche
  quelle di un colore che ereditano dal gruppo, in un `defs` dell'SVG
  ([Disegni, appunti](drawing-clipboard.md)).
- **Incollare** porta le risorse che ciò che entra usa fra quelle del
  disegno, prima di chi le usa; le altre del `defs` incollato se ne vanno.
  Una risorsa propria arriva sempre con un nome nuovo. Una condivisa, o di
  un altro programma, si riusa se il disegno ne ha già una con lo stesso
  nome e lo stesso contenuto, altrimenti arriva con un nome nuovo: così un
  giro di copia e incolla nello stesso disegno non raddoppia le risorse.
- **Un campione** si riusa se il disegno ha lo stesso, con lo stesso nome
  nel file, anche se intanto ha cambiato colore o nome; o un campione che si
  chiama allo stesso modo, con le maiuscole a parte, e ha lo stesso colore.
  Chi lo usa ne prende il colore come ripiego. Altrimenti arriva, e se il suo
  nome è già preso, o si legge come un colore, prende il primo libero,
  «Vermiglio 2» ([Disegni, colori](drawing-colors.md#fra-disegni)).
- **Le risorse estranee** che ciò che entra usa arrivano anch'esse fra
  quelle del disegno, e restano estranee con chi le usa.
- **Un SVG con un foglio di stile** tiene le sue risorse nel suo gruppo, come
  il resto: il foglio potrebbe sceglierle, e spostarle cambierebbe ciò che
  si vede.

## Chi monta l'editor

Le risorse dell'editor stanno in
`apps/client/src/editors/spatial/tools/resources.ts`, gli appunti in
`clipboard.ts`, e la superficie le disegna con `painter/paint.ts`.
