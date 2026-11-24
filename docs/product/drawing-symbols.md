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
ma lo Standard non ne crea di nuovi e non li scollega: «Crea simbolo», «Scollega dal
simbolo», la riga «Simbolo», il pannello «Simboli» e le librerie del vault se
ne sono andati col livello Esperto (decisione 0231). Le operazioni che
restano sono in `apps/client/src/editors/spatial/tools/symbols.ts`; il file
in [formato della scena, simboli](../reference/scene-format-symbols.md).

Il [Disegno completo](drawing.md) invece li crea e li cambia, come
VectorCraft: vedi [Nel Disegno completo](#nel-disegno-completo).

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

## Nel Disegno completo

Il Completo ha i comandi dei simboli di VectorCraft, nella sezione
**Simboli** della scheda Risorse dell'ispettore e nella ricerca dei comandi
(`Ctrl+/`). La sezione ha la lista dei simboli del disegno, ognuno con
quante istanze ha; il simbolo scelto nella lista (Ctrl ne sceglie altri) è
quello su cui lavorano i pulsanti, ed è il simbolo che Spruzzo e Simbolismo
spargono. Un pulsante che ha bisogno di un simbolo scelto o di oggetti
scelti nel disegno è spento finché non li ha, e lo dice. Il campo **Nome**
dà il nome al simbolo nuovo e a quello da rinominare.

- **Nuovo simbolo** fa un simbolo degli oggetti scelti e li sostituisce
  con un'istanza; **Ridefinisci simbolo** gli dà come arte gli oggetti
  scelti, e tutte le istanze cambiano.
- **Inserisci istanza simbolo** mette un'istanza al centro;
  **Interrompi collegamento al simbolo** fa dell'istanza scelta oggetti
  semplici; **Sostituisci simbolo** dà alle istanze scelte un altro
  simbolo.
- **Duplica simbolo**, **Opzioni simbolo** (il nome) ed **Elimina
  simbolo**, che scollega o toglie le istanze che lo usano.
- **Seleziona tutte le istanze** e **Seleziona tutti gli elementi non
  usati**, che sceglie nella lista i simboli che niente usa; le
  **librerie** di VectorCraft, aperte da «Librerie di simboli…», da cui un
  clic su un simbolo lo copia nel disegno.
- Gli **strumenti dei simboli** stanno nel riquadro del Generatore forme
  della colonna. **Spruzzo simboli** sparge istanze del simbolo lungo il
  tratto, in un gruppo nuovo; la sua fila ha il **Simbolo** (lo stesso
  scelto nella sezione: cambiarlo da una parte lo cambia dall'altra; senza
  scelta, il primo del disegno), il **Diametro** del pennello e la
  **Densità**. **Spostamento**, **Compressione**, **Ridimensionamento**,
  **Rotazione** e **Trasparenza** cambiano le istanze sotto il pennello
  (Alt fa il contrario: allarga, rimpicciolisce, rende opache); la loro
  fila ha il Diametro e l'**Intensità**. Ogni tratto è un passo di
  annulla. **Colorazione** e **Stile** non ci sono ancora: danno
  all'istanza un riempimento suo, che il file non sa ancora scrivere.

Ogni comando è un passo di annulla. Ciò che il file non sa ancora dire non
si fa e lo si dice: colorare un'istanza col Coloratore, cambiarne l'aspetto,
la maschera, la fusione o il blocco, opzioni del simbolo diverse da quelle
di serie, un simbolo dentro un altro. Un'istanza girata, scalata o
deformata in un modo che un `use` disegnerebbe diverso, per esempio
ingrandita con un contorno, va nel file con la sua copia dell'arte e torna
istanza alla riapertura
([formato](../reference/scene-format-symbols.md#10-la-scrittura-del-disegno-completo)).

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
programma che non conosce i simboli di Fub vede `symbol` e `use`, che
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
