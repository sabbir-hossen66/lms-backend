import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface StandardResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, StandardResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<StandardResponse<T> | T> {
    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      map((data) => {
        // Bypass streaming or direct pipe responses
        if (response.headersSent || (data && typeof data.pipe === 'function')) {
          return data;
        }

        // If the service already structured the response
        if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
          return data;
        }

        return {
          success: true,
          data,
        };
      }),
    );
  }
}
