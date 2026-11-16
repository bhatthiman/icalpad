/* ================= iCalPad engine: algebra and calculus ================= */

// ---------- multivariate polynomials (recursive dense form) ----------
const BLOW = new Error('too big');
function Poly(nv) {
  let budget = 400000;
  const zero = k => k === nv ? ZERO : [];
  const isZ = p => Array.isArray(p) ? p.length === 0 : val(p) === 0;
  const trim = p => { while (p.length && isZ(p[p.length - 1])) p.pop(); return p; };
  const cst = (c, k) => { if (k === nv) return c; if (val(c) === 0) return []; let p = c; for (let i = nv; i > k; i--) p = [p]; return p; };
  const vr = (i, k) => k === i ? [zero(k + 1), cst(ONE, k + 1)] : [vr(i, k + 1)];
  const add = (a, b, k) => {
    if (k === nv) return nadd(a, b);
    const n = Math.max(a.length, b.length), r = new Array(n);
    for (let i = 0; i < n; i++) r[i] = i < a.length ? (i < b.length ? add(a[i], b[i], k + 1) : a[i]) : b[i];
    return trim(r);
  };
  const neg = (a, k) => k === nv ? nneg(a) : a.map(c => neg(c, k + 1));
  const sub = (a, b, k) => add(a, neg(b, k), k);
  const mul = (a, b, k) => {
    if (k === nv) { if (--budget < 0) throw BLOW; return nmul(a, b); }
    if (!a.length || !b.length) return [];
    const r = new Array(a.length + b.length - 1).fill(null);
    for (let i = 0; i < a.length; i++) {
      if (isZ(a[i])) continue;
      for (let j = 0; j < b.length; j++) { if (isZ(b[j])) continue; const t = mul(a[i], b[j], k + 1); r[i + j] = r[i + j] === null ? t : add(r[i + j], t, k + 1); }
    }
    for (let i = 0; i < r.length; i++) if (r[i] === null) r[i] = zero(k + 1);
    return trim(r);
  };
  const pw = (a, n, k) => { let r = cst(ONE, k), b = a; while (n > 0) { if (n & 1) r = mul(r, b, k); n >>= 1; if (n) b = mul(b, b, k); } return r; };
  const eq = (a, b, k) => { if (k === nv) return a.t === b.t && val(a) === val(b); if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i], k + 1)) return false; return true; };
  const isOneP = (p, k = 0) => k === nv ? isOne(p) || (p.t === 'f' && p.v === 1) : p.length === 1 && isOneP(p[0], k + 1);
  const divExact = (a, b, k) => {
    if (k === nv) { if (val(b) === 0) return null; return nmul(a, ninv(b)); }
    if (!a.length) return [];
    if (!b.length || a.length < b.length) return null;
    const r = a.slice(), db = b.length - 1, q = new Array(a.length - db);
    for (let i = a.length - 1; i >= db; i--) {
      const c = r[i];
      if (isZ(c)) { q[i - db] = zero(k + 1); continue; }
      const t = divExact(c, b[db], k + 1); if (t === null) return null;
      q[i - db] = t;
      for (let j = 0; j <= db; j++) r[i - db + j] = sub(r[i - db + j], mul(t, b[j], k + 1), k + 1);
    }
    for (let i = 0; i < db; i++) if (!isZ(r[i])) return null;
    return trim(q);
  };
  const prem = (a, b, k) => {
    let r = a.slice(); const db = b.length - 1, lb = b[db];
    while (r.length && r.length - 1 >= db) {
      const dr = r.length - 1, lr = r[dr], nr = new Array(dr);
      for (let i = 0; i < dr; i++) nr[i] = mul(lb, r[i], k + 1);
      for (let j = 0; j < db; j++) { const ix = dr - db + j; nr[ix] = sub(nr[ix], mul(lr, b[j], k + 1), k + 1); }
      r = trim(nr);
    }
    return r;
  };
  const content = (p, k) => { let g = p[0]; for (let i = 1; i < p.length; i++) g = gcd(g, p[i], k + 1); return g; };
  const divc = (p, c, k) => p.map(x => divExact(x, c, k + 1));
  const gcd = (a, b, k) => {
    if (k === nv) {
      if (a.t === 'n' && b.t === 'n') { if (a.n === 0) return N(Math.abs(b.n), b.d); if (b.n === 0) return N(Math.abs(a.n), a.d); const l = a.d / igcd(a.d, b.d) * b.d; return SAFE(l) ? N(igcd(a.n, b.n), l) : ONE; }
      return ONE;
    }
    if (!a.length) return b; if (!b.length) return a;
    const ca = content(a, k), cb = content(b, k);
    let A = divc(a, ca, k), B = divc(b, cb, k);
    if (A.some(x => x === null) || B.some(x => x === null)) return cst(ONE, k);
    if (A.length < B.length) [A, B] = [B, A];
    while (B.length) {
      const R = prem(A, B, k); A = B;
      if (R.length) { const cr = content(R, k); B = divc(R, cr, k); if (B.some(x => x === null)) return cst(ONE, k); } else B = R;
    }
    if (A.length === 1) A = [cst(ONE, k + 1)];
    const g = gcd(ca, cb, k + 1);
    return A.map(c => mul(c, g, k + 1));
  };
  const terms = (p, k, exps, out) => {
    if (k === nv) { if (val(p) !== 0) out.push({ c: p, e: exps.slice() }); return; }
    for (let i = 0; i < p.length; i++) { exps[k] = i; terms(p[i], k + 1, exps, out); }
    exps[k] = 0;
  };
  return { zero, isZ, cst, vr, add, sub, neg, mul, pw, eq, isOne: isOneP, divExact, gcd, terms: p => { const out = []; terms(p, 0, new Array(nv).fill(0), out); return out; } };
}

