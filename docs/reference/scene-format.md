# Formato della scena

> **Ambito:** i disegni di FubDraw, cioè i file SVG che Fub indicizza con il
> formato `svg` e modifica con la superficie spaziale. Versione 1.
> **Fonti autorevoli:** `crates/fub-scene/`, `crates/fub-format-svg/` e le
> fixture generate in `apps/client/src/__fixtures__/scene/`.

Come Fub legge e scrive i disegni: SVG validi per qualunque visualizzatore, con
pochi attributi in più nel namespace `fub`. È il contratto comune di
`fub-scene`, del provider `svg` e della superficie TypeScript della shell; il
perché sta nell'[ADR 0203](../decisions/0203-superfici-spaziali.md). Come la
superficie cambia un disegno sta nelle [operazioni](scene-operations.md). I `§`
dei commenti nel codice sono le sezioni di questa pagina, tranne nel motore
delle operazioni, che cita quelle dell'altra.

## 1. Principi

1. **Un SVG valido.** Un disegno si apre in un browser o in un altro editor; i
   dati in più stanno in attributi `fub:*` che gli altri ignorano.
2. **La sorgente è autorevole.** Il modello è una vista del testo.
3. **Conservazione.** Ciò che Fub non capisce resta identico byte per byte.
4. **Diff minimo.** Una modifica riscrive solo gli elementi toccati.
5. **Dati grezzi.** L'inchiostro conserva i campioni della penna.

## 2. Documento

- **Codifica:** UTF-8, con il BOM conservato se c'è. Una dichiarazione
  `<?xml?>` con un'altra codifica, confrontata senza badare alle maiuscole, apre
  il documento in sola lettura: un altro lettore vedrebbe altri caratteri.
- **Buona forma:** il file è XML 1.0 ben formato, con i namespace riconosciuti
  dall'URI e non dal prefisso. Un file malformato, o con una radice che non è
  `svg` nel namespace SVG, non è una scena: il lettore restituisce l'errore con
  il byte esatto, BOM compreso. Un riferimento a un'entità mai dichiarata rende
  il file malformato. Le entità interne si espandono fino a 16 livelli e 1 MiB
  di testo; oltre, il file è malformato.
- **Terminatori di riga:** quelli non toccati restano identici, anche misti,
  e le righe nuove usano il prevalente (operazioni sulla scena, §6).
- **Disegno ed estraneo:** un documento **FubDraw** ha sulla radice
  `fub:version="1"`. Senza quell'attributo il documento è **estraneo**: la
  superficie lo mostra come immagine inerte, con il comando «Modifica» che lo
  adotta aggiungendo `xmlns:fub` e `fub:version` alla radice.
- **Unità:** un'unità utente vale un pixel CSS a zoom 100%. L'unità mostrata
  e le guide sono `fub:units` e `fub:guides`: [unità e guide](scene-format-rulers.md).

