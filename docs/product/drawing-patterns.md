# Disegni, campiture e motivi

> **Per chi:** chi vuole riempire un'area di righe o di puntini, come in un
> disegno tecnico, in una mappa o in un grafico da stampare in bianco e
> nero, o ripetere un proprio disegno come motivo.
> **Risultato:** sapere come si danno e si cambiano le campiture nel
> pannello delle proprietà, come si fa un motivo con gli oggetti scelti, e
> che cosa ne fanno i comandi, la Lettura e l'export.

Dallo Standard il riempimento di un oggetto può essere una **campitura**:
righe, righe incrociate o puntini che si ripetono, sopra un fondo o sul
trasparente, come i motivi di base di Illustrator o le campiture di un
programma di disegno tecnico. Una campitura distingue un'area anche dove i
colori non bastano: in bianco e nero, in fotocopia, per chi non vede
alcune tinte. All'[Esperto](drawing-expert.md) gli oggetti scelti
diventano un **motivo del documento**, col suo nome, che riempie altri
oggetti ripetendosi. La sezione «Campitura» del [pannello delle
proprietà](drawing-properties.md) dà e cambia le une e gli altri. Il
modello delle campiture è in `apps/client/src/editors/spatial/tools/hatches.ts`,
quello dei motivi in `tools/patterns.ts`, la sezione in `tools/hatch-panel.ts`.

## Le campiture pronte

| Campitura | Che cosa disegna |
|---|---|
| Diagonale | righe oblique, che salgono verso destra |
| Incrociata | due serie di righe oblique, a rete |
| Orizzontale | righe orizzontali |
| Puntinata | puntini sfalsati, a quinconce |
| Quadrettata | righe orizzontali e verticali, a quadretti |

- **Una campitura nuova parte dal colore dell'oggetto:** quel colore
  diventa il fondo, e le righe sono nere o bianche, quelle che su quel fondo
  si leggono meglio. Il passo, la distanza fra una riga e la successiva, è
  8; lo spessore delle righe 1,5, il diametro dei puntini 3. Da una
  sfumatura il fondo è il suo colore medio; un oggetto senza riempimento ha
  righe nere sul trasparente.
- **Passare da una campitura pronta all'altra** tiene il passo e i colori,
  e lo spessore fra righe e righe; fra righe e puntini lo spessore riparte,
  in proporzione al passo.
- **Ogni oggetto ha la sua**, nelle sue coordinate, come una
  [sfumatura](drawing-gradients.md): spostarlo, ruotarlo o ridimensionarlo
  dalle maniglie la porta con sé, e ingrandito ha le righe più larghe e più
  spesse. Cambiare la campitura di un oggetto non cambia quella degli altri,
  anche se nascono uguali.
- **Chi la usa scrive anche un colore di ripiego**: il colore delle righe
  mescolato al fondo secondo la parte che coprono, o il colore delle righe
  senza fondo. È quello che mostra un programma che non sa disegnare i
  motivi, ed è vicino a ciò che l'occhio vede da lontano.

## La sezione «Campitura»

La sezione viene dopo «Sfumatura», con oggetti scelti che hanno un
riempimento.

- **Tipo** è un menu: Nessuna e le cinque campiture pronte, ciascuna con la
  sua figura; all'Esperto, sotto, i motivi del documento per nome, col loro
  colore, e «Motivo dalla selezione». Una scelta vale per tutti gli oggetti
  scelti che hanno un riempimento, è un passo di annulla, e si sente dire a
  quanti è arrivata. Nessuna lascia il fondo della campitura, o il colore di
  ripiego di un motivo. Una campitura cambiata nei campi, che non è più una
  di quelle pronte, il menu la dice «Personalizzata».
- **Colore** delle righe e **Fondo**, scritti come codice, come nome o col
  nome di un campione, di cui si prende il colore: la campitura non resta
  legata al campione. Il campione accanto al campo apre i colori del
  documento e quelli della tavolozza, il fondo anche «Nessuno», che lascia
  vedere ciò che sta dietro l'oggetto; c'è anche il selettore del sistema.
- **Passo**, da una riga alla seguente, e **Spessore** delle righe, o
  **Diametro** se sono puntini, nell'unità dello spessore del contorno: lo
  spessore non supera il passo, e un passo più corto lo accorcia.
  **Angolo**, in gradi fra -180 e 180, gira le righe in senso orario.

I campi si calcolano e si scrivono come gli altri del pannello: `↑` e `↓`
cambiano un numero di 1, con `Maiusc` di 10; `Invio` o lasciare il campo
scrive, `Esc` riporta com'era. Ogni campo ha il suo nome nella cronologia,
e i passi che si seguono nello stesso campo si uniscono. Con più oggetti la
sezione mostra ciò che hanno in comune, e un valore diverso è vuoto e dice
«Misto»; i campi cambiano gli oggetti che hanno una campitura, e una nota
dice quanti sono. Un motivo scritto da un altro programma il menu lo dice
«Altro motivo»: FubDraw lo lascia com'è, finché non se ne sceglie un altro.

All'Esperto, con un motivo del documento, la sezione ne mostra il **Nome**,
che si riscrive con le regole dei nomi dei campioni, ed **«Elimina
motivo»**: chi lo usava torna al suo colore di ripiego, il colore medio del
motivo, in un passo di annulla. Come per un campione, chi non si cambia,
un oggetto bloccato o un foglio di stile, lo tiene, e il motivo resta fra
le risorse senza nome finché lo usa.

## I motivi del documento

