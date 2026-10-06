// ship: our view of an urbit ship. logs in to eyre, scries the chorus
// agent and pokes it. knows nothing about where slips end up on disk

import type { HttpInit, HttpResponse } from 'claude-code'

export type Fetch = (url: string, init?: HttpInit) => Promise<HttpResponse>

export type Ship = {
  // base url with no trailing slash, e.g. http://localhost:8080
  url: string
  // the whole cookie pair, e.g. urbauth-~zod=0v...
  cookie: string
}

// one slip as the chorus json marks give it, at its cabinet tree path
export type Slip = {
  path: string
  // the author's @p
  ship: string
  created: string
  fqsp: string
  text: string
}

// one slip as the ship lists it, at its cabinet tree path. a ship
// hears who wrote a slip and where before it holds the text
export type Listed = {
  path: string
  // the author's @p
  ship: string
  fqsp: string
  // whether the ship holds the slip's text: its own always, another
  // author's once the ship has fetched it
  isHeld: boolean
}

// slips to fetch: one author's, at a cabinet path and under it
export type Ask = { drawer: string; ship: string }

// the ship refused the cookie, or the code
export class Unauthorized extends Error {
  constructor() {
    super('the ship refused the login')
    this.name = 'Unauthorized'
  }
}

// the ship answered with something we did not expect
export class BadResponse extends Error {
  constructor(what: string) {
    super(`the ship gave ${what}`)
    this.name = 'BadResponse'
  }
}

// the ship gave a slip in a shape we cannot read: this plugin and the
// agent disagree. dropping the slip would empty the folder
export class BadSlip extends Error {
  constructor(path: string) {
    super(`cannot read the slip at ${path}`)
    this.name = 'BadSlip'
  }
}

// the ship's name, read off the cookie: ~zod
export function nameOf(cookie: string): string {
  const match = /^urbauth-(~[a-z-]+)=/.exec(cookie)
  if (match?.[1] === undefined) throw new BadResponse('a cookie with no ship in it')

  return match[1]
}

// eyre names the ship it serves here, to anyone
const HOST = '/~/host'

// the most redirects we follow to find a ship
const HOPS = 3

// where the ship takes a login, found without the +code: a mistyped
// http url must not carry the code in the clear. follows a redirect
// we are shown; the host follows most unseen, so an http url whose
// https twin answers as a ship gives way to the twin. a ship with no
// https, such as one on localhost, keeps its url
export async function locate(fetch: Fetch, url: string): Promise<string> {
  let at = url
  for (let hop = 0; ; hop++) {
    const res = await fetch(`${at}${HOST}`)
    if (res.status < 300 || res.status >= 400) break
    if (hop === HOPS) throw new BadResponse('too many redirects')
    at = moved(at, res.headers.location)
  }
  const twin = at.replace(/^http:/i, 'https:')
  if (twin !== at && (await isShip(fetch, twin))) return twin

  return at
}

async function isShip(fetch: Fetch, url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}${HOST}`)

    return res.ok && /^~[a-z-]+$/.test(res.text.trim())
  } catch {
    return false
  }
}

// the base url a redirect sends us to. the +code goes where this
// says, so it must be the same host, and never https turned to http
function moved(from: string, location: string | undefined): string {
  const here = new URL(`${from}${HOST}`)
  const there =
    location !== undefined && URL.canParse(location, here.href) ? new URL(location, here.href) : null
  if (
    there === null ||
    there.hostname !== here.hostname ||
    !there.pathname.endsWith(HOST) ||
    (here.protocol === 'https:' && there.protocol !== 'https:')
  ) {
    throw new BadResponse(`a redirect to ${location ?? 'nowhere'}`)
  }

  return `${there.origin}${there.pathname.slice(0, -HOST.length)}`
}

// log in with the ship's +code, at the url the ship takes it, and
// return the ship once a scry shows the cookie works there. eyre
// answers a wrong code with a 400
export async function login(fetch: Fetch, url: string, code: string): Promise<Ship> {
  const at = await locate(fetch, url)
  const password = encodeURIComponent(code.trim().replace(/^~/, ''))
  const res = await fetch(`${at}/~/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `password=${password}`,
  })
  if (res.status >= 400 && res.status < 500) throw new Unauthorized()
  if (!res.ok) throw new BadResponse(`status ${res.status} for the login`)
  const cookie = /urbauth-~[a-z-]+=[^;,\s]+/.exec(res.headers['set-cookie'] ?? '')
  if (cookie === null) throw new Unauthorized()
  const ship = { url: at, cookie: cookie[0] }
  try {
    await nym(fetch, ship, nameOf(ship.cookie))
  } catch (err) {
    // only a refusal condemns the cookie: a ship that cannot answer
    // the scry may still have logged us in
    if (err instanceof Unauthorized) throw err
  }

  return ship
}

