//! Modello persistito `.base`: YAML con campi sconosciuti tollerati e
//! versioni future rifiutate con errore tipizzato (mai valori inventati).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use fub_abi::rules::yaml;
use fub_abi::FormatError;

pub const BASE_FORMAT_ID: &str = "base";
pub const BASE_SCHEMA_VERSION: u32 = 1;

/// Limiti dichiarati del formato persistito.
pub const MAX_BASE_SOURCE_BYTES: usize = 1024 * 1024;
pub const MAX_DEFINITION_BYTES: usize = 256 * 1024;
pub const MAX_VIEWS: usize = 64;
pub const MAX_COLUMNS: usize = 128;
pub const MAX_FORMULA_DEFS: usize = 256;
pub const MAX_FILTER_BYTES: usize = 64 * 1024;
pub const MAX_VIEW_BYTES: usize = 64 * 1024;
pub const MAX_SUMMARIES: usize = 32;

#[derive(Debug, Error)]
pub enum BaseError {
    #[error("sorgente .base oltre il limite di {limit} byte ({what})")]
    Limit { what: &'static str, limit: usize },
    #[error(".base senza versione numerica")]
    MissingVersion,
    #[error("versione .base {0} non supportata (supportata: 1)")]
    UnsupportedVersion(u64),
    #[error(".base non valido: {0}")]
    Invalid(String),
    #[error("yaml .base non valido: {0}")]
    Yaml(String),
}

impl From<BaseError> for FormatError {
    fn from(error: BaseError) -> Self {
        match error {
            BaseError::Limit { .. } => FormatError::Parse(error.to_string()),
            BaseError::MissingVersion | BaseError::UnsupportedVersion(_) => {
                FormatError::Parse(error.to_string())
            }
            BaseError::Invalid(_) | BaseError::Yaml(_) => FormatError::Parse(error.to_string()),
        }
    }
}

/// Una definizione `.base` come sta sul disco: YAML con `version` numerica,
/// sezioni note tipizzate e tutto il resto conservato in `extra` (campi
/// sconosciuti e versioni future non vengono mai interpretati in silenzio).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaseDefinition {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub filters: FilterDef,
    #[serde(default)]
    pub formulas: Vec<FormulaDef>,
    #[serde(default)]
    pub properties: Vec<ColumnDef>,
    #[serde(default)]
    pub views: Vec<BaseViewDef>,
    /// Campi sconosciuti conservati verbatim (mai interpretati).
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, Value>,
}

fn default_version() -> u32 {
    BASE_SCHEMA_VERSION
}

impl BaseDefinition {
    pub fn parse(source: &str) -> Result<Self, BaseError> {
        if source.len() > MAX_BASE_SOURCE_BYTES {
            return Err(BaseError::Limit {
                what: "source bytes",
                limit: MAX_BASE_SOURCE_BYTES,
            });
        }
        if !yaml::within_budget(source) {
            return Err(BaseError::Yaml(yaml::OVER_BUDGET.to_string()));
        }
        let value: Value =
            serde_yaml_ng::from_str(source).map_err(|error| BaseError::Yaml(error.to_string()))?;
        let version = value
            .get("version")
            .and_then(Value::as_u64)
            .unwrap_or(u64::from(BASE_SCHEMA_VERSION));
        if version != u64::from(BASE_SCHEMA_VERSION) {
            return Err(BaseError::UnsupportedVersion(version));
        }
        let mut definition: BaseDefinition =
            serde_json::from_value(value).map_err(|error| BaseError::Invalid(error.to_string()))?;
        definition.version = BASE_SCHEMA_VERSION;
        for view in &mut definition.views {
            view.resolve();
        }
        definition.validate()?;
        Ok(definition)
    }

