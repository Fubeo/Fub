# Link, sbirciata e pagine incorporate

> **Per chi:** chi scrive nelle note Markdown e chi lavora sui loro link.
> **Risultato:** sapere che cosa fa il clic su un link, come si apre la
> sbirciata, quando un link diventa una scheda, che cosa succede quando si
> incolla un indirizzo e come si incorpora una pagina web.

## La sbirciata

Alt col clic su un wikilink o su un link Markdown a una nota,
o `Alt+Invio` col cursore sul link, o «Sbircia» dal menu del link, apre la nota
in un pannello sopra la destra del foglio, sotto le linguette: la
**sbirciata**. Il nome si risolve dalla nota che contiene il link, anche
quando il link sta dentro un'altra sbirciata. Al telefono prende tutto il foglio. La nota è aperta per
scrivere in Scrittura, con lo stesso buffer di un riquadro che la mostra già:
cursore, scorrimento e annulla sono della sbirciata.

- In testata la cartella della nota e tre pulsanti: **Apri qui** porta la nota
  nel riquadro, **A lato** in un riquadro accanto, alla stessa selezione, **×**
  chiude. All'apertura il fuoco va nel testo della nota (su **Crea la nota**,
  se la nota non c'è).
- Finché il fuoco è nella sbirciata, i comandi dell'editor, la barra, la
  ricerca nella nota e il contesto parlano della nota sbirciata.
- **Esc** salva e chiude, e il fuoco torna dov'era. Un Esc che l'editor usa
  già (un completamento a vista, il modo normale di vim) resta suo, e serve
  un secondo Esc; uno chiesto e non ancora a vista no: il primo Esc chiude.
- Dal lanciatore, `Alt+Invio` o l'azione **Sbircia** aprono una nota nella
  sbirciata; un file che non è una nota si apre a lato.
- Promuovere o chiudere non perde testo: prima l'editor consegna quello che
  tiene alla sessione, poi il riquadro prende la nota, poi la sbirciata si
  chiude.
- Un link che non porta a niente apre la sbirciata col nome e **Crea la nota**;
  la nota nata si apre lì. Un link a un PDF o a un foglio si apre a lato: la
  sbirciata è per le note. Una nota tolta da fuori mentre la si guarda lo dice
  al posto dell'editor.
- Ce n'è una per finestra: aprirne un'altra salva e chiude quella di prima.
  Cambiare vault o chiudere il riquadro la chiudono.

### Il clic su un link

Un solo criterio per wikilink e link Markdown a una nota, nel testo, nelle
celle delle tabelle e sulle schede (`link-gesture.ts`):

- il clic che segue un link lo decide `editor.link-click` in Impostazioni ›
  Editor: `apri`, di serie, porta la nota nel riquadro; `sbircia` la apre nella
  sbirciata;
- sul testo che si scrive il clic semplice resta del cursore e segue il link
  Ctrl/Cmd col clic (Cmd su Mac); in Lettura e su una scheda della nota segue
  il clic semplice;
- in un blocco reso della Scrittura (una tabella, un embed) il clic semplice
  entra nel blocco e Ctrl/Cmd col clic segue il link, come sul testo;
- Alt col clic sbircia sempre; «Apri» del menu del link apre sempre.

## La scheda della nota

Un paragrafo fatto soltanto di un wikilink (`[[Biblioteca civica]]`, anche con
sezione o alias) si vede, fuori dal cursore, come la scheda della nota a cui
porta: icona, titolo, descrizione, data, quante note la collegano e copertina,
prese dall'indice e dalle proprietà
della nota (`icon:`, `description:`, la prima fra `date:`, `updated:`,
`modified:` e `created:`, `cover:`). Il titolo è l'alias, se c'è, altrimenti il
nome della nota. La copertina mostra il colore scritto in `cover:` (`#cfe7d6`,
`rgb(…)`, `oklch(…)`), e per ogni altro valore la striscia del tema.

- Il file resta il wikilink; col cursore dentro il paragrafo torna il link.
- Il clic segue `editor.link-click`, Alt col clic sbircia; Ctrl/Cmd col clic
  vale come il clic. Il clic non porta il cursore dentro: ci si entra con le
  frecce.
- Finché l'indice non ha risposto, e per un link che non porta a una nota (una
  nota che non c'è, un PDF), il paragrafo resta link. Un embed (`![[…]]`), un
  link a un punto della nota stessa (`[[#Sezione]]`) o un link con altro testo
  accanto non sono una scheda.
- Le proprietà arrivano dall'indice (`query_index`) con una sola domanda per
  tutte le schede nuove, non per battuta: l'editor tiene i nomi dei paragrafi
  che possono diventare schede e li ricontrolla poco dopo che cambiano. Quando
  l'indice cambia si richiedono solo le schede tenute, e la Scrittura ridisegna
  soltanto quelle davvero cambiate.

