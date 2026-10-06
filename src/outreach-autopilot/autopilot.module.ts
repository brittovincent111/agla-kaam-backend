import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AutopilotDay,
  AutopilotDaySchema,
  AutopilotRegion,
  AutopilotRegionSchema,
  AutopilotSettings,
  AutopilotSettingsSchema,
} from './schemas/autopilot.schemas';
import { Lead, LeadSchema } from '../lead-finder/schemas/lead.schema';
import { LeadSearchJob, LeadSearchJobSchema } from '../lead-finder/schemas/lead-search-job.schema';
import { WhatsappRecipient, WhatsappRecipientSchema } from '../whatsapp-campaigns/schemas/whatsapp-recipient.schema';
import { WhatsappCampaign, WhatsappCampaignSchema } from '../whatsapp-campaigns/schemas/whatsapp-campaign.schema';
import {
  EmailCampaignRecipient,
  EmailCampaignRecipientSchema,
} from '../email-campaigns/schemas/email-campaign-recipient.schema';
import { EmailCampaign, EmailCampaignSchema } from '../email-campaigns/schemas/email-campaign.schema';
import { LeadFinderModule } from '../lead-finder/lead-finder.module';
import { WhatsappCampaignsModule } from '../whatsapp-campaigns/whatsapp-campaigns.module';
import { EmailCampaignsModule } from '../email-campaigns/email-campaigns.module';
import { AutopilotService } from './autopilot.service';
import { AutopilotCron } from './autopilot.cron';
import { AutopilotController } from './autopilot.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AutopilotRegion.name, schema: AutopilotRegionSchema },
      { name: AutopilotSettings.name, schema: AutopilotSettingsSchema },
      { name: AutopilotDay.name, schema: AutopilotDaySchema },
      { name: Lead.name, schema: LeadSchema },
      { name: LeadSearchJob.name, schema: LeadSearchJobSchema },
      { name: WhatsappRecipient.name, schema: WhatsappRecipientSchema },
      { name: WhatsappCampaign.name, schema: WhatsappCampaignSchema },
      { name: EmailCampaignRecipient.name, schema: EmailCampaignRecipientSchema },
      { name: EmailCampaign.name, schema: EmailCampaignSchema },
    ]),
    LeadFinderModule,
    WhatsappCampaignsModule,
    EmailCampaignsModule,
  ],
  controllers: [AutopilotController],
  providers: [AutopilotService, AutopilotCron],
})
export class AutopilotModule {}
