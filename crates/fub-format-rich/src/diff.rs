//! La sottosequenza comune di due sequenze, per allineare blocchi, caratteri e
//! segni senza un costo quadratico.
//!
//! [`common`] dà le coppie `(i, j)`, crescenti in tutti e due gli indici, di
//! elementi uguali di `a` e `b`. Toglie prima il prefisso e il suffisso comuni,
//! poi cerca il serpente centrale di Myers ("An O(ND) Difference Algorithm and
//! Its Variations", 1986) e ricomincia sulle due metà: il costo è
//! O((N+M)·D) nel tempo e lineare nella memoria, con D il numero delle
//! differenze.
//!
//! Quando le differenze sono tante il lavoro di Myers ha un tetto
//! ([`BUDGET`]): oltre, il tratto si allinea sulle **ancore**, gli elementi che
//! compaiono una volta sola in tutti e due i lati (l'idea di patience diff), e
//! i tratti fra due ancore ricominciano da capo. Un tratto senza ancore resta
//! senza coppie. Anche le ancore hanno un tetto ([`ANCHOR_BUDGET`],
//! [`ANCHOR_SPAN`]), e i loro tratti stanno in una pila esplicita: un file
//! ostile costa al più il tetto, mai la pila del thread o gigabyte di memoria. Chi usa il risultato lo legge come «toccato», mai come
//! «uguale»: un allineamento più povero costa lavoro in più o un controllo in
//! più, non una garanzia in meno.

use std::collections::HashMap;
use std::hash::Hash;

/// Il lavoro di Myers, in passi, oltre il quale un tratto si allinea sulle
/// ancore.
pub(crate) const BUDGET: u64 = 64_000_000;

/// Gli elementi che le ancore possono contare in tutto: ogni tratto li conta
/// una volta per lato. Oltre, i tratti restano senza coppie.
pub(crate) const ANCHOR_BUDGET: u64 = 64_000_000;

/// Il tratto più lungo (i due lati insieme) su cui si cercano ancore: la
/// tabella degli elementi è grande quanto il tratto.
pub(crate) const ANCHOR_SPAN: usize = 4_000_000;

/// Fin dove arriva `d` nei vettori di Myers con `remaining` passi di lavoro
/// ancora permessi: al passo `d` il lavoro speso è almeno `d²`, quindi oltre
/// la radice il tetto ferma la ricerca prima. Mai oltre `max_d`.
fn reach(remaining: u64, max_d: isize) -> isize {
    if remaining == 0 {
        return 0;
    }
    let limit = isize::try_from(remaining.isqrt().saturating_add(1)).unwrap_or(isize::MAX);
    limit.min(max_d)
}

/// Le coppie di una sottosequenza comune di `a` e `b`, crescenti.
pub(crate) fn common<T: Eq + Hash>(a: &[T], b: &[T]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut work = Work {
        a,
        b,
        spent: 0,
        anchored: 0,
        out: &mut out,
    };
    work.walk(0, a.len(), 0, b.len());
    out
}

/// Un passo della pila delle ancore, nell'ordine in cui scrive le coppie.
enum Step {
    /// Un tratto da allineare.
    Span(usize, usize, usize, usize),
    /// Un'ancora.
    Pair(usize, usize),
    /// Il suffisso comune di un tratto: `n` coppie da `(a, b)`.
    Suffix(usize, usize, usize),
}

struct Work<'a, T> {
    a: &'a [T],
    b: &'a [T],
    spent: u64,
    /// Gli elementi già contati dalle ancore, per [`ANCHOR_BUDGET`].
    anchored: u64,
    out: &'a mut Vec<(usize, usize)>,
}

