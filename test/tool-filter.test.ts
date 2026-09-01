import { describe, expect, it, vi } from 'vitest';

import {
  ToolFilterError,
  buildToolFilter,
  describeEntry,
  installToolFilter,
  type Catalogue,
  type Gate,
  type ToolFilter,
} from '../src/index.js';

/**
 * A catalogue shaped like a real server's: reads and writes, a curated preset
 * that leaves the destructive tool out, and one name long enough to test the
 * redaction limit against.
 */
const READ = ['get_thing', 'list_things', 'search_things'] as const;
const WRITE = ['create_thing', 'update_thing', 'delete_thing'] as const;

const CATALOGUE: Catalogue = {
  all: [...READ, ...WRITE],
  essential: [
    'get_thing',
    'list_things',
    'search_things',
    'create_thing',
    'update_thing',
  ],
  ungated: READ,
};

const NAMES = {
  allow: 'THING_ALLOW_TOOLS',
  deny: 'THING_DENY_TOOLS',
  server: 'thing-mcp',
};
const GATE: Gate = {
  closed: false,
  variable: 'THING_READ_ONLY',
  noun: 'read-only mode',
};

function build(
  overrides: {
    allowTools?: string;
    denyTools?: string;
    catalogue?: Catalogue;
    gate?: Gate;
    warn?: (message: string) => void;
  } = {}
): ToolFilter {
  return buildToolFilter({
    allowTools: overrides.allowTools,
    denyTools: overrides.denyTools,
    catalogue: overrides.catalogue ?? CATALOGUE,
    names: NAMES,
    ...(overrides.gate === undefined ? {} : { gate: overrides.gate }),
    ...(overrides.warn === undefined ? {} : { warn: overrides.warn }),
  });
}

const selected = (filter: ToolFilter): string[] => [...filter.selected].sort();

describe('when nothing is configured', () => {
  it('does not filter at all', () => {
    // Not "selects everything": an inactive filter never wraps registerTool, so
    // the common path allocates nothing and cannot get the wrapping wrong.
    const filter = build();
    expect(filter.active).toBe(false);
    expect(filter.selected.size).toBe(0);
  });

  it('treats an empty or whitespace value as unset', () => {
    // THING_ALLOW_TOOLS= in a compose file must not mean "allow nothing" — that
    // reading would take the server down for a line somebody left blank.
    expect(build({ allowTools: '' }).active).toBe(false);
    expect(build({ allowTools: '   ' }).active).toBe(false);
    expect(build({ allowTools: ',,' }).active).toBe(false);
  });
});

describe('choosing tools', () => {
  it('keeps exactly what an allow list names', () => {
    expect(selected(build({ allowTools: 'get_thing,delete_thing' }))).toEqual([
      'delete_thing',
      'get_thing',
    ]);
  });

  it('expands a trailing-star pattern', () => {
    expect(selected(build({ allowTools: 'list_*' }))).toEqual(['list_things']);
  });

  it('removes what a deny list names, from everything else', () => {
    expect(selected(build({ denyTools: 'delete_thing' }))).toEqual([
      'create_thing',
      'get_thing',
      'list_things',
      'search_things',
      'update_thing',
    ]);
  });

  it('applies deny after allow', () => {
    // The order is the whole contract: "everything that looks like a read, but
    // not that one" has to be expressible in one pass.
    expect(
      selected(build({ allowTools: '*', denyTools: 'delete_thing' }))
    ).toEqual([
      'create_thing',
      'get_thing',
      'list_things',
      'search_things',
      'update_thing',
    ]);
  });

  it('tolerates stray commas and whitespace, and upper case', () => {
    // A shell that upper-cased a name should not take the server down, and the
    // catalogue is lowercase by convention so lowering is lossless.
    expect(
      selected(build({ allowTools: ' GET_THING , , list_things ' }))
    ).toEqual(['get_thing', 'list_things']);
  });

  it('selects the curated preset by name', () => {
    expect(selected(build({ allowTools: 'essential' }))).toEqual([
      'create_thing',
      'get_thing',
      'list_things',
      'search_things',
      'update_thing',
    ]);
  });

  it('combines the preset with a name it leaves out', () => {
    expect(
      build({ allowTools: 'essential,delete_thing' }).selected.has(
        'delete_thing'
      )
    ).toBe(true);
  });

  it('treats "essential" as an ordinary name when the catalogue has no preset', () => {
    // A server without a preset must not silently accept the word; it is then
    // a tool name like any other, and there is no such tool.
    const catalogue: Catalogue = { all: [...CATALOGUE.all] };
    expect(() => build({ allowTools: 'essential', catalogue })).toThrow(
      /no tool matches/
    );
  });
});

