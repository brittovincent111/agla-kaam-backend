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
import { TeamMember } from '../team-members/schemas/team-member.schema';
import { ExpoPushService } from '../common/push/expo-push.service';

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
      exec: jest
        .fn()
        .mockResolvedValue([
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
        {
          provide: getModelToken(Subscription.name),
          useValue: mockSubscriptionModel,
        },
        { provide: getModelToken(Customer.name), useValue: mockCustomerModel },
        { provide: getModelToken(Service.name), useValue: mockServiceModel },
        { provide: getModelToken(Invoice.name), useValue: mockInvoiceModel },
        {
          provide: getModelToken(AppFeedback.name),
          useValue: mockFeedbackModel,
        },
        { provide: getModelToken(TeamMember.name), useValue: {} },
        { provide: ExpoPushService, useValue: { send: jest.fn() } },
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
      expect(stats.overview.arr).toBe(1149);
      expect(stats.overview.mrr).toBe(96);
    });
  });
});

describe('AdminService.broadcastPushNotification', () => {
  const chain = (result: unknown) => ({
    select: () => ({ lean: () => ({ exec: async () => result }) }),
    distinct: () => ({ exec: async () => ['b1'] }),
  });

  function build(opts: { invalid?: string[] } = {}) {
    const businessFind = jest.fn((_filter: unknown) =>
      chain([
        { pushToken: 'owner-new', pushTokens: ['owner-old', 'owner-new'] },
        { pushToken: 'owner-2' },
      ]),
    );
    const businessUpdate = jest.fn(() => ({ exec: async () => ({}) }));
    const staffFind = jest.fn((_filter: unknown) =>
      chain([{ pushToken: 'tech-1' }]),
    );
    const staffUpdate = jest.fn(() => ({ exec: async () => ({}) }));
    const send = jest.fn(async (messages: { to: string; data?: unknown }[]) => ({
      sent: messages.length - (opts.invalid?.length ?? 0),
      failed: opts.invalid?.length ?? 0,
      invalidTokens: opts.invalid ?? [],
    }));
    const service = new AdminService(
      {} as never,
      {} as never,
      { find: businessFind, updateMany: businessUpdate } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { find: staffFind, updateMany: staffUpdate } as never,
      { send } as never,
    );
    return { service, businessFind, businessUpdate, staffFind, staffUpdate, send };
  }

  it('reaches every owner phone and every staff phone once', async () => {
    const { service, send } = build();
    const result = await service.broadcastPushNotification('Hi', 'There');
    const to = send.mock.calls[0][0].map((m: { to: string }) => m.to).sort();
    expect(to).toEqual(['owner-2', 'owner-new', 'owner-old', 'tech-1']);
    expect(result.sentCount).toBe(4);
  });

  it('sends to owners only when asked', async () => {
    const { service, send, staffFind } = build();
    await service.broadcastPushNotification('Hi', 'There', undefined, 'owners');
    expect(staffFind).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0]).toHaveLength(3);
  });

  it('sends to staff only when asked', async () => {
    const { service, send } = build();
    await service.broadcastPushNotification('Hi', 'There', undefined, 'staff');
    expect(send.mock.calls[0][0].map((m: { to: string }) => m.to)).toEqual(['tech-1']);
  });

  it('matches a trade by how the app saves it, ignoring case and specialty', async () => {
    const { service, businessFind } = build();
    await service.broadcastPushNotification('Hi', 'There', 'AC repair', 'owners');
    const filter = businessFind.mock.calls[0][0] as { tradeType: { $regex: string } };
    const re = new RegExp(filter.tradeType.$regex, 'i');
    expect(re.test('AC repair • split ACs')).toBe(true);
    expect(re.test('ac repair')).toBe(true);
    expect(re.test('RO / water purifier')).toBe(false);
  });

  it('forgets phones that uninstalled the app', async () => {
    const { service, businessUpdate, staffUpdate } = build({ invalid: ['owner-old'] });
    const result = await service.broadcastPushNotification('Hi', 'There');
    expect(businessUpdate).toHaveBeenCalledTimes(2);
    expect(staffUpdate).toHaveBeenCalledTimes(1);
    expect(result.removedCount).toBe(1);
    expect(result.message).toContain('uninstalled');
  });

  it('sends the screen to open with the push', async () => {
    const { service, send } = build();
    await service.broadcastPushNotification('New', 'Try it', undefined, 'all', 'CalculatorHub');
    expect(send.mock.calls[0][0][0].data).toEqual({ type: 'broadcast', screen: 'CalculatorHub' });
  });

  it('refuses an unknown screen or a non-https link before sending', async () => {
    const { service, send } = build();
    await expect(
      service.broadcastPushNotification('a', 'b', undefined, 'all', 'Nowhere'),
    ).rejects.toThrow('Unknown screen');
    await expect(
      service.broadcastPushNotification('a', 'b', undefined, 'all', 'Link', 'http://x.com'),
    ).rejects.toThrow('https://');
    expect(send).not.toHaveBeenCalled();
  });

  it('carries a web link', async () => {
    const { service, send } = build();
    await service.broadcastPushNotification('a', 'b', undefined, 'all', 'Link', ' https://aglakaam.com/new ');
    expect(send.mock.calls[0][0][0].data).toEqual({
      type: 'broadcast',
      screen: 'Link',
      url: 'https://aglakaam.com/new',
    });
  });
});
