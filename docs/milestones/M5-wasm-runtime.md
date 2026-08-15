# M5 — Runtime WASM per plugin di terzi

Torna a [../PIANO.md](../PIANO.md) · segue [M4](M4-wit-hardening.md).

## Obiettivo

Consegnare il requisito distintivo del progetto: **plugin di terzi in sandbox,
veloci quasi quanto le feature native**, che implementano gli **stessi trait** del
contratto. Il kernel non deve distinguere un provider nativo da uno WASM.

## Stato (2026-08-15)

**Il primo passo è fatto: il confine si attraversa in esecuzione.** `crates/fub-wasm-host`
esiste, è nel workspace, e wasmtime ci sta dentro da solo — `fub-abi` e `fub-kernel`
non lo nominano. Un componente `wasm32-wasip2` si carica, dichiara il proprio
manifest, si monta dalla **stessa** porta `Bundle` del §9.3 che monta le feature
native, attiva, esegue un job che legge il vault e si smonta; il kernel non ha
guadagnato un solo ramo che sappia distinguerlo da un plugin nativo. La prova è
`crates/fub-wasm-host/tests/il_primo_componente.rs`, che è il gemello riga per
riga di `crates/fub-host/tests/il_primo_plugin.rs`: lo stesso ping, ricompilato a
componente da `esempi/ping-wasm`, che risponde la stessa cosa.

**Il secondo passo è fatto: un componente offre, e ha un tempo.** `CommandProvider`
attraversa — la palette, la tastiera, una macro e la CLI chiamano il comando di un
componente senza un ramo che lo distingua da una feature nativa —, `read-model`
risponde con l'albero del documento, `host-events` è linkata (un componente parla
anche mentre gli si parla), e chi non risponde entro il tempo concesso viene
fermato: epoch interruption a 100 ms di battito, cinquanta battiti di scadenza per
chiamata, 64 MiB di tetto alla memoria lineare. Le scelte, con la ragione di ogni
numero, stanno nella
[decisione 0165](../decisions/0165-un-comando-di-un-componente-e-un-comando.md).

**E il confine è stato misurato**: 440 ns in più per chiamata (7,25 → 7,69 µs su
Intel N150, release), che su un job visto dal pool sono il 2,2% del totale — la
coda costa già più del confine. Il banco è
`crates/fub-wasm-host/examples/il-costo-del-passaggio.rs` e si rifà con un
comando.

Ciò che i due passi **non** hanno fatto sta scritto voce per voce nei criteri di
accettazione qui sotto. In breve: dei trait esportati attraversano `Plugin` e
`CommandProvider` e non gli altri, e `UiNode::validate_untrusted` non è applicato
perché nessun albero di UI attraversa ancora. Sono assenze dichiarate, non
dimenticate — un componente che chiede una famiglia non servita viene **rifiutato
al caricamento con il nome della famiglia che manca**, invece di montarsi e
rompersi a metà lavoro.

## Design

### `fub-wasm-host` (crate creato)

Era commentato nel workspace (`Cargo.toml`) e assente da `crates/`. M5 lo ha
creato:
- **Runtime:** wasmtime con **component model**; carica componenti `wasm32-wasip2`
  compilati a parte. `cargo component` si è rivelato un passo di troppo:
  `wit-bindgen` più `cargo build --target wasm32-wasip2` producono già un
  componente, e una catena di strumenti in meno è una catena di strumenti in
  meno da pinnare.
- **Bindings:** generati dal `crates/fub-abi/wit/fub/*.wit` congelato a
  [M4](M4-wit-hardening.md) — dal file **vivo**, non dalla copia in
  `wit/frozen/0.1.1.wit`. La copia congelata è il presidio della baseline, il
  file vivo è la sorgente: un host generato dalla copia sarebbe un host che non
  si accorge di una rottura del vivo, cioè il presidio girato dalla parte
  sbagliata.
- **Invariante:** `fub-wasm-host` dipende da wasmtime; `fub-kernel`/`fub-abi`
  **no** (l'host vive al confine, il kernel resta agnostico — vedi
  [../PIANO.md](../PIANO.md)).

