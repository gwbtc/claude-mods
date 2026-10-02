// sync: the core. reads the configured drawers off the ship and hands
// the slips of trusted authors to the memory adapter. one way, ship to
// folder: the ship holds the truth and the folder is a copy

import { drawerFor, holds, isTrusted } from './config'
import type { Drawer } from './config'
import { apply, plan } from './memory'
import type { Disk, Entry } from './memory'
import * as urbit from './ship'
import type { Fetch, Ship, Slip } from './ship'

export type Deps = {
  fetch: Fetch
  ship: Ship
  disk: Disk
  // the claude code memory folder of the project
  memory: string
}

// fetch every configured drawer afresh and make the memory folder
// match. returns one line per slip that changed. a fetch that fails
// throws before anything is written, so a ship that is down empties
// nothing
export async function sync(deps: Deps, drawers: readonly Drawer[]): Promise<string[]> {
  const { fetch, ship } = deps
  const our = urbit.nameOf(ship.cookie)

  // a drawer inside another comes down with it
  const roots = drawers.filter(
    drawer => !drawers.some(other => other !== drawer && holds(other.path, drawer.path)),
  )
  const slips = new Map<string, Slip>()
  for (const root of roots) {
    for (const slip of await urbit.drawer(fetch, ship, root.path)) {
      slips.set(slip.path, slip)
    }
  }

  const nyms = await nymsOf(fetch, ship, [...slips.values()].map(slip => slip.ship))
  const entries: Entry[] = []
  for (const slip of slips.values()) {
    const drawer = drawerFor(drawers, slip.path)
    const nym = nyms.get(slip.ship) ?? null
    if (drawer === null || !isTrusted(drawer, { ship: slip.ship, nym })) continue
    entries.push({ slip, nym })
  }

  const wanted = plan(entries, our, drawers.map(drawer => drawer.path))

  return apply(deps.disk, deps.memory, wanted)
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
