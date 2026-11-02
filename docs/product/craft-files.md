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

## Quali app trova Fub

Fub conosce sette app Craft: VectorCraft, PhotoCraft, LightCraft, PdfCraft,
FigCraft, GridCraft e WordCraft, ognuna con i tipi di file che apre (un
`.pcraft` o un `IMG.JPG` per PhotoCraft, un `.figcraft` per FigCraft). Per
sapere dove sono installate guarda soltanto se i loro programmi ci sono: non
ne avvia nessuno e non chiede niente in rete.

Le cerca in quest'ordine, e il primo posto in cui c'è il programma vince:

1. l'impostazione **Dove sono le app Craft**, nel gruppo «App esterne»;
2. l'elenco del launcher di ArtCraft, `artcraft-launcher/installed.json`
   nella cartella dei dati locali (`~/.local/share` su Linux,
   `~/Library/Application Support` su macOS, `%LOCALAPPDATA%` su Windows);
3. i posti di ogni sistema:
   - Linux: `/usr/bin`, `~/.local/bin`, un AppImage in `~/Applications` o
     `~/AppImages` il cui nome comincia col nome dell'app scritto così
     (`VectorCraft-2.1.AppImage`, `vectorcraft-2.1.AppImage`), e il Flatpak
     `ai.storyteller.vectorcraft`, dell'utente o del sistema;
   - macOS: `VectorCraft.app` in `/Applications` o in `~/Applications`;
   - Windows: `ArtCraft\VectorCraft\vectorcraft.exe` sotto
     `%LOCALAPPDATA%\Programs` o sotto `Program Files`.

VectorCraft, PhotoCraft e FigCraft hanno anche un programma a riga di comando
(`vectorcraft-cli`), che serve per le anteprime: Fub lo cerca accanto
all'app trovata e in `~/.local/bin`. Il `PATH` del sistema non conta: un
programma che sta solo lì Fub non lo vede, e va scritto nell'impostazione.

Un programma conta solo se è un file che si può eseguire (o una cartella
`.app` su macOS). Un AppImage scaricato e mai reso eseguibile non conta.

### Dire a Fub dove sta un'app

Nell'impostazione **Dove sono le app Craft** si scrive una riga per programma,
con l'id dell'app, un `=` e il percorso intero:

```text
vectorcraft=/opt/VectorCraft/vectorcraft
vectorcraft-cli=/opt/VectorCraft/vectorcraft-cli
```

Una riga senza `=`, con un'app che Fub non conosce o con un percorso che non
comincia dalla radice del disco non vale. Se due righe nominano lo stesso
programma vale l'ultima. Una riga che punta a un file che non c'è non ferma
la ricerca: Fub prova i posti di sempre. L'impostazione è di questo computer
e non viaggia col vault.

Fub rifà la ricerca ogni 30 secondi al più, e subito quando l'impostazione
cambia.

### «Non installata»

Un'app è **Non installata** quando Fub non ha trovato il suo programma in
nessuno dei posti qui sopra. Fub non sa dire se l'app è davvero assente o se
sta in un posto suo: in tutti e due i casi basta scrivere il percorso in
**Dove sono le app Craft**.
