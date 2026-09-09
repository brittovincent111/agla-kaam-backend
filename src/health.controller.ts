import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { isFetchPolyfilled } from './common/http/fetch-polyfill';

// Captured when this module is first loaded, i.e. at process start — so it
// reports when the RUNNING code was started, not when the request arrived.
const STARTED_AT = new Date().toISOString();

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  check() {
    // readyState 1 = connected. Anything else means the app is up but can't
    // actually serve requests — a load balancer should not route here.
    if (this.connection.readyState !== 1) {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unavailable',
      });
    }
    // Runtime facts are returned here so "did my deploy actually take?" can
    // be answered with one curl, without shell access or log hunting. A
    // stale `startedAt` is the giveaway that an old process is still serving.
    return {
      status: 'ok',
      database: 'connected',
      node: process.version,
      fetch: isFetchPolyfilled() ? 'polyfill' : 'native',
      startedAt: STARTED_AT,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
