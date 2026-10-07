import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// A short code standing in for a long signed share link in a WhatsApp
// message. The signed link stays the real credential; this only points at it.
@Schema({ timestamps: true })
export class ShortLink {
  @Prop({ required: true, unique: true })
  code: string;

  @Prop({ required: true })
  target: string;

  // Removed by MongoDB once the link it points to has expired anyway.
  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;
}

export type ShortLinkDocument = HydratedDocument<ShortLink>;
export const ShortLinkSchema = SchemaFactory.createForClass(ShortLink);
