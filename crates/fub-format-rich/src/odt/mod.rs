//! Il codec OpenDocument di Fub: `content.xml` letto e riscritto senza
//! passare dal modello di WordCraft, toccando soltanto ciò che cambia.
//!
//! L'importatore di WordCraft legge un `.odt` nel proprio modello e lascia
//! indietro note, commenti, cornici e gran parte degli stili: per questo, da
//! solo, apre in sola lettura. Qui la proiezione nasce direttamente dall'XML
//! (vedi [`read`]) e ogni nodo porta i byte originali che non mostra, quindi
//! un salvataggio rimette identico tutto ciò che la superficie non ha toccato
//! (vedi [`write`]): le altre parti del pacchetto passano grezze, e degli
//! stili si aggiunge soltanto ciò che serve.
//!
//! **Aprire** controlla che la rigenerazione di ogni blocco rilegga identico
//! ciò che il file mostra; se no la proiezione esce in sola lettura con
//! [`ReadOnly::Projection`]. Un documento che il lettore non sa rappresentare
//! senza perdite si apre con l'importatore, in sola lettura con
//! [`ReadOnly::Import`].
//!
//! **Salvare** rilegge il file nuovo e lo confronta con ciò che si voleva
//! scrivere: testo, ruoli, enfasi, link, oggetti e struttura delle tabelle.

mod keys;
mod package;
mod read;
mod styles;
mod write;
mod xml;

use wordcraft_doc::Document;

use self::package::Package;
use self::read::Body;
use self::styles::Styles;
use self::xml::Tree;
use crate::projection::{self, Block, Inline, Mark, Projection, Role, FORMAT, VERSION};
use crate::session::{Opened, Saved};
use crate::{ReadOnly, RichError};

/// Un documento letto dal codec.
struct Doc {
    content: Tree,
    styles_tree: Option<Tree>,
    styles: Styles,
    body: Body,
}

fn parse(bytes: &[u8]) -> Result<(Package, Doc), RichError> {
    let package = Package::read(bytes)?;
    let content = Tree::parse(package.content.clone())?;
    let styles_tree = package.styles.clone().map(Tree::parse).transpose()?;
    let settings = package.settings.clone().map(Tree::parse).transpose()?;
    let styles = Styles::read(&content, styles_tree.as_ref());
    let body = read::body(&content, &styles, settings.as_ref())?;
    Ok((
        package,
        Doc {
            content,
            styles_tree,
            styles,
            body,
        },
    ))
}

impl Doc {
    fn base(&self) -> write::Base<'_> {
        write::Base {
            content: &self.content,
            styles_tree: self.styles_tree.as_ref(),
            styles: &self.styles,
            body: &self.body,
        }
    }
}

/// Apre un `.odt`.
pub(crate) fn open(bytes: &[u8]) -> Result<Opened, RichError> {
    let doc = match parse(bytes) {
        Ok((_, doc)) => doc,
        Err(RichError::Codec(_)) => return import(bytes),
        Err(other) => return Err(other),
    };
    let blocks = doc.body.blocks();
    let mut readonly = doc.body.readonly;
    if readonly.is_none() && !regenerates(&doc, &blocks) {
        readonly = Some(ReadOnly::Projection);
    }
    let projection = Projection {
        format: FORMAT.to_string(),
        version: VERSION,
        readonly,
        lang: doc.styles.lang.clone(),
        blocks,
    };
    if readonly.is_none() && Projection::from_json(&projection.to_json()?)? != projection {
        let mut projection = projection;
        projection.readonly = Some(ReadOnly::Projection);
        return opened(projection);
    }
    opened(projection)
}

fn opened(projection: Projection) -> Result<Opened, RichError> {
    Ok(Opened {
        readonly: projection.readonly,
        projection: projection.to_json()?,
    })
}

/// Il documento letto dall'importatore di WordCraft, in sola lettura.
fn import(bytes: &[u8]) -> Result<Opened, RichError> {
    let mut document = crate::Codec::Odt.read(bytes)?;
    document.normalize_runs();
    let mut projection = projection::project(&document)?;
    projection.readonly = Some(ReadOnly::Import);
    opened(projection)
}

/// Ogni blocco, rigenerato dai propri dati, si rilegge identico.
fn regenerates(doc: &Doc, blocks: &[Block]) -> bool {
    let Ok(output) = write::write(&doc.base(), blocks, true) else {
        return false;
    };
    let Ok(content) = Tree::parse(output.content) else {
        return false;
    };
    let Ok(reread) = read::body(&content, &doc.styles, None) else {
        return false;
    };
    let fixed = |body: &Body, tree: &Tree| -> Vec<Vec<u8>> {
        body.units
            .iter()
            .filter_map(|unit| match unit {
                read::Unit::Fixed(range) => Some(tree.source[range.clone()].to_vec()),
                read::Unit::Blocks { .. } => None,
            })
            .collect()
    };
    reread.blocks() == blocks && fixed(&reread, &content) == fixed(&doc.body, &doc.content)
}

