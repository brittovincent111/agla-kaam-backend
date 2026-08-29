import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { Otp, OtpDocument } from './schemas/otp.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { TeamMembersService } from '../team-members/team-members.service';

const OTP_TTL_MINUTES = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(Otp.name) private readonly otpModel: Model<OtpDocument>,
    private readonly businessesService: BusinessesService,
    private readonly servicePresetsService: ServicePresetsService,
    private readonly teamMembersService: TeamMembersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async requestOtp(
    phone: string,
  ): Promise<{ message: string; devCode?: string }> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.otpModel.create({ phone, code, expiresAt });

    // TODO: replace with a real SMS/OTP provider (e.g. MSG91, Twilio Verify).
    // For now the code is logged server-side so the flow is testable end-to-end
    // without a paid SMS account.
    this.logger.log(
      `OTP for ${phone}: ${code} (expires in ${OTP_TTL_MINUTES}m)`,
    );

    const isProd = this.configService.get('NODE_ENV') === 'production';
    return {
      message: 'OTP sent',
      ...(isProd ? {} : { devCode: code }),
    };
  }

  async verifyOtp(phone: string, code: string) {
    const otp = await this.otpModel
      .findOne({ phone, code, consumed: false })
      .sort({ createdAt: -1 })
      .exec();

    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    otp.consumed = true;
    await otp.save();

    // A phone that belongs to a team member logs into the owner's business
    // as a technician — it never auto-creates its own Business record.
    const teamMember = await this.teamMembersService.findByPhone(phone);
    if (teamMember) {
      if (!teamMember.active) {
        throw new UnauthorizedException('This team member account has been deactivated.');
      }
      const business = await this.businessesService.findById(teamMember.businessId.toString());
      const accessToken = await this.jwtService.signAsync({
        sub: business.id,
        phone,
        role: 'technician',
        teamMemberId: teamMember.id,
      });
      return { accessToken, business, role: 'technician' as const };
    }

    const { business, isNew } =
      await this.businessesService.findOrCreateByPhone(phone);
    if (isNew) {
      await this.servicePresetsService.seedDefaults(business.id);
    }

    const accessToken = await this.jwtService.signAsync({
      sub: business.id,
      phone: business.phone,
      role: 'owner',
    });

    return { accessToken, business, role: 'owner' as const };
  }
}
