//! Export-time implicit-intersection analysis, without evaluating the workbook.
//!
//! A range is harmless in SUM, but not in SQRT or arithmetic. Keep the result's shape separate
//! from affected operations inside it: SUM(range * range) returns a scalar yet needs array
//! evaluation. Legacy array-aware contexts such as SUMPRODUCT already preserve those operations.

use std::collections::HashSet;

use gridcraft_core::CellRef;
use gridcraft_formula::{BinOp, Expr, SheetSel, StructItem, UnOp};
use gridcraft_model::{Formula, Workbook};

#[derive(Clone, Copy, Default)]
struct Shape {
    array: bool,
    affected: bool,
}

impl Shape {
    fn array() -> Self {
        Self { array: true, affected: false }
    }
}

pub(crate) fn needs_array(wb: &Workbook, sheet: usize, at: CellRef, formula: &Formula) -> bool {
    let Some(expr) = formula.expr_arc() else { return false };
    // The budget covers every node of a formula as long as Excel allows (8,192 characters make
    // at most about 8,200 nodes), so only names that expand a lot fall back to array evaluation.
    let mut scan = Scan { wb, at, remaining: 16_384, locals: Vec::new(), lift: None, unsure: false };
    let shape = scan.expr(&expr, sheet, false, 0);
    // An explicit `@` is written as `_xlfn.SINGLE`, which only dynamic-array formulas carry.
    let mut at = false;
    expr.walk(&mut |e| at |= matches!(e, Expr::Unary(UnOp::At, _)));
    shape.array || shape.affected || at
}

/// How a formula saved without dynamic-array metadata reads in dynamic-array terms: `formula`
/// with an implicit intersection `@` wherever Excel evaluates a range or an array as one value
/// (`C7+G7:J7` is `C7+@G7:J7`). `None` when the analysis cannot finish.
///
/// Excel shows a legacy formula the same way, and evaluating the `@` form gives the legacy
/// result instead of a spill.
pub(crate) fn lift_legacy(wb: &Workbook, sheet: usize, at: CellRef, expr: &Expr) -> Option<Expr> {
    let mut scan = Scan { wb, at, remaining: 16_384, locals: Vec::new(), lift: Some(Lift::default()), unsure: false };
    let mut shape = scan.expr(expr, sheet, false, 0);
    scan.intersect(expr, &mut shape, false);
    let lift = scan.lift.take()?;
    if scan.unsure {
        return None;
    }
    if lift.at.is_empty() {
        return Some(expr.clone());
    }
    // `Expr::map` rewrites bottom-up in the order of `postorder`.
    let mut order = Vec::new();
    postorder(expr, &mut order);
    let mut wrap = order.into_iter().map(|e| lift.at.contains(&e));
    Some(expr.clone().map(&mut |x| {
        if !wrap.next().unwrap_or(false) {
            return x;
        }
        // `@` binds tighter than any operator: an operation keeps its parentheses.
        let x = match x {
            Expr::Ref(_) | Expr::Name(_) | Expr::Struct(_) | Expr::Call(_, _) | Expr::Paren(_) | Expr::Array(_) => x,
            x => Expr::Paren(Box::new(x)),
        };
        Expr::Unary(UnOp::At, Box::new(x))
    }))
}

/// Lifts every formula of `wb` read without dynamic-array metadata (see [`lift_legacy`]).
/// A formula the analysis cannot finish stays as the file wrote it, and is saved back the same
/// way, without dynamic-array metadata (the `formula.legacy` source of its sheet).
pub(crate) fn lift_legacy_formulas(wb: &mut Workbook) {
    for si in 0..wb.sheets.len() {
        let mut unsure = std::collections::BTreeSet::new();
        let fixed: Vec<_> = wb.sheets[si]
            .cells
            .iter()
            .filter_map(|(c, cell)| {
                let f = cell.formula.as_ref()?;
                if f.dynamic || f.array.is_some() {
                    return None;
                }
                let e = f.expr_arc()?;
                let Some(lifted) = lift_legacy(wb, si, c, &e) else {
                    unsure.insert(f.text.clone());
                    return None;
                };
                (lifted != *e).then(|| (c, Formula::from_expr(lifted)))
            })
            .collect();
        if fixed.is_empty() && unsure.is_empty() {
            continue;
        }
        let sheet = std::sync::Arc::make_mut(&mut wb.sheets[si]);
        if !unsure.is_empty() {
            let p = std::sync::Arc::make_mut(sheet.preserved.get_or_insert_with(Default::default));
            for text in unsure {
                p.sources.push(gridcraft_model::PreservedSource {
                    slot: "formula.legacy".into(),
                    model: text,
                    data: std::sync::Arc::from(Vec::new()),
                });
            }
        }
        for (c, f) in fixed {
            if let Some(cell) = sheet.cells.get_mut(c) {
                cell.formula = Some(std::sync::Arc::new(f));
            }
        }
    }
}

