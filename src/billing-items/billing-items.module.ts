import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from '../invoicing/schemas/invoice.schema';
import { Quotation, QuotationSchema } from '../quotations/schemas/quotation.schema';
import { BillingItemsService } from './billing-items.service';
import { BillingItemsController } from './billing-items.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Quotation.name, schema: QuotationSchema },
    ]),
  ],
  controllers: [BillingItemsController],
  providers: [BillingItemsService],
})
export class BillingItemsModule {}
