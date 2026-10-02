// view: the arithmetic of the cabinet pane, apart from its drawing

import { authorsOf } from './paths'
import type { Placed } from './paths'
import type { Author } from './nym'

// the rows of the list the pane draws at once
export const ROWS = 10

export type Listed = Author & { slips: number }

// the authors under a path, each with the nym the ship gave
export function authorsAt(
  held: { slips: readonly Placed[]; host: string; nyms: Readonly<Record<string, string | null>> },
  path: string,
): Listed[] {
  return authorsOf(held.slips, path, held.host).map(author => ({
    ...author,
    nym: held.nyms[author.ship] ?? null,
  }))
}

// move the selection to a row, and the window with it
export function scrolled<V extends { shown: readonly string[]; sel: number; top: number }>(
  old: V,
  to: number,
): V {
  const sel = Math.min(Math.max(to, 0), Math.max(0, old.shown.length - 1))
  const top = sel < old.top ? sel : sel >= old.top + ROWS ? sel - ROWS + 1 : old.top

  return { ...old, sel, top }
}

// a line cut to the room it has
export function cut(text: string, room: number): string {
  const chars = Array.from(text)

  return chars.length <= room ? text : `${chars.slice(0, Math.max(0, room - 1)).join('')}…`
}

// fold the . and .. out of an absolute path
export function fold(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }

  return `/${out.join('/')}`
}
