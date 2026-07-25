//! Conformità abi ↔ WIT (vivo da M2, freeze a M4).
//!
//! Questo test rende **verificabile** la "regola d'oro": ogni tipo che attraversa
//! una firma di trait deve avere una controparte in `wit/fubmd/abi.wit`, con la
//! **stessa forma** — non solo con lo stesso nome. Quattro pressioni:
//!
//! 1. **Il WIT deve essere valido** — il file viene dato in pasto a `wit-parser`.
//!    Un contratto che non parsa è un test rosso, non un file di testo che
//!    "sembra giusto".
//! 2. **Drift lato Rust** → i match e i destructuring esaustivi qui sotto NON
//!    compilano se un enum guadagna una variante o un record un campo; e le
//!    firme delle funzioni sono **cast dei metodi dei trait a puntatore a
//!    funzione**, quindi non compilano se un parametro o un tipo di ritorno
//!    cambia.
//! 3. **Drift lato WIT, nelle due direzioni** — si confrontano gli **insiemi
//!    ordinati di nomi e i tipi** estratti dal parse: campi di record, casi di
//!    variant col tipo del payload, destinazioni degli alias, parametri e
//!    risultati di ogni funzione. Un tipo dichiarato nel contratto e mai
//!    rivendicato dall'abi fallisce ugualmente (contratto morto).
//! 4. **`host` è eliso** — nessuna funzione del WIT può avere un parametro
//!    `host`: le capacità sono importate dal world, non passate a mano. Le firme
//!    Rust invece ce l'hanno, e il test verifica che spariscano *esattamente lì*.
//!
//! # Da dove vengono i tipi attesi
//!
//! Non sono scritti a mano. `wit(&campo)` deduce la forma WIT **dal tipo Rust
//! del campo destrutturato** ([`WitType`]): se `SearchHit::score` diventasse
//! `f64`, l'attesa diventerebbe `f64` e il confronto col contratto (`f32`)
//! fallirebbe. Lo stesso per le funzioni: [`WitFn`] deriva parametri e risultato
//! dal tipo del puntatore a funzione, che a sua volta è vincolato al metodo del
//! trait dal cast. È il "non compila su divergenza" chiesto dal piano, ottenuto
//! senza generare codice.
//!
//! # Alberi ricorsivi
//!
//! I tipi che al confine viaggiano come **arena** (`block`, `inline`, `ui-node`,
//! `document-tree`, `ui-tree`, `span`) si confrontano con
//! [`fubmd_abi::arena`], che è la loro forma al confine *scritta in Rust* — e la
//! catena verso gli alberi nativi la tiene il compilatore, perché
//! `DocumentTree::flatten`/`rebuild` sono match esaustivi su entrambi i lati
//! (round-trip provato in `arena`). Prima esisteva solo la prosa nei commenti.
//!
//! `wit-parser` è una **dev-dependency**: l'invariante architetturale di
//! `fubmd-abi` riguarda le dipendenze normali, ed è protetta da
//! `tests/dependency_invariant.rs`.
//!
//! Limite noto, dichiarato: l'**ordine** dei casi di un variant è confrontato con
//! l'ordine in cui sono elencati qui, non con quello dell'enum Rust (il
//! compilatore garantisce che ci siano tutti, non che siano in fila). Riordinare
//! il WIT è rosso; riordinare l'enum Rust senza toccare questo file, no.

use std::collections::{BTreeMap, BTreeSet};

use wit_parser::{Resolve, Type, TypeDefKind, WorldItem, WorldKey};

use fubmd_abi::arena::{self, BlockRef, InlineRef, UiRef};
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Event, EventKind, EventMask};
use fubmd_abi::format::{
    FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext, RenderOptions,
};
use fubmd_abi::model::{DocId, DocumentModel, Frontmatter, Heading, Link, LinkTarget, Span, Tag};
use fubmd_abi::traits::{
    BacklinkRef, CommandOutcome, CommandProvider, CommandSpec, EventHandler, HostApi,
    IndexProvider, IndexQuery, IndexResult, JobId, JobSpec, Plugin, PluginManifest,
    PluginPermissions, SearchHit, ViewPlacement, ViewProvider, ViewSpec,
};
use fubmd_abi::ui::{ActionId, Axis, Intent, UiAction, UiNode, ViewUpdate};

// CARGO_MANIFEST_DIR = crates/fubmd-abi ; il contratto è alla radice del repo.
const WIT_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../wit/fubmd/abi.wit");

/// Segnaposto per il ricevitore (`&self`): non attraversa il confine.
const SELF: &str = "«self»";
/// Segnaposto per l'`HostApi`: nelle firme Rust c'è, nel WIT **non deve
/// esserci** — è importato dal world.
const HOST: &str = "«host»";

// ---------------------------------------------------------------------------
// La forma WIT di un tipo Rust, dedotta dal tipo
// ---------------------------------------------------------------------------

/// Come un tipo Rust si scrive nel WIT.
///
/// È il cuore del test: implementarla per un tipo è **dichiarare la sua forma al
/// confine**, e un tipo nuovo in una firma senza questa impl non compila —
/// quindi non passa inosservato.
trait WitType {
    fn wit() -> String;
}

/// La forma WIT del tipo di `v`. Si passa il valore e non il tipo perché così il
/// tipo lo deduce il compilatore dal campo destrutturato: nessuna occasione di
/// scriverne uno diverso da quello vero.
fn wit<T: WitType + ?Sized>(_v: &T) -> String {
    T::wit()
}

/// La forma WIT di un tipo di cui non si ha un valore sotto mano.
fn wit_of<T: WitType + ?Sized>() -> String {
    T::wit()
}

macro_rules! wit_type {
    ($($ty:ty => $name:expr),+ $(,)?) => {
        $(impl WitType for $ty {
            fn wit() -> String {
                $name.to_string()
            }
        })+
    };
}

wit_type! {
    // Primitivi e stringhe.
    bool => "bool",
    u8 => "u8",
    u16 => "u16",
    u32 => "u32",
    u64 => "u64",
    f32 => "f32",
    f64 => "f64",
    str => "string",
    String => "string",
    // L'unità: nel WIT un `result` senza ok si scrive `result<_, e>`, e una
    // funzione che non restituisce niente non ha risultato affatto.
    () => "_",
    // Il JSON libero (frontmatter, attrs, args, payload, storage) attraversa il
    // confine come stringa: è la scelta deliberata dell'escape hatch.
    serde_json::Value => "json",
    serde_json::Map<String, serde_json::Value> => "json",

    // Alias del contratto: newtype qui, `type x = ...` là.
    DocId => "doc-id",
    Frontmatter => "frontmatter",
    ActionId => "action-id",
    JobId => "job-id",
    EventMask => "event-mask",
    BlockRef => "block-ref",
    InlineRef => "inline-ref",
    UiRef => "ui-ref",

    // Record e variant del modello.
    Span => "span",
    arena::Span => "span",
    Heading => "heading",
    Tag => "tag",
    Link => "link",
    LinkTarget => "link-target",
    DocumentModel => "document-model",
    arena::Block => "block",
    arena::Inline => "inline",
    arena::UiNode => "ui-node",
    arena::DocumentTree => "document-tree",
    arena::UiTree => "ui-tree",

    // UI: al confine un albero intero è la sua arena.
    UiNode => "ui-tree",
    Axis => "axis",
    Intent => "intent",
    UiAction => "ui-action",
    ViewUpdate => "view-update",

    // Il resto del contratto.
    FormatDescriptor => "format-descriptor",
    FormatCapabilities => "format-capabilities",
    ParseContext => "parse-context",
    RenderOptions => "render-options",
    FormatError => "format-error",
    PluginError => "plugin-error",
    Event => "event",
    EventKind => "event-kind",
    JobSpec => "job-spec",
    CommandSpec => "command-spec",
    CommandOutcome => "command-outcome",
    ViewSpec => "view-spec",
    ViewPlacement => "view-placement",
    IndexQuery => "index-query",
    IndexResult => "index-result",
    BacklinkRef => "backlink-ref",
    SearchHit => "search-hit",
    PluginManifest => "plugin-manifest",
    PluginPermissions => "plugin-permissions",

    // Ciò che NON attraversa il confine: il ricevitore e le capacità dell'host.
    dyn HostApi => HOST,
    dyn FormatProvider => SELF,
    dyn CommandProvider => SELF,
    dyn ViewProvider => SELF,
    dyn IndexProvider => SELF,
    dyn EventHandler => SELF,
    dyn Plugin => SELF,
}

impl<T: WitType + ?Sized> WitType for &T {
    fn wit() -> String {
        T::wit()
    }
}

