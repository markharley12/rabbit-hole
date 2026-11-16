#!/usr/bin/env python3
"""Validate the courses under content/, and publish them into public/ only if they pass.

    env -u PYTHONPATH python3 tools/validate_courses.py            # check only
    env -u PYTHONPATH python3 tools/validate_courses.py --publish  # check, then copy into public/

What is checked, for every content/<field>/courses/<course-id>/:

- course.json and each lesson against schema/course.schema.json and schema/lesson.schema.json;
- an optional cheatsheet.json against schema/cheatsheet.schema.json: item ids unique, `lesson`
  one of the course's, Markdown checked as for lessons;
- optional `tunnels` in course.json: each `to` is another course of the same field, none repeats,
  and the `needs` tunnels never form a loop (a cycle of "do that first");
- steps, choice and order screens marked `review: true` (a boolean, schema only). Publishing lists
  them in the course's entry in index.json as `review: [{lesson, step}]`, for spaced review in the app;
- choice screens: exactly one right option (at least one when `multiple`), at least one wrong,
  distinct texts; order screens: `fixed` and `say` name real lines, three or more can move, distinct
  texts; a lesson has at least one step and at most half its screens are choice or order;
- the course hangs on a node that exists in public/content/<field>/map.json (any number of
  courses may share a node), its folder is named after the course's id, and ids are unique; every listed lesson has a file and every file is listed;
- every widget is in schema/widgets.json and its params match the schema there;
- every answer key is re-derived with sympy from the step's `verify` expression over the
  lesson's data (keys are exact: 3/5, sqrt(15), 5m^2 - 12m + 9);
- known slips are not right answers, the first two hints don't give the key away, there is
  no raw HTML, and lesson:/node: links in Markdown resolve.

Reading links are checked in a second pass, for every content/<field>/resources/<node-id>.json:
the file is named after its nodeId, which is a node of the map; ids are unique; every url is
https; `checked` is a real date that is not in the future; 1 to 30 resources. No URL is
fetched (this runs offline on every build): `checked` is a claim by whoever opened the link.

Publishing replaces public/content/<field>/courses/ with the validated files plus an
index.json the app reads to know which nodes have a course, and public/content/<field>/resources/
with the reading files plus an index.json of counts per node. Both folders are gitignored:
content/ is the source, public/ the checked copy.

Keys and verify expressions are parsed by a small recursive-descent parser written here,
mirroring src/lesson/expr.ts, which builds sympy objects directly. Nothing in the content
is passed to eval(), sympify() or parse_expr().
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import shutil
import sys
from pathlib import Path

import sympy as sp
from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent.parent


class ExprError(ValueError):
    pass


# ---------------------------------------------------------------- the grammar

def normalise(text: str, keep_commas: bool) -> str:
    """Phone and maths characters to the plain grammar, as expr.ts normalise() does."""
    text = re.sub("[−–—]", "-", text)
    text = re.sub("[×·⋅∙]", "*", text)
    text = text.replace("÷", "/").replace("**", "^").replace("²", "^2").replace("³", "^3")
    if not keep_commas:
        text = text.replace(",", ".")
    return text.strip()


def tokenise(text: str, verify: bool) -> list[tuple[str, object]]:
    # Answers name single letters only, as in the app (A1 would be A·1 there);
    # verify expressions may name data and functions with digits (A1, sv).
    ident = re.compile(r"[A-Za-z][A-Za-z0-9]*" if verify else r"[A-Za-z]+")
    ops = "+-*/^()√" + ("," if verify else "")
    tokens: list[tuple[str, object]] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            i += 1
        elif ch.isdigit() or ch == ".":
            match = re.match(r"\d+\.?\d*|\.\d+", text[i:])
            if not match:
                raise ExprError(f"can't read the number at {text[i:]!r}")
            tokens.append(("num", sp.Rational(match.group(0))))
            i += len(match.group(0))
        elif ch.isalpha() and ch.isascii():
            match = ident.match(text, i)
            tokens.append(("id", match.group(0)))
            i = match.end()
        elif ch in ops:
            tokens.append(("op", ch))
            i += 1
        else:
            raise ExprError(f"{ch!r} is not allowed")
    return tokens


def _positive_first(v: sp.Matrix) -> sp.Matrix:
    """A sign convention so a computed singular vector is one definite vector."""
    for x in v:
        if x != 0:
            return v if sp.simplify(x) > 0 else -v
    return v


def _as_index(i: object) -> int:
    if not (isinstance(i, sp.Integer) or (isinstance(i, sp.Rational) and i.q == 1)) or int(i) < 1:
        raise ExprError(f"an index must be a whole number from 1, not {i}")
    return int(i)


def _matrix(x: object, what: str) -> sp.Matrix:
    if not isinstance(x, sp.MatrixBase):
        raise ExprError(f"{what} needs a matrix or vector")
    return sp.Matrix(x)


def _singular(A: sp.Matrix, i: int) -> tuple[sp.Expr, sp.Matrix]:
    """The i-th singular value (largest first) and its right singular vector."""
    gram = A.T * A
    pairs = sorted(((sp.nsimplify(val), mult, vecs) for val, mult, vecs in gram.eigenvects()), key=lambda p: -float(p[0]))
    flat = [(val, vecs) for val, mult, vecs in pairs for _ in range(mult)]
    if i > len(flat):
        raise ExprError(f"there is no singular value {i}")
    value, vecs = flat[i - 1]
    if len(vecs) > 1:
        raise ExprError(f"singular value {i} is repeated, so its vector is not unique")
    v = vecs[0]
    v = v / sp.sqrt((v.T * v)[0])
    return sp.sqrt(value), _positive_first(sp.simplify(v))


def _nullvec(M: sp.Matrix) -> sp.Matrix:
    basis = M.nullspace()
    if len(basis) != 1:
        raise ExprError(f"nullvec needs a one-dimensional null space, this one has dimension {len(basis)}")
    return basis[0]


def _solvefor(expr: sp.Expr, var: object) -> sp.Expr:
    if not isinstance(var, sp.Symbol):
        raise ExprError("solvefor(expression, letter)")
    roots = sp.solve(expr, var)
    if len(roots) != 1:
        raise ExprError(f"solvefor found {len(roots)} solutions, not one")
    return roots[0]


def _argmin(expr: sp.Expr, var: object) -> sp.Expr:
    if not isinstance(var, sp.Symbol):
        raise ExprError("argmin(expression, letter)")
    roots = [r for r in sp.solve(sp.diff(expr, var), var) if sp.diff(expr, var, 2).subs(var, r) > 0]
    if len(roots) != 1:
        raise ExprError(f"argmin found {len(roots)} minima, not one")
    return roots[0]


def _entry(M: object, i: object, j: object = None) -> sp.Expr:
    M = _matrix(M, "entry")
    if j is None:
        if 1 not in M.shape:
            raise ExprError("entry(M, i) is for vectors; use entry(M, row, column)")
        return list(M)[_as_index(i) - 1]
    return M[_as_index(i) - 1, _as_index(j) - 1]


def _sq(v: object) -> sp.Expr:
    v = _matrix(v, "sq")
    return sum(x**2 for x in v)


# Every function a verify expression may call. This is the whole vocabulary.
FUNCTIONS = {
    "sqrt": (1, lambda x: sp.sqrt(x)),
    "tr": (1, lambda M: _matrix(M, "tr").T),
    "pinv": (1, lambda M: _matrix(M, "pinv").pinv()),
    "rank": (1, lambda M: sp.Integer(_matrix(M, "rank").rank())),
    "det": (1, lambda M: _matrix(M, "det").det()),
    "sq": (1, _sq),
    "unit": (1, lambda v: _matrix(v, "unit") / sp.sqrt(_sq(v))),
    "dot": (2, lambda u, v: (_matrix(u, "dot").T * _matrix(v, "dot"))[0]),
    "entry": ((2, 3), _entry),
    "eye": (1, lambda n: sp.eye(_as_index(n))),
    "eigs": (1, lambda M: sp.Matrix(sorted((sp.nsimplify(e) for e in _matrix(M, "eigs").eigenvals(multiple=True)), key=lambda e: -float(e)))),
    "sv": (2, lambda A, i: _singular(_matrix(A, "sv"), _as_index(i))[0]),
    "rsv": (2, lambda A, i: _singular(_matrix(A, "rsv"), _as_index(i))[1]),
    "lsv": (2, lambda A, i: sp.simplify(_matrix(A, "lsv") * _singular(_matrix(A, "lsv"), _as_index(i))[1] / _singular(_matrix(A, "lsv"), _as_index(i))[0])),
    "nullvec": (1, lambda M: _nullvec(_matrix(M, "nullvec"))),
    "expand": (1, lambda e: sp.expand(e)),
    "solvefor": (2, _solvefor),
    "argmin": (2, _argmin),
    "vec": (None, lambda *xs: sp.Matrix(list(xs))),
}


class Parser:
    """Recursive descent over the answer grammar (src/lesson/expr.ts), building sympy.

    In key mode (verify=False) it accepts exactly what the app accepts. In verify mode it
    also allows data names, the FUNCTIONS above, and commas between arguments.
    """

    def __init__(self, text: str, vars: list[str], data: dict | None = None, verify: bool = False):
        self.verify = verify
        self.tokens = tokenise(normalise(text, keep_commas=verify), verify)
        self.symbols = {v: sp.Symbol(v) for v in vars}
        self.data = data or {}
        self.at = 0
        if not self.tokens:
            raise ExprError("empty")

    def parse(self):
        tree = self.sum()
        if self.at < len(self.tokens):
            raise ExprError(f"unexpected {self.tokens[self.at][1]!r}")
        return tree

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def is_op(self, v: str) -> bool:
        token = self.peek()
        return token is not None and token[0] == "op" and token[1] == v

    def expect(self, v: str):
        if not self.is_op(v):
            raise ExprError(f'expected "{v}"')
        self.at += 1

    def call(self, name: str):
        arity, fn = FUNCTIONS[name]
        self.expect("(")
        args = [self.sum()]
        while self.verify and self.is_op(","):
            self.at += 1
            args.append(self.sum())
        self.expect(")")
        if arity is not None and len(args) not in (arity if isinstance(arity, tuple) else (arity,)):
            raise ExprError(f"{name} takes {arity} argument(s), got {len(args)}")
        return fn(*args)

    def identifier(self, name: str):
        if name == "sqrt" or (self.verify and name in FUNCTIONS):
            if not self.is_op("("):
                raise ExprError(f"{name} needs brackets")
            return self.call(name)
        if self.verify and name in self.data:
            return self.data[name]
        if name in self.symbols:
            return self.symbols[name]
        if self.verify and len(name) == 1:
            # A verify expression may use letters the answer does not (c in solvefor(c + 2m - 3, c)).
            return self.symbols.setdefault(name, sp.Symbol(name))
        if not self.verify:
            # As in the app: a run of declared letters is their product.
            missing = [letter for letter in name if letter not in self.symbols]
            if not missing:
                return sp.Mul(*(self.symbols[letter] for letter in name))
        raise ExprError(f"unknown name {name!r}")

    def atom(self):
        token = self.peek()
        if token is None:
            raise ExprError("it ends too early")
        kind, value = token
        self.at += 1
        if kind == "num":
            return value
        if kind == "id":
            return self.identifier(value)
        if value == "(":
            inner = self.sum()
            self.expect(")")
            return inner
        if value == "√":
            return sp.sqrt(self.power())
        raise ExprError(f"{value!r} can't go there")

    def power(self):
        base = self.atom()
        if self.is_op("^"):
            self.at += 1
            return base ** self.unary()
        return base

    def unary(self):
        if self.is_op("-"):
            self.at += 1
            return -self.unary()
        if self.is_op("+"):
            self.at += 1
            return self.unary()
        return self.power()

    def starts_factor(self) -> bool:
        token = self.peek()
        return token is not None and (token[0] == "id" or (token[0] == "op" and token[1] in "(√"))

    def product(self):
        left = self.unary()
        while True:
            if self.is_op("*"):
                self.at += 1
                left = left * self.unary()
            elif self.is_op("/"):
                self.at += 1
                left = left / self.unary()
            elif self.starts_factor():
                left = left * self.power()
            else:
                return left

    def sum(self):
        left = self.product()
        while self.is_op("+") or self.is_op("-"):
            op = self.tokens[self.at][1]
            self.at += 1
            right = self.product()
            left = left + right if op == "+" else left - right
        return left


def parse_key(text: str, vars: list[str]):
    return Parser(text, vars).parse()


def parse_verify(text: str, vars: list[str], data: dict):
    return Parser(text, vars, data, verify=True).parse()


def to_sympy(value) -> object:
    """A lesson data value (number, vector, matrix) as sympy. Vectors become columns."""
    entry = lambda x: sp.Integer(x) if isinstance(x, int) else parse_key(str(x), [])
    if isinstance(value, list) and value and isinstance(value[0], list):
        return sp.Matrix([[entry(x) for x in row] for row in value])
    if isinstance(value, list):
        return sp.Matrix([entry(x) for x in value])
    return entry(value)


# ---------------------------------------------------------------- comparing

def is_zero(x) -> bool:
    if isinstance(x, sp.MatrixBase):
        return all(is_zero(e) for e in x)
    return sp.simplify(sp.expand(x)) == 0


def shape_key(answer: dict, vars: list[str]):
    keys = [parse_key(f["key"], vars) for f in answer["fields"]]
    if "matrix" in answer:
        rows, cols = answer["matrix"]
        if rows * cols != len(keys):
            raise ExprError(f"matrix {rows}x{cols} needs {rows * cols} fields, has {len(keys)}")
        return sp.Matrix(rows, cols, keys)
    if len(keys) > 1:
        return sp.Matrix(keys)
    return keys[0]


def conform(computed, key):
    """Bring the verify result to the key's shape (1×1 to scalar, row to column)."""
    if isinstance(key, sp.MatrixBase):
        if not isinstance(computed, sp.MatrixBase):
            raise ExprError(f"verify gives a number, the answer has {len(key)} boxes")
        if computed.shape != key.shape and 1 in computed.shape and 1 in key.shape and len(computed) == len(key):
            computed = computed.reshape(*key.shape)
        if computed.shape != key.shape:
            raise ExprError(f"verify gives shape {computed.shape}, the answer is {key.shape}")
        return computed
    if isinstance(computed, sp.MatrixBase):
        if computed.shape != (1, 1):
            raise ExprError(f"verify gives shape {computed.shape}, the answer is one number")
        return computed[0]
    return computed