### Proxy dei trait (il "secondo backend")

Per ogni trait del contratto, un tipo proxy in `fub-wasm-host` che implementa il
trait Rust e **reinoltra** ogni chiamata al componente WASM attraverso i bindings:

- `MarkdownProvider` nativo : `FormatProvider` :: `WasmFormatProvider` : `FormatProvider`.
- Analoghi per `IndexProvider`, `ViewProvider`, `CommandProvider`, `EventHandler`.
- Il kernel riceve `Box<dyn Trait>` e li registra come qualsiasi provider nativo:
  **stessa firma, backend diverso** (il meccanismo "un trait, due backend" di
  [../architecture/traits.md](../architecture/traits.md)).

**Fatto: `Plugin`.** `WasmPlugin` implementa `Plugin` — `manifest`, `activate`,
`deactivate`, `run_job` — e reinoltra al componente; `WasmBundle` è la porta da
cui si monta. Il `Mutex` attorno all'istanza non è concorrenza: è la disciplina
di non-rientranza che il component model pretende, scritta dove si vede.
**Fatto: `CommandProvider`.** `WasmCommandProvider` è il secondo, e condivide
l'**unica** istanza del `WasmPlugin`: il plugin e i suoi provider sono lo stesso
componente, non due copie che si somigliano. Le `CommandSpec` si leggono una
volta sola, alla registrazione, perché il registro del kernel deve restare vero.
**Da fare: gli altri nove.** `FormatProvider`, `IndexProvider`, `ViewProvider`,
`EventHandler` e il resto delle interfacce esportate del contratto: `register`
registra ciò che sa registrare, e per il resto non dice niente a nessuno perché
il mezzo plugin è la forma normale.

### Host function per `HostApi`

I metodi di `HostApi` (`read_document`, `write_document`, `emit`, `storage_get/set`)
sono esposti al componente come **host function** wasmtime:
- serializzano gli argomenti (tipi WIT), eseguono nel core, ritornano;
- **applicano le capability** (booleani + `vault_scope`) nell'unico punto di
  enforcement, identico ai plugin nativi
  (vedi [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md)).

Con una precisazione che il codice ha imposto: le capability l'host WASM non le
applica affatto, **le riceve già applicate**. Le host function di
`fub-wasm-host` ricevono un `&mut dyn HostApi` già incappucciato dal
`Guard<H, P: Policy>` del kernel e si limitano a passargli la chiamata. È
l'«unico punto di enforcement» preso alla lettera: un secondo punto qui sarebbe
un secondo punto in cui sbagliare, e il primo giorno in cui i due divergessero
non se ne accorgerebbe nessuno.

**Fatto: tre famiglie**, `host-env` (orologio, locale, caso, fuoco),
`host-vault-read` (leggere il vault, `read-model` compreso) e `host-events`
(`emit`, `report_progress`, `spawn_job`), linkate **una interfaccia alla volta**
e non come *world*. Il prezzo è dichiarato ed è quello giusto: un componente che
importa una famiglia non linkata non si istanzia, e il rifiuto la **nomina** —
«manca `fub:abi/host-network`» manda a leggere, «manca una capacità» manda a
cercare. Le interfacce di soli tipi (`json`, `text`, `errors`, `model`,
`options`, `settings`, `ui`, `intl`) non contano: non hanno funzioni, non c'è
niente da linkare.
`host-events` è l'unica famiglia in cui la chiamata va dal guest all'host
**mentre** l'host sta chiamando il guest, e le tre strade della rientranza sono
state percorse una per una: `spawn_job` accoda e non esegue, `emit` non drena,
`report_progress` drena ma nessun `EventHandler` di quell'istanza sta nel
registro. La casella da riguardare è dichiarata, ed è il giorno in cui un
`EventHandler` attraverserà.
**Da fare: le altre** famiglie di scrittura del vault e dell'indice, quando
serviranno a un provider che attraversa.

