import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';
import { PurchasesService } from './purchases.service';
import { PurchasesController } from './purchases.controller';
import { PurchasePdfService } from './purchase-pdf.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { BusinessesModule } from '../businesses/businesses.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Purchase.name, schema: PurchaseSchema },
    ]),
    InventoryModule,
    BusinessesModule,
    SubscriptionsModule,
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService, PurchasePdfService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
