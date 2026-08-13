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
    custom_kind, custom_kind::Carico, Block, ColumnAlign, DocumentModel, Inline, LinkTarget,
    TableRow,
};
use fub_abi::rules::tag::scan_tags;
use fub_abi::FormatError;

use crate::util::{disescapa, fila_massima};

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
    // **La condizione è «c'era», non «dice qualcosa».** Era `!is_empty()`, e
    // così un frontmatter presente e senza chiavi — le due righe di
    // delimitatori che si scrivono per dire «i metadati li compilo dopo» —
    // rientrava dal giro cancellato: la mappa vuota di un file che ce l'ha e
    // quella di un file che non ce l'ha sono la stessa mappa, e a distinguerle
    // è `frontmatter_present`.
    if model.frontmatter_present || !model.frontmatter.is_empty() {
        out.push_str("---\n");
        if model.frontmatter.is_empty() {
            // **La riga vuota non è impaginazione**: `---\n---` in testa a un
            // file non è un frontmatter vuoto per il lettore che lo rileggerà,
            // sono due righe orizzontali. Fra i due delimitatori ci va almeno
            // una riga, e quella riga è ciò che rende il blocco riconoscibile
            // al giro dopo.
            out.push('\n');
        } else {
            let yaml = serde_yaml_ng::to_string(&model.frontmatter.0).map_err(|e| {
                FormatError::Serialize(format!(
                    "il frontmatter non si è potuto scrivere in YAML: {e}"
                ))
            })?;
            out.push_str(&yaml);
        }
        out.push_str("---\n");
        // La riga vuota separa il frontmatter dal corpo, non è parte del
        // frontmatter: senza corpo aggiungerebbe un byte a ogni generazione.
        if !model.body.is_empty() {
            out.push('\n');
        }
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
/// `parse::trailing_anchor` legge: il `^` preceduto da uno spazio.
///
/// **Va bene per un paragrafo e per nient'altro**, ed è il difetto che
/// [`write_anchor_a_capo`] chiude: un paragrafo ha una coda di testo dove
/// scrivere l'ancora, gli altri sei blocchi hanno in coda un *delimitatore*, e
/// appendere ` ^id` a un delimitatore lo rompe. Misurato sul giro completo,
/// blocco per blocco:
///
/// | blocco | usciva | cosa succedeva al giro dopo |
/// |---|---|---|
/// | tabella | `\| 1 \| 2 \| ^tab` | la cella in più si butta: **l'ancora sparisce** |
/// | codice | ``` ``` ^cod ``` | il recinto non chiude più: `^cod` **entra nel codice** |
/// | riga | `--- ^hr` | non è più una riga orizzontale: diventa un paragrafo |
/// | elenco, citazione, callout | `- b ^lis`, `> citata ^cit` | l'id resta, ma indirizza il **figlio** invece del contenitore |
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

/// L'ancora esplicita su **riga propria**, dopo una riga vuota: la forma con
/// cui si indirizza un blocco che in coda non ha del testo.
///
/// È la stessa forma che il parser dichiara — «l'ancora su riga propria (`^abc`
/// da solo, subito dopo un blocco) è la sola forma con cui si indirizza un
/// contenitore» — e che rilegge da `lone_anchor`: un paragrafo di sola ancora
/// non resta un blocco, si attacca a quello che lo precede.
///
/// **La riga vuota è obbligatoria** e non è impaginazione: senza, dopo un
/// elenco il `^abc` è una continuazione pigra dell'ultima voce e finisce
/// *dentro* di essa. Con la riga vuota è un blocco a sé, ed è la condizione da
/// cui `lone_anchor` lo riconosce.
fn write_anchor_a_capo(anchor: &Option<String>, out: &mut String) {
    let Some(id) = anchor else {
        return;
    };
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push('\n');
    out.push('^');
    out.push_str(id);
    out.push('\n');
}

/// I blocchi di un contenitore, **separati dalla riga vuota che li tiene
/// distinti**.
///
/// È la stessa regola del giro principale in [`serialize`] — fra un blocco e il
/// successivo ci va una riga vuota — e finora la applicava **solo** quello: i
/// cinque contenitori (la definizione di una nota a piè di pagina, il callout,
/// la citazione, la descrizione di una definition list, la voce d'elenco)
/// concatenavano i figli senza separatore, e al giro dopo due paragrafi
/// rientravano **come uno**. La perdita non è di forma: due paragrafi fusi sono
/// un blocco che non c'era, e ciò che stava dentro il secondo — un elenco, un
/// blocco di codice — smette di essere sé stesso.
///
/// Sta in una funzione perché la regola è una: chi aggiunge il sesto
/// contenitore la eredita chiamando questa invece di riscrivere il `for`.
fn blocchi_in_stringa(blocks: &[Block]) -> Result<String, FormatError> {
    let mut inner = String::new();
    for (i, b) in blocks.iter().enumerate() {
        if i > 0 {
            inner.push('\n');
        }
        write_block(b, &mut inner)?;
    }
    Ok(inner)
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
            start,
        } => {
            // **Il numero di partenza è quello del documento**, non `1`: una
            // lista che comincia da 3 riprende una lista interrotta, e
            // riportarla a 1 fa dire al file riscritto una cosa diversa da
            // quella che il file letto diceva. `1` resta il ripiego per un
            // ordinato che arriva da un generatore senza numero.
            let primo = start.unwrap_or(1);
            for (i, item) in items.iter().enumerate() {
                let marcatore = if *ordered {
                    format!("{}. ", primo as u64 + i as u64)
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
                let inner = blocchi_in_stringa(&item.blocks)?;
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
            write_anchor_a_capo(anchor, out);
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
                    // **La cella si scrive a parte per via del `|`.** In GFM la
                    // barra verticale è il delimitatore, e l'unico modo di
                    // averne una *dentro* una cella è `\|`: il testo la porta
                    // nuda (il parser l'ha già disescapata) e un alias di
                    // wikilink ne scrive una sua. Scritta nuda, la riga guadagna
                    // una colonna che la riga di separazione non ha — misurato
                    // su `| a \| b | c |`, che al primo giro diventa una tabella
                    // di tre celle su due, e al secondo **non è più una
                    // tabella**.
                    //
                    // Il buffer comincia con lo spazio che separa dalla barra
                    // perché `scrivi_testo` legge lì se è a inizio riga: un
                    // buffer vuoto direbbe di sì, e un `-` in testa alla cella
                    // si prenderebbe una barra rovescia che non gli serve.
                    let mut cella = String::from(" ");
                    if let Some(c) = row.cells.get(i) {
                        write_inlines(&c.inlines, &mut cella)?;
                    }
                    out.push_str(&cella.replace('|', "\\|"));
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
            write_anchor_a_capo(anchor, out);
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
            write_anchor_a_capo(anchor, out);
        }
        Block::Quote {
            blocks,
            anchor,
            span: _,
        } => {
            let inner = blocchi_in_stringa(blocks)?;
            for line in inner.trim_end().lines() {
                // `"> "` su una riga vuota lascerebbe uno spazio in coda, che è
                // ciò che ogni linter di questo repo toglie a mano.
                out.push_str(if line.is_empty() { ">" } else { "> " });
                out.push_str(line);
                out.push('\n');
            }
            write_anchor_a_capo(anchor, out);
        }
        Block::ThematicBreak { anchor, span: _ } => {
            out.push_str("---\n");
            write_anchor_a_capo(anchor, out);
        }
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            anchor,
            span: _,
        } => {
            write_custom_block(custom_kind, attrs, blocks, out)?;
            write_anchor_a_capo(anchor, out);
        }
        Block::ReferenceDefinition {
            label,
            url,
            title,
            anchor,
            span: _,
        } => {
            // La forma normalizzata: `[etichetta]: url "titolo"`. La
            // destinazione è quella **nuda** (parse toglie le `<…>`), il
            // titolo si scrive fra doppi apici con gli escape di `"` e `\` —
            // qualunque delimitatore l'utente avesse scelto, la riga resta
            // una definizione valida per comrak.
            out.push('[');
            out.push_str(label);
            out.push_str("]: ");
            // La destinazione nuda con spazi o parentesi andrebbe in frantumi
            // al ri-parse: la forma `<…>` resta la stessa destinazione.
            scrivi_destinazione(url, out);
            if let Some(t) = title {
                out.push_str(" \"");
                for c in t.chars() {
                    if c == '"' || c == '\\' {
                        out.push('\\');
                    }
                    out.push(c);
                }
                out.push('"');
            }
            out.push('\n');
            write_anchor_a_capo(anchor, out);
        }
    }
    Ok(())
}

