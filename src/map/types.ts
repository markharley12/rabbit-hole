/** One node of `content/<field>/map.json`, as tools/build_maths_map.py writes it. */
export interface MapNode {
  /** The MSC code when there is one (`15Axx`), otherwise a slug of the name. */
  id: string
  name: string
  code?: string
  /** Copied from the source; the root and one grouping ("Mechanics") have none. */
  rank?: string
  aliases?: string[]
  /** A section's MSC topics; a subject's sections as MSC names them. */
  items?: string[]
  description?: string
  url?: string
  urlTitle?: string
  children?: MapNode[]
}

export interface MapSource {
  name: string
  url: string
  licence: string
  licence_url?: string
  note?: string
}

export interface MapDocument {
  format: number
  id: string
  title: string
  totals: { nodes: number; leaves: number; topics: number }
  sources: MapSource[]
  builtFrom: { repo: string; path: string; commit: string; dirty?: boolean }
  root: MapNode
}
