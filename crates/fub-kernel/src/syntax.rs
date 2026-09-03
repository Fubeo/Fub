//! Il registro delle [`SyntaxRule`] — l'innesto del §3.1.
//!
//! Prima, l'unico modo di aggiungere una sintassi al markdown era **sostituire**
//! il provider markdown: `FormatRegistry` era una mappa estensione → un
//! provider, e `register` faceva `insert`. Era l'unico punto in cui l'invariante
//! del progetto — «una feature ufficiale è ciò che scriverà un plugin di terzi»
//! — era già falsa, e le ~50 estensioni del 5.2 la rendevano falsa cinquanta
//! volte.
//!
//! # Dove agiscono le regole
//!
//! Sul **modello**, dopo il parse del provider. È questo che le rende
//! innestabili su un provider che non le conosce: il provider fa il suo lavoro
//! senza sapere che esistono, e le regole riscrivono i nodi che rivendicano.
//!
//! Il prezzo è dichiarato, e sta nel doc di [`fub_abi::custom`]: una regola
//! non può cambiare **come la grammatica di base spezza il testo**. Può fare le
//! due cose che i trigger nominano — prendersi un recinto che il provider ha già
//! riconosciuto come tale, e prendersi un tratto di testo fra due delimitatori.
//!
//! # Il conflitto, che prima non aveva dove accadere
//!
//! Due regole che rivendicano la stessa sintassi sullo stesso formato sono un
//! [`SyntaxConflict`], e la seconda **non si registra**. Non è severità fine a
//! sé stessa: l'alternativa è ciò che `FormatRegistry::register` faceva prima —
//! l'ultimo vince, in silenzio — e un vincitore silenzioso è un difetto che si
//! manifesta come «la mia estensione a volte non funziona».

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use fub_abi::custom::{
    SyntaxForm, SyntaxMatch, SyntaxProduct, SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::format::ParseContext;
use fub_abi::model::{Block, DocumentModel, Inline, ListItem, Span, TableRow};

use crate::safety::Gate;
use fub_abi::options::OptionMap;

/// Perché una regola non si è registrata.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SyntaxConflict {
    /// L'id non ha namespace: `ns:nome`. La regola generale è del §7.4, questa è
    /// la sua applicazione qui.
    UnnamespacedId(String),
    /// Un id già registrato.
    DuplicateId(String),
    /// Un trigger che non può agganciare niente: info string vuota, o
    /// delimitatori vuoti. Registrarlo sarebbe registrare un no-op che sembra
    /// una regola.
    InertTrigger(String),
    /// Una regola che non dichiara nessun `produces`. Dato che ciò che non è
    /// dichiarato viene scartato, una regola così aggancia e non produce mai:
    /// è l'altro modo di essere un no-op che sembra una regola.
    NothingProduced(String),
    /// Due regole rivendicano la stessa sintassi sullo stesso formato.
    Claimed {
        format: String,
        claim: String,
        /// Chi ce l'aveva già.
        incumbent: String,
        /// Chi è arrivato dopo, e **non** si è registrato.
        challenger: String,
    },
}

impl std::fmt::Display for SyntaxConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyntaxConflict::UnnamespacedId(id) => {
                write!(f, "la regola `{id}` non ha un namespace (serve `ns:nome`)")
            }
            SyntaxConflict::DuplicateId(id) => write!(f, "la regola `{id}` è già registrata"),
            SyntaxConflict::InertTrigger(id) => {
                write!(
                    f,
                    "il trigger della regola `{id}` non può agganciare niente"
                )
            }
            SyntaxConflict::NothingProduced(id) => {
                write!(
                    f,
                    "la regola `{id}` non dichiara nessun `produces`, quindi tutto ciò \
                     che emettesse verrebbe scartato"
                )
            }
            SyntaxConflict::Claimed {
                format,
                claim,
                incumbent,
                challenger,
            } => write!(
                f,
                "`{challenger}` rivendica `{claim}` su `{format}`, che è già di `{incumbent}`"
            ),
        }
    }
}

