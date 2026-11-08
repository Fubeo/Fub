//! Additività del contratto — il presidio della promessa del freeze (M4).
//!
//! `wit_conformance.rs` verifica che `fub-abi` e `wit/fub/abi.wit` dicano la
//! stessa cosa — **oggi**, fra di loro. Questo test verifica l'altra promessa,
//! quella su cui poggia tutto il §1 del piano: *il contratto cresce solo per
//! aggiunta*. Sono due invarianti diverse e nessuna implica l'altra: si può
//! rinominare un campo in Rust **e** nel WIT, restare conformi, e aver rotto
//! ogni plugin già compilato.
//!
//! # Perché serve un file in più e non basta `abi_compatible`
//!
//! [`fub_abi::traits::abi_compatible`] applica la regola a runtime: major
//! diversa → rifiuto, minor del plugin ≤ minor dell'host → accetto. È la rete di
//! sicurezza, e nel caso che conta dice **sì**: una variante rimossa o un campo
//! rinominato non cambiano la minor, quindi `abi_compatible` accetta il plugin e
//! poi il confine si rompe a valle. Il costo è asimmetrico — la build del repo
//! resta verde, a rompersi sono i plugin di terzi, dopo il rilascio.
//!
//! Qui la promessa diventa meccanica: in `wit/frozen/` c'è una **copia del
//! contratto per ogni versione**, e il contratto attuale deve poter servire
//! ognuna di quelle di cui `abi_compatible` direbbe di sì (stessa major, minor
//! non superiore alla propria).
//!
//! # Cosa conta come "aggiunta"
//!
//! Non "il file è cresciuto": la forma di ogni cosa già pubblicata deve essere
//! **intatta e nella stessa posizione**. Il nuovo, nel confine, sta in
//! un'interfaccia nuova; fuori dal confine può stare solo *in coda*.
//!
//! Contro `0.2.0` e dopo (vedi sotto per le 0.1.x):
//!
//! | costrutto | additivo | rotto |
//! |---|---|---|
//! | `record` del confine | — | un campo nuovo, anche in fondo; rinominare, ritipare, riordinare, togliere |
//! | `variant` / `enum` / `flags` del confine | — | un caso nuovo, anche in fondo; rinominare, riordinare, togliere |
//! | `record` / `variant` / `enum` / `flags` che non attraversa | un campo o un caso **in fondo** | il resto, come sopra |
//! | `type x = …` (alias) | — | qualunque cambio di destinazione |
//! | funzione di un'interfaccia che il plugin **importa** | una funzione **nuova** | cambiare parametri o risultato, toglierla |
//! | funzione di un'interfaccia che il plugin **esporta** | — | una funzione nuova; cambiare parametri o risultato, toglierla |
//! | interfaccia | un'interfaccia **nuova** | toglierne una, o spostarci dentro un tipo |
//! | `world` | un import/export in più | toglierne uno |
//!
//! # Il confine non cresce (da 0.2.0)
//!
//! Il campo in coda e il caso in coda erano ammessi perché si credevano
//! additivi. Non lo sono: wasmtime, quando istanzia un plugin, controlla per
//! intero il tipo di ogni funzione che il plugin importa ed esporta. Un record
//! deve avere esattamente i campi, un `enum`, un `variant` o un `flags`
//! esattamente i casi, nello stesso ordine; un'interfaccia esportata deve
//! avere ogni funzione che l'host conosce. Un plugin compilato contro la forma
//! più corta non si istanzia (ADR 0235 per i record, ADR 0238 per il resto;
//! prove con componenti veri in
//! `crates/fub-wasm-host/tests/published_record_does_not_grow.rs` e
//! `crates/fub-wasm-host/tests/new_case_and_function.rs`). Una funzione in
//! più in un'interfaccia che il plugin importa, invece, il plugin non la
//! chiede e nessuno la controlla: quella resta un'aggiunta.
//!
//! Il `flags` segue l'`enum` perché wasmtime lo controlla allo stesso modo,
//! confrontando l'elenco dei nomi (`typecheck_flags`, «expected flags type
//! with N names»): un bit in più è un tipo diverso, come un caso in più.
//!
//! Per questo la regola dipende dallo **snapshot** contro cui si confronta
//! ([`BoundaryRule::for_snapshot`]):
//!
//! - contro `0.1.0` e `0.1.1` resta il prefisso di allora (il campo e il caso
//!   in coda passano): sono le regole con cui quelle versioni sono state
//!   congelate, e non si riscrivono a posteriori;
//! - contro `0.2.0` e ogni versione dopo, un record, `variant`, `enum` o
//!   `flags` che **attraversa il confine** ha gli stessi campi o casi, nello
//!   stesso ordine, e un'interfaccia esportata dal plugin ha le stesse
//!   funzioni: niente prefisso, niente eccezioni.
//!
//! «Attraversa il confine» non è un'etichetta scritta a mano: è un tipo
//! raggiungibile, nello snapshot, da una funzione o da un tipo di un `world`
//! (import o export), seguendo campi, casi, `option`, `list`, `result`,
//! `tuple` e alias. Un tipo dichiarato ma che nessuna firma del world
//! raggiunge non viaggia fra host e plugin, e resta sotto la regola del
//! prefisso.
//!
//! # Il ciclo di vita di `wit/frozen/`
//!
//! Pre-freeze la superficie è ancora libera di evolvere, e questo test non lo
//! impedisce: lo rende **visibile**. Una rottura deliberata si fa ritagliando la
//! linea di base — cioè con un commit che tocca `wit/frozen/0.1.0.wit`, che in
//! review si vede. Dopo M4 quel file non si tocca più: si aggiunge
//! `wit/frozen/<nuova-versione>.wit` e si lascia il precedente a fare da
//! presidio. La regola in prosa sta in `../../../docs/reference/abi-and-wit.md`.

use std::collections::{BTreeMap, BTreeSet};

use wit_parser::{
    Function, Handle, Resolve, Type, TypeDefKind, TypeId, TypeOwner, WorldItem, WorldKey,
};

const CURRENT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/wit/fub/abi.wit");
const FROZEN_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/wit/frozen");

// ---------------------------------------------------------------------------
// Il contratto ridotto a ciò che si confronta
// ---------------------------------------------------------------------------

/// La forma di un tipo dichiarato, normalizzata.
///
/// Le liste sono **ordinate come nel sorgente**: l'ordine è ABI (in un record la
/// disposizione al confine, in un variant il discriminante), quindi è dato, non
/// presentazione.
#[derive(Clone, PartialEq, Eq, Debug)]
enum Shape {
    Record(Vec<(String, String)>),
    Variant(Vec<(String, Option<String>)>),
    Enum(Vec<String>),
    Flags(Vec<String>),
    /// `type job-id = u64` → `u64`.
    Alias(String),
    /// Tutto il resto (resource, future, stream…): si confronta per uguaglianza
    /// del rendering, cioè non può cambiare affatto.
    Other(String),
}

impl Shape {
    fn kind(&self) -> &'static str {
        match self {
            Shape::Record(_) => "record",
            Shape::Variant(_) => "variant",
            Shape::Enum(_) => "enum",
            Shape::Flags(_) => "flags",
            Shape::Alias(_) => "alias",
            Shape::Other(_) => "altro",
        }
    }
}

