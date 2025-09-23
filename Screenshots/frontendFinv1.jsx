import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  useProductContext,
  Stack,
  Text,
  Button,
  Lozenge,
  SectionMessage,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

/**
 * Quiet, fast UI Kit 2 frontend:
 * - No polling
 * - First-load spinner only; later refreshes are silent
 * - Single-flight fetch guard
 * - Throttle (min gap) + debounce on events
 * - Rate-limit backoff on 429
 */

function App() {
  const productCtx = useProductContext();
  const issueKey = productCtx?.extension?.issue?.key || null;
  const issueId  = productCtx?.extension?.issue?.id  || null;

  const [initialLoading, setInitialLoading] = useState(true);
  const [gate, setGate] = useState(null);
  const [error, setError] = useState(null);
  const [approving, setApproving] = useState(false);

  // single-flight & throttling
  const inFlightRef = useRef(false);
  const lastFetchMs = useRef(0);
  const debounceTimer = useRef(null);
  const subscribed = useRef(false);

  // tune these if needed
  const MIN_GAP_MS = 1200;         // hard throttle between fetches
  const EVENT_DEBOUNCE_MS = 600;   // debounce for bursts of issue-change events
  const RL_BACKOFF_MS = 3000;      // wait after a 429 before retrying once

  const doFetch = async (opts = { isInitial: false, retryOn429: true }) => {
    if (!issueKey && !issueId) return;

    const now = Date.now();
    if (now - lastFetchMs.current < MIN_GAP_MS) return; // throttle
    if (inFlightRef.current) return;                    // single-flight

    inFlightRef.current = true;
    try {
      const data = await invoke('getIssueData', { issueKey, issueId });
      setGate(data);
      setError(null);
      lastFetchMs.current = Date.now();
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);

      // crude detection of rate-limit; retry exactly once after cooldown
      const looks429 = /429|too many requests/i.test(msg);
      if (opts.retryOn429 && looks429) {
        setTimeout(() => {
          // one retry; pass retryOn429: false
          doFetch({ isInitial: false, retryOn429: false });
        }, RL_BACKOFF_MS);
      }
    } finally {
      inFlightRef.current = false;
      if (opts.isInitial) setInitialLoading(false);
    }
  };

  // First load + when identity changes
  useEffect(() => {
    setInitialLoading(true);
    doFetch({ isInitial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Subscribe to JIRA_ISSUE_CHANGED; debounce + throttle the refetch
  useEffect(() => {
    if (!issueKey && !issueId) return;
    if (subscribed.current) return;

    const onChanged = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => doFetch({ isInitial: false }), EVENT_DEBOUNCE_MS);
    };

    try {
      view.on('JIRA_ISSUE_CHANGED', onChanged);
      subscribed.current = true;
    } catch (_e) {
      // If view is not available, we simply won't auto-refresh; user action (approve) still refreshes.
    }

    return () => {
      try {
        if (typeof view.off === 'function') view.off('JIRA_ISSUE_CHANGED', onChanged);
        if (typeof view.removeListener === 'function') view.removeListener('JIRA_ISSUE_CHANGED', onChanged);
      } catch {}
      subscribed.current = false;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  const onApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      const resp = await invoke('approveIssue', { issueKey, issueId });
      setGate((prev) => (prev ? { ...prev, message: resp?.message } : prev));
      await doFetch({ isInitial: false }); // one fetch after mutation
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setApproving(false);
    }
  };

  if (initialLoading || !gate) return <Text>Loading…</Text>;

  return (
    <Stack space="medium">
      {error && (
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {/* Status row */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Status:</Text>
        <Lozenge appearance={gate.statusName === 'Approved' ? 'success' : 'inprogress'}>
          {gate.statusName}
        </Lozenge>
      </Stack>

      {/* Approvers row */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Approvers:</Text>
        {gate.approvers?.length ? (
          gate.approvers.map((u, i) => (
            <Lozenge key={i} appearance="new">
              {u.displayName}
            </Lozenge>
          ))
        ) : (
          <Lozenge appearance="removed">None</Lozenge>
        )}
      </Stack>

      {/* Approval given by */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Approval given by:</Text>
        {gate.approvalGivenBy ? (
          <Lozenge appearance="new">{gate.approvalGivenBy.displayName}</Lozenge>
        ) : (
          <Lozenge appearance="removed">—</Lozenge>
        )}
      </Stack>

      {/* Approval date */}
      {gate.approvalDate && (
        <Stack direction="horizontal" align="center" space="small">
          <Text>Approval date:</Text>
          <Lozenge appearance="inprogress">{gate.approvalDate}</Lozenge>
        </Stack>
      )}

      {/* Action/state */}
      {gate.statusName === 'Approved' ? (
        <SectionMessage appearance="success" title="Approved">
          <Text>
            {gate.message
              ? gate.message
              : `Approved by ${gate.approvedCount}/${gate.totalApprovers} approvers`}
          </Text>
        </SectionMessage>
      ) : gate.canApprove ? (
        <Button appearance="primary" isDisabled={approving} onClick={onApprove}>
          {approving ? 'Approving…' : 'Approve'}
        </Button>
      ) : (
        <SectionMessage appearance="warning" title="Approval not available">
          <Text>Available only in “Ready for Review”, with approvers set, and if you are one of them.</Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);
