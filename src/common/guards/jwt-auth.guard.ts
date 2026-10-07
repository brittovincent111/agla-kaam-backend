import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { TeamMembersService } from '../../team-members/team-members.service';
import {
  isTeamMember,
  type BusinessRole,
} from '../decorators/current-business.decorator';

/**
 * How long a technician's "still active" result is trusted before re-checking.
 *
 * Without any check a deactivated technician kept full access — customer phone
 * numbers, doorstep GPS pins, job logging — until their 30-day token expired.
 * Checking on literally every request would put a database round trip in front
 * of all of them, so the answer is cached briefly: removing someone takes
 * effect within a minute rather than a month.
 */
const ACTIVE_TTL_MS = 60_000;
//
// The seat check rides the same entry and the same TTL: a member who holds a
// seat is not re-counted against the business's seats on every request.
// Only a granted seat is remembered — a refusal is re-checked next time, so
// an owner who has just bought seats is not kept waiting out the TTL.
const activeCache = new Map<
  string,
  { until: number; role: BusinessRole; seat?: boolean }
>();

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Optional()
    @Inject(SubscriptionsService)
    private readonly subscriptionsService?: SubscriptionsService,
    @Optional()
    @Inject(TeamMembersService)
    private readonly teamMembersService?: TeamMembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      request.business = {
        businessId: payload.sub,
        phone: payload.phone,
        email: payload.email,
        role: payload.role ?? 'owner',
        teamMemberId: payload.teamMemberId,
      };

      // A manager is a team member too: removed, out of seats or demoted, they
      // lose access exactly as a technician does.
      if (isTeamMember(payload)) {
        // Fails closed on purpose. If this service is somehow not injectable,
        // refusing the technician is the safe outcome — skipping the check is
        // what let removed staff keep working for up to 30 days.
        if (!this.teamMembersService) {
          throw new ForbiddenException('Technician access cannot be verified.');
        }

        // Before the seat check: a deactivated member no longer counts toward
        // the seats either, so checking seats first told a removed technician
        // the owner's subscription had lapsed.
        const cacheKey = `${payload.sub}:${payload.teamMemberId}`;
        const cached = activeCache.get(cacheKey);
        if (!cached || cached.until < Date.now()) {
          pruneActiveCache();
          // Throws NotFoundException when the member is missing, belongs to
          // another business, or has been deactivated.
          const member = await this.teamMembersService
            .assertActiveMember(payload.sub, payload.teamMemberId)
            .catch((err) => {
              if (err instanceof NotFoundException) {
                throw memberRemoved();
              }
              throw err;
            });
          activeCache.set(cacheKey, {
            until: Date.now() + ACTIVE_TTL_MS,
            role: effectiveTeamRole(payload.role, member),
          });
        }
        // The token's role is what the member was at sign-in. A manager the
        // owner has since made a technician drops to technician now rather
        // than keeping manager access for the rest of a 30-day token; a
        // promotion waits for the next sign-in, when the app learns it too.
        request.business.role =
          activeCache.get(cacheKey)?.role ?? request.business.role;

        if (this.subscriptionsService) {
          // One rule with or without Team: the technician must be inside the
          // business's seat limit — the free test seat without Team, the
          // standard or granted seats with it (earliest-added first).
          const entry = activeCache.get(cacheKey);
          const hasSeat =
            entry?.seat === true
              ? true
              : payload.teamMemberId
                ? await this.teamMembersService.holdsSeat(
                    payload.sub,
                    payload.teamMemberId,
                  )
                : await this.subscriptionsService.hasActiveTeamAddon(
                    payload.sub,
                  );
          if (hasSeat && entry) entry.seat = true;
          if (!hasSeat) {
            throw new ForbiddenException(
              "The owner's subscription is expired or does not include active team access.",
            );
          }
        }
      }

      return true;
    } catch (err) {
      // A deactivated technician must not be reported as a bad token — that
      // sends them to the login screen to retry forever instead of telling
      // them their access was removed.
      if (err instanceof ForbiddenException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

/**
 * A removed (deactivated or deleted) technician. 403 rather than the 404
 * assertActiveMember raises: the app reads a 404 on a normal request as "the
 * server is unreachable" and kept the technician in an offline loop. `code`
 * lets the app recognise this one case mid-session and sign them out with
 * the message, whichever request hit it.
 */
export const MEMBER_REMOVED_CODE = 'MEMBER_REMOVED';
export function memberRemoved(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    code: MEMBER_REMOVED_CODE,
    message:
      'Your access to this business has been removed. Ask the owner if this is a mistake.',
  });
}

/**
 * The role a team member's request runs with: never more than the token
 * says, and never more than the member is now. Only a token issued as
 * 'manager' to someone still a manager keeps manager access.
 */
function effectiveTeamRole(
  tokenRole: string,
  member: { role?: string } | undefined,
): BusinessRole {
  if (tokenRole !== 'manager') return 'technician';
  // No row to compare (only in tests) — trust the token.
  return !member || member.role === 'manager' ? 'manager' : 'technician';
}

/**
 * Drops expired entries, and empties the map outright if it somehow grows
 * past a sane bound. Without this the cache is a map that only ever grows —
 * one entry per technician per process, for the life of the process.
 */
function pruneActiveCache(): void {
  if (activeCache.size > 10_000) {
    activeCache.clear();
    return;
  }
  const now = Date.now();
  for (const [key, value] of activeCache) {
    if (value.until < now) activeCache.delete(key);
  }
}
