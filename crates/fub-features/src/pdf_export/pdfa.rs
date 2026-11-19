//! Il PDF/A: il PDF per l'archivio (ISO 19005-2, livello B).
//!
//! Un PDF/A si legge uguale fra trent'anni perché porta dentro tutto ciò che
//! serve a disegnarlo e non dipende da niente fuori. Lo scrittore lo è già in
//! gran parte (i caratteri incorporati, nessuna data, nessun JavaScript, nessun
//! file allegato, nessuna cifratura); qui sta ciò che il PDF/A aggiunge:
//!
//! - il profilo di colore: un `OutputIntent` col profilo sRGB, scritto da Fub
//!   (ICC versione 2, nessun file di terzi), perché i colori della vista sono
//!   sRGB;
//! - i metadati XMP, con gli stessi titolo e autore del dizionario `Info` e
//!   l'identificazione `pdfaid` (parte 2, livello B);
//! - l'identificativo del file nel trailer, dall'impronta dell'elenco: lo
//!   stesso elenco dà sempre gli stessi byte;
//! - le annotazioni dei collegamenti stampabili.
//!
//! Ciò che il PDF/A non permette lo dice prima che il file si scriva: una
//! lettera che nessun carattere sa disegnare (il PDF/A non ammette il glifo
//! vuoto) e un disegno che `svg2pdf` non sa scrivere in PDF/A diventano
//! [`OstacoloPdfa`], e la scrittura si ferma con
//! [`ErroreEsportazione::PdfaNonPossibile`] senza un PDF a metà.
//!
//! I metadati XMP si scrivono anche nel PDF accessibile, che il titolo lo
//! vuole lì (PDF/UA).

use pdf_writer::types::OutputIntentSubtype;
use pdf_writer::writers::Catalog;
use pdf_writer::{Filter, Finish, Ref, TextStr};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::writer::{comprimi, etichetta_di_lingua, Scrittore};
use super::{ElencoPagine, ErroreEsportazione};

/// Il nome della condizione di stampa del profilo, come lo registra l'ICC.
const SRGB: &str = "sRGB IEC61966-2.1";

/// Ciò che impedisce di scrivere un PDF/A, detto per nome.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "ostacolo", rename_all = "snake_case")]
pub enum OstacoloPdfa {
    /// Lettere che né il carattere né Literata sanno disegnare: uscirebbero
    /// col glifo vuoto, che il PDF/A non ammette.
    LettereSenzaGlifo { famiglia: String, lettere: String },
    /// Un vettore che `svg2pdf` non sa scrivere in PDF/A (una sua scritta usa
    /// una lettera che i caratteri di Fub non hanno): `pagina` dalla prima,
    /// che è la 1.
    VettoreNonConforme { pagina: usize, motivo: String },
}

