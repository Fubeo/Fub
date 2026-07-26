# 10. Gli eventi: grana, freno, destinatari

Una **seduta** della [roadmap infrastrutturale](../todo.md): lo stesso canale a tre distanze: chi si abbona, quanti messaggi passano, chi li mostra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Tre voci sullo stesso canale, viste a tre distanze: chi si abbona e con quale
grana (10.1, ed è firma), quanti messaggi passano il ponte verso la webview
(10.2), e chi li mostra all'utente (10.3). La terza è già decisa a metà — la
[decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha stabilito che `notify` **non** è una capacità dell'`HostApi` ma un
evento — e quella
decisione è la ragione per cui le tre stanno insieme: il centro notifiche è il
primo cliente vero del ponte, e il ponte non ha una politica sua.

### 10.1 L'abbonamento agli eventi non filtra

*ex §1.19 · contratto · **P0** — la forma della maschera è contratto*

- [ ] **La maschera è un `Vec<EventKind>` su 9 varianti** (`EventMask`,
      `abi/event.rs:295-315`; la nona è `BatchEnded`, che ha portato la
      [decisione 0011](../decisions/0011-il-lotto.md) — e la maschera cresce
      **per varianti**, che è il punto di questa voce), e a
      [`Event::Custom`] ci si abbona a grana `EventKind::Custom`
      (consegna in `workspace.rs:2078-2084`): con i moduli
      FubSuite che si parlano fra loro (21.2), ogni handler si sveglia per
      **ogni** custom di **ogni** plugin.
- [ ] **Manca la grana del soggetto**: nessuno può abbonarsi a "i cambiamenti
      di questa cartella" o "di questo documento", quindi l'evento più caldo
      (`DocumentChanged`) sveglia tutti, N feature × M documenti. Prefisso di
      topic per i custom e filtro per documento/cartella per gli altri: la
      forma della maschera è contratto, e va allargata prima che le famiglie di
      provider si moltiplichino.

### 10.2 Il ponte degli eventi non ha né freno né raggruppamento

*ex §2.27 · kernel · **P2** — il primo cliente vero sarà il progresso dei job (9.3)*

- [ ] **`EventBus` usa canali `std::mpsc` illimitati** (`kernel/bus.rs:11-17`:
      `channel()`, non `sync_channel`) e il ponte verso la webview emette **un
      messaggio IPC per evento**
      (`app/lib.rs:209-215`). Un subscriber lento non rallenta nessuno: accumula
      memoria, in silenzio, senza un tetto — l'opposto del `DISPATCH_BUDGET`
      che protegge gli handler.
- [ ] **E ogni evento costa un giro di shell**: a ogni `index_updated` (o
      `batch_ended`) la shell rifà `list_documents` e ridisegna ogni view
      iscritta. La [decisione 0011](../decisions/0011-il-lotto.md) ha ridotto gli eventi *che costano un ridisegno* —
      dentro un lotto ne arriva uno solo, e una rinomina con 200 backlink è
      passata da 201 giri a 1 — ma non ha toccato il **numero di messaggi IPC**:
      i 200 `document_changed` attraversano il ponte lo stesso, uno per uno.
      Resta che il ponte non ha una politica sua — coalescing per tipo, finestra
      temporale, tetto oltre il quale si degrada a "riconcilia tutto", che è poi
      ciò che `Event::Overflow` già significa per gli handler.
- [ ] Va con §8.3 (il lavoro lungo emette progresso: sarà il canale più caldo di
      tutti) e §10.3 (il centro attività è il suo primo cliente).

### 10.3 Notifiche e attività in background

*ex §3.5 · shell · **P2** — alimentato da un **evento**, non da una capacità — deciso in 0013*

- [ ] **Toast/notification center** alimentato da un **evento**, non da una
      capacità: la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha deciso che `notify` non è un metodo dell'`HostApi` —
      una capacità è ciò di cui il chiamante ha bisogno della risposta per
      proseguire, e ciò che si limita a informare è un evento. Da evento porta
      già `Origin.actor` (chi lo ha detto) e in simulazione non compare (`emit`
      su un host in sola lettura è un no-op). Oggi gli errori finiscono in
      `eprintln!` e l'utente non li vede; il percorso in cui c'è qualcuno che
      aspetta ha già `CommandOutcome.notify`.
- [ ] **Centro attività**: job in corso, progresso, cancellazione (24.1).
