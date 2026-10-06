/**
 * The monthly money limit for outreach, turned into a WhatsApp message cap.
 *
 *   OUTREACH_MONTHLY_BUDGET_INR    3000   what may be spent a month (0 = no budget cap)
 *   OUTREACH_BUDGET_GAP_PERCENT    20     kept unspent, as a safety margin
 *   WHATSAPP_COST_PER_MESSAGE_INR  1.02   Meta's India marketing rate (₹0.8631) + 18% GST
 *
 * Google searches stay inside their free allowance and email (SES) costs
 * paise, so WhatsApp marketing messages are what the budget pays for.
 * Replies inside the 24-hour window are free and don't count.
 */

const IST_OFFSET_MS = 330 * 60_000;

export interface WhatsappBudget {
  budgetInr: number;
  usableInr: number;
  costPerMessageInr: number;
  // Marketing messages a month; null when no budget is set.
  monthlyCap: number | null;
}

export function whatsappBudget(get: (key: string) => string | undefined): WhatsappBudget {
  const budgetInr = Math.max(0, Number(get('OUTREACH_MONTHLY_BUDGET_INR') || 0) || 0);
  const gap = Math.max(0, Math.min(90, Number(get('OUTREACH_BUDGET_GAP_PERCENT') || 20)));
  const cost = Number(get('WHATSAPP_COST_PER_MESSAGE_INR') || 1.02) || 1.02;
  const usableInr = Math.floor((budgetInr * (100 - gap)) / 100);
  return {
    budgetInr,
    usableInr,
    costPerMessageInr: cost,
    monthlyCap: budgetInr > 0 ? Math.floor(usableInr / cost) : null,
  };
}

/** Start of the current India calendar month, as a UTC instant. */
export function istMonthStart(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}

/**
 * Sending days left in the India month, today included, counting only the
 * weekdays in OUTREACH_SEND_DAYS (default Mon–Sat).
 */
export function sendingDaysLeft(get: (key: string) => string | undefined, now: Date = new Date()): number {
  const m = (get('OUTREACH_SEND_DAYS') ?? '').trim().match(/^(\d)\s*-\s*(\d)$/);
  const [first, last] = m && Number(m[1]) <= Number(m[2]) ? [Number(m[1]), Number(m[2])] : [1, 6];
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const mo = ist.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  let n = 0;
  for (let d = ist.getUTCDate(); d <= lastDay; d++) {
    const wd = new Date(Date.UTC(y, mo, d)).getUTCDay();
    if (wd >= first && wd <= last) n++;
  }
  return Math.max(1, n);
}