/// The expression to save without dynamic-array metadata, when Excel reads it back as
/// `formula` means it: its `@` all stand where a legacy formula intersects anyway. `None` when
/// the formula needs dynamic-array metadata or is already marked.
pub(crate) fn legacy_form(wb: &Workbook, sheet: usize, at: CellRef, formula: &Formula) -> Option<Expr> {
    if formula.dynamic || formula.array.is_some() {
        return None;
    }
    let expr = formula.expr_arc()?;
    let bare = expr.as_ref().clone().map(&mut |x| match x {
        // Without its `@` a reference operation binds tighter than anything around it, so the
        // parentheses that lifting adds go too.
        Expr::Unary(UnOp::At, x) => match *x {
            Expr::Paren(inner) if reference_operation(&inner) => *inner,
            x => x,
        },
        x => x,
    });
    (lift_legacy(wb, sheet, at, &bare)? == *expr).then_some(bare)
}

/// A reference operation that [`lift_legacy`] parenthesizes under its `@` (a union keeps its
/// parentheses, which separate it from the arguments around it).
fn reference_operation(e: &Expr) -> bool {
    matches!(e, Expr::Binary(BinOp::Range | BinOp::Intersect, _, _) | Expr::Unary(UnOp::Spill | UnOp::Trim(_), _))
}

/// Nodes in the order [`Expr::map`] rewrites them: children left to right, then the parent.
fn postorder(e: &Expr, out: &mut Vec<*const Expr>) {
    let mut spine = Vec::new();
    let mut node = e;
    while let Expr::Binary(_, a, b) = node {
        spine.push((node, b.as_ref()));
        node = a;
    }
    match node {
        Expr::Array(rows) => rows.iter().flatten().for_each(|x| postorder(x, out)),
        Expr::Unary(_, x) | Expr::Paren(x) => postorder(x, out),
        Expr::Call(_, args) => args.iter().for_each(|x| postorder(x, out)),
        Expr::Invoke(c, args) => {
            postorder(c, out);
            args.iter().for_each(|x| postorder(x, out));
        }
        _ => {}
    }
    out.push(node);
    while let Some((n, b)) = spine.pop() {
        postorder(b, out);
        out.push(n);
    }
}

/// The nodes of the formula being lifted that take an implicit intersection.
#[derive(Default)]
struct Lift {
    at: HashSet<*const Expr>,
}

struct Scan<'a> {
    wb: &'a Workbook,
    at: CellRef,
    remaining: usize,
    locals: Vec<(String, Shape)>,
    /// Set while lifting a legacy formula (not inside a name's definition, which is not part of
    /// the formula).
    lift: Option<Lift>,
    /// The analysis did not finish, or met a parameter it does not know while lifting.
    unsure: bool,
}

