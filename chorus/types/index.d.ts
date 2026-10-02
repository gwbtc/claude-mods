// the values the cabinet pane draws from, held by the host for the
// session

// one slip in the cabinet: its tree path and its author's @p
export type CabinetSlip = { path: string; ship: string }

export type CabinetDrawer = { path: string; who: string[] }

// what the ship told us when the pane last loaded
export type CabinetData = {
  // 'unset': the plugin has no ship or no login; 'refused': the ship
  // turned the login down; 'failed': .error says why
  status: 'loading' | 'ready' | 'unset' | 'refused' | 'failed'
  error: string
  // the @p of the ship we talk to
  host: string
  slips: CabinetSlip[]
  // each author's nym by @p; null for an author with none
  nyms: Record<string, string | null>
  // the project's drawers, as the config file holds them
  drawers: CabinetDrawer[]
}

// where the person is in the pane
export type CabinetView = {
  // 'paths' lists the cabinet; 'authors' lists who wrote under .path
  screen: 'paths' | 'authors'
  query: string
  // the text the search field is drawn with; set when a screen opens
  // and left alone while the person types
  seed: string
  // the paths the query leaves, in order
  shown: string[]
  // the selected row of .shown, and the first row drawn
  sel: number
  top: number
  path: string
  // the selected author
  asel: number
  // false once ripgrep failed to start
  hasRipgrep: boolean
}

declare module 'claude-code' {
  interface PluginState {
    chorus: { data: CabinetData; view: CabinetView }
  }
}
