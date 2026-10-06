import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Response } from 'express';
import { ServicesService } from './services.service';
import { ServiceShareService } from './service-share.service';
import { Service, ServiceDocument } from './schemas/service.schema';
import { CustomersService } from '../customers/customers.service';
import {
  Business,
  BusinessDocument,
} from '../businesses/schemas/business.schema';
import { idFilter } from '../common/utils/id-match';
import { formatDate } from '../common/pdf/document-render';
import { esc, renderPublicPage, waDigits } from '../common/public/public-page';
import { PUBLIC_PAGE_CSP } from '../invoicing/public-invoice.controller';

/**
 * The customer's copy of a service record: what was done and when, the
 * warranty, when it is due again, the before/after photos, their earlier
 * visits, and a button to book the next one with THIS business.
 *
 * The WhatsApp service card used to be only plain text — nothing a customer
 * would keep, and nothing that led back to the business when the next visit
 * came due.
 *
 * No auth guard: access is the signed token in the path, naming one job.
 */
@Controller('public/services')
export class PublicServiceController {
  constructor(
    private readonly shareService: ServiceShareService,
    private readonly servicesService: ServicesService,
    private readonly customersService: CustomersService,
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    // Read directly: BusinessesModule depends on this module's graph already.
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  private async load(token: string) {
    const target = this.shareService.verify(token);
    if (!target)
      throw new NotFoundException('This service record link has expired');
    const service = await this.servicesService
      .findOne(target.businessId, target.serviceId)
      .catch(() => null);
    if (!service || service.status === 'cancelled') {
      throw new NotFoundException('This service record link has expired');
    }
    return { target, service };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  async page(@Param('token') token: string, @Res() res: Response) {
    const { target, service } = await this.load(token);
    const [customer, biz, history] = await Promise.all([
      this.customersService
        .findOne(target.businessId, service.customerId.toString())
        .catch(() => null),
      this.businessModel
        .findById(target.businessId)
        .select('name phone googleReviewUrl')
        .lean()
        .exec(),
      this.serviceModel
        .find({
          businessId: idFilter(target.businessId),
          customerId: idFilter(service.customerId.toString()),
          status: 'completed',
          _id: { $ne: service._id },
        })
        .select('serviceType serviceDate completedAt')
        .sort({ serviceDate: -1 })
        .limit(8)
        .lean()
        .exec(),
    ]);
    if (!biz)
      throw new NotFoundException('This service record link has expired');

    const done = service.status === 'completed';
    const now = Date.now();
    const warranty = service.warrantyExpiry
      ? service.warrantyExpiry.getTime() >= now
        ? `<span class="pill ok">Under warranty until ${esc(formatDate(service.warrantyExpiry))}</span>`
        : `<span class="pill bad">Warranty ended ${esc(formatDate(service.warrantyExpiry))}</span>`
      : '';
    const nextDue =
      done && service.nextServiceInterval !== 'none' && service.nextServiceDate
        ? formatDate(service.nextServiceDate)
        : null;
    const firstName = customer?.name?.split(' ')[0] ?? '';

    const wa = waDigits(biz.phone);
    const bookText = encodeURIComponent(
      `Hi ${biz.name}, I'd like to book my next ${service.serviceType}${firstName ? ` — ${customer!.name}` : ''}.`,
    );
    const photo = (
      kind: 'before' | 'after',
      has: boolean | undefined,
      label: string,
    ) =>
      has
        ? `<figure><img src="${esc(token)}/photo/${kind}" alt="${label} photo" loading="lazy"><figcaption>${label}</figcaption></figure>`
        : '';
    const photos =
      photo('before', service.hasBeforePhoto, 'Before') +
      photo('after', service.hasAfterPhoto, 'After');

    const body = `
<div class="biz">${esc(biz.name)}</div>
${biz.phone ? `<div class="bizsub">${esc(biz.phone)}</div>` : ''}
<div class="card">
  <div class="muted">Service record${firstName ? ` for ${esc(customer!.name)}` : ''}</div>
  <h1>${esc(service.serviceType)}</h1>
  <span class="pill ${done ? 'ok' : 'warn'}">${done ? 'Completed' : 'Scheduled'}</span> ${warranty}
  <div style="margin-top:12px">
    <div class="row"><span>${done ? 'Done on' : 'Booked for'}</span><span>${esc(formatDate(done && service.completedAt ? service.completedAt : service.serviceDate))}</span></div>
    ${nextDue ? `<div class="row"><span>Next service due</span><span><b>${esc(nextDue)}</b></span></div>` : ''}
    ${service.underWarranty && service.callbackOf ? '<div class="row"><span>Visit type</span><span>Warranty callback (free)</span></div>' : ''}
  </div>
  ${photos ? `<div class="photos">${photos}</div>` : ''}
</div>
${
  history.length
    ? `<div class="card"><div class="muted">Earlier visits</div><ul class="hist">${history
        .map(
          (h) =>
            `<li><span>${esc(h.serviceType)}</span><span class="muted">${esc(formatDate((h.completedAt as Date) ?? (h.serviceDate as Date)))}</span></li>`,
        )
        .join('')}</ul></div>`
    : ''
}
${wa ? `<a class="btn primary" href="https://wa.me/${wa}?text=${bookText}">Book my next service</a>` : ''}
${biz.phone ? `<a class="btn ghost" href="tel:${esc(biz.phone.replace(/[^\d+]/g, ''))}">Call ${esc(biz.name)}</a>` : ''}
${done && biz.googleReviewUrl ? `<a class="btn ghost" href="${esc(biz.googleReviewUrl)}">⭐ Rate us on Google</a>` : ''}
`;

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': PUBLIC_PAGE_CSP,
      'Referrer-Policy': 'no-referrer',
    });
    res.send(
      renderPublicPage({
        title: `${service.serviceType} record`,
        businessName: biz.name,
        body,
      }),
    );
  }

  // The job's photos, for the page above. Same token, nothing else served.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token/photo/:kind')
  async photo(
    @Param('token') token: string,
    @Param('kind') kind: string,
    @Res() res: Response,
  ) {
    if (kind !== 'before' && kind !== 'after') throw new NotFoundException();
    const { target } = await this.load(token);
    const img = await this.servicesService.getPhoto(
      target.businessId,
      target.serviceId,
      kind,
    );
    if (!img) throw new NotFoundException();
    res.set({
      'Content-Type': img.contentType,
      'Cache-Control': 'private, max-age=86400',
    });
    res.send(img.data);
  }
}
