import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { BusinessesModule } from '../businesses/businesses.module';
import { ServicePresetsModule } from '../service-presets/service-presets.module';
import { TeamMembersModule } from '../team-members/team-members.module';
import { EmailService } from '../common/email/email.service';

@Module({
  imports: [BusinessesModule, ServicePresetsModule, TeamMembersModule],
  controllers: [AuthController],
  providers: [AuthService, EmailService],
})
export class AuthModule {}
