//! Le invarianti di dipendenza, rese test.
//!
//! `fub-abi` è il contratto e `fub-kernel` è il core agnostico: nessuno dei
//! due deve sapere cosa sia il markdown, tauri, wasmtime o un motore di ricerca.
//! E `fub-features` è il banco di prova del dogfooding: se la libreria delle
//! feature ufficiali dipendesse dal kernel, "sono scritte come le scriverebbe un
//! plugin" sarebbe un'affermazione e non una proprietà.
//!
//! Quattro reti, con maglie diverse:
//!
//! 1. **Denylist transitiva** — nessun crate delle famiglie proibite può
//!    comparire nel grafo delle dipendenze *normali* di `fub-abi` e
//!    `fub-kernel`, nemmeno arrivandoci attraverso qualcun altro.
//! 2. **Allowlist delle dipendenze dirette** — ciò che i due `Cargo.toml`
//!    dichiarano è un elenco chiuso. Aggiungere una dipendenza diretta è una
//!    decisione architetturale, e va presa modificando anche questo file.
//! 3. **Allowlist transitiva per `fub-abi`** — il contratto ha tre dipendenze,
//!    quindi la sua chiusura si può *elencare per intero*. Una denylist per
//!    prefisso non vedrebbe un parser markdown con un nome nuovo; un elenco
//!    chiuso vede tutto ciò che compare, chiamato come vuole.
//! 4. **Il diagramma dei componenti** — il grafo disegnato in
//!    `../../../docs/architecture/overview.md` deve dire le stesse dipendenze che
//!    dice `cargo metadata`, nei due versi.
//!
//! Le maglie sono diverse di proposito: la seconda intercetta il gesto (`cargo
//! add`), la prima il contrabbando, la terza l'ignoto. Sul kernel — che ha una
//! chiusura più larga, con `camino` di mezzo — resta la denylist: un `cargo
//! update` che rinomina un crate di supporto lontano non deve rompere la build
//! per niente.
//!
//! La quarta è di natura diversa dalle altre tre: non difende il codice da una
//! dipendenza, difende un **documento** dal codice. Un disegno è il candidato
//! ideale a diventare il secondo posto che racconta la stessa cosa e invecchia
//! in silenzio, perché non lo compila nessuno — e la misura del problema il repo
//! ce l'ha già data al contrario: `mappa-visuale.md` diceva «quattordici
//! famiglie» mentre un commento di `traits.rs` ne diceva dieci, per ottocento
//! righe. Il disegno aveva ragione, il codice torto, e nessuno dei due poteva
//! accorgersene.
//!
//! Si guardano solo le dipendenze **normali**: dev e build non finiscono nella
//! libreria (questo stesso test usa `serde_json` e `wit-parser` come dev-dep).
//!
//! Il test vive in `fub-abi` perché il workspace è virtuale e non ha un posto
//! proprio dove metterlo; interroga comunque l'intero workspace.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::process::Command;

use serde_json::Value;

/// I crate che il contratto e il core non devono vedere, per famiglia: il
/// confronto è per prefisso, così `tauri-build` o `tokio-util` non passano.
///
/// Non è un elenco di crate "brutti": è l'elenco di ciò che legherebbe il core
/// a una scelta che il progetto vuole poter cambiare — il parser markdown, il
/// toolkit dell'app, il runtime wasm, il motore di ricerca, l'I/O asincrono.
const FORBIDDEN: &[&str] = &[
    "comrak",
    "pulldown-cmark",
    "markdown",
    "tauri",
    "wry",
    "webkit2gtk",
    "wasmtime",
    "cranelift",
    "wasmer",
    "tantivy",
    "tokio",
    "async-std",
    "notify",
];

