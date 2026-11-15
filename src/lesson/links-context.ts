import { createContext } from 'react'
import type { LinkContext } from './markdown.ts'

/** Which course the text belongs to, so lesson: links know their node. */
export const LinksContext = createContext<LinkContext | undefined>(undefined)
