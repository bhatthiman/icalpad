// Assistant tests (Node, no network): node test/ai.test.js
// Covers tool validation (every rejection), undo of an assistant turn, key storage, safe rendering,
// the generated system prompt, the stream parser, retries and the tool loop. fetch is always a mock.
const { Core, AICore: A, HELP } = require('../dist/ai.cjs');
const fakeDoc = require('./ai-fake-doc.js');
const { sse, mockFetch, apiError } = require('./ai-mock.js');
let pass = 0, fail = 0;
const ok = (cond, label, extra) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label + (extra !== undefined ? '\n   ' + JSON.stringify(extra).slice(0, 400) : '')); } };
const noSleep = () => Promise.resolve();

// A worksheet with a small beam calculation on it.
function beam() {
  const doc = fakeDoc(Core), X = A.Executor(doc, { images: new Map([['img1', { src: 'data:image/png;base64,iVBORw0KGgo=', name: 'photo.png', w: 400, h: 300 }], ['pdf1', { src: 'data:application/pdf;base64,JVBERi0=', name: 'p.pdf' }]]) });
  const add = (type, content, after_id) => X.exec('add_block', { type, content, after_id }).result.id;
  const ids = { w: add('definition', 'w := 20 kN/m'), L: add('definition', 'L := 6 m'), M: add('definition', 'M := w*L^2/8'), R: add('result', 'M = kN*m') };
  return { doc, X, ids };
}
function rejects(X, name, input, re, label) {
  const r = X.exec(name, input);
  ok(!r.ok && re.test(r.result.error), `rejects ${label}`, r);
  return r;
}