/// Le dipendenze normali che `fub-abi` e `fub-kernel` possono dichiarare.
/// Elenco chiuso: allungarlo è una decisione, non un incidente.
const ALLOWED_DIRECT: &[(&str, &[&str])] = &[
    // Il contratto: serializzazione, e la normalizzazione Unicode (NFC) delle
    // chiavi di risoluzione — macOS scrive i nomi file in NFD, i link digitati
    // sono NFC (vedi `rules::path::resolution_key`). Sta qui e non nel kernel
    // perché ci sta la regola: chi serve una `IndexQuery` può non avere il
    // kernel fra le mani.
    (
        "fub-abi",
        &["serde", "serde_json", "thiserror", "unicode-normalization"],
    ),
    // Il core: il contratto, serializzazione, path UTF-8. `tracing` è solo la
    // facciata del log (§17.3): il collettore è scritto in casa in `crate::log`,
    // e `tracing` è già nell'albero per via di tauri — prenderlo diretto non
    // aggiunge un crate, e l'assenza di `tracing-attributes` è presidiata dal
    // `default-features = false` nel workspace.
    //
    // `windows-sys` è dichiarato sotto `[target.'cfg(windows)'.dependencies]` e
    // compare **lo stesso** in questo elenco, perché la fotografia è del
    // manifesto e non della macchina che la scatta: una dipendenza che entra
    // solo su una piattaforma è precisamente quella che nessuno rilegge, ed è la
    // ragione per cui il presidio guarda ciò che è dichiarato. Serve a una
    // syscall sola — `GetFileInformationByHandle`, il conteggio dei nomi di un
    // file (§23.16) — e non intacca l'invariante di agnosticità: non è markdown,
    // non è una UI, non è un runtime. Il perché di questa e non di una FFI a
    // mano sta nel `Cargo.toml` del kernel.
    (
        "fub-kernel",
        &[
            "fub-abi",
            "serde",
            "serde_json",
            "camino",
            "cap-std",
            "thiserror",
            "tracing",
            "windows-sys",
            // La verifica di scrittura all'ingresso (0160): `access(2)`
            // chiede al sistema se chi gira può scrivere nella radice, e la
            // domanda va fatta a lui, non ai bit di permesso. Come
            // `windows-sys`, è una syscall sola dietro un crate già
            // nell'albero, dichiarata solo su unix — e compare lo stesso in
            // questo elenco, per la stessa ragione di quella: la fotografia
            // è del manifesto, non della macchina.
            "libc",
        ],
    ),
];

/// **Tutto** ciò che `fub-abi` raggiunge fra le dipendenze normali, sé stesso
/// escluso: serde, serde_json, thiserror, unicode-normalization e la loro coda
/// di macro e utilità.
///
/// È una fotografia, e il test pretende che sia fedele nelle due direzioni: un
/// nome nuovo è rosso (guardalo: è arrivato qualcosa che nessuno ha chiesto), un
/// nome sparito è rosso (aggiorna l'elenco, così resta una fotografia e non un
/// ricordo). Un `cargo update` che aggiunge un crate di supporto è un cambio
/// piccolo da approvare a mano — che è esattamente il punto: il contratto è il
/// posto dove non vogliamo che entri nulla di soppiatto.
const ALLOWED_TRANSITIVE_ABI: &[&str] = &[
    "equivalent",
    "foldhash",
    "hashbrown",
    "indexmap",
    "itoa",
    "memchr",
    "proc-macro2",
    "quote",
    "serde",
    "serde_core",
    "serde_derive",
    "serde_json",
    "syn",
    "thiserror",
    "thiserror-impl",
    "tinyvec",
    "tinyvec_macros",
    "unicode-ident",
    "unicode-normalization",
    "zmij",
];

// ---------------------------------------------------------------------------

fn metadata() -> Value {
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.toml");
    let out = Command::new(env!("CARGO"))
        .args([
            "metadata",
            "--format-version",
            "1",
            "--manifest-path",
            manifest,
        ])
        .output()
        .expect("impossibile eseguire `cargo metadata`");
    assert!(
        out.status.success(),
        "`cargo metadata` è fallito:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).expect("output di `cargo metadata` non è JSON")
}

fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("campo `{key}` assente da `cargo metadata`"))
        .as_slice()
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("campo `{key}` assente o non stringa in {v}"))
}

/// `true` se il nome appartiene a una delle famiglie proibite.
fn forbidden(name: &str) -> bool {
    FORBIDDEN.iter().any(|f| {
        name == *f || name.starts_with(&format!("{f}-")) || name.starts_with(&format!("{f}_"))
    })
}

/// Il grafo delle sole dipendenze **normali** del workspace.
struct Graph<'a> {
    metadata: &'a Value,
    name_of: BTreeMap<&'a str, &'a str>,
    deps: BTreeMap<&'a str, Vec<&'a str>>,
}

