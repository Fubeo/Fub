//! La ricetta di un elemento: la forma nativa del motore di un oggetto che la
//! scena non sa dire, tenuta nel file accanto alla grafica espansa che ogni
//! programma mostra (piano K6, T27; formato in
//! `docs/reference/scene-format-recipe.md`).
//!
//! Tre esiti per ogni costrutto del motore ([`Costrutto::esito`]):
//!
//! - **corpo**: la grafica semplice lo dice tutto (tracciati, forme semplici,
//!   testo semplice);
//! - **scena**: il formato della scena ha la sua forma (effetti e fusione,
//!   simboli, ripetizioni, spessore variabile, sfumature e motivi, penne);
//!   finché la famiglia non la scrive, un oggetto nuovo la porta come ricetta;
//! - **ricetta**: solo il motore lo sa dire (aspetto impilato, effetti vivi
//!   che la scena non ha, forme vive, fusioni di oggetti, oggetti dinamici,
//!   prospettiva, grafici).
//!
//! All'apertura ([`leggi`]) una ricetta vale se il suo elemento c'è e il suo
//! `hash` è quello del corpo dell'elemento senza la sua `transform`, il suo
//! `display` e il suo `fub:locked` ([`impronta`]): allora l'oggetto del
//! motore diventa quello della ricetta, messo dove l'elemento sta, nascosto e
//! bloccato come l'elemento. Una ricetta che non vale non blocca mai
//! l'apertura e non si perde: l'elemento resta grafica semplice con un avviso, e la ricetta resta nel
//! file finché si può leggere (rotta) o cade alla scrittura dopo (cambiata
//! fuori da Fub, orfana, doppia). Una versione più nuova apre il disegno in
//! sola lettura. Alla scrittura ([`Scritte`]) la differenza riscrive il blocco
//! delle ricette solo se cambia.
//!
//! Una ricetta non porta file: un'immagine, un documento collocato, un
//! collegamento a un file o un simbolo o un motivo che il documento non ha la
//! fanno rifiutare, così nessun percorso del disco arriva al motore.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use fub_scene::Item;
use serde_json::Value;
use vectorcraft_doc::color::{BlendMode, Paint};
use vectorcraft_doc::{
    AppearanceItem, Document, LiveShape, Node, NodeExtras, NodeId, NodeKind, Scaling,
};
use vectorcraft_geom::Affine;
use vectorcraft_svg::{RecipeEntry, RecipeError, RECIPE_VERSION};

use crate::mappa::Elemento;
use crate::perdite::{self, Perdite};

/// Le ricette che un disegno può portare: oltre, il disegno si apre in sola
/// lettura (il limite delle perdite di K5, una per ricetta).
pub const MAX_RICETTE: usize = fub_abi::MAX_DRAWING_LOSSES;

/// Come comincia il dettaglio di un avviso di ricetta: l'elemento resta
/// grafica semplice e si modifica come tale, quindi l'avviso non blocca i
/// gesti ([`perdite::controlla`] lo salta).
pub const AVVISO: &str = "la ricetta ";

/// Gli attributi dell'elemento con la ricetta che l'impronta non conta, oltre
/// alla sua `transform`: lo stato dell'oggetto, nascosto e bloccato, che il
/// corpo espanso non porta e che la differenza scrive con un `set`, come lo
/// spostamento.
const STATO: [&str; 2] = ["display", "fub:locked"];

/// L'impronta del testo di un elemento con la ricetta (formato della ricetta,
/// §2): quella del motore ([`vectorcraft_svg::element_hash`], che non conta la
/// `transform` dell'elemento) senza nemmeno il suo `display` e il suo
/// `fub:locked`. Così nascondere, mostrare, bloccare e sbloccare l'oggetto,
/// che cambiano solo quegli attributi, tengono la ricetta come spostarlo.
/// Quelli dei figli contano: sono la grafica espansa.
pub(crate) fn impronta(corpo: &str) -> String {
    let via: Vec<Range<usize>> = crate::apertura::attributi(corpo, 0)
        .map(|(_, attr)| {
            attr.into_iter()
                .filter(|a| STATO.contains(&a.nome.as_str()))
                .map(|a| a.da..a.a)
                .collect()
        })
        .unwrap_or_default();
    if via.is_empty() {
        return vectorcraft_svg::element_hash(corpo);
    }
    let mut senza = String::with_capacity(corpo.len());
    let mut da = 0;
    for r in via {
        senza.push_str(&corpo[da..r.start]);
        da = r.end;
    }
    senza.push_str(&corpo[da..]);
    vectorcraft_svg::element_hash(&senza)
}

/// Il motivo degli elementi dentro un oggetto rifatto da una ricetta: fanno
/// parte della sua grafica semplice, non sono oggetti del motore e non sono
/// perdite.
pub const COPERTO: &str = "fa parte della grafica semplice di un oggetto con la ricetta";

// ---------------------------------------------------------------------------
// La tabella
// ---------------------------------------------------------------------------

