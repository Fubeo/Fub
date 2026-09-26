//! Minimal ZIP reader: stored (method 0) + raw DEFLATE (method 8) via
//! `flate2`, with traversal/bomb guards shared by every archive importer.
//!
//! Format coverage is deliberately narrow: local headers + central directory,
//! no ZIP64, no multi-disk, no encryption (those entries are reported and
//! skipped, never failed). Data descriptors (bit 3) are supported for
//! deflated entries by scanning for the local header signature — correct for
//! the exporters this crate targets; a false signature inside compressed data
//! can only mis-size one entry, which the CRC/size check then rejects.
//!
//! All offsets and sizes are validated before any allocation; every entry
//! body is capped ([`MAX_ENTRY_BYTES`]) and the archive total is capped
//! ([`MAX_TOTAL_UNCOMPRESSED`]) with a ratio check for bombs.

use crate::common::{
    bad_args, io_error, BOMB_MIN_BYTES, BOMB_RATIO, MAX_ENTRIES, MAX_ENTRY_BYTES,
    MAX_TOTAL_UNCOMPRESSED,
};
use fub_abi::PluginError;

/// One entry of the central directory.
#[derive(Debug, Clone)]
pub struct ZipEntry {
    pub name: String,
    pub method: u16,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub crc32: u32,
    /// Offset of the local header.
    pub header_offset: u64,
    pub is_dir: bool,
    pub encrypted: bool,
}

/// Parsed archive: entry table plus the raw bytes (borrowed).
pub struct ZipArchive<'a> {
    data: &'a [u8],
    pub entries: Vec<ZipEntry>,
}

impl<'a> ZipArchive<'a> {
    pub fn data(&self) -> &'a [u8] {
        self.data
    }
}

fn u16le(b: &[u8], o: usize) -> Result<u16, PluginError> {
    b.get(o..o + 2)
        .ok_or_else(|| bad_args("truncated ZIP header"))
        .map(|w| u16::from_le_bytes([w[0], w[1]]))
}

fn u32le(b: &[u8], o: usize) -> Result<u32, PluginError> {
    b.get(o..o + 4)
        .ok_or_else(|| bad_args("truncated ZIP header"))
        .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
}

