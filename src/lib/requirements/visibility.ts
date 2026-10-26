/**
 * Whether the degree requirements page is open to the public. It stays off
 * in production until it is ready; local development always shows it, and
 * NEXT_PUBLIC_REQUIREMENTS=1 turns it on for a deployment.
 */
export const REQUIREMENTS_PUBLIC = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_REQUIREMENTS === '1'
