import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from '../invoicing/schemas/invoice.schema';
import { Quotation, QuotationDocument } from '../quotations/schemas/quotation.schema';

export interface BillingItemSuggestion {
  name: string;
  description?: string;
  rate: number;
  taxRate: number;
}

const RECENT_DOCUMENTS_PER_SOURCE = 50;
const MAX_SUGGESTIONS = 20;

@Injectable()
export class BillingItemsService {
  constructor(
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Quotation.name) private readonly quotationModel: Model<QuotationDocument>,
  ) {}

  async findRecent(businessId: string): Promise<BillingItemSuggestion[]> {
    const [invoices, quotations] = await Promise.all([
      this.invoiceModel
        .find({ businessId })
        .sort({ invoiceDate: -1 })
        .limit(RECENT_DOCUMENTS_PER_SOURCE)
        .select('items invoiceDate')
        .lean()
        .exec(),
      this.quotationModel
        .find({ businessId })
        .sort({ quotationDate: -1 })
        .limit(RECENT_DOCUMENTS_PER_SOURCE)
        .select('items quotationDate')
        .lean()
        .exec(),
    ]);

    const entries: (BillingItemSuggestion & { date: Date })[] = [];
    for (const invoice of invoices) {
      for (const item of invoice.items) {
        entries.push({
          name: item.name,
          description: item.description,
          rate: item.rate,
          taxRate: item.taxRate,
          date: invoice.invoiceDate,
        });
      }
    }
    for (const quotation of quotations) {
      for (const item of quotation.items) {
        entries.push({
          name: item.name,
          description: item.description,
          rate: item.rate,
          taxRate: item.taxRate,
          date: quotation.quotationDate,
        });
      }
    }

    entries.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Most-recent use of each item name wins — de-duped case-insensitively so
    // "AC Service" and "ac service" collapse into one suggestion.
    const seen = new Set<string>();
    const suggestions: BillingItemSuggestion[] = [];
    for (const entry of entries) {
      const key = entry.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ name: entry.name, description: entry.description, rate: entry.rate, taxRate: entry.taxRate });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    return suggestions;
  }
}
