# La forma della shell

Torna a [PIANO.md](../PIANO.md) · [ui-protocol.md](ui-protocol.md) · [i verbali](../decisions/README.md)

Questo documento dice **dove sta cosa** nel frontend, e quali sono le due o tre
regole che tengono in piedi quella divisione. È il verbale operativo della
[decisione 0015](../decisions/0015-la-forma-della-shell.md): lì c'è il perché,
qui c'è la mappa da consultare quando si scrive un file nuovo.

## Perché un albero dichiarato

Il frontend è nato piatto: quattordici file in `frontend/src/`, con `main.ts` a
1622 righe, 81 funzioni di primo livello e 18 variabili globali mutabili. Non è
successo per disattenzione — è successo perché **non c'era un posto dove
mettere le cose**, e in mancanza di un posto ogni aggiunta finisce nel file più
grande. Il costo non si paga scrivendo la voce che lo provoca: lo paga quella
dopo.

E quelle dopo erano già scritte nella roadmap. Tre sono **arrivate subito**, con
la [decisione 0016](../decisions/0016-cosa-e-una-view.md): venticinque specie di
nodo nuove sul renderer `UiNode`, il riconciliatore con le chiavi accanto, e sei
superfici in più da ospitare. Le altre sono in coda — il
[§18.2](../roadmap/18-editor-e-tastiera.md) porta un registro di scorciatoie, il
[§10.3](../roadmap/10-gli-eventi.md) un centro notifiche. Senza un albero, la
divisione la decide chi tocca il file per ultimo; con l'albero, la seduta 2 ha
toccato `ui/node.ts`, `ui/views.ts` e `host/contract.ts` e nient'altro.

## L'albero

```
frontend/src/
  main.ts        il punto di montaggio: compone e nient'altro
  style.css      le regole dei componenti

  host/          la cucitura con l'esterno, e nient'altro
    contract.ts    i tipi (e i pochi valori) rispecchiati dal Rust (nessun @tauri-apps)
    ipc.ts         `api` + il canale eventi: i comandi del backend
    query.ts       il canale dati: si costruisce una query, si apre una risposta
    dialog.ts      le superfici di SISTEMA: conferme, selettore di cartella

  state/         lo stato condiviso e ciò che lo cambia
    store.ts       i campi condivisi + il bus dei segnali + lo stato di vista
    kernel.ts      il router degli eventi del kernel
    vault.ts       le operazioni sul vault (tutte dal registro comandi)
    organization.ts  il sidecar .fubmd/workspace.json

  ui/            le primitive di interfaccia, senza dominio (un'eccezione: intents.ts)
    node.ts        il renderer di `UiNode`
    panel-host.ts  il registro dei pannelli: chi c'è, e quando si ridisegna
    views.ts       l'adattatore `ViewSpec` → pannello, per ciò che il backend dichiara
    intents.ts     gli intenti che la shell sa eseguire (l'unico qui che nomina i pannelli)
    palette.ts     la palette dei comandi
    menu.ts        menu contestuale e selettore di icona
    notify.ts      i messaggi che non chiedono risposta
    dom.ts         `$`

  panels/        un modulo per dominio
    document.ts    l'editor, il buffer, la modalità, il contesto di sessione
    preview.ts     il documento reso (modalità Lettura) e gli embed
    explorer.ts    l'albero, gli spazi, le appuntate, il drag & drop
    search.ts      la barra e i risultati (§21.4-§21.5: qui atterrano anche il
                   quick switcher e la ricerca dentro la nota aperta — una porta
                   sola verso l'indice, non tre)
    trash.ts       il cestino, e la conferma prima di cestinare
    history.ts     la cronologia delle versioni
    sidebar.ts     quale pannello della sidebar occupa lo spazio
    graph.ts       il grafo su canvas (superficie privilegiata, fuori da UiNode)

  editor/        i moduli CodeMirror, autonomi e iniettati
    editor.ts, editor-commands.ts, completions.ts, livepreview.ts

  rules/         le regole condivise col Rust
    organizer.ts   alberatura, folder note, nome pagina
    offsets.ts     il ponte byte UTF-8 ↔ code unit UTF-16

  theme/         i token
    tokens.css

  __fixtures__/  le fixture generate da serde (il mirror TS↔Rust)
```

