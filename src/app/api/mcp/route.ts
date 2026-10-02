import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { INSTRUCTIONS, registerTools } from '@/lib/mcp/server'
import { verifyToken } from '@/lib/mcp/auth'

/**
 * The hosted Stanford Root MCP server. Paste https://www.stanfordroot.com/api/mcp
 * into Claude (Settings > Connectors) or `claude mcp add --transport http`; the
 * client finds the authorization server from the protected resource metadata,
 * the user signs in and approves on /oauth/consent, and every call carries
 * their token. Same tools and contract as the stdio server in the class repo.
 */
const mcp = createMcpHandler(server => registerTools(server), {
  serverInfo: { name: 'stanford-root', version: '1.0.0' },
  instructions: INSTRUCTIONS,
})

const handler = withMcpAuth(mcp, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource/api/mcp',
})

export const maxDuration = 60
export { handler as GET, handler as POST, handler as DELETE }
