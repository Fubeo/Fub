//! Il modello di documento **comune e agnostico rispetto al formato**.
//!
//! Deve essere abbastanza ricco da rappresentare markdown in modo fedele, ma
//! non deve nominare nulla di specifico del markdown: i concetti trasversali
//! (link, tag, heading, frontmatter) sono estratti in tabelle piatte così che
//! il kernel possa costruire grafo e indice senza camminare alberi
//! format-specific. Tutto ciò che è peculiare di un formato (callout, math,
//! embed, tabelle...) finisce nell'escape hatch `Custom { kind, attrs }`.

use serde::{Deserialize, Serialize};

/// Identificatore stabile di un documento nel vault.
///
/// È il path relativo al vault, normalizzato con separatori `/` e senza
/// estensione implicita rimossa (il path è la verità). La risoluzione dei
/// wikilink → `DocId` è compito del kernel, non dei provider.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DocId(pub String);

impl DocId {
    pub fn new(path: impl Into<String>) -> Self {
        DocId(path.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Il "nome pagina" (basename senza estensione), usato dalla risoluzione
    /// dei wikilink in stile Obsidian.
    pub fn page_name(&self) -> &str {
        let after_slash = self.0.rsplit('/').next().unwrap_or(&self.0);
        match after_slash.rsplit_once('.') {
            Some((stem, _ext)) => stem,
            None => after_slash,
        }
    }
}

impl std::fmt::Display for DocId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Un intervallo `[start, end)` in **byte** nella sorgente originale.
///
/// Ogni nodo porta uno span: è indispensabile per le decorazioni di live
/// preview in CodeMirror e per le modifiche in-place / round-trip.
///
/// I campi sono `usize` perché indicizzano `&str` in memoria, e non `u64`:
/// dover scrivere `as usize` a ogni slice per compiacere il confine sarebbe la
/// coda che muove il cane. Nel WIT lo span è `record span { start: u64, end: u64 }`
/// — il confine ha bisogno di una larghezza fissa — e la conversione vive nel
/// proxy WASM: `usize`→`u64` è sempre lecita, `u64`→`usize` su wasm32 (dove
/// `usize` è a 32 bit) passa da un `try_into`, con il conforto che un documento
/// più grande di 4 GiB non entrerebbe comunque nella memoria di un modulo.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub const EMPTY: Span = Span { start: 0, end: 0 };

    pub fn new(start: usize, end: usize) -> Self {
        Span { start, end }
    }
}

/// Metadati strutturati del documento (frontmatter YAML/TOML/... proiettati su
/// JSON, così che il core resti agnostico rispetto alla sintassi).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Frontmatter(pub serde_json::Map<String, serde_json::Value>);

impl Frontmatter {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.0.get(key)
    }

    /// Alias dichiarati nel frontmatter (`aliases: [..]` in stile Obsidian).
    /// Accetta sia una stringa singola sia una lista.
    pub fn aliases(&self) -> Vec<String> {
        match self.0.get("aliases").or_else(|| self.0.get("alias")) {
            Some(serde_json::Value::String(s)) => vec![s.clone()],
            Some(serde_json::Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            _ => Vec::new(),
        }
    }
}

/// Il documento parsato nel modello comune.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentModel {
    pub id: DocId,
    pub frontmatter: Frontmatter,
    /// L'albero a blocchi (per il rendering).
    pub body: Vec<Block>,
    /// Heading in ordine, piatti (per outline panel e link a heading).
    pub outline: Vec<Heading>,
    /// Link piatti, risolti in seguito dal grafo del kernel.
    pub links: Vec<Link>,
    /// Tag piatti.
    pub tags: Vec<Tag>,
    /// Proiezione a testo semplice, per l'indicizzazione full-text.
    pub text: String,
}

impl DocumentModel {
    /// Costruisce un modello vuoto per un dato id (comodo nei test del kernel,
    /// che non conoscono alcun formato).
    pub fn empty(id: DocId) -> Self {
        DocumentModel {
            id,
            frontmatter: Frontmatter::default(),
            body: Vec::new(),
            outline: Vec::new(),
            links: Vec::new(),
            tags: Vec::new(),
            text: String::new(),
        }
    }
}

/// Nodi a livello di blocco. `Custom` è l'escape hatch: callout, math,
/// tabelle, embed non sono hardcoded nell'enum.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Block {
    Heading {
        level: u8,
        inlines: Vec<Inline>,
        span: Span,
    },
    Paragraph {
        inlines: Vec<Inline>,
        span: Span,
    },
    List {
        ordered: bool,
        items: Vec<Vec<Block>>,
        span: Span,
    },
    CodeBlock {
        lang: Option<String>,
        code: String,
        span: Span,
    },
    Quote {
        blocks: Vec<Block>,
        span: Span,
    },
    ThematicBreak {
        span: Span,
    },
    /// Callout Obsidian, blocchi math, tabelle, embed... mappano qui.
    Custom {
        custom_kind: String,
        attrs: serde_json::Value,
        blocks: Vec<Block>,
        span: Span,
    },
}

/// Nodi inline. Wikilink e link markdown normalizzano entrambi su `Link`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Inline {
    Text(String),
    Emph(Vec<Inline>),
    Strong(Vec<Inline>),
    Code(String),
    Link {
        target: LinkTarget,
        label: Option<Vec<Inline>>,
        span: Span,
    },
    TagRef {
        name: String,
        span: Span,
    },
    Custom {
        custom_kind: String,
        attrs: serde_json::Value,
        span: Span,
    },
}

/// Intento di link **non risolto**. Il provider dice "questo è un wikilink alla
/// pagina X#heading"; la risoluzione a `DocId` è compito del KERNEL (regola
/// Obsidian dello shortest unique path).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LinkTarget {
    /// `[[Page#Heading^block]]` — con eventuale embed (`![[..]]`).
    Wiki {
        page: String,
        heading: Option<String>,
        block: Option<String>,
        embed: bool,
    },
    Url(String),
    Path(String),
}

impl LinkTarget {
    pub fn wiki(page: impl Into<String>) -> Self {
        LinkTarget::Wiki {
            page: page.into(),
            heading: None,
            block: None,
            embed: false,
        }
    }
}

/// Un link estratto, piatto, con lo span nella sorgente e un po' di contesto
/// per l'anteprima nei backlink.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Link {
    pub target: LinkTarget,
    pub span: Span,
    pub context: Option<String>,
}

/// Un heading estratto (per outline e link a heading).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub slug: String,
    pub span: Span,
}

/// Un tag `#foo` o `#foo/bar` estratto.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub span: Span,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docid_page_name_strips_dir_and_ext() {
        assert_eq!(DocId::new("note.md").page_name(), "note");
        assert_eq!(DocId::new("a/b/Nota Lunga.md").page_name(), "Nota Lunga");
        assert_eq!(DocId::new("senza-ext").page_name(), "senza-ext");
    }

    #[test]
    fn frontmatter_aliases_accepts_string_or_list() {
        let mut m = serde_json::Map::new();
        m.insert("aliases".into(), serde_json::json!(["A", "B"]));
        assert_eq!(Frontmatter(m).aliases(), vec!["A", "B"]);

        let mut m2 = serde_json::Map::new();
        m2.insert("alias".into(), serde_json::json!("Solo"));
        assert_eq!(Frontmatter(m2).aliases(), vec!["Solo"]);
    }
}
