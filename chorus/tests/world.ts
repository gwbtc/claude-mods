// world: a ship, a disk and a claude code beneath the plugin, held in
// memory for a test

import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const ROOT = '/work/project'
export const HOME = '/home/me'
export const MEMORY = `${HOME}/.claude/projects/-work-project/memory`
export const CONFIG = `${ROOT}/.claude/chorus/config.json`
export const JAR = `${HOME}/.claude/chorus/cookies.json`
export const SHIP = 'http://ship.test'
export const HOST = '~zod'
export const COOKIE = `urbauth-${HOST}=0v5.cookie`
export const CODE = 'lidlut-tabwed-pillex-ridrup'

// .isHeld false is a slip the ship lists and lacks the text of; .rev
// is the revision its fqsp names, 1 unless said
type Leaf = { ship: string; text: string; isHeld?: boolean; rev?: number }
type Tree = { slip: unknown; dir: Record<string, Tree> }

export type World = {
  files: Map<string, string>
  // the paths made read-only
  locked: Set<string>
  // every url asked of the ship
  asked: string[]
  toasts: string[]
  // every line sent to the debug log
  logs: string[]
  // every fetch asked of the ship
  asks: { drawer: string; ships: string[] }[]
  // tree paths the ship is fetching: each is held at the next listing.
  // empty .reaches and the ship fetches nothing
  fetching: Set<string>
  reaches: boolean
  // slips by tree path; change it and the ship answers anew
  slips: Record<string, Leaf>
  clock: MockClock
}

// the listing of every slip, or the texts of the held ones
function treeOf(slips: Record<string, Leaf>, isBlank: boolean): Tree {
  const root: Tree = { slip: null, dir: {} }
  for (const [path, leaf] of Object.entries(slips)) {
    if (!isBlank && leaf.isHeld === false) continue
    let node = root
    for (const segment of path.split('/').slice(1)) {
      node = node.dir[segment] ??= { slip: null, dir: {} }
    }
    const logical = path.replace(/\/~[^/]+$/, '')
    node.slip = {
      ship: leaf.ship,
      created: '~2026.10.2',
      fqsp: `/${leaf.ship}/g/x/${leaf.rev ?? 1}/chorus//1/chorus/cabinet${logical}`,
      links: [],
      text: isBlank ? '' : leaf.text,
      ...(isBlank ? { held: leaf.isHeld !== false, digest: '0v1' } : {}),
    }
  }

  return root
}

function under(tree: Tree, path: string): Tree {
  let node: Tree | undefined = tree
  for (const segment of path.split('/').filter(part => part !== '')) node = node?.dir[segment]

  return node ?? { slip: null, dir: {} }
}

export function world(
  on: On,
  init: {
    slips: Record<string, Leaf>
    nyms?: Record<string, string | null>
    files?: Record<string, string>
    hasRipgrep?: boolean
  },
): World {
  const here: World = {
    files: new Map(Object.entries(init.files ?? {})),
    locked: new Set(),
    asked: [],
    toasts: [],
    logs: [],
    asks: [],
    fetching: new Set(),
    reaches: true,
    slips: init.slips,
    clock: mock.clock(on),
  }
  const { files } = here
  const isDir = (path: string): boolean => [...files.keys()].some(file => file.startsWith(`${path}/`))

  mock.env(on, { HOME })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    here.logs.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    here.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({
    value: [{ id: 'cabinet', title: 'Chorus Cabinet', isShown: true, isFocused: true, isPlaced: true }],
  }))

  on('fs.exists', ($, e) => ({ value: files.has(e.path) || isDir(e.path) }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', ($, e) => {
    if (here.locked.has(e.path)) return { deny: 'EACCES' }
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const file of files.keys()) {
      if (!file.startsWith(`${e.path}/`)) continue
      const [name, ...rest] = file.slice(e.path.length + 1).split('/')
      if (name !== undefined) names.set(name, rest.length === 0 ? 'file' : 'dir')
    }

    return {
      value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })),
    }
  })
  on('fs.stat', ($, e) =>
    files.has(e.path) || isDir(e.path)
      ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
      : { deny: 'ENOENT' },
  )

  on('process.run', ($, e) => {
    const [command, ...args] = e.argv
    const done = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const path = args.at(-1) ?? ''
    if (command === 'rm') {
      files.delete(path)
      here.locked.delete(path)
    } else if (command === 'chmod' && args[0] === '444') {
      here.locked.add(path)
    } else if (command === 'rg') {
      if (init.hasRipgrep === false) return { deny: 'rg: command not found' }
      const pattern = new RegExp(args[args.indexOf('--regexp') + 1] ?? '', 'i')
      const hits = (e.init?.stdin ?? '').split('\n').filter(line => line !== '' && pattern.test(line))

      return done(hits.map(line => `${line}\n`).join(''), hits.length === 0 ? 1 : 0)
    }

    return done('')
  })

  on('http.fetch', ($, e) => {
    here.asked.push(e.url)
    const answer = (status: number, text: string, headers: Record<string, string> = {}) => ({
      value: { status, ok: status >= 200 && status < 300, headers, text },
    })
    if (e.url === `${SHIP}/~/host`) return answer(200, HOST)
    if (e.url === `${SHIP}/~/login`) {
      return e.init?.body === `password=${CODE}`
        ? answer(200, '0v5.cookie', { 'set-cookie': `${COOKIE}; Path=/; Max-Age=604800` })
        : answer(400, '<html>login</html>')
    }
    if (e.init?.headers?.cookie !== COOKIE) return answer(403, '')
    if (e.url.startsWith(`${SHIP}/~/channel/`)) {
      const actions = JSON.parse(e.init?.body ?? '[]') as {
        action: string
        ship?: string
        app?: string
        mark?: string
        json?: { drawer: string; ships: string[] }
      }[]
      for (const one of actions) {
        if (one.action !== 'poke') continue
        if (one.ship !== HOST.slice(1) || one.app !== 'chorus' || one.mark !== 'chorus-fetch') {
          return answer(400, '')
        }
        if (one.json === undefined) return answer(400, '')
        here.asks.push(one.json)
        for (const [path, leaf] of Object.entries(here.slips)) {
          const logical = path.replace(/\/~[^/]+$/, '')
          const isUnder = logical === one.json.drawer || logical.startsWith(`${one.json.drawer}/`)
          if (here.reaches && isUnder && one.json.ships.includes(leaf.ship)) here.fetching.add(path)
        }
      }

      return answer(204, '')
    }
    const path = e.url.slice(`${SHIP}/~/scry/chorus`.length).replace(/\.json$/, '')
    if (path.startsWith('/nym/')) {
      return answer(200, JSON.stringify(init.nyms?.[path.slice('/nym/'.length)] ?? null))
    }
    if (path.startsWith('/cabinet/paths')) {
      for (const landed of here.fetching) {
        const leaf = here.slips[landed]
        if (leaf !== undefined) here.slips[landed] = { ...leaf, isHeld: true }
      }
      here.fetching.clear()
      const tree = under(treeOf(here.slips, true), path.slice('/cabinet/paths'.length))

      return answer(200, JSON.stringify(tree))
    }
    if (path.startsWith('/cabinet/drawer')) {
      const tree = under(treeOf(here.slips, false), path.slice('/cabinet/drawer'.length))

      return answer(200, JSON.stringify(tree))
    }

    return answer(404, '')
  })

  return here
}
