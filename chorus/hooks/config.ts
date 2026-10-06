// config: <project>/.claude/chorus/config.json, and the questions the
// sync core and the cabinet pane ask of it

import { names } from './nym'
import type { Author } from './nym'

// the plugin's options, as its manifest's userConfig declares them
export type Options = Readonly<Record<string, unknown>>

export const DIR = '.claude/chorus'
export const FILE = 'config.json'

export type Drawer = {
  // a drawer in the cabinet, e.g. /projects/chorus
  path: string
  // the authors whose slips sync from it, each by groundwire id, or by
  // urbit id for an author with none. the host is here by name like
  // anyone else
  who: string[]
}

export type Config = {
  // a ship for this project alone, over the plugin's own
  ship?: string
  drawers: Drawer[]
}

// read a config file's text
export function parse(text: string): Config {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw)) throw new Error('config is not an object')
  const drawers = Array.isArray(raw.drawers) ? raw.drawers.map(parseDrawer) : []
  const ship = typeof raw.ship === 'string' ? trimUrl(raw.ship) : undefined

  return ship === undefined ? { drawers } : { ship, drawers }
}

function parseDrawer(raw: unknown): Drawer {
  if (!isRecord(raw) || typeof raw.path !== 'string') {
    throw new Error('a drawer needs a path')
  }
  const who = Array.isArray(raw.who)
    ? raw.who.filter((name): name is string => typeof name === 'string')
    : []

  return { path: trimPath(raw.path), who }
}

export function serialize(config: Config): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

// the drawer that rules a cabinet path: the deepest one holding it
export function drawerFor(drawers: readonly Drawer[], path: string): Drawer | null {
  let best: Drawer | null = null
  for (const drawer of drawers) {
    if (!holds(drawer.path, path)) continue
    if (best === null || drawer.path.length > best.path.length) best = drawer
  }

  return best
}

// whether a cabinet path is a drawer's own or lies under it
export function holds(root: string, path: string): boolean {
  if (root === '/') return true

  return path === root || path.startsWith(`${root}/`)
}

// whether an author's slips may reach project memory through a drawer
export function isTrusted(drawer: Drawer, author: Author): boolean {
  return drawer.who.some(name => names(name, author))
}

// trust authors at a path and everywhere under it: name them in the
// drawer at the path, made from the drawer that ruled it if it had
// none, and in every drawer below
export function trust(
  drawers: readonly Drawer[],
  path: string,
  authors: readonly Author[],
  nameOf: (author: Author) => string,
): Drawer[] {
  const add = (who: readonly string[]): string[] => [
    ...who,
    ...authors.filter(author => !who.some(name => names(name, author))).map(nameOf),
  ]
  const out = drawers.map(drawer =>
    holds(path, drawer.path) ? { path: drawer.path, who: add(drawer.who) } : drawer,
  )
  if (!drawers.some(drawer => drawer.path === path)) {
    out.push({ path, who: add(drawerFor(drawers, path)?.who ?? []) })
  }

  return tidy(out)
}

// stop trusting authors at a path and everywhere under it. where a
// shallower drawer names one, the path gets a drawer of its own
// without them
export function untrust(
  drawers: readonly Drawer[],
  path: string,
  authors: readonly Author[],
): Drawer[] {
  const drop = (who: readonly string[]): string[] =>
    who.filter(name => !authors.some(author => names(name, author)))
  const out = drawers.map(drawer =>
    holds(path, drawer.path) ? { path: drawer.path, who: drop(drawer.who) } : drawer,
  )
  const ruling = drawerFor(drawers, path)
  if (ruling !== null && ruling.path !== path) out.push({ path, who: drop(ruling.who) })

  return tidy(out)
}

// where an author stands at a path: trusted there, or only in drawers
// below it
export function standing(
  drawers: readonly Drawer[],
  path: string,
  author: Author,
): { isHere: boolean; below: string[] } {
  const ruling = drawerFor(drawers, path)
  const below = drawers
    .filter(drawer => drawer.path !== path && holds(path, drawer.path))
    .filter(drawer => isTrusted(drawer, author))
    .map(drawer => drawer.path)

  return { isHere: ruling !== null && isTrusted(ruling, author), below }
}

// drop every drawer that says nothing: one that names whom the drawer
// above it names, or nobody with no drawer above
export function tidy(drawers: readonly Drawer[]): Drawer[] {
  const kept: Drawer[] = []
  const byDepth = [...drawers].sort((a, b) => a.path.length - b.path.length)
  for (const drawer of byDepth) {
    const above = drawerFor(kept, drawer.path)
    const isIdle =
      above === null
        ? drawer.who.length === 0
        : above.who.length === drawer.who.length &&
          drawer.who.every(name => above.who.includes(name))
    if (!isIdle) kept.push(drawer)
  }

  return kept.sort((a, b) => (a.path < b.path ? -1 : 1))
}

export function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function trimPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')

  return trimmed === '' ? '/' : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// the ship a project talks to: its own, else the plugin's
export function shipUrl(options: Options, config: Config): string {
  return config.ship ?? trimUrl(String(options.ship ?? ''))
}

// the +code, for the ship it belongs to and no other: a project that
// names its own ship must not be sent another ship's code
export function codeFor(options: Options, url: string): string | null {
  const code = String(options.code ?? '').trim()
  if (code === '' || url !== trimUrl(String(options.ship ?? ''))) return null

  return code
}

// where the session cookies live, under claude code's own folder
export const JAR = 'chorus/cookies.json'

// a session: the cookie, and the url the ship took the login at
export type Session = { url: string; cookie: string }

// the cookie jar: one session per ship url as the options or the
// config spell it, which may not be where the ship answers
export function parseJar(text: string): Record<string, Session> {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw)) return {}
  const out: Record<string, Session> = {}
  for (const [url, held] of Object.entries(raw)) {
    // a bare cookie is a jar from before the ship's own url was kept
    if (typeof held === 'string') out[url] = { url, cookie: held }
    else if (isRecord(held) && typeof held.url === 'string' && typeof held.cookie === 'string') {
      out[url] = { url: held.url, cookie: held.cookie }
    }
  }

  return out
}

export function serializeJar(jar: Readonly<Record<string, Session>>): string {
  return `${JSON.stringify(jar, null, 2)}\n`
}