const rootKernel = (b, q) => ({ t: '^', a: [b, N(1, q)] });
function kernels(x, ks) {
  switch (x.t) {
    case 'n': case 'f': return;
    case '+': case '*': x.a.forEach(c => kernels(c, ks)); return;
    case '^': {
      const [b, e] = x.a;
      if (isInt(e)) { kernels(b, ks); return; }
      if (e.t === 'n') { const r = rootKernel(b, e.d); ks.set(key(r), r); return; }
    }
  }
  ks.set(key(x), x);
}
/* Turn an expression into numerator / denominator polynomials over its kernels. */
function ratForm(x, main) {
  const ks = new Map(); kernels(x, ks);
  const vars = [...ks.values()].sort((a, b) => key(a) < key(b) ? -1 : 1);
  if (main) { const i = vars.findIndex(v => isSym(v, main)); if (i > 0) vars.unshift(vars.splice(i, 1)[0]); }
  if (vars.length > 14) throw BLOW;
  const P = Poly(vars.length), idx = new Map(vars.map((v, i) => [key(v), i])), one = P.cst(ONE, 0);
  const conv = y => {
    if (y.t === 'n') return [P.cst(N(y.n), 0), P.cst(N(y.d), 0)];
    if (y.t === 'f') return [P.cst(y, 0), one];
    const i = idx.get(key(y)); if (i !== undefined) return [P.vr(i, 0), one];
    if (y.t === '+') {
      let [n, d] = conv(y.a[0]);
      for (let j = 1; j < y.a.length; j++) {
        const [n2, d2] = conv(y.a[j]);
        if (P.eq(d, d2, 0)) n = P.add(n, n2, 0);
        else if (P.isOne(d2)) n = P.add(n, P.mul(n2, d, 0), 0);
        else if (P.isOne(d)) { n = P.add(P.mul(n, d2, 0), n2, 0); d = d2; }
        else { n = P.add(P.mul(n, d2, 0), P.mul(n2, d, 0), 0); d = P.mul(d, d2, 0); }
      }
      return [n, d];
    }
    if (y.t === '*') {
      let [n, d] = conv(y.a[0]);
      for (let j = 1; j < y.a.length; j++) { const [n2, d2] = conv(y.a[j]); n = P.mul(n, n2, 0); if (!P.isOne(d2)) d = P.mul(d, d2, 0); }
      return [n, d];
    }
    if (y.t === '^') {
      const [b, e] = y.a;
      if (isInt(e)) {
        const [n, d] = conv(b), k = Math.abs(e.n); if (k > 80) throw BLOW;
        if (e.n > 0) return [P.pw(n, k, 0), P.pw(d, k, 0)];
        if (P.isZ(n)) throw new CalcError('Division by zero');
        return [P.pw(d, k, 0), P.pw(n, k, 0)];
      }
      if (e.t === 'n') { const v = P.vr(idx.get(key(rootKernel(b, e.d))), 0), k = Math.abs(e.n); if (k > 80) throw BLOW; return e.n > 0 ? [P.pw(v, k, 0), one] : [one, P.pw(v, k, 0)]; }
    }
    throw BLOW;
  };
  const [n, d] = conv(x);
  return { P, vars, n, d };
}
const termExpr = (t, vars) => mulA([t.c, ...vars.map((v, i) => t.e[i] ? pow(v, N(t.e[i])) : ONE)]);
function numContent(ts) {
  if (ts.some(t => t.c.t !== 'n')) return ONE;
  let g = 0, l = 1;
  for (const t of ts) { g = igcd(g, t.c.n); l = l / igcd(l, t.c.d) * t.c.d; if (!SAFE(l)) return ONE; }
  return N(g || 1, l);
}
function rationalize(x, st) {               // tidy decimals become exact fractions for the algebra
  switch (x.t) {
    case 'f': {
      st.float = true; const v = x.v;
      if (Number.isInteger(v) && Math.abs(v) < 1e15) return N(v);
      for (const k of [10, 100, 1e3, 1e4, 1e6, 1e8]) { const w = v * k; if (Math.abs(w) < 1e15 && Math.abs(w - Math.round(w)) < 1e-9 * Math.max(1, Math.abs(w))) return N(Math.round(w), k); }
      return x;
    }
    case '+': return addA(x.a.map(c => rationalize(c, st)));
    case '*': return mulA(x.a.map(c => rationalize(c, st)));
    case '^': return pow(rationalize(x.a[0], st), x.a[1].t === 'f' && Number.isInteger(x.a[1].v) ? N(x.a[1].v) : x.a[1]);
    default: return x;
  }
}
function floatify(x) {                      // back to decimals (coefficients only, not exponents)
  switch (x.t) {
    case 'n': return x.d === 1 ? x : F(x.n / x.d);
    case '+': return addA(x.a.map(floatify));
    case '*': return mulA(x.a.map(floatify));
    case '^': return pow(floatify(x.a[0]), x.a[1]);
    case 'm': return M(x.r.map(r => r.map(floatify)));
    default: return x;
  }
}
function deepArgs(x, f) {
  switch (x.t) {
    case '+': return addA(x.a.map(c => deepArgs(c, f)));
    case '*': return mulA(x.a.map(c => deepArgs(c, f)));
    case '^': return isInt(x.a[1]) ? pow(deepArgs(x.a[0], f), x.a[1]) : pow(f(x.a[0]), isNum(x.a[1]) ? x.a[1] : f(x.a[1]));
    case 'fn': return BIND[x.name] ? x : fn(x.name, x.a.map(f));
    default: return x;
  }
}
function prepRat(x, f, main) {
  const st = { float: false };
  const y = rationalize(deepArgs(x, f), st);
  return { st, R: ratForm(y, main) };
}
function splitContent(ts, nv) {             // numeric content, monomial content, primitive terms
  const c = numContent(ts), mono = new Array(nv).fill(Infinity);
  for (const t of ts) for (let i = 0; i < nv; i++) mono[i] = Math.min(mono[i], t.e[i]);
  const ic = ninv(c);
  return { c, mono, prim: ts.map(t => ({ c: nmul(t.c, ic), e: t.e.map((v, i) => v - mono[i]) })) };
}
const monoExpr = (mono, vars) => mulA(vars.map((v, i) => mono[i] ? pow(v, N(mono[i])) : ONE));
const leadSign = ts => { const t = ts[ts.length - 1]; return val(t.c) < 0 ? -1 : 1; };

/* Rational simplification: one fraction, common factors cancelled. */
function ratsimp(x) {
  if (isNum(x) || x.t === 's' || x.t === 'b') return x;
  if (x.t === 'm') return M(x.r.map(r => r.map(ratsimp)));
  if (x.t === 'rel') return rel(x.op, ratsimp(x.a[0]), ratsimp(x.a[1]));
  try {
    const { st, R } = prepRat(x, ratsimp);
    let { P, vars, n, d } = R;
    if (P.isZ(n)) return ZERO;
    if (!P.isOne(d)) {
      const g = P.gcd(n, d, 0);
      if (!P.isOne(g)) { const n2 = P.divExact(n, g, 0), d2 = P.divExact(d, g, 0); if (n2 && d2) { n = n2; d = d2; } }
    }
    const tn = P.terms(n), td = P.terms(d);
    let out;
    if (td.length === 1 && td[0].e.every(v => v === 0)) {
      const ic = ninv(td[0].c);
      out = addA(tn.map(t => termExpr({ c: nmul(t.c, ic), e: t.e }, vars)));
    } else {
      const a = splitContent(tn, vars.length), b = splitContent(td, vars.length);
      const sg = leadSign(b.prim);
      const coef = nmul(nmul(a.c, ninv(b.c)), N(sg));
      const pn = addA(a.prim.map(t => termExpr(t, vars)));
      const pd = addA(b.prim.map(t => termExpr({ c: nmul(t.c, N(sg)), e: t.e }, vars)));
      out = mulA([coef, monoExpr(a.mono, vars), pn, pow(mulA([monoExpr(b.mono, vars), pd]), MONE)]);
    }
    return st.float ? floatify(out) : out;
  } catch (e) { if (e === BLOW) return x; throw e; }
}
function expand(x) {
  if (isNum(x) || x.t === 's' || x.t === 'b') return x;
  if (x.t === 'm') return M(x.r.map(r => r.map(expand)));
  if (x.t === 'rel') return rel(x.op, expand(x.a[0]), expand(x.a[1]));
  try {
    const { st, R } = prepRat(x, expand);
    const { P, vars, n, d } = R, tn = P.terms(n), td = P.terms(d);
    let out;
    if (td.length === 1 && td[0].e.every(v => v === 0)) { const ic = ninv(td[0].c); out = addA(tn.map(t => termExpr({ c: nmul(t.c, ic), e: t.e }, vars))); }
    else { const den = pow(addA(td.map(t => termExpr(t, vars))), MONE); out = addA(tn.map(t => mulA([termExpr(t, vars), den]))); }
    return st.float ? floatify(out) : out;
  } catch (e) { if (e === BLOW) return x; throw e; }
}

