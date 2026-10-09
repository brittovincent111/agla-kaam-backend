import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from './schemas/business.schema';
import {
  TeamMember,
  TeamMemberDocument,
} from '../team-members/schemas/team-member.schema';
import { ExpoPushService } from '../common/push/expo-push.service';

type Session = { sid: string; at: Date; pushToken?: string };

const DEFAULT_PHONES = 1;

/**
 * Which sign-ins survive a new one: the newest `limit`, the new one included.
 * Pure, so the rule is testable on its own.
 */
export function keepNewest(
  sessions: Session[],
  added: Session,
  limit: number,
): { kept: Session[]; dropped: Session[] } {
  const all = [...sessions.filter((s) => s.sid !== added.sid), added];
  const cut = Math.max(0, all.length - Math.max(1, limit));
  return { kept: all.slice(cut), dropped: all.slice(0, cut) };
}

/**
 * Owner sign-ins. An owner login is limited to `maxPhones` phones at once
 * (1 unless admin grants more) so one login cannot be handed to a whole team
 * in place of technician seats. Signing in on another phone signs the oldest
 * out; that phone is told by push, and stops getting the owner's pushes.
 */
@Injectable()
export class OwnerSessionsService {
  private readonly logger = new Logger(OwnerSessionsService.name);

  constructor(
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    private readonly expoPushService: ExpoPushService,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
  ) {}

  /**
   * A technician's or manager's sign-in: one phone each, always. The phone
   * signed out is told to ask the owner for a login of its own.
   */
  async startMember(teamMemberId: string): Promise<string> {
    const member = await this.teamMemberModel
      .findById(teamMemberId)
      .select('sessions pushToken')
      .lean()
      .exec();
    const sid = randomUUID();
    if (!member) return sid;

    const sessions = (member.sessions ?? []) as Session[];
    const { kept, dropped } = keepNewest(sessions, { sid, at: new Date() }, 1);
    const droppedTokens = dropped
      .map((s) => s.pushToken)
      .filter((t): t is string => !!t);
    // First sign-in under the rule: the token on file belongs to a phone
    // signed in before, which is now refused.
    const stale = sessions.length ? droppedTokens : [member.pushToken].filter(Boolean);
    const unsetToken =
      !!member.pushToken && (stale.includes(member.pushToken) || !sessions.length);

    await this.teamMemberModel
      .updateOne(
        { _id: teamMemberId },
        {
          $set: { sessions: kept },
          ...(unsetToken ? { $unset: { pushToken: '' } } : {}),
        },
      )
      .exec();
    if (droppedTokens.length) {
      void this.notify(droppedTokens, {
        title: 'You have been logged out',
        body: 'Someone signed in with your login on another phone.',
      });
    }
    return sid;
  }

  /** Remembers which push token belongs to a member's sign-in. */
  async attachMemberPushToken(teamMemberId: string, sid: string, pushToken: string): Promise<void> {
    await this.teamMemberModel
      .updateOne(
        { _id: teamMemberId, 'sessions.sid': sid },
        { $set: { 'sessions.$.pushToken': pushToken } },
      )
      .exec();
  }

  /** A member signing out frees their phone. */
  async endMember(teamMemberId: string, sid: string): Promise<void> {
    await this.teamMemberModel
      .updateOne({ _id: teamMemberId }, { $pull: { sessions: { sid } } })
      .exec();
  }

  /** Starts a sign-in and returns its id, signing out phones over the limit. */
  async start(businessId: string): Promise<string> {
    const business = await this.businessModel
      .findById(businessId)
      .select('sessions maxPhones pushToken pushTokens')
      .lean()
      .exec();
    const sid = randomUUID();
    if (!business) return sid;

    const sessions = (business.sessions ?? []) as Session[];
    const { kept, dropped } = keepNewest(
      sessions,
      { sid, at: new Date() },
      business.maxPhones ?? DEFAULT_PHONES,
    );

    // The first sign-in under this rule: phones signed in before it carry no
    // sign-in id and are now refused, so their push tokens go too.
    const legacyTokens = sessions.length
      ? []
      : [...(business.pushTokens ?? []), business.pushToken].filter(
          (t): t is string => !!t,
        );
    const droppedTokens = dropped
      .map((s) => s.pushToken)
      .filter((t): t is string => !!t);

    await this.businessModel
      .updateOne({ _id: businessId }, { $set: { sessions: kept } })
      .exec();
    await this.forgetTokens(businessId, [...droppedTokens, ...legacyTokens]);
    if (droppedTokens.length) void this.tellSignedOut(droppedTokens);
    return sid;
  }

