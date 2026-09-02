import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessDto } from './dto/update-business.dto';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Minimal magic-byte sniffing for exactly the three types we accept — no
// need for a full file-type-detection dependency for a 3-way check.
function detectImageMimeType(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  // Open to technicians too — read-only, and the app needs it to show the
  // business name/phone in headers and WhatsApp message templates.
  @Get('me')
  getProfile(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.businessesService.findByIdWithUsage(business.businessId);
  }

  @Roles('owner')
  @Patch('me')
  updateProfile(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.businessesService.update(business.businessId, dto);
  }

  @Roles('owner')
  @Delete('me')
  deleteAccount(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.businessesService.remove(business.businessId);
  }

  @Roles('owner')
  @Post('me/logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async uploadLogo(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const contentType = this.assertValidImage(file);
    await this.businessesService.setLogo(
      business.businessId,
      file!.buffer,
      contentType,
    );
    return { hasLogo: true };
  }

  @Roles('owner')
  @Delete('me/logo')
  async deleteLogo(@CurrentBusiness() business: AuthenticatedBusiness) {
    await this.businessesService.removeLogo(business.businessId);
    return { hasLogo: false };
  }

  // Open to technicians too, same as GET /me — the invoice/quotation
  // preview screens they can access need to render the business logo.
  @Get('me/logo')
  async getLogo(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Res() res: Response,
  ) {
    const logo = await this.businessesService.getLogo(business.businessId);
    if (!logo) {
      throw new NotFoundException('No logo uploaded');
    }
    res.setHeader('Content-Type', logo.contentType);
    res.send(logo.data);
  }

  @Roles('owner')
  @Post('me/signature')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async uploadSignature(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const contentType = this.assertValidImage(file);
    await this.businessesService.setSignature(
      business.businessId,
      file!.buffer,
      contentType,
    );
    return { hasSignature: true };
  }

  @Roles('owner')
  @Delete('me/signature')
  async deleteSignature(@CurrentBusiness() business: AuthenticatedBusiness) {
    await this.businessesService.removeSignature(business.businessId);
    return { hasSignature: false };
  }

  @Get('me/signature')
  async getSignature(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Res() res: Response,
  ) {
    const signature = await this.businessesService.getSignature(
      business.businessId,
    );
    if (!signature) {
      throw new NotFoundException('No signature uploaded');
    }
    res.setHeader('Content-Type', signature.contentType);
    res.send(signature.data);
  }

  // The client-declared mimetype (Multer's parse of the request's
  // Content-Type header) is fully spoofable — a file labelled "image/png"
  // could be anything. Sniff the actual bytes and use that as the source of
  // truth for both validation and what gets stored/served back as the
  // object's Content-Type.
  private assertValidImage(file?: Express.Multer.File): string {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Image must be smaller than 3MB');
    }
    const sniffed = detectImageMimeType(file.buffer);
    if (!sniffed || !ALLOWED_IMAGE_TYPES.includes(sniffed)) {
      throw new BadRequestException(
        'Only JPEG, PNG, or WebP images are allowed',
      );
    }
    return sniffed;
  }
}
