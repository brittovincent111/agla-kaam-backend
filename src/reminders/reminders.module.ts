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
import { ShortLinksModule } from '../short-links/short-links.module';
import { ExpoPushService } from '../common/push/expo-push.service';
import {
  Business,
  BusinessSchema,
} from '../businesses/schemas/business.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Invoice, InvoiceSchema } from '../invoicing/schemas/invoice.schema';
import { OnboardingPushService } from './onboarding-push.service';
import { ComebackPushService } from './comeback-push.service';
import { EmailService } from '../common/email/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Invoice.name, schema: InvoiceSchema },
    ]),
    ServicesModule,
    CustomersModule,
    BusinessesModule,
    ServicePresetsModule,
    InvoicingModule,
    TeamMembersModule,
    ShortLinksModule,
  ],
  controllers: [RemindersController],
  providers: [RemindersService, ExpoPushService, OnboardingPushService, ComebackPushService, EmailService],
})
export class RemindersModule {}
