// The widget library: every widget content may name, and nothing else.
// schema/widgets.json describes the same names and their params for the
// validator; registry.test.ts fails if the two lists differ.

import type { ReactNode } from 'react'
import { DependentColumns } from './DependentColumns.tsx'
import type { DependentColumnsParams } from './DependentColumns.tsx'
import { LineFitter } from './LineFitter.tsx'
import type { LineFitterParams } from './LineFitter.tsx'
import { PcaScatter } from './PcaScatter.tsx'
import type { PcaScatterParams } from './PcaScatter.tsx'
import { SvdGeometry } from './SvdGeometry.tsx'
import type { SvdGeometryParams } from './SvdGeometry.tsx'

// Params are checked against schema/widgets.json before content is published,
// so each widget takes its own params type on trust. (A function taking
// { params: never } accepts any of them.)
type AnyWidget = (props: { params: never }) => ReactNode

export const registry: Record<string, AnyWidget> = {
  'line-fitter': LineFitter satisfies (props: { params: LineFitterParams }) => ReactNode,
  'dependent-columns': DependentColumns satisfies (props: { params: DependentColumnsParams }) => ReactNode,
  'svd-geometry': SvdGeometry satisfies (props: { params: SvdGeometryParams }) => ReactNode,
  'pca-scatter': PcaScatter satisfies (props: { params: PcaScatterParams }) => ReactNode,
}
