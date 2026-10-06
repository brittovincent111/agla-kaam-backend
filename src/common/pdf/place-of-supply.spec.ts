import {
  resolveGstSupply,
  stateFromAddress,
  stateFromGstin,
} from './place-of-supply';
import {
  buildTaxRows,
  gstHalves,
  splitGst,
  taxSummary,
  DocumentSpec,
} from './document-render';

describe('place of supply', () => {
  it('reads the state from a GSTIN', () => {
    expect(stateFromGstin('32BNSPC1961L1ZT')).toBe('Kerala');
    expect(stateFromGstin('29AAACS1234K1Z5')).toBe('Karnataka');
    expect(stateFromGstin('')).toBeUndefined();
  });

  it('reads the state from an address, by name, alias or unambiguous city', () => {
    expect(stateFromAddress('HSR Layout, Bangalore, Karnataka')).toBe(
      'Karnataka',
    );
    expect(stateFromAddress('BANGALORE')).toBe('Karnataka');
    expect(stateFromAddress('Plot 4, Bhubaneswar, Orissa')).toBe('Odisha');
    expect(stateFromAddress('MG Road, Kochi')).toBe('Kerala');
    expect(stateFromAddress('Somewhere unknown')).toBeUndefined();
  });

  it('does not match a state name inside another word', () => {
    expect(stateFromAddress('Goanna Street')).toBeUndefined();
  });

  it('treats different states as inter-state and prefers the customer GSTIN', () => {
    const supply = resolveGstSupply(
      'gst',
      'IN',
      { gstin: '32BNSPC1961L1ZT' },
      { gstin: '29AAACS1234K1Z5', address: 'Kochi' },
    );
    expect(supply).toEqual({
      businessState: 'Kerala',
      customerState: 'Karnataka',
      placeOfSupply: 'Karnataka',
      interState: true,
    });
  });

  it('falls back to intra-state when the customer cannot be placed', () => {
    const supply = resolveGstSupply(
      'gst',
      'IN',
      { gstin: '32BNSPC1961L1ZT' },
      { address: 'Near the temple' },
    );
    expect(supply?.interState).toBe(false);
    expect(supply?.placeOfSupply).toBe('Kerala');
  });

  it('is absent outside Indian GST', () => {
    expect(resolveGstSupply('vat', 'AE', {}, {})).toBeUndefined();
    expect(resolveGstSupply('none', 'IN', {}, {})).toBeUndefined();
  });
});

describe('GST tax rows', () => {
  const items = [
    {
      name: 'a',
      quantity: 1,
      rate: 100,
      taxRate: 18,
      amount: 100,
      taxAmount: 18.01,
    },
  ];

  it('charges IGST across states', () => {
    expect(buildTaxRows('gst', 18.01, items, { interState: true })).toEqual([
      { label: 'IGST (18%)', value: 18.01 },
    ]);
  });

  it('splits CGST + SGST so the halves add back to the tax', () => {
    const rows = buildTaxRows('gst', 18.01, items);
    expect(rows.map((r) => r.label)).toEqual(['CGST (9%)', 'SGST (9%)']);
    expect(rows[0].value + rows[1].value).toBeCloseTo(18.01, 10);
  });

  it('halves per rate, so totals agree with a per-rate summary', () => {
    const mixed = [
      { taxRate: 12, taxAmount: 1317.35 },
      { taxRate: 18, taxAmount: 3447.39 },
    ];
    const { central, state } = gstHalves(mixed, 4764.74);
    const rowCentral = splitGst(1317.35).central + splitGst(3447.39).central;
    expect(central).toBeCloseTo(rowCentral, 10);
    expect(central + state).toBeCloseTo(4764.74, 10);
  });

  it('summarises taxable value net of the allocated discount', () => {
    const spec = {
      discount: 100,
      items: [
        {
          name: 'a',
          quantity: 1,
          rate: 600,
          taxRate: 18,
          amount: 600,
          taxAmount: 90,
        },
        {
          name: 'b',
          quantity: 1,
          rate: 400,
          taxRate: 5,
          amount: 400,
          taxAmount: 18,
        },
      ],
    } as unknown as DocumentSpec;
    expect(taxSummary(spec)).toEqual([
      { rate: 5, taxable: 360, tax: 18 },
      { rate: 18, taxable: 540, tax: 90 },
    ]);
  });
});