#[derive(Clone)]
struct Registered {
    spec: SyntaxRuleSpec,
    rule: Arc<dyn SyntaxRule>,
}

/// Una vista immutabile delle forme dichiarate, pubblicata dopo ogni mutazione.
/// Clonarla è O(1): i lettori non prendono in prestito il registro che scrive.
#[derive(Clone, Default)]
pub struct SyntaxSnapshot {
    by_format: Arc<HashMap<String, Vec<SyntaxForm>>>,
}

impl SyntaxSnapshot {
    pub fn forms(&self, format: &str) -> &[SyntaxForm] {
        self.by_format.get(format).map(Vec::as_slice).unwrap_or(&[])
    }
}

/// Le regole innestate, per formato.
#[derive(Clone, Default)]
pub struct SyntaxRegistry {
    /// In ordine di applicazione: `order` crescente, i pari merito nell'ordine
    /// di registrazione.
    rules: Vec<Registered>,
    /// `(formato, chiave di contesa)` → id di chi l'ha presa.
    claims: HashMap<(String, String), String>,
    /// La proiezione di sola lettura consegnata al canale dati.
    snapshot: SyntaxSnapshot,
}

impl SyntaxRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra una regola, o dice **perché no**.
    ///
    /// Restituisce un `Result` e non `()` di proposito: chi monta l'app deve
    /// decidere cosa fare di un conflitto, e non può decidere ciò di cui non
    /// viene informato.
    pub fn register(&mut self, rule: Box<dyn SyntaxRule>) -> Result<(), SyntaxConflict> {
        let spec = rule.spec();
        if OptionMap::ns_of(&spec.id).is_none() {
            return Err(SyntaxConflict::UnnamespacedId(spec.id));
        }
        if self.rules.iter().any(|r| r.spec.id == spec.id) {
            return Err(SyntaxConflict::DuplicateId(spec.id));
        }
        let claims = spec.trigger.claims();
        if claims.is_empty() || claims.iter().any(|c| c.ends_with(':')) {
            return Err(SyntaxConflict::InertTrigger(spec.id));
        }
        if spec.produces.is_empty() {
            return Err(SyntaxConflict::NothingProduced(spec.id));
        }
        // Si controllano TUTTE le rivendicazioni prima di inserirne una: una
        // regola che ne prende tre e collide sulla terza non deve restare
        // registrata a metà.
        for claim in &claims {
            if let Some(incumbent) = self.claims.get(&(spec.format.clone(), claim.clone())) {
                return Err(SyntaxConflict::Claimed {
                    format: spec.format.clone(),
                    claim: claim.clone(),
                    incumbent: incumbent.clone(),
                    challenger: spec.id.clone(),
                });
            }
        }
        for claim in claims {
            self.claims
                .insert((spec.format.clone(), claim), spec.id.clone());
        }
        // L'inserimento tiene l'ordine dichiarato; a pari `order` vince chi si è
        // registrato prima, ed è l'unico criterio che non dipende dal caso.
        let at = self
            .rules
            .iter()
            .position(|r| r.spec.order > spec.order)
            .unwrap_or(self.rules.len());
        self.rules.insert(
            at,
            Registered {
                spec,
                rule: Arc::from(rule),
            },
        );
        self.publish_snapshot();
        Ok(())
    }

    /// Toglie una regola per id, con le rivendicazioni che si era presa (§9.4).
    /// `false` = non era registrata.
    ///
    /// Le rivendicazioni tornano libere, ed è il punto: una regola disattivata
    /// che continuasse a tenere `mermaid` su markdown impedirebbe a chiunque di
    /// prenderla, compresa sé stessa se la si riaccendesse.
    pub fn remove(&mut self, id: &str) -> bool {
        let Some(at) = self.rules.iter().position(|r| r.spec.id == id) else {
            return false;
        };
        self.rules.remove(at);
        self.claims.retain(|_, owner| owner != id);
        self.publish_snapshot();
        true
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    /// Le regole registrate, in ordine di applicazione.
    pub fn specs(&self) -> impl Iterator<Item = &SyntaxRuleSpec> {
        self.rules.iter().map(|r| &r.spec)
    }

    /// I `custom_kind` di **blocco** che qualcuno emette. È metà del conto del
    /// §3.2: l'altra metà è chi li disegna, e la differenza fra i due insiemi è
    /// l'elenco dei blocchi che l'utente leggerà crudi.
    ///
    /// Il conto è **esatto** perché `produces` è verificato dove si applica:
    /// ciò che una regola emette senza averlo dichiarato viene scartato, quindi
    /// questo elenco non può contenere un kind che non arriverà mai nel modello
    /// né mancarne uno che ci arriva.
    ///
    /// I kind **inline** non ci sono, e non è una dimenticanza: il registro dei
    /// renderer è dei blocchi, e un `Inline::Custom` lo disegna il provider nel
    /// suo degrado generico. Contarli qui vorrebbe dire segnalare come «senza
    /// renderer» qualcosa che un renderer non può avere — cioè un allarme che si
    /// impara a ignorare, che è il modo in cui un presidio muore.
    ///
    /// La divisione si legge dal **trigger** e non dal prodotto, perché è il
    /// trigger a decidere quale delle due passate applica la regola: un recinto
    /// può diventare solo un blocco, un delimitatore solo un inline.
    pub fn produced_kinds(&self) -> BTreeSet<String> {
        self.rules
            .iter()
            .filter(|r| matches!(r.spec.trigger, SyntaxTrigger::Fence { .. }))
            .flat_map(|r| r.spec.produces.iter().cloned())
            .collect()
    }

    /// Le sintassi che le regole registrate **innestano** su un formato: le
    /// chiavi di contesto che le accendono, come voci di una [`OptionMap`].
    ///
    /// Serve alle capacità *effettive* di
    /// [`DocumentFormat`](fub_abi::format::DocumentFormat) (§4.3): chi chiede
    /// cosa capisce un `.md` deve ricevere anche `fub:highlight`, che il
    /// provider markdown non sa fare e che una regola gli innesta sopra. La
    /// risposta contraria — le sole capacità del provider — sarebbe una verità
    /// di laboratorio, e rimetterebbe in piedi le due categorie di estensioni
    /// che la decisione 0017 ha rifiutato.
    ///
    /// Una regola senza `option` è sempre attiva e non compare: non ha un nome
    /// da accendere, quindi non c'è niente da dichiarare a chi chiede *cosa
    /// posso accendere*.
    pub fn grafted_syntax(&self, format: &str) -> OptionMap {
        self.rules
            .iter()
            .filter(|r| r.spec.format == format)
            .filter_map(|r| r.spec.option.as_deref())
            .fold(OptionMap::new(), |m, option| m.on(option))
    }

    /// La **forma dichiarata** delle sintassi innestate su un formato: il nome
    /// che le accende, e il trigger con cui si riconoscono (§4.4).
    ///
    /// È `grafted_syntax` che non butta via il trigger, e la differenza è tutta
    /// per chi sta dall'altra parte del confine: una `OptionMap` dice *che
    /// `fub:highlight` è acceso*, non che si scrive `==…==`. Finché diceva solo
    /// la prima, la shell il `==` se lo scriveva a mano — che è la §4.4 vista
    /// da vicino, e sta scritto nel doc di [`crate::syntax`]'s `HighlightRule`.
    ///
    /// Una regola senza `option` non compare, per la ragione di
    /// `grafted_syntax`: non ha un nome da accendere, quindi chi legge questo
    /// elenco non ha niente da dichiarare su di lei.
    pub fn forms(&self, format: &str) -> Vec<SyntaxForm> {
        self.snapshot.forms(format).to_vec()
    }

    /// Lo snapshot corrente. Chi lo conserva continua a vedere una fotografia
    /// coerente mentre una registrazione successiva pubblica quella nuova.
    pub fn snapshot(&self) -> SyntaxSnapshot {
        self.snapshot.clone()
    }

    fn publish_snapshot(&mut self) {
        let mut by_format: HashMap<String, Vec<SyntaxForm>> = HashMap::new();
        for registered in &self.rules {
            let Some(option) = &registered.spec.option else {
                continue;
            };
            by_format
                .entry(registered.spec.format.clone())
                .or_default()
                .push(SyntaxForm {
                    name: option.clone(),
                    trigger: Some(registered.spec.trigger.clone()),
                });
        }
        self.snapshot = SyntaxSnapshot {
            by_format: Arc::new(by_format),
        };
    }

    /// Applica le regole di questo formato al modello.
    ///
    /// Non restituisce un `Result`: una regola che fallisce **lascia il nodo
    /// com'era**, che è il degrado giusto — un'estensione rotta rende un
    /// documento meno ricco, non illeggibile.
    ///
    /// Il canale con cui quel fallimento arriva a una persona adesso esiste
    /// ([decisione 0052](../../../docs/decisions/0184-eventi-accodati-e-job.md)),
    /// e questo è uno dei punti che **non ci arrivano ancora**: per emettere un
    /// evento ci vuole il workspace, e qui siamo dentro il parse, che è
    /// `&self` e non ne ha uno. Farcelo risalire vuol dire dare un esito a
    /// `DocumentStore::parse` e a tutti i suoi otto chiamanti, cioè un lavoro
    /// che non è la forma del canale ma la sua adozione: è la casella che il
    /// §20.2 lascia dietro di sé, non un'altra decisione. Finché non è fatto,
    /// qui si stampa — e si stampa **dicendolo**, invece di ignorare un
    /// `Option` che il tipo obbliga a guardare.
    pub fn apply(&self, model: &mut DocumentModel, ctx: &ParseContext, format: &str) {
        if self.rules.is_empty() {
            return;
        }
        for r in &self.rules {
            if r.spec.format != format {
                continue;
            }
            if let Some(option) = &r.spec.option {
                if !ctx.enabled(option) {
                    continue;
                }
            }
            match &r.spec.trigger {
                SyntaxTrigger::Fence { info } => {
                    let wanted: Vec<String> =
                        info.iter().map(|the| the.to_lowercase()).collect();
                    apply_to_blocks(&mut model.body, &mut |block| {
                        fence_rule(block, r, &wanted, ctx)
                    });
                }
                SyntaxTrigger::Inline { open, close } => {
                    apply_to_blocks(&mut model.body, &mut |block| {
                        inline_rule(block, r, open, close, ctx);
                        None
                    });
                }
            }
        }
    }
}

