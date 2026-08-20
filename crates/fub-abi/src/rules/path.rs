//! I path del vault: la **chiave** con cui si risolvono e i link markdown
//! relativi che ci arrivano sopra.
//!
//! # La chiave di risoluzione
//!
//! [`resolution_key`] è l'unico punto di normalizzazione: trim, NFC, minuscolo.
//! Ci passano il nome pagina di un wikilink, il path di un link markdown, gli
//! alias, e la ricerca della folder note nella sidebar. NFC perché un vault
//! sincronizzato con macOS ha nomi file in NFD mentre il link digitato è NFC:
//! senza, `[[Café]]` non risolve, il backlink non esiste e per il grafo sono due
//! nodi — e colpisce esattamente le note accentate.
//!
//! # I link markdown ordinari — `[testo](note/altra.md)` — visti come archi
//!
//! Un wikilink porta un nome di pagina e la risoluzione è globale: `[[Nota]]`
//! vuol dire la stessa cosa ovunque sia scritto. Un link markdown porta invece
//! un **path**, ed è relativo al documento che lo contiene: lo stesso testo
//! `../altra.md` indica due documenti diversi in due cartelle diverse. Questo
//! modulo è l'unico posto dove quella differenza è scritta.
//!
//! Tre regole, e nessuna di più:
//!
//! 1. **Relativo a cosa** — alla *cartella* del documento sorgente; con lo
//!    slash iniziale, alla radice del vault. `.` e `..` si risolvono qui, e un
//!    `..` di troppo esce dal vault: il link non risolve, non lo si insegue.
//! 2. **Con o senza estensione** — vince l'accoppiamento esatto (`note/a.md` →
//!    `note/a.md`); solo se manca si prova il path *senza estensione*
//!    ([`strip_ext`]), la stessa chiave dei wikilink, che accoglie sia `note/a`
//!    sia i nomi col punto dentro (`note/v1.2`). Un `note/a.png` che non esiste
//!    **non** ricade su `note/a.md`: l'utente ha scritto un'estensione, e va
//!    presa sul serio.
//! 3. **Caso** — la stessa [`resolution_key`] dei wikilink, perché il vault
//!    sincronizzato fra macOS e Linux è lo stesso vault.
//!
//! In più il percent-encoding, che nei wikilink non esiste e qui sì:
//! `[t](nota%20uno.md)` e `[t](<nota uno.md>)` sono lo stesso link, e devono
//! essere lo stesso arco.

use crate::model::DocId;
use crate::rules::composition::composed;

/// La chiave con cui una stringa entra nella risoluzione: trim, NFC, minuscolo.
///
/// **Unico punto di normalizzazione.** Chi confronta due nomi di documento —
/// il grafo, la riscrittura al rename, la folder note della sidebar,
/// l'autocompletamento — deve passare da qui, o due pezzi del sistema avranno
/// due idee di quando due nomi sono lo stesso nome.
pub fn resolution_key(s: &str) -> String {
    composed(s.trim()).to_lowercase()
}

/// La stessa chiave **senza** il passo che collassa le maiuscole: trim e NFC.
///
/// Non è una seconda normalizzazione e non sostituisce [`resolution_key`]: è ciò
/// che resta da confrontare **quando i candidati sono già più d'uno**. Due file
/// che differiscono solo per una maiuscola hanno la stessa chiave di
/// risoluzione — è la regola giusta, perché un vault sincronizzato fra macOS e
/// Linux è lo stesso vault — ma sono **due file**, e finché la scelta fra i
/// candidati guardava solo la chiave, chi aveva scritto `[[nota]]` non poteva
/// ottenere `nota.md` se accanto c'era `Nota.md`: vinceva sempre lo stesso, e
/// quale dei due lo decideva l'ordine ASCII.
///
/// La differenza in una riga: `resolution_key` dice **chi è candidato**,
/// `exact_key` dice **chi ha ragione fra i candidati**.
pub fn exact_key(s: &str) -> String {
    composed(s.trim())
}

/// Il path senza l'ultima estensione: `note/v1.2.md` → `note/v1.2`.
///
/// È la chiave *senza estensione* con cui `note/a` e `note/a.md` si incontrano.
/// Un punto dentro un segmento di cartella non conta (`v1.2/nota` resta
/// intero): l'estensione è dell'ultimo segmento o non c'è.
pub fn strip_ext(path: &str) -> String {
    match path.rsplit_once('.') {
        Some((stem, ext)) if !ext.contains('/') => stem.to_string(),
        _ => path.to_string(),
    }
}

