import { beforeEach, describe, expect, it } from 'vitest';
import { CredentialVault } from './credential-vault.service';

describe('CredentialVault in a web browser', () => {
  beforeEach(() => localStorage.clear());

  it('persists the complete PowerSchool login for automatic reconnection', async () => {
    const credentials = {
      schoolUrl: 'https://ps.wlsash.org.cn',
      username: 'student',
      password: 'saved-password',
    };
    const vault = new CredentialVault();

    await vault.set(credentials);

    expect(JSON.parse(localStorage.getItem('wlsaplus:credentials') ?? '{}')).toEqual(credentials);
    expect(await vault.get()).toEqual(credentials);
  });
});
