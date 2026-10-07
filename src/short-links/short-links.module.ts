import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ShortLink, ShortLinkSchema } from './short-link.schema';
import { ShortLinksService } from './short-links.service';
import {
  PublicLinksController,
  ShortLinksController,
} from './short-links.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShortLink.name, schema: ShortLinkSchema },
    ]),
  ],
  controllers: [ShortLinksController, PublicLinksController],
  providers: [ShortLinksService],
  exports: [ShortLinksService],
})
export class ShortLinksModule {}
