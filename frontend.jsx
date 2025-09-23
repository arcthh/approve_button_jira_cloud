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

function App() {
  const productCtx = useProductContext();

  // Issue identity from your context shape
  const issueKey = productCtx?.extension?.issue?.key || null;
  const issueId  = productCtx?.extension?.issue?.id  || null;

  const [loading, setLoading] = useState(true);
  const [gate, setGate]       = useState(null);
  const [error, setError]     = useState(null);
  const [approving, setApproving] = useState(false);

  // --- Debounce helper for auto-refresh ---
  const debounceTimer = useRef(null);
  const debounce = (fn, ms = 250) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(fn, ms);
  };

  // Fetch the latest “gate” model from the backend (status, approvers, votes)
  const fetchGate = async () => {
    if (!issueKey && !issueId) return;
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

  // Initial load + whenever identity changes
  useEffect(() => {
    fetchGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // 🔄 Auto-refresh: re-fetch whenever the issue changes in Jira
  useEffect(() => {
    if (!issueKey && !issueId) return;

    // Handler that re-runs our data fetch (debounced)
    const onIssueChanged = () => debounce(fetchGate, 300);

    // Subscribe when this view is mounted
    view.on('JIRA_ISSUE_CHANGED', onIssueChanged);

    // Clean up on unmount or when issue identity changes
    return () => {
      view.off?.('JIRA_ISSUE_CHANGED', onIssueChanged);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Approve click → backend transition + fields + vote, then refresh
  const onApprove = async () => {
    setApproving(true);
    try {
      await invoke('approveIssue', { issueKey, issueId });
      await fetchGate();            // immediate refresh
      // Any subsequent edits by workflow/automation will also be caught by JIRA_ISSUE_CHANGED
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

      {/* Action / state */}
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
            Approve shows only in “Ready for Review” with approvers set, and when you are one of
            them.
          </Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);
