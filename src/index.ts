import type { McpServer } from '@modelcontextprotocol/server';

/**
 * `ALLOW_TOOLS` / `DENY_TOOLS` for an MCP server, with error messages that name
 * what exists.
 *
 * The shape of the problem: an MCP server ships every tool it has, and the
 * operator running it wants a subset. Doing that with two environment variables
 * is easy; doing it so that a typo is *visible* is the part that takes a file
 * this size. A tool quietly missing from `tools/list` is the worst failure mode
 * available here, because nobody looks for the cause of an absence in an
 * environment variable.
 *
 * So every entry has to match something, and an entry that matches nothing is
 * fatal rather than ignored.
 */

/** A tool list that names something this server does not have. */
export class ToolFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolFilterError';
  }
}

export interface ToolFilter {
  /** False when nothing is filtered at all — then `installToolFilter` is a no-op. */
  readonly active: boolean;
  /** The tools that survive. Only meaningful while `active`. */
  readonly selected: ReadonlySet<string>;
}

/**
 * What the server can offer, as the server itself declares it.
 *
 * `all` is the authority: an entry that names nothing in it is a typo, whatever
 * else is configured. `ungated` is the subset that survives when the gate below
 * is closed — the write tools of a read-only server, the sending tools of a
 * server whose sending is switched off. Keeping those in `all` while leaving
 * them out of `ungated` is what lets a name from that half be answered with
 * "the gate suppresses it" instead of "no such tool".
 */
export interface Catalogue {
  readonly all: readonly string[];
  /** Members of the `essential` preset. Omitted means the preset does not exist. */
  readonly essential?: readonly string[];
  /** What is registered when the gate is closed. Omitted means the gate never closes anything. */
  readonly ungated?: readonly string[];
}

/** How the two variables and the server are called, for the error messages. */
export interface Names {
  /** e.g. `IMAP_ALLOW_TOOLS` */
  readonly allow: string;
  /** e.g. `IMAP_DENY_TOOLS` */
  readonly deny: string;
  /** e.g. `imap-mcp`, used to prefix warnings on stderr. */
  readonly server: string;
}

/**
 * A second, independent switch that removes a whole half of the catalogue.
 *
 * Two servers spell this differently — `IMAP_READ_ONLY=true` suppresses the
 * write tools, `SMTP_ALLOW_SEND=false` suppresses the sending tools — and they
 * are the same mechanism seen from opposite ends. `closed` is normalised to
 * "the suppression is in effect", so a caller passes `readOnly` or `!allowSend`
 * and the vocabulary follows from `variable` and `noun`.
 */
export interface Gate {
  /** True when the suppression is in effect. */
  readonly closed: boolean;
  /** The variable that closed it, e.g. `IMAP_READ_ONLY`. */
  readonly variable: string;
  /** How to name it mid-sentence, e.g. `read-only mode` or `the send gate`. */
  readonly noun: string;
  /**
   * Whether a closed gate is reason enough to run the filter at all.
   *
   * Default false: with no lists set, nothing is filtered and the server
   * registers what it always registers. A server that implements its read-only
   * mode *through* this filter rather than through its registration code sets
   * this, so that closing the gate takes effect on its own.
   */
  readonly activatesFilter?: boolean;
}

export interface BuildToolFilterOptions {
  /** Raw value of the allow variable, exactly as read from the environment. */
  readonly allowTools: string | undefined;
  /** Raw value of the deny variable. */
  readonly denyTools: string | undefined;
  readonly catalogue: Catalogue;
  readonly names: Names;
  readonly gate?: Gate;
  /** Where warnings go. Defaults to stderr, which is where MCP servers log. */
  readonly warn?: (message: string) => void;
}

/** The `essential` preset is spelled out here so it cannot collide with a tool name. */
const PRESET = 'essential';

/**
 * Splits a comma-separated value into entries.
 *
 * Empty entries are dropped, so `a,,b` and a trailing comma are both fine, and
 * a value that is empty or only whitespace counts as *unset* — `X_ALLOW_TOOLS=`
 * in a compose file must not mean "allow nothing". Entries are lowercased:
 * catalogues are lowercase by convention, so this is lossless, and a shell that
 * upper-cased a name should not take the server down.
 */
