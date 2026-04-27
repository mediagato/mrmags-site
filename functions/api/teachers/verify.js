// GET /api/teachers/verify?token=XXX
//
// Looks up the pending verification, marks the email verified, issues a
// signed forever-free license, and redirects to /teachers/verified with the
// license attached as a query param so the user lands on a success page
// they can copy-from / forward / paste into the Mr. Mags app later.

import { randomToken, signLicense } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return Response.redirect('https://mrmags.org/teachers?error=missing-token', 302);

  const now = Math.floor(Date.now() / 1000);

  // Look up pending
  const pending = await env.DB.prepare(
    'SELECT email, domain, install_uuid, expires_at FROM pending_verifications WHERE token = ?'
  ).bind(token).first();

  if (!pending) return Response.redirect('https://mrmags.org/teachers?error=invalid-or-used', 302);
  if (pending.expires_at < now) {
    await env.DB.prepare('DELETE FROM pending_verifications WHERE token = ?').bind(token).run();
    return Response.redirect('https://mrmags.org/teachers?error=expired', 302);
  }

  // Already verified path — defensive: if somehow the email is already in
  // verified_teachers, just hand back the existing license
  const existing = await env.DB.prepare(
    'SELECT license_token FROM verified_teachers WHERE email = ?'
  ).bind(pending.email).first();

  if (existing) {
    await env.DB.prepare('DELETE FROM pending_verifications WHERE token = ?').bind(token).run();
    return Response.redirect(
      `https://mrmags.org/teachers/verified?license=${encodeURIComponent(existing.license_token)}&email=${encodeURIComponent(pending.email)}`,
      302
    );
  }

  // Issue a new self-validating license
  const payload = {
    email: pending.email,
    domain: pending.domain,
    type: 'teacher_free_forever',
    verified_at: now,
    v: 1,
  };
  const license = await signLicense(payload, env.LICENSE_HMAC_SECRET || 'unset-secret');

  // Persist
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO verified_teachers (email, domain, license_token, install_uuid, verified_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(pending.email, pending.domain, license, pending.install_uuid, now, now),
    env.DB.prepare('DELETE FROM pending_verifications WHERE token = ?').bind(token),
  ]);

  // Redirect to the success page with the license embedded so the user can
  // copy it / forward the email / paste into the app whenever they want.
  return Response.redirect(
    `https://mrmags.org/teachers/verified?license=${encodeURIComponent(license)}&email=${encodeURIComponent(pending.email)}`,
    302
  );
}
