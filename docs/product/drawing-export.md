# Disegni, esportare

> **Per chi:** chi porta un disegno fuori da Fub, in un altro documento, in una
> presentazione o sulla carta.
> **Risultato:** sapere che file fa «Esporta…», come si sceglie che cosa
> esportare, che cosa ci entra e dove lo si ritrova.

Un [disegno](drawing.md) è già un SVG che ogni browser apre. «Esporta…» ne fa
anche un PNG o un JPEG, per i programmi che vogliono un'immagine, un SVG
pulito, per il web, o un PDF, per chi legge e per stampare, anche in
tipografia: il disegno intero, la selezione o le [tavole](drawing-boards.md).
Il disegno non cambia. Le
annotazioni di un PDF hanno i loro due export, descritti in [Annotazioni dei
PDF](pdf-annotations.md#esportare).

## Da dove

- **All'Essenziale «Esporta…»**, nella palette dei comandi, chiede il formato:
  PNG o PDF, ciascuno con una riga che dice che cosa dà, per il disegno
  intero.
- **Dallo Standard «Esporta…»** apre la finestra «Esporta», qui sotto. Nel
  [Personalizzato](drawing-custom.md) è la parte «Finestra «Esporta»».
- **Il menu del riquadro** ha una voce per formato, «Esporta come PNG» ed
  «Esporta come PDF», i due export di serie del disegno intero; dallo
  Standard, prima di loro, «Esporta…», che apre la finestra.

L'export lo fa l'host leggendo il file del vault, quindi c'è in Disegno e in
Lettura, in un disegno in sola lettura, in un SVG che l'editor mostra senza
modificarlo, e anche quando il codice dell'editor non è ancora arrivato o non
arriva: allora «Esporta…» chiede il formato come all'Essenziale. Serve la
feature `draw` dell'host, la stessa che apre i disegni; senza, le voci non ci
sono.

## La finestra «Esporta»

A sinistra le scelte, in quattro gruppi e, per il PDF, un quinto; a destra
l'anteprima, con la misura del file sotto. Su uno schermo stretto
l'anteprima va sopra.

- **Che cosa:** il disegno intero; la selezione, se c'è, col numero degli
  oggetti; le tavole, se il disegno ne ha, ciascuna con la sua casella.
  Senza una tavola scelta non si esporta, e la finestra lo dice. La
  selezione si sceglie soltanto dove la si vede, sul foglio del Disegno.
- **Il formato:** PNG, JPEG, SVG o PDF, ciascuno con una riga che dice che
  cosa dà.
- **La misura**, per PNG e JPEG: la scala, da 1× a 4×, o la larghezza in
  pixel, da 1 a 16 384, che parte da quella della scala di prima.
- **La pagina**, per il PDF, dall'Esperto: la carta, l'abbondanza e i
  segni, descritti in [Per la stampa](#per-la-stampa).
- **Lo sfondo:** la carta, o trasparente. Il JPEG non ha la trasparenza: esce
  sempre con la carta, e la finestra lo dice.

**L'anteprima** è proprio ciò che l'host scrive, prima di scriverlo: il
disegno ritagliato sulla tavola o sulla selezione, coi caratteri dell'app e
le immagini del vault, il più grande possibile nel suo riquadro. Sotto c'è
una scacchiera dove il file sarà trasparente, il bianco per il JPEG e il
PDF; un PDF su una carta col suo formato si vede sulla sua carta, col
disegno al suo posto, l'abbondanza e i segni. Con più file, o più pagine del PDF, «‹» e «›» li sfogliano uno alla
volta, «File 2 di 3: Evaporazione». La misura sotto è quella del file: i
pixel, contati come li conta l'host, le unità dell'SVG o le pagine del PDF
in millimetri. Una misura che passa i limiti di un'immagine esce ridotta, e
la finestra lo dice prima.

**La selezione** si esporta per id: l'export trova gli oggetti nel file così.
Un oggetto scelto senza id lo riceve quando si esporta, in un passo che si
annulla, e la finestra lo dice prima; in un disegno in sola lettura non può
riceverlo, e la selezione non si sceglie. Se il disegno cambia mentre la
finestra è aperta, la selezione non si esporta: lo si dice, e la si
riapre.

**Dalla tastiera** la finestra si usa tutta: `Tab` va da un gruppo all'altro,
le frecce scelgono dentro il gruppo, `Invio` esporta anche da una scelta o
da una casella, `Esc` chiude, e il fuoco torna dov'era.

**Le scelte si ricordano** per disegno, su questa macchina e non nel vault,
come la griglia: per gli ultimi 100 disegni esportati. La selezione si
ricorda come scelta, i suoi oggetti no; delle tavole si ricordano quelle
tolte, così una tavola nuova parte scelta. Si ricorda anche la pagina del
PDF.

## I formati

- **PNG:** di serie al doppio della misura del disegno, un'unità del disegno
  due pixel per lato, nitida anche su uno schermo denso. Dove il disegno non
  dipinge niente il PNG è trasparente.
- **JPEG:** la stessa immagine posata sul bianco, più leggera, qualità 90.
- **SVG pulito:** il disegno come lo vuole il web, senza ciò che serve
  soltanto a Fub: gli attributi del namespace `fub`, i commenti, le risorse
  che nessuno usa, i numeri con più cifre del necessario. Le immagini del
  vault ci entrano coi loro byte, perché fuori dal vault il loro percorso non
  porta a niente, finché l'export resta entro 32 MiB: quelle di troppo
  tengono il percorso, e il log lo dice. Si apre in ogni programma di
  grafica, e si vede come il disegno.
- **PDF:** vettoriale, le forme e i tratti restano curve, nitide a ogni
  ingrandimento, e il testo resta testo, che si seleziona; le fusioni
  restano vettoriali, e gli [effetti](drawing-effects.md#in-lettura-e-nellexport),
  che il PDF non ha, si dipingono a 300 punti per pollice. Il disegno e la
  selezione sono una pagina; le tavole una pagina per tavola, nell'ordine
  del disegno, ciascuna della sua misura e con un segnalibro col suo nome,
  o tutte sulla stessa carta. Il titolo del disegno va fra le proprietà del
  file.

**La misura delle immagini.** Un'immagine resta entro 16 384 pixel per lato e
32 milioni di pixel in tutto: oltre, esce alla scala più grande che ci sta.
PNG e JPEG portano la densità della scala, 96 punti per pollice a 1×, così un
programma di impaginazione li mette alla misura del disegno. Una pagina del
PDF grande quanto il disegno misura il disegno, la tavola o la selezione, a
0,75 punti per unità.

## Per la stampa

Il gruppo «Pagina» della finestra dice su che carta va il PDF. C'è
all'Esperto, e nel Personalizzato con la parte «Pagina di stampa del PDF»;
senza, e di serie, la carta è «Grande quanto il disegno»: la pagina misura
il disegno, come sempre. Le scelte della pagina si ricordano anche quando
il gruppo non c'è.

- **La carta:** A2, A3, A4, A5 e A6, Lettera US, Legale US e Tabloid, o un
  formato personalizzato, coi due lati in millimetri, da 10 a 5 000.
  «Orientamento» la gira «Come il disegno», in verticale o in orizzontale.
  Il disegno sta al centro, dentro i «Margini», di serie 10 mm: «Alla sua
  misura, ridotto se non ci sta», o «Grande quanto la carta».
- **L'abbondanza:** quanto il disegno continua oltre il bordo da tagliare,
  per lato, fino a 25 mm, così chi stampa taglia senza lasciare un filo
  bianco. La carta della tavola si allarga con lei, e un oggetto che passa
  il bordo ci entra. Un disegno che non dice la sua misura, senza
  `viewBox` né larghezza e altezza, esce senza abbondanza, e la finestra lo
  dice.
- **I segni:** quelli di taglio agli angoli e quelli di registro a metà dei
  lati, fuori dall'abbondanza, nel colore che inchiostra ogni lastra.
- **Il posto:** se margini, abbondanza e segni non lasciano posto al
  disegno, la finestra lo dice e non esporta.

La misura sotto l'anteprima dice la carta e il disegno sulla carta, in
millimetri e in percentuale: «Carta 297 × 210 mm · disegno 158,8 × 105,8 mm
al 100%». Il PDF dice a chi stampa dove si taglia e dove finisce
l'abbondanza, e chiede di stampare senza adattare la pagina e di scegliere
il cassetto dalla sua misura.

**«Stampa…»**, nel centro attività accanto a «Salva…» di un PDF, lo apre
nel programma che il sistema usa per i PDF: da lì si stampa, con la
stampante, le copie e il fronte e retro del sistema. Se nessun programma
apre i PDF, il centro attività lo dice, e il PDF si salva e si stampa da un
lettore. Il PDF resta da salvare; dopo «Salva…» la stampa si fa dal file
salvato.

## Che cosa entra

Il file mostra ciò che mostra un browser che apre l'SVG: la pagina del disegno,
la tavola o il riquadro della selezione, con quello che ci sta sopra. Ciò che
sta fuori resta fuori; della selezione entrano soltanto gli oggetti scelti,
con la carta sotto se lo sfondo è la carta.

- **Immagini incollate:** entrano coi loro byte, se sono PNG, JPEG, GIF o WebP.
  Il formato lo dicono i byte, non il tipo dichiarato. Un SVG incorporato come
  immagine resta fuori.
- **Immagini del vault:** entrano coi loro byte, con le stesse regole, fino a
  64 MiB per disegno; quelle oltre restano fuori. Il percorso si risolve dalla
  cartella del disegno, come un [collegamento](drawing.md#collegamenti), e mai
  fuori dal vault ([Disegni, immagini](drawing-images.md)).
- **Il resto:** un'immagine presa da un indirizzo del web, da un file che nel
  vault non c'è o da un percorso che ne esce resta fuori. Al suo posto non c'è
  niente: il riquadro tratteggiato del foglio non entra nel file. L'SVG
  pulito ne tiene l'indirizzo o il percorso, come il disegno.

### I caratteri

Un disegno esportato usa soltanto i caratteri di Fub, compresi nel programma:
Literata con le grazie, Inter senza grazie e JetBrains Mono a spaziatura
fissa, in tondo e in corsivo, normale e grassetto. Le famiglie `serif`, `sans-serif` e
`monospace` sono i tre caratteri di Fub. Un testo senza carattere, o con uno
che Fub non ha, usa Literata, come il carattere di serie di un browser. Un
carattere del sistema non entra mai, quindi lo stesso disegno esce uguale su
ogni computer.

Un peso diverso prende il più vicino dei due. Una lettera che nessuno dei tre
caratteri disegna esce come un riquadro vuoto. L'SVG pulito nomina i caratteri
e non li porta con sé: li disegna il programma che lo apre.

## Il file

Prima dell'export le modifiche in coda si salvano: l'host legge il file dal
vault, e un export del testo di prima direbbe il falso. Se il salvataggio non
riesce, l'export non parte e lo dice.

Il file si chiama come il disegno, con le sue cartelle: `Scienze/acqua.svg`
diventa `Scienze/acqua.png`, `Scienze/acqua.jpg` o `Scienze/acqua.pdf`.

- **L'SVG del disegno intero** ha la parola fra parentesi,
  `Scienze/acqua (esportato).svg`: salvato accanto al disegno, col suo nome
  ne prenderebbe il posto.
- **La selezione** ha la parola fra parentesi: `Scienze/acqua (selezione).png`.
- **Le tavole** in PNG, JPEG e SVG sono un file per tavola, col nome della
  tavola: `Scienze/acqua (Copertina).png`. In PDF sono un file solo,
  `Scienze/acqua.pdf`, o `Scienze/acqua (Copertina).pdf` se la tavola è una.
- **Nel nome del file** i caratteri che un sistema non ammette diventano `-`,
  e un nome lungo si ferma a 40 caratteri; due tavole con lo stesso nome
  prendono ` 1`, ` 2`, come due disegni.

I file compaiono nel centro attività, che si apre da sé senza prendere il
fuoco, e «Salva…» chiede dove metterli; un PDF ha anche «Stampa…»
([Per la stampa](#per-la-stampa)). Sotto i file ci sono le note
dell'export: una misura ridotta ai limiti, un'immagine rimasta fuori; un
avviso e un errore lo dicono anche a parole.

Due export dello stesso disegno danno gli stessi file, byte per byte: né le
immagini né il PDF portano date, e l'ordine interno del PDF non cambia da un
export all'altro.

Il formato dei file e le regole delle risorse sono nel
[formato della scena](../reference/scene-format.md), §9; le opzioni, il
ritaglio, l'SVG pulito, i nomi e la pagina di stampa nel
[formato dell'export](../reference/scene-format-export.md).
