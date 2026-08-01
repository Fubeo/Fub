# Cosa Fub scrive sul disco

La mappa di **chi scrive dove**: con quale classe, con quale versione di schema e
con quale disciplina di scrittura. È la metà documentale del
[§15.4](../roadmap/15-il-disco.md), e il suo perché è la
[decisione 0048](../decisions/0048-una-radice-sola.md).

[← architecture/](README.md) · [il colpo d'occhio](mappa-visuale.md) · [i tre numeri di versione](../versionamento.md)

---

## Chi ci arriva

Sotto la linea del vault i byte passano tutti da un supporto solo, il
`VaultStorage` della [0064](../decisions/0064-il-supporto-sta-sotto.md)
(`kernel/storage.rs`): il vault, il cestino coi suoi sidecar e lo spazio dati dei
plugin. Le tre righe di `.fub/` che ancora scrivono con `std::fs` —
`workspace.json`, `settings.json` ed `entries.json` — lo fanno passando da
`write_atomic`, e ci resteranno finché il §15.2 non avrà detto che forma ha
l'atomicità dentro il trait: sono la casella residua di quella decisione. Fuori
dal vault il supporto non c'entra — quei file non sono di un vault, sono di
questa macchina.

## La regola

**Dentro un vault, ciò che Fub scrive sta in una radice sola: `.fub/`.** La
profondità dice la classe:

| Dove | Classe | Cosa vuol dire |
|---|---|---|
| `<vault>/.fub/` | **autorevole** | perso, non si ricostruisce da niente. Chi non riesce a leggerlo **non lo sovrascrive** |
| `<vault>/.fub/data/` | **derivato** | si butta e si rifà dal vault. Chi non riesce a leggerlo lo rifà, e non avvisa nessuno |

Fuori dalla radice resta `<vault>/.trash/`, che non è roba di Fub: è il
cestino **condiviso con Obsidian** (`kernel/vault.rs`, `TRASH_DIR`), e dentro ci
sono file dell'utente in attesa, non metadati nostri.

La classe **non è dicibile nel contratto**: `data_write` non la chiede, e il path
è oggi l'unico posto in cui è scritta. La forma con cui diventerà esplicita è
scelta — una seconda famiglia di capacità per il derivato — e non è ancora
implementata: il residuo del §15.4 è quello. Finché non c'è, questa tabella è la
definizione operativa, e le tre righe che la contraddicono stanno qui sotto
chiamate per nome.

## Dentro il vault

| Posto | Chi lo scrive | Classe | Schema | Scrittura |
|---|---|---|---|---|
| `.fub/workspace.json` | `kernel/organization.rs` | autorevole | 1 | atomica, e **non riscrive** un file che non ha potuto leggere |
| `.fub/settings.json` | `kernel/settings.rs` | autorevole | 1 | atomica; le chiavi di scope `machine` scritte qui **si ignorano** |
| `.fub/data/entries.json` | `kernel/entries.rs` | derivato | 2 | atomica |
| `.fub/data/trash/<nome>.json` | `kernel/vault.rs` | **né l'una né l'altra** (sotto) | — | `VaultStorage::write`, best-effort |
| `.fub/data/plugins/<id>/…` | chiunque abbia `DataWrite` | dichiarata derivata, **in pratica entrambe** (sotto) | per plugin | `VaultStorage::write` (`host/kernel.rs`), **non** atomica |
| `.fub/data/plugins/fub.search/` | `features/search.rs` | derivato | 5 | l'indice tantivy, più un `manifest.json` |
| `.fub/data/plugins/fub.versioning/` | `features/versioning.rs` | **autorevole** (sotto) | 1 | `versions.json` derivato dallo store, gli snapshot no |
| `.fub/data/plugins/<id>/doc/<documento>/…` | chiunque, per regola | quella del plugin | del plugin | lo stato per-documento della [0044](../decisions/0044-lo-stato-per-documento.md): il posto è dichiarato in `abi/rules/doc_data.rs`, e il kernel lo migra al rename |
| `.trash/` | `kernel/vault.rs` | **contenuto dell'utente** | — | un rename, condiviso con Obsidian |

## Fuori dal vault

La cartella di configurazione della macchina (`host/config.rs`: `config_dir`,
`FUB_CONFIG_DIR`, o il modo portable accanto all'eseguibile). Ci sta ciò che
**non deve viaggiare col vault**: vale per questa installazione, non per queste
note.

| Posto | Chi lo scrive | Classe | Schema | Scrittura |
|---|---|---|---|---|
| `settings.json` | `kernel/settings.rs` | autorevole | 1 | atomica |
| `vaults.json` | `host/vaults.rs` | autorevole | 1 | atomica — il registro dei vault conosciuti ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)) |
| `view-state.json` | `kernel/viewstate.rs` | autorevole | 1 | atomica — dove si era rimasti, per esemplare di vista ([0037](../decisions/0037-lo-stato-di-vista.md)) |

