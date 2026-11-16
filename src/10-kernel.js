/* ================= iCalPad engine: expression kernel =================
   Expressions are small immutable trees:
     {t:'n',n,d}  exact rational      {t:'f',v}  float        {t:'s',name}  symbol
     {t:'+',a}    sum                 {t:'*',a}  product      {t:'^',a:[base,exp]}
     {t:'fn',name,a}  function call   {t:'m',r}  matrix       {t:'rel',op,a:[l,r]}
     {t:'b',v}    true / false
   The constructors below (addA, mulA, pow, fn, rel) keep every tree in a
   simplified, canonical form, so equal expressions get equal keys. */

class CalcError extends Error {}
class Pending extends Error { constructor() { super('Solving…'); } }

/* Hooks the app can set: adv(op,args) calls the optional advanced solver. */
const C = { adv: null, noAdv: false, userNames: null, sig: 4, system: 'auto', sysNow: 'SI', stmtUnits: [] };

// ---------- numbers ----------
const SAFE = Number.isSafeInteger;
const igcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; };
const F = v => ({ t: 'f', v });
function N(n, d = 1) {
  if (!SAFE(n) || !SAFE(d)) return F(n / d);
  if (d === 0) throw new CalcError('Division by zero');
  if (d < 0) { n = -n; d = -d; }
  const g = igcd(n, d) || 1;
  return { t: 'n', n: n / g, d: d / g };
}
const S = name => ({ t: 's', name });
const ZERO = N(0), ONE = N(1), MONE = N(-1), TWO = N(2), HALF = N(1, 2);
const PI = S('%pi'), E = S('%e'), IM = S('%i'), INF = S('%inf');
const TRUE = { t: 'b', v: true }, FALSE = { t: 'b', v: false };

const isNum = x => x.t === 'n' || x.t === 'f';
const val = x => x.t === 'n' ? x.n / x.d : x.v;
const isZero = x => isNum(x) && val(x) === 0;
const isOne = x => x.t === 'n' && x.n === 1 && x.d === 1;
const isInt = x => x.t === 'n' && x.d === 1;
const isSym = (x, name) => x.t === 's' && (name === undefined || x.name === name);

function nadd(a, b) {
  if (a.t === 'n' && b.t === 'n') { const n = a.n * b.d + b.n * a.d, d = a.d * b.d; if (SAFE(n) && SAFE(d)) return N(n, d); }
  return F(val(a) + val(b));
}
function nmul(a, b) {
  if (a.t === 'n' && b.t === 'n') { const n = a.n * b.n, d = a.d * b.d; if (SAFE(n) && SAFE(d)) return N(n, d); }
  return F(val(a) * val(b));
}
const nneg = a => a.t === 'n' ? N(-a.n, a.d) : F(-a.v);
function ninv(a) { if (val(a) === 0) throw new CalcError('Division by zero'); return a.t === 'n' ? N(a.d, a.n) : F(1 / a.v); }
function npowi(a, k) {                      // integer power, exact while it fits
  if (a.t === 'f') return F(Math.pow(a.v, k));
  if (k < 0) return npowi(ninv(a), -k);
  let n = 1, d = 1;
  for (let i = 0; i < k; i++) { n *= a.n; d *= a.d; if (!SAFE(n) || !SAFE(d)) return F(Math.pow(a.n / a.d, k)); }
  return N(n, d);
}

// ---------- keys, ordering ----------
function key(x) {
  if (x._k !== undefined) return x._k;
  let k;
  switch (x.t) {
    case 'n': k = x.d === 1 ? String(x.n) : x.n + '/' + x.d; break;
    case 'f': k = '#' + x.v; break;
    case 's': k = x.name; break;
    case 'b': k = x.v ? '#T' : '#F'; break;
    case 'm': k = '[' + x.r.map(r => r.map(key).join(',')).join(';') + ']'; break;
    default: k = (x.t === 'fn' ? x.name : x.t === 'rel' ? x.op : x.t) + '(' + x.a.map(key).join(',') + ')';
  }
  Object.defineProperty(x, '_k', { value: k, enumerable: false });
  return k;
}
function has(x, name) {
  switch (x.t) {
    case 's': return x.name === name;
    case 'n': case 'f': case 'b': return false;
    case 'm': return x.r.some(r => r.some(c => has(c, name)));
    default: return x.a.some(c => has(c, name));
  }
}
function symbolsOf(x, out = new Set()) {
  switch (x.t) {
    case 's': out.add(x.name); break;
    case 'n': case 'f': case 'b': break;
    case 'm': x.r.forEach(r => r.forEach(c => symbolsOf(c, out))); break;
    default: x.a.forEach(c => symbolsOf(c, out));
  }
  return out;
}

