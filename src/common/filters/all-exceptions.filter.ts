import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';

// Temporary diagnostic filter: logs full error detail (route, body shape,
// stack) for every request that ends in an error, so the real cause of a
// "server error" shows up in the process's stdout/stderr instead of being
// swallowed into a generic response.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpException
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    console.error(
      `[${new Date().toISOString()}] ${request.method} ${request.originalUrl} -> ${status}`,
      'body keys:',
      request.body ? Object.keys(request.body) : [],
      exception instanceof Error ? exception.stack : exception,
    );

    response.status(status).json(body);
  }
}
