# 4. Chi vede il modello parsato

Una **seduta** della [roadmap infrastrutturale](../todo.md): *chi vede la struttura di un documento?* Oggi: il kernel, e chi indicizza.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Tre voci che il quinto giro chiama «una seduta sola» (§4.2 con §4.1 e §4.3),
più la quarta che pone la stessa domanda dal lato della shell. La domanda è una:
*chi vede la struttura di un documento?* La risposta di oggi è **il kernel, e
chi indicizza** — `render_preview` restituisce una stringa, `read_document` una
sorgente, e l'unico verso in cui il `DocumentModel` attraversa il contratto è
`IndexProvider::on_document_indexed`: spinto, a chi indicizza, quando lo decide
il kernel. **Chiederlo non si può**, in nessuna direzione.

Le due metà vanno decise insieme o si ottiene un modello che arriva alla webview
e non al provider che deve lavorarci — o il contrario. Ed è la stessa domanda
che tiene in piedi i due parser (4.4): finché il modello non ha un canale, «le
decorazioni semantiche vengono dal modello» resta un'intenzione e ogni sintassi
nuova continua a nascere due volte.

### 4.1 Il canale del rendering — stringa HTML o modello?

*ex §1.13 · contratto · **P0** — la metà shell della domanda*

- [ ] **Decidere se il modello arriva alla shell**: `render_preview` restituisce
      una `String` che il frontend innesta con `innerHTML` (`main.ts:1190-1191`), e
      **nessun comando restituisce un `DocumentModel`** — il modello parsato dal
      Rust non attraversa mai il confine dell'IPC (dentro il contratto un verso
      c'è, e sta nel §4.2). Sopra quella stringa opaca il capitolo
      6.1 vuole lazy loading, lightbox, hover popover, scroll sync
      editor↔anteprima, copy button, rendering incrementale, mermaid/math
      sicuri; il 5.3 vuole sanitizzazione.
- [ ] L'alternativa da mettere a verbale: `render_html` resta la **fast-path**
      per la lettura, e il modello con gli `Span` diventa il canale di ciò che è
      interattivo. È la stessa decisione del §4.4 (due parser) vista dal lato del
      contratto: finché il modello non ha un canale, il secondo livello di
      decorazione del §18.1 resta un'intenzione.

### 4.2 Il modello parsato si riceve, non si chiede

*ex §1.28 · contratto · **P0** — leva media: rende **stretto**, non inesprimibile; manca il verso pull*

- [ ] **Un provider riceve la struttura, non la può chiedere.** L'`HostApi` dà
      `read_document -> String` (`abi/traits.rs:112`) e `query_index`; il
      `FormatProvider` vive nel kernel e non è raggiungibile da fuori
      (`kernel/workspace.rs:2144-2155`). Un verso però esiste, ed è uno:
      `IndexProvider::on_document_indexed(&mut self, doc: &DocumentModel)`
      (`abi/traits.rs:928`), che il kernel chiama a ogni indicizzazione
      (`workspace.rs:453`, `:588`, `:946`) — più le briciole di
      `IndexQuery::Outline` e `IndexQuery::Tags`. Il primo giro su questa voce
      diceva «il `DocumentModel` non attraversa il contratto in nessuna
      direzione»: **era sbagliato**, e correggerlo cambia la voce. Il modello
      attraversa, ma **spinto, a chi indicizza, quando lo decide il kernel**.
- [ ] **Chi sta dentro un `IndexProvider` è già servito**, e sono più di quanti
      il primo giro dichiarava inesprimibili: un indice dei task (10), le
      flashcard da blocchi (21.2), le citazioni (15.1), il chunking per
      l'embedding (22.1) ricevono ogni modello mentre passa, derivano quello che
      gli serve, lo persistono con `data_*` e rispondono — via
      `IndexQuery::Custom`, che il §5.1 dice essere l'unica variante che gli
      arriva. Non è comodo, ma è esprimibile, e questa voce non è più «leva alta:
      rende inesprimibile».
