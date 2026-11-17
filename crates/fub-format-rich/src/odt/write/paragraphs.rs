//! I paragrafi: il piano di ruolo, stile ed elenchi, gli stili automatici e
//! comuni che il codec aggiunge, i tratti, i link e gli oggetti.

use std::collections::BTreeSet;
use std::ops::Range;

use crate::blob;
use crate::odt::keys::{self, name_of, opening, AtomKey, Level, ParaKey, RunKey};
use crate::odt::read;
use crate::odt::styles::{self as odt_styles, Def, LevelKind, ParaChange, TextProps};
use crate::odt::xml;
use crate::projection::{self, Align, AtomKind, Block, Inline, Line, Mark, Para, Role};
use crate::RichError;

use super::looks::{apply, cm, diff, relative, text_properties};
use super::markup::{href_of, layers, quoted, set_attr, style_attr, sync, text};
use super::{Plan, Writer};

impl<'a> Writer<'a> {
    // ── Paragrafi ───────────────────────────────────────────────────────────

    /// Il piano di un paragrafo: quello del ruolo, poi lo stile scelto, poi
    /// allineamento e disposizione.
    pub(super) fn plan(&mut self, para: &Para, prev: Option<&[Level]>) -> Result<Plan, RichError> {
        let key: Option<ParaKey> = para.k.as_deref().map(blob::decode).transpose()?;
        let before = key.as_ref().map(|key| read::role(&self.styles, key));
        let mut plan = self.plan_role(para, prev)?;
        let (name, mut attrs) = keys::tag(&plan.tag)
            .ok_or_else(|| RichError::Malformed("odt: paragraph tag".into()))?;
        let shown = plan.shown.clone();

        let shown_s = (before == Some(Role::Body))
            .then(|| self.styles.common_of(shown.as_deref()))
            .flatten();
        if para.role == Role::Body && para.s.as_deref() != shown_s.as_deref() {
            let target = match para.s.as_deref() {
                Some(id) if self.styles.common("paragraph", id) => Some(Some(id.to_string())),
                Some(_) => None,
                None => Some(None),
            };
            if let Some(target) = target {
                self.restyle(&mut attrs, target)?;
                plan.kept = false;
            }
        }

        let current = style_attr(&attrs);
        let common = self.styles.common_of(current.as_deref());
        let plain = self.styles.para(common.as_deref());
        let plain_align = self.styles.align(common.as_deref());
        let shown_layout = self.styles.layout(shown.as_deref());
        let left = |a: Option<Align>| a.filter(|a| *a != Align::Left);
        let mut change = ParaChange::default();
        if left(para.align) != self.styles.align(shown.as_deref()) {
            let want = left(para.align);
            change.align = Some((want != plain_align).then(|| want.unwrap_or(Align::Left)));
        }
        let length = |want: Option<f32>, shown: Option<f32>, plain: Option<f32>| {
            (want != shown).then(|| {
                let plain = plain.unwrap_or(0.0);
                let target = want.unwrap_or(plain);
                (!projection::same_size(target, plain)).then_some(target)
            })
        };
        let want = &para.p;
        change.left = length(want.left, shown_layout.left, plain.left);
        change.right = length(want.right, shown_layout.right, plain.right);
        change.first = length(want.first, shown_layout.first, plain.first);
        change.before = length(want.before, shown_layout.before, plain.before);
        change.after = length(want.after, shown_layout.after, plain.after);
        if want.line != shown_layout.line {
            let plain = plain.line.unwrap_or(Line::Multiple(1.0));
            let target = want.line.unwrap_or(plain);
            change.line = Some((!target.same(plain)).then_some(target));
        }
        if !change.is_empty() {
            let automatic = current
                .as_deref()
                .filter(|c| self.styles.get("paragraph", c).is_some_and(|d| d.automatic))
                .map(str::to_string);
            let value = match automatic {
                Some(auto) => {
                    let parent = self
                        .styles
                        .get("paragraph", &auto)
                        .and_then(|d| d.parent.clone());
                    Some(self.clone_para_with(&auto, parent, Some(&change))?)
                }
                None if change.only_clears() => current,
                None => Some(self.para_style(current, &change)),
            };
            set_attr(&mut attrs, "text:style-name", value);
        }
        plan.style = style_attr(&attrs);
        plan.tag = keys::rebuild(&name, &attrs);
        Ok(plan)
    }