All'Esperto **«Motivo dalla selezione»**, nella barra «Disponi» accanto
alle maschere, nel menu «Selezione avanzata», anche col tasto destro, e nel
menu della campitura, fa un motivo degli oggetti scelti, come trascinarli
nei campioni di Illustrator. Quando non si può, le voci dei menu sono
spente e dicono perché, e il pulsante lo dice a voce. Il motivo è una copia
degli oggetti, nel riquadro di ciò che disegnano: un oggetto riempito col
motivo mostra gli originali al loro posto, ripetuti uno accanto all'altro
senza spazio. Gli oggetti restano, e restano scelti; il motivo prende il
primo nome libero, «Motivo», «Motivo 2», e lo si sente dire. È un passo di
annulla, «Motivo dalla selezione».

- **La distanza fra le ripetizioni** la dà il riquadro: per lasciare
  spazio, si sceglie anche un rettangolo senza riempimento né contorno,
  dietro gli oggetti e più grande di loro, come la mattonella di
  Illustrator. Non si vede, e il motivo si ripete alla sua misura.
- **Un motivo è del documento,** come un [campione](drawing-colors.md#i-campioni):
  resta anche quando nessuno lo usa, e il suo nome è diverso da quelli dei
  campioni e degli altri motivi. Chi lo usa scrive come ripiego il colore
  medio del motivo, che il campione del pannello mostra accanto al nome.
- **Non entrano in un motivo** un'immagine, un collegamento e un testo su
  tracciato; un oggetto con un ritaglio, una maschera, degli effetti, delle
  punte, un altro motivo o una campitura, o un tratto che non si
  ridisegna; un oggetto dentro un gruppo con un ritaglio, una maschera,
  degli effetti, o nascosto. Il comando dice perché, e il disegno resta
  com'è. Un foglio di stile che farebbe vedere il motivo diverso dagli
  oggetti lo ferma allo stesso modo.
- **Le sfumature degli oggetti** entrano nel motivo come copie: cambiarle
  negli oggetti non cambia il motivo.

## Distinguere le aree

Un grafico, una mappa o uno schema che affidano un significato al colore
non si leggono in bianco e nero, né da chi non vede quelle tinte. La
[verifica dell'accessibilità](drawing-accessibility.md) lo dice quando due
colori usati come codice si distinguono soltanto per la tinta, e
**«Dai una campitura»** dà a tutte le aree di uno dei due la campitura
pronta che il disegno usa meno, sul loro colore, con righe nere o bianche e
un passo misurato sull'area: un terzo del lato più corto, fra 3 e 8 come la
si vede. Le aree bloccate restano.

## Con gli altri comandi

- **Duplicare, copiare e incollare** danno alla copia la sua campitura, con
  un nome nuovo: cambiare l'una non cambia l'altra. Un motivo del documento
  resta in comune, come un campione ([Disegni,
  risorse](drawing-resources.md#i-comandi)).
- **«Incolla lo stile» e il contagocce** danno a ogni oggetto la sua copia
  della campitura, e lo stesso motivo del documento; in un altro disegno,
  che quel motivo non ha, il suo colore di ripiego ([Disegni,
  colori](drawing-colors.md#il-contagocce)).
- **«Applica trasformazione»**, all'Esperto, lascia la trasformazione a un
  oggetto con una campitura o un motivo, che vivono nelle sue coordinate
  ([Disegni, livello Esperto](drawing-expert.md#applica-trasformazione)).
- **I colori del documento** contano i colori delle campiture fra quelli
  usati, e li si sceglie da lì; un campione fatto da uno di quei colori, o
  un colore sostituito, non riscrive le righe, che si cambiano nella
  sezione. Le forme di un motivo sì, come quelle di un marcatore
  ([Disegni, colori](drawing-colors.md#la-sezione-colori-del-documento)).
- **Un colore, un campione o una sfumatura** dati al riempimento prendono
  il posto della campitura, e quella che nessuno usa più se ne va.

## In Lettura e nell'export

In Lettura, in PNG, in JPEG e nell'SVG pulito le campiture e i motivi sono
quelli del foglio; l'SVG pulito li scrive come motivi di SVG, senza ciò che
serve soltanto a FubDraw. Nel PDF restano vettoriali, ripetuti dal lettore
come sul foglio ([Disegni, esportare](drawing-export.md)).

## Nel file

Una campitura è un motivo di SVG privato con `fub:pattern`, che dice in
sei parole il genere, l'angolo, il passo, lo spessore, il colore delle
righe e il fondo, e il contenuto ne discende; un motivo del documento ha il
suo nome in `fub:name`, come un campione.

```xml
<pattern id="r3h8k2m5q" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)" fub:pattern="lines -45 8 1.5 #000000 #56b4e9">
  <rect width="8" height="8" fill="#56b4e9"/>
  <rect y="3.25" width="8" height="1.5" fill="#000000"/>
</pattern>
…
<rect id="o1" x="10" y="10" width="60" height="40" fill="url(#r3h8k2m5q) #4692bd"/>
```

Un motivo scritto da un altro programma si vede e si conserva, e la sezione
lo dice «Altro motivo». La grammatica, il ripiego e quando un motivo è una
campitura di FubDraw sono in [Formato della scena,
risorse](../reference/scene-format-resources.md#le-campiture-e-i-motivi).

## Livelli e parti

Le campiture vengono dallo Standard, i motivi del documento
dall'Esperto; nel [Personalizzato](drawing-custom.md) li portano le parti
«Campiture» e «Motivi del documento». A un livello che non le ha, le
campiture e i motivi restano nel disegno e si vedono: senza «Campiture»
manca la sezione, senza «Motivi del documento» il menu non offre i motivi
né «Motivo dalla selezione», e un motivo scelto non si rinomina. «Dai una
campitura» viene con la verifica dell'accessibilità. In un documento in
sola lettura la sezione mostra la campitura, e non la cambia.
