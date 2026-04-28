/**
 * Download counter + redirect.
 *
 * GET /api/d/Mr-Mags.dmg → logs an anonymous row + 302s to cdn.mrmags.org/Mr-Mags.dmg
 *
 * Privacy: stores a salted SHA-256 of the client IP (so we can roughly
 * deduplicate without ever holding the IP itself), a 80-char user-agent
 * snippet for OS distribution stats, and CF's two-letter country code.
 * No emails, no install IDs, no content. Anyone with shell access can
 * inspect the table to confirm.
 */

const ALLOWED = new Set([
  'Mr-Mags.dmg',
  'Mr-Mags-Setup.exe',
]);

const CDN_BASE = 'https://cdn.mrmags.org';

export async function onRequestGet(context) {
  const filename = decodeURIComponent(context.params.filename || '');
  if (!ALLOWED.has(filename)) {
    return new Response('Not found', { status: 404 });
  }

  const req = context.request;
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const ua = (req.headers.get('user-agent') || '').slice(0, 80);
  const country = (req.cf && req.cf.country) || '';
  const ipHash = await sha256(ip + ':mrmags-counter-2026');

  // Best-effort insert. Never block the redirect on a logging failure —
  // the user clicked a download button, give them the file regardless.
  try {
    await context.env.DB.prepare(
      'INSERT INTO downloads (filename, ip_hash, ua_short, country) VALUES (?, ?, ?, ?)'
    ).bind(filename, ipHash, ua, country).run();
  } catch (err) {
    console.error('[counter] insert failed', err.message);
  }

  return Response.redirect(`${CDN_BASE}/${filename}`, 302);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
