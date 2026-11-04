//! Il catalogo dei comandi di GridCraft come comandi di Fub
//! (`docs/architecture/motori.md`).
//!
//! I comandi che la modalità a comandi serve ([`crate::commands`]) passano
//! da [`fub_motori::importa`] con lo spazio [`SPAZIO`]: l'id diventa
//! `fogli.«id»`, il titolo la chiave `fogli.cmd.«id»`, il menu di GridCraft
//! (o l'id stesso) una scheda e un gruppo del menu dei fogli
//! ([`ADATTAMENTO`]), ciò che GridCraft dice del comando il suo effetto
//! sulla cartella, lo schema dei parametri un [`fub_motori::Modulo`]. Gli
//! altri hanno il loro perché ([`perche_non_servito`]), e il test
//! `copertura` controlla che nessuno si perda e che ogni gruppo del menu
//! abbia un comando.
//!
//! Le schede e i gruppi ([`SCHEDE`]) sono quelli della barra dei fogli della
//! shell (`apps/client/src/editors/grid/ribbon/tabs.ts`), più quelli che ci
//! sono soltanto nel menu: il test `ts_catalogo` controlla gli uni e il posto
//! dei comandi che la barra mostra; il test `effetto` fa girare ogni comando
//! che non cambia la cartella e guarda che davvero non la cambi.

use fub_motori::{
    importa, Adattamento, ComandoFub, Effetto, Gruppo, Mancanza, Posto, Scheda, SpecMotore, Tipo,
};
use gridcraft_engine::{command_specs, find_command, CommandSpec};

use crate::commands::{
    edits, is_composed_command, not_served_entries, served, why_not_served, REDO, UNDO,
};

/// Lo spazio dei comandi della cartella.
pub const SPAZIO: &str = "fogli";

const fn posto(scheda: &'static str, gruppo: &'static str) -> Posto {
    Posto { scheda, gruppo }
}

/// Un gruppo della barra dei fogli, che il menu ripete.
const fn gruppo(id: &'static str) -> Gruppo {
    Gruppo { id, solo: false }
}

/// Un gruppo soltanto del menu, per i comandi che la barra non ha.
const fn solo(id: &'static str) -> Gruppo {
    Gruppo { id, solo: true }
}

/// Le schede e i gruppi del menu «Comandi» dei fogli, nell'ordine del menu.
/// Quelli che non sono `solo` sono le schede e i gruppi della barra dei
/// fogli (`apps/client/src/editors/grid/ribbon/tabs.ts`, il test
/// `ts_catalogo` lo controlla); quelli `solo` ci sono soltanto nel menu, per
/// i comandi che la barra non ha. Le schede con un `contesto` compaiono
/// quando la selezione è una tabella, un grafico, un oggetto o una tabella
/// pivot.
pub const SCHEDE: &[Scheda] = &[
    Scheda {
        id: "file",
        solo: true,
        contesto: None,
        gruppi: &[solo("info")],
    },
    Scheda {
        id: "home",
        solo: false,
        contesto: None,
        gruppi: &[
            solo("undo"),
            gruppo("font"),
            gruppo("alignment"),
            gruppo("number"),
            gruppo("styles"),
            gruppo("cells"),
            gruppo("editing"),
            solo("selection"),
        ],
    },
    Scheda {
        id: "insert",
        solo: false,
        contesto: None,
        gruppi: &[
            gruppo("tables"),
            gruppo("illustrations"),
            gruppo("charts"),
            solo("sparklines"),
            solo("filters"),
            gruppo("controls"),
            gruppo("symbols"),
            gruppo("links"),
            gruppo("text"),
        ],
    },
    Scheda {
        id: "draw",
        solo: true,
        contesto: None,
        gruppi: &[solo("pen")],
    },
    Scheda {
        id: "page",
        solo: false,
        contesto: None,
        gruppi: &[
            gruppo("themes"),
            gruppo("setup"),
            solo("scale"),
            gruppo("print"),
            gruppo("options"),
        ],
    },
    Scheda {
        id: "formulas",
        solo: false,
        contesto: None,
        gruppi: &[
            gruppo("library"),
            gruppo("names"),
            gruppo("auditing"),
            gruppo("calculation"),
        ],
    },
    Scheda {
        id: "data",
        solo: false,
        contesto: None,
        gruppi: &[
            solo("get"),
            solo("queries"),
            gruppo("sort"),
            solo("slicers"),
            gruppo("tools"),
            gruppo("forecast"),
            gruppo("outline"),
            solo("analysis"),
        ],
    },
    Scheda {
        id: "review",
        solo: false,
        contesto: None,
        gruppi: &[
            solo("proofing"),
            solo("accessibility"),
            gruppo("comments"),
            gruppo("notes"),
            gruppo("protect"),
        ],
    },
    Scheda {
        id: "view",
        solo: false,
        contesto: None,
        gruppi: &[
            gruppo("views"),
            gruppo("show"),
            gruppo("zoom"),
            gruppo("window"),
        ],
    },
    Scheda {
        id: "table",
        solo: false,
        contesto: Some("table"),
        gruppi: &[
            gruppo("properties"),
            gruppo("tools"),
            gruppo("options"),
            gruppo("styles"),
        ],
    },
    Scheda {
        id: "chart",
        solo: false,
        contesto: Some("chart"),
        gruppi: &[
            gruppo("layouts"),
            gruppo("styles"),
            gruppo("data"),
            gruppo("type"),
            solo("location"),
        ],
    },
    Scheda {
        id: "object",
        solo: false,
        contesto: Some("object"),
        gruppi: &[solo("selection"), gruppo("shape_styles"), gruppo("arrange")],
    },
    Scheda {
        id: "pivot",
        solo: true,
        contesto: Some("pivot"),
        gruppi: &[solo("tables"), solo("fields"), solo("layout")],
    },
];