impl Scan<'_> {
    /// Records an implicit intersection on `e` when lifting and `e` is an array where one value
    /// is expected; `e` is then one value.
    fn intersect(&mut self, e: &Expr, shape: &mut Shape, array_context: bool) -> bool {
        match &mut self.lift {
            Some(lift) if shape.array && !array_context => {
                lift.at.insert(e as *const Expr);
                shape.array = false;
                true
            }
            _ => false,
        }
    }

    /// Whether lifting takes argument `i` of `name`, an array where the function expects one
    /// value, as it is (for the function returns one value all the same) or with an implicit
    /// intersection. An argument nobody knows the type of leaves the formula unlifted.
    fn lift_arg(&mut self, name: &str, i: usize, arg: &Expr, shape: &mut Shape, context: bool) -> bool {
        if self.lift.is_none() || context {
            return false;
        }
        if reference_arg(name, i) {
            return true;
        }
        if passes_on(name, i) {
            // IF and its kin hand on a range as a range: their own result is intersected where
            // it meets one value.
            return false;
        }
        if scalar_arg(name, i).is_none() && !VALUE_FUNCTIONS.contains(&name) {
            self.unsure = true;
            return false;
        }
        self.intersect(arg, shape, context)
    }

    /// Analyses an expression that is not part of the formula (a name's definition).
    fn outside(&mut self, e: &Expr, sheet: usize, array_context: bool, depth: usize) -> Shape {
        let lift = self.lift.take();
        let shape = self.expr(e, sheet, array_context, depth);
        self.lift = lift;
        shape
    }

    fn expr(&mut self, e: &Expr, sheet: usize, array_context: bool, depth: usize) -> Shape {
        // Names can be cyclic, and a short chain of repeated names can expand exponentially.
        // Preserve array evaluation when analysis cannot safely finish.
        if depth >= 64 || self.remaining == 0 {
            self.unsure = true;
            return Shape { array: true, affected: true };
        }
        self.remaining -= 1;
        match e {
            Expr::Ref(r) => Shape { array: !r.range().is_single() || matches!(r.sheet, SheetSel::Span(_, _)), affected: false },
            Expr::Array(rows) => Shape { array: rows.len() > 1 || rows.first().is_some_and(|r| r.len() > 1), affected: false },
            Expr::Name(n) => {
                if let Some((_, shape)) = self.locals.iter().rev().find(|(key, _)| key.eq_ignore_ascii_case(n)) {
                    return *shape;
                }
                let (scope, bare) = match n.rsplit_once('!') {
                    Some((s, name)) => (self.wb.sheet_index(&gridcraft_core::unquote_sheet(s)).unwrap_or(sheet), name),
                    None => (sheet, n.as_str()),
                };
                if let Some(def) = self.wb.name(bare, scope) {
                    return match gridcraft_formula::parse_name(def.formula.trim_start_matches('=')) {
                        Ok(expr) => self.outside(&expr, def.scope.unwrap_or(scope), array_context, depth + 1),
                        Err(_) => Shape::array(),
                    };
                }
                Shape { array: self.wb.table(bare).is_some(), affected: false }
            }
            Expr::Struct(r) => {
                let table = if r.table.is_empty() {
                    self.wb.sheet(sheet).and_then(|s| s.table_at(self.at))
                } else {
                    self.wb.table(&r.table).and_then(|(si, ti)| self.wb.sheet(si).and_then(|s| s.tables.get(ti)))
                };
                let one_row = r.specifiers.iter().any(|s| matches!(s, StructItem::ThisRow | StructItem::Headers | StructItem::Totals));
                let one_col = match (&r.col_start, &r.col_end) {
                    (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
                    (Some(_), None) => true,
                    _ => table.is_some_and(|t| t.columns.len() == 1),
                };
                Shape { array: !(one_row && one_col), affected: false }
            }
            Expr::Paren(x) => self.expr(x, sheet, array_context, depth + 1),
            Expr::Unary(op, x) => {
                let mut child = self.expr(x, sheet, array_context, depth + 1);
                match op {
                    UnOp::At => Shape { array: false, affected: child.affected },
                    // A trim reference is a reference operator, like `:`.
                    UnOp::Spill | UnOp::Trim(_) => Shape { array: true, affected: child.affected },
                    _ => {
                        self.intersect(x, &mut child, array_context);
                        Shape { array: child.array, affected: child.affected || (child.array && !array_context) }
                    }
                }
            }
            Expr::Binary(op, a, b) => {
                // A flat chain such as A1+A2+… nests one level per operator on its left: follow
                // it in a loop, so a long chain is neither deep recursion nor past the depth
                // limit (which would write a plain sum as an array formula).
                let mut spine = vec![(e, *op, b.as_ref())];
                let mut left = a.as_ref();
                while let Expr::Binary(op, a, b) = left {
                    if self.remaining == 0 {
                        self.unsure = true;
                        return Shape { array: true, affected: true };
                    }
                    self.remaining -= 1;
                    spine.push((left, *op, b.as_ref()));
                    left = a.as_ref();
                }
                let mut acc = self.expr(left, sheet, array_context, depth + 1);
                let mut acc_node = left;
                while let Some((node, op, b_node)) = spine.pop() {
                    let mut b = self.expr(b_node, sheet, array_context, depth + 1);
                    let reference = matches!(op, BinOp::Range | BinOp::Union | BinOp::Intersect);
                    if !reference {
                        self.intersect(acc_node, &mut acc, array_context);
                        self.intersect(b_node, &mut b, array_context);
                    }
                    let array = reference || acc.array || b.array;
                    acc = Shape { array, affected: acc.affected || b.affected || (!reference && array && !array_context) };
                    acc_node = node;
                }
                acc
            }
            Expr::Call(name, args) => self.call(e, name, args, sheet, array_context, depth + 1),
            Expr::Invoke(_, _) => Shape { array: true, affected: false },
            _ => Shape::default(),
        }
    }

    fn call(&mut self, e: &Expr, name: &str, args: &[Expr], sheet: usize, array_context: bool, depth: usize) -> Shape {
        if name == "LET"
            && args.len() >= 3
            && let Some((last, bindings)) = args.split_last()
        {
            let saved = self.locals.len();
            let mut affected = false;
            for pair in bindings.as_chunks::<2>().0 {
                if let [Expr::Name(n), value] = pair {
                    let shape = self.expr(value, sheet, array_context, depth);
                    affected |= shape.affected;
                    self.locals.push((n.clone(), shape));
                }
            }
            let mut result = self.expr(last, sheet, array_context, depth);
            result.affected |= affected;
            self.locals.truncate(saved);
            return result;
        }
        let legacy_array =
            matches!(name, "SUMPRODUCT" | "MMULT" | "MINVERSE" | "MDETERM" | "TRANSPOSE" | "FREQUENCY" | "LINEST" | "LOGEST" | "TREND" | "GROWTH");
        let mut affected = false;
        let mut lifted = false;
        let mut shapes = Vec::with_capacity(args.len().min(256));
        if args.len() > 255 {
            return Shape { array: true, affected: true };
        }
        for (i, arg) in args.iter().enumerate() {
            let context = array_context || legacy_array || (name == "INDEX" && i == 0);
            let mut shape = self.expr(arg, sheet, context, depth);
            affected |= shape.affected;
            if shape.array && scalar_arg(name, i).unwrap_or(true) && !self.lift_arg(name, i, arg, &mut shape, context) {
                lifted = true;
                affected |= !context;
            }
            shapes.push(shape);
        }
        let first_array = shapes.first().is_some_and(|s| s.array);
        let array = match name {
            "INDIRECT" => match args.first() {
                Some(Expr::Text(text)) if !matches!(args.get(1), Some(Expr::Bool(false))) => {
                    gridcraft_formula::parse(text).map(|e| self.outside(&e, sheet, array_context, depth).array).unwrap_or(true)
                }
                _ => true,
            },
            "OFFSET" => {
                // Omitted dimensions retain the source reference's shape; unknown dimensions
                // might become multiple cells on a later calculation.
                if args.len() <= 3 { first_array } else { !args.get(3).is_some_and(one) || args.get(4).map_or(first_array, |e| !one(e)) }
            }
            "INDEX" => {
                let row = args.get(1);
                let col = args.get(2);
                let row_positive = row.is_some_and(|e| positive_index(e, shapes.get(1).copied()));
                let col_positive = col.is_some_and(|e| positive_index(e, shapes.get(2).copied()));
                !row_positive || col.is_some_and(|_| !col_positive) || (col.is_none() && !args.first().is_some_and(single_column))
            }
            "ROW" | "COLUMN" => {
                affected |= first_array && !array_context;
                // A legacy formula takes the first row or column of the range.
                let mut shape = Shape { array: first_array, affected };
                self.intersect(e, &mut shape, array_context);
                shape.array
            }
            "IF" | "IFERROR" | "IFNA" | "IFS" | "SWITCH" | "CHOOSE" if self.lift.is_some() => {
                shapes.iter().enumerate().any(|(i, s)| s.array && passes_on(name, i))
            }
            "IF" | "IFERROR" | "IFNA" | "IFS" | "SWITCH" | "CHOOSE" => shapes.iter().any(|s| s.array),
            "XLOOKUP" => {
                lifted
                    || match (args.get(1), args.get(2)) {
                        (Some(Expr::Ref(lookup)), Some(Expr::Ref(result))) => {
                            if lookup.range().width() == 1 {
                                result.range().width() > 1
                            } else {
                                result.range().height() > 1
                            }
                        }
                        _ => true,
                    }
            }
            "FILTER" | "SORT" | "SORTBY" | "UNIQUE" | "SEQUENCE" | "RANDARRAY" | "VSTACK" | "HSTACK" | "TOROW" | "TOCOL" | "WRAPROWS"
            | "WRAPCOLS" | "TAKE" | "DROP" | "CHOOSEROWS" | "CHOOSECOLS" | "EXPAND" | "GROUPBY" | "PIVOTBY" | "TRANSPOSE" | "MMULT" | "MINVERSE"
            | "FREQUENCY" | "LINEST" | "LOGEST" | "TREND" | "GROWTH" | "MAP" | "SCAN" | "BYROW" | "BYCOL" | "MAKEARRAY" | "ANCHORARRAY" => true,
            _ => lifted || self.wb.name(name, sheet).is_some(),
        };
        Shape { array, affected }
    }
}