impl Scrittore<'_> {
    /// Dopo le pagine e prima del resto: se il PDF/A ha incontrato qualcosa
    /// che non permette, la scrittura si ferma e lo dice.
    pub(super) fn controlla_pdfa(&mut self) -> Result<(), ErroreEsportazione> {
        if !self.opzioni.pdfa {
            return Ok(());
        }
        let mut ostacoli: Vec<OstacoloPdfa> = self
            .caratteri
            .iter()
            .filter_map(|c| c.lettere_senza_glifo())
            .map(|(famiglia, lettere)| OstacoloPdfa::LettereSenzaGlifo { famiglia, lettere })
            .collect();
        ostacoli.append(&mut self.ostacoli);
        if ostacoli.is_empty() {
            Ok(())
        } else {
            Err(ErroreEsportazione::PdfaNonPossibile { ostacoli })
        }
    }

    /// Un vettore che `svg2pdf` non ha scritto in PDF/A: un ostacolo.
    pub(super) fn ostacolo_vettore(&mut self, motivo: String) {
        self.ostacoli.push(OstacoloPdfa::VettoreNonConforme {
            pagina: self.pagina_in_corso + 1,
            motivo,
        });
    }

    /// Il titolo come lo scrive il PDF: nel PDF/A uguale a quello dei
    /// metadati, quindi senza i caratteri che l'XML non ammette.
    pub(super) fn titolo_del_pdf(&self) -> String {
        dato(&self.elenco.titolo, self.opzioni.pdfa)
    }

    /// L'autore come lo scrive il PDF, con la stessa regola del titolo.
    pub(super) fn autore_del_pdf(&self) -> String {
        dato(&self.elenco.autore, self.opzioni.pdfa)
    }

    /// Mette nel catalogo i metadati XMP (PDF/A e PDF accessibile) e il
    /// profilo di colore (PDF/A). I flussi si scrivono prima, il catalogo
    /// dopo li nomina: per questo i riferimenti tornano a chi scrive il
    /// catalogo.
    pub(super) fn prepara_metadati(&mut self) -> (Option<Ref>, Option<Ref>) {
        let pdfa = self.opzioni.pdfa;
        if !pdfa && !self.con_i_tag() {
            return (None, None);
        }
        let lingua = self.elenco.lingua.trim();
        let lingua = etichetta_di_lingua(lingua).then_some(lingua);
        let xmp = xmp(&self.titolo_del_pdf(), &self.autore_del_pdf(), lingua, pdfa);
        let metadati = self.rif();
        // Il flusso dei metadati resta in chiaro: chi archivia lo legge
        // senza decomprimere.
        self.pdf.metadata(metadati, xmp.as_bytes());
        let profilo = pdfa.then(|| {
            let rif = self.rif();
            let compresso = comprimi(&profilo_srgb());
            self.pdf
                .icc_profile(rif, &compresso)
                .n(3)
                .filter(Filter::FlateDecode);
            rif
        });
        (Some(metadati), profilo)
    }

    /// L'identificativo del file, nel PDF/A: due volte l'impronta dell'elenco.
    pub(super) fn identifica(&mut self) {
        if self.opzioni.pdfa {
            let id = impronta(self.elenco);
            self.pdf.set_file_id((id.clone(), id));
        }
    }
}

/// Nel catalogo: i metadati e l'`OutputIntent` del PDF/A.
pub(super) fn nel_catalogo(cat: &mut Catalog, metadati: Option<Ref>, profilo: Option<Ref>) {
    if let Some(metadati) = metadati {
        cat.metadata(metadati);
    }
    if let Some(profilo) = profilo {
        let mut intenti = cat.output_intents();
        intenti
            .push()
            .subtype(OutputIntentSubtype::PDFA)
            .output_condition_identifier(TextStr(SRGB))
            .registry_name(TextStr("http://www.color.org"))
            .info(TextStr(SRGB))
            .dest_output_profile(profilo);
        intenti.finish();
    }
}

/// Un testo dei dati del PDF: nel PDF/A senza i caratteri di controllo, che
/// l'XML dei metadati non sa scrivere e che farebbero due titoli diversi.
fn dato(testo: &str, pdfa: bool) -> String {
    if pdfa {
        testo.chars().filter(|c| ammesso_in_xml(*c)).collect()
    } else {
        testo.to_owned()
    }
}

