/**
 * Tool failures as data, the same contract as the Stanford Root MCP's Python
 * server: a stable `code`, a sentence, `retryable`, and a `hint`. A tool never
 * throws into the agent's turn.
 */

export class ToolFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public opts: { retryable: boolean; hint?: string; retryAfterSeconds?: number; details?: Record<string, unknown> },
  ) {
    super(message)
  }

  payload() {
    const { retryable, hint, retryAfterSeconds, details } = this.opts
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable,
        ...(retryAfterSeconds !== undefined && { retry_after_seconds: retryAfterSeconds }),
        ...(hint && { hint }),
        ...(details && { details }),
      },
    }
  }
}

export const authRequired = (message: string) =>
  new ToolFailure('auth_required', message, {
    retryable: false,
    hint: 'Reconnect Stanford Root in this app (it will ask the user to allow access again). Do not retry before then.',
  })

export const stanfordOnly = () =>
  new ToolFailure('stanford_only', 'Evaluations are only for signed-in Stanford accounts.', {
    retryable: false,
    hint: 'Tell the user this needs a @stanford.edu account.',
  })

type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }

/** Run a tool body; a ToolFailure becomes an isError result, anything else a one-line error. */
export async function asTool(fn: () => Promise<Record<string, unknown>>): Promise<ToolResult> {
  try {
    const out = await fn()
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out }
  } catch (err) {
    if (err instanceof ToolFailure) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(err.payload()) }] }
    }
    console.error('MCP tool error:', err)
    const failure = new ToolFailure('internal_error', 'Something went wrong on Stanford Root.', { retryable: true, retryAfterSeconds: 5 })
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(failure.payload()) }] }
  }
}
