import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListHelpVideosDto } from './dto/list-help-videos.dto';
import {
  audiencesFor,
  parseYoutubeId,
  INVALID_YOUTUBE_LINK,
  isShortsLink,
} from './help-video-options';
import { HelpVideosService } from './help-videos.service';

const ID = 'dQw4w9WgXcQ';

describe('isShortsLink', () => {
  it('spots shorts links in any form', () => {
    expect(isShortsLink('https://youtube.com/shorts/abcdefghijk')).toBe(true);
    expect(isShortsLink('https://www.youtube.com/shorts/abcdefghijk?feature=share')).toBe(true);
    expect(isShortsLink('m.youtube.com/shorts/abcdefghijk')).toBe(true);
  });
  it('is false for everything else', () => {
    expect(isShortsLink('https://youtu.be/abcdefghijk')).toBe(false);
    expect(isShortsLink('https://www.youtube.com/watch?v=abcdefghijk')).toBe(false);
    expect(isShortsLink('abcdefghijk')).toBe(false);
    expect(isShortsLink(undefined)).toBe(false);
  });
});

describe('parseYoutubeId', () => {
  it.each([
    [ID],
    [`  ${ID}  `],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`],
    [`youtube.com/watch?v=${ID}`],
    [`http://www.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=AbCdEf123&t=10`],
    [`youtu.be/${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://youtube.com/shorts/${ID}?feature=share`],
    [`https://www.youtube.com/embed/${ID}?autoplay=1`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/live/${ID}?si=x`],
  ])('extracts the id from %s', (input) => {
    expect(parseYoutubeId(input)).toBe(ID);
  });

  it('keeps - and _ in ids', () => {
    expect(parseYoutubeId('https://youtu.be/a-b_c-d_e-f')).toBe('a-b_c-d_e-f');
  });

  it.each([
    [undefined],
    [null],
    [42],
    [''],
    ['   '],
    ['dQw4w9WgXc'], // 10 chars
    ['dQw4w9WgXcQQ'], // 12 chars
    ['dQw4w9WgX!Q'],
    ['https://www.youtube.com/watch?v=short'],
    ['https://www.youtube.com/watch'],
    ['https://www.youtube.com/channel/UCabcdefghijk'],
    [`https://vimeo.com/${ID}`],
    [`https://notyoutube.com/watch?v=${ID}`],
    [`https://youtube.com.evil.com/watch?v=${ID}`],
    [`ftp://youtu.be/${ID}`],
    [`javascript:alert('${ID}')`],
    ['not a url at all'],
  ])('rejects %p', (input) => {
    expect(parseYoutubeId(input)).toBeNull();
  });
});

describe('audiencesFor', () => {
  it('technician sees all + technician', () => {
    expect(audiencesFor('technician')).toEqual(['all', 'technician']);
  });
  it.each(['owner', 'manager', undefined])('%s sees all + owner', (role) => {
    expect(audiencesFor(role)).toEqual(['all', 'owner']);
  });
});

// ---- A tiny in-memory stand-in for the Mongoose model -------------------

type Row = Record<string, any>;

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = key === '_id' ? String(row._id) : row[key];
    if (cond && typeof cond === 'object' && '$in' in cond) {
      return cond.$in.includes(value);
    }
    return key === '_id' ? value === String(cond) : value === cond;
  });
}

function sortRows(rows: Row[], spec: Record<string, 1 | -1>): Row[] {
  return [...rows].sort((a, b) => {
    for (const [key, dir] of Object.entries(spec)) {
      const av = key === '_id' ? String(a._id) : a[key];
      const bv = key === '_id' ? String(b._id) : b[key];
      if (av < bv) return -dir;
      if (av > bv) return dir;
    }
    return 0;
  });
}

function query(resolve: (sort?: Record<string, 1 | -1>) => any) {
  let sort: Record<string, 1 | -1> | undefined;
  const q: any = {
    select: () => q,
    sort: (s: Record<string, 1 | -1>) => {
      sort = s;
      return q;
    },
    lean: () => Promise.resolve(resolve(sort)),
  };
  return q;
}

function fakeModel(rows: Row[]) {
  return {
    rows,
    find: jest.fn((filter: Row = {}) =>
      query((sort) => {
        const hit = rows
          .filter((r) => matches(r, filter))
          .map((r) => ({ ...r }));
        return sort ? sortRows(hit, sort) : hit;
      }),
    ),
    findOne: jest.fn((filter: Row = {}) =>
      query((sort) => {
        const hit = rows.filter((r) => matches(r, filter));
        return (sort ? sortRows(hit, sort) : hit)[0] ?? null;
      }),
    ),
    findById: jest.fn((id: string) =>
      query(() => rows.find((r) => String(r._id) === String(id)) ?? null),
    ),
    findByIdAndUpdate: jest.fn((id: string, update: { $set: Row }) =>
      query(() => {
        const row = rows.find((r) => String(r._id) === String(id));
        if (!row) return null;
        Object.assign(row, update.$set);
        return { ...row };
      }),
    ),
    create: jest.fn(async (doc: Row) => {
      const row = { _id: new Types.ObjectId(), ...doc };
      rows.push(row);
      return { toObject: () => ({ ...row }) };
    }),
    deleteOne: jest.fn(async (filter: Row) => {
      const i = rows.findIndex((r) => matches(r, filter));
      if (i < 0) return { deletedCount: 0 };
      rows.splice(i, 1);
      return { deletedCount: 1 };
    }),
    bulkWrite: jest.fn(async (ops: any[]) => {
      for (const op of ops) {
        const row = rows.find((r) => matches(r, op.updateOne.filter));
        if (row) Object.assign(row, op.updateOne.update.$set);
      }
    }),
  };
}

