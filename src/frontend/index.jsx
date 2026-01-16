//Libraries required for the application to work
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Button,
  Form,
  FormFooter,
  Label,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  TextField,
  useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const DELIMITER = ' | ';

const formatParticipants = (entries) =>
  entries.map((entry) => entry.displayName).join(DELIMITER) || 'No estimates yet.';

const formatRevealed = (entries) =>
  entries
    .map((entry) => `${entry.displayName} = ${entry.estimate}`)
    .join(DELIMITER) || 'No estimates yet.';

function App() {
  const context = useProductContext();
  const issueKey =
    context?.platformContext?.issueKey ??
    context?.issueKey ??
    context?.extension?.issue?.key ??
    null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [estimate, setEstimate] = useState('');
  const [pokerState, setPokerState] = useState({ revealed: false, estimates: {} });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!issueKey) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [user, state] = await Promise.all([
        invoke('getCurrentUser'),
        invoke('getPokerState', { issueKey }),
      ]);
      setCurrentUser(user);
      setPokerState(state);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [issueKey]);

  useEffect(() => {
    load();
  }, [load]);

  const entries = useMemo(() => {
    const estimateMap = pokerState?.estimates ?? {};
    return Object.values(estimateMap).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, [pokerState]);

  const handleSubmit = useCallback(async () => {
    if (!issueKey) return;
    if (!estimate) {
      setError('Please enter an estimate before submitting.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const nextState = await invoke('enterEstimate', {
        issueKey,
        accountId: currentUser?.accountId,
        displayName: currentUser?.displayName,
        estimate,
      });
      setPokerState(nextState);
      setEstimate('');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }, [issueKey, estimate, currentUser]);

  const handleReveal = useCallback(async () => {
    if (!issueKey) return;
    try {
      setSubmitting(true);
      setError(null);
      const nextState = await invoke('revealEstimates', { issueKey });
      setPokerState(nextState);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }, [issueKey]);

  const handleClear = useCallback(async () => {
    if (!issueKey) return;
    try {
      setSubmitting(true);
      setError(null);
      const nextState = await invoke('clearEstimates', { issueKey });
      setPokerState(nextState);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }, [issueKey]);

  if (loading) return <Spinner />;

  if (!issueKey) {
    return (
      <SectionMessage title="Poker" appearance="warning">
        <Text>This panel needs to be opened from a Jira issue.</Text>
      </SectionMessage>
    );
  }

  return (
    <Stack space="medium">
      <SectionMessage title="Poker" appearance="information">
        <Text>Enter your estimate, then reveal when the team is ready.</Text>
      </SectionMessage>

      {error ? (
        <SectionMessage title="Something went wrong" appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}

      <Form onSubmit={handleSubmit}>
        <Label labelFor="poker-estimate">Poker: enter your estimate</Label>
        <TextField
          id="poker-estimate"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          placeholder="e.g. 3"
        />
        <FormFooter>
          <Button appearance="primary" type="submit" isDisabled={submitting}>
            {submitting ? 'Saving…' : 'Submit estimate'}
          </Button>
        </FormFooter>
      </Form>

      <Stack space="small">
        <Text>Team estimates:</Text>
        <Text>
          {pokerState.revealed ? formatRevealed(entries) : formatParticipants(entries)}
        </Text>
      </Stack>

      <Stack space="small" direction="horizontal">
        <Button appearance="primary" onClick={handleReveal} isDisabled={submitting}>
          Poker: reveal team estimates
        </Button>
        <Button appearance="warning" onClick={handleClear} isDisabled={submitting}>
          Poker: clear team estimates
        </Button>
      </Stack>
    </Stack>
  );
}

// --- Mount the app into the Forge issue panel ---
ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
