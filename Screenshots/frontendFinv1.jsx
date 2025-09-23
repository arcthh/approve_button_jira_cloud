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
 * Fast, stable UI Kit 2 frontend:
 * - Only shows a big "Loading…" during the very first fetch.
 * - Subsequent refreshes are "silent" (no spinner flicker).
 * - Subscribes to JIRA_ISSUE_CHANGED via view.on (no polling).
 * - Debounces event bursts and prevents overlapping fetches.
 * - Does NOT call normalize-on-every-event (that can cause loops). We’ll reset on reopen in the backend on demand.
 */

function App() {
  const productCtx = useProductContext();
  const issueKey = productCtx?.extension?.issue?.key || null;
  const issueId  = productCtx?.extension?.issue?.id  || null;

  const [initialLoading, setInitialLoading] = useState(true); // only for first load
  const [gate, setGate]                     = useState(null);
  const [error, setError]                   = useState(null);
  const [approving, setApproving]           = useState(false);

  // prevent concurrent fetches & throttle refreshes
  const inFlightRef = useRef(false);
  const lastFetchMs = useRef(0);
  const DEBOUNCE_MS = 400;

  const fetchGate = async () => {
    if (!issueKey && !issueId) return;
    if (inFlightRef.current) return; // skip if a fetch is already running

    const now = Date.now();
    if (now - lastFetchMs.current < DEBOUNCE_MS) return; // throttle bursts
    lastFetchMs.current = now;

    inFlightRef.current = true;
    try {
      const data = await invoke('getIssueData', { issueKey, issueId });
      setGate(data);
      setError(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      inFlightRef.current = false;
      if (initialLoading) setInitialLoading(false);
    }
  };

  // First load + when identity changes
  useEffect(() => {
    setInitialLoading(true);
    fetchGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Event-driven refresh (no polling). If your runtime didn’t support view.on previously,
  // that usually manifested as a blank screen. Here it’s safe and minimal.
  useEffect(() => {
    if (!issueKey && !issueId) return;
    const onChanged = () => fetchGate();
    view.on('JIRA_ISSUE_CHANGED', onChanged);
    return () => {
      try {
        if (typeof view.off === 'function') view.off('JIRA_ISSUE_CHANGED', onChanged);
        if (typeof view.removeListener === 'function') view.removeListener('JIRA_ISSUE_CHANGED', onChanged);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  const onApprove = async () => {
    setApproving(true);
    try {
      await invoke('approveIssue', { issueKey, issueId });
      // Fetch once after mutation; further workflow/automation updates will come via the event.
      await fetchGate();
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

      {/* Approval date (if you want to show it) */}
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