describe('an entry that names nothing', () => {
  it('is fatal rather than ignored', () => {
    // The failure it produces otherwise is invisible: a tool quietly missing
    // from tools/list, and nobody looks for the cause of an absence in an
    // environment variable.
    expect(() => build({ allowTools: 'get_thnig' })).toThrow(ToolFilterError);
    expect(() => build({ allowTools: 'get_thnig' })).toThrow(
      /no tool matches "get_thnig"/
    );
  });

  it('is fatal on the deny side too', () => {
    // Matching nothing that survives is fine there — deny lists are written
    // defensively. Matching nothing in the catalogue is still a typo.
    expect(() => build({ denyTools: 'delete_thnig' })).toThrow(
      /no tool matches/
    );
  });

  it('lists the names that do exist', () => {
    expect(() => build({ allowTools: 'nope' })).toThrow(
      /create_thing, delete_thing, get_thing/
    );
  });

  it('rejects a star that is not at the end', () => {
    for (const entry of ['*_thing', 'list_*_x', '*']) {
      const built = () => build({ allowTools: entry });
      if (entry === '*') {
        expect(built().selected.size).toBeGreaterThan(0);
      } else {
        expect(built).toThrow(
          /a pattern is a prefix followed by a single trailing/
        );
      }
    }
  });
});

