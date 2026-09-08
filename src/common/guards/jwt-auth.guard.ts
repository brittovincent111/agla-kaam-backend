import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Optional()
    @Inject(SubscriptionsService)
    private readonly subscriptionsService?: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      request.business = {
        businessId: payload.sub,
        phone: payload.phone,
        email: payload.email,
        role: payload.role ?? 'owner',
        teamMemberId: payload.teamMemberId,
      };

      if (payload.role === 'technician' && this.subscriptionsService) {
        const hasTeam = await this.subscriptionsService.hasActiveTeamAddon(
          payload.sub,
        );
        if (!hasTeam) {
          throw new ForbiddenException(
            "The owner's subscription is expired or does not include active team access.",
          );
        }
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

