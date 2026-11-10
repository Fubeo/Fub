//! Il parser delle formule: dal testo a `FormulaAst`, con il tetto di
//! profondità e i nomi nudi.

use super::*;

pub(super) struct Parser<'a> {
    bytes: &'a [u8],
    source: &'a str,
    pos: usize,
    /// Livelli aperti, contro [`MAX_PARSE_DEPTH`]. Chi ne apre li riporta
    /// dove li ha trovati; un errore abbandona la formula intera.
    depth: usize,
}

impl<'a> Parser<'a> {
    pub(super) fn new(source: &'a str) -> Self {
        Self {
            bytes: source.as_bytes(),
            source,
            pos: 0,
            depth: 0,
        }
    }

    /// Apre un livello. Un anello di una catena lo lascia aperto per il
    /// resto della catena, perché l'albero a sinistra si approfondisce di uno
    /// per anello anche senza ricorsione.
    fn deeper(&mut self) -> Result<(), String> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            Err("annidamento eccessivo".to_string())
        } else {
            Ok(())
        }
    }

    /// Esegue `parse` un livello più in basso.
    fn nested<T>(
        &mut self,
        parse: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        let entry = self.depth;
        self.deeper()?;
        let parsed = parse(self)?;
        self.depth = entry;
        Ok(parsed)
    }

    fn skip_ws(&mut self) {
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    pub(super) fn parse_expr(&mut self) -> Result<FormulaAst, String> {
        self.parse_binary(1)
    }

    /// Gli operatori binari per precedenza, dal più debole: una catena a
    /// sinistra di operandi legati da operatori di precedenza almeno `min`.
    /// Una funzione sola per tutte le precedenze, e non una per livello:
    /// ogni parentesi ripete la discesa, e in debug sei frame di catena per
    /// parentesi esaurivano la pila di un thread prima del tetto.
    fn parse_binary(&mut self, min: u8) -> Result<FormulaAst, String> {
        let entry = self.depth;
        let mut left = self.parse_unary()?;
        loop {
            self.skip_ws();
            let Some((op, precedence, len)) = self.peek_binary().filter(|(_, p, _)| *p >= min)
            else {
                self.depth = entry;
                return Ok(left);
            };
            self.pos += len;
            self.deeper()?;
            let right = self.parse_binary(precedence + 1)?;
            left = FormulaAst::Binary(op, Box::new(left), Box::new(right));
        }
    }

    /// L'operatore binario alla posizione corrente, con la sua precedenza e
    /// la sua lunghezza, senza consumarlo. `>=` e `<=` prima di `>` e `<`;
    /// un `!` da solo non è binario.
    fn peek_binary(&self) -> Option<(BinaryOp, u8, usize)> {
        let rest = self.bytes.get(self.pos..)?;
        let two = |op, precedence| Some((op, precedence, 2));
        let one = |op, precedence| Some((op, precedence, 1));
        match rest {
            [b'|', b'|', ..] => two(BinaryOp::Or, 1),
            [b'&', b'&', ..] => two(BinaryOp::And, 2),
            [b'=', b'=', ..] => two(BinaryOp::Eq, 3),
            [b'!', b'=', ..] => two(BinaryOp::NotEq, 3),
            [b'>', b'=', ..] => two(BinaryOp::Gte, 4),
            [b'<', b'=', ..] => two(BinaryOp::Lte, 4),
            [b'>', ..] => one(BinaryOp::Gt, 4),
            [b'<', ..] => one(BinaryOp::Lt, 4),
            [b'+', ..] => one(BinaryOp::Add, 5),
            [b'-', ..] => one(BinaryOp::Sub, 5),
            [b'*', ..] => one(BinaryOp::Mul, 6),
            [b'/', ..] => one(BinaryOp::Div, 6),
            [b'%', ..] => one(BinaryOp::Mod, 6),
            _ => None,
        }
    }

    fn parse_unary(&mut self) -> Result<FormulaAst, String> {
        self.skip_ws();
        // `!=` è già stato consumato sopra; qui `!` è negazione.
        let op = if self.eat('-') {
            UnaryOp::Minus
        } else if self.eat('+') {
            UnaryOp::Plus
        } else if self.eat('!') {
            UnaryOp::Not
        } else {
            return self.parse_postfix();
        };
        let operand = self.nested(Self::parse_unary)?;
        Ok(FormulaAst::Unary(op, Box::new(operand)))
    }

    fn parse_postfix(&mut self) -> Result<FormulaAst, String> {
        let entry = self.depth;
        let mut node = self.parse_primary()?;
        loop {
            self.skip_ws();
            if self.eat('.') {
                self.deeper()?;
                let field = self.parse_ident()?;
                // Chiamata metodo `x.f(...)`: zucchero per `f(x, ...)`.
                self.skip_ws();
                if self.eat('(') {
                    let mut args = vec![node];
                    args.extend(self.parse_args()?);
                    node = FormulaAst::Call(field, args);
                } else {
                    node = FormulaAst::Field(Box::new(node), field);
                }
            } else {
                self.depth = entry;
                return Ok(node);
            }
        }
    }

    fn parse_primary(&mut self) -> Result<FormulaAst, String> {
        self.skip_ws();
        if self.eat('(') {
            let inner = self.nested(Self::parse_expr)?;
            self.skip_ws();
            if !self.eat(')') {
                return Err("`)` attesa".to_string());
            }
            return Ok(inner);
        }
        if self.eat('[') {
            return self.nested(Self::parse_list);
        }
        self.parse_atom()
    }

    /// Il resto di [`Self::parse_primary`]: letterali, riferimenti e
    /// chiamate. Sta in una funzione sua perché i suoi locali (testi,
    /// identificatori, messaggi) non pesino sul frame che ogni parentesi
    /// ripete: in debug quel frame era il grosso della pila di `((((…))))`.
    fn parse_atom(&mut self) -> Result<FormulaAst, String> {
        if let Some(text) = self.parse_string()? {
            return Ok(FormulaAst::Text(text));
        }
        if let Some(number) = self.parse_number() {
            return Ok(FormulaAst::Number(number));
        }
        if self.eat_keyword("true") {
            return Ok(FormulaAst::Bool(true));
        }
        if self.eat_keyword("false") {
            return Ok(FormulaAst::Bool(false));
        }
        if self.eat_keyword("empty") {
            return Ok(FormulaAst::Empty);
        }
        // Identificatore: namespaceeref (`prop.x`), chiamata o errore nome.
        let ident = self.parse_ident()?;
        self.skip_ws();
        if self.eat('(') {
            let args = self.nested(Self::parse_args)?;
            return Ok(FormulaAst::Call(ident, args));
        }
        if matches!(ident.as_str(), "prop" | "file" | "container" | "formula") {
            self.skip_ws();
            if !self.eat('.') {
                return Err(format!("`{ident}.<nome>` atteso"));
            }
            let name = self.parse_ident()?;
            let reference = match ident.as_str() {
                "prop" => FormulaRef::Prop(name),
                "file" => FormulaRef::File(name),
                "container" => FormulaRef::Container(name),
                "formula" => FormulaRef::Formula(name),
                _ => unreachable!(),
            };
            return Ok(FormulaAst::Ref(reference));
        }
        // Nome nudo: scorciatoia per `prop.<nome>` (come nelle basi: `status`).
        if is_bare_name(&ident) {
            return Ok(FormulaAst::Ref(FormulaRef::Prop(ident)));
        }
        Err(format!("nome sconosciuto `{ident}`"))
    }

    /// Gli elementi di una lista, dopo la `[`.
    fn parse_list(&mut self) -> Result<FormulaAst, String> {
        let mut items = Vec::new();
        self.skip_ws();
        if self.eat(']') {
            return Ok(FormulaAst::List(items));
        }
        loop {
            items.push(self.parse_expr()?);
            self.skip_ws();
            if self.eat(',') {
                continue;
            }
            if self.eat(']') {
                return Ok(FormulaAst::List(items));
            }
            return Err("`,` o `]` attesi in lista".to_string());
        }
    }

    fn parse_args(&mut self) -> Result<Vec<FormulaAst>, String> {
        let mut args = Vec::new();
        self.skip_ws();
        if self.eat(')') {
            return Ok(args);
        }
        loop {
            args.push(self.parse_expr()?);
            self.skip_ws();
            if self.eat(',') {
                continue;
            }
            if self.eat(')') {
                return Ok(args);
            }
            return Err("`,` o `)` attesi in chiamata".to_string());
        }
    }

    fn parse_ident(&mut self) -> Result<String, String> {
        self.skip_ws();
        let start = self.pos;
        while self.pos < self.bytes.len()
            && (self.bytes[self.pos].is_ascii_alphanumeric() || self.bytes[self.pos] == b'_')
        {
            self.pos += 1;
        }
        if start == self.pos {
            return Err("identificatore atteso".to_string());
        }
        Ok(self.source[start..self.pos].to_string())
    }

    fn parse_string(&mut self) -> Result<Option<String>, String> {
        self.skip_ws();
        let quote = match self.bytes.get(self.pos) {
            Some(b'"') => b'"',
            Some(b'\'') => b'\'',
            _ => return Ok(None),
        };
        self.pos += 1;
        let mut out = String::new();
        while let Some(&b) = self.bytes.get(self.pos) {
            if b == quote {
                self.pos += 1;
                return Ok(Some(out));
            }
            if b == b'\\' {
                self.pos += 1;
                match self.bytes.get(self.pos) {
                    Some(b'n') => out.push('\n'),
                    Some(b't') => out.push('\t'),
                    Some(b'\\') => out.push('\\'),
                    Some(b'"') => out.push('"'),
                    Some(b'\'') => out.push('\''),
                    Some(other) => {
                        return Err(format!("escape non valido `\\{}`", *other as char));
                    }
                    None => return Err("stringa non chiusa".to_string()),
                }
                self.pos += 1;
            } else {
                let ch_start = self.pos;
                let ch = self.source[ch_start..]
                    .chars()
                    .next()
                    .ok_or_else(|| "stringa non chiusa".to_string())?;
                out.push(ch);
                self.pos += ch.len_utf8();
            }
        }
        Err("stringa non chiusa".to_string())
    }

    fn parse_number(&mut self) -> Option<f64> {
        self.skip_ws();
        let start = self.pos;
        let mut seen_digit = false;
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
            self.pos += 1;
            seen_digit = true;
        }
        if self.pos < self.bytes.len() && self.bytes[self.pos] == b'.' {
            // `1.` non è un numero valido qui: serve la parte frazionaria.
            if self.pos + 1 < self.bytes.len() && self.bytes[self.pos + 1].is_ascii_digit() {
                self.pos += 1;
                while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
                    self.pos += 1;
                    seen_digit = true;
                }
            }
        }
        if !seen_digit {
            self.pos = start;
            return None;
        }
        // Non consumare un identificatore che inizia con cifre (`123abc`).
        if self.pos < self.bytes.len()
            && (self.bytes[self.pos].is_ascii_alphabetic() || self.bytes[self.pos] == b'_')
        {
            self.pos = start;
            return None;
        }
        self.source[start..self.pos].parse::<f64>().ok()
    }

    fn eat_keyword(&mut self, word: &str) -> bool {
        self.skip_ws();
        let end = self.pos + word.len();
        if self.source.get(self.pos..end) != Some(word) {
            return false;
        }
        // Confine di parola: `truex` non è `true`.
        if let Some(&b) = self.bytes.get(end) {
            if b.is_ascii_alphanumeric() || b == b'_' {
                return false;
            }
        }
        self.pos = end;
        true
    }

    fn eat(&mut self, pat: impl EatPattern) -> bool {
        pat.eat(self)
    }
}

trait EatPattern {
    fn eat(self, parser: &mut Parser<'_>) -> bool;
}

impl EatPattern for char {
    fn eat(self, parser: &mut Parser<'_>) -> bool {
        if parser.bytes.get(parser.pos) == Some(&(self as u8)) {
            parser.pos += 1;
            true
        } else {
            false
        }
    }
}

impl EatPattern for &str {
    fn eat(self, parser: &mut Parser<'_>) -> bool {
        if parser.source.get(parser.pos..parser.pos + self.len()) == Some(self) {
            parser.pos += self.len();
            true
        } else {
            false
        }
    }
}

fn is_bare_name(ident: &str) -> bool {
    !ident.is_empty()
        && ident
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        && !matches!(ident, "true" | "false" | "empty")
}
