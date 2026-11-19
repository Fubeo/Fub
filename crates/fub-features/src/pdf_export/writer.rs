//! Lo scrittore del PDF: un [`ElencoPagine`] diventa un PDF.
//!
//! Questo modulo tiene il filo: controlla l'elenco prima di scrivere un byte
//! ([`valida`]), scrive le pagine una per una chiedendo a ogni passo se può
//! andare avanti ([`Controllo`]), mette sopra ogni pagina i suoi collegamenti
//! e chiude il documento col catalogo, i segnalibri, la lingua e i dati
//! (titolo, autore). I pezzi stanno accanto:
//!
//! - `text`: il testo vero, coi caratteri incorporati in sotto-insieme;
//! - `images`: i vettori e le immagini, piene o alleggerite;
//! - `outline`: l'albero dei segnalibri.
//!
//! Lo stesso elenco con le stesse risorse dà sempre gli stessi byte: il PDF
//! non porta date, e ogni oggetto ha il suo numero nell'ordine in cui
//! l'elenco lo nomina.

use std::collections::BTreeMap;
use std::io::Write as _;

use flate2::write::ZlibEncoder;
use flate2::Compression;
use pdf_writer::types::{ActionType, AnnotationType};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};

use super::text::Carattere;
use super::{
    Avviso, Colore, Destinazione, ElencoPagine, ErroreEsportazione, Pezzo, Risorse, Scritto,
    MAX_COLLEGAMENTI_PAGINA, MAX_LATO_PAGINA, MAX_LIVELLO_SEGNALIBRO, MAX_PAGINE, MAX_PEZZI_PAGINA,
    MAX_SEGNALIBRI, MAX_TESTO_DATI, MAX_URL_BYTE, MAX_VETTORE_BYTE, VERSIONE,
};

/// Un pixel CSS in punti PDF.
pub(super) const PUNTI_PER_PIXEL: f32 = 0.75;

/// Quanto un pezzo può stare fuori dalla pagina prima di dirsi rotto: un
/// testo che sborda di un po' è della vista, uno a un chilometro no.
const FUORI_PAGINA: f64 = 10_000.0;

/// Le immagini nel file: come la vista le ha ricevute, o ridotte alla
/// risoluzione che serve per leggerle stampate.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum QualitaImmagini {
    /// I byte del file, così come sono: un JPEG resta il suo JPEG.
    #[default]
    Piene,
    /// Ogni immagine più fitta di 150 punti per pollice, alla misura in cui
    /// sta sulla pagina, si riduce e si ricomprime; una più leggera resta
    /// com'è.
    Alleggerite,
}

/// Come si scrive il PDF.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Opzioni {
    pub immagini: QualitaImmagini,
}

/// Perché una scrittura si è fermata prima della fine.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Interruzione {
    /// Chi l'ha chiesta l'ha annullata.
    Annullato,
    /// È passato il tempo concesso, in secondi.
    TempoScaduto { secondi: u64 },
}

/// Chi segue la scrittura: a ogni passo dice se si può andare avanti.
///
/// Lo scrittore lo chiede prima di ogni pagina e prima di ogni immagine o
/// vettore, che sono i passi lunghi. Un `Err` ferma la scrittura senza
/// scrivere altro: il PDF a metà resta in memoria e se ne va, nessun file lo
/// vede.
pub trait Controllo {
    /// `fatte` pagine scritte su `pagine`.
    fn continua(&mut self, fatte: usize, pagine: usize) -> Result<(), Interruzione>;
}

/// Il controllo di chi non ferma mai: la scrittura di [`scrivi`].
struct SenzaControllo;

impl Controllo for SenzaControllo {
    fn continua(&mut self, _: usize, _: usize) -> Result<(), Interruzione> {
        Ok(())
    }
}

impl From<Interruzione> for ErroreEsportazione {
    fn from(interruzione: Interruzione) -> Self {
        match interruzione {
            Interruzione::Annullato => ErroreEsportazione::Annullato,
            Interruzione::TempoScaduto { secondi } => ErroreEsportazione::TempoScaduto { secondi },
        }
    }
}