- [ ] **Tagliato fuori è il percorso one-shot**: chi ha bisogno del modello di
      *questo* documento *adesso*, e non era in ascolto quando è passato. Un
      comando che spunta il task sotto il cursore (10) o scrive una proprietà
      (8.2), un `ExportProvider` su un documento solo ([decisione 0006](../decisions/0006-import-export-come-trait.md)), un linter o
      una statistica su richiesta (4.3), un TOC generato al volo (5.2). Per loro
      le strade sono due, entrambe storte: riparsare con un parser proprio —
      ed è il §3.1 visto dal lato del consumo — o **registrare un
      `IndexProvider`-specchio** al solo scopo di vedere i modelli passare, cioè
      tenere una copia dell'intero vault per rispondere a una domanda su una nota.
- [ ] **È il gemello lato provider del §4.1**, che pone la stessa domanda dal
      lato della shell: *chi vede il modello?* Le due metà vanno decise insieme o
      si ottiene un modello che arriva alla webview e non al provider che deve
      lavorarci.
- [ ] La forma da scegliere ora: `HostApi::document_model(id)` oppure
      `IndexQuery::Model { doc }` — e con essa la risposta a *quale* modello,
      visto che la cache tiene i soli metadati (`workspace.rs:154-159`: id,
      frontmatter, outline, link) e il corpo si riparsa dal disco. Un canale che
      riparsa a ogni chiamata è una firma diversa da uno che serve una cache, e la
      differenza si vede solo quando il chiamante cammina l'intero vault — cioè in
      ogni voce del 17.

*Sblocca:* i percorsi one-shot di 10 e 8.2, 17.2 e la [decisione 0006](../decisions/0006-import-export-come-trait.md) (un
`ExportProvider` senza modello esporta testo grezzo), 5.2 (TOC, indici), 4.3 —
e toglie l'`IndexProvider`-specchio dalla strada di 15.1, 21.2 e 22.1, che oggi
è la loro unica alternativa al parser proprio.

### 4.3 Il contratto non dice di che formato è un documento

*ex §1.29 · contratto · **P0** — va con la 3.4 e la 3.5*

- [ ] **Nessuna capacità restituisce il `FormatDescriptor` o le
      `FormatCapabilities` di un `DocId`.** Un provider che riceve una lista da
      `list_documents` non ha modo di distinguere una nota da un canvas, un
      CSV, un PDF o un allegato: non può decidere se sa lavorarci, e nemmeno se
      *deve* ignorarlo.
- [ ] Oggi non si vede perché il formato è uno solo. Serve appena ne esiste un
      secondo (12 canvas, 11.4 CSV/JSON, 13.2 PDF) e appena il vault contiene
      cose che documenti non sono (§14.1), cioè esattamente quando il §3.4
      aprirà `parse` ai formati non-testo.
- [ ] Va deciso con il §3.5 (`FormatCapabilities` come mappa con namespace) e
      con il §3.4: sono la stessa domanda — *cosa so di questo documento senza
      averlo aperto* — vista dal lato del vault invece che del parser.

### 4.4 Due parser per la stessa sintassi

*ex §3.8 · shell · **P1** — la conseguenza visibile: sei regole scritte due volte*

- [ ] **Decidere quanto durano due grammatiche**: il Rust parsa con comrak per
      l'anteprima, il frontend parsa **di nuovo** con Lezer + regex per la live
      preview (wikilink, `#tag`, `==evidenziato==` e checkbox riconosciuti per
      riga in `livepreview.ts`). Per le decorazioni **sintattiche** è una scelta
      dichiarata e buona — il tree Lezer è già in code unit e non costa IPC — ma
      le estensioni del capitolo 5.2 sono ~50 (callout, footnote, definition
      list, embed, apici/pedici, tabs, timeline, stepper, math…) e ognuna
      andrebbe scritta due volte, in due linguaggi, con due nozioni di offset.
- [ ] Il secondo livello del §18.1 (semantica dagli `Span` del modello) **non ha
      un canale**: nessun comando restituisce il modello (§4.1). Finché non
      c'è, "le decorazioni semantiche vengono dal modello" resta un'intenzione e
      la sintassi nuova continua a nascere due volte.
