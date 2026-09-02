# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [0.2.1] - 2026-09-02

### Fixed

- The "nothing is left" error blamed the gate whenever a pattern had been
  suppressed, even when the **deny list** was what emptied the selection. The
  wording was wrong twice over: the allow list had named a registered tool, and
  the only remedy the message offers is to unset the gate variable — which
  registers the write tools the gate was closed for. Following it turned a
  server that refuses to start into a read-only deployment serving its writes.
  The gate is now named only when nothing survived it before the deny list ran.

- Entries keep the case they were written in. They were lowercased on the way
  in, which handed `describeEntry` a mixed-case credential as lowercase hex —
  passing the charset half of the redaction. Combined with a catalogue whose
  longest tool name is 32 characters, a 32-character API key was inside the
  length limit too, and both halves let it through into the error message.
  Matching stays case-insensitive; only the value the message sees changed.

### Added

- `buildToolFilter` validates the catalogue it is given: a name in `essential`
  or `ungated` that is not in `all` is now a `ToolFilterError` naming it. `all`
  is what every entry is resolved against, so a name outside it can never be
  selected — a stray `essential` member drops out of the preset in silence, and
  a stray `ungated` member is contradictory (registered while the gate is
  closed, fatal to name in the allow list). Seventeen servers assert this in
  their own suites; it belongs at the one place that depends on it.

### Changed

- The JSDoc for `Catalogue.ungated` said "omitted means the gate never closes
  anything". The code does `catalogue.ungated ?? []`, so omitting it means a
  closed gate suppresses **everything** — the server then refuses to start. The
  code is right (fail-closed) and the comment was the outlier.

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
