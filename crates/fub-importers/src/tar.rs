//! Bounded, read-only ustar reader for Joplin JEX exports.
//! Parse and validate every header before the importer writes anything.

use crate::common::{
    bad_args, MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_SOURCE_BYTES, MAX_TOTAL_UNCOMPRESSED,
};
use fub_abi::PluginError;

pub(crate) fn entries(bytes: &[u8]) -> Result<Vec<(String, &[u8])>, PluginError> {
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err(bad_args("tar archive exceeds 64 MiB"));
    }
    let mut entries = Vec::new();
    let mut offset = 0usize;
    let mut total = 0u64;
    while offset < bytes.len() {
        let header = bytes
            .get(offset..offset + 512)
            .ok_or_else(|| bad_args("tar archive ends inside a header"))?;
        if header.iter().all(|b| *b == 0) {
            if bytes[offset..].iter().any(|b| *b != 0) {
                return Err(bad_args("tar archive has data after its end marker"));
            }
            return Ok(entries);
        }
        let stored = octal(&header[148..156])?;
        let sum: u64 = header
            .iter()
            .enumerate()
            .map(|(index, byte)| {
                if (148..156).contains(&index) {
                    32
                } else {
                    *byte as u64
                }
            })
            .sum();
        if stored != sum {
            return Err(bad_args("tar header checksum mismatch"));
        }
        let size = octal(&header[124..136])?;
        if size > MAX_ENTRY_BYTES || total.saturating_add(size) > MAX_TOTAL_UNCOMPRESSED {
            return Err(bad_args("tar archive exceeds entry or total safety budget"));
        }
        total += size;
        let entry_name = name(&header[..100])?;
        let prefix = name(&header[345..500])?;
        let name = if prefix.is_empty() {
            entry_name
        } else {
            format!("{prefix}/{entry_name}")
        };
        let data_start = offset + 512;
        let data_end = data_start
            .checked_add(size as usize)
            .ok_or_else(|| bad_args("tar entry size overflow"))?;
        let payload = bytes
            .get(data_start..data_end)
            .ok_or_else(|| bad_args("tar entry is truncated"))?;
        let rounded = (size as usize)
            .checked_add(511)
            .map(|n| n / 512 * 512)
            .ok_or_else(|| bad_args("tar entry size overflow"))?;
        offset = data_start
            .checked_add(rounded)
            .ok_or_else(|| bad_args("tar offset overflow"))?;
        if offset > bytes.len() {
            return Err(bad_args("tar entry padding is truncated"));
        }
        match header[156] {
            b'0' | 0 => entries.push((name, payload)),
            b'5' => {}
            _ => {
                return Err(bad_args(format!(
                    "tar entry `{name}` uses unsupported link or extended metadata"
                )))
            }
        }
        if entries.len() > MAX_ENTRIES {
            return Err(bad_args("tar archive exceeds 10000 entries"));
        }
    }
    Err(bad_args("tar archive has no end marker"))
}

fn octal(bytes: &[u8]) -> Result<u64, PluginError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| bad_args("tar numeric field is not ASCII"))?
        .trim_matches(['\0', ' ']);
    if text.is_empty() {
        return Ok(0);
    }
    if !text.bytes().all(|b| (b'0'..=b'7').contains(&b)) {
        return Err(bad_args("tar numeric field is not octal"));
    }
    u64::from_str_radix(text, 8).map_err(|_| bad_args("tar numeric field overflows"))
}

fn name(bytes: &[u8]) -> Result<String, PluginError> {
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    std::str::from_utf8(&bytes[..end])
        .map(str::to_string)
        .map_err(|_| bad_args("tar entry name is not UTF-8"))
}
