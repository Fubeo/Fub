//! L'interprete: riferimenti, operatori, campi, arità delle funzioni,
//! chiamate e lambda.

use super::*;

pub(super) fn eval(
    ast: &FormulaAst,
    ctx: &RowContext,
    budget: &mut EvalBudget,
    depth: usize,
) -> Result<BaseValue, EvalError> {
    if depth > MAX_FORMULA_DEPTH {
        return Err(EvalError::Parse("annidamento eccessivo".to_string()));
    }
    budget.step()?;
    match ast {
        FormulaAst::Number(n) => Ok(BaseValue::Number(*n)),
        FormulaAst::Text(s) => Ok(BaseValue::Text(s.clone())),
        FormulaAst::Bool(b) => Ok(BaseValue::Bool(*b)),
        FormulaAst::Empty => Ok(BaseValue::Empty),
        FormulaAst::Ref(reference) => Ok(resolve_ref(reference, ctx)),
        FormulaAst::Unary(op, inner) => {
            let value = eval(inner, ctx, budget, depth + 1)?;
            eval_unary(*op, value)
        }
        FormulaAst::Binary(op, left, right) => {
            // `and`/`or` con cortocircuito; il resto valuta entrambi i rami.
            match op {
                BinaryOp::And => {
                    let l = eval(left, ctx, budget, depth + 1)?;
                    if !truthy(&l) {
                        return Ok(BaseValue::Bool(false));
                    }
                    let r = eval(right, ctx, budget, depth + 1)?;
                    Ok(BaseValue::Bool(truthy(&r)))
                }
                BinaryOp::Or => {
                    let l = eval(left, ctx, budget, depth + 1)?;
                    if truthy(&l) {
                        return Ok(BaseValue::Bool(true));
                    }
                    let r = eval(right, ctx, budget, depth + 1)?;
                    Ok(BaseValue::Bool(truthy(&r)))
                }
                _ => {
                    let l = eval(left, ctx, budget, depth + 1)?;
                    let r = eval(right, ctx, budget, depth + 1)?;
                    eval_binary(*op, l, r)
                }
            }
        }
        FormulaAst::Call(name, args) => eval_call(name, args, ctx, budget, depth),
        FormulaAst::Field(base, field) => {
            let value = eval(base, ctx, budget, depth + 1)?;
            eval_field(&value, field)
        }
        FormulaAst::List(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(eval(item, ctx, budget, depth + 1)?);
            }
            Ok(BaseValue::List(out))
        }
    }
}

fn resolve_ref(reference: &FormulaRef, ctx: &RowContext) -> BaseValue {
    match reference {
        FormulaRef::Prop(name) => ctx.props.get(name).cloned().unwrap_or(BaseValue::Empty),
        FormulaRef::File(name) => ctx.file.get(name).cloned().unwrap_or(BaseValue::Empty),
        FormulaRef::Container(name) => ctx.container.get(name).cloned().unwrap_or(BaseValue::Empty),
        FormulaRef::Formula(name) => ctx.formulas.get(name).cloned().unwrap_or(BaseValue::Empty),
    }
}

pub(super) fn truthy(value: &BaseValue) -> bool {
    match value {
        BaseValue::Empty => false,
        BaseValue::Bool(b) => *b,
        BaseValue::Number(n) => *n != 0.0,
        BaseValue::Text(s) => !s.is_empty(),
        BaseValue::Date(_) | BaseValue::Duration(_) => true,
        BaseValue::List(v) => !v.is_empty(),
        BaseValue::Object(m) => !m.is_empty(),
        BaseValue::File { .. } | BaseValue::Link { .. } => true,
        BaseValue::Error(_) => false,
    }
}

fn eval_unary(op: UnaryOp, value: BaseValue) -> Result<BaseValue, EvalError> {
    match op {
        UnaryOp::Plus => match value {
            BaseValue::Number(n) => Ok(BaseValue::Number(n)),
            other => Err(EvalError::Value(format!("+ su {}", other.type_name()))),
        },
        UnaryOp::Minus => match value {
            BaseValue::Number(n) => Ok(BaseValue::Number(-n)),
            other => Err(EvalError::Value(format!("- su {}", other.type_name()))),
        },
        UnaryOp::Not => Ok(BaseValue::Bool(!truthy(&value))),
    }
}

