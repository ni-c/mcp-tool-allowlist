# mcp-tool-allowlist

[![npm version](https://img.shields.io/npm/v/mcp-tool-allowlist)](https://www.npmjs.com/package/mcp-tool-allowlist)
[![node](https://img.shields.io/node/v/mcp-tool-allowlist)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/mcp-tool-allowlist)](LICENSE)

`ALLOW_TOOLS` / `DENY_TOOLS` for a [Model Context
Protocol](https://modelcontextprotocol.io) server — prefix globs, a curated
preset, and error messages that name what actually exists.

Your server ships every tool it has. The operator running it wants a subset:
read-only for one deployment, everything but `delete_*` for another, five tools
for the one that goes into a shared agent. Two environment variables do that in
ten lines.

The other two hundred are about the failure mode. A tool that quietly vanishes
from `tools/list` because somebody typed `get_thnig` is close to undebuggable —
nobody looks for the cause of an _absence_ in an environment variable. So every
entry here has to match something, and one that matches nothing takes the server
down at startup with a message that lists the names that do exist.

```
IMAP_ALLOW_TOOLS: no tool matches "get_messsage".
Valid tools: delete_messages, get_message, list_mailboxes, move_messages,
search_messages, set_flags. "essential" selects the curated preset.
```

No runtime dependencies. The MCP SDK is a **type-only** peer.

## Install

```sh
npm install mcp-tool-allowlist
```

## Use

```ts
import { buildToolFilter, installToolFilter } from 'mcp-tool-allowlist';

const filter = buildToolFilter({
  allowTools: process.env.IMAP_ALLOW_TOOLS,
  denyTools: process.env.IMAP_DENY_TOOLS,
  catalogue: {
    all: [
      'get_message',
      'list_mailboxes',
      'search_messages',
      'move_messages',
      'delete_messages',
    ],
    essential: ['get_message', 'list_mailboxes', 'search_messages'],
  },
  names: {
    allow: 'IMAP_ALLOW_TOOLS',
    deny: 'IMAP_DENY_TOOLS',
    server: 'imap-mcp',
  },
});

installToolFilter(server, filter); // before you register anything
```

`installToolFilter` wraps `registerTool`, so your registration code does not
change — and it is a no-op when neither variable is set, which is the common
case.

### What operators can write

| Entry              | Means                                                                |
| ------------------ | -------------------------------------------------------------------- |
| `get_message`      | that one tool                                                        |
| `list_*`           | every tool whose name starts with `list_`                            |
| `essential`        | the preset your catalogue declares                                   |
| `a, b , ,c`        | whitespace and stray commas are fine                                 |
| `GET_MESSAGE`      | case does not matter; catalogues are lowercase by convention         |
| _(empty or unset)_ | no filtering at all — `IMAP_ALLOW_TOOLS=` is **not** "allow nothing" |

Deny is applied after allow, so `ALLOW_TOOLS=*` with `DENY_TOOLS=delete_*` reads
the way it looks.

A pattern is a prefix plus exactly one trailing `*`. `*_message` and `list_*_x`
are rejected outright rather than silently matching nothing — they look
plausible, and a filter that silently does nothing is the thing this library
exists to prevent.

## The gate

Many servers have a second, coarser switch: `IMAP_READ_ONLY=true` suppresses the
write tools, `SMTP_ALLOW_SEND=false` suppresses the sending tools. Those are one
mechanism seen from opposite ends, so `gate` normalises them to _the suppression
is in effect_:

```ts
buildToolFilter({
  // …
  catalogue: {
    all: ALL_TOOLS,
    essential: ESSENTIAL_TOOLS,
    ungated: READ_TOOLS,
  },
  gate: {
    closed: readOnly,
    variable: 'IMAP_READ_ONLY',
    noun: 'read-only mode',
  },
});
```

`ungated` is what survives while the gate is closed. Keeping the rest in `all`
is the point: a name from the suppressed half is then answered with

```
IMAP_ALLOW_TOOLS: "delete_messages" names a tool that read-only mode suppresses
— it is never registered. Remove it from IMAP_ALLOW_TOOLS, or unset
IMAP_READ_ONLY. Available now: get_message, list_mailboxes, search_messages.
```

rather than "no such tool", which would send the operator looking in the wrong
place entirely.

An exact name is an error; a _pattern_ that matches only suppressed tools is
only a warning, because a pattern is a template rather than a claim about one
tool. A preset member the gate suppresses is dropped in silence — nobody typed
it.

Set `activatesFilter: true` if closing the gate should take effect through this
filter even when neither list is set. That is for servers whose registration
code registers reads and writes together, where splitting it would be a larger
change than the guarantee needs.

## A rejected entry is not echoed blindly

`<PREFIX>_API_KEY` and `<PREFIX>_ALLOW_TOOLS` are adjacent lines in every compose
file, and a paste into the wrong one is a mistake people make. Quoting the value
back would then print the credential into the client's log, where it is now in a
transcript.

So anything tool-name-shaped is shown in full — that is every real typo, and the
message is useless without it — and anything else is described:

```
IMAP_ALLOW_TOOLS: no tool matches an entry of 40 characters that is not
tool-name-shaped (redacted — if you pasted a credential here, it is not in this
log). Valid tools: …
```

The length limit is **derived from your catalogue**, not configured. Nothing
longer than your longest tool name can be a tool name, and a pattern is shorter
still. (This library grew out of servers that each picked the number by hand;
one of them would have redacted its own longest tool name.)

## API

```ts
function buildToolFilter(options: BuildToolFilterOptions): ToolFilter;
function installToolFilter(server: McpServer, filter: ToolFilter): void;
function describeEntry(entry: string, catalogue: Catalogue): string;
class ToolFilterError extends Error {}
```

`buildToolFilter` throws `ToolFilterError` rather than exiting, because a
server's constructor is called in-process by its own tests and an exiting
constructor cannot be tested. Turn it into an exit code at your entry point:

```ts
try {
  server = createServer(config);
} catch (error) {
  if (error instanceof ToolFilterError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
```

Warnings go to `console.error` by default — stdout belongs to the protocol.
Pass `warn` to redirect them.

## Why `remove()` and not "skip"

`installToolFilter` registers the tool and then removes it again. Skipping the
call looks cheaper and breaks one case: the SDK installs its `tools/list`
handler from inside the registration path, so a server whose every tool was
skipped answers `tools/list` with _method not found_ instead of an empty list.

`remove()` deletes the entry from the SDK's tool map, so a filtered tool answers
exactly like a tool that was never written. `disable()` would be wrong — it
hides the tool from `tools/list` but still answers a call with "disabled", which
advertises the refusal and tells a caller what you were trying not to tell them.

## Licence

MIT © Willi Thiel
