const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium, _electron } = require(process.env.SOP_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = spawn(process.execPath, [path.join(root, 'scripts/serve.cjs'), '--port', '0'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'],
  });
  let browser;
  try {
    const url = await new Promise(resolve => {
      let output = '';
      server.stdout.on('data', bytes => {
        output += bytes;
        if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0]).url);
      });
    });
    let page;
    if (process.env.SOP_CANVAS_ELECTRON_EXE) {
      const desktop = await _electron.launch({
        executablePath: process.env.SOP_CANVAS_ELECTRON_EXE, args: ['--sop-test'],
        env: {...process.env, SOP_STUDIO_TEST_USERDATA: process.env.SOP_CANVAS_ELECTRON_PROFILE},
        timeout: 45000,
      });
      browser = { close: () => desktop.evaluate(({app}) => app.exit()) };
      page = await desktop.firstWindow();
    } else {
      browser = await chromium.launch({ headless: true, executablePath: process.env.SOP_TEST_BROWSER });
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(url);
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.SOP && !document.querySelector('#saveBtn').disabled);
    const expected = await page.evaluate(() => {
      const operation = SOP.blankPage();
      const second = SOP.blankPage();
      operation.name = '超量工序';
      operation.fitSinglePage = true;
      operation.contentStyle = { fontSize: 16, letterSpacing: 1.5 };
      operation.steps = Array.from({ length: 150 }, (_, i) => '操作第' + (i + 1) + '行：完整保存原文。').join('\n');
      operation.requirements = '验收末尾：全部数据保留';
      operation.materials = Array.from({ length: 12 }, (_, i) => ({ name: '物料' + (i + 1), spec: '规格' + (i + 1), qty: '1' }));
      operation.checks = Array.from({ length: 6 }, (_, i) => ({ feature: '检查' + i, standard: '合格', self: '100%', audit: '5%' }));
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 80;
      operation.photos = Array.from({ length: 6 }, (_, i) => ({ id: String(i), data: canvas.toDataURL(), caption: '照片' + i, marks: [] }));
      second.name = '第二工序';
      second.steps = '第二工序的正常内容';
      SOP.replaceProject({
        ...SOP.clone(SOP.project),
        settings: {...SOP.project.settings, cover: false, history: false, flow: false},
        pages: [operation, second],
      });
      return {
        steps: operation.steps,
        requirements: operation.requirements,
        materials: operation.materials,
        checks: operation.checks,
        photos: operation.photos.map(({data, caption}) => ({ data, caption })),
      };
    });
    assert.equal(await page.locator('#fitMode').count(), 0);
    assert.equal(await page.evaluate(() => SOP.layout.length), 2);
    assert(await page.evaluate(() => SOP.layout.every(operation => operation.fitScale === 1 && !operation.fitSinglePage)));
    assert.equal(await page.locator('#previewStage .paper').count(), 1);
    assert.equal(await page.locator('#stepsInput').evaluate(node => node.style.fontSize), '16pt');

    const issue = page.locator('#previewStage .preview-issues').first();
    await issue.waitFor();
    const message = await issue.innerText();
    for (const label of ['工序作业内容', '物料', '检验']) assert(message.includes(label), message);
    const item = (host, target) => page.locator(`${host} [data-issue-target="${target}"]`);
    await item('#previewStage', 'steps').focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('#stepsInput').evaluate(input => input === document.activeElement));
    assert(await page.locator('#previewStage [data-print-part="steps"].reference-issue-focus').count());
    const unexpectedDownload = page.waitForEvent('download', { timeout: 1500 }).then(() => true, () => false);
    await page.locator('#docxBtn').click();
    await page.locator('#exportIssuesDialog[open]').waitFor();
    assert((await page.locator('#exportIssues').innerText()).includes('超量工序'));
    assert(await item('#exportIssues', 'material.6.name').count());
    assert(await item('#exportIssues', 'material.11.name').count());
    assert(await item('#exportIssues', 'check.5.feature').count());
    assert.equal(await unexpectedDownload, false);
    await page.keyboard.press('Escape');
    await page.locator('#exportIssuesDialog').waitFor({state: 'hidden'});

    await page.waitForFunction(() => document.body.dataset.recovery === 'saved');
    await page.reload();
    await page.waitForFunction(() => window.SOP?.project.pages.length === 2 && !document.querySelector('#saveBtn').disabled);
    assert.equal(await page.evaluate(() => SOP.layout.length), 2);
    const recovered = await page.evaluate(() => {
      const { steps, requirements, materials, checks, photos } = SOP.project.pages[0];
      return { steps, requirements, materials, checks, photos: photos.map(({data, caption}) => ({ data, caption })) };
    });
    assert.deepEqual(recovered, expected);

    await page.evaluate(() => {
      const repeated = '超框测试文字'.repeat(80);
      const operation = {...SOP.blankPage(), name: '装配', processLabel: 'K-01', station: 'A12', people: '2', steps: '固定一颗螺丝'};
      operation.requirements = Array.from({length: 90}, (_, i) => '验收第'+(i+1)+'行').join('\n');
      const continuation = {...SOP.blankPage(operation.processId), name: operation.name, processLabel: 'K-01', materials: [{name: '夹具', spec: repeated, qty: '1'}]};
      const second = {...SOP.blankPage(), name: '检验', processLabel: 'K-02', changeRecords: [{}, {}, {document: '保留这条旧更改记录'}]};
      const project = SOP.clone(SOP.project);
      delete project.pageOrder;
      project.settings.cover = true;
      project.meta.bare = repeated;
      project.pages = [operation, continuation, second];
      SOP.replaceProject(project);
      window.printInvocations = 0;
      window.print = () => window.printInvocations++;
    });

    assert.equal(await page.locator('#previewStage [data-print-target="station"]').innerText(), 'A12');
    assert.equal(await page.locator('#previewStage .reference-station:nth-child(2) .reference-station-foot span').innerText(), '人力');
    assert.equal(await page.locator('#previewStage [data-print-target="people"]').innerText(), '2');
    assert.equal(await item('#previewStage', 'steps').count(), 0);
    await item('#previewStage', 'requirements').focus();
    await page.keyboard.press('Space');
    assert(await page.locator('#requirementsInput').evaluate(input => input === document.activeElement));
    assert(await page.locator('#previewStage [data-print-part="requirements"].reference-issue-focus').count());
    await page.locator('#requirementsInput').fill('验收通过');
    await item('#previewStage', 'requirements').waitFor({state: 'detached'});
    assert.equal(await page.locator('#previewStage .reference-issue-focus').count(), 0);

    await page.locator('#docxBtn').click();
    await page.locator('#exportIssuesDialog[open]').waitFor();
    assert.equal(await item('#exportIssues', 'requirements').count(), 0);
    assert.match(await item('#exportIssues', 'material.0.spec').getAttribute('aria-label'), /工序 K-01 装配（续）/);
    await item('#exportIssues', 'material.0.spec').click();
    assert(await page.locator('[data-tab="quality"]').evaluate(button => button.classList.contains('active')));
    assert(await page.locator('[data-material="0"][data-key="spec"]').evaluate(input => input === document.activeElement));
    assert(await page.locator('#previewStage [data-print-target="material.0.spec"].reference-issue-focus').count());
    assert((await page.locator('#previewCaption').innerText()).includes('第 2 页'));
    await page.locator('[data-material="0"][data-key="spec"]').fill('F100');
    await item('#previewStage', 'material.0.spec').waitFor({state: 'detached'});

    await page.locator('#pdfBtn').click();
    await page.locator('#previewDialog[open]').waitFor();
    assert.equal(await item('#fullPreviewIssues', 'material.0.spec').count(), 0);
    await item('#fullPreviewIssues', 'meta.bare').click();
    assert.equal(await page.locator('#editorTitle').innerText(), '封面');
    assert(await page.locator('[data-front-target="meta"][data-front-key="bare"]').evaluate(input => input === document.activeElement));
    assert(await page.locator('#previewStage [data-print-target="meta.bare"].reference-issue-focus').count());
    await page.locator('[data-front-target="meta"][data-front-key="bare"]').fill('10011');
    await item('#previewStage', 'meta.bare').waitFor({state: 'detached'});

    await page.locator('#pdfBtn').click();
    await item('#fullPreviewIssues', 'change.2.document').waitFor();
    await page.locator('#printBtn').click();
    await page.waitForFunction(() => !document.querySelector('#printBtn').disabled);
    assert.equal(await page.evaluate(() => window.printInvocations), 0);
    await item('#fullPreviewIssues', 'change.2.document').press('Enter');
    assert.equal(await page.locator('#editorTitle').innerText(), '检验');
    assert(await page.locator('[data-change-row="2"][data-change-key="document"]').evaluate(input => input === document.activeElement));
    assert(await page.locator('#previewStage [data-print-area="change"].reference-issue-focus').count());
    await page.locator('[data-change-row="2"][data-change-key="document"]').fill('');
    await item('#previewStage', 'change.2.document').waitFor({state: 'detached'});
    assert.deepEqual(await page.evaluate(() => SOP.validateProjectedPages()), []);

    if (!process.env.SOP_CANVAS_ELECTRON_EXE) {
      const download = page.waitForEvent('download');
      await page.locator('#docxBtn').click();
      assert((await download).suggestedFilename().endsWith('.docx'));
      await page.locator('#pdfBtn').click();
      await page.locator('#previewDialog[open]').waitFor();
      assert.equal(await page.locator('#fullPreviewIssues .preview-issue-button').count(), 0);
      await page.locator('#printBtn').click();
      await page.waitForFunction(() => window.printInvocations === 1);
      await page.locator('#closePreview').click();
    }
    await page.evaluate(() => {
      const project = SOP.clone(SOP.project);
      const operation = {...SOP.blankPage(), name: '画布定位'};
      operation.canvas = {width: 900, height: 1100, objects: [{id: 'last', type: 'text', x: 15, y: 1000, w: 90, h: 40, text: '图文标注'}], edges: []};
      project.pages = [operation];
      project.settings.cover = false;
      project.settings.importance = '重要度：'+'说明'.repeat(220);
      SOP.replaceProject(project);
    });
    await item('#previewStage', 'legend.importance').click();
    assert(await page.locator('#editorTitle').evaluate(heading => heading === document.activeElement));
    assert(await page.locator('#previewStage [data-print-target="legend.importance"].reference-issue-focus').count());
    await item('#previewStage', 'canvas').click();
    assert(await page.locator('#editPageCanvas').evaluate(button => button === document.activeElement));
    assert(await page.locator('#previewStage [data-print-area="canvas"].reference-issue-focus').count());
    await page.evaluate(() => {
      SOP.project.pages[0].canvas.objects[0].y = 10;
      SOP.changed();
      document.querySelector('#previewStage [data-issue-target="canvas"]').click();
    });
    await item('#previewStage', 'canvas').waitFor({state: 'detached'});
    assert(await page.locator('#previewCaption').evaluate(caption => caption === document.activeElement));
    assert.deepEqual(errors, []);
    console.log('PASS: fixed pages, overflow navigation from preview/Word/PDF/print, keyboard focus, precise highlights, recovery and export after correction');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
