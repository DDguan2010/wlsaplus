import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { DateAdapter } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStore } from '../core/local-store.service';
import { SettingsPage } from './settings.page';
import { ConfirmDialogComponent, TextDialogComponent } from '../shared/text-dialog.component';

describe('language selection in Settings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false, media: query,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })));
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });
  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    localStorage.clear();
    document.documentElement.lang = 'en';
    vi.unstubAllGlobals();
  });

  it('saves a click on 中文, changes the page immediately and can return to English', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('h1')?.textContent).toBe('Settings');
    root.querySelector<HTMLButtonElement>('mat-button-toggle[value="zh-CN"] button')!.click();
    await fixture.whenStable();
    expect(root.querySelector('h1')?.textContent).toBe('设置');
    expect(root.textContent).toContain('外观');
    expect(JSON.parse(localStorage.getItem('wlsaplus:settings')!).language).toBe('zh-CN');
    expect(new LocalStore().settings().language).toBe('zh-CN');
    root.querySelector<HTMLButtonElement>('mat-button-toggle[value="en"] button')!.click();
    await fixture.whenStable();
    expect(root.querySelector('h1')?.textContent).toBe('Settings');
    expect(root.textContent).toContain('Appearance');
  });

  it('localizes task dialogs and calendar while preserving task input', async () => {
    const ref = TestBed.inject(MatDialog).open(TextDialogComponent, {
      data: { mode: 'edit', title: 'Study English', details: 'Do not translate this.' },
    });
    const instance = ref.componentInstance;
    TestBed.tick();
    expect(document.querySelector('app-text-dialog h2')?.textContent).toBe('Edit task');
    TestBed.inject(LocalStore).updateSettings({ language: 'zh-CN' });
    TestBed.tick();
    expect(document.querySelector('app-text-dialog h2')?.textContent).toBe('编辑任务');
    expect(instance.title.value).toBe('Study English');
    expect(instance.details.value).toBe('Do not translate this.');
    const adapter = ref.componentRef!.injector.get<DateAdapter<Date>>(DateAdapter);
    expect(adapter.getDayOfWeekNames('long')[0]).toBe('星期日');
  });

  it('translates confirmation labels but never translates task titles', () => {
    TestBed.inject(LocalStore).updateSettings({ language: 'zh-CN' });
    const dialog = TestBed.inject(MatDialog);
    const ref = dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete task?', message: 'Settings', action: 'Delete' },
    });
    TestBed.tick();
    expect(document.querySelector('app-confirm-dialog h2')?.textContent).toBe('删除任务？');
    expect(document.querySelector('app-confirm-dialog mat-dialog-content')?.textContent).toBe('Settings');
    ref.close();
    const clearRef = dialog.open(ConfirmDialogComponent, {
      data: { title: 'Clear this device?', messageKey: 'Saved credentials, schedule, and tasks will be removed.', action: 'Clear data' },
    });
    TestBed.tick();
    expect(clearRef.componentRef!.location.nativeElement.querySelector('mat-dialog-content')?.textContent).toBe('保存的登录信息、课程表和任务将被删除。');
  });
});