/// Che cosa scrive un costrutto del motore.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Esito {
    /// La grafica semplice lo dice tutto.
    Corpo,
    /// Il formato della scena ha la sua forma.
    Scena,
    /// Solo il motore lo sa dire: va nella ricetta.
    Ricetta,
}

/// Un costrutto del motore, come lo conta la tabella. Ogni variante di
/// `NodeKind`, di `LiveShape`, di `AppearanceItem`, di `Paint` e ogni campo di
/// `Node` e di `NodeExtras` arriva a una riga con un `match` o una
/// destrutturazione esaustiva in [`costrutti`]: un costrutto nuovo del motore
/// non compila finché non ha la sua.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Costrutto {
    // corpo
    Livello,
    Gruppo,
    Tracciato,
    TracciatoComposto,
    Testo,
    FormaSemplice,
    AttributiSvg,
    // scena
    EffettoDellaScena,
    ModoDiFusione,
    Opacita,
    Simbolo,
    SostituzioniDelSimbolo,
    Ripetizione,
    SpessoreVariabile,
    Sfumatura,
    Motivo,
    Penna,
    Tratteggio,
    Maschera,
    Ritaglio,
    Immagine,
    DocumentoCollocato,
    // ricetta
    AspettoImpilato,
    EffettoVivo,
    FormaViva,
    FusioneDiOggetti,
    Busta,
    Maglia,
    Intreccio,
    Isolamento,
    AllineamentoDelContorno,
    Sovrastampa,
    Pressione,
    Ricalco,
    TestoAvvolto,
    Grafico,
    ContorniDelTesto,
    Pixelato,
    FormaDisegnata,
    StileGrafico,
    Fetta,
    Prospettiva,
    Quota,
    PitturaViva,
    OggettiSulTracciato,
    Colorazione,
    FormaComposta,
}

impl Costrutto {
    /// Ogni riga della tabella.
    pub const TUTTI: [Costrutto; 46] = [
        Costrutto::Livello,
        Costrutto::Gruppo,
        Costrutto::Tracciato,
        Costrutto::TracciatoComposto,
        Costrutto::Testo,
        Costrutto::FormaSemplice,
        Costrutto::AttributiSvg,
        Costrutto::EffettoDellaScena,
        Costrutto::ModoDiFusione,
        Costrutto::Opacita,
        Costrutto::Simbolo,
        Costrutto::SostituzioniDelSimbolo,
        Costrutto::Ripetizione,
        Costrutto::SpessoreVariabile,
        Costrutto::Sfumatura,
        Costrutto::Motivo,
        Costrutto::Penna,
        Costrutto::Tratteggio,
        Costrutto::Maschera,
        Costrutto::Ritaglio,
        Costrutto::Immagine,
        Costrutto::DocumentoCollocato,
        Costrutto::AspettoImpilato,
        Costrutto::EffettoVivo,
        Costrutto::FormaViva,
        Costrutto::FusioneDiOggetti,
        Costrutto::Busta,
        Costrutto::Maglia,
        Costrutto::Intreccio,
        Costrutto::Isolamento,
        Costrutto::AllineamentoDelContorno,
        Costrutto::Sovrastampa,
        Costrutto::Pressione,
        Costrutto::Ricalco,
        Costrutto::TestoAvvolto,
        Costrutto::Grafico,
        Costrutto::ContorniDelTesto,
        Costrutto::Pixelato,
        Costrutto::FormaDisegnata,
        Costrutto::StileGrafico,
        Costrutto::Fetta,
        Costrutto::Prospettiva,
        Costrutto::Quota,
        Costrutto::PitturaViva,
        Costrutto::OggettiSulTracciato,
        Costrutto::Colorazione,
    ];

    /// La riga della tabella.
    pub fn esito(self) -> Esito {
        use Costrutto::*;
        match self {
            Livello | Gruppo | Tracciato | TracciatoComposto | Testo | FormaSemplice
            | AttributiSvg => Esito::Corpo,
            EffettoDellaScena
            | ModoDiFusione
            | Opacita
            | Simbolo
            | SostituzioniDelSimbolo
            | Ripetizione
            | SpessoreVariabile
            | Sfumatura
            | Motivo
            | Penna
            | Tratteggio
            | Maschera
            | Ritaglio
            | Immagine
            | DocumentoCollocato => Esito::Scena,
            AspettoImpilato
            | EffettoVivo
            | FormaViva
            | FusioneDiOggetti
            | Busta
            | Maglia
            | Intreccio
            | Isolamento
            | AllineamentoDelContorno
            | Sovrastampa
            | Pressione
            | Ricalco
            | TestoAvvolto
            | Grafico
            | ContorniDelTesto
            | Pixelato
            | FormaDisegnata
            | StileGrafico
            | Fetta
            | Prospettiva
            | Quota
            | PitturaViva
            | OggettiSulTracciato
            | Colorazione
            | FormaComposta => Esito::Ricetta,
        }
    }
}

/// Gli effetti del motore che il formato della scena dice con `fub:effect`
/// (`docs/reference/scene-format-effects.md`).
const EFFETTI_DELLA_SCENA: [&str; 4] = [
    "stylize.dropShadow",
    "stylize.innerGlow",
    "stylize.outerGlow",
    "blur.gaussian",
];