**WASI non è linkato.** Il bersaglio `wasm32-wasip2` si porta dietro `wasi:cli`,
`wasi:io` e compagnia; un plugin di questo contratto non ha nessuna ragione di
chiamarli, e chi lo facesse lo stesso trova un trap invece di una porta aperta
sul sistema operativo. È la sandbox nella sua forma più corta: non c'è nessun
preopen da concedere, perché non c'è nessun WASI.

### Sandbox e capability

- Memoria isolata dal component model; nessun accesso diretto a filesystem/rete.
- Rete negata salvo `network = true`; FS solo via `HostApi` (soggetto a
  booleani + `vault_scope`).
- Storage per-plugin namespaced e persistente (`.fub/data/plugins/<id>/`).
- **Disponibilità:** i trait sono sincroni e brevi → **epoch interruption**
  wasmtime con deadline severa per chiamata e limiti di memoria/fuel; un plugin
  lento o ostile viene interrotto (`PluginError::Internal`), mai lasciato
  congelare il kernel. Il lavoro lungo legittimo passa dai **job**: `run_job`
  gira su un'**istanza separata** del componente (il kernel non è mai in
  attesa), con deadline propria più lasca e le stesse capability del plugin
  (`network` compreso) — vedi
  [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md),
  "Lavoro lungo: i job".
- **UI:** il proxy applica `UiNode::validate_untrusted()` (già nel contratto,
  con test) a ogni albero restituito da `render_view`: `Html`/`WebView` sono
  riservati al codice fidato finché non esistono asset story e CSP per i plugin
  (da progettare qui a M5) — vedi
  [../architecture/ui-protocol.md](../architecture/ui-protocol.md).

**Di questo elenco valgono l'isolamento di memoria, il varco unico,
l'interruzione a scadenza e il tetto di memoria.** Il component model dà il
primo, l'assenza di WASI più il `Guard` del kernel danno il secondo, e gli altri
due stanno in `src/limiti.rs`: un `Engine` per processo con `epoch_interruption`,
un thread di battito a 100 ms, cinquanta battiti di scadenza rinnovati **a ogni
chiamata** (armarla una volta sola darebbe un plugin montato all'avvio e già
morto cinque secondi dopo senza aver fatto nulla), e 64 MiB per memoria lineare
armati **prima** di `instantiate`, perché la funzione di avvio di un componente è
già codice ospite. Il fuel non c'è, e non ci sarà: la domanda è in secondi, non
in istruzioni. **Non vale ancora `UiNode::validate_untrusted`**, ed è il primo
debito da saldare il giorno in cui `view` sarà fra gli export risolti. Il lavoro
lungo legittimo non gira ancora su un'istanza separata: gira sull'unica, dietro
il suo `Mutex`. La rete non serve dirla negata: la
famiglia `host-network` non è linkata, quindi un componente che la importa non
si monta affatto.

### Plugin di esempio

Almeno un plugin di esempio reale in `wasm32-wasip2` (candidato: un
`CommandProvider` o un `ViewProvider` non banale), a dimostrare l'intero percorso:
build per `wasm32-wasip2` → discovery/attivazione → uso in-app. Idealmente **lo
stesso** provider del plugin nativo di M4, ricompilato a WASM, per confrontare i due
backend a parità di logica.

**Fatto, nella forma «idealmente».** L'esempio è `esempi/ping-wasm`: lo stesso
id, lo stesso permesso, lo stesso job e la stessa risposta del plugin nativo di
M4, e non dipende da `fub-abi` — ha in mano il WIT e basta, come un plugin di
terzi. Vive **fuori dal workspace** perché il suo bersaglio è un altro, e a
compilarlo è il test che lo usa: un test che si salta da solo quando l'artefatto
manca è un test che un giorno non gira più e nessuno se ne accorge. Se manca il
bersaglio, il fallimento dice come installarlo. La cartella `plugins/` non
nasce qui — quello è il percorso di discovery di un plugin installato, e non
c'è ancora chi lo percorra. Il ping adesso esercita anche `CommandProvider`: due
comandi, uno che legge il vault e risponde con un `reveal`, uno che torna un
esito ricco — piano, `TextEdit`, passo di undo, applicazione parziale. Accanto ce
ne sono altri tre, ognuno per una cosa sola: `ciclo-wasm` (il `loop {}` che la
scadenza deve fermare), `modello-wasm` (l'albero del documento camminato per
indici da un guest che non conosce `fub-abi`), `eventi-wasm` (chi parla mentre
gli si parla). **Resta da fare** l'esempio non banale nel senso pieno: una view,
o un `FormatProvider`, cioè un provider che il ping non è.

