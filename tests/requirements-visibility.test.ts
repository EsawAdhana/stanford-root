import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The degree requirements page stays off the public site until it is ready:
 * off in a production build unless NEXT_PUBLIC_REQUIREMENTS=1, on in
 * development.
 */
async function visible() {
  vi.resetModules()
  return (await import('@/lib/requirements/visibility')).REQUIREMENTS_PUBLIC
}

afterEach(() => vi.unstubAllEnvs())

describe('requirements page visibility', () => {
  it('is hidden in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_REQUIREMENTS', '')
    expect(await visible()).toBe(false)
  })

  it('is shown in production when the flag is on', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_REQUIREMENTS', '1')
    expect(await visible()).toBe(true)
  })

  it('is shown in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_REQUIREMENTS', '')
    expect(await visible()).toBe(true)
  })
})
