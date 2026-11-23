# Design decisions

Short records of choices that shape iCalPad, with the reasons. Newest first.

## 2026-11: The AI assistant uses the user's own key and has no backend

**Decision.** The assistant calls the Anthropic Messages API directly from the browser with an API key the user provides. There is no iCalPad server or proxy.

**Why.**
- iCalPad is a single static file on GitHub Pages. A server would add hosting cost, accounts, and a place where other people's data passes through.
- With the user's own key, usage is billed to them and visible in their own Anthropic console, and the author never sees their messages or worksheets.
- The rest of the app keeps working with no network at all.

**Costs and how they are handled.**
- The key is in the browser. It is kept in memory and session storage by default, and in local storage only when the user ticks **Remember key on this device**. It is never written into worksheets, files, links, logs or error messages (messages pass through a scrubber), and **Forget key** removes it. The settings and the user guide warn against remembering a key on shared computers.
- Direct browser calls need the `anthropic-dangerous-direct-browser-access: true` header. That header exists because a key in a web page can be read by anyone using that page; here the page belongs to the key's owner, which is the case the header is meant for.
- Hosts that block outside requests (such as some embedded previews) cannot use the assistant.

## 2026-11: iCalPad computes; the model writes

**Decision.** The model changes the page only through tools that call the same command layer as the buttons. Every block it writes goes through iCalPad's parser and engine, exactly like typed input. The model never supplies a number shown as a result.

**Why.** A language model can misremember arithmetic or units. iCalPad's engine is tested and deterministic. Keeping all computation in the engine means a wrong answer can only come from a wrong setup, which the user can see and check line by line.

**How it is enforced.**
- A result line must end with `=`, `= unit` or `->`, and may not just repeat a typed number.
- An equation such as `V = 60 kN` (a name set to a typed number) is refused; givens must be definitions with `:=`.
- A definition that types a value for a name the page already calculates is refused.
- Text, headings and notes may not state a value with `=` unless that number is a given typed in a math block.
- A block that has an error, or that breaks other blocks, is not added; the exact error goes back to the model.
- The model reads values through `get_result` when it explains them.

These checks catch the common ways a typed value could pass as a result. They cannot read intent: a model could still type a calculated number as a "given". The system prompt forbids it, the action list shows every line written, and the user is told to check each line.

## 2026-11: One undo step per assistant reply

**Decision.** History commits are held while a reply runs, so the whole reply becomes one undo step. Each reply also keeps a log of its own changes, and **Undo AI changes** reverses just those, skipping blocks the user edited afterwards.

**Why.** A reply can add twenty blocks; undoing them one at a time would be tedious. The separate log lets the user keep their own edits made while the assistant worked.

## 2026-11: Changing the model starts a new chat

**Decision.** Picking another model clears the conversation.

**Why.** The API returns thinking blocks that must be sent back unchanged during a tool loop, and these are tied to the model that produced them. Starting fresh avoids rejected requests.

## 2026-11: The system prompt is half written, half generated

**Decision.** The rules for the assistant live in `src/ai/system-prompt.md`. The syntax guide (block types, functions, units, help rows) is generated at runtime from the engine's own tables.

**Why.** The function and unit lists cannot drift out of date when the engine changes, and the rules stay readable and easy to edit.

## 2026-11: PDFs are sent whole, up to 5 pages

**Decision.** A PDF is sent as a document block without splitting it into pages. PDFs over 5 pages are refused with a message.

**Why.** Splitting PDFs in the browser needs a PDF library, which would add a lot to a single-file app. The assistant is meant for one problem at a time, and a short PDF is cheap enough.
