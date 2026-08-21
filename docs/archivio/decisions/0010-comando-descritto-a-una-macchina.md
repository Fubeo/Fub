# 0010 — Un comando si descrive a un umano, non a una macchina

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.36 (fuori dai giri (FEATURES 22.4)) |
| **Commit** | `8cae9b4` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[PIANO.md](../PIANO.md)

---

Il capitolo 22.4 (centro di comando LLM) chiede una cosa che nessun'altra voce
di FEATURES chiede: che un **chiamante non umano** scelga fra i comandi
disponibili, li invochi con argomenti che non gli sono stati insegnati, e lo
faccia su *più note insieme* o sulle impostazioni. La
[decisione 0009](../decisions/0009-registro-dei-comandi.md) gli dà il registro;
quello che manca è tutto ciò che rende un registro utilizzabile da chi non ha
letto il codice.

- [x] **`CommandSpec` descrive gli argomenti**:
  `{ id, title, description, keybinding, params: Vec<ParamSpec>, scope }` in
  `abi/command.rs`, con
  `ParamKind { Text, Number, Bool, Document, Documents, Choice }`. Uno schema a
  sé e **non** i nodi del §2.1: dichiarare *cosa serve* e disegnare *come lo si
  chiede* sono due domande, e solo la prima ha senso per una CLI o per un
  modello, che non disegnano niente.
- [x] **Un comando dichiara il proprio raggio**:
  `CommandScope { writes, reach: CommandReach, reversible }`, con `reach`
  ordinato (`session` < `document` < `documents` < `vault` < `settings`) perché
  chi decide se chiedere conferma confronta.
- [x] **La simulazione è un modo di invocare**: `invoke(…, InvokeMode::DryRun)`
  → `CommandEffect::Plan(CommandPlan { summary, docs, edits })`, un
  `EditRequest` per documento
  ([decisione 0008](../decisions/0008-modifica-chirurgica.md)). E non è una
  cortesia di chi implementa: durante un dry-run l'host presta un `HostApi` in
  **sola lettura**, quindi un comando che ci prova riceve `PermissionDenied`. La
  stessa leva vale per `writes: false`.
- [x] **Il consenso non è il permesso** — ma non è nemmeno una capacità: è il
  giro *dry-run → piano → approvazione → apply*, e chi decide *quando* chiederlo
  è chi invoca, sul raggio dichiarato (vedi il verbale sotto).
- [ ] **Le impostazioni scrivibili da un programma sono un sottoinsieme
  dichiarato**: lo schema del §11.1 deve dire quali chiavi sono modificabili da
  un comando e quali no. La riga non negoziabile è che le impostazioni di
  privacy e dell'AI stessa non siano fra quelle: un componente che può
  allargarsi i permessi da sé non ha permessi. *(Il vocabolario c'è —
  `CommandReach::Settings` — lo schema no: non ci sono ancora impostazioni.)*
- [ ] **L'attribuzione va nel lotto, non nel log dell'app**: chi ha chiesto
  l'operazione (utente, comando, modello, prompt) è la
  [decisione 0012](../decisions/0012-origine-degli-eventi.md) (origine degli
  eventi) applicata alla [decisione 0011](../decisions/0011-il-lotto.md) (il
  lotto). L'audit trail di 22.4 è quel campo più il journal del §15.2; senza il
  campo, «cosa ha cambiato l'AI ieri» si può solo indovinare dai timestamp.
  *Metà fatta ([decisione 0011](../decisions/0011-il-lotto.md) +
  [decisione 0012](../decisions/0012-origine-degli-eventi.md)), e la spunta
  resta giù apposta.* Fatto: chi invoca lo dichiara
  (`invoke_command(…, by: Actor)`) e ogni evento che l'invocazione genera porta
  `Origin { actor, batch }` — con un lettore vero e provato, l'automazione che
  salta le proprie scritture (`fub-kernel/tests/batch_and_origin.rs`) e la shell
  che distingue un'altra applicazione da sé. Non fatto: **quale** comando, con
  quale modello e quale prompt. E ciò che manca lì non è un campo, è un
  **posto**: l'origine vive quanto il giro sincrono, e «cosa ha cambiato l'AI
  ieri» chiede che qualcuno l'abbia scritta da qualche parte — il journal del
  §15.2. Metterli in `Origin` adesso sarebbe stato aggiungere due campi scritti
  da chi invoca e riletti da nessuno, cioè l'errore che questa stessa voce
  nominava prima che la
  [decisione 0012](../decisions/0012-origine-degli-eventi.md) esistesse.

Nessuna di queste è "infrastruttura per l'AI": sono la differenza fra un
registro comandi leggibile e uno **eseguibile da terzi**, e i primi clienti sono
la CLI (27.1), l'API locale (27.2) e le automazioni (16.2) — l'LLM è l'ultimo ad
arrivare e il primo a rendere il buco visibile, perché è l'unico chiamante che
non si può correggere leggendo il codice.

