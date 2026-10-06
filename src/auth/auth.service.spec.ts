import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { BusinessesService } from '../businesses/businesses.service';
import { TeamMembersService } from '../team-members/team-members.service';
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { EmailService } from '../common/email/email.service';
import { AppleSignInService } from '../common/apple/apple-sign-in.service';

// Covers the account a social sign-in resolves to. A technician's email lives
// on a TeamMember, so before resolveTechnicianSignIn existed these paths fell
// through to createWithGoogle/createWithApple and handed the technician a
// brand-new empty business instead of their employer's.
describe('AuthService — social sign-in identity resolution', () => {
  let service: AuthService;

  const EMPLOYER = { id: 'biz-employer', name: "Employer's Shop" };

  const businesses = {
    findByGoogleId: jest.fn(),
    findByAppleId: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    linkGoogleId: jest.fn(),
    linkAppleId: jest.fn(),
    createWithGoogle: jest.fn(),
    createWithApple: jest.fn(),
    releaseUnverifiedEmail: jest.fn(),
    setAppleRefreshToken: jest.fn(),
    findByEmailWithResetCode: jest.fn(),
    resetPasswordWithCode: jest.fn(),
  };
  const teamMembers = {
    findByGoogleId: jest.fn(),
    findByAppleId: jest.fn(),
    findByEmail: jest.fn(),
    linkProviderId: jest.fn(),
    setAppleRefreshToken: jest.fn(),
    findByEmailWithResetCode: jest.fn(),
  };
  const appleSignIn = { exchangeAuthorizationCode: jest.fn() };
  const servicePresets = { seedDefaults: jest.fn() };
  const signupOtpModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn().mockReturnValue({ exec: jest.fn() }),
  };

  const technician = (over: Record<string, unknown> = {}) => ({
    id: 'tm-1',
    email: 'tech@shop.com',
    businessId: { toString: () => EMPLOYER.id },
    active: true,
    ...over,
  });

  let googlePayload: Record<string, unknown>;

  beforeEach(async () => {
    jest.clearAllMocks();
    googlePayload = {
      sub: 'google-sub-1',
      email: 'tech@shop.com',
      email_verified: true,
    };
    businesses.findByGoogleId.mockResolvedValue(null);
    businesses.findByAppleId.mockResolvedValue(null);
    businesses.findByEmail.mockResolvedValue(null);
    businesses.findById.mockResolvedValue(EMPLOYER);
    teamMembers.findByGoogleId.mockResolvedValue(null);
    teamMembers.findByAppleId.mockResolvedValue(null);
    teamMembers.findByEmail.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken('SignupOtp'), useValue: signupOtpModel },
        { provide: BusinessesService, useValue: businesses },
        { provide: TeamMembersService, useValue: teamMembers },
        { provide: ServicePresetsService, useValue: servicePresets },
        {
          provide: EmailService,
          useValue: {
            sendPasswordResetCode: jest.fn(),
            sendSignupVerificationOtp: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('tok') },
        },
        { provide: ConfigService, useValue: { get: () => 'test-client-id' } },
        { provide: AppleSignInService, useValue: appleSignIn },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    // Token verification is Google/Apple's job and is covered by their own
    // libraries — stub it so these tests exercise only the branch that picks
    // which account a verified identity maps to.
    (service as any).getGoogleClient = () => ({
      verifyIdToken: async () => ({
        getPayload: () => googlePayload,
      }),
    });
  });

  const signInWithGoogle = () => service.loginWithGoogle('any-token');

  it('signs a technician in to their employer, by email on first social login', async () => {
    teamMembers.findByEmail.mockResolvedValue(technician());

    const res = await signInWithGoogle();

    expect(res.role).toBe('technician');
    expect(res.business).toBe(EMPLOYER);
    // The regression this guards: no second business may be created.
    expect(businesses.createWithGoogle).not.toHaveBeenCalled();
    expect(servicePresets.seedDefaults).not.toHaveBeenCalled();
  });

  it('stores the provider id so the next sign-in matches without the email', async () => {
    teamMembers.findByEmail.mockResolvedValue(technician());

    await signInWithGoogle();

    expect(teamMembers.linkProviderId).toHaveBeenCalledWith(
      'tm-1',
      'googleId',
      'google-sub-1',
    );
  });

  it('matches a returning technician by provider id', async () => {
    teamMembers.findByGoogleId.mockResolvedValue(technician());

    const res = await signInWithGoogle();

    expect(res.role).toBe('technician');
    // Already linked — must not be written again.
    expect(teamMembers.linkProviderId).not.toHaveBeenCalled();
  });

  it('refuses a deactivated technician, and does not link them', async () => {
    teamMembers.findByEmail.mockResolvedValue(technician({ active: false }));

    await expect(signInWithGoogle()).rejects.toThrow(UnauthorizedException);
    expect(teamMembers.linkProviderId).not.toHaveBeenCalled();
    expect(businesses.createWithGoogle).not.toHaveBeenCalled();
  });

  it('still links an owner whose verified business email matches', async () => {
    businesses.findByEmail.mockResolvedValue({
      id: 'biz-owner',
      emailVerified: true,
    });
    businesses.linkGoogleId.mockResolvedValue({ id: 'biz-owner' });

    const res = await signInWithGoogle();

    expect(res.role).toBe('owner');
    expect(businesses.linkGoogleId).toHaveBeenCalledWith(
      'biz-owner',
      'google-sub-1',
    );
    expect(businesses.createWithGoogle).not.toHaveBeenCalled();
  });

  // Accounts from before the flag existed were all set up at a verified
  // sign-up; a returning owner must keep signing in to their own business.
  it('links an older account that has no verified flag at all', async () => {
    businesses.findByEmail.mockResolvedValue({ id: 'biz-old' });
    businesses.linkGoogleId.mockResolvedValue({ id: 'biz-old' });

    await signInWithGoogle();

    expect(businesses.linkGoogleId).toHaveBeenCalledWith('biz-old', 'google-sub-1');
    expect(businesses.releaseUnverifiedEmail).not.toHaveBeenCalled();
    expect(businesses.createWithGoogle).not.toHaveBeenCalled();
  });

  it('still creates a business for a genuinely new user', async () => {
    businesses.createWithGoogle.mockResolvedValue({ id: 'biz-new' });

    const res = await signInWithGoogle();

    expect(res.role).toBe('owner');
    expect(businesses.createWithGoogle).toHaveBeenCalled();
    expect(servicePresets.seedDefaults).toHaveBeenCalledWith('biz-new');
  });

  // The takeover this guards: any owner could type someone else's address
  // into their profile, then wait for that person to sign in with Google and
  // be handed the attacker's account (or vice versa).
  it('does not link a business that never verified the matching email', async () => {
    businesses.findByEmail.mockResolvedValue({
      id: 'biz-squatter',
      emailVerified: false,
    });
    businesses.createWithGoogle.mockResolvedValue({ id: 'biz-new' });

    const res = await signInWithGoogle();

    expect(businesses.linkGoogleId).not.toHaveBeenCalled();
    expect(businesses.releaseUnverifiedEmail).toHaveBeenCalledWith(
      'biz-squatter',
    );
    expect(businesses.createWithGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'tech@shop.com', googleId: 'google-sub-1' }),
    );
    expect(res.business).toEqual({ id: 'biz-new' });
  });

  it('ignores an email Google has not verified', async () => {
    googlePayload.email_verified = false;
    businesses.createWithGoogle.mockResolvedValue({ id: 'biz-new' });

    await signInWithGoogle();

    expect(businesses.findByEmail).not.toHaveBeenCalled();
    expect(teamMembers.findByEmail).not.toHaveBeenCalled();
    expect(businesses.createWithGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ email: undefined }),
    );
  });

  describe('Apple', () => {
    const signInWithApple = (code?: string) =>
      service.loginWithApple('identity-token', 'Ravi', code);

    beforeEach(() => {
      (service as any).getAppleJWKS = async () => ({});
    });

    // jwtVerify lives in jose (ESM, loaded through eval); stub the dynamic
    // import so only the account-resolution branch runs.
    const withApplePayload = (payload: Record<string, unknown>) => {
      const realEval = global.eval;
      jest.spyOn(global, 'eval').mockImplementation(((src: string) =>
        src === 'import("jose")'
          ? Promise.resolve({ jwtVerify: async () => ({ payload }) })
          : realEval(src)) as never);
    };

    afterEach(() => jest.restoreAllMocks());

    it('does not link a business that never verified the matching email', async () => {
      withApplePayload({ sub: 'apple-sub-1', email: 'owner@shop.com' });
      businesses.findByEmail.mockResolvedValue({
        id: 'biz-squatter',
        emailVerified: false,
      });
      businesses.createWithApple.mockResolvedValue({ id: 'biz-new' });

      await signInWithApple();

      expect(businesses.linkAppleId).not.toHaveBeenCalled();
      expect(businesses.releaseUnverifiedEmail).toHaveBeenCalledWith(
        'biz-squatter',
      );
      expect(businesses.createWithApple).toHaveBeenCalled();
    });

    it('stores the refresh token from the authorization code on a new account', async () => {
      withApplePayload({ sub: 'apple-sub-1', email: 'new@privaterelay.appleid.com' });
      appleSignIn.exchangeAuthorizationCode.mockResolvedValue('refresh-1');
      businesses.createWithApple.mockResolvedValue({ id: 'biz-new' });

      await signInWithApple('auth-code');

      expect(appleSignIn.exchangeAuthorizationCode).toHaveBeenCalledWith(
        'auth-code',
        'apple-sub-1',
      );
      expect(businesses.createWithApple).toHaveBeenCalledWith(
        expect.objectContaining({ appleRefreshToken: 'refresh-1' }),
      );
    });

    it('refreshes the stored token for a returning user', async () => {
      withApplePayload({ sub: 'apple-sub-1' });
      appleSignIn.exchangeAuthorizationCode.mockResolvedValue('refresh-2');
      businesses.findByAppleId.mockResolvedValue({ id: 'biz-owner' });

      await signInWithApple('auth-code');

      expect(businesses.setAppleRefreshToken).toHaveBeenCalledWith(
        'biz-owner',
        'refresh-2',
      );
    });

    it('signs in without a code, and without calling Apple', async () => {
      withApplePayload({ sub: 'apple-sub-1' });
      businesses.findByAppleId.mockResolvedValue({ id: 'biz-owner' });

      const res = await signInWithApple();

      expect(res.role).toBe('owner');
      expect(appleSignIn.exchangeAuthorizationCode).not.toHaveBeenCalled();
    });
  });

  it('marks the email verified after a password reset by emailed code', async () => {
    const bcrypt = await import('bcrypt');
    businesses.findByEmailWithResetCode.mockResolvedValue({
      id: 'biz-owner',
      passwordResetCodeHash: await bcrypt.hash('123456', 4),
      passwordResetExpiresAt: new Date(Date.now() + 60_000),
      passwordResetAttempts: 0,
    });

    await service.resetPassword('owner@shop.com', '123456', 'new-password-1');

    expect(businesses.resetPasswordWithCode).toHaveBeenCalledWith(
      'biz-owner',
      expect.any(String),
      { emailVerified: true },
    );
  });
});