impl<T: Eq + Hash> Work<'_, T> {
    /// Allinea `a[a0..a1]` con `b[b0..b1]`, aggiungendo le coppie in ordine.
    fn walk(&mut self, mut a0: usize, mut a1: usize, mut b0: usize, mut b1: usize) {
        while a0 < a1 && b0 < b1 && self.a[a0] == self.b[b0] {
            self.out.push((a0, b0));
            a0 += 1;
            b0 += 1;
        }
        let mut suffix = 0;
        while a0 < a1 && b0 < b1 && self.a[a1 - 1] == self.b[b1 - 1] {
            a1 -= 1;
            b1 -= 1;
            suffix += 1;
        }
        if a0 < a1 && b0 < b1 {
            match self.bisect(a0, a1, b0, b1) {
                Some((x, y)) => {
                    self.walk(a0, x, b0, y);
                    self.walk(x, a1, y, b1);
                }
                None => self.walk_anchored(a0, a1, b0, b1),
            }
        }
        self.out.extend((0..suffix).map(|k| (a1 + k, b1 + k)));
    }

    /// Il punto dove il serpente centrale divide il tratto, o `None` se non
    /// c'è niente in comune o il lavoro supera il tetto.
    fn bisect(&mut self, a0: usize, a1: usize, b0: usize, b1: usize) -> Option<(usize, usize)> {
        let (n, m) = ((a1 - a0) as isize, (b1 - b0) as isize);
        // I vettori servono fin dove il tetto lascia arrivare `d`, non fino a
        // metà dei due lati: con due lati di cento milioni di elementi
        // sarebbero gigabyte allocati prima del primo passo.
        let max_d = reach(BUDGET.saturating_sub(self.spent), (n + m + 1) / 2);
        let offset = max_d;
        let length = 2 * max_d + 2;
        let mut v1 = vec![-1isize; length as usize];
        let mut v2 = vec![-1isize; length as usize];
        v1[(offset + 1) as usize] = 0;
        v2[(offset + 1) as usize] = 0;
        let delta = n - m;
        let front = delta % 2 != 0;
        let (mut k1start, mut k1end, mut k2start, mut k2end) = (0isize, 0isize, 0isize, 0isize);
        let (sa, sb) = (self.a, self.b);
        let a = |x: isize| &sa[a0 + x as usize];
        let b = |y: isize| &sb[b0 + y as usize];
        let mut spent = self.spent;
        for d in 0..max_d {
            spent += (2 * d + 1) as u64;
            if spent > BUDGET {
                self.spent = spent;
                return None;
            }
            let mut k1 = -d + k1start;
            while k1 <= d - k1end {
                let at = (offset + k1) as usize;
                let mut x1 = if k1 == -d || (k1 != d && v1[at - 1] < v1[at + 1]) {
                    v1[at + 1]
                } else {
                    v1[at - 1] + 1
                };
                let mut y1 = x1 - k1;
                while x1 < n && y1 < m && a(x1) == b(y1) {
                    x1 += 1;
                    y1 += 1;
                    spent += 1;
                }
                v1[at] = x1;
                if x1 > n {
                    k1end += 2;
                } else if y1 > m {
                    k1start += 2;
                } else if front {
                    let k2 = offset + delta - k1;
                    if k2 >= 0 && k2 < length && v2[k2 as usize] != -1 {
                        let x2 = n - v2[k2 as usize];
                        if x1 >= x2 {
                            self.spent = spent;
                            return Some((a0 + x1 as usize, b0 + y1 as usize));
                        }
                    }
                }
                k1 += 2;
            }
            let mut k2 = -d + k2start;
            while k2 <= d - k2end {
                let at = (offset + k2) as usize;
                let mut x2 = if k2 == -d || (k2 != d && v2[at - 1] < v2[at + 1]) {
                    v2[at + 1]
                } else {
                    v2[at - 1] + 1
                };
                let mut y2 = x2 - k2;
                while x2 < n && y2 < m && a(n - x2 - 1) == b(m - y2 - 1) {
                    x2 += 1;
                    y2 += 1;
                    spent += 1;
                }
                v2[at] = x2;
                if x2 > n {
                    k2end += 2;
                } else if y2 > m {
                    k2start += 2;
                } else if !front {
                    let k1 = offset + delta - k2;
                    if k1 >= 0 && k1 < length && v1[k1 as usize] != -1 {
                        let x1 = v1[k1 as usize];
                        let y1 = offset + x1 - k1;
                        if x1 >= n - x2 {
                            self.spent = spent;
                            return Some((a0 + x1 as usize, b0 + y1 as usize));
                        }
                    }
                }
                k2 += 2;
            }
        }
        self.spent = spent;
        None
    }

    /// Le ancore di `a[a0..a1]` e `b[b0..b1]`: gli elementi che compaiono una
    /// volta sola per lato, nell'ordine più lungo che rispettano tutti e due.
    /// Vuota se il tratto supera i tetti delle ancore.
    fn anchors(&mut self, a0: usize, a1: usize, b0: usize, b1: usize) -> Vec<(usize, usize)> {
        let size = (a1 - a0) + (b1 - b0);
        let spend = self.anchored.saturating_add(size as u64);
        if size > ANCHOR_SPAN || spend > ANCHOR_BUDGET {
            return Vec::new();
        }
        self.anchored = spend;
        let mut seen: HashMap<&T, (u32, usize, u32, usize)> = HashMap::new();
        for i in a0..a1 {
            let entry = seen.entry(&self.a[i]).or_insert((0, i, 0, 0));
            entry.0 += 1;
            entry.1 = i;
        }
        for j in b0..b1 {
            if let Some(entry) = seen.get_mut(&self.b[j]) {
                entry.2 += 1;
                entry.3 = j;
            }
        }
        let mut unique: Vec<(usize, usize)> = seen
            .into_values()
            .filter(|(na, _, nb, _)| *na == 1 && *nb == 1)
            .map(|(_, i, _, j)| (i, j))
            .collect();
        unique.sort_unstable();
        longest_increasing(&unique)
    }

    /// Con il tetto di Myers già superato: prefisso, suffisso e ancore del
    /// tratto, e da capo fra un'ancora e l'altra, senza Myers. I tratti
    /// aspettano in una pila esplicita: le ancore si annidano quanto il
    /// documento è lungo, la pila del thread no.
    fn walk_anchored(&mut self, a0: usize, a1: usize, b0: usize, b1: usize) {
        let mut todo = vec![Step::Span(a0, a1, b0, b1)];
        while let Some(step) = todo.pop() {
            let (mut a0, mut a1, mut b0, mut b1) = match step {
                Step::Pair(x, y) => {
                    self.out.push((x, y));
                    continue;
                }
                Step::Suffix(a1, b1, n) => {
                    self.out.extend((0..n).map(|k| (a1 + k, b1 + k)));
                    continue;
                }
                Step::Span(a0, a1, b0, b1) => (a0, a1, b0, b1),
            };
            while a0 < a1 && b0 < b1 && self.a[a0] == self.b[b0] {
                self.out.push((a0, b0));
                a0 += 1;
                b0 += 1;
            }
            let mut suffix = 0;
            while a0 < a1 && b0 < b1 && self.a[a1 - 1] == self.b[b1 - 1] {
                a1 -= 1;
                b1 -= 1;
                suffix += 1;
            }
            // In ordine inverso: la pila restituisce prima l'ultimo entrato.
            todo.push(Step::Suffix(a1, b1, suffix));
            if a0 < a1 && b0 < b1 {
                let chain = self.anchors(a0, a1, b0, b1);
                if chain.is_empty() {
                    continue;
                }
                let mut next = (a1, b1);
                for &(x, y) in chain.iter().rev() {
                    todo.push(Step::Span(x + 1, next.0, y + 1, next.1));
                    todo.push(Step::Pair(x, y));
                    next = (x, y);
                }
                todo.push(Step::Span(a0, next.0, b0, next.1));
            }
        }
    }
}

