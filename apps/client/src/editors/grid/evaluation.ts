import type { CellKey, GridSheet } from "./model";

export type FormulaError =
  | "parse"
  | "reference"
  | "division_by_zero"
  | "value"
  | "name"
  | "cycle";

export type CellValue =
  | { readonly kind: "blank" }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "error"; readonly value: FormulaError };

export interface EvaluatedCell {
  readonly value: CellValue;
  readonly dependencies: readonly CellKey[];
}

export interface SheetEvaluation {
  readonly cells: ReadonlyMap<string, EvaluatedCell>;
}

interface A1Reference {
  readonly row: number;
  readonly column: number;
}

type UnaryOperator = "+" | "-";
type BinaryOperator = "=" | "<>" | "<" | "<=" | ">" | ">=" | "&" | "+" | "-" | "*" | "/" | "^";
type SymbolToken = BinaryOperator | "(" | ")" | "," | ":";

type Expression =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "reference"; readonly value: A1Reference }
  | { readonly kind: "range"; readonly from: A1Reference; readonly to: A1Reference }
  | { readonly kind: "unary"; readonly operator: UnaryOperator; readonly value: Expression }
  | {
      readonly kind: "binary";
      readonly operator: BinaryOperator;
      readonly left: Expression;
      readonly right: Expression;
    }
  | { readonly kind: "call"; readonly name: string; readonly arguments: readonly Expression[] };

type Token =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "identifier"; readonly value: string }
  | { readonly kind: "reference"; readonly value: A1Reference }
  | { readonly kind: "symbol"; readonly value: SymbolToken }
  | { readonly kind: "end" };

class FormulaSyntaxError extends Error {}

function identity(key: CellKey): string {
  return `${key.row}\u0000${key.column}`;
}

function reference(source: string): A1Reference | null {
  const compact = source.replaceAll("$", "");
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(compact);
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  const row = Number(match[2]);
  if (!Number.isSafeInteger(row) || row < 1 || column < 1) return null;
  return { row, column };
}

class Lexer {
  private cursor = 0;

  constructor(private readonly source: string) {}

  tokens(): Token[] {
    const tokens: Token[] = [];
    while (true) {
      const token = this.next();
      tokens.push(token);
      if (token.kind === "end") return tokens;
    }
  }

  private next(): Token {
    while (/\s/u.test(this.source[this.cursor] ?? "")) this.cursor += 1;
    const character = this.source[this.cursor];
    if (character === undefined) return { kind: "end" };
    this.cursor += 1;
    if (character === '"') return this.string();
    if (/[0-9.]/u.test(character)) return this.number(character);
    if (/[$A-Za-z_]/u.test(character)) return this.word(character);
    if (character === ";") return { kind: "symbol", value: "," };
    if (character === "!" && this.take("=")) return { kind: "symbol", value: "<>" };
    if (character === "<" && this.take("=")) return { kind: "symbol", value: "<=" };
    if (character === "<" && this.take(">")) return { kind: "symbol", value: "<>" };
    if (character === ">" && this.take("=")) return { kind: "symbol", value: ">=" };
    if (character === "=") {
      this.take("=");
      return { kind: "symbol", value: "=" };
    }
    if ("+-*/^&<>(),:".includes(character)) {
      return { kind: "symbol", value: character as SymbolToken };
    }
    throw new FormulaSyntaxError();
  }

  private take(character: string): boolean {
    if (this.source[this.cursor] !== character) return false;
    this.cursor += 1;
    return true;
  }

  private string(): Token {
    let value = "";
    while (this.cursor < this.source.length) {
      const character = this.source[this.cursor++];
      if (character !== '"') {
        value += character;
        continue;
      }
      if (this.take('"')) {
        value += '"';
        continue;
      }
      return { kind: "text", value };
    }
    throw new FormulaSyntaxError();
  }