// ---------- tool validation: every rejection case ----------
{
  const { doc, X, ids } = beam();
  ok(doc.regions().length === 4 && doc.results().get(ids.R).text === '90 kN*m', 'beam example computes 90 kN*m', doc.results().get(ids.R));
  const n0 = doc.regions().length;
  rejects(X, 'no_such_tool', {}, /Unknown tool/, 'an unknown tool');
  rejects(X, 'add_block', null, /must be an object/, 'a non-object input');
  rejects(X, 'add_block', [], /must be an object/, 'an array input');
  rejects(X, 'add_block', { type: 'poem', content: 'x' }, /Unknown block type/, 'an unknown block type');
  rejects(X, 'add_block', { type: 'text', content: '   ' }, /empty/, 'empty content');
  rejects(X, 'add_block', { type: 'text', content: 42 }, /must be a string/, 'non-string content');
  rejects(X, 'add_block', { type: 'text', content: 'Hi', after_id: 'nope' }, /No block with id nope/, 'a missing after_id');
  rejects(X, 'add_block', { type: 'heading', content: 'One\nTwo' }, /one line/, 'a two-line heading');
  rejects(X, 'add_block', { type: 'heading', content: 'x'.repeat(200) }, /Too long/, 'a long heading');
  rejects(X, 'add_block', { type: 'text', content: 'x'.repeat(1600) }, /Too long/, 'a long text');
  rejects(X, 'add_block', { type: 'result', content: 'x'.repeat(700) + ' =' }, /Too long/, 'a long math line');
  rejects(X, 'add_block', { type: 'text', content: 'The moment is M = 90 kN*m.' }, /cannot state a value/, 'text that states a computed value');
  rejects(X, 'add_block', { type: 'note', content: 'Result ≈ 90' }, /cannot state a value/, 'a note that states a value with ≈');
  rejects(X, 'add_block', { type: 'heading', content: 'M = 90 kN m' }, /cannot state a value/, 'a heading that states a value');
  rejects(X, 'add_block', { type: 'text', content: '# Title' }, /becomes a heading/, 'text starting with #');
  rejects(X, 'add_block', { type: 'definition', content: 'a := 1\nb := 2' }, /one line/, 'a two-line math block');
  const pe = rejects(X, 'add_block', { type: 'result', content: 'w*(L =' }, /./, 'a parse error');
  let parseMsg = ''; try { Core.parseStatement('w*(L ='); } catch (e) { parseMsg = e.message; }
  ok(pe.result.error === parseMsg, 'returns the exact parser error', [pe.result.error, parseMsg]);
  rejects(X, 'add_block', { type: 'definition', content: 'q = 3 kN' }, /needs :=/, 'a definition without :=');
  rejects(X, 'add_block', { type: 'definition', content: 'M := 90 kN*m' }, /calculated by iCalPad/, 'typing the value of a calculated name');
  rejects(X, 'add_block', { type: 'result', content: 'V := 3 kN' }, /This is a definition/, 'a result that is a definition');
  rejects(X, 'add_block', { type: 'result', content: 'x^2 + 1' }, /A result line ends with/, 'a result with no = or ->');
  rejects(X, 'add_block', { type: 'result', content: '90 kN*m =' }, /only repeats a typed number/, 'a result that repeats a literal');
  rejects(X, 'add_block', { type: 'equation', content: 'P := 4 kN' }, /it is a definition/, 'an equation that is a definition');
  rejects(X, 'add_block', { type: 'equation', content: 'M =' }, /it is a result line/, 'an equation that is a result line');
  rejects(X, 'add_block', { type: 'equation', content: 'V = 60 kN' }, /as a definition/, 'an equation that types a value');
  const und = rejects(X, 'add_block', { type: 'result', content: 'Q_u =' }, /No value yet for Q_u/, 'an undefined variable');
  ok(und.result.added === false && /Nothing was added/.test(und.result.note), 'an undefined variable adds nothing', und);
  const un = rejects(X, 'add_block', { type: 'result', content: 'L + w =' }, /cannot be added/, 'a unit mismatch');
  const engineErr = Core.evalDoc([...doc.regions(), { id: 'zz', type: 'math', src: 'L + w =' }]).results.get('zz').err;
  ok(un.result.error === engineErr, 'returns the exact unit error from the engine', [un.result.error, engineErr]);
  rejects(X, 'add_block', { type: 'definition', content: 'w := 5 s', after_id: ids.L }, /breaks other blocks/, 'a block that breaks later blocks');
  rejects(X, 'add_block', { type: 'image', content: 'img9' }, /No picture called img9/, 'an unknown image ref');
  ok(doc.regions().length === n0, 'no rejected call changed the page', doc.regions().map(r => r.src));
  ok(doc.regions().every(r => !doc.results().get(r.id).err), 'the page has no errors after the rejections');

  // edit_block
  rejects(X, 'edit_block', { id: 'nope', content: 'x' }, /No block with id/, 'editing a missing block');
  const pic = X.exec('attach_source_image', { image_ref: 'img1' }).result.id;
  rejects(X, 'edit_block', { id: pic, content: 'x' }, /can be edited/, 'editing a picture');
  rejects(X, 'edit_block', { id: ids.w, content: 'Some words', type: 'text' }, /cannot become/, 'turning math into text');
  rejects(X, 'edit_block', { id: ids.w, content: 'w := 20 kN/m +' }, /./, 'an edit with a parse error');
  const uz = rejects(X, 'edit_block', { id: ids.M, content: 'M := w*L^2/8 + zz' }, /./, 'an edit with an undefined name');
  ok(JSON.stringify(uz.result).includes('No value yet for zz'), 'the undefined-name error is returned word for word', uz);
  rejects(X, 'edit_block', { id: ids.w, content: 'w := 20 kN' }, /breaks other blocks/, 'an edit that breaks later blocks');
  ok(doc.region(ids.w).src === 'w := 20 kN/m' && doc.region(ids.M).src === 'M := w*L^2/8', 'rejected edits leave blocks as they were');
  ok(X.exec('edit_block', { id: ids.w, content: 'w := 20 kN/m' }).result.unchanged === true, 'an edit with the same content is a no-op');

  // move_block and delete_block
  rejects(X, 'move_block', { id: 'nope' }, /No block with id/, 'moving a missing block');
  rejects(X, 'move_block', { id: ids.w, after_id: 'nope' }, /No block with id/, 'moving below a missing block');
  rejects(X, 'move_block', { id: ids.w, after_id: ids.w }, /below itself/, 'moving a block below itself');
  const order = doc.regions().map(r => r.id).join();
  rejects(X, 'move_block', { id: ids.w, after_id: ids.R }, /breaks the calculation/, 'a move that breaks the order');
  ok(doc.regions().map(r => r.id).join() === order, 'a rejected move restores the order');
  rejects(X, 'delete_block', { id: 'nope' }, /No block with id/, 'deleting a missing block');
  const del = rejects(X, 'delete_block', { id: ids.L }, /would break other blocks/, 'a delete that breaks blocks');
  ok(del.result.broken.length >= 1 && doc.region(ids.L), 'a rejected delete keeps the block and lists what would break', del);

  // get_result
  rejects(X, 'get_result', { id: 'nope' }, /No block with id/, 'reading a missing block');
  rejects(X, 'get_result', { id: pic }, /Only math blocks/, 'reading a picture');
  const g = X.exec('get_result', { id: ids.R });
  ok(g.ok && g.result.value === '90 kN*m', 'get_result reads the engine value', g);
  ok(/Definitions do not display/.test(X.exec('get_result', { id: ids.M }).result.note), 'get_result on a definition explains how to show it');
  rejects(X, 'attach_source_image', { image_ref: 'pdf1' }, /Only pictures/, 'placing a PDF as a picture');
  const del2 = X.exec('delete_block', { id: ids.L, force: true });
  ok(del2.ok && del2.result.broken.length && !doc.region(ids.L), 'force deletes and reports breakage', del2);
  const ge = X.exec('get_result', { id: ids.R });
  ok(!ge.ok && /has an error/.test(ge.result.error), 'get_result on a block with an error says so', ge);
}

