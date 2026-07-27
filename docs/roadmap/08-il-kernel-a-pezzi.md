# 8. Il kernel a pezzi, e chi lo monta

Una **seduta** della [roadmap infrastrutturale](../todo.md): l'oggetto-dio è scomposto ([0022](../decisions/0022-il-kernel-a-pezzi.md)) e il montaggio è un crate ([0023](../decisions/0023-chi-monta-il-kernel.md)); resta il lock.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Precedenza dura, e veniva dal quarto giro: **l'8.1 andava prima dell'8.2 e
dell'8.3**, o il crate host sarebbe nato attorno all'oggetto-dio e il lock non
avrebbe mai potuto essere a grana fine. Le prime due sono chiuse, in
quest'ordine:

- l'**8.1** con la [decisione 0022](../decisions/0022-il-kernel-a-pezzi.md):
  `Workspace` non ha più ventiquattro campi piatti ma cinque proprietari —
  `DocumentStore`, `Indexes`, `ProviderRegistry`, `Dispatcher`, `Session`;
- l'**8.2** con la [decisione 0023](../decisions/0023-chi-monta-il-kernel.md):
  il composition root è il crate `fubmd-host`, che non dipende da tauri, e
  `fubmd-app` è ciò che resta togliendolo — comandi IPC, ponte eventi, finestre.

Cosa quelle due lasciano in mano all'unica che resta, e che prima non c'era:
qualcosa da lockare **separatamente** — e in più la linea lungo cui farlo, che
la 0022 ha già tracciata: le letture pure (chi possiede un id, cosa ha
dichiarato, di chi ci si fida) stanno nei componenti, le chiamate ai provider
restano orchestrazione sul `Workspace` e non potranno mai essere a grana fine,
perché ognuna vuole un `HostApi` costruito su tutto il workspace.

Resta anche ciò che la 0022 ha visto e non ha preso: **`CoreIndex` è un
oggetto-dio annidato** — trenta accessi a `indexes` su trentuno passano da
`indexes.core`. È lo stesso lavoro un giro più in basso, e non ha ancora un
numero.

E resta ciò che la 0023 ha **spostato senza risolvere**, che è il modo in cui
questa seduta consegna alle altre: il registry dei bundle (§9.3), lo spegnimento
(§9.5), le sessioni multiple (§9.6) e gli errori tipizzati (§12.2) hanno adesso
un posto solo dove atterrare — `fubmd-host` — invece di ventidue comandi Tauri.

### 8.3 Concorrenza

*ex §2.4 · kernel · **P2** — misurare prima — assorbe il «mutex unico» del quarto audit*

- [ ] **`RwLock` sul `Workspace`** con `render_view`/`query_index`/`render_*` in
      prestito condiviso (il percorso `&self` è già stato preparato). Misurare
      prima, ma il carico è già identificato: le letture sono le view.
- [ ] **Lavoro lungo fuori dal lock**: reindicizzazione, scansione iniziale,
      import, export, embedding — con eventi di progresso ([decisione 0013](../decisions/0013-elenco-delle-capacita.md)) e un centro
      attività (§10.3).
- [ ] **Cancellazione**: un job che non si può fermare è un job che blocca la
      chiusura dell'app.
