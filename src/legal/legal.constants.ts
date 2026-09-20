const STYLE = `
  :root {
    --bg: #F1F4F3;
    --surface: #FFFFFF;
    --ink: #10282A;
    --ink-soft: #3E5A5C;
    --ink-faint: #6C8482;
    --border: #D8E2E0;
    --accent: #C65A28;
    --accent-soft: #F3E4DA;
    --link: #106661;
    --brand: #012A30;
    --brand-ink: #EAF1EF;
    --brand-soft: #9FC3BE;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #081A1C;
      --surface: #0E2427;
      --ink: #EDF3F2;
      --ink-soft: #A9C2C0;
      --ink-faint: #6E8987;
      --border: #1E3B3D;
      --accent: #E8834A;
      --accent-soft: #2A1A12;
      --link: #5FC2BC;
      --brand: #04191C;
      --brand-ink: #EAF1EF;
      --brand-soft: #6FA39C;
    }
  }
  :root[data-theme="dark"] {
    --bg: #081A1C;
    --surface: #0E2427;
    --ink: #EDF3F2;
    --ink-soft: #A9C2C0;
    --ink-faint: #6E8987;
    --border: #1E3B3D;
    --accent: #E8834A;
    --accent-soft: #2A1A12;
    --link: #5FC2BC;
    --brand: #04191C;
    --brand-ink: #EAF1EF;
    --brand-soft: #6FA39C;
  }

  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 16.5px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .masthead {
    background: var(--brand);
    color: var(--brand-ink);
    padding: 2.6rem 1.5rem 2.2rem;
  }
  .masthead-inner { max-width: 920px; margin: 0 auto; }
  .wordmark {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.78rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--brand-soft);
    margin: 0 0 1.6rem;
  }
  .wordmark .mark {
    width: 22px; height: 22px;
    border-radius: 6px;
    background: linear-gradient(135deg, #1C7A78, var(--accent));
    flex: none;
  }
  .doc-title {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: clamp(2.1rem, 5vw, 2.9rem);
    line-height: 1.08;
    letter-spacing: -0.01em;
    text-wrap: balance;
    margin: 0 0 0.9rem;
  }
  .doc-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.4rem;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.82rem;
    color: var(--brand-soft);
  }
  .doc-meta strong { color: var(--brand-ink); font-weight: 500; }
  .doc-nav-links {
    margin-top: 1.5rem;
    display: flex;
    gap: 1.3rem;
    font-size: 0.9rem;
  }
  .doc-nav-links a { color: var(--brand-ink); opacity: 0.82; }
  .doc-nav-links a[aria-current="page"] { opacity: 1; border-bottom: 1px solid var(--accent); padding-bottom: 2px; }
  .doc-nav-links a:hover { opacity: 1; }

  .layout {
    max-width: 920px;
    margin: 0 auto;
    padding: 2.6rem 1.5rem 5rem;
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 3rem;
    align-items: start;
  }
  @media (max-width: 760px) {
    .layout { grid-template-columns: 1fr; gap: 2rem; }
  }

  .toc {
    position: sticky;
    top: 1.5rem;
    font-size: 0.86rem;
  }
  .toc-label {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin: 0 0 0.9rem;
  }
  .toc ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; }
  .toc a {
    color: var(--ink-soft);
    text-decoration: none;
    display: block;
    border-left: 2px solid var(--border);
    padding-left: 0.7rem;
  }
  .toc a:hover { color: var(--ink); border-left-color: var(--accent); }
  @media (max-width: 760px) {
    .toc { position: static; }
    .toc ol { flex-direction: row; flex-wrap: wrap; gap: 0.5rem 1rem; }
    .toc a { border-left: none; padding-left: 0; padding-bottom: 2px; border-bottom: 2px solid var(--border); }
  }

  main { min-width: 0; }

  .summary {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    padding: 1.3rem 1.5rem;
    margin: 0 0 2.6rem;
  }
  .summary-label {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 0.7rem;
  }
  .summary ul { margin: 0; padding-left: 1.15rem; display: flex; flex-direction: column; gap: 0.45rem; }
  .summary li { color: var(--ink-soft); max-width: 62ch; }
  .summary strong { color: var(--ink); font-weight: 600; }

  section { margin: 0 0 2.4rem; scroll-margin-top: 1.5rem; }
  section:last-of-type { margin-bottom: 0; }
  h2 {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: 1.5rem;
    letter-spacing: -0.005em;
    text-wrap: balance;
    display: flex;
    align-items: baseline;
    gap: 0.65rem;
    margin: 0 0 0.9rem;
    padding-top: 1.6rem;
    border-top: 1px solid var(--border);
  }
  section:first-of-type h2 { border-top: none; padding-top: 0; }
  h2 .num {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.95rem;
    color: var(--ink-faint);
    font-weight: 500;
  }
  p { margin: 0 0 0.95rem; max-width: 68ch; color: var(--ink); }
  p:last-child { margin-bottom: 0; }
  section p.lede { color: var(--ink-soft); }

  .sub {
    margin: 1.1rem 0 0;
    padding-left: 1.1rem;
    border-left: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .sub-item h3 {
    font-family: 'Source Sans 3', sans-serif;
    font-weight: 600;
    font-size: 1rem;
    margin: 0 0 0.3rem;
  }
  .sub-item p { max-width: 62ch; color: var(--ink-soft); }

  .provider-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.8rem;
    margin: 1.2rem 0;
  }
  .provider {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.85rem 1rem;
  }
  .provider .name { font-weight: 600; font-size: 0.94rem; }
  .provider .role { color: var(--ink-soft); font-size: 0.86rem; margin-top: 0.15rem; }

  .fact-line {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  .fact-line:last-child { border-bottom: none; }
  .fact-line .k { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 0.78rem; color: var(--ink-faint); min-width: 8.5rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .fact-line .v { color: var(--ink); }

  footer {
    background: var(--brand);
    color: var(--brand-ink);
    margin-top: 3rem;
    padding: 2.4rem 1.5rem 2.6rem;
  }
  .footer-inner { max-width: 920px; margin: 0 auto; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1.6rem; }
  .footer-block .label {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--brand-soft);
    margin: 0 0 0.5rem;
  }
  .footer-block p { color: var(--brand-ink); opacity: 0.92; margin: 0 0 0.2rem; max-width: 30ch; }
  .footer-block a { color: var(--brand-ink); }

  ::selection { background: var(--accent-soft); color: var(--ink); }
`;

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Agla Kaam</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Source+Sans+3:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>${STYLE}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

