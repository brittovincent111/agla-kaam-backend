import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from '../invoicing/schemas/invoice.schema';
import { Payment, PaymentSchema } from '../invoicing/schemas/payment.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Amc, AmcSchema } from '../amc/schemas/amc.schema';
import {
  InventoryItem,
  InventoryItemSchema,
} from '../inventory/schemas/inventory-item.schema';
import { Purchase, PurchaseSchema } from '../purchases/schemas/purchase.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import {
  Business,
  BusinessSchema,
} from '../businesses/schemas/business.schema';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Amc.name, schema: AmcSchema },
      { name: InventoryItem.name, schema: InventoryItemSchema },
      { name: Purchase.name, schema: PurchaseSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