describe('the gate', () => {
  const closed: Gate = { ...GATE, closed: true };

  it('narrows the default selection to the ungated half', () => {
    expect(
      selected(build({ denyTools: 'search_things', gate: closed }))
    ).toEqual(['get_thing', 'list_things']);
  });

  it('stays out of the way while it is open', () => {
    expect(selected(build({ allowTools: 'delete_thing', gate: GATE }))).toEqual(
      ['delete_thing']
    );
  });

  it('refuses an exact name it suppresses, and says which switch to change', () => {
    // Someone typed that name because they believe the tool is exposed. Telling
    // them it does not exist would send them looking in the wrong place.
    expect(() => build({ allowTools: 'delete_thing', gate: closed })).toThrow(
      /read-only mode suppresses.*THING_READ_ONLY/s
    );
  });

  it('only warns about a pattern it suppresses', () => {
    // A pattern is a template, not a claim about one tool.
    const warn = vi.fn();
    const filter = build({ allowTools: 'get_*,delete_*', gate: closed, warn });
    expect(selected(filter)).toEqual(['get_thing']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('contributes nothing')
    );
  });

  it('names the gate when it is the reason nothing is left', () => {
    // And names the *switch*, not just the wording. This is the more severe of
    // the two gate errors — the server will not start at all — so it must not
    // be the less actionable one. The exact-name case above already says which
    // variable to unset; leaving it out here sends the operator hunting.
    const warn = vi.fn();
    expect(() => build({ allowTools: 'delete_*', gate: closed, warn })).toThrow(
      /selects only tools that read-only mode suppresses.*THING_READ_ONLY/s
    );
  });

  it('drops preset members it suppresses without complaining', () => {
    // Preset members are not names the operator typed.
    expect(selected(build({ allowTools: 'essential', gate: closed }))).toEqual([
      'get_thing',
      'list_things',
      'search_things',
    ]);
  });

  it('does not activate the filter on its own by default', () => {
    // With no lists set, a closed gate is the server's own business — it simply
    // does not register those tools, and there is nothing here to wrap.
    expect(build({ gate: closed }).active).toBe(false);
  });

  it('activates the filter on its own when asked to', () => {
    // For a server whose registration code registers reads and writes together,
    // and where splitting it would be a larger change than the guarantee needs.
    const filter = build({ gate: { ...closed, activatesFilter: true } });
    expect(filter.active).toBe(true);
    expect(selected(filter)).toEqual([
      'get_thing',
      'list_things',
      'search_things',
    ]);
  });

  it('suppresses everything when the catalogue declares no ungated half', () => {
    // A gate with nothing behind it is a configuration mistake, not a server
    // with no tools: it has to say so rather than start empty.
    const catalogue: Catalogue = { all: [...CATALOGUE.all] };
    expect(() =>
      build({ allowTools: 'get_thing', catalogue, gate: closed })
    ).toThrow(/read-only mode suppresses/);
  });

  it('warns on stderr when the caller passes no warn hook', () => {
    // MCP servers log to stderr because stdout belongs to the protocol; that is
    // the default this library has to get right, not an afterthought.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      build({ allowTools: 'get_*,delete_*', gate: closed });
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('contributes nothing')
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('is the same mechanism whichever way the variable reads', () => {
    // SMTP_ALLOW_SEND=false and IMAP_READ_ONLY=true are one thing seen from two
    // ends; the caller normalises to "closed" and the wording follows.
    const sendGate: Gate = {
      closed: true,
      variable: 'SMTP_ALLOW_SEND',
      noun: 'the send gate',
    };
    expect(() => build({ allowTools: 'delete_thing', gate: sendGate })).toThrow(
      /the send gate suppresses.*SMTP_ALLOW_SEND/s
    );
  });
});

describe('a filter that would leave nothing', () => {
  it('refuses rather than starting an empty server', () => {
    expect(() =>
      build({ allowTools: 'get_thing', denyTools: 'get_*' })
    ).toThrow(/leave no tools registered/);
  });
});

describe('quoting a rejected entry back', () => {
  it('shows a tool-name-shaped entry in full', () => {
    expect(describeEntry('get_thnig', CATALOGUE)).toBe('"get_thnig"');
    expect(describeEntry('list_*', CATALOGUE)).toBe('"list_*"');
  });

  it('redacts anything longer than the longest tool that exists', () => {
    // A pasted credential is the case this exists for: THING_API_KEY and
    // THING_ALLOW_TOOLS are adjacent lines in every compose file.
    const key = 'a'.repeat(32);
    const described = describeEntry(key, CATALOGUE);
    expect(described).not.toContain(key);
    expect(described).toContain('32 characters');
    expect(described).toContain('redacted');
  });

  it('redacts a lowercase hex key, which passes any charset check', () => {
    const key = '0123456789abcdef0123456789abcdef';
    expect(describeEntry(key, CATALOGUE)).not.toContain(key);
  });

  it('derives the limit from the catalogue rather than a fixed number', () => {
    // The servers that had this check first each picked a number by hand, and
    // one of them would have redacted its own longest tool name. Nothing longer
    // than the longest name can be a tool name; a pattern is shorter still.
    const long = 'get_recipe_ingredient_reference';
    const catalogue: Catalogue = { all: [long, 'get_thing'] };
    expect(describeEntry(long, catalogue)).toBe(`"${long}"`);
    expect(describeEntry(long, CATALOGUE)).toContain('redacted');
  });

  it('reaches the error messages, not just the helper', () => {
    const key = 'sk-live-0123456789abcdef0123456789abcdef';
    expect(() => build({ allowTools: key })).toThrow(/redacted/);
    expect(() => build({ allowTools: key })).not.toThrow(new RegExp(key));
  });
});

describe('installing it on a server', () => {
  /** Just enough of an McpServer to see what registerTool did. */
  function fakeServer() {
    const removed: string[] = [];
    const registered: string[] = [];
    const server = {
      registerTool(name: string) {
        registered.push(name);
        return {
          remove: () => removed.push(name),
        };
      },
    };
    return { server, removed, registered };
  }

  it('removes the tools the filter did not select', () => {
    const { server, removed, registered } = fakeServer();
    installToolFilter(server as never, build({ allowTools: 'get_thing' }));
    for (const tool of CATALOGUE.all)
      (server.registerTool as (n: string) => unknown)(tool);
    expect(registered).toEqual([...CATALOGUE.all]);
    expect(removed.sort()).toEqual(
      [...CATALOGUE.all].filter((t) => t !== 'get_thing').sort()
    );
  });

  it('registers first and removes after, rather than skipping', () => {
    // The SDK installs its tools/list handler from inside the registration
    // path, so a server whose every tool was skipped would answer tools/list
    // with "method not found" instead of an empty list.
    const { server, registered } = fakeServer();
    installToolFilter(server as never, build({ allowTools: 'get_thing' }));
    (server.registerTool as (n: string) => unknown)('delete_thing');
    expect(registered).toContain('delete_thing');
  });

  it('leaves the server untouched when the filter is inactive', () => {
    const { server } = fakeServer();
    const original = server.registerTool;
    installToolFilter(server as never, build());
    expect(server.registerTool).toBe(original);
  });
});
