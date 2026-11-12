//! I gesti di Fub tradotti per il motore del disegno.
//!
//! Un gesto arriva a pezzi: ogni richiesta porta gli eventi nuovi, nella fase
//! `preview` finché il dito è giù, `commit` alla fine, `cancel` se il gesto
//! si abbandona. Gli eventi diventano chiamate allo strumento del motore
//! (`PointerKind` giù, trascina, su, muovi, con pressione e modificatori, in
//! coordinate del documento del motore); le azioni dello strumento (`Begin`,
//! `Preview`, `Commit`) le esegue la sessione del motore sulla copia.
//!
//! - `preview` dà un [`DrawingPreview`], se lo strumento ne disegna uno;
//! - `commit` dà la differenza fra la copia e il documento dopo il gesto
//!   ([`crate::differenza`]), e la sessione torna alla copia: lo stato vero
//!   è il file, che le operazioni cambiano;
//! - `cancel` riporta la sessione alla copia, senza operazioni.
//!
//! Ogni strumento di Fub è un [`Strumento`]: lo strumento del motore che lo
//! fa, come si prepara e, se vuole, come disegna l'anteprima e come scrive
//! l'elemento nuovo. Uno strumento che [`strumento`] non conosce ancora
//! risponde `unsupported`. Un panico del motore lo prende
//! `vectorcraft_engine::guard::catch_panic`: il gesto è `unsupported`, la
//! sessione si ricarica dalla copia e l'istanza resta viva.

/// Disegnare le forme.
pub mod forme;
/// Selezionare, spostare, ridimensionare e ruotare.
pub mod selezione;
/// Scrivere e modificare il testo.
pub mod testo;

use std::sync::Arc;

use fub_abi::{
    DrawingGesture, DrawingOutcome, DrawingPhase, DrawingPointer, DrawingPointerKind,
    DrawingPreview, DrawingRefusal, DrawingTool,
};
use serde_json::{Map, Value};
use vectorcraft_doc::{Document, Node, NodeId};
use vectorcraft_engine::tools::{Mods, PointerEvent, PointerKind};
use vectorcraft_engine::{Session, ViewInfo};
use vectorcraft_geom::{Affine, Point};

use crate::apertura::Copia;
use crate::differenza::{self, Differenza, Rifiuto};

/// Ciò che uno strumento vede del gesto.
// Il gesto e la copia li leggono gli strumenti, che arrivano con i loro task.
#[allow(dead_code)]
pub(crate) struct Contesto<'a> {
    pub gesto: &'a DrawingGesture,
    pub copia: &'a Copia,
    pub vista: ViewInfo,
}

/// Uno strumento di Fub fatto con uno strumento del motore.
pub(crate) trait Strumento: Sync {
    /// L'id dello strumento del motore.
    fn id_motore(&self) -> &'static str;

    /// Prima del primo evento: le opzioni dello strumento (stile, griglia),
    /// o un rifiuto (livello bloccato, nascosto).
    fn prepara(&self, _sessione: &mut Session, _cx: &Contesto<'_>) -> Result<(), DrawingRefusal> {
        Ok(())
    }

    /// Un evento di Fub prima che lo veda lo strumento del motore: le regole
    /// di Fub che il motore farebbe a modo suo (la griglia, Maiusc, i
    /// modificatori che il motore leggerebbe in un altro modo). `inizio` è
    /// la pressione del gesto, già passata di qui; `None` prima di lei.
    fn evento(
        &self,
        e: DrawingPointer,
        _inizio: Option<&DrawingPointer>,
        _cx: &Contesto<'_>,
    ) -> DrawingPointer {
        e
    }

    /// Ciò che la superficie disegna mentre il gesto continua.
    fn anteprima(&self, _sessione: &mut Session, _cx: &Contesto<'_>) -> Option<DrawingPreview> {
        None
    }

    /// L'`Elem` di un oggetto nuovo, se lo strumento lo scrive a modo suo
    /// (vedi [`differenza::Scrittore`]).
    fn elemento(&self, _nodo: &Node, _locale: Affine) -> Option<(String, Map<String, Value>)> {
        None
    }

    /// Dopo il `commit`: l'ultima parola sull'esito (un gesto che non tocca
    /// niente è `empty`).
    fn rifinisci(&self, _esito: &mut DrawingOutcome, _cx: &Contesto<'_>) {}
}

/// Lo strumento che fa `tool`, se c'è già. I task che li fanno aggiungono
/// qui il loro braccio: le forme in [`forme`], la selezione in
/// [`selezione`], il testo in [`testo`].
pub(crate) fn strumento(tool: DrawingTool) -> Option<&'static dyn Strumento> {
    match tool {
        DrawingTool::Rect | DrawingTool::Ellipse | DrawingTool::Line | DrawingTool::Arrow => {
            Some(forme::strumento(tool))
        }
        DrawingTool::Select | DrawingTool::Text => None,
    }
}