*Sblocca:* 22.4 per intero, 27.1 (una CLI che scopre i comandi invece di
elencarli a mano), 27.2 (API locale), 16.2-16.3 (automazioni con anteprima e
undo), 7.2 (bulk fix con dry-run), 17.3 (rollback dell'import).

**Fatto insieme alla
[decisione 0009](../decisions/0009-registro-dei-comandi.md), con quattro
decisioni e due voci ancora aperte.**

*Uno schema di parametri a sé, non i nodi del §2.1.* Riusare i nodi di input
avrebbe tenuto una definizione sola di "campo tipato" nel contratto, ed è
l'argomento che sembra più forte finché non si guarda chi legge: una CLI, uno
script, un modello non disegnano niente e non hanno bisogno di sapere *come* si
chiede un valore — hanno bisogno di sapere *cosa* è. Legare la descrizione di un
comando all'evoluzione di `UiNode` avrebbe fatto dipendere il primo dal secondo
senza che il secondo servisse. Quando i nodi arriveranno saranno la **resa** di
un `ParamSpec`; il contrario no. Il prezzo dichiarato: il vocabolario è piccolo
(sei specie), e ciò che non esprime viaggia come testo con il comando che lo
interpreta — cioè fuori dalla convalida dell'host.

*Il modo sta nella firma, e rompe `invoke`.* Era la scelta che il M4 chiamava
"della famiglia di `RenderOptions`: da fare per prima o mai", e va fatta adesso
(linea di base ritagliata in `crates/fub-abi/wit/frozen/0.1.0.wit`). La ragione
non è l'eleganza: con il modo nella firma, il non-scrivere lo può garantire
l'**host**, prestando un `HostApi` in sola lettura. Un `CommandOutcome::Plan` da
solo avrebbe lasciato il dry-run alla buona volontà di chi implementa, cioè a
una convenzione che un comando di terzi non onora — e proprio nel momento in cui
il chiamante si fida di lui (l'anteprima prima di toccare 40 note). La stessa
leva rende `writes: false` vincolante invece che decorativo: chi si dichiara
innocuo riceve lo stesso host e fallisce se ci prova. È l'unica parte del raggio
che si può far rispettare: quante note un comando tocchi si sa solo eseguendolo,
e "reversibile" è una promessa sul mondo, non sul confine.

*Il consenso non è una capacità dell'`HostApi`.* Questa voce lo dava per
scontato («è una capacità dell'`HostApi`,
[decisione 0013](../decisions/0013-elenco-delle-capacita.md): la conferma»), e
questo giro dice di no, per due ragioni. La prima è che **questo host non può
fermarsi a chiedere**: il kernel è chiamato *dalla* shell e ne tiene il lock,
quindi una conferma sincrona dovrebbe risalire nella webview che sta aspettando
la risposta — e una capacità che ogni host dovrà onorare e nessuno onora è
peggio che assente. La seconda è che **un piano si legge e una domanda no**:
«approvi queste 40 note?» mostra ciò che il comando sceglie di dire, un
`CommandPlan` mostra i `DocId` e gli edit, e li mostra prima. Il consenso è
quindi il giro dry-run → piano → approvazione → apply; *quando* chiederlo lo
decide chi invoca dal raggio dichiarato (`needsPlan` nella palette: più di una
nota, o non reversibile). Una CLI in uno script può avere un'altra politica
sullo stesso dato — è per questo che il raggio sta nella spec e la politica no.
Ciò che resta scoperto, e va detto: nessuno **obbliga** un chiamante a simulare
prima. L'obbligo, se sarà, è una policy del §7.3 sopra questa firma, non un
pezzo di firma in più.

*L'insieme impattato lo completa l'host.* `CommandPlan.docs` è la verità che
l'utente approva, e un piano che tocca una nota senza nominarla sarebbe un
consenso strappato: l'host ci aggiunge i documenti degli `edits` invece di
fidarsi che chi ha scritto il piano se ne sia ricordato. E le `base` delle
richieste sono le revisioni di **adesso**: se un documento cambia fra il piano e
l'approvazione, applicarlo fallisce con `Conflict`
([decisione 0008](../decisions/0008-modifica-chirurgica.md)) invece di
sovrascrivere — l'anteprima non è un'ipotesi vaga, è una promessa verificabile.

*Resta fuori, dichiarato:* le **impostazioni scrivibili da un programma**
(§11.1: c'è il vocabolario, non lo schema); l'**attribuzione**
([decisione 0012](../decisions/0012-origine-degli-eventi.md) +
[decisione 0011](../decisions/0011-il-lotto.md): un campo `origin` scritto da
chi invoca e letto da nessuno non è un audit trail); il **limite massimo di note
per operazione** e la **conferma rafforzata** di 22.4, che sono politiche sopra
il raggio dichiarato, non firme; l'**esecuzione parziale** e l'**interruzione a
metà** (22.4), che chiedono il lotto
([decisione 0011](../decisions/0011-il-lotto.md)).
