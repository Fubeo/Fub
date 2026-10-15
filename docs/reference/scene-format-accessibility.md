# Formato della scena, accessibilità

> **Ambito:** come un disegno di FubDraw si presenta a chi non lo vede o lo
> vede male: titoli, descrizioni, immagini decorative, ordine di lettura, e i
> controlli S001, S009, S012, S013 e S017. Versione 1.
> **Fonti autorevoli:** `crates/fub-scene/src/accessibility.rs`,
> `apps/client/src/editors/spatial/scene/accessibility.ts` e le fixture
> generate in `apps/client/src/__fixtures__/scene/`, che valgono per tutte e
> due le letture.

Le regole che il [formato della scena](scene-format.md) dà a chi non vede il
disegno, e i controlli che `fub-scene` e la superficie fanno su come il
disegno si legge. Il lettore Rust e quello TypeScript danno gli stessi codici,
negli stessi punti e con gli stessi dettagli. Come li mostra l'editor, e come
si correggono, sta in [Disegni, accessibilità](../product/drawing-accessibility.md).
Le sezioni del formato si citano come «formato della scena, §N».

## 1. Nomi, descrizioni e ordine

- **Il disegno:** il primo `title` figlio della radice è il suo nome, quello
  con cui uno screen reader lo presenta; il `desc` lo descrive più a lungo.
  Senza un titolo, o con un titolo vuoto, c'è S001.
- **Un oggetto:** il primo `title` è il suo nome, nell'albero degli oggetti e
  per lo screen reader; il `desc` aggiunge una descrizione (formato della
  scena, §4).
