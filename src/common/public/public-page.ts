// The shell for the pages a business's CUSTOMER opens from a WhatsApp link:
// the invoice page and the service record page. Server-rendered HTML with
// everything inline — they must open instantly on a cheap phone on a weak
// connection, from inside WhatsApp's browser, with nothing to install.

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderPublicPage(input: {
  title: string;
  businessName: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(input.title)} · ${esc(input.businessName)}</title>
<style>
:root{--bg:#F5F5F3;--card:#fff;--ink:#1F2624;--ink2:#4E5754;--muted:#7D8582;--rule:#E4E2DD;--teal:#0F6E6E;--tint:#E1F5F5;--warn:#B45309;--warnbg:#FEF3C7;--bad:#B42318;--badbg:#FDECEA}
@media (prefers-color-scheme: dark){:root{--bg:#0F1514;--card:#172020;--ink:#E6ECEA;--ink2:#B3BDBA;--muted:#8A9592;--rule:#2A3533;--teal:#5CC8C8;--tint:#123433;--warn:#E6C75A;--warnbg:#332A0E;--bad:#FF8A80;--badbg:#3A1714}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:20px 16px 40px}
.wrap{max-width:520px;margin:0 auto}
.biz{font-weight:700;font-size:17px}
.bizsub{color:var(--muted);font-size:13px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:16px;margin-top:14px}
h1{font-size:22px;margin:4px 0 2px}
.muted{color:var(--muted);font-size:13px}
.row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--rule)}
.row:last-child{border-bottom:0}
.row span:first-child{color:var(--ink2)}
.big{font-size:28px;font-weight:700}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px}
.ok{background:var(--tint);color:var(--teal)} .warn{background:var(--warnbg);color:var(--warn)} .bad{background:var(--badbg);color:var(--bad)}
.btn{display:block;text-align:center;text-decoration:none;font-weight:700;border-radius:12px;padding:14px;margin-top:12px}
.btn.primary{background:var(--teal);color:#fff}
.btn.ghost{border:1px solid var(--rule);color:var(--ink)}
.qr{display:block;margin:12px auto 0;width:180px;height:180px;border-radius:8px;background:#fff;padding:8px}
.photos{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.photos figure{margin:0}
.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:var(--rule)}
.photos figcaption{font-size:12px;color:var(--muted);margin-top:3px}
ul.hist{list-style:none;margin:6px 0 0;padding:0}
ul.hist li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--rule);font-size:14px}
ul.hist li:last-child{border-bottom:0}
.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:22px}
code{font-family:ui-monospace,Menlo,monospace;background:var(--tint);padding:2px 6px;border-radius:6px}
</style>
</head>
<body><div class="wrap">
${input.body}
<p class="foot">Sent by ${esc(input.businessName)} using Agla Kaam</p>
</div></body></html>`;
}

// "91 98470 12345" style digits for a wa.me link; empty when unusable.
export function waDigits(phone?: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 10 ? `91${digits}` : digits;
}