/// Ogni percorso del menu di GridCraft dei comandi serviti, con il suo posto
/// nel menu dei fogli: il gruppo dove la barra mostra i comandi di quel
/// percorso, o quello dove il menu mette i comandi che la barra non ha.
const POSTI: &[(&[&str], Posto)] = &[
    (&["Chart Design"], posto("chart", "layouts")),
    (
        &["Chart Design", "Chart Layouts"],
        posto("chart", "layouts"),
    ),
    (&["Chart Design", "Chart Styles"], posto("chart", "styles")),
    (&["Chart Design", "Data"], posto("chart", "data")),
    (&["Chart Design", "Location"], posto("chart", "location")),
    (&["Chart Design", "Type"], posto("chart", "type")),
    (&["Data", "Analysis"], posto("data", "analysis")),
    (&["Data", "Data Tools"], posto("data", "tools")),
    (
        &["Data", "Data Tools", "Data Validation"],
        posto("data", "tools"),
    ),
    (&["Data", "Forecast"], posto("data", "forecast")),
    (
        &["Data", "Forecast", "What-If Analysis"],
        posto("data", "forecast"),
    ),
    (&["Data", "Get & Transform Data"], posto("data", "get")),
    (&["Data", "Outline"], posto("data", "outline")),
    (&["Data", "Queries & Connections"], posto("data", "queries")),
    (&["Data", "Sort & Filter"], posto("data", "sort")),
    (&["Draw", "Convert"], posto("draw", "pen")),
    (&["Edit"], posto("home", "undo")),
    (&["File"], posto("file", "info")),
    (&["File", "Export"], posto("page", "print")),
    (
        &["Format", "Current Selection"],
        posto("object", "selection"),
    ),
    (&["Format", "Shape Styles"], posto("object", "shape_styles")),
    (
        &["Formulas", "Calculation"],
        posto("formulas", "calculation"),
    ),
    (&["Formulas", "Defined Names"], posto("formulas", "names")),
    (
        &["Formulas", "Formula Auditing"],
        posto("formulas", "auditing"),
    ),
    (
        &["Formulas", "Function Library"],
        posto("formulas", "library"),
    ),
    (&["Home", "Alignment"], posto("home", "alignment")),
    (&["Home", "Cells", "Delete"], posto("home", "cells")),
    (&["Home", "Cells", "Format"], posto("home", "cells")),
    (
        &["Home", "Cells", "Format", "Hide & Unhide"],
        posto("home", "cells"),
    ),
    (&["Home", "Cells", "Insert"], posto("home", "cells")),
    (&["Home", "Editing", "Clear"], posto("home", "editing")),
    (&["Home", "Editing", "Fill"], posto("home", "editing")),
    (
        &["Home", "Editing", "Find & Select"],
        posto("home", "editing"),
    ),
    (&["Home", "Font"], posto("home", "font")),
    (&["Home", "Number"], posto("home", "number")),
    (&["Home", "Styles"], posto("home", "styles")),
    (
        &["Home", "Styles", "Conditional Formatting"],
        posto("home", "styles"),
    ),
    (&["Insert", "Cell Controls"], posto("insert", "controls")),
    (&["Insert", "Charts"], posto("insert", "charts")),
    (&["Insert", "Filters"], posto("insert", "filters")),
    (
        &["Insert", "Illustrations"],
        posto("insert", "illustrations"),
    ),
    (&["Insert", "Links"], posto("insert", "links")),
    (&["Insert", "Sparklines"], posto("insert", "sparklines")),
    (&["Insert", "Symbols"], posto("insert", "symbols")),
    (&["Insert", "Tables"], posto("insert", "tables")),
    (&["Insert", "Text"], posto("insert", "text")),
    (&["Page Layout", "Arrange"], posto("object", "arrange")),
    (&["Page Layout", "Page Setup"], posto("page", "setup")),
    (
        &["Page Layout", "Page Setup", "Print Area"],
        posto("page", "setup"),
    ),
    (&["Page Layout", "Scale to Fit"], posto("page", "scale")),
    (&["Page Layout", "Sheet Options"], posto("page", "options")),
    (&["Page Layout", "Themes"], posto("page", "themes")),
    (&["PivotTable Analyze", "Actions"], posto("pivot", "tables")),
    (
        &["PivotTable Analyze", "Active Field"],
        posto("pivot", "fields"),
    ),
    (
        &["PivotTable Analyze", "Calculations"],
        posto("pivot", "fields"),
    ),
    (&["PivotTable Analyze", "Data"], posto("pivot", "tables")),
    (&["PivotTable Analyze", "Group"], posto("pivot", "fields")),
    (&["PivotTable Analyze", "Show"], posto("pivot", "fields")),
    (&["PivotTable Design", "Layout"], posto("pivot", "layout")),
    (
        &["PivotTable Design", "PivotTable Styles"],
        posto("pivot", "tables"),
    ),
    (
        &["Review", "Accessibility"],
        posto("review", "accessibility"),
    ),
    (&["Review", "Comments"], posto("review", "comments")),
    (&["Review", "Notes"], posto("review", "notes")),
    (&["Review", "Proofing"], posto("review", "proofing")),
    (&["Review", "Protect"], posto("review", "protect")),
    (
        &["Table Design", "Properties"],
        posto("table", "properties"),
    ),
    (&["Table Design", "Tools"], posto("table", "tools")),
    (&["Table", "Properties"], posto("table", "properties")),
    (&["Table", "Table Style Options"], posto("table", "options")),
    (&["Table", "Table Styles"], posto("table", "styles")),
    (&["Table", "Tools"], posto("table", "tools")),
    (&["View", "Show"], posto("page", "options")),
    (&["View", "Window"], posto("view", "window")),
    (&["View", "Window", "Freeze Panes"], posto("view", "window")),
    (&["View", "Workbook Views"], posto("view", "views")),
    (&["View", "Zoom"], posto("view", "zoom")),
];

