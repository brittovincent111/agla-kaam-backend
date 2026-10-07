import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Request, Response } from 'express';
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
import { publicApiBase, publicWebBase } from '../common/public/public-urls';
import { S3Service } from '../common/s3/s3.service';

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
    private readonly s3Service: S3Service,
    private readonly configService: ConfigService,
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

  // Everything the record shows: the job, the customer, the business and
  // their earlier visits. Shared by the HTML page and the website's JSON.
  private async loadRecord(token: string) {
    const { target, service } = await this.load(token);
    const [customer, biz, history] = await Promise.all([
      this.customersService
        .findOne(target.businessId, service.customerId.toString())
        .catch(() => null),
      this.businessModel
        .findById(target.businessId)
        .select('name phone googleReviewUrl hasLogo')
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
    return { target, service, customer, biz, history };
  }

  // The WhatsApp text behind "Book my next service", not yet URL-encoded.
  private bookMessage(
    bizName: string,
    serviceType: string,
    customerName?: string | null,
  ): string {
    const firstName = customerName?.split(' ')[0] ?? '';
    return `Hi ${bizName}, I'd like to book my next ${serviceType}${firstName ? ` — ${customerName}` : ''}.`;
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  async page(@Param('token') token: string, @Res() res: Response) {
    // With the website pages in use, old long links open there too.
    const web = publicWebBase(this.configService);
    if (web) {
      return res.redirect(
        302,
        `${web}/service-record/${encodeURIComponent(token)}`,
      );
    }
    const { service, customer, biz, history } = await this.loadRecord(token);

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
      this.bookMessage(biz.name, service.serviceType, customer?.name),
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

  /**
   * The same record as JSON, for the website's /service-record/:token page.
   * Field names are a contract with the website — do not rename.
   */
  // Called by the website's server for every customer who opens a link, so
  // all of them share one address here. The token or 8-letter code can't be
  // guessed, so a high limit costs nothing in safety.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Get(':token/data')
  @Header('Cache-Control', 'private, no-store')
  async data(@Param('token') token: string, @Req() req: Request) {
    const { service, customer, biz, history } = await this.loadRecord(token);
    const api = `${publicApiBase(this.configService, req)}/api/public/services/${encodeURIComponent(token)}`;
    const done = service.status === 'completed';
    const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);
    return {
      business: {
        name: biz.name,
        phone: biz.phone || null,
        whatsapp: waDigits(biz.phone) || null,
        googleReviewUrl: biz.googleReviewUrl || null,
        logoUrl: biz.hasLogo ? `${api}/logo` : null,
      },
      customerName: customer?.name || null,
      service: {
        serviceType: service.serviceType,
        status: done ? 'completed' : 'scheduled',
        date: iso(
          done && service.completedAt
            ? service.completedAt
            : service.serviceDate,
        ),
        nextServiceDate:
          done && service.nextServiceInterval !== 'none'
            ? iso(service.nextServiceDate)
            : null,
        warrantyExpiry: iso(service.warrantyExpiry),
        underWarranty:
          !!service.warrantyExpiry &&
          service.warrantyExpiry.getTime() >= Date.now(),
        isWarrantyCallback: !!(service.underWarranty && service.callbackOf),
        beforePhotoUrl: service.hasBeforePhoto ? `${api}/photo/before` : null,
        afterPhotoUrl: service.hasAfterPhoto ? `${api}/photo/after` : null,
      },
      history: history.map((h) => ({
        serviceType: h.serviceType,
        date: iso((h.completedAt as Date) ?? (h.serviceDate as Date)),
      })),
      bookMessage: this.bookMessage(
        biz.name,
        service.serviceType,
        customer?.name,
      ),
    };
  }

  // The business's logo, for the website's page. Same token, nothing else.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token/logo')
  async logo(@Param('token') token: string, @Res() res: Response) {
    const { target } = await this.load(token);
    const biz = await this.businessModel
      .findById(target.businessId)
      .select('+logoKey +logoContentType')
      .lean()
      .exec();
    const data = biz?.logoKey
      ? await this.s3Service.download(biz.logoKey)
      : null;
    if (!biz || !data) throw new NotFoundException();
    res.set({
      'Content-Type': biz.logoContentType ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
      // helmet defaults this to same-origin; the website shows these images.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(data);
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
      // helmet defaults this to same-origin; the website shows these images.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(img.data);
  }
}