/// Invoca una regola col boundary stretto attorno alla sola callback esterna.
/// Un errore o un panico fanno degradare **questa corrispondenza**: il prodotto
/// non viene mai applicato a metà, e la camminata può proseguire sulle altre.
fn invoke_rule(
    r: &Registered,
    matched: &SyntaxMatch,
    ctx: &ParseContext,
) -> Option<SyntaxProduct> {
    let mut outcome = None;
    if let Some(fault) = crate::safety::reporting(&r.spec.id, Gate::SyntaxRule, "", || {
        outcome = Some(r.rule.apply(matched, ctx));
    }) {
        // Una regola sintattica che pania è un difetto di chi l'ha scritta, e
        // il posto giusto è il log — non il canale degli eventi. Non si perde
        // sorgente: questa corrispondenza resta nel modello nella forma base.
        tracing::warn!(target: "fub.kernel", "regola sintattica `{rule}` in panico: {fault}", rule = r.spec.id);
        return None;
    }
    outcome.and_then(std::result::Result::ok).flatten()
}

/// Un blocco recintato che questa regola rivendica diventa il suo prodotto.
fn fence_rule(
    block: &Block,
    r: &Registered,
    wanted: &[String],
    ctx: &ParseContext,
) -> Option<Block> {
    let Block::CodeBlock {
        lang: Some(lang),
        code,
        anchor,
        span,
    } = block
    else {
        return None;
    };
    let lang = lang.to_lowercase();
    if !wanted.contains(&lang) {
        return None;
    }
    let m = SyntaxMatch {
        trigger: format!("fence:{lang}"),
        text: code.clone(),
        span: *span,
    };
    // Un errore e un «no grazie» finiscono nello stesso posto: il nodo resta.
    let SyntaxProduct::Block {
        custom_kind,
        attrs,
        blocks,
    } = invoke_rule(r, &m, ctx)?
    else {
        // Una regola su recinto che restituisse un inline sta sbagliando forma:
        // il recinto è un blocco, e non c'è dove mettere un inline al suo posto.
        return None;
    };
    if !r.spec.produces.contains(&custom_kind) {
        return None;
    }
    Some(Block::Custom {
        custom_kind,
        attrs,
        blocks,
        anchor: anchor.clone(),
        span: *span,
    })
}

