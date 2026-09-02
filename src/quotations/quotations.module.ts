import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Quotation, QuotationSchema } from './schemas/quotation.schema';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';
import { QuotationPdfService } from './quotation-pdf.service';
import { CustomersModule } from '../customers/customers.module';
import { ServicesModule } from '../services/services.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InvoicingModule } from '../invoicing/invoicing.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Quotation.name, schema: QuotationSchema }]),
    CustomersModule,
    ServicesModule,
    BusinessesModule,
    SubscriptionsModule,
    InvoicingModule,
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationPdfService],
  exports: [QuotationsService, QuotationPdfService],
})
export class QuotationsModule {}
