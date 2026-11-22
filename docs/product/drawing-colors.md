# Disegni, colori

> **Per chi:** chi vuole colori coerenti in tutto un disegno.
> **Risultato:** sapere che cos'è un campione, che cosa dice il contrasto e
> quali colori sono recenti.

Un disegno ha i suoi colori: i **campioni**, colori con un nome che gli
oggetti usano per riferimento, così che cambiarne uno cambia tutti quelli che
lo usano, e quelli scelti di recente. Il campo di un colore, nel [pannello
delle proprietà](drawing-properties.md), li offre tutti. Il contagocce se ne
è andato col livello Standard (decisione 0231). I campioni sono in
`apps/client/src/editors/spatial/tools/swatches.ts`.

## I campioni

Un campione è un colore del documento con un nome, «Blu mare» o «Rosso del
logo». Chi lo usa non scrive il colore ma il campione: quando il campione
cambia colore, cambiano tutti insieme, in un passo di annulla. Il file resta
un SVG che ogni programma apre, perché il campione è una sfumatura di un
colore solo, e chi lo usa scrive anche il colore, come ripiego.

```xml
<linearGradient id="r7k2m9q4x" fub:role="swatch" fub:name="Blu mare" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>
…
<rect id="o3c5e7g9j" x="40" y="40" width="200" height="120" fill="url(#r7k2m9q4x) #0072b2"/>
```

- **Nell'editor di sempre si usano, non si fanno.** Non fa campioni, non li
  rinomina, non ne cambia il colore e non li elimina: la sezione «Colori del
  documento» se ne è andata col livello Standard (decisione 0231). Il campo
  di un colore li offre ancora, col loro nome, e chi ne sceglie uno lo usa.
  Col Disegno completo si fanno e si cambiano da Risorse › Campioni (sotto).
- **Ogni campione del file è globale**: cambiarlo cambia ogni oggetto che lo
  usa. Il formato non ha tinte, colori spot né gruppi di colori.
- **I testi** usano un campione intero. Le righe e le parole non ne usano,
  perché il formato non dà loro riferimenti: quelle che scrivono un colore
  loro lo tengono.

Un colore lo usa chi lo mostra: il riempimento delle forme e dei testi, il
contorno, il colore di un tratto a penna, anche ereditati da un gruppo o da
un livello, e il nero di SVG dove nessuno scrive un riempimento. Contano anche
le forme dei motivi e dei marcatori, che dipingono chi li usa; non i punti
delle sfumature, né il contenuto dei ritagli e delle maschere.

## Il campo del colore e il contrasto

Nel pannello delle proprietà il campo di un colore legge anche il nome di un
campione, con le maiuscole a parte, e lo mostra col suo nome; il nome di un
campione vale prima di quello di un colore, perché è del disegno. Il
pulsante accanto al campo apre il selettore dei colori, con «Nessuno», i
consigliati della tavolozza, i colori del documento, i recenti e un colore
qualunque.

Sotto il Riempimento e il Contorno una riga dice il **contrasto con la
carta**, con l'opacità degli oggetti se è una sola. Per il riempimento di un
testo dà il livello di WCAG del testo normale e di quello grande, per il blu
`#0072b2` sul bianco «Contrasto con la carta 5,18:1. Testo normale: AA;
testo grande: AAA.»; per il resto dice se basta il 3:1 di una forma. La
carta è la prima del disegno, o il bianco; la riga non c'è per nessun
colore, un valore misto, una sfumatura o un motivo, e con una carta di
colore ignoto.

## I colori recenti

Un colore scritto e scelto entra fra i recenti: dal campo del
riempimento o del contorno e come colore con cui si disegna; anche il colore con cui si disegnava prima resta fra loro. Un
campione no, perché ha la sua griglia. I recenti valgono per tutti i disegni
e li ricorda la macchina, nello stato di vista `draw.colors`; i primi tre
sono anche nel menu radiale ([Disegni, vista ruotata, gesti e menu
radiale](drawing-view.md)).

## Fra disegni

