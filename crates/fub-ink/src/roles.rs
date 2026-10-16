//! Che cosa fa un puntatore che si appoggia sulla superficie: disegna, muove la
//! vista o niente. La decisione è pura e sta qui; il ciclo di vita del tratto
//! la applica a ogni appoggio e la rivede quando arriva una penna, e gli
//! strumenti e la camera leggono lo stesso esito invece di ripeterlo.
//!
//! La politica, pensata per chi scrive con la mano appoggiata:
//!
//! - la punta della penna disegna; il tasto laterale e la gomma restano agli
//!   strumenti, che ne decideranno l'uso;
//! - il mouse disegna con il tasto principale e muove la vista con quello
//!   centrale;
//! - un dito non disegna mai mentre una penna tocca lo schermo o è sospesa
//!   sopra la superficie: è il palmo. Quando la penna arriva, le dita già giù
//!   diventano palmo anche loro e un loro tratto si annulla;
//! - con un secondo dito giù il gesto è di navigazione (pizzico, due dita), e
//!   un tratto del primo dito si annulla;
//! - altrimenti decide la politica del tocco: `Ink` disegna sempre, `Navigate`
//!   muove sempre la vista, `Auto` (il default) disegna finché su questa
//!   superficie non si è vista una penna e poi muove la vista, come fanno le
//!   buone app per tablet. Chi non ha una penna disegna col dito; chi ce l'ha
//!   scrive con quella e sposta il foglio con le dita.

use crate::pointer::PointerKind;

/// Il ruolo di un puntatore appoggiato.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PointerRole {
    Ink,
    Navigate,
    Ignore,
}

impl PointerRole {
    /// Il nome del ruolo, lo stesso che usa il lato TypeScript.
    pub fn name(self) -> &'static str {
        match self {
            PointerRole::Ink => "ink",
            PointerRole::Navigate => "navigate",
            PointerRole::Ignore => "ignore",
        }
    }
}

/// Che cosa fa un dito quando nessuna penna è vicina.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum TouchPolicy {
    #[default]
    Auto,
    Ink,
    Navigate,
}

impl TouchPolicy {
    /// Il nome della politica, lo stesso che usa il lato TypeScript.
    pub fn name(self) -> &'static str {
        match self {
            TouchPolicy::Auto => "auto",
            TouchPolicy::Ink => "ink",
            TouchPolicy::Navigate => "navigate",
        }
    }
}

/// Lo stato della superficie che la decisione guarda.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct RoleContext {
    pub touch: TouchPolicy,
    /// Su questa superficie si è vista una penna, anche solo sospesa.
    pub pen_seen: bool,
    /// Una penna tocca la superficie o è sospesa sopra di lei.
    pub pen_near: bool,
    /// Le dita già giù che non sono palmo.
    pub touches_down: usize,
}

/// Il tasto principale di Pointer Events (`PointerEvent.button`).
const PRIMARY: i32 = 0;
/// Il tasto centrale.
const MIDDLE: i32 = 1;

/// Il ruolo di un puntatore nel momento in cui si appoggia.
pub fn classify_pointer(kind: PointerKind, button: i32, context: &RoleContext) -> PointerRole {
    match kind {
        PointerKind::Pen => {
            if button == PRIMARY {
                PointerRole::Ink
            } else {
                PointerRole::Ignore
            }
        }
        PointerKind::Touch => {
            if context.pen_near {
                return PointerRole::Ignore;
            }
            if context.touches_down > 0 {
                return PointerRole::Navigate;
            }
            match context.touch {
                TouchPolicy::Auto => {
                    if context.pen_seen {
                        PointerRole::Navigate
                    } else {
                        PointerRole::Ink
                    }
                }
                TouchPolicy::Ink => PointerRole::Ink,
                TouchPolicy::Navigate => PointerRole::Navigate,
            }
        }
        PointerKind::Mouse => match button {
            PRIMARY => PointerRole::Ink,
            MIDDLE => PointerRole::Navigate,
            _ => PointerRole::Ignore,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> RoleContext {
        RoleContext {
            touch: TouchPolicy::Auto,
            pen_seen: false,
            pen_near: false,
            touches_down: 0,
        }
    }

    #[test]
    fn la_punta_della_penna_disegna_e_gli_altri_tasti_no() {
        assert_eq!(
            classify_pointer(PointerKind::Pen, 0, &context()),
            PointerRole::Ink
        );
        // Il tasto laterale e la gomma sono degli strumenti, non del tratto.
        for button in [1, 2, 5] {
            assert_eq!(
                classify_pointer(PointerKind::Pen, button, &context()),
                PointerRole::Ignore
            );
        }
    }

    #[test]
    fn il_mouse_disegna_col_principale_e_muove_la_vista_col_centrale() {
        assert_eq!(
            classify_pointer(PointerKind::Mouse, 0, &context()),
            PointerRole::Ink
        );
        assert_eq!(
            classify_pointer(PointerKind::Mouse, 1, &context()),
            PointerRole::Navigate
        );
        assert_eq!(
            classify_pointer(PointerKind::Mouse, 2, &context()),
            PointerRole::Ignore
        );
    }

    #[test]
    fn un_dito_vicino_a_una_penna_e_il_palmo() {
        for touch in [TouchPolicy::Auto, TouchPolicy::Ink, TouchPolicy::Navigate] {
            let near = RoleContext {
                touch,
                pen_near: true,
                ..context()
            };
            assert_eq!(
                classify_pointer(PointerKind::Touch, 0, &near),
                PointerRole::Ignore,
                "{touch:?}"
            );
        }
    }

    #[test]
    fn un_secondo_dito_e_navigazione_qualunque_sia_la_politica() {
        for touch in [TouchPolicy::Auto, TouchPolicy::Ink, TouchPolicy::Navigate] {
            let second = RoleContext {
                touch,
                touches_down: 1,
                ..context()
            };
            assert_eq!(
                classify_pointer(PointerKind::Touch, 0, &second),
                PointerRole::Navigate,
                "{touch:?}"
            );
        }
    }

    #[test]
    fn la_politica_del_tocco_decide_per_un_dito_solo() {
        let ink = RoleContext {
            touch: TouchPolicy::Ink,
            pen_seen: true,
            ..context()
        };
        assert_eq!(
            classify_pointer(PointerKind::Touch, 0, &ink),
            PointerRole::Ink
        );
        let navigate = RoleContext {
            touch: TouchPolicy::Navigate,
            ..context()
        };
        assert_eq!(
            classify_pointer(PointerKind::Touch, 0, &navigate),
            PointerRole::Navigate
        );
        // `Auto`: disegna finché non si è vista una penna, poi muove la vista.
        assert_eq!(
            classify_pointer(PointerKind::Touch, 0, &context()),
            PointerRole::Ink
        );
        let seen = RoleContext {
            pen_seen: true,
            ..context()
        };
        assert_eq!(
            classify_pointer(PointerKind::Touch, 0, &seen),
            PointerRole::Navigate
        );
    }
}