def matches(key, computed, accept: list[str]) -> bool:
    if is_zero(key - computed):
        return True
    if "negated" in accept and is_zero(key + computed):
        return True
    if "multiple" in accept and isinstance(key, sp.MatrixBase):
        pivot = next((i for i, x in enumerate(computed) if not is_zero(x)), None)
        if pivot is not None and not is_zero(key[pivot]):
            return is_zero(key - computed * (key[pivot] / computed[pivot]))
    return False


def decimal_form(x) -> str | None:
    """0.6 for 3/5, when the key is a terminating decimal with three places or fewer."""
    if isinstance(x, sp.Rational) and not isinstance(x, sp.Integer):
        for places in (1, 2, 3):
            scaled = x * 10**places
            if scaled.q == 1:
                return f"{float(x):.{places}f}"
    return None


# ---------------------------------------------------------------- checking content

MATH = re.compile(r"\$\$.+?\$\$|\$[^$]+?\$", re.S)
LINK = re.compile(r"\]\(([^)\s]+)\)")


class Report:
    def __init__(self):
        self.errors: list[str] = []

    def add(self, where: str, message: str):
        self.errors.append(f"{where}: {message}")


def load_json(path: Path, report: Report):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        report.add(str(path), f"cannot read: {error}")
        return None


def validators(schema_dir: Path):
    course = json.loads((schema_dir / "course.schema.json").read_text())
    lesson = json.loads((schema_dir / "lesson.schema.json").read_text())
    cheatsheet = json.loads((schema_dir / "cheatsheet.schema.json").read_text())
    registry = Registry().with_resources([(s["$id"], Resource.from_contents(s)) for s in (course, lesson, cheatsheet)])
    widgets = json.loads((schema_dir / "widgets.json").read_text())["widgets"]
    return (
        Draft202012Validator(course, registry=registry),
        Draft202012Validator(lesson, registry=registry),
        Draft202012Validator(cheatsheet, registry=registry),
        {name: Draft202012Validator(spec["params"]) for name, spec in widgets.items()},
    )


