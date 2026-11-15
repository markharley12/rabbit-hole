import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { forgetUpdate, watchForUpdates } from './pwa-update.ts'
import type { UpdateEnvironment } from './pwa-update.ts'
import { UpdateBar } from './components/UpdateBar.tsx'

/** A worker that can change state, as a ServiceWorker does. */
class FakeWorker extends EventTarget {
  state = 'installing'
  postMessage = vi.fn()
  become(state: string) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

function setUp({ controlled = true, waiting = null as FakeWorker | null } = {}) {
  const container = Object.assign(new EventTarget(), { controller: controlled ? ({} as ServiceWorker) : null })
  const registration = Object.assign(new EventTarget(), {
    waiting: waiting as unknown as ServiceWorker | null,
    installing: null as unknown as ServiceWorker | null,
    update: vi.fn(async () => undefined as never),
  })
  const reload = vi.fn()
  let visible = () => {}
  watchForUpdates({
    container,
    registration,
    reload,
    onVisible: (check: () => void) => (visible = check),
  } as unknown as UpdateEnvironment)
  const arrive = () => {
    const worker = new FakeWorker()
    registration.installing = worker as unknown as ServiceWorker
    registration.dispatchEvent(new Event('updatefound'))
    return worker
  }
  return { container, registration, reload, arrive, comeBack: () => visible() }
}

afterEach(() => {
  cleanup()
  forgetUpdate()
})

describe('the update bar', () => {
  it('stays away until a new build has installed', async () => {
    const { arrive } = setUp()
    render(<UpdateBar />)
    const worker = arrive()
    expect(screen.queryByText('A new version is ready.')).toBeNull()
    await act(async () => worker.become('installed'))
    expect(screen.getByText('A new version is ready.')).toBeTruthy()
  })

  it('shows for a build already waiting when the app opens', () => {
    setUp({ waiting: new FakeWorker() })
    render(<UpdateBar />)
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })

  it('does not call the very first install an update', async () => {
    const { arrive } = setUp({ controlled: false })
    render(<UpdateBar />)
    await act(async () => arrive().become('installed'))
    expect(screen.queryByText('A new version is ready.')).toBeNull()
  })

  it('asks the waiting build to take over, and reloads once when it has', async () => {
    const worker = new FakeWorker()
    const { container, reload } = setUp({ waiting: worker })
    render(<UpdateBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' })
    expect(screen.getByText('Updating…')).toBeTruthy()
    container.dispatchEvent(new Event('controllerchange'))
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('can be put off', () => {
    setUp({ waiting: new FakeWorker() })
    render(<UpdateBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })

  it('looks for a new build when the app comes back into view', () => {
    const { registration, comeBack } = setUp()
    comeBack()
    expect(registration.update).toHaveBeenCalledTimes(1)
  })
})
