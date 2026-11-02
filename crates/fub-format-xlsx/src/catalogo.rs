//! Il catalogo dei comandi di GridCraft come comandi di Fub
//! (`docs/architecture/motori.md`).
//!
//! I comandi che la modalità a comandi serve ([`crate::commands`]) passano
//! da [`fub_motori::importa`] con lo spazio [`SPAZIO`]: l'id diventa
//! `fogli.«id»`, il titolo la chiave `fogli.cmd.«id»`, il menu di GridCraft
//! una scheda e un gruppo della barra dei fogli ([`ADATTAMENTO`]), lo schema
//! dei parametri un [`fub_motori::Modulo`]. Gli altri hanno il loro perché
//! ([`perche_non_servito`]), e il test `copertura` controlla che nessuno si
//! perda.
//!
//! Le schede e i gruppi sono quelli della barra dei fogli della shell
//! (`apps/client/src/editors/grid/ribbon/tabs.ts`): il test `ts_catalogo`
//! controlla che ci siano.

use fub_motori::{importa, Adattamento, ComandoFub, Mancanza, Posto, SpecMotore, Tipo};
use gridcraft_engine::{command_specs, find_command, CommandSpec};

use crate::commands::{composed, not_served_entries, served, why_not_served};

/// Lo spazio dei comandi della cartella.
pub const SPAZIO: &str = "fogli";

const fn barra(scheda: &'static str, gruppo: &'static str) -> Posto {
    Posto::Barra {
        scheda,
        gruppo: Some(gruppo),
    }
}

const fn scheda(scheda: &'static str) -> Posto {
    Posto::Barra {
        scheda,
        gruppo: None,
    }
}

const TAVOLOZZA: Posto = Posto::Tavolozza;

/// Ogni percorso del menu di GridCraft dei comandi serviti, con il suo
/// posto nella barra dei fogli. Le schede contestuali di GridCraft vanno in
/// quelle di Fub (`chart`, `table`, `object`); quelle che Fub non ha (le
/// tabelle pivot, il disegno a mano, il menu «File» ed «Edit» di GridCraft)
/// restano nella tavolozza.
const POSTI: &[(&[&str], Posto)] = &[
    (&["Chart Design"], scheda("chart")),
    (
        &["Chart Design", "Chart Layouts"],
        barra("chart", "layouts"),
    ),
    (&["Chart Design", "Chart Styles"], barra("chart", "styles")),
    (&["Chart Design", "Data"], barra("chart", "data")),
    (&["Chart Design", "Location"], scheda("chart")),
    (&["Chart Design", "Type"], barra("chart", "type")),
    (&["Data", "Analysis"], scheda("data")),
    (&["Data", "Data Tools"], barra("data", "tools")),
    (
        &["Data", "Data Tools", "Data Validation"],
        barra("data", "tools"),
    ),
    (&["Data", "Forecast"], barra("data", "forecast")),
    (
        &["Data", "Forecast", "What-If Analysis"],
        barra("data", "forecast"),
    ),
    (&["Data", "Get & Transform Data"], scheda("data")),
    (&["Data", "Outline"], barra("data", "outline")),
    (&["Data", "Queries & Connections"], scheda("data")),
    (&["Data", "Sort & Filter"], barra("data", "sort")),
    (&["Draw", "Convert"], TAVOLOZZA),
    (&["Edit"], TAVOLOZZA),
    (&["File"], TAVOLOZZA),
    (&["File", "Export"], barra("page", "print")),
    (&["Format", "Current Selection"], scheda("object")),
    (&["Format", "Shape Styles"], barra("object", "shape_styles")),
    (
        &["Formulas", "Calculation"],
        barra("formulas", "calculation"),
    ),
    (&["Formulas", "Defined Names"], barra("formulas", "names")),
    (
        &["Formulas", "Formula Auditing"],
        barra("formulas", "auditing"),
    ),
    (
        &["Formulas", "Function Library"],
        barra("formulas", "library"),
    ),
    (&["Home", "Alignment"], barra("home", "alignment")),
    (&["Home", "Cells", "Delete"], barra("home", "cells")),
    (&["Home", "Cells", "Format"], barra("home", "cells")),
    (
        &["Home", "Cells", "Format", "Hide & Unhide"],
        barra("home", "cells"),
    ),
    (&["Home", "Cells", "Insert"], barra("home", "cells")),
    (&["Home", "Editing", "Clear"], barra("home", "editing")),
    (&["Home", "Editing", "Fill"], barra("home", "editing")),
    (
        &["Home", "Editing", "Find & Select"],
        barra("home", "editing"),
    ),
    (&["Home", "Font"], barra("home", "font")),
    (&["Home", "Number"], barra("home", "number")),
    (&["Home", "Styles"], barra("home", "styles")),
    (
        &["Home", "Styles", "Conditional Formatting"],
        barra("home", "styles"),
    ),
    (&["Insert", "Cell Controls"], barra("insert", "controls")),
    (&["Insert", "Charts"], barra("insert", "charts")),
    (&["Insert", "Filters"], scheda("insert")),
    (
        &["Insert", "Illustrations"],
        barra("insert", "illustrations"),
    ),
    (&["Insert", "Links"], barra("insert", "links")),
    (&["Insert", "Sparklines"], scheda("insert")),
    (&["Insert", "Symbols"], barra("insert", "symbols")),
    (&["Insert", "Tables"], barra("insert", "tables")),
    (&["Insert", "Text"], barra("insert", "text")),
    (&["Page Layout", "Arrange"], barra("object", "arrange")),
    (&["Page Layout", "Page Setup"], barra("page", "setup")),
    (
        &["Page Layout", "Page Setup", "Print Area"],
        barra("page", "setup"),
    ),
    (&["Page Layout", "Scale to Fit"], scheda("page")),
    (&["Page Layout", "Sheet Options"], barra("page", "options")),
    (&["Page Layout", "Themes"], barra("page", "themes")),
    (&["PivotTable Analyze", "Actions"], TAVOLOZZA),
    (&["PivotTable Analyze", "Active Field"], TAVOLOZZA),
    (&["PivotTable Analyze", "Calculations"], TAVOLOZZA),
    (&["PivotTable Analyze", "Data"], TAVOLOZZA),
    (&["PivotTable Analyze", "Group"], TAVOLOZZA),
    (&["PivotTable Analyze", "Show"], TAVOLOZZA),
    (&["PivotTable Design", "Layout"], TAVOLOZZA),
    (&["PivotTable Design", "PivotTable Styles"], TAVOLOZZA),
    (&["Review", "Accessibility"], scheda("review")),
    (&["Review", "Comments"], barra("review", "comments")),
    (&["Review", "Notes"], barra("review", "notes")),
    (&["Review", "Proofing"], scheda("review")),
    (&["Review", "Protect"], barra("review", "protect")),
    (
        &["Table Design", "Properties"],
        barra("table", "properties"),
    ),
    (&["Table Design", "Tools"], barra("table", "tools")),
    (&["Table", "Properties"], barra("table", "properties")),
    (&["Table", "Table Style Options"], barra("table", "options")),
    (&["Table", "Table Styles"], barra("table", "styles")),
    (&["Table", "Tools"], barra("table", "tools")),
    (&["View", "Show"], barra("view", "show")),
    (&["View", "Window"], barra("view", "window")),
    (&["View", "Window", "Freeze Panes"], barra("view", "window")),
    (&["View", "Workbook Views"], barra("view", "views")),
    (&["View", "Zoom"], barra("view", "zoom")),
];

