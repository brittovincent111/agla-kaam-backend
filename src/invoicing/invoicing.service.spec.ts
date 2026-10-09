import { Types } from 'mongoose';
import { InvoicingService } from './invoicing.service';

const BIZ = '507f1f77bcf86cd799439012';
const CUSTOMER = '507f1f77bcf86cd799439013';
const INVOICE = '507f1f77bcf86cd799439014';
const FILTER_ID = '507f1f77bcf86cd799439021';
const PUMP_ID = '507f1f77bcf86cd799439022';

const execOf = (value: unknown) => ({
  exec: jest.fn().mockResolvedValue(value),
});

function makeInvoiceDoc(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    _id: new Types.ObjectId(INVOICE),
    businessId: BIZ,
    customerId: CUSTOMER,
    status: 'draft',
    items: [
      { name: 'RO Filter 10 inch', quantity: 2 },
      { name: 'Installation', quantity: 1 },
    ],
    stockDeductions: [],
    ...overrides,
  };
  doc.save = jest.fn().mockImplementation(() => Promise.resolve(doc));
  doc.deleteOne = jest.fn().mockResolvedValue(undefined);
  return doc;
}

function build() {
  const invoiceModel: any = {
    create: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn().mockReturnValue(execOf(0)),
  };
  const inventoryService = {
    findAll: jest.fn().mockResolvedValue([
      {
        _id: new Types.ObjectId(FILTER_ID),
        name: 'RO Filter 10 inch',
        isService: false,
      },
      {
        _id: new Types.ObjectId(PUMP_ID),
        name: 'Installation',
        isService: true,
      },
    ]),
    adjustStock: jest.fn().mockResolvedValue({}),
  };
  let serial = 7;
  const businessesService = {
    findById: jest
      .fn()
      .mockResolvedValue({ invoicePrefix: 'INV-', currency: 'INR' }),
    allocateSerial: jest
      .fn()
      .mockImplementation(() => Promise.resolve(serial++)),
  };
  const service = new InvoicingService(
    invoiceModel,
    // No payments: cancelling has no door collections to hand back.
    {
      find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
    } as any,
    { findOne: jest.fn().mockResolvedValue({}) } as any,
    {} as any,
    { getActiveTier: jest.fn().mockResolvedValue('combo') } as any,
    businessesService as any,
    inventoryService as any,
    {} as any,
  );
  return { service, invoiceModel, inventoryService, businessesService };
}

const createDto = {
  customerId: CUSTOMER,
  items: [{ name: 'RO Filter 10 inch', quantity: 2, rate: 450, taxRate: 18 }],
} as any;

