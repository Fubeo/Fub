//! Ciò che la classificazione restituisce: ruoli, ciclo di vita, stili,
//! campioni, motivi, livelli, tratti e gli elementi della scena.

use super::*;

/// Che cosa rappresenta un elemento modificabile.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Un `title` fuori da un'unità: della radice, di un livello, di un gruppo.
    Title,
    /// Un `desc` fuori da un'unità.
    Desc,
    /// La carta: il `rect` figlio della radice con `fub:role="paper"`.
    Paper,
    /// Un `g` figlio della radice con `fub:layer`.
    Layer,
    /// Ogni altro `g`.
    Group,
    /// Un `a`.
    Link,
    /// Un `path` con `fub:tool` `pen` o `highlighter` (§5).
    Stroke,
    /// Un `path` con `fub:shape="arrow"` e un `fub:geom` di quattro numeri (§6).
    Arrow,
    /// Un `path` con `fub:shape="connector"` e un `fub:geom` che si legge: la
    /// linea che unisce due oggetti (formato della scena, connettori).
    Connector,
    /// Un `path` con `fub:shape="polygon"` e un `fub:geom` che si legge: il
    /// poligono regolare sintetico (§6). `Polygon` è l'elemento `polygon`.
    Ngon,
    /// Un `path` con `fub:shape="star"` e un `fub:geom` che si legge (§6).
    Star,
    /// Un `path` con `fub:shape="width"` e un `fub:geom` che si legge: il
    /// contorno a spessore variabile (§6).
    Width,
    /// Ogni altro `path`.
    Path,
    Rect,
    Ellipse,
    Circle,
    Line,
    Polyline,
    Polygon,
    Text,
    Image,
    /// Una `defs` della radice: tiene le risorse.
    Defs,
    /// Una risorsa modificabile in una `defs` della radice (formato della
    /// scena, risorse).
    Resource,
    /// Una tavola: un `view` della radice (formato della scena, tavole).
    Board,
    /// Un simbolo: un `symbol` di una `defs` della radice, coi figli giudicati
    /// uno per uno come in un gruppo (formato della scena, simboli).
    Symbol,
    /// Un'istanza di un simbolo: un `use` che lo mostra dove sta.
    Instance,
    /// Una copia in una ripetizione: un `use` che mostra l'originale, suo
    /// fratello, dove lo porta la sua `transform` (formato della scena,
    /// ripetizioni).
    Copy,
}

impl Role {
    /// Vero per i ruoli i cui figli si classificano uno per uno.
    pub fn is_container(self) -> bool {
        matches!(
            self,
            Role::Layer | Role::Group | Role::Link | Role::Defs | Role::Symbol
        )
    }
}

/// Come vive una risorsa, da `fub:role` (formato della scena, risorse):
/// `private` è di un oggetto e duplicarlo la copia, `shared` è di chi usa la
/// stessa cosa; tutte e due se ne vanno col loro ultimo riferimento. `swatch`
/// è un campione del documento, un colore o un motivo con un nome: resta
/// anche senza riferimenti, e duplicare chi lo usa lo condivide. Senza, la
/// risorsa resta. `style` è uno stile del documento: resta anche senza chi lo
/// segue, e le risorse private che usa sono sue.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lifecycle {
    Private,
    Shared,
    Swatch,
    Style,
}

/// Il tipo di uno stile del documento (formato della scena, stili).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StyleKind {
    /// Un `text`: il carattere e il colore di un testo.
    Text,
    /// Una `polyline`: l'aspetto di una forma.
    Graphic,
}

impl StyleKind {
    /// Il tipo di stile del prototipo di tag `tag`.
    pub(super) fn of(tag: Tag) -> Option<StyleKind> {
        match tag {
            Tag::Text => Some(StyleKind::Text),
            Tag::Polyline => Some(StyleKind::Graphic),
            _ => None,
        }
    }

    /// Il tipo di stile che un elemento di ruolo `role` può seguire, o `None`
    /// se non ne segue: il testo uno di testo, le forme, i tratti, le
    /// immagini e i gruppi uno grafico. Non i livelli, i collegamenti, la
    /// carta, le tavole e le risorse.
    pub fn followed_by(role: Role) -> Option<StyleKind> {
        match role {
            Role::Text => Some(StyleKind::Text),
            Role::Group
            | Role::Stroke
            | Role::Arrow
            | Role::Connector
            | Role::Ngon
            | Role::Star
            | Role::Width
            | Role::Path
            | Role::Rect
            | Role::Ellipse
            | Role::Circle
            | Role::Line
            | Role::Polyline
            | Role::Polygon
            | Role::Image => Some(StyleKind::Graphic),
            _ => None,
        }
    }
}

