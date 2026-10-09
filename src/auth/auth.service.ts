import { compareVersions } from '../common/utils/semver';
import { loginPhoneDigits } from '../common/utils/login-phone';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { OwnerSessionsService } from '../businesses/owner-sessions.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SignupOtp, SignupOtpDocument } from './schemas/signup-otp.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { TeamMembersService } from '../team-members/team-members.service';
import { EmailService } from '../common/email/email.service';
import { BusinessDocument } from '../businesses/schemas/business.schema';
import { TeamMemberDocument } from '../team-members/schemas/team-member.schema';
import { AppleSignInService } from '../common/apple/apple-sign-in.service';
import { isTeamMember } from '../common/decorators/current-business.decorator';

const PASSWORD_SALT_ROUNDS = 10;
const RESET_CODE_TTL_MINUTES = 15;
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

// Wrong tries allowed on an emailed code before it is thrown away.
const MAX_CODE_ATTEMPTS = 5;

// The first app version that knows the manager role (see sessionForApp).
const MANAGER_ROLE_MIN_APP = '1.0.1';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(SignupOtp.name)
    private readonly signupOtpModel: Model<SignupOtpDocument>,
    private readonly businessesService: BusinessesService,
    private readonly servicePresetsService: ServicePresetsService,
    private readonly teamMembersService: TeamMembersService,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly appleSignInService: AppleSignInService,
    @Optional() private readonly ownerSessions?: OwnerSessionsService,
  ) {}

  async sendSignupOtp(email: string): Promise<{ devCode?: string }> {
    const normalizedEmail = email.toLowerCase();
    const existingBusiness =
      await this.businessesService.findByEmail(normalizedEmail);
    if (existingBusiness) {
      throw new ConflictException('An account with this email already exists.');
    }
    const existingMember =
      await this.teamMembersService.findByEmail(normalizedEmail);
    if (existingMember) {
      throw new ConflictException(
        'This email is already registered as a team member.',
      );
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, PASSWORD_SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000);

    await this.signupOtpModel.deleteMany({ email: normalizedEmail }).exec();
    await this.signupOtpModel.create({
      email: normalizedEmail,
      codeHash,
      expiresAt,
    });

    await this.emailService.sendSignupVerificationOtp(normalizedEmail, code);

    const isProd = this.configService.get('NODE_ENV') === 'production';
    return isProd ? {} : { devCode: code };
  }

  async registerWithEmail(
    email: string,
    password: string,
    businessName?: string,
    phone?: string,
    code?: string,
  ) {
    const normalizedEmail = email.toLowerCase();

    // Unconditional. This check used to sit inside `if (code)`, which meant a
    // request that simply left the field out created a verified-looking
    // account on somebody else's email address.
    if (!code) {
      throw new UnauthorizedException('A verification code is required.');
    }

    const otpRecord = await this.signupOtpModel
      .findOne({ email: normalizedEmail })
      .exec();
    const isValid =
      otpRecord &&
      otpRecord.expiresAt.getTime() > Date.now() &&
      (otpRecord.attempts ?? 0) < MAX_CODE_ATTEMPTS &&
      (await bcrypt.compare(code, otpRecord.codeHash));

    if (!isValid) {
      // A six-digit code must not be guessable by retrying: after
      // MAX_CODE_ATTEMPTS wrong tries it is gone and a new one must be sent.
      if (otpRecord) {
        const updated = await this.signupOtpModel
          .findOneAndUpdate({ _id: otpRecord._id }, { $inc: { attempts: 1 } }, { new: true })
          .exec();
        if (updated && updated.attempts >= MAX_CODE_ATTEMPTS) {
          await this.signupOtpModel.deleteOne({ _id: otpRecord._id }).exec();
          throw new UnauthorizedException('Too many wrong codes. Tap "Resend code" for a new one.');
        }
      }
      throw new UnauthorizedException('Invalid or expired verification code');
    }
    await this.signupOtpModel.deleteMany({ email: normalizedEmail }).exec();

    const existing = await this.businessesService.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }
    // A number a technician signs in with cannot also become an owner's —
    // phone sign-in would then open the wrong account.
    const phoneDigits = loginPhoneDigits(phone);
    if (phone?.trim() && !phoneDigits) {
      throw new BadRequestException('Enter a valid mobile number, or leave it empty.');
    }
    // Saved as +<country code><number> whatever was typed ("098470 12345",
    // "+91 98470 12345"), so phone sign-in and the duplicate check both match.
    phone = phoneDigits ? `+${phoneDigits}` : undefined;
    if (
      phoneDigits &&
      (await this.teamMembersService.findByLoginPhoneWithPassword(phoneDigits))
    ) {
      throw new ConflictException(
        'This phone number is already used by a team member login.',
      );
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    try {
      const business = await this.businessesService.createWithEmail({
        email: normalizedEmail,
        passwordHash,
        name: businessName,
        phone,
      });
      await this.servicePresetsService.seedDefaults(business.id);

      return this.issueOwnerToken(business);
    } catch (err: any) {
      if (err.code === 11000 || err.name === 'MongoServerError') {
        if (
          err.keyPattern?.phone ||
          err.errmsg?.includes('phone') ||
          err.message?.includes('phone')
        ) {
          throw new ConflictException(
            'An account with this phone number already exists.',
          );
        }
        throw new ConflictException(
          'An account with this email or phone already exists.',
        );
      }
      throw err;
    }
  }

  async loginWithEmail(email: string, password: string) {
    const normalizedEmail = email.toLowerCase();

    const business =
      await this.businessesService.findByEmailWithPassword(normalizedEmail);
    if (
      business?.passwordHash &&
      (await bcrypt.compare(password, business.passwordHash))
    ) {
      return this.issueOwnerToken(business);
    }

    // Emails are unique across businesses and team members (enforced at
    // creation), so a business match above and a team-member match here
    // never both happen for the same email.
    const teamMember =
      await this.teamMembersService.findByEmailWithPassword(normalizedEmail);
    if (
      teamMember?.passwordHash &&
      (await bcrypt.compare(password, teamMember.passwordHash))
    ) {
      return this.issueTechnicianToken(teamMember);
    }

    throw new UnauthorizedException('Invalid email or password');
  }

  // The same check as loginWithEmail, found by phone number: an owner's
  // number first, then a team member's. Same error either way, so it never
  // says which numbers have accounts.
  async loginWithPhone(phone: string, password: string) {
    const digits = loginPhoneDigits(phone);
    if (!digits)
      throw new UnauthorizedException('Invalid phone number or password');

    const business = await this.businessesService.findByLoginPhone(
      digits,
      true,
    );
    if (
      business?.passwordHash &&
      (await bcrypt.compare(password, business.passwordHash))
    ) {
      return this.issueOwnerToken(business);
    }

    const teamMember =
      await this.teamMembersService.findByLoginPhoneWithPassword(digits);
    if (
      teamMember?.passwordHash &&
      (await bcrypt.compare(password, teamMember.passwordHash))
    ) {
      return this.issueTechnicianToken(teamMember);
    }

    throw new UnauthorizedException('Invalid phone number or password');
  }

  /**
   * Signed in, changing one's own password. Technicians added by phone had
   * no way to do this at all — "Forgot password" works by email.
   */
  async changePassword(
    viewer: { businessId: string; role?: string; teamMemberId?: string },
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const isTech = isTeamMember(viewer) && !!viewer.teamMemberId;
    const holder = isTech
      ? await this.teamMembersService.findByIdWithPassword(viewer.teamMemberId!)
      : await this.businessesService.findByIdWithPassword(viewer.businessId);
    if (!holder?.passwordHash) {
      throw new BadRequestException(
        'This account signs in with Google or Apple, so it has no password to change.',
      );
    }
    if (!(await bcrypt.compare(currentPassword, holder.passwordHash))) {
      throw new UnauthorizedException('Your current password is not right.');
    }
    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    if (isTech)
      await this.teamMembersService.resetPasswordWithCode(
        holder.id,
        passwordHash,
      );
    else
      await this.businessesService.resetPasswordWithCode(
        holder.id,
        passwordHash,
      );
  }

  // Always resolves the same way (void, no error) regardless of whether the
  // email matches an account — the controller sends one generic message
  // either way, so this must never leak account existence through timing,
  // errors, or return shape. The one exception is devCode, only ever
  // populated outside production, mirroring the old OTP flow's devCode so
  // this is testable without real inbox access.
  async forgotPassword(email: string): Promise<{ devCode?: string }> {
    const normalizedEmail = email.toLowerCase();
    const business = await this.businessesService.findByEmail(normalizedEmail);
    // A technician resets their own password the same way. Registration
    // already refuses an email that belongs to a team member, so one address
    // is never both.
    const member = business
      ? null
      : await this.teamMembersService.findByEmail(normalizedEmail);
    if (!business && !(member && member.active)) {
      return {};
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, PASSWORD_SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000);

    if (business) {
      await this.businessesService.setPasswordResetCode(
        business.id,
        codeHash,
        expiresAt,
      );
    } else {
      await this.teamMembersService.setPasswordResetCode(
        member!.id,
        codeHash,
        expiresAt,
      );
    }
    await this.emailService.sendPasswordResetCode(normalizedEmail, code);

    const isProd = this.configService.get('NODE_ENV') === 'production';
    return isProd ? {} : { devCode: code };
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    const normalizedEmail = email.toLowerCase();
    const business =
      await this.businessesService.findByEmailWithResetCode(normalizedEmail);
    const member = business
      ? null
      : await this.teamMembersService.findByEmailWithResetCode(normalizedEmail);
    const holder = business ?? member;

    const isValid =
      holder?.passwordResetCodeHash &&
      holder.passwordResetExpiresAt &&
      holder.passwordResetExpiresAt.getTime() > Date.now() &&
      (holder.passwordResetAttempts ?? 0) < MAX_CODE_ATTEMPTS &&
      (await bcrypt.compare(code, holder.passwordResetCodeHash));

    if (!isValid || !holder) {
      if (holder?.passwordResetCodeHash) {
        const tries = business
          ? await this.businessesService.recordResetCodeFailure(business.id, MAX_CODE_ATTEMPTS)
          : await this.teamMembersService.recordResetCodeFailure(member!.id, MAX_CODE_ATTEMPTS);
        if (tries >= MAX_CODE_ATTEMPTS) {
          throw new UnauthorizedException('Too many wrong codes. Request a new code.');
        }
      }
      throw new UnauthorizedException('Invalid or expired code');
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    if (business) {
      // The code was emailed to this address, so using it proves the inbox.
      await this.businessesService.resetPasswordWithCode(
        business.id,
        passwordHash,
        { emailVerified: true },
      );
    } else {
      await this.teamMembersService.resetPasswordWithCode(
        member!.id,
        passwordHash,
      );
    }
  }

  async loginWithGoogle(idToken: string) {
    const webClientId = this.configService.get<string>('GOOGLE_WEB_CLIENT_ID');
    if (!webClientId) {
      throw new InternalServerErrorException(
        'Google sign-in is not configured on this server.',
      );
    }

    const ticket = await this.getGoogleClient(webClientId)
      .verifyIdToken({ idToken, audience: webClientId })
      .catch((err) => {
        console.error(
          `[loginWithGoogle] verifyIdToken failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });
    const payload = ticket?.getPayload();
    if (!payload?.sub || !payload.email) {
      // Logged as a string, not the raw value: when verification fails the
      // payload is undefined, and anything that inspects console arguments
      // (a log shipper, an editor's console hook) can throw on it — which
      // masked this 401 as a 500 and hid the real cause underneath.
      console.error(
        `[loginWithGoogle] missing sub/email in payload: ${JSON.stringify(payload ?? null)}`,
      );
      throw new UnauthorizedException('Invalid Google sign-in');
    }

    const googleId = payload.sub;
    // An address Google has not verified (possible for a Google account made
    // with a non-Gmail address) proves nothing, so it is never used to find
    // or create an account — the sign-in goes by the Google id alone.
    const email =
      payload.email_verified === true ? payload.email.toLowerCase() : null;

    let business = await this.businessesService.findByGoogleId(googleId);
    if (!business) {
      // A technician's email lives on a TeamMember, not a Business. Without
      // this the lookups below find nothing and a second, empty business gets
      // created — leaving the technician the owner of an account with none of
      // their employer's customers in it.
      const technician = await this.resolveTechnicianSignIn(
        'googleId',
        googleId,
        email,
      );
      if (technician) return technician;

      // Same email already has a phone/email account — link Google to it
      // rather than creating a second business for the same person. Only
      // when that account proved the address: anyone can type any email
      // into their profile, and linking on that alone handed them the real
      // owner's Google sign-in.
      const existingByEmail = await this.findLinkableByEmail(email);
      business = existingByEmail
        ? await this.businessesService.linkGoogleId(
            existingByEmail.id,
            googleId,
          )
        : await this.businessesService.createWithGoogle({
            email: email ?? undefined,
            googleId,
            name: payload.name,
          });
      if (!existingByEmail) {
        await this.servicePresetsService.seedDefaults(business.id);
      }
    }

    return this.issueOwnerToken(business);
  }

  // The business a verified provider email may sign in to. An account holding
  // the address without having proved it is not linked — the address is
  // taken off it instead, so the new account can be created with it (see
  // BusinessesService.releaseUnverifiedEmail).
  private async findLinkableByEmail(
    email: string | null,
  ): Promise<BusinessDocument | null> {
    if (!email) return null;
    const existing = await this.businessesService.findByEmail(email);
    if (!existing) return null;
    if (existing.emailVerified !== false) return existing;
    await this.businessesService.releaseUnverifiedEmail(existing.id);
    return null;
  }

  private googleClient?: OAuth2Client;
  private getGoogleClient(webClientId: string): OAuth2Client {
    if (!this.googleClient) {
      this.googleClient = new OAuth2Client(webClientId);
    }
    return this.googleClient;
  }

  // Verifies the identity token straight from expo-apple-authentication
  // against Apple's own public keys — never trusts a client-supplied
  // email/appleId, same principle as loginWithGoogle above. `fullName` is
  // client-supplied because Apple only ever sends the user's name once, on
  // the very first authorization, separately from the token — there's
  // nowhere else to get it, so it's only used to seed a brand-new account
  // and ignored when linking/logging into an existing one.
  //
  // `authorizationCode` (also from expo-apple-authentication) is optional:
  // when present it is exchanged for a refresh token, kept only so that
  // deleting the account can revoke it at Apple.
  async loginWithApple(
    identityToken: string,
    fullName?: string,
    authorizationCode?: string,
  ) {
    const bundleId =
      this.configService.get<string>('APPLE_BUNDLE_ID') ?? 'com.aglakaam.app';

    const { jwtVerify } = await (eval('import("jose")') as Promise<
      typeof import('jose')
    >);
    const jwks = await this.getAppleJWKS();
    const payload = await jwtVerify(identityToken, jwks, {
      issuer: APPLE_ISSUER,
      audience: bundleId,
    })
      .then((result) => result.payload)
      .catch((err) => {
        console.error(
          `[loginWithApple] jwtVerify failed (expected audience=${bundleId}):`,
          err,
        );
        return null;
      });
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid Apple sign-in');
    }

    const appleId = payload.sub;
    // Apple only issues addresses it has verified, private relay included;
    // the claim is still honoured if it ever says otherwise.
    const emailVerified =
      payload.email_verified !== false && payload.email_verified !== 'false';
    const email =
      typeof payload.email === 'string' && emailVerified
        ? payload.email.toLowerCase()
        : null;
    // The code is single-use and short-lived, so it is exchanged now or not
    // at all. Never blocks the sign-in.
    const appleRefreshToken = authorizationCode
      ? await this.appleSignInService.exchangeAuthorizationCode(
          authorizationCode,
          appleId,
        )
      : null;

    let business = await this.businessesService.findByAppleId(appleId);
    if (business) {
      if (appleRefreshToken) {
        await this.businessesService.setAppleRefreshToken(
          business.id,
          appleRefreshToken,
        );
      }
    } else {
      // Same reason as loginWithGoogle: a technician must resolve to their
      // employer's business, not a fresh empty one.
      const technician = await this.resolveTechnicianSignIn(
        'appleId',
        appleId,
        email,
        appleRefreshToken,
      );
      if (technician) return technician;

      // Verified-only, same as loginWithGoogle.
      const existingByEmail = await this.findLinkableByEmail(email);
      if (existingByEmail) {
        business = await this.businessesService.linkAppleId(
          existingByEmail.id,
          appleId,
          appleRefreshToken ?? undefined,
        );
      } else {
        if (!email) {
          // No existing account to link to, and Apple's private-relay
          // email isn't guaranteed present on every token — without an
          // email there's nothing usable to create an account with.
          throw new UnauthorizedException(
            'Apple did not provide an email for this sign-in.',
          );
        }
        business = await this.businessesService.createWithApple({
          email,
          appleId,
          name: fullName,
          appleRefreshToken: appleRefreshToken ?? undefined,
        });
      }
      if (!existingByEmail) {
        await this.servicePresetsService.seedDefaults(business.id);
      }
    }

    return this.issueOwnerToken(business);
  }

  private appleJWKS?: any;
  private async getAppleJWKS(): Promise<any> {
    if (!this.appleJWKS) {
      const { createRemoteJWKSet } = await (eval('import("jose")') as Promise<
        typeof import('jose')
      >);
      this.appleJWKS = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
    }
    return this.appleJWKS;
  }

  /**
   * App 1.0.0 treats every role except 'technician' as the owner, so a
   * manager signing in on it would be shown the owner's settings, plans and
   * team screens (all refused by the server). Until they update, such an app
   * gets the technician session it always had; 1.0.1 and later get manager.
   */
  async sessionForApp<T extends { accessToken: string; role?: string }>(
    session: T,
    appVersion?: string,
  ): Promise<T> {
    if (session.role !== 'manager') return session;
    if (appVersion && compareVersions(appVersion, MANAGER_ROLE_MIN_APP) >= 0) {
      return session;
    }
    const payload = await this.jwtService.verifyAsync<Record<string, unknown>>(
      session.accessToken,
    );
    const { iat: _iat, exp: _exp, ...claims } = payload;
    const accessToken = await this.jwtService.signAsync({
      ...claims,
      role: 'technician',
    });
    return { ...session, accessToken, role: 'technician' };
  }

  // A technician's token names the business they work for as `sub`, so every
  // downstream query scopes to that business, with role/teamMemberId marking
  // who is acting. Shared by the password and social sign-in paths.
  private async issueTechnicianToken(teamMember: TeamMemberDocument) {
    if (!teamMember.active) {
      throw new UnauthorizedException(
        'This team member account has been deactivated.',
      );
    }
    const business = await this.businessesService.findById(
      teamMember.businessId.toString(),
    );
    // A manager is the same TeamMember row with role 'manager'; every other
    // value (including rows from before roles existed) signs in as technician.
    const role: 'technician' | 'manager' =
      teamMember.role === 'manager' ? 'manager' : 'technician';
    // One phone per member: signing in here signs any other phone out.
    const sid = this.ownerSessions
      ? await this.ownerSessions.startMember(teamMember.id)
      : undefined;
    const accessToken = await this.jwtService.signAsync({
      sub: business.id,
      email: teamMember.email,
      role,
      teamMemberId: teamMember.id,
      ...(sid ? { sid } : {}),
    });
    return { accessToken, business, role };
  }

  // Google/Apple sign-in for a technician. Emails are globally unique across
  // businesses and team members (enforced when a member is created), so at
  // most one of these lookups can match — the provider id finds a returning
  // technician, the email finds one signing in socially for the first time.
  private async resolveTechnicianSignIn(
    provider: 'googleId' | 'appleId',
    providerId: string,
    email: string | null,
    appleRefreshToken?: string | null,
  ) {
    const byProvider =
      provider === 'googleId'
        ? await this.teamMembersService.findByGoogleId(providerId)
        : await this.teamMembersService.findByAppleId(providerId);
    if (byProvider) {
      const session = await this.issueTechnicianToken(byProvider);
      if (appleRefreshToken) {
        await this.teamMembersService.setAppleRefreshToken(
          byProvider.id,
          appleRefreshToken,
        );
      }
      return session;
    }

    const byEmail = email
      ? await this.teamMembersService.findByEmail(email)
      : null;
    if (!byEmail) return null;

    // Check the account is usable before writing the link, so a deactivated
    // member doesn't quietly get a provider id attached.
    if (!byEmail.active) {
      throw new UnauthorizedException(
        'This team member account has been deactivated.',
      );
    }
    await this.teamMembersService.linkProviderId(
      byEmail.id,
      provider,
      providerId,
    );
    if (appleRefreshToken) {
      await this.teamMembersService.setAppleRefreshToken(
        byEmail.id,
        appleRefreshToken,
      );
    }
    return this.issueTechnicianToken(byEmail);
  }

  private async issueOwnerToken(business: BusinessDocument) {
    // Each sign-in is its own session; past the owner's phone limit the
    // oldest phone is signed out (see OwnerSessionsService).
    const sid = this.ownerSessions
      ? await this.ownerSessions.start(business.id)
      : undefined;
    const accessToken = await this.jwtService.signAsync({
      sub: business.id,
      phone: business.phone,
      email: business.email,
      role: 'owner',
      ...(sid ? { sid } : {}),
    });
    return { accessToken, business, role: 'owner' as const };
  }
}
