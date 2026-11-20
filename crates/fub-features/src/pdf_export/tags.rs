//! I tag del PDF accessibile: la struttura della nota dentro il PDF.
//!
//! La vista sa che cosa ha disegnato: un titolo, un paragrafo, una voce di un
//! elenco, una cella d'intestazione, una figura. Lo dice nell'elenco delle
//! pagine con la [`struttura`](super::ElencoPagine::struttura), un albero di
//! [`Nodo`] scritti nell'ordine in cui si leggono, e ogni pezzo nomina il nodo
//! a cui appartiene. Il core ne fa la struttura logica del PDF (PDF 1.7,
//! §14.7 e §14.8): ogni pezzo con un nodo diventa una sequenza marcata col suo
//! `MCID`, ogni pezzo senza nodo (le testate, i fondi, i bordi, le linee) un
//! artefatto, che chi legge con un lettore di schermo salta.
//!
//! L'ordine di lettura è quello dei nodi: i figli di un nodo si leggono
//! nell'ordine in cui la vista li ha scritti, e il contenuto di un nodo (il
//! testo di un paragrafo prima e dopo un collegamento) nell'ordine in cui la
//! pagina lo disegna. Una figura e una formula portano il loro testo
//! alternativo (`Alt`), una cella d'intestazione il suo ambito (`Scope`), un
//! elenco se è numerato (`ListNumbering`), un nodo la sua lingua (`Lang`) se
//! è diversa da quella del documento.
//!
//! Ciò che manca non ferma la scrittura: una figura senza testo alternativo e
//! una tabella senza intestazione escono così come sono, con un avviso.

use std::collections::BTreeMap;

use pdf_writer::types::{ListNumbering, StructRole, TabOrder, TableHeaderScope};
use pdf_writer::writers::{Catalog, StructTreeRoot};
use pdf_writer::{Content, Finish, Name, Ref, TextStr};
use serde::{Deserialize, Serialize};

use super::writer::{etichetta_di_lingua, Scrittore};
use super::{
    Avviso, Destinazione, ElencoPagine, ErroreEsportazione, Pezzo, MAX_NODI, MAX_TESTO_ALTERNATIVO,
    MAX_TESTO_DATI,
};

/// Un nodo della struttura: una cosa della nota, con la sua specie.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Nodo {
    pub specie: Specie,
    /// Il nodo che lo contiene, che viene prima nell'elenco; senza, il nodo
    /// sta sotto il documento.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genitore: Option<usize>,
    /// Il livello di un [`Specie::Titolo`], da 1 a 6: solo per i titoli.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub livello: Option<u8>,
    /// Il testo alternativo: ciò che un lettore di schermo legge al posto di
    /// una figura, di una formula o di un diagramma.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub alt: String,
    /// La lingua del nodo, come etichetta BCP 47, quando non è quella del
    /// documento (una citazione in inglese in una nota in italiano).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub lingua: String,
    /// Che cosa intesta una [`Specie::Intestazione`]: di serie la colonna.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ambito: Option<Ambito>,
    /// Se un [`Specie::Elenco`] è numerato: di serie no.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub numerato: Option<bool>,
}

