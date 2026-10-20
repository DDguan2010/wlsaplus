import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nService, LocalizedDatePipe, TranslatePipe, translateMessage } from './i18n.service';
import { LocalStore } from './local-store.service';
import { ZH_CN } from './i18n.messages';

@Component({
  imports: [TranslatePipe, LocalizedDatePipe],
  template: `<h1>{{ 'Settings' | t }}</h1><span>{{ 'Due {p0}' | t:{p0: ('2026-10-20T08:30:00' | appDate:'MMM d, HH:mm')} }}</span>`,
})
class LanguageHost {}

describe('app localization', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false, media: query,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })));
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
    vi.unstubAllGlobals();
  });

  it('uses English by default and switches both directions immediately', async () => {
    const fixture = TestBed.createComponent(LanguageHost);
    const store = TestBed.inject(LocalStore);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Settings');
    expect(fixture.nativeElement.querySelector('span').textContent).toBe('Due Oct 20, 08:30');
    store.updateSettings({ language: 'zh-CN' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('设置');
    expect(fixture.nativeElement.querySelector('span').textContent).toBe('截止：10月20日 08:30');
    store.updateSettings({ language: 'en' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Settings');
  });

  it('updates desktop-card labels on a settings storage event', async () => {
    const fixture = TestBed.createComponent(LanguageHost);
    await fixture.whenStable();
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'wlsaplus:settings', storageArea: localStorage, newValue: JSON.stringify({ language: 'zh-CN' }),
    }));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('设置');
  });

  it('interpolates without translating parameter content or recursively interpreting it', () => {
    expect(translateMessage('zh-CN', 'Delete {title}', { title: 'Study {title} <p>Math</p>' })).toBe('删除「Study {title} <p>Math</p>」');
    expect(translateMessage('en', 'Delete {title}', { title: '作业' })).toBe('Delete 作业');
    expect(translateMessage('zh-CN', 'Unknown new label')).toBe('Unknown new label');
    expect(translateMessage('zh-CN', 'constructor')).toBe('constructor');
    expect(translateMessage('zh-CN', '__proto__')).toBe('__proto__');
    expect(translateMessage('zh-CN', 'Delete {title}')).toBe('删除「{title}」');
  });

  it('localizes known native status formats and preserves their variable content', () => {
    expect(translateMessage('zh-CN', 'WLSAPlus 1.0.10-beta.1 is available.')).toBe('WLSAPlus 1.0.10-beta.1 已发布。');
    expect(translateMessage('zh-CN', 'Downloading update: 42%')).toBe('正在下载更新：42%');
    expect(translateMessage('zh-CN', 'PowerSchool returned HTTP 400.')).toBe('PowerSchool 返回 HTTP 400。');
    expect(translateMessage('zh-CN', 'Full device protected by WLSAPlus relay')).toBe('全设备已由 WLSAPlus relay 保护');
    expect(translateMessage('zh-CN', 'Connecting to Pixel {device} over Wi-Fi...')).toBe('正在通过 Wi-Fi 连接 Pixel {device}…');
    expect(translateMessage('en', 'Downloading update: 42%')).toBe('Downloading update: 42%');
  });

  it('keeps the same interpolation parameters in all translations', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [english, chinese] of Object.entries(ZH_CN)) {
      expect(chinese.trim(), english).not.toBe('');
      expect(placeholders(chinese), english).toEqual(placeholders(english));
    }
  });

  it('handles missing dates and reads the current locale', () => {
    const pipe = TestBed.runInInjectionContext(() => new LocalizedDatePipe());
    const i18n = TestBed.inject(I18nService);
    expect(pipe.transform(null)).toBeNull();
    expect(pipe.transform('')).toBeNull();
    expect(i18n.locale()).toBe('en-US');
    TestBed.inject(LocalStore).updateSettings({ language: 'zh-CN' });
    expect(i18n.locale()).toBe('zh-CN');
    expect(pipe.transform('2026-10-20T08:30:00', 'EEEE')).toBe('星期二');
  });
});
