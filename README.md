# claude-mods

Claude Code mods from the Groundwire Foundation. A mod is a plugin whose hooks run inside the session; see [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/).

| Mod | What it does |
|---|---|
| [`chorus`](chorus) | Browses a ship's [chorus](https://github.com/gwbtc/chorus) cabinet with `/cabinet` and syncs trusted slips into project memory |

## Install

In Claude Code:

```
/plugin marketplace add gwbtc/claude-mods
/plugin install chorus@claude-mods
/reload-plugins
```

## chorus

The mod keeps chosen drawers of a ship's cabinet in a Claude Code project's memory folder, and gives you `/cabinet` to choose them.

The ship must run the `%chorus` agent. To publish slips, Claude also needs the ship's [urbit-mcp](https://github.com/gwbtc/urbit-mcp) server; the mod itself reads the cabinet and asks the ship to fetch slips, and writes nothing to it.

### Set up

The mod has two options. Claude Code asks for them when it enables the plugin; change them later under `/plugin`, or with `claude plugin configure chorus@claude-mods`.

| Option | Value |
|---|---|
| `ship` | where the ship answers HTTP; `http://localhost:8080` by default |
| `code` | the ship's web login code, from `+code` in the Dojo |

Before it sends the code, the mod asks the URL which ship it serves. It follows a redirect on the same host, and it moves an `http://` URL to `https://` if the ship answers there; a ship with no HTTPS, such as one on localhost, keeps its URL.

The mod logs in with the code once, tries the cookie with a scry, and keeps the session in `~/.claude/chorus/cookies.json`, in a folder only you can open. It keeps no cookie the ship refuses. If the ship later refuses the cookie, the mod logs in again. If the ship refuses the code, Claude Code shows `chorus: login failed; set a fresh +code in /plugin` once, and the sync rests until you do.

After that the mod says nothing. A session proceeds as it would without it.

### /cabinet

`/cabinet` opens a pane on the ship's cabinet and takes the keyboard. `Esc` is the way out: it steps back a screen, then closes the pane. A pane that loses the keyboard asks for it back, and closes if the prompt will not give it up, so the prompt never sits under a pane it cannot reach.

The first screen lists every path over a search field, each path with the number of slips under it.

| Key | Effect |
|---|---|
| any text | filters the paths, fuzzily: `pch` finds `/projects/chorus` |
| `↑` `↓` | move the selection |
| `Enter` | opens the selected path |
| `Esc` | closes the pane |

The search runs the paths through `rg`. Without ripgrep on the `PATH` the mod matches the same pattern itself and says so.

The second screen lists the authors who published at the path or under it, each with the number of slips they wrote there. An author goes by their nym, cut to its first two and last two words: `.abet.baboon..denounce.escape`. An author the ship gives no nym goes by their `@p`.

| Key | Effect |
|---|---|
| `↑` `↓` | move the selection |
| `Enter` | trust the selected author, or stop |
| `a` | trust every author listed, or stop |
| `Esc` | back to the paths |

Trust reaches down. Given at `/foo`, it holds at every path under `/foo`. Taken at `/foo`, it goes from every path under `/foo`. An author trusted only at `/foo/bar/baz` shows ticked at `/foo` and `/foo/bar` too, with a note of where the trust sits; only their slips under `/foo/bar/baz` sync.

The host is an author like any other. Nobody is trusted until you tick them.

### What syncs

The choices live in `<project>/.claude/chorus/config.json`:

```json
{
  "drawers": [
    { "path": "/projects/chorus", "who": ["~sampel-palnet", "..abet.baboon.caffeine.denounce.escape"] }
  ]
}
```

A slip syncs if the deepest drawer holding its path names its author. Nobody syncs unnamed, the host included. A name is a nym or, for an author with none, an `@p`. A one-dot nym asks for an author the ship found under `%gw-btc`; a two-dot or bare nym takes the same words at either standing. A drawer that names nobody under one that names somebody says that nothing syncs from its path. The pane drops a drawer that says nothing: one that names whom the drawer above it names, or nobody with no drawer above. A `ship` key names a ship for this project alone; the mod sends its `+code` only to the ship in its own options.

The mod syncs when a session starts, every minute after, when `/cabinet` changes a drawer, and when Claude publishes or discards a slip. It writes each slip to `<memory>/chorus/<path>.md`, read-only, and lists them under `## Chorus (synced, read-only)` at the end of `MEMORY.md`. It denies `Edit` and `Write` on the copies. The ship holds the truth: a slip that leaves the ship, or loses its drawer, leaves the folder.

A ship lists another author's slip, with its path and author, before it holds the text. The pane lists every slip the ship knows of. When a trusted author's slip has no text on the ship yet, the mod pokes the agent with `%chorus-fetch`; the ship fetches the slip from its author and keeps it from then on. The mod looks again two seconds later, then four, eight, sixteen and thirty-two, until the text lands or the minute's sync takes over. A slip the ship cannot fetch is asked for again at each minute's sync. None of this shows in the session.

A revised slip is listed at its new revision before the ship holds the new text. The old copy stays in memory until the new one lands.

An ask names an author and a path, and the ship fetches that author's slips at the path and under it, in a deeper drawer that leaves the author unnamed too. Those texts stay on the ship and never reach memory. Trust travels down the tree, not up.

The mechanics go to the debug log (`claude --debug`), not to the transcript, so a slip's text never lands in Claude's context unasked:

| Line | Meaning |
|---|---|
| `held: <path> by <ship>, in the ship's cache` | the ship already had the text of a trusted slip |
| `fetch: asked the ship for <path> from <ship>` | the mod poked `%chorus-fetch` for it |
| `arrived: <path> from <ship>` | a slip the mod asked for now has its text |
| `kept: <path> at its old revision until the new one lands` | the ship lists a new revision it has yet to fetch |
| `sync: 73 listed, 23 trusted, 23 held, 0 awaited, 0 asked for now` | one sync's count |
| `<path> added`, `<path> removed` and the like | a copy in the memory folder changed |

A ship whose agent predates the listing gives every slip with its text, and the mod asks it for nothing.

## Develop

```console
claude plugin validate chorus     # the manifest and what the hooks module calls
claude plugin test chorus         # the tests under chorus/tests
claude --plugin-dir chorus        # load it from disk; a save reloads it
```

The engine lays its type declarations into `chorus/.claude-plugin/types/` when it loads the mod from disk; after that, `tsc -p chorus` type-checks it.

The engine follows `$` no further than the hooks module, so `hooks/register.tsx` holds everything that touches the engine. The files beside it know nothing of it, each one layer: `ship.ts` (Eyre, the agent's JSON and the fetch poke), `config.ts` (drawers and trust), `nym.ts`, `memory.ts` (the memory folder's layout), `sync.ts` (the core), `paths.ts` and `view.ts` (the pane's arithmetic).
