//! Textbundle/Textpack import: `info.json` + `text.*` + `assets/`.
//! Assets are written byte-for-byte into the vault beside the imported note;
//! they are included in the preview and staged commit journal.

use crate::common::{
    bad_args, content_hash_hex, entry_stem, resolve_binary_destination, resolve_destination,
    sanitize_component, write_asset, write_doc,
};
use crate::zip;
use fub_abi::traits::HostApi;
use fub_abi::transfer::{ImportProvider, ImportReport, ImportRequest, ImportSource, TransferNote};
use fub_abi::PluginError;

fn media_base(media: Option<&str>) -> Option<&str> {
    media.map(|m| m.split(';').next().unwrap_or(m).trim())
}

fn looks_like_textpack(data: &[u8]) -> bool {
    // Scan central-directory names for `info.json` at root or one level.
    let Ok(archive) = zip::parse(data) else {
        return false;
    };
    archive.entries.iter().any(|e| {
        let n = e.name.trim_start_matches("./");
        n == "info.json" || (n.contains('/') && n.rsplit('/').next() == Some("info.json"))
    })
}

#[derive(Default)]
pub struct TextpackImport;

impl TextpackImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(TextpackImport)
    }
}

impl ImportProvider for TextpackImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("textpack" | "textbundle") => return true,
            Some(_) => return false,
            None => {}
        }
        if media_base(source.media_type.as_deref())
            .is_some_and(|m| matches!(m, "application/x-textpack" | "application/x-textbundle"))
        {
            return true;
        }
        // Bare-ZIP fallback: only when the bytes are already in hand (cheap
        // scan, no host).
        if source.extension().is_none() {
            if let Some(bytes) = source.bytes() {
                if zip::looks_like_zip(bytes) && looks_like_textpack(bytes) {
                    return true;
                }
            } else if zip::looks_like_zip(source.prologue()) {
                // Streamed: cannot scan names without a host — decline and
                // let the generic archive provider take it.
                return false;
            }
        }
        false
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let bytes = source.read_all(host)?;
        let archive = zip::parse(&bytes)?;
        // Find `info.json`: root preferred, else shallowest path.
        let info_entry = archive
            .entries
            .iter()
            .filter(|e| {
                !e.is_dir && {
                    let n = e.name.trim_start_matches("./");
                    n == "info.json" || n.rsplit('/').next() == Some("info.json")
                }
            })
            .min_by_key(|e| e.name.len())
            .ok_or_else(|| bad_args(format!("`{}`: no info.json found", source.name)))?;
        let mut total = 0u64;
        let info_bytes = zip::extract(archive.data(), info_entry, &mut total)?;
        let info: serde_json::Value = serde_json::from_slice(&info_bytes)
            .map_err(|e| bad_args(format!("`{}`: info.json is not JSON: {e}", source.name)))?;
        let version = info.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
        if version != 2 && version != 1 {
            return Err(bad_args(format!(
                "`{}`: unsupported textbundle version {version} (expected 2)",
                source.name
            )));
        }
        let mut report = ImportReport::new(request.mode);
        if version == 1 {
            report.log.push(
                TransferNote::warning("textbundle version 1: imported transitionally".to_string())
                    .about(source.name.clone()),
            );
        }
        // Unknown top-level keys are preserved into frontmatter `extra_*`?
        // No — unknown keys are *reported*, not reinterpreted: the preview
        // must show what the importer does not understand.
        if let Some(obj) = info.as_object() {
            for k in obj.keys() {
                if !matches!(
                    k.as_str(),
                    "version"
                        | "textContent"
                        | "creatorIdentifier"
                        | "creatorURL"
                        | "sourceURL"
                        | "transient"
                ) {
                    report.log.push(
                        TransferNote::info(format!(
                            "info.json key `{k}` has no mapping: kept in the loss report"
                        ))
                        .about(source.name.clone()),
                    );
                }
            }
        }
        let text_name = info
            .get("textContent")
            .and_then(|v| v.as_str())
            .unwrap_or("text.md");
        let base_dir = info_entry
            .name
            .rsplit_once('/')
            .map(|(d, _)| d.to_string())
            .unwrap_or_default();
        let text_path = if base_dir.is_empty() {
            text_name.to_string()
        } else {
            format!("{base_dir}/{text_name}")
        };
        let text_entry = archive
            .entries
            .iter()
            .find(|e| e.name == text_path || e.name.trim_start_matches("./") == text_name)
            .ok_or_else(|| {
                bad_args(format!(
                    "`{}`: text file `{text_name}` missing",
                    source.name
                ))
            })?;
        let text_bytes = zip::extract(archive.data(), text_entry, &mut total)?;
        let text = std::str::from_utf8(&text_bytes)
            .map_err(|_| bad_args(format!("`{text_name}` is not UTF-8")))?;
        let stem = entry_stem(&source.name).unwrap_or_else(|| "textbundle".to_string());
        let wanted = request.destination(&format!("{stem}.md"));
        let (doc, outcome) =
            resolve_destination(host, request, wanted, &source.name, &mut report.log);
        if outcome == fub_abi::transfer::ImportOutcome::Skipped {
            write_doc(host, request, &doc, "", outcome, &source.name, &mut report)?;
            return Ok(report);
        }
        let folder = doc
            .as_str()
            .rsplit_once('/')
            .map(|(folder, _)| folder)
            .unwrap_or("");
        let mut asset_notes = Vec::new();
        let mut asset_links = Vec::new();
        for entry in &archive.entries {
            if entry.is_dir {
                continue;
            }
            let rel = entry.name.trim_start_matches("./");
            let relative = match base_dir.as_str() {
                "" => rel.strip_prefix("assets/"),
                base => rel.strip_prefix(&format!("{base}/assets/")),
            };
            let Some(relative) = relative else { continue };
            let components: Option<Vec<String>> =
                relative.split('/').map(sanitize_component).collect();
            let components = components.ok_or_else(|| {
                bad_args(format!("unsafe textbundle asset path `{}`", entry.name))
            })?;
            let original_link = format!("assets/{relative}");
            let desired_link = format!("assets/{}", components.join("/"));
            let desired = fub_abi::DocId::new(if folder.is_empty() {
                desired_link.clone()
            } else {
                format!("{folder}/{desired_link}")
            });
            let bytes = zip::extract(archive.data(), entry, &mut total)?;
            let sha = content_hash_hex(&bytes);
            let (asset, asset_outcome) =
                resolve_binary_destination(host, request, desired, &entry.name, &mut report.log)?;
            let actual_link = asset
                .as_str()
                .strip_prefix(&format!("{folder}/"))
                .unwrap_or(asset.as_str())
                .to_string();
            asset_links.push((original_link, actual_link));
            report.log.push(
                TransferNote::info(format!(
                    "asset `{}` preserved byte-for-byte (sha256:{sha})",
                    entry.name
                ))
                .about(source.name.clone()),
            );
            write_asset(
                host,
                request,
                &asset,
                &bytes,
                asset_outcome,
                &entry.name,
                &mut report,
            )?;
            asset_notes.push(format!("{} (sha256:{sha})", entry.name));
        }
        let sha = content_hash_hex(&text_bytes);
        let mut fm = format!(
            "---\ntitle: {}\nsource_file: {}\nsource_sha: {sha}\nsource_payload_json: {}\n",
            crate::common::yaml_scalar(&stem),
            crate::common::yaml_scalar(&source.name),
            crate::common::yaml_scalar(&info.to_string()),
        );
        if let Some(u) = info.get("sourceURL").and_then(|v| v.as_str()) {
            fm.push_str(&format!("source_url: {}\n", crate::common::yaml_scalar(u)));
        }
        fm.push_str("---\n\n");
        let mut body = format!("{fm}{text}");
        for (original, actual) in &asset_links {
            if original != actual {
                body = body.replace(&format!("]({original})"), &format!("]({actual})"));
                body = body.replace(&format!("src=\"{original}\""), &format!("src=\"{actual}\""));
            }
        }
        if !asset_notes.is_empty() {
            body.push_str("\n\n<!-- assets preserved by hash:\n");
            for a in &asset_notes {
                body.push_str(&format!("- {a}\n"));
                report.log.push(
                    TransferNote::info(format!("asset preserved: {a}")).about(source.name.clone()),
                );
            }
            body.push_str("-->\n");
        }
        // Original relative links remain valid when there is no collision;
        // renamed attachments are rewritten above to their actual vault path.
        write_doc(
            host,
            request,
            &doc,
            &body,
            outcome,
            &source.name,
            &mut report,
        )?;
        Ok(report)
    }
}