impl<'a> Graph<'a> {
    fn new(metadata: &'a Value) -> Self {
        let mut name_of = BTreeMap::new();
        for pkg in arr(metadata, "packages") {
            name_of.insert(str_of(pkg, "id"), str_of(pkg, "name"));
        }

        // kind assente/null = dipendenza normale; `dev` e `build` non entrano
        // nella libreria.
        let resolve = metadata
            .get("resolve")
            .expect("`resolve` assente: serve il grafo");
        let mut deps: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for node in arr(resolve, "nodes") {
            let id = str_of(node, "id");
            let mut normal = Vec::new();
            for dep in arr(node, "deps") {
                let is_normal = arr(dep, "dep_kinds")
                    .iter()
                    .any(|k| k.get("kind").map(Value::is_null).unwrap_or(true));
                if is_normal {
                    normal.push(str_of(dep, "pkg"));
                }
            }
            deps.insert(id, normal);
        }

        Graph {
            metadata,
            name_of,
            deps,
        }
    }

    fn id_of(&self, crate_name: &str) -> &'a str {
        self.name_of
            .iter()
            .find(|(_, n)| **n == crate_name)
            .map(|(id, _)| *id)
            .unwrap_or_else(|| panic!("`{crate_name}` non è nel workspace"))
    }

    /// Tutti i crate raggiungibili fra le dipendenze normali, per nome, radice
    /// esclusa.
    fn closure(&self, crate_name: &str) -> BTreeSet<&'a str> {
        let root = self.id_of(crate_name);
        let mut seen: BTreeSet<&str> = BTreeSet::from([root]);
        let mut queue = VecDeque::from([root]);
        let mut out = BTreeSet::new();
        while let Some(id) = queue.pop_front() {
            for dep in self.deps.get(id).map(Vec::as_slice).unwrap_or_default() {
                if !seen.insert(dep) {
                    continue;
                }
                out.insert(self.name_of[dep]);
                queue.push_back(dep);
            }
        }
        out
    }

    /// Le dipendenze **dichiarate** nel `Cargo.toml` di un crate, per genere:
    /// `None` è la dipendenza normale (in `cargo metadata` il `kind` è assente o
    /// nullo), `Some("dev")` quella di prova.
    fn declared(&self, crate_name: &str, kind: Option<&str>) -> BTreeSet<&'a str> {
        let pkg = arr(self.metadata, "packages")
            .iter()
            .find(|p| str_of(p, "name") == crate_name)
            .unwrap_or_else(|| panic!("`{crate_name}` non è nel workspace"));
        arr(pkg, "dependencies")
            .iter()
            .filter(|d| match kind {
                None => d.get("kind").map(Value::is_null).unwrap_or(true),
                Some(k) => d.get("kind").and_then(Value::as_str) == Some(k),
            })
            .map(|d| str_of(d, "name"))
            .collect()
    }

    /// Le dipendenze normali **dichiarate** nel `Cargo.toml` di un crate.
    fn direct(&self, crate_name: &str) -> BTreeSet<&'a str> {
        self.declared(crate_name, None)
    }

    /// I crate del workspace, per nome.
    fn members(&self) -> BTreeSet<&'a str> {
        arr(self.metadata, "workspace_members")
            .iter()
            .map(|id| {
                let id = id.as_str().expect("`workspace_members` non è di stringhe");
                *self
                    .name_of
                    .get(id)
                    .unwrap_or_else(|| panic!("il membro `{id}` non ha un pacchetto"))
            })
            .collect()
    }
}

#[test]
fn abi_and_kernel_stay_agnostic() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    // 1. denylist, transitiva.
    for (crate_name, _) in ALLOWED_DIRECT {
        let trespassers: Vec<&str> = graph
            .closure(crate_name)
            .into_iter()
            .filter(|n| forbidden(n))
            .collect();
        assert!(
            trespassers.is_empty(),
            "`{crate_name}` raggiunge {trespassers:?} fra le dipendenze normali.\n\
             È il firewall anti-lock-in: markdown, UI, runtime wasm e motore di\n\
             ricerca stanno nei crate a valle, non qui. Vedi ../../../docs/project/status.md."
        );
    }

    // 2. allowlist, sulle dipendenze dirette dichiarate.
    for (crate_name, allowed) in ALLOWED_DIRECT {
        let allowed: BTreeSet<&str> = allowed.iter().copied().collect();
        let declared = graph.direct(crate_name);

        let unexpected: Vec<&&str> = declared.difference(&allowed).collect();
        assert!(
            unexpected.is_empty(),
            "`{crate_name}` dichiara dipendenze normali non previste: {unexpected:?}.\n\
             Se è una scelta deliberata, aggiungila a ALLOWED_DIRECT in questo test\n\
             (e spiega perché nel Cargo.toml)."
        );

        let vanished: Vec<&&str> = allowed.difference(&declared).collect();
        assert!(
            vanished.is_empty(),
            "`{crate_name}` non dichiara più {vanished:?}: aggiorna ALLOWED_DIRECT\n\
             in questo test, così l'elenco resta una fotografia fedele."
        );
    }
}

