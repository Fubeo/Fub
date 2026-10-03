# Formato delle annotazioni PDF

> **Ambito:** le annotazioni di FubDraw su un PDF del vault, cioè i file
> `.fubann` che Fub indicizza con il formato `fubann`. Versione 1.
> **Fonti autorevoli:** `crates/fub-scene/src/annotation.rs`,
> `crates/fub-format-svg/` e le sue fixture `tests/fixtures/annotations.*`.

Come Fub legge le annotazioni di un PDF: un file SVG accanto al PDF, con una
pagina SVG per ogni pagina annotata. Il formato estende il [formato della
scena](scene-format.md): lettura, elementi, inchiostro, contenuto estraneo,
limiti e diagnostica sono quelli di un disegno, e questa pagina dice solo ciò
che cambia. I `§` dei commenti nel codice che parlano di annotazioni sono le
sezioni di questa pagina. Le regole segnate *(proposta del 3 ottobre 2026, da
rivedere)* attendono una revisione.

## 1. Principi

1. **Il PDF non si tocca.** Le annotazioni stanno in un file loro, e il PDF
   resta un allegato identico byte per byte.
2. **Un SVG valido.** Il file si apre in un browser o in un altro editor; i
   dati in più stanno in attributi `fub:*` che gli altri ignorano.
3. **La sorgente è autorevole.** Il modello è una vista del testo, come per un
   disegno.
4. **Il provider legge solo il `.fubann`.** Impronta e numero di pagine del PDF
   li verifica chi apre il PDF accanto; il provider li riporta come sono
   scritti.

## 2. Documento

- **Nome:** `<nome>.pdf.fubann`, nella cartella di `<nome>.pdf`. L'estensione
  di un file è il suo ultimo segmento, quindi il file è un `fubann` e il PDF
  resta un PDF.
- **Sintassi:** quella di un disegno (formato della scena, §2): UTF-8 con il
  BOM conservato, XML 1.0 ben formato, radice `svg` nel namespace SVG,
  namespace `fub` riconosciuto dall'URI `https://fubeo.github.io/ns/scene/1`.
  Un file che non è una scena non è nemmeno un insieme di annotazioni.
- **Versione:** la radice porta `fub:version="1"`. Senza, il file è estraneo
  come un disegno estraneo e si indicizza allo stesso modo, con
  `foreign: true` nel riepilogo.
- **Coordinate:** punti PDF, cioè 1/72 di pollice, con l'origine nell'angolo in
  alto a sinistra della pagina e l'asse y verso il basso: la semantica è quella
  di SVG. La conversione allo spazio del PDF, con l'origine in basso, la fa
  l'export.

La radice porta tre attributi in più. Un valore fuori grammatica è soltanto
assente: il file si legge lo stesso.

| Attributo | Valore | Grammatica |
|---|---|---|
| `fub:annotates` | il PDF annotato | percorso del vault con la regola dell'`href` di un `a` (formato della scena, §4) |
| `fub:digest` | l'impronta dei byte del PDF | `sha256:` e 64 cifre esadecimali |
| `fub:pages` | il numero di pagine del PDF | intero positivo in cifre decimali, come `fub:version` |

- **`fub:annotates`** è relativo al `.fubann`, o dalla radice del vault se
  comincia con `/`, con il percent-encoding di un URL (`Bando%20di%20gara.pdf`)
  e gli spazi ai bordi tolti. Un URL esterno o un valore vuoto non nomina un
  PDF del vault. Un frammento si conserva nel collegamento e si ignora nei
  collegamenti alle pagine (§6).
- **`fub:digest`** ha il prefisso in minuscolo e le cifre in minuscolo o in
  maiuscolo; il modello lo porta tutto in minuscolo, così due impronte uguali
  sono la stessa stringa. Gli spazi ai bordi lo rendono non valido.
  *(Proposta del 3 ottobre 2026, da rivedere.)*
- **`fub:pages`** non ammette spazi, segni né lo zero, e deve stare in 32 bit.

Un file oltre 20 MiB porta all'indice solo la testa (formato della scena,
§11): gli attributi della radice ci sono, pagine e note no.

