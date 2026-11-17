import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { t } from '../src/l10n.js';

const languages = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'eu'];
const load = async (lang) => JSON.parse(await readFile(new URL(`../l10n/${lang}.json`, import.meta.url), 'utf8'));
test('English is the default source and every interface message has a catalog entry', async () => {
  const { translations } = await load('en');
  for (const [key, value] of Object.entries(translations)) assert.equal(key, value);
  for (const path of ['src/main.js', 'src/pdf.js', 'src/file-action.js', 'templates/main.php', 'lib/Controller/FileController.php', 'lib/Controller/MailController.php']) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\bt\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
      const key = match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      assert.ok(Object.hasOwn(translations, key), `${path}: ${key}`);
    }
  }
});
test('all eight Nextcloud catalogs have complete matching messages and parameters', async () => {
  const reference = await load('fr');
  for (const lang of languages) {
    const catalog = await load(lang);
    assert.deepEqual(Object.keys(catalog.translations), Object.keys(reference.translations));
    for (const [key, value] of Object.entries(catalog.translations)) {
      assert.ok(value.trim(), `${lang}: ${key}`);
      assert.deepEqual([...value.matchAll(/\{[^}]+\}/g)].map(m => m[0]).sort(), [...key.matchAll(/\{[^}]+\}/g)].map(m => m[0]).sort(), `${lang}: ${key}`);
    }
    let registered;
    vm.runInNewContext(await readFile(new URL(`../l10n/${lang}.js`, import.meta.url), 'utf8'), { OC: { L10N: { register: (app, translations, pluralForm) => { registered = { app, translations, pluralForm }; } } } });
    assert.equal(registered.app, 'mjms_pdf_manager');
    assert.equal(JSON.stringify(registered.translations), JSON.stringify(catalog.translations));
    assert.equal(registered.pluralForm, catalog.pluralForm);
  }
});
test('translation forwards parameters to Nextcloud and supports standalone tools', () => {
  assert.equal(t('Page {number}, {name}', {number: 2, name: '<test>.pdf'}), 'Page 2, <test>.pdf');
  globalThis.OC = { L10N: { translate: (app, message, parameters) => {
    assert.equal(app, 'mjms_pdf_manager');
    assert.equal(message, 'Pages');
    assert.deepEqual(parameters, {});
    return 'Orriak';
  } } };
  try { assert.equal(t('Pages'), 'Orriak'); } finally { delete globalThis.OC; }
});
