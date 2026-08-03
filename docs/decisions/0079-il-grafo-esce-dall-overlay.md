# 0079 — Il grafo esce dall'overlay, e una tab non è più per forza un documento

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §3.3 ([seduta 18](../roadmap/18-editor-e-tastiera.md)) — **chiude la voce**, e lascia una casella. Con lei l'area principale smette di essere una superficie dichiarata e mai ospitata |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/18-editor-e-tastiera.md) · [i riquadri sono un fatto della shell, 0078](0078-i-riquadri-sono-un-fatto-della-shell.md) · [chi disegna ciò che il core non conosce, 0017](0017-chi-disegna-cio-che-il-core-non-conosce.md) · [cosa è una view, 0016](0016-cosa-e-una-view.md) · [il grafo e i link non wiki, 0004](0004-il-grafo-e-i-link-non-wiki.md) · [il path è la chiave, 0043](0043-il-path-e-la-chiave.md)

---

La voce era vecchia e la sua ultima riga era diventata corta: *il grafo è ancora
un pannello nativo*. La seduta 18 aveva dichiarato l'ordine §1.2 → §3.3, e con la
[0078](0078-i-riquadri-sono-un-fatto-della-shell.md) il primo anello era caduto —
i riquadri sono N, e spostarci il grafo non vuol più dire togliere di mezzo
l'editor.

Quello che restava sembrava piccolo. Non lo era, e non per la ragione che si
sarebbe detta: il lavoro difficile non è stato far entrare un canvas in un
riquadro, è stato decidere **quanto** del grafo dovesse attraversare il confine.

## La domanda vera: cosa era privilegiato, di preciso

Il grafo è nato pannello nativo della shell — un `<canvas>` in un overlay che si
apriva sopra tutto — e di quella forma erano vere due cose che per anni sono
state confuse in una sola.

La prima: **il canvas è della shell**. `UiNode` non esprime un canvas e non deve;
un protocollo dichiarativo che dovesse esprimere un force-directed sarebbe un
motore grafico travestito da enum. Questo non è mai stato il debito, ed è la
parte che l'[architettura](../architecture/ui-protocol.md) aveva già scritto
giusta nel 2026.

La seconda: **i dati erano della shell**. Chi decideva quali nodi e quali archi
disegnare era `frontend/src/panels/graph.ts`, cioè del codice che un plugin di
terzi non può scrivere. *Questo* era il debito, ed è quello che qui passa di là.

Le due strade sul tavolo erano quindi due, e vale la pena scrivere quella
scartata perché era difendibile:

- **Pannello nativo che cambia casa.** Il grafo resta della shell e il riquadro
  impara a ospitarlo. Molto meno lavoro, e onesto sul piano della lettera: la
  §3.3 chiede che il grafo esca dall'overlay, non che diventi un plugin.
- **Provider vero.** Il grafo diventa una feature ufficiale, la sua view dichiara
  `ViewSurface::Main`, e la shell impara il ramo `ns` che `ui/node.ts` aspettava.

Ha vinto la seconda, per tre ragioni che si tengono insieme. La prima è che la
prima strada non toglieva niente: il grafo sarebbe rimasto l'unica superficie di
Fub in cui la shell decide *cosa* mostrare, e la §3.3 esiste esattamente per
quello. La seconda è che `ViewSurface::Main` era **dichiarata nel contratto e mai
usata da nessuno** — zero occorrenze in tutto `crates/` — e una variante di
confine che nessuno ha mai attraversato è una promessa di cui non si sa se regge:
scoprirlo al primo plugin di terzi sarebbe stato il momento peggiore. La terza è
che il commento in `ui/node.ts:768` prometteva questo ramo **per nome**, e una
promessa scritta nel codice o si mantiene o si cancella.

## Il `payload` non è un canale privilegiato travestito, e si può misurare

È l'obiezione seria alla strada scelta, e merita il confronto col codice di
prima invece di una rassicurazione.