**Il legame con il PDF.** L'editor non scrive niente quando apre le
annotazioni: legge il PDF, ne calcola impronta e numero di pagine e li
confronta con la radice. Tutto *(proposta del 3 ottobre 2026, da rivedere)*:

- **non ancora scritti**, cioè impronta assente e `fub:pages` assente o
  uguale: li scrive il primo gesto che modifica il file, nella stessa
  operazione e nello stesso passo di annulla;
- **stessa versione**, cioè la stessa impronta: niente da scrivere, e un
  `fub:pages` assente o diverso si corregge col primo gesto;
- **PDF cambiato**, cioè un'altra impronta, o pagine diverse senza impronta:
  le annotazioni restano dove sono e niente si scrive da sé. Un avviso lo
  dice, e «Conferma questa versione» scrive impronta e pagine nuove in un
  passo di annulla suo. Le annotazioni non si spostano mai da sole;
- **PDF assente o illeggibile**, o un `fub:annotates` che non nomina un PDF
  del vault: le pagine sono bianche, le annotazioni si modificano e la radice
  non cambia.

## 3. Pagine

Una pagina annotata è un `g` **figlio della radice** con `fub:page="k"`:

- `fub:page` è il numero della pagina, da 1 come nel frammento `#page=k` del
  visualizzatore dei PDF, con la grammatica di `fub:pages`;
- `fub:page-size="w h"` porta larghezza e altezza della pagina in punti PDF:
  due numeri positivi separati da spazi o da una virgola, come una lista di
  numeri SVG.

Un gruppo per pagina annotata, con dentro gli elementi modificabili del
formato della scena (§4): l'evidenziatore (`fub:tool="highlighter"` o un
rettangolo con opacità), la penna, le forme, le note (§4) e la **copertura**,
un rettangolo opaco. La copertura non è una redazione: il contenuto sotto
resta nel PDF, e solo l'export rasterizzato delle pagine coinvolte lo elimina.

Le regole di lettura, tutte *(proposta del 3 ottobre 2026, da rivedere)*:

- un `g` annidato non è una pagina, anche con `fub:page`;
- un `fub:page` fuori grammatica lascia un gruppo qualunque, e i suoi elementi
  stanno fuori dalle pagine; un `fub:page-size` fuori grammatica lascia la
  dimensione assente;
- le pagine restano nell'ordine del file, e due gruppi con lo stesso numero
  restano due gruppi: sono la stessa pagina e la stessa sezione (§5);
- i gruppi della radice di un `.fubann` sono pagine e non livelli: un file
  nuovo non ha `fub:layer`, `viewBox`, dimensioni né carta, perché ogni pagina
  ha le sue coordinate;
- gli elementi fuori dalle pagine si leggono e si indicizzano come in un
  disegno.

Le regole di scrittura dell'editor, tutte *(proposta del 3 ottobre 2026, da
rivedere)*:

- il gruppo di una pagina nasce con il primo oggetto disegnato sulla pagina,
  nello stesso passo di annulla, con `id` `p` e il numero su almeno quattro
  cifre (`p0003`), `fub:page` e `fub:page-size` con la misura della pagina;
- nasce dopo il gruppo della pagina precedente più vicina, o in testa dopo
  titolo e descrizione: l'ordine del file segue quello delle pagine. Un gruppo
  precedente senza `id` riceve il suo;
- un oggetto nuovo va nell'ultimo gruppo della pagina, e un gruppo senza `id`
  riceve quello della pagina. Se l'`id` della pagina è già di un altro
  elemento, la pagina non riceve oggetti e l'editor lo dice;
- la misura e le coordinate sono quelle della pagina come si mostra, con la
  rotazione del PDF già applicata e scala 1. Senza PDF vale la misura scritta
  nel gruppo, poi quella del primo gruppo che ne ha una, poi A4
  (595,28 × 841,89 punti);
- si sfogliano le pagine del PDF, più ogni pagina annotata oltre l'ultima;
  senza PDF quelle di `fub:pages`, o fino alla pagina annotata più alta;
- l'evidenziatore è un tratto della penna (formato della scena, §5) con
  `fub:tool="highlighter"`, `fill-opacity="0.4"` e il pennello quattro volte
  più largo; la copertura è un `rect` con `fill` opaco e senza bordo; la nota
  è il `text` del §4, con il corpo in `fub:note` e un'etichetta di una riga.

