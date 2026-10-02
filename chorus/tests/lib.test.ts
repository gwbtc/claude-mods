// the layers beneath the hooks: trust, nyms, the memory adapter, the
// ship's json and the pane's paths

import { describe, expect, test } from 'claude-code/testing'

import { adopt, drawerFor, isTrusted, parse, standing, tidy, trust, untrust } from '../hooks/config'
import { describe as summarize, mergeIndex, plan, render, rewriteLinks, HEADING, NOTE } from '../hooks/memory'
import type { Entry } from '../hooks/memory'
import { foreshorten, nameOf, names, show } from '../hooks/nym'
import { authorsOf, countsOf, filter, logical, pathsOf } from '../hooks/paths'
import { BadSlip, walk } from '../hooks/ship'
import type { Slip } from '../hooks/ship'

function entry(path: string, ship: string, text: string): Entry {
  return { nym: '..abet.baboon', slip: { path, ship, created: '~2026.9.17', fqsp: '', text } }
}

describe('config', () => {
  test('the deepest drawer holding a path rules it', () => {
    const drawers = [
      { path: '/projects', who: ['~zod'] },
      { path: '/projects/chorus', who: [] },
    ]
    expect(drawerFor(drawers, '/projects/chorus/wick-signing')?.path).toBe('/projects/chorus')
    expect(drawerFor(drawers, '/projects/chorus')?.path).toBe('/projects/chorus')
    expect(drawerFor(drawers, '/projects/chorus-two/foo')?.path).toBe('/projects')
    expect(drawerFor(drawers, '/notes/foo')).toBe(null)
  })

  test('nobody syncs unnamed, the host included', () => {
    const host = { ship: '~zod', nym: null }
    const closed = { path: '/a', who: [] }
    const open = { path: '/a', who: ['~zod', '..abet.baboon', '.cabin.dawn', 'early.fable'] }
    expect(isTrusted(closed, host)).toBe(false)
    expect(isTrusted(open, host)).toBe(true)
    expect(isTrusted(open, { ship: '~bus', nym: '..abet.baboon' })).toBe(true)
    expect(isTrusted(open, { ship: '~bus', nym: '..abet.bacon' })).toBe(false)
    // a two-dot or bare name takes the author at either standing
    expect(isTrusted(open, { ship: '~bus', nym: '.abet.baboon' })).toBe(true)
    expect(isTrusted(open, { ship: '~bus', nym: '..early.fable' })).toBe(true)
    // a one-dot name turns away the same words unverified
    expect(isTrusted(open, { ship: '~bus', nym: '.cabin.dawn' })).toBe(true)
    expect(isTrusted(open, { ship: '~bus', nym: '..cabin.dawn' })).toBe(false)
    // an @p names its ship and nobody else
    expect(isTrusted(open, { ship: '~bus', nym: null })).toBe(false)
  })

  test("the daemon's config gives up its cookie and names the host", () => {
    const old = JSON.stringify({
      ship: 'http://localhost:8080/',
      cookie: 'urbauth-~zod=0v1',
      memory: '/somewhere',
      drawers: [
        { path: '/projects/chorus', who: null },
        { path: '/notes/', who: ['..abet.baboon'] },
      ],
    })
    const { config, legacy } = parse(old)
    expect(legacy).toEqual({ ship: 'http://localhost:8080', cookie: 'urbauth-~zod=0v1' })
    expect(adopt(config, '~zod')).toEqual({
      ship: 'http://localhost:8080',
      drawers: [
        { path: '/projects/chorus', who: ['~zod'] },
        { path: '/notes', who: ['~zod', '..abet.baboon'] },
      ],
    })
    expect(parse('{"drawers":[{"path":"/a","who":[]}]}').legacy).toBe(null)
  })

  const zod = { ship: '~zod', nym: null }
  const bus = { ship: '~bus', nym: '..abet.baboon' }

  test('trust given at a path shows above it and holds below it', () => {
    const deep = trust([], '/foo/bar/baz', [zod, bus], nameOf)
    expect(deep).toEqual([{ path: '/foo/bar/baz', who: ['~zod', '..abet.baboon'] }])
    expect(standing(deep, '/foo', bus)).toEqual({ isHere: false, below: ['/foo/bar/baz'] })
    expect(standing(deep, '/foo/bar/baz/bat', bus)).toEqual({ isHere: true, below: [] })
    // given higher up, it reaches every drawer below; one that then
    // says what the drawer above it says goes
    const wide = trust([{ path: '/foo', who: ['~zod'] }, ...deep], '/foo', [bus], nameOf)
    expect(wide).toEqual([{ path: '/foo', who: ['~zod', '..abet.baboon'] }])
  })

  test('trust taken at a path goes from everything below it', () => {
    const drawers = [
      { path: '/foo', who: ['~zod'] },
      { path: '/foo/bar/baz', who: ['~zod', '..abet.baboon'] },
    ]
    expect(untrust(drawers, '/foo', [bus])).toEqual([{ path: '/foo', who: ['~zod'] }])
    // taken below a drawer that gives it, the path gets its own drawer
    const wide = [{ path: '/foo', who: ['~zod', '..abet.baboon'] }]
    expect(untrust(wide, '/foo/bar', [bus])).toEqual([
      { path: '/foo', who: ['~zod', '..abet.baboon'] },
      { path: '/foo/bar', who: ['~zod'] },
    ])
  })

  test('a drawer that says nothing goes', () => {
    expect(
      tidy([
        { path: '/a', who: ['~zod'] },
        { path: '/a/b', who: ['~zod'] },
        { path: '/a/c', who: [] },
        { path: '/d', who: [] },
      ]),
    ).toEqual([
      { path: '/a', who: ['~zod'] },
      { path: '/a/c', who: [] },
    ])
  })
})

