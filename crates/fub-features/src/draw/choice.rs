//! Che cosa esce da un export dei disegni: le opzioni della richiesta, lette
//! e controllate prima di leggere un solo disegno, e i nomi dei file.
//!
//! Le opzioni sono quelle del formato della scena per l'export
//! (`docs/reference/scene-format-export.md`):
//!
//! - `scope`: `drawing` (di serie), `boards` o `selection`;
//! - `boards`: gli id delle tavole, almeno uno, con `scope: boards`;
//! - `selection`: `{"ids": [...], "box": [x, y, w, h]}`, con
//!   `scope: selection`;
//! - `background`: `paper` (di serie) o `none`;
//! - `suffix`: la parola fra parentesi nel nome del file della selezione, di
//!   serie `selection`, e in quello dell'SVG del disegno intero, di serie
//!   `exported`, con le regole del PDF annotato;
//! - `scale` (di serie 2) o `width`, per le immagini raster.
//!
//! Un valore sbagliato è un errore che lo nomina, prima di ogni file.
//! Un'opzione che la destinazione o l'ambito non usano si ignora, come una
//! sconosciuta: così una richiesta senza opzioni dà i file di prima.

use std::collections::BTreeSet;

use fub_abi::error::PluginError;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::transfer::artifact_key;
use fub_scene::export::{Background, Scope, Size, SCALE_MAX, SIDE_MAX};
use serde_json::Value;

use super::annotated::{suffix, UNSAFE};

const SCOPE: &str = "scope";
const BOARDS: &str = "boards";
const SELECTION: &str = "selection";
const BOX: &str = "box";
const BACKGROUND: &str = "background";
const SCALE: &str = "scale";
const WIDTH: &str = "width";

/// La scala di serie è 2, la densità di uno schermo ad alta risoluzione: a 1
/// un disegno incollato in un documento si vede sgranato.
const SCALE_DEFAULT: f32 = 2.0;
/// La parola di serie nel nome del file della selezione.
const SELECTION_SUFFIX: &str = "selection";
/// La parola di serie nel nome dell'SVG del disegno intero, che senza si
/// chiamerebbe come il disegno.
pub(super) const EXPORTED_SUFFIX: &str = "exported";
/// Quanti caratteri del nome di una tavola entrano nel nome di un file.
const BOARD_NAME_MAX: usize = 40;
/// Quanto di un valore sbagliato l'errore ripete.
const SHOWN_MAX: usize = 120;

pub(super) const E_SCALE: &str = "e_scale";
const E_SCOPE: &str = "e_scope";
const E_BOARDS: &str = "e_boards";
const E_SELECTION: &str = "e_selection";
const E_BOX: &str = "e_box";
const E_BACKGROUND: &str = "e_background";
const E_WIDTH: &str = "e_width";
const E_SCALE_AND_WIDTH: &str = "e_scale_and_width";
pub(super) const E_ONE_DRAWING: &str = "e_one_drawing";
pub(super) const E_BOARD: &str = "e_board";
pub(super) const E_OBJECT: &str = "e_object";

/// Gli errori delle opzioni, in italiano.
pub(super) fn in_italian(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(
            E_SCALE,
            "La scala dell'immagine dev'essere un numero maggiore di 0 e al massimo 8, non «{scale}».",
        )
        .with(
            E_SCOPE,
            "Che cosa esportare dev'essere drawing, boards o selection, non «{scope}».",
        )
        .with(
            E_BOARDS,
            "Le tavole da esportare devono essere una lista di id, almeno uno, non «{boards}».",
        )
        .with(
            E_SELECTION,
            "La selezione da esportare deve avere la lista degli id dei suoi oggetti, almeno uno, e il loro riquadro, non «{selection}».",
        )
        .with(
            E_BOX,
            "Il riquadro della selezione dev'essere di quattro numeri, x, y, larghezza e altezza, con la larghezza e l'altezza maggiori di 0, non «{box}».",
        )
        .with(
            E_BACKGROUND,
            "Lo sfondo dev'essere paper o none, non «{background}».",
        )
        .with(
            E_WIDTH,
            "La larghezza dell'immagine dev'essere un numero intero di pixel da 1 a 16384, non «{width}».",
        )
        .with(
            E_SCALE_AND_WIDTH,
            "La scala e la larghezza dell'immagine non vanno insieme: chiedine una sola.",
        )
        .with(
            E_ONE_DRAWING,
            "Le tavole e la selezione si esportano da un disegno alla volta, e nella selezione i disegni sono {count}.",
        )
        .with(E_BOARD, "Il disegno «{doc}» non ha la tavola «{board}».")
        .with(
            E_OBJECT,
            "Nel disegno «{doc}», «{id}» non è un oggetto che si può esportare.",
        )
}

