import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppFeedbackController } from './app-feedback.controller';
import { AppFeedbackService } from './app-feedback.service';
import { AppFeedback, AppFeedbackSchema } from './schemas/app-feedback.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppFeedback.name, schema: AppFeedbackSchema },
    ]),
  ],
  controllers: [AppFeedbackController],
  providers: [AppFeedbackService],
})
export class AppFeedbackModule {}