// ---------- numeric polynomial helpers (arrays of rationals, low power first) ----------
function divisors(n) { const out = []; for (let i = 1; i * i <= n; i++) if (n % i === 0) { out.push(i); if (i * i !== n) out.push(n / i); } return out; }
const pevalN = (c, x) => { let r = ZERO; for (let i = c.length - 1; i >= 0; i--) r = nadd(nmul(r, x), c[i]); return r; };
const pderivN = c => c.slice(1).map((k, i) => nmul(k, N(i + 1)));
function pdivN(a, b) {                      // -> [quotient, remainder]
  const r = a.slice(), db = b.length - 1, q = []; const ilc = ninv(b[db]);
  for (let i = r.length - 1; i >= db; i--) { const t = nmul(r[i], ilc); q[i - db] = t; for (let j = 0; j <= db; j++) r[i - db + j] = nadd(r[i - db + j], nneg(nmul(t, b[j]))); }
  const rem = r.slice(0, db); while (rem.length && isZero(rem[rem.length - 1])) rem.pop();
  return [q, rem];
}
function rationalRoots(c0) {                // -> {roots: [N...], rest: coefficients left over}
  let c = c0.slice(); const roots = [];
  while (c.length > 1 && isZero(c[0])) { roots.push(ZERO); c.shift(); }
  for (; ;) {
    if (c.length < 2 || c.some(k => k.t !== 'n')) break;
    let l = 1; for (const k of c) l = l / igcd(l, k.d) * k.d;
    if (!SAFE(l)) break;
    const ci = c.map(k => k.n * (l / k.d)); if (ci.some(v => !SAFE(v))) break;
    const a0 = Math.abs(ci[0]), an = Math.abs(ci[ci.length - 1]); if (a0 > 1e12 || an > 1e12) break;
    const ps = divisors(a0), qs = divisors(an); if (ps.length * qs.length > 20000) break;
    let found = null;
    outer: for (const p of ps) for (const q of qs) { if (igcd(p, q) !== 1) continue; for (const s of [1, -1]) { const r = N(s * p, q); if (isZero(pevalN(c, r))) { found = r; break outer; } } }
    if (!found) break;
    roots.push(found); c = pdivN(c, [nneg(found), ONE])[0];
  }
  return { roots, rest: c };
}
function durandKerner(c) {                  // all complex roots of a float polynomial
  const n = c.length - 1, a = c.map(v => v / c[n]);
  let zr = [], zi = [];
  for (let k = 0; k < n; k++) { const ang = 2 * Math.PI * k / n + 0.4, r = 1 + Math.max(...a.slice(0, n).map(Math.abs)) ** (1 / n); zr.push(r * Math.cos(ang)); zi.push(r * Math.sin(ang)); }
  for (let it = 0; it < 500; it++) {
    let move = 0;
    for (let k = 0; k < n; k++) {
      let pr = 1, pi = 0;
      for (let j = n - 1; j >= 0; j--) { const t = pr * zr[k] - pi * zi[k] + a[j]; pi = pr * zi[k] + pi * zr[k]; pr = t; }
      let dr = 1, di = 0;
      for (let j = 0; j < n; j++) if (j !== k) { const xr = zr[k] - zr[j], xi = zi[k] - zi[j], t = dr * xr - di * xi; di = dr * xi + di * xr; dr = t; }
      const den = dr * dr + di * di || 1e-300, qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
      zr[k] -= qr; zi[k] -= qi; move = Math.max(move, Math.abs(qr) + Math.abs(qi));
    }
    if (move < 1e-14) break;
  }
  return zr.map((re, k) => [re, zi[k]]);
}

function factorTerms(ts, vars) {
  if (!ts.length) return ZERO;
  const { c, mono, prim } = splitContent(ts, vars.length);
  const sg = leadSign(prim), coef = nmul(c, N(sg));
  const pr = prim.map(t => ({ c: nmul(t.c, N(sg)), e: t.e }));
  const used = vars.map((_, i) => i).filter(i => pr.some(t => t.e[i] > 0));
  const parts = [coef, monoExpr(mono, vars)];
  if (used.length === 1 && pr.every(t => t.c.t === 'n')) {
    const i = used[0], cf = []; for (const t of pr) cf[t.e[i]] = t.c;
    for (let j = 0; j < cf.length; j++) if (!cf[j]) cf[j] = ZERO;
    const { roots, rest } = rationalRoots(cf), cnt = new Map();
    for (const r of roots) { const f = addA([mulA([N(r.d), vars[i]]), N(-r.n)]); const k = key(f); cnt.set(k, { f, n: (cnt.get(k) ? cnt.get(k).n : 0) + 1 }); }
    let lead = ONE; for (const r of roots) lead = nmul(lead, N(1, r.d));
    parts.push(lead);
    for (const { f, n } of cnt.values()) parts.push(pow(f, N(n)));
    parts.push(addA(rest.map((k, j) => mulA([k, pow(vars[i], N(j))]))));
  } else parts.push(addA(pr.map(t => termExpr(t, vars))));
  return mulA(parts);
}
function factor(x) {
  if (isNum(x)) { if (isInt(x) && Math.abs(x.n) > 3) { const fs = factorInt(Math.abs(x.n)); return { t: 'fn', name: 'factored', a: [x, ...fs.map(([p, k]) => k === 1 ? N(p) : { t: '^', a: [N(p), N(k)] })] }; } return x; }
  if (x.t === 's' || x.t === 'b') return x;
  if (x.t === 'm') return M(x.r.map(r => r.map(factor)));
  if (x.t === 'rel') return rel(x.op, factor(x.a[0]), factor(x.a[1]));
  try {
    const { st, R } = prepRat(x, ratsimp);
    let { P, vars, n, d } = R;
    if (P.isZ(n)) return ZERO;
    const g = P.gcd(n, d, 0);
    if (!P.isOne(g)) { const n2 = P.divExact(n, g, 0), d2 = P.divExact(d, g, 0); if (n2 && d2) { n = n2; d = d2; } }
    const out = mulA([factorTerms(P.terms(n), vars), pow(factorTerms(P.terms(d), vars), MONE)]);
    return st.float ? floatify(out) : out;
  } catch (e) { if (e === BLOW) return x; throw e; }
}
function trigSwap(x, from, to, sgn) {       // from(u)^2 -> 1 - to(u)^2
  switch (x.t) {
    case '+': return addA(x.a.map(c => trigSwap(c, from, to)));
    case '*': return mulA(x.a.map(c => trigSwap(c, from, to)));
    case '^': {
      const [b, e] = x.a;
      if (b.t === 'fn' && b.name === from && isInt(e) && e.n >= 2) return mulA([pow(sub(ONE, pow(fn(to, b.a), TWO)), N(Math.floor(e.n / 2))), e.n % 2 ? b : ONE]);
      return pow(trigSwap(b, from, to), e);
    }
    default: return x;
  }
}
function simplify(x) {
  if (x.t === 'm') return M(x.r.map(r => r.map(simplify)));
  if (x.t === 'rel') return rel(x.op, simplify(x.a[0]), simplify(x.a[1]));
  if (isNum(x) || x.t === 's' || x.t === 'b') return x;
  let best = x, bs = size(x);
  const offer = c => { const s = size(c); if (s <= bs) { best = c; bs = s; } };
  const r = ratsimp(x); offer(r);
  const k = key(r);
  if (k.includes('sin(') || k.includes('cos(')) {
    const ex = expand(r);
    offer(ratsimp(trigSwap(ex, 'cos', 'sin'))); offer(ratsimp(trigSwap(ex, 'sin', 'cos')));
  }
  return best;
}

