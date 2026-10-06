import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AutopilotService } from './autopilot.service';

const IST = { timeZone: 'Asia/Kolkata' };

/**
 * The autopilot's day, India time. Each step does nothing while the master
 * switch is off, and each is safe to run twice.
 *
 *   06:00  lead search, inside the free Google quota
 *   06:40  emails from websites, and who already uses the app
 *   07:30  today's plan (waits for approval, or launches)
 *   17:00  an unapproved plan is dropped
 *   20:00  report
 */
@Injectable()
export class AutopilotCron {
  private readonly logger = new Logger(AutopilotCron.name);

  constructor(private readonly autopilot: AutopilotService) {}

  private async whenOn(step: string, fn: () => Promise<unknown>) {
    const s = await this.autopilot.settings();
    if (!s.enabled) return;
    try {
      await fn();
    } catch (err: any) {
      this.logger.error(`Autopilot ${step} failed: ${err.message}`, err.stack);
    }
  }

  @Cron('0 6 * * *', IST)
  searches() {
    return this.whenOn('searches', () => this.autopilot.runSearches());
  }

  @Cron('40 6 * * *', IST)
  prepare() {
    return this.whenOn('lead prep', () => this.autopilot.prepareLeads());
  }

  @Cron('30 7 * * *', IST)
  plan() {
    return this.whenOn('plan', () => this.autopilot.buildPlan());
  }

  @Cron('0 17 * * *', IST)
  expire() {
    return this.whenOn('expiry', () => this.autopilot.expire());
  }

  @Cron('0 20 * * *', IST)
  report() {
    return this.whenOn('report', () => this.autopilot.sendEveningReport());
  }
}
