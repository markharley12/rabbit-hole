// The address is the app's state: #15Axx is a node on the map,
// #15Axx/learn/<course-id>/<lesson-id> a lesson of one of the courses on that
// node, #15Axx/courses the courses menu opened from there and #15Axx/review a session of
// spaced review, opened the same way, and #15Axx/new-course the chat that makes a new
// course, opened from there (the node is only a suggestion to the session). So the phone's
// back button closes what is open and then steps back up the map.
//
// The first version had one course per node and no course id in the address,
// #15Axx/learn/<lesson-id>. That form is saved on Mark's phone, so it still
// parses (without a courseId) and resolveLesson finds the course for it.

import type { Course } from './lesson/types.ts'

export type Route = { nodeId: string; courseId?: string; lessonId?: string; menu?: boolean; review?: boolean; newCourse?: boolean }

export function parseRoute(hash: string): Route {
  const [nodeId, kind, first, second] = hash.split('/')
  if (kind === 'learn' && first && second) return { nodeId, courseId: first, lessonId: second }
  if (kind === 'learn' && first) return { nodeId, lessonId: first }
  if (kind === 'courses') return { nodeId, menu: true }
  if (kind === 'review') return { nodeId, review: true }
  if (kind === 'new-course') return { nodeId, newCourse: true }
  return { nodeId: hash }
}

export const lessonHash = (course: Course, lessonId: string) => `${course.nodeId}/learn/${course.id}/${lessonId}`

/** The course and lesson a route opens, or undefined when it names none that exist on its node. */
export function resolveLesson(route: Route, onNode: Course[]): { course: Course; lessonId: string } | undefined {
  const { lessonId, courseId } = route
  if (!lessonId) return undefined
  // Old form (no course id): the first course on the node that has a lesson with that id.
  const course = onNode.find((c) => (courseId ? c.id === courseId : true) && c.lessons.some((l) => l.id === lessonId))
  return course && { course, lessonId }
}