/// I costrutti di `n` stesso: i figli che sono elementi a sé contano per
/// loro; quelli che non lo sono (i pezzi di una fusione, di una busta, di un
/// composto) fanno parte del costrutto del genitore.
pub fn costrutti(n: &Node) -> Vec<Costrutto> {
    use Costrutto::*;
    let mut out = Vec::new();
    let Node {
        id: _,
        name: _,
        visible: _,
        locked: _,
        opacity,
        blend,
        isolate,
        knockout,
        knockout_shape,
        appearance,
        kind,
        bbox_angle: _,
        extras: _,
    } = n;
    if *opacity < 1.0 {
        out.push(Opacita);
    }
    if *blend != BlendMode::Normal {
        out.push(ModoDiFusione);
    }
    if *isolate || *knockout != Default::default() || *knockout_shape {
        out.push(Isolamento);
    }
    match kind {
        NodeKind::Layer { .. } => out.push(Livello),
        NodeKind::Group { clip, .. } => {
            out.push(Gruppo);
            if *clip {
                out.push(Ritaglio);
            }
        }
        NodeKind::Path { live, clipping, .. } => {
            out.push(Tracciato);
            if *clipping {
                out.push(Ritaglio);
            }
            match live.as_deref() {
                None => {}
                Some(LiveShape::Rectangle { radii, .. }) => {
                    out.push(if radii.iter().all(|r| *r == 0.0) {
                        FormaSemplice
                    } else {
                        FormaViva
                    })
                }
                Some(LiveShape::Ellipse { pie, .. }) => {
                    let intera = pie.0 == pie.1 || ((pie.1 - pie.0).abs() - 360.0).abs() < 1e-9;
                    out.push(if intera { FormaSemplice } else { FormaViva });
                }
                Some(LiveShape::Line { .. }) => out.push(FormaSemplice),
                Some(LiveShape::Polygon { .. }) | Some(LiveShape::Path { .. }) => {
                    out.push(FormaViva)
                }
            }
        }
        NodeKind::Compound { .. } => out.push(TracciatoComposto),
        NodeKind::Text(_) => out.push(Testo),
        NodeKind::Image(_) => out.push(Immagine),
        NodeKind::SymbolInstance { .. } => out.push(Simbolo),
        NodeKind::Blend { .. } => out.push(FusioneDiOggetti),
        NodeKind::Envelope { .. } => out.push(Busta),
        NodeKind::Mesh(_) => out.push(Maglia),
        NodeKind::Repeat(_) => out.push(Ripetizione),
        NodeKind::PlacedDocument(_) => out.push(DocumentoCollocato),
        NodeKind::Intertwine { .. } => out.push(Intreccio),
    }
    let (mut riempimenti, mut contorni) = (0, 0);
    for item in &appearance.items {
        let (paint, effetti) = match item {
            AppearanceItem::Fill(f) => {
                riempimenti += 1;
                if f.overprint {
                    out.push(Sovrastampa);
                }
                (&f.paint, !f.effects.is_empty())
            }
            AppearanceItem::Stroke(s) => {
                contorni += 1;
                if s.profile.is_some() {
                    out.push(SpessoreVariabile);
                }
                if s.brush.is_some() || s.start_arrow.is_some() || s.end_arrow.is_some() {
                    out.push(Penna);
                }
                if s.dash.is_some() {
                    out.push(Tratteggio);
                }
                if s.align != Default::default() {
                    out.push(AllineamentoDelContorno);
                }
                if s.overprint {
                    out.push(Sovrastampa);
                }
                if s.pressure.is_some() {
                    out.push(Pressione);
                }
                if s.gradient_mode != Default::default() {
                    out.push(Sfumatura);
                }
                (&s.paint, !s.effects.is_empty())
            }
        };
        if effetti {
            out.push(AspettoImpilato);
        }
        match paint {
            Paint::None | Paint::Solid { .. } => {}
            Paint::Gradient(_) => out.push(Sfumatura),
            Paint::Pattern { .. } => out.push(Motivo),
        }
    }
    if riempimenti > 1 || contorni > 1 {
        out.push(AspettoImpilato);
    }
    for effetto in &appearance.effects {
        out.push(if EFFETTI_DELLA_SCENA.contains(&effetto.id.as_str()) {
            EffettoDellaScena
        } else {
            EffettoVivo
        });
    }
    let NodeExtras {
        mask,
        trace,
        wrap,
        graph,
        series_index,
        type_outlines,
        pixelated,
        shaper,
        graphic_style,
        attrs,
        slice,
        perspective,
        dimension,
        intertwine,
        intertwine_tiers,
        live_paint_gaps,
        objects_on_path,
        colorize,
        compound_shape,
        shape_mode,
        symbol_overrides,
    } = n.extras();
    let segni = [
        (mask.is_some(), Maschera),
        (trace.is_some(), Ricalco),
        (wrap.is_some(), TestoAvvolto),
        (graph.is_some() || series_index.is_some(), Grafico),
        (*type_outlines, ContorniDelTesto),
        (*pixelated, Pixelato),
        (shaper.is_some(), FormaDisegnata),
        (graphic_style.is_some(), StileGrafico),
        (attrs.is_some(), AttributiSvg),
        (slice.is_some(), Fetta),
        (perspective.is_some(), Prospettiva),
        (dimension.is_some(), Quota),
        (
            intertwine.is_some() || !intertwine_tiers.is_empty(),
            Intreccio,
        ),
        (live_paint_gaps.is_some(), PitturaViva),
        (objects_on_path.is_some(), OggettiSulTracciato),
        (colorize.is_some(), Colorazione),
        (
            *compound_shape || *shape_mode != Default::default(),
            FormaComposta,
        ),
        (!symbol_overrides.is_empty(), SostituzioniDelSimbolo),
    ];
    out.extend(segni.into_iter().filter(|(si, _)| *si).map(|(_, c)| c));
    out
}