    fn plan_role(&mut self, para: &Para, prev: Option<&[Level]>) -> Result<Plan, RichError> {
        let key: Option<ParaKey> = para.k.as_deref().map(blob::decode).transpose()?;
        let before = key.as_ref().map(|key| read::role(&self.styles, key));
        if let (Some(key), Some(before)) = (&key, before) {
            if before == para.role {
                let style = keys::tag(&key.tag).and_then(|(_, attrs)| style_attr(&attrs));
                return Ok(Plan {
                    tag: opening(&key.tag),
                    chain: key.list.clone(),
                    shown: style.clone(),
                    style,
                    kept: true,
                });
            }
        }
        let (_, mut attrs) = match &key {
            Some(key) => keys::tag(&key.tag)
                .ok_or_else(|| RichError::Malformed("odt: paragraph tag".into()))?,
            None => ("text:p".to_string(), Vec::new()),
        };
        let shown = key.as_ref().and_then(|_| style_attr(&attrs));
        let name = match para.role {
            Role::Heading { level } => {
                set_attr(
                    &mut attrs,
                    "text:outline-level",
                    Some(level.clamp(1, 9).to_string()),
                );
                "text:h"
            }
            _ => {
                for gone in [
                    "text:outline-level",
                    "text:is-list-header",
                    "text:restart-numbering",
                    "text:start-value",
                ] {
                    set_attr(&mut attrs, gone, None);
                }
                "text:p"
            }
        };
        let target = match para.role {
            Role::Heading { level } => Some(Some(self.heading(level.clamp(1, 9))?)),
            Role::Quote => Some(Some(self.quotations()?)),
            Role::Body | Role::List { .. } => match before {
                Some(Role::Heading { .. } | Role::Quote) | None => Some(self.body_style()),
                Some(_) => None,
            },
        };
        if let Some(target) = target {
            self.restyle(&mut attrs, target)?;
        }
        let style = style_attr(&attrs);
        let chain = match para.role {
            Role::List { ordered, level } => {
                let own = key.as_ref().map(|k| k.list.as_slice()).unwrap_or(&[]);
                self.derive(
                    ordered,
                    usize::from(level.min(8)),
                    own,
                    prev,
                    style.as_deref(),
                )?
            }
            _ => Vec::new(),
        };
        Ok(Plan {
            tag: keys::rebuild(name, &attrs),
            chain,
            shown: if key.is_some() { shown } else { style.clone() },
            style,
            kept: false,
        })
    }

    /// Gli elenchi per una voce di livello `level`: quelli del paragrafo
    /// stesso o della voce prima, se il loro stile ha la specie voluta a quel
    /// livello; altrimenti un elenco nuovo.
    fn derive(
        &mut self,
        ordered: bool,
        level: usize,
        own: &[Level],
        prev: Option<&[Level]>,
        para_style: Option<&str>,
    ) -> Result<Vec<Level>, RichError> {
        let want = if ordered {
            LevelKind::Number
        } else {
            LevelKind::Bullet
        };
        let depth = u8::try_from(level).unwrap_or(8);
        for candidate in [own, prev.unwrap_or(&[])] {
            if candidate.is_empty() {
                continue;
            }
            let mut chain: Vec<Level> = candidate.iter().take(level + 1).cloned().collect();
            for l in &mut chain {
                l.open = false;
            }
            while chain.len() < level + 1 {
                chain.push(Level {
                    list: "<text:list>".into(),
                    item: "<text:list-item>".into(),
                    open: false,
                });
            }
            if name_of(&chain[level].item) != "text:list-item" {
                chain[level].item = "<text:list-item>".into();
            }
            chain[level].open = true;
            let style = read::list_style(&self.styles, &chain, para_style);
            if self.styles.level_kind(style.as_deref(), depth) == want {
                return Ok(chain);
            }
        }
        let style = match self
            .styles
            .list_names()
            .into_iter()
            .find(|name| self.styles.level_kind(Some(name), depth) == want)
        {
            Some(name) => name.to_string(),
            None => self.list_style(want),
        };
        let mut chain = vec![Level {
            list: format!("<text:list text:style-name=\"{}\">", quoted(&style)),
            item: "<text:list-item>".into(),
            open: true,
        }];
        while chain.len() < level + 1 {
            chain.push(Level {
                list: "<text:list>".into(),
                item: "<text:list-item>".into(),
                open: true,
            });
        }
        Ok(chain)
    }

