//! Lo scrittore minimo della prova: un [`ElencoPagine`] diventa un PDF.
//!
//! Il testo esce come testo vero: ogni faccia è un carattere `Type0` con la
//! codifica `Identity-H`, il suo sotto-insieme TrueType incorporato
//! (`subsetter`) e la tabella `ToUnicode`, che rende il testo copiabile e
//! cercabile. Ogni lettera sta dove la vista l'ha messa: la prima con la
//! matrice del testo, le altre con gli spostamenti di `TJ` rispetto alla
//! larghezza del glifo, che assorbono crenatura e spaziatura del browser.
//!
//! Un carattere variabile si fissa prima nel punto dei suoi assi
//! ([`per_il_pdf::instance`], lo stesso dell'export dei disegni): il PDF non
//! sa scegliere un punto, e il browser l'ha già scelto.
//!
//! Vettori e immagini passano da `svg2pdf`, che li scrive come oggetti
//! `XObject`: i vettori restano vettori, un JPEG resta il suo JPEG.

use std::collections::{BTreeMap, HashMap};
use std::io::Write as _;

use base64::Engine as _;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use pdf_writer::types::{CidFontType, FontFlags, SystemInfo, UnicodeCmap};
use pdf_writer::{Chunk, Content, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};
use skrifa::instance::{LocationRef, Size};
use skrifa::raw::FontRef;
use skrifa::string::StringId;
use skrifa::MetadataProvider;
use subsetter::GlyphRemapper;
use svg2pdf::usvg;

use super::{
    Avviso, Colore, ElencoPagine, ErroreEsportazione, Pezzo, Risorse, Scritto, MAX_LATO_PAGINA,
    MAX_PAGINE, MAX_PEZZI_PAGINA, MAX_VETTORE_BYTE, VERSIONE,
};
use crate::draw::per_il_pdf;

/// Un pixel CSS in punti PDF.
const PUNTI_PER_PIXEL: f32 = 0.75;

/// Quanto un pezzo può stare fuori dalla pagina prima di dirsi rotto: un
/// testo che sborda di un po' è della vista, uno a un chilometro no.
const FUORI_PAGINA: f64 = 10_000.0;

/// Scrive il PDF di `elenco`, coi caratteri e le immagini di `risorse`.
pub fn scrivi(elenco: &ElencoPagine, risorse: &dyn Risorse) -> Result<Scritto, ErroreEsportazione> {
    valida(elenco)?;
    let mut scrittore = Scrittore::new(elenco, risorse);
    scrittore.scrivi()?;
    Ok(scrittore.fine())
}