/// Uno stile del documento (formato della scena, stili): il suo nome, com'è
/// scritto, e il tipo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct StyleFacts {
    pub name: String,
    pub kind: StyleKind,
}

/// I punti di uno stile grafico: una spezzata aperta nel riquadro 100 × 100.
pub const STYLE_GRAPHIC_POINTS: &str = "0,0 100,0 100,100";

/// Gli attributi SVG del prototipo di uno stile di testo: il carattere e il
/// colore.
const TEXT_STYLE: [&str; 8] = [
    "id",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "text-decoration",
    "fill",
];

/// Gli attributi SVG del prototipo di uno stile grafico: i suoi punti e
/// l'aspetto di una spezzata, senza geometria, visibilità o ritagli.
const GRAPHIC_STYLE: [&str; 15] = [
    "id",
    "points",
    "fill",
    "fill-opacity",
    "stroke",
    "stroke-opacity",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "marker-start",
    "marker-end",
    "opacity",
    "style",
    "filter",
];

/// Lo stile del documento che è `element`, una risorsa modificabile con
/// `fub:role="style"` (formato della scena, stili); `None` se non ha la sua
/// forma, e allora è estraneo. Lo stile è un prototipo: un `text` o una
/// `polyline` coi punti di [`STYLE_GRAPHIC_POINTS`], con un nome `fub:name`
/// che non è vuoto, soltanto gli attributi SVG del suo tipo, un
/// `fub:leading` valido se è di testo, e per figli soltanto `title` e
/// `desc`. I valori li giudica la classificazione, come per ogni elemento.
pub(super) fn style_of(doc: &Document<'_>, element: &Element<'_>) -> Option<StyleFacts> {
    let kind = StyleKind::of(Tag::of(element)?)?;
    let name = element.value(NS_FUB, "name")?;
    if trim(name).is_empty() {
        return None;
    }
    let allowed: &[&str] = match kind {
        StyleKind::Text => &TEXT_STYLE,
        StyleKind::Graphic => &GRAPHIC_STYLE,
    };
    if element
        .attrs
        .iter()
        .any(|attr| attr.ns == NS_NONE && !allowed.contains(&attr.local))
    {
        return None;
    }
    if kind == StyleKind::Graphic && element.value(NS_NONE, "points") != Some(STYLE_GRAPHIC_POINTS)
    {
        return None;
    }
    if kind == StyleKind::Text
        && element
            .value(NS_FUB, "leading")
            .is_some_and(|value| leading(value).is_none())
    {
        return None;
    }
    element
        .children
        .iter()
        .all(|&child| blank_or_meta(doc, child) == Some(true))
        .then(|| StyleFacts {
            name: name.to_owned(),
            kind,
        })
}

/// Vero se `element`, un `text` o una `polyline` con `fub:role="style"` in
/// una `defs` della radice, è uno stile modificabile (formato della scena,
/// stili): un id, la forma di [`style_of`] e gli attributi di §4 per il suo
/// tag, coi riferimenti risolti da `resolve`.
pub(super) fn style_allowed(
    doc: &Document<'_>,
    element: &Element<'_>,
    tag: Tag,
    resolve: Resolve<'_>,
) -> bool {
    element
        .value(NS_NONE, "id")
        .is_some_and(|id| !id.is_empty())
        && style_of(doc, element).is_some()
        && attributes_allowed(element, tag, resolve, false)
}

/// Vero se `element`, figlio di una `defs` della radice, si dice uno stile:
/// un `text` o una `polyline` con `fub:role="style"`.
pub(super) fn claims_style(element: &Element<'_>, tag: Tag) -> bool {
    StyleKind::of(tag).is_some() && element.value(NS_FUB, "role") == Some("style")
}

/// Un campione del documento (formato della scena, risorse): il suo nome,
/// com'è scritto, e il colore, `#rrggbb` minuscolo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Swatch {
    pub name: String,
    pub color: String,
}

/// Un motivo del documento (formato della scena, risorse): il suo nome,
/// com'è scritto.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Motif {
    pub name: String,
}

/// Il motivo del documento che è `element`, una risorsa modificabile con
/// `fub:role="swatch"`: un `pattern` con un nome `fub:name` che non è vuoto.
/// `None` se non lo è, e allora è una risorsa senza ciclo di vita.
pub(super) fn motif_of(element: &Element<'_>) -> Option<Motif> {
    if !element.is_svg("pattern") {
        return None;
    }
    let name = element.value(NS_FUB, "name")?;
    (!trim(name).is_empty()).then(|| Motif {
        name: name.to_owned(),
    })
}