function entriesOf(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const entries = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}

/**
 * How a rejected entry is quoted back.
 *
 * `<PREFIX>_API_KEY` and `<PREFIX>_ALLOW_TOOLS` are adjacent lines in every
 * compose file and in every README table, and a paste into the wrong one is a
 * mistake people make. Echoing the value would then print the credential into
 * the client's log.
 *
 * Anything tool-name-shaped is shown in full, because that is every real typo
 * and the message is useless without it. Anything else is described rather than
 * quoted; the catalogue list that follows already says what a valid entry is.
 *
 * The length limit is **derived from the catalogue** rather than configured.
 * The servers that had this check first each computed their own number by hand
 * — 24 in one, 32 in another — and one of those would have redacted its own
 * longest tool name. The longest name that exists is the only limit that cannot
 * be wrong: nothing longer can be a tool name, and a pattern is shorter still.
 */
export function describeEntry(entry: string, catalogue: Catalogue): string {
  const longest = catalogue.all.reduce(
    (max, tool) => Math.max(max, tool.length),
    PRESET.length
  );
  return entry.length <= longest && /^[a-z0-9_*-]+$/.test(entry)
    ? `"${entry}"`
    : `an entry of ${entry.length} characters that is not tool-name-shaped ` +
        '(redacted — if you pasted a credential here, it is not in this log)';
}

/**
 * Reads the two variables and works out which tools survive.
 *
 * Throws {@link ToolFilterError} rather than exiting: a server's constructor is
 * called in-process by its tests, and an exiting constructor cannot be tested.
 * The entry point turns it back into an exit code.
 */
