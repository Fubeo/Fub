//! Durable per-replica queue (P16.1, Main-ordered recovery).
//!
//! Layout: `<data>/sync/queue-<replica>.jsonl`, one [`super::SyncOp`] per
//! line. Every batch ends with `File::sync_all` + parent-dir fsync, so a
//! crash mid-queue loses at most the in-flight batch.
//!
//! Authority model (Main): the unacked queue is AUTHORITY (must never drop),
//! pulled/applied data is CACHE (droppable). Consequences:
//! - A corrupt/oversize/unreadable line is quarantined to
//!   `queue-<replica>.corrupt-<ts>.jsonl` (fsynced) and load returns
//!   [`QueueError::RecoveryNeeded`] with quarantined + preserved counts. The
//!   replica NEVER reads as current after corruption: callers surface an
//!   explicit recovery/resync path that replays quarantined + preserved data
//!   explicitly, never skip-and-current.
//! - A full queue returns [`QueueError::QueueFull`] backpressure (no drop):
//!   the caller surfaces `truncated=true` + an explicit resync instruction.
//! - Retention expiry applies to tombstones/versions only, never to unacked
//!   authority ops.

use std::collections::BTreeSet;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use crate::schema::{atomic_write, ServiceQuotas};

/// Cap so a single replica queue cannot grow the process without bound.
/// Reaching it is [`QueueError::QueueFull`], never a silent drop.
pub const MAX_QUEUE_OPS: usize = 50_000;
/// One serialized operation must fit this line, including AAD and base64.
/// Reject before append: a writer must never create its own corrupt queue.
pub const MAX_LINE_BYTES: usize = 10 * 1024 * 1024;

/// Queue failure modes. `RecoveryNeeded` and `QueueFull` are explicit
/// resync paths, never success-with-loss.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QueueError {
    /// Corruption detected: `quarantined` lines moved aside (fsynced),
    /// `preserved` good ops still loadable. The replica must NOT read as
    /// current: resync replays quarantined + preserved explicitly.
    RecoveryNeeded {
        quarantined: usize,
        preserved: usize,
    },
    /// Authority cap reached: `pending` ops await drain. Caller must surface
    /// backpressure (truncated + resync instruction), never drop.
    QueueFull { pending: usize },
    /// Filesystem failure (open/append/fsync/rewrite).
    Io(String),
}

impl std::fmt::Display for QueueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueueError::RecoveryNeeded {
                quarantined,
                preserved,
            } => write!(
                f,
                "recovery needed: {quarantined} quarantined, {preserved} preserved"
            ),
            QueueError::QueueFull { pending } => {
                write!(f, "queue full: {pending} pending, drain via pull+ack")
            }
            QueueError::Io(e) => write!(f, "queue io: {e}"),
        }
    }
}

/// `<data>/sync/queue-<replica>.jsonl`. Replica ids are UUID v4; sanitize
/// defensively so a hostile id cannot escape the sync dir.
pub fn queue_path(sync_dir: &Path, replica_id: &str) -> PathBuf {
    let safe: String = replica_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(128)
        .collect();
    sync_dir.join(format!("queue-{safe}.jsonl"))
}

/// Quarantine path for corrupt lines: `queue-<replica>.corrupt-<ts>.jsonl`.
pub fn quarantine_path(sync_dir: &Path, replica_id: &str, ts_ms: u64) -> PathBuf {
    let safe: String = replica_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(128)
        .collect();
    sync_dir.join(format!("queue-{safe}.corrupt-{ts_ms}.jsonl"))
}

