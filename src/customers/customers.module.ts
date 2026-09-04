import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TeamMembersModule } from '../team-members/team-members.module';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
    ]),
    SubscriptionsModule,
    TeamMembersModule,
    // ServicesModule already imports CustomersModule (a service needs to
    // confirm its customer belongs to this business/technician). This edge
    // is the reverse direction — CustomersService needs to ask ServicesService
    // which customers have a service directly reassigned to a technician, so
    // a reassigned job is actually reachable, not just visible in a list.
    // forwardRef breaks the resulting cycle on both sides of this one edge.
    forwardRef(() => ServicesModule),
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
