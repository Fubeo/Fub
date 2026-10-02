//! La grammatica di una destinazione di link inline, `[testo](qui)`.
//!
//! La usano chi scrive un documento intero (`serialize`) e chi riscrive
//! soltanto un link dopo una rinomina (`rewrite`): la destinazione deve avere
//! la stessa forma nei due casi, e la riscrittura chirurgica non passa dal
//! serializer per ottenerla.

/// La destinazione intera, parentesi angolari comprese quando servono.
pub(crate) fn dest_text(url: &str) -> String {
    let url = escape_entities(url);
    if bare_dest(&url) {
        return url.into_owned();
    }
    format!("<{}>", escape_angled(&url))
}

/// L'interno di una destinazione fra parentesi angolari, senza le parentesi:
/// per chi riscrive una destinazione che l'utente aveva già messo fra
/// angolari, e la lascia lì.
///
/// Un a capo non ha forma: una destinazione non attraversa le righe, e chi
/// scrive lo deve rifiutare prima di arrivare qui.
pub(crate) fn angled_dest(url: &str) -> String {
    escape_angled(&escape_entities(url))
}

fn escape_angled(url: &str) -> String {
    let mut out = String::with_capacity(url.len() + 2);
    for c in url.chars() {
        if matches!(c, '<' | '>' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Il parser decodifica i riferimenti a entità anche dentro una destinazione:
/// un file che si chiama `a&amp;b.md` tornerebbe `a&b.md`, cioè un link verso
/// un'altra nota. La `&` che ne apre uno si scrive allora come entità a sua
/// volta, `&amp;`. Non con la barra rovescia: comrak toglie le barre **prima**
/// di decodificare le entità, e `\&amp;` tornerebbe comunque `&`.
fn escape_entities(url: &str) -> std::borrow::Cow<'_, str> {
    if !url
        .char_indices()
        .any(|(at, c)| c == '&' && opens_entity(&url[at..]))
    {
        return std::borrow::Cow::Borrowed(url);
    }
    let mut out = String::with_capacity(url.len() + 8);
    for (at, c) in url.char_indices() {
        if c == '&' && opens_entity(&url[at..]) {
            // L'entità viene dall'unica tabella, non da un'altra scritta qui.
            out.push_str(&fub_abi::html::escape("&"));
        } else {
            out.push(c);
        }
    }
    std::borrow::Cow::Owned(out)
}

/// `rest` comincia con un riferimento a entità o a carattere che il parser
/// decodificherebbe (`&amp;`, `&#38;`, `&#x26;`)?
///
/// La forma nominata non si confronta con la tabella delle entità: un nome
/// che non ne fa parte resta letterale per il parser, e riscriverlo costa
/// soltanto qualche carattere, mentre un nome dimenticato cambia il link.
fn opens_entity(rest: &str) -> bool {
    let Some(body) = rest.strip_prefix('&') else {
        return false;
    };
    let Some(end) = body.find(';') else {
        return false;
    };
    let name = &body[..end];
    if let Some(number) = name.strip_prefix('#') {
        return match number.strip_prefix(['x', 'X']) {
            Some(hex) => (1..=6).contains(&hex.len()) && hex.chars().all(|c| c.is_ascii_hexdigit()),
            None => (1..=7).contains(&number.len()) && number.chars().all(|c| c.is_ascii_digit()),
        };
    }
    name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.chars().all(|c| c.is_ascii_alphanumeric())
}

/// La destinazione si può scrivere senza le parentesi angolari?
fn bare_dest(url: &str) -> bool {
    if url.is_empty() {
        return false;
    }
    let mut depth: i32 = 0;
    for c in url.chars() {
        if matches!(c, '<' | '>' | '\\') || c.is_whitespace() || c.is_control() {
            return false;
        }
        if c == '(' {
            depth += 1;
        }
        if c == ')' {
            depth -= 1;
            if depth < 0 {
                return false;
            }
        }
    }
    depth == 0
}
