import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * signOut() suspends schedule pushes, clears the cart, then awaits the
 * sign-out request. When that request threw, resetSyncState() never ran, so
 * pushes stayed suspended for the life of the tab and nothing saved after
 * the student signed back in without reloading.
 */

const signOutRequest = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: () => signOutRequest() } },
}))

const resetSyncState = vi.fn()
vi.mock('@/lib/schedule-sync', () => ({
  pullSchedule: vi.fn(),
  cancelDebouncedPush: vi.fn(),
  resetSyncState: () => resetSyncState(),
  suspendPush: vi.fn(),
}))
vi.mock('@/lib/cart-store', () => ({ useCartStore: { getState: () => ({ clearCart: vi.fn() }) } }))
vi.mock('@/lib/evaluation-store', () => ({ useEvaluationStore: { getState: () => ({ clearAll: vi.fn() }) } }))
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), markLoginPending: vi.fn(), consumeLoginPending: vi.fn() }))
vi.mock('@/lib/auth-errors', () => ({ showAuthError: vi.fn(), showAuthLoading: vi.fn(), dismissAuthLoading: vi.fn(), showAuthRedirectStalled: vi.fn() }))
vi.mock('@/lib/humanbehavior', () => ({ identifyVisitor: vi.fn() }))

describe('signOut', () => {
  beforeEach(() => {
    signOutRequest.mockReset()
    resetSyncState.mockReset()
  })

  it('resets sync state when the sign-out request throws', async () => {
    const { useAuthStore } = await import('@/lib/auth-store')
    useAuthStore.setState({ user: { id: 'u1' } as never })
    signOutRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(useAuthStore.getState().signOut()).rejects.toThrow('Failed to fetch')
    expect(resetSyncState).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('resets sync state when the sign-out request succeeds', async () => {
    const { useAuthStore } = await import('@/lib/auth-store')
    signOutRequest.mockResolvedValueOnce({ error: null })
    await useAuthStore.getState().signOut()
    expect(resetSyncState).toHaveBeenCalledTimes(1)
  })
})
