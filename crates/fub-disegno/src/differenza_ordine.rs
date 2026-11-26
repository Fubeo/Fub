//! La differenza, prima parte: gli elementi composti, i tolti, l'ordine e i nuovi.

use super::*;

impl Lavoro<'_> {
    /// I tracciati composti fatti o sciolti dal gesto ([`Lavoro::liberati`],
    /// [`Lavoro::assorbiti`]).
    pub(super) fn composti(&mut self, prima: &Posti<'_>, poi: &Posti<'_>) {
        // Un tracciato composto, una forma composta (un gruppo segnato), una
        // fusione o un gruppo degli Oggetti sul tracciato: il file li tiene
        // come un solo elemento con la ricetta.
        let composto = |n: Option<&crate::mappa::Posto<'_>>| {
            n.is_some_and(|p| {
                matches!(
                    p.nodo.kind,
                    NodeKind::Compound { .. } | NodeKind::Blend { .. }
                ) || p.nodo.is_compound_shape()
                    || vectorcraft_doc::objects_on_path::is_objects_on_path(p.nodo)
            })
        };
        for (id, dopo) in &poi.nodi {
            let Some(p) = prima.nodi.get(id) else {
                continue;
            };
            if p.genitore == dopo.genitore {
                continue;
            }
            let di_fub = self.copia.mappa.del_nodo(*id).is_some();
            let nuovo_genitore = dopo.genitore.filter(|g| !prima.nodi.contains_key(g));
            // Le sorgenti di un gruppo del Sagomatore nuovo sono nella sua
            // ricetta, anche quelle che venivano da un gruppo di prima (che
            // nel file non erano elementi). Un elemento del file che va fra
            // le sorgenti di un gruppo di prima (Unisci della Pittura
            // dinamica) entra nella ricetta del gruppo, riscritto.
            let nel_sagomatore =
                in_un_sagomatore(nuovo_genitore, poi, |g| !prima.nodi.contains_key(&g))
                    || (di_fub && fra_le_sorgenti_vive(dopo.genitore, poi));
            // Anche i pezzi di un composto di prima che passano in uno nuovo
            // (una fusione che prende altre chiavi: le sue stanno nella
            // ricetta di quella nuova).
            let da_un_composto = composto(p.genitore.and_then(|g| prima.nodi.get(&g)));
            if nel_sagomatore
                || ((di_fub || da_un_composto)
                    && composto(nuovo_genitore.and_then(|g| poi.nodi.get(&g))))
            {
                self.assorbiti.insert(*id);
            } else if !di_fub
                && (composto(p.genitore.and_then(|g| prima.nodi.get(&g)))
                    || in_un_sagomatore(p.genitore, prima, |_| true))
            {
                self.liberati.insert(*id);
            }
        }
    }

    pub(super) fn elemento(&self, nodo: NodeId) -> Option<&Elemento> {
        self.copia
            .mappa
            .del_nodo(nodo)
            .and_then(|i| self.copia.mappa.elemento(i))
    }

    /// Vero se l'elemento o un suo antenato è bloccato nel file.
    pub(super) fn bloccato(&self, e: &Elemento) -> bool {
        let mut corrente = Some(e);
        while let Some(x) = corrente {
            if x.bloccato {
                return true;
            }
            corrente = x.genitore.and_then(|g| self.copia.mappa.elemento(g));
        }
        false
    }

    /// Vero se il genitore dell'elemento `e` dà ai figli la regola `evenodd`.
    pub(super) fn evenodd_ereditato(&self, e: &Elemento) -> bool {
        e.genitore
            .and_then(|g| self.copia.mappa.elemento(g))
            .is_some_and(|p| p.evenodd)
    }

    /// Vero se l'oggetto del motore `genitore`, dove va un oggetto nuovo, dà
    /// ai figli la regola `evenodd`: un elemento del file la sua, un gruppo
    /// nuovo quella del suo genitore, la radice e un livello nuovo `nonzero`.
    pub(super) fn evenodd_dentro(&self, genitore: Option<NodeId>) -> bool {
        let mut corrente = genitore;
        while let Some(id) = corrente {
            if let Some(e) = self.elemento(id) {
                return e.evenodd;
            }
            corrente = self.gruppi_nuovi.get(&id).copied().flatten();
        }
        false
    }

    pub(super) fn id_nuovo(&mut self, specie: Specie) -> Result<String, Rifiuto> {
        let mappa = &self.copia.mappa;
        let dati = &self.dati;
        let id = id::nuovo(specie, &|id| mappa.id_preso(id) || dati.contains(id))
            .ok_or_else(|| no("nessun id nuovo libero"))?;
        self.dati.insert(id.clone());
        Ok(id)
    }

    /// L'id con cui le operazioni nominano l'oggetto `nodo`: quello del file,
    /// o uno nuovo dato con `ident` (una volta sola per gesto).
    pub(super) fn bersaglio(&mut self, nodo: NodeId) -> Result<String, Rifiuto> {
        if let Some(id) = self.ids.get(&nodo) {
            return Ok(id.clone());
        }
        let Some(e) = self.elemento(nodo) else {
            return Err(Rifiuto::NonMappato(format!(
                "l'oggetto {} del motore non viene da un elemento di Fub",
                nodo.0
            )));
        };
        if let Some(id) = e.id_del_file() {
            return Ok(id.to_string());
        }
        let (percorso, tag) = (e.percorso.clone(), e.tag);
        let specie = if e.ruolo == fub_scene::Role::Layer {
            Specie::Livello
        } else {
            Specie::Oggetto
        };
        let id = self.id_nuovo(specie)?;
        self.ident
            .push(json!({ "op": "ident", "path": percorso, "tag": tag, "id": id }));
        self.ids.insert(nodo, id.clone());
        Ok(id)
    }

    /// Il genitore come lo scrivono le operazioni: `#root` o un id.
    pub(super) fn genitore(&mut self, nodo: Option<NodeId>) -> Result<String, Rifiuto> {
        match nodo {
            None => Err(no("un livello nuovo del motore")),
            Some(g) if self.copia.mappa.e_radice(g) => Ok("#root".into()),
            Some(g) => self.bersaglio(g),
        }
    }

    /// Dallo spazio del genitore `nodo` al documento del motore.
    pub(super) fn matrice_del_genitore(&self, nodo: Option<NodeId>) -> Result<Affine, Rifiuto> {
        match nodo {
            Some(g) if self.copia.mappa.e_radice(g) => Ok(self.copia.radice),
            Some(g) if self.gruppi_nuovi.contains_key(&g) => {
                self.matrice_del_genitore(self.gruppi_nuovi[&g])
            }
            Some(g) => self
                .elemento(g)
                .ok_or_else(|| {
                    Rifiuto::NonMappato("il genitore non viene da un elemento di Fub".into())
                })?
                .ctm()
                .ok_or_else(|| no("una transform del genitore non si legge")),
            None => Ok(self.copia.radice),
        }
    }

    /// Gli oggetti tolti: un `remove` per il più alto di ognuno.
    pub(super) fn tolti(&mut self, prima: &Posti<'_>, poi: &Posti<'_>) -> Result<(), Rifiuto> {
        for (id, posto) in &prima.nodi {
            if poi.nodi.contains_key(id) {
                continue;
            }
            if posto.genitore.is_some_and(|g| !poi.nodi.contains_key(&g)) {
                continue;
            }
            if self.dentro_un_riscritto(posto.genitore, prima) {
                continue;
            }
            if self.copia.mappa.e_radice(*id) {
                return Err(no("il gesto toglie un livello del motore"));
            }
            let Some(e) = self.elemento(*id) else {
                return Err(Rifiuto::NonMappato(format!(
                    "il gesto toglie l'oggetto {} che non viene da Fub",
                    id.0
                )));
            };
            let e = e.clone();
            self.togli(&e);
        }
        for nodo in self.assorbiti.clone() {
            if let Some(e) = self.elemento(nodo).cloned() {
                self.togli(&e);
            }
        }
        for nodo in self.riscritti.clone() {
            let Some(e) = self.elemento(nodo).cloned() else {
                return Err(Rifiuto::NonMappato(format!(
                    "il gesto riscrive l'oggetto {} che non viene da Fub",
                    nodo.0
                )));
            };
            self.togli(&e);
        }
        Ok(())
    }

    /// Il `remove` dell'elemento `e`; le ricette sue e dei suoi discendenti
    /// cadono.
    pub(super) fn togli(&mut self, e: &Elemento) {
        let bersaglio = match e.id_del_file() {
            Some(id) => json!(id),
            None => json!({ "path": e.percorso, "tag": e.tag }),
        };
        self.remove.push((
            e.percorso.clone(),
            json!({ "op": "remove", "target": bersaglio }),
        ));
        for d in self.copia.mappa.elementi() {
            if d.percorso.starts_with(&e.percorso) {
                if let Some(id) = &d.id {
                    self.ricette.via.insert(id.clone());
                }
            }
        }
    }

    /// Vero se `nodo` o un suo antenato in `posti` si riscrive intero.
    pub(super) fn dentro_un_riscritto(&self, mut nodo: Option<NodeId>, posti: &Posti<'_>) -> bool {
        while let Some(n) = nodo {
            if self.riscritti.contains(&n) {
                return true;
            }
            nodo = posti.nodi.get(&n).and_then(|p| p.genitore);
        }
        false
    }

    /// L'ordine e il genitore degli oggetti che ci sono prima e dopo: un
    /// `move` per ognuno fuori dalla sottosequenza crescente più lunga dei
    /// fratelli rimasti.
    pub(super) fn ordine(&mut self, prima: &Posti<'_>, dopo: &Document) -> Result<(), Rifiuto> {
        let mut contenitori: Vec<(Option<NodeId>, &Vec<Arc<Node>>)> = Vec::new();
        fn raccogli<'a>(
            n: &'a Arc<Node>,
            riscritti: &HashSet<NodeId>,
            prima: &Posti<'_>,
            out: &mut Vec<(Option<NodeId>, &'a Vec<Arc<Node>>)>,
        ) {
            if riscritti.contains(&n.id) {
                return;
            }
            // Un tracciato composto o una forma composta nuovi si scrivono
            // interi: i loro pezzi non si spostano dentro di loro.
            let composto = matches!(n.kind, NodeKind::Compound { .. }) || n.is_compound_shape();
            if composto && !prima.nodi.contains_key(&n.id) {
                return;
            }
            if let Some(figli) = n.children() {
                out.push((Some(n.id), figli));
                for c in figli {
                    raccogli(c, riscritti, prima, out);
                }
            }
        }
        // La cima del motore per prima: senza la carta i livelli di Fub
        // sono i livelli in cima, e il loro ordine è quello dei figli della
        // radice.
        contenitori.push((None, &dopo.layers));
        for l in &dopo.layers {
            raccogli(l, &self.riscritti, prima, &mut contenitori);
        }
        for (genitore, figli) in contenitori {
            // Solo i figli che c'erano già; i nuovi e i riscritti li mette
            // `add`.
            let rimasti: Vec<&Arc<Node>> = figli
                .iter()
                .filter(|c| {
                    prima.nodi.contains_key(&c.id)
                        && !self.riscritti.contains(&c.id)
                        && !self.liberati.contains(&c.id)
                        && !self.assorbiti.contains(&c.id)
                        // La forma che ritaglia sta nel `clipPath`, non fra i
                        // figli del gruppo nel file.
                        && !self.elemento(c.id).is_some_and(|e| e.ritaglia)
                })
                .collect();
            let chiavi: Vec<Option<usize>> = rimasti
                .iter()
                .map(|c| {
                    prima
                        .nodi
                        .get(&c.id)
                        .filter(|p| p.genitore == genitore)
                        .map(|p| p.indice)
                })
                .collect();
            let fermi = sottosequenza_crescente(&chiavi);
            if fermi.len() == rimasti.len() {
                continue;
            }
            for (i, c) in rimasti.iter().enumerate() {
                if fermi.contains(&i) {
                    continue;
                }
                let spostato_di_genitore = chiavi[i].is_none();
                if spostato_di_genitore {
                    let vecchio = prima.nodi.get(&c.id).and_then(|p| p.genitore);
                    let (a, b) = (
                        self.matrice_del_genitore(vecchio)?,
                        self.matrice_del_genitore(genitore)?,
                    );
                    if !matrici_vicine(a, b) {
                        return Err(no(
                            "lo spostamento in un altro gruppo cambierebbe la sua transform",
                        ));
                    }
                }
                let target = self.bersaglio(c.id)?;
                let parent = match genitore {
                    None => "#root".to_string(),
                    Some(_) => self.genitore(genitore)?,
                };
                let pos = match i.checked_sub(1).and_then(|j| rimasti.get(j)) {
                    Some(prec) => json!({ "after": self.bersaglio(prec.id)? }),
                    None => self.primo_fra(genitore),
                };
                let op = json!({ "op": "move", "target": target, "parent": parent, "pos": pos });
                match genitore {
                    Some(g) if self.gruppi_nuovi.contains_key(&g) => self.dentro.push(op),
                    _ => self.moves.push(op),
                }
            }
        }
        Ok(())
    }

    /// Gli oggetti nuovi: un `add` per il più alto di ognuno.
    pub(super) fn nuovi(&mut self, prima: &Posti<'_>, dopo: &Document) -> Result<(), Rifiuto> {
        // Un oggetto nuovo: il genitore, i fratelli dopo il gesto, il posto.
        type Nuovo<'a> = (Option<NodeId>, Vec<&'a Arc<Node>>, usize);
        let mut nuovi: Vec<Nuovo<'_>> = Vec::new();
        fn cerca<'a>(
            n: &'a Arc<Node>,
            prima: &Posti<'_>,
            riscritti: &HashSet<NodeId>,
            liberati: &HashSet<NodeId>,
            out: &mut Vec<Nuovo<'a>>,
        ) {
            let Some(figli) = n.children() else { return };
            for (i, c) in figli.iter().enumerate() {
                if prima.nodi.contains_key(&c.id)
                    && !riscritti.contains(&c.id)
                    && !liberati.contains(&c.id)
                {
                    cerca(c, prima, riscritti, liberati, out);
                } else {
                    out.push((Some(n.id), figli.iter().collect(), i));
                }
            }
        }
        for (i, l) in dopo.layers.iter().enumerate() {
            if !prima.nodi.contains_key(&l.id) {
                self.livello_nuovo(dopo, i)?;
                // Il contenuto di un livello nuovo: gli oggetti nuovi
                // (Duplica livello) dentro, dopo il `g`, ciascuno col suo
                // `add`; quelli di prima (Raccogli in un nuovo livello) con un
                // `move` ([`Lavoro::ordine`]). Il livello nuovo sta alla radice
                // e non ha una transform.
                if let Some(figli) = l.children().filter(|f| !f.is_empty()) {
                    self.gruppi_nuovi.insert(l.id, None);
                    // La forma di un livello che ritaglia è nel suo `clipPath`.
                    let figli: Vec<&Arc<Node>> =
                        figli.iter().skip(usize::from(l.clips())).collect();
                    if !self.figli_di_prima(&figli, prima)? {
                        nuovi.extend((0..figli.len()).map(|j| (Some(l.id), figli.clone(), j)));
                    }
                }
                continue;
            }
            cerca(l, prima, &self.riscritti, &self.liberati, &mut nuovi);
        }
        // Lo stampo del corpo espanso, fatto alla prima ricetta del gesto.
        let mut stampo: Option<crate::espansa::Stampo> = None;
        let mut k = 0;
        while k < nuovi.len() {
            let (genitore, fratelli, i) = nuovi[k].clone();
            k += 1;
            let nodo = fratelli[i];
            let parent = self.genitore(genitore)?;
            let locale = self.matrice_del_genitore(genitore)?.inverse();
            if !locale.is_finite() {
                return Err(no("il genitore ha una transform che non si inverte"));
            }
            let riscritto = self.riscritti.contains(&nodo.id);
            if !riscritto && ritagli::ritaglio_nuovo(nodo, prima, &self.assorbiti, &self.riscritti)
            {
                let pos = self.posto(genitore, &fratelli, i)?;
                self.scrivi_ritaglio(nodo, genitore, parent, pos, locale)?;
                continue;
            }
            // Un sottolivello nuovo (Nuovo sottolivello, Raccogli in un nuovo
            // livello, ADR 0251): il `g` col suo `fub:layer`; gli oggetti che
            // c'erano già ci vanno con un `move` ([`Lavoro::ordine`]), quelli
            // nuovi dopo, ciascuno col suo `add`.
            if !riscritto && nodo.is_layer() {
                let figli: Vec<&Arc<Node>> = nodo
                    .children()
                    .map(|f| f.iter().skip(usize::from(nodo.clips())).collect())
                    .unwrap_or_default();
                let di_prima = self.figli_di_prima(&figli, prima)?;
                let attrs = self.attributi_del_livello(nodo, genitore)?;
                self.gruppi_nuovi.insert(nodo.id, genitore);
                let pos = self.posto(genitore, &fratelli, i)?;
                self.add.push(json!({
                    "op": "add", "parent": parent, "pos": pos,
                    "elem": { "tag": "g", "attrs": attrs, "children": [] },
                }));
                if !di_prima {
                    let dentro = (0..figli.len()).map(|j| (Some(nodo.id), figli.clone(), j));
                    nuovi.splice(k..k, dentro);
                }
                continue;
            }
            if !riscritto && gruppo_di_prima(nodo, prima, &self.riscritti) {
                let id = self.id_nuovo(Specie::Oggetto)?;
                self.ids.insert(nodo.id, id.clone());
                self.gruppi_nuovi.insert(nodo.id, genitore);
                let pos = self.posto(genitore, &fratelli, i)?;
                self.add.push(json!({
                    "op": "add", "parent": parent, "pos": pos,
                    "elem": { "tag": "g", "attrs": { "id": id } },
                }));
                continue;
            }
            // Un gruppo semplice nuovo fatto solo di pezzi nuovi (i pezzi che
            // l'Elaborazione tracciati lascia divisi): il `g`, poi ogni pezzo
            // dentro, subito dopo, ciascuno con il suo `add`.
            if let Some(nome) = (!riscritto)
                .then(|| gruppo_tutto_nuovo(nodo, prima, &self.copia.mappa))
                .flatten()
            {
                let id = self.id_nuovo(Specie::Oggetto)?;
                self.ids.insert(nodo.id, id.clone());
                self.gruppi_nuovi.insert(nodo.id, genitore);
                let pos = self.posto(genitore, &fratelli, i)?;
                let mut elem = json!({ "tag": "g", "attrs": { "id": id } });
                if let Some(nome) = nome {
                    elem["children"] = json!([{ "tag": "title", "attrs": {}, "text": nome }]);
                }
                self.add
                    .push(json!({ "op": "add", "parent": parent, "pos": pos, "elem": elem }));
                if let Some(figli) = nodo.children() {
                    let figli: Vec<&Arc<Node>> = figli.iter().collect();
                    let dentro = (0..figli.len()).map(|j| (Some(nodo.id), figli.clone(), j));
                    nuovi.splice(k..k, dentro);
                }
                continue;
            }
            // Un testo riscritto intero: lo stesso id, gli attributi e le
            // righe nuove.
            if let Some(testo) = self.testi_riscritti.get(&nodo.id).cloned() {
                let id = self
                    .elemento(nodo.id)
                    .and_then(Elemento::id_del_file)
                    .map(str::to_string)
                    .ok_or_else(|| no("un testo senza id non si riscrive"))?;
                let mut attrs = Map::new();
                attrs.insert("id".into(), json!(id));
                attrs.extend(testo.attrs);
                self.ids.insert(nodo.id, id);
                let pos = self.posto(genitore, &fratelli, i)?;
                self.add.push(json!({
                    "op": "add", "parent": parent, "pos": pos,
                    "elem": { "tag": "text", "attrs": attrs, "children": testo.righe },
                }));
                continue;
            }
            // Un'istanza di un simbolo del file: un `use`.
            // Come in VectorCraft, solo se il `<symbol>` sotto la sua
            // transform disegna come il motore: se no, la sua copia dell'arte.
            if let NodeKind::SymbolInstance { symbol, xf } = &nodo.kind {
                let scala = self
                    .simboli
                    .scale
                    .get(symbol)
                    .copied()
                    .unwrap_or(Affine::IDENTITY);
                let rid = self
                    .simboli
                    .ids
                    .get(symbol)
                    .filter(|_| self.simboli.si_riusa(symbol, *xf * scala.inverse()))
                    .cloned();
                if let Some(rid) = rid {
                    let vecchio = riscritto
                        .then(|| self.elemento(nodo.id).and_then(Elemento::id_del_file))
                        .flatten()
                        .map(str::to_string);
                    let id = match vecchio {
                        Some(id) => id,
                        None => self.id_nuovo(Specie::Oggetto)?,
                    };
                    let attrs =
                        attributi_dell_istanza(nodo, &id, locale * *xf * scala.inverse(), &rid)?;
                    self.ids.insert(nodo.id, id.clone());
                    let pos = self.posto(genitore, &fratelli, i)?;
                    self.add.push(json!({
                        "op": "add", "parent": parent, "pos": pos,
                        "elem": { "tag": "use", "attrs": attrs },
                    }));
                    continue;
                }
            }
            // Un oggetto riscritto tiene il suo id se è già della forma nuova.
            let vecchio = riscritto
                .then(|| self.elemento(nodo.id).and_then(Elemento::id_del_file))
                .flatten()
                .filter(|id| id::e_nuovo(id, Specie::Oggetto))
                .map(str::to_string);
            let id = match vecchio {
                Some(id) => id,
                None => self.id_nuovo(Specie::Oggetto)?,
            };
            // Una linea a spessore variabile che il formato sa dire va col suo `fub:shape`, non
            // con la ricetta (`profilo::motore`).
            let scritto = match crate::profilo::motore::nel_file(nodo, locale) {
                Some((v, colore)) => {
                    let mut attrs = Map::new();
                    attrs.insert("fub:shape".into(), json!("width"));
                    attrs.insert("fub:geom".into(), json!(v.geom));
                    attrs.insert("d".into(), json!(v.d));
                    attrs.insert(
                        "fill".into(),
                        json!(scrivi_colore(&self.riferimenti, Some(colore))?),
                    );
                    Some(("path".to_string(), attrs))
                }
                None if riscritto => None,
                None => self.scrittore.and_then(|s| s(nodo, locale)),
            };
            // Un oggetto ricco, o uno riscritto, va con il corpo espanso (la
            // grafica che il motore disegna) e la sua ricetta, se nessuno dei
            // suoi pezzi c'era già.
            let con_ricetta = scritto.is_none()
                && (riscritto
                    || (ricetta::esito_albero(nodo) > Esito::Corpo
                        && !ha_pezzi_rimasti(nodo, prima, &self.assorbiti)));
            let elem_o_raw = if con_ricetta {
                let stampo = stampo.get_or_insert_with(|| crate::espansa::Stampo::di(dopo));
                let raw = stampo
                    .corpo(nodo, locale, &id, &mut |specie| {
                        self.id_nuovo(specie).map_err(|e| format!("{e:?}"))
                    })
                    .map_err(no)?
                    .ok_or(Rifiuto::Vuoto)?;
                // Riscritto senza più niente che solo il motore sa dire (gli
                // Oggetti sul tracciato espansi: lo stesso gruppo, ora
                // semplice): il corpo basta, e la ricetta di prima cade. Un
                // tracciato che non disegna niente la tiene: l'import non lo
                // porterebbe.
                if ricetta::esito_albero(nodo) > Esito::Corpo || ricetta::non_disegna(nodo) {
                    let byte = ricetta::codifica(nodo, locale).map_err(no)?;
                    self.ricette.nuove.push(vectorcraft_svg::recipe_element(
                        &id,
                        &ricetta::impronta(&raw),
                        &byte,
                    ));
                }
                self.stato_del_corpo(nodo, riscritto, &id);
                json!({ "raw": raw })
            } else {
                let (tag, mut attrs) = match scritto {
                    Some(e) => e,
                    None => elem(
                        nodo,
                        locale,
                        &self.riferimenti,
                        self.evenodd_dentro(genitore),
                    )?,
                };
                attrs.insert("id".into(), json!(id));
                if e_guida(nodo) {
                    attrs.insert("fub:guide".into(), json!("true"));
                    attrs.insert("display".into(), json!("none"));
                }
                json!({ "elem": { "tag": tag, "attrs": attrs } })
            };
            self.ids.insert(nodo.id, id);
            let pos = self.posto(genitore, &fratelli, i)?;
            let mut op = json!({ "op": "add", "parent": parent, "pos": pos });
            if let (Some(op), Value::Object(corpo)) = (op.as_object_mut(), elem_o_raw) {
                op.extend(corpo);
            }
            self.add.push(op);
        }
        Ok(())
    }
}
