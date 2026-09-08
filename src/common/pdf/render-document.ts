import PDFDocument = require('pdfkit');
import {
  A4,
  Canvas,
  Ctx,
  DocumentSpec,
  PageGeometry,
  RenderBusiness,
  RenderCustomer,
} from './document-render';
import { DOCUMENT_LAYOUTS } from './document-layouts';
import { DocumentTemplateTheme } from './document-templates';

// Single entry point for producing an invoice or quotation PDF. The document
// type lives entirely in the DocumentSpec the caller builds; the theme picks
// which of the five layouts draws it.
//
// Pages are buffered so the footer can say "Page 2 of 3" — the total is only
// known once the body has finished flowing, so footers are painted in a
// second pass over the finished pages.
export function renderDocument(
  business: RenderBusiness,
  customer: RenderCustomer,
  spec: DocumentSpec,
  theme: DocumentTemplateTheme,
  geometry: PageGeometry = A4,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [geometry.width, geometry.height],
    margin: 0,
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const canvas = new Canvas(doc, geometry);
  const ctx: Ctx = {
    doc,
    theme,
    colors: theme.colors,
    business,
    customer,
    spec,
    geo: geometry,
    canvas,
  };

  const layout = DOCUMENT_LAYOUTS[theme.layout] ?? DOCUMENT_LAYOUTS.banded;
  canvas.attach(ctx, layout.continuation);
  layout.draw(ctx);

  // Second pass: footers, now that the page count is known.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    layout.footer(ctx, i + 1, range.count);
  }
  doc.flushPages();

  doc.end();
  return done;
}