/// La specie di un nodo, cioè il tag del PDF che diventa.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Specie {
    /// Una sezione (`Sect`).
    Sezione,
    /// Un titolo (`H1`…`H6`, dal [`Nodo::livello`]).
    Titolo,
    /// Un paragrafo (`P`).
    Paragrafo,
    /// Una citazione (`BlockQuote`).
    Citazione,
    /// Un blocco di codice (`Code`).
    Codice,
    /// Un elenco (`L`).
    Elenco,
    /// Una voce di un elenco (`LI`).
    Voce,
    /// Il segno o il numero di una voce (`Lbl`).
    Etichetta,
    /// Il testo di una voce (`LBody`).
    CorpoVoce,
    /// Una tabella (`Table`).
    Tabella,
    /// Le righe d'intestazione di una tabella (`THead`).
    TestataTabella,
    /// Le righe del corpo di una tabella (`TBody`).
    CorpoTabella,
    /// Le righe in fondo a una tabella (`TFoot`).
    PiedeTabella,
    /// Una riga di una tabella (`TR`).
    Riga,
    /// Una cella d'intestazione (`TH`).
    Intestazione,
    /// Una cella (`TD`).
    Cella,
    /// Una figura: un'immagine, un diagramma, una scheda (`Figure`).
    Figura,
    /// Una formula (`Formula`).
    Formula,
    /// La didascalia di una figura o di una tabella (`Caption`).
    Didascalia,
    /// Un collegamento (`Link`): il suo testo e il riquadro che si clicca.
    Collegamento,
    /// Una nota a piè di pagina (`Note`).
    Nota,
    /// Un pezzo di testo dentro un altro, con una lingua sua (`Span`).
    Testo,
    /// L'indice (`TOC`).
    Indice,
    /// Una voce dell'indice (`TOCI`).
    VoceIndice,
}

/// Che cosa intesta una cella d'intestazione.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ambito {
    Colonna,
    Riga,
    Entrambi,
}

/// Il ruolo del PDF di un nodo, e il nome con cui la sua sequenza marcata si
/// apre nella pagina.
fn ruolo(nodo: &Nodo) -> (StructRole, &'static [u8]) {
    match nodo.specie {
        Specie::Sezione => (StructRole::Sect, b"Sect"),
        Specie::Titolo => match nodo.livello.unwrap_or(1) {
            1 => (StructRole::H1, b"H1"),
            2 => (StructRole::H2, b"H2"),
            3 => (StructRole::H3, b"H3"),
            4 => (StructRole::H4, b"H4"),
            5 => (StructRole::H5, b"H5"),
            _ => (StructRole::H6, b"H6"),
        },
        Specie::Paragrafo => (StructRole::P, b"P"),
        Specie::Citazione => (StructRole::BlockQuote, b"BlockQuote"),
        Specie::Codice => (StructRole::Code, b"Code"),
        Specie::Elenco => (StructRole::L, b"L"),
        Specie::Voce => (StructRole::LI, b"LI"),
        Specie::Etichetta => (StructRole::Lbl, b"Lbl"),
        Specie::CorpoVoce => (StructRole::LBody, b"LBody"),
        Specie::Tabella => (StructRole::Table, b"Table"),
        Specie::TestataTabella => (StructRole::THead, b"THead"),
        Specie::CorpoTabella => (StructRole::TBody, b"TBody"),
        Specie::PiedeTabella => (StructRole::TFoot, b"TFoot"),
        Specie::Riga => (StructRole::TR, b"TR"),
        Specie::Intestazione => (StructRole::TH, b"TH"),
        Specie::Cella => (StructRole::TD, b"TD"),
        Specie::Figura => (StructRole::Figure, b"Figure"),
        Specie::Formula => (StructRole::Formula, b"Formula"),
        Specie::Didascalia => (StructRole::Caption, b"Caption"),
        Specie::Collegamento => (StructRole::Link, b"Link"),
        Specie::Nota => (StructRole::Note, b"Note"),
        Specie::Testo => (StructRole::Span, b"Span"),
        Specie::Indice => (StructRole::TOC, b"TOC"),
        Specie::VoceIndice => (StructRole::TOCI, b"TOCI"),
    }
}

/// Il nodo che un pezzo nomina, se ne nomina uno.
pub(super) fn nodo_del_pezzo(pezzo: &Pezzo) -> Option<usize> {
    match pezzo {
        Pezzo::Testo { nodo, .. } | Pezzo::Vettore { nodo, .. } | Pezzo::Immagine { nodo, .. } => {
            *nodo
        }
        Pezzo::Riquadro { .. } => None,
    }
}

