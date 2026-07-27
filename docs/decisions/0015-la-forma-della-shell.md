# 0015 — La forma della shell, e l'unica porta verso l'host

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.1 e §1.3 (seduta 1, *ex* §3.13 e §3.11) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la mappa dell'albero](../architecture/shell.md)

---

- [x] **Quattordici file piatti in `frontend/src/`**, `main.ts` a 1622 righe con
      81 funzioni di primo livello e 18 variabili globali mutabili. Il §1.2
      chiede «un modulo per dominio» e ha ragione, ma senza un albero dichiarato
      la divisione la decide chi tocca il file per ultimo — che è come sono nate
      le quattordici.
- [x] **Le voci in arrivo scrivono tutte negli stessi due file**: il §2.1
      riversa una ventina di nodi sul renderer, il §2.8 ci mette accanto un
      riconciliatore, il §2.2 aggiunge cinque superfici a `main.ts`, il §18.2 un
      registro comandi, il §10.3 un centro notifiche.
- [x] **`api.ts` è l'unica cucitura verso Tauri — tranne `main.ts:2`**, che
      importa `@tauri-apps/plugin-dialog` per le conferme e il file picker.
      Basta una riga perché la shell smetta di essere portabile.

## La forma

L'albero è dichiarato e **abitato** (`host/`, `state/`, `ui/`, `panels/`,
`editor/`, `rules/`, `theme/`), e sta in [architecture/shell.md](../architecture/shell.md),
non qui: una mappa che si consulta scrivendo un file nuovo non va nell'archivio
delle decisioni. `main.ts` è passato da **1622 a 137 righe** e non contiene più
logica di dominio: compone, inietta due collegamenti e apre il vault.

Le decisioni prese, da NON ridiscutere senza motivo:

- **La cucitura verso l'host è `host/`, e la regola vale anche per i tipi.**
  Nessun modulo importa `@tauri-apps` fuori da `host/ipc.ts` (i comandi del
  backend) e `host/dialog.ts` (le superfici di *sistema*: conferme, selettore di
  cartella). `import type` conta come un import — altrimenti la regola si aggira
  con una parola, e un presidio aggirabile con una parola non è un presidio. Per
  la stessa ragione il canale eventi dichiara il ritorno come `() => void`
  invece di `UnlistenFn`: nominare il tipo di Tauri obbligherebbe chi lo riceve
  a importarlo.
- **Il presidio è un test che legge i sorgenti**, non una convenzione:
  `host/no-tauri-outside-host.test.ts` fallisce nominando il file colpevole. È
  stato verificato **iniettando** un import finto in `panels/search.ts`: rosso,
  col nome giusto. Il test ha anche due controlli su di sé — che il glob trovi
  ancora dei file e che le eccezioni nominino file veri — perché è nato rotto
  proprio così, passando a vuoto su una lista vuota.
- **I tipi del confine sono separati dalla cucitura** (`host/contract.ts` non
  importa `@tauri-apps`): un modulo che vuole solo *nominare* un `SearchHit` non
  deve tirarsi dentro Tauri. E `tsconfig.json` non ha i tipi di Node: la shell
  gira in una webview, e non avere `fs`/`process` a tiro è ciò che impedisce di
  scriverci codice che nell'app impacchettata non esiste. Il presidio del §1.3,
  che i sorgenti li deve pur leggere, usa `import.meta.glob` di Vite — un
  presidio della portabilità non deve essere il primo a rinunciarci.
- **Due bus, non uno.** `state/kernel.ts` instrada gli eventi del *backend* (chi
  si iscrive dichiara il tipo e riceve l'evento già ristretto alla sua variante,
  con l'origine); `state/store.ts` porta i segnali della *shell* (`vault`,
  `documents`, `active-doc`, `organization`, `stale-views`). Sono separati
  perché hanno due nature: il primo ha un formato che il contratto congela, il
  secondo è roba di questa shell e cambierà con lei.
- **Un solo ascoltatore "di tutto" è legittimo**, ed è il view host: decide per
  **dato** (`ViewSpec.refresh`), non per conoscenza privata di chi c'è. Un
  pannello che si iscrivesse lì per comodità starebbe ricostruendo il vecchio
  `handleKernelEvent`, che conosceva privatamente ogni pannello ed è il sintomo
  da cui la seduta è partita.
