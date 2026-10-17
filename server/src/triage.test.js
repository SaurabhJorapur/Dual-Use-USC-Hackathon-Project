import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyText, triageCall } from './triage.js';

test('armed robbery is Critical Public Safety', () => {
  assert.deepEqual(classifyText('Someone is robbing the store with a gun'), { category: 'Public Safety', urgency_level: 'Critical' });
});

test('car accident is Critical', () => {
  assert.equal(classifyText('There was a bad car accident on 5th street').urgency_level, 'Critical');
});

test('plain pothole report is Standard', () => {
  assert.deepEqual(classifyText('I want to report potholes on Main Street'), { category: 'Potholes', urgency_level: 'Standard' });
});

test('hazardous signal outage is Urgent', () => {
  assert.deepEqual(classifyText('The traffic lights are completely out in all directions'), {
    category: 'Traffic Signals',
    urgency_level: 'Urgent',
  });
});

test('whole-word matching avoids false emergencies', () => {
  const r = classifyText('I took a screenshot of the loud fireworks party next door');
  assert.equal(r.urgency_level, 'Standard');
  assert.equal(r.category, 'Noise & Other');
});

test('uses Retell custom analysis when valid', () => {
  const r = triageCall({
    transcript: 'there is a hole in the road',
    call_analysis: {
      call_summary: 'Caller reported a pothole.',
      custom_analysis_data: { category: 'potholes', urgency_level: 'Urgent', location: 'Vermont & 36th', caller_name: 'Ana' },
    },
  });
  assert.equal(r.category, 'Potholes');
  assert.equal(r.urgency_level, 'Urgent');
  assert.equal(r.status, 'Escalated to Human');
  assert.equal(r.location, 'Vermont & 36th');
  assert.equal(r.summary, 'Caller reported a pothole.');
});

test('keyword safety net overrides an LLM downgrade', () => {
  const r = triageCall({
    transcript: 'A man was stabbed outside my building',
    call_analysis: { custom_analysis_data: { category: 'Noise & Other', urgency_level: 'Standard' } },
  });
  assert.equal(r.urgency_level, 'Critical');
  assert.equal(r.category, 'Public Safety');
  assert.equal(r.status, 'Escalated to 911');
});

test('invalid analysis values fall back to keywords', () => {
  const r = triageCall({ transcript: 'stop light is flashing', call_analysis: { custom_analysis_data: { category: 'Aliens' } } });
  assert.equal(r.category, 'Traffic Signals');
});
