/* Fub Clipper — matcher.js
 * Linear-time pattern matcher for template `matches`/`not_matches` filters,
 * conditions and URL triggers. Arbitrary patterns NEVER reach the built-in
 * backtracking engine (a length cap cannot bound backtracking: `(a+)+$` is
 * short and catastrophic). This engine compiles the pattern to a Thompson
 * NFA and simulates it, so evaluation time is proportional to pattern x
 * text — never exponential. Zero runtime dependencies. UMD.
 *
 * Supported subset (anything else is `bad_args`, never a silent fallback):
 *   literals, `.` (any except JS line terminators), `^` `$` `\b` `\B`,
 *   `\d \D \w \W \s \S` (ASCII \w; \s = the fixed set below), `\f \n \r \t
 *   \v`, `\xHH`, `\uHHHH` (no lone surrogates), `\0` (NUL), escaped
 *   punctuation (`\.`, `\*`, …), `[...]` classes with ranges, negation and
 *   single-char class escapes, groups `(…)` / `(?:…)`, alternation `|`,
 *   quantifiers `* + ? {n} {n,} {n,m}` (lazy suffix accepted, existence is
 *   greediness-independent), leading `(?i)` for ASCII case-insensitivity
 *   (literals match either case; letter ranges span both cases; text is never
 *   lowered, so `[^A]` still rejects `a`).
 * Deliberately absent: backreferences, lookarounds, \p, \k, \c, \A\Z\z, lone
 * surrogate \uD800–\uDFFF (rejected: UTF-16 splitting is a correctness trap),
 * scoped flags. Extended classes [\d\w\s…] inside [...] are DOCUMENTED as
 * unsupported (rejected, not silently narrowed): keep parity by spelling
 * ranges explicitly.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubMatcher = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_REPEAT = 100;
  var TRANSITION_BUDGET = 2000000;

  function bad(msg) { var e = new Error("bad_args: " + msg); e.code = "bad_args"; return e; }

  function isDigit(c) { return c >= "0" && c <= "9"; }
  function hexVal(c) {
    if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
    if (c >= "a" && c <= "f") return c.charCodeAt(0) - 87;
    if (c >= "A" && c <= "F") return c.charCodeAt(0) - 55;
    return -1;
  }
  function isWord(c) {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_";
  }

  // --- parser: pattern -> fragments of NFA states ---------------------------
  function Parser(src) {
    this.src = src;
    this.pos = 0;
    this.states = [];
    this.ci = false;
  }
  Parser.prototype.peek = function () { return this.src.charAt(this.pos); };
  Parser.prototype.next = function () { return this.src.charAt(this.pos++); };
  Parser.prototype.mk = function (st) { this.states.push(st); return this.states.length - 1; };
  Parser.prototype.patch = function (outs, target) {
    for (var i = 0; i < outs.length; i++) {
      var s = this.states[outs[i]];
      if (s.t === "split") { if (s.o1 === -1) s.o1 = target; else s.o2 = target; }
      else s.o = target;
    }
  };

  // Fragment: { start, outs[] } where outs are state indices with one open edge.
  Parser.prototype.chrFrag = function (test) {
    var i = this.mk({ t: "chr", test: test, o: -1 });
    return { start: i, outs: [i] };
  };
  Parser.prototype.emptyFrag = function () {
    var i = this.mk({ t: "jmp", o: -1 });
    return { start: i, outs: [i] };
  };
  Parser.prototype.concat = function (a, b) {
    this.patch(a.outs, b.start);
    return { start: a.start, outs: b.outs };
  };
  Parser.prototype.alternate = function (a, b) {
    var s = this.mk({ t: "split", o1: a.start, o2: b.start });
    return { start: s, outs: a.outs.concat(b.outs) };
  };
  Parser.prototype.star = function (a) {
    var s = this.mk({ t: "split", o1: a.start, o2: -1 });
    this.patch(a.outs, s);
    return { start: s, outs: [s] };
  };
  Parser.prototype.plus = function (a) {
    var s = this.mk({ t: "split", o1: a.start, o2: -1 });
    this.patch(a.outs, s);
    return { start: a.start, outs: [s] };
  };
  Parser.prototype.question = function (a) {
    var s = this.mk({ t: "split", o1: a.start, o2: -1 });
    return { start: s, outs: a.outs.concat([s]) };
  };

  Parser.prototype.parseEscape = function (inClass) {
    // pos is after the backslash. In-class returns {ranges,neg?,ciAlt?};
    // outside returns {frag} or {assert}.
    if (this.pos >= this.src.length) throw bad("trailing backslash in pattern");
    var c = this.next();
    var pair = null;
    switch (c) {
      case "d": pair = [[48, 57]]; break;
      case "D": pair = [[0, 47], [58, 65535]]; break;
      case "w": pair = [[48, 57], [65, 90], [95, 95], [97, 122]]; break;
      case "W": pair = "negword"; break;
      case "s": pair = [[9, 13], [32, 32], [160, 160], [5760, 5760], [8192, 8202], [8232, 8233], [8239, 8239], [8287, 8287], [12288, 12288], [65279, 65279]]; break;
      case "S": pair = "negspace"; break;
      case "f": return this.litFrag(12, inClass);
      case "n": return this.litFrag(10, inClass);
      case "r": return this.litFrag(13, inClass);
      case "t": return this.litFrag(9, inClass);
      case "v": return this.litFrag(11, inClass);
      case "0":
        if (isDigit(this.peek())) throw bad("octal/backreference not supported");
        return this.litFrag(0, inClass);
      case "b": return inClass ? this.litFrag(8, inClass) : { assert: "wb" };
      case "B":
        if (inClass) return this.litFrag(66, inClass);
        return { assert: "nwb" };
      case "x": {
        if (this.pos + 1 >= this.src.length) throw bad("bad \\x escape");
        var h1 = hexVal(this.src.charAt(this.pos));
        var h2 = hexVal(this.src.charAt(this.pos + 1));
        if (h1 < 0 || h2 < 0) throw bad("bad \\x escape");
        this.pos += 2;
        return this.litFrag(h1 * 16 + h2, inClass);
      }
      case "u": {
        var code = 0;
        for (var i = 0; i < 4; i++) {
          if (this.pos >= this.src.length) throw bad("bad \\u escape");
          var h = hexVal(this.src.charAt(this.pos));
          this.pos++;
          if (h < 0) throw bad("bad \\u escape");
          code = code * 16 + h;
        }
        if (code >= 0xd800 && code <= 0xdfff) throw bad("lone surrogate not supported");
        return this.litFrag(code, inClass);
      }
      default:
        if (c >= "1" && c <= "9") throw bad("backreference not supported");
        if (c === "p" || c === "P" || c === "k" || c === "c") throw bad("\\" + c + " not supported");
        // Single letters are never valid escapes here: \A \Z (anchors),
        // \b (outside class) and \B are handled above; anything else (\a,
        // \e, \q, …) is rejected instead of silently mapping to a literal.
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) throw bad("\\" + c + " not supported");
        return this.litFrag(c.charCodeAt(0), inClass);
    }
    if (pair === "negword" || pair === "negspace") {
      var base = pair === "negword"
        ? [[48, 57], [65, 90], [95, 95], [97, 122]]
        : [[9, 13], [32, 32], [160, 160], [5760, 5760], [8192, 8202], [8232, 8233], [8239, 8239], [8287, 8287], [12288, 12288], [65279, 65279]];
      var f = this.setFrag(base, true);
      if (inClass) return { ranges: base, neg: true };
      return { frag: f };
    }
    var f2 = this.setFrag(pair, false);
    if (inClass) return { ranges: pair, neg: false };
    return { frag: f2 };
  };

  Parser.prototype.litFrag = function (code, inClass) {
    if (this.ci && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
      // (?i): match either case literally. Ranges are folded by expanding
      // each ASCII letter to both cases at parse (see parseClass below);
      // text is NOT lowered, so [^A] keeps rejecting 'a'.
      var one = String.fromCharCode(code);
      var other = code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : String.fromCharCode(code - 32);
      var both = this.chrFrag(function (ch) { return ch === one || ch === other; });
      if (inClass) return { ranges: [[code, code]], neg: false, ciAlt: other.charCodeAt(0) };
      return { frag: both };
    }
    var one2 = String.fromCharCode(code);
    var g = this.chrFrag(function (ch) { return ch === one2; });
    if (inClass) return { ranges: [[code, code]], neg: false };
    return { frag: g };
  };

  Parser.prototype.setFrag = function (ranges, neg) {
    var rs = ranges.map(function (r) { return [r[0], r[1]]; });
    return this.chrFrag(function (ch) {
      var c = ch.charCodeAt(0);
      var hit = false;
      for (var i = 0; i < rs.length; i++) {
        if (c >= rs[i][0] && c <= rs[i][1]) { hit = true; break; }
      }
      return neg ? !hit : hit;
    });
  };

  Parser.prototype.parseClass = function () {
    // '[' consumed.
    var neg = false;
    if (this.peek() === "^") { neg = true; this.next(); }
    var ranges = [];
    var first = true;
    var pending = null; // {code} waiting for a possible range dash
    var flush = function () { if (pending !== null) { ranges.push([pending, pending]); pending = null; } };
    for (;;) {
      if (this.pos >= this.src.length) throw bad("unterminated class");
      var c = this.peek();
      if (c === "]" && !first) { this.next(); break; }
      first = false;
      var code;
      var codeAlt = null;
      if (c === "\\") {
        // Extended classes are DOCUMENTED unsupported inside [...]: \d \w
        // \s \D \W \S would silently narrow to one member here. Reject with
        // the honest message; spell ranges explicitly ([0-9], [A-Za-z_], …).
        var nc = this.src.charAt(this.pos + 1);
        if (nc === "d" || nc === "w" || nc === "s" || nc === "D" || nc === "W" || nc === "S") {
          throw bad("\\" + nc + " inside class not supported — spell the range explicitly");
        }
        this.next();
        var r = this.parseEscape(true);
        // parseEscape(true) always returns {ranges} (or throws for negated
        // shorthands — the neg field is dead by construction: kept honest).
        flush();
        for (var i = 0; i < r.ranges.length; i++) ranges.push(r.ranges[i]);
        if (this.ci && r.ciAlt !== undefined && r.ciAlt !== null) ranges.push([r.ciAlt, r.ciAlt]);
        continue;
      } else {
        this.next();
        code = c.charCodeAt(0);
        if (this.ci && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
          codeAlt = code >= 65 && code <= 90 ? code + 32 : code - 32;
        }
      }
      if (this.peek() === "-" && this.src.charAt(this.pos + 1) !== "]" && this.pos + 1 < this.src.length) {
        this.next(); // consume '-'
        var c2 = this.peek();
        var hi;
        var hiAlt = null;
        if (c2 === "\\") {
          this.next();
          var r2 = this.parseEscape(true);
          if (r2.ranges.length !== 1 || r2.neg) throw bad("shorthand range bound not supported");
          hi = r2.ranges[0][0];
          if (this.ci && r2.ciAlt !== undefined && r2.ciAlt !== null) hiAlt = r2.ciAlt;
        } else {
          this.next();
          hi = c2.charCodeAt(0);
          if (this.ci && ((hi >= 65 && hi <= 90) || (hi >= 97 && hi <= 122))) {
            hiAlt = hi >= 65 && hi <= 90 ? hi + 32 : hi - 32;
          }
        }
        if (pending !== null) { ranges.push([pending, pending]); pending = null; }
        if (code > hi) throw bad("reversed class range");
        // (?i) honest fold: a letter range spans both cases when both ends
        // are ASCII letters (a-z, A-Z); anything else keeps the raw range
        // plus single-letter alternates so [^A] still rejects 'a' only via
        // its own negation, and [\x41-z] does not silently widen.
        var loIsLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
        var hiIsLetter = (hi >= 65 && hi <= 90) || (hi >= 97 && hi <= 122);
        if (this.ci && loIsLetter && hiIsLetter) {
          var loFold = code >= 65 && code <= 90 ? code + 32 : code - 32;
          var hiFold = hi >= 65 && hi <= 90 ? hi + 32 : hi - 32;
          var lo2 = Math.min(loFold, hiFold);
          var hi2 = Math.max(loFold, hiFold);
          // Union of both-case ranges, kept as two ranges (still linear).
          ranges.push([Math.min(code, hi), Math.max(code, hi)]);
          ranges.push([lo2, hi2]);
        } else {
          ranges.push([code, hi]);
          if (codeAlt !== null) ranges.push([codeAlt, codeAlt]);
          if (hiAlt !== null) ranges.push([hiAlt, hiAlt]);
        }
      } else {
        if (pending !== null) ranges.push([pending, pending]);
        pending = code;
        if (codeAlt !== null) ranges.push([codeAlt, codeAlt]);
      }
    }
    flush();
    return this.setFrag(ranges, neg);
  };

  Parser.prototype.parseAtom = function () {
    if (this.pos >= this.src.length) throw bad("unexpected end of pattern");
    var c = this.peek();
    if (c === "^") { this.next(); var i0 = this.mk({ t: "assert", k: "begin", o: -1 }); return { start: i0, outs: [i0] }; }
    if (c === "$") { this.next(); var i1 = this.mk({ t: "assert", k: "end", o: -1 }); return { start: i1, outs: [i1] }; }
    // \A \Z \z have no unanchored-search equivalent here: the engine tests
    // every start position, so absolute anchors would silently mean ^/$.
    // Reject instead of miscompiling.
    if (c === "\\" && (this.src.charAt(this.pos + 1) === "A" || this.src.charAt(this.pos + 1) === "Z" || this.src.charAt(this.pos + 1) === "z")) {
      throw bad("\\" + this.src.charAt(this.pos + 1) + " anchor not supported (unanchored search)");
    }
    if (c === "(") {
      this.next();
      if (this.peek() === "?") {
        this.next();
        var q = this.peek();
        if (q === ":") { this.next(); }
        else throw bad("group flag not supported (only (?:…))");
      }
      var inner = this.parseDisjunction();
      if (this.peek() !== ")") throw bad("unterminated group");
      this.next();
      return inner;
    }
    if (c === "[") {
      this.next();
      return this.parseClass();
    }
    if (c === "\\") {
      this.next();
      var r = this.parseEscape(false);
      if (r.assert) { var ia = this.mk({ t: "assert", k: r.assert, o: -1 }); return { start: ia, outs: [ia] }; }
      return r.frag;
    }
    if (c === ".") {
      this.next();
      return this.chrFrag(function (ch) { return ch !== "\n" && ch !== "\r" && ch !== "\u2028" && ch !== "\u2029"; });
    }
    if (c === ")" || c === "|" || c === "*" || c === "+" || c === "?" || c === "{") throw bad("unexpected '" + c + "'");
    this.next();
    var code = c.charCodeAt(0);
    if (this.ci) {
      if (code >= 65 && code <= 90) return this.setFrag([[code, code], [code + 32, code + 32]], false);
      if (code >= 97 && code <= 122) return this.setFrag([[code, code], [code - 32, code - 32]], false);
    }
    var lit = c;
    return this.chrFrag(function (ch) { return ch === lit; });
  };

  Parser.prototype.parseQuant = function (atom) {
    if (this.pos >= this.src.length) return atom;
    var c = this.peek();
    var frag = atom;
    if (c === "*" || c === "+" || c === "?") {
      this.next();
      if (this.peek() === "?") this.next(); // lazy suffix: existence is greediness-independent
      frag = c === "*" ? this.star(atom) : c === "+" ? this.plus(atom) : this.question(atom);
      return frag;
    }
    if (c === "{") {
      var save = this.pos;
      this.next();
      var nStr = "";
      while (isDigit(this.peek())) nStr += this.next();
      var n = nStr === "" ? -1 : Number(nStr);
      var m = n;
      if (this.peek() === ",") {
        this.next();
        var mStr = "";
        while (isDigit(this.peek())) mStr += this.next();
        m = mStr === "" ? -1 : Number(mStr);
      }
      if (this.peek() !== "}" || n < 0 || (m !== -1 && m < n)) {
        // Not a valid quantifier: literal '{' per JS semantics.
        this.pos = save;
        return atom;
      }
      this.next();
      if (this.peek() === "?") this.next();
      if (m === -1) {
        // {n,} : n copies then star. Cap the fixed prefix too: without it
        // `a{1000,}` expands a thousand fragments before the budget applies.
        if (n > MAX_REPEAT) throw bad("repetition too large");
        var f = null;
        for (var i = 0; i < n; i++) f = f ? this.concat(f, this.cloneFrag(atom)) : this.cloneFrag(atom);
        var st = this.star(this.cloneFrag(atom));
        frag = f ? this.concat(f, st) : st;
        return frag;
      }
      if (m > MAX_REPEAT) throw bad("repetition too large");
      var g = null;
      if (m === 0) return this.emptyFrag();
      for (var j = 0; j < m; j++) {
        var copy = this.cloneFrag(atom);
        if (j < n) g = g ? this.concat(g, copy) : copy;
        else g = g ? this.concat(g, this.question(copy)) : this.question(copy);
      }
      return g;
    }
    return atom;
  };

  // Deep-copy a fragment's states so repetitions don't share structure.
  Parser.prototype.cloneFrag = function (frag) {
    var map = {};
    var self = this;
    var copyState = function (idx) {
      if (map[idx] !== undefined) return map[idx];
      var s = self.states[idx];
      var c;
      if (s.t === "chr") c = { t: "chr", test: s.test, o: -1 };
      else if (s.t === "split") c = { t: "split", o1: -1, o2: -1 };
      else if (s.t === "assert") c = { t: "assert", k: s.k, o: -1 };
      else c = { t: "jmp", o: -1 };
      var ni = self.mk(c);
      map[idx] = ni;
      if (s.t === "split") { c.o1 = copyState(s.o1); if (s.o2 !== -1) c.o2 = copyState(s.o2); }
      else if (s.o !== -1) c.o = copyState(s.o);
      return ni;
    };
    var start = copyState(frag.start);
    // Rebuild open edges: walk original outs and map them.
    var outs = frag.outs.map(function (o) { return map[o]; });
    return { start: start, outs: outs };
  };

  Parser.prototype.parseSeq = function () {
    var f = null;
    for (;;) {
      if (this.pos >= this.src.length) break;
      var c = this.peek();
      if (c === ")" || c === "|") break;
      var atom = this.parseAtom();
      var q = this.parseQuant(atom);
      f = f ? this.concat(f, q) : q;
    }
    return f || this.emptyFrag();
  };

  Parser.prototype.parseDisjunction = function () {
    var f = this.parseSeq();
    while (this.peek() === "|") {
      this.next();
      var g = this.parseSeq();
      f = this.alternate(f, g);
    }
    return f;
  };

  function compile(pattern) {
    if (typeof pattern !== "string") throw bad("pattern must be a string");
    if (pattern.length === 0) throw bad("pattern must not be empty");
    if (pattern.length > 1024) throw bad("pattern too large");
    var p = new Parser(pattern);
    if (p.src.substr(0, 4) === "(?i)") { p.ci = true; p.pos = 4; }
    var f = p.parseDisjunction();
    if (p.pos !== p.src.length) throw bad("unexpected '" + p.src.charAt(p.pos) + "'");
    var end = p.mk({ t: "match" });
    p.patch(f.outs, end);
    return { states: p.states, start: f.start, ci: p.ci };
  }

  var MAX_TEXT = 200000;

  function isWordAt(text, i) {
    if (i < 0 || i >= text.length) return false;
    return isWord(text.charAt(i));
  }

  // Simulate from one start position. Returns true on match.
  function simulate(prog, text, from, budget) {
    var states = prog.states;
    var n = text.length;
    var cur = [];
    var seen = {};
    var stack = [prog.start];
    var addState = function (idx, pos) {
      var key = idx + "@" + pos;
      if (seen[key]) return true; // already queued this round
      seen[key] = true;
      var s = states[idx];
      if (s.t === "split") { stack.push(s.o1); if (s.o2 !== -1) stack.push(s.o2); }
      else if (s.t === "jmp") stack.push(s.o);
      else if (s.t === "assert") {
        var ok = s.k === "begin" ? pos === 0
          : s.k === "end" ? pos === n
          : s.k === "wb" ? isWordAt(text, pos - 1) !== isWordAt(text, pos)
          : isWordAt(text, pos - 1) === isWordAt(text, pos);
        if (ok) stack.push(s.o);
      } else cur.push(idx);
      if (++budget.n > TRANSITION_BUDGET) throw bad("pattern too complex");
      return true;
    };
    while (stack.length) addState(stack.pop(), from);
    var hasMatch = function () {
      for (var i = 0; i < cur.length; i++) if (states[cur[i]].t === "match") return true;
      return false;
    };
    if (hasMatch()) return true;
    for (var pos = from; pos < n; pos++) {
      var ch = text.charAt(pos);
      seen = {};
      stack = [];
      for (var j = 0; j < cur.length; j++) {
        var s = states[cur[j]];
        if (s.t === "chr" && s.test(ch)) stack.push(s.o);
        if (++budget.n > TRANSITION_BUDGET) throw bad("pattern too complex");
      }
      cur = [];
      while (stack.length) {
        var idx = stack.pop();
        var key = idx + "@" + (pos + 1);
        if (seen[key]) continue;
        seen[key] = true;
        var st = states[idx];
        if (st.t === "split") { stack.push(st.o1); if (st.o2 !== -1) stack.push(st.o2); }
        else if (st.t === "jmp") stack.push(st.o);
        else if (st.t === "assert") {
          var ok = st.k === "begin" ? pos + 1 === 0
            : st.k === "end" ? pos + 1 === n
            : st.k === "wb" ? isWordAt(text, pos) !== isWordAt(text, pos + 1)
            : isWordAt(text, pos) === isWordAt(text, pos + 1);
          if (ok) stack.push(st.o);
        } else cur.push(idx);
        if (++budget.n > TRANSITION_BUDGET) throw bad("pattern too complex");
      }
      if (hasMatch()) return true;
      if (cur.length === 0) return false;
    }
    return false;
  }

  function test(patternOrProg, text) {
    var prog = typeof patternOrProg === "string" ? compile(patternOrProg) : patternOrProg;
    // No text lowering: (?i) already folds case inside the NFA (literals and
    // ranges expand both cases at parse). Lowering here as well would break
    // negated classes ([^A] must still reject lowercase 'a').
    var t = String(text == null ? "" : text);
    if (t.length > MAX_TEXT) throw bad("text too large");
    var budget = { n: 0 };
    for (var from = 0; from <= t.length; from++) {
      if (simulate(prog, t, from, budget)) return true;
    }
    return false;
  }

  function isValid(pattern) {
    try { compile(pattern); return true; }
    catch (e) { return false; }
  }
  return {
    MAX_REPEAT: MAX_REPEAT,
    MAX_TEXT: MAX_TEXT,
    TRANSITION_BUDGET: TRANSITION_BUDGET,
    compile: compile,
    test: test,
    isValid: isValid
  };
});
