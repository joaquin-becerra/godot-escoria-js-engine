// ASHES scanner: source text -> tokens, with INDENT / DEDENT / NEWLINE like
// Python. Port of escoria-core/game/core-scripts/esc/compiler/esc_scanner.gd
// (Escoria, MIT license, (c) Godot Escoria contributors).

export const T = Object.freeze({
  INDENT: "INDENT", DEDENT: "DEDENT", NEWLINE: "NEWLINE",
  COLON: "COLON", COMMA: "COMMA", DOT: "DOT", LEFT_PAREN: "LEFT_PAREN", LEFT_SQUARE: "LEFT_SQUARE",
  RIGHT_PAREN: "RIGHT_PAREN", RIGHT_SQUARE: "RIGHT_SQUARE",
  MINUS: "MINUS", PIPE: "PIPE", PLUS: "PLUS", SLASH: "SLASH", STAR: "STAR",
  BANG: "BANG", BANG_EQUAL: "BANG_EQUAL", BANG_QUESTION: "BANG_QUESTION",
  EQUAL: "EQUAL", EQUAL_EQUAL: "EQUAL_EQUAL",
  GREATER: "GREATER", GREATER_EQUAL: "GREATER_EQUAL",
  LESS: "LESS", LESS_EQUAL: "LESS_EQUAL",
  QUESTION: "QUESTION", QUESTION_BANG: "QUESTION_BANG",
  IDENTIFIER: "IDENTIFIER", STRING: "STRING", NUMBER: "NUMBER",
  ACTIVE: "ACTIVE", AND: "AND", BREAK: "BREAK", DONE: "DONE", ELIF: "ELIF", ELSE: "ELSE", FALSE: "FALSE",
  GLOBAL: "GLOBAL", IF: "IF", IN: "IN", INVENTORY: "INVENTORY", IS: "IS", NIL: "NIL", NOT: "NOT", OR: "OR",
  PASS: "PASS", RETURN: "RETURN", STOP: "STOP", TRUE: "TRUE", VAR: "VAR", WHILE: "WHILE",
  EOF: "EOF",
});

export const GLOBAL_ID_PREFIX = "$";

const KEYWORDS = {
  active: T.ACTIVE, and: T.AND, break: T.BREAK, done: T.DONE, elif: T.ELIF, else: T.ELSE, false: T.FALSE,
  global: T.GLOBAL, if: T.IF, in: T.IN, inventory: T.INVENTORY, is: T.IS, nil: T.NIL, not: T.NOT, or: T.OR,
  pass: T.PASS, stop: T.STOP, true: T.TRUE, var: T.VAR, while: T.WHILE,
};
const ESCAPE_CHARS = ['"'];
const isDigit = (c) => c >= "0" && c <= "9";
const isAlpha = (c) => /^[a-zA-Z_$]$/.test(c);
const isAlnum = (c) => /^[a-zA-Z0-9_$]$/.test(c);

/** A token: {type, lexeme, literal, line, file} */
export function scan(source, file = "", errors = []) {
  if (!source.endsWith("\n")) source += "\n";
  const tokens = [];
  let start = 0, current = 0, line = 1;
  let atStartOfLine = true, emptyLine = false;
  const indentStack = [0];

  const atEnd = () => current >= source.length;
  const advance = () => source[current++];
  const peek = () => (atEnd() ? "\0" : source[current]);
  const peekNext = () => (current + 1 >= source.length ? "\0" : source[current + 1]);
  const match = (ch) => {
    if (atEnd() || source[current] !== ch) return false;
    current++;
    return true;
  };
  const error = (msg) => errors.push(`${file || "(script)"}: line ${line}: ${msg}`);
  const add = (type, literal = null) => {
    const lexeme = type === T.INDENT || type === T.DEDENT ? "" : source.slice(start, current);
    tokens.push({ type, lexeme, literal, line, file });
  };

  const checkIndent = (level) => {
    if (level > indentStack[0]) {
      indentStack.unshift(level);
      add(T.INDENT);
    } else if (level < indentStack[0]) {
      while (indentStack[0] > level) {
        indentStack.shift();
        add(T.DEDENT);
      }
      if (indentStack[0] !== level) error("Inconsistent indent.");
    }
  };

  const string = () => {
    for (;;) {
      if (peek() === "\\" && ESCAPE_CHARS.includes(peekNext())) {
        advance();
      } else if (peek() === '"' || atEnd()) break;
      if (peek() === "\n") line++;
      advance();
    }
    if (atEnd()) return error("Unterminated string.");
    advance(); // closing "
    let value = source.slice(start + 1, current - 1);
    for (const c of ESCAPE_CHARS) value = value.split("\\" + c).join(c);
    add(T.STRING, value);
  };

  const number = () => {
    while (isDigit(peek())) advance();
    if (peek() === "." && isDigit(peekNext())) {
      advance();
      while (isDigit(peek())) advance();
    }
    add(T.NUMBER, parseFloat(source.slice(start, current)));
  };

  const identifier = () => {
    // identifiers starting with $ (global ids) may contain hyphens: $closet-door
    const hyphen = source[start] === GLOBAL_ID_PREFIX;
    while (isAlnum(peek()) || (hyphen && peek() === "-")) advance();
    const text = source.slice(start, current);
    add(Object.hasOwn(KEYWORDS, text) ? KEYWORDS[text] : T.IDENTIFIER);
  };

  while (!atEnd()) {
    start = current;
    let c = advance();
    if (atStartOfLine) {
      let level = 0;
      for (;;) {
        if (c === " ") {
          start = current;
          c = advance();
        } else if (c === "\t") {
          level++;
          start = current;
          c = advance();
        } else break;
      }
      emptyLine = c === "#" || c === "\r" || c === "\n";
      if (!emptyLine) checkIndent(level);
      atStartOfLine = false;
    }
    switch (c) {
      case "(": add(T.LEFT_PAREN); break;
      case ")": add(T.RIGHT_PAREN); break;
      case "[": add(T.LEFT_SQUARE); break;
      case "]": add(T.RIGHT_SQUARE); break;
      case ",": add(T.COMMA); break;
      case ".": add(T.DOT); break;
      case "-": add(T.MINUS); break;
      case "+": add(T.PLUS); break;
      case "*": add(T.STAR); break;
      case ":": add(T.COLON); break;
      case "/": add(T.SLASH); break;
      case "|": add(T.PIPE); break;
      case "?": add(match("!") ? T.QUESTION_BANG : T.QUESTION); break;
      case "#":
        while (peek() !== "\n" && !atEnd()) advance();
        break;
      case "\r":
      case "\n":
        if (!emptyLine) add(T.NEWLINE);
        line++;
        atStartOfLine = true;
        break;
      case "!":
        add(match("=") ? T.BANG_EQUAL : match("?") ? T.BANG_QUESTION : T.BANG);
        break;
      case "=": add(match("=") ? T.EQUAL_EQUAL : T.EQUAL); break;
      case "<": add(match("=") ? T.LESS_EQUAL : T.LESS); break;
      case ">": add(match("=") ? T.GREATER_EQUAL : T.GREATER); break;
      case " ":
      case "\t":
      case undefined: // a line of only spaces at the very end
        break;
      case '"': string(); break;
      default:
        if (isDigit(c)) number();
        else if (isAlpha(c)) identifier();
        else error(`Unexpected character: ${c}`);
    }
  }
  while (indentStack.shift() > 0) add(T.DEDENT);
  tokens.push({ type: T.EOF, lexeme: "", literal: null, line, file });
  return tokens;
}