/// I `custom_kind` che **questo** formato sa scrivere, e l'errore per tutti gli
/// altri.
///
/// **Due metà, e solo la prima è di markdown.**
///
/// La prima sono i kind che hanno una sintassi *di questa grammatica*: `> [!x]`,
/// `[^etichetta]: …`, la riga che comincia per `: `. Sono tre `if`, e tre `if`
/// devono restare: nessun altro formato le scriverebbe così, e un provider
/// org-mode o textile qui ci mette le sue.
///
/// La seconda era una catena di `if` sui kind — cioè lo stesso elenco che il
/// contratto tiene in [`custom_kind::CARICHI`], riscritto come flusso di
/// controllo e non interrogabile da nessuno. Adesso è il contratto a
/// rispondere, e la risposta è **indipendente dal formato**:
///
/// - [`Carico::Sorgente`] — i byte *sono già* la sorgente, delimitatori
///   compresi. Si copiano. Ci cadono l'HTML grezzo — che usciva di qui come
///   niente, perché `blocks` è vuoto per costruzione e il ramo generico
///   «scrivi i figli» scriveva zero byte, ed è la perdita che il corpus misura
///   — e il frontmatter che il parser non ha capito.
/// - [`Carico::Figli`] — il contenuto sta nei figli, e scriverli non perde
///   niente perché non c'è nient'altro.
/// - [`Carico::Corpo`] — byte dell'utente **senza il loro delimitatore**:
///   `math`, `diagram`, e ogni kind che arrivi da una `SyntaxRule`. Non è
///   pigrizia che non si scrivano: il recinto che li ha prodotti è
///   un'informazione della regola, e la regola può averlo trasformato.
/// - non dichiarato — un kind di terzi. Stessa risposta, per la stessa ragione.
fn write_custom_block(
    kind: &str,
    attrs: &serde_json::Value,
    blocks: &[Block],
    out: &mut String,
) -> Result<(), FormatError> {
    // --- la metà che è di markdown ------------------------------------------
    if kind == custom_kind::FOOTNOTE_DEFINITION {
        let label = attr_richiesto(attrs, "label", kind)?;
        let inner = blocchi_in_stringa(blocks)?;
        // **Una definizione su più blocchi resta su più blocchi.** Prima era
        // `inner.trim()` dentro una riga sola: i paragrafi, gli elenchi e i
        // blocchi di codice della definizione uscivano fusi in una riga, e ciò
        // che rientrava non era ciò che era uscito. La continuazione di una
        // nota a piè di pagina si rientra di quattro spazi — è la stessa forma
        // del rientro sotto il marcatore di una voce d'elenco, e senza, la
        // seconda riga esce dalla definizione e torna un blocco del documento.
        out.push_str(&format!("[^{label}]:"));
        for (n, riga) in inner.trim_end().lines().enumerate() {
            if n > 0 {
                out.push('\n');
            }
            if !riga.is_empty() {
                out.push_str(if n == 0 { " " } else { "    " });
                out.push_str(riga);
            }
        }
        out.push('\n');
        return Ok(());
    }
    if kind == custom_kind::CALLOUT {
        let ty = attrs.get("type").and_then(|v| v.as_str()).unwrap_or("note");
        // **Il titolo sta negli `attrs`, e non è nei figli.** `> [!warning]
        // Attenzione` dava `title: "Attenzione"` e blocchi `[corpo]`: chi
        // scriveva solo `> [!warning]` non appiattiva il titolo dentro il
        // corpo, lo **cancellava dal file** — e `render.rs` intanto lo mostrava
        // (`callout-title`), quindi la stessa nota aveva un titolo in anteprima
        // e nessuno sul disco.
        let title = attrs.get("title").and_then(|v| v.as_str()).unwrap_or("");
        if title.is_empty() {
            out.push_str(&format!("> [!{ty}]\n"));
        } else {
            out.push_str(&format!("> [!{ty}] {title}\n"));
        }
        let inner = blocchi_in_stringa(blocks)?;
        for line in inner.trim_end().lines() {
            out.push_str(if line.is_empty() { ">" } else { "> " });
            out.push_str(line);
            out.push('\n');
        }
        return Ok(());
    }
    if kind == custom_kind::DEFINITION_DESCRIPTION {
        // `: ` è la sintassi che la rende una descrizione. Senza, la riga
        // tornava un paragrafo qualunque e la definition list si scioglieva.
        let inner = blocchi_in_stringa(blocks)?;
        for line in inner.trim_end().lines() {
            out.push_str(": ");
            out.push_str(line);
            out.push('\n');
        }
        return Ok(());
    }

    // --- la metà che è del contratto ----------------------------------------
    match custom_kind::carico(kind) {
        Some(Carico::Sorgente(chiave)) => {
            // Se il testo non c'è non si può ricostruire da nient'altro: gli
            // `attrs` sono tutto ciò che questo blocco è.
            let sorgente = attr_richiesto(attrs, chiave, kind)?;
            out.push_str(sorgente);
            if !sorgente.ends_with('\n') {
                out.push('\n');
            }
        }
        Some(Carico::Figli) => out.push_str(&blocchi_in_stringa(blocks)?),
        Some(Carico::Corpo(_)) | None => return Err(non_esprimibile("il blocco", kind)),
    }
    Ok(())
}