/// Una funzione: parametri **in ordine, col nome**, e risultato.
///
/// I nomi contano: nel component model un parametro si passa per posizione, ma
/// il binding generato per un plugin lo espone per nome — rinominarlo rompe il
/// sorgente di chi lo implementa senza rompere niente qui.
#[derive(Clone, PartialEq, Eq, Debug)]
struct Sig {
    params: Vec<(String, String)>,
    result: Option<String>,
}

#[derive(Clone)]
struct Contract {
    /// Nome del package senza versione (`fub:abi`).
    package: String,
    version: Version,
    /// `interfaccia::tipo` → forma. La chiave porta l'interfaccia perché
    /// spostare un tipo altrove **è** una rinomina del suo nome qualificato.
    types: BTreeMap<String, Shape>,
    /// `interfaccia::funzione` → firma.
    functions: BTreeMap<String, Sig>,
    /// world → (import, export).
    worlds: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,
    /// I tipi dichiarati (`interfaccia::tipo`) che una firma di un world
    /// raggiunge: quelli che viaggiano davvero fra host e plugin.
    crossing: BTreeSet<String>,
    /// Da dove viene (per i messaggi d'errore).
    origin: String,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
struct Version {
    major: u64,
    minor: u64,
    patch: u64,
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

impl std::str::FromStr for Version {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, String> {
        let mut it = s.trim().split('.');
        let mut next = |what: &str| -> Result<u64, String> {
            it.next()
                .ok_or_else(|| format!("`{s}`: manca la {what}"))?
                .parse::<u64>()
                .map_err(|and| format!("`{s}`: {what} non numerica ({and})"))
        };
        let major = next("major")?;
        let minor = next("minor")?;
        let patch = next("patch")?;
        if it.next().is_some() {
            return Err(format!("`{s}`: una versione ha tre componenti"));
        }
        Ok(Version {
            major,
            minor,
            patch,
        })
    }
}

/// Il nome di un tipo se ne ha uno, altrimenti l'espressione che lo denota.
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

fn load(source: &str, origin: &str) -> Contract {
    let mut resolve = Resolve::new();
    if let Err(and) = resolve.push_str(origin, source) {
        panic!("{origin} non è un WIT valido: {and:?}");
    }

    let mut types: BTreeMap<String, Shape> = BTreeMap::new();
    let mut functions: BTreeMap<String, Sig> = BTreeMap::new();

    for (_, iface) in resolve.interfaces.iter() {
        let iface_name = iface.name.clone().unwrap_or_else(|| "<inline>".into());

        for (name, id) in &iface.types {
            let td = &resolve.types[*id];
            // `use altra-interfaccia.{x}` genera qui un alias omonimo verso `x`:
            // è un'importazione, non una dichiarazione. Un alias vero
            // (`type frontmatter = json`) ha un nome DIVERSO dal target.
            let is_import = matches!(
                &td.kind,
                TypeDefKind::Type(Type::Id(target))
                    if resolve.types[*target].name.as_deref() == Some(name.as_str())
            );
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
                TypeDefKind::Enum(and) => {
                    Shape::Enum(and.cases.iter().map(|c| c.name.clone()).collect())
                }
                TypeDefKind::Flags(f) => {
                    Shape::Flags(f.flags.iter().map(|f| f.name.clone()).collect())
                }
                TypeDefKind::Type(t) => Shape::Alias(render(&resolve, t)),
                TypeDefKind::List(t) => Shape::Alias(format!("list<{}>", render(&resolve, t))),
                TypeDefKind::Option(t) => Shape::Alias(format!("option<{}>", render(&resolve, t))),
                other => Shape::Other(other.as_str().to_string()),
            };
            types.insert(format!("{iface_name}::{name}"), shape);
        }

        for (name, f) in &iface.functions {
            let sig = Sig {
                params: f
                    .params
                    .iter()
                    .map(|p| (p.name.clone(), render(&resolve, &p.ty)))
                    .collect(),
                result: f.result.as_ref().map(|t| render(&resolve, t)),
            };
            functions.insert(format!("{iface_name}::{name}"), sig);
        }
    }

    let full = resolve
        .packages
        .iter()
        .map(|(_, p)| p.name.clone())
        .next()
        .expect("nessun package nel WIT");
    let package = format!("{}:{}", full.namespace, full.name);
    let version = full
        .version
        .as_ref()
        .unwrap_or_else(|| panic!("{origin}: il package non dichiara una versione"));
    let version = Version {
        major: version.major,
        minor: version.minor,
        patch: version.patch,
    };

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

    let crossing = crossing_types(&resolve);

    Contract {
        package,
        version,
        types,
        functions,
        worlds,
        crossing,
        origin: origin.to_string(),
    }
}

/// Il nome qualificato (`interfaccia::tipo`) di un tipo dichiarato in
/// un'interfaccia, la stessa chiave di [`Contract::types`].
fn qualified(resolve: &Resolve, id: TypeId) -> Option<String> {
    let td = &resolve.types[id];
    let name = td.name.as_ref()?;
    match td.owner {
        TypeOwner::Interface(iface) => {
            let iface = resolve.interfaces[iface]
                .name
                .clone()
                .unwrap_or_else(|| "<inline>".into());
            Some(format!("{iface}::{name}"))
        }
        _ => None,
    }
}

/// Ogni tipo dichiarato che una firma di un `world` raggiunge.
///
/// Si parte dalle funzioni delle interfacce importate ed esportate (e dalle
/// funzioni e dai tipi messi direttamente nel world) e si scende per campi,
/// casi, contenitori e alias. Un `use` è un alias omonimo: seguirlo porta al
/// tipo dichiarato nell'interfaccia d'origine, cioè alla chiave giusta.
fn crossing_types(resolve: &Resolve) -> BTreeSet<String> {
    let mut stack: Vec<Type> = Vec::new();
    let push_fn = |f: &Function, stack: &mut Vec<Type>| {
        stack.extend(f.params.iter().map(|p| p.ty));
        stack.extend(f.result);
    };
    for (_, world) in resolve.worlds.iter() {
        for item in world.imports.values().chain(world.exports.values()) {
            match item {
                WorldItem::Interface { id, .. } => {
                    for f in resolve.interfaces[*id].functions.values() {
                        push_fn(f, &mut stack);
                    }
                }
                WorldItem::Function(f) => push_fn(f, &mut stack),
                WorldItem::Type { id, .. } => stack.push(Type::Id(*id)),
            }
        }
    }

    let mut seen: BTreeSet<TypeId> = BTreeSet::new();
    let mut out = BTreeSet::new();
    while let Some(ty) = stack.pop() {
        let Type::Id(id) = ty else { continue };
        if !seen.insert(id) {
            continue;
        }
        out.extend(qualified(resolve, id));
        match &resolve.types[id].kind {
            TypeDefKind::Record(r) => stack.extend(r.fields.iter().map(|f| f.ty)),
            TypeDefKind::Variant(v) => stack.extend(v.cases.iter().filter_map(|c| c.ty)),
            TypeDefKind::Tuple(t) => stack.extend(t.types.iter().copied()),
            TypeDefKind::Result(r) => stack.extend(r.ok.into_iter().chain(r.err)),
            TypeDefKind::Map(k, v) => stack.extend([*k, *v]),
            TypeDefKind::Option(t)
            | TypeDefKind::List(t)
            | TypeDefKind::FixedLengthList(t, _)
            | TypeDefKind::Type(t) => stack.push(*t),
            TypeDefKind::Future(t) | TypeDefKind::Stream(t) => stack.extend(*t),
            TypeDefKind::Handle(Handle::Own(t) | Handle::Borrow(t)) => stack.push(Type::Id(*t)),
            TypeDefKind::Resource
            | TypeDefKind::Flags(_)
            | TypeDefKind::Enum(_)
            | TypeDefKind::Unknown => {}
        }
    }
    out
}

// ---------------------------------------------------------------------------
// La regola: `current` deve poter servire `base`
// ---------------------------------------------------------------------------

/// `base` è un prefisso di `now`? Restituisce la ragione per cui non lo è.
///
/// È il cuore della regola in una funzione sola: tutto ciò che era pubblicato
/// deve stare all'inizio, uguale a sé stesso; il nuovo può stare solo in coda.
fn prefix<T: PartialEq + std::fmt::Debug>(base: &[T], now: &[T], what: &str) -> Option<String> {
    if now.len() < base.len() {
        return Some(format!(
            "{what}: erano {} e ora sono {} — qualcosa è stato tolto (era {base:?}, ora {now:?})",
            base.len(),
            now.len()
        ));
    }
    for (the, was) in base.iter().enumerate() {
        if now[the] != *was {
            return Some(format!(
                "{what}: in posizione {the} c'era {was:?} e ora c'è {:?} \
                 (rinomina, ritipo o riordino: l'ordine è ABI)",
                now[the]
            ));
        }
    }
    None
}

/// Come si confronta una forma pubblicata con quella di oggi.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum BoundaryRule {
    /// La forma di allora è un prefisso di quella di oggi: un campo o un caso
    /// in coda passa. È la regola con cui sono state congelate le 0.1.x.
    Prefix,
    /// Un record, `variant`, `enum` o `flags` che attraversa il confine ha gli
    /// stessi campi o casi, nello stesso ordine, e un'interfaccia esportata
    /// dal plugin ha le stesse funzioni (ADR 0235, ADR 0238). Un tipo che
    /// nessuna firma del world raggiunge resta sotto [`BoundaryRule::Prefix`].
    ExactAtBoundary,
}