fn ammesso_in_xml(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r')
        || matches!(c, '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..)
}

/// I primi 16 byte dello SHA-256 dell'elenco: lo stesso elenco, lo stesso id.
pub(super) fn impronta(elenco: &ElencoPagine) -> Vec<u8> {
    let json = serde_json::to_vec(elenco).unwrap_or_default();
    Sha256::digest(&json)[..16].to_vec()
}

/// Un testo dentro l'XML: niente che l'XML non ammetta, e i cinque caratteri
/// che interpreta resi con la tabella unica di `fub_abi::html` (le sue entità
/// valgono anche in XML).
fn xml(testo: &str) -> String {
    let pulito: String = testo.chars().filter(|c| ammesso_in_xml(*c)).collect();
    fub_abi::html::escape(&pulito)
}

/// I metadati XMP: titolo, autore e lingua come nel dizionario `Info`, chi
/// l'ha scritto e, nel PDF/A, la sua identificazione. Nessuna data, come nel
/// resto del PDF.
pub(super) fn xmp(titolo: &str, autore: &str, lingua: Option<&str>, pdfa: bool) -> String {
    let mut x = String::new();
    x.push_str("<?xpacket begin=\"\u{FEFF}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n");
    x.push_str("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n");
    x.push_str("<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n");
    x.push_str(
        "<rdf:Description rdf:about=\"\" \
         xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
         xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\" \
         xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"",
    );
    if pdfa {
        x.push_str(" xmlns:pdfaid=\"http://www.aiim.org/pdfa/ns/id/\"");
    }
    x.push_str(">\n");
    x.push_str("<dc:format>application/pdf</dc:format>\n");
    if !titolo.is_empty() {
        x.push_str(&format!(
            "<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">{}</rdf:li></rdf:Alt></dc:title>\n",
            xml(titolo)
        ));
    }
    if !autore.is_empty() {
        x.push_str(&format!(
            "<dc:creator><rdf:Seq><rdf:li>{}</rdf:li></rdf:Seq></dc:creator>\n",
            xml(autore)
        ));
    }
    if let Some(lingua) = lingua {
        x.push_str(&format!(
            "<dc:language><rdf:Bag><rdf:li>{}</rdf:li></rdf:Bag></dc:language>\n",
            xml(lingua)
        ));
    }
    x.push_str("<pdf:Producer>Fub</pdf:Producer>\n");
    x.push_str("<xmp:CreatorTool>Fub</xmp:CreatorTool>\n");
    if pdfa {
        x.push_str("<pdfaid:part>2</pdfaid:part>\n");
        x.push_str("<pdfaid:conformance>B</pdfaid:conformance>\n");
    }
    x.push_str("</rdf:Description>\n</rdf:RDF>\n</x:xmpmeta>\n");
    // Lo spazio che lascia correggere i metadati sul posto, come vuole XMP.
    for _ in 0..20 {
        x.push_str(&" ".repeat(99));
        x.push('\n');
    }
    x.push_str("<?xpacket end=\"w\"?>");
    x
}

/// Il bianco del D50, l'illuminante dello spazio di connessione dell'ICC.
const D50: [f64; 3] = [0.9642, 1.0, 0.8249];

/// Il bianco del D65, quello dello sRGB.
const D65: [f64; 3] = [0.9505, 1.0, 1.0890];

/// I primari dello sRGB adattati al D50 (Bradford), come nel profilo
/// dell'IEC 61966-2.1.
const PRIMARI: [[f64; 3]; 3] = [
    [0.4361, 0.2225, 0.0139],
    [0.3851, 0.7169, 0.0971],
    [0.1431, 0.0606, 0.7141],
];

/// Quanti punti ha la curva di ogni canale.
const PUNTI_CURVA: usize = 1024;

/// Il profilo sRGB, ICC versione 2.1, profilo di schermo a matrice e curve:
/// `desc`, `cprt`, `wtpt`, i tre primari e la stessa curva per i tre canali.
/// Lo scrive Fub, sempre uguale: nessun file di terzi nel binario.
pub(super) fn profilo_srgb() -> Vec<u8> {
    fn u32be(v: &mut Vec<u8>, n: u32) {
        v.extend_from_slice(&n.to_be_bytes());
    }
    fn s15f16(v: &mut Vec<u8>, x: f64) {
        u32be(v, ((x * 65536.0).round() as i32) as u32);
    }
    fn xyz(valori: [f64; 3]) -> Vec<u8> {
        let mut v = b"XYZ \0\0\0\0".to_vec();
        for x in valori {
            s15f16(&mut v, x);
        }
        v
    }
    fn allinea(v: &mut Vec<u8>) {
        while !v.len().is_multiple_of(4) {
            v.push(0);
        }
    }
    // `textDescriptionType` della versione 2: l'ASCII con lo zero in fondo,
    // poi Unicode e ScriptCode vuoti.
    let mut desc = b"desc\0\0\0\0".to_vec();
    u32be(&mut desc, SRGB.len() as u32 + 1);
    desc.extend_from_slice(SRGB.as_bytes());
    desc.push(0);
    u32be(&mut desc, 0);
    u32be(&mut desc, 0);
    desc.extend_from_slice(&[0, 0, 0]);
    desc.extend_from_slice(&[0; 67]);
    let mut cprt = b"text\0\0\0\0".to_vec();
    cprt.extend_from_slice(b"No copyright, use freely");
    cprt.push(0);
    let mut curva = b"curv\0\0\0\0".to_vec();
    u32be(&mut curva, PUNTI_CURVA as u32);
    for i in 0..PUNTI_CURVA {
        let x = i as f64 / (PUNTI_CURVA - 1) as f64;
        let y = if x <= 0.04045 {
            x / 12.92
        } else {
            ((x + 0.055) / 1.055).powf(2.4)
        };
        curva.extend_from_slice(&((y * 65535.0).round() as u16).to_be_bytes());
    }

    // Le firme e i dati: le tre curve puntano agli stessi byte.
    let dati: Vec<(&[u8; 4], Vec<u8>)> = vec![
        (b"desc", desc),
        (b"cprt", cprt),
        (b"wtpt", xyz(D65)),
        (b"rXYZ", xyz(PRIMARI[0])),
        (b"gXYZ", xyz(PRIMARI[1])),
        (b"bXYZ", xyz(PRIMARI[2])),
        (b"rTRC", curva),
    ];
    let condivisi: [&[u8; 4]; 2] = [b"gTRC", b"bTRC"];
    let voci = dati.len() + condivisi.len();
    let inizio = 128 + 4 + 12 * voci;
    let mut corpo: Vec<u8> = Vec::new();
    let mut tabella: Vec<u8> = Vec::new();
    u32be(&mut tabella, voci as u32);
    let mut curva_a = (0, 0);
    for (firma, byte) in &dati {
        let dove = inizio + corpo.len();
        tabella.extend_from_slice(*firma);
        u32be(&mut tabella, dove as u32);
        u32be(&mut tabella, byte.len() as u32);
        if *firma == b"rTRC" {
            curva_a = (dove, byte.len());
        }
        corpo.extend_from_slice(byte);
        allinea(&mut corpo);
    }
    for firma in condivisi {
        tabella.extend_from_slice(firma);
        u32be(&mut tabella, curva_a.0 as u32);
        u32be(&mut tabella, curva_a.1 as u32);
    }
    let totale = 128 + tabella.len() + corpo.len();

    let mut p: Vec<u8> = Vec::with_capacity(totale);
    u32be(&mut p, totale as u32);
    p.extend_from_slice(&[0; 4]); // il CMM preferito: nessuno
    u32be(&mut p, 0x0210_0000); // la versione 2.1
    p.extend_from_slice(b"mntr");
    p.extend_from_slice(b"RGB ");
    p.extend_from_slice(b"XYZ ");
    // La data è fissa: lo stesso profilo dà sempre gli stessi byte.
    for n in [2026u16, 1, 1, 0, 0, 0] {
        p.extend_from_slice(&n.to_be_bytes());
    }
    p.extend_from_slice(b"acsp");
    p.extend_from_slice(&[0; 4]); // la piattaforma
    p.extend_from_slice(&[0; 4]); // i flag
    p.extend_from_slice(&[0; 4]); // il produttore
    p.extend_from_slice(&[0; 4]); // il modello
    p.extend_from_slice(&[0; 8]); // gli attributi
    u32be(&mut p, 0); // l'intento: percettivo
    for x in D50 {
        s15f16(&mut p, x);
    }
    p.extend_from_slice(&[0; 4]); // chi l'ha creato
    p.extend_from_slice(&[0; 44]); // l'id e il riservato
    debug_assert_eq!(p.len(), 128);
    p.extend_from_slice(&tabella);
    p.extend_from_slice(&corpo);
    p
}
