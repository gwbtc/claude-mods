// chorus: the claude code adapter for a ship's chorus agent. keeps
// chosen drawers of the ship's cabinet in the project's memory folder,
// and draws the /cabinet pane that chooses them. the sync says nothing:
// a slip's text never lands in claude's context unasked
//
// the engine follows `$` no further than this file, so everything that
// touches it lives here: the host glue first, then the sync, then the
// pane. the files beside this one know nothing of the engine

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { CabinetData, CabinetDrawer, CabinetView } from '../types'
import {
  DIR,
  FILE,
  JAR,
  codeFor,
  holds,
  parse,
  parseJar,
  serialize,
  serializeJar,
  shipUrl,
  standing,
  trust,
  untrust,
} from './config'
import type { Config } from './config'
import { FOLDER } from './memory'
import type { Disk } from './memory'
import { nameOf as nameFor, show } from './nym'
import { countsOf, filter, fuzzy, pathsOf } from './paths'
import { Unauthorized, login, nameOf as shipOf, paths as cabinetPaths } from './ship'
import type { Fetch, Ship } from './ship'
import { clear, nymsOf, sync } from './sync'
import { ROWS, authorsAt, cut, fold, scrolled } from './view'

// how often we ask the ship for the drawers again
const POLL_MS = 60_000
// how long a change waits for the next before the sync runs
const SETTLE_MS = 500

const DENY =
  'This memory is a read-only copy of a chorus slip. ' +
  'Publish a new revision with the `chorus/publish-slip` tool.'

const PANE = 'cabinet'
// the rows the pane asks for around its list
const CHROME = 5
// how long the pane may sit without the keys before we ask for them
// again, and how often we ask before closing it
const HOLD_MS = 150
const HOLD_TRIES = 3
// the color the engine draws a key's name in
const KEY = 'suggestion'
const OPEN = {
  id: PANE,
  title: 'Chorus Cabinet',
  focus: true,
  closeOnEscape: true,
  holdToasts: true,
  rows: ROWS + CHROME,
} as const

const NO_DATA: CabinetData = {
  status: 'loading',
  error: '',
  host: '',
  slips: [],
  nyms: {},
  drawers: [],
}
const NO_VIEW: CabinetView = {
  screen: 'paths',
  query: '',
  seed: '',
  shown: [],
  sel: 0,
  top: 0,
  path: '/',
  asel: 0,
  hasRipgrep: true,
}

const data = atom({ plugin: 'chorus', key: 'data' } as const, NO_DATA)
const view = atom({ plugin: 'chorus', key: 'view' } as const, NO_VIEW)

let isSyncing = false
// a change came while a sync ran: run once more after it
let isStale = false
// the ship refused our login. said once, and the sync rests until
// /cabinet gets through or the plugin's options change
let isRefused = false
let pending: { cancel: () => void } | undefined
// counts the searches, so a slow one cannot overwrite a later one
let searches = 0
// /cabinet is still asking the ship: the prompt holds the keys until
// the command is done
let isLoading = false
// a check that the pane holds the keys is under way
let isHolding = false

//  the host
//

function fetchOf($: EngineInterface): Fetch {
  return (url, init) => $.http.fetch(url, init)
}

async function configPath($: EngineInterface): Promise<string> {
  return `${await $.session.root()}/${DIR}/${FILE}`
}

// where claude code keeps its own files
async function claudeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
}

// the session cookies we hold, by ship url. a cookie logs in to the
// ship, so the jar sits in a folder only the user can open; the
// plugin's own store is a file anyone on the machine can read
async function jarPath($: EngineInterface): Promise<string> {
  return `${await claudeDir($)}/${JAR}`
}

async function cookies($: EngineInterface): Promise<Record<string, string>> {
  const path = await jarPath($)
  if (!(await $.fs.exists(path))) return {}

  return parseJar(await $.fs.read(path))
}

