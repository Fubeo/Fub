# 10. Gli eventi: grana, freno, destinatari

Una **seduta** della [roadmap infrastrutturale](../todo.md): lo stesso canale a tre distanze: chi si abbona, quanti messaggi passano, chi li mostra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Tre voci sullo stesso canale, viste a tre distanze: chi si abbona e con quale
grana, quanti messaggi passano il ponte verso la webview, e chi li mostra
all'utente. **Le prime due sono chiuse**, ed erano la stessa domanda posta ai due
capi del canale — *a chi interessa questo evento?* — una volta a chi si abbona
([0033](../decisions/0033-la-grana-di-un-abbonamento.md): il prefisso di topic e
il soggetto) e una volta a chi consegna
([0034](../decisions/0034-il-freno-e-il-raggruppamento.md): il tetto degli
arretrati e il raggruppamento della raffica).

Resta la terza, che era già decisa a metà — la
[decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha stabilito che
`notify` **non** è una capacità dell'`HostApi` ma un evento — e quella decisione
è la ragione per cui le tre stavano insieme: il centro notifiche è il primo
cliente vero del ponte, e il ponte non aveva una politica sua. Adesso ce l'ha, e
quel che manca alla terza è solo il posto in cui l'utente guarda.

### 10.3 Notifiche e attività in background

*ex §3.5 · shell · **P2** — alimentato da un **evento**, non da una capacità — deciso in 0013*

- [ ] **Toast/notification center** alimentato da un **evento**, non da una
      capacità: la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha deciso che `notify` non è un metodo dell'`HostApi` —
      una capacità è ciò di cui il chiamante ha bisogno della risposta per
      proseguire, e ciò che si limita a informare è un evento. Da evento porta
      già `Origin.actor` (chi lo ha detto) e in simulazione non compare (`emit`
      su un host in sola lettura è un no-op). Oggi gli errori finiscono in
      `eprintln!` da un lato del confine e in `console` dall'altro, e l'utente
      non li vede; il percorso in cui c'è qualcuno che aspetta ha già
      `CommandOutcome.notify`.
- [ ] **Questa voce non è la superficie: è la sua forma bella.** Che nella shell
      *esista un posto* dove un messaggio può comparire è il §20.4 (**P1**), che
      lo dice già dal suo lato («il §10.3 la farà bella; qui basta che esista») e
      ne conta dodici occasioni mancate. Quella viene prima e va comunque fatta;
      questa aggiunge il canale a evento, lo storico e il raggruppamento. Non
      vanno unite, ma nemmeno prese nell'ordine sbagliato.
- [ ] **Centro attività**: job in corso, progresso, cancellazione (24.1). È la
      terza destinazione del secondo punto del §8.3 — «lavoro lungo fuori dal
      lock, con eventi di progresso e un centro attività» — di cui la
      [decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md) ha
      chiuso la firma e la [0032](../decisions/0032-il-runner-dei-job.md) il
      runner: qui sta il posto in cui l'utente lo vede e lo ferma. Fermarlo ha
      già la sua porta — `Host::cancel_job`, che oggi usano solo i presidi — e
      quel che manca è **vederlo**.
- [ ] **Il progresso di un job è di questa voce, e la 0034 ha lasciato il nodo
      sciolto a metà.** Il rimando era circolare — il §10.2 lo mandava qui e
      questa voce lo rimandava là — e la
      [0034](../decisions/0034-il-freno-e-il-raggruppamento.md) ne ha tagliato la
      metà che le competeva: il ponte adesso regge il canale più caldo che ci
      sarà. Resta la domanda che qui va decisa **col centro attività davanti**,
      e porta con sé un fatto scoperto misurando: **un job non conosce il proprio
      `JobId`**. `Plugin::run_job` riceve la `JobSpec` e l'host, non l'identità,
      quindi non può emettere un evento che lo nomini — chi l'identità ce l'ha è
      il suo host. Per la regola della
      [0013](../decisions/0013-elenco-delle-capacita.md) il progresso è un
      **evento** (si limita a informare); ma l'unico che può emetterlo con l'id
      giusto è l'host del job, cioè un `report_progress` che sarebbe una
      **capacità**. Scegliere senza sapere cosa l'utente deve vedere — una barra?
      un conto? un'etichetta che cambia? — vorrebbe dire scegliere la firma prima
      del requisito.
