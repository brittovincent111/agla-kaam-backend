// UPI "pay" links (NPCI deep-link spec): what the invoice QR encodes and what
// the "Pay with UPI" button on the invoice page opens.
//
// The invoice QR used to carry only the UPI ID and name, so every customer
// typed the amount by hand — and nothing tied the payment to an invoice.
// With the amount and the invoice number filled in, the customer's UPI app
// opens ready to pay, and the note shows the owner which bill it settles.

export interface UpiPayment {
  // A business's UPI ID, or its full upi:// QR content from the bank.
  upiIdOrLink: string;
  payeeName: string;
  // Omitted (or 0) leaves the amount for the payer to enter.
  amount?: number;
  // Shown to both sides in the UPI app: the invoice number.
  note?: string;
  currency?: string;
}

export function buildUpiLink(input: UpiPayment): string | null {
  const raw = input.upiIdOrLink.trim();
  if (!raw) return null;
  // UPI is rupees only; a Gulf business's QR stays as it was.
  const inr = !input.currency || input.currency.toUpperCase() === 'INR';

  let url: URL;
  if (/^upi:\/\//i.test(raw)) {
    try {
      url = new URL(raw);
    } catch {
      return raw;
    }
  } else if (raw.includes('@')) {
    url = new URL('upi://pay');
    url.searchParams.set('pa', raw);
    url.searchParams.set('pn', input.payeeName.slice(0, 50));
  } else {
    // Some other QR text (a bank or merchant string we cannot read): as is.
    return raw;
  }

  if (inr && input.amount && input.amount > 0) {
    url.searchParams.set('am', input.amount.toFixed(2));
    url.searchParams.set('cu', 'INR');
  }
  // tn, not tr: tr is a merchant transaction id, and several UPI apps refuse
  // a personal (P2P) UPI ID that carries one.
  if (input.note) url.searchParams.set('tn', input.note.slice(0, 50));
  // URLSearchParams writes spaces as "+", which some UPI apps show literally.
  return url.toString().replace(/\+/g, '%20');
}
