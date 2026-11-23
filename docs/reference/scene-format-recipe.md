# Formato della scena, la ricetta di un oggetto

> **Ambito:** la ricetta, la forma nativa del motore di un oggetto che la
> scena non sa dire, tenuta nel file accanto alla grafica espansa che ogni
> programma mostra: l'elemento, l'impronta, le versioni, che cosa succede
> quando l'elemento cambia, e la tabella dei costrutti. Versione 1.
> **Fonti autorevoli:** `vendor/vectorcraft/crates/svg/src/recipe.rs`
> (patch `0009-ricetta-per-elemento`) per l'elemento, l'impronta e i byte;
> `crates/fub-disegno/src/ricetta.rs` per la tabella, la lettura e la
> scrittura; `crates/fub-disegno/src/espansa.rs` per il corpo espanso; le
> prove in `crates/fub-disegno/tests/ricetta.rs` e, per la riapertura dopo
> un comando, in `crates/fub-disegno/tests/ricette_riapertura.rs`.

Un oggetto del disegno con un effetto dal vivo, un aspetto con tre
riempimenti o una forma dal vivo non si scrive in SVG semplice senza perdere
qualcosa. Il file tiene allora due cose: nel corpo la grafica espansa, che
ogni programma disegna uguale, e in un `<metadata>` la ricetta, che il
motore di Fub rilegge per riavere l'oggetto com'era. Il formato della scena
non cambia: la scena conserva già i `<metadata>` parola per parola
([formato della scena](scene-format.md)). Chi possiede la ricetta è il ponte
fra la copia e il motore ([il disegno sul motore](../architecture/disegno.md#la-ricetta)).

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300">
  <title>Ricette</title>
  <metadata><vectorcraft:recipe xmlns:vectorcraft="urn:vectorcraft:editing" for="oa1a1a1a1" hash="2e24b89e1d40e96f" v="1">eyJmb3JtYXQiOi…</vectorcraft:recipe></metadata>
  <g id="l1a2b3c4d" fub:layer="Livello 1">
    <path id="oa1a1a1a1" d="M100 115 C100 106.716 106.716 100 115 100 L185 100 C193.284 100 200 106.716 200 115 L200 135 C200 143.284 193.284 150 185 150 L115 150 C106.716 150 100 143.284 100 135 Z" fill="#000000"/>
  </g>
</svg>
```

Un rettangolo con l'effetto dal vivo «angoli arrotondati» (raggio 15): il
corpo ne porta la grafica espansa, con l'effetto già applicato (le curve
degli angoli); la ricetta porta il rettangolo di partenza e l'effetto, che
il motore riapplica alla riapertura. Il caso è
`crates/fub-disegno/tests/casi-prova/prova.json` (`stylize.roundCorners`).

## 1. L'elemento

`<vectorcraft:recipe>` sta direttamente dentro un `<metadata>`, nello
spazio dei nomi `urn:vectorcraft:editing`, legato sull'elemento stesso
(così il blocco si sposta senza toccare la radice). Gli attributi:

| Attributo | Vuol dire |
|---|---|
| `for` | l'`id` dell'elemento del corpo a cui appartiene |
| `hash` | l'impronta dell'elemento quando la ricetta si è scritta (§2) |
| `v` | la versione del formato della ricetta: `1` in questa versione (§3) |

Il testo è base64 standard (RFC 4648; il riempimento `=` è facoltativo e
gli spazi non contano) di un JSON:
`{"format":"vectorcraft-recipe","version":1,"node":…}`, l'oggetto del
motore con i suoi figli, nello spazio dell'elemento senza la sua
`transform`, senza i nomi degli oggetti che contiene.

Non è il blocco `<vectorcraft:document>` che il motore scrive per sé: un
VectorCraft aperto da solo su un file di Fub non scambia una ricetta per il
documento intero. Fub scrive le ricette in un solo `<metadata>`, primo
figlio di `<svg>` dopo il titolo; lo stesso blocco tiene, come le trova, le
altre cose che conteneva. Le ricette in un `<metadata>` più in basso nel
file si leggono ma non si riscrivono.

## 2. L'impronta

`hash` è `body_hash` del motore applicato al testo dell'elemento, dal tag di
apertura a quello di chiusura, figli compresi, **senza i suoi attributi
`transform`, `display` e `fub:locked`**: FNV-1a a 64 bit in esadecimale,
con gli spazi fra i tag tolti e le altre serie di spazi lette come uno solo
(`ricetta::impronta`). Gli stessi attributi dei figli contano: sono la
grafica espansa. Così:

- spostare, ruotare o scalare l'oggetto, che cambia solo la sua
  `transform`, tiene la ricetta;
- nasconderlo, mostrarlo, bloccarlo e sbloccarlo, che cambiano solo il suo
  `display` e il suo `fub:locked`, tengono la ricetta;
- rientrare il file o cambiarne i fine riga non conta;
- ogni altro cambio dell'elemento, in Fub senza il motore o fuori da Fub,
  fa cadere la ricetta (§4).

## 3. Le versioni

`v="1"`, lo stesso numero del campo `version` del JSON. Una ricetta con una
`v` più grande apre il disegno **in sola lettura**, con il perché fra le
parti che restano come sono («sola lettura: una ricetta è di una versione
più nuova del disegno (2, questa legge fino a 1)»), come per un file che Fub
non sa scrivere. Una ricetta senza
`v`, o con una `v` che non è un numero, resta com'è e l'oggetto è grafica
semplice.

## 4. All'apertura

Il motore legge le ricette dopo aver letto il corpo. Una ricetta vale se il
suo elemento c'è, è nella mappa e la sua impronta torna: allora l'oggetto
del motore diventa quello della ricetta, messo dove l'elemento sta, nascosto
e bloccato come l'elemento (lo stato è del file, non della ricetta). Un
corpo che non disegna niente (senza riempimento né contorno, anche sotto una
maschera di opacità) l'import del motore non lo porta: la ricetta, se vale,
rimette l'oggetto al posto dell'elemento fra i fratelli; sotto la radice,
fuori da un livello, resta la riga «non trova il suo oggetto nel motore».
Una ricetta che non vale non blocca mai l'apertura: l'elemento resta grafica
semplice e si modifica come tale, e una riga fra le parti lo dice (tipo
approssimato, il dettaglio comincia con «la ricetta »).

| Caso | Che cosa succede alla ricetta | Avviso |
|---|---|---|
| l'impronta non torna (l'elemento è cambiato fuori da Fub) | cade alla scrittura dopo, mai riscritta | sì |
| l'elemento non c'è (orfana, o l'id è cambiato) | cade alla scrittura dopo | no |
| una seconda ricetta per lo stesso id | vale la prima, la seconda cade alla scrittura dopo | sì |
| base64 rotto, JSON che non si legge, `apply_recipe` la rifiuta | resta parola per parola | sì |
| porta un'immagine, un documento collocato o un collegamento a un file | resta parola per parola, l'oggetto non la prende | sì |
| usa un simbolo o un motivo che il disegno non ha | resta parola per parola | sì |
| due elementi con lo stesso id | il disegno è in sola lettura (scena), la ricetta resta | sì |
| `v` più grande | resta, il disegno è in sola lettura | sì |
| più di 50 000 ricette (`MAX_RICETTE`) | nessuna si applica, restano tutte, il disegno è in sola lettura | — |

Una ricetta non porta mai un percorso del disco al motore: i nodi immagine e
documento collocato e ogni `link` non nullo la fanno rifiutare prima di
leggerla. Gli elementi del corpo dentro un oggetto rifatto dalla ricetta
sono il suo corpo espanso: non sono oggetti del motore e non sono parti.
L'oggetto riaperto è quello della ricetta, non il corpo: l'effetto non si
applica due volte.

## 5. Alla scrittura

La differenza (`crates/fub-disegno/src/differenza.rs`) scrive le ricette
come operazioni sulla scena ([operazioni sulla scena](scene-operations.md)):

- un oggetto con una ricetta che si sposta soltanto: un `set` della sua
  `transform`, la ricetta resta;
- un oggetto con una ricetta nascosto, mostrato, bloccato o sbloccato: un
  `set` del suo `display` o del suo `fub:locked`, la ricetta resta;
- un oggetto che diventa ricco, o un oggetto con la ricetta che cambia
  altrimenti: l'elemento si toglie e si riaggiunge con lo stesso id (se è
  già della forma nuova, se no con uno nuovo) come corpo espanso (`raw`),
  e la ricetta nuova nasce con l'impronta di quel testo. Il corpo è la
  grafica dell'oggetto anche se è nascosto; se è nascosto o bloccato, un
  `set` di `display="none"` o `fub:locked="true"` sull'id del corpo viene
  dopo l'`add`;
- un gruppo è ricco solo per ciò che è suo (la sua opacità, il suo modo di
  fusione, il suo riempimento o contorno, che è un aspetto impilato perché si
  disegna sopra gli oggetti), mai per gli oggetti che contiene: il confronto
  scende fino a loro, e ognuno si scrive per sé (riscritto con la sua
  ricetta se diventa ricco); il gruppo si riscrive intero solo quando cambia
  ciò che è suo;
- quando le ricette cambiano, il loro `<metadata>` si toglie (`remove` col
  percorso) e se ne aggiunge uno nuovo (`add` `raw`, primo figlio di
  `<svg>`) con le ricette che restano, le nuove e il resto del blocco
  com'era; le ricette degli elementi tolti, riscritti, orfani o cambiati
  fuori da Fub non ci sono più.

Il corpo espanso è la grafica che il motore disegna, scritta dalla sua
esportazione SVG (`crates/fub-disegno/src/espansa.rs`): l'oggetto da solo,
già nello spazio del genitore, su un documento con le risorse di quello
vero. Gli effetti dal vivo sono applicati, l'aspetto impilato è un
elemento per ogni riempimento e contorno, le forme dal vivo hanno la loro
geometria, i testi sono contorni, le ombre e le sfocature sono filtri.
Il corpo è un elemento solo con l'id dell'oggetto:

- l'elemento che l'esportazione scrive, se è uno, senza risorse e senza
  `transform`, e resta un elemento del formato della scena;
- se no un `<g>` che lo avvolge, con le sue risorse in una `<defs>`. Gli
  elementi dentro che il formato non sa dire (un attributo come
  `stroke-miterlimit`, un filtro) restano estranei: si disegnano e si
  conservano come sono.

Gli id che l'esportazione scrive (le risorse a cui si rimanda) diventano
id nuovi di Fub (`r…` le risorse, `o…` il resto), coi loro rimandi. Un
corpo che non sarebbe un elemento del formato fa rifiutare il gesto
(`unsupported`): la ricetta non lo troverebbe alla riapertura. Le
coordinate hanno tre decimali, come l'esportazione del motore.

Un gesto che non tocca ricette non tocca il `<metadata>`, e un file senza
ricette torna byte per byte. Gli altri metadati (RDF, Inkscape, spazi dei
nomi di altri programmi) restano parola per parola.

## 6. La tabella dei costrutti

`ricetta.rs` dà a ogni costrutto del motore un esito, con un `match`
esaustivo sui tipi del motore: un costrutto nuovo a monte non compila
finché non ha la sua riga. Le famiglie leggono la tabella: un comando che
crea un costrutto `Ricetta` passa da qui, un costrutto `Scena` usa la forma
della scena.

| Esito | Quando | Costrutti |
|---|---|---|
| `Corpo` | l'SVG semplice basta | livello, gruppo, tracciato, tracciato composto, testo, forma semplice, attributi SVG |
| `Scena` | la scena ha la stessa cosa con le stesse opzioni ([effetti e fusione](scene-format-effects.md), [simboli](scene-format-symbols.md), [ripetizioni](scene-format-repeats.md), [spessore variabile](scene-format-width.md), [risorse](scene-format-resources.md), [penne](scene-format-pens.md)) | effetto della scena, modo di fusione, opacità, simbolo e sue sostituzioni, ripetizione, spessore variabile, sfumatura, motivo, penna, tratteggio, maschera, ritaglio, immagine, documento collocato |
| `Ricetta` | la scena non ce l'ha, o non con le stesse opzioni | aspetto impilato, effetto vivo, forma viva, fusione di oggetti, busta, maglia, intreccio, isolamento, allineamento del contorno, sovrastampa, pressione, ricalco, testo avvolto, grafico, contorni del testo, pixelato, forma disegnata, stile grafico, fetta, prospettiva, quota, pittura viva, oggetti sul tracciato, colorazione, forma composta |

Finché una famiglia non scrive la forma della scena, un oggetto nuovo con un
costrutto `Scena` porta anch'esso la ricetta. Un oggetto la cui grafica
semplice non è un tracciato o un gruppo (un'istanza di simbolo,
un'immagine, un documento collocato) non si riscrive così: il gesto è
rifiutato come per le altre parti che restano come sono.

## 7. Lettori senza il motore

Un programma che non conosce le ricette disegna il corpo e conserva il
`<metadata>`, se conserva i metadati. Fub con il motore spento apre il file
come grafica semplice: le ricette restano parola per parola finché il
motore non scrive. Se un altro programma cambia l'elemento, l'impronta non
torna e la ricetta cade alla scrittura dopo (§4).
