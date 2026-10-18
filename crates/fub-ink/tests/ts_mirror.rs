//! Il mirror del nucleo dell'inchiostro, Rust ↔ TypeScript, legato da una
//! fixture generata.
//!
//! Il percorso caldo del tratto gira nel client, in TypeScript, evento per
//! evento (DEC-23: nessun giro IPC o WASM a ogni battuta). Il nucleo è quindi
//! scritto due volte, e questo crate è la copia che fa fede. Qui si genera
//! `apps/client/src/ink/__fixtures__/ink-samples.json` con la risposta **di
//! Rust** per ogni caso, e il gemello Vitest (`apps/client/src/ink/mirror.test.ts`)
//! passa gli stessi input alla copia TypeScript e pretende la stessa risposta.
//! Cambiare una regola da un lato solo è rosso: se cambia Rust la fixture è
//! stantia (questo test), e rigenerandola (`UPDATE_MIRROR=1 cargo test -p
//! fub-ink --test ts_mirror`) il rosso si sposta di là.
//!
//! Il giro è quello di `rules-samples.json` di `fub-abi`: coppie input → `out`
//! per ogni regola. Le regole della fixture sono:
//!
//! - `scenario`: il ciclo di vita completo, evento per evento (`common`);
//! - `role`: chi disegna e chi è il palmo;
//! - `pen_curve` e `pen_curve_valid`: la curva della pressione;
//! - `tilt_angles`, `pen_angles`, `reports_tilt`: l'inclinazione della penna;
//! - `stabilizer`: lo stabilizzatore del tratto, da solo.
//!
//! **Le due metà si nominano a vicenda.** Il gemello TS pretende che ogni
//! chiave della fixture abbia un suo handler *e* che ogni handler abbia una
//! chiave.

mod common;

use common::*;
use fub_ink::{
    angles_from_tilt, classify_pointer, pen_angles, reports_tilt, PenCurve, PointerKind,
    RoleContext, Sample, Stabilizer, StabilizerConfig, Tilt, TouchPolicy,
};
use serde_json::{json, Map, Value};

fn fixture_path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/client/src/ink/__fixtures__/ink-samples.json"
    ))
}

const POLICIES: [TouchPolicy; 3] = [TouchPolicy::Auto, TouchPolicy::Ink, TouchPolicy::Navigate];

fn role_cases() -> Vec<Value> {
    let mut cases = Vec::new();
    let quiet = RoleContext {
        touch: TouchPolicy::Auto,
        pen_seen: false,
        pen_near: false,
        touches_down: 0,
    };
    let mut push = |kind: PointerKind, button: i32, context: RoleContext| {
        cases.push(json!({
            "pointerType": kind.name(),
            "button": button,
            "touch": context.touch.name(),
            "penSeen": context.pen_seen,
            "penNear": context.pen_near,
            "touchesDown": context.touches_down,
            "out": classify_pointer(kind, button, &context).name(),
        }));
    };
    // La penna e il mouse non guardano il contesto: contano i tasti.
    for kind in [PointerKind::Pen, PointerKind::Mouse] {
        for button in [0, 1, 2, 5] {
            push(kind, button, quiet);
        }
    }
    for touch in POLICIES {
        for pen_seen in [false, true] {
            for pen_near in [false, true] {
                for touches_down in 0..=2 {
                    push(
                        PointerKind::Touch,
                        0,
                        RoleContext {
                            touch,
                            pen_seen,
                            pen_near,
                            touches_down,
                        },
                    );
                }
            }
        }
    }
    cases
}