impl<T: WitType + ?Sized> WitType for &mut T {
    fn wit() -> String {
        T::wit()
    }
}

impl<T: WitType> WitType for Option<T> {
    fn wit() -> String {
        format!("option<{}>", T::wit())
    }
}

impl<T: WitType> WitType for Vec<T> {
    fn wit() -> String {
        format!("list<{}>", T::wit())
    }
}

impl<T: WitType> WitType for [T] {
    fn wit() -> String {
        format!("list<{}>", T::wit())
    }
}

impl<T: WitType, E: WitType> WitType for Result<T, E> {
    fn wit() -> String {
        format!("result<{}, {}>", T::wit(), E::wit())
    }
}

/// Gli alberi nativi che al confine diventano l'**arena intera** e non una lista
/// di indici.
///
/// Serve un trait a parte perché la stessa `Vec<Block>` significa due cose
/// diverse a due profondità diverse: il corpo di un documento *è* l'arena
/// (`document-tree`), i figli di una citazione sono indici dentro di essa
/// (`list<block-ref>`, e quelli li porta `arena::Block`). Restando un trait, il
/// vincolo è comunque sul tipo: se `DocumentModel::body` cambiasse tipo, questa
/// impl non ci sarebbe e il test non compilerebbe.
trait TreeAtBoundary {
    fn wit_tree() -> String;
}

impl TreeAtBoundary for Vec<fubmd_abi::model::Block> {
    fn wit_tree() -> String {
        "document-tree".to_string()
    }
}

fn wit_tree<T: TreeAtBoundary + ?Sized>(_v: &T) -> String {
    T::wit_tree()
}

// ---------------------------------------------------------------------------
// La firma WIT di un metodo, dedotta dal puntatore a funzione
// ---------------------------------------------------------------------------

/// Una firma come il WIT la vedrebbe: parametri (ricevitore e `host` esclusi) e
/// risultato.
struct RustSig {
    params: Vec<String>,
    result: Option<String>,
    /// La firma Rust aveva un `host` da elidere?
    has_host: bool,
}

/// Un metodo di trait, visto come puntatore a funzione.
trait WitFn {
    fn sig() -> RustSig;
}

/// Costruisce la firma scartando il ricevitore e l'host.
fn sig_from(all: Vec<String>, result: String) -> RustSig {
    let mut it = all.into_iter();
    let receiver = it.next().expect("un metodo ha almeno il ricevitore");
    assert!(
        receiver == SELF || receiver == HOST,
        "il primo parametro dovrebbe essere il ricevitore, invece è `{receiver}`: \
         questo test va chiamato con un metodo di trait, non con una funzione libera"
    );
    let mut params = Vec::new();
    let mut has_host = false;
    for ty in it {
        if ty == HOST {
            has_host = true;
            continue;
        }
        assert_ne!(ty, SELF, "un provider non può comparire fra i parametri");
        params.push(ty);
    }
    RustSig {
        params,
        result: (result != "_").then_some(result),
        has_host,
    }
}

macro_rules! wit_fn {
    ($($p:ident),+) => {
        impl<$($p: WitType,)+ R: WitType> WitFn for fn($($p),+) -> R {
            fn sig() -> RustSig {
                sig_from(vec![$($p::wit()),+], R::wit())
            }
        }
    };
}

wit_fn!(A);
wit_fn!(A, B);
wit_fn!(A, B, C);
wit_fn!(A, B, C, D);

/// I due modi in cui l'`HostApi` compare in una firma Rust. Sono scritti con
/// lifetime `'static` solo perché un puntatore a funzione con lifetime elisi
/// sarebbe higher-ranked, e un tipo higher-ranked non può implementare [`WitFn`];
/// il cast dal metodo del trait resta valido, ed è quello che vincola la firma.
type Host = &'static mut dyn HostApi;
type HostRef = &'static dyn HostApi;

// ---------------------------------------------------------------------------
// Il WIT, parsato: nomi e tipi DICHIARATI, non sottostringhe
// ---------------------------------------------------------------------------

/// La forma di un tipo dichiarato nel WIT, ridotta a ciò che si confronta.
enum Shape {
    /// Campi in ordine: nome → tipo.
    Record(Vec<(String, String)>),
    /// Casi in ordine: nome → tipo del payload (`None` = caso nudo).
    Variant(Vec<(String, Option<String>)>),
    /// Casi di un `enum`, in ordine.
    Enum(Vec<String>),
    /// Destinazione di un alias (`type job-id = u64` → `u64`).
    Alias(String),
    /// Qualunque altra cosa: se compare, `finish` la segnala come non rivendicata.
    Other,
}

impl Shape {
    fn kind(&self) -> &'static str {
        match self {
            Shape::Record(_) => "record",
            Shape::Variant(_) => "variant",
            Shape::Enum(_) => "enum",
            Shape::Alias(_) => "alias",
            Shape::Other => "altro",
        }
    }
}

struct Decl {
    shape: Shape,
    /// Interfaccia che lo dichiara (solo per i messaggi d'errore).
    interface: String,
}

/// Una funzione dichiarata nel WIT.
struct WitSig {
    params: Vec<(String, String)>,
    result: Option<String>,
}

struct Wit {
    /// Tipi dichiarati (i `use` di altre interfacce sono esclusi: sono
    /// importazioni, non dichiarazioni).
    types: BTreeMap<String, Decl>,
    /// Interfaccia → funzioni dichiarate, con la loro firma.
    functions: BTreeMap<String, BTreeMap<String, WitSig>>,
    package: String,
    /// world → (interfacce importate, interfacce esportate).
    worlds: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,

    /// Tipi già confrontati: ciò che resta a fine test è contratto morto.
    covered_types: BTreeSet<String>,
    /// Interfaccia → funzioni già confrontate.
    covered_fns: BTreeMap<String, BTreeSet<String>>,
    /// Divergenze accumulate: il test le riporta tutte insieme, non solo la prima.
    errors: Vec<String>,
}

/// Il nome WIT di un tipo: quello dichiarato se ce l'ha, altrimenti l'espressione
/// (`option<list<inline-ref>>`, `result<_, plugin-error>`, …).
fn render(resolve: &Resolve, ty: &Type) -> String {
    let id = match ty {
        Type::Bool => return "bool".into(),
        Type::U8 => return "u8".into(),
        Type::U16 => return "u16".into(),
        Type::U32 => return "u32".into(),
        Type::U64 => return "u64".into(),
        Type::S8 => return "s8".into(),
        Type::S16 => return "s16".into(),
        Type::S32 => return "s32".into(),
        Type::S64 => return "s64".into(),
        Type::F32 => return "f32".into(),
        Type::F64 => return "f64".into(),
        Type::Char => return "char".into(),
        Type::String => return "string".into(),
        Type::ErrorContext => return "error-context".into(),
        Type::Id(id) => *id,
    };
    let td = &resolve.types[id];
    if let Some(name) = &td.name {
        return name.clone();
    }
    let opt = |t: &Option<Type>| match t {
        Some(t) => render(resolve, t),
        None => "_".to_string(),
    };
    match &td.kind {
        TypeDefKind::Option(t) => format!("option<{}>", render(resolve, t)),
        TypeDefKind::List(t) => format!("list<{}>", render(resolve, t)),
        TypeDefKind::Result(r) => format!("result<{}, {}>", opt(&r.ok), opt(&r.err)),
        TypeDefKind::Tuple(t) => {
            let inner: Vec<String> = t.types.iter().map(|t| render(resolve, t)).collect();
            format!("tuple<{}>", inner.join(", "))
        }
        TypeDefKind::Type(t) => render(resolve, t),
        other => format!("<anonimo:{}>", other.as_str()),
    }
}