def schema_errors(validator, document, where: str, report: Report) -> bool:
    found = sorted(validator.iter_errors(document), key=lambda e: [str(p) for p in e.absolute_path])
    for error in found:
        # "is not valid under any of the given schemas" says nothing; name the likeliest cause.
        if error.context:
            error = best_match(error.context)
        path = "/".join(str(p) for p in error.absolute_path) or "(top)"
        report.add(where, f"{path}: {error.message}")
    return bool(found)


def markdown_strings(block: dict):
    """Every Markdown string in a block, with a name for messages."""
    for key in ("why", "prompt", "body", "solution", "hint"):
        if key in block:
            yield key, block[key]
    # choice: every option's text and reason; order: every line, and the per-line nudges.
    for i, option in enumerate(block.get("options", [])):
        yield f"options/{i}/text", option["text"]
        yield f"options/{i}/say", option["say"]
    for i, item in enumerate(block.get("items", [])):
        yield f"items/{i}/text", item["text"]
    for name, text in block.get("say", {}).items():
        yield f"say/{name}", text
    for i, item in enumerate(block.get("define", [])):
        yield f"define/{i}", item["meaning"]
    for i, hint in enumerate(block.get("hints", [])):
        yield f"hints/{i}", hint
    if "check" in block:
        yield "check/say", block["check"]["say"]
    answer = block.get("answer", {})
    if "acceptNote" in answer:
        yield "answer/acceptNote", answer["acceptNote"]
    for i, slip in enumerate(answer.get("slips", [])):
        if "say" in slip:
            yield f"answer/slips/{i}/say", slip["say"]
    for key in ("widget",):
        if key in block and "caption" in block[key]:
            yield "widget/caption", block[key]["caption"]