/// La maglia più fine, e solo dove è sostenibile: sul contratto si elenca
/// **tutto** ciò che entra, non solo ciò che è vietato.
#[test]
fn the_contract_reaches_nothing_nobody_asked_for() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);
    let allowed: BTreeSet<&str> = ALLOWED_TRANSITIVE_ABI.iter().copied().collect();
    let reached = graph.closure("fub-abi");

    let intruders: Vec<&&str> = reached.difference(&allowed).collect();
    assert!(
        intruders.is_empty(),
        "`fub-abi` reaches {intruders:?}, which are not in the transitive allowlist.\n\
         If it is a support crate that arrived with a `cargo update`, look at it\n\
         and add it to ALLOWED_TRANSITIVE_ABI. If you do not know what it is,\n\
         that is exactly the case this list exists for."
    );

    let vanished: Vec<&&str> = allowed.difference(&reached).collect();
    assert!(
        vanished.is_empty(),
        "`fub-abi` no longer reaches {vanished:?}: remove it from\n\
         ALLOWED_TRANSITIVE_ABI, so the list stays a snapshot and not a memory."
    );
}

/// Il confine feature↔kernel, che finora era **affermato** e non verificato.
///
/// Le feature ufficiali sono il dogfooding del contratto: implementano gli stessi
/// trait che implementerà un plugin di terzi, e un plugin di terzi non ha
/// `fub-kernel` fra le mani. Se la libreria ne avesse bisogno, la prossima
/// feature prenderebbe la scorciatoia senza che nessuno se ne accorga — e il
/// giorno del proxy WASM la scorciatoia sarebbe un muro.
///
/// I test end-to-end invece il kernel lo usano, e devono: è la loro ragione
/// d'essere. Per questo `fub-kernel` sta nei `[dev-dependencies]`, che qui non
/// si guardano.
#[test]
fn official_features_do_not_depend_on_the_kernel() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    assert!(
        !graph.direct("fub-features").contains("fub-kernel"),
        "`fub-features` dichiara `fub-kernel` fra le dipendenze normali: \n\
         va nei [dev-dependencies], perché la libreria non lo usa (e non deve)."
    );
    assert!(
        !graph.closure("fub-features").contains("fub-kernel"),
        "`fub-features` raggiunge `fub-kernel` fra le dipendenze normali: \n\
         una feature ufficiale deve poter girare con ciò che avrà un plugin di terzi."
    );
}

/// Il confine sdk↔kernel: **l'SDK è ciò che un guest importa**, e il kernel non
/// ci può stare (§16.1).
///
/// Questa rete è nata da una premessa trovata falsa. La [seduta
/// 16](../../../docs/project/roadmap.md) dava per scontato
/// che mettere `fub-kernel` in `fub-sdk` «violerebbe l'invariante che
/// `dependency_invariant.rs` presidia» — e questo file, letto riga per riga, non
/// nominava `fub-sdk` da nessuna parte: l'allowlist copre `fub-abi` e
/// `fub-kernel`, i due confini coprono `fub-features` e `fub-host`.
/// L'invariante c'era nelle intenzioni e non nel test, che è il caso peggiore
/// dei due — una garanzia che si crede di avere non la si va a verificare.
///
/// La conseguenza è concreta e non teorica: `fub-sdk` è **dipendenza normale**
/// di `fub-format-markdown`. Il kernel dentro l'SDK finirebbe nella libreria
/// di un provider di formato, cioè esattamente dove il progetto ha deciso che
/// non stia — e ci finirebbe anche dietro una cargo feature, perché
/// l'unificazione delle feature nel workspace la accende per tutti appena
/// qualcuno la chiede.
#[test]
fn the_sdk_does_not_see_the_kernel() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    assert!(
        !graph.direct("fub-sdk").contains("fub-kernel"),
        "`fub-sdk` dichiara `fub-kernel` fra le dipendenze normali.\n\
         L'SDK è ciò che un guest WASM importa a M5, ed è dipendenza normale di\n\
         `fub-format-markdown`: il kernel qui finisce nella libreria di un\n\
         provider. Il banco che ha bisogno del kernel è `fub-testkit`.\n\
         Vedi ../../../docs/decisions/0196-test-e-artefatti-generati.md."
    );
    assert!(
        !graph.closure("fub-sdk").contains("fub-kernel"),
        "`fub-sdk` raggiunge `fub-kernel` fra le dipendenze normali, passando\n\
         per qualcun altro. Vale la stessa ragione: chi importa l'SDK non deve\n\
         trovarsi il kernel nel grafo."
    );
}

