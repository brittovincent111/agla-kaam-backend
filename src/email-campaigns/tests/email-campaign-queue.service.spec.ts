import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { EmailCampaignQueueService } from '../services/email-campaign-queue.service';
import { EmailCampaign } from '../schemas/email-campaign.schema';
import { EmailCampaignRecipient } from '../schemas/email-campaign-recipient.schema';
import { Lead } from '../../lead-finder/schemas/lead.schema';
import { SesService } from '../services/ses.service';
import { TemplateEngineService } from '../services/template-engine.service';
import { UnsubscribeService } from '../services/unsubscribe.service';

describe('EmailCampaignQueueService', () => {
  let queueService: EmailCampaignQueueService;
  let mockCampaignModel: any;
  let mockRecipientModel: any;
  let mockLeadModel: any;
  let mockSesService: any;
  let mockTemplateEngine: any;
  let mockUnsubscribeService: any;

  beforeEach(async () => {
    mockCampaignModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn().mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      }),
    };

    mockRecipientModel = {
      find: jest.fn(),
      updateMany: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    mockLeadModel = {
      findById: jest.fn(),
    };

    mockSesService = {
      sendEmail: jest.fn().mockResolvedValue({ messageId: 'msg-abc-123' }),
    };

    mockTemplateEngine = {
      render: jest.fn((str) => str),
      compileHtml: jest.fn((str) => str),
      compileText: jest.fn((str) => str),
    };

    mockUnsubscribeService = {
      buildUnsubscribeUrl: jest
        .fn()
        .mockReturnValue('https://aglakaam.app/unsub'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailCampaignQueueService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SES_RATE_LIMIT_PER_SECOND') return '50';
              if (key === 'SES_BATCH_SIZE') return '10';
              if (key === 'SES_MAX_RETRIES') return '3';
              if (key === 'SES_RETRY_DELAY_MS') return '500';
              return null;
            }),
          },
        },
        {
          provide: getModelToken(EmailCampaign.name),
          useValue: mockCampaignModel,
        },
        {
          provide: getModelToken(EmailCampaignRecipient.name),
          useValue: mockRecipientModel,
        },
        { provide: getModelToken(Lead.name), useValue: mockLeadModel },
        { provide: SesService, useValue: mockSesService },
        { provide: TemplateEngineService, useValue: mockTemplateEngine },
        { provide: UnsubscribeService, useValue: mockUnsubscribeService },
      ],
    }).compile();

    queueService = module.get<EmailCampaignQueueService>(
      EmailCampaignQueueService,
    );
  });

  describe('syncCampaignCounters', () => {
    it('aggregates live counts from recipient documents onto campaign', async () => {
      const campaignId = new Types.ObjectId();
      mockRecipientModel.countDocuments
        .mockResolvedValueOnce(15) // sent
        .mockResolvedValueOnce(2) // failed
        .mockResolvedValueOnce(10) // delivered
        .mockResolvedValueOnce(1) // bounced
        .mockResolvedValueOnce(0) // complained
        .mockResolvedValueOnce(1) // unsubscribed
        .mockResolvedValueOnce(0); // queued

      await queueService.syncCampaignCounters(campaignId);

      expect(mockCampaignModel.findByIdAndUpdate).toHaveBeenCalledWith(
        campaignId,
        {
          $set: {
            sentCount: 15,
            failedCount: 2,
            deliveredCount: 10,
            bouncedCount: 1,
            complainedCount: 0,
            unsubscribedCount: 1,
            queuedCount: 0,
          },
        },
      );
    });
  });

  describe('recoverStaleLocks', () => {
    it('releases locked recipients stuck in SENDING for over 5 minutes back to QUEUED', async () => {
      mockRecipientModel.updateMany.mockResolvedValue({ modifiedCount: 4 });

      await queueService.recoverStaleLocks();

      expect(mockRecipientModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'SENDING',
          lockedAt: expect.any(Object),
        }),
        {
          $set: {
            status: 'QUEUED',
            lockedAt: undefined,
          },
        },
      );
    });
  });
});