/// La fila più lunga di `c` dentro `s`. Serve ai recinti e al codice inline:
/// il delimitatore deve essere più lungo di ciò che delimita.
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
        Inline::Text(s) => scrivi_testo(s, out),
        Inline::Emph(children) => {
            out.push('*');
            write_inlines(children, out)?;
            out.push('*');
        }
        // L'apice e il barrato si riscrivono con il loro delimitatore: sono
        // costrutti del dialetto (le estensioni `superscript` e `strikethrough`
        // di comrak), e ciascuno ha la sua forma — un `^…^` non è un `~~…~~`,
        // e nessuno dei due è enfasi.
        Inline::Superscript(children) => {
            out.push('^');
            write_inlines(children, out)?;
            out.push('^');
        }
        Inline::Strikethrough(children) => {
            out.push_str("~~");
            write_inlines(children, out)?;
            out.push_str("~~");
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
        // Il resto lo dice il contratto, come per i blocchi: un inline che
        // porta **sorgente** si copia, e tutto ciò che porta il corpo di una
        // sintassi — o che il contratto non dichiara affatto — non si scrive,
        // perché il delimitatore che lo racchiudeva è di chi l'ha agganciato.
        Inline::Custom {
            custom_kind,
            attrs,
            span: _,
        } => match custom_kind::carico(custom_kind) {
            Some(Carico::Sorgente(chiave)) => {
                out.push_str(attr_richiesto(attrs, chiave, custom_kind)?)
            }
            _ => return Err(non_esprimibile("l'inline", custom_kind)),
        },
    }
    Ok(())
}

