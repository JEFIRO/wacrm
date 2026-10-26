// Who may open the SaaS owner's panel — docs/saas/b6-painel.md.
// Decided on the server only: PLATFORM_ADMIN_EMAILS (comma-separated).
import { createClient } from '@/lib/supabase/server'

export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  return !!email && platformAdminEmails().includes(email.toLowerCase())
}

/** The signed-in platform admin's e-mail, or null (not signed in / not admin). */
export async function currentPlatformAdmin(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const email = data.user?.email ?? null
  return isPlatformAdminEmail(email) ? email : null
}
