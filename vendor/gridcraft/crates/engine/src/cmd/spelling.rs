//! Spelling: checks text cells against the system word list (`/usr/share/dict/words` on macOS
//! and Linux; nothing is bundled) plus a user dictionary kept in the engine preferences.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, PoisonError, RwLock};

use gridcraft_core::{RangeRef, Value};
use serde_json::{Value as Json, json};

use super::*;

pub fn specs() -> Vec<CommandSpec> {
    vec![
        cmd!(query "review.spelling", "Spelling", ["Review", "Proofing"], Some("F7"), "{range?, sheet?} → misspelled words with cells and suggestions", has_doc, spelling),
        cmd!(noundo "review.addToDictionary", "Add to Dictionary", [], None, "{word}", has_doc, add_word),
        cmd!("review.changeSpelling", "Change", [], None, "{cell, word, to, all?: bool}", has_doc, change),
        cmd!(query "review.thesaurus", "Thesaurus", ["Review", "Proofing"], None, "{word} → related words (words sharing the stem in the dictionary)", has_doc, thesaurus),
    ]
}

/// A word list read on first use and kept until it is released ([`release_spelling_dictionary`]); the next use reads
/// it again. Readers share it through an `Arc`, so releasing never invalidates a list in use: whoever holds it keeps it
/// until done. The read happens outside the slot's lock (a release or a size query never waits for it), and one
/// thread reads while the others wanting the list wait for that read instead of repeating it.
struct WordList {
    slot: RwLock<Option<(Arc<HashSet<String>>, usize)>>,
    loading: Mutex<()>,
}

impl WordList {
    const fn new() -> Self {
        WordList { slot: RwLock::new(None), loading: Mutex::new(()) }
    }

    fn get(&self, read: impl FnOnce() -> HashSet<String>) -> Arc<HashSet<String>> {
        let cached = || self.slot.read().unwrap_or_else(PoisonError::into_inner).as_ref().map(|(d, _)| d.clone());
        if let Some(d) = cached() {
            return d;
        }
        let _loading = self.loading.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(d) = cached() {
            return d;
        }
        let d = Arc::new(read());
        let bytes = set_bytes(&d);
        let mut slot = self.slot.write().unwrap_or_else(PoisonError::into_inner);
        slot.get_or_insert((d, bytes)).0.clone()
    }

    fn bytes(&self) -> usize {
        self.slot.read().unwrap_or_else(PoisonError::into_inner).as_ref().map_or(0, |(_, b)| *b)
    }

    fn release(&self) -> usize {
        self.slot.write().unwrap_or_else(PoisonError::into_inner).take().map_or(0, |(_, b)| b)
    }
}

/// Estimated heap bytes of a set of strings: the hash table (a `String` and a control byte per bucket, the buckets
/// being the table's capacity over its 7/8 load factor, plus one group of control bytes) and each string's buffer
/// by capacity. Allocator overhead isn't counted.
fn set_bytes(set: &HashSet<String>) -> usize {
    let cap = set.capacity();
    let buckets = match cap {
        0 => return set.iter().map(String::capacity).sum(),
        1..7 => cap + 1,
        _ => cap / 7 * 8,
    };
    buckets * (std::mem::size_of::<String>() + 1) + 16 + set.iter().map(String::capacity).sum::<usize>()
}

static DICT: WordList = WordList::new();

/// The system word list, lower-cased; empty when there is none (or on the web).
fn read_system_list() -> HashSet<String> {
    #[cfg(target_arch = "wasm32")]
    {
        HashSet::new()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        read_word_list(&["/usr/share/dict/words", "/usr/share/dict/american-english", "/usr/share/dict/british-english"])
    }
}

/// The first of `paths` that can be read, one word per line (at most 2,000,000), lower-cased.
#[cfg(not(target_arch = "wasm32"))]
fn read_word_list(paths: &[&str]) -> HashSet<String> {
    let mut set = HashSet::new();
    for path in paths {
        if let Ok(text) = std::fs::read_to_string(path) {
            for w in text.lines().take(2_000_000) {
                set.insert(w.trim().to_lowercase());
            }
            break;
        }
    }
    set
}

fn dictionary() -> Arc<HashSet<String>> {
    DICT.get(read_system_list)
}

/// Estimated heap bytes of the spelling word list now in memory (0 when it isn't loaded, or there is none). See
/// [`set_bytes`] for how the estimate is made.
pub fn spelling_dictionary_bytes() -> usize {
    DICT.bytes()
}