// ---------- differentiation ----------
const DTAB = {
  sin: u => fn('cos', [u]), cos: u => neg(fn('sin', [u])), tan: u => pow(fn('cos', [u]), N(-2)),
  ln: u => pow(u, MONE), log: u => pow(mulA([u, fn('ln', [N(10)])]), MONE),
  asin: u => pow(sub(ONE, pow(u, TWO)), N(-1, 2)), acos: u => neg(pow(sub(ONE, pow(u, TWO)), N(-1, 2))), atan: u => pow(add(ONE, pow(u, TWO)), MONE),
  sinh: u => fn('cosh', [u]), cosh: u => fn('sinh', [u]), tanh: u => pow(fn('cosh', [u]), N(-2)),
  asinh: u => pow(add(pow(u, TWO), ONE), N(-1, 2)), acosh: u => pow(sub(pow(u, TWO), ONE), N(-1, 2)), atanh: u => pow(sub(ONE, pow(u, TWO)), MONE),
  abs: u => fn('sign', [u]), erf: u => mulA([TWO, pow(PI, N(-1, 2)), pow(E, neg(pow(u, TWO)))]),
};
function diff(f, X) {
  const x = X.name;
  if (!has(f, x)) return f.t === 'm' ? M(f.r.map(r => r.map(() => ZERO))) : ZERO;
  switch (f.t) {
    case 's': return ONE;
    case '+': return addA(f.a.map(t => diff(t, X)));
    case '*': { const out = []; for (let i = 0; i < f.a.length; i++) { if (!has(f.a[i], x)) continue; out.push(mulA(f.a.map((t, j) => j === i ? diff(t, X) : t))); } return addA(out); }
    case '^': {
      const [b, e] = f.a, hb = has(b, x), he = has(e, x);
      if (!he) return mulA([e, pow(b, add(e, MONE)), diff(b, X)]);
      if (!hb) return mulA([f, fn('ln', [b]), diff(e, X)]);
      return mulA([f, add(mulA([diff(e, X), fn('ln', [b])]), mulA([e, diff(b, X), pow(b, MONE)]))]);
    }
    case 'm': return M(f.r.map(r => r.map(c => diff(c, X))));
    case 'rel': return rel(f.op, diff(f.a[0], X), diff(f.a[1], X));
    case 'fn': {
      if (f.a.length === 1 && DTAB[f.name]) return mulA([DTAB[f.name](f.a[0]), diff(f.a[0], X)]);
      if (f.name === 'if') return fn('if', [f.a[0], diff(f.a[1], X), diff(f.a[2], X)]);
      return { t: 'fn', name: 'diff', a: [f, X] };
    }
  }
  return ZERO;
}

// ---------- polynomial coefficients in one variable ----------
function polyCoeffs(e, x, tidyUp = true) {
  const go = y => {
    if (!has(y, x)) return [y];
    switch (y.t) {
      case 's': return [ZERO, ONE];
      case '+': { const r = []; for (const t of y.a) { const c = go(t); if (!c) return null; for (let i = 0; i < c.length; i++) r[i] = r[i] ? add(r[i], c[i]) : c[i]; } for (let i = 0; i < r.length; i++) if (!r[i]) r[i] = ZERO; return r; }
      case '*': { let r = [ONE]; for (const t of y.a) { const c = go(t); if (!c) return null; r = conv(r, c); } return r; }
      case '^': { const e2 = y.a[1]; if (isInt(e2) && e2.n > 0 && e2.n <= 40) { const c = go(y.a[0]); if (!c) return null; let r = [ONE]; for (let i = 0; i < e2.n; i++) r = conv(r, c); return r; } return null; }
      default: return null;
    }
  };
  const conv = (a, b) => { const r = new Array(a.length + b.length - 1).fill(ZERO); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] = add(r[i + j], mulA([a[i], b[j]])); return r; };
  let c = go(e); if (!c) return null;
  if (tidyUp) c = c.map(k => isNum(k) ? k : ratsimp(k));
  while (c.length > 1 && isZero(c[c.length - 1])) c.pop();
  return c;
}
function numden(x) {
  if (x.t === 'n') return [N(x.n), N(x.d)];
  if (x.t === '^') { const e = x.a[1]; if (isNum(e) && val(e) < 0) return [ONE, pow(x.a[0], nneg(e))]; return [x, ONE]; }
  if (x.t === '*') { const n = [], d = []; for (const f of x.a) { const [a, b] = numden(f); n.push(a); d.push(b); } return [mulA(n), mulA(d)]; }
  return [x, ONE];
}
const polyExpr = (c, X) => addA(c.map((k, i) => mulA([k, pow(X, N(i))])));
function nval(x) {                          // float value or NaN
  try { const q = quant(numericC(x)); return q && !q.u ? q.v : NaN; } catch (e) { return NaN; }
}
function signProbe(x) {                     // sign of a symbolic expression, assuming positive symbols
  if (isNum(x)) return Math.sign(val(x));
  const syms = [...symbolsOf(x)].filter(s => s[0] !== '%'); let sg = null;
  for (const seed of [1.37, 2.71, 0.53]) {
    const m = new Map(syms.map((s, i) => [s, F(seed * (1 + 0.31 * i))]));
    const v = nval(subst(x, m)); if (!Number.isFinite(v)) return null;
    const s = Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
    if (sg === null) sg = s; else if (sg !== s) return null;
  }
  return sg;
}