/// L'esito di `n` e di tutto ciò che contiene: quello con cui si scrive
/// come grafica nuova.
pub fn esito_albero(n: &Node) -> Esito {
    let mut e = esito(n);
    for c in n.children().into_iter().flatten() {
        e = e.max(esito_albero(c));
    }
    e
}

/// I costrutti di `n` e di tutto ciò che contiene, senza ripetizioni e in
/// un ordine fisso.
pub fn costrutti_albero(n: &Node) -> Vec<Costrutto> {
    fn giu(n: &Node, out: &mut Vec<Costrutto>) {
        out.extend(costrutti(n));
        for c in n.children().into_iter().flatten() {
            giu(c, out);
        }
    }
    let mut out = Vec::new();
    giu(n, &mut out);
    let mut visti = HashSet::new();
    out.retain(|c| visti.insert(*c));
    out.sort_by_key(|c| Costrutto::TUTTI.iter().position(|t| t == c));
    out
}

/// L'esito di `n`: il più alto dei suoi costrutti.
pub fn esito(n: &Node) -> Esito {
    costrutti(n)
        .into_iter()
        .map(Costrutto::esito)
        .max()
        .unwrap_or(Esito::Corpo)
}

// ---------------------------------------------------------------------------
// Le ricette del file
// ---------------------------------------------------------------------------

/// Che cosa succede a una ricetta del file alla prossima scrittura.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Stato {
    /// Applicata: resta finché il suo elemento resta com'è.
    Valida,
    /// Non si legge o non si applica: resta parola per parola.
    Tenuta,
    /// Cambiata fuori da Fub, orfana o doppia: cade.
    DaTogliere,
}

/// Una ricetta letta dal file.
#[derive(Clone, Debug)]
struct Voce {
    /// L'id dell'elemento a cui appartiene (`for`).
    per: String,
    /// Il suo elemento come si riscrive: la ricetta letta, col prefisso
    /// legato su di sé.
    testo: String,
    stato: Stato,
    /// Il blocco `<metadata>` della radice che la tiene, se è uno di quelli.
    blocco: Option<usize>,
}

/// Un `<metadata>` figlio della radice che tiene ricette.
#[derive(Clone, Debug)]
struct Blocco {
    /// Il suo indice fra i figli elemento della radice.
    indice: usize,
    /// Il suo testo senza le ricette, se tiene anche altro; `None` se tiene
    /// solo ricette.
    resto: Option<String>,
}

/// Le ricette di un disegno aperto, per la differenza.
#[derive(Clone, Debug, Default)]
pub struct Ricette {
    voci: Vec<Voce>,
    blocchi: Vec<Blocco>,
    /// Gli id degli elementi con una ricetta applicata.
    applicate: HashSet<String>,
}

impl Ricette {
    /// Vero se l'elemento `id` ha una ricetta applicata.
    pub fn applicata(&self, id: &str) -> bool {
        self.applicate.contains(id)
    }

    /// Quante ricette porta il file.
    pub fn quante(&self) -> usize {
        self.voci.len()
    }
}