## 4. Note

Una nota è un `text` di SVG con `fub:note`, che porta il **corpo esteso**. Il
contenuto del `text` è il testo disegnato sulla pagina, e può mancare: un
`text` autochiuso con il solo corpo è una nota senza testo disegnato.

- **Corpo:** il valore dell'attributo dopo la normalizzazione di XML, che
  riduce a uno spazio ogni a capo letterale. Un ritorno a capo nel corpo si
  scrive quindi `&#10;`; `&#13;&#10;` e `&#13;` si leggono come `&#10;`. Il
  resto resta com'è.
- **Nota o testo:** un corpo fatto solo di spazi non fa una nota, e il `text`
  è un testo qualunque. Un `text` dentro un altro `text` non si disegna, e non
  è una nota. `fub:note` su un elemento che non è un `text` non conta.
  *(Proposta del 3 ottobre 2026, da rivedere.)*
- **Corpo per l'indice:** ogni riga con gli spazi XML ridotti a uno e senza
  spazi ai bordi, le righe vuote tolte. *(Proposta del 3 ottobre 2026, da
  rivedere.)*

## 5. Modello per l'indice

`fub-format-svg` produce il modello del documento di Fub
([architettura](../architecture/document-model.md)) come per un disegno
(formato della scena, §9), con queste differenze:

| Sorgente | Modello |
|---|---|
| `fub:annotates` | collegamento al PDF, con lo span del valore: backlink e grafo |
| `g` di pagina | blocco custom `fub.annotations.page` con gli elementi che contiene |
| nota | blocco custom `fub.annotations.note` |
| documento intero | blocco custom `fub.annotations.summary` |
| testo e corpo delle note | campo `text`, per la ricerca, insieme a titolo, descrizione e testi |

- **PDF annotato:** un paragrafo con il solo collegamento, senza etichetta. Il
  contesto del backlink è il testo delle annotazioni senza il titolo, fino a
  220 caratteri: il pannello dei backlink del PDF mostra cosa dicono.
  *(Proposta del 3 ottobre 2026, da rivedere.)*
- **Pagina:** `attrs` porta `page`, il numero, e `size`, `[w, h]` o `null`.
- **Nota:** `attrs` è vuoto, e i figli sono due paragrafi nell'ordine della
  sorgente: il corpo, con le righe separate da un a capo e lo span del valore
  di `fub:note`, e poi il testo disegnato, con lo span del contenuto del
  `text`, se c'è. Una nota dentro un `a` è l'etichetta del collegamento: testo
  e righe del corpo, separati da un a capo.

Il riepilogo porta in `attrs` quelli di un disegno senza `layers` e `bbox`,
perché le pagine non sono livelli e un rettangolo che le unisse non direbbe
dove sta niente, e in più:

- `annotates`: il percorso del PDF com'è scritto, o `null`;
- `digest`: l'impronta in minuscolo, o `null`;
- `pages`: il numero di pagine, o `null`;
- `sections`: il titolo, se non è vuoto, e poi `page=k` per ogni numero di
  pagina, nell'ordine del file. `![[Bando.pdf.fubann#page=3]]` incorpora le
  annotazioni della pagina 3; il titolo le incorpora tutte; un altro nome,
  anche quello di una pagina senza annotazioni, non è una sezione.

Il nome pagina di `Bando.pdf.fubann` è `Bando.pdf`, ma `[[Bando.pdf]]` e un
link a percorso verso `Bando.pdf` nominano il PDF: per il kernel una chiave che finisce con
l'estensione di un allegato noto nomina quel file, e non un documento che ha
un'estensione in più. Le annotazioni si nominano per intero,
`[[Bando.pdf.fubann]]`. *(Proposta del 3 ottobre 2026, da rivedere.)*

## 6. Anteprima, documento nuovo e riferimenti