const PRIVACY_POLICY_BODY = `
<div class="masthead">
  <div class="masthead-inner">
    <p class="wordmark"><span class="mark"></span> Agla Kaam · by VeloCrew</p>
    <h1 class="doc-title">Privacy Policy</h1>
    <div class="doc-meta">
      <span>Effective <strong>1 September 2026</strong></span>
      <span>Operated by <strong>VeloCrew</strong> (UDYAM&#8209;KL&#8209;13&#8209;0110771)</span>
    </div>
    <nav class="doc-nav-links">
      <a href="#" aria-current="page">Privacy Policy</a>
      <a href="terms-of-service">Terms of Service</a>
      <a href="delete-account">Delete My Data</a>
    </nav>
  </div>
</div>

<div class="layout">
  <nav class="toc" aria-label="Sections">
    <p class="toc-label">On this page</p>
    <ol>
      <li><a href="#collect">1. What we collect</a></li>
      <li><a href="#use">2. How we use it</a></li>
      <li><a href="#controller">3. Who controls what</a></li>
      <li><a href="#share">4. Who we share it with</a></li>
      <li><a href="#retain">5. How long we keep it</a></li>
      <li><a href="#rights">6. Your rights</a></li>
      <li><a href="#transfer">7. Where it's processed</a></li>
      <li><a href="#children">8. Children</a></li>
      <li><a href="#changes">9. Changes</a></li>
      <li><a href="#contact">10. Contact</a></li>
    </ol>
  </nav>

  <main>
    <div class="summary">
      <p class="summary-label">In plain terms</p>
      <ul>
        <li><strong>You own your customer data.</strong> We store it on your behalf; we don't use it for anything else.</li>
        <li><strong>We ask for permissions only when a feature needs them</strong> &mdash; contacts, location, and photos are never accessed in the background.</li>
        <li><strong>No analytics, no ad trackers, no data selling.</strong> Agla Kaam has none integrated.</li>
        <li><strong>Deleting your account deletes your data immediately</strong> &mdash; customers, services, invoices, quotations, everything.</li>
      </ul>
    </div>

    <section id="collect">
      <h2><span class="num">01</span> What we collect</h2>
      <p class="lede">We collect four kinds of information, each tied to a specific purpose.</p>
      <div class="sub">
        <div class="sub-item">
          <h3>Account &amp; business information</h3>
          <p>Your name, business name, trade type, phone number, email address, and password &mdash; stored as an irreversible hash, never in plain text &mdash; or your Google account identifier if you sign in with Google. Also your GSTIN, business address, and any logo or signature image you upload.</p>
        </div>
        <div class="sub-item">
          <h3>Customer information you add</h3>
          <p>When you add a customer to run your business: their name, phone number, address, and &mdash; only if you choose to capture it while logging a service &mdash; their location coordinates and when they were captured.</p>
        </div>
        <div class="sub-item">
          <h3>Team member information</h3>
          <p>If you add technicians to your account: their name, email address, and password (hashed, never in plain text).</p>
        </div>
        <div class="sub-item">
          <h3>Payment information</h3>
          <p>Subscription payments are handled directly by Razorpay. We store only Razorpay's order and payment reference IDs, the plan, amount, and status &mdash; never your card, UPI, or bank details.</p>
        </div>
        <div class="sub-item">
          <h3>Device permissions &mdash; only when the feature is used</h3>
          <p><strong>Contacts:</strong> read-only, only when you tap &ldquo;Choose from contacts&rdquo; to fill in a customer's name and number. We never create, edit, or delete anything in your phone's contacts.<br>
          <strong>Location:</strong> only when you tap &ldquo;Capture location&rdquo; while logging a service &mdash; requested in the foreground, one time per tap. Never in the background, never continuously.<br>
          <strong>Photos:</strong> only when you choose an image from your library for your business logo or signature. We never access your camera.</p>
        </div>
      </div>
    </section>

    <section id="use">
      <h2><span class="num">02</span> How we use it</h2>
      <p>To run the core features of Agla Kaam &mdash; tracking your customers and their service history, sending you reminders, generating invoice and quotation PDFs, and managing your subscription. To send you a one-time password reset code by email, if you request one. To process payments through Razorpay for paid plans.</p>
      <p>When you send a reminder over WhatsApp, we build the message text and open your own WhatsApp app with it pre-filled &mdash; you choose to send it. We never send WhatsApp messages ourselves, and we don't use Meta's WhatsApp Business API.</p>
    </section>

    <section id="controller">
      <h2><span class="num">03</span> Who controls what</h2>
      <p>For your own account information &mdash; name, email, business details &mdash; Agla Kaam is the <strong>data controller</strong>.</p>
      <p>For the information you enter about your customers, <strong>you are the data controller</strong> &mdash; you decide what to collect and why. Agla Kaam acts as a <strong>data processor</strong>, storing and displaying that information on your instructions.</p>
    </section>

    <section id="share">
      <h2><span class="num">04</span> Who we share it with</h2>
      <p class="lede">Only the providers that make Agla Kaam work, each bound to process data solely for that purpose. We do not sell data, and we have no analytics, advertising, or tracking services integrated &mdash; none.</p>
      <div class="provider-grid">
        <div class="provider"><div class="name">MongoDB Atlas</div><div class="role">Database hosting for all app data</div></div>
        <div class="provider"><div class="name">Amazon S3</div><div class="role">Logo &amp; signature images &middot; Mumbai (ap-south-1)</div></div>
        <div class="provider"><div class="name">Razorpay</div><div class="role">Subscription payment processing</div></div>
        <div class="provider"><div class="name">Google</div><div class="role">Sign-in authentication only &mdash; no Maps, no Analytics</div></div>
        <div class="provider"><div class="name">Our email provider</div><div class="role">Delivers password reset codes</div></div>
      </div>
    </section>

    <section id="retain">
      <h2><span class="num">05</span> How long we keep it</h2>
      <p>We keep your data for as long as your account is active. If you delete your account &mdash; from Settings, or by writing to us &mdash; we permanently delete your business profile, every customer record, service history, invoice, quotation, team member, and uploaded image <strong>immediately</strong>. This is not a soft delete or a holding period. Routine backups may retain a copy for a short operational window before they cycle out.</p>
    </section>

    <section id="rights">
      <h2><span class="num">06</span> Your rights</h2>
      <p>You can access, correct, or export most of your data directly in the app. You can also write to <a href="mailto:admin@velocrew.in">admin@velocrew.in</a> to request access, correction, export, or deletion of your data, or to raise any privacy concern &mdash; we'll respond as soon as we reasonably can.</p>
    </section>

    <section id="transfer">
      <h2><span class="num">07</span> Where your data is processed</h2>
      <p>Our service providers may process data on infrastructure located outside India as well as within it. Where that happens, we rely on providers that maintain appropriate contractual and security safeguards.</p>
    </section>

    <section id="children">
      <h2><span class="num">08</span> Children</h2>
      <p>Agla Kaam is a business tool for service technicians and isn't directed at anyone under 18. We don't knowingly collect data from children.</p>
    </section>

    <section id="changes">
      <h2><span class="num">09</span> Changes to this policy</h2>
      <p>If we make a material change, we'll update the effective date above and, where appropriate, let you know in the app.</p>
    </section>

    <section id="contact">
      <h2><span class="num">10</span> Contact &amp; grievances</h2>
      <p>For any question, request, or complaint about how we handle your data, contact us using the details below.</p>
      <div class="fact-line"><span class="k">Entity</span><span class="v">VeloCrew &middot; UDYAM-KL-13-0110771</span></div>
      <div class="fact-line"><span class="k">Address</span><span class="v">Chittilappilly House, Thrissur, Puzhakkal Block Panchayat, Thrissur District, Kerala 680552, India</span></div>
      <div class="fact-line"><span class="k">Email</span><span class="v"><a href="mailto:admin@velocrew.in">admin@velocrew.in</a></span></div>
      <div class="fact-line"><span class="k">Phone</span><span class="v"><a href="tel:+919562994337">+91 95629 94337</a></span></div>
    </section>
  </main>
</div>

<footer>
  <div class="footer-inner">
    <div class="footer-block">
      <p class="label">Agla Kaam</p>
      <p>A product of VeloCrew</p>
      <p>UDYAM-KL-13-0110771</p>
    </div>
    <div class="footer-block">
      <p class="label">Registered office</p>
      <p>Chittilappilly House, Thrissur</p>
      <p>Puzhakkal Block Panchayat</p>
      <p>Thrissur District, Kerala 680552, India</p>
    </div>
    <div class="footer-block">
      <p class="label">Contact</p>
      <p><a href="mailto:admin@velocrew.in">admin@velocrew.in</a></p>
      <p><a href="tel:+919562994337">+91 95629 94337</a></p>
    </div>
  </div>
</footer>
`;