/// Le ricette di `testo`, applicate a `doc`: gli avvisi vanno in `perdite`,
/// gli elementi dentro un oggetto rifatto prendono il motivo [`COPERTO`].
/// Restituisce anche il motivo della sola lettura, se una ricetta la chiede.
pub(crate) fn leggi(
    testo: &str,
    items: &[Item],
    elementi: &mut [Elemento],
    doc: &mut Document,
    perdite: &mut Perdite,
) -> (Ricette, Option<String>) {
    let voci = vectorcraft_svg::recipes(testo);
    let mut ricette = Ricette::default();
    if voci.is_empty() {
        return (ricette, None);
    }
    if voci.len() > MAX_RICETTE {
        // Troppe: nessuna si applica e il disegno non si scrive, così non se
        // ne perde nessuna.
        let motivo = format!("il file porta {} ricette, al più {MAX_RICETTE}", voci.len());
        for v in &voci {
            ricette.voci.push(Voce {
                per: v.for_id.clone(),
                testo: tenuta(v),
                stato: Stato::Tenuta,
                blocco: None,
            });
        }
        return (ricette, Some(motivo));
    }
    let mut span: HashMap<&[usize], [usize; 2]> = HashMap::new();
    for item in items {
        if let Item::Element(e) = item {
            span.insert(e.path.as_slice(), e.span.bytes);
        }
    }
    let mut per_nome: HashMap<String, Vec<NodeId>> = HashMap::new();
    doc.walk(|n| {
        if let Some(nome) = n.name.as_deref().filter(|n| !n.is_empty()) {
            per_nome.entry(nome.to_string()).or_default().push(n.id);
        }
    });
    let blocchi = blocchi_della_radice(testo, &voci);
    let mut piu_nuova: Option<u32> = None;
    let mut viste: HashSet<String> = HashSet::new();
    let mut coperti: Vec<Vec<usize>> = Vec::new();
    for v in &voci {
        let blocco = blocchi.iter().position(|b| b.0 == v.metadata);
        let elemento = elementi
            .iter()
            .position(|e| e.id.as_deref() == Some(v.for_id.as_str()));
        let nome = elemento.map(|i| {
            let e = &elementi[i];
            perdite::nome(e.id.as_deref(), e.tag, &e.percorso)
        });
        let mut voce = Voce {
            per: v.for_id.clone(),
            testo: tenuta(v),
            stato: Stato::Tenuta,
            blocco,
        };
        let esito = (|| -> Result<Vec<u8>, (Stato, String)> {
            let (Some(i), Some(_)) = (elemento, &nome) else {
                return Err((Stato::DaTogliere, String::new()));
            };
            if !viste.insert(v.for_id.clone()) {
                return Err((
                    Stato::DaTogliere,
                    "è doppia: vale la prima, questa cade alla prossima scrittura".into(),
                ));
            }
            match v.version_number() {
                Some(n) if n > RECIPE_VERSION => {
                    piu_nuova = piu_nuova.max(Some(n));
                    return Err((
                        Stato::Tenuta,
                        format!("è di una versione più nuova ({n}): resta com'è"),
                    ));
                }
                Some(_) => {}
                None => {
                    return Err((
                        Stato::Tenuta,
                        "non dice la sua versione: resta com'è, l'oggetto è grafica semplice"
                            .into(),
                    ))
                }
            }
            let e = &elementi[i];
            let corpo = span
                .get(e.percorso.as_slice())
                .and_then(|[da, a]| testo.get(*da..*a))
                .unwrap_or_default();
            if v.hash.as_deref() != Some(impronta(corpo).as_str()) {
                return Err((
                    Stato::DaTogliere,
                    "non vale più: l'elemento è cambiato fuori da Fub, si apre come grafica semplice"
                        .into(),
                ));
            }
            let byte = v.bytes().ok_or_else(|| {
                (
                    Stato::Tenuta,
                    "non si legge (base64 rotto): resta com'è, l'oggetto è grafica semplice".into(),
                )
            })?;
            Ok(byte)
        })();
        let byte = match esito {
            Ok(b) => b,
            Err((stato, motivo)) => {
                if let (Some(nome), false) = (&nome, motivo.is_empty()) {
                    perdite.approssimato(nome.clone(), format!("{AVVISO}{motivo}"));
                }
                voce.stato = stato;
                ricette.voci.push(voce);
                continue;
            }
        };
        let (i, nome) = (elemento.unwrap_or_default(), nome.unwrap_or_default());
        let nodo = match per_nome.get(&elementi[i].nome).map(Vec::as_slice) {
            Some([n]) => Ok(*n),
            None | Some([]) => Err(Posto::di(elementi, i)),
            Some(_) => Err(None),
        };
        match applica(doc, &elementi[i], nodo, &byte) {
            Ok(()) => {
                voce.stato = Stato::Valida;
                ricette.applicate.insert(v.for_id.clone());
                coperti.push(elementi[i].percorso.clone());
            }
            Err(Rifiutata::Nuova(n)) => {
                piu_nuova = piu_nuova.max(Some(n));
                perdite.approssimato(
                    nome,
                    format!("{AVVISO}è di una versione più nuova ({n}): resta com'è"),
                );
            }
            Err(Rifiutata::Motivo(m)) => {
                perdite.approssimato(
                    nome,
                    format!("{AVVISO}{m}: resta com'è, l'oggetto è grafica semplice"),
                );
            }
        }
        ricette.voci.push(voce);
    }
    for e in elementi.iter_mut() {
        if coperti
            .iter()
            .any(|p| e.percorso.len() > p.len() && e.percorso.starts_with(p))
        {
            e.motivo = Some(COPERTO);
        }
    }
    ricette.blocchi = blocchi
        .into_iter()
        .map(|(_, indice, resto)| Blocco { indice, resto })
        .collect();
    let motivo = piu_nuova.map(|n| {
        format!("una ricetta è di una versione più nuova del disegno ({n}, questa legge fino a {RECIPE_VERSION})")
    });
    (ricette, motivo)
}