// ---------- integration ----------
function linear(u, x) {
  if (!has(u, x)) return null;
  let a = diff(u, S(x)); if (has(a, x)) a = ratsimp(a);
  if (has(a, x) || isZero(a)) return null;
  return { a, b: subst1(u, x, ZERO) };
}
const ITAB = {
  sin: u => neg(fn('cos', [u])), cos: u => fn('sin', [u]), tan: u => neg(fn('ln', [fn('cos', [u])])),
  sinh: u => fn('cosh', [u]), cosh: u => fn('sinh', [u]), tanh: u => fn('ln', [fn('cosh', [u])]),
  ln: u => sub(mulA([u, fn('ln', [u])]), u),
  asin: u => add(mulA([u, fn('asin', [u])]), pow(sub(ONE, pow(u, TWO)), HALF)),
  acos: u => sub(mulA([u, fn('acos', [u])]), pow(sub(ONE, pow(u, TWO)), HALF)),
  atan: u => sub(mulA([u, fn('atan', [u])]), mulA([HALF, fn('ln', [add(ONE, pow(u, TWO))])])),
};
function intTable(f, x) {
  const X = S(x);
  if (f.t === '^') {
    const [b, e] = f.a;
    if (!has(e, x)) {
      const L = linear(b, x);
      if (L) {
        if (isNum(e) && val(e) === -1) return mulA([pow(L.a, MONE), fn('ln', [b])]);
        return mulA([pow(b, add(e, ONE)), pow(mulA([L.a, add(e, ONE)]), MONE)]);
      }
      if (b.t === 'fn' && isInt(e) && b.a.length === 1) {
        const Lu = linear(b.a[0], x), u = b.a[0];
        if (Lu) {
          const ia = pow(Lu.a, MONE), n = e.n, nm = b.name;
          if (n === 2 && nm === 'sin') return sub(mulA([HALF, X]), mulA([N(1, 4), ia, fn('sin', [mulA([TWO, u])])]));
          if (n === 2 && nm === 'cos') return add(mulA([HALF, X]), mulA([N(1, 4), ia, fn('sin', [mulA([TWO, u])])]));
          if (n === 2 && nm === 'tan') return sub(mulA([ia, fn('tan', [u])]), X);
          if (n === -2 && nm === 'cos') return mulA([ia, fn('tan', [u])]);
          if (n === -2 && nm === 'sin') return mulA([MONE, ia, fn('cos', [u]), pow(fn('sin', [u]), MONE)]);
          if (n === -1 && nm === 'cos') return mulA([ia, fn('ln', [mulA([add(ONE, fn('sin', [u])), pow(fn('cos', [u]), MONE)])])]);
          if (n === -1 && nm === 'sin') return mulA([ia, fn('ln', [fn('tan', [mulA([HALF, u])])])]);
          if (n === -2 && nm === 'cosh') return mulA([ia, fn('tanh', [u])]);
        }
      }
      if (e.t === 'n' && e.d === 2 && (e.n === 1 || e.n === -1)) {      // sqrt(c0 + c2 x^2) and its reciprocal
        const c = polyCoeffs(b, x);
        if (c && c.length === 3 && isZero(c[1])) {
          const sg = signProbe(c[2]), s0 = signProbe(c[0]);
          if (sg && s0 > 0) {
            const k = pow(mulA([N(sg), c[2]]), HALF), root = pow(b, HALF);
            const core = sg < 0 ? fn('asin', [mulA([X, k, pow(c[0], N(-1, 2))])]) : fn('ln', [add(mulA([X, k]), root)]);
            if (e.n === -1) return mulA([pow(k, MONE), core]);
            return add(mulA([HALF, X, root]), mulA([HALF, c[0], pow(k, MONE), core]));
          }
        }
      }
    } else if (!has(b, x)) {
      const L = linear(e, x);
      if (L) return mulA([f, pow(mulA([L.a, fn('ln', [b])]), MONE)]);
    }
  }
  if (f.t === 'fn' && f.a.length === 1 && ITAB[f.name]) {
    const L = linear(f.a[0], x);
    if (L) return mulA([pow(L.a, MONE), ITAB[f.name](f.a[0])]);
  }
  return null;
}
const isCyc = (t, x) => (t.t === 'fn' && ['sin', 'cos', 'sinh', 'cosh'].includes(t.name) && linear(t.a[0], x)) || (t.t === '^' && !has(t.a[0], x) && linear(t.a[1], x));
function intProduct(f, x, d) {
  const X = S(x); let n = 0; const rest = [];
  for (const t of f.a) {
    if (isSym(t, x)) n += 1;
    else if (t.t === '^' && isSym(t.a[0], x) && isInt(t.a[1]) && t.a[1].n > 0) n += t.a[1].n;
    else rest.push(t);
  }
  if (n > 0 && n <= 12 && rest.length === 1 && isCyc(rest[0], x)) {       // x^n · (sin | cos | exp): tabular by parts
    let P = pow(X, N(n)), T = rest[0]; const out = [];
    for (let k = 0; k <= n; k++) { T = integ(T, x, d + 1); if (!T) return null; out.push(mulA([N(k % 2 ? -1 : 1), P, T])); P = diff(P, X); }
    return addA(out);
  }
  if (n === 0 && rest.length === 2) {                                   // e^(ax) · sin|cos(bx)
    const ex = rest.find(t => t.t === '^' && isSym(t.a[0], '%e')), tr = rest.find(t => t.t === 'fn' && (t.name === 'sin' || t.name === 'cos'));
    if (ex && tr) {
      const La = linear(ex.a[1], x), Lb = linear(tr.a[0], x);
      if (La && Lb) {
        const a = La.a, b = Lb.a, v = tr.a[0], den = pow(add(pow(a, TWO), pow(b, TWO)), MONE);
        const inner = tr.name === 'sin' ? sub(mulA([a, fn('sin', [v])]), mulA([b, fn('cos', [v])])) : add(mulA([a, fn('cos', [v])]), mulA([b, fn('sin', [v])]));
        return mulA([ex, inner, den]);
      }
    }
  }
  return null;
}
function trigReduce(f, x) {                 // products and powers of sin/cos -> sums of single sin/cos
  const fs = f.t === '*' ? f.a : [f], trig = [], rest = [];
  for (const t of fs) {
    let b = t, e = 1;
    if (t.t === '^' && isInt(t.a[1]) && t.a[1].n > 0) { b = t.a[0]; e = t.a[1].n; }
    if (b.t === 'fn' && (b.name === 'sin' || b.name === 'cos') && has(b, x)) for (let i = 0; i < e; i++) trig.push(b); else rest.push(t);
  }
  if (trig.length < 2 || trig.length > 8) return null;
  let ts = [{ c: ONE, k: null, u: null }];
  for (const g of trig) {
    const nt = [];
    for (const t of ts) {
      if (!t.k) { nt.push({ c: t.c, k: g.name, u: g.a[0] }); continue; }
      const A = t.u, B = g.a[0], h = mulA([HALF, t.c]);
      if (t.k === 'sin' && g.name === 'sin') nt.push({ c: h, k: 'cos', u: sub(A, B) }, { c: neg(h), k: 'cos', u: add(A, B) });
      else if (t.k === 'cos' && g.name === 'cos') nt.push({ c: h, k: 'cos', u: sub(A, B) }, { c: h, k: 'cos', u: add(A, B) });
      else { const [s, c] = t.k === 'sin' ? [A, B] : [B, A]; nt.push({ c: h, k: 'sin', u: add(s, c) }, { c: h, k: 'sin', u: sub(s, c) }); }
    }
    ts = nt;
  }
  return mulA([...rest, addA(ts.map(t => mulA([t.c, fn(t.k, [ratsimp(t.u)])])))]);
}
function intQuad(m, n, a, b, c, X) {        // ∫ (m x + n)/(a x² + b x + c)
  const D = tidy(sub(pow(b, TWO), mulA([N(4), a, c]))), sg = isZeroT(D) ? 0 : signProbe(D);
  if (sg === null) return null;
  const Q = addA([mulA([a, pow(X, TWO)]), mulA([b, X]), c]), lin = addA([mulA([TWO, a, X]), b]);
  let J;
  if (sg < 0) { const s = pow(neg(D), HALF); J = mulA([TWO, pow(s, MONE), fn('atan', [mulA([lin, pow(s, MONE)])])]); }
  else if (sg > 0) { const s = pow(D, HALF); J = mulA([pow(s, MONE), fn('ln', [mulA([sub(lin, s), pow(add(lin, s), MONE)])])]); }
  const k1 = mulA([m, pow(mulA([TWO, a]), MONE)]);
  if (sg === 0) {                             // repeated root: Q = a (x - r)^2
    const xr = tidy(mulA([lin, pow(mulA([TWO, a]), MONE)]));
    return addA([mulA([k1, TWO, fn('ln', [xr])]), mulA([MONE, tidy(sub(n, mulA([k1, b]))), pow(mulA([a, xr]), MONE)])]);
  }
  return addA([mulA([k1, fn('ln', [Q])]), mulA([tidy(sub(n, mulA([k1, b]))), J])]);
}
function intRational(f, x) {
  const [n, d] = numden(ratsimp(f));
  const cd = polyCoeffs(d, x); if (!cd || cd.length < 2) return null;
  const cn = polyCoeffs(n, x); if (!cn) return null;
  const X = S(x), dd = cd.length - 1, ilc = pow(cd[dd], MONE);
  let r = cn.slice(); const q = [];
  for (let i = r.length - 1; i >= dd; i--) { const t = tidy(mulA([r[i], ilc])); q[i - dd] = t; for (let j = 0; j <= dd; j++) r[i - dd + j] = tidy(sub(r[i - dd + j], mulA([t, cd[j]]))); }
  r = r.slice(0, dd); while (r.length && isZeroT(r[r.length - 1])) r.pop();
  const res = addA(q.map((c, i) => mulA([c, pow(X, N(i + 1)), N(1, i + 1)])));
  if (!r.length) return res;
  let part = null;
  if (dd === 1) part = mulA([r[0], ilc, fn('ln', [polyExpr(cd, X)])]);
  else if (dd === 2) part = intQuad(r[1] || ZERO, r[0], cd[2], cd[1], cd[0], X);
  else if (cd.every(k => k.t === 'n') && r.every(k => k.t === 'n')) {     // partial fractions over rational roots
    const { roots, rest } = rationalRoots(cd);
    if (new Set(roots.map(key)).size !== roots.length || (rest.length !== 1 && rest.length !== 3)) return null;
    const dp = pderivN(cd), parts = []; let R2 = r.slice();
    for (const ro of roots) {
      const A = nmul(pevalN(r, ro), ninv(pevalN(dp, ro)));
      parts.push(mulA([A, fn('ln', [addA([mulA([N(ro.d), X]), N(-ro.n)])])]));
      const cof = pdivN(cd, [nneg(ro), ONE])[0];
      for (let i = 0; i < cof.length; i++) R2[i] = nadd(R2[i] || ZERO, nneg(nmul(A, cof[i])));
    }
    if (rest.length === 3) {
      let lin = [ONE]; for (const ro of roots) { const nl = new Array(lin.length + 1).fill(ZERO); for (let i = 0; i < lin.length; i++) { nl[i] = nadd(nl[i], nmul(lin[i], nneg(ro))); nl[i + 1] = nadd(nl[i + 1], lin[i]); } lin = nl; }
      while (R2.length && isZero(R2[R2.length - 1])) R2.pop();
      const [n2, rem] = R2.length ? pdivN(R2, lin) : [[], []]; if (rem.length) return null;
      const lcRest = pdivN(cd, lin)[0];
      const pq = intQuad(n2[1] || ZERO, n2[0] || ZERO, lcRest[2], lcRest[1], lcRest[0], X); if (!pq) return null;
      parts.push(pq);
    }
    part = addA(parts);
  }
  return part ? addA([res, part]) : null;
}
function substCandidates(f, x, out) {
  const push = u => { if (has(u, x) && !isSym(u, x)) out.set(key(u), u); };
  const walk = y => {
    switch (y.t) {
      case '+': case '*': y.a.forEach(walk); break;
      case '^': { const [b, e] = y.a; if (has(b, x) && !isSym(b, x)) { push(b); walk(b); } if (has(e, x)) { if (!linear(e, x)) push(e); walk(e); } break; }
      case 'fn': if (y.a.length === 1) { push(y); if (!linear(y.a[0], x)) push(y.a[0]); walk(y.a[0]); } break;
    }
  };
  walk(f);
}
function intSubst(f, x, d) {
  const X = S(x), U = S('%u' + d), cands = new Map(); substCandidates(f, x, cands);
  for (const u of cands.values()) {
    const du = diff(u, X); if (isZero(du)) continue;
    let q = mulA([f, pow(du, MONE)]);
    let g = replaceKey(q, key(u), U);
    if (has(g, x)) { q = ratsimp(q); g = replaceKey(q, key(u), U); }
    if (has(g, x)) {                        // linear u: substitute x = (U - b)/a everywhere
      const L = linear(u, x); if (!L) continue;
      g = subst1(g, x, mulA([sub(U, L.b), pow(L.a, MONE)]));
      if (has(g, x)) continue;
    }
    const r = integ(g, U.name, d + 1);
    if (r) return subst1(r, U.name, u);
  }
  return null;
}
function intParts(f, x, d) {                // ln, atan, asin … times something integrable
  const fs = f.t === '*' ? f.a : [f];
  const i = fs.findIndex(t => t.t === 'fn' && ['ln', 'atan', 'asin', 'acos', 'log'].includes(t.name) && has(t, x));
  if (i < 0) return null;
  const g = fs[i], v = integ(mulA(fs.filter((_, j) => j !== i)), x, d + 1); if (!v) return null;
  const r = integ(ratsimp(mulA([v, diff(g, S(x))])), x, d + 2);
  return r ? sub(mulA([v, g]), r) : null;
}
function integ(f, x, d = 0) {
  const X = S(x);
  if (!has(f, x)) return mulA([f, X]);
  if (d > 7) return null;
  if (f.t === 'm') { const r = f.r.map(row => row.map(c => integ(c, x, d))); return r.some(row => row.some(c => !c)) ? null : M(r); }
  if (f.t === '+') { const ps = []; for (const t of f.a) { const p = integ(t, x, d); if (!p) return null; ps.push(p); } return addA(ps); }
  if (f.t === '*') { const c = [], r = []; for (const t of f.a) (has(t, x) ? r : c).push(t); if (c.length) { const p = integ(mulA(r), x, d); return p && mulA([...c, p]); } }
  if (f.t === 's') return mulA([HALF, pow(X, TWO)]);
  if (f.t === 'fn' && f.name === 'if') return null;
  let r;
  if ((r = intTable(f, x))) return r;
  if (f.t === '*' && (r = intProduct(f, x, d))) return r;
  if ((r = intRational(f, x))) return r;
  const ex = expand(f);
  if (ex.t === '+' && key(ex) !== key(f) && (r = integ(ex, x, d + 1))) return r;
  const tr = trigReduce(f, x);
  if (tr && (r = integ(expand(tr), x, d + 1))) return r;
  if ((r = intSubst(f, x, d))) return r;
  if ((r = intParts(f, x, d))) return r;
  return null;
}
const hasInf = x => has(x, '%inf');
function simpson(g, a, b) {                 // adaptive Simpson
  const S3 = (a, fa, b, fb, fm) => (b - a) / 6 * (fa + 4 * fm + fb);
  const rec = (a, fa, b, fb, m, fm, whole, depth) => {
    const lm = (a + m) / 2, rm = (m + b) / 2, flm = g(lm), frm = g(rm);
    const L = S3(a, fa, m, fm, flm), R = S3(m, fm, b, fb, frm);
    if (depth <= 0 || Math.abs(L + R - whole) <= 1e-11 * (Math.abs(L + R) + 1e-30)) return L + R + (L + R - whole) / 15;
    return rec(a, fa, m, fm, lm, flm, L, depth - 1) + rec(m, fm, b, fb, rm, frm, R, depth - 1);
  };
  let tot = 0; const n = 16, h = (b - a) / n;
  for (let i = 0; i < n; i++) { const p = a + i * h, q = p + h, m = (p + q) / 2, fp = g(p), fq = g(q), fm = g(m); tot += rec(p, fp, q, fq, m, fm, S3(p, fp, q, fq, fm), 18); }
  return tot;
}
function nint(f, x, a, b) {                 // numeric definite integral, with units
  let qa, qb, fN;
  try { qa = quant(numericC(a)); qb = quant(numericC(b)); fN = numericC(f); } catch (e) { return null; }
  if (!qa || !qb || (ukey(qa) !== ukey(qb) && qa.v !== 0 && qb.v !== 0)) return null;
  const ux = qa.u || qb.u;
  if ([...symbolsOf(fN)].some(s => s !== x && !BASEU.has(s))) return null;
  let uf = null;
  try { const q = quant(subst1(fN, x, mkq((qa.v + qb.v) / 2 || 0.5, ux))); if (!q) return null; uf = q.u; } catch (e) { return null; }
  const g = compile(fN, [x]), v = simpson(t => g([t]), qa.v, qb.v);
  if (!Number.isFinite(v)) return null;
  return mulA([F(v), uf || ONE, ux || ONE]);
}
function defInt(f, x, a, b) {
  if (key(a) === key(b)) return ZERO;
  const Fx = integ(f, x);
  if (Fx && !hasInf(a) && !hasInf(b)) {
    try { return sub(subst1(Fx, x, b), subst1(Fx, x, a)); } catch (e) { if (!(e instanceof CalcError)) throw e; }
  }
  return null;
}