describe('InvoicingService stock', () => {
  it('does not touch stock when an invoice is created as a draft', async () => {
    const { service, invoiceModel, inventoryService } = build();
    invoiceModel.create.mockImplementation((doc: unknown) =>
      Promise.resolve(doc),
    );
    await service.create(BIZ, createDto);
    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
  });

  it('deducts tracked goods when the draft is sent, and records it', async () => {
    const { service, invoiceModel, inventoryService } = build();
    const draft = makeInvoiceDoc();
    const claimed = makeInvoiceDoc({ status: 'unpaid' });
    invoiceModel.findById.mockReturnValue(execOf(draft));
    invoiceModel.findOneAndUpdate.mockReturnValue(execOf(claimed));

    const sent: any = await service.send(BIZ, INVOICE);

    expect(invoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: draft._id, status: 'draft' },
      { $set: { status: 'unpaid' } },
      { new: true },
    );
    // The service line has no stock; only the filter moves.
    expect(inventoryService.adjustStock).toHaveBeenCalledTimes(1);
    expect(inventoryService.adjustStock).toHaveBeenCalledWith(
      BIZ,
      FILTER_ID,
      -2,
    );
    expect(sent.stockDeductions).toEqual([{ itemId: FILTER_ID, quantity: 2 }]);
  });

  it('does not deduct twice when a second send loses the race', async () => {
    const { service, invoiceModel, inventoryService } = build();
    invoiceModel.findById.mockReturnValue(execOf(makeInvoiceDoc()));
    invoiceModel.findOneAndUpdate.mockReturnValue(execOf(null));

    await expect(service.send(BIZ, INVOICE)).rejects.toThrow(
      'Only draft invoices can be sent',
    );
    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
  });

  it('still sends when a matched item has left the catalogue', async () => {
    const { service, invoiceModel, inventoryService } = build();
    invoiceModel.findById.mockReturnValue(execOf(makeInvoiceDoc()));
    invoiceModel.findOneAndUpdate.mockReturnValue(
      execOf(makeInvoiceDoc({ status: 'unpaid' })),
    );
    inventoryService.adjustStock.mockRejectedValue(new Error('gone'));

    const sent: any = await service.send(BIZ, INVOICE);
    expect(sent.status).toBe('unpaid');
    expect(sent.stockDeductions).toEqual([]);
  });

  it('puts back what sending took when the invoice is cancelled', async () => {
    const { service, invoiceModel, inventoryService } = build();
    const live = makeInvoiceDoc({
      status: 'unpaid',
      stockDeductions: [{ itemId: FILTER_ID, quantity: 2 }],
    });
    invoiceModel.findById.mockReturnValue(execOf(live));
    // findOneAndUpdate with new:false hands back the pre-cancel document.
    invoiceModel.findOneAndUpdate.mockReturnValue(execOf(live));

    await service.cancel(BIZ, INVOICE);

    expect(invoiceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: live._id, status: { $nin: ['paid', 'cancelled'] } },
      { $set: { status: 'cancelled', stockDeductions: [] } },
      { new: false },
    );
    expect(inventoryService.adjustStock).toHaveBeenCalledWith(
      BIZ,
      FILTER_ID,
      2,
    );
  });

  it('restores nothing when a never-sent draft is cancelled', async () => {
    const { service, invoiceModel, inventoryService } = build();
    const draft = makeInvoiceDoc();
    invoiceModel.findById.mockReturnValue(execOf(draft));
    invoiceModel.findOneAndUpdate.mockReturnValue(execOf(draft));

    await service.cancel(BIZ, INVOICE);
    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
  });

  it('does not restore twice when a second cancel loses the race', async () => {
    const { service, invoiceModel, inventoryService } = build();
    invoiceModel.findById.mockReturnValue(
      execOf(
        makeInvoiceDoc({
          status: 'unpaid',
          stockDeductions: [{ itemId: FILTER_ID, quantity: 2 }],
        }),
      ),
    );
    invoiceModel.findOneAndUpdate.mockReturnValue(execOf(null));

    await expect(service.cancel(BIZ, INVOICE)).rejects.toThrow();
    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
  });
});

describe('InvoicingService numbering', () => {
  const duplicate = Object.assign(new Error('E11000 duplicate key'), {
    code: 11000,
    keyPattern: { businessId: 1, invoiceNumber: 1 },
  });

  it('allocates a fresh number once when the first is already taken', async () => {
    const { service, invoiceModel, businessesService } = build();
    invoiceModel.create
      .mockRejectedValueOnce(duplicate)
      .mockImplementation((doc: unknown) => Promise.resolve(doc));

    const created: any = await service.create(BIZ, createDto);

    expect(businessesService.allocateSerial).toHaveBeenCalledTimes(2);
    expect(created.invoiceNumber).toMatch(/^INV-\d{4}-008$/);
  });

  it('gives up after one retry rather than looping', async () => {
    const { service, invoiceModel } = build();
    invoiceModel.create.mockRejectedValue(duplicate);
    await expect(service.create(BIZ, createDto)).rejects.toBe(duplicate);
    expect(invoiceModel.create).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unrelated error', async () => {
    const { service, invoiceModel } = build();
    const other = new Error('validation failed');
    invoiceModel.create.mockRejectedValue(other);
    await expect(service.create(BIZ, createDto)).rejects.toBe(other);
    expect(invoiceModel.create).toHaveBeenCalledTimes(1);
  });
});