/// Il campione che è `element`, una risorsa modificabile con
/// `fub:role="swatch"`; `None` se non ha la sua forma, e allora è una risorsa
/// senza ciclo di vita. Un campione è una `linearGradient` con un nome
/// `fub:name` che non è vuoto, che di SVG ha soltanto `id` e `gradientUnits`,
/// e un solo `stop`, con un `stop-color` che è un colore e senza
/// trasparenza.
pub(super) fn swatch_of(doc: &Document<'_>, element: &Element<'_>) -> Option<Swatch> {
    if !element.is_svg("linearGradient") {
        return None;
    }
    let name = element.value(NS_FUB, "name")?;
    if trim(name).is_empty() {
        return None;
    }
    if element
        .attrs
        .iter()
        .any(|attr| attr.ns == NS_NONE && attr.local != "id" && attr.local != "gradientUnits")
    {
        return None;
    }
    let mut color = None;
    for &child in &element.children {
        let Some(stop) = doc.element(child).filter(|e| e.is_svg("stop")) else {
            continue;
        };
        if color.is_some() {
            return None;
        }
        let Paint::Color([r, g, b]) = paint(stop.value(NS_NONE, "stop-color").unwrap_or(""))?
        else {
            return None;
        };
        if stop
            .value(NS_NONE, "stop-opacity")
            .is_some_and(|alpha| opacity(alpha) != Some(1.0))
        {
            return None;
        }
        color = Some(format!("#{r:02x}{g:02x}{b:02x}"));
    }
    Some(Swatch {
        name: name.to_owned(),
        color: color?,
    })
}

/// Che cosa è una risorsa per chi la usa (formato della scena, risorse): `fill`
/// e `stroke` usano sfumature e motivi, `marker-*` i marcatori, `clip-path`,
/// `mask` e `filter` ritagli, maschere e filtri, un `textPath` un tracciato
/// (formato della scena, testo), e un `use` un simbolo (formato della scena,
/// simboli). Un `use` figlio di una ripetizione usa anche un originale, suo
/// fratello, che non è una risorsa e vale soltanto per i fratelli (formato
/// della scena, ripetizioni).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum ResourceKind {
    Gradient,
    Pattern,
    Marker,
    Clip,
    Mask,
    Filter,
    Path,
    Symbol,
    Original,
}

/// Il tipo della risorsa modificabile che porta un id, o `None` se nessuna
/// risorsa modificabile lo porta.
pub(super) type Resolve<'r> = &'r dyn Fn(&str) -> Option<ResourceKind>;

/// Un documento senza risorse.
pub(super) fn no_resources(_: &str) -> Option<ResourceKind> {
    None
}

/// Dove sta un elemento: figlio della radice, di una `defs` della radice, o
/// di un altro contenitore modificabile.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(super) enum Place {
    Root,
    Defs,
    Inside,
}

/// Lo strumento di un tratto.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Pen,
    Highlighter,
}

/// I tag d'apertura e di chiusura di un contenitore. `close` manca quando il
/// contenitore è autochiuso (`<g/>`): allora `open` è l'elemento intero.
#[derive(Copy, Clone, Debug, PartialEq, Serialize)]
pub struct Tags {
    pub open: Span,
    pub close: Option<Span>,
}

/// Il nome e lo stato di un livello (§3).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Layer {
    pub name: String,
    /// `fub:locked="true"`.
    pub locked: bool,
    /// `display="none"`.
    pub hidden: bool,
}

/// Un tratto a mano libera.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Stroke {
    pub tool: Tool,
    /// Vero se `fub:ink` e `fub:brush` si leggono e l'inchiostro non ha
    /// canali sconosciuti: la superficie può ricalcolare `d`. Altrimenti il
    /// tratto si sposta, si trasforma, si ricolora e si elimina, e `d` resta
    /// com'è (S004, S010).
    pub redrawable: bool,
    /// I campioni di `fub:ink`, se si legge.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<usize>,
    /// La durata in millisecondi, se `fub:ink` si legge e ha il canale `t`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
}

/// La radice `<svg>`: è il documento, e non si classifica.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RootItem {
    #[serde(flatten)]
    pub span: Span,
    pub tags: Tags,
}

/// Un connettore letto: il percorso di `fub:geom` e i due capi, `null` per
/// un capo libero o scritto fuori dalla grammatica.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ConnectorFacts {
    pub geom: ConnectorGeom,
    pub from: Option<ConnectorEnd>,
    pub to: Option<ConnectorEnd>,
}

