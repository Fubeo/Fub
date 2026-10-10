# Disegni, caratteri del vault

> **Per chi:** chi vuole i testi di un disegno in un carattere suo, oltre ai
> tre che Fub porta con sé.
> **Risultato:** sapere quali file valgono come caratteri, come si sceglie una
> faccia, dove il carattere si vede e che cosa succede quando manca.

Fub porta con sé tre caratteri: Literata con le grazie, Inter senza grazie e
JetBrains Mono a spaziatura fissa. Un [disegno](drawing.md) può usarne altri:
i file di caratteri che stanno nel vault. Il disegno li nomina e basta, come
nomina le sue immagini; il file del carattere resta dov'è, e il disegno si
vede e si esporta uguale su ogni computer che apre lo stesso vault. Un
carattere del sistema non entra mai.

## Quali file

Un file `.ttf`, `.otf`, `.woff` o `.woff2`, in qualunque cartella del vault, è
un carattere che i disegni possono usare; un WOFF2 può anche portare più
facce. Un file vale per le famiglie che dice, con tutti i nomi che il file dà,
in ogni lingua. Due nomi sono la stessa famiglia senza badare a maiuscole e
minuscole, ma soltanto nelle lettere ASCII, come nei browser: «roboto» è
«Roboto», «ärger» non è «Ärger».

- **Una famiglia di Fub** resta di Fub: un file che si chiama Inter, Literata
  o JetBrains Mono non conta, e vince il carattere che Fub porta con sé.
- **Più file della stessa famiglia** sono le sue facce: il tondo, il corsivo,
  i pesi. Fra due facce che vanno bene uguali vince quella del file che
  l'anagrafe del vault dà per primo.
- **Un file illeggibile**, rovinato, che non è un carattere o più grande di
  64 MiB, non dà nessuna famiglia. Il campo «Carattere» lo nomina quando una
  famiglia che il disegno chiede non c'è.

Il vault si legge la prima volta che serve: quando un disegno nomina una
famiglia che Fub non ha, o quando si apre il menu dei caratteri. Un file che
arriva, cambia o se ne va nel vault cambia subito i disegni aperti.

## Scegliere il carattere

