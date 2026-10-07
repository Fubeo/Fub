# Disegni, esportare

> **Per chi:** chi porta un disegno fuori da Fub, in un altro documento, in una
> presentazione o sulla carta.
> **Risultato:** sapere che file fa «Esporta…», che cosa ci entra e dove lo si
> ritrova.

Un [disegno](drawing.md) è già un SVG che ogni browser apre. «Esporta…» ne fa
anche un PNG, per i programmi che vogliono un'immagine, o un PDF, per stampare
e per chi legge. Il disegno non cambia. Le annotazioni di un PDF hanno i loro
due export, descritti in [Annotazioni dei PDF](pdf-annotations.md#esportare).

## Da dove

- **«Esporta…»**, nella palette dei comandi, chiede il formato: PNG o PDF,
  ciascuno con una riga che dice che cosa dà.
- **Il menu del riquadro** ha una voce per formato: «Esporta come PNG» ed
  «Esporta come PDF».

L'export lo fa l'host leggendo il file del vault, quindi c'è in Disegno e in
Lettura, in un disegno in sola lettura, in un SVG che l'editor mostra senza
modificarlo, e anche quando il codice dell'editor non è ancora arrivato o non
arriva. Serve la feature `draw` dell'host, la stessa che apre i disegni; senza,
le voci non ci sono.

## Il PNG

Il PNG è al doppio della misura del disegno: un'unità del disegno diventa due
pixel per lato, nitida anche su uno schermo denso. Un disegno così grande che
al doppio supererebbe 16 384 pixel per lato, o 32 milioni di pixel in tutto,
esce alla scala più grande che ci sta. Dove il disegno non dipinge niente il PNG
è trasparente.

## Il PDF

Il PDF ha una pagina sola, della misura del disegno, e porta il titolo del
disegno fra le sue proprietà. È vettoriale: le forme e i tratti restano curve,
nitide a ogni ingrandimento, e il testo resta testo, che si seleziona.

## Che cosa entra

Il file mostra ciò che mostra un browser che apre l'SVG: la pagina del disegno,
con quello che ci sta sopra. Ciò che sta fuori dalla pagina resta fuori.

- **Immagini incollate:** entrano coi loro byte, se sono PNG, JPEG, GIF o WebP.
  Il formato lo dicono i byte, non il tipo dichiarato. Un SVG incorporato come
  immagine resta fuori.
- **Immagini del vault:** entrano coi loro byte, con le stesse regole, fino a
  64 MiB per disegno; quelle oltre restano fuori. Il percorso si risolve dalla
  cartella del disegno, come un [collegamento](drawing.md#collegamenti), e mai
  fuori dal vault ([Disegni, immagini](drawing-images.md)).
- **Il resto:** un'immagine presa da un indirizzo del web, da un file che nel
  vault non c'è o da un percorso che ne esce resta fuori. Al suo posto non c'è
  niente: il riquadro tratteggiato del foglio non entra nel file.

### I caratteri

Un disegno esportato usa soltanto i caratteri di Fub, compresi nel programma:
Literata con le grazie, anche in corsivo, Inter senza grazie e JetBrains Mono a
spaziatura fissa, in tondo e in grassetto. Le famiglie `serif`, `sans-serif` e
`monospace` sono i tre caratteri di Fub. Un testo senza carattere, o con uno
che Fub non ha, usa Literata, come il carattere di serie di un browser. Un
carattere del sistema non entra mai, quindi lo stesso disegno esce uguale su
ogni computer.

Un peso diverso prende il più vicino dei due, e un corsivo di Inter o di
JetBrains Mono esce in tondo. Una lettera che nessuno dei tre caratteri
disegna esce come un riquadro vuoto.

## Il file

Prima dell'export le modifiche in coda si salvano: l'host legge il file dal
vault, e un export del testo di prima direbbe il falso. Se il salvataggio non
riesce, l'export non parte e lo dice.

Il file si chiama come il disegno, con le sue cartelle: `Scienze/acqua.svg`
diventa `Scienze/acqua.png` o `Scienze/acqua.pdf`. Compare nel centro attività,
che si apre da sé senza prendere il fuoco, e «Salva…» chiede dove metterlo.

Due export dello stesso disegno danno lo stesso file, byte per byte: né il PNG
né il PDF portano date, e l'ordine interno del PDF non cambia da un export
all'altro.

Il formato dei file e le regole delle risorse sono nel
[formato della scena](../reference/scene-format.md), §9.