/// La prima versione congelata con la regola stretta del confine.
const STRICT_FROM: Version = Version {
    major: 0,
    minor: 2,
    patch: 0,
};

impl BoundaryRule {
    /// La regola vale per **snapshot**: quella di una versione è la regola con
    /// cui la versione è stata congelata, e non cambia dopo.
    fn for_snapshot(version: Version) -> Self {
        if version >= STRICT_FROM {
            BoundaryRule::ExactAtBoundary
        } else {
            BoundaryRule::Prefix
        }
    }
}

/// Perché un record del confine non prende un campo in coda.
const WHY_RECORD: &str = "un record che attraversa il confine non cresce, nemmeno in coda: un \
     plugin compilato contro il record più corto non si istanzia più (ADR 0235). La novità va \
     in un'interfaccia nuova";

/// Perché un `enum`, un `variant` o un `flags` del confine non prende un caso in
/// coda. Vale per un import come per un export: wasmtime controlla il tipo di
/// tutte e due le direzioni quando istanzia.
const WHY_CASES: &str = "un enum, un variant o un flags che attraversa il confine non prende \
     casi nuovi, nemmeno in coda: wasmtime ne confronta i casi uno per uno, in un import come in \
     un export, e un plugin compilato senza il caso nuovo non si istanzia più (ADR 0238). La \
     novità va in un'interfaccia nuova";

/// `base` e `now` hanno gli stessi elementi, nello stesso ordine? `why` dice
/// perché la coda non è ammessa, e il messaggio nomina ciò che è in coda.
fn exact<T: PartialEq + std::fmt::Debug>(
    base: &[T],
    now: &[T],
    what: &str,
    why: &str,
) -> Option<String> {
    if let Some(broken) = prefix(base, now, what) {
        return Some(broken);
    }
    (now.len() > base.len()).then(|| {
        format!(
            "{what}: erano {} e ora sono {} ({:?} in coda) — {why}",
            base.len(),
            now.len(),
            &now[base.len()..]
        )
    })
}

/// Le interfacce che il **plugin esporta**, cioè quelle che deve implementare.
fn exported_by_plugin(c: &Contract) -> BTreeSet<String> {
    c.worlds.values().flat_map(|(_, and)| and.clone()).collect()
}

/// Perché una funzione in più **non** è sempre un'aggiunta.
///
/// La tabella di `wit-congelato.md` diceva «funzione: una funzione **nuova**» in
/// una casella sola, e l'autotest che la copriva aggiungeva `host-env::notify`
/// — cioè una funzione a un'interfaccia che il plugin **importa**. Là è vero
/// davvero: un componente già compilato non la chiama, non se ne accorge, e
/// continua a girare. È il caso della decisione 0013, ed è quello che si aveva
/// in mente scrivendo la regola.
///
/// Sulle interfacce che il plugin **esporta** è falso, e nel verso peggiore:
/// una funzione in più non è qualcosa che il vecchio può ignorare, è qualcosa
/// che deve **fornire**. Un componente compilato contro `fub:abi@0.1.0` esporta
/// esattamente le funzioni di allora; un world che ne pretende una in più è un
/// world che quel componente non soddisfa, e non si instanzia affatto. Non è
/// una minor: è una major travestita da riga in coda.
///
/// Il presidio è rimasto verde per due di queste (vedi [`OBBLIGAZIONI_NOTE`]),
/// ed è la ragione per cui questa funzione esiste: la regola era stata scritta
/// guardando il lato che si concede e applicata anche al lato che si deve.
///
/// Contro `0.2.0` e dopo ([`BoundaryRule::ExactAtBoundary`]) l'elenco delle
/// obbligazioni note non vale: quelle due sono nate prima di 0.2.0, e la
/// regola stretta non ha eccezioni (ADR 0238). Il caso è provato con un
/// componente vero in `crates/fub-wasm-host/tests/new_case_and_function.rs`.
fn new_obligations(base: &Contract, now: &Contract, rule: BoundaryRule) -> Vec<String> {
    let exported = exported_by_plugin(base);
    let known: BTreeSet<&str> = KNOWN_OBLIGATIONS.iter().map(|(f, _)| *f).collect();
    let mut errors = Vec::new();
    for name in now.functions.keys() {
        let Some((iface, _)) = name.split_once("::") else {
            continue;
        };
        if !exported.contains(iface) || base.functions.contains_key(name) {
            continue;
        }
        if rule == BoundaryRule::ExactAtBoundary {
            errors.push(format!(
                "funzione `{name}`: nuova in `{iface}`, un'interfaccia che il PLUGIN esporta. \
                 Un plugin compilato contro {} non la esporta, e wasmtime non lo istanzia \
                 (ADR 0238): un'interfaccia esportata pubblicata non prende funzioni nuove. \
                 La novità va in un'interfaccia nuova",
                base.version
            ));
            continue;
        }
        if known.contains(name.as_str()) {
            continue;
        }
        errors.push(format!(
            "funzione `{name}`: `{iface}` è un'interfaccia che il PLUGIN esporta, quindi una \
             function in more is not an addition — it is an obligation. A component compiled \
             against {} does not export it, and a world that requires it is a world it does \
             not satisfy. If deliberate: a line in `KNOWN_OBLIGATIONS` with the reason, and a \
             line in the cuts table of `../../../docs/reference/abi-and-wit.md`",
            base.version
        ));
    }
    errors
}