// ---------- units table (needed here for ordering; conversion lives in lang) ----------
const BASE = ['%m', '%kg', '%s', '%A', '%K', '%mol', '%cd'];
const BASEU = new Set(BASE);
const UNITS = {};
(() => {
  const U = (names, f, d) => { for (const n of names.split(' ')) UNITS[n] = { f, d }; };
  const D = (m = 0, kg = 0, s = 0, A = 0, K = 0, mol = 0, cd = 0) => [m, kg, s, A, K, mol, cd];
  const LBF = 4.4482216152605, FT = 0.3048, IN = 0.0254;
  U('m', 1, D(1)); U('mm', 1e-3, D(1)); U('cm', 1e-2, D(1)); U('km', 1e3, D(1)); U('um', 1e-6, D(1));
  U('in', IN, D(1)); U('ft', FT, D(1)); U('yd', 0.9144, D(1)); U('mi', 1609.344, D(1));
  U('kg', 1, D(0, 1)); U('gm', 1e-3, D(0, 1)); U('tonne', 1e3, D(0, 1)); U('lb lbm', 0.45359237, D(0, 1)); U('slug', 14.593902937206364, D(0, 1));
  U('s sec', 1, D(0, 0, 1)); U('ms', 1e-3, D(0, 0, 1)); U('min', 60, D(0, 0, 1)); U('hr', 3600, D(0, 0, 1)); U('day', 86400, D(0, 0, 1));
  U('N', 1, D(1, 1, -2)); U('kN', 1e3, D(1, 1, -2)); U('MN', 1e6, D(1, 1, -2)); U('lbf', LBF, D(1, 1, -2)); U('kip', 1e3 * LBF, D(1, 1, -2)); U('kgf', 9.80665, D(1, 1, -2));
  U('Pa', 1, D(-1, 1, -2)); U('kPa', 1e3, D(-1, 1, -2)); U('MPa', 1e6, D(-1, 1, -2)); U('GPa', 1e9, D(-1, 1, -2));
  U('psi', LBF / IN / IN, D(-1, 1, -2)); U('ksi', 1e3 * LBF / IN / IN, D(-1, 1, -2)); U('psf', LBF / FT / FT, D(-1, 1, -2)); U('ksf', 1e3 * LBF / FT / FT, D(-1, 1, -2));
  U('bar', 1e5, D(-1, 1, -2)); U('atm', 101325, D(-1, 1, -2));
  U('plf', LBF / FT, D(0, 1, -2)); U('klf', 1e3 * LBF / FT, D(0, 1, -2));
  U('pcf', LBF / FT ** 3, D(-2, 1, -2)); U('kcf', 1e3 * LBF / FT ** 3, D(-2, 1, -2));
  U('J', 1, D(2, 1, -2)); U('kJ', 1e3, D(2, 1, -2)); U('MJ', 1e6, D(2, 1, -2)); U('Wh', 3600, D(2, 1, -2)); U('kWh', 3.6e6, D(2, 1, -2)); U('cal', 4.184, D(2, 1, -2)); U('kcal', 4184, D(2, 1, -2)); U('BTU', 1055.05585262, D(2, 1, -2));
  U('W', 1, D(2, 1, -3)); U('kW', 1e3, D(2, 1, -3)); U('MW', 1e6, D(2, 1, -3)); U('hp', 745.6998715822702, D(2, 1, -3));
  U('V', 1, D(2, 1, -3, -1)); U('mV', 1e-3, D(2, 1, -3, -1)); U('kV', 1e3, D(2, 1, -3, -1)); U('ohm', 1, D(2, 1, -3, -2)); U('mA', 1e-3, D(0, 0, 0, 1));
  U('liter', 1e-3, D(3)); U('mL', 1e-6, D(3)); U('gal', 0.003785411784, D(3)); U('acre', 4046.8564224, D(2)); U('ha', 1e4, D(2));
  U('oz', 0.028349523125, D(0, 1)); U('ton', 907.18474, D(0, 1)); U('yr', 31557600, D(0, 0, 1));
  U('Hz', 1, D(0, 0, -1)); U('rpm', Math.PI / 30, D(0, 0, -1));
  U('amp', 1, D(0, 0, 0, 1)); U('K', 1, D(0, 0, 0, 0, 1)); U('mol', 1, D(0, 0, 0, 0, 0, 1)); U('cd', 1, D(0, 0, 0, 0, 0, 0, 1));
  U('g', 9.80665, D(1, 0, -2)); U('rad', 1, D());
})();
const isUnitName = n => BASEU.has(n) || (UNITS[n] !== undefined && !(C.userNames && C.userNames.has(n)));

function rank(x) {
  if (isNum(x)) return 0;
  const b = x.t === '^' ? x.a[0] : x;
  if (x.t === '^' && b.t === 's' && b.name === '%e') return 3;        // x^2 e^x reads better than e^x x^2
  if (b.t === 's') return b.name[0] === '$' || BASEU.has(b.name) ? 6 : b.name[0] === '%' ? 1 : 2;
  if (b.t === 'fn') return 4;
  if (b.t === '+') return 5;
  return 3;
}
function factorCmp(a, b) { const ra = rank(a), rb = rank(b); if (ra !== rb) return ra - rb; const ka = key(a), kb = key(b); return ka < kb ? -1 : ka > kb ? 1 : 0; }
function monoInfo(t) {
  const m = new Map(); let deg = 0;
  const put = f => {
    let b = f, e = 1;
    if (f.t === '^' && f.a[1].t === 'n') { b = f.a[0]; e = val(f.a[1]); }
    if (b.t === 's' && b.name[0] !== '%') { m.set(b.name, (m.get(b.name) || 0) + e); if (e > 0) deg += e; }
  };
  if (t.t === '*') t.a.forEach(put); else put(t);
  return { t, deg, m, k: key(t) };
}
function termCmp(A, B) {
  if (A.deg !== B.deg) return B.deg - A.deg;
  const names = [...new Set([...A.m.keys(), ...B.m.keys()])].sort();
  for (const n of names) { const a = A.m.get(n) || 0, b = B.m.get(n) || 0; if (a !== b) return b - a; }
  return A.k < B.k ? -1 : A.k > B.k ? 1 : 0;
}