/// Append a batch of already-serialized op lines (JSON) with fsync per batch.
/// Creates the sync dir when missing. Never logs op bodies (ciphertext only).
pub fn append_lines(sync_dir: &Path, replica_id: &str, lines: &[String]) -> Result<(), QueueError> {
    if lines
        .iter()
        .any(|line| line.len() > MAX_LINE_BYTES || line.contains('\n'))
    {
        return Err(QueueError::Io(
            "sync operation exceeds queue line cap".to_string(),
        ));
    }
    std::fs::create_dir_all(sync_dir).map_err(|e| QueueError::Io(format!("sync dir: {e}")))?;
    // Backpressure before append: a full authority queue never drops.
    let pending = count_lines(sync_dir, replica_id)?;
    if pending + lines.len() > MAX_QUEUE_OPS {
        return Err(QueueError::QueueFull {
            pending: pending + lines.len(),
        });
    }
    let path = queue_path(sync_dir, replica_id);
    let mut file: File = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| QueueError::Io(format!("queue open: {e}")))?;
    for line in lines {
        file.write_all(line.as_bytes())
            .map_err(|e| QueueError::Io(format!("queue append: {e}")))?;
        file.write_all(b"\n")
            .map_err(|e| QueueError::Io(format!("queue append: {e}")))?;
    }
    file.sync_all()
        .map_err(|e| QueueError::Io(format!("queue fsync: {e}")))?;
    drop(file);
    // Fsync the directory so the append itself survives a crash.
    if let Ok(dir) = File::open(sync_dir) {
        let _ = dir.sync_all();
    }
    Ok(())
}

/// Append typed ops (serializes each with `serde_json`).
pub fn append_ops(
    sync_dir: &Path,
    replica_id: &str,
    ops: &[super::SyncOp],
) -> Result<(), QueueError> {
    let lines: Result<Vec<String>, QueueError> = ops
        .iter()
        .map(|op| {
            serde_json::to_string(op).map_err(|e| QueueError::Io(format!("queue encode: {e}")))
        })
        .collect();
    append_lines(sync_dir, replica_id, &lines?)
}

fn count_lines(sync_dir: &Path, replica_id: &str) -> Result<usize, QueueError> {
    let path = queue_path(sync_dir, replica_id);
    if !path.exists() {
        return Ok(0);
    }
    let file = File::open(&path).map_err(|e| QueueError::Io(format!("queue read: {e}")))?;
    let mut n = 0;
    for line in BufReader::new(file).lines() {
        line.map_err(|e| QueueError::Io(format!("queue read: {e}")))?;
        n += 1;
    }
    Ok(n)
}

/// Load the queue for `replica_id`. Blank lines are ignored (writer always
/// terminates with `\n`; a trailing blank is not corruption). ANY other
/// unloadable line (oversize, corrupt JSON, wrong shape) is quarantined to a
/// `.corrupt-<ts>` file (fsynced) and the load returns
/// [`QueueError::RecoveryNeeded`] — the replica never reads as current after
/// corruption. Callers replay via [`recovery_replay`] explicitly.
pub fn load_ops(sync_dir: &Path, replica_id: &str) -> Result<Vec<super::SyncOp>, QueueError> {
    let path = queue_path(sync_dir, replica_id);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(&path).map_err(|e| QueueError::Io(format!("queue read: {e}")))?;
    let reader = BufReader::new(file);
    let mut out = Vec::new();
    let mut bad: Vec<String> = Vec::new();
    let mut good_lines: Vec<String> = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| QueueError::Io(format!("queue read: {e}")))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.len() > MAX_LINE_BYTES {
            bad.push(line);
            continue;
        }
        match serde_json::from_str::<super::SyncOp>(trimmed) {
            Ok(op) => {
                good_lines.push(trimmed.to_string());
                out.push(op);
            }
            Err(_) => bad.push(line),
        }
    }
    if !bad.is_empty() {
        let ts = crate::schema::now_ms();
        let qpath = quarantine_path(sync_dir, replica_id, ts);
        let mut buf = String::new();
        for line in &bad {
            buf.push_str(line);
            buf.push('\n');
        }
        atomic_write(&qpath, buf.as_bytes())
            .map_err(|e| QueueError::Io(format!("quarantine write: {e}")))?;
        let mut preserved_bytes = good_lines.join("\n").into_bytes();
        if !preserved_bytes.is_empty() {
            preserved_bytes.push(b'\n');
        }
        atomic_write(&path, &preserved_bytes)
            .map_err(|e| QueueError::Io(format!("queue recovery write: {e}")))?;
        return Err(QueueError::RecoveryNeeded {
            quarantined: bad.len(),
            preserved: out.len(),
        });
    }
    Ok(out)
}

