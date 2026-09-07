# Hosted beta gate on Supabase

The app's beta gate (waitlist, invites, sign-in, operator console) runs on
Supabase once two environment variables are set. Without them, development
falls back to a browser-local demo gate and production builds disable sign-in.

What lives where:

| Piece | Where |
| --- | --- |
| Tables, row-level security, RPCs | `supabase/migrations/20260907120000_beta_gate.sql` |
| Invite email (Resend) | `supabase/functions/send-invite/index.ts` |
| Client | `src/auth/supabaseBackend.ts` behind `src/auth/betaAuthService.ts` |

Identity and access are separate on purpose. Supabase Auth will sign in any
Google account or any address that asks for a code; the app then calls
`my_access()` and only proceeds when that email's waitlist row is `active`.
Everyone else is signed out again with a reason.

## 1. Create the project

1. [supabase.com](https://supabase.com) → New project. Pick the EU region
   closest to your testers (the render server is in `europe-west4`).
2. Project settings → API: copy the **Project URL** and the **anon public**
   key. They are safe to ship in the browser; the database only lets them
   through the RPCs and RLS policies in the migration.

## 2. Apply the schema

Either paste the migration into the SQL editor and run it, or use the CLI:

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

`supabase link` writes `supabase/config.toml`; commit it.

## 3. Enable sign-in methods

Authentication → Providers:

- **Email**: on. Under Email templates, the *Magic Link* template must include
  `{{ .Token }}` so people receive a 6-digit code rather than only a link.
  The app calls `verifyOtp` with that code.
- **Google**: on. Create an OAuth client in Google Cloud Console (Web
  application), add Supabase's callback URL from the provider page as an
  authorised redirect URI, and paste the client id and secret into Supabase.

Authentication → URL configuration:

- **Site URL**: where the app is hosted, e.g. `https://beta.yourdomain`.
- **Redirect URLs**: add the same origin, plus `http://localhost:5173` for
  development. The app redirects back to `window.location.origin`.

## 4. Configure the app

Add to `.env.production` (and `.env.local` for development):

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Rebuild and deploy. The landing form now writes straight into `waitlist`;
`VITE_WAITLIST_ENDPOINT` is no longer needed.

## 5. Make yourself an operator

Sign in once so your profile row exists, then in the SQL editor:

```sql
update public.profiles set is_admin = true where email = 'you@studio.com';
```

Reload `/?admin=1`. The console lists the waitlist, invites, and active
accounts, and can approve, mint, and revoke.

Your own first sign-in needs an invite too (the gate applies to everyone).
Mint one from SQL before you have the console:

```sql
select public.admin_create_invite('you@studio.com', 'bootstrap');
```

That function checks `is_admin()`, so run it as the `postgres` role in the SQL
editor (which bypasses the check) — the SQL editor runs as `postgres` by
default. Then open `/?invite=<code>`.

## 6. Invite emails (optional but recommended)

Without this, approving someone copies an invite link to your clipboard and
you send it by hand.

1. Create a [Resend](https://resend.com) account and verify your sending
   domain.
2. Deploy the function and its secrets:

```bash
supabase functions deploy send-invite
supabase secrets set RESEND_API_KEY=re_... INVITE_FROM="Smart Ink <invites@yourdomain>" SITE_URL=https://beta.yourdomain
```

The console calls it after every approve or mint that has an email. If the
call fails the console says so and the link is still copied.

## Checks before inviting anyone

- Sign out, request access from the landing page with a throwaway address,
  and confirm it appears under Waitlist in `/?admin=1`.
- Approve it, open the invite link in a private window on another device,
  accept, sign in with the emailed code, and land in the scene list.
- Try the code flow with an address that was never invited: the login page
  must refuse before any email is sent.
- Sign in with Google using an uninvited account: you should be bounced back
  to the login page with "No beta access for this email".
- Revoke the throwaway account and confirm it can no longer sign in.