let seq = 0;
function video(over: Row): Row {
  seq += 1;
  return {
    _id: new Types.ObjectId(),
    title: `Video ${seq}`,
    youtubeId: ID,
    screen: 'services',
    language: 'en',
    audience: 'all',
    order: 0,
    active: true,
    ...over,
  };
}

function setup(rows: Row[]) {
  const model = fakeModel(rows);
  const service = new HelpVideosService(model as any);
  return { model, service };
}

const titles = (list: { title: string }[]) => list.map((v) => v.title);

describe('HelpVideosService.forViewer', () => {
  it('returns only active videos in the app shape', async () => {
    const { service } = setup([
      video({ title: 'on' }),
      video({ title: 'off', active: false }),
    ]);
    const list = await service.forViewer('owner', 'services', 'en');
    expect(list).toEqual([
      {
        id: expect.any(String),
        title: 'on',
        youtubeId: ID,
        screen: 'services',
        language: 'en',
        isShort: false,
      },
    ]);
  });

  describe('audience', () => {
    const rows = () => [
      video({ title: 'all', audience: 'all', order: 0 }),
      video({ title: 'owner', audience: 'owner', order: 1 }),
      video({ title: 'tech', audience: 'technician', order: 2 }),
    ];

    it('technician sees all + technician', async () => {
      const { service } = setup(rows());
      expect(titles(await service.forViewer('technician', 'services'))).toEqual(
        ['all', 'tech'],
      );
    });

    it.each(['owner', 'manager'])('%s sees all + owner', async (role) => {
      const { service } = setup(rows());
      expect(titles(await service.forViewer(role, 'services'))).toEqual([
        'all',
        'owner',
      ]);
    });
  });

  describe('screen', () => {
    const rows = () => [
      video({ title: 'inv-1', screen: 'invoice', order: 1 }),
      video({ title: 'home-0', screen: 'home', order: 0 }),
      video({ title: 'svc-0', screen: 'services', order: 0 }),
      video({ title: 'inv-0', screen: 'invoice', order: 0 }),
      video({ title: 'set-0', screen: 'settings', order: 0 }),
    ];

    it('home lists every screen, grouped in screen order', async () => {
      const { service } = setup(rows());
      expect(titles(await service.forViewer('owner', 'home'))).toEqual([
        'home-0',
        'svc-0',
        'inv-0',
        'inv-1',
        'set-0',
      ]);
    });

    it('defaults to home when no screen is given', async () => {
      const { service } = setup(rows());
      expect(await service.forViewer('owner')).toHaveLength(5);
    });

    it('a specific screen returns only that screen, by order', async () => {
      const { service, model } = setup(rows());
      expect(titles(await service.forViewer('owner', 'invoice'))).toEqual([
        'inv-0',
        'inv-1',
      ]);
      expect(model.find.mock.calls[0][0]).toMatchObject({ screen: 'invoice' });
    });

    it('does not filter by screen on home', async () => {
      const { service, model } = setup(rows());
      await service.forViewer('owner', 'home');
      expect(model.find.mock.calls[0][0]).not.toHaveProperty('screen');
    });
  });

  describe('language', () => {
    const rows = () => [
      video({ title: 'en-1', language: 'en', order: 1 }),
      video({ title: 'hi-1', language: 'hi', order: 1 }),
      video({ title: 'ml-0', language: 'ml', order: 0 }),
      video({ title: 'en-0', language: 'en', order: 0 }),
      video({ title: 'hi-0', language: 'hi', order: 0 }),
    ];

    it('requested language first, then English, never others', async () => {
      const { service } = setup(rows());
      expect(
        titles(await service.forViewer('owner', 'services', 'hi')),
      ).toEqual(['hi-0', 'hi-1', 'en-0', 'en-1']);
    });

    it('falls back to English when nothing is in the language', async () => {
      const { service } = setup(rows().filter((r) => r.language !== 'ml'));
      expect(
        titles(await service.forViewer('owner', 'services', 'ml')),
      ).toEqual(['en-0', 'en-1']);
    });

    it('en returns English only', async () => {
      const { service, model } = setup(rows());
      expect(
        titles(await service.forViewer('owner', 'services', 'en')),
      ).toEqual(['en-0', 'en-1']);
      expect(model.find.mock.calls[0][0].language).toEqual({ $in: ['en'] });
    });

    it('on home: language first, then screen, then order', async () => {
      const { service } = setup([
        video({ title: 'en-svc', language: 'en', screen: 'services' }),
        video({ title: 'ml-inv', language: 'ml', screen: 'invoice' }),
        video({ title: 'ml-svc', language: 'ml', screen: 'services' }),
        video({ title: 'en-home', language: 'en', screen: 'home' }),
      ]);
      expect(titles(await service.forViewer('owner', 'home', 'ml'))).toEqual([
        'ml-svc',
        'ml-inv',
        'en-home',
        'en-svc',
      ]);
    });
  });
});

