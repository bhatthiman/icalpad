// Runs every example worksheet through the engine and reports any error. Usage: node test/data.test.js [-v]
const fs = require('fs'), Core = require('../dist/core.cjs');
const D = new Function(fs.readFileSync(__dirname + '/../src/50-data.js', 'utf8') + '; return {EXAMPLES, HELP, fromScript};')();
let bad = 0; const verbose = process.argv.includes('-v');
for (const item of D.EXAMPLES) {
  const regions = D.fromScript(item.s).map((r, i) => ({ id: 'r' + i, ...r }));
  const { results } = Core.evalDoc(regions);
  for (const rg of regions) {
    const r = results.get(rg.id); if (!r) continue;
    if (r.err || r.pending) { bad++; console.log(`ERROR in "${item.name}": ${rg.src || rg.exprs}\n    ${r.err || 'pending'}`); }
    else if (verbose && rg.type === 'math') console.log(`  ${rg.src}   =>   ${r.text}${r.check !== undefined ? '  [' + (r.check ? 'OK' : 'NG') + ']' : ''}${r.hint ? '  (unevaluated ' + r.hint + ')' : ''}`);
    else if (verbose && rg.type === 'plot') console.log(`  plot ${rg.exprs}: x in ${r.xu.text || '-'}, y in ${r.yu.text || '-'}, f(mid)=${r.curves.map(c => c.f([(r.a + r.b) / 2, (r.p0 + r.p1) / 2]).toPrecision(4))}`);
  }
  if (verbose) console.log('--- ' + item.name);
}
for (const [, rows] of D.HELP) for (const [src] of rows) { try { Core.texToHtml(src); } catch (e) { bad++; console.log('help', src, e.message); } }
console.log(bad ? bad + ' problems' : 'all templates and examples run clean');
process.exit(bad ? 1 : 0);
