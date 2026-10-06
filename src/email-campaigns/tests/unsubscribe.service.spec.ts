import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { UnsubscribeService } from '../services/unsubscribe.service';
import { Lead } from '../../lead-finder/schemas/lead.schema';
import { EmailCampaignRecipient } from '../schemas/email-campaign-recipient.schema';
import { EmailCampaign } from '../schemas/email-campaign.schema';
import { LeadActivity } from '../../lead-finder/schemas/lead-activity.schema';

describe('UnsubscribeService', () => {
  let service: UnsubscribeService;
  let mockLeadModel: any;
  let mockRecipientModel: any;
  let mockCampaignModel: any;
  let mockActivityModel: any;

  beforeEach(async () => {
    mockLeadModel = {
      findById: jest.fn(),
      updateMany: jest.fn(),
      findOne: jest.fn(),
    };
    mockRecipientModel = {
      updateMany: jest.fn(),
      updateOne: jest.fn(),
    };
    mockCampaignModel = {
      findByIdAndUpdate: jest.fn(),
    };
    mockActivityModel = {
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnsubscribeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET')
                return 'test_super_secret_jwt_key_1234567890';
              if (key === 'UNSUBSCRIBE_BASE_URL') return 'https://aglakaam.app';
              return null;
            }),
          },
        },
        { provide: getModelToken(Lead.name), useValue: mockLeadModel },
        {
          provide: getModelToken(EmailCampaignRecipient.name),
          useValue: mockRecipientModel,
        },
        {
          provide: getModelToken(EmailCampaign.name),
          useValue: mockCampaignModel,
        },
        {
          provide: getModelToken(LeadActivity.name),
          useValue: mockActivityModel,
        },
      ],
    }).compile();

    service = module.get<UnsubscribeService>(UnsubscribeService);
  });

  describe('token generation and verification', () => {
    it('generates a valid tamper-proof token and successfully verifies it', () => {
      const email = 'owner@coolbreezeac.com';
      const leadId = '64e8b8c2d9e1f2a3b4c5d6e7';

      const token = service.generateToken(email, leadId);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);

      const verified = service.verifyToken(token);
      expect(verified.email).toBe(email);
      expect(verified.leadId).toBe(leadId);
    });

    it('generates a valid tamper-proof token with campaignId and verifies it', () => {
      const email = 'owner@coolbreezeac.com';
      const leadId = '64e8b8c2d9e1f2a3b4c5d6e7';
      const campaignId = '64e8b8c2d9e1f2a3b4c5d6e8';

      const token = service.generateToken(email, leadId, campaignId);
      const verified = service.verifyToken(token);
      expect(verified.email).toBe(email);
      expect(verified.leadId).toBe(leadId);
      expect(verified.campaignId).toBe(campaignId);
    });

    it('rejects tampered tokens', () => {
      const email = 'victim@example.com';
      const leadId = '64e8b8c2d9e1f2a3b4c5d6e7';

      const token = service.generateToken(email, leadId);

      // Tamper with the base64url content
      const tampered = token.slice(0, -4) + 'abcd';

      expect(() => service.verifyToken(tampered)).toThrow(BadRequestException);
    });
  });

  describe('processUnsubscribe', () => {
    it('marks lead as unsubscribed and updates queued campaign recipients', async () => {
      const email = 'info@acservice.in';
      const leadId = '64e8b8c2d9e1f2a3b4c5d6e7';
      const token = service.generateToken(email, leadId);

      const mockLeadDoc: any = {
        _id: leadId,
        isEmailUnsubscribed: false,
        save: jest.fn().mockResolvedValue(true),
      };
      mockLeadModel.findById.mockResolvedValue(mockLeadDoc);
      mockRecipientModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.processUnsubscribe(token);

      expect(result.success).toBe(true);
      expect(result.email).toBe(email);
      expect(mockLeadDoc.isEmailUnsubscribed).toBe(true);
      expect(mockLeadDoc.save).toHaveBeenCalled();
      expect(mockRecipientModel.updateMany).toHaveBeenCalledWith(
        {
          email,
          status: { $in: ['PENDING', 'QUEUED'] },
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'UNSUBSCRIBED',
          }),
        }),
      );
    });
  });

  describe('isEmailSuppressed', () => {
    it('identifies suppressed leads', async () => {
      mockLeadModel.findOne.mockResolvedValue({
        _id: '123',
        isEmailUnsubscribed: true,
      });
      const suppressed = await service.isEmailSuppressed('unsub@test.com');
      expect(suppressed).toBe(true);
    });

    it('returns false for clean leads', async () => {
      mockLeadModel.findOne.mockResolvedValue(null);
      const suppressed = await service.isEmailSuppressed('clean@test.com');
      expect(suppressed).toBe(false);
    });
  });
});