Radice di un documento nuovo:

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">
```

- `viewBox` copre il contenuto. Quando un oggetto ne esce, si allarga a passi
  di 256 unità con l'operazione `page`; non si restringe mai da solo, e un
  comando della superficie lo ricalcola. `width` e `height` valgono quanto le
  dimensioni del `viewBox`.
- I figli della radice, in quest'ordine:
  1. `<title>`: il titolo, cambiato con l'operazione `meta`;
  2. `<desc>`, facoltativo, poi la `defs` delle [risorse](scene-format-resources.md);
  3. la carta: `<rect id="fub-paper" fub:role="paper" …/>`, con la stessa
     geometria del `viewBox`, `fill="#ffffff"`, bloccata e non selezionabile.
     Cambia solo con l'operazione `page`, insieme al `viewBox`. Un documento
     adottato con «Modifica» può non averla;
  4. i livelli.

## 3. Livelli e gruppi

- **Livello:** un `<g>` figlio della radice con `fub:layer="Nome"` (al massimo
  80 caratteri) e id che inizia con `l`; un documento nuovo ha «Livello 1».
- **Gruppo:** un `<g>` senza `fub:layer`, dentro un livello o un altro gruppo.
- **Blocco e visibilità:** livelli, gruppi, collegamenti e forme si bloccano
  con `fub:locked="true"`, che li toglie dalla scelta sul foglio e ferma ciò
  che contengono; `display="none"` li nasconde, anche negli altri programmi.
- **Elementi fuori da ogni livello**, come negli SVG estranei adottati:
  appartengono a un livello implicito alla radice e non si spostano da soli.

## 4. Elementi modificabili

| Elemento | Geometria | Uso |
|---|---|---|
| `path` con `fub:tool` `pen` o `highlighter` | `d`, `fub:ink`, `fub:brush` | tratto a mano libera: contorno pieno, `fill` senza `stroke` (§5) |
| `path` con `fub:shape` | `d`, `fub:geom` | forma sintetica: freccia, poligono regolare, stella, spessore variabile (§6) |
| `path` | `d` | tracciato vettoriale |
| `rect` | `x y width height rx ry` | rettangolo |
| `ellipse` | `cx cy rx ry` | ellisse |
| `circle` | `cx cy r` | letto e modificato; la superficie crea ellissi |
| `line` | `x1 y1 x2 y2` | linea |
| `polyline`, `polygon` | `points` | letti e modificati |
| `text` con figli `tspan` | `x y`; ogni riga è un `tspan` con `x` e `dy`, e i suoi [pezzi](scene-format-text.md) | testo |
| `image` | `x y width height href preserveAspectRatio` | immagine incorporata o del vault |
| `g` | — | livello o gruppo |
| `a` | `href` | collegamento a un documento del vault |
| `title`, `desc` | — | descrizione accessibile, anche del singolo oggetto; il primo `title` di un oggetto è il suo nome |
| `defs` della radice | `id` | le [risorse](scene-format-resources.md): sfumature, motivi, marcatori, ritagli, maschere e filtri |

**Attributi di presentazione ammessi:**

- riempimento e contorno: `fill`, `fill-opacity`, `stroke`, `stroke-width`,
  `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`;
- visibilità e trasformazione: `opacity`, `display`, `transform`;
- testo: `font-family`, `font-size`, `font-weight`, `font-style`, `letter-spacing`,
  `text-decoration`, `text-anchor`, e `dy` sui `tspan` ([testo](scene-format-text.md));
- identità: `id`, più gli attributi `fub:*` di questa pagina;
- accessibilità: `aria-hidden` su `image`, `true` o `false`; con `true`
  l'immagine è decorativa ([accessibilità](scene-format-accessibility.md)).

**Valori:**

- **Lunghezze e coordinate** (`x y dy cx cy r width height rx ry x1 y1 x2 y2`,
  `stroke-width`, `font-size`, le voci di `stroke-dasharray`): un numero SVG,
  cioè segno facoltativo, cifre con o senza decimali ed esponente facoltativo
  (`-1.5`, `.5`, `1e3`). Il numero può avere un'unità assoluta (`px`, `in`,
  `cm`, `mm`, `Q`, `pt`, `pc`), che si converte in unità utente con i rapporti
  CSS: 1in = 96 unità = 2,54cm = 72pt = 6pc; 1Q = 0,25mm. Percentuali, unità
  relative (`em`, `ex`, `rem`, `ch`, `vw`, `vh` e simili), parole chiave e
  `calc()` rendono l'elemento estraneo: il loro valore dipende da un contesto
  che la superficie non ricostruisce. Un valore con unità si copia com'è; se
  l'elemento cambia geometria, il valore nuovo si scrive in unità utente.
  `width`, `height`, `r`, `rx`, `ry` e `stroke-width` negativi rendono
  l'elemento estraneo.
- **`d`:** la grammatica dei path di SVG 2, completa: comandi assoluti e
  relativi, comandi impliciti dopo il primo, archi con i flag attaccati
  (`a1 1 0 011 1`), numeri compatti come `1.5.5`. Un `d` malformato rende
  l'elemento estraneo, perché i browser lo disegnano solo fino al primo
  errore. Un `d` vuoto è valido e non disegna nulla.
- **`points`:** coppie di numeri SVG separate da spazi o virgole; un numero
  dispari di valori rende l'elemento estraneo.
- **`stroke-dasharray`:** `none` oppure una lista di lunghezze non negative.
- **Colori:** si scrivono `#rrggbb` minuscolo oppure `none`. In lettura si
  accettano anche `#rgb` e i nomi CSS, normalizzati solo se l'elemento viene
  modificato. Ogni altra forma (`rgb()`, `hsl()`, `currentColor`,
  `transparent`, `inherit`) rende l'elemento estraneo.
