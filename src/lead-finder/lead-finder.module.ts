import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from './schemas/lead.schema';
import { LeadActivity, LeadActivitySchema } from './schemas/lead-activity.schema';
import {
  LeadSearchJob,
  LeadSearchJobSchema,
} from './schemas/lead-search-job.schema';
import {
  LeadSchedule,
  LeadScheduleSchema,
} from './schemas/lead-schedule.schema';
import {
  LeadProviderUsage,
  LeadProviderUsageSchema,
} from './schemas/lead-provider-usage.schema';
import { GooglePlacesProvider } from './providers/google-places.provider';
import { ApprovedBusinessDirectoryProvider } from './providers/approved-directory.provider';
import { LeadProviderRegistry } from './providers/provider-registry.service';
import { DeduplicationService } from './deduplication.service';
import { ProviderUsageService } from './provider-usage.service';
import { LeadSearchJobService } from './lead-search-job.service';
import { LeadScheduleService } from './lead-schedule.service';
import { LeadFinderService } from './lead-finder.service';
import { LeadFinderController } from './lead-finder.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: LeadActivity.name, schema: LeadActivitySchema },
      { name: LeadSearchJob.name, schema: LeadSearchJobSchema },
      { name: LeadSchedule.name, schema: LeadScheduleSchema },
      { name: LeadProviderUsage.name, schema: LeadProviderUsageSchema },
    ]),
  ],
  controllers: [LeadFinderController],
  providers: [
    GooglePlacesProvider,
    ApprovedBusinessDirectoryProvider,
    LeadProviderRegistry,
    DeduplicationService,
    ProviderUsageService,
    LeadSearchJobService,
    LeadScheduleService,
    LeadFinderService,
  ],
  exports: [LeadFinderService, LeadSearchJobService, DeduplicationService],
})
export class LeadFinderModule {}