/// Le obbligazioni **già** aggiunte prima che questo presidio sapesse vederle.
///
/// Non è un condono: è il modo di renderle visibili senza riscrivere la storia.
/// Sono due, tutte e due nate da una voce chiusa che non poteva sapere di
/// starle aggiungendo, perché il test diceva di sì. Una riga nuova qui va
/// **argomentata**, come nell'allowlist di `serialize_non_riscrive`: il costo è
/// reale e va pagato da chi lo sceglie, non ereditato in silenzio.
const KNOWN_OBLIGATIONS: &[(&str, &str)] = &[
    (
        "index::up-to-date",
        "decisione 0047 (§14.2): la domanda che mancava a un IndexProvider per poter \
         saltare un documento invariato. La 0051 scrive esplicitamente «`up-to-date` NON è \
         toccata» parlando dei tre metodi dell'alimentazione, e aveva ragione sul suo \
         oggetto — ma la funzione era comunque nata dopo la linea di base, su \
         un'interfaccia esportata, e nessuno l'ha registrata come ritaglio perché il \
         presidio era verde",
    ),
    (
        "view::interests",
        "decisione 0033 (la maschera degli eventi dice anche DOVE): senza, una view si \
         ridisegna a ogni evento del vault. Stessa storia: interfaccia esportata, presidio \
         verde, nessuna riga nella tabella dei ritagli",
    ),
];

/// Tutte le rotture di additività di `now` rispetto a `base`, con la regola del
/// confine dello snapshot `base`. Vuoto = additivo.
fn breaks(base: &Contract, now: &Contract) -> Vec<String> {
    breaks_with(base, now, BoundaryRule::for_snapshot(base.version))
}

/// [`breaks`] con la regola del confine scelta da chi chiama: i test del
/// presidio la fissano per esercitare tutte e due le regole sullo stesso
/// contratto.
fn breaks_with(base: &Contract, now: &Contract, rule: BoundaryRule) -> Vec<String> {
    let strict = |name: &str| rule == BoundaryRule::ExactAtBoundary && base.crossing.contains(name);
    let mut errors = Vec::new();

    if base.package != now.package {
        errors.push(format!(
            "il package è passato da `{}` a `{}`: ogni riferimento di terzi è morto",
            base.package, now.package
        ));
    }

    for (name, was) in &base.types {
        let Some(is) = now.types.get(name) else {
            errors.push(format!(
                "tipo `{name}`: pubblicato in {} e non più dichiarato \
                 (rimosso, rinominato, o spostato in un'altra interfaccia)",
                base.version
            ));
            continue;
        };
        if was.kind() != is.kind() {
            errors.push(format!(
                "tipo `{name}`: era un `{}` e ora è un `{}`",
                was.kind(),
                is.kind()
            ));
            continue;
        }
        // Lo stesso confronto per i quattro costrutti a elenco: esatto se il
        // tipo attraversa il confine e lo snapshot è stretto, prefisso se no.
        fn listed<T: PartialEq + std::fmt::Debug>(
            b: &[T],
            n: &[T],
            what: String,
            strict: bool,
            why: &str,
        ) -> Option<String> {
            if strict {
                exact(b, n, &what, why)
            } else {
                prefix(b, n, &what)
            }
        }
        let at_boundary = strict(name);
        let broken = match (was, is) {
            (Shape::Record(b), Shape::Record(n)) => listed(
                b,
                n,
                format!("record `{name}`, campi"),
                at_boundary,
                WHY_RECORD,
            ),
            (Shape::Variant(b), Shape::Variant(n)) => listed(
                b,
                n,
                format!("variant `{name}`, casi"),
                at_boundary,
                WHY_CASES,
            ),
            (Shape::Enum(b), Shape::Enum(n)) => listed(
                b,
                n,
                format!("enum `{name}`, casi"),
                at_boundary,
                WHY_CASES,
            ),
            (Shape::Flags(b), Shape::Flags(n)) => listed(
                b,
                n,
                format!("flags `{name}`, bit"),
                at_boundary,
                WHY_CASES,
            ),
            (Shape::Alias(b), Shape::Alias(n)) => (b != n).then(|| {
                format!("alias `{name}`: puntava a `{b}` e ora punta a `{n}` (non è un'aggiunta)")
            }),
            (Shape::Other(b), Shape::Other(n)) => {
                (b != n).then(|| format!("tipo `{name}`: era `{b}` e ora è `{n}`"))
            }
            _ => unreachable!("i kind sono già stati confrontati"),
        };
        errors.extend(broken);
    }

    for (name, was) in &base.functions {
        let Some(is) = now.functions.get(name) else {
            errors.push(format!(
                "funzione `{name}`: pubblicata in {} e non più dichiarata",
                base.version
            ));
            continue;
        };
        if let Some(why) = prefix(
            &was.params,
            &is.params,
            &format!("funzione `{name}`, parametri"),
        ) {
            errors.push(why);
        } else if is.params.len() != was.params.len() {
            // Una funzione non è un record: un parametro in più cambia la firma
            // di chi la implementa, quindi non è additivo nemmeno in coda.
            errors.push(format!(
                "funzione `{name}`: aveva {} parametri e ora ne ha {} — \
                 una firma non cresce, se ne dichiara una nuova",
                was.params.len(),
                is.params.len()
            ));
        }
        if was.result != is.result {
            let fmt = |r: &Option<String>| r.clone().unwrap_or_else(|| "(nessuno)".into());
            errors.push(format!(
                "funzione `{name}`: restituiva `{}` e ora restituisce `{}`",
                fmt(&was.result),
                fmt(&is.result)
            ));
        }
    }

    errors.extend(new_obligations(base, now, rule));

    for (name, (imports, exports)) in &base.worlds {
        let Some((now_imports, now_exports)) = now.worlds.get(name) else {
            errors.push(format!(
                "world `{name}`: pubblicato in {} e sparito",
                base.version
            ));
            continue;
        };
        let lost: Vec<&String> = imports.difference(now_imports).collect();
        if !lost.is_empty() {
            errors.push(format!("world `{name}`: import spariti {lost:?}"));
        }
        let lost: Vec<&String> = exports.difference(now_exports).collect();
        if !lost.is_empty() {
            errors.push(format!("world `{name}`: export spariti {lost:?}"));
        }
    }

    errors
}

// ---------------------------------------------------------------------------
// Gli snapshot su disco
// ---------------------------------------------------------------------------

