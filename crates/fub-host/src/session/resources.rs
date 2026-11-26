//! Le porte delle risorse (`ResourceHost`, `ResourceWrite`) servite dall'`Host`.

use super::*;

impl crate::resources::ResourceHost for Host {
    fn resource_open(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<crate::resources::ResourceDescriptor, PluginError> {
        self.in_session(vault, |session| {
            let prepared = {
                let workspace = session.workspace.read()?;
                workspace
                    .prepare_resource_open(id)
                    .map_err(PluginError::from)?
            };
            let lease = prepared.invoke().map_err(PluginError::from)?;
            let id = DocId::new(lease.path.clone());
            let mime = crate::resources::resource_mime_or_octet(&id).to_owned();
            self.resources
                .write()?
                .open(session.root.to_string(), id, lease, mime)
        })
    }

    fn resource_read(
        &self,
        handle: crate::resources::ResourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        // Ordine unico Sessions -> Resources. Il registro delle sessioni tiene
        // viva l'apertura; né workspace né tabella risorse attraversano l'I/O.
        let sessions = self.sessions.read()?;
        let lease = self.resources.read()?.lease(handle)?;
        let session = sessions.session(&lease.root)?;
        let prepared = {
            let workspace = session.workspace.read()?;
            workspace
                .prepare_resource_read(lease, offset, crate::resources::clamp_chunk(len) as usize)
                .map_err(PluginError::from)?
        };
        let bytes = prepared.invoke().map_err(PluginError::from)?;
        // resource_close può revocare anche una lettura in volo. L'handle non
        // si riusa: una riapertura non può rendere valido questo risultato.
        if self.resources.read()?.resolve(handle).is_none() {
            return Err(PluginError::BadArgs(
                format!("resource handle `{}` is not open", handle.0).into(),
            ));
        }
        Ok(bytes)
    }

    fn resource_descriptor(
        &self,
        handle: crate::resources::ResourceHandle,
    ) -> Result<Option<crate::resources::ResourceDescriptor>, PluginError> {
        Ok(self.resources.read()?.descriptor(handle))
    }

    fn resource_close(&self, handle: crate::resources::ResourceHandle) -> Result<(), PluginError> {
        self.resources.write()?.close(handle);
        Ok(())
    }
}

impl crate::resources::ResourceWrite for Host {
    fn resource_write(
        &self,
        vault: Option<&str>,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
        reuse: crate::resources::ResourceReuse,
    ) -> Result<crate::resources::ResourceWriteReceipt, PluginError> {
        let id = doc_id(id.as_str())?;
        let reuse_same = reuse == crate::resources::ResourceReuse::SameContent;
        // Riusare un file che c'è e ricoprirne uno alla sua revisione sono due
        // domande diverse: insieme non hanno un senso da indovinare.
        if reuse_same && expected.is_some() {
            return Err(PluginError::BadArgs(Text::message(
                "host.resource.reuse_with_expected",
                vec![Arg::text("doc", id.as_str())],
            )));
        }
        // La shell scrive una cartella di Excel soltanto creandola: coprirne
        // una con dei byte suoi aggirerebbe la sola lettura.
        if expected.is_some() {
            let format = self.read_workspace(vault, |workspace| Ok(workspace.format_of(&id)))?;
            if crate::workbook::is_workbook(format.as_ref()) {
                return Err(crate::workbook::read_only(&id));
            }
        }
        if reuse_same {
            if let Some(receipt) = self.reused_resource(vault, &id, bytes) {
                return Ok(receipt);
            }
        }
        let revision = self.write_document_bytes(vault, &id, bytes, expected)?;
        Ok(crate::resources::ResourceWriteReceipt {
            id,
            revision,
            reused: false,
        })
    }
}

impl Host {
    /// La ricevuta del file che il vault ha già con questi byte, o `None`:
    /// allora si scrive. `None` vale anche per «non so» (limiti, indice non
    /// ancora pronto) e per una domanda che fallisce: nel dubbio si deposita,
    /// mai si perde un deposito.
    ///
    /// Il confronto è quello di [`Host::same_content`] (candidati dello stesso
    /// tipo di `target` presi dall'indice vivo sotto la custodia, byte
    /// confrontati fuori). Prima di rispondere si ricontrolla, coi soli
    /// metadati e fuori dalla custodia, che il file trovato ci sia ancora e
    /// abbia ancora questa misura: un file sparito fra il confronto e la
    /// risposta non si nomina, si scrive.
    pub(super) fn reused_resource(
        &self,
        vault: Option<&str>,
        target: &DocId,
        bytes: &[u8],
    ) -> Option<crate::resources::ResourceWriteReceipt> {
        let SameContent::Found { id } = self.same_content(vault, target, bytes).ok()? else {
            return None;
        };
        let prepared = self
            .read_workspace(vault, |workspace| {
                workspace
                    .prepare_resource_open(&id)
                    .map_err(PluginError::from)
            })
            .ok()?;
        let lease = prepared.invoke().ok()?;
        let still_there = lease.stat.is_file() && lease.stat.size == bytes.len() as u64;
        still_there.then(|| crate::resources::ResourceWriteReceipt {
            id,
            // I byte trovati sono questi, confrontati uno per uno: la loro
            // revisione è quella dei byte che arrivano.
            revision: Revision::of_bytes(bytes),
            reused: true,
        })
    }
}
