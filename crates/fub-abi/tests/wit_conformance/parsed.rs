//! Il WIT parsato (nomi e tipi dichiarati, non sottostringhe) e le
//! asserzioni con cui il test lo confronta con l'abi.

use super::*;

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

pub(super) struct Wit {
    /// Tipi dichiarati (i `use` di altre interfacce sono esclusi: sono
    /// importazioni, non dichiarazioni).
    types: BTreeMap<String, Decl>,
    /// Interfaccia → funzioni dichiarate, con la loro firma.
    functions: BTreeMap<String, BTreeMap<String, WitSig>>,
    pub(super) package: String,
    /// world → (interfacce importate, interfacce esportate).
    pub(super) worlds: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,

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

pub(super) fn load(source: &str) -> Wit {
    let mut resolve = Resolve::new();
    // Se il contratto non è un WIT valido il test muore QUI, ed è il punto.
    if let Err(and) = resolve.push_str("wit/fub/abi.wit", source) {
        panic!("wit/fub/abi.wit non è un WIT valido: {and:?}");
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
                TypeDefKind::Enum(and) => {
                    Shape::Enum(and.cases.iter().map(|c| c.name.clone()).collect())
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

/// L'ordine di dichiarazione dei casi di un enum Rust, letto dal **sorgente**
/// (in kebab-case, come i nomi WIT).
///
/// È l'anello che mancava: i match esaustivi di questo test obbligano a
/// elencare *tutti* i casi, ma niente obbligava a elencarli *in fila* —  e
/// l'ordine dei casi è il discriminante ABI. Qui l'ordine atteso si deriva
/// dall'enum stesso, così riordinare l'enum Rust senza toccare WIT e test è
/// rosso quanto riordinare il WIT.
///
/// Dalla [decisione 0053](../../../docs/decisions/0194-sorgenti-e-proiezioni-del-contratto.md)
/// il lettore del sorgente sta in `tests/common/`, perché non serve più a
/// questo test soltanto: la stessa dichiarazione Rust proietta di qua il WIT
/// (`kebab`) e di là le union del mirror TypeScript (`snake`, `ts_enums.rs`).
/// Una lettura, due confini.
pub(super) fn rust_enum_order(file: &str, enum_name: &str) -> Vec<String> {
    common::read_enum(file, enum_name)
        .variants
        .iter()
        .map(|v| common::kebab(v))
        .collect()
}

/// Un caso di `variant`, con il tipo del payload e — se il payload è un record
/// dedicato — i suoi campi.
pub(super) struct Case {
    pub(super) name: &'static str,
    pub(super) payload: Option<String>,
    pub(super) fields: Option<Vec<(&'static str, String)>>,
}

/// Caso senza payload (`index-updated`, `none`).
pub(super) fn case(name: &'static str) -> Case {
    Case {
        name,
        payload: None,
        fields: None,
    }
}

/// Caso con payload anonimo (`text(string)`, `emph(list<inline-ref>)`).
pub(super) fn case_ty(name: &'static str, payload: String) -> Case {
    Case {
        name,
        payload: Some(payload),
        fields: None,
    }
}

/// Caso il cui payload è un record dedicato del WIT.
pub(super) fn case_rec(
    name: &'static str,
    ty: &'static str,
    fields: Vec<(&'static str, String)>,
) -> Case {
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

    fn shape_of(&mut self, name: &str, expected: &'static str) -> Option<&Shape> {
        self.covered_types.insert(name.to_string());
        let Some(decl) = self.types.get(name) else {
            self.errors
                .push(format!("`{name}` ({expected}) manca dal WIT"));
            return None;
        };
        let got = decl.shape.kind();
        if got != expected {
            self.errors.push(format!(
                "`{name}`: nel WIT è `{got}`, nell'abi è `{expected}`"
            ));
            return None;
        }
        self.types.get(name).map(|d| &d.shape)
    }

    pub(super) fn record(&mut self, name: &str, fields: &[(&'static str, String)]) {
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

    pub(super) fn enumeration(&mut self, name: &str, cases: &[&str]) {
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

    /// Come [`variant`](Wit::variant), ma verifica ANCHE che l'ordine dei casi
    /// elencati dal test coincida con l'ordine di dichiarazione dell'enum Rust
    /// (`src` = `(file, nome dell'enum)`): l'enum è la verità, e un suo
    /// riordino deve far fallire il test anche se WIT e test restano uguali.
    pub(super) fn variant_src(&mut self, name: &str, src: (&str, &str), cases: &[Case]) {
        let listed: Vec<String> = cases.iter().map(|c| c.name.to_string()).collect();
        let declared = rust_enum_order(src.0, src.1);
        if listed != declared {
            self.err(format!(
                "`{name}`: l'ordine dei casi diverge dalla dichiarazione Rust di \
                 `{}` ({}) — test/WIT {listed:?}, enum {declared:?} \
                 (l'ordine dei casi è il discriminante ABI)",
                src.1, src.0
            ));
        }
        self.variant(name, cases);
    }

    /// Un `enum` del WIT confrontato **direttamente** con la dichiarazione
    /// Rust (decisione 0053): i casi e il loro ordine si leggono dal sorgente,
    /// non si riscrivono qui.
    ///
    /// Sostituisce l'`enumeration_src` di prima, che chiedeva l'elenco a mano e
    /// poi lo confrontava con questo stesso `rust_enum_order` — cioè faceva
    /// scrivere una copia per poterla correggere. Non è un presidio più debole:
    /// l'altro lato del confronto è il WIT, che resta scritto a mano e parsato.
    /// È più forte, perché un caso aggiunto in Rust arriva **da solo** fino al
    /// diff col contratto, invece di aspettare che qualcuno si ricordi di
    /// questa riga — che è il difetto che il §16.7 nomina.
    pub(super) fn enumeration_from(&mut self, name: &str, src: (&str, &str)) {
        let cases = rust_enum_order(src.0, src.1);
        let refs: Vec<&str> = cases.iter().map(String::as_str).collect();
        self.enumeration(name, &refs);
    }

    pub(super) fn variant(&mut self, name: &str, cases: &[Case]) {
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
    pub(super) fn alias(&mut self, name: &str, target: String) {
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
    pub(super) fn types_only(&mut self, iface: &str) {
        self.covered_fns.entry(iface.to_string()).or_default();
    }

    /// Confronta la firma completa di una funzione con quella del metodo Rust
    /// da cui `f` è stato ricavato.
    ///
    /// `param_names` sono i nomi dei parametri nel WIT: i soli dati scritti a
    /// mano qui, perché il nome di un parametro non esiste a livello di tipo. I
    /// **tipi** vengono dal puntatore a funzione, e quello viene dal trait.
    pub(super) fn method<F: WitFn>(
        &mut self,
        iface: &str,
        name: &str,
        _f: F,
        param_names: &[&str],
    ) {
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
            if let Some((n, t)) = declared_params
                .iter()
                .find(|(n, _)| n == "host" || n == "out")
            {
                self.err(format!(
                    "funzione `{iface}.{name}`: il metodo Rust prende una capacità dell'host e \
                     il WIT dichiara `{n}: {t}` — la capacità è importata dal world, va ELISA"
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
    pub(super) fn finish(mut self) -> Result<(), String> {
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
                    .filter(|(_, sig)| sig.params.iter().any(|(p, _)| p == "host" || p == "out"))
                    .map(move |(name, _)| format!("{iface}.{name}"))
            })
            .collect();
        if !intrusi.is_empty() {
            self.err(format!(
                "funzioni del WIT con un parametro `host`/`out` {intrusi:?}: le capacità sono \
                 importate dal world, non passate come argomento"
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
