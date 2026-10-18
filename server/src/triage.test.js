import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORY, EMERGENCY, HAZARDS, callerText, classifyText, couple, triageCall } from './triage.js';

test('armed robbery is Critical Emergency', () => {
  assert.deepEqual(classifyText('Someone is robbing the store with a gun'), { category: EMERGENCY, urgency_level: 'Critical' });
});

test('dramatic life-safety phrases are Critical', () => {
  for (const text of ["I'm going to die", "I can't breathe", 'someone is breaking in', 'there is a fire']) {
    assert.equal(classifyText(text).urgency_level, 'Critical', text);
  }
});

test('car accident is Critical', () => {
  assert.equal(classifyText('There was a bad car accident on 5th street').urgency_level, 'Critical');
});

test('plain pothole report is Standard Roads & Infrastructure', () => {
  assert.deepEqual(classifyText('I want to report potholes on Main Street'), { category: 'Roads & Infrastructure', urgency_level: 'Standard' });
});

test('hazardous signal outage is Urgent', () => {
  assert.equal(classifyText('The traffic lights are completely out in all directions').urgency_level, 'Urgent');
});

test('gas leak is an Urgent hazard', () => {
  assert.deepEqual(classifyText('I smell gas, there is a gas leak on my street'), { category: HAZARDS, urgency_level: 'Urgent' });
});

test('open fire hydrant is a hazard, not a fire emergency', () => {
  assert.deepEqual(classifyText('There is an open fire hydrant spraying water'), { category: HAZARDS, urgency_level: 'Urgent' });
});

test('water main break is Utilities & Water', () => {
  assert.equal(classifyText('A water main burst and the sewer is backing up').category, 'Utilities & Water');
});

test('missed trash pickup is Code Enforcement & Sanitation', () => {
  assert.deepEqual(classifyText('My trash was not picked up and there is illegal dumping'), {
    category: 'Code Enforcement & Sanitation',
    urgency_level: 'Standard',
  });
});

test('whole-word matching avoids false emergencies', () => {
  const r = classifyText('I took a screenshot of the loud fireworks party next door');
  assert.equal(r.urgency_level, 'Standard');
  assert.equal(r.category, 'Code Enforcement & Sanitation');
});

test('couple keeps category and urgency consistent', () => {
  assert.deepEqual(couple('Roads & Infrastructure', 'Critical'), { category: EMERGENCY, urgency_level: 'Critical' });
  assert.deepEqual(couple(EMERGENCY, 'Standard'), { category: EMERGENCY, urgency_level: 'Critical' });
  assert.deepEqual(couple(HAZARDS, 'Standard'), { category: HAZARDS, urgency_level: 'Urgent' });
  assert.deepEqual(couple('Utilities & Water', 'Urgent'), { category: 'Utilities & Water', urgency_level: 'Urgent' });
});

test('uses Retell custom analysis when valid', () => {
  const r = triageCall({
    transcript: 'there is a hole in the road',
    call_analysis: {
      call_summary: 'Caller reported a pothole.',
      custom_analysis_data: { category: 'roads & infrastructure', urgency_level: 'Urgent', location: 'Vermont & 36th', caller_name: 'Ana' },
    },
  });
  assert.equal(r.category, 'Roads & Infrastructure');
  assert.equal(r.urgency_level, 'Urgent');
  assert.equal(r.status, 'Escalated to Human');
  assert.equal(r.location, 'Vermont & 36th');
  assert.equal(r.summary, 'Caller reported a pothole.');
});

test('keyword safety net overrides an LLM downgrade', () => {
  const r = triageCall({
    transcript: 'A man was stabbed outside my building',
    call_analysis: { custom_analysis_data: { category: 'Code Enforcement & Sanitation', urgency_level: 'Standard' } },
  });
  assert.equal(r.urgency_level, 'Critical');
  assert.equal(r.category, EMERGENCY);
  assert.equal(r.status, 'Escalated to 911');
});

