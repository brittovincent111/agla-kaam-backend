import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';

// Nest's HttpStatus enum has no 426 entry.
const UPGRADE_REQUIRED = 426;
import type { Request } from 'express';
import { AppVersionService, Platform } from '../../app-version/app-version.service';

/**
 * Refuses requests from app builds below the configured floor.
 *
 * The app shows its own update screen, but that check lives in the app and
 * can only ever be as trustworthy as the build running it. This is the layer
 * that actually holds: an unsupported build gets 426 no matter what its own
 * copy of the rules says.
 */
@Injectable()
export class MinVersionGuard implements CanActivate {
  constructor(private readonly appVersion: AppVersionService) {}

  /**
   * Paths that must answer even to a blocked build. Without the first two the
   * app could not discover why it was refused, and the admin panel — which
   * sends no app version at all — must never be gated by a mobile policy.
   */
  private static readonly EXEMPT = [
    '/app-version',
    '/geo/countries',
    '/health',
    '/admin',
  ];

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();

    // req.path carries the global '/api' prefix, so the exempt list has to be
    // matched against the path with it removed. Getting this wrong made the
    // policy endpoint itself return 426, leaving a blocked app unable to
    // discover why it was blocked.
    const path = (req.path || req.url || '').replace(/^\/api(?=\/|$)/, '');
    if (MinVersionGuard.EXEMPT.some((p) => path.startsWith(p))) return true;

    // Absent header means "not the mobile app": the website, the admin panel,
    // a webhook, curl. Only clients that identify themselves are judged.
    const version = header(req, 'x-app-version');
    if (!version) return true;

    const platform: Platform =
      header(req, 'x-app-platform') === 'android' ? 'android' : 'ios';

    if (await this.appVersion.isBlocked(platform, version)) {
      throw new HttpException(
        {
          statusCode: UPGRADE_REQUIRED,
          error: 'Upgrade Required',
          message: 'This version of the app is no longer supported. Please update.',
        },
        UPGRADE_REQUIRED,
      );
    }
    return true;
  }
}

function header(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}
