import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuickNote, QuickNoteSchema } from './schemas/quick-note.schema';
import { QuickNotesService } from './quick-notes.service';
import { QuickNotesController } from './quick-notes.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: QuickNote.name, schema: QuickNoteSchema },
    ]),
  ],
  controllers: [QuickNotesController],
  providers: [QuickNotesService],
  exports: [QuickNotesService],
})
export class QuickNotesModule {}
