import { CustomersService } from './customers.service';

function serviceWith(existingPhones: string[], tier: string | null) {
  const inserted: any[] = [];
  const model = {
    find: () => ({
      select: () => ({
        lean: () => ({
          exec: async () => existingPhones.map((phone) => ({ phone })),
        }),
      }),
    }),
    insertMany: jest.fn(async (rows: any[]) => inserted.push(...rows)),
  };
  const svc = new CustomersService(
    model as any,
    { getActiveTier: async () => tier } as any,
    { get: () => '25' } as any,
    {} as any,
    {} as any,
  );
  return { svc, inserted, model };
}

describe('bulk customer import', () => {
  it('skips numbers already on file, however they are written, and repeats in the batch', async () => {
    const { svc, inserted } = serviceWith(['+919847012345'], 'combo');
    const r = await svc.bulkCreate('b', [
      { name: 'Same person', phone: '098470 12345' },
      { name: 'New', phone: '9876543210' },
      { name: 'New again', phone: '+91 98765 43210' },
    ]);
    expect(r.created).toBe(1);
    expect(r.duplicates.map((d) => d.name)).toEqual([
      'Same person',
      'New again',
    ]);
    expect(inserted[0]).toMatchObject({
      name: 'New',
      phone: '9876543210',
      source: 'manual',
    });
  });

  it('reports rows with no name or a bad number instead of failing the import', async () => {
    const { svc } = serviceWith([], 'combo');
    const r = await svc.bulkCreate('b', [
      { name: '', phone: '9876543210' },
      { name: 'Bad', phone: '123' },
      { name: 'Good', phone: '+971501234567' },
    ]);
    expect(r.created).toBe(1);
    expect(r.invalid.map((i) => i.reason)).toEqual([
      'No name',
      'Not a valid phone number',
    ]);
  });

  it('fills the free plan up to its limit and reports the rest', async () => {
    const existing = Array.from(
      { length: 23 },
      (_, i) => `98000000${String(i).padStart(2, '0')}`,
    );
    const { svc } = serviceWith(existing, null);
    const rows = Array.from({ length: 5 }, (_, i) => ({
      name: `C${i}`,
      phone: `97000000${i}0`,
    }));
    const r = await svc.bulkCreate('b', rows);
    expect(r.created).toBe(2);
    expect(r.overLimit).toBe(3);
    expect(r.limit).toBe(25);
  });
});
