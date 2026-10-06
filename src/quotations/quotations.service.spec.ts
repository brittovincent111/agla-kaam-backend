import { Types } from 'mongoose';
import { QuotationsService } from './quotations.service';

const BIZ = '507f1f77bcf86cd799439012';
const QUOTATION = '507f1f77bcf86cd799439015';

function build(stored: Record<string, unknown>) {
  const doc: any = {
    _id: new Types.ObjectId(QUOTATION),
    businessId: BIZ,
    customerId: '507f1f77bcf86cd799439013',
    status: 'draft',
    discount: 0,
    ...stored,
  };
  doc.save = jest.fn().mockImplementation(() => Promise.resolve(doc));
  const quotationModel: any = {
    findById: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
  };
  const service = new QuotationsService(
    quotationModel,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, doc };
}

describe('QuotationsService.update', () => {
  // Editing rebuilt the lines with a placeholder tax of 0 and never wrote
  // the real per-line tax back, so an edited quotation's PDF tax column read
  // zero beneath a non-zero tax total.
  it('writes the per-line tax back when the lines are edited', async () => {
    const { service } = build({ items: [] });
    const saved: any = await service.update(BIZ, QUOTATION, {
      items: [
        { name: 'AMC visit', quantity: 1, rate: 1000, taxRate: 18 },
        { name: 'Filter', quantity: 2, rate: 250, taxRate: 5 },
      ],
      discount: 150,
    } as any);

    // 150 split 100 / 50 across 1000 / 500, then taxed on what remains.
    expect(saved.items.map((i: any) => i.taxAmount)).toEqual([162, 22.5]);
    expect(saved.taxTotal).toBe(184.5);
    expect(saved.total).toBe(1534.5);
  });

  it('re-spreads the tax when only the discount changes', async () => {
    const { service } = build({
      items: [
        {
          name: 'AMC visit',
          quantity: 1,
          rate: 1000,
          taxRate: 18,
          amount: 1000,
          taxAmount: 180,
        },
      ],
    });
    const saved: any = await service.update(BIZ, QUOTATION, {
      discount: 200,
    } as any);
    expect(saved.items[0].taxAmount).toBe(144);
    expect(saved.taxTotal).toBe(144);
  });
});
