// Builds streamed Messages API responses (server-sent events) for tests. No real API calls are made anywhere in the tests.
// A block is { text } | { tool: name, input, id } | { thinking, signature }.
let n = 0;
function sse(blocks, stop = 'end_turn', usage = { input_tokens: 120, output_tokens: 40 }) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { id: 'msg_' + (++n), type: 'message', role: 'assistant', content: [], model: 'mock', stop_reason: null, usage: { input_tokens: usage.input_tokens, output_tokens: 1, cache_read_input_tokens: usage.cache_read_input_tokens || 0 } } });
  out += ev('ping', {});
  blocks.forEach((b, i) => {
    if (b.thinking !== undefined) {
      out += ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      if (b.thinking) out += ev('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: b.thinking } });
      out += ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: b.signature || 'sig-' + i } });
    } else if (b.tool) {
      const id = b.id || 'toolu_' + (++n), js = JSON.stringify(b.input || {}), cut = Math.max(1, Math.floor(js.length / 2));
      out += ev('content_block_start', { index: i, content_block: { type: 'tool_use', id, name: b.tool, input: {} } });
      out += ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: js.slice(0, cut) } });
      out += ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: js.slice(cut) } });
    } else {
      out += ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      const t = b.text || '', h = Math.ceil(t.length / 2);
      if (t) { out += ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: t.slice(0, h) } }); out += ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: t.slice(h) } }); }
    }
    out += ev('content_block_stop', { index: i });
  });
  out += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
  out += ev('message_stop', {});
  return out;
}
// A fetch stand-in that answers from a script. Each step is a function (requestBody, callIndex) -> { status, body, headers } or a string of SSE.
function mockFetch(steps, opts = {}) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body), i = calls.length; calls.push({ url, headers: init.headers, body, raw: init.body });
    if (init.signal && init.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    let step = steps[Math.min(i, steps.length - 1)]; if (typeof step === 'function') step = step(body, i);
    if (step && step.network) throw new TypeError('Failed to fetch');
    if (typeof step === 'string') step = { status: 200, body: step };
    const chunks = opts.chunk ? split(step.body, opts.chunk) : [step.body];
    const stream = new ReadableStream({ async start(c) { for (const ch of chunks) { if (opts.delay) await new Promise(r => setTimeout(r, opts.delay)); if (init.signal && init.signal.aborted) { c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; } c.enqueue(new TextEncoder().encode(ch)); } c.close(); } });
    return new Response(step.status === 200 ? stream : step.body, { status: step.status, headers: { 'content-type': step.status === 200 ? 'text/event-stream' : 'application/json', ...(step.headers || {}) } });
  };
  f.calls = calls; return f;
}
function split(s, n) { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; }
const apiError = (status, type, message, headers) => ({ status, body: JSON.stringify({ type: 'error', error: { type, message } }), headers });
module.exports = { sse, mockFetch, apiError };