/// Scrive la proiezione `json` sul documento `current`.
pub(crate) fn save(current: &[u8], json: &str) -> Result<Saved, RichError> {
    let doc = match parse(current) {
        Ok((_, doc)) => doc,
        // Aperto dall'importatore: si legge, non si scrive.
        Err(RichError::Codec(_)) => return Err(RichError::ReadOnly(ReadOnly::Import)),
        Err(other) => return Err(other),
    };
    if let Some(reason) = doc.body.readonly {
        return Err(RichError::ReadOnly(reason));
    }
    let projection = Projection::from_json(json)?;
    if let Some(reason) = projection.readonly {
        return Err(RichError::ReadOnly(reason));
    }
    let wanted = normalized(&projection.blocks);
    let base = doc.body.blocks();
    if wanted == normalized(&base) {
        return Ok(Saved::Unchanged);
    }
    let output = write::write(&doc.base(), &wanted, false)?;
    let mut parts: Vec<(&str, &[u8])> = vec![(package::CONTENT, &output.content)];
    if let Some(styles) = &output.styles {
        parts.push((package::STYLES, styles));
    }
    let bytes = package::replace(current, &parts)?;
    let (_, reread) = parse(&bytes).map_err(|_| RichError::Fidelity)?;
    if visible(&reread.body.blocks()) != visible(&output.expected) {
        return Err(RichError::Fidelity);
    }
    Ok(Saved::Bytes(bytes))
}

/// I byte di un documento vuoto: quello che l'esportatore di WordCraft scrive
/// per un documento nuovo, dove non c'è niente da perdere.
pub(crate) fn blank() -> Result<Vec<u8>, RichError> {
    wordcraft_formats::odt::export(&Document::new()).map_err(RichError::Codec)
}

/// I blocchi come la shell potrebbe mandarli in forme diverse ma uguali: testi
/// vuoti tolti, tratti uguali vicini uniti, la cella vuota senza il paragrafo
/// che ProseMirror vi mette.
fn normalized(blocks: &[Block]) -> Vec<Block> {
    blocks
        .iter()
        .map(|block| match block {
            Block::Para(para) => {
                let mut para = para.clone();
                let mut c: Vec<Inline> = Vec::new();
                for inline in para.c {
                    match (c.last_mut(), inline) {
                        (_, Inline::Text { x, .. }) if x.is_empty() => {}
                        (
                            Some(Inline::Text { x, k, m, href }),
                            Inline::Text {
                                x: nx,
                                k: nk,
                                m: nm,
                                href: nh,
                            },
                        ) if *k == nk && *m == nm && *href == nh => x.push_str(&nx),
                        (_, inline) => c.push(inline),
                    }
                }
                para.c = c;
                Block::Para(para)
            }
            Block::Table(table) => {
                let mut table = table.clone();
                for row in &mut table.rows {
                    for cell in &mut row.cells {
                        cell.blocks = if write::bare_cell(&cell.blocks) {
                            Vec::new()
                        } else {
                            normalized(&cell.blocks)
                        };
                    }
                }
                Block::Table(table)
            }
        })
        .collect()
}

/// Ciò che chi legge vede di un blocco.
#[derive(Debug, PartialEq)]
enum Seen {
    Para(Role, Vec<SeenInline>),
    Table(Vec<Vec<Vec<Seen>>>),
}

#[derive(Debug, PartialEq)]
enum SeenInline {
    Text(String, Vec<Mark>, Option<String>),
    Atom(String),
}

fn visible(blocks: &[Block]) -> Vec<Seen> {
    blocks
        .iter()
        .map(|block| match block {
            Block::Para(para) => {
                let mut out: Vec<SeenInline> = Vec::new();
                for inline in &para.c {
                    match inline {
                        Inline::Text { x, m, href, .. } => match out.last_mut() {
                            Some(SeenInline::Text(px, pm, ph)) if pm == m && ph == href => {
                                px.push_str(x)
                            }
                            _ if x.is_empty() => {}
                            _ => out.push(SeenInline::Text(x.clone(), m.clone(), href.clone())),
                        },
                        Inline::Atom { k, .. } => {
                            let xml = crate::blob::decode::<keys::AtomKey>(k)
                                .map(|key| key.xml)
                                .unwrap_or_default();
                            out.push(SeenInline::Atom(xml));
                        }
                    }
                }
                Seen::Para(para.role, out)
            }
            Block::Table(table) => Seen::Table(
                table
                    .rows
                    .iter()
                    .map(|row| row.cells.iter().map(|cell| visible(&cell.blocks)).collect())
                    .collect(),
            ),
        })
        .collect()
}
