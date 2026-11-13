//! Il pacchetto: il lettore delle parti, l'inventario di una cartella e le
//! proprietà dell'applicazione.

use super::*;

// --- il pacchetto --------------------------------------------------------------

/// Le relazioni che non si contano: parti che si risolvono in altre
/// (stili, stringhe, metadati), o che si ricavano (la catena di calcolo).
fn resolved_kind(kind: &str) -> bool {
    matches!(
        kind,
        "styles" | "sharedStrings" | "calcChain" | "sheetMetadata" | "worksheet"
    )
}

pub(super) struct Reader<'a> {
    pub(super) package: Package<'a>,
    pub(super) budget: Budget,
    /// Le parti in corso di visita, contro i cicli.
    visiting: HashSet<String>,
    pub(super) colors: Colors,
}

impl<'a> Reader<'a> {
    pub(super) fn read(&mut self, part: &str) -> Result<Option<Vec<u8>>, InventoryError> {
        Ok(self.package.read(part)?)
    }

    /// La forma canonica della parte che una relazione punta: l'URL se è
    /// esterna, l'XML canonico (con le sue relazioni) se è XML, l'impronta se
    /// è binaria.
    pub(super) fn target(&mut self, rel: &Rel) -> Result<String, InventoryError> {
        if rel.external {
            return Ok(format!("{} -> {:?}", rel.kind, rel.target));
        }
        self.budget.visits += 1;
        if self.budget.visits > LIMITS.visits {
            return Err(InventoryError::Limit("related parts"));
        }
        let part = normalize(&rel.target);
        if !self.visiting.insert(part.clone()) {
            return Ok(format!("{} -> (cycle)", rel.kind));
        }
        let result = self.part(&part, &rel.kind);
        self.visiting.remove(&part);
        Ok(format!("{} -> {}", rel.kind, result?))
    }

    fn part(&mut self, part: &str, kind: &str) -> Result<String, InventoryError> {
        let Some(bytes) = self.read(part)? else {
            return Ok("(missing)".into());
        };
        if !looks_like_xml(&bytes) {
            return Ok(format!("sha256 {}", sha256(&bytes)));
        }
        let mut root = parse(&bytes, part, &mut self.budget, None, &mut |_| Ok(()))?;
        self.colors.fix(&mut root, false);
        let rels = self.package.rels(part)?;
        let mut used: HashSet<String> = HashSet::new();
        let mut text = self.canonical_with_rels(&root, &rels, &mut used, kind)?;
        for rel in &rels {
            if !used.contains(&rel.id) {
                text.push_str(&format!(" +rel {}", self.target(rel)?));
            }
        }
        Ok(text)
    }

    /// La forma canonica di `node`, con ogni attributo dello spazio dei nomi
    /// delle relazioni risolto nella parte che punta.
    pub(super) fn canonical_with_rels(
        &mut self,
        node: &Node,
        rels: &[Rel],
        used: &mut HashSet<String>,
        _kind: &str,
    ) -> Result<String, InventoryError> {
        // Le destinazioni prima, perché la forma canonica non può fallire.
        let mut targets: HashMap<String, String> = HashMap::new();
        let mut ids = Vec::new();
        collect_rel_ids(node, &mut ids);
        for id in ids {
            if targets.contains_key(&id) {
                continue;
            }
            let target = match rels.iter().find(|rel| rel.id == id) {
                Some(rel) => self.target(rel)?,
                None => "(dangling)".into(),
            };
            used.insert(id.clone());
            targets.insert(id, target);
        }
        Ok(canonical(node, &mut |_, name, value| {
            name.starts_with("r:")
                .then(|| targets.get(value).cloned().unwrap_or_default())
        }))
    }
}

fn collect_rel_ids(node: &Node, out: &mut Vec<String>) {
    for (name, value) in &node.attrs {
        if name.starts_with("r:") {
            out.push(value.clone());
        }
    }
    for kid in &node.kids {
        collect_rel_ids(kid, out);
    }
}

