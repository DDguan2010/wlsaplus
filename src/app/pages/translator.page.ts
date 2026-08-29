import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlatformService } from '../core/platform.service';
import { TranslationService } from '../core/translation.service';

@Component({
  selector: 'app-translator-page',
  imports: [FormsModule, RouterLink, MatButtonModule, MatProgressSpinnerModule, MatSelectModule],
  template: `
    <div class="page translator-page">
      <header class="page-header"><a class="back icon-button" routerLink="/tools" aria-label="Back to tools"><span class="material-symbols-rounded">arrow_back</span></a><h1 class="page-title">Translator</h1><span class="spacer"></span>@if (platform.info.supportsScreenTranslation) { <button mat-stroked-button class="capture" (click)="capture()" [disabled]="working()"><span class="material-symbols-rounded">screenshot_region</span>Translate screen</button> }</header>
      <div class="language-bar surface"><mat-select [(value)]="source" aria-label="Source language">@for (language of sourceLanguages; track language.code) { <mat-option [value]="language.code">{{ language.label }}</mat-option> }</mat-select><button class="swap icon-button" (click)="swap()" [disabled]="source === 'auto'" aria-label="Swap languages"><span class="material-symbols-rounded">swap_horiz</span></button><mat-select [(value)]="target" aria-label="Target language">@for (language of targetLanguages; track language.code) { <mat-option [value]="language.code">{{ language.label }}</mat-option> }</mat-select></div>
      <section class="translation-workspace surface">
        <div class="text-pane"><textarea [(ngModel)]="input" maxlength="5000" placeholder="Enter text" aria-label="Text to translate"></textarea><span class="counter">{{ input.length }} / 5000</span></div>
        <div class="divider"></div>
        <div class="text-pane result-pane">@if (working()) { <div class="working"><mat-spinner diameter="34"></mat-spinner><span>{{ progress() }}</span></div> } @else { <textarea [value]="output" readonly placeholder="Translation" aria-label="Translation result"></textarea> }<button class="copy icon-button" (click)="copy()" [disabled]="!output" aria-label="Copy translation"><span class="material-symbols-rounded">content_copy</span></button></div>
      </section>
      <div class="actions"><button mat-flat-button (click)="translate()" [disabled]="working() || !input.trim()"><span class="material-symbols-rounded">translate</span>Translate</button></div>
    </div>
  `,
  styles: `
    .translator-page { width: min(100%, 1180px); } .page-header { justify-content: flex-start; } .back { margin-left: -10px; color: var(--app-text); text-decoration: none; } .capture, .actions button { display: inline-flex; align-items: center; gap: 8px; } .capture .material-symbols-rounded, .actions .material-symbols-rounded { font-size: 19px; }
    .language-bar { min-height: 58px; display: grid; grid-template-columns: 1fr 48px 1fr; align-items: center; padding: 0 18px; border-radius: 8px 8px 0 0; } mat-select { min-width: 0; } .swap { border: 0; background: transparent; color: var(--app-muted); cursor: pointer; }
    .translation-workspace { min-height: 410px; display: grid; grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr); border-top: 0; border-radius: 0 0 8px 8px; overflow: hidden; } .divider { background: var(--app-border); } .text-pane { position: relative; min-width: 0; padding: 18px; } textarea { width: 100%; height: 100%; min-height: 340px; padding: 0 0 32px; resize: none; border: 0; outline: 0; background: transparent; color: var(--app-text); font-size: 19px; line-height: 1.55; } .result-pane { background: color-mix(in srgb, var(--app-surface-raised) 42%, var(--app-surface)); } .counter { position: absolute; right: 18px; bottom: 16px; color: var(--app-muted); font-size: 11px; } .copy { position: absolute; right: 9px; bottom: 8px; border: 0; background: transparent; color: var(--app-muted); cursor: pointer; } .working { height: 100%; display: grid; place-content: center; justify-items: center; gap: 12px; color: var(--app-muted); font-size: 13px; }
    .actions { display: flex; justify-content: flex-end; margin-top: 14px; } .actions button { min-width: 124px; height: 46px; }
    @media (max-width: 700px) { .page-header { flex-wrap: wrap; } .capture { order: 3; width: 100%; justify-content: center; } .translation-workspace { min-height: 560px; grid-template-columns: 1fr; grid-template-rows: 1fr 1px 1fr; } textarea { min-height: 230px; font-size: 17px; } .language-bar { grid-template-columns: minmax(0,1fr) 42px minmax(0,1fr); padding: 0 11px; } }
  `,
})
export class TranslatorPage {
  readonly platform = inject(PlatformService); private readonly service = inject(TranslationService); private readonly snack = inject(MatSnackBar);
  readonly working = signal(false); readonly progress = signal('Translating...');
  input = ''; output = ''; source = 'auto'; target = 'en';
  readonly sourceLanguages = [{ code: 'auto', label: 'Detect language' }, { code: 'en', label: 'English' }, { code: 'zh-CN', label: 'Chinese' }, { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' }, { code: 'de', label: 'German' }, { code: 'ja', label: 'Japanese' }, { code: 'ko', label: 'Korean' }, { code: 'ru', label: 'Russian' }];
  readonly targetLanguages = this.sourceLanguages.filter((language) => language.code !== 'auto');

  async translate(): Promise<void> {
    if (!this.input.trim()) return;
    this.working.set(true); this.progress.set('Translating...');
    try { this.output = (await this.service.translate(this.input, this.source, this.target)).text; }
    catch (error) { this.snack.open(error instanceof Error ? error.message : 'Translation failed.', 'Dismiss'); }
    finally { this.working.set(false); }
  }

  async capture(): Promise<void> {
    this.working.set(true); this.progress.set('Select a screen region...');
    try {
      const image = await this.service.captureRegion();
      if (!image) return;
      this.progress.set('Recognizing text...');
      type TesseractLoader = { createWorker: typeof import('tesseract.js').createWorker };
      const loaded = await import('tesseract.js') as unknown as TesseractLoader & { default?: TesseractLoader };
      const createWorker = typeof loaded.createWorker === 'function' ? loaded.createWorker : loaded.default?.createWorker;
      if (!createWorker) throw new Error('The OCR engine could not be loaded.');
      const ocrPath = new URL('ocr/', document.baseURI).toString();
      const worker = await createWorker(['eng', 'chi_sim'], 1, {
        workerPath: `${ocrPath}worker.min.js`,
        corePath: ocrPath,
        langPath: ocrPath,
        workerBlobURL: false,
        logger: (message) => { if (message.status === 'recognizing text') this.progress.set(`Recognizing ${Math.round(message.progress * 100)}%`); },
      });
      try { this.input = (await worker.recognize(image)).data.text.trim(); } finally { await worker.terminate(); }
      if (this.input) {
        this.progress.set('Translating...');
        this.output = (await this.service.translate(this.input, 'auto', this.target)).text;
      } else this.snack.open('No text was recognized in that region.', undefined, { duration: 2600 });
    } catch (error) { this.snack.open(error instanceof Error ? error.message : 'Screen translation failed.', 'Dismiss'); }
    finally { this.working.set(false); }
  }

  swap(): void { if (this.source === 'auto') return; [this.source, this.target] = [this.target, this.source]; [this.input, this.output] = [this.output, this.input]; }
  async copy(): Promise<void> { if (this.output) { await navigator.clipboard.writeText(this.output); this.snack.open('Translation copied', undefined, { duration: 1600 }); } }
}
