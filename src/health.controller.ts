import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

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
    return { status: 'ok', database: 'connected' };
  }
}
