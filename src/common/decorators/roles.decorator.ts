import { SetMetadata } from '@nestjs/common';
import type { BusinessRole } from './current-business.decorator';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: BusinessRole[]) => SetMetadata(ROLES_KEY, roles);