// ---------- limits, series, sums ----------
function limitNumeric(f, x, a, dir) {
  if ([...symbolsOf(f)].some(s => s !== x && s[0] !== '%' && s[0] !== '$')) return null;
  const av = nval(a); if (!Number.isFinite(av)) return null;
  const g = t => nval(subst1(f, x, F(t))), est = s => { const vs = [1e-3, 1e-5, 1e-7].map(h => g(av + s * h)); return Math.abs(vs[2] - vs[1]) <= 1e-4 * Math.max(1, Math.abs(vs[2])) ? vs[2] : (Math.abs(vs[2]) > 1e5 && Math.abs(vs[2]) > Math.abs(vs[1]) ? Math.sign(vs[2]) * Infinity : NaN); };
  const R = est(1), L = dir > 0 ? R : est(-1), Rr = dir < 0 ? L : R;
  if (Number.isNaN(L) || Number.isNaN(Rr)) return null;
  if (L === Rr || Math.abs(L - Rr) <= 1e-4 * Math.max(1, Math.abs(L))) {
    if (!Number.isFinite(Rr)) return Rr > 0 ? INF : neg(INF);
    const rn = Math.round(Rr * 1e4) / 1e4; return Math.abs(rn - Math.round(rn)) < 1e-9 ? N(Math.round(rn)) : F(Rr);
  }
  throw new CalcError('This limit is different from the left and from the right');
}
function limitAt(f, x, a, dir, numeric) {
  const X = S(x), fin = v => !hasInf(v) && !(v.t === 'f' && !Number.isFinite(v.v));
  try { const v = subst1(f, x, a); if (fin(v)) return v; } catch (e) { if (!(e instanceof CalcError)) throw e; }
  let [n, d] = numden(ratsimp(f));
  for (let i = 0; i < 6; i++) {
    let nv, dv;
    try { nv = subst1(n, x, a); dv = subst1(d, x, a); } catch (e) { if (!(e instanceof CalcError)) throw e; break; }
    if (!isZeroT(dv)) return ratsimp(mulA([nv, pow(dv, MONE)]));
    if (!isZeroT(nv)) break;
    [n, d] = numden(ratsimp(mulA([diff(n, X), pow(diff(d, X), MONE)])));
  }
  return numeric ? limitNumeric(f, x, a, dir) : null;
}
function limitOf(f, x, a, dir = 0, numeric = true) {
  if (hasInf(a)) {
    const sg = key(a) === key(INF) ? 1 : -1, t = '%t';
    return limitAt(ratsimp(subst1(f, x, mulA([N(sg), pow(S(t), MONE)]))), t, ZERO, 1, numeric);
  }
  return limitAt(f, x, a, dir, numeric);
}
function taylor(f, x, a, n) {
  const X = S(x), out = []; let d = f, fact = 1;
  for (let k = 0; k <= n; k++) {
    if (k > 0) { d = diff(d, X); fact *= k; }
    out.push(mulA([subst1(d, x, a), N(1, fact), pow(sub(X, a), N(k))]));
  }
  return addA(out);
}