fn valida(elenco: &ElencoPagine) -> Result<(), ErroreEsportazione> {
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
    let misura = |v: f64| v.is_finite() && v.abs() <= MAX_LATO_PAGINA + FUORI_PAGINA;
    let estensione = |v: f64| v.is_finite() && (0.0..=MAX_LATO_PAGINA + FUORI_PAGINA).contains(&v);
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

/// Un carattere del PDF: un file fissato in un punto, col suo sotto-insieme
/// che cresce man mano che le pagine lo usano.
struct Carattere {
    famiglia: String,
    /// Il carattere statico, già fissato.
    sfnt: Vec<u8>,
    upem: f32,
    /// I glifi usati, dai numeri del file a quelli del sotto-insieme.
    rimappa: GlyphRemapper,
    /// Per ogni glifo del sotto-insieme, il glifo del file e la prima lettera
    /// che l'ha chiesto (per `ToUnicode`).
    glifi: BTreeMap<u16, (u16, char)>,
    /// La larghezza di ogni glifo del file, in millesimi di corpo.
    larghezze: HashMap<u16, f32>,
    /// Le lettere che non ha, per l'avviso.
    mancanti: Vec<char>,
    nome: String,
    rif: Ref,
}

impl Carattere {
    fn new(famiglia: String, sfnt: Vec<u8>, indice: usize, rif: Ref) -> Option<Self> {
        let upem = FontRef::new(&sfnt)
            .ok()?
            .metrics(Size::unscaled(), LocationRef::default())
            .units_per_em as f32;
        let mut rimappa = GlyphRemapper::new();
        rimappa.remap(0);
        let mut glifi = BTreeMap::new();
        glifi.insert(0, (0, '\u{FFFD}'));
        Some(Self {
            famiglia,
            sfnt,
            upem: upem.max(1.0),
            rimappa,
            glifi,
            larghezze: HashMap::new(),
            mancanti: Vec::new(),
            nome: format!("F{indice}"),
            rif,
        })
    }

    fn glifo_di(&self, lettera: char) -> Option<u16> {
        let font = FontRef::new(&self.sfnt).ok()?;
        let gid = font.charmap().map(lettera)?.to_u32();
        u16::try_from(gid).ok().filter(|gid| *gid != 0)
    }

    /// Il glifo del sotto-insieme per un glifo del file, e la sua larghezza
    /// in millesimi di corpo.
    fn usa(&mut self, gid: u16, lettera: char) -> (u16, f32) {
        let nuovo = self.rimappa.remap(gid);
        self.glifi.entry(nuovo).or_insert((gid, lettera));
        let upem = self.upem;
        let sfnt = &self.sfnt;
        let larghezza = *self.larghezze.entry(gid).or_insert_with(|| {
            FontRef::new(sfnt)
                .ok()
                .and_then(|font| {
                    font.glyph_metrics(Size::unscaled(), LocationRef::default())
                        .advance_width(skrifa::GlyphId::new(gid.into()))
                })
                .map_or(0.0, |w| w / upem * 1000.0)
        });
        (nuovo, larghezza)
    }
}

/// Le chiavi di un carattere già caricato: lo stesso file nello stesso punto
/// è lo stesso carattere del PDF, qualunque faccia dell'elenco lo nomini.
type Chiave = (String, Vec<(String, i64)>);

struct Scrittore<'a> {
    elenco: &'a ElencoPagine,
    risorse: &'a dyn Risorse,
    pdf: Pdf,
    prossimo: i32,
    caratteri: Vec<Carattere>,
    /// Da faccia dell'elenco a carattere del PDF.
    facce: Vec<usize>,
    /// Literata, tondo e corsivo: il ripiego, caricato alla prima richiesta.
    ripiego: [Option<usize>; 2],
    /// Il ripiego di ogni faccia.
    corsivo: Vec<bool>,
    trasparenze: BTreeMap<u32, (String, Ref)>,
    avvisi: Vec<Avviso>,
    pagine: Vec<Ref>,
    albero: Ref,
}