/// Il gesto che la sessione sta facendo, fra una richiesta e l'altra.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct InCorso {
    tool: DrawingTool,
    revisione: u64,
}

/// La sessione del motore di un disegno e il gesto in corso.
pub(crate) struct Banco {
    pub sessione: Session,
    pub in_corso: Option<InCorso>,
    /// La pressione del gesto in corso, come l'ha passata
    /// [`Strumento::evento`].
    pub inizio: Option<DrawingPointer>,
}

impl Banco {
    /// Una sessione con la copia aperta; la copia riceve il documento come
    /// la sessione lo tiene (con i limiti e i riquadri del testo già
    /// calcolati), perché la differenza confronti documenti dello stesso
    /// passo.
    pub fn nuovo(copia: &mut Copia) -> Result<Banco, String> {
        vectorcraft_engine::guard::catch_panic(|| {
            let mut sessione = Session::new();
            sessione.add_document((*copia.documento).clone(), None);
            sessione
        })
        .and_then(|sessione| {
            let doc = sessione.doc().map_err(|e| e.to_string())?.doc.clone();
            copia.documento = doc;
            Ok(Banco {
                sessione,
                in_corso: None,
                inizio: None,
            })
        })
    }

    /// Mette nella sessione la copia nuova, e le dà il documento come la
    /// sessione lo tiene.
    pub fn installa(&mut self, copia: &mut Copia) -> Result<(), String> {
        self.in_corso = None;
        self.inizio = None;
        let doc = (*copia.documento).clone();
        let sessione = &mut self.sessione;
        vectorcraft_engine::guard::catch_panic(|| sessione.replace_document(0, doc))?;
        copia.documento = self.sessione.doc().map_err(|e| e.to_string())?.doc.clone();
        Ok(())
    }

    /// La sessione torna alla copia.
    pub fn ripristina(&mut self, copia: &Copia) {
        self.in_corso = None;
        self.inizio = None;
        let doc = (*copia.documento).clone();
        let sessione = &mut self.sessione;
        if vectorcraft_engine::guard::catch_panic(|| sessione.replace_document(0, doc)).is_err() {
            // Anche la sostituzione è andata in panico: una sessione nuova.
            if let Ok(mut s) = vectorcraft_engine::guard::catch_panic(Session::new) {
                s.add_document((*copia.documento).clone(), None);
                self.sessione = s;
            }
        }
    }

    /// Il documento della sessione adesso.
    pub fn documento(&self) -> Option<Arc<Document>> {
        self.sessione.doc().ok().map(|d| d.doc.clone())
    }

    /// La differenza fra la copia e il documento della sessione cambiato a
    /// mano da `f`: la prova di [`crate::differenza`] senza uno strumento. La
    /// sessione torna poi alla copia.
    pub fn a_mano(
        &mut self,
        copia: &Copia,
        f: impl FnOnce(&mut Document),
    ) -> Result<Differenza, Rifiuto> {
        let Some(doc) = self.documento() else {
            return Err(Rifiuto::NonSupportato(
                "la sessione non ha il documento".into(),
            ));
        };
        let mut dopo = (*doc).clone();
        f(&mut dopo);
        let esito = differenza::differenza(copia, &dopo, None);
        self.ripristina(copia);
        esito
    }

