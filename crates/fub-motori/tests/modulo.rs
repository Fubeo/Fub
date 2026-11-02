//! `Modulo::da_schema` su ogni forma che gli schemi dei motori usano: gli
//! esempi vengono dai comandi di GridCraft (`docs/architecture/motori.md`).

use fub_motori::{Campo, Modulo, Tipo};

const LESSICO: &[(&str, Tipo)] = &[
    ("cell", Tipo::Cella),
    ("range", Tipo::Intervallo),
    ("sheet", Tipo::Foglio),
    ("password", Tipo::Segreto),
    ("word", Tipo::Testo),
    ("to", Tipo::Testo),
    ("kind", Tipo::Testo),
    ("id", Tipo::Testo),
    ("field", Tipo::Testo),
];

fn modulo(schema: &str) -> Modulo {
    Modulo::da_schema(schema, LESSICO).unwrap_or_else(|errore| panic!("{schema}: {errore}"))
}

fn campi(schema: &str) -> Vec<Campo> {
    let modulo = modulo(schema);
    assert!(modulo.altre_forme.is_empty() && !modulo.aperto, "{schema}");
    modulo.campi
}

fn tipi(schema: &str) -> Vec<(String, Tipo)> {
    campi(schema)
        .into_iter()
        .map(|c| (c.nome, c.tipo))
        .collect()
}

fn un_tipo(schema: &str) -> Tipo {
    let tipi = tipi(schema);
    assert_eq!(tipi.len(), 1, "{schema}");
    tipi[0].1.clone()
}

fn scelta(valori: &[&str], aperta: bool) -> Tipo {
    Tipo::Scelta {
        valori: valori.iter().map(|v| (*v).to_owned()).collect(),
        aperta,
    }
}

fn errore(schema: &str) -> String {
    match Modulo::da_schema(schema, LESSICO) {
        Ok(modulo) => panic!("{schema} si legge: {modulo:?}"),
        Err(errore) => errore.to_string(),
    }
}

#[test]
fn uno_schema_vuoto_non_ha_campi() {
    assert_eq!(modulo(""), Modulo::default());
    assert_eq!(modulo("  "), Modulo::default());
    assert_eq!(modulo("{}"), Modulo::default());
    assert_eq!(
        modulo("{} → objects on the sheet in stacking order"),
        Modulo::default()
    );
    assert_eq!(
        modulo("{} (current region first, then the whole sheet)"),
        Modulo::default()
    );
}

#[test]
fn una_forma_che_non_si_capisce_è_un_errore() {
    assert!(errore("range, sheet").contains("non comincia"));
    assert!(errore("{range?, sheet").contains("non si chiudono"));
    assert!(errore("{a: [1, 2}").contains("non chiude"));
    assert!(errore("{a: \"B2}").contains("non si chiudono"));
    assert!(errore("{range?, , sheet?}").contains("vuoto"));
    assert!(errore("{range?, range}").contains("due volte"));
    assert!(errore("{a: @@}").contains("non si capisce"));
    assert!(errore("{\"range\"}").contains("nome di un campo"));
    assert!(errore("{a: x | \"b\" y}").contains("non si capisce"));
}

#[test]
fn un_campo_senza_valore_prende_il_tipo_dal_lessico() {
    assert_eq!(
        campi("{cell, word, to, all?: bool}"),
        vec![
            Campo {
                nome: "cell".into(),
                tipo: Tipo::Cella,
                facoltativo: false,
                uno_fra: None
            },
            Campo {
                nome: "word".into(),
                tipo: Tipo::Testo,
                facoltativo: false,
                uno_fra: None
            },
            Campo {
                nome: "to".into(),
                tipo: Tipo::Testo,
                facoltativo: false,
                uno_fra: None
            },
            Campo {
                nome: "all".into(),
                tipo: Tipo::SiNo,
                facoltativo: true,
                uno_fra: None
            },
        ]
    );
    assert_eq!(un_tipo("{password?}"), Tipo::Segreto);
    let errore = errore("{range?, author?}");
    assert!(
        errore.contains("author") && errore.contains("lessico"),
        "{errore}"
    );
}

