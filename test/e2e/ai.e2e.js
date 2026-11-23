// Browser tests for the assistant, with the Anthropic API mocked (no real calls): node test/e2e/ai.e2e.js
// Needs Playwright and Chrome or Chromium. Set CHROME=/path/to/chrome to pick a browser.
const path = require('path');
const { sse } = require('../ai-mock.js');
let chromium;
for (const m of ['playwright', '/opt/npm-tools/node_modules/playwright']) { try { ({ chromium } = require(m)); break; } catch (e) { /* try the next */ } }
if (!chromium) { console.log('Playwright is not installed; skipping the browser tests. Run: npm i --no-save playwright && npx playwright install chromium'); process.exit(0); }
const PAGE = 'file://' + path.resolve(__dirname, '../../index.html');
const KEY = 'sk-ant-api03-TEST' + 'q'.repeat(40) + 'END';
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label + (extra !== undefined ? '\n   ' + JSON.stringify(extra).slice(0, 500) : '')); } };

// The mock API: each test sets `script`, a list of steps. A step is (requestBody) -> SSE text, or { status, body, headers, wait }.
let script = [], seen = [];
const toolResults = body => { const m = body.messages[body.messages.length - 1]; return (m.content || []).filter(b => b.type === 'tool_result').map(b => ({ id: b.tool_use_id, err: !!b.is_error, ...JSON.parse(b.content) })); };
const ids = body => toolResults(body).map(r => r.id);
async function route(r) {
  const req = r.request();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
  const body = JSON.parse(req.postData()); seen.push({ body, headers: req.headers(), url: req.url() });
  let step = script.shift(); if (typeof step === 'function') step = step(body);
  if (!step) step = sse([{ text: 'No more scripted replies.' }]);
  if (typeof step === 'string') step = { status: 200, body: step };
  if (step.wait) await new Promise(res => setTimeout(res, step.wait));
  try { await r.fulfill({ status: step.status, headers: { ...cors, 'content-type': step.status === 200 ? 'text/event-stream' : 'application/json', ...(step.headers || {}) }, body: step.body }); } catch (e) { /* the page stopped the request */ }
}
const err = (status, type, message, headers) => ({ status, body: JSON.stringify({ type: 'error', error: { type, message } }), headers });
const tu = (tool, input) => ({ tool, input });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1360, height: 880 } });
  const p = await ctx.newPage(); const errs = [], api = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  p.on('request', r => { if (/api\.anthropic\.com/.test(r.url())) api.push(r.method()); });
  await p.route('https://api.anthropic.com/**', route);
  await p.goto(PAGE); await p.waitForTimeout(700);
  const fresh = async () => { await p.evaluate(() => { const S = window.iCalPad.state; S.doc.regions.slice().forEach(r => window.iCalPad.cmd.remove(r.id)); }); await p.waitForTimeout(50); };
  const regions = () => p.evaluate(() => window.iCalPad.state.doc.regions.map(r => ({ id: r.id, type: r.type, src: r.src, kind: r.kind, ref: r.ref, cap: r.cap, text: (window.iCalPad.state.results.get(r.id) || {}).text, err: (window.iCalPad.state.results.get(r.id) || {}).err })));
  const sendMsg = async text => { await p.fill('.aip textarea', text); await p.press('.aip textarea', 'Enter'); };
  const idle = () => p.waitForFunction(() => !document.querySelector('.aip.busy'), null, { timeout: 15000 });
  const lastBot = () => p.evaluate(() => { const m = [...document.querySelectorAll('.am.bot')].pop(); return m && { text: m.querySelector('.tx').textContent, err: m.querySelector('.err').textContent, use: m.querySelector('.use').textContent, acts: m.querySelector('.acts summary').textContent, undo: !m.querySelector('[data-undo]').hidden }; });

  // ---------- off by default ----------
  ok(!(await p.$('#aip')), 'the panel is not even built until opened');
  await p.click('#b-ex'); await p.click('.menu .mi >> nth=2'); await p.waitForTimeout(300);
  ok(api.length === 0, 'no request to Anthropic while using the page normally');
  await p.click('#b-ai'); await p.waitForTimeout(200);
  ok(await p.isVisible('#ai-key') && api.length === 0, 'opening the panel asks for a key and sends nothing');
  ok((await p.textContent('.aip')).includes('Your messages, images and the current worksheet are sent to Anthropic using your own API key. Usage is billed to your Anthropic account.'), 'shows the privacy note');
  ok(await p.getAttribute('.aip-setup a', 'href') === 'https://console.anthropic.com', 'links to console.anthropic.com');
  ok(!(await p.isChecked('#ai-rem')), 'Remember key is off by default');
  const models = await p.$$eval('#ai-model option', o => o.map(x => x.value));
  ok(models[0] === 'claude-sonnet-5-5' && models.includes('claude-opus-5-5'), 'model list: Sonnet first, more capable models offered', models);
  await p.fill('#ai-key', KEY); await p.click('#ai-save'); await p.waitForTimeout(100);
  const store = await p.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }));
  ok(!store.local.includes(KEY) && store.session.includes(KEY), 'with Remember off the key is in sessionStorage only');
  ok(api.length === 0, 'saving the key sends nothing');

  // ---------- beam: M = wL^2/8 with w = 20 kN/m and L = 6 m ----------
  await fresh();
  await p.click('.aip-mode [data-mode="solve"]');
  const h0 = await p.evaluate(() => window.iCalPad.state.hist.length);
  script = [
    sse([{ thinking: '', signature: 'sig-a' }, tu('add_block', { type: 'heading', content: 'Simply supported beam', level: 1 }), tu('add_block', { type: 'definition', content: 'w := 20 kN/m' }), tu('add_block', { type: 'definition', content: 'L := 6 m' }), tu('add_block', { type: 'definition', content: 'M := w*L^2/8' }), tu('add_block', { type: 'result', content: 'M = kN*m' })], 'tool_use'),
    body => { const r = toolResults(body); return sse([{ thinking: '', signature: 'sig-b' }, tu('evaluate', {}), tu('get_result', { id: r[4].id })], 'tool_use'); },
    body => { const r = toolResults(body); return sse([{ text: `Wrote the givens and \`M := w*L^2/8\`. iCalPad gives \`M = ${r[1].value}\`.` }]); },
  ];
  seen = [];
  await sendMsg('Beam with w = 20 kN/m over L = 6 m. Find the moment.');
  await idle();
  let rg = await regions();
  const res = rg.find(r => r.src === 'M = kN*m');
  ok(res && res.text === '90 kN*m', 'beam: iCalPad computes M = 90 kN*m', rg);
  ok(await p.isVisible('.rg.math .res'), 'beam: the answer is shown on the page');
  const req0 = seen[0];
  ok(req0.headers['x-api-key'] === KEY && req0.headers['anthropic-version'] === '2023-06-01' && req0.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'sends the key and version headers');
  ok(!req0.url.includes(KEY) && !JSON.stringify(req0.body).includes(KEY), 'the key is never in the URL or the request body');
  ok(req0.body.model === 'claude-sonnet-5-5' && req0.body.stream === true && /Set up and solve/.test(JSON.stringify(req0.body.messages)), 'request uses the default model, streaming, and the mode');
  ok(seen[1].body.messages[1].content[0].signature === 'sig-a', 'thinking blocks are sent back unchanged');
  let bot = await lastBot();
  ok(/M := w\*L\^2\/8/.test(bot.text) && /M = 90 kN\*m/.test(bot.text) && /Tokens: .* in, .* out, 3 requests/.test(bot.use), 'reply and token usage line', bot);
  ok(/5 changes/.test(bot.acts) && bot.undo, 'action list and Undo AI changes button', bot);
  ok(await p.$$eval('.rg.ai-flash', e => e.length) >= 1, 'changed blocks are highlighted');
  const h1 = await p.evaluate(() => window.iCalPad.state.hist.length);
  ok(h1 === h0 + 1, 'the whole turn is one undo step', [h0, h1]);
  // the key is not in the saved worksheet or the page address
  const saved = await p.evaluate(() => window.iCalPad.docJson());
  await p.waitForTimeout(700);
  const persisted = await p.evaluate(() => new Promise(res => { const rq = indexedDB.open('icalpad'); rq.onsuccess = () => { try { const db = rq.result, t = db.transaction(db.objectStoreNames[0]).objectStore(db.objectStoreNames[0]).getAll(); t.onsuccess = () => res(JSON.stringify(t.result)); t.onerror = () => res(''); } catch (e) { res(''); } }; rq.onerror = () => res(''); }));
  ok(!saved.includes(KEY) && !saved.includes('sk-ant') && !persisted.includes(KEY) && !(await p.evaluate(() => location.href)).includes(KEY), 'the key is not in the saved worksheet, the stored copy, or the URL');
  ok(!(await p.evaluate(() => document.body.innerHTML)).includes(KEY), 'the key is not anywhere in the page');
  // undo with the button, then the same with Ctrl+Z
  await p.click('.am.bot:last-child [data-undo]'); await p.waitForTimeout(100);
  ok((await regions()).length === 0, 'Undo AI changes removes what the assistant wrote');
  await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement.blur());
  await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
  ok((await regions()).length === 5, 'Ctrl+Z after that brings the assistant work back in one step', (await regions()).length);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
  ok((await regions()).length === 0, 'and one more Ctrl+Z removes the whole turn');

  // ---------- a quadratic with known roots ----------
  await fresh();
  script = [
    sse([tu('add_block', { type: 'equation', content: 'x^2 - 5*x + 6 = 0' }), tu('add_block', { type: 'result', content: 'solve(x^2 - 5*x + 6 = 0, x) ->' })], 'tool_use'),
    body => sse([tu('get_result', { id: toolResults(body)[1].id })], 'tool_use'),
    sse([{ text: 'The roots are listed on the page.' }]),
  ];
  await sendMsg('Solve x^2 - 5x + 6 = 0'); await idle();
  rg = await regions();
  ok(rg.some(r => /solve/.test(r.src) && (r.text === '[3; 2]' || r.text === '[2; 3]')), 'quadratic: iCalPad finds the roots 2 and 3', rg);

  // ---------- a unit conversion with mixed units ----------
  await fresh();
  script = [sse([tu('add_block', { type: 'definition', content: 'd := 5 ft + 3 in' }), tu('add_block', { type: 'result', content: 'd = cm' }), tu('add_block', { type: 'definition', content: 't := 2 hr + 30 min' }), tu('add_block', { type: 'result', content: 'd/t = mm/s' })], 'tool_use'), sse([{ text: 'Converted.' }])];
  await sendMsg('5 ft 3 in to cm, and the speed over 2.5 h'); await idle();
  rg = await regions();
  ok(rg.find(r => r.src === 'd = cm').text === '160 cm' && /^0\.1778 mm\/s$/.test(rg.find(r => r.src === 'd/t = mm/s').text), 'mixed units convert', rg.map(r => r.text));

  // ---------- an invalid expression corrected on the next call ----------
  await fresh();
  let firstErr = null;
  script = [
    sse([tu('add_block', { type: 'definition', content: 'a := 3 m' }), tu('add_block', { type: 'result', content: 'a + 2 kg =' })], 'tool_use'),
    body => { firstErr = toolResults(body)[1]; return sse([tu('add_block', { type: 'result', content: 'a + 2 m =' })], 'tool_use'); },
    sse([{ text: 'Fixed the units.' }]),
  ];
  await sendMsg('add 2 to a'); await idle();
  rg = await regions();
  ok(firstErr && firstErr.err && /units cannot be added/.test(firstErr.error), 'the unit error goes back to the model word for word', firstErr);
  ok(rg.length === 2 && rg[1].text === '5 m' && rg.every(r => !r.err), 'the corrected line is on the page and nothing broken was left', rg);

  // ---------- neat up keeps the meaning ----------
  await fresh();
  await p.click('.aip-mode [data-mode="neat"]');
  await p.evaluate(() => { const c = window.iCalPad.cmd; for (const s of ['w := 20 kN/m', 'L := 6 m', 'M := w*L*L/8', 'M =']) c.add({ type: 'math', src: s }); });
  const before = await regions();
  script = [
    body => { const m = body.messages[body.messages.length - 1], page = m.content.map(c => c.text || '').join(''); const id = (/(\w+) \| definition \| M := w\*L\*L\/8/.exec(page) || [])[1]; return sse([tu('edit_block', { id, content: 'M := w*L^2/8' }), tu('add_block', { type: 'heading', content: 'Beam moment', level: 2 })], 'tool_use'); },
    body => { const h = toolResults(body)[1].id; return sse([tu('move_block', { id: h })], 'tool_use'); },
    sse([{ text: 'Neatened. The equation is unchanged in meaning.' }]),
  ];
  await sendMsg('Neaten this up'); await idle();
  const after = await regions();
  const same = await p.evaluate(([bf, af]) => {
    const C = window.iCalPad.Core, val = (rs, w) => { const regs = rs.filter(r => r.type === 'math').map(r => ({ id: r.id, type: 'math', src: r.src.startsWith('w :=') ? `w := ${w} kN/m` : r.src })); const out = C.evalDoc(regs).results; return regs.map(r => out.get(r.id).text).filter(Boolean).join(); };
    return [10, 20, 33].map(w => [val(bf, w), val(af, w)]);
  }, [before, after]);
  ok(same.every(([x, y]) => x === y && x), 'the neatened equation gives the same results for the same inputs', same);
  ok(after.find(r => r.src === 'M := w*L^2/8') && after[0].src === '## Beam moment', 'the equation was rewritten and a heading placed at the top', after.map(r => r.src));

  // ---------- picture neat-up with the source attached ----------
  await fresh();
  const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1500; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 2400, 1500); x.fillStyle = '#123'; x.font = '120px serif'; x.fillText('P = 12 kN, a = 2 m', 100, 300); x.fillText('M = P a', 100, 600); return c.toDataURL('image/png').split(',')[1]; });
  await p.setInputFiles('.aip input[type=file]', { name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await p.waitForTimeout(300);
  ok(await p.$$eval('.aip-chip', e => e.length) === 1, 'the picture shows as an attachment');
  let imgReq = null;
  script = [
    body => { imgReq = body; return sse([{ text: 'I read: P = 12 kN, a = 2 m, and M = P a.' }, tu('add_block', { type: 'definition', content: 'P := 12 kN' }), tu('add_block', { type: 'definition', content: 'a := 2 m' }), tu('add_block', { type: 'equation', content: 'M = P*a' }), tu('attach_source_image', { image_ref: 'img1', caption: 'Source: hand notes', collapsed: true })], 'tool_use'); },
    sse([{ text: 'Done. I kept M = P a as written.' }]),
  ];
  await sendMsg(''); await idle();
  const imgBlock = imgReq && imgReq.messages[imgReq.messages.length - 1].content.find(c => c.type === 'image');
  const dims = imgBlock && (() => { const buf = Buffer.from(imgBlock.source.data, 'base64'); return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; })();
  ok(imgBlock && imgBlock.source.media_type === 'image/png' && dims[0] === 1568 && dims[1] === 980, 'the picture is sent as an image block, scaled to 1568 px on the long side', dims);
  ok(/img1: picture \(notes\.png\)/.test(JSON.stringify(imgReq.messages)), 'the message tells the model the picture reference');
  rg = await regions();
  const src = rg.find(r => r.ref);
  ok(src && src.cap === 'Source: hand notes' && rg.filter(r => r.type === 'math').length === 3, 'the source picture is attached next to the neat version', rg);
  ok(await p.isVisible('.rg.image.folded .srcbar') && !(await p.isVisible('.rg.image.folded .fig')), 'the source picture starts folded');
  await p.click('.rg.image .srcbar [data-fold]'); await p.waitForTimeout(50);
  ok(await p.isVisible('.rg.image .fig'), 'and opens with Show');
  ok(!(await p.evaluate(() => window.iCalPad.docJson())).includes(KEY), 'a worksheet with a picture still has no key in it');

  // ---------- dropping a picture on the page while the panel is open ----------
  await p.evaluate(b64 => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'drop.png', { type: 'image/png' }));
    const d = document.getElementById('desk'), r = d.getBoundingClientRect();
    d.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 200, clientY: r.top + 200 }));
  }, png);
  await p.waitForTimeout(150);
  const menu = await p.$$eval('.menu .mi', m => m.map(x => x.textContent));
  ok(menu.includes('Send to the assistant') && menu.includes('Place on the page'), 'a drop on the page asks where the picture should go', menu);
  await p.click('.menu .mi >> text=Send to the assistant'); await p.waitForTimeout(300);
  ok(await p.$$eval('.aip-chip', e => e.length) === 1, 'Send to the assistant attaches it to the chat');
  await p.click('.aip-chip .x');

  // ---------- 401 ----------
  script = [err(401, 'authentication_error', 'invalid x-api-key')];
  await sendMsg('hello'); await idle();
  bot = await lastBot();
  ok(/401/.test(bot.err) && /Check the key/.test(bot.err) && !bot.err.includes(KEY), '401 shows a clear message without the key', bot);
  ok(await p.isVisible('.am.bot:last-child .err >> text=Open assistant settings'), '401 offers the settings');

  // ---------- 429, then success ----------
  script = [err(429, 'rate_limit_error', 'Too many requests', { 'retry-after': '1' }), sse([{ text: 'Back again.' }])];
  const n429 = seen.length;
  await sendMsg('try now');
  await p.waitForFunction(() => /Trying again/.test((document.querySelector('.am.bot:last-child .st') || {}).textContent || ''), null, { timeout: 4000 }).then(() => ok(true, '429 shows that it will retry')).catch(() => ok(false, '429 shows that it will retry'));
  await idle();
  bot = await lastBot();
  ok(/Back again/.test(bot.text) && !bot.err && seen.length - n429 === 2, '429 is retried with backoff, then succeeds', bot);

  // ---------- Stop, and the page stays usable while waiting ----------
  script = [{ status: 200, body: sse([tu('add_block', { type: 'definition', content: 'zz := 1' })], 'tool_use'), wait: 4000 }];
  const nBefore = (await regions()).length;
  await sendMsg('this will be stopped');
  await p.waitForTimeout(400);
  ok(await p.isVisible('.aip [data-a="stop"]'), 'a Stop button shows while waiting');
  await p.evaluate(() => window.iCalPad.cmd.add({ type: 'math', src: 'user_typed := 7' }));
  await p.click('.aip [data-a="stop"]'); await idle();
  bot = await lastBot();
  rg = await regions();
  ok(/Stopped/.test(bot.err) && rg.length === nBefore + 1 && !rg.some(r => r.src === 'zz := 1'), 'Stop ends the request; nothing from it reaches the page', [bot, rg.length, nBefore]);
  ok(rg.some(r => r.src === 'user_typed := 7'), 'the page could be edited while the assistant worked');

  // ---------- Forget key, remember key ----------
  await p.click('.aip [data-a="settings"]'); await p.click('#ai-forget'); await p.waitForTimeout(50);
  const gone = await p.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  ok(!gone.includes(KEY) && await p.isVisible('#ai-key'), 'Forget key removes it');
  await p.fill('#ai-key', KEY); await p.check('#ai-rem'); await p.click('#ai-save');
  ok((await p.evaluate(() => localStorage.getItem('icalpad.ai.key'))) === KEY, 'Remember on stores the key in localStorage');
  await p.click('.aip [data-a="settings"]'); await p.click('#ai-forget');
  ok(!(await p.evaluate(() => JSON.stringify(localStorage))).includes(KEY), 'Forget key clears localStorage too');

  ok(!errs.length, 'no page errors', errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
