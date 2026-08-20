//! **La seconda sorgente di tempo** (§22.4, decisione 0091): il tempo di
//! *parete*, accanto a quello *trascorso* che lo scheduler aveva già.
//!
//! # Perché sono due e non si possono mescolare
//!
//! Lo scheduler delle sveglie ([`crate::runner`]) è costruito su un
//! [`Instant`](std::time::Instant), e lo dice di sé: è la ragione per cui «ogni
//! ora» vuol dire un'ora anche se qualcuno sposta l'orologio della macchina.
//! Quella proprietà è **il motivo per cui `every` e `after` sono giusti**, e
//! sarebbe da buttare via se un orario di parete si fosse fatto passare per un
//! intervallo.
//!
//! Un `Instant` non ha un calendario: non sa cosa sia un lunedì, e non può
//! saperlo, perché non è ancorato a niente che si possa datare. Un
//! [`SystemTime`](std::time::SystemTime) ha un calendario e salta quando
//! l'utente sposta l'orologio. Le due sorgenti quindi convivono e **reggono cose
//! diverse**:
//!
//! - il tempo **trascorso** (`Instant`) regge `every` e `after`, e regge anche
//!   *l'attesa* di tutti — perché aspettare è sempre «per quanto», mai «fino a
//!   quando»;
//! - il tempo **di parete** (`SystemTime`, letto attraverso un fuso) regge
//!   *quando* accade un'occorrenza di `at-wall-clock`.
//!
//! Il punto in cui si toccano è uno solo, ed è questo modulo: si chiede al
//! calendario *fra quanti secondi* accade un'ora civile, e da lì in poi si torna
//! ad aspettare con l'orologio monotono. Un orologio spostato all'indietro
//! allunga o accorcia una singola attesa e poi si ricalcola: nessuna sveglia si
//! perde e nessuna si sdoppia, perché a decidere se una ha già suonato non è
//! l'orologio ma la sua **data civile**.
//!
//! # Il database dei fusi
//!
//! Sta qui e **solo** qui. `fub-abi` non ha e non deve avere una dipendenza di
//! date: la regola del contratto ([`WallClock::next_after`]) è aritmetica su ore
//! civili, e le ore civili non hanno bisogno di sapere cosa sia l'ora legale.
//! Cosa sia l'ora legale serve in due conversioni sole — istante → ora civile e

use std::time::Duration;

use fub_abi::traits::{CivilTime, WallClock};
use jiff::civil;
use jiff::tz::TimeZone;
use jiff::Timestamp;

/// Il calendario di un fuso: la sola cosa che sta fra un `Instant` e un lunedì.
///
/// Si costruisce una volta per sveglia e per giro. Costruirlo non è gratis — un
/// nome IANA si risolve leggendo il database — ma il giro in cui succede è
/// quello in cui il pool stava per addormentarsi, cioè lo stesso in cui la
/// [0069](../../../docs/decisions/0069-cosa-sa-dire-un-abbonamento.md) ha già
/// deciso di poter leggere un orologio.
pub(crate) struct Zone(TimeZone);

impl Zone {
    /// Il fuso di una sveglia: quello che dichiara, o quello della macchina.
    ///
    /// `machine` è il nome IANA che il locale risolve — cioè
    /// [`locale.timezone`](fub_kernel::locale::TIMEZONE), che vale «quello del
    /// sistema» quando è vuoto. Vuoto qui vuol dire che nemmeno il sistema lo
    /// sa, e allora si prende quello del sistema per la via di `jiff`.
    ///
    /// `None` = **il nome non si risolve**, e chi chiama non fa suonare la
    /// sveglia. È deliberato e non è un ripiego mancato: cadere su UTC vorrebbe
    /// dire onorare la dichiarazione con un'altra sveglia, all'ora sbagliata,
    /// senza che nessuno se ne accorga — la specie di bugia che la
    /// [0077](../../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md)
    /// rifiuta nel registro dei comandi.
    pub(crate) fn of(timer: &WallClock, machine: &str) -> Option<Self> {
        match timer.zone.as_deref().unwrap_or(machine) {
            "" => Some(Zone(TimeZone::system())),
            name => TimeZone::get(name).ok().map(Zone),
        }
    }

    /// Che ora civile è adesso, qui.
    pub(crate) fn now(&self, time: Timestamp) -> CivilTime {
        let z = time.to_zoned(self.0.clone());
        CivilTime {
            year: i32::from(z.year()),
            month: z.month() as u8,
            day: z.day() as u8,
            hour: z.hour() as u8,
            minute: z.minute() as u8,
            second: z.second() as u8,
        }
    }