/// Scrive il PDF di `elenco`, coi caratteri e le immagini di `risorse`, con le
/// immagini piene e senza fermarsi.
pub fn scrivi(elenco: &ElencoPagine, risorse: &dyn Risorse) -> Result<Scritto, ErroreEsportazione> {
    scrivi_con(elenco, risorse, &Opzioni::default(), &mut SenzaControllo)
}

/// Scrive il PDF di `elenco` con le `opzioni`, chiedendo a `controllo` a ogni
/// passo se può andare avanti.
pub fn scrivi_con(
    elenco: &ElencoPagine,
    risorse: &dyn Risorse,
    opzioni: &Opzioni,
    controllo: &mut dyn Controllo,
) -> Result<Scritto, ErroreEsportazione> {
    valida(elenco)?;
    let mut scrittore = Scrittore::new(elenco, risorse, opzioni, controllo);
    scrittore.scrivi()?;
    Ok(scrittore.fine())
}

/// Controlla l'elenco intero prima di scrivere: un elenco rotto si dice per
/// nome e non diventa un PDF a metà.
pub(crate) fn valida(elenco: &ElencoPagine) -> Result<(), ErroreEsportazione> {
    if elenco.versione != VERSIONE {
        return Err(ErroreEsportazione::Versione {
            trovata: elenco.versione,
        });
    }
    let lato = |v: f64| v.is_finite() && v > 0.0 && v <= MAX_LATO_PAGINA;
    if !lato(elenco.larghezza) || !lato(elenco.altezza) {
        return Err(ErroreEsportazione::MisuraPagina);
    }
    if elenco.pagine.is_empty() || elenco.pagine.len() > MAX_PAGINE {
        return Err(ErroreEsportazione::NumeroPagine {
            pagine: elenco.pagine.len(),
        });
    }
    let lungo = |testo: &str| testo.chars().count() > MAX_TESTO_DATI;
    if lungo(&elenco.titolo) || lungo(&elenco.autore) || lungo(&elenco.lingua) {
        return Err(ErroreEsportazione::DatiTroppoLunghi);
    }
    let misura = |v: f64| v.is_finite() && v.abs() <= MAX_LATO_PAGINA + FUORI_PAGINA;
    let estensione = |v: f64| v.is_finite() && (0.0..=MAX_LATO_PAGINA + FUORI_PAGINA).contains(&v);
    let pagine = elenco.pagine.len();
    for (pagina, p) in elenco.pagine.iter().enumerate() {
        let pagina = pagina + 1;
        if p.pezzi.len() > MAX_PEZZI_PAGINA {
            return Err(ErroreEsportazione::TroppiPezzi { pagina });
        }
        for (pezzo, item) in p.pezzi.iter().enumerate() {
            let rotto = ErroreEsportazione::MisuraPezzo { pagina, pezzo };
            match item {
                Pezzo::Testo {
                    x,
                    y,
                    larghezza,
                    faccia,
                    corpo,
                    colore,
                    testo,
                    posizioni,
                    ..
                } => {
                    let corpo_valido = corpo.is_finite() && *corpo > 0.0 && *corpo <= 2_000.0;
                    let valido = misura(*x)
                        && misura(*y)
                        && estensione(*larghezza)
                        && corpo_valido
                        && colore_valido(colore)
                        && posizioni.iter().all(|p| misura(*p));
                    if !valido {
                        return Err(rotto);
                    }
                    if *faccia >= elenco.facce.len() {
                        return Err(ErroreEsportazione::FacciaSconosciuta { pagina, pezzo });
                    }
                    if testo.chars().count() != posizioni.len() {
                        return Err(ErroreEsportazione::Posizioni { pagina, pezzo });
                    }
                }
                Pezzo::Riquadro { x, y, w, h, colore } => {
                    if !misura(*x)
                        || !misura(*y)
                        || !estensione(*w)
                        || !estensione(*h)
                        || !colore_valido(colore)
                    {
                        return Err(rotto);
                    }
                }
                Pezzo::Vettore { x, y, w, h, svg } => {
                    if !misura(*x) || !misura(*y) || !estensione(*w) || !estensione(*h) {
                        return Err(rotto);
                    }
                    if svg.len() > MAX_VETTORE_BYTE {
                        return Err(ErroreEsportazione::VettoreTroppoGrande { pagina, pezzo });
                    }
                }
                Pezzo::Immagine { x, y, w, h, .. } => {
                    if !misura(*x) || !misura(*y) || !estensione(*w) || !estensione(*h) {
                        return Err(rotto);
                    }
                }
            }
        }
        if p.collegamenti.len() > MAX_COLLEGAMENTI_PAGINA {
            return Err(ErroreEsportazione::TroppiCollegamenti { pagina });
        }
        for (collegamento, c) in p.collegamenti.iter().enumerate() {
            let destinazione = match &c.destinazione {
                Destinazione::Fuori { url } => url.len() <= MAX_URL_BYTE,
                Destinazione::Dentro { pagina, y } => *pagina < pagine && misura(*y),
            };
            if !misura(c.x) || !misura(c.y) || !estensione(c.w) || !estensione(c.h) || !destinazione
            {
                return Err(ErroreEsportazione::CollegamentoRotto {
                    pagina,
                    collegamento,
                });
            }
        }
    }
    if elenco.segnalibri.len() > MAX_SEGNALIBRI {
        return Err(ErroreEsportazione::TroppiSegnalibri {
            segnalibri: elenco.segnalibri.len(),
        });
    }
    for (segnalibro, s) in elenco.segnalibri.iter().enumerate() {
        if !(1..=MAX_LIVELLO_SEGNALIBRO).contains(&s.livello)
            || s.pagina >= pagine
            || !misura(s.y)
            || lungo(&s.titolo)
        {
            return Err(ErroreEsportazione::SegnalibroRotto { segnalibro });
        }
    }
    Ok(())
}

