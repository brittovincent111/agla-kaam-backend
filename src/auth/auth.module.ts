import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { SignupOtp, SignupOtpSchema } from './schemas/signup-otp.schema';
import { BusinessesModule } from '../businesses/businesses.module';
import { ServicePresetsModule } from '../service-presets/service-presets.module';
import { TeamMembersModule } from '../team-members/team-members.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EmailService } from '../common/email/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SignupOtp.name, schema: SignupOtpSchema },
    ]),
    BusinessesModule,
    ServicePresetsModule,
    TeamMembersModule,
    SubscriptionsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailService],
})
export class AuthModule {}

