# 8. Il kernel a pezzi, e chi lo monta

Una **seduta** della [roadmap infrastrutturale](../todo.md): l'oggetto-dio va scomposto **prima** di ciò che gli atterra sopra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Precedenza dura, e viene dal quarto giro: **l'8.1 va prima dell'8.2 e
dell'8.3**, o il crate host nasce attorno all'oggetto-dio e il lock non potrà mai
essere a grana fine. È anche il posto dove tutte le altre voci di questo piano
andranno ad atterrare — una alla volta, come campi: il piano stesso ne conta
dodici in arrivo sullo stesso `struct`.

### 8.1 `Workspace` è un oggetto-dio, e ogni voce di questo piano gli aggiunge un campo

*ex §2.19 · kernel · **P1** — leva alta: **prima** dell'8.2 e dell'8.3*

- [ ] **1750 righe e ~20 campi**, che mettono insieme: I/O del vault, registry
      dei formati, cache dei metadati, grafo, conteggi tag, event bus, coda e
      dispatcher, **tre** tabelle di provider, storage dei plugin, stato di
      sessione (`active`), coda dei job. Il §7.2 (`ProviderTable`) e il §8.3
      (`RwLock`) ne sono le due conseguenze già viste; la causa no, e ha due
      effetti che il resto del piano dà per risolti:
      - il `RwLock` del §8.3 **non potrà essere a grana fine**: un lettore che
        rende una view e uno scrittore che tocca il grafo sono lo stesso
        `struct` dietro lo stesso lock, quindi "le letture sono le view" resta
        vero e inutile;
      - il crate host del §8.2 sarebbe riusabile **tutto o niente**: CLI
        (27.1), API locale (27.2), e2e headless (27.4), mobile (26.2) e PWA
        (26.3) prenderebbero comunque il `Workspace` intero, col suo grafo
        delle dipendenze — che è il §16.3 perso dal lato del kernel.
- [ ] **E i sottosistemi che questo piano aggiunge sono dodici**: comandi
      ([decisione 0009](../decisions/0009-registro-dei-comandi.md)), impostazioni (§11.1), lotti ([decisione 0011](../decisions/0011-il-lotto.md)), edit ([decisione 0008](../decisions/0008-modifica-chirurgica.md)), undo (§13.3),
      storage (§15.1), allegati (§14.1), registry e job (§9.3), sessioni (§9.6),
      permessi (§7.3), cartelle (§14.3), ignore policy (§15.6). Dodici campi
      in più sullo stesso `struct`, e dodici ragioni in più per prendere lo
      stesso lock.
- [ ] **La scomposizione va decisa prima di aggiungerli**, non dopo:
      `DocumentStore` (vault + cache + parse), `MetadataIndex` (grafo + tag +
      outline), `ProviderRegistry` (§7.2 + §9.4 + §7.3), `Dispatcher` (coda +
      budget + origine della [decisione 0012](../decisions/0012-origine-degli-eventi.md)), `Session` (attivo + pane della [decisione 0007](../decisions/0007-contesto-di-sessione.md)). È anche
      il modo di dare al §8.2 un pezzo riusabile che non sia "tutto".
- [ ] **Ordine**: viene **prima** del §8.2 e del §8.3, o quei due nascono
      attorno all'oggetto-dio e lo rendono definitivo.

### 8.2 Il montaggio dell'app vive dentro un comando Tauri

*ex §2.15 · kernel · **P1** — cinque clienti previsti e nessuno può riusare il montaggio*

- [ ] **`open_vault` (`app/lib.rs:109-208`) È il composition root**: registry
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