fn colore_valido(c: &Colore) -> bool {
    c[..3]
        .iter()
        .all(|v| v.is_finite() && (0.0..=255.0).contains(v))
        && c[3].is_finite()
        && (0.0..=1.0).contains(&c[3])
}

/// Chi scrive un PDF: l'elenco, ciò che serve per leggerlo e ciò che si è
/// scritto finora. I suoi metodi stanno qui e nei moduli dei pezzi.
pub(super) struct Scrittore<'a> {
    pub(super) elenco: &'a ElencoPagine,
    pub(super) risorse: &'a dyn Risorse,
    pub(super) opzioni: &'a Opzioni,
    pub(super) controllo: &'a mut dyn Controllo,
    pub(super) pdf: Pdf,
    pub(super) prossimo: i32,
    pub(super) caratteri: Vec<Carattere>,
    /// Da faccia dell'elenco a carattere del PDF.
    pub(super) facce: Vec<usize>,
    /// Literata, tondo e corsivo: il ripiego, caricato alla prima richiesta.
    pub(super) ripiego: [Option<usize>; 2],
    /// Il ripiego di ogni faccia.
    pub(super) corsivo: Vec<bool>,
    trasparenze: BTreeMap<u32, (String, Ref)>,
    pub(super) avvisi: Vec<Avviso>,
    /// Il riferimento di ogni pagina, preso prima di scriverne una: un
    /// collegamento o un segnalibro può portare a una pagina che viene dopo.
    pub(super) pagine: Vec<Ref>,
    albero: Ref,
}

impl<'a> Scrittore<'a> {
    fn new(
        elenco: &'a ElencoPagine,
        risorse: &'a dyn Risorse,
        opzioni: &'a Opzioni,
        controllo: &'a mut dyn Controllo,
    ) -> Self {
        let mut s = Self {
            elenco,
            risorse,
            opzioni,
            controllo,
            pdf: Pdf::new(),
            prossimo: 1,
            caratteri: Vec::new(),
            facce: Vec::new(),
            ripiego: [None, None],
            corsivo: elenco.facce.iter().map(|f| f.corsivo).collect(),
            trasparenze: BTreeMap::new(),
            avvisi: Vec::new(),
            pagine: Vec::new(),
            albero: Ref::new(1),
        };
        s.albero = s.rif();
        s
    }

    pub(super) fn rif(&mut self) -> Ref {
        let r = Ref::new(self.prossimo);
        self.prossimo += 1;
        r
    }

