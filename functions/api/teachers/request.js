// POST /api/teachers/request
//
// Body: { email: string, install_uuid?: string }
// Effect:
//   - Validates email shape + school-domain heuristic.
//   - If email already verified, returns the existing license.
//   - Otherwise creates a pending verification row + emails a magic link.
// Always returns within 1s (no waiting for email send).

import { classifyEmail, randomToken, json, sendMagicLink } from '../../_shared.js';

async function _onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'invalid-json' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  const install_uuid = (body.install_uuid || '').trim() || null;

  const cls = classifyEmail(email);
  if (!cls.ok) return json({ ok: false, ...cls }, 400);

  // Already verified? Return same status — user can re-import license without re-verifying
  const existing = await env.DB.prepare(
    'SELECT email, domain, license_token, verified_at FROM verified_teachers WHERE email = ?'
  ).bind(email).first();

  if (existing) {
    // Resend the email with the same license link, in case they lost it
    const link = `https://mrmags.org/teachers/verified?already=1&email=${encodeURIComponent(email)}`;
    // Best-effort email; don't block on it
    if (env.RESEND_API_KEY) {
      sendMagicLink({ to: email, link, apiKey: env.RESEND_API_KEY }).catch(() => {});
    }
    return json({ ok: true, status: 'already-verified', message: 'You\'re already verified! Check your email for a link to your license.' });
  }

  // New pending verification
  const token = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 24 * 60 * 60;  // 24 hours

  await env.DB.prepare(
    'INSERT INTO pending_verifications (token, email, domain, install_uuid, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(token, email, cls.domain, install_uuid, now, expires).run();

  const link = `https://mrmags.org/api/teachers/verify?token=${token}`;

  // Send magic link. If Resend fails, the user gets a friendly message and
  // we surface the error so we can fix it without leaving them stranded.
  let emailResult = { ok: true };
  if (env.RESEND_API_KEY) {
    emailResult = await sendMagicLink({ to: email, link, apiKey: env.RESEND_API_KEY });
  } else {
    return json({ ok: false, error: 'resend-not-configured' }, 500);
  }

  if (!emailResult.ok) {
    // Email send failed — clean up the pending row
    await env.DB.prepare('DELETE FROM pending_verifications WHERE token = ?').bind(token).run();
    return json({
      ok: false,
      error: 'email-send-failed',
      message: 'Couldn\'t send the verification email. Try again, or email hello@mrmags.org directly.',
      detail: emailResult.body?.slice(0, 200),
    }, 502);
  }

  return json({
    ok: true,
    status: 'pending',
    message: 'Check your school email for a verification link. It expires in 24 hours.',
  });
}

// Wrap the handler so any uncaught exception surfaces in the JSON
// response instead of bubbling up as a 502. Easier to debug live.
export async function onRequestPost(ctx) {
  try {
    return await _onRequestPost(ctx);
  } catch (e) {
    return json({
      ok: false,
      error: 'unhandled-exception',
      message: String(e && e.message || e),
      stack: String(e && e.stack || '').slice(0, 500),
    }, 500);
  }
}

// Reject other methods explicitly
export function onRequest({ request }) {
  return json({ ok: false, error: 'method-not-allowed', allowed: 'POST' }, 405);
}