    /// Cambia lo stile del paragrafo: uno automatico si copia con il genitore
    /// nuovo, uno comune si sostituisce.
    fn restyle(
        &mut self,
        attrs: &mut Vec<(String, String)>,
        target: Option<String>,
    ) -> Result<(), RichError> {
        let current = style_attr(attrs);
        if current == target {
            return Ok(());
        }
        let automatic = current
            .as_deref()
            .filter(|c| self.styles.get("paragraph", c).is_some_and(|d| d.automatic))
            .map(str::to_string);
        let value = match automatic {
            Some(auto) => Some(self.clone_para_with(&auto, target, None)?),
            None => target,
        };
        set_attr(attrs, "text:style-name", value);
        Ok(())
    }

    /// Copia lo stile automatico `auto` col genitore `parent` e, se c'è, la
    /// disposizione cambiata.
    fn clone_para_with(
        &mut self,
        auto: &str,
        parent: Option<String>,
        change: Option<&ParaChange>,
    ) -> Result<String, RichError> {
        let key = (auto.to_string(), parent.clone());
        if change.is_none() {
            if let Some(name) = self.clones.get(&key) {
                return Ok(name.clone());
            }
        }
        let tree = self.base.content;
        let container = tree
            .child(tree.root, "office:automatic-styles")
            .ok_or_else(|| RichError::Codec(format!("odt: style {auto} not found")))?;
        let (id, element) = tree
            .elements(container)
            .find(|(_, e)| {
                e.name == "style:style"
                    && e.attr("style:name") == Some(auto)
                    && e.attr("style:family") == Some("paragraph")
            })
            .ok_or_else(|| RichError::Codec(format!("odt: style {auto} not found")))?;
        let name = self.styles.fresh("FubP");
        let mut attrs = element.attrs.clone();
        set_attr(&mut attrs, "style:name", Some(name.clone()));
        set_attr(&mut attrs, "style:parent-style-name", parent.clone());
        let span = tree.nodes[id].span.clone();
        let raw = |range: Range<usize>| String::from_utf8_lossy(&tree.source[range]).into_owned();
        match change {
            None if element.open == span => {
                self.auto_xml
                    .push_str(&xml::open_tag("style:style", &attrs, true))
            }
            None => {
                self.auto_xml
                    .push_str(&xml::open_tag("style:style", &attrs, false));
                self.auto_xml.push_str(&raw(element.open.end..span.end));
            }
            Some(change) => {
                let mut out = xml::open_tag("style:style", &attrs, false);
                let props = tree
                    .elements(id)
                    .find(|(_, e)| e.name == "style:paragraph-properties");
                match props {
                    Some((pid, props)) => {
                        let pspan = tree.nodes[pid].span.clone();
                        let mut pattrs = props.attrs.clone();
                        apply(&mut pattrs, change);
                        out.push_str(&raw(element.open.end..pspan.start));
                        if props.open == pspan {
                            out.push_str(&xml::open_tag(
                                "style:paragraph-properties",
                                &pattrs,
                                true,
                            ));
                        } else {
                            out.push_str(&xml::open_tag(
                                "style:paragraph-properties",
                                &pattrs,
                                false,
                            ));
                            out.push_str(&raw(props.open.end..pspan.end));
                        }
                        out.push_str(&raw(pspan.end..span.end));
                    }
                    None => {
                        let mut pattrs = Vec::new();
                        apply(&mut pattrs, change);
                        out.push_str(&xml::open_tag("style:paragraph-properties", &pattrs, true));
                        if element.open == span {
                            out.push_str("</style:style>");
                        } else {
                            out.push_str(&raw(element.open.end..span.end));
                        }
                    }
                }
                self.auto_xml.push_str(&out);
            }
        }
        let mut def = self
            .styles
            .get("paragraph", auto)
            .cloned()
            .unwrap_or_default();
        def.parent = parent;
        def.automatic = true;
        if let Some(change) = change {
            def.para = def.para.changed(change);
            def.align = change.align.unwrap_or(def.align);
        } else {
            self.clones.insert(key, name.clone());
        }
        self.styles.define("paragraph", &name, def);
        Ok(name)
    }