// ---------- quantities: number × product of base units ----------
function isBaseFactor(f) {
  return (f.t === 's' && BASEU.has(f.name)) || (f.t === '^' && f.a[0].t === 's' && BASEU.has(f.a[0].name) && f.a[1].t === 'n');
}
function quant(x) {
  if (isNum(x)) return { v: val(x), u: null };
  if (isBaseFactor(x)) return { v: 1, u: x };
  if (x.t === '*') {
    let i = 0, v = 1;
    if (isNum(x.a[0])) { v = val(x.a[0]); i = 1; }
    for (let j = i; j < x.a.length; j++) if (!isBaseFactor(x.a[j])) return null;
    const rest = x.a.slice(i);
    return { v, u: rest.length === 1 ? rest[0] : { t: '*', a: rest } };
  }
  return null;
}
const ukey = q => q.u ? key(q.u) : '';
const mkq = (v, u) => u ? mulA([F(v), u]) : F(v);

// ---------- sums ----------
const add = (...xs) => addA(xs);
const mul = (...xs) => mulA(xs);
const neg = x => mulA([MONE, x]);
const sub = (a, b) => addA([a, mulA([MONE, b])]);
const div = (a, b) => mulA([a, pow(b, MONE)]);

function addA(xs) {
  const fl = [];
  for (const x of xs) { if (x.t === '+') for (const y of x.a) fl.push(y); else fl.push(x); }
  if (fl.some(x => x.t === 'm')) return matSum(fl);
  if (fl.some(x => x.t === 'rel')) {           // adding to an equation acts on both sides
    const L = [], R = []; let op = '=';
    for (const x of fl) { if (x.t === 'rel') { op = x.op; L.push(x.a[0]); R.push(x.a[1]); } else { L.push(x); R.push(x); } }
    return rel(op, addA(L), addA(R));
  }
  let c = ZERO; const m = new Map();
  for (const x of fl) {
    if (isNum(x)) { c = nadd(c, x); continue; }
    if (x.t === 'b') throw new CalcError('Cannot add a true/false value');
    let k = ONE, r = x;
    if (x.t === '*' && isNum(x.a[0])) { k = x.a[0]; r = x.a.length === 2 ? x.a[1] : { t: '*', a: x.a.slice(1) }; }
    const kk = key(r), en = m.get(kk);
    if (en) en.k = nadd(en.k, k); else m.set(kk, { k, r });
  }
  let ts = [];
  for (const { k, r } of m.values()) {
    const kv = val(k);
    if (kv === 0) continue;
    if (kv === 1) ts.push(r);
    else if (r.t === '*') ts.push({ t: '*', a: [k, ...r.a] });
    else ts.push({ t: '*', a: [k, r] });
  }
  if (ts.length > 1) ts = ts.map(monoInfo).sort(termCmp).map(o => o.t);
  if (!isZero(c)) ts.push(c);
  if (ts.length === 0) return c;
  if (ts.length === 1) return ts[0];
  return { t: '+', a: ts };
}

// ---------- products ----------
function mulA(xs) {
  const fl = [];
  for (const x of xs) { if (x.t === '*') for (const y of x.a) fl.push(y); else fl.push(x); }
  if (fl.some(x => x.t === 'm')) return matProd(fl);
  if (fl.some(x => x.t === 'rel')) {
    const i = fl.findIndex(x => x.t === 'rel'), r = fl[i], rest = fl.filter((_, j) => j !== i);
    return rel(r.op, mulA([r.a[0], ...rest]), mulA([r.a[1], ...rest]));
  }
  let c = ONE, again = false; const m = new Map();
  for (const x of fl) {
    if (isNum(x)) { c = nmul(c, x); continue; }
    if (x.t === 'b') throw new CalcError('Cannot multiply a true/false value');
    let b = x, e = ONE;
    if (x.t === '^') { b = x.a[0]; e = x.a[1]; }
    const k = key(b), en = m.get(k);
    if (en) en.e.push(e); else m.set(k, { b, e: [e], x });
  }
  if (val(c) === 0) return c.t === 'f' ? F(0) : ZERO;
  let fs = [];
  for (const { b, e, x } of m.values()) {
    if (e.length === 1) { fs.push(x); continue; }
    const p = pow(b, addA(e));
    if (isNum(p)) c = nmul(c, p);
    else if (p.t === '*') { again = true; fs.push(p); }
    else fs.push(p);
  }
  if (again) return mulA([c, ...fs]);
  if (val(c) === 0) return c.t === 'f' ? F(0) : ZERO;
  if (fs.length === 0) return c;
  if (fs.length > 1) fs.sort(factorCmp);
  if (val(c) === 1) return fs.length === 1 ? fs[0] : { t: '*', a: fs };
  if (fs.length === 1 && fs[0].t === '+' && val(c) === -1) return addA(fs[0].a.map(t => mulA([MONE, t])));
  return { t: '*', a: [c, ...fs] };
}