/// I nomi che gli schemi di GridCraft usano senza valore, con il loro tipo:
/// il tipo viene da come il comando legge il parametro.
const NOMI: &[(&str, Tipo)] = &[
    ("alt", Tipo::Testo),
    ("at", Tipo::Cella),
    ("author", Tipo::Testo),
    ("autofilter", Tipo::SiNo),
    ("backward", Tipo::Numero),
    ("bottom", Tipo::Numero),
    ("by", Tipo::Testo),
    ("byColumns", Tipo::SiNo),
    ("category", Tipo::Testo),
    ("cell", Tipo::Cella),
    ("centerH", Tipo::SiNo),
    ("centerV", Tipo::SiNo),
    ("chart", Tipo::Testo),
    ("color", Tipo::Testo),
    ("cols", Tipo::Intervallo),
    ("column", Tipo::Testo),
    ("columns", Tipo::Json),
    ("comment", Tipo::Testo),
    ("company", Tipo::Testo),
    ("count", Tipo::Numero),
    ("dataLabels", Tipo::SiNo),
    ("dc", Tipo::Numero),
    ("deleteColumns", Tipo::SiNo),
    ("deleteRows", Tipo::SiNo),
    ("description", Tipo::Testo),
    ("destination", Tipo::Testo),
    ("displayEquation", Tipo::SiNo),
    ("displayRSquared", Tipo::SiNo),
    ("dr", Tipo::Numero),
    ("dropdown", Tipo::SiNo),
    ("dx", Tipo::Numero),
    ("dy", Tipo::Numero),
    ("errorMessage", Tipo::Testo),
    ("errorTitle", Tipo::Testo),
    ("evenFooter", Tipo::Testo),
    ("evenHeader", Tipo::Testo),
    ("field", Tipo::Testo),
    ("fill", Tipo::Testo),
    ("firstFooter", Tipo::Testo),
    ("firstHeader", Tipo::Testo),
    ("fitHeight", Tipo::Numero),
    ("fitToPage", Tipo::SiNo),
    ("fitWidth", Tipo::Numero),
    ("footer", Tipo::Testo),
    ("formatCells", Tipo::SiNo),
    ("formatColumns", Tipo::SiNo),
    ("formatRows", Tipo::SiNo),
    ("formula", Tipo::Testo),
    ("formula1", Tipo::Testo),
    ("formula2", Tipo::Testo),
    ("forward", Tipo::Numero),
    ("func", Tipo::Testo),
    ("gridlines", Tipo::SiNo),
    ("header", Tipo::Testo),
    ("headings", Tipo::SiNo),
    ("height", Tipo::Numero),
    ("id", Tipo::Testo),
    ("ids", Tipo::Json),
    ("ignoreBlank", Tipo::SiNo),
    ("input", Tipo::Testo),
    ("inputMessage", Tipo::Testo),
    ("inputTitle", Tipo::Testo),
    ("insertColumns", Tipo::SiNo),
    ("insertRows", Tipo::SiNo),
    ("keywords", Tipo::Testo),
    ("kind", Tipo::Testo),
    ("left", Tipo::Numero),
    ("line", Tipo::Testo),
    ("major", Tipo::Testo),
    ("majorFont", Tipo::Testo),
    ("markers", Tipo::SiNo),
    ("matchCase", Tipo::SiNo),
    ("mime", Tipo::Testo),
    ("minor", Tipo::Testo),
    ("minorFont", Tipo::Testo),
    ("name", Tipo::Testo),
    ("newTitle", Tipo::Testo),
    ("oldName", Tipo::Testo),
    ("oldScope", Tipo::Testo),
    ("on", Tipo::SiNo),
    ("page", Tipo::Numero),
    ("password", Tipo::Segreto),
    ("path", Tipo::Testo),
    ("pivot", Tipo::Testo),
    ("range", Tipo::Intervallo),
    ("replace", Tipo::SiNo),
    ("right", Tipo::Numero),
    ("rows", Tipo::Intervallo),
    ("search", Tipo::Testo),
    ("series", Tipo::Numero),
    ("sheet", Tipo::Foglio),
    ("sort", Tipo::SiNo),
    ("source", Tipo::Testo),
    ("stop", Tipo::Numero),
    ("style", Tipo::Testo),
    ("subject", Tipo::Testo),
    ("subtype", Tipo::Testo),
    ("table", Tipo::Testo),
    ("text", Tipo::Testo),
    ("title", Tipo::Testo),
    ("to", Tipo::Testo),
    ("tooltip", Tipo::Testo),
    ("top", Tipo::Numero),
    ("type", Tipo::Testo),
    ("viewHeight", Tipo::Numero),
    ("viewWidth", Tipo::Numero),
    ("what", Tipo::Testo),
    ("wholeCell", Tipo::SiNo),
    ("width", Tipo::Numero),
    ("with", Tipo::Testo),
    ("word", Tipo::Testo),
    ("xTitle", Tipo::Testo),
    ("yTitle", Tipo::Testo),
];