Dall'Esperto, o nel [Personalizzato](drawing-custom.md) con la parte
«Caratteri del vault», le famiglie del vault sono nel menu «Carattere» del
[pannello delle proprietà](drawing-properties.md) e fra le scelte di
`font-family` negli [attributi](drawing-expert.md#attributi), dopo i tre
caratteri di Fub e separate da loro, in ordine alfabetico. Una famiglia si
scrive nel disegno col suo nome, seguito dalla famiglia generica a cui
somiglia: `Roboto, sans-serif`, `"Fira Code", monospace`. La generica la dice
il file: la spaziatura fissa, le parole del nome («Sans», «Serif», «Mono»,
«Script»), poi la classificazione del disegnatore, poi la forma delle lettere.

Un disegno che usa già un carattere del vault lo mostra a ogni livello, anche
all'Essenziale: il livello sceglie che cosa si può fare, non che cosa si vede.

Un nome che il formato del disegno non saprebbe rileggere uguale, con una
barra rovesciata, un carattere di controllo o con spazi in testa o in coda,
non è fra le scelte: il file si può rinominare da un altro programma.

## La faccia

Un testo chiede un peso, uno stile e una larghezza, anche in un suo pezzo.
La faccia si sceglie con le regole dei CSS: prima la larghezza, poi lo stile,
poi il peso, e a pari merito una faccia statica, poi l'ordine dei file. Un
carattere variabile vale per tutto il suo intervallo, e si fissa nel punto
chiesto: un peso 600 esce 600, non il 700 più vicino. La faccia fissata è la
stessa sul foglio, in Lettura e nell'export: gli stessi byte, gli stessi a
capo.

Nessun grassetto e nessun corsivo si inventa: un carattere che non ha il
corsivo resta diritto, uno che non ha il grassetto resta del suo peso, sul
foglio come nel file esportato.

## Dove si vede

Il carattere del vault si vede dovunque il disegno si vede, e sempre con la
stessa faccia:

- sul foglio del Disegno, e nelle anteprime del pannello degli
  [stili](drawing-styles.md) quando la faccia è già arrivata;
- in Lettura, nell'immagine del disegno intero;
- nell'anteprima della finestra «[Esporta](drawing-export.md)» e nei PNG, JPEG
  e PDF che esporta; l'SVG pulito nomina il carattere e non lo porta con sé;
- nel PNG che si [copia](drawing-clipboard.md) negli appunti;
- in un disegno incorporato in una nota, `![[disegno.svg]]`;
- nelle parti di un SVG che FubDraw conserva senza modificarle, quando il loro
  testo nomina il carattere con l'attributo `font-family`.

Un disegno porta al più 64 MiB di caratteri fissati, quelli di Fub e quelli
del vault insieme, contati nell'ordine dei testi: una famiglia che non ci sta
più vale come una che non c'è. Le facce che nessun disegno aperto usa più si
tolgono quando il disegno si chiude.

## Gli a capo

Gli a capo di un testo in area si scrivono nel file
([tipografia](drawing-typography.md#il-testo-in-area)), quindi si misurano
soltanto col carattere vero. Un cambio di carattere, di stile o di peso che
tocca un testo con una famiglia del vault aspetta che la sua faccia arrivi, di
solito un istante; se nel frattempo il disegno cambia, il cambio non si fa e
si può ripetere. Mentre si scrive un testo, le sue facce, il peso del testo e
il grassetto, diritti e corsivi, si chiedono subito: quando il campo si chiude
sono già pronte.

Aprire un disegno non rifà i suoi a capo: restano quelli scritti nel file, che
sono quelli dell'export, anche se il carattere nel frattempo è cambiato. Si
rifanno quando si cambia il testo, il suo riquadro o il suo carattere.

## Quando manca

Una famiglia che non c'è, che supera il tetto o che il browser non legge passa
la mano alla seguente della lista di `font-family`, poi al carattere di Fub
della sua generica: `serif` e `cursive` sono Literata, `sans-serif` e `fantasy`
Inter, `monospace` JetBrains Mono. In fondo c'è sempre Literata, come il
carattere di serie di un browser. È la stessa scelta nell'export, quindi il
file esce come il foglio.

Il disegno lo dice:

- **un avviso**, una volta per famiglia mentre il disegno resta aperto, con
  le famiglie che non si caricano: «Il disegno «Casa» usa caratteri che non
  può caricare: Roboto. I testi si vedono con altri caratteri, anche
  nell'export.»;
- **sotto il campo «Carattere»**, per i testi scelti, perché e con quale
  carattere si vedono: «Roboto non è fra i caratteri del vault: il testo usa
  Inter.», coi primi tre file che il vault non sa leggere se ce ne sono;
- **nella finestra «Esporta»**, sotto l'anteprima, le famiglie che il file
  scriverà con altri caratteri.

Un disegno incorporato in una nota non avvisa: lo fa il disegno, quando si
apre.

## Ciò che resta fuori

- **I caratteri del sistema e quelli dal web** non entrano mai, nemmeno se un
  testo li nomina: lo stesso disegno uscirebbe diverso su un altro computer.
- **Le annotazioni dei PDF** ([Annotazioni dei PDF](pdf-annotations.md))
  usano soltanto i caratteri di Fub.
- **Un carattere la cui licenza non lascia incorporarlo** in un documento
  (`fsType` di OpenType) si vede e si esporta in PNG e in JPEG; nel PDF il
  suo testo diventa tracciati, che si vedono uguali ma non si selezionano.
- **Uno stile in linea**, `style="font-family: …"`, in una parte di un SVG che
  FubDraw conserva senza modificarla, sceglie il carattere da sé sul foglio e
  in Lettura, dove il browser può prenderlo dal sistema; l'export lo legge
  come l'attributo.

## Dove sta il codice

La scelta delle facce sta in `crates/fub-features/src/draw/fonts.rs`, che le
descrive, le sceglie e le fissa, e il client la ripete in
`apps/client/src/editors/spatial/fonts/faces.ts`: i vettori di
`apps/client/src/__fixtures__/scene-fonts/choose.json` provano tutti e due.
Il catalogo del vault e le facce registrate nel browser stanno in
`apps/client/src/editors/spatial/fonts/vault.ts`; il caricamento dell'export
in `crates/fub-features/src/draw/typefaces.rs`. Il formato è descritto in
[formato della scena, testo](../reference/scene-format-text.md#9-i-caratteri).

Il banco di fedeltà (`apps/client/bench/fidelity.mjs`) prova una famiglia del
vault in tondo, in grassetto, in corsivo a un peso fissato e in un pezzo più
leggero: il foglio, la Lettura e il PNG danno gli stessi pixel, e il banco
vede una Lettura che non porta dentro le facce del vault.