  /** Whether a sign-in is still current. Logins from before sign-in ids
   * count only until the owner first signs in under the rule. */
  isCurrent(sessions: { sid: string }[] | undefined, sid?: string): boolean {
    const list = sessions ?? [];
    if (!sid) return list.length === 0;
    return list.some((s) => s.sid === sid);
  }

  /** Remembers which push token belongs to a sign-in. */
  async attachPushToken(businessId: string, sid: string, pushToken: string): Promise<void> {
    const business = await this.businessModel
      .findOne({ _id: businessId, 'sessions.sid': sid })
      .select('sessions')
      .lean()
      .exec();
    const previous = (business?.sessions as Session[] | undefined)?.find(
      (s) => s.sid === sid,
    )?.pushToken;
    await this.businessModel
      .updateOne(
        { _id: businessId, 'sessions.sid': sid },
        { $set: { 'sessions.$.pushToken': pushToken } },
      )
      .exec();
    // Expo rolled this phone's token: the old one is dead weight.
    if (previous && previous !== pushToken) {
      await this.forgetTokens(businessId, [previous]);
    }
  }

  /** Signing out on a phone frees its place. */
  async end(businessId: string, sid: string): Promise<void> {
    await this.businessModel
      .updateOne({ _id: businessId }, { $pull: { sessions: { sid } } })
      .exec();
  }

  /**
   * Admin: change how many phones the owner may use, or sign every phone
   * out (a lost phone). Lowering the limit signs out the oldest at once.
   */
  async setLimit(
    businessId: string,
    opts: { maxPhones?: number; signOutAll?: boolean },
  ): Promise<{ maxPhones: number; signedIn: number }> {
    const business = await this.businessModel
      .findById(businessId)
      .select('sessions maxPhones')
      .lean()
      .exec();
    if (!business) return { maxPhones: DEFAULT_PHONES, signedIn: 0 };

    const limit = opts.maxPhones ?? business.maxPhones ?? DEFAULT_PHONES;
    const sessions = (business.sessions ?? []) as Session[];
    const dropped = opts.signOutAll
      ? sessions
      : sessions.slice(0, Math.max(0, sessions.length - limit));
    const kept = sessions.filter((s) => !dropped.includes(s));

    await this.businessModel
      .updateOne(
        { _id: businessId },
        {
          $set: {
            sessions: kept,
            ...(opts.maxPhones !== undefined ? { maxPhones: limit } : {}),
          },
        },
      )
      .exec();
    const tokens = dropped
      .map((s) => s.pushToken)
      .filter((t): t is string => !!t);
    await this.forgetTokens(businessId, tokens);
    if (tokens.length && !opts.signOutAll) void this.tellSignedOut(tokens);
    return { maxPhones: limit, signedIn: kept.length };
  }

  private async forgetTokens(businessId: string, tokens: string[]): Promise<void> {
    if (!tokens.length) return;
    await this.businessModel
      .updateOne({ _id: businessId }, { $pull: { pushTokens: { $in: tokens } } })
      .exec();
    await this.businessModel
      .updateOne(
        { _id: businessId, pushToken: { $in: tokens } },
        { $unset: { pushToken: '' } },
      )
      .exec();
  }

  private tellSignedOut(tokens: string[]): Promise<void> {
    return this.notify(tokens, {
      title: 'You have been logged out',
      body: 'Someone signed in to your account on another phone.',
    });
  }

  private async notify(tokens: string[], text: { title: string; body: string }): Promise<void> {
    try {
      await this.expoPushService.send(
        tokens.map((to) => ({ to, ...text, data: { screen: 'SignedOut' } })),
      );
    } catch (err) {
      this.logger.warn(`Signed-out push failed: ${(err as Error).message}`);
    }
  }
}