  private number(first: string): Token {
    const start = this.cursor - 1;
    if (first === "." && !/[0-9]/u.test(this.source[this.cursor] ?? "")) {
      throw new FormulaSyntaxError();
    }
    while (/[0-9]/u.test(this.source[this.cursor] ?? "")) this.cursor += 1;
    if (this.take(".")) {
      while (/[0-9]/u.test(this.source[this.cursor] ?? "")) this.cursor += 1;
    }
    if (/[eE]/u.test(this.source[this.cursor] ?? "")) {
      this.cursor += 1;
      if (/[+-]/u.test(this.source[this.cursor] ?? "")) this.cursor += 1;
      const exponent = this.cursor;
      while (/[0-9]/u.test(this.source[this.cursor] ?? "")) this.cursor += 1;
      if (exponent === this.cursor) throw new FormulaSyntaxError();
    }
    const value = Number(this.source.slice(start, this.cursor));
    if (!Number.isFinite(value)) throw new FormulaSyntaxError();
    return { kind: "number", value };
  }

  private word(first: string): Token {
    const start = this.cursor - 1;
    while (/[$A-Za-z0-9_.]/u.test(this.source[this.cursor] ?? "")) this.cursor += 1;
    const source = this.source.slice(start, this.cursor);
    const parsedReference = reference(source);
    if (parsedReference) return { kind: "reference", value: parsedReference };
    if (first === "$") throw new FormulaSyntaxError();
    return { kind: "identifier", value: source.toUpperCase() };
  }
}

class Parser {
  private readonly tokens: readonly Token[];
  private cursor = 0;

  constructor(source: string) {
    this.tokens = new Lexer(source).tokens();
  }

  parse(): Expression {
    if (this.tokens.length === 1) throw new FormulaSyntaxError();
    const expression = this.comparison();
    if (this.peek().kind !== "end") throw new FormulaSyntaxError();
    return expression;
  }

  private comparison(): Expression {
    let expression = this.concatenation();
    while (this.isSymbol("=", "<>", "<", "<=", ">", ">=")) {
      const operator = this.advanceSymbol() as BinaryOperator;
      expression = { kind: "binary", operator, left: expression, right: this.concatenation() };
    }
    return expression;
  }

  private concatenation(): Expression {
    let expression = this.term();
    while (this.isSymbol("&")) {
      this.cursor += 1;
      expression = { kind: "binary", operator: "&", left: expression, right: this.term() };
    }
    return expression;
  }

  private term(): Expression {
    let expression = this.factor();
    while (this.isSymbol("+", "-")) {
      const operator = this.advanceSymbol() as BinaryOperator;
      expression = { kind: "binary", operator, left: expression, right: this.factor() };
    }
    return expression;
  }

  private factor(): Expression {
    let expression = this.power();
    while (this.isSymbol("*", "/")) {
      const operator = this.advanceSymbol() as BinaryOperator;
      expression = { kind: "binary", operator, left: expression, right: this.power() };
    }
    return expression;
  }

  private power(): Expression {
    const expression = this.unary();
    if (!this.isSymbol("^")) return expression;
    this.cursor += 1;
    return { kind: "binary", operator: "^", left: expression, right: this.power() };
  }

  private unary(): Expression {
    if (!this.isSymbol("+", "-")) return this.primary();
    const operator = this.advanceSymbol() as UnaryOperator;
    return { kind: "unary", operator, value: this.unary() };
  }

  private primary(): Expression {
    const token = this.advance();
    if (token.kind === "number" || token.kind === "text") return token;
    if (token.kind === "reference") {
      if (!this.isSymbol(":")) return token;
      this.cursor += 1;
      const to = this.advance();
      if (to.kind !== "reference") throw new FormulaSyntaxError();
      return { kind: "range", from: token.value, to: to.value };
    }
    if (token.kind === "identifier" && this.isSymbol("(")) {
      this.cursor += 1;
      const arguments_: Expression[] = [];
      if (!this.isSymbol(")")) {
        while (true) {
          arguments_.push(this.comparison());
          if (!this.isSymbol(",")) break;
          this.cursor += 1;
        }
      }
      if (!this.isSymbol(")")) throw new FormulaSyntaxError();
      this.cursor += 1;
      return { kind: "call", name: token.value, arguments: arguments_ };
    }
    if (token.kind === "symbol" && token.value === "(") {
      const expression = this.comparison();
      if (!this.isSymbol(")")) throw new FormulaSyntaxError();
      this.cursor += 1;
      return expression;
    }
    throw new FormulaSyntaxError();
  }

  private peek(): Token {
    return this.tokens[this.cursor] ?? { kind: "end" };
  }

  private advance(): Token {
    return this.tokens[this.cursor++] ?? { kind: "end" };
  }

