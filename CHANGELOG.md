# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [0.2.0] - 2026-09-01

### Changed

- The error for "the gate left nothing registered" now names the switch as well
  as its wording — it ends `… suppresses, but THING_READ_ONLY is set …` where it
  previously stopped at the wording.

  Found while migrating the first server off its own copy, whose message had
  always named the variable. It is the more severe of the two gate errors — the
  server does not start at all — and it was the less actionable one, while the
  milder "you named a suppressed tool" already said which variable to unset.

  Minor rather than patch because the text is what callers assert on.

## [0.1.0] - 2026-09-01

First release. Extracted from the `ALLOW_TOOLS`/`DENY_TOOLS` implementation that
had been copied across seventeen MCP servers, where nine copies were byte-identical
and the rest differed only in additive modes.

### Added

- `buildToolFilter` — reads the two variables against a catalogue the server
  declares, and refuses an entry that names nothing rather than silently
  dropping a tool from `tools/list`.
- `installToolFilter` — wraps `registerTool`, so registration code does not
  change and an unset filter costs nothing.
- `describeEntry` — quotes a rejected entry back only while it is
  tool-name-shaped, so a credential pasted into the wrong compose line does not
  reach the client's log. The length limit is derived from the catalogue rather
  than configured; a hand-picked number would have redacted one server's own
  longest tool name.
- The `gate` option, generalising `READ_ONLY` and `ALLOW_SEND` into one
  mechanism: the suppressed half stays in the catalogue, so a name from it is
  answered with "the gate suppresses it" rather than "no such tool".

<!-- #endregion changelog -->

[0.1.0]: https://github.com/ni-c/mcp-tool-allowlist/releases/tag/v0.1.0