// ---------- the literal check ----------
{
  const lit = s => A.literalQty(Core.parseStatement(s + ' =').expr);
  ok(lit('90') && lit('-2.5') && lit('90 kN*m') && lit('20 kN/m') && lit('9.81 m/s^2'), 'typed quantities count as literals');
  ok(!lit('w*L^2/8') && !lit('5 ft + 3 in') && !lit('2*3') && !lit('sqrt(2) m') && !lit('pi'), 'calculations do not count as literals');
  const { doc, X } = beam();
  ok(X.exec('add_block', { type: 'result', content: '5 ft + 3 in = cm' }).ok, 'a unit conversion of typed values is allowed');
  ok(X.exec('add_block', { type: 'text', content: 'With w = 20 kN/m over L = 6 m.' }).ok, 'text may repeat a given that is typed on the page');
  ok(X.exec('add_block', { type: 'equation', content: 'x^2 - 5*x + 6 = 0' }).ok, 'an equation to solve is allowed');
  ok(X.exec('add_block', { type: 'equation', content: 'M <= 100 kN*m' }).ok, 'a check is allowed');
  ok(doc.regions().length === 8, 'allowed blocks were added');
}

// ---------- undo of one assistant turn ----------
{
  const doc = fakeDoc(Core); doc.add({ type: 'math', src: 'a := 2' }); doc.add({ type: 'math', src: 'b := 3' }); doc.add({ type: 'math', src: 'c := 4' }); doc.evaluate();
  const ids = doc.regions().map(r => r.id), before = JSON.stringify(doc.regions().map(r => [r.id, r.src]));
  const X = A.Executor(doc);
  const t1 = X.exec('add_block', { type: 'result', content: 'a*b =', after_id: ids[1] }).result.id;
  X.exec('edit_block', { id: ids[0], content: 'a := 5' });
  X.exec('move_block', { id: ids[2], after_id: ids[0] });
  X.exec('delete_block', { id: ids[1], force: true });
  ok(X.log.length === 4 && X.actions.length === 4, 'the turn logged four changes', X.log);
  A.undoTurn(doc, X.log);
  ok(JSON.stringify(doc.regions().map(r => [r.id, r.src])) === before && !doc.region(t1), 'undoing the turn restores the page', doc.regions().map(r => [r.id, r.src]));
  // a block the user changed afterwards is left alone
  const Y = A.Executor(doc), k = Y.exec('add_block', { type: 'result', content: 'a + c =' }).result.id;
  doc.edit(k, { src: 'a + c + 1 =' });
  const r = A.undoTurn(doc, Y.log);
  ok(r.skipped.includes(k) && doc.region(k), 'undo keeps a block the user edited afterwards', r);
}

