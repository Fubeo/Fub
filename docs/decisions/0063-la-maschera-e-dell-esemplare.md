# 0063 — La maschera è dell'esemplare, e la risposta stava già nell'elenco

|  |  |
|---|---|
| **Decisa** | 2026-08-01 |
| **Origine** | `todo.md` §22.3 ([seduta 22](../roadmap/22-cosa-sa-dire-un-abbonamento.md)) — chiude la voce, **meno una casella**: la query incorporata in una nota, che non è un esemplare di `ViewSpec` e non si risolve in questo contratto |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/22-cosa-sa-dire-un-abbonamento.md) ·
[cosa è una view, 0016](0016-cosa-e-una-view.md) ·
[la grana di un abbonamento, 0033](0033-la-grana-di-un-abbonamento.md) ·
[la dieta dell'IPC, 0057](0057-la-dieta-dell-ipc.md)

---

La [0016](0016-cosa-e-una-view.md) ha reso le view **istanziabili**:
`render_view` e `on_action` ricevono un
`ViewInstance { view, instance, params }`, e i parametri arrivano già
convalidati contro `ViewSpec.params`. La dichiarazione di interesse è rimasta
dov'era: due campi sulla spec, decisi prima che un esemplare esistesse. Una view
aperta con parametri aveva quindi una dipendenza che **nasce dai parametri** e
una maschera che quei parametri non li ha mai visti — o si abbona larga, e
allora ogni widget aperto si ridisegna a ogni scrittura del vault (il conto che
la [0033](0033-la-grana-di-un-abbonamento.md) esisteva per togliere), o non si
abbona e non è viva.

**La maschera è dell'esemplare.** `ViewProvider` guadagna
`interests(&ViewInstance) -> ViewInterests { refresh, follows }`, e il record
entra nel WIT accanto a `view-spec`. Le due metà stanno **insieme** in un record
solo perché sono la stessa dichiarazione vista su due canali — gli eventi del
vault e il contesto di sessione — e separarle darebbe due posti dove la stessa
view può dire due cose diverse su quando invecchia.

## Il verso preso, e perché non è quello che scadeva

La voce diceva che la §22.3 ha **un** modo di diventare P0: se si decidesse che
la maschera è *solo* dell'esemplare, `view-spec.refresh` sarebbe nel posto
sbagliato e spostarla sarebbe una migrazione. Quel verso **non** è stato preso,
e non per prudenza: la spec resta il posto giusto per la dichiarazione che non
dipende da un esemplare, ed è il default di chi non distingue. Passata alla
tabella di [`wit-congelato.md`](../architecture/wit-congelato.md), questa
decisione è due aggiunte in coda — un record nuovo, una funzione nuova su
un'interfaccia che c'è già. **Niente di pubblicato si sposta, e la linea di base
non si ritaglia.**

## Dove la maschera si risolve, e perché non è a ogni lettura

Il primo tentativo aveva risolto le maschere dentro `Workspace::views()`, cioè a
ogni interrogazione. È rosso, e a dirlo è stato un presidio che esisteva già:
*le spec si chiedono una volta sola, alla registrazione*. Non è una questione di
allocazioni — è chi possiede la verità su cosa un provider offre. La risposta è
il **registro**, dal momento in cui il provider gliel'ha detta; un provider che
cambia idea lo dichiara passando da `refresh_specs`, invece di farlo scoprire a
chi interroga.

Quindi le maschere si risolvono **dove le spec si chiedono**: `specs_dichiarate`
interroga `views()` e, per ogni spec, `interests` sull'esemplare unico
(`ViewInstance::only`), e scrive il risultato nei due campi. Per quell'esemplare
le due cose coincidono per costruzione, e da lì in poi tutto il kernel legge un
dato di registrazione come prima. La stessa riga vale per `set_active_context`,
che non ha bisogno di una seconda strada per la stessa domanda: due strade sono
due posti dove la regola può divergere.

## Il ponte che non è stato aggiunto

Il primo tentativo aveva aggiunto anche un comando Tauri `view_interests`, e la
[0057](0057-la-dieta-dell-ipc.md) l'ha fermato: i ponti sono **sei**, uno per
metà di canale, e un settimo è un canale nuovo — una decisione da mettere a
verbale, non una riga in più nell'allowlist.

Guardando cosa quel ponte comprava, la risposta è **niente**: la shell lo
chiamava con `viewInterests(spec.id, spec.id, null)`, che è esattamente
l'esemplare unico, cioè la domanda a cui `list_views` risponde già. Era un giro
di IPC per riavere un dato che era appena arrivato — e in più asincrono, quindi
con una finestra in cui il pannello filtrava con la maschera vecchia. **I ponti
restano sei**, e il §16.6 non guadagna un sesto bespoke.

Chi apre un esemplare **con parametri** non passa dall'elenco delle specie,
perché un elenco di specie non ha dove mettere la risposta di un esemplare che
non esiste ancora: per lui c'è `Workspace::view_interests`, che oggi non ha
clienti nella shell perché la shell non apre ancora istanze multiple — quelle
arrivano con `CommandEffect::OpenView` e col modello di layout, che è la casella
aperta della §11.2. È il verso in cui questa voce continua, e non costa una
decisione: la funzione c'è, il contratto la porta, e chi aprirà la prima istanza
parametrica la troverà già lì.

## Cosa resta aperto

La voce aveva **due** clienti, e questo verbale ne serve uno solo. Una query
**incorporata in una nota** (FEATURES 9.2, «query embed») non è un esemplare di
`ViewSpec`: è un blocco reso dal renderer, dentro il documento aperto. Per
quella un canale di invalidazione non esiste affatto, e la domanda «chi la
ridisegna quando cambia ciò che interroga» non ha ancora una riga da nessuna
parte. La seduta diceva che le due metà «vanno decise insieme o le due si
sceglieranno due meccanismi»: la prima metà, decisa, **è** il meccanismo — una
dichiarazione di interesse per esemplare, valutata da chi possiede l'evento — e
la casella che resta è portarcelo dentro, non sceglierne un altro.

Restano aperte anche le altre due voci della seduta, e questo verbale non le
tocca: un abbonamento continua a non saper dire **quando** (§22.1) e un evento
continua a dire *quale documento* ma non *cosa è cambiato* (§22.2). Erano state
tentate insieme a questa, e sono state ritirate prima di arrivare qui: una
dichiarazione che il kernel non valuta è peggio della sua assenza, perché mente
al plugin che ci ha creduto. `EventMask` aveva guadagnato due campi che
`mask_wants` non guardava, `DocumentChanged` un campo che nessuno riempiva e il
contratto un evento che nessuno emetteva. Il costo di quel ritiro è zero —
nessuno ci si era ancora abbonato — e il suo prezzo era la sola cosa che valeva:
che la seduta 22 non chiudesse tre voci avendone fatta una.
