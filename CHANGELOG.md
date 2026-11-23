# Changelog

## 1.1.0 (2026-11-22)

### Added
- **Optional AI assistant** that writes the worksheet. Bring your own Anthropic API key; there is no iCalPad server. Off by default, and nothing is sent until you open the assistant and enter a key.
  - Chat panel docked on the right (full screen on phones), opened from **Assistant** in the top bar or **More** on a phone.
  - Send typed problems, pictures (PNG, JPEG, WebP, GIF; scaled to 1568 px on the long side) and PDF pages by attaching, pasting or dropping.
  - Two modes: **Neat up** and **Set up and solve**.
  - The model edits the page only through tools (`add_block`, `edit_block`, `move_block`, `delete_block`, `evaluate`, `get_result`, `get_worksheet`, `get_syntax_guide`, `attach_source_image`). Every call is parsed and evaluated by iCalPad, and errors are returned word for word. Typed-in results are refused.
  - One undo step per reply, an **Undo AI changes** button, a list of changes, highlights on changed blocks, and a token usage line.
  - Streaming replies, **Stop**, retries with backoff on 429 and 529, clear messages for 401 and network failures, and a cap of 30 tool calls per message.
  - Settings: key field, model choice (Sonnet 5.5 by default; Opus 5.5, Fable 5.2 and Haiku 5.5 offered), **Remember key on this device** (off by default), and **Forget key**.
- **Note blocks** (highlighted remarks) and **source images** (a picture with a caption and a Hide/Show button). Both are kept in saved worksheets.
- The version number in the help dialog.
- Tests for the assistant: Node unit tests and browser tests with the API mocked. A GitHub Actions workflow runs all tests.
- Docs: [user guide](docs/user-guide.md) and [design decisions](docs/decisions.md).

### Unchanged
- The math engine. All earlier tests pass as before.

## 1.0.0 (2026-11)

- First public release: free-form worksheet, units, symbolic math, LaTeX in and out, animated plots, pictures with markup, examples, optional SymPy solver.
- Later 1.0 updates: eraser, Apple Pencil support, iCalPad's own right-click menu, a fix for the play button missing clicks, and faster updates.
