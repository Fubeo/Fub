//! Additività del contratto — il presidio della promessa del freeze (M4).
//!
//! `wit_conformance.rs` verifica che `fubmd-abi` e `wit/fubmd/abi.wit` dicano la
//! stessa cosa — **oggi**, fra di loro. Questo test verifica l'altra promessa,
//! quella su cui poggia tutto il §1 del piano: *il contratto cresce solo per
//! aggiunta*. Sono due invarianti diverse e nessuna implica l'altra: si può
//! rinominare un campo in Rust **e** nel WIT, restare conformi, e aver rotto
//! ogni plugin già compilato.
//!
//! # Perché serve un file in più e non basta `abi_compatible`
//!
//! [`fubmd_abi::traits::abi_compatible`] applica la regola a runtime: major
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
//! **intatta e nella stessa posizione**, e il nuovo può stare solo *in coda*.
//!
//! | costrutto | additivo | rotto |
//! |---|---|---|
//! | `record` | un campo **in fondo** | rinominare, ritipare, riordinare, togliere |
//! | `variant` / `enum` / `flags` | un caso **in fondo** | idem — l'ordine è il discriminante |
//! | `type x = …` (alias) | — | qualunque cambio di destinazione |
//! | funzione | una funzione **nuova** | cambiare parametri o risultato di una esistente |
//! | interfaccia | un'interfaccia **nuova** | toglierne una, o spostarci dentro un tipo |
//! | `world` | un import/export in più | toglierne uno |
//!
//! L'"in fondo" è severo di proposito. Nel component model aggiungere un caso a
//! un `variant` non è nemmeno additivo davvero; la regola che questo progetto ha
//! scelto (`abi_compatible`) dice che lo è, e allora il minimo è che il
//! *discriminante di ciò che c'era* non si muova.
//!
//! # Il ciclo di vita di `wit/frozen/`
//!
//! Pre-freeze la superficie è ancora libera di evolvere, e questo test non lo
//! impedisce: lo rende **visibile**. Una rottura deliberata si fa ritagliando la
//! linea di base — cioè con un commit che tocca `wit/frozen/0.1.0.wit`, che in
//! review si vede. Dopo M4 quel file non si tocca più: si aggiunge
//! `wit/frozen/<nuova-versione>.wit` e si lascia il precedente a fare da
//! presidio. La regola in prosa sta in `wit/frozen/README.md`.

use std::collections::{BTreeMap, BTreeSet};

use wit_parser::{Resolve, Type, TypeDefKind, WorldItem, WorldKey};

