import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Amc, AmcSchema } from './schemas/amc.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { AmcService } from './amc.service';
import { AmcController } from './amc.controller';
import { AmcCron } from './amc.cron';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TeamMembersModule } from '../team-members/team-members.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Amc.name, schema: AmcSchema },
      { name: Service.name, schema: ServiceSchema },
    ]),
    forwardRef(() => CustomersModule),
    SubscriptionsModule,
    TeamMembersModule,
  ],
  controllers: [AmcController],
  providers: [AmcService, AmcCron],
  exports: [AmcService],
})
export class AmcModule {}
