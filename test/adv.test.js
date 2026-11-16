// Advanced solver test: runs the same Python bridge the browser uses, under CPython with SymPy.
// Needs python3 and sympy (pip install sympy). Usage: node test/adv.test.js
const { spawnSync } = require('child_process'), Core = require('../dist/core.cjs');
Core.C.adv = (op, args) => {
  const r = spawnSync('python3', [__dirname + '/run_bridge.py', op], { input: JSON.stringify(args), encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  if (!out || out.startsWith('ERR') || out === 'null') { if (process.argv.includes('-v')) console.log('   bridge:', out || r.stderr.slice(-200)); return null; }
  return Core.fromJ(JSON.parse(out));
};
let pass = 0, fail = 0;
function t(lines, want) {
  lines = Array.isArray(lines) ? lines : [lines];
  const regions = lines.map((src, i) => ({ id: 'r' + i, type: 'math', src }));
  let got; try { const r = Core.evalDoc(regions).results.get('r' + (lines.length - 1)); got = r.err ? 'ERR: ' + r.err : r.text + (r.hint ? '  [unevaluated]' : ''); } catch (e) { got = 'THROW ' + e.stack.split('\n').slice(0, 2).join(' | '); }
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  if (ok) pass++; else { fail++; console.log(`FAIL ${JSON.stringify(lines)}\n   got:  ${got}\n   want: ${want}`); }
  if (process.argv.includes('-v')) console.log(lines[lines.length - 1], ' => ', got);
}
t('int(1/(x^3 + 1), x) ->', /atan/);
t('int(x^2/(x - 1)^2, x) ->', /ln\(x - 1\)/);
t('int(e^(-x^2), x, -inf, inf) ->', 'sqrt(π)');
t('int(sqrt(tan(x)), x) ->', /./);
t('int(1/(1 + x^4), x) ->', /atan/);
t('int(sin(x)/x, x) ->', /Si\(x\)/);
t('solve(x^3 + x - 1 = 0, x) ->', /./);
t('solve([x^2 + y^2 = 25, x + y = 7], [x, y]) ->', '[3, 4; 4, 3]');
t('solve(sin(x) = x/2, x) ->', /./);
t('limit((1 + 1/n)^n, n, inf) ->', 'e');
t('dsolve(diff(y(x), x, 2) + 4*y(x) = 0, y(x)) ->', /C1\*sin\(2\*x\) \+ C2\*cos\(2\*x\)|C2\*cos\(2\*x\) \+ C1\*sin\(2\*x\)/);
t('dsolve(EI*diff(y(x), x, 4) = w, y(x)) ->', /x\^4/);
t('dsolve(m*diff(u(t), t, 2) + k*u(t) = 0, u(t)) ->', /sin|cos/);
t('factor(x^2 - y^2) ->', '(x - y)*(x + y)');
t('factor(a^3 + b^3) ->', /a \+ b/);
t('apart(1/(x^2 - 1), x) ->', /1\/\(2\*\(x - 1\)\)/);
t('laplace(e^(-2*t), t, s) ->', '1/(s + 2)');
t('ilaplace(1/(s^2 + 4), s, t) ->', 'sin(2*t)/2');
t('sum(1/k^2, k, 1, inf) ->', 'π^2/6');
t('sin(x)^4 - cos(x)^4 -> simplify', /cos\(2\*x\)/);
t(['w := 12 kN/m', 'L := 6 m', 'x0 := solve(w*x^2/2 - w*L*x/2 + 20 kN*m = 0, x)', 'x0[1] ='], /m$/);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
