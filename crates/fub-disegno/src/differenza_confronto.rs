//! La differenza, il confronto: istanze, figli e foglie messi a fronte con quelli di prima.

use super::*;

impl Lavoro<'_> {
    /// Gli oggetti che ci sono prima e dopo, dall'alto: i `set`.
    pub(super) fn confronta(
        &mut self,
        b: &Arc<Node>,
        a: &Arc<Node>,
        prima: &Posti<'_>,
    ) -> Result<(), Rifiuto> {
        if uguali(b, a) {
            return Ok(());
        }
        let b = &self.stato(b, a)?;
        if uguali(b, a) {
            return Ok(());
        }
        if let Some(e) = self.elemento(a.id).filter(|e| e.ritaglia).cloned() {
            return self.forma_del_ritaglio(&e, b, a);
        }
        let radice = self.copia.mappa.e_radice(a.id);
        let livello = matches!(a.kind, NodeKind::Layer { .. })
            || self
                .elemento(a.id)
                .is_some_and(|e| e.ruolo == fub_scene::Role::Layer);
        let oggetto = if radice || livello {
            None
        } else {
            self.elemento(a.id).cloned()
        };
        if let Some(e) = &oggetto {
            if let Some(fatto) = self.istanza(e, b, a)? {
                return Ok(fatto);
            }
        }
        if let Some(e) = oggetto {
            // Una linea a spessore variabile, prima o dopo: spostata, ruotata o scalata cambia
            // solo la sua `transform`; ogni altro cambio la riscrive intera, col suo `fub:geom`
            // o come tracciato (`profilo::motore`).
            let variabile = |n: &Node| crate::profilo::motore::variabile(n).is_some();
            if variabile(b) || variabile(a) {
                if let Some(m) = self.adatta(b, a) {
                    if mosso_da(b, m, true).is_some_and(|c| nodi_vicini(&c, a)) {
                        if !vicina_all_identita(m) {
                            let t = nuova_trasformazione(&e, m)?;
                            let id = self.bersaglio(a.id)?;
                            self.set.push(json!({ "op": "set", "id": id, "attrs": { "transform": scrivi_matrice(t) } }));
                        }
                        return Ok(());
                    }
                }
                self.riscritti.insert(a.id);
                return Ok(());
            }
            let con_ricetta =
                e.id.as_deref()
                    .is_some_and(|id| self.copia.mappa.ricette().applicata(id));
            if con_ricetta {
                // Spostato, ruotato o scalato: cambia solo la sua `transform`
                // e la ricetta resta. Ogni altro cambio lo riscrive intero.
                if let Some(m) = self.adatta(b, a) {
                    if mosso_da(b, m, true).is_some_and(|c| nodi_vicini(&c, a)) {
                        if !vicina_all_identita(m) {
                            let t = nuova_trasformazione(&e, m)?;
                            let id = self.bersaglio(a.id)?;
                            self.set.push(json!({ "op": "set", "id": id, "attrs": { "transform": scrivi_matrice(t) } }));
                        }
                        return Ok(());
                    }
                }
                self.riscritti.insert(a.id);
                return Ok(());
            }
            // Gli oggetti di un gruppo, e quelli con una ricetta loro, non
            // fanno ricco questo: il confronto scende fino a loro, e ognuno si
            // scrive per sé (spostato, o riscritto con la sua ricetta).
            let (propria_a, propria_b) = (self.propria(a), self.propria(b));
            if ricetta::esito_albero(&propria_a) > Esito::Corpo {
                // Ricco. Se i suoi costrutti cambiano, gli attributi non li
                // direbbero: si riscrive intero con la sua ricetta. Il
                // tratteggio semplice fa eccezione: `stroke-dasharray` lo
                // dice, e `foglia` lo scrive (o rifiuta, e si riscrive). Un
                // gruppo che comincia a ritagliare col suo oggetto più alto
                // (`layer.clippingMask.toggle`) lo dice con `clip-path`: lo
                // scrive `ritaglio_messo`.
                let comincia_a_ritagliare = !b.clips() && a.clips();
                let senza_il_ritaglio = |n: &Node| {
                    let mut c = costrutti_non_detti(n);
                    if comincia_a_ritagliare {
                        c.retain(|c| *c != ricetta::Costrutto::Ritaglio);
                    }
                    c
                };
                if senza_il_ritaglio(&propria_a) != senza_il_ritaglio(&propria_b) {
                    self.riscritti.insert(a.id);
                    return Ok(());
                }
                // Gli stessi di prima: se il cambio non si scrive come
                // attributi, si riscrive intero.
                let prima_del_tentativo = (
                    self.ident.len(),
                    self.set.len(),
                    self.ids.clone(),
                    self.dati.clone(),
                    self.riscritti.clone(),
                    self.sfumature.len(),
                );
                match self.confronta_comune(b, a, prima, radice, livello) {
                    Ok(()) => return Ok(()),
                    Err(_) => {
                        let (ident, set, ids, dati, riscritti, sfumature) = prima_del_tentativo;
                        self.ident.truncate(ident);
                        self.set.truncate(set);
                        self.sfumature.truncate(sfumature);
                        self.ids = ids;
                        self.dati = dati;
                        self.riscritti = riscritti;
                        self.riscritti.insert(a.id);
                        return Ok(());
                    }
                }
            }
        }
        self.confronta_comune(b, a, prima, radice, livello)
    }

    /// Un'istanza scritta come `use` di un simbolo del file, che resta
    /// un'istanza: la sua `transform`, il suo simbolo (`href`) e l'opacità
    /// si scrivono come attributi. `None` se non è un'istanza così.
    pub(super) fn istanza(
        &mut self,
        e: &Elemento,
        b: &Node,
        a: &Node,
    ) -> Result<Option<()>, Rifiuto> {
        let (
            NodeKind::SymbolInstance { symbol: sb, xf: xb },
            NodeKind::SymbolInstance { symbol: sa, xf: xa },
        ) = (&b.kind, &a.kind)
        else {
            return Ok(None);
        };
        if e.tag != "use" {
            return Ok(None);
        }
        let (Some(prima), Some(dopo)) = (
            self.copia.simboli.del_nome(sb).map(|s| s.id.clone()),
            self.simboli.ids.get(sa).cloned(),
        ) else {
            return Ok(None);
        };
        // Sotto una transform dove il `<symbol>` non disegna come il motore
        // si riscrive intero, con la sua copia dell'arte.
        let scala = self
            .simboli
            .scale
            .get(sa)
            .copied()
            .unwrap_or(Affine::IDENTITY);
        if !self.simboli.si_riusa(sa, *xa * scala.inverse()) {
            self.riscritti.insert(a.id);
            return Ok(Some(()));
        }
        let x = a.extras();
        if !a.appearance.items.is_empty()
            || !x.symbol_overrides.is_empty()
            || a.appearance != b.appearance
            || x.mask != b.extras().mask
            || a.blend != b.blend
        {
            return Err(no(
                "un'istanza con un aspetto suo, una maschera, una fusione o parti cambiate non si scrive nel file",
            ));
        }
        let mut attrs = Map::new();
        // La `transform` del `use` porta il contenuto scritto dove il motore
        // disegna l'arte: l'`xf` nello spazio del genitore, meno la misura
        // con cui il file tiene un'arte ridefinita.
        let cambiata = scala != Affine::IDENTITY
            || (xa.as_coeffs().iter().zip(xb.as_coeffs())).any(|(p, q)| (p - q).abs() > 1e-9);
        if cambiata {
            let g = e
                .ctm_genitore
                .ok_or_else(|| no("una transform di un antenato non si legge"))?;
            let t = g.inverse() * *xa * scala.inverse();
            if !t.is_finite() {
                return Err(no("la transform nuova non è finita"));
            }
            let uguale = e.propria.is_some_and(|p| {
                p.as_coeffs()
                    .iter()
                    .zip(t.as_coeffs())
                    .all(|(x, y)| (x - y).abs() < 1e-6)
            });
            if !uguale {
                attrs.insert("transform".into(), json!(scrivi_matrice(t)));
            }
        }
        if prima != dopo {
            attrs.insert("href".into(), json!(format!("#{dopo}")));
        }
        if (a.opacity - b.opacity).abs() > 1e-6 {
            attrs.insert("opacity".into(), json!(numero(f64::from(a.opacity), 3)));
        }
        if !attrs.is_empty() {
            let id = self.bersaglio(a.id)?;
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": attrs }));
        }
        Ok(Some(()))
    }

    /// Il confronto di un oggetto che non si riscrive intero.
    pub(super) fn confronta_comune(
        &mut self,
        b: &Arc<Node>,
        a: &Arc<Node>,
        prima: &Posti<'_>,
        radice: bool,
        livello: bool,
    ) -> Result<(), Rifiuto> {
        if let Some(attrs) = self.composto_cambiato(b, a)? {
            if !attrs.is_empty() {
                let id = self.bersaglio(a.id)?;
                self.set
                    .push(json!({ "op": "set", "id": id, "attrs": attrs }));
            }
            return Ok(());
        }
        // Un `<path>` con più sottotracciati (la freccia) è un tracciato
        // composto del motore, i cui figli non sono elementi di Fub: se i
        // figli restano gli stessi, il cambio è suo e si scrive come quello
        // di una foglia.
        if let (NodeKind::Compound { children: fb, .. }, NodeKind::Compound { children: fa, .. }) =
            (&b.kind, &a.kind)
        {
            let stessi = fb.len() == fa.len()
                && fb
                    .iter()
                    .zip(fa)
                    .all(|(x, y)| Arc::ptr_eq(x, y) || **x == **y)
                && fa.iter().all(|c| self.copia.mappa.del_nodo(c.id).is_none());
            if let Some(e) = self
                .elemento(a.id)
                .filter(|e| e.tag == "path" && stessi)
                .cloned()
            {
                let attrs = self.foglia_scritta(&e, b, a)?;
                if !attrs.is_empty() {
                    let id = self.bersaglio(a.id)?;
                    self.set
                        .push(json!({ "op": "set", "id": id, "attrs": attrs }));
                }
                return Ok(());
            }
        }
        if let Some(figli) = a.children() {
            // La `transform` va al gruppo quando lo spostamento è di tutto il
            // gruppo e il gruppo è un oggetto scelto dal gesto, come la
            // scrive il client. Senza la scelta, quando scriverla sui figli
            // non basta o costa di più: un figlio che non viene da Fub, o più
            // d'un figlio; con un figlio solo di Fub la riceve il figlio.
            let gruppo = !radice && !livello && self.elemento(a.id).is_some();
            let per_il_gruppo = match self.unita {
                Some(unita) => unita.contains(&a.id),
                None => figli.len() > 1 || figli.iter().any(|c| self.ha_estranei(c)),
            };
            if gruppo && per_il_gruppo {
                if let Some(m) = self.adatta(b, a) {
                    if !vicina_all_identita(m)
                        && mosso_da(b, m, true).is_some_and(|c| nodi_vicini(&c, a))
                    {
                        let e = self
                            .elemento(a.id)
                            .cloned()
                            .ok_or_else(|| no("gruppo senza elemento"))?;
                        let t = nuova_trasformazione(&e, m)?;
                        let id = self.bersaglio(a.id)?;
                        self.set.push(json!({ "op": "set", "id": id, "attrs": { "transform": scrivi_matrice(t) } }));
                        return Ok(());
                    }
                }
            }
            let rinominato;
            let b: &Node = match self.nome_del_livello(b, a)? {
                Some(c) => {
                    rinominato = c;
                    &rinominato
                }
                None => b,
            };
            let sciolto;
            let b: &Node = match self.ritaglio_tolto(b, a)? {
                Some(c) => {
                    sciolto = c;
                    &sciolto
                }
                None => b,
            };
            let messo;
            let b: &Node = match self.ritaglio_messo(b, a)? {
                Some(c) => {
                    messo = c;
                    &messo
                }
                None => b,
            };
            if !proprieta_uguali(b, a) {
                return Err(no(
                    "cambia un gruppo o un livello in un modo che non si scrive",
                ));
            }
            self.confronta_figli(figli, prima)?;
            return Ok(());
        }
        if radice || livello {
            return Err(no("cambia un livello"));
        }
        let Some(e) = self.elemento(a.id).cloned() else {
            return Err(Rifiuto::NonMappato(format!(
                "il gesto cambia l'oggetto {} che non viene da Fub",
                a.id.0
            )));
        };
        // Un testo di punto con altre parole, un altro carattere o un altro
        // allineamento (K6 T16): il resto del confronto va avanti sul testo
        // di prima che li ha già.
        // Un testo su tracciato col tracciato o il punto d'inizio nuovi: il `<text>` col
        // `textPath` nuovo, e il `d` del suo tracciato privato.
        if let Some((riscritto, tracciato)) = sul_tracciato_cambiato(&e, b, a)? {
            if let Some((href, d)) = tracciato {
                let altri = self.copia.mappa.elementi().iter().filter(|x| {
                    x.testo.as_ref().and_then(|i| i.tracciato.as_deref()) == Some(href.as_str())
                });
                if altri.count() > 1 {
                    return Err(no("il tracciato del testo lo segue anche un altro testo"));
                }
                self.tracciati_dei_testi
                    .push(json!({ "op": "set", "id": href, "attrs": { "d": d } }));
            }
            self.testi_riscritti.insert(a.id, riscritto);
            self.riscritti.insert(a.id);
            return Ok(());
        }
        if da_riscrivere(b, a) {
            let riscritto = riscrittura(&e, b, a)?;
            self.testi_riscritti.insert(a.id, riscritto);
            self.riscritti.insert(a.id);
            return Ok(());
        }
        let (b, mut attrs, righe) = match testo_cambiato(&e, b, a)? {
            Some(cambio) => (Arc::new(cambio.prima), cambio.attrs, cambio.righe),
            None => (b.clone(), Map::new(), None),
        };
        attrs.extend(self.foglia_scritta(&e, &b, a)?);
        if !attrs.is_empty() || righe.is_some() {
            let id = self.bersaglio(a.id)?;
            // Un `d` su una forma che non è un tracciato vuol dire che la
            // forma è stata deformata e diventa un tracciato ([`Lavoro::foglia`]).
            let diventa = e.tag != "path" && attrs.contains_key("d");
            if diventa {
                self.set
                    .push(json!({ "op": "set", "id": id, "tag": "path", "attrs": attrs }));
            } else if !attrs.is_empty() {
                self.set
                    .push(json!({ "op": "set", "id": id, "attrs": attrs }));
            }
            if let Some(righe) = righe {
                self.set
                    .push(json!({ "op": "text", "id": id, "lines": righe }));
            }
        }
        Ok(())
    }

    /// Un `<path>` composto di prima (i suoi tracciati non sono elementi di
    /// Fub) di cui cambiano solo i sottotracciati (il verso, punti aggiunti):
    /// il `d` nuovo. Una regola di riempimento cambiata si rifiuta
    /// ([`REGOLA_FUORI`]). `None` se il cambio è un altro, che il resto del
    /// confronto scrive o rifiuta.
    pub(super) fn composto_cambiato(
        &self,
        b: &Node,
        a: &Node,
    ) -> Result<Option<Map<String, Value>>, Rifiuto> {
        let (Some((pb, rb)), Some((pa, ra))) = (tracciato_composto(b), tracciato_composto(a))
        else {
            return Ok(None);
        };
        let estranei = |n: &Node| {
            n.children().is_some_and(|figli| {
                figli
                    .iter()
                    .all(|c| self.copia.mappa.del_nodo(c.id).is_none())
            })
        };
        let Some(e) = self
            .elemento(a.id)
            .filter(|e| e.tag == "path" && estranei(b) && estranei(a))
        else {
            return Ok(None);
        };
        let con_la_stessa_regola = |n: &Node| {
            let mut c = senza_figli(n);
            if let NodeKind::Compound { rule, .. } = &mut c.kind {
                *rule = FillRule::NonZero;
            }
            c
        };
        if !nodi_vicini(&con_la_stessa_regola(b), &con_la_stessa_regola(a)) {
            return Ok(None);
        }
        let mut attrs = Map::new();
        if !json_vicini(
            &serde_json::to_value(&pb).unwrap_or(Value::Null),
            &serde_json::to_value(&pa).unwrap_or(Value::Null),
        ) {
            let g = e
                .ctm_genitore
                .ok_or_else(|| no("una transform di un antenato non si legge"))?;
            let t = e
                .propria
                .ok_or_else(|| no("la transform dell'elemento non si legge"))?;
            let locale = (g * t).inverse();
            if !locale.is_finite() {
                return Err(no("l'elemento ha una transform che non si inverte"));
            }
            attrs.insert("d".into(), json!(scrivi_d(&trasformato(&pa, locale))));
        }
        if rb != ra {
            attrs.insert(
                "fill-rule".into(),
                scrivi_regola(ra, self.evenodd_ereditato(e)),
            );
        }
        Ok(Some(attrs))
    }

    /// I figli che c'erano già, e quelli di un gruppo nuovo che li raccoglie.
    pub(super) fn confronta_figli(
        &mut self,
        figli: &[Arc<Node>],
        prima: &Posti<'_>,
    ) -> Result<(), Rifiuto> {
        for c in figli {
            if self.liberati.contains(&c.id) || self.assorbiti.contains(&c.id) {
                continue;
            }
            match prima.nodi.get(&c.id) {
                Some(p) => self.confronta(p.nodo, c, prima)?,
                None => {
                    if let Some(nipoti) = c.children() {
                        self.confronta_figli(nipoti, prima)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Vero se `n` o un suo discendente non viene da un elemento di Fub.
    pub(super) fn ha_estranei(&self, n: &Node) -> bool {
        self.copia.mappa.del_nodo(n.id).is_none()
            || n.children()
                .is_some_and(|c| c.iter().any(|c| self.ha_estranei(c)))
    }

    /// [`Lavoro::foglia`], con le sfumature nuove scritte: ognuna ha il suo
    /// id, va fra le [`Lavoro::sfumature`] e chi la usa scrive
    /// `url(#id) ripiego`.
    pub(super) fn foglia_scritta(
        &mut self,
        e: &Elemento,
        b: &Node,
        a: &Node,
    ) -> Result<Map<String, Value>, Rifiuto> {
        let (mut attrs, nuove) = self.foglia(e, b, a)?;
        for (canale, s) in nuove {
            let id = self.id_nuovo(Specie::Risorsa)?;
            attrs.insert(canale.into(), json!(format!("url(#{id}) {}", s.ripiego)));
            self.sfumature.push(s.elem(&id));
        }
        Ok(attrs)
    }

    /// Gli attributi cambiati di un oggetto senza figli, e le sfumature
    /// nuove del riempimento (`fill`) o del contorno (`stroke`), ancora
    /// senza id ([`Lavoro::foglia_scritta`]).
    /// La matrice che porta `b` su `a` ([`adatta`]); con un cambio dei punti
    /// solo se è una traslazione.
    pub(super) fn adatta(&self, b: &Node, a: &Node) -> Option<Affine> {
        adatta(b, a).filter(|m| !self.punti || traslazione(*m))
    }

    pub(super) fn foglia(
        &self,
        e: &Elemento,
        b: &Node,
        a: &Node,
    ) -> Result<AttributiDellaFoglia, Rifiuto> {
        let mut attrs = Map::new();
        let mut nuove = Vec::new();
        let g = e
            .ctm_genitore
            .ok_or_else(|| no("una transform di un antenato non si legge"))?;
        let t = e
            .propria
            .ok_or_else(|| no("la transform dell'elemento non si legge"))?;
        // Un oggetto bloccato (lui o un antenato) tiene il ripiego di un
        // campione che cambia colore: il riferimento lo ridipinge comunque.
        let bloccato = self.bloccato(e);
        let r = &self.riferimenti;
        let da_scrivere = |prima: Option<&Paint>, dopo: Option<&Paint>| {
            !(r.uguali(prima, dopo) || (bloccato && r.stesso_campione(prima, dopo)))
        };
        // Il riempimento di un testo cambiato nei pezzi del motore è il
        // `fill` del `<text>`: il confronto va avanti col testo di prima già
        // ricolorato.
        let ricolorato = riempimento_dei_pezzi(b, a)?;
        let b = match &ricolorato {
            Some((testo, prima, colore)) => {
                if da_scrivere(Some(prima), Some(colore)) {
                    attrs.insert("fill".into(), json!(scrivi_colore(r, Some(colore))?));
                }
                testo
            }
            None => b,
        };
        // La regola di riempimento cambiata (Attributi): `fill-rule`, e il
        // confronto va avanti con la regola nuova.
        let con_regola;
        let b = match (regola(b), regola(a)) {
            (Some(rb), Some(ra)) if rb != ra => {
                attrs.insert(
                    "fill-rule".into(),
                    scrivi_regola(ra, self.evenodd_ereditato(e)),
                );
                con_regola = con_la_regola(b, ra);
                &con_regola
            }
            _ => b,
        };
        // Una matrice che schiaccia (Media che allinea tutti i punti su una
        // retta) non è uno spostamento: il tracciato si riscrive col suo `d`.
        let m = self
            .adatta(b, a)
            .filter(|m| m.determinant().abs() > 1e-9)
            .unwrap_or(Affine::IDENTITY);
        let con_tratti =
            mosso_da(b, m, true).ok_or_else(|| no("l'oggetto non si muove con una matrice"))?;
        let geometria_ok = geometrie_vicine(&con_tratti, a);
        let mut t_nuova = t;
        let candidato = if geometria_ok {
            if !vicina_all_identita(m) {
                t_nuova = nuova_trasformazione(e, m)?;
                attrs.insert("transform".into(), json!(scrivi_matrice(t_nuova)));
            }
            con_tratti
        } else if let (
            NodeKind::Path { live: None, .. },
            NodeKind::Path {
                path: pa,
                live: None,
                ..
            },
            "path",
        ) = (&b.kind, &a.kind, e.tag)
        {
            // Un tratto della penna di Fub (`fub:ink`): la sua forma viene dai
            // campioni, e un `d` nuovo li smentirebbe. Lo si sposta, gira o
            // ridimensiona (la `transform` qui sopra), e niente altro (K5).
            if matches!(e.ruolo, fub_scene::Role::Stroke | fub_scene::Role::Width) {
                return Err(no(
                    "un tratto della penna si sposta, gira o ridimensiona, ma i suoi punti non si cambiano",
                ));
            }
            // Un tracciato cambiato punto per punto: il `d` nuovo, nello
            // spazio dell'elemento.
            let locale = (g * t).inverse();
            attrs.insert("d".into(), json!(scrivi_d(&trasformato(pa, locale))));
            let mut c = b.clone();
            c.kind = a.kind.clone();
            c.bbox_angle = a.bbox_angle;
            if !geometrie_vicine(&c, a) {
                return Err(no("il tracciato cambia anche in altro"));
            }
            c
        } else if let (NodeKind::Path { .. }, NodeKind::Path { path: pa, .. }, Some(geometria)) =
            (&b.kind, &a.kind, geometria_della_forma(e))
        {
            // Una forma semplice deformata (Trasformazione libera con Ctrl,
            // Selezione diretta): come in VectorCraft diventa un tracciato.
            // Il `set` con `tag` la riscrive al suo posto, con gli stessi
            // attributi meno la geometria di prima (scene-operations, «Il
            // tipo di una forma»).
            let locale = (g * t).inverse();
            if !locale.is_finite() {
                return Err(no("l'elemento ha una transform che non si inverte"));
            }
            for chiave in geometria {
                attrs.insert((*chiave).into(), Value::Null);
            }
            attrs.insert("d".into(), json!(scrivi_d(&trasformato(pa, locale))));
            let mut c = b.clone();
            c.kind = a.kind.clone();
            c.bbox_angle = a.bbox_angle;
            if !geometrie_vicine(&c, a) {
                return Err(no("la forma cambia anche in altro"));
            }
            c
        } else {
            return Err(no(format!(
                "<{}> cambia in un modo che i suoi attributi non dicono",
                e.tag
            )));
        };
        if aspetti_vicini(&candidato.appearance, &a.appearance) {
            return Ok((attrs, nuove));
        }
        // Lo spessore che non segue la scala, i colori pieni.
        let (prima, dopo) = senza_colori_nuovi(&candidato.appearance, &a.appearance);
        if !aspetti_vicini(&prima, &dopo) {
            return Err(no(
                "cambia l'aspetto in un modo che fill, stroke e stroke-width non dicono",
            ));
        }
        // Una sfumatura si scrive nelle coordinate dell'elemento dopo il
        // gesto; quella di prima, portata dal gesto, si confronta scritta
        // allo stesso modo, così uno spostamento non la riscrive.
        let locale = (g * t_nuova).inverse();
        let sfumatura = |p: Option<&Paint>,
                         limiti: Option<vectorcraft_geom::Rect>|
         -> Result<Option<sfumature::Scritta>, Rifiuto> {
            let Some(Paint::Gradient(gp)) = p else {
                return Ok(None);
            };
            let limiti = limiti.ok_or_else(|| no("una sfumatura su un oggetto senza misura"))?;
            sfumature::scritta(gp, limiti, locale)
                .map(Some)
                .ok_or_else(|| no("una sfumatura che la scena non dice"))
        };
        let (gb, ga) = (candidato.geometric_bounds(), a.geometric_bounds());
        let (fb, fa) = (
            candidato.appearance.fill().map(|f| &f.paint),
            a.appearance.fill().map(|f| &f.paint),
        );
        let (sfb, sfa) = (sfumatura(fb, gb)?, sfumatura(fa, ga)?);
        match sfa {
            Some(s) if sfb.as_ref() != Some(&s) => nuove.push(("fill", s)),
            Some(_) => {}
            None if da_scrivere(fb, fa) => {
                attrs.insert("fill".into(), json!(scrivi_colore(r, fa)?));
            }
            None => {}
        }
        let (sb, sa) = (candidato.appearance.stroke(), a.appearance.stroke());
        let (pb, pa) = (sb.map(|s| &s.paint), sa.map(|s| &s.paint));
        if sa.is_some_and(|s| {
            matches!(s.paint, Paint::Gradient(_)) && !sfumature::del_tratto_scrivibile(s)
        }) {
            return Err(no("una sfumatura che segue il tratto"));
        }
        let (stb, sta) = (
            sfumatura(pb, gb.zip(sb).map(|(g, s)| s.paint_bounds(g)))?,
            sfumatura(pa, ga.zip(sa).map(|(g, s)| s.paint_bounds(g)))?,
        );
        match sta {
            Some(s) if stb.as_ref() != Some(&s) => nuove.push(("stroke", s)),
            Some(_) => {}
            None if da_scrivere(pb, pa) => {
                attrs.insert("stroke".into(), json!(scrivi_colore(r, pa)?));
            }
            None => {}
        }
        let (wb, wa) = (sb.map_or(0.0, |s| s.width), sa.map_or(0.0, |s| s.width));
        let scala = (g * t_nuova).determinant().abs().sqrt();
        if !vicini(wb, wa) {
            if scala <= 0.0 || !scala.is_finite() {
                return Err(no("lo spessore non si scrive in uno spazio schiacciato"));
            }
            attrs.insert(
                "stroke-width".into(),
                json!(numero(wa / scala, DECIMALI_GEOMETRIA)),
            );
        }
        scrivi_stile_del_tratto(sb, sa, scala, &mut attrs)?;
        Ok((attrs, nuove))
    }
}