/// Controlla la struttura dell'elenco: i nodi stanno dentro un genitore che
/// viene prima (quindi è un albero, senza giri), i campi valgono per la loro
/// specie, e ogni pezzo e ogni collegamento nomina un nodo che c'è.
pub(super) fn valida(elenco: &ElencoPagine) -> Result<(), ErroreEsportazione> {
    let nodi = &elenco.struttura;
    if nodi.len() > MAX_NODI {
        return Err(ErroreEsportazione::TroppiNodi { nodi: nodi.len() });
    }
    for (i, nodo) in nodi.iter().enumerate() {
        let rotto = || ErroreEsportazione::NodoRotto { nodo: i };
        if nodo.genitore.is_some_and(|g| g >= i) {
            return Err(rotto());
        }
        let titolo = nodo.specie == Specie::Titolo;
        match nodo.livello {
            Some(livello) if !titolo || !(1..=6).contains(&livello) => return Err(rotto()),
            None if titolo => return Err(rotto()),
            _ => {}
        }
        if (nodo.ambito.is_some() && nodo.specie != Specie::Intestazione)
            || (nodo.numerato.is_some() && nodo.specie != Specie::Elenco)
            || nodo.alt.chars().count() > MAX_TESTO_ALTERNATIVO
            || nodo.lingua.chars().count() > MAX_TESTO_DATI
        {
            return Err(rotto());
        }
    }
    for (pagina, p) in elenco.pagine.iter().enumerate() {
        let pagina = pagina + 1;
        for (pezzo, item) in p.pezzi.iter().enumerate() {
            if nodo_del_pezzo(item).is_some_and(|n| n >= nodi.len()) {
                return Err(ErroreEsportazione::NodoSconosciuto { pagina, pezzo });
            }
        }
        for (collegamento, c) in p.collegamenti.iter().enumerate() {
            let Some(n) = c.nodo else { continue };
            if nodi
                .get(n)
                .is_none_or(|nodo| nodo.specie != Specie::Collegamento)
            {
                return Err(ErroreEsportazione::CollegamentoRotto {
                    pagina,
                    collegamento,
                });
            }
        }
    }
    Ok(())
}

/// Un contenuto di un nodo, nell'ordine in cui la pagina lo disegna.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Contenuto {
    /// Una sequenza marcata: la pagina e il suo `MCID`.
    Sequenza { pagina: usize, mcid: i32 },
    /// L'annotazione di un collegamento.
    Annotazione { pagina: usize, rif: Ref },
}

/// Ciò che la scrittura delle pagine raccoglie per scrivere poi la struttura.
#[derive(Default)]
pub(super) struct Marcatura {
    attiva: bool,
    /// Un contatore che cresce a ogni contenuto: dice che cosa viene prima.
    passo: u64,
    /// Per ogni nodo, i suoi contenuti col loro passo.
    contenuti: Vec<Vec<(u64, Contenuto)>>,
    /// Per ogni pagina, il nodo di ogni `MCID`: la sua voce nel `ParentTree`.
    sequenze: Vec<Vec<usize>>,
    /// Il nodo di ogni annotazione marcata, nell'ordine delle chiavi.
    annotazioni: Vec<usize>,
    /// Le pagine che hanno annotazioni marcate.
    pagine_con_annotazioni: Vec<bool>,
    /// Il testo dentro ogni nodo `collegamento`, nell'ordine dell'elenco: ciò
    /// che il collegamento dice quando non ha un testo alternativo.
    testi_collegamento: BTreeMap<usize, String>,
}

impl Marcatura {
    /// La chiave della prima annotazione nel `ParentTree`: prima vengono le
    /// pagine, una chiave ciascuna.
    fn chiave_annotazione(&self, j: usize) -> i32 {
        (self.sequenze.len() + j) as i32
    }
}

