import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type BusinessRole = 'owner' | 'technician';

export interface AuthenticatedBusiness {
  businessId: string;
  phone: string;
  role: BusinessRole;
  // Only set when role === 'technician' — the TeamMember row's own id,
  // distinct from businessId (which is the owner's business).
  teamMemberId?: string;
}

export const CurrentBusiness = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedBusiness => {
    const request = ctx.switchToHttp().getRequest();
    return request.business;
  },
);