## Blocchi di altre note

Una sezione o un blocco di un'altra nota riportati con `![[Nota#Sezione]]` si scrivono
dove stanno, con **Modifica qui**; lo stesso blocco in più note (`![[Nota#^id]]`) è il
blocco sincronizzato: [La trasclusione viva](editor-transclusion.md).

`[[^^parole` cerca un blocco in tutto il vault (la foglia `block:` dell'indice, dopo una pausa
breve) e ne propone al più 50, col testo e la nota. La scelta scrive `[[Nota#^id]]` e dà l'id al
blocco che non l'ha (`note.block.sync`); se l'id non entra il link nemmeno, e lo si dice; da una
nota in sola lettura si offre il link alla sezione. Nella nota stessa id e `[[#^id]]` sono un passo.

## Incollare un indirizzo

Un indirizzo `http`, `https` o `mailto:` incollato da solo, senza spazi e su
una riga sola, si scrive come link Markdown: il testo del link tra quadre, e
l'indirizzo tra tonde. Che cosa succede dipende da dove cade.

- **Su un testo selezionato** il testo selezionato diventa il testo del link,
  come in Obsidian. Il testo resta quello che era.
- **Su una riga vuota** l'indirizzo si scrive come link, con l'indirizzo come
  testo, e sotto compare una scelta piccola:
  - **Link**, la scelta di partenza: il link resta com'è.
  - **Scheda**: scrive l'indirizzo da solo sulla riga. Diventa il segnalibro web
    della pagina, con titolo, descrizione e sito; l'anteprima si chiede a parte,
    come nella [pagina dei blocchi](#i-segnalibri-web).
  - **Incorpora**, solo per un sito dell'elenco chiuso: scrive la pagina
    incorporata, `![](https://…)`, che si vede come un segnaposto «Carica»
    (vedi [Incorporare una pagina web](#incorporare-una-pagina-web)).
- **Dentro un testo** l'indirizzo entra com'è, come testo semplice.

La scelta compare solo per un incolla, mai per un indirizzo scritto lettera per
lettera. Invio o un'altra battuta tengono Link e chiudono la scelta; il cursore
che esce dalla riga la chiude senza cambiare nulla.

Con la tastiera:

- Tab, dall'editor, porta il fuoco sulla scelta, sul Link. La scelta è una barra
  con un solo punto di tabulazione: ← e → passano da Link a Scheda e, quando
  c'è, a Incorpora.
- Invio o Spazio applicano la voce col fuoco, come un clic: Link chiude la
  scelta, Scheda scrive l'indirizzo da solo, Incorpora scrive la pagina
  incorporata. Il fuoco torna nell'editor.
- Esc, Tab o Maiusc+Tab riportano il fuoco nell'editor tenendo Link.
- Qualunque altro tasto tiene Link, chiude la scelta e va all'editor, dove fa
  il suo lavoro.
- Senza scelta visibile, Tab è quello di sempre.

Non tutto diventa un link:

- un `mailto:` su una riga vuota è un link senza scelta, perché la scheda è
  per le pagine web;
- un indirizzo con spazi, o più righe di indirizzi, entra come testo;
- dentro un blocco di codice o un codice in linea l'indirizzo resta testo;
- in una cella di tabella il link non chiude la colonna: il `|` dell'indirizzo
  si scrive `%7C` e quello del testo selezionato `\|`;
- dagli appunti con HTML, come un link copiato da una pagina, vale la
  conversione di sempre, che porta il titolo del link, e nessuna scelta;
- «Incolla senza formattazione» (Ctrl Maiusc V) incolla il testo così com'è,
  senza link e senza scelta;
- durante una composizione (IME) l'incolla entra come testo.

## I segnalibri web

Un indirizzo `http` o `https` scritto da solo in un paragrafo, fuori dal
cursore, si vede come una scheda con titolo, descrizione, sito e icona della
pagina; col cursore dentro torna l'indirizzo. Il file resta l'URL nudo, e in
Lettura e negli altri programmi è un link. La scheda si scarica **soltanto su
richiesta**: aprire una nota legge la cache e basta, e un indirizzo senza
scheda offre «Mostra l'anteprima». Il download è il comando `linkcard.fetch`
del bundle `fub.linkcard`, col permesso `fub:network` che si spegne nelle
Preferenze: la scheda in cache torna subito nell'effetto `custom` con `ns`
`fub.linkcard`, quella scaricata arriva col `job_done` del job
`linkcard.fetch`. Della pagina si leggono soltanto i metadati della testa, fino a
1 MiB; l'icona entra se è un'immagine raster entro 64 KiB, mai un SVG. I due
tetti vanno al filo (`HostNetwork::fetch_limited`), che smette di leggere
appena il corpo li supera. Le schede stanno nella cache del bundle,
ricostruibile. «Pagina web»
(`markdown.linkcard`) apre dal «/» un paragrafo con `https://`.

## Incorporare una pagina web

Un video, una mappa o un disegno di un sito dell'elenco chiuso si incorpora
nella nota. Sul disco è `![](https://…)`, la forma che Obsidian incorpora a sua
volta per i video; si scrive a mano o con «Incorpora» dopo un incolla.

In Scrittura e in Lettura la pagina si vede come un **segnaposto**: l'icona
della specie, il nome del sito, la specie e l'host, e il pulsante **Carica**.
Aprire la nota non chiede niente alla rete: nessuna anteprima, nessuna icona
del sito. Carica apre la pagina nel [visore web](../reference/permissions-and-security.md#visore-web),
la finestra isolata, mai dentro la nota: un sito nuovo chiede il sì, come ogni
pagina che il visore apre, e il sì resta in `viewer.hosts`.

- **Rifiutato.** Se alla domanda si risponde di no, il segnaposto dice «Non
  caricata: hai scelto di non aprire …» e Carica diventa «Chiedi di nuovo».
- **Senza visore.** Dove il visore non c'è il segnaposto lo dice; la pagina non
  va al browser di sistema.
- **`http:`.** Un indirizzo `http` di un sito dell'elenco si apre in `https`,
  l'unico che il visore apre. Credenziali nell'indirizzo o una porta diversa
  da quella di sempre lo lasciano fuori dall'elenco.
- **Tracciamento.** I parametri che seguono chi apre la pagina (`utm_…`,
  `fbclid`, `gclid` e simili, `si` e `feature` di YouTube, `share` di Vimeo)
  non entrano nell'indirizzo che Carica apre né in quello che Incorpora
  scrive. Un indirizzo già scritto nella nota resta com'è sul disco.
- **Fuori dall'elenco** un `![](https://…)` resta l'immagine remota, che si
  scarica nel vault soltanto col gesto; un indirizzo da solo resta un link o
  una scheda.
- **Export.** L'HTML esportato scrive un link alla pagina, e il rapporto lo
  conta fra le immagini remote: il file non carica niente da fuori.

L'elenco sta in una costante sola, `WEB_EMBED_SITES` in
`apps/client/src/editors/text/profiles/markdown/web-embed.ts`. Un sito vale
per gli host esatti scritti lì, e soltanto per le pagine che mostrano un
contenuto:

| Sito | Specie | Pagine |
|---|---|---|
| YouTube (`youtube.com`, `www.`, `m.`, `www.youtube-nocookie.com`, `youtu.be`) | video | un video, un corto, una diretta, una playlist |
| Vimeo (`vimeo.com`, `www.`, `player.`) | video | un video |
| OpenStreetMap (`openstreetmap.org`, `www.`) | mappa | la mappa, un luogo, un percorso |
| Google Maps (`www.google.com/maps`, `google.com/maps`, `maps.google.com/maps`) | mappa | la mappa |
| Figma (`figma.com`, `www.`) | disegno | un file, una lavagna, un prototipo |
| Excalidraw (`excalidraw.com`) | disegno | la lavagna |
| tldraw (`tldraw.com`, `www.`) | disegno | una stanza o un file condiviso |

## Dove sta nel codice

- `apps/client/src/state/note-peek.ts`: la sbirciata (`createNotePeek`), con
  l'editor montato dalla porta delle schede (`editors/core/cards/editor-port.ts`);
  `state/document-controller-ports.ts` la cabla al riquadro col fuoco e legge
  `editor.link-click`;
- `apps/client/src/editors/text/profiles/markdown/link-gesture.ts`: il
  criterio del clic su un link (`textLinkGesture`, `renderedLinkGesture`,
  `followWikilink`, `followPath`);
- `apps/client/src/editors/text/profiles/markdown/open-link.ts`: Alt-Invio e
  il link sotto il cursore;
- `apps/client/src/editors/text/profiles/markdown/link-card.ts`: la scheda
  della nota (`NoteCardWidget`, con le proprietà da
  `apps/client/src/state/note-cards.ts`) e il segnalibro web (con le risposte
  di `crates/fub-host/src/link_card.rs` in `apps/client/src/state/link-cards.ts`);
- `apps/client/src/editors/text/profiles/markdown/web-embed.ts`: l'elenco dei
  siti (`WEB_EMBED_SITES`) e il segnaposto delle pagine incorporate.
- `apps/client/src/editors/text/profiles/markdown/button-keys.ts`: Invio,
  Spazio e Tab su «Carica» e su «Scarica nel vault» restano del pulsante:
  l'immagine in riga della Scrittura lascia arrivare la tastiera all'editor,
  e senza questa regola scriverebbero nella nota (#454).
