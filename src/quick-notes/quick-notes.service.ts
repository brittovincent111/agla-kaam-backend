import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QuickNote, QuickNoteDocument } from './schemas/quick-note.schema';
import { CreateQuickNoteDto } from './dto/create-quick-note.dto';
import { UpdateQuickNoteDto } from './dto/update-quick-note.dto';
import { ListQuickNotesDto } from './dto/list-quick-notes.dto';

@Injectable()
export class QuickNotesService {
  constructor(
    @InjectModel(QuickNote.name)
    private readonly quickNoteModel: Model<QuickNoteDocument>,
  ) {}

  async create(
    businessId: string,
    userId: string | null,
    dto: CreateQuickNoteDto,
  ): Promise<QuickNoteDocument> {
    const note = new this.quickNoteModel({
      businessId,
      userId: userId || null,
      title: dto.title.trim(),
      reminderAt: dto.reminderAt ? new Date(dto.reminderAt) : null,
      pinned: dto.pinned === true,
      completed: false,
      completedAt: null,
    });
    return note.save();
  }

  async findAll(
    businessId: string,
    query?: ListQuickNotesDto,
  ): Promise<QuickNoteDocument[]> {
    const filter: Record<string, unknown> = { businessId };

    if (query?.status === 'active') {
      filter.completed = false;
    } else if (query?.status === 'completed') {
      filter.completed = true;
    }

    const notes = await this.quickNoteModel.find(filter).exec();

    // Sort:
    // 1. Pinned first (pinned: true before pinned: false)
    // 2. If completed: newest completed first
    // 3. For active: Date-wise — items WITH reminderAt come first, sorted chronologically (earliest first)
    // 4. Notes WITHOUT reminderAt show at the VERY BOTTOM, sorted by createdAt desc
    notes.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      if (a.completed) {
        const aComp = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bComp = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        if (aComp !== bComp) return bComp - aComp;
      }
      const aRem = a.reminderAt ? new Date(a.reminderAt).getTime() : null;
      const bRem = b.reminderAt ? new Date(b.reminderAt).getTime() : null;
      if (aRem !== null && bRem !== null) {
        if (aRem !== bRem) return aRem - bRem;
      } else if (aRem !== null && bRem === null) {
        return -1;
      } else if (aRem === null && bRem !== null) {
        return 1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (query?.limit && query.limit > 0) {
      return notes.slice(0, query.limit);
    }

    return notes;
  }

  async findOne(businessId: string, id: string): Promise<QuickNoteDocument> {
    const note = await this.quickNoteModel
      .findOne({ _id: id, businessId })
      .exec();
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  async update(
    businessId: string,
    id: string,
    dto: UpdateQuickNoteDto,
  ): Promise<QuickNoteDocument> {
    const note = await this.findOne(businessId, id);

    if (dto.title !== undefined) {
      note.title = dto.title.trim();
    }
    if (dto.reminderAt !== undefined) {
      note.reminderAt = dto.reminderAt ? new Date(dto.reminderAt) : null;
    }
    if (dto.pinned !== undefined) {
      note.pinned = dto.pinned;
    }
    if (dto.completed !== undefined) {
      note.completed = dto.completed;
      note.completedAt = dto.completed ? new Date() : null;
    }

    return note.save();
  }

  async delete(businessId: string, id: string): Promise<void> {
    const res = await this.quickNoteModel
      .deleteOne({ _id: id, businessId })
      .exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('Note not found');
    }
  }
}
