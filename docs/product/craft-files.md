# File delle app Craft

> **Per chi:** chi tiene nel vault disegni, immagini, progetti e foto fatti
> con le app Craft.
> **Risultato:** sapere che cosa Fub legge di un file Craft, che cosa mostra
> e che cosa lascia all'app che lo ha scritto.

I disegni di VectorCraft, le immagini di PhotoCraft, i progetti di FigCraft
e gli XMP che LightCraft scrive accanto alle foto sono file del vault come
gli altri. Fub li legge soltanto: il titolo, il testo per la ricerca, i file
collegati e l'anteprima che il file porta. Non li scrive mai, e per
modificarli li lascia all'app che li ha creati. Gli id dei formati e la
forma dell'anteprima sono in [Formati dei file Craft](../reference/craft-formats.md).

Il lettore sta nel crate `fub-format-craft`, che l'host non monta ancora:
finché non lo monta, un file Craft resta nel vault come un file di un formato
che Fub non conosce.

## File collegati

Un file piazzato in un documento Craft, come una foto messa in un disegno di
VectorCraft o un'immagine in un progetto di FigCraft, diventa un **link del
documento** verso quel file, e il file ha il **backlink** del documento: dalla
foto si vede in quali disegni è usata.

Fub cerca i file collegati nel documento JSON del file Craft, nei campi
`href`, `src`, `path`, `file`, `uri` e `link` che valgono una stringa. Tiene
solo i percorsi relativi, che risolve contro la cartella del documento:
`../Foto/mare.jpg` in `Disegni/logo.vectorcraft` porta a `Foto/mare.jpg`.
Lascia fuori ciò che non è un file del vault:

- un percorso del disco (`/home/…`, `C:\Foto\a.jpg`, `\\server\…`);
- un indirizzo con uno schema (`https://…`, `file:…`, `data:image/png;…`);
- un valore vuoto.

La parte da `#` o da `?` in poi non conta: `foto.png#livello` porta a
`foto.png`. Ogni documento ha al massimo 1000 file collegati, senza doppioni,
nell'ordine in cui il file li nomina, e Fub guarda il documento fino a 64
livelli di profondità.

Quando il file collegato si sposta o cambia nome, Fub non cambia il file
Craft: il documento resta com'è e il suo link punta ancora al percorso
vecchio, finché l'app che lo ha scritto non lo aggiorna.

## Rinominare

Rinominare o spostare un file a cui puntano dei file Craft riesce sempre: il
file cambia nome e le note che lo nominano si aggiornano come per ogni altra
rinomina. I file Craft no: Fub non li scrive mai, quindi restano con gli
stessi byte e il loro link punta ancora al nome vecchio.

Alla fine della rinomina Fub lo dice, con una riga per ogni file Craft rimasto
indietro: `Disegni/logo.vectorcraft: un file a byte non si riscrive, il link
punta ancora a Foto/mare.jpg`. Lo stesso vale quando si rinomina il file Craft
stesso e dentro c'è un link a sé, e quando si sposta una cartella intera: ogni
file Craft che punta a un file spostato ha la sua riga.

Il file Craft si ripara aprendolo nella sua app, che ritrova il file col nome
nuovo o lo fa scegliere di nuovo. Annullare la rinomina riporta il file e le
note al nome di prima, e con loro il link del file Craft torna giusto: lì non
c'è niente da annullare.

Unire due note è diverso: se un file Craft punta alla nota che si toglierebbe,
l'unione non parte, perché il link resterebbe verso un file che non c'è più.
