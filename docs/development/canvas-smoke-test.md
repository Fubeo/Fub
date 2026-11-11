# Prova manuale della lavagna

Questa guida dice come provare a mano, nella finestra vera, gli otto scenari
principali della lavagna: il «pigro alla prova».

> **Per chi:** chi cambia `apps/client/src/editors/canvas/`, il nucleo della
> lavagna (`crates/fub-canvas*`) o il modo in cui la shell la monta, e chi
> prepara una versione.
> **Risultato:** una tabella di esiti per sistema, con ciò che è passato, ciò
> che non è passato e ciò che non si è potuto provare.

La prova automatica degli stessi otto scenari è
[`canvas-lazy.e2e.test.ts`](../../apps/client/src/canvas-lazy.e2e.test.ts):
gira sulla shell vera con l'host finto, in happy-dom. Non vede una webview,
un PDF disegnato davvero, una penna, il disco né i tempi di una macchina vera.
Questa prova copre ciò che resta, e non sostituisce [la verifica
automatica](testing-and-quality.md).

## Quando farla

Prima di fondere un cambiamento che tocca uno degli scenari, e prima di una
versione. Prima di una versione la si rifà su ogni sistema a portata di mano:
Linux (WebKitGTK), Windows (WebView2), macOS (WebKit). Un sistema che manca si
scrive come **non provato**, non come passato.

## Preparazione

1. Parti dal commit che vuoi provare e annotalo: `git rev-parse --short HEAD`.
2. Avvia l'app: `cargo tauri dev --config crates/fub-app/tauri.conf.json`.
3. Apri un **vault di prova**, mai quello di tutti i giorni: la prova toglie
   schede, sposta file e scrive nelle lavagne.
4. Tieni pronti, fuori dal vault:
   - un PDF di almeno 9 pagine;
   - 40 foto (`.jpg` o `.png`), in una cartella sola.
5. Nel vault: una nota lunga (qualche schermata di testo) e una lavagna nuova
   con due o tre schede di testo, di cui una lontana dalle altre.
6. Scrivi in testa alla tabella degli esiti: commit, sistema operativo,
   webview e versione, dispositivo (mouse, touchpad, penna), schermo e fattore
   di scala.

Su macOS `Ctrl` è `⌘` e `Canc` è `⌫`.

## Il giro

| N. | Scenario | Gesto | Atteso |
|---|---|---|---|
| 1 | Il PDF da scriverci sopra | Trascina il PDF dal sistema sulla lavagna; clic sulla scheda, `PgGiù` fino alla pagina 7; scrivi un tratto con la penna (o col mouse con **Scrivi col mouse**) sulla pagina; `PgGiù`, poi `PgSu`. Poi tasto destro sulla scheda, **Spargi le pagine…**, scrivi `5-9`, **Spargi** | Il file finisce nella cartella che la banda dice, e la scheda mostra «1 / N». Il tratto si vede sulla 7, non sulla 8, di nuovo sulla 7. Nascono cinque schede in riga accanto, le pagine 5–9, senza gruppo; il PDF di partenza tiene il suo tratto |
| 2 | Collegare due idee | Tieni `Alt` e trascina dal corpo di una scheda (non da un punto sul lato) fino a un'altra. Poi scegli una scheda, **Collega** nella barra della selezione, e un clic su una terza | Durante il trascinamento la scheda d'arrivo si accende; al rilascio nasce un filo fra le due. Dopo **Collega** il clic sulla terza chiude il filo dalla scheda scelta |
| 3 | L'idea senza posto | Doppio clic nel vuoto; `Invio`; scrivi; `Ctrl+Invio`; scrivi; `Ctrl+Maiusc+Invio` | Il doppio clic fa nascere una scheda di testo scelta, al centro della vista; `Invio` la apre in scrittura. `Ctrl+Invio` la chiude col suo testo e apre sotto una scheda larga uguale, già in scrittura. `Ctrl+Maiusc+Invio` apre la prossima a destra, collegata con un filo |
| 4 | Non so dove sono | `0` (100%), poi `Maiusc+1`; di nuovo `0`; un clic in un angolo del navigatore; `Alt+←` | Al 100% la lavagna esce dalla vista e il navigatore compare; `Maiusc+1` vola fino a mostrare tutta la lavagna. Il clic sul navigatore vola lì; `Alt+←` torna dov'eri prima del salto |
| 5 | La scheda sbagliata | Scrivi un tratto sopra una scheda; `Q` (il lazo) e un giro attorno al tratto; trascinalo su un'altra scheda; **Rendilo libero** | Il giro sceglie solo il tratto. Durante il trascinamento la scheda d'arrivo si incornicia e ne dice il nome; al rilascio l'avviso dice «Ora fa parte di…» col nome, con **Annulla** e **Rendilo libero**. **Rendilo libero** lascia il tratto dov'è, della lavagna, e l'avviso se ne va |
| 6 | La scheda tolta con mezz'ora di testo | Scegli la scheda della nota lunga; `Canc`; `Ctrl+Z`; di nuovo `Canc`; **Annulla** nell'avviso | `Canc` toglie la scheda e l'avviso dice «Tolta dalla lavagna. Il file resta.» con **Annulla**. `Ctrl+Z` e **Annulla** la riportano allo stesso posto, con la stessa misura. La nota non cambia: aprila, il testo è tutto lì, e nel cestino non c'è niente |
| 7 | Il salvataggio dimenticato | Dopo ognuno dei gesti sopra, senza salvare, guarda la banda in basso; poi chiudi l'app e riaprila | La banda passa per «Da salvare: 1» e torna a «Tutto salvato» da sola, subito dopo il gesto. Riaperta, la lavagna è com'era all'ultimo gesto |
| 8 | Le 40 foto | Trascina le 40 foto insieme sulla lavagna; clic sulla testata del gruppo «40 file»; trascina la testata | Nascono 40 schede in righe, dentro un gruppo «40 file»; la lavagna non si blocca. Il trascinamento sposta il gruppo e tutte le 40 foto insieme, in un passo solo: un `Ctrl+Z` le riporta tutte |

Per ogni riga annota **passato**, **non passato** (con che cosa si è visto) o
**non provato**. Un gesto che sbaglia una volta su dieci è un non passato:
scrivi quante volte su quante.

## Che cosa la prova automatica non vede

- La pagina del PDF disegnata davvero, e il tratto al suo posto sulla pagina:
  la prova conta la pagina che la scheda dice, non i pixel.
- La penna, il palmo e il touchpad: la prova usa eventi finti.
- Il disco e il tempo: la prova scrive su un vault finto, che risponde
  subito.
- La riapertura dell'app dopo la riga 7.

## Che cosa fare di un esito rosso

- Se lo stesso scenario è rosso anche in `canvas-lazy.e2e.test.ts`, la causa
  è del prodotto: apri una issue con la riga e il commit.
- Se è rosso solo nella finestra vera, scrivi sistema, webview e versione
  nella issue, e se puoi un video.

L'esito sta nella descrizione della PR, come tabella.
