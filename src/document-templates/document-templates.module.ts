import { Module } from '@nestjs/common';
import { DocumentTemplatesController } from './document-templates.controller';
import { BusinessesModule } from '../businesses/businesses.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { QuotationsModule } from '../quotations/quotations.module';

@Module({
  imports: [BusinessesModule, SubscriptionsModule, InvoicingModule, QuotationsModule],
  controllers: [DocumentTemplatesController],
})
export class DocumentTemplatesModule {}