    /// L'altezza della pagina in punti PDF.
    pub(super) fn alto(&self) -> f32 {
        self.elenco.altezza as f32 * PUNTI_PER_PIXEL
    }

    fn scrivi(&mut self) -> Result<(), ErroreEsportazione> {
        let totale = self.elenco.pagine.len();
        self.pagine = (0..totale).map(|_| self.rif()).collect();
        self.carica_facce();
        for indice in 0..totale {
            self.controllo.continua(indice, totale)?;
            self.pagina(indice)?;
        }
        self.controllo.continua(totale, totale)?;
        self.scrivi_caratteri()?;
        let segnalibri = self.segnalibri();
        let lingua = self.lingua();
        let catalogo = self.rif();
        let mut cat = self.pdf.catalog(catalogo);
        cat.pages(self.albero);
        if let Some(radice) = segnalibri {
            cat.outlines(radice);
        }
        if let Some(lingua) = &lingua {
            cat.lang(TextStr(lingua));
        }
        if !self.elenco.titolo.is_empty() {
            // Il lettore mostra il titolo nella barra, non il nome del file.
            cat.viewer_preferences().display_doc_title(true);
        }
        cat.finish();
        let conto = self.pagine.len() as i32;
        self.pdf
            .pages(self.albero)
            .kids(self.pagine.iter().copied())
            .count(conto);
        let info = self.rif();
        let mut dati = self.pdf.document_info(info);
        if !self.elenco.titolo.is_empty() {
            dati.title(TextStr(&self.elenco.titolo));
        }
        if !self.elenco.autore.is_empty() {
            dati.author(TextStr(&self.elenco.autore));
        }
        dati.creator(TextStr("Fub")).producer(TextStr("Fub"));
        dati.finish();
        Ok(())
    }

    /// La lingua dell'elenco, se è un'etichetta BCP 47; se non lo è, un avviso
    /// e niente lingua, che è meglio di una lingua sbagliata.
    fn lingua(&mut self) -> Option<String> {
        let lingua = self.elenco.lingua.trim();
        if lingua.is_empty() {
            return None;
        }
        if etichetta_di_lingua(lingua) {
            return Some(lingua.to_owned());
        }
        self.avvisi.push(Avviso::LinguaScartata {
            lingua: lingua.to_owned(),
        });
        None
    }

    fn fine(self) -> Scritto {
        Scritto {
            pdf: self.pdf.finish(),
            avvisi: self.avvisi,
        }
    }

    fn trasparenza(&mut self, alfa: f64) -> Option<(String, Ref)> {
        if alfa >= 0.999 {
            return None;
        }
        let chiave = (alfa * 1000.0).round() as u32;
        if let Some(stato) = self.trasparenze.get(&chiave) {
            return Some(stato.clone());
        }
        let rif = self.rif();
        self.pdf
            .ext_graphics(rif)
            .non_stroking_alpha(chiave as f32 / 1000.0)
            .stroking_alpha(chiave as f32 / 1000.0);
        let nome = format!("G{}", self.trasparenze.len());
        self.trasparenze.insert(chiave, (nome.clone(), rif));
        Some((nome, rif))
    }