## Trait/API coinvolti

- Tutti i trait del contratto, ora anche in versione **proxy WASM**.
- `HostApi` come set di host function.
- Nuovo crate `fub-wasm-host`; il montaggio passa dal `BundleRegistry` di
  `fub-host` (la tabella di montaggio è `host/mount.rs`, decisione 0023).
  **La freccia va in un verso solo**, e non è un dettaglio: `fub-wasm-host`
  dipende da `fub-host`, mai il contrario, o wasmtime finirebbe nell'albero di
  chi monta le feature ufficiali. Chi vuole tutt'e due li prende tutt'e due, ed
  è `fub-app`.

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| **Component model** (non core WASM) | Tipi ricchi via WIT, isolamento di memoria, world import/export pulito. |
| Proxy per-trait | Realizza "un trait, due backend"; il kernel non cambia. |
| Enforcement capability **nelle host function** | Unico punto, identico ai plugin nativi; niente sandbox bypassabile. |
| Riusare il provider di M4 come esempio WASM | Confronto diretto nativo↔WASM a logica costante. |
| Un'**unica istanza** per il plugin e i suoi provider | Un plugin ha uno stato: due istanze sono due plugin che si somigliano, e la differenza si vedrebbe solo dai sintomi. |
| **Epoche** e non carburante, un `Engine` per processo | La domanda è «per quanti secondi l'app può restare senza risposta», non «quante istruzioni»: si misura in tempo. Un `Engine` per componente sarebbe un thread di battito per plugin. |
| **Tetto all'annidamento** nella traduzione del modello | Un file che qualcuno scrive apposta non deve poter esaurire lo stack del thread del job. Sta nella traduzione perché il modello può arrivare da qualunque `FormatProvider`. |

## Criteri di accettazione

- **Raggiunto per `Plugin` e `CommandProvider`, non per gli altri provider.** Un
  plugin `wasm32-wasip2` di esempio si carica, si attiva e funziona end-to-end —
  montaggio, `activate`, un job che legge il vault, **un comando invocato dal
  kernel come qualunque altro**, `deactivate`, smontaggio — e il kernel non ha
  guadagnato una riga che sappia dire quale backend ha in mano: il
  `BundleRegistry` chiama `manifest`, `trust`, `plugin` e `register` senza
  sapere che dietro c'è una macchina virtuale, e la palette chiama `invoke`
  senza saperlo nemmeno lei. «Uso in-app» adesso vuol dire un comando; vuol dire
  ancora *non* una view.
- **Raggiunto per i permessi, non per i crash.** Il cancello del §7.3 si chiude
  davanti a un componente esattamente come davanti a un nativo, ed è provato
  con **lo stesso** `.wasm` in due varianti che differiscono per una riga di
  manifest: senza `fub:read-vault`, la prima lettura riceve `PermissionDenied`
  col messaggio del kernel. Che il rifiuto arrivi come **valore** e non come
  trap è metà del punto — l'istanza è viva dopo, e il job torna con un errore
  che si legge invece che con un'istanza abbattuta. **Raggiunto anche per i
  crash e per il tempo:** un componente con un `loop {}` dentro viene fermato, il
  job torna con una frase che dice che il tempo è finito — non con la parola
  `interrupt` di wasmtime, che non direbbe niente a nessuno — e lo **stesso
  host** risponde ancora a un altro componente. Un trap, quando capita, diventa
  `PluginError::Internal` e non abbatte il core.