/// Explicit recovery replay: load quarantined lines (best-effort parse —
/// lines that still fail to parse stay quarantined and are reported) plus
/// the preserved good ops. Returns `(recovered_ops, still_bad)`. The caller
/// folds recovered ops explicitly and only then clears the quarantine file.
pub fn recovery_replay(
    sync_dir: &Path,
    replica_id: &str,
) -> Result<(Vec<super::SyncOp>, usize), QueueError> {
    let preserved = match load_ops(sync_dir, replica_id) {
        Ok(ops) => ops,
        Err(QueueError::RecoveryNeeded { .. }) => {
            return Err(QueueError::Io(
                "queue stayed corrupt after quarantine; operator intervention required".to_string(),
            ));
        }
        Err(e) => return Err(e),
    };
    let mut recovered = preserved;
    let mut still_bad = 0;
    collect_quarantined(sync_dir, replica_id, &mut recovered, &mut still_bad)?;
    Ok((recovered, still_bad))
}

fn collect_quarantined(
    sync_dir: &Path,
    replica_id: &str,
    out: &mut Vec<super::SyncOp>,
    still_bad: &mut usize,
) -> Result<(), QueueError> {
    let safe: String = replica_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(128)
        .collect();
    let prefix = format!("queue-{safe}.corrupt-");
    let entries =
        std::fs::read_dir(sync_dir).map_err(|e| QueueError::Io(format!("sync dir read: {e}")))?;
    for entry in entries {
        let entry = entry.map_err(|e| QueueError::Io(format!("sync dir entry: {e}")))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(&prefix) || !name.ends_with(".jsonl") {
            continue;
        }
        let bytes = std::fs::read(entry.path())
            .map_err(|e| QueueError::Io(format!("quarantine read: {e}")))?;
        let text = String::from_utf8_lossy(&bytes);
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<super::SyncOp>(trimmed) {
                Ok(op) => out.push(op),
                Err(_) => *still_bad += 1,
            }
        }
    }
    Ok(())
}

/// Durably remove acked `op_id`s: rewrite without them via atomic write.
/// Ack durability = the rewrite is fsynced before returning.
pub fn ack_ops(sync_dir: &Path, replica_id: &str, ack: &[String]) -> Result<usize, QueueError> {
    if ack.is_empty() {
        return Ok(0);
    }
    let acked: BTreeSet<&str> = ack.iter().map(|s| s.as_str()).collect();
    let ops = load_ops(sync_dir, replica_id)?;
    let before = ops.len();
    let kept: Vec<super::SyncOp> = ops
        .into_iter()
        .filter(|op| !acked.contains(op.op_id.as_str()))
        .collect();
    let removed = before - kept.len();
    if removed == 0 {
        return Ok(0);
    }
    let mut buf = String::new();
    for op in &kept {
        let line =
            serde_json::to_string(op).map_err(|e| QueueError::Io(format!("queue encode: {e}")))?;
        buf.push_str(&line);
        buf.push('\n');
    }
    atomic_write(&queue_path(sync_dir, replica_id), buf.as_bytes())
        .map_err(|e| QueueError::Io(format!("queue ack write: {e}")))?;
    Ok(removed)
}

/// Check the authority queue's caps. Unacked ops are NEVER expired by wall
/// clock: even an old offline replica must receive them until explicit ack.
/// Returns `(0, false)` on success for the existing caller contract.
pub fn enforce_cap(
    sync_dir: &Path,
    replica_id: &str,
    quotas: &ServiceQuotas,
    _now_ms: u64,
) -> Result<(usize, bool), QueueError> {
    let ops = load_ops(sync_dir, replica_id)?;
    if ops.len() > MAX_QUEUE_OPS {
        return Err(QueueError::QueueFull { pending: ops.len() });
    }
    let mut bytes: usize = 0;
    for op in &ops {
        bytes = bytes.saturating_add(
            serde_json::to_string(op)
                .map_err(|e| QueueError::Io(format!("queue encode: {e}")))?
                .len()
                + 1,
        );
    }
    let cap = quotas.max_vault_bytes as usize;
    if cap > 0 && bytes > cap {
        return Err(QueueError::QueueFull { pending: ops.len() });
    }
    Ok((0, false))
}

/// Byte size of a replica queue file (0 when absent).
pub fn queue_bytes(sync_dir: &Path, replica_id: &str) -> u64 {
    std::fs::metadata(queue_path(sync_dir, replica_id))
        .map(|m| m.len())
        .unwrap_or(0)
}
