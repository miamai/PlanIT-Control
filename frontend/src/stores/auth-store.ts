import { z } from 'zod'
import { create } from 'zustand'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

const ACCESS_TOKEN = 'thisisjustarandomstring'

const USER_COOKIE = 'planit-session-user'
const authUserSchema = z.object({
  accountNo: z.string(),
  email: z.email(),
  role: z.array(z.string()),
  exp: z.number(),
})
type AuthUser = z.infer<typeof authUserSchema>

function readUser(): AuthUser | null {
  try {
    const raw = getCookie(USER_COOKIE)
    if (!raw) return null
    const parsed = authUserSchema.safeParse(JSON.parse(decodeURIComponent(raw)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    setAccessToken: (accessToken: string) => void
    resetAccessToken: () => void
    reset: () => void
  }
}

export function createAuthStore() {
  return create<AuthState>()((set) => {
    const cookieState = getCookie(ACCESS_TOKEN)
    let initToken = ''
    try {
      const token = cookieState ? JSON.parse(cookieState) : ''
      if (typeof token === 'string') initToken = token
    } catch {
      removeCookie(ACCESS_TOKEN)
    }
    return {
      auth: {
        user: initToken ? readUser() : null,
        setUser: (user) => {
          if (user)
            setCookie(USER_COOKIE, encodeURIComponent(JSON.stringify(user)))
          else removeCookie(USER_COOKIE)
          set((state) => ({ ...state, auth: { ...state.auth, user } }))
        },
        accessToken: initToken,
        setAccessToken: (accessToken) =>
          set((state) => {
            setCookie(ACCESS_TOKEN, JSON.stringify(accessToken))
            return { ...state, auth: { ...state.auth, accessToken } }
          }),
        resetAccessToken: () =>
          set((state) => {
            removeCookie(ACCESS_TOKEN)
            removeCookie(USER_COOKIE)
            return {
              ...state,
              auth: { ...state.auth, accessToken: '', user: null },
            }
          }),
        reset: () =>
          set((state) => {
            removeCookie(ACCESS_TOKEN)
            removeCookie(USER_COOKIE)
            return {
              ...state,
              auth: { ...state.auth, user: null, accessToken: '' },
            }
          }),
      },
    }
  })
}

export const useAuthStore = createAuthStore()
