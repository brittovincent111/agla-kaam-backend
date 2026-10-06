import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamMember, TeamMemberSchema } from './schemas/team-member.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { TeamMembersService } from './team-members.service';
import { TeamMembersController } from './team-members.controller';
import { BusinessesModule } from '../businesses/businesses.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

// Global so JwtAuthGuard can verify a technician is still active on every
// request, wherever the guard is constructed, without each feature module
// having to remember to import this one.
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    BusinessesModule,
    SubscriptionsModule,
  ],
  controllers: [TeamMembersController],
  providers: [TeamMembersService],
  exports: [TeamMembersService],
})
export class TeamMembersModule {}