/// Drop the spelling word list; the next spelling check or thesaurus lookup reads it again. A check running on
/// another thread finishes with the list it has. Returns the estimated bytes released (0 when it wasn't loaded).
/// The user dictionary is part of the preferences and stays.
pub fn release_spelling_dictionary() -> usize {
    DICT.release()
}

fn known(s: &Session, w: &str) -> bool {
    let l = w.to_lowercase();
    let dict = dictionary();
    if dict.contains(&l) || s.prefs.user_dictionary.iter().any(|u| u.eq_ignore_ascii_case(w)) {
        return true;
    }
    // Simple inflections the list doesn't spell out.
    for suf in ["s", "es", "ed", "ing", "ly", "er", "ers", "'s"] {
        if let Some(stem) = l.strip_suffix(suf)
            && stem.len() > 2
            && (dict.contains(stem) || dict.contains(&format!("{stem}e")))
        {
            return true;
        }
    }
    if let Some(stem) = l.strip_suffix("ies")
        && dict.contains(&format!("{stem}y"))
    {
        return true;
    }
    false
}

/// Longest word we generate suggestions for. Candidate text grows with the square of the word length, so longer
/// tokens (no real word is this long) get no suggestions instead of an unbounded allocation.
const MAX_SUGGEST_LEN: usize = 64;

fn edits1(w: &str) -> Vec<String> {
    if w.chars().count() > MAX_SUGGEST_LEN {
        return Vec::new();
    }
    let chars: Vec<char> = w.chars().collect();
    let mut out = Vec::new();
    let letters = "abcdefghijklmnopqrstuvwxyz";
    for i in 0..=chars.len() {
        if i < chars.len() {
            let mut d = chars.clone();
            d.remove(i);
            out.push(d.iter().collect());
            if i + 1 < chars.len() {
                let mut t = chars.clone();
                t.swap(i, i + 1);
                out.push(t.iter().collect());
            }
            for c in letters.chars() {
                let mut r = chars.clone();
                r[i] = c;
                out.push(r.iter().collect());
            }
        }
        for c in letters.chars() {
            let mut ins = chars.clone();
            ins.insert(i, c);
            out.push(ins.iter().collect());
        }
    }
    out
}

fn suggestions(w: &str) -> Vec<String> {
    let dict = dictionary();
    let l = w.to_lowercase();
    let mut out: Vec<String> = edits1(&l).into_iter().filter(|c| dict.contains(c)).collect();
    out.sort();
    out.dedup();
    out.truncate(6);
    // Keep the original capitalisation.
    let cap = w.chars().next().is_some_and(char::is_uppercase);
    out.into_iter()
        .map(|s| {
            if cap {
                let mut c = s.chars();
                c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or(s)
            } else {
                s
            }
        })
        .collect()
}

fn spelling(s: &mut Session, p: &Json) -> Result<Json> {
    if dictionary().is_empty() {
        return Err(EngineError::Other("No dictionary is available on this system (GridCraft uses the system word list).".into()));
    }
    let si = target_sheet(s, p)?;
    let d = s.doc()?;
    let sh = d.wb.sheet(si).ok_or(EngineError::NoDocument)?;
    let scope = match str_param(p, "range") {
        Some(_) => target_range(s, p)?,
        None => sh.used_range().unwrap_or(RangeRef::cell(d.selection.active)),
    };
    let mut issues = Vec::new();
    for (c, cell) in sh.cells.iter_range(scope) {
        if cell.formula.is_some() {
            continue;
        }
        let Value::Text(t) = &cell.value else { continue };
        for w in t.split(|ch: char| !(ch.is_alphabetic() || ch == '\'')) {
            let w = w.trim_matches('\'');
            if w.chars().count() < 2 || w.chars().all(char::is_uppercase) || !w.is_ascii() {
                continue;
            }
            if !known(s, w) {
                issues.push(json!({"cell": c.a1(), "word": w, "suggestions": suggestions(w)}));
            }
        }
        if issues.len() >= 500 {
            break;
        }
    }
    Ok(json!({"issues": issues, "done": issues.is_empty()}))
}

