import { useEffect, useState } from 'react'
import { serverKinds } from './client.ts'

/**
 * Whether the server on the PC is there and offers this session kind (the
 * same GET state check the Ask chat uses). False until it answers, and when
 * it does not: no server, no buttons. Checked again whenever `again` changes.
 */
export function useServerOffers(kind: string, again: unknown = 0, check: typeof serverKinds = serverKinds): boolean {
  const [offered, setOffered] = useState(false)
  useEffect(() => {
    let live = true
    check().then((kinds) => live && setOffered(kinds.includes(kind)))
    return () => {
      live = false
    }
  }, [kind, again, check])
  return offered
}