/// La catena più lunga di coppie crescenti nel secondo indice, con le coppie
/// già in ordine nel primo (patience sorting, O(n log n)).
fn longest_increasing(pairs: &[(usize, usize)]) -> Vec<(usize, usize)> {
    // `tails[k]`: l'indice della coppia che chiude la catena più corta di
    // lunghezza k + 1; `back`: la coppia prima di ognuna nella sua catena.
    let mut tails: Vec<usize> = Vec::new();
    let mut back: Vec<Option<usize>> = vec![None; pairs.len()];
    for (at, &(_, y)) in pairs.iter().enumerate() {
        let k = tails.partition_point(|&t| pairs[t].1 < y);
        back[at] = k.checked_sub(1).map(|k| tails[k]);
        if k == tails.len() {
            tails.push(at);
        } else {
            tails[k] = at;
        }
    }
    let mut out = Vec::with_capacity(tails.len());
    let mut at = tails.last().copied();
    while let Some(i) = at {
        out.push(pairs[i]);
        at = back[i];
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La lunghezza della sottosequenza comune più lunga, con la tabella.
    fn lcs(a: &[u8], b: &[u8]) -> usize {
        let mut table = vec![vec![0usize; b.len() + 1]; a.len() + 1];
        for i in (0..a.len()).rev() {
            for j in (0..b.len()).rev() {
                table[i][j] = if a[i] == b[j] {
                    table[i + 1][j + 1] + 1
                } else {
                    table[i + 1][j].max(table[i][j + 1])
                };
            }
        }
        table[0][0]
    }

    fn valid(a: &[u8], b: &[u8], pairs: &[(usize, usize)]) {
        for window in pairs.windows(2) {
            assert!(window[0].0 < window[1].0 && window[0].1 < window[1].1);
        }
        for &(i, j) in pairs {
            assert_eq!(a[i], b[j]);
        }
    }

    #[test]
    fn la_sottosequenza_è_la_più_lunga() {
        let cases: &[(&[u8], &[u8])] = &[
            (b"", b""),
            (b"abc", b""),
            (b"", b"abc"),
            (b"abc", b"abc"),
            (b"abcabba", b"cbabac"),
            (b"il gatto nero", b"il cane nero"),
            (b"xaxbxcx", b"abc"),
            (b"aaaa", b"aa"),
            (b"abcdefgh", b"hgfedcba"),
        ];
        for (a, b) in cases {
            let pairs = common(a, b);
            valid(a, b, &pairs);
            assert_eq!(pairs.len(), lcs(a, b), "{:?} {:?}", a, b);
        }
    }

    /// Sequenze a caso, con un generatore lineare congruenziale: sempre
    /// valide e, sotto il tetto, sempre le più lunghe.
    #[test]
    fn a_caso_resta_valida_e_massima() {
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut next = |bound: u64| {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (seed >> 33) % bound
        };
        for _ in 0..300 {
            let (n, m) = (next(40) as usize, next(40) as usize);
            let alphabet = 1 + next(5);
            let a: Vec<u8> = (0..n).map(|_| next(alphabet) as u8).collect();
            let b: Vec<u8> = (0..m).map(|_| next(alphabet) as u8).collect();
            let pairs = common(&a, &b);
            valid(&a, &b, &pairs);
            assert_eq!(pairs.len(), lcs(&a, &b), "{a:?} {b:?}");
        }
    }

    /// Oltre il tetto le ancore tengono ciò che è unico, e il risultato resta
    /// una sottosequenza comune.
    #[test]
    fn oltre_il_tetto_valgono_le_ancore() {
        let mut work_a: Vec<u32> = (0..2000).collect();
        let mut work_b: Vec<u32> = (0..2000).rev().collect();
        work_a.push(9999);
        work_b.push(9999);
        let mut out = Vec::new();
        let mut work = Work {
            a: &work_a,
            b: &work_b,
            spent: BUDGET,
            anchored: 0,
            out: &mut out,
        };
        work.walk(0, work_a.len(), 0, work_b.len());
        assert!(out.contains(&(2000, 2000)));
        for window in out.windows(2) {
            assert!(window[0].0 < window[1].0 && window[0].1 < window[1].1);
        }
        for &(i, j) in &out {
            assert_eq!(work_a[i], work_b[j]);
        }
        assert!(!out.is_empty());
    }

    /// Due lati in cui ogni livello ha una sola ancora, e l'ancora del livello
    /// sotto compare due volte nel livello sopra: le ancore si trovano una
    /// alla volta, un livello dentro l'altro, `levels` volte.
    fn nested_anchors(levels: u32) -> (Vec<u32>, Vec<u32>) {
        let (mut a, mut b) = (Vec::new(), Vec::new());
        for k in (1..=levels).rev() {
            let (above, here) = (10 * (k - 1) + 4, 10 * k + 4);
            a.extend([10 * k, above, here]);
            b.extend([10 * k + 1, above, here]);
        }
        a.push(0);
        b.push(1);
        for k in 1..=levels {
            a.push(10 * k + 2);
            b.push(10 * k + 3);
        }
        (a, b)
    }

    /// Le ancore annidate non consumano la pila: prima una ricorsione per
    /// livello la esauriva, e il processo cadeva senza un errore.
    #[test]
    fn le_ancore_annidate_non_esauriscono_la_pila() {
        let levels = 2000;
        let (a, b) = nested_anchors(levels);
        let out = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || {
                let mut out = Vec::new();
                let mut work = Work {
                    a: &a,
                    b: &b,
                    spent: BUDGET,
                    anchored: 0,
                    out: &mut out,
                };
                work.walk(0, a.len(), 0, b.len());
                (a, b, out)
            })
            .unwrap()
            .join();
        let (a, b, out) = out.expect("l'allineamento non cade");
        for window in out.windows(2) {
            assert!(window[0].0 < window[1].0 && window[0].1 < window[1].1);
        }
        for &(i, j) in &out {
            assert_eq!(a[i], b[j]);
        }
        // Ogni livello dà la sua ancora e l'ancora di sopra.
        assert_eq!(out.len(), 2 * levels as usize);
    }

    /// Il lavoro delle ancore ha un tetto: oltre, un tratto resta senza
    /// coppie, che vuol dire «toccato», e il conto non cresce col quadrato.
    #[test]
    fn il_lavoro_delle_ancore_ha_un_tetto() {
        let (a, b) = nested_anchors(2000);
        let mut out = Vec::new();
        let mut work = Work {
            a: &a,
            b: &b,
            spent: BUDGET,
            anchored: ANCHOR_BUDGET - 10_000,
            out: &mut out,
        };
        work.walk(0, a.len(), 0, b.len());
        assert!(work.anchored <= ANCHOR_BUDGET + a.len() as u64 + b.len() as u64);
        assert!(out.len() < 2 * 2000);
        for &(i, j) in &out {
            assert_eq!(a[i], b[j]);
        }
    }

    /// I vettori di Myers sono grandi quanto il lavoro che il tetto permette,
    /// non quanto i due lati: due lati enormi e diversi non chiedono gigabyte.
    #[test]
    fn la_memoria_di_myers_segue_il_tetto() {
        assert!(reach(BUDGET, isize::MAX / 4) <= 8_001);
        assert_eq!(reach(BUDGET, 10), 10);
        assert_eq!(reach(0, 1_000_000), 0);
        // Niente in comune e troppo per le ancore: nessuna coppia, e i vettori
        // restano piccoli (senza tetto sarebbero 2 · 8 · 10⁷ byte).
        let n = 5_000_000u32;
        let a: Vec<u32> = (0..n).collect();
        let b: Vec<u32> = (n..2 * n).collect();
        assert!(common(&a, &b).is_empty());
    }

    #[test]
    fn la_catena_crescente_è_la_più_lunga() {
        let pairs = [(0, 3), (1, 1), (2, 2), (3, 0), (4, 4)];
        assert_eq!(longest_increasing(&pairs), vec![(1, 1), (2, 2), (4, 4)]);
        assert!(longest_increasing(&[]).is_empty());
    }

    #[test]
    fn un_documento_grande_con_poche_modifiche_resta_lineare() {
        let a: Vec<u32> = (0..200_000).collect();
        let mut b = a.clone();
        b[100_000] = 1_000_000;
        b.insert(150_000, 2_000_000);
        b.remove(50_000);
        let pairs = common(&a, &b);
        assert_eq!(pairs.len(), 200_000 - 2);
    }
}
