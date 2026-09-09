import { PartialType } from '@nestjs/mapped-types';
import { CreateProformaInvoiceDto } from './create-proforma-invoice.dto';

export class UpdateProformaInvoiceDto extends PartialType(CreateProformaInvoiceDto) {}
