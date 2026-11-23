/* ================= iCalPad assistant: the chat panel =================
   Optional. Nothing here contacts Anthropic until the user opens the panel, enters a key and sends a message.
   The panel changes the worksheet only through window.iCalPad.cmd, the same functions the page's own buttons use. */
(() => {
'use strict';
const P = window.iCalPad;
if (!P || !P.cmd || typeof AICore === 'undefined') return;
const A = AICore, Cmd = P.cmd, { toast, el, esc, narrow } = P.ui;
const store = name => { try { const s = window[name]; s.getItem('x'); return s; } catch (e) { return null; } };
const LOCAL = store('localStorage'), SESSION = store('sessionStorage');
const pref = (k, v) => { try { if (v === undefined) return LOCAL && LOCAL.getItem(k); LOCAL && LOCAL.setItem(k, v); } catch (e) { return null; } return null; };
const keys = A.KeyStore(LOCAL, SESSION);
const svg = d => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  chat: svg('<path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  clip: svg('<path d="M15.5 7.5l-6.8 6.8a1.9 1.9 0 0 0 2.7 2.7l7.3-7.3a3.6 3.6 0 0 0-5.1-5.1l-7.4 7.4a5.3 5.3 0 0 0 7.5 7.5l5.8-5.8"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  gear: svg('<path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
};
const NOTE = 'Your messages, images and the current worksheet are sent to Anthropic using your own API key. Usage is billed to your Anthropic account.';
const MODE_NAME = { neat: 'Neat up', solve: 'Set up and solve' };
const st = {
  open: false, built: false, model: A.MODELS.some(m => m.id === pref('icalpad.ai.model')) ? pref('icalpad.ai.model') : A.DEFAULT_MODEL,
  mode: pref('icalpad.ai.mode') === 'solve' ? 'solve' : 'neat', messages: [], images: new Map(), refN: 0, pdfN: 0, pending: [], busy: false, ctrl: null, note: '',
};
let root, logEl, setupEl, ta, attEl, sendB, stopB, fileIn;

// ---------- building the panel (only when first opened) ----------
function build() {
  root = el(`<aside class="aip" id="aip" aria-label="Assistant" hidden>
    <div class="aip-hd"><h2>Assistant</h2><span class="grow"></span>
      <button class="btn icon" type="button" data-a="new" title="New chat" aria-label="New chat">${ICON.plus}</button>
      <button class="btn icon" type="button" data-a="settings" title="Assistant settings" aria-label="Assistant settings">${ICON.gear}</button>
      <button class="btn icon" type="button" data-a="close" title="Close the assistant" aria-label="Close the assistant">${ICON.close}</button></div>
    <div class="aip-mode" role="radiogroup" aria-label="What the assistant should do">
      <button type="button" role="radio" data-mode="neat" title="Convert what you give it into clean worksheet content. No extra steps.">Neat up</button>
      <button type="button" role="radio" data-mode="solve" title="Write givens, equations, results and a check. iCalPad computes the answers.">Set up and solve</button></div>
    <div class="aip-log" aria-live="polite"></div>
    <div class="aip-setup" hidden></div>
    <form class="aip-in" autocomplete="off">
      <div class="aip-att"></div>
      <div class="aip-box"><textarea rows="2" aria-label="Message to the assistant" placeholder="Type or paste a problem, or drop a photo of your work"></textarea>
        <div class="aip-row"><button class="btn icon" type="button" data-a="attach" title="Attach a picture or a PDF page" aria-label="Attach a picture or a PDF page">${ICON.clip}</button>
          <span class="grow"></span><span class="aip-hint">Enter sends, Shift+Enter for a new line</span>
          <button class="btn line" type="button" data-a="stop" hidden>Stop</button><button class="btn solid" type="submit" data-a="send">Send</button></div></div>
      <p class="aip-note">${esc(NOTE)}</p>
    </form>
    <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf">
  </aside>`);
  document.querySelector('.main').append(root);
  logEl = root.querySelector('.aip-log'); setupEl = root.querySelector('.aip-setup'); ta = root.querySelector('textarea'); attEl = root.querySelector('.aip-att');
  sendB = root.querySelector('[data-a="send"]'); stopB = root.querySelector('[data-a="stop"]'); fileIn = root.querySelector('input[type=file]');
  root.querySelector('[data-a="close"]').addEventListener('click', () => setOpen(false));
  root.querySelector('[data-a="settings"]').addEventListener('click', () => showSetup(setupEl.hidden));
  root.querySelector('[data-a="new"]').addEventListener('click', newChat);
  root.querySelector('[data-a="attach"]').addEventListener('click', () => fileIn.click());
  stopB.addEventListener('click', () => { if (st.ctrl) st.ctrl.abort(); });
  fileIn.addEventListener('change', () => { attach([...fileIn.files]); fileIn.value = ''; });
  for (const b of root.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
  root.querySelector('form').addEventListener('submit', e => { e.preventDefault(); send(); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  ta.addEventListener('input', grow);
  ta.addEventListener('paste', e => {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(okType);
    e.stopPropagation();                              // keep the page from also placing a pasted picture
    if (files.length) { e.preventDefault(); attach(files); }
  });
  root.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; root.classList.add('drop'); } });
  root.addEventListener('dragleave', e => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop'); });
  root.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); root.classList.remove('drop'); if (e.dataTransfer) attach([...e.dataTransfer.files]); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && narrow()) setOpen(false); });
  setMode(st.mode); st.built = true; empty();
}
function grow() { ta.style.height = 'auto'; ta.style.height = Math.min(220, Math.max(52, ta.scrollHeight + 2)) + 'px'; }
function setMode(m) {
  st.mode = m === 'solve' ? 'solve' : 'neat'; pref('icalpad.ai.mode', st.mode);
  for (const b of root.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === st.mode));
}
function setOpen(on) {
  if (on && !st.built) build();
  st.open = !!on; if (root) root.hidden = !on;
  document.body.classList.toggle('ai-open', st.open);
  const b = document.getElementById('b-ai'); if (b) b.setAttribute('aria-pressed', String(st.open));
  window.dispatchEvent(new Event('resize'));
  if (on) { if (!keys.has()) showSetup(true); else { showSetup(false); setTimeout(() => ta.focus(), 30); } }
}
function empty() {
  if (logEl.children.length) return;
  logEl.append(el(`<div class="aip-empty"><p><b>The assistant writes on your worksheet.</b> Give it a typed problem, a photo of handwritten work, a screenshot or a single PDF page. It writes definitions and equations, and iCalPad does the math.</p>
    <p><b>Neat up</b> converts what you give it. <b>Set up and solve</b> also adds results and a check.</p>
    <p>Check every line it writes, the same way you would check your own work.</p></div>`));
}