#[test]
fn le_note_dopo_il_nome_non_sono_un_valore() {
    assert_eq!(
        un_tipo("{range? (list with headers; default current region)}"),
        Tipo::Intervallo
    );
    let pagina = Modulo::da_schema(
        "{page? (1-based), sheet?}",
        &[("page", Tipo::Numero), ("sheet", Tipo::Foglio)],
    )
    .unwrap()
    .campi;
    assert_eq!(
        pagina
            .iter()
            .map(|c| (c.nome.as_str(), &c.tipo, c.facoltativo))
            .collect::<Vec<_>>(),
        [
            ("page", &Tipo::Numero, true),
            ("sheet", &Tipo::Foglio, true)
        ]
    );
    assert_eq!(
        un_tipo("{cell?: \"B2\" (rows above and columns left of it freeze)}"),
        Tipo::Cella
    );
}

#[test]
fn una_scelta_di_parole() {
    assert_eq!(
        un_tipo("{shift: left|up|row|column}"),
        scelta(&["left", "up", "row", "column"], false)
    );
    assert_eq!(
        un_tipo("{style?: thin|medium|thick|…}"),
        scelta(&["thin", "medium", "thick"], true)
    );
    assert_eq!(
        tipi("{name: chart|table|sum|… , at?: \"B2\"}")[0].1,
        scelta(&["chart", "table", "sum"], true)
    );
    assert_eq!(
        un_tipo("{palette: colorful|accent1..accent3}"),
        scelta(&["colorful", "accent1", "accent2", "accent3"], false)
    );
    assert_eq!(un_tipo("{kind: shape}"), scelta(&["shape"], false));
    // Una parola del tipo fra i valori è un valore.
    assert_eq!(
        un_tipo("{kind: numbers|text}"),
        scelta(&["numbers", "text"], false)
    );
    assert_eq!(
        un_tipo("{outputTo?: range|newSheet}"),
        scelta(&["range", "newSheet"], false)
    );
    // Una nota dopo un valore non è un valore; una tutta maiuscola sì.
    assert_eq!(
        un_tipo("{action?: list (default) | add | delete}"),
        scelta(&["list", "add", "delete"], false)
    );
    assert_eq!(
        un_tipo("{paper: A4|B4|B4 (ISO)|Japanese Postcard}"),
        scelta(&["A4", "B4", "B4 (ISO)", "Japanese Postcard"], false)
    );
}

#[test]
fn una_scelta_fra_virgolette() {
    assert_eq!(
        un_tipo("{name: \"Good\"|\"Bad\"|\"Heading 1\"|\"Accent1\"…|\"Normal\"}"),
        scelta(&["Good", "Bad", "Heading 1", "Accent1", "Normal"], true)
    );
    assert_eq!(un_tipo("{scope?: \"Workbook\"|sheet name}"), Tipo::Testo);
}

#[test]
fn i_riferimenti_fra_virgolette() {
    assert_eq!(un_tipo("{at?: \"B2\"}"), Tipo::Cella);
    assert_eq!(un_tipo("{add?: \"Sheet1!B5\"}"), Tipo::Cella);
    assert_eq!(un_tipo("{target: \"A1:D10\"}"), Tipo::Intervallo);
    assert_eq!(un_tipo("{titleCols?: \"A:A\"}"), Tipo::Intervallo);
    assert_eq!(
        un_tipo("{rows?: \"2:5\" | \"2:2,4:5\" | \"Sheet2!2:5\"}"),
        Tipo::Intervallo
    );
    assert_eq!(
        un_tipo("{source?: \"Sheet1!$A$1:$E$200\"}"),
        Tipo::Intervallo
    );
    assert_eq!(
        un_tipo("{changing: \"B2:B4\" or \"B2,B4\" (≤32 cells, active sheet)}"),
        Tipo::Intervallo
    );
    assert_eq!(un_tipo("{range: \"A1:B2,D4\" | cell}"), Tipo::Intervallo);
    // Il lessico affina: un intervallo dato con una cella d'esempio.
    assert_eq!(un_tipo("{range?: \"A1\"}"), Tipo::Intervallo);
    // Un riferimento o un nome: un testo.
    assert_eq!(
        un_tipo("{reference: \"B5\" | \"Sheet2!A1:C3\" | name}"),
        Tipo::Testo
    );
    assert_eq!(
        un_tipo("{source?: \"Sheet1!$A$1:$E$200\" | table name}"),
        Tipo::Testo
    );
}

#[test]
fn gli_esempi_fra_virgolette_sono_un_testo() {
    assert_eq!(un_tipo("{name?: \"VLOOKUP\"}"), Tipo::Testo);
    assert_eq!(un_tipo("{remove?: \"…\"}"), Tipo::Testo);
    assert_eq!(un_tipo("{base64?: \"...\"}"), Tipo::Testo);
    assert_eq!(un_tipo("{color: \"#FF0000\"|\"none\"}"), Tipo::Testo);
    assert_eq!(un_tipo("{other?: \"|\"}"), Tipo::Testo);
    assert_eq!(un_tipo("{textQualifier?: \"\\\"\"}"), Tipo::Testo);
    assert_eq!(
        un_tipo("{printArea?: \"A1:F50\" (\"\" clears)}"),
        Tipo::Intervallo
    );
}