def check_markdown(text: str, where: str, lesson_ids: set[str], node_ids: set[str], report: Report):
    prose = MATH.sub("", text)
    if prose.count("$") % 2:
        report.add(where, "an unmatched $")
    if re.search(r"<[A-Za-z!/]", prose):
        report.add(where, "raw HTML is not allowed in Markdown")
    for target in LINK.findall(prose):
        if target.startswith(("https://", "http://")):
            continue
        kind, _, name = target.partition(":")
        if kind == "lesson" and name in lesson_ids:
            continue
        if kind == "node" and name in node_ids:
            continue
        report.add(where, f"link {target!r} does not resolve (use https://…, lesson:<id> or node:<id>)")


def check_widget(widget: dict, where: str, widget_validators: dict, report: Report):
    validator = widget_validators.get(widget["name"])
    if validator is None:
        report.add(where, f"no widget called {widget['name']!r} in schema/widgets.json")
        return
    schema_errors(validator, widget.get("params", {}), f"{where} ({widget['name']} params)", report)


def check_answer(block: dict, data: dict, where: str, report: Report):
    answer = block["answer"]
    vars = answer.get("vars", [])
    accept = answer.get("accept", [])
    names = [f["name"] for f in answer["fields"]]
    if len(set(names)) != len(names):
        report.add(where, "field names repeat")
    try:
        key = shape_key(answer, vars)
    except ExprError as error:
        report.add(where, f"a key does not parse: {error}")
        return
    try:
        computed = conform(parse_verify(answer["verify"], vars, data), key)
    except ExprError as error:
        report.add(where, f"verify {answer['verify']!r}: {error}")
        return
    except Exception as error:  # sympy raising on a bad combination (shape mismatch etc.)
        report.add(where, f"verify {answer['verify']!r} fails in sympy: {type(error).__name__}: {error}")
        return
    if not matches(key, computed, accept):
        shown = list(computed) if isinstance(computed, sp.MatrixBase) else computed
        report.add(where, f"the key does not match verify: sympy gives {shown}")

    field_keys = {f["name"]: parse_key(f["key"], vars) for f in answer["fields"]}
    for i, slip in enumerate(answer.get("slips", [])):
        if slip["detect"] == "known":
            for name, wrong in slip["when"].items():
                if name not in field_keys:
                    report.add(where, f"slip {i} names a field {name!r} that does not exist")
                    continue
                try:
                    value = parse_key(wrong, vars)
                except ExprError as error:
                    report.add(where, f"slip {i} value {wrong!r}: {error}")
                    continue
                right = field_keys[name]
                if is_zero(value - right) or ("negated" in accept and is_zero(value + right)):
                    report.add(where, f"slip {i} lists a right answer for {name} as a slip")
        elif slip["detect"] in ("symmetric", "transpose") and "matrix" not in answer:
            report.add(where, f"the {slip['detect']} slip needs a matrix answer")

    # Hints are a ladder towards the answer; the first two must not state it.
    givers = set()
    for f in answer["fields"]:
        plain = normalise(f["key"], False).replace(" ", "")
        if len(plain) >= 3 or "/" in plain:
            givers.add(plain)
        decimal = decimal_form(field_keys[f["name"]])
        if decimal:
            givers.add(decimal)
    for i, hint in enumerate(block["hints"][:2]):
        squashed = normalise(hint, True).replace(" ", "")
        for giver in givers:
            if re.search(rf"(?<![\d.]){re.escape(giver)}(?![\d.])", squashed):
                report.add(where, f"hint {i + 1} gives away the key {giver!r}; only the third hint may get close")


