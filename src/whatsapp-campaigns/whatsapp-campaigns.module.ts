import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsappCampaign, WhatsappCampaignSchema } from './schemas/whatsapp-campaign.schema';
import { WhatsappRecipient, WhatsappRecipientSchema } from './schemas/whatsapp-recipient.schema';
import { WhatsappMessage, WhatsappMessageSchema } from './schemas/whatsapp-message.schema';
import { Lead, LeadSchema } from '../lead-finder/schemas/lead.schema';
import { WhatsappCloudService } from './services/whatsapp-cloud.service';
import { WhatsappQueueService } from './services/whatsapp-queue.service';
import { WhatsappCampaignService } from './services/whatsapp-campaign.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';
import { WhatsappAdminController } from './whatsapp-admin.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappLinkController } from './whatsapp-link.controller';
import { WhatsappBotService } from './services/whatsapp-bot.service';
import { EmailService } from '../common/email/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsappCampaign.name, schema: WhatsappCampaignSchema },
      { name: WhatsappRecipient.name, schema: WhatsappRecipientSchema },
      { name: WhatsappMessage.name, schema: WhatsappMessageSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
  ],
  controllers: [WhatsappAdminController, WhatsappWebhookController, WhatsappLinkController],
  providers: [
    WhatsappCloudService,
    WhatsappQueueService,
    WhatsappCampaignService,
    WhatsappWebhookService,
    WhatsappBotService,
    EmailService,
  ],
  exports: [WhatsappCloudService, WhatsappCampaignService, WhatsappQueueService],
})
export class WhatsappCampaignsModule {}
