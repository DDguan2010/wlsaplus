import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformService, WEB_POWERSCHOOL_REFERRER_HEADER } from './platform.service';

describe('PlatformService web PowerSchool transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('enables PowerSchool and sends paths through the web gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('schedule', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PlatformService();

    expect(service.info.kind).toBe('web');
    expect(service.info.supportsPowerSchool).toBe(true);
    const result = await service.request({
      baseUrl: 'https://ps.wlsash.org.cn',
      path: '/guardian/myschedule.html?week=1',
      method: 'GET',
    });

    expect(result.text).toBe('schedule');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://apiwlsaplus.02studio.xyz/api/powerschool/guardian/myschedule.html?week=1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('rejects attempts to select another upstream server', async () => {
    const service = new PlatformService();
    await expect(service.request({
      baseUrl: 'https://example.com',
      path: '/guardian/home.html',
      method: 'GET',
    })).rejects.toThrow('supports only https://ps.wlsash.org.cn');
    await expect(service.request({
      baseUrl: 'https://ps.wlsash.org.cn',
      path: '//example.com/guardian/home.html',
      method: 'GET',
    })).rejects.toThrow('cannot request a different PowerSchool server');
  });

  it('passes a validated course-page referrer hint to the web gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PlatformService();

    await service.request({
      baseUrl: 'https://ps.wlsash.org.cn',
      path: '/ws/xte/assignment/lookup?_=123',
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      referrerPath: '/guardian/scores.html?frn=00442&fg=S1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://apiwlsaplus.02studio.xyz/api/powerschool/ws/xte/assignment/lookup?_=123',
      expect.objectContaining({
        headers: expect.objectContaining({
          [WEB_POWERSCHOOL_REFERRER_HEADER]: '/guardian/scores.html?frn=00442&fg=S1',
        }),
      }),
    );
  });

  it('rejects a cross-origin PowerSchool referrer hint', async () => {
    const service = new PlatformService();
    await expect(service.request({
      baseUrl: 'https://ps.wlsash.org.cn',
      path: '/ws/xte/assignment/lookup',
      method: 'POST',
      referrerPath: 'https://example.com/guardian/scores.html',
    })).rejects.toThrow('cannot send a cross-origin PowerSchool referrer');
  });

  it('clears the gateway session when logging out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PlatformService();

    await service.clearSession('https://ps.wlsash.org.cn');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://apiwlsaplus.02studio.xyz/api/powerschool/logout',
      { method: 'POST', credentials: 'include' },
    );
  });
});
