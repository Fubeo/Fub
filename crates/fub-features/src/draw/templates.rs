//! I modelli di «Nuovo disegno» distribuiti con Fub.
//!
//! Sono sette disegni, ciascuno in due lingue, in `templates/` accanto ai
//! sorgenti del crate: `<id>.it.svg` e `<id>.en.svg`. Sono file di scena come
//! quelli che scrive l'editor, generati e non scritti a mano, e il binario li
//! porta dentro con `include_str!`: niente si legge dal disco e niente si
//! scarica. L'ottavo modello, `blank`, non ha file: è il documento nuovo del
//! provider dei disegni, com'è sempre stato.
//!
//! Il titolo del file è il nome del modello nella sua lingua; alla creazione il
//! comando lo sostituisce col nome del disegno. I nomi dei livelli, delle
//! tavole e i testi sono nella lingua del file.

use fub_abi::locale::Locale;

/// Il modello vuoto: nessun file, il documento nuovo del provider.
pub(super) const BLANK: &str = "blank";

/// Un modello con i suoi due file.
pub(super) struct Template {
    /// L'id, anche il valore della scelta `template`.
    pub id: &'static str,
    it: &'static str,
    en: &'static str,
}

/// Un modello dai suoi file, `$id` è il nome comune ai due.
macro_rules! template {
    ($id:literal) => {
        Template {
            id: $id,
            it: include_str!(concat!("../../templates/", $id, ".it.svg")),
            en: include_str!(concat!("../../templates/", $id, ".en.svg")),
        }
    };
}

/// I modelli con un file, nell'ordine in cui la scelta li propone dopo
/// `blank`.
pub(super) static TEMPLATES: [Template; 7] = [
    template!("a4-portrait"),
    template!("a4-landscape"),
    template!("slide"),
    template!("diagram"),
    template!("lesson"),
    template!("storyboard"),
    template!("concept-map"),
];

/// Gli id delle scelte di `template`, nell'ordine in cui si propongono:
/// `blank` e poi i modelli con un file.
pub(super) fn ids() -> impl Iterator<Item = &'static str> {
    std::iter::once(BLANK).chain(TEMPLATES.iter().map(|template| template.id))
}

/// Il file del modello `id` nella lingua `language` (`en`, o `it` per ogni
/// altra). `None` per `blank`, che non ha file, e per un id che non c'è.
pub(super) fn source(id: &str, language: Language) -> Option<&'static str> {
    TEMPLATES
        .iter()
        .find(|template| template.id == id)
        .map(|template| match language {
            Language::English => template.en,
            Language::Italian => template.it,
        })
}

/// Le due lingue dei file.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(super) enum Language {
    Italian,
    English,
}

impl Language {
    /// La lingua dei file per chi legge con `locale`: l'inglese, regione
    /// compresa o no, e l'italiano per ogni altra, come il nome di un disegno
    /// senza nome.
    pub(super) fn of(locale: &Locale) -> Self {
        if locale.language_base().eq_ignore_ascii_case("en") {
            Language::English
        } else {
            Language::Italian
        }
    }
}