    fn pagina(&mut self, indice: usize) -> Result<(), ErroreEsportazione> {
        let elenco = self.elenco;
        let pagina = &elenco.pagine[indice];
        let alto = self.alto();
        let largo = elenco.larghezza as f32 * PUNTI_PER_PIXEL;
        let totale = elenco.pagine.len();
        let mut c = Content::new();
        c.save_state();
        // Da qui in giù si disegna in pixel CSS, con la `y` verso il basso.
        c.transform([PUNTI_PER_PIXEL, 0.0, 0.0, -PUNTI_PER_PIXEL, 0.0, alto]);
        let mut usati: BTreeMap<usize, ()> = BTreeMap::new();
        let mut oggetti: Vec<(String, Ref)> = Vec::new();
        let mut stati: BTreeMap<String, Ref> = BTreeMap::new();
        for pezzo in &pagina.pezzi {
            match pezzo {
                Pezzo::Testo {
                    x,
                    y,
                    larghezza,
                    faccia,
                    corpo,
                    colore,
                    testo,
                    posizioni,
                    sottolineato,
                    barrato,
                } => {
                    c.save_state();
                    if let Some((nome, rif)) = self.trasparenza(colore[3]) {
                        c.set_parameters(Name(nome.as_bytes()));
                        stati.insert(nome, rif);
                    }
                    riempi(&mut c, colore);
                    self.testo(
                        &mut c, &mut usati, *faccia, *x, *y, *corpo, testo, posizioni,
                    );
                    let carattere = self.facce[*faccia];
                    for (acceso, linea) in [(*sottolineato, true), (*barrato, false)] {
                        if acceso {
                            let (spostamento, spessore) =
                                self.decorazione(carattere, linea, *corpo);
                            c.rect(
                                *x as f32,
                                (*y - spostamento) as f32,
                                *larghezza as f32,
                                spessore as f32,
                            );
                            c.fill_nonzero();
                        }
                    }
                    c.restore_state();
                }
                Pezzo::Riquadro { x, y, w, h, colore } => {
                    c.save_state();
                    if let Some((nome, rif)) = self.trasparenza(colore[3]) {
                        c.set_parameters(Name(nome.as_bytes()));
                        stati.insert(nome, rif);
                    }
                    riempi(&mut c, colore);
                    c.rect(*x as f32, *y as f32, *w as f32, *h as f32);
                    c.fill_nonzero();
                    c.restore_state();
                }
                Pezzo::Vettore { x, y, w, h, svg } => {
                    self.controllo.continua(indice, totale)?;
                    if let Some(rif) = self.vettore(svg) {
                        let nome = format!("X{}", oggetti.len());
                        disegna_oggetto(&mut c, &nome, *x, *y, *w, *h);
                        oggetti.push((nome, rif));
                    }
                }
                Pezzo::Immagine { x, y, w, h, file } => {
                    self.controllo.continua(indice, totale)?;
                    if let Some(rif) = self.immagine(file, *w, *h) {
                        let nome = format!("X{}", oggetti.len());
                        disegna_oggetto(&mut c, &nome, *x, *y, *w, *h);
                        oggetti.push((nome, rif));
                    }
                }
            }
        }
        c.restore_state();
        let contenuto = self.rif();
        let compresso = comprimi(&c.finish());
        self.pdf
            .stream(contenuto, &compresso)
            .filter(Filter::FlateDecode);
        let annotazioni = self.collegamenti(indice);
        let rif = self.pagine[indice];
        let caratteri: Vec<(String, Ref)> = usati
            .keys()
            .map(|&i| (self.caratteri[i].nome.clone(), self.caratteri[i].rif))
            .collect();
        let mut p = self.pdf.page(rif);
        p.media_box(Rect::new(0.0, 0.0, largo, alto));
        p.parent(self.albero);
        p.contents(contenuto);
        if !annotazioni.is_empty() {
            p.annotations(annotazioni.iter().copied());
        }
        let mut risorse = p.resources();
        {
            let mut fonts = risorse.fonts();
            for (nome, r) in &caratteri {
                fonts.pair(Name(nome.as_bytes()), *r);
            }
        }
        {
            let mut xo = risorse.x_objects();
            for (nome, r) in &oggetti {
                xo.pair(Name(nome.as_bytes()), *r);
            }
        }
        {
            let mut gs = risorse.ext_g_states();
            for (nome, r) in &stati {
                gs.pair(Name(nome.as_bytes()), *r);
            }
        }
        risorse.finish();
        p.finish();
        Ok(())
    }

