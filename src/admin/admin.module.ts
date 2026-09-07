import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { Business, BusinessSchema } from '../businesses/schemas/business.schema';
import { Subscription, SubscriptionSchema } from '../subscriptions/schemas/subscription.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Invoice, InvoiceSchema } from '../invoicing/schemas/invoice.schema';
import { AppFeedback, AppFeedbackSchema } from '../app-feedback/schemas/app-feedback.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: AppFeedback.name, schema: AppFeedbackSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>(
            'JWT_EXPIRES_IN',
            '30d',
          ) as `${number}d`,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthGuard],
  exports: [AdminService],
})
export class AdminModule {}
