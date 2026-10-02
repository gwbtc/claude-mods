// nym: groundwire ids as the ship gives them, dotted words behind one
// dot (found under %gw-btc) or two (not found)

// the name of an author, as the ship credits them
export type Author = {
  // the author's @p, which the ship checked the signature against
  ship: string
  // their nym, or null when the ship gives them none
  nym: string | null
}

// how we show an author: their nym cut to its first, second,
// penultimate and last words, or their @p when they have no nym
export function show(author: Author): string {
  return author.nym === null ? author.ship : foreshorten(author.nym)
}

// .abet.baboon.caffeine.denounce.escape -> .abet.baboon..denounce.escape
export function foreshorten(nym: string): string {
  const dots = nym.slice(0, nym.length - nym.replace(/^\.+/, '').length)
  const words = nym.slice(dots.length).split('.')
  if (words.length <= 4) return nym
  const [first, second] = words
  const [penultimate, last] = words.slice(-2)

  return `${dots}${first}.${second}..${penultimate}.${last}`
}

// the name we write into a drawer for an author: the whole nym, or
// the @p for an author with none
export function nameOf(author: Author): string {
  return author.nym ?? author.ship
}

// whether a name in a drawer names an author. an @p names the ship
// that holds it. a nym names by its words: a one-dot name asks for an
// author the ship found under %gw-btc, so it turns away the same words
// at two dots; a two-dot or bare name takes either
export function names(name: string, author: Author): boolean {
  if (name.startsWith('~')) return name === author.ship
  if (author.nym === null) return false
  const words = name.replace(/^\.+/, '')
  if (words.length === 0) return false
  if (words !== author.nym.replace(/^\.+/, '')) return false

  return !isVerified(name) || isVerified(author.nym)
}

function isVerified(nym: string): boolean {
  return nym.length > 1 && nym[0] === '.' && nym[1] !== '.'
}