## Le tre righe che contraddicono la regola

Sono scritte qui perché una mappa che nasconde le proprie eccezioni è peggio di
nessuna mappa: sono anche l'elenco esatto di ciò che la seconda metà del §15.4
deve sistemare.

1. **Gli snapshot del versioning stanno sotto la radice del derivato e non lo
   sono.** Da cosa si rigenererebbe «com'era questo file martedì»? Ci stanno
   perché lo spazio dati di un plugin è uno solo e vive lì. Quando la famiglia
   `cache_*` arriverà, `data_*` resterà l'autorevole e il suo spazio salirà di un
   livello: la ricerca, che è derivata davvero, scenderà in `cache_*` e al peggio
   si ricostruisce.
2. **Il sidecar del cestino non è di nessuna delle due classi.** Perderlo non
   costa una ricostruzione e non perde una nota: costa che il ripristino di
   `progetti/Nota.md` la rimetta in radice invece che in `progetti/`. È il
   **degrado garbato** già scritto (`kernel/vault.rs`), che è anche il
   comportamento delle voci cestinate da Obsidian, che un sidecar non ce l'hanno
   mai avuto.
3. **Ciò che passa da `data_write` non è scritto atomicamente**. Vale anche per
   gli snapshot, che sono autorevoli: un crash a metà scrittura lascia un file
   troncato. È il
   [§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery), non questa voce,
   ma va saputo leggendo la colonna «autorevole» di una riga che scrive con
   `data_write`. Dalla [0064](../decisions/0064-il-supporto-sta-sotto.md) il
   posto da cui ripararlo è **uno solo** — `VaultStorage::write` in
   `kernel/storage.rs` — e prima erano cinque: è la ragione per cui il §15.1
   viene prima del §15.2 e non dopo.

## Il nome di prima

Fino alla [0048](../decisions/0048-una-radice-sola.md) le radici dentro il vault
erano **due**: una per l'autorevole e una, separata, per il derivato. Dalla 0048
è **una**, ed è quella descritta qui sopra.

Non c'è niente da tradurre, e non è sempre stato vero: fino al rename del
progetto il kernel portava avanti da sé un vault scritto prima, con un rename
all'apertura, e questa sezione era la tabella che diceva quale nome diventava
quale. Quel codice non c'è più — è stato tolto insieme al nome, perché un vault
con la vecchia forma non è mai esistito fuori da questa macchina e tenersi una
migrazione per zero vault significa tenersi per sempre un nome che non si può
più leggere da nessuna parte.

Ne segue la regola per il prossimo cambio di layout, che è l'unica cosa di
questa sezione che vale per il futuro: **finché il progetto non è pubblicato una
migrazione di layout è facoltativa, e dopo non lo è più.** La differenza non è
di disciplina, è di chi paga: prima del rilascio a spostare le cartelle è chi ha
scritto il codice, dopo è qualcuno che non sa che esistono.

## Cosa non c'è ancora

Le righe che questa tabella dovrà accogliere, con la voce che le porta: temi e
snippet (§6.2), plugin installati da file (§20.2), il journal delle mutazioni e
il buffer di crash ([§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery)),
thumbnail e cache derivate (§14.1), i backup (§18.2), i layout salvati (§11.2).
**Nessuna di queste sceglie il proprio posto per imitazione**: lo sceglie da
questa tabella, e ci aggiunge una riga con la sua classe, la sua versione di
schema (§15.3) e la sua disciplina di scrittura.
