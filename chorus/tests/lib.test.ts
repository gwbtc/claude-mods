// the layers beneath the hooks: trust, nyms, the memory adapter, the
// ship's json and the pane's paths

import { describe, expect, test } from 'claude-code/testing'

import { drawerFor, isTrusted, parse, parseJar, standing, tidy, trust, untrust } from '../hooks/config'
import { describe as summarize, mergeIndex, plan, render, rewriteLinks, HEADING, NOTE } from '../hooks/memory'
import type { Entry } from '../hooks/memory'
import { foreshorten, nameOf, names, show } from '../hooks/nym'
import { authorsOf, countsOf, filter, logical, pathsOf } from '../hooks/paths'
import { BadResponse, BadSlip, Unauthorized, ask, listedOf, login, slipOf, walk } from '../hooks/ship'
import type { Fetch, Slip } from '../hooks/ship'

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

  test('a config reads back with its paths and urls trimmed', () => {
    const text = JSON.stringify({
      ship: 'http://localhost:8080/',
      drawers: [{ path: '/notes/', who: ['..abet.baboon', 7] }, { path: '/a' }],
    })
    expect(parse(text)).toEqual({
      ship: 'http://localhost:8080',
      drawers: [
        { path: '/notes', who: ['..abet.baboon'] },
        { path: '/a', who: [] },
      ],
    })
    expect(parse('{}')).toEqual({ drawers: [] })
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

describe('jar', () => {
  test('a bare cookie from an older jar sits at the url it is under', () => {
    const jar = parseJar('{"http://a.test": "urbauth-~zod=0v1", "http://b.test": {"url": "https://b.test", "cookie": "urbauth-~bus=0v2"}, "http://c.test": 3}')
    expect(jar).toEqual({
      'http://a.test': { url: 'http://a.test', cookie: 'urbauth-~zod=0v1' },
      'http://b.test': { url: 'https://b.test', cookie: 'urbauth-~bus=0v2' },
    })
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
    // a note an older version worded otherwise is still ours
    const oldNote = NOTE.replace('the `chorus` plugin', '`chorus`')
    const old =
      `# Memory Index\n\n- [a](a.md) — mine\n\n${HEADING}\n\n${oldNote}` +
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
    walk({ slip: null, dir: { foo: { slip, dir: {} } } }, '/notes', out, slipOf)
    expect(out.map(one => one.path)).toEqual(['/notes/foo'])
    // the shape an older agent gave: an address where the fqsp belongs
    const { fqsp: _, ...old } = { ...slip, address: '/~zod/notes/foo' }
    expect(() => walk({ slip: null, dir: { foo: { slip: old, dir: {} } } }, '/notes', [], slipOf)).toThrow(BadSlip)
  })

  test('a segment that could leave the folder fails the walk', () => {
    expect(() => walk({ slip: null, dir: { '..': { slip, dir: {} } } }, '', [], slipOf)).toThrow(BadSlip)
  })

  test('a listing says whether the ship holds a slip; an older agent held them all', () => {
    const { text: _, ...stub } = slip
    expect(listedOf({ ...stub, held: false, digest: '0v1' }, '/notes/foo')).toEqual({
      path: '/notes/foo',
      ship: '~zod',
      fqsp: slip.fqsp,
      isHeld: false,
    })
    expect(listedOf(slip, '/notes/foo').isHeld).toBe(true)
    expect(() => listedOf({ ...stub, held: 'yes' }, '/notes/foo')).toThrow(BadSlip)
  })

  test('an ask pokes the agent once for each slip and closes its channel', async () => {
    const sent: { url: string; method?: string; body?: string }[] = []
    const fetch: Fetch = async (url, init) => {
      sent.push({ url, method: init?.method, body: init?.body })

      return { status: 204, ok: true, headers: {}, text: '' }
    }
    const ship = { url: 'http://ship.test', cookie: 'urbauth-~zod=0v5.cookie' }
    await ask(fetch, ship, [], 'none')
    expect(sent).toEqual([])
    await ask(fetch, ship, [{ drawer: '/notes/foo', ship: '~bus' }], 'one')
    expect(sent.map(one => [one.url, one.method])).toEqual([['http://ship.test/~/channel/one', 'PUT']])
    expect(JSON.parse(sent[0]?.body ?? '')).toEqual([
      {
        id: 1,
        action: 'poke',
        ship: 'zod',
        app: 'chorus',
        mark: 'chorus-fetch',
        json: { drawer: '/notes/foo', ships: ['~bus'] },
      },
      { id: 2, action: 'delete' },
    ])
    const refuse: Fetch = async () => ({ status: 403, ok: false, headers: {}, text: '' })
    await expect(ask(refuse, ship, [{ drawer: '/', ship: '~bus' }], 'two')).rejects.toThrow(Unauthorized)
  })

  const COOKIE = 'urbauth-~zod=0v5.cookie'
  const answer = (status: number, text = '', headers: Record<string, string> = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers,
    text,
  })
  // a ship at each of .bases, behind whatever .before answers first.
  // .posted lists where the +code went
  function eyre(bases: string[], before: (url: string) => ReturnType<typeof answer> | null = () => null) {
    const posted: string[] = []
    const fetch: Fetch = async (url, init) => {
      if (init?.method === 'POST') posted.push(url)
      const early = before(url)
      if (early !== null) return early
      const base = bases.find(one => url.startsWith(`${one}/`))
      if (base === undefined) throw new Error('connection refused')
      const path = url.slice(base.length)
      if (path === '/~/host') return answer(200, '~zod')
      if (path === '/~/login') {
        return init?.body === 'password=right'
          ? answer(204, '', { 'set-cookie': `${COOKIE}; Path=/` })
          : answer(400, '<html>login</html>')
      }

      return init?.headers?.cookie === COOKIE ? answer(200, 'null') : answer(403)
    }

    return { fetch, posted }
  }

  test('a ship with no https logs in where it is', async () => {
    const { fetch, posted } = eyre(['http://localhost:8080'])
    expect(await login(fetch, 'http://localhost:8080', '~right')).toEqual({
      url: 'http://localhost:8080',
      cookie: COOKIE,
    })
    expect(posted).toEqual(['http://localhost:8080/~/login'])
  })

  test('an http url gives way to its https twin, and the code goes there alone', async () => {
    // the host followed a redirect unseen: http answers as the ship does
    const { fetch, posted } = eyre(['http://ship.test', 'https://ship.test'])
    expect((await login(fetch, 'http://ship.test', 'right')).url).toBe('https://ship.test')
    expect(posted).toEqual(['https://ship.test/~/login'])
  })

  test('a redirect we are shown is followed, on the same host alone', async () => {
    const to = (location: string) => (url: string) =>
      url.startsWith('http://ship.test/') ? answer(301, '', { location }) : null
    const near = eyre(['https://ship.test:8443'], to('https://ship.test:8443/~/host'))
    expect((await login(near.fetch, 'http://ship.test', 'right')).url).toBe('https://ship.test:8443')
    expect(near.posted).toEqual(['https://ship.test:8443/~/login'])
    const far = eyre(['https://else.test'], to('https://else.test/~/host'))
    await expect(login(far.fetch, 'http://ship.test', 'right')).rejects.toThrow(BadResponse)
    expect(far.posted).toEqual([])
  })

  test('a wrong code, or a cookie the ship will not take, is no login', async () => {
    const { fetch } = eyre(['https://ship.test'])
    await expect(login(fetch, 'https://ship.test', 'wrong')).rejects.toThrow(Unauthorized)
    // the scry that tries the cookie is refused
    const deaf = eyre(['https://ship.test'], url => (url.includes('/~/scry/') ? answer(403) : null))
    await expect(login(deaf.fetch, 'https://ship.test', 'right')).rejects.toThrow(Unauthorized)
    // a ship with no chorus to scry still logged us in
    const bare = eyre(['https://ship.test'], url => (url.includes('/~/scry/') ? answer(404) : null))
    expect((await login(bare.fetch, 'https://ship.test', 'right')).cookie).toBe(COOKIE)
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
    expect(pathsOf(slips)).toEqual(['/notes', '/projects', '/notes/foo', '/projects/chorus', '/projects/chorus/plan'])
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
