// Le view sono un sottoinsieme dell'inventario, e questo banco ha senso se ce
// n'è almeno una: il conto in coda — «zero implementazioni non è una suite» —
// resta la sua ragione d'essere, e senza questo `cfg` diventerebbe rosso in una
// build che non ha nessun pannello, che è una build legittima (§16.3).
#![cfg(any(
    feature = "backlinks",
    feature = "outline",
    feature = "tags",
    feature = "stats"
))]
//! Le feature ufficiali passano la **suite di conformità** dell'SDK.
//!
//! È il primo cliente vero di `fub_sdk::testing::conformance` ([decisione
//! 0054](../../../docs/decisions/0054-il-banco-del-lato-provider.md)), e serve a
//! due cose che non sono la stessa.
//!
//! La prima è ovvia: le view ufficiali rispettano il contratto che dichiarano.
//!
//! La seconda no, ed è la ragione per cui questo file sta qui invece che fra i
//! test del kernel: **le feature ufficiali sono il dogfooding del contratto**, e
//! una suite di conformità che nessuna implementazione vera passa non è una
//! suite, è un'opinione. Se una di queste asserzioni è troppo stretta, lo si
//! scopre qui — su codice che il progetto controlla — invece che addosso al
//! primo plugin di terzi, che non ha modo di distinguere «ho sbagliato io» da
//! «la suite pretende troppo».
//!
//! # Su quali view, e come lo sa
//!
//! Le quattro view erano elencate a mano qui dentro, come in
//! `view_refresh_masks.rs`: una suite di conformità che copre le implementazioni
//! che qualcuno si è ricordato di scriverci dentro è esattamente il difetto che
//! il
//! [§16.7](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
//! accusa — e qui morde due volte, perché una view non provata non è solo una
//! view non presidiata: è **un dogfooding in meno**, cioè una prova in meno che
//! le asserzioni della suite siano giuste.
//!
//! Adesso l'elenco viene da [`fub_features::ogni_view_ufficiale`], che è la
//! stessa fetta da cui `fub_host::mount` registra i pannelli. Una view che
//! esiste nell'app passa di qui; una che non passa di qui non esiste nell'app, e
//! `fub-host/tests/le_view_ufficiali.rs` è ciò che tiene vera la seconda metà.
//!
//! # E su quali superfici, che non è la stessa domanda
//!
//! La riparazione qui sopra ha reso l'elenco esaustivo sulle **view**. Ma la
//! garanzia che questo file dice di provare non è universale sulle view: è
//! universale sulle **superfici**, perché è lì che un plugin di terzi si
//! attacca. Sette view su quattro superfici delle dieci che il contratto nomina
//! sono un dogfooding che copre meno di metà di ciò di cui parla — e il conto
//! non l'aveva fatto nessuno, perché il nome del banco l'aveva già fatto al
//! posto suo.
//!
//! `il_dogfooding_dichiara_fin_dove_arriva` lo scrive: per ogni superficie, o
//! una feature ufficiale ci sta, o c'è la ragione per cui non ci sta. È la forma
//! della [§23.2](../../../docs/roadmap/23-cosa-costano-le-decisioni-chiuse.md):
//! l'invariante resta vero dove è provato, e dove non lo è si legge invece di
//! scoprirsi.

use fub_abi::traits::{ViewProvider, ViewSurface};
use fub_sdk::testing::{conformance, MemoryHost};

/// Ogni view ufficiale, costruita quando tocca a lei: la conformità è una
/// proprietà del singolo provider, e un `Vec` preparato prima terrebbe in vita
/// tutti i pannelli mentre se ne prova uno.
///
/// Il conto in coda non è una cerimonia: una suite che gira su zero
/// implementazioni non è una suite, è un test che passa — ed è lo stato in cui
/// questo file finirebbe se un giorno l'inventario cambiasse forma sotto di lui.
fn for_every_view(mut test: impl FnMut(&dyn ViewProvider)) {
    let mut seen = 0;
    for f in fub_features::every_official_view() {
        test((f.view.expect("è una riga con view"))().as_ref());
        seen += 1;
    }
    assert!(seen > 0, "l'inventario non ha nessuna view");
}

#[test]
fn the_view_official_respect_the_contract() {
    let host = MemoryHost::new();

    for_every_view(|provider| {
        conformance::a_view_respects_the_contract(provider, &host);
    });
}