// ---------- equation solving ----------
function countSym(x, name) {
  switch (x.t) {
    case 's': return +(x.name === name);
    case 'n': case 'f': case 'b': return 0;
    case 'm': return x.r.reduce((s, r) => s + r.reduce((q, c) => q + countSym(c, name), 0), 0);
    default: return x.a.reduce((s, c) => s + countSym(c, name), 0);
  }
}
const INVF = { sin: 'asin', cos: 'acos', tan: 'atan', asin: 'sin', acos: 'cos', atan: 'tan', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh', asinh: 'sinh', acosh: 'cosh', atanh: 'tanh' };
function isolate(lhs, rhs, x) {             // the unknown appears once: peel operations off one by one
  for (; ;) {
    if (lhs.t === 's') return [rhs];
    if (lhs.t === '+' || lhs.t === '*') {
      const w = lhs.a.find(t => has(t, x)), others = lhs.a.filter(t => t !== w);
      rhs = lhs.t === '+' ? sub(rhs, addA(others)) : mulA([rhs, pow(mulA(others), MONE)]);
      lhs = w; continue;
    }
    if (lhs.t === '^') {
      const [b, e] = lhs.a;
      if (has(b, x)) {
        const r = pow(rhs, pow(e, MONE));
        if (isInt(e) && e.n % 2 === 0) return [...(isolate(b, r, x) || []), ...(isolate(b, neg(r), x) || [])];
        lhs = b; rhs = r; continue;
      }
      rhs = mulA([fn('ln', [rhs]), pow(fn('ln', [b]), MONE)]); lhs = e; continue;
    }
    if (lhs.t === 'fn' && lhs.a.length === 1) {
      const u = lhs.a[0];
      if (lhs.name === 'ln') { rhs = pow(E, rhs); lhs = u; continue; }
      if (lhs.name === 'log') { rhs = pow(N(10), rhs); lhs = u; continue; }
      if (lhs.name === 'abs') return [...(isolate(u, rhs, x) || []), ...(isolate(u, neg(rhs), x) || [])];
      if (INVF[lhs.name]) { rhs = fn(INVF[lhs.name], [rhs]); lhs = u; continue; }
    }
    return null;
  }
}
function polyRoots(c) {                     // coefficients low power first -> list of roots, or null
  c = c.slice(); const out = [];
  while (c.length > 1 && isZeroT(c[c.length - 1])) c.pop();
  if (c.length > 1 && isZeroT(c[0])) { out.push(ZERO); while (c.length > 1 && isZeroT(c[0])) c.shift(); }
  const deg = c.length - 1;
  if (deg === 0) return out;
  if (deg === 1) return [...out, tidy(mulA([MONE, c[0], pow(c[1], MONE)]))];
  if (deg === 2) {
    const [c0, b, a] = c, D = tidy(sub(pow(b, TWO), mulA([N(4), a, c0]))), s = pow(D, HALF), i2a = pow(mulA([TWO, a]), MONE);
    if (isZeroT(D)) return [...out, tidy(mulA([MONE, b, i2a]))];
    return [...out, tidy(mulA([sub(s, b), i2a])), tidy(mulA([MONE, add(b, s), i2a]))];
  }
  if (c.every(k => k.t === 'n')) {
    const { roots, rest } = rationalRoots(c);
    for (const r of roots) if (!out.some(o => key(o) === key(r))) out.push(r);
    if (rest.length <= 3) { const more = polyRoots(rest); return more ? [...out, ...more] : null; }
    c = rest;
  }
  if (c.every(isNum)) {
    const sc = Math.max(...c.map(k => Math.abs(val(k))));
    for (const [re, im] of durandKerner(c.map(val))) {
      const clean = v => Math.abs(v - Math.round(v * 1e9) / 1e9) < 1e-12 ? Math.round(v * 1e9) / 1e9 : v;
      out.push(Math.abs(im) < 1e-9 * Math.max(1, Math.abs(re), sc * 0 + 1) ? F(clean(re)) : add(F(clean(re)), mulA([F(clean(im)), IM])));
    }
    return out.sort((p, q) => (isNum(p) ? val(p) : Infinity) - (isNum(q) ? val(q) : Infinity));
  }
  if (deg === 4 && isZeroT(c[1]) && isZeroT(c[3])) {      // biquadratic
    const ys = polyRoots([c[0], c[2], c[4]]); if (!ys) return null;
    for (const y of ys) { const s = pow(y, HALF); out.push(s, neg(s)); }
    return out;
  }
  return null;
}
function solveOne(eq, x) {
  const e = eq.t === 'rel' ? sub(eq.a[0], eq.a[1]) : eq;
  if (!has(e, x)) throw new CalcError(`The equation does not contain ${x}`);
  const [n] = numden(ratsimp(e));
  let sols = null;
  const c = polyCoeffs(n, x);
  if (c) sols = polyRoots(c);
  if (!sols && countSym(e, x) === 1) sols = isolate(e, ZERO, x);
  if (!sols && countSym(n, x) === 1) sols = isolate(n, ZERO, x);
  if (!sols) return null;
  const seen = new Set(), out = [];
  for (let s of sols) { if (!isNum(s) && !quant(s)) s = simplify(s); const k = key(s); if (!seen.has(k)) { seen.add(k); out.push(s); } }
  return out;
}
function solveLinear(eqs, vars) {
  const A = [], B = [], zero = new Map(vars.map(v => [v, ZERO]));
  for (const e of eqs) {
    const row = [];
    for (const v of vars) { const c = tidy(diff(e, S(v))); if (vars.some(w => has(c, w))) return null; row.push(c); }
    A.push(row); B.push([neg(subst(e, zero))]);
  }
  if (A.length !== vars.length) throw new CalcError(`${vars.length} unknowns need ${vars.length} equations (got ${A.length})`);
  const X = gaussJordan(A, B).X;
  if (!X) throw new CalcError('These equations have no unique solution');
  return M(X.map(r => [isNum(r[0]) || quant(r[0]) ? r[0] : simplify(r[0])]));
}
function nsolve(eq, x, guess) {
  const e = eq.t === 'rel' ? sub(eq.a[0], eq.a[1]) : eq, fN = numericC(e);
  const free = [...symbolsOf(fN)].filter(s => s !== x && !BASEU.has(s));
  if (free.length) throw new CalcError(`nsolve needs numbers for everything except ${x}. No value yet for: ${free.join(', ')}`);
  const g0 = compile(fN, [x]), g = t => g0([t]);
  let x0 = guess, f0 = g(x0);
  for (let i = 0; i < 60 && Math.abs(f0) > 0; i++) {         // Newton with a numeric slope
    const h = 1e-6 * Math.max(1, Math.abs(x0)), s = (g(x0 + h) - g(x0 - h)) / (2 * h);
    if (!Number.isFinite(s) || s === 0) break;
    const x1 = x0 - f0 / s, f1 = g(x1);
    if (!Number.isFinite(f1)) break;
    if (Math.abs(x1 - x0) <= 1e-13 * Math.max(1, Math.abs(x1))) { x0 = x1; f0 = f1; break; }
    x0 = x1; f0 = f1;
  }
  if (Number.isFinite(f0) && Math.abs(f0) < 1e-8 * Math.max(1, Math.abs(g(x0 + 1) - f0))) return F(Math.abs(x0 - Math.round(x0 * 1e10) / 1e10) < 1e-13 ? Math.round(x0 * 1e10) / 1e10 : x0);
  let step = Math.max(1, Math.abs(guess)) * 0.1;             // otherwise look for a sign change and bisect
  for (let i = 0; i < 60; i++, step *= 1.6) {
    for (const [lo, hi] of [[guess - step, guess], [guess, guess + step]]) {
      let a = lo, b = hi, fa = g(a), fb = g(b);
      if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb <= 0) {
        for (let k = 0; k < 200; k++) { const m = (a + b) / 2, fm = g(m); if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; } }
        return F((a + b) / 2);
      }
    }
  }
  throw new CalcError('No root found near that starting value. Try a different guess.');
}