/// Il testo di ogni nodo `collegamento`: i pezzi di testo del nodo e dei suoi
/// discendenti, nell'ordine dell'elenco, separati da uno spazio. Un pezzo sta
/// nel collegamento più vicino fra i suoi antenati; poiché il genitore viene
/// sempre prima del figlio, una passata sola trova per ogni nodo il suo.
fn testi_collegamento(elenco: &ElencoPagine) -> BTreeMap<usize, String> {
    let mut collegamento: Vec<Option<usize>> = Vec::with_capacity(elenco.struttura.len());
    for (i, n) in elenco.struttura.iter().enumerate() {
        let suo = match n.specie {
            Specie::Collegamento => Some(i),
            _ => n.genitore.and_then(|g| collegamento[g]),
        };
        collegamento.push(suo);
    }
    let mut testi: BTreeMap<usize, String> = BTreeMap::new();
    for pezzo in elenco.pagine.iter().flat_map(|p| &p.pezzi) {
        let Pezzo::Testo {
            testo,
            nodo: Some(n),
            ..
        } = pezzo
        else {
            continue;
        };
        let Some(c) = collegamento[*n] else {
            continue;
        };
        let t = testi.entry(c).or_default();
        if t.len() >= MAX_TESTO_ALTERNATIVO {
            continue;
        }
        if !t.is_empty() {
            t.push(' ');
        }
        t.push_str(testo.trim());
    }
    testi
}