// ---------- key storage ----------
{
  const mk = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const local = mk(), session = mk(), K = 'sk-ant-api03-' + 'x'.repeat(40);
  const ks = A.KeyStore(local, session);
  ok(!ks.has() && !ks.remembered(), 'no key at first, remember off by default');
  ks.set(K, false);
  ok(ks.get() === K && session.m.get('icalpad.ai.key') === K && !local.m.has('icalpad.ai.key'), 'remember off: session storage only, never local storage');
  ks.set(K, true);
  ok(local.m.get('icalpad.ai.key') === K && !session.m.has('icalpad.ai.key') && ks.remembered(), 'remember on: local storage');
  ok(A.KeyStore(local, mk()).get() === K, 'a remembered key survives a new tab');
  ks.setRemember(false);
  ok(!local.m.has('icalpad.ai.key') && session.m.get('icalpad.ai.key') === K, 'turning remember off moves the key out of local storage');
  ks.forget();
  ok(!ks.has() && !local.m.has('icalpad.ai.key') && !session.m.has('icalpad.ai.key'), 'Forget key removes it everywhere');
  ok(A.KeyStore(null, null).get() === '', 'works with storage blocked');
  ok(A.scrub(`bad key ${K} here`, K) === 'bad key [hidden key] here' && !A.scrub('x sk-ant-abcdefghijklmnop y').includes('sk-ant-abc'), 'scrub hides keys in messages');
  ok(A.looksLikeKey(K) && !A.looksLikeKey('hello'), 'key shape check');
}

// ---------- safe rendering ----------
{
  const evil = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<a href="javascript:alert(1)">x</a>', '[x](javascript:alert(1))', '"><svg onload=alert(1)>', '<iframe src=//evil>', '$<img src=x onerror=1>$', '**<b onclick=1>**'];
  const ALLOWED = new Set(['p', 'b', 'i', 'em', 'strong', 'br', 'ul', 'li', 'code', 'span', 'sup', 'sub', 'h1', 'h2', 'h3']);
  const safe = h => [...h.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)].every(([, tag, attrs]) => ALLOWED.has(tag.toLowerCase()) && /^(\s+class="[\w\s-]*")*\s*$/.test(attrs));
  for (const s of evil) { const h = A.renderSafe(s); ok(safe(h) && !/<script|<img|<svg|<iframe|<a\b/i.test(h), 'renders safely: ' + s, h); }
  ok(A.renderSafe('**OK** and `M =`').includes('<b>OK</b>'), 'simple markdown still works');
  ok(A.renderSafe('use `M := w*L^2/8` and `a*b*c`').includes('<code>M := w*L^2/8</code>') && A.renderSafe('`x*y`').includes('<code>x*y</code>'), 'stars inside code stay as typed');
  ok(safe(A.renderSafe('`<img src=x onerror=1>`')), 'code spans are escaped too');
}

