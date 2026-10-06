import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { calculateInvoiceTotals } from './invoice-options';

// The app shows a live total while an invoice, quotation or proforma is being
// written, from its own copy of calculateInvoiceTotals (mobile has no test
// runner). That copy used to tax the pre-discount amount, so with a discount
// the total on screen differed from the one saved and printed on the PDF.
// This loads the app's copy and holds it to the backend's figures.
//
// Loaded by transpiling the source rather than importing it: the file sits in
// another project, and its type-only imports (react-native theme types) do
// not resolve from here.
// Skipped where the app's source is not alongside (a backend-only checkout).
const MOBILE_FILE = join(__dirname, '../../../../mobile/src/invoiceStatus.ts');
const describeIfApp = existsSync(MOBILE_FILE) ? describe : describe.skip;

function loadMobileTotals(): typeof calculateInvoiceTotals {
  const file = MOBILE_FILE;
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', outputText)(
    module,
    module.exports,
    () => ({}),
  );
  return module.exports.calculateInvoiceTotals as typeof calculateInvoiceTotals;
}

const cases: {
  name: string;
  items: { quantity: number; rate: number; taxRate?: number }[];
  discount: number;
}[] = [
  {
    name: 'no discount',
    items: [{ quantity: 2, rate: 450, taxRate: 18 }],
    discount: 0,
  },
  {
    name: 'the Rs.10,000 / 18% / Rs.2,000 discount example',
    items: [{ quantity: 1, rate: 10000, taxRate: 18 }],
    discount: 2000,
  },
  {
    name: 'mixed rates sharing an uneven discount',
    items: [
      { quantity: 3, rate: 333.33, taxRate: 18 },
      { quantity: 1, rate: 1250, taxRate: 5 },
      { quantity: 7, rate: 19.99, taxRate: 0 },
    ],
    discount: 101.01,
  },
  {
    name: 'discount larger than the goods',
    items: [{ quantity: 1, rate: 500, taxRate: 12 }],
    discount: 900,
  },
  {
    name: 'fractional quantities',
    items: [
      { quantity: 2.5, rate: 99.99, taxRate: 28 },
      { quantity: 0.75, rate: 1200, taxRate: 18 },
    ],
    discount: 33.33,
  },
];

describeIfApp('mobile calculateInvoiceTotals matches the backend', () => {
  const mobileTotals = existsSync(MOBILE_FILE) ? loadMobileTotals() : null!;
  it.each(cases)('$name', ({ items, discount }) => {
    const backend = calculateInvoiceTotals(items, discount);
    const app = mobileTotals(items, discount);
    expect(app.subtotal).toBe(backend.subtotal);
    expect(app.discount).toBe(backend.discount);
    expect(app.taxTotal).toBe(backend.taxTotal);
    expect(app.total).toBe(backend.total);
  });
});