// keep a ship's cookie, or forget it
async function keep($: EngineInterface, url: string, cookie: string | null): Promise<void> {
  const path = await jarPath($)
  const dir = path.slice(0, path.lastIndexOf('/'))
  const { [url]: old, ...rest } = await cookies($)
  if (cookie === old || (cookie === null && old === undefined)) return
  await $.process.run(['mkdir', '-p', dir])
  await $.process.run(['chmod', '700', dir])
  await $.fs.write(path, serializeJar(cookie === null ? rest : { ...rest, [url]: cookie }))
}

// the project's config, or one with no drawers for a project that has
// none
async function readConfig($: EngineInterface): Promise<Config> {
  const path = await configPath($)

  return (await $.fs.exists(path)) ? parse(await $.fs.read(path)) : { drawers: [] }
}

async function writeConfig($: EngineInterface, config: Config): Promise<void> {
  await $.fs.write(await configPath($), serialize(config))
}

// mint a fresh cookie from the +code and keep it
async function relogin($: EngineInterface, options: PluginOptions, config: Config): Promise<Ship> {
  const url = shipUrl(options, config)
  const code = codeFor(options, url)
  await keep($, url, null)
  if (code === null) throw new Unauthorized()
  const cookie = await login(fetchOf($), url, code)
  await keep($, url, cookie)

  return { url, cookie }
}

// the ship with the cookie we hold for it; null when the plugin has
// no ship, or no cookie and no code to mint one
async function connect(
  $: EngineInterface,
  options: PluginOptions,
  config: Config,
): Promise<Ship | null> {
  const url = shipUrl(options, config)
  if (url === '') return null
  const cookie = (await cookies($))[url]
  if (cookie !== undefined) return { url, cookie }
  if (codeFor(options, url) === null) return null

  return relogin($, options, config)
}

// run .work against the ship, logging in again once if the ship
// refuses the cookie. null when the plugin is not set up
async function withShip<T>(
  $: EngineInterface,
  options: PluginOptions,
  config: Config,
  work: (ship: Ship) => Promise<T>,
): Promise<T | null> {
  const ship = await connect($, options, config)
  if (ship === null) return null
  try {
    return await work(ship)
  } catch (err) {
    if (!(err instanceof Unauthorized)) throw err

    return work(await relogin($, options, config))
  }
}

// where claude code keeps this project's memory: autoMemoryDirectory
// if a setting names one, else the folder claude code derives from
// the project path
async function memoryDir($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const settings: Record<string, unknown> = await $.settings.read()
  const named = settings.autoMemoryDirectory
  if (typeof named === 'string' && named !== '') {
    return named.startsWith('~/') ? `${home}/${named.slice(2)}` : named
  }
  const mangled = (await $.session.root()).replace(/[^A-Za-z0-9]/g, '-')

  return `${await claudeDir($)}/projects/${mangled}/memory`
}

// where a path lands with every link followed: its own place if it is
// there, else its folder's and its name
async function landing($: EngineInterface, path: string): Promise<string | null> {
  const own = await $.fs.stat(path, { resolve: true }).catch(() => null)
  if (own?.realPath !== undefined) return own.realPath
  const at = path.lastIndexOf('/')
  const dir = await $.fs.stat(path.slice(0, at) || '/', { resolve: true }).catch(() => null)
  if (dir?.realPath === undefined) return null

  return `${dir.realPath.replace(/\/$/, '')}/${path.slice(at + 1)}`
}

// whether a file a tool is about to write is one of our copies
async function isSynced($: EngineInterface, file: string): Promise<boolean> {
  const root = `${await memoryDir($)}/${FOLDER}`
  const path = fold(file.startsWith('/') ? file : `${await $.session.cwd()}/${file}`)
  if (holds(root, path)) return true
  // a link into the folder, or a folder reached through one
  const [real, realRoot] = await Promise.all([landing($, path), landing($, root)])

  return real !== null && realRoot !== null && holds(realRoot, real)
}

