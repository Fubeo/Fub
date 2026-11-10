//! Il confronto fra due inventari: le differenze, le normalizzazioni
//! dichiarate (`NORMALIZATIONS`) e le perdite.

use super::*;

/// Una chiave che il confronto trova diversa.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Difference {
    pub key: String,
    pub before: u64,
    pub after: u64,
}

impl fmt::Display for Difference {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {} → {}", self.key, self.before, self.after)
    }
}

/// Ciò che una normalizzazione salta, ai due lati del confronto.
pub(crate) enum Skip {
    /// Gli elementi con questi nomi, con i loro attributi e il loro testo;
    /// non gli elementi che contengono, che contano.
    Elements {
        ns: &'static str,
        names: &'static [&'static str],
    },
    /// Gli attributi di questi spazi dei nomi il cui nome locale comincia
    /// così.
    Attributes {
        ns: &'static [&'static str],
        prefix: &'static str,
    },
    /// Il valore intero di questo attributo: l'attributo conta, il numero no.
    Number {
        ns: &'static str,
        name: &'static str,
    },
    /// Il numero in fondo al valore `stem` seguito da un intero di questo
    /// attributo di questo elemento (`{ns}element`).
    Numbered {
        element: &'static str,
        name: &'static str,
        stem: &'static str,
    },
    /// La forma semplice di un campo (`w:fldSimple`), che conta come la forma
    /// complessa in cui il codec la riscrive: l'istruzione va con quelle del
    /// paragrafo, gli altri attributi con l'inizio del campo (`w:fldChar`), i
    /// figli (il risultato) contano come sempre.
    Field {
        ns: &'static str,
        name: &'static str,
    },
    /// Il paragrafo vuoto dopo una tabella che chiude il corpo: nel file si
    /// conta come se ci fosse.
    TrailingParagraph,
    /// I nomi dei lati di ISO 29500 (`start`, `end`), che contano come i nomi
    /// che il codec scrive (`left`, `right`): gli elementi di questi
    /// contenitori, gli attributi di questi elementi, il valore `w:val` di
    /// questi altri.
    Sides {
        boxes: &'static [&'static str],
        attributes: &'static [&'static str],
        values: &'static [&'static str],
    },
    /// Questi contenitori di proprietà quando sono vuoti, senza attributi né
    /// figli: non contano. Con un figlio contano come sempre.
    EmptyProperties {
        ns: &'static str,
        names: &'static [&'static str],
    },
    /// Il `w:val` vero (`true`, `1`, `on`) di questi interruttori di
    /// WordprocessingML (`CT_OnOff`): conta come la sua assenza.
    ImplicitTrue { elements: &'static [&'static str] },
    /// Lo sporgente nullo (`w:hanging="0"`) di `w:ind`: conta come la prima
    /// riga nulla (`w:firstLine="0"`).
    ZeroHanging,
}

/// Il nome della normalizzazione del paragrafo dopo una tabella finale.
pub(crate) const TRAILING_PARAGRAPH: &str = "paragrafo dopo la tabella finale";

/// Una differenza che il codec produce senza perdere niente, con la ragione e
/// il test che lo dimostra. Una voce entra soltanto se Word stesso la
/// rigenera, se perderla non cambia contenuto, aspetto o comportamento, e se un
/// test lo prova.
pub(crate) struct Normalization {
    pub what: &'static str,
    /// Perché perderla non perde niente.
    pub why: &'static str,
    pub skip: Skip,
}

