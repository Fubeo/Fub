# 8. Il kernel a pezzi, e chi lo monta

Una **seduta** della [roadmap infrastrutturale](../todo.md): l'oggetto-dio è scomposto ([0022](../decisions/0022-il-kernel-a-pezzi.md)); restano chi lo monta e il lock.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Precedenza dura, e veniva dal quarto giro: **l'8.1 andava prima dell'8.2 e
dell'8.3**, o il crate host sarebbe nato attorno all'oggetto-dio e il lock non
avrebbe mai potuto essere a grana fine. **L'8.1 è chiusa** con la
[decisione 0022](../decisions/0022-il-kernel-a-pezzi.md): `Workspace` non ha più
ventiquattro campi piatti ma cinque proprietari — `DocumentStore`, `Indexes`,
`ProviderRegistry`, `Dispatcher`, `Session` — e le due voci che restano hanno su
cosa poggiare.

Cosa la 0022 lascia in mano a queste due, e che prima non c'era:

- all'**8.2**, un pezzo riusabile che non sia «tutto»: i cinque componenti sono
  ciò che una CLI, un'API locale o un e2e headless possono prendere senza
  prendersi il grafo delle dipendenze intero;
- all'**8.3**, qualcosa da lockare separatamente — e in più la linea lungo cui
  farlo, che la 0022 ha già tracciata: le letture pure (chi possiede un id, cosa
  ha dichiarato, di chi ci si fida) stanno nei componenti, le chiamate ai
  provider restano orchestrazione sul `Workspace` e non potranno mai essere a
  grana fine, perché ognuna vuole un `HostApi` costruito su tutto il workspace.

Resta anche ciò che la 0022 ha visto e non ha preso: **`CoreIndex` è un
oggetto-dio annidato** — trenta accessi a `indexes` su trentuno passano da
`indexes.core`. È lo stesso lavoro un giro più in basso, e non ha ancora un
numero.

### 8.2 Il montaggio dell'app vive dentro un comando Tauri

*ex §2.15 · kernel · **P1** — cinque clienti previsti e nessuno può riusare il montaggio*

- [ ] **`open_vault` (`app/lib.rs`) È il composition root**: registry
      dei formati, indice di ricerca, versioning, le tre view, il watcher, il
      ponte eventi e la sessione si montano lì dentro, in un
      `#[tauri::command]`, in un crate che dipende da tauri e notify.
- [ ] **Ma quel montaggio ha già cinque clienti previsti**: la CLI (27.1),
      l'API/REST locale (27.2), l'headless degli e2e (§17.2 e 27.4), il mobile
      (26.2) e il PWA (26.3). Nessuno di loro può riusarlo, e ognuno finirebbe
      per ricopiarlo — cioè per avere una propria idea di quali feature
      esistono e in che ordine si registrano.
- [ ] **Serve un crate `fubmd-host`** (sessione, registry del §9.3, runner dei
      job, watcher dietro un trait, storage del §15.1) con `fubmd-app` ridotto a
      colla Tauri: comandi IPC, dialoghi, finestre. È il §16.3 visto dall'altro
      lato — quello divide le feature, questo separa *chi le monta* da *chi
      disegna*.

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
