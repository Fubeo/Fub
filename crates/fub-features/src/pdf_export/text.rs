//! Il testo del PDF: testo vero, che si seleziona e si cerca.
//!
//! Ogni faccia è un carattere `Type0` con la codifica `Identity-H`, il suo
//! sotto-insieme TrueType incorporato (`subsetter`) e la tabella
//! `ToUnicode`, che rende il testo copiabile e cercabile. Ogni lettera sta
//! dove la vista l'ha messa: la prima con la matrice del testo, le altre con
//! gli spostamenti di `TJ` rispetto alla larghezza del glifo, che assorbono
//! crenatura e spaziatura del browser.
//!
//! Un carattere variabile si fissa prima nel punto dei suoi assi
//! ([`per_il_pdf::instance`], lo stesso dell'export dei disegni): il PDF non
//! sa scegliere un punto, e il browser l'ha già scelto. Una lettera che la
//! faccia non ha passa a Literata; una che nemmeno Literata ha resta il
//! glifo vuoto, con l'avviso [`Avviso::LettereMancanti`].

use std::collections::{BTreeMap, HashMap};

use pdf_writer::types::{CidFontType, FontFlags, SystemInfo, UnicodeCmap};
use pdf_writer::{Content, Filter, Finish, Name, Rect, Ref, Str};
use skrifa::instance::{LocationRef, Size};
use skrifa::raw::FontRef;
use skrifa::string::StringId;
use skrifa::MetadataProvider;
use subsetter::GlyphRemapper;

use super::writer::{comprimi, Scrittore};
use super::{Avviso, ErroreEsportazione};
use crate::draw::per_il_pdf;

/// Un carattere del PDF: un file fissato in un punto, col suo sotto-insieme
/// che cresce man mano che le pagine lo usano.
pub(super) struct Carattere {
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
    pub(super) nome: String,
    pub(super) rif: Ref,
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

impl Scrittore<'_> {
    /// Ogni faccia dell'elenco diventa un carattere del PDF: il suo file
    /// fissato nel suo punto, o Literata se il file manca, non si legge o
    /// non si può incorporare.
    pub(super) fn carica_facce(&mut self) {
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

    /// Un pezzo di testo: ogni lettera nel carattere della sua faccia, o in
    /// Literata se la faccia non la sa disegnare; ogni cambio di carattere
    /// riapre la riga nel punto della lettera.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn testo(
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
    pub(super) fn decorazione(&self, carattere: usize, sotto: bool, corpo: f64) -> (f64, f64) {
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

    /// glifi e la tabella `ToUnicode`.
    pub(super) fn scrivi_caratteri(&mut self) -> Result<(), ErroreEsportazione> {
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
