import * as fs from 'fs';
import * as path from 'path';
import { Types } from 'mongoose';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BusinessesService } from './businesses.service';
import { S3Service } from '../common/s3/s3.service';
import { AppleSignInService } from '../common/apple/apple-sign-in.service';

const BIZ = '507f1f77bcf86cd799439012';

// Every Mongoose model class in src whose schema has a businessId. Read from
// the schema files themselves, so a collection added later fails this spec
// until account deletion covers it too.
function businessKeyedModelNames(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/schemas?\.ts$/.test(entry.name) && !/spec/.test(entry.name))
        files.push(full);
    }
  };
  walk(path.join(__dirname, '..'));

  const names: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const roots = new Set(
      [...source.matchAll(/createForClass\((\w+)\)/g)].map((m) => m[1]),
    );
    for (const chunk of source.split(/export class /).slice(1)) {
      const name = chunk.match(/^(\w+)/)![1];
      if (roots.has(name) && /\bbusinessId\??:/.test(chunk)) names.push(name);
    }
  }
  return names;
}

function chain<T>(value: T) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'lean', 'sort', 'limit']) q[m] = () => q;
  q.exec = jest.fn().mockResolvedValue(value);
  return q;
}

type MockModel = Record<
  | 'deleteMany'
  | 'find'
  | 'findById'
  | 'findByIdAndUpdate'
  | 'findByIdAndDelete'
  | 'findOneAndUpdate'
  | 'updateOne'
  | 'updateMany'
  | 'findOne',
  jest.Mock<any, any[]>
>;

function mockModel(): MockModel {
  return {
    deleteMany: jest.fn(() => chain({ deletedCount: 0 })),
    find: jest.fn(() => chain([])),
    findById: jest.fn(() => chain(null)),
    findByIdAndUpdate: jest.fn(() => chain(null)),
    findByIdAndDelete: jest.fn(() => chain(null)),
    findOneAndUpdate: jest.fn(() => chain(null)),
    updateOne: jest.fn(() => chain({})),
    updateMany: jest.fn(() => chain({})),
    findOne: jest.fn(() => chain(null)),
  };
}

async function build() {
  const models = new Map<string, MockModel>();
  const s3 = { delete: jest.fn().mockResolvedValue(undefined) };
  const apple = { revokeRefreshToken: jest.fn().mockResolvedValue(true) };
  const module = await Test.createTestingModule({
    providers: [
      BusinessesService,
      { provide: S3Service, useValue: s3 },
      { provide: AppleSignInService, useValue: apple },
    ],
  })
    .useMocker((token) => {
      if (typeof token === 'string' && token.endsWith('Model')) {
        const model = mockModel();
        models.set(token, model);
        return model;
      }
      return {};
    })
    .compile();
  const model = (name: string) => {
    const m = models.get(getModelToken(name));
    if (!m) throw new Error(`${name} model is not injected into BusinessesService`);
    return m;
  };
  return { service: module.get(BusinessesService), model, s3, apple };
}

describe('BusinessesService.remove — account deletion', () => {
  const business = {
    logoKey: 'businesses/b/logo.png',
    signatureKey: 'businesses/b/signature.png',
    appleRefreshToken: 'owner-refresh',
  };

  async function removeWith(opts: { s3Fails?: boolean } = {}) {
    const ctx = await build();
    ctx.model('Business').findById.mockReturnValue(chain(business));
    ctx.model('Service').find.mockReturnValue(
      chain([
        {
          beforePhotoKey: 'businesses/b/services/1/before.jpg',
          afterPhotoKey: 'businesses/b/services/1/after.jpg',
        },
        { signatureKey: 'businesses/b/services/2/signature.png' },
      ]),
    );
    ctx.model('TeamMember').find.mockReturnValue(
      chain([{ appleRefreshToken: 'tech-refresh' }]),
    );
    if (opts.s3Fails) ctx.s3.delete.mockRejectedValue(new Error('S3 down'));
    await ctx.service.remove(BIZ);
    return ctx;
  }

  it('finds the business-keyed schemas it is checking against', () => {
    // Guards the scan itself: if it ever found nothing, the next test would
    // pass vacuously.
    expect(businessKeyedModelNames()).toEqual(
      expect.arrayContaining(['Customer', 'Amc', 'InventoryItem', 'Supplier']),
    );
  });

  it('deletes from every collection keyed by businessId, in both id forms', async () => {
    const { model } = await removeWith();
    for (const name of businessKeyedModelNames()) {
      const filter = model(name).deleteMany.mock.calls[0]?.[0] as
        | { businessId: { $in: unknown[] } }
        | undefined;
      expect({ name, called: !!filter }).toEqual({ name, called: true });
      expect(filter!.businessId.$in).toEqual([BIZ, new Types.ObjectId(BIZ)]);
    }
    expect(model('Business').findByIdAndDelete).toHaveBeenCalledWith(BIZ);
  });

  it('deletes the logo, signature, and every job photo and customer signature from S3', async () => {
    const { s3 } = await removeWith();
    expect(s3.delete.mock.calls.map((c) => c[0]).sort()).toEqual(
      [
        'businesses/b/logo.png',
        'businesses/b/signature.png',
        'businesses/b/services/1/before.jpg',
        'businesses/b/services/1/after.jpg',
        'businesses/b/services/2/signature.png',
      ].sort(),
    );
  });

  it('still deletes the account when S3 fails', async () => {
    const { model } = await removeWith({ s3Fails: true });
    expect(model('Business').findByIdAndDelete).toHaveBeenCalledWith(BIZ);
  });

  it("revokes the owner's and technicians' Sign in with Apple tokens", async () => {
    const { apple } = await removeWith();
    expect(apple.revokeRefreshToken.mock.calls.map((c) => c[0]).sort()).toEqual(
      ['owner-refresh', 'tech-refresh'],
    );
  });
});

