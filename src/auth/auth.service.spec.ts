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
  };
  const teamMembers = {
    findByGoogleId: jest.fn(),
    findByAppleId: jest.fn(),
    findByEmail: jest.fn(),
    linkProviderId: jest.fn(),
  };
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

  beforeEach(async () => {
    jest.clearAllMocks();
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
        { provide: EmailService, useValue: { sendPasswordResetCode: jest.fn(), sendSignupVerificationOtp: jest.fn() } },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('tok') } },
        { provide: ConfigService, useValue: { get: () => 'test-client-id' } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    // Token verification is Google/Apple's job and is covered by their own
    // libraries — stub it so these tests exercise only the branch that picks
    // which account a verified identity maps to.
    (service as any).getGoogleClient = () => ({
      verifyIdToken: async () => ({
        getPayload: () => ({ sub: 'google-sub-1', email: 'tech@shop.com' }),
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

  it('still links an owner whose business email matches', async () => {
    businesses.findByEmail.mockResolvedValue({ id: 'biz-owner' });
    businesses.linkGoogleId.mockResolvedValue({ id: 'biz-owner' });

    const res = await signInWithGoogle();

    expect(res.role).toBe('owner');
    expect(businesses.linkGoogleId).toHaveBeenCalledWith('biz-owner', 'google-sub-1');
    expect(businesses.createWithGoogle).not.toHaveBeenCalled();
  });

  it('still creates a business for a genuinely new user', async () => {
    businesses.createWithGoogle.mockResolvedValue({ id: 'biz-new' });

    const res = await signInWithGoogle();

    expect(res.role).toBe('owner');
    expect(businesses.createWithGoogle).toHaveBeenCalled();
    expect(servicePresets.seedDefaults).toHaveBeenCalledWith('biz-new');
  });
});
