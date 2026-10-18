import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAgentLoop, parseTranscript } from './agentLoop.js';

const agent = (content) => ({ role: 'agent', content });
const user = (content) => ({ role: 'user', content });

test('flags the agent asking the same question twice in a row', () => {
  const r = detectAgentLoop([agent('What is the address of the emergency?'), user('uh'), agent('What is the address of the emergency?')]);
  assert.deepEqual(r, { looping: true, phrase: 'What is the address of the emergency?' });
});

test('ignores punctuation, case and small rephrasing', () => {
  const r = detectAgentLoop([agent('Can you tell me your exact location please?'), user('...'), agent('can you tell me your exact location')]);
  assert.equal(r.looping, true);
});

test('flags a cycle of A, B, A', () => {
  const r = detectAgentLoop([
    agent('What is the address of the emergency?'),
    user('Main street'),
    agent('Is anyone injured right now?'),
    user('no'),
    agent('What is the address of the emergency?'),
  ]);
  assert.equal(r.looping, true);
});

test('does not flag different questions that share words', () => {
  const r = detectAgentLoop([agent('What is your address?'), user('5th and Main'), agent('What is your name?')]);
  assert.equal(r.looping, false);
});

test('does not flag repeated short acknowledgements', () => {
  assert.equal(detectAgentLoop([agent('Okay, got it.'), user('and a fire'), agent('Okay, got it.')]).looping, false);
});

test('only the latest agent turn matters: an old repeat that moved on is fine', () => {
  const r = detectAgentLoop([
    agent('What is the address of the emergency?'),
    agent('What is the address of the emergency?'),
    user('Main street'),
    agent('Help is on the way to Main street now.'),
  ]);
  assert.equal(r.looping, false);
});

test('handles empty input', () => {
  assert.equal(detectAgentLoop([]).looping, false);
  assert.equal(detectAgentLoop(undefined).looping, false);
});

test('parseTranscript reads the stored Agent/User format', () => {
  const turns = parseTranscript('Agent: Hello there\nUser: Hi\n\nnoise line\nAgent: Bye');
  assert.deepEqual(turns, [agent('Hello there'), user('Hi'), agent('Bye')]);
});
