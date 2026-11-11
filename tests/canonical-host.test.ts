import { describe, it, expect } from 'vitest'
import { canonicalRedirect } from '@/lib/canonical-host'

/**
 * The bare domain must answer the MCP server itself (an MCP client refuses a
 * redirect at sign-in) and send every page to www. These are the inputs that
 * would break one or the other.
 */
describe('canonicalRedirect', () => {
  const bare = (path: string, search = '') => canonicalRedirect('stanfordroot.com', path, search)

  it('serves the MCP server and its sign-in metadata on the bare domain', () => {
    expect(bare('/api/mcp')).toBeNull()
    expect(bare('/.well-known/oauth-protected-resource/api/mcp')).toBeNull()
    expect(bare('/.well-known/oauth-protected-resource')).toBeNull()
  })

  it('sends every page on the bare domain to www, keeping the path and query', () => {
    expect(bare('/')).toBe('https://www.stanfordroot.com/')
    expect(bare('/CS106B')).toBe('https://www.stanfordroot.com/CS106B')
    expect(bare('/', '?q=cs&terms=Winter')).toBe('https://www.stanfordroot.com/?q=cs&terms=Winter')
    expect(bare('/oauth/consent', '?authorization_id=abc')).toBe('https://www.stanfordroot.com/oauth/consent?authorization_id=abc')
    expect(bare('/privacy')).toBe('https://www.stanfordroot.com/privacy')
  })

  it('does not let a look-alike path ride the MCP exception', () => {
    expect(bare('/api/mcp/')).toBe('https://www.stanfordroot.com/api/mcp/')
    expect(bare('/api/mcp-anything')).toBe('https://www.stanfordroot.com/api/mcp-anything')
    expect(bare('/api/courses')).toBe('https://www.stanfordroot.com/api/courses')
    expect(bare('/.well-known')).toBe('https://www.stanfordroot.com/.well-known')
  })

  it('reads the host however it arrives', () => {
    expect(canonicalRedirect('StanfordRoot.com', '/faq', '')).toBe('https://www.stanfordroot.com/faq')
    expect(canonicalRedirect('stanfordroot.com:443', '/faq', '')).toBe('https://www.stanfordroot.com/faq')
    expect(canonicalRedirect('stanfordroot.com.', '/faq', '')).toBe('https://www.stanfordroot.com/faq')
  })

  it('leaves www, previews, localhost and a missing host alone', () => {
    for (const host of ['www.stanfordroot.com', 'stanford-root-git-x.vercel.app', 'localhost:3000', 'evilstanfordroot.com', 'stanfordroot.com.evil.io', null]) {
      expect(canonicalRedirect(host, '/faq', '')).toBeNull()
    }
  })
})
