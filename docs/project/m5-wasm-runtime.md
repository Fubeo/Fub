# M5: runtime WASM

> **Stato aggiornato per:** tree `audit-close` al merge
> `2cc2e44c3f6dc619218354f6cc89fff2c1517cf2`, tree
> `e8b9e0c0445ca9cf98ce503d4e07402097f9da62`, 17 settembre 2026.

## Gate di integrazione

Vale la [governance audit](status.md#governance-di-integrazione): il tree
corrente è una base di `fix/audit-integration`; nessun merge in `main` prima
di G15/GO. Le capacità descritte qui sono consegnate su questa base, ma non
sono una dichiarazione di completamento di `main`, G14 o G15.

## Obiettivo

Dimostrare che un componente WASM può usare gli stessi trait dei provider
nativi, con compatibilità, capability, limiti e lifecycle applicati
dall'host.

Il criterio è soddisfatto sulla base audit corrente: un autore può seguire un
percorso documentato, esercitato end-to-end e privo di rami speciali nel
kernel. La pagina resta una scheda di progetto finché la consegna non è
autorizzata e promossa in `main`.

## Architettura consegnata

```mermaid
flowchart LR
    COMPONENT["componente wasm32-wasip2"] --> RUNTIME["fub-wasm-host"]
    RUNTIME --> BUNDLE["WasmBundle"]
    BUNDLE --> MOUNT["mount comune di fub-host"]
    MOUNT --> TRAITS["trait fub-abi"]
    TRAITS --> KERNEL["registri del kernel"]
```

## Fatto

### Runtime

- Wasmtime component model;
- binding dal WIT vivo;
- assenza di WASI;
- limite di memoria;
- epoch interruption per la deadline;
- trap convertite in errore;
- istanza condivisa e non rientrante;
- teardown senza abbattere l'host.

### Contratto

- manifest e versione ABI;
- lifecycle `Plugin`;
- `CommandProvider`;
- `FormatProvider` opzionale via proxy WASM;
- `ViewProvider` opzionale via export WIT `view`;
- lettura del modello;
- eventi host;
- capability negate come errori tipizzati;
- arena per forme ricorsive;
- parità osservabile nei casi nativo/WASM coperti.

### Esempi

- `esempi/ping-wasm/`;
- `esempi/modello-wasm/`;
- `esempi/eventi-wasm/`;
- `esempi/ciclo-wasm/`;
- `esempi/format-wasm/`, percorso fuori workspace per il provider di formato;
- `esempi/view-wasm/`, percorso end-to-end per `ViewProvider`.

Il percorso `format-wasm` viene costruito dai test e dimostra le operazioni
supportate e i fallimenti tipizzati del confine.

Gli esempi vengono costruiti dai sorgenti durante i test.

### Confine host dei formati

`FormatSource` è una porta host-agnostica: prepara `FormatProvider` e le
risorse possedute prima di costruire il `Workspace`. L'host registra i provider
prima della costruzione del workspace; le risorse preparate restano vive per
tutta la sessione e vengono rilasciate anche in caso di rollback.

`fub-wasm-host` espone ora un'interfaccia `format` opzionale: `WasmBundle`
prepara descriptor e capability dichiarati e restituisce un proxy
`FormatProvider` per `parse`, `render_html` e `serialize`. Il modello in ingresso
e quello restituito dal guest attraversano la validazione del confine fidato;
output malformato e trap diventano `FormatError`, senza propagarsi come stato
parziale o abbattere l'host. La validazione è `O(V+E)`, accetta DAG ordinari e
rifiuta cicli, riferimenti fuori indice, profondità oltre 64, span non validi,
JSON non valido e materializzazione oltre 8 Mi unità pesate.

`InstalledPluginManager` prepara una sola volta lo snapshot per apertura dei
plugin `enabled` con consenso `granted`, caricando ogni bundle selezionato una
sola volta e restituendo bundle e `PreparedFormatSource` sotto la stessa
`StartupValidity`/lease. È cablato come `StartupSource`, non come
`FormatSource`. Un componente selezionato corrotto o non caricabile, oppure
un'export `format` presente ma incompatibile, produce una diagnostica tipizzata
e viene saltato per quella apertura senza impedire l'apertura del vault. Un
bundle caricato resta utilizzabile per le altre interfacce se la preparazione
del provider di formato fallisce, con la diagnostica corrispondente.
Un'invalidazione concorrente revoca il token: l'apertura stantia fa rollback e
non pubblica alcuna sessione. Lease e risorse preparate appartengono alla
sessione o al rollback; nessuna `Operation` del manager viene trattenuta dalla
sessione.

Il percorso esercitato copre un componente fuori workspace con parse, render,
errore dichiarato dal guest, modello malformato, trap e serialize. I test
coprono anche rollback di snapshot stantio e chiusura con drain delle aperture;
questo non implica ancora parità oltre a questi casi, né rende disponibili
implicitamente capability host al componente.

### Decisioni sui provider

`FormatProvider` è implementato e ha parità nativo/WASM per le operazioni
coperte `parse`, `render_html` e `serialize`. Errori dichiarati dal guest,
modelli malformati e trap sono coperti end-to-end nel percorso WASM e vengono
recuperati come `FormatError`, ma non costituiscono un confronto di parità
oltre ai casi esercitati.

`ViewProvider` è consegnato con export WIT `view`, spec/interests/render,
azioni `Replace`/`Patch`, validazione non fidata e teardown. `GridProvider` è
consegnato con protocollo Grid v1 in ABI/WIT, provider nativo e proxy WASM:
negozia famiglia/versione, finestre, patch, invalidazioni, fallback e
ownership senza chiamate al provider sotto il lock.

`IndexProvider` e `EventHandler` inbound restano deferred: non vengono
promessi senza una route e un componente che provino feed/query/flush/close o
la reazione a `Notice`. `host-events` outbound resta invece supportato.

## Consegnato nel percorso ViewProvider

L'interfaccia WIT `view` è un'export opzionale sulla stessa `Instance` del
`Plugin`. Le `ViewSpec` dichiarano parametri che l'host valida; `interests` è
infallibile: un trap fa paniare il proxy e il confine `Workspace` converte il
panic in `PluginError::Internal`. `render_view` usa `ReadApi` e `on_action`
usa `HostApi`.

Il guard di fiducia protegge sia render sia action: per `Trust::Community`,
`Html` e `WebView` sono rifiutati prima della shell; `Trust::Core` è ammesso. Il
preflight dell'albero verifica root e riferimenti, assenza di cicli (DAG),
profondità massima 64 e budget di 8 Mi unità pesate. La stessa istanza non è
rientrante: la rientranza è un errore tipizzato.

Un trap invalida il guest ma lascia vivo l'host; il teardown può riportare
l'errore. La parità verificata è limitata a spec/interests/render/`Replace`/
`Patch`. `IndexProvider` e `EventHandler` inbound restano deferred. L'esempio
minimo è `esempi/view-wasm/`, con test di mount, parametri, render, `Replace`,
`Patch` e smontaggio.

### UI non fidata

La validazione attiva è completata per provider `Trust::Community`:
`UiNode::validate_untrusted()` viene applicato prima della shell e vale anche
per gli aggiornamenti restituiti da una action. `Trust::Core` può produrre `Html`
e `WebView` secondo la policy.

### Discovery e installazione

Nel tree corrente il percorso prodotto è supportato dalla shell e dal manager
installato:

1. `install_plugin` legge un file scelto esplicitamente, valida manifest e ABI
   e pubblica blob e inventario senza montare o chiamare il guest;
2. il record parte con `consent = undecided` e `enabled = false`;
3. `set_installed_plugin_consent` registra `denied` o `granted` per gli esatti
   byte installati, senza concedere capability;
4. `set_installed_plugin_enabled` registra la selezione e riconcilia il
   runtime, ma il mount avviene soltanto per `enabled && granted`;
5. il riavvio rilegge lo snapshot persistente e filtra prima di load,
   validazione attiva e istanziazione;
6. la disabilitazione esegue teardown e ritira il claim in tutti i vault
   interessati;
7. `remove_installed_plugin` richiede lo stato disabilitato, ritira il record
   e pulisce il blob senza toccare `.fub/plugins/<id>/`.

`list_installed_plugins` legge solo metadata e stato runtime: non compila,
istanza o chiama il guest. Duplicati di id, digest alterati, file
incompleti, ABI incompatibile e collisioni CAS producono errori espliciti;
non esiste upgrade implicito. Una reinstallazione ha nuova identità e nuovo
consenso. Un componente selezionato corrotto o non caricabile viene
diagnosticato e saltato per quell'apertura senza impedire il vault.

La [PR #49](https://github.com/Fubeo/Fub/pull/49) registra la consegna della
fase 10 sul medesimo tree audit. #8 e #10 restano **OPEN** come tracker per la
chiusura formale e la matrice audit, non perché manchi questo percorso nella
base corrente.

## Stato di consegna e limiti

Sul tree `2cc2e44c` M5 ha il percorso installato e i provider esercitati:
`CommandProvider`, `FormatProvider`, `ViewProvider` e `GridProvider`, con
capability, timeout, memoria, trap, output malformato, UI non fidata, rollback
e teardown coperti nei casi dichiarati. La fase 10 Grid è presente in
ABI/WIT, nel provider nativo, nel proxy WASM e nel client shell.

Questa pagina resta una scheda di progetto perché la base non è `main` e
G14/G15 non sono conclusi. #8 e #10 restano aperte nei tracker; non vanno
interpretate come capacità assenti. I limiti non promessi sono
`IndexProvider` e `EventHandler` inbound, oltre a operazioni provider non
esercitate dagli esempi.

Il tutorial per riprodurre il ciclo reale è
[`../development/plugin-authoring.md`](../development/plugin-authoring.md).
Un componente incompatibile viene rifiutato prima del mount; un permesso o
consenso negato non lascia stato parziale; il filtro startup conserva
separati installazione, consenso, enabled, capability e istanza montata.

## Rischi

| Rischio | Presidio |
|---|---|
| espansione del WIT senza consumatori | provider aggiunto con esempio reale |
| policy duplicata | un solo `Guard` |
| UI attiva non fidata | validazione prima dell'IPC |
| chiamata infinita | deadline a epoche |
| memoria senza limite | store limiter |
| mount parziale | transazione e teardown |
| differenza nativo/WASM | test di parità |
| tutorial non riproducibile | stesso artefatto e stessa sequenza dell'e2e |

## Issue

- [#8 — percorso end-to-end](https://github.com/Fubeo/Fub/issues/8)
- [#10 — provider e UI non fidata](https://github.com/Fubeo/Fub/issues/10)

## Passaggio successivo

La consegna corrente resta nelle guide e negli ADR; questa scheda si mantiene
per tracciare il passaggio audit e l'eventuale chiusura formale di #8/#10.
Dopo G14 e G15/GO:

- aggiornare changelog e stato della release;
- conservare nelle guide le capability e i limiti correnti;
- spostare il lavoro successivo in nuove issue;
- rimuovere questa scheda solo quando la policy del progetto la considera
  superata sulla linea di rilascio.
