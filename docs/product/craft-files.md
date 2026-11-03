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

Il lettore sta nel crate `fub-format-craft`; la scheda che mostra il file è
del componente `fub.craft`.

## La scheda

Un file Craft si apre in una scheda in sola lettura, con la sola modalità di
lettura.

- **Con l'anteprima.** L'immagine che il file porta si guarda come una foto,
  con lo zoom e la sua barra. Sotto c'è la riga dei dati: che cosa è il file e
  di quale app, la versione del formato se il file la dice, il peso
  («Disegno di VectorCraft · formato 4 · 178.1 KiB»).
- **Senza anteprima.** Un riquadro col nome del file e la stessa riga dei
  dati. Se un'app installata sa fare l'anteprima, la scheda gliela chiede da
  sola la prima volta che si apre e intanto dice «Preparo l'anteprima…»;
  quando l'app finisce, l'immagine entra nella scheda. Se l'app non ce la fa,
  la scheda dice perché e mostra il pulsante «Crea l'anteprima con …», che la
  richiede una volta. Senza app installata dice «Il file non porta
  un'anteprima», senza pulsante.
- **Troppo grande.** Un file da leggere intero oltre il peso massimo (vedi
  **Le impostazioni**) non si legge: la scheda dice «File
  troppo grande per l'anteprima» e non offre il pulsante.

Quando il file cambia sul disco la scheda lo rilegge da sola. Il nome di
un'app che Fub non conosce si mostra come il file lo scrive. Con il
componente `fub.craft` spento la scheda dice «Nessuna superficie
disponibile», come per ogni file che Fub non sa mostrare.

Un XMP di LightCraft mostra invece i dati della foto: il voto in stelle
(«Scartata» per una foto scartata), l'etichetta col suo colore, la scelta, le
parole chiave come tag del vault (`New York` diventa `#New-York`, e un clic lo
cerca), la foto a cui appartiene e le sue copie modificate, che si aprono con
un clic. Un dato che l'XMP non dice ha la sua frase, come «Nessun voto». In
fondo una riga ricorda che questi dati li scrive LightCraft, quando si salva
con ⌘S o sempre se nelle sue preferenze è accesa la scrittura automatica
degli XMP: Fub non li cambia.

Nell'albero dei file un disegno o un progetto ha l'icona dei disegni, un
`.pcraft` o un XMP quella delle foto.

## Nelle note

`![[logo.vectorcraft]]` in una nota mostra l'anteprima che il file porta, in
Lettura e in Live, come la figura di un disegno: l'immagine con il nome del
file sotto (o il testo del link, `![[logo.vectorcraft|Il logo]]`), e un clic
apre il file nella sua scheda. Senza anteprima resta un riquadro col nome,
l'app e i dati del file e la frase «Nessuna anteprima»; un XMP incorporato è
sempre un riquadro, con il voto, l'etichetta e la scelta che dice. Lo stesso
si vede passando col puntatore su `[[logo.vectorcraft]]`.

Una nota non avvia mai l'app che sa fare l'anteprima: la chiede soltanto la
scheda. La stessa figura dieci volte nella stessa nota fa una domanda sola. Un
file che non c'è più resta un embed non risolto; con il componente `fub.craft`
spento resta il riquadro col nome e l'app.

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

## Le impostazioni

Il gruppo **App esterne** delle impostazioni tiene cinque voci. Sono tutte di
questo computer: non viaggiano col vault, e un vault importato che le porta
nel suo `.fub/settings.json` non cambia niente.

| Impostazione | Chiave | Di partenza |
|---|---|---|
| Dove sono le app Craft | `craft.editor-paths` | vuota |
| Anteprime fatte dalle app | `craft.cli-previews` | Chiedi la prima volta |
| Peso massimo da leggere per un'anteprima (MiB) | `craft.preview-max-mib` | 64 |
| Miniature nell'albero | `craft.tree-thumbnails` | spenta |
| Mostra i file XMP nell'albero | `craft.tree-show-xmp` | accesa |

- **Dove sono le app Craft**: vedi [Dire a Fub dove sta un'app](#dire-a-fub-dove-sta-unapp).
- **Anteprime fatte dalle app**: quando un file non ha un'anteprima, Fub può
  farla fare al programma a riga di comando dell'app che lo apre, su una
  copia del file e solo quando il file lo apri tu. Le scelte sono tre:
  **Chiedi la prima volta** (`ask`), **Accese** (`on`) e **Spente** (`off`).
  Con «Chiedi la prima volta» la prima scheda che avrebbe bisogno di un'app
  lo domanda: «Sì» salva «Accese», «No» salva «Spente», e la domanda non
  torna. Un valore che Fub non riconosce, compreso l'interruttore delle
  versioni di prima, vale «Chiedi la prima volta», e il file delle
  impostazioni resta com'è. Azzerare la voce torna a chiedere.
- **Peso massimo da leggere per un'anteprima**: da 1 a 4096 MiB. Un file che
  va letto intero per l'anteprima (un VectorCraft) e pesa di più resta senza.
  I file che si leggono a pezzi (uno ZIP come un PhotoCraft o un FigCraft)
  non hanno limite. Fub rilegge il peso a ogni anteprima, quindi un valore
  cambiato vale dalla prossima.
- **Miniature nell'albero**: accanto al nome di un file Craft, di un RAW, di
  un PDF o di un documento, la piccola anteprima che il file ha già. L'albero
  non avvia mai un'app.
- **Mostra i file XMP nell'albero**: spenta, gli XMP spariscono dall'albero;
  la ricerca li trova e la foto mostra i loro dati.

Le cambia chi usa Fub: dalle impostazioni, o dalla CLI di Fub nel suo
terminale, per esempio `fub-cli config --set craft.cli-previews=on`. La CLI
scrive il valore con la specie che lo schema dichiara, quindi `on` e `off`
sono le parole della scelta. Un plugin, un bundle o un comando del registro
non possono dare il consenso alle anteprime: la chiave non è scrivibile da
un programma, e la scrittura riceve `PermissionDenied`.