// ---------- powers ----------
function factorInt(m) {
  const fs = []; let p = 2;
  while (p * p <= m && p < 1e6) { if (m % p === 0) { let k = 0; while (m % p === 0) { m /= p; k++; } fs.push([p, k]); } p += p === 2 ? 1 : 2; }
  if (m > 1) fs.push([m, 1]);
  return fs;
}
function radical(b, e) {                    // rational ^ non-integer rational, e.g. 8^(1/2) -> 2*2^(1/2)
  const n = b.n, d = b.d, p = e.n, q = e.d;
  if (n < 0) {
    const r = radical(N(-n, d), e);
    if (q % 2 === 1) return Math.abs(p) % 2 === 1 ? mulA([MONE, r]) : r;
    if (q === 2) return mulA([pow(IM, N(p)), r]);
    throw new CalcError('Result is a complex number');
  }
  let coef = ONE; const raws = [];
  const part = (m, pp) => {
    if (m === 1) return;
    let out = ONE; const inside = [];
    for (const [pr, k] of factorInt(m)) {
      const t = k * pp, o = Math.floor(t / q), r = t - o * q;
      if (o !== 0) out = nmul(out, npowi(N(pr), o));
      if (r !== 0) inside.push([pr, r]);
    }
    coef = nmul(coef, out);
    if (inside.length) {
      let g = q; for (const [, r] of inside) g = igcd(g, r);
      let base = 1; for (const [pr, r] of inside) base *= Math.pow(pr, r / g);
      raws.push({ t: '^', a: [N(base), N(1, q / g)] });
    }
  };
  part(n, p); part(d, -p);
  if (!raws.length) return coef;
  if (isOne(coef) && raws.length === 1) return raws[0];
  raws.sort(factorCmp);
  return { t: '*', a: isOne(coef) ? raws : [coef, ...raws] };
}

function pow(b, e) {
  if (b.t === 'm') return matPow(b, e);
  if (b.t === 'b' || b.t === 'rel' || e.t === 'm') throw new CalcError('Cannot raise that to a power');
  if (isNum(e)) { const ev = val(e); if (ev === 0) return ONE; if (ev === 1) return b; }
  if (isNum(b)) {
    if (isOne(b)) return ONE;
    if (isNum(e)) {
      const bv = val(b), ev = val(e);
      if (bv === 0) { if (ev > 0) return b; throw new CalcError('Division by zero'); }
      if (b.t === 'n' && e.t === 'n') return e.d === 1 ? npowi(b, e.n) : radical(b, e);
      if (bv < 0 && !Number.isInteger(ev)) {
        if (e.t === 'n' && e.d % 2 === 1) return F((Math.abs(e.n) % 2 === 1 ? -1 : 1) * Math.pow(-bv, ev));
        if (e.t === 'n' && e.d === 2) return mulA([F(Math.pow(-bv, ev)), pow(IM, N(e.n))]);
        throw new CalcError('Result is a complex number');
      }
      return F(Math.pow(bv, ev));
    }
  }
  if (b.t === 's') {
    if (b.name === '%i' && isInt(e)) return [ONE, IM, MONE, mulA([MONE, IM])][((e.n % 4) + 4) % 4];
    if (b.name === '%e') {
      if (e.t === 'f') return F(Math.exp(e.v));
      if (e.t === 'fn' && e.name === 'ln') return e.a[0];
      if (e.t === '*' && e.a.length === 2 && isNum(e.a[0]) && e.a[1].t === 'fn' && e.a[1].name === 'ln') return pow(e.a[1].a[0], e.a[0]);
    }
  }
  if (b.t === '^') {
    const [bb, be] = b.a;
    if (isInt(e) || bb.t === 's' || (isNum(bb) && val(bb) > 0)) return pow(bb, mulA([be, e]));
  }
  if (b.t === '*') {
    if (isInt(e)) return mulA(b.a.map(f => pow(f, e)));
    if (isNum(e)) {                         // pull positive numbers and symbols out of roots
      const out = [], inn = [];
      for (const f of b.a) {
        if (isNum(f)) { if (val(f) > 0) out.push(pow(f, e)); else if (val(f) === -1) inn.push(f); else { out.push(pow(nneg(f), e)); inn.push(MONE); } }
        else if (f.t === 's' || (f.t === '^' && f.a[0].t === 's')) out.push(pow(f, e));
        else inn.push(f);
      }
      if (out.length) return mulA([...out, inn.length ? pow(mulA(inn), e) : ONE]);
    }
  }
  return { t: '^', a: [b, e] };
}