/// I tratti di testo fra due delimitatori diventano `Inline::Custom`.
fn inline_rule(block: &mut Block, r: &Registered, open: &str, close: &str, ctx: &ParseContext) {
    with_inlines(block, &mut |inlines, span| {
        split_inlines(inlines, r, open, close, ctx, span);
    });
}

fn split_inlines(
    inlines: &mut Vec<Inline>,
    r: &Registered,
    open: &str,
    close: &str,
    ctx: &ParseContext,
    span: Span,
) {
    let mut out: Vec<Inline> = Vec::with_capacity(inlines.len());
    for inline in std::mem::take(inlines) {
        match inline {
            Inline::Text(text) => split_text(&text, r, open, close, ctx, span, &mut out),
            Inline::Emph(mut children) => {
                split_inlines(&mut children, r, open, close, ctx, span);
                out.push(Inline::Emph(children));
            }
            Inline::Strong(mut children) => {
                split_inlines(&mut children, r, open, close, ctx, span);
                out.push(Inline::Strong(children));
            }
            // L'apice e il barrato sono contenitori come l'enfasi: ciò che
            // vale dentro un paragrafo vale dentro `^…^` e `~~…~~`.
            Inline::Superscript(mut children) => {
                split_inlines(&mut children, r, open, close, ctx, span);
                out.push(Inline::Superscript(children));
            }
            Inline::Strikethrough(mut children) => {
                split_inlines(&mut children, r, open, close, ctx, span);
                out.push(Inline::Strikethrough(children));
            }
            // L'etichetta di un link è testo che l'utente legge, e ciò che vale
            // in un paragrafo vale lì dentro: `[==qui==](url)` deve evidenziare
            // come `==qui==` fuori, o la stessa sintassi funzionerebbe a
            // seconda di dove capita. Lo span è quello del link, che è più
            // stretto di quello del contenitore — è il meglio che il kernel
            // conosca onestamente qui.
            //
            // Un **embed** no: `![[img|100]]` non porta un'etichetta da
            // leggere ma un parametro per chi lo incorpora, e interpretarci una
            // sintassi vorrebbe dire riscrivere un argomento.
            Inline::Link {
                target,
                label: Some(mut label),
                embed: false,
                span: link_span,
            } => {
                split_inlines(&mut label, r, open, close, ctx, link_span);
                out.push(Inline::Link {
                    target,
                    label: Some(label),
                    embed: false,
                    span: link_span,
                });
            }
            // `Code` no: dentro un `code` la sintassi non si interpreta, ed è la
            // ragione per cui il codice si scrive fra backtick.
            other => out.push(other),
        }
    }
    *inlines = out;
}

