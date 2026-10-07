import { Types } from 'mongoose';
import { SuppliersService } from './suppliers.service';

// Supplier.businessId is a Mixed path (see id-match.ts): a bare string filter
// never matched a supplier stored with an ObjectId businessId, so the list
// showed it and then detail, edit and delete all 404'd.

const BIZ = '507f1f77bcf86cd799439012';
const SUPPLIER = '507f1f77bcf86cd799439031';
const bothForms = { $in: [BIZ, new Types.ObjectId(BIZ)] };

const execOf = (value: unknown) => ({
  exec: jest.fn().mockResolvedValue(value),
});

function build() {
  const supplierModel: any = {
    findOne: jest.fn().mockReturnValue(execOf({ _id: SUPPLIER })),
    findOneAndUpdate: jest.fn().mockReturnValue(execOf({ _id: SUPPLIER })),
    deleteOne: jest.fn().mockReturnValue(execOf({ deletedCount: 1 })),
  };
  return { service: new SuppliersService(supplierModel), supplierModel };
}

describe('SuppliersService ownership filters', () => {
  it('findOne matches the business in both stored forms', async () => {
    const { service, supplierModel } = build();
    await service.findOne(BIZ, SUPPLIER);
    expect(supplierModel.findOne).toHaveBeenCalledWith({
      _id: SUPPLIER,
      businessId: bothForms,
    });
  });

  it('update matches the business in both stored forms', async () => {
    const { service, supplierModel } = build();
    await service.update(BIZ, SUPPLIER, { name: 'Acme' } as any);
    expect(supplierModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: SUPPLIER,
      businessId: bothForms,
    });
  });

  it('remove matches the business in both stored forms', async () => {
    const { service, supplierModel } = build();
    await service.remove(BIZ, SUPPLIER);
    expect(supplierModel.deleteOne).toHaveBeenCalledWith({
      _id: SUPPLIER,
      businessId: bothForms,
    });
  });
});
