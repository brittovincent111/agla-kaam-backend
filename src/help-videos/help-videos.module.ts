import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HelpVideo, HelpVideoSchema } from './help-video.schema';
import { HelpVideosService } from './help-videos.service';
import { HelpVideosController } from './help-videos.controller';
import { AdminHelpVideosController } from './admin-help-videos.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TeamMembersModule } from '../team-members/team-members.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HelpVideo.name, schema: HelpVideoSchema },
    ]),
    // JwtAuthGuard needs both to admit a technician or manager: without
    // TeamMembersService it refuses every team member (fails closed).
    SubscriptionsModule,
    TeamMembersModule,
  ],
  controllers: [HelpVideosController, AdminHelpVideosController],
  providers: [HelpVideosService],
})
export class HelpVideosModule {}