fn split_text(
    text: &str,
    r: &Registered,
    open: &str,
    close: &str,
    ctx: &ParseContext,
    span: Span,
    out: &mut Vec<Inline>,
) {
    let mut rest = text;
    let mut matched = false;
    while let Some(the) = rest.find(open) {
        let after = the + open.len();
        let Some(j) = rest[after..].find(close).map(|j| after + j) else {
            break;
        };
        let inner = &rest[after..j];
        let m = SyntaxMatch {
            trigger: format!("inline:{open}"),
            text: inner.to_string(),
            span,
        };
        // Un kind che la regola non ha dichiarato è come un rifiuto: `produces`
        // è un contratto, e ciò che non c'è dentro non entra nel modello.
        let product = match invoke_rule(r, &m, ctx) {
            Some(SyntaxProduct::Inline { custom_kind, attrs })
                if r.spec.produces.contains(&custom_kind) =>
            {
                Some((custom_kind, attrs))
            }
            _ => None,
        };
        let Some((custom_kind, attrs)) = product else {
            // Declina o fallisce: si salta l'apertura e si continua a cercare,
            // invece di fermarsi — un `$` isolato non deve spegnere la regola
            // per il resto del paragrafo.
            let (head, tail) = rest.split_at(after);
            out.push(Inline::Text(head.to_string()));
            rest = tail;
            matched = true;
            continue;
        };
        if the > 0 {
            out.push(Inline::Text(rest[..the].to_string()));
        }
        out.push(Inline::Custom {
            custom_kind,
            attrs,
            span,
        });
        rest = &rest[j + close.len()..];
        matched = true;
    }
    if !rest.is_empty() || !matched {
        out.push(Inline::Text(rest.to_string()));
    }
}

