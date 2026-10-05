// paths: the cabinet as the pane lists it. the ship merges every
// author's slips into one tree; where authors share a path, each other
// author's slip sits under it at a segment naming their ship. the pane
// folds those back: /notes/foo/~sampel is ~sampel's slip at /notes/foo

export type Placed = { path: string; ship: string }

// the path a slip was published to
export function logical(path: string): string {
  const cut = path.lastIndexOf('/')

  return path[cut + 1] === '~' ? path.slice(0, cut) : path
}

// every path in the cabinet, drawers and slips alike, the shortest
// first and those of one length by their letters
export function pathsOf(slips: readonly Placed[]): string[] {
  const all = new Set<string>()
  for (const slip of slips) {
    const segments = logical(slip.path).split('/').slice(1)
    for (let n = 1; n <= segments.length; n += 1) {
      all.add(`/${segments.slice(0, n).join('/')}`)
    }
  }

  return [...all].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
}

// how many slips sit at each path or under it
export function countsOf(slips: readonly Placed[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const slip of slips) {
    const segments = logical(slip.path).split('/').slice(1)
    for (let n = 1; n <= segments.length; n += 1) {
      const path = `/${segments.slice(0, n).join('/')}`
      counts.set(path, (counts.get(path) ?? 0) + 1)
    }
  }

  return counts
}

function isUnder(root: string, path: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`)
}

// who published at a path or under it, and how many slips each. the
// host comes first, then the rest by @p
export function authorsOf(
  slips: readonly Placed[],
  path: string,
  host: string,
): { ship: string; slips: number }[] {
  const counts = new Map<string, number>()
  for (const slip of slips) {
    if (!isUnder(path, logical(slip.path))) continue
    counts.set(slip.ship, (counts.get(slip.ship) ?? 0) + 1)
  }

  return [...counts]
    .map(([ship, count]) => ({ ship, slips: count }))
    .sort((a, b) => {
      if ((a.ship === host) !== (b.ship === host)) return a.ship === host ? -1 : 1

      return a.ship < b.ship ? -1 : 1
    })
}

// a query as a pattern that takes its letters in order with anything
// between them, as a fuzzy finder does: "pch" finds /projects/chorus
export function fuzzy(query: string): string {
  return Array.from(query.replace(/\s+/g, ''))
    .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
}

// the same search without ripgrep: letters in any case unless the
// query holds a capital
export function filter(paths: readonly string[], query: string): string[] {
  const pattern = new RegExp(fuzzy(query), /[A-Z]/.test(query) ? '' : 'i')

  return paths.filter(path => pattern.test(path))
}