/// L'elemento di una ricetta che resta com'è: gli attributi e il testo letti,
/// col prefisso legato su di sé, perché può finire in un altro `<metadata>`.
fn tenuta(v: &RecipeEntry) -> String {
    let attr = |nome: &str, valore: &Option<String>| match valore {
        Some(v) => format!(" {nome}=\"{}\"", vectorcraft_svg::xml_escape(v)),
        None => String::new(),
    };
    format!(
        "<vectorcraft:recipe xmlns:vectorcraft=\"{}\" for=\"{}\"{}{}>{}</vectorcraft:recipe>",
        vectorcraft_svg::EDITING_NS,
        vectorcraft_svg::xml_escape(&v.for_id),
        attr("hash", &v.hash),
        attr("v", &v.version),
        vectorcraft_svg::xml_escape(&v.data),
    )
}

/// I `<metadata>` figli della radice che tengono ricette: il loro intervallo,
/// l'indice fra i figli elemento della radice e il testo senza le ricette se
/// tengono altro.
fn blocchi_della_radice(
    testo: &str,
    voci: &[RecipeEntry],
) -> Vec<(Range<usize>, usize, Option<String>)> {
    let mut fuori: Vec<(Range<usize>, usize, Option<String>)> = Vec::new();
    for v in voci {
        let [indice] = v.metadata_path[..] else {
            continue;
        };
        if fuori.iter().any(|b| b.0 == v.metadata) {
            continue;
        }
        let mut resto = String::new();
        let mut da = v.metadata.start;
        for r in voci.iter().filter(|w| w.metadata == v.metadata) {
            resto.push_str(&testo[da..r.range.start]);
            da = r.range.end;
        }
        resto.push_str(&testo[da..v.metadata.end]);
        // Tiene altro se fra il tag di apertura e quello di chiusura resta
        // qualcosa che non è spazio.
        let interno = match (resto.find('>'), resto.rfind("</")) {
            (Some(a), Some(b)) if b > a => &resto[a + 1..b],
            _ => "",
        };
        let altro = !interno.trim().is_empty();
        fuori.push((v.metadata.clone(), indice, altro.then_some(resto)));
    }
    fuori
}

/// Perché una ricetta non si applica.
enum Rifiutata {
    Nuova(u32),
    Motivo(String),
}

/// Dove va, nel motore, l'oggetto di un elemento che l'import non ha portato:
/// il nome del genitore e quelli dei fratelli che lo seguono nel file.
struct Posto {
    genitore: String,
    dopo: Vec<String>,
}

impl Posto {
    /// Il posto dell'elemento `i`, se ha un genitore fra gli elementi (sotto
    /// la radice l'import mette gli oggetti in un livello suo).
    fn di(elementi: &[Elemento], i: usize) -> Option<Posto> {
        let e = &elementi[i];
        let g = e.genitore?;
        let mut fratelli: Vec<&Elemento> = elementi
            .iter()
            .filter(|f| f.genitore == Some(g) && f.percorso > e.percorso)
            .collect();
        fratelli.sort_by(|a, b| a.percorso.cmp(&b.percorso));
        Some(Posto {
            genitore: elementi[g].nome.clone(),
            dopo: fratelli.into_iter().map(|f| f.nome.clone()).collect(),
        })
    }

    /// Mette in `doc` un gruppo vuoto col nome `nome` al posto, prima
    /// dell'oggetto del primo fratello che segue o in fondo, e ne dà l'id.
    /// `None` se il motore non ha un oggetto solo col nome del genitore, o
    /// se quell'oggetto non ha figli.
    fn segnaposto(&self, doc: &mut Document, nome: &str, visibile: bool) -> Option<NodeId> {
        let mut trovati = Vec::new();
        doc.walk(|n| {
            if n.name.as_deref() == Some(self.genitore.as_str()) {
                trovati.push(n.id);
            }
        });
        let [genitore] = trovati[..] else {
            return None;
        };
        let id = doc.alloc_id();
        let mut gruppo = Node::group(id, Vec::new());
        gruppo.name = Some(nome.to_string());
        gruppo.visible = visibile;
        let figli = doc.node_mut(genitore)?.children_mut()?;
        let dove = self
            .dopo
            .iter()
            .find_map(|f| figli.iter().position(|c| c.name.as_deref() == Some(f)))
            .unwrap_or(figli.len());
        figli.insert(dove, std::sync::Arc::new(gruppo));
        Some(id)
    }
}

/// Toglie da `doc` l'oggetto `id` che [`Posto::segnaposto`] ha messo.
fn togli_segnaposto(doc: &mut Document, id: NodeId) {
    if let Some(figli) = doc
        .parent_of(id)
        .and_then(|g| doc.node_mut(g))
        .and_then(Node::children_mut)
    {
        figli.retain(|c| c.id != id);
    }
}

