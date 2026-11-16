/* ================= iCalPad: LaTeX -> HTML typesetter =================
   A small renderer for the LaTeX subset the engine writes and people commonly type:
   fractions, roots, scripts, \left…\right, matrices, big operators, Greek, text. */

const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TSYM = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', pi: 'π',
  infty: '∞', partial: '∂', nabla: '∇', circ: '∘', degree: '°', ldots: '…', dots: '…', cdots: '⋯', forall: '∀', exists: '∃', angle: '∠', prime: '′', ell: 'ℓ', hbar: 'ℏ',
  lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|',
};
const TBIN = { cdot: '·', times: '×', pm: '±', mp: '∓', div: '÷', ast: '∗', cup: '∪', cap: '∩' };
const TREL = { le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', Leftrightarrow: '⇔', implies: '⇒', in: '∈', propto: '∝', perp: '⊥', parallel: '∥', ll: '≪', gg: '≫', coloneqq: ':=' };
const TFN = new Set('sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh ln log exp det min max gcd'.split(' '));
const TTEXT = new Set('text mathrm operatorname mathit mathbf textit textbf mathsf textrm'.split(' '));
const DELIM = {
  '(': 'M8 2 Q0 50 8 98', ')': 'M2 2 Q10 50 2 98', '[': 'M8 2 H3 V98 H8', ']': 'M2 2 H7 V98 H2', '|': 'M5 0 V100',
  '{': 'M8 2 Q4.5 2 4.5 10 V42 Q4.5 50 1.5 50 Q4.5 50 4.5 58 V90 Q4.5 98 8 98', '}': 'M2 2 Q5.5 2 5.5 10 V42 Q5.5 50 8.5 50 Q5.5 50 5.5 58 V90 Q5.5 98 2 98',
  '⌊': 'M4 0 V98 H9', '⌋': 'M6 0 V98 H1', '⌈': 'M9 2 H4 V100', '⌉': 'M1 2 H6 V100', '⟨': 'M8 2 L2 50 L8 98', '⟩': 'M2 2 L8 50 L2 98',
};
const dsvg = (ch, side) => `<svg class="dv ${side}" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true"><path d="${DELIM[ch]}"/></svg>`;
const RADICAL = '<svg class="rs" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0.4 60 L2.6 55 L5.2 95 L9.4 1.5 L10 1.5"/></svg>';

function texLex(src) {
  const out = []; let i = 0; const n = src.length;
  const braceGroup = () => { while (src[i] === ' ') i++; if (src[i] !== '{') return ''; let d = 1, j = i + 1; while (j < n && d) { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; } const s = src.slice(i + 1, j - 1); i = j; return s; };
  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (m) {
        const cmd = m[1]; i += m[0].length;
        if (TTEXT.has(cmd)) out.push({ k: 'text', cmd, v: braceGroup() });
        else if (cmd === 'begin' || cmd === 'end') out.push({ k: cmd, v: braceGroup() });
        else if (cmd === 'quad') out.push({ k: 'space', w: 3 }); else if (cmd === 'qquad') out.push({ k: 'space', w: 4 });
        else out.push({ k: 'cmd', v: cmd });
      } else {
        const d = src[i + 1] || ''; i += 2;
        if (d === '\\') out.push({ k: 'row' });
        else if (d === ',' || d === ':') out.push({ k: 'space', w: 1 }); else if (d === ';' || d === ' ') out.push({ k: 'space', w: 2 }); else if (d === '!') out.push({ k: 'space', w: 0 });
        else out.push({ k: 'ch', v: d });
      }
      continue;
    }
    i++;
    if (c === ' ' || c === '\n' || c === '\t') continue;
    if (c === '{' || c === '}' || c === '^' || c === '_' || c === '&') out.push({ k: c });
    else if (c === '~') out.push({ k: 'space', w: 2 });
    else if (c === ':' && src[i] === '=') { i++; out.push({ k: 'cmd', v: 'coloneqq' }); }
    else out.push({ k: 'ch', v: c });
  }
  return out;
}