- **Una forma con un'etichetta:** si chiama con le parole della sua
  etichetta, il testo che si vede, e il `title`, se c'è, prende il posto del
  tipo («Decisione «Controlla l'ordine»»). Il gruppo che tiene soltanto loro
  due, senza un `title` suo, si chiama come la forma
  ([etichette](scene-format-labels.md), §7).
- **Un'immagine:** il `title` è la sua descrizione, ciò che lo screen reader
  dice al posto dei pixel. FubDraw scrive lì la descrizione chiesta
  all'inserimento o dal pannello.
- **L'ordine di lettura** è l'ordine del documento, in profondità: lo stesso in
  cui si dipinge, e quindi lo stesso che decide che cosa si vede sopra.
  Nessun attributo lo cambia; lo cambia spostare l'elemento fra i suoi
  fratelli.

## 2. Immagini decorative

`aria-hidden` è ammesso soltanto su `image`, coi valori `true` e `false`, con
spazi intorno o senza. Con `true` l'immagine è **decorativa**: un ornamento
che lo screen reader salta, e che non chiede descrizione. `false` vale come
l'attributo assente. Un altro valore, o `aria-hidden` su un altro elemento,
rende l'elemento estraneo (formato della scena, §4).

FubDraw dichiara decorativa un'immagine scrivendo `aria-hidden="true"` e non
toglie un `title` che c'è già.

## 3. Il fondo

S009 confronta un oggetto con ciò che ha sotto, il **fondo**, in un punto.
Ogni lettura percorre gli elementi in ordine di documento, e il fondo di un
punto è fatto di ciò che è dipinto prima dell'oggetto:

1. **la carta:** il `fill` del `rect` con `fub:role="paper"`, con le sue
   opacità, sul bianco; senza carta, o con una carta nascosta o senza
   riempimento, il bianco. Una carta di colore ignoto rende ignoto il fondo;
2. **le forme piene modificabili e visibili** che coprono il punto, composte
   una sull'altra col loro `fill`, `fill-opacity` e le `opacity` dei gruppi:
   rettangoli, ellissi, cerchi, poligoni, polilinee, tracciati e forme
   sintetiche. Un punto sta dentro una forma con la regola `nonzero`, sulla
   sua geometria trasformata nella radice. Un `fill` `none` o un'opacità zero
   non dipingono niente;
3. **le immagini** e le forme di colore ignoto rendono ignoto il fondo, finché
   una forma opaca non lo copre di nuovo: dei loro pixel non si sa niente.

Non contano, come per la carta, il CSS, l'opacità della radice e i blocchi
estranei; né i contorni (`stroke`), né le linee, né i testi, né i tratti a
mano libera, che sono sottili. I colori si compongono in sRGB, come nei
browser, coi canali arrotondati a interi. Il contrasto è quello di WCAG 2,
fra il colore dell'oggetto composto sul fondo e il fondo.

Un `fill` che rimanda a un [campione](scene-format-resources.md#2-le-risorse)
vale il colore del campione, qualunque sia il ripiego: nella carta, nelle
forme del fondo e nell'oggetto. Ogni altra risorsa dà un colore ignoto.

## 4. I controlli

| Codice | Gravità | Che cosa guarda |
|---|---|---|
| S001 | avviso | il disegno senza `title`, o con un titolo vuoto |
| S009 | info | un testo o un tratto a penna che contrasta poco col suo fondo |
| S012 | avviso | un'immagine senza descrizione e non decorativa |
| S013 | info | un testo con una riga sotto i 12 px a grandezza naturale |
| S017 | info | due colori usati come codice che si distinguono soltanto per la tinta |

S009, S012, S013 e S017 guardano soltanto gli elementi modificabili e visibili, ed
escono con lo span dell'elemento. S001 ha lo span del titolo vuoto, se c'è, e
vale anche per un file troncato.

### S009, il contrasto

- **Un testo** si guarda una volta per riga, nel punto d'inizio del suo
  `tspan` (la `x` della riga, o quella del `text`, e la `y` con i `dy` fin lì),
  alzato di 0,35 volte la grandezza dei caratteri, a metà dell'occhio delle
  minuscole: senza i caratteri la larghezza di una riga non si sa, e l'inizio
  sta sempre sul testo, qualunque sia `text-anchor`. Le righe vuote o nascoste
  non si guardano, e nemmeno quelle col `fill` `none` o ignoto.
- **Un testo su tracciato** è una riga sola, e si guarda nel punto di
  `startOffset` lungo il tracciato (una percentuale è una parte della sua
  lunghezza), alzato allo stesso modo dalla parte dei caratteri, a sinistra
  del verso del tracciato. Oltre un capo il punto si ferma al capo; un testo
  su un tracciato lungo zero non si guarda. S013 lo misura come una riga.
- **La soglia di un testo** è 4,5:1, e 3:1 per un testo grande: da 24 px a
  grandezza naturale, o da 14 punti (18,67 px) in grassetto, cioè `bold` o
  `font-weight` da 700 in su. Un testo di grandezza ignota conta come normale.
  Il testo ha S009 se almeno una riga sta sotto la sua soglia, e il dettaglio
  è il contrasto più basso.
- **Un tratto a penna** (`fub:tool="pen"`) si guarda negli estremi dei
  segmenti del contorno, o in 16 di loro presi a distanze uguali
  nell'elenco quando sono di più; i punti di fondo ignoto non contano. Vale il
  contrasto mediano, il più basso dei due di mezzo quando i punti sono pari:
  un tratto che attraversa un riquadro scuro non si legge male per questo. La
  soglia è 3:1. L'evidenziatore non si guarda: non si legge, segna ciò che ha
  sotto.
- **Il dettaglio** è il rapporto troncato a due decimali, mai arrotondato: un
  contrasto di 2,996 si legge `2.99`, non `3.00`.

La tavolozza di Okabe–Ito, che FubDraw offre di partenza, è leggibile anche da
chi non distingue alcuni colori; S009 dice quando un colore, suo o no, sparisce
sul fondo che ha, e S017 quando due colori si distinguono soltanto per la
tinta, che in bianco e nero e per chi non vede le tinte si perde.

### S012, l'immagine senza descrizione

Un `image` modificabile e visibile ha S012 se non è decorativa e non ha un
`title` o un `desc` figlio con del testo che non sia solo spazi. Il codice non
ha dettaglio.

### S013, il testo piccolo

La grandezza di una riga a grandezza naturale è il suo `font-size`, o 16 se
non c'è, moltiplicato per quanto la matrice del testo allunga il verticale:
la radice di `c² + d²`, con `c` e `d` della matrice verso la radice. Le righe
vuote o nascoste non contano. Il testo ha S013 se la sua riga più piccola sta
sotto i 12 px; il dettaglio è quella grandezza, troncata a due decimali.

### S017, i colori che si distinguono soltanto per la tinta

Un grafico, una mappa o uno schema affidano spesso un significato al colore:
una fetta e la sua voce di legenda, i riquadri di una categoria. S017 dice
quando due di quei colori hanno fra loro un contrasto sotto 3:1, la soglia
di WCAG per le parti di un grafico: chi non vede la tinta non sa quale area
va con quale voce.

- **Le aree** sono le forme piene modificabili di cui il colore si sa, un
  colore o un campione, con un'opacità sopra zero e un riquadro con
  larghezza e altezza. Non contano i tratti a penna, l'evidenziatore, i
  testi, le immagini, la carta, le tavole e i contenitori. Una sfumatura, un
  motivo o una campitura, e ogni colore sotto `clip-path`, `mask` o
  `filter`, suo o di un contenitore, non si sanno, come per S009.
- **Il colore di un'area** è il suo, con la sua opacità e quella dei gruppi,
  composto sulla carta, o sul bianco senza carta, coi canali arrotondati.
  Conta la carta soltanto, non ciò che l'area copre: il codice è il colore
  scelto. Su una carta che non si sa un'area trasparente non ha colore.
- **I colori di codice** sono quelli di almeno due aree: un colore usato una
  volta è un ornamento. Con più di 12 colori di codice il disegno è
  un'illustrazione, e S017 tace.
- **Una S017 per colore di codice** che ha con un altro un contrasto sotto
  3:1, sulla sua prima area in ordine di documento. Il dettaglio è
  `#rrggbb #rrggbb r.rr`: il colore, il compagno col contrasto più basso (a
  parità, il primo nel documento) e quel contrasto, troncato come per S009.