/// Le normalizzazioni dichiarate. Ciascuna ha il suo test qui sotto (il primo è
/// `le_normalizzazioni_saltano_soltanto_ciò_che_dichiarano`), e i file del
/// corpus le portano: `docx/segni-di-word.docx` i segni di Word, e si apre
/// modificabile; `docx/falsi-allarmi.docx` e `docx/libreoffice.docx` le forme
/// della norma e di LibreOffice.
pub(crate) const NORMALIZATIONS: &[Normalization] = &[
    Normalization {
        what: "w:id",
        why: "il numero che appaia due segni dentro il pacchetto (inizio e fine \
              di un segnalibro, di un commento, di un permesso; una nota e il suo \
              richiamo; una revisione): Word li rinumera a ogni salvataggio, e \
              l'appaiamento lo prova la rilettura del modello",
        skip: Skip::Number {
            ns: NS_W,
            name: "id",
        },
    },
    Normalization {
        what: "id dei disegni",
        why: "il numero di un disegno o di una forma (`wp:docPr`, `pic:cNvPr`), \
              unico nel documento: Word lo rinumera quando serve, e nessuna \
              parte lo nomina",
        skip: Skip::Number { ns: "", name: "id" },
    },
    Normalization {
        what: "nomi numerati delle immagini",
        why: "«Picture N» è il nome che Word dà a un'immagine inserita senza \
              nome, e che il codec ricava dall'id del disegno: si rinumera con \
              l'id. Un altro nome conta per intero",
        skip: Skip::Numbered {
            element:
                "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}docPr",
            name: "name",
            stem: "Picture ",
        },
    },
    Normalization {
        what: "w:rsid*",
        why: "gli identificativi delle sessioni di modifica servono soltanto a \
              Confronta e Combina; Word ne aggiunge di nuovi a ogni salvataggio e, \
              con l'opzione «Memorizza numero casuale» spenta, li scrive senza",
        skip: Skip::Attributes {
            ns: &[NS_W],
            prefix: "rsid",
        },
    },
    Normalization {
        what: TRAILING_PARAGRAPH,
        why: "un corpo che finisce con una tabella: Word la fa sempre seguire \
              da un paragrafo, e il modello anche; il paragrafo vuoto in più \
              è un blocco anche nel file, e l'innesto non lo scrive finché \
              nessuno lo tocca",
        skip: Skip::TrailingParagraph,
    },
    Normalization {
        what: "start e end",
        why: "i nomi dei lati di ISO 29500 (`w:start`, `w:end`, `w:startChars`, \
              `jc=\"start\"`), che LibreOffice scrive: Word li legge come \
              `left` e `right`, che in un paragrafo da destra a sinistra \
              indicano già l'inizio e la fine, e il codec li riscrive così. Il \
              valore resta, e conta",
        skip: Skip::Sides {
            boxes: &["tblCellMar", "tcMar", "tblBorders", "tcBorders", "pBdr"],
            attributes: &["ind"],
            values: &["jc", "lvlJc", "tab"],
        },
    },
    Normalization {
        what: "proprietà vuote",
        why: "un contenitore di proprietà senza attributi né figli (`<w:rPr/>`, \
              `<w:pPr></w:pPr>`) dice soltanto che non c'è niente da dire: il \
              run, il paragrafo, la riga o la cella hanno le proprietà che \
              avrebbero senza. LibreOffice li scrive, il codec no. \
              `w:sectPr` e `w:tblPr` non ci sono: la loro assenza conta",
        skip: Skip::EmptyProperties {
            ns: NS_W,
            names: &["rPr", "pPr", "trPr", "tcPr"],
        },
    },
    Normalization {
        what: "vero implicito",
        why: "un interruttore di WordprocessingML (`CT_OnOff`) senza `w:val` è \
              acceso: `<w:keepNext w:val=\"true\"/>`, che LibreOffice scrive, \
              e `<w:keepNext/>`, che scrive il codec, dicono la stessa cosa. Un \
              valore spento conta, e un `w:val` di un altro elemento anche",
        skip: Skip::ImplicitTrue { elements: ON_OFF },
    },
    Normalization {
        what: "sporgente nullo",
        why: "un rientro della prima riga nullo, scritto come sporgente \
              (`w:hanging=\"0\"`, come fa LibreOffice) o come prima riga \
              (`w:firstLine=\"0\"`, come fa il codec): nei due casi la prima \
              riga non sporge e non rientra, e annulla quello dello stile. Uno \
              sporgente non nullo conta",
        skip: Skip::ZeroHanging,
    },
    Normalization {
        what: "w:fldSimple",
        why: "un campo scritto nella forma semplice: il codec lo riscrive nella \
              forma complessa (inizio, istruzione, separatore, risultato, fine), \
              che Word legge e scrive allo stesso modo; l'istruzione, gli \
              attributi e il risultato contano ancora",
        skip: Skip::Field {
            ns: NS_W,
            name: "fldSimple",
        },
    },
    Normalization {
        what: "w:proofErr",
        why: "segna dove il controllo ortografico di Word aveva trovato un \
              errore; Word lo ricalcola dal testo",
        skip: Skip::Elements {
            ns: NS_W,
            names: &["proofErr"],
        },
    },
    Normalization {
        what: "w:lastRenderedPageBreak",
        why: "dove cadeva una pagina nell'ultima impaginazione di Word: una \
              cache, che Word ricalcola",
        skip: Skip::Elements {
            ns: NS_W,
            names: &["lastRenderedPageBreak"],
        },
    },
    Normalization {
        what: "statistiche di app.xml",
        why: "il programma che ha salvato il file, la sua versione e i conteggi \
              (pagine, parole, caratteri, righe, paragrafi, minuti di modifica): \
              descrivono l'ultimo salvataggio, e Word li ricalcola a ogni \
              salvataggio",
        skip: Skip::Elements {
            ns: NS_EXTENDED,
            names: &[
                "Application",
                "AppVersion",
                "Pages",
                "Words",
                "Characters",
                "CharactersWithSpaces",
                "Lines",
                "Paragraphs",
                "TotalTime",
            ],
        },
    },
    Normalization {
        what: "paraId",
        why: "l'identificativo di un paragrafo (`w14:paraId`) e i rimandi a quelli \
              dei commenti (`w15:paraId`, `w15:paraIdParent`, `w16cid:paraId`): \
              Word li rigenera, e il codec li rinumera insieme; la risposta a un \
              commento la prova la rilettura del modello",
        skip: Skip::Attributes {
            ns: &[NS_W14, NS_W15, NS_W16CID],
            prefix: "paraId",
        },
    },
    Normalization {
        what: "w14:textId",
        why: "l'impronta di una versione del testo di un paragrafo, che Word \
              rigenera e nessuna parte nomina",
        skip: Skip::Attributes {
            ns: &[NS_W14],
            prefix: "textId",
        },
    },
];

