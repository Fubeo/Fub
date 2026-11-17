# Prova manuale dell'inchiostro

Questa guida dice come provare a mano penna, evidenziatore e gomma con il
mouse, il tocco e una penna, su una macchina vera.

> **Per chi:** chi cambia il nucleo dell'inchiostro, l'adattatore del browser,
> gli strumenti o il modo in cui un prodotto li usa, e chi prepara una
> versione.
> **Risultato:** una tabella di esiti per dispositivo, con ciò che è passato,
> ciò che non è passato e ciò che non si è potuto provare.

I test automatici provano le regole con campioni costruiti a mano e con
eventi finti di un browser simulato. Non provano un digitalizzatore, un
palmo vero, la latenza della webview né l'aspetto del tratto. Questa prova
copre ciò che resta, e non sostituisce [la verifica automatica](testing-and-quality.md).

## Quando farla

Prima di fondere un cambiamento che tocca uno di questi percorsi:

- `crates/fub-ink/` e `apps/client/src/ink/`;
- `apps/client/src/editors/spatial/tools/editor/` quando cambia il modo in cui
  un gesto di inchiostro comincia, prosegue o finisce;
- le impostazioni «Penna e dita».

Prima di una versione la si rifà almeno con il mouse e con un dispositivo
che abbia una penna. Un dispositivo che manca si scrive come **non provato**,
non come passato.

## Preparazione

1. Parti dal commit che vuoi provare e annotalo: `git rev-parse --short HEAD`.
2. Avvia l'app: `cargo tauri dev --config crates/fub-app/tauri.conf.json`. La
   webview cambia da sistema a sistema: annota anche quale usa la tua.
3. Apri un vault di prova e crea un disegno con `drawing.create`
   («Nuovo disegno…») dal modello «Vuoto».
4. Se hai una penna, apri **Penna e dita…** e lascia i valori di partenza
   (morbidezza 0, pressione minima 0, pieno da 100%). Il riquadro di prova della
   finestra è utile per vedere la pressione prima di passare al foglio.
5. Scrivi in testa alla tabella degli esiti: commit, sistema operativo,
   webview o browser, dispositivo, risoluzione e fattore di scala.

## Con il mouse

Strumenti: penna (`P`), evidenziatore (`Maiusc+P`), gomma (`E`).

| N. | Gesto | Atteso |
|---|---|---|
| 1 | Penna, trascina lento e poi veloce | un tratto continuo, senza scatti né punti staccati; lo spessore segue la velocità (il mouse non misura la pressione, e il pennello la simula): più sottile dove vai veloce |
| 2 | Penna, un clic senza muoversi | un punto tondo, non un trattino né niente |
| 3 | Penna, trascina fuori dal foglio e rilascia lì | il tratto finisce al rilascio; tornando sul foglio non c'è un tratto in corso |
| 4 | Penna, trascina e passa a un'altra finestra con `Alt+Tab` | il tratto sparisce e niente si scrive; al ritorno il mouse non disegna finché non lo premi di nuovo |
| 5 | Evidenziatore, trascina | tratto largo e semitrasparente, a punte piatte, che lascia vedere ciò che copre |
| 6 | Evidenziatore, trascina tenendo `Maiusc` | una retta dal punto di partenza a quello in cui rilasci |
| 7 | Gomma, trascina sopra due tratti | i tratti toccati si segnano durante il gesto e spariscono quando rilasci; ciò che non hai toccato resta |
| 8 | `Ctrl+Z` (`⌘Z`) dopo ciascuno | torna un passo per volta, con il nome «Tratto», «Evidenziatura» o «Cancellazione» |
| 9 | Salva, chiudi il disegno e riaprilo | gli stessi tratti, nello stesso posto e con lo stesso spessore |

La riga 3 e la riga 4 provano le fini del tratto che non sono un rilascio: se
un tratto resta in corso dopo un evento di cattura perso o di finestra
nascosta, è un difetto del nucleo, non della prova.

## Con una penna

La penna sensibile alla pressione è l'unico dispositivo che prova la curva, la
sospensione e il palmo. Prova con la mano appoggiata come quando scrivi.