- **Opacità:** un numero SVG da 0 a 1, senza percentuale.
- **Parole chiave:** `display` ammette `none` e `inline`; `stroke-linecap`
  `butt`, `round` e `square`; `stroke-linejoin` `miter`, `round` e `bevel`;
  `font-weight` `normal`, `bold` e le centinaia da `100` a `900`; `font-style`
  `normal`, `italic` e `oblique`; `text-anchor` `start`, `middle` e `end`; `preserveAspectRatio` la grammatica
  di SVG (`none`, oppure un allineamento come `xMidYMid` seguito
  facoltativamente da `meet` o `slice`). Ogni altro valore, compreso
  `inherit`, rende l'elemento estraneo.
- **`transform`:** in lettura qualunque lista di funzioni SVG (`matrix`,
  `translate`, `scale`, `rotate`, `skewX`, `skewY`), separate da spazi o
  virgole; una lista malformata rende l'elemento estraneo. In scrittura una
  sola `matrix(a b c d e f)` con al massimo 4 decimali, omessa se è
  l'identità: spostare o ruotare non riscrive la geometria.
- **`font-family`:** si scrivono `Inter, sans-serif`, `Literata, serif` o
  `JetBrains Mono, monospace`, i caratteri distribuiti con Fub. Altri valori
  sono ammessi in lettura.
- **`href` di `a`:** percorso di un documento del vault con la regola dei link
  di Fub (`resolve_against` in `crates/fub-abi/src/rules/path.rs`): relativo
  alla cartella del disegno, oppure dalla radice del vault se comincia con
  `/`. Niente schemi.
- **`href` di `image`:** data URI di un'immagine raster (`image/png`,
  `image/jpeg`, `image/webp`, `image/gif`), oppure un percorso di un'immagine
  del vault, con la regola di `href` di `a`, che la superficie mostra con la
  risoluzione dei media della shell. Un'immagine remota non si carica mai: al
  suo posto c'è un segnaposto.
- **`xlink:href`:** equivale a `href`, con le stesse regole, solo su `image` e
  `a`. Se un elemento li ha tutti e due vale `href`, come in SVG 2.

### Regola di classificazione

Un elemento è **modificabile** se il suo tag è in tabella, se tutti i suoi attributi
e valori rientrano in questa sezione, e se nessun valore contiene `url(`, se non
un riferimento a una [risorsa](scene-format-resources.md) modificabile.

- Per `g`, `a` e la `defs` della radice la regola vale per ogni figlio da sé: un
  livello con un figlio estraneo resta modificabile e contiene un blocco estraneo.
- Per gli altri elementi l'elemento è un'unità con i suoi figli. Un `text` è
  modificabile solo se tutti i suoi figli sono `tspan` ammessi ([testo](scene-format-text.md)).
- `title` e `desc` sono figli ammessi di qualunque elemento modificabile.
- I nodi di testo fatti solo di spazi fra gli elementi non sono né modificabili
  né estranei: si conservano e non contano per la classificazione.
- Gli attributi in namespace diversi da SVG, `fub` e `xlink`, come
  `inkscape:*` o `sodipodi:*`, non rendono un elemento estraneo: si conservano
  così come sono, anche quando l'elemento viene riscritto.
- La radice `<svg>` non si classifica: è il documento. I suoi attributi si
  conservano e si copiano negli strati estranei (§8), ma non rendono estraneo
  nulla; tra loro decide solo `fub:version` (§2, §10).
- Un attributo SVG fuori dall'elenco, compresi i gestori di evento come
  `onclick`, rende l'elemento estraneo.

Il lettore Rust e quello TypeScript applicano allo stesso modo questi dettagli:

- **Maiuscole:** parole chiave, nomi di colore e nomi delle funzioni di
  `transform` distinguono maiuscole e minuscole, quindi `fill="RED"` rende
  l'elemento estraneo. Si piegano solo le grammatiche ASCII che lo prevedono:
  gli schemi degli URL, i data URI, `url(` e i nomi dei gestori `on*`.
- **Numeri:** un numero vuole almeno una cifra dopo il punto: `1.` non è un
  numero, come nei browser. La regola vale per ogni numero del formato, anche
  in `d`, `points`, `transform` e `fub:brush`. Un numero della geometria che
  non sta in un `float` a 32 bit non è un numero, come nei browser; quelli di
  `fub:brush` vanno a `getStroke` e stanno in doppia precisione.
- **`url(`:** si cerca negli attributi senza prefisso e in quelli `xlink`,
  senza badare a maiuscole e minuscole. Gli attributi degli altri namespace si
  conservano e non si interpretano.
