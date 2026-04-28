/**
 * Public download stats.
 *
 * GET /api/stats → { total, last_7_days, by_file: [{filename, count, unique_ips}, ...] }
 *
 * Cached at the edge for 5 min so we don't hammer D1 on every page load.
 * Numbers are dedup'd by salted IP hash for the "unique" column.
 */

export async function onRequestGet({ env }) {
  try {
    const totals = await env.DB.prepare(
      `SELECT filename,
              COUNT(*) AS count,
              COUNT(DISTINCT ip_hash) AS unique_ips
       FROM downloads
       GROUP BY filename`
    ).all();

    const total7d = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM downloads
       WHERE downloaded_at >= datetime('now', '-7 days')`
    ).first();

    const totalAll = (totals.results || []).reduce((sum, r) => sum + r.count, 0);
    const uniqueAll = (totals.results || []).reduce((sum, r) => sum + (r.unique_ips || 0), 0);

    return new Response(
      JSON.stringify({
        total: totalAll,
        unique: uniqueAll,
        last_7_days: total7d ? total7d.count : 0,
        by_file: totals.results || [],
      }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300, stale-while-revalidate=600',
          'access-control-allow-origin': '*',
        },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
