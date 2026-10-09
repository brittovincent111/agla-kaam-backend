import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { QuickNotesService } from './quick-notes.service';
import { QuickNote } from './schemas/quick-note.schema';

describe('QuickNotesService', () => {
  let service: QuickNotesService;
  let mockModel: any;

  const mockNote = {
    _id: 'note-1',
    businessId: 'biz-1',
    userId: 'user-1',
    title: 'Buy 1.5HP capacitor',
    reminderAt: null,
    completed: false,
    pinned: false,
    completedAt: null,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  beforeEach(async () => {
    mockModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      _id: 'note-new',
      save: jest.fn().mockResolvedValue({ _id: 'note-new', ...dto }),
    }));
    mockModel.find = jest.fn();
    mockModel.findOne = jest.fn();
    mockModel.deleteOne = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuickNotesService,
        {
          provide: getModelToken(QuickNote.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    service = module.get<QuickNotesService>(QuickNotesService);
  });

  describe('create', () => {
    it('creates a note with title and default fields', async () => {
      const res = await service.create('biz-1', 'user-1', {
        title: 'Buy 1.5HP capacitor',
      });
      expect(res.title).toBe('Buy 1.5HP capacitor');
      expect(res.completed).toBe(false);
      expect(res.pinned).toBe(false);
      expect(res.reminderAt).toBeNull();
    });

    it('creates a note with reminder date and pinned status', async () => {
      const reminder = '2026-10-15T10:00:00.000Z';
      const res = await service.create('biz-1', 'user-1', {
        title: 'Call supplier',
        reminderAt: reminder,
        pinned: true,
      });
      expect(res.title).toBe('Call supplier');
      expect(res.reminderAt).toEqual(new Date(reminder));
      expect(res.pinned).toBe(true);
    });
  });

  describe('findAll', () => {
    it('queries with businessId and sorts pinned first and date-wise', async () => {
      const exec = jest.fn().mockResolvedValue([
        { ...mockNote, title: 'No date', reminderAt: null, pinned: false, createdAt: new Date('2026-10-01') },
        { ...mockNote, title: 'With date', reminderAt: new Date('2026-10-10'), pinned: false, createdAt: new Date('2026-10-02') },
        { ...mockNote, title: 'Pinned note', reminderAt: null, pinned: true, createdAt: new Date('2026-10-03') },
      ]);
      mockModel.find.mockReturnValue({ exec });

      const res = await service.findAll('biz-1');
      expect(mockModel.find).toHaveBeenCalledWith({ businessId: 'biz-1' });
      // Pinned first, then note with reminder, then note with no date at the bottom!
      expect(res[0].title).toBe('Pinned note');
      expect(res[1].title).toBe('With date');
      expect(res[2].title).toBe('No date');
    });

    it('filters by status=active or status=completed and applies limit', async () => {
      const exec = jest.fn().mockResolvedValue([mockNote, mockNote, mockNote]);
      mockModel.find.mockReturnValue({ exec });

      const res = await service.findAll('biz-1', { status: 'active', limit: 2 });
      expect(mockModel.find).toHaveBeenCalledWith({
        businessId: 'biz-1',
        completed: false,
      });
      expect(res.length).toBe(2);
    });
  });

  describe('findOne and scoping', () => {
    it('finds a note belonging to the business', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockNote),
      });

      const res = await service.findOne('biz-1', 'note-1');
      expect(mockModel.findOne).toHaveBeenCalledWith({
        _id: 'note-1',
        businessId: 'biz-1',
      });
      expect(res).toBe(mockNote);
    });

    it('throws NotFoundException if note belongs to another business or does not exist', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.findOne('biz-other', 'note-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update, complete/uncomplete, pin/unpin', () => {
    it('updates title, pinned status, and sets completedAt when completed', async () => {
      const noteInstance = { ...mockNote, completed: false, completedAt: null, save: jest.fn() };
      noteInstance.save.mockResolvedValue(noteInstance);
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(noteInstance),
      });

      await service.update('biz-1', 'note-1', {
        title: 'Updated title',
        pinned: true,
        completed: true,
      });

      expect(noteInstance.title).toBe('Updated title');
      expect(noteInstance.pinned).toBe(true);
      expect(noteInstance.completed).toBe(true);
      expect(noteInstance.completedAt).toBeInstanceOf(Date);
    });

    it('clears completedAt when uncompleting a note', async () => {
      const noteInstance = { ...mockNote, completed: true, completedAt: new Date(), save: jest.fn() };
      noteInstance.save.mockResolvedValue(noteInstance);
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(noteInstance),
      });

      await service.update('biz-1', 'note-1', {
        completed: false,
      });

      expect(noteInstance.completed).toBe(false);
      expect(noteInstance.completedAt).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes note matching businessId and id', async () => {
      mockModel.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });

      await expect(service.delete('biz-1', 'note-1')).resolves.toBeUndefined();
      expect(mockModel.deleteOne).toHaveBeenCalledWith({
        _id: 'note-1',
        businessId: 'biz-1',
      });
    });

    it('throws NotFoundException if note not found to delete', async () => {
      mockModel.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      });

      await expect(service.delete('biz-1', 'note-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
