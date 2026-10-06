import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmailCampaign,
  EmailCampaignSchema,
} from './schemas/email-campaign.schema';
import {
  EmailCampaignRecipient,
  EmailCampaignRecipientSchema,
} from './schemas/email-campaign-recipient.schema';
import { Lead, LeadSchema } from '../lead-finder/schemas/lead.schema';
import {
  LeadActivity,
  LeadActivitySchema,
} from '../lead-finder/schemas/lead-activity.schema';
import { SesService } from './services/ses.service';
import { TemplateEngineService } from './services/template-engine.service';
import { UnsubscribeService } from './services/unsubscribe.service';
import { EmailCampaignQueueService } from './services/email-campaign-queue.service';
import { EmailCampaignService } from './services/email-campaign.service';
import { EmailCampaignController } from './email-campaign.controller';
import { EmailWebhookController } from './email-webhook.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailCampaign.name, schema: EmailCampaignSchema },
      {
        name: EmailCampaignRecipient.name,
        schema: EmailCampaignRecipientSchema,
      },
      { name: Lead.name, schema: LeadSchema },
      { name: LeadActivity.name, schema: LeadActivitySchema },
    ]),
  ],
  controllers: [EmailCampaignController, EmailWebhookController],
  providers: [
    SesService,
    TemplateEngineService,
    UnsubscribeService,
    EmailCampaignQueueService,
    EmailCampaignService,
  ],
  exports: [
    EmailCampaignService,
    SesService,
    UnsubscribeService,
    EmailCampaignQueueService,
  ],
})
export class EmailCampaignsModule {}
