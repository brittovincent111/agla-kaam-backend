import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { InvoicePdfService } from './invoice-pdf.service';
import { CustomersModule } from '../customers/customers.module';
import { ServicesModule } from '../services/services.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
    CustomersModule,
    ServicesModule,
    BusinessesModule,
    SubscriptionsModule,
  ],
  controllers: [InvoicingController],
  providers: [InvoicingService, InvoicePdfService],
  exports: [InvoicingService, InvoicePdfService],
})
export class InvoicingModule {}
