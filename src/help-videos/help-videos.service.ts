import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { HelpVideo, HelpVideoDocument } from './help-video.schema';
import {
  INVALID_YOUTUBE_LINK,
  audiencesFor,
  isShortsLink,
  languagesFor,
  parseYoutubeId,
  sortForViewer,
  type HelpVideoLanguage,
  type HelpVideoScreen,
} from './help-video-options';
import { CreateHelpVideoDto } from './dto/create-help-video.dto';
import { UpdateHelpVideoDto } from './dto/update-help-video.dto';

export interface HelpVideoView {
  id: string;
  title: string;
  youtubeId: string;
  screen: HelpVideoScreen;
  language: HelpVideoLanguage;
  isShort: boolean;
}

@Injectable()
export class HelpVideosService {
  constructor(
    @InjectModel(HelpVideo.name)
    private readonly helpVideoModel: Model<HelpVideoDocument>,
  ) {}

  // ---- App -------------------------------------------------------------

  async forViewer(
    role: string | undefined,
    screen: HelpVideoScreen = 'home',
    lang: HelpVideoLanguage = 'en',
  ): Promise<HelpVideoView[]> {
    const filter: Record<string, unknown> = {
      active: true,
      language: { $in: languagesFor(lang) },
      audience: { $in: audiencesFor(role) },
    };
    // Home lists every screen's videos.
    if (screen !== 'home') filter.screen = screen;

    const rows = await this.helpVideoModel
      .find(filter)
      .select('title youtubeId screen language order isShort')
      .sort({ order: 1, _id: 1 })
      .lean();

    return sortForViewer(rows, lang).map((v) => ({
      id: String(v._id),
      title: v.title,
      youtubeId: v.youtubeId,
      screen: v.screen,
      language: v.language,
      isShort: v.isShort === true,
    }));
  }

  // ---- Admin -----------------------------------------------------------

  listAll() {
    return this.helpVideoModel
      .find()
      .sort({ screen: 1, order: 1, _id: 1 })
      .lean();
  }

  async create(dto: CreateHelpVideoDto) {
    const youtubeId = resolveYoutubeId(dto.url ?? dto.youtubeId);
    const order = await this.nextOrder(dto.screen);
    const created = await this.helpVideoModel.create({
      title: dto.title.trim(),
      youtubeId,
      screen: dto.screen,
      language: dto.language ?? 'en',
      audience: dto.audience ?? 'all',
      active: dto.active ?? true,
      isShort: dto.isShort ?? isShortsLink(dto.url),
      order,
    });
    return created.toObject();
  }

  async update(id: string, dto: UpdateHelpVideoDto) {
    const existing = await this.findOr404(id);
    const set: Record<string, unknown> = {};

    if (dto.url !== undefined || dto.youtubeId !== undefined) {
      set.youtubeId = resolveYoutubeId(dto.url ?? dto.youtubeId);
      set.isShort = isShortsLink(dto.url);
    }
    if (dto.isShort !== undefined) set.isShort = dto.isShort;
    if (dto.title !== undefined) set.title = dto.title.trim();
    if (dto.language !== undefined) set.language = dto.language;
    if (dto.audience !== undefined) set.audience = dto.audience;
    if (dto.active !== undefined) set.active = dto.active;
    if (dto.screen !== undefined && dto.screen !== existing.screen) {
      // Moved to another screen: goes to the end of that screen's list.
      set.screen = dto.screen;
      set.order = await this.nextOrder(dto.screen);
    }

    const updated = await this.helpVideoModel
      .findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
      .lean();
    if (!updated) throw notFound();
    return updated;
  }

  async remove(id: string) {
    if (!isValidObjectId(id)) throw notFound();
    const res = await this.helpVideoModel.deleteOne({ _id: id });
    if (!res.deletedCount) throw notFound();
    return { deleted: true };
  }

  /**
   * order = position in `ids`. The admin page sends one screen's list at a
   * time; ids are not checked to share a screen — the indexes are applied as
   * given. Returns the full list, as GET does.
   */
  async reorder(ids: string[]) {
    if (ids.length) {
      await this.helpVideoModel.bulkWrite(
        ids.map((id, index) => ({
          updateOne: {
            filter: { _id: id },
            update: { $set: { order: index } },
          },
        })),
      );
    }
    return this.listAll();
  }

  private async nextOrder(screen: HelpVideoScreen): Promise<number> {
    const last = await this.helpVideoModel
      .findOne({ screen })
      .sort({ order: -1 })
      .select('order')
      .lean();
    return last ? (last.order ?? 0) + 1 : 0;
  }

  private async findOr404(id: string) {
    if (!isValidObjectId(id)) throw notFound();
    const doc = await this.helpVideoModel.findById(id).select('screen').lean();
    if (!doc) throw notFound();
    return doc;
  }
}

function resolveYoutubeId(input: string | undefined): string {
  const id = parseYoutubeId(input);
  if (!id) throw new BadRequestException(INVALID_YOUTUBE_LINK);
  return id;
}

function notFound() {
  return new NotFoundException('Help video not found');
}
