import { Types } from 'mongoose';
import { Invoice } from '../invoicing/schemas/invoice.schema';
import { Quotation } from '../quotations/schemas/quotation.schema';

// Fixed dummy content for template previews — rendered with the viewing
// business's own name/address/GSTIN so the preview looks like a real
// document, but no real customer or invoice data is ever touched.
export const SAMPLE_CUSTOMER = { name: 'Ravi Kumar', phone: '+91 98765 43210' };

const SAMPLE_ITEMS = [
  {
    name: 'AC General Service',
    description: '1.5 ton split AC — full clean & gas check',
    quantity: 1,
    rate: 599,
    taxRate: 18,
    amount: 599,
    taxAmount: 107.82,
  },
  { name: 'Gas Refill', quantity: 1, rate: 1200, taxRate: 18, amount: 1200, taxAmount: 216 },
  { name: 'Service call charge', quantity: 1, rate: 150, taxRate: 0, amount: 150, taxAmount: 0 },
];

const SUBTOTAL = SAMPLE_ITEMS.reduce((sum, item) => sum + item.amount, 0);
const TAX_TOTAL = SAMPLE_ITEMS.reduce((sum, item) => sum + item.taxAmount, 0);
const DISCOUNT = 50;
const TOTAL = SUBTOTAL + TAX_TOTAL - DISCOUNT;

export function buildSampleInvoice(): Invoice {
  const invoiceDate = new Date();
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + 7);

  return {
    businessId: new Types.ObjectId(),
    customerId: new Types.ObjectId(),
    invoiceNumber: 'INV-0001',
    invoiceDate,
    dueDate,
    status: 'unpaid',
    items: SAMPLE_ITEMS,
    subtotal: SUBTOTAL,
    discount: DISCOUNT,
    taxTotal: TAX_TOTAL,
    total: TOTAL,
    amountPaid: 0,
    balanceDue: TOTAL,
    notes: 'Thank you for choosing us — payment due within 7 days.',
    paymentTerms: 'Due on receipt',
  } as Invoice;
}

export function buildSampleQuotation(): Quotation {
  const quotationDate = new Date();
  const validUntil = new Date(quotationDate);
  validUntil.setDate(validUntil.getDate() + 14);

  return {
    businessId: new Types.ObjectId(),
    customerId: new Types.ObjectId(),
    quotationNumber: 'QUO-0001',
    quotationDate,
    validUntil,
    status: 'sent',
    items: SAMPLE_ITEMS,
    subtotal: SUBTOTAL,
    discount: DISCOUNT,
    taxTotal: TAX_TOTAL,
    total: TOTAL,
    notes: 'Prices valid for 14 days from the quotation date.',
  } as Quotation;
}
