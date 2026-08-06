//! Serializzazione modello → markdown: **generazione, non round-trip**.
//!
//! La fonte di verità di un documento esistente è la sua sorgente sul disco;
//! il modello è lossy per costruzione (stile di enfasi, spaziature,
//! indentazione), quindi la fedeltà round-trip integrale è irraggiungibile e
//! non è l'obiettivo. Questo serializer genera documenti **nuovi** (template,
//! "crea nota") e frammenti; le modifiche programmatiche a un documento
//! esistente si fanno come patch chirurgiche sulla sorgente guidate dagli
//! `Span` (vedi il contratto: `FormatProvider::serialize`). Il frontmatter
//! mantiene l'ordine delle chiavi (`serde_json` con `preserve_order`).
//!
//! # «Lossy per costruzione» non vuol dire «può cancellare»
//!
//! Le due cose si somigliano abbastanza da essere state confuse in questo file
//! per tutta la sua vita, e la differenza è tutta qui:
//!
//! - **lossy** è riscrivere `_corsivo_` come `*corsivo*`, o perdere l'indentazione
//!   che l'utente aveva scelto: la *forma* cambia, il contenuto no;
//! - **cancellare** è scrivere `niente` al posto di qualcosa che l'utente ha
//!   scritto — un blocco HTML, un `^id` di blocco, il testo dentro una sintassi
//!   che non conosciamo.
//!
//! La prima è dichiarata e va bene. La seconda non era dichiarata da nessuna
//! parte, e succedeva in **nove** punti misurati.
//!
//! La regola che questo modulo applica adesso, e che il ramo del frontmatter
//! applicava da solo: **ciò che non si sa scrivere risale** — un `Err` che
//! arriva a chi ha chiesto la scrittura — e **ciò che si sa scrivere si
//! scrive**, delimitatori e ancore comprese. Non c'è un terzo caso; in
//! particolare non c'è il caso «si scrive niente e non lo dice nessuno», che
//! era il difetto.
//!
//! Perché non esiste un degrado buono, qui: `render.rs` degrada un inline che
//! non conosce mostrandone il testo dentro uno `<span>`, ed è la scelta giusta
//! **là**, perché l'HTML è una proiezione e perderci qualcosa costa una
//! visualizzazione. Qui si scrive **la sorgente**: un `==evidenziato==` riscritto
//! come `evidenziato` non è una resa degradata, è il file dell'utente che torna
//! dal disco senza la sua sintassi. E i delimitatori non si possono indovinare —
//! appartengono alla `SyntaxRule` che li ha agganciati, che il provider non
//! conosce (§3.1). Chi non li conosce non è autorizzato a inventarli né a
//! buttarli: si ferma e lo dice.

use fub_abi::model::{
    custom_kind, Block, ColumnAlign, DocumentModel, Inline, LinkTarget, TableRow,
};
use fub_abi::FormatError;

/// # Ciò che non si sa scrivere **risale**, non sparisce
///
/// Questa funzione ha un solo modo di sbagliare in modo interessante: avere in
/// mano qualcosa che il markdown non sa esprimere. Fino alla riparazione di
/// questo difetto quel caso era un ramo muto — `if let Ok(yaml)` sul
/// frontmatter — e il risultato era una sorgente **valida e incompleta**, cioè
/// la peggiore delle due: chi la scriveva sul disco non aveva niente da
/// guardare, e il frontmatter era già perso. Da qui in poi il fallimento è un
/// `Err` che arriva a chi ha chiesto la scrittura.
pub fn serialize(model: &DocumentModel) -> Result<String, FormatError> {
    let mut out = String::new();
    if !model.frontmatter.is_empty() {
        let yaml = serde_yaml_ng::to_string(&model.frontmatter.0).map_err(|e| {
            FormatError::Serialize(format!(
                "il frontmatter non si è potuto scrivere in YAML: {e}"
            ))
        })?;
        out.push_str("---\n");
        out.push_str(&yaml);
        out.push_str("---\n\n");
    }
    for (i, block) in model.body.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        write_block(block, &mut out)?;
    }
    Ok(out)
}