function texToHtml(src) {
  const toks = texLex(src); let p = 0;
  const E0 = { h: '', tall: false };
  const row = stop => {
    const its = [];
    while (p < toks.length && !stop(toks[p])) { const it = item(); if (it) its.push(it); }
    let h = '', prev = null, tall = false;
    for (const it of its) {
      if (it.bin) { const unary = !prev || prev.cls === 'bin' || prev.cls === 'rel' || prev.cls === 'open' || prev.cls === 'punct' || prev.cls === 'op'; h += unary ? `<span class="un">${it.bin}</span>` : `<span class="bin">${it.bin}</span>`; it.cls = 'bin'; }
      else h += it.h;
      tall = tall || it.tall; if (it.cls !== 'space') prev = it;
    }
    return { h, tall };
  };
  const arg = () => { const t = toks[p]; if (!t) return E0; if (t.k === '{') { p++; const r = row(x => x.k === '}'); p++; return r; } return atom() || E0; };
  const delimTok = () => { const t = toks[p++]; if (!t) return '.'; if (t.k === 'ch') return t.v; if (t.k === 'cmd') return TSYM[t.v] || '.'; return '.'; };
  const fence = (open, c, close) => {
    if (!c.tall) return { h: (open === '.' ? '' : `<span class="pn">${escH(open)}</span>`) + c.h + (close === '.' ? '' : `<span class="pn">${escH(close)}</span>`), tall: false };
    const L = DELIM[open] ? dsvg(open, 'l') : '', R = DELIM[close] ? dsvg(close, 'r') : '';
    return { h: `<span class="dl${L ? ' hl' : ''}${R ? ' hr' : ''}">${L}${c.h}${R}</span>`, tall: true };
  };
  const script = (base, sup, sub) => {
    if (base.big === 'int') return { h: `<span class="bi"><span class="is">∫</span><span class="il"><span>${sup ? sup.h : ''}</span><span>${sub ? sub.h : ''}</span></span></span>`, tall: true, cls: 'op' };
    if (base.big) return { h: `<span class="bo"><span class="bl">${sup ? sup.h : ''}</span><span class="bs">${base.sym}</span><span class="bl">${sub ? sub.h : ''}</span></span>`, tall: true, cls: 'op' };
    if (base.tall && sup) return { h: `<span class="tp"><span>${base.h}${sub ? `<sub>${sub.h}</sub>` : ''}</span><span class="te">${sup.h}</span></span>`, tall: true };
    if (sup && sub) return { h: `${base.h}<span class="ss"><span>${sup.h}</span><span>${sub.h}</span></span>`, tall: base.tall };
    return { h: base.h + (sup ? `<sup>${sup.h}</sup>` : `<sub>${sub.h}</sub>`), tall: base.tall };
  };
  const item = () => {
    let base = atom(); if (!base) return null;
    let sup = null, sub = null;
    for (; ;) {
      const t = toks[p];
      if (t && t.k === '^' && sup === null) { p++; sup = arg(); }
      else if (t && t.k === '_' && sub === null) { p++; sub = arg(); }
      else if (t && t.k === 'ch' && t.v === "'" && !base.bin) { p++; base = { ...base, h: base.h + '<span class="pr">′</span>' }; }
      else break;
    }
    if (sup === null && sub === null) { if (base.big === 'int') return script(base, null, null); if (base.big) return { h: `<span class="bo"><span class="bs">${base.sym}</span></span>`, tall: true, cls: 'op' }; return base; }
    if (base.bin) base = { h: `<span class="bin">${base.bin}</span>`, tall: false };
    return script(base, sup, sub);
  };
  const matrix = env => {
    const rows = [[]];
    for (; ;) {
      const c = row(x => x.k === '&' || x.k === 'row' || x.k === 'end');
      rows[rows.length - 1].push(c.h);
      const t = toks[p++];
      if (!t || t.k === 'end') break;
      if (t.k === 'row') rows.push([]);
    }
    if (rows.length > 1 && rows[rows.length - 1].length === 1 && !rows[rows.length - 1][0]) rows.pop();
    const cols = Math.max(...rows.map(r => r.length)), cases = env === 'cases';
    const cells = rows.map(r => { const o = r.slice(); while (o.length < cols) o.push(''); return o.map(c => `<span>${c}</span>`).join(''); }).join('');
    const grid = `<span class="mt${cases ? ' cs' : ''}" style="grid-template-columns:repeat(${cols},auto)">${cells}</span>`;
    const d = { bmatrix: ['[', ']'], pmatrix: ['(', ')'], vmatrix: ['|', '|'], Bmatrix: ['{', '}'], cases: ['{', '.'] }[env] || ['.', '.'];
    return fence(d[0], { h: grid, tall: true }, d[1]);
  };
  const atom = () => {
    const t = toks[p++]; if (!t) return null;
    switch (t.k) {
      case '{': { const r = row(x => x.k === '}'); p++; return r; }
      case '}': case '&': case 'row': case 'end': return E0;
      case '^': case '_': p--; return { h: '', tall: false };   // a script with nothing before it
      case 'space': return { h: `<span class="s${t.w}"></span>`, tall: false, cls: 'space' };
      case 'text': {
        const cl = t.cmd === 'mathit' || t.cmd === 'textit' ? 'ti' : t.cmd === 'mathbf' || t.cmd === 'textbf' || t.cmd === 'boldsymbol' ? 'tb' : t.cmd === 'operatorname' ? 'fnm' : 'tx';
        return { h: `<span class="${cl}">${escH(t.v)}</span>`, tall: false };
      }
      case 'begin': return matrix(t.v);
      case 'ch': {
        const c = t.v;
        if (/[A-Za-z]/.test(c)) return { h: `<i>${c}</i>`, tall: false };
        if (/[0-9.]/.test(c)) return { h: c, tall: false };
        if (c === '+') return { bin: '+', tall: false }; if (c === '-') return { bin: '−', tall: false }; if (c === '*') return { bin: '·', tall: false };
        if (c === '=' || c === '<' || c === '>') return { h: `<span class="rel">${escH(c)}</span>`, tall: false, cls: 'rel' };
        if (c === '(' || c === '[') return { h: `<span class="pn">${c}</span>`, tall: false, cls: 'open' };
        if (c === ',' || c === ';') return { h: `${c}<span class="s1"></span>`, tall: false, cls: 'punct' };
        if (/[α-ωϑϕ]/.test(c)) return { h: `<i>${c}</i>`, tall: false };
        return { h: escH(c), tall: false };
      }
      case 'cmd': {
        const c = t.v;
        if (c === 'frac' || c === 'dfrac' || c === 'tfrac') { const A = arg(), B = arg(); return { h: `<span class="fr"><span class="n">${A.h}</span><span class="d">${B.h}</span></span>`, tall: true }; }
        if (c === 'sqrt') {
          let ix = ''; if (toks[p] && toks[p].k === 'ch' && toks[p].v === '[') { p++; ix = row(x => x.k === 'ch' && x.v === ']').h; p++; }
          const A = arg(); return { h: `<span class="rt${ix ? ' rx' : ''}">${ix ? `<span class="ri">${ix}</span>` : ''}${RADICAL}<span class="rb">${A.h}</span></span>`, tall: A.tall };
        }
        if (c === 'left') { const o = delimTok(), r = row(x => x.k === 'cmd' && x.v === 'right'); p++; const cl = delimTok(); return fence(o, r, cl); }
        if (c === 'right') { p++; return E0; }
        if (c === 'int') return { big: 'int', tall: true }; if (c === 'sum') return { big: 'sum', sym: 'Σ', tall: true }; if (c === 'prod') return { big: 'prod', sym: 'Π', tall: true };
        if (c === 'lim') return { big: 'lim', sym: '<span class="lm">lim</span>', tall: false };
        if (c === 'xrightarrow') { const A = arg(); return { h: `<span class="xa"><span class="xl">${A.h}</span><span class="xr"></span></span>`, tall: false, cls: 'rel' }; }
        if (c === 'mathrel') { const A = arg(); return { h: `<span class="rel">${A.h}</span>`, tall: A.tall, cls: 'rel' }; }
        if (c === 'overline' || c === 'bar') { const A = arg(); return { h: `<span class="ol">${A.h}</span>`, tall: A.tall }; }
        if (c === 'underline') { const A = arg(); return { h: `<span class="ul">${A.h}</span>`, tall: A.tall }; }
        if (c === 'boxed') { const A = arg(); return { h: `<span class="bx">${A.h}</span>`, tall: A.tall }; }
        const acc = { hat: '̂', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃' }[c];
        if (acc) { const A = arg(); return { h: A.h.replace(/(<\/i>)?$/, acc + '$1'), tall: A.tall }; }
        if (TBIN[c]) return { bin: TBIN[c], tall: false };
        if (TREL[c]) return { h: `<span class="rel">${TREL[c]}</span>`, tall: false, cls: 'rel' };
        if (TFN.has(c)) return { h: `<span class="fnm">${c}</span>`, tall: false, cls: 'op' };
        if (TSYM[c]) { const s = TSYM[c]; return { h: /[α-ωϑ]/.test(s) ? `<i>${s}</i>` : s, tall: false }; }
        if (c === 'displaystyle' || c === 'limits' || c === 'nolimits' || c === 'big' || c === 'Big') return E0;
        return { h: `<span class="tx">\\${escH(c)}</span>`, tall: false };
      }
    }
    return E0;
  };
  let r;
  try { r = row(() => false); } catch (e) { return `<span class="mx"><span class="tx">${escH(src)}</span></span>`; }
  return `<span class="mx">${r.h}</span>`;
}

/* Text regions: light Markdown with $inline math$. Everything is escaped before it is marked up. */
function mdInline(s) {
  const parts = s.split(/(\$[^$\n]+\$)/g);
  return parts.map(pt => {
    if (pt.length > 2 && pt[0] === '$' && pt[pt.length - 1] === '$') return texToHtml(pt.slice(1, -1));
    return escH(pt).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  }).join('');
}
function mdToHtml(src) {
  const out = []; let list = false, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(mdInline).join('<br>')}</p>`); para = []; } if (list) { out.push('</ul>'); list = false; } };
  for (const ln of String(src).split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(ln), li = /^\s*[-*]\s+(.*)$/.exec(ln);
    if (h) { flush(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); }
    else if (li) { if (para.length) flush(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${mdInline(li[1])}</li>`); }
    else if (!ln.trim()) flush();
    else { if (list) flush(); para.push(ln); }
  }
  flush();
  return out.join('');
}