describe('BusinessesService.update — email verification', () => {
  async function updateEmail(stored: string | undefined, next: string) {
    const ctx = await build();
    ctx.model('Business').findById.mockReturnValue(
      chain({ email: stored, country: 'IN', phone: '+919800000000' }),
    );
    ctx.model('Business').findByIdAndUpdate.mockReturnValue(chain({ id: BIZ }));
    await ctx.service.update(BIZ, { email: next });
    return ctx.model('Business').findByIdAndUpdate.mock.calls[0][1] as {
      $set?: Record<string, unknown>;
      $unset?: Record<string, unknown>;
    };
  }

  it('marks a changed email unverified and drops any reset code in flight', async () => {
    const update = await updateEmail('owner@shop.com', 'someone@else.com');
    expect(update.$set).toMatchObject({
      email: 'someone@else.com',
      emailVerified: false,
    });
    expect(update.$unset).toMatchObject({
      passwordResetCodeHash: '',
      passwordResetExpiresAt: '',
    });
  });

  it('treats a first email on an account with none as unverified', async () => {
    const update = await updateEmail(undefined, 'new@shop.com');
    expect(update.$set?.emailVerified).toBe(false);
  });

  it('leaves verification alone when the email only changes case', async () => {
    const update = await updateEmail('owner@shop.com', 'Owner@Shop.com');
    expect(update.$set).not.toHaveProperty('emailVerified');
    expect(update.$unset).toBeUndefined();
  });
});

describe('BusinessesService — push tokens', () => {
  const TOKEN = 'ExponentPushToken[abc]';

  it("takes an owner's newly registered token off every other account", async () => {
    const { service, model } = await build();
    await service.updatePushToken(BIZ, TOKEN);

    expect(model('Business').updateMany).toHaveBeenCalledWith(
      { pushToken: TOKEN, _id: { $ne: BIZ } },
      { $unset: { pushToken: '' } },
    );
    expect(model('TeamMember').updateMany).toHaveBeenCalledWith(
      { pushToken: TOKEN },
      { $unset: { pushToken: '' } },
    );
    expect(model('Business').updateMany).toHaveBeenCalledWith(
      { pushTokens: TOKEN, _id: { $ne: BIZ } },
      { $pull: { pushTokens: TOKEN } },
    );
    // Kept as the latest phone and added to the owner's list of phones.
    expect(model('Business').updateOne).toHaveBeenCalledWith(
      { _id: BIZ },
      {
        $set: { pushToken: TOKEN },
        $push: { pushTokens: { $each: [TOKEN], $slice: -5 } },
      },
    );
  });

  it("takes a technician's newly registered token off the owner and other members", async () => {
    const { service, model } = await build();
    await service.updateTeamMemberPushToken('tm-1', TOKEN);

    expect(model('Business').updateMany).toHaveBeenCalledWith(
      { pushToken: TOKEN },
      { $unset: { pushToken: '' } },
    );
    expect(model('TeamMember').updateMany).toHaveBeenCalledWith(
      { pushToken: TOKEN, _id: { $ne: 'tm-1' } },
      { $unset: { pushToken: '' } },
    );
  });

  it('clears only the phone signing out, leaving the owner’s other phones', async () => {
    const { service, model } = await build();
    await service.clearPushToken(BIZ, TOKEN);

    expect(model('Business').updateOne).toHaveBeenCalledWith(
      { _id: BIZ },
      { $pull: { pushTokens: TOKEN } },
    );
    expect(model('Business').updateOne).toHaveBeenCalledWith(
      { _id: BIZ, pushToken: TOKEN },
      { $unset: { pushToken: '' } },
    );
  });

  it('clears every owner phone when an older app signs out without saying which', async () => {
    const { service, model } = await build();
    await service.clearPushToken(BIZ);
    await service.clearTeamMemberPushToken('tm-1');

    expect(model('Business').updateOne).toHaveBeenCalledWith(
      { _id: BIZ },
      { $unset: { pushToken: '' }, $set: { pushTokens: [] } },
    );
    expect(model('TeamMember').updateOne).toHaveBeenCalledWith(
      { _id: 'tm-1' },
      { $unset: { pushToken: '' } },
    );
  });
});