/// Ogni `wit/frozen/<versione>.wit`, con la versione presa dal **nome del file**.
fn frozen() -> Vec<(Version, Contract)> {
    let dir = std::path::Path::new(FROZEN_DIR);
    let entries = std::fs::read_dir(dir).unwrap_or_else(|and| {
        panic!(
            "{FROZEN_DIR} non è leggibile: {and} — la linea di base del contratto non è opzionale"
        )
    });

    let mut out = Vec::new();
    for entry in entries {
        let path = entry.expect("voce di directory illeggibile").path();
        if path.extension().and_then(|and| and.to_str()) != Some("wit") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .expect("nome di file non UTF-8")
            .to_string();
        let version: Version = stem.parse().unwrap_or_else(|and| {
            panic!("wit/frozen/{stem}.wit: il nome del file È la versione pubblicata — {and}")
        });
        let source = std::fs::read_to_string(&path).expect("snapshot illeggibile");
        let contract = load(&source, &format!("wit/frozen/{stem}.wit"));
        assert_eq!(
            contract.version, version,
            "wit/frozen/{stem}.wit: il nome del file dice {version}, il package dentro dice {} \
             — uno dei due mente",
            contract.version
        );
        out.push((version, contract));
    }
    out.sort_by_key(|(v, _)| *v);
    out
}

fn current() -> Contract {
    let source = std::fs::read_to_string(CURRENT).expect("wit/fub/abi.wit illeggibile");
    load(&source, "wit/fub/abi.wit")
}

// ---------------------------------------------------------------------------
// I test
// ---------------------------------------------------------------------------

/// La linea di base esiste ed è coerente con la versione dichiarata dall'abi.
///
/// Senza questo, il presidio si spegne da solo il giorno in cui qualcuno svuota
/// la cartella: zero snapshot = zero confronti = verde.
#[test]
fn a_baseline_exists_and_covers_the_current_version() {
    let now = current();
    let snapshots = frozen();
    assert!(
        !snapshots.is_empty(),
        "wit/frozen/ è vuota: senza una copia del contratto non c'è un `prima` con cui \
         confrontarsi, e la promessa dell'additività torna a essere solo scritta"
    );

    assert_eq!(
        now.version.to_string(),
        fub_abi::traits::ABI_VERSION,
        "il package del WIT e `ABI_VERSION` devono dire la stessa versione"
    );

    // La regola di `abi_compatible` è "stessa major, minor non superiore": una
    // linea di base con la major di oggi deve esserci, o il test non confronta
    // niente proprio nella famiglia di versioni che l'host promette di servire.
    assert!(
        snapshots
            .iter()
            .any(|(v, _)| v.major == now.version.major && v.minor <= now.version.minor),
        "nessuno snapshot con la major {} e minor ≤ {}: `abi_compatible` accetterebbe \
         plugin di versioni di cui non esiste una copia del contratto",
        now.version.major,
        now.version.minor
    );
}

/// Il presidio vero: il contratto attuale serve ogni versione che dichiara di
/// servire.
#[test]
fn the_contract_grows_only_by_addition() {
    let now = current();
    let mut errors: Vec<String> = Vec::new();

    for (version, base) in frozen() {
        if version.major != now.version.major {
            // Major diversa: `abi_compatible` rifiuta comunque quei plugin, e
            // quella è la rottura *dichiarata*. Non c'è promessa da presidiare.
            continue;
        }
        assert!(
            version.minor <= now.version.minor,
            "{}: minor {} maggiore di quella corrente ({}) — uno snapshot dal futuro",
            base.origin,
            version.minor,
            now.version.minor
        );
        errors.extend(
            breaks(&base, &now)
                .into_iter()
                .map(|and| format!("[{version}] {and}")),
        );
    }

    assert!(
        errors.is_empty(),
        "il contratto NON è additivo rispetto a ciò che è già stato pubblicato.\n  - {}\n\n\
         `abi_compatible` accetterebbe comunque quei plugin (la minor non è cambiata): \
         è esattamente il caso in cui la rete di sicurezza dice sì e il confine si rompe \
         a valle. Le due uscite oneste sono: renderlo additivo, oppure — solo finché il \
         freeze di M4 non è avvenuto — ritagliare la linea di base con un commit che tocca \
         wit/frozen/ e lo dice.",
        errors.join("\n  - ")
    );
}