Prima: la shell faceva **due** domande al canale dati — `IndexQuery::Documents`
per i nodi e `IndexQuery::Neighbors` per gli archi — e ne componeva il grafo.
Adesso quelle stesse due domande le fa un provider, con la stessa `HostApi` che
avrà un plugin di terzi, e il risultato torna alla shell dentro il `payload` di
un `UiKind::Custom`. **Nessuna porta in più**: il debito del
[§16.6](../roadmap/16-crate-sdk-banchi-di-prova.md) resta a due, e
`dieta_ipc.rs` non si è mosso. Il grafo, che era il caso più duro, attraversa il
confine con `render_view` come il pannello dei tag.

Quel che resta privilegiato è il **disegno**, e la sua misura è precisa: lo `ns`
che la shell conosce. Un plugin di terzi manda il suo `Custom` e riceve il
`fallback` — che è ciò che il contratto prescrive a chi non riconosce un
namespace, non un caso d'errore — finché non potrà spedire codice di disegno,
cioè a M5. L'asterisco di onestà di `ui-protocol.md` quindi **non si indebolisce
e cambia misura**: prima copriva dati e pixel, adesso solo i pixel. È la stessa
mossa che la 0056 aveva fatto su un presidio — circoscrivere invece di
abbassare — applicata a una promessa di architettura.

E una conferma che il baratto è quello giusto: il click su un nodo non ha avuto
bisogno di niente. È `ViewUpdate::Navigate`, che il backlink usa dal primo
giorno. Un grafo è un elenco di riferimenti disegnato tondo, e il contratto lo
sapeva già.

## Una tab è una cosa discriminata, e questa è la parte che si sarebbe pagata

Il pezzo che è costato di più non si vede da fuori. `PaneState.docs` era
`string[]`, cioè un elenco di path, e una tab di grafo non è un path. La
tentazione — scriverci dentro `"view:graph"` — costa **una riga**, e la si paga
per sempre.

Un path è l'identità di un documento ([0043](0043-il-path-e-la-chiave.md)): è la
chiave con cui si legge dal disco, quella che un rename insegue, quella che
attraversa il confine dentro il `ViewContext`. Sovraccaricarla vuol dire che ogni
suo lettore deve sapere che a volte non è un path — sono una decina di posti in
`panels/document.ts` — e basta che uno non lo sappia perché la shell chieda al
kernel di leggere un documento che si chiama `view:graph`. Con un tipo
discriminato è il compilatore a chiedere a chi legge quale dei due casi sta
guardando, e `docAttivo()` resta la stessa domanda di prima con la stessa
risposta: un path, o niente.

I due test che valgono più degli altri sono quelli che quella riga risparmiata
avrebbe fatto fallire in silenzio: un rename di `a.md` **non** tocca una view che
si chiama `a.md`, e cestinare `a.md` non porta via la sua omonima.

La persistenza è una migrazione vera, e la regola era già scritta in
`state/layout.ts`: una forma nuova o è retrocompatibile o riparte dal default
senza rompere. Qui è retrocompatibile **in lettura** — una stringa nell'elenco
*è* una tab di documento, quindi la conversione è totale e nessuno perde le note
che aveva aperte — e non si riscrive `docs` accanto a `tabs`. È la differenza
con la migrazione della modalità della 0078, dove la chiave vecchia si è lasciata
lì: `mode` restava **vero**, mentre un `docs` scritto accanto a una tab di grafo
sarebbe una bugia, e una shell precedente riaprirebbe la finestra senza dire che
le manca qualcosa. Chi torna indietro riparte dal default, che è rumoroso quanto
basta e non mente.

## Il contratto non si tocca. Tre volte di fila

`ViewContext` non ha un campo nuovo, e la domanda «cosa pubblica un riquadro che
mostra il grafo» era il primo caso che sembrava metterlo davvero in dubbio.

La risposta è `doc: null`. Non un valore inventato per l'occasione: è lo stato in
cui si trova un riquadro **vuoto**, che esiste dalla 0078 ed è legittimo. Chi
guarda il grafo non sta guardando nessuna nota, e i pannelli che seguono il
documento — backlink, outline — dicono quello che dicono sempre quando non c'è
una nota. La `selection` cade con lui, per la stessa ragione. La `mode` resta
quella del riquadro, ed è un dato del riquadro e non della tab: mentre il grafo è
davanti non significa niente, e non significare niente non è lo stesso che essere
sbagliata.

