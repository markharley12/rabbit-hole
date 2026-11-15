// The address is the app's state: #15Axx is a node on the map, and
// #15Axx/learn/<lesson-id> is a lesson of the course on that node. So the
// phone's back button steps out of a lesson and then back up the map.

export function parseRoute(hash: string): { nodeId: string; lessonId?: string } {
  const [nodeId, kind, lessonId] = hash.split('/')
  return kind === 'learn' && lessonId ? { nodeId, lessonId } : { nodeId: hash }
}