/// Il banco del lato host non è mai una **dipendenza normale** di nessuno
/// (§16.2).
///
/// `fub-testkit` ha il kernel fra le mani per costruzione — è la sua ragione
/// d'essere — quindi l'unico modo di renderlo innocuo è che nessuna libreria lo
/// dichiari. Sta nei `[dev-dependencies]`, e il ciclo che ne nasce
/// (`fub-kernel` → `fub-testkit` → `fub-kernel`) è legittimo proprio
/// perché è di sola prova: cargo lo risolve, e la libreria del kernel non vede
/// niente.
///
/// La rete guarda **tutti** i membri, presenti e futuri: è la forma che non
/// invecchia quando nasce l'ennesimo crate.
#[test]
fn the_test_bench_enters_no_library() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    let guilty: Vec<&str> = graph
        .members()
        .into_iter()
        .filter(|m| *m != "fub-testkit")
        .filter(|m| graph.direct(m).contains("fub-testkit"))
        .collect();

    assert!(
        guilty.is_empty(),
        "{guilty:?} dichiarano `fub-testkit` fra le dipendenze **normali**.\n\
         È il banco di prova del lato host: ha il kernel dentro, e va nei\n\
         [dev-dependencies] di chi lo usa. Vedi\n\
         ../../../docs/decisions/0196-test-e-artefatti-generati.md."
    );
}

/// Il confine host↔app: **chi monta** non deve dipendere da chi disegna (§8.2).
///
/// `fub-host` esiste perché il composition root aveva cinque clienti previsti
/// — CLI (27.1), API locale (27.2), e2e headless (17.2 e 27.4), mobile (26.2) e
/// PWA (26.3) — e nessuno poteva riusarlo finché viveva dentro un
/// `#[tauri::command]`. Se `tauri` rientrasse dalla finestra, quei cinque
/// tornerebbero a non poterlo prendere, e «`fub-app` è ridotto a colla Tauri»
/// resterebbe vero solo nella frase che lo dice.
///
/// La denylist per famiglia è la stessa dell'`abi`/kernel, ristretta al toolkit:
/// il resto — `notify`, `tantivy`, il parser markdown — un host lo può avere, ed
/// è anzi ciò che monta.
#[test]
fn whoever_mounts_does_not_depend_on_whoever_draws() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);
    let reached = graph.closure("fub-host");

    let ui: Vec<&str> = reached
        .into_iter()
        .filter(|n| {
            ["tauri", "wry", "webkit2gtk"]
                .iter()
                .any(|f| n.starts_with(f))
        })
        .collect();
    assert!(
        ui.is_empty(),
        "`fub-host` raggiunge {ui:?} fra le dipendenze normali.\n\
         Chi monta non può dipendere da chi disegna: la CLI, l'API locale, gli e2e\n\
         headless, il mobile e la PWA devono poter prendere il montaggio senza\n\
         prendersi un webview. Vedi ../../../docs/decisions/0183-composizione-host-kernel.md."
    );
}

