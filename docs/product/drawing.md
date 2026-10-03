# Disegni

> **Per chi:** chi disegna in un vault, o ne apre i disegni.
> **Risultato:** sapere come si apre, si modifica e si legge un file `.svg`, e
> che cosa resta del file dopo una modifica.

## Un disegno è un file SVG

Con la feature `draw` dell'host un file `.svg` ha il formato `svg` e si apre
come disegno: il profilo `vector` della famiglia `canvas`
(`apps/client/src/editors/spatial/surface.ts`). Senza la feature il file resta
testo con l'anteprima accanto, come descrive
[Editor e anteprima](editor-and-preview.md).

Il codice dell'editor si scarica la prima volta che un disegno si apre, e non
pesa su chi non ne apre. Se non arriva, il riquadro lo dice, e «Apri come
sorgente» mostra comunque il testo
(`apps/client/src/editors/spatial/lazy.ts`).

Il file resta un SVG che qualunque browser o editor apre. I dati che servono a
Fub stanno in pochi attributi del namespace `fub`; la forma esatta è nel
[formato della scena](../reference/scene-format.md), il perché nell'
[ADR 0203](../decisions/0203-superfici-spaziali.md).

## Modalità

Il disegno offre due modalità:

- **Disegno**, la predefinita: la barra degli strumenti e il foglio. Proietta
  sul ruolo `live_preview`, quindi il comando Live la raggiunge.
- **Lettura**: il documento intero come immagine, con lo zoom del visore.
  Proietta su `reading`, e `Mod-E` passa dall'una all'altra.

Il ruolo `source` non c'è: il testo del disegno si apre con «Apri come
sorgente». Il riquadro ricorda la modalità del disegno come quella di ogni
altra famiglia.

In Lettura il file non entra mai nel DOM della shell: è un `<img>` da un blob,
che non esegue script e non carica risorse. Se il disegno ha un titolo,
l'immagine si chiama col titolo; altrimenti col nome del file.

## Disegnare

Il livello Essenziale ha sette strumenti, ciascuno con un tasto: selezione
(`V`), penna (`P`), gomma per oggetto (`E`), rettangolo (`R`), ellisse (`O`),
linea (`L`) e freccia (`A`). I colori sono gli otto della tavolozza di
Okabe–Ito, ognuno con una forma nel suo campione, così non si distinguono solo
dal colore; gli spessori sono tre. Il campo «Che cosa hai disegnato?» scrive il
titolo del disegno.

La barra è un solo punto di tabulazione e si percorre con le frecce. Sul
foglio valgono annulla e ripeti, seleziona tutto, elimina, `Esc` e le frecce
per spostare. Tasto centrale, due dita e rotella muovono la vista. Ogni gesto
si annuncia a chi usa un lettore di schermo.

## Documenti che non si modificano subito

La modalità del riquadro non cambia con il documento: è il disegno a dire
perché non si modifica, in un avviso in cima.

- **SVG estraneo.** Un file senza `fub:version` sulla radice, per esempio un
  logo esportato da un altro programma, si mostra come immagine del documento
  intero. «Modifica» lo adotta: aggiunge `xmlns:fub` e `fub:version` alla
  radice e lascia il resto com'è. L'adozione è un passo di annulla; annullarla
  riporta all'immagine.
- **Sola lettura.** Una dichiarazione DOCTYPE, una codifica diversa da UTF-8,
  una versione non valida o più recente, due elementi con lo stesso id, un file
  oltre i limiti dell'editor (`MAX_EDIT_BYTES` e `MAX_ELEMENTS` in
  `apps/client/src/editors/spatial/scene/read.ts`): il disegno si guarda come
  immagine, e l'avviso dice il motivo.
- **Illeggibile.** Un file che non è XML ben formato, con il byte dell'errore,
  o la cui radice non è `svg`: l'avviso dice il motivo e non mostra altro.

In tutti e tre i casi «Apri come sorgente» mostra il testo, per correggerlo.

## Apri come sorgente

«Apri come sorgente», nella palette e nel menu del riquadro, mostra lo stesso
documento come testo SVG, con l'anteprima accanto. È la stessa sessione: le
modifiche non salvate restano e il disco non si rilegge. «Chiudi la vista
sorgente» torna al disegno.

La scelta è della linguetta. Resta salvata con il layout dopo un riavvio, e non
passa alle altre linguette: un altro disegno aperto nello stesso riquadro si
apre come disegno.

## Più riquadri sullo stesso disegno

Due riquadri possono mostrare lo stesso disegno, anche uno come disegno e uno
come testo. Ogni gesto arriva agli altri riquadri senza ricaricare, e una
modifica fatta nel testo si vede subito nel disegno. Ogni riquadro annulla
soltanto i suoi gesti; un testo arrivato da fuori, da un altro riquadro o dal
disco, ricostruisce il disegno senza svuotarne la cronologia.

## Sessione live

Un tablet con la penna può scrivere sul disegno aperto sul PC, per esempio
collegato a un proiettore. Il protocollo, la sicurezza e i limiti sono in
[Sessione live](../reference/live-session.md); qui c'è il lato del PC, in
`apps/client/src/editors/spatial/live/`.

«Avvia la sessione live», nella palette, c'è solo nell'app desktop e su un
disegno di FubDraw che si modifica. In un browser le porte `live_*` non ci
sono e il comando non compare; nella shell mobile nemmeno, perché lì il
dispositivo è semmai lo scrittore *(proposta del 3 ottobre 2026, da
rivedere)*. Il codice della sessione arriva con un `import()` al primo avvio.

### Il pannello e l'indicatore

