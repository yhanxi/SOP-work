const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.SOP_PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const server = spawn(process.execPath, ['scripts/serve.cjs', '--port', '0'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']
  });
  let browser;
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '';
      server.once('error', reject);
      server.once('exit', code => reject(new Error('Server exited: ' + code)));
      server.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0]).url);
      });
    });
    browser = await chromium.launch({ executablePath: process.env.SOP_TEST_BROWSER });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.SOP);
    const editor = page.locator('.object-dialog[open]');
    const prompt = page.locator('.editor-save-prompt[open]');
    const action = name => editor.locator('[data-action="' + name + '"]').click();
    const choose = name => prompt.locator('[data-choice="' + name + '"]').click();
    const open = () => page.locator('#editPageCanvas').click();
    const countSaved = () => page.evaluate(() => SOP.project.pages[0].canvas?.objects.length || 0);
    const draw = async () => {
      await editor.locator('[data-add="rect"]').click();
      const box = await editor.locator('.object-sheet').boundingBox();
      await page.mouse.move(box.x + box.width * .16, box.y + box.height * .22);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .45, box.y + box.height * .42, { steps: 5 });
      await page.mouse.up();
    };
    // Start from an actual workbench page, then edit through the canvas toolbar.
    await page.evaluate(() => {
      const p = SOP.blankPage();
      SOP.replaceProject({ ...SOP.clone(SOP.project), pages: [p] });
    });
    await open();
    await action('close');
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await prompt.count(), 0);
    await open();
    await draw();
    await action('undo');
    await action('close');
    await editor.waitFor({ state: 'hidden' });
    await open();
    await draw();
    await action('close');
    await choose('cancel');
    assert.equal(await editor.locator('[data-object]').count(), 1);
    assert.equal(await countSaved(), 0);
    await page.keyboard.press('F5');
    await prompt.waitFor();
    await page.keyboard.press('Escape');
    await prompt.waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    await choose('discard');
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await countSaved(), 0);
    await open();
    await draw();
    await action('close');
    await choose('save');
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await countSaved(), 1);
    await open();
    await action('save');
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await countSaved(), 1);
    // Exercise the same guard on generated flow previews and a failed asynchronous save.
    await page.evaluate(() => {
      SOP_OBJECTS.open({ width: 900, height: 520, objects: [], edges: [] }, {
        flow: true, preview: true, onSave: async () => false
      });
    });
    await draw();
    await action('close');
    await choose('save');
    await editor.locator('[data-action="close"]:enabled').waitFor();
    assert.equal(await editor.locator('[data-object]').count(), 1);
    await action('close');
    await choose('discard');
    await editor.waitFor({ state: 'hidden' });
    // Open the photo annotation editor via a real image attachment.
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      return canvas.toDataURL().split(',')[1];
    });
    await page.evaluate(() => {
      SOP.replaceProject({ ...SOP.clone(SOP.project), pages: [SOP.blankPage()] });
    });
    await page.locator('#photoFile').setInputFiles({
      name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64')
    });
    await page.locator('#photoGrid [data-edit-photo]').first().click();
    const photo = page.locator('#photoDialog[open]');
    await photo.locator('[data-tool="arrow"]').click();
    const box = await photo.locator('#annotationCanvas').boundingBox();
    await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .65, { steps: 5 });
    await page.mouse.up();
    await photo.locator('#closePhoto').click();
    await choose('cancel');
    await page.keyboard.press('Escape');
    await choose('save');
    await photo.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => SOP.project.pages[0].photos[0].marks.length), 1);
    // A fresh project isolates the browser's native tab-close warning from project edits.
    const tabContext = await browser.newContext();
    const tab = await tabContext.newPage();
    await tab.goto(url);
    await tab.locator('#editPageCanvas').click();
    await tab.locator('[data-add="rect"]').click();
    const sheet = await tab.locator('.object-sheet').boundingBox();
    await tab.mouse.move(sheet.x + 20, sheet.y + 20);
    await tab.mouse.down();
    await tab.mouse.move(sheet.x + 80, sheet.y + 60, { steps: 4 });
    await tab.mouse.up();
    const nativeWarning = tab.waitForEvent('dialog').then(async dialog => {
      assert.equal(dialog.type(), 'beforeunload');
      await dialog.dismiss();
    });
    await Promise.all([nativeWarning, tab.close({ runBeforeUnload: true })]);
    assert.equal(await tab.locator('.object-dialog [data-object]').count(), 1);
    // Exercise the whole-workspace save branch with an isolated real file handle.
    await tab.evaluate(() => {
      window.showSaveFilePicker = async () => { throw new DOMException('Canceled', 'AbortError'); };
    });
    const tabSave = tab.locator('.editor-save-prompt [data-choice="save"]');
    await tab.keyboard.press('F5');
    await tabSave.click();
    await tab.waitForFunction(() => document.querySelector('.object-dialog[open]:not([aria-busy])'));
    assert.equal(await tab.locator('.object-dialog [data-object]').count(), 1);
    assert.equal(await tab.evaluate(() => SOP.project.pages[0].canvas?.objects.length || 0), 0);
    await tab.evaluate(() => {
      window.showSaveFilePicker = async () =>
        (await navigator.storage.getDirectory()).getFileHandle('exit.sop.json', { create: true });
    });
    await tab.keyboard.press('Control+r');
    await Promise.all([tab.waitForEvent('domcontentloaded'), tabSave.click()]);
    await tab.waitForFunction(() => window.SOP && !document.querySelector('#saveBtn').disabled);
    const persisted = await tab.evaluate(async () => {
      const file = await (await navigator.storage.getDirectory()).getFileHandle('exit.sop.json');
      return JSON.parse(await (await file.getFile()).text()).pages[0].canvas.objects.length;
    });
    assert.equal(persisted, 1);
    assert.equal(await tab.evaluate(() => SOP.project.pages[0].canvas.objects.length), 1);
    assert.deepEqual(errors, []);
    console.log('Canvas exit choices, undo, refresh, failed save and photo annotations passed.');
  } finally {
    try { await browser?.close(); } finally { server.kill(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
