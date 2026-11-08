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
  dati, con la frase che dice perché manca: «Il file non porta
  un'anteprima», «Il file non si legge: forse è rotto», oppure «VectorCraft
  non è riuscita a fare l'anteprima» quando l'app ci ha provato. Se un'app
  installata sa fare l'anteprima, sotto c'è ciò che dice
  [Le anteprime fatte dalle app](#le-anteprime-fatte-dalle-app).
- **Troppo grande.** Un file da leggere intero oltre il peso massimo (vedi
  **Le impostazioni**) non si legge: la scheda dice «Il file pesa più del
  massimo da leggere per un'anteprima (64 MiB)», col peso in MiB interi, e
  il link «Apri le impostazioni» porta alla voce del peso. Non offre il
  pulsante.

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
`.pcraft`, un XMP o un RAW quella delle foto. Con «Miniature nell'albero»
acceso (è spento all'inizio, nel gruppo «App esterne» delle impostazioni), un
file Craft, un RAW, un PDF o un documento di Word mostra al posto dell'icona
la piccola anteprima che il file ha già, ritagliata alla misura dell'icona; un
RAW la mostra dritta, secondo l'orientamento della foto. L'albero la chiede
soltanto per le righe in vista, poche alla volta, e non avvia mai un'app: un
file senza anteprima tiene la sua icona, e una nota con un'icona scelta tiene
quella. Un nome lungo si taglia, la miniatura no. Con il componente «File
delle app Craft» spento non ci sono miniature.

«Mostra i file XMP nell'albero» (acceso all'inizio) spento, gli XMP spariscono
dall'albero e basta: la ricerca, il passaggio veloce, i collegamenti e i tag
li trovano ancora, la scheda della foto mostra i loro dati, e una cartella che
ha soltanto XMP resta nell'albero. L'interruttore vale anche col componente
spento, perché è dell'albero. Un cambio dei due interruttori ridisegna
l'albero aperto.

## Le anteprime fatte dalle app

Quando un file non porta un'anteprima e un'app installata sa farla, Fub può
farla fare al suo programma a riga di comando, su una copia del file. Lo fa
soltanto dopo un gesto di chi usa Fub, e ciò che la scheda mostra dipende
dalla voce **Anteprime fatte dalle app** (vedi **Le impostazioni**):

- **Chiedi la prima volta.** La scheda fa la domanda: «Fub può far fare
  l'anteprima a VectorCraft, che lavora su una copia del file. Vuoi che lo
  faccia per i file che apri?», con «Sì, accendi» e «No, lasciale spente».
  «Sì» salva «Accese» e chiede subito l'anteprima; «No» salva «Spente». Se
  la voce non si salva, la domanda resta, dice perché e non parte niente.
- **Accese.** Una scheda aperta con un gesto chiede l'anteprima da sola, una
  volta, e intanto dice «Preparo l'anteprima…»; quando l'app finisce,
  l'immagine entra nella scheda. Ogni altra scheda mostra il pulsante «Crea
  l'anteprima con VectorCraft», che la chiede una volta.
- **Spente.** La scheda dice «Le anteprime fatte dalle app sono spente», col
  link «Apri le impostazioni» al gruppo **App esterne**.

I gesti sono il clic o Invio su un file nell'albero, «Apri» dal suo menu, un
risultato della ricerca o del selettore rapido, il clic su un link o su una
figura in una nota. Una scheda riaperta all'avvio, aperta da `fub://open` o
da una vista di un plugin, una scheda che torna in primo piano o si rimonta
non chiedono niente: mostrano il pulsante. Due riquadri sullo stesso file
fanno una richiesta sola. Se il consenso cambia altrove mentre la scheda è
aperta, la scheda si ridisegna con ciò che vale adesso; se l'host rifiuta la
richiesta perché il consenso non c'è più, torna la domanda o la riga
«spente».

## Nelle note

`![[logo.vectorcraft]]` in una nota mostra l'anteprima che il file porta, in
Lettura e in Live, come la figura di un disegno: l'immagine con il nome del
file sotto (o il testo del link, `![[logo.vectorcraft|Il logo]]`), e un clic
apre il file nella sua scheda. Senza anteprima resta un riquadro col nome,
l'app e i dati del file e la frase «Nessuna anteprima»; un XMP incorporato è
sempre un riquadro, con il voto, l'etichetta e la scelta che dice. Lo stesso
si vede passando col puntatore su `[[logo.vectorcraft]]`.

Una nota non avvia mai l'app che sa fare l'anteprima, nemmeno con le
anteprime accese: la chiede soltanto la scheda, dopo un gesto. La stessa figura dieci volte nella stessa nota fa una domanda sola. Un
file che non c'è più resta un embed non risolto; con il componente `fub.craft`
spento resta il riquadro col nome e l'app.

## PDF e documenti

Un PDF o un documento Word si apre nella vista di Fub, la stessa di sempre;
PdfCraft e WordCraft servono solo a farne l'anteprima, la prima pagina
come immagine. L'anteprima serve all'albero, alle note e al passaggio del
puntatore.

- **Nella nota.** `![[contratto.pdf]]` senza `#page=` mostra la prima pagina
  come figura, con il filo e l'ombra di un foglio e il nome del file sotto,
  quando l'anteprima c'è; un clic apre il PDF nella sua scheda. Senza
  anteprima, con `#page=N` o con un PDF che l'app non ha saputo leggere
  (protetto o rovinato), resta il link al file. Un `.docx` incorporato
  mostra il suo testo, come prima. La figura è larga quanto la sua
  immagine, mai più della colonna, e il nome sta sotto di lei. Se il PDF
  cambia, la figura si rifà con la revisione nuova.
- **Col puntatore.** Il passaggio su `[[contratto.pdf]]` o su
  `[[relazione.docx]]` mostra la stessa pagina, quando l'anteprima c'è;
  altrimenti ciò che mostra per ogni file.
- **Aprendo.** Un PDF o un documento aperto con un gesto, con le anteprime
  **Accese**, fa fare a PdfCraft o a WordCraft l'anteprima che manca, una
  volta e in sottofondo: la scheda non aspetta e non mostra niente. Una
  scheda riaperta o rimontata non chiede niente. Una nota non avvia mai
  l'app, nemmeno qui: lo stesso PDF dieci volte nella stessa nota fa una
  domanda sola al vault, e nessuna all'app.
- **La domanda.** Con **Chiedi la prima volta**, l'app installata e
  l'anteprima che manca, la scheda porta nella riga d'avviso «Fub può far
  fare l'anteprima di questo file a PdfCraft, che lavora su una copia.
  Accendo le anteprime fatte dalle app?» con «Sì, accendi» e «No, lasciale
  spente». «Sì» salva «Accese» e chiede subito l'anteprima, perché il clic
  è il gesto; «No» salva «Spente». La riga sparisce da ogni scheda appena
  il consenso cambia, anche quando la risposta arriva da un altro riquadro
  o dalle impostazioni. Senza l'app, con le anteprime **Spente** o con il
  componente `fub.craft` spento, la riga non c'è, e aprire il file non
  chiede niente.

Un documento prestato a WordCraft (vedi **Il prestito**) con la domanda
ancora aperta porta due righe, prima quella del prestito e poi la domanda,
ognuna con le sue azioni.

## Una foto

Una foto aperta in una scheda (un JPG, un PNG, un TIFF) mostra sotto di sé i
dati di LightCraft, quando ha un XMP accanto: le stelle del voto, l'etichetta
col suo colore, la scelta («Scelta» o «Scartata»), «Apri l'XMP» e le parole
chiave come tag. Un clic su un tag lo cerca nel vault, come un tag di una
nota; «Apri l'XMP» apre l'XMP nella sua scheda. La riga si legge soltanto:
voto, etichetta e parole chiave si cambiano in LightCraft.

Fub cerca l'XMP nella cartella della foto, con la regola dei
[sidecar XMP](../reference/xmp-sidecars.md): prima `IMG_0001.jpg.xmp`, poi
`IMG_0001.xmp`, coi nomi così come sono scritti.

- Una foto senza XMP non ha la riga, e nemmeno il suo posto.
- Un XMP che non dice niente lo dice: «L'XMP non ha voto, etichetta, scelta
  né parole chiave».
- Un XMP che non si legge, rotto o troppo grande, dice «I dati dell'XMP non si
  leggono».
- In tutti e due i casi resta «Apri l'XMP».
- Un campo che manca non lascia il suo posto.
- Un voto di -1 si legge «Scartata».
- Un'etichetta che non è uno dei cinque colori si mostra com'è scritta.
- Una foto che la scheda non sa mostrare, come un HEIC, ha la sua frase e
  sotto la riga.

La riga arriva dopo la foto, e segue l'XMP: quando LightCraft lo salva, o lo
crea accanto a una foto aperta, la riga si aggiorna da sola, in ogni riquadro
che mostra la foto. Con il componente `fub.craft` spento la foto non ha la
riga, e Fub non chiede niente.

## Un RAW

Una foto RAW (CR3, CR2, NEF, ARW, RAF, DNG, ORF, RW2) si apre in una scheda
come una foto: il JPEG che la fotocamera ha scritto dentro il file, con lo
zoom, «Adatta», «1:1», il giro e lo sfondo. Il JPEG si mostra dritto: una foto
scattata in verticale sta coricata nel file, e Fub la raddrizza col suo
orientamento, specchio compreso. La misura sotto il JPEG è quella della foto
dritta. Sotto c'è «Foto RAW», il formato e il peso del file, per esempio «Foto
RAW · CR3 · 25.8 MiB», e la riga dei dati di LightCraft quando il RAW ha un
XMP accanto (vedi **Una foto**).

Con il JPEG dentro, la scheda non avvia mai LightCraft. Un RAW senza JPEG ha
la scheda di un file Craft senza anteprima: la domanda sulle anteprime fatte
dalle app con LightCraft, o il pulsante per farla, come in **Le anteprime
fatte dalle app**, e sotto la riga dell'XMP. Con il componente `fub.craft`
spento un RAW resta un file che Fub non sa aprire.
Una scheda RAW già aperta segue il componente: riaperta all'avvio, o con il
componente acceso o spento mentre è aperta, si rimonta da sola, senza avviare
LightCraft; gli altri riquadri restano come sono.

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

## Il prestito

Scegliere un'app Craft in «Apri con un'altra app» per un documento che ha
una scheda aperta in Fub è un **prestito**: il documento passa all'app, e
Fub smette di scriverlo. Prima di passarlo Fub salva le modifiche che
aspettavano. Se il salvataggio non riesce l'app non si apre, e l'avviso lo
dice: «Non ho potuto salvare: «Lettera.docx» non si apre in WordCraft.».

Finché il prestito dura, ogni scheda del documento, in ogni riquadro, è in
sola lettura e porta la riga «Aperto in WordCraft. Fub non lo modifica
finché non lo riprendi.» con il pulsante **Riprendi qui**. Ciò che l'app
salva arriva sul disco, e la scheda lo ricarica come ogni cambio fatto da
fuori, senza conflitto: in Fub non c'è niente di non salvato. Un file che
Fub mostra già in sola lettura (un foglio `.xlsx`) prende la riga e resta
com'era. Se il documento cambia nome, il prestito segue il nome nuovo.

Il prestito finisce con **Riprendi qui**, con la chiusura dell'ultima scheda
del documento e con la chiusura del vault. Fub non sa quando l'app si
chiude, né se il file è ancora aperto lì: riprendere è un gesto di chi usa
Fub, e chi riprende un documento che l'app sta ancora modificando può
ritrovarsi con due versioni che si scavalcano.

Non c'è prestito con l'app predefinita del sistema, per un file che non ha
una scheda aperta, e per le immagini, i PDF, l'audio e i video, che Fub
mostra senza mai scriverli.

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

Sei app hanno anche un programma a riga di comando (`vectorcraft-cli`,
`lightcraft-cli`…) che fa le anteprime dei file che non ne portano una:
VectorCraft, PhotoCraft e FigCraft per i loro file, LightCraft per una foto
RAW senza il JPEG della fotocamera, PdfCraft per la prima pagina di un PDF,
WordCraft per un documento senza miniatura. GridCraft non fa anteprime. Fub
cerca il programma accanto all'app trovata e in `~/.local/bin`, e lo avvia
soltanto quando apri il file e con **Anteprime fatte dalle app** accese
(vedi **Le impostazioni**). Il `PATH` del sistema non conta: un
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
  Con «Chiedi la prima volta» la scheda che avrebbe bisogno di un'app lo
  domanda: «Sì» salva «Accese», «No» salva «Spente», e la domanda non torna
  (vedi [Le anteprime fatte dalle app](#le-anteprime-fatte-dalle-app)). Un valore che Fub non riconosce, compreso l'interruttore delle
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