    /// Uno stile automatico nuovo di genitore `parent` con soltanto la
    /// disposizione `change`, o quello uguale già scritto.
    fn para_style(&mut self, parent: Option<String>, change: &ParaChange) -> String {
        let para = odt_styles::ParaProps::default().changed(change);
        let align = change.align.flatten();
        if let Some(name) = self
            .styles
            .find_para("FubP", parent.as_deref(), &para, align)
        {
            return name;
        }
        let name = self.styles.fresh("FubP");
        let mut attrs = vec![
            ("style:name".to_string(), name.clone()),
            ("style:family".to_string(), "paragraph".to_string()),
        ];
        if let Some(parent) = &parent {
            attrs.push(("style:parent-style-name".into(), parent.clone()));
        }
        let mut pattrs = Vec::new();
        apply(&mut pattrs, change);
        self.auto_xml.push_str(&format!(
            "{}{}</style:style>",
            xml::open_tag("style:style", &attrs, false),
            xml::open_tag("style:paragraph-properties", &pattrs, true)
        ));
        self.styles.define(
            "paragraph",
            &name,
            Def {
                parent,
                para,
                align,
                automatic: true,
                ..Def::default()
            },
        );
        name
    }

    fn body_style(&self) -> Option<String> {
        ["Text_20_body", "Standard"]
            .into_iter()
            .find(|name| self.styles.common("paragraph", name))
            .map(str::to_string)
    }

    fn need_styles_part(&self, what: &str) -> Result<(), RichError> {
        if self.base.styles_tree.is_none() {
            return Err(RichError::Codec(format!(
                "odt: a document without styles.xml cannot gain the {what} style"
            )));
        }
        Ok(())
    }

    /// Lo stile comune del titolo di livello `level`, aggiunto a `styles.xml`
    /// come quello di LibreOffice se il documento non ne ha uno.
    fn heading(&mut self, level: u8) -> Result<String, RichError> {
        if let Some(name) = self.styles.heading(level) {
            return Ok(name);
        }
        self.need_styles_part("heading")?;
        let name = format!("Heading_20_{level}");
        let size = format!("{}%", (odt_styles::heading_scale(level) * 100.0).round());
        self.common_xml.push_str(&format!(
            "<style:style style:name=\"{name}\" style:display-name=\"Heading {level}\" \
             style:family=\"paragraph\" style:default-outline-level=\"{level}\" \
             style:class=\"text\"><style:paragraph-properties fo:margin-top=\"0.423cm\" \
             fo:margin-bottom=\"0.212cm\" fo:keep-with-next=\"always\"/>\
             <style:text-properties fo:font-size=\"{size}\" fo:font-weight=\"bold\" \
             style:font-weight-asian=\"bold\" style:font-weight-complex=\"bold\"/>\
             </style:style>"
        ));
        let def = Def {
            text: TextProps {
                bold: Some(true),
                ..TextProps::default()
            },
            outline_level: Some(level),
            para: odt_styles::ParaProps {
                before: Some(cm(0.423)),
                after: Some(cm(0.212)),
                ..odt_styles::ParaProps::default()
            },
            ..Def::default()
        };
        self.styles.define("paragraph", &name, def);
        Ok(name)
    }

    fn quotations(&mut self) -> Result<String, RichError> {
        let name = "Quotations";
        if self.styles.common("paragraph", name) {
            return Ok(name.to_string());
        }
        self.need_styles_part("quotation")?;
        self.common_xml.push_str(
            "<style:style style:name=\"Quotations\" style:family=\"paragraph\" \
             style:class=\"html\"><style:paragraph-properties fo:margin-left=\"1cm\" \
             fo:margin-right=\"1cm\" fo:margin-top=\"0cm\" fo:margin-bottom=\"0.283cm\" \
             fo:text-indent=\"0cm\" style:auto-text-indent=\"false\"/></style:style>",
        );
        let para = odt_styles::ParaProps {
            left: Some(cm(1.0)),
            right: Some(cm(1.0)),
            first: Some(0.0),
            before: Some(0.0),
            after: Some(cm(0.283)),
            line: None,
        };
        self.styles.define(
            "paragraph",
            name,
            Def {
                para,
                ..Def::default()
            },
        );
        Ok(name.to_string())
    }