/// L'errore di chi ha in mano un nodo che questo formato non sa esprimere.
///
/// Sta in una funzione sola perché la frase è la stessa in cinque punti, e
/// perché è **la** frase di questo modulo: dice cosa non si è scritto e perché
/// nessuno l'ha scritto al posto suo.
fn non_esprimibile(cosa: &str, kind: &str) -> FormatError {
    FormatError::Serialize(format!(
        "questo formato non sa scrivere {cosa} `{kind}`: i delimitatori che lo \
         producono appartengono alla regola che l'ha agganciato, non al provider. \
         Scriverne solo il contenuto cancellerebbe una sintassi dal file, e \
         scrivere niente cancellerebbe anche il contenuto."
    ))
}

/// Il testo di un `attrs`, o l'errore che dice quale chiave mancava.
///
/// Un kind del registro dichiara la forma dei propri `attrs`
/// ([`custom_kind`]); quando quella forma non c'è, il contenuto **non è
/// ricostruibile da nient'altro**, ed è lo stesso caso del frontmatter
/// verbatim: il giro si ferma qui invece di produrre una sorgente amputata che
/// sembra intera.
fn attr_richiesto<'a>(
    attrs: &'a serde_json::Value,
    chiave: &str,
    kind: &str,
) -> Result<&'a str, FormatError> {
    attrs.get(chiave).and_then(|v| v.as_str()).ok_or_else(|| {
        FormatError::Serialize(format!(
            "un nodo `{kind}` senza `attrs.{chiave}` non ha una sorgente da riscrivere"
        ))
    })
}

/// L'ancora esplicita in coda al blocco: `^abc123`.
///
/// **Prima non si scriveva affatto**, in nessuna delle sette varianti di
/// `Block`, e non era una scelta di stile: un `^id` è l'indirizzo con cui
/// *altre note* puntano dentro questa (`[[Nota#^abc123]]`, embed di blocco), e
/// riscrivere il file senza toglie il bersaglio ai link degli altri. È la sola
/// perdita di questo file che si vede da fuori del documento.
///
/// La forma è quella in coda alla riga, che è ciò che
/// `parse::trailing_anchor` legge: il `^` preceduto da uno spazio. La forma su
/// riga propria non va bene per tutti i blocchi — dopo un elenco diventa una
/// continuazione pigra della voce.
///
/// Gli heading non passano di qui: la loro `anchor` è lo **slug generato** dal
/// testo, non un id che l'utente ha scritto, e riscriverlo lo trasformerebbe in
/// un'ancora esplicita che nel file non c'era.
fn write_anchor(anchor: &Option<String>, out: &mut String) {
    let Some(id) = anchor else {
        return;
    };
    while out.ends_with('\n') {
        out.pop();
    }
    out.push(' ');
    out.push('^');
    out.push_str(id);
    out.push('\n');
}