test('LLM-chosen Emergency is always Critical', () => {
  const r = triageCall({ transcript: 'help', call_analysis: { custom_analysis_data: { category: EMERGENCY, urgency_level: 'Standard' } } });
  assert.equal(r.urgency_level, 'Critical');
  assert.equal(r.status, 'Escalated to 911');
});

test('invalid analysis values fall back to keywords', () => {
  const r = triageCall({ transcript: 'stop light is flashing', call_analysis: { custom_analysis_data: { category: 'Aliens' } } });
  assert.equal(r.category, 'Roads & Infrastructure');
});

// The official municipal category examples (the five known misclassifications).
test('stolen trash can is Standard Code Enforcement, not an emergency', () => {
  assert.deepEqual(classifyText('Hey, someone just stole my city-provided green waste trash can off the curb this morning.'), {
    category: DEFAULT_CATEGORY,
    urgency_level: 'Standard',
  });
});

test('loud party is a Standard noise complaint', () => {
  assert.deepEqual(classifyText("My neighbors are playing loud music and won't turn it down and it's past midnight."), {
    category: 'Code Enforcement & Sanitation',
    urgency_level: 'Standard',
  });
});

test('pothole that popped a tire is Urgent Roads & Infrastructure', () => {
  assert.deepEqual(classifyText("There's a massive pothole on 4th street that popped my tire an hour ago."), {
    category: 'Roads & Infrastructure',
    urgency_level: 'Urgent',
  });
});

test('branch blocking a lane is an Urgent hazard', () => {
  assert.deepEqual(classifyText('A big tree branch fell down during the windstorm and is blocking one lane of traffic on Maple Ave.'), {
    category: HAZARDS,
    urgency_level: 'Urgent',
  });
});

test('a retracted joke is Standard, not Critical', () => {
  const r = classifyText('Uh never mind, false alarm, my friend was just joking about a guillotine.');
  assert.deepEqual(r, { category: DEFAULT_CATEGORY, urgency_level: 'Standard', retracted: true });
});

test('a danger claim taken back is no longer Critical', () => {
  const r = classifyText("I'm about to die.\nwait. I was kinda lying. never mind. sorry. I'm good now.");
  assert.equal(r.urgency_level, 'Standard');
  assert.equal(r.retracted, true);
});

test('danger mentioned after "never mind" stays Critical', () => {
  const r = classifyText("never mind the address, he still has a gun and he's coming in");
  assert.deepEqual(r, { category: EMERGENCY, urgency_level: 'Critical' });
});

test('"I\'m okay" alone is not a retraction', () => {
  assert.equal(classifyText("I'm okay, just calling about a pothole").retracted, undefined);
});

test('flooding is Utilities & Water', () => {
  assert.equal(classifyText('The street is flooding near the storm drain').category, 'Utilities & Water');
});

test('callerText rejoins a sentence Retell split across turns', () => {
  const t = "Agent: What would you\nUser: I'm about\nAgent: like to report?\nUser: to die.";
  assert.equal(classifyText(callerText(t)).urgency_level, 'Critical');
});

test('callerText keeps only what the caller said', () => {
  const t = 'Agent: You sound in immediate danger, is there a fire?\nUser: No, my trash can was stolen.';
  assert.equal(callerText(t), 'No, my trash can was stolen.');
  assert.equal(callerText('plain web report text'), 'plain web report text');
});

test("the agent's own words do not escalate a call", () => {
  const r = triageCall({ transcript: 'Agent: Is anyone injured or bleeding?\nUser: No, the streetlight is out on my block.' });
  assert.notEqual(r.urgency_level, 'Critical');
  assert.equal(r.category, 'Roads & Infrastructure');
});

test('a retraction overrides an LLM Critical', () => {
  const r = triageCall({
    transcript: "User: I'm about to die, guillotine on my neck.\nUser: I'm just messing with you. It's not real. I'm sorry.",
    call_analysis: { custom_analysis_data: { category: EMERGENCY, urgency_level: 'Critical' } },
  });
  assert.equal(r.urgency_level, 'Standard');
  assert.equal(r.status, 'AI Completed');
  assert.notEqual(r.category, EMERGENCY);
});