// ---------- settings: key, model, remember ----------
function showSetup(on, msg) {
  if (!st.built) build();
  setupEl.hidden = !on; logEl.hidden = !!on; root.querySelector('form').hidden = !!on; root.querySelector('.aip-mode').hidden = !!on;
  if (!on) return;
  const has = keys.has();
  setupEl.innerHTML = `<h3>AI assistant settings</h3>
    <p>The assistant is optional and off until you add a key. It uses your own Anthropic API key and talks to Anthropic directly from this page. There is no iCalPad server.</p>
    <p>Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.</p>
    ${msg ? `<p class="aip-warn">${esc(msg)}</p>` : ''}
    <label class="fld"><span>API key</span><input type="password" id="ai-key" autocomplete="off" spellcheck="false" placeholder="${has ? 'A key is saved. Type a new one to replace it.' : 'sk-ant-…'}"></label>
    <label class="fld"><span>Model</span><select id="ai-model">${A.MODELS.map(m => `<option value="${m.id}"${m.id === st.model ? ' selected' : ''}>${esc(m.name)} (${esc(m.note)})</option>`).join('')}</select></label>
    <label class="chk"><input type="checkbox" id="ai-rem"${keys.remembered() ? ' checked' : ''}> Remember key on this device</label>
    <p class="aip-small">Off: the key is kept only until you close this tab. On: it is stored in this browser until you press Forget key. The key is never put in worksheets, files, links or messages.</p>
    <div class="aip-btns"><button class="btn solid" type="button" id="ai-save">Save</button>${has ? '<button class="btn line" type="button" id="ai-forget">Forget key</button>' : ''}${has ? '<button class="btn line" type="button" id="ai-back">Back to chat</button>' : ''}</div>
    <p class="aip-note">${esc(NOTE)}</p>`;
  const $k = setupEl.querySelector('#ai-key');
  setupEl.querySelector('#ai-save').addEventListener('click', () => {
    const k = $k.value.trim(), rem = setupEl.querySelector('#ai-rem').checked, model = setupEl.querySelector('#ai-model').value;
    if (!k && !has) { $k.focus(); toast('Paste your Anthropic API key first.'); return; }
    if (k && !A.looksLikeKey(k)) toast('That does not look like an Anthropic API key (they start with sk-ant-). Saved anyway.');
    if (k) keys.set(k, rem); else keys.setRemember(rem);
    $k.value = '';
    if (model !== st.model) { st.model = model; pref('icalpad.ai.model', model); if (st.messages.length) { newChat(); toast('Model changed, so a new chat was started.'); } }
    showSetup(false); setTimeout(() => ta.focus(), 30);
  });
  const f = setupEl.querySelector('#ai-forget'); if (f) f.addEventListener('click', () => { keys.forget(); toast('The key was removed from this browser.'); showSetup(true); });
  const bk = setupEl.querySelector('#ai-back'); if (bk) bk.addEventListener('click', () => showSetup(false));
  $k.addEventListener('keydown', e => { if (e.key === 'Enter') setupEl.querySelector('#ai-save').click(); });
  setTimeout(() => (has ? setupEl.querySelector('#ai-model') : $k).focus(), 30);
}

