/** True on the read-only shared schedule (/s), whose viewer is not the owner. */
export function isSharedSchedulePath(pathname: string | null | undefined): boolean {
  return pathname === '/s' || Boolean(pathname?.startsWith('/s/'))
}