/// Fin dove arriva il dogfooding, superficie per superficie.
///
/// Il `//!` di questo file dice che una view non provata è **un dogfooding in
/// meno**, cioè una prova in meno che le asserzioni della suite siano giuste. Lo
/// diceva contando le view, che sono la cosa che si vede; ma l'invariante — *una
/// feature ufficiale è ciò che scriverà un plugin di terzi* — non è universale
/// sulle view, è universale sulle **superfici**: è lì che un terzo si attacca, e
/// una superficie che nessuna feature ufficiale esercita è una superficie su cui
/// l'invariante non è stato provato da nessuno.
///
/// Il conto non tornava, e nessuno l'aveva fatto: sette view ufficiali stanno su
/// quattro superfici delle dieci che il contratto nomina. Le altre sei non sono
/// una dimenticanza, e questo enum è il posto in cui si dice quale delle due
/// cose sono.
enum Coverage {
    /// Una feature ufficiale sta qui: su questa superficie l'invariante è
    /// provato su codice che il progetto controlla, come promette il `//!`.
    Dogfooding,
    /// Nessuna feature ufficiale ci sta, e la ragione è scritta. Non vuol dire
    /// «vietata a un terzo»: vuol dire che se un terzo ci arriva per primo, ci
    /// arriva **senza** che nessuno abbia provato la strada prima di lui.
    Uncovered(&'static str),
}

/// Il `match` è esaustivo apposta: una superficie nuova nel contratto non
/// compila finché qualcuno non dice a quale dei due casi appartiene. È la
/// differenza fra un elenco per costruzione e uno a memoria (§16.7), e la
/// seconda forma qui aveva già mentito una volta.
fn coverage(surface: ViewSurface) -> Coverage {
    match surface {
        ViewSurface::LeftSidebar => Coverage::Dogfooding,
        ViewSurface::RightSidebar => Coverage::Dogfooding,
        ViewSurface::Main => Coverage::Dogfooding,
        ViewSurface::StatusBar => Coverage::Dogfooding,
        ViewSurface::Bottom => Coverage::Uncovered(
            "la shell la ospita, ma nessuna feature ufficiale ci sta: la \
             console dei job e i risultati di ricerca in fondo sono voci di \
             piano, non codice",
        ),
        ViewSurface::Modal => Coverage::Uncovered(
            "la shell la ospita e nessuna feature ufficiale ci sta: le nostre \
             finestre che chiedono qualcosa sono pannelli della shell, non view \
             dichiarate",
        ),
        ViewSurface::Ribbon => Coverage::Uncovered(
            "la shell la ospita e nessuna feature ufficiale ci sta: i pulsanti \
             che apriamo noi sono cablati nella shell",
        ),
        ViewSurface::SettingsTab => Coverage::Uncovered(
            "la shell la ospita dalla 0036 e nessuna feature ufficiale la usa: \
             le impostazioni del core passano dallo schema del manifest, che è \
             un'altra strada",
        ),
        ViewSurface::Menu => Coverage::Uncovered(
            "la shell la ospita e nessuna feature ufficiale ci sta: i menu \
             che apriamo noi sono cablati nella shell",
        ),
        ViewSurface::ContextMenu => Coverage::Uncovered(
            "questa shell non ha un menu contestuale estendibile (`NON_OSPITATE`)",
        ),
    }
}

/// **Una superficie che il dogfooding esercita non può essere dichiarata
/// scoperta**, e il numero di quelle scoperte sta scritto in un posto solo.
///
/// Le due direzioni non si equivalgono. La prima si può pretendere sempre: se
/// una view ufficiale dichiara una superficie, quella superficie è provata, e
/// una dichiarazione che dicesse il contrario è vecchia. La seconda — «una
/// dichiarata coperta è davvero esercitata» — dipende dalle feature accese in
/// questa build, e pretenderla renderebbe rossa una build legittima (§16.3);
/// per quella basta il `match` esaustivo, che non compila se la superficie è
/// nuova.
#[test]
fn the_dogfooding_declares_fin_where_arrives() {
    let exercised: Vec<ViewSurface> = fub_features::every_official_view()
        .flat_map(|f| (f.view.expect("è una riga con view"))().views())
        .map(|spec| spec.surface)
        .collect();

    assert!(
        !exercised.is_empty(),
        "nessuna view ufficiale declare una superficie: un presidio che itera \
         zero elementi passa sempre"
    );

    for surface in exercised {
        if let Coverage::Uncovered(why) = coverage(surface) {
            panic!(
                "una feature ufficiale sta su `{surface:?}`, che è dichiarata \
                 scoperta ({why}). È una buona notizia scritta nel posto \
                 sbagliato: sposta la superficie fra le `Dogfooding` e \
                 aggiorna il conto qui sotto."
            );
        }
    }

    let scoperte = ViewSurface::ALL
        .iter()
        .filter(|&&s| matches!(coverage(s), Coverage::Uncovered(_)))
        .count();
    assert_eq!(
        scoperte, 6,
        "sei superfici su dieci non hanno nessun dogfooding, ed è il conto che \
         la §23.2 ha misurato. Se cambia in meglio si aggiorna qui, e non è una \
         cerimonia: è l'unico posto del repo in cui quel numero è scritto una \
         volta sola invece che dedotto — dedurlo è ciò che aveva prodotto il \
         «sette superfici su otto» del banco della shell, che erano dieci."
    );
}

#[test]
fn the_view_official_is_draw__also__with__a_document_open() {
    // A host vuoto ogni view cade nel proprio segnaposto, che è il ramo più
    // corto: la conformità va provata anche sul ramo che disegna qualcosa.
    let host = MemoryHost::new()
        .with_document("nota.md", "# Titolo\n\nun corpo con #tag e [[Altra]].\n")
        .with_backlink("nota.md", &["Altra.md"])
        .with_tags(&[("tag", 1)]);
    host.set_active(Some("nota.md"));

    for_every_view(|provider| {
        conformance::a_view_respects_the_contract(provider, &host);
    });
}