  private advanceSymbol(): string {
    const token = this.advance();
    if (token.kind !== "symbol") throw new FormulaSyntaxError();
    return token.value;
  }

  private isSymbol(...values: readonly string[]): boolean {
    const token = this.peek();
    return token.kind === "symbol" && values.includes(token.value);
  }
}

const BLANK: CellValue = { kind: "blank" };

function error(value: FormulaError): CellValue {
  return { kind: "error", value };
}

class Evaluator {
  private readonly inputs = new Map<string, string>();
  private readonly states = new Map<string, "visiting" | EvaluatedCell>();

  constructor(private readonly sheet: GridSheet) {
    for (const cell of sheet.cells) this.inputs.set(identity(cell), cell.input);
  }

  evaluate(): SheetEvaluation {
    for (const key of this.inputs.keys()) this.evaluateIdentity(key);
    const cells = new Map<string, EvaluatedCell>();
    for (const [key, state] of this.states) {
      if (state !== "visiting") cells.set(key, state);
    }
    return { cells };
  }

  private evaluateIdentity(key: string): CellValue {
    const state = this.states.get(key);
    if (state === "visiting") return error("cycle");
    if (state) return state.value;
    const input = this.inputs.get(key);
    if (input === undefined) return BLANK;
    this.states.set(key, "visiting");
    const dependencies = new Map<string, CellKey>();
    let value: CellValue;
    if (input.startsWith("=")) {
      try {
        value = this.expression(new Parser(input.slice(1)).parse(), dependencies);
      } catch {
        value = error("parse");
      }
    } else if (input === "") {
      value = BLANK;
    } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(input)) {
      value = { kind: "number", value: Number(input) };
    } else {
      value = { kind: "text", value: input };
    }
    const evaluated = {
      value,
      dependencies: [...dependencies.values()].sort((left, right) =>
        left.row.localeCompare(right.row) || left.column.localeCompare(right.column),
      ),
    };
    this.states.set(key, evaluated);
    return value;
  }

  private expression(expression: Expression, dependencies: Map<string, CellKey>): CellValue {
    switch (expression.kind) {
      case "number":
      case "text":
        return expression;
      case "reference": {
        const key = this.keyFor(expression.value);
        if (!key) return error("reference");
        dependencies.set(identity(key), key);
        return this.evaluateIdentity(identity(key));
      }
      case "range":
        return error("value");
      case "unary": {
        const value = this.expression(expression.value, dependencies);
        if (value.kind === "error") return value;
        if (value.kind !== "number") return error("value");
        return { kind: "number", value: expression.operator === "-" ? -value.value : value.value };
      }
      case "binary": {
        const left = this.expression(expression.left, dependencies);
        if (left.kind === "error") return left;
        const right = this.expression(expression.right, dependencies);
        if (right.kind === "error") return right;
        return binary(expression.operator, left, right);
      }
      case "call":
        return this.call(expression.name, expression.arguments, dependencies);
    }
  }

  private call(
    name: string,
    arguments_: readonly Expression[],
    dependencies: Map<string, CellKey>,
  ): CellValue {
    if (name === "IF") {
      if (arguments_.length !== 3) return error("value");
      const condition = truthy(this.expression(arguments_[0], dependencies));
      if (typeof condition !== "boolean") return condition;
      return this.expression(arguments_[condition ? 1 : 2], dependencies);
    }
    if (name !== "SUM" && name !== "AVERAGE" && name !== "MIN" && name !== "MAX") {
      return error("name");
    }
    const numbers: number[] = [];
    for (const argument of arguments_) {
      const collected = this.collectNumbers(argument, dependencies, numbers);
      if (collected) return error(collected);
    }
    if (name === "SUM") return { kind: "number", value: numbers.reduce((sum, value) => sum + value, 0) };
    if (name === "AVERAGE") {
      return numbers.length === 0
        ? error("division_by_zero")
        : { kind: "number", value: numbers.reduce((sum, value) => sum + value, 0) / numbers.length };
    }
    if (name === "MIN") return { kind: "number", value: numbers.length === 0 ? 0 : Math.min(...numbers) };
    return { kind: "number", value: numbers.length === 0 ? 0 : Math.max(...numbers) };
  }

  private collectNumbers(
    expression: Expression,
    dependencies: Map<string, CellKey>,
    numbers: number[],
  ): FormulaError | null {
    if (expression.kind === "range") {
      const keys = this.keysInRange(expression.from, expression.to);
      if (!keys) return "reference";
      for (const key of keys) {
        dependencies.set(identity(key), key);
        const value = this.evaluateIdentity(identity(key));
        if (value.kind === "number") numbers.push(value.value);
        else if (value.kind === "boolean") return "value";
        else if (value.kind === "error") return value.value;
      }
      return null;
    }
    const value = this.expression(expression, dependencies);
    if (value.kind === "number") numbers.push(value.value);
    else if (value.kind === "boolean") return "value";
    else if (value.kind === "error") return value.value;
    return null;
  }

  private keyFor(value: A1Reference): CellKey | null {
    const row = this.sheet.rows[value.row - 1];
    const column = this.sheet.columns[value.column - 1];
    return row && column ? { row: row.id, column: column.id } : null;
  }

  private keysInRange(from: A1Reference, to: A1Reference): CellKey[] | null {
    const rowStart = Math.min(from.row, to.row) - 1;
    const rowEnd = Math.max(from.row, to.row);
    const columnStart = Math.min(from.column, to.column) - 1;
    const columnEnd = Math.max(from.column, to.column);
    if (rowStart < 0 || columnStart < 0 || rowEnd > this.sheet.rows.length || columnEnd > this.sheet.columns.length) {
      return null;
    }
    const keys: CellKey[] = [];
    for (let row = rowStart; row < rowEnd; row += 1) {
      for (let column = columnStart; column < columnEnd; column += 1) {
        keys.push({ row: this.sheet.rows[row].id, column: this.sheet.columns[column].id });
      }
    }
    return keys;
  }
}