- **Un ascoltatore che lancia non ferma gli altri**, in entrambi i bus. Il
  difetto si manifesterebbe come "metà finestra ferma": il modo più difficile da
  ricondurre alla causa, e l'esatto contrario di ciò che la
  [seduta 20](../roadmap/20-quando-qualcosa-va-storto.md) chiede.
- **Le operazioni sul vault non disegnano e non aprono** (`state/vault.ts`):
  fanno l'operazione e **restituiscono** ciò che serve. È la regola che tiene i
  moduli aciclici — se `createNote` aprisse da sé la nota creata dovrebbe
  importare il pannello del documento, che a sua volta la chiama per creare la
  nota di un wikilink non risolto. Un ciclo di import, in un bundle ESM, è un
  `undefined` all'avvio che non dice da dove viene.
- **Le due eccezioni sono iniettate, non importate**, e stanno scritte in
  `main.ts` con la ragione accanto: il pannello del documento riceve
  `searchTag`, l'anteprima riceve `openPage`. È la stessa forma con cui i tre
  moduli dell'editor ricevono il mondo.
- **Lo store è piccolo per costruzione**: ci sta solo ciò che serve a più di un
  modulo. Risultati di ricerca, voci del cestino e anteprima di una versione
  restano nel loro pannello — uno store che raccoglie tutto è l'oggetto-dio con
  un file diverso.
- **`i18n/` non si crea.** Dipende dal §12.1, che è una decisione non ancora
  presa (dove vive il catalogo, chi localizza gli errori del confine, in che
  forma): fare la cartella prima della decisione significa deciderla per
  inerzia. `theme/` invece si crea, ma coi soli **token di oggi** spostati dentro
  senza toccarli: il sistema vero è 6.2/25.1, e ciò che mancava era il posto
  dove atterrerà.

Cambiamento collaterale, piccolo e voluto: `$` lancia nominando il selettore
invece di restituire `null` travestito da elemento con un cast. Un id sbagliato
da un ritocco al markup diventa un errore che si legge, al posto di un «cannot
read properties of null» tre chiamate più in là.

## Cosa NON è stato fatto, e perché

Il §1.2 resta **aperto** per due metà, ed è deliberato:

- **Il modello di layout** (tab, split, pane, workspace salvabili) non è un
  refactor: è la feature 3.3, e va decisa insieme a `PaneId` e alle sessioni
  multiple (§9.6). Farla dentro un giro di riordino significherebbe deciderla
  per inerzia — lo stesso errore che questa decisione evita per `i18n/`. Ciò che
  è già pronto è che il contesto pubblicato porta l'identità del pannello, così
  il giorno che i pannelli saranno due nessuno dovrà inventarsi da dove viene
  la risposta.
- **Un solo modo di montare un pannello**: cestino, cronologia, ricerca e grafo
  non passano dal view host. Il grafo per decisione di M2 (superficie
  privilegiata fuori da `UiNode`); gli altri perché il protocollo non ha ancora
  i nodi di input del §2.1 né un modo di dire "sto caricando" (§2.5). La
  cronologia è il caso di collaudo giusto — view con stato per-documento, input
  e azioni che scrivono — e migrarla oggi darebbe una view che sa mostrare la
  lista e non sa offrire il bottone «Ripristina» se non come `list_item`
  cliccabile: cioè il protocollo collaudato su un caso ammorbidito per farlo
  passare. Si migra **dopo** la seduta 2.

La precedenza dura del sesto giro — **§1.1 prima del §2.1** — è quindi
soddisfatta: la seduta 2 ha dove atterrare.

## Verifica

`npx tsc` pulito, **141 test vitest** (erano 138: tre li porta il presidio
nuovo), `vite build` ok, **446 test cargo** su 44 suite invariati — il backend
non è toccato. La regressione del presidio è stata provata iniettando un import
finto e ripristinandolo.

**Non verificato visivamente nell'app Tauri**: è un riordino a comportamento
invariato, ma è anche il giro che ha spostato ogni ascoltatore di eventi, e
questa è la classe di difetti che i test di questa shell non vedono (gli e2e
sono il §17.2, e chiedono proprio l'host finto che questa decisione rende
possibile).