impl Scrittore<'_> {
    /// Decide se il PDF porta i tag: li chiede chi esporta e la vista ha
    /// mandato la struttura. Chiesti senza struttura, il PDF esce senza tag e
    /// lo dice un avviso.
    pub(super) fn prepara_tag(&mut self) {
        if !self.opzioni.accessibile {
            return;
        }
        if self.elenco.struttura.is_empty() {
            self.avvisi.push(Avviso::StrutturaMancante);
            return;
        }
        self.marcatura = Marcatura {
            attiva: true,
            contenuti: vec![Vec::new(); self.elenco.struttura.len()],
            sequenze: vec![Vec::new(); self.elenco.pagine.len()],
            pagine_con_annotazioni: vec![false; self.elenco.pagine.len()],
            testi_collegamento: testi_collegamento(self.elenco),
            ..Marcatura::default()
        };
    }

    /// Se il PDF porta i tag.
    pub(super) fn con_i_tag(&self) -> bool {
        self.marcatura.attiva
    }

    /// Apre la sequenza di un pezzo della pagina `pagina`: marcata col suo
    /// `MCID` se il pezzo ha un nodo, un artefatto se non ce l'ha.
    pub(super) fn apri_marcatura(&mut self, c: &mut Content, pagina: usize, nodo: Option<usize>) {
        let m = &mut self.marcatura;
        if !m.attiva {
            return;
        }
        let Some(n) = nodo else {
            c.begin_marked_content(Name(b"Artifact"));
            return;
        };
        let mcid = m.sequenze[pagina].len() as i32;
        m.sequenze[pagina].push(n);
        m.passo += 1;
        m.contenuti[n].push((m.passo, Contenuto::Sequenza { pagina, mcid }));
        let (_, nome) = ruolo(&self.elenco.struttura[n]);
        c.begin_marked_content_with_properties(Name(nome))
            .properties()
            .identify(mcid);
    }

    /// Chiude la sequenza aperta da [`Self::apri_marcatura`].
    pub(super) fn chiudi_marcatura(&mut self, c: &mut Content) {
        if self.marcatura.attiva {
            c.end_marked_content();
        }
    }

    /// Registra l'annotazione `rif` di un collegamento della pagina `pagina`
    /// nel suo nodo, e ne dà la chiave `StructParent`; senza tag o senza nodo,
    /// niente.
    pub(super) fn marca_annotazione(
        &mut self,
        pagina: usize,
        rif: Ref,
        nodo: Option<usize>,
    ) -> Option<i32> {
        let m = &mut self.marcatura;
        let n = nodo.filter(|_| m.attiva)?;
        let j = m.annotazioni.len();
        m.annotazioni.push(n);
        m.passo += 1;
        m.contenuti[n].push((m.passo, Contenuto::Annotazione { pagina, rif }));
        m.pagine_con_annotazioni[pagina] = true;
        Some(m.chiave_annotazione(j))
    }

    /// Il testo che un lettore di schermo legge per un collegamento: il testo
    /// alternativo del suo nodo, o il testo che il nodo contiene, o
    /// l'indirizzo.
    pub(super) fn descrizione_collegamento(
        &self,
        nodo: Option<usize>,
        destinazione: &Destinazione,
    ) -> Option<String> {
        if !self.marcatura.attiva {
            return None;
        }
        let alt = nodo
            .map(|n| self.elenco.struttura[n].alt.trim())
            .filter(|alt| !alt.is_empty())
            .or_else(|| {
                nodo.and_then(|n| self.marcatura.testi_collegamento.get(&n))
                    .map(|t| t.trim())
                    .filter(|t| !t.is_empty())
            });
        match (alt, destinazione) {
            (Some(alt), _) => Some(alt.to_owned()),
            (None, Destinazione::Fuori { url }) => Some(url.trim().to_owned()),
            (None, Destinazione::Dentro { .. }) => None,
        }
    }

    /// Le chiavi della pagina `pagina` nel dizionario della pagina:
    /// `StructParents` se ha sequenze marcate, e se le sue annotazioni vanno
    /// nell'ordine della struttura (`Tabs /S`).
    pub(super) fn chiavi_della_pagina(&self, pagina: usize) -> (Option<i32>, Option<TabOrder>) {
        let m = &self.marcatura;
        if !m.attiva {
            return (None, None);
        }
        let genitori = (!m.sequenze[pagina].is_empty()).then_some(pagina as i32);
        let ordine = m.pagine_con_annotazioni[pagina].then_some(TabOrder::StructureOrder);
        (genitori, ordine)
    }

    /// Scrive l'albero della struttura e ne dà la radice
    /// (`StructTreeRoot`); senza tag, niente.
    pub(super) fn scrivi_struttura(&mut self) -> Option<Ref> {
        if !self.marcatura.attiva {
            return None;
        }
        // Ciò che le pagine hanno raccolto passa qui; il PDF resta marcato,
        // per chi chiede dopo se ha i tag (i metadati).
        let marcatura = std::mem::replace(
            &mut self.marcatura,
            Marcatura {
                attiva: true,
                ..Marcatura::default()
            },
        );
        let nodi = &self.elenco.struttura;
        let n = nodi.len();
        let radice = self.rif();
        let documento = self.rif();
        let rif_nodi: Vec<Ref> = (0..n).map(|_| self.rif()).collect();

        let mut figli: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut in_cima: Vec<usize> = Vec::new();
        for (i, nodo) in nodi.iter().enumerate() {
            match nodo.genitore {
                Some(g) => figli[g].push(i),
                None => in_cima.push(i),
            }
        }
        // Il primo contenuto di ogni sottoalbero (il passo e la pagina): i
        // figli vengono dopo il genitore, quindi basta un giro all'indietro.
        let mut primo: Vec<Option<(u64, usize)>> = vec![None; n];
        for i in (0..n).rev() {
            let proprio = marcatura.contenuti[i]
                .first()
                .map(|(passo, c)| (*passo, c.pagina()));
            primo[i] = min_passo(primo[i], proprio);
            if let Some(g) = nodi[i].genitore {
                primo[g] = min_passo(primo[g], primo[i]);
            }
        }

        // Gli avvisi: ciò che un lettore di schermo non saprà leggere.
        for (i, nodo) in nodi.iter().enumerate() {
            let pagina = primo[i].map(|(_, p)| p + 1);
            match nodo.specie {
                Specie::Figura | Specie::Formula if nodo.alt.trim().is_empty() => {
                    self.avvisi
                        .push(Avviso::TestoAlternativoMancante { nodo: i, pagina });
                }
                Specie::Tabella if !ha_intestazione(i, &figli, nodi) => {
                    self.avvisi
                        .push(Avviso::TabellaSenzaIntestazione { nodo: i, pagina });
                }
                _ => {}
            }
        }

        let mut lingue_scartate: Vec<String> = Vec::new();
        for i in 0..n {
            let nodo = &nodi[i];
            let (kind, _) = ruolo(nodo);
            let genitore = nodo.genitore.map_or(documento, |g| rif_nodi[g]);
            let mut el = self.pdf.struct_element(rif_nodi[i]);
            el.kind(kind).parent(genitore);
            if let Some((_, pagina)) = primo[i] {
                el.page(self.pagine[pagina]);
            }
            let alt = nodo.alt.trim();
            if !alt.is_empty() {
                el.alt(TextStr(alt));
            }
            let lingua = nodo.lingua.trim();
            if !lingua.is_empty() {
                if etichetta_di_lingua(lingua) {
                    el.lang(TextStr(lingua));
                } else {
                    lingue_scartate.push(lingua.to_owned());
                }
            }
            match nodo.specie {
                Specie::Intestazione => {
                    let ambito = match nodo.ambito.unwrap_or(Ambito::Colonna) {
                        Ambito::Colonna => TableHeaderScope::Column,
                        Ambito::Riga => TableHeaderScope::Row,
                        Ambito::Entrambi => TableHeaderScope::Both,
                    };
                    el.attributes().push().table().scope(ambito);
                }
                Specie::Elenco => {
                    let numeri = if nodo.numerato.unwrap_or(false) {
                        ListNumbering::Decimal
                    } else {
                        ListNumbering::Disc
                    };
                    el.attributes().push().list().list_numbering(numeri);
                }
                _ => {}
            }
            let fila = in_ordine(&marcatura.contenuti[i], &figli[i], &primo);
            if !fila.is_empty() {
                let mut kids = el.children();
                for voce in fila {
                    match voce {
                        Voce::Nodo(f) => {
                            kids.struct_element(rif_nodi[f]);
                        }
                        Voce::Contenuto(Contenuto::Sequenza { pagina, mcid }) => {
                            kids.marked_content_ref()
                                .marked_content_id(mcid)
                                .page(self.pagine[pagina]);
                        }
                        Voce::Contenuto(Contenuto::Annotazione { pagina, rif }) => {
                            kids.object_ref().object(rif).page(self.pagine[pagina]);
                        }
                    }
                }
                kids.finish();
            }
            el.finish();
        }
        lingue_scartate.sort();
        lingue_scartate.dedup();
        self.avvisi.extend(
            lingue_scartate
                .into_iter()
                .map(|lingua| Avviso::LinguaScartata { lingua }),
        );

        let mut doc = self.pdf.struct_element(documento);
        doc.kind(StructRole::Document).parent(radice);
        {
            let mut kids = doc.children();
            for &i in &in_cima {
                kids.struct_element(rif_nodi[i]);
            }
        }
        doc.finish();

        // Il `ParentTree`: per ogni pagina l'elenco dei nodi dei suoi `MCID`,
        // per ogni annotazione il suo nodo.
        let mut elenchi: BTreeMap<usize, Ref> = BTreeMap::new();
        for (pagina, sequenze) in marcatura.sequenze.iter().enumerate() {
            if sequenze.is_empty() {
                continue;
            }
            let rif = self.rif();
            self.pdf
                .indirect(rif)
                .array()
                .items(sequenze.iter().map(|&n| rif_nodi[n]));
            elenchi.insert(pagina, rif);
        }
        let prossima = marcatura.chiave_annotazione(marcatura.annotazioni.len());
        let mut albero = self.pdf.indirect(radice).start::<StructTreeRoot>();
        albero.child(documento);
        {
            let mut alberello = albero.parent_tree();
            let mut voci = alberello.nums();
            for (pagina, rif) in &elenchi {
                voci.insert(*pagina as i32, *rif);
            }
            for (j, &n) in marcatura.annotazioni.iter().enumerate() {
                voci.insert(marcatura.chiave_annotazione(j), rif_nodi[n]);
            }
        }
        albero.parent_tree_next_key(prossima);
        albero.finish();
        Some(radice)
    }
}

