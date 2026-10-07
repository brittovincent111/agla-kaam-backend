import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import type { BusinessRole } from '../decorators/current-business.decorator';
import { CustomersController } from '../../customers/customers.controller';
import { InvoicingController } from '../../invoicing/invoicing.controller';
import { QuotationsController } from '../../quotations/quotations.controller';
import { ProformaInvoicesController } from '../../proforma-invoices/proforma-invoices.controller';
import { BillingItemsController } from '../../billing-items/billing-items.controller';
import { TeamMembersController } from '../../team-members/team-members.controller';
import { BusinessesController } from '../../businesses/businesses.controller';
import { ReportsController } from '../../reports/reports.controller';
import { SubscriptionsController } from '../../subscriptions/subscriptions.controller';
import { AmcController } from '../../amc/amc.controller';
import { PurchasesController } from '../../purchases/purchases.controller';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import { InventoryController } from '../../inventory/inventory.controller';
import { ServicePresetsController } from '../../service-presets/service-presets.controller';
import { DocumentTemplatesController } from '../../document-templates/document-templates.controller';

// Reads the real @Roles metadata off the real controllers, so moving a
// decorator (or dropping one) fails here rather than in production.
type Route = [controller: { prototype: object }, method: string];

const guard = new RolesGuard(new Reflector());
const allowed = (role: BusinessRole, [controller, method]: Route) => {
  const handler = (controller.prototype as Record<string, unknown>)[method];
  if (typeof handler !== 'function') {
    throw new Error(`No ${method} on ${(controller as never as { name: string }).name}`);
  }
  const context = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ business: { businessId: 'b1', role } }),
    }),
  } as never;
  try {
    return guard.canActivate(context);
  } catch (err) {
    if (err instanceof ForbiddenException) return false;
    throw err;
  }
};
const name = ([c, m]: Route) => `${(c as never as { name: string }).name}.${m}`;

// The business owner's list: a manager runs the work and the billing.
const managerCan: Route[] = [
  [CustomersController, 'create'],
  [CustomersController, 'bulkCreate'],
  [CustomersController, 'update'],
  [InvoicingController, 'create'],
  [InvoicingController, 'update'],
  [InvoicingController, 'send'],
  [InvoicingController, 'cancel'],
  [InvoicingController, 'recordPayment'],
  [InvoicingController, 'updatePayment'],
  [InvoicingController, 'downloadPdf'],
  [InvoicingController, 'customerSummary'],
  [QuotationsController, 'create'],
  [QuotationsController, 'convert'],
  [ProformaInvoicesController, 'create'],
  [ProformaInvoicesController, 'convert'],
  [BillingItemsController, 'findRecent'],
  [TeamMembersController, 'findAll'],
  [InventoryController, 'findPage'],
  [InventoryController, 'findOne'],
];

// ...and not the business itself.
const managerCannot: Route[] = [
  [BusinessesController, 'updateProfile'],
  [BusinessesController, 'deleteAccount'],
  [BusinessesController, 'uploadLogo'],
  [ReportsController, 'summary'],
  [InvoicingController, 'outstandingSummary'],
  [TeamMembersController, 'create'],
  [TeamMembersController, 'update'],
  [TeamMembersController, 'deactivate'],
  [TeamMembersController, 'resetPassword'],
  [TeamMembersController, 'seats'],
  [TeamMembersController, 'cashSummary'],
  [TeamMembersController, 'settleCash'],
  [SubscriptionsController, 'createOrder'],
  [SubscriptionsController, 'verifyPlayPurchase'],
  [SubscriptionsController, 'verifyApplePurchase'],
  [AmcController, 'create'],
  [AmcController, 'update'],
  [AmcController, 'summary'],
  [PurchasesController, 'create'],
  [SuppliersController, 'findPage'],
  [InventoryController, 'create'],
  [InventoryController, 'update'],
  [ServicePresetsController, 'create'],
  [DocumentTemplatesController, 'setActive'],
  [CustomersController, 'remove'],
];

describe('RolesGuard — manager', () => {
  it.each(managerCan.map((r) => [name(r), r] as const))(
    'lets a manager use %s',
    (_label, route) => {
      expect(allowed('manager', route)).toBe(true);
      expect(allowed('owner', route)).toBe(true);
    },
  );

  it.each(managerCannot.map((r) => [name(r), r] as const))(
    'keeps %s the owner\'s',
    (_label, route) => {
      expect(allowed('manager', route)).toBe(false);
      expect(allowed('owner', route)).toBe(true);
    },
  );

  it('changes nothing for a technician', () => {
    expect(allowed('technician', [CustomersController, 'create'])).toBe(false);
    expect(allowed('technician', [InvoicingController, 'create'])).toBe(false);
    expect(allowed('technician', [TeamMembersController, 'findAll'])).toBe(false);
    expect(allowed('technician', [InventoryController, 'findPage'])).toBe(true);
  });
});
