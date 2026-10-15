# Formato della scena, ripetizioni

> **Ambito:** le ripetizioni di un disegno, radiali, a griglia e allo
> specchio: la forma del gruppo, l'originale, le copie e le loro
> trasformazioni, come si contano, come le operazioni le tengono vere e come
> escono nell'export. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/repeat.ts` e
> `crates/fub-scene/src/repeat.rs` per `fub:repeat`, coi casi di
> `apps/client/src/__fixtures__/scene-repeat/cases.json`, che valgono per
> tutte e due; `scene/classify.ts` e `classify.rs`, che leggono allo stesso
> modo; il riepilogo in `scene/analysis.ts` e nel suo gemello Rust; la
> scrittura in `scene/serialize.ts`, le operazioni in `scene/engine.ts`, coi
> vettori di prova da 89 a 93 ([operazioni sulla scena](scene-operations.md),
> §9); l'SVG pulito in `crates/fub-scene/src/export/clean.rs`.

Una parte del [formato della scena](scene-format.md), §4. Una ripetizione
mostra più volte un oggetto: i petali di un fiore intorno al centro, le
sedie di una sala in file, le due metà di un volto. L'oggetto è l'originale,
e ogni altra volta che compare è una copia, che lo mostra com'è: cambiare
l'originale cambia tutte le copie. Le sezioni del formato si citano come
«formato della scena, §N»; quelle di questa pagina col solo numero.

```xml
<g id="o5e6f7a8b" fub:repeat="radial 4 200 200">
  <title>Fiore</title>
  <ellipse id="o6f7a8b9c" cx="200" cy="150" rx="12" ry="30" fill="#cc79a7"/>
  <use id="o7a8b9c0d" transform="matrix(0 1 -1 0 400 0)" href="#o6f7a8b9c"/>
  <use id="o8b9c0d1e" transform="matrix(-1 0 0 -1 400 400)" href="#o6f7a8b9c"/>
  <use id="o9c0d1e2f" transform="matrix(0 -1 1 0 0 400)" href="#o6f7a8b9c"/>
</g>
```

Un petalo e tre copie, girate di un quarto di giro l'una dopo l'altra
intorno a (200, 200). Ogni lettore di SVG disegna il fiore intero.

## 1. La ripetizione

Una ripetizione è un `g` che è un gruppo, non un livello, con
`fub:repeat` scritto in uno di tre modi:

- **`radial <volte> <cx> <cy>`:** l'originale e le copie sono `volte` in
  tutto, da 2 a 100, girati intorno al centro (`cx`, `cy`) di un giro
  diviso in parti uguali;
- **`grid <colonne> <righe> <dx> <dy>`:** colonne e righe da 1 a 100, e
  il loro prodotto da 2 a 1000; ogni colonna sposta di `dx`, ogni riga di
  `dy`;
- **`mirror <x1> <y1> <x2> <y2>`:** l'originale e la sua immagine riflessa
  sulla retta per i due punti, che sono diversi.

Il tipo si scrive esatto, minuscolo, e le parole si separano con gli spazi
di SVG: spazio, tabulazione, a capo, ritorno e avanzamento di pagina. I
conti sono cifre e basta; le coordinate sono numeri di SVG finiti, senza
virgole, nelle coordinate del gruppo, prima del suo `transform`. Un tipo
sconosciuto, un numero di parole sbagliato, un conto fuori dai limiti o una
parola che non è un numero lasciano un gruppo qualunque: le sue copie
restano `use` estranei (formato della scena, §8).

`fub:repeat` su un livello o su un collegamento non dice niente: i suoi
`use` restano estranei.

## 2. L'originale

Gli originali sono i figli modificabili della ripetizione che hanno un id,
titoli e descrizioni esclusi: una forma, un testo, un gruppo, un'istanza di
un [simbolo](scene-format-symbols.md). Una copia non è mai un originale.
FubDraw ripete un oggetto solo; per ripeterne più d'uno li mette prima in
un gruppo, che diventa l'originale.

L'originale si modifica, si sposta e cresce come ogni oggetto: il centro, i
passi e l'asse non dipendono da lui, e le copie lo seguono senza che il
file cambi altrove. Un originale nascosto nasconde le sue copie.

## 3. Le copie

Una copia è un `use` figlio della ripetizione che rimanda a un originale
suo fratello con `href` o con `xlink:href`, uno solo dei due, nella forma
`#id`. Di SVG ha soltanto `id` e `transform`, e per figli soltanto
`title`, `desc` e spazio. Un'opacità, un `display`, uno `style`, una
posizione o un riempimento la rendono estranea: una copia è l'originale
un'altra volta, uguale, e FubDraw la riscrive quando la ripetizione cambia.

