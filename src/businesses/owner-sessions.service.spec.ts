import { UnauthorizedException } from '@nestjs/common';
import { keepNewest, OwnerSessionsService } from './owner-sessions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

const BIZ = '507f1f77bcf86cd799439012';
const s = (sid: string, pushToken?: string) => ({ sid, at: new Date(), pushToken });

describe('keepNewest', () => {
  it('keeps only the new sign-in on a one-phone login', () => {
    const { kept, dropped } = keepNewest([s('a')], s('b'), 1);
    expect(kept.map((x) => x.sid)).toEqual(['b']);
    expect(dropped.map((x) => x.sid)).toEqual(['a']);
  });

  it('keeps the newest two when two phones are allowed', () => {
    const { kept, dropped } = keepNewest([s('a'), s('b')], s('c'), 2);
    expect(kept.map((x) => x.sid)).toEqual(['b', 'c']);
    expect(dropped.map((x) => x.sid)).toEqual(['a']);
  });

  it('drops nothing while under the limit', () => {
    expect(keepNewest([s('a')], s('b'), 3).dropped).toEqual([]);
  });
});

function fakeModel(business: Record<string, unknown> | null) {
  const updateOne = jest.fn(() => ({ exec: async () => ({}) }));
  const lean = () => ({ exec: async () => business });
  return {
    model: {
      findById: () => ({ select: () => ({ lean }) }),
      findOne: () => ({ select: () => ({ lean }) }),
      updateOne,
    },
    updateOne,
  };
}

describe('OwnerSessionsService.start', () => {
  it('signs the older phone out and tells it by push', async () => {
    const { model, updateOne } = fakeModel({
      sessions: [s('old', 'tok-old')],
      pushTokens: ['tok-old'],
    });
    const send = jest.fn(async () => ({ sent: 1, failed: 0, invalidTokens: [] }));
    const svc = new OwnerSessionsService(model as never, { send } as never, {} as never);

    const sid = await svc.start(BIZ);

    const set = (updateOne.mock.calls[0] as unknown[])[1] as { $set: { sessions: { sid: string }[] } };
    expect(set.$set.sessions.map((x) => x.sid)).toEqual([sid]);
    expect(updateOne).toHaveBeenCalledWith({ _id: BIZ }, { $pull: { pushTokens: { $in: ['tok-old'] } } });
    await new Promise((r) => setImmediate(r));
    const sent = (send.mock.calls[0] as unknown[])[0] as { to: string; title: string; body: string }[];
    expect(sent[0].to).toBe('tok-old');
    expect(sent[0].title).toBe('You have been logged out');
    expect(sent[0].body).toBe('Someone signed in to your account on another phone.');
  });

  it('keeps both phones when admin allowed two', async () => {
    const { model, updateOne } = fakeModel({ sessions: [s('old', 'tok-old')], maxPhones: 2 });
    const send = jest.fn();
    const svc = new OwnerSessionsService(model as never, { send } as never, {} as never);
    await svc.start(BIZ);
    const set = (updateOne.mock.calls[0] as unknown[])[1] as { $set: { sessions: unknown[] } };
    expect(set.$set.sessions).toHaveLength(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('on the first sign-in under the rule, drops push tokens of older logins', async () => {
    const { model, updateOne } = fakeModel({ sessions: [], pushToken: 'legacy', pushTokens: ['legacy', 'other'] });
    const svc = new OwnerSessionsService(model as never, { send: jest.fn() } as never, {} as never);
    await svc.start(BIZ);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: BIZ },
      { $pull: { pushTokens: { $in: ['legacy', 'other', 'legacy'] } } },
    );
  });
});

describe('OwnerSessionsService.startMember', () => {
  it('signs a technician out of their other phone and tells it to ask the owner', async () => {
    const { model, updateOne } = fakeModel({ sessions: [s('old', 'tok-old')], pushToken: 'tok-old' });
    const send = jest.fn(async () => ({ sent: 1, failed: 0, invalidTokens: [] }));
    const svc = new OwnerSessionsService({} as never, { send } as never, model as never);

    const sid = await svc.startMember('tm-1');

    const update = (updateOne.mock.calls[0] as unknown[])[1] as {
      $set: { sessions: { sid: string }[] };
      $unset?: Record<string, string>;
    };
    expect(update.$set.sessions.map((x) => x.sid)).toEqual([sid]);
    expect(update.$unset).toEqual({ pushToken: '' });
    await new Promise((r) => setImmediate(r));
    const sent = (send.mock.calls[0] as unknown[])[0] as { to: string; body: string }[];
    expect(sent[0].to).toBe('tok-old');
    expect(sent[0].body).toBe('Someone signed in with your login on another phone.');
  });

  it('keeps the push token of the same phone signing in again', async () => {
    const { model, updateOne } = fakeModel({ sessions: [s('old', 'tok-a')], pushToken: 'tok-b' });
    const svc = new OwnerSessionsService({} as never, { send: jest.fn(async () => ({})) } as never, model as never);
    await svc.startMember('tm-1');
    const update = (updateOne.mock.calls[0] as unknown[])[1] as { $unset?: unknown };
    expect(update.$unset).toBeUndefined();
  });
});

describe('JwtAuthGuard — technician one phone', () => {
  it('turns away a technician login used on a newer phone', async () => {
    const jwt = { verifyAsync: async () => ({ sub: 'b-t', role: 'technician', teamMemberId: 'tm-9', sid: 'old' }) };
    const connection = {
      model: () => ({
        findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ sessions: [{ sid: 'new' }] }) }) }) }),
      }),
    };
    const team = { assertActiveMember: async () => ({ role: 'technician' }), holdsSeat: async () => true };
    const guard = new JwtAuthGuard(jwt as never, undefined, team as never, connection as never);
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    const err = await guard
      .canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never)
      .catch((e) => e);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'SIGNED_IN_ELSEWHERE' });
  });
});

describe('JwtAuthGuard — owner phone limit', () => {
  function guardFor(sessions: { sid: string }[], payload: Record<string, unknown>) {
    const jwt = { verifyAsync: async () => payload };
    const connection = {
      model: () => ({
        findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ sessions }) }) }) }),
      }),
    };
    const guard = new JwtAuthGuard(jwt as never, undefined, undefined, connection as never);
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => request }) };
    return () => guard.canActivate(ctx as never);
  }

  it('lets the current phone in', async () => {
    await expect(guardFor([{ sid: 'now' }], { sub: 'b-ok', sid: 'now' })()).resolves.toBe(true);
  });

  it('turns away a phone that was signed out, saying why', async () => {
    const run = guardFor([{ sid: 'new' }], { sub: 'b-out', sid: 'old' });
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'SIGNED_IN_ELSEWHERE' });
  });

  it('turns away a login from before the rule once the owner signs in again', async () => {
    const err = await guardFor([{ sid: 'new' }], { sub: 'b-legacy' })().catch((e) => e);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'SIGNED_IN_ELSEWHERE' });
  });

  it('still lets an older login in until then', async () => {
    await expect(guardFor([], { sub: 'b-untouched' })()).resolves.toBe(true);
  });
});
