import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PurchasesService } from './purchases.service';

const BIZ = '507f1f77bcf86cd799439012';
const PURCHASE = '507f1f77bcf86cd799439014';
const FILTER_ID = '507f1f77bcf86cd799439021';
const PUMP_ID = '507f1f77bcf86cd799439022';
const NEW_ITEM_ID = '507f1f77bcf86cd799439023';
const UPDATED_AT = new Date('2026-10-01T10:00:00Z');

const execOf = (value: unknown) => ({
  exec: jest.fn().mockResolvedValue(value),
});

function makePurchaseDoc(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    _id: new Types.ObjectId(PURCHASE),
    businessId: new Types.ObjectId(BIZ),
    purchaseNumber: 'PO-2026-007',
    supplierName: 'Metro Spares',
    items: [
      // Stored as an ObjectId by create(), as a string on older rows.
      {
        itemId: new Types.ObjectId(FILTER_ID),
        name: 'RO Filter',
        quantity: 10,
        costPrice: 100,
        amount: 1000,
      },
      {
        itemId: PUMP_ID,
        name: 'Pump',
        quantity: 2,
        costPrice: 500,
        amount: 1000,
      },
      { name: 'Unlinked', quantity: 1, costPrice: 50, amount: 50 },
    ],
    totalAmount: 2050,
    amountPaid: 1500,
    balanceDue: 550,
    paymentStatus: 'partially_paid',
    ...overrides,
  };
  doc.get = jest.fn((path: string) =>
    path === 'updatedAt' ? UPDATED_AT : doc[path],
  );
  return doc;
}

function build(doc = makePurchaseDoc()) {
  const purchaseModel: any = jest.fn();
  purchaseModel.findOne = jest.fn().mockReturnValue(execOf(doc));
  purchaseModel.findOneAndUpdate = jest
    .fn()
    .mockImplementation((_filter, update) =>
      execOf({ ...doc, ...update.$set }),
    );
  purchaseModel.findOneAndDelete = jest.fn().mockReturnValue(execOf(doc));
  const inventoryService = {
    create: jest
      .fn()
      .mockResolvedValue({ _id: new Types.ObjectId(NEW_ITEM_ID) }),
    adjustStock: jest.fn().mockResolvedValue({}),
    // No stock item of that name unless a test says otherwise.
    findByExactName: jest.fn().mockResolvedValue(null),
  };
  const service = new PurchasesService(
    purchaseModel,
    inventoryService as any,
    {} as any,
  );
  return { service, purchaseModel, inventoryService, doc };
}

// Net stock change applied per item id, across every adjustStock call.
function stockMoves(inventoryService: { adjustStock: jest.Mock }) {
  const moves: Record<string, number> = {};
  for (const [biz, itemId, change] of inventoryService.adjustStock.mock.calls) {
    expect(biz).toBe(BIZ);
    moves[itemId] = (moves[itemId] ?? 0) + change;
  }
  return moves;
}

function expectIdFilter(value: unknown, id: string) {
  expect(value).toEqual({ $in: [id, new Types.ObjectId(id)] });
}

describe('a purchase line typed by hand', () => {
  it('restocks the existing item of that name instead of creating another', async () => {
    const { service, inventoryService } = build();
    inventoryService.findByExactName.mockResolvedValueOnce({ _id: new Types.ObjectId(PUMP_ID) });

    await service.update(BIZ, PURCHASE, {
      items: [{ name: ' booster pump ', quantity: 2, costPrice: 900 }],
    });

    expect(inventoryService.findByExactName).toHaveBeenCalledWith(BIZ, ' booster pump ');
    expect(inventoryService.create).not.toHaveBeenCalled();
    // Same item, same 2 as the old line: linked, so its stock does not move.
    expect(stockMoves(inventoryService)[PUMP_ID] ?? 0).toBe(0);
  });
});