describe('nyms', () => {
  test('a long nym shows its first two and last two words', () => {
    expect(foreshorten('.abet.baboon.caffeine.denounce.escape')).toBe('.abet.baboon..denounce.escape')
    expect(foreshorten('..abet.baboon.caffeine.chanteuse.denounce.escape')).toBe(
      '..abet.baboon..denounce.escape',
    )
    expect(foreshorten('..abet.baboon')).toBe('..abet.baboon')
    expect(show({ ship: '~zod', nym: null })).toBe('~zod')
  })

  test('a name names by its words, an @p by its ship', () => {
    expect(names('abet.baboon', { ship: '~bus', nym: '.abet.baboon' })).toBe(true)
    expect(names('..~zod', { ship: '~zod', nym: null })).toBe(false)
    expect(names('~zod', { ship: '~zod', nym: '..abet.baboon' })).toBe(true)
    expect(names('', { ship: '~zod', nym: '..abet.baboon' })).toBe(false)
  })
})

describe('memory', () => {
  test('descriptions strip markup and stop at the first sentence', () => {
    expect(summarize('\n# Bullas carry *two* `signatures`\nmore')).toBe('Bullas carry two signatures')
    expect(summarize('- see [the docs](https://example.com) now')).toBe('see the docs now')
    expect(summarize('Tests are green; the old thread is gone.')).toBe('Tests are green')
    expect(summarize('Read `aqua-notes.md` first. Then the slips.')).toBe('Read aqua-notes.md first')
    expect(summarize('no stop here')).toBe('no stop here')
    expect(Array.from(summarize('é'.repeat(200))).length).toBe(150)
    expect(summarize('word '.repeat(40))).toBe(`${'word '.repeat(29)}word`)
  })

  test('frontmatter runs type, author, created and fqsp', () => {
    const one = entry('/notes/bar', '~zod', '')
    one.slip.fqsp = '/~zod/g/x/1/chorus//1/chorus/cabinet/notes/bar'
    expect(render(one, 'a "note"', 'body\n')).toBe(
      [
        '---',
        'name: notes.bar',
        'description: "a \\"note\\""',
        'metadata:',
        '  type: reference',
        '  author: ..abet.baboon',
        '  created: ~2026.9.17',
        '  fqsp: /~zod/g/x/1/chorus//1/chorus/cabinet/notes/bar',
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    )
  })

  test('links to synced slips take memory names; others stay', () => {
    const entries = [entry('/notes/bar', '~zod', ''), entry('/notes/baz/~sampel', '~sampel', '')]
    const text =
      'a [[/~zod/g/x/4/chorus//1/chorus/cabinet/notes/bar]] ' +
      'b [[/~sampel/g/x/1/chorus//1/chorus/cabinet/notes/baz]] ' +
      'c [[/~zod/g/x/1/chorus//1/chorus/cabinet/notes/nope]] ' +
      'd [[/~zod/notes/bar]] ' +
      'e [[/fine/~zod/g/x/4/chorus//1/chorus/cabinet/notes/bar]] ' +
      'f [[plain words]]'
    expect(rewriteLinks(text, entries)).toBe(
      'a [[notes.bar]] b [[notes.baz.~sampel]] ' +
        'c [[/~zod/g/x/1/chorus//1/chorus/cabinet/notes/nope]] ' +
        'd [[/~zod/notes/bar]] ' +
        'e [[/fine/~zod/g/x/4/chorus//1/chorus/cabinet/notes/bar]] ' +
        'f [[plain words]]',
    )
  })

  test('index lines name the author of a slip the host did not write', () => {
    const ours = entry('/notes/bar', '~zod', 'ours')
    const theirs = { ...entry('/notes/baz', '~bus', 'theirs'), nym: '.abet.baboon' }
    expect(plan([theirs, ours], '~zod', ['/notes']).section).toBe(
      `${HEADING}\n\n${NOTE}\n\n` +
        '- [notes.bar](chorus/notes/bar.md) — ours\n' +
        '- [notes.baz](chorus/notes/baz.md) — .abet.baboon: theirs\n',
    )
  })

  test('past eighty slips the index lists drawers', () => {
    const many = Array.from({ length: 81 }, (_, n) => entry(`/notes/n${n}`, '~zod', `note ${n}`))
    const wanted = plan(many, '~zod', ['/notes'])
    expect(wanted.section).toBe(
      `${HEADING}\n\n${NOTE}\n\n- [/notes](chorus/notes/INDEX.md) — 81 slips\n`,
    )
    expect(wanted.files.get('chorus/notes/INDEX.md')).toContain('- [notes.n80](chorus/notes/n80.md) — note 80')
  })

  test("the index keeps claude's lines and replaces ours", () => {
    const daemonNote = NOTE.replace('the `chorus` plugin', '`chorus`')
    const old =
      `# Memory Index\n\n- [a](a.md) — mine\n\n${HEADING}\n\n${daemonNote}` +
      '\n\n- [old](chorus/old.md) — stale\n- [b](b.md) — appended by claude\n'
    const section = `${HEADING}\n\n${NOTE}\n\n- [new](chorus/new.md) — fresh\n`
    expect(mergeIndex(old, section)).toBe(
      `# Memory Index\n\n- [a](a.md) — mine\n- [b](b.md) — appended by claude\n\n${section}`,
    )
    expect(mergeIndex(old, '')).toBe(
      '# Memory Index\n\n- [a](a.md) — mine\n- [b](b.md) — appended by claude\n',
    )
    expect(mergeIndex('', '')).toBe('')
  })
})

describe('ship', () => {
  const slip = { ship: '~zod', created: '~2026.9.17', fqsp: '/~zod/g/x/1/chorus//1/chorus/cabinet/notes/foo', text: 'a note' }

  test('a slip we cannot read fails the walk; an empty node does not', () => {
    const out: Slip[] = []
    walk({ slip: null, dir: { foo: { slip, dir: {} } } }, '/notes', out)
    expect(out.map(one => one.path)).toEqual(['/notes/foo'])
    // the shape an older agent gave: an address where the fqsp belongs
    const { fqsp: _, ...old } = { ...slip, address: '/~zod/notes/foo' }
    expect(() => walk({ slip: null, dir: { foo: { slip: old, dir: {} } } }, '/notes', [])).toThrow(BadSlip)
  })

  test('a segment that could leave the folder fails the walk', () => {
    expect(() => walk({ slip: null, dir: { '..': { slip, dir: {} } } }, '', [])).toThrow(BadSlip)
  })
})

describe('paths', () => {
  const slips = [
    { path: '/notes/foo', ship: '~zod' },
    { path: '/notes/foo/~bus', ship: '~bus' },
    { path: '/projects/chorus/plan', ship: '~bus' },
  ]

  test("a split folds back to the path its author published to", () => {
    expect(logical('/notes/foo/~bus')).toBe('/notes/foo')
    expect(pathsOf(slips)).toEqual(['/notes', '/notes/foo', '/projects', '/projects/chorus', '/projects/chorus/plan'])
    expect(authorsOf(slips, '/notes', '~zod')).toEqual([
      { ship: '~zod', slips: 1 },
      { ship: '~bus', slips: 1 },
    ])
    expect(authorsOf(slips, '/', '~zod')[1]).toEqual({ ship: '~bus', slips: 2 })
    expect(countsOf(slips).get('/notes')).toBe(2)
    expect(countsOf(slips).get('/projects/chorus/plan')).toBe(1)
  })

  test('a query takes its letters in order', () => {
    const all = pathsOf(slips)
    expect(filter(all, 'pch')).toEqual(['/projects/chorus', '/projects/chorus/plan'])
    expect(filter(all, 'n f')).toEqual(['/notes/foo'])
    expect(filter(all, 'Notes')).toEqual([])
    expect(filter(all, 'a.b')).toEqual([])
  })
})