- **`render_html`** elenca le annotazioni per pagina, in HTML statico e inerte:
  una `section` con classe `fub-annotations`, il PDF in `data-annotates` e il
  numero di pagine in `data-pages`. Dentro, in ordine di documento: titolo,
  descrizione, il collegamento al PDF (`fub-annotations-target`), gli elementi
  fuori dalle pagine e una `section` `fub-annotations-page` per gruppo, con
  `data-page` e `data-page-size`. Il titolo `h2` di una pagina è `p. k` e apre
  il PDF a quella pagina, `<pdf>#page=k`; l'elenco ha un `li`
  `fub-annotations-text` per testo e un `li` `fub-annotations-note` per nota,
  con il testo disegnato e poi il corpo (`fub-annotations-body`). Evidenziatore,
  tratti, forme e coperture non si elencano: li conta il riepilogo.
  *(Proposta del 3 ottobre 2026, da rivedere.)*
- Ogni riferimento è un collegamento interno `a.internal-path` con
  `data-path`, anche un'immagine: mai un `<img>` né un URL di risorsa. Ogni
  blocco porta `data-fub-source-start` e `data-fub-source-end`. La sola parola
  dell'HTML è l'etichetta `p. k`.
- **`serialize`** genera le annotazioni nuove di un PDF in forma canonica, con
  righe LF e a capo finale: la radice con i namespace, `fub:version="1"`,
  `fub:annotates` e il titolo, come per un disegno nuovo. Il PDF viene dal
  nome: `Bando.pdf.fubann` annota `Bando.pdf` nella stessa cartella, scritto
  relativo e con gli escape di un `href`; un nome che non finisce in
  `.pdf.fubann` dà annotazioni senza `fub:annotates`. Impronta, numero di
  pagine e gruppi li scrive l'editor col primo gesto (§2 e §3). Il documento
  si rilegge prima di uscire. *(Proposta del 3 ottobre 2026, da rivedere.)*
- **`rewrite_links`** riscrive i riferimenti come in un disegno (formato della
  scena, §9) e, quando il PDF cambia nome, i soli byte del valore di
  `fub:annotates`, virgolette escluse: le annotazioni seguono il PDF.
- **`format_link`** scrive un riferimento come in un disegno.

Un `.fubann` che cambia cartella non riscrive `fub:annotates`, come una nota o
un disegno non riscrivono i propri collegamenti agli allegati: il PDF e le sue
annotazioni si spostano insieme.

## 7. Versioni e compatibilità

Valgono le regole del formato della scena (§10). Una nuova versione può
aggiungere algoritmi d'impronta con un prefisso diverso da `sha256:`, che un
lettore della versione 1 legge come impronta assente. *(Proposta del 3
ottobre 2026, da rivedere.)*

## 8. Esempio completo

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:annotates="Bando%20di%20gara.pdf" fub:digest="sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" fub:pages="12">
  <title>Revisione del bando</title>
  <g id="p0001" fub:page="1" fub:page-size="595.28 841.89">
    <path id="o7k2m9x4q" fub:tool="highlighter" fub:at="2026-10-01T09:20:31.250Z" fub:brush="pf1 size=16 thinning=0 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=0 capEnd=0 sim=1" d="M72 140 L320 140 L320 156 L72 156 Z" fill="#f0e442" fill-opacity="0.4" fub:ink="1 s100 cxypt 7200,14800,128,0 24800,0,0,120"/>
    <text id="o5p6q7r8s" x="330" y="150" fill="#000000" font-family="Inter, sans-serif" font-size="12" fub:note="L'importo a base d'asta è cambiato.&#10;&#10;Chiedere conferma all'ufficio gare.">
      <tspan x="330" dy="0">Importo da rivedere</tspan>
    </text>
  </g>
  <g id="p0003" fub:page="3" fub:page-size="595.28 841.89">
    <rect id="o1a2b3c4d" x="72" y="300" width="200" height="40" fill="#000000"/>
    <text id="o4d5e6f7g" x="300" y="400" fill="#000000" font-family="Inter, sans-serif" font-size="12" fub:note="Manca la firma del RUP: vedi l'allegato B."/>
  </g>
</svg>
```

Pagina 1 ha un tratto d'evidenziatore e una nota con il testo «Importo da
rivedere» e un corpo di due righe; pagina 3 una copertura e una nota senza
testo disegnato.
