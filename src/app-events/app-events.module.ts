import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppEvent, AppEventSchema } from './app-event.schema';
import { AppEventsController } from './app-events.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: AppEvent.name, schema: AppEventSchema }])],
  controllers: [AppEventsController],
})
export class AppEventsModule {}
