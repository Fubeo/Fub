# Formato della scena, export

> **Ambito:** che cosa diventa un disegno quando esce da Fub: le opzioni delle
> quattro destinazioni di `fub.draw`, la derivazione che sceglie il disegno, le
> tavole o la selezione e toglie lo sfondo, l'SVG pulito, la misura delle
> immagini, i formati e i nomi dei file. Versione 1.
> **Fonti autorevoli:** `crates/fub-scene/src/export.rs`, con
> `export/clean.rs` ed `export/measure.rs`; `apps/client/src/editors/spatial/scene/export.ts`,
> che deriva e misura allo stesso modo per l'anteprima, con i vettori di prova
> in `apps/client/src/__fixtures__/scene-export/`; le opzioni, i formati e i
> nomi in `crates/fub-features/src/draw.rs` e `draw/choice.rs`.

Una parte del [formato della scena](scene-format.md), §9. L'export legge il
file del vault e ne fa il file da scrivere in tre passi: sceglie che cosa,
toglie lo sfondo se lo si chiede, e scrive il formato. I primi due sono la
**derivazione**, un cambio del testo del documento uguale in Rust e in
TypeScript, così l'anteprima della finestra «Esporta» mostra ciò che l'host
scrive; il terzo è solo dell'host. Come si usa sta in [Disegni,
esportare](../product/drawing-export.md). Le sezioni del formato si citano come
«formato della scena, §N»; quelle di questa pagina col solo numero.

```json
{ "scope": "boards", "boards": ["b1a2b3c4d", "b9i0j1k2l"], "background": "none", "width": 1600 }
```

Le opzioni di un export in PNG di due tavole, senza la carta, larghe 1 600
pixel: un file per tavola, `Scienze/acqua (Copertina).png` ed
`Scienze/acqua (Evaporazione).png`.

## 1. Le destinazioni e le opzioni

Il bundle `fub.draw` ha quattro destinazioni: `draw.png`, `draw.jpeg`,
`draw.svg` e `draw.pdf`. Le opzioni stanno nel campo `options` della richiesta
di export, un oggetto JSON; il contratto di export non cambia.

| Opzione | Valori | Di serie | Per |
|---|---|---|---|
| `scope` | `drawing`, `boards`, `selection` | `drawing` | tutte |
| `boards` | id di tavole, almeno uno | — | `scope: boards` |
| `selection` | `{"ids": [...], "box": [x, y, w, h]}` | — | `scope: selection` |
| `background` | `paper`, `none` | `paper` | tutte |
| `scale` | numero maggiore di 0, al più 8 | 2 | PNG, JPEG |
| `width` | intero da 1 a 16 384 | — | PNG, JPEG |
| `suffix` | parola, al più 40 caratteri | `selection`, `exported` | `scope: selection`; SVG del disegno |

- **Un valore sbagliato** ferma l'export prima di aprire un file, con un
  errore del catalogo di `fub.draw` che lo nomina, ripetuto fino a 120
  caratteri. Un'opzione `null` vale come assente.
- **Le opzioni che la destinazione o l'ambito non usano** si ignorano, come
  quelle sconosciute: `scale` in un PDF, `boards` col disegno intero,
  `suffix` con le tavole o col disegno intero in PNG, JPEG e PDF. Senza
  opzioni i file sono quelli di prima, byte per byte, scritti dal testo del
  vault così com'è.
- **Le tavole:** gli id sono stringhe; uno ripetuto vale una volta, e
  l'ordine della richiesta non conta (§5).
- **La selezione:** `ids`, gli id degli oggetti, e `box`, il loro riquadro in
  unità del disegno, quattro numeri finiti con larghezza e altezza maggiori di
  0 a 2 decimali. Il client lo calcola dagli oggetti, contorno compreso, sui
  numeri interi verso fuori.
- **`width`** accetta anche un numero con la virgola che è intero, come
  `800.0`.
- **`suffix`** segue le regole del PDF annotato: niente caratteri di
  controllo né `/ \ : * ? " < > |`, e gli spazi ai bordi si tolgono.

| Errore | Quando |
|---|---|
| `e_scope` | `scope` non è una delle tre parole |
| `e_boards` | `boards` non è una lista di stringhe, almeno una |
| `e_selection` | `selection` non ha `ids`, una lista di stringhe, almeno una |
| `e_box` | `box` non ha quattro numeri, o larghezza e altezza non sono maggiori di 0 |
| `e_background` | `background` non è `paper` o `none` |
| `e_scale` | `scale` non è un numero maggiore di 0 e al più 8 |
| `e_width` | `width` non è un intero da 1 a 16 384 |
| `e_scale_and_width` | `scale` e `width` insieme |
| `e_annotated_suffix` | `suffix` non segue le sue regole |
| `e_one_drawing` | `boards` o `selection` con più di un disegno nella richiesta |
| `e_board` | il disegno non ha una delle tavole chieste |
| `e_object` | un id della selezione non è un oggetto del disegno (§2) |