/// La normalizzazione che conta questo elemento come un campo complesso, se
/// c'è.
pub(crate) fn simple_field(ns: &str, name: &str) -> Option<&'static str> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Field {
            ns: n_ns,
            name: n_name,
        } if ns == n_ns && name == n_name => Some(n.what),
        _ => None,
    })
}

/// Il nome che il codec scrive per un lato di ISO 29500.
fn side(name: &str) -> Option<&'static str> {
    match name {
        "start" => Some("left"),
        "end" => Some("right"),
        "startChars" => Some("leftChars"),
        "endChars" => Some("rightChars"),
        _ => None,
    }
}

/// Il nome con cui conta l'elemento `name` di WordprocessingML dentro
/// `parent`, con la normalizzazione, se è un lato.
pub(crate) fn side_element(parent: &str, name: &str) -> Option<(&'static str, &'static str)> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Sides { boxes, .. } if boxes.contains(&parent) && matches!(name, "start" | "end") => {
            side(name).map(|left| (n.what, left))
        }
        _ => None,
    })
}

/// Gli interruttori di WordprocessingML (`CT_OnOff` di ECMA-376): un `w:val`
/// che manca vale vero.
const ON_OFF: &[&str] = &[
    // Il carattere.
    "b",
    "bCs",
    "i",
    "iCs",
    "caps",
    "smallCaps",
    "strike",
    "dstrike",
    "outline",
    "shadow",
    "emboss",
    "imprint",
    "noProof",
    "snapToGrid",
    "vanish",
    "webHidden",
    "rtl",
    "cs",
    "specVanish",
    "oMath",
    // Il paragrafo.
    "keepNext",
    "keepLines",
    "pageBreakBefore",
    "widowControl",
    "suppressLineNumbers",
    "suppressAutoHyphens",
    "kinsoku",
    "wordWrap",
    "overflowPunct",
    "topLinePunct",
    "autoSpaceDE",
    "autoSpaceDN",
    "bidi",
    "adjustRightInd",
    "contextualSpacing",
    "mirrorIndents",
    "suppressOverlap",
    // La sezione, la tabella, la riga, la cella.
    "titlePg",
    "noEndnote",
    "rtlGutter",
    "formProt",
    "bidiVisual",
    "cantSplit",
    "tblHeader",
    "hidden",
    "noWrap",
    "tcFitText",
    "hideMark",
    // Lo stile, la numerazione, il controllo del contenuto.
    "semiHidden",
    "unhideWhenUsed",
    "qFormat",
    "locked",
    "autoRedefine",
    "personal",
    "personalCompose",
    "personalReply",
    "isLgl",
    "temporary",
    "showingPlcHdr",
    // Le impostazioni.
    "autoHyphenation",
    "doNotHyphenateCaps",
    "evenAndOddHeaders",
    "mirrorMargins",
    "gutterAtTop",
    "trackRevisions",
    "doNotTrackMoves",
    "doNotTrackFormatting",
    "updateFields",
    "embedTrueTypeFonts",
    "embedSystemFonts",
    "saveSubsetFonts",
    "hideSpellingErrors",
    "hideGrammaticalErrors",
    "bordersDoNotSurroundHeader",
    "bordersDoNotSurroundFooter",
    "alignBordersAndEdges",
    "linkStyles",
    "removePersonalInformation",
    "removeDateAndTime",
    "doNotShadeFormData",
    "printTwoOnOne",
    "bookFoldPrinting",
    "bookFoldRevPrinting",
    "strictFirstAndLastChars",
    "noPunctuationKerning",
    "savePreviewPicture",
    "doNotIncludeSubdocsInStats",
    "doNotAutoCompressPictures",
    "styleLockTheme",
    "styleLockQFSet",
    "formsDesign",
    "autoFormatOverride",
    "displayBackgroundShape",
    "doNotDisplayPageBoundaries",
    "printFormsData",
    "saveFormsData",
    "printPostScriptOverText",
    "printFractionalCharacterWidth",
    "showEnvelope",
    "alwaysShowPlaceholderText",
    "alwaysMergeEmptyNamespace",
    "forceUpgrade",
];