// ---------- relations ----------
const RELF = { '=': (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1e-300), '!=': (a, b) => !RELF['='](a, b), '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b || RELF['='](a, b), '>=': (a, b) => a >= b || RELF['='](a, b) };
function rel(op, l, r) {
  const ql = quant(l), qr = quant(r);
  if (ql && qr) {
    if (ukey(ql) !== ukey(qr) && ql.v !== 0 && qr.v !== 0) throw new CalcError('Both sides need the same kind of units to compare');
    return RELF[op](ql.v, qr.v) ? TRUE : FALSE;
  }
  return { t: 'rel', op, a: [l, r] };
}

// ---------- matrices ----------
const M = r => ({ t: 'm', r });
const shape = m => m.r.length + '×' + m.r[0].length;
function matSum(xs) {
  let acc = null;
  for (const x of xs) {
    if (x.t !== 'm') { if (isZero(x)) continue; throw new CalcError('Cannot add a single value to a matrix'); }
    if (!acc) { acc = x; continue; }
    if (shape(acc) !== shape(x)) throw new CalcError(`Matrix sizes do not match (${shape(acc)} + ${shape(x)})`);
    acc = M(acc.r.map((row, i) => row.map((c, j) => addA([c, x.r[i][j]]))));
  }
  return acc || ZERO;
}
function matMul2(a, b) {
  const am = a.t === 'm', bm = b.t === 'm';
  if (!am && !bm) return mulA([a, b]);
  if (am && !bm) return M(a.r.map(r => r.map(c => mulA([c, b]))));
  if (!am && bm) return M(b.r.map(r => r.map(c => mulA([a, c]))));
  const n = a.r.length, k = a.r[0].length, k2 = b.r.length, p = b.r[0].length;
  if (k !== k2) {
    if (k === 1 && p === 1 && n === k2) return addA(a.r.map((r, i) => mulA([r[0], b.r[i][0]])));   // column · column = dot product
    throw new CalcError(`Matrix sizes do not match (${shape(a)} · ${shape(b)})`);
  }
  const out = [];
  for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < p; j++) { const ts = []; for (let q = 0; q < k; q++) ts.push(mulA([a.r[i][q], b.r[q][j]])); row.push(addA(ts)); } out.push(row); }
  return out.length === 1 && out[0].length === 1 ? out[0][0] : M(out);
}
function matProd(fl) { let acc = fl[0]; for (let i = 1; i < fl.length; i++) acc = matMul2(acc, fl[i]); return acc; }
const transpose = m => M(m.r[0].map((_, j) => m.r.map(r => r[j])));
const identity = n => M(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? ONE : ZERO)));
function tidy(x) { return (isNum(x) || quant(x)) ? x : ratsimp(x); }
function isZeroT(x) { if (isNum(x)) return val(x) === 0; const q = quant(x); if (q) return q.v === 0; return isZero(ratsimp(x)); }
/* Gauss-Jordan on [A | B]; returns {X, det}. Works on numbers, quantities and symbols. */
function gaussJordan(A, B) {
  const n = A.length; if (A.some(r => r.length !== n)) throw new CalcError('That needs a square matrix');
  const a = A.map(r => r.slice()), b = B ? B.map(r => r.slice()) : null;
  let det = ONE;
  for (let c = 0; c < n; c++) {
    let p = -1, best = -1;
    for (let r = c; r < n; r++) {
      if (isZeroT(a[r][c])) continue;
      const q = quant(a[r][c]), mag = q ? Math.abs(q.v) : 1;
      if (mag > best) { best = mag; p = r; }
      if (!q) break;
    }
    if (p < 0) return { X: null, det: ZERO };
    if (p !== c) { [a[p], a[c]] = [a[c], a[p]]; if (b) [b[p], b[c]] = [b[c], b[p]]; det = mulA([MONE, det]); }
    const pv = a[c][c], ipv = pow(pv, MONE);
    det = tidy(mulA([det, pv]));
    for (let j = 0; j < n; j++) a[c][j] = tidy(mulA([a[c][j], ipv]));
    if (b) for (let j = 0; j < b[c].length; j++) b[c][j] = tidy(mulA([b[c][j], ipv]));
    for (let r = 0; r < n; r++) {
      if (r === c || isZeroT(a[r][c])) continue;
      const f = a[r][c];
      for (let j = 0; j < n; j++) a[r][j] = tidy(sub(a[r][j], mulA([f, a[c][j]])));
      if (b) for (let j = 0; j < b[r].length; j++) b[r][j] = tidy(sub(b[r][j], mulA([f, b[c][j]])));
    }
  }
  return { X: b, det };
}
function det(m) {
  const a = m.r, n = a.length; if (a.some(r => r.length !== n)) throw new CalcError('det() needs a square matrix');
  if (n === 1) return a[0][0];
  if (n === 2) return tidy(sub(mulA([a[0][0], a[1][1]]), mulA([a[0][1], a[1][0]])));
  if (n === 3) return tidy(addA([0, 1, 2].map(j => mulA([a[0][j], sub(mulA([a[1][(j + 1) % 3], a[2][(j + 2) % 3]]), mulA([a[1][(j + 2) % 3], a[2][(j + 1) % 3]]))]))));
  return gaussJordan(a, null).det;
}
function inverse(m) {
  const X = gaussJordan(m.r, identity(m.r.length).r).X;
  if (!X) throw new CalcError('This matrix has no inverse (its determinant is zero)');
  return M(X);
}
function matPow(b, e) {
  if (isSym(e, 'T')) return transpose(b);
  if (!isInt(e)) throw new CalcError('A matrix can only be raised to a whole-number power');
  if (e.n < 0) return matPow(inverse(b), N(-e.n));
  let acc = b; for (let i = 1; i < e.n; i++) acc = matMul2(acc, b);
  return acc;
}
/* Numeric eigen-solver. Symmetric: Jacobi rotations. Otherwise: QR iteration (real eigenvalues only). */
function eigen(m, wantVecs) {
  const n = m.r.length; if (m.r.some(r => r.length !== n)) throw new CalcError('Eigenvalues need a square matrix');
  let u = null; const A = [];
  for (const row of m.r) { const r = []; for (const c of row) { const q = quant(c); if (!q) throw new CalcError('Eigenvalues need a matrix of numbers'); if (q.v !== 0) { if (u === null) u = q.u; else if (key(u || ZERO) !== key(q.u || ZERO)) throw new CalcError('All entries need the same units'); } r.push(q.v); } A.push(r); }
  const scale = Math.max(...A.flat().map(Math.abs), 1e-300);
  let sym = true; for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (Math.abs(A[i][j] - A[j][i]) > 1e-9 * scale) sym = false;
  let vals, V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
  if (sym) {
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0; for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) off += A[i][j] * A[i][j];
      if (off < 1e-24 * scale * scale) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
        for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = cs * akp - sn * akq; A[k][q] = sn * akp + cs * akq; }
        for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = cs * apk - sn * aqk; A[q][k] = sn * apk + cs * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = cs * vkp - sn * vkq; V[k][q] = sn * vkp + cs * vkq; }
      }
    }
    vals = A.map((r, i) => r[i]);
  } else {
    let B = A.map(r => r.slice());
    for (let it = 0; it < 2000; it++) {
      const Q = Array.from({ length: n }, () => new Array(n).fill(0)), R = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        const v = B.map(r => r[j]);
        for (let k = 0; k < j; k++) { let d = 0; for (let i = 0; i < n; i++) d += Q[i][k] * B[i][j]; R[k][j] = d; for (let i = 0; i < n; i++) v[i] -= d * Q[i][k]; }
        const nv = Math.hypot(...v) || 1e-300; R[j][j] = nv; for (let i = 0; i < n; i++) Q[i][j] = v[i] / nv;
      }
      const nb = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => { let s = 0; for (let k = 0; k < n; k++) s += R[i][k] * Q[k][j]; return s; }));
      B = nb;
      let low = 0; for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) low = Math.max(low, Math.abs(B[i][j]));
      if (low < 1e-11 * scale) { vals = B.map((r, i) => r[i]); break; }
    }
    if (!vals) throw new CalcError('Could not find real eigenvalues for this matrix');
    if (wantVecs) for (let c = 0; c < n; c++) {          // inverse iteration for each eigenvalue
      const sh = A.map((r, i) => r.map((x, j) => F(x - (i === j ? vals[c] * (1 + 1e-7) + 1e-12 * scale : 0))));
      let v = Array.from({ length: n }, () => [F(1)]);
      for (let k = 0; k < 4; k++) { const X = gaussJordan(sh, v).X; if (!X) break; const nv = Math.hypot(...X.map(r => val(r[0]))); v = X.map(r => [F(val(r[0]) / nv)]); }
      for (let i = 0; i < n; i++) V[i][c] = val(v[i][0]);
    }
  }
  const order = vals.map((_, i) => i).sort((i, j) => vals[i] - vals[j]);
  if (!wantVecs) return M(order.map(i => [mkq(vals[i], u)]));
  return M(V.map(r => order.map(i => { const big = Math.max(...V.map(q => Math.abs(q[i]))); const sgn = V.reduce((s, q) => Math.abs(q[i]) === big ? Math.sign(q[i]) || 1 : s, 1); return F(r[i] / (big * sgn)); })));
}