// ---------- attachments ----------
const okType = f => /^image\/(png|jpeg|webp|gif)$/.test(f.type) || f.type === 'application/pdf';
const readURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('read')); r.readAsDataURL(f); });
const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = src; });
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s); }
async function prep(f) {
  if (f.type === 'application/pdf') {
    if (f.size > 20e6) throw new Error(`${f.name} is larger than 20 MB.`);
    const bytes = new Uint8Array(await f.arrayBuffer()), pages = A.pdfPages(bytes);
    if (pages > 5) throw new Error(`${f.name} has about ${pages} pages. Send one page: print or export just that page to PDF.`);
    return { ref: 'pdf' + (++st.pdfN), mime: 'application/pdf', name: f.name, data: b64(bytes), pages };
  }
  const url = await readURL(f), im = await loadImg(url);
  let w = im.naturalWidth || 800, h = im.naturalHeight || 600, src = url, mime = f.type; const big = Math.max(w, h);
  if (big > 1568 || f.size > 3.5e6) {                       // the API works best with the longest side at 1568 px or less
    const k = Math.min(1, 1568 / big), cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    const cx = cv.getContext('2d'); if (mime !== 'image/png') { cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); }
    cx.drawImage(im, 0, 0, cv.width, cv.height); w = cv.width; h = cv.height;
    src = cv.toDataURL(mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.88); if (src.length > 4.6e6) src = cv.toDataURL('image/jpeg', 0.8);
    mime = src.slice(5, src.indexOf(';'));
  }
  return { ref: 'img' + (++st.refN), mime, name: f.name || 'pasted picture', src, data: src.slice(src.indexOf(',') + 1), w, h };
}
async function attach(files) {
  if (!st.built) build();
  if (!st.open) setOpen(true);
  for (const f of files) {
    if (!okType(f)) { toast(`${f.name || 'That file'} cannot be sent. Use PNG, JPEG, WebP, GIF or a PDF page.`); continue; }
    try { const a = await prep(f); if (a.pages > 1) toast(`${a.name} has ${a.pages} pages. The whole PDF is sent, and each page adds to the cost.`); st.pending.push(a); }
    catch (e) { toast(e.message === 'decode' || e.message === 'read' ? `${f.name || 'That picture'} could not be read.` : e.message); }
  }
  drawAtt(); ta.focus();
}
function drawAtt() {
  attEl.textContent = '';
  st.pending.forEach((a, i) => {
    const c = el(`<span class="aip-chip">${a.src ? '<img alt="">' : '<b>PDF</b>'}<span class="nm"></span><button type="button" class="x" aria-label="Remove">×</button></span>`);
    if (a.src) c.querySelector('img').src = a.src;
    c.querySelector('.nm').textContent = a.name;
    c.querySelector('.x').addEventListener('click', () => { st.pending.splice(i, 1); drawAtt(); });
    attEl.append(c);
  });
}

