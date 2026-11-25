'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.SOP_PLAYWRIGHT_MODULE || 'playwright');

const executablePath = process.env.SOP_CANVAS_ELECTRON_EXE;
assert(executablePath, 'Set SOP_CANVAS_ELECTRON_EXE to the Electron executable');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-desktop-exit-'));
const desktop = path.join(temp, 'app');
const source = path.join(root, 'outputs/SOP工作台');

function stageFile(target, contents) {
  const destination = path.join(desktop, target);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function stageApplication() {
  for (const name of JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'), 'utf8')).build.files) {
    if (name !== 'renderer/**/*') stageFile(name, fs.readFileSync(path.join(root, 'desktop', name)));
  }
  stageFile('package.json', '{"name":"sop-desktop-exit-test","main":"main.cjs"}');
  const index = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
  stageFile('renderer/index.html', index);
  for (const [, name] of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (name.startsWith('data:')) continue;
    const contents = name === 'reference-local.js' ? '// No local branding in tests.\n' :
      fs.readFileSync(name === 'assets.js' ? path.join(root, 'desktop/blank-assets.js') : path.join(source, name));
    stageFile(`renderer/${name}`, contents);
  }
}

(async () => {
  let app;
  try {
    stageApplication();
    const file = path.join(temp, 'exit.sop.json');
    app = await _electron.launch({
      executablePath,
      args: [desktop, '--sop-test'],
      env: { ...process.env, SOP_STUDIO_TEST_USERDATA: path.join(temp, 'profile') },
      timeout: 45000,
    });
    await app.evaluate(({ dialog, ipcMain }, file) => {
      const test = globalThis.exitTest = { cancelFilePicker: true, confirmations: [], completed: 0 };
      ipcMain.on('sop:close-ready', () => { test.completed++; });
      dialog.showMessageBox = async (_window, options) => {
        test.confirmations.push(options.title);
        return { response: 2 };
      };
      dialog.showSaveDialog = async () => test.cancelFilePicker ? { canceled: true } : { canceled: false, filePath: file };
    }, file);
    const page = await app.firstWindow();
    const ready = () => page.waitForFunction(() => window.SOP && !document.querySelector('#saveBtn').disabled);
    const nativeClose = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const prompt = page.locator('dialog.editor-save-prompt[open]');
    const canvas = page.locator('.object-dialog[open]');
    const choose = choice => prompt.locator(`[data-choice="${choice}"]`).click();
    const projectCount = () => page.evaluate(() => SOP.project.pages[0].canvas?.objects.length || 0);
    const confirmCount = () => app.evaluate(() => exitTest.confirmations.length);
    const waitForReply = count => app.evaluate(async (_electron, count) => {
      const timeout = Date.now() + 10000;
      while (exitTest.completed < count && Date.now() < timeout) await new Promise(resolve => setTimeout(resolve, 30));
      if (exitTest.completed < count) throw Error('The renderer did not reply to the exit request');
    }, count);
    const openCanvas = () => page.locator('#editPageCanvas').click();
    async function drawRectangle() {
      await canvas.locator('[data-add="rect"]').click();
      const box = await canvas.locator('.object-sheet').boundingBox();
      assert(box);
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.32, { steps: 6 });
      await page.mouse.up();
      await canvas.locator('[data-object]').waitFor();
    }

    await ready();
    await openCanvas();
    await Promise.all([page.waitForEvent('domcontentloaded'), page.keyboard.press('F5')]);
    await ready();
    assert.equal(await prompt.count(), 0);
    assert.equal(await confirmCount(), 0);

    await openCanvas();
    await drawRectangle();
    await nativeClose();
    await prompt.waitFor();
    await nativeClose();
    assert.equal(await prompt.count(), 1);
    await choose('cancel');
    await waitForReply(2);
    assert.equal(await canvas.locator('[data-object]').count(), 1);
    assert.equal(await projectCount(), 0);
    assert.equal(await confirmCount(), 0);

    await page.keyboard.press('Control+Shift+R');
    await prompt.waitFor();
    await Promise.all([page.waitForEvent('domcontentloaded'), choose('discard')]);
    await ready();
    assert.equal(await projectCount(), 0);
    assert.equal(await confirmCount(), 0);

    await openCanvas();
    await drawRectangle();
    await nativeClose();
    await choose('save');
    await waitForReply(4);
    assert.equal(await canvas.locator('[data-object]').count(), 1, 'Canceling the file picker preserves the open canvas');
    assert.equal(await projectCount(), 0, 'Canceling the file picker leaves the original project unchanged');
    assert.equal(await confirmCount(), 0, 'The canvas save does not show a second project confirmation');
    assert.equal(await prompt.count(), 0);
    assert.equal(fs.existsSync(file), false);

    await app.evaluate(() => { exitTest.cancelFilePicker = false; });
    const closed = page.waitForEvent('close');
    await nativeClose();
    await choose('save');
    await closed;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.pages[0].canvas.objects.length, 1);
    console.log('PASS: Electron guards close and reload, preserves canceled edits, and writes saved canvas to the project');
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit()).catch(() => {});
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
