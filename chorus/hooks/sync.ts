// sync: the core. reads the configured drawers off the ship and hands
// the slips of trusted authors to the memory adapter. one way, ship to
// folder: the ship holds the truth and the folder is a copy
//
// a ship lists another author's slip before it holds the text. the
// sync asks the ship to fetch the trusted ones it lacks, and copies
// each down once the ship has it

import { drawerFor, holds, isTrusted } from './config'
import type { Drawer } from './config'
import { FOLDER, apply, plan } from './memory'
import type { Disk, Entry, Kept } from './memory'
import { logical } from './paths'
import * as urbit from './ship'
import type { Ask, Fetch, Listed, Ship, Slip } from './ship'

// how long the ship has to fetch a slip before we ask again
export const ASK_AGAIN_MS = 55_000

export type Deps = {
  fetch: Fetch
  ship: Ship
  disk: Disk
  // the claude code memory folder of the project
  memory: string
  // the time, in milliseconds
  now: number
  // a name for an eyre channel nobody else uses
  channel: () => string
}

// where each trusted slip stood when we last looked, by fqsp: the
// ship held it, or we asked the ship to fetch it at .at
export type Seen = Map<string, { state: 'held' } | { state: 'asked'; at: number }>

export type Report = {
  // one line per slip whose copy changed
  changes: string[]
  // what the sync did on the way, for the debug log
  notes: string[]
  // the trusted slips the ship does not hold yet
  lacking: number
  // the slips the ship was asked to fetch this time
  asked: number
}

// read every configured drawer afresh, ask the ship for the trusted
// slips it lacks, and make the memory folder match the ones it holds.
// a read that fails throws before anything is written, so a ship that
// is down empties nothing
export async function sync(deps: Deps, drawers: readonly Drawer[], seen: Seen): Promise<Report> {
  const { fetch, ship } = deps
  const our = urbit.nameOf(ship.cookie)

  // a drawer inside another comes down with it
  const roots = drawers.filter(
    drawer => !drawers.some(other => other !== drawer && holds(other.path, drawer.path)),
  )
  const listed = new Map<string, Listed>()
  for (const root of roots) {
    for (const one of await urbit.listing(fetch, ship, root.path)) listed.set(one.path, one)
  }
  const nyms = await nymsOf(fetch, ship, [...listed.values()].map(one => one.ship))
  const trusted = [...listed.values()].filter(one => {
    const drawer = drawerFor(drawers, one.path)

    return drawer !== null && isTrusted(drawer, { ship: one.ship, nym: nyms.get(one.ship) ?? null })
  })

  const notes: string[] = []
  const asks: Ask[] = []
  const askedNow = new Set<string>()
  for (const one of trusted) {
    const was = seen.get(one.fqsp)
    if (one.isHeld) {
      if (was?.state === 'asked') notes.push(`arrived: ${one.path} from ${one.ship}`)
      else if (was === undefined) notes.push(`held: ${one.path} by ${one.ship}, in the ship's cache`)
      seen.set(one.fqsp, { state: 'held' })
    } else if (was?.state !== 'asked' || deps.now - was.at >= ASK_AGAIN_MS) {
      notes.push(`fetch: asked the ship for ${one.path} from ${one.ship}`)
      // a split sits under the path its author published to
      asks.push({ drawer: logical(one.path), ship: one.ship })
      askedNow.add(one.fqsp)
      seen.set(one.fqsp, { state: 'asked', at: deps.now })
    }
  }
  const wanted = new Set(trusted.map(one => one.fqsp))
  for (const fqsp of [...seen.keys()]) if (!wanted.has(fqsp)) seen.delete(fqsp)
  await urbit.ask(fetch, ship, asks, deps.channel())

  const slips = new Map<string, Slip>()
  for (const root of roots) {
    for (const slip of await urbit.drawer(fetch, ship, root.path)) slips.set(slip.path, slip)
  }
  const entries: Entry[] = []
  const kept: Kept[] = []
  for (const one of trusted) {
    const slip = slips.get(one.path)
    const nym = nyms.get(one.ship) ?? null
    // the revision listed, not one the ship held before it
    if (slip !== undefined && slip.fqsp === one.fqsp) {
      entries.push({ slip, nym })
      continue
    }
    // a copy of an older revision stays until the new one lands
    const text = await deps.disk.read(`${deps.memory}/${FOLDER}${one.path}.md`)
    if (text === null) continue
    kept.push({ path: one.path, ship: one.ship, nym, text })
    if (askedNow.has(one.fqsp)) {
      notes.push(`kept: ${one.path} at its old revision until the new one lands`)
    }
  }
  const lacking = trusted.length - entries.length
  notes.push(
    `sync: ${listed.size} listed, ${trusted.length} trusted, ${entries.length} held, ` +
      `${lacking} awaited, ${asks.length} asked for now`,
  )

  const made = plan(entries, our, drawers.map(drawer => drawer.path), kept)

  return { changes: await apply(deps.disk, deps.memory, made), notes, lacking, asked: asks.length }
}

// take every copy out of the memory folder, for a project that syncs
// nothing
export async function clear(disk: Disk, memory: string): Promise<string[]> {
  return apply(disk, memory, plan([], '', []))
}

// the nym of each ship, as the ship we talk to gives it now
export async function nymsOf(
  fetch: Fetch,
  ship: Ship,
  ships: readonly string[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ships)]
  const nyms = await Promise.all(unique.map(who => urbit.nym(fetch, ship, who)))

  return new Map(unique.map((who, i) => [who, nyms[i] ?? null]))
}