/// Il verso opposto del confine host↔app: **la colla non scavalca chi monta**.
///
/// `whoever_mounts_does_not_depend_on_whoever_draws` guarda `fub-host` e gli
/// vieta il webview. Questo guarda `fub-app` e gli vieta di saltare l'host per
/// arrivare alle feature ufficiali. Sono due metà della stessa frase — «`fub-app`
/// è ridotto a colla Tauri» — e finora ne era presidiata una sola.
///
/// La riga che questo test toglie di mezzo diceva di esserci «solo per
/// `VersionRef`, che è un tipo che attraversa l'IPC», e sbagliava in due modi.
/// `VersionRef` di lì non passa più — le tre porte IPC del versioning sono
/// sparite quando la cronologia è diventata un `ViewProvider` — e `src/` non
/// nominava `fub_features` da nessuna parte: era una dipendenza **dichiarata e
/// non usata**, che è il caso che nessun compilatore vede. L'altra metà è che
/// non faceva nemmeno ciò che diceva: i `#[cfg(feature = "versioning")]` che
/// gatano `Session::versions` sono su `fub-host`, e accendere
/// `fub-features/versioning` da `fub-app` non li accende, perché le cargo
/// feature non risalgono il grafo.
///
/// Perché un test e non «l'assenza della riga»: togliere una dipendenza inusata
/// non lascia dietro nessun guardiano. Il compilatore dice di no solo a chi
/// scrive `fub_features::` in `fub-app/src/`, e non dice niente a chi rimette
/// la riga nel `Cargo.toml` «per un attimo». Questo lo dice.
///
/// **Chi monta è il solo che possa tradurre**: se all'app serve una feature
/// ufficiale, la chiede a `fub-host` per nome (`features = ["feature-ufficiali"]`),
/// e `fub-host` la inoltra a `fub-features`. Un secondo cliente del montaggio —
/// la CLI (27.1), l'API locale (27.2) — eredita la stessa regola gratis, perché
/// la rete guarda **chiunque** dipenda da `fub-host`.
#[test]
fn the_glue_does_not_bypass_the_mounter() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);

    let guilty: Vec<&str> = graph
        .members()
        .into_iter()
        .filter(|m| *m != "fub-host" && *m != "fub-features")
        .filter(|m| graph.direct(m).contains("fub-host"))
        .filter(|m| graph.direct(m).contains("fub-features"))
        .collect();

    assert!(
        guilty.is_empty(),
        "{guilty:?} dichiarano **sia** `fub-host` **sia** `fub-features` fra le\n\
         dipendenze normali. Chi ha già il montaggio non ha ragione di raggiungere\n\
         le feature ufficiali da sé: quale bundle esista e quale sia acceso lo\n\
         decide `fub-host` in un posto solo (§16.3), e una cargo feature chiesta\n\
         al crate sbagliato non accende il `#[cfg]` che si crede.\n\
         Se serve una feature ufficiale, chiedila a `fub-host` per nome:\n\
         `fub-host = {{ workspace = true, features = [\"…\"] }}`."
    );
}

// ---------------------------------------------------------------------------
// La quarta rete: il diagramma dei componenti.
// ---------------------------------------------------------------------------

/// Il documento che contiene il grafo, relativo alla radice del repo.
const DIAGRAM_DOC: &str = "../../../docs/architecture/overview.md";

/// Il commento Mermaid che marca *quale* blocco è il grafo delle dipendenze.
/// Serve perché quel documento ne contiene più d'uno, e il primo è disposto a
/// mano: cercare "il blocco mermaid" prenderebbe il disegno sbagliato e lo
/// direbbe con un errore incomprensibile.
const DIAGRAM_MARKER: &str = "@grafo-dipendenze";

/// Ciò che il disegno dichiara: i crate nominati e i due generi di arco.
#[derive(Default)]
struct Diagram {
    crates: BTreeSet<String>,
    normal: BTreeSet<(String, String)>,
    dev: BTreeSet<(String, String)>,
}

