import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import {
  PaymentOrder,
  PaymentOrderSchema,
} from './schemas/payment-order.schema';
import {
  PlayPurchase,
  PlayPurchaseSchema,
} from './schemas/play-purchase.schema';
import {
  ApplePurchase,
  ApplePurchaseSchema,
} from './schemas/apple-purchase.schema';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { GooglePlayVerificationService } from './google-play-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { BusinessesModule } from '../businesses/businesses.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: PlayPurchase.name, schema: PlayPurchaseSchema },
      { name: ApplePurchase.name, schema: ApplePurchaseSchema },
    ]),
    BusinessesModule,
  ],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    GooglePlayVerificationService,
    AppleVerificationService,
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
