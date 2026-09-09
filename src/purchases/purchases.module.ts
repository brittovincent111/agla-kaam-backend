import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';
import { PurchasesService } from './purchases.service';
import { PurchasesController } from './purchases.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { BusinessesModule } from '../businesses/businesses.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Purchase.name, schema: PurchaseSchema },
    ]),
    InventoryModule,
    BusinessesModule,
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