// ---------- elementary functions ----------
const NF = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  ln: Math.log, log: Math.log10, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
  erf: x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; },
};
const ODD = new Set(['sin', 'tan', 'asin', 'atan', 'sinh', 'tanh', 'asinh', 'atanh', 'sign', 'erf']), EVEN = new Set(['cos', 'cosh', 'abs']);
const SQ2H = { t: '*', a: [HALF, { t: '^', a: [TWO, HALF] }] }, SQ3H = { t: '*', a: [HALF, { t: '^', a: [N(3), HALF] }] };

function piMultiple(x) {                    // x = k·π  ->  k (rational) or null
  if (isZero(x) && x.t === 'n') return ZERO;
  if (x === PI || isSym(x, '%pi')) return ONE;
  if (x.t === '*' && x.a.length === 2 && x.a[0].t === 'n' && isSym(x.a[1], '%pi')) return x.a[0];
  return null;
}
function sinExact(k) {                      // sin(kπ) for k a multiple of 1/12
  let m = k.n * 12 / k.d; if (!Number.isInteger(m)) return null;
  m = ((m % 24) + 24) % 24;
  let s = 1; if (m > 12) { m -= 12; s = -1; }
  if (m > 6) m = 12 - m;
  const v = { 0: ZERO, 2: HALF, 3: SQ2H, 4: SQ3H, 6: ONE }[m];
  return v ? (s < 0 ? mulA([MONE, v]) : v) : null;
}
function negLead(x) {                       // -u  ->  u, else null
  if (isNum(x)) return val(x) < 0 ? nneg(x) : null;
  if (x.t === '*' && isNum(x.a[0]) && val(x.a[0]) < 0) return mulA([MONE, x]);
  return null;
}
function elem(name, a) {
  const x = a[0];
  if (x.t === 'm') return M(x.r.map(r => r.map(c => fn(name, [c]))));
  if (x.t === 'f') {
    const v = NF[name](x.v);
    if (Number.isNaN(v) || (name === 'ln' || name === 'log') && x.v <= 0) throw new CalcError(`${name}(${+x.v.toPrecision(6)}) is not a real number`);
    return F(v);
  }
  const q = quant(x);
  if (q && q.u) {
    if (name === 'abs' || name === 'floor' || name === 'ceil') return mkq(NF[name](q.v), q.u);
    if (name === 'sign') return N(Math.sign(q.v));
    throw new CalcError(`${name}() needs a value without units. Divide by a unit first, for example x/m.`);
  }
  if (x.t === 'n') {
    if (name === 'abs') return N(Math.abs(x.n), x.d);
    if (name === 'sign') return N(Math.sign(x.n));
    if (name === 'floor') return N(Math.floor(x.n / x.d));
    if (name === 'ceil') return N(Math.ceil(x.n / x.d));
    if (x.n === 0) { if (['sin', 'tan', 'asin', 'atan', 'sinh', 'tanh', 'asinh', 'atanh', 'erf'].includes(name)) return ZERO; if (name === 'cos' || name === 'cosh') return ONE; if (name === 'acos') return mulA([HALF, PI]); }
    if ((name === 'ln' || name === 'log') && x.n <= 0) throw new CalcError(`${name}() of zero or a negative number is not a real number`);
    if (isOne(x)) { if (name === 'ln' || name === 'log' || name === 'acos' || name === 'acosh') return ZERO; if (name === 'asin') return mulA([HALF, PI]); if (name === 'atan') return mulA([N(1, 4), PI]); }
    if (name === 'log' && x.d === 1) { const l = Math.round(Math.log10(x.n)); if (Math.pow(10, l) === x.n) return N(l); }
    if (x.n === 1 && x.d === 2) { if (name === 'asin') return mulA([N(1, 6), PI]); if (name === 'acos') return mulA([N(1, 3), PI]); }
  }
  const k = piMultiple(x);
  if (k) {
    if (name === 'sin') { const r = sinExact(k); if (r) return r; }
    if (name === 'cos') { const r = sinExact(nadd(k, HALF)); if (r) return r; }
    if (name === 'tan') { const s = sinExact(k), c = sinExact(nadd(k, HALF)); if (s && c && !isZero(c)) return mulA([s, pow(c, MONE)]); }
  }
  if (name === 'ln') { if (isSym(x, '%e')) return ONE; if (x.t === '^' && isSym(x.a[0], '%e')) return x.a[1]; }
  if (name === 'abs' && (isSym(x, '%pi') || isSym(x, '%e'))) return x;
  const p = negLead(x);
  if (p) { if (ODD.has(name)) return mulA([MONE, fn(name, [p])]); if (EVEN.has(name)) return fn(name, [p]); }
  return null;
}