// ---------- the system prompt and syntax guide ----------
{
  const sp = A.systemPrompt(), g = A.syntaxGuide();
  ok(sp.startsWith('You are the iCalPad assistant'), 'system prompt starts with the hand-written file');
  ok(/never type a computed value as a literal/i.test(sp) && /get_result/.test(sp), 'system prompt has the no-literal rule');
  ok(sp.includes(g), 'system prompt includes the generated guide');
  ok(Object.keys(Core.UNITS).every(u => g.includes(u)), 'guide lists every unit the engine knows');
  ok(Object.keys(Core.FN).every(f => g.includes(f)) && Object.keys(Core.NF).every(f => g.includes(f)), 'guide lists every function the engine knows');
  ok(HELP.filter(([h]) => !/working on the page/i.test(h)).every(([, rows]) => rows.every(([c]) => g.includes(c))), 'guide includes the help rows');
  ok(!/Mathcad/i.test(sp), 'no product names from elsewhere in the prompt');
  const uc = A.userContent({ text: 'hi', mode: 'solve', attachments: [{ ref: 'img1', mime: 'image/png', data: 'AAA', name: 'a.png' }], page: 'PAGE' });
  ok(uc[0].type === 'image' && uc[0].source.media_type === 'image/png' && /Set up and solve/.test(uc[1].text) && uc[1].text.includes('img1') && uc[1].text.includes('PAGE'), 'user message carries the image, mode, refs and page', uc);
  const pdf = A.userContent({ text: '', mode: 'neat', attachments: [{ ref: 'pdf1', mime: 'application/pdf', data: 'JVBE', name: 'p.pdf' }], page: '' });
  ok(pdf[0].type === 'document' && pdf[0].source.media_type === 'application/pdf', 'a PDF goes as a document block');
  const { doc } = beam(), snap = A.snapshot(doc.regions(), doc.results());
  ok(snap.includes('w := 20 kN/m') && !snap.includes('90'), 'the page snapshot lists blocks without values', snap);
  ok(A.pdfPages(new TextEncoder().encode('%PDF /Type /Pages /Type /Page /Type/Page x')) === 2, 'PDF page count');
}