/// I `match` di questo modulo non hanno `..`: ogni campo è nominato.
///
/// È il presidio più economico che esista per la classe di difetto che questo
/// file aveva — un campo del modello che nessuno scrive — perché non è un test:
/// è il compilatore. Il giorno in cui `Block` o `Inline` guadagnano un campo,
/// questa funzione **non compila**, e chi lo aggiunge deve decidere se si
/// scrive. Con `..` quel campo sarebbe nato perso in silenzio, che è
/// esattamente com'era nata `anchor`.
fn write_block(block: &Block, out: &mut String) -> Result<(), FormatError> {
    match block {
        Block::Heading {
            level,
            inlines,
            anchor: _,
            span: _,
        } => {
            out.push_str(&"#".repeat((*level).clamp(1, 6) as usize));
            out.push(' ');
            write_inlines(inlines, out)?;
            out.push('\n');
        }
        Block::Paragraph {
            inlines,
            anchor,
            span: _,
        } => {
            write_inlines(inlines, out)?;
            out.push('\n');
            write_anchor(anchor, out);
        }
        Block::List {
            ordered,
            items,
            anchor,
            span: _,
        } => {
            for (i, item) in items.iter().enumerate() {
                let marcatore = if *ordered {
                    format!("{}. ", i + 1)
                } else {
                    "- ".to_string()
                };
                out.push_str(&marcatore);
                // Il marcatore si riscrive col **simbolo che aveva**: uno stato
                // personalizzato (`[/]`, `[-]`) che tornasse `[x]` o `[ ]` sarebbe
                // una perdita silenziosa, e la lista degli stati non è chiusa.
                if let Some(t) = &item.task {
                    out.push('[');
                    out.push(t.symbol.unwrap_or(' '));
                    out.push_str("] ");
                }
                let mut inner = String::new();
                for b in &item.blocks {
                    write_block(b, &mut inner)?;
                }
                // Le righe dopo la prima si rientrano sotto il marcatore. Senza
                // questo, un elenco annidato usciva **appiattito** — `- a` e
                // `- b` fratelli dove `b` era figlio di `a` — e la struttura che
                // l'utente aveva scritto spariva dal file senza che niente
                // fallisse: la stessa specie di perdita del resto del modulo,
                // con la forma al posto del testo.
                let rientro = " ".repeat(marcatore.len());
                for (n, riga) in inner.trim_end().lines().enumerate() {
                    if n > 0 {
                        out.push('\n');
                        if !riga.is_empty() {
                            out.push_str(&rientro);
                        }
                    }
                    out.push_str(riga);
                }
                out.push('\n');
            }
            write_anchor(anchor, out);
        }
        Block::Table {
            head,
            rows,
            align,
            anchor,
            span: _,
        } => {
            let columns = head
                .iter()
                .chain(rows.iter())
                .map(|r| r.cells.len())
                .max()
                .unwrap_or(0);
            let write_row = |row: &TableRow, out: &mut String| -> Result<(), FormatError> {
                out.push('|');
                for i in 0..columns {
                    out.push(' ');
                    if let Some(c) = row.cells.get(i) {
                        write_inlines(&c.inlines, out)?;
                    }
                    out.push_str(" |");
                }
                out.push('\n');
                Ok(())
            };
            // La riga di separazione è obbligatoria in GFM: una tabella senza
            // intestazione si genera con un'intestazione vuota, o non è una
            // tabella quando la si rilegge.
            match head {
                Some(h) => write_row(h, out)?,
                None => write_row(&TableRow { cells: Vec::new() }, out)?,
            }
            out.push('|');
            for i in 0..columns {
                out.push_str(match align.get(i).copied().unwrap_or(ColumnAlign::None) {
                    ColumnAlign::None => " --- |",
                    ColumnAlign::Left => " :-- |",
                    ColumnAlign::Center => " :-: |",
                    ColumnAlign::Right => " --: |",
                });
            }
            out.push('\n');
            for r in rows {
                write_row(r, out)?;
            }
            write_anchor(anchor, out);
        }
        Block::CodeBlock {
            lang,
            code,
            anchor,
            span: _,
        } => {
            // Il recinto è lungo almeno tre, e più lungo della più lunga fila di
            // backtick che il codice contiene: un blocco che ne contiene uno da
            // tre si richiuderebbe a metà, e la seconda metà tornerebbe prosa.
            let fence = "`".repeat(3.max(fila_massima(code, '`') + 1));
            out.push_str(&fence);
            if let Some(l) = lang {
                out.push_str(l);
            }
            out.push('\n');
            out.push_str(code);
            if !code.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(&fence);
            out.push('\n');
            write_anchor(anchor, out);
        }
        Block::Quote {
            blocks,
            anchor,
            span: _,
        } => {
            let mut inner = String::new();
            for b in blocks {
                write_block(b, &mut inner)?;
            }
            for line in inner.trim_end().lines() {
                // `"> "` su una riga vuota lascerebbe uno spazio in coda, che è
                // ciò che ogni linter di questo repo toglie a mano.
                out.push_str(if line.is_empty() { ">" } else { "> " });
                out.push_str(line);
                out.push('\n');
            }
            write_anchor(anchor, out);
        }
        Block::ThematicBreak { anchor, span: _ } => {
            out.push_str("---\n");
            write_anchor(anchor, out);
        }
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            anchor,
            span: _,
        } => {
            write_custom_block(custom_kind, attrs, blocks, out)?;
            write_anchor(anchor, out);
        }
    }
    Ok(())
}

