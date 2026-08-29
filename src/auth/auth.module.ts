import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Otp, OtpSchema } from './schemas/otp.schema';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { BusinessesModule } from '../businesses/businesses.module';
import { ServicePresetsModule } from '../service-presets/service-presets.module';
import { TeamMembersModule } from '../team-members/team-members.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Otp.name, schema: OtpSchema }]),
    BusinessesModule,
    ServicePresetsModule,
    TeamMembersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