fn eval_binary(op: BinaryOp, left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    // Errori in ingresso: si propagano (nessun valore finto).
    if let BaseValue::Error(code) = left {
        return Ok(BaseValue::Error(code));
    }
    if let BaseValue::Error(code) = right {
        return Ok(BaseValue::Error(code));
    }
    match op {
        BinaryOp::Add => add_values(left, right),
        BinaryOp::Sub => sub_values(left, right),
        BinaryOp::Mul => mul_values(left, right),
        BinaryOp::Div => div_values(left, right),
        BinaryOp::Mod => mod_values(left, right),
        BinaryOp::Eq => Ok(BaseValue::Bool(values_equal(&left, &right))),
        BinaryOp::NotEq => Ok(BaseValue::Bool(!values_equal(&left, &right))),
        BinaryOp::Gt | BinaryOp::Gte | BinaryOp::Lt | BinaryOp::Lte => {
            compare_values(op, left, right)
        }
        BinaryOp::And | BinaryOp::Or => unreachable!("cortocircuito sopra"),
    }
}

fn add_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a + b)),
        (BaseValue::Text(a), BaseValue::Text(b)) => concat_text(&a, &b),
        (BaseValue::Text(a), b) => concat_text(&a, &b.display()),
        (a, BaseValue::Text(b)) => concat_text(&a.display(), &b),
        (BaseValue::Date(ms), BaseValue::Duration(d))
        | (BaseValue::Duration(d), BaseValue::Date(ms)) => {
            Ok(BaseValue::Date(ms.saturating_add(d)))
        }
        (BaseValue::Duration(a), BaseValue::Duration(b)) => {
            Ok(BaseValue::Duration(a.saturating_add(b)))
        }
        (BaseValue::List(mut a), BaseValue::List(b)) => {
            if a.len().saturating_add(b.len()) > MAX_TEXT_LIST_ITEMS {
                return Err(EvalError::Value("lista oltre il limite".to_string()));
            }
            a.extend(b);
            Ok(BaseValue::List(a))
        }
        (a, b) => Err(EvalError::Value(format!(
            "+ fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

/// Concat di stringhe con tetto PRIMA dell'allocazione (Main: nessun controllo
/// solo sul JSON finale).
fn concat_text(left: &str, right: &str) -> Result<BaseValue, EvalError> {
    if left.len().saturating_add(right.len()) > MAX_TEXT_BYTES {
        return Err(EvalError::Value("stringa oltre il limite".to_string()));
    }
    let mut out = String::with_capacity(left.len().saturating_add(right.len()));
    out.push_str(left);
    out.push_str(right);
    Ok(BaseValue::Text(out))
}

fn sub_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a - b)),
        (BaseValue::Date(a), BaseValue::Date(b)) => Ok(BaseValue::Duration(a.saturating_sub(b))),
        (BaseValue::Date(ms), BaseValue::Duration(d)) => Ok(BaseValue::Date(ms.saturating_sub(d))),
        (BaseValue::Duration(a), BaseValue::Duration(b)) => {
            Ok(BaseValue::Duration(a.saturating_sub(b)))
        }
        (a, b) => Err(EvalError::Value(format!(
            "- fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

fn mul_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a * b)),
        (a, b) => Err(EvalError::Value(format!(
            "* fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

fn div_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (_, BaseValue::Number(0.0)) => Err(EvalError::DivZero),
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a / b)),
        (a, b) => Err(EvalError::Value(format!(
            "/ fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

fn mod_values(left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    match (left, right) {
        (_, BaseValue::Number(0.0)) => Err(EvalError::DivZero),
        (BaseValue::Number(a), BaseValue::Number(b)) => Ok(BaseValue::Number(a % b)),
        (a, b) => Err(EvalError::Value(format!(
            "% fra {} e {}",
            a.type_name(),
            b.type_name()
        ))),
    }
}

fn values_equal(left: &BaseValue, right: &BaseValue) -> bool {
    match (left, right) {
        (BaseValue::Empty, BaseValue::Empty) => true,
        (BaseValue::Number(a), BaseValue::Number(b)) => a == b,
        (BaseValue::Text(a), BaseValue::Text(b)) => a == b,
        (BaseValue::Bool(a), BaseValue::Bool(b)) => a == b,
        (BaseValue::Date(a), BaseValue::Date(b)) => a == b,
        (BaseValue::Duration(a), BaseValue::Duration(b)) => a == b,
        (BaseValue::List(a), BaseValue::List(b)) => a == b,
        (BaseValue::Object(a), BaseValue::Object(b)) => a == b,
        (BaseValue::File { path: a, .. }, BaseValue::File { path: b, .. }) => a == b,
        (BaseValue::Link { target: a, .. }, BaseValue::Link { target: b, .. }) => a == b,
        _ => false,
    }
}

fn compare_values(op: BinaryOp, left: BaseValue, right: BaseValue) -> Result<BaseValue, EvalError> {
    let ordering = match (&left, &right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => a.partial_cmp(b),
        (BaseValue::Text(a), BaseValue::Text(b)) => Some(a.cmp(b)),
        (BaseValue::Bool(a), BaseValue::Bool(b)) => Some(a.cmp(b)),
        (BaseValue::Date(a), BaseValue::Date(b)) => Some(a.cmp(b)),
        (BaseValue::Duration(a), BaseValue::Duration(b)) => Some(a.cmp(b)),
        _ => None,
    };
    let Some(ordering) = ordering else {
        return Err(EvalError::Value(format!(
            "confronto fra {} e {}",
            left.type_name(),
            right.type_name()
        )));
    };
    let result = match op {
        BinaryOp::Gt => ordering == std::cmp::Ordering::Greater,
        BinaryOp::Gte => ordering != std::cmp::Ordering::Less,
        BinaryOp::Lt => ordering == std::cmp::Ordering::Less,
        BinaryOp::Lte => ordering != std::cmp::Ordering::Greater,
        _ => unreachable!(),
    };
    Ok(BaseValue::Bool(result))
}

fn eval_field(value: &BaseValue, field: &str) -> Result<BaseValue, EvalError> {
    match value {
        BaseValue::Object(map) => Ok(map.get(field).cloned().unwrap_or(BaseValue::Empty)),
        BaseValue::File { path, label } => match field {
            "path" => Ok(BaseValue::Text(path.clone())),
            "label" | "name" => Ok(label
                .clone()
                .map(BaseValue::Text)
                .unwrap_or(BaseValue::Empty)),
            _ => Err(EvalError::Name(format!("campo file.{field} sconosciuto"))),
        },
        BaseValue::Link { target, label } => match field {
            "target" | "path" => Ok(BaseValue::Text(target.clone())),
            "label" => Ok(label
                .clone()
                .map(BaseValue::Text)
                .unwrap_or(BaseValue::Empty)),
            _ => Err(EvalError::Name(format!("campo link.{field} sconosciuto"))),
        },
        BaseValue::Text(s) => eval_text_method(s, field, &[]),
        BaseValue::List(items) => eval_list_method(items, field, &[]),
        BaseValue::Date(ms) => eval_date_field(*ms, field),
        BaseValue::Duration(ms) => eval_duration_field(*ms, field),
        other => Err(EvalError::Value(format!(
            "campo .{field} su {}",
            other.type_name()
        ))),
    }
}

/// Matrice delle funzioni supportate (congelata: nome -> (min,max) argomenti).
/// Qualunque nome fuori matrice è `#NAME?`, mai un valore inventato.
pub(super) fn function_arity(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        // Condizioni e conversioni globali.
        "if" => (3, 3),
        "number" => (1, 1),
        "text" | "string" => (1, 1),
        "bool" => (1, 1),
        "date" => (1, 1),
        "duration" => (1, 1),
        "link" => (1, 2),
        "file" => (1, 1),
        "list" => (1, 1),
        "folder" | "tags" | "keys" | "values" => (1, 1),
        "get" | "has" => (2, 2),
        "object" => (0, 2 * MAX_TEXT_LIST_ITEMS),
        "is_empty" | "isEmpty" => (1, 1),
        "is_truthy" | "isTruthy" => (1, 1),
        "type_of" | "isType" => (1, 2),
        // Numeri globali.
        "min" => (1, usize::MAX),
        "max" => (1, usize::MAX),
        "sum" => (1, usize::MAX),
        "average" | "avg" => (1, usize::MAX),
        "round" => (1, 2),
        "floor" => (1, 1),
        "ceil" => (1, 1),
        "abs" => (1, 1),
        // Date/durate globali.
        "today" => (0, 0),
        "now" => (0, 0),
        // Stringhe: forma funzione e forma metodo condividono l'implementazione.
        "lower" => (1, 1),
        "upper" => (1, 1),
        "trim" => (1, 1),
        "length" | "len" => (1, 1),
        "contains" => (2, 2),
        "contains_all" | "containsAll" => (2, usize::MAX),
        "contains_any" | "containsAny" => (2, usize::MAX),
        "starts_with" | "startsWith" => (2, 2),
        "ends_with" | "endsWith" => (2, 2),
        "replace" => (3, 3),
        "slice" => (2, 3),
        "split" => (2, 2),
        "join" => (1, 2),
        "reverse" => (1, 1),
        // Liste.
        "unique" | "uniq" => (1, 1),
        "sort" => (1, 1),
        "flat" => (1, 1),
        "first" => (1, 1),
        "last" => (1, 1),
        // Testo, numeri, date e file alla maniera di Obsidian: pure e a
        // budget, nessuna legge l'orologio o il disco.
        "title" => (1, 1),
        "repeat" => (2, 2),
        "matches" => (2, 2),
        "escapeHTML" | "escape_html" => (1, 1),
        "toFixed" | "to_fixed" => (2, 2),
        "format" => (2, 2),
        "relative" => (1, 1),
        "time" => (1, 1),
        "hasTag" | "has_tag" => (2, usize::MAX),
        "hasProperty" | "has_property" => (1, 1),
        "hasLink" | "has_link" | "linksTo" | "links_to" => (2, 2),
        "inFolder" | "in_folder" => (2, 2),
        "asLink" | "as_link" => (1, 2),
        "asFile" | "as_file" => (1, 1),
        _ => return None,
    })
}

fn eval_call(
    name: &str,
    args: &[FormulaAst],
    ctx: &RowContext,
    budget: &mut EvalBudget,
    depth: usize,
) -> Result<BaseValue, EvalError> {
    if let Some(kind) = Lambda::named(name) {
        return eval_lambda(kind, name, args, ctx, budget, depth);
    }
    let Some((min, max)) = function_arity(name) else {
        return Err(EvalError::Name(format!("funzione sconosciuta `{name}`")));
    };
    // Valuta gli argomenti una volta sola, in ordine.
    let mut values = Vec::with_capacity(args.len());
    for arg in args {
        values.push(eval(arg, ctx, budget, depth + 1)?);
    }
    if values.len() < min || values.len() > max {
        return Err(EvalError::Value(format!(
            "`{name}` vuole {min}..{max} argomenti"
        )));
    }
    // Errori negli argomenti: si propagano (nessun valore finto).
    for value in &values {
        if let BaseValue::Error(code) = value {
            return Ok(BaseValue::Error(*code));
        }
    }
    call_known(name, values, ctx)
}

/// Le tre funzioni che ricevono un'espressione invece di un valore, come in
/// Obsidian: `lista.filter(value > 2)`, `lista.map(value * 2)`,
/// `lista.reduce(acc + value, 0)`. L'espressione si valuta una volta per
/// elemento, con `value` (l'elemento), `index` (la posizione, da 0) e, per
/// `reduce`, `acc` (il risultato fin lì) come nomi locali: dentro
/// l'espressione coprono una proprietà con lo stesso nome. Ogni giro spende
/// il budget come ogni altro passo, quindi una lista lunga si ferma lì.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Lambda {
    Filter,
    Map,
    Reduce,
}

impl Lambda {
    fn named(name: &str) -> Option<Self> {
        Some(match name {
            "filter" => Lambda::Filter,
            "map" => Lambda::Map,
            "reduce" => Lambda::Reduce,
            _ => return None,
        })
    }
}

fn eval_lambda(
    kind: Lambda,
    name: &str,
    args: &[FormulaAst],
    ctx: &RowContext,
    budget: &mut EvalBudget,
    depth: usize,
) -> Result<BaseValue, EvalError> {
    let wanted = if kind == Lambda::Reduce { 3 } else { 2 };
    if args.len() != wanted {
        return Err(EvalError::Value(format!(
            "`{name}` vuole {wanted} argomenti"
        )));
    }
    let items = match eval(&args[0], ctx, budget, depth + 1)? {
        BaseValue::List(items) => items,
        BaseValue::Empty => Vec::new(),
        BaseValue::Error(code) => return Ok(BaseValue::Error(code)),
        _ => return Err(EvalError::Value(format!("`{name}` vuole una lista"))),
    };
    let mut acc = if kind == Lambda::Reduce {
        match eval(&args[2], ctx, budget, depth + 1)? {
            BaseValue::Error(code) => return Ok(BaseValue::Error(code)),
            value => value,
        }
    } else {
        BaseValue::Empty
    };
    let mut local = ctx.clone();
    let mut out = Vec::new();
    for (index, item) in items.into_iter().enumerate() {
        budget.step()?;
        local.props.insert("value".into(), item.clone());
        local
            .props
            .insert("index".into(), BaseValue::Number(index as f64));
        if kind == Lambda::Reduce {
            local.props.insert("acc".into(), acc.clone());
        }
        let result = eval(&args[1], &local, budget, depth + 1)?;
        if let BaseValue::Error(code) = result {
            return Ok(BaseValue::Error(code));
        }
        match kind {
            Lambda::Filter => {
                if truthy(&result) {
                    out.push(item);
                }
            }
            Lambda::Map => out.push(result),
            Lambda::Reduce => acc = result,
        }
    }
    Ok(match kind {
        Lambda::Reduce => acc,
        _ => BaseValue::List(out),
    })
}