/// Cammina i blocchi in profondità. `f` può **sostituire** il blocco che riceve
/// — uno per uno, mai aggiungerne o toglierne, ed è per questo che basta uno
/// slice: una regola riscrive un nodo, non ristruttura il documento.
/// i figli si visitano comunque, così una regola raggiunge anche ciò che sta
/// dentro una citazione o una voce di elenco.
fn apply_to_blocks(blocks: &mut [Block], f: &mut dyn FnMut(&mut Block) -> Option<Block>) {
    for block in blocks.iter_mut() {
        if let Some(replacement) = f(block) {
            *block = replacement;
        }
        match block {
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                apply_to_blocks(blocks, f)
            }
            Block::List { items, .. } => {
                for ListItem { blocks, .. } in items.iter_mut() {
                    apply_to_blocks(blocks, f);
                }
            }
            _ => {}
        }
    }
}

/// Applica `f` a ogni sequenza di inline del blocco (non dei figli: quelli li
/// raggiunge [`apply_to_blocks`]), insieme allo **span più stretto che il kernel
/// conosce onestamente** per quella sequenza.
///
/// Che è quello del contenitore, e non quello del tratto agganciato: `Inline::Text`
/// non porta uno span, quindi dopo il parse non esiste più il modo di risalire
/// agli offset di un pezzo di testo dentro un paragrafo. Per una cella di
/// tabella lo span è quello della cella, che è già più stretto del blocco. Il
/// limite è dichiarato anche nel doc di `SyntaxMatch`, ed è il motivo per cui la
/// forma esatta è un debito del modello (uno span su `Inline::Text`) e non di
/// questo registro.
fn with_inlines(block: &mut Block, f: &mut dyn FnMut(&mut Vec<Inline>, Span)) {
    let span = block.span();
    match block {
        Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } => f(inlines, span),
        Block::Table { head, rows, .. } => {
            for TableRow { cells } in head.iter_mut().chain(rows.iter_mut()) {
                for cell in cells.iter_mut() {
                    let cell_span = cell.span;
                    f(&mut cell.inlines, cell_span);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use fub_abi::custom::SyntaxTrigger;
    use fub_abi::error::FormatError;
    use fub_abi::model::DocId;
    use serde_json::json;

    /// Una regola che prende ```` ```mermaid ```` e ne fa un blocco custom.
    struct Mermaid {
        id: &'static str,
    }

    impl SyntaxRule for Mermaid {
        fn spec(&self) -> SyntaxRuleSpec {
            SyntaxRuleSpec {
                id: self.id.to_string(),
                format: "markdown".into(),
                trigger: SyntaxTrigger::Fence {
                    info: vec!["mermaid".into()],
                },
                order: 0,
                option: None,
                produces: vec!["prova:mermaid".into()],
            }
        }
        fn apply(
            &self,
            m: &SyntaxMatch,
            _ctx: &ParseContext,
        ) -> Result<Option<SyntaxProduct>, FormatError> {
            Ok(Some(SyntaxProduct::Block {
                custom_kind: "prova:mermaid".into(),
                attrs: json!({ "source": m.text }),
                blocks: vec![],
            }))
        }
    }

    fn model_with(body: Vec<Block>) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new("a.md"));
        m.body = body;
        m
    }

    fn fence(lang: &str, code: &str) -> Block {
        Block::CodeBlock {
            lang: Some(lang.into()),
            code: code.into(),
            anchor: None,
            span: Span::new(0, code.len()),
        }
    }

    #[test]
    fn a_rule_is_attaches_on_a_provider_that_not_the_knows() {
        let mut reg = SyntaxRegistry::new();
        reg.register(Box::new(Mermaid {
            id: "prova:mermaid",
        }))
        .expect("si registra");
        let mut model = model_with(vec![fence("mermaid", "graph TD;")]);
        reg.apply(&mut model, &ParseContext::obsidian("a.md"), "markdown");
        match &model.body[0] {
            Block::Custom {
                custom_kind, attrs, ..
            } => {
                assert_eq!(custom_kind, "prova:mermaid");
                assert_eq!(attrs["source"], "graph TD;");
            }
            other => panic!("atteso un blocco custom, trovato {other:?}"),
        }
    }

    #[test]
    fn a_rule_of_a_other_format_not_touches_nothing() {
        let mut reg = SyntaxRegistry::new();
        reg.register(Box::new(Mermaid {
            id: "prova:mermaid",
        }))
        .unwrap();
        let mut model = model_with(vec![fence("mermaid", "graph TD;")]);
        reg.apply(&mut model, &ParseContext::obsidian("a.md"), "org-mode");
        assert!(matches!(model.body[0], Block::CodeBlock { .. }));
    }

    #[test]
    fn two_rules_on_the_same_syntax_not_is_register_in_silence() {
        let mut reg = SyntaxRegistry::new();
        reg.register(Box::new(Mermaid { id: "uno:mermaid" }))
            .unwrap();
        let err = reg
            .register(Box::new(Mermaid { id: "due:mermaid" }))
            .expect_err("la seconda rivendica la stessa sintassi");
        assert_eq!(
            err,
            SyntaxConflict::Claimed {
                format: "markdown".into(),
                claim: "fence:mermaid".into(),
                incumbent: "uno:mermaid".into(),
                challenger: "due:mermaid".into(),
            }
        );
        // E la perdente non è rimasta registrata a metà.
        assert_eq!(reg.specs().count(), 1);
    }

    #[test]
    fn a_id_without_namespace_and_rejected() {
        let mut reg = SyntaxRegistry::new();
        let err = reg
            .register(Box::new(Mermaid { id: "mermaid" }))
            .expect_err("serve `ns:nome`");
        assert_eq!(err, SyntaxConflict::UnnamespacedId("mermaid".into()));
    }

    /// Dichiara di produrre una cosa e ne emette un'altra — quella del core.
    struct Bugiarda {
        produces: Vec<String>,
        emits: &'static str,
    }

    impl SyntaxRule for Bugiarda {
        fn spec(&self) -> SyntaxRuleSpec {
            SyntaxRuleSpec {
                id: "terzi:bugiarda".into(),
                format: "markdown".into(),
                trigger: SyntaxTrigger::Fence {
                    info: vec!["bugia".into()],
                },
                order: 0,
                option: None,
                produces: self.produces.clone(),
            }
        }
        fn apply(
            &self,
            _m: &SyntaxMatch,
            _ctx: &ParseContext,
        ) -> Result<Option<SyntaxProduct>, FormatError> {
            Ok(Some(SyntaxProduct::Block {
                custom_kind: self.emits.into(),
                attrs: json!({}),
                blocks: vec![],
            }))
        }
    }

    #[test]
    fn a_kind_not_declared_not_enters_in_the_model() {
        let mut reg = SyntaxRegistry::new();
        reg.register(Box::new(Bugiarda {
            produces: vec!["terzi:onesto".into()],
            // `callout` è del core: senza il controllo su `produces`, questa
            // regola si farebbe disegnare dal provider come un callout vero.
            emits: "callout",
        }))
        .expect("si registra: la bugia si vede solo quando emette");
        let mut model = model_with(vec![fence("bugia", "x")]);
        reg.apply(&mut model, &ParseContext::obsidian("a.md"), "markdown");
        assert!(
            matches!(model.body[0], Block::CodeBlock { .. }),
            "il prodotto non dichiarato si scarta e il nodo resta: {:?}",
            model.body[0]
        );
    }

    #[test]
    fn a_kind_declared_enters_and_proof_that_the_test_of_above_not_and_empty() {
        let mut reg = SyntaxRegistry::new();
        reg.register(Box::new(Bugiarda {
            produces: vec!["terzi:onesto".into()],
            emits: "terzi:onesto",
        }))
        .unwrap();
        let mut model = model_with(vec![fence("bugia", "x")]);
        reg.apply(&mut model, &ParseContext::obsidian("a.md"), "markdown");
        assert!(
            matches!(&model.body[0], Block::Custom { custom_kind, .. } if custom_kind == "terzi:onesto")
        );
    }

    #[test]
    fn a_rule_that_not_produce_nothing_not_is_registers() {
        let mut reg = SyntaxRegistry::new();
        let err = reg
            .register(Box::new(Bugiarda {
                produces: vec![],
                emits: "terzi:onesto",
            }))
            .expect_err("senza `produces` la regola non potrebbe emettere niente");
        assert_eq!(
            err,
            SyntaxConflict::NothingProduced("terzi:bugiarda".into())
        );
    }

    struct PanicsOnceInline {
        calls: Arc<AtomicUsize>,
    }

    impl SyntaxRule for PanicsOnceInline {
        fn spec(&self) -> SyntaxRuleSpec {
            SyntaxRuleSpec {
                id: "prova:panico-inline".into(),
                format: "markdown".into(),
                trigger: SyntaxTrigger::Inline {
                    open: "==".into(),
                    close: "==".into(),
                },
                order: 0,
                option: None,
                produces: vec!["prova:evidenza".into()],
            }
        }

        fn apply(
            &self,
            _: &SyntaxMatch,
            _: &ParseContext,
        ) -> Result<Option<SyntaxProduct>, FormatError> {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("panico sintattico intenzionale");
            }
            Ok(Some(SyntaxProduct::Inline {
                custom_kind: "prova:evidenza".into(),
                attrs: json!({}),
            }))
        }
    }

    fn inline_model() -> DocumentModel {
        model_with(vec![Block::Paragraph {
            inlines: vec![Inline::Text("prima ==boom== poi ==bene== fine".into())],
            anchor: None,
            span: Span::EMPTY,
        }])
    }

    #[test]
    fn a_syntax_panic_does_not_empty_the_inline_and_the_rule_is_reusable() {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut reg = SyntaxRegistry::new();
        reg.register(Box::new(PanicsOnceInline {
            calls: Arc::clone(&calls),
        }))
        .expect("the rule registers");

        let mut first = inline_model();
        reg.apply(&mut first, &ParseContext::obsidian("a.md"), "markdown");
        let Block::Paragraph { inlines, .. } = &first.body[0] else {
            panic!("the paragraph remains a paragraph");
        };
        assert!(matches!(&inlines[0], Inline::Text(text) if text == "prima =="));
        assert!(matches!(&inlines[1], Inline::Text(text) if text == "boom== poi "));
        assert!(matches!(
            &inlines[2],
            Inline::Custom { custom_kind, .. } if custom_kind == "prova:evidenza"
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 2);

        let mut next = inline_model();
        reg.apply(&mut next, &ParseContext::obsidian("a.md"), "markdown");
        let Block::Paragraph { inlines, .. } = &next.body[0] else {
            panic!("the next paragraph remains readable");
        };
        assert_eq!(
            inlines
                .iter()
                .filter(|inline| matches!(inline, Inline::Custom { .. }))
                .count(),
            2,
            "the same rule handles both matches on the next model"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 4);
    }
}