// scry the chorus agent for json. eyre answers a stale session with a
// 403, and some proxies with the login page
export async function scry(fetch: Fetch, ship: Ship, path: string): Promise<unknown> {
  const res = await fetch(`${ship.url}/~/scry/chorus${path}.json`, {
    headers: { cookie: ship.cookie },
  })
  if (res.status === 401 || res.status === 403) throw new Unauthorized()
  if (!res.ok) throw new BadResponse(`status ${res.status} for ${path}`)
  try {
    return JSON.parse(res.text) as unknown
  } catch {
    if (/<html|<!doctype/i.test(res.text)) throw new Unauthorized()
    throw new BadResponse(`no json for ${path}`)
  }
}

// every slip under one drawer of the cabinet whose text the ship holds
export async function drawer(fetch: Fetch, ship: Ship, path: string): Promise<Slip[]> {
  const root = path === '/' ? '' : path
  const out: Slip[] = []
  walk(await scry(fetch, ship, `/cabinet/drawer${root}`), root, out, slipOf)

  return out
}

// every slip the ship lists under one drawer of the cabinet, held or
// not
export async function listing(fetch: Fetch, ship: Ship, path: string): Promise<Listed[]> {
  const root = path === '/' ? '' : path
  const out: Listed[] = []
  walk(await scry(fetch, ship, `/cabinet/paths${root}`), root, out, listedOf)

  return out
}

// ask the ship to fetch slips from their authors. the ship fetches in
// its own time and keeps what it gets, so the texts show in a later
// read of the drawer. .channel names an eyre channel nobody else
// uses; it carries the pokes and closes behind them
export async function ask(
  fetch: Fetch,
  ship: Ship,
  asks: readonly Ask[],
  channel: string,
): Promise<void> {
  if (asks.length === 0) return
  const our = nameOf(ship.cookie).slice(1)
  const pokes = asks.map((one, n) => ({
    id: n + 1,
    action: 'poke',
    ship: our,
    app: 'chorus',
    mark: 'chorus-fetch',
    json: { drawer: one.drawer, ships: [one.ship] },
  }))
  const res = await fetch(`${ship.url}/~/channel/${channel}`, {
    method: 'PUT',
    headers: { cookie: ship.cookie, 'content-type': 'application/json' },
    body: JSON.stringify([...pokes, { id: pokes.length + 1, action: 'delete' }]),
  })
  if (res.status === 401 || res.status === 403) throw new Unauthorized()
  if (!res.ok) throw new BadResponse(`status ${res.status} for the fetch`)
}

// the nym the ship credits an author with: one-dot if the ship finds
// them under the %gw-btc domain, two-dot if not, null if they have none
export async function nym(fetch: Fetch, ship: Ship, who: string): Promise<string | null> {
  const value = await scry(fetch, ship, `/nym/${who}`)
  if (value === null) return null
  if (typeof value !== 'string') throw new BadResponse(`no nym for ${who}`)

  return value
}

// flatten the cabinet marks' nested json: {slip, dir: {segment: tree}}.
// .leaf reads the slip at a node
export function walk<T>(
  tree: unknown,
  path: string,
  out: T[],
  leaf: (value: unknown, path: string) => T,
): void {
  if (!isRecord(tree)) throw new BadResponse('a cabinet that is no tree')
  // a node that holds no slip gives null
  if (tree.slip !== null && tree.slip !== undefined) out.push(leaf(tree.slip, path))
  if (!isRecord(tree.dir)) return
  for (const [segment, kid] of Object.entries(tree.dir)) {
    // the ship holds a segment to these letters, and a split names a
    // ship. a path becomes a file name, so hold it to them here too
    if (!/^~?[a-z0-9-]+$/.test(segment)) throw new BadSlip(`${path}/${segment}`)
    walk(kid, `${path}/${segment}`, out, leaf)
  }
}

// a slip as the ship lists it. an agent from before a ship could list
// a slip without its text says nothing of .held, and held them all
export function listedOf(value: unknown, path: string): Listed {
  if (!isRecord(value)) throw new BadSlip(path)
  const { ship, fqsp, held } = value
  if (typeof ship !== 'string' || typeof fqsp !== 'string') throw new BadSlip(path)
  if (held !== undefined && typeof held !== 'boolean') throw new BadSlip(path)

  return { path, ship, fqsp, isHeld: held ?? true }
}

export function slipOf(value: unknown, path: string): Slip {
  if (!isRecord(value)) throw new BadSlip(path)
  const { ship, created, fqsp, text } = value
  if (
    typeof ship !== 'string' ||
    typeof created !== 'string' ||
    typeof fqsp !== 'string' ||
    typeof text !== 'string'
  ) {
    throw new BadSlip(path)
  }

  return { path, ship, created, fqsp, text }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