def check_choice(block: dict, where: str, report: Report):
    """Exactly one right option (or at least one when `multiple`), at least one wrong, texts distinct."""
    options = block["options"]
    ids = [o["id"] for o in options]
    if len(set(ids)) != len(ids):
        report.add(where, "option ids repeat")
    texts = [" ".join(o["text"].split()) for o in options]
    if len(set(texts)) != len(texts):
        report.add(where, "two options have the same text")
    right = sum(1 for o in options if o["correct"])
    if block.get("multiple"):
        if right < 1:
            report.add(where, "a multiple-choice question needs at least one correct option")
    elif right != 1:
        report.add(where, f"a single-answer question needs exactly one correct option (has {right}); set multiple for more")
    if right == len(options):
        report.add(where, "at least one option must be incorrect")


def check_order(block: dict, where: str, report: Report):
    """Fixed and say name real lines, at least three lines can move, texts distinct.

    One valid order is the author's responsibility (course-authoring.md): no rule here can tell
    that two lines could swap, which is why the texts are only checked to differ.
    """
    items = block["items"]
    ids = [i["id"] for i in items]
    if len(set(ids)) != len(ids):
        report.add(where, "item ids repeat")
    texts = [" ".join(i["text"].split()) for i in items]
    if len(set(texts)) != len(texts):
        report.add(where, "two lines have the same text")
    fixed = block.get("fixed", [])
    for name in fixed:
        if name not in ids:
            report.add(where, f"fixed names {name!r}, which is not an item")
    for name in block.get("say", {}):
        if name not in ids:
            report.add(where, f"say names {name!r}, which is not an item")
        elif name in fixed:
            report.add(where, f"say names {name!r}, which is fixed and can never be out of place")
    if len(set(fixed) & set(ids)) > len(ids) - 3:
        report.add(where, "at least three lines must be movable")


QUIZ_TYPES = ("choice", "order")


