import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { ServicesModule } from '../services/services.module';
import { CustomersModule } from '../customers/customers.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { ServicePresetsModule } from '../service-presets/service-presets.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { TeamMembersModule } from '../team-members/team-members.module';
import { ExpoPushService } from '../common/push/expo-push.service';
import {
  Business,
  BusinessSchema,
} from '../businesses/schemas/business.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
    ]),
    ServicesModule,
    CustomersModule,
    BusinessesModule,
    ServicePresetsModule,
    InvoicingModule,
    TeamMembersModule,
  ],
  controllers: [RemindersController],
  providers: [RemindersService, ExpoPushService],
})
export class RemindersModule {}
