//! La griglia del nucleo (`arrange::grid`) contro la griglia di N6: le stesse
//! misure danno le stesse posizioni (T12a).
//!
//! La fonte è `apps/client/src/editors/canvas/drop-layout.ts` (`dropLayout`) e
//! il suo test `drop-layout.test.ts`, sul ramo `piano/n6-lavagna` (commit
//! `46aaf6f4c`). I numeri dei casi sono copiati da lì: ogni prova riporta, in
//! commento, il titolo del caso di N6 a cui corrisponde. Il punto di N6 si
//! aggancia con `layout::snap`, come fa `dropLayout`. Restano fuori i casi di
//! gruppo (oltre 12 schede), di tabella e di pagine sparse: non sono posizioni
//! della griglia.

use fub_canvas_core::layout::arrange::grid;
use fub_canvas_core::layout::snap;

/// `DROP_SNAP` e `DROP_GAP` di N6: il passo della tela e lo spazio di serie.
const DROP_SNAP: f64 = 8.0;
const DROP_GAP: f64 = 24.0;

/// Una scheda disposta: la posizione dalla griglia e la misura data.
#[derive(Clone, Copy, Debug)]
struct Card {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Dispone `sizes` con `grid` di serie (spazio 24), dall'origine `origin`.
fn place(sizes: &[(f64, f64)], origin: (f64, f64)) -> Vec<Card> {
    let at = grid(sizes, DROP_GAP, origin);
    sizes
        .iter()
        .zip(at)
        .map(|(&(width, height), (x, y))| Card {
            x,
            y,
            width,
            height,
        })
        .collect()
}

fn corners(cards: &[Card]) -> Vec<(f64, f64)> {
    cards.iter().map(|card| (card.x, card.y)).collect()
}

/// Ogni posizione è un punto fisso di `snap`: un multiplo di 8, come la tela.
fn assert_snapped(cards: &[Card]) {
    for card in cards {
        for value in [card.x, card.y] {
            assert_eq!(snap(value), value, "{value} non è sulla griglia di 8");
        }
    }
}

/// Ogni colonna (asse `x`) o riga (asse `y`) parte al primo multiplo di 8 che
/// lascia almeno 24 dopo il bordo più lontano della precedente (N6:
/// `expectFirstFit`). `along` dà la posizione e la misura lungo l'asse.
fn expect_first_fit(cards: &[Card], along: impl Fn(&Card) -> (f64, f64)) {
    let mut starts: Vec<f64> = cards.iter().map(|card| along(card).0).collect();
    starts.sort_by(f64::total_cmp);
    starts.dedup();
    for pair in starts.windows(2) {
        let (previous, next) = (pair[0], pair[1]);
        let previous_end = cards
            .iter()
            .filter(|card| along(card).0 == previous)
            .map(|card| along(card).0 + along(card).1)
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(
            next - previous_end >= DROP_GAP,
            "{next} sta a meno di 24 da {previous_end}"
        );
        assert!(
            next - DROP_SNAP - previous_end < DROP_GAP,
            "{next} non è il primo multiplo di 8 dopo {previous_end}"
        );
    }
}

/// «dispone in ceil(sqrt(n)) colonne, per righe, con 24 px fra le schede»:
/// cinque file da 320×160, tre colonne e due righe.
#[test]
fn cinque_schede_in_tre_colonne_per_righe() {
    let cards = place(&[(320.0, 160.0); 5], (0.0, 0.0));
    assert_eq!(
        corners(&cards),
        vec![
            (0.0, 0.0),
            (344.0, 0.0),
            (688.0, 0.0),
            (0.0, 184.0),
            (344.0, 184.0),
        ]
    );
}

/// «fa ogni colonna larga quanto la sua scheda più larga e ogni riga alta
/// quanto la più alta»: colonne 480 e 360, righe 304 e 480.
#[test]
fn ogni_colonna_e_ogni_riga_alla_misura_della_piu_grande() {
    let cards = place(
        &[
            (480.0, 304.0),
            (320.0, 120.0),
            (320.0, 240.0),
            (360.0, 480.0),
        ],
        (0.0, 0.0),
    );
    assert_eq!(
        corners(&cards),
        vec![(0.0, 0.0), (504.0, 0.0), (0.0, 328.0), (504.0, 328.0)]
    );
}

/// «un foglio alto 300 mette la riga sotto 328 px più in basso, con 28 px di
/// spazio»: 324 non è un multiplo di 8, la riga parte a 328.
#[test]
fn un_foglio_alto_300_mette_la_riga_a_328() {
    let cards = place(&[(480.0, 300.0); 3], (0.0, 0.0));
    assert_eq!(
        corners(&cards),
        vec![(0.0, 0.0), (504.0, 0.0), (0.0, 328.0)]
    );
    assert_eq!(cards[2].y - (cards[0].y + cards[0].height), 28.0);
}

/// «dispone elementi con le misure di nascita delle loro specie»: un'immagine
/// 4000×1000 nasce 480×120 (`bornSize`), un foglio 480×300.
#[test]
fn dispone_con_le_misure_di_nascita() {
    let cards = place(&[(480.0, 120.0), (480.0, 300.0)], (0.0, 0.0));
    assert_eq!(corners(&cards), vec![(0.0, 0.0), (504.0, 0.0)]);
    assert_eq!((cards[0].width, cards[0].height), (480.0, 120.0));
}

/// «con 47 elementi di misure diverse le posizioni sono multipli di 8, e ogni
/// spazio è il primo che lascia 24 px»: note, foglio, immagine 16:9 (480×270)
/// e PDF A4 (360×509), a turno, dal punto 13,5 e 20,7 agganciato a 16 e 24.
/// N6 ordina per nome, e con i numeri in ordine di valore il nome dei suoi
/// `m0.bin`…`m46.bin` è l'ordine d'indice: qui si danno nell'ordine dato.
#[test]
fn quarantasette_schede_di_misure_diverse() {
    let kinds = [
        (320.0, 240.0),
        (480.0, 300.0),
        (480.0, 270.0),
        (360.0, 509.0),
    ];
    let sizes: Vec<(f64, f64)> = (0..47).map(|index| kinds[index % kinds.len()]).collect();
    let origin = (snap(13.5), snap(20.7));
    let cards = place(&sizes, origin);
    assert_eq!(cards.len(), 47);
    assert_eq!((cards[0].x, cards[0].y), (16.0, 24.0));
    assert_snapped(&cards);
    expect_first_fit(&cards, |card| (card.x, card.width));
    expect_first_fit(&cards, |card| (card.y, card.height));
}

/// «aggancia il punto a 8 px e lascia le misure intere»: il punto 13, 21 va a
/// 16, 24, e la colonna dopo la scheda da 321 parte a 368 (361 non è un
/// multiplo di 8).
#[test]
fn aggancia_il_punto_e_lascia_le_misure_intere() {
    let cards = place(&[(321.0, 243.0), (100.0, 100.0)], (snap(13.0), snap(21.0)));
    assert_eq!(
        cards
            .iter()
            .map(|card| (card.x, card.y, card.width, card.height))
            .collect::<Vec<_>>(),
        vec![(16.0, 24.0, 321.0, 243.0), (368.0, 24.0, 100.0, 100.0)]
    );
    assert_snapped(&cards);
}

/// «la colonna dopo un punto negativo parte a 0, non a zero negativo»: da -72
/// con 42 di larghezza si arriva a -30, più 24 fa -6, e il primo multiplo di 8
/// da lì è 0 (con `Math.ceil` in JavaScript verrebbe -0).
#[test]
fn la_colonna_dopo_un_punto_negativo_parte_a_zero_positivo() {
    let cards = place(&[(42.0, 100.0), (100.0, 100.0)], (snap(-72.0), 0.0));
    assert_eq!(cards[0].x, -72.0);
    assert_eq!(cards[1].x, 0.0);
    assert!(cards[1].x.is_sign_positive(), "lo zero dev'essere positivo");
}

/// «non sovrappone mai due schede»: sette schede di misure diverse, dall'origine
/// 8,8. Ogni coppia è separata di almeno 24 su un asse.
#[test]
fn non_sovrappone_mai_due_schede() {
    let sizes = [
        (480.0, 300.0),
        (320.0, 120.0),
        (120.0, 480.0),
        (360.0, 512.0),
        (320.0, 160.0),
        (480.0, 40.0),
        (40.0, 40.0),
    ];
    let cards = place(&sizes, (8.0, 8.0));
    for (i, a) in cards.iter().enumerate() {
        for (j, b) in cards.iter().enumerate() {
            if i == j {
                continue;
            }
            let apart = a.x + a.width + DROP_GAP <= b.x
                || b.x + b.width + DROP_GAP <= a.x
                || a.y + a.height + DROP_GAP <= b.y
                || b.y + b.height + DROP_GAP <= a.y;
            assert!(apart, "le schede {i} e {j} si toccano");
        }
    }
}

/// «dispone 500 elementi in 23 colonne, dentro il gruppo, agganciati»: senza
/// il gruppo, il conto di colonne e di righe e l'aggancio.
#[test]
fn cinquecento_schede_in_ventitre_colonne_agganciate() {
    let cards = place(&[(320.0, 160.0); 500], (0.0, 0.0));
    let mut columns: Vec<f64> = cards.iter().map(|card| card.x).collect();
    columns.sort_by(f64::total_cmp);
    columns.dedup();
    let mut rows: Vec<f64> = cards.iter().map(|card| card.y).collect();
    rows.sort_by(f64::total_cmp);
    rows.dedup();
    assert_eq!(columns.len(), 23);
    assert_eq!(rows.len(), 22);
    assert_snapped(&cards);
    expect_first_fit(&cards, |card| (card.x, card.width));
    expect_first_fit(&cards, |card| (card.y, card.height));
}
