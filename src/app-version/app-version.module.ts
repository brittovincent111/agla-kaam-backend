import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppVersionController } from './app-version.controller';
import { AppVersionService } from './app-version.service';
import { AppVersionPolicy, AppVersionPolicySchema } from './app-version.schema';

// Global so the minimum-version guard, which runs on every request, can
// inject the service without each feature module importing this one.
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppVersionPolicy.name, schema: AppVersionPolicySchema },
    ]),
  ],
  controllers: [AppVersionController],
  providers: [AppVersionService],
  exports: [AppVersionService],
})
export class AppVersionModule {}
