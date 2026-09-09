# Creare un plugin

> **Per chi:** autori di provider nativi o componenti WASM.
> **Risultato:** un bundle montabile, con manifest, permessi, test e teardown.

M5 è ancora in corso. Il percorso WASM disponibile è adatto allo sviluppo e ai
test; l'installazione e il consenso nel client desktop non sono completi.

## Scegliere il backend

| Backend | Quando usarlo |
|---|---|
| feature ufficiale | codice distribuito con Fub e selezionabile in build |
| provider nativo | integrazione fidata nello stesso processo |
| componente WASM | estensione di terzi isolata e compatibile via WIT |

La logica di dominio dovrebbe dipendere dal contratto, non dall'adattatore.

## Manifest

Un plugin dichiara almeno:

- id namespaced;
- nome e versione;
- versione ABI;
- permessi richiesti;
- impostazioni;
- lifecycle;
- registrazioni offerte.

Gli id pubblici devono essere stabili. Cambiare id equivale a rimuovere una
registrazione e crearne un'altra.

## Provider nativo

1. implementa il trait in un crate proprietario;
2. costruisci il manifest;
3. implementa `Plugin` o il bundle richiesto;
4. registra provider e disposer;
5. monta attraverso `fub-host`;
6. prova prima con `MemoryHost`;
7. aggiungi un'integrazione host/kernel.

Non chiamare API Tauri e non importare dettagli privati della shell.

## Componente WASM

Gli esempi correnti sono:

- `esempi/ping-wasm/`;
- `esempi/lifecycle-wasm/`;
- `esempi/modello-wasm/`;
- `esempi/eventi-wasm/`;
- `esempi/ciclo-wasm/`.

Il target è `wasm32-wasip2`. Dalla radice della repository:

```bash
rustup target add wasm32-wasip2
cargo build \
  --manifest-path esempi/lifecycle-wasm/Cargo.toml \
  --target wasm32-wasip2 --release \
  --target-dir target/lifecycle-author
```

Gli esempi vivono fuori dal workspace principale perché richiedono un target
diverso e vengono costruiti dai test che li usano.

## Installazione nel banco nativo

Usa un vault di prova e una directory di componenti separata, entrambi sotto
il tuo controllo. Non usare documenti reali per provare un plugin sconosciuto.
La directory passata a `discover` non è scelta dal manifest e non viene
scandita automaticamente dal desktop. `.fub/plugins/` conserva dati privati:
non è una directory di componenti eseguibili.

Questi comandi per shell POSIX preparano una nuova prova:

```bash
mkdir -p target/lifecycle-demo/vault target/lifecycle-demo/plugins
printf '# Nota di prova\n' > target/lifecycle-demo/vault/Nota.md
cp target/lifecycle-author/wasm32-wasip2/release/lifecycle_wasm.wasm \
  target/lifecycle-demo/plugins/plugin.wasm.part
mv target/lifecycle-demo/plugins/plugin.wasm.part \
  target/lifecycle-demo/plugins/plugin.wasm
cargo run -p fub-wasm-host --example installed-plugin -- \
  target/lifecycle-demo/vault target/lifecycle-demo/plugins \
  demo.lifecycle demo.lifecycle:conta
```

Il [banco nativo](../../crates/fub-wasm-host/examples/installed-plugin.rs)
legge i manifest in sandbox, rifiuta file guasti e id duplicati e attiva solo
l'id richiesto esplicitamente. Il mount comune verifica ABI e dichiarazione;
il `Guard` del kernel applica i permessi alle chiamate host. Il comando legge
`Nota.md` e restituisce conteggio e posizione. Il banco smonta il componente e
chiude l'host anche quando l'invocazione fallisce.

Ripeti il comando `cargo run`: il contatore di attivazione deve essere ancora
`1`, perché la nuova sessione non riusa la memoria della precedente. Per
rimuovere il componente, termina il banco e cancella soltanto
`target/lifecycle-demo/plugins/plugin.wasm`. Una successiva esecuzione deve
dire che il plugin non è stato trovato. Non cancellare i dati persistenti del
plugin come effetto collaterale della rimozione dell'eseguibile.

