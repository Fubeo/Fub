//! `LinkTarget`, la sua classificazione e il wikilink letto nei suoi pezzi.

use super::*;

/// Intento di link **non risolto**. Il provider dice "questo è un wikilink alla
/// pagina X#heading"; la risoluzione a `DocId` è compito del KERNEL (regola
/// Obsidian dello shortest unique path).
///
/// Le tre varianti sono tre *specie* di bersaglio, e la distinzione fra
/// "risorsa del vault" (`Wiki`, `Path`) e "mondo esterno" (`Url`) è una regola
/// del **contratto**, non di chi parsa: sta in [`LinkTarget::classify`]. Prima
/// viveva dentro il provider markdown, e un secondo provider poteva
/// legittimamente rispondere un'altra cosa sulla stessa stringa — con l'effetto
/// che metà del grafo dipendeva da chi aveva letto il file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
// Tag adiacente: alcune varianti portano uno scalare, e col tag interno
// `serde_json` fallirebbe a serializzarle (vedi il § in testa al modulo).
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum LinkTarget {
    /// `[[Page#Heading^block]]`.
    Wiki {
        page: String,
        heading: Option<String>,
        block: Option<String>,
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
        }
    }

    /// Questo riferimento nomina il documento che lo **ospita**?
    ///
    /// È il caso di `[[#Sezione]]` e `[[#^blocco]]`: un wikilink senza pagina
    /// non è un link rotto e non è un link a niente — è un link *qui dentro*, e
    /// il documento che nomina è quello in cui è scritto. Il parser lo produce
    /// dal primo giorno (`page` vuota, `heading` o `block` pieni); a leggerlo
    /// non era nessuno, e le due conseguenze erano che la risoluzione
    /// rispondeva `None` e il controllo di salute lo dichiarava rotto con la
    /// stringa vuota come destinazione.
    ///
    /// La regola sta qui e non nei due chiamanti perché è una regola della
    /// **grammatica**, non della risoluzione: chi chiede «a cosa punta» e chi
    /// chiede «è rotto» devono avere la stessa risposta, e due copie
    /// divergerebbero al primo che se ne dimentica.
    ///
    /// `[[]]` non passa: senza pagina *e* senza punto non c'è niente da
    /// nominare, e «questo documento in cima» non è ciò che quel link chiede —
    /// è ciò che si otterrebbe non chiedendo niente.
    pub fn names_host(&self) -> bool {
        match self {
            LinkTarget::Wiki {
                page,
                heading,
                block,
            } => page.trim().is_empty() && (heading.is_some() || block.is_some()),
            _ => false,
        }
    }

    /// La destinazione di un link scritto "alla markdown" (`[t](qui)`): è del
    /// **vault** o del mondo esterno?
    ///
    /// La regola è lo schema: `qualcosa:` con uno schema URI valido (lettera,
    /// poi lettere/cifre/`+`/`-`/`.`) oppure il protocol-relative `//host` →
    /// [`LinkTarget::Url`]; tutto il resto è un path dentro il vault, che il
    /// kernel risolverà (`fub_kernel::pathlink`). Un `mailto:`, un `tel:`,
    /// un `obsidian://` cadono nel primo caso senza essere nominati uno per uno.
    ///
    /// Il caso ostile è il path di Windows (`C:\foto\a.png`): lo schema di un
    /// URI è lungo almeno due caratteri, quindi `C:` non lo è, e resta un path.
    pub fn classify(raw: &str) -> Self {
        let s = raw.trim();
        if s.starts_with("//") {
            return LinkTarget::Url(raw.to_string());
        }
        if let Some((scheme, _)) = s.split_once(':') {
            let mut chars = scheme.chars();
            let ok = scheme.len() >= 2
                && chars.next().is_some_and(|c| c.is_ascii_alphabetic())
                && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
            if ok {
                return LinkTarget::Url(raw.to_string());
            }
        }
        LinkTarget::Path(raw.to_string())
    }
}

/// L'interno di un wikilink già scomposto: `Page#Heading^block|Alias`.
///
/// Vive nel contratto e non nel toolkit dei provider testuali perché è la
/// **grammatica di ciò che il contratto dichiara**: [`LinkTarget::Wiki`] ha
/// esattamente quei tre campi, e la regola che li riempie è una sola, come
/// [`canonical_tag`]. `fub-sdk` la ri-esporta per i provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedWikilink {
    pub target: LinkTarget,
    /// Alias di visualizzazione dopo `|`, se presente.
    pub alias: Option<String>,
}