#[test]
fn json_sì_no_e_numeri() {
    assert_eq!(un_tipo("{ids: [..]}"), Tipo::Json);
    assert_eq!(un_tipo("{margins?: {left,right,top} (inches)}"), Tipo::Json);
    assert_eq!(un_tipo("{colors: [12 hex]}"), Tipo::Json);
    assert_eq!(un_tipo("{on?: bool}"), Tipo::SiNo);
    assert_eq!(un_tipo("{top?: true}"), Tipo::SiNo);
    assert_eq!(un_tipo("{multi?: false}"), Tipo::SiNo);
    for numero in [
        "{size: 11}",
        "{angle: -0.25}",
        "{level?: 1-7}",
        "{scale?: 10..400}",
        "{angle: -90..90}",
        "{maxIterations?: 1–32767 (100)}",
        "{confidence?: 0.95 or 95}",
        "{width: 64 (pixels)}",
        "{before?: index}",
        "{percent: 10..400}",
        "{height?: pages}",
        "{to: number}",
        "{periods?: n (default: a third of the history)}",
    ] {
        assert_eq!(un_tipo(numero), Tipo::Numero, "{numero}");
    }
}

#[test]
fn le_descrizioni_dopo_il_valore() {
    assert_eq!(
        un_tipo("{all?: true = every level (Ctrl+Shift+])}"),
        Tipo::SiNo
    );
    assert_eq!(
        un_tipo("{all?: true = every level (Ctrl+Shift+[)}"),
        Tipo::SiNo
    );
    assert_eq!(
        un_tipo("{input: \"text, number or =formula\"}"),
        Tipo::Testo
    );
    assert_eq!(un_tipo("{before: zero-based column index}"), Tipo::Numero);
    assert_eq!(un_tipo("{end?: timeline value or date text}"), Tipo::Testo);
    assert_eq!(un_tipo("{id: textBox id}"), Tipo::Testo);
    // Un numero con le migliaia, o una frase con una virgola, continua dopo
    // la virgola.
    assert_eq!(
        tipi("{seasonality?: 0 (none) | 2–8,760, fillMissing?: zeros}"),
        vec![
            ("seasonality".into(), Tipo::Numero),
            ("fillMissing".into(), scelta(&["zeros"], false))
        ]
    );
    assert_eq!(
        un_tipo("{message?: text (the solver's words, kept as they are)}"),
        Tipo::Testo
    );
}

#[test]
fn il_lessico_affina_un_valore_vago() {
    assert_eq!(
        un_tipo("{sheet?: name (moves to that sheet)}"),
        Tipo::Foglio
    );
    assert_eq!(un_tipo("{sheet: index | name}"), Tipo::Foglio);
    assert_eq!(un_tipo("{sheet?: new sheet name}"), Tipo::Testo);
    assert_eq!(un_tipo("{sheet: true}"), Tipo::SiNo);
    assert_eq!(un_tipo("{chart?: id}"), Tipo::Testo);
}

#[test]
fn null_si_ignora_e_i_tipi_diversi_sono_json() {
    assert_eq!(un_tipo("{numberFormat?: \"#,##0\" | null}"), Tipo::Testo);
    assert_eq!(
        un_tipo("{selected: [\"East\", ..] | null (all)}"),
        Tipo::Json
    );
    assert_eq!(
        un_tipo("{seasonality?: \"auto\" | 0 (none) | 2–8,760}"),
        Tipo::Json
    );
    assert_eq!(un_tipo("{angle: -90..90 | \"vertical\" | 0}"), Tipo::Json);
    assert_eq!(
        un_tipo("{color: \"#C00000\" | \"auto\" | {theme: 4, tint: -0.25}}"),
        Tipo::Json
    );
    assert_eq!(un_tipo("{subtotals?: bool|top|bottom|none}"), Tipo::Json);
    assert_eq!(
        un_tipo("{pivot?: name | id | a cell of the report (\"Sheet2!B5\")}"),
        Tipo::Testo
    );
    assert!(errore("{a: null}").contains("non dice niente"));
}

