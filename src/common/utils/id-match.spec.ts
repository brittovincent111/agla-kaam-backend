import { Types } from 'mongoose';
import { idFilter, idsFilter } from './id-match';

// Reference fields in this database are stored inconsistently — some as
// strings, some as ObjectIds (see id-match.ts). A filter that accepts only
// one shape silently hides rows, which is how a technician lost sight of a
// job assigned to them.
describe('idFilter', () => {
  const hex = '6aa1295dfc133bd3c0009423';

  it('matches both the string and the ObjectId form', () => {
    const filter = idFilter(hex);
    expect(filter.$in).toHaveLength(2);
    expect(filter.$in).toContain(hex);
    expect(filter.$in.some((v) => v instanceof Types.ObjectId)).toBe(true);
  });

  it('is usable against a value stored either way', () => {
    const filter = idFilter(hex);
    const storedAsString = hex;
    const storedAsObjectId = new Types.ObjectId(hex);
    const matches = (stored: unknown) =>
      filter.$in.some((candidate) => String(candidate) === String(stored));
    expect(matches(storedAsString)).toBe(true);
    expect(matches(storedAsObjectId)).toBe(true);
  });

  it('does not throw on an id that is not a valid ObjectId', () => {
    const filter = idFilter('not-an-object-id');
    expect(filter.$in).toEqual(['not-an-object-id']);
  });
});

describe('idsFilter', () => {
  it('expands every id into both representations', () => {
    const a = '6aa1295dfc133bd3c0009423';
    const b = '6aa1295dfc133bd3c0009424';
    const filter = idsFilter([a, b]);
    expect(filter.$in).toHaveLength(4);
    expect(filter.$in).toContain(a);
    expect(filter.$in).toContain(b);
  });

  it('returns an empty set for no ids, matching nothing', () => {
    expect(idsFilter([]).$in).toEqual([]);
  });
});