/// Un elemento modificabile.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementItem {
    /// Gli indici dei figli elemento dalla radice: è il modo in cui le
    /// operazioni della superficie indicano il loro bersaglio. La radice è
    /// `[]`.
    pub path: Vec<usize>,
    pub tag: &'static str,
    pub role: Role,
    pub id: Option<String>,
    #[serde(flatten)]
    pub span: Span,
    /// Il rientro della riga su cui l'elemento comincia.
    pub indent: String,
    /// I tag di livelli, gruppi e collegamenti.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Tags>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer: Option<Layer>,
    /// `fub:locked="true"` su un livello, un gruppo, un collegamento o una
    /// forma (§3): non si sceglie sul foglio, e ciò che contiene non cambia.
    /// Su un livello ripete `layer`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub locked: bool,
    /// `display="none"` su un livello, un gruppo, un collegamento o una
    /// forma: non si vede. Su un livello ripete `layer`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
    /// `x1 y1 x2 y2` di una freccia.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrow: Option<[f64; 4]>,
    /// Il percorso e gli agganci di un connettore (formato della scena,
    /// connettori).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector: Option<ConnectorFacts>,
    /// La geometria di un poligono regolare o di una stella: `fub:geom` letto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub polygonal: Option<Polygonal>,
    /// La geometria di un contorno a spessore variabile: `fub:geom` letto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub varwidth: Option<VarWidth>,
    /// Il testo del primo `title` figlio di un livello o di un oggetto, coi
    /// riferimenti risolti e gli spazi com'erano: il nome che qualcuno gli ha
    /// dato.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Il testo di un `title` o di un `desc`, coi riferimenti risolti e gli
    /// spazi com'erano: è ciò che l'operazione `meta` sostituisce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Le righe di un `text`, una per `tspan` coi suoi pezzi, o il testo del
    /// suo tracciato, coi riferimenti risolti e gli spazi com'erano: è il
    /// testo che l'operazione `text` sostituisce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<String>>,
    /// La larghezza di un testo in area, `fub:wrap` letto (formato della
    /// scena, testo).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap: Option<f64>,
    /// Per ogni riga di un testo in area, se continua una parola della riga
    /// prima: `fub:join="word"`, dopo la prima riga. C'è soltanto se una riga
    /// la continua; il paragrafo unisce le altre con uno spazio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glued: Option<Vec<bool>>,
    /// L'id del tracciato che un testo segue (formato della scena, testo).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_path: Option<String>,
    /// Il connettore di cui un testo è l'etichetta, e dove sta: `fub:along`
    /// letto (formato della scena, connettori).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub along: Option<LabelPlace>,
    /// La forma di cui un testo è l'etichetta: `fub:inside` letto, l'id
    /// (formato della scena, etichette). Se la forma va bene lo dice chi
    /// conosce il resto del documento.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inside: Option<String>,
    /// Il ciclo di vita di una risorsa, se `fub:role` lo dice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<Lifecycle>,
    /// Il nome e il colore di un campione del documento.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swatch: Option<Swatch>,
    /// Il nome di un motivo del documento.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motif: Option<Motif>,
    /// Il nome e il tipo di uno stile del documento.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<StyleFacts>,
    /// Lo stile che un oggetto segue: `fub:style`, com'è scritto, anche se
    /// non porta a uno stile (formato della scena, stili).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follows: Option<String>,
    /// Il rettangolo di una tavola, `x y w h` del suo `viewBox` (formato della
    /// scena, tavole).
    #[serde(rename = "box", skip_serializing_if = "Option::is_none")]
    pub board_box: Option<[f64; 4]>,
    /// La tavola di una carta: `fub:board`, com'è scritto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board: Option<String>,
    /// Il simbolo di un'istanza: l'id a cui rimanda (formato della scena,
    /// simboli).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    /// Da dove viene un simbolo copiato da una libreria: `fub:source`, com'è
    /// scritto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// La ripetizione di un gruppo: `fub:repeat` letto (formato della scena,
    /// ripetizioni).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat: Option<Repeat>,
    /// L'originale di una copia: l'id del fratello a cui rimanda.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original: Option<String>,
}

/// Una sequenza contigua di nodi estranei (§8).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignItem {
    /// Il percorso del contenitore; `None` per il prologo e l'epilogo del
    /// documento, fuori dalla radice.
    pub parent_path: Option<Vec<usize>>,
    #[serde(flatten)]
    pub span: Span,
    /// Gli indici `[da, a)` dei figli elemento del contenitore che il blocco
    /// comprende: un elemento estraneo senza id si indirizza con
    /// `parent_path` più il suo indice. Un blocco senza elementi ha `da = a`,
    /// l'indice del primo elemento che lo segue; nel documento la radice è
    /// l'elemento 0.
    pub elements: [usize; 2],
    pub indent: String,
}

/// Una voce della scena, in ordine di documento.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Item {
    Root(RootItem),
    Element(Box<ElementItem>),
    Foreign(ForeignItem),
}