fn pen_curve_cases() -> Vec<Value> {
    let curves = [
        (0.0, 0.0, 1.0),
        (1.0, 0.0, 1.0),
        (-1.0, 0.0, 1.0),
        (0.5, 0.1, 0.9),
        (0.0, 0.5, 0.5),
        (0.3, 0.2, 0.8),
    ];
    let inputs = [0.0, 0.001, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    let mut cases = Vec::new();
    for (soft, min, full) in curves {
        let curve = PenCurve::new(soft, min, full).expect("curva valida");
        for pressure in inputs {
            cases.push(json!({
                "soft": soft,
                "min": min,
                "full": full,
                "pressure": pressure,
                "out": curve.apply(pressure),
            }));
        }
    }
    cases
}

fn pen_curve_valid_cases() -> Vec<Value> {
    [
        (0.0, 0.0, 1.0),
        (1.0, 0.5, 0.5),
        (-1.0, 0.0, 1.0),
        (1.1, 0.0, 1.0),
        (-1.1, 0.0, 1.0),
        (0.0, 0.6, 1.0),
        (0.0, -0.1, 1.0),
        (0.0, 0.0, 0.4),
        (0.0, 0.0, 1.1),
    ]
    .into_iter()
    .map(|(soft, min, full)| {
        json!({
            "soft": soft,
            "min": min,
            "full": full,
            "out": PenCurve::new(soft, min, full).is_some(),
        })
    })
    .collect()
}

fn tilt_angles_cases() -> Vec<Value> {
    [
        (0.0, 0.0),
        (45.0, 0.0),
        (0.0, 45.0),
        (-45.0, 0.0),
        (0.0, -45.0),
        (90.0, 30.0),
        (-90.0, 0.0),
        (30.0, 60.0),
        (-30.0, -60.0),
        (60.0, -20.0),
        (10.0, 5.0),
        (1.0, 89.0),
    ]
    .into_iter()
    .map(|(x, y)| {
        let angles = angles_from_tilt(x, y);
        json!({"tiltX": x, "tiltY": y, "out": {"a": angles.a, "z": angles.z}})
    })
    .collect()
}

fn tilt_json(tilt: &Tilt) -> Value {
    json!({
        "tiltX": tilt.tilt_x,
        "tiltY": tilt.tilt_y,
        "altitude": tilt.altitude,
        "azimuth": tilt.azimuth,
    })
}

fn tilts() -> Vec<Tilt> {
    use std::f64::consts::PI;
    vec![
        Tilt::default(),
        Tilt {
            tilt_x: Some(0.0),
            tilt_y: Some(0.0),
            altitude: Some(PI / 2.0),
            azimuth: Some(0.0),
        },
        Tilt {
            tilt_x: Some(3.0),
            tilt_y: Some(0.0),
            altitude: None,
            azimuth: None,
        },
        Tilt {
            tilt_x: Some(0.0),
            tilt_y: Some(-3.0),
            altitude: None,
            azimuth: None,
        },
        Tilt {
            tilt_x: None,
            tilt_y: None,
            altitude: Some(1.0),
            azimuth: Some(0.0),
        },
        Tilt {
            tilt_x: None,
            tilt_y: None,
            altitude: Some(PI / 2.0),
            azimuth: Some(0.1),
        },
        Tilt {
            tilt_x: Some(45.0),
            tilt_y: Some(0.0),
            altitude: Some(PI / 4.0),
            azimuth: Some(PI),
        },
        Tilt {
            tilt_x: Some(0.0),
            tilt_y: Some(45.0),
            altitude: None,
            azimuth: None,
        },
        // Un angolo senza il suo compagno non basta.
        Tilt {
            tilt_x: None,
            tilt_y: None,
            altitude: Some(1.0),
            azimuth: None,
        },
    ]
}

fn pen_angles_cases() -> Vec<Value> {
    tilts()
        .iter()
        .map(|tilt| {
            let out = pen_angles(tilt).map_or(Value::Null, |a| json!({"a": a.a, "z": a.z}));
            let mut case = tilt_json(tilt);
            case["out"] = out;
            case
        })
        .collect()
}

fn reports_tilt_cases() -> Vec<Value> {
    tilts()
        .iter()
        .map(|tilt| {
            let mut case = tilt_json(tilt);
            case["out"] = json!(reports_tilt(tilt));
            case
        })
        .collect()
}

fn stabilizer_config_json(c: &StabilizerConfig) -> Value {
    json!({
        "amount": c.amount,
        "pulledString": c.pulled_string,
        "catchUp": c.catch_up,
        "catchUpOnEnd": c.catch_up_on_end,
    })
}

fn stabilizer_cases() -> Vec<Value> {
    let point = |x: f64, y: f64, t: f64| Sample {
        x,
        y,
        p: None,
        t,
        tilt: None,
    };
    let string = StabilizerConfig {
        amount: 0.2,
        pulled_string: true,
        catch_up_on_end: false,
        ..StabilizerConfig::default()
    };
    let average = StabilizerConfig {
        amount: 0.8,
        catch_up_on_end: false,
        ..StabilizerConfig::default()
    };
    let jitter: Vec<Sample> = (0..8)
        .map(|i| point(if i % 2 == 0 { 0.0 } else { 5.0 }, 0.0, 0.0))
        .collect();
    let far = vec![point(0.0, 0.0, 0.0), point(100.0, 0.0, 0.0)];
    let paused = vec![
        point(0.0, 0.0, 0.0),
        point(100.0, 0.0, 16.0),
        point(100.0, 0.0, 500.0),
    ];
    let rate = |interval: f64| {
        let mut points = vec![point(0.0, 0.0, 0.0)];
        let mut t = 0.0;
        while t < 32.0 {
            t += interval;
            points.push(point(100.0, 0.0, t));
        }
        points
    };
    let wandering = vec![
        point(0.0, 0.0, 0.0),
        point(12.0, 3.0, 8.0),
        point(25.0, -4.0, 16.0),
        point(37.0, 5.0, 24.0),
        point(60.0, 0.0, 40.0),
        point(60.0, 0.0, 200.0),
    ];
    let cases: Vec<(&str, StabilizerConfig, f64, Vec<Sample>)> = vec![
        (
            "off_leaves_samples_alone",
            StabilizerConfig::default(),
            1.0,
            wandering.clone(),
        ),
        ("string_ignores_a_jitter", string, 1.0, jitter),
        ("string_far", string, 1.0, far.clone()),
        ("string_shortens_with_zoom", string, 2.0, far.clone()),
        ("string_with_a_bad_zoom", string, 0.0, far),
        (
            "string_ends_at_the_pointer",
            StabilizerConfig {
                catch_up_on_end: true,
                ..string
            },
            1.0,
            wandering.clone(),
        ),
        (
            "average_catches_up_in_a_pause",
            average,
            1.0,
            paused.clone(),
        ),
        (
            "average_waits_without_catch_up",
            StabilizerConfig {
                catch_up: false,
                ..average
            },
            1.0,
            paused,
        ),
        ("average_at_1000_hz", average, 1.0, rate(1.0)),
        ("average_at_60_hz", average, 1.0, rate(16.0)),
        (
            "average_on_a_wandering_pointer",
            average,
            1.0,
            wandering.clone(),
        ),
        (
            "average_slowest",
            StabilizerConfig {
                amount: 1.0,
                ..average
            },
            1.0,
            wandering,
        ),
        (
            "average_after_a_long_pause",
            StabilizerConfig {
                amount: 0.5,
                ..average
            },
            1.0,
            vec![point(0.0, 0.0, 0.0), point(50.0, 0.0, 3_600_000.0)],
        ),
    ];
    cases
        .into_iter()
        .map(|(name, config, zoom, points)| {
            let mut stabilizer = Stabilizer::new(config, zoom);
            let mut out = Vec::new();
            for p in &points {
                stabilizer.push(*p, &mut out);
            }
            stabilizer.finish(&mut out);
            json!({
                "name": name,
                "config": stabilizer_config_json(&config),
                "zoom": zoom,
                "points": points.iter().map(sample_json).collect::<Vec<_>>(),
                "out": out.iter().map(sample_json).collect::<Vec<_>>(),
            })
        })
        .collect()
}

fn expected() -> Value {
    let mut fixture = Map::new();
    fixture.insert(
        "scenario".into(),
        Value::Array(catalog().iter().map(scenario_json).collect()),
    );
    fixture.insert("role".into(), Value::Array(role_cases()));
    fixture.insert("pen_curve".into(), Value::Array(pen_curve_cases()));
    fixture.insert(
        "pen_curve_valid".into(),
        Value::Array(pen_curve_valid_cases()),
    );
    fixture.insert("tilt_angles".into(), Value::Array(tilt_angles_cases()));
    fixture.insert("pen_angles".into(), Value::Array(pen_angles_cases()));
    fixture.insert("reports_tilt".into(), Value::Array(reports_tilt_cases()));
    fixture.insert("stabilizer".into(), Value::Array(stabilizer_cases()));
    Value::Object(fixture)
}

#[test]
fn ink_fixture_is_in_sync_with_the_rust_core() {
    let expected = expected();
    let path = fixture_path();

    // Rigenerazione esplicita: `UPDATE_MIRROR=1 cargo test -p fub-ink --test
    // ts_mirror`. Fuori da quel caso il test non scrive mai nulla.
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("creates the fixture folder");
        }
        let mut json = serde_json::to_string_pretty(&expected).expect("pretty");
        json.push('\n');
        std::fs::write(&path, json).expect("writes the fixture");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|and| {
        panic!(
            "ink fixture missing ({}): {and}. Regenerate with \
             `UPDATE_MIRROR=1 cargo test -p fub-ink --test ts_mirror`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("valid JSON fixture");

    let mut found = Vec::new();
    differences(&committed, &expected, "$", &mut found);
    assert!(
        found.is_empty(),
        "the ink fixture is stale: a Rust rule changed without regenerating it. \
         Regenerate with `UPDATE_MIRROR=1 cargo test -p fub-ink --test ts_mirror`, \
         then update the TypeScript twin until `ink/mirror.test.ts` turns green.\n{}",
        found.join("\n")
    );
}

/// Quanto due numeri della fixture possono differire, come nel gemello TS: la
/// trigonometria della libreria matematica di sistema cambia l'ultima cifra da
/// una piattaforma all'altra (su macOS `atan2` dell'azimut), e una regola che
/// cambia sposta i numeri ben più in là.
const EPSILON: f64 = 1e-9;

/// Il confronto della fixture: stessa forma, stesse chiavi, numeri entro
/// [`EPSILON`].
fn differences(committed: &Value, expected: &Value, path: &str, found: &mut Vec<String>) {
    match (committed, expected) {
        (Value::Number(a), Value::Number(b)) => match (a.as_f64(), b.as_f64()) {
            (Some(x), Some(y)) if (x - y).abs() <= EPSILON => {}
            _ => found.push(format!("{path}: committed {a}, expected {b}")),
        },
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                found.push(format!(
                    "{path}: committed {} items, expected {}",
                    a.len(),
                    b.len()
                ));
                return;
            }
            for (index, (x, y)) in a.iter().zip(b).enumerate() {
                differences(x, y, &format!("{path}[{index}]"), found);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            for (key, x) in a {
                match b.get(key) {
                    Some(y) => differences(x, y, &format!("{path}.{key}"), found),
                    None => found.push(format!("{path}.{key}: only committed")),
                }
            }
            for key in b.keys().filter(|key| !a.contains_key(*key)) {
                found.push(format!("{path}.{key}: only expected"));
            }
        }
        _ if committed == expected => {}
        _ => found.push(format!(
            "{path}: committed {committed}, expected {expected}"
        )),
    }
}

/// Il test del test: una fixture di casi che non distinguono niente non
/// presidierebbe niente.
#[test]
fn every_rule_has_cases_that_disagree_with_each_other() {
    let fixture = expected();
    for (rule, cases) in fixture.as_object().expect("object") {
        let cases = cases.as_array().expect("array of cases");
        assert!(cases.len() >= 2, "`{rule}` has fewer than two cases");
        let distinct: std::collections::BTreeSet<String> =
            cases.iter().map(|c| c["out"].to_string()).collect();
        assert!(
            distinct.len() >= 2,
            "`{rule}`: all cases yield the same response ({distinct:?}), \
             so the fixture does not distinguish two different implementations"
        );
    }
}

/// Gli scenari devono esercitare ogni tipo di effetto, ogni ragione di
/// annullamento, ogni ruolo e le due metà di una divisione: una copia
/// TypeScript che sbagliasse un ramo mai esercitato resterebbe verde.
#[test]
fn the_scenarios_exercise_every_kind_of_effect() {
    let fixture = expected();
    let mut kinds = std::collections::BTreeSet::new();
    let mut reasons = std::collections::BTreeSet::new();
    let mut roles = std::collections::BTreeSet::new();
    let (mut split, mut continued, mut tilted_end, mut flat_end) = (false, false, false, false);
    for scenario in fixture["scenario"].as_array().unwrap() {
        for out in scenario["out"].as_array().unwrap() {
            for effect in out["effects"].as_array().unwrap() {
                kinds.insert(effect["fx"].as_str().unwrap().to_owned());
                if effect["fx"] == "cancel" {
                    reasons.insert(effect["reason"].as_str().unwrap().to_owned());
                }
                if effect["fx"] == "end" {
                    split |= effect["split"] == true;
                    continued |= effect["continued"] == true;
                    tilted_end |= effect["tilt"] == true;
                    flat_end |= effect["tilt"] == false;
                }
            }
            for role in out["roles"].as_object().unwrap().values() {
                if let Some(role) = role.as_str() {
                    roles.insert(role.to_owned());
                }
            }
        }
    }
    let expect = |found: &std::collections::BTreeSet<String>, wanted: &[&str], what: &str| {
        for item in wanted {
            assert!(
                found.contains(*item),
                "nessuno scenario esercita {what} `{item}`"
            );
        }
    };
    expect(
        &kinds,
        &[
            "capture",
            "release",
            "start",
            "samples",
            "predicted",
            "end",
            "cancel",
        ],
        "l'effetto",
    );
    expect(
        &reasons,
        &[
            "pointercancel",
            "lostcapture",
            "blur",
            "hidden",
            "palm",
            "gesture",
            "api",
            "destroy",
        ],
        "la ragione",
    );
    expect(&roles, &["ink", "navigate", "ignore"], "il ruolo");
    assert!(split && continued, "nessuno scenario divide un tratto");
    assert!(tilted_end && flat_end, "i tratti con e senza inclinazione");
}