function qargs(a) {                         // flatten matrices, return quantities or null
  const out = [];
  for (const x of a) { if (x.t === 'm') { for (const r of x.r) for (const c of r) { const q = quant(c); if (!q) return null; out.push(q); } } else { const q = quant(x); if (!q) return null; out.push(q); } }
  return out;
}
function pickQ(a, better) {
  const qs = qargs(a); if (!qs || !qs.length) return null;
  let best = qs[0];
  for (const q of qs) { if (ukey(q) !== ukey(best) && q.v !== 0 && best.v !== 0) throw new CalcError('max() and min() need values with the same kind of units'); if (better(q.v, best.v)) best = q.u || !best.u ? q : { v: q.v, u: best.u }; }
  const allExact = a.every(x => x.t === 'n');
  return allExact ? a.find(x => val(x) === best.v) : mkq(best.v, best.u);
}
const needM = (x, f) => { if (x.t !== 'm') throw new CalcError(f + '() needs a matrix'); return x; };
const colVec = m => m.r[0].length === 1 ? m.r.map(r => r[0]) : m.r.length === 1 ? m.r[0] : null;

const FN = {
  sqrt: a => pow(a[0], HALF),
  cbrt: a => pow(a[0], N(1, 3)),
  root: a => { if (a.length !== 2) return null; return pow(a[0], pow(a[1], MONE)); },
  exp: a => pow(E, a[0]),
  log: a => a.length === 2 ? mulA([fn('ln', [a[0]]), pow(fn('ln', [a[1]]), MONE)]) : elem('log', a),
  sec: a => pow(fn('cos', a), MONE), csc: a => pow(fn('sin', a), MONE), cot: a => mulA([fn('cos', a), pow(fn('sin', a), MONE)]),
  atan2: a => { const q = qargs(a); if (q && q.length === 2 && (a[0].t === 'f' || a[1].t === 'f' || q[0].u || q[1].u)) return F(Math.atan2(q[0].v, q[1].v)); return null; },
  round: a => { const q = quant(a[0]); if (!q) return null; const k = a[1] ? Math.pow(10, val(a[1])) : 1; const v = Math.round(q.v * k) / k; return a[0].t === 'n' && k === 1 ? N(v) : mkq(v, q.u); },
  mod: a => { const q = qargs(a); if (!q || q.length !== 2) return null; const v = q[0].v - q[1].v * Math.floor(q[0].v / q[1].v); return a[0].t === 'n' && a[1].t === 'n' && isInt(a[0]) && isInt(a[1]) ? N(v) : mkq(v, q[0].u); },
  max: a => pickQ(a, (x, y) => x > y),
  min: a => pickQ(a, (x, y) => x < y),
  factorial: a => { if (!isInt(a[0]) || a[0].n < 0 || a[0].n > 170) return null; let r = 1; for (let i = 2; i <= a[0].n; i++) r *= i; return N(r); },
  if: a => { const c = a[0]; if (c.t === 'b') return c.v ? a[1] : a[2]; if (isNum(c)) return val(c) !== 0 ? a[1] : a[2]; return null; },
  and: a => a.every(x => x.t === 'b') ? (a.every(x => x.v) ? TRUE : FALSE) : null,
  or: a => a.every(x => x.t === 'b') ? (a.some(x => x.v) ? TRUE : FALSE) : null,
  not: a => a[0].t === 'b' ? (a[0].v ? FALSE : TRUE) : null,
  // matrices
  transpose: a => transpose(needM(a[0], 'transpose')),
  det: a => det(needM(a[0], 'det')),
  inv: a => a[0].t === 'm' ? inverse(a[0]) : pow(a[0], MONE),
  identity: a => { if (!isInt(a[0]) || a[0].n < 1) return null; return identity(a[0].n); },
  zeros: a => { if (!isInt(a[0])) return null; const c = a[1] ? a[1].n : 1; return M(Array.from({ length: a[0].n }, () => new Array(c).fill(ZERO))); },
  rows: a => N(needM(a[0], 'rows').r.length),
  cols: a => N(needM(a[0], 'cols').r[0].length),
  trace: a => addA(needM(a[0], 'trace').r.map((r, i) => r[i])),
  lsolve: a => { needM(a[0], 'lsolve'); const b = needM(a[1], 'lsolve'); const X = gaussJordan(a[0].r, b.r).X; if (!X) throw new CalcError('This system has no unique solution'); return M(X); },
  dot: a => { const u = colVec(needM(a[0], 'dot')), v = colVec(needM(a[1], 'dot')); if (!u || !v || u.length !== v.length) throw new CalcError('dot() needs two vectors of the same length'); return addA(u.map((x, i) => mulA([x, v[i]]))); },
  cross: a => { const u = colVec(needM(a[0], 'cross')), v = colVec(needM(a[1], 'cross')); if (!u || !v || u.length !== 3 || v.length !== 3) throw new CalcError('cross() needs two vectors with 3 entries'); return M([[sub(mulA([u[1], v[2]]), mulA([u[2], v[1]]))], [sub(mulA([u[2], v[0]]), mulA([u[0], v[2]]))], [sub(mulA([u[0], v[1]]), mulA([u[1], v[0]]))]]); },
  norm: a => { const u = colVec(needM(a[0], 'norm')); if (!u) throw new CalcError('norm() needs a vector'); return pow(addA(u.map(x => pow(x, TWO))), HALF); },
  eigenvals: a => { if (a[0].t !== 'm') return null; const A = a[0].r.every(r => r.every(quant)) ? a[0] : numericC(a[0]); return A.r.every(r => r.every(quant)) ? eigen(A, false) : null; },
  eigenvecs: a => { if (a[0].t !== 'm') return null; const A = a[0].r.every(r => r.every(quant)) ? a[0] : numericC(a[0]); return A.r.every(r => r.every(quant)) ? eigen(A, true) : null; },
  index: a => a[0].t === 'm' ? index(a[0], a.slice(1)) : null,
  lhs: a => a[0].t === 'rel' ? a[0].a[0] : null,
  rhs: a => a[0].t === 'rel' ? a[0].a[1] : null,
};

