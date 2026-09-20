import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AppVersionPolicy,
  AppVersionPolicyDocument,
} from './app-version.schema';
import { UpdateAppVersionDto } from './dto/update-app-version.dto';
import { compareVersions, isOlderThan } from '../common/utils/semver';

export type Platform = 'ios' | 'android';

export interface ResolvedPolicy {
  platform: Platform;
  minimumVersion: string;
  latestVersion: string;
  message?: string;
}

/**
 * A policy that blocks nobody. Returned when no row exists yet, so deploying
 * this feature cannot lock anyone out of an app that is already shipped.
 */
const PERMISSIVE = (platform: Platform): ResolvedPolicy => ({
  platform,
  minimumVersion: '0.0.0',
  latestVersion: '0.0.0',
});

@Injectable()
export class AppVersionService {
  constructor(
    @InjectModel(AppVersionPolicy.name)
    private readonly model: Model<AppVersionPolicyDocument>,
  ) {}

  async forPlatform(platform: Platform): Promise<ResolvedPolicy> {
    const row = await this.model.findOne({ platform }).lean().exec();
    if (!row) return PERMISSIVE(platform);
    return {
      platform,
      minimumVersion: row.minimumVersion,
      latestVersion: row.latestVersion,
      ...(row.message ? { message: row.message } : {}),
    };
  }

  async all(): Promise<ResolvedPolicy[]> {
    const platforms: Platform[] = ['ios', 'android'];
    return Promise.all(platforms.map((p) => this.forPlatform(p)));
  }

  /** True when this build is below the floor and must be stopped. */
  async isBlocked(platform: Platform, version: string): Promise<boolean> {
    const policy = await this.forPlatform(platform);
    return isOlderThan(version, policy.minimumVersion);
  }

  async upsert(dto: UpdateAppVersionDto): Promise<ResolvedPolicy> {
    // The one edit that locks out an entire platform at once — including
    // store reviewers, who always run the newest build. Rejected here as
    // well as warned about in the admin UI, because the UI is not the only
    // way to reach this endpoint.
    if (compareVersions(dto.minimumVersion, dto.latestVersion) > 0) {
      throw new BadRequestException(
        'minimumVersion cannot be higher than latestVersion — that would block every user on this platform, including App Store reviewers.',
      );
    }

    await this.model
      .updateOne(
        { platform: dto.platform },
        {
          $set: {
            minimumVersion: dto.minimumVersion.trim(),
            latestVersion: dto.latestVersion.trim(),
            message: dto.message?.trim() || undefined,
          },
        },
        { upsert: true },
      )
      .exec();

    return this.forPlatform(dto.platform);
  }
}