fn add_word(s: &mut Session, p: &Json) -> Result<Json> {
    let w = str_param(p, "word").ok_or_else(|| bad("review.addToDictionary", "missing `word`"))?.to_string();
    if !s.prefs.user_dictionary.iter().any(|u| u.eq_ignore_ascii_case(&w)) {
        s.prefs.user_dictionary.push(w);
    }
    ok()
}

fn change(s: &mut Session, p: &Json) -> Result<Json> {
    let word = str_param(p, "word").ok_or_else(|| bad("review.changeSpelling", "missing `word`"))?.to_string();
    let to = str_param(p, "to").ok_or_else(|| bad("review.changeSpelling", "missing `to`"))?.to_string();
    if bool_param(p, "all").unwrap_or(false) {
        return s.execute("edit.replace", json!({"what": word, "with": to, "matchCase": true, "all": true}));
    }
    let c = cell_param(s, p, "cell")?.ok_or_else(|| bad("review.changeSpelling", "missing `cell`"))?;
    let text = s.doc()?.wb.active().and_then(|sh| sh.cell(c)).map(|x| x.input_text()).unwrap_or_default();
    s.execute("cell.set", json!({"cell": c.a1(), "input": text.replacen(&word, &to, 1)}))
}

fn thesaurus(_: &mut Session, p: &Json) -> Result<Json> {
    let w = str_param(p, "word").unwrap_or("").to_lowercase();
    if w.len() < 3 {
        return Ok(json!([]));
    }
    let stem: String = w.chars().take(w.chars().count().saturating_sub(2).max(3)).collect();
    let dict = dictionary();
    let mut related: Vec<&String> = dict.iter().filter(|d| d.starts_with(&stem) && **d != w && d.len() <= w.len() + 4).collect();
    related.sort();
    related.truncate(20);
    Ok(json!(related))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits1_is_capped_for_very_long_words() {
        assert_eq!(edits1("helo").len(), 54 * 4 + 25);
        assert_eq!(edits1(&"a".repeat(MAX_SUGGEST_LEN)).len(), 54 * MAX_SUGGEST_LEN + 25);
        assert!(edits1(&"a".repeat(MAX_SUGGEST_LEN + 1)).is_empty());
        assert!(edits1(&"a".repeat(1_000_000)).is_empty());
    }

    #[test]
    fn a_released_word_list_is_read_again() {
        let path = std::env::temp_dir().join(format!("gridcraft-words-{}", std::process::id()));
        std::fs::write(&path, "Apple\nbanana\ncherry\n").unwrap();
        let path = path.to_str().unwrap().to_string();
        let list = WordList::new();
        let read = || read_word_list(&["/nonexistent/gridcraft/words", &path]);
        assert_eq!(list.bytes(), 0);
        let held = list.get(read);
        assert!(held.contains("apple") && held.len() == 3);
        let bytes = list.bytes();
        assert!(bytes >= 3 * std::mem::size_of::<String>(), "{bytes}");
        // Released while someone holds it: the holder keeps a working list, the slot is empty.
        assert_eq!(list.release(), bytes);
        assert_eq!(list.bytes(), 0);
        assert!(held.contains("banana"));
        assert_eq!(list.release(), 0, "releasing twice is harmless");
        let again = list.get(read);
        assert!(again.contains("cherry") && !Arc::ptr_eq(&held, &again));
        assert_eq!(list.bytes(), bytes);
        std::fs::remove_file(&path).unwrap();
        // No word list on the system: an empty list, which holds nothing.
        let none = WordList::new();
        assert!(none.get(|| read_word_list(&["/nonexistent/gridcraft/words"])).is_empty());
        assert_eq!(none.bytes(), 0);
    }

    #[test]
    fn the_spelling_dictionary_comes_back_after_a_release() {
        let mut s = Session::new();
        s.execute("file.new", json!({})).unwrap();
        s.execute("cell.set", json!({"cell": "A1", "input": "house wrold"})).unwrap();
        release_spelling_dictionary();
        release_spelling_dictionary();
        let r = s.execute("review.spelling", json!({}));
        if dictionary().is_empty() {
            assert!(r.is_err(), "no system word list: {r:?}");
            assert_eq!(spelling_dictionary_bytes(), 0);
        } else {
            assert!(spelling_dictionary_bytes() > 0);
            let words: Vec<_> = r.unwrap()["issues"].as_array().unwrap().iter().map(|i| i["word"].clone()).collect();
            assert_eq!(words, [json!("wrold")]);
        }
    }
}