function fn(name, a) {
  const h = FN[name];
  if (h) { const r = h(a); if (r) return r; }
  else if (NF[name] && a.length === 1) { const r = elem(name, a); if (r) return r; }
  return { t: 'fn', name, a };
}

/* Rebuild a tree through the constructors, replacing symbols on the way. */
const BIND = { int: 1, sum: 1, prod: 1, limit: 1, diff: 1, taylor: 1, solve: 1, nsolve: 1, dsolve: 1 };
function subst(x, map) {
  switch (x.t) {
    case 's': { const v = map.get(x.name); return v === undefined ? x : v; }
    case 'n': case 'f': case 'b': return x;
    case 'm': return M(x.r.map(r => r.map(c => subst(c, map))));
    case '+': return addA(x.a.map(c => subst(c, map)));
    case '*': return mulA(x.a.map(c => subst(c, map)));
    case '^': return pow(subst(x.a[0], map), subst(x.a[1], map));
    case 'rel': return rel(x.op, subst(x.a[0], map), subst(x.a[1], map));
    default: {
      if (BIND[x.name] && x.a[1] && x.a[1].t === 's' && map.has(x.a[1].name)) {
        const m2 = new Map(map); m2.delete(x.a[1].name);
        return fn(x.name, x.a.map((c, i) => i === 0 ? subst(c, m2) : i === 1 ? c : subst(c, map)));
      }
      return fn(x.name, x.a.map(c => subst(c, map)));
    }
  }
}
const NOMAP = new Map();
const resimp = x => subst(x, NOMAP);
const subst1 = (x, name, v) => subst(x, new Map([[name, v]]));
function replaceKey(x, k, to) {             // structural replace of a sub-expression
  if (key(x) === k) return to;
  switch (x.t) {
    case 's': case 'n': case 'f': case 'b': return x;
    case 'm': return M(x.r.map(r => r.map(c => replaceKey(c, k, to))));
    case '+': return addA(x.a.map(c => replaceKey(c, k, to)));
    case '*': return mulA(x.a.map(c => replaceKey(c, k, to)));
    case '^': return pow(replaceKey(x.a[0], k, to), replaceKey(x.a[1], k, to));
    case 'rel': return rel(x.op, replaceKey(x.a[0], k, to), replaceKey(x.a[1], k, to));
    default: return fn(x.name, x.a.map(c => replaceKey(c, k, to)));
  }
}
function size(x) {                          // rough complexity measure
  switch (x.t) {
    case 's': case 'b': return 1;
    case 'n': return x.d === 1 ? 1 : 2;
    case 'f': return 1;
    case 'm': return 1 + x.r.reduce((s, r) => s + r.reduce((q, c) => q + size(c), 0), 0);
    default: return 1 + x.a.reduce((s, c) => s + size(c), 0);
  }
}
