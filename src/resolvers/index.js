import Resolver from '@forge/resolver';
import { storage } from '@forge/api';

const resolver = new Resolver();
const STORAGE_PREFIX = 'poker-estimates';

const getStorageKey = (issueKey) => `${STORAGE_PREFIX}:${issueKey}`;

const normalizeState = (state) => {
  if (!state || typeof state !== 'object') {
    return { revealed: false, estimates: {} };
  }

  return {
    revealed: Boolean(state.revealed),
    estimates: state.estimates && typeof state.estimates === 'object' ? state.estimates : {},
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
  const nextEstimates = {
    ...existing.estimates,
    [accountId]: { displayName, estimate: parsedEstimate },
  };

  const nextState = {
    revealed: false,
    estimates: nextEstimates,
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

  await storage.delete(getStorageKey(issueKey));
  return { revealed: false, estimates: {} };
});

export const handler = resolver.getDefinitions();
