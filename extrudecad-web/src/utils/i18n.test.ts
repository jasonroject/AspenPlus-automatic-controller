import test from 'node:test';import assert from 'node:assert/strict';
import { translate } from '../i18n';
test('interface translations preserve the original Chinese locale and unknown object names',()=>{
  assert.equal(translate('属性','en'),'Properties');assert.equal(translate('属性','zh'),'属性');
  assert.equal(translate('用户零件甲_123','en'),'用户零件甲_123');
});
test('dynamic view labels and counts translate without losing values',()=>{
  assert.equal(translate('缩小二维视图','en'),'Zoom Out 2D View');
  assert.equal(translate('2 已选','en'),'2 selected');
  assert.equal(translate('重置三维缩放为100%','en'),'Reset 3D Zoom to 100%');
});