fn load(source: &str) -> Wit {
    let mut resolve = Resolve::new();
    // Se il contratto non è un WIT valido il test muore QUI, ed è il punto.
    if let Err(e) = resolve.push_str("wit/fubmd/abi.wit", source) {
        panic!("wit/fubmd/abi.wit non è un WIT valido: {e:?}");
    }

    let mut types: BTreeMap<String, Decl> = BTreeMap::new();
    let mut functions: BTreeMap<String, BTreeMap<String, WitSig>> = BTreeMap::new();

    for (_, iface) in resolve.interfaces.iter() {
        let iface_name = iface.name.clone().unwrap_or_else(|| "<inline>".into());

        for (name, id) in &iface.types {
            let td = &resolve.types[*id];
            // Un `use altra-interfaccia.{x}` genera qui un alias omonimo verso
            // `x`: è un'importazione, non una dichiarazione. Un vero alias
            // locale (`type frontmatter = json`) ha un nome DIVERSO dal target.
            let is_import = match &td.kind {
                TypeDefKind::Type(Type::Id(target)) => {
                    resolve.types[*target].name.as_deref() == Some(name.as_str())
                }
                _ => false,
            };
            if is_import {
                continue;
            }

            let shape = match &td.kind {
                TypeDefKind::Record(r) => Shape::Record(
                    r.fields
                        .iter()
                        .map(|f| (f.name.clone(), render(&resolve, &f.ty)))
                        .collect(),
                ),
                TypeDefKind::Variant(v) => Shape::Variant(
                    v.cases
                        .iter()
                        .map(|c| (c.name.clone(), c.ty.as_ref().map(|t| render(&resolve, t))))
                        .collect(),
                ),
                TypeDefKind::Enum(e) => {
                    Shape::Enum(e.cases.iter().map(|c| c.name.clone()).collect())
                }
                TypeDefKind::Type(t) => Shape::Alias(render(&resolve, t)),
                TypeDefKind::List(t) => Shape::Alias(format!("list<{}>", render(&resolve, t))),
                TypeDefKind::Option(t) => Shape::Alias(format!("option<{}>", render(&resolve, t))),
                _ => Shape::Other,
            };

            let decl = Decl {
                shape,
                interface: iface_name.clone(),
            };
            if let Some(prev) = types.insert(name.clone(), decl) {
                // Il test indicizza per nome nudo: due tipi omonimi in
                // interfacce diverse renderebbero ambigua ogni asserzione.
                panic!(
                    "tipo `{name}` dichiarato due volte ({} e {iface_name}): \
                     il contratto usa nomi globalmente unici, o questo test va riscritto",
                    prev.interface
                );
            }
        }

        let sigs = iface
            .functions
            .iter()
            .map(|(name, f)| {
                let sig = WitSig {
                    params: f
                        .params
                        .iter()
                        .map(|p| (p.name.clone(), render(&resolve, &p.ty)))
                        .collect(),
                    result: f.result.as_ref().map(|t| render(&resolve, t)),
                };
                (name.clone(), sig)
            })
            .collect();
        functions.insert(iface_name, sigs);
    }

    let package = resolve
        .packages
        .iter()
        .map(|(_, p)| p.name.to_string())
        .next()
        .expect("nessun package nel WIT");

    let iface_name = |key: &WorldKey, item: &WorldItem| -> Option<String> {
        match item {
            WorldItem::Interface { id, .. } => resolve.interfaces[*id]
                .name
                .clone()
                .or_else(|| Some(format!("{key:?}"))),
            _ => None,
        }
    };
    let worlds = resolve
        .worlds
        .iter()
        .map(|(_, w)| {
            (
                w.name.clone(),
                (
                    w.imports
                        .iter()
                        .filter_map(|(k, v)| iface_name(k, v))
                        .collect(),
                    w.exports
                        .iter()
                        .filter_map(|(k, v)| iface_name(k, v))
                        .collect(),
                ),
            )
        })
        .collect();

    Wit {
        types,
        functions,
        package,
        worlds,
        covered_types: BTreeSet::new(),
        covered_fns: BTreeMap::new(),
        errors: Vec::new(),
    }
}

/// Confronta due elenchi ordinati di `nome → tipo`, e dice tutto ciò che non
/// combacia: nomi assenti, nomi di troppo, tipi diversi, ordine diverso.
///
/// L'ordine conta: in un record è la disposizione canonica al confine, in un
/// variant è il discriminante. Un riordino è un cambio di ABI, non di stile.
fn diff(
    what: &str,
    owner: &str,
    expected: &[(String, Option<String>)],
    declared: &[(String, Option<String>)],
) -> Vec<String> {
    let mut errors = Vec::new();
    let names = |v: &[(String, Option<String>)]| -> Vec<String> {
        v.iter().map(|(n, _)| n.clone()).collect()
    };
    let exp_names: BTreeSet<String> = names(expected).into_iter().collect();
    let dec_names: BTreeSet<String> = names(declared).into_iter().collect();

    let missing: Vec<&String> = exp_names.difference(&dec_names).collect();
    if !missing.is_empty() {
        errors.push(format!("`{owner}`: {what} assenti dal WIT {missing:?}"));
    }
    let extra: Vec<&String> = dec_names.difference(&exp_names).collect();
    if !extra.is_empty() {
        errors.push(format!(
            "`{owner}`: {what} nel WIT ma ignoti all'abi {extra:?} (contratto morto?)"
        ));
    }

    let declared_ty: BTreeMap<&String, &Option<String>> =
        declared.iter().map(|(n, t)| (n, t)).collect();
    for (name, ty) in expected {
        let Some(got) = declared_ty.get(name) else {
            continue; // già segnalato come assente
        };
        if *got != ty {
            let fmt = |t: &Option<String>| t.clone().unwrap_or_else(|| "(nessun payload)".into());
            errors.push(format!(
                "`{owner}.{name}`: nel WIT è `{}`, nell'abi è `{}`",
                fmt(got),
                fmt(ty)
            ));
        }
    }

    if missing.is_empty() && extra.is_empty() && names(expected) != names(declared) {
        errors.push(format!(
            "`{owner}`: l'ordine dei {what} diverge — abi {:?}, WIT {:?} \
             (l'ordine è ABI: in un record è la disposizione, in un variant il discriminante)",
            names(expected),
            names(declared)
        ));
    }
    errors
}