/// I `custom_kind` che **questo** formato sa scrivere, e l'errore per tutti gli
/// altri.
///
/// L'elenco non è arbitrario: sono i kind che il parser markdown *produce da
/// solo* (`parse.rs`), cioè quelli di cui il provider conosce la sintassi
/// perché è lui ad averla letta. Un kind che arriva da una `SyntaxRule` —
/// `math`, `diagram`, `terzi:qualunque` — non è in questo elenco per
/// costruzione, e per una ragione che non è pigrizia: il recinto ```` ```math ````
/// che lo ha prodotto è un'informazione della regola, e la regola può averlo
/// trasformato. Riscriverlo a indovinare sarebbe inventare la sorgente
/// dell'utente.
fn write_custom_block(
    kind: &str,
    attrs: &serde_json::Value,
    blocks: &[Block],
    out: &mut String,
) -> Result<(), FormatError> {
    if kind == custom_kind::FRONTMATTER_UNPARSED {
        // Il frontmatter che il parser non ha capito torna **verbatim**,
        // delimitatori compresi. Se il testo non c'è non si può ricostruire da
        // nient'altro — gli `attrs` sono tutto ciò che questo blocco è.
        out.push_str(attr_richiesto(attrs, "text", kind)?);
    } else if kind == custom_kind::HTML {
        // L'HTML grezzo è **testo dell'utente**, e usciva di qui come niente:
        // `blocks` è vuoto per costruzione (`parse.rs` lo mette tutto negli
        // `attrs`), quindi il ramo generico «scrivi i figli» scriveva zero
        // byte. Un `<div>` e un `<!-- commento -->` sparivano dal file al primo
        // giro, ed è la perdita che il corpus misura.
        let html = attr_richiesto(attrs, "html", kind)?;
        out.push_str(html);
        if !html.ends_with('\n') {
            out.push('\n');
        }
    } else if kind == custom_kind::FOOTNOTE_DEFINITION {
        let label = attr_richiesto(attrs, "label", kind)?;
        let mut inner = String::new();
        for b in blocks {
            write_block(b, &mut inner)?;
        }
        out.push_str(&format!("[^{label}]: {}\n", inner.trim()));
    } else if kind == custom_kind::CALLOUT {
        let ty = attrs.get("type").and_then(|v| v.as_str()).unwrap_or("note");
        out.push_str(&format!("> [!{ty}]\n"));
        let mut inner = String::new();
        for b in blocks {
            write_block(b, &mut inner)?;
        }
        for line in inner.trim_end().lines() {
            out.push_str(if line.is_empty() { ">" } else { "> " });
            out.push_str(line);
            out.push('\n');
        }
    } else if kind == custom_kind::DEFINITION_LIST || kind == custom_kind::DEFINITION_TERM {
        // Il termine è la sua riga; la lista è la sequenza dei suoi figli.
        for b in blocks {
            write_block(b, out)?;
        }
    } else if kind == custom_kind::DEFINITION_DESCRIPTION {
        // `: ` è la sintassi che la rende una descrizione. Senza, la riga
        // tornava un paragrafo qualunque e la definition list si scioglieva.
        let mut inner = String::new();
        for b in blocks {
            write_block(b, &mut inner)?;
        }
        for line in inner.trim_end().lines() {
            out.push_str(": ");
            out.push_str(line);
            out.push('\n');
        }
    } else if kind == custom_kind::BLOCK {
        // L'ultima spiaggia del parser: un blocco che non sa nominare ma di cui
        // ha ricostruito i **figli**, e allora i figli sono tutto ciò che c'è.
        // È l'unico caso in cui scrivere i soli figli non perde niente, perché
        // non c'è nient'altro: `attrs` è `Null` per costruzione.
        for b in blocks {
            write_block(b, out)?;
        }
    } else {
        return Err(non_esprimibile("il blocco", kind));
    }
    Ok(())
}

