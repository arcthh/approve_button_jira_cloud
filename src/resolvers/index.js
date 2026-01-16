import Resolver from '@forge/resolver';
import { storage } from '@forge/api';

const resolver = new Resolver();
const STORAGE_PREFIX = 'poker-estimates';

const getStorageKey = (issueKey) => `${STORAGE_PREFIX}:${issueKey}`;

const normalizeParticipants = (participants) => {
  if (!Array.isArray(participants)) {
    return [];
  }

  return participants
    .filter((participant) => participant && participant.accountId && participant.displayName)
    .map((participant) => ({
      accountId: participant.accountId,
      displayName: participant.displayName,
    }));
};

const normalizeState = (state) => {
  if (!state || typeof state !== 'object') {
    return { revealed: false, estimates: {}, participants: [] };
  }

  return {
    revealed: Boolean(state.revealed),
    estimates: state.estimates && typeof state.estimates === 'object' ? state.estimates : {},
    participants: normalizeParticipants(state.participants),
  };
};

resolver.define('getPokerState', async ({ payload }) => {
  const { issueKey } = payload;
  if (!issueKey) {
    throw new Error('issueKey is required.');
  }

  const stored = await storage.get(getStorageKey(issueKey));
  return normalizeState(stored);
});

resolver.define('enterEstimate', async ({ payload }) => {
  const { issueKey, accountId, displayName, estimate } = payload;
  if (!issueKey || !accountId || !displayName) {
    throw new Error('issueKey, accountId, and displayName are required.');
  }

  const parsedEstimate = Number(estimate);
  if (!Number.isFinite(parsedEstimate) || parsedEstimate < 0) {
    throw new Error('Estimate must be a non-negative number.');
  }

  const key = getStorageKey(issueKey);
  const existing = normalizeState(await storage.get(key));
  const allowedParticipants = existing.participants;
  if (
    allowedParticipants.length > 0 &&
    !allowedParticipants.some((participant) => participant.accountId === accountId)
  ) {
    throw new Error('You are not allowed to participate in this poker session.');
  }

  const nextEstimates = {
    ...existing.estimates,
    [accountId]: { displayName, estimate: parsedEstimate },
  };

  const nextState = {
    revealed: false,
    estimates: nextEstimates,
    participants: existing.participants,
  };

  await storage.set(key, nextState);
  return nextState;
});

resolver.define('setPokerParticipants', async ({ payload }) => {
  const { issueKey, participants } = payload;
  if (!issueKey) {
    throw new Error('issueKey is required.');
  }

  const key = getStorageKey(issueKey);
  const existing = normalizeState(await storage.get(key));
  const nextState = {
    ...existing,
    participants: normalizeParticipants(participants),
  };

  await storage.set(key, nextState);
  return nextState;
});

resolver.define('revealEstimates', async ({ payload }) => {
  const { issueKey } = payload;
  if (!issueKey) {
    throw new Error('issueKey is required.');
  }

  const key = getStorageKey(issueKey);
  const existing = normalizeState(await storage.get(key));
  const nextState = {
    ...existing,
    revealed: true,
  };

  await storage.set(key, nextState);
  return nextState;
});

resolver.define('clearEstimates', async ({ payload }) => {
  const { issueKey } = payload;
  if (!issueKey) {
    throw new Error('issueKey is required.');
  }

  const key = getStorageKey(issueKey);
  const existing = normalizeState(await storage.get(key));
  const nextState = {
    revealed: false,
    estimates: {},
    participants: existing.participants,
  };

  await storage.set(key, nextState);
  return nextState;
});

export const handler = resolver.getDefinitions();
