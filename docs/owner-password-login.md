# Owner access without email delivery

Hosted login now has **Sign in with a password**. Passwords go directly to Supabase Auth; the existing `my_access()` check still requires active beta membership, and admin privileges still come only from `profiles.is_admin`. Password login itself never promotes an account. The development-only `admin` shortcut remains unavailable on the live site.

1. In Supabase → Authentication → Users, choose Add user → Create new user.
2. Enter the owner's email and a unique password directly in Supabase. Enable Auto Confirm User for this owner account, then create it. Do not paste passwords into chat, SQL, source code or build variables. If the account already exists, update that account through Supabase's supported account management instead of creating a duplicate.
3. In the SQL editor, run `supabase/operator/promote-owner.sql` after replacing its placeholder email with the owner email. This explicitly grants the account the existing admin role and active beta access. It refuses accounts without a password and confirmed email. It is an operator action, not a migration for every deployment.
4. On the stable beta site, choose Log in → Sign in with a password. Enter the same email and password. Admin tools become available after the database role check; rendering still requires the real user session and applies ordinary job limits.

The owner can approve or revoke beta users and create invites. Scene and render storage remain private to each owner. Email confirmation settings for everyone else remain unchanged. Restore email delivery before relying on emailed password recovery.

To remove operator privileges, set `profiles.is_admin=false` for the specific owner's `user_id`. Revoke beta access separately if the account should also lose application/render access.
