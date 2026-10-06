import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  NEXT_SERVICE_INTERVALS,
  WARRANTY_PERIODS,
} from '../../common/constants/service-options';

export type ServiceDocument = HydratedDocument<Service>;

@Schema({ _id: false })
export class ServiceLocation {
  @Prop({ required: true })
  latitude: number;

  @Prop({ required: true })
  longitude: number;

  @Prop({ required: true })
  capturedAt: Date;
}

export const ServiceLocationSchema =
  SchemaFactory.createForClass(ServiceLocation);

@Schema({ timestamps: true })
export class Service {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  serviceType: string;

  @Prop({
    required: true,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'completed' | 'cancelled';

  @Prop({ required: true })
  serviceDate: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  revisitDate?: Date;

  // The date the job was first booked for, kept on its first revisit — so
  // the card can say "2nd visit · first booked 1 Oct" instead of the move
  // being invisible.
  @Prop()
  originalServiceDate?: Date;

  // How many times the job has been put back to another day.
  @Prop({ default: 0 })
  revisitCount: number;

  // A callback: a return visit for a job already done (the customer rang
  // back — "it's leaking again"). Points at the original job, which keeps
  // its own warranty and next-service reminder untouched. underWarranty is
  // fixed when the callback is booked: whether the original's warranty
  // still covered that day, which is what decides if it is billed.
  @Prop({ type: Types.ObjectId, ref: 'Service', index: true })
  callbackOf?: Types.ObjectId;

  @Prop()
  underWarranty?: boolean;

  // Set on a completed job: the next visit booked when it was completed
  // ("Book next visit" in the completion sheet), so the card can show it and
  // link to it. Absent when the next visit was skipped.
  @Prop({ type: Types.ObjectId, ref: 'Service' })
  nextVisitId?: Types.ObjectId;

  // When the service record was last sent to the customer on WhatsApp — for
  // the "Next steps" checklist on a completed job.
  @Prop()
  recordSharedAt?: Date;

  // Money taken at the door when the job was completed: cash, UPI to the
  // shop, or "not paid". Cash a technician collected is theirs to hand over
  // until the owner settles it (cashSettledAt) — the Team screen's "cash in
  // hand". The amount is also put on the job's invoice exactly once
  // (collectionAppliedAt / collectionPaymentId), whether the invoice exists
  // at completion or is sent later.
  // false: a DUE visit — the date the customer should be reminded, not an
  // appointment they agreed to (next visits booked on completion, AMC
  // schedule visits). It goes to no technician's Today list or morning push
  // until the owner books it (date, time, technician). Only true is booked:
  // a job from before this field (absent) counts as not booked until
  // someone books it — scripts/mark-reminder-visits sets it on old jobs.
  @Prop()
  booked?: boolean;

  // Part of the day agreed with the customer: 'morning' | 'afternoon' |
  // 'evening', or an exact 'HH:mm'. Optional.
  @Prop({ trim: true })
  visitSlot?: string;

  // The technician who did the last visit — offered first when a due visit
  // is booked, without putting it on their list before then.
  @Prop({ type: String })
  suggestedTechnicianId?: string;

  // Who tapped "Complete job": a team member's id, or 'owner'. Recorded
  // from the work log's introduction; older jobs have none and count for
  // the technician they were assigned to.
  @Prop({ type: String, index: true })
  completedById?: string;

  @Prop({ enum: ['cash', 'upi', 'unpaid'] })
  collectionMethod?: 'cash' | 'upi' | 'unpaid';

  @Prop()
  collectionAmount?: number;

  // Mixed like assignedTechnicianId: always written as a string here.
  @Prop({ type: String, index: true })
  collectedById?: string;

  @Prop()
  collectedAt?: Date;

  @Prop()
  cashSettledAt?: Date;

  @Prop()
  collectionAppliedAt?: Date;

  @Prop()
  collectionPaymentId?: string;

  @Prop({ required: true, enum: WARRANTY_PERIODS, default: 'none' })
  warrantyPeriod: string;

  @Prop()
  warrantyExpiry?: Date | null;

  @Prop({ required: true, enum: NEXT_SERVICE_INTERVALS, default: '6m' })
  nextServiceInterval: string;

  @Prop({ required: true, index: true })
  nextServiceDate: Date;

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;

  // Captured optionally by whoever marks the service done — most useful
  // coming from a technician's phone out in the field.
  @Prop({ type: ServiceLocationSchema })
  location?: ServiceLocation;

  // Absent means "use the customer's default assigned technician." Set two
  // ways: the owner picks someone ahead of time to override the default for
  // just this one visit (e.g. the usual technician is unavailable), or a
  // technician logging their own visit is stamped here automatically as the
  // attribution record of who actually did it.
  @Prop({ type: Types.ObjectId, ref: 'TeamMember', index: true })
  assignedTechnicianId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Amc', index: true })
  amcId?: Types.ObjectId;

  @Prop({ select: false })
  beforePhotoKey?: string;

  @Prop({ select: false })
  beforePhotoContentType?: string;

  @Prop({ default: false })
  hasBeforePhoto: boolean;

  @Prop({ select: false })
  afterPhotoKey?: string;

  @Prop({ select: false })
  afterPhotoContentType?: string;

  @Prop({ default: false })
  hasAfterPhoto: boolean;

  @Prop({ select: false })
  signatureKey?: string;

  @Prop({ select: false })
  signatureContentType?: string;

  @Prop({ default: false })
  hasSignature: boolean;

  @Prop()
  signedAt?: Date;

  // When a reminder for this visit was last prepared and WhatsApp opened.
  // Shown on the lists ("Reminded 3 days ago") so a customer is not nudged
  // twice by accident, and switches the next one to the follow-up wording.
  // Cleared when the visit is rescheduled.
  @Prop()
  lastRemindedAt?: Date;
}

export const ServiceSchema = SchemaFactory.createForClass(Service);
ServiceSchema.index({ businessId: 1, nextServiceDate: 1 });

// Every list and reminder query filters on businessId + status and ranges or
// sorts on serviceDate; without this the planner scanned the collection and
// sorted in memory.
ServiceSchema.index({ businessId: 1, status: 1, serviceDate: 1, _id: 1 });
// Customer history and the per-customer summaries on every customers page.
ServiceSchema.index({ businessId: 1, customerId: 1, serviceDate: -1 });
// Warranty expiry feed and its cron.
ServiceSchema.index({ businessId: 1, warrantyExpiry: 1 });
