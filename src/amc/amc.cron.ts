import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AmcService } from './amc.service';

const IST = { timeZone: 'Asia/Kolkata' };

/**
 * Just after midnight India time, contracts that ended yesterday or earlier
 * and have no visit left pending are marked expired. A contract still owing
 * a visit stays active until that visit is logged or skipped — logging the
 * last one expires it on the spot, so this only catches the rest.
 */
@Injectable()
export class AmcCron {
  private readonly logger = new Logger(AmcCron.name);

  constructor(private readonly amcService: AmcService) {}

  @Cron('15 0 * * *', IST)
  async expireEnded() {
    try {
      const expired = await this.amcService.expireEndedContracts();
      if (expired > 0) this.logger.log(`Expired ${expired} ended AMC contract(s)`);
    } catch (err: any) {
      this.logger.error(`AMC expiry failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Every half hour: raise the job for each AMC visit that has come due, for
   * every business with a contract still owing one. Reads still sync on
   * demand, but at most once a minute per business — this keeps a business
   * nobody has opened lately from falling behind in the meantime.
   * One business at a time, so a large run does not crowd out live requests.
   */
  @Cron('*/30 * * * *', IST)
  async syncVisits() {
    let businessIds: string[];
    try {
      businessIds = await this.amcService.businessesWithPendingVisits();
    } catch (err: any) {
      this.logger.error(`AMC visit sync failed: ${err.message}`, err.stack);
      return;
    }
    for (const businessId of businessIds) {
      try {
        await this.amcService.syncAmcServices(businessId);
      } catch (err: any) {
        this.logger.error(
          `AMC visit sync failed for ${businessId}: ${err.message}`,
          err.stack,
        );
      }
    }
  }
}
