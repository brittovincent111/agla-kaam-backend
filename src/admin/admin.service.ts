import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/schemas/business.schema';
import { Subscription, SubscriptionDocument } from '../subscriptions/schemas/subscription.schema';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import { Service, ServiceDocument } from '../services/schemas/service.schema';
import { Invoice, InvoiceDocument } from '../invoicing/schemas/invoice.schema';
import { AppFeedback, AppFeedbackDocument } from '../app-feedback/schemas/app-feedback.schema';
import { AdminLoginDto } from './dto/admin-login.dto';

// Estimated yearly price values per tier (in INR)
const TIER_PRICES_INR: Record<string, number> = {
  reminders: 1499,
  invoicing: 1499,
  combo: 2499,
  combo_team: 3999,
};

@Injectable()
export class AdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectModel(Business.name) private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Service.name) private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(AppFeedback.name) private readonly feedbackModel: Model<AppFeedbackDocument>,
  ) {}

  async login(dto: AdminLoginDto): Promise<{ accessToken: string; admin: { email: string } }> {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL') ?? 'admin@velocrew.in';
    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD') ?? 'velocrew@admin2026';

    if (
      dto.email.trim().toLowerCase() !== adminEmail.trim().toLowerCase() ||
      dto.password !== adminPassword
    ) {
      throw new UnauthorizedException('Invalid admin credentials.');
    }

    const payload = {
      isSaasOwner: true,
      email: adminEmail,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    return {
      accessToken,
      admin: { email: adminEmail },
    };
  }

  async getDashboardStats() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalBusinesses,
      activeSubscribersCount,
      freeBusinessesCount,
      newBusinesses30d,
      newBusinesses7d,
      totalCustomers,
      totalServices,
      overdueServices,
      totalInvoices,
      invoiceRevenueAgg,
      activeSubscriptionsList,
      tradeBreakdownAgg,
      recentBusinesses,
      recentFeedbackDocs,
    ] = await Promise.all([
      this.businessModel.countDocuments(),
      this.businessModel.countDocuments({ subscriptionStatus: 'active' }),
      this.businessModel.countDocuments({ subscriptionStatus: 'free' }),
      this.businessModel.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      this.businessModel.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      this.customerModel.countDocuments(),
      this.serviceModel.countDocuments(),
      this.serviceModel.countDocuments({ nextServiceDate: { $lt: now } }),
      this.invoiceModel.countDocuments(),
      this.invoiceModel.aggregate([
        { $match: { status: { $ne: 'cancelled' } } },
        { $group: { _id: null, totalInvoiced: { $sum: '$grandTotal' } } },
      ]),
      this.subscriptionModel.find({ status: 'active' }).exec(),
      this.businessModel.aggregate([
        { $group: { _id: '$tradeType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.businessModel
        .find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('name tradeType email phone subscriptionStatus createdAt')
        .exec(),
      this.feedbackModel
        .find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('businessId', 'name email phone')
        .exec(),
    ]);

    // Calculate MRR & ARR from active subscriptions
    let calculatedARR = 0;
    const tierCounts: Record<string, number> = {
      reminders: 0,
      invoicing: 0,
      combo: 0,
      combo_team: 0,
    };

    for (const sub of activeSubscriptionsList) {
      const key = sub.teamEnabled ? `${sub.tier}_team` : sub.tier;
      tierCounts[key] = (tierCounts[key] || 0) + 1;
      const price = TIER_PRICES_INR[key] || TIER_PRICES_INR[sub.tier] || 1499;
      calculatedARR += price;
    }

    const calculatedMRR = Math.round(calculatedARR / 12);
    const totalInvoicedValue = invoiceRevenueAgg[0]?.totalInvoiced || 0;

    const tradeBreakdown = tradeBreakdownAgg.map((item) => ({
      tradeType: item._id || 'Unspecified',
      count: item.count,
    }));

    const recentFeedback = recentFeedbackDocs.map((fb: any) => ({
      id: fb._id.toString(),
      rating: fb.rating,
      comment: fb.comment,
      createdAt: fb.createdAt,
      businessName: fb.businessId?.name || 'Unknown Business',
      businessEmail: fb.businessId?.email || 'N/A',
    }));

    return {
      overview: {
        totalBusinesses,
        activeSubscribersCount,
        freeBusinessesCount,
        newBusinesses30d,
        newBusinesses7d,
        totalCustomers,
        totalServices,
        overdueServices,
        totalInvoices,
        totalInvoicedValue,
        mrr: calculatedMRR,
        arr: calculatedARR,
      },
      tierCounts,
      tradeBreakdown,
      recentBusinesses,
      recentFeedback,
    };
  }

  async getBusinessesList(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const query: any = {};

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: regex }, { email: regex }, { phone: regex }, { tradeType: regex }];
    }

    const [items, total] = await Promise.all([
      this.businessModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('name tradeType email phone subscriptionStatus gstin address createdAt')
        .exec(),
      this.businessModel.countDocuments(query),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFeedbackList(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.feedbackModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('businessId', 'name email phone tradeType')
        .exec(),
      this.feedbackModel.countDocuments(),
    ]);

    return {
      items: items.map((fb: any) => ({
        id: fb._id.toString(),
        rating: fb.rating,
        comment: fb.comment,
        createdAt: fb.createdAt,
        businessName: fb.businessId?.name || 'Unknown Business',
        businessEmail: fb.businessId?.email || 'N/A',
        businessPhone: fb.businessId?.phone || 'N/A',
        tradeType: fb.businessId?.tradeType || 'N/A',
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateBusinessSubscription(
    businessId: string,
    subscriptionStatus: 'free' | 'active' | 'expired',
    tier?: string,
    customRenewalDate?: string | Date,
  ) {
    const business = await this.businessModel.findById(businessId);
    if (!business) {
      throw new UnauthorizedException('Business account not found.');
    }

    business.subscriptionStatus = subscriptionStatus;
    await business.save();

    if (tier || subscriptionStatus === 'active') {
      const selectedTier = tier || 'combo';
      let renewalDate = new Date();
      if (customRenewalDate) {
        renewalDate = new Date(customRenewalDate);
      } else {
        renewalDate.setFullYear(renewalDate.getFullYear() + 1);
      }

      await this.subscriptionModel.findOneAndUpdate(
        { businessId: business._id },
        {
          tier: selectedTier,
          status: subscriptionStatus === 'active' ? 'active' : 'expired',
          renewalDate,
        },
        { upsert: true, new: true },
      );
    }

    return {
      message: `Business subscription updated to ${subscriptionStatus}`,
      business,
    };
  }

  async getBusinessDetail(businessId: string) {
    const business = await this.businessModel.findById(businessId).exec();
    if (!business) {
      throw new UnauthorizedException('Business not found.');
    }

    const [customersCount, servicesCount, invoicesCount, subscriptionDoc] = await Promise.all([
      this.customerModel.countDocuments({ businessId: business._id }),
      this.serviceModel.countDocuments({ businessId: business._id }),
      this.invoiceModel.countDocuments({ businessId: business._id }),
      this.subscriptionModel.findOne({ businessId: business._id }).exec(),
    ]);

    return {
      business,
      stats: {
        customersCount,
        servicesCount,
        invoicesCount,
      },
      subscription: subscriptionDoc,
    };
  }

  async exportBusinessesCsv(): Promise<string> {
    const businesses = await this.businessModel
      .find()
      .sort({ createdAt: -1 })
      .select('name tradeType email phone subscriptionStatus gstin address createdAt')
      .exec();

    const headers = 'Business Name,Trade Category,Email,Phone,GSTIN,Subscription Status,Registered On\n';
    const rows = businesses
      .map((b) => {
        const name = `"${(b.name || '').replace(/"/g, '""')}"`;
        const trade = `"${(b.tradeType || 'General').replace(/"/g, '""')}"`;
        const email = `"${b.email || ''}"`;
        const phone = `"${b.phone || ''}"`;
        const gstin = `"${b.gstin || ''}"`;
        const status = b.subscriptionStatus;
        const date = new Date((b as any).createdAt).toISOString().split('T')[0];
        return `${name},${trade},${email},${phone},${gstin},${status},${date}`;
      })
      .join('\n');

    return headers + rows;
  }

  async getSystemHealth() {
    const mongoState = this.businessModel.db.readyState;
    const isMongoOk = mongoState === 1;

    return {
      status: 'operational',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: {
        status: isMongoOk ? 'healthy' : 'degraded',
        readyState: mongoState,
      },
      smtp: {
        fromEmail: process.env.EMAIL_FROM || 'admin@velocrew.in',
        host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
      },
    };
  }

  async broadcastPushNotification(title: string, body: string, tradeType?: string) {
    const filter: any = { pushToken: { $exists: true, $ne: '' } };
    if (tradeType) {
      filter.tradeType = tradeType;
    }

    const businesses = await this.businessModel.find(filter).select('pushToken').exec();
    const tokens = businesses.map((b) => b.pushToken).filter(Boolean);

    if (tokens.length === 0) {
      return {
        message: 'No registered push tokens found for targeted audience.',
        sentCount: 0,
      };
    }

    const messages = tokens.map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: { type: 'broadcast' },
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const resData = await response.json();
      return {
        message: `Successfully dispatched broadcast push notification to ${tokens.length} devices.`,
        sentCount: tokens.length,
        expoResponse: resData,
      };
    } catch (err: any) {
      return {
        message: `Failed to dispatch push notification: ${err.message}`,
        sentCount: 0,
      };
    }
  }
}