fn positive(e: &Expr) -> bool {
    matches!(e, Expr::Number(n) if *n >= 1.0)
}

fn positive_index(e: &Expr, shape: Option<Shape>) -> bool {
    // MATCH returns a one-based position or an error, never INDEX's zero "whole row" selector.
    positive(e) || (matches!(e, Expr::Call(name, _) if matches!(name.as_str(), "MATCH" | "XMATCH")) && shape.is_some_and(|s| !s.array))
}

fn one(e: &Expr) -> bool {
    matches!(e, Expr::Number(n) if *n == 1.0)
}

fn single_column(e: &Expr) -> bool {
    matches!(e, Expr::Ref(r) if r.range().width() == 1)
}

/// Parameters [`scalar_arg`] counts as one value that read a reference's address instead: an
/// implicit intersection would hand them a value.
fn reference_arg(name: &str, i: usize) -> bool {
    match name {
        "CELL" => i == 1,
        "FORMULATEXT" | "ISFORMULA" | "SHEET" | "SHEETS" => i == 0,
        "GETPIVOTDATA" => i == 1,
        _ => false,
    }
}

/// The parameters of IF and its kin that hand their argument on as the result.
fn passes_on(name: &str, i: usize) -> bool {
    match name {
        "IF" | "CHOOSE" | "SWITCH" => i > 0,
        "IFERROR" | "IFNA" => true,
        "IFS" => i % 2 == 1,
        _ => false,
    }
}

