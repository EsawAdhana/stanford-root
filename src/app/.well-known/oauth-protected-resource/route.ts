import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler'
import { AUTH_SERVER } from '@/lib/mcp/auth'

// RFC 9728 metadata for /api/mcp: tells MCP clients that Stanford Root's
// Supabase OAuth server issues the tokens this resource accepts.
const handler = (req: Request) => protectedResourceHandler({ authServerUrls: [AUTH_SERVER()] })(req)
const options = metadataCorsOptionsRequestHandler()

export { handler as GET, options as OPTIONS }