/// Un caso di `variant`, con il tipo del payload e — se il payload è un record
/// dedicato — i suoi campi.
struct Case {
    name: &'static str,
    payload: Option<String>,
    fields: Option<Vec<(&'static str, String)>>,
}

/// Caso senza payload (`index-updated`, `none`).
fn case(name: &'static str) -> Case {
    Case {
        name,
        payload: None,
        fields: None,
    }
}

/// Caso con payload anonimo (`text(string)`, `emph(list<inline-ref>)`).
fn case_ty(name: &'static str, payload: String) -> Case {
    Case {
        name,
        payload: Some(payload),
        fields: None,
    }
}

/// Caso il cui payload è un record dedicato del WIT.
fn case_rec(name: &'static str, ty: &'static str, fields: Vec<(&'static str, String)>) -> Case {
    Case {
        name,
        payload: Some(ty.to_string()),
        fields: Some(fields),
    }
}

impl Wit {
    fn err(&mut self, msg: String) {
        self.errors.push(msg);
    }

    fn shape_of(&mut self, name: &str, atteso: &'static str) -> Option<&Shape> {
        self.covered_types.insert(name.to_string());
        let Some(decl) = self.types.get(name) else {
            self.errors
                .push(format!("`{name}` ({atteso}) manca dal WIT"));
            return None;
        };
        let got = decl.shape.kind();
        if got != atteso {
            self.errors.push(format!(
                "`{name}`: nel WIT è `{got}`, nell'abi è `{atteso}`"
            ));
            return None;
        }
        self.types.get(name).map(|d| &d.shape)
    }

    fn record(&mut self, name: &str, fields: &[(&'static str, String)]) {
        let expected: Vec<(String, Option<String>)> = fields
            .iter()
            .map(|(n, t)| (n.to_string(), Some(t.clone())))
            .collect();
        let Some(Shape::Record(declared)) = self.shape_of(name, "record") else {
            return;
        };
        let declared: Vec<(String, Option<String>)> = declared
            .iter()
            .map(|(n, t)| (n.clone(), Some(t.clone())))
            .collect();
        let errors = diff("campi", name, &expected, &declared);
        self.errors.extend(errors);
    }

    fn enumeration(&mut self, name: &str, cases: &[&str]) {
        let expected: Vec<(String, Option<String>)> =
            cases.iter().map(|c| (c.to_string(), None)).collect();
        let Some(Shape::Enum(declared)) = self.shape_of(name, "enum") else {
            return;
        };
        let declared: Vec<(String, Option<String>)> =
            declared.iter().map(|c| (c.clone(), None)).collect();
        let errors = diff("casi", name, &expected, &declared);
        self.errors.extend(errors);
    }

    fn variant(&mut self, name: &str, cases: &[Case]) {
        let expected: Vec<(String, Option<String>)> = cases
            .iter()
            .map(|c| (c.name.to_string(), c.payload.clone()))
            .collect();
        if let Some(Shape::Variant(declared)) = self.shape_of(name, "variant") {
            let declared = declared.clone();
            let errors = diff("casi", name, &expected, &declared);
            self.errors.extend(errors);
        }
        // I record di payload sono tipi a sé nel contratto: si verificano come
        // tali, altrimenti resterebbero "non rivendicati" alla fine.
        for c in cases {
            if let (Some(ty), Some(fields)) = (&c.payload, &c.fields) {
                self.record(ty, fields);
            }
        }
    }

    /// Un alias (`type doc-id = string`): qui il *tipo* è l'informazione, ed è
    /// ciò che tiene onesti gli indici dell'arena (`u32`) e la larghezza degli
    /// span al confine (`u64`).
    fn alias(&mut self, name: &str, target: String) {
        let Some(Shape::Alias(got)) = self.shape_of(name, "alias") else {
            return;
        };
        if *got != target {
            let got = got.clone();
            self.err(format!(
                "alias `{name}`: nel WIT è `{got}`, nell'abi è `{target}`"
            ));
        }
    }

    /// Un'interfaccia di soli tipi: dichiara che non ci si aspetta funzioni.
    fn types_only(&mut self, iface: &str) {
        self.covered_fns.entry(iface.to_string()).or_default();
    }

    /// Confronta la firma completa di una funzione con quella del metodo Rust
    /// da cui `f` è stato ricavato.
    ///
    /// `param_names` sono i nomi dei parametri nel WIT: i soli dati scritti a
    /// mano qui, perché il nome di un parametro non esiste a livello di tipo. I
    /// **tipi** vengono dal puntatore a funzione, e quello viene dal trait.
    fn method<F: WitFn>(&mut self, iface: &str, name: &str, _f: F, param_names: &[&str]) {
        self.covered_fns
            .entry(iface.to_string())
            .or_default()
            .insert(name.to_string());

        let rust = F::sig();
        assert_eq!(
            rust.params.len(),
            param_names.len(),
            "{iface}.{name}: la firma Rust ha {} parametri (host escluso) ma qui \
             sono stati nominati {} — è questo test da aggiornare",
            rust.params.len(),
            param_names.len()
        );

        let Some(sig) = self.functions.get(iface).and_then(|f| f.get(name)) else {
            self.err(format!("funzione `{iface}.{name}` assente dal WIT"));
            return;
        };
        let declared_params = sig.params.clone();
        let declared_result = sig.result.clone();

        // `host` non attraversa il confine: le capacità sono importate dal
        // world, non passate come argomento. Qui si verifica *sul metodo che ce
        // l'ha*, cioè dove una traduzione ingenua l'avrebbe tenuto; il
        // controllo generale (nessuna funzione, in nessuna interfaccia) è in
        // `finish`, e serve per le funzioni che questo test non nominasse.
        if rust.has_host {
            if let Some((n, t)) = declared_params.iter().find(|(n, _)| n == "host") {
                self.err(format!(
                    "funzione `{iface}.{name}`: il metodo Rust prende un `HostApi` e il WIT \
                     dichiara `{n}: {t}` — la capacità è importata dal world, va ELISA"
                ));
            }
        }

        let expected: Vec<(String, Option<String>)> = param_names
            .iter()
            .zip(&rust.params)
            .map(|(n, t)| (n.to_string(), Some(t.clone())))
            .collect();
        let declared: Vec<(String, Option<String>)> = declared_params
            .iter()
            .map(|(n, t)| (n.clone(), Some(t.clone())))
            .collect();
        let errors = diff(
            "parametri",
            &format!("{iface}.{name}"),
            &expected,
            &declared,
        );
        self.errors.extend(errors);

        if declared_result != rust.result {
            let fmt = |r: &Option<String>| r.clone().unwrap_or_else(|| "(nessuno)".into());
            self.err(format!(
                "funzione `{iface}.{name}`: risultato `{}` nel WIT, `{}` nell'abi",
                fmt(&declared_result),
                fmt(&rust.result)
            ));
        }
    }

    /// Direzione WIT→abi: ciò che il contratto dichiara e nessuno rivendica.
    fn finish(mut self) -> Result<(), String> {
        let declared: BTreeSet<String> = self.types.keys().cloned().collect();
        let orphan: Vec<&String> = declared.difference(&self.covered_types).collect();
        if !orphan.is_empty() {
            self.err(format!(
                "tipi dichiarati nel WIT e mai rivendicati dall'abi (contratto morto): {orphan:?}"
            ));
        }

        // Nessuna funzione, in nessuna interfaccia, può nominare un parametro
        // `host`: l'`HostApi` si importa, non si passa.
        let intrusi: Vec<String> = self
            .functions
            .iter()
            .flat_map(|(iface, sigs)| {
                sigs.iter()
                    .filter(|(_, sig)| sig.params.iter().any(|(p, _)| p == "host"))
                    .map(move |(name, _)| format!("{iface}.{name}"))
            })
            .collect();
        if !intrusi.is_empty() {
            self.err(format!(
                "funzioni del WIT con un parametro `host` {intrusi:?}: le capacità sono \
                 importate dal world (`import host-api`), non passate come argomento"
            ));
        }

        let ifaces: BTreeSet<String> = self.functions.keys().cloned().collect();
        let visited: BTreeSet<String> = self.covered_fns.keys().cloned().collect();
        let orphan: Vec<&String> = ifaces.difference(&visited).collect();
        if !orphan.is_empty() {
            self.err(format!("interfacce del WIT mai verificate qui: {orphan:?}"));
        }
        for (iface, sigs) in &self.functions {
            let Some(checked) = self.covered_fns.get(iface) else {
                continue;
            };
            let declared: BTreeSet<String> = sigs.keys().cloned().collect();
            let orphan: Vec<&String> = declared.difference(checked).collect();
            if !orphan.is_empty() {
                self.errors.push(format!(
                    "interfaccia `{iface}`: funzioni nel WIT ma ignote all'abi {orphan:?}"
                ));
            }
        }

        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(self.errors.join("\n  - "))
        }
    }
}

// ---------------------------------------------------------------------------
// Esaustività lato Rust: se un tipo abi cambia, questi non compilano più.
// ---------------------------------------------------------------------------

fn block_case(b: &arena::Block) -> Case {
    match b {
        arena::Block::Heading {
            level,
            inlines,
            span,
        } => case_rec(
            "heading",
            "block-heading",
            vec![
                ("level", wit(level)),
                ("inlines", wit(inlines)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::Paragraph { inlines, span } => case_rec(
            "paragraph",
            "block-paragraph",
            vec![("inlines", wit(inlines)), ("span", wit(span))],
        ),
        arena::Block::List {
            ordered,
            items,
            span,
        } => case_rec(
            "list",
            "block-list",
            vec![
                ("ordered", wit(ordered)),
                ("items", wit(items)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::CodeBlock { lang, code, span } => case_rec(
            "code-block",
            "block-code-block",
            vec![
                ("lang", wit(lang)),
                ("code", wit(code)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::Quote { blocks, span } => case_rec(
            "quote",
            "block-quote",
            vec![("blocks", wit(blocks)), ("span", wit(span))],
        ),
        arena::Block::ThematicBreak { span } => case_ty("thematic-break", wit(span)),
        arena::Block::Custom {
            custom_kind,
            attrs,
            blocks,
            span,
        } => case_rec(
            "custom",
            "block-custom",
            vec![
                ("custom-kind", wit(custom_kind)),
                ("attrs", wit(attrs)),
                ("blocks", wit(blocks)),
                ("span", wit(span)),
            ],
        ),
    }
}

fn inline_case(i: &arena::Inline) -> Case {
    match i {
        arena::Inline::Text(s) => case_ty("text", wit(s)),
        arena::Inline::Emph(v) => case_ty("emph", wit(v)),
        arena::Inline::Strong(v) => case_ty("strong", wit(v)),
        arena::Inline::Code(s) => case_ty("code", wit(s)),
        arena::Inline::Link {
            target,
            label,
            span,
        } => case_rec(
            "link",
            "inline-link",
            vec![
                ("target", wit(target)),
                ("label", wit(label)),
                ("span", wit(span)),
            ],
        ),
        arena::Inline::TagRef { name, span } => case_rec(
            "tag-ref",
            "inline-tag-ref",
            vec![("name", wit(name)), ("span", wit(span))],
        ),
        arena::Inline::Custom {
            custom_kind,
            attrs,
            span,
        } => case_rec(
            "custom",
            "inline-custom",
            vec![
                ("custom-kind", wit(custom_kind)),
                ("attrs", wit(attrs)),
                ("span", wit(span)),
            ],
        ),
    }
}

fn link_target_case(t: &LinkTarget) -> Case {
    match t {
        LinkTarget::Wiki {
            page,
            heading,
            block,
            embed,
        } => case_rec(
            "wiki",
            "link-target-wiki",
            vec![
                ("page", wit(page)),
                ("heading", wit(heading)),
                ("block", wit(block)),
                ("embed", wit(embed)),
            ],
        ),
        LinkTarget::Url(s) => case_ty("url", wit(s)),
        LinkTarget::Path(s) => case_ty("path", wit(s)),
    }
}

fn ui_node_case(n: &arena::UiNode) -> Case {
    match n {
        arena::UiNode::Stack { dir, gap, children } => case_rec(
            "stack",
            "ui-stack",
            vec![
                ("dir", wit(dir)),
                ("gap", wit(gap)),
                ("children", wit(children)),
            ],
        ),
        arena::UiNode::Text { content } => case_ty("text", wit(content)),
        arena::UiNode::Heading { level, content } => case_rec(
            "heading",
            "ui-heading",
            vec![("level", wit(level)), ("content", wit(content))],
        ),
        arena::UiNode::List { items } => case_ty("list", wit(items)),
        arena::UiNode::ListItem {
            title,
            subtitle,
            action,
        } => case_rec(
            "list-item",
            "ui-list-item",
            vec![
                ("title", wit(title)),
                ("subtitle", wit(subtitle)),
                ("action", wit(action)),
            ],
        ),
        arena::UiNode::Button {
            label,
            intent,
            action,
        } => case_rec(
            "button",
            "ui-button",
            vec![
                ("label", wit(label)),
                ("intent", wit(intent)),
                ("action", wit(action)),
            ],
        ),
        arena::UiNode::Html { html } => case_ty("html", wit(html)),
        arena::UiNode::WebView { url, height } => case_rec(
            "web-view",
            "ui-web-view",
            vec![("url", wit(url)), ("height", wit(height))],
        ),
    }
}

fn view_update_case(v: &ViewUpdate) -> Case {
    match v {
        // Il payload è l'arena `ui-tree`, non un record omonimo del caso.
        ViewUpdate::Replace { root } => case_ty("replace", wit(root)),
        ViewUpdate::None => case("none"),
        ViewUpdate::Navigate { doc_id } => case_ty("navigate", wit(doc_id)),
        ViewUpdate::Reveal { doc_id, span } => case_rec(
            "reveal",
            "view-update-reveal",
            vec![("doc-id", wit(doc_id)), ("span", wit(span))],
        ),
    }
}

fn event_case(e: &Event) -> Case {
    match e {
        Event::VaultOpened { root } => case_rec(
            "vault-opened",
            "event-vault-opened",
            vec![("root", wit(root))],
        ),
        Event::DocumentChanged { id } => case_rec(
            "document-changed",
            "event-document-changed",
            vec![("id", wit(id))],
        ),
        Event::DocumentRemoved { id } => case_rec(
            "document-removed",
            "event-document-removed",
            vec![("id", wit(id))],
        ),
        // `from` è keyword WIT: nel contratto è `%from`, e l'identificatore
        // dichiarato resta `from`. Il campo Rust non si rinomina per una
        // questione di sintassi altrui.
        Event::DocumentRenamed { from, to } => case_rec(
            "document-renamed",
            "event-document-renamed",
            vec![("from", wit(from)), ("to", wit(to))],
        ),
        Event::IndexUpdated => case("index-updated"),
        // idem per `result` (`%result` nel WIT).
        Event::JobDone { id, job, result } => case_rec(
            "job-done",
            "event-job-done",
            vec![("id", wit(id)), ("job", wit(job)), ("result", wit(result))],
        ),
        Event::Overflow { dropped } => case_rec(
            "overflow",
            "event-overflow",
            vec![("dropped", wit(dropped))],
        ),
        Event::Custom { topic, payload } => case_rec(
            "custom",
            "event-custom",
            vec![("topic", wit(topic)), ("payload", wit(payload))],
        ),
    }
}

fn event_kind_name(k: EventKind) -> &'static str {
    match k {
        EventKind::VaultOpened => "vault-opened",
        EventKind::DocumentChanged => "document-changed",
        EventKind::DocumentRemoved => "document-removed",
        EventKind::DocumentRenamed => "document-renamed",
        EventKind::IndexUpdated => "index-updated",
        EventKind::JobDone => "job-done",
        EventKind::Overflow => "overflow",
        EventKind::Custom => "custom",
    }
}

fn index_query_case(q: &IndexQuery) -> Case {
    match q {
        IndexQuery::Backlinks { target } => case_ty("backlinks", wit(target)),
        IndexQuery::FullText { query, limit } => case_rec(
            "full-text",
            "index-query-full-text",
            vec![("query", wit(query)), ("limit", wit(limit))],
        ),
        IndexQuery::Outline { doc } => case_ty("outline", wit(doc)),
        IndexQuery::Custom { ns, query } => case_rec(
            "custom",
            "index-query-custom",
            vec![("ns", wit(ns)), ("query", wit(query))],
        ),
    }
}

fn index_result_case(r: &IndexResult) -> Case {
    match r {
        IndexResult::Backlinks(v) => case_ty("backlinks", wit(v)),
        IndexResult::Search(v) => case_ty("search", wit(v)),
        IndexResult::Outline(v) => case_ty("outline", wit(v)),
        IndexResult::Custom(v) => case_ty("custom", wit(v)),
    }
}

fn format_error_case(e: &FormatError) -> Case {
    match e {
        FormatError::Parse(s) => case_ty("parse", wit(s)),
        FormatError::Render(s) => case_ty("render", wit(s)),
        FormatError::Serialize(s) => case_ty("serialize", wit(s)),
        FormatError::Unsupported(s) => case_ty("unsupported", wit(s)),
    }
}

fn plugin_error_case(e: &PluginError) -> Case {
    match e {
        PluginError::UnknownCommand(s) => case_ty("unknown-command", wit(s)),
        PluginError::UnknownView(s) => case_ty("unknown-view", wit(s)),
        PluginError::UnknownJob(s) => case_ty("unknown-job", wit(s)),
        PluginError::BadArgs(s) => case_ty("bad-args", wit(s)),
        PluginError::PermissionDenied(s) => case_ty("permission-denied", wit(s)),
        PluginError::Internal(s) => case_ty("internal", wit(s)),
    }
}

fn axis_name(a: Axis) -> &'static str {
    match a {
        Axis::Row => "row",
        Axis::Column => "column",
    }
}

fn intent_name(i: Intent) -> &'static str {
    match i {
        Intent::Neutral => "neutral",
        Intent::Primary => "primary",
        Intent::Danger => "danger",
    }
}

fn view_placement_name(p: ViewPlacement) -> &'static str {
    match p {
        ViewPlacement::LeftSidebar => "left-sidebar",
        ViewPlacement::RightSidebar => "right-sidebar",
        ViewPlacement::Bottom => "bottom",
    }
}

// ---------------------------------------------------------------------------
// Il confronto vero e proprio
// ---------------------------------------------------------------------------

/// Applica al WIT tutte le asserzioni derivate dall'abi. Separata dal test così
/// che `wit_conformance_actually_fails_on_drift` possa passarle un contratto
/// alterato ad arte e verificare che diventi rossa.
fn conform(source: &str) -> Result<(), String> {
    let mut contract = load(source);

    assert_eq!(contract.package, "fubmd:abi@0.1.0", "nome del package");

    // --- variant/enum: un rappresentante per caso, esaustività dal compilatore

    let sp = arena::Span::default();
    contract.variant(
        "block",
        &[
            block_case(&arena::Block::Heading {
                level: 1,
                inlines: vec![],
                span: sp,
            }),
            block_case(&arena::Block::Paragraph {
                inlines: vec![],
                span: sp,
            }),
            block_case(&arena::Block::List {
                ordered: false,
                items: vec![],
                span: sp,
            }),
            block_case(&arena::Block::CodeBlock {
                lang: None,
                code: String::new(),
                span: sp,
            }),
            block_case(&arena::Block::Quote {
                blocks: vec![],
                span: sp,
            }),
            block_case(&arena::Block::ThematicBreak { span: sp }),
            block_case(&arena::Block::Custom {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                blocks: vec![],
                span: sp,
            }),
        ],
    );

    contract.variant(
        "inline",
        &[
            inline_case(&arena::Inline::Text(String::new())),
            inline_case(&arena::Inline::Emph(vec![])),
            inline_case(&arena::Inline::Strong(vec![])),
            inline_case(&arena::Inline::Code(String::new())),
            inline_case(&arena::Inline::Link {
                target: LinkTarget::wiki("p"),
                label: None,
                span: sp,
            }),
            inline_case(&arena::Inline::TagRef {
                name: String::new(),
                span: sp,
            }),
            inline_case(&arena::Inline::Custom {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                span: sp,
            }),
        ],
    );

    contract.variant(
        "link-target",
        &[
            link_target_case(&LinkTarget::wiki("p")),
            link_target_case(&LinkTarget::Url(String::new())),
            link_target_case(&LinkTarget::Path(String::new())),
        ],
    );

    contract.variant(
        "ui-node",
        &[
            ui_node_case(&arena::UiNode::Stack {
                dir: Axis::Row,
                gap: 0,
                children: vec![],
            }),
            ui_node_case(&arena::UiNode::Text {
                content: String::new(),
            }),
            ui_node_case(&arena::UiNode::Heading {
                level: 1,
                content: String::new(),
            }),
            ui_node_case(&arena::UiNode::List { items: vec![] }),
            ui_node_case(&arena::UiNode::ListItem {
                title: String::new(),
                subtitle: None,
                action: None,
            }),
            ui_node_case(&arena::UiNode::Button {
                label: String::new(),
                intent: Intent::Neutral,
                action: ActionId(String::new()),
            }),
            ui_node_case(&arena::UiNode::Html {
                html: String::new(),
            }),
            ui_node_case(&arena::UiNode::WebView {
                url: String::new(),
                height: 0,
            }),
        ],
    );

    contract.variant(
        "view-update",
        &[
            view_update_case(&ViewUpdate::Replace {
                root: UiNode::Text {
                    content: String::new(),
                },
            }),
            view_update_case(&ViewUpdate::None),
            view_update_case(&ViewUpdate::Navigate {
                doc_id: String::new(),
            }),
            view_update_case(&ViewUpdate::Reveal {
                doc_id: String::new(),
                span: Span::new(0, 0),
            }),
        ],
    );

    contract.variant(
        "event",
        &[
            event_case(&Event::VaultOpened {
                root: String::new(),
            }),
            event_case(&Event::DocumentChanged {
                id: DocId::new("a"),
            }),
            event_case(&Event::DocumentRemoved {
                id: DocId::new("a"),
            }),
            event_case(&Event::DocumentRenamed {
                from: DocId::new("a"),
                to: DocId::new("b"),
            }),
            event_case(&Event::IndexUpdated),
            event_case(&Event::JobDone {
                id: JobId(0),
                job: String::new(),
                result: Ok(serde_json::Value::Null),
            }),
            event_case(&Event::Overflow { dropped: 0 }),
            event_case(&Event::Custom {
                topic: String::new(),
                payload: serde_json::Value::Null,
            }),
        ],
    );

    contract.variant(
        "index-query",
        &[
            index_query_case(&IndexQuery::Backlinks {
                target: DocId::new("a"),
            }),
            index_query_case(&IndexQuery::FullText {
                query: String::new(),
                limit: 0,
            }),
            index_query_case(&IndexQuery::Outline {
                doc: DocId::new("a"),
            }),
            index_query_case(&IndexQuery::Custom {
                ns: String::new(),
                query: serde_json::Value::Null,
            }),
        ],
    );

    contract.variant(
        "index-result",
        &[
            index_result_case(&IndexResult::Backlinks(vec![])),
            index_result_case(&IndexResult::Search(vec![])),
            index_result_case(&IndexResult::Outline(vec![])),
            index_result_case(&IndexResult::Custom(serde_json::Value::Null)),
        ],
    );

    contract.variant(
        "format-error",
        &[
            format_error_case(&FormatError::Parse(String::new())),
            format_error_case(&FormatError::Render(String::new())),
            format_error_case(&FormatError::Serialize(String::new())),
            format_error_case(&FormatError::Unsupported(String::new())),
        ],
    );

    contract.variant(
        "plugin-error",
        &[
            plugin_error_case(&PluginError::UnknownCommand(String::new())),
            plugin_error_case(&PluginError::UnknownView(String::new())),
            plugin_error_case(&PluginError::UnknownJob(String::new())),
            plugin_error_case(&PluginError::BadArgs(String::new())),
            plugin_error_case(&PluginError::PermissionDenied(String::new())),
            plugin_error_case(&PluginError::Internal(String::new())),
        ],
    );

    contract.enumeration(
        "event-kind",
        [
            EventKind::VaultOpened,
            EventKind::DocumentChanged,
            EventKind::DocumentRemoved,
            EventKind::DocumentRenamed,
            EventKind::IndexUpdated,
            EventKind::JobDone,
            EventKind::Overflow,
            EventKind::Custom,
        ]
        .map(event_kind_name)
        .as_slice(),
    );
    contract.enumeration("axis", [Axis::Row, Axis::Column].map(axis_name).as_slice());
    contract.enumeration(
        "intent",
        [Intent::Neutral, Intent::Primary, Intent::Danger]
            .map(intent_name)
            .as_slice(),
    );
    contract.enumeration(
        "view-placement",
        [
            ViewPlacement::LeftSidebar,
            ViewPlacement::RightSidebar,
            ViewPlacement::Bottom,
        ]
        .map(view_placement_name)
        .as_slice(),
    );

    // --- record: destructuring esaustivo, un campo aggiunto non compila; e il
    //     tipo atteso lo deduce il compilatore dal campo stesso.

    let DocumentModel {
        id,
        frontmatter,
        body,
        outline,
        links,
        tags,
        text,
    } = DocumentModel::empty(DocId::new("x.md"));
    contract.record(
        "document-model",
        &[
            ("id", wit(&id)),
            ("frontmatter", wit(&frontmatter)),
            // L'unico campo la cui forma al confine non è quella del suo tipo:
            // l'albero diventa l'arena intera.
            ("body", wit_tree(&body)),
            ("outline", wit(&outline)),
            ("links", wit(&links)),
            ("tags", wit(&tags)),
            ("text", wit(&text)),
        ],
    );

    // Lo `span` del WIT è quello del confine (`u64`), non quello nativo
    // (`usize`): la divergenza è deliberata e vive in `arena`, con le sue
    // conversioni e i suoi test.
    let arena::Span { start, end } = arena::Span::default();
    contract.record("span", &[("start", wit(&start)), ("end", wit(&end))]);

    let Heading {
        level,
        text,
        slug,
        span,
    } = Heading {
        level: 1,
        text: String::new(),
        slug: String::new(),
        span: Span::EMPTY,
    };
    contract.record(
        "heading",
        &[
            ("level", wit(&level)),
            ("text", wit(&text)),
            ("slug", wit(&slug)),
            ("span", wit(&span)),
        ],
    );

    let Tag { name, span } = Tag {
        name: String::new(),
        span: Span::EMPTY,
    };
    contract.record("tag", &[("name", wit(&name)), ("span", wit(&span))]);

    let Link {
        target,
        span,
        context,
    } = Link {
        target: LinkTarget::wiki("p"),
        span: Span::EMPTY,
        context: None,
    };
    contract.record(
        "link",
        &[
            ("target", wit(&target)),
            ("span", wit(&span)),
            ("context", wit(&context)),
        ],
    );

    let arena::DocumentTree {
        blocks,
        inlines,
        roots,
    } = arena::DocumentTree::default();
    contract.record(
        "document-tree",
        &[
            ("blocks", wit(&blocks)),
            ("inlines", wit(&inlines)),
            ("roots", wit(&roots)),
        ],
    );

    let arena::UiTree { nodes, root } = arena::UiTree {
        nodes: Vec::new(),
        root: UiRef(0),
    };
    contract.record("ui-tree", &[("nodes", wit(&nodes)), ("root", wit(&root))]);

    let FormatDescriptor {
        id,
        name,
        extensions,
    } = FormatDescriptor {
        id: String::new(),
        name: String::new(),
        extensions: vec![],
    };
    contract.record(
        "format-descriptor",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("extensions", wit(&extensions)),
        ],
    );

    let FormatCapabilities {
        wikilinks,
        tags,
        frontmatter,
        callouts,
        embeds,
    } = FormatCapabilities::default();
    contract.record(
        "format-capabilities",
        &[
            ("wikilinks", wit(&wikilinks)),
            ("tags", wit(&tags)),
            ("frontmatter", wit(&frontmatter)),
            ("callouts", wit(&callouts)),
            ("embeds", wit(&embeds)),
        ],
    );

    let ParseContext {
        doc_id,
        parse_tags,
        parse_wikilinks,
    } = ParseContext::default();
    contract.record(
        "parse-context",
        &[
            ("doc-id", wit(&doc_id)),
            ("parse-tags", wit(&parse_tags)),
            ("parse-wikilinks", wit(&parse_wikilinks)),
        ],
    );

    let RenderOptions {
        wikilinks_as_data_attrs,
    } = RenderOptions::default();
    contract.record(
        "render-options",
        &[("wikilinks-as-data-attrs", wit(&wikilinks_as_data_attrs))],
    );

    let CommandSpec {
        id,
        title,
        keybinding,
    } = CommandSpec {
        id: String::new(),
        title: String::new(),
        keybinding: None,
    };
    contract.record(
        "command-spec",
        &[
            ("id", wit(&id)),
            ("title", wit(&title)),
            ("keybinding", wit(&keybinding)),
        ],
    );

    let CommandOutcome { notify } = CommandOutcome { notify: None };
    contract.record("command-outcome", &[("notify", wit(&notify))]);

    let ViewSpec {
        id,
        title,
        placement,
    } = ViewSpec {
        id: String::new(),
        title: String::new(),
        placement: ViewPlacement::Bottom,
    };
    contract.record(
        "view-spec",
        &[
            ("id", wit(&id)),
            ("title", wit(&title)),
            ("placement", wit(&placement)),
        ],
    );

    let BacklinkRef { source, context } = BacklinkRef {
        source: DocId::new("a"),
        context: None,
    };
    contract.record(
        "backlink-ref",
        &[("source", wit(&source)), ("context", wit(&context))],
    );

    let SearchHit {
        doc,
        score,
        snippet,
        highlights,
    } = SearchHit {
        doc: DocId::new("a"),
        score: 0.0,
        snippet: String::new(),
        highlights: Vec::new(),
    };
    contract.record(
        "search-hit",
        &[
            ("doc", wit(&doc)),
            // La larghezza di un punteggio è parte del contratto: era il caso
            // che il vecchio confronto per soli nomi non avrebbe visto.
            ("score", wit(&score)),
            ("snippet", wit(&snippet)),
            ("highlights", wit(&highlights)),
        ],
    );

    let UiAction { action, payload } = UiAction {
        action: ActionId(String::new()),
        payload: serde_json::Value::Null,
    };
    contract.record(
        "ui-action",
        &[("action", wit(&action)), ("payload", wit(&payload))],
    );

    let PluginPermissions {
        read_vault,
        write_vault,
        network,
    } = PluginPermissions::default();
    contract.record(
        "plugin-permissions",
        &[
            ("read-vault", wit(&read_vault)),
            ("write-vault", wit(&write_vault)),
            ("network", wit(&network)),
        ],
    );

    let PluginManifest {
        id,
        name,
        version,
        permissions,
    } = PluginManifest {
        id: String::new(),
        name: String::new(),
        version: String::new(),
        permissions: PluginPermissions::default(),
    };
    contract.record(
        "plugin-manifest",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("version", wit(&version)),
            ("permissions", wit(&permissions)),
        ],
    );

    let JobSpec { job, payload } = JobSpec {
        job: String::new(),
        payload: serde_json::Value::Null,
    };
    contract.record(
        "job-spec",
        &[("job", wit(&job)), ("payload", wit(&payload))],
    );

    // --- alias: la destinazione è dedotta dal tipo interno del newtype

    let DocId(path) = DocId::new("a");
    contract.alias("doc-id", wit(&path));

    let Frontmatter(map) = Frontmatter::default();
    contract.alias("frontmatter", wit(&map));

    let ActionId(raw) = ActionId(String::new());
    contract.alias("action-id", wit(&raw));

    let JobId(raw) = JobId(0);
    contract.alias("job-id", wit(&raw));

    let EventMask(kinds) = EventMask::all();
    contract.alias("event-mask", wit(&kinds));

    let BlockRef(raw) = BlockRef::default();
    contract.alias("block-ref", wit(&raw));
    let InlineRef(raw) = InlineRef::default();
    contract.alias("inline-ref", wit(&raw));
    let UiRef(raw) = UiRef::default();
    contract.alias("ui-ref", wit(&raw));

    // Il JSON libero attraversa il confine come stringa: è l'unico alias senza
    // controparte Rust, ed è la scelta deliberata dell'escape hatch.
    contract.alias("json", "string".to_string());

    // --- funzioni: firme complete, ricavate dai metodi dei trait
    //
    // Ogni riga fa due cose: il cast vincola la firma scritta a quella del
    // trait (se il trait cambia, non compila), e da quella firma si deducono i
    // tipi attesi nel WIT. `host` compare a sinistra e non a destra: è l'unica
    // verifica dell'elisione.

    contract.types_only("json");
    contract.types_only("model");
    contract.types_only("ui");
    contract.types_only("jobs");
    contract.types_only("events");
    contract.types_only("errors");

    contract.method(
        "format",
        "descriptor",
        <dyn FormatProvider>::descriptor as fn(&'static dyn FormatProvider) -> FormatDescriptor,
        &[],
    );
    contract.method(
        "format",
        "capabilities",
        <dyn FormatProvider>::capabilities as fn(&'static dyn FormatProvider) -> FormatCapabilities,
        &[],
    );
    contract.method(
        "format",
        "parse",
        <dyn FormatProvider>::parse
            as fn(
                &'static dyn FormatProvider,
                &'static str,
                &'static ParseContext,
            ) -> Result<DocumentModel, FormatError>,
        &["source", "ctx"],
    );
    contract.method(
        "format",
        "render-html",
        <dyn FormatProvider>::render_html
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentModel,
                &'static RenderOptions,
            ) -> Result<String, FormatError>,
        &["model", "opts"],
    );
    contract.method(
        "format",
        "serialize",
        <dyn FormatProvider>::serialize
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentModel,
            ) -> Result<String, FormatError>,
        &["model"],
    );

    contract.method(
        "command",
        "commands",
        <dyn CommandProvider>::commands as fn(&'static dyn CommandProvider) -> Vec<CommandSpec>,
        &[],
    );
    contract.method(
        "command",
        "invoke",
        <dyn CommandProvider>::invoke
            as fn(
                &'static dyn CommandProvider,
                &'static str,
                serde_json::Value,
                Host,
            ) -> Result<CommandOutcome, PluginError>,
        &["command", "args"],
    );

    contract.method(
        "view",
        "views",
        <dyn ViewProvider>::views as fn(&'static dyn ViewProvider) -> Vec<ViewSpec>,
        &[],
    );
    contract.method(
        "view",
        "render-view",
        <dyn ViewProvider>::render_view
            as fn(&'static dyn ViewProvider, &'static str, HostRef) -> Result<UiNode, PluginError>,
        &["view"],
    );
    contract.method(
        "view",
        "on-action",
        <dyn ViewProvider>::on_action
            as fn(
                &'static dyn ViewProvider,
                &'static str,
                UiAction,
                Host,
            ) -> Result<ViewUpdate, PluginError>,
        &["view", "action"],
    );

    contract.method(
        "index",
        "activate",
        <dyn IndexProvider>::activate
            as fn(&'static mut dyn IndexProvider, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "index",
        "on-document-indexed",
        <dyn IndexProvider>::on_document_indexed
            as fn(&'static mut dyn IndexProvider, &'static DocumentModel),
        &["doc"],
    );
    contract.method(
        "index",
        "on-document-removed",
        <dyn IndexProvider>::on_document_removed
            as fn(&'static mut dyn IndexProvider, &'static DocId),
        &["id"],
    );
    contract.method(
        "index",
        "reconcile",
        <dyn IndexProvider>::reconcile as fn(&'static mut dyn IndexProvider, &'static [DocId]),
        &["ids"],
    );
    contract.method(
        "index",
        "flush",
        <dyn IndexProvider>::flush
            as fn(&'static mut dyn IndexProvider, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "index",
        "query",
        <dyn IndexProvider>::query
            as fn(&'static dyn IndexProvider, IndexQuery) -> Result<IndexResult, PluginError>,
        &["query"],
    );

    contract.method(
        "host-api",
        "read-document",
        <dyn HostApi>::read_document
            as fn(&'static dyn HostApi, &'static DocId) -> Result<String, PluginError>,
        &["id"],
    );
    contract.method(
        "host-api",
        "write-document",
        <dyn HostApi>::write_document
            as fn(Host, &'static DocId, &'static str) -> Result<(), PluginError>,
        &["id", "source"],
    );
    contract.method(
        "host-api",
        "list-documents",
        <dyn HostApi>::list_documents
            as fn(&'static dyn HostApi) -> Result<Vec<DocId>, PluginError>,
        &[],
    );
    contract.method(
        "host-api",
        "emit",
        <dyn HostApi>::emit as fn(Host, Event),
        &["event"],
    );
    contract.method(
        "host-api",
        "spawn-job",
        <dyn HostApi>::spawn_job as fn(Host, JobSpec) -> Result<JobId, PluginError>,
        &["spec"],
    );
    contract.method(
        "host-api",
        "storage-get",
        <dyn HostApi>::storage_get
            as fn(&'static dyn HostApi, &'static str) -> Option<serde_json::Value>,
        &["key"],
    );
    contract.method(
        "host-api",
        "storage-set",
        <dyn HostApi>::storage_set as fn(Host, &'static str, serde_json::Value),
        &["key", "value"],
    );
    contract.method(
        "host-api",
        "data-read",
        <dyn HostApi>::data_read
            as fn(&'static dyn HostApi, &'static str) -> Result<Option<Vec<u8>>, PluginError>,
        &["path"],
    );
    contract.method(
        "host-api",
        "data-write",
        <dyn HostApi>::data_write
            as fn(Host, &'static str, &'static [u8]) -> Result<(), PluginError>,
        &["path", "bytes"],
    );
    contract.method(
        "host-api",
        "data-remove",
        <dyn HostApi>::data_remove as fn(Host, &'static str) -> Result<(), PluginError>,
        &["path"],
    );
    contract.method(
        "host-api",
        "data-list",
        <dyn HostApi>::data_list
            as fn(&'static dyn HostApi, &'static str) -> Result<Vec<String>, PluginError>,
        &["prefix"],
    );
    contract.method(
        "host-api",
        "now-unix-millis",
        <dyn HostApi>::now_unix_millis as fn(&'static dyn HostApi) -> u64,
        &[],
    );
    contract.method(
        "host-api",
        "query-index",
        <dyn HostApi>::query_index
            as fn(&'static dyn HostApi, IndexQuery) -> Result<IndexResult, PluginError>,
        &["query"],
    );
    contract.method(
        "host-api",
        "active-document",
        <dyn HostApi>::active_document as fn(&'static dyn HostApi) -> Option<DocId>,
        &[],
    );

    contract.method(
        "event-handler",
        "subscribed",
        <dyn EventHandler>::subscribed as fn(&'static dyn EventHandler) -> EventMask,
        &[],
    );
    contract.method(
        "event-handler",
        "handle",
        <dyn EventHandler>::handle
            as fn(&'static mut dyn EventHandler, &'static Event, Host) -> Result<(), PluginError>,
        &["event"],
    );

    contract.method(
        "plugin",
        "manifest",
        <dyn Plugin>::manifest as fn(&'static dyn Plugin) -> PluginManifest,
        &[],
    );
    contract.method(
        "plugin",
        "activate",
        <dyn Plugin>::activate as fn(&'static mut dyn Plugin, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "plugin",
        "deactivate",
        <dyn Plugin>::deactivate as fn(&'static mut dyn Plugin, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "plugin",
        "run-job",
        <dyn Plugin>::run_job
            as fn(
                &'static dyn Plugin,
                &'static str,
                serde_json::Value,
            ) -> Result<serde_json::Value, PluginError>,
        &["job", "payload"],
    );

    // --- il world

    let (imports, exports) = contract
        .worlds
        .get("plugin-world")
        .cloned()
        .expect("world `plugin-world` assente dal WIT");
    assert!(
        imports.contains("host-api"),
        "`plugin-world` deve importare host-api, importa {imports:?}"
    );
    let expected_exports: BTreeSet<String> = [
        "plugin",
        "format",
        "command",
        "view",
        "index",
        "event-handler",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(
        exports, expected_exports,
        "interfacce esportate da `plugin-world`"
    );

    contract.finish()
}

fn wit_source() -> String {
    std::fs::read_to_string(WIT_PATH)
        .unwrap_or_else(|e| panic!("impossibile leggere {WIT_PATH}: {e}"))
}

#[test]
fn abi_types_are_mirrored_in_wit() {
    if let Err(report) = conform(&wit_source()) {
        panic!("abi e wit/fubmd/abi.wit divergono:\n  - {report}");
    }
}

/// La forma al confine è quella di `arena`, non quella nativa: questo test lo
/// mette per iscritto, perché è la divergenza deliberata più facile da
/// dimenticare (e la sola presidiata da conversioni con dei test propri).
#[test]
fn the_boundary_shape_of_a_span_is_wider_than_the_native_one() {
    assert_eq!(wit_of::<arena::Span>(), "span");
    assert_eq!(wit_of::<Span>(), "span", "lo stesso record, due viste");
    assert!(
        std::mem::size_of::<usize>() <= std::mem::size_of::<u64>(),
        "il nativo non può essere più largo del confine: `usize`→`u64` deve \
         restare la direzione che non fallisce mai"
    );
}

// ---------------------------------------------------------------------------
// Il test del test (criterio di accettazione di M4)
// ---------------------------------------------------------------------------

/// Un test di conformità che non sa fallire non è un test. Qui si introducono
/// divergenze ad arte — una per ciascuna cosa che il test dovrebbe vedere — e si
/// pretende il rosso.
#[test]
fn wit_conformance_actually_fails_on_drift() {
    let base = wit_source();

    let cases: &[(&str, String, &str)] = &[
        (
            "campo rinominato nel WIT",
            base.replace("slug: string,", "slugg: string,"),
            "slug",
        ),
        (
            "caso di variant rimosso dal WIT",
            base.replace("        thematic-break(span),\n", ""),
            "thematic-break",
        ),
        (
            "funzione rimossa da host-api",
            base.replace("    now-unix-millis: func() -> u64;", ""),
            "now-unix-millis",
        ),
        (
            "tipo in più nel WIT che l'abi non rivendica",
            base.replace(
                "interface errors {",
                "interface errors {\n    record contratto-morto { x: u32 }",
            ),
            "contratto-morto",
        ),
        (
            "alias con la larghezza sbagliata",
            base.replace("    type block-ref = u32;", "    type block-ref = u64;"),
            "block-ref",
        ),
        // --- da qui in poi: ciò che il confronto per soli nomi non vedeva
        (
            "tipo di un campo cambiato (la larghezza di un punteggio)",
            base.replace("        score: f32,", "        score: f64,"),
            "score",
        ),
        (
            "tipo di un campo cambiato in un record annidato",
            base.replace("        highlights: list<span>,", "        highlights: list<string>,"),
            "highlights",
        ),
        (
            "payload di un caso di variant cambiato",
            base.replace("        thematic-break(span),", "        thematic-break(string),"),
            "thematic-break",
        ),
        (
            "risultato di una funzione cambiato",
            base.replace("    now-unix-millis: func() -> u64;", "    now-unix-millis: func() -> u32;"),
            "now-unix-millis",
        ),
        (
            "tipo di un parametro cambiato",
            base.replace(
                "    write-document: func(id: doc-id, source: string) -> result<_, plugin-error>;",
                "    write-document: func(id: doc-id, source: list<u8>) -> result<_, plugin-error>;",
            ),
            "source",
        ),
        (
            "parametro rinominato",
            base.replace(
                "    query: func(query: index-query) -> result<index-result, plugin-error>;",
                "    query: func(q: index-query) -> result<index-result, plugin-error>;",
            ),
            "query",
        ),
        (
            "l'host NON è eliso: riappare come parametro",
            base.replace(
                "    reconcile: func(ids: list<doc-id>);",
                "    reconcile: func(host: string, ids: list<doc-id>);",
            ),
            "host",
        ),
        (
            "campi di un record riordinati (è un cambio di ABI)",
            base.replace(
                "    record span {\n        start: u64,\n        end: u64,\n    }",
                "    record span {\n        end: u64,\n        start: u64,\n    }",
            ),
            "ordine",
        ),
        (
            "casi di un enum riordinati (cambia il discriminante)",
            base.replace(
                "enum intent { neutral, primary, danger }",
                "enum intent { primary, neutral, danger }",
            ),
            "ordine",
        ),
    ];

    for (what, mutated, needle) in cases {
        assert_ne!(&base, mutated, "la mutazione «{what}» non ha toccato nulla");
        let report = conform(mutated).expect_err(&format!(
            "«{what}» non ha fatto fallire il test di conformità"
        ));
        assert!(
            report.contains(needle),
            "«{what}»: il report non nomina `{needle}`:\n{report}"
        );
    }
}

/// E un WIT che non parsa deve morire subito, non passare per verde.
#[test]
#[should_panic(expected = "non è un WIT valido")]
fn invalid_wit_is_not_silently_accepted() {
    // `list` senza escape: com'era il contratto prima del piano di aggiustamento.
    let broken = wit_source().replace("        %list(block-list),", "        list(block-list),");
    let _ = conform(&broken);
}