/// Functions whose parameters [`scalar_arg`] does not list all take one value: a legacy formula
/// intersects a range given to any of them.
const VALUE_FUNCTIONS: &[&str] = &[
    // The conditions of IF and its kin (see [`passes_on`]).
    "IF",
    "IFS",
    "SWITCH",
    "CHOOSE",
    "ABS",
    "ACOS",
    "ACOSH",
    "ASIN",
    "ASINH",
    "ATAN",
    "ATAN2",
    "ATANH",
    "CEILING",
    "CEILING.MATH",
    "CEILING.PRECISE",
    "CHAR",
    "CLEAN",
    "CODE",
    "COMBIN",
    "COMBINA",
    "CONCATENATE",
    "COS",
    "COSH",
    "DATE",
    "DATEDIF",
    "DATEVALUE",
    "DAY",
    "DAYS",
    "DEGREES",
    "DOLLAR",
    "EDATE",
    "EOMONTH",
    "EVEN",
    "EXACT",
    "EXP",
    "FACT",
    "FACTDOUBLE",
    "FIND",
    "FIXED",
    "FLOOR",
    "FLOOR.MATH",
    "FLOOR.PRECISE",
    "HOUR",
    "INT",
    "ISBLANK",
    "ISERR",
    "ISERROR",
    "ISEVEN",
    "ISLOGICAL",
    "ISNA",
    "ISNONTEXT",
    "ISNUMBER",
    "ISODD",
    "ISOWEEKNUM",
    "ISTEXT",
    "LEFT",
    "LEN",
    "LN",
    "LOG",
    "LOG10",
    "LOWER",
    "MID",
    "MINUTE",
    "MOD",
    "MONTH",
    "MROUND",
    "N",
    "NOT",
    "NUMBERVALUE",
    "ODD",
    "PERMUT",
    "PERMUTATIONA",
    "POWER",
    "PROPER",
    "QUOTIENT",
    "RADIANS",
    "REPLACE",
    "REPT",
    "RIGHT",
    "ROUND",
    "ROUNDDOWN",
    "ROUNDUP",
    "SEARCH",
    "SECOND",
    "SIGN",
    "SIN",
    "SINH",
    "SQRT",
    "SUBSTITUTE",
    "T",
    "TAN",
    "TANH",
    "TEXT",
    "TIME",
    "TIMEVALUE",
    "TRIM",
    "TRUNC",
    "UNICHAR",
    "UNICODE",
    "UPPER",
    "VALUE",
    "WEEKDAY",
    "WEEKNUM",
    "YEAR",
    "YEARFRAC",
];

