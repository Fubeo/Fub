//! Il codificatore di `js.rs` contro `JSON.stringify` (regola R6).
//!
//! Ogni valore atteso qui è stato preso da Node v22.23.3 con
//! `node -e 'console.log(JSON.stringify(...))'` (o `String(x)` per i numeri)
//! e incollato a mano: il test non lancia Node e non genera i valori con il
//! codice che verifica.

use fub_canvas_core::js::{
    encode, encode_pretty, is_array_index, js_entries, js_json_number, js_number, js_string,
};
use serde_json::{Number, Value};

/// `String(x)` in Node v22.23.3. Le righe con «pareggio» sono numeri le cui
/// cifre più corte hanno due candidati alla stessa distanza esatta: `{:e}` di
/// Rust sceglie l'ultima cifra dispari, JavaScript quella pari (prova 4).
const NUMBERS: &[(f64, &str)] = &[
    (0.0, "0"),
    (-0.0, "0"),
    (1.0, "1"),
    (-1.0, "-1"),
    (0.1, "0.1"),
    (0.2, "0.2"),
    (0.30000000000000004, "0.30000000000000004"),
    (1.5, "1.5"),
    (-2.5, "-2.5"),
    (0.5, "0.5"),
    (100.0, "100"),
    (123.456, "123.456"),
    (1e21, "1e+21"),
    (999999999999999900000.0, "999999999999999900000"),
    (1e20, "100000000000000000000"),
    (123456789012345680000.0, "123456789012345680000"),
    (1e-6, "0.000001"),
    (1e-7, "1e-7"),
    (-1e-7, "-1e-7"),
    (5e-7, "5e-7"),
    (0.0000012345, "0.0000012345"),
    (1.1e-6, "0.0000011"),
    (0.00001, "0.00001"),
    (1e-5 * 1.5, "0.000015000000000000002"),
    (123456789e-15, "1.23456789e-7"),
    (123e-20, "1.23e-18"),
    (5e-324, "5e-324"),
    (-5e-324, "-5e-324"),
    (f64::MAX, "1.7976931348623157e+308"),
    (f64::MIN_POSITIVE, "2.2250738585072014e-308"),
    (1e100, "1e+100"),
    (1.2345e-100, "1.2345e-100"),
    (1.5e300, "1.5e+300"),
    (9007199254740991.0, "9007199254740991"),
    (-9007199254740992.0, "-9007199254740992"),
    (2147483648.0, "2147483648"),
    (4294967295.0, "4294967295"),
    (18446744073709551615.0, "18446744073709552000"),
    (12345678901234567890.0, "12345678901234567000"),
    (std::f64::consts::PI, "3.141592653589793"),
    (std::f64::consts::E, "2.718281828459045"),
    (1.0 / 3.0, "0.3333333333333333"),
    (2.0 / 3.0, "0.6666666666666666"),
    (1.0000000000000002, "1.0000000000000002"),
    (4.35, "4.35"),
    // Pareggi: `{:e}` dà 7.534866333007813e-1, 1.7767898559570313e1,
    // 1.9618112818677013e14, 1.2569839477539063e1.
    (0.7534866333007812, "0.7534866333007812"),
    (17.767898559570312, "17.767898559570312"),
    (196181128186770.12, "196181128186770.12"),
    (12.569839477539062, "12.569839477539062"),
];

#[test]
fn numbers_are_written_like_number_to_string() {
    assert!(NUMBERS.len() >= 40);
    for &(x, expected) in NUMBERS {
        assert_eq!(js_number(x), expected, "{x:e}");
    }
}

#[test]
fn ties_need_the_even_digit_rule() {
    // La prova che i pareggi sopra sono veri: `{:e}` da solo sbaglierebbe.
    assert_eq!(format!("{:e}", 0.7534866333007812), "7.534866333007813e-1");
    assert_eq!(format!("{:e}", 196181128186770.12), "1.9618112818677013e14");
}

