import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 'manager' is a team member who runs the work and the billing like the owner
// (every customer and job, assigning, invoices) but not the business itself:
// no reports or money totals, settings, subscription, team management,
// purchases or AMC contracts. Routes opt managers in with @Roles(...).
export type BusinessRole = 'owner' | 'technician' | 'manager';

export interface AuthenticatedBusiness {
  businessId: string;
  phone?: string;
  email?: string;
  role: BusinessRole;
  // Only set for a team member (technician or manager) — the TeamMember
  // row's own id, distinct from businessId (which is the owner's business).
  teamMemberId?: string;
  // The owner's sign-in this request belongs to (absent on older logins).
  sid?: string;
}

type Viewer = { role?: string; teamMemberId?: string } | undefined | null;

/**
 * The one role whose data is narrowed to their own work: a technician sees
 * only the customers and jobs assigned to them and cannot assign anyone. An
 * owner and a manager both see the whole business — so every visibility
 * rule asks this, never `role !== 'owner'`.
 */
export function isTechnician(viewer: Viewer): boolean {
  return viewer?.role === 'technician';
}

/**
 * Signed in as a TeamMember row (technician or manager) rather than as the
 * owner: their own push token, password, cash in hand and "completed by" go
 * on that row, never on the owner's Business.
 */
export function isTeamMember(viewer: Viewer): boolean {
  return viewer?.role === 'technician' || viewer?.role === 'manager';
}

export const CurrentBusiness = createParamDecorator(
  (
    data: keyof AuthenticatedBusiness | undefined,
    ctx: ExecutionContext,
  ): any => {
    const request = ctx.switchToHttp().getRequest();
    const business = request.business;
    return data && business ? business[data] : business;
  },
);
