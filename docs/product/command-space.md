# Spazio comandi (Ctrl O)

> **Per chi:** chi apre note, comandi, etichette e blocchi dalla tastiera.
> **Risultato:** sapere che cosa cerca ogni prefisso, che cosa fanno Invio,
> Tab e Maiusc-Invio, e quando compare l'anteprima.

## Che cos'è

Lo spazio comandi è il **lanciatore**: una sola superficie per aprire una nota,
cercare nel testo, lanciare un comando e inserire un blocco. Si apre con
`Ctrl O` (il comando «Vai alla nota»), con la pillola della barra del titolo,
con il comando «Cerca nel vault dal lanciatore» e con il menu «Cerca fra tutti
i comandi» di un menu contestuale.

Il campo tiene sempre il fuoco. Sotto il campo c'è la fila dei modi, e sotto
ancora l'elenco. Il modo si sceglie in tre modi: scrivendo il prefisso in testa
al campo, cliccando la linguetta, oppure con il comando che apre quel modo.

## I modi

| Modo | Prefisso | Che cosa elenca |
|---|---|---|
| Tutto | nessuno | le note per nome, il testo delle note e i titoli della nota aperta |
| Comandi | `>` | i comandi del registro e le viste |
| Etichette | `#` | le etichette del vault, con quante note le portano |
| Persone | `@` | le note della cartella delle persone; una persona che non c'è si crea |
| Blocchi | `/` | i blocchi che il «/» della nota aperta sa inserire |
| Aiuto | `?` | i comandi che hanno un tasto, col tasto che vale adesso |
| Riga | `:` | una riga della nota aperta, come `12` o `12:5` |

Il prefisso conta solo in testa al campo: `#tema` è un'etichetta, ma `a #tema`
è testo. Per cercare un testo che comincia con `#` o con `>` si scrive prima uno
spazio. Un prefisso scritto da solo porta nel modo con la domanda vuota. Togliere
il prefisso, o cancellare a campo vuoto con Backspace, torna a Tutto.

Ogni modo ricorda la sua ultima domanda finché il lanciatore vive. Una domanda
scritta in Tutto resta quando si passa a Comandi e si torna.

### Tutto

A campo vuoto Tutto mostra le **note recenti** e tre comandi della **nota
aperta**: esporta, duplica e nuova sottopagina. Se non c'è né una cosa né l'altra,
lo dice.

Con un testo Tutto mostra tre gruppi, nell'ordine:

- **Note**: le note il cui nome contiene il testo;
- **Nel testo**: le note in cui il testo compare nel contenuto, con l'estratto e
  il punto del primo riscontro (le note già elencate non si ripetono);
- **Titoli**: i titoli della nota aperta che contengono il testo.

Un gruppo che non ha righe non compare. Un elenco lungo si ferma a 200 righe e
dice quante sono in tutto. Una sintassi di ricerca a metà (per esempio una
virgoletta aperta) si dice, senza fermare i gruppi che trovano qualcosa.

Quando non c'è niente, la frase dice che cosa fare. Se il testo può diventare il
nome di una nota, la frase propone `Maiusc-Invio` per crearla; se non può (per
esempio è fatto solo di barre), non propone niente.

## I gesti

| Tasto | Che cosa fa |
|---|---|
| Invio | apre la riga attiva qui, o esegue il comando, o inserisce il blocco |
| Ctrl-Invio (Cmd-Invio su Mac) | apre a lato, in un riquadro accanto a quello col fuoco |
| Alt-Invio | apre a lato, finché non c'è la sbirciata |
| Maiusc-Invio | apre come Invio; senza righe, crea la nota col nome scritto |
| Tab | mostra le azioni della riga attiva, se è una nota o una persona |
| Esc | dalle azioni torna all'elenco; altrimenti chiude il lanciatore |
| Ctrl Maiusc Invio | porta la domanda nel pannello Cerca, dove c'è una domanda |
| Backspace a campo vuoto | torna a Tutto |

Tab non cambia modo: mostra le azioni. Le azioni di una nota sono **Apri qui**,
**Apri a lato**, **Rinomina o sposta…** (il comando del kernel `note.rename`),
**Copia il link**, **Appunta** (o **Togli dagli appunti**, se è già appuntata).
Scrivere nel campo lascia le azioni e torna all'elenco.

Con un tocco, senza tastiera, il piede mostra il bottone **Azioni**, che fa
quello che fa Tab. L'anteprima non c'è al telefono.

### Maiusc-Invio e le note nuove

Maiusc-Invio crea una nota solo quando non c'è nessuna riga da scegliere. La
nota nasce nello spazio attivo, col nome scritto, e il fuoco va nell'editor.

- Un nome che il file non accetta (barre, due punti, caratteri di controllo) si
  corregge da solo: quei caratteri diventano spazi. Il nome proposto è quello
  che la frase mostra.
- Un nome già preso non crea una seconda nota: apre quella che c'è e lo dice.
- Mentre la risposta non è ancora arrivata, Maiusc-Invio non crea niente: aspetta
  che si veda la risposta.

### Riga e Aiuto

Il modo Riga legge la riga e la colonna, e porta il cursore nel punto della nota
aperta. Vale solo per una nota di testo.

Il modo Aiuto elenca i comandi che hanno un tasto. Il tasto è quello che vale
adesso, anche quello cambiato dall'utente nelle impostazioni. Invio non fa
niente: serve a leggere.

## L'anteprima

In Tutto, quando la finestra è larga abbastanza, a destra dell'elenco c'è
l'anteprima della nota della riga attiva. Segue le frecce, ma aspetta una pausa
breve (90 ms) prima di chiedere la nota: chi scorre in fretta non fa partire una
resa per ogni riga. Mentre la resa nuova arriva resta quella di prima; se tarda,
si attenua. Una nota che non si riesce a rendere lo dice nel riquadro.

## Dove sta

Il codice è in `apps/client/src/shells/scrittoio/launcher/`:

- `model.ts`: i modi, il prefisso, il gesto di apertura;
- `sources.ts`: che cosa elenca ciascun modo;
- `actions.ts`: che cosa fa una riga scelta, le azioni di Tab, la creazione;
- `commands.ts`: i comandi che aprono il lanciatore;
- `preview.ts`: l'anteprima;
- `launcher.ts`: il disegno, i tasti e la gara fra le risposte.

Le parole sono in `i18n/catalog.ts`, con la chiave `launcher.*`.

## Che cosa non c'è ancora

- Il modo Persone non elenca ancora i giorni (la pagina del giorno).
- Alt-Invio apre a lato, non nella sbirciata, finché la sbirciata non c'è.
- Il modo Aiuto elenca i comandi che hanno un tasto, non ancora quelli del punto
  in cui si è: la riga dei suggerimenti li porterà.
- Dal lanciatore non si apre più una nota in una finestra nuova: quella resta
  nel menu della scheda e in quello dell'albero.
