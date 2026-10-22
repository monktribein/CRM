import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Public } from '../common/decorators.js';
import { allowedOrigins, type EnvironmentVariables } from '../config/env.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, TokenPasswordDto } from './dto.js';
import { TokenService } from './tokens/token.service.js';

export const REFRESH_COOKIE = 'bn_refresh';
// Read at load time; AUTH_RATE_LIMIT is validated in env.ts (default 10 per minute per IP).
const AUTH_LIMIT = { default: { limit: Number(process.env.AUTH_RATE_LIMIT ?? 10), ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly origins: string[];
  private readonly cookie: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    tokens: TokenService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    const prod = config.get('NODE_ENV', { infer: true }) === 'production';
    this.origins = allowedOrigins({ FRONTEND_URL: config.get('FRONTEND_URL', { infer: true }) });
    this.cookie = {
      httpOnly: true,
      // The Vercel frontend and Render API are different sites, so production
      // needs SameSite=None (which requires Secure).
      secure: prod,
      sameSite: prod ? 'none' : 'lax',
      path: '/api/v1/auth',
      domain: config.get('COOKIE_DOMAIN', { infer: true }) || undefined,
      maxAge: tokens.refreshTtlMilliseconds,
    };
  }

  /** Cookie-authenticated endpoints only accept requests from the allowed frontend origins. */
  private assertOrigin(req: Request) {
    const origin = req.headers.origin;
    if (origin && !this.origins.includes(origin)) throw new ForbiddenException('Origin not allowed.');
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, this.cookie);
  }

  private clearRefreshCookie(res: Response) {
    const { maxAge: _maxAge, ...rest } = this.cookie;
    res.clearCookie(REFRESH_COOKIE, rest);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertOrigin(req);
    const { refreshToken, ...session } = await this.auth.login(dto.email, dto.password, req.headers['user-agent'], dto.organization);
    this.setRefreshCookie(res, refreshToken);
    return session;
  }

  @Public()
  // Every page load restores the session here; generous per-IP limit so offices behind one IP are fine.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiCookieAuth(REFRESH_COOKIE)
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertOrigin(req);
    try {
      const { refreshToken, ...session } = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], req.headers['user-agent']);
      this.setRefreshCookie(res, refreshToken);
      return session;
    } catch (err) {
      this.clearRefreshCookie(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertOrigin(req);
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    this.clearRefreshCookie(res);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('forgot-password')
  @HttpCode(204)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: TokenPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('accept-invitation')
  @HttpCode(204)
  async acceptInvitation(@Body() dto: TokenPasswordDto) {
    await this.auth.acceptInvitation(dto.token, dto.password);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.toCurrentUser(user.id);
  }

  @ApiBearerAuth()
  @Throttle(AUTH_LIMIT)
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refresh = await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, req.headers['user-agent']);
    this.setRefreshCookie(res, refresh);
  }
}
