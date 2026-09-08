import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
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

const PASSWORD_SALT_ROUNDS = 10;
const RESET_CODE_TTL_MINUTES = 15;
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

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
  ) {}

  async sendSignupOtp(email: string): Promise<{ devCode?: string }> {
    const normalizedEmail = email.toLowerCase();
    const existingBusiness = await this.businessesService.findByEmail(normalizedEmail);
    if (existingBusiness) {
      throw new ConflictException('An account with this email already exists.');
    }
    const existingMember = await this.teamMembersService.findByEmail(normalizedEmail);
    if (existingMember) {
      throw new ConflictException('This email is already registered as a team member.');
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

    if (code) {
      const otpRecord = await this.signupOtpModel
        .findOne({ email: normalizedEmail })
        .exec();
      const isValid =
        otpRecord &&
        otpRecord.expiresAt.getTime() > Date.now() &&
        (await bcrypt.compare(code, otpRecord.codeHash));

      if (!isValid) {
        throw new UnauthorizedException('Invalid or expired verification code');
      }
      await this.signupOtpModel.deleteMany({ email: normalizedEmail }).exec();
    }

    const existing = await this.businessesService.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
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

  // Always resolves the same way (void, no error) regardless of whether the
  // email matches an account — the controller sends one generic message
  // either way, so this must never leak account existence through timing,
  // errors, or return shape. The one exception is devCode, only ever
  // populated outside production, mirroring the old OTP flow's devCode so
  // this is testable without real inbox access.
  async forgotPassword(email: string): Promise<{ devCode?: string }> {
    const normalizedEmail = email.toLowerCase();
    const business = await this.businessesService.findByEmail(normalizedEmail);
    if (!business) {
      return {};
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, PASSWORD_SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000);

    await this.businessesService.setPasswordResetCode(
      business.id,
      codeHash,
      expiresAt,
    );
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

    const isValid =
      business?.passwordResetCodeHash &&
      business.passwordResetExpiresAt &&
      business.passwordResetExpiresAt.getTime() > Date.now() &&
      (await bcrypt.compare(code, business.passwordResetCodeHash));

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    await this.businessesService.resetPasswordWithCode(
      business.id,
      passwordHash,
    );
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
        console.error('[loginWithGoogle] verifyIdToken failed:', err);
        return null;
      });
    const payload = ticket?.getPayload();
    if (!payload?.sub || !payload.email) {
      console.error('[loginWithGoogle] missing sub/email in payload:', payload);
      throw new UnauthorizedException('Invalid Google sign-in');
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();

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
      // rather than creating a second business for the same person.
      const existingByEmail = await this.businessesService.findByEmail(email);
      business = existingByEmail
        ? await this.businessesService.linkGoogleId(
            existingByEmail.id,
            googleId,
          )
        : await this.businessesService.createWithGoogle({
            email,
            googleId,
            name: payload.name,
          });
      if (!existingByEmail) {
        await this.servicePresetsService.seedDefaults(business.id);
      }
    }

    return this.issueOwnerToken(business);
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
  async loginWithApple(identityToken: string, fullName?: string) {
    const bundleId =
      this.configService.get<string>('APPLE_BUNDLE_ID') ?? 'com.aglakaam.app';

    const { jwtVerify } = await (eval('import("jose")') as Promise<typeof import('jose')>);
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
    const email =
      typeof payload.email === 'string' ? payload.email.toLowerCase() : null;

    let business = await this.businessesService.findByAppleId(appleId);
    if (!business) {
      // Same reason as loginWithGoogle: a technician must resolve to their
      // employer's business, not a fresh empty one.
      const technician = await this.resolveTechnicianSignIn(
        'appleId',
        appleId,
        email,
      );
      if (technician) return technician;

      const existingByEmail = email
        ? await this.businessesService.findByEmail(email)
        : null;
      if (existingByEmail) {
        business = await this.businessesService.linkAppleId(
          existingByEmail.id,
          appleId,
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
      const { createRemoteJWKSet } = await (eval('import("jose")') as Promise<typeof import('jose')>);
      this.appleJWKS = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
    }
    return this.appleJWKS;
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
    const accessToken = await this.jwtService.signAsync({
      sub: business.id,
      email: teamMember.email,
      role: 'technician',
      teamMemberId: teamMember.id,
    });
    return { accessToken, business, role: 'technician' as const };
  }

  // Google/Apple sign-in for a technician. Emails are globally unique across
  // businesses and team members (enforced when a member is created), so at
  // most one of these lookups can match — the provider id finds a returning
  // technician, the email finds one signing in socially for the first time.
  private async resolveTechnicianSignIn(
    provider: 'googleId' | 'appleId',
    providerId: string,
    email: string | null,
  ) {
    const byProvider =
      provider === 'googleId'
        ? await this.teamMembersService.findByGoogleId(providerId)
        : await this.teamMembersService.findByAppleId(providerId);
    if (byProvider) {
      return this.issueTechnicianToken(byProvider);
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
    return this.issueTechnicianToken(byEmail);
  }

  private async issueOwnerToken(business: BusinessDocument) {
    const accessToken = await this.jwtService.signAsync({
      sub: business.id,
      phone: business.phone,
      email: business.email,
      role: 'owner',
    });
    return { accessToken, business, role: 'owner' as const };
  }
}
