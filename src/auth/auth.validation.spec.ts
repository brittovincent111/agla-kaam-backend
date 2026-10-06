import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { BusinessesService } from '../businesses/businesses.service';
import { TeamMembersService } from '../team-members/team-members.service';
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { EmailService } from '../common/email/email.service';
import { AppleSignInService } from '../common/apple/apple-sign-in.service';
import { RegisterEmailDto } from './dto/register-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

// Sign-up hashes the password at full strength, which is slow on a busy test
// run, so these tests get more time than the 5s default.
jest.setTimeout(60_000);

// Sign-up and password-reset input: emailed codes can't be guessed by
// retrying, and the owner's phone is saved in one shape.
describe('AuthService — sign-up and reset checks', () => {
  let service: AuthService;
  let otp: { _id: string; codeHash: string; expiresAt: Date; attempts: number } | null;
  const created: any[] = [];

  const signupOtpModel = {
    findOne: jest.fn(() => ({ exec: async () => otp })),
    findOneAndUpdate: jest.fn((_q: unknown, u: any) => ({
      exec: async () => {
        if (otp) otp.attempts += u.$inc.attempts;
        return otp;
      },
    })),
    deleteOne: jest.fn(() => ({ exec: async () => { otp = null; } })),
    deleteMany: jest.fn(() => ({ exec: async () => { otp = null; } })),
  };
  const businesses = {
    findByEmail: jest.fn(async () => null),
    createWithEmail: jest.fn(async (p: any) => {
      created.push(p);
      return { id: 'b1', ...p };
    }),
    findByEmailWithResetCode: jest.fn(),
    recordResetCodeFailure: jest.fn(),
  };
  const teamMembers = {
    findByLoginPhoneWithPassword: jest.fn(async () => null),
    findByEmailWithResetCode: jest.fn(async () => null),
    recordResetCodeFailure: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    created.length = 0;
    otp = { _id: 'o1', codeHash: await bcrypt.hash('123456', 4), expiresAt: new Date(Date.now() + 600_000), attempts: 0 };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken('SignupOtp'), useValue: signupOtpModel },
        { provide: BusinessesService, useValue: businesses },
        { provide: TeamMembersService, useValue: teamMembers },
        { provide: ServicePresetsService, useValue: { seedDefaults: jest.fn() } },
        { provide: EmailService, useValue: { sendPasswordResetCode: jest.fn(), sendSignupVerificationOtp: jest.fn() } },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('tok') } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: AppleSignInService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('a sign-up code is thrown away after 5 wrong tries', async () => {
    for (let i = 0; i < 4; i++) {
      await expect(service.registerWithEmail('a@b.co', 'password1', 'Shop', undefined, '000000')).rejects.toThrow(
        'Invalid or expired verification code',
      );
    }
    await expect(service.registerWithEmail('a@b.co', 'password1', 'Shop', undefined, '000000')).rejects.toThrow(
      /Too many wrong codes/,
    );
    expect(otp).toBeNull();
    // Even the right code no longer works.
    await expect(service.registerWithEmail('a@b.co', 'password1', 'Shop', undefined, '123456')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([['098470 12345'], ['+91 98470 12345'], ['9847012345'], ['+91 +91 98470 12345']])(
    'saves the owner phone %s as +919847012345',
    async (typed) => {
      await service.registerWithEmail('a@b.co', 'password1', 'Shop', typed, '123456');
      expect(created[0].phone).toBe('+919847012345');
    },
  );

  it('refuses a phone that is not a phone number', async () => {
    await expect(service.registerWithEmail('a@b.co', 'password1', 'Shop', '12', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('no phone stays no phone', async () => {
    await service.registerWithEmail('a@b.co', 'password1', 'Shop', '', '123456');
    expect(created[0].phone).toBeUndefined();
  });

  it('a wrong reset code is counted, and the 5th throws the code away', async () => {
    businesses.findByEmailWithResetCode.mockResolvedValue({
      id: 'b1',
      passwordResetCodeHash: await bcrypt.hash('654321', 4),
      passwordResetExpiresAt: new Date(Date.now() + 600_000),
      passwordResetAttempts: 4,
    });
    businesses.recordResetCodeFailure.mockResolvedValue(5);
    await expect(service.resetPassword('a@b.co', '000000', 'newpassword')).rejects.toThrow(/Too many wrong codes/);
    expect(businesses.recordResetCodeFailure).toHaveBeenCalledWith('b1', 5);
  });
});

describe('auth input rules', () => {
  const errors = async (cls: any, body: Record<string, unknown>) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('sign-up: trims the email and needs a 6-digit code', async () => {
    const dto = plainToInstance(RegisterEmailDto, { email: '  Ravi@Shop.in ', password: 'password1', code: '123456' });
    expect(dto.email).toBe('Ravi@Shop.in');
    expect(await validate(dto)).toHaveLength(0);
    expect(await errors(RegisterEmailDto, { email: 'a@b.co', password: 'password1', code: '12ab56' })).toContain('code');
    expect(await errors(RegisterEmailDto, { email: 'a@b.co', password: 'short', code: '123456' })).toContain('password');
    expect(await errors(RegisterEmailDto, { email: 'not-an-email', password: 'password1', code: '123456' })).toContain('email');
  });

  it('reset: 6-digit code only', async () => {
    expect(await errors(ResetPasswordDto, { email: 'a@b.co', code: '1234567', newPassword: 'password1' })).toContain('code');
    expect(await errors(ResetPasswordDto, { email: 'a@b.co', code: '123456', newPassword: 'password1' })).toHaveLength(0);
  });
});
