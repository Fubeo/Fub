# 0007 — Contesto di una view — `active_document()` non regge tab, split né selezione

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.9 (secondo giro) |
| **Commit** | `0cf0717` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **Forma del contesto decisa**: `HostApi::active_context() -> Option<ViewContext>`
      con `ViewContext { pane: PaneId, doc: Option<DocId>, selection:
      Option<Selection>, mode: PaneMode }` (`abi/session.rs`, interface `session`
      nel WIT). `active_document` non esiste più: due firme per la stessa
      domanda sarebbero state la trappola che questa voce descrive.
- [x] **La selezione attraversa il confine**: `Selection { span: Option<Span>,
      text: String }`. Il ponte inverso code unit → byte del §18.1
      (`charToByteIndex` in `frontend/src/rules/offsets.ts`) è stato scritto qui, con
      i suoi test: era il prerequisito, e senza di esso lo `Span` non si sapeva
      nemmeno costruire.
- [x] **Chi imposta il contesto resta la shell**, e la chiave è il pannello:
      `Workspace::set_active_context(Option<ViewContext>) -> Vec<String>` (gli id
      delle view da ridisegnare), comando IPC `set_active_context`. Il
      `PaneId` è nel contesto anche se questa shell ha un pannello solo: quando
      ne avrà due, il contratto non cambia.
- [x] **`ViewSpec.follows: ContextMask`**: la metà mancante del protocollo.
      Senza, "la shell ridisegna al cambio di nota attiva" diventa "ridisegna a
      ogni battuta di tasto" appena il contesto porta la selezione.
- [x] Clienti veri nello stesso giro: l'**outline** segna la sezione in cui sta
      il cursore, il pannello **statistiche** (`fub-features/src/stats.rs`,
      quarto `ViewProvider` ufficiale) conta le parole della selezione e cambia
      faccia in lettura. La shell pubblica il contesto vero: tre modalità
      (Sorgente / Live / Lettura) commutabili dalla barra.

*Sblocca:* 3.3 (tab, split, finestre, note history per pane), 4.1 (modalità
per-nota e per-pane), 4.2-4.3 (azioni sulla selezione), 13.3, 22.2.

**Fatto, con cinque decisioni e un debito dichiarato.**

*Il contesto è un record, quindi si riempie adesso.* Un caso in fondo a un enum
dopo il freeze è una minor; **un campo in più a un record è una migrazione di
ogni provider che lo riceve**. I quattro campi sono perciò tutti qui — pannello,
documento, selezione, modalità — e non un sottoinsieme da completare dopo. È la
stessa ragione per cui `select` è entrato in `IndexQuery::Properties` alla [decisione 0005](0005-canale-dati-verso-le-view.md).

*La regola dello span: `text` sempre, `span` solo se vero.* Una selezione ha
coordinate del **buffer**; il kernel conosce il **file salvato**. Finché
coincidono lo span c'è; appena il buffer è sporco lo span sparisce e resta il
testo. Non è prudenza: un contratto che desse sempre lo span inviterebbe ogni
consumatore a fare `read_document` + ritaglio, cioè a tagliare i byte sbagliati
**proprio mentre l'utente scrive** — che è l'unico momento in cui la selezione
serve. Scartato un `dirty: bool` accanto allo span: un flag che chiunque può
dimenticare di leggere protegge meno di un campo che, quando non è vero, non
c'è. L'invariante è tenuta dai due lati: la shell non pubblica lo span a buffer
sporco, il kernel lo lascia cadere quando il sorgente sotto cambia, viene
rinominato o sparisce (`invalidate_context`), e la shell lo ripubblica al
salvataggio successivo.

*Le maschere sono due perché i fatti sono di due specie.* `refresh: EventMask`
sono gli eventi del **vault**; `follows: ContextMask` (documento, selezione,
modalità) sono i fatti della **sessione**. Tenere il contesto fuori dall'event
bus non è pulizia: farlo passare di là significherebbe consegnare ogni movimento
del cursore a ogni `EventHandler` registrato — versioning compreso. Nessun caso
per il pannello: cambiare pannello vale come cambio di tutto, e un caso a parte
inviterebbe a dichiarare di seguire il pannello senza seguirne il contenuto. La
prova che la maschera serve è il pannello tag, che dichiara **niente**: la
distribuzione dei tag del vault è la stessa da ogni punto di ogni nota.

