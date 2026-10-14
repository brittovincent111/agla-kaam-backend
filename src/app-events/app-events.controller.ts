import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { APP_EVENTS, AppEvent, AppEventDocument } from './app-event.schema';

export class AppEventDto {
  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  installId: string;

  @IsIn(APP_EVENTS as unknown as string[])
  event: (typeof APP_EVENTS)[number];

  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;
}

/** Public: sent by the app before anyone has an account. */
@Controller('app-events')
export class AppEventsController {
  constructor(@InjectModel(AppEvent.name) private readonly model: Model<AppEventDocument>) {}

  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async record(@Body() dto: AppEventDto): Promise<void> {
    // Once per install and step: a repeat is a no-op, never a second row.
    await this.model
      .updateOne(
        { installId: dto.installId, event: dto.event },
        { $setOnInsert: { platform: dto.platform, at: new Date() } },
        { upsert: true },
      )
      .exec()
      .catch(() => undefined);
  }
}