    /// Uno stile d'elenco nuovo, puntato o numerato su dieci livelli.
    fn list_style(&mut self, kind: LevelKind) -> String {
        let name = self.styles.fresh("FubL");
        let mut out = format!("<text:list-style style:name=\"{name}\">");
        for level in 1..=10u32 {
            let margin = 0.635 * f64::from(level + 1);
            let props = format!(
                "<style:list-level-properties text:list-level-position-and-space-mode=\
                 \"label-alignment\"><style:list-level-label-alignment \
                 text:label-followed-by=\"listtab\" text:list-tab-stop-position=\"{margin:.3}cm\" \
                 text:margin-left=\"{margin:.3}cm\" text:text-indent=\"-0.635cm\"/>\
                 </style:list-level-properties>"
            );
            match kind {
                LevelKind::Number => out.push_str(&format!(
                    "<text:list-level-style-number text:level=\"{level}\" \
                     style:num-suffix=\".\" style:num-format=\"1\">{props}\
                     </text:list-level-style-number>"
                )),
                _ => out.push_str(&format!(
                    "<text:list-level-style-bullet text:level=\"{level}\" \
                     text:bullet-char=\"•\">{props}</text:list-level-style-bullet>"
                )),
            }
        }
        out.push_str("</text:list-style>");
        self.auto_xml.push_str(&out);
        self.styles.define_list(&name, kind);
        name
    }

    fn text_style(&mut self, props: TextProps) -> String {
        if let Some(name) = self.styles.find_text("FubT", &props) {
            return name;
        }
        let name = self.styles.fresh("FubT");
        self.auto_xml.push_str(&format!(
            "<style:style style:name=\"{name}\" style:family=\"text\">{}</style:style>",
            text_properties(&props)
        ));
        self.styles.define(
            "text",
            &name,
            Def {
                text: props,
                automatic: true,
                ..Def::default()
            },
        );
        name
    }

    pub(super) fn para(
        &mut self,
        para: &Para,
        plan: &Plan,
        out: &mut String,
    ) -> Result<Para, RichError> {
        // Le revisioni tracciate un `.odt` di Fub non le legge e non le
        // scrive: una proiezione che ne porta non viene da qui.
        if para.ins.is_some()
            || para.del.is_some()
            || para.c.iter().any(|inline| match inline {
                Inline::Text { ins, del, .. } | Inline::Atom { ins, del, .. } => {
                    ins.is_some() || del.is_some()
                }
            })
        {
            return Err(RichError::Codec(
                "odt: tracked changes are not written".into(),
            ));
        }
        let tag = self.fresh(&plan.tag, false);
        out.push_str(&tag);
        let mut stack: Vec<String> = Vec::new();
        let mut space_ok = false;
        let mut expected = Vec::new();
        for inline in &para.c {
            match inline {
                Inline::Text {
                    x, k, m, href, f, ..
                } => {
                    if x.is_empty() {
                        continue;
                    }
                    let mut wrap = match k {
                        Some(k) => blob::decode::<RunKey>(k)?.wrap,
                        None => Vec::new(),
                    };
                    self.link(&mut wrap, href.as_deref());
                    let want: BTreeSet<Mark> = m.iter().copied().collect();
                    let plain = self.styles.text(plan.shown.as_deref(), &[]);
                    let look = relative(f, &plain);
                    let shown = self.styles.text(plan.shown.as_deref(), &layers(&wrap));
                    let change = diff(&want, &look, &plain, &shown);
                    if change != TextProps::default() {
                        let name = self.text_style(change);
                        wrap.push(format!("<text:span text:style-name=\"{}\">", quoted(&name)));
                    }
                    let got_props = self.styles.text(plan.style.as_deref(), &layers(&wrap));
                    let got_look = got_props.look(&self.styles.text(plan.style.as_deref(), &[]));
                    let got = got_props.marks();
                    if plan.kept
                        && (got.iter().copied().collect::<BTreeSet<_>>() != want
                            || got_look != look)
                    {
                        return Err(RichError::Fidelity);
                    }
                    sync(&mut stack, &wrap, out);
                    text(x, &mut space_ok, out)?;
                    expected.push(Inline::Text {
                        x: x.clone(),
                        k: None,
                        m: got,
                        href: href_of(&wrap),
                        f: got_look,
                        ins: None,
                        del: None,
                    });
                }
                Inline::Atom { k: Some(k), .. } => {
                    let key: AtomKey = blob::decode(k)?;
                    sync(&mut stack, &key.wrap, out);
                    out.push_str(&key.xml);
                    space_ok = false;
                    expected.push(inline.clone());
                }
                Inline::Atom { k: None, .. } => {
                    let (kind, xml) = self.new_atom(inline)?;
                    sync(&mut stack, &[], out);
                    out.push_str(&xml);
                    space_ok = false;
                    expected.push(Inline::Atom {
                        k: Some(blob::encode(&AtomKey {
                            wrap: Vec::new(),
                            xml,
                        })?),
                        kind,
                        label: String::new(),
                        w: None,
                        h: None,
                        data: None,
                        note: None,
                        end: false,
                        toc: None,
                        comment: None,
                        ink: None,
                        svg: None,
                        float: None,
                        ins: None,
                        del: None,
                    });
                }
            }
        }
        sync(&mut stack, &[], out);
        out.push_str(&format!("</{}>", name_of(&plan.tag)));
        let style = plan.style.as_deref();
        Ok(Para {
            locked: false,
            role: para.role,
            align: self.styles.align(style),
            k: None,
            sect: None,
            page: None,
            header: None,
            footer: None,
            p: self.styles.layout(style),
            s: (para.role == Role::Body)
                .then(|| self.styles.common_of(style))
                .flatten()
                .map(String::into_boxed_str),
            f: Box::default(),
            ins: None,
            del: None,
            c: expected,
        })
    }