/// **Il testo del modello riscritto come sorgente**, cioè con le barre rovesce
/// che servono perché rileggendolo torni lo stesso testo.
///
/// # Il testo decodificato non è sorgente
///
/// `Inline::Text` porta il testo **come si legge**: il parser decodifica gli
/// escape di comrak, quindi `\#nontag` arriva qui come `#nontag`. Riscriverlo
/// così com'era — `out.push_str(s)`, che è ciò che questo ramo faceva — non
/// è lossy, è **cambiare il documento**: al giro dopo lo stesso file dice
/// un'altra cosa.
///
/// Le due specie di danno, misurate:
///
/// - **si inventa una feature**: `\#nontag` esce `#nontag`, e `scan_tags` (che è
///   la stessa regola che decide qui) lo rilegge come un tag vero, che entra
///   nell'indice e nel pannello. Lo stesso per `==`, `[[`, `*`, `` ` ``;
/// - **cambia il tipo di blocco**: un paragrafo che comincia col testo `# ...`
///   (da `\# ...`) si riscrive `# ...` e torna un `Block::Heading`. Vale per
///   `>`, `-`, `+`, `1.`, `:` e `|` in testa alla riga: P→H1, P→citazione,
///   P→elenco.
///
/// La seconda specie è la ragione per cui questa funzione guarda `out`: «inizio
/// riga» è una proprietà di **dove si sta scrivendo**, non del testo. Il buffer
/// di una voce d'elenco o di una citazione comincia vuoto, ed è giusto che lì
/// valga come inizio riga — quel `#` un heading lo aprirebbe davvero, dentro la
/// voce.
///
/// # Cosa si escapa, e perché non tutto
///
/// Ogni barra rovescia in più è un byte nel file dell'utente, quindi il criterio
/// non è «tutta la punteggiatura ASCII» ma «questo carattere, **qui**, rileggerebbe
/// come sintassi»: `_` solo fuori da una parola, `<` solo davanti a un nome,
/// `~ = %` solo raddoppiati, `^` solo dove sarebbe un marcatore d'ancora, `#`
/// solo dove [`scan_tags`] prende un tag — che non è una regola somigliante,
/// è **la** regola, chiamata qui perché sia la stessa da tutt'e due i lati.
///
/// La `&` resta fuori di proposito: escaparla riscriverebbe come letterale
/// un'entità che il documento aveva (`&amp;` → `\&amp;`), che è la stessa
/// specie di danno con il segno cambiato.
fn scrivi_testo(s: &str, out: &mut String) {
    let tag: std::collections::HashSet<usize> =
        scan_tags(s).into_iter().map(|t| t.span.start).collect();
    // Nessuno ha ancora scritto su questa riga: un delimitatore di blocco qui
    // aprirebbe un blocco.
    let mut inizio_riga = out.is_empty() || out.ends_with('\n');
    // …e finora ha scritto solo cifre, cioè il `.` che segue aprirebbe un
    // elenco numerato.
    let mut solo_cifre = inizio_riga;
    let mut i = 0;
    while i < s.len() {
        let c = s[i..].chars().next().expect("i è un confine di carattere");
        let dopo = s[i + c.len_utf8()..].chars().next();
        let prima = s[..i].chars().next_back();
        let scappa = match c {
            '\\' | '[' | ']' | '*' | '`' => true,
            // In testa alla riga si escapa **sempre**: `#`, `##`, `###` sono
            // tutti heading, e la regola dei tag non prende `##` (nome vuoto).
            '#' => inizio_riga || tag.contains(&i),
            '_' => {
                !(prima.is_some_and(char::is_alphanumeric)
                    && dopo.is_some_and(char::is_alphanumeric))
            }
            '<' => dopo.is_some_and(|d| d.is_alphanumeric() || "/!?".contains(d)),
            '~' | '=' | '%' => dopo == Some(c),
            '$' => dopo.is_some_and(|d| !d.is_whitespace()),
            '^' => prima.is_none_or(char::is_whitespace) && dopo.is_some_and(char::is_alphanumeric),
            '>' | '-' | '+' | ':' | '|' => inizio_riga,
            '.' | ')' => solo_cifre && i > 0,
            _ => false,
        };
        if scappa {
            out.push('\\');
        }
        out.push(c);
        inizio_riga = inizio_riga && c.is_whitespace();
        solo_cifre = solo_cifre && c.is_ascii_digit();
        i += c.len_utf8();
    }
}