impl<'a> Scrittore<'a> {
    fn new(elenco: &'a ElencoPagine, risorse: &'a dyn Risorse) -> Self {
        let mut s = Self {
            elenco,
            risorse,
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

    fn rif(&mut self) -> Ref {
        let r = Ref::new(self.prossimo);
        self.prossimo += 1;
        r
    }

    fn scrivi(&mut self) -> Result<(), ErroreEsportazione> {
        self.carica_facce();
        for indice in 0..self.elenco.pagine.len() {
            self.pagina(indice);
        }
        self.scrivi_caratteri()?;
        let catalogo = self.rif();
        self.pdf.catalog(catalogo).pages(self.albero);
        let conto = self.pagine.len() as i32;
        self.pdf
            .pages(self.albero)
            .kids(self.pagine.iter().copied())
            .count(conto);
        if !self.elenco.titolo.is_empty() {
            let info = self.rif();
            self.pdf
                .document_info(info)
                .title(TextStr(&self.elenco.titolo))
                .producer(TextStr("Fub"));
        }
        Ok(())
    }

    fn fine(self) -> Scritto {
        Scritto {
            pdf: self.pdf.finish(),
            avvisi: self.avvisi,
        }
    }

    /// Ogni faccia dell'elenco diventa un carattere del PDF: il suo file
    /// fissato nel suo punto, o Literata se il file manca, non si legge o
    /// non si può incorporare.
    fn carica_facce(&mut self) {
        let elenco = self.elenco;
        // Ogni file si legge una volta, e dice una volta che cosa non va.
        let mut file: HashMap<&str, Option<Vec<u8>>> = HashMap::new();
        let mut caricati: HashMap<Chiave, usize> = HashMap::new();
        for faccia in &elenco.facce {
            if !file.contains_key(faccia.file.as_str()) {
                let letto = self.leggi_file(&faccia.famiglia, &faccia.file);
                file.insert(&faccia.file, letto);
            }
            let Some(sfnt) = file[faccia.file.as_str()].as_deref() else {
                let c = self.ripiego(faccia.corsivo);
                self.facce.push(c);
                continue;
            };
            // Solo gli assi che il file ha: la vista manda `opsz` per ogni
            // testo, e un carattere statico resta uno solo a ogni corpo.
            let suoi: Vec<String> = FontRef::new(sfnt)
                .map(|f| f.axes().iter().map(|a| a.tag().to_string()).collect())
                .unwrap_or_default();
            let mut assi: Vec<(String, i64)> = faccia
                .assi
                .iter()
                .filter(|a| suoi.contains(&a.tag))
                .map(|a| (a.tag.clone(), (a.valore * 65536.0).round() as i64))
                .collect();
            assi.sort();
            let chiave = (faccia.file.clone(), assi);
            if let Some(&c) = caricati.get(&chiave) {
                self.facce.push(c);
                continue;
            }
            let punti: Vec<per_il_pdf::Coordinate> = faccia
                .assi
                .iter()
                .filter(|a| suoi.contains(&a.tag))
                .map(|a| per_il_pdf::Coordinate {
                    tag: a.tag.clone(),
                    value: a.valore,
                })
                .collect();
            let statico = match per_il_pdf::instance(sfnt, 0, &punti) {
                Ok(statico) => Some(statico),
                Err(errore) => {
                    self.avvisi.push(Avviso::CarattereIlleggibile {
                        famiglia: faccia.famiglia.clone(),
                        file: faccia.file.clone(),
                        motivo: errore.to_string(),
                    });
                    None
                }
            };
            let n = self.caratteri.len();
            let carattere = statico.and_then(|s| {
                let rif = Ref::new(self.prossimo);
                Carattere::new(faccia.famiglia.clone(), s, n, rif)
            });
            let c = match carattere {
                Some(carattere) => {
                    self.prossimo += 1;
                    self.caratteri.push(carattere);
                    n
                }
                None => self.ripiego(faccia.corsivo),
            };
            caricati.insert(chiave, c);
            self.facce.push(c);
        }
    }

    /// I byte decodificati del file di un carattere, se c'è, si legge e si
    /// può incorporare.
    fn leggi_file(&mut self, famiglia: &str, file: &str) -> Option<Vec<u8>> {
        let Some(byte) = self.risorse.carattere(file) else {
            self.avvisi.push(Avviso::CarattereMancante {
                famiglia: famiglia.into(),
                file: file.into(),
            });
            return None;
        };
        let sfnt = match per_il_pdf::decode(&byte) {
            Ok(sfnt) => sfnt.into_owned(),
            Err(errore) => {
                self.avvisi.push(Avviso::CarattereIlleggibile {
                    famiglia: famiglia.into(),
                    file: file.into(),
                    motivo: errore.to_string(),
                });
                return None;
            }
        };
        if !per_il_pdf::embeddable(&sfnt, 0) {
            self.avvisi.push(Avviso::CarattereNonIncorporabile {
                famiglia: famiglia.into(),
            });
            return None;
        }
        Some(sfnt)
    }

    /// Literata al 400, il carattere di Fub che si incorpora sempre.
    fn ripiego(&mut self, corsivo: bool) -> usize {
        let i = usize::from(corsivo);
        if let Some(c) = self.ripiego[i] {
            return c;
        }
        // Le facce di Fub, nell'ordine di `draw::facce`: Literata 400 è la
        // quinta, il suo corsivo la settima.
        let sfnt = crate::draw::facce()[if corsivo { 6 } else { 4 }].to_vec();
        let rif = self.rif();
        let n = self.caratteri.len();
        let c =
            Carattere::new("Literata".into(), sfnt, n, rif).expect("le facce di Fub si leggono");
        self.caratteri.push(c);
        self.ripiego[i] = Some(n);
        n
    }

    fn trasparenza(&mut self, alfa: f64) -> Option<String> {
        if alfa >= 0.999 {
            return None;
        }
        let chiave = (alfa * 1000.0).round() as u32;
        if let Some((nome, _)) = self.trasparenze.get(&chiave) {
            return Some(nome.clone());
        }
        let rif = self.rif();
        self.pdf
            .ext_graphics(rif)
            .non_stroking_alpha(chiave as f32 / 1000.0)
            .stroking_alpha(chiave as f32 / 1000.0);
        let nome = format!("G{}", self.trasparenze.len());
        self.trasparenze.insert(chiave, (nome.clone(), rif));
        Some(nome)
    }

    fn pagina(&mut self, indice: usize) {
        let elenco = self.elenco;
        let pagina = &elenco.pagine[indice];
        let alto = elenco.altezza as f32 * PUNTI_PER_PIXEL;
        let largo = elenco.larghezza as f32 * PUNTI_PER_PIXEL;
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
                    let alfa = self.trasparenza(colore[3]);
                    c.save_state();
                    if let Some(nome) = &alfa {
                        c.set_parameters(Name(nome.as_bytes()));
                        stati.insert(nome.clone(), self.trasparenze_rif(nome));
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
                    let alfa = self.trasparenza(colore[3]);
                    c.save_state();
                    if let Some(nome) = &alfa {
                        c.set_parameters(Name(nome.as_bytes()));
                        stati.insert(nome.clone(), self.trasparenze_rif(nome));
                    }
                    riempi(&mut c, colore);
                    c.rect(*x as f32, *y as f32, *w as f32, *h as f32);
                    c.fill_nonzero();
                    c.restore_state();
                }
                Pezzo::Vettore { x, y, w, h, svg } => {
                    if let Some(rif) = self.vettore(svg) {
                        let nome = format!("X{}", oggetti.len());
                        disegna_oggetto(&mut c, &nome, *x, *y, *w, *h);
                        oggetti.push((nome, rif));
                    }
                }
                Pezzo::Immagine { x, y, w, h, file } => {
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
        let rif = self.rif();
        let caratteri: Vec<(String, Ref)> = usati
            .keys()
            .map(|&i| (self.caratteri[i].nome.clone(), self.caratteri[i].rif))
            .collect();
        let mut p = self.pdf.page(rif);
        p.media_box(Rect::new(0.0, 0.0, largo, alto));
        p.parent(self.albero);
        p.contents(contenuto);
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
        self.pagine.push(rif);
    }

    fn trasparenze_rif(&self, nome: &str) -> Ref {
        self.trasparenze
            .values()
            .find(|(n, _)| n == nome)
            .map(|(_, r)| *r)
            .expect("lo stato è appena stato creato")
    }

    /// Un pezzo di testo: ogni lettera nel carattere della sua faccia, o in
    /// Literata se la faccia non la sa disegnare; ogni cambio di carattere
    /// riapre la riga nel punto della lettera.
    #[allow(clippy::too_many_arguments)]
    fn testo(
        &mut self,
        c: &mut Content,
        usati: &mut BTreeMap<usize, ()>,
        faccia: usize,
        x: f64,
        y: f64,
        corpo: f64,
        testo: &str,
        posizioni: &[f64],
    ) {
        let primo = self.facce[faccia];
        let lettere: Vec<char> = testo.chars().collect();
        // Il carattere e il glifo del file di ogni lettera.
        let mut scelte: Vec<(usize, u16)> = Vec::with_capacity(lettere.len());
        for &lettera in &lettere {
            if let Some(gid) = self.caratteri[primo].glifo_di(lettera) {
                scelte.push((primo, gid));
                continue;
            }
            let riserva = self.ripiego(self.corsivo[faccia]);
            match self.caratteri[riserva].glifo_di(lettera) {
                Some(gid) if !lettera.is_control() => scelte.push((riserva, gid)),
                _ => {
                    if !lettera.is_whitespace() && !lettera.is_control() {
                        self.caratteri[primo].mancanti.push(lettera);
                    }
                    scelte.push((primo, 0));
                }
            }
        }
        c.begin_text();
        let mut i = 0;
        while i < lettere.len() {
            let carattere = scelte[i].0;
            usati.insert(carattere, ());
            let nome = self.caratteri[carattere].nome.clone();
            c.set_font(Name(nome.as_bytes()), corpo as f32);
            let x0 = x + posizioni[i];
            c.set_text_matrix([1.0, 0.0, 0.0, -1.0, x0 as f32, y as f32]);
            let mut codici: Vec<u8> = Vec::new();
            let mut pezzi: Vec<(Vec<u8>, f32)> = Vec::new();
            let mut j = i;
            while j < lettere.len() && scelte[j].0 == carattere {
                let (nuovo, larghezza) = self.caratteri[carattere].usa(scelte[j].1, lettere[j]);
                codici.extend_from_slice(&nuovo.to_be_bytes());
                // Dove il glifo porterebbe la penna, e dove la vista mette
                // la lettera dopo: la differenza è uno spostamento di `TJ`.
                if j + 1 < lettere.len() {
                    let arriva = posizioni[j] + f64::from(larghezza) * corpo / 1000.0;
                    let scarto = posizioni[j + 1] - arriva;
                    let numero = (-scarto * 1000.0 / corpo) as f32;
                    if numero.abs() > 0.01 {
                        pezzi.push((std::mem::take(&mut codici), numero));
                    }
                }
                j += 1;
            }
            let mut tj = c.show_positioned();
            let mut voci = tj.items();
            for (codici, numero) in &pezzi {
                voci.show(Str(codici));
                voci.adjust(*numero);
            }
            if !codici.is_empty() {
                voci.show(Str(&codici));
            }
            drop(voci);
            drop(tj);
            i = j;
        }
        c.end_text();
    }

    /// La posizione sopra la linea di base e lo spessore del sottolineato
    /// (`sotto`) o del barrato, dalle misure del carattere, in pixel CSS.
    fn decorazione(&self, carattere: usize, sotto: bool, corpo: f64) -> (f64, f64) {
        let car = &self.caratteri[carattere];
        let misure = FontRef::new(&car.sfnt)
            .ok()
            .map(|f| f.metrics(Size::new(corpo as f32), LocationRef::default()));
        let linea = misure.and_then(|m| if sotto { m.underline } else { m.strikeout });
        match linea {
            Some(d) => {
                let spessore = f64::from(d.thickness).max(1.0);
                // Il CSS mette il bordo alto della linea alla sua posizione.
                (f64::from(d.offset), spessore)
            }
            None if sotto => (-corpo * 0.1, (corpo / 14.0).max(1.0)),
            None => (corpo * 0.3, (corpo / 14.0).max(1.0)),
        }
    }

    fn vettore(&mut self, svg: &str) -> Option<Ref> {
        let albero = match usvg::Tree::from_str(svg, &usvg::Options::default()) {
            Ok(albero) => albero,
            Err(errore) => {
                self.avvisi.push(Avviso::VettoreIlleggibile {
                    motivo: errore.to_string(),
                });
                return None;
            }
        };
        self.innesta(&albero)
    }

    fn immagine(&mut self, file: &str, w: f64, h: f64) -> Option<Ref> {
        let mancante = |s: &mut Self| {
            s.avvisi
                .push(Avviso::ImmagineMancante { file: file.into() });
            None
        };
        let Some(byte) = self.risorse.immagine(file) else {
            return mancante(self);
        };
        let Some(tipo) = tipo_immagine(&byte) else {
            return mancante(self);
        };
        // Un `<image>` in un SVG grande quanto il riquadro: `svg2pdf` tiene
        // il JPEG com'è e scrive il PNG con la sua trasparenza.
        let dati = base64::engine::general_purpose::STANDARD.encode(&byte);
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" \
             viewBox=\"0 0 {w} {h}\"><image width=\"{w}\" height=\"{h}\" \
             preserveAspectRatio=\"none\" href=\"data:{tipo};base64,{dati}\"/></svg>"
        );
        let albero = usvg::Tree::from_str(&svg, &usvg::Options::default()).ok()?;
        if !albero.root().has_children() {
            return mancante(self);
        }
        self.innesta(&albero)
    }

    /// Un albero di `usvg` come `XObject` del PDF, coi riferimenti rinumerati
    /// dopo quelli già scritti.
    fn innesta(&mut self, albero: &usvg::Tree) -> Option<Ref> {
        let (pezzo, rif) = match svg2pdf::to_chunk(albero, svg2pdf::ConversionOptions::default()) {
            Ok(fatto) => fatto,
            Err(errore) => {
                self.avvisi.push(Avviso::VettoreIlleggibile {
                    motivo: errore.to_string(),
                });
                return None;
            }
        };
        let mut mappa: HashMap<Ref, Ref> = HashMap::new();
        let mut prossimo = self.prossimo;
        let rinumerato: Chunk = pezzo.renumber(|vecchio| {
            *mappa.entry(vecchio).or_insert_with(|| {
                let r = Ref::new(prossimo);
                prossimo += 1;
                r
            })
        });
        self.prossimo = prossimo;
        self.pdf.extend(&rinumerato);
        mappa.get(&rif).copied()
    }

    /// I caratteri usati: ognuno col suo sotto-insieme, le larghezze dei
    /// glifi e la tabella `ToUnicode`.
    fn scrivi_caratteri(&mut self) -> Result<(), ErroreEsportazione> {
        let caratteri = std::mem::take(&mut self.caratteri);
        for (n, car) in caratteri.iter().enumerate() {
            if !car.mancanti.is_empty() {
                let mut lettere: Vec<char> = car.mancanti.clone();
                lettere.sort_unstable();
                lettere.dedup();
                self.avvisi.push(Avviso::LettereMancanti {
                    famiglia: car.famiglia.clone(),
                    lettere: lettere.into_iter().collect(),
                });
            }
            let sotto = subsetter::subset(&car.sfnt, 0, &car.rimappa).map_err(|errore| {
                ErroreEsportazione::SottoInsieme {
                    famiglia: car.famiglia.clone(),
                    motivo: errore.to_string(),
                }
            })?;
            let font = FontRef::new(&car.sfnt).map_err(|e| ErroreEsportazione::SottoInsieme {
                famiglia: car.famiglia.clone(),
                motivo: e.to_string(),
            })?;
            let m = font.metrics(Size::unscaled(), LocationRef::default());
            let scala = 1000.0 / car.upem;
            let ps = font
                .localized_strings(StringId::POSTSCRIPT_NAME)
                .english_or_first()
                .map(|s| s.to_string())
                .unwrap_or_else(|| car.famiglia.clone());
            let ps: String = ps
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
            let base = format!("{}+{ps}", etichetta(n));

            let cid = self.rif();
            let descrittore = self.rif();
            let file = self.rif();
            let mappa = self.rif();

            let mut tipo0 = self.pdf.type0_font(car.rif);
            tipo0.base_font(Name(base.as_bytes()));
            tipo0.encoding_predefined(Name(b"Identity-H"));
            tipo0.descendant_font(cid);
            tipo0.to_unicode(mappa);
            tipo0.finish();

            let mut cf = self.pdf.cid_font(cid);
            cf.subtype(CidFontType::Type2);
            cf.base_font(Name(base.as_bytes()));
            cf.system_info(SystemInfo {
                registry: Str(b"Adobe"),
                ordering: Str(b"Identity"),
                supplement: 0,
            });
            cf.font_descriptor(descrittore);
            cf.default_width(0.0);
            cf.cid_to_gid_map_predefined(Name(b"Identity"));
            {
                let mut w = cf.widths();
                for (&nuovo, &(vecchio, _)) in &car.glifi {
                    let larghezza = car.larghezze.get(&vecchio).copied().unwrap_or(0.0);
                    w.consecutive(nuovo, [larghezza]);
                }
            }
            cf.finish();

            let mut flags = FontFlags::NON_SYMBOLIC;
            if m.italic_angle != 0.0 {
                flags |= FontFlags::ITALIC;
            }
            if m.is_monospace {
                flags |= FontFlags::FIXED_PITCH;
            }
            let bbox = m.bounds.map_or(
                Rect::new(0.0, m.descent * scala, 1000.0, m.ascent * scala),
                |b| {
                    Rect::new(
                        b.x_min * scala,
                        b.y_min * scala,
                        b.x_max * scala,
                        b.y_max * scala,
                    )
                },
            );
            self.pdf
                .font_descriptor(descrittore)
                .name(Name(base.as_bytes()))
                .flags(flags)
                .bbox(bbox)
                .italic_angle(m.italic_angle)
                .ascent(m.ascent * scala)
                .descent(m.descent * scala)
                .cap_height(m.cap_height.unwrap_or(m.ascent) * scala)
                .stem_v(80.0)
                .font_file2(file);

            let compresso = comprimi(&sotto);
            self.pdf
                .stream(file, &compresso)
                .filter(Filter::FlateDecode)
                .pair(Name(b"Length1"), sotto.len() as i32);

            let info = SystemInfo {
                registry: Str(b"Adobe"),
                ordering: Str(b"UCS"),
                supplement: 0,
            };
            let mut cmap = UnicodeCmap::new(Name(b"Adobe-Identity-UCS"), info);
            for (&nuovo, &(_, lettera)) in &car.glifi {
                if nuovo != 0 {
                    cmap.pair(nuovo, lettera);
                }
            }
            let cmap = cmap.finish();
            self.pdf.cmap(mappa, &cmap);
        }
        self.caratteri = caratteri;
        Ok(())
    }
}

/// Il nome del sotto-insieme: sei maiuscole, diverse per ogni carattere.
fn etichetta(mut n: usize) -> String {
    let mut out = [b'A'; 6];
    for slot in out.iter_mut().rev() {
        *slot = b'A' + (n % 26) as u8;
        n /= 26;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn riempi(c: &mut Content, colore: &Colore) {
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

fn comprimi(dati: &[u8]) -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
    e.write_all(dati)
        .expect("scrivere in un vettore non fallisce");
    e.finish().expect("scrivere in un vettore non fallisce")
}

/// Il tipo di un'immagine dai suoi primi byte: solo quelli che `usvg` sa
/// leggere.
fn tipo_immagine(byte: &[u8]) -> Option<&'static str> {
    if byte.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if byte.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if byte.starts_with(b"GIF8") {
        Some("image/gif")
    } else if byte.len() > 12 && &byte[..4] == b"RIFF" && &byte[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}
