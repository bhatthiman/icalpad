# iCalPad user guide

iCalPad is a free-form math page. You type definitions, equations and result lines anywhere on it, and it computes the answers with units. This guide covers the main parts. The **?** button in the app lists every function and unit.

> **Always check your answers.** iCalPad is a new tool and may contain errors. Verify any result before you rely on it.

## The page

- Click an empty spot and start typing to add a math line there. Drag anything to move it.
- Lines are read top to bottom, then left to right along a row. A name must be defined above where it is used.
- **+ Math**, **+ Note**, **+ Plot**, **+ Picture** and **+ Sketch** add items. Right-click the page for the same choices at that spot.
- **Undo** and **Redo** work across the whole page (Ctrl+Z and Ctrl+Y, or ⌘Z on a Mac).
- **File** saves the page as a `.json` file, opens one, or copies the whole page as LaTeX.

## Math lines

| Type this | You get |
| --- | --- |
| `L := 6 m` | Define a value |
| `M := w*L^2/8` | Define a value from others |
| `M =` | Show a value |
| `M = kN*m` | Show it in chosen units |
| `x ->` | An exact symbolic answer |
| `M <= 100 kN*m` | An OK or NG check |

Notes can hold headings (start with `#`) and math between `$` signs.

## Pictures

Drop or paste a picture onto the page. Select it to draw on it with the pen, arrow, label and eraser tools. A stylus such as Apple Pencil draws directly on a selected picture.

## Solvers

The built-in solver is always on. The optional advanced solver (SymPy in the browser) is a one-time download of about 20 MB, and only loads if you turn it on.

## AI assistant

The assistant is optional. It reads what you give it (a typed problem, a photo of handwritten work, a screenshot of a textbook problem, or a single PDF page) and writes it on the worksheet. **iCalPad computes; the assistant writes.** It writes definitions and equations in iCalPad syntax, and every number or symbolic answer on the page comes from iCalPad's engine. The model is not allowed to type a result in as a number.

### Privacy

> Your messages, images and the current worksheet are sent to Anthropic using your own API key. Usage is billed to your Anthropic account.

- The assistant is **off by default**. Nothing is sent to Anthropic unless you open the assistant, enter a key and send a message. The rest of iCalPad works the same whether or not you use it.
- Requests go straight from your browser to Anthropic (`api.anthropic.com`). There is no iCalPad server.
- Each message includes a text summary of the current worksheet (block ids, contents and whether each line has an error) so the assistant knows what is already there.
- Chats are not saved. Reloading the page or pressing **New chat** clears the conversation.

### Getting a key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in or create an account.
2. Add billing, then create an API key. It starts with `sk-ant-`.
3. In iCalPad, open **Assistant** (top bar, or **More** on a phone), paste the key and press **Save**.

The key is kept only in this tab until you close it. Tick **Remember key on this device** to keep it in this browser's local storage instead. **Forget key** removes it from both. The key is never put in worksheets, saved files, links, error messages or the console. Anyone who can use this browser profile can use a remembered key, so leave the box off on shared computers.

You can also open the assistant settings from **Settings** (the sliders icon), under **AI assistant**.

### Models

The model list offers Claude Sonnet 5.5 (the default, a good balance of quality and cost), Claude Opus 5.5 and Claude Fable 5.2 (more capable, cost more), and Claude Haiku 5.5 (fastest and cheapest). Changing the model starts a new chat. Prices are on Anthropic's website; the token line under each reply shows what that reply used.

### Modes

- **Neat up** converts what you give it into clean worksheet content. It does not add steps, solve, or add result lines the source does not have, unless you ask.
- **Set up and solve** writes a title, the givens with units, assumptions, the equations in order, result lines so iCalPad computes the answers, and a short check.

### Sending pictures and PDF pages

- Attach with the paper clip, paste into the message box, or drop files onto the panel. When the panel is open and you drop a picture on the page, iCalPad asks whether to send it to the assistant or place it on the page.
- PNG, JPEG, WebP and GIF pictures are scaled down so the longest side is at most 1568 px before sending.
- PDFs are sent whole, so send a single page where you can. PDFs of more than 5 pages are refused; print or export the page you need.
- The assistant first says what it read, marks anything unclear, and states any assumption in a note on the page. It can attach your picture as a **source image** above or below its work. Source images have a **Hide** / **Show** button.

### What you see after each reply

- Blocks the assistant added or changed are briefly highlighted.
- **Changed the worksheet** lists every change. Click a line to highlight that block.
- **Undo AI changes** reverses that reply's changes and keeps any edits you made yourself afterwards. Ctrl+Z also undoes a whole reply in one step.
- A small line shows the tokens used.

You can keep editing the page while the assistant works. **Stop** ends the current request.

### Errors

| Message | What to do |
| --- | --- |
| The key was not accepted (401) | Check or replace the key in the assistant settings. |
| Rate limit reached (429) | The assistant waits and tries again a few times. If it still fails, wait a minute. |
| Anthropic is overloaded (529) | Same as above. |
| Could not reach Anthropic | Check your internet connection, then press **Try again**. |
| Stopped after 30 worksheet actions | Each message allows up to 30 tool calls. Send "continue". |

### Where it works

The assistant works on [hse95.github.io/icalpad](https://hse95.github.io/icalpad/) and in a downloaded copy of `index.html`. Pages that block outside requests (some embedded previews) cannot reach Anthropic, so the assistant will report a network error there.

### Limits

- The assistant can make mistakes in reading handwriting or in setting up a problem. Check every line it writes, the same way you would check your own work.
- It writes headings, notes, text, definitions, equations, result lines and source images. It does not create plots or drawings yet.
- Pictures stay in the chat history, so long chats with many pictures cost more. Start a **New chat** for a new problem.
