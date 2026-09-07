import { BaseAPIClient } from './client';

export class TenantsAPI extends BaseAPIClient {
  async listTenants(): Promise<{ id: string; name: string }[]> {
    return this.get('/tenants');
  }
}
