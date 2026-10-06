import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard, MEMBER_REMOVED_CODE } from './jwt-auth.guard';

// The guard keeps a module-level "still active" cache keyed by
// business:member, so every test uses its own member id.
let memberSeq = 0;

describe('JwtAuthGuard — technician access', () => {
  const contextFor = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as never;

  const setup = (opts: {
    active?: boolean;
    seat?: boolean;
  }) => {
    const teamMemberId = `tm-${++memberSeq}`;
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'biz-1',
        role: 'technician',
        teamMemberId,
      }),
    };
    const teamMembers = {
      assertActiveMember: jest.fn(async () => {
        if (opts.active === false) {
          throw new NotFoundException('Technician not found');
        }
      }),
      holdsSeat: jest.fn().mockResolvedValue(opts.seat ?? true),
    };
    const subscriptions = { hasActiveTeamAddon: jest.fn() };
    const guard = new JwtAuthGuard(
      jwt as never,
      subscriptions as never,
      teamMembers as never,
    );
    const request = { headers: { authorization: 'Bearer tok' } };
    return { guard, request, teamMembers };
  };

  it('lets an active technician with a seat through', async () => {
    const { guard, request } = setup({});
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
  });

  it('answers a removed technician with a 403 the app can recognise, not a 404', async () => {
    // Deactivated members also lose their seat — the removal must still be
    // what they are told, not "the owner's subscription is expired".
    const { guard, request } = setup({ active: false, seat: false });

    const err = await guard
      .canActivate(contextFor(request))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err).not.toBeInstanceOf(NotFoundException);
    const body = (err as ForbiddenException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      code: MEMBER_REMOVED_CODE,
      message:
        'Your access to this business has been removed. Ask the owner if this is a mistake.',
    });
  });

  it('keeps the seat-limit message for an active technician without a seat', async () => {
    const { guard, request } = setup({ seat: false });

    const err = (await guard
      .canActivate(contextFor(request))
      .catch((e: unknown) => e)) as ForbiddenException;

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(
      "The owner's subscription is expired or does not include active team access.",
    );
  });

  it('still reports a bad token as 401', async () => {
    const { guard, request } = setup({});
    (guard as unknown as { jwtService: { verifyAsync: jest.Mock } })
      .jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
