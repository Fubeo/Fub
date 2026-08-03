# 0078 — I riquadri sono un fatto della shell, e il buffer è del documento

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §1.2 ([seduta 18](../roadmap/18-editor-e-tastiera.md)) — chiude la voce, che era all'**ultima casella**; chiude anche la metà rimasta del [§11.2](../roadmap/11-impostazioni-e-i-tre-stati.md) e sblocca la §3.3 |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/18-editor-e-tastiera.md) · [il contesto di sessione, 0007](0007-contesto-di-sessione.md) · [i tre stati, 0036](0036-le-impostazioni-e-i-tre-stati.md) · [lo stato di vista, 0037](0037-lo-stato-di-vista.md) · [l'undo ha due pile, 0045](0045-l-undo-ha-due-pile.md)

---

La voce chiedeva quattro parole: *tab, split, pane, workspace salvabili*. Era
l'ultima casella del §1.2 e il nodo di un ordine dichiarato dalla seduta — §1.2
→ §3.3 — perché finché l'area principale è un pannello solo, spostarci il grafo
vuol dire togliere di mezzo l'editor. Le quattro parole nascondevano tre domande
diverse, e due di esse avevano già una risposta scritta da qualche altra parte
in questo repo. Trovarle è stato metà del lavoro.

## Il contratto non si tocca, e questa è una scoperta

La voce diceva che «la metà kernel va decisa insieme a `PaneId`». Non c'era
niente da decidere: **N riquadri ci stanno già**, e ci stavano dal primo giorno.

`ViewContext` porta un campo `pane` dalla [0007](0007-contesto-di-sessione.md) —
il contesto pubblicato è *di un riquadro*, nominato — e il kernel custodisce «il
contesto del pannello con il focus, e nient'altro». Lo stato di vista della
[0037](0037-lo-stato-di-vista.md) è già per **esemplare** scelto dalla shell,
quindi due outline in due riquadri sono due esemplari e non collidono. Non
mancava una firma: mancava un corpo alla shell.

E il kernel una mappa di riquadri non la vuole. La domanda a cui risponde — *cosa
sta guardando l'utente adesso* — è **una sola per definizione**, quanti che siano
i riquadri; un registro di riquadri lato kernel sarebbe una mappa che nessuno
interroga, mantenuta a ogni divisione e a ogni chiusura per non servire a niente.
Quindi la pluralità dei riquadri è **un fatto della shell**, e `MAIN_PANE` non
era un limite del kernel: era il nome che l'unica shell esistente dava al suo
unico riquadro. Gli altri li conia lei.

Il costo di questa voce, a ridosso del freeze di M4, è **zero firma**:
`wit_conformance` non si è mosso, e `dieta_ipc` nemmeno — nessuna porta IPC
nuova, perché non c'era niente di nuovo da chiedere al backend.

Scartato: un `PaneId` "vero" nel contratto, con un registro di riquadri nel
kernel. Avrebbe dato una mappa che nessuno legge e un ciclo di vita da tenere
allineato fra due processi, per esprimere una cosa che il campo `pane` esprime
già.

Resta un punto solo del kernel che presuppone un riquadro solo,
`Workspace::set_active_document`, e il suo doc lo dichiarava già — *«scorciatoia
per una shell a un pannello solo»*. **Non si toglie**: la shell non passa più di
lì (pubblica `ViewContext` interi), ma lo chiamano test ed esempi, dove nominare
`MAIN_PANE` è ciò che si vuole davvero dire. Si è precisato il doc, che è la sola
cosa diventata falsa.

## «Il layout» sono due cose, e ognuna aveva già la sua casa

La seconda risposta già scritta. *Workspace salvabili* e *com'era aperta la
finestra* sembrano la stessa cosa e non lo sono:

|  | com'era aperta la finestra | un workspace salvato |
|---|---|---|
| chi lo crea | nessuno: è successo | l'utente, apposta |
| ha un nome? | no, è *il* corrente | sì, è la sua identità |
| dove va | **file della macchina** (stato di vista, [0037](0037-lo-stato-di-vista.md)) | **nel vault** (`.fub/`, [0076](0076-le-impostazioni-vivono-nel-vault.md)) |

Il criterio è quello che la [0036](0036-le-impostazioni-e-i-tre-stati.md) aveva
scritto senza applicarlo: *un'impostazione ha un valore alla volta, un layout ne
ha uno per nome*. Il primo oggetto **non ha un nome**, quindi non è un layout in
quel senso — è stato di vista, e non viaggia perché dipende dal monitor che uno
ha davanti. Il secondo l'ha creato l'utente, quindi viaggia col vault come le
note e le scorciatoie.

Distinguendoli **non serve nessun terzo meccanismo**: entrambi i contenitori
esistono già. Confonderli sarebbe stato il «terzo stato senza contenitore» che il
§11.2 nomina nel titolo — ed è così che quella mezza voce si chiude senza
costruire niente. Qui si è fatto il primo; il secondo è **fuori e nominato**: la
casa è decisa, il formato aspetta di vedere assetti veri, perché un formato
indovinato prima del primo cliente è un formato da migrare.

## La struttura si disegna intera: tab e split insieme

Un riquadro tiene **N documenti con uno attivo**. Da questa forma sola escono
insieme le tab e lo split.

La tentazione era fare solo lo split — è ciò che sblocca la §3.3 — e le tab dopo.
**Scartata**, e la ragione va detta perché è controintuitiva: decidere adesso
«un riquadro = una nota» vuol dire buttare quel modello il giorno delle tab,
perché la forma con le tab lo *contiene*. Non è più lavoro di design: è lo stesso
lavoro fatto una volta invece che una volta e mezza. E la §3.3 si sblocca lo
stesso.

