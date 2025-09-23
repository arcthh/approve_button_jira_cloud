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
 * Lean UI:
 * - Only shows a spinner on first load
 * - Single-flight fetch (no overlapping calls)
 * - Debounced event refresh via JIRA_ISSUE_CHANGED
 * - No debug panes, no polling
 */

function App() {
  // From your context dump
  const productCtx = useProductContext();
  const issueKey = productCtx?.extension?.issue?.key || null;
  const issueId  = productCtx?.extension?.issue?.id  || null;

  const [initialLoading, setInitialLoading] = useState(true);
  const [gate, setGate] = useState(null);
  const [error, setError] = useState(null);
  const [approving, setApproving] = useState(false);

  // Prevent overlapping fetches + light throttling
  const inFlightRef = useRef(false);
  const lastFetchMs = useRef(0);
  const debounceTimer = useRef(null);

  const MIN_GAP_MS = 800;   // minimum gap between fetches
  const EVENT_DEBOUNCE_MS = 400;

  const fetchGate = async (isInitial = false) => {
    if (!issueKey && !issueId) return;
    const now = Date.now();
    if (inFlightRef.current || now - lastFetchMs.current < MIN_GAP_MS) return;

    inFlightRef.current = true;
    try {
      const data = await invoke('getIssueData', { issueKey, issueId });
      setGate(data);
      setError(null);
      lastFetchMs.current = Date.now();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      inFlightRef.current = false;
      if (isInitial) setInitialLoading(false);
    }
  };

  // Initial load & when the identity changes
  useEffect(() => {
    setInitialLoading(true);
    fetchGate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Auto-refresh on Jira changes (debounced)
  useEffect(() => {
    if (!issueKey && !issueId) return;
    const onChanged = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => fetchGate(false), EVENT_DEBOUNCE_MS);
    };
    try {
      view.on('JIRA_ISSUE_CHANGED', onChanged);
    } catch {}
    return () => {
      try {
        if (typeof view.off === 'function') view.off('JIRA_ISSUE_CHANGED', onChanged);
        if (typeof view.removeListener === 'function') view.removeListener('JIRA_ISSUE_CHANGED', onChanged);
      } catch {}
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  const onApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      const resp = await invoke('approveIssue', { issueKey, issueId });
      // show the backend message briefly; a fetch right after keeps us in sync
      setGate((prev) => (prev ? { ...prev, message: resp?.message } : prev));
      await fetchGate(false);
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

      {/* Status */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Status:</Text>
        <Lozenge appearance={gate.statusName === 'Approved' ? 'success' : 'inprogress'}>
          {gate.statusName}
        </Lozenge>
      </Stack>

      {/* Approvers */}
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

      {/* Approval date (shows raw value from Jira) */}
      {gate.approvalDate && (
        <Stack direction="horizontal" align="center" space="small">
          <Text>Approval date:</Text>
          <Lozenge appearance="inprogress">{gate.approvalDate}</Lozenge>
        </Stack>
      )}

      {/* Main action/state */}
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
          <Text>
            Available only in “Ready for Review”, with approvers set, and when you are one of them.
          </Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);