    /// L'istante in cui accade un'ora civile, qui.
    ///
    /// **Le due ore storte dell'ora legale si decidono in questa riga.**
    /// `compatible` è la disambiguazione di RFC 5545, cioè quella di ogni
    /// calendario: un'ora che non esiste si sposta in avanti della durata del
    /// salto (le 2:30 diventano le 3:30, e la sveglia non perde il giorno);
    /// un'ora che esiste due volte prende la prima. Che la seconda non suoni una
    /// seconda volta non dipende da qui — dipende dall'invariante di chi chiama,
    /// che tiene l'ultima occorrenza *civile* onorata.
    pub(crate) fn instant(&self, when: CivilTime) -> Option<Timestamp> {
        let dt = civil::datetime(
            i16::try_from(when.year).ok()?,
            i8::try_from(when.month).ok()?,
            i8::try_from(when.day).ok()?,
            i8::try_from(when.hour).ok()?,
            i8::try_from(when.minute).ok()?,
            i8::try_from(when.second).ok()?,
            0,
        );
        self.0
            .to_ambiguous_zoned(dt)
            .compatible()
            .ok()
            .map(|z| z.timestamp())
    }
}

/// Dove sta una sveglia di parete: le due occorrenze che la descrivono.
///
/// Sono due campi e non uno perché rispondono a due domande che si somigliano e
/// non coincidono — *cosa ho già considerato* e *cosa sto aspettando* — e
/// confonderle è precisamente il difetto in cui questa implementazione è caduta
/// alla prima stesura: con la sola [`last`](Self::ultima) una sveglia
/// puntuale con `catch_up_seconds = 0` non suonava **mai**, perché ogni suonata
/// sarebbe stata un recupero e la finestra era zero.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Position {
    /// L'ultima occorrenza *civile* considerata: onorata, oppure **consumata
    /// senza suonare** perché fuori dalla finestra.
    ///
    /// Consumata senza suonare è la metà che conta. Senza di lei un'occorrenza
    /// saltata resterebbe la «prossima passata» per sempre e ogni giro la
    /// riesaminerebbe; con lei si guarda una volta e si passa oltre, che è anche
    /// il modo in cui una macchina riaccesa dopo due giorni suona zero volte
    pub(crate) last: Option<CivilTime>,
    /// invece di due.
    /// L'occorrenza per cui si sta aspettando. Quando arriva si suona **senza
    /// consultare la finestra**: la finestra dice fino a quanto tardi ha senso
    /// recuperare ciò che nessuno aspettava, non se onorare ciò che era in
    pub(crate) wait_for: Option<CivilTime>,
}

/// Cosa fa una sveglia di parete **adesso**.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Verdict {
    /// Suona adesso?
    pub(crate) ring: bool,
    /// Dov'è arrivata, da riscrivere nel quadrante.
    pub(crate) position: Position,
    /// Fra quanto la prossima. `None` = nessuna occorrenza futura, cioè una
    /// sveglia che non suonerà più (orario fuori scala, o elenco di giorni
    /// impossibile).
    pub(crate) between: Option<Duration>,
}

