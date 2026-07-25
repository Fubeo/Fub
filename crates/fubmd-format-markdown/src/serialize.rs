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

use fubmd_abi::model::{
    custom_kind, Block, ColumnAlign, DocumentModel, Inline, LinkTarget, TableRow,
};

pub fn serialize(model: &DocumentModel) -> String {
    let mut out = String::new();
    if !model.frontmatter.is_empty() {
        if let Ok(yaml) = serde_yaml_ng::to_string(&model.frontmatter.0) {
            out.push_str("---\n");
            out.push_str(&yaml);
            out.push_str("---\n\n");
        }
    }
    for (i, block) in model.body.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        write_block(block, &mut out);
    }
    out
}

fn write_block(block: &Block, out: &mut String) {
    match block {
        Block::Heading { level, inlines, .. } => {
            out.push_str(&"#".repeat((*level).clamp(1, 6) as usize));
            out.push(' ');
            write_inlines(inlines, out);
            out.push('\n');
        }
        Block::Paragraph { inlines, .. } => {
            write_inlines(inlines, out);
            out.push('\n');
        }
        Block::List { ordered, items, .. } => {
            for (i, item) in items.iter().enumerate() {
                if *ordered {
                    out.push_str(&format!("{}. ", i + 1));
                } else {
                    out.push_str("- ");
                }
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
                    write_block(b, &mut inner);
                }
                out.push_str(inner.trim_end());
                out.push('\n');
            }
        }
        Block::Table {
            head, rows, align, ..
        } => {
            let columns = head
                .iter()
                .chain(rows.iter())
                .map(|r| r.cells.len())
                .max()
                .unwrap_or(0);
            let write_row = |row: &TableRow, out: &mut String| {
                out.push('|');
                for i in 0..columns {
                    out.push(' ');
                    if let Some(c) = row.cells.get(i) {
                        write_inlines(&c.inlines, out);
                    }
                    out.push_str(" |");
                }
                out.push('\n');
            };
            // La riga di separazione è obbligatoria in GFM: una tabella senza
            // intestazione si genera con un'intestazione vuota, o non è una
            // tabella quando la si rilegge.
            match head {
                Some(h) => write_row(h, out),
                None => write_row(&TableRow { cells: Vec::new() }, out),
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
                write_row(r, out);
            }
        }
        Block::CodeBlock { lang, code, .. } => {
            out.push_str("```");
            if let Some(l) = lang {
                out.push_str(l);
            }
            out.push('\n');
            out.push_str(code);
            if !code.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("```\n");
        }
        Block::Quote { blocks, .. } => {
            let mut inner = String::new();
            for b in blocks {
                write_block(b, &mut inner);
            }
            for line in inner.trim_end().lines() {
                out.push_str("> ");
                out.push_str(line);
                out.push('\n');
            }
        }
        Block::ThematicBreak { .. } => out.push_str("---\n"),
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            ..
        } => {
            if custom_kind == custom_kind::FOOTNOTE_DEFINITION {
                let label = attrs.get("label").and_then(|v| v.as_str()).unwrap_or("1");
                let mut inner = String::new();
                for b in blocks {
                    write_block(b, &mut inner);
                }
                out.push_str(&format!("[^{label}]: {}\n", inner.trim()));
            } else if custom_kind == custom_kind::CALLOUT {
                let ty = attrs.get("type").and_then(|v| v.as_str()).unwrap_or("note");
                out.push_str(&format!("> [!{}]\n", ty));
                let mut inner = String::new();
                for b in blocks {
                    write_block(b, &mut inner);
                }
                for line in inner.trim_end().lines() {
                    out.push_str("> ");
                    out.push_str(line);
                    out.push('\n');
                }
            } else {
                for b in blocks {
                    write_block(b, out);
                }
            }
        }
    }
}

fn write_inlines(inlines: &[Inline], out: &mut String) {
    for inline in inlines {
        write_inline(inline, out);
    }
}

fn write_inline(inline: &Inline, out: &mut String) {
    match inline {
        Inline::Text(s) => out.push_str(s),
        Inline::Emph(children) => {
            out.push('*');
            write_inlines(children, out);
            out.push('*');
        }
        Inline::Strong(children) => {
            out.push_str("**");
            write_inlines(children, out);
            out.push_str("**");
        }
        Inline::Code(s) => {
            out.push('`');
            out.push_str(s);
            out.push('`');
        }
        Inline::TagRef { name, .. } => {
            out.push('#');
            out.push_str(name);
        }
        Inline::Link {
            target,
            label,
            embed,
            ..
        } => write_link(target, label.as_deref(), *embed, out),
        Inline::Custom {
            custom_kind, attrs, ..
        } if custom_kind == custom_kind::FOOTNOTE_REFERENCE => {
            if let Some(label) = attrs.get("label").and_then(|v| v.as_str()) {
                out.push_str(&format!("[^{label}]"));
            }
        }
        Inline::Custom { .. } => {}
    }
}

fn write_link(target: &LinkTarget, label: Option<&[Inline]>, embed: bool, out: &mut String) {
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
                write_inlines(inlines, &mut lbl);
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
                write_inlines(inlines, out);
            }
            out.push_str("](");
            out.push_str(url);
            out.push(')');
        }
    }
}