/// Legge il blocco marcato e lo traduce in insiemi confrontabili.
///
/// Il dialetto ammesso è minuscolo di proposito — dichiarazioni
/// `id["nome"]:::classe`, archi `a --> b` e `a -.-> b`, commenti `%%`, e le
/// righe di intestazione `flowchart`/`classDef`. Tutto il resto è un errore e
/// non un'omissione: un parser che ignora ciò che non capisce trasformerebbe un
/// arco scritto male in un arco assente, e l'assenza qui è proprio ciò che il
/// test deve saper vedere.
fn read_diagram(source: &str) -> Diagram {
    let mut blocks: Vec<Vec<&str>> = Vec::new();
    let mut current: Option<Vec<&str>> = None;
    for line in source.lines() {
        match (&mut current, line.trim()) {
            (None, "```mermaid") => current = Some(Vec::new()),
            (Some(_), "```") => blocks.push(current.take().expect("dentro un blocco")),
            (Some(body), _) => body.push(line),
            (None, _) => {}
        }
    }
    assert!(
        current.is_none(),
        "in {DIAGRAM_DOC} c'è un blocco ```mermaid che nessuna riga chiude"
    );

    let mut marked: Vec<Vec<&str>> = blocks
        .into_iter()
        .filter(|b| b.iter().any(|the| the.contains(DIAGRAM_MARKER)))
        .collect();
    assert_eq!(
        marked.len(),
        1,
        "in {DIAGRAM_DOC} i blocchi mermaid marcati `{DIAGRAM_MARKER}` sono {},\n\
         e deve essercene esattamente uno: è il grafo che questo test confronta\n\
         con `cargo metadata`.",
        marked.len()
    );

    let mut names: BTreeMap<&str, String> = BTreeMap::new();
    let mut out = Diagram::default();

    for line in marked.remove(0) {
        let the = line.trim();
        if the.is_empty()
            || the.starts_with("%%")
            || the.starts_with("flowchart")
            || the.starts_with("classDef")
        {
            continue;
        }

        // Dichiarazione: `id["nome-crate"]` con `:::classe` facoltativa.
        if let Some((id, rest)) = the.split_once("[\"") {
            let (name, tail) = rest.split_once("\"]").unwrap_or_else(|| {
                panic!("{DIAGRAM_DOC}: dichiarazione senza `\"]` finale:\n  {the}")
            });
            let id = id.trim();
            assert!(
                tail.is_empty() || tail.starts_with(":::"),
                "{DIAGRAM_DOC}: dopo la dichiarazione di `{id}` c'è `{tail}`, che non è\n\
                 né vuoto né una classe `:::`:\n  {the}"
            );
            assert!(
                names.insert(id, name.to_string()).is_none(),
                "{DIAGRAM_DOC}: il riquadro `{id}` è dichiarato due volte"
            );
            out.crates.insert(name.to_string());
            continue;
        }

        // Arco: `a --> b` (normale) oppure `a -.-> b` (solo dev).
        let parts: Vec<&str> = the.split_whitespace().collect();
        let resolve = |id: &str| -> String {
            names
                .get(id)
                .unwrap_or_else(|| {
                    panic!(
                        "{DIAGRAM_DOC}: l'arco nomina `{id}`, che non è un riquadro dichiarato\n\
                         prima nello stesso blocco:\n  {the}"
                    )
                })
                .clone()
        };
        match parts.as_slice() {
            [from, "-->", to] => {
                out.normal.insert((resolve(from), resolve(to)));
            }
            [from, "-.->", to] => {
                out.dev.insert((resolve(from), resolve(to)));
            }
            _ => panic!(
                "{DIAGRAM_DOC}: riga fuori dal dialetto che questo test sa leggere:\n  {the}\n\
                 Ammessi: `id[\"nome\"]:::classe`, `a --> b`, `a -.-> b`, commenti `%%`,\n\
                 `flowchart …` e `classDef …`. Se serve altro, allarga il parser insieme\n\
                 al disegno — non lasciare che il disegno dica cose che nessuno rilegge."
            ),
        }
    }

    out
}

