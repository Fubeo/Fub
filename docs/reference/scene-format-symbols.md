# Formato della scena, simboli

> **Ambito:** i simboli di un disegno e le loro istanze: la loro forma, il
> contenuto, l'origine da una libreria, come si contano, come le operazioni
> li tengono veri e come escono nell'export. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/classify.ts`
> e `crates/fub-scene/src/classify.rs`, che leggono allo stesso modo; il
> riepilogo e l'accessibilità in `scene/analysis.ts`,
> `scene/accessibility.ts` e nei loro gemelli Rust; la scrittura in
> `scene/serialize.ts`, le operazioni in `scene/engine.ts`, coi vettori di
> prova da 84 a 88 ([operazioni sulla scena](scene-operations.md), §9);
> l'SVG pulito in `crates/fub-scene/src/export/clean.rs`.

Una parte del [formato della scena](scene-format.md), §4, e delle sue
[risorse](scene-format-resources.md). Un simbolo è un disegno piccolo che
si usa più volte: una presa in una pianta, un'icona in uno schema, un
albero in un giardino. Ogni volta che compare è un'istanza, che lo mostra
dov'è e girato come lei; cambiare il simbolo cambia tutte le istanze.
Le sezioni del formato si citano come «formato della scena, §N»; quelle di
questa pagina col solo numero.

```xml
<defs id="fub-defs">
  <symbol id="r4k7m2p9q" fub:source="Simboli/Impianti.svg#r00000004 9f3a6c01d2e4b587" overflow="visible">
    <title>Presa</title>
    <circle id="o1a2b3c4d" cx="0" cy="0" r="20" fill="#ffffff" stroke="#1a1a1a" stroke-width="2"/>
    <line id="o5e6f7g8h" x1="-8" y1="-6" x2="-8" y2="6" stroke="#1a1a1a" stroke-width="2"/>
    <line id="o9j8k7l6m" x1="8" y1="-6" x2="8" y2="6" stroke="#1a1a1a" stroke-width="2"/>
  </symbol>
</defs>
…
<use id="o2n3p4q5r" transform="translate(320 180)" href="#r4k7m2p9q"/>
<use id="o6s7t8u9v" transform="matrix(0 1 -1 0 480 180)" href="#r4k7m2p9q"/>
```

Una presa, venuta dalla libreria `Simboli/Impianti.svg`, e due sue istanze:
una dritta, una girata di un quarto di giro. Ogni lettore di SVG le disegna.

## 1. Il simbolo

Un simbolo è un `symbol` figlio di una `defs` della radice. Di SVG ha
soltanto:

- **un `id`** non vuoto. Un simbolo che entra con un'operazione ha l'id di
  una risorsa, `r` e otto caratteri (formato della scena, §7);
- **`overflow="visible"`**, obbligatorio: senza, un browser taglierebbe il
  contenuto al riquadro dell'istanza, e una parte del simbolo sparirebbe.

Un `viewBox`, `x`, `y`, `width`, `height`, `preserveAspectRatio`, `refX`,
`refY`, un attributo `xlink:*` o ogni altro attributo SVG rendono estraneo
il simbolo (formato della scena, §8), e con lui le sue istanze: il simbolo
non ha un riquadro suo, e sta nelle coordinate dell'istanza. Gli attributi
`fub:*` e degli altri namespace restano, come altrove.

Il **nome** del simbolo è il suo primo `title`, come per un oggetto. Un
simbolo non si disegna da solo, perché sta in una `defs`, e non è un
oggetto: non si sceglie sul foglio e non sta nell'albero degli oggetti.

Un simbolo con l'id di un'altra risorsa, o di un simbolo prima di lui, non
è un simbolo: il documento ha S003, e la prima vince.

## 2. L'istanza

Un'istanza è un `use` fuori dalle `defs`, dovunque può stare un oggetto,
anche nel contenuto di un altro simbolo. Rimanda a un simbolo modificabile del documento con `href` o con
`xlink:href`, uno solo dei due, nella forma `#id`. Di SVG ha soltanto:

- `id`, `transform`, `opacity`, `display`;
- `style`, che dice soltanto la fusione ([effetti](scene-format-effects.md),
  §5);
- `clip-path`, `mask` e `filter`, coi valori di un oggetto.

Per figli ha soltanto `title`, `desc` e spazio; il primo `title` è il nome
dell'istanza. `x`, `y`, `width` e `height` la rendono estranea: si sposta
col `transform`, come un gruppo. Un riempimento, un contorno o un attributo
del testo la rendono estranea anche loro, perché il contenuto del simbolo
li erediterebbe e il simbolo si vedrebbe diverso in ogni istanza.

Un `use` verso un id che il documento non ha dà S014, come ogni
riferimento rotto; uno verso qualcosa che non è un simbolo modificabile è
estraneo, e si disegna come uno strato immagine.

## 3. Il contenuto

I figli di un simbolo si giudicano uno per uno, come quelli di un gruppo: il
contenuto sono oggetti, con i loro id da oggetto, `o` e otto caratteri,
anche il testo, le immagini, i gruppi e le istanze di altri simboli. Un
figlio estraneo resta estraneo e si conserva, e il simbolo resta
modificabile.

**Nessun simbolo contiene sé stesso,** nemmeno attraverso altri: i
riferimenti del contenuto di un simbolo, `href` e `url(#id)`, verso altri
simboli sono gli archi, e un simbolo su un ciclo non è un simbolo, con
tutte le sue istanze. Una catena di simboli può essere lunga quanto il
file.