/// Mette nel catalogo i segni del PDF marcato: la radice della struttura e
/// `MarkInfo`.
pub(super) fn nel_catalogo(cat: &mut Catalog, radice: Ref) {
    cat.pair(Name(b"StructTreeRoot"), radice);
    cat.mark_info().marked(true);
}

impl Contenuto {
    fn pagina(&self) -> usize {
        match self {
            Contenuto::Sequenza { pagina, .. } | Contenuto::Annotazione { pagina, .. } => *pagina,
        }
    }
}

fn min_passo(a: Option<(u64, usize)>, b: Option<(u64, usize)>) -> Option<(u64, usize)> {
    match (a, b) {
        (Some(a), Some(b)) => Some(if b.0 < a.0 { b } else { a }),
        (a, None) => a,
        (None, b) => b,
    }
}

/// Se il sottoalbero di una tabella ha almeno una cella d'intestazione.
fn ha_intestazione(tabella: usize, figli: &[Vec<usize>], nodi: &[Nodo]) -> bool {
    let mut pila = figli[tabella].clone();
    while let Some(i) = pila.pop() {
        if nodi[i].specie == Specie::Intestazione {
            return true;
        }
        pila.extend_from_slice(&figli[i]);
    }
    false
}

/// Un figlio di un nodo nella sua fila: un nodo o un contenuto.
#[derive(Debug, PartialEq)]
enum Voce {
    Nodo(usize),
    Contenuto(Contenuto),
}

