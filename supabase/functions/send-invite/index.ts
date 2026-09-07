// Sends an invite email through Resend. Called by the operator console after
// an invite is created; the app falls back to "copy the link" if this fails.
//
// Deploy:   supabase functions deploy send-invite
// Secrets:  supabase secrets set RESEND_API_KEY=re_... INVITE_FROM="Smart Ink <invites@yourdomain>" SITE_URL=https://beta.yourdomain
//
// The caller must be a signed-in admin: the request's JWT is forwarded to a
// Supabase client and checked with the same is_admin() the database uses.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('INVITE_FROM');
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  if (!resendKey || !from || !siteUrl) {
    return json(500, { error: 'send-invite is missing RESEND_API_KEY, INVITE_FROM or SITE_URL.' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: isAdmin, error: adminErr } = await supabase.rpc('is_admin');
  if (adminErr || !isAdmin) return json(403, { error: 'Operator access required.' });

  let code = '';
  try {
    const body = (await req.json()) as { code?: string };
    code = (body.code ?? '').trim().toUpperCase();
  } catch {
    return json(400, { error: 'Expected JSON { code }.' });
  }
  if (!code) return json(400, { error: 'Missing invite code.' });

  const { data: invite, error: inviteErr } = await supabase
    .from('invites')
    .select('code, email, expires_at, redeemed_at')
    .eq('code', code)
    .maybeSingle();
  if (inviteErr) return json(500, { error: inviteErr.message });
  if (!invite) return json(404, { error: 'Invite not found.' });
  if (!invite.email) return json(400, { error: 'This invite has no email; copy the link instead.' });
  if (invite.redeemed_at) return json(400, { error: 'This invite was already used.' });

  const link = `${siteUrl}/?invite=${encodeURIComponent(invite.code)}`;
  const expires = new Date(invite.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

  const html = `
    <p>You're invited to the Smart Ink private beta.</p>
    <p><a href="${link}">Accept your invite</a> — it's reserved for ${escapeHtml(invite.email)} and works until ${expires}.</p>
    <p>If the link doesn't open, enter the code <strong>${invite.code}</strong> at ${escapeHtml(siteUrl)}.</p>
    <p>Reply to this email if anything is unclear. We read every message.</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [invite.email],
      subject: 'Your Smart Ink beta invite',
      html,
      text: `You're invited to the Smart Ink private beta.\n\nAccept your invite: ${link}\nCode: ${invite.code} (valid until ${expires})\n`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return json(502, { error: `Resend rejected the email (${res.status}): ${detail.slice(0, 300)}` });
  }

  return json(200, { sent: true, to: invite.email });
});
