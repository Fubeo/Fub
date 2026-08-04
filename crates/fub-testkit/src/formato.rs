//! Il formato di prova, in **una** copia.
//!
//! Il §16.2 contava «nove `impl FormatProvider` chiamati letteralmente
//! `PlainProvider` in nove file diversi» e le trattava come nove copie della
//! stessa cosa. Rilette una per una non lo erano: **sei** registravano
//! l'estensione `txt` e **tre** `md`, il che cambia quali file il kernel
//! instrada a chi — cioè cambia il soggetto del test — e **una** delle tre
//! rendeva `<pre>…</pre>` invece del testo nudo.
//!
//! Nove copie, tre comportamenti. Il che è la ragione per cui questo tipo è
//! parametrico e non una costante: assorbire nove copie con un `PlainProvider`
//! unico avrebbe voluto dire cambiare in silenzio il soggetto di sei test, o
//! lasciarne fuori tre. Gli assi sono esattamente i due che variavano.

use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::FormatProvider;

/// Un formato di testo nudo: il modello è la sorgente, e basta.
///
/// ```
/// use fub_testkit::TestoDiProva;
/// let p = TestoDiProva::per_estensione("txt");
/// ```
pub struct TestoDiProva {
    id: String,
    estensioni: Vec<String>,
    /// Come rende: nudo (il default) o dentro un `<pre>`. È il secondo asse su
    /// cui le nove copie differivano — una sola su nove, ed è quella che prova
    /// che il kernel non guarda dentro l'HTML che gli torna.
    pre: bool,
}

impl TestoDiProva {
    /// Il formato di prova su una estensione. L'id è derivato dall'estensione,
    /// così due formati su due estensioni diverse non collidono nel registro.
    pub fn per_estensione(ext: &str) -> Self {
        TestoDiProva {
            id: format!("prova.{ext}"),
            estensioni: vec![ext.to_string()],
            pre: false,
        }
    }

    /// Su più estensioni in una volta.
    pub fn per_estensioni(exts: &[&str]) -> Self {
        let id = format!("prova.{}", exts.join("-"));
        TestoDiProva {
            id,
            estensioni: exts.iter().map(|e| e.to_string()).collect(),
            pre: false,
        }
    }

    /// Un id esplicito, dove il test asserisce sul nome del formato.
    pub fn con_id(mut self, id: &str) -> Self {
        self.id = id.to_string();
        self
    }

    /// Rende dentro un `<pre>`: serve dove il test guarda che l'HTML del
    /// provider arrivi intatto, e un `render_html` identità non lo mostrerebbe.
    pub fn dentro_un_pre(mut self) -> Self {
        self.pre = true;
        self
    }

    /// In una `Box`, che è la forma in cui il registro lo vuole.
    pub fn boxed(self) -> Box<dyn FormatProvider> {
        Box::new(self)
    }
}

impl FormatProvider for TestoDiProva {
    fn descriptor(&self) -> FormatDescriptor {
        let exts: Vec<&str> = self.estensioni.iter().map(String::as_str).collect();
        FormatDescriptor::text(&self.id, "Testo di prova", &exts)
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        if self.pre {
            Ok(format!("<pre>{}</pre>", model.text))
        } else {
            Ok(model.text.clone())
        }
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

/// Un formato che vuole la sorgente **a byte** e ne tira fuori del testo: la
/// forma di un estrattore (PDF, OCR, trascrizione) senza esserne uno.
///
/// Esiste perché `SourceKind::Bytes` c'era dalla
/// [decisione 0017](../../../docs/decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)
/// e nessun cliente lo percorreva: un ramo dichiarato senza nessuno che ci
/// passi è indistinguibile da un ramo rotto, e infatti era rotto — chi
/// indicizzava non consultava il descrittore e leggeva testo comunque (§21.8).
///
/// Decodifica **latin-1**, che non è una scelta di prodotto ma la più corta che
/// tenga insieme le due cose che servono al banco: dei byte che **non sono
/// UTF-8 valido** — quindi che il canale del testo rifiuterebbe — e che
/// **portano comunque del testo**, quindi che si possono cercare. Nessun crate
/// di parsing entra qui: la voce chiedeva il canale, non l'estrattore.
pub struct EstrattoreDiProva {
    id: String,
    estensioni: Vec<String>,
}

impl EstrattoreDiProva {
    pub fn per_estensione(ext: &str) -> Self {
        EstrattoreDiProva {
            id: format!("estrattore.{ext}"),
            estensioni: vec![ext.to_string()],
        }
    }

    pub fn boxed(self) -> Box<dyn FormatProvider> {
        Box::new(self)
    }
}

impl FormatProvider for EstrattoreDiProva {
    fn descriptor(&self) -> FormatDescriptor {
        let exts: Vec<&str> = self.estensioni.iter().map(String::as_str).collect();
        FormatDescriptor {
            source: fub_abi::format::SourceKind::Bytes,
            ..FormatDescriptor::text(&self.id, "Estrattore di prova", &exts)
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.bytes().iter().map(|b| *b as char).collect();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}