/// I figli di un nodo in fila: i nodi figli nell'ordine della vista, e il
/// contenuto proprio del nodo infilato fra loro secondo l'ordine in cui la
/// pagina lo disegna. Un figlio vuoto non sposta niente.
fn in_ordine(
    contenuti: &[(u64, Contenuto)],
    figli: &[usize],
    primo: &[Option<(u64, usize)>],
) -> Vec<Voce> {
    let mut fila = Vec::with_capacity(contenuti.len() + figli.len());
    let mut k = 0;
    for &f in figli {
        if let Some((passo, _)) = primo[f] {
            while k < contenuti.len() && contenuti[k].0 < passo {
                fila.push(Voce::Contenuto(contenuti[k].1));
                k += 1;
            }
        }
        fila.push(Voce::Nodo(f));
    }
    fila.extend(contenuti[k..].iter().map(|(_, c)| Voce::Contenuto(*c)));
    fila
}

#[cfg(test)]
pub(super) mod per_le_prove {
    //! L'ordine dei figli, provato senza scrivere un PDF.
    use super::*;

    /// La fila dei figli come testo: `N3` un nodo, `S0.2` la sequenza 2 della
    /// pagina 0.
    pub(in super::super) fn fila(
        contenuti: &[(u64, usize, i32)],
        figli: &[usize],
        primo: &[Option<u64>],
    ) -> Vec<String> {
        let contenuti: Vec<(u64, Contenuto)> = contenuti
            .iter()
            .map(|&(passo, pagina, mcid)| (passo, Contenuto::Sequenza { pagina, mcid }))
            .collect();
        let primo: Vec<Option<(u64, usize)>> = primo.iter().map(|p| p.map(|p| (p, 0))).collect();
        in_ordine(&contenuti, figli, &primo)
            .into_iter()
            .map(|v| match v {
                Voce::Nodo(n) => format!("N{n}"),
                Voce::Contenuto(Contenuto::Sequenza { pagina, mcid }) => {
                    format!("S{pagina}.{mcid}")
                }
                Voce::Contenuto(Contenuto::Annotazione { .. }) => "A".into(),
            })
            .collect()
    }
}