/// La destinazione di un link `[testo](qui)`, **nella forma in cui rileggendola
/// torna la stessa destinazione**.
///
/// Una destinazione nuda in CommonMark non può contenere spazi, caratteri di
/// controllo, `<`, `>`, una barra rovescia, né parentesi tonde spaiate: la forma
/// per tutto il resto sono le **parentesi angolari**, che è la stessa forma da
/// cui il parser l'aveva letta. Scrivendola nuda, `[testo](<file con spazi.md>)`
/// tornava sul disco come `[testo](file con spazi.md)`, che al giro dopo **non è
/// più un link**: il documento riscritto ha perso un arco del grafo, e chi lo
/// rilegge vede del testo fra parentesi.
///
/// Dentro le angolari si escapano `<`, `>` e `\`, cioè i tre soli caratteri che
/// chiuderebbero o storcerebbero la parentesi. Le parentesi tonde **bilanciate**
/// restano nude: sono legali così, ed è la forma che l'utente ha scritto.
fn scrivi_destinazione(url: &str, out: &mut String) {
    if destinazione_nuda(url) {
        out.push_str(url);
        return;
    }
    out.push('<');
    for c in url.chars() {
        if matches!(c, '<' | '>' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('>');
}

/// La destinazione si può scrivere senza le parentesi angolari?
///
/// Il ciclo è scritto a `if` e non a `match` di proposito: un `match` qui
/// vorrebbe il braccio muto `_ => {}` per il carattere ordinario, e
/// `nessun_ramo_muto` (`tests/serialize_non_cancella.rs`) lo legge come una
/// cancellazione silenziosa. Ha ragione a leggerlo così ovunque scriva, e qui
/// non scrive — ma un presidio che deve distinguere i due casi si guarda le
/// eccezioni invece del file, e allora conviene non avere il braccio.
fn destinazione_nuda(url: &str) -> bool {
    if url.is_empty() {
        return false;
    }
    let mut profondita: i32 = 0;
    for c in url.chars() {
        if matches!(c, '<' | '>' | '\\') || c.is_whitespace() || c.is_control() {
            return false;
        }
        if c == '(' {
            profondita += 1;
        }
        if c == ')' {
            profondita -= 1;
            if profondita < 0 {
                return false;
            }
        }
    }
    profondita == 0
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
        // I tre campi si nominano lo stesso, e non è cerimonia: è la regola in
        // testa a `write_block`: un quarto campo di `LinkTarget::Wiki` deve dare
        // `E0027` qui, o nascerebbe perso in silenzio come nacque `anchor`.
        // **Ma a scriverli non è questo file**: la forma testuale di un
        // bersaglio è del contratto ([`LinkTarget::wiki_inner`]), che è il verso
        // opposto di `parse_wikilink_inner` e sta accanto a lui. Finché la
        // scriveva il provider, un riferimento a blocco senza heading usciva
        // `[[page^b]]` — che Obsidian legge come una pagina di nome `page^b` —
        // e nessuno se ne accorgeva perché il nostro lettore riaccettava la
        // propria invenzione.
        LinkTarget::Wiki {
            page: _,
            heading: _,
            block: _,
        } => {
            let inner = target
                .wiki_inner()
                .expect("un bersaglio Wiki ha sempre un interno");
            out.push_str("[[");
            out.push_str(&inner);
            if let Some(inlines) = label {
                let mut lbl = String::new();
                write_inlines(inlines, &mut lbl)?;
                // Dentro le due parentesi non c'è escape: l'alias è testo nudo
                // fino a `]]` (vedi [`disescapa`]).
                let lbl = disescapa(&lbl);
                // **L'alias si scrive perché c'è.** Il confronto col bersaglio
                // stava qui — «se dice la stessa cosa non serve» — e toglieva
                // dal file il `|Nota` di un `[[Nota|Nota]]` che l'utente aveva
                // battuto a mano. Non era una regola di scrittura: era il
                // rimedio a un modello che l'alias assente e l'alias uguale al
                // bersaglio li rappresentava allo stesso modo. Adesso il
                // modello li distingue — `label: None` è «nessun alias scritto»
                // (parse.rs, `scritta_a_mano`) — e qui non c'è più niente da
                // indovinare.
                out.push('|');
                out.push_str(&lbl);
            }
            out.push_str("]]");
        }
        LinkTarget::Url(url) | LinkTarget::Path(url) => {
            out.push('[');
            if let Some(inlines) = label {
                write_inlines(inlines, out)?;
            }
            out.push_str("](");
            scrivi_destinazione(url, out);
            out.push(')');
        }
    }
    Ok(())
}