// ---------- messages ----------
function scrollDown() { logEl.scrollTop = logEl.scrollHeight; }
function userMsg(text, atts) {
  const m = el(`<div class="am user"><div class="att"></div><div class="tx"></div></div>`);
  for (const a of atts) {
    if (a.src) { const im = el('<img alt="">'); im.src = a.src; im.title = a.ref + ': ' + a.name; m.querySelector('.att').append(im); }
    else { const s = el('<span class="pdf"></span>'); s.textContent = `PDF: ${a.name}${a.pages ? ` (${a.pages} ${a.pages === 1 ? 'page' : 'pages'})` : ''}`; m.querySelector('.att').append(s); }
  }
  m.querySelector('.tx').textContent = text || (atts.length ? '(no message)' : '');
  logEl.append(m); scrollDown();
}
function botMsg() {
  const m = el(`<div class="am bot"><div class="tx"></div><div class="st"></div>
    <details class="acts" hidden><summary></summary><ol></ol></details>
    <div class="err" hidden></div><div class="ft"><button class="btn line" type="button" data-undo hidden>Undo AI changes</button><span class="use"></span></div></div>`);
  logEl.append(m); scrollDown();
  return { m, tx: m.querySelector('.tx'), st: m.querySelector('.st'), acts: m.querySelector('.acts'), err: m.querySelector('.err'), undo: m.querySelector('[data-undo]'), use: m.querySelector('.use'), text: '' };
}
const VERB = { add_block: 'Adding', edit_block: 'Changing', move_block: 'Moving', delete_block: 'Deleting', evaluate: 'Checking the worksheet', get_result: 'Reading a result', get_worksheet: 'Reading the worksheet', get_syntax_guide: 'Reading the syntax guide', attach_source_image: 'Attaching the source picture' };
function drawActs(v, X) {
  const n = X.actions.length; v.acts.hidden = !n; if (!n) return;
  v.acts.querySelector('summary').textContent = `Changed the worksheet (${n} ${n === 1 ? 'change' : 'changes'})`;
  const ol = v.acts.querySelector('ol'); ol.textContent = '';
  for (const a of X.actions) {
    const li = el('<li><span class="op"></span> <code></code></li>');
    li.querySelector('.op').textContent = `${a.op} ${a.type}:`; li.querySelector('code').textContent = a.text;
    li.addEventListener('click', () => Cmd.flash([a.id])); ol.append(li);
  }
}
let paintQ = 0;
function paintText(v) { if (paintQ) return; paintQ = requestAnimationFrame(() => { paintQ = 0; v.tx.innerHTML = A.renderSafe(v.text); scrollDown(); }); }   // renderSafe escapes model text first
function setBusy(on) { sendB.hidden = on; stopB.hidden = !on; st.busy = on; root.classList.toggle('busy', on); for (const b of logEl.querySelectorAll('[data-undo]')) if (!b.dataset.done) b.disabled = on; }

