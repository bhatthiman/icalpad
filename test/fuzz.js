// Fuzz: random and mutated lines must never crash the engine (only friendly errors).
const fs = require('fs'), os = require('os'), path = require('path'), Core = require('../dist/core.cjs');
const LAST = path.join(os.tmpdir(), 'icalpad-fuzz-last.json');   // the input being tried, in case of a hang
const D = new Function(fs.readFileSync(__dirname + '/../src/50-data.js', 'utf8') + '; return {EXAMPLES, fromScript};')();
const seeds = D.EXAMPLES.flatMap(x => D.fromScript(x.s)).filter(r => r.type === 'math').map(r => r.src);
const bits = ['x', 'y', '2', '3.5', '+', '-', '*', '/', '^', '(', ')', '[', ']', ',', ';', '=', ':=', '->', ' ', 'sin(', 'sqrt(', 'int(', 'diff(', 'solve(', 'kN', 'm', 'mm', 'pi', 'e', 'inf', '<', '>=', 'simplify', 'if(', 'max(', '_', "'", '\\frac{', '}', '{', '\\sqrt', '\\int_', '\\sum_{', '\\left(', '\\right)', '\\begin{bmatrix}', '\\\\', '\\lim_', '\\sin', 'dx', '\\end{bmatrix}', '\\text{', '0', '1/0', 'limit(', 'taylor(', 'sum(', 'det(', 'inv(', 'lsolve(', 'eigenvals(', 'x^x', '!', '°', 'a', 'L', 'deg', 'factor', 'expand', '..', '|', '%', '&', '^^', '-1', '(-8)^(1/3)', '0^0', 'ln(0)', 'asin(2)', 'subs(', 'nsolve(', '[1,2;3,4]', '^T', '^-1', '^0.5', 'abs('];
let rnd = +process.argv[2] || 12345; const R = n => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; };
let crashes = 0, n = 0; const t0 = Date.now();
function tryDoc(lines) {
  n++; const t1 = Date.now(); fs.writeFileSync(LAST, JSON.stringify(lines));
  try { try { Core.evalDoc(lines.map((src, i) => ({ id: 'r' + i, type: 'math', src }))); for (const l of lines) Core.texToHtml(l); }
  catch (e) { crashes++; if (crashes <= 12) console.log('CRASH', JSON.stringify(lines), '\n   ', String(e.stack).split('\n').slice(0, 3).join(' | ')); } }
  finally { const dt = Date.now() - t1; if (dt > 400) console.log('SLOW', dt + ' ms', JSON.stringify(lines)); }
}
for (let i = 0; i < 6000; i++) { let s = ''; const k = 1 + R(12); for (let j = 0; j < k; j++) s += bits[R(bits.length)]; tryDoc([s]); }
for (let i = 0; i < 6000; i++) {            // mutate real lines
  let s = seeds[R(seeds.length)]; const m = R(4), p = R(s.length + 1);
  if (m === 0) s = s.slice(0, p) + bits[R(bits.length)] + s.slice(p); else if (m === 1) s = s.slice(0, p) + s.slice(p + 1 + R(3)); else if (m === 2) s = s.slice(0, p); else s = s + ' ' + bits[R(bits.length)];
  tryDoc(['w := 12 kN/m', 'L := 6 m', 'A := [1, 2; 3, 4]', s, 'f(x) := ' + seeds[R(seeds.length)].split(':=').pop().replace(/=.*$/, '')]);
}
console.log(`${n} documents, ${crashes} crashes, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(crashes ? 1 : 0);
