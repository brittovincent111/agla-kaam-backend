import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument } from './schemas/lead.schema';
import { LeadActivity, LeadActivityDocument } from './schemas/lead-activity.schema';
import { Business, BusinessDocument } from '../businesses/schemas/business.schema';
import { isPhoneOnlyEmail, loginPhoneDigits } from '../common/utils/login-phone';

/**
 * Marks leads that have already signed up for Agla Kaam as Installed, by
 * matching their phone or email against business accounts. Campaigns leave
 * Installed leads out, so nobody is asked to try an app they already use.
 */
@Injectable()
export class LeadInstallSyncService {
  private readonly logger = new Logger(LeadInstallSyncService.name);
  private running: Promise<{ matched: number }> | null = null;

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(LeadActivity.name) private readonly activityModel: Model<LeadActivityDocument>,
    @InjectModel(Business.name) private readonly businessModel: Model<BusinessDocument>,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduled(): Promise<void> {
    await this.sync().catch((err) => this.logger.error(`Install sync failed: ${err.message}`));
  }

  /** One run at a time; a second caller waits for the same run. */
  sync(): Promise<{ matched: number }> {
    if (!this.running) this.running = this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<{ matched: number }> {
    const businesses = await this.businessModel
      .find({ $or: [{ phone: { $exists: true, $ne: '' } }, { email: { $exists: true, $ne: '' } }] })
      .select('_id phone email name')
      .lean()
      .exec();

    const byPhone = new Map<string, { id: Types.ObjectId; name: string }>();
    const byEmail = new Map<string, { id: Types.ObjectId; name: string }>();
    for (const b of businesses) {
      const ref = { id: b._id as Types.ObjectId, name: b.name };
      const digits = loginPhoneDigits(b.phone);
      if (digits) byPhone.set(digits, ref);
      const email = b.email?.trim().toLowerCase();
      if (email && !isPhoneOnlyEmail(email)) byEmail.set(email, ref);
    }
    if (!byPhone.size && !byEmail.size) return { matched: 0 };

    const phones = [...byPhone.keys()].map((d) => `+${d}`);
    const emails = [...byEmail.keys()];
    const leads = await this.leadModel
      .find({
        status: { $ne: 'INSTALLED' },
        $or: [{ phoneNormalized: { $in: phones } }, { email: { $in: emails.map((e) => new RegExp(`^${escapeRx(e)}$`, 'i')) } }],
      })
      .select('_id phoneNormalized email status')
      .exec();

    let matched = 0;
    for (const lead of leads) {
      const viaPhone = lead.phoneNormalized ? byPhone.get(lead.phoneNormalized.replace(/\D/g, '')) : undefined;
      const viaEmail = lead.email ? byEmail.get(lead.email.trim().toLowerCase()) : undefined;
      const hit = viaPhone ?? viaEmail;
      if (!hit) continue;
      const res = await this.leadModel.updateOne(
        { _id: lead._id, status: { $ne: 'INSTALLED' } },
        { $set: { status: 'INSTALLED', installedAt: new Date(), installedBusinessId: hit.id } },
      );
      if (!res.modifiedCount) continue;
      matched++;
      await this.activityModel.create({
        leadId: lead._id,
        type: 'INSTALL',
        message: `Signed up for Agla Kaam as “${hit.name}” (matched by ${viaPhone ? 'phone' : 'email'})`,
        performedBy: 'System',
      });
    }
    if (matched) this.logger.log(`Marked ${matched} lead(s) Installed from existing accounts.`);
    return { matched };
  }
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
