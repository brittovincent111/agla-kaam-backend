import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateAppFeedbackDto } from './dto/create-app-feedback.dto';
import { AppFeedback, AppFeedbackDocument } from './schemas/app-feedback.schema';

@Injectable()
export class AppFeedbackService {
  constructor(
    @InjectModel(AppFeedback.name)
    private readonly feedbackModel: Model<AppFeedbackDocument>,
  ) {}

  create(businessId: string, dto: CreateAppFeedbackDto) {
    return this.feedbackModel.create({
      businessId,
      rating: dto.rating,
      comment: dto.comment?.trim() || undefined,
    });
  }
}