def check_lesson_shape(lesson: dict, where: str, report: Report):
    """A lesson still teaches through steps: quizzes support the worked problems, never replace them."""
    blocks = lesson["blocks"]
    if not any(b["type"] == "step" for b in blocks):
        report.add(where, "a lesson needs at least one step")
    quizzes = sum(1 for b in blocks if b["type"] in QUIZ_TYPES)
    if quizzes * 2 > len(blocks):
        report.add(where, f"at most half the screens may be choice or order ({quizzes} of {len(blocks)})")


def check_lesson(lesson: dict, where: str, lesson_ids: set[str], node_ids: set[str], widget_validators: dict, report: Report):
    try:
        data = {name: to_sympy(value) for name, value in lesson.get("data", {}).items()}
    except ExprError as error:
        report.add(where, f"data: {error}")
        return
    clash = set(data) & set(FUNCTIONS)
    if clash:
        report.add(where, f"data names clash with functions: {sorted(clash)}")
    seen = set()
    for i, block in enumerate(lesson["blocks"]):
        at = f"{where} block {i} ({block['id']})"
        if block["id"] in seen:
            report.add(at, "block id repeats")
        seen.add(block["id"])
        for name, text in markdown_strings(block):
            check_markdown(text, f"{at} {name}", lesson_ids, node_ids, report)
        for key in ("widget",):
            if key in block:
                check_widget(block[key], f"{at} widget", widget_validators, report)
        if "check" in block and "widget" in block["check"]:
            check_widget(block["check"]["widget"], f"{at} check widget", widget_validators, report)
        if block["type"] == "step":
            check_answer(block, data, at, report)
        elif block["type"] == "choice":
            check_choice(block, at, report)
        elif block["type"] == "order":
            check_order(block, at, report)
    check_lesson_shape(lesson, where, report)
    if "sideQuest" in lesson:
        check_markdown(lesson["sideQuest"]["body"], f"{where} sideQuest", lesson_ids, node_ids, report)


def check_cheatsheet(sheet: dict, where: str, lesson_ids: set[str], node_ids: set[str], report: Report):
    """Ids unique, `lesson` one of the course's, and the Markdown as safe as a lesson's."""
    seen: set[str] = set()
    for section in sheet["sections"]:
        for item in section["items"]:
            at = f"{where} item {item['id']!r}"
            if item["id"] in seen:
                report.add(at, "item id repeats")
            seen.add(item["id"])
            if "lesson" in item and item["lesson"] not in lesson_ids:
                report.add(at, f"lesson {item['lesson']!r} is not a lesson of this course")
            for key in ("formula", "when"):
                check_markdown(item[key], f"{at} {key}", lesson_ids, node_ids, report)


def check_tunnels(courses: list[tuple[str, dict]], report: Report):
    """Tunnels between the courses of one field: `to` is another course here, none repeats, and
    the `needs` links lead somewhere: following them never comes back to where it started."""
    ids = {course["id"] for _, course in courses}
    needs: dict[str, list[str]] = {}
    for where, course in courses:
        seen: set[str] = set()
        for i, tunnel in enumerate(course.get("tunnels", [])):
            at = f"{where}/course.json tunnels/{i}"
            if tunnel["to"] == course["id"]:
                report.add(at, "a course cannot have a tunnel to itself")
            elif tunnel["to"] not in ids:
                report.add(at, f"to {tunnel['to']!r} is not a course in this field")
            if tunnel["to"] in seen:
                report.add(at, f"a second tunnel to {tunnel['to']!r}")
            seen.add(tunnel["to"])
            if tunnel["kind"] == "needs" and tunnel["to"] in ids and tunnel["to"] != course["id"]:
                needs.setdefault(course["id"], []).append(tunnel["to"])
    # Depth-first over `needs`; a node met again while still on the path closes a loop.
    state: dict[str, int] = {}
    path: list[str] = []
    reported: set[str] = set()

    def visit(node: str):
        state[node] = 1
        path.append(node)
        for target in needs.get(node, []):
            if state.get(target) == 1:
                loop = path[path.index(target):] + [target]
                key = min(loop[:-1])
                if key not in reported:
                    reported.add(key)
                    report.add(f"course {node!r}", f"the `needs` tunnels form a loop: {' -> '.join(loop)}")
            elif target not in state:
                visit(target)
        path.pop()
        state[node] = 2

    for _, course in courses:
        if course["id"] not in state:
            visit(course["id"])


def map_ids(map_path: Path) -> set[str]:
    document = json.loads(map_path.read_text(encoding="utf-8"))
    ids = set()
    stack = [document["root"]]
    while stack:
        node = stack.pop()
        ids.add(node["id"])
        stack.extend(node.get("children", []))
    return ids