/// Il posto di un comando preciso, che vale prima del suo percorso.
const POSTI_DEL_COMANDO: &[(&str, Posto)] = &[
    // I comandi senza un menu in GridCraft: una riga per id.
    ("document.inspect", posto("file", "info")),
    ("home.shrinkToFit", posto("home", "alignment")),
    ("sheet.activate", posto("home", "cells")),
    ("sheet.moveColumns", posto("home", "cells")),
    ("sheet.next", posto("home", "cells")),
    ("sheet.previous", posto("home", "cells")),
    ("cell.get", posto("home", "editing")),
    ("cell.set", posto("home", "editing")),
    ("edit.autoFill", posto("home", "editing")),
    ("range.fill", posto("home", "editing")),
    ("range.setValues", posto("home", "editing")),
    ("sheet.read", posto("home", "editing")),
    ("selection.column", posto("home", "selection")),
    ("selection.currentRegion", posto("home", "selection")),
    ("selection.move", posto("home", "selection")),
    ("selection.next", posto("home", "selection")),
    ("selection.row", posto("home", "selection")),
    ("selection.set", posto("home", "selection")),
    ("selection.stats", posto("home", "selection")),
    ("insert.chartRecommendations", posto("insert", "charts")),
    ("cell.toggleCheckbox", posto("insert", "controls")),
    ("draw.stroke", posto("draw", "pen")),
    ("formulas.functions", posto("formulas", "library")),
    ("formulas.deleteName", posto("formulas", "names")),
    ("formulas.convertToNumber", posto("formulas", "auditing")),
    ("formulas.evaluate", posto("formulas", "calculation")),
    ("data.filterBy", posto("data", "sort")),
    ("slicer.clear", posto("data", "slicers")),
    ("slicer.delete", posto("data", "slicers")),
    ("slicer.selectAll", posto("data", "slicers")),
    ("slicer.toggle", posto("data", "slicers")),
    ("data.validate", posto("data", "tools")),
    ("data.scenarioAdd", posto("data", "forecast")),
    ("data.scenarioDelete", posto("data", "forecast")),
    ("data.scenarioShow", posto("data", "forecast")),
    ("data.scenarioSummary", posto("data", "forecast")),
    ("data.showLevels", posto("data", "outline")),
    ("data.solverReport", posto("data", "analysis")),
    ("review.changeSpelling", posto("review", "proofing")),
    ("review.replyComment", posto("review", "comments")),
    ("review.resolveComment", posto("review", "comments")),
    ("view.showObjects", posto("view", "show")),
    ("view.showZeros", posto("view", "show")),
    ("table.totalFunction", posto("table", "options")),
    ("shape.setText", posto("object", "selection")),
    ("chart.delete", posto("object", "arrange")),
    ("object.delete", posto("object", "arrange")),
    ("object.move", posto("object", "arrange")),
    ("object.setAnchorMode", posto("object", "arrange")),
    ("pivot.list", posto("pivot", "tables")),
    ("pivot.addField", posto("pivot", "fields")),
    ("pivot.fields", posto("pivot", "fields")),
    ("pivot.filter", posto("pivot", "fields")),
    ("pivot.moveField", posto("pivot", "fields")),
    ("pivot.removeField", posto("pivot", "fields")),
    ("pivot.sort", posto("pivot", "fields")),
    // I comandi che la barra mostra in un gruppo diverso da quello del loro
    // percorso: se la barra li mostra in più posti, il primo nell'ordine
    // della barra (il menu li mostra in tutti).
    ("home.formatCells", posto("home", "font")),
    ("review.protectSheet", posto("home", "cells")),
    ("data.clearFilter", posto("home", "editing")),
    ("data.filter", posto("home", "editing")),
    ("data.reapply", posto("home", "editing")),
    ("data.sort", posto("home", "editing")),
    ("data.sortAscending", posto("home", "editing")),
    ("data.sortDescending", posto("home", "editing")),
    ("formulas.autoSum", posto("home", "editing")),
    ("edit.selectAll", posto("home", "selection")),
    ("file.printPreview", posto("page", "print")),
];

