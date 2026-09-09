import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProformaInvoice, ProformaInvoiceSchema } from './schemas/proforma-invoice.schema';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { ProformaPdfService } from './proforma-pdf.service';
import { ProformaInvoicesController } from './proforma-invoices.controller';
import { BusinessesModule } from '../businesses/businesses.module';
import { CustomersModule } from '../customers/customers.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProformaInvoice.name, schema: ProformaInvoiceSchema },
    ]),
    BusinessesModule,
    CustomersModule,
    InvoicingModule,
    SubscriptionsModule,
  ],
  controllers: [ProformaInvoicesController],
  providers: [ProformaInvoicesService, ProformaPdfService],
  exports: [ProformaInvoicesService, ProformaPdfService],
})
export class ProformaInvoicesModule {}
