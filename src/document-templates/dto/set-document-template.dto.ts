import { IsIn } from 'class-validator';
import { DOCUMENT_TEMPLATE_IDS, DocumentTemplateId } from '../../common/pdf/document-templates';

export class SetDocumentTemplateDto {
  @IsIn(DOCUMENT_TEMPLATE_IDS)
  templateId: DocumentTemplateId;
}