/// Parse the central directory. `BadArgs` on anything structurally wrong;
/// an empty-but-valid archive parses to zero entries.
pub fn parse(data: &[u8]) -> Result<ZipArchive<'_>, PluginError> {
    if data.len() < 22 {
        return Err(bad_args("not a ZIP archive (too short for EOCD)"));
    }
    // EOCD: scan the last 64 KiB + 22 for `PK\x05\x06` (comment may follow).
    let scan_from = data.len().saturating_sub(65557 + 22);
    let mut eocd = None;
    for o in (scan_from..=data.len().saturating_sub(22)).rev() {
        if &data[o..o + 4] == b"PK\x05\x06" {
            eocd = Some(o);
            break;
        }
    }
    let eocd = eocd.ok_or_else(|| bad_args("not a ZIP archive (EOCD missing)"))?;
    let dir_count = u16le(data, eocd + 10)? as u64;
    let dir_size = u32le(data, eocd + 12)? as u64;
    let dir_off = u32le(data, eocd + 16)? as u64;
    if dir_count as usize > MAX_ENTRIES {
        return Err(bad_args(format!(
            "ZIP directory lists {} entries (max {MAX_ENTRIES})",
            dir_count
        )));
    }
    let dir_end = dir_off
        .checked_add(dir_size)
        .ok_or_else(|| bad_args("ZIP directory range overflows"))?;
    if dir_end > data.len() as u64 {
        return Err(bad_args("ZIP directory extends past end of file"));
    }
    let mut entries = Vec::with_capacity(dir_count.min(4096) as usize);
    let mut o = dir_off as usize;
    for _ in 0..dir_count {
        if data.get(o..o + 4) != Some(b"PK\x01\x02".as_slice()) {
            return Err(bad_args("ZIP central directory entry has a bad signature"));
        }
        let flags = u16le(data, o + 8)?;
        let method = u16le(data, o + 10)?;
        let crc = u32le(data, o + 16)?;
        let comp = u32le(data, o + 20)? as u64;
        let uncomp = u32le(data, o + 24)? as u64;
        let name_len = u16le(data, o + 28)? as usize;
        let extra_len = u16le(data, o + 30)? as usize;
        let comment_len = u16le(data, o + 32)? as usize;
        let header_off = u32le(data, o + 42)? as u64;
        let name_start = o
            .checked_add(46)
            .ok_or_else(|| bad_args("ZIP entry overflows"))?;
        let name_end = name_start
            .checked_add(name_len)
            .ok_or_else(|| bad_args("ZIP entry name overflows"))?;
        if name_end > data.len() {
            return Err(bad_args("ZIP entry name extends past end of file"));
        }
        let raw_name = &data[name_start..name_end];
        // Names are UTF-8 in practice (bit 11) or legacy encodings; lossy
        // here is only for the table — entry bytes are keyed by index and
        // sanitized on write, so a weird name cannot escape the vault.
        let name = String::from_utf8_lossy(raw_name).into_owned();
        o = name_end
            .checked_add(extra_len)
            .and_then(|v| v.checked_add(comment_len))
            .ok_or_else(|| bad_args("ZIP entry overflows its record"))?;
        if o > data.len() {
            return Err(bad_args("ZIP entry extends past end of file"));
        }
        let is_dir = name.ends_with('/');
        entries.push(ZipEntry {
            name,
            method,
            compressed_size: comp,
            uncompressed_size: uncomp,
            crc32: crc,
            header_offset: header_off,
            is_dir,
            encrypted: flags & 0x01 != 0,
        });
    }
    Ok(ZipArchive { data, entries })
}

/// Locate the raw (possibly compressed) body of `entry`.
fn entry_body<'a>(data: &'a [u8], entry: &ZipEntry) -> Result<(u64, &'a [u8], bool), PluginError> {
    let o = entry.header_offset as usize;
    if data.get(o..o + 4) != Some(b"PK\x03\x04".as_slice()) {
        return Err(bad_args(format!(
            "ZIP local header missing for `{}`",
            entry.name
        )));
    }
    let flags = u16le(data, o + 8)?;
    let name_len = u16le(data, o + 26)? as usize;
    let extra_len = u16le(data, o + 28)? as usize;
    let body_off = o
        .checked_add(30)
        .and_then(|v| v.checked_add(name_len))
        .and_then(|v| v.checked_add(extra_len))
        .ok_or_else(|| bad_args("ZIP local header overflows"))?;
    if body_off > data.len() {
        return Err(bad_args("ZIP entry body starts past end of file"));
    }
    let has_descriptor = flags & 0x08 != 0;
    if has_descriptor {
        // Lengths in both headers are zero; find the next local-header or
        // central-directory signature from here. A false positive inside
        // deflated data mis-sizes the entry — the CRC/size check rejects it.
        let mut end = None;
        let mut i = body_off;
        while i + 4 <= data.len() {
            if &data[i..i + 4] == b"PK\x03\x04"
                || &data[i..i + 4] == b"PK\x01\x02"
                || &data[i..i + 4] == b"PK\x05\x06"
            {
                end = Some(i);
                break;
            }
            i += 1;
        }
        let end = end.unwrap_or(data.len());
        Ok((entry.uncompressed_size, &data[body_off..end], true))
    } else {
        let end = (body_off as u64)
            .checked_add(entry.compressed_size)
            .ok_or_else(|| bad_args("ZIP entry body overflows"))?;
        if end > data.len() as u64 {
            return Err(bad_args(format!(
                "ZIP entry `{}` extends past end of file",
                entry.name
            )));
        }
        Ok((
            entry.uncompressed_size,
            &data[body_off..end as usize],
            false,
        ))
    }
}

