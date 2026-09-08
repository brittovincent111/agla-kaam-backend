import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterEmailDto } from './dto/register-email.dto';
import { SendSignupOtpDto } from './dto/send-signup-otp.dto';
import { LoginEmailDto } from './dto/login-email.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { AppleAuthDto } from './dto/apple-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(200)
  @Post('send-signup-otp')
  async sendSignupOtp(@Body() dto: SendSignupOtpDto) {
    const { devCode } = await this.authService.sendSignupOtp(dto.email);
    return {
      message: 'Verification code sent to your email.',
      ...(devCode ? { devCode } : {}),
    };
  }

  // Tighter than the app-wide default (60/min) — these are the
  // credential-guessing surface, so they get their own per-IP limit
  // instead of sharing headroom with every other route.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register-email')
  registerEmail(@Body() dto: RegisterEmailDto) {
    return this.authService.registerWithEmail(
      dto.email,
      dto.password,
      dto.businessName,
      dto.phone,
      dto.code,
    );
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login-email')
  loginEmail(@Body() dto: LoginEmailDto) {
    return this.authService.loginWithEmail(dto.email, dto.password);
  }

  // Less sensitive as a brute-force target (an attacker can't guess a
  // valid Google ID token), but still worth a tighter-than-default cap.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('google')
  google(@Body() dto: GoogleAuthDto) {
    return this.authService.loginWithGoogle(dto.idToken);
  }

  // Same rationale as google() above — not a credential-guessing surface.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('apple')
  apple(@Body() dto: AppleAuthDto) {
    return this.authService.loginWithApple(dto.identityToken, dto.fullName);
  }

  // Deliberately tighter than login — each request sends a real email, so
  // this also caps how fast someone's inbox (or the SMTP account's send
  // rate) can be hammered, not just credential-guessing.
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const { devCode } = await this.authService.forgotPassword(dto.email);
    // Always the same response whether or not the email matched an account
    // — the alternative (a different message for "not found") lets an
    // attacker enumerate which emails are registered.
    return {
      message: 'If that email is registered, a reset code has been sent.',
      ...(devCode ? { devCode } : {}),
    };
  }

  // 6-digit code has 1M possibilities; combined with the 15-minute expiry
  // set in AuthService and this per-IP cap, brute-forcing a specific code
  // is impractical without needing a separate per-code attempt counter.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
    return { message: 'Password reset. Log in with your new password.' };
  }
}
