#!/usr/bin/env python3
"""Validate the courses under content/, and publish them into public/ only if they pass.

    env -u PYTHONPATH python3 tools/validate_courses.py            # check only
    env -u PYTHONPATH python3 tools/validate_courses.py --publish  # check, then copy into public/

What is checked, for every content/<field>/courses/<node-id>/:

- course.json and each lesson against schema/course.schema.json and schema/lesson.schema.json;
- the course hangs on a node that exists in public/content/<field>/map.json, and its folder
  is named after that node; every listed lesson has a file and every file is listed;
- every widget is in schema/widgets.json and its params match the schema there;
- every answer key is re-derived with sympy from the step's `verify` expression over the
  lesson's data (keys are exact: 3/5, sqrt(15), 5m^2 - 12m + 9);
- known slips are not right answers, the first two hints don't give the key away, there is
  no raw HTML, and lesson:/node: links in Markdown resolve.

Publishing replaces public/content/<field>/courses/ with the validated files plus an
index.json the app reads to know which nodes have a course. That folder is gitignored:
content/ is the source, public/ the checked copy.

Keys and verify expressions are parsed by a small recursive-descent parser written here,
mirroring src/lesson/expr.ts, which builds sympy objects directly. Nothing in the content
is passed to eval(), sympify() or parse_expr().
"""

from __future__ import annotations

import argparse
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
    registry = Registry().with_resources([(s["$id"], Resource.from_contents(s)) for s in (course, lesson)])
    widgets = json.loads((schema_dir / "widgets.json").read_text())["widgets"]
    return (
        Draft202012Validator(course, registry=registry),
        Draft202012Validator(lesson, registry=registry),
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
    for key in ("why", "prompt", "body", "solution"):
        if key in block:
            yield key, block[key]
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
    if "sideQuest" in lesson:
        check_markdown(lesson["sideQuest"]["body"], f"{where} sideQuest", lesson_ids, node_ids, report)


def map_ids(map_path: Path) -> set[str]:
    document = json.loads(map_path.read_text(encoding="utf-8"))
    ids = set()
    stack = [document["root"]]
    while stack:
        node = stack.pop()
        ids.add(node["id"])
        stack.extend(node.get("children", []))
    return ids


def validate(content: Path, public: Path, schema_dir: Path) -> tuple[Report, dict[str, list[tuple[Path, dict]]]]:
    """Check everything; return the report and, per field, the courses found."""
    report = Report()
    course_validator, lesson_validator, widget_validators = validators(schema_dir)
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
            if course_dir.name != course["nodeId"]:
                report.add(f"{where}/course.json", f"the folder must be named after the node ({course['nodeId']})")
            if course["id"] in course_ids:
                report.add(f"{where}/course.json", f"course id {course['id']!r} is used twice")
            course_ids.add(course["id"])
            lesson_ids = [entry["id"] for entry in course["lessons"]]
            if len(set(lesson_ids)) != len(lesson_ids):
                report.add(f"{where}/course.json", "a lesson id repeats")
            files = {p.stem for p in course_dir.glob("*.json")} - {"course"}
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
            found[field].append((course_dir, course))
    return report, found


def publish(found: dict[str, list[tuple[Path, dict]]], public: Path) -> list[Path]:
    written = []
    for field, courses in found.items():
        target = public / "content" / field / "courses"
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True)
        for course_dir, course in courses:
            out = target / course_dir.name
            out.mkdir()
            for name in ["course"] + [entry["id"] for entry in course["lessons"]]:
                shutil.copyfile(course_dir / f"{name}.json", out / f"{name}.json")
                written.append(out / f"{name}.json")
        index = {"format": 1, "courses": [course for _, course in courses]}
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
    count = sum(len(c) for c in found.values())
    if report.errors:
        print(f"{len(report.errors)} problem(s); nothing published.", file=sys.stderr)
        for error in report.errors:
            print(f"  {error}", file=sys.stderr)
        return 1
    print(f"{count} course(s) valid.")
    if args.publish:
        written = publish(found, args.public)
        print(f"Published {len(written)} file(s) to {args.public / 'content'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