const TERMS_OF_SERVICE_BODY = `
<div class="masthead">
  <div class="masthead-inner">
    <p class="wordmark"><span class="mark"></span> Agla Kaam · by VeloCrew</p>
    <h1 class="doc-title">Terms of Service</h1>
    <div class="doc-meta">
      <span>Effective <strong>1 September 2026</strong></span>
      <span>Operated by <strong>VeloCrew</strong> (UDYAM&#8209;KL&#8209;13&#8209;0110771)</span>
    </div>
    <nav class="doc-nav-links">
      <a href="privacy-policy">Privacy Policy</a>
      <a href="#" aria-current="page">Terms of Service</a>
      <a href="delete-account">Delete My Data</a>
    </nav>
  </div>
</div>

<div class="layout">
  <nav class="toc" aria-label="Sections">
    <p class="toc-label">On this page</p>
    <ol>
      <li><a href="#about">1. About Agla Kaam</a></li>
      <li><a href="#eligibility">2. Eligibility</a></li>
      <li><a href="#account">3. Your account</a></li>
      <li><a href="#billing">4. Plans &amp; billing</a></li>
      <li><a href="#use">5. Acceptable use</a></li>
      <li><a href="#data">6. Your data</a></li>
      <li><a href="#termination">7. Termination</a></li>
      <li><a href="#disclaimers">8. Disclaimers</a></li>
      <li><a href="#liability">9. Liability</a></li>
      <li><a href="#changes">10. Changes</a></li>
      <li><a href="#law">11. Governing law</a></li>
      <li><a href="#contact">12. Contact</a></li>
    </ol>
  </nav>

  <main>
    <div class="summary">
      <p class="summary-label">In plain terms</p>
      <ul>
        <li><strong>Agla Kaam helps you run a service business</strong> &mdash; customers, reminders, invoices, and quotations.</li>
        <li><strong>Plans don't auto-renew.</strong> You choose when to pay, in INR, through Razorpay.</li>
        <li><strong>Your business and customer data stays yours</strong> &mdash; we're just storing and processing it for you.</li>
        <li><strong>You can leave anytime</strong> &mdash; deleting your account deletes your data immediately.</li>
      </ul>
    </div>

    <section id="about">
      <h2><span class="num">01</span> About Agla Kaam</h2>
      <p>Agla Kaam is a mobile app, operated by VeloCrew, that helps solo service technicians and small teams track customers, log services, send reminders, and create invoices and quotations. By using the app, you agree to these terms.</p>
    </section>

    <section id="eligibility">
      <h2><span class="num">02</span> Eligibility</h2>
      <p>You must be at least 18 years old and able to enter into a binding contract to use Agla Kaam. You're using the app on behalf of a business &mdash; yours, or one you're authorized to represent.</p>
    </section>

    <section id="account">
      <h2><span class="num">03</span> Your account</h2>
      <p>You can create an account with an email and password, or by signing in with Google. You're responsible for keeping your login details secure and for everything that happens under your account. If you add technicians to your team, you're responsible for their access and conduct within the app.</p>
    </section>

    <section id="billing">
      <h2><span class="num">04</span> Plans &amp; billing</h2>
      <p>Agla Kaam offers a free plan with usage limits, and paid plans &mdash; Invoicing, Combo, and an optional Team add-on &mdash; billed in INR. Paid plans are processed securely through Razorpay and are valid for the period shown at checkout. We'll show you the current price before you pay, and plans don't renew automatically &mdash; you renew when you're ready to keep paid features active. Prices and plan limits may change; changes won't apply to a period you've already paid for.</p>
    </section>

    <section id="use">
      <h2><span class="num">05</span> Acceptable use</h2>
      <p>You agree not to use Agla Kaam to store or process data you don't have the right to hold, to interfere with the app's operation, or to use it for any unlawful purpose. You're responsible for the accuracy of the business and customer data you enter.</p>
    </section>

    <section id="data">
      <h2><span class="num">06</span> Your data</h2>
      <p>You own the business and customer data you enter into Agla Kaam. We process it on your behalf to provide the service, as described in our <a href="privacy-policy">Privacy Policy</a>.</p>
    </section>

    <section id="termination">
      <h2><span class="num">07</span> Termination</h2>
      <p>You can delete your account at any time from Settings &mdash; this permanently and immediately removes your business, customer, and service data. We may suspend or terminate accounts that breach these terms, don't pay for a paid plan, or misuse the service.</p>
    </section>

    <section id="disclaimers">
      <h2><span class="num">08</span> Disclaimers</h2>
      <p>Agla Kaam is provided &ldquo;as is.&rdquo; We work to keep it reliable, but we don't guarantee uninterrupted or error-free service, and we're not responsible for decisions you make based on data in the app &mdash; for example, a reminder missed due to a device or network issue.</p>
    </section>

    <section id="liability">
      <h2><span class="num">09</span> Limitation of liability</h2>
      <p>To the extent permitted by law, VeloCrew's liability for any claim relating to Agla Kaam is limited to the amount you paid us in the 12 months before the claim arose.</p>
    </section>

    <section id="changes">
      <h2><span class="num">10</span> Changes to these terms</h2>
      <p>We may update these terms from time to time. We'll update the effective date above when we do.</p>
    </section>

    <section id="law">
      <h2><span class="num">11</span> Governing law</h2>
      <p>These terms are governed by the laws of India. Courts at Thrissur, Kerala have exclusive jurisdiction over any dispute, except where mandatory consumer-protection law gives you the right to bring a claim elsewhere.</p>
    </section>

    <section id="contact">
      <h2><span class="num">12</span> Contact</h2>
      <p>Questions about these terms? Reach us using the details below.</p>
      <div class="fact-line"><span class="k">Entity</span><span class="v">VeloCrew &middot; UDYAM-KL-13-0110771</span></div>
      <div class="fact-line"><span class="k">Address</span><span class="v">Chittilappilly House, Thrissur, Puzhakkal Block Panchayat, Thrissur District, Kerala 680552, India</span></div>
      <div class="fact-line"><span class="k">Email</span><span class="v"><a href="mailto:admin@velocrew.in">admin@velocrew.in</a></span></div>
      <div class="fact-line"><span class="k">Phone</span><span class="v"><a href="tel:+919562994337">+91 95629 94337</a></span></div>
    </section>
  </main>
</div>

<footer>
  <div class="footer-inner">
    <div class="footer-block">
      <p class="label">Agla Kaam</p>
      <p>A product of VeloCrew</p>
      <p>UDYAM-KL-13-0110771</p>
    </div>
    <div class="footer-block">
      <p class="label">Registered office</p>
      <p>Chittilappilly House, Thrissur</p>
      <p>Puzhakkal Block Panchayat</p>
      <p>Thrissur District, Kerala 680552, India</p>
    </div>
    <div class="footer-block">
      <p class="label">Contact</p>
      <p><a href="mailto:admin@velocrew.in">admin@velocrew.in</a></p>
      <p><a href="tel:+919562994337">+91 95629 94337</a></p>
    </div>
  </div>
</footer>
`;

