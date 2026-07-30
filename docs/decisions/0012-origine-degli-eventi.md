# 0012 — Gli eventi non dicono chi li ha causati

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.18 (terzo giro) |
| **Commit** | `83cc306` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **`Event::DocumentChanged { id }` non portava origine né causalità.** Ora
      un handler riceve un `Notice { event, origin }`, e la shell l'origine la
      **legge**: `document_changed` con `actor: watcher` significa «un'altra
      applicazione ha scritto questo file», che col buffer sporco è un avviso
      diverso da «l'abbiamo riscritto noi».
- [x] **Con i trigger diventa un requisito**: la difesa non è più il
      `DISPATCH_BUDGET` che tronca. `Actor::is_plugin(id)` risponde alla domanda
      «questa l'ho scritta io?», ed è provata su un'automazione che senza di essa
      si richiama da sola fino al troncamento
      (`fub-kernel/tests/batch_and_origin.rs`).
- [x] **Un campo `origin`**: `Origin { actor: Actor, batch: Option<BatchId> }`,
      con `Actor { User, Watcher, Kernel, Plugin { id } }` — l'elenco che questa
      voce chiedeva — e l'id di lotto della [decisione 0011](../decisions/0011-il-lotto.md) sullo stesso record.

*Sblocca:* 16.2 (trigger su-modifica che non si richiamano da soli), 18 (sync),
19.2 (collaborazione), 22.4 (l'attribuzione, di cui questo è il primo pezzo).

**Fatto insieme alla [decisione 0011](../decisions/0011-il-lotto.md), con tre decisioni e una firma pubblicata ritagliata.**

*L'origine viaggia su OGNI evento, in un record accanto ad esso.* Non solo sul
terminale del lotto: il requisito di 16.2 è che un handler decida **mentre
reagisce**, e un'origine che arrivasse solo alla fine gli direbbe chi è stato
dopo che ha già riscritto. E in un `Notice { event, origin }` invece che in un
campo dentro ogni variante, perché l'origine è ortogonale a *cosa* è successo:
ripeterla in nove casi avrebbe costretto ogni `match` a destrutturarla anche dove
non la guarda.

*L'attore è chi ha CHIESTO, non chi ha eseguito.* È la decisione che dà al campo
il suo unico lettore vero. Quando un'automazione invoca `vault.replace`, i
documenti li scrive il comando — ma se l'origine dicesse "il comando", quella
automazione non riconoscerebbe le proprie scritture e si richiamerebbe da sola,
che è esattamente il caso per cui il campo esiste. Perciò: un `EventHandler` che
scrive di propria iniziativa è `Plugin { id }`; un comando invocato è l'attore
del **chiamante**; il watcher è `Watcher` perché quella scrittura non è passata
da noi; e ciò che il kernel fa per conto suo (apertura, `job-done`, `overflow`) è
`Kernel` — intestarlo a chi stava scrivendo direbbe a un'automazione «questa
l'hai causata tu» proprio nel momento in cui le si chiede di riconciliare.

*L'origine accompagna l'invocazione di un comando — e sì, si fa adesso.* Era la
quinta domanda, quella che tocca una firma già pubblicata:
`invoke_command(command, args, mode, by: Actor)`. Sì, per la ragione del
paragrafo sopra: senza, ogni invocazione sarebbe attribuita a chi la esegue o a
un default, e la CLI (27.1), l'API locale (27.2) e le automazioni (16.2) —
cioè i chiamanti per cui il registro della [decisione 0009](../decisions/0009-registro-dei-comandi.md) esiste — nascerebbero tutti
travestiti da utente. Che sia un parametro e non un default è la stessa scelta di
`InvokeMode`: un'attribuzione implicita è l'errore che il tipo esiste per rendere
impossibile. Sul confine Tauri l'attore **non** è un parametro dell'IPC ma è
fissato a `User`: da quel canale passa la webview, e un chiamante che potesse
firmarsi come vuole avrebbe aggirato l'unica difesa che 16.2 ha.

Ciò che invece **non** cambia è `CommandProvider::invoke`: l'origine è ciò che
l'host *appone*, non ciò che il comando *legge*, e un comando che si comportasse
diversamente a seconda di chi lo chiama sarebbe una policy (§7.3) nascosta
dentro un'implementazione. Il giorno che servirà leggerla, è un metodo additivo
sull'`HostApi` — non una firma da riaprire.

*La linea di base è stata ritagliata, e si vede in review.* `event-handler.handle`
prendeva un `event` nudo e adesso prende un `notice`: è l'unica rottura del giro,
sta in `crates/fub-abi/wit/frozen/0.1.0.wit` con la ragione accanto, e il test di additività la
tratta come tale. Aggiungerla dopo il freeze sarebbe costata una major, o una
seconda funzione accanto alla prima con la stessa semantica e un argomento in
più. Tutto il resto è additivo: `batch-ended` in coda a `event` e a `event-kind`,
e i tipi nuovi (`notice`, `origin`, `actor`, `batch-id`, `event-batch-ended`).

*Resta fuori, dichiarato:* **quale comando** ha causato l'operazione, e con esso
il **prompt** e il **modello** di 22.4 — `Origin` porta l'attore e il lotto, non
l'id del comando: sono i campi di un audit trail, e un audit trail vuole un posto
che li **conservi** (il journal del §15.2), mentre un campo che nessuno rilegge
dopo la fine del giro è una decorazione. Additivo il giorno che il posto c'è, ed
è la ragione per cui la voce «attribuzione» della [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md) resta aperta a metà: il
campo ha un lettore vero (l'automazione che salta le proprie scritture), l'audit
no. Fuori anche la **causalità a catena** (quale evento ha causato quale: `Origin`
dice chi, non da cosa) e l'**edit sull'evento** (chi riceve `document-changed` sa
che il documento è cambiato, non *come*).
