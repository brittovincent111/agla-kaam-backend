import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { InventoryService } from './inventory.service';
import { InventoryItem } from './schemas/inventory-item.schema';
import { encodePageCursor } from '../common/pagination/cursor-page';

describe('InventoryService', () => {
  let service: InventoryService;
  let mockModel: any;

  const mockItem = {
    _id: '507f1f77bcf86cd799439011',
    businessId: '507f1f77bcf86cd799439012',
    name: 'RO Filter 10 inch',
    unit: 'pcs',
    salePrice: 450,
    costPrice: 200,
    stockQuantity: 10,
    minStockAlert: 3,
    isService: false,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  beforeEach(async () => {
    mockModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011', ...dto }),
    }));
    mockModel.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockItem]),
      }),
    });
    mockModel.findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockItem),
    });
    mockModel.findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...mockItem, salePrice: 500 }),
    });
    mockModel.deleteOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getModelToken(InventoryItem.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates an inventory item', async () => {
    const result = await service.create('507f1f77bcf86cd799439012', {
      name: 'RO Filter 10 inch',
      salePrice: 450,
      costPrice: 200,
      stockQuantity: 10,
    });
    expect(result.name).toBe('RO Filter 10 inch');
  });

  it('finds all inventory items', async () => {
    const list = await service.findAll('507f1f77bcf86cd799439012');
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('RO Filter 10 inch');
  });

  it('adjusts stock quantity correctly', async () => {
    const adjusted = await service.adjustStock('507f1f77bcf86cd799439012', '507f1f77bcf86cd799439011', -3);
    expect(adjusted.stockQuantity).toBe(7);
  });

  describe('findPageForBusiness', () => {
    // A page query is find().sort().limit().exec(), one link longer than the
    // findAll chain the shared mock provides.
    function mockPage(rows: any[]) {
      const exec = jest.fn().mockResolvedValue(rows);
      const limit = jest.fn().mockReturnValue({ exec });
      const sort = jest.fn().mockReturnValue({ limit });
      mockModel.find = jest.fn().mockReturnValue({ sort });
      mockModel.countDocuments = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(rows.length) });
      return { sort, limit };
    }

    it('asks for one row past the limit, to detect a next page', async () => {
      const { limit } = mockPage([mockItem]);
      await service.findPageForBusiness('507f1f77bcf86cd799439012', { limit: 20 });
      expect(limit).toHaveBeenCalledWith(21);
    });

    it('reports a next page and hands back a cursor when the probe row lands', async () => {
      mockPage([mockItem, { ...mockItem, _id: 'second', name: 'Sediment Filter' }]);
      const page = await service.findPageForBusiness('507f1f77bcf86cd799439012', {
        limit: 1,
      });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).not.toBeNull();
      expect(page.total).toBe(2);
    });

    // The catalogue is paged alphabetically, so the cursor's key is an item
    // name. Coerced to a Date — as a date-keyed list's cursor is — a name
    // like "500" would compare a Date against a string field, match nothing,
    // and end the list early.
    it('keeps a name cursor as a string rather than parsing it as a date', async () => {
      mockPage([]);
      await service.findPageForBusiness('507f1f77bcf86cd799439012', {
        cursor: encodePageCursor({ v: '500', id: '507f1f77bcf86cd799439011' }),
      });
      const filter = mockModel.find.mock.calls[0][0];
      const cursorClause = filter.$and.find((part: any) => part.$or?.[0]?.name);
      expect(cursorClause.$or[0].name.$gt).toBe('500');
    });

    // Counting on every scroll would re-scan the collection for a number
    // that has not changed.
    it('counts the total only on the first page', async () => {
      mockPage([mockItem]);
      await service.findPageForBusiness('507f1f77bcf86cd799439012', {
        cursor: encodePageCursor({ v: 'RO Filter', id: '507f1f77bcf86cd799439011' }),
      });
      expect(mockModel.countDocuments).not.toHaveBeenCalled();
    });
  });
});
