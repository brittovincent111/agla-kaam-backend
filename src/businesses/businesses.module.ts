import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from './schemas/business.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Invoice, InvoiceSchema } from '../invoicing/schemas/invoice.schema';
import { Payment, PaymentSchema } from '../invoicing/schemas/payment.schema';
import {
  Quotation,
  QuotationSchema,
} from '../quotations/schemas/quotation.schema';
import {
  ServicePreset,
  ServicePresetSchema,
} from '../service-presets/schemas/service-preset.schema';
import {
  TeamMember,
  TeamMemberSchema,
} from '../team-members/schemas/team-member.schema';
import {
  Subscription,
  SubscriptionSchema,
} from '../subscriptions/schemas/subscription.schema';
import {
  PaymentOrder,
  PaymentOrderSchema,
} from '../subscriptions/schemas/payment-order.schema';
import {
  AppFeedback,
  AppFeedbackSchema,
} from '../app-feedback/schemas/app-feedback.schema';
import { ServicePresetsModule } from '../service-presets/service-presets.module';
import { BusinessesService } from './businesses.service';
import { BusinessesController } from './businesses.controller';
import { S3Service } from '../common/s3/s3.service';

@Module({
  imports: [
    // Registered directly (schema only, not the owning feature module) so
    // BusinessesService can cascade-delete every business-scoped collection
    // on account deletion without creating a circular module dependency —
    // every one of these feature modules already imports BusinessesModule
    // (directly or transitively through SubscriptionsModule).
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Quotation.name, schema: QuotationSchema },
      { name: ServicePreset.name, schema: ServicePresetSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: AppFeedback.name, schema: AppFeedbackSchema },
    ]),
    ServicePresetsModule,
  ],
  controllers: [BusinessesController],
  providers: [BusinessesService, S3Service],
  exports: [BusinessesService],
})
export class BusinessesModule {}