/// Divide un target markdown in path e **frammento** (`#heading`, `#^blocco`).
///
/// Il frammento non partecipa alla risoluzione — l'ancora dentro un documento è
/// roba della decisione 0003 — ma va conservato: una riscrittura al rename che
/// lo perdesse romperebbe il link in un modo diverso da quello che stava
/// riparando.
pub fn split_fragment(raw: &str) -> (&str, &str) {
    match raw.find('#') {
        Some(hash_at) => (&raw[..hash_at], &raw[hash_at..]),
        None => (raw, ""),
    }
}

/// Decodifica le sequenze `%XX`. Byte non validi o troncati restano com'erano:
/// un path non è il posto dove fallire per una percentuale scritta a mano.
pub fn percent_decode(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut offset = 0;
    while offset < bytes.len() {
        if bytes[offset] == b'%' && offset + 2 < bytes.len() {
            if let (Some(hi), Some(value)) = (hex(bytes[offset + 1]), hex(bytes[offset + 2])) {
                out.push(hi * 16 + value);
                offset += 3;
                continue;
            }
        }
        out.push(bytes[offset]);
        offset += 1;
    }
    // Se la decodifica produce byte che non sono UTF-8 il path non era un path:
    // meglio la stringa originale di un `�` che non aprirà mai nulla.
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// I caratteri ASCII che possono restare nudi dentro la destinazione di un link
/// markdown inline.
///
/// È il set "path" di RFC 3986 **meno le parentesi tonde**: sono legali in un
/// URI e illegali qui, perché `](` e `)` sono la sintassi che stiamo scrivendo.
/// Il non-ASCII resta com'è: `Città.md` si legge, `Citt%C3%A0.md` no, e i due
/// arrivano comunque allo stesso `DocId` passando da [`percent_decode`].
fn is_safe(c: char) -> bool {
    !c.is_ascii()
        || c.is_ascii_alphanumeric()
        || matches!(
            c,
            '-' | '.'
                | '_'
                | '~'
                | '/'
                | ':'
                | '@'
                | '!'
                | '$'
                | '&'
                | '+'
                | ','
                | ';'
                | '='
                | '\''
                | '*'
        )
}

/// Codifica un path perché possa stare in `[testo](qui)`.
pub fn percent_encode_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if is_safe(c) {
            out.push(c);
        } else {
            // Fin qui `c` è ASCII per costruzione, ma un `encode_utf8` costa
            // niente e non lascia in giro l'ipotesi.
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).as_bytes() {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

/// Il path del vault a cui punta `raw` scritto dentro `src`, o `None` se `raw`
/// non è un riferimento a una risorsa del vault (frammento puro, path vuoto,
/// `..` che esce dalla radice).
///
/// Il risultato è un path **letterale** (caso e estensione come li ha scritti
/// l'utente): la normalizzazione la fa chi indicizza, che è il grafo.
pub fn resolve_against(src: &DocId, raw: &str) -> Option<String> {
    let (path, _) = split_fragment(raw);
    let path = percent_decode(path.trim());
    if path.is_empty() {
        return None;
    }
    let (base, rest) = match path.strip_prefix('/') {
        // `/note/a.md` — dalla radice del vault. Non è il filesystem: la radice
        // è il vault, e un link assoluto vero (`file:///…`) è un `Url`.
        Some(rest) => (Vec::new(), rest),
        None => (parent_segments(src), path.as_str()),
    };
    let mut segments = base;
    for seg in rest.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                // Fuori dal vault non c'è niente da collegare.
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    if segments.is_empty() {
        return None;
    }
    Some(segments.join("/"))
}

/// `to` scritto come destinazione di un link markdown dentro `src`: path
/// relativo alla cartella di `src`, con i `../` che servono, percent-encoded.
///
/// L'estensione c'è **sempre**, anche se il link riscritto non ce l'aveva: un
/// path senza estensione è ambiguo per costruzione (`nota.md` e `nota.txt`
/// condividono la chiave) e riscrivere un link significa garantire che dopo
/// punti ancora dove puntava.
pub fn relative_ref(src: &DocId, to: &DocId) -> String {
    let from_dir = parent_segments(src);
    let to_segments: Vec<&str> = to.as_str().split('/').filter(|s| !s.is_empty()).collect();
    let common = from_dir
        .iter()
        .zip(to_segments.iter())
        // L'ultimo segmento di `to` è il file: non può contare come cartella
        // in comune nemmeno se si chiama come una.
        .take(to_segments.len().saturating_sub(1))
        .take_while(|(a, b)| a == b)
        .count();
    let mut out = String::new();
    for _ in common..from_dir.len() {
        out.push_str("../");
    }
    out.push_str(&to_segments[common..].join("/"));
    // Un link che comincia col nome di una cartella è relativo; uno che
    // comincia con `../` pure. Nessuno dei due ha bisogno di `./`.
    percent_encode_path(&out)
}

/// I segmenti della cartella che contiene `id`.
fn parent_segments(id: &DocId) -> Vec<&str> {
    let s = id.as_str();
    let cut = s.rfind('/').map_or(0, |the| the);
    s[..cut].split('/').filter(|p| !p.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(src: &str, raw: &str) -> Option<String> {
        resolve_against(&DocId::new(src), raw)
    }

    #[test]
    fn relative_to_the_folder_of_the_source() {
        assert_eq!(
            resolve("a.md", "note/altra.md").as_deref(),
            Some("note/altra.md")
        );
        assert_eq!(
            resolve("sub/a.md", "altra.md").as_deref(),
            Some("sub/altra.md")
        );
        assert_eq!(
            resolve("sub/deep/a.md", "../altra.md").as_deref(),
            Some("sub/altra.md")
        );
        assert_eq!(resolve("sub/a.md", "./b.md").as_deref(), Some("sub/b.md"));
    }

    #[test]
    fn leading_slash_is_the_vault_root() {
        assert_eq!(
            resolve("sub/deep/a.md", "/note/altra.md").as_deref(),
            Some("note/altra.md")
        );
    }

    #[test]
    fn escaping_the_vault_resolves_to_nothing() {
        assert_eq!(resolve("a.md", "../fuori.md"), None);
        assert_eq!(resolve("sub/a.md", "../../fuori.md"), None);
    }

    #[test]
    fn fragments_and_empty_targets() {
        assert_eq!(resolve("a.md", "#heading"), None);
        assert_eq!(resolve("a.md", ""), None);
        assert_eq!(resolve("a.md", "b.md#h").as_deref(), Some("b.md"));
        assert_eq!(split_fragment("b.md#h^x"), ("b.md", "#h^x"));
    }

    #[test]
    fn percent_encoding_round_trip() {
        assert_eq!(
            resolve("a.md", "nota%20uno.md").as_deref(),
            Some("nota uno.md")
        );
        assert_eq!(percent_decode("100%%").as_str(), "100%%");
        assert_eq!(percent_encode_path("sub/nota uno.md"), "sub/nota%20uno.md");
        assert_eq!(percent_encode_path("f(x).md"), "f%28x%29.md");
        assert_eq!(percent_encode_path("Città.md"), "Città.md");
    }

    #[test]
    fn relative_ref_walks_up_and_down() {
        let r = |src: &str, to: &str| relative_ref(&DocId::new(src), &DocId::new(to));
        assert_eq!(r("a.md", "note/altra.md"), "note/altra.md");
        assert_eq!(r("note/a.md", "altra.md"), "../altra.md");
        assert_eq!(r("x/y/a.md", "x/z/altra.md"), "../z/altra.md");
        assert_eq!(r("x/a.md", "x/altra.md"), "altra.md");
        assert_eq!(r("a.md", "a.md"), "a.md");
        assert_eq!(r("x/a.md", "x/nota uno.md"), "nota%20uno.md");
    }

    #[test]
    fn a_folder_named_like_the_file_is_not_a_common_prefix() {
        // `x/note` (cartella) e `x/note` (file) non sono la stessa cosa: senza
        // la `take` sul penultimo segmento il link diventerebbe vuoto.
        let r = relative_ref(&DocId::new("x/note/a.md"), &DocId::new("x/note"));
        assert_eq!(r, "../note");
    }

    #[test]
    fn the_resolution_key_folds_case_and_composition() {
        // Il caso che rende la regola non banale: `é` scritto come un code
        // point solo (NFC) e come `e` + accento combinante (NFD, che è come
        // macOS scrive i nomi file) devono dare la stessa chiave.
        assert_eq!(resolution_key("  Café  "), resolution_key("cafe\u{0301}"));
        assert_eq!(resolution_key("Café"), "café");
    }

    #[test]
    fn strip_ext_only_looks_at_the_last_segment() {
        assert_eq!(strip_ext("note/v1.2.md"), "note/v1.2");
        assert_eq!(strip_ext("note/senza-estensione"), "note/senza-estensione");
        // Il punto sta in una cartella: non è un'estensione.
        assert_eq!(strip_ext("v1.2/nota"), "v1.2/nota");
    }
}
