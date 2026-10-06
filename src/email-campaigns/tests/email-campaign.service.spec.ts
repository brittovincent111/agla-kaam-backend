import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EmailCampaignService } from '../services/email-campaign.service';
import { EmailCampaign } from '../schemas/email-campaign.schema';
import { EmailCampaignRecipient } from '../schemas/email-campaign-recipient.schema';
import { Lead } from '../../lead-finder/schemas/lead.schema';
import { EmailCampaignQueueService } from '../services/email-campaign-queue.service';
import { SesService } from '../services/ses.service';
import { TemplateEngineService } from '../services/template-engine.service';
import { UnsubscribeService } from '../services/unsubscribe.service';

describe('EmailCampaignService', () => {
  let service: EmailCampaignService;
  let mockCampaignModel: any;
  let mockRecipientModel: any;
  let mockLeadModel: any;
  let mockQueueService: any;
  let mockSesService: any;

  beforeEach(async () => {
    mockCampaignModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      _id: new Types.ObjectId(),
      save: jest.fn().mockResolvedValue({ ...dto, _id: new Types.ObjectId() }),
    }));
    mockCampaignModel.findById = jest.fn();
    mockCampaignModel.find = jest.fn();
    mockCampaignModel.countDocuments = jest.fn();
    mockCampaignModel.findByIdAndDelete = jest.fn();

    mockRecipientModel = {
      deleteMany: jest.fn(),
      insertMany: jest.fn(),
      countDocuments: jest.fn(),
      find: jest.fn(),
    };

    mockLeadModel = {
      aggregate: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
    };

    mockQueueService = {
      startProcessingCampaign: jest.fn(),
    };

    mockSesService = {
      getDefaultSender: jest.fn().mockReturnValue('marketing@aglakaam.app'),
      sendEmail: jest.fn().mockResolvedValue({ messageId: 'ses-msg-12345' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailCampaignService,
        {
          provide: getModelToken(EmailCampaign.name),
          useValue: mockCampaignModel,
        },
        {
          provide: getModelToken(EmailCampaignRecipient.name),
          useValue: mockRecipientModel,
        },
        { provide: getModelToken(Lead.name), useValue: mockLeadModel },
        { provide: EmailCampaignQueueService, useValue: mockQueueService },
        { provide: SesService, useValue: mockSesService },
        TemplateEngineService,
        {
          provide: UnsubscribeService,
          useValue: {
            buildUnsubscribeUrl: jest
              .fn()
              .mockReturnValue('https://aglakaam.app/unsub'),
          },
        },
      ],
    }).compile();

    service = module.get<EmailCampaignService>(EmailCampaignService);
  });

  describe('createCampaign', () => {
    it('creates a new campaign in DRAFT state with default sender', async () => {
      const result = await service.createCampaign(
        {
          name: 'Summer AC Promo',
          subject: 'Special offer for AC repair businesses',
          htmlContent: '<h1>Grow your business with Agla Kaam</h1>',
        },
        'AdminUser',
      );

      expect(result).toBeDefined();
      expect(mockCampaignModel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Summer AC Promo',
          status: 'DRAFT',
          senderEmail: 'marketing@aglakaam.app',
          createdBy: 'AdminUser',
        }),
      );
    });
  });

  describe('updateCampaign', () => {
    it('prevents updating a campaign that is already SENDING', async () => {
      mockCampaignModel.findById.mockResolvedValue({
        _id: new Types.ObjectId(),
        status: 'SENDING',
      });

      await expect(
        service.updateCampaign('64e8b8c2d9e1f2a3b4c5d6e7', {
          name: 'New Name',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('startCampaign and deduplication', () => {
    it('deduplicates multiple leads sharing the same email address', async () => {
      const campaignId = new Types.ObjectId();
      const mockCampaignDoc: any = {
        _id: campaignId,
        name: 'Launch',
        status: 'DRAFT',
        save: jest.fn().mockResolvedValue(true),
      };
      mockCampaignModel.findById.mockResolvedValue(mockCampaignDoc);

      // Aggregation pipeline returns unique emails (2 distinct businesses, duplicate email consolidated)
      const mockDeduplicatedLeads = [
        {
          leadId: new Types.ObjectId(),
          email: 'contact@acrepairs.com',
          businessName: 'AC Repairs Branch 1',
        },
        {
          leadId: new Types.ObjectId(),
          email: 'service@refrigeration.com',
          businessName: 'Chill Tech',
        },
      ];
      mockLeadModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockDeduplicatedLeads),
      });

      mockRecipientModel.deleteMany.mockResolvedValue(true);
      mockRecipientModel.insertMany.mockResolvedValue(true);
      mockRecipientModel.countDocuments.mockResolvedValue(2);

      const result = await service.startCampaign(campaignId.toString());

      expect(result.status).toBe('QUEUED');
      expect(result.totalRecipients).toBe(2);
      expect(mockRecipientModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ email: 'contact@acrepairs.com' }),
          expect.objectContaining({ email: 'service@refrigeration.com' }),
        ]),
        { ordered: false },
      );
      expect(mockQueueService.startProcessingCampaign).toHaveBeenCalledWith(
        campaignId.toString(),
      );
    });
  });

  describe('sendTestEmail', () => {
    it('dispatches test email without altering campaign counters or creating recipients', async () => {
      const campaignId = new Types.ObjectId();
      mockCampaignModel.findById.mockResolvedValue({
        _id: campaignId,
        subject: 'Special offer {{name}}',
        htmlContent: '<p>Hi {{name}}</p>',
        senderName: 'Agla Kaam',
        senderEmail: 'marketing@aglakaam.app',
      });

      mockLeadModel.findOne.mockResolvedValue({
        businessName: 'Test Tech',
        city: 'Delhi',
      });

      const result = await service.sendTestEmail(campaignId.toString(), {
        email: 'tester@aglakaam.app',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('ses-msg-12345');
      expect(mockSesService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'tester@aglakaam.app',
          subject: '[TEST] Special offer Test Tech',
        }),
      );
      // Ensure recipient model is NOT called
      expect(mockRecipientModel.insertMany).not.toHaveBeenCalled();
    });
  });
});
