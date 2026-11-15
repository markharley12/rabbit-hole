import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registry } from './registry.ts'

const catalogue = JSON.parse(readFileSync('schema/widgets.json', 'utf8')) as { widgets: Record<string, unknown> }

describe('the widget library', () => {
  it('is the same list the validator checks content against', () => {
    expect(Object.keys(registry).sort()).toEqual(Object.keys(catalogue.widgets).sort())
  })
})
