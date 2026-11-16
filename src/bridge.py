# iCalPad advanced solver bridge. Runs inside Pyodide in a web worker.
# The page sends an operation and its arguments as JSON expression trees;
# SymPy does the work and the answer goes back as a JSON tree.
import json
from sympy import *
from sympy.core.function import AppliedUndef
from sympy.core.relational import Relational
from sympy.logic.boolalg import And, Or, Not, BooleanTrue, BooleanFalse

_FN = {'sin': sin, 'cos': cos, 'tan': tan, 'asin': asin, 'acos': acos, 'atan': atan, 'sinh': sinh, 'cosh': cosh,
       'tanh': tanh, 'asinh': asinh, 'acosh': acosh, 'atanh': atanh, 'ln': log, 'abs': Abs, 'sign': sign,
       'floor': floor, 'ceil': ceiling, 'max': Max, 'min': Min, 'erf': erf, 'atan2': atan2, 'factorial': factorial,
       'and': And, 'or': Or, 'not': Not}
_BACK = {'log': 'ln', 'Abs': 'abs', 'ceiling': 'ceil', 'Max': 'max', 'Min': 'min'}
_CONST = {'%pi': pi, '%e': E, '%i': I, '%inf': oo}
_REL = {'=': Eq, '!=': Ne, '<': Lt, '>': Gt, '<=': Le, '>=': Ge}
_RELB = {'==': '=', '!=': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>='}


def _dec(j, ctx):
    t = j['t']
    if t == 'n':
        return Rational(int(j['n']), int(j['d']))
    if t == 'f':
        return Float(j['v'])
    if t == 'b':
        return true if j['v'] else false
    if t == 's':
        n = j['name']
        if n in _CONST:
            return _CONST[n]
        if n not in ctx['syms']:
            # engineering quantities are taken as positive; the unknown being solved for is left free
            ctx['syms'][n] = Symbol(n) if n in ctx['free'] else Symbol(n, positive=True)
        return ctx['syms'][n]
    if t == 'm':
        return Matrix([[_dec(x, ctx) for x in r] for r in j['r']])
    a = [_dec(x, ctx) for x in j.get('a', [])]
    if t == '+':
        return Add(*a)
    if t == '*':
        return Mul(*a)
    if t == '^':
        return Pow(a[0], a[1])
    if t == 'rel':
        return _REL[j['op']](a[0], a[1])
    if t == 'fn':
        n = j['name']
        if n.startswith('@'):
            return Function(n[1:])(*a)
        if n == 'diff':
            return Derivative(a[0], (a[1], int(a[2]))) if len(a) > 2 else Derivative(a[0], a[1])
        if n == 'int':
            return Integral(a[0], a[1]) if len(a) == 2 else Integral(a[0], (a[1], a[2], a[3]))
        if n == 'if':
            return Piecewise((a[1], a[0]), (a[2], True))
        if n == 'log':
            return log(a[0], 10)
        if n in _FN:
            return _FN[n](*a)
        return Function(n)(*a)
    raise ValueError('cannot read ' + t)


def _num(n):
    return {'t': 'n', 'n': str(n), 'd': '1'}


def _enc(e):
    if isinstance(e, (list, tuple, Tuple)):
        return {'t': 'm', 'r': [[_enc(x)] for x in e]}
    if isinstance(e, MatrixBase):
        return {'t': 'm', 'r': [[_enc(e[i, k]) for k in range(e.cols)] for i in range(e.rows)]}
    if e is True or isinstance(e, BooleanTrue):
        return {'t': 'b', 'v': True}
    if e is False or isinstance(e, BooleanFalse):
        return {'t': 'b', 'v': False}
    e = sympify(e)
    if e.is_Integer:
        return _num(e.p)
    if e.is_Rational:
        return {'t': 'n', 'n': str(e.p), 'd': str(e.q)}
    if e.is_Float:
        return {'t': 'f', 'v': float(e)}
    if e is S.Pi:
        return {'t': 's', 'name': '%pi'}
    if e is S.Exp1:
        return {'t': 's', 'name': '%e'}
    if e is S.ImaginaryUnit:
        return {'t': 's', 'name': '%i'}
    if e is S.Infinity:
        return {'t': 's', 'name': '%inf'}
    if e is S.NegativeInfinity:
        return {'t': '*', 'a': [_num(-1), {'t': 's', 'name': '%inf'}]}
    if e.is_Symbol:
        return {'t': 's', 'name': e.name}
    if e.is_Add:
        return {'t': '+', 'a': [_enc(x) for x in e.args]}
    if e.is_Mul:
        return {'t': '*', 'a': [_enc(x) for x in e.args]}
    if e.is_Pow:
        return {'t': '^', 'a': [_enc(e.base), _enc(e.exp)]}
    if isinstance(e, exp):
        return {'t': '^', 'a': [{'t': 's', 'name': '%e'}, _enc(e.args[0])]}
    if isinstance(e, Relational):
        return {'t': 'rel', 'op': _RELB[e.rel_op], 'a': [_enc(e.lhs), _enc(e.rhs)]}
    if isinstance(e, Piecewise):
        return {'t': 'pw', 'a': [[_enc(x), _enc(c)] for x, c in e.args]}
    if isinstance(e, Derivative):
        r = _enc(e.expr)
        for v, n in e.variable_count:
            r = {'t': 'fn', 'name': 'diff', 'a': [r, _enc(v), _enc(Integer(n))]}
        return r
    if isinstance(e, AppliedUndef):
        return {'t': 'fn', 'name': '@' + e.func.__name__, 'a': [_enc(x) for x in e.args]}
    if isinstance(e, (And, Or, Not)):
        return {'t': 'fn', 'name': type(e).__name__.lower(), 'a': [_enc(x) for x in e.args]}
    if isinstance(e, (Integral, Sum, Limit)) or e.has(S.NaN, S.ComplexInfinity):
        raise ValueError('no closed form')
    if e.is_Function:
        n = type(e).__name__
        return {'t': 'fn', 'name': _BACK.get(n, n), 'a': [_enc(x) for x in e.args]}
    raise ValueError('cannot write ' + type(e).__name__)


def _names(j, out):
    if j['t'] == 's':
        out.add(j['name'])
    for x in j.get('a', []):
        _names(x, out)
    for r in j.get('r', []):
        for x in r:
            _names(x, out)
    return out


def icp_run(op, js):
    args = json.loads(js)
    ctx = {'syms': {}, 'free': set()}
    if op in ('solve', 'limit') and len(args) > 1:
        _names(args[1], ctx['free'])
    A = [_dec(a, ctx) for a in args]
    if op == 'integrate':
        r = integrate(A[0], A[1]) if len(A) == 2 else integrate(A[0], (A[1], A[2], A[3]))
        if r.has(Integral):
            return 'null'
    elif op == 'solve':
        eqs, vs = list(A[0]), list(A[1])
        sol = solve(eqs if len(eqs) > 1 else eqs[0], vs, dict=True)
        if not sol:
            return 'null'
        if len(vs) == 1:
            vals = [s[vs[0]] for s in sol if vs[0] in s]
            if not vals:
                return 'null'
            r = vals[0] if len(vals) == 1 else Matrix(vals)
        else:
            rows = [[s.get(v, v) for v in vs] for s in sol]
            r = Matrix(rows[0]) if len(rows) == 1 else Matrix(rows)
    elif op == 'limit':
        r = limit(A[0], A[1], A[2])
    elif op == 'simplify':
        r = simplify(A[0])
    elif op == 'factor':
        r = factor(A[0])
    elif op == 'apart':
        r = apart(A[0], A[1]) if len(A) > 1 else apart(A[0])
    elif op == 'summation':
        r = summation(A[0], (A[1], A[2], A[3]))
    elif op == 'laplace':
        r = laplace_transform(A[0], A[1], A[2], noconds=True)
    elif op == 'ilaplace':
        r = inverse_laplace_transform(A[0], A[1], A[2])
    elif op == 'dsolve':
        sol = dsolve(A[0], A[1])
        r = sol.rhs if isinstance(sol, Equality) else Matrix([s.rhs for s in sol])
    else:
        raise ValueError('unknown operation ' + op)
    return json.dumps(_enc(r))