    pub fn validate(&self) -> Result<(), BaseError> {
        if self.version != BASE_SCHEMA_VERSION {
            return Err(BaseError::UnsupportedVersion(u64::from(self.version)));
        }
        if self.views.len() > MAX_VIEWS {
            return Err(BaseError::Limit {
                what: "views",
                limit: MAX_VIEWS,
            });
        }
        if self.properties.len() > MAX_COLUMNS {
            return Err(BaseError::Limit {
                what: "columns",
                limit: MAX_COLUMNS,
            });
        }
        if self.formulas.len() > MAX_FORMULA_DEFS {
            return Err(BaseError::Limit {
                what: "formulas",
                limit: MAX_FORMULA_DEFS,
            });
        }
        let filters_bytes = serde_json::to_string(&self.filters)
            .map_err(|error| BaseError::Invalid(error.to_string()))?
            .len();
        if filters_bytes > MAX_FILTER_BYTES {
            return Err(BaseError::Limit {
                what: "filters bytes",
                limit: MAX_FILTER_BYTES,
            });
        }
        let mut names = std::collections::HashSet::new();
        for view in &self.views {
            if view.name.trim().is_empty() {
                return Err(BaseError::Invalid("view senza nome".to_string()));
            }
            if !names.insert(view.name.clone()) {
                return Err(BaseError::Invalid(format!(
                    "vista duplicata {:?}",
                    view.name
                )));
            }
            view.validate()?;
        }
        let mut formula_names = std::collections::HashSet::new();
        for formula in &self.formulas {
            if formula.name.trim().is_empty() {
                return Err(BaseError::Invalid("formula senza nome".to_string()));
            }
            if !formula_names.insert(formula.name.clone()) {
                return Err(BaseError::Invalid(format!(
                    "formula duplicata {:?}",
                    formula.name
                )));
            }
            if formula.expression.len() > crate::formula::MAX_FORMULA_BYTES {
                return Err(BaseError::Limit {
                    what: "formula bytes",
                    limit: crate::formula::MAX_FORMULA_BYTES,
                });
            }
        }
        Ok(())
    }

    /// La definizione minima vuota (nessun filtro = tutto il vault).
    pub fn empty() -> Self {
        BaseDefinition {
            version: BASE_SCHEMA_VERSION,
            filters: FilterDef::default(),
            formulas: Vec::new(),
            properties: Vec::new(),
            views: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }
}

/// Filtro globale o per-vista: congiunzione/disgiunzione/negazione di
/// condizioni su proprietà, tag, cartelle, testo e formule.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterDef {
    #[default]
    All,
    And(Vec<FilterDef>),
    Or(Vec<FilterDef>),
    Not(Box<FilterDef>),
    /// `key`, operatore, valore: es. `{ property: "status", op: "is", value: "done" }`.
    Condition {
        #[serde(default)]
        property: Option<String>,
        #[serde(default)]
        file: Option<String>,
        #[serde(default)]
        formula: Option<String>,
        #[serde(default)]
        tag: Option<String>,
        op: FilterOp,
        #[serde(default)]
        value: Value,
    },
}

/// Operatori di filtro supportati (sottoinsieme chiuso e documentato).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOp {
    #[default]
    Is,
    IsNot,
    Contains,
    NotContains,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    IsEmpty,
    IsNotEmpty,
    InFolder,
    HasTag,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FormulaDef {
    pub name: String,
    pub expression: String,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ColumnDef {
    pub key: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub width: Option<f32>,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, Value>,
}

/// Una vista nominata: tipo, colonne, filtro locale, sort/group, limite.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaseViewDef {
    pub name: String,
    #[serde(rename = "type")]
    pub view_type: ViewType,
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub filters: FilterDef,
    #[serde(default)]
    pub sort: Vec<SortDef>,
    #[serde(default)]
    pub group: Option<GroupDef>,
    #[serde(default)]
    pub summaries: Vec<SummaryDef>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub map: Option<MapDef>,
    /// Il blocco `fub:`: le chiavi di una vista di calendario o di linea del
    /// tempo, che Obsidian ignora (vedi [`FubViewDef`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fub: Option<FubViewDef>,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, Value>,
}

impl BaseViewDef {
    /// Il tipo di vista che Fub legge. Una vista scritta `type: table` con
    /// `fub.view` è un calendario o una linea del tempo (la forma di ripiego
    /// di [`disk_form`]); con un altro `type` la chiave `fub.view` non vale.
    pub fn resolve(&mut self) {
        if self.view_type == ViewType::Table {
            if let Some(view) = self.fub.as_ref().and_then(|fub| fub.view) {
                self.view_type = view.into();
            }
        }
    }

