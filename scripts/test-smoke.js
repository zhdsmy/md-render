const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const node = process.execPath;
const render = path.join(root, 'render.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-render-test-'));

function run(name, args, options = {}) {
  const result = spawnSync(node, [render, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: options.timeout || 120000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error([
      `[${name}] failed with exit code ${result.status}`,
      `$ ${node} ${render} ${args.join(' ')}`,
      '--- stdout ---',
      result.stdout,
      '--- stderr ---',
      result.stderr,
    ].join('\n'));
  }
  console.log(`ok - ${name}`);
  return result;
}

function expectFail(name, args, expectedStderr) {
  const result = spawnSync(node, [render, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.notStrictEqual(result.status, 0, `${name} should fail`);
  assertIncludes(result.stderr, expectedStderr, `${name} should explain the validation failure`);
  console.log(`ok - ${name}`);
  return result;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assertIncludes(text, expected, message) {
  assert.ok(text.includes(expected), `${message}\nExpected to include: ${expected}`);
}

function assertNotIncludes(text, unexpected, message) {
  assert.ok(!text.includes(unexpected), `${message}\nExpected not to include: ${unexpected}`);
}

function waitForFile(file, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`timeout waiting for ${file}`);
}

function commandExists(cmd) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return !result.error;
}

function assertNonEmpty(file, label) {
  const stat = fs.statSync(file);
  assert.ok(stat.size > 1000, `${label} should be non-empty, got ${stat.size} bytes`);
  return stat;
}

let serverProcess;

try {
  const input = path.join(tmp, 'input.md');
  const safeHtml = path.join(tmp, 'safe.html');
  const trustedHtml = path.join(tmp, 'trusted.html');
  const standaloneHtml = path.join(tmp, 'standalone.html');
  const standaloneTrustedHtml = path.join(tmp, 'standalone-trusted.html');
  const standaloneRemoteHtml = path.join(tmp, 'standalone-remote.html');
  const profileHtml = path.join(tmp, 'profile.html');
  const profileOverrideHtml = path.join(tmp, 'profile-override.html');
  const profileDefaultHtml = path.join(tmp, 'profile-default.unknown');
  const profileSafeStandaloneHtml = path.join(tmp, 'profile-safe-standalone.html');
  const profileSimpleInput = path.join(tmp, 'profile-simple.md');
  const profilePngNoExt = path.join(tmp, 'profile-png-no-ext');
  const png = path.join(tmp, 'out.png');
  const avif = path.join(tmp, 'out.avif');
  const jxl = path.join(tmp, 'out.jxl');
  const localImage = path.join(tmp, 'local.png');
  const serverScript = path.join(tmp, 'remote-image-server.js');
  const serverPortFile = path.join(tmp, 'remote-image-server.port');

  const imagePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(serverScript, `
const fs = require('fs');
const http = require('http');
const image = Buffer.from('${imagePng.toString('base64')}', 'base64');
const server = http.createServer((req, res) => {
  if (req.url === '/remote.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(image);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(${JSON.stringify(serverPortFile)}, String(server.address().port));
});
`, 'utf8');
  serverProcess = spawn(node, [serverScript], { cwd: tmp, stdio: ['ignore', 'ignore', 'inherit'] });
  const remoteImageUrl = `http://127.0.0.1:${waitForFile(serverPortFile)}/remote.png`;

  fs.writeFileSync(localImage, imagePng);
  fs.writeFileSync(input, [
    '---',
    'title: "Smoke Doc"',
    'toc: true',
    '---',
    '# md-render smoke',
    '',
    '## 二级标题甲 :triangular_ruler:',
    '',
    '正文一',
    '',
    '### 三级子节',
    '',
    '正文二',
    '',
    '## 二级标题乙',
    '',
    '> [!NOTE]',
    '> 这是 GitHub note 提示',
    '',
    '> [!TIP]',
    '> 这是 tip',
    '',
    '> [!IMPORTANT]',
    '> important 内容',
    '',
    '> [!WARNING]',
    '> warning 内容',
    '',
    '> [!CAUTION]',
    '> caution 内容',
    '',
    ':::details 点击查看详情',
    '折叠里面的内容',
    ':::',
    '',
    '<div data-raw="trusted">raw html</div>',
    '<script>alert(1)</script>',
    '',
    '[external](https://example.com)',
    '',
    '![inline data image](data:image/png;base64,iVBORw0KGgo=)',
    '![local image](local.png)',
    `![remote image](${remoteImageUrl})`,
    '',
    '```mermaid',
    'flowchart TD',
    '  A[Start] --> B[End]',
    '```',
    '',
    'Inline math $E=mc^2$ and emoji :smile:.',
  ].join('\n'));
  fs.writeFileSync(profileSimpleInput, [
    '# Profile smoke',
    '',
    'A small document for profile format inference.',
  ].join('\n'));

  const envCheck = run('check-env', ['--check-env']);
  assertIncludes(envCheck.stdout, '[md-render] environment OK', '--check-env should report a healthy environment');

  expectFail('unknown option validation', ['--check-env', '--unknown-option'], 'unknown option(s): --unknown-option');
  expectFail('removed input alias validation', ['--input', input, '--out', safeHtml], 'unknown option(s): --input');
  expectFail('missing value validation', ['--in', input, '--out', safeHtml, '--width', '--safe'], '--width requires a value');
  expectFail('unknown profile validation', ['--in', input, '--out', profileHtml, '--profile', 'unknown-profile'], '--profile must be one of:');

  run('profile suffix overrides default format', ['--in', profileSimpleInput, '--out', profileHtml, '--profile', 'wechat-long']);
  const profiled = read(profileHtml);
  assertIncludes(profiled, 'body class="format-html"', 'HTML suffix should override wechat-long default PNG format');
  assertIncludes(profiled, '#07c160', 'wechat-long profile should apply the wechat theme');

  run('profile cli override', ['--in', profileSimpleInput, '--out', profileOverrideHtml, '--profile', 'wechat-long', '--theme', 'github-dark']);
  const profileOverride = read(profileOverrideHtml);
  assertIncludes(profileOverride, '#0d1117', 'explicit --theme should override profile theme');
  assertNotIncludes(profileOverride, '#07c160', 'overridden profile theme should not leak wechat CSS');

  run('profile default html format', ['--in', profileSimpleInput, '--out', profileDefaultHtml, '--profile', 'github-doc']);
  assertIncludes(read(profileDefaultHtml), 'body class="format-html"', 'unknown output suffix should use github-doc default HTML format');

  run('profile safe standalone', ['--in', profileSimpleInput, '--out', profileSafeStandaloneHtml, '--profile', 'safe-standalone']);
  const profileSafeStandalone = read(profileSafeStandaloneHtml);
  assertIncludes(profileSafeStandalone, 'Content-Security-Policy', 'safe-standalone profile should enable safe HTML hardening');
  assertNotIncludes(profileSafeStandalone, 'cdn.jsdelivr.net', 'safe-standalone profile should inline assets instead of using CDN');

  run('profile default png without extension', ['--in', profileSimpleInput, '--out', profilePngNoExt, '--profile', 'dark-slide'], { timeout: 180000 });
  assertNonEmpty(profilePngNoExt, 'profile default PNG output without extension');

  run('safe html', ['--in', input, '--out', safeHtml, '--safe']);
  const safe = read(safeHtml);
  assertIncludes(safe, 'Content-Security-Policy', 'safe HTML should include CSP');
  assertIncludes(safe, 'name="referrer" content="no-referrer"', 'safe HTML should disable referrers');
  assertIncludes(safe, 'rel="noopener noreferrer"', 'external links should prevent tabnabbing');
  assertIncludes(safe, 'target="_blank"', 'safe external links should open in a new tab');
  assertIncludes(safe, '&lt;script&gt;alert(1)&lt;/script&gt;', 'safe mode should escape raw script tags');
  assertNotIncludes(safe, '<script>alert(1)</script>', 'safe mode should not preserve raw script tags');
  assertNotIncludes(safe, '<div data-raw="trusted">raw html</div>', 'safe mode should not preserve raw HTML blocks');
  assertNotIncludes(safe, 'src="data:image/png;base64,iVBORw0KGgo="', 'safe mode should block data URL images');
  assertIncludes(safe, 'src="local.png"', 'CDN HTML mode should keep local image references lightweight');

  // GitHub Alert 语法 → 5 套容器 class
  assertIncludes(safe, 'github-alert-note', 'GH Alert NOTE should render with note class');
  assertIncludes(safe, 'github-alert-tip', 'GH Alert TIP should render with tip class');
  assertIncludes(safe, 'github-alert-important', 'GH Alert IMPORTANT should render with info class');
  assertIncludes(safe, 'github-alert-warning', 'GH Alert WARNING should render with warning class');
  assertIncludes(safe, 'github-alert-caution', 'GH Alert CAUTION should render with danger class');
  assertNotIncludes(safe, '[!NOTE]', 'GH Alert marker should be stripped from output');
  assertNotIncludes(safe, '[!CAUTION]', 'GH Alert marker should be stripped from output');

  // TOC（frontmatter toc: true 触发）
  assertIncludes(safe, 'class="md-toc"', 'TOC container should be emitted when frontmatter toc=true');
  assertIncludes(safe, 'href="#二级标题甲"', 'TOC should anchor to h2 via github slugify');
  assertIncludes(safe, 'href="#三级子节"', 'TOC should include h3 entries');

  // :::details 折叠块
  assertIncludes(safe, '<details class="md-details"><summary>点击查看详情</summary>', 'details container should emit native <details>/<summary>');
  assertIncludes(safe, '</details>', 'details container should close properly');

  run('trusted html', ['--in', input, '--out', trustedHtml, '--trusted']);
  const trusted = read(trustedHtml);
  assertIncludes(trusted, '<script>alert(1)</script>', 'trusted mode should keep raw script tags for backward compatibility');
  assertIncludes(trusted, '<div data-raw="trusted">raw html</div>', 'trusted mode should keep raw HTML blocks for backward compatibility');
  assertIncludes(trusted, 'src="data:image/png;base64,iVBORw0KGgo="', 'trusted mode should keep data URL images for backward compatibility');
  assertIncludes(trusted, 'rel="noopener noreferrer"', 'trusted mode should still harden external links');
  assertNotIncludes(trusted, 'target="_blank"', 'trusted mode should not force a new tab by default');

  run('standalone mermaid prerender', ['--in', input, '--out', standaloneHtml, '--standalone', '--safe'], { timeout: 180000 });
  const standalone = read(standaloneHtml);
  assertIncludes(standalone, 'class="mermaid-svg"', 'standalone HTML should prerender Mermaid to SVG');
  assertIncludes(standalone, 'src="local.png"', 'safe standalone HTML should not read local image files');
  assertNotIncludes(standalone, '<pre class="mermaid">', 'standalone HTML should not leave raw Mermaid blocks after successful prerender');
  assertNotIncludes(standalone, 'mermaid.min.js', 'standalone prerendered HTML should not inline Mermaid runtime');

  run('trusted standalone local images', ['--in', input, '--out', standaloneTrustedHtml, '--standalone', '--trusted'], { timeout: 180000 });
  const standaloneTrusted = read(standaloneTrustedHtml);
  assertIncludes(standaloneTrusted, 'src="data:image/png;base64,', 'trusted standalone HTML should inline local PNG images');
  assertNotIncludes(standaloneTrusted, 'src="local.png"', 'trusted standalone HTML should not depend on local image files');

  run('trusted standalone remote images', ['--in', input, '--out', standaloneRemoteHtml, '--standalone', '--trusted'], { timeout: 180000 });
  const standaloneRemote = read(standaloneRemoteHtml);
  assertNotIncludes(standaloneRemote, remoteImageUrl.replace(/&/g, '&amp;'), 'trusted standalone HTML should not depend on remote image URLs');
  assertIncludes(standaloneRemote, 'src="data:image/png;base64,', 'trusted standalone HTML should inline remote PNG images');

  run('png render', ['--in', input, '--out', png, '--safe'], { timeout: 180000 });
  assertNonEmpty(png, 'PNG output');
  const supersamplePng = png.replace(/\.png$/i, '@3x.png');
  assert.ok(!fs.existsSync(supersamplePng), 'default PNG render should not create @3x supersample output');
  console.log('ok - png output is non-empty and default supersample is off');

  if (commandExists('magick')) {
    run('png supersample render', ['--in', input, '--out', png, '--safe', '--supersample', '3'], { timeout: 180000 });
    const pngStat = assertNonEmpty(png, 'PNG output with supersample');
    const supersamplePngStat = assertNonEmpty(supersamplePng, 'supersample PNG output');
    assert.ok(supersamplePngStat.size > pngStat.size, `supersample PNG should be retained as @3x output, got ${supersamplePngStat.size} bytes`);
    console.log('ok - explicit png supersample output is non-empty');
  } else {
    console.log('skip - png supersample render (magick not installed)');
  }

  if (commandExists('avifenc')) {
    run('avif render', ['--in', input, '--out', avif, '--safe'], { timeout: 180000 });
    assertNonEmpty(avif, 'AVIF output');
    assert.ok(!fs.existsSync(avif.replace(/\.avif$/i, '@3x.avif')), 'default AVIF render should not create @3x supersample output');
    console.log('ok - avif output is non-empty and default supersample is off');
  } else {
    console.log('skip - avif render (avifenc not installed)');
  }

  if (commandExists('cjxl')) {
    run('jxl render', ['--in', input, '--out', jxl, '--safe'], { timeout: 180000 });
    assertNonEmpty(jxl, 'JPEG XL output');
    assert.ok(!fs.existsSync(jxl.replace(/\.jxl$/i, '@3x.jxl')), 'default JPEG XL render should not create @3x supersample output');
    console.log('ok - jxl output is non-empty and default supersample is off');
  } else {
    console.log('skip - jxl render (cjxl not installed)');
  }

  console.log(`\nAll md-render smoke tests passed. tmp=${tmp}`);
} finally {
  if (serverProcess) serverProcess.kill();
  if (!process.env.MD_RENDER_KEEP_TEST_TMP) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