/// Gli errori delle opzioni, in inglese.
pub(super) fn in_english(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(
            E_SCALE,
            "The image scale must be a number above 0 and at most 8, not «{scale}».",
        )
        .with(
            E_SCOPE,
            "What to export must be drawing, boards or selection, not «{scope}».",
        )
        .with(
            E_BOARDS,
            "The boards to export must be a list of ids, at least one, not «{boards}».",
        )
        .with(
            E_SELECTION,
            "The selection to export must have the list of the ids of its objects, at least one, and their box, not «{selection}».",
        )
        .with(
            E_BOX,
            "The selection box must be four numbers, x, y, width and height, with a width and a height above 0, not «{box}».",
        )
        .with(
            E_BACKGROUND,
            "The background must be paper or none, not «{background}».",
        )
        .with(
            E_WIDTH,
            "The image width must be a whole number of pixels from 1 to 16384, not «{width}».",
        )
        .with(
            E_SCALE_AND_WIDTH,
            "The image scale and width do not go together: ask for only one of them.",
        )
        .with(
            E_ONE_DRAWING,
            "Boards and selections are exported from one drawing at a time, and the selection holds {count} drawings.",
        )
        .with(E_BOARD, "The drawing «{doc}» has no board «{board}».")
        .with(
            E_OBJECT,
            "In the drawing «{doc}», «{id}» is not an object that can be exported.",
        )
}

/// Che cosa si esporta di un disegno.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Part {
    /// Il disegno intero: di ogni disegno della richiesta.
    Drawing,
    /// Le tavole con questi id, senza ripetizioni, nell'ordine della
    /// richiesta: i file escono in quello del documento.
    Boards(Vec<String>),
    /// Gli oggetti scelti, sul loro riquadro ([`Scope::Selection`]), e la
    /// parola fra parentesi nel nome del file.
    Selection { scope: Scope, suffix: String },
}

/// Le opzioni di tutte le destinazioni: che cosa, e con che sfondo.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Choice {
    pub(super) part: Part,
    pub(super) background: Background,
}

impl Choice {
    /// Le opzioni della richiesta, o l'errore del primo valore sbagliato.
    pub(super) fn read(options: &Value) -> Result<Choice, PluginError> {
        let part = match given(options, SCOPE) {
            None => Part::Drawing,
            Some(scope) => match scope.as_str() {
                Some("drawing") => Part::Drawing,
                Some("boards") => Part::Boards(boards(options)?),
                Some("selection") => selection(options)?,
                _ => return Err(wrong(E_SCOPE, SCOPE, Some(scope))),
            },
        };
        let background = match given(options, BACKGROUND) {
            None => Background::Paper,
            Some(value) => match value.as_str() {
                Some("paper") => Background::Paper,
                Some("none") => Background::None,
                _ => return Err(wrong(E_BACKGROUND, BACKGROUND, Some(value))),
            },
        };
        Ok(Choice { part, background })
    }

    /// Il disegno intero con la sua carta: il file di prima, dai byte del
    /// documento così come sono.
    pub(super) fn is_whole(&self) -> bool {
        self.part == Part::Drawing && self.background == Background::Paper
    }
}

/// Un'opzione che c'è: `null` vale come assente.
fn given<'v>(options: &'v Value, key: &str) -> Option<&'v Value> {
    options.get(key).filter(|value| !value.is_null())
}

/// L'errore `key` per il valore sbagliato dell'opzione `name`: il testo così
/// com'è, il resto in JSON, al più [`SHOWN_MAX`] caratteri.
fn wrong(key: &str, name: &str, value: Option<&Value>) -> PluginError {
    let shown = match value {
        Some(Value::String(text)) => text.clone(),
        Some(value) => value.to_string(),
        None => String::new(),
    };
    let mut cut: String = shown.chars().take(SHOWN_MAX).collect();
    if cut.len() < shown.len() {
        cut.push('…');
    }
    PluginError::BadArgs(Text::message(key, vec![Arg::text(name, cut)]))
}