// ---------- stream parsing ----------
{
  const evs = []; const p = A.sseParser((t, d) => evs.push([t, d]));
  const body = sse([{ thinking: '', signature: 'SIG' }, { text: 'Hello there' }, { tool: 'evaluate', input: { a: [1, 2] }, id: 'toolu_1' }], 'tool_use');
  for (let i = 0; i < body.length; i += 7) p.push(body.slice(i, i + 7).replace(/\n/g, '\r\n'));
  p.end();
  const asm = A.assembler(); for (const [t, d] of evs) asm.on(t, d);
  const c = asm.msg.content;
  ok(c[0].type === 'thinking' && c[0].signature === 'SIG', 'thinking block kept with its signature', c[0]);
  ok(c[1].text === 'Hello there', 'text assembled from deltas split across chunks (CRLF)', c[1]);
  ok(c[2].type === 'tool_use' && c[2].input.a[1] === 2 && c[2].id === 'toolu_1', 'tool input assembled from partial JSON', c[2]);
  ok(asm.msg.stop_reason === 'tool_use' && asm.msg.usage.output_tokens === 40, 'stop reason and usage read');
  let threw = null; try { A.assembler().on('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }); } catch (e) { threw = e; }
  ok(threw && threw.kind === 'overloaded' && threw.retryable, 'an in-stream overload error is retryable');
}

(async () => {
  const K = 'sk-ant-api03-' + 'k'.repeat(40);
  const base = { key: K, model: 'claude-sonnet-5-5', signal: new AbortController().signal, sleep: noSleep };

  // ---------- requests: headers, retries, errors ----------
  {
    const f = mockFetch([apiError(429, 'rate_limit_error', 'slow down', { 'retry-after': '2' }), apiError(529, 'overloaded_error', 'Overloaded'), sse([{ text: 'ok' }])]);
    const waits = [], st = [];
    const res = await A.request({ ...base, fetchFn: f, body: { a: 1 }, sleep: ms => { waits.push(ms); return Promise.resolve(); }, onStatus: s => st.push(s) });
    ok(res.ok && f.calls.length === 3, 'retries 429 and 529, then succeeds');
    ok(waits[0] === 2000, 'honors retry-after', waits);
    ok(st.length === 2 && /429/.test(st[0].text), 'reports the retry to the user', st);
    const h = f.calls[0].headers;
    ok(h['x-api-key'] === K && h['anthropic-version'] === '2023-06-01' && h['content-type'] === 'application/json' && h['anthropic-dangerous-direct-browser-access'] === 'true', 'sends the required headers', h);
    ok(f.calls[0].url === 'https://api.anthropic.com/v1/messages' && !f.calls[0].url.includes(K) && !f.calls[0].raw.includes(K), 'the key is only in the header, never in the URL or body');
    let e = null;
    try { await A.request({ ...base, fetchFn: mockFetch([apiError(401, 'authentication_error', 'invalid x-api-key ' + K)]), body: {} }); } catch (x) { e = x; }
    ok(e && e.kind === 'auth' && /401/.test(e.message) && !e.message.includes(K), '401 gives a clear message without the key', e && e.message);
    const f2 = mockFetch([apiError(429, 'rate_limit_error', 'slow')]); e = null;
    try { await A.request({ ...base, fetchFn: f2, body: {} }); } catch (x) { e = x; }
    ok(e && e.kind === 'rate' && f2.calls.length === 5, '429 gives up after four retries', [e && e.message, f2.calls.length]);
    e = null; try { await A.request({ ...base, fetchFn: mockFetch([{ network: true }]), body: {} }); } catch (x) { e = x; }
    ok(e && e.kind === 'network' && /internet/.test(e.message), 'a network failure gives a clear message');
    e = null; try { await A.request({ ...base, fetchFn: mockFetch([apiError(400, 'invalid_request_error', 'messages: bad')]), body: {} }); } catch (x) { e = x; }
    ok(e && /400/.test(e.message) && /messages: bad/.test(e.message), '400 shows the API message');
  }

  // ---------- one turn: tools, thinking blocks, caching, usage ----------
  {
    const doc = fakeDoc(Core), X = A.Executor(doc), seen = [];
    const f = mockFetch([
      sse([{ thinking: '', signature: 'S1' }, { tool: 'add_block', input: { type: 'definition', content: 'w := 20 kN/m' }, id: 't1' }, { tool: 'add_block', input: { type: 'result', content: 'w*(6 m)^2/8 = kN*m' }, id: 't2' }], 'tool_use'),
      body => { seen.push(body); return sse([{ thinking: '', signature: 'S2' }, { tool: 'get_result', input: { id: 'b2' }, id: 't3' }], 'tool_use'); },
      body => { seen.push(body); return sse([{ text: 'Done. M is 90 kN*m.' }], 'end_turn', { input_tokens: 50, output_tokens: 10 }); },
    ]);
    const messages = [], texts = [], tools = [];
    const out = await A.runTurn({ ...base, fetchFn: f, messages, content: [{ type: 'text', text: 'beam' }], exec: X.exec, on: (t, d) => { if (t === 'text') texts.push(d); if (t === 'tool') tools.push(d); } });
    ok(out.calls === 3 && out.stop === 'end_turn' && tools.length === 3, 'runs the tool loop to the end', out);
    ok(doc.results().get('b2').text === '90 kN*m', 'the engine computed the result');
    const b1 = f.calls[1].body, a1 = b1.messages[1];
    ok(a1.role === 'assistant' && a1.content[0].type === 'thinking' && a1.content[0].signature === 'S1', 'thinking blocks go back unchanged', a1.content[0]);
    const tr = b1.messages[2].content;
    ok(tr.length === 2 && tr[0].tool_use_id === 't1' && tr[1].tool_use_id === 't2', 'every tool call gets its result', tr);
    ok(tr[1].cache_control && !tr[0].cache_control && !messages[2].content[1].cache_control, 'cache mark on the last block only, history unchanged');
    ok(f.calls[0].body.system[0].cache_control && f.calls[0].body.tools.length === A.TOOLS.length && f.calls[0].body.stream === true && f.calls[0].body.max_tokens === A.MAX_TOKENS, 'request has a cached system prompt, the tools and streaming');
    ok(out.usage.requests === 3 && out.usage.input === 290 && out.usage.output === 90, 'usage is summed over the turn', out.usage);
    ok(texts.join('') === 'Done. M is 90 kN*m.', 'streams the reply text');
    ok(!/tool_use/.test(JSON.stringify(messages[messages.length - 1].content.map(b => b.type))) && messages[messages.length - 1].role === 'assistant', 'history ends with the reply');
  }

  // ---------- the 30-call cap ----------
  {
    const doc = fakeDoc(Core), X = A.Executor(doc); let i = 0;
    const f = mockFetch([() => sse([{ tool: 'add_block', input: { type: 'definition', content: `a${++i} := ${i}` } }], 'tool_use')]);
    const messages = [];
    const out = await A.runTurn({ ...base, fetchFn: f, messages, content: [{ type: 'text', text: 'go' }], exec: X.exec });
    ok(out.limitHit && out.calls === 30 && doc.regions().length === 30, 'stops at 30 tool calls', [out, doc.regions().length]);
    const lastUser = messages[messages.length - 1];
    ok(lastUser.role === 'user' && lastUser.content[0].is_error && /limit of 30/.test(lastUser.content[0].content), 'the 31st call is answered with the limit message');
    const f2 = mockFetch([sse([{ text: 'Summary.' }])]);
    await A.runTurn({ ...base, fetchFn: f2, messages, content: [{ type: 'text', text: 'continue' }], exec: X.exec });
    const sent = f2.calls[0].body.messages, lu = sent[sent.length - 1];
    ok(lu.role === 'user' && lu.content[0].type === 'tool_result' && lu.content[lu.content.length - 1].text === 'continue', 'the next message joins the pending tool results');
  }

  // ---------- an invalid expression, corrected on the next call ----------
  {
    const doc = fakeDoc(Core), X = A.Executor(doc), results = [];
    const f = mockFetch([
      sse([{ tool: 'add_block', input: { type: 'result', content: 'sqrt(2 =' }, id: 'e1' }], 'tool_use'),
      body => { results.push(body.messages[body.messages.length - 1].content[0]); return sse([{ tool: 'add_block', input: { type: 'result', content: 'sqrt(2) =' }, id: 'e2' }], 'tool_use'); },
      sse([{ text: 'Fixed.' }]),
    ]);
    await A.runTurn({ ...base, fetchFn: f, messages: [], content: [{ type: 'text', text: 'x' }], exec: X.exec });
    ok(results[0].is_error && /missing|\)/i.test(JSON.parse(results[0].content).error), 'the parse error goes back to the model', results[0]);
    ok(doc.regions().length === 1 && doc.results().get(doc.regions()[0].id).text.startsWith('1.41'), 'the corrected line is on the page', doc.regions());
  }

  // ---------- Stop ----------
  {
    const ctrl = new AbortController(), doc = fakeDoc(Core), X = A.Executor(doc);
    const f = mockFetch([sse([{ text: 'a long reply '.repeat(40) }])], { chunk: 20, delay: 5 });
    setTimeout(() => ctrl.abort(), 30);
    let e = null; const messages = [];
    try { await A.runTurn({ ...base, signal: ctrl.signal, fetchFn: f, messages, content: [{ type: 'text', text: 'x' }], exec: X.exec }); } catch (x) { e = x; }
    ok(e && e.kind === 'abort', 'Stop aborts the request', e && e.message);
    ok(messages.length === 1 && messages[0].role === 'user', 'a stopped reply is not kept in the history');
  }

  // ---------- a retryable error inside the stream ----------
  {
    const bad = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\nevent: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
    const f = mockFetch([bad, sse([{ text: 'ok' }])]), st = [];
    const out = await A.runTurn({ ...base, fetchFn: f, messages: [], content: [{ type: 'text', text: 'x' }], exec: () => ({ ok: true, result: {} }), on: (t, d) => { if (t === 'status') st.push(d.text); } });
    ok(f.calls.length === 2 && out.stop === 'end_turn' && st.some(s => /Trying again/.test(s)), 'an overload during streaming is retried', st);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