fn looks_like_xml(bytes: &[u8]) -> bool {
    let start = bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .unwrap_or(bytes)
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .map(|at| &bytes[at..]);
    start.is_some_and(|rest| rest.starts_with(b"<"))
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// L'inventario dei byte di una cartella.
pub(crate) fn inventory(bytes: &[u8]) -> Result<Inventory, InventoryError> {
    let package = Package::open(bytes)?;
    if package.has_duplicates() {
        return Err(InventoryError::Package(PackageError::Zip(
            "two entries with the same part name".into(),
        )));
    }
    let mut reader = Reader {
        package,
        budget: Budget {
            elements: 0,
            visits: 0,
        },
        visiting: HashSet::new(),
        colors: Colors::default(),
    };
    let mut out = Inventory::default();
    let workbook = reader.package.workbook_part()?;
    // La radice del pacchetto: ogni relazione tranne il documento principale.
    for rel in reader.package.rels("")? {
        if rel.kind == "officeDocument" && normalize(&rel.target) == workbook {
            continue;
        }
        let value = match rel.kind.as_str() {
            "extended-properties" if !rel.external => app_properties(&mut reader, &rel)?,
            _ => reader.target(&rel)?,
        };
        out.add(Owner::Package, &format!("rel:{}", rel.kind), None, value);
    }
    let workbook_rels = reader.package.rels(&workbook)?;
    let find = |kind: &str| {
        workbook_rels
            .iter()
            .find(|rel| rel.kind == kind && !rel.external)
            .map(|rel| normalize(&rel.target))
    };
    let xml = |reader: &mut Reader<'_>, kind: &str| -> Result<Option<Node>, InventoryError> {
        let Some(part) = find(kind) else {
            return Ok(None);
        };
        let Some(bytes) = reader.read(&part)? else {
            return Ok(None);
        };
        parse(&bytes, &part, &mut reader.budget, None, &mut |_| Ok(())).map(Some)
    };
    let theme = xml(&mut reader, "theme")?;
    let mut styles = match xml(&mut reader, "styles")? {
        Some(styles) => Some(styles),
        None => Some(parse(
            NEW_WORKBOOK_STYLES.as_bytes(),
            "styles",
            &mut reader.budget,
            None,
            &mut |_| Ok(()),
        )?),
    };
    reader.colors = Colors::new(styles.as_ref(), theme.as_ref());
    if let Some(styles) = &mut styles {
        reader.colors.fix(styles, false);
    }
    let styles = styles.as_ref().map(read_styles).unwrap_or_default();
    let mut strings: Vec<String> = Vec::new();
    if let Some(part) = find("sharedStrings") {
        if let Some(bytes) = reader.read(&part)? {
            let colors = &reader.colors;
            parse(
                &bytes,
                &part,
                &mut reader.budget,
                Some(("sst", "si")),
                &mut |mut si| {
                    colors.fix(&mut si, false);
                    strings.push(rich_text(&si));
                    Ok(())
                },
            )?;
        }
    }
    let metadata = match find("sheetMetadata") {
        Some(part) => match reader.read(&part)? {
            Some(bytes) => Some(parse(&bytes, &part, &mut reader.budget, None, &mut |_| {
                Ok(())
            })?),
            None => None,
        },
        None => None,
    };
    let metadata = Metadata::new(metadata.as_ref());

    let bytes = reader
        .read(&workbook)?
        .ok_or_else(|| InventoryError::Missing(workbook.clone()))?;
    let root = parse(&bytes, &workbook, &mut reader.budget, None, &mut |_| Ok(()))?;
    // I fogli: `sheetId` di ogni voce, per tradurre `localSheetId` (una
    // posizione) e `activeTab`.
    let entries: Vec<&Node> = root
        .child("sheets")
        .map(|sheets| sheets.children("sheet").collect())
        .unwrap_or_default();
    let ids: Vec<u32> = entries
        .iter()
        .map(|entry| {
            entry
                .attr("sheetId")
                .and_then(|id| id.parse().ok())
                .unwrap_or(0)
        })
        .collect();
    let mut used: HashSet<String> = HashSet::new();
    for kid in &root.kids {
        match kid.name.as_str() {
            "sheets" => {
                for (index, entry) in entries.iter().enumerate() {
                    let rel = entry
                        .attr("r:id")
                        .and_then(|id| workbook_rels.iter().find(|rel| rel.id == id));
                    if let Some(rel) = rel {
                        used.insert(rel.id.clone());
                    }
                    let mut value = format!(
                        "{:?} {}",
                        entry.attr("name").unwrap_or(""),
                        entry.attr("state").unwrap_or("visible")
                    );
                    match rel {
                        Some(rel) if rel.kind == "worksheet" && !rel.external => {
                            out.sheets.push(ids[index]);
                            sheet(
                                &mut reader,
                                &mut out,
                                ids[index],
                                &normalize(&rel.target),
                                &styles,
                                &strings,
                                &metadata,
                            )?;
                            value.push_str(" worksheet");
                        }
                        Some(rel) => value.push_str(&format!(" {}", reader.target(rel)?)),
                        None => value.push_str(" (no part)"),
                    }
                    // Il posto del foglio fra gli altri conta: l'ordine delle
                    // schede è contenuto.
                    out.add(
                        Owner::Workbook,
                        "sheet",
                        Some((index as u32, ids[index])),
                        value,
                    );
                }
            }
            "definedNames" => {
                for name in kid.children("definedName") {
                    let mut name = name.clone();
                    for (key, value) in &mut name.attrs {
                        if key == "localSheetId" {
                            let index: usize = value.parse().unwrap_or(usize::MAX);
                            *value = format!(
                                "sheet {}",
                                ids.get(index).map_or("?".into(), |id| id.to_string())
                            );
                        }
                    }
                    out.add(
                        Owner::Workbook,
                        "definedName",
                        None,
                        canonical(&name, &mut |_, _, _| None),
                    );
                }
            }
            "bookViews" => {
                for view in kid.children("workbookView") {
                    // La finestra (posizione, misure) è dell'applicazione; la
                    // scheda attiva si conta per `sheetId`.
                    let tab: usize = view
                        .attr("activeTab")
                        .and_then(|tab| tab.parse().ok())
                        .unwrap_or(0);
                    let mut view = view.clone();
                    view.attrs.retain(|(key, _)| {
                        !matches!(
                            key.as_str(),
                            "xWindow"
                                | "yWindow"
                                | "windowWidth"
                                | "windowHeight"
                                | "activeTab"
                                | "firstSheet"
                                | "tabRatio"
                        )
                    });
                    out.add(
                        Owner::Workbook,
                        "workbookView",
                        None,
                        format!(
                            "{} active {}",
                            canonical(&view, &mut |_, _, _| None),
                            ids.get(tab).copied().unwrap_or(0)
                        ),
                    );
                }
            }
            "calcPr" => {
                let mut calc = kid.clone();
                // Il numero della versione di calcolo dice chi ha calcolato.
                calc.attrs
                    .retain(|(key, _)| !matches!(key.as_str(), "calcId" | "forceFullCalc"));
                out.add(
                    Owner::Workbook,
                    "calcPr",
                    None,
                    canonical(&calc, &mut |_, _, _| None),
                );
            }
            "fileVersion" => {
                // Chi ha salvato, non che cosa.
            }
            "mc:AlternateContent" if only_save_path(kid) => {
                // Dove il file è stato salvato l'ultima volta, non che cosa.
            }
            name => {
                let value = reader.canonical_with_rels(kid, &workbook_rels, &mut used, "")?;
                if value != format!("<{name}></>") {
                    out.add(Owner::Workbook, name, None, value);
                }
            }
        }
    }
    for rel in &workbook_rels {
        if used.contains(&rel.id) || resolved_kind(&rel.kind) {
            continue;
        }
        let value = reader.target(rel)?;
        out.add(Owner::Workbook, &format!("rel:{}", rel.kind), None, value);
    }
    Ok(out)
}