Vale la pena mettere in fila le ultime tre voci: 0077, 0078, 0079. Tutte e tre
sembravano chiedere firma nuova, tutte e tre non ne hanno avuto bisogno, e la
terza ha trovato la risposta scritta **a metà in due decisioni di sedute
diverse** — l'area principale nella [0016](0016-cosa-e-una-view.md), il varco
`Custom` nella [0017](0017-chi-disegna-cio-che-il-core-non-conosce.md) — che
nessuna delle due aveva costruito perché nessuna aveva un cliente. Cercare prima
di progettare non è una formalità: è la parte del lavoro che ha reso questa voce
fattibile in una seduta.

## Il registro dei `ns`, e perché non è un `if`

La shell impara `fub:graph` in `ui/custom.ts`, che è un registro come quello dei
pannelli: **chi sa disegnare qualcosa si dichiara**, e `ui/node.ts` cerca invece
di conoscere per nome. Dentro `node.ts` sarebbero finite qualche centinaio di
righe di simulazione, e il traduttore del protocollo sarebbe diventato il posto
in cui vive la fisica delle molle.

Il guadagno non è qui, è alla voce dopo: i cinque moduli Suite (FubCanvas, FubDB,
FubCharts, FubMaps, FubForms, FEATURES 21.2) vogliono un renderer proprio, e
adesso ognuno è una riga in quel registro e un file accanto — senza toccare né il
contratto né `node.ts`. È il conto del 21.1, ridotto al suo limite dichiarato
invece che saldato: la strada è **percorsa** e non solo aperta, e ciò che resta è
l'asterisco di M5, che non è di questa voce.

