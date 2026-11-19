// ASHES parser: tokens -> statements (plain objects with a `kind`).
// Port of escoria-core/game/core-scripts/esc/compiler/esc_parser.gd
// (Escoria, MIT license, (c) Godot Escoria contributors).
//
// Statements: Event, Block, Expression, If, While, Pass, Stop, Var, Global,
//   Dialog, DialogOption, Break, Done.
// Expressions: Logical, Binary, Unary, Call, Literal, Variable, Assign,
//   Grouping, InInventory, Is.
// Where Escoria returns an ESCParseError value, this throws ParseError; the
// same places catch it (one declaration is skipped, parsing goes on).
import { T, GLOBAL_ID_PREFIX } from "./scanner.js";

class ParseError extends Error {}

export const FLAG_TK = 1, FLAG_NO_TT = 2, FLAG_NO_UI = 4, FLAG_NO_SAVE = 8;
const FLAG_BITS = { TK: FLAG_TK, NO_TT: FLAG_NO_TT, NO_UI: FLAG_NO_UI, NO_SAVE: FLAG_NO_SAVE };

export function parse(tokens, objectGlobalId = "", errors = []) {
  let current = 0;
  let loopLevel = 0;
  let dialogLevel = 0;

  // ---------------------------------------------------------------- helpers
  const peek = () => tokens[current];
  const previous = () => tokens[current - 1];
  const secondPrevious = () => tokens[current - 2];
  const atEnd = () => peek().type === T.EOF;
  const advance = () => {
    if (!atEnd()) current++;
    return previous();
  };
  const check = (types) => {
    if (!Array.isArray(types)) types = [types];
    return !atEnd() && types.includes(peek().type);
  };
  // LL(2): the token after the next one
  const checkNext = (types) => {
    if (!Array.isArray(types)) types = [types];
    if (atEnd() || current + 1 >= tokens.length || tokens[current + 1].type === T.EOF) return false;
    return types.includes(tokens[current + 1].type);
  };
  const match = (types) => {
    if (check(types)) {
      advance();
      return true;
    }
    return false;
  };
  const matchInOrder = (types) => {
    const start = current;
    for (const t of types) {
      if (!check(t)) {
        current = start;
        return false;
      }
      advance();
    }
    return true;
  };
  const report = (token, message) => {
    errors.push(`${token.file || "(script)"}: line ${token.line} at '${token.lexeme}': ${message}`);
    return new ParseError(message);
  };
  const error = (token, message) => {
    throw report(token, message);
  };
  const consume = (type, message) => (check(type) ? advance() : error(peek(), message));
  const consumeNewBlockStart = (what) => {
    consume(T.NEWLINE, `Expect NEWLINE after ${what}.`);
    consume(T.INDENT, `Expect INDENT after ${what}.`);
  };
  const synchronize = () => {
    if (check(T.DEDENT)) return;
    advance();
    while (!atEnd()) {
      if (previous().type === T.NEWLINE || previous().type === T.DEDENT) return;
      if ([T.COLON, T.GLOBAL, T.VAR, T.IF, T.WHILE, T.PASS, T.STOP, T.QUESTION_BANG, T.BREAK, T.DONE, T.RETURN].includes(peek().type)) return;
      advance();
    }
  };

  // ---------------------------------------------------------------- declarations

  function declaration() {
    while (match(T.NEWLINE) || match(T.DEDENT));
    if (atEnd()) return null;
    try {
      if (match(T.COLON)) return eventDeclaration();
      if (match(T.VAR)) return varDeclaration(T.VAR);
      if (match(T.GLOBAL)) return varDeclaration(T.GLOBAL);
      return statement();
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      synchronize();
      return null;
    }
  }

  function eventDeclaration() {
    const name = consume(T.IDENTIFIER, `Expect event name. Got '${peek().lexeme}' instead.`);
    let target = null;
    if (check(T.STRING) || check(T.IDENTIFIER)) {
      const expr = primary();
      if (expr.kind === "Variable") {
        let lexeme = expr.name.lexeme;
        if (lexeme.startsWith(GLOBAL_ID_PREFIX)) lexeme = lexeme.slice(1);
        target = lexeme;
      } else target = expr.value;
    }
    const flags = {};
    let flagBits = 0;
    let hasFlags = match(T.PIPE);
    while (hasFlags) {
      const flag = consume(T.IDENTIFIER, `Event '${name.lexeme}': Expect valid flag name. Got '${peek().lexeme}' instead.`);
      let condition = null;
      if (match(T.LESS)) {
        if (!check(T.IDENTIFIER)) error(peek(), `Condition for flag '${flag.lexeme}' must be a global variable.`);
        condition = primary();
        consume(T.GREATER, `For flag '${flag.lexeme}', only one (global) variable may be used and must be enclosed between '<' and '>'.`);
      }
      flags[flag.lexeme] = condition;
      flagBits |= FLAG_BITS[flag.lexeme] || 0;
      hasFlags = match(T.PIPE);
    }
    if (matchInOrder([T.NEWLINE, T.INDENT])) {
      return { kind: "Event", name: name.lexeme, token: name, target, flags, flagBits, body: { kind: "Block", statements: block() }, objectGlobalId };
    }
    return error(peek(), `Expected block after event declaration for '${name.lexeme}'. Code blocks require tab(s) at the start of a line.`);
  }

  function varDeclaration(type) {
    const name = consume(T.IDENTIFIER, type === T.VAR ? "Expect variable name." : "Expect global variable name.");
    let init = null;
    if (match(T.EQUAL)) init = expression();
    consume(T.NEWLINE, type === T.VAR ? "Expect newline after variable declaration." : "Expect newline after global variable declaration.");
    return { kind: type === T.VAR ? "Var" : "Global", name, init };
  }

  // ---------------------------------------------------------------- statements

  function statement() {
    if (match(T.IF)) return ifStatement();
    if (match(T.WHILE)) return whileStatement();
    if (match(T.PASS)) {
      consume(T.NEWLINE, "Expected NEWLINE after pass statement.");
      return { kind: "Pass" };
    }
    if (match(T.STOP)) {
      consume(T.NEWLINE, "Expected NEWLINE after stop statement.");
      return { kind: "Stop" };
    }
    if (match(T.QUESTION_BANG)) return dialogStatement();
    if (match(T.BREAK)) {
      if (loopLevel === 0 && dialogLevel === 0) error(secondPrevious(), "'break' only allowed inside loops and dialogs");
      let levels = null;
      if (check([T.IDENTIFIER, T.NUMBER])) levels = expression();
      consume(T.NEWLINE, "Expected either expression and NEWLINE, or just NEWLINE, after break statement");
      return { kind: "Break", levels };
    }
    if (matchInOrder([T.DONE, T.NEWLINE])) {
      if (dialogLevel === 0) error(secondPrevious(), "'done' only allowed inside dialogs");
      return { kind: "Done" };
    }
    if (matchInOrder([T.NEWLINE, T.INDENT]) || (previous() && previous().type === T.NEWLINE && match(T.INDENT))) {
      return { kind: "Block", statements: block() };
    }
    const expr = expression();
    consume(T.NEWLINE, "Expect NEWLINE after expression statement.");
    return { kind: "Expression", expr };
  }

  function ifStatement() {
    const cond = expression();
    consume(T.COLON, "Expect ':' after if condition.");
    consumeNewBlockStart("start of if statement");
    const then = { kind: "Block", statements: block() };
    const elifs = [];
    while (match(T.ELIF)) {
      const c = expression();
      if (!check(T.COLON)) report(peek(), "Expect ':' after elif condition.");
      else advance();
      consumeNewBlockStart("start of elif statement");
      elifs.push({ kind: "If", cond: c, then: { kind: "Block", statements: block() }, elifs: [], else: null });
    }
    let otherwise = null;
    if (match(T.ELSE)) {
      consume(T.COLON, "Expect ':' after 'else'.");
      consumeNewBlockStart("start of else statement");
      otherwise = { kind: "Block", statements: block() };
    }
    return { kind: "If", cond, then, elifs, else: otherwise };
  }

  function whileStatement() {
    loopLevel++;
    try {
      const cond = expression();
      consume(T.COLON, "Expect ':' after condition.");
      consumeNewBlockStart("start of while loop");
      return { kind: "While", cond, body: { kind: "Block", statements: block() } };
    } finally {
      loopLevel--;
    }
  }

  function dialogStatement() {
    dialogLevel++;
    try {
      const args = [];
      if (match(T.LEFT_PAREN)) {
        for (;;) {
          args.push(expression());
          if (!match(T.COMMA)) break;
        }
        consume(T.RIGHT_PAREN, "Expect ')' after start dialog arguments.");
      } else if (!check(T.NEWLINE)) {
        for (;;) {
          args.push(expression());
          if (check(T.NEWLINE)) break;
          if (match(T.COMMA)) continue;
        }
      }
      if (args.length > 3) error(peek(), "Start dialog cannot have more than 3 arguments.");
      consumeNewBlockStart("dialog start");
      const options = [];
      for (;;) {
        options.push(dialogOption());
        if (match(T.DEDENT)) break;
      }
      return { kind: "Dialog", args, options };
    } finally {
      dialogLevel--;
    }
  }

  function dialogOption() {
    consume(T.MINUS, "Expect '-' before dialog option");
    let key = "";
    if (matchInOrder([T.IDENTIFIER, T.COLON])) key = tokens[current - 2].lexeme;
    const option = expression();
    let cond = null;
    if (match(T.LEFT_SQUARE)) {
      cond = expression();
      consume(T.RIGHT_SQUARE, "Expect ']' after dialog option condition");
    }
    consumeNewBlockStart("dialog option");
    return { kind: "DialogOption", key, option, cond, body: { kind: "Block", statements: block() } };
  }

  function block() {
    const statements = [];
    while (!check(T.DEDENT) && !atEnd()) {
      const d = declaration();
      if (d) statements.push(d);
    }
    // Escoria reports a missing DEDENT but keeps the block
    if (check(T.DEDENT)) advance();
    else report(peek(), "Expected DEDENT after block.");
    return statements;
  }

  // ---------------------------------------------------------------- expressions

  function expression() {
    return assignment();
  }

  function assignment() {
    const expr = or();
    if (match(T.EQUAL)) {
      const equals = previous();
      const value = assignment();
      if (expr.kind === "Variable") return { kind: "Assign", name: expr.name, value };
      error(equals, "Invalid assignment type.");
    }
    return expr;
  }

  function binaryLevel(next, types, kind = "Binary") {
    return () => {
      let expr = next();
      while (match(types)) {
        const op = previous();
        expr = { kind, left: expr, op, right: next() };
      }
      return expr;
    };
  }

  function comparison() {
    let expr = term();
    // flag predicates (TK<predicate>) are not comparisons
    if (check(T.GREATER) && checkNext([T.NEWLINE, T.PIPE])) return expr;
    while (match([T.GREATER, T.GREATER_EQUAL, T.LESS, T.LESS_EQUAL])) {
      const op = previous();
      expr = { kind: "Binary", left: expr, op, right: term() };
    }
    return expr;
  }

  function unary() {
    if (match([T.BANG, T.NOT, T.MINUS])) {
      const op = previous();
      return { kind: "Unary", op, right: unary() };
    }
    return contains();
  }

  function contains() {
    const expr = isChecking();
    if (match(T.IN)) {
      consume(T.INVENTORY, "Expected 'inventory' after 'in'.");
      return { kind: "InInventory", id: expr };
    }
    return expr;
  }

  function isChecking() {
    const expr = call();
    if (match(T.IS)) {
      if (match(T.ACTIVE)) return { kind: "Is", id: expr, state: null, active: previous() };
      return { kind: "Is", id: expr, state: expression(), active: null };
    }
    return expr;
  }

  function call() {
    let expr = primary();
    while (match(T.LEFT_PAREN)) {
      const args = [];
      if (!check(T.RIGHT_PAREN)) {
        do {
          if (args.length >= 255) error(peek(), "Can't have more than 255 arguments.");
          args.push(expression());
        } while (match(T.COMMA));
      }
      const paren = consume(T.RIGHT_PAREN, "Expect ')' after arguments.");
      expr = { kind: "Call", callee: expr, paren, args };
    }
    return expr;
  }

  function primary() {
    if (match(T.FALSE)) return { kind: "Literal", value: false };
    if (match(T.TRUE)) return { kind: "Literal", value: true };
    if (match(T.NIL)) return { kind: "Literal", value: null };
    if (match([T.NUMBER, T.STRING])) return { kind: "Literal", value: previous().literal };
    if (match(T.IDENTIFIER)) return { kind: "Variable", name: previous() };
    if (match(T.LEFT_PAREN)) {
      const expr = expression();
      consume(T.RIGHT_PAREN, "Expect ')' after expression.");
      return { kind: "Grouping", expr };
    }
    return error(peek(), "Expect expression.");
  }

  const term = binaryLevel(() => factor(), [T.MINUS, T.PLUS]);
  const factor = binaryLevel(unary, [T.SLASH, T.STAR]);
  const equality = binaryLevel(comparison, [T.BANG_EQUAL, T.EQUAL_EQUAL]);
  const and = binaryLevel(equality, [T.AND], "Logical");
  const or = binaryLevel(and, [T.OR], "Logical");

  const statements = [];
  while (!atEnd()) {
    const d = declaration();
    if (d) statements.push(d);
  }
  return statements;
}