- **Testo:** un `title` o un `desc` con una sezione CDATA è estraneo, e così un
  `text` con testo fuori dai `tspan`. I riferimenti predefiniti (`&amp;` e gli
  altri quattro) e quelli numerici sono testo; un riferimento a un'entità
  dichiarata nel DTD rende estraneo l'elemento che lo contiene.
- **Profondità:** un `g` o un `a` oltre 128 livelli di annidamento è estraneo
  con tutto il suo contenuto, perché ogni voce porta il percorso intero.

Ciò che non è modificabile è **estraneo** (§8).

## 5. Tratti a mano libera

```xml
<path id="o7k2m9x4q" fub:tool="pen" fub:at="2026-10-01T09:20:31.250Z" fub:brush="pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0" d="M120.5 30.2 Q121 30.1 …" fill="#0072b2" fub:ink="1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8"/>
```

L'evidenziatore usa `fub:tool="highlighter"`, `fill-opacity="0.4"` e, per
default, il giallo.

### `fub:ink`

```text
ink      = version SP scale SP channels 1*(SP sample)
version  = "1"
scale    = "s" ("10" / "100")
channels = "c" "xy" *ALPHA  ; ogni lettera al massimo una volta
sample   = int *("," int)      ; un valore per canale, nell'ordine di channels
int      = ["-"] 1*DIGIT
```

- **Campioni:** il primo campione è assoluto; ogni campione successivo è la
  differenza dal precedente, canale per canale.
- **`x`, `y`:** coordinate locali dell'elemento, prima del suo `transform`,
  moltiplicate per la scala e arrotondate. Con `s100` l'errore è al massimo
  0,005 unità.
- **Arrotondamento:** ogni valore si quantizza con `floor(v × scala + 0,5)`,
  la stessa regola in Rust e in TypeScript; i delta si calcolano sui valori già
  quantizzati.
- **`p`:** pressione × 255, arrotondata. Se manca (mouse, tocco), il pennello
  simula la pressione e `fub:brush` contiene `sim=1`.
