import { injectable } from 'inversify';
import { WorkspaceTrustService } from '@theia/workspace/lib/browser/workspace-trust-service';

@injectable()
export class NoOpTrustService extends WorkspaceTrustService {
  async getWorkspaceTrust(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
