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

Strumenti: penna (`P`), evidenziatore (`H`), gomma (`E`).

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

## Tratti molto lunghi e cambi di dispositivo

1. **Tratto lunghissimo.** Con la penna, disegna una spirale continua per circa
   due minuti senza alzare. Oltre i 10 000 campioni il tratto si scrive a
   pezzi: il disegno non ha buchi alla giunzione, l'app non rallenta in modo
   visibile e `Ctrl+Z` toglie un pezzo per volta, tutti col nome «Tratto». Se
   la giunzione si vede come uno scalino o un punto più spesso, annota dove.
2. **Cambio di dispositivo.** Disegna con il mouse, poi con la penna, poi di nuovo
   con il mouse, senza ricaricare. Ogni strumento deve rispondere come nella
   sua tabella; nessun gesto può restare «aperto» da un dispositivo all'altro.
3. **Rotazione del foglio.** Gira la vista con due dita, e disegna con la
   penna: il tratto parte sotto la punta e il suo spessore e la sua
   inclinazione non cambiano rispetto al foglio dritto.
4. **Simmetria.** Accendi la penna in simmetria e disegna: le copie nascono
   insieme al tratto, e un solo `Ctrl+Z` toglie il tratto e le sue copie.

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
