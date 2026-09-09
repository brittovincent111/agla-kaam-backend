import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type BusinessRole = 'owner' | 'technician';

export interface AuthenticatedBusiness {
  businessId: string;
  phone?: string;
  email?: string;
  role: BusinessRole;
  // Only set when role === 'technician' — the TeamMember row's own id,
  // distinct from businessId (which is the owner's business).
  teamMemberId?: string;
}

export const CurrentBusiness = createParamDecorator(
  (data: keyof AuthenticatedBusiness | undefined, ctx: ExecutionContext): any => {
    const request = ctx.switchToHttp().getRequest();
    const business = request.business;
    return data && business ? business[data] : business;
  },
);