describe('PurchasesService.update', () => {
  it('takes the old lines out of stock and puts the new lines in', async () => {
    const { service, inventoryService } = build();

    await service.update(BIZ, PURCHASE, {
      items: [
        { itemId: FILTER_ID, name: 'RO Filter', quantity: 4, costPrice: 100 },
        { name: 'Membrane', hsnCode: 'abc1', quantity: 3, costPrice: 200 },
      ],
    });

    // The uncatalogued line is added to the catalogue at stock 0, exactly as
    // create() does, and then receives its quantity like any other line.
    expect(inventoryService.create).toHaveBeenCalledWith(
      BIZ,
      expect.objectContaining({
        name: 'Membrane',
        hsnCode: 'ABC1',
        stockQuantity: 0,
      }),
    );
    expect(stockMoves(inventoryService)).toEqual({
      [FILTER_ID]: -6, // 10 out, 4 in
      [PUMP_ID]: -2, // line removed
      [NEW_ITEM_ID]: 3, // new line
    });
  });

  it('moves nothing for an unchanged line', async () => {
    const { service, inventoryService, doc } = build();

    await service.update(BIZ, PURCHASE, {
      items: doc.items.slice(0, 2).map((i: any) => ({
        itemId: String(i.itemId),
        name: i.name,
        quantity: i.quantity,
        costPrice: i.costPrice,
      })),
    });

    // Netted, so an item sold down since is not floored at 0 and refilled.
    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
  });

  it('leaves stock alone when the lines are not sent', async () => {
    const { service, inventoryService, purchaseModel } = build();

    await service.update(BIZ, PURCHASE, { notes: 'Rechecked' });

    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
    const [, update] = purchaseModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.items).toBeUndefined();
    expect(update.$set.totalAmount).toBe(2050);
    expect(update.$set.notes).toBe('Rechecked');
  });

  it('recomputes the totals and keeps the amount already paid', async () => {
    const { service, purchaseModel } = build();

    await service.update(BIZ, PURCHASE, {
      items: [
        { itemId: FILTER_ID, name: 'RO Filter', quantity: 30, costPrice: 100 },
      ],
    });

    const [, update] = purchaseModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({
      totalAmount: 3000,
      amountPaid: 1500,
      balanceDue: 1500,
      paymentStatus: 'partially_paid',
    });
    expect(update.$set.items).toEqual([
      expect.objectContaining({ quantity: 30, amount: 3000 }),
    ]);
  });

  it('clamps the kept amount paid when the total shrinks', async () => {
    const { service, purchaseModel } = build();

    await service.update(BIZ, PURCHASE, {
      items: [
        { itemId: FILTER_ID, name: 'RO Filter', quantity: 5, costPrice: 100 },
      ],
    });

    const [, update] = purchaseModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({
      totalAmount: 500,
      amountPaid: 500,
      balanceDue: 0,
      paymentStatus: 'paid',
    });
  });

  it('uses a supplied amount paid, clamped to the total', async () => {
    const { service, purchaseModel } = build();

    await service.update(BIZ, PURCHASE, { amountPaid: 0 });
    expect(purchaseModel.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      amountPaid: 0,
      balanceDue: 2050,
      paymentStatus: 'unpaid',
    });

    await service.update(BIZ, PURCHASE, { amountPaid: 99999 });
    expect(purchaseModel.findOneAndUpdate.mock.calls[1][1].$set).toMatchObject({
      amountPaid: 2050,
      balanceDue: 0,
      paymentStatus: 'paid',
    });
  });

  it('never changes the purchase number, and clears emptied text fields', async () => {
    const { service, purchaseModel } = build();

    await service.update(BIZ, PURCHASE, {
      supplierName: '  New Supplier ',
      supplierPhone: '',
      supplierInvoiceNumber: ' B-42 ',
    } as any);

    const [, update] = purchaseModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.purchaseNumber).toBeUndefined();
    expect(update.$set.supplierName).toBe('New Supplier');
    expect(update.$set.supplierInvoiceNumber).toBe('B-42');
    expect(update.$unset).toEqual({ supplierPhone: '' });
  });

  it('filters by business with idFilter and only writes the version it read', async () => {
    const { service, purchaseModel } = build();

    await service.update(BIZ, PURCHASE, { notes: 'x' });

    const [findFilter] = purchaseModel.findOne.mock.calls[0];
    expectIdFilter(findFilter.businessId, BIZ);
    const [writeFilter] = purchaseModel.findOneAndUpdate.mock.calls[0];
    expectIdFilter(writeFilter.businessId, BIZ);
    expect(writeFilter.updatedAt).toBe(UPDATED_AT);
  });

  it('refuses, and moves no stock, when the purchase changed underneath', async () => {
    const { service, purchaseModel, inventoryService } = build();
    purchaseModel.findOneAndUpdate.mockReturnValue(execOf(null));

    await expect(
      service.update(BIZ, PURCHASE, {
        items: [
          { itemId: FILTER_ID, name: 'RO Filter', quantity: 1, costPrice: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
  });

  it('still saves when a stock move fails', async () => {
    const { service, inventoryService } = build();
    inventoryService.adjustStock.mockRejectedValue(
      new NotFoundException('Inventory item not found'),
    );

    await expect(
      service.update(BIZ, PURCHASE, {
        items: [
          { itemId: FILTER_ID, name: 'RO Filter', quantity: 1, costPrice: 1 },
        ],
      }),
    ).resolves.toBeDefined();
  });

  it('404s on a purchase of another business or a bad id', async () => {
    const { service, purchaseModel } = build();
    purchaseModel.findOne.mockReturnValue(execOf(null));

    await expect(
      service.update(BIZ, PURCHASE, { notes: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update(BIZ, 'not-an-id', { notes: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(purchaseModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('PurchasesService.remove', () => {
  it('deletes the purchase and takes its stock back out', async () => {
    const { service, purchaseModel, inventoryService } = build();

    await expect(service.remove(BIZ, PURCHASE)).resolves.toBeUndefined();

    const [filter] = purchaseModel.findOneAndDelete.mock.calls[0];
    expect(filter._id).toEqual(new Types.ObjectId(PURCHASE));
    expectIdFilter(filter.businessId, BIZ);
    expect(stockMoves(inventoryService)).toEqual({
      [FILTER_ID]: -10,
      [PUMP_ID]: -2,
    });
  });

  it('moves no stock when there was nothing to delete', async () => {
    const { service, purchaseModel, inventoryService } = build();
    purchaseModel.findOneAndDelete.mockReturnValue(execOf(null));

    await expect(service.remove(BIZ, PURCHASE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(inventoryService.adjustStock).not.toHaveBeenCalled();
  });
});

describe('PurchasesService.create stock', () => {
  it('adds each linked line, including auto-catalogued ones', async () => {
    const { purchaseModel, inventoryService } = build();
    purchaseModel.mockImplementation((data: any) => ({
      ...data,
      save: jest.fn().mockResolvedValue(data),
    }));
    const businessesService = {
      findById: jest
        .fn()
        .mockResolvedValue({ purchasePrefix: 'PO-', purchaseNextSerial: 8 }),
      update: jest.fn().mockResolvedValue({}),
    };
    const service = new PurchasesService(
      purchaseModel,
      inventoryService as any,
      businessesService as any,
    );

    const created: any = await service.create(BIZ, {
      supplierName: 'Metro Spares',
      items: [
        { itemId: FILTER_ID, name: 'RO Filter', quantity: 4, costPrice: 100 },
        { name: 'Membrane', quantity: 3, costPrice: 200 },
      ],
    });

    expect(created.totalAmount).toBe(1000);
    expect(created.paymentStatus).toBe('paid');
    expect(stockMoves(inventoryService)).toEqual({
      [FILTER_ID]: 4,
      [NEW_ITEM_ID]: 3,
    });
  });
});
