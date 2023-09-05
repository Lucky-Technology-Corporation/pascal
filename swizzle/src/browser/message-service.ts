import { injectable } from 'inversify';
import { MessageService } from '@theia/core/lib/common/message-service';

@injectable()
export class NoOpMessageService extends MessageService {
  info<T extends string>(message: string, ...actions: T[]): Promise<T | undefined> {
    console.log("[THEIA INFO] " + message)
    return Promise.resolve(undefined);
  }
  
  warn<T extends string>(message: string, ...actions: T[]): Promise<T | undefined> {
    console.log("[THEIA WARN] " + message)
    return Promise.resolve(undefined);
  }
  
  error<T extends string>(message: string, ...actions: T[]): Promise<T | undefined> {
    console.log("[THEIA ERROR] " + message)
    return Promise.resolve(undefined);
  }
}