/// Una lista di testi non vuota, senza ripetizioni.
fn texts(value: Option<&Value>) -> Option<Vec<String>> {
    let mut seen = BTreeSet::new();
    let mut found = Vec::new();
    for item in value?.as_array()? {
        let text = item.as_str()?;
        if seen.insert(text) {
            found.push(text.to_owned());
        }
    }
    (!found.is_empty()).then_some(found)
}

fn boards(options: &Value) -> Result<Vec<String>, PluginError> {
    let value = given(options, BOARDS);
    texts(value).ok_or_else(|| wrong(E_BOARDS, BOARDS, value))
}

fn selection(options: &Value) -> Result<Part, PluginError> {
    let value = given(options, SELECTION);
    let object = value.and_then(Value::as_object);
    let Some(ids) = texts(object.and_then(|object| object.get("ids"))) else {
        return Err(wrong(E_SELECTION, SELECTION, value));
    };
    let shown = object.and_then(|object| object.get(BOX));
    let rect = shown
        .and_then(Value::as_array)
        .and_then(|numbers| {
            numbers
                .iter()
                .map(Value::as_f64)
                .collect::<Option<Vec<_>>>()
        })
        .and_then(|numbers| <[f64; 4]>::try_from(numbers).ok());
    let Some(rect) = rect else {
        return Err(wrong(E_BOX, BOX, shown));
    };
    let scope = Scope::Selection { ids, rect };
    // Gli id ci sono: ciò che resta da dire è del riquadro.
    scope.check().map_err(|_| wrong(E_BOX, BOX, shown))?;
    Ok(Part::Selection {
        scope,
        suffix: suffix(options, SELECTION_SUFFIX)?,
    })
}

/// La misura di un'immagine raster: `scale`, un numero in `(0, 8]`, o
/// `width`, un intero da 1 a 16 384; di serie la scala 2.
pub(super) fn raster_size(options: &Value) -> Result<Size, PluginError> {
    match (given(options, SCALE), given(options, WIDTH)) {
        (Some(_), Some(_)) => Err(PluginError::BadArgs(Text::key(E_SCALE_AND_WIDTH))),
        (None, None) => Ok(Size::Scale(SCALE_DEFAULT)),
        (Some(value), None) => match value.as_f64() {
            Some(scale) if scale > 0.0 && scale <= f64::from(SCALE_MAX) => {
                Ok(Size::Scale(scale as f32))
            }
            _ => Err(PluginError::BadArgs(Text::message(
                E_SCALE,
                vec![Arg::text(SCALE, value.to_string())],
            ))),
        },
        // Un intero anche se il JSON lo scrive `800.0`: per JSON è lo stesso
        // numero.
        (None, Some(value)) => match value.as_f64() {
            Some(width) if width.fract() == 0.0 && (1.0..=f64::from(SIDE_MAX)).contains(&width) => {
                Ok(Size::Pixels(width as u32))
            }
            _ => Err(wrong(E_WIDTH, WIDTH, Some(value))),
        },
    }
}

/// Il nome di una tavola nel nome di un file: `/ \ : * ? " < > |` diventano
/// `-`, i caratteri di controllo si tolgono, gli spazi si riducono a uno e
/// quelli in cima e in fondo si tolgono, con i punti finali, e restano al più
/// 40 caratteri. Se non resta niente, `number`, il numero della tavola.
pub(super) fn board_label(name: &str, number: usize) -> String {
    let mut label = String::new();
    for c in name.chars() {
        // Prima gli spazi: un a capo o una tabulazione separano due parole
        // come uno spazio, non le incollano.
        if c.is_whitespace() {
            if !label.is_empty() && !label.ends_with(' ') {
                label.push(' ');
            }
        } else if UNSAFE.contains(&c) {
            label.push('-');
        } else if !c.is_control() {
            label.push(c);
        }
    }
    let label: String = label.chars().take(BOARD_NAME_MAX).collect();
    let label = label.trim_end_matches([' ', '.']);
    if label.is_empty() {
        number.to_string()
    } else {
        label.to_owned()
    }
}

/// I nomi dei file di un export, senza due uguali per il sink: ciò che
/// collide prende ` 1`, ` 2`, con la chiave [`artifact_key`] con cui il sink
/// rifiuterebbe il secondo.
#[derive(Default)]
pub(super) struct Names {
    taken: BTreeSet<String>,
}

impl Names {
    /// Il primo nome libero fra quelli che `candidate` dà per 0, 1, 2…
    pub(super) fn take(&mut self, candidate: impl Fn(u32) -> String) -> String {
        (0u32..)
            .map(candidate)
            .find(|name| self.taken.insert(artifact_key(name)))
            .expect("la sequenza dei candidati è infinita")
    }