/// Come conta un attributo dell'elemento `element` di WordprocessingML (`w`)
/// per una normalizzazione: con il nome e il valore dati, o (`None`) per
/// niente. `None` fuori se l'attributo conta com'è.
pub(crate) fn equivalent_attribute(
    w: bool,
    element: &str,
    ns: &str,
    name: &str,
    value: &str,
) -> Option<(&'static str, Option<(String, String)>)> {
    if !w || ns != NS_W {
        return None;
    }
    if let Some((what, name, value)) = side_attribute(element, name, value) {
        return Some((what, Some((name, value))));
    }
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::ImplicitTrue { elements }
            if name == "val"
                && elements.contains(&element)
                && matches!(value.trim(), "true" | "1" | "on") =>
        {
            Some((n.what, None))
        }
        Skip::ZeroHanging
            if element == "ind"
                && name == "hanging"
                && crate::canonical::value(NS_W, value) == "0" =>
        {
            Some((n.what, Some(("firstLine".to_string(), value.to_string()))))
        }
        _ => None,
    })
}

/// Il nome e il valore con cui conta un attributo dell'elemento `element` di
/// WordprocessingML, con la normalizzazione, se nomina un lato.
fn side_attribute(
    element: &str,
    name: &str,
    value: &str,
) -> Option<(&'static str, String, String)> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Sides {
            attributes, values, ..
        } => {
            if attributes.contains(&element) {
                side(name).map(|left| (n.what, left.to_string(), value.to_string()))
            } else if values.contains(&element) && name == "val" && matches!(value, "start" | "end")
            {
                side(value).map(|left| (n.what, name.to_string(), left.to_string()))
            } else {
                None
            }
        }
        _ => None,
    })
}

/// La normalizzazione che non conta questo contenitore di proprietà quando è
/// vuoto, se c'è.
pub(crate) fn empty_properties(ns: &str, name: &str) -> Option<&'static str> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::EmptyProperties { ns: n_ns, names } if ns == n_ns && names.contains(&name) => {
            Some(n.what)
        }
        _ => None,
    })
}

/// La normalizzazione che salta questo elemento, se c'è.
pub(crate) fn skipped_element(ns: &str, name: &str) -> Option<&'static str> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Elements { ns: n_ns, names } if ns == n_ns && names.contains(&name) => Some(n.what),
        _ => None,
    })
}

fn integer(value: &str) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// La normalizzazione che toglie il numero al valore di questo attributo di
/// `element`, se c'è, con il valore che resta.
pub(crate) fn renumbered(
    element: &str,
    ns: &str,
    name: &str,
    value: &str,
) -> Option<(&'static str, String)> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Number {
            ns: n_ns,
            name: n_name,
        } if ns == n_ns && name == n_name && integer(value.trim()) => {
            Some((n.what, "#".to_string()))
        }
        Skip::Numbered {
            element: n_element,
            name: n_name,
            stem,
        } if ns.is_empty()
            && element == n_element
            && name == n_name
            && value.strip_prefix(stem).is_some_and(integer) =>
        {
            Some((n.what, format!("{stem}#")))
        }
        _ => None,
    })
}