Non è una copia un `use` verso un originale di un'altra ripetizione, verso
un cugino, verso un'altra copia o verso un oggetto fuori dal gruppo. Una
copia può stare prima o dopo il suo originale; FubDraw le scrive dopo, così
si disegnano sopra.

Una copia non è un oggetto: non si sceglie da sola sul foglio e non sta
nell'albero degli oggetti, dove la ripetizione è un oggetto solo.

## 4. Le trasformazioni delle copie

Il `transform` di ogni copia viene soltanto da `fub:repeat`, nelle
coordinate del gruppo, e FubDraw scrive le copie in quest'ordine:

- **radiale:** la copia `k`, da 1 a `volte − 1`, gira di `k` parti del giro
  intorno al centro, in senso orario sullo schermo come `rotate` di SVG.
  Con `c` e `s` coseno e seno dell'angolo è
  `matrix(c s −s c  cx − c·cx + s·cy  cy − s·cx − c·cy)`, esatta sui quarti
  di giro;
- **griglia:** per righe, poi per colonne, salvo la prima cella, che è
  l'originale: la cella di colonna `i` e riga `j` sposta di
  (`i·dx`, `j·dy`);
- **specchio:** la riflessione sull'asse. Con (`ux`, `uy`) la direzione
  dell'asse lunga 1, `a = 2·ux² − 1`, `b = 2·ux·uy` e `d = 2·uy² − 1`, è
  `matrix(a b b d  x1 − (a·x1 + b·y1)  y1 − (b·x1 + d·y1))`.

Il lettore prende il `transform` di ogni copia com'è scritto e non controlla
che vada con `fub:repeat`: ciò che è scritto è ciò che si vede, anche in un
programma che non conosce le ripetizioni. `fub:repeat` serve a FubDraw per
rifare le copie quando la ripetizione cambia.

## 5. Il riepilogo e l'accessibilità

- **Il conto** degli oggetti (formato della scena, §9) conta l'originale
  una volta, e le copie no: un fiore di dodici petali ha una forma.
- **Il riquadro** del disegno comprende ogni copia: il riquadro
  dell'originale, portato dal `transform` della copia nelle coordinate del
  gruppo. Le copie di un originale che contiene un'altra ripetizione
  portano anche le copie di quella.
- **Il contrasto** (S009) si misura sull'originale dov'è; un testo sopra
  una copia ha un fondo che non si sa, come sopra un'istanza, e S009 tace
  ([accessibilità](scene-format-accessibility.md)).
- **In un simbolo** una ripetizione si conta nelle coordinate del simbolo,
  come il resto del suo contenuto.

## 6. Le operazioni

Le regole che tengono vere le ripetizioni ([operazioni sulla
scena](scene-operations.md)):

- **Nessuna copia resta senza il suo originale.** Togliere l'originale,
  spostarlo fuori dal gruppo, o togliergli o cambiargli l'id con `ident`,
  mentre una copia lo usa è `in-use`; così togliere `fub:repeat` a un
  gruppo che ha copie, o scriverne uno che non si legge.
- **In un `batch` la ripetizione e l'originale vengono prima delle copie:**
  un `use` che non sarebbe una copia è `invalid-elem`, come ogni elemento
  estraneo nuovo.
- **Un `use` estraneo non diventa una copia** perché il gruppo diventa una
  ripetizione o un fratello diventa il suo originale: è `duplicate-id`, come
  per un simbolo che arriva.
- **Una copia** cambia soltanto il suo `transform`, e si sposta soltanto fra
  i figli della sua ripetizione: fuori sarebbe estranea, ed è
  `invalid-elem`.
- **La ripetizione intera** si toglie e si sposta come un gruppo; in un
  `batch` si tolgono le copie e poi l'originale.

## 7. La scrittura

FubDraw scrive gli attributi nell'ordine canonico (formato della scena,
§7): di una ripetizione `fub:repeat` subito dopo l'id, con i numeri a due
decimali; di una copia `transform` prima di `href`, con i numeri di
`matrix` a quattro decimali.

## 8. L'export

- **Nell'SVG pulito** ([export](scene-format-export.md)) le copie restano
  `use` e `fub:repeat` se ne va con gli altri attributi `fub:*`. I numeri
  dell'originale tengono tutti i decimali, perché si vede anche dove lo
  portano le copie.
- **Il PNG, il JPEG e il PDF** disegnano ogni copia, come un browser.

## 9. Lettori più vecchi

Un lettore che non conosce le ripetizioni vede un gruppo con un attributo
`fub:*` che non conosce, e le copie come `use` estranei: li conserva byte
per byte e li disegna come strati immagine, che si vedono e non si
modificano. La versione resta 1.