    /// `base (label).extension`; se è preso, `base (label 1).extension`, e
    /// avanti: il numero è del nome della tavola, come per due disegni con lo
    /// stesso nome.
    pub(super) fn labelled(&mut self, base: &str, label: &str, extension: &str) -> String {
        self.take(|n| match n {
            0 => format!("{base} ({label}).{extension}"),
            n => format!("{base} ({label} {n}).{extension}"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn read(options: Value) -> Result<Choice, PluginError> {
        Choice::read(&options)
    }

    /// La chiave dell'errore e l'argomento che ripete.
    fn refused(outcome: Result<impl std::fmt::Debug, PluginError>) -> (String, String) {
        let Err(PluginError::BadArgs(text)) = outcome else {
            panic!("{outcome:?}");
        };
        let message = text.as_message().expect("un messaggio del catalogo");
        let shown = message
            .args
            .first()
            .map(|arg| arg.value.to_string())
            .unwrap_or_default();
        (message.key.clone(), shown)
    }

    #[test]
    fn no_options_is_the_whole_drawing_on_its_paper() {
        for options in [
            Value::Null,
            json!({}),
            json!({"scope": null, "background": null}),
        ] {
            let choice = read(options).unwrap();
            assert!(choice.is_whole());
            assert_eq!(choice.part, Part::Drawing);
        }
        let choice = read(json!({"scope": "drawing", "background": "none"})).unwrap();
        assert!(!choice.is_whole());
        // Le opzioni di un altro ambito o di un altro formato non contano.
        let choice = read(json!({
            "boards": 7,
            "selection": "tutto",
            "suffix": "/",
            "scale": "x",
            "dpi": 3,
        }))
        .unwrap();
        assert!(choice.is_whole());
    }

    #[test]
    fn boards_are_ids_without_repetitions() {
        let choice = read(json!({"scope": "boards", "boards": ["b2", "b1", "b2"]})).unwrap();
        assert_eq!(
            choice.part,
            Part::Boards(vec!["b2".to_string(), "b1".to_string()])
        );
        for wrong in [
            json!({}),
            json!({"boards": []}),
            json!({"boards": "b1"}),
            json!({"boards": ["b1", 2]}),
        ] {
            let mut options = wrong;
            options["scope"] = json!("boards");
            assert_eq!(refused(read(options)).0, E_BOARDS);
        }
    }

    #[test]
    fn a_selection_has_ids_and_a_box_with_an_area() {
        let choice = read(json!({
            "scope": "selection",
            "selection": {"ids": ["o1", "o2"], "box": [-10, 0.5, 100, 40]},
        }))
        .unwrap();
        assert_eq!(
            choice.part,
            Part::Selection {
                scope: Scope::Selection {
                    ids: vec!["o1".to_string(), "o2".to_string()],
                    rect: [-10.0, 0.5, 100.0, 40.0],
                },
                suffix: "selection".to_string(),
            }
        );
        let choice = read(json!({
            "scope": "selection",
            "selection": {"ids": ["o1"], "box": [0, 0, 1, 1]},
            "suffix": " selezione ",
        }))
        .unwrap();
        assert!(matches!(choice.part, Part::Selection { suffix, .. } if suffix == "selezione"));

        for (selection, key) in [
            (json!(null), E_SELECTION),
            (json!(["o1"]), E_SELECTION),
            (json!({"box": [0, 0, 1, 1]}), E_SELECTION),
            (json!({"ids": [], "box": [0, 0, 1, 1]}), E_SELECTION),
            (json!({"ids": [1], "box": [0, 0, 1, 1]}), E_SELECTION),
            (json!({"ids": ["o1"]}), E_BOX),
            (json!({"ids": ["o1"], "box": [0, 0, 1]}), E_BOX),
            (json!({"ids": ["o1"], "box": [0, 0, 1, "1"]}), E_BOX),
            (json!({"ids": ["o1"], "box": [0, 0, 0, 1]}), E_BOX),
            (json!({"ids": ["o1"], "box": [0, 0, 1, -1]}), E_BOX),
            // A 2 decimali è 0.
            (json!({"ids": ["o1"], "box": [0, 0, 0.004, 1]}), E_BOX),
        ] {
            let outcome = read(json!({"scope": "selection", "selection": selection}));
            assert_eq!(refused(outcome).0, key, "{selection}");
        }
        let outcome = read(json!({
            "scope": "selection",
            "selection": {"ids": ["o1"], "box": [0, 0, 1, 1]},
            "suffix": "a/b",
        }));
        assert_eq!(refused(outcome).0, "e_annotated_suffix");
    }

    #[test]
    fn a_wrong_value_is_named_in_the_error() {
        assert_eq!(
            refused(read(json!({"scope": "pagina"}))),
            (E_SCOPE.to_string(), "pagina".to_string())
        );
        assert_eq!(
            refused(read(json!({"scope": 3}))),
            (E_SCOPE.to_string(), "3".to_string())
        );
        assert_eq!(
            refused(read(json!({"background": "white"}))),
            (E_BACKGROUND.to_string(), "white".to_string())
        );
        // Un valore lungo si taglia.
        let ids: Vec<String> = (0..100).map(|n| format!("oggetto-{n}")).collect();
        let (_, shown) = refused(read(json!({"scope": "boards", "boards": [ids, 1]})));
        assert_eq!(shown.chars().count(), SHOWN_MAX + 1);
        assert!(shown.ends_with('…'));
    }

    #[test]
    fn an_image_is_measured_by_scale_or_by_width() {
        let size = |options: Value| raster_size(&options);
        assert_eq!(size(Value::Null).unwrap(), Size::Scale(2.0));
        assert_eq!(size(json!({"scale": 0.5})).unwrap(), Size::Scale(0.5));
        assert_eq!(size(json!({"scale": 8})).unwrap(), Size::Scale(8.0));
        assert_eq!(size(json!({"width": 1200})).unwrap(), Size::Pixels(1200));
        assert_eq!(size(json!({"width": 800.0})).unwrap(), Size::Pixels(800));
        assert_eq!(size(json!({"width": 16384})).unwrap(), Size::Pixels(16_384));
        assert_eq!(
            size(json!({"width": 1, "scale": null})).unwrap(),
            Size::Pixels(1)
        );
        for wrong in [json!(0), json!(16385), json!(12.5), json!(-3), json!("800")] {
            assert_eq!(refused(size(json!({"width": wrong}))).0, E_WIDTH, "{wrong}");
        }
        for wrong in [json!(0), json!(8.5), json!("2")] {
            assert_eq!(refused(size(json!({"scale": wrong}))).0, E_SCALE, "{wrong}");
        }
        assert_eq!(
            refused(size(json!({"scale": 2, "width": 100}))).0,
            E_SCALE_AND_WIDTH
        );
    }

    #[test]
    fn a_board_name_becomes_a_safe_part_of_a_file_name() {
        for (name, label) in [
            ("Copertina", "Copertina"),
            ("Mappa del porto", "Mappa del porto"),
            ("a/b\\c:d*e?f\"g<h>i|j", "a-b-c-d-e-f-g-h-i-j"),
            ("  due   spazi \t e\nriga  ", "due spazi e riga"),
            ("fine...", "fine"),
            ("fine. . .", "fine"),
            ("con\u{7}controllo\u{1b}", "concontrollo"),
            ("...", "3"),
            ("   ", "3"),
            ("", "3"),
            ("\u{0}\u{1}", "3"),
            ("v1.0", "v1.0"),
            ("Città d'acqua", "Città d'acqua"),
        ] {
            assert_eq!(board_label(name, 3), label, "{name:?}");
        }
        // Al più 40 caratteri, e ciò che il taglio lascia in fondo si toglie.
        let long = "Una tavola dal nome molto lungo che non finisce mai";
        let label = board_label(long, 1);
        assert_eq!(label, "Una tavola dal nome molto lungo che non");
        assert!(label.chars().count() <= BOARD_NAME_MAX);
        assert_eq!(board_label(&"è".repeat(50), 1).chars().count(), 40);
    }

    #[test]
    fn two_equal_names_take_a_number_inside_the_parentheses() {
        let mut names = Names::default();
        let got: Vec<String> = [
            "Copertina",
            "Mappa",
            "copertina",
            "Copertina",
            "Copertina 1",
        ]
        .into_iter()
        .map(|label| names.labelled("Scienze/acqua", label, "png"))
        .collect();
        assert_eq!(
            got,
            [
                "Scienze/acqua (Copertina).png",
                "Scienze/acqua (Mappa).png",
                "Scienze/acqua (copertina 1).png",
                "Scienze/acqua (Copertina 2).png",
                "Scienze/acqua (Copertina 1 1).png",
            ]
        );
    }
}