/// La normalizzazione che salta questo attributo, se c'è.
pub(crate) fn skipped_attribute(ns: &str, name: &str) -> Option<&'static str> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Attributes { ns: n_ns, prefix } if n_ns.contains(&ns) && name.starts_with(prefix) => {
            Some(n.what)
        }
        _ => None,
    })
}

/// La regola all'apertura: `original` sono i byte del file, `dry` quelli di una
/// prova a vuoto del codec (scrivere il documento letto, senza modificarlo).
///
/// Nessuna chiave può diminuire: le normalizzazioni dichiarate non si contano
/// nemmeno. Nelle classi riscritte un aumento è ammesso (il codec aggiunge
/// valori predefiniti); fra le parti copiate anche un aumento è una
/// differenza. La stessa regola vale blocco per blocco del corpo: senza
/// modifiche il modello tiene i blocchi nello stesso ordine, e una differenza
/// dice quale blocco perderebbe che cosa.
pub(crate) fn open_differences(original: &Inventory, dry: &Inventory) -> Vec<Difference> {
    let mut out = losses(&original.all, &dry.all, "");
    if original.body.len() == dry.body.len() {
        for (at, (before, after)) in original.body.iter().zip(&dry.body).enumerate() {
            out.extend(losses(before, after, &format!("block {at}: ")));
        }
    } else {
        out.push(Difference {
            key: "body blocks".into(),
            before: original.body.len() as u64,
            after: dry.body.len() as u64,
        });
    }
    for dangling in dry.dangling.difference(&original.dangling) {
        out.push(Difference {
            key: format!("dangling reference {dangling}"),
            before: 0,
            after: 1,
        });
    }
    out
}

/// Le differenze della regola all'apertura ([`open_differences`]), divise fra
/// i blocchi del corpo e il resto del pacchetto.
pub(crate) struct Losses {
    /// Fuori dal corpo del documento principale, con i riferimenti che
    /// resterebbero senza la loro relazione.
    pub outside: Vec<Difference>,
    /// Blocco per blocco del corpo, nell'ordine.
    pub blocks: Vec<Vec<Difference>>,
}

/// La regola all'apertura divisa per luogo: `None` se la prova a vuoto non ha
/// i blocchi del file.
pub(crate) fn open_losses(original: &Inventory, dry: &Inventory) -> Option<Losses> {
    if original.body.len() != dry.body.len() {
        return None;
    }
    let mut outside = losses(&original.outside_body(), &dry.outside_body(), "");
    for dangling in dry.dangling.difference(&original.dangling) {
        outside.push(Difference {
            key: format!("dangling reference {dangling}"),
            before: 0,
            after: 1,
        });
    }
    let blocks = original
        .body
        .iter()
        .zip(&dry.body)
        .enumerate()
        .map(|(at, (before, after))| losses(before, after, &format!("block {at}: ")))
        .collect();
    Some(Losses { outside, blocks })
}

/// Le chiavi che diminuiscono, e le parti copiate che cambiano numero.
fn losses(before: &Counts, after: &Counts, at: &str) -> Vec<Difference> {
    let keys: BTreeSet<&Key> = before.keys().chain(after.keys()).collect();
    keys.into_iter()
        .filter_map(|key| {
            let b = before.get(key).copied().unwrap_or(0);
            let a = after.get(key).copied().unwrap_or(0);
            let copied = matches!(key, Key::Part { .. });
            (a < b || (copied && a > b)).then(|| Difference {
                key: format!("{at}{key}"),
                before: b,
                after: a,
            })
        })
        .collect()
}

/// Le differenze fra due insiemi di conteggi che devono essere uguali.
pub(crate) fn equal_differences(before: &Counts, after: &Counts, at: &str) -> Vec<Difference> {
    let keys: BTreeSet<&Key> = before.keys().chain(after.keys()).collect();
    keys.into_iter()
        .filter_map(|key| {
            let b = before.get(key).copied().unwrap_or(0);
            let a = after.get(key).copied().unwrap_or(0);
            (a != b).then(|| Difference {
                key: format!("{at}{key}"),
                before: b,
                after: a,
            })
        })
        .collect()
}