const CURRENT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../wit/fubmd/abi.wit");
const FROZEN_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../wit/frozen");

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
    /// Nome del package senza versione (`fubmd:abi`).
    package: String,
    version: Version,
    /// `interfaccia::tipo` → forma. La chiave porta l'interfaccia perché
    /// spostare un tipo altrove **è** una rinomina del suo nome qualificato.
    types: BTreeMap<String, Shape>,
    /// `interfaccia::funzione` → firma.
    functions: BTreeMap<String, Sig>,
    /// world → (import, export).
    worlds: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,
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
                .map_err(|e| format!("`{s}`: {what} non numerica ({e})"))
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
    if let Err(e) = resolve.push_str(origin, source) {
        panic!("{origin} non è un WIT valido: {e:?}");
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
                TypeDefKind::Enum(e) => {
                    Shape::Enum(e.cases.iter().map(|c| c.name.clone()).collect())
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

    Contract {
        package,
        version,
        types,
        functions,
        worlds,
        origin: origin.to_string(),
    }
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
    for (i, was) in base.iter().enumerate() {
        if now[i] != *was {
            return Some(format!(
                "{what}: in posizione {i} c'era {was:?} e ora c'è {:?} \
                 (rinomina, ritipo o riordino: l'ordine è ABI)",
                now[i]
            ));
        }
    }
    None
}

/// Tutte le rotture di additività di `now` rispetto a `base`. Vuoto = additivo.
fn breaks(base: &Contract, now: &Contract) -> Vec<String> {
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
        let broken = match (was, is) {
            (Shape::Record(b), Shape::Record(n)) => {
                prefix(b, n, &format!("record `{name}`, campi"))
            }
            (Shape::Variant(b), Shape::Variant(n)) => {
                prefix(b, n, &format!("variant `{name}`, casi"))
            }
            (Shape::Enum(b), Shape::Enum(n)) => prefix(b, n, &format!("enum `{name}`, casi")),
            (Shape::Flags(b), Shape::Flags(n)) => prefix(b, n, &format!("flags `{name}`, bit")),
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
    let entries = std::fs::read_dir(dir).unwrap_or_else(|e| {
        panic!("{FROZEN_DIR} non è leggibile: {e} — la linea di base del contratto non è opzionale")
    });

    let mut out = Vec::new();
    for entry in entries {
        let path = entry.expect("voce di directory illeggibile").path();
        if path.extension().and_then(|e| e.to_str()) != Some("wit") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .expect("nome di file non UTF-8")
            .to_string();
        let version: Version = stem.parse().unwrap_or_else(|e| {
            panic!("wit/frozen/{stem}.wit: il nome del file È la versione pubblicata — {e}")
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
    let source = std::fs::read_to_string(CURRENT).expect("wit/fubmd/abi.wit illeggibile");
    load(&source, "wit/fubmd/abi.wit")
}

// ---------------------------------------------------------------------------
// I test
// ---------------------------------------------------------------------------

/// La linea di base esiste ed è coerente con la versione dichiarata dall'abi.
///
/// Senza questo, il presidio si spegne da solo il giorno in cui qualcuno svuota
/// la cartella: zero snapshot = zero confronti = verde.
#[test]
fn esiste_una_linea_di_base_e_copre_la_versione_corrente() {
    let now = current();
    let snapshots = frozen();
    assert!(
        !snapshots.is_empty(),
        "wit/frozen/ è vuota: senza una copia del contratto non c'è un `prima` con cui \
         confrontarsi, e la promessa dell'additività torna a essere solo scritta"
    );

    assert_eq!(
        now.version.to_string(),
        fubmd_abi::traits::ABI_VERSION,
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
fn il_contratto_cresce_solo_per_aggiunta() {
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
                .map(|e| format!("[{version}] {e}")),
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
type Cambio = (&'static str, Box<dyn Fn(&mut Contract)>);

/// Il test del test: ogni forma di rottura deve farlo diventare rosso.
///
/// Le divergenze si introducono sul **modello parsato**, non sul sorgente: così
/// colpiscono esattamente il costrutto voluto e non dipendono da come è scritto
/// il file.
#[test]
fn ogni_forma_di_rottura_e_rossa() {
    let base = current();

    let mutazioni: Vec<Cambio> = vec![
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
                let Some(Shape::Enum(cases)) = c.types.get_mut("view::view-placement") else {
                    panic!("view::view-placement è un enum");
                };
                cases.pop();
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
            "una funzione rimossa",
            Box::new(|c: &mut Contract| {
                c.functions
                    .remove("host-api::read-document")
                    .expect("host-api::read-document esiste");
            }),
        ),
        (
            "un parametro in più su una funzione esistente",
            Box::new(|c: &mut Contract| {
                let sig = c
                    .functions
                    .get_mut("host-api::read-document")
                    .expect("host-api::read-document esiste");
                sig.params.push(("modo".into(), "u32".into()));
            }),
        ),
        (
            "un parametro rinominato",
            Box::new(|c: &mut Contract| {
                let sig = c
                    .functions
                    .get_mut("host-api::read-document")
                    .expect("host-api::read-document esiste");
                sig.params[0].0 = "documento".into();
            }),
        ),
        (
            "il risultato di una funzione cambiato",
            Box::new(|c: &mut Contract| {
                let sig = c
                    .functions
                    .get_mut("host-api::read-document")
                    .expect("host-api::read-document esiste");
                sig.result = Some("string".into());
            }),
        ),
        (
            "il package rinominato",
            Box::new(|c: &mut Contract| {
                c.package = "fubmd:contratto".into();
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

    for (nome, rompi) in mutazioni {
        let mut rotto = base.clone();
        rompi(&mut rotto);
        let errors = breaks(&base, &rotto);
        assert!(
            !errors.is_empty(),
            "«{nome}» non fa diventare rosso il presidio: sta verificando meno di quel \
             che dichiara"
        );
    }
}

/// L'altra metà: ciò che è davvero un'aggiunta deve passare, o il presidio
/// blocca il lavoro che il §1 del piano deve poter fare.
#[test]
fn le_aggiunte_in_coda_passano() {
    let base = current();

    let aggiunte: Vec<Cambio> = vec![
        (
            "un campo in fondo a un record",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Record(fields)) = c.types.get_mut("view::view-spec") else {
                    panic!("view::view-spec è un record");
                };
                fields.push(("icon".into(), "option<string>".into()));
            }),
        ),
        (
            "un caso in fondo a un enum (§1.14: una superficie di UI in più)",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Enum(cases)) = c.types.get_mut("view::view-placement") else {
                    panic!("view::view-placement è un enum");
                };
                cases.push("main-area".into());
            }),
        ),
        (
            "un caso in fondo a un variant (§1.6: una query in più)",
            Box::new(|c: &mut Contract| {
                let Some(Shape::Variant(cases)) = c.types.get_mut("index::index-query") else {
                    panic!("index::index-query è un variant");
                };
                cases.push(("properties".into(), Some("json".into())));
            }),
        ),
        (
            "un tipo nuovo",
            Box::new(|c: &mut Contract| {
                // Un tipo che il contratto NON ha (il §1.10 lo prevede): il
                // segnaposto precedente era `property-value`, che nel frattempo
                // è nato davvero — e un tipo che esiste non è un'aggiunta.
                c.types
                    .insert("model::doc-ref".into(), Shape::Alias("string".into()));
            }),
        ),
        (
            "una funzione nuova (§1.4: una capacità in più)",
            Box::new(|c: &mut Contract| {
                c.functions.insert(
                    "host-api::notify".into(),
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
    ];

    for (nome, aggiungi) in aggiunte {
        let mut cresciuto = base.clone();
        aggiungi(&mut cresciuto);
        let errors = breaks(&base, &cresciuto);
        assert!(
            errors.is_empty(),
            "«{nome}» è un'aggiunta e il presidio la rifiuta:\n  - {}",
            errors.join("\n  - ")
        );
    }
}
