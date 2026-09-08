import { IsIn, IsOptional, Matches, ValidateIf } from 'class-validator';
import { DOCUMENT_TEMPLATE_IDS, DocumentTemplateId } from '../../common/pdf/document-templates';

export class SetDocumentTemplateDto {
  @IsIn(DOCUMENT_TEMPLATE_IDS)
  templateId: DocumentTemplateId;

  // '#RRGGBB' or '#RGB' to set a custom accent, explicit null to clear it
  // back to the layout's default, omitted to leave the stored accent alone.
  // ValidateIf lets null through to mean "clear" while still rejecting any
  // other non-hex value.
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/, {
    message: 'accentColor must be a hex colour such as #2952CC.',
  })
  accentColor?: string | null;
}