#[test]
fn i_campi_alternativi() {
    let uno = |nome: &str, tipo: Tipo, facoltativo: bool, gruppo: usize| Campo {
        nome: nome.into(),
        tipo,
        facoltativo,
        uno_fra: Some(gruppo),
    };
    let lessico = &[
        ("path", Tipo::Testo),
        ("text", Tipo::Testo),
        ("rows", Tipo::Intervallo),
        ("cols", Tipo::Intervallo),
        ("by", Tipo::Testo),
        ("chart", Tipo::Testo),
        ("id", Tipo::Testo),
    ];
    let leggi = |schema: &str| Modulo::da_schema(schema, lessico).unwrap().campi;
    assert_eq!(
        leggi("{path | text, delimiter?: \",\"}"),
        vec![
            uno("path", Tipo::Testo, false, 0),
            uno("text", Tipo::Testo, false, 0),
            Campo {
                nome: "delimiter".into(),
                tipo: Tipo::Testo,
                facoltativo: true,
                uno_fra: None
            },
        ]
    );
    assert_eq!(
        leggi("{rows? | cols? | by?: rows|cols, level?: 1-7}")[..3],
        [
            uno("rows", Tipo::Intervallo, true, 0),
            uno("cols", Tipo::Intervallo, true, 0),
            uno("by", scelta(&["rows", "cols"], false), true, 0),
        ]
    );
    assert_eq!(
        leggi("{chart? | kind: shape, id?, palette: colorful|monochrome | colors: [hex…]}")
            .into_iter()
            .map(|c| (c.nome, c.uno_fra))
            .collect::<Vec<_>>(),
        vec![
            ("chart".into(), Some(0)),
            ("kind".into(), Some(0)),
            ("id".into(), None),
            ("palette".into(), Some(1)),
            ("colors".into(), Some(1)),
        ]
    );
    assert_eq!(
        leggi("{width: 64 (pixels) | chars: 8.43}"),
        vec![
            uno("width", Tipo::Numero, false, 0),
            uno("chars", Tipo::Numero, false, 0)
        ]
    );
    assert_eq!(
        leggi("{field: caption or source field | index: n}"),
        vec![
            uno("field", Tipo::Testo, false, 0),
            uno("index", Tipo::Numero, false, 0)
        ]
    );
}

#[test]
fn le_altre_forme_e_i_parametri_aperti() {
    let forme = modulo(
        "{sheet?, header?: \"&C&P\"} or one section: {sheet?, part: header|footer, text: string} → the sheet's settings",
    );
    assert_eq!(forme.campi.len(), 2);
    assert_eq!(forme.altre_forme.len(), 1);
    assert_eq!(
        forme.altre_forme[0]
            .iter()
            .map(|c| c.nome.as_str())
            .collect::<Vec<_>>(),
        ["sheet", "part", "text"]
    );
    // Un `or` dopo la freccia descrive il risultato.
    let risultato = modulo("{range?} → {pages, path} or {pages, base64} when no path");
    assert!(risultato.altre_forme.is_empty());

    let aperto = modulo("{tool: regression|histogram (or the tool's label), labels?: bool, …tool params} — range tools take `range`");
    assert!(aperto.aperto);
    assert_eq!(aperto.campi.len(), 2);
    assert_eq!(
        aperto.campi[0].tipo,
        scelta(&["regression", "histogram"], false)
    );
}

#[test]
fn le_parti_dopo_il_punto_e_virgola() {
    assert_eq!(
        tipi("{on?: bool, position?: bottom|top; trendline: series?: index (default all), order?: 2..6}"),
        vec![
            ("on".into(), Tipo::SiNo),
            ("position".into(), scelta(&["bottom", "top"], false)),
            ("series".into(), Tipo::Numero),
            ("order".into(), Tipo::Numero),
        ]
    );
    assert_eq!(
        tipi("{range?, rule: {type: cellIs, style?: {font?}}; a text `value` is matched as text, or kept when quoted}"),
        vec![("range".into(), Tipo::Intervallo), ("rule".into(), Tipo::Json)]
    );
}

#[test]
fn le_parentesi_dentro_le_virgolette_e_le_note() {
    assert_eq!(un_tipo("{header?: \"&L&A&RPage &P of &N\"}"), Tipo::Testo);
    assert_eq!(
        tipi(
            "{field (\"Σ Values\" moves the value fields; in columns it stays), from: rows|values}"
        )
        .into_iter()
        .map(|(nome, _)| nome)
        .collect::<Vec<_>>(),
        ["field", "from"]
    );
}
