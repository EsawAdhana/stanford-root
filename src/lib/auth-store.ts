import { create } from 'zustand'
import { supabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  session: Session | null
  isLoading: boolean
  initialize: () => () => void
  signInWithGoogle: () => Promise<void>
  signInAsGuest: () => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isLoading: true,

  initialize: () => {
    // Load existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null

      // Reject non-Stanford emails
      if (user && !user.email?.endsWith('@stanford.edu')) {
        supabase.auth.signOut()
        set({ user: null, session: null, isLoading: false })
        return
      }

      set({ user, session, isLoading: false })
    }).catch((err) => {
      console.error('Failed to get session:', err)
      set({ user: null, session: null, isLoading: false })
    })

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null

      if (user && !user.email?.endsWith('@stanford.edu')) {
        supabase.auth.signOut()
        set({ user: null, session: null, isLoading: false })
        return
      }

      set({ user, session, isLoading: false })
    })

    return () => subscription.unsubscribe()
  },

  signInWithGoogle: async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        queryParams: {
          hd: 'stanford.edu' // Hint Google to only show Stanford accounts
        }
      }
    })
  },

  signInAsGuest: async () => {
    const mockUser = {
      id: 'guest-123',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'guest@stanford.edu',
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      confirmation_sent_at: '',
      confirmed_at: '',
      last_sign_in_at: '',
      app_metadata: {
        provider: 'email',
        providers: ['email']
      },
      user_metadata: {
        full_name: 'Guest Developer',
      },
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as User

    set({
      user: mockUser,
      session: {
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: mockUser
      },
      isLoading: false
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null })
  }
}))