Il pannello mostra il QR da inquadrare col tablet e quanto vale ancora; il QR
porta il segreto dell'abbinamento e si mostra solo lì. Si chiude da sé quando
il tablet entra *(proposta del 3 ottobre 2026, da rivedere)*, e «Mostra la
sessione live» lo riapre.

- **Firewall.** Su Windows, prima del primo QR, una conferma spiega la
  richiesta del firewall che segue. Si mostra una volta per vault
  *(proposta del 3 ottobre 2026, da rivedere)*.
- **QR inutilizzato.** Dopo 60 secondi senza un tablet il pannello dice che
  una rete che isola i dispositivi blocca il collegamento, e propone
  l'hotspot del PC.
- **QR scaduto.** Non si rinnova da sé: «Nuovo codice» ne chiede uno
  *(proposta del 3 ottobre 2026, da rivedere)*.
- **Rete.** Con più interfacce il pannello lascia scegliere l'indirizzo. La
  scelta riapre la sessione con un QR nuovo, e solo finché nessun tablet è
  abbinato *(proposta del 3 ottobre 2026, da rivedere)*.
- **Diagnostica.** Chiusa finché non la si apre: latenza mediana e al 95°
  percentile, andata e ritorno, tratti persi, gesti applicati e rifiutati,
  indirizzo e interfaccia, dispositivo e capacità della penna.

L'indicatore è una riga sopra l'editor di ogni riquadro che mostra il
disegno, anche in Lettura. Dice chi scrive e la latenza mediana, o quanto
resta a un tablet caduto per tornare, e apre il pannello. Accanto c'è «Segui
il tablet»: la vista del PC insegue quella del tablet, e salta senza
animazione col moto ridotto. Chi muove la vista sul PC la riprende, e il
seguito si spegne; la scelta resta nel vault *(proposta del 3 ottobre 2026,
da rivedere)*.

La latenza va dal campione sul tablet al fotogramma del PC che lo mostra,
con lo scarto fra gli orologi stimato dalla sessione. Contano le ultime 512
misure, e una misura sotto zero vale zero *(proposta del 3 ottobre 2026, da
rivedere)*.

### L'inchiostro e i commit

L'inchiostro arriva prima del commit e si disegna sull'overlay del foglio, un
disegno per fotogramma. Si costruisce come lo scriverà il commit: campioni nel
livello, quantizzati come `fub:ink`, contorno di `pf1` con lo stesso pennello.
L'overlay tiene al più 256 Ki campioni; oltre, i tratti più vecchi si
buttano *(proposta del 3 ottobre 2026, da rivedere)*. Un tratto finito si
toglie se il suo commit non arriva entro 3 secondi, e si conta perso.

Il commit passa dal motore delle operazioni, lo stesso dei gesti locali, e poi
dalla sessione del documento come la modifica di un riquadro. Le superfici lo
ridisegnano nello stesso giro, e l'inchiostro si toglie subito dopo, prima
del prossimo fotogramma: l'elemento prende il posto del tratto senza
sfarfallio. Il documento che ne esce è lo stesso di un disegno fatto sul PC
con gli stessi tratti.

- **`ack`.** Porta l'eco canonica, cioè gli elementi come stanno nel
  documento, col `d` che il motore calcola. Un commit che non cambia il
  testo, un duplicato o un commit vuoto, risponde `duplicate` al `seq` di
  adesso *(proposta del 3 ottobre 2026, da rivedere)*.
- **`nack`.** Porta il motivo del motore, l'indice dell'operazione e il suo
  dettaglio, che è in italiano *(proposta del 3 ottobre 2026, da
  rivedere)*.
- **Nessun riquadro.** Un disegno mostrato come sorgente o in una linguetta
  dietro riceve i commit lo stesso: il motore lavora sul testo, senza
  painter.
- **Testo che non si modifica.** Se il testo smette di essere un disegno, per
  esempio durante una modifica nel sorgente, la sessione resta e i commit
  ricevono `nack` con `read-only` finché il testo torna leggibile
  *(proposta del 3 ottobre 2026, da rivedere)*.

Un gesto fatto sul PC arriva allo scrittore come `ops`, con l'eco canonica.
Ogni altro cambio del documento, come una modifica nel sorgente o una
ricarica dal disco, arriva come `snapshot` del testo intero, al più uno ogni
300 millisecondi *(proposta del 3 ottobre 2026, da rivedere)*. Un commit che
arriva prima applica il testo nuovo e manda lo `snapshot` prima della sua
risposta.

### La fine

«Termina la sessione live», nella palette e nel pannello, risponde ai commit
in attesa e chiude con `terminated`. I commit arrivati mentre la sessione si
chiudeva entrano nel disegno senza risposta *(proposta del 3 ottobre 2026, da
rivedere)*. Chiudere il documento chiude la sessione con `documentClosed`.
Una fine che arriva dall'host, come la chiusura dell'app, si annuncia; quella
chiesta dal comando no *(proposta del 3 ottobre 2026, da rivedere)*.

## Il file su disco

Un gesto è una modifica del testo, non una riscrittura del file. Il resto del
documento resta identico byte per byte: commenti, attributi di altri
programmi, blocchi che Fub non sa modificare e i terminatori delle righe non
toccate, anche quando il file mescola CRLF e LF.

## Selezione e rimandi

Gli oggetti scelti sono, per la shell, gli intervalli del file che li
contengono: le funzioni che lavorano sulla selezione ricevono il testo dei
loro elementi. Un rimando a un punto del file, per esempio da un risultato di
ricerca, sceglie l'oggetto che lo contiene e lo porta in vista; un punto fuori
dagli oggetti, come il titolo, lo dice con un avviso. In Lettura non c'è
selezione.
