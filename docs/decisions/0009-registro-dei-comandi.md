# 0009 — Comandi — il trait più importante che nessuno usa

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.1 (primo giro) |
| **Commit** | `8cae9b4` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **Registro comandi nel `Workspace`**: `register_command_provider(id,
      provider)`, `commands()` e `invoke_command(id, args, mode)` con la stessa
      disciplina delle view (`in_provider_call` alzato, dispatch differito,
      provider estratto per la durata della chiamata).
- [x] **Comandi sull'IPC**: `list_commands` / `invoke_command`, gemelli di
      `list_views` / `view_action`. Da qui in poi una feature nuova **non deve
      poter aggiungere un comando Tauri** (§16.6).
- [x] **`CommandOutcome` sufficiente**: `{ notify, effect }` con
      `CommandEffect { Done, Navigate, Reveal, RunSearch, Plan, Custom }`.
- [x] **Un cliente vero nello stesso giro**: `CoreCommands` (`search.open`,
      `selection.wikilink`, `vault.replace`) e la **palette** nella shell, che
      non cabla nessun id — legge le spec, chiede i parametri dichiarati, mostra
      il piano quando il raggio lo merita, e onora le scorciatoie che i comandi
      dichiarano.

*Sblocca:* 4.2 (slash commands, scorciatoie), 16.2 (macro, catene, trigger),
20.1 (comandi/hotkey plugin), 27.1 (CLI: la CLI è un client dello stesso
registro), 3.3 (quick actions, command palette).

**Fatto insieme alla [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md), con tre decisioni e un residuo dichiarato.**

*Niente `Trust` nel registro.* Le view lo hanno perché da esse passa **contenuto
attivo** (`Html`/`WebView`), e il varco di validazione esiste prima del primo
provider non fidato. Da un comando non passa un albero: l'unica stringa che
arriva all'utente (`notify`) è testo semplice, come lo snippet di una ricerca.
Ciò che a un comando serve è un *permesso* — «questo componente può scrivere nel
vault?» — che è il §7.3, un'altra domanda con un altro posto. Un campo `trust`
qui sarebbe stato registrato da tutti e letto da nessuno.

*La richiesta di input non è un esito, è una dichiarazione.* Questa voce la chiedeva
come variante di `CommandOutcome` («rinomina nota da palette non può chiedere il
nome nuovo»); con i `params` della [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md) la palette **chiede prima di invocare**, e
un chiamante non interattivo — che a una domanda a metà esecuzione non saprebbe
rispondere — compila e basta. Il prezzo dichiarato: un comando non può porre una
seconda domanda che dipende dalla prima; quel dialogo è del §2.1 (i form) e del
16.1 (i prompt dei template), non di questa firma.

*Le azioni migrate sono quelle che le capacità permettono.* «Apri la ricerca» è
diventata `search.open` (effetto per la shell, nessuna scrittura). Crea, rinomina
e cestina **non** erano migrate, e non per fretta: l'`HostApi` non aveva le
capacità strutturali, che la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) voleva decidere una per una a verbale. Un
comando ufficiale che le avesse ottenute per una via privilegiata avrebbe provato
che il registro funziona *per chi non è un plugin*, cioè l'unica cosa che non
c'era bisogno di provare. **La [decisione 0013](../decisions/0013-elenco-delle-capacita.md) le ha decise, e adesso sono migrate**:
`note.create`, `note.rename`, `note.trash`, `trash.restore`, `trash.empty` sono
comandi come gli altri, sei comandi Tauri sono spariti, e la regola del §16.6 vale
finalmente anche per le feature che toccano il vault.

*Resta fuori, dichiarato:* ~~i **comandi strutturali**~~ (fatti, [decisione 0013](../decisions/0013-elenco-delle-capacita.md)); i
**comandi della shell** (toggle dei pannelli, cambio modalità): il registro vive nel kernel e il
frontend non può registrarvisi — è il §18.2, e finché non c'è, quelle azioni
restano bottoni; la **tastiera configurabile** (§18.2: oggi la shell onora il
`keybinding` *dichiarato*, e ignora quelli senza modificatori perché ruberebbero
una lettera a chi scrive); **chi possiede un id** (§7.4: due provider che
dichiarano lo stesso comando sono risolti dall'ordine di registrazione, come per
le view).