/// Il blocco di compatibilità che porta soltanto `x15ac:absPath`, la cartella
/// in cui Excel ha salvato il file.
fn only_save_path(node: &Node) -> bool {
    const NS_X15AC: &str = "{http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac}absPath";
    let choices: Vec<&Node> = node.kids.iter().collect();
    !choices.is_empty()
        && choices.iter().all(|choice| {
            (choice.name == "mc:Choice" && choice.kids.iter().all(|kid| kid.name == NS_X15AC))
                || (choice.name == "mc:Fallback" && choice.kids.is_empty())
        })
}

/// Le proprietà dell'applicazione che sono del documento.
fn app_properties(reader: &mut Reader<'_>, rel: &Rel) -> Result<String, InventoryError> {
    let part = normalize(&rel.target);
    let Some(bytes) = reader.read(&part)? else {
        return Ok("(missing)".into());
    };
    let root = parse(&bytes, &part, &mut reader.budget, None, &mut |_| Ok(()))?;
    let mut out = String::new();
    for kid in &root.kids {
        let local = kid.name.trim_start_matches("ep:");
        if matches!(local, "Company" | "Manager" | "HyperlinkBase") && !kid.text.is_empty() {
            out.push_str(&format!("{local}={:?} ", kid.text));
        }
    }
    Ok(out)
}

/// Il testo di una stringa (`si`, `is`): il solo testo se è semplice, la
/// forma canonica dei run se ne ha.
pub(super) fn rich_text(node: &Node) -> String {
    if node.kids.len() == 1 && node.kids[0].name == "t" {
        return format!("{:?}", node.kids[0].text);
    }
    let mut out = String::new();
    for kid in &node.kids {
        match kid.name.as_str() {
            "t" => out.push_str(&format!("{:?}", kid.text)),
            "r" => {
                out.push_str("<r");
                if let Some(props) = kid.child("rPr") {
                    out.push(' ');
                    out.push_str(&font_canonical(props));
                }
                out.push('>');
                if let Some(text) = kid.child("t") {
                    out.push_str(&format!("{:?}", text.text));
                }
            }
            _ => out.push_str(&canonical(kid, &mut |_, _, _| None)),
        }
    }
    out
}