/// Un cambiamento del contratto, applicato al modello parsato: nome e come si
/// ottiene.
type Change = (&'static str, Box<dyn Fn(&mut Contract)>);

/// Il test del test: ogni forma di rottura deve farlo diventare rosso.
///
/// Le divergenze si introducono sul **modello parsato**, non sul sorgente: così
/// colpiscono esattamente il costrutto voluto e non dipendono da come è scritto
/// il file.
#[test]
fn every_form_of_breakage_turns_red() {
    let base = current();

    let mutations: Vec<Change> = vec![
        (
            "un tipo rimosso",
            Box::new(|c: &mut Contract| {
                c.types.remove("model::span").expect("model::span esiste");
            }),
        ),
        (
            "un tipo spostato in un'altra interfaccia",
            Box::new(|c: &mut Contract| {
                let shape = c.types.remove("model::span").expect("model::span esiste");
                c.types.insert("ui::span".into(), shape);
            }),
        ),
        (
            "un campo di record rinominato",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Record(fields)) = c.types.get_mut("model::span") else {
                    panic!("model::span è un record");
                };
                fields[0].0 = "inizio".into();
            }),
        ),
        (
            "un campo di record ritipato",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Record(fields)) = c.types.get_mut("model::span") else {
                    panic!("model::span è un record");
                };
                fields[0].1 = "u32".into();
            }),
        ),
        (
            "due campi riordinati",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Record(fields)) = c.types.get_mut("model::span") else {
                    panic!("model::span è un record");
                };
                fields.swap(0, 1);
            }),
        ),
        (
            "un campo tolto",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Record(fields)) = c.types.get_mut("model::span") else {
                    panic!("model::span è un record");
                };
                fields.pop();
            }),
        ),
        (
            "un campo inserito in mezzo",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Record(fields)) = c.types.get_mut("model::span") else {
                    panic!("model::span è un record");
                };
                fields.insert(0, ("nuovo".into(), "u64".into()));
            }),
        ),
        (
            // La regola di 0.2.0 (ADR 0235): `base` qui è il contratto di oggi,
            // cioè uno snapshot ≥ 0.2.0, e `view-spec` viaggia nel world.
            "un campo in coda a un record che attraversa il confine",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Record(fields)) = c.types.get_mut("view::view-spec") else {
                    panic!("view::view-spec è un record");
                };
                fields.push(("icon".into(), "option<string>".into()));
            }),
        ),
        (
            "un caso di variant rimosso",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Variant(cases)) = c.types.get_mut("model::link-target") else {
                    panic!("model::link-target è un variant");
                };
                cases.pop();
            }),
        ),
        (
            "il payload di un caso cambiato",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Variant(cases)) = c.types.get_mut("model::link-target") else {
                    panic!("model::link-target è un variant");
                };
                cases[1].1 = Some("u32".into());
            }),
        ),
        (
            "due casi riordinati (il discriminante si sposta)",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Variant(cases)) = c.types.get_mut("model::link-target") else {
                    panic!("model::link-target è un variant");
                };
                cases.swap(1, 2);
            }),
        ),
        (
            "un caso di enum rimosso",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Enum(cases)) = c.types.get_mut("view::view-surface") else {
                    panic!("view::view-surface è un enum");
                };
                cases.pop();
            }),
        ),
        (
            // La regola di 0.2.0 (ADR 0238): `view-surface` viaggia nel world
            // dentro `view-spec`.
            "un caso in fondo a un enum che attraversa il confine",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Enum(cases)) = c.types.get_mut("view::view-surface") else {
                    panic!("view::view-surface è un enum");
                };
                cases.push("main-area".into());
            }),
        ),
        (
            "un caso in fondo a un variant che attraversa il confine",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Variant(cases)) = c.types.get_mut("index::index-query") else {
                    panic!("index::index-query è un variant");
                };
                cases.push(("properties".into(), Some("json".into())));
            }),
        ),
        (
            "la destinazione di un alias cambiata",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Alias(target)) = c.types.get_mut("model::doc-id") else {
                    panic!("model::doc-id è un alias");
                };
                *target = "u64".into();
            }),
        ),
        (
            "un tipo che cambia costrutto",
            Box::new(|c: &mut Contract| {
                c.types
                    .insert("model::doc-id".into(), Shape::Record(vec![]));
            }),
        ),
        (
            // La rottura che questo presidio non sapeva vedere, e che due
            // funzioni gli erano già passate davanti (vedi
            // `OBBLIGAZIONI_NOTE`). `format` è esportata dal `plugin-world`:
            // un componente già compilato non la fornisce, quindi il world non
            // è più soddisfatto e non c'è instanziazione.
            "una funzione nuova su un'interfaccia che il PLUGIN esporta",
            Box::new(|c: &mut Contract| {
                c.functions.insert(
                    "format::describe".into(),
                    Sig {
                        params: vec![],
                        result: Some("string".into()),
                    },
                );
            }),
        ),
        (
            "una funzione rimossa",
            Box::new(|c: &mut Contract| {
                c.functions
                    .remove("host-vault-read::read-document")
                    .expect("host-vault-read::read-document esiste");
            }),
        ),
        (
            "un parametro in più su una funzione esistente",
            Box::new(|c: &mut Contract| {
                let sig = c
                    .functions
                    .get_mut("host-vault-read::read-document")
                    .expect("host-vault-read::read-document esiste");
                sig.params.push(("modo".into(), "u32".into()));
            }),
        ),
        (
            // Il caso di questa voce (decisione 0092), e ci è arrivato tardi:
            // `write-document` ha ritipato il proprio `base` e il banco non
            // aveva nessuna rottura che *ritipasse* un parametro — solo
            // aggiungerne uno e rinominarne uno. Il confronto la prendeva
            // comunque, perché `prefix` confronta le coppie (nome, tipo) e il
            // suo messaggio nomina già il ritipo; ciò che mancava non era il
            // presidio, era la **prova** che quel ramo funzioni. Un ramo che
            // nessuno esercita è un ramo di cui si scopre lo stato il giorno
            // che serve.
            "un parametro ritipato",
            Box::new(|c: &mut Contract| {
                let sig = c
                    .functions
                    .get_mut("host-vault-read::read-document")
                    .expect("host-vault-read::read-document esiste");
                sig.params[0].1 = "string".into();
            }),
        ),
        (
            "un parametro rinominato",
            Box::new(|c: &mut Contract| {
                let sig = c
                    .functions
                    .get_mut("host-vault-read::read-document")
                    .expect("host-vault-read::read-document esiste");
                sig.params[0].0 = "documento".into();
            }),
        ),
        (
            "il risultato di una funzione cambiato",
            Box::new(|c: &mut Contract| {
                let sig = c
                    .functions
                    .get_mut("host-vault-read::read-document")
                    .expect("host-vault-read::read-document esiste");
                sig.result = Some("string".into());
            }),
        ),
        (
            "il package rinominato",
            Box::new(|c: &mut Contract| {
                c.package = "fub:contratto".into();
            }),
        ),
        (
            "un world svuotato di un import",
            Box::new(|c: &mut Contract| {
                let (imports, _) = c
                    .worlds
                    .get_mut("plugin-world")
                    .expect("plugin-world esiste");
                let victim = imports.iter().next().expect("almeno un import").clone();
                imports.remove(&victim);
            }),
        ),
    ];

    for (name, break_fn) in mutations {
        let mut broken = base.clone();
        break_fn(&mut broken);
        let errors = breaks(&base, &broken);
        assert!(
            !errors.is_empty(),
            "«{name}» does not turn the guard red: it is checking less than it declares"
        );
    }
}

/// L'altra metà: ciò che è davvero un'aggiunta deve passare, o il presidio
/// blocca il lavoro che il §1 del piano deve poter fare.
#[test]
fn additions_at_the_end_pass() {
    let base = current();

    let additions: Vec<Change> = vec![
        (
            "un tipo nuovo",
            Box::new(|c: &mut Contract| {
                // Un tipo che il contratto NON ha (il §13.1 lo prevede): il
                // segnaposto precedente era `property-value`, che nel frattempo
                // è nato davvero — e un tipo che esiste non è un'aggiunta.
                c.types
                    .insert("model::doc-ref".into(), Shape::Alias("string".into()));
            }),
        ),
        (
            // Il gemello del caso rosso qui sopra, ed è la coppia che dice
            // dov'è il taglio: la STESSA aggiunta è additiva sull'interfaccia
            // che il plugin importa e rotta su quella che esporta. Chi importa
            // può ignorare ciò che non conosce; chi esporta deve fornirlo.
            "una funzione nuova (decisione 0013: una capacità in più)",
            Box::new(|c: &mut Contract| {
                c.functions.insert(
                    "host-env::notify".into(),
                    Sig {
                        params: vec![("message".into(), "string".into())],
                        result: None,
                    },
                );
            }),
        ),
        (
            "un'interfaccia nuova con i suoi tipi",
            Box::new(|c: &mut Contract| {
                c.types.insert(
                    "settings::setting-key".into(),
                    Shape::Alias("string".into()),
                );
                c.functions.insert(
                    "settings::get".into(),
                    Sig {
                        params: vec![("key".into(), "setting-key".into())],
                        result: Some("option<string>".into()),
                    },
                );
            }),
        ),
        (
            "un import in più nel world",
            Box::new(|c: &mut Contract| {
                let (imports, _) = c
                    .worlds
                    .get_mut("plugin-world")
                    .expect("plugin-world esiste");
                imports.insert("settings".into());
            }),
        ),
        (
            "un export di capability opzionale in più nel world",
            Box::new(|c: &mut Contract| {
                let (_, exports) = c
                    .worlds
                    .get_mut("plugin-world")
                    .expect("plugin-world esiste");
                exports.insert("grid-v2".into());
            }),
        ),
    ];

    for (name, apply_change) in additions {
        let mut grown = base.clone();
        apply_change(&mut grown);
        let errors = breaks(&base, &grown);
        assert!(
            errors.is_empty(),
            "«{name}» è un'aggiunta e il presidio la rifiuta:\n  - {}",
            errors.join("\n  - ")
        );
    }
}

