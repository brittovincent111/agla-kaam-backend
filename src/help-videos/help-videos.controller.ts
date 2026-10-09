import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { HelpVideosService } from './help-videos.service';
import { ListHelpVideosDto } from './dto/list-help-videos.dto';

/** Any signed-in role; what each sees is narrowed by audience. */
@UseGuards(JwtAuthGuard)
@Controller('help-videos')
export class HelpVideosController {
  constructor(private readonly helpVideos: HelpVideosService) {}

  @Get()
  list(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ListHelpVideosDto,
  ) {
    return this.helpVideos.forViewer(business.role, query.screen, query.lang);
  }
}
