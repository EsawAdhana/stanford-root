/**
 * Canonical site origin, used for metadataBase, canonical URLs, sitemap, and
 * robots. Set NEXT_PUBLIC_SITE_URL to override (no trailing slash); defaults to
 * the production custom domain. Vercel serves the site from www and answers
 * the apex with a 308 to www, so the default is the www host: a canonical or
 * sitemap URL on the apex would point search engines at a redirect.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.stanfordroot.com'
).replace(/\/+$/, '')

/**
 * The privacy policy and terms URLs as registered on the Google OAuth consent
 * screen. Google checks that the policy link on the site is the same string as
 * the one configured there, and those entries use the apex host, so these stay
 * on the apex (it redirects to www) rather than following SITE_URL. Change them
 * only together with the consent screen config in Google Cloud.
 */
export const GOOGLE_CONSENT_PRIVACY_URL = 'https://stanfordroot.com/privacy'
export const GOOGLE_CONSENT_TERMS_URL = 'https://stanfordroot.com/terms'