    /// Mette il link voluto negli involucri del tratto.
    fn link(&self, wrap: &mut Vec<String>, href: Option<&str>) {
        if href_of(wrap).as_deref() == href {
            return;
        }
        match href {
            None => wrap.retain(|tag| name_of(tag) != "text:a"),
            Some(href) => match wrap.iter().rposition(|tag| name_of(tag) == "text:a") {
                Some(at) => {
                    if let Some((name, mut attrs)) = keys::tag(&wrap[at]) {
                        set_attr(&mut attrs, "xlink:href", Some(href.to_string()));
                        wrap[at] = keys::rebuild(&name, &attrs);
                    }
                }
                None => {
                    let mut attrs = vec![
                        ("xlink:type".to_string(), "simple".to_string()),
                        ("xlink:href".to_string(), href.to_string()),
                    ];
                    if self.styles.common("text", "Internet_20_link") {
                        attrs.push(("text:style-name".into(), "Internet_20_link".into()));
                    }
                    if self.styles.common("text", "Visited_20_Internet_20_Link") {
                        attrs.push((
                            "text:visited-style-name".into(),
                            "Visited_20_Internet_20_Link".into(),
                        ));
                    }
                    wrap.insert(0, keys::rebuild("text:a", &attrs));
                }
            },
        }
    }

    /// Gli oggetti di tutti i blocchi, anche di quelli che passano grezzi:
    /// una nota copiata accanto a quella rimasta al suo posto è una seconda.
    pub(super) fn check_atoms(&mut self, blocks: &[Block]) -> Result<(), RichError> {
        for block in blocks {
            match block {
                Block::Para(p) => {
                    for inline in &p.c {
                        // Uno nuovo lo controlla chi lo scrive.
                        if let Inline::Atom {
                            k: Some(k), kind, ..
                        } = inline
                        {
                            self.check_atom(&blob::decode(k)?, *kind)?;
                        }
                    }
                }
                Block::Table(t) => {
                    for cell in t.rows.iter().flat_map(|row| &row.cells) {
                        self.check_atoms(&cell.blocks)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Un oggetto c'era nel documento; uno che non si ripete (una nota, un
    /// segnalibro, un commento, una forma) non compare più volte di prima.
    fn check_atom(&mut self, key: &AtomKey, kind: AtomKind) -> Result<(), RichError> {
        let Some(&had) = self.atoms.get(&key.xml) else {
            return Err(RichError::Missing(format!("an object of kind {kind:?}")));
        };
        if matches!(kind, AtomKind::Image | AtomKind::Graphic) {
            return Ok(());
        }
        let used = self.used.entry(key.xml.clone()).or_default();
        *used += 1;
        if *used > had {
            return Err(RichError::Missing(format!(
                "a second copy of an object of kind {kind:?}"
            )));
        }
        Ok(())
    }
}
