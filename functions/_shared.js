// Shared helpers for the teacher-verifier Pages Functions.

// ── Domain heuristic ─────────────────────────────────────────────────────
// Accepts emails from school-shaped domains. Heuristic, not exhaustive:
// covers the overwhelming majority of US K-12 + higher ed + many districts
// + international (.ac.uk etc.). Edge cases get pointed to manual review
// via the contact email surfaced in the API response.
//
// Anti-abuse: explicitly REJECT consumer mail providers.

const CONSUMER_BLOCKLIST = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com',
  'proton.me', 'pm.me', 'mail.com', 'gmx.com', 'tutanota.com',
  'fastmail.com', 'duck.com', 'yandex.com',
]);

const SCHOOL_PATTERNS = [
  // US higher ed + research universities
  /\.edu$/i,
  /\.edu\.[a-z]{2,3}$/i,            // .edu.au, .edu.cn etc
  // US K-12 — state subdomains
  /\.k12\.[a-z]{2}\.us$/i,          // standard NCES pattern: school.k12.tx.us
  /\.kyschools\.us$/i,              // KY exception
  // K-12 districts that don't use the standard pattern
  /\bschools?\b/i,                  // includes "schools" anywhere
  /\bdistrict\b/i,                  // district.org, etc
  /\bisd\b/i,                       // independent school district (e.g. xxx.isd.us)
  /\bcps\b/i,                       // chicago, nyc.cps, etc — false-positive risk, but ok
  /\bacademy\b/i,
  // International academia
  /\.ac\.[a-z]{2,3}$/i,             // .ac.uk, .ac.nz, etc
  /\.sch\.[a-z]{2,3}$/i,            // .sch.uk, .sch.id
];

export function classifyEmail(email) {
  const e = (email || '').trim().toLowerCase();
  // Bare-bones email shape check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, reason: 'invalid-email-format' };
  }
  const domain = e.split('@')[1];
  if (CONSUMER_BLOCKLIST.has(domain)) {
    return {
      ok: false,
      reason: 'consumer-email',
      message: 'That looks like a personal email. Use your school email so I can verify you. ' +
               "If your school doesn't issue you one, email hello@mrmags.org and I'll sort you out.",
    };
  }
  for (const pat of SCHOOL_PATTERNS) {
    if (pat.test(domain)) {
      return { ok: true, domain };
    }
  }
  return {
    ok: false,
    reason: 'not-recognized-as-school',
    message: "That domain isn't on my school-domain list. Email hello@mrmags.org and tell me " +
             'where you teach — I\'ll verify you manually within a day.',
  };
}

// ── Token generation ─────────────────────────────────────────────────────
// Simple URL-safe random tokens for verification + license.
export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── License token (HMAC, self-validating) ─────────────────────────────────
// Format: base64url(payload).base64url(hmac)  where payload is JSON
// {email, domain, verified_at, type:"teacher_free_forever"}.
// The app can validate without a network roundtrip given LICENSE_HMAC_SECRET.

function b64url(bytesOrStr) {
  let bytes;
  if (typeof bytesOrStr === 'string') bytes = new TextEncoder().encode(bytesOrStr);
  else bytes = bytesOrStr;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signLicense(payload, secret) {
  const json = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(json));
  return `${b64url(json)}.${b64url(new Uint8Array(sig))}`;
}

// ── Email via Resend ──────────────────────────────────────────────────────
export async function sendMagicLink({ to, link, apiKey }) {
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#1a1a1a;background:#fafaf7;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:6px;padding:32px">
  <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;margin:0 0 16px">Verify your teacher status</h1>
  <p style="font-size:15px;line-height:1.6;color:#444">
    Click the button below to confirm you're a teacher. Once you click,
    your forever-free Mr. Mags license is yours — no time limit, no fine print.
  </p>
  <p style="margin:32px 0">
    <a href="${link}" style="display:inline-block;padding:12px 28px;background:#8c3a2c;color:#fff;
       text-decoration:none;border-radius:3px;font-size:14px;letter-spacing:0.05em">
      Confirm I'm a Teacher
    </a>
  </p>
  <p style="font-size:13px;color:#888;line-height:1.6">
    If you didn't request this, you can ignore the email. The link expires in 24 hours.
  </p>
  <p style="font-size:13px;color:#888;line-height:1.6">
    Or copy this URL: <br>
    <span style="font-family:monospace;font-size:12px;color:#444;word-break:break-all">${link}</span>
  </p>
</div>
<p style="text-align:center;font-size:12px;color:#888;margin-top:24px">
  Mr. Mags · <a href="https://mrmags.org" style="color:#8c3a2c">mrmags.org</a> · Free for teachers, forever.
</p>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Mr. Mags <hello@mediagato.com>',
      to: [to],
      subject: 'Verify your teacher status — Mr. Mags',
      html,
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// ── JSON response helper ─────────────────────────────────────────────────
export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