Un file dell'albero **non rispetta** la riga che lo ospita, e vale la pena
dirlo qui invece di lasciarlo scoprire: `ui/intents.ts` importa
`panels/document` e `panels/search`, mentre `ui/` è per il resto senza dominio.
Non è una svista ed è il posto meno peggio: gli intenti arrivano da due sorgenti
diverse (un `ViewUpdate` di una view e un `CommandEffect` di un comando) e sono
gli stessi perché sono intenti **della shell** — una copia per sorgente sarebbe
una copia da tenere allineata. Il vincolo che lo rende innocuo è che nessun
modulo di `panels/` importa `intents.ts`: è un pozzo, non un anello, e finché
resta tale il ciclo non c'è.

Due cartelle dell'albero **non esistono ancora come codice**, e non è una
dimenticanza:

- `i18n/` — dipende dal [§12.1](../roadmap/12-stringhe-errori-locale.md), che è
  una decisione non ancora presa: dove vive il catalogo, chi localizza gli
  errori del confine, e in che forma. Fare la cartella prima della decisione
  significa deciderla per inerzia.
- `theme/` esiste ma con **solo i token di oggi**. Il sistema vero — scala
  semantica, chiaro/scuro/sistema, snippet CSS dell'utente, alto contrasto e
  reduced motion — è 6.2 e 25.1 di FEATURES; qui c'è il contenitore in cui
  atterrerà, che è ciò che mancava.

## Le regole

### 1. Una cucitura sola verso l'host, e un test che la presidia

Nessun modulo importa `@tauri-apps` fuori da `host/ipc.ts` e `host/dialog.ts`.
Vale **anche per i tipi**: `import type` conta come un import, o la regola si
aggira con una parola.

Il presidio è `host/no-tauri-outside-host.test.ts`, che legge i sorgenti con
`import.meta.glob` e fallisce nominando il file colpevole. Non è una regola di
stile: è il prerequisito del PWA (26.3), del mobile (26.2) e degli e2e della
shell ([§17.2](../roadmap/17-presidi-che-restano.md)), che girano contro un host
finto — e prima bastava **una riga** in `main.ts` per perderlo.

Per la stessa ragione `host/ipc.ts` dichiara il ritorno del canale eventi come
`() => void` invece che `UnlistenFn`: nominare il tipo di Tauri obbligherebbe
chi lo riceve a importarlo.

E per la stessa ragione `tsconfig.json` non ha i tipi di Node: la shell gira in
una webview, e non avere `process`/`fs` a tiro è ciò che impedisce di scrivere
codice che nell'app impacchettata non esiste.

### 2. Chi cambia qualcosa lo dice; chi ha interesse si iscrive

Due bus, con due nature diverse:

- **`state/kernel.ts`** — gli eventi del *backend*. Un modulo dichiara quale
  evento gli interessa (`onEvent("document_renamed", …)`) e riceve l'evento già
  ristretto alla sua variante, con l'origine. C'è un solo ascoltatore "di
  tutto" legittimo (`onAnyEvent`), ed è l'host dei pannelli, che decide per
  **dato** — la maschera che ogni pannello ha dichiarato — e non per conoscenza
  privata di chi c'è.
- **`state/store.ts`** — i segnali della *shell*: `vault`, `documents`,
  `active-doc`, `organization`, `stale-views`.

Prima c'era una funzione sola, `handleKernelEvent`, che conosceva privatamente
ogni pannello. Il guadagno non è l'eleganza: è che `explorer` e `document`
possono entrambi dipendere dallo store senza dipendere l'uno dall'altro. Un
ciclo di import fra due moduli di dominio, in un bundle ESM, è un `undefined`
all'avvio che non dice da dove viene.

In entrambi i bus **un ascoltatore che lancia non ferma gli altri**: il difetto
si manifesterebbe come "metà finestra ferma", cioè nel modo più difficile da
ricondurre alla causa.

### 3. Le operazioni sul vault non disegnano e non aprono

`state/vault.ts` fa l'operazione e **restituisce** ciò che serve; chi ha
chiamato decide cosa farne. È la regola che tiene i moduli aciclici: se
`createNote` aprisse da sé la nota creata dovrebbe importare `panels/document`,
che a sua volta la chiama per creare la nota di un wikilink non risolto.

Le uniche due eccezioni sono iniettate esplicitamente in `main.ts`, con la
ragione scritta accanto: il pannello del documento riceve `searchTag`, e
l'anteprima riceve `openPage`.

### 4. Lo store è piccolo per costruzione

Nello store sta ciò che serve a **più di un modulo**. I risultati di ricerca, le
voci del cestino, l'anteprima di una versione restano nel loro pannello. Uno
store che raccoglie tutto torna a essere l'oggetto-dio, con un file diverso.