/// Le due regole dei record sullo stesso cambiamento: il campo in coda passa
/// contro le 0.1.x, congelate con il prefisso, e fallisce contro 0.2.0 e dopo.
#[test]
fn a_field_at_the_end_passes_only_under_the_0_1_rule() {
    assert_eq!(
        BoundaryRule::for_snapshot("0.1.1".parse().unwrap()),
        BoundaryRule::Prefix
    );
    assert_eq!(
        BoundaryRule::for_snapshot("0.2.0".parse().unwrap()),
        BoundaryRule::ExactAtBoundary
    );
    assert_eq!(
        BoundaryRule::for_snapshot("0.3.0".parse().unwrap()),
        BoundaryRule::ExactAtBoundary
    );

    let base = current();
    let mut grown = base.clone();
    let Some(Shape::Record(fields)) = grown.types.get_mut("view::view-spec") else {
        panic!("view::view-spec è un record");
    };
    fields.push(("icon".into(), "option<string>".into()));

    let legacy = breaks_with(&base, &grown, BoundaryRule::Prefix);
    assert!(
        legacy.is_empty(),
        "contro una 0.1.x il campo in coda resta ammesso:\n  - {}",
        legacy.join("\n  - ")
    );
    let strict = breaks_with(&base, &grown, BoundaryRule::ExactAtBoundary);
    assert!(
        strict
            .iter()
            .any(|e| e.contains("view::view-spec") && e.contains("in coda")),
        "contro 0.2.0 il campo in coda deve far fallire il presidio, invece: {strict:?}"
    );
}

/// Lo stesso per i casi: un caso in fondo a un `enum` o a un `variant` del
/// confine passa contro le 0.1.x e fallisce contro 0.2.0 e dopo (ADR 0238).
#[test]
fn a_case_at_the_end_passes_only_under_the_0_1_rule() {
    let base = current();
    let grown: Vec<(&str, &str, Contract)> = vec![
        ("view::view-surface", "main-area", {
            let mut c = base.clone();
            let Some(Shape::Enum(cases)) = c.types.get_mut("view::view-surface") else {
                panic!("view::view-surface è un enum");
            };
            cases.push("main-area".into());
            c
        }),
        ("index::index-query", "properties", {
            let mut c = base.clone();
            let Some(Shape::Variant(cases)) = c.types.get_mut("index::index-query") else {
                panic!("index::index-query è un variant");
            };
            cases.push(("properties".into(), Some("json".into())));
            c
        }),
    ];
    for (name, case, now) in grown {
        let legacy = breaks_with(&base, &now, BoundaryRule::Prefix);
        assert!(
            legacy.is_empty(),
            "contro una 0.1.x il caso in coda di `{name}` resta ammesso:\n  - {}",
            legacy.join("\n  - ")
        );
        let strict = breaks_with(&base, &now, BoundaryRule::ExactAtBoundary);
        assert!(
            strict
                .iter()
                .any(|e| e.contains(name) && e.contains(case) && e.contains("in coda")),
            "contro 0.2.0 il caso `{case}` in coda a `{name}` deve far fallire il presidio, \
             invece: {strict:?}"
        );
    }
}

/// Il contratto vero: gli `enum` e i `variant` che il world raggiunge sono
/// trovati, come i record. Senza, la regola stretta dei casi non scatterebbe.
#[test]
fn the_enums_and_variants_of_the_boundary_are_found() {
    let now = current();
    for name in [
        "plugin::component-kind",
        "plugin::delivery",
        "view::view-surface",
        "index::index-query",
    ] {
        assert!(
            matches!(
                now.types.get(name),
                Some(Shape::Enum(_) | Shape::Variant(_))
            ),
            "`{name}` non è più un enum o un variant di abi.wit: scegline un altro"
        );
        assert!(
            now.crossing.contains(name),
            "`{name}` viaggia in una firma del world e la visita non lo trova"
        );
    }
}

/// Il contratto vero: i record che il world raggiunge sono quelli del confine.
///
/// Senza questo, un errore nella visita (un tipo di nodo dimenticato) farebbe
/// sembrare «interni» tutti i record, e la regola stretta non scatterebbe mai.
#[test]
fn the_records_of_the_boundary_are_found() {
    let now = current();
    for name in ["view::view-spec", "model::span", "plugin::plugin-manifest"] {
        assert!(
            matches!(now.types.get(name), Some(Shape::Record(_))),
            "`{name}` non è più un record di abi.wit: scegline un altro per questo test"
        );
        assert!(
            now.crossing.contains(name),
            "`{name}` viaggia in una firma del world e la visita non lo trova"
        );
    }
    let records: Vec<&String> = now
        .types
        .iter()
        .filter(|(_, s)| matches!(s, Shape::Record(_)))
        .map(|(n, _)| n)
        .collect();
    let crossing = records
        .iter()
        .filter(|n| now.crossing.contains(n.as_str()))
        .count();
    assert!(
        crossing * 2 > records.len(),
        "solo {crossing} record su {} attraversano il confine: la visita del world ne \
         perde qualcuno",
        records.len()
    );
}

/// Il presidio su testi WIT finti, scritti apposta: ogni caso è una riga di
/// differenza, e il test non dipende da come cambierà `abi.wit`.
const FAKE_BASE: &str = r#"
package fub:finto@0.2.0;

interface model {
    /// Attraversa il confine: `plugin.describe` lo restituisce.
    record span {
        start: u32,
        end: u32,
    }

    /// Dichiarato e mai usato da una firma del world: resta dell'host.
    record host-only {
        a: u32,
    }

    /// Attraversa il confine: `plugin.paint`, un export, lo riceve e lo dà.
    enum color { red, green }

    /// Attraversa il confine: `plugin.measure`, un export, lo riceve.
    variant shape { dot, circle(u32) }

    /// Attraversa il confine: `plugin.restyle`, un export, lo riceve e lo dà.
    flags style { bold, italic }

    /// Raggiunto solo da `host-env.next-event`, un import: il plugin lo riceve.
    variant event { none, text(string) }

    /// Dichiarato e mai usato da una firma del world: resta dell'host.
    enum host-mood { calm, busy }
}

interface plugin {
    use model.{span, color, shape, style};
    describe: func() -> span;
    paint: func(color: color) -> color;
    measure: func(shape: shape) -> u32;
    restyle: func(style: style) -> style;
}

interface host-env {
    use model.{event};
    log: func(message: string);
    next-event: func() -> event;
}

world plugin-world {
    import host-env;
    export plugin;
}
"#;

fn fake(source: &str) -> Contract {
    load(source, "finto.wit")
}