function diskOf($: EngineInterface): Disk {
  return {
    read: async path => ((await $.fs.exists(path)) ? $.fs.read(path) : null),
    write: async (path, text, isLocked) => {
      // a copy is read-only on disk, so it goes before its successor
      // comes
      if (isLocked && (await $.fs.exists(path))) await $.process.run(['rm', '-f', path])
      await $.fs.write(path, text)
      if (isLocked) await $.process.run(['chmod', '444', path])
    },
    remove: async path => {
      await $.process.run(['rm', '-f', path])
    },
    removeDir: async path => {
      await $.process.run(['rmdir', path])
    },
    list: async path => {
      if (!(await $.fs.exists(path))) return null
      const entries = await $.fs.list(path)

      return entries.map(entry => ({ name: entry.name, isDir: entry.kind === 'dir' }))
    },
  }
}

//  the sync
//

// bring the memory folder in line with the ship, one sync at a time
async function run($: EngineInterface, options: PluginOptions): Promise<void> {
  if (isRefused) return
  if (isSyncing) {
    isStale = true

    return
  }
  isSyncing = true
  try {
    const config = await readConfig($)
    const memory = await memoryDir($)
    // a project with no drawers asks the ship nothing
    const changes =
      config.drawers.length === 0
        ? await clear(diskOf($), memory)
        : await withShip($, options, config, ship =>
            sync({ fetch: fetchOf($), ship, disk: diskOf($), memory }, config.drawers),
          )
    for (const line of changes ?? []) $.ui.log(line, { to: 'debug' })
  } catch (err) {
    // a failed login is the one thing the person must act on, so it
    // is the one thing they see. everything else goes to the debug log
    if (err instanceof Unauthorized) {
      isRefused = true
      $.ui.toast('chorus: login failed; set a fresh +code in /plugin')
    }
    $.ui.log(`sync failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  } finally {
    isSyncing = false
  }
  if (isStale) {
    isStale = false
    await run($, options)
  }
}

// sync once the changes stop coming
function soon($: EngineInterface, options: PluginOptions): void {
  pending?.cancel()
  pending = $.clock.after(SETTLE_MS, () => run($, options))
}

//  the pane
//

// the element that holds the keys: the search field over the paths,
// and over the authors a button with nothing drawn on it. the engine
// paints the ring's holder in reverse, which is hard to read on a row,
// so no row ever holds it: the rows show the selection themselves
function ringKey(now: CabinetView): string {
  return now.screen === 'authors' ? 'pick' : 'search'
}

// put the engine's focus ring where the view says it is. the ring is
// a courtesy: a pane that cannot take it still draws
async function ring($: EngineInterface): Promise<void> {
  await $.ui.focus({ requestId: PANE, key: ringKey(await read($, view)) }).catch(() => undefined)
}

// ask for the keys
async function retake($: EngineInterface): Promise<void> {
  await $.ui.open(OPEN)
  await ring($)
}

// the pane is up only while it holds the keys, so escape is the one
// way out and the prompt never sits under a pane it cannot reach. ask
// for the keys a few times, then close
async function hold($: EngineInterface, tries: number): Promise<void> {
  const mine = (await $.ui.panes()).find(pane => pane.id === PANE)
  if (mine === undefined || mine.isFocused) {
    isHolding = false

    return
  }
  if (isLoading) {
    $.clock.after(HOLD_MS, () => hold($, tries))

    return
  }
  if (tries === 0) {
    isHolding = false
    await $.ui.close({ id: PANE })

    return
  }
  await retake($)
  $.clock.after(HOLD_MS, () => hold($, tries - 1))
}

// the paths a query leaves. ripgrep does the matching; without it the
// same pattern runs here
async function search($: EngineInterface, all: string[], query: string): Promise<string[]> {
  if (query.trim() === '') return all
  if ((await read($, view)).hasRipgrep) {
    try {
      const ran = await $.process.run(
        [
          'rg',
          '--no-config',
          '--color=never',
          '--no-line-number',
          '--smart-case',
          '--regexp',
          fuzzy(query),
          '--',
          '-',
        ],
        { stdin: `${all.join('\n')}\n`, timeoutMs: 5000 },
      )
      if (ran.exitCode <= 1) {
        const hits = new Set(ran.stdout.split('\n'))

        return all.filter(path => hits.has(path))
      }
    } catch {
      // no ripgrep on this machine
    }
    await update($, view, old => ({ ...old, hasRipgrep: false }))
  }

  return filter(all, query)
}

// list the paths the query leaves, the first one selected
async function refilter($: EngineInterface): Promise<void> {
  searches += 1
  const mine = searches
  const all = pathsOf((await read($, data)).slips)
  const shown = await search($, all, (await read($, view)).query)
  if (mine !== searches) return
  await update($, view, old => ({ ...old, shown, sel: 0, top: 0 }))
}

// ask the ship for the cabinet's paths and its authors' nyms
async function load($: EngineInterface, options: PluginOptions): Promise<void> {
  let drawers: CabinetDrawer[] = []
  try {
    const config = await readConfig($)
    drawers = config.drawers
    const got = await withShip($, options, config, async ship => {
      const fetch = fetchOf($)
      const host = shipOf(ship.cookie)
      const slips = await cabinetPaths(fetch, ship)
      const nyms = await nymsOf(fetch, ship, [host, ...slips.map(slip => slip.ship)])

      return {
        host,
        slips: slips.map(slip => ({ path: slip.path, ship: slip.ship })),
        nyms: Object.fromEntries(nyms),
      }
    })
    if (got !== null) isRefused = false
    await update($, data, () =>
      got === null
        ? { ...NO_DATA, status: 'unset', drawers }
        : { status: 'ready', error: '', drawers, ...got },
    )
  } catch (err) {
    const status = err instanceof Unauthorized ? 'refused' : 'failed'
    const error = err instanceof Error ? err.message : String(err)
    await update($, data, () => ({ ...NO_DATA, status, error, drawers }))
  }
  await refilter($)
}

// write the drawers to the project's config and sync to match
async function save(
  $: EngineInterface,
  options: PluginOptions,
  drawers: CabinetDrawer[],
): Promise<void> {
  await writeConfig($, { ...(await readConfig($)), drawers })
  await update($, data, old => ({ ...old, drawers }))
  soon($, options)
}

// show who published under a path
async function enter($: EngineInterface, path: string): Promise<void> {
  await update($, view, (old): CabinetView => ({ ...old, screen: 'authors', path, asel: 0 }))
  await ring($)
}

// open a row of the list, or the selected one
async function choose($: EngineInterface, row?: number): Promise<void> {
  const now = await read($, view)
  const path = now.shown[row ?? now.sel]
  if (path === undefined) return
  if (row !== undefined) await update($, view, old => scrolled(old, row))
  await enter($, path)
}

// trust or stop trusting one author under the path, or all of them.
// trust reaches down: given at a path it holds everywhere under it,
// and taken at a path it goes from every drawer under it
async function toggle(
  $: EngineInterface,
  options: PluginOptions,
  row: number | 'all' | 'selected',
): Promise<void> {
  const now = await read($, view)
  const held = await read($, data)
  const authors = authorsAt(held, now.path)
  const at = row === 'selected' ? now.asel : row
  const picked = at === 'all' ? authors : authors.slice(at, at + 1)
  if (typeof at === 'number') await update($, view, old => ({ ...old, asel: at }))
  if (picked.length === 0) return
  const stands = picked.map(author => standing(held.drawers, now.path, author))
  const isTaking =
    at === 'all'
      ? stands.every(stand => stand.isHere)
      : stands.some(stand => stand.isHere || stand.below.length > 0)
  const drawers = isTaking
    ? untrust(held.drawers, now.path, picked)
    : trust(held.drawers, now.path, picked, nameFor)
  await save($, options, drawers)
}

async function typed($: EngineInterface, query: string): Promise<void> {
  await update($, view, old => ({ ...old, query }))
  await refilter($)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cabinet',
      description: "Browse the ship's chorus cabinet and choose what syncs into memory",
    })
    // make the folder and the index current before the first prompt
    await run($, options)
    $.clock.every(POLL_MS, () => run($, options))

    return next(e)
  })

  // a slip the model just published or discarded should not wait for
  // the next poll
  on('tool.call', { tool: /chorus_(publish|discard)-slip$/ }, async ($, e, next) => {
    const ran = await next(e)
    soon($, options)

    return ran
  })

  // the copies are the ship's; a new revision goes through the ship
  on('tool.call', { tool: 'Edit' }, async ($, e, next) =>
    (await isSynced($, e.file_path)) ? { deny: DENY } : next(e),
  )
  on('tool.call', { tool: 'Write' }, async ($, e, next) =>
    (await isSynced($, e.file_path)) ? { deny: DENY } : next(e),
  )

  on('command.run', { command: 'cabinet' }, async $ => {
    isLoading = true
    try {
      await update($, view, old => ({ ...NO_VIEW, hasRipgrep: old.hasRipgrep }))
      await update($, data, (old): CabinetData => ({ ...old, status: 'loading' }))
      await $.ui.open(OPEN)
      await load($, options)
    } finally {
      isLoading = false
    }

    return {}
  })

  // escape steps back before it closes: from the authors to the paths
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    const now = await read($, view)
    const isReady = (await read($, data)).status === 'ready'
    if (!isReady || now.screen === 'paths') return next(e)
    await update($, view, (old): CabinetView => ({ ...old, screen: 'paths', seed: old.query }))
    // escape handed the keys back to the prompt: take them again
    $.clock.after(0, () => retake($))

    return { deny: 'escape steps back first' }
  })

  // the arrows and tab walk the ring through everything drawn, in the
  // tree's order. the ring's holder stands first and keeps the keys,
  // and where the ring aims says which way the person went: down at
  // the first row, up at the engine's own stop before the holder
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    const now = await read($, view)
    const held = await read($, data)
    const key = e.element
    if (key === ringKey(now)) return next(e)
    const by = key !== undefined && /^(row|author):/.test(key) ? 1 : -1
    const last = Math.max(0, authorsAt(held, now.path).length - 1)
    await update($, view, old =>
      old.screen === 'paths'
        ? scrolled(old, old.sel + by)
        : { ...old, asel: Math.min(Math.max(old.asel + by, 0), last) },
    )

    return { deny: 'the selection moved; the ring stays' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : null
    const held = await read($, data)
    const now = await read($, view)
    const width = Math.max(24, e.props.bodyColumns)
    const room = width - 2
    // one key of the line under the list: its name, then what it does
    const key = (name: string, does: string) => (
      <Box>
        <Text color={KEY}>{name}</Text>
        <Text dimColor>: {does}</Text>
      </Box>
    )

    if (e.surface === 'terminal' && !e.props.isFocused && !isHolding) {
      isHolding = true
      $.clock.after(HOLD_MS, () => hold($, HOLD_TRIES))
    }

    if (held.status !== 'ready') {
      const words = {
        loading: 'Asking the ship for its cabinet…',
        unset:
          'No ship to ask. Set the ship URL and its +code in /plugin, under chorus, then run /cabinet again.',
        refused:
          'The ship refused the login. Set a fresh +code in /plugin, under chorus, then run /cabinet again.',
        failed: `Could not read the cabinet: ${held.error}`,
      }[held.status]

      return (
        <Box flexDirection="column" width={width} paddingX={1}>
          <Text wrap="wrap">{words}</Text>
          {held.status !== 'loading' && key('esc', 'close')}
        </Box>
      )
    }

    if (now.screen === 'authors') {
      const authors = authorsAt(held, now.path)

      // the ring's holder stands first in the tree, ahead of the rows
      return (
        <Box flexDirection="column" width={width}>
          <Box flexDirection="column" paddingX={1}>
            <Box>
              <Text bold>{cut(now.path, room - 3)}</Text>
              <Button plain autoFocus key="pick" label="" onPress={() => toggle($, options, 'selected')} />
            </Box>
            {authors.map((author, n) => {
              const stand = standing(held.drawers, now.path, author)
              const isTicked = stand.isHere || stand.below.length > 0
              const where = stand.isHere
                ? ''
                : stand.below.length === 1
                  ? `  under ${stand.below[0]}`
                  : stand.below.length > 1
                    ? `  under ${stand.below.length} paths below`
                    : ''
              const mark = n === now.asel ? '>' : ' '
              const name = cut(`${mark} ${isTicked ? '[x]' : '[ ]'} ${show(author)}`, room)
              const side = `${author.slips}${where}`

              return (
                <Box columnGap={1}>
                  <Button
                    plain
                    key={`author:${n}`}
                    dimColor={n !== now.asel}
                    label={name}
                    onPress={() => toggle($, options, n)}
                  />
                  <Text dimColor>{cut(side, Math.max(0, room - Array.from(name).length - 1))}</Text>
                </Box>
              )
            })}
          </Box>
          <Box paddingX={1} columnGap={2} flexWrap="wrap">
            {key('↑↓', 'move')}
            {key('enter', 'trust')}
            <Button plain dimColor key="key:a" hotkey="a" label="all" onPress={() => toggle($, options, 'all')} />
            {key('esc', 'back')}
          </Box>
        </Box>
      )
    }

    const all = pathsOf(held.slips)
    const counts = countsOf(held.slips)
    const rows = now.shown.slice(now.top, now.top + ROWS)

    // the search field is drawn under the list and stands first in the
    // tree: the engine counts the ring's place from the top, and a
    // field behind a list that shrinks as the person types loses it
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="column-reverse" paddingX={1}>
          <Box justifyContent="space-between">
            <Box>
              <Text>{'> '}</Text>
              {Input !== null && (
                <Input
                  autoFocus
                  key="search"
                  value={now.seed}
                  placeholder="search paths"
                  submitLabel="open"
                  onInput={value => typed($, value)}
                  onSubmit={() => choose($)}
                />
              )}
            </Box>
            <Text dimColor>
              {now.shown.length} / {all.length}
            </Text>
          </Box>
          <Text dimColor>{'─'.repeat(room)}</Text>
          <Box flexDirection="column">
            {rows.map((path, n) => {
              const i = now.top + n

              return (
                <Box columnGap={1}>
                  <Button
                    plain
                    key={`row:${i}`}
                    dimColor={i !== now.sel}
                    label={cut(`${i === now.sel ? '>' : ' '} ${path}`, room - 6)}
                    onPress={() => choose($, i)}
                  />
                  <Text dimColor>{String(counts.get(path) ?? 0)}</Text>
                </Box>
              )
            })}
            {rows.length === 0 && (
              <Text dimColor>{all.length === 0 ? 'The cabinet is empty.' : 'No path matches.'}</Text>
            )}
            {Array.from({ length: ROWS - Math.max(1, rows.length) }, () => (
              <Text> </Text>
            ))}
          </Box>
          <Box justifyContent="space-between" paddingRight={3}>
            <Text bold>Chorus Cabinet</Text>
            <Text dimColor>{cut(show({ ship: held.host, nym: held.nyms[held.host] ?? null }), Math.max(0, room - 19))}</Text>
          </Box>
        </Box>
        <Box paddingX={1} columnGap={2} flexWrap="wrap">
          {key('↑↓', 'move')}
          {key('enter', 'open')}
          {key('esc', 'close')}
        </Box>
        {!now.hasRipgrep && (
          <Text dimColor> ripgrep (rg) is not on the PATH; searching without it.</Text>
        )}
      </Box>
    )
  })
}