/// Applica i byte di una ricetta all'oggetto dell'elemento `e`: `nodo` è
/// l'oggetto del motore con il suo nome, o il posto dove metterlo se l'import
/// non l'ha portato (`None`: nessuno o più di uno).
///
/// L'import non porta un corpo che non disegna niente (un oggetto senza
/// riempimento e senza contorno, anche sotto una maschera): la ricetta, che
/// è valida, lo rimette al posto dell'elemento. Lo stato dell'oggetto,
/// nascosto e bloccato, è quello dell'elemento, non quello della ricetta
/// (l'impronta non lo conta, [`impronta`]).
fn applica(
    doc: &mut Document,
    e: &Elemento,
    nodo: Result<NodeId, Option<Posto>>,
    byte: &[u8],
) -> Result<(), Rifiutata> {
    let manca = || Rifiutata::Motivo("non trova il suo oggetto nel motore".into());
    if matches!(nodo, Err(None)) {
        return Err(manca());
    }
    let ctm = e
        .ctm()
        .ok_or_else(|| Rifiutata::Motivo("non trova la transform del suo elemento".into()))?;
    senza_file(byte)?;
    let letto = vectorcraft_svg::node_from_recipe(byte).map_err(|e| match e {
        RecipeError::Newer(n) => Rifiutata::Nuova(n),
        altro => Rifiutata::Motivo(format!("non si legge ({altro})")),
    })?;
    risorse_presenti(doc, &letto)?;
    let (nodo, messo) = match nodo {
        Ok(n) => (n, false),
        Err(posto) => {
            let n = posto
                .and_then(|p| p.segnaposto(doc, &e.nome, !e.nascosto))
                .ok_or_else(manca)?;
            (n, true)
        }
    };
    let (visibile, bloccato) = doc
        .node(nodo)
        .map_or((!e.nascosto, e.bloccato), |n| (n.visible, n.locked));
    if let Err(errore) = vectorcraft_svg::apply_recipe(doc, nodo, byte) {
        if messo {
            togli_segnaposto(doc, nodo);
        }
        return Err(match errore {
            RecipeError::Newer(n) => Rifiutata::Nuova(n),
            altro => Rifiutata::Motivo(format!("non si applica ({altro})")),
        });
    }
    if let Some(n) = doc.node_mut(nodo) {
        senza_nomi_dentro(n);
        n.transform(ctm, Scaling::from(true));
        n.visible = visibile;
        n.locked = bloccato;
    }
    Ok(())
}

/// Rifiuta una ricetta che porta un file: un'immagine, un documento
/// collocato o un collegamento (`link`) dovunque nel suo JSON.
fn senza_file(byte: &[u8]) -> Result<(), Rifiutata> {
    fn cerca(v: &Value) -> bool {
        match v {
            Value::Object(m) => {
                matches!(
                    m.get("type").and_then(Value::as_str),
                    Some("image" | "placeddocument")
                ) || m.get("link").is_some_and(|l| !l.is_null())
                    || m.values().any(cerca)
            }
            Value::Array(a) => a.iter().any(cerca),
            _ => false,
        }
    }
    match serde_json::from_slice::<Value>(byte) {
        Ok(v) if cerca(&v) => Err(Rifiutata::Motivo(
            "porta un'immagine o un file, che una ricetta non può portare".into(),
        )),
        // Un JSON che non si legge lo dice `node_from_recipe`.
        _ => Ok(()),
    }
}

/// Rifiuta una ricetta che usa un simbolo o un motivo che il documento non ha.
fn risorse_presenti(doc: &Document, n: &Node) -> Result<(), Rifiutata> {
    if let NodeKind::SymbolInstance { symbol, .. } = &n.kind {
        if !doc.symbols.iter().any(|s| &s.name == symbol) {
            return Err(Rifiutata::Motivo(format!(
                "usa il simbolo «{symbol}», che il disegno non ha"
            )));
        }
    }
    for item in &n.appearance.items {
        let paint = match item {
            AppearanceItem::Fill(f) => &f.paint,
            AppearanceItem::Stroke(s) => &s.paint,
        };
        if let Paint::Pattern { pattern, .. } = paint {
            if doc.pattern(pattern).is_none() {
                return Err(Rifiutata::Motivo(format!(
                    "usa il motivo «{pattern}», che il disegno non ha"
                )));
            }
        }
    }
    for c in n.children().into_iter().flatten() {
        risorse_presenti(doc, c)?;
    }
    Ok(())
}

/// Toglie i nomi agli oggetti dentro `n`: vengono dal documento in cui la
/// ricetta è nata e non devono confondersi con gli elementi di questo.
fn senza_nomi_dentro(n: &mut Node) {
    if let Some(figli) = n.children_mut() {
        for c in figli.iter_mut() {
            let c = std::sync::Arc::make_mut(c);
            c.name = None;
            senza_nomi_dentro(c);
        }
    }
}

// ---------------------------------------------------------------------------
// La scrittura
// ---------------------------------------------------------------------------

/// I byte della ricetta di `n`, nello spazio del suo elemento (`locale`
/// porta dal documento del motore lì), senza i nomi degli oggetti dentro.
pub(crate) fn codifica(n: &Node, locale: Affine) -> Result<Vec<u8>, String> {
    let mut copia = n.clone();
    copia.name = None;
    senza_nomi_dentro(&mut copia);
    copia.transform(locale, Scaling::from(true));
    let byte = vectorcraft_svg::recipe_of(&copia);
    match senza_file(&byte) {
        Ok(()) => Ok(byte),
        Err(Rifiutata::Motivo(m)) => Err(m),
        Err(Rifiutata::Nuova(v)) => Err(format!("è di una versione più nuova ({v})")),
    }
}