/// I comandi che cambiano la cartella anche se GridCraft non li segna
/// annullabili: entrano nel giornale e il file salvato li porta. Un comando
/// che la regola direbbe «mostra» o «legge» e che pure scrive nel giornale va
/// qui, con il perché; i test di `tests/effetto.rs` lo provano.
const CAMBIANO: &[(&str, &str)] = &[
    ("view.normal", "la vista del foglio si salva con il file"),
    (
        "view.pageLayout",
        "la vista del foglio si salva con il file",
    ),
    (
        "view.pageBreakPreview",
        "la vista del foglio si salva con il file",
    ),
    (
        "view.split",
        "la divisione entra nel giornale: GridCraft la tiene come riquadri bloccati",
    ),
    (
        "view.customViews",
        "salvare o togliere una vista personalizzata entra nel giornale",
    ),
    (
        "formulas.watchWindow",
        "aggiungere o togliere una cella osservata entra nel giornale",
    ),
];

/// L'effetto del comando sulla cartella. `Cambia` se il comando cambia la
/// cartella (annullabile o composto, [`crate::commands`]), se è annulla o
/// ripeti, o se è in [`CAMBIANO`]; `Legge` se GridCraft non lo scrive nel
/// giornale (una domanda al motore); `Mostra` per gli altri, che cambiano
/// soltanto la selezione, il foglio attivo o la vista.
fn effetto(comando: &CommandSpec) -> Effetto {
    if comando.id == UNDO
        || comando.id == REDO
        || edits(comando.id)
        || CAMBIANO.iter().any(|(id, _)| *id == comando.id)
    {
        Effetto::Cambia
    } else if !comando.journal {
        Effetto::Legge
    } else {
        Effetto::Mostra
    }
}

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

/// Ciò che l'adattatore sa di GridCraft: le schede, i posti e il lessico.
pub const ADATTAMENTO: Adattamento<'static> = Adattamento {
    schede: SCHEDE,
    posti: POSTI,
    posti_del_comando: POSTI_DEL_COMANDO,
    nomi: NOMI,
    nomi_del_comando: NOMI_DEL_COMANDO,
};

fn spec(comando: &CommandSpec) -> SpecMotore {
    SpecMotore {
        id: comando.id.to_owned(),
        etichetta: comando.label.to_owned(),
        menu: comando.menu.iter().map(|voce| (*voce).to_owned()).collect(),
        parametri: comando.params.to_owned(),
        effetto: effetto(comando),
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
        .filter(|spec| served(&spec.id) && !is_composed_command(&spec.id))
        .cloned()
        .collect();
    importa(SPAZIO, &servite, &ADATTAMENTO)
}