def validate(content: Path, public: Path, schema_dir: Path, report: Report | None = None) -> tuple[Report, dict[str, list[tuple[Path, dict]]]]:
    """Check every course; return the report and, per field, the courses found."""
    report = report or Report()
    course_validator, lesson_validator, cheatsheet_validator, widget_validators = validators(schema_dir)
    found: dict[str, list[tuple[Path, dict]]] = {}
    course_ids: set[str] = set()
    for courses_dir in sorted(content.glob("*/courses")):
        field = courses_dir.parent.name
        map_path = public / "content" / field / "map.json"
        if not map_path.exists():
            report.add(str(courses_dir), f"there is no map for {field!r} at {map_path}")
            continue
        nodes = map_ids(map_path)
        found[field] = []
        for course_dir in sorted(p for p in courses_dir.iterdir() if p.is_dir()):
            where = str(course_dir.relative_to(content.parent)) if content.parent in course_dir.parents else str(course_dir)
            course = load_json(course_dir / "course.json", report)
            if course is None or schema_errors(course_validator, course, f"{where}/course.json", report):
                continue
            if course["nodeId"] not in nodes:
                report.add(f"{where}/course.json", f"nodeId {course['nodeId']!r} is not a node of the {field} map")
            if course_dir.name != course["id"]:
                report.add(f"{where}/course.json", f"the folder must be named after the course id ({course['id']})")
            if course["id"] in course_ids:
                report.add(f"{where}/course.json", f"course id {course['id']!r} is used twice")
            course_ids.add(course["id"])
            lesson_ids = [entry["id"] for entry in course["lessons"]]
            if len(set(lesson_ids)) != len(lesson_ids):
                report.add(f"{where}/course.json", "a lesson id repeats")
            # cheatsheet.json is the one optional file that is not a lesson.
            files = {p.stem for p in course_dir.glob("*.json")} - {"course", "cheatsheet"}
            for extra in sorted(files - set(lesson_ids)):
                report.add(f"{where}/{extra}.json", "is not listed in course.json")
            for entry in course["lessons"]:
                path = course_dir / f"{entry['id']}.json"
                if not path.exists():
                    report.add(f"{where}/course.json", f"lesson {entry['id']!r} has no file {path.name}")
                    continue
                lesson = load_json(path, report)
                if lesson is None or schema_errors(lesson_validator, lesson, f"{where}/{path.name}", report):
                    continue
                if lesson["id"] != entry["id"]:
                    report.add(f"{where}/{path.name}", f"id {lesson['id']!r} differs from its file name")
                if lesson["title"] != entry["title"]:
                    report.add(f"{where}/{path.name}", "title differs from the one in course.json")
                check_lesson(lesson, f"{where}/{path.name}", set(lesson_ids), nodes, widget_validators, report)
            sheet_path = course_dir / "cheatsheet.json"
            if sheet_path.exists():
                sheet = load_json(sheet_path, report)
                if sheet is not None and not schema_errors(cheatsheet_validator, sheet, f"{where}/cheatsheet.json", report):
                    check_cheatsheet(sheet, f"{where}/cheatsheet.json", set(lesson_ids), nodes, report)
            found[field].append((course_dir, course))
        check_tunnels([(str(d.relative_to(content.parent)) if content.parent in d.parents else str(d), c) for d, c in found[field]], report)
    return report, found


def resources_validator(schema_dir: Path):
    lesson = json.loads((schema_dir / "lesson.schema.json").read_text())
    resources = json.loads((schema_dir / "resources.schema.json").read_text())
    registry = Registry().with_resources([(s["$id"], Resource.from_contents(s)) for s in (lesson, resources)])
    return Draft202012Validator(resources, registry=registry)


def validate_resources(content: Path, public: Path, schema_dir: Path, report: Report, today: datetime.date | None = None) -> dict[str, list[tuple[Path, dict]]]:
    """Check content/<field>/resources/<node-id>.json; return, per field, the files that passed.

    Nothing here touches the network: `checked` is a claim that a person opened the URL,
    and the most this can do is make sure the claim is a real date that is not in the future.
    """
    today = today or datetime.date.today()
    validator = resources_validator(schema_dir)
    found: dict[str, list[tuple[Path, dict]]] = {}
    for resources_dir in sorted(content.glob("*/resources")):
        field = resources_dir.parent.name
        map_path = public / "content" / field / "map.json"
        if not map_path.exists():
            report.add(str(resources_dir), f"there is no map for {field!r} at {map_path}")
            continue
        nodes = map_ids(map_path)
        found[field] = []
        for path in sorted(p for p in resources_dir.iterdir() if p.is_file()):
            where = str(path.relative_to(content.parent)) if content.parent in path.parents else str(path)
            if path.suffix != ".json":
                report.add(where, "is not a .json file")
                continue
            document = load_json(path, report)
            if document is None or schema_errors(validator, document, where, report):
                continue
            if document["nodeId"] not in nodes:
                report.add(where, f"nodeId {document['nodeId']!r} is not a node of the {field} map")
            if path.stem != document["nodeId"]:
                report.add(where, f"the file must be named after nodeId ({document['nodeId']}.json)")
            seen: set[str] = set()
            for entry in document["resources"]:
                at = f"{where} resource {entry['id']!r}"
                if entry["id"] in seen:
                    report.add(at, "resource id repeats")
                seen.add(entry["id"])
                try:
                    checked = datetime.date.fromisoformat(entry["checked"])
                except ValueError:
                    report.add(at, f"checked {entry['checked']!r} is not a real date")
                    continue
                if checked > today:
                    report.add(at, f"checked {entry['checked']} is in the future")
            found[field].append((path, document))
    return found