Lo stile copiato vale per tutti i disegni aperti, e un campione che il
disegno non ha lascia il posto a quello con lo stesso nome, con le maiuscole
a parte, e lo stesso colore, o al suo colore; un'altra risorsa che manca, al
colore di ripiego. Incollando oggetti, un campione resta quello del disegno
con lo stesso id, o diventa quello con lo stesso nome e lo stesso colore, e
chi lo usa ne prende il colore come ripiego; altrimenti arriva, e con un nome
già preso, o che si legge come un colore, prende il primo libero, «Vermiglio
2» ([Disegni, risorse](drawing-resources.md#copiare-e-incollare)).

## Nel Disegno completo

Col Disegno completo acceso il colore degli oggetti scelti si cambia dalla
sezione **Colore** della scheda Design, e i campi del colore di Riempimento e
Contorno escono dal pannello; Spessore e Tratteggio vanno nella sezione
Contorno del Design e le punte restano nel pannello
([Disegni, pannello delle proprietà](drawing-properties.md)). Spento il
Completo, i campi tornano.

- **Riempimento e Contorno**, uno sotto l'altro, col colore che il pannello ha
  già: un colore, «nessuno», una sfumatura o un motivo per nome. Uno dei due è
  il **lato attivo**, col bordo accento e il nome in grassetto; aprire il
  colore dell'altro lo fa attivo, anche per i tasti del motore. Un colore
  scelto va sul suo lato con un comando solo.
- **Scambia** scambia riempimento e contorno; **Nessuno** toglie il colore del
  lato attivo; **Di serie** rimette il riempimento bianco e il contorno nero;
  **Sfumatura** dà al lato attivo l’ultima sfumatura usata (la prima volta, dal
  bianco al nero), che poi si cambia dalla sezione Sfumatura
  ([Disegni, pannello delle proprietà](drawing-properties.md#le-sezioni)). È
  spento, col perché, senza niente di scelto, con soli testi, con un oggetto
  bloccato o su un lato che la selezione non ha.
- Senza niente di scelto la sezione è spenta; un lato che gli oggetti scelti
  non hanno si spegne da solo e dice «Nessuno», col perché nel suggerimento
  («Contorno: la selezione non ne ha»): un'immagine non ha contorno, e
  nemmeno un testo, perché Fub non ne dà ai testi. «Misto» vuol dire solo
  oggetti scelti con colori diversi.

### I campioni nella scheda Risorse

Nella scheda **Risorse** la sezione **Campioni** mostra i campioni del
documento in una griglia, col conto («24 campioni»); con molti campioni la
griglia scorre dentro la scheda.

- **Un clic sceglie** un campione (il segno ✓) e, se ci sono oggetti scelti,
  lo dà al lato attivo della sezione Colore, riempimento o contorno, con un
  comando solo. Il doppio clic apre le opzioni. Le frecce, Inizio e Fine
  muovono il fuoco fra i campioni.
- **Nuovo…** apre la finestra «Nuovo campione»: il nome, il colore col
  selettore dei colori e la nota che il campione è globale. Un nome vuoto o
  già di un altro campione tiene la finestra aperta e lo dice.
- **Opzioni…** apre «Opzioni del campione» per quello scelto: rinominarlo o
  cambiarne il colore cambia tutti gli oggetti che lo usano, in un passo.
- **Elimina** toglie il campione scelto: chi lo usava tiene il suo colore.
- **Duplica** fa una copia del campione scelto, subito dopo di lui; il motore
  la chiama «… copy», e si rinomina con Opzioni. **Ordina per nome** mette i
  campioni in ordine di nome, e il file salva quell'ordine. **Unisci campioni**
  e **Sposta campione** sono nell'indice dei comandi (Ctrl+/), senza un'interfaccia
  nella sezione: chiedono i campioni da unire o da spostare, e dicono che cosa manca.
  I gruppi di colori non ci sono, perché il formato del disegno non ne ha, e
  «Ordina per specie» non cambia niente, perché ogni campione è un colore.
- **Aggiungi i colori usati** fa un campione per ogni colore degli oggetti
  scelti, o di tutto il disegno senza niente di scelto.
- **Togli i non usati** elimina in un passo i campioni che nessun oggetto,
  gruppo o altra risorsa usa; spento se sono usati tutti.

Le stesse finestre si aprono dal menu ≡ e da Ctrl+/: «Nuovo campione…» e
«Opzioni campione…», spenta finché non c'è un campione scelto.

Modifica › **Modifica colori** cambia i colori degli oggetti scelti tutti
insieme: Regola bilanciamento colore… e Satura…, poi Fondi dal davanti al
retro, in orizzontale e in verticale, poi Converti in CMYK, in scala di grigi
e in RGB, poi Inverti colori e Sovrastampa nero…. Satura chiede l'intensità,
da -100 a 100 %; Regola bilanciamento colore il rosso, il verde e il blu in %
e se cambiare il riempimento, il contorno o tutti e due; Sovrastampa nero la
percentuale e quali neri. Con «Anteprima» la finestra mostra sul foglio i
contorni di ciò che cambierebbe, e il disegno cambia solo con il pulsante della
finestra.

- Con un oggetto bloccato fra quelli scelti, o un disegno di sola lettura, le
  voci sono spente e lo dicono: «Il disegno è di sola lettura, o un oggetto
  scelto è bloccato.». Con un tratto dell'Inchiostro di Fub scelto: «Un tratto
  dell'Inchiostro di Fub non si cambia da qui.».
- Le fusioni vogliono almeno tre oggetti con un riempimento; Converti in RGB e
  Sovrastampa nero non cambiano un SVG, che ha già i colori in RGB e non ha la
  sovrastampa. Quando non c'è niente da cambiare il file resta com'è.

La sezione è in `apps/client/src/editors/spatial/completo/colore-sezione.ts`,
Campioni in `completo/campioni-sezione.ts`;
le parole delle finestre nella famiglia `colore`
(`apps/client/src/editors/spatial/completo/famiglie/colore/`), i comandi nel
motore (`crates/fub-disegno/src/famiglie/colore.rs`), i campioni del file in
`crates/fub-disegno/src/campioni.rs`.

## Chi monta l'editor

I recenti arrivano con `colors`, dal più recente, e ogni scelta li manda a
`onColorsChange`; `setRecentColors` li cambia senza tornare a
`onColorsChange` (`apps/client/src/editors/spatial/tools/editor.ts`). Il
formato del campione, i riferimenti e la raccolta stanno in [formato della
scena, risorse](../reference/scene-format-resources.md).
