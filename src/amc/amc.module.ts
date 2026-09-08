import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Amc, AmcSchema } from './schemas/amc.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { AmcService } from './amc.service';
import { AmcController } from './amc.controller';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Amc.name, schema: AmcSchema },
      { name: Service.name, schema: ServiceSchema },
    ]),
    forwardRef(() => CustomersModule),
    SubscriptionsModule,
  ],
  controllers: [AmcController],
  providers: [AmcService],
  exports: [AmcService],
})
export class AmcModule {}