describe('HelpVideosService admin', () => {
  it('create accepts a URL, stores the id, appends to its screen', async () => {
    const { service, model } = setup([
      video({ screen: 'invoice', order: 4 }),
      video({ screen: 'invoice', order: 7 }),
      video({ screen: 'services', order: 20 }),
    ]);
    const created = await service.create({
      url: `https://youtu.be/${ID}?si=abc`,
      title: '  Make an invoice  ',
      screen: 'invoice',
    });
    expect(created).toMatchObject({
      youtubeId: ID,
      title: 'Make an invoice',
      screen: 'invoice',
      language: 'en',
      audience: 'all',
      active: true,
      order: 8,
    });
    expect(model.rows).toHaveLength(4);
  });

  it('create starts a new screen at 0 and accepts a bare id', async () => {
    const { service } = setup([]);
    const created = await service.create({
      youtubeId: ID,
      title: 'x',
      screen: 'amc',
      language: 'hi',
      audience: 'technician',
      active: false,
    });
    expect(created).toMatchObject({
      order: 0,
      language: 'hi',
      audience: 'technician',
      active: false,
    });
  });

  it.each([[{ url: 'https://vimeo.com/123' }], [{ youtubeId: 'nope' }], [{}]])(
    'create rejects %p with the link message',
    async (link) => {
      const { service, model } = setup([]);
      await expect(
        service.create({ ...link, title: 'x', screen: 'home' } as any),
      ).rejects.toThrow(new BadRequestException(INVALID_YOUTUBE_LINK));
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it('update re-parses a sent url and leaves the rest alone', async () => {
    const row = video({ title: 'old', screen: 'invoice', order: 3 });
    const { service } = setup([row]);
    const updated = await service.update(String(row._id), {
      url: 'https://www.youtube.com/shorts/a-b_c-d_e-f',
    });
    expect(updated).toMatchObject({
      youtubeId: 'a-b_c-d_e-f',
      title: 'old',
      order: 3,
    });
  });

  it('update rejects a bad url', async () => {
    const row = video({});
    const { service } = setup([row]);
    await expect(
      service.update(String(row._id), { url: 'https://example.com' }),
    ).rejects.toThrow(INVALID_YOUTUBE_LINK);
  });

  it('update moving screens appends to the new screen', async () => {
    const row = video({ screen: 'invoice', order: 0 });
    const { service } = setup([row, video({ screen: 'amc', order: 2 })]);
    const updated = await service.update(String(row._id), { screen: 'amc' });
    expect(updated).toMatchObject({ screen: 'amc', order: 3 });
  });

  it('update / remove 404 on unknown or malformed ids', async () => {
    const { service } = setup([]);
    const missing = String(new Types.ObjectId());
    await expect(service.update(missing, { title: 'x' })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.update('bad', { title: 'x' })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(missing)).rejects.toThrow(NotFoundException);
    await expect(service.remove('bad')).rejects.toThrow(NotFoundException);
  });

  it('remove deletes', async () => {
    const row = video({});
    const { service, model } = setup([row]);
    await expect(service.remove(String(row._id))).resolves.toEqual({
      deleted: true,
    });
    expect(model.rows).toHaveLength(0);
  });

  it('reorder sets order = index and returns the sorted list', async () => {
    const a = video({ title: 'a', screen: 'invoice', order: 0 });
    const b = video({ title: 'b', screen: 'invoice', order: 1 });
    const c = video({ title: 'c', screen: 'invoice', order: 2 });
    const { service } = setup([a, b, c]);
    const list = await service.reorder([c, a, b].map((v) => String(v._id)));
    expect(list.map((v) => [v.title, v.order])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('listAll sorts by screen then order', async () => {
    const { service } = setup([
      video({ title: 's1', screen: 'services', order: 1 }),
      video({ title: 'a0', screen: 'amc', order: 0 }),
      video({ title: 's0', screen: 'services', order: 0 }),
    ]);
    expect(titles(await service.listAll())).toEqual(['a0', 's0', 's1']);
  });
});

describe('ListHelpVideosDto', () => {
  const check = (query: Record<string, string>) =>
    validate(plainToInstance(ListHelpVideosDto, query));

  it('accepts known screens and languages, or nothing', async () => {
    expect(await check({ screen: 'log_service', lang: 'ml' })).toHaveLength(0);
    expect(await check({})).toHaveLength(0);
  });

  it.each([[{ screen: 'dashboard' }], [{ lang: 'ta' }]])(
    'rejects %p',
    async (query) => {
      expect((await check(query)).length).toBeGreaterThan(0);
    },
  );
});
