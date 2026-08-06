# 0112 — Un e2e contro un host finto non prova l'app: prova il cablaggio

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§17.2](../roadmap/17-presidi-che-restano.md#172-test-della-shell)
**Commit**: *(questo commit)*

---

## La domanda

La voce chiedeva gli **e2e dell'app reale** — «tauri-driver/Playwright sui flussi
critici: apri vault, scrivi, rinomina, cerca, ripristina» — e nella riga in
corsivo sotto il titolo diceva un'altra cosa: *«gira contro l'host finto della
1.3»*. Le due metà della stessa voce non descrivono lo stesso presidio, e la
domanda vera è quale delle due valga il prezzo.

## La decisione, in una riga

> **La shell si monta intera, sulla scocca vera, contro un host finto**: si
> guida `main.ts` con dei gesti e si guarda cosa arriva alla porta. Non è l'app
> — il ponte Tauri, la webview e il kernel restano fuori, e sta scritto nel
> presidio stesso — ma è l'unica cosa che oggi nessun altro presidio guarda: il
> **cablaggio**, cioè ciò che vive *fra* i moduli.

## Perché non Playwright, e perché non tauri-driver

Non è una rinuncia per pigrizia, ed è una decisione di supply chain: si scarta
**avendolo detto**, che è la forma della [0109](0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md).

Un runner di browser chiede un browser: `@playwright/test` porta con sé un
binario scaricato a parte, che la politica della
[0001](0001-supply-chain-e-sbom.md) misura come una dipendenza a tutti gli
effetti — e che nessun SBOM del repo saprebbe dichiarare. `tauri-driver` chiede
di più: un'app **impacchettata**, un `WebKitWebDriver` di sistema su Linux e un
`msedgedriver` su Windows, cioè un presidio che gira su una macchina e non su
tre. Sarebbe diventato il secondo presidio di questa seduta che non gira — il
primo è il banco delle prestazioni del §17.1, e la §17.1 dice già perché.

Ma la ragione che decide non è il costo: è **cosa si sarebbe provato in più**.
Un e2e dell'app vero prova tre cose che qui restano fuori — che il ponte
serializzi i record, che la webview li disegni, che il kernel faccia ciò che
gli si chiede. La terza ce l'ha già, ed è `cargo test`, che la prova meglio di
qualunque click. Le prime due sono reali e restano scoperte, ed è il **buco
dichiarato n. 5** in fondo a questo verbale. Ciò che invece nessuno provava — e
che non chiede un browser per essere provato — è tutto il resto.

## La premessa che regge, e le tre che non reggono

- **Regge, ed è il perno**: l'host finto è possibile perché il §1.3 ha fatto del
  confine **un file solo** (`host/ipc.ts`, più `host/dialog.ts` per ciò che si
  chiede al sistema operativo). Il presidio che lo tiene fermo
  (`no-tauri-outside-host.test.ts`) esiste già, e `docs/architecture/shell.md`
  nominava questi e2e fra i suoi clienti futuri.
- **Falsa**: «l'host finto della 1.3». Non esiste, e non è mai esistito. La
  [0015](0015-la-forma-della-shell.md) diceva che quel giro lo *rendeva
  possibile*, non che lo avesse scritto. Ciò che c'è sono **quattro** `vi.mock`
  scritti a mano dentro altrettanti file di prova, ognuno con due o tre metodi
  del confine e nessuno tipizzato: un mock che risponde a una porta che la shell
  non ha più passa verde per sempre, perché la sua forma non la guarda nessuno.
- **Falsa, e detta in tre posti**: «questa shell non ha un ambiente DOM nei
  test» (`docs/architecture/ui-protocol.md`, e le due decisioni che le hanno
  dato l'argomento). `happy-dom` è nelle dipendenze di sviluppo, e **cinque**
  file di prova ci giravano dentro già prima di questo. Ciò che manca al cammino sul DOM del sanitizer non è
  l'ambiente: è che nessuno l'abbia scritto. La riga architetturale è riparata;
  le due decisioni no, perché un verbale è datato.
- **Falsa nel numero**: la voce elenca cinque flussi, ma «rinomina» ne è due —
  quella che chiede questa finestra e quella che arriva da fuori — e la seconda è
  l'unica in cui il difetto c'era davvero.

## Cosa l'host finto è, e le tre regole che lo tengono onesto

`frontend/src/host/finto.ts` è un vault in memoria: file, revisioni, cestino,
eventi, i cinque comandi strutturali di `COMANDI`, e il pezzo di linguaggio delle
query che una shell parla. Tre regole, e ognuna ha un motivo misurato:

1. **È un modulo intero, non un pezzo di modulo.** Il tipo di ritorno è
   `typeof import("./ipc")`, quindi una porta nuova nella shell non compila
   finché il finto non la sa rispondere. È l'attore giusto: il compilatore
   prende la variante che non vuol dire niente. Ha già lavorato mentre lo
   scrivevo — tre record erano sbagliati, e uno (`CommandOutcome.partial`) era
   un campo nato con la [0101](0101-una-voce-non-e-un-passo.md) che nessun
   mock scritto a mano avrebbe mai avuto.
2. **Non conosce nessuna feature.** Ciò che sa eseguire è del contratto.
3. **Ciò che non sa fare lancia.** Una query che non riconosce, un comando che
   non ha, una view che non ha dichiarato: eccezione, mai una risposta vuota. Un
   finto accomodante è il modo più rapido di scrivere un e2e che passa mentre la
   shell chiede la cosa sbagliata — e «vuoto» è indistinguibile da «non c'era
   niente».

Una riga di produzione è cambiata per lui, e vale la pena dire perché:
`main.ts` **esporta l'avvio** (`export const avvio`). Non serve in produzione —
là è l'ultimo file che gira — serve perché senza quella riga il montaggio non è
*osservabile*, e un e2e che non può aspettare la fine del boot deve dormire un
tempo a caso: cioè diventa un presidio che ogni tanto passa.

## Il difetto peggiore stava dentro i gesti, e nessuno lo vedeva

Il secondo gesto della voce ne ha trovato uno vero, e grosso.

L'albero dei file ha **un** ascoltatore di tastiera sul contenitore
(`frecceNellAlbero`), e la rinomina in posto mette un **campo di testo dentro
una voce dell'albero**. Ogni battuta là dentro risaliva fino a quell'ascoltatore:

- **Invio** confermava la rinomina **e** faceva `click` sulla riga, cioè
  riapriva il path vecchio — che dopo la rinomina non esiste più. Risultato
  misurato: una tab fantasma sul nome vecchio, e il salvataggio automatico
  successivo che **ricrea il file appena rinominato**. Chi rinomina col mouse e
  poi continua a scrivere si ritrova due note, e ciò che scrive finisce in
  quella col nome sbagliato;
- le **frecce** erano lo stesso difetto in tono minore: il `preventDefault`
  impediva di muovere il cursore dentro il nome che si stava scrivendo.

La riparazione sta nel contenitore e non nel campo — chi mette un input dentro
l'albero non deve saperlo — ed è la regola che ogni contenitore che ascolta la
tastiera dei propri figli deve avere: **i tasti di un campo sono del campo**.

E un secondo, dal gesto che la voce non contava. Su una rinomina che **questa
finestra non ha chiesto** — un `mv` da terminale, un'altra applicazione, un sync
— il buffer sporco migrava col nome nuovo, ma il timer del debounce portava il
nome **vecchio** dentro la sua chiusura: allo scadere cercava un buffer che non
c'era più e usciva subito. Il testo restava in RAM, senza che nulla lo dicesse.
Adesso il salvataggio in attesa segue il buffer.

## Il rosso, e il presidio che passava a vuoto

Nove rami tolti uno per volta. Tre sono la misura che ha cambiato il lavoro:

- **la migrazione del buffer sulla rinomina era già lì, e toglierla non rendeva
  rosso niente** — nemmeno con l'e2e completo dei cinque gesti, perché
  `renameDoc` mette in salvo i buffer *prima* di chiedere la rinomina, quindi da
  dentro questa finestra quel codice non ha mai un caso. Non è codice morto: ha
  un caso, ed è la rinomina che arriva da fuori. Da lì è nato il settimo gesto,
  e con lui il difetto del paragrafo sopra;
- un presidio che avesse guardato **solo il path** della scrittura dopo la
  rinomina sarebbe rimasto verde lo stesso: senza la migrazione ne nasce un
  buffer nuovo, che scrive sul path giusto ma con base `dictated`, cioè coprendo
  quel che trova senza guardare. Il gesto asserisce la **base**, non il path;
- il primo `refresh: spec.refresh` che ho tolto ha dato verde e mi ha quasi
  fatto scrivere che la maschera non era presidiata: erano **due** i posti che
  la passano, e ne avevo toccato uno. Con l'altro il gesto del cestino è rosso.
  Vale come nota di metodo: una prova del rosso su un `grep` che trova due
  righe e ne cambia una dice il falso.

Gli altri sei rami — l'apertura del vault iniziale, la base che discende dalla
revisione letta, la tab che segue la rinomina, il filtro dei tasti del campo, la
riga di risultato che apre, la maschera della view — sono tutti rossi.

## Il conto, e cosa non vede

`gesti-della-shell` conta gli `it` del file. È la disciplina della
[0109](0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md) applicata a una
suite che non si svuota per un `cfg` ma per una riga cancellata o per un
`it.skip` messo «per un attimo» — e il conto li vede tutti e due, perché
`it.skip(` non è `it(`. **Non vede** un `it` che non asserisce niente: per quello
l'attore è la verifica del rosso, e si fa a mano.

## Il ritaglio: zero

Non tocca il WIT, né alcun tipo del contratto. Nessuna dipendenza npm nuova:
`happy-dom` c'era già, e con lui cinque file di prova.

## Cosa non è chiuso, e va detto

- **Buco dichiarato n. 5**: che il ponte Tauri serializzi davvero questi record e
  che la webview li disegni. Il primo lato ha un presidio parziale — il mirror
  del contratto — il secondo nessuno. Un buco dichiarato non è una casella e non
  entra in nessun totale ([0064](0064-il-supporto-sta-sotto.md)).
- **Il layout non si prova**: in `happy-dom` non c'è né CSS né misura, quindi
  l'e2e asserisce su *cosa* c'è e mai su *dove*. È lo stesso confine che il
  presidio di accessibilità dichiara, e per la stessa ragione.
- **I quattro `vi.mock` scritti a mano restano**: sono di prove pure che
  chiedono due metodi, e riscriverli contro il finto sarebbe stato un giro di
  churn dentro una voce di presidi. Ciò che è cambiato è che adesso esiste la
  cosa giusta da usare — e chi ne scrive un quinto lo fa scegliendo.
- **Un dettaglio di attrezzo che costa un'ora se lo si riscopre**:
  `vi.resetModules()` svuota il registro dei moduli ma **non** quello dei mock.
  Una factory che restituisca l'host di adesso viene eseguita una volta sola, e
  ogni prova dalla seconda in poi parla col vault della prima — con la shell
  rimontata a dovere, che è il modo migliore per non accorgersene. Il modulo
  mimato è quindi uno solo e delega all'host corrente a ogni chiamata.
