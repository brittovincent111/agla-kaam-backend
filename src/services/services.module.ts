import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Service, ServiceSchema } from './schemas/service.schema';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { CustomersModule } from '../customers/customers.module';
import { TeamMembersModule } from '../team-members/team-members.module';
import { AmcModule } from '../amc/amc.module';
import { S3Service } from '../common/s3/s3.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Service.name, schema: ServiceSchema }]),
    // See customers.module.ts for why this needs forwardRef — CustomersModule
    // now imports this module back, to ask ServicesService which customers
    // have a service reassigned to a given technician.
    forwardRef(() => CustomersModule),
    TeamMembersModule,
    forwardRef(() => AmcModule),
  ],
  controllers: [ServicesController],
  providers: [ServicesService, S3Service],
  exports: [ServicesService],
})
export class ServicesModule {}