Le risorse che il contenuto usa sono quelle del documento, con le loro
regole ([risorse](scene-format-resources.md), §6 e §7).

## 4. L'origine da una libreria

Una libreria è un disegno del vault coi suoi simboli. Un simbolo copiato da
una libreria porta `fub:source`, facoltativo:

```text
<percorso nel vault>#<id nella libreria> <impronta>
```

- **Il percorso** è quello del disegno della libreria dalla radice del
  vault, con `/`, e può avere spazi.
- **L'id** è quello del simbolo nella libreria, senza spazi né `#`; nella
  copia il simbolo ha un id nuovo.
- **L'impronta** sono 16 cifre esadecimali minuscole: FNV-1a a 64 bit dei
  byte UTF-8 del simbolo nella libreria e di ciò che usa. Ognuno si prende
  com'è scritto nel file, dal `<` del suo tag d'apertura all'ultimo `>`, con
  gli a capo fatti LF; i testi si uniscono con un LF fra l'uno e l'altro.
  Prima il simbolo, poi le risorse e i simboli che nomina, con `url(#id)`,
  con un `href` `#id` o con `fub:style`, poi quelli che nominano loro,
  ognuno la prima volta che lo si incontra, in ordine di testo; un nome che
  non è una risorsa né un simbolo della libreria, come un oggetto del
  contenuto, non conta. Un simbolo che non usa niente ha l'impronta del suo
  solo testo. Dice se la libreria è cambiata dalla copia, anche soltanto in
  un colore di una sfumatura che il simbolo usa o in un simbolo che contiene.

Si legge dalla fine: l'ultimo spazio separa l'impronta, l'ultimo `#` prima
di lui l'id. Un valore senza questa forma resta e non dice niente. Il
disegno non rimanda mai a un altro file: la copia ha tutto il simbolo, e
un altro programma lo disegna anche senza il vault.

## 5. Il riepilogo e l'accessibilità

- **Il conto** degli oggetti (formato della scena, §9) conta il contenuto
  di un simbolo una volta, e le istanze no: un simbolo usato cento volte ha
  le sue forme e i suoi testi una volta sola.
- **Il riquadro** del disegno comprende quello di ogni istanza visibile: il
  riquadro del contenuto del suo simbolo, portato dal `transform`. Un
  simbolo che nessuno usa non lo allarga; un'istanza nascosta nemmeno.
- **Il contrasto** (S009) non si misura nel contenuto di un simbolo, che
  ha sotto di sé un fondo diverso in ogni istanza; un testo sopra
  un'istanza ha un fondo che non si sa, come sopra un'immagine, e S009
  tace ([accessibilità](scene-format-accessibility.md)).
- **S012 e S013** valgono anche nel contenuto di un simbolo, una volta per
  elemento, nelle coordinate del simbolo: un testo di 10 px in un simbolo è
  piccolo anche se un'istanza lo ingrandisce.

## 6. Le operazioni

Le regole che tengono veri i simboli ([operazioni sulla
scena](scene-operations.md)):

- **Un simbolo è una risorsa che non si raccoglie mai:** resta anche quando
  nessuno lo usa, e se ne va soltanto quando qualcuno lo toglie.
  Toglierlo, o togliere la `defs` che lo contiene, mentre un'istanza fuori
  da ciò che si toglie lo usa è `in-use`, e così `ident` che gli toglie
  l'id.
- **In un `batch` il simbolo viene prima delle sue istanze:** un `use`
  verso un simbolo che non c'è ancora è `invalid-elem`. Un simbolo entra
  anche con la `defs` nuova che lo contiene.
- **Un'operazione che farebbe contenere sé stesso a un simbolo** è `cycle`:
  un'istanza che entra nel simbolo che usa, o in uno che la usa; un `set`
  dell'`href`; un `move` di un'istanza dentro un simbolo.
- **Il contenuto** si cambia come quello di un gruppo; un `move` porta un
  oggetto dentro un simbolo o fuori, e resta un oggetto col suo id.
- **Il limite** delle risorse modificabili, 10 000 (formato della scena,
  §11), conta anche i simboli.

## 7. La scrittura

FubDraw scrive gli attributi nell'ordine canonico (formato della scena,
§7): di un simbolo `fub:source` subito dopo l'id e `overflow` dopo la
presentazione; di un'istanza `transform` prima di `href`. Il contenuto sta
nelle righe seguenti, rientrato di due spazi, come quello di un gruppo.

## 8. L'export

- **Nell'SVG pulito** ([export](scene-format-export.md)) restano i simboli
  che un'istanza disegna, anche attraverso un altro simbolo, con le risorse
  del loro contenuto; quelli che nessuno usa, o che soltanto un'istanza
  nascosta usa, se ne vanno. `fub:source` se ne va con gli altri attributi
  `fub:*`.
- **Il PNG, il JPEG e il PDF** disegnano ogni istanza col suo simbolo,
  come un browser.

## 9. Lettori più vecchi

Un lettore che non conosce i simboli vede estranei il `symbol` nella
`defs` e ogni `use`: li conserva byte per byte e disegna le istanze come
strati immagine, che si vedono e non si modificano. `fub:source` è per lui
un attributo `fub:*` che non conosce. La versione resta 1.