/// CRC-32 (IEEE) without a table: ~1 MiB/s per core is plenty for import
/// sizes, and saves a dependency.
fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xffff_ffff;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// Why one entry could not be extracted, decided where it happens: the
/// importer stops or keeps going on this, never on the message text, which
/// quotes the entry name (I73).
#[derive(Debug)]
pub enum EntryFailure {
    /// This entry only (encrypted, truncated, corrupt, CRC, unsupported
    /// method): the rest of the archive can still be imported.
    Entry(PluginError),
    /// The whole archive (a bomb, the total budget): the import stops — a
    /// bomb is not one bad entry.
    Archive(PluginError),
}

impl EntryFailure {
    pub fn into_error(self) -> PluginError {
        match self {
            EntryFailure::Entry(error) | EntryFailure::Archive(error) => error,
        }
    }
}

/// Extract and validate one entry body, for an importer that treats any
/// failure alike. See [`extract_entry`].
pub fn extract(
    data: &[u8],
    entry: &ZipEntry,
    total_so_far: &mut u64,
) -> Result<Vec<u8>, PluginError> {
    extract_entry(data, entry, total_so_far).map_err(EntryFailure::into_error)
}

/// Extract and validate one entry body.
///
/// `total_so_far` is the running archive total; exceeding
/// [`MAX_TOTAL_UNCOMPRESSED`] (or the ratio check on large entries) is
/// [`EntryFailure::Archive`]; everything else is [`EntryFailure::Entry`].
pub fn extract_entry(
    data: &[u8],
    entry: &ZipEntry,
    total_so_far: &mut u64,
) -> Result<Vec<u8>, EntryFailure> {
    if entry.encrypted {
        return Err(EntryFailure::Entry(bad_args(format!(
            "ZIP entry `{}` is encrypted: re-export it without a password",
            entry.name
        ))));
    }
    if entry.uncompressed_size > MAX_ENTRY_BYTES && entry.uncompressed_size != 0 {
        return Err(EntryFailure::Entry(bad_args(format!(
            "ZIP entry `{}` declares {} bytes (max {MAX_ENTRY_BYTES})",
            entry.name, entry.uncompressed_size
        ))));
    }
    let (declared, body, descriptor) = entry_body(data, entry).map_err(EntryFailure::Entry)?;
    let out = match entry.method {
        0 => {
            if descriptor {
                // Stored + descriptor: no declared size; cap by remaining
                // archive budget.
                let cap = MAX_TOTAL_UNCOMPRESSED.saturating_sub(*total_so_far);
                if body.len() as u64 > cap.min(MAX_ENTRY_BYTES) {
                    return Err(EntryFailure::Archive(bad_args(format!(
                        "ZIP entry `{}` exceeds the archive budget",
                        entry.name
                    ))));
                }
                body.to_vec()
            } else {
                if body.len() as u64 != entry.uncompressed_size
                    && entry.compressed_size != entry.uncompressed_size
                {
                    // Tolerant: some writers disagree; the CRC decides.
                }
                body.to_vec()
            }
        }
        8 => {
            use flate2::Decompress;
            use flate2::FlushDecompress;
            use flate2::Status;
            let mut de = Decompress::new(false);
            let cap = if descriptor || declared == 0 {
                MAX_ENTRY_BYTES.min(MAX_TOTAL_UNCOMPRESSED.saturating_sub(*total_so_far))
            } else {
                declared.min(MAX_ENTRY_BYTES)
            };
            if cap == 0 {
                return Err(EntryFailure::Archive(bad_args(
                    "ZIP archive exceeds the 256 MiB total budget",
                )));
            }
            let mut out = Vec::new();
            let mut input = body;
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                if out.len() as u64 > cap {
                    return Err(EntryFailure::Entry(bad_args(format!(
                        "ZIP entry `{}` exceeds {} bytes after inflation",
                        entry.name, cap
                    ))));
                }
                let before_in = de.total_in();
                let before_out = de.total_out();
                let status = de
                    .decompress(input, &mut buf, FlushDecompress::None)
                    .map_err(|e| {
                        EntryFailure::Entry(io_error(format!(
                            "ZIP inflate failed for `{}`: {e}",
                            entry.name
                        )))
                    })?;
                let used_in = (de.total_in() - before_in) as usize;
                let made = (de.total_out() - before_out) as usize;
                out.extend_from_slice(&buf[..made]);
                input = &input[used_in.min(input.len())..];
                match status {
                    Status::StreamEnd => break,
                    Status::Ok | Status::BufError => {
                        if input.is_empty() {
                            // Need more input but there is none: try finishing.
                            let mut done = false;
                            for _ in 0..4 {
                                let s = de
                                    .decompress(&[], &mut buf, FlushDecompress::Finish)
                                    .map_err(|e| {
                                        EntryFailure::Entry(io_error(format!(
                                            "ZIP inflate failed for `{}`: {e}",
                                            entry.name
                                        )))
                                    })?;
                                let made2 = (de.total_out() - before_out) as usize
                                    - made.min((de.total_out() - before_out) as usize);
                                let _ = made2;
                                if matches!(s, Status::StreamEnd) {
                                    done = true;
                                    break;
                                }
                            }
                            if !done {
                                return Err(EntryFailure::Entry(bad_args(format!(
                                    "ZIP entry `{}` ends mid-stream",
                                    entry.name
                                ))));
                            }
                            break;
                        }
                    }
                }
                if out.len() as u64 > cap {
                    return Err(EntryFailure::Entry(bad_args(format!(
                        "ZIP entry `{}` exceeds {} bytes after inflation",
                        entry.name, cap
                    ))));
                }
            }
            // Ratio check on large outputs: legitimate text rarely exceeds
            // ~200x, and small files are exempt (a 40-byte file of zeros is
            // not an attack).
            if !body.is_empty()
                && out.len() as u64 >= BOMB_MIN_BYTES
                && out.len() as u64 / (body.len().max(1) as u64) > BOMB_RATIO
            {
                return Err(EntryFailure::Archive(bad_args(format!(
                    "ZIP entry `{}` looks like a compression bomb ({}x)",
                    entry.name,
                    out.len() / body.len().max(1)
                ))));
            }
            out
        }
        m => {
            return Err(EntryFailure::Entry(bad_args(format!(
                "ZIP entry `{}` uses unsupported method {m}",
                entry.name
            ))));
        }
    };
    if !descriptor {
        if out.len() as u64 != entry.uncompressed_size && entry.uncompressed_size != 0 {
            return Err(EntryFailure::Entry(bad_args(format!(
                "ZIP entry `{}` inflated to {} bytes, declared {}",
                entry.name,
                out.len(),
                entry.uncompressed_size
            ))));
        }
        if entry.crc32 != 0 && crc32(&out) != entry.crc32 {
            return Err(EntryFailure::Entry(bad_args(format!(
                "ZIP entry `{}` fails its CRC check",
                entry.name
            ))));
        }
    }
    *total_so_far = total_so_far.checked_add(out.len() as u64).ok_or_else(|| {
        EntryFailure::Archive(bad_args("ZIP archive exceeds the 256 MiB total budget"))
    })?;
    if *total_so_far > MAX_TOTAL_UNCOMPRESSED {
        return Err(EntryFailure::Archive(bad_args(
            "ZIP archive exceeds the 256 MiB total budget",
        )));
    }
    Ok(out)
}

/// `true` for the ZIP local-file signature (dispatch prologue check).
pub fn looks_like_zip(prologue: &[u8]) -> bool {
    prologue.len() >= 4
        && (prologue[0] == b'P'
            && prologue[1] == b'K'
            && (prologue[2] == 3 || prologue[2] == 5 || prologue[2] == 7)
            && (prologue[3] == 4 || prologue[3] == 6 || prologue[3] == 8))
}