/// Parsa l'interno di un wikilink, cioè il contenuto fra `[[` e `]]`.
///
/// L'`embed` non è qui: il `!` sta *fuori* dalle parentesi, ed è una proprietà
/// del riferimento, non del bersaglio (vedi [`Link::embed`]).
///
/// Esempi: `Nota`, `Nota#Sezione`, `Nota^blocco`, `Nota#Sez|testo`, `#SoloHeading`.
///
/// È **indulgente di proposito** su una forma che Obsidian non scrive:
/// `Nota^blocco` senza `#` dà lo stesso un riferimento a blocco. Chi *scrive*
/// non lo è ([`LinkTarget::wiki_inner`] mette sempre il `#`), che è la sola
/// composizione in cui leggere e scrivere non producono un dialetto privato.
pub fn parse_wikilink_inner(inner: &str) -> ParsedWikilink {
    // Alias dopo la prima '|'.
    let (link_part, alias) = match inner.split_once('|') {
        Some((the, a)) => (the, Some(a.trim().to_string())),
        None => (inner, None),
    };

    // Riferimento a blocco `^id` (solo se dopo un eventuale heading).
    let (link_part, block) = match link_part.split_once('^') {
        Some((the, b)) => (the, Some(b.trim().to_string())),
        None => (link_part, None),
    };

    // Heading dopo '#'.
    let (page, heading) = match link_part.split_once('#') {
        Some((p, h)) => (p.trim().to_string(), Some(h.trim().to_string())),
        None => (link_part.trim().to_string(), None),
    };

    ParsedWikilink {
        target: LinkTarget::Wiki {
            page,
            // **Un heading vuoto non è un heading.** In `Nota#^blocco` il `#`
            // introduce il `^` e non nomina niente, e in `Nota#` non c'è niente
            // da nominare: il campo valeva `Some("")`, cioè un titolo che
            // nessun outline contiene. Da lì uscivano un `data-…-heading=""`
            // scritto sul segnaposto della transclusion e — peggio — un
            // bersaglio che [`LinkTarget::wiki_inner`] non sa riscrivere
            // uguale, perché la forma canonica di quel campo assente è
            // l'assenza.
            heading: heading.filter(|h| !h.is_empty()),
            block,
        },
        alias: alias.filter(|a| !a.is_empty()),
    }
}

impl LinkTarget {
    /// L'interno di questo wikilink, cioè ciò che va fra `[[` e `]]`.
    ///
    /// È il verso opposto di [`parse_wikilink_inner`], e sta **qui accanto** per
    /// la ragione per cui [`HeadingSlugs`] sta accanto a [`heading_matches`]:
    /// chi scrive la forma testuale di un bersaglio e chi la rilegge sono la
    /// stessa regola in due versi, e finché erano due divergevano. Divergevano
    /// davvero: il serializer markdown scriveva `[[page^b]]` per un riferimento
    /// a blocco senza heading, e in Obsidian quello non è un riferimento a
    /// blocco — è una pagina che si chiama `page^b`. Il `#` non è opzionale
    /// perché l'heading manca; è ciò che rende `^` un `^` di ancora.
    ///
    /// Il giro `wiki_inner` → `parse_wikilink_inner` è **l'identità**, ed è la
    /// forma in cui la coppia resta onesta: un lettore indulgente e uno
    /// scrittore che si accontenta della propria indulgenza sono d'accordo fra
    /// loro e in disaccordo con tutti gli altri.
    ///
    /// `None` per gli altri due bersagli: un URL e un path si scrivono con
    /// un'altra sintassi, e quale non lo decide il contratto.
    pub fn wiki_inner(&self) -> Option<String> {
        let LinkTarget::Wiki {
            page,
            heading,
            block,
        } = self
        else {
            return None;
        };
        let mut out = String::with_capacity(page.len() + 16);
        out.push_str(page);
        if let Some(h) = heading {
            out.push('#');
            out.push_str(h);
        }
        if let Some(b) = block {
            if heading.is_none() {
                out.push('#');
            }
            out.push('^');
            out.push_str(b);
        }
        Some(out)
    }
}