*Chi ridisegna cosa lo dice il kernel.* `set_active_context` restituisce gli id
delle view da ridisegnare. Il conto poteva stare nella shell — ha già il
contesto precedente — ma la regola sarebbe esistita in due copie, una in
TypeScript e una a M5 in qualunque altro host, e sarebbero divergite. La shell
resta padrona del *quando* (pubblica lei, con un debounce di 150 ms sul cursore)
e ignara del *chi*: `refreshAllViews()` a ogni salvataggio è sparito dal
frontend, ed era il ridisegno cieco che il §2.1 imputa alla shell.

*La modalità è un enum chiuso a tre.* Sorgente, Live Preview, Lettura: le tre
esclusive di 4.1. Focus mode, zen, typewriter, schermo intero non sono modalità
ma disposizioni della shell — non cambiano *cosa* un provider deve fare. Una
quarta esclusiva (WYSIWYG, block editor) è un caso in fondo, cioè additiva. Per
non lasciare il campo senza produttore vero, la shell ha ora il commutatore a
tre: Sorgente spegne la resa inline (un `Compartment` di CodeMirror, niente
editor ricostruito), Lettura mette il documento **reso** al posto dell'editor,
nello stesso spazio. Con questo il **pannello anteprima sparisce dalla colonna
di destra**: era una seconda superficie sullo stesso documento, sempre accesa e
sempre da tenere allineata, mentre "esclusive" è ciò che `PaneMode` dichiara.
Entrare in lettura fa prima un flush del buffer, perché il documento reso lo
produce il kernel dal sorgente salvato e leggere la nota di un minuto fa non
sarebbe leggerla. E i colori sono **gli stessi** — fondo, testo e titoli: la
tavolozza della superficie
del documento (`--doc-*` in `style.css`) è ora l'unico posto dove sono scritti,
e la legge sia la resa di Lettura sia il tema della live preview sia il fondo
dell'editor — tre modalità della stessa nota non possono essere di tre colori
diversi, e due copie degli stessi hex divergono al primo ritocco.

*Trovato per strada e chiuso (guardando l'app girare):* riaprire **lo stesso
vault** dal dialogo piantava l'app per sempre. `open_vault` costruiva la
sessione nuova e solo alla fine sostituiva la vecchia, ma l'indice di ricerca
tiene un lock esclusivo di scrittura sulla propria cartella e tantivy quel lock
lo aspetta *bloccando*: nessun errore, nessun log, la finestra a metà. Ora la
sessione vecchia si chiude prima che la nuova si apra — col prezzo dichiarato
che se l'apertura fallisce non si torna indietro. Nello stesso giro: un avvio
che fallisce non muore più in silenzio (`init().catch`), e la **modalità del
pannello** si ricorda fra le sessioni in `localStorage`, come le cartelle aperte
e lo spazio selezionato (è stato di vista, non organizzazione del vault).

*Trovato per strada e chiuso:* il **ponte inverso** del §18.1 non c'era.
`offsets.ts` sapeva solo byte → code unit; senza l'inversa nessuna azione
dell'editor può nominare uno `Span`, ed è per questo che questa voce aveva quel
prerequisito. Ora c'è (`charToByteIndex`), con i test che provano l'andata e il
ritorno su accenti ed emoji.

*Resta fuori, dichiarato:* **legare una view a un pannello** (due pannelli
backlink affiancati) è il §2.3 — questo giro dà l'identità del pannello nel
contesto, non le istanze di view; l'**evidenziazione** della sezione corrente
nell'outline usa il sottotitolo di un `ListItem` perché `UiNode` non ha una
nozione di elemento corrente, ed è roba del §2.1/§2.8; il **multi-cursore e le
selezioni multiple** (4.2) — `Selection` ne porta una, e la seconda sarebbe
`list<selection>`, cioè additiva solo cambiando il tipo del campo: qui la scelta
è dichiarata, non dimenticata (una shell con più cursori pubblica quello
primario finché non arriva 4.2); il **conflitto buffer↔disco** (§18.1), che resta
custodito da un flag della shell — il contesto ne subisce l'effetto (niente
span) ma non lo risolve.
