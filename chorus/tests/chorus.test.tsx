// the plugin whole: the sync into project memory, the guard over the
// copies, and the /cabinet pane

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CODE, CONFIG, COOKIE, HOST, JAR, MEMORY, ROOT, SHIP, world } from './world'

const BUS = '~bus'
const SLIPS = {
  '/notes/foo': { ship: HOST, text: 'Foo is ours. More.' },
  '/notes/foo/~bus': { ship: BUS, text: 'Foo is theirs.' },
  '/projects/chorus/plan': { ship: BUS, text: 'The plan; in short.' },
  '/projects/chorus/todo': { ship: HOST, text: 'Things to do.' },
}
const NYMS = { [BUS]: '..abet.baboon.caffeine.denounce.escape' }
const OPTIONS = { ship: SHIP, code: CODE }
const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const
const PANE = {
  component: 'Pane',
  requestId: 'cabinet',
  props: {
    title: 'Chorus Cabinet',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 17 },
    view: {},
  },
} as const

function config(drawers: { path: string; who: string[] }[]): string {
  return `${JSON.stringify({ drawers }, null, 2)}\n`
}

function open($: Engine) {
  return $.command.run({
    command: 'cabinet',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
}

describe('sync', () => {
  test('a project with no config stays as it was', { options: OPTIONS }, async ($, on) => {
    const here = world(on, { slips: SLIPS })
    await $.session.start(START)
    expect([...here.files.keys()]).toEqual([])
    expect(here.asked).toEqual([])
  })

  test('trusted slips land in project memory, read-only', { options: OPTIONS }, async ($, on) => {
    const here = world(on, {
      slips: SLIPS,
      nyms: NYMS,
      files: {
        [CONFIG]: config([{ path: '/notes', who: [HOST] }]),
        [`${MEMORY}/MEMORY.md`]: '# Memory Index\n\n- [a](a.md) — mine\n',
      },
    })
    await $.session.start(START)
    // the code minted a cookie, and the jar kept it
    expect(here.asked[0]).toBe(`${SHIP}/~/login`)
    expect(JSON.parse(here.files.get(JAR) ?? '')).toEqual({ [SHIP]: COOKIE })
    expect(here.files.get(`${MEMORY}/chorus/notes/foo.md`)).toContain('description: "Foo is ours"')
    expect(here.locked.has(`${MEMORY}/chorus/notes/foo.md`)).toBe(true)
    // nobody named the other author
    expect(here.files.has(`${MEMORY}/chorus/notes/foo/~bus.md`)).toBe(false)
    expect(here.files.get(`${MEMORY}/MEMORY.md`)).toContain(
      '- [a](a.md) — mine\n\n## Chorus (synced, read-only)',
    )
    expect(here.files.get(`${MEMORY}/MEMORY.md`)).toContain('- [notes.foo](chorus/notes/foo.md) — Foo is ours\n')
  })

  test('a slip the ship drops leaves the folder at the next poll', { options: OPTIONS }, async ($, on) => {
    const here = world(on, {
      slips: { ...SLIPS },
      nyms: NYMS,
      files: { [CONFIG]: config([{ path: '/', who: [HOST, 'abet.baboon.caffeine.denounce.escape'] }]) },
    })
    await $.session.start(START)
    expect(here.files.get(`${MEMORY}/MEMORY.md`)).toContain(
      '- [projects.chorus.plan](chorus/projects/chorus/plan.md) — ..abet.baboon.caffeine.denounce.escape: The plan\n',
    )
    expect(here.files.has(`${MEMORY}/chorus/notes/foo/~bus.md`)).toBe(true)
    here.slips = { '/notes/foo': { ship: HOST, text: 'Foo, revised.' } }
    await here.clock.advance(60_000)
    expect([...here.files.keys()].filter(file => file.startsWith(MEMORY))).toEqual([
      `${MEMORY}/MEMORY.md`,
      `${MEMORY}/chorus/notes/foo.md`,
    ])
    expect(here.files.get(`${MEMORY}/chorus/notes/foo.md`)).toContain('Foo, revised.')
  })

  test("the daemon's config moves over: cookie to the jar, host by name", async ($, on) => {
    const here = world(on, {
      slips: SLIPS,
      files: {
        [CONFIG]: JSON.stringify({
          ship: SHIP,
          cookie: COOKIE,
          memory: MEMORY,
          drawers: [{ path: '/projects/chorus', who: null }],
        }),
      },
    })
    await $.session.start(START)
    expect(JSON.parse(here.files.get(CONFIG) ?? '')).toEqual({
      ship: SHIP,
      drawers: [{ path: '/projects/chorus', who: [HOST] }],
    })
    expect(JSON.parse(here.files.get(JAR) ?? '')).toEqual({ [SHIP]: COOKIE })
    expect(here.files.has(`${MEMORY}/chorus/projects/chorus/todo.md`)).toBe(true)
    expect(here.files.has(`${MEMORY}/chorus/projects/chorus/plan.md`)).toBe(false)
  })

  test('a refused login says so once and writes nothing', { options: { ship: SHIP, code: 'wrong' } }, async ($, on) => {
    const here = world(on, {
      slips: SLIPS,
      files: { [CONFIG]: config([{ path: '/notes', who: [HOST] }]) },
    })
    await $.session.start(START)
    await here.clock.advance(60_000)
    expect(here.toasts).toEqual(['chorus: login failed; set a fresh +code in /plugin'])
    expect([...here.files.keys()]).toEqual([CONFIG])
  })

  test('the copies turn away an edit', { options: OPTIONS }, async ($, on) => {
    world(on, { slips: SLIPS, files: { [CONFIG]: config([{ path: '/notes', who: [HOST] }]) } })
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(START)
    const edit = { old_string: 'a', new_string: 'b' }
    const copy = await $.tool.call({ tool: 'Edit', file_path: `${MEMORY}/chorus/notes/foo.md`, ...edit })
    expect(copy).toMatchObject({ deny: expect.stringContaining('read-only copy') })
    const dotted = await $.tool.call({ tool: 'Write', file_path: `${MEMORY}/x/../chorus/new.md`, content: '' })
    expect(dotted).toMatchObject({ deny: expect.stringContaining('read-only copy') })
    const own = await $.tool.call({ tool: 'Edit', file_path: `${MEMORY}/MEMORY.md`, ...edit })
    expect(own).toMatchObject({ result: 'ran' })
  })
})

describe('/cabinet', () => {
  const NYM = '..abet.baboon.caffeine.denounce.escape'

  test('lists every path and filters as the person types', { options: OPTIONS }, async ($, on) => {
    world(on, { slips: SLIPS, nyms: NYMS })
    await $.session.start(START)
    await open($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'chorus', surface, ...PANE })
      const rows = async () => (await ui.findAll({ type: 'Button' })).map(row => row.text)
      expect(await rows()).toEqual([
        '❯ /notes',
        '  /notes/foo',
        '  /projects',
        '  /projects/chorus',
        '  /projects/chorus/plan',
        '  /projects/chorus/todo',
      ])
      expect(await ui.find({ type: 'Text', text: 'Chorus Cabinet' })).toBeDefined()
      await ui.input({ key: 'search', text: 'pch', kind: 'change' })
      expect(await rows()).toEqual([
        '❯ /projects/chorus',
        '  /projects/chorus/plan',
        '  /projects/chorus/todo',
      ])
      await ui.input({ key: 'search', text: '', kind: 'change' })
      await ui.unmount()
    }
  })

  test('searches without ripgrep and says so', { options: OPTIONS }, async ($, on) => {
    world(on, { slips: SLIPS, nyms: NYMS, hasRipgrep: false })
    await $.session.start(START)
    await open($)
    const ui = await $.ui.mount({ plugin: 'chorus', surface: 'terminal', ...PANE })
    await ui.input({ key: 'search', text: 'todo', kind: 'change' })
    expect(await ui.find({ key: 'row:0' })).toMatchObject({ text: '❯ /projects/chorus/todo' })
    expect(await ui.find({ type: 'Text', text: /ripgrep/ })).toBeDefined()
  })

  test('nobody is trusted until the person says so', { options: OPTIONS }, async ($, on) => {
    const here = world(on, { slips: SLIPS, nyms: NYMS })
    await $.session.start(START)
    await open($)
    const ui = await $.ui.mount({ plugin: 'chorus', surface: 'terminal', ...PANE })
    await ui.input({ key: 'search', text: 'notes', kind: 'change' })
    // enter in the search field opens the selected path
    await ui.input({ key: 'search', text: 'notes' })
    expect(await ui.find({ key: 'author:0' })).toMatchObject({ text: `❯ [ ] ${HOST}` })
    expect(await ui.find({ key: 'author:1' })).toMatchObject({
      text: '  [ ] ..abet.baboon..denounce.escape',
    })
    // each author's slips, counted beside them
    expect((await ui.findAll({ type: 'Text', text: /^1/ })).map(one => one.text)).toEqual(['1  host', '1'])
    expect(here.files.has(CONFIG)).toBe(false)

    // enter acts on the selected author: the host, listed first
    await ui.press({ key: 'pick' })
    expect(here.files.get(CONFIG)).toBe(config([{ path: '/notes', who: [HOST] }]))
    // the config changed, so the sync runs once it settles
    await here.clock.advance(500)
    expect(here.files.has(`${MEMORY}/chorus/notes/foo.md`)).toBe(true)

    // a click on an author trusts them; again, and it stops
    await ui.press({ key: 'author:1' })
    expect(here.files.get(CONFIG)).toBe(config([{ path: '/notes', who: [HOST, NYM] }]))
    await ui.press({ key: 'author:1' })
    expect(here.files.get(CONFIG)).toBe(config([{ path: '/notes', who: [HOST] }]))
    // the host comes off like anyone, and a drawer with nobody goes
    await ui.press({ key: 'author:0' })
    expect(here.files.get(CONFIG)).toBe(config([]))
    // `a` takes everyone listed, and lets them all go
    await ui.press({ key: 'key:a' })
    expect(here.files.get(CONFIG)).toBe(config([{ path: '/notes', who: [HOST, NYM] }]))
    await ui.press({ key: 'key:a' })
    expect(here.files.get(CONFIG)).toBe(config([]))
  })

  test('trust reaches down and shows from above', { options: OPTIONS }, async ($, on) => {
    const here = world(on, { slips: SLIPS, nyms: NYMS })
    await $.session.start(START)
    await open($)
    const ui = await $.ui.mount({ plugin: 'chorus', surface: 'terminal', ...PANE })
    // trust the other author at /projects/chorus
    await ui.press({ key: 'row:3' })
    await ui.press({ key: 'author:1' })
    expect(here.files.get(CONFIG)).toBe(config([{ path: '/projects/chorus', who: [NYM] }]))
    // from /projects they show as trusted, with where the trust sits
    await open($)
    await ui.press({ key: 'row:2' })
    expect(await ui.find({ key: 'author:1' })).toMatchObject({
      text: '  [x] ..abet.baboon..denounce.escape',
    })
    expect(await ui.find({ type: 'Text', text: 'under /projects/chorus' })).toBeDefined()
    // taken at /projects, it goes from everything below
    await ui.press({ key: 'author:1' })
    expect(here.files.get(CONFIG)).toBe(config([]))
    // given at /projects, it holds below
    await ui.press({ key: 'author:1' })
    expect(here.files.get(CONFIG)).toBe(config([{ path: '/projects', who: [NYM] }]))
    await open($)
    await ui.press({ key: 'row:4' })
    expect(await ui.find({ key: 'author:0' })).toMatchObject({
      text: '❯ [x] ..abet.baboon..denounce.escape',
    })
  })

  test('the arrows move the selection and the ring stays put', { options: OPTIONS }, async ($, on) => {
    world(on, { slips: SLIPS, nyms: NYMS })
    on('ui.focus', () => ({}))
    await $.session.start(START)
    await open($)
    const ui = await $.ui.mount({ plugin: 'chorus', surface: 'terminal', ...PANE })
    const arrow = (element: string | undefined) =>
      $.ui.focus({
        component: 'Pane',
        requestId: 'cabinet',
        plugin: 'chorus',
        element,
        origin: { kind: 'person' },
      })
    const stays = { deny: 'the selection moved; the ring stays' }
    // down aims at the first row; the search field keeps the keys
    expect(await arrow('row:0')).toMatchObject(stays)
    expect(await arrow('row:0')).toMatchObject(stays)
    expect(await ui.find({ key: 'row:2' })).toMatchObject({ text: '❯ /projects' })
    // up aims at the engine's own stop before the field
    await arrow(undefined)
    expect(await ui.find({ key: 'row:1' })).toMatchObject({ text: '❯ /notes/foo' })
    expect(await arrow('search')).toEqual({})
    // over the authors it is the same, around a holder nobody sees
    await ui.input({ key: 'search', text: '' })
    expect(await ui.find({ key: 'author:0' })).toMatchObject({ text: `❯ [ ] ${HOST}` })
    expect(await arrow('author:0')).toMatchObject(stays)
    expect(await ui.find({ key: 'author:1' })).toMatchObject({
      text: '❯ [ ] ..abet.baboon..denounce.escape',
    })
    expect(await arrow(undefined)).toMatchObject(stays)
    expect(await ui.find({ key: 'author:0' })).toMatchObject({ text: `❯ [ ] ${HOST}` })
  })

  test('with no login it says what to set', async ($, on) => {
    world(on, { slips: SLIPS })
    await $.session.start(START)
    await open($)
    const ui = await $.ui.mount({ plugin: 'chorus', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /No ship to ask/ })).toBeDefined()
  })
})