def publish_resources(found: dict[str, list[tuple[Path, dict]]], public: Path, fields) -> list[Path]:
    """Replace public/content/<field>/resources/ with the checked files and an index of counts.

    Every field in `fields` gets an index, even with no resources, so a stale one never
    outlives its source and the app can read the index without a 404.
    """
    written = []
    for field in fields:
        if field in ("", ".", "..") or "/" in field or "\\" in field:
            raise ValueError(f"refusing to publish into {field!r}")
        target = public / "content" / field / "resources"
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True)
        counts = {}
        for path, document in found.get(field, []):
            shutil.copyfile(path, target / f"{document['nodeId']}.json")
            written.append(target / f"{document['nodeId']}.json")
            counts[document["nodeId"]] = len(document["resources"])
        (target / "index.json").write_text(json.dumps({"format": 1, "nodes": counts}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        written.append(target / "index.json")
    return written


def review_steps(course_dir: Path, course: dict) -> list[dict[str, str]]:
    """The blocks a course's lessons mark `review: true`, in lesson order, as {lesson, step}.

    A marked choice or order block is listed under the same `step` key: the app joins on the id
    and shows whatever block it finds there.

    There is no rule here that a review step must not rest on a widget: nothing in a step says
    reliably whether its prompt can be answered without one. Whether a prompt stands on its own
    screen is for the author and the reviewer (course-authoring.md section 11).
    """
    marked = []
    for entry in course["lessons"]:
        lesson = json.loads((course_dir / f"{entry['id']}.json").read_text(encoding="utf-8"))
        marked += [{"lesson": entry["id"], "step": b["id"]} for b in lesson["blocks"] if b.get("type") in ("step", "choice", "order") and b.get("review")]
    return marked


def publish(found: dict[str, list[tuple[Path, dict]]], public: Path) -> list[Path]:
    written = []
    for field, courses in found.items():
        target = public / "content" / field / "courses"
        # Replacing the whole folder is what drops courses that left the source. It may only
        # ever be this one folder, whatever `field` holds.
        if field in ("", ".", "..") or "/" in field or "\\" in field:
            raise ValueError(f"refusing to publish into {target}")
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True)
        for course_dir, course in courses:
            out = target / course_dir.name
            out.mkdir()
            names = ["course"] + [entry["id"] for entry in course["lessons"]]
            if (course_dir / "cheatsheet.json").exists():
                names.append("cheatsheet")
            for name in names:
                shutil.copyfile(course_dir / f"{name}.json", out / f"{name}.json")
                written.append(out / f"{name}.json")
        # `cheatsheet: true` is added here, in the published index only. It is not part of
        # course.schema.json: a course.json never says it, the folder does.
        # `review` (the steps lessons mark `review: true`, for spaced review) is added the same
        # way, and left out when empty.
        entries = []
        for d, course in courses:
            entry = {**course, "cheatsheet": True} if (d / "cheatsheet.json").exists() else dict(course)
            marked = review_steps(d, course)
            if marked:
                entry["review"] = marked
            entries.append(entry)
        index = {"format": 1, "courses": entries}
        (target / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        written.append(target / "index.json")
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--publish", action="store_true", help="copy into public/ if everything passes")
    parser.add_argument("--content", type=Path, default=ROOT / "content")
    parser.add_argument("--public", type=Path, default=ROOT / "public")
    parser.add_argument("--schema", type=Path, default=ROOT / "schema")
    args = parser.parse_args(argv)

    report, found = validate(args.content, args.public, args.schema)
    resources = validate_resources(args.content, args.public, args.schema, report)
    count = sum(len(c) for c in found.values())
    notes = sum(len(r) for r in resources.values())
    if report.errors:
        print(f"{len(report.errors)} problem(s); nothing published.", file=sys.stderr)
        for error in report.errors:
            print(f"  {error}", file=sys.stderr)
        return 1
    print(f"{count} course(s) valid." + (f" {notes} reading file(s) valid." if notes else ""))
    if args.publish:
        written = publish(found, args.public) + publish_resources(resources, args.public, sorted(set(found) | set(resources)))
        print(f"Published {len(written)} file(s) to {args.public / 'content'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