### 5. Un pannello dichiara cosa lo fa invecchiare; l'host decide quando chiamarlo

C'è **un solo modo** di montare un pannello, e sta in `ui/panel-host.ts`: si
dichiara `id`, `title`, `placement`, la maschera `refresh` degli eventi del
kernel che lo invecchiano, se segue il documento aperto (`followsDoc`), se è
visibile (`visible`) e come si disegna (`render`). Nessun pannello si iscrive
più da sé al bus per ridisegnarsi.

Una view dichiarata dal backend è un pannello come gli altri: `ui/views.ts` è
solo l'adattatore che traduce un `ViewSpec` in un `Panel` e gli ritaglia il
contenitore del suo placement. Da lì in giù non c'è differenza — ed è il punto,
perché finché convivono due modi il secondo vince per pigrizia.

Cosa ci si guadagna, oltre alla simmetria:

- **`overflow` si tratta in un posto solo.** Non è un fatto del dominio, è la
  coda troncata: l'host riconcilia **tutti** i pannelli da zero, e nessuno lo
  dichiara fra i suoi `refresh`. Prima era la terza riga copiata in ogni
  pannello, e quella che si dimenticava per prima.
- **La terna non si copia più.** `index_updated`/`batch_ended` stava a mano in
  explorer, ricerca e cestino: dimenticarne un pezzo — è già successo con
  `batch_ended` ([decisione 0011](../decisions/0011-il-lotto.md)) — lasciava un
  pannello fermo senza che nulla lo dicesse.
- **Un pannello che lancia non zittisce gli altri**, e lo fa l'host: la regola
  del bus vale ora anche per il disegno.
- **Il registro è l'inventario** di quali superfici questa shell abbia davvero
  — il pezzetto di [§7.6](../roadmap/07-il-confine.md) che le riguarda.

Due iscrizioni diritte restano, e non sono eccezioni alla regola perché non
sono *ridisegni*: `panels/explorer.ts` ascolta `document_renamed` per traslocare
l'organizzazione **prima** del ridisegno (il router consegna i generici prima
dei tipizzati, quindi un refresh dal registro partirebbe col path vecchio), e
`panels/document.ts` reagisce agli eventi sul documento aperto — l'editor non è
un pannello del registro, è l'area principale, e dove viva quella è il modello
di layout qui sotto.

## Cosa resta aperto, e perché

Sono le due metà del [§1.2](../roadmap/01-forma-della-shell.md) che **non** sono
chiuse:

- **Il modello di layout** — tab, split, pane, workspace salvabili. Non è un
  refactor: è la feature 3.3, e va decisa insieme a `PaneId`. La metà backend
  delle sessioni multiple **c'è** ([decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)):
  l'host tiene una mappa di vault aperti, ogni comando IPC accetta un `vault`
  opzionale, e il "corrente" è una comodità di questa shell — quindi il giorno
  che le finestre saranno due, il backend non è ciò che va riscritto. Ciò che
  è già pronto è che il contesto pubblicato porta l'identità del pannello
  (`MAIN_PANE`), quindi il giorno che i pannelli saranno due nessuno dovrà
  inventarsi da dove viene la risposta. La costante sta in `host/contract.ts`
  perché è un **valore del confine**, ed è presidiata: la fixture del mirror è
  generata da `ViewContext::new(MAIN_PANE)` — la costante vera del kernel, non
  una stringa scritta a mano — e `host/mirror.test.ts` ci lega quella TS. Due
  valori che divergono sono, da contratto, un cambio di pannello a ogni
  pubblicazione del contesto: si vedrebbe come «si ridisegna tutto» e non
  porterebbe a nessuna delle due righe.
- **Cestino e cronologia come `ViewProvider` veri.** Il modo di montarli è ormai
  uno — la regola 5 qui sopra — ma sono pannelli **nativi** che dichiarano, non
  provider che disegnano con `UiNode`. Dipendeva dai nodi di input e da un modo
  di dire "sto caricando": la
  [decisione 0016](../decisions/0016-cosa-e-una-view.md) li ha portati tutti e
  due, quindi il blocco non c'è più e resta solo da farlo. La cronologia è il
  caso di collaudo giusto — view con stato per-documento, input e azioni che
  scrivono — e migrarla *prima* avrebbe dato una view che sa mostrare la lista e
  non sa offrire «Ripristina» se non come `list_item` cliccabile, cioè il
  protocollo collaudato su un caso ammorbidito.
  Il grafo non è in attesa di niente: resta fuori da `UiNode` per decisione di
  M2, ed è nel registro come superficie `overlay`.