Il registro ha portato con sé una cosa che non era nel piano: un renderer custom
può possedere qualcosa che il DOM non raccoglie da sé — un ciclo di animazione,
un timer, un `ResizeObserver` — quindi restituisce **come smontarsi**, e a
invocarlo è il riconciliatore, in tutti e cinque i punti in cui un elemento esce
dall'albero. Questo chiude anche la
[issue 0084](../issues.md#0084--memory-leak-di-listener-keydown-su-document-alla-riapertura-del-grafo),
e nel modo per cui era stata *promossa* invece che riparata: la disciplina è del
protocollo di disegno, non della buona memoria di chi scrive un renderer.

## Cosa è cambiato di misurabile, e cosa è sparito

- L'area principale è **ospitata**, e in un modo che nessun'altra superficie
  condivide: non ha un contenitore in `index.html`, perché di riquadri ce ne sono
  N e un riquadro si riempie quando qualcuno ci mette una tab. Le superfici non
  ospitate passano da tre a **due** (`menu`, `context_menu`), e per la prima
  volta nessuna delle due aspetta qualcosa che stia arrivando.
- Le view ufficiali sono **sette**, e la settima esercita la parte che le altre
  sei non toccavano: l'area principale e il varco `Custom`.
- La superficie `overlay` di `ui/panel-host.ts` **non c'è più**: aveva un cliente
  solo, e toglierla è la parte che vale la pena scrivere — un posto che il
  contratto non nomina e che nessuno usa è dove la prossima cosa difficile
  andrebbe a nascondersi.
- Un pannello può disegnare una view di cui non è l'unico esemplare, quindi
  `Panel` ha imparato **un campo**: `view`. Il kernel invecchia le view, e con
  l'area principale i pannelli di una view sono N — uno per riquadro.

## Le due cose che si sono rotte subito, e perché nessun test era rosso

Vanno scritte, perché sono lo stesso difetto visto due volte: **una superficie
nuova rompe le premesse su cui i presidi di quelle vecchie erano stati scritti**.

La prima. `renderDeclaredView` chiedeva al kernel di disegnare l'id del
**pannello**, e per le sette superfici di prima un pannello *è* una view — stesso
id, uno per uno — quindi passare l'uno dove andava l'altro non si vedeva. Con un
riquadro il pannello si chiama `graph@main`: il kernel non conosce quella view,
`refreshPanel` cattura l'errore, lo scrive in console, e a schermo resta un
riquadro vuoto. Nessun test era rosso perché nessun test montava una view in un
riquadro — cioè il presidio esisteva, e la premessa sotto di lui era scaduta.
Adesso c'è `ui/views.test.ts`, che monta `index.html` vero e guarda **cosa si
chiede al kernel**; è rosso sul codice di prima.

La seconda. Il canvas era alto zero. `.pane-view` dava il 100% al canvas, ma in
mezzo c'è il `div.ui-custom` che `ui/node.ts` disegna, e `auto` non è un'altezza
da cui prendere una percentuale. Nella sidebar il problema non poteva esistere —
là un pannello è alto quanto il suo contenuto — e questo è il primo posto in cui
il verso è l'opposto: il contenuto è alto quanto il riquadro. È una riga di CSS,
e non ha un presidio: `happy-dom` non fa layout, e un test che si limitasse a
cercare la regola nel foglio proverebbe che qualcuno l'ha scritta, non che
funzioni. Sta scritto qui perché è il tipo di cosa che il prossimo renderer
custom incontrerà per primo.

## Cosa questa voce ha trovato e non cercava

`fub-host` non inoltrava la cargo feature `trash`, e non lo faceva dal giorno in
cui quel bundle è nato. Nessuno se n'era accorto perché `cargo test --workspace`
**unifica** le feature — `fub-features` è anche un membro del workspace, quindi
si compila coi suoi default e la mancanza sparisce — e si vede solo compilando
`fub-host` da solo, che è ciò che farebbe chi lo usa come libreria. È il
[§16.3](../roadmap/16-crate-sdk-banchi-di-prova.md) visto da un piano più su:
`le_cargo_feature.rs` confronta l'inventario col `Cargo.toml` **di quel crate**,
e l'elenco di chi inoltra non lo guarda nessuno. Qui è riparato e scritto in
testa a quel presidio; farlo guardare da un test è lavoro suo.

## Cosa resta fuori, e nominato

**Aprire in un riquadro una view che non sia il grafo.** Ci si arriva con
`shell.graph`, che è il comando di *quel* componente e apre *quella* view — l'id
e la scorciatoia sono quelli di prima, com'è cambiato solo cosa fa. Va bene per
il primo cliente e non per il secondo: quando le view principali saranno due
servirà un gesto generico, con l'elenco che `viewPrincipali()` già restituisce.
Non lo si è fatto adesso perché un gesto disegnato su zero clienti è un gesto
indovinato, e perché i comandi si registrano al montaggio mentre le view si
scoprono **per vault**: le due cose vanno decise insieme, e la seconda oggi non
ha nessuno che la chieda. È la casella che la §3.3 lascia.

**L'esemplare di una view di riquadro è l'id del riquadro**, e gli id dei
riquadri si riciclano (`coniaPaneId` prende il primo libero). Per il grafo non
cambia niente — non ha stato di vista — ma una view principale che ricordasse
qualcosa erediterebbe ciò che aveva lasciato scritto un riquadro chiuso con lo
stesso nome. Non è un difetto da riparare al buio: è il primo posto da guardare
il giorno che una view principale abbia uno stato.

**Il grafo non si ridisegna da solo**, e adesso è **dichiarato** invece di
implicito. Nel pannello nativo la stessa scelta viveva in un `refreshOn()` senza
argomenti, cioè in una riga della shell; adesso è una `ViewInterests` con la
maschera vuota, e un giorno può cambiare idea senza che nessuno tocchi la shell.
La ragione resta quella: ripartire vuol dire far saltare i nodi sotto il mouse di
chi li sta guardando.

## Il precedente

Due nomi tengono insieme le due metà di un componente diviso dal confine — lo
`ns` e l'id della `ViewSpec` — e sono due stringhe in due linguaggi, in due file
che non si compilano insieme. Se una cambia e l'altra no **non diventa rosso
niente**: il grafo si apre, e dentro c'è il fallback. Cioè il modo di rompersi
che il degrado garbato del contratto rende invisibile, proprio perché funziona.

`il_grafo_ha_due_meta.rs` legge il sorgente TS e confronta i due nomi. È lo
stesso genere di presidio dei mirror TS↔Rust su un oggetto più piccolo — là la
*forma* dei tipi, qui due *nomi* — e la regola generale che ne esce vale per ogni
prossimo `ns`: **un varco di estensione con degrado garbato ha bisogno di un
presidio sui nomi**, perché è l'unico posto del confine in cui sbagliare non
produce un errore.