function truthy(value: CellValue): boolean | CellValue {
  if (value.kind === "boolean") return value.value;
  if (value.kind === "number") return value.value !== 0;
  if (value.kind === "blank") return false;
  return value.kind === "error" ? value : error("value");
}

function binary(operator: BinaryOperator, left: CellValue, right: CellValue): CellValue {
  if (operator === "&") return { kind: "text", value: displayCellValue(left) + displayCellValue(right) };
  if (["=", "<>", "<", "<=", ">", ">="].includes(operator)) {
    if (left.kind !== right.kind || !["number", "text", "boolean", "blank"].includes(left.kind)) {
      return error("value");
    }
    const leftValue = left.kind === "blank" ? 0 : left.value;
    const rightValue = right.kind === "blank" ? 0 : right.value;
    let comparison = 0;
    if (leftValue < rightValue) comparison = -1;
    else if (leftValue > rightValue) comparison = 1;
    const value =
      operator === "=" ? comparison === 0
        : operator === "<>" ? comparison !== 0
          : operator === "<" ? comparison < 0
            : operator === "<=" ? comparison <= 0
              : operator === ">" ? comparison > 0
                : comparison >= 0;
    return { kind: "boolean", value };
  }
  if (left.kind !== "number" || right.kind !== "number") return error("value");
  if (operator === "+") return { kind: "number", value: left.value + right.value };
  if (operator === "-") return { kind: "number", value: left.value - right.value };
  if (operator === "*") return { kind: "number", value: left.value * right.value };
  if (operator === "/") {
    return right.value === 0 ? error("division_by_zero") : { kind: "number", value: left.value / right.value };
  }
  return { kind: "number", value: left.value ** right.value };
}

export function evaluateSheet(sheet: GridSheet): SheetEvaluation {
  return new Evaluator(sheet).evaluate();
}

export function evaluatedCell(evaluation: SheetEvaluation, key: CellKey): EvaluatedCell | undefined {
  return evaluation.cells.get(identity(key));
}

export function displayCellValue(value: CellValue): string {
  switch (value.kind) {
    case "blank":
      return "";
    case "number":
      return String(value.value);
    case "text":
      return value.value;
    case "boolean":
      return value.value ? "TRUE" : "FALSE";
    case "error":
      return {
        parse: "#PARSE!",
        reference: "#REF!",
        division_by_zero: "#DIV/0!",
        value: "#VALUE!",
        name: "#NAME?",
        cycle: "#CYCLE!",
      }[value.value];
  }
}
