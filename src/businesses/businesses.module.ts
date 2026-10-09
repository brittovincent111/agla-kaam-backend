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
import { Purchase, PurchaseSchema } from '../purchases/schemas/purchase.schema';
import {
  ProformaInvoice,
  ProformaInvoiceSchema,
} from '../proforma-invoices/schemas/proforma-invoice.schema';
import { Amc, AmcSchema } from '../amc/schemas/amc.schema';
import {
  InventoryItem,
  InventoryItemSchema,
} from '../inventory/schemas/inventory-item.schema';
import { Supplier, SupplierSchema } from '../suppliers/schemas/supplier.schema';
import {
  ApplePurchase,
  ApplePurchaseSchema,
} from '../subscriptions/schemas/apple-purchase.schema';
import {
  PlayPurchase,
  PlayPurchaseSchema,
} from '../subscriptions/schemas/play-purchase.schema';
import {
  QuickNote,
  QuickNoteSchema,
} from '../quick-notes/schemas/quick-note.schema';
import { ServicePresetsModule } from '../service-presets/service-presets.module';
import { BusinessesService } from './businesses.service';
import { BusinessesController } from './businesses.controller';
import { S3Service } from '../common/s3/s3.service';
import { AppleSignInService } from '../common/apple/apple-sign-in.service';

import { OwnerSessionsService } from './owner-sessions.service';
import { ExpoPushService } from '../common/push/expo-push.service';

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
      // Also read to check a "next number" setting against the numbers
      // already used (assertNextSerialsAhead).
      { name: Purchase.name, schema: PurchaseSchema },
      { name: ProformaInvoice.name, schema: ProformaInvoiceSchema },
      { name: Amc.name, schema: AmcSchema },
      { name: InventoryItem.name, schema: InventoryItemSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: ApplePurchase.name, schema: ApplePurchaseSchema },
      { name: PlayPurchase.name, schema: PlayPurchaseSchema },
      { name: QuickNote.name, schema: QuickNoteSchema },
    ]),
    ServicePresetsModule,
  ],
  controllers: [BusinessesController],
  providers: [
    BusinessesService,
    S3Service,
    AppleSignInService,
    OwnerSessionsService,
    ExpoPushService,
  ],
  exports: [BusinessesService, OwnerSessionsService],
})
export class BusinessesModule {}