    /// I collegamenti della pagina `indice`, come annotazioni `Link` senza
    /// bordo: verso fuori un'azione `URI`, dentro un `GoTo` al punto della
    /// pagina. Un indirizzo che il PDF non deve aprire resta fuori, con un
    /// avviso.
    fn collegamenti(&mut self, indice: usize) -> Vec<Ref> {
        let elenco = self.elenco;
        let alto = self.alto();
        let mut fatte = Vec::new();
        for c in &elenco.pagine[indice].collegamenti {
            if c.w <= 0.0 || c.h <= 0.0 {
                continue;
            }
            // Il riquadro della vista (in alto a sinistra, `y` in giù) in punti
            // PDF (in basso a sinistra, `y` in su).
            let riquadro = Rect::new(
                c.x as f32 * PUNTI_PER_PIXEL,
                alto - (c.y + c.h) as f32 * PUNTI_PER_PIXEL,
                (c.x + c.w) as f32 * PUNTI_PER_PIXEL,
                alto - c.y as f32 * PUNTI_PER_PIXEL,
            );
            let destinazione = match &c.destinazione {
                Destinazione::Fuori { url } => match indirizzo_ammesso(url) {
                    Some(uri) => Ok(uri),
                    None => {
                        self.avvisi
                            .push(Avviso::CollegamentoScartato { url: url.clone() });
                        continue;
                    }
                },
                Destinazione::Dentro { pagina, y } => {
                    Err((self.pagine[*pagina], alto - (*y as f32 * PUNTI_PER_PIXEL)))
                }
            };
            let rif = self.rif();
            let mut a = self.pdf.annotation(rif);
            a.subtype(AnnotationType::Link)
                .rect(riquadro)
                .border(0.0, 0.0, 0.0, None);
            match destinazione {
                Ok(uri) => {
                    a.action()
                        .action_type(ActionType::Uri)
                        .uri(Str(uri.as_bytes()));
                }
                Err((pagina, cima)) => {
                    a.action()
                        .action_type(ActionType::GoTo)
                        .destination()
                        .page(pagina)
                        .xyz(0.0, cima, None);
                }
            }
            a.finish();
            fatte.push(rif);
        }
        fatte
    }
}

/// L'indirizzo di un collegamento verso fuori come lo scrive il PDF, se è
/// uno che il PDF può aprire: `http`, `https` o `mailto`. Un `file:`, un
/// `javascript:` o lo schema di un'app restano fuori: chi apre il PDF non
/// deve trovarsi a eseguire o a leggere dal proprio disco con un clic.
///
/// Il PDF vuole un URI in ASCII: ogni byte fuori dall'ASCII stampabile (le
/// lettere accentate di un indirizzo, uno spazio) si scrive come `%XX`.
pub(super) fn indirizzo_ammesso(url: &str) -> Option<String> {
    let url = url.trim();
    let (schema, resto) = url.split_once(':')?;
    let schema = schema.to_ascii_lowercase();
    if !matches!(schema.as_str(), "http" | "https" | "mailto") || resto.is_empty() {
        return None;
    }
    let mut uri = String::with_capacity(url.len());
    uri.push_str(&schema);
    uri.push(':');
    for byte in resto.bytes() {
        if byte.is_ascii_graphic() {
            uri.push(byte as char);
        } else {
            uri.push_str(&format!("%{byte:02X}"));
        }
    }
    Some(uri)
}

/// Un'etichetta di lingua nella forma di BCP 47: la lingua (da 2 a 8 lettere),
/// poi parti di lettere e cifre (da 1 a 8) separate da `-`. Non dice se la
/// lingua esiste: dice che un lettore la sa leggere.
pub(super) fn etichetta_di_lingua(lingua: &str) -> bool {
    let mut parti = lingua.split('-');
    let prima = parti.next().unwrap_or_default();
    (2..=8).contains(&prima.len())
        && prima.bytes().all(|b| b.is_ascii_alphabetic())
        && parti.all(|p| (1..=8).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric()))
}

pub(super) fn riempi(c: &mut Content, colore: &Colore) {
    c.set_fill_rgb(
        (colore[0] / 255.0) as f32,
        (colore[1] / 255.0) as f32,
        (colore[2] / 255.0) as f32,
    );
}

/// Un `XObject` di `svg2pdf` (un quadrato unitario con la `y` in su) nel
/// riquadro della vista, che ha la `y` in giù.
fn disegna_oggetto(c: &mut Content, nome: &str, x: f64, y: f64, w: f64, h: f64) {
    c.save_state();
    c.transform([w as f32, 0.0, 0.0, -h as f32, x as f32, (y + h) as f32]);
    c.x_object(Name(nome.as_bytes()));
    c.restore_state();
}

pub(super) fn comprimi(dati: &[u8]) -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
    e.write_all(dati)
        .expect("scrivere in un vettore non fallisce");
    e.finish().expect("scrivere in un vettore non fallisce")
}