/// Legacy reference/array-taking parameters. Other parameters consume a single value.
/// This is file-format policy, not a second evaluator: unknown results are never calculated.
fn scalar_arg(name: &str, i: usize) -> Option<bool> {
    Some(match name {
        "SUM" | "AVERAGE" | "AVERAGEA" | "MIN" | "MINA" | "MAX" | "MAXA" | "COUNT" | "COUNTA" | "COUNTBLANK" | "PRODUCT" | "SUMSQ" | "MEDIAN"
        | "MODE" | "MODE.SNGL" | "STDEV" | "STDEV.S" | "STDEV.P" | "STDEVP" | "VAR" | "VAR.S" | "VAR.P" | "VARP" | "AVEDEV" | "DEVSQ" | "GEOMEAN"
        | "HARMEAN" | "KURT" | "SKEW" | "SKEW.P" | "AND" | "OR" | "XOR" | "SUMPRODUCT" | "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2" | "CORREL" | "COVAR"
        | "COVARIANCE.P" | "COVARIANCE.S" | "PEARSON" | "RSQ" | "SLOPE" | "INTERCEPT" | "STEYX" | "ROWS" | "COLUMNS" | "AREAS" | "ROW" | "COLUMN"
        | "TRANSPOSE" | "ISREF" | "MMULT" | "MINVERSE" | "MDETERM" | "FREQUENCY" | "CONCAT" | "VSTACK" | "HSTACK" | "ANCHORARRAY" => false,
        "SUMIF" | "AVERAGEIF" => i == 1,
        "COUNTIF" => i != 0,
        "SUMIFS" | "AVERAGEIFS" | "MINIFS" | "MAXIFS" => i > 0 && i.is_multiple_of(2),
        "COUNTIFS" => i % 2 == 1,
        "INDEX" | "LARGE" | "SMALL" | "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" | "QUARTILE" | "QUARTILE.INC" | "QUARTILE.EXC" | "IRR"
        | "MIRR" | "RANK" | "RANK.EQ" | "RANK.AVG" => i != if name.starts_with("RANK") { 1 } else { 0 },
        "VLOOKUP" | "HLOOKUP" | "MATCH" | "XMATCH" => i != 1,
        "LOOKUP" | "NPV" | "XNPV" | "SUBTOTAL" => i == 0,
        "XLOOKUP" => i != 1 && i != 2,
        "XIRR" => i > 1,
        "OFFSET" => i != 0,
        "AGGREGATE" | "TEXTJOIN" => i < 2,
        "FILTER" | "SORTBY" => i > 1,
        "SORT" | "UNIQUE" | "TAKE" | "DROP" | "CHOOSECOLS" | "CHOOSEROWS" | "TOROW" | "TOCOL" | "WRAPROWS" | "WRAPCOLS" | "EXPAND" => i != 0,
        "LINEST" | "LOGEST" | "TREND" | "GROWTH" => i > 1,
        "FORECAST" | "FORECAST.LINEAR" => i == 0,
        "FORECAST.ETS" | "FORECAST.ETS.CONFINT" => i != 1 && i != 2,
        "FORECAST.ETS.SEASONALITY" | "FORECAST.ETS.STAT" => i > 1,
        _ => return None,
    })
}