    /// Esegue un pezzo del gesto `gesto` sulla copia `copia`.
    pub fn gesto(&mut self, copia: &Copia, gesto: &DrawingGesture) -> DrawingOutcome {
        let mut esito = esito_vuoto(gesto.revision);
        if gesto.phase == DrawingPhase::Cancel {
            if self.in_corso.is_some() {
                self.ripristina(copia);
            }
            return esito;
        }
        let rifiuta = |banco: &mut Banco, mut esito: DrawingOutcome, r: DrawingRefusal| {
            if banco.in_corso.is_some() {
                banco.ripristina(copia);
            }
            esito.refused = Some(r);
            esito
        };
        if !copia.modificabile {
            return rifiuta(self, esito, DrawingRefusal::Unsupported);
        }
        let Some(strumento) = strumento(gesto.tool) else {
            return rifiuta(self, esito, DrawingRefusal::Unsupported);
        };
        let cx = Contesto {
            gesto,
            copia,
            vista: ViewInfo {
                zoom: gesto.zoom
                    * copia
                        .radice
                        .determinant()
                        .abs()
                        .sqrt()
                        .max(f64::MIN_POSITIVE)
                        .recip(),
                ..ViewInfo::default()
            },
        };
        let qui = InCorso {
            tool: gesto.tool,
            revisione: gesto.revision,
        };
        let ricomincia = self.in_corso != Some(qui)
            || gesto
                .events
                .first()
                .is_some_and(|e| e.kind == DrawingPointerKind::Down);
        let sessione_pronta = if ricomincia {
            if self.in_corso.is_some() {
                self.ripristina(copia);
            }
            let sessione = &mut self.sessione;
            match vectorcraft_engine::guard::catch_panic(|| {
                sessione
                    .select_tool(strumento.id_motore(), cx.vista)
                    .map_err(|_| DrawingRefusal::Unsupported)?;
                strumento.prepara(sessione, &cx)
            }) {
                Ok(Ok(())) => true,
                Ok(Err(r)) => return rifiuta(self, esito, r),
                Err(_) => false,
            }
        } else {
            true
        };
        if !sessione_pronta {
            self.ripristina(copia);
            return rifiuta(self, esito, DrawingRefusal::Unsupported);
        }
        self.in_corso = Some(qui);
        let (sessione, inizio) = (&mut self.sessione, &mut self.inizio);
        let eventi = vectorcraft_engine::guard::catch_panic(|| {
            for e in &gesto.events {
                let e = strumento.evento(*e, inizio.as_ref(), &cx);
                if e.kind == DrawingPointerKind::Down {
                    *inizio = Some(e);
                }
                sessione.pointer(&evento(&e, copia.radice), cx.vista)?;
            }
            Ok::<(), vectorcraft_engine::EngineError>(())
        });
        match eventi {
            Ok(Ok(())) => {}
            Ok(Err(_)) | Err(_) => return rifiuta(self, esito, DrawingRefusal::Unsupported),
        }
        if gesto.phase == DrawingPhase::Preview {
            let sessione = &mut self.sessione;
            match vectorcraft_engine::guard::catch_panic(|| strumento.anteprima(sessione, &cx)) {
                Ok(anteprima) => esito.preview = anteprima,
                Err(_) => return rifiuta(self, esito, DrawingRefusal::Unsupported),
            }
            return esito;
        }
        // Il commit.
        let Some(dopo) = self.documento() else {
            return rifiuta(self, esito, DrawingRefusal::Unsupported);
        };
        let selezione: Vec<NodeId> = self
            .sessione
            .doc()
            .map(|d| d.selection.objects.clone())
            .unwrap_or_default();
        let scrittore = |n: &Node, m: Affine| strumento.elemento(n, m);
        let differenza = vectorcraft_engine::guard::catch_panic(|| {
            differenza::differenza(copia, &dopo, Some(&scrittore))
        });
        self.ripristina(copia);
        let differenza = match differenza {
            Ok(Ok(d)) => d,
            Ok(Err(r)) => return rifiuta(self, esito, r.rifiuto()),
            Err(_) => return rifiuta(self, esito, DrawingRefusal::Unsupported),
        };
        match differenza.testo() {
            Ok(ops) => esito.ops = ops,
            Err(r) => return rifiuta(self, esito, r.rifiuto()),
        }
        esito.selection = selezione_di_fub(copia, &differenza, &selezione);
        strumento.rifinisci(&mut esito, &cx);
        esito
    }
}

/// Un esito senza anteprima, operazioni, selezione né rifiuto.
pub(crate) fn esito_vuoto(revisione: u64) -> DrawingOutcome {
    DrawingOutcome {
        revision: revisione,
        preview: None,
        ops: None,
        selection: Vec::new(),
        losses: Vec::new(),
        refused: None,
    }
}

/// Gli id di Fub della selezione del motore; un oggetto senza id resta fuori.
fn selezione_di_fub(copia: &Copia, differenza: &Differenza, selezione: &[NodeId]) -> Vec<String> {
    let mut fuori: Vec<String> = Vec::new();
    for n in selezione {
        let id = differenza.ids.get(n).cloned().or_else(|| {
            copia
                .mappa
                .del_nodo(*n)
                .and_then(|i| copia.mappa.elemento(i))
                .and_then(|e| e.id.clone())
        });
        if let Some(id) = id {
            if !fuori.contains(&id) {
                fuori.push(id);
            }
        }
    }
    fuori
}

/// Un evento della penna di Fub come lo vuole il motore: dalle coordinate
/// della scena a quelle del documento del motore.
fn evento(e: &DrawingPointer, radice: Affine) -> PointerEvent {
    let kind = match e.kind {
        DrawingPointerKind::Down => PointerKind::Down,
        DrawingPointerKind::Drag => PointerKind::Drag,
        DrawingPointerKind::Up => PointerKind::Up,
        DrawingPointerKind::Move => PointerKind::Move,
        DrawingPointerKind::DoubleClick => PointerKind::DoubleClick,
    };
    PointerEvent {
        kind,
        pos: radice * Point::new(e.x, e.y),
        mods: Mods {
            shift: e.shift,
            alt: e.alt,
            cmd: e.cmd,
            ..Mods::default()
        },
        backquote: false,
        pressure: e.pressure,
    }
}
