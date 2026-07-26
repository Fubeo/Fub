# 3. Chi disegna ciò che il core non conosce

Una **seduta** della [roadmap infrastrutturale](../todo.md): una decisione sola vista da tre lati: sintassi, blocco, renderer nella shell.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Chiusa dalla [decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)**,
tranne la metà implementativa della §3.3. Il quarto giro diceva che §3.1, §3.2 e
§3.3 erano una decisione sola vista da tre lati — chi aggiunge la *sintassi*, chi
disegna il *blocco* che ne esce, chi fa entrare un renderer di terzi nella
*shell* — e che andavano prese insieme o due terzi della risposta sarebbero stati
inutilizzabili. Il perno che le tiene insieme si è rivelato essere il
`custom_kind`: un nome con namespace lo produce, lo stesso nome lo disegna, lo
stesso nome arriva alla shell dentro `UiKind::Custom { ns }`.

Con loro sono chiuse la §3.4 (le opzioni di parse), la §3.5 (i quattro tipi
chiusi troppo presto, che sono diventati **un tipo solo** con namespace) e la
§3.6 (sanitizzazione e CSP in un punto solo). Il verbale dice cosa si è scartato
e cosa resta scoperto.

### 3.3 La UI di un plugin non ha modo di entrare nella shell

*ex §3.12 · shell · **P1** — la decisione è presa ([0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)); resta il grafo*

- [x] **La decisione fra le tre opzioni.** Si è scelta la terza — *solo prima
      parte, e tutto il resto dichiarativo* — con la precisazione che questa voce
      chiedeva: il protocollo dichiarativo **arriva ai blocchi custom** e non
      solo alle view, quindi il blocco di un plugin arriva a schermo senza una
      riga nel bundle della shell. Il registro di web component è scartato
      (sbatte contro «no eval policy» del 20.3 e contro la CSP che la 0017
      stringe); l'**iframe sandboxato con un protocollo di messaggi** è la strada
      del widget vero e va a M5, con l'asset story e la CSP dedicate che la
      [decisione 0016](../decisions/0016-cosa-e-una-view.md) aveva già messo lì
      per `WebView`.
- [x] **`UiKind::Custom` ha il suo primo cliente** — il diagramma — e ha portato
      con sé la scoperta che il ramo «la shell che conosce `ns` disegna il suo
      widget» **ancora non serve**: il `fallback` dichiarativo è la resa giusta
      finché non c'è un motore da invocare. Il registro `ns` → widget resta non
      costruito, con un cliente in più che lo conferma invece di smentirlo.
- [ ] **Il grafo è ancora un pannello nativo** (`panels/graph.ts`), ed è ciò che
      resta di questa voce. Non è più bloccato da qui: l'area principale c'è nel
      contratto dalla decisione 0016 e da adesso c'è anche *come* disegnarci
      qualcosa che il core non conosce. Portarcelo vuole il **modello di layout**,
      che è la [§1.2](01-forma-della-shell.md#12-smontare-il-monolite) e va deciso
      con `PaneId` e le sessioni multiple della [§9.6](09-il-lavoro-lungo-e-lo-spegnimento.md#96-sessioni-multiple).
- [ ] **Il conto del 21.1 resta da saldare**: ogni modulo Suite è «installabile
      separatamente» e «disattivabile», e FubCanvas, FubDB, FubCharts, FubMaps e
      FubForms (21.2) hanno bisogno di un renderer proprio. Con la strada
      dichiarativa aperta la promessa è vera per la maggior parte di ciò che
      disegnano; per i canvas ad alte prestazioni resta vera solo a M5, ed è il
      limite che l'[asterisco di onestà](../architecture/ui-protocol.md) dichiara
      già per la graph view.