/// Il grafo disegnato e il grafo vero devono coincidere, **nei due versi**.
///
/// Il verso che si vede subito è «un arco disegnato che non esiste». Quello che
/// conta è l'altro: una dipendenza reale che il disegno non mostra. Un diagramma
/// incompleto mente più di uno sbagliato, perché ha l'aria di essere completo —
/// e chi lo guarda per decidere dove mettere un crate nuovo prende la decisione
/// sbagliata senza mai dubitarne.
///
/// Si confrontano le dipendenze **dichiarate** e non la chiusura transitiva: il
/// disegno mostra i `Cargo.toml`, e una chiusura fra sette crate sarebbe un
/// groviglio che nessuno guarderebbe. Gli archi tratteggiati sono le dipendenze
/// di solo `[dev-dependencies]` — quelle che sono anche normali non si
/// ridisegnano, o `fub-kernel`, che dichiara `fub-abi` in entrambe le
/// sezioni, avrebbe due frecce per una relazione sola.
#[test]
fn the_diagram_declares_the_real_dependencies() {
    let metadata = metadata();
    let graph = Graph::new(&metadata);
    let members = graph.members();

    let doc = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../docs/architecture/overview.md"
    );
    let source = std::fs::read_to_string(doc)
        .unwrap_or_else(|and| panic!("{DIAGRAM_DOC} non si legge: {and}"));
    let drawn = read_diagram(&source);

    // 1. I riquadri sono i crate del workspace, tutti e soli.
    let real_crates: BTreeSet<String> = members.iter().map(|n| n.to_string()).collect();
    let ghosts: Vec<&String> = drawn.crates.difference(&real_crates).collect();
    assert!(
        ghosts.is_empty(),
        "il diagramma in {DIAGRAM_DOC} disegna {ghosts:?}, che non sono crate del\n\
         workspace. Se sono previsti ma non scritti, vanno nel primo disegno del\n\
         documento, tratteggiati, non in questo — questo è la fotografia."
    );
    let missing: Vec<&String> = real_crates.difference(&drawn.crates).collect();
    assert!(
        missing.is_empty(),
        "il diagramma in {DIAGRAM_DOC} non nomina {missing:?}, che nel workspace ci\n\
         sono. Un crate nato e mai disegnato è il modo normale in cui una mappa\n\
         smette di essere una mappa."
    );

    // 2. Gli archi pieni sono le dipendenze normali fra membri.
    let mut real_normal = BTreeSet::new();
    let mut real_dev = BTreeSet::new();
    for &m in &members {
        let normal: BTreeSet<&str> = graph
            .declared(m, None)
            .intersection(&members)
            .copied()
            .collect();
        for d in &normal {
            real_normal.insert((m.to_string(), d.to_string()));
        }
        for d in graph.declared(m, Some("dev")).intersection(&members) {
            if !normal.contains(d) {
                real_dev.insert((m.to_string(), d.to_string()));
            }
        }
    }

    let show = |set: &BTreeSet<(String, String)>| -> Vec<String> {
        set.iter().map(|(a, b)| format!("{a} -> {b}")).collect()
    };

    let invented = show(&drawn.normal.difference(&real_normal).cloned().collect());
    assert!(
        invented.is_empty(),
        "il diagramma disegna dipendenze normali che nessun Cargo.toml dichiara:\n  {}",
        invented.join("\n  ")
    );
    let unshown = show(&real_normal.difference(&drawn.normal).cloned().collect());
    assert!(
        unshown.is_empty(),
        "queste dipendenze normali esistono e il diagramma non le mostra:\n  {}\n\
         Aggiungile con `a --> b` in {DIAGRAM_DOC}.",
        unshown.join("\n  ")
    );

    // 3. Gli archi tratteggiati sono le dipendenze di solo `dev`.
    let invented = show(&drawn.dev.difference(&real_dev).cloned().collect());
    assert!(
        invented.is_empty(),
        "il diagramma dà per dev-only dipendenze che non lo sono (o che non\n\
         esistono):\n  {}",
        invented.join("\n  ")
    );
    let unshown = show(&real_dev.difference(&drawn.dev).cloned().collect());
    assert!(
        unshown.is_empty(),
        "queste dipendenze di solo `[dev-dependencies]` fra crate del workspace non\n\
         sono disegnate:\n  {}\n\
         Aggiungile con `a -.-> b`. Sono il confine del dogfooding: se `fub-features`\n\
         cominciasse a usare il kernel per davvero, la freccia diventerebbe piena e\n\
         quel cambio va visto.",
        unshown.join("\n  ")
    );
}

/// Il test del test: la rete deve sapersi chiudere.
#[test]
fn forbidden_families_match_by_prefix() {
    assert!(forbidden("tauri"));
    assert!(forbidden("tauri-build"));
    assert!(forbidden("tokio-util"));
    assert!(forbidden("wasmtime_environ"));
    // Vicini di nome che non c'entrano nulla: nessun falso positivo.
    assert!(!forbidden("tauribbon"));
    assert!(!forbidden("serde"));
    assert!(!forbidden("camino"));
}

/// Il test del parser: deve distinguere i due archi, e deve saltare il blocco
/// non marcato — che nel documento vero è il disegno disposto a mano.
#[test]
fn the_diagram_parser_reads_what_it_claims_to_read() {
    let source = "\
prosa\n\
```mermaid\n\
flowchart TB\n\
    Altro[\"un disegno che non c'entra\"]\n\
```\n\
altra prosa\n\
```mermaid\n\
flowchart TD\n\
    %% @grafo-dipendenze\n\
    classDef core fill:#000\n\
    a[\"fub-alfa\"]:::core\n\
    b[\"fub-beta\"]\n\
\n\
    a --> b\n\
    b -.-> a\n\
```\n";
    let d = read_diagram(source);
    assert_eq!(
        d.crates,
        BTreeSet::from(["fub-alfa".to_string(), "fub-beta".to_string()])
    );
    assert_eq!(
        d.normal,
        BTreeSet::from([("fub-alfa".to_string(), "fub-beta".to_string())])
    );
    assert_eq!(
        d.dev,
        BTreeSet::from([("fub-beta".to_string(), "fub-alfa".to_string())])
    );
}

/// E deve fermarsi su ciò che non capisce. Una riga ignorata è un arco che
/// sparisce, e un arco che sparisce è esattamente il difetto che il test cerca.
#[test]
#[should_panic(expected = "fuori dal dialetto")]
fn the_diagram_parser_refuses_what_it_cannot_read() {
    read_diagram(
        "```mermaid\n    %% @grafo-dipendenze\n    a[\"x\"]\n    a ==>|\"parla con\"| a\n```\n",
    );
}