- **Raggiunto.** L'overhead del confine è misurato:
  `examples/il-costo-del-passaggio.rs` mette lo stesso id, lo stesso job e lo
  stesso vault sotto i due backend, e dice **440 ns in più per chiamata** (7,25 →
  7,69 µs di mediana su Intel N150, release), 12,4× sul montaggio e 177 ms una
  volta sola per caricare — che è la compilazione del componente. Visto dal pool
  il sovrapprezzo è il 2,2% del giro: la coda costa già più del confine. Le
  **feature ufficiali restano native** (zero serializzazione), e quella metà del
  criterio non è mai stata in discussione.

## Piano di test

- **Unit/integrazione host:** round-trip dei tipi WIT attraverso il confine per ogni
  trait; host function con e senza permesso. *Fatto per i tipi che `Plugin` e le
  due famiglie servite attraversano — manifest compreso, con settings, stringhe
  e timer tradotti — e per il permesso, nei due versi.*
- **E2e:** carica il plugin di esempio, invoca il suo comando/rende la sua view,
  verifica l'effetto nel vault; test negativi sui permessi. *Fatto per il
  comando* (`i_comandi_attraversano.rs`): le spec nel registro coi parametri, un
  comando che legge e risponde `notify` + `reveal`, l'esito ricco intero — piano,
  `TextEdit`, undo, applicazione parziale con un `Conflict` che nomina il
  documento —, un argomento obbligatorio mancante che si ferma su `BadArgs` senza
  arrivare al componente, e i comandi che spariscono con lo smontaggio. *Da fare
  per la view, che non esiste ancora di là dal confine.*
- **Isolamento:** un plugin che va in panic è contenuto; timeout/limiti di risorse
  (epoch interruption: un plugin con loop infinito viene interrotto entro la
  deadline); un `render_view` che restituisce `Html`/`WebView` viene rifiutato.
  *Fatto per il timeout* (`il_tempo_di_un_componente.rs`: il `loop {}` viene
  fermato, e l'host serve ancora un altro componente) *e per la ricorsione senza
  fondo* (`il_modello_attraversa.rs`: un documento oltre il tetto riceve un no
  che si legge, e l'istanza resta viva). *Da fare il rifiuto di
  `Html`/`WebView`.* Accanto c'è però una prova che l'elenco non prevedeva:
  **un componente che importa una famiglia non servita non si monta, e il
  rifiuto la nomina** (`una_famiglia_non_servita_si_fa_nominare`).
- **Parità:** stesso provider nativo (M4) vs WASM → stesso risultato osservabile.
  *Fatto sul `Plugin`:* `il_primo_componente.rs` e `il_primo_plugin.rs` sono lo
  stesso test a meno della riga che costruisce il bundle.
- `cargo test --workspace` + `cargo clippy`; il componente di esempio lo compila
  il test stesso, quindi la CI deve solo avere il bersaglio
  (`rustup target add wasm32-wasip2`) —
  vedi [../appendix/platforms-ci.md](../appendix/platforms-ci.md).

## Rischi / mitigazioni

- **Overhead di serializzazione** → accettato solo per i plugin di terzi; misurato e
  documentato; batch dove sensato. *Misurato: 440 ns per chiamata, il 2,2% di un
  giro visto dal pool. Il batch non serve — quel che costa è la coda.*
- **Superficie host insufficiente** → già esercitata dal plugin nativo di M4 prima
  del freeze.
- **Sicurezza della sandbox** (rete, FS, risorse) → default negato, enforcement in un
  solo punto, test negativi espliciti.
- **Tooling wasip2 in evoluzione** → pin delle versioni; build del plugin
  isolata dal workspace root — gli esempi stanno in `exclude`, ognuno ha la
  propria `--target-dir` (una per esempio, condivisa dalle sue varianti: misurato
  ~62s → ~19s, al prezzo di un lucchetto), e `cargo component` è uscito dalla
  catena prima di entrarci.