#[test]
fn non_finite_numbers_follow_string_not_json() {
    // `String(NaN)`, `String(Infinity)`, `String(-Infinity)`. Un `Value` non
    // li contiene mai; `JSON.stringify` li scriverebbe `null`.
    assert_eq!(js_number(f64::NAN), "NaN");
    assert_eq!(js_number(f64::INFINITY), "Infinity");
    assert_eq!(js_number(f64::NEG_INFINITY), "-Infinity");
}

#[test]
fn json_integers_pass_through_f64() {
    // `JSON.stringify(JSON.parse("..."))`.
    let cases: &[(Number, &str)] = &[
        (Number::from(9_007_199_254_740_993_u64), "9007199254740992"),
        (Number::from(u64::MAX), "18446744073709552000"),
        (Number::from(i64::MIN), "-9223372036854776000"),
        (Number::from(-42_i64), "-42"),
        (Number::from(0_u64), "0"),
    ];
    for (number, expected) in cases {
        assert_eq!(js_json_number(number), *expected, "{number}");
    }
}

#[test]
fn strings_are_escaped_like_json_stringify() {
    let controls: String = (0u8..0x20).map(char::from).collect();
    assert_eq!(
        js_string(&controls),
        "\"\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f\""
    );
    assert_eq!(
        js_string("a/b\\c\"d\u{7f}\u{80}é\u{2028}\u{2029}😀"),
        "\"a/b\\\\c\\\"d\u{7f}\u{80}é\u{2028}\u{2029}😀\""
    );
    assert_eq!(js_string(""), "\"\"");
}

#[test]
fn array_indices_are_canonical_integers_below_two_to_the_32_minus_one() {
    for key in ["0", "1", "10", "4294967294"] {
        assert!(is_array_index(key), "{key}");
    }
    for key in [
        "",
        "01",
        "00",
        "-0",
        "-1",
        "1.0",
        " 3",
        "3 ",
        "+1",
        "4294967295",
        "99999999999",
        "__proto__",
    ] {
        assert!(!is_array_index(key), "{key}");
    }
}