const DELETE_ACCOUNT_BODY = `
<div class="masthead">
  <div class="masthead-inner">
    <p class="wordmark"><span class="mark"></span> Agla Kaam · by VeloCrew</p>
    <h1 class="doc-title">Delete Your Account or Data</h1>
    <div class="doc-meta">
      <span>Effective <strong>2 September 2026</strong></span>
      <span>Operated by <strong>VeloCrew</strong> (UDYAM&#8209;KL&#8209;13&#8209;0110771)</span>
    </div>
    <nav class="doc-nav-links">
      <a href="privacy-policy">Privacy Policy</a>
      <a href="terms-of-service">Terms of Service</a>
      <a href="#" aria-current="page">Delete My Data</a>
    </nav>
  </div>
</div>

<div class="layout">
  <nav class="toc" aria-label="Sections">
    <p class="toc-label">On this page</p>
    <ol>
      <li><a href="#in-app">1. Delete in the app</a></li>
      <li><a href="#by-email">2. Request by email</a></li>
      <li><a href="#partial">3. Delete only some data</a></li>
      <li><a href="#what-happens">4. What's deleted &amp; what's kept</a></li>
      <li><a href="#contact">5. Contact</a></li>
    </ol>
  </nav>

  <main>
    <div class="summary">
      <p class="summary-label">In plain terms</p>
      <ul>
        <li><strong>Delete your account any time</strong> from the app's menu &mdash; no need to contact us.</li>
        <li><strong>No app installed?</strong> Email us and we'll delete it for you.</li>
        <li><strong>Deletion is immediate and permanent</strong> &mdash; not a holding period, not a soft delete.</li>
        <li>You can also ask us to delete <strong>specific</strong> data &mdash; a customer, an invoice &mdash; without deleting your whole account.</li>
      </ul>
    </div>

    <section id="in-app">
      <h2><span class="num">01</span> Delete in the app</h2>
      <p>Open Agla Kaam, open the menu, and tap <strong>Delete account</strong>. Confirm once more when asked. Your business profile and everything tied to it is removed immediately &mdash; you'll be signed out right after.</p>
    </section>

    <section id="by-email">
      <h2><span class="num">02</span> Request by email</h2>
      <p>If you no longer have the app installed, or would rather not do it yourself, email <a href="mailto:admin@velocrew.in">admin@velocrew.in</a> from the address registered on your account and ask us to delete it. Include your business name so we can find the right account. We'll confirm once it's done.</p>
    </section>

    <section id="partial">
      <h2><span class="num">03</span> Delete only some data</h2>
      <p>You don't have to delete your whole account to remove something. Individual customers, services, invoices, quotations, your logo, and your signature can each be deleted on their own &mdash; directly in the app, wherever that item appears. For anything you can't remove yourself, email us at <a href="mailto:admin@velocrew.in">admin@velocrew.in</a> describing what to delete.</p>
    </section>

    <section id="what-happens">
      <h2><span class="num">04</span> What's deleted &amp; what's kept</h2>
      <p>Deleting your account permanently removes your business profile, every customer record, service history, invoice, quotation, team member, and uploaded logo or signature &mdash; <strong>immediately</strong>. Nothing is retained on our servers afterward. Routine backups may retain a copy for a short operational window before they cycle out.</p>
      <p>Payment records held by Razorpay, Google Play, or the App Store for completed transactions remain with those providers under their own retention rules &mdash; deleting your Agla Kaam account does not delete those.</p>
    </section>

    <section id="contact">
      <h2><span class="num">05</span> Contact</h2>
      <div class="fact-line"><span class="k">Entity</span><span class="v">VeloCrew &middot; UDYAM-KL-13-0110771</span></div>
      <div class="fact-line"><span class="k">Address</span><span class="v">Chittilappilly House, Thrissur, Puzhakkal Block Panchayat, Thrissur District, Kerala 680552, India</span></div>
      <div class="fact-line"><span class="k">Email</span><span class="v"><a href="mailto:admin@velocrew.in">admin@velocrew.in</a></span></div>
      <div class="fact-line"><span class="k">Phone</span><span class="v"><a href="tel:+919562994337">+91 95629 94337</a></span></div>
    </section>
  </main>
</div>

<footer>
  <div class="footer-inner">
    <div class="footer-block">
      <p class="label">Agla Kaam</p>
      <p>A product of VeloCrew</p>
      <p>UDYAM-KL-13-0110771</p>
    </div>
    <div class="footer-block">
      <p class="label">Registered office</p>
      <p>Chittilappilly House, Thrissur</p>
      <p>Puzhakkal Block Panchayat</p>
      <p>Thrissur District, Kerala 680552, India</p>
    </div>
    <div class="footer-block">
      <p class="label">Contact</p>
      <p><a href="mailto:admin@velocrew.in">admin@velocrew.in</a></p>
      <p><a href="tel:+919562994337">+91 95629 94337</a></p>
    </div>
  </div>
</footer>
`;