/// Le ricette che un gesto scrive: le nuove e gli elementi che non le
/// tengono più.
#[derive(Debug, Default)]
pub(crate) struct Scritte {
    /// Gli elementi delle ricette nuove, già scritti.
    pub nuove: Vec<String>,
    /// Gli id degli elementi tolti o riscritti: la loro ricetta vecchia cade.
    pub via: HashSet<String>,
}

impl Scritte {
    /// Le operazioni che riscrivono il blocco delle ricette, se cambia:
    /// i `remove` (col percorso, per ordinarli) e l'`add`.
    pub(crate) fn operazioni(
        &self,
        ricette: &Ricette,
    ) -> (Vec<(Vec<usize>, Value)>, Option<Value>) {
        let cade = |v: &Voce| v.stato == Stato::DaTogliere || self.via.contains(&v.per);
        // Le ricette in un `<metadata>` che non è figlio della radice non si
        // riscrivono: restano dove sono.
        let cambia =
            !self.nuove.is_empty() || ricette.voci.iter().any(|v| v.blocco.is_some() && cade(v));
        if !cambia {
            return (Vec::new(), None);
        }
        let mut remove = Vec::new();
        let mut raw = String::new();
        for b in &ricette.blocchi {
            remove.push((
                vec![b.indice],
                serde_json::json!({ "op": "remove", "target": { "path": [b.indice], "tag": "metadata" } }),
            ));
            if let Some(resto) = &b.resto {
                raw.push_str(resto);
            }
        }
        let tenute: Vec<&str> = ricette
            .voci
            .iter()
            .filter(|v| v.blocco.is_some() && !cade(v))
            .map(|v| v.testo.as_str())
            .chain(self.nuove.iter().map(String::as_str))
            .collect();
        if !tenute.is_empty() {
            raw.push_str("<metadata>");
            for t in tenute {
                raw.push_str(t);
            }
            raw.push_str("</metadata>");
        }
        let add = (!raw.is_empty()).then(|| {
            serde_json::json!({ "op": "add", "parent": "#root", "pos": { "first": true }, "raw": raw })
        });
        (remove, add)
    }
}

/// Il motivo di un avviso di ricetta in una perdita: non blocca i gesti.
pub(crate) fn e_un_avviso(dettaglio: &str) -> bool {
    dettaglio.starts_with(AVVISO)
}

#[cfg(test)]
mod prove {
    use super::*;

    /// L'impronta non conta la `transform`, il `display` e il `fub:locked`
    /// dell'elemento, ma quelli dei figli sì.
    #[test]
    fn l_impronta_non_conta_lo_stato_dell_elemento() {
        let base = "<g id=\"oa\"><rect display=\"none\" x=\"1\"/></g>";
        let con_stato = "<g display=\"none\" id=\"oa\" fub:locked=\"true\" transform=\"translate(2 0)\"><rect display=\"none\" x=\"1\"/></g>";
        assert_eq!(impronta(con_stato), impronta(base));
        assert_eq!(impronta(base), vectorcraft_svg::element_hash(base));
        let figlio_mostrato = "<g id=\"oa\"><rect x=\"1\"/></g>";
        assert_ne!(impronta(figlio_mostrato), impronta(base));
        let altro = "<g id=\"oa\" opacity=\"0.5\"><rect display=\"none\" x=\"1\"/></g>";
        assert_ne!(impronta(altro), impronta(base));
    }

    /// Il limite delle ricette, da solo (il file vero si ferma prima, al
    /// tetto degli elementi della scena): oltre, nessuna si applica, tutte
    /// restano e la lettura chiede la sola lettura col motivo.
    #[test]
    fn oltre_il_limite_nessuna_si_applica() {
        let una = "<vectorcraft:recipe for=\"a\" hash=\"0\" v=\"1\">e30=</vectorcraft:recipe>";
        let testo = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><metadata xmlns:vectorcraft=\"{}\">{}</metadata></svg>",
            vectorcraft_svg::EDITING_NS,
            una.repeat(MAX_RICETTE + 1)
        );
        let mut doc = Document::new(0.0, 0.0);
        let mut perdite = Perdite::nuove();
        let (ricette, motivo) = leggi(&testo, &[], &mut [], &mut doc, &mut perdite);
        assert!(motivo.is_some_and(|m| m.contains("ricette")));
        assert_eq!(ricette.quante(), MAX_RICETTE + 1);
        assert!(ricette.applicate.is_empty());
        assert!(ricette.voci.iter().all(|v| v.stato == Stato::Tenuta));
    }

    /// Ogni costrutto compare una volta sola e i tre esiti ci sono.
    #[test]
    fn la_tabella_e_intera() {
        let mut visti = HashSet::new();
        assert!(Costrutto::TUTTI.iter().all(|c| visti.insert(*c)));
        for e in [Esito::Corpo, Esito::Scena, Esito::Ricetta] {
            assert!(Costrutto::TUTTI.iter().any(|c| c.esito() == e));
        }
    }
}