/// La fila più lunga di `c` dentro `s`. Serve ai recinti e al codice inline:
/// il delimitatore deve essere più lungo di ciò che delimita.
fn fila_massima(s: &str, c: char) -> usize {
    let mut max = 0;
    let mut corrente = 0;
    for ch in s.chars() {
        if ch == c {
            corrente += 1;
            max = max.max(corrente);
        } else {
            corrente = 0;
        }
    }
    max
}

fn write_inlines(inlines: &[Inline], out: &mut String) -> Result<(), FormatError> {
    for inline in inlines {
        write_inline(inline, out)?;
    }
    Ok(())
}

/// **Torna un `Result`, e prima non lo faceva.**
///
/// È la radice strutturale del difetto, ed è lo stesso argomento con cui
/// `serialize` era diventata fallibile: una funzione che non può fallire
/// davanti a qualcosa che non sa scrivere ha *un solo* comportamento
/// disponibile, ed è saltarlo in silenzio. Il ramo `Inline::Custom { .. } => {}`
/// non era una svista da cambiare in una riga: era l'unica cosa che quella
/// firma permettesse di scrivere.
fn write_inline(inline: &Inline, out: &mut String) -> Result<(), FormatError> {
    match inline {
        Inline::Text(s) => out.push_str(s),
        Inline::Emph(children) => {
            out.push('*');
            write_inlines(children, out)?;
            out.push('*');
        }
        Inline::Strong(children) => {
            out.push_str("**");
            write_inlines(children, out)?;
            out.push_str("**");
        }
        Inline::Code(s) => {
            // Il delimitatore è più lungo della più lunga fila di backtick che
            // il codice contiene, e ci mette gli spazi di cortesia quando il
            // codice comincia o finisce con un backtick — è la regola di
            // CommonMark. Prima era un backtick fisso: `` `a ` b` `` usciva
            // come codice `a` seguito da del testo, cioè il contenuto
            // dell'utente riscritto in qualcos'altro.
            let fence = "`".repeat(fila_massima(s, '`') + 1);
            out.push_str(&fence);
            let padding = s.starts_with('`') || s.ends_with('`');
            if padding {
                out.push(' ');
            }
            out.push_str(s);
            if padding {
                out.push(' ');
            }
            out.push_str(&fence);
        }
        Inline::TagRef { name, span: _ } => {
            out.push('#');
            out.push_str(name);
        }
        Inline::Link {
            target,
            label,
            embed,
            span: _,
        } => write_link(target, label.as_deref(), *embed, out)?,
        Inline::Custom {
            custom_kind,
            attrs,
            span: _,
        } if custom_kind == custom_kind::FOOTNOTE_REFERENCE => {
            // `unwrap_or` qui riscriverebbe il richiamo di una nota **con
            // l'etichetta di un'altra**, e saltarlo lo cancellerebbe: nessuna
            // delle due è una scrittura.
            let label = attr_richiesto(attrs, "label", custom_kind)?;
            out.push_str(&format!("[^{label}]"));
        }
        Inline::Custom {
            custom_kind,
            attrs: _,
            span: _,
        } => return Err(non_esprimibile("l'inline", custom_kind)),
    }
    Ok(())
}

fn write_link(
    target: &LinkTarget,
    label: Option<&[Inline]>,
    embed: bool,
    out: &mut String,
) -> Result<(), FormatError> {
    if embed {
        out.push('!');
    }
    match target {
        LinkTarget::Wiki {
            page,
            heading,
            block,
        } => {
            out.push_str("[[");
            out.push_str(page);
            if let Some(h) = heading {
                out.push('#');
                out.push_str(h);
            }
            if let Some(b) = block {
                out.push('^');
                out.push_str(b);
            }
            if let Some(inlines) = label {
                let mut lbl = String::new();
                write_inlines(inlines, &mut lbl)?;
                if lbl != *page {
                    out.push('|');
                    out.push_str(&lbl);
                }
            }
            out.push_str("]]");
        }
        LinkTarget::Url(url) | LinkTarget::Path(url) => {
            out.push('[');
            if let Some(inlines) = label {
                write_inlines(inlines, out)?;
            }
            out.push_str("](");
            out.push_str(url);
            out.push(')');
        }
    }
    Ok(())
}
