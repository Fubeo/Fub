# Disegni, rendere modificabile

> **Per chi:** chi apre in FubDraw un SVG fatto con un altro programma, un
> logo di Illustrator, un disegno di Inkscape, un'icona di una raccolta, un
> diagramma di Mermaid, e vuole cambiarne le parti come quelle che disegna.
> **Risultato:** sapere dove si trova «Rendi modificabile», che cosa
> riscrive, che cosa lascia com'è e perché, e come si torna indietro.

FubDraw tiene le parti di altri programmi come sono, byte per byte: si
vedono, si spostano e si scelgono, ma le proprietà non le cambiano. Dal
[livello Esperto](drawing-expert.md), **«Rendi modificabile»** le riscrive
nel formato di FubDraw, dove si può senza che cambi ciò che si vede; ciò che
non si può resta com'è, e il comando dice perché. Fuori dal comando niente
si riscrive. Il piano è in
`apps/client/src/editors/spatial/tools/make-editable.ts`, la finestra in
`tools/editable-dialog.ts`.

## Dove si trova

- **In «Selezione avanzata» e col tasto destro,** «Rendi modificabile…»
  lavora sulla parte di un altro programma sotto il puntatore, se il tasto
  destro ne tocca una, o sugli oggetti scelti che ne contengono, come un
  gruppo con dentro parti di altri programmi, o che dei `use` di altri
  programmi mostrano. «Rendi modificabile il disegno…» lavora su tutto il
  disegno, fogli di stile compresi.
- **Sull'avviso di un SVG estraneo,** accanto a «Modifica» ([Disegni,
  documenti che non si modificano subito](drawing.md#documenti-che-non-si-modificano-subito)),
  «Rendi modificabile…» adotta il file e riscrive le sue parti nello stesso
  passo. Se è già tutto nel formato lo adotta e basta, come «Modifica».

Una voce che non serve è spenta e dice perché: gli oggetti scelti non hanno
parti di altri programmi, o il disegno non ne ha che si vedano. In sola
lettura le voci sono spente. Il piano si calcola quando si sceglie il
comando, e il suo codice arriva la prima volta che serve.

## La finestra

Prima di cambiare il disegno, la finestra mostra:

- **Il prima e il dopo,** uno accanto all'altro; nel dopo ciò che resta com'è
  è sbiadito.
- **Una frase:** quante parti diventano modificabili, quante restano e
  perché sotto, quante parti che non si vedono restano (i metadati, le
  impostazioni di un altro programma), e se il file riceve i due attributi di
  FubDraw sulla radice.
- **«Elementi riscritti»:** quanti elementi ha cambiato ogni traduzione, e
  quante regole e quanti fogli di stile se ne vanno.
- **«Che cosa resta com’è»:** ogni parte che resta, col suo nome, o col tag
  se non ne ha, e il perché, per esempio «FubDraw non ha l’elemento
  «switch»» o «la misura «2ex» non si sa calcolare». L'elenco ne nomina al
  più cento, e delle altre dice quante sono.

«Rendi modificabile» conferma, «Annulla» rinuncia; se niente cambierebbe c'è
soltanto «Chiudi». Le anteprime si guardano e basta: la frase e gli elenchi
dicono tutto anche a chi non le vede. Il comando è un passo d'annulla,
«Parti rese modificabili», e dice com'è andata: «2 parti sono diventate
modificabili. Una resta com’è.». Se il disegno cambia mentre la finestra è
aperta, il comando non fa niente e lo dice.

## Che cosa riscrive

| Traduzione | Prima | Dopo |
| --- | --- | --- |
| Stile in linea | `style="fill:#c53030;stroke-width:2"` | `fill="#c53030" stroke-width="2"`, nell'ordine del file |
| Fogli di stile | `class="st0"` e la regola `.st0{fill:#c53030}` | i valori che le regole danno, scritti nell'elemento |
| Colori di CSS | `rgb()`, `hsl()`, `hwb()`, `transparent`, `currentColor`, le forme con la trasparenza | `#rrggbb`, con l'opacità in `fill-opacity` o `stroke-opacity` |
| Misure relative | `em`, `rem`, le percentuali della finestra | numeri |
| Nomi | `data-name`, `aria-label`, gli altri `data-*` | il titolo, che è il nome dell'oggetto; gli altri se ne vanno |
| Righe dei testi | le righe con la `y`, come le scrivono Inkscape e Illustrator | righe col `dy` |
| Risorse | una sfumatura che eredita da un'altra con `href`; una risorsa fuori dalla `defs` | la sfumatura con ciò che ereditava; la risorsa nella `defs` delle risorse |
| `svg` annidati | un `svg` dentro il disegno, con la sua finestra | un gruppo con la matrice della finestra, e un ritaglio se il contenuto può uscirne |
| `use` | un `use` di un `symbol`, o di una forma come i cloni di Inkscape | un'istanza di un [simbolo](drawing-symbols.md) |

Ogni parte diventa modificabile tutta insieme, coi figli che possono se è un
gruppo, oppure resta com'era. Un `symbol` estraneo diventa un simbolo del
formato col suo id; una forma che dei `use` clonano va in un simbolo nuovo,
col suo nome, e al suo posto resta un'istanza. Un valore che il contenuto
riceve uguale da ogni `use`, come il colore di `currentColor`, vi si scrive;
se i `use` danno valori diversi, il simbolo e i suoi `use` restano com'erano.
Sul disegno intero una regola che non sceglie più niente se ne va, e un
foglio vuoto con lei. Gli attributi che non disegnano niente e che il
formato non ammette, come `class`, se ne vanno.

## Che cosa resta com'è

Resta ciò che non si scrive nel formato senza cambiare l'aspetto: un
elemento che FubDraw non ha, come `switch` o `foreignObject`; uno stile che
dipende da dove si guarda il disegno, come `@media`; un selettore che non si
sa leggere, come `:hover`, o che sceglie per posizione; un foglio importato;
una misura come `ex`, che dipende dal carattere; un `use` che non diventa
un'istanza; una parte in un livello o in un gruppo bloccato. Una parte legata
a un'altra che resta, come un simbolo e i suoi `use`, resta con lei. Le
animazioni non si traducono.

Prima di proporre il piano, il comando lo prova: applica le operazioni a un
disegno di prova e confronta l'aspetto di ogni elemento, come lo vedono un
browser, l'esportazione e il foglio. Ciò che non torna resta com'è, e il
piano si rifà senza. Il banco di fedeltà (`apps/client/bench/fidelity.mjs`)
confronta pixel per pixel il disegno di prima col foglio di dopo, su scene
che toccano ogni traduzione, e vede i fogli di stile tolti apposta al prima.

Anche i caratteri restano: un testo che nomina il suo carattere in un foglio
di stile, come quelli di Mermaid, si vede già prima nel carattere che l'export
userebbe, e dopo la famiglia è un attributo. Fa eccezione un foglio che
comincia con una famiglia generica, come `sans-serif`: prima la sceglie il
browser, dopo è quella di Fub ([Disegni, caratteri del
vault](drawing-fonts.md)).

## Livelli e parti

Nel [Personalizzato](drawing-custom.md) la parte **«Rendi modificabile»**,
dall'Esperto, porta le due voci e il pulsante sull'avviso. Senza, le parti di
altri programmi restano come sono, e un SVG estraneo si adotta con
«Modifica».