// ---------- function table: calculus and algebra ----------
function advTry(op, args) { if (C.adv && !C.noAdv) { const r = C.adv(op, args); if (r) return r; } return null; }
const needVar = (v, usage) => { if (!v || v.t !== 's') throw new CalcError('Write it as ' + usage); return v; };
const listOf = x => x.t === 'm' ? x.r.flat() : [x];
Object.assign(FN, {
  diff: a => { const v = needVar(a[1], 'diff(expression, x) or diff(expression, x, 2)'); const n = a[2] ? (isInt(a[2]) ? a[2].n : 1) : 1; let f = a[0]; for (let i = 0; i < n; i++) f = diff(f, v); return f; },
  int: a => {
    const v = needVar(a[1], 'int(expression, x) or int(expression, x, from, to)');
    if (a.length === 2) return integ(a[0], v.name) || advTry('integrate', a);
    if (a.length === 4) return defInt(a[0], v.name, a[2], a[3]) || advTry('integrate', a) || nint(a[0], v.name, a[2], a[3]);
    throw new CalcError('Write it as int(expression, x) or int(expression, x, from, to)');
  },
  limit: a => { const v = needVar(a[1], 'limit(expression, x, value)'); if (!a[2]) throw new CalcError('Write it as limit(expression, x, value)'); const d = a[3] ? val(a[3]) : 0; return limitOf(a[0], v.name, a[2], d, false) || advTry('limit', a.slice(0, 3)) || limitOf(a[0], v.name, a[2], d, true); },
  taylor: a => { const v = needVar(a[1], 'taylor(expression, x, point, order)'); const [p, n] = a.length >= 4 ? [a[2], a[3]] : [ZERO, a[2] || N(5)]; if (!isInt(n) || n.n < 0 || n.n > 30) throw new CalcError('The order must be a whole number from 0 to 30'); return taylor(a[0], v.name, p, n.n); },
  sum: a => bigOp(a, addA, 'sum'),
  prod: a => bigOp(a, mulA, 'prod'),
  solve: a => {
    const eqs = listOf(a[0]).map(e => e.t === 'rel' ? sub(e.a[0], e.a[1]) : e);
    let vars = a[1] ? listOf(a[1]) : null;
    if (!vars) { const fs = [...new Set(eqs.flatMap(e => [...symbolsOf(e)]))].filter(s => s[0] !== '%' && s[0] !== '$'); if (fs.length !== eqs.length) throw new CalcError('Say what to solve for: solve(equation, x)'); vars = fs.map(S); }
    if (vars.some(v => v.t !== 's')) throw new CalcError('Solve for a plain name, for example solve(x^2 = 4, x). If that name already has a value, pick a new name.');
    if (eqs.length === 1 && vars.length === 1) {
      const s = solveOne(eqs[0], vars[0].name);
      if (s) { if (!s.length) throw new CalcError('This equation has no solution'); return s.length === 1 ? s[0] : M(s.map(v => [v])); }
      return advTry('solve', [M([eqs]), M([vars])]);
    }
    return solveLinear(eqs, vars.map(v => v.name)) || advTry('solve', [M([eqs]), M([vars])]);
  },
  nsolve: a => { const v = needVar(a[1], 'nsolve(equation, x, starting value)'); const q = a[2] ? quant(numericC(a[2])) : { v: 1 }; if (!q) throw new CalcError('The starting value must be a number'); return nsolve(a[0], v.name, q.v); },
  subs: a => {
    let x = a[0];
    for (let i = 1; i < a.length;) {
      if (a[i].t === 'rel') { x = subst1(x, needVar(a[i].a[0], 'subs(expression, x, value)').name, a[i].a[1]); i += 1; }
      else { x = subst1(x, needVar(a[i], 'subs(expression, x, value)').name, a[i + 1] || ZERO); i += 2; }
    }
    return x;
  },
  expand: a => expand(a[0]),
  factor: a => { const r = factor(a[0]); if (C.adv && !C.noAdv && symbolsOf(a[0]).size > 1) return advTry('factor', a) || r; return r; },
  simplify: a => { const r = simplify(a[0]); if (C.adv && !C.noAdv) { const s = advTry('simplify', a); if (s && size(s) < size(r)) return s; } return r; },
  ratsimp: a => ratsimp(a[0]),
  float: a => numericC(a[0], true),
  numer: a => numden(ratsimp(a[0]))[0],
  denom: a => numden(ratsimp(a[0]))[1],
  collect: a => { const v = needVar(a[1], 'collect(expression, x)'); const c = polyCoeffs(expand(a[0]), v.name); return c ? { t: '+', a: c.map((k, i) => mulA([k.t === '+' ? factorOut(k) : k, pow(v, N(i))])).filter(t => !isZero(t)).reverse(), held: true } : null; },
  coeffs: a => { const v = needVar(a[1], 'coeffs(expression, x)'); const c = polyCoeffs(expand(a[0]), v.name); return c ? M(c.map(k => [k])) : null; },
  dsolve: a => advTry('dsolve', a),
  apart: a => advTry('apart', a),
  laplace: a => advTry('laplace', a),
  ilaplace: a => advTry('ilaplace', a),
});
const factorOut = k => k;
function bigOp(a, combine, name) {
  const v = needVar(a[1], `${name}(expression, k, from, to)`);
  if (a.length !== 4) throw new CalcError(`Write it as ${name}(expression, k, from, to)`);
  if (!isInt(a[2]) || !isInt(a[3])) return name === 'sum' ? advTry('summation', a) : null;
  if (a[3].n - a[2].n > 20000) throw new CalcError('That is more than 20,000 terms');
  const ts = []; for (let k = a[2].n; k <= a[3].n; k++) ts.push(subst1(a[0], v.name, N(k)));
  return combine(ts);
}
