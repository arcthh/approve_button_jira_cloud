import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  useProductContext,
  Stack,
  Text,
  Button,
  Lozenge,
  SectionMessage,
} from '@forge/react';
import { invoke } from '@forge/bridge'; // NOTE: we don't import 'view' directly; some tenants don't expose it in UI Kit 2

function App() {
  // Read issue identity from your product context (confirmed from your dump)
  const productCtx = useProductContext();
  const issueKey = productCtx?.extension?.issue?.key || null;
  const issueId  = productCtx?.extension?.issue?.id  || null;

  // Local state
  const [loading, setLoading]       = useState(true);
  const [gate, setGate]             = useState(null);
  const [error, setError]           = useState(null);
  const [approving, setApproving]   = useState(false);

  // --- Fetch the server-side “gate” model (status, approvers, votes) ---
  const fetchGate = async () => {
    if (!issueKey && !issueId) return;  // context not ready
    setLoading(true);
    setError(null);
    try {
      const data = await invoke('getIssueData', { issueKey, issueId });
      setGate(data);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch and whenever identity changes
  useEffect(() => {
    fetchGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // --- Auto-refresh strategy ---
  // 1) Try to subscribe to JIRA_ISSUE_CHANGED if available in this runtime
  // 2) If subscription isn't available, fall back to a light polling loop (every 3s while mounted)
  const subscribedRef = useRef(false);
  const pollTimerRef  = useRef(null);

  useEffect(() => {
    // Try dynamic import so the UI doesn't crash if '@forge/bridge' view API isn't present
    let unmounted = false;

    (async () => {
      try {
        // Dynamic import avoids bundling-time issues when view API is absent
        const mod = await import('@forge/bridge');
        const view = mod?.view;

        if (view && typeof view.on === 'function') {
          const handler = () => fetchGate(); // no debounce: Jira batches its own updates
          view.on('JIRA_ISSUE_CHANGED', handler);
          subscribedRef.current = true;

          // Cleanup
          return () => {
            try {
              // 'off' may not exist on all runtimes; guard it
              if (view && typeof view.off === 'function') {
                view.off('JIRA_ISSUE_CHANGED', handler);
              }
            } catch (_) {}
          };
        }
      } catch (_) {
        // no-op: view not available in this environment
      }

      // If we couldn't subscribe, start a lightweight poller
      if (!unmounted && !subscribedRef.current) {
        pollTimerRef.current = setInterval(() => {
          // Only poll when the panel is mounted and we know the issue identity
          if (issueKey || issueId) fetchGate();
        }, 3000);
      }
    })();

    return () => {
      unmounted = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Approve action → transition + set date + vote → refetch
  const onApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      const resp = await invoke('approveIssue', { issueKey, issueId });
      // Immediately refresh; further updates (automation/workflow) will be caught by event/polling
      await fetchGate();

      // Optionally show server message (“Approved by …”) as a transient success banner
      setGate((prev) => prev ? { ...prev, message: resp?.message } : prev);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setApproving(false);
    }
  };

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