| N. | Gesto | Atteso |
|---|---|---|
| 1 | Penna, tratto con pressione crescente | lo spessore cresce con la pressione; il tratto è liscio, senza gradini |
| 2 | Penna, tratto leggero e tratto forte | il leggero resta visibile (la pressione minima lo tiene); il forte riempie |
| 3 | Penna sospesa sopra il foglio, senza toccare | niente si disegna |
| 4 | Penna, appoggia la punta così piano che la pressione resta 0, e solleva | niente si scrive; non resta un puntino |
| 5 | Penna, un tocco breve con pressione normale | un punto tondo |
| 6 | Penna in **Penna e dita…**, cambia morbidezza e minimo | nel riquadro di prova il tratto cambia come la curva; con **OK** vale sul foglio; **Ripristina la curva** torna alla diagonale |
| 7 | Penna, tratto veloce e curvo | la linea segue la mano; la coda predetta, se la vedi, non lascia un segno che non hai fatto |
| 8 | Penna, scrivi una riga di testo a mano con la mano appoggiata | nessun segno del palmo |
| 9 | Penna, gomma per oggetto (`E`) | come con il mouse, con una zona di tocco di 8 pixel (16 con il dito) |

La riga 7 è soggettiva: guarda la fine del tratto dopo l'alzata, che deve stare
dove la penna si è fermata. Se la penna ha un sensore di inclinazione, il suo
effetto non si vede sul foglio; si vede solo nel file (`a` e `z` nei campioni
del tratto) e lo provano i test.

## Con il dito