Gli errori delle opzioni vengono prima di leggere un disegno; `e_board` ed
`e_object` vengono dal disegno, e anche loro prima di aprire un file. Un
disegno che non si legge, invece, non ferma gli altri: resta fuori, e il log
lo nomina.

## 2. La derivazione

Cambia il testo del documento in tre punti, e lascia uguale ogni altro byte.

1. **Il rettangolo:** per una tavola il suo `viewBox`, per la selezione
   `box`; il disegno intero non cambia. La radice prende `viewBox`, `width` e
   `height` del rettangolo: un attributo che c'è cambia valore sul posto,
   dentro le sue virgolette; quelli che mancano si aggiungono in quest'ordine
   dopo l'ultimo attributo della radice. I numeri si scrivono con la regola
   del formato della scena, §7, a 2 decimali.
2. **La selezione:** lungo la strada dalla radice a ogni oggetto scelto si
   tolgono gli elementi grafici che non sono scelti, non ne contengono uno e
   non sono una carta. Gli elementi grafici sono `a`, `circle`, `ellipse`,
   `foreignObject`, `g`, `image`, `line`, `path`, `polygon`, `polyline`,
   `rect`, `svg`, `switch`, `text` e `use` di SVG; il resto resta, `defs`,
   `style`, `title` e le risorse comprese.
3. **Lo sfondo** `none` toglie ogni carta, cioè ogni `rect` figlio della
   radice con `fub:role="paper"`.

- **Un id scelto** è un elemento grafico a cui si arriva dalla radice
  passando solo per `a`, `g`, `svg` e `switch`, e non una carta: un livello,
  un gruppo, un oggetto, anche in un disegno estraneo, ma non un `tspan` o una
  risorsa. Di due elementi con lo stesso id vale il primo; un id ripetuto
  nella richiesta vale una volta.
- **Togliere un elemento** toglie il testo dal suo `<` alla fine del suo tag
  di chiusura, e lo spazio bianco che lo precede nel genitore, se è un nodo di
  testo fatto solo di spazi. I cambi si fanno tutti sul testo di partenza, e
  non si sovrappongono. Derivare di nuovo il testo derivato non lo cambia.
- **Gli esiti:** il testo derivato, o un errore: `unknown-board` e
  `unknown-object` con l'id, `empty-selection`, `bad-box`, `malformed` e
  `not-svg`, gli stessi nei due linguaggi.

## 3. L'SVG pulito

Altri cambi sul testo derivato, con la stessa regola per togliere; il file
del vault resta l'originale.

- **Si tolgono** i commenti, le istruzioni di elaborazione, il DOCTYPE, la
  dichiarazione XML e il BOM, perché il file è UTF-8; gli attributi di un
  namespace che non è quello vuoto, XLink o XML, `fub:ink` compreso, e le
  dichiarazioni dei prefissi che nessun elemento rimasto usa; gli elementi di
  un altro namespace fuori da un `foreignObject`, col loro contenuto; i
  `metadata`; i `view` delle tavole, tranne nel disegno intero, dove `#id`
  mostra ancora una tavola in un browser.
- **Ciò che non si vede:** gli elementi con `display: none` fuori da `defs`,
  e dentro `defs` quelli che nessuno riferisce, tranne `style` e `script`, si
  tolgono se niente al loro interno è riferito da ciò che resta; poi un `defs`
  rimasto vuoto. Gli elementi nascosti restano tutti se un foglio di stile del
  file parla di `display`, se un'animazione lo cambia o se c'è uno script; e
  uno resta se il suo `style` non si legge con certezza.
- **Un riferimento** è `href` o `xlink:href` con `#id`, e `url(#id)` in un
  attributo, in un `style` o nel testo di un `<style>`. Si contano da ciò che
  resta, quindi una risorsa usata solo da un oggetto tolto se ne va con lui.
- **Le entità** di un DOCTYPE si espandono prima di toglierlo; quella di
  un'entità esterna non si carica e sparisce, come in un browser.
- **I numeri** di `d`, di `points` e delle lunghezze e coordinate del formato
  della scena, §4, si riscrivono con la regola di §7 a n decimali: 2, più uno
  per ogni potenza di 10 dell'ingrandimento dei `transform` sopra l'elemento
  e del suo (il valore singolare più grande), fino a 6. Dentro `defs`,
  `clipPath`, `mask`, `marker`, `pattern` e `symbol` i numeri prendono i 6
  decimali, perché si disegnano dove li usa qualcun altro. I valori con
  un'unità restano come sono, e così `transform` e i `viewBox` interni.