const SUPPORT_BODY = `
<div class="hero">
  <div class="hero-inner">
    <p class="kicker">Agla Kaam &middot; Help &amp; Support</p>
    <h1>Customer Support &amp; Help Desk</h1>
    <p class="summary">Need help with your Agla Kaam account, Apple App Store subscription, WhatsApp reminders, or GST invoices? We are here to help.</p>
  </div>
</div>

<div class="container">
  <main class="content" style="grid-column: 1 / -1; max-width: 820px; margin: 0 auto;">
    <section id="contact-channels">
      <h2><span class="num">01</span> Direct Contact Channels</h2>
      <div class="fact-line"><span class="k">Email Support</span><span class="v"><a href="mailto:admin@velocrew.in">admin@velocrew.in</a> &mdash; Guaranteed reply within 24 hours</span></div>
      <div class="fact-line"><span class="k">Phone Support</span><span class="v"><a href="tel:+918217226251">+91 82172 26251</a> / <a href="tel:+919562994337">+91 95629 94337</a> &mdash; Mon&ndash;Sat, 9:00 AM&ndash;7:00 PM IST</span></div>
      <div class="fact-line"><span class="k">WhatsApp Helpdesk</span><span class="v"><a href="https://wa.me/918217226251" target="_blank" rel="noopener">Chat with Support on WhatsApp (+91 82172 26251)</a></span></div>
      <div class="fact-line"><span class="k">Publisher Entity</span><span class="v">VeloCrew &middot; UDYAM-KL-13-0110771 &middot; Bengaluru &amp; Thrissur, India</span></div>
    </section>

    <section id="app-store-support">
      <h2><span class="num">02</span> Apple App Store &amp; In-App Purchases</h2>
      <p><strong>Restoring Purchases:</strong> If you reinstalled Agla Kaam or switched to a new iPhone, open the app, tap <strong>Drawer &rarr; Settings &rarr; Subscription Plan</strong>, and tap <strong>"Restore Purchases"</strong>. The app will sync your active purchase directly with Apple.</p>
      <p><strong>Managing Subscriptions:</strong> To upgrade, change tier, or cancel your auto-renewal, open your iPhone's <strong>Settings &rarr; tap your Apple ID &rarr; Subscriptions &rarr; Agla Kaam</strong>.</p>
      <p><strong>Refunds:</strong> In-app purchase billing on iOS is managed directly by Apple. To request a refund, visit <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a>.</p>
    </section>

    <section id="troubleshooting">
      <h2><span class="num">03</span> Common Troubleshooting</h2>
      <p><strong>WhatsApp Reminders:</strong> Agla Kaam generates pre-formatted WhatsApp links that open in your WhatsApp app. No messages are sent automatically or behind your back &mdash; you always preview and send them yourself.</p>
      <p><strong>Cloud Backup &amp; Data Security:</strong> Your customer books and invoices are automatically saved to our cloud servers. You will never lose data when updating the app or switching devices.</p>
      <p><strong>Account Deletion:</strong> If you wish to delete your account or any data, you can do so in the app under Settings, or visit our <a href="delete-account">Account Deletion Page</a>.</p>
    </section>
  </main>
</div>

<footer>
  <div class="footer-inner">
    <div class="footer-block">
      <p class="label">Agla Kaam</p>
      <p>A product of VeloCrew</p>
      <p>UDYAM-KL-13-0110771</p>
    </div>
    <div class="footer-block">
      <p class="label">Registered office</p>
      <p>Chittilappilly House, Thrissur</p>
      <p>Puzhakkal Block Panchayat</p>
      <p>Thrissur District, Kerala 680552, India</p>
    </div>
    <div class="footer-block">
      <p class="label">Contact</p>
      <p><a href="mailto:admin@velocrew.in">admin@velocrew.in</a></p>
      <p><a href="tel:+919562994337">+91 95629 94337</a></p>
    </div>
  </div>
</footer>
`;

export const PRIVACY_POLICY_HTML = page('Privacy Policy', PRIVACY_POLICY_BODY);
export const TERMS_OF_SERVICE_HTML = page(
  'Terms of Service',
  TERMS_OF_SERVICE_BODY,
);
export const DELETE_ACCOUNT_HTML = page(
  'Delete Your Account or Data',
  DELETE_ACCOUNT_BODY,
);
export const SUPPORT_HTML = page(
  'Customer Support & Help Desk',
  SUPPORT_BODY,
);

