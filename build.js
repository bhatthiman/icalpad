// Build: joins the source files in src/ into one self-contained index.html at the repository root,
// and writes dist/core.cjs (the math engine as a Node module) for the tests.
// Usage: node build.js
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

const parts = ['10-kernel.js', '20-algebra.js', '30-lang.js', '40-tex.js', '45-bridge.js'].map(rd);
const api = 'return { C, CalcError, Pending, evalDoc, parseStatement, parseExpr, runStatement, ev, tex, txt, disp, toTex, toText, texToHtml, mdToHtml, escH, latexToSrc, numericC, simplify, ratsimp, UNITS, FN, NF, BIND, symTex, fmtNum, key, size, subst, N, F, S, M, fn, addA, mulA, pow, rel, isNum, val, quant, symbolsOf, EMPTY_ENV, unitInfo, dimsOf, pickUnit, sameDims, PI, E, IM, INF, TRUE, FALSE, fromJ, unevaluated };';
const core = `const Core = (() => {\n'use strict';\n${parts.join('\n')}\n${api}\n})();\n`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'core.cjs'), core + 'module.exports = Core;\n');

const html = rd('shell.html')
  .replace('/*__CSS__*/', () => rd('style.css'))
  .replace('/*__CORE__*/', () => core)
  .replace('/*__DATA__*/', () => rd('50-data.js'))
  .replace('/*__APP__*/', () => rd('60-app.js').replace('"__BRIDGE__"', () => JSON.stringify(rd('bridge.py'))));
fs.writeFileSync(path.join(__dirname, 'index.html'), html);

console.log(`index.html  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
console.log(`dist/core.cjs  ${(Buffer.byteLength(core) / 1024).toFixed(1)} KB`);