#[test]
fn entries_put_indices_first_then_insertion_order() {
    let value: Value = serde_json::from_str(r#"{"b":1,"7":0,"a":2,"01":3,"2":4}"#).unwrap();
    let Value::Object(map) = value else {
        unreachable!()
    };
    let keys: Vec<&str> = js_entries(&map).into_iter().map(|(k, _)| k).collect();
    // `Object.keys(JSON.parse(...))` in Node.
    assert_eq!(keys, ["2", "7", "b", "a", "01"]);
}

/// (sorgente letto con `JSON.parse`, `JSON.stringify(v)`,
/// `JSON.stringify(v, null, 2)`), da Node v22.23.3.
const VALUES: &[(&str, &str, &str)] = &[
    (
        r#"{}"#,
        "{}",
        "{}",
    ),
    (
        r#"[]"#,
        "[]",
        "[]",
    ),
    (
        r#""""#,
        "\"\"",
        "\"\"",
    ),
    (
        r#"{"b":1,"a":2,"1":3,"0":4}"#,
        "{\"0\":4,\"1\":3,\"b\":1,\"a\":2}",
        "{\n  \"0\": 4,\n  \"1\": 3,\n  \"b\": 1,\n  \"a\": 2\n}",
    ),
    (
        r#"{"01":1,"1":2,"4294967295":3,"4294967294":4,"-0":5,"10":6,"2":7,"1.0":8," 3":9}"#,
        "{\"1\":2,\"2\":7,\"10\":6,\"4294967294\":4,\"01\":1,\"4294967295\":3,\"-0\":5,\"1.0\":8,\" 3\":9}",
        "{\n  \"1\": 2,\n  \"2\": 7,\n  \"10\": 6,\n  \"4294967294\": 4,\n  \"01\": 1,\n  \"4294967295\": 3,\n  \"-0\": 5,\n  \"1.0\": 8,\n  \" 3\": 9\n}",
    ),
    (
        r#"{"__proto__":{"x":1},"constructor":2,"toString":3}"#,
        "{\"__proto__\":{\"x\":1},\"constructor\":2,\"toString\":3}",
        "{\n  \"__proto__\": {\n    \"x\": 1\n  },\n  \"constructor\": 2,\n  \"toString\": 3\n}",
    ),
    (
        r#"{"s":"","esc":"\"\\\/\b\f\n\r\t\u0000\u001f\u007f","u":"é€😀\u2028\u2029"}"#,
        "{\"s\":\"\",\"esc\":\"\\\"\\\\/\\b\\f\\n\\r\\t\\u0000\\u001f\u{7f}\",\"u\":\"é€😀\u{2028}\u{2029}\"}",
        "{\n  \"s\": \"\",\n  \"esc\": \"\\\"\\\\/\\b\\f\\n\\r\\t\\u0000\\u001f\u{7f}\",\n  \"u\": \"é€😀\u{2028}\u{2029}\"\n}",
    ),
    (
        r#"{"nested":{"empty":{},"arr":[],"list":[1,{"z":null,"a":true}]},"f":false}"#,
        "{\"nested\":{\"empty\":{},\"arr\":[],\"list\":[1,{\"z\":null,\"a\":true}]},\"f\":false}",
        "{\n  \"nested\": {\n    \"empty\": {},\n    \"arr\": [],\n    \"list\": [\n      1,\n      {\n        \"z\": null,\n        \"a\": true\n      }\n    ]\n  },\n  \"f\": false\n}",
    ),
    (
        r#"{"nums":[-0.0,1.0,1e2,1e21,1E-7,123e-20,9007199254740993,18446744073709551615,-9223372036854775808,0.1,5e-324,1.7976931348623157e308]}"#,
        "{\"nums\":[0,1,100,1e+21,1e-7,1.23e-18,9007199254740992,18446744073709552000,-9223372036854776000,0.1,5e-324,1.7976931348623157e+308]}",
        "{\n  \"nums\": [\n    0,\n    1,\n    100,\n    1e+21,\n    1e-7,\n    1.23e-18,\n    9007199254740992,\n    18446744073709552000,\n    -9223372036854776000,\n    0.1,\n    5e-324,\n    1.7976931348623157e+308\n  ]\n}",
    ),
    (
        r#"{"nodes":[{"id":"a1","type":"text","x":-10,"y":20,"width":250,"height":60,"text":"Ciao\nmondo","fub:ink":{"v":1}}],"edges":[]}"#,
        "{\"nodes\":[{\"id\":\"a1\",\"type\":\"text\",\"x\":-10,\"y\":20,\"width\":250,\"height\":60,\"text\":\"Ciao\\nmondo\",\"fub:ink\":{\"v\":1}}],\"edges\":[]}",
        "{\n  \"nodes\": [\n    {\n      \"id\": \"a1\",\n      \"type\": \"text\",\n      \"x\": -10,\n      \"y\": 20,\n      \"width\": 250,\n      \"height\": 60,\n      \"text\": \"Ciao\\nmondo\",\n      \"fub:ink\": {\n        \"v\": 1\n      }\n    }\n  ],\n  \"edges\": []\n}",
    ),
    (
        r#"[[[]],[{}],"x",null,[{"0":{}}]]"#,
        "[[[]],[{}],\"x\",null,[{\"0\":{}}]]",
        "[\n  [\n    []\n  ],\n  [\n    {}\n  ],\n  \"x\",\n  null,\n  [\n    {\n      \"0\": {}\n    }\n  ]\n]",
    ),
    (
        r#"{"key \"q\"":"v","\u0001":1,"":0}"#,
        "{\"key \\\"q\\\"\":\"v\",\"\\u0001\":1,\"\":0}",
        "{\n  \"key \\\"q\\\"\": \"v\",\n  \"\\u0001\": 1,\n  \"\": 0\n}",
    ),
];

#[test]
fn values_are_encoded_like_json_stringify() {
    assert!(VALUES.len() >= 10);
    for &(source, compact, pretty) in VALUES {
        let value: Value = serde_json::from_str(source).unwrap();
        assert_eq!(encode(&value), compact, "{source}");
        assert_eq!(encode_pretty(&value), pretty, "{source}");
    }
}
