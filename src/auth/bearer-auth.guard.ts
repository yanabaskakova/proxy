import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Requires every incoming request to carry a valid `Authorization: Bearer <token>`
 * header. The expected token is read from the `AUTH_TOKEN` environment variable
 * (via configuration). If the server has no token configured, all requests are
 * rejected — the token is mandatory, so we fail closed.
 */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  private readonly logger = new Logger(BearerAuthGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('app.authToken', '');

    if (expected === '') {
      this.logger.error(
        'AUTH_TOKEN is not configured; rejecting request. Set AUTH_TOKEN to enable access.',
      );
      throw new UnauthorizedException('Server authentication is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token || token !== expected) {
      throw new UnauthorizedException('Invalid or missing bearer token');
    }

    return true;
  }
}
