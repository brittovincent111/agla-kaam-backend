import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Business } from '../businesses/schemas/business.schema';
import { Subscription } from '../subscriptions/schemas/subscription.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { Service } from '../services/schemas/service.schema';
import { Invoice } from '../invoicing/schemas/invoice.schema';
import { AppFeedback } from '../app-feedback/schemas/app-feedback.schema';

describe('AdminService', () => {
  let service: AdminService;

  const mockBusinessModel = {
    countDocuments: jest.fn().mockResolvedValue(10),
    aggregate: jest.fn().mockResolvedValue([{ _id: 'AC & HVAC', count: 5 }]),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
  };

  const mockSubscriptionModel = {
    find: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { tier: 'combo', teamEnabled: false, status: 'active' },
      ]),
    }),
  };

  const mockCustomerModel = {
    countDocuments: jest.fn().mockResolvedValue(25),
  };

  const mockServiceModel = {
    countDocuments: jest.fn().mockResolvedValue(40),
  };

  const mockInvoiceModel = {
    countDocuments: jest.fn().mockResolvedValue(15),
    aggregate: jest.fn().mockResolvedValue([{ totalInvoiced: 45000 }]),
  };

  const mockFeedbackModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('test-admin-jwt-token'),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'ADMIN_EMAIL') return 'admin@velocrew.in';
      if (key === 'ADMIN_PASSWORD') return 'velocrew@admin2026';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: getModelToken(Business.name), useValue: mockBusinessModel },
        { provide: getModelToken(Subscription.name), useValue: mockSubscriptionModel },
        { provide: getModelToken(Customer.name), useValue: mockCustomerModel },
        { provide: getModelToken(Service.name), useValue: mockServiceModel },
        { provide: getModelToken(Invoice.name), useValue: mockInvoiceModel },
        { provide: getModelToken(AppFeedback.name), useValue: mockFeedbackModel },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  describe('login', () => {
    it('should authenticate successfully with correct credentials', async () => {
      const result = await service.login({
        email: 'admin@velocrew.in',
        password: 'velocrew@admin2026',
      });
      expect(result.accessToken).toBe('test-admin-jwt-token');
      expect(result.admin.email).toBe('admin@velocrew.in');
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      await expect(
        service.login({
          email: 'admin@velocrew.in',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getDashboardStats', () => {
    it('should return aggregated dashboard statistics', async () => {
      const stats = await service.getDashboardStats();
      expect(stats.overview.totalBusinesses).toBe(10);
      expect(stats.overview.totalCustomers).toBe(25);
      expect(stats.overview.totalServices).toBe(40);
      expect(stats.overview.totalInvoicedValue).toBe(45000);
      expect(stats.overview.arr).toBe(2499);
      expect(stats.overview.mrr).toBe(208);
    });
  });
});
