# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/mcp-tool-allowlist/security/advisories/new).
Do not open a public issue for an unpatched vulnerability, and do not paste real
credentials into a report.

Only the latest release and the current `main` branch receive security fixes.

## Trust model

This library performs no I/O, holds no credentials and reaches no network. It reads
two strings, compares them against a catalogue the calling server supplies, and
wraps `registerTool`.

It is nevertheless part of a security boundary, because operators use it to withhold
tools from a client. Two properties carry that:

- **A filtered tool is removed, not disabled.** It answers exactly like a tool that
  was never written. `disable()` would hide it from `tools/list` and still answer a
  call with "disabled", which tells a caller what you were trying not to tell them.
- **An entry that matches nothing is fatal.** A typo that were merely ignored would
  leave a tool quietly missing — or, on the deny side, quietly _present_. Silence is
  the failure mode this refuses.

## What is deliberately not defended against

- **A caller that can already set environment variables.** Whoever configures
  `ALLOW_TOOLS` decides what the server exposes; this library enforces that
  decision, it does not adjudicate it.
- **A catalogue that does not match the server.** `all` is taken on trust. If it
  omits a tool the server registers, that tool cannot be filtered. Assert the two
  are the same set in your own test suite — that assertion cannot live here.

## One thing worth knowing

`describeEntry` refuses to echo a rejected entry back once it stops looking like a
tool name. `<PREFIX>_API_KEY` and `<PREFIX>_ALLOW_TOOLS` are adjacent lines in every
compose file, and quoting the value back would print a pasted credential into the
client's log, where it is now in a transcript. Any error message you build yourself
from a raw entry should do the same.
