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
  UserPicker,
  useProductContext,
} from '@forge/react';
import { invoke, requestJira } from '@forge/bridge';

const DELIMITER = ' | ';

const formatParticipants = (entries) =>
  entries.map((entry) => entry.displayName).join(DELIMITER) || 'No estimates yet.';

const formatRevealed = (entries) =>
  entries
    .map((entry) => `${entry.displayName} = ${entry.estimate}`)
    .join(DELIMITER) || 'No estimates yet.';

const formatAllowedParticipants = (entries) =>
  entries.map((entry) => entry.displayName).join(DELIMITER) ||
  'Anyone with access can participate.';

const normalizePickerValues = (value) => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const fetchJson = async (path, init) => {
  const res = await requestJira(path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

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
  const [pokerState, setPokerState] = useState({
    revealed: false,
    estimates: {},
    participants: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [participantsSaving, setParticipantsSaving] = useState(false);

  const load = useCallback(async () => {
    if (!issueKey) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = await fetchJson('/rest/api/3/myself');
      setCurrentUser(user);

      const state = await invoke('getPokerState', { issueKey });
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

  const allowedParticipants = useMemo(
    () => pokerState?.participants ?? [],
    [pokerState]
  );

  const allowedAccountIds = useMemo(
    () => new Set(allowedParticipants.map((participant) => participant.accountId)),
    [allowedParticipants]
  );

  const isParticipantAllowed =
    allowedParticipants.length === 0 ||
    (currentUser?.accountId && allowedAccountIds.has(currentUser.accountId));

  const resolveParticipants = useCallback(async (selection) => {
    const values = normalizePickerValues(selection);
    const participants = new Map();
    const missing = [];

    values.forEach((value) => {
      if (!value) {
        return;
      }

      if (typeof value === 'string') {
        missing.push(value);
        return;
      }

      const accountId = value.id || value.accountId;
      const displayName = value.name || value.displayName;
      if (accountId && displayName) {
        participants.set(accountId, displayName);
      } else if (accountId) {
        missing.push(accountId);
      }
    });

    if (missing.length > 0) {
      const fetched = await Promise.all(
        missing.map((accountId) =>
          fetchJson(`/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`)
        )
      );
      fetched.forEach((user) => {
        if (user?.accountId && user?.displayName) {
          participants.set(user.accountId, user.displayName);
        }
      });
    }

    return Array.from(participants, ([accountId, displayName]) => ({
      accountId,
      displayName,
    }));
  }, []);

  const handleParticipantsSubmit = useCallback(
    async (formData) => {
      if (!issueKey) return;

      try {
        setParticipantsSaving(true);
        setError(null);
        const participants = await resolveParticipants(formData.pokerParticipants);
        const nextState = await invoke('setPokerParticipants', {
          issueKey,
          participants,
        });
        setPokerState(nextState);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setParticipantsSaving(false);
      }
    },
    [issueKey, resolveParticipants]
  );

  const handleAllowAll = useCallback(async () => {
    if (!issueKey) return;

    try {
      setParticipantsSaving(true);
      setError(null);
      const nextState = await invoke('setPokerParticipants', {
        issueKey,
        participants: [],
      });
      setPokerState(nextState);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setParticipantsSaving(false);
    }
  }, [issueKey]);

  const handleSubmit = useCallback(async () => {
    if (!issueKey) return;
    if (!isParticipantAllowed) {
      setError('You are not allowed to participate in this poker session.');
      return;
    }
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
  }, [issueKey, estimate, currentUser, isParticipantAllowed]);

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
  if (!issueKey) return <Spinner />;

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

      <SectionMessage title="Poker participation" appearance="information">
        <Text>
          Choose who can participate in this poker session. Leave the list empty
          to allow anyone with access.
        </Text>
      </SectionMessage>

      <Form onSubmit={handleParticipantsSubmit}>
        <UserPicker
          name="pokerParticipants"
          label="Allowed participants"
          isMulti
          defaultValue={allowedParticipants.map((participant) => participant.accountId)}
          placeholder="Search for users"
        />
        <FormFooter>
          <Button
            appearance="primary"
            type="submit"
            isDisabled={participantsSaving}
          >
            {participantsSaving ? 'Saving…' : 'Save participants'}
          </Button>
          <Button
            appearance="subtle"
            type="button"
            onClick={handleAllowAll}
            isDisabled={participantsSaving}
          >
            Allow all
          </Button>
        </FormFooter>
      </Form>

      <Stack space="small">
        <Text>Participants allowed:</Text>
        <Text>{formatAllowedParticipants(allowedParticipants)}</Text>
      </Stack>

      {!isParticipantAllowed ? (
        <SectionMessage title="Participation restricted" appearance="warning">
          <Text>
            You are not on the participant list, so you cannot submit an
            estimate.
          </Text>
        </SectionMessage>
      ) : null}

      <Form onSubmit={handleSubmit}>
        <Label labelFor="poker-estimate">Poker: enter your estimate</Label>
        <TextField
          id="poker-estimate"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          placeholder="e.g. 3"
          isDisabled={!isParticipantAllowed || submitting}
        />
        <FormFooter>
          <Button
            appearance="primary"
            type="submit"
            isDisabled={!isParticipantAllowed || submitting}
          >
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
