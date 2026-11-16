/* ================= iCalPad: reading answers from the advanced solver ================= */
function fromJ(j) {
  if (j === null) return null;
  const old = C.noAdv; C.noAdv = true;
  try { return fromJ0(j); } finally { C.noAdv = old; }
}
function fromJ0(j) {
  switch (j.t) {
    case 'n': return N(Number(j.n), Number(j.d));
    case 'f': return F(j.v);
    case 'b': return j.v ? TRUE : FALSE;
    case 's': return { '%pi': PI, '%e': E, '%i': IM, '%inf': INF }[j.name] || S(j.name);
    case '+': return addA(j.a.map(fromJ0));
    case '*': return mulA(j.a.map(fromJ0));
    case '^': return pow(fromJ0(j.a[0]), fromJ0(j.a[1]));
    case 'rel': return rel(j.op, fromJ0(j.a[0]), fromJ0(j.a[1]));
    case 'm': return M(j.r.map(r => r.map(fromJ0)));
    case 'fn': return fn(j.name, j.a.map(fromJ0));
    case 'pw': {                           // piecewise -> nested if()
      let acc = null;
      for (let i = j.a.length - 1; i >= 0; i--) { const e = fromJ0(j.a[i][0]), c = fromJ0(j.a[i][1]); acc = acc === null || (c.t === 'b' && c.v) ? e : fn('if', [c, e, acc]); }
      return acc;
    }
  }
  throw new CalcError('The advanced solver returned something unreadable');
}
