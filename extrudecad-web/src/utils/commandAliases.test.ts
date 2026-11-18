import test from 'node:test';import assert from 'node:assert/strict';
import { resolveCommandAlias } from './commandAliases';
test('CAD aliases resolve case-insensitively, including full names and global prefix', () => {
  for (const [text,id] of [[' l ','line'],['_LINE','line'],['rec','rect'],['PO','point'],['M','move'],['DI','measure'],['CO','duplicate'],['RO','rotate'],['SC','scale'],['E','delete'],['Z','fit']]) assert.equal(resolveCommandAlias(text),id);
});
test('unsupported or incomplete commands do not silently execute another command', () => {
  for (const text of ['', 'RANDOM','TRIM','10,20','MO']) assert.equal(resolveCommandAlias(text),undefined);
});