La disposizione è un albero — una foglia è un riquadro, un nodo è una divisione
con un verso e N figli — e non una griglia con coordinate. Una griglia sa dire
dove sta un riquadro e non sa dire cosa succede quando lo si chiude, e «cosa
succede quando lo si chiude» è metà del lavoro di un modello di layout. Due
regole cadono da sé e stanno in `appiattisci`: una divisione con un figlio solo
**non è** una divisione (è quel figlio, con un livello di indirezione che al
prossimo split deciderebbe il verso sbagliato), e una divisione dentro una dello
stesso verso è la stessa fila. Tre riquadri affiancati sono tre figli di un nodo.

Gli id: `main` resta il primo **per sempre**, e non è nostalgia — è già scritto
dentro gli esemplari delle view nei file di stato di macchina, quindi cambiarlo
vorrebbe dire buttare lo stato di vista di chiunque abbia già aperto la shell.
Gli altri sono il primo `pane-N` libero, e non un contatore che sale: un
contatore andrebbe persistito insieme all'albero, e un contatore persistito che
si disallinea dall'albero conia un id che esiste già.

## La modalità è del riquadro, ed è una migrazione vera

Era una chiave sola di stato di vista, e con un riquadro era giusta. Con N è di
ciascuno, per una ragione che si vede al primo uso: **la disposizione per cui si
divide** è la nota di lato in Lettura mentre si scrive l'altra, e con una
modalità di finestra non esisterebbe. Quindi `body[data-mode]` diventa
`.pane[data-mode]`, e il commutatore in testata parla del riquadro col fuoco.

La chiave vecchia si legge **una volta**, e diventa la modalità del primo
riquadro: chi stava leggendo non deve riaprire in Live Preview. Da lì in poi non
si riscrive più, e **non si cancella** — una versione precedente della shell
riaperta sullo stesso vault la ritroverebbe, e una migrazione che rompe il
ritorno indietro costa più di una chiave morta in un file di cache.

## Una nota aperta due volte è un buffer

Il punto più delicato, e l'unico che non veniva gratis. Con N riquadri la verità
del documento aperto — quella che finché il buffer è sporco non è il disco — non
può più stare nel pannello: due riquadri sulla stessa nota, se ognuno tenesse il
suo testo, **sarebbero due note**. Si scrive di qua, si salva di là, e il
salvataggio più recente copre l'altro senza che niente lo dica: è il difetto che
non lancia mai, e che si scopre avendo già perso del lavoro.

La risposta è **un buffer per documento, non per riquadro**, e da lì scendono
tre cose:

- il testo lo tiene la mappa dei buffer, e gli editor sono superfici sopra di
  lui. Chi scrive aggiorna il buffer, e gli altri editor sullo stesso documento
  ricevono la **modifica minima** (prefisso e suffisso comuni), non tutto il
  documento: un rimpiazzo intero sarebbe corretto e sposterebbe il cursore in
  fondo a ogni battuta dell'altro riquadro;
- il debounce del salvataggio è del **documento**, e `flushPendingSave` mette in
  salvo **tutti** i buffer. Con un riquadro solo «il buffer corrente» bastava;
  adesso un rename può riguardare una nota aperta in un riquadro che non ha il
  fuoco, e la riscrittura del kernel finirebbe sotto una copia più vecchia;
- la sincronizzazione **non entra nella pila di undo** di chi la riceve. È la
  regola della [0045](0045-l-undo-ha-due-pile.md) vista da un'altra angolazione —
  le due pile non si fondono: un Ctrl-Z qui deve disfare ciò che si è scritto
  *qui*. Chi ha scritto ha la sua pila e se lo disfa da sé, e la disfatta arriva
  di là per questa stessa via.

Il corollario, che è la cosa da guardare aprendo l'app: aprire in un secondo
riquadro una nota con modifiche non salvate mostra **quelle modifiche**, non il
file su disco. L'alternativa — rileggere sempre dal disco — darebbe due riquadri
che mostrano due testi diversi dello stesso documento, che è esattamente ciò che
questa decisione esiste per non avere.

## Cosa resta fuori, e nominato

- **I workspace salvati con un nome**: casa decisa, formato no (sopra).
- **Il grafo nell'area principale** (§3.3). Non è più bloccato: il posto c'è.
  Quel che manca adesso è che un riquadro tenga una **view** e non solo tab di
  documenti — cioè un pannello nativo che diventa `ViewProvider`, che è il
  pattern della [0075](0075-una-view-non-chiede-con-una-finestra.md) e merita il
  verbale suo. Il messaggio che `ui/views.ts` dà a chi chiede la superficie
  `main` è stato riscritto per dire questa ragione e non quella di prima.
- **Il ridimensionamento dei riquadri col mouse**. L'albero non porta misure e
  lo spazio si divide in parti uguali: le proporzioni sono uno stato in più da
  persistere e da riconciliare quando un riquadro se ne va, e nessuno le ha
  ancora chieste. Il posto dove aggiungerle è il nodo `split`, additivo.

## Il precedente

Due delle tre domande di questa voce avevano già una risposta scritta altrove nel
repo — il campo `pane` della 0007, il criterio «un valore alla volta / uno per
nome» della 0036 — e il lavoro è stato **andarle a cercare prima di
progettare**, non dopo. È la stessa mossa della [0077](0077-una-scorciatoia-e-una-chiave.md),
che davanti a qualcosa che sembrava chiedere firma nuova si è chiesta se il caso
si servisse con ciò che c'è. Qui la domanda ha dato la risposta più forte
possibile: la metà contratto di questo verbale è **vuota**, e «non ho toccato la
firma ed ecco perché non serviva» è un ragionamento intero — abbastanza da essere
metà di una decisione, e non una nota a piè di pagina di un commit.
