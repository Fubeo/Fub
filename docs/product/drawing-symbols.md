# Disegni, simboli

> **Per chi:** chi apre un disegno con dei simboli, lo stesso disegno piccolo
> ripetuto molte volte, una presa in una pianta, un'icona in uno schema.
> **Risultato:** sapere che cos'è un simbolo e un'istanza, come si modifica
> un simbolo, e che cosa succede ai simboli negli appunti e nell'export.

Un disegno può avere i suoi **simboli**: disegni piccoli con un nome, che si
mostrano tante volte quante servono. Ogni volta che un simbolo compare è
un'**istanza**, che lo mostra dov'è, girata e grande come lei; cambiare il
simbolo cambia tutte le istanze. Fub mostra, sceglie e modifica i simboli che
un disegno porta, scritti da una versione precedente o da un altro programma,
ma non ne crea di nuovi e non li scollega: «Crea simbolo», «Scollega dal
simbolo», la riga «Simbolo», il pannello «Simboli» e le librerie del vault se
ne sono andati col livello Esperto (decisione 0231). Le operazioni che
restano sono in `apps/client/src/editors/spatial/tools/symbols.ts`; il file
in [formato della scena, simboli](../reference/scene-format-symbols.md).

## Simboli e istanze

- **Il simbolo** sta fra le risorse del disegno e non si vede da solo: lo
  mostrano le sue istanze. Il suo contenuto sono oggetti come gli altri,
  forme, testi, immagini, gruppi, anche istanze di altri simboli; mai di sé
  stesso, nemmeno attraverso altri.
- **L'istanza** è un oggetto: si sceglie, si sposta, si gira, si ridimensiona,
  ha la sua opacità, la sua fusione, i suoi effetti, il suo ritaglio e la sua
  maschera. Il riempimento e il contorno sono del contenuto, e un'istanza non
  ha nodi: le forme si cambiano dentro il simbolo.
- **Il nome.** Un'istanza senza nome si chiama come il suo simbolo
  nell'albero degli oggetti, nella Lettura e negli annunci, «Presa»; con un
  nome suo, quello.
- **Un simbolo resta** nel file anche quando nessuna istanza lo usa.
- **Il conto** del disegno conta il contenuto di un simbolo una volta sola:
  una presa usata cento volte ha le sue forme una volta.

Il file resta un SVG che ogni programma apre: il simbolo è un `symbol`,
l'istanza un `use`, e ogni lettore di SVG la disegna.

## Modificare un simbolo

Due tocchi su un'istanza, `Ctrl+Invio` o `⌘Invio` con un'istanza scelta da
sola, e **«Modifica simbolo»** nel menu aprono il simbolo dove quell'istanza sta, come un [gruppo
isolato](drawing-selection.md#isolare-un-gruppo): il resto si attenua, la
barra dell'isolamento dice «Simbolo «Presa»», l'albero mostra il contenuto
del simbolo. Ciò che si cambia o si disegna lì cambia il simbolo, e lo si
vede subito in tutte le istanze, anche mentre si trascina. Il contenuto si
sceglie nelle coordinate dell'istanza, con ciò che lei gli dà, l'opacità e i
ritagli.

`Esc` o «Esci dal simbolo» tornano fuori, con l'istanza scelta. Entrando lo
si dice: «Simbolo «Presa»: cambiarlo cambia tutte le sue istanze. Si sceglie
solo qui dentro; Esc esce.».

Un'operazione che farebbe contenere sé stesso a un simbolo, come incollarvi
una sua istanza, non si fa: «Modifica non applicata: un simbolo conterrebbe
sé stesso.».

## Appunti e duplica

- **Duplicare** un'istanza fa un'altra istanza dello stesso simbolo.
- **Copiare** porta negli appunti i simboli che le istanze usano, con ciò che
  usano loro.
- **Incollare** riconosce i simboli che il disegno ha già: un simbolo che
  arriva è quello del disegno con lo stesso nome e lo stesso contenuto, a
  parte gli id. Nello stesso disegno l'istanza incollata è del simbolo che
  c'era; in un altro disegno che lo ha già non si copia due volte. Un simbolo
  diverso con un nome preso arriva col primo nome libero, «Presa 2»
  ([Disegni, appunti](drawing-clipboard.md)).

## Esportare e altri programmi

L'SVG pulito tiene i simboli che un'istanza disegna, anche attraverso un
altro simbolo, e lascia gli altri; il PNG, il JPEG e il PDF disegnano ogni
istanza col suo simbolo ([Disegni, esportare](drawing-export.md)). Un
programma che non conosce i simboli di FubDraw vede `symbol` e `use`, che
ogni lettore di SVG disegna.

## Accessibilità

Ogni comando dice che cosa ha fatto. La [verifica
dell'accessibilità](drawing-accessibility.md) non misura il contrasto dentro
un simbolo, che in ogni istanza ha un fondo diverso. Un testo troppo piccolo
o un'immagine senza descrizione dentro un simbolo li segnala una volta sola,
nelle coordinate del simbolo, qualunque sia l'istanza.

## Spazi e parti

In ogni spazio i simboli restano nel disegno e le istanze si vedono, si
scelgono e si spostano come ogni oggetto; un'istanza apre il suo simbolo dove
si isola un gruppo, con la selezione avanzata.