/// I nomi che in un comando vogliono dire un'altra cosa che negli altri.
const NOMI_DEL_COMANDO: &[(&str, &[(&str, Tipo)])] = &[
    ("home.formatAsTable", &[("header", Tipo::SiNo)]),
    (
        "pageLayout.margins",
        &[("header", Tipo::Numero), ("footer", Tipo::Numero)],
    ),
];

/// Ciò che l'adattatore sa di GridCraft: i posti e il lessico.
pub const ADATTAMENTO: Adattamento<'static> = Adattamento {
    posti: POSTI,
    nomi: NOMI,
    nomi_del_comando: NOMI_DEL_COMANDO,
};

fn spec(comando: &CommandSpec) -> SpecMotore {
    SpecMotore {
        id: comando.id.to_owned(),
        etichetta: comando.label.to_owned(),
        menu: comando.menu.iter().map(|voce| (*voce).to_owned()).collect(),
        parametri: comando.params.to_owned(),
    }
}

/// Tutti i comandi di GridCraft, serviti e no, nell'ordine del suo catalogo.
pub fn specifiche() -> Vec<SpecMotore> {
    command_specs().iter().map(spec).collect()
}

/// Il comando `id` di GridCraft, anche uno di prova.
pub fn specifica(id: &str) -> Option<SpecMotore> {
    find_command(id).map(spec)
}

/// Perché Fub non serve il comando `id` di GridCraft; `None` se lo serve o
/// se GridCraft non lo ha.
pub fn perche_non_servito(id: &str) -> Option<&'static str> {
    why_not_served(id)
}

/// Le voci dell'elenco dei non serviti: gli id esatti e i prefissi.
pub fn voci_non_servite() -> (Vec<&'static str>, Vec<&'static str>) {
    not_served_entries()
}

/// Il catalogo dei comandi che Fub serve, importati da GridCraft. I comandi
/// composti di Fub (`fub.pasteFrom`, `fub.copyHtml`) non sono di GridCraft
/// e non ci sono.
pub fn comandi() -> Result<Vec<ComandoFub>, Vec<Mancanza>> {
    importa_da(&specifiche())
}

/// Importa i comandi serviti fra `specifiche`.
pub fn importa_da(specifiche: &[SpecMotore]) -> Result<Vec<ComandoFub>, Vec<Mancanza>> {
    let servite: Vec<SpecMotore> = specifiche
        .iter()
        .filter(|spec| served(&spec.id) && !composed(&spec.id))
        .cloned()
        .collect();
    importa(SPAZIO, &servite, &ADATTAMENTO)
}