/// Applica la regola del contratto a un istante concreto.
///
/// La divisione del lavoro è quella della decisione: il contratto dice **quali**
/// occorrenze esistono ([`WallClock::next_after`] e
/// [`WallClock::latest_upto`]), questa funzione dice **quando** accadono e cosa
/// farne. Non legge l'orologio — lo riceve — ed è ciò che la rende provabile
/// senza aspettare le nove.
pub(crate) fn verdict(
    timer: &WallClock,
    zone: &Zone,
    time: Timestamp,
    position: Position,
) -> Verdict {
    let civil = zone.now(time);
    let mut outcome = Verdict {
        ring: false,
        position,
        between: None,
    };

    if let Some(pass) = timer.latest_upto(civil) {
        // `is_none_or`: al primo giro non c'è niente di già considerato, e
        // l'occorrenza di stamattina non è «persa» — è successa prima che questa
        // sveglia esistesse per lo scheduler. Farla suonare all'avvio dell'app
        // per il solo fatto che sono le dieci e lei era delle nove sarebbe un
        // recupero di qualcosa che nessuno aveva mancato.
        if position.last.is_none_or(|u| pass > u) {
            outcome.position.last = Some(pass);
            // Due modi di meritare una suonata, e il primo non passa dalla
            // finestra: era l'occorrenza in calendario.
            let wait_for = position.wait_for == Some(pass);
            let recovery = position.last.is_some()
                && timer.catch_up_seconds > 0
                && zone.instant(pass).is_some_and(|q| {
                    let delay = time.as_second() - q.as_second();
                    delay >= 0 && delay as u64 <= timer.catch_up_seconds
                });
            outcome.ring = wait_for || recovery;
        }
    }

    // Quando torna a suonare. Si riscrive a ogni giro e non si tiene: la
    // prossima di un orario di parete non è una funzione di quante volte ha
    // suonato, è una funzione di che giorno è.
    let next = timer.next_after(civil);
    outcome.position.wait_for = next;
    outcome.between = next
        .and_then(|p| zone.instant(p))
        .map(|q| Duration::from_secs((q.as_second() - time.as_second()).max(0) as u64));
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::locale::Weekday;

    fn ts(s: &str) -> Timestamp {
        s.parse().expect("timestamp")
    }

    /// **Un nome che il database non conosce non fa suonare la sveglia**, e non
    /// ripiega su UTC: è la riga che tiene la dichiarazione onesta.
    /// ripiega su UTC: è la riga che tiene la dichiarazione onesta.
    #[test]
    fn unknown_zone_does_not_fall_through_to_utc() {
        assert!(Zone::of(&WallClock::daily(9, 0).anchored("Europa/Roma"), "").is_none());
        assert!(Zone::of(&WallClock::daily(9, 0), "Mars/Olympus").is_none());
    }

    /// La sveglia dichiara il proprio fuso: **vince su quello della macchina**.
    /// È la metà che rende dicibile «le 9 dell'ufficio di Roma» a chi legge da
    /// Tokyo.
    #[test]
    fn declared_zone_wins_over_machine() {
        let timer = WallClock::daily(9, 0).anchored("Europe/Rome");
        let zone = Zone::of(&timer, "Asia/Tokyo").expect("zone");
        // Le 9 di Roma del 15 gennaio sono le 08:00 UTC.
        let v = verdict(
            &timer,
            &zone,
            ts("2026-01-15T00:00:00Z"),
            Position::default(),
        );
        assert_eq!(v.between, Some(Duration::from_secs(8 * 3600)));
    }

    /// Senza dichiarazione si usa quello della macchina, e sono ore diverse.
    #[test]
    fn without_declaration_uses_machine() {
        let timer = WallClock::daily(9, 0);
        let zone = Zone::of(&timer, "Asia/Tokyo").expect("zone");
        // Le 9 di Tokyo del 15 gennaio sono le 00:00 UTC.
        let v = verdict(
            &timer,
            &zone,
            ts("2026-01-14T23:00:00Z"),
            Position::default(),
        );
        assert_eq!(v.between, Some(Duration::from_secs(3600)));
    }

    /// **Il giorno in cui l'ora legale entra, le 2:30 non esistono.** La sveglia
    /// non salta il giorno: si sposta in avanti della durata del salto.
    ///
    /// In Italia il cambio è l'ultima domenica di marzo — nel 2026 il 29 — alle
    /// 2:00, e le 2:30 diventano le 3:30, cioè le 01:30 UTC.
    #[test]
    fn nonexistent_time_shifts_forward() {
        let timer = WallClock::daily(2, 30).anchored("Europe/Rome");
        let zone = Zone::of(&timer, "").expect("zone");
        let v = verdict(
            &timer,
            &zone,
            ts("2026-03-29T00:00:00Z"),
            Position::default(),
        );
        let between = v.between.expect("a next exists");
        assert_eq!(
            between,
            Duration::from_secs(90 * 60),
            "2:30 that does not exist must become 3:30, not disappear"
        );
    }

    /// **Il giorno in cui l'ora legale esce, le 2:30 esistono due volte, e la
    /// sveglia suona una volta.** Non è un campo: è l'invariante «un'occorrenza
    /// è la sua data civile», e si vede qui — dopo la prima delle due 2:30
    /// l'occorrenza risulta consumata, e la seconda non ne produce un'altra.
    ///
    /// Nel 2026 l'uscita è il 25 ottobre alle 3:00: le 2:30 accadono alle 00:30
    /// UTC e di nuovo alle 01:30 UTC.
    /// UTC e di nuovo alle 01:30 UTC.
    #[test]
    fn duplicate_time_rings_once() {
        let timer = WallClock::daily(2, 30)
            .anchored("Europe/Rome")
            .catching_up(3600);
        let zone = Zone::of(&timer, "").expect("zone");

        // Prima delle due: l'occorrenza si consuma.
        let first = verdict(
            &timer,
            &zone,
            ts("2026-10-25T00:31:00Z"),
            Position::default(),
        );
        let consumed = first.position.last.expect("consumed");
        assert_eq!((consumed.day, consumed.hour), (25, 2));

        // Un'ora dopo le 2:30 accadono di nuovo, ed è la **stessa data civile**:
        // niente da onorare, e la prossima è quella di domani.
        let second = verdict(&timer, &zone, ts("2026-10-25T01:31:00Z"), first.position);
        assert!(
            !second.ring,
            "the second time 2:30 happens is the same occurrence"
        );
        assert_eq!(second.position.last, first.position.last);
    }

    /// **Il recupero suona dentro la finestra e tace fuori**, ed è la stessa
    /// riga che risponde alla macchina che ha dormito due giorni.
    #[test]
    fn catch_up_has_a_window() {
        let tight = WallClock::daily(9, 0).anchored("Europe/Rome");
        let larga = WallClock::daily(9, 0)
            .anchored("Europe/Rome")
            .catching_up(3600);
        let zone = Zone::of(&larga, "").expect("zone");

        // Il giro prima ha visto le 9 di ieri, e aspettava quelle di **oggi**:
        // il recupero riguarda ciò che non era in calendario, quindi l'attesa si
        // mette altrove apposta.
        let to_the_nine = |day| CivilTime {
            year: 2026,
            month: 1,
            day: day,
            hour: 9,
            minute: 0,
            second: 0,
        };
        // `attesa: None` è il caso vero del recupero: la macchina dormiva, o
        // l'app è ripartita, e nessuno stava aspettando niente. Un'occorrenza
        // che era in calendario suona per la sua strada, senza finestra.
        let yesterday = Position {
            last: Some(to_the_nine(14)),
            wait_for: None,
        };

        // Venti minuti di ritardo, finestra di un'ora: suona.
        let v = verdict(&larga, &zone, ts("2026-01-15T08:20:00Z"), yesterday);
        assert!(v.ring, "twenty minutes inside a one-hour window");

        // Stesso ritardo, nessuna finestra: tace.
        let v = verdict(&tight, &zone, ts("2026-01-15T08:20:00Z"), yesterday);
        assert!(!v.ring, "without a window nothing is caught up");

        // **Due giorni di macchina spenta, e il risveglio prima delle nove.**
        // Le due occorrenze perse cadono fuori dalla finestra: zero suonate, non
        // due. La più recente si consuma lo stesso — è il campo `last` a
        // impedire che la si riesamini per sempre — e la prossima è quella di
        let v = verdict(&larga, &zone, ts("2026-01-17T05:00:00Z"), yesterday);
        assert!(!v.ring, "twenty hours are outside a one-hour window");
        let consumed = v.position.last.expect("consumed");
        assert_eq!(
            (consumed.day, consumed.hour),
            (16, 9),
            "the skipped occurrence is consumed anyway, or it would be re-examined forever"
        );
        assert_eq!(
            v.position.wait_for.map(|a| a.day),
            Some(17),
            "and we return to waiting for today's"
        );
    }

    /// **Al primo giro non si recupera niente.** Una sveglia appena registrata
    /// non ha perso l'occorrenza di stamattina: non esisteva.
    #[test]
    fn first_tick_does_not_catch_up() {
        let timer = WallClock::daily(9, 0)
            .anchored("Europe/Rome")
            .catching_up(86_400);
        let zone = Zone::of(&timer, "").expect("zone");
        let v = verdict(
            &timer,
            &zone,
            ts("2026-01-15T08:20:00Z"),
            Position::default(),
        );
        assert!(!v.ring, "the app just started, it missed nothing");
        assert!(v.position.last.is_some(), "but the occurrence is consumed");
    }

    /// I giorni della settimana: `days` vuoto è ogni giorno, e un elenco salta.
    #[test]
    fn declared_weekdays_are_skipped() {
        // Il 15 gennaio 2026 è un giovedì.
        let monday = WallClock::daily(9, 0)
            .anchored("Europe/Rome")
            .on([Weekday::Monday]);
        let zone = Zone::of(&monday, "").expect("zone");
        let v = verdict(
            &monday,
            &zone,
            ts("2026-01-15T00:00:00Z"),
            Position::default(),
        );
        // Dal giovedì al lunedì: quattro giorni, più le nove del mattino.
        assert_eq!(v.between, Some(Duration::from_secs(4 * 86_400 + 8 * 3600)));
    }

    /// Un orario fuori scala non suona, e non fa fallire niente.
    #[test]
    fn impossible_schedule_does_not_ring() {
        let crooked = WallClock::daily(25, 0).anchored("Europe/Rome");
        let zone = Zone::of(&crooked, "").expect("zone");
        let v = verdict(
            &crooked,
            &zone,
            ts("2026-01-15T00:00:00Z"),
            Position::default(),
        );
        assert_eq!(v.between, None);
        assert!(!v.ring);
        assert_eq!(v.position.last, None);
    }
}
