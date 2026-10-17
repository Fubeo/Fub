//! L'inclinazione della penna, dagli eventi del puntatore ai gradi di
//! `fub:ink`.
//!
//! Pointer Events la dà in due forme: `altitudeAngle` e `azimuthAngle` in
//! radianti, che sono quelle di `fub:ink`, e `tiltX`/`tiltY` in gradi, che sono
//! le sole su alcuni motori. Si preferiscono gli angoli; altrimenti si
//! convertono le inclinazioni con le formule della specifica Pointer Events 3.
//!
//! Un dispositivo senza sensore riporta i valori di default — altitudine π/2,
//! azimut 0, `tiltX` e `tiltY` a 0 — che sono anche quelli di una penna tenuta
//! perfettamente dritta. Per questo l'inclinazione di un tratto si conserva
//! solo se almeno un campione ha dato un valore diverso dal default
//! ([`reports_tilt`]): un tratto di una penna senza sensore non scrive `a` e
//! `z`.

use std::f64::consts::PI;

use crate::pointer::Tilt;

const RIGHT: f64 = PI / 2.0;

/// Gli angoli di un campione: altitudine (0…90) e azimut (0…360), in gradi.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct PenAngles {
    pub a: f64,
    pub z: f64,
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite())
}

/// `tilt_x`/`tilt_y` (gradi, −90…90) in altitudine e azimut (gradi), con le
/// formule di Pointer Events 3, casi di bordo compresi.
pub fn angles_from_tilt(tilt_x: f64, tilt_y: f64) -> PenAngles {
    let x = tilt_x * PI / 180.0;
    let y = tilt_y * PI / 180.0;
    let edge = tilt_x.abs() == 90.0 || tilt_y.abs() == 90.0;
    let tan_x = x.tan();
    let tan_y = y.tan();
    let mut azimuth = 0.0;
    if tilt_x == 0.0 {
        if tilt_y > 0.0 {
            azimuth = RIGHT;
        } else if tilt_y < 0.0 {
            azimuth = 3.0 * RIGHT;
        }
    } else if tilt_y == 0.0 {
        if tilt_x < 0.0 {
            azimuth = PI;
        }
    } else if !edge {
        azimuth = tan_y.atan2(tan_x);
        if azimuth < 0.0 {
            azimuth += 2.0 * PI;
        }
    }
    let altitude = if edge {
        0.0
    } else if tilt_x == 0.0 {
        RIGHT - y.abs()
    } else if tilt_y == 0.0 {
        RIGHT - x.abs()
    } else {
        (1.0 / (tan_x * tan_x + tan_y * tan_y).sqrt()).atan()
    };
    PenAngles {
        a: altitude * (180.0 / PI),
        z: azimuth * (180.0 / PI),
    }
}

/// Gli angoli di un campione, in gradi; `None` se il campione non ne porta.
pub fn pen_angles(tilt: &Tilt) -> Option<PenAngles> {
    if let (Some(altitude), Some(azimuth)) = (finite(tilt.altitude), finite(tilt.azimuth)) {
        return Some(PenAngles {
            a: altitude * (180.0 / PI),
            z: azimuth * (180.0 / PI),
        });
    }
    if let (Some(x), Some(y)) = (finite(tilt.tilt_x), finite(tilt.tilt_y)) {
        return Some(angles_from_tilt(x, y));
    }
    None
}

/// Vero se il campione porta un'inclinazione diversa dal default di Pointer
/// Events, cioè se il dispositivo ha davvero un sensore.
pub fn reports_tilt(tilt: &Tilt) -> bool {
    finite(tilt.tilt_x).is_some_and(|v| v != 0.0)
        || finite(tilt.tilt_y).is_some_and(|v| v != 0.0)
        || finite(tilt.altitude).is_some_and(|v| v != RIGHT)
        || finite(tilt.azimuth).is_some_and(|v| v != 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn una_penna_dritta_ha_altitudine_novanta_e_azimut_zero() {
        let angles = angles_from_tilt(0.0, 0.0);
        assert!(close(angles.a, 90.0) && close(angles.z, 0.0), "{angles:?}");
    }

    #[test]
    fn i_quattro_versi_hanno_gli_azimut_della_specifica() {
        assert!(close(angles_from_tilt(45.0, 0.0).z, 0.0));
        assert!(close(angles_from_tilt(0.0, 45.0).z, 90.0));
        assert!(close(angles_from_tilt(-45.0, 0.0).z, 180.0));
        assert!(close(angles_from_tilt(0.0, -45.0).z, 270.0));
    }

    #[test]
    fn a_novanta_gradi_la_penna_e_distesa() {
        let angles = angles_from_tilt(90.0, 30.0);
        assert!(close(angles.a, 0.0), "{angles:?}");
    }

    #[test]
    fn gli_angoli_dell_evento_si_preferiscono_alle_inclinazioni() {
        let tilt = Tilt {
            tilt_x: Some(45.0),
            tilt_y: Some(0.0),
            altitude: Some(PI / 4.0),
            azimuth: Some(PI),
        };
        let angles = pen_angles(&tilt).unwrap();
        assert!(
            close(angles.a, 45.0) && close(angles.z, 180.0),
            "{angles:?}"
        );
    }

    #[test]
    fn senza_angoli_valgono_le_inclinazioni_e_senza_niente_non_ce_ne_sono() {
        let tilt = Tilt {
            tilt_x: Some(0.0),
            tilt_y: Some(45.0),
            ..Tilt::default()
        };
        assert!(close(pen_angles(&tilt).unwrap().z, 90.0));
        assert!(pen_angles(&Tilt::default()).is_none());
        let broken = Tilt {
            altitude: Some(f64::NAN),
            azimuth: Some(0.0),
            ..Tilt::default()
        };
        assert!(pen_angles(&broken).is_none());
    }

    #[test]
    fn i_valori_di_default_non_sono_un_sensore() {
        let default = Tilt {
            tilt_x: Some(0.0),
            tilt_y: Some(0.0),
            altitude: Some(PI / 2.0),
            azimuth: Some(0.0),
        };
        assert!(!reports_tilt(&default));
        assert!(!reports_tilt(&Tilt::default()));
        for tilt in [
            Tilt {
                tilt_x: Some(3.0),
                ..default
            },
            Tilt {
                tilt_y: Some(-3.0),
                ..default
            },
            Tilt {
                altitude: Some(1.0),
                ..default
            },
            Tilt {
                azimuth: Some(0.1),
                ..default
            },
        ] {
            assert!(reports_tilt(&tilt), "{tilt:?}");
        }
    }
}