#[test]
fn the_strict_rule_on_fake_wit() {
    let base = fake(FAKE_BASE);
    assert_eq!(
        BoundaryRule::for_snapshot(base.version),
        BoundaryRule::ExactAtBoundary
    );
    assert!(base.crossing.contains("model::span"));
    assert!(!base.crossing.contains("model::host-only"));

    let edit = |from: &str, to: &str| -> Contract {
        assert!(FAKE_BASE.contains(from), "il caso finto non trova `{from}`");
        fake(&FAKE_BASE.replacen(from, to, 1))
    };

    // Rosso: un campo in coda a un record congelato che attraversa il confine.
    let grown = edit(
        "        end: u32,\n",
        "        end: u32,\n        len: u32,\n",
    );
    let errors = breaks(&base, &grown);
    assert!(
        errors
            .iter()
            .any(|e| e.contains("record `model::span`") && e.contains("in coda")),
        "un campo in coda a `span` deve far fallire il presidio, invece: {errors:?}"
    );

    let green: Vec<(&str, Contract)> = vec![
        (
            "una funzione nuova su un'interfaccia che il plugin importa",
            edit(
                "    log: func(message: string);\n",
                "    log: func(message: string);\n    notify: func(message: string);\n",
            ),
        ),
        (
            "un'interfaccia nuova, importata dal world",
            edit(
                "world plugin-world {\n",
                "interface clock {\n    now: func() -> u64;\n}\n\n\
                 world plugin-world {\n    import clock;\n",
            ),
        ),
        (
            "un tipo nuovo",
            edit(
                "    record host-only {",
                "    record stamp {\n        at: u64,\n    }\n\n    record host-only {",
            ),
        ),
        (
            "un campo in coda a un record che nessuna firma del world raggiunge",
            edit("        a: u32,\n", "        a: u32,\n        b: u32,\n"),
        ),
        (
            "commenti e spazi diversi",
            edit(
                "    record span {\n        start: u32,\n        end: u32,\n    }",
                "    // un commento nuovo\n    record span {\n\n  start:   u32,\n end: u32\n    }",
            ),
        ),
    ];
    for (name, now) in green {
        let errors = breaks(&base, &now);
        assert!(
            errors.is_empty(),
            "«{name}» è un'aggiunta e il presidio la rifiuta:\n  - {}",
            errors.join("\n  - ")
        );
    }
}

/// `FAKE_BASE` con una sostituzione sola: il caso finto di un test.
fn fake_edit(from: &str, to: &str) -> Contract {
    assert!(FAKE_BASE.contains(from), "il caso finto non trova `{from}`");
    fake(&FAKE_BASE.replacen(from, to, 1))
}

/// La regola stretta dei casi e delle funzioni esportate (ADR 0238), una
/// regola per caso finto. Ogni rosso dice che cosa il messaggio deve
/// nominare: il tipo e il caso, o la funzione.
#[test]
fn the_strict_rule_for_cases_and_exported_functions_on_fake_wit() {
    let base = fake(FAKE_BASE);
    for name in ["model::color", "model::shape", "model::style", "model::event"] {
        assert!(
            base.crossing.contains(name),
            "`{name}` attraversa il confine nel world finto e la visita non lo trova"
        );
    }
    assert!(!base.crossing.contains("model::host-mood"));

    let red: Vec<(&str, Contract, &[&str])> = vec![
        (
            "un caso nuovo in fondo a un enum raggiunto da un export",
            fake_edit("enum color { red, green }", "enum color { red, green, blue }"),
            &["enum `model::color`", "\"blue\"", "in coda"],
        ),
        (
            "un caso tolto da un enum del confine",
            fake_edit("enum color { red, green }", "enum color { red }"),
            &["enum `model::color`", "tolto"],
        ),
        (
            "due casi spostati in un enum del confine",
            fake_edit("enum color { red, green }", "enum color { green, red }"),
            &["enum `model::color`", "posizione 0", "\"red\""],
        ),
        (
            "un caso nuovo in fondo a un variant raggiunto da un export",
            fake_edit(
                "variant shape { dot, circle(u32) }",
                "variant shape { dot, circle(u32), square(u32) }",
            ),
            &["variant `model::shape`", "\"square\"", "in coda"],
        ),
        (
            // La prova degli import (`new_case_and_function.rs`): wasmtime
            // controlla anche il tipo di ciò che il plugin importa.
            "un caso nuovo in fondo a un variant raggiunto solo da un import",
            fake_edit(
                "variant event { none, text(string) }",
                "variant event { none, text(string), error(u32) }",
            ),
            &["variant `model::event`", "\"error\"", "in coda"],
        ),
        (
            "un bit nuovo in fondo a un flags del confine",
            fake_edit(
                "flags style { bold, italic }",
                "flags style { bold, italic, underline }",
            ),
            &["flags `model::style`", "\"underline\"", "in coda"],
        ),
        (
            "una funzione nuova in un'interfaccia che il plugin esporta",
            fake_edit(
                "    describe: func() -> span;\n",
                "    describe: func() -> span;\n    count: func() -> u32;\n",
            ),
            &["funzione `plugin::count`", "esporta", "ADR 0238"],
        ),
        (
            "una funzione tolta da un'interfaccia che il plugin esporta",
            fake_edit("    paint: func(color: color) -> color;\n", ""),
            &["funzione `plugin::paint`", "non più dichiarata"],
        ),
        (
            "una funzione cambiata in un'interfaccia che il plugin esporta",
            fake_edit(
                "    paint: func(color: color) -> color;\n",
                "    paint: func(color: color) -> u32;\n",
            ),
            &["funzione `plugin::paint`", "restituiva `color`"],
        ),
        (
            "una funzione cambiata in un'interfaccia che il plugin importa",
            fake_edit(
                "    log: func(message: string);\n",
                "    log: func(message: u32);\n",
            ),
            &["funzione `host-env::log`", "parametri"],
        ),
    ];
    for (name, now, expected) in red {
        let errors = breaks(&base, &now);
        assert!(
            errors
                .iter()
                .any(|e| expected.iter().all(|piece| e.contains(piece))),
            "«{name}» deve far fallire il presidio con un messaggio che nomina {expected:?}, \
             invece: {errors:?}"
        );
    }

    let green: Vec<(&str, Contract)> = vec![
        (
            "un caso in fondo a un enum che nessuna firma del world raggiunge",
            fake_edit(
                "enum host-mood { calm, busy }",
                "enum host-mood { calm, busy, away }",
            ),
        ),
        (
            "una funzione nuova in un'interfaccia che il plugin importa",
            fake_edit(
                "    next-event: func() -> event;\n",
                "    next-event: func() -> event;\n    version: func() -> u32;\n",
            ),
        ),
        (
            "un'interfaccia nuova, esportata dal plugin, coi suoi tipi",
            fake_edit(
                "world plugin-world {\n",
                "interface palette {\n    enum tint { warm, cold }\n    \
                 pick: func() -> tint;\n}\n\n\
                 world plugin-world {\n    export palette;\n",
            ),
        ),
    ];
    for (name, now) in green {
        let errors = breaks(&base, &now);
        assert!(
            errors.is_empty(),
            "«{name}» è un'aggiunta e il presidio la rifiuta:\n  - {}",
            errors.join("\n  - ")
        );
    }
}

/// Le regole di 0.1.0 e 0.1.1 non si riscrivono: contro uno snapshot 0.1.x il
/// caso in coda, anche in un tipo del confine, passa ancora.
#[test]
fn a_0_1_snapshot_still_takes_a_case_at_the_end() {
    let old = FAKE_BASE.replacen("package fub:finto@0.2.0;", "package fub:finto@0.1.1;", 1);
    let base = fake(&old);
    assert_eq!(BoundaryRule::for_snapshot(base.version), BoundaryRule::Prefix);
    for (from, to) in [
        ("enum color { red, green }", "enum color { red, green, blue }"),
        (
            "variant event { none, text(string) }",
            "variant event { none, text(string), error(u32) }",
        ),
        (
            "flags style { bold, italic }",
            "flags style { bold, italic, underline }",
        ),
    ] {
        let now = fake(&old.replacen(from, to, 1));
        let errors = breaks(&base, &now);
        assert!(
            errors.is_empty(),
            "contro 0.1.1 `{to}` resta un'aggiunta:\n  - {}",
            errors.join("\n  - ")
        );
    }
}