    fn validate(&self) -> Result<(), BaseError> {
        if let Some(fub) = &self.fub {
            for (name, key) in [
                ("date", &fub.date),
                ("start", &fub.start),
                ("end", &fub.end),
            ] {
                if key.as_ref().is_some_and(|key| key.trim().is_empty()) {
                    return Err(BaseError::Invalid(format!("fub.{name} senza proprietà")));
                }
            }
        }
        if self.order.len() > MAX_COLUMNS {
            return Err(BaseError::Limit {
                what: "view columns",
                limit: MAX_COLUMNS,
            });
        }
        if self.sort.len() > MAX_COLUMNS {
            return Err(BaseError::Limit {
                what: "view sorts",
                limit: MAX_COLUMNS,
            });
        }
        if self.summaries.len() > MAX_SUMMARIES {
            return Err(BaseError::Limit {
                what: "summaries",
                limit: MAX_SUMMARIES,
            });
        }
        let mut summary_names = std::collections::HashSet::new();
        for summary in &self.summaries {
            if summary.key.trim().is_empty() {
                return Err(BaseError::Invalid("riepilogo senza chiave".into()));
            }
            if summary
                .name
                .as_ref()
                .is_some_and(|name| name.trim().is_empty())
            {
                return Err(BaseError::Invalid("riepilogo senza nome".into()));
            }
            let label = summary.name.clone().unwrap_or_else(|| {
                format!("{}:{:?}", summary.key, summary.aggregate).to_lowercase()
            });
            if !summary_names.insert(label) {
                return Err(BaseError::Invalid("riepilogo duplicato".into()));
            }
            if summary
                .expression
                .as_ref()
                .is_some_and(|expression| expression.len() > crate::formula::MAX_FORMULA_BYTES)
            {
                return Err(BaseError::Limit {
                    what: "summary formula bytes",
                    limit: crate::formula::MAX_FORMULA_BYTES,
                });
            }
        }
        if let Some(limit) = self.limit {
            if limit == 0 || limit > 10_000 {
                return Err(BaseError::Invalid(format!(
                    "limite vista {limit} fuori 1..=10000"
                )));
            }
        }
        let bytes = serde_json::to_string(self)
            .map_err(|error| BaseError::Invalid(error.to_string()))?
            .len();
        if bytes > MAX_VIEW_BYTES {
            return Err(BaseError::Limit {
                what: "view bytes",
                limit: MAX_VIEW_BYTES,
            });
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewType {
    #[default]
    Table,
    Cards,
    List,
    Kanban,
    Map,
    /// Un mese di note nei giorni della proprietà `fub.date`.
    Calendar,
    /// Le note come barre fra `fub.start` e `fub.end`.
    Timeline,
}

/// Il tipo che la forma di ripiego porta in `fub.view`: solo calendario e
/// linea del tempo, perché gli altri tipi Obsidian li legge da sé.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FubView {
    Calendar,
    Timeline,
}

impl From<FubView> for ViewType {
    fn from(view: FubView) -> Self {
        match view {
            FubView::Calendar => ViewType::Calendar,
            FubView::Timeline => ViewType::Timeline,
        }
    }
}

/// Il blocco `fub:` di una vista: le chiavi che Fub aggiunge a una vista
/// che Obsidian non conosce. Obsidian ignora la chiave intera; Fub legge
/// `view` solo con `type: table`, e le chiavi della data in ogni forma.
/// Le chiavi che questa versione non conosce restano in `extra`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FubViewDef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<FubView>,
    /// Il nome della proprietà data del calendario.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    /// Il nome della proprietà d'inizio della linea del tempo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    /// Il nome della proprietà di fine della linea del tempo, facoltativa.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, Value>,
}

/// La forma su disco di un tipo di vista: il valore di `type` e, se il tipo
/// non lo porta da sé, `fub.view`.
///
/// È il ripiego di Q3 (T17a): finché la prova con Obsidian non dice che
/// Obsidian regge `calendar` e `timeline`, Fub scrive `table` con `fub.view`.
/// Passare alla forma nativa è cambiare queste due righe in
/// `(ViewType::Calendar, None)` e `(ViewType::Timeline, None)`: la lettura
/// accetta già entrambe le forme.
pub fn disk_form(view_type: ViewType) -> (ViewType, Option<FubView>) {
    match view_type {
        ViewType::Calendar => (ViewType::Table, Some(FubView::Calendar)),
        ViewType::Timeline => (ViewType::Table, Some(FubView::Timeline)),
        other => (other, None),
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SortDef {
    pub key: String,
    #[serde(default)]
    pub descending: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GroupDef {
    pub key: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SummaryDef {
    pub key: String,
    pub aggregate: AggregateKind,
    /// Espressione per riga aggregata sulle righe filtrate prima del limite;
    /// senza espressione viene usata la colonna `key`.
    #[serde(default)]
    pub expression: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregateKind {
    Count,
    CountFilled,
    CountEmpty,
    CountUnique,
    Sum,
    Average,
    Min,
    Max,
    Earliest,
    Latest,
    Checked,
    Unchecked,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MapDef {
    pub lat_key: String,
    pub lon_key: String,
    #[serde(default)]
    pub label_key: Option<String>,
    #[serde(default)]
    pub color_key: Option<String>,
    #[serde(default)]
    pub provider: Option<MapProvider>,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MapProvider {
    pub kind: MapProviderKind,
    #[serde(default)]
    pub url_template: Option<String>,
    #[serde(default)]
    pub attribution: Option<String>,
    /// Opt-in esplicito alla rete per i tile: senza, la mappa resta offline
    /// (marker su griglia locale, nessun fetch).
    #[serde(default)]
    pub network: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MapProviderKind {
    #[default]
    Offline,
    Raster,
    Vector,
}

/// Documento `.base` con viste derivate per l'indice (non persistito).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaseDocumentView {
    pub base: String,
    pub view: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn campi_sconosciuti_conservati_versioni_future_rifiutate() {
        let def = BaseDefinition::parse(
            "filters:\n  and: []\ncampo_futuro:\n  x: 1\nviews:\n  - name: A\n    type: table\n",
        )
        .unwrap();
        assert!(def.extra.contains_key("campo_futuro"));
        let err = BaseDefinition::parse("version: 99\nfilters: ~\n").unwrap_err();
        assert!(matches!(err, BaseError::UnsupportedVersion(99)));
    }

    #[test]
    fn vista_duplicata_e_limite_rifiutati() {
        let err = BaseDefinition::parse(
            "views:\n  - {name: A, type: table}\n  - {name: A, type: list}\n",
        )
        .unwrap_err();
        assert!(matches!(err, BaseError::Invalid(_)));
        let err =
            BaseDefinition::parse("views:\n  - {name: A, type: table, limit: 0}\n").unwrap_err();
        assert!(matches!(err, BaseError::Invalid(_)));
    }

    #[test]
    fn yaml_rotto_e_un_errore_non_un_default() {
        let err = BaseDefinition::parse("filters: [non chiuso\n").unwrap_err();
        assert!(matches!(err, BaseError::Yaml(_)));
    }

    /// Un annidamento che libyaml pagherebbe in tempo quadratico (un mega di
    /// `[` sono minuti) non arriva al parser.
    #[test]
    fn yaml_troppo_annidato_rifiutato_prima_del_parser() {
        let source = format!("filters: {}", "[".repeat(100_000));
        let err = BaseDefinition::parse(&source).unwrap_err();
        assert!(
            matches!(&err, BaseError::Yaml(reason) if reason == yaml::OVER_BUDGET),
            "{err:?}"
        );
    }
    #[test]
    fn summaries_are_bounded_and_duplicate_names_do_not_overwrite() {
        let repeated =
            "      - {name: Revenue, key: score, aggregate: sum, expression: 'prop.score * 2'}\n";
        let source = format!(
            "views:\n  - name: A\n    type: table\n    summaries:\n{}",
            repeated.repeat(MAX_SUMMARIES + 1)
        );
        assert!(matches!(
            BaseDefinition::parse(&source),
            Err(BaseError::Limit {
                what: "summaries",
                ..
            })
        ));
        let duplicate = format!(
            "views:\n  - name: A\n    type: table\n    summaries:\n{}",
            repeated.repeat(2)
        );
        assert!(matches!(
            BaseDefinition::parse(&duplicate),
            Err(BaseError::Invalid(_))
        ));
    }

    fn view_of(source: &str) -> BaseViewDef {
        BaseDefinition::parse(source).unwrap().views.remove(0)
    }

    /// La stessa vista nelle due forme dà lo stesso modello: la nativa
    /// (`type: calendar`) e il ripiego (`type: table` con `fub.view`).
    #[test]
    fn calendario_e_linea_del_tempo_nelle_due_forme() {
        let native =
            view_of("views:\n  - name: C\n    type: calendar\n    fub: {date: scadenza}\n");
        let fallback = view_of(
            "views:\n  - name: C\n    type: table\n    fub: {view: calendar, date: scadenza}\n",
        );
        assert_eq!(native.view_type, ViewType::Calendar);
        assert_eq!(fallback.view_type, ViewType::Calendar);
        // La forma nativa non porta `view`: il resto del blocco è lo stesso.
        for view in [&native, &fallback] {
            assert_eq!(
                view.fub.as_ref().and_then(|fub| fub.date.as_deref()),
                Some("scadenza")
            );
        }

        let timeline = view_of(
            "views:\n  - name: L\n    type: table\n    fub: {view: timeline, start: inizio, end: fine}\n",
        );
        assert_eq!(timeline.view_type, ViewType::Timeline);
        let fub = timeline.fub.expect("il blocco fub");
        assert_eq!(
            (fub.start.as_deref(), fub.end.as_deref()),
            (Some("inizio"), Some("fine"))
        );
    }

    /// Un Fub vecchio legge la forma di ripiego come tabella, e la forma
    /// senza `fub:` resta una tabella com'era.
    #[test]
    fn tabella_senza_fub_resta_tabella() {
        assert_eq!(
            view_of("views:\n  - name: T\n    type: table\n").view_type,
            ViewType::Table
        );
        assert!(view_of("views:\n  - name: T\n    type: table\n")
            .fub
            .is_none());
    }

    /// `fub.view` vale solo con `type: table`: con un altro tipo è ignorato.
    #[test]
    fn fub_view_con_un_altro_tipo_non_vale() {
        let cards = view_of("views:\n  - name: C\n    type: cards\n    fub: {view: calendar}\n");
        assert_eq!(cards.view_type, ViewType::Cards);
    }

    /// Un tipo di vista che questa versione non conosce è un errore, come
    /// prima; un `fub.view` sconosciuto anche.
    #[test]
    fn tipo_sconosciuto_resta_un_errore() {
        assert!(matches!(
            BaseDefinition::parse("views:\n  - name: G\n    type: gallery\n"),
            Err(BaseError::Invalid(_))
        ));
        assert!(matches!(
            BaseDefinition::parse(
                "views:\n  - name: G\n    type: table\n    fub: {view: gallery}\n"
            ),
            Err(BaseError::Invalid(_))
        ));
    }

    /// Un calendario senza la chiave della data si legge: la valutazione
    /// dirà che manca, il file non diventa illeggibile.
    #[test]
    fn calendario_senza_data_si_legge() {
        let view = view_of("views:\n  - name: C\n    type: calendar\n");
        assert_eq!(view.view_type, ViewType::Calendar);
        assert!(view.fub.is_none());
    }

    /// Una chiave `fub` che non è una proprietà (vuota o non testo) non si
    /// accetta, e le chiavi di `fub` che questa versione non conosce restano.
    #[test]
    fn chiavi_fub_vuote_o_di_tipo_sbagliato_si_rifiutano() {
        for source in [
            "views:\n  - {name: C, type: calendar, fub: {date: ' '}}\n",
            "views:\n  - {name: C, type: calendar, fub: {date: 5}}\n",
        ] {
            assert!(
                matches!(BaseDefinition::parse(source), Err(BaseError::Invalid(_))),
                "{source}"
            );
        }
        let view =
            view_of("views:\n  - {name: C, type: calendar, fub: {date: due, colore: blu}}\n");
        assert!(view.fub.expect("fub").extra.contains_key("colore"));
    }

    #[test]
    fn forma_su_disco_dei_tipi_nuovi_e_di_quelli_vecchi() {
        assert_eq!(
            disk_form(ViewType::Calendar),
            (ViewType::Table, Some(FubView::Calendar))
        );
        assert_eq!(
            disk_form(ViewType::Timeline),
            (ViewType::Table, Some(FubView::Timeline))
        );
        assert_eq!(disk_form(ViewType::Table), (ViewType::Table, None));
        assert_eq!(disk_form(ViewType::Kanban), (ViewType::Kanban, None));
    }
}
