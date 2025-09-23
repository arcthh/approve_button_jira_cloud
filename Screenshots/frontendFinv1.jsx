import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  useProductContext,
  Stack,
  Text,
  Button,
  Lozenge,
  SectionMessage,
} from '@forge/react';
import { invoke } from '@forge/bridge';

/**
 * UI Kit 2 issueContext frontend:
 * - Displays status, approvers, "Approval given by" and the Approve button.
 * - Subscribes to JIRA_ISSUE_CHANGED (debounced) and falls back to light polling.
 * - On issue changes, calls normalizeOnReady() (backend) to reset fields when status returns to "Ready for Review",
 *   then re-fetches gate data to update UI. This avoids manual refresh.
 */

function App() {
  // Jira context for this placement (confirmed from your dump)
  const productCtx = useProductContext();
  const issueKey = productCtx?.extension?.issue?.key || null;
  const issueId  = productCtx?.extension?.issue?.id  || null;

  // View-model state
  const [loading, setLoading]       = useState(true);
  const [gate, setGate]             = useState(null);
  const [error, setError]           = useState(null);
  const [approving, setApproving]   = useState(false);

  // ---- Helpers ----------------------------------------------------------------

  // Fetch the current "gate" model (status, approvers, votes, approval fields)
  const fetchGate = async () => {
    if (!issueKey && !issueId) return; // context not ready yet
    setError(null);
    try {
      setLoading(true);
      const data = await invoke('getIssueData', { issueKey, issueId });
      setGate(data);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // Debounce utility to prevent bursty refresh (e.g., multiple field updates during a transition)
  const debounceRef = useRef(null);
  const debounce = (fn, ms = 400) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fn, ms);
  };

  // Keep track of the last refresh time to avoid tight loops
  const lastRefreshTsRef = useRef(0);
  const safeRefresh = async () => {
    const now = Date.now();
    if (now - lastRefreshTsRef.current < 400) return; // guard: max ~2.5Hz
    lastRefreshTsRef.current = now;
    await fetchGate();
  };

  // ---- Lifecycle wiring -------------------------------------------------------

  // Initial fetch and whenever identity changes
  useEffect(() => {
    fetchGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Subscribe to JIRA_ISSUE_CHANGED if available; otherwise use gentle polling
  useEffect(() => {
    if (!issueKey && !issueId) return;

    let unmounted = false;
    let removeListener = null;
    let pollTimer = null;

    (async () => {
      try {
        // Dynamic import so the UI doesn't fail on tenants where view API isn't present/stable
        const mod = await import('@forge/bridge');
        const view = mod?.view;

        if (view && typeof view.on === 'function') {
          const handler = async () => {
            // On any issue change:
            // 1) Ask backend to normalize fields if status is "Ready for Review"
            // 2) Re-fetch gate (debounced to avoid bursts)
            try {
              await invoke('normalizeOnReady', { issueKey, issueId });
            } catch (_) {
              // ignore normalize errors; we'll still refresh
            }
            debounce(safeRefresh, 400);
          };

          view.on('JIRA_ISSUE_CHANGED', handler);
          removeListener = () => {
            try {
              if (typeof view.off === 'function') view.off('JIRA_ISSUE_CHANGED', handler);
              // some runtimes only support .removeListener
              if (typeof view.removeListener === 'function') {
                view.removeListener('JIRA_ISSUE_CHANGED', handler);
              }
            } catch (_) {}
          };
          return; // we subscribed successfully; skip polling
        }
      } catch {
        // no-op; fall through to polling
      }

      // Fallback: poll every 5s while mounted and identity known
      if (!unmounted) {
        pollTimer = setInterval(() => {
          if (issueKey || issueId) safeRefresh();
        }, 5000);
      }
    })();

    return () => {
      unmounted = true;
      if (removeListener) removeListener();
      if (pollTimer) clearInterval(pollTimer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Approve click → transition + set fields + vote → refresh
  const onApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      const resp = await invoke('approveIssue', { issueKey, issueId });
      // optimistic message (resolver also returns message)
      setGate((prev) => (prev ? { ...prev, message: resp?.message } : prev));
      await safeRefresh(); // sync with server state after mutation
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setApproving(false);
    }
  };

  // ---- Render -----------------------------------------------------------------

  if (loading || !gate) return <Text>Loading…</Text>;

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
        {gate.approvers?.length > 0 ? (
          gate.approvers.map((u, i) => (
            <Lozenge key={i} appearance="new">
              {u.displayName}
            </Lozenge>
          ))
        ) : (
          <Lozenge appearance="removed">None</Lozenge>
        )}
      </Stack>

      {/* Approval given by (single user custom field) */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Approval given by:</Text>
        {gate.approvalGivenBy ? (
          <Lozenge appearance="new">{gate.approvalGivenBy.displayName}</Lozenge>
        ) : (
          <Lozenge appearance="removed">—</Lozenge>
        )}
      </Stack>

      {/* Approval date (optional display) */}
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
            Approve shows only in “Ready for Review”, with approvers set, and when you are one of
            them.
          </Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);