- **`t`:** millisecondi dal primo campione, che vale 0.
- **`a`, `z`:** altitudine (0–90°) e azimut (0–359°, in senso orario
  dall'asse x della scena) della penna, se il dispositivo li dà; sempre insieme.
- **Canali sconosciuti:** una lettera diversa da `p`, `t`, `a` e `z`. Il
  tratto resta valido e si conserva, ma non si può ridisegnare (S010).
- **Interi:** ogni valore, assoluto o differenza, sta entro 2⁵³ − 1 in valore
  assoluto, l'ultimo intero che JavaScript rappresenta esatto. Chi scrive non
  registra un campione che lo supera; chi legge un valore più grande produce
  S004. `t` può ripetersi o tornare indietro: non entra nel contorno.
- **Inchiostro non valido:** un `fub:ink` che non rispetta la grammatica o i
  limiti produce S004, e così un `path` con `fub:tool="pen"` o `"highlighter"` a
  cui manca `fub:ink` o `fub:brush`. Il tratto resta un elemento modificabile ma
  non si ridisegna: si sposta, si trasforma, si ricolora e si elimina, e `d` si
  usa così com'è. Il documento resta modificabile.
- **Limiti:** al massimo 10 000 campioni e 512 KiB per `fub:ink`. Chi scrive
  divide il tratto al primo dei due limiti; l'ultimo campione del primo tratto
  è il primo del secondo. `d` non ha un limite proprio: lo limita la
  dimensione del file (§11).
- **Tocchi:** un tocco della penna si registra con due campioni, l'appoggio e
  il rilascio, perché con un solo campione `getStroke` disegna un trattino
  obliquo invece di un punto. Un tratto di un solo campione resta valido.

### `fub:brush`

`pf1` seguito da coppie `chiave=valore` separate da spazi:

- `size`: spessore in unità;
- `thinning` (−1…1), `smoothing` (0…1), `streamline` (0…1);
- `taperStart`, `taperEnd`: assottigliamento in unità, 0 = nessuno;
- `capStart`, `capEnd` (0 o 1);
- `sim` (0 o 1): pressione simulata.

`pf1` indica l'algoritmo `getStroke` di `perfect-freehand` 1.x, fissato alla
1.2.3, con queste opzioni e `last: true` per i tratti conclusi. La pressione
passata a `getStroke` è `p / 255`.

- **Valori:** i numeri seguono la grammatica di §4 (`1.` non è un numero) e si
  scrivono senza arrotondare, nella forma più corta che si rilegge identica.
  Una chiave nota assente prende il valore predefinito di `getStroke`:
  `size=16`, `thinning=0.5`, `smoothing=0.5`, `streamline=0.5`,
  `taperStart=0`, `taperEnd=0`, `capStart=1`, `capEnd=1`, `sim=1`.
- **Chiavi sconosciute:** si conservano nell'ordine, anche ripetute, e si
  ignorano.
- **Pennello non valido:** un `fub:brush` che non comincia con `pf1`, una
  chiave nota ripetuta o con un valore fuori dall'intervallo producono S004
  come l'inchiostro non valido: il tratto non si ridisegna.
- **Campioni:** `d` si calcola dai campioni quantizzati, cioè dagli interi di
  `fub:ink` divisi per la scala, mai dai valori del dispositivo. Così chi
  ricalcola `d` dal file ottiene la stessa stringa di chi l'ha scritto.
- **Contorno:** i vertici di `getStroke` si arrotondano ai centesimi con la
  regola di §7, e due vertici consecutivi uguali contano una volta. Il
  percorso comincia con `M` sul punto medio fra l'ultimo vertice e il primo,
  prosegue con `Q` vertice e punto medio successivo per ogni vertice, e si
  chiude con `Z`. I punti medi si calcolano sugli interi arrotondati, con
  `floor((a + b + 1) / 2)`. Sotto i tre vertici distinti `d` è vuoto.
- **Riempimento:** il contorno di un tratto breve si sovrappone a sé stesso,
  quindi si riempie con la regola `nonzero`, quella predefinita di SVG.
- **Motori diversi:** le funzioni di `Math` possono differire nell'ultima
  cifra binaria fra motori JavaScript: `d` lo ricalcola chi possiede il
  documento, e nessuno confronta i `d` calcolati da motori diversi.

Chi non conosce l'algoritmo usa `d` così com'è. `d` si riscrive solo quando
cambiano `fub:ink` o `fub:brush`: spostare, scalare o ruotare cambia solo
`transform`.

### `fub:at`

Istante d'inizio del tratto in ISO 8601 UTC con i millisecondi. È facoltativo:
si scrive per default e si può disattivare. Serve a riprodurre l'ordine e il
ritmo della scrittura. Un tratto scritto su un altro dispositivo porta l'ora
dell'orologio di chi possiede il documento, corretta con lo scarto stimato.

## 6. Forme sintetiche

Una forma sintetica è un `path` con `fub:shape` e `fub:geom`; `d` si rigenera
dalla geometria. Poligono regolare e stella: [poligoni e stelle](scene-format-shapes.md);
il contorno che si allarga e si stringe: [spessore variabile](scene-format-width.md).

- **Freccia:** `fub:shape="arrow"`, `fub:geom="x1 y1 x2 y2"`. `d` contiene
  l'asta e la punta aperta: `M x1 y1 L x2 y2 M hx1 hy1 L x2 y2 L hx2 hy2`.
  Attributi: `fill="none"`, `stroke-linecap="round"`,
  `stroke-linejoin="round"`. La punta è lunga 3 × `stroke-width` + 6 unità, e
  ogni lato forma 30° con l'asta.
- **Forma sconosciuta:** un `fub:shape` sconosciuto, o un `fub:geom` fuori
  dalla grammatica della sua forma, come una freccia senza quattro numeri SVG,
  è un tracciato normale: la geometria si legge da `d`, gli attributi restano.

## 7. Identità e serializzazione canonica

### Id

- Oggetti: `o` seguito da 8 caratteri base36 casuali. Livelli: `l` seguito da
  8 caratteri, risorse `r`. Carta: `fub-paper`; `defs` delle risorse: `fub-defs`.
- Un id è unico nel documento: un id casuale già usato si rigenera.
- Un id esistente cambia solo se lo si chiede, dagli attributi del livello
  Esperto. La superficie aggiunge un id solo agli elementi che crea o modifica.
- Un documento con id duplicati si apre in sola lettura, con l'errore S003.

### Scrittura canonica

Vale per ogni elemento creato o modificato. Il tag dell'elemento toccato si
riscrive con l'ordine canonico degli attributi, ma i valori non modificati si
copiano così come sono: un `set` di `transform` non arrotonda le coordinate e
non converte `d`. Solo i valori nuovi seguono le regole sui numeri.

1. **Righe:** un elemento per riga. Un elemento senza figli si chiude con
   `/>`, salvo gruppi e livelli, che restano in forma aperta; i figli stanno
   nelle righe seguenti, rientrati di due spazi in più. Il testo dei `tspan`
   sta sulla stessa riga del tag, coi pezzi della riga.
2. **Ordine degli attributi:**
   1. `id`;
   2. `fub:layer`, `fub:role`, `fub:tool`, `fub:shape`, `fub:geom`,
      `fub:locked`, `fub:at`, `fub:brush`;
   3. geometria: `x y dy cx cy r width height rx ry x1 y1 x2 y2 points d`;
   4. presentazione: `fill fill-opacity stroke stroke-width stroke-opacity stroke-linecap
      stroke-linejoin stroke-dasharray opacity display font-family font-size font-weight
      font-style letter-spacing text-decoration text-anchor preserveAspectRatio`;
   5. `transform`, poi `href`;
   6. gli attributi `fub:*` sconosciuti e quelli di altri namespace,
      nell'ordine originale;
   7. `fub:ink`, che è il più lungo.
3. **Numeri:** al massimo 2 decimali per la geometria e 4 per `matrix`, per
   il rapporto di una stella e per le posizioni del profilo di uno spessore
   variabile, senza zeri finali, senza esponente; `-0` si scrive `0`. Si
   arrotonda con `floor(v × 10ⁿ + 0,5)` in doppia precisione, la stessa regola
   in Rust e in TypeScript, e si scrivono le cifre esatte dell'intero che ne
   risulta, anche oltre 2⁵³.
4. **`d`:** comandi assoluti, ciascuno attaccato alle sue coordinate e
   separato dal successivo da uno spazio: `M10 20 L30 40 Z`.
5. **Escape:** negli attributi `&amp;`, `&lt;`, `&gt;`, `&quot;`, più `&#9;`,
   `&#10;` e `&#13;` per tabulazioni e a capo, che altrimenti il parser
   trasformerebbe in spazi; fra apici singoli anche `&#39;`. Nel testo di
   `tspan`, `title` e `desc` `&amp;`, `&lt;` e `&gt;`, più `&#13;`, che il
   parser trasformerebbe in un a capo.
6. **Inserimento:** un elemento nuovo va sulla riga dopo il fratello che lo
   precede, oppure come prima riga dentro il genitore. Il rientro è quello del
   fratello, oppure quello del genitore più due spazi.
7. **Resto del file:** i nodi non toccati, e gli spazi fra loro, restano
   identici byte per byte.

## 8. Contenuto estraneo

- **Cos'è:** ogni nodo non modificabile secondo §4. Comprende commenti,
  istruzioni di elaborazione, sezioni CDATA, la dichiarazione `<?xml …?>` e i
  riferimenti a entità.
- **`<!DOCTYPE>`:** un documento che lo contiene si apre solo in lettura.
- **Conservazione:** il testo resta identico. Un blocco estraneo non viene
  riordinato, salvo con un `move` esplicito.
- **Visualizzazione:** in lettura il documento intero è un `<img>` da blob; in
  disegno ogni sequenza contigua di nodi estranei è uno strato `<img>`, con gli
  attributi della radice, i `<defs>` e `<style>` del file e i tag di apertura
  dei `g` antenati, nell'ordine del documento. Nessun nodo estraneo entra nel
  DOM vivo, e gli script non partono: si conservano e producono S005.
- **Operazioni ammesse:** `remove` e `move`.
- **Caratteri:** in un `<img>` da blob il testo usa la famiglia generica di
  ripiego di `font-family`; l'export carica i caratteri distribuiti con Fub.

## 9. Modello per l'indice

`fub-format-svg` produce il modello del documento di Fub
([architettura](../architecture/document-model.md)):

| Sorgente | Modello |
|---|---|
| `<title>` della radice | heading di livello 1 e voce di `outline` |
| `<desc>` della radice | paragrafo |
| ogni `text`, in ordine di documento | paragrafo, con le righe unite da uno spazio |
| `a` con `href` verso il vault | collegamento: backlink e grafo valgono anche per i disegni |
| `image` con percorso del vault | collegamento con `embed` (le immagini in data URI si contano soltanto) |
| documento intero | blocco custom `fub.scene.summary` |
| titolo, descrizione e testi | campo `text`, per la ricerca |

L'indice legge il documento intero, contenuto estraneo compreso: un disegno di
Inkscape o un diagramma di sequenza di Mermaid si cercano per i loro testi.
Sono testi solo gli elementi `text` di SVG: le etichette XHTML dentro
`foreignObject`, come quelle dei diagrammi di flusso di Mermaid, non entrano
nell'indice. In un `text` ogni figlio elemento è una riga, e i pezzi ne fanno parte; i `tspan`
di un carattere ciascuno, come li scrive Illustrator, escono separati da spazi.
Gli spazi XML di titolo, descrizione e testi si riducono a uno.

Il blocco `fub.scene.summary` porta in `attrs`:

- `version`, `foreign`, `truncated`;
- `layers`: nomi dei livelli;
- `counts`: tratti, forme, testi, immagini, collegamenti, blocchi estranei;
- `ink`: campioni e durata totale;
- `bbox`: il rettangolo degli elementi modificabili visibili, in coordinate
  della radice dopo ogni `transform`, senza la carta né lo spessore del tratto;
  i tracciati contano per i punti estremi delle curve, i testi per i punti
  d'ancoraggio; i valori si arrotondano al centesimo (§7);
- `sections`: il titolo, se non è vuoto. È la sola sezione nominata del
  disegno, ed è il disegno intero: `![[disegno#Titolo]]` lo incorpora tutto, e
  un altro nome non è una sezione.

Chi non conosce il blocco legge i suoi figli: titolo, descrizione e testi.

**Span e annidamento.** Gli span sono in byte UTF-8 e indicano l'elemento
nella sorgente: `reveal` dalla ricerca o da un backlink seleziona l'oggetto. Il
riepilogo va dal primo byte dopo il BOM alla fine del file e contiene gli altri
blocchi, annidati come gli elementi nel file. Un collegamento attorno a testi o
immagini li porta come etichetta; uno dentro un `text` sta nel paragrafo di
quel testo. Oltre 128 livelli di elementi indicizzati annidati, i più profondi
si appendono al 128º senza perdersi.

**Collegamenti.** Il percorso è il testo dell'URL: valore dell'attributo con
gli spazi ai bordi tolti, frammento compreso. Il contesto di un backlink è
l'etichetta del collegamento o, senza etichetta, il testo che lo contiene,
fino a 220 caratteri.

**Errori.** Un file che non è una scena (§2) non si legge: il provider
restituisce l'errore con il byte, e l'apertura del vault lo mette fra gli
scarti senza fermarsi. Un file oltre 20 MiB porta all'indice solo titolo,
descrizione e riepilogo, con `truncated: true` (§11).

### Anteprima, documento nuovo e riferimenti

- **`render_html`** emette solo un segnaposto `figure` con classe `fub-scene`,
  `data-embed-kind="scene"`, `data-embed-doc` con l'id del documento e una
  `figcaption` che contiene il titolo; mai un `<img>` né un URL di risorsa:
  l'immagine la mette la shell con la risoluzione dei media. Senza titolo la
  didascalia è il nome del file, perché è il nome accessibile della figura.
- **`serialize`** genera un documento nuovo con radice, titolo, carta e
  «Livello 1», in forma canonica, con righe LF e a capo finale. Il titolo è il
  primo heading di livello 1 del modello, oppure il nome del file, su una riga
  sola e senza i caratteri che XML 1.0 non ammette. L'id del livello viene dal
  nome del documento, con FNV-1a a 64 bit, perché un provider è una funzione
  pura. Il documento si rilegge come scena modificabile prima di uscire.
- **`rewrite_links`** riscrive, quando la destinazione cambia nome, solo i byte
  del valore di `href` di `a` e `image`, virgolette escluse, con gli escape di
  §7. Un `xlink:href` con lo stesso URL accanto a `href` si riscrive insieme,
  perché un lettore SVG 1.1 legge quello. Ogni valore scritto si rilegge con
  `fub-scene` e deve dare il percorso chiesto; un nome il cui primo segmento
  sembra uno schema (`nota:1.md`) prende `./` davanti. Una richiesta che non
  corrisponde a un collegamento della sorgente è un errore.
- **`format_link`** scrive un percorso del vault relativo alla cartella del
  disegno, con il frammento, già escapato per stare fra virgolette doppie. Un
  `image` si scrive come un `a`, e l'etichetta non conta. Wikilink e URL non si
  scrivono in un disegno; un percorso fuori dal vault è un errore.

## 10. Versioni e compatibilità

- `fub:version` è un intero positivo scritto in cifre decimali. Una versione
  maggiore di 1 apre il documento in sola lettura con S007, anche quando le
  cifre non stanno in 32 bit. Un valore che non è un intero positivo (`0`,
  `1.0`, `+1`, vuoto) apre il documento in sola lettura senza diagnostica.
- Gli attributi `fub:*` sconosciuti si conservano, anche sugli elementi
  riscritti (§7, punto 2).
- Un tratto con canali di `fub:ink` sconosciuti non si può ridisegnare: si
  sposta o si elimina soltanto (S010, informativo).
- Una nuova versione può aggiungere elementi, attributi o canali. Non può
  cambiare il significato di quelli esistenti.

## 11. Limiti

| Limite | Valore | Oltre il limite |
|---|---|---|
| Dimensione del file per la modifica | 20 MiB | sola lettura |
| Elementi per la modifica | 50 000 | sola lettura |
| Dimensione indicizzata | 20 MiB | il provider indicizza titolo, descrizione e riepilogo, con `truncated: true` |
| Immagine incorporata | 5 MiB | l'editor propone di ridurla |
| Campioni per tratto | 10 000 | il tratto si divide |
| `fub:ink` per tratto | 512 KiB | il tratto si divide; letto da un file, S004 |
| Risorse modificabili | 10 000 | il documento si modifica, ma non ne riceve altre |

## 12. Diagnostica

`fub-scene` calcola questi controlli; i dettagli seguono la tabella.

| Codice | Gravità | Significato |
|---|---|---|
| S001 | avviso | manca `<title>`: il disegno non ha descrizione accessibile |
| S002 | info | il documento contiene blocchi estranei |
| S003 | errore | id duplicato |
| S004 | errore | `fub:ink` o `fub:brush` non rispettano la grammatica o i limiti: il tratto non si ridisegna |
| S005 | avviso | contenuto attivo conservato ma non eseguito (script, gestori di evento, `href` con schema `javascript:`) |
| S006 | avviso | immagine incorporata oltre il limite |
| S007 | info | versione del formato più recente di quella supportata |
| S008 | info | `<!DOCTYPE>` presente: sola lettura |
| S009 | info | un testo o un tratto a penna contrasta poco col fondo: sotto 4,5:1 un testo, 3:1 un testo grande o un tratto |
| S010 | info | canali d'inchiostro sconosciuti |
| S011 | info | `fub:units` o `fub:guides` fuori grammatica: si ignorano e restano nel file |
| S012 | avviso | immagine senza `title` né `desc`, e non decorativa |
| S013 | info | testo sotto i 12 px a grandezza naturale |
| S014 | avviso | un riferimento a un id che il documento non ha: si disegna senza la [risorsa](scene-format-resources.md) |

- **S001, S009, S012, S013:** come si misurano sta in
  [accessibilità](scene-format-accessibility.md).
- **S002:** uno per blocco estraneo, con il suo span. La dichiarazione
  `<?xml?>` e il resto del prologo formano un blocco.
- **S003:** confronta l'attributo `id` senza prefisso di tutti gli elementi,
  in qualunque namespace, estranei compresi.
- **S010:** solo per un inchiostro valido; uno non valido ha già S004.
- **S005:** ogni `script`, SVG o XHTML; ogni attributo `on*`, senza badare a
  maiuscole e minuscole; ogni `href` con schema `javascript:`, anche quando lo
  imposta un `set` o un `animate`.
- **S006:** la dimensione decodificata del data URI, su ogni `image`, anche estranea.

## 13. Esempio completo

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">
  <title>Ciclo dell'acqua</title>
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>
  <g id="l3f8a0c2d" fub:layer="Livello 1">
    <ellipse id="o1a2b3c4d" cx="300" cy="200" rx="120" ry="60" fill="none" stroke="#0072b2" stroke-width="4"/>
    <path id="o5e6f7g8h" fub:shape="arrow" fub:geom="420 200 700 420" d="M420 200 L700 420 M682.18 417.45 L700 420 L693.3 403.29" fill="none" stroke="#000000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <text id="o9i0j1k2l" x="720" y="460" fill="#000000" font-family="Inter, sans-serif" font-size="32">
      <tspan x="720" dy="0">Evaporazione</tspan>
    </text>
    <path id="o7k2m9x4q" fub:tool="pen" fub:at="2026-10-01T09:20:31.250Z" fub:brush="pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0" d="M120.5 30.2 Q121 30.1 121.4 30 Z" fill="#d55e00" fub:ink="1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8"/>
  </g>
</svg>
```

Il `d` del tratto è abbreviato per leggibilità; un `d` reale contiene il
contorno completo calcolato con `pf1`.
