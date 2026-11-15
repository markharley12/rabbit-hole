// The address is the app's state: #15Axx is a node on the map,
// #15Axx/learn/<lesson-id> a lesson of the course on that node, and
// #15Axx/courses the courses menu opened from there. So the phone's back
// button closes what is open and then steps back up the map.

export type Route = { nodeId: string; lessonId?: string; menu?: boolean }

export function parseRoute(hash: string): Route {
  const [nodeId, kind, lessonId] = hash.split('/')
  if (kind === 'learn' && lessonId) return { nodeId, lessonId }
  if (kind === 'courses') return { nodeId, menu: true }
  return { nodeId: hash }
}