- **In `d`** i comandi, i separatori e le bandierine degli archi restano
  quelli; fra due numeri che si toccavano si mette uno spazio. Una coordinata
  relativa si arrotonda da sola finché il punto che fa resta entro mezzo
  decimale da dov'era, e altrimenti dal punto già scritto: l'errore non si
  somma lungo il tracciato.
- **Si ripulisce una volta:** ripulire un file pulito non lo cambia. Il file
  pulito e quello derivato danno con `resvg` gli stessi pixel, a meno dei
  numeri arrotondati: di un livello su un pixel di bordo, e di qualche livello
  in più sulla punta di uno spigolo vivo o di un marker.
- **Le immagini del vault** entrano coi loro byte, come URI `data:`, con le
  regole degli altri formati (§5): fuori dal vault il loro percorso non
  porterebbe a niente. Quelle che restano fuori tengono il percorso, e il log
  le nomina; un indirizzo del web resta un indirizzo.

## 4. La misura

- **PNG e JPEG con `scale`:** la scala più grande, fino a quella chiesta, a
  cui l'immagine resta entro 16 384 pixel per lato e 32 milioni in tutto, e i
  lati arrotondati per eccesso.
- **Con `width`** l'immagine è larga esattamente `width` pixel e alta
  `ceil(h × s)`, con la scala `s = width / w`; se così supera i limiti esce
  alla scala che ci sta, e il log lo dice.
- **Il conto** si fa a 32 bit, come `resvg`, e il client lo rifà con
  `Math.fround`: la finestra dice la misura del file, provata dagli stessi
  vettori. L'esito è la scala, i due lati e se la misura è ridotta.
- **La densità** del PNG e del JPEG è 96 punti per pollice per la scala, così
  un programma di impaginazione mette l'immagine alla misura del disegno.
- **Una pagina del PDF** misura il rettangolo, a 0,75 punti per unità.

## 5. I formati

- **PNG:** trasparente dove non c'è niente, con la densità in `pHYs` e il
  titolo del disegno in `iTXt`.
- **JPEG:** la stessa immagine posata sul bianco, qualità 90, con il colore
  non sottocampionato, così i bordi dei tratti restano netti. Porta la sola
  intestazione JFIF con la densità, e niente EXIF né profili; una densità
  fuori da 1–65 535 punti per pollice non si scrive, e il JFIF dice soltanto
  che i pixel sono quadrati. Lo sfondo `none` toglie le carte, e sotto resta
  il bianco.
- **SVG:** il testo pulito di §3, in UTF-8.
- **PDF:** il disegno o la selezione sono una pagina; le tavole una pagina per
  tavola, nell'ordine del documento e non in quello della richiesta, ciascuna
  della sua misura, con un segnalibro col nome della tavola, e il lettore apre
  il pannello dei segnalibri. Ciò che le pagine hanno uguale, un carattere o
  un'immagine, si scrive una volta. Il titolo del disegno va nei metadati.
- **Gli stessi byte** escono a ogni export, in tutti e quattro i formati:
  nessuno porta date, e l'ordine interno del PDF non cambia.
- **Le risorse** sono quelle del formato della scena, §9: immagini raster in
  data URI e del vault, queste fino a 64 MiB per disegno, e caratteri di Fub;
  il resto resta fuori, e il log lo nomina.

## 6. I nomi dei file

- **Il disegno:** `Scienze/acqua.png`, col nome e le cartelle del disegno e
  l'estensione `.png`, `.jpg` o `.pdf`. In SVG il nome sarebbe quello del
  disegno, che salvato accanto prenderebbe il suo posto: ha la parola di
  `suffix`, `Scienze/acqua (esportato).svg`, di serie `exported`. **La
  selezione:** `Scienze/acqua (selezione).png`, con la parola di `suffix`, di
  serie `selection`.
- **Le tavole:** in PNG, JPEG e SVG un file per tavola,
  `Scienze/acqua (Copertina).png`; in PDF un file solo, `Scienze/acqua.pdf`,
  o `Scienze/acqua (Copertina).pdf` se la tavola è una.
- **Il nome di una tavola nel nome del file:** `/ \ : * ? " < > |` diventano
  `-`, i caratteri di controllo si tolgono, gli spazi, a capo compresi, si
  riducono a uno e quelli in cima e in fondo si tolgono, con i punti finali;
  al più 40 caratteri. Se non resta niente, il numero della tavola fra tutte
  quelle del disegno.
- **Due nomi uguali** prendono ` 1`, ` 2` dentro le parentesi, come
  `Scienze/acqua (Copertina 1).png`; due disegni con lo stesso nome li
  prendono dopo il nome, come prima, anche in SVG:
  `Scienze/acqua 1 (esportato).svg`.