| N. | Gesto | Atteso |
|---|---|---|
| 1 | Su una macchina dove non è mai stata vista una penna, un dito su un foglio | il dito disegna |
| 2 | Un dito che disegna, e poi se ne appoggia un secondo | il tratto del primo si annulla e il gesto è di navigazione (muovi, pizzica, ruota) |
| 3 | Due dita che si appoggiano e si alzano subito | annulla un passo («Niente da annullare.» se non c'è nulla) |
| 4 | Tre dita che si appoggiano e si alzano subito | ripete un passo |
| 5 | Con la penna accanto, un dito che si appoggia | il dito non disegna: è il palmo |
| 6 | Un dito che disegna, e la penna arriva sullo schermo | il tratto del dito si annulla e la penna comincia il suo |
| 7 | Dopo aver usato la penna, un dito sul foglio | il dito muove la vista e non disegna, finché non riapri il disegno |

La riga 6 è la più utile a chi scrive con la mano appoggiata: se il palmo lascia
un segno prima che la penna tocchi, il ruolo è stato deciso troppo tardi.

## La lavagna

Apri un file `.canvas` con una scheda di testo. Strumenti: la penna, la gomma
(il retro della penna), il tasto D, il menu della penna (nella riga delle
opzioni, con la Penna scelta nella colonna) e il pulsante «Scrivi col mouse»,
in testa alla barra di sotto.

| N. | Gesto | Atteso |
|---|---|---|
| 1 | Penna sopra una scheda, poi sul vuoto | il tratto resta alla scheda e la segue quando la sposti; sul vuoto è libero |
| 2 | Gomma sopra un tratto | il tratto sbiadisce mentre passi e sparisce quando alzi |
| 3 | Mouse, trascina tenendo D; poi senza | con D scrive (cursore a croce), senza seleziona come prima |
| 4 | «Scrivi col mouse», poi trascina | il pulsante ha il fondo dell'accento e il mouse scrive; D lasciato non lo spegne; di nuovo il pulsante, e torna a selezionare |
| 5 | Chiudi e riapri la lavagna | l'interruttore è spento; con «Ricorda se scrivi col mouse» acceso in Impostazioni, com'era |
| 6 | Un dito, poi due | uno sposta la lavagna, due la ingrandiscono; il palmo mentre scrivi non fa niente |
| 7 | `Ctrl+Z` dopo ciascuno | torna un tratto o una passata di gomma per volta |
| 8 | Menu della penna: Stilografica, Vermiglio, 8 px; poi un tratto | il pulsante dice «Penna: Stilografica, Vermiglio, 8 px» e il tratto dopo è così; un tratto già giù resta com'era |
| 9 | Evidenziatore, tratto sopra il testo di una scheda | giallo a metà, il testo si legge sotto |
| 10 | Gomma, «Solo il pezzo»; punta o mouse sopra un tratto | cursore a cella; si toglie solo il pezzo strofinato |
| 11 | Il menu con la tastiera: Tab, frecce, Esc | Tab salta fra i gruppi, le frecce scelgono, Esc chiude e torna al pulsante |
| 12 | Chiudi e riapri la lavagna | la penna scelta è ancora quella |

## Tratti molto lunghi e cambi di dispositivo

1. **Tratto lunghissimo.** Con la penna, disegna una spirale continua per circa
   due minuti senza alzare. Oltre i 10 000 campioni il tratto si scrive a
   pezzi: il disegno non ha buchi alla giunzione, l'app non rallenta in modo
   visibile, la linea resta sotto la punta fino alla fine e `Ctrl+Z` toglie un
   pezzo per volta, tutti col nome «Tratto». Se
   la giunzione si vede come uno scalino o un punto più spesso, annota dove.
2. **Cambio di dispositivo.** Disegna con il mouse, poi con la penna, poi di nuovo
   con il mouse, senza ricaricare. Ogni strumento deve rispondere come nella
   sua tabella; nessun gesto può restare «aperto» da un dispositivo all'altro.
3. **Rotazione del foglio.** Gira la vista con due dita, e disegna con la
   penna: il tratto parte sotto la punta e il suo spessore e la sua
   inclinazione non cambiano rispetto al foglio dritto.
4. **Vista che scorre sotto la punta.** Con la gomma giù e ferma accanto a un
   oggetto, scorri la vista con la rotella o il trackpad fin oltre l'oggetto,
   poi alza senza muovere: l'oggetto resta. Con la penna lo stesso gesto non
   lascia una coda dritta.

## Le schede vive

Questa prova copre il cancello di N6 sui file che arrivano dal sistema: un
`.xlsx` vero trascinato dal file manager sulla lavagna, una penna sopra la
scheda di foglio, poi chiudi e riapri. Il file del computer non deve cambiare, e
nel vault non deve comparire nient'altro. La fanno anche chi cambia
`state/canvas-intake.ts`, `editors/media/attachment-target.ts` o la scelta
«Dove vanno i file trascinati». Il vault è una cartella di prova, mai quello di
lavoro: il `.xlsx` sta fuori dal vault, per esempio sul desktop.

Prima della prova, in un terminale (Linux):

```bash
VAULT=$(mktemp -d)                                  # il vault di prova
printf '{"nodes":[],"edges":[]}\n' > "$VAULT/lavagna.canvas"
sha256sum ~/Scrivania/prova.xlsx                    # prima: annota l'impronta
```

Apri `$VAULT` nell'app (il comando è quello della Preparazione) e segui la
tabella.

| N. | Gesto | Atteso |
|---|---|---|
| 1 | Apri `lavagna.canvas` dall'albero | la lavagna vuota |
| 2 | Trascina `prova.xlsx` dal file manager su uno spazio vuoto della lavagna e rilascia | nasce una scheda di foglio nel punto del rilascio; la notifica dice «Copiati in attachments/», con «Cambia cartella» |
| 3 | Con la penna (o col mouse, con «Scrivi col mouse» acceso), un tratto sopra la scheda di foglio | il tratto resta sulla scheda e la segue quando la sposti |
| 4 | Chiudi la lavagna, chiudi l'app, riaprila e riapri il vault | foglio e tratto al loro posto; niente altra copia |
| 5 | Trascina di nuovo `prova.xlsx` sulla lavagna | nessun file nuovo in `attachments/`; la notifica dice «Già nel vault come attachments/prova.xlsx, uso quello», con «Fanne una copia» |
| 6 | Nel terminale: `mv "$VAULT/attachments/prova.xlsx" "$VAULT/attachments/bilancio.xlsx"`, poi trascina `prova.xlsx` ancora | la notifica trova `attachments/bilancio.xlsx`; ancora nessun file nuovo |
| 7 | Guarda le celle del foglio nella scheda | le celle del `.xlsx` vero, come nel file. È l'unica parte che la prova automatica non fa: il finto non apre i fogli |

Alla fine, nel terminale, le impronte e i file del vault:

```bash
sha256sum ~/Scrivania/prova.xlsx "$VAULT"/attachments/*.xlsx   # dopo: uguali a prima
find "$VAULT" -type f -not -path "*/.fub/*"                    # solo la lavagna e la copia
```

Su Windows e su macOS la prova la fa l'utente con gli stessi passi, e
l'impronta si calcola con `certutil -hashfile <file> SHA256` e con
`shasum -a 256 <file>`. Annota il commit (`git rev-parse --short HEAD`), il
sistema e la webview, come nelle altre sezioni.

## Che cosa annotare

Per ogni riga scrivi uno di tre esiti:

- **passa**: il comportamento atteso;
- **non passa**: che cosa hai visto, con il gesto che lo ripete;
- **non provato**: perché (dispositivo mancante, funzione non montata).

Per un difetto aggiungi, quando puoi, una registrazione dello schermo e il
file del disegno, se il tratto è scritto male. Il file basta spesso a
riprodurlo in un test: i campioni del tratto sono dentro.

## Cosa non è coperto

- l'aspetto del tratto a ogni zoom e la sua resa nei temi: li guardano il
  [banco visivo e quello dell'accessibilità](testing-and-quality.md);
- le prestazioni: le misurano `cargo bench -p fub-ink` e `npm run bench:ink`, e
  sono un confronto fra due stati, non una soglia;
- l'accessibilità da tastiera dei disegni, che ha le sue prove;
- il lavoro sul PDF, sospeso.