// ---------- one turn ----------
async function send() {
  if (st.busy) return;
  if (!keys.has()) { showSetup(true, 'Add your Anthropic API key to start.'); return; }
  const text = ta.value.trim(), atts = st.pending.splice(0);
  if (!text && !atts.length) return;
  ta.value = ''; grow(); drawAtt();
  const ep = logEl.querySelector('.aip-empty'); if (ep) ep.remove();
  for (const a of atts) if (a.src) st.images.set(a.ref, { src: a.src, name: a.name, w: a.w, h: a.h });
  userMsg(text, atts);
  const note = st.note; st.note = '';
  const content = A.userContent({ text: (note ? note + '\n\n' : '') + text, mode: st.mode, attachments: atts, page: A.snapshot(Cmd.regions(), Cmd.evaluate()) });
  await run(botMsg(), content);
}
async function run(v, content) {
  const X = A.Executor(Cmd, { images: st.images }), usage = {};
  st.ctrl = new AbortController(); setBusy(true); v.st.textContent = 'Sending…';
  let out = null, sep = false;
  Cmd.begin();                                      // everything this turn changes becomes one undo step
  try {
    out = await A.runTurn({
      fetchFn: (u, o) => window.fetch(u, o), key: keys.get(), model: st.model, messages: st.messages, content, usage, signal: st.ctrl.signal,
      exec: (name, input) => { const r = X.exec(name, input); if (r.ok && r.result && r.result.id && X.changed.has(r.result.id)) Cmd.flash([r.result.id]); drawActs(v, X); return r; },
      on: (type, d) => {
        if (type === 'text') { if (sep) { v.text += '\n\n'; sep = false; } v.text += d; paintText(v); v.st.textContent = ''; }
        else if (type === 'message') { if (v.text) sep = true; }
        else if (type === 'status') v.st.textContent = d.text || '';
        else if (type === 'tool_start') v.st.textContent = 'Working on the worksheet…';
        else if (type === 'tool') v.st.textContent = (VERB[d.name] || 'Working') + (d.input && d.input.type ? ' ' + d.input.type : '') + '…';
      },
    });
    if (out.limitHit) fail(v, `Stopped after ${A.MAX_TOOL_CALLS} worksheet actions in one message. Send "continue" to let it finish.`);
    else if (out.stop === 'max_tokens') fail(v, 'The reply reached its length limit. Send "continue" to let it finish.');
    else if (out.stop === 'refusal') fail(v, 'The model declined to answer this request.');
  } catch (e) {
    if (e.kind === 'abort') fail(v, 'Stopped.');
    else fail(v, A.scrub(e.message, keys.get()), e.kind);
  } finally {
    Cmd.end(); st.ctrl = null; setBusy(false); v.st.textContent = '';
    if (paintQ) { cancelAnimationFrame(paintQ); paintQ = 0; } v.tx.innerHTML = A.renderSafe(v.text);
    if (!v.text && !v.err.textContent && !X.actions.length) v.tx.innerHTML = '<p class="muted">No reply.</p>';
    drawActs(v, X);
    if (usage.requests) v.use.textContent = A.fmtUsage(usage);
    if (X.log.length) {
      Cmd.flash([...X.changed]);
      v.undo.hidden = false;
      v.undo.onclick = () => {
        if (st.busy) return;
        Cmd.begin(); const r = A.undoTurn(Cmd, X.log); Cmd.end();
        v.undo.disabled = true; v.undo.dataset.done = '1'; v.undo.textContent = 'AI changes undone';
        st.note = '(I undid the worksheet changes from your previous reply.)';
        toast(r.skipped.length ? `Undone. ${r.skipped.length} ${r.skipped.length === 1 ? 'block you edited afterwards was' : 'blocks you edited afterwards were'} left as they are.` : 'The changes from that reply were undone.');
      };
    }
    scrollDown();
  }
}
function fail(v, msg, kind) {
  v.err.hidden = false; v.err.textContent = '';
  const p = el('<p></p>'); p.textContent = msg; v.err.append(p);
  if (kind === 'auth') { const b = el('<button class="btn line" type="button">Open assistant settings</button>'); b.addEventListener('click', () => showSetup(true)); v.err.append(b); }
  const last = st.messages[st.messages.length - 1];
  if (kind && kind !== 'abort' && last && last.role === 'user') {
    const b = el('<button class="btn line" type="button">Try again</button>');
    b.addEventListener('click', () => { if (st.busy) return; if (!keys.has()) { showSetup(true); return; } b.remove(); run(botMsg(), []); });
    v.err.append(b);
  }
}
function newChat() {
  if (st.ctrl) st.ctrl.abort();
  st.messages = []; st.images.clear(); st.refN = 0; st.pdfN = 0; st.pending = []; st.note = '';
  if (st.built) { logEl.textContent = ''; drawAtt(); empty(); showSetup(!keys.has()); }
}

// ---------- the toolbar button ----------
const top = document.querySelector('.top'), ex = document.getElementById('b-ex');
if (top && ex && !document.getElementById('b-ai')) {
  const b = el(`<button class="btn wide-only" id="b-ai" type="button" aria-pressed="false" title="AI assistant (optional, uses your own Anthropic API key)">${ICON.chat}Assistant</button>`);
  b.addEventListener('click', () => setOpen(!st.open)); ex.before(b);
}
P.ai = {
  isOpen: () => st.open, open: () => setOpen(true), toggle: () => setOpen(!st.open), attach,
  openSettings: () => { setOpen(true); showSetup(true); },
};
})();