### Integrare la discovery in un host

`fub_wasm_host::discover(directory)` restituisce candidati ordinati per percorso,
ciascuno con `Result<WasmBundle, LoadError>`. Considera soltanto file regolari
`.wasm` direttamente nella directory: niente ricorsione, link simbolici o
file `.part`. Una directory assente è vuota; altri errori di lettura restano
errori. Un file guasto non nasconde i candidati validi.

La discovery non monta e non concede fiducia: usa sempre `Trust::Community`.
Prima di `BundleRegistry::remember`, l'host deve rifiutare duplicati e collisioni
con gli id già conosciuti. `enable` attiva, `unmount` disattiva senza dimenticare
il bundle. Alla chiusura della sessione l'host rilascia i plugin; alla nuova
apertura il chiamante ricostruisce l'inventario dai file ancora installati.
Il percorso del banco non persiste una scelta di abilitazione per il desktop.

La directory deve restare sotto il controllo del chiamante: la scansione non
protegge da sostituzioni concorrenti dei file. Installer, aggiornamenti e
consenso ai permessi per l'utente finale restano lavoro di
[#8](https://github.com/Fubeo/Fub/issues/8).

## WIT

La sorgente viva è:

```text
crates/fub-abi/wit/fub/abi.wit
```

Le copie in `wit/frozen/` sono baseline di compatibilità, non input per il nuovo
host.

Gli alberi ricorsivi attraversano il confine come arena. Non definire una
seconda conversione nel plugin: usa i binding e rispetta indici, limiti e
ordine.

## Host function

Un componente importa soltanto le famiglie necessarie. L'assenza di una
famiglia è un errore di mount leggibile.

Le host function:

- ricevono tipi WIT;
- traducono verso il contratto Rust;
- chiamano un `HostApi` già protetto;
- ritornano un valore o un errore tipizzato.

Non esistono accessi diretti a filesystem, rete o webview.

## Permessi

Richiedi il minimo.

Un test deve coprire almeno:

- permesso concesso;
- permesso negato;
- scope del vault;
- nessun mount parziale dopo il rifiuto.

La policy completa è in
[`../reference/permissions-and-security.md`](../reference/permissions-and-security.md).

## Lavoro breve e lavoro lungo

Una chiamata di trait è breve e ha una deadline. Un'operazione lunga diventa un
job con progresso e cancellazione.

Non aggirare la deadline suddividendo un lavoro infinito in chiamate che
mantengono stato non verificabile.

## UI

Un provider restituisce `UiNode`; non restituisce DOM o JavaScript.

Un componente WASM non può inviare:

- estensioni CodeMirror;
- closure;
- listener;
- HTML fidato;
- webview.

`ViewProvider` WASM e validazione non fidata sono ancora lavoro aperto in
[#10](https://github.com/Fubeo/Fub/issues/10).

## Test del percorso completo

```bash
cargo test -p fub-wasm-host --test installed_plugin_lifecycle
```

Il [test di integrazione](../../crates/fub-wasm-host/tests/installed_plugin_lifecycle.rs)
compila il componente dai sorgenti e lo copia in una directory temporanea.
Esercita discovery, mount, comando e capability host, spegnimento e riaccensione,
chiusura con plugin attivo, riapertura e rimozione senza modificare la nota.
Non cerca un artefatto precostruito e non salta la prova se manca il target.

Le feature del componente coprono i rifiuti:

| Feature | Esito atteso |
|---|---|
| `abi-incompatibile` | `BundleError::Abi` prima dell'attivazione |
| `senza-permessi` | `PluginError::PermissionDenied` in attivazione e rollback |
| `trap-deactivate` | errore del guest, ma dichiarazione e comandi rimossi |

Le prove di regressione controllano che il bundle noto non trattenga
l'istanza dopo un'attivazione fallita o dopo il rilascio del plugin.
Aggiungi anche timeout, trap e output malformato alle prove dei tuoi provider.

## Pubblicazione

La directory esplicita è un percorso di sviluppo, non un formato stabile di
pacchetto né un installer per l'utente finale. Il completamento del percorso
di prodotto resta in [#8](https://github.com/Fubeo/Fub/issues/8).