export function buildToolFilter(options: BuildToolFilterOptions): ToolFilter {
  const { catalogue, names, gate } = options;
  const warn = options.warn ?? ((message: string) => console.error(message));
  const allow = entriesOf(options.allowTools);
  const deny = entriesOf(options.denyTools);
  const gateClosed = gate?.closed === true;

  const describe = (entry: string): string => describeEntry(entry, catalogue);
  const catalogueList = (): string => [...catalogue.all].sort().join(', ');

  /** Expands one entry to the catalogue tools it names. */
  const expand = (entry: string, variable: string): string[] => {
    const star = entry.indexOf('*');
    if (star !== -1) {
      // A pattern is a literal prefix plus exactly one trailing `*`. Anything
      // else is rejected outright: `*_thing` and `list_*_x` look plausible,
      // match nothing, and would otherwise be silent forever.
      if (star !== entry.length - 1) {
        throw new ToolFilterError(
          `${variable}: ${describe(entry)} is not a valid entry — a pattern is a prefix ` +
            'followed by a single trailing "*", for example "list_*". Everything ' +
            'else is an exact tool name.'
        );
      }
      const prefix = entry.slice(0, -1);
      return catalogue.all.filter((tool) => tool.startsWith(prefix));
    }
    return catalogue.all.filter((tool) => tool === entry);
  };

  if (
    allow === undefined &&
    deny === undefined &&
    !(gateClosed && gate?.activatesFilter === true)
  ) {
    return { active: false, selected: new Set() };
  }

  // Narrowed once, so the messages below cannot need a fallback for a gate that
  // is provably there: `survivors` can only come out empty while this is set —
  // with the gate open, `registered` is the whole catalogue and the matches were
  // filtered out of exactly that.
  const suppression = gateClosed ? (gate as Gate) : undefined;

  // What would be registered without any filter. Gated-off tools stay in the
  // catalogue so that a name from that half is answered with "suppressed",
  // never with "no such tool".
  const registered = new Set<string>(
    suppression ? (catalogue.ungated ?? []) : catalogue.all
  );

  // Set to the gate's own wording when an allow entry named real tools and the
  // gate suppressed all of them, so that "nothing is left" can name the reason
  // rather than shrugging.
  let suppressedBy: string | undefined;

  let selected: Set<string>;
  if (allow === undefined) {
    selected = new Set(registered);
  } else {
    selected = new Set<string>();
    for (const entry of allow) {
      if (entry === PRESET && catalogue.essential !== undefined) {
        // Preset members are not names the operator typed, so a member the gate
        // suppresses is dropped silently rather than being an error.
        for (const tool of catalogue.essential) {
          if (registered.has(tool)) selected.add(tool);
        }
        continue;
      }

      const matches = expand(entry, names.allow);
      if (matches.length === 0) {
        const preset =
          catalogue.essential === undefined
            ? ''
            : ` "${PRESET}" selects the curated preset.`;
        throw new ToolFilterError(
          `${names.allow}: no tool matches ${describe(entry)}. Valid tools: ${catalogueList()}.${preset}`
        );
      }

      const survivors = matches.filter((tool) => registered.has(tool));
      if (suppression !== undefined && survivors.length === 0) {
        if (entry.endsWith('*')) {
          // A pattern is a template, not a claim about one tool: warn, continue.
          warn(
            `${names.server}: ${names.allow}: ${describe(entry)} matches only tools ` +
              `that ${suppression.noun} suppresses — it contributes nothing.`
          );
          suppressedBy = suppression.noun;
          continue;
        }
        // An exact name, though, was typed by someone who believes it is exposed.
        throw new ToolFilterError(
          `${names.allow}: ${describe(entry)} names a tool that ${suppression.noun} suppresses — ` +
            `it is never registered. Remove it from ${names.allow}, or unset ` +
            `${suppression.variable}. Available now: ${[...registered].sort().join(', ')}.`
        );
      }
      for (const tool of survivors) selected.add(tool);
    }
  }

  for (const entry of deny ?? []) {
    // Deny lists are written defensively — "never expose delete_*, whatever
    // else is on" — so matching nothing that survives is fine. Matching nothing
    // in the catalogue is still a typo.
    const matches = expand(entry, names.deny);
    if (matches.length === 0) {
      throw new ToolFilterError(
        `${names.deny}: no tool matches ${describe(entry)}. Valid tools: ${catalogueList()}.`
      );
    }
    for (const tool of matches) selected.delete(tool);
  }

  if (selected.size === 0) {
    throw new ToolFilterError(
      suppressedBy === undefined
        ? `${names.allow}/${names.deny} leave no tools registered — the ` +
            'server would start with an empty tool list.'
        : `${names.allow} selects only tools that ${suppressedBy} suppresses — the ` +
            'server would start with an empty tool list.'
    );
  }

  return { active: true, selected };
}

/**
 * Makes `server` register only the tools the filter selected.
 *
 * The tool is registered and then removed again rather than skipped. Skipping
 * looks cheaper and breaks one case: the SDK installs its `tools/list` handler
 * from inside the registration path, so a server whose every tool was skipped
 * would answer `tools/list` with "method not found" instead of an empty list.
 * `remove()` deletes the entry from the SDK's tool map outright, which makes a
 * filtered tool answer `Tool X not found` — exactly what a tool a read-only
 * mode never registered already does. `disable()` would be wrong: it hides the
 * tool from `tools/list` but still answers a call with "disabled", which
 * advertises a refusal.
 */
export function installToolFilter(server: McpServer, filter: ToolFilter): void {
  if (!filter.active) return;
  const register = server.registerTool.bind(server);
  // `registerTool` is overloaded in SDK v2 — the raw-shape `inputSchema` form
  // survives as a deprecated second signature — and TypeScript does not
  // contextually type the parameters of an implementation written against an
  // overloaded method. So the wrapper names its own parameters and is asserted
  // back to the method's type. Only `name` is read here; `config` and `cb` are
  // passed through untouched, and every call site keeps the SDK's own types.
  const wrapper = ((name: string, config: never, cb: never) => {
    const tool = register(name, config, cb);
    if (!filter.selected.has(name)) tool.remove();
    return tool;
  }) as McpServer['registerTool'];
  server.registerTool = wrapper;
}
