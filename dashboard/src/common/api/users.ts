import { BaseAPIClient } from './client';

export class UsersAPI extends BaseAPIClient {
  async listUsers(): Promise<{ id: string; name: string }[]> {
    return this.get('/users');
  }
}
