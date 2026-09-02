import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentBusiness, AuthenticatedBusiness } from '../common/decorators/current-business.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateAppFeedbackDto } from './dto/create-app-feedback.dto';
import { AppFeedbackService } from './app-feedback.service';

@UseGuards(JwtAuthGuard)
@Controller('app-feedback')
export class AppFeedbackController {
  constructor(private readonly appFeedbackService: AppFeedbackService) {}

  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateAppFeedbackDto,
  ) {
    return this.appFeedbackService.create(business.businessId, dto);
  }
}
